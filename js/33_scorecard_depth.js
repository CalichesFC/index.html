(function(){
    // ============================================================
    // SCORECARD DEPTH  (js/33_scorecard_depth.js)  — GO_LIVE_15 surface
    // Self-contained, append-only. Edits NOTHING else (not index.html, not
    // rpc_manifest.json, not js/29). It injects four independently fail-safe
    // sub-panels INTO the existing Store Health Scorecard screen (overlay
    // #shsModal, opened by window.openStoreHealthScorecard() in js/29):
    //   1) Score history / trend   (app_scorecard_history)          — mgr+
    //   2) Company rollup & rankings (app_scorecard_rollup)         — leadership
    //   3) Thresholds editor       (app_scorecard_thresholds_get /  — mgr
    //                               app_scorecard_threshold_set)
    //   4) Reputation entry + list (app_scorecard_reputation_list / — mgr
    //                               app_scorecard_reputation_add)
    //   (+ optional "Save snapshot" manager button -> app_scorecard_snapshot_save)
    //
    // INJECTION: js/29's shsRender()/shsLoad() overwrite shsModal.innerHTML on
    // every render, so we keep a single preserved root node (_scd.rootNode) and
    // re-append it to the screen's centered content column after each rewrite,
    // watched by a MutationObserver on #shsModal (with a debounced re-sync) plus
    // an append-only wrap of window.openStoreHealthScorecard (same pattern as
    // js/31 wrapping switchMenuTab). The selected store/date are read straight
    // from js/29's own <select>/<input type=date> in the header — no coupling to
    // js/29's private state.
    //
    // FAIL-SAFE ABSOLUTELY: every supabaseClient.rpc call is try/caught; any
    // error / 404 / empty result renders NOTHING for that panel (it is hidden)
    // and never throws or blocks the scorecard screen. Credentials are read from
    // window._gatePin / sessionStorage('calichesPin') — this file NEVER calls
    // prompt() or withPin() from an auto-render path. Manager/leadership views
    // are gated by effectiveRole() (View-As aware); the RPCs are the real gate
    // and simply return forbidden/nothing for everyone else.
    //
    // BACKEND CONTRACT (confirmed against specs/GO_LIVE_15_SCORECARD_DEPTH.sql):
    //   app_scorecard_history(p_username,p_password,p_store,p_from,p_to)
    //     -> { store, from, to, snapshots:[{period,overall,band,computed_at,...}],
    //          summary:{count,first,last,avg,best,worst} }
    //   app_scorecard_rollup(p_username,p_password,p_period)
    //     -> { period, window_days, stores:[{store,period,overall,band,rank,
    //          has_snapshot,...}], summary:{stores,ranked,company_avg,top} }
    //   app_scorecard_thresholds_get(p_username,p_password,p_store)
    //     -> { store, effective_yellow, thresholds:[{metric_key,label,kind,
    //          company_default,store_override,effective}] }
    //   app_scorecard_threshold_set(p_username,p_password,p_store,p_metric_key,
    //          p_threshold,p_note) -> { ok, store, metric_key, threshold, cleared }
    //   app_scorecard_reputation_list(p_username,p_password,p_store)
    //     -> { store, entries:[{id,source,score,note,recorded_by,recorded_at}],
    //          reputation_score, scale_max, window_days, manual, note }
    //   app_scorecard_reputation_add(p_username,p_password,p_store,p_source,
    //          p_score,p_note) -> { ok, id, store, score }
    //   app_scorecard_snapshot_save(p_username,p_password,p_store[,p_period])
    //     -> { ok, id, store, period, overall, band, exceptions_emitted, ... }
    // ============================================================

    // Guard double-injection (safe even if the script tag is included twice).
    try{ if(window.__scd_depth_init) return; window.__scd_depth_init = true; }catch(e){ return; }

    var _scd = { store:null, date:null, seq:0, rootNode:null, obs:null, obsNode:null, thRows:[] };

    // ---- tiny helpers ----------------------------------------------------
    function scdEsc(s){ try{ if(typeof escapeHtml==='function') return escapeHtml(s==null?'':String(s)); }catch(e){} return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return '&#'+c.charCodeAt(0)+';'; }); }
    function scdReady(){ try{ return !!(currentUser && currentUser.username); }catch(e){ return false; } }

    // Credentials WITHOUT prompt()/withPin — auto-render safe. Read the cached PIN
    // a logged-in user already has (js/02 mirrors sessionPin onto window._gatePin;
    // js/01 persists it to sessionStorage 'calichesPin'). Null -> panels stand down.
    function scdPin(){
        try{ if(window._gatePin) return window._gatePin; }catch(e){}
        try{ var p=sessionStorage.getItem('calichesPin'); if(p) return p; }catch(e){}
        return null;
    }

    // Single fail-safe RPC wrapper. Never throws; every failure path -> onerr.
    function scdRpc(name,args,cb,onerr){
        try{
            if(typeof supabaseClient==='undefined' || !supabaseClient || typeof supabaseClient.rpc!=='function'){ if(onerr) onerr({message:'unavailable'}); return; }
            if(!currentUser || !currentUser.username){ if(onerr) onerr({message:'unauth'}); return; }
            var pin=scdPin(); if(!pin){ if(onerr) onerr({message:'nopin'}); return; }
            var pr=supabaseClient.rpc(name, Object.assign({p_username:currentUser.username, p_password:pin}, args||{}));
            if(!pr || typeof pr.then!=='function'){ if(onerr) onerr({message:'nopromise'}); return; }
            pr.then(function(r){ try{ if(r && r.error){ if(onerr) onerr(r.error); return; } cb(r?r.data:null); }catch(e){ if(onerr) onerr({message:'cb'}); } })
              .catch(function(){ if(onerr) onerr({message:'connection'}); });
        }catch(e){ if(onerr) onerr({message:'connection'}); }
    }
    function scdErrMsg(e){ var m=String((e&&e.message)||''); if(m.indexOf('forbidden')>=0) return 'Managers only.'; if(m.indexOf('nopin')>=0||m.indexOf('unauth')>=0) return 'Please re-enter your PIN to make changes.'; if(m.indexOf('bad_metric_key')>=0) return 'Unknown metric.'; return 'Could not complete. Please try again.'; }

    // ---- role gates (View-As aware, mirrors js/31 / GO_LIVE_15 _scd_is_mgr) ----
    function scdRole(){ try{ return String((typeof effectiveRole==='function'?effectiveRole():'')||(currentUser&&currentUser.role)||'').toLowerCase(); }catch(e){ try{ return String((currentUser&&currentUser.role)||'').toLowerCase(); }catch(_){ return ''; } } }
    function scdPreviewing(){ try{ return !!(window._viewAsRole && typeof canUseViewAs==='function' && canUseViewAs()); }catch(e){ return false; } }
    function scdDev(){ if(scdPreviewing()) return false; try{ return !!(currentUser && currentUser.is_developer===true); }catch(e){ return false; } }
    // Store management: managers/admin/owner/president/VP (leads excluded) — same
    // set the backend _scd_is_mgr enforces. Developer bypass when not previewing.
    function scdIsMgr(){ var r=scdRole(); if(r.indexOf('shift lead')>=0||r.indexOf('team lead')>=0) return scdDev(); if(r.indexOf('manager')>=0||r.indexOf('admin')>=0||r.indexOf('owner')>=0||r.indexOf('president')>=0||r.indexOf('vice president')>=0||r.indexOf('vp')>=0) return true; return scdDev(); }
    // Leadership (company-wide rollup): owner/VP/president/director/admin only.
    function scdIsLeadership(){ var r=scdRole(); if(r.indexOf('owner')>=0||r.indexOf('president')>=0||r.indexOf('vice president')>=0||r.indexOf('vp')>=0||r.indexOf('director')>=0||r.indexOf('admin')>=0) return true; return scdDev(); }

    // ---- formatting ------------------------------------------------------
    function scdNum(n){ if(n==null||n==='') return '&mdash;'; var x=parseFloat(n); if(isNaN(x)) return '&mdash;'; return String(Math.round(x*10)/10); }
    function scdInt(n){ var x=parseFloat(n); return isNaN(x)?0:Math.round(x); }
    function scdShortDate(s){ if(!s) return ''; var m=String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); if(m){ var dt=new Date(+m[1],+m[2]-1,+m[3]); if(!isNaN(dt.getTime())) return dt.toLocaleDateString(undefined,{month:'short',day:'numeric'}); } return String(s).slice(0,10); }
    function scdIsoValid(s){ return !!(s && /^\d{4}-\d{2}-\d{2}/.test(String(s))); }
    function scdIsoAddDays(iso,delta){ try{ var p=String(iso||'').slice(0,10).split('-'); if(p.length!==3) return null; var d=new Date(+p[0],+p[1]-1,+p[2]); if(isNaN(d.getTime())) return null; d.setDate(d.getDate()+(delta||0)); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }catch(e){ return null; } }
    function scdBandInk(b){ b=String(b||'').toLowerCase(); return b==='red'?'#a01b3e':(b==='yellow'?'#9a5b00':(b==='green'?'#1b7a3d':'#5b6675')); }
    function scdBandBg(b){ b=String(b||'').toLowerCase(); return b==='red'?'#fdeaea':(b==='yellow'?'#fff4e0':(b==='green'?'#e8f5ec':'#eef0f3')); }
    function scdShell(inner){ return '<div style="background:#fff;border:1px solid #e6ebf2;border-radius:12px;padding:12px 14px;margin-bottom:10px;">'+inner+'</div>'; }

    // ---- DOM plumbing (survives js/29's innerHTML rewrites) ---------------
    function scdRootNode(){ if(!_scd.rootNode){ var r=document.createElement('div'); r.id='scdRoot'; _scd.rootNode=r; } return _scd.rootNode; }
    // The screen's centered content column is the last direct child of #shsModal
    // carrying a max-width style (js/29 uses max-width:860 for every state).
    function scdContentHost(ov){ var kids=ov.children||[]; for(var i=kids.length-1;i>=0;i--){ var k=kids[i]; if(!k||k===_scd.rootNode) continue; var stl=(k.getAttribute&&k.getAttribute('style'))||''; if(/max-width/.test(stl)) return k; } return null; }
    // Read the currently selected store/date from js/29's own controls, skipping
    // any select/date INSIDE our own panels (thresholds/reputation inputs).
    function scdReadCtx(ov){ var root=_scd.rootNode; var sel=null,dt=null; var sels=ov.querySelectorAll('select'); for(var i=0;i<sels.length;i++){ if(!root||!root.contains(sels[i])){ sel=sels[i]; break; } } var dts=ov.querySelectorAll('input[type=date]'); for(var j=0;j<dts.length;j++){ if(!root||!root.contains(dts[j])){ dt=dts[j]; break; } } return { store: sel?String(sel.value||''):'', date: dt?String(dt.value||''):'', hasSel: !!sel }; }

    function scdSync(){
        try{
            if(!scdReady()) return;
            var ov=document.getElementById('shsModal'); if(!ov) return;
            if(ov.style && ov.style.display==='none') return;
            var host=scdContentHost(ov); if(!host) return;
            var ctx=scdReadCtx(ov); if(!ctx.hasSel) return;      // loading/spinner: no store select yet
            var root=scdRootNode();
            if(root.parentNode!==host){ try{ host.appendChild(root); }catch(e){ return; } }
            if(!ctx.store) return;
            if(ctx.store!==_scd.store || ctx.date!==_scd.date){ _scd.store=ctx.store; _scd.date=ctx.date; scdRenderAll(ctx.store, ctx.date); }
        }catch(e){}
    }
    var _scdSyncPend=false;
    function scdScheduleSync(){ if(_scdSyncPend) return; _scdSyncPend=true; setTimeout(function(){ _scdSyncPend=false; scdSync(); },0); }

    function scdEnsureObserver(){
        try{
            var ov=document.getElementById('shsModal'); if(!ov) return;
            if(_scd.obs && _scd.obsNode===ov) return;
            if(typeof MutationObserver==='undefined') return;
            if(_scd.obs){ try{ _scd.obs.disconnect(); }catch(e){} }
            _scd.obs=new MutationObserver(function(){ scdScheduleSync(); });
            _scd.obs.observe(ov,{childList:true, subtree:true});
            _scd.obsNode=ov;
        }catch(e){}
    }

    // ---- panel: Score history / trend -----------------------------------
    function scdLoadHistory(store,date,seq){
        var host=document.getElementById('scdHistory'); if(!host) return;
        var to=scdIsoValid(date)?date:null; var from=to?scdIsoAddDays(to,-90):null;
        scdRpc('app_scorecard_history',{p_store:store, p_from:from, p_to:to}, function(d){
            if(seq!==_scd.seq) return; var h=document.getElementById('scdHistory'); if(!h) return;
            try{ scdRenderHistory(h,d,store); }catch(e){ h.style.display='none'; h.innerHTML=''; }
        }, function(){ if(seq!==_scd.seq) return; var h=document.getElementById('scdHistory'); if(h){ h.style.display='none'; h.innerHTML=''; } });
    }
    function scdRenderHistory(host,d,store){
        var snaps=(d&&d.snapshots)||[]; var sum=(d&&d.summary)||{}; var mgr=scdIsMgr();
        var head='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'
            +'<b style="flex:1;font-size:13.5px;color:#1f2a44;">&#128200; Score history / trend</b>'
            +(mgr?'<button onclick="scdSaveSnapshot()" style="background:#106AB3;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">&#128190; Save snapshot</button>':'')
            +'</div>';
        var status='<div id="scd_hist_status" style="font-size:11px;color:#6b6275;margin-top:6px;"></div>';
        if(!snaps.length){
            if(!mgr){ host.style.display='none'; host.innerHTML=''; return; }   // nothing to show a non-mgr
            host.style.display='';
            host.innerHTML=scdShell(head+'<div style="text-align:center;color:#8a93a2;font-size:12px;padding:14px 6px;">No saved snapshots yet for '+scdEsc(store)+'. Use &ldquo;Save snapshot&rdquo; to capture the current score.</div>'+status);
            return;
        }
        var count=(sum.count!=null?sum.count:snaps.length);
        var sumline='<div style="font-size:11px;color:#6b6275;margin-bottom:8px;">Avg '+scdNum(sum.avg)+' &middot; Best '+scdNum(sum.best)+' &middot; Worst '+scdNum(sum.worst)+' &middot; '+scdInt(count)+' snapshot'+(scdInt(count)===1?'':'s')+'</div>';
        var rows=snaps.slice().reverse(); if(rows.length>12) rows=rows.slice(0,12);
        var bars=rows.map(function(s){ var sc=(s.overall==null||s.overall==='')?null:parseFloat(s.overall); var ink=scdBandInk(s.band); var w=(sc==null?0:Math.max(2,Math.min(100,sc)));
            return '<div style="display:flex;align-items:center;gap:8px;margin:5px 0;">'
                +'<span style="width:74px;flex:none;font-size:10.5px;color:#6b6275;">'+scdEsc(scdShortDate(s.period))+'</span>'
                +'<span style="flex:1;background:#eef0f3;border-radius:99px;height:14px;overflow:hidden;"><span style="display:block;height:100%;width:'+w+'%;background:'+ink+';border-radius:99px;"></span></span>'
                +'<b style="width:30px;flex:none;text-align:right;font-size:12px;color:'+ink+';">'+(sc==null?'&mdash;':Math.round(sc))+'</b></div>';
        }).join('');
        host.style.display='';
        host.innerHTML=scdShell(head+sumline+bars+status);
    }

    // ---- panel: Company rollup & rankings (leadership) ------------------
    function scdLoadRollup(store,date,seq){
        var host=document.getElementById('scdRollup'); if(!host) return;
        var per=scdIsoValid(date)?date:null;
        scdRpc('app_scorecard_rollup',{p_period:per}, function(d){
            if(seq!==_scd.seq) return; var h=document.getElementById('scdRollup'); if(!h) return;
            try{ scdRenderRollup(h,d); }catch(e){ h.style.display='none'; h.innerHTML=''; }
        }, function(){ if(seq!==_scd.seq) return; var h=document.getElementById('scdRollup'); if(h){ h.style.display='none'; h.innerHTML=''; } });
    }
    function scdRenderRollup(host,d){
        var stores=(d&&d.stores)||[]; var sum=(d&&d.summary)||{};
        if(!stores.length){ host.style.display='none'; host.innerHTML=''; return; }
        var head='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><b style="flex:1;font-size:13.5px;color:#1f2a44;">&#127942; Company rollup &amp; rankings</b><span style="font-size:10.5px;color:#98a2b0;">as of '+scdEsc(scdShortDate(d&&d.period))+'</span></div>';
        var sumline='<div style="font-size:11px;color:#6b6275;margin-bottom:8px;">Company avg '+scdNum(sum.company_avg)+' &middot; '+scdInt(sum.ranked)+' of '+scdInt(sum.stores!=null?sum.stores:stores.length)+' stores scored'+(sum.top?(' &middot; Top: '+scdEsc(sum.top)):'')+'</div>';
        var body=stores.map(function(s){ var sc=(s.overall==null||s.overall==='')?null:parseFloat(s.overall); var ink=scdBandInk(s.band); var bg=scdBandBg(s.band);
            var rank=(s.rank==null)?'&mdash;':('#'+scdInt(s.rank));
            var scoreCell=(sc==null)
                ? '<span style="font-size:10px;font-weight:800;color:#98a2b0;background:#eef0f3;padding:2px 7px;border-radius:99px;">no snapshot</span>'
                : '<span style="font-size:12px;font-weight:800;color:'+ink+';background:'+bg+';padding:2px 9px;border-radius:99px;">'+Math.round(sc)+'</span>';
            return '<tr style="border-top:1px solid #f0f2f6;">'
                +'<td style="padding:6px 4px;font-weight:800;color:#5b6675;width:34px;">'+rank+'</td>'
                +'<td style="padding:6px 4px;font-weight:700;color:#1f2a44;">'+scdEsc(s.store)+'</td>'
                +'<td style="padding:6px 4px;text-align:right;">'+scoreCell+'</td>'
                +'<td style="padding:6px 4px;text-align:right;font-size:10.5px;color:#98a2b0;white-space:nowrap;">'+(s.has_snapshot?scdEsc(scdShortDate(s.period)):'&mdash;')+'</td></tr>';
        }).join('');
        var table='<table style="width:100%;border-collapse:collapse;font-size:12.5px;"><thead><tr style="font-size:10px;text-transform:uppercase;color:#98a2b0;letter-spacing:.3px;"><th style="text-align:left;padding:2px 4px;">Rank</th><th style="text-align:left;padding:2px 4px;">Store</th><th style="text-align:right;padding:2px 4px;">Score</th><th style="text-align:right;padding:2px 4px;">As of</th></tr></thead><tbody>'+body+'</tbody></table>';
        host.style.display='';
        host.innerHTML=scdShell(head+sumline+table);
    }

    // ---- panel: Thresholds editor (manager) -----------------------------
    function scdLoadThresholds(store,seq){
        var host=document.getElementById('scdThresholds'); if(!host) return;
        scdRpc('app_scorecard_thresholds_get',{p_store:store}, function(d){
            if(seq!==_scd.seq) return; var h=document.getElementById('scdThresholds'); if(!h) return;
            try{ scdRenderThresholds(h,d,store); }catch(e){ h.style.display='none'; h.innerHTML=''; }
        }, function(){ if(seq!==_scd.seq) return; var h=document.getElementById('scdThresholds'); if(h){ h.style.display='none'; h.innerHTML=''; } });
    }
    function scdRenderThresholds(host,d,store){
        var rows=(d&&d.thresholds)||[];
        if(!rows.length){ host.style.display='none'; host.innerHTML=''; return; }
        _scd.thRows=rows.map(function(r){ return r.metric_key; });
        var head='<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><b style="flex:1;font-size:13.5px;color:#1f2a44;">&#127919; Thresholds</b><span style="font-size:10.5px;color:#98a2b0;">'+scdEsc(store)+'</span></div>'
            +'<div style="font-size:11px;color:#6b6275;margin-bottom:4px;">Per-metric override for this store. Blank uses the company default.</div>';
        var body=rows.map(function(r,i){
            var ov=(r.store_override==null||r.store_override==='')?'':r.store_override;
            var def=scdNum(r.company_default); var eff=scdNum(r.effective);
            return '<div style="border-top:1px solid #f0f2f6;padding:8px 2px;">'
                +'<div style="display:flex;align-items:center;gap:6px;"><b style="flex:1;font-size:12.5px;color:#1f2a44;">'+scdEsc(r.label||r.metric_key)+' <span style="font-size:9.5px;font-weight:700;color:#98a2b0;background:#eef0f3;padding:1px 6px;border-radius:99px;text-transform:uppercase;">'+scdEsc(r.kind||'')+'</span></b></div>'
                +'<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:5px;">'
                    +'<span style="font-size:10.5px;color:#98a2b0;">default '+def+' &middot; effective <b style="color:#5b6675;">'+eff+'</b></span>'
                    +'<span style="flex:1;"></span>'
                    +'<input id="scd_th_'+i+'" type="number" step="0.1" value="'+scdEsc(String(ov))+'" placeholder="'+def+'" style="width:80px;border:1px solid #cdd5e0;border-radius:8px;padding:6px 8px;font-size:12px;">'
                    +'<button onclick="scdThSet('+i+')" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Save</button>'
                    +'<button onclick="scdThClear('+i+')" style="background:#eef0f3;color:#5b6675;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Clear</button>'
                +'</div></div>';
        }).join('');
        var status='<div id="scd_th_status" style="font-size:11px;color:#6b6275;margin-top:8px;"></div>';
        host.style.display='';
        host.innerHTML=scdShell(head+body+status);
    }

    // ---- panel: Reputation entry + list (manager) -----------------------
    function scdLoadReputation(store,seq){
        var host=document.getElementById('scdReputation'); if(!host) return;
        scdRpc('app_scorecard_reputation_list',{p_store:store}, function(d){
            if(seq!==_scd.seq) return; var h=document.getElementById('scdReputation'); if(!h) return;
            try{ scdRenderReputation(h,d,store); }catch(e){ h.style.display='none'; h.innerHTML=''; }
        }, function(){ if(seq!==_scd.seq) return; var h=document.getElementById('scdReputation'); if(h){ h.style.display='none'; h.innerHTML=''; } });
    }
    function scdRenderReputation(host,d,store){
        if(!d){ host.style.display='none'; host.innerHTML=''; return; }
        var entries=(d.entries)||[];
        var scaleMax=(d.scale_max==null||isNaN(parseFloat(d.scale_max)))?5:parseFloat(d.scale_max);
        var rep=(d.reputation_score==null||d.reputation_score==='')?null:parseFloat(d.reputation_score);
        var head='<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><b style="flex:1;font-size:13.5px;color:#1f2a44;">&#11088; Reputation</b><span style="font-size:10px;font-weight:800;color:#9a5b00;background:#fff4e0;padding:2px 7px;border-radius:99px;">MANUAL</span></div>';
        var idx='<div style="font-size:12px;color:#5b6675;margin-bottom:8px;">Current index: <b style="color:#1f2a44;">'+(rep==null?'&mdash;':(Math.round(rep*10)/10))+'</b> / '+scaleMax+(d.window_days?(' <span style="color:#98a2b0;">('+scdInt(d.window_days)+'-day window)</span>'):'')+'</div>';
        var form='<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:#f7f8fb;border:1px solid #eef0f5;border-radius:10px;padding:8px;margin-bottom:8px;">'
            +'<input id="scd_rep_source" type="text" placeholder="Source (e.g. Google)" style="flex:2;min-width:120px;border:1px solid #cdd5e0;border-radius:8px;padding:6px 8px;font-size:12px;">'
            +'<input id="scd_rep_score" type="number" step="0.1" min="0" max="'+scaleMax+'" placeholder="Score /'+scaleMax+'" style="width:100px;border:1px solid #cdd5e0;border-radius:8px;padding:6px 8px;font-size:12px;">'
            +'<input id="scd_rep_note" type="text" placeholder="Note (optional)" style="flex:2;min-width:120px;border:1px solid #cdd5e0;border-radius:8px;padding:6px 8px;font-size:12px;">'
            +'<button onclick="scdRepAdd()" style="background:#106AB3;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;">Add</button></div>';
        var status='<div id="scd_rep_status" style="font-size:11px;color:#6b6275;margin-bottom:6px;"></div>';
        var list=entries.length
            ? entries.map(function(e){ return '<div style="display:flex;align-items:center;gap:8px;border-top:1px solid #f0f2f6;padding:7px 2px;">'
                +'<b style="width:38px;flex:none;font-size:13px;color:#1f2a44;text-align:center;">'+(e.score==null?'&mdash;':scdEsc(String(e.score)))+'</b>'
                +'<div style="flex:1;min-width:0;"><div style="font-size:12px;color:#1f2a44;font-weight:600;">'+scdEsc(e.source||'&mdash;')+(e.note?' <span style="font-weight:400;color:#6b6275;">&middot; '+scdEsc(e.note)+'</span>':'')+'</div>'
                +'<div style="font-size:10px;color:#98a2b0;">'+scdEsc(e.recorded_by||'')+(e.recorded_at?(' &middot; '+scdEsc(scdShortDate(e.recorded_at))):'')+'</div></div></div>'; }).join('')
            : '<div style="text-align:center;color:#8a93a2;font-size:12px;padding:8px;">No reputation points yet.</div>';
        host.style.display='';
        host.innerHTML=scdShell(head+idx+form+status+list);
    }

    // ---- write handlers (user-initiated; still no prompt) ----------------
    window.scdSaveSnapshot=function(){ var store=_scd.store; if(!store) return; var st=document.getElementById('scd_hist_status'); if(st){ st.style.color='#6b6275'; st.innerHTML='Saving snapshot&hellip;'; }
        scdRpc('app_scorecard_snapshot_save',{p_store:store}, function(r){ if(st){ st.style.color='#1b7a3d'; st.innerHTML='Snapshot saved'+((r&&r.overall!=null)?(' &middot; score '+Math.round(parseFloat(r.overall))):'')+'.'; }
            scdLoadHistory(store,_scd.date,_scd.seq); if(scdIsLeadership()) scdLoadRollup(store,_scd.date,_scd.seq);
        }, function(e){ if(st){ st.style.color='#a01b3e'; st.innerHTML=scdErrMsg(e); } }); };

    window.scdThSet=function(i){ var store=_scd.store; if(!store) return; var key=(_scd.thRows||[])[i]; if(!key) return; var inp=document.getElementById('scd_th_'+i); var st=document.getElementById('scd_th_status'); var val=inp?String(inp.value).trim():'';
        if(val===''){ if(st){ st.style.color='#9a5b00'; st.innerHTML='Enter a number, or use Clear to remove the override.'; } return; }
        var num=parseFloat(val); if(isNaN(num)){ if(st){ st.style.color='#a01b3e'; st.innerHTML='That is not a number.'; } return; }
        if(st){ st.style.color='#6b6275'; st.innerHTML='Saving&hellip;'; }
        scdRpc('app_scorecard_threshold_set',{p_store:store, p_metric_key:key, p_threshold:num, p_note:''}, function(){ if(st){ st.style.color='#1b7a3d'; st.innerHTML='Saved.'; } scdLoadThresholds(store,_scd.seq); }, function(e){ if(st){ st.style.color='#a01b3e'; st.innerHTML=scdErrMsg(e); } }); };

    window.scdThClear=function(i){ var store=_scd.store; if(!store) return; var key=(_scd.thRows||[])[i]; if(!key) return; var st=document.getElementById('scd_th_status'); if(st){ st.style.color='#6b6275'; st.innerHTML='Clearing&hellip;'; }
        scdRpc('app_scorecard_threshold_set',{p_store:store, p_metric_key:key, p_threshold:null, p_note:''}, function(){ if(st){ st.style.color='#1b7a3d'; st.innerHTML='Override cleared.'; } scdLoadThresholds(store,_scd.seq); }, function(e){ if(st){ st.style.color='#a01b3e'; st.innerHTML=scdErrMsg(e); } }); };

    window.scdRepAdd=function(){ var store=_scd.store; if(!store) return; var src=document.getElementById('scd_rep_source'); var scoreEl=document.getElementById('scd_rep_score'); var noteEl=document.getElementById('scd_rep_note'); var st=document.getElementById('scd_rep_status'); var sval=scoreEl?String(scoreEl.value).trim():'';
        if(sval===''){ if(st){ st.style.color='#9a5b00'; st.innerHTML='Enter a score.'; } return; }
        var num=parseFloat(sval); if(isNaN(num)){ if(st){ st.style.color='#a01b3e'; st.innerHTML='Score must be a number.'; } return; }
        if(st){ st.style.color='#6b6275'; st.innerHTML='Adding&hellip;'; }
        scdRpc('app_scorecard_reputation_add',{p_store:store, p_source:(src?src.value:'')||'', p_score:num, p_note:(noteEl?noteEl.value:'')||''}, function(){ if(st){ st.style.color='#1b7a3d'; st.innerHTML='Added.'; } scdLoadReputation(store,_scd.seq); }, function(e){ if(st){ st.style.color='#a01b3e'; st.innerHTML=scdErrMsg(e); } }); };

    // ---- assemble the depth section + kick off every panel ---------------
    function scdRenderAll(store,date){
        var root=scdRootNode(); _scd.seq++;
        var showMgr=scdIsMgr(), showLead=scdIsLeadership();
        if(!showMgr && !showLead){ root.innerHTML=''; return; }
        var wrap='<div style="border-top:2px solid #e6ebf2;margin-top:16px;padding-top:12px;">'
            +'<div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;margin:0 2px 10px;">Scorecard depth</div>';
        if(showMgr)  wrap+='<div id="scdHistory"></div>';
        if(showLead) wrap+='<div id="scdRollup"></div>';
        if(showMgr)  wrap+='<div id="scdThresholds"></div>';
        if(showMgr)  wrap+='<div id="scdReputation"></div>';
        wrap+='</div>';
        root.innerHTML=wrap;
        var seq=_scd.seq;
        if(showMgr){ scdLoadHistory(store,date,seq); scdLoadThresholds(store,seq); scdLoadReputation(store,seq); }
        if(showLead){ scdLoadRollup(store,date,seq); }
    }

    // ---- hook js/29's entry point WITHOUT editing it ---------------------
    // Append-only wrap (same pattern as js/31 wrapping switchMenuTab). Resets the
    // store cache so each explicit open re-renders fresh, attaches the observer,
    // and nudges a few syncs to catch js/29's async first paint.
    function scdWrapOpen(){
        try{
            if(typeof window.openStoreHealthScorecard==='function' && !window.openStoreHealthScorecard.__scdWrapped){
                var wrapped=(function(orig){
                    function w(){ var r; try{ r=orig.apply(this,arguments); }catch(e){ r=undefined; }
                        try{ _scd.store=null; _scd.date=null; scdEnsureObserver(); scdScheduleSync(); setTimeout(scdScheduleSync,80); setTimeout(scdScheduleSync,240); }catch(e){}
                        return r; }
                    w.__scdWrapped=true; return w;
                })(window.openStoreHealthScorecard);
                window.openStoreHealthScorecard=wrapped;
                return true;
            }
        }catch(e){}
        return false;
    }
    // js/33 loads after js/29, so the entry point normally exists already. Poll a
    // few times defensively in case of an unusual load order / late include.
    (function initWrap(){ if(scdWrapOpen()) return; var tries=0; var iv=setInterval(function(){ tries++; if(scdWrapOpen() || tries>50){ clearInterval(iv); } },100); })();

    // Safety net: if the scorecard is already open when this script runs, wire in now.
    try{ var _m=document.getElementById('shsModal'); if(_m && _m.style && _m.style.display!=='none'){ scdEnsureObserver(); scdScheduleSync(); } }catch(e){}
})();
