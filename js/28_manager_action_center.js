    // ============================================================
    // MANAGER ACTION CENTER  (js/28_manager_action_center.js)
    // Entry: openManagerActionCenter()  Tile: btn-managerActionCenter (target)
    // Overlay id: macModal (full-screen, mirrors js/26 ccOv pattern).
    // Manager-gated (store-management roles). The backend RPCs are the real
    // gate and return 'forbidden' for non-managers -> shown inline as
    // "Managers only." (never a dead screen).
    //
    // BACKEND CONTRACT (must agree with app_task_* RPCs — CONTRACT rule):
    //   app_task_store_health(p_username,p_password,p_store)
    //     -> { open, overdue, needs_review, open_critical, waiting }
    //   app_task_feed(p_username,p_password,p_store,p_view,p_filters)
    //     -> { view, store, count, items:[ { id,title,priority,status,
    //          due_date,is_overdue,source_module,owner_role,location } ] }
    //   Views: today | needs_review | overdue | waiting | approvals
    // ============================================================
    var _mac = { store:'', view:'today', health:null, feed:null };
    var MAC_VIEWS = [['today','Today'],['needs_review','Needs review'],['overdue','Overdue'],['waiting','Waiting'],['approvals','Approvals']];

    // Credential wrapper — identical pattern to scRpc/ccRpc/wobRpc: withPin +
    // p_username/p_password merged into the args, 'forbidden' surfaced kindly.
    function macRpc(name,args,cb,onerr){ withPin(function(pin){ supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){ if(r.error){ if(onerr)onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; } cb(r.data); }).catch(function(){ if(onerr)onerr({message:'Connection error'}); else alert('Connection error.'); }); }); }

    function macOv(){ var o=document.getElementById('macModal'); if(!o){ o=document.createElement('div'); o.id='macModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function macClose(){ var o=document.getElementById('macModal'); if(o) o.style.display='none'; }
    function macHeader(){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">&#127919; Manager Action Center</b><button onclick="macClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }

    // Broad UI gate (mirror js/26 ccCanSee). The RPC still enforces the real rule.
    function macCanSee(){ if(!currentUser) return false; if(currentUser.is_developer===true) return true; if(typeof isManagerRole==='function'&&isManagerRole()) return true; var r=String(currentUser.role||'').toLowerCase(); return r.indexOf('manager')>=0||r.indexOf('admin')>=0||r.indexOf('lead')>=0||r.indexOf('owner')>=0||r.indexOf('vp')>=0; }
    function macStores(){ try{ if(typeof taTargets!=='undefined'&&taTargets&&taTargets.stores&&taTargets.stores.length) return taTargets.stores; }catch(e){} return (typeof HUB_STORES!=='undefined'?HUB_STORES:[]); }
    function macEmoji(loc){ return (typeof hubStoreEmoji==='function'?hubStoreEmoji(loc):'&#128205;'); }

    function macNum(n){ return (n==null||n===''||isNaN(parseFloat(n)))?'0':String(parseInt(n,10)); }
    function macDate(d){ if(!d) return ''; var s=String(d); var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m){ var dt=new Date(+m[1],+m[2]-1,+m[3]); if(!isNaN(dt.getTime())) return dt.toLocaleDateString(undefined,{month:'short',day:'numeric'}); } try{ var d2=new Date(s); if(!isNaN(d2.getTime())) return d2.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }catch(e){} return s.slice(0,10); }
    function macClean(s){ return String(s||'').replace(/[_-]+/g,' ').trim(); }
    function macTitleCase(s){ s=macClean(s); return s?s.charAt(0).toUpperCase()+s.slice(1):''; }
    function macViewLabel(v){ for(var i=0;i<MAC_VIEWS.length;i++){ if(MAC_VIEWS[i][0]===v) return MAC_VIEWS[i][1]; } return v; }
    function macPriPill(p){ if(p==null||p==='') return ''; var k=String(p).toLowerCase(); var c;
        if(k==='critical'||k==='urgent'||k==='p1') c=['#fdeaea','#a01b3e'];
        else if(k==='high') c=['#fff4e0','#9a5b00'];
        else if(k==='medium'||k==='normal'||k==='p2') c=['#eef3fb','#185FA5'];
        else c=['#eef0f3','#5b6472'];
        return '<span style="background:'+c[0]+';color:'+c[1]+';font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;text-transform:capitalize;">'+escapeHtml(String(p))+'</span>'; }
    function macStat(label,val,color){ return '<div style="flex:1;min-width:84px;background:#fff;border:1px solid #eef0f5;border-radius:10px;padding:8px 10px;"><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;">'+label+'</div><div style="font-size:18px;font-weight:800;color:'+(color||'#1f2a44')+';">'+macNum(val)+'</div></div>'; }
    function macLoadingHtml(msg){ return '<div style="text-align:center;color:#6b7686;padding:38px;">'+(msg||'Loading&hellip;')+'</div>'; }

    function openManagerActionCenter(){ if(!macCanSee()){ alert('Managers only.'); return; } _mac.view='today'; _mac.feed=null; macLoad(); }
    function macLoad(){ macOv().innerHTML=macHeader()+macLoadingHtml('Loading action center&hellip;'); macRpc('app_task_store_health',{p_store:_mac.store||null},function(h){ _mac.health=h||{}; macLoadFeed(); },macErr); }
    function macLoadFeed(){ macRpc('app_task_feed',{p_store:_mac.store||null,p_view:_mac.view,p_filters:{}},function(d){ _mac.feed=d||{}; macRender(); },macErr); }
    function macSetStore(s){ _mac.store=s||''; _mac.feed=null; macLoad(); }
    function macSetView(v){ _mac.view=v; _mac.feed=null; macRender(); macLoadFeed(); }

    function macErr(e){ var msg=String((e&&e.message)||''); var body;
        if(msg.indexOf('forbidden')>=0) body='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:30px;text-align:center;color:#6b6275;">&#128274; Managers only.</div>';
        else body='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:24px;text-align:center;color:#a01b3e;">'+escapeHtml(msg||'Could not load.')+'</div>';
        macOv().innerHTML=macHeader()+'<div style="max-width:820px;margin:0 auto;padding:16px 16px 50px;">'+body+'</div>'; }

    function macCard(it){ it=it||{};
        var overdue=(it.is_overdue===true);
        var accent=overdue?'#a01b3e':'#185FA5';
        var meta=[];
        if(it.source_module) meta.push(escapeHtml(macTitleCase(it.source_module)));
        if(it.owner_role) meta.push(escapeHtml(String(it.owner_role)));
        if(it.location) meta.push(macEmoji(it.location)+' '+escapeHtml(String(it.location)));
        var due=it.due_date?('<span style="margin-left:auto;color:'+(overdue?'#a01b3e':'#6b6275')+';font-weight:'+(overdue?'800':'600')+';white-space:nowrap;">'+(overdue?'&#9888; ':'&#128197; ')+escapeHtml(macDate(it.due_date))+'</span>'):'';
        var status=it.status?'<span style="background:#eef0f3;color:#5b6472;font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;text-transform:capitalize;">'+escapeHtml(macClean(it.status))+'</span>':'';
        return '<div style="background:#fff;border:1px solid #ececf2;border-left:4px solid '+accent+';border-radius:12px;padding:12px 14px;margin-bottom:8px;box-shadow:0 2px 6px rgba(0,0,0,.04);">'+
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;"><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(String(it.title||'(untitled)'))+'</b>'+macPriPill(it.priority)+'</div>'+
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:#6b6275;">'+status+(meta.length?'<span>'+meta.join(' &middot; ')+'</span>':'')+due+'</div>'+
            '</div>'; }

    function macRender(){ var h=_mac.health||{}, f=_mac.feed;
        var out='<div style="max-width:820px;margin:0 auto;padding:14px 16px 50px;">';
        // Header snapshot from app_task_store_health
        out+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">'+
            macStat('Open',h.open,'#185FA5')+
            macStat('Overdue',h.overdue,'#a01b3e')+
            macStat('Needs review',h.needs_review,'#9a5b00')+
            macStat('Critical',h.open_critical,'#a01b3e')+
            macStat('Waiting',h.waiting,'#5b6472')+
            '</div>';
        // Optional store selector
        var stores=macStores();
        if(stores && stores.length){
            out+='<div style="margin-bottom:10px;"><select onchange="macSetStore(this.value)" style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:13px;background:#fff;box-sizing:border-box;">'+
                '<option value=""'+(_mac.store?'':' selected')+'>All stores</option>'+
                stores.map(function(s){ return '<option value="'+escapeHtml(s)+'"'+(_mac.store===s?' selected':'')+'>'+macEmoji(s)+' '+escapeHtml(s)+'</option>'; }).join('')+
                '</select></div>';
        }
        // Tabbed views
        out+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">'+
            MAC_VIEWS.map(function(v){ var on=(_mac.view===v[0]); return '<button onclick="macSetView(\''+v[0]+'\')" style="flex:1;min-width:92px;background:'+(on?'#185FA5':'#eef0f3')+';color:'+(on?'#fff':'#5b6472')+';border:none;padding:9px 8px;font-size:12.5px;font-weight:700;border-radius:9px;cursor:pointer;">'+v[1]+'</button>'; }).join('')+
            '</div>';
        // Feed body
        if(f==null){ out+=macLoadingHtml('Loading '+macViewLabel(_mac.view)+'&hellip;'); }
        else {
            var items=(f&&f.items)||[];
            out+='<div style="font-size:11.5px;color:#6b7686;margin:0 2px 8px;">'+items.length+' '+(items.length===1?'item':'items')+' &middot; '+escapeHtml(macViewLabel(_mac.view))+(_mac.store?(' &middot; '+escapeHtml(_mac.store)):' &middot; all stores')+'</div>';
            if(!items.length) out+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:30px;text-align:center;color:#6b6275;">&#9989; Nothing here right now.</div>';
            else items.forEach(function(it){ out+=macCard(it); });
        }
        out+='</div>';
        macOv().innerHTML=macHeader()+out;
    }

    // Entry point exposed on window (matches js/27 openMarketingHub convention).
    window.openManagerActionCenter = openManagerActionCenter;
