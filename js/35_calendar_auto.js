(function(){
    // ============================================================
    // CALENDAR AUTOMATION  (js/35_calendar_auto.js)  — GO_LIVE_17 surface
    // Self-contained, append-only. Edits NOTHING else (not index.html, not
    // rpc_manifest.json, not js/30, not js/19). It injects TWO independently
    // fail-safe surfaces into two existing screens:
    //   1) SEED button (managers) -> Company Calendar overlay #calModal
    //      (opened by window.openCompanyCalendar() in js/30). A compact card at
    //      the top of the Calendar tab with one button, "Auto-seed calendar from
    //      PM/catering/fundraiser dates", that calls app_calendar_autoseed and
    //      shows a small result toast (count). Manager-gated (View-As aware) to
    //      the SAME authority the backend _cal_mgr enforces (manager/admin/owner/
    //      vp/president/director/supervisor/marketing/catering/vending + dev).
    //   2) TODAY strip (anyone) -> Shift Leader Console overlay #shiftConsoleModal
    //      (opened by openShiftConsole() in js/19 — the "Run My Shift" surface).
    //      A read-only "Today on the calendar" strip of the events live today for
    //      the shift's store. No client role gate — the RPC is the real gate and
    //      simply returns what the caller may see.
    //
    // INJECTION (same proven pattern as js/33_scorecard_depth.js and
    // js/34_store_priorities.js): js/30's calRender()/calLoad() and js/19's
    // shcRenderConsole() overwrite their overlay's innerHTML on every render, so
    // each surface keeps ONE preserved root node (cauSeed.root / cauToday.root)
    // and re-attaches it to the screen's centered content column (the last direct
    // child carrying a max-width style — js/30 uses 900, js/19 uses 760) after
    // every rewrite, watched by a MutationObserver on the overlay (debounced
    // re-sync) plus an append-only wrap of the screen's open function. The SEED
    // card only shows on the Calendar tab (detected by js/30's own footer text);
    // the TODAY strip reads the store from js/19's #shcS_loc / tempStoreLoc().
    //
    // FAIL-SAFE ABSOLUTELY: every supabaseClient.rpc call is try/caught; any
    // error / 404 (backend not deployed yet) / empty result renders NOTHING for
    // that surface (root emptied / detached) and NEVER throws or blocks the
    // screen. Credentials are read from window._gatePin / sessionStorage
    // ('calichesPin') — this file NEVER calls prompt() or withPin(). The seed
    // action is credential-cached too and surfaces failures inline + as a toast.
    //
    // BACKEND CONTRACT (confirmed against specs/GO_LIVE_17_CALENDAR_AUTOMATION.sql):
    //   app_calendar_autoseed(p_username,p_password)  [manager-gated: _cal_mgr]
    //     -> { ok, seeded_at, maintenance, catering, fundraiser, total }
    //        (or { ok:false, error })
    //   app_calendar_today(p_username,p_password,p_store)  [any authenticated]
    //     -> { ok, store, date, can_create, events:[ <cal_event cols> + color ],
    //          generated_at }
    //     each event: { id,title,category,event_date,end_date,all_day,store,market,
    //          visibility,sensitivity,source_module,status,notes,color,... }
    // ============================================================

    // Guard double-injection (safe even if the script tag is somehow included twice).
    try{ if(window.__cauCalendarAuto) return; window.__cauCalendarAuto = true; }catch(e){ return; }

    // Per-surface state. root = the preserved node re-attached after each rewrite.
    var cauSeed  = { root:null, obs:null, obsNode:null, _pend:false, busy:false };
    var cauToday = { root:null, obs:null, obsNode:null, _pend:false, seq:0, storeKey:'', loaded:false, items:null };

    // ---- tiny shared helpers --------------------------------------------
    function cauEsc(s){ try{ if(typeof escapeHtml==='function') return escapeHtml(s==null?'':String(s)); }catch(e){} return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return '&#'+c.charCodeAt(0)+';'; }); }
    function cauReady(){ try{ return !!(currentUser && currentUser.username); }catch(e){ return false; } }
    function cauInt(n){ var x=parseInt(n,10); return isNaN(x)?0:x; }
    function cauTitle(s){ s=String(s||'').replace(/[_-]+/g,' ').trim(); return s?s.charAt(0).toUpperCase()+s.slice(1):''; }
    function cauCatLabel(k){ return cauTitle(k)||'Event'; }
    function cauDate(d){ if(!d) return ''; var s=String(d); var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m){ var dt=new Date(+m[1],+m[2]-1,+m[3]); if(!isNaN(dt.getTime())) return dt.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}); } return s.slice(0,10); }
    function cauTodayIso(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }

    // Credentials WITHOUT prompt()/withPin — auto-render safe. Read the cached PIN a
    // logged-in user already has (js/02 mirrors sessionPin onto window._gatePin; js/01
    // persists it to sessionStorage 'calichesPin'). Null -> the surface stands down.
    function cauPin(){
        try{ if(window._gatePin) return window._gatePin; }catch(e){}
        try{ var p=sessionStorage.getItem('calichesPin'); if(p) return p; }catch(e){}
        return null;
    }

    // Single fail-safe RPC wrapper. Never throws, never prompts, never alerts; every
    // failure path (missing client / user / pin, no-promise, .error, rejected, 404)
    // funnels to onerr so the caller can quietly render nothing.
    function cauRpc(name,args,cb,onerr){
        try{
            if(typeof supabaseClient==='undefined' || !supabaseClient || typeof supabaseClient.rpc!=='function'){ if(onerr) onerr({message:'unavailable'}); return; }
            if(!currentUser || !currentUser.username){ if(onerr) onerr({message:'unauth'}); return; }
            var pin=cauPin(); if(!pin){ if(onerr) onerr({message:'nopin'}); return; }
            var pr=supabaseClient.rpc(name, Object.assign({p_username:currentUser.username, p_password:pin}, args||{}));
            if(!pr || typeof pr.then!=='function'){ if(onerr) onerr({message:'nopromise'}); return; }
            pr.then(function(r){ try{ if(r && r.error){ if(onerr) onerr(r.error); return; } if(cb) cb(r?r.data:null); }catch(e){ if(onerr) onerr({message:'cb'}); } })
              .catch(function(){ if(onerr) onerr({message:'connection'}); });
        }catch(e){ if(onerr) onerr({message:'connection'}); }
    }
    function cauErrMsg(e){ var m=String((e&&e.message)||'').toLowerCase();
        if(m.indexOf('forbidden')>=0 || m.indexOf('not authorized')>=0) return 'Managers only.';
        if(m.indexOf('nopin')>=0 || m.indexOf('unauth')>=0) return 'Please re-enter your PIN to run this.';
        return 'Could not complete. Please try again.'; }

    // Small self-contained toast (mirrors js/20 inspToast look; independent of any
    // overlay so it survives a screen rewrite). z-index sits above #calModal (100050).
    function cauToast(msg){
        try{
            var t=document.createElement('div');
            t.textContent=String(msg==null?'':msg);
            t.style.cssText='position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#1f2a44;color:#fff;padding:10px 16px;border-radius:10px;font-size:12.5px;font-weight:700;z-index:100061;box-shadow:0 6px 18px rgba(0,0,0,.25);max-width:88%;text-align:center;';
            document.body.appendChild(t);
            setTimeout(function(){ t.style.transition='opacity .4s'; t.style.opacity='0'; setTimeout(function(){ try{ document.body.removeChild(t); }catch(e){} },450); },3600);
        }catch(e){}
    }

    // The screen's centered content column is the last direct child of the overlay
    // carrying a max-width style. Our own root (no max-width) is skipped.
    function cauContentHost(ov, root){
        try{ var kids=ov.children||[]; for(var i=kids.length-1;i>=0;i--){ var k=kids[i]; if(!k || k===root) continue; var stl=(k.getAttribute && k.getAttribute('style'))||''; if(/max-width/.test(stl)) return k; } }catch(e){}
        return null;
    }
    function cauDetach(node){ try{ if(node && node.parentNode) node.parentNode.removeChild(node); }catch(e){} }

    // Debounced per-surface sync scheduler + a MutationObserver that fires it.
    function cauSchedule(state, syncFn){ if(state._pend) return; state._pend=true; setTimeout(function(){ state._pend=false; try{ syncFn(); }catch(e){} },0); }
    function cauEnsureObs(state, overlayId, syncFn){
        try{
            var ov=document.getElementById(overlayId); if(!ov) return;
            if(state.obs && state.obsNode===ov) return;
            if(typeof MutationObserver==='undefined') return;
            if(state.obs){ try{ state.obs.disconnect(); }catch(e){} }
            state.obs=new MutationObserver(function(){ cauSchedule(state, syncFn); });
            state.obs.observe(ov,{childList:true, subtree:true});
            state.obsNode=ov;
        }catch(e){}
    }
    // Append-only wrap of a global open function (same pattern as js/33 / js/34).
    function cauWrap(fnName, onOpen){
        try{
            var cur=window[fnName];
            if(typeof cur==='function' && !cur.__cauWrapped){
                var wrapped=(function(orig){
                    function w(){ var r; try{ r=orig.apply(this,arguments); }catch(e){ r=undefined; } try{ onOpen(); }catch(e){} return r; }
                    w.__cauWrapped=true; return w;
                })(cur);
                window[fnName]=wrapped;
            }
            return (typeof window[fnName]==='function' && window[fnName].__cauWrapped===true);
        }catch(e){ return false; }
    }

    // ---- manager gate for the SEED button (View-As aware) ----------------
    // Mirrors the backend _cal_mgr authority EXACTLY (GO_LIVE_8): manager / admin /
    // owner / vp / vice president / president / director / supervisor / marketing /
    // catering / vending. Plain leads are NOT calendar managers. Developer bypass
    // only when NOT actively previewing a lower role.
    function cauRole(){ try{ return String((typeof effectiveRole==='function'?effectiveRole():'')||(currentUser&&currentUser.role)||'').toLowerCase(); }catch(e){ try{ return String((currentUser&&currentUser.role)||'').toLowerCase(); }catch(_){ return ''; } } }
    function cauDev(){ try{ if(window._viewAsRole && typeof canUseViewAs==='function' && canUseViewAs()) return false; }catch(e){} try{ return !!(currentUser && currentUser.is_developer===true); }catch(e){ return false; } }
    function cauIsMgr(){ var r=cauRole(); var t=['manager','admin','owner','vice president','vp','president','director','supervisor','marketing','catering','vending']; for(var i=0;i<t.length;i++){ if(r.indexOf(t[i])>=0) return true; } return cauDev(); }

    // ══════════════════════════════════════════════════════════════════════
    // A) SEED button — Company Calendar (#calModal), managers only
    // ══════════════════════════════════════════════════════════════════════
    function cauSeedRoot(){ if(!cauSeed.root){ var r=document.createElement('div'); r.id='cauSeedRoot'; cauSeed.root=r; } return cauSeed.root; }

    function cauSeedRenderDefault(){
        var root=cauSeedRoot();
        root.innerHTML='<div style="background:#fff;border:1px solid #eef0f5;border-left:4px solid #EC3E7E;border-radius:12px;padding:12px 14px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,.04);">'+
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><b style="flex:1;font-size:13px;color:#1f2a44;">&#9889; Calendar automation</b><span style="font-size:10px;font-weight:800;color:#9a5b00;background:#fff4e0;padding:2px 7px;border-radius:99px;">MANAGERS</span></div>'+
            '<div style="font-size:11.5px;color:#6b7686;margin-bottom:8px;">Pull equipment PM, catering / vending and fundraiser dates onto the calendar. Safe to run anytime &mdash; already-seeded dates are never duplicated.</div>'+
            '<button id="cauSeedBtn" onclick="cauSeedRun()" style="background:#106AB3;color:#fff;border:none;border-radius:9px;padding:9px 13px;font-size:12.5px;font-weight:800;cursor:pointer;">&#128197; Auto-seed calendar from PM/catering/fundraiser dates</button>'+
            '<div id="cauSeedStatus" style="font-size:11.5px;color:#6b7686;margin-top:8px;"></div>'+
        '</div>';
    }

    function cauSeedSync(){
        try{
            if(!cauReady()){ cauDetach(cauSeed.root); return; }
            if(!cauIsMgr()){ cauDetach(cauSeed.root); return; }            // role flipped (View-As) -> hide
            var ov=document.getElementById('calModal'); if(!ov) return;
            if(ov.style && ov.style.display==='none'){ cauDetach(cauSeed.root); return; }
            var host=cauContentHost(ov, cauSeed.root); if(!host) return;
            // Only on the Calendar tab: js/30's calRenderCalendar footer carries this
            // unique marker; the Inbox / Announcements tabs never do.
            if((host.innerHTML||'').indexOf('sensitivity-filtered')<0){ cauDetach(cauSeed.root); return; }
            var root=cauSeedRoot();
            if(root.parentNode!==host){ try{ host.insertBefore(root, host.firstChild); }catch(e){ return; } }
            if(!root.firstChild) cauSeedRenderDefault();                    // (re)paint only when empty; busy state persists
        }catch(e){}
    }

    // User-initiated seed (still no prompt — uses the cached PIN). Idempotent + guarded.
    window.cauSeedRun=function(){
        try{
            if(cauSeed.busy) return;
            var st=document.getElementById('cauSeedStatus');
            var pin=cauPin();
            if(!pin){ if(st){ st.style.color='#9a5b00'; st.innerHTML='Please re-enter your PIN to run this.'; } return; }
            cauSeed.busy=true;
            var btn=document.getElementById('cauSeedBtn'); if(btn){ btn.disabled=true; btn.style.opacity='0.7'; btn.style.cursor='default'; }
            if(st){ st.style.color='#6b7686'; st.innerHTML='Seeding the calendar from PM, catering &amp; fundraiser dates&hellip;'; }
            cauRpc('app_calendar_autoseed', {}, function(d){
                cauSeed.busy=false;
                var b=document.getElementById('cauSeedBtn'); if(b){ b.disabled=false; b.style.opacity='1'; b.style.cursor='pointer'; }
                var s=document.getElementById('cauSeedStatus');
                if(d && d.ok===false){ if(s){ s.style.color='#a01b3e'; s.innerHTML='Could not auto-seed'+(d.error?(': '+cauEsc(String(d.error))):'')+'.'; } cauToast('Calendar auto-seed failed.'); return; }
                var mt=cauInt(d&&d.maintenance), cv=cauInt(d&&d.catering), fr=cauInt(d&&d.fundraiser);
                var total=(d&&d.total!=null)?cauInt(d.total):(mt+cv+fr);
                var breakdown=mt+' maintenance, '+cv+' catering, '+fr+' fundraiser';
                if(total>0){
                    if(s){ s.style.color='#1b7a3d'; s.innerHTML='Added '+total+' event'+(total===1?'':'s')+' to the calendar &middot; '+breakdown+'.'; }
                    cauToast('Calendar seeded: '+total+' new event'+(total===1?'':'s')+' ('+breakdown+').');
                    try{ if(typeof calLoad==='function') calLoad(); }catch(e){}   // refresh so the new events show
                } else {
                    if(s){ s.style.color='#5b6675'; s.innerHTML='Calendar already up to date &mdash; no new dates to add.'; }
                    cauToast('Calendar already up to date — 0 new events.');
                }
            }, function(e){
                cauSeed.busy=false;
                var b=document.getElementById('cauSeedBtn'); if(b){ b.disabled=false; b.style.opacity='1'; b.style.cursor='pointer'; }
                var s=document.getElementById('cauSeedStatus');
                if(s){ s.style.color='#a01b3e'; s.innerHTML=cauEsc(cauErrMsg(e)); }
                cauToast('Could not auto-seed the calendar.');
            });
        }catch(e){ try{ cauSeed.busy=false; }catch(_e){} }
    };

    // On each open, reset to the pristine button (unless a seed is mid-flight), then
    // nudge a few syncs to catch js/30's async first paint (Loading -> rendered).
    function cauSeedOnOpen(){
        try{ if(cauSeed.root && !cauSeed.busy) cauSeed.root.innerHTML=''; }catch(e){}
        [0,150,400,900,1600].forEach(function(t){ setTimeout(function(){ try{ cauEnsureObs(cauSeed,'calModal',cauSeedSync); }catch(e){} cauSchedule(cauSeed,cauSeedSync); },t); });
    }

    // ══════════════════════════════════════════════════════════════════════
    // B) TODAY strip — Shift Leader Console / Run My Shift (#shiftConsoleModal)
    // ══════════════════════════════════════════════════════════════════════
    function cauTodayRoot(){ if(!cauToday.root){ var r=document.createElement('div'); r.id='cauTodayRoot'; cauToday.root=r; } return cauToday.root; }
    // Store: js/19's start-screen select if present, else the app's current-store
    // notion (tempStoreLoc / home_location) — exactly what shcStoreLoc() uses.
    function cauTodayReadStore(ov){
        try{ var sel=ov.querySelector('#shcS_loc'); if(sel && sel.value) return String(sel.value); }catch(e){}
        try{ if(typeof tempStoreLoc==='function'){ var v=tempStoreLoc(); if(v) return String(v); } }catch(e){}
        try{ if(currentUser && currentUser.home_location) return String(currentUser.home_location); }catch(e){}
        return '';
    }

    function cauTodaySync(){
        try{
            if(!cauReady()) return;
            var ov=document.getElementById('shiftConsoleModal'); if(!ov) return;
            if(ov.style && ov.style.display==='none') return;
            var host=cauContentHost(ov, cauToday.root); if(!host) return;
            var store=cauTodayReadStore(ov);
            var root=cauTodayRoot();
            if(root.parentNode!==host){ try{ host.appendChild(root); }catch(e){ return; } }
            if(!cauToday.loaded || store!==cauToday.storeKey){ cauToday.storeKey=store; cauToday.loaded=true; cauTodayLoad(store); }
        }catch(e){}
    }

    function cauTodayLoad(store){
        var seq=++cauToday.seq;
        cauRpc('app_calendar_today', {p_store: store||null}, function(d){
            if(seq!==cauToday.seq) return;
            try{ cauTodayRender(d); }catch(e){ var r=cauToday.root; if(r) r.innerHTML=''; }
        }, function(){
            if(seq!==cauToday.seq) return;
            cauToday.items=null; var r=cauToday.root; if(r) r.innerHTML='';   // error / 404 / stand down -> nothing
        });
    }

    function cauTodayRow(ev){
        ev=ev||{};
        var col=ev.color||'#106AB3';
        var cat=ev.category?('<span style="font-size:9.5px;font-weight:800;color:#fff;background:'+col+';border-radius:99px;padding:1px 7px;">'+cauEsc(cauCatLabel(ev.category))+'</span>'):'';
        var store=ev.store?('<span style="font-size:10px;color:#5b6675;background:#eef0f3;border-radius:99px;padding:1px 7px;">'+cauEsc(ev.store)+'</span>'):'<span style="font-size:10px;color:#106AB3;background:#eef3fb;border-radius:99px;padding:1px 7px;">Company-wide</span>';
        var src=(ev.source_module && ev.source_module!=='manual')?('<span style="font-size:9.5px;color:#8a6d3b;background:#fbf4e8;border-radius:99px;padding:1px 7px;">from '+cauEsc(ev.source_module)+'</span>'):'';
        var when=(ev.all_day===false)?'':'<span style="font-size:10px;color:#98a2b0;">All day</span>';
        var multi=(ev.end_date && ev.end_date!==ev.event_date)?('<span style="font-size:10px;color:#98a2b0;">thru '+cauEsc(cauDate(ev.end_date))+'</span>'):'';
        var notes=ev.notes?('<div style="font-size:11.5px;color:#6b6275;margin-top:3px;white-space:pre-wrap;">'+cauEsc(ev.notes)+'</div>'):'';
        var meta=[cat,store,src,when,multi].filter(Boolean).join(' ');
        return '<div style="display:flex;align-items:flex-start;gap:9px;padding:9px 0;border-top:1px solid #f0f2f6;">'+
            '<span style="width:4px;align-self:stretch;min-height:22px;background:'+col+';border-radius:99px;flex:none;"></span>'+
            '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;color:#26242b;line-height:1.35;">'+cauEsc(ev.title||'(untitled)')+'</div>'+
            (meta?('<div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:3px;">'+meta+'</div>'):'')+notes+'</div></div>';
    }

    function cauTodayRender(d){
        var root=cauTodayRoot();
        var events=(d&&d.events)||[]; cauToday.items=events;
        if(!events.length){ root.innerHTML=''; return; }                    // nothing today -> render nothing
        var dateLbl=cauDate((d&&d.date)||cauTodayIso());
        root.innerHTML='<div style="background:#fff;border:1px solid #ececf2;border-left:4px solid #EC3E7E;border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,.04);">'+
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><b style="flex:1;font-size:12px;font-weight:800;text-transform:uppercase;color:#EC3E7E;letter-spacing:.3px;">&#128197; Today on the calendar</b><span style="font-size:10.5px;color:#98a2b0;">'+cauEsc(dateLbl)+'</span></div>'+
            '<div style="font-size:11.5px;color:#6b7686;margin-bottom:6px;">Events live today for your store &mdash; from the Company Calendar.</div>'+
            events.map(cauTodayRow).join('')+
        '</div>';
    }

    function cauTodayOnOpen(){
        cauToday.loaded=false; cauToday.storeKey='';
        [0,150,400,900,1600].forEach(function(t){ setTimeout(function(){ try{ cauEnsureObs(cauToday,'shiftConsoleModal',cauTodaySync); }catch(e){} cauSchedule(cauToday,cauTodaySync); },t); });
    }

    // ══════════════════════════════════════════════════════════════════════
    // INSTALL — append-only wraps of the two entry points (+ poll fallback),
    // then safety nets in case either overlay is already open at load.
    // ══════════════════════════════════════════════════════════════════════
    (function initWraps(){
        function tryWrap(){
            var a=cauWrap('openCompanyCalendar', cauSeedOnOpen);
            var b=cauWrap('openShiftConsole', cauTodayOnOpen);
            cauWrap('openShiftConsoleInner', cauTodayOnOpen);   // belt-and-suspenders (js/19 continues an active shift)
            return a && b;
        }
        if(tryWrap()) return;
        var tries=0; var iv=setInterval(function(){ tries++; if(tryWrap() || tries>60){ clearInterval(iv); } },100);
    })();

    try{ var _c=document.getElementById('calModal'); if(_c && _c.style && _c.style.display!=='none'){ cauEnsureObs(cauSeed,'calModal',cauSeedSync); cauSchedule(cauSeed,cauSeedSync); } }catch(e){}
    try{ var _s=document.getElementById('shiftConsoleModal'); if(_s && _s.style && _s.style.display!=='none'){ cauEnsureObs(cauToday,'shiftConsoleModal',cauTodaySync); cauSchedule(cauToday,cauTodaySync); } }catch(e){}
})();
