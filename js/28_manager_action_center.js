    // ============================================================
    // MANAGER ACTION CENTER  (js/28_manager_action_center.js)
    // Entry: openManagerActionCenter()  Tile: btn-managerActionCenter
    // Overlay id: macModal (full-screen, mirrors js/26 ccOv pattern).
    // Store-management-gated. The backend RPCs are the real gate and return
    // 'forbidden' for non-managers -> shown inline as "Managers only." (never a
    // dead screen). SPEC: architecture/SPEC_Manager_Action_Center_v1.md (§6/§8/
    // §9/§10/§11/§13/§14) + SPEC_Clarifications_Response.md (escalation tiers,
    // proof-to-close, Assistant Managers = store management).
    //
    // BACKEND CONTRACT — reads ONLY these two live, manifest-registered RPCs
    // (this is a read/organize + surface layer, NOT new backend):
    //   app_task_store_health(p_username,p_password,p_store)
    //     -> { store, open, overdue, needs_review, open_critical, waiting }
    //   app_task_feed(p_username,p_password,p_store,p_view,p_filters)
    //     row views  -> { view,store,count, items:[ {id,title,priority,status,
    //                     due_date,is_overdue,source_module,owner_role,location} ] }
    //     group views-> items:[ {source_module|owner_role, count} ]
    //     views: today | needs_review | overdue | waiting | approvals |
    //            store_priorities | recently_closed | by_source | by_owner
    //     p_filters honored keys: source_module, priority, owner_role
    //   (cross_dept is a CLIENT pseudo-view rendered from by_source, filtered to
    //    cross-department source modules per §6/§7 — no separate RPC.)
    //
    // ONE live write action: app_task_nudge(p_username,p_password,p_task_id) —
    //   manifest-registered, non-destructive owner reminder (§11.3 reminder).
    //
    // DOCUMENTED GAP (next phase — see report): the interactive §11 actions that
    // mutate the task lifecycle with proper closure/proof/audit (open full
    // detail w/ comments+audit, close-with-template, update/reassign/mark-waiting,
    // comment, reopen) are backed by app_task_detail / app_task_update /
    // app_task_close / app_task_reopen / app_task_comment_add / app_task_comment_list.
    // Those are defined + granted in specs/task_engine_te_a.sql but are NOT in
    // rpc_manifest.json, so they cannot be called yet without failing the
    // pre-deploy RPC check. The detail drawer below surfaces each item's data +
    // its closure requirements + escalation tier as READ-ONLY guidance so the
    // wiring is a small, localized change once those 6 names are registered.
    // ============================================================
    var _mac = { store:'', view:'today', health:null, feed:null, synced:null,
                 q:'', pri:'', src:'', own:'', snapOpen:false, allToday:false };

    // Spec §6 / §13.1 views, grouped into work-queues and organize/rollups.
    var MAC_WORK_VIEWS = [
        ['today','Today','&#128204;'], ['needs_review','Needs review','&#128229;'],
        ['overdue','Overdue','&#9200;'], ['waiting','Waiting','&#8987;'],
        ['approvals','Approvals','&#9989;'], ['store_priorities','Priorities','&#127919;']
    ];
    var MAC_ROLLUP_VIEWS = [
        ['cross_dept','Cross-dept','&#129309;'], ['by_source','By source','&#128451;'],
        ['by_owner','By owner','&#128100;'], ['recently_closed','Recently closed','&#128230;']
    ];
    // §10 Store Health Snapshot signals not yet fed by the health RPC — shown as
    // labelled placeholders (spec §13.1 "placeholders where full data does not
    // exist yet" + §10 future-version note). Break-downs live in the By-source view.
    var MAC_SNAP_PENDING = [
        ['Temperature Log','completed / missed / discrepancies'],
        ['Maintenance','open critical / overdue repairs'],
        ['Supply Requests','open / waiting on warehouse'],
        ['Training','overdue / pending sign-offs'],
        ['People / documentation','attendance & notes pending review'],
        ['Your Voice','open items routed to store mgmt'],
        ['Marketing / events','campaign & event support tasks'],
        ['Fundraisers / C&V','store-facing support tasks']
    ];

    // Credential wrapper — identical pattern to scRpc/ccRpc/wobRpc.
    function macRpc(name,args,cb,onerr){ withPin(function(pin){ supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){ if(r.error){ if(onerr)onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; } cb(r.data); }).catch(function(){ if(onerr)onerr({message:'Connection error'}); else alert('Connection error.'); }); }); }

    function macOv(){ var o=document.getElementById('macModal'); if(!o){ o=document.createElement('div'); o.id='macModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function macClose(){ var o=document.getElementById('macModal'); if(o) o.style.display='none'; macDetailClose(); }
    function macHeader(){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">&#127919; Manager Action Center</b><button onclick="macClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }

    // Strict UI gate — mirrors backend public._task_is_store_mgmt (OD-1): admits
    // assistant/store/general managers, admin, owner, VP/president/director and the
    // bare role 'Manager'; EXCLUDES Shift Leader / Team Lead (§2.1, §14.1 Shift
    // Leader test). Assistant Managers are store management (§4.3 / clarifications).
    // The RPC still enforces the real rule server-side.
    function macCanSee(){ if(!currentUser) return false; if(currentUser.is_developer===true) return true;
        var r=String(currentUser.role||'').toLowerCase();
        if(r.indexOf('shift lead')>=0||r.indexOf('team lead')>=0) return false;
        if(typeof isManagerRole==='function'&&isManagerRole()) return true;
        return r.indexOf('manager')>=0||r.indexOf('admin')>=0||r.indexOf('owner')>=0
            ||r.indexOf('vp')>=0||r.indexOf('vice president')>=0||r.indexOf('president')>=0||r.indexOf('director')>=0; }
    function macStores(){ try{ if(typeof taTargets!=='undefined'&&taTargets&&taTargets.stores&&taTargets.stores.length) return taTargets.stores; }catch(e){} return (typeof HUB_STORES!=='undefined'?HUB_STORES:[]); }
    function macEmoji(loc){ return (typeof hubStoreEmoji==='function'?hubStoreEmoji(loc):'&#128205;'); }

    function macNum(n){ return (n==null||n===''||isNaN(parseFloat(n)))?'0':String(parseInt(n,10)); }
    function macDate(d){ if(!d) return ''; var s=String(d); var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m){ var dt=new Date(+m[1],+m[2]-1,+m[3]); if(!isNaN(dt.getTime())) return dt.toLocaleDateString(undefined,{month:'short',day:'numeric'}); } try{ var d2=new Date(s); if(!isNaN(d2.getTime())) return d2.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }catch(e){} return s.slice(0,10); }
    function macClean(s){ return String(s||'').replace(/[_-]+/g,' ').trim(); }
    function macTitleCase(s){ s=macClean(s); return s?s.charAt(0).toUpperCase()+s.slice(1):''; }
    function macAllViews(){ return MAC_WORK_VIEWS.concat(MAC_ROLLUP_VIEWS); }
    function macViewLabel(v){ var a=macAllViews(); for(var i=0;i<a.length;i++){ if(a[i][0]===v) return a[i][1]; } return macTitleCase(v); }
    function macServerView(v){ return v==='cross_dept'?'by_source':v; }
    function macIsGroup(v){ return v==='by_source'||v==='by_owner'||v==='cross_dept'; }
    // Overdue age in whole days from an ISO date.
    function macOverdueAge(d){ if(!d) return 0; var s=String(d).slice(0,10).split('-'); if(s.length!==3) return 0; var due=new Date(+s[0],+s[1]-1,+s[2]); if(isNaN(due.getTime())) return 0; var t=new Date(); var today=new Date(t.getFullYear(),t.getMonth(),t.getDate()); return Math.max(0,Math.round((today-due)/86400000)); }
    // Cross-department source modules (§6/§7 Cross-Department Store Support).
    function macIsCrossDept(k){ var s=String(k||'').toLowerCase(); return /market|mkt|campaign|signage|fundrais|cares|community|donation|cater|vend|treat|party|\bcv\b|cv_|event/.test(s); }

    function macPriPill(p){ if(p==null||p==='') return ''; var k=String(p).toLowerCase(); var c;
        if(k==='critical'||k==='urgent'||k==='p1') c=['#fdeaea','#a01b3e'];
        else if(k==='high') c=['#fff4e0','#9a5b00'];
        else if(k==='medium'||k==='normal'||k==='p2') c=['#eef3fb','#185FA5'];
        else c=['#eef0f3','#5b6472'];
        return '<span style="background:'+c[0]+';color:'+c[1]+';font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;text-transform:capitalize;">'+escapeHtml(String(p))+'</span>'; }
    // Clickable status tile (jumps to a view; critical -> today filtered critical).
    function macStat(label,val,color,go,pri){ return '<button onclick="macTile(\''+go+'\',\''+(pri||'')+'\')" style="flex:1;min-width:84px;background:#fff;border:1px solid #eef0f5;border-radius:10px;padding:8px 10px;text-align:left;cursor:pointer;">'+
        '<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;">'+label+'</div>'+
        '<div style="font-size:18px;font-weight:800;color:'+(color||'#1f2a44')+';">'+macNum(val)+'</div></button>'; }
    function macLoadingHtml(msg){ return '<div style="text-align:center;color:#6b7686;padding:38px;">'+(msg||'Loading&hellip;')+'</div>'; }

    // §11.2 closure requirements by source type (mirrors the seeded closure
    // templates in task_engine_te_a.sql; surfaced read-only so a manager knows
    // what closing will require before they act — §8.1).
    function macClosureProfile(src){ var s=String(src||'').toLowerCase();
        function P(note,photo,cost,verify,appr,label){ return {note:note,photo:photo,cost:cost,verify:verify,appr:appr,label:label}; }
        if(/maint|repair|work.?order|\bwo\b|wo_/.test(s)) return P(1,1,0,1,'','Maintenance repair');
        if(/preventive|\bpm\b|pm_/.test(s))               return P(1,1,0,0,'','Preventive maintenance');
        if(/supply|inventory|shortage|warehouse/.test(s)) return P(1,0,0,0,'','Supply request');
        if(/temp|temperature/.test(s))                    return P(1,1,0,1,'','Temperature discrepancy');
        if(/dsr|daily.?store|close.?out|closeout/.test(s))return P(1,0,0,0,'manager','Daily Store Report review');
        if(/cash|over.?short|over_short|drawer|ring.?out/.test(s)) return P(1,1,0,1,'manager','Cash / over-short');
        if(/attend|call.?in|no.?show/.test(s))            return P(1,0,0,0,'manager','Attendance / call-in');
        if(/discipl|write.?up|warning|\bpip\b|terminat/.test(s)) return P(1,0,0,1,'admin','Disciplinary action');
        if(/employee.?note|emp_note|coaching/.test(s))    return P(1,0,0,0,'manager','Employee note');
        if(/train|sign.?off|signoff|eval|passport|apron/.test(s)) return P(1,0,0,0,'','Training follow-up');
        if(/voice|concern|harass/.test(s))                return P(1,0,0,1,'manager','Your Voice follow-up');
        if(/market|mkt|campaign|signage/.test(s))         return P(1,0,0,0,'','Marketing campaign task');
        if(/fundrais|cares|community|donation/.test(s))   return P(1,0,0,0,'',"Fundraiser / Caliche's Cares");
        if(/cater|vend|treat|party|\bcv\b|cv_|event/.test(s)) return P(1,0,0,0,'','Catering & Vending support');
        if(/ops.?meet|monthly|opm/.test(s))               return P(1,0,0,0,'','Monthly Ops action');
        if(/inspect|insp_/.test(s))                       return P(1,1,0,1,'','Inspection corrective action');
        if(/announce/.test(s))                            return P(0,0,0,0,'','Announcement acknowledgement');
        return P(1,0,0,0,'','Task closure'); }
    // §11.3 / clarifications §4.1 escalation tiers, keyed off priority.
    function macEscalationText(pri){ var k=String(pri||'').toLowerCase();
        if(k==='critical'||k==='urgent'||k==='p1') return 'Critical &mdash; escalates immediately to the Store Manager, the assigned Assistant Manager, and Leadership/Ownership when applicable.';
        if(k==='high') return 'High &mdash; reminder to the Store Manager at the due date; escalates to Leadership about 24 hours after due.';
        if(k==='low') return 'Low &mdash; rolled into the weekly summary digest.';
        return 'Normal &mdash; escalates to the Store Manager about 24 hours after the due date.'; }
    function macWaitingOn(status){ var s=String(status||''); if(s.indexOf('waiting_on_')!==0) return ''; return 'Waiting on '+macClean(s.replace('waiting_on_','')); }

    function openManagerActionCenter(){ if(!macCanSee()){ alert('Managers only.'); return; } _mac.view='today'; _mac.feed=null; _mac.q=''; _mac.pri=''; _mac.src=''; _mac.own=''; _mac.allToday=false; macLoad(); }
    function macLoad(){ macOv().innerHTML=macHeader()+macLoadingHtml('Loading action center&hellip;'); macRpc('app_task_store_health',{p_store:_mac.store||null},function(h){ _mac.health=h||{}; _mac.synced=new Date(); macLoadFeed(); },macErr); }
    function macLoadFeed(){ var filt={}; if(_mac.pri) filt.priority=_mac.pri; if(_mac.src) filt.source_module=_mac.src; if(_mac.own) filt.owner_role=_mac.own;
        macRpc('app_task_feed',{p_store:_mac.store||null,p_view:macServerView(_mac.view),p_filters:filt},function(d){ _mac.feed=d||{}; macRender(); },macErr); }
    function macSetStore(s){ _mac.store=s||''; _mac.feed=null; _mac.src=''; _mac.own=''; macLoad(); }
    function macSetView(v){ _mac.view=v; _mac.feed=null; _mac.allToday=false; _mac.src=''; _mac.own=''; macRender(); macLoadFeed(); }
    function macTile(go,pri){ _mac.view=go; _mac.pri=pri||''; _mac.src=''; _mac.own=''; _mac.feed=null; _mac.allToday=false; macRender(); macLoadFeed(); }
    function macSetPri(p){ _mac.pri=p||''; _mac.feed=null; macLoadFeed(); }
    function macToggleSnap(){ _mac.snapOpen=!_mac.snapOpen; macRender(); }
    function macShowAllToday(){ _mac.allToday=true; var el=document.getElementById('macList'); if(el) el.innerHTML=macListHtml(); }
    // Drill from a group chip: read the key off the element, filter row 'today'.
    function macDrill(el){ if(!el) return; var kind=el.getAttribute('data-kind'), key=el.getAttribute('data-key')||''; _mac.view='today'; _mac.allToday=false; if(kind==='owner'){ _mac.own=key; _mac.src=''; } else { _mac.src=key; _mac.own=''; } _mac.feed=null; macRender(); macLoadFeed(); }
    function macClearDrill(){ _mac.src=''; _mac.own=''; _mac.feed=null; macLoadFeed(); }
    function macErr(e){ var msg=String((e&&e.message)||''); var body;
        if(msg.indexOf('forbidden')>=0) body='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:30px;text-align:center;color:#6b6275;">&#128274; Managers only.</div>';
        else body='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:24px;text-align:center;color:#a01b3e;">'+escapeHtml(msg||'Could not load.')+'</div>';
        macOv().innerHTML=macHeader()+'<div style="max-width:860px;margin:0 auto;padding:16px 16px 50px;">'+body+'</div>'; }

    // ---- one item row (§5.3 action item row fields) ----
    function macCard(it){ it=it||{};
        var overdue=(it.is_overdue===true);
        var accent=overdue?'#a01b3e':((String(it.priority||'').toLowerCase()==='critical')?'#a01b3e':'#185FA5');
        var meta=[];
        if(it.source_module) meta.push(escapeHtml(macTitleCase(it.source_module)));
        if(it.owner_role) meta.push(escapeHtml(String(it.owner_role)));
        if(it.location) meta.push(macEmoji(it.location)+' '+escapeHtml(String(it.location)));
        var wait=macWaitingOn(it.status); if(wait) meta.push('&#8987; '+escapeHtml(wait));
        var age=overdue?macOverdueAge(it.due_date):0;
        var due=it.due_date?('<span style="margin-left:auto;color:'+(overdue?'#a01b3e':'#6b6275')+';font-weight:'+(overdue?'800':'600')+';white-space:nowrap;">'+(overdue?'&#9888; ':'&#128197; ')+escapeHtml(macDate(it.due_date))+(age?(' &middot; '+age+'d overdue'):'')+'</span>'):'';
        var status=it.status?'<span style="background:#eef0f3;color:#5b6472;font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;text-transform:capitalize;">'+escapeHtml(macClean(it.status))+'</span>':'';
        return '<div data-id="'+escapeHtml(String(it.id!=null?it.id:''))+'" onclick="macOpenDetail(this)" style="background:#fff;border:1px solid #ececf2;border-left:4px solid '+accent+';border-radius:12px;padding:12px 14px;margin-bottom:8px;box-shadow:0 2px 6px rgba(0,0,0,.04);cursor:pointer;">'+
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;"><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(String(it.title||'(untitled)'))+'</b>'+macPriPill(it.priority)+'</div>'+
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:#6b6275;">'+status+(meta.length?'<span>'+meta.join(' &middot; ')+'</span>':'')+due+'</div>'+
            '<div style="margin-top:6px;font-size:11px;color:#9aa3b0;">Tap to view details, closure requirements &amp; next action &rarr;</div>'+
            '</div>'; }
    // ---- one group rollup chip (by_source / by_owner / cross_dept) ----
    function macGroupChip(key,count,kind){ var label=(kind==='owner')?(key||'(unassigned)'):macTitleCase(key||'(none)');
        var xd=(kind!=='owner'&&macIsCrossDept(key));
        return '<button data-kind="'+escapeHtml(kind)+'" data-key="'+escapeHtml(String(key||''))+'" onclick="macDrill(this)" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:#fff;border:1px solid #ececf2;border-left:4px solid '+(xd?'#EC3E7E':'#185FA5')+';border-radius:11px;padding:11px 13px;margin-bottom:8px;cursor:pointer;">'+
            '<b style="flex:1;font-size:13.5px;color:#26242b;">'+escapeHtml(label)+(xd?' <span style="background:#fdeaf2;color:#c02063;font-size:9.5px;font-weight:800;padding:1px 7px;border-radius:99px;">cross-dept</span>':'')+'</b>'+
            '<span style="background:#eef3fb;color:#185FA5;font-size:12px;font-weight:800;padding:2px 10px;border-radius:99px;">'+macNum(count)+'</span>'+
            '<span style="color:#9aa3b0;font-size:13px;">&rarr;</span></button>'; }

    // Build ONLY the list body (keeps the search box focused between keystrokes).
    function macListHtml(){ var f=_mac.feed; if(f==null) return macLoadingHtml('Loading '+macViewLabel(_mac.view)+'&hellip;');
        var items=(f&&f.items)||[]; var q=String(_mac.q||'').toLowerCase().trim();
        var scopeTxt=(_mac.store?escapeHtml(_mac.store):'all stores');
        var drillTxt=_mac.src?(' &middot; source: '+escapeHtml(macTitleCase(_mac.src))):(_mac.own?(' &middot; owner: '+escapeHtml(_mac.own)):'');
        // ---- group / cross-department rollup views ----
        if(macIsGroup(_mac.view)){
            var kind=(_mac.view==='by_owner')?'owner':'source';
            var rows=items.slice();
            if(_mac.view==='cross_dept') rows=rows.filter(function(g){ return macIsCrossDept(g.source_module); });
            if(q) rows=rows.filter(function(g){ return String((kind==='owner'?g.owner_role:g.source_module)||'').toLowerCase().indexOf(q)>=0; });
            var head='<div style="font-size:11.5px;color:#6b7686;margin:0 2px 8px;">'+rows.length+' '+(rows.length===1?'group':'groups')+' &middot; '+escapeHtml(macViewLabel(_mac.view))+' &middot; '+scopeTxt+'</div>';
            if(_mac.view==='cross_dept') head+='<div style="font-size:11.5px;color:#6b6275;background:#fdf4f8;border:1px solid #f6d9e7;border-radius:10px;padding:9px 11px;margin-bottom:10px;">Store-relevant Marketing, Fundraiser / Caliche&rsquo;s Cares, Community Relations and Catering &amp; Vending support (§6/§7). Tap a group to see that store&rsquo;s open items.</div>';
            if(!rows.length) return head+'<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:30px;text-align:center;color:#6b6275;">&#9989; No '+(_mac.view==='cross_dept'?'cross-department':'grouped')+' items right now.</div>';
            return head+rows.map(function(g){ return macGroupChip(kind==='owner'?g.owner_role:g.source_module, g.count, kind); }).join('');
        }
        // ---- row views ----
        var rowsR=items.slice();
        if(q) rowsR=rowsR.filter(function(it){ return [it.title,it.source_module,it.owner_role,it.status,it.location].join(' ').toLowerCase().indexOf(q)>=0; });
        var headR='<div style="font-size:11.5px;color:#6b7686;margin:0 2px 8px;">'+rowsR.length+' '+(rowsR.length===1?'item':'items')+' &middot; '+escapeHtml(macViewLabel(_mac.view))+' &middot; '+scopeTxt+drillTxt+'</div>';
        if(_mac.view==='today') headR='<div style="font-size:11.5px;color:#6b6275;margin:0 2px 9px;">Today&rsquo;s Priorities &mdash; the top items needing attention, ordered by criticality, then due date, then owner (§6.1).</div>'+headR;
        if(!rowsR.length) return headR+'<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:34px 18px;text-align:center;color:#6b6275;"><div style="font-size:26px;margin-bottom:6px;">&#9989;</div>No action items need your attention right now.</div>';
        // §6.1 curation: cap Today to the top 8 with a "show all" affordance.
        var extra='';
        if(_mac.view==='today' && !_mac.allToday && rowsR.length>8){ extra='<button onclick="macShowAllToday()" style="width:100%;background:#eef3fb;color:#185FA5;border:1px solid #d6e4f6;border-radius:10px;padding:10px;font-size:12.5px;font-weight:800;cursor:pointer;margin-top:2px;">Show all '+rowsR.length+' open items &darr;</button>'; rowsR=rowsR.slice(0,8); }
        return headR+rowsR.map(macCard).join('')+extra; }

    function macRender(){ var h=_mac.health||{};
        var out='<div style="max-width:860px;margin:0 auto;padding:14px 16px 50px;">';
        // Header meta (§5.2): date · user/role · last sync
        var now=new Date(); var dstr=now.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
        var uname=escapeHtml(String((currentUser&&(currentUser.name||currentUser.username))||'')); var urole=escapeHtml(String((currentUser&&currentUser.role)||''));
        var sync=_mac.synced?('synced '+_mac.synced.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})):'';
        out+='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:#6b7686;margin-bottom:10px;"><span style="font-weight:700;color:#1f2a44;">'+dstr+'</span>'+(uname?'<span>&middot; '+uname+(urole?(' ('+urole+')'):'')+'</span>':'')+(sync?'<span style="margin-left:auto;">'+sync+'</span>':'')+'</div>';
        // Store selector
        var stores=macStores();
        if(stores && stores.length){
            out+='<div style="margin-bottom:10px;"><select onchange="macSetStore(this.value)" style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:13px;background:#fff;box-sizing:border-box;">'+
                '<option value=""'+(_mac.store?'':' selected')+'>All stores</option>'+
                stores.map(function(s){ return '<option value="'+escapeHtml(s)+'"'+(_mac.store===s?' selected':'')+'>'+macEmoji(s)+' '+escapeHtml(s)+'</option>'; }).join('')+
                '</select></div>';
        }
        // Status tiles (§5.2/§10) — clickable jumps to views
        out+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">'+
            macStat('Open',h.open,'#185FA5','today','')+
            macStat('Overdue',h.overdue,'#a01b3e','overdue','')+
            macStat('Needs review',h.needs_review,'#9a5b00','needs_review','')+
            macStat('Critical',h.open_critical,'#a01b3e','today','critical')+
            macStat('Waiting',h.waiting,'#5b6472','waiting','')+
            '</div>';
        // Store Health Snapshot (§10) — live counts + placeholders for pending signals
        out+='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;margin-bottom:12px;overflow:hidden;">'+
            '<button onclick="macToggleSnap()" style="width:100%;display:flex;align-items:center;gap:8px;background:#fff;border:none;padding:11px 13px;cursor:pointer;text-align:left;"><b style="flex:1;font-size:13px;color:#1f2a44;">&#129658; Store Health Snapshot</b><span style="color:#9aa3b0;font-size:12px;">'+(_mac.snapOpen?'Hide':'Show')+' '+(_mac.snapOpen?'&#9650;':'&#9660;')+'</span></button>';
        if(_mac.snapOpen){
            out+='<div style="padding:2px 13px 13px;">'+
                '<div style="font-size:11.5px;color:#6b6275;margin-bottom:8px;">Live task counts for this scope. Sales, labor %, temp compliance and other metrics arrive with the Store Health Scorecard / POS integration (§10, §13.3).</div>'+
                '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">'+
                    macStat('Open',h.open,'#185FA5','today','')+macStat('Overdue',h.overdue,'#a01b3e','overdue','')+
                    macStat('Needs review',h.needs_review,'#9a5b00','needs_review','')+macStat('Critical',h.open_critical,'#a01b3e','today','critical')+
                    macStat('Waiting',h.waiting,'#5b6472','waiting','')+'</div>'+
                '<div style="font-size:10.5px;font-weight:800;text-transform:uppercase;color:#9aa3b0;letter-spacing:.3px;margin:4px 0 6px;">Coming with Scorecard &mdash; break-downs available now in By source</div>'+
                MAC_SNAP_PENDING.map(function(p){ return '<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#6b6275;padding:5px 0;border-top:1px solid #f2f4f8;"><span style="flex:1;"><b style="color:#4a5568;">'+escapeHtml(p[0])+'</b> &middot; '+escapeHtml(p[1])+'</span><span style="color:#c2cad6;font-weight:800;">&mdash;</span></div>'; }).join('')+
                '</div>';
        }
        out+='</div>';
        // Tabs — work queues + organize/rollups (§6 / §13.1)
        function tabBtn(v){ var on=(_mac.view===v[0]); var badge=''; var bc={today:h.open,needs_review:h.needs_review,overdue:h.overdue,waiting:h.waiting}[v[0]];
            if(bc!=null && +bc>0) badge='<span style="background:'+(on?'rgba(255,255,255,.28)':'#dfe6f1')+';color:'+(on?'#fff':'#5b6472')+';font-size:9.5px;font-weight:800;padding:0 6px;border-radius:99px;margin-left:5px;">'+macNum(bc)+'</span>';
            return '<button onclick="macSetView(\''+v[0]+'\')" style="flex:1;min-width:88px;background:'+(on?'#185FA5':'#eef0f3')+';color:'+(on?'#fff':'#5b6472')+';border:none;padding:9px 8px;font-size:12px;font-weight:700;border-radius:9px;cursor:pointer;white-space:nowrap;">'+v[2]+' '+v[1]+badge+'</button>'; }
        out+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">'+MAC_WORK_VIEWS.map(tabBtn).join('')+'</div>';
        out+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:11px;">'+MAC_ROLLUP_VIEWS.map(tabBtn).join('')+'</div>';
        // Filter row (§5.2): priority + search + active drill chip
        out+='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">'+
            '<select onchange="macSetPri(this.value)" style="padding:8px 9px;border:1px solid #d6deea;border-radius:8px;font-size:12.5px;background:#fff;">'+
                ['','critical','high','normal','low'].map(function(p){ return '<option value="'+p+'"'+(_mac.pri===p?' selected':'')+'>'+(p?('Priority: '+macTitleCase(p)):'All priorities')+'</option>'; }).join('')+'</select>'+
            '<input value="'+escapeHtml(_mac.q||'')+'" oninput="macSearch(this.value)" placeholder="Search loaded items&hellip;" style="flex:1;min-width:150px;padding:8px 10px;border:1px solid #d6deea;border-radius:8px;font-size:12.5px;box-sizing:border-box;">'+
            ((_mac.src||_mac.own)?('<button onclick="macClearDrill()" style="background:#fdeaf2;color:#c02063;border:1px solid #f6d9e7;border-radius:99px;padding:6px 11px;font-size:11.5px;font-weight:800;cursor:pointer;">&times; '+escapeHtml(_mac.own?('owner: '+_mac.own):('source: '+macTitleCase(_mac.src)))+'</button>'):'')+
            '</div>';
        // Body list (own container so search re-renders in place)
        out+='<div id="macList">'+macListHtml()+'</div>';
        out+='</div>';
        macOv().innerHTML=macHeader()+out;
    }
    // Search: re-render only the list container (preserves input focus).
    function macSearch(v){ _mac.q=v; var el=document.getElementById('macList'); if(el) el.innerHTML=macListHtml(); }

    // ---- Details drawer (§5.2 / §8.1) — read-rich; surfaces closure + escalation.
    function macDetailClose(){ var o=document.getElementById('macDetailModal'); if(o) o.style.display='none'; }
    function macFindItem(id){ var items=(_mac.feed&&_mac.feed.items)||[]; for(var i=0;i<items.length;i++){ if(String(items[i].id)===String(id)) return items[i]; } return null; }
    function macOpenDetail(el){ if(!el) return; var id=el.getAttribute('data-id'); if(!id) return; var it=macFindItem(id); if(!it) return;
        var o=document.getElementById('macDetailModal'); if(!o){ o=document.createElement('div'); o.id='macDetailModal'; o.style.cssText='position:fixed;inset:0;background:rgba(20,26,40,.45);z-index:100060;overflow:auto;'; document.body.appendChild(o); } o.style.display='block';
        var overdue=(it.is_overdue===true); var age=overdue?macOverdueAge(it.due_date):0;
        var cp=macClosureProfile(it.source_module); var reqs=[];
        if(cp.note) reqs.push('a closure note'); if(cp.photo) reqs.push('a photo / proof upload'); if(cp.cost) reqs.push('cost or invoice'); if(cp.verify) reqs.push('manager verification');
        if(cp.appr==='manager') reqs.push('Store Manager sign-off'); if(cp.appr==='admin') reqs.push('Admin / Leadership approval');
        var reqHtml=reqs.length?('To close <b>'+escapeHtml(cp.label)+'</b> you&rsquo;ll need: '+reqs.join(', ')+'.'):('<b>'+escapeHtml(cp.label)+'</b> has no mandatory proof to close.');
        var wait=macWaitingOn(it.status);
        function row(lbl,val){ return val?('<div style="display:flex;gap:10px;padding:6px 0;border-top:1px solid #f2f4f8;font-size:12.5px;"><span style="width:104px;color:#8a93a3;flex-shrink:0;">'+lbl+'</span><span style="flex:1;color:#2b3242;font-weight:600;">'+val+'</span></div>'):''; }
        var body='<div style="max-width:560px;margin:22px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.28);">'+
            '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:13px 15px;display:flex;align-items:center;gap:10px;"><b style="flex:1;font-size:14.5px;">Item details</b><button onclick="macDetailClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:5px 9px;font-size:14px;cursor:pointer;">&times;</button></div>'+
            '<div style="padding:15px 16px 18px;">'+
            '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:4px;"><b style="flex:1;font-size:16px;color:#20242c;line-height:1.3;">'+escapeHtml(String(it.title||'(untitled)'))+'</b>'+macPriPill(it.priority)+'</div>'+
            (overdue?'<div style="color:#a01b3e;font-size:12px;font-weight:800;margin-bottom:6px;">&#9888; Overdue'+(age?(' by '+age+' day'+(age===1?'':'s')):'')+'</div>':'')+
            row('Source', it.source_module?escapeHtml(macTitleCase(it.source_module)):'&mdash;')+
            row('Status', it.status?escapeHtml(macClean(it.status)):'&mdash;')+
            row('Owner / role', it.owner_role?escapeHtml(String(it.owner_role)):'&mdash;')+
            row('Store', it.location?(macEmoji(it.location)+' '+escapeHtml(String(it.location))):'&mdash;')+
            row('Due', it.due_date?escapeHtml(macDate(it.due_date)):'&mdash;')+
            row('Waiting on', wait?escapeHtml(wait):'')+
            '<div style="margin-top:12px;background:#f4f8fd;border:1px solid #e2ecf8;border-radius:11px;padding:11px 12px;">'+
                '<div style="font-size:10.5px;font-weight:800;text-transform:uppercase;color:#185FA5;letter-spacing:.3px;margin-bottom:4px;">Closure requirements (§11.2)</div>'+
                '<div style="font-size:12.5px;color:#3a4454;line-height:1.5;">'+reqHtml+'</div></div>'+
            '<div style="margin-top:9px;background:#fff8ef;border:1px solid #f4e3c6;border-radius:11px;padding:11px 12px;">'+
                '<div style="font-size:10.5px;font-weight:800;text-transform:uppercase;color:#9a5b00;letter-spacing:.3px;margin-bottom:4px;">Escalation (§11.3)</div>'+
                '<div style="font-size:12.5px;color:#4a4032;line-height:1.5;">'+macEscalationText(it.priority)+'</div></div>'+
            // one live, non-destructive action (§11.3 reminder) + honest note on the rest
            '<div style="margin-top:12px;">'+
                '<button data-id="'+escapeHtml(String(it.id))+'" onclick="macNudge(this)" style="width:100%;background:#185FA5;color:#fff;border:none;border-radius:10px;padding:11px;font-size:13px;font-weight:800;cursor:pointer;">&#128276; Send reminder to owner</button>'+
                '<div id="macDetailMsg" style="font-size:11.5px;text-align:center;margin-top:7px;color:#6b7686;min-height:14px;"></div>'+
                '<div style="font-size:11px;color:#9aa3b0;line-height:1.5;margin-top:4px;">Review, comment, reassign, mark-waiting, approve/recommend, close-with-proof and reopen open here once the Task Engine action RPCs are registered (see build notes). To act now, open the source module record.</div>'+
            '</div>'+
            '</div></div>';
        o.innerHTML=body;
    }
    function macNudge(el){ if(!el) return; var id=el.getAttribute('data-id'); if(!id) return; el.disabled=true; var old=el.innerHTML; el.innerHTML='Sending&hellip;';
        macRpc('app_task_nudge',{p_task_id:(isNaN(+id)?id:+id)}, function(){ var s=document.getElementById('macDetailMsg'); if(s){ s.style.color='#1b7a3d'; s.innerHTML='&#10003; Reminder sent to the owner.'; } el.innerHTML='&#10003; Reminder sent'; },
            function(){ var s=document.getElementById('macDetailMsg'); if(s){ s.style.color='#a01b3e'; s.innerHTML='Could not send a reminder for this item.'; } el.disabled=false; el.innerHTML=old; }); }

    // Entry point exposed on window (matches js/27 openMarketingHub convention).
    window.openManagerActionCenter = openManagerActionCenter;
