// ============================================================
// PER-PAGE ADMIN SETTINGS  (js/39_admin_settings_tabs.js)
// Phase 2 / Batch 2b. Self-contained, append-only module: it edits NO other
// file (not index.html, not rpc_manifest.json, not any existing js/*). Screen
// entry is hooked by append-only wraps of the global open functions — the same
// proven pattern as js/31 (switchMenuTab), js/37 (openCatering), js/38 (ops).
//
// WHAT IT ADDS
//   1) A per-page admin "Settings" tab (a gear) injected into registered
//      screens. Only users whose ROLE HAS THE CAPABILITY see it. It opens an
//      inline panel holding just that page's settings — edited in context,
//      saved instantly. This is what stops every new control from being piled
//      into one Admin tab.
//   2) The Access & Permissions editor (Admin Console): the real role x
//      capability grid, backed by migration 0002. Admin-tier roles are locked
//      on so nobody can be stranded out of the system, and every change is
//      written to an audit log by the server.
//
// WHY THIS MATTERS: the Hub's two older permission systems (settings group
//   'perm_matrix' in js/04, and app_perm_matrix_* in js/38) are ADVISORY —
//   they hide tiles in the UI while the server still answers. This module is
//   wired to app_has_capability(), which is enforced server-side. The gear is
//   hidden by capability AND the RPC re-checks on every save, so hiding the
//   button is convenience, not the security boundary.
//
// FAIL-SAFE ABSOLUTELY: credentials come ONLY from the in-memory sessionPin /
//   sessionStorage('calichesPin') cache — this module NEVER calls prompt().
//   Every RPC is try/caught. If the backend isn't deployed, the caller lacks
//   the capability, or anything errors, the gear simply never appears and the
//   page renders exactly as it does today. It can never throw onto a screen.
//
// BACKEND CONTRACT (migrations/0002_capability_backbone.sql), via supabaseClient.rpc:
//   app_has_capability(p_username,p_password,p_cap)            -> boolean
//   app_perm_v2_get(p_username,p_password)
//       -> { roles:[{key,label,admin}], capabilities:[{key,label,descr}],
//            grants:[{role,cap,allowed}] }                      (raises 'forbidden')
//   app_perm_v2_set(p_username,p_password,p_role,p_cap,p_allowed) -> boolean
//   app_settings_get(p_username,p_password,p_group)  -> [{key,group,label,value,sort}]
//   app_settings_set(p_username,p_password,p_key,p_group,p_label,p_value,p_sort) -> bool
// ============================================================
(function(){
    'use strict';
    try{ if (typeof window === 'undefined') return; if (window.__adminTabsInjected) return; window.__adminTabsInjected = true; }catch(e){ return; }

    // ---------- tiny safe helpers (mirror js/38) ----------
    function esc(s){ try{ if(typeof escapeHtml==='function') return escapeHtml(s==null?'':String(s)); }catch(e){} return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return '&#'+c.charCodeAt(0)+';'; }); }
    function q(s){ return "'"+String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,' ')+"'"; }
    function assign(t,s){ try{ if(Object.assign) return Object.assign(t,s); }catch(e){} for(var k in s){ if(Object.prototype.hasOwnProperty.call(s,k)) t[k]=s[k]; } return t; }
    function byId(id){ try{ return document.getElementById(id); }catch(e){ return null; } }
    function paint(id,html){ var el=byId(id); if(el) el.innerHTML=html||''; }
    function gv(id){ var el=byId(id); return el? el.value : ''; }

    function pin(){
        try{ if(typeof sessionPin!=='undefined' && sessionPin) return sessionPin; }catch(e){}
        try{ if(typeof localStorage!=='undefined' && localStorage.getItem('calichesKeep')!=='0'){ var kp=sessionStorage.getItem('calichesPin'); if(kp) return kp; } }catch(e){}
        return null;
    }
    function hasCreds(){
        try{ return !!(typeof supabaseClient!=='undefined' && supabaseClient && typeof currentUser!=='undefined' && currentUser && currentUser.username && pin()); }catch(e){ return false; }
    }
    function rpc(name,args,cb,onerr){
        try{
            if(!hasCreds()){ if(onerr) onerr({message:'nocreds'}); return; }
            supabaseClient.rpc(name, assign({p_username:currentUser.username, p_password:pin()}, args||{}))
                .then(function(res){ try{ if(res && res.error){ if(onerr) onerr(res.error); return; } cb(res?res.data:null); }catch(e){ if(onerr) onerr({message:'render'}); } })
                .catch(function(){ if(onerr) onerr({message:'connection'}); });
        }catch(e){ if(onerr) onerr({message:'connection'}); }
    }

    // ---------- capability cache (asked once per session, per capability) ----------
    var CAP = {};   // capKey -> true / false / undefined(unknown)
    function capCheck(capKey, cb){
        try{
            if(CAP[capKey] === true || CAP[capKey] === false){ cb(CAP[capKey]); return; }
            rpc('app_has_capability', {p_cap:capKey}, function(d){
                CAP[capKey] = (d===true);
                cb(CAP[capKey]);
            }, function(){ CAP[capKey]=false; cb(false); });   // backend absent / error => stay hidden
        }catch(e){ cb(false); }
    }

    // ---------- style vocabulary (matches the app) ----------
    var BLUE='#185FA5', GREEN='#1f7a3d', GREY='#6b7686';
    function gearTabHtml(pageKey, open){
        return '<button id="ast-tab-'+esc(pageKey)+'" onclick="ast.toggle('+q(pageKey)+')" '
            + 'style="display:inline-flex;align-items:center;gap:7px;background:'+(open?BLUE:'#eef4fb')+';color:'+(open?'#fff':BLUE)+';'
            + 'border:1px solid '+(open?BLUE:'#cfe0f2')+';border-radius:9px;padding:7px 12px;font-size:12.5px;font-weight:800;cursor:pointer;">'
            + '<span style="font-size:14px;">&#9881;</span>Settings'
            + '<span style="background:'+(open?'rgba(255,255,255,.22)':'#dbeafe')+';color:'+(open?'#fff':BLUE)+';border-radius:999px;padding:1px 7px;font-size:9.5px;letter-spacing:.03em;">ADMIN</span>'
            + '</button>';
    }
    function panelShell(pageKey, title, inner){
        return '<div style="border:1px solid #cfe0f2;border-radius:12px;background:#f8fbff;padding:12px 14px;margin-top:10px;">'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'
            +   '<b style="flex:1;font-size:13.5px;color:#1F2A44;">&#9881; '+esc(title)+'</b>'
            +   '<span style="font-size:10.5px;color:'+GREY+';">Admin Managers and up &middot; saved instantly &middot; logged</span>'
            + '</div><div id="ast-body-'+esc(pageKey)+'">'+inner+'</div></div>';
    }
    function rowWrap(inner,first){ return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;'+(first?'':'border-top:1px solid #e6edf6;')+'">'+inner+'</div>'; }
    function note(t,c){ return '<div style="font-size:11.5px;color:'+(c||GREY)+';margin-top:6px;">'+esc(t)+'</div>'; }

    // ============================================================
    // PAGE REGISTRY — adding a page's settings is ONE entry here.
    // Each field maps to a row in public.app_settings (group + bare key).
    // NOTE: skey is the primary key across ALL groups, so keys must stay unique.
    // ============================================================
    var PAGES = {
        emergency: {
            viewId:  'emergencyView',
            openFn:  'openEmergency',
            title:   'Settings · Emergency',
            group:   'emergency',
            anchor:  'emergencyList',
            fields: [
                {key:'manager_on_call', label:'Manager on call',            hint:'Shown on every emergency procedure'},
                {key:'police',          label:'Police (non-emergency)',     hint:'For 911, crew are told to call 911 first'},
                {key:'utility',         label:'Electric utility',           hint:''},
                {key:'water_utility',   label:'Water utility',              hint:''},
                {key:'internet',        label:'Internet provider',          hint:''},
                {key:'machine_vendor',  label:'Machine / equipment vendor', hint:''}
            ]
        }
    };

    var S = { open:{}, values:{}, saving:{}, flash:{}, msg:{}, perm:null, permRole:null, permMsg:'' };

    // ---------- mount a page's gear tab ----------
    function mountPage(pageKey){
        try{
            var cfg = PAGES[pageKey]; if(!cfg) return;
            var view = byId(cfg.viewId); if(!view) return;
            capCheck('edit_settings', function(ok){
                try{
                    if(!ok){ var old=byId('ast-host-'+pageKey); if(old && old.parentNode) old.parentNode.removeChild(old); return; }
                    var host = byId('ast-host-'+pageKey);
                    if(!host){
                        host = document.createElement('div');
                        host.id = 'ast-host-'+pageKey;
                        host.style.cssText = 'margin:6px 0 4px;';
                        var anchor = cfg.anchor ? byId(cfg.anchor) : null;
                        if(anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor);
                        else view.appendChild(host);
                    }
                    renderPage(pageKey);
                }catch(e){}
            });
        }catch(e){}
    }

    function renderPage(pageKey){
        try{
            var cfg=PAGES[pageKey], host=byId('ast-host-'+pageKey); if(!cfg||!host) return;
            var open = !!S.open[pageKey];
            var html = gearTabHtml(pageKey, open);
            if(open){
                var vals = S.values[pageKey];
                var inner;
                if(!vals){ inner = note('Loading…'); }
                else {
                    inner = '';
                    for(var i=0;i<cfg.fields.length;i++){
                        var f=cfg.fields[i], v=vals[f.key]==null?'':vals[f.key];
                        if(v==='Not set') v='';
                        // per-field state so the result of pressing Save is unmissable
                        var st = S.flash[pageKey+'|'+f.key];   // 'saving' | 'saved' | 'failed'
                        var btn;
                        if(st==='saving'){
                            btn = '<button disabled style="background:#eef0f5;color:'+GREY+';border:1px solid #dde3ec;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:800;min-width:78px;">Saving…</button>';
                        } else if(st==='saved'){
                            btn = '<button disabled style="background:'+GREEN+';color:#fff;border:1px solid '+GREEN+';border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:800;min-width:78px;">&#10003; Saved</button>';
                        } else if(st==='failed'){
                            btn = '<button onclick="ast.save('+q(pageKey)+','+q(f.key)+','+q(f.label)+')" style="background:#fdeaea;color:#c0264b;border:1px solid #f3c2c2;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:800;min-width:78px;cursor:pointer;">Retry</button>';
                        } else {
                            btn = '<button onclick="ast.save('+q(pageKey)+','+q(f.key)+','+q(f.label)+')" style="background:#eef4fb;color:'+BLUE+';border:1px solid #cfe0f2;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:800;min-width:78px;cursor:pointer;">Save</button>';
                        }
                        var rowStyle = (st==='saved') ? 'background:#f0f9f3;border-radius:8px;' : '';
                        var fieldHtml =
                            '<div style="flex:1;min-width:0;">'
                          +   '<div style="font-size:13px;color:#26242b;">'+esc(f.label)+'</div>'
                          +   (f.hint? '<div style="font-size:11px;color:'+GREY+';margin-top:1px;">'+esc(f.hint)+'</div>':'')
                          + '</div>'
                          + '<input id="ast-f-'+esc(pageKey)+'-'+esc(f.key)+'" value="'+esc(v)+'" placeholder="Not set" '
                          +   'style="width:180px;padding:7px 10px;border:1px solid '+(st==='saved'?GREEN:'#d7dbe2')+';border-radius:8px;font-size:13px;">'
                          + btn;
                        inner += '<div style="display:flex;align-items:center;gap:10px;padding:9px 6px;'+(i===0?'':'border-top:1px solid #e6edf6;')+rowStyle+'">'+fieldHtml+'</div>';
                        continue;
                    }
                    if(S.msg[pageKey]) inner += note(S.msg[pageKey].text, S.msg[pageKey].ok?GREEN:'#c0264b');
                    inner += note('Everyone below Admin Manager never sees this tab — the page looks normal to them.');
                }
                html += panelShell(pageKey, cfg.title, inner);
            }
            host.innerHTML = html;
        }catch(e){}
    }

    function toggle(pageKey){
        try{
            var cfg=PAGES[pageKey]; if(!cfg) return;
            S.open[pageKey] = !S.open[pageKey];
            S.msg[pageKey] = null;
            renderPage(pageKey);
            if(S.open[pageKey] && !S.values[pageKey]){
                rpc('app_settings_get', {p_group:cfg.group}, function(rows){
                    try{
                        var m={}; (rows||[]).forEach(function(r){ if(r && r.key!=null) m[r.key]=r.value; });
                        S.values[pageKey]=m; renderPage(pageKey);
                    }catch(e){}
                }, function(){ S.values[pageKey]={}; S.msg[pageKey]={ok:false,text:'Could not load these settings right now.'}; renderPage(pageKey); });
            }
        }catch(e){}
    }

    function save(pageKey, key, label){
        try{
            var cfg=PAGES[pageKey]; if(!cfg) return;
            if(S.saving[pageKey+'|'+key]) return;
            var val = gv('ast-f-'+pageKey+'-'+key);
            var sort = 0;
            for(var i=0;i<cfg.fields.length;i++){ if(cfg.fields[i].key===key) sort=(i+1)*10; }
            var fkey = pageKey+'|'+key;
            S.saving[fkey]=true;
            S.flash[fkey]='saving'; S.msg[pageKey]=null; renderPage(pageKey);
            rpc('app_settings_set', {p_key:key, p_group:cfg.group, p_label:label, p_value:(val==null?'':String(val)), p_sort:sort}, function(){
                try{
                    S.saving[fkey]=false;
                    if(!S.values[pageKey]) S.values[pageKey]={};
                    S.values[pageKey][key]=val;
                    S.flash[fkey]='saved';
                    S.msg[pageKey]={ok:true, text:label+' saved to the database.'};
                    // keep the app's own settings cache in step so the page reflects it now
                    try{ if(typeof HUB_CFG!=='undefined' && HUB_CFG){ if(!HUB_CFG[cfg.group]) HUB_CFG[cfg.group]={}; HUB_CFG[cfg.group][key]={label:label,value:val,sort:sort}; } }catch(e){}
                    renderPage(pageKey);
                    // clear the green confirmation after a few seconds
                    try{ setTimeout(function(){ try{ if(S.flash[fkey]==='saved'){ S.flash[fkey]=null; renderPage(pageKey); } }catch(e){} }, 3000); }catch(e){}
                }catch(e){}
            }, function(err){
                S.saving[fkey]=false;
                S.flash[fkey]='failed';
                var m=(err&&err.message)||'';
                S.msg[pageKey]={ok:false, text: /admin/i.test(m)? 'Not saved — admins only. The server refused this change.'
                                          : /nocreds/i.test(m)? 'Not saved — please sign in again.'
                                          : 'Not saved — connection problem. Press Retry.'};
                renderPage(pageKey);
            });
        }catch(e){}
    }

    // ============================================================
    // ACCESS & PERMISSIONS EDITOR (Admin Console)
    // Real role x capability grid backed by migration 0002.
    // ============================================================
    function mountPerm(){
        try{
            var view=byId('adminConsoleView'); if(!view) return;
            capCheck('edit_permissions', function(ok){
                try{
                    var old=byId('ast-perm-host');
                    if(!ok){ if(old && old.parentNode) old.parentNode.removeChild(old); return; }
                    var host=old;
                    if(!host){ host=document.createElement('div'); host.id='ast-perm-host'; host.style.cssText='margin:12px 0;'; view.appendChild(host); }
                    loadPerm();
                }catch(e){}
            });
        }catch(e){}
    }

    // load the matrix once, then render into whichever #ast-perm-host exists
    // (the Admin Console panel, or the modal opened from the old tile)
    function loadPerm(){
        try{
            var host=byId('ast-perm-host'); if(!host) return;
            if(S.perm){ renderPerm(); return; }
            host.innerHTML='<div style="font-size:12px;color:'+GREY+';">Loading access &amp; permissions…</div>';
            rpc('app_perm_v2_get', {}, function(d){
                try{
                    if(!d || !d.roles){ host.innerHTML='<div style="font-size:12.5px;color:#c0264b;">Could not load permissions.</div>'; return; }
                    S.perm=d;
                    if(!S.permRole){
                        for(var i=0;i<d.roles.length;i++){ if(!d.roles[i].admin){ S.permRole=d.roles[i].key; break; } }
                        if(!S.permRole && d.roles.length) S.permRole=d.roles[0].key;
                    }
                    renderPerm();
                }catch(e){}
            }, function(err){
                try{
                    var m=(err&&err.message)||'';
                    host.innerHTML='<div style="font-size:12.5px;color:#c0264b;">'
                        + (/forbidden/i.test(m) ? 'Roles &amp; permissions is for Admin Managers.' : 'Could not load permissions right now.')
                        + '</div>';
                }catch(e){}
            });
        }catch(e){}
    }

    function grantOf(role,cap){
        try{
            var g=S.perm.grants||[];
            for(var i=0;i<g.length;i++){ if(g[i].role===role && g[i].cap===cap) return g[i].allowed===true; }
        }catch(e){}
        return false;
    }
    function roleObj(key){
        try{ var r=S.perm.roles||[]; for(var i=0;i<r.length;i++){ if(r[i].key===key) return r[i]; } }catch(e){}
        return null;
    }

    function renderPerm(){
        try{
            var host=byId('ast-perm-host'); if(!host||!S.perm) return;
            var roles=S.perm.roles||[], caps=S.perm.capabilities||[], role=S.permRole, ro=roleObj(role);
            var opts='';
            for(var i=0;i<roles.length;i++){
                opts += '<option value="'+esc(roles[i].key)+'"'+(roles[i].key===role?' selected':'')+'>'+esc(roles[i].label)+(roles[i].admin?' (always full access)':'')+'</option>';
            }
            var body='';
            if(ro && ro.admin){
                body = '<div style="background:#e8f5ec;border:1px solid #bfe6cc;border-radius:10px;padding:13px;color:'+GREEN+';font-size:13px;">'
                     + esc(ro.label)+' always has full access. This protects admins from being locked out of the system. Pick another role to adjust its access.</div>';
            } else {
                body = '<div style="background:#fff;border:1px solid #eef0f5;border-radius:10px;overflow:hidden;">';
                for(var c=0;c<caps.length;c++){
                    var cap=caps[c], on=grantOf(role,cap.key);
                    body += '<label style="display:flex;align-items:center;gap:10px;padding:10px 13px;'+(c?'border-top:1px solid #f3f4f8;':'')+'cursor:pointer;">'
                          + '<input type="checkbox" '+(on?'checked':'')+' onchange="ast.permToggle('+q(cap.key)+',this.checked)" style="width:17px;height:17px;cursor:pointer;">'
                          + '<span style="flex:1;min-width:0;">'
                          +   '<span style="font-size:13.5px;color:#26242b;">'+esc(cap.label)+'</span>'
                          +   (cap.descr? '<span style="display:block;font-size:11px;color:'+GREY+';">'+esc(cap.descr)+'</span>':'')
                          + '</span></label>';
                }
                body += '</div>';
            }
            host.innerHTML =
                '<div style="background:#fff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,.05);overflow:hidden;">'
              + '<div style="background:'+BLUE+';color:#fff;padding:10px 14px;"><b style="font-size:14.5px;">Access &amp; permissions</b></div>'
              + '<div style="padding:12px 14px;">'
              +   '<p style="font-size:12.5px;color:'+GREY+';margin:0 0 10px;line-height:1.5;">Roles and what each one can do. These are enforced on the server, not just hidden on the screen. Changes take effect at that person’s next screen refresh and every change is written to an audit log.</p>'
              +   '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
              +     '<label style="font-size:12.5px;font-weight:800;color:#33303a;">Role</label>'
              +     '<select onchange="ast.permRole(this.value)" style="flex:1;min-width:150px;padding:8px;border:1px solid #d6deea;border-radius:8px;font-size:13.5px;">'+opts+'</select>'
              +   '</div>'
              +   body
              +   (S.permMsg? note(S.permMsg.text, S.permMsg.ok?GREEN:'#c0264b') : '')
              + '</div></div>';
        }catch(e){}
    }

    function permToggle(capKey, checked){
        try{
            var role=S.permRole; if(!role) return;
            S.permMsg=null;
            rpc('app_perm_v2_set', {p_role:role, p_cap:capKey, p_allowed:!!checked}, function(){
                try{
                    var g=S.perm.grants||[], found=false;
                    for(var i=0;i<g.length;i++){ if(g[i].role===role && g[i].cap===capKey){ g[i].allowed=!!checked; found=true; break; } }
                    if(!found) g.push({role:role, cap:capKey, allowed:!!checked});
                    S.permMsg={ok:true, text:'Saved.'};
                    // this may have changed OUR own capabilities — drop the cache
                    CAP = {};
                    renderPerm();
                }catch(e){}
            }, function(err){
                var m=(err&&err.message)||'';
                S.permMsg={ok:false, text: /lockout|admin-tier/i.test(m) ? 'Admin roles can’t have access removed — that would lock everyone out.'
                                        : /forbidden/i.test(m) ? 'The server refused this change.'
                                        : 'Could not save that change.'};
                renderPerm();
            });
        }catch(e){}
    }

    // ============================================================
    // RETIRE THE TWO OLD, NON-ENFORCING PERMISSION SCREENS
    //
    // Before this module the Hub had two "permissions" UIs and NEITHER changed
    // a live gate:
    //   - js/04 openPermMatrix()  — the Admin tile "Roles & Permissions /
    //     Control what each role can see". Its toggles only hid tiles.
    //   - js/38 advisory matrix   — its own header says "Advisory only; never
    //     changes a live gate."
    // Leaving them next to the real editor is dangerous: an admin could switch
    // someone "off", watch it save, and believe access was removed when the
    // server would still answer. So the old tile now opens the REAL editor.
    // Append-only: js/04 and js/38 are not modified.
    // ============================================================
    function openRealPermEditor(){
        try{
            var ov=byId('astPermModal');
            if(!ov){
                ov=document.createElement('div'); ov.id='astPermModal';
                ov.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;';
                document.body.appendChild(ov);
            }
            ov.style.display='block';
            ov.innerHTML='<div style="background:'+BLUE+';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;">'
                       +   '<b style="flex:1;font-size:16px;">Access &amp; permissions</b>'
                       +   '<button onclick="ast.closePerm()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:15px;">&times;</button>'
                       + '</div><div style="max-width:660px;margin:0 auto;padding:16px 16px 60px;"><div id="ast-perm-host"></div></div>';
            loadPerm();
        }catch(e){}
    }
    function closeRealPermEditor(){ try{ var o=byId('astPermModal'); if(o) o.style.display='none'; }catch(e){} }

    // replace the old tile's handler once the app has defined it
    function retireOldPermUI(tries){
        try{
            if(typeof window.openPermMatrix === 'function' && !window.openPermMatrix.__astReplaced){
                var repl = function(){ openRealPermEditor(); };
                repl.__astReplaced = true;
                window.openPermMatrix = repl;
                return;
            }
            if(typeof window.openPermMatrix === 'function') return;   // already ours
        }catch(e){}
        if((tries||0) < 40){ try{ setTimeout(function(){ retireOldPermUI((tries||0)+1); }, 250); }catch(e){} }
    }

    // ============================================================
    // PER-PERSON ACCESS  — on the employee profile
    // Grant or deny one capability for ONE person, on top of their role.
    // Backed by app_user_caps_get / app_user_cap_set (migration 0003).
    // ============================================================
    var P = { uid:null, data:null, msg:null, busy:{} };

    // TESTER FIX (2026-07-24): the profile carries a schedule_employees id, but
    // the capability RPCs take a public.users id — different id spaces, so every
    // Allow/Deny used to come back "no such user". Resolve the real user account
    // from the profile's linked_username (falling back to the display name).
    // Cached per profile so we ask the server once.
    var PROF_UID = {};   // employeeId -> users.id | 'none' | undefined

    function profileEmp(){
        try{ return (typeof _empProfile!=='undefined' && _empProfile) ? _empProfile : (window._empProfile||null); }
        catch(e){ return null; }
    }
    function profileEmpId(){
        var p = profileEmp(); if(!p) return null;
        return p.id || p.employee_id || null;
    }
    // cb(userId or null)
    function resolveProfileUser(cb){
        try{
            var p = profileEmp(); var eid = profileEmpId();
            if(!p || !eid){ cb(null); return; }
            if(PROF_UID[eid] === 'none'){ cb(null); return; }
            if(PROF_UID[eid]){ cb(PROF_UID[eid]); return; }
            var needle = p.linked_username || p.username || p.name || '';
            if(!needle){ PROF_UID[eid]='none'; cb(null); return; }
            rpc('app_user_id_for_profile', {p_needle:String(needle)}, function(d){
                try{
                    if(d){ PROF_UID[eid]=d; cb(d); }
                    else { PROF_UID[eid]='none'; cb(null); }
                }catch(e){ cb(null); }
            }, function(){ cb(null); });
        }catch(e){ cb(null); }
    }

    // the profile body is filled after an RPC, so wait for it before injecting
    function mountProfileAccess(tries){
        try{
            var view=byId('employeeProfileView');
            if(!view || !view.style || view.style.display!=='block') return;
            var body=byId('empProfileBody'), eid=profileEmpId();
            if((!body || !eid) && (tries||0) < 30){ setTimeout(function(){ mountProfileAccess((tries||0)+1); }, 250); return; }
            if(!body || !eid) return;

            capCheck('edit_permissions', function(ok){
                try{
                    var old=byId('ast-prof-host');
                    if(!ok){ if(old && old.parentNode) old.parentNode.removeChild(old); return; }
                    var host=byId('ast-prof-host');
                    if(!host || host.parentNode!==body){
                        host=document.createElement('div'); host.id='ast-prof-host'; host.style.cssText='margin-top:14px;';
                        body.appendChild(host);
                    }
                    host.innerHTML='<div style="font-size:12px;color:'+GREY+';">Loading access…</div>';

                    resolveProfileUser(function(uid){
                        try{
                            var h=byId('ast-prof-host'); if(!h) return;
                            if(!uid){
                                // honest, not a silent failure: this person has no Hub login,
                                // so there is no account to grant anything to.
                                h.innerHTML =
                                    '<div style="background:#fff;border:1px solid #e6ebf2;border-radius:16px;padding:12px 14px;">'
                                  + '<b style="font-size:13.5px;color:#1F2A44;">&#128274; Access for this person</b>'
                                  + '<div style="font-size:12.5px;color:'+GREY+';margin-top:6px;line-height:1.5;">'
                                  + 'This employee doesn’t have a Hub login yet, so there’s no account to set access on. '
                                  + 'Once they create an account (or one is linked to them), their access controls appear here.'
                                  + '</div></div>';
                                return;
                            }
                            if(P.uid !== uid){ P.uid=uid; P.data=null; P.msg=null; }
                            if(!P.data){
                                rpc('app_user_caps_get', {p_user_id:uid}, function(d){
                                    try{ P.data=d; renderProfileAccess(); }catch(e){}
                                }, function(){ try{ var hh=byId('ast-prof-host'); if(hh) hh.innerHTML='<div style="font-size:12.5px;color:#c0264b;">Could not load this person’s access right now.</div>'; }catch(e){} });
                            } else renderProfileAccess();
                        }catch(e){}
                    });
                }catch(e){}
            });
        }catch(e){}
    }

    function renderProfileAccess(){
        try{
            var host=byId('ast-prof-host'); if(!host||!P.data) return;
            var caps=P.data.capabilities||[];
            var rows='';
            for(var i=0;i<caps.length;i++){
                var c=caps[i];
                var ov = c.override;                       // true / false / null(follow role)
                var eff = c.effective===true;
                var state = (ov===true)?'allow':(ov===false)?'deny':'role';
                var pill = (state==='role')
                    ? '<span style="font-size:10.5px;color:'+GREY+';">follows role ('+(c.from_role?'on':'off')+')</span>'
                    : (state==='allow'
                        ? '<span style="font-size:10.5px;font-weight:800;color:'+GREEN+';">ALWAYS ALLOW</span>'
                        : '<span style="font-size:10.5px;font-weight:800;color:#c0264b;">ALWAYS DENY</span>');
                function btn(val,label,active,col){
                    return '<button onclick="ast.profSet('+q(c.key)+','+val+')" style="background:'+(active?col:'#fff')+';color:'+(active?'#fff':GREY)+';border:1px solid '+(active?col:'#d7dbe2')+';border-radius:7px;padding:5px 9px;font-size:11.5px;font-weight:800;cursor:pointer;">'+label+'</button>';
                }
                rows += '<div style="display:flex;align-items:center;gap:8px;padding:9px 4px;'+(i?'border-top:1px solid #f0f2f6;':'')+'">'
                      +   '<div style="flex:1;min-width:0;">'
                      +     '<div style="font-size:13px;color:#26242b;">'+esc(c.label)+' '+pill+'</div>'
                      +     (c.descr? '<div style="font-size:11px;color:'+GREY+';">'+esc(c.descr)+'</div>':'')
                      +   '</div>'
                      +   '<span style="font-size:11px;color:'+(eff?GREEN:GREY)+';font-weight:800;min-width:34px;text-align:right;">'+(eff?'CAN':'no')+'</span>'
                      +   btn('null','Role', state==='role', '#5b6675')
                      +   btn('true','Allow', state==='allow', GREEN)
                      +   btn('false','Deny', state==='deny', '#c0264b')
                      + '</div>';
            }
            host.innerHTML =
                '<div style="background:#fff;border:1px solid #e6ebf2;border-radius:16px;overflow:hidden;">'
              + '<div style="background:'+BLUE+';color:#fff;padding:10px 14px;display:flex;align-items:center;gap:8px;">'
              +   '<b style="flex:1;font-size:14px;">&#128274; Access for this person</b>'
              +   '<span style="font-size:10.5px;opacity:.85;">admins only &middot; logged</span></div>'
              + '<div style="padding:10px 14px;">'
              +   '<p style="font-size:12px;color:'+GREY+';margin:0 0 8px;line-height:1.5;">Their role decides this by default. Use <b>Allow</b> or <b>Deny</b> to change it for this one person only — everyone else with the same role is unaffected.</p>'
              +   rows
              +   (P.msg? note(P.msg.text, P.msg.ok?GREEN:'#c0264b') : '')
              + '</div></div>';
        }catch(e){}
    }

    function profSet(capKey, val){
        try{
            if(!P.uid || P.busy[capKey]) return;
            P.busy[capKey]=true; P.msg=null;
            rpc('app_user_cap_set', {p_user_id:P.uid, p_cap:capKey, p_allowed:val}, function(){
                try{
                    P.busy[capKey]=false;
                    var caps=(P.data&&P.data.capabilities)||[];
                    for(var i=0;i<caps.length;i++){ if(caps[i].key===capKey){
                        caps[i].override = val;
                        caps[i].effective = (val===null||val===undefined) ? (caps[i].from_role===true) : (val===true);
                    } }
                    P.msg={ok:true, text:'Saved for this person.'};
                    CAP = {};   // their change may affect what WE can see
                    renderProfileAccess();
                }catch(e){}
            }, function(err){
                P.busy[capKey]=false;
                var m=(err&&err.message)||'';
                P.msg={ok:false, text: /forbidden/i.test(m)? 'Not saved — the server refused this change.' : 'Not saved — try again.'};
                renderProfileAccess();
            });
        }catch(e){}
    }

    // ---------- public surface (inline on* handlers) ----------
    try{
        window.ast = {
            toggle: toggle,
            save: save,
            permRole: function(r){ S.permRole=r||null; S.permMsg=null; renderPerm(); },
            permToggle: permToggle,
            profSet: profSet,
            openPerm: openRealPermEditor,
            closePerm: closeRealPermEditor,
            _mountPage: mountPage, _mountPerm: mountPerm, _mountProfile: mountProfileAccess,
            _retireOldPermUI: retireOldPermUI,
            _pages: PAGES
        };
    }catch(e){}

    // ---------- hook screen entry (append-only wraps; same pattern as js/38) ----------
    function hookOpen(fnName, mountFn, tries){
        try{
            var orig=null; try{ orig=window[fnName]; }catch(e){}
            if(typeof orig==='function'){
                if(!orig.__astWrapped){
                    var w=(function(o){ function wrapped(){ var r; try{ r=o.apply(this,arguments); }catch(e){} try{ setTimeout(mountFn,0); }catch(e){ try{ mountFn(); }catch(_){} } return r; } wrapped.__astWrapped=true; return wrapped; })(orig);
                    try{ window[fnName]=w; }catch(e){}
                }
                return;
            }
        }catch(e){}
        if((tries||0) < 40){ try{ setTimeout(function(){ hookOpen(fnName, mountFn, (tries||0)+1); }, 250); }catch(e){} }
    }
    try{
        for(var k in PAGES){ if(Object.prototype.hasOwnProperty.call(PAGES,k)){
            (function(pk){ try{ hookOpen(PAGES[pk].openFn, function(){ mountPage(pk); }, 0); }catch(e){} })(k);
        } }
    }catch(e){}
    try{ hookOpen('openAdminConsole', mountPerm, 0); }catch(e){}
    try{ hookOpen('openEmployeeProfile', function(){ mountProfileAccess(0); }, 0); }catch(e){}
    try{ retireOldPermUI(0); }catch(e){}

    // ---------- safety nets: mount now if a target screen is already visible ----------
    try{
        for(var k2 in PAGES){ if(Object.prototype.hasOwnProperty.call(PAGES,k2)){
            (function(pk){ try{ var v=byId(PAGES[pk].viewId); if(v && v.style && v.style.display==='block') setTimeout(function(){ mountPage(pk); },0); }catch(e){} })(k2);
        } }
    }catch(e){}
    try{ var _ac=byId('adminConsoleView'); if(_ac && _ac.style && _ac.style.display==='block') setTimeout(mountPerm,0); }catch(e){}
})();
