(function(){
    // ============================================================
    // STORE PRIORITIES  (js/34_store_priorities.js)  — GO_LIVE_16 surface
    // Self-contained, append-only. Edits NOTHING else (not index.html, not
    // rpc_manifest.json, not js/28, not js/19). It injects TWO independently
    // fail-safe panels into two existing screens:
    //   1) MANAGER panel  -> Manager Action Center overlay #macModal
    //      (opened by window.openManagerActionCenter() in js/28). Create /
    //      edit / approve (draft->active) / retire + the feed with per-priority
    //      shift-leader acknowledgment counts. Manager-gated (View-As aware).
    //   2) SHIFT panel    -> Shift Leader Console overlay #shiftConsoleModal
    //      (opened by openShiftConsole() in js/19). A read-only, active-only
    //      board with an "Acknowledge" button. Any authenticated user (the
    //      shift feed RPC is the real gate) — shift leads acknowledge, never author.
    //
    // INJECTION (same proven pattern as js/33_scorecard_depth.js): js/28's
    // macRender() and js/19's shcRenderConsole() overwrite their overlay's
    // innerHTML on every render, so each panel keeps ONE preserved root node
    // (spfM.root / spfS.root) and re-appends it to the screen's centered content
    // column (the last child carrying a max-width style) after every rewrite,
    // watched by a MutationObserver on the overlay (debounced re-sync) plus an
    // append-only wrap of the screen's open function. The MANAGER panel reads the
    // currently-selected store straight from js/28's own store <select>
    // (select[onchange*="macSetStore"]) — no coupling to js/28's private state;
    // the SHIFT panel reads the store from js/19's #shcS_loc / tempStoreLoc().
    //
    // FAIL-SAFE ABSOLUTELY: every supabaseClient.rpc call is try/caught; any
    // error / 404 (backend not deployed yet) / empty result renders NOTHING for
    // that panel (root emptied / detached) and NEVER throws or blocks the screen.
    // Credentials are read from window._gatePin / sessionStorage('calichesPin') —
    // this file NEVER calls prompt() or withPin() on an auto-render path. Write
    // actions (also credential-cached, no prompt) surface errors inline only.
    //
    // BACKEND CONTRACT (confirmed against specs/GO_LIVE_16_STORE_PRIORITIES.sql):
    //   app_priority_create(p_username,p_password,p_store,p_title,p_detail,p_sort)
    //     -> { ok, id, status }
    //   app_priority_edit(p_username,p_password,p_id,p_title,p_detail,p_sort)
    //     -> { ok, id }
    //   app_priority_approve(p_username,p_password,p_id) -> { ok, id, status }
    //   app_priority_retire(p_username,p_password,p_id)  -> { ok, id, status }
    //   app_priority_feed(p_username,p_password,p_store)  [MANAGER, any status]
    //     -> { store, count, items:[ {id,store,title,detail,status,sort,created_by,
    //          approved_by,created_at,approved_at,retired_at,updated_at,
    //          ack_count, acks:[{user_id,name,ack_at}] } ] }
    //   app_priority_shift_feed(p_username,p_password,p_store) [SANITIZED, active]
    //     -> { store, count, items:[ {id,store,title,detail,sort,acked,ack_at} ] }
    //   app_priority_ack(p_username,p_password,p_priority_id)
    //     -> { ok, priority_id, ack_at, ack_count }
    // ============================================================

    // Guard double-injection (safe even if the script tag is somehow included twice).
    try{ if(window.__spfStorePriorities) return; window.__spfStorePriorities = true; }catch(e){ return; }

    // Per-panel state. root = the preserved node re-appended after each rewrite.
    var spfM = { store:null, seq:0, root:null, obs:null, obsNode:null, items:null, loaded:false, editId:null, _pend:false };
    var spfS = { storeKey:'', seq:0, root:null, obs:null, obsNode:null, items:null, loaded:false, _pend:false };

    // ---- tiny shared helpers --------------------------------------------
    function spfEsc(s){ try{ if(typeof escapeHtml==='function') return escapeHtml(s==null?'':String(s)); }catch(e){} return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return '&#'+c.charCodeAt(0)+';'; }); }
    function spfReady(){ try{ return !!(currentUser && currentUser.username); }catch(e){ return false; } }
    function spfInt(n){ var x=parseInt(n,10); return isNaN(x)?0:x; }
    function spfDate(d){ if(!d) return ''; var s=String(d); var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m){ var dt=new Date(+m[1],+m[2]-1,+m[3]); if(!isNaN(dt.getTime())) return dt.toLocaleDateString(undefined,{month:'short',day:'numeric'}); } return s.slice(0,10); }

    // Credentials WITHOUT prompt()/withPin — auto-render safe. Read the cached PIN a
    // logged-in user already has (js/02 mirrors sessionPin onto window._gatePin; js/01
    // persists it to sessionStorage 'calichesPin'). Null -> the panel stands down.
    function spfPin(){
        try{ if(window._gatePin) return window._gatePin; }catch(e){}
        try{ var p=sessionStorage.getItem('calichesPin'); if(p) return p; }catch(e){}
        return null;
    }

    // Single fail-safe RPC wrapper. Never throws, never prompts, never alerts; every
    // failure path (missing client / user / pin, no-promise, .error, rejected, 404)
    // funnels to onerr so the caller can quietly render nothing.
    function spfRpc(name,args,cb,onerr){
        try{
            if(typeof supabaseClient==='undefined' || !supabaseClient || typeof supabaseClient.rpc!=='function'){ if(onerr) onerr({message:'unavailable'}); return; }
            if(!currentUser || !currentUser.username){ if(onerr) onerr({message:'unauth'}); return; }
            var pin=spfPin(); if(!pin){ if(onerr) onerr({message:'nopin'}); return; }
            var pr=supabaseClient.rpc(name, Object.assign({p_username:currentUser.username, p_password:pin}, args||{}));
            if(!pr || typeof pr.then!=='function'){ if(onerr) onerr({message:'nopromise'}); return; }
            pr.then(function(r){ try{ if(r && r.error){ if(onerr) onerr(r.error); return; } if(cb) cb(r?r.data:null); }catch(e){ if(onerr) onerr({message:'cb'}); } })
              .catch(function(){ if(onerr) onerr({message:'connection'}); });
        }catch(e){ if(onerr) onerr({message:'connection'}); }
    }
    function spfErrMsg(e){ var m=String((e&&e.message)||'').toLowerCase();
        if(m.indexOf('forbidden')>=0) return 'Managers only.';
        if(m.indexOf('store_required')>=0) return 'Pick a store first.';
        if(m.indexOf('title_required')>=0) return 'Enter a title.';
        if(m.indexOf('not_found')>=0) return 'That item no longer exists.';
        if(m.indexOf('already_retired')>=0 || m.indexOf('retired')>=0) return 'That priority is retired.';
        if(m.indexOf('not_draft')>=0) return 'Already approved.';
        if(m.indexOf('not_active')>=0) return 'That priority is no longer active.';
        if(m.indexOf('nopin')>=0 || m.indexOf('unauth')>=0) return 'Please re-enter your PIN.';
        return 'Could not complete. Please try again.'; }

    // Shared UI atoms (match the app's inline-style look).
    function spfBtn(label,onclick,kind){ var bg=kind==='primary'?'#1f7a3d':(kind==='danger'?'#c0264b':(kind==='ghost'?'#eef0f3':'#185FA5')); var col=kind==='ghost'?'#33404e':'#fff'; return '<button onclick="'+onclick+'" style="background:'+bg+';color:'+col+';border:none;border-radius:8px;padding:7px 11px;font-size:12px;font-weight:700;cursor:pointer;margin:4px 4px 0 0;">'+label+'</button>'; }
    function spfStatusPill(st){ st=String(st||'').toLowerCase(); var c; if(st==='active') c=['#e8f5ec','#1b7a3d','Active']; else if(st==='retired') c=['#f3eef0','#8a7f86','Retired']; else c=['#eef0f3','#5b6472','Draft']; return '<span style="background:'+c[0]+';color:'+c[1]+';font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;text-transform:uppercase;letter-spacing:.3px;">'+c[2]+'</span>'; }

    // The screen's centered content column is the last direct child of the overlay
    // carrying a max-width style (js/28 uses 860, js/19 uses 760). Our own root is skipped.
    function spfContentHost(ov, root){
        try{ var kids=ov.children||[]; for(var i=kids.length-1;i>=0;i--){ var k=kids[i]; if(!k || k===root) continue; var stl=(k.getAttribute && k.getAttribute('style'))||''; if(/max-width/.test(stl)) return k; } }catch(e){}
        return null;
    }

    // Debounced per-panel sync scheduler + a MutationObserver that fires it.
    function spfSchedule(state, syncFn){ if(state._pend) return; state._pend=true; setTimeout(function(){ state._pend=false; try{ syncFn(); }catch(e){} },0); }
    function spfEnsureObs(state, overlayId, syncFn){
        try{
            var ov=document.getElementById(overlayId); if(!ov) return;
            if(state.obs && state.obsNode===ov) return;
            if(typeof MutationObserver==='undefined') return;
            if(state.obs){ try{ state.obs.disconnect(); }catch(e){} }
            state.obs=new MutationObserver(function(){ spfSchedule(state, syncFn); });
            state.obs.observe(ov,{childList:true, subtree:true});
            state.obsNode=ov;
        }catch(e){}
    }
    // Append-only wrap of a global open function (same pattern as js/33 / js/31).
    function spfWrap(fnName, onOpen){
        try{
            var cur=window[fnName];
            if(typeof cur==='function' && !cur.__spfWrapped){
                var wrapped=(function(orig){
                    function w(){ var r; try{ r=orig.apply(this,arguments); }catch(e){ r=undefined; } try{ onOpen(); }catch(e){} return r; }
                    w.__spfWrapped=true; return w;
                })(cur);
                window[fnName]=wrapped;
            }
            return (typeof window[fnName]==='function' && window[fnName].__spfWrapped===true);
        }catch(e){ return false; }
    }

    // ---- role gate for the MANAGER panel (View-As aware) -----------------
    // Mirrors js/33 scdIsMgr / the backend _sp_is_store_mgmt: managers / admin /
    // owner / VP / president / director; shift & team leads excluded. Developer
    // bypass only when NOT actively previewing a lower role.
    function spfRole(){ try{ return String((typeof effectiveRole==='function'?effectiveRole():'')||(currentUser&&currentUser.role)||'').toLowerCase(); }catch(e){ try{ return String((currentUser&&currentUser.role)||'').toLowerCase(); }catch(_){ return ''; } } }
    function spfDev(){ try{ if(window._viewAsRole && typeof canUseViewAs==='function' && canUseViewAs()) return false; }catch(e){} try{ return !!(currentUser && currentUser.is_developer===true); }catch(e){ return false; } }
    function spfIsMgr(){ var r=spfRole(); if(r.indexOf('shift lead')>=0 || r.indexOf('team lead')>=0) return spfDev(); if(r.indexOf('manager')>=0 || r.indexOf('admin')>=0 || r.indexOf('owner')>=0 || r.indexOf('president')>=0 || r.indexOf('vice president')>=0 || r.indexOf('vp')>=0 || r.indexOf('director')>=0) return true; return spfDev(); }

    // ══════════════════════════════════════════════════════════════════════
    // MANAGER PANEL — Manager Action Center (#macModal)
    // ══════════════════════════════════════════════════════════════════════
    function spfMRoot(){ if(!spfM.root){ var r=document.createElement('div'); r.id='spfMacRoot'; spfM.root=r; } return spfM.root; }
    // Read the store js/28 currently has selected (its own store <select>). '' = All stores.
    function spfMReadStore(ov){ try{ var sel=ov.querySelector('select[onchange*="macSetStore"]'); if(sel) return String(sel.value||''); }catch(e){} return ''; }

    function spfMSync(){
        try{
            var ov=document.getElementById('macModal'); if(!ov) return;
            if(ov.style && ov.style.display==='none') return;
            // Not a manager (e.g. a leader previewing a line role via View-As): stand down.
            if(!spfReady() || !spfIsMgr()){ var r=spfM.root; if(r){ r.innerHTML=''; if(r.parentNode) r.parentNode.removeChild(r); } spfM.loaded=false; spfM.store=null; return; }
            var host=spfContentHost(ov, spfM.root); if(!host) return;   // loading/spinner: no content column yet
            var store=spfMReadStore(ov);
            var root=spfMRoot();
            if(root.parentNode!==host){ try{ host.appendChild(root); }catch(e){ return; } }
            if(!spfM.loaded || store!==spfM.store){ spfM.store=store; spfM.loaded=true; spfMLoad(store); }
        }catch(e){}
    }

    function spfMLoad(store){
        var seq=++spfM.seq; var root=spfMRoot();
        if(!root.innerHTML) root.innerHTML=spfMSection('<div style="text-align:center;color:#6b7686;padding:14px;font-size:12.5px;">Loading store priorities&hellip;</div>');
        spfRpc('app_priority_feed', {p_store: store||null}, function(d){
            if(seq!==spfM.seq) return;
            var items=(d&&d.items)||[]; spfM.items=items; spfM.editId=null;
            try{ spfMRender(items, store); }catch(e){ var r=spfM.root; if(r) r.innerHTML=''; }
        }, function(){
            if(seq!==spfM.seq) return;
            var r=spfM.root; if(r) r.innerHTML='';   // error / 404 not-yet-deployed -> render nothing
        });
    }

    function spfMSection(inner){
        return '<div style="border-top:2px solid #e6ebf2;margin-top:16px;padding-top:12px;">'+
            '<div style="display:flex;align-items:center;gap:8px;margin:0 2px 10px;">'+
                '<span style="font-size:12px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;">&#128204; Store Priorities</span>'+
            '</div>'+inner+'</div>';
    }

    function spfMCreateForm(store){
        if(!store){ return '<div style="background:#f7f8fb;border:1px dashed #d6deea;border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:#6b7280;">Select a store in the filter above to add a priority for it.</div>'; }
        return '<div style="background:#f7f8fb;border:1px solid #eef0f5;border-radius:10px;padding:10px;margin-bottom:12px;">'+
            '<div style="font-size:11px;font-weight:800;color:#6b7280;margin-bottom:6px;">New priority for '+spfEsc(store)+'</div>'+
            '<input id="spfM_title" type="text" placeholder="Title (what to focus on)" style="width:100%;box-sizing:border-box;border:1px solid #cdd5e0;border-radius:8px;padding:8px 9px;font-size:13px;margin-bottom:6px;">'+
            '<textarea id="spfM_detail" rows="2" placeholder="Detail (optional)" style="width:100%;box-sizing:border-box;border:1px solid #cdd5e0;border-radius:8px;padding:8px 9px;font-size:12.5px;margin-bottom:6px;resize:vertical;"></textarea>'+
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'+
                '<label style="font-size:11px;color:#6b7280;">Order <input id="spfM_sort" type="number" placeholder="0" style="width:66px;border:1px solid #cdd5e0;border-radius:8px;padding:6px 8px;font-size:12px;margin-left:4px;"></label>'+
                spfBtn('&#10133; Add draft','spfMCreate()','primary')+
                '<span id="spfM_cstatus" style="font-size:11px;color:#6b6275;"></span>'+
            '</div>'+
            '<div style="font-size:10.5px;color:#98a2b0;margin-top:6px;">Starts as a draft &mdash; Approve it to show it on the shift board.</div>'+
        '</div>';
    }

    function spfMAckLine(it){
        var n=spfInt(it.ack_count); var acks=(it.acks)||[];
        if(!n) return '<div style="font-size:11px;color:#98a2b0;margin-top:4px;">Not yet acknowledged by any shift lead.</div>';
        var shown=acks.slice(0,5).map(function(a){ return spfEsc((a&&a.name)||'someone'); }).join(', ');
        var more=n-Math.min(5, acks.length); if(more>0) shown+=' +'+more+' more';
        return '<div style="font-size:11px;color:#1b7a3d;font-weight:600;margin-top:4px;">&#10003; '+n+' acknowledgment'+(n===1?'':'s')+(shown?(' <span style="color:#6b6275;font-weight:400;">&middot; '+shown+'</span>'):'')+'</div>';
    }

    function spfMEditRow(it){
        return '<div style="background:#f7f9fc;border:1px solid #d6deea;border-radius:10px;padding:10px 12px;margin-bottom:8px;">'+
            '<div style="font-size:11px;font-weight:800;color:#6b7280;margin-bottom:6px;">Edit priority</div>'+
            '<input id="spfM_et_'+it.id+'" value="'+spfEsc(it.title||'')+'" style="width:100%;box-sizing:border-box;border:1px solid #cdd5e0;border-radius:8px;padding:8px 9px;font-size:13px;margin-bottom:6px;">'+
            '<textarea id="spfM_ed_'+it.id+'" rows="2" style="width:100%;box-sizing:border-box;border:1px solid #cdd5e0;border-radius:8px;padding:8px 9px;font-size:12.5px;margin-bottom:6px;resize:vertical;">'+spfEsc(it.detail||'')+'</textarea>'+
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'+
                '<label style="font-size:11px;color:#6b7280;">Order <input id="spfM_es_'+it.id+'" type="number" value="'+spfEsc(String(it.sort==null?0:it.sort))+'" style="width:66px;border:1px solid #cdd5e0;border-radius:8px;padding:6px 8px;font-size:12px;margin-left:4px;"></label>'+
                spfBtn('Save','spfMEditSave('+it.id+')','primary')+spfBtn('Cancel','spfMEditCancel()','ghost')+
            '</div>'+
        '</div>';
    }

    function spfMRow(it){
        it=it||{};
        if(spfM.editId!=null && String(spfM.editId)===String(it.id)) return spfMEditRow(it);
        var st=String(it.status||'').toLowerCase();
        var meta=[];
        if(!spfM.store && it.store) meta.push('&#127970; '+spfEsc(it.store));
        if(it.created_by) meta.push('by '+spfEsc(it.created_by));
        if(st==='active' && it.approved_by) meta.push('approved '+spfEsc(it.approved_by));
        if(st==='retired' && it.retired_at) meta.push('retired '+spfEsc(spfDate(it.retired_at)));
        var metaLine=meta.length?('<div style="font-size:10.5px;color:#98a2b0;margin-top:3px;">'+meta.join(' &middot; ')+'</div>'):'';
        var detail=it.detail?('<div style="font-size:12px;color:#5b6675;margin-top:3px;white-space:pre-wrap;">'+spfEsc(it.detail)+'</div>'):'';
        var ack=(st==='active')?spfMAckLine(it):'';
        var acts='';
        if(st==='draft'){ acts=spfBtn('&#10003; Approve','spfMApprove('+it.id+')','primary')+spfBtn('Edit','spfMEditStart('+it.id+')','ghost')+spfBtn('Retire','spfMRetire('+it.id+')','danger'); }
        else if(st==='active'){ acts=spfBtn('Edit','spfMEditStart('+it.id+')','ghost')+spfBtn('Retire','spfMRetire('+it.id+')','danger'); }
        var accent=(st==='active')?'#1b7a3d':(st==='retired'?'#c8b8c0':'#9aa3b0');
        return '<div style="background:#fff;border:1px solid #eef0f5;border-left:3px solid '+accent+';border-radius:10px;padding:10px 12px;margin-bottom:8px;">'+
            '<div style="font-size:13.5px;font-weight:700;color:#26242b;line-height:1.35;">'+spfEsc(it.title||'(untitled)')+' '+spfStatusPill(st)+'</div>'+
            detail+metaLine+ack+
            (acts?('<div style="margin-top:6px;">'+acts+'</div>'):'')+
        '</div>';
    }

    function spfMRender(items, store){
        var root=spfMRoot();
        var create=spfMCreateForm(store);
        var list;
        if(items && items.length){ list=items.map(spfMRow).join(''); }
        else { list='<div style="text-align:center;color:#8a93a2;font-size:12.5px;padding:10px 6px;">No priorities yet'+(store?(' for '+spfEsc(store)):'')+'.</div>'; }
        var status='<div id="spfM_pstatus" style="font-size:11.5px;color:#6b6275;margin-top:8px;"></div>';
        root.innerHTML=spfMSection(create+list+status);
    }

    // ---- manager write handlers (user-initiated; still no prompt) --------
    window.spfMCreate=function(){
        var store=spfM.store; var st=document.getElementById('spfM_cstatus');
        if(!store){ if(st){ st.style.color='#9a5b00'; st.innerHTML='Pick a store in the filter above first.'; } return; }
        var t=document.getElementById('spfM_title'), d=document.getElementById('spfM_detail'), s=document.getElementById('spfM_sort');
        var title=t?String(t.value).trim():''; if(!title){ if(st){ st.style.color='#9a5b00'; st.innerHTML='Enter a title.'; } if(t) t.focus(); return; }
        var detail=d?String(d.value):''; var sortRaw=s?String(s.value).trim():''; var sort=sortRaw===''?0:parseInt(sortRaw,10); if(isNaN(sort)) sort=0;
        if(st){ st.style.color='#6b6275'; st.innerHTML='Adding&hellip;'; }
        spfRpc('app_priority_create', {p_store:store, p_title:title, p_detail:detail, p_sort:sort}, function(){ spfMLoad(store); }, function(e){ if(st){ st.style.color='#a01b3e'; st.innerHTML=spfErrMsg(e); } });
    };
    function spfMAct(name,args){
        var st=document.getElementById('spfM_pstatus'); if(st){ st.style.color='#6b6275'; st.innerHTML='Working&hellip;'; }
        spfRpc(name,args,function(){ spfMLoad(spfM.store); }, function(e){ if(st){ st.style.color='#a01b3e'; st.innerHTML=spfErrMsg(e); } });
    }
    window.spfMApprove=function(id){ spfMAct('app_priority_approve',{p_id:id}); };
    window.spfMRetire=function(id){ spfMAct('app_priority_retire',{p_id:id}); };
    window.spfMEditStart=function(id){ spfM.editId=id; try{ spfMRender(spfM.items||[], spfM.store); }catch(e){} };
    window.spfMEditCancel=function(){ spfM.editId=null; try{ spfMRender(spfM.items||[], spfM.store); }catch(e){} };
    window.spfMEditSave=function(id){
        var t=document.getElementById('spfM_et_'+id), d=document.getElementById('spfM_ed_'+id), s=document.getElementById('spfM_es_'+id);
        var st=document.getElementById('spfM_pstatus');
        var title=t?String(t.value).trim():''; if(!title){ if(st){ st.style.color='#9a5b00'; st.innerHTML='Title cannot be empty.'; } return; }
        var detail=d?String(d.value):''; var sortRaw=s?String(s.value).trim():''; var sort=sortRaw===''?null:parseInt(sortRaw,10); if(sortRaw!=='' && isNaN(sort)) sort=null;
        if(st){ st.style.color='#6b6275'; st.innerHTML='Saving&hellip;'; }
        spfRpc('app_priority_edit', {p_id:id, p_title:title, p_detail:detail, p_sort:sort}, function(){ spfM.editId=null; spfMLoad(spfM.store); }, function(e){ if(st){ st.style.color='#a01b3e'; st.innerHTML=spfErrMsg(e); } });
    };

    function spfMOnOpen(){ spfM.store=null; spfM.loaded=false; try{ spfEnsureObs(spfM,'macModal',spfMSync); }catch(e){} spfSchedule(spfM,spfMSync); setTimeout(function(){ spfEnsureObs(spfM,'macModal',spfMSync); spfSchedule(spfM,spfMSync); },120); setTimeout(function(){ spfSchedule(spfM,spfMSync); },350); }

    // ══════════════════════════════════════════════════════════════════════
    // SHIFT PANEL — Shift Leader Console (#shiftConsoleModal)
    // ══════════════════════════════════════════════════════════════════════
    function spfSRoot(){ if(!spfS.root){ var r=document.createElement('div'); r.id='spfShcRoot'; spfS.root=r; } return spfS.root; }
    // Store: js/19's start-screen select if present, else the app's current-store
    // notion (tempStoreLoc / home_location) — exactly what shcStoreLoc() uses. '' -> all active.
    function spfSReadStore(ov){
        try{ var sel=ov.querySelector('#shcS_loc'); if(sel && sel.value) return String(sel.value); }catch(e){}
        try{ if(typeof tempStoreLoc==='function'){ var v=tempStoreLoc(); if(v) return String(v); } }catch(e){}
        try{ if(currentUser && currentUser.home_location) return String(currentUser.home_location); }catch(e){}
        return '';
    }

    function spfSSync(){
        try{
            if(!spfReady()) return;
            var ov=document.getElementById('shiftConsoleModal'); if(!ov) return;
            if(ov.style && ov.style.display==='none') return;
            var host=spfContentHost(ov, spfS.root); if(!host) return;
            var store=spfSReadStore(ov);
            var root=spfSRoot();
            if(root.parentNode!==host){ try{ host.appendChild(root); }catch(e){ return; } }
            if(!spfS.loaded || store!==spfS.storeKey){ spfS.storeKey=store; spfS.loaded=true; spfSLoad(store); }
        }catch(e){}
    }

    function spfSLoad(store){
        var seq=++spfS.seq;
        spfRpc('app_priority_shift_feed', {p_store: store||null}, function(d){
            if(seq!==spfS.seq) return;
            var items=(d&&d.items)||[]; spfS.items=items;
            try{ spfSRender(items); }catch(e){ var r=spfS.root; if(r) r.innerHTML=''; }
        }, function(){
            if(seq!==spfS.seq) return;
            spfS.items=null; var r=spfS.root; if(r) r.innerHTML='';   // error / 404 / stand down -> nothing
        });
    }

    function spfSRow(it){
        it=it||{};
        var acked=(it.acked===true);
        var detail=it.detail?('<div style="font-size:12px;color:#5b6675;margin-top:3px;white-space:pre-wrap;">'+spfEsc(it.detail)+'</div>'):'';
        var store=it.store?('<div style="margin-top:3px;"><span style="font-size:10.5px;color:#98a2b0;">&#127970; '+spfEsc(it.store)+'</span></div>'):'';
        var right=acked
            ? '<span style="flex:none;background:#e8f5ec;color:#1b7a3d;font-size:11.5px;font-weight:800;padding:6px 11px;border-radius:99px;white-space:nowrap;">&#10003; Acknowledged</span>'
            : '<button onclick="spfSAck('+it.id+',this)" style="flex:none;background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:8px 13px;font-size:12.5px;font-weight:800;cursor:pointer;white-space:nowrap;">Acknowledge</button>';
        return '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-top:1px solid #f0f2f6;">'+
            '<div style="flex:1;min-width:0;"><div style="font-size:13.5px;font-weight:700;color:#26242b;line-height:1.35;">'+spfEsc(it.title||'(untitled)')+'</div>'+detail+store+'</div>'+
            right+
        '</div>';
    }

    function spfSRender(items){
        var root=spfSRoot();
        if(!items || !items.length){ root.innerHTML=''; return; }   // empty -> render nothing
        root.innerHTML='<div style="background:#fff;border:1px solid #ececf2;border-left:4px solid #185FA5;border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,.04);">'+
            '<div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#185FA5;letter-spacing:.3px;margin-bottom:4px;">&#128204; Store Priorities</div>'+
            '<div style="font-size:11.5px;color:#6b7686;margin-bottom:6px;">From your manager &mdash; tap Acknowledge once you&rsquo;ve read each one.</div>'+
            items.map(spfSRow).join('')+
        '</div>';
    }

    window.spfSAck=function(id, btn){
        try{
            if(id==null) return;
            if(btn){ btn.disabled=true; btn.textContent='Saving…'; btn.style.opacity='0.7'; btn.style.cursor='default'; }
            spfRpc('app_priority_ack', {p_priority_id: id}, function(d){
                var items=spfS.items||[]; for(var i=0;i<items.length;i++){ if(String(items[i].id)===String(id)){ items[i].acked=true; items[i].ack_at=(d&&d.ack_at)||null; break; } }
                try{ spfSRender(items); }catch(e){}
            }, function(){ if(btn){ btn.disabled=false; btn.textContent='Try again'; btn.style.opacity='1'; btn.style.cursor='pointer'; } });
        }catch(e){ try{ if(btn) btn.disabled=false; }catch(_e){} }
    };

    function spfSOnOpen(){ spfS.storeKey=''; spfS.loaded=false; [0,150,400,900,1600].forEach(function(t){ setTimeout(function(){ try{ spfEnsureObs(spfS,'shiftConsoleModal',spfSSync); }catch(e){} spfSchedule(spfS,spfSSync); },t); }); }

    // ══════════════════════════════════════════════════════════════════════
    // INSTALL — append-only wraps of the two entry points (+ poll fallback),
    // then safety nets in case either overlay is already open at load.
    // ══════════════════════════════════════════════════════════════════════
    (function initWraps(){
        function tryWrap(){
            var a=spfWrap('openManagerActionCenter', spfMOnOpen);
            var b=spfWrap('openShiftConsole', spfSOnOpen);
            spfWrap('openShiftConsoleInner', spfSOnOpen);   // best-effort belt-and-suspenders
            return a && b;
        }
        if(tryWrap()) return;
        var tries=0; var iv=setInterval(function(){ tries++; if(tryWrap() || tries>60){ clearInterval(iv); } },100);
    })();

    try{ var _m=document.getElementById('macModal'); if(_m && _m.style && _m.style.display!=='none'){ spfEnsureObs(spfM,'macModal',spfMSync); spfSchedule(spfM,spfMSync); } }catch(e){}
    try{ var _s=document.getElementById('shiftConsoleModal'); if(_s && _s.style && _s.style.display!=='none'){ spfEnsureObs(spfS,'shiftConsoleModal',spfSSync); spfSchedule(spfS,spfSSync); } }catch(e){}
})();
