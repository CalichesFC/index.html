    // ============================================================
    // STORE & SITE INSPECTION (js/20) — leadership brand-standards tool
    // Scored walk-through (1-5 + N/A per line, sections come from the
    // ADMIN-EDITABLE template served by insp_config_get / snapshotted
    // per inspection), severity + required photo evidence (enforced
    // server-side at submit), corrective actions auto-routed via
    // app_task_create (store-targeted), leadership dashboard.
    // Entry point: openSiteInspection(). Overlay id: siteInspectionModal.
    //
    // SERVER SHAPE CONTRACT (insp_get/insp_start/insp_section_save/
    // insp_submit all return ONE jsonb read exactly as):
    //   top-level header fields (id, location, status, overall_pct,
    //   critical_count, followup_recommended, top_strengths, ...)
    //   + data.sections[] = {key,label,section_comment,pct,items[]}
    //     items[] = {key,label,line_id,score,na,severity,note,
    //                no_photo_reason,photos[]}
    //   + data.actions[] (insp_action rows) + data.answered + data.total_items
    // insp_list returns an ARRAY; insp_dashboard returns
    //   {locations[],criticals[],repeat_issues[],section_avgs[],summary{}}.
    // Section saves send the BULK payload:
    //   {section_comment:'', items:{ '<item_key>':{score,na,note,no_photo_reason} }}
    // ============================================================

    var _insp = { view:'landing', list:[], filters:{ location:'', status:'', type:'' }, cfg:null, cur:null, open:{}, picks:{}, dash:null, blockers:null };

    var INSP_SCORE_META = { 5:['5','Excellent','#1f7a3d'], 4:['4','Good','#4c9a2a'], 3:['3','Needs improvement','#9a5b00'], 2:['2','Poor — action required','#c05a00'], 1:['1','CRITICAL','#c0264b'] };
    var INSP_SEV_COLORS = { critical:'#c0264b', poor:'#c05a00', attention:'#9a5b00', ok:'#1f7a3d' };
    var INSP_ACTION_KINDS = [['task','Manager task'],['maintenance','Maintenance WO'],['supply','Supply request'],['coaching','Coaching'],['safety','Safety (urgent)'],['vendor','Vendor'],['it','IT / POS'],['signage','Signage / brand']];

    // ---- RPC wrapper (mirrors scRpc / dsrRpc) ----
    function inspRpc(name,args,cb,onerr){
        withPin(function(pin){
            supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){
                if(r.error){ if(onerr) onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; }
                cb(r.data);
            }).catch(function(){ if(onerr) onerr({message:'Connection error'}); else alert('Connection error.'); });
        });
    }

    // ---- overlay shell (cloned from js/08 tdOverlay/tdHeader) ----
    function inspOverlay(){ var ov=document.getElementById('siteInspectionModal'); if(!ov){ ov=document.createElement('div'); ov.id='siteInspectionModal'; ov.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100000;overflow:auto;'; document.body.appendChild(ov); } ov.style.display='block'; return ov; }
    function inspClose(){ var ov=document.getElementById('siteInspectionModal'); if(ov) ov.style.display='none'; }
    function inspHeader(title,back){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;">'+(back?('<button onclick="'+back+'" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;">&#8249; Back</button>'):'')+'<b style="flex:1;font-size:16px;">&#128269; '+escapeHtml(title||'')+'</b><button onclick="inspClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }

    // ---- small render helpers ----
    function inspCard(inner,title){ return '<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,.04);">'+(title?('<div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#5b6675;margin-bottom:10px;letter-spacing:.3px;">'+escapeHtml(title)+'</div>'):'')+inner+'</div>'; }
    function inspBtn(label,onclick,kind){ var bg=kind==='primary'?'#1f7a3d':(kind==='danger'?'#c0264b':'#185FA5'); return '<button onclick="'+onclick+'" style="background:'+bg+';color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:700;cursor:pointer;margin-top:4px;">'+label+'</button>'; }
    function inspEmpty(msg){ return '<div style="text-align:center;color:#6b7686;padding:26px 14px;font-size:13px;">'+escapeHtml(msg)+'</div>'; }
    function inspIn(id,label,val,type){ type=type||'text'; return '<div style="margin-bottom:9px;"><label style="display:block;font-size:11px;font-weight:700;color:#5b6675;margin-bottom:3px;">'+escapeHtml(label)+'</label><input id="'+id+'" type="'+type+'" value="'+escapeHtml(val==null?'':String(val))+'" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;"></div>'; }
    function inspTA(id,label,val,rows){ return '<div style="margin-bottom:9px;">'+(label?('<label style="display:block;font-size:11px;font-weight:700;color:#5b6675;margin-bottom:3px;">'+escapeHtml(label)+'</label>'):'')+'<textarea id="'+id+'" rows="'+(rows||3)+'" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;font-family:inherit;">'+escapeHtml(val||'')+'</textarea></div>'; }
    function inspVal(id){ var e=document.getElementById(id); return e?e.value:''; }
    function inspChk(id){ var e=document.getElementById(id); return !!(e&&e.checked); }
    function inspK(k){ return String(k==null?'':k).replace(/[^A-Za-z0-9_-]/g,''); }
    function inspTodayIso(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
    function inspPct(v,color){ if(v==null) return '<span style="color:#8a91a0;">—</span>'; var c=color||(v>=90?'#1f7a3d':(v>=80?'#4c9a2a':(v>=70?'#9a5b00':'#c0264b'))); return '<span style="color:'+c+';font-weight:800;">'+parseFloat(v).toFixed(1)+'%</span>'; }
    function inspBadge(status){ var c=status==='submitted'?'#1f7a3d':'#9a5b00'; var t=status==='submitted'?'Submitted':'Draft'; return '<span style="background:'+c+';color:#fff;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:800;">'+t+'</span>'; }
    function inspSevChip(sev){ if(!sev||sev==='ok') return ''; var c=INSP_SEV_COLORS[sev]||'#5b6675'; return '<span style="background:'+c+';color:#fff;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:800;text-transform:uppercase;margin-left:6px;">'+escapeHtml(sev)+'</span>'; }
    function inspTile(label,val,color){ return '<div style="flex:1;min-width:110px;background:#fafbfd;border:1px solid #eef0f5;border-radius:10px;padding:9px 11px;"><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#5b6675;">'+escapeHtml(label)+'</div><div style="font-size:16px;font-weight:800;color:'+(color||'#1f2a44')+';">'+val+'</div></div>'; }
    function inspStores(){ return (typeof HUB_STORES!=='undefined'&&HUB_STORES&&HUB_STORES.length)?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell']; }
    function inspIsMgr(){ try{ return !!(currentUser && ((typeof isManagerRole==='function'&&isManagerRole()) || (typeof isAdminManager==='function'&&isAdminManager()) || (typeof isDiscAdmin==='function'&&isDiscAdmin()))); }catch(e){ return false; } }
    function inspCfgNum(key,fb){ var c=_insp.cfg||{}; var v=parseFloat(c[key]); return isNaN(v)?fb:v; }

    // ============================================================
    // ENTRY + LANDING
    // ============================================================
    function openSiteInspection(){
        if(!inspIsMgr()){ alert('Store & Site Inspection is a leadership tool. Managers only.'); return; }
        _insp.view='landing';
        var ov=inspOverlay();
        ov.innerHTML=inspHeader('Store & Site Inspection','')+'<div style="max-width:860px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading&hellip;</div>';
        if(_insp.cfg){ inspLoadList(); return; }
        inspRpc('insp_config_get',{},function(cfg){ _insp.cfg=cfg||{}; inspLoadList(); },function(err){
            ov.innerHTML=inspHeader('Store & Site Inspection','')+'<div style="max-width:860px;margin:0 auto;padding:30px 16px;color:#c0264b;text-align:center;">'+escapeHtml((err&&err.message)||'Could not load inspection config.')+'</div>';
        });
    }

    function inspLoadList(){
        var ov=inspOverlay();
        var f=_insp.filters;
        var filters={}; if(f.location) filters.location=f.location; if(f.status) filters.status=f.status; if(f.type) filters.insp_type=f.type;
        inspRpc('insp_list',{p_filters:filters},function(d){ _insp.list=d||[]; inspRenderLanding(); },function(err){
            ov.innerHTML=inspHeader('Store & Site Inspection','')+'<div style="max-width:860px;margin:0 auto;padding:30px 16px;color:#c0264b;text-align:center;">'+escapeHtml((err&&err.message)||'Could not load inspections.')+'</div>';
        });
    }

    function inspRenderLanding(){
        var ov=inspOverlay(); var rows=_insp.list||[]; var f=_insp.filters; var cfg=_insp.cfg||{};
        var types=(cfg.types||[]);
        var h=inspHeader('Store & Site Inspection','');
        h+='<div style="max-width:860px;margin:0 auto;padding:14px 16px 60px;">';
        h+='<p style="font-size:12.5px;color:#6b7686;margin-top:0;">Leadership walk-through: score every area, photo-document issues, and route corrective tasks automatically. Not a daily checklist &mdash; a brand-protection tool.</p>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">';
        h+=inspBtn('Start inspection','inspStartForm()','primary');
        h+=inspBtn('Leadership dashboard','inspOpenDash()');
        h+=inspBtn('Refresh','inspLoadList()');
        h+='</div>';
        h+='<div style="background:#fff;border:1px solid #e6ebf2;border-radius:12px;padding:10px 12px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">';
        h+='<select onchange="_insp.filters.location=this.value; inspLoadList();" style="padding:7px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;"><option value="">All locations</option>'+inspStores().map(function(s){return '<option value="'+escapeHtml(s)+'"'+(f.location===s?' selected':'')+'>'+escapeHtml(s)+'</option>';}).join('')+'</select>';
        h+='<select onchange="_insp.filters.status=this.value; inspLoadList();" style="padding:7px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;"><option value="">Any status</option><option value="draft"'+(f.status==='draft'?' selected':'')+'>Draft</option><option value="submitted"'+(f.status==='submitted'?' selected':'')+'>Submitted</option></select>';
        h+='<select onchange="_insp.filters.type=this.value; inspLoadList();" style="padding:7px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;"><option value="">Any type</option>'+types.map(function(t){return '<option value="'+escapeHtml(t)+'"'+(f.type===t?' selected':'')+'>'+escapeHtml(t)+'</option>';}).join('')+'</select>';
        if(f.location||f.status||f.type) h+=inspBtn('Clear','_insp.filters={location:\'\',status:\'\',type:\'\'}; inspLoadList();');
        h+='</div>';
        if(!rows.length){ h+=inspEmpty('No inspections yet. Tap "Start inspection" to walk your first site.'); }
        else{
            rows.forEach(function(r){
                var emoji=(typeof HUB_STORE_EMOJI!=='undefined'&&HUB_STORE_EMOJI&&HUB_STORE_EMOJI[r.location])?HUB_STORE_EMOJI[r.location]+' ':'';
                var inner='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;cursor:pointer;" onclick="inspOpen('+r.id+')">'
                    +'<div style="flex:1;min-width:180px;"><b style="font-size:14px;">'+emoji+escapeHtml(r.location)+'</b>'
                    +'<div style="font-size:11.5px;color:#6b7686;">'+escapeHtml(r.insp_type||'')+' &middot; '+escapeHtml(String(r.started_at||'').slice(0,10))+' &middot; '+escapeHtml(r.inspector_name||'')+(r.announced==='unannounced'?' &middot; Unannounced':'')+'</div></div>'
                    +'<div style="text-align:right;">'+inspBadge(r.status)+'<div style="font-size:13px;margin-top:4px;">'+inspPct(r.overall_pct)
                    +(r.critical_count?(' <span style="color:#c0264b;font-weight:800;font-size:11px;">&#9888; '+r.critical_count+' critical</span>'):'')
                    +(r.open_actions?(' <span style="color:#9a5b00;font-weight:700;font-size:11px;">'+r.open_actions+' open action'+(r.open_actions>1?'s':'')+'</span>'):'')
                    +'</div></div></div>';
                h+=inspCard(inner);
            });
        }
        h+='</div>';
        ov.innerHTML=h;
    }

    // ============================================================
    // START FORM
    // ============================================================
    function inspStartForm(){
        var ov=inspOverlay(); var cfg=_insp.cfg||{};
        var h=inspHeader('New inspection','inspLoadList()');
        h+='<div style="max-width:640px;margin:0 auto;padding:14px 16px 60px;">';
        var inner='<div style="margin-bottom:9px;"><label style="display:block;font-size:11px;font-weight:700;color:#5b6675;margin-bottom:3px;">Location</label><select id="inspS_loc" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;">'+inspStores().map(function(s){return '<option value="'+escapeHtml(s)+'">'+escapeHtml(s)+'</option>';}).join('')+'</select></div>';
        inner+='<div style="margin-bottom:9px;"><label style="display:block;font-size:11px;font-weight:700;color:#5b6675;margin-bottom:3px;">Site type</label><select id="inspS_site" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;">'+(cfg.site_types||['Store']).map(function(s){return '<option value="'+escapeHtml(s)+'">'+escapeHtml(s)+'</option>';}).join('')+'</select></div>';
        inner+='<div style="margin-bottom:9px;"><label style="display:block;font-size:11px;font-weight:700;color:#5b6675;margin-bottom:3px;">Inspection type</label><select id="inspS_type" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;">'+(cfg.types||['Quarterly Full']).map(function(s){return '<option value="'+escapeHtml(s)+'">'+escapeHtml(s)+'</option>';}).join('')+'</select></div>';
        inner+=inspIn('inspS_mod','Manager on duty','');
        inner+='<div style="margin-bottom:9px;"><label style="display:block;font-size:11px;font-weight:700;color:#5b6675;margin-bottom:3px;">Visit</label><select id="inspS_ann" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;"><option value="scheduled">Scheduled</option><option value="unannounced">Unannounced</option></select></div>';
        inner+=inspIn('inspS_wx','Weather / unusual conditions (optional)','');
        inner+=inspBtn('Begin walk-through','inspStartGo()','primary');
        h+=inspCard(inner,'Inspection information')+'</div>';
        ov.innerHTML=h;
    }
    function inspStartGo(){
        inspRpc('insp_start',{ p_location:inspVal('inspS_loc'), p_site_type:inspVal('inspS_site'), p_insp_type:inspVal('inspS_type'), p_manager_on_duty:inspVal('inspS_mod'), p_announced:inspVal('inspS_ann'), p_weather:inspVal('inspS_wx') },function(d){
            _insp.cur=d; _insp.picks={}; _insp.open={}; _insp.blockers=null;
            var secs=(d&&d.sections)||[]; if(secs.length) _insp.open[secs[0].key]=true;
            inspRenderRun();
        });
    }

    // ============================================================
    // OPEN / RUN VIEW (draft walk-through)
    // ============================================================
    function inspOpen(id){
        var ov=inspOverlay();
        ov.innerHTML=inspHeader('Inspection','inspLoadList()')+'<div style="max-width:860px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading&hellip;</div>';
        inspRpc('insp_get',{p_id:id},function(d){
            _insp.cur=d; _insp.picks={}; _insp.blockers=null;
            if(d.status==='draft'){ inspRenderRun(); } else { inspRenderDetail(); }
        });
    }

    function inspItemState(it){
        var p=_insp.picks[it.key];
        if(p) return { score:p.na?null:p.score, na:!!p.na };
        return { score:(it.score==null?null:it.score), na:!!it.na };
    }
    function inspSectionStats(sec){
        var answered=0, scored=0, sum=0, total=(sec.items||[]).length;
        (sec.items||[]).forEach(function(it){ var st=inspItemState(it); if(st.na||st.score!=null) answered++; if(!st.na&&st.score!=null){ scored++; sum+=st.score; } });
        return { answered:answered, total:total, pct:(scored?Math.round(1000*sum/(5*scored))/10:null) };
    }

    function inspRenderRun(){
        var ov=inspOverlay(); var d=_insp.cur||{}; var secs=d.sections||[];
        var evid=inspCfgNum('evidence_min_score',2);
        var done=0; secs.forEach(function(s){ var st=inspSectionStats(s); if(st.total&&st.answered>=st.total) done++; });
        var h=inspHeader(d.location+' — '+(d.insp_type||'Inspection'),'inspLoadList()');
        h+='<div style="max-width:860px;margin:0 auto;padding:14px 16px 60px;">';
        h+='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">'
            +inspBadge(d.status)
            +'<span style="font-size:12.5px;color:#5b6675;font-weight:700;">'+done+' of '+secs.length+' sections complete</span>'
            +'<span style="font-size:12.5px;">Live score: <span id="inspLiveOverall">'+inspPct(d.overall_pct)+'</span></span>'
            +'<span style="flex:1;"></span>'
            +inspBtn('Review &amp; submit','inspRenderReview()','primary')
            +'</div>';
        h+='<div style="height:7px;background:#e6e9f0;border-radius:99px;margin-bottom:14px;overflow:hidden;"><div style="height:100%;width:'+(secs.length?Math.round(100*done/secs.length):0)+'%;background:linear-gradient(90deg,#185FA5,#1f7a3d);border-radius:99px;"></div></div>';
        h+='<p style="font-size:11.5px;color:#8a91a0;margin:0 0 10px;">Score each line 1&ndash;5 (or N/A). Lines scored '+evid+' or below need a note and a photo (or a reason a photo isn\'t possible). Save each section as you go &mdash; you can leave and resume anytime.</p>';
        secs.forEach(function(sec){ h+=inspSectionHtml(sec,evid); });
        h+='<div style="text-align:center;margin-top:8px;">'+inspBtn('Review &amp; submit','inspRenderReview()','primary')+'</div>';
        h+='</div>';
        ov.innerHTML=h;
    }

    function inspSectionHtml(sec,evid){
        var sk=inspK(sec.key); var isOpen=!!_insp.open[sec.key]; var st=inspSectionStats(sec);
        var head='<div onclick="inspToggleSec(\''+sk+'\')" style="display:flex;align-items:center;gap:8px;cursor:pointer;">'
            +'<b style="flex:1;font-size:13.5px;">'+escapeHtml(sec.label||sec.key)+'</b>'
            +'<span id="inspSecPct_'+sk+'" style="font-size:12px;font-weight:800;">'+(st.pct!=null?inspPct(st.pct):'<span style="color:#8a91a0;">—</span>')+'</span>'
            +'<span id="inspSecCnt_'+sk+'" style="font-size:11px;color:#6b7686;">'+st.answered+'/'+st.total+'</span>'
            +'<span style="font-size:13px;color:#5b6675;">'+(isOpen?'&#9650;':'&#9660;')+'</span></div>';
        var body='';
        if(isOpen){
            body+='<div style="margin-top:10px;">';
            (sec.items||[]).forEach(function(it){ body+=inspItemHtml(sec,it,evid); });
            body+=inspTA('inspC_'+sk,'Section comments (optional)',sec.section_comment,2);
            body+=inspBtn('Save section','inspSaveSection(\''+sk+'\')','primary');
            body+='</div>';
        }
        return inspCard(head+body);
    }
    function inspToggleSec(sk){ var d=_insp.cur||{}; (d.sections||[]).forEach(function(s){ if(inspK(s.key)===sk) _insp.open[s.key]=!_insp.open[s.key]; }); inspRenderRun(); }

    function inspItemHtml(sec,it,evid){
        var k=inspK(it.key); var st=inspItemState(it);
        var h='<div style="border-top:1px solid #f0f1f6;padding:10px 0 6px;">';
        h+='<div style="font-size:12.5px;color:#1f2a44;margin-bottom:6px;">'+escapeHtml(it.label||it.key)+'<span id="inspSev_'+k+'">'+inspSevChip(inspSevOf(st,evid))+'</span></div>';
        h+='<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px;">';
        [5,4,3,2,1].forEach(function(n){
            var m=INSP_SCORE_META[n]; var on=(!st.na&&st.score===n);
            h+='<button id="inspSB_'+k+'_'+n+'" onclick="inspPick(\''+inspK(sec.key)+'\',\''+k+'\','+n+',false)" title="'+escapeHtml(m[1])+'" style="min-width:38px;padding:7px 0;border-radius:8px;border:1.5px solid '+m[2]+';font-weight:800;font-size:13px;cursor:pointer;background:'+(on?m[2]:'#fff')+';color:'+(on?'#fff':m[2])+';">'+m[0]+'</button>';
        });
        var naOn=st.na;
        h+='<button id="inspSB_'+k+'_na" onclick="inspPick(\''+inspK(sec.key)+'\',\''+k+'\',null,true)" style="min-width:44px;padding:7px 8px;border-radius:8px;border:1.5px solid #8a91a0;font-weight:800;font-size:12px;cursor:pointer;background:'+(naOn?'#8a91a0':'#fff')+';color:'+(naOn?'#fff':'#8a91a0')+';">N/A</button>';
        h+='</div>';
        h+='<textarea id="inspN_'+k+'" rows="2" placeholder="Notes (required for scores of '+evid+' or below)" style="width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #dde3ec;border-radius:8px;font-size:12.5px;font-family:inherit;">'+escapeHtml(it.note||'')+'</textarea>';
        var photos=it.photos||[];
        h+='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;">';
        photos.forEach(function(p){ h+='<a href="'+escapeHtml(p.url||'')+'" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;padding:5px 9px;background:#fafbfd;border:1px solid #eef0f5;border-radius:8px;text-decoration:none;color:#185FA5;font-size:11px;font-weight:700;">&#128247; '+escapeHtml(p.caption||'photo')+'</a>'; });
        h+='<button onclick="inspAddPhoto(\''+k+'\')" style="background:#fff;border:1.5px dashed #185FA5;color:#185FA5;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;">&#128247; Add photo</button>';
        h+='<span id="inspReq_'+k+'" style="font-size:10.5px;font-weight:800;color:#c0264b;'+(inspNeedsPhoto(st,it,evid)?'':'display:none;')+'">&#9888; Photo or reason required</span>';
        h+='</div>';
        h+='<input id="inspR_'+k+'" type="text" placeholder="If no photo possible: why?" value="'+escapeHtml(it.no_photo_reason||'')+'" style="width:100%;box-sizing:border-box;margin-top:6px;padding:6px 9px;border:1px solid #eee3d2;border-radius:8px;font-size:11.5px;'+(inspEvidNeeded(st,evid)?'':'display:none;')+'">';
        h+='<div id="inspMsg_'+k+'" style="font-size:11px;color:#6b7686;"></div>';
        h+='</div>';
        return h;
    }
    function inspSevOf(st,evid){ if(st.na||st.score==null) return null; var crit=inspCfgNum('critical_score',1); return st.score<=crit?'critical':(st.score<=evid?'poor':(st.score===3?'attention':'ok')); }
    function inspEvidNeeded(st,evid){ return !st.na && st.score!=null && st.score<=evid; }
    function inspNeedsPhoto(st,it,evid){ return inspEvidNeeded(st,evid) && !((it.photos||[]).length) && !(it.no_photo_reason); }

    function inspPick(sk,k,score,na){
        var d=_insp.cur||{}; var sec=null,item=null;
        (d.sections||[]).forEach(function(s){ if(inspK(s.key)===sk){ sec=s; (s.items||[]).forEach(function(it){ if(inspK(it.key)===k) item=it; }); } });
        if(!sec||!item) return;
        _insp.picks[item.key]={ score:score, na:!!na };
        var st=inspItemState(item); var evid=inspCfgNum('evidence_min_score',2);
        [5,4,3,2,1].forEach(function(n){ var b=document.getElementById('inspSB_'+k+'_'+n); if(b){ var m=INSP_SCORE_META[n]; var on=(!st.na&&st.score===n); b.style.background=on?m[2]:'#fff'; b.style.color=on?'#fff':m[2]; } });
        var nb=document.getElementById('inspSB_'+k+'_na'); if(nb){ nb.style.background=st.na?'#8a91a0':'#fff'; nb.style.color=st.na?'#fff':'#8a91a0'; }
        var sev=document.getElementById('inspSev_'+k); if(sev) sev.innerHTML=inspSevChip(inspSevOf(st,evid));
        var req=document.getElementById('inspReq_'+k); if(req) req.style.display=inspNeedsPhoto(st,item,evid)?'':'none';
        var rr=document.getElementById('inspR_'+k); if(rr) rr.style.display=inspEvidNeeded(st,evid)?'':'none';
        var stats=inspSectionStats(sec);
        var pctEl=document.getElementById('inspSecPct_'+sk); if(pctEl) pctEl.innerHTML=(stats.pct!=null?inspPct(stats.pct):'<span style="color:#8a91a0;">—</span>');
        var cntEl=document.getElementById('inspSecCnt_'+sk); if(cntEl) cntEl.textContent=stats.answered+'/'+stats.total;
    }

    function inspSaveSection(sk){
        var d=_insp.cur||{}; var sec=null;
        (d.sections||[]).forEach(function(s){ if(inspK(s.key)===sk) sec=s; });
        if(!sec) return;
        var items={};
        (sec.items||[]).forEach(function(it){
            var k=inspK(it.key); var st=inspItemState(it);
            items[it.key]={ score:(st.na?null:st.score), na:!!st.na, note:inspVal('inspN_'+k), no_photo_reason:inspVal('inspR_'+k) };
        });
        var payload={ section_comment:inspVal('inspC_'+sk), items:items };
        inspRpc('insp_section_save',{p_id:d.id,p_section:sec.key,p_payload:payload},function(nd){
            (sec.items||[]).forEach(function(it){ delete _insp.picks[it.key]; });
            _insp.cur=nd; inspRenderRun();
        });
    }

    // ---- photo evidence: material-upload edge fn -> training-materials bucket
    // (pattern cloned from js/18 dsrUploadAttachment) ----
    function inspAddPhoto(k){
        var d=_insp.cur||{}; var itemKey=null;
        (d.sections||[]).forEach(function(s){ (s.items||[]).forEach(function(it){ if(inspK(it.key)===k) itemKey=it.key; }); });
        if(!itemKey||!d.id) return;
        var inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.capture='environment';
        inp.onchange=function(){
            var f=inp.files&&inp.files[0]; if(!f) return;
            var msg=document.getElementById('inspMsg_'+k);
            function say(t){ if(msg) msg.textContent=t; }
            say('Preparing upload…');
            withPin(function(pin){
                supabaseClient.functions.invoke('material-upload',{body:{username:currentUser.username,pin:pin,filename:f.name,contentType:f.type||'application/octet-stream'}}).then(function(res){
                    var err=(res&&res.error)?res.error.message:((res&&res.data&&res.data.error)?res.data.error:null);
                    if(err){ say(''); alert('Upload failed: '+(String(err).indexOf('forbidden')>=0?'managers only':err)); return; }
                    var dd=res&&res.data;
                    if(!dd||!dd.token){ say(''); alert('Upload could not start.'); return; }
                    say('Uploading '+f.name+'…');
                    supabaseClient.storage.from('training-materials').uploadToSignedUrl(dd.path,dd.token,f,{contentType:f.type||undefined}).then(function(up){
                        if(up.error){ say(''); alert('Upload failed: '+up.error.message); return; }
                        var pub=(supabaseClient.storage.from('training-materials').getPublicUrl(dd.path)||{}).data||{};
                        var url=dd.publicUrl||dd.url||pub.publicUrl||dd.path;
                        inspRpc('insp_photo_add',{p_id:d.id,p_item_key:itemKey,p_url:url,p_caption:f.name},function(nd){
                            say(''); _insp.cur=nd;
                            if((_insp.cur||{}).status==='draft') inspRenderRun(); else inspRenderDetail();
                        });
                    }).catch(function(){ say(''); alert('Upload failed.'); });
                }).catch(function(){ say(''); alert('Upload failed.'); });
            });
        };
        inp.click();
    }

    // ============================================================
    // REVIEW & SUBMIT
    // ============================================================
    function inspRenderReview(){
        var ov=inspOverlay(); var d=_insp.cur||{}; var evid=inspCfgNum('evidence_min_score',2);
        var h=inspHeader('Review & submit — '+d.location,'inspRenderRun()');
        h+='<div style="max-width:860px;margin:0 auto;padding:14px 16px 60px;">';
        h+='<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">'
            +inspTile('Overall score',inspPct(d.overall_pct))
            +inspTile('Answered',(d.answered||0)+' / '+(d.total_items||0))
            +inspTile('Critical items',String(d.critical_count||0),(d.critical_count?'#c0264b':'#1f7a3d'))
            +inspTile('Actions',String((d.actions||[]).length))
            +'</div>';
        if(_insp.blockers&&_insp.blockers.length){
            var bl='<ul style="margin:0;padding-left:18px;font-size:12px;color:#c0264b;">';
            _insp.blockers.forEach(function(b){ bl+='<li><b>'+escapeHtml(String(b.code||'').replace(/_/g,' '))+'</b> — '+escapeHtml(b.label||b.item_key||'')+'</li>'; });
            bl+='</ul>';
            h+=inspCard(bl,'Fix before submitting ('+_insp.blockers.length+')');
        }
        // flagged lines (score <= evidence threshold) + routing
        var flagged=[];
        (d.sections||[]).forEach(function(s){ (s.items||[]).forEach(function(it){ if(!it.na&&it.score!=null&&it.score<=evid) flagged.push({sec:s,it:it}); }); });
        var fb='';
        if(!flagged.length) fb=inspEmpty('No low or critical items. Great walk!');
        else flagged.forEach(function(f){
            var it=f.it;
            fb+='<div style="border-top:1px solid #f0f1f6;padding:9px 0;">'
                +'<div style="font-size:12.5px;"><b>'+escapeHtml(it.label||it.key)+'</b>'+inspSevChip(it.severity)+'</div>'
                +'<div style="font-size:11.5px;color:#6b7686;margin:3px 0;">'+escapeHtml(f.sec.label||'')+' &middot; Score '+it.score+(it.note?(' &middot; '+escapeHtml(it.note)):'')+((it.photos||[]).length?(' &middot; '+(it.photos||[]).length+' photo(s)'):'')+'</div>'
                +'<div style="display:flex;gap:6px;flex-wrap:wrap;">';
            INSP_ACTION_KINDS.slice(0,3).forEach(function(kk){ fb+='<button onclick="inspCreateAction('+(it.line_id||'null')+',\''+kk[0]+'\')" style="background:#fff;border:1px solid #185FA5;color:#185FA5;border-radius:8px;padding:4px 9px;font-size:11px;font-weight:700;cursor:pointer;">+ '+kk[1]+'</button>'; });
            fb+='<select onchange="if(this.value){inspCreateAction('+(it.line_id||'null')+',this.value); this.value=\'\';}" style="padding:4px 6px;border:1px solid #cdd5e0;border-radius:8px;font-size:11px;"><option value="">More&hellip;</option>';
            INSP_ACTION_KINDS.slice(3).forEach(function(kk){ fb+='<option value="'+kk[0]+'">'+kk[1]+'</option>'; });
            fb+='</select></div></div>';
        });
        h+=inspCard(fb,'Flagged items (score '+evid+' or below) — route corrective actions');
        h+='<p style="font-size:11px;color:#8a91a0;margin:0 0 10px;">On submit, any flagged line WITHOUT an action gets an auto-routed corrective task to '+escapeHtml(d.location||'the store')+' (server-side). Critical findings notify leadership immediately.</p>';
        h+=inspCard(inspActionsHtml(d),'Corrective actions ('+(d.actions||[]).length+')');
        var sm='';
        sm+=inspTA('inspSum_str','Top 3 strengths',d.top_strengths);
        sm+=inspTA('inspSum_iss','Top 3 issues',d.top_issues);
        sm+=inspTA('inspSum_urg','Urgent / critical notes',d.urgent_notes,2);
        sm+=inspTA('inspSum_mnt','Maintenance needs',d.maint_notes,2);
        sm+=inspTA('inspSum_sup','Supply / replacement needs',d.supply_notes,2);
        sm+='<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:9px;font-size:12.5px;">'
            +'<label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="inspSum_mgrfu"'+(d.mgr_followup?' checked':'')+'> Manager follow-up needed</label>'
            +'<label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="inspSum_fu"'+(d.followup_recommended?' checked':'')+'> Follow-up inspection needed</label>'
            +'</div>';
        sm+=inspIn('inspSum_fudate','Recommended follow-up date',d.followup_date||'','date');
        sm+=inspIn('inspSum_mgrnote','Manager follow-up note',d.mgr_followup_note||'');
        sm+='<div style="margin-bottom:9px;"><label style="display:block;font-size:11px;font-weight:700;color:#5b6675;margin-bottom:3px;">Overall store pride score (1-5)</label><select id="inspSum_pride" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;"><option value="">—</option>'+[5,4,3,2,1].map(function(n){return '<option value="'+n+'"'+(d.pride_score===n?' selected':'')+'>'+n+' — '+INSP_SCORE_META[n][1]+'</option>';}).join('')+'</select></div>';
        sm+=inspIn('inspSum_pridec','Pride score comments',d.pride_comment||'');
        sm+=inspTA('inspSum_fin','Final inspector notes',d.final_notes);
        sm+=inspBtn('Save summary','inspSaveSummary()');
        h+=inspCard(sm,'Final inspection summary');
        h+='<div style="text-align:center;margin-top:6px;">'+inspBtn('Check readiness','inspCheck()')+' '+inspBtn('Submit inspection','inspSubmit()','primary')+'</div>';
        h+='</div>';
        ov.innerHTML=h;
    }

    function inspActionsHtml(d){
        var acts=d.actions||[];
        if(!acts.length) return inspEmpty('No corrective actions yet.');
        var h='';
        acts.forEach(function(a){
            var sc=a.status==='done'?'#1f7a3d':(a.status==='pending_manual'?'#c0264b':(a.status==='cancelled'?'#8a91a0':'#9a5b00'));
            h+='<div style="border-top:1px solid #f0f1f6;padding:8px 0;font-size:12px;">'
                +'<b>'+escapeHtml(a.title||a.kind)+'</b>'+inspSevChip(a.severity)
                +' <span style="background:'+sc+';color:#fff;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:800;">'+escapeHtml(a.status)+'</span>'
                +'<div style="color:#6b7686;margin-top:2px;">'+escapeHtml(a.kind)+(a.target_table?(' &rarr; '+escapeHtml(a.target_table)+' #'+escapeHtml(String(a.target_id||''))):'')+(a.due_date?(' &middot; due '+escapeHtml(String(a.due_date))):'')+(a.owner_name?(' &middot; '+escapeHtml(a.owner_name)):'')+(a.auto_created?' &middot; auto':'')+'</div>'
                +(a.notes?('<div style="color:#5b6675;margin-top:2px;">'+escapeHtml(a.notes)+'</div>'):'')
                +((d.status==='submitted'&&a.status!=='done'&&a.status!=='cancelled')?('<div style="margin-top:4px;"><button onclick="inspActionDone('+a.id+')" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;">Mark done</button> <button onclick="inspActionProof('+a.id+')" style="background:#fff;border:1px solid #185FA5;color:#185FA5;border-radius:8px;padding:4px 9px;font-size:11px;font-weight:700;cursor:pointer;">&#128247; Proof photo</button></div>'):'')
                +'</div>';
        });
        return h;
    }

    function inspSaveSummary(cb){
        var d=_insp.cur||{};
        var payload={ top_strengths:inspVal('inspSum_str'), top_issues:inspVal('inspSum_iss'), urgent_notes:inspVal('inspSum_urg'),
            maint_notes:inspVal('inspSum_mnt'), supply_notes:inspVal('inspSum_sup'),
            mgr_followup:inspChk('inspSum_mgrfu'), mgr_followup_note:inspVal('inspSum_mgrnote'),
            followup_recommended:inspChk('inspSum_fu'), followup_date:inspVal('inspSum_fudate')||null,
            pride_score:inspVal('inspSum_pride')||null, pride_comment:inspVal('inspSum_pridec'),
            final_notes:inspVal('inspSum_fin') };
        inspRpc('insp_summary_save',{p_id:d.id,p_payload:payload},function(nd){ _insp.cur=nd; if(cb) cb(); else inspRenderReview(); });
    }
    function inspCheck(){
        var d=_insp.cur||{};
        inspRpc('insp_validate',{p_id:d.id},function(v){ _insp.blockers=(v&&v.blockers)||[]; if(!_insp.blockers.length) alert('Ready to submit — every line is answered and evidence rules are met.'); inspRenderReview(); });
    }
    function inspSubmit(){
        var d=_insp.cur||{};
        if(!confirm('Submit this inspection? Scores lock, and every flagged line without an action gets an auto-routed corrective task.')) return;
        inspSaveSummary(function(){
            inspRpc('insp_submit',{p_id:d.id},function(res){
                if(res&&res.ok===false){ _insp.blockers=res.blockers||[]; alert('Not ready yet — '+_insp.blockers.length+' item(s) need attention.'); inspRenderReview(); return; }
                _insp.cur=res; _insp.blockers=null;
                alert('Inspection submitted. Corrective tasks were routed to '+(res.location||'the store')+'.');
                inspRenderDetail();
            });
        });
    }

    function inspCreateAction(lineId,kind){
        var d=_insp.cur||{};
        var note=prompt('Notes for this corrective action (what needs to happen)?','');
        if(note===null) return;
        var payload={ notes:note };
        if(kind==='maintenance'){
            var ref=prompt('Link an EXISTING work order # instead of creating a new one? (leave blank to create new)','');
            if(ref===null) return;
            if(ref&&ref.trim()) payload.existing_ref=ref.trim();
        }
        inspRpc('insp_action_create',{p_id:d.id,p_line_id:lineId,p_kind:kind,p_payload:payload},function(){
            inspRpc('insp_get',{p_id:d.id},function(nd){ _insp.cur=nd; if(nd.status==='draft') inspRenderReview(); else inspRenderDetail(); });
        });
    }
    function inspActionDone(actionId){
        var note=prompt('Completion note (what was corrected)?','');
        if(note===null) return;
        inspRpc('insp_action_update',{p_action_id:actionId,p_payload:{status:'done',completion_note:note}},function(){
            var d=_insp.cur||{};
            inspRpc('insp_get',{p_id:d.id},function(nd){ _insp.cur=nd; if(nd.status==='draft') inspRenderReview(); else inspRenderDetail(); });
        });
    }
    function inspActionProof(actionId){
        var inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.capture='environment';
        inp.onchange=function(){
            var f=inp.files&&inp.files[0]; if(!f) return;
            withPin(function(pin){
                supabaseClient.functions.invoke('material-upload',{body:{username:currentUser.username,pin:pin,filename:f.name,contentType:f.type||'application/octet-stream'}}).then(function(res){
                    var err=(res&&res.error)?res.error.message:((res&&res.data&&res.data.error)?res.data.error:null);
                    if(err){ alert('Upload failed: '+(String(err).indexOf('forbidden')>=0?'managers only':err)); return; }
                    var dd=res&&res.data;
                    if(!dd||!dd.token){ alert('Upload could not start.'); return; }
                    supabaseClient.storage.from('training-materials').uploadToSignedUrl(dd.path,dd.token,f,{contentType:f.type||undefined}).then(function(up){
                        if(up.error){ alert('Upload failed: '+up.error.message); return; }
                        var pub=(supabaseClient.storage.from('training-materials').getPublicUrl(dd.path)||{}).data||{};
                        var url=dd.publicUrl||dd.url||pub.publicUrl||dd.path;
                        inspRpc('insp_action_update',{p_action_id:actionId,p_payload:{photo_url:url}},function(){
                            var d=_insp.cur||{};
                            inspRpc('insp_get',{p_id:d.id},function(nd){ _insp.cur=nd; if(nd.status==='draft') inspRenderReview(); else inspRenderDetail(); });
                        });
                    }).catch(function(){ alert('Upload failed.'); });
                }).catch(function(){ alert('Upload failed.'); });
            });
        };
        inp.click();
    }

    // ============================================================
    // DETAIL (submitted — historical record, read-only lines)
    // ============================================================
    function inspRenderDetail(){
        var ov=inspOverlay(); var d=_insp.cur||{};
        var h=inspHeader(d.location+' — '+(d.insp_type||'Inspection'),'inspLoadList()');
        h+='<div style="max-width:860px;margin:0 auto;padding:14px 16px 60px;">';
        h+='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">'+inspBadge(d.status)
            +'<span style="font-size:12px;color:#6b7686;">'+escapeHtml(String(d.submitted_at||d.started_at||'').slice(0,10))+' &middot; '+escapeHtml(d.inspector_name||'')+(d.manager_on_duty?(' &middot; MOD: '+escapeHtml(d.manager_on_duty)):'')+(d.announced==='unannounced'?' &middot; Unannounced':'')+'</span></div>';
        h+='<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">'
            +inspTile('Overall score',inspPct(d.overall_pct))
            +inspTile('Critical items',String(d.critical_count||0),(d.critical_count?'#c0264b':'#1f7a3d'))
            +inspTile('Follow-up',(d.followup_recommended?('Yes'+(d.followup_date?(' — '+String(d.followup_date)):'')):'No'),(d.followup_recommended?'#c0264b':'#1f7a3d'))
            +inspTile('Pride score',d.pride_score!=null?String(d.pride_score)+' / 5':'—')
            +'</div>';
        var sb='';
        [['Top strengths',d.top_strengths],['Top issues',d.top_issues],['Urgent / critical',d.urgent_notes],['Maintenance needs',d.maint_notes],['Supply needs',d.supply_notes],['Manager follow-up note',d.mgr_followup_note],['Final notes',d.final_notes],['Pride comments',d.pride_comment]].forEach(function(p){
            if(p[1]) sb+='<div style="margin-bottom:7px;"><b style="font-size:11px;text-transform:uppercase;color:#5b6675;">'+escapeHtml(p[0])+'</b><div style="font-size:12.5px;white-space:pre-wrap;">'+escapeHtml(p[1])+'</div></div>';
        });
        if(sb) h+=inspCard(sb,'Inspection summary');
        h+=inspCard(inspActionsHtml(d),'Corrective actions ('+(d.actions||[]).length+')');
        (d.sections||[]).forEach(function(sec){
            var body='<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13.5px;">'+escapeHtml(sec.label||sec.key)+'</b><span style="font-size:12px;">'+(sec.pct!=null?inspPct(sec.pct):'')+'</span></div>';
            (sec.items||[]).forEach(function(it){
                if(it.score==null&&!it.na) return;
                var m=it.na?null:INSP_SCORE_META[it.score];
                body+='<div style="border-top:1px solid #f0f1f6;padding:7px 0;font-size:12px;display:flex;gap:8px;align-items:flex-start;">'
                    +'<span style="min-width:34px;text-align:center;font-weight:800;border-radius:7px;padding:3px 0;'+(it.na?'background:#eef0f5;color:#8a91a0;':'background:'+m[2]+';color:#fff;')+'">'+(it.na?'N/A':it.score)+'</span>'
                    +'<span style="flex:1;">'+escapeHtml(it.label||it.key)+inspSevChip(it.severity)
                    +(it.note?('<div style="color:#6b7686;margin-top:2px;">'+escapeHtml(it.note)+'</div>'):'')
                    +(it.no_photo_reason?('<div style="color:#9a5b00;margin-top:2px;font-size:11px;">No photo: '+escapeHtml(it.no_photo_reason)+'</div>'):'')
                    +((it.photos||[]).length?('<div style="margin-top:3px;">'+(it.photos||[]).map(function(p){return '<a href="'+escapeHtml(p.url||'')+'" target="_blank" rel="noopener" style="color:#185FA5;font-size:11px;font-weight:700;margin-right:8px;">&#128247; '+escapeHtml(p.caption||'photo')+'</a>';}).join('')+'</div>'):'')
                    +'</span></div>';
            });
            if(sec.section_comment) body+='<div style="font-size:11.5px;color:#5b6675;border-top:1px solid #f0f1f6;padding-top:6px;margin-top:2px;"><b>Section comments:</b> '+escapeHtml(sec.section_comment)+'</div>';
            h+=inspCard(body);
        });
        h+='</div>';
        ov.innerHTML=h;
    }

    // ============================================================
    // LEADERSHIP DASHBOARD
    // ============================================================
    function inspOpenDash(){
        var ov=inspOverlay();
        ov.innerHTML=inspHeader('Inspection dashboard','inspLoadList()')+'<div style="max-width:900px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading&hellip;</div>';
        inspRpc('insp_dashboard',{p_filters:{}},function(d){ _insp.dash=d||{}; inspRenderDash(); });
    }
    function inspRenderDash(){
        var ov=inspOverlay(); var d=_insp.dash||{}; var s=d.summary||{};
        var h=inspHeader('Inspection dashboard','inspLoadList()');
        h+='<div style="max-width:900px;margin:0 auto;padding:14px 16px 60px;">';
        h+='<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">'
            +inspTile('Inspections (12 mo)',String(s.inspections||0))
            +inspTile('Avg score',s.avg_pct!=null?inspPct(s.avg_pct):'—')
            +inspTile('Critical findings',String(s.critical_findings||0),(s.critical_findings?'#c0264b':'#1f7a3d'))
            +inspTile('Follow-ups recommended',String(s.followups_recommended||0))
            +'</div>';
        var locs=d.locations||[];
        var lb='';
        if(!locs.length) lb=inspEmpty('No inspections yet — location status appears after the first submitted inspection.');
        else locs.forEach(function(L){
            var delta='';
            if(L.last_pct!=null&&L.prev_pct!=null){ var df=Math.round(10*(L.last_pct-L.prev_pct))/10; delta=' <span style="font-size:11px;font-weight:800;color:'+(df>=0?'#1f7a3d':'#c0264b')+';">'+(df>=0?'&#9650; +':'&#9660; ')+df+'</span>'; }
            lb+='<div style="border-top:1px solid #f0f1f6;padding:9px 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
                +'<div style="flex:1;min-width:160px;"><b style="font-size:13px;">'+escapeHtml(L.location)+'</b>'
                +'<div style="font-size:11px;color:#6b7686;">Last: '+(L.last_date?escapeHtml(String(L.last_date)):'never')+' &middot; Next due: '+(L.next_due?escapeHtml(String(L.next_due)):'—')+(L.overdue?' <span style="color:#c0264b;font-weight:800;">OVERDUE</span>':'')+'</div></div>'
                +'<div style="text-align:right;font-size:13px;">'+inspPct(L.last_pct)+delta
                +'<div style="font-size:11px;margin-top:2px;">'+(L.open_actions?('<span style="color:#9a5b00;font-weight:700;">'+L.open_actions+' open</span>'):'<span style="color:#1f7a3d;">all clear</span>')
                +(L.open_critical?(' &middot; <span style="color:#c0264b;font-weight:800;">'+L.open_critical+' critical</span>'):'')+'</div></div>'
                +(L.last_id?('<button onclick="inspOpen('+L.last_id+')" style="background:#fff;border:1px solid #185FA5;color:#185FA5;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;">View</button>'):'')
                +'</div>';
        });
        h+=inspCard(lb,'Location status (cadence: every '+inspCfgNum('cadence_days',90)+' days)');
        var crit=d.criticals||[];
        var cb='';
        if(!crit.length) cb=inspEmpty('No open critical findings. Keep it that way.');
        else crit.forEach(function(a){
            cb+='<div style="border-top:1px solid #f0f1f6;padding:8px 0;font-size:12px;"><b>'+escapeHtml(a.location||'')+'</b> — '+escapeHtml(a.title||'')
                +'<div style="color:#6b7686;margin-top:2px;">'+escapeHtml(a.kind||'')+(a.due_date?(' &middot; due '+escapeHtml(String(a.due_date))):'')+(a.owner_name?(' &middot; '+escapeHtml(a.owner_name)):'')+' &middot; <a href="javascript:void(0)" onclick="inspOpen('+a.inspection_id+')" style="color:#185FA5;font-weight:700;">open inspection</a></div></div>';
        });
        h+=inspCard(cb,'Open critical findings ('+crit.length+')');
        var rep=d.repeat_issues||[];
        var rb='';
        if(!rep.length) rb=inspEmpty('No repeat issues detected yet.');
        else rep.forEach(function(r){
            rb+='<div style="border-top:1px solid #f0f1f6;padding:7px 0;font-size:12px;display:flex;gap:8px;align-items:center;"><span style="flex:1;">'+escapeHtml(r.label||r.item_key)+'</span><span style="font-weight:800;color:#c0264b;">'+r.fail_count+'&times;</span><span style="font-size:11px;color:#6b7686;">'+r.locations+' location(s)</span></div>';
        });
        h+=inspCard(rb,'Repeat issues (failed 2+ times, last 12 months)');
        var sa=d.section_avgs||[];
        var sab='';
        if(!sa.length) sab=inspEmpty('Section averages appear after inspections are submitted.');
        else sa.forEach(function(x){
            var w=Math.max(2,Math.min(100,parseFloat(x.avg_pct)||0));
            sab+='<div style="padding:5px 0;font-size:12px;"><div style="display:flex;justify-content:space-between;"><span>'+escapeHtml(x.label||x.section_key)+'</span>'+inspPct(x.avg_pct)+'</div><div style="height:6px;background:#eef0f5;border-radius:99px;margin-top:3px;overflow:hidden;"><div style="height:100%;width:'+w+'%;background:linear-gradient(90deg,#185FA5,#1f7a3d);border-radius:99px;"></div></div></div>';
        });
        h+=inspCard(sab,'Weakest sections company-wide');
        h+='</div>';
        ov.innerHTML=h;
    }
