    // ============================================================
    // HOME — "WHAT NEEDS YOU TODAY"  (js/31_home_today.js)
    // Proactive, manager-facing Home card. Reads the SAME live task feed the
    // Manager Action Center uses (app_task_feed, 'today' view) and surfaces the
    // top open/overdue items the moment a manager opens the Hub, so the Home tab
    // is never a blank screen. One tap on any row / the header / the footer opens
    // the full Manager Action Center (js/28 openManagerActionCenter()).
    //
    // SELF-CONTAINED + APPEND-ONLY: this is a brand-new file that edits nothing
    // else. It injects its own card (id: homeTodayCard) as a sibling just ABOVE
    // the existing #homeTasksCard (My Day) — so loadMyTasks()'s innerHTML rewrite
    // of that card never clobbers it — and hooks Home load by wrapping the global
    // switchMenuTab via the same append-only reassignment pattern used elsewhere
    // (js/12 P4 bundle wrap; js/29 window-exposed entry point). It never edits
    // another file, never throws, and no-ops if the RPC or the Home divs are absent.
    //
    // BACKEND CONTRACT — READ-ONLY (no writes; mirrors js/28 macRpc credentials):
    //   app_task_feed(p_username,p_password,p_store,p_view,p_filters)
    //     p_view='today' -> { view,store,count, items:[ {id,title,priority,status,
    //       due_date,is_overdue,source_module,owner_role,location} ] }
    //   Called with withPin + supabaseClient.rpc, identical shape to macRpc/shsRpc.
    // Role gate uses effectiveRole() so it RESPECTS the leadership "View as" toggle
    // (a leader previewing a line role sees no card). The RPC is still the real
    // server-side gate and simply returns forbidden/nothing for non-managers.
    // ============================================================
    var _htoday = { seq: 0, loading: false };
    var HTODAY_MAX = 5;   // top N open/overdue items to surface on Home

    // escapeHtml reuse (js/11) with a defensive fallback so a load-order hiccup never throws.
    function htEsc(s){ try{ if(typeof escapeHtml==='function') return escapeHtml(s==null?'':String(s)); }catch(e){} return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return '&#'+c.charCodeAt(0)+';'; }); }

    // Credential wrapper — same shape as macRpc/shsRpc (withPin + p_username/p_password
    // merged into the args). Read-only; every failure path falls through to onerr and
    // NEVER alerts, so a proactive Home card can quietly stand down when unavailable.
    function htRpc(name,args,cb,onerr){
        try{
            if(typeof withPin!=='function' || typeof supabaseClient==='undefined' || !currentUser || !currentUser.username){ if(onerr) onerr({message:'unavailable'}); return; }
            withPin(function(pin){
                try{
                    supabaseClient.rpc(name, Object.assign({p_username:currentUser.username, p_password:pin}, args||{}))
                        .then(function(r){ if(r && r.error){ if(onerr) onerr(r.error); return; } cb(r?r.data:null); })
                        .catch(function(){ if(onerr) onerr({message:'connection'}); });
                }catch(e){ if(onerr) onerr({message:'connection'}); }
            }, function(){ if(onerr) onerr({message:'cancelled'}); });
        }catch(e){ if(onerr) onerr({message:'connection'}); }
    }

    // Manager-and-up gate that RESPECTS the "View as" toggle: the source of truth is
    // effectiveRole() (js/01) — the previewed role for a leader in View-As mode, else the
    // real role. Mirrors js/28 macCanSee inclusions/exclusions (Shift Lead / Team Lead are
    // NOT store management). A real developer who is NOT actively previewing a lower role
    // keeps the dev bypass; a developer previewing a line role correctly sees no card.
    function htCanSee(){
        if(!currentUser) return false;
        var previewing=false; try{ previewing=!!(window._viewAsRole && typeof canUseViewAs==='function' && canUseViewAs()); }catch(e){}
        var r=''; try{ r=String((typeof effectiveRole==='function'?effectiveRole():'')||(currentUser&&currentUser.role)||'').toLowerCase(); }catch(e){ r=String((currentUser&&currentUser.role)||'').toLowerCase(); }
        if(r.indexOf('shift lead')>=0 || r.indexOf('team lead')>=0) return false;
        if(r.indexOf('manager')>=0 || r.indexOf('admin')>=0 || r.indexOf('owner')>=0 || r.indexOf('vp')>=0 || r.indexOf('vice president')>=0 || r.indexOf('president')>=0 || r.indexOf('director')>=0) return true;
        if(!previewing){ try{ if(currentUser.is_developer===true) return true; }catch(e){} }
        return false;
    }

    // Short, friendly date (mirrors macDate: 'Jul 22').
    function htDate(d){ if(!d) return ''; var s=String(d); var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m){ var dt=new Date(+m[1],+m[2]-1,+m[3]); if(!isNaN(dt.getTime())) return dt.toLocaleDateString(undefined,{month:'short',day:'numeric'}); } return s.slice(0,10); }
    // Whole days overdue from an ISO due date (mirrors macOverdueAge).
    function htOverdueAge(d){ if(!d) return 0; var p=String(d).slice(0,10).split('-'); if(p.length!==3) return 0; var due=new Date(+p[0],+p[1]-1,+p[2]); if(isNaN(due.getTime())) return 0; var t=new Date(); var today=new Date(t.getFullYear(),t.getMonth(),t.getDate()); return Math.max(0,Math.round((today-due)/86400000)); }
    function htTitleCase(s){ s=String(s||'').replace(/[_-]+/g,' ').trim(); return s?s.charAt(0).toUpperCase()+s.slice(1):''; }
    // Priority pill (mirrors js/28 macPriPill palette).
    function htPriPill(p){ if(p==null||p==='') return ''; var k=String(p).toLowerCase(); var c;
        if(k==='critical'||k==='urgent'||k==='p1') c=['#fdeaea','#a01b3e'];
        else if(k==='high') c=['#fff4e0','#9a5b00'];
        else if(k==='medium'||k==='normal'||k==='p2') c=['#eef3fb','#185FA5'];
        else c=['#eef0f3','#5b6472'];
        return '<span style="background:'+c[0]+';color:'+c[1]+';font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;text-transform:capitalize;margin-left:6px;">'+htEsc(String(p))+'</span>'; }

    // Locate (or lazily create) our card, kept as a sibling just ABOVE #homeTasksCard so
    // loadMyTasks()'s innerHTML rewrite of that card never clobbers us. Returns null when
    // the Home anchor is absent (the module then simply no-ops).
    function htCard(){
        var anchor=document.getElementById('homeTasksCard'); if(!anchor || !anchor.parentNode) return null;
        var el=document.getElementById('homeTodayCard');
        if(!el){ el=document.createElement('div'); el.id='homeTodayCard'; el.style.cssText='margin-top:14px;'; }
        if(el.parentNode!==anchor.parentNode || el.nextSibling!==anchor){ try{ anchor.parentNode.insertBefore(el, anchor); }catch(e){ return el; } }
        return el;
    }
    function htRemove(){ var el=document.getElementById('homeTodayCard'); if(el && el.parentNode) el.parentNode.removeChild(el); }

    // One-tap target for every row / header / footer: open the full Manager Action
    // Center (js/28). Falls back to the Tasks surface, and no-ops if neither exists.
    function htOpen(){ try{ if(typeof openManagerActionCenter==='function'){ openManagerActionCenter(); return; } }catch(e){} try{ if(typeof hubNav==='function') hubNav('tasks'); }catch(e){} }

    function htRowHtml(it){ it=it||{};
        var overdue=(it.is_overdue===true);
        var accent=overdue?'#a01b3e':((String(it.priority||'').toLowerCase()==='critical')?'#a01b3e':'#185FA5');
        var age=overdue?htOverdueAge(it.due_date):0;
        var meta=[]; if(it.source_module) meta.push(htEsc(htTitleCase(it.source_module))); if(it.location) meta.push(htEsc(String(it.location)));
        var due=it.due_date?('<span style="color:'+(overdue?'#a01b3e':'#6b6275')+';font-weight:'+(overdue?'800':'600')+';white-space:nowrap;">'+(overdue?'&#9888; ':'&#128197; ')+htEsc(htDate(it.due_date))+(age?(' &middot; '+age+'d overdue'):'')+'</span>'):'';
        var metaLine=meta.join(' &middot; ')+((meta.length&&due)?' &middot; ':'')+due;
        return '<div onclick="htOpen()" style="display:flex;align-items:center;gap:9px;padding:9px 0;border-top:1px solid #f0f2f6;cursor:pointer;">'+
            '<span style="width:4px;align-self:stretch;min-height:26px;background:'+accent+';border-radius:99px;flex:none;"></span>'+
            '<div style="flex:1;min-width:0;"><div style="font-size:13.5px;font-weight:600;color:#26242b;line-height:1.35;">'+htEsc(String(it.title||'(untitled)'))+htPriPill(it.priority)+'</div>'+
            (metaLine?('<div style="font-size:11px;color:#6b6275;margin-top:2px;">'+metaLine+'</div>'):'')+'</div>'+
            '<span style="color:#c2c7d0;font-size:16px;flex:none;">&rsaquo;</span></div>';
    }

    function htShell(inner){ return '<div style="background:#fff;border-radius:12px;margin-bottom:0;box-shadow:0 4px 6px rgba(0,0,0,0.05);overflow:hidden;">'+
        '<div style="background:linear-gradient(120deg,#EC3E7E,#106AB3);color:#fff;padding:11px 14px;display:flex;align-items:center;gap:8px;cursor:pointer;" onclick="htOpen()">'+
        '<b style="flex:1;font-size:14.5px;">&#9889; What needs you today</b>'+
        '<span style="background:rgba(255,255,255,.22);color:#fff;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:700;white-space:nowrap;">Open &rsaquo;</span></div>'+
        '<div style="padding:6px 14px 12px;">'+inner+'</div></div>'; }

    function htRenderItems(items){
        var el=htCard(); if(!el) return;
        items=items||[];
        if(!items.length){
            el.innerHTML=htShell('<div style="text-align:center;padding:16px 6px 10px;">'+
                '<div style="font-size:26px;margin-bottom:4px;">&#127881;</div>'+
                '<b style="color:#1f7a3d;font-size:14px;">You&rsquo;re all caught up</b>'+
                '<div style="font-size:12px;color:#8a93a2;margin-top:2px;">No open or overdue items need you right now.</div></div>');
            return;
        }
        var top=items.slice(0,HTODAY_MAX);
        var more=items.length-top.length;
        var body=top.map(htRowHtml).join('');
        var footer='<div onclick="htOpen()" style="text-align:center;margin-top:8px;padding-top:9px;border-top:1px solid #f0f2f6;color:#106AB3;font-size:12.5px;font-weight:700;cursor:pointer;">'+(more>0?('+'+more+' more &middot; '):'')+'View all in the Manager Action Center &rarr;</div>';
        el.innerHTML=htShell(body+footer);
    }

    // Public entry — safe to call any time Home loads. Manager-and-up only (View-As aware).
    // Never throws; silently no-ops if the feed or the Home anchor is absent.
    function renderHomeToday(){
        try{
            if(!htCanSee()){ htRemove(); return; }
            var el=htCard(); if(!el) return;                       // no Home anchor -> nothing to do
            var seq=++_htoday.seq; _htoday.loading=true;
            if(!el.innerHTML) el.innerHTML=htShell('<div style="text-align:center;color:#6b7686;padding:14px;font-size:12.5px;">Checking what needs you&hellip;</div>');
            htRpc('app_task_feed', {p_store:null, p_view:'today', p_filters:{}}, function(d){
                if(seq!==_htoday.seq) return;                      // a newer render superseded this one
                _htoday.loading=false;
                if(!htCanSee()){ htRemove(); return; }             // role flipped mid-flight (e.g. View-As)
                htRenderItems((d&&d.items)||[]);
            }, function(){
                if(seq!==_htoday.seq) return;
                _htoday.loading=false;
                // Graceful no-op: if all we ever showed was the spinner, remove the card so Home
                // is never cluttered with an error. A prior good render is left untouched.
                var cur=document.getElementById('homeTodayCard');
                if(cur && /Checking what needs you/.test(cur.innerHTML||'')) htRemove();
            });
        }catch(e){ /* never throw onto the Home screen */ }
    }

    // Expose the entry point on window (mirrors js/29 window.openStoreHealthScorecard).
    try{ window.renderHomeToday = renderHomeToday; }catch(e){}

    // Hook Home load WITHOUT editing other files: append-only reassignment wrap of the
    // global switchMenuTab (same pattern as js/12's P4 bundle). Guarded so it only wraps
    // ONCE even if this file is ever included twice. Every path into Home — js/02 boot
    // (enterAppView), hubNav('home'), openMenu(), and the View-As re-nav in js/01 — calls
    // switchMenuTab('home'), so this single hook covers first load and every return to Home
    // (and re-fires the gate when a leader toggles "View as").
    try{
        if(typeof switchMenuTab==='function' && !switchMenuTab.__homeTodayWrapped){
            var _htWrapped=(function(orig){
                function w(){ var r=orig.apply(this,arguments); try{ if(arguments[0]==='home') renderHomeToday(); }catch(e){} return r; }
                w.__homeTodayWrapped=true; return w;
            })(switchMenuTab);
            switchMenuTab=_htWrapped;
            try{ window.switchMenuTab=_htWrapped; }catch(e){}
        }
    }catch(e){}

    // Safety net: if Home is already the visible tab when this script runs (e.g. a late
    // include after boot already navigated Home), paint once now. htCanSee() still gates it.
    try{ var _htHome=document.getElementById('tab-content-home'); if(_htHome && _htHome.classList && _htHome.classList.contains('tab-visible')) renderHomeToday(); }catch(e){}
