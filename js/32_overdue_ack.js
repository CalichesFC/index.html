    // ============================================================
    // OVERDUE-TASK ACKNOWLEDGMENT  (js/32_overdue_ack.js)
    // A compact, personal "⚠ Needs your acknowledgment" card on the HOME screen.
    // It surfaces the caller's OWN reminded / overdue tasks (the per-user feed the
    // GO_LIVE_14 sweep builds) and lets them acknowledge each one, in place.
    //
    // SELF-CONTAINED + APPEND-ONLY: brand-new file that edits nothing else. It
    // injects its own card (id: oaqCard) as a sibling just ABOVE #homeDayCard, and
    // hooks Home load by append-only-wrapping the global switchMenuTab — the exact
    // pattern used by js/31_home_today.js. It never edits another file, never
    // throws, and no-ops if the RPC or the Home divs are absent.
    //
    // BACKEND CONTRACT (GO_LIVE_14) — deployed separately; may not exist yet:
    //   app_overdue_ack_feed(p_username,p_password)
    //     -> { tasks:[ {task_id,title,priority,due_date,bucket,is_overdue,
    //          reminded_on,source_module,location,acknowledged} ], as_of }
    //   app_overdue_ack(p_username,p_password,p_task_id) -> { ok,task_id,acknowledged_at }
    //
    // FAIL-SAFE, ABSOLUTELY: every rpc() is wrapped so a network error, a missing
    // RPC (404 before the migration lands), or an empty / all-acknowledged feed
    // renders NOTHING. The card is only ever created once there is >=1 pending item
    // to show, so a not-yet-deployed backend simply looks like the feature is not
    // there — no spinner flash, no empty card, no prompt(), no thrown error.
    //
    // GATE: this is a PER-USER feed (the RPC is "any authenticated user" and scopes
    // to the caller's own assigned / store-management tasks). The appropriate gate
    // here is therefore simply "logged in" — the server RPC is the real authority
    // on what is yours, so no client-side role filter is applied (that would wrongly
    // hide a line employee's own overdue tasks).
    // ============================================================
    (function(){
        // Guard against double-injection (belt-and-suspenders with the wrap guard below).
        try{ if(window.__oaqLoaded) return; }catch(e){}
        try{ window.__oaqLoaded = true; }catch(e){}

        var oaqState = { seq: 0 };

        // escapeHtml (js/11) reuse with a self-contained fallback so a load-order
        // hiccup can never throw. Mirrors js/31 htEsc.
        function oaqEsc(s){ try{ if(typeof escapeHtml==='function') return escapeHtml(s==null?'':String(s)); }catch(e){} return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return '&#'+c.charCodeAt(0)+';'; }); }

        // Resolve the session credential WITHOUT ever prompting (unlike withPin). A
        // proactive Home card must be silent: if there is no cached PIN we simply
        // stand down rather than pop a prompt() over the Home screen.
        function oaqPin(){
            try{ if(sessionPin) return sessionPin; }catch(e){}
            try{ if(localStorage.getItem('calichesKeep')!=='0'){ var s=sessionStorage.getItem('calichesPin'); if(s) return s; } }catch(e){}
            return null;
        }

        // Fail-safe rpc: resolves cb(data) on success, else onerr(). NEVER throws,
        // NEVER prompts, NEVER alerts. A missing client / user / pin, a 404 on a
        // not-yet-deployed RPC, a rejected promise, or a returned .error all funnel
        // to onerr so the caller can quietly render nothing.
        function oaqRpc(name, args, cb, onerr){
            function fail(){ try{ if(onerr) onerr(); }catch(e){} }
            try{
                if(typeof supabaseClient==='undefined' || !supabaseClient || typeof supabaseClient.rpc!=='function'){ fail(); return; }
                if(!currentUser || !currentUser.username){ fail(); return; }
                var pin=oaqPin(); if(!pin){ fail(); return; }
                var p=supabaseClient.rpc(name, Object.assign({ p_username: currentUser.username, p_password: pin }, args||{}));
                if(!p || typeof p.then!=='function'){ fail(); return; }
                p.then(function(r){ if(r && r.error){ fail(); return; } try{ if(cb) cb(r?r.data:null); }catch(e){} })
                 .catch(function(){ fail(); });
            }catch(e){ fail(); }
        }

        // Short friendly date (mirrors js/31 htDate): "Jul 20".
        function oaqDate(d){ if(!d) return ''; var s=String(d); var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m){ var dt=new Date(+m[1],+m[2]-1,+m[3]); if(!isNaN(dt.getTime())) return dt.toLocaleDateString(undefined,{month:'short',day:'numeric'}); } return s.slice(0,10); }
        // Whole days overdue from an ISO due date (mirrors js/31 htOverdueAge).
        function oaqOverdueAge(d){ if(!d) return 0; var p=String(d).slice(0,10).split('-'); if(p.length!==3) return 0; var due=new Date(+p[0],+p[1]-1,+p[2]); if(isNaN(due.getTime())) return 0; var t=new Date(); var today=new Date(t.getFullYear(),t.getMonth(),t.getDate()); return Math.max(0,Math.round((today-due)/86400000)); }
        function oaqNum(v){ var n=parseInt(v,10); return isNaN(n)?v:n; }

        // Normalize the feed payload defensively: an object {tasks:[]}, a bare array,
        // or a JSON string all reduce to an array (else []).
        function oaqExtract(d){
            try{
                if(!d) return [];
                if(typeof d==='string'){ try{ d=JSON.parse(d); }catch(e){ return []; } }
                if(Array.isArray(d)) return d;
                if(d && Array.isArray(d.tasks)) return d.tasks;
                return [];
            }catch(e){ return []; }
        }

        // Locate / lazily-create our card, kept as a sibling just ABOVE #homeDayCard
        // so the Home "My Day" / "My Tasks" innerHTML rewrites never clobber it. This
        // is a DISTINCT anchor from js/31 (#homeTasksCard) so the two proactive cards
        // never fight over position. Returns null when Home isn't in the DOM (the
        // module then simply no-ops).
        function oaqGetCard(){
            var home=document.getElementById('tab-content-home'); if(!home) return null;
            var anchor=document.getElementById('homeDayCard') || document.getElementById('homeTasksCard');
            var el=document.getElementById('oaqCard');
            if(!el){ el=document.createElement('div'); el.id='oaqCard'; el.style.cssText='margin-top:14px;'; }
            try{
                if(anchor && anchor.parentNode){
                    if(el.parentNode!==anchor.parentNode || el.nextSibling!==anchor) anchor.parentNode.insertBefore(el, anchor);
                } else if(el.parentNode!==home){ home.appendChild(el); }
            }catch(e){}
            return el;
        }
        function oaqRemove(){ var el=document.getElementById('oaqCard'); if(el && el.parentNode) el.parentNode.removeChild(el); }
        function oaqFindRow(el, id){ if(!el) return null; var rows=el.querySelectorAll('[data-oaq-row]'); for(var i=0;i<rows.length;i++){ if(rows[i].getAttribute('data-oaq-row')===String(id)) return rows[i]; } return null; }

        function oaqShell(count, rows){
            return '<div style="background:#fff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.05);overflow:hidden;border:1px solid #f2d9a8;">'+
                '<div style="background:linear-gradient(120deg,#E8912A,#D6532A);color:#fff;padding:11px 14px;display:flex;align-items:center;gap:8px;">'+
                    '<b style="flex:1;font-size:14.5px;">&#9888; Needs your acknowledgment</b>'+
                    '<span data-oaq-count="" style="background:rgba(255,255,255,.24);color:#fff;border-radius:99px;padding:3px 10px;font-size:11.5px;font-weight:800;min-width:16px;text-align:center;">'+count+'</span>'+
                '</div>'+
                '<div style="padding:2px 14px 12px;">'+rows+'</div>'+
            '</div>';
        }

        function oaqRowHtml(t){ t=t||{};
            var id=(t.task_id!=null?t.task_id:t.id);
            var overdue=(t.is_overdue===true) || String(t.bucket||'').toLowerCase()==='overdue';
            var age=overdue?oaqOverdueAge(t.due_date):0;
            var due=t.due_date?('<span style="color:'+(overdue?'#a01b3e':'#6b6275')+';font-weight:'+(overdue?'800':'600')+';white-space:nowrap;">'+(overdue?'&#9888; ':'&#128197; ')+oaqEsc(oaqDate(t.due_date))+(age?(' &middot; '+age+'d overdue'):'')+'</span>'):'';
            var store=t.location?('<span style="color:#6b6275;white-space:nowrap;">&#127970; '+oaqEsc(String(t.location))+'</span>'):'';
            var meta=[]; if(due) meta.push(due); if(store) meta.push(store);
            var metaLine=meta.join(' <span style="color:#cfd4dc;">&middot;</span> ');
            var accent=overdue?'#a01b3e':'#E8912A';
            var ackBtn=(id!=null)?('<button data-oaq-ack="'+oaqEsc(String(id))+'" style="flex:none;background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:8px 13px;font-size:12.5px;font-weight:800;cursor:pointer;white-space:nowrap;">Acknowledge</button>'):'';
            return '<div data-oaq-row="'+oaqEsc(String(id))+'" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #f4ede0;">'+
                '<span style="width:4px;align-self:stretch;min-height:30px;background:'+accent+';border-radius:99px;flex:none;"></span>'+
                '<div style="flex:1;min-width:0;">'+
                    '<div style="font-size:13.5px;font-weight:700;color:#26242b;line-height:1.35;">'+oaqEsc(String(t.title||'(untitled task)'))+'</div>'+
                    (metaLine?('<div style="font-size:11px;color:#6b6275;margin-top:3px;">'+metaLine+'</div>'):'')+
                '</div>'+
                ackBtn+
            '</div>';
        }

        // Wire the Acknowledge buttons AFTER innerHTML (encapsulated — no inline
        // handlers, so nothing but the guard flag + the entry point ever leaks to
        // window). Re-run on every paint.
        function oaqBind(el){
            try{
                var btns=el.querySelectorAll('[data-oaq-ack]');
                for(var i=0;i<btns.length;i++){ (function(b){ b.addEventListener('click', function(){ oaqAck(b.getAttribute('data-oaq-ack'), b); }); })(btns[i]); }
            }catch(e){}
        }

        function oaqPaint(items){
            var el=oaqGetCard(); if(!el) return;
            el.innerHTML=oaqShell(items.length, items.map(oaqRowHtml).join(''));
            oaqBind(el);
        }

        // After a successful ack we drop that row; when the last one goes, the whole
        // card leaves so Home never shows an empty "needs you" shell.
        function oaqAfterRemoval(){
            var el=document.getElementById('oaqCard'); if(!el) return;
            var rows=el.querySelectorAll('[data-oaq-row]');
            if(!rows.length){ oaqRemove(); return; }
            var badge=el.querySelector('[data-oaq-count]'); if(badge) badge.textContent=String(rows.length);
        }

        // Acknowledge ONE task. Optimistic-on-success: on a clean response we remove
        // the row (and the card, if it was the last). Any failure path is quiet — a
        // "Try again" affordance, never an alert, never a throw, never a screen block.
        function oaqAck(id, btn){
            try{
                if(id==null || id==='') return;
                function softFail(){ if(btn){ btn.disabled=false; btn.textContent='Try again'; btn.style.opacity='1'; btn.style.cursor='pointer'; } }
                if(btn){ btn.disabled=true; btn.textContent='Saving…'; btn.style.opacity='0.7'; btn.style.cursor='default'; }
                oaqRpc('app_overdue_ack', { p_task_id: oaqNum(id) }, function(data){
                    if(data && data.ok===false){ softFail(); return; }   // explicit server "no"
                    var el=document.getElementById('oaqCard');
                    var row=oaqFindRow(el, id);
                    if(row && row.parentNode) row.parentNode.removeChild(row);
                    oaqAfterRemoval();
                }, softFail);
            }catch(e){ try{ if(btn) btn.disabled=false; }catch(_e){} }
        }

        // Public entry — safe any time Home loads. Logged-in users only. Fetches the
        // per-user feed and paints ONLY when there is >=1 not-yet-acknowledged item;
        // otherwise (error / empty / all already acked) it removes any prior card and
        // shows nothing. A stale async response is dropped via the seq guard.
        function oaqRenderAck(){
            try{
                if(!currentUser || !currentUser.username){ oaqRemove(); return; }
                if(!document.getElementById('tab-content-home')) return;   // no Home anchor -> nothing to do
                var seq=++oaqState.seq;
                oaqRpc('app_overdue_ack_feed', {}, function(data){
                    if(seq!==oaqState.seq) return;                          // superseded by a newer render
                    var pending=oaqExtract(data).filter(function(t){ return t && t.acknowledged!==true && (t.task_id!=null || t.id!=null); });
                    if(!pending.length){ oaqRemove(); return; }             // empty / all acked -> render nothing
                    oaqPaint(pending);
                }, function(){
                    if(seq!==oaqState.seq) return;
                    oaqRemove();                                            // error / missing backend -> render nothing
                });
            }catch(e){ /* never throw onto the Home screen */ }
        }

        // Expose the entry point (parity with js/31 window.renderHomeToday). The wrap
        // below calls the local fn directly; this is only for testability / reuse.
        try{ window.oaqRenderAck = oaqRenderAck; }catch(e){}

        // Hook Home load WITHOUT editing other files: append-only reassignment wrap of
        // the global switchMenuTab (same pattern as js/31). Guarded so it wraps
        // exactly once even if this file is somehow included twice. Every path into
        // Home — boot (enterAppView), hubNav('home'), openMenu(), the View-As re-nav —
        // calls switchMenuTab('home'), so this covers first load AND every return.
        try{
            if(typeof switchMenuTab==='function' && !switchMenuTab.__oaqWrapped){
                var _oaqW=(function(orig){
                    function w(){ var r=orig.apply(this, arguments); try{ if(arguments[0]==='home') oaqRenderAck(); }catch(e){} return r; }
                    w.__oaqWrapped=true; return w;
                })(switchMenuTab);
                try{ switchMenuTab=_oaqW; }catch(e){}
                try{ window.switchMenuTab=_oaqW; }catch(e){}
            }
        }catch(e){}

        // Safety net: if Home is already the visible tab when this script runs (a late
        // include after boot already navigated Home), paint once now.
        try{ var _h=document.getElementById('tab-content-home'); if(_h && _h.classList && _h.classList.contains('tab-visible')) oaqRenderAck(); }catch(e){}
    })();
