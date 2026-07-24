// ============================================================
// OPS UTILITIES — BACK-OFFICE HELPERS  (js/38_ops_utilities.js)
// GO_LIVE_21 four small, INDEPENDENT, additive utilities surfaced on screens
// that already exist. Self-contained, append-only module: it edits NO other
// file (not index.html, not rpc_manifest.json, not js/07 / js/10 / js/04 / etc).
// Screen entry is hooked by append-only wraps of the global open functions
// (same pattern as js/31 wrapping switchMenuTab and js/37 wrapping openCatering).
//
// WHAT IT ADDS (each panel is independently fail-safe — one dead RPC cannot
//   affect the others, and none can throw onto the screen):
//   1) SUPPLY EXPORT  — a manager-gated "Export CSV" bar injected into the
//      Supply Request screen (#supplyRequestView). Calls app_supply_export,
//      builds the CSV client-side (Blob + object URL), escapes every field.
//   2) PRE-SHIFT CREW — an "Auto-load scheduled crew" button injected into the
//      Pre-Shift Lineup screen (#preshiftView). Calls app_preshift_scheduled_crew
//      and lists the returned names/positions in a small read/copy panel. It does
//      NOT modify js/07 or the existing free-text lineup — purely additive.
//   3) PERMISSION MATRIX (advisory) — an admin viewer/editor injected into the
//      Admin Console (#adminConsoleView). Calls app_perm_matrix_get /
//      app_perm_matrix_set. Advisory only; never changes a live gate.
//   4) SENSITIVE RECORDS — a manager list/tagger injected into the Admin Console.
//      Calls app_sensitive_list / app_sensitive_tag / app_sensitive_untag.
//
// FAIL-SAFE ABSOLUTELY: credentials come ONLY from the in-memory sessionPin /
//   sessionStorage('calichesPin') cache — this module NEVER calls prompt() on
//   auto-render. Every RPC is try/caught; any error / 404 (backend not deployed
//   yet) / unauthorized / empty response makes the affected panel render NOTHING
//   (or a quiet, non-blocking note) and never throws or blocks. Role gates mirror
//   the server helpers _ops_is_mgr / _ops_is_admin and are View-As aware; the RPC
//   remains the real server-side gate.
//
// BACKEND CONTRACT (specs/GO_LIVE_21_OPS_UTILITIES.sql), all via supabaseClient.rpc:
//   app_supply_export(p_username,p_password,p_from,p_to)
//       -> { ok, from, to, source, count, rows:[ {..cols.., items:[..]} ], note }
//   app_preshift_scheduled_crew(p_username,p_password,p_store,p_date)
//       -> [ { employee_id, employee_name, position, position_id,
//              position_color, start_time, end_time, note } ]   (a jsonb ARRAY)
//   app_perm_matrix_get(p_username,p_password)
//       -> { ok, can_manage, roles[], modules[], matrix:[ {role,module,allowed,..} ] }
//   app_perm_matrix_set(p_username,p_password,p_role,p_module,p_allowed,p_note?)
//       -> { ok, role, module, allowed }
//   app_sensitive_tag(p_username,p_password,p_module,p_record_id,p_sensitivity?,p_reason?)
//       -> { ok, module, record_id, sensitivity }
//   app_sensitive_untag(p_username,p_password,p_module,p_record_id)  -> { ok, removed }
//   app_sensitive_list(p_username,p_password,p_module?)  -> { tags:[ {..} ] }
// ============================================================
(function(){
    'use strict';
    // Guard double-injection (script included twice) — never run our setup twice.
    try{ if (typeof window === 'undefined') return; if (window.__opsUtilInjected) return; window.__opsUtilInjected = true; }catch(e){ return; }

    // ---------- tiny safe helpers ----------
    // Reuse the app's escapeHtml with a defensive fallback so a load-order hiccup never throws.
    function esc(s){ try{ if(typeof escapeHtml==='function') return escapeHtml(s==null?'':String(s)); }catch(e){} return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return '&#'+c.charCodeAt(0)+';'; }); }
    // Single-quoted JS string literal for inline on* handlers.
    function q(s){ return "'"+String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,' ')+"'"; }
    function assign(t,s){ try{ if(Object.assign) return Object.assign(t,s); }catch(e){} for(var k in s){ if(Object.prototype.hasOwnProperty.call(s,k)) t[k]=s[k]; } return t; }
    function paint(id,html){ try{ var el=document.getElementById(id); if(el) el.innerHTML=html||''; }catch(e){} }
    function gv(id){ try{ var el=document.getElementById(id); return el? el.value : ''; }catch(e){ return ''; } }

    // ---------- credentials: sessionPin / sessionStorage ONLY (never prompt) ----------
    function pin(){
        try{ if(typeof sessionPin!=='undefined' && sessionPin) return sessionPin; }catch(e){}
        try{ if(typeof localStorage!=='undefined' && localStorage.getItem('calichesKeep')!=='0'){ var kp=sessionStorage.getItem('calichesPin'); if(kp) return kp; } }catch(e){}
        return null;
    }
    function hasCreds(){
        try{ return !!(typeof supabaseClient!=='undefined' && supabaseClient && typeof currentUser!=='undefined' && currentUser && currentUser.username && pin()); }catch(e){ return false; }
    }

    // ---------- role gates (mirror SQL _ops_is_mgr / _ops_is_admin; View-As aware) ----------
    function roleStr(){ try{ return String((typeof effectiveRole==='function'?effectiveRole():'')||(currentUser&&currentUser.role)||'').toLowerCase(); }catch(e){ try{ return String((currentUser&&currentUser.role)||'').toLowerCase(); }catch(_){ return ''; } } }
    function devBypass(){ try{ var previewing=!!(window._viewAsRole && typeof canUseViewAs==='function' && canUseViewAs()); return (!previewing && currentUser && currentUser.is_developer===true); }catch(e){ return false; } }
    function matches(r,pats){ for(var i=0;i<pats.length;i++){ if(r.indexOf(pats[i])>=0) return true; } return false; }
    // _ops_is_mgr : manager / admin / lead / owner / vp / vice president / president
    function isMgr(){ var r=roleStr(); if(r && matches(r,['manager','admin','lead','owner','vp','vice president','president'])) return true; return devBypass(); }
    // _ops_is_admin : the narrow always-full-access set
    function isAdmin(){ var r=roleStr(); if(r && matches(r,['admin','owner','vice president','president'])) return true; return devBypass(); }

    // ---------- RPC wrapper: fail-safe, credential-merged, NEVER prompts ----------
    function rpc(name,args,cb,onerr){
        try{
            if(!hasCreds()){ if(onerr) onerr({message:'nocreds'}); return; }
            supabaseClient.rpc(name, assign({p_username:currentUser.username, p_password:pin()}, args||{}))
                .then(function(res){ try{ if(res && res.error){ if(onerr) onerr(res.error); return; } cb(res?res.data:null); }catch(e){ if(onerr) onerr({message:'render'}); } })
                .catch(function(){ if(onerr) onerr({message:'connection'}); });
        }catch(e){ if(onerr) onerr({message:'connection'}); }
    }

    // ---------- shared style builders (match the app's inline-style vocabulary) ----------
    function card(title, body, color){
        color=color||'#185FA5';
        return '<div style="background:#fff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,.05);overflow:hidden;margin-bottom:14px;">'
            +'<div style="background:'+color+';color:#fff;padding:10px 14px;display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14.5px;">'+title+'</b></div>'
            +'<div style="padding:12px 14px;">'+body+'</div></div>';
    }
    function pill(text,bg,col){ return '<span style="display:inline-block;background:'+bg+';color:'+col+';border-radius:999px;padding:2px 9px;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.02em;">'+esc(text)+'</span>'; }
    function lbl(t){ return '<div style="font-size:11px;font-weight:800;color:#6b7280;text-transform:uppercase;letter-spacing:.03em;margin:2px 0 3px;">'+esc(t)+'</div>'; }
    function inp(id,val,ph,type){ return '<input id="'+id+'" type="'+(type||'text')+'" value="'+esc(val==null?'':val)+'" placeholder="'+esc(ph||'')+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d7dbe2;border-radius:8px;font-size:13px;margin-bottom:8px;">'; }

    // ---------- module state ----------
    var S = {
        perm:null, permRole:null,
        sens:[], sensFilter:'', sensForm:null, sensErr:'',
        adminLoaded:{perm:null, sens:null}
    };

    // ============================================================
    // (1) SUPPLY EXPORT  — manager-gated "Export CSV" on #supplyRequestView
    // ============================================================
    // CSV field escaper: quote if the value holds comma / quote / newline; nested
    // objects (e.g. the per-request items[] array) are JSON-serialised into one cell.
    function csvCell(v){
        if(v===null||v===undefined) return '';
        var s;
        if(typeof v==='object'){ try{ s=JSON.stringify(v); }catch(e){ s=String(v); } }
        else s=String(v);
        if(/[",\r\n]/.test(s)) s='"'+s.replace(/"/g,'""')+'"';
        return s;
    }
    function buildCsv(rows){
        rows=rows||[];
        var cols=[], seen={}, i, k;
        for(i=0;i<rows.length;i++){ var r=rows[i]||{}; for(k in r){ if(Object.prototype.hasOwnProperty.call(r,k) && !seen[k]){ seen[k]=1; cols.push(k); } } }
        if(!cols.length) cols=['(no columns)'];
        var lines=[ cols.map(csvCell).join(',') ];
        for(i=0;i<rows.length;i++){ var row=rows[i]||{}, line=[]; for(var c=0;c<cols.length;c++) line.push(csvCell(row[cols[c]])); lines.push(line.join(',')); }
        return lines.join('\r\n');
    }
    function downloadCsv(filename, text){
        try{
            var blob=new Blob(['\ufeff'+text], {type:'text/csv;charset=utf-8;'});  // \ufeff BOM so Excel reads UTF-8
            var url=URL.createObjectURL(blob);
            var a=document.createElement('a'); a.href=url; a.download=filename; a.style.display='none';
            document.body.appendChild(a); a.click();
            setTimeout(function(){ try{ document.body.removeChild(a); }catch(e){} try{ URL.revokeObjectURL(url); }catch(e){} }, 1500);
            return true;
        }catch(e){ return false; }
    }
    function isoDate(d){ try{ return d.toISOString().slice(0,10); }catch(e){ return ''; } }
    // Our export bar lives as a SIBLING just before #supplyPanel-new inside the
    // Supply Request .container (supplyTab() only toggles panel display, so a
    // sibling here is never clobbered). Returns null when the anchor is absent.
    function supplyBar(){
        var anchor=document.getElementById('supplyPanel-new'); if(!anchor || !anchor.parentNode) return null;
        var el=document.getElementById('opuSupplyBar');
        if(!el){ el=document.createElement('div'); el.id='opuSupplyBar'; el.style.cssText='margin-bottom:14px;'; }
        if(el.parentNode!==anchor.parentNode || el.nextSibling!==anchor){ try{ anchor.parentNode.insertBefore(el, anchor); }catch(e){ return el; } }
        return el;
    }
    function supplyRemove(){ try{ var el=document.getElementById('opuSupplyBar'); if(el&&el.parentNode) el.parentNode.removeChild(el); }catch(e){} }
    function supplyBarHtml(from,to){
        return card('&#128666; Supply Request Export',
            '<div style="font-size:12px;color:#6b7686;margin-bottom:10px;">Manager tool &middot; download supply requests in a date range as a CSV file.</div>'
            +'<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">'
            +'<div style="flex:1;min-width:120px;">'+lbl('From')+'<input id="opuSupFrom" type="date" value="'+esc(from)+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d6deea;border-radius:8px;font-size:13px;margin:0;"></div>'
            +'<div style="flex:1;min-width:120px;">'+lbl('To')+'<input id="opuSupTo" type="date" value="'+esc(to)+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d6deea;border-radius:8px;font-size:13px;margin:0;"></div>'
            +'<button type="button" onclick="opu.supplyExport()" style="background:#D85A30;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap;">&#11015; Export CSV</button>'
            +'</div><div id="opuSupMsg" style="font-size:12.5px;margin-top:8px;"></div>', '#D85A30');
    }
    function mountSupply(){
        try{
            if(!isMgr()){ supplyRemove(); return; }        // manager-gated (mirrors _ops_is_mgr)
            if(!hasCreds()){ supplyRemove(); return; }      // no cached pin -> never prompt on auto-render
            var el=supplyBar(); if(!el) return;             // screen anchor absent -> no-op
            if(el.getAttribute('data-init')!=='1'){         // build once; preserve chosen dates across reopens
                var to=new Date(), from=new Date(); from.setDate(from.getDate()-30);
                el.innerHTML=supplyBarHtml(isoDate(from), isoDate(to));
                el.setAttribute('data-init','1');
            }
        }catch(e){ /* never throw onto the screen */ }
    }
    function supplyExport(){
        var msg=document.getElementById('opuSupMsg');
        function show(t,c){ if(msg){ msg.style.color=c||'#6b7686'; msg.innerHTML=t; } }
        var from=gv('opuSupFrom')||null, to=gv('opuSupTo')||null;
        show('Exporting&hellip;','#6b7686');
        rpc('app_supply_export', {p_from:from, p_to:to}, function(d){
            try{
                var rows=(d&&d.rows)||[];
                if(!rows.length){ show('No supply requests in that range'+((d&&d.note)?(' &middot; '+esc(String(d.note))):'')+'.','#9a5b00'); return; }
                var fn='supply_requests_'+(from||'all')+'_to_'+(to||'all')+'.csv';
                if(downloadCsv(fn, buildCsv(rows))) show('&#10003; Exported '+rows.length+' request'+(rows.length===1?'':'s')+' &middot; '+esc(fn),'#1f7a3d');
                else show('Could not start the download.','#c0264b');
            }catch(e){ show('Could not build the export.','#c0264b'); }
        }, function(err){
            var m=(err&&err.message)||'';
            show(String(m).indexOf('forbidden')>=0 ? 'You do not have access to export.' : 'Export is unavailable right now.','#c0264b');
        });
    }

    // ============================================================
    // (2) PRE-SHIFT SCHEDULED CREW  — "Auto-load" button on #preshiftView
    // ============================================================
    // Our panel is a SIBLING just before #psRoster (loadPreshift() only rewrites
    // #psRoster's innerHTML, so a sibling here survives every reload). It never
    // touches js/07 or the free-text lineup — it just reads the store + date the
    // user already picked and shows the published crew to read/copy.
    function preshiftPanel(){
        var anchor=document.getElementById('psRoster'); if(!anchor || !anchor.parentNode) return null;
        var el=document.getElementById('opuPreshiftPanel');
        if(!el){ el=document.createElement('div'); el.id='opuPreshiftPanel'; el.style.cssText='margin-bottom:12px;'; }
        if(el.parentNode!==anchor.parentNode || el.nextSibling!==anchor){ try{ anchor.parentNode.insertBefore(el, anchor); }catch(e){ return el; } }
        return el;
    }
    function preshiftRemove(){ try{ var el=document.getElementById('opuPreshiftPanel'); if(el&&el.parentNode) el.parentNode.removeChild(el); }catch(e){} }
    function preshiftIdleHtml(){
        return card('&#128101; Scheduled crew',
            '<div style="font-size:12px;color:#6b7686;margin-bottom:10px;">Pull the published schedule for the store &amp; date picked above, so you can fill the lineup faster.</div>'
            +'<button type="button" onclick="opu.preshiftLoad()" style="background:#185FA5;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-size:13px;font-weight:800;cursor:pointer;">&#8635; Auto-load scheduled crew</button>'
            +'<div id="opuPsBody" style="margin-top:10px;"></div>', '#185FA5');
    }
    function mountPreshift(){
        try{
            if(!hasCreds()){ preshiftRemove(); return; }    // authenticated; needs a cached pin (never prompt)
            var el=preshiftPanel(); if(!el) return;          // screen anchor absent -> no-op
            if(el.getAttribute('data-init')!=='1'){ el.innerHTML=preshiftIdleHtml(); el.setAttribute('data-init','1'); }
        }catch(e){ /* never throw onto the screen */ }
    }
    function fmtTime(t){ if(!t) return ''; var s=String(t); var m=s.match(/(\d{1,2}):(\d{2})/); if(m){ var h=+m[1]; var ap=h<12?'a':'p'; var hh=((h+11)%12)+1; return hh+':'+m[2]+ap; } return s.slice(0,5); }
    function preshiftCrewHtml(crew, store, date){
        var rows='', plain=[], i;
        for(i=0;i<crew.length;i++){ var c=crew[i]||{};
            var nm=c.employee_name||c.name||''; var pos=c.position||'';
            var st=fmtTime(c.start_time), en=fmtTime(c.end_time);
            var tspan=(st||en)?(st+(en?('&ndash;'+en):'')):'';
            var color=c.position_color||'#185FA5';
            rows+='<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:'+(i?'1px solid #f0f2f6':'none')+';">'
                +'<span style="width:4px;align-self:stretch;min-height:22px;background:'+esc(color)+';border-radius:99px;flex:none;"></span>'
                +'<div style="flex:1;min-width:0;"><b style="font-size:13.5px;color:#26242b;">'+esc(nm||'(no name)')+'</b>'+(pos?(' <span style="font-size:11.5px;color:#185FA5;font-weight:700;">'+esc(pos)+'</span>'):'')+'</div>'
                +(tspan?('<span style="font-size:11.5px;color:#6b7686;white-space:nowrap;">'+tspan+'</span>'):'')+'</div>';
            var pt=fmtTime(c.start_time), pe=fmtTime(c.end_time);
            plain.push((nm||'(no name)')+(pos?(' — '+pos):'')+((pt||pe)?(' ('+pt+(pe?('-'+pe):'')+')'):''));
        }
        var plainText=(store?(store+(date?(' · '+date):'')+'\n'):'')+plain.join('\n');
        var taH=Math.min(170, 34+crew.length*18);
        return '<div style="background:#fff;border:1px solid #eef0f5;border-radius:10px;padding:4px 12px 10px;">'+rows+'</div>'
            +lbl('Copy list')
            +'<textarea readonly onclick="try{this.select()}catch(e){}" style="width:100%;box-sizing:border-box;height:'+taH+'px;padding:8px 10px;border:1px solid #d7dbe2;border-radius:8px;font-size:12px;font-family:inherit;color:#3a4353;">'+esc(plainText)+'</textarea>';
    }
    function preshiftLoad(){
        var body=document.getElementById('opuPsBody');
        function put(h){ if(body) body.innerHTML=h; }
        var store=gv('psStore')||'', date=gv('psDate')||'';
        if(!store){ put('<div style="font-size:12.5px;color:#9a5b00;">Pick a store first.</div>'); return; }
        put('<div style="font-size:12.5px;color:#6b7686;">Loading scheduled crew&hellip;</div>');
        rpc('app_preshift_scheduled_crew', {p_store:store, p_date:date||null}, function(d){
            try{
                var crew=(d instanceof Array)?d:((d&&d.crew)||[]);   // RPC returns a jsonb ARRAY
                if(!crew.length){ put('<div style="font-size:12.5px;color:#6b7686;">No published crew found for '+esc(store)+(date?(' on '+esc(date)):'')+'. Use the free-text lineup below.</div>'); return; }
                put(preshiftCrewHtml(crew, store, date));
            }catch(e){ put('<div style="font-size:12.5px;color:#6b7686;">Could not read the scheduled crew.</div>'); }
        }, function(){ put('<div style="font-size:12.5px;color:#6b7686;">Scheduled crew is unavailable right now &mdash; use the free-text lineup below.</div>'); });
    }

    // ============================================================
    // (3+4) ADMIN AREA  — Permission Matrix (advisory) + Sensitive Records
    // Injected into the Admin Console (#adminConsoleView .container), which is a
    // STATIC container the app never fully innerHTML-rewrites, so our root can be
    // appended as a trailing child and (re)loaded on each openAdminConsole().
    // ============================================================
    function adminRoot(){
        var view=document.getElementById('adminConsoleView'); if(!view) return null;
        var cont=view.querySelector('.container'); if(!cont) return null;
        var el=document.getElementById('opuAdminRoot');
        if(!el){ el=document.createElement('div'); el.id='opuAdminRoot'; el.style.cssText='margin-top:14px;'; }
        if(el.parentNode!==cont){ try{ cont.appendChild(el); }catch(e){ return el; } }
        return el;
    }
    function adminRemove(){ try{ var el=document.getElementById('opuAdminRoot'); if(el&&el.parentNode) el.parentNode.removeChild(el); }catch(e){} }
    // When BOTH admin RPCs fail (whole migration not live yet / unauthorized),
    // remove the entire root so the Admin Console looks exactly as it does today.
    function adminSettle(key,ok){
        try{
            S.adminLoaded[key]= ok?'ok':'err';
            if(S.adminLoaded.perm!==null && S.adminLoaded.sens!==null){
                if(S.adminLoaded.perm==='err' && S.adminLoaded.sens==='err') adminRemove();
            }
        }catch(e){}
    }
    function mountAdmin(){
        try{
            if(!isMgr()){ adminRemove(); return; }          // manager-gated (both RPCs use _ops_is_mgr)
            if(!hasCreds()){ adminRemove(); return; }
            var el=adminRoot(); if(!el) return;
            S.adminLoaded={perm:null, sens:null};
            el.innerHTML='<div id="opuPermPanel"></div><div id="opuSensPanel"></div>';
            loadPermMatrix(); loadSensitive();
        }catch(e){ /* never throw onto the screen */ }
    }

    // ---- (3) Permission Matrix (advisory) ----
    function permAllowed(role,module){
        try{ var mx=(S.perm&&S.perm.matrix)||[]; for(var i=0;i<mx.length;i++){ if(mx[i].role===role && mx[i].module===module) return mx[i].allowed!==false; } }catch(e){}
        return true;   // advisory default = ALLOW (mirrors app_perm_check)
    }
    function setLocalPerm(role,module,allowed){
        try{
            var mx=(S.perm&&S.perm.matrix)||[]; for(var i=0;i<mx.length;i++){ if(mx[i].role===role && mx[i].module===module){ mx[i].allowed=allowed; return; } }
            mx.push({role:role, module:module, allowed:allowed}); if(S.perm) S.perm.matrix=mx;
        }catch(e){}
    }
    function loadPermMatrix(){
        paint('opuPermPanel', card('&#128272; Permission Matrix (advisory)', '<div style="font-size:12.5px;color:#6b7686;">Loading&hellip;</div>', '#3b2f6b'));
        rpc('app_perm_matrix_get', {}, function(d){
            try{
                if(!d || d.ok!==true){ paint('opuPermPanel',''); adminSettle('perm',false); return; }
                S.perm=d;
                var roles=d.roles||[]; if(!S.permRole || roles.indexOf(S.permRole)<0) S.permRole=roles.length?roles[0]:null;
                renderPerm(); adminSettle('perm',true);
            }catch(e){ paint('opuPermPanel',''); adminSettle('perm',false); }
        }, function(){ paint('opuPermPanel',''); adminSettle('perm',false); });
    }
    function renderPerm(){
        var d=S.perm; if(!d) return;
        var canManage=(d.can_manage===true) && isAdmin();
        var roles=d.roles||[], modules=d.modules||[], i;
        var roleSel='<select id="opuPermRole" onchange="opu.permRole(this.value)" style="flex:1;min-width:160px;padding:8px 10px;border:1px solid #d6deea;border-radius:8px;font-size:13px;">'
            +roles.map(function(r){ return '<option value="'+esc(r)+'"'+(r===S.permRole?' selected':'')+'>'+esc(r)+'</option>'; }).join('')+'</select>';
        var body='<div style="font-size:12px;color:#6b7686;margin-bottom:10px;">Advisory only &mdash; this mirrors the role &times; module map and does <b>not</b> change any live access gate. '+(canManage?'You can adjust advisory cells.':'Read-only for your role.')+'</div>'
            +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><span style="font-size:12px;font-weight:800;color:#33303a;">Role</span>'+roleSel+'</div>';
        if(!S.permRole){ body+='<div style="font-size:12.5px;color:#8a93a2;">No roles configured.</div>'; }
        else {
            var rows='';
            for(i=0;i<modules.length;i++){ var m=modules[i]; var on=permAllowed(S.permRole,m);
                rows+='<label style="display:flex;align-items:center;gap:10px;padding:9px 11px;'+(i?'border-top:1px solid #f3f4f8;':'')+(canManage?'cursor:pointer;':'')+'">'
                    +'<input type="checkbox" '+(on?'checked':'')+(canManage?'':' disabled')+' onchange="opu.permToggle('+i+',this.checked)" style="width:17px;height:17px;'+(canManage?'cursor:pointer;':'')+'">'
                    +'<span style="flex:1;font-size:13px;color:#26242b;">'+esc(m)+'</span>'
                    +'<span id="opuPermTag_'+i+'" style="font-size:10.5px;font-weight:800;color:'+(on?'#1f7a3d':'#c0264b')+';">'+(on?'allow':'deny')+'</span></label>';
            }
            body+='<div style="background:#fff;border:1px solid #eef0f5;border-radius:10px;overflow:hidden;">'+rows+'</div>';
        }
        paint('opuPermPanel', card('&#128272; Permission Matrix (advisory)', body, '#3b2f6b'));
    }
    function permModuleAt(idx){ try{ var modules=(S.perm&&S.perm.modules)||[]; return modules[idx]; }catch(e){ return null; } }
    function permToggle(idx, checked){
        var module=permModuleAt(idx); if(!module || !S.permRole) return;
        rpc('app_perm_matrix_set', {p_role:S.permRole, p_module:module, p_allowed:!!checked}, function(res){
            try{ var allowed=(res && res.allowed!==undefined)?(res.allowed!==false):!!checked; setLocalPerm(S.permRole, module, allowed); }catch(e){ setLocalPerm(S.permRole, module, !!checked); }
            renderPerm();   // re-render from server truth (protected roles may snap back to allow)
        }, function(){ renderPerm(); });   // revert the checkbox to unchanged local state
    }

    // ---- (4) Sensitive Records ----
    function loadSensitive(){
        paint('opuSensPanel', card('&#127991; Sensitive Records', '<div style="font-size:12.5px;color:#6b7686;">Loading&hellip;</div>', '#7a1620'));
        rpc('app_sensitive_list', S.sensFilter?{p_module:S.sensFilter}:{}, function(d){
            try{ S.sens=(d&&d.tags)||[]; renderSens(); adminSettle('sens',true); }catch(e){ paint('opuSensPanel',''); adminSettle('sens',false); }
        }, function(){ paint('opuSensPanel',''); adminSettle('sens',false); });
    }
    function sensFormHtml(){
        var f=S.sensForm||{};
        return '<div style="background:#fafbfc;border:1px solid #eef0f5;border-radius:10px;padding:12px;margin:2px 0 10px;">'
            +(S.sensErr?('<div style="background:#fdeaea;color:#a01b3e;border-radius:8px;padding:8px 10px;font-size:12.5px;font-weight:700;margin-bottom:8px;">'+esc(S.sensErr)+'</div>'):'')
            +lbl('Module')+inp('opuSensModule',f.module,'e.g. discipline, catering, supply')
            +lbl('Record ID')+inp('opuSensRecord',f.record_id,'the record identifier')
            +lbl('Sensitivity')+inp('opuSensLevel',f.sensitivity||'sensitive','sensitive')
            +lbl('Reason (optional)')+inp('opuSensReason',f.reason,'why is this sensitive?')
            +'<div style="display:flex;gap:8px;margin-top:2px;">'
            +'<button type="button" onclick="opu.sensSave()" style="background:#7a1620;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:800;cursor:pointer;">Save tag</button>'
            +'<button type="button" onclick="opu.sensCancel()" style="background:#eef0f3;color:#3a4353;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:800;cursor:pointer;">Cancel</button></div></div>';
    }
    function sensRowHtml(t, idx){ t=t||{};
        return '<div style="border-top:1px solid #f0f2f6;padding:9px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
            +'<div style="flex:1;min-width:150px;"><b style="font-size:13px;color:#26242b;">'+esc(t.module||'')+'</b> <span style="font-size:11.5px;color:#6b7280;">#'+esc(t.record_id||'')+'</span> '+pill(t.sensitivity||'sensitive','#f3e8ee','#7a1620')
            +(t.reason?('<div style="font-size:11.5px;color:#6b7280;margin-top:2px;">'+esc(t.reason)+'</div>'):'')
            +'<div style="font-size:10.5px;color:#a0a6b0;margin-top:1px;">'+esc(t.tagged_by||'')+(t.tagged_at?(' &middot; '+esc(String(t.tagged_at).slice(0,10))):'')+'</div></div>'
            +'<button type="button" onclick="opu.sensUntag('+idx+')" style="background:#fdeaea;color:#a01b3e;border:none;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:800;cursor:pointer;">Untag</button></div>';
    }
    function renderSens(){
        var tags=S.sens||[], i;
        var body='<div style="font-size:12px;color:#6b7686;margin-bottom:10px;">Flag any record (by module + record id) as sensitive. Manager tool &middot; audited.</div>'
            +'<button type="button" onclick="opu.sensAddToggle()" style="background:'+(S.sensForm?'#eef0f3':'#7a1620')+';color:'+(S.sensForm?'#3a4353':'#fff')+';border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:800;cursor:pointer;margin-bottom:10px;">'+(S.sensForm?'Close':'&#43; Tag a record')+'</button>';
        if(S.sensForm) body+=sensFormHtml();
        if(!tags.length) body+='<div style="text-align:center;color:#8a93a2;font-size:13px;padding:12px 6px;">No sensitive records tagged yet.</div>';
        else for(i=0;i<tags.length;i++) body+=sensRowHtml(tags[i], i);
        paint('opuSensPanel', card('&#127991; Sensitive Records', body, '#7a1620'));
    }
    function sensSave(){
        try{
            var module=String(gv('opuSensModule')).trim(), record=String(gv('opuSensRecord')).trim();
            var level=String(gv('opuSensLevel')).trim()||'sensitive', reason=String(gv('opuSensReason')).trim();
            if(!module){ S.sensErr='Module is required.'; renderSens(); return; }
            if(!record){ S.sensErr='Record ID is required.'; renderSens(); return; }
            S.sensErr='';
            rpc('app_sensitive_tag', {p_module:module, p_record_id:record, p_sensitivity:level, p_reason:reason||null},
                function(){ S.sensForm=null; S.sensErr=''; loadSensitive(); },
                function(err){ S.sensErr=(err&&err.message)||'Could not save the tag.'; renderSens(); });
        }catch(e){ S.sensErr='Could not save the tag.'; try{ renderSens(); }catch(_){} }
    }
    function sensUntag(idx){
        try{
            var t=(S.sens||[])[idx]; if(!t) return;
            try{ if(typeof confirm==='function' && !confirm('Remove the sensitive flag on '+(t.module||'')+' #'+(t.record_id||'')+'?')) return; }catch(e){}
            rpc('app_sensitive_untag', {p_module:t.module, p_record_id:t.record_id}, function(){ loadSensitive(); }, function(){ loadSensitive(); });
        }catch(e){}
    }

    // ---------- expose the action namespace (single global: window.opu) ----------
    try{
        window.opu = {
            supplyExport: supplyExport,
            preshiftLoad: preshiftLoad,
            permRole: function(r){ S.permRole=r||null; renderPerm(); },
            permToggle: permToggle,
            sensAddToggle: function(){ S.sensForm = S.sensForm ? null : {sensitivity:'sensitive'}; S.sensErr=''; renderSens(); },
            sensSave: sensSave,
            sensCancel: function(){ S.sensForm=null; S.sensErr=''; renderSens(); },
            sensUntag: sensUntag,
            _mountSupply: mountSupply, _mountPreshift: mountPreshift, _mountAdmin: mountAdmin
        };
    }catch(e){}

    // ---------- hook screen entry: append-only wraps of the global open fns ----------
    // Same proven pattern as js/31 (switchMenuTab) and js/37 (openCatering): reference
    // the global via window[name], wrap ONCE, run the original first, then mount on a
    // 0ms timeout. A short retry covers a late include (the open fn not yet defined).
    function hookOpen(fnName, mountFn, tries){
        try{
            var orig=null; try{ orig=window[fnName]; }catch(e){}
            if(typeof orig==='function'){
                if(!orig.__opuWrapped){
                    var w=(function(o){ function wrapped(){ var r; try{ r=o.apply(this,arguments); }catch(e){} try{ setTimeout(mountFn,0); }catch(e){ try{ mountFn(); }catch(_){} } return r; } wrapped.__opuWrapped=true; return wrapped; })(orig);
                    try{ window[fnName]=w; }catch(e){}
                }
                return;
            }
        }catch(e){}
        if((tries||0) < 40){ try{ setTimeout(function(){ hookOpen(fnName, mountFn, (tries||0)+1); }, 250); }catch(e){} }
    }
    try{ hookOpen('openSupplyRequest', mountSupply, 0); }catch(e){}
    try{ hookOpen('openPreshift',      mountPreshift, 0); }catch(e){}
    try{ hookOpen('openAdminConsole',  mountAdmin, 0); }catch(e){}

    // ---------- safety nets: mount now if a target screen is already visible ----------
    try{ var _sv=document.getElementById('supplyRequestView'); if(_sv && _sv.style && _sv.style.display==='block') setTimeout(mountSupply,0); }catch(e){}
    try{ var _pv=document.getElementById('preshiftView');      if(_pv && _pv.style && _pv.style.display==='block') setTimeout(mountPreshift,0); }catch(e){}
    try{ var _av=document.getElementById('adminConsoleView');  if(_av && _av.style && _av.style.display==='block') setTimeout(mountAdmin,0); }catch(e){}
})();
