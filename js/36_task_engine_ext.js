(function(){
    // ============================================================
    // TASK ENGINE EXTENSIONS  (js/36_task_engine_ext.js)  — GO_LIVE_18 surface
    // Self-contained, append-only. Edits NOTHING else (not index.html, not
    // rpc_manifest.json, not any existing js file). It adds three independently
    // fail-safe surfaces + one helper, all riding the ONE shared task engine:
    //
    //   1) "My Tasks — all sources"  -> injected on the Tasks screen
    //      (#taskPaneMine, as a preserved sibling ABOVE #tasksMineCard, so
    //      loadMyTasks()'s innerHTML rewrite of that card never clobbers it).
    //      Role-based open work pulled from every source module via
    //      app_my_tasks_engine. Any authenticated user (the RPC is the real gate).
    //   2) "Suggested tasks" strip   -> app_task_suggest. READ-ONLY candidate
    //      templates for the caller's role/store; it never creates a task.
    //   3) Manager "Task Templates & Escalation" panel -> injected into the
    //      Admin Console (#adminConsoleView .container). List + save for BOTH
    //      task_template and task_escalation_rules. Manager-gated (View-As aware).
    //   (+) window.txeTaskLinks(module,id[,cb]) — a fail-safe helper that resolves
    //      the linked tasks for a source record (app_task_links). No obvious
    //      per-record host screen exists, so only the helper is exposed (no panel).
    //
    // INJECTION (same proven pattern as js/31_home_today.js / js/34_store_priorities):
    // append-only wraps of the global open functions (openTasks / openAdminConsole)
    // + a poll fallback + a load-time safety net if a host screen is already
    // visible. Neither host wholesale-rewrites the node we anchor to, so no
    // MutationObserver is needed — we simply re-ensure/re-load on each open.
    //
    // FAIL-SAFE ABSOLUTELY: every supabaseClient.rpc call goes through txeRpc,
    // which is fully try/caught; any error / 404 (backend not deployed yet) /
    // empty result renders NOTHING for that sub-feature (its node is emptied /
    // detached) and NEVER throws or blocks the host screen. Credentials come from
    // the cached PIN (window._gatePin / sessionPin / sessionStorage('calichesPin'))
    // — this file NEVER calls prompt() or withPin() on an auto-render path. Each
    // of the three surfaces (and the helper) is independently fail-safe.
    //
    // BACKEND CONTRACT (confirmed against specs/GO_LIVE_18_TASK_ENGINE_EXT.sql):
    //   app_my_tasks_engine(p_username,p_password)
    //     -> { user, role, store, employee_id, count,
    //          items:[{id,title,priority,status,due_date,is_overdue,owner_role,
    //                  location,source_module,source_record_id,source_deep_link,
    //                  assigned_via}] }
    //   app_task_suggest(p_username,p_password,p_context jsonb)
    //     -> { count, context:{role,store,module,keyword},
    //          suggestions:[{key,title,detail,default_role,default_store,
    //                  interval_days,source_module,priority,sensitivity,
    //                  closure_template,owner_role,score,reason}] }
    //   app_task_links(p_username,p_password,p_source_module,p_source_record_id)
    //     -> { source_module, source_record_id, count,
    //          items:[{id,title,priority,status,due_date,is_overdue,
    //                  link_direction,source_module,source_record_id,
    //                  source_action_id,source_deep_link,owner_role,location,
    //                  closed_at}] }
    //   app_task_template_list(p_username,p_password)                    [manager]
    //     -> { templates:[<task_template row>...], is_mgr:true }
    //   app_task_template_save(p_username,p_password,p_payload jsonb)    [manager]
    //     payload: key(req),title(req),detail,default_role,default_store,
    //       interval_days,source_module,priority,sensitivity,closure_template,
    //       owner_role,sort,active  -> { ok, id, key, created }
    //   app_task_escalation_list(p_username,p_password)                  [manager]
    //     -> { rules:[<task_escalation_rules row>...] }
    //   app_task_escalation_save(p_username,p_password,p_payload jsonb)  [manager]
    //     payload: id?,scope,priority(req),window_min,notify_roles(req),active,
    //       label  -> { ok, id, created }
    // ============================================================

    // Guard double-injection (safe even if the script tag is included twice).
    try{ if(window.__txe_init) return; window.__txe_init = true; }catch(e){ return; }

    var txeMy    = { seq:0, node:null };
    var txeSug   = { seq:0 };
    var txeAdmin = { tplSeq:0, escSeq:0, tplEdit:null, escEdit:null, tplItems:[], escItems:[] };

    // ---- tiny helpers ----------------------------------------------------
    function txeH(s){ try{ if(typeof escapeHtml==='function') return escapeHtml(s==null?'':String(s)); }catch(e){} return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return '&#'+c.charCodeAt(0)+';'; }); }
    function txeReady(){ try{ return !!(currentUser && currentUser.username); }catch(e){ return false; } }
    function txeInt(n){ var s=String(n==null?'':n).trim(); if(s==='') return null; var x=parseInt(s,10); return isNaN(x)?null:x; }
    function txeTitleCase(s){ s=String(s||'').replace(/[_-]+/g,' ').trim(); return s?s.charAt(0).toUpperCase()+s.slice(1):''; }
    function txeDate(d){ if(!d) return ''; var s=String(d); var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m){ var dt=new Date(+m[1],+m[2]-1,+m[3]); if(!isNaN(dt.getTime())) return dt.toLocaleDateString(undefined,{month:'short',day:'numeric'}); } return s.slice(0,10); }

    // Credentials WITHOUT prompt()/withPin — auto-render safe. Read the cached PIN
    // a logged-in user already has (js/02 mirrors sessionPin onto window._gatePin;
    // js/01 persists it to sessionStorage 'calichesPin'). Null -> panels stand down.
    function txePin(){
        try{ if(window._gatePin) return window._gatePin; }catch(e){}
        try{ if(typeof sessionPin!=='undefined' && sessionPin) return sessionPin; }catch(e){}
        try{ var p=sessionStorage.getItem('calichesPin'); if(p) return p; }catch(e){}
        return null;
    }

    // Single fail-safe RPC wrapper. Never throws, never prompts, never alerts;
    // every failure path (missing client / user / pin, no-promise, .error,
    // rejected, 404) funnels to onerr so the caller can quietly render nothing.
    function txeRpc(name,args,cb,onerr){
        try{
            if(typeof supabaseClient==='undefined' || !supabaseClient || typeof supabaseClient.rpc!=='function'){ if(onerr) onerr({message:'unavailable'}); return; }
            if(!txeReady()){ if(onerr) onerr({message:'unauth'}); return; }
            var pin=txePin(); if(!pin){ if(onerr) onerr({message:'nopin'}); return; }
            var pr=supabaseClient.rpc(name, Object.assign({p_username:currentUser.username, p_password:pin}, args||{}));
            if(!pr || typeof pr.then!=='function'){ if(onerr) onerr({message:'nopromise'}); return; }
            pr.then(function(r){ try{ if(r && r.error){ if(onerr) onerr(r.error); return; } if(cb) cb(r?r.data:null); }catch(e){ if(onerr) onerr({message:'cb'}); } })
              .catch(function(){ if(onerr) onerr({message:'connection'}); });
        }catch(e){ if(onerr) onerr({message:'connection'}); }
    }

    function txeErr(e){ var m=String((e&&e.message)||'').toLowerCase();
        if(m.indexOf('forbidden')>=0) return 'Managers only.';
        if(m.indexOf('key_required')>=0) return 'Enter a key.';
        if(m.indexOf('title_required')>=0) return 'Enter a title.';
        if(m.indexOf('bad_priority')>=0) return 'Pick a valid priority.';
        if(m.indexOf('notify_roles_required')>=0) return 'Enter at least one notify role.';
        if(m.indexOf('not_found')>=0) return 'That item no longer exists.';
        if(m.indexOf('nopin')>=0 || m.indexOf('unauth')>=0) return 'Please re-enter your PIN.';
        return 'Could not save. Please try again.'; }
    function txeMsg(el,txt,kind){ if(!el) return; var c=(kind==='warn')?'#9a5b00':((kind==='info')?'#6b6275':'#1b7a3d'); el.style.color=c; el.textContent=txt; }
    function txeFocus(id){ try{ var e=document.getElementById(id); if(e) e.focus(); }catch(_e){} }

    // Priority pill (mirrors js/28/js/31 palette).
    function txePriPill(p){ if(p==null||p==='') return ''; var k=String(p).toLowerCase(); var c;
        if(k==='critical'||k==='urgent'||k==='p1') c=['#fdeaea','#a01b3e'];
        else if(k==='high') c=['#fff4e0','#9a5b00'];
        else if(k==='low') c=['#eef0f3','#5b6472'];
        else c=['#eef3fb','#185FA5'];
        return '<span style="background:'+c[0]+';color:'+c[1]+';font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;text-transform:capitalize;margin-left:6px;">'+txeH(String(p))+'</span>'; }

    // "Assigned via" chip: direct / role / store.
    function txeViaChip(via){ via=String(via||'').toLowerCase(); var c,label;
        if(via==='direct'){ c=['#e8f0fb','#185FA5']; label='Assigned to you'; }
        else if(via==='role'){ c=['#eef7ee','#1b7a3d']; label='Your role'; }
        else if(via==='store'){ c=['#fff4e6','#9a5b00']; label='Your store'; }
        else return '';
        return '<span style="background:'+c[0]+';color:'+c[1]+';font-size:9.5px;font-weight:800;padding:2px 7px;border-radius:99px;text-transform:uppercase;letter-spacing:.3px;">'+label+'</span>'; }

    // Append-only wrap of a global open function (js/31 / js/34 pattern). Guarded
    // so it only wraps ONCE even if this file is somehow included twice.
    function txeWrap(fnName, onOpen){
        try{
            var cur=window[fnName];
            if(typeof cur==='function' && !cur.__txeWrapped){
                var wrapped=(function(orig){
                    function w(){ var r; try{ r=orig.apply(this,arguments); }catch(e){ r=undefined; } try{ onOpen(); }catch(e){} return r; }
                    w.__txeWrapped=true; return w;
                })(cur);
                window[fnName]=wrapped;
            }
            return (typeof window[fnName]==='function' && window[fnName].__txeWrapped===true);
        }catch(e){ return false; }
    }

    // ---- manager gate (View-As aware; mirrors backend _tx_is_mgr) --------
    // Managers / admin / owner / VP / president / director; shift & team leads
    // excluded. Developer bypass only when NOT actively previewing a lower role.
    function txeRole(){ try{ return String((typeof effectiveRole==='function'?effectiveRole():'')||(currentUser&&currentUser.role)||'').toLowerCase(); }catch(e){ try{ return String((currentUser&&currentUser.role)||'').toLowerCase(); }catch(_e){ return ''; } } }
    function txeDev(){ try{ if(window._viewAsRole && typeof canUseViewAs==='function' && canUseViewAs()) return false; }catch(e){} try{ return !!(currentUser && currentUser.is_developer===true); }catch(e){ return false; } }
    function txeIsMgr(){ var r=txeRole(); if(r.indexOf('shift lead')>=0 || r.indexOf('team lead')>=0) return txeDev(); if(r.indexOf('manager')>=0 || r.indexOf('admin')>=0 || r.indexOf('owner')>=0 || r.indexOf('president')>=0 || r.indexOf('vice president')>=0 || r.indexOf('vp')>=0 || r.indexOf('director')>=0) return true; return txeDev(); }

    // ---- shared form-field style helpers (admin panel) -------------------
    function txeFldFull(){ return 'width:100%;box-sizing:border-box;border:1px solid var(--bd,#cdd5e0);border-radius:8px;padding:7px 9px;font-size:12.5px;margin-bottom:6px;background:var(--surface,#fff);color:var(--txt,#26242b);'; }
    function txeFldHalf(){ return 'flex:1 1 46%;min-width:120px;box-sizing:border-box;border:1px solid var(--bd,#cdd5e0);border-radius:8px;padding:7px 9px;font-size:12.5px;margin-bottom:6px;background:var(--surface,#fff);color:var(--txt,#26242b);'; }
    function txeInput(id, ph, val, type, styl){ return '<input id="'+id+'" type="'+(type||'text')+'" placeholder="'+txeH(ph)+'" value="'+txeH(val==null?'':String(val))+'" style="'+(styl||txeFldFull())+'">'; }
    function txeOpts(vals, sel){ sel=String(sel==null?'':sel); return vals.map(function(v){ return '<option value="'+txeH(v)+'"'+(String(v)===sel?' selected':'')+'>'+txeH(txeTitleCase(v))+'</option>'; }).join(''); }
    function txeOpts2(pairs, sel){ sel=String(sel==null?'':sel); return pairs.map(function(p){ return '<option value="'+txeH(p[0])+'"'+(String(p[0])===sel?' selected':'')+'>'+txeH(p[1])+'</option>'; }).join(''); }

    // ══════════════════════════════════════════════════════════════════════
    // SURFACE 1 + 2 — Tasks screen: "My Tasks — all sources" + "Suggested" strip
    // ══════════════════════════════════════════════════════════════════════
    // Our root holds two independent boxes so each sub-feature is separately
    // fail-safe; the root is removed only when BOTH are empty.
    function txeMyRootNode(){
        var pane=document.getElementById('taskPaneMine'); if(!pane) return null;
        var el=txeMy.node;
        if(!el){
            el=document.createElement('div'); el.id='txeMyRoot'; el.style.cssText='margin:2px 0 0;';
            el.innerHTML='<div id="txeMyBox"></div><div id="txeSugStrip"></div>';
            txeMy.node=el;
        }
        // Keep it the FIRST child of taskPaneMine (above #tasksMineCard).
        if(el.parentNode!==pane || pane.firstChild!==el){ try{ pane.insertBefore(el, pane.firstChild); }catch(e){ return el; } }
        return el;
    }
    function txeMyRemove(){ var el=txeMy.node||document.getElementById('txeMyRoot'); if(el && el.parentNode) el.parentNode.removeChild(el); }
    function txeMaybeCleanup(){
        try{
            var box=document.getElementById('txeMyBox'), sug=document.getElementById('txeSugStrip');
            var boxEmpty=!box || !String(box.innerHTML).trim();
            var sugEmpty=!sug || !String(sug.innerHTML).trim();
            if(boxEmpty && sugEmpty) txeMyRemove();
        }catch(e){}
    }

    function txeMyShell(inner, count){
        return '<div style="background:#fff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.05);overflow:hidden;margin-bottom:12px;">'+
            '<div style="background:linear-gradient(120deg,#106AB3,#EC3E7E);color:#fff;padding:10px 14px;display:flex;align-items:center;gap:8px;">'+
            '<b style="flex:1;font-size:14px;">&#129513; My Tasks &mdash; all sources</b>'+
            (count?('<span style="background:rgba(255,255,255,.22);color:#fff;border-radius:8px;padding:3px 9px;font-size:11px;font-weight:700;white-space:nowrap;">'+txeH(count)+'</span>'):'')+
            '</div><div style="padding:6px 12px 10px;">'+inner+'</div></div>';
    }

    // Only allow app-local deep links as an href (keeps taps inside the tool).
    function txeDeepLink(v){ v=String(v==null?'':v).trim(); if(!v) return null; var c=v.charAt(0); if(c==='#'||c==='/'||c==='?'||/^index\.html/i.test(v)) return v; return null; }

    function txeMyRow(it){ it=it||{};
        var overdue=(it.is_overdue===true);
        var accent=overdue?'#a01b3e':((String(it.priority||'').toLowerCase()==='critical')?'#a01b3e':'#185FA5');
        var meta=[];
        if(it.source_module) meta.push(txeH(txeTitleCase(it.source_module)));
        if(it.location) meta.push(txeH(String(it.location)));
        var due=it.due_date?('<span style="color:'+(overdue?'#a01b3e':'#6b6275')+';font-weight:'+(overdue?'800':'600')+';white-space:nowrap;">'+(overdue?'&#9888; ':'&#128197; ')+txeH(txeDate(it.due_date))+(overdue?' overdue':'')+'</span>'):'';
        var metaLine=meta.join(' &middot; ')+((meta.length&&due)?' &middot; ':'')+due;
        var via=txeViaChip(it.assigned_via);
        var inner='<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;color:#26242b;line-height:1.35;">'+txeH(String(it.title||'(untitled)'))+txePriPill(it.priority)+'</div>'+
            (metaLine?('<div style="font-size:11px;color:#6b6275;margin-top:2px;">'+metaLine+'</div>'):'')+
            (via?('<div style="margin-top:3px;">'+via+'</div>'):'')+'</div>';
        var rowStyle='display:flex;align-items:center;gap:9px;padding:9px 0;border-top:1px solid #f0f2f6;';
        var link=txeDeepLink(it.source_deep_link);
        if(link){
            return '<a href="'+txeH(link)+'" style="'+rowStyle+'text-decoration:none;cursor:pointer;">'+
                '<span style="width:4px;align-self:stretch;min-height:24px;background:'+accent+';border-radius:99px;flex:none;"></span>'+inner+
                '<span style="color:#c2c7d0;font-size:16px;flex:none;">&rsaquo;</span></a>';
        }
        return '<div style="'+rowStyle+'">'+
            '<span style="width:4px;align-self:stretch;min-height:24px;background:'+accent+';border-radius:99px;flex:none;"></span>'+inner+'</div>';
    }

    function txeMyLoad(){
        var el=txeMyRootNode(); if(!el) return;
        var box=document.getElementById('txeMyBox'); if(!box) return;
        var seq=++txeMy.seq;
        if(!box.innerHTML) box.innerHTML=txeMyShell('<div style="text-align:center;color:#6b7686;padding:12px;font-size:12.5px;">Loading your tasks&hellip;</div>','');
        txeRpc('app_my_tasks_engine', {}, function(d){
            if(seq!==txeMy.seq) return;
            var box2=document.getElementById('txeMyBox'); if(!box2) return;
            var items=(d&&d.items)||[];
            if(!items.length){ box2.innerHTML=''; txeMaybeCleanup(); return; }   // empty -> show nothing (existing My Tasks card handles empty)
            try{ box2.innerHTML=txeMyShell(items.map(txeMyRow).join(''), String(items.length)); }
            catch(e){ box2.innerHTML=''; txeMaybeCleanup(); }
        }, function(){
            if(seq!==txeMy.seq) return;
            var box2=document.getElementById('txeMyBox'); if(box2) box2.innerHTML='';   // error / 404 not-yet-deployed -> nothing
            txeMaybeCleanup();
        });
    }

    function txeSugChip(x){ x=x||{};
        var pri=String(x.priority||'').toLowerCase();
        var dot=(pri==='critical')?'#a01b3e':(pri==='high'?'#9a5b00':(pri==='low'?'#98a2b0':'#185FA5'));
        var reason=(x.reason && x.reason!=='general')?('<div style="font-size:10px;color:#98a2b0;margin-top:2px;">Why: '+txeH(x.reason)+'</div>'):'';
        var title=txeH(String(x.title||x.key||'Task'));
        var tip=x.detail?(' title="'+txeH(String(x.detail))+'"'):'';
        return '<div'+tip+' style="flex:0 0 auto;max-width:190px;background:#fff;border:1px solid #e7eaf1;border-radius:10px;padding:8px 10px;box-shadow:0 1px 3px rgba(0,0,0,.04);">'+
            '<div style="display:flex;align-items:center;gap:6px;"><span style="width:7px;height:7px;border-radius:99px;background:'+dot+';flex:none;"></span>'+
            '<div style="font-size:12px;font-weight:700;color:#31313a;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+title+'</div></div>'+
            reason+'</div>';
    }
    function txeSugRender(sug){
        var chips=sug.slice(0,12).map(txeSugChip).join('');
        return '<div style="background:#f6f8fb;border:1px solid #eef0f5;border-radius:12px;padding:10px 12px;margin-bottom:12px;">'+
            '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;color:#6b7280;margin-bottom:8px;">&#128161; Suggested tasks</div>'+
            '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;-webkit-overflow-scrolling:touch;">'+chips+'</div>'+
            '<div style="font-size:10px;color:#a0a7b4;margin-top:6px;">Ideas from your task templates &mdash; nothing is created automatically.</div></div>';
    }
    function txeSugLoad(){
        var el=txeMyRootNode(); if(!el) return;
        var strip=document.getElementById('txeSugStrip'); if(!strip) return;
        var seq=++txeSug.seq;
        // Context: store is auto-filled server-side from the caller's user row;
        // module/keyword are optional and left unset for the general strip.
        txeRpc('app_task_suggest', {p_context: {}}, function(d){
            if(seq!==txeSug.seq) return;
            var s=document.getElementById('txeSugStrip'); if(!s) return;
            var sug=(d&&d.suggestions)||[];
            if(!sug.length){ s.innerHTML=''; txeMaybeCleanup(); return; }
            try{ s.innerHTML=txeSugRender(sug); }catch(e){ s.innerHTML=''; txeMaybeCleanup(); }
        }, function(){
            if(seq!==txeSug.seq) return;
            var s=document.getElementById('txeSugStrip'); if(s) s.innerHTML='';   // error / 404 -> nothing
            txeMaybeCleanup();
        });
    }

    function txeMySync(){
        try{
            var pane=document.getElementById('taskPaneMine'); if(!pane) return;
            var tv=document.getElementById('tasksView'); if(tv && tv.style && tv.style.display==='none') return;
            if(!txeReady()){ txeMyRemove(); return; }
            txeMyRootNode();     // ensure our root is the first child of the pane
            txeMyLoad();         // independent, fail-safe
            txeSugLoad();        // independent, fail-safe
        }catch(e){}
    }
    function txeMyOnOpen(){ [0,120,350,800].forEach(function(t){ setTimeout(function(){ try{ txeMySync(); }catch(e){} }, t); }); }

    // ══════════════════════════════════════════════════════════════════════
    // SURFACE 3 — Manager "Task Templates & Escalation" (Admin Console)
    // ══════════════════════════════════════════════════════════════════════
    function txeAdminCardNode(){
        var view=document.getElementById('adminConsoleView'); if(!view) return null;
        var host=view.querySelector('.container'); if(!host) return null;
        var el=document.getElementById('txeAdminCard');
        if(!el){
            el=document.createElement('div');
            el.id='txeAdminCard';
            el.style.cssText='background:var(--surface,#fff);border:1px solid var(--bd,#ececf2);border-radius:14px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,.05);margin-top:14px;';
            el.innerHTML=''+
                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="font-size:18px;">&#129513;</span><b style="flex:1;font-size:15px;color:var(--txt,#26242b);">Task templates &amp; escalation</b></div>'+
                '<div style="font-size:12.5px;color:var(--txt2,#8a8594);margin-bottom:10px;">Manage the reusable templates that power &ldquo;Suggested tasks,&rdquo; and the escalation rules that decide who gets pinged when a task goes overdue.</div>'+
                '<div id="txeTplWrap" style="margin-bottom:8px;"></div>'+
                '<div id="txeEscWrap"></div>';
        }
        if(el.parentNode!==host){ try{ host.appendChild(el); }catch(e){ return el; } }
        return el;
    }
    function txeAdminRemove(){ var el=document.getElementById('txeAdminCard'); if(el && el.parentNode) el.parentNode.removeChild(el); }

    function txeAdminSync(){
        try{
            var view=document.getElementById('adminConsoleView'); if(!view) return;
            if(view.style && view.style.display==='none') return;
            if(!txeReady() || !txeIsMgr()){ txeAdminRemove(); return; }   // non-manager (or View-As downgrade)
            var el=txeAdminCardNode(); if(!el) return;
            txeTplLoad();     // independent, fail-safe
            txeEscLoad();     // independent, fail-safe
        }catch(e){}
    }
    function txeAdminOnOpen(){ [0,150,450,1000].forEach(function(t){ setTimeout(function(){ try{ txeAdminSync(); }catch(e){} }, t); }); }

    // ---- Templates subsection --------------------------------------------
    function txeTplLoad(){
        var wrap=document.getElementById('txeTplWrap'); if(!wrap) return;
        var seq=++txeAdmin.tplSeq;
        if(!wrap.innerHTML) wrap.innerHTML='<div style="color:var(--txt2,#8a8594);font-size:12.5px;">Loading templates&hellip;</div>';
        txeRpc('app_task_template_list', {}, function(d){
            if(seq!==txeAdmin.tplSeq) return;
            var w=document.getElementById('txeTplWrap'); if(!w) return;
            txeAdmin.tplItems=(d&&d.templates)||[];
            try{ txeTplRender(); }catch(e){ w.innerHTML=''; }
        }, function(){
            if(seq!==txeAdmin.tplSeq) return;
            var w=document.getElementById('txeTplWrap'); if(w) w.innerHTML='';   // 404 / forbidden -> hide subsection
        });
    }
    function txeTplRow(t, i){ t=t||{};
        var bits=[]; if(t.default_role) bits.push(txeH(t.default_role)); if(t.default_store) bits.push(txeH(t.default_store)); if(t.source_module) bits.push(txeH(txeTitleCase(t.source_module))); if(t.interval_days!=null) bits.push('every '+txeH(String(t.interval_days))+'d');
        var active=(t.active===false)?'<span style="color:#a0a7b4;font-weight:700;">Inactive</span>':'<span style="color:#1b7a3d;font-weight:700;">Active</span>';
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--bd,#f0f2f6);">'+
            '<div style="flex:1;min-width:0;"><div style="font-size:12.5px;font-weight:700;color:var(--txt,#26242b);">'+txeH(String(t.title||t.key||'(untitled)'))+txePriPill(t.priority)+'</div>'+
            '<div style="font-size:10.5px;color:var(--txt2,#8a8594);margin-top:2px;">'+txeH(String(t.key||''))+(bits.length?(' &middot; '+bits.join(' &middot; ')):'')+' &middot; '+active+'</div></div>'+
            '<button onclick="txeTplEdit('+i+')" style="background:#eef0f3;color:#33404e;border:none;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;flex:none;">Edit</button></div>';
    }
    function txeTplForm(t){ t=t||{};
        var isEdit=!!(t.key);
        var keyInp='<input id="txeTpl_key" type="text" placeholder="key (stable slug, e.g. daily_open_checklist)" value="'+txeH(t.key||'')+'"'+(isEdit?' readonly':'')+' style="'+txeFldFull()+(isEdit?'background:#eef0f3;':'')+'">';
        var priSel='<select id="txeTpl_priority" style="'+txeFldHalf()+'">'+txeOpts(['normal','critical','high','low'], (t.priority||'normal'))+'</select>';
        var actSel='<select id="txeTpl_active" style="'+txeFldHalf()+'">'+txeOpts2([['true','Active'],['false','Inactive']], (t.active===false?'false':'true'))+'</select>';
        return '<div style="background:var(--surface2,#f7f8fb);border:1px solid var(--bd,#eef0f5);border-radius:10px;padding:10px;margin-bottom:10px;">'+
            '<div style="font-size:11px;font-weight:800;color:var(--txt2,#6b7280);margin-bottom:6px;">'+(isEdit?('Edit template &middot; '+txeH(t.key)):'New template')+'</div>'+
            keyInp+
            txeInput('txeTpl_title','Title (required)', t.title, 'text', txeFldFull())+
            '<textarea id="txeTpl_detail" rows="2" placeholder="Detail (optional)" style="'+txeFldFull()+'resize:vertical;">'+txeH(t.detail||'')+'</textarea>'+
            '<div style="display:flex;gap:6px;flex-wrap:wrap;">'+
                txeInput('txeTpl_default_role','default role', t.default_role, 'text', txeFldHalf())+
                txeInput('txeTpl_default_store','default store', t.default_store, 'text', txeFldHalf())+
            '</div>'+
            '<div style="display:flex;gap:6px;flex-wrap:wrap;">'+
                txeInput('txeTpl_source_module','source module', t.source_module, 'text', txeFldHalf())+
                txeInput('txeTpl_interval_days','interval days', (t.interval_days==null?'':t.interval_days), 'number', txeFldHalf())+
            '</div>'+
            '<div style="display:flex;gap:6px;flex-wrap:wrap;">'+
                txeInput('txeTpl_owner_role','owner role', t.owner_role, 'text', txeFldHalf())+
                txeInput('txeTpl_sort','sort', (t.sort==null?'':t.sort), 'number', txeFldHalf())+
            '</div>'+
            '<div style="display:flex;gap:6px;flex-wrap:wrap;">'+
                txeInput('txeTpl_sensitivity','sensitivity (store_operations)', t.sensitivity, 'text', txeFldHalf())+
                txeInput('txeTpl_closure_template','closure template (generic)', t.closure_template, 'text', txeFldHalf())+
            '</div>'+
            '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'+priSel+actSel+'</div>'+
            '<div style="display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap;">'+
                '<button onclick="txeTplSave()" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;">Save</button>'+
                '<button onclick="txeTplCancel()" style="background:#eef0f3;color:#33404e;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;">Cancel</button>'+
                '<span id="txeTpl_msg" style="font-size:11.5px;color:var(--txt2,#6b6275);"></span>'+
            '</div></div>';
    }
    function txeTplRender(){
        var wrap=document.getElementById('txeTplWrap'); if(!wrap) return;
        var items=txeAdmin.tplItems||[];
        var head='<div style="display:flex;align-items:center;gap:8px;margin:4px 0 8px;">'+
            '<b style="flex:1;font-size:13px;color:var(--txt,#26242b);">&#128221; Templates ('+items.length+')</b>'+
            '<button onclick="txeTplAdd()" style="background:var(--caliches-pink,#EC3E7E);color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">&#10133; Add</button></div>';
        var form=(txeAdmin.tplEdit!=null)?txeTplForm(txeAdmin.tplEdit):'';
        var list=items.length?items.map(txeTplRow).join(''):'<div style="color:var(--txt2,#8a8594);font-size:12.5px;padding:4px 2px;">No templates yet. Add one to power suggestions.</div>';
        wrap.innerHTML='<div style="border-top:1px solid var(--bd,#eef0f5);padding-top:8px;">'+head+form+list+'</div>';
    }
    window.txeTplAdd=function(){ txeAdmin.tplEdit={}; try{ txeTplRender(); }catch(e){} txeFocus('txeTpl_key'); };
    window.txeTplEdit=function(idx){ var t=(txeAdmin.tplItems||[])[idx]; if(!t) return; txeAdmin.tplEdit=Object.assign({}, t); try{ txeTplRender(); }catch(e){} txeFocus('txeTpl_title'); };
    window.txeTplCancel=function(){ txeAdmin.tplEdit=null; try{ txeTplRender(); }catch(e){} };
    window.txeTplSave=function(){
        var msg=document.getElementById('txeTpl_msg');
        function gv(id){ var el=document.getElementById(id); return el?String(el.value).trim():''; }
        var key=gv('txeTpl_key'), title=gv('txeTpl_title');
        if(!key){ txeMsg(msg,'Enter a key.','warn'); txeFocus('txeTpl_key'); return; }
        if(!title){ txeMsg(msg,'Enter a title.','warn'); txeFocus('txeTpl_title'); return; }
        var payload={
            key:key, title:title,
            detail:gv('txeTpl_detail')||null,
            default_role:gv('txeTpl_default_role')||null,
            default_store:gv('txeTpl_default_store')||null,
            source_module:gv('txeTpl_source_module')||null,
            owner_role:gv('txeTpl_owner_role')||null,
            sensitivity:gv('txeTpl_sensitivity')||null,
            closure_template:gv('txeTpl_closure_template')||null,
            priority:gv('txeTpl_priority')||'normal',
            active:(gv('txeTpl_active')!=='false')
        };
        var iv=txeInt(gv('txeTpl_interval_days')); if(iv!=null) payload.interval_days=iv;
        var sv=txeInt(gv('txeTpl_sort')); if(sv!=null) payload.sort=sv;
        txeMsg(msg,'Saving…','info');
        txeRpc('app_task_template_save', {p_payload: payload}, function(){ txeAdmin.tplEdit=null; txeTplLoad(); }, function(e){ txeMsg(msg, txeErr(e), 'warn'); });
    };

    // ---- Escalation subsection -------------------------------------------
    function txeEscLoad(){
        var wrap=document.getElementById('txeEscWrap'); if(!wrap) return;
        var seq=++txeAdmin.escSeq;
        if(!wrap.innerHTML) wrap.innerHTML='<div style="color:var(--txt2,#8a8594);font-size:12.5px;">Loading escalation rules&hellip;</div>';
        txeRpc('app_task_escalation_list', {}, function(d){
            if(seq!==txeAdmin.escSeq) return;
            var w=document.getElementById('txeEscWrap'); if(!w) return;
            txeAdmin.escItems=(d&&d.rules)||[];
            try{ txeEscRender(); }catch(e){ w.innerHTML=''; }
        }, function(){
            if(seq!==txeAdmin.escSeq) return;
            var w=document.getElementById('txeEscWrap'); if(w) w.innerHTML='';   // 404 / forbidden -> hide subsection
        });
    }
    function txeEscRow(e, i){ e=e||{};
        var bits=['&#8987; '+txeH(String(e.window_min==null?0:e.window_min))+'m', txeH(String(e.notify_roles||''))];
        if(e.scope && e.scope!=='default') bits.unshift(txeH(e.scope));
        var active=(e.active===false)?'<span style="color:#a0a7b4;font-weight:700;">Off</span>':'<span style="color:#1b7a3d;font-weight:700;">On</span>';
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--bd,#f0f2f6);">'+
            '<div style="flex:1;min-width:0;"><div style="font-size:12.5px;font-weight:700;color:var(--txt,#26242b);">'+txeH(String(e.label||('Rule #'+(e.id==null?'':e.id))))+txePriPill(e.priority)+'</div>'+
            '<div style="font-size:10.5px;color:var(--txt2,#8a8594);margin-top:2px;">'+bits.join(' &middot; ')+' &middot; '+active+'</div></div>'+
            '<button onclick="txeEscEdit('+i+')" style="background:#eef0f3;color:#33404e;border:none;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;flex:none;">Edit</button></div>';
    }
    function txeEscForm(e){ e=e||{};
        var isEdit=(e.id!=null);
        var priSel='<select id="txeEsc_priority" style="'+txeFldHalf()+'">'+txeOpts(['critical','high','normal','low'], (e.priority||'high'))+'</select>';
        var actSel='<select id="txeEsc_active" style="'+txeFldHalf()+'">'+txeOpts2([['true','On'],['false','Off']], (e.active===false?'false':'true'))+'</select>';
        return '<div style="background:var(--surface2,#f7f8fb);border:1px solid var(--bd,#eef0f5);border-radius:10px;padding:10px;margin-bottom:10px;">'+
            '<div style="font-size:11px;font-weight:800;color:var(--txt2,#6b7280);margin-bottom:6px;">'+(isEdit?('Edit rule #'+txeH(String(e.id))):'New escalation rule')+'</div>'+
            txeInput('txeEsc_label','Label (optional, e.g. Critical overdue)', e.label, 'text', txeFldFull())+
            '<div style="display:flex;gap:6px;flex-wrap:wrap;">'+priSel+actSel+'</div>'+
            '<div style="display:flex;gap:6px;flex-wrap:wrap;">'+
                txeInput('txeEsc_scope','scope (default / module)', (e.scope||'default'), 'text', txeFldHalf())+
                txeInput('txeEsc_window_min','minutes after due', (e.window_min==null?'':e.window_min), 'number', txeFldHalf())+
            '</div>'+
            txeInput('txeEsc_notify_roles','notify roles (comma-separated, required)', e.notify_roles, 'text', txeFldFull())+
            '<div style="display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap;">'+
                '<button onclick="txeEscSave()" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;">Save</button>'+
                '<button onclick="txeEscCancel()" style="background:#eef0f3;color:#33404e;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;">Cancel</button>'+
                '<span id="txeEsc_msg" style="font-size:11.5px;color:var(--txt2,#6b6275);"></span>'+
            '</div></div>';
    }
    function txeEscRender(){
        var wrap=document.getElementById('txeEscWrap'); if(!wrap) return;
        var items=txeAdmin.escItems||[];
        var head='<div style="display:flex;align-items:center;gap:8px;margin:4px 0 8px;">'+
            '<b style="flex:1;font-size:13px;color:var(--txt,#26242b);">&#128276; Escalation rules ('+items.length+')</b>'+
            '<button onclick="txeEscAdd()" style="background:var(--caliches-pink,#EC3E7E);color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">&#10133; Add</button></div>';
        var form=(txeAdmin.escEdit!=null)?txeEscForm(txeAdmin.escEdit):'';
        var list=items.length?items.map(txeEscRow).join(''):'<div style="color:var(--txt2,#8a8594);font-size:12.5px;padding:4px 2px;">No escalation rules yet.</div>';
        wrap.innerHTML='<div style="border-top:1px solid var(--bd,#eef0f5);padding-top:8px;">'+head+form+list+'</div>';
    }
    window.txeEscAdd=function(){ txeAdmin.escEdit={}; try{ txeEscRender(); }catch(e){} txeFocus('txeEsc_label'); };
    window.txeEscEdit=function(idx){ var e=(txeAdmin.escItems||[])[idx]; if(!e) return; txeAdmin.escEdit=Object.assign({}, e); try{ txeEscRender(); }catch(_e){} };
    window.txeEscCancel=function(){ txeAdmin.escEdit=null; try{ txeEscRender(); }catch(e){} };
    window.txeEscSave=function(){
        var msg=document.getElementById('txeEsc_msg');
        function gv(id){ var el=document.getElementById(id); return el?String(el.value).trim():''; }
        var roles=gv('txeEsc_notify_roles');
        if(!roles){ txeMsg(msg,'Enter at least one notify role.','warn'); txeFocus('txeEsc_notify_roles'); return; }
        var payload={
            priority:gv('txeEsc_priority')||'high',
            notify_roles:roles,
            scope:gv('txeEsc_scope')||'default',
            active:(gv('txeEsc_active')!=='false'),
            label:gv('txeEsc_label')||null
        };
        var wm=txeInt(gv('txeEsc_window_min')); if(wm!=null) payload.window_min=wm;
        if(txeAdmin.escEdit && txeAdmin.escEdit.id!=null) payload.id=txeAdmin.escEdit.id;
        txeMsg(msg,'Saving…','info');
        txeRpc('app_task_escalation_save', {p_payload: payload}, function(){ txeAdmin.escEdit=null; txeEscLoad(); }, function(e){ txeMsg(msg, txeErr(e), 'warn'); });
    };

    // ══════════════════════════════════════════════════════════════════════
    // HELPER — window.txeTaskLinks(module, recordId[, cb])
    // Resolves the linked tasks for a source record (app_task_links). ALWAYS
    // resolves (never rejects) — to the data object, or null on any failure /
    // 404 / missing creds. Optional node-style callback (err,data) supported for
    // non-Promise callers. There is no obvious per-record host screen yet, so we
    // expose only this helper (no UI panel), ready for a future caller.
    // ══════════════════════════════════════════════════════════════════════
    window.txeTaskLinks=function(module, recordId, cb){
        function run(resolve){
            try{
                var mod=String(module==null?'':module).trim(), ref=String(recordId==null?'':recordId).trim();
                if(!mod || !ref){ if(cb) try{ cb(null,null); }catch(e){} if(resolve) resolve(null); return; }
                txeRpc('app_task_links', {p_source_module:mod, p_source_record_id:ref},
                    function(d){ if(cb) try{ cb(null, d||null); }catch(e){} if(resolve) resolve(d||null); },
                    function(){ if(cb) try{ cb(null, null); }catch(e){} if(resolve) resolve(null); });
            }catch(e){ if(cb) try{ cb(null,null); }catch(_e){} if(resolve) resolve(null); }
        }
        if(typeof Promise!=='undefined'){ return new Promise(function(res){ run(res); }); }
        run(null); return null;
    };

    // ══════════════════════════════════════════════════════════════════════
    // INSTALL — append-only wraps of the entry points (+ poll fallback), then
    // safety nets in case a host screen is already visible at load.
    // ══════════════════════════════════════════════════════════════════════
    (function initWraps(){
        function tryWrap(){
            var a=txeWrap('openTasks', txeMyOnOpen);
            var b=txeWrap('openAdminConsole', txeAdminOnOpen);
            // Re-render My Tasks when the user toggles back to the 'mine' segment.
            txeWrap('taskSeg', function(){ try{ var pane=document.getElementById('taskPaneMine'); if(pane && pane.style && pane.style.display!=='none') txeMySync(); }catch(e){} });
            return a && b;
        }
        if(tryWrap()) return;
        var tries=0; var iv=setInterval(function(){ tries++; if(tryWrap() || tries>60){ clearInterval(iv); } }, 100);
    })();

    // Already-open safety nets (a late include after boot already navigated).
    try{ var _tv=document.getElementById('tasksView'); if(_tv && _tv.style && _tv.style.display!=='none') txeMyOnOpen(); }catch(e){}
    try{ var _av=document.getElementById('adminConsoleView'); if(_av && _av.style && _av.style.display!=='none') txeAdminOnOpen(); }catch(e){}
})();
