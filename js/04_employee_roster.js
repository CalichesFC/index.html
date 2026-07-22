    // ============================================================
    // EMPLOYEE ROSTER (Admin Manager only)
    // ============================================================
    let rosterState = { list: [], meta: { positions:[], locations:[], users:[] } };
    function rosterEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function openRoster(){
        if(!isAdminManager()){ alert('Admins only.'); return; }
        triggerTransition(()=>{
            document.querySelectorAll('.app-view').forEach(v=>v.style.display='none');
            document.getElementById('rosterView').style.display='block';
            loadRosterMeta(); loadRoster();
        });
    }
    function certExpiryBadge(exp){
        if(!exp) return '<span style="background:#eef0f3;color:#6b7686;font-size:11px;font-weight:700;padding:2px 7px;border-radius:99px;">No expiry</span>';
        var today=schedFmt(new Date()); var soon=new Date(); soon.setDate(soon.getDate()+30); var soonStr=schedFmt(soon);
        if(exp<today) return '<span style="background:#fdeaea;color:#a01b3e;font-size:11px;font-weight:800;padding:2px 7px;border-radius:99px;" title="Expired '+exp+'">Expired &ndash; Renewal Required</span>';
        if(exp<=soonStr) return '<span style="background:#fff4e0;color:#9a5b00;font-size:11px;font-weight:800;padding:2px 7px;border-radius:99px;">Expires '+exp+'</span>';
        return '<span style="background:#e8f5ec;color:#1b7a3d;font-size:11px;font-weight:700;padding:2px 7px;border-radius:99px;">Valid to '+exp+'</span>';
    }
    function certOverlay(id){
        var ov=document.getElementById(id);
        if(!ov){ ov=document.createElement('div'); ov.id=id; ov.style.cssText='position:fixed;inset:0;background:rgba(20,20,30,.5);z-index:100000;display:flex;align-items:flex-start;justify-content:center;padding:18px;overflow:auto;'; ov.addEventListener('click',function(e){ if(e.target===ov) ov.style.display='none'; }); document.body.appendChild(ov); }
        ov.style.display='flex'; return ov;
    }
    function openEmpCerts(empId,name){
        window._certEmp={id:empId,name:name};
        var ov=certOverlay('empCertsModal');
        ov.innerHTML='<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;margin-top:30px;padding:18px;box-shadow:0 16px 50px rgba(0,0,0,.3);"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><b style="flex:1;font-size:16px;color:#1f2a44;">Certifications &mdash; '+escapeHtml(name||'')+'</b><button data-x style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div><div id="empCertsBody"><p style="text-align:center;color:#6b7686;padding:18px;">Loading&hellip;</p></div><button onclick="openEmpCertEdit(null)" style="width:100%;margin-top:12px;background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:700;cursor:pointer;">&#10133; Add certification</button></div>';
        ov.querySelectorAll('[data-x]').forEach(function(b){ b.onclick=function(){ ov.style.display='none'; }; });
        loadEmpCerts();
    }
    function loadEmpCerts(){
        var body=document.getElementById('empCertsBody'); if(!body) return;
        withPin(function(pin){
            supabaseClient.rpc('app_emp_certs_get',{p_username:currentUser.username,p_password:pin,p_emp_id:window._certEmp.id}).then(function(r){
                if(r.error){ body.innerHTML='<p style="color:#c0264b;text-align:center;">'+escapeHtml(r.error.message)+'</p>'; return; }
                window._certList=r.data||[];
                if(!window._certList.length){ body.innerHTML='<p style="color:#6b7686;text-align:center;padding:14px;font-size:13px;">No certifications on file yet.</p>'; return; }
                var h='';
                window._certList.forEach(function(c){
                    h+='<div style="border:1px solid #ececf2;border-radius:10px;padding:10px 12px;margin-bottom:7px;"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(c.type||'')+'</b>'+certExpiryBadge(c.expires)+'</div>'+
                       (c.number?'<div style="font-size:12px;color:#6b7686;margin-top:2px;">#'+escapeHtml(c.number)+'</div>':'')+
                       (c.issued?'<div style="font-size:12px;color:#6b7686;">Issued '+escapeHtml(c.issued)+'</div>':'')+
                       (c.notes?'<div style="font-size:12px;color:#6b7686;margin-top:2px;">'+escapeHtml(c.notes)+'</div>':'')+
                       (c.file?'<div style="margin-top:3px;"><a href="'+escapeHtml(c.file)+'" target="_blank" rel="noopener" style="font-size:12px;color:#185FA5;font-weight:700;">&#128196; View file</a></div>':'')+
                       '<div style="display:flex;gap:6px;margin-top:8px;"><button onclick="openEmpCertEdit('+c.id+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:7px;padding:6px 11px;font-size:12px;font-weight:700;cursor:pointer;">Edit</button><button onclick="deleteEmpCert('+c.id+')" style="background:#fdeaea;color:#c0264b;border:none;border-radius:7px;padding:6px 11px;font-size:12px;font-weight:700;cursor:pointer;">Delete</button></div></div>';
                });
                body.innerHTML=h;
            }).catch(function(){ body.innerHTML='<p style="color:#c0264b;text-align:center;">Could not load.</p>'; });
        });
    }
    function openEmpCertEdit(id){
        var c=id?(window._certList||[]).filter(function(x){return x.id===id;})[0]:null; window._certEditId=id||null;
        var ov=certOverlay('empCertEditModal');
        ov.innerHTML='<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;margin-top:40px;padding:18px;box-shadow:0 16px 50px rgba(0,0,0,.3);"><b style="font-size:15px;color:#1f2a44;">'+(id?'Edit':'Add')+' certification</b>'+
          '<div style="margin-top:10px;"><label class="rm-lbl">Type *</label><input id="certType" class="rm-inp" placeholder="e.g. Food Handler" value="'+escapeHtml(c?(c.type||''):'')+'"></div>'+
          '<div style="margin-top:8px;"><label class="rm-lbl">Certificate #</label><input id="certNum" class="rm-inp" value="'+escapeHtml(c?(c.number||''):'')+'"></div>'+
          '<div style="display:flex;gap:8px;margin-top:8px;"><div style="flex:1;"><label class="rm-lbl">Issued</label><input id="certIssued" type="date" class="rm-inp" value="'+escapeHtml(c?(c.issued||''):'')+'"></div><div style="flex:1;"><label class="rm-lbl">Expires</label><input id="certExpires" type="date" class="rm-inp" value="'+escapeHtml(c?(c.expires||''):'')+'"></div></div>'+
          '<div style="margin-top:8px;"><label class="rm-lbl">File link (Dropbox/Drive)</label><input id="certFile" class="rm-inp" placeholder="https://..." value="'+escapeHtml(c?(c.file||''):'')+'"></div>'+
          '<div style="margin-top:8px;"><label class="rm-lbl">Notes</label><input id="certNotes" class="rm-inp" value="'+escapeHtml(c?(c.notes||''):'')+'"></div>'+
          '<div id="certEditMsg" style="font-size:12px;margin-top:8px;"></div>'+
          '<div style="display:flex;gap:8px;margin-top:12px;"><button data-x style="flex:1;background:#eef0f3;color:#444;border:none;border-radius:10px;padding:11px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="saveEmpCert()" style="flex:2;background:var(--pass-green,#1f7a3d);color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">Save</button></div></div>';
        ov.querySelectorAll('[data-x]').forEach(function(b){ b.onclick=function(){ ov.style.display='none'; }; });
    }
    function saveEmpCert(){
        var t=(document.getElementById('certType').value||'').trim(); var msg=document.getElementById('certEditMsg');
        if(!t){ msg.style.color='#c0264b'; msg.textContent='Type is required.'; return; }
        msg.style.color='#6b7686'; msg.textContent='Saving...';
        withPin(function(pin){
            supabaseClient.rpc('app_emp_cert_save',{p_username:currentUser.username,p_password:pin,p_id:window._certEditId,p_emp_id:window._certEmp.id,p_type:t,p_number:document.getElementById('certNum').value,p_issued:document.getElementById('certIssued').value||null,p_expires:document.getElementById('certExpires').value||null,p_notes:document.getElementById('certNotes').value,p_file:document.getElementById('certFile').value}).then(function(r){
                if(r.error){ msg.style.color='#c0264b'; msg.textContent='Error: '+r.error.message; return; }
                var ov=document.getElementById('empCertEditModal'); if(ov) ov.style.display='none'; loadEmpCerts();
            }).catch(function(){ msg.style.color='#c0264b'; msg.textContent='Could not save.'; });
        });
    }
    function deleteEmpCert(id){
        if(!confirm('Delete this certification?')) return;
        withPin(function(pin){
            supabaseClient.rpc('app_emp_cert_delete',{p_username:currentUser.username,p_password:pin,p_id:id}).then(function(r){
                if(r.error){ alert('Error: '+r.error.message); return; } loadEmpCerts();
            }).catch(function(){ alert('Could not delete.'); });
        });
    }
    function openAllCerts(){
        var ov=certOverlay('allCertsModal');
        ov.innerHTML='<div style="background:#fff;border-radius:14px;max-width:640px;width:100%;margin-top:24px;padding:18px;box-shadow:0 16px 50px rgba(0,0,0,.3);"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><b style="flex:1;font-size:17px;color:#1f2a44;">&#128203; All certifications</b><button onclick="window.print()" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:7px 11px;font-size:12.5px;font-weight:700;cursor:pointer;">&#128424; Print</button><button data-x style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div><div style="font-size:12px;color:#6b7686;margin-bottom:10px;">For health-inspector review. Tap a name to manage their certs.</div><div id="allCertsBody"><p style="text-align:center;color:#6b7686;padding:18px;">Loading&hellip;</p></div></div>';
        ov.querySelectorAll('[data-x]').forEach(function(b){ b.onclick=function(){ ov.style.display='none'; }; });
        withPin(function(pin){
            supabaseClient.rpc('app_certs_all',{p_username:currentUser.username,p_password:pin,p_location:''}).then(function(r){
                var body=document.getElementById('allCertsBody'); if(!body) return;
                if(r.error){ body.innerHTML='<p style="color:#c0264b;text-align:center;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var list=r.data||[]; if(!list.length){ body.innerHTML='<p style="color:#6b7686;text-align:center;">No active staff.</p>'; return; }
                var h='';
                list.forEach(function(p){
                    var certs=p.certs||[];
                    h+='<div style="border:1px solid #ececf2;border-radius:10px;padding:10px 12px;margin-bottom:7px;"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14px;color:#26242b;cursor:pointer;" onclick="openEmpCerts('+p.employee_id+',&quot;'+escapeHtml((p.name||'').replace(/"/g,''))+'&quot;)">'+escapeHtml(p.name||'')+'</b><span style="font-size:11.5px;color:#5b6675;">'+escapeHtml(p.home||'')+'</span></div>';
                    if(!certs.length){ h+='<div style="font-size:12px;color:#b08600;margin-top:4px;">&#9888; No certifications on file</div>'; }
                    else { certs.forEach(function(c){ h+='<div style="display:flex;align-items:center;gap:8px;margin-top:5px;"><span style="flex:1;font-size:13px;color:#33303a;">'+escapeHtml(c.type||'')+(c.number?' &middot; #'+escapeHtml(c.number):'')+'</span>'+certExpiryBadge(c.expires)+'</div>'; }); }
                    h+='</div>';
                });
                body.innerHTML=h;
            }).catch(function(){ var body=document.getElementById('allCertsBody'); if(body) body.innerHTML='<p style="color:#c0264b;text-align:center;">Could not load.</p>'; });
        });
    }
    function loadRosterMeta(){
        withPin(function(pin){
            supabaseClient.rpc('app_roster_meta',{p_username:currentUser.username,p_password:pin}).then(({data,error})=>{
                if(error){ if(error.code==='42501') sessionPin=null; return; }
                if(data) rosterState.meta = data;
            });
        });
    }
    function loadRoster(){
        const box=document.getElementById('rosterList');
        box.innerHTML='<p style="text-align:center;padding:30px;color:#6b7686;">Loading&hellip;</p>';
        withPin(function(pin){
            var hoursEnd=new Date(), hoursStart=new Date(); hoursStart.setDate(hoursStart.getDate()-6);
            var hoursEndStr=schedFmt(hoursEnd), hoursStartStr=schedFmt(hoursStart);
            Promise.all([
                supabaseClient.rpc('app_roster_list',{p_username:currentUser.username,p_password:pin}),
                supabaseClient.rpc('app_pip_active',{p_username:currentUser.username,p_password:pin}),
                supabaseClient.rpc('app_upcoming_celebrations',{p_username:currentUser.username,p_password:pin}),
                supabaseClient.rpc('app_emp_phones',{p_username:currentUser.username,p_password:pin}),
                supabaseClient.rpc('app_employee_hours_for_roster',{p_username:currentUser.username,p_password:pin,p_start_date:hoursStartStr,p_end_date:hoursEndStr})
            ]).then(function(res){
                // HIGH-2 FIX (2026-07-18): previously only res[0] (app_roster_list) was
                // error-checked -- a failed PIP/celebrations/phones/hours call silently
                // rendered as "no PIP" / blank phone / no celebration / blank hours,
                // indistinguishable from a legitimately-empty result. A failed phones fetch
                // also fed straight into openRosterModal's phone field, which Blocker #1
                // could then silently save as blank. Every result is now checked; any
                // failure shows a visible warning instead of a silent default.
                const error=res[0].error;
                if(error){ if(error.code==='42501') sessionPin=null; box.innerHTML='<p style="color:red;text-align:center;padding:20px;">Error: '+error.message+'</p>'; return; }
                rosterState.list=res[0].data||[];
                var _failLabels=['','PIP status','Upcoming celebrations','Phone numbers','Hours (7d)'];
                var _failed=[];
                res.forEach(function(r,i){ if(i>0 && r && r.error){ _failed.push(_failLabels[i]); if(r.error.code==='42501') sessionPin=null; } });
                rosterState.phones=(res[3]&&!res[3].error&&res[3].data)?res[3].data:{};
                rosterState.pips={};
                var pips=(res[1]&&!res[1].error&&res[1].data)?res[1].data:[];
                pips.forEach(function(p){ rosterState.pips[p.employee_id]=p; });
                celebRosterMap={};
                var celeb=(res[2]&&!res[2].error&&res[2].data)?res[2].data:[];
                if(celeb && celeb[0] && celeb[0].items) celeb=celeb[0].items;
                (celeb||[]).forEach(function(c){ var eid=c.employee_id||c.id; if(eid!=null && !celebRosterMap[eid]) celebRosterMap[eid]=(c.kind||'').toLowerCase(); });
                rosterState.hours={};
                var hrs=(res[4]&&!res[4].error&&res[4].data)?res[4].data:[];
                (hrs||[]).forEach(function(h){ rosterState.hours[h.employee_id]=h.hours; });
                renderRosterTable();
                if(_failed.length){ box.insertAdjacentHTML('afterbegin','<p style="background:#fff4e0;color:#9a5b00;border:1px solid #f3d9a6;border-radius:9px;padding:9px 12px;font-size:12.5px;font-weight:700;margin-bottom:10px;">&#9888; Could not load: '+_failed.join(', ')+'. Showing the rest of the roster below — reopen this screen to retry.</p>'); }
            }).catch(()=>{ box.innerHTML='<p style="color:red;text-align:center;">Connection error.</p>'; });
        }, function(){ box.innerHTML='<p style="text-align:center;padding:20px;color:#6b7686;">PIN required.</p>'; });
    }
    var celebRosterMap={};
    function openEmployeeProfile(empId, name){
        document.querySelectorAll('.app-view').forEach(function(v){v.style.display='none';});
        var main=document.getElementById('main-menu'); if(main) main.style.display='none';
        var view=document.getElementById('employeeProfileView'); if(view) view.style.display='block';
        var box=document.getElementById('empProfileBody');
        box.innerHTML='<p style="text-align:center;color:#6b7686;padding:40px;">Loading '+escapeHtml(name||'')+'...</p>';
        // PIN-REPROMPT FIX (2026-07-18): was calling the RPC directly with sessionPin --
        // once sessionPin got cleared elsewhere (any RPC anywhere returning 42501 nulls it),
        // this fired with p_password:null, got a forbidden-style error back, and showed a
        // dead-end "no access" message with no way to re-enter a PIN. withPin() is the app's
        // normal recovery path (see loadRoster() above) -- it re-prompts when needed instead.
        withPin(function(pin){
            supabaseClient.rpc('app_emp_profile',{p_username:currentUser.username,p_password:pin,p_employee_id:empId}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; box.innerHTML='<p style="color:#c0264b;padding:20px;">'+(String(r.error.message||'').indexOf('forbidden')>=0?'You do not have access to this profile.':('Could not load profile: '+escapeHtml(r.error.message)))+'</p>'; return; }
                renderEmployeeProfile(r.data);
            }).catch(function(){ box.innerHTML='<p style="color:#c0264b;padding:20px;">Connection error.</p>'; });
        }, function(){ box.innerHTML='<p style="text-align:center;color:#6b7686;padding:40px;">PIN required to view this profile.</p>'; });
    }
    function renderEmployeeProfile(p){
        var box=document.getElementById('empProfileBody'); if(!p){ box.innerHTML='<p style="padding:20px;">Profile not found.</p>'; return; }
        _empProfile=p; window._empTab='overview';
        empInjectTabStyles();
        var initials=String(p.name||'?').split(' ').map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase();
        var st=p.status||'Active'; var stCol=(st==='Active')?'#1f7a3d':'#9aa7b4';
        var header='<div style="background:#fff;border:1px solid #e6ebf2;border-radius:16px;padding:16px;display:flex;align-items:center;gap:14px;"><div style="width:54px;height:54px;border-radius:50%;background:#fde7df;display:flex;align-items:center;justify-content:center;font-weight:800;color:#D85A30;font-size:18px;flex:0 0 auto;">'+initials+'</div><div style="flex:1;min-width:0;"><div style="font-size:18px;font-weight:800;color:#1f2a44;">'+escapeHtml(p.name||'')+'</div><div style="font-size:13px;color:#6b7686;">'+escapeHtml(p.role||'')+(p.store?(' &middot; '+escapeHtml(p.store)):'')+'</div></div><span style="background:'+((st==='Active')?'#e7f6ec':'#eef1f5')+';color:'+stCol+';font-size:12px;font-weight:700;padding:4px 11px;border-radius:11px;flex:0 0 auto;">'+escapeHtml(st)+'</span></div>';
        var tabs=empTabsFor(p);
        var tabBar=tabs.map(function(t){return '<button class="emp-tab" data-tab="'+t.k+'">'+escapeHtml(t.label)+'</button>';}).join('');
        box.innerHTML=header+'<div class="emp-tabbar">'+tabBar+'</div><div id="empTabBody"></div>';
        Array.prototype.forEach.call(box.querySelectorAll('.emp-tab'), function(b){ b.onclick=function(){ empShowTab(b.getAttribute('data-tab')); }; });
        empShowTab('overview');
    }
    var _empProfile=null;
    function empManageHtml(p){
        if(!(typeof isManagerRole==='function' && isManagerRole())) return '';
        // ROLE-STRING FIX (2026-07-17): was 'Shift Leader' -- every permission gate in the app
        // checks the string 'Shift Lead' (no "er"), so promoting someone through this exact
        // dropdown silently stripped their Disciplinary/Attendance/Pre-Shift/Pop-In/Inventory/
        // Crew Trainer/Celebrations access. 'Shift Lead' is now canonical -- picked because the
        // large majority of existing gates already use it. Anyone already stored with the old
        // 'Shift Leader' spelling needs a one-time correction; see specs/AUDIT_MASTER_SUMMARY.md.
        var ladder=['Crew Member','Crew Trainer','Shift Lead','Assistant Manager','Store Manager','Admin Manager'];
        var cur=p.role||''; if(cur && ladder.indexOf(cur)<0) ladder.unshift(cur);
        var roleOpts=ladder.map(function(r){return '<option'+(r===cur?' selected':'')+'>'+escapeHtml(r)+'</option>';}).join('');
        var h='<div style="margin-top:16px;border-top:1px solid #eef0f5;padding-top:14px;">';
        h+='<div style="font-size:11px;font-weight:700;color:#5b6675;text-transform:uppercase;margin-bottom:8px;">Manage</div>';
        h+='<button id="empPromoteBtn" onclick="toggleEmpPromote()" style="background:#fff;border:1px solid #D85A30;color:#D85A30;font-weight:700;font-size:13px;padding:9px 14px;border-radius:10px;cursor:pointer;">&#11014; Change role</button>';
        h+='<div id="empPromoteForm" style="display:none;margin-top:12px;background:#fbfcfe;border:1px solid #e6ebf2;border-radius:12px;padding:14px;">';
        h+='<div style="font-size:13px;color:#1f2a44;font-weight:700;margin-bottom:4px;">Role change &mdash; review &amp; confirm</div>';
        h+='<div style="font-size:12px;color:#6b7686;margin-bottom:10px;">Current role: <b>'+escapeHtml(cur||'&mdash;')+'</b>. Recorded with an effective date and reason in the employee history and the audit log.</div>';
        h+='<label style="font-size:12px;color:#6b7686;display:block;margin-bottom:3px;">New role</label>';
        h+='<select id="empPromoteRole" style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:14px;margin-bottom:10px;">'+roleOpts+'</select>';
        h+='<label style="font-size:12px;color:#6b7686;display:block;margin-bottom:3px;">Effective date</label>';
        h+='<input type="date" id="empPromoteDate" style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:14px;margin-bottom:10px;">';
        h+='<label style="font-size:12px;color:#6b7686;display:block;margin-bottom:3px;">Reason (required)</label>';
        h+='<textarea id="empPromoteReason" rows="2" placeholder="e.g., Completed sign-offs; approved by store manager" style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:14px;box-sizing:border-box;"></textarea>';
        h+='<div id="empPromoteMsg" style="display:none;font-size:13px;margin-top:8px;"></div>';
        h+='<div style="display:flex;gap:8px;margin-top:12px;">';
        h+='<button onclick="submitEmpPromote()" style="flex:1;background:linear-gradient(90deg,#ec3e7e,#7b2d8b);color:#fff;font-weight:800;border:none;padding:11px;border-radius:10px;cursor:pointer;font-size:14px;">Confirm role change</button>';
        h+='<button onclick="toggleEmpPromote(true)" style="background:#eef1f5;color:#5b6472;border:none;padding:11px 16px;border-radius:10px;cursor:pointer;font-size:14px;">Cancel</button>';
        h+='</div></div></div>';
        return h;
    }
    function loadEmpEvents(empId){
        var box=document.getElementById('empEventsBox'); if(!box) return;
        // PIN-REPROMPT FIX (2026-07-18): see openEmployeeProfile() above -- was using
        // sessionPin directly with no re-prompt path if it had been cleared.
        withPin(function(pin){
            supabaseClient.rpc('app_emp_events',{p_username:currentUser.username,p_password:pin,p_employee_id:empId}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; box.innerHTML=''; return; }
                if(!r.data||!r.data.length){ box.innerHTML=''; return; }
                var rows=r.data.map(function(e){
                    var when=e.effective_date?String(e.effective_date).slice(0,10):(e.recorded_at?String(e.recorded_at).slice(0,10):'');
                    var chg=(e.from_value||e.to_value)?((e.from_value?escapeHtml(String(e.from_value)):'&mdash;')+' &rarr; '+(e.to_value?escapeHtml(String(e.to_value)):'&mdash;')):'';
                    return '<div style="padding:7px 0;border-bottom:1px solid #eef0f5;font-size:13px;"><div style="display:flex;justify-content:space-between;"><span style="font-weight:600;color:#1f2a44;">'+escapeHtml(String(e.event_type||'Event'))+'</span><span style="color:#5b6675;">'+escapeHtml(when)+'</span></div>'+(chg?('<div style="color:#6b7686;">'+chg+'</div>'):'')+(e.reason?('<div style="color:#5b6675;font-size:12px;">'+escapeHtml(String(e.reason))+'</div>'):'')+'</div>';
                }).join('');
                box.innerHTML='<div style="margin-top:16px;border-top:1px solid #eef0f5;padding-top:14px;"><div style="font-size:11px;font-weight:700;color:#5b6675;text-transform:uppercase;margin-bottom:6px;">Employment history</div>'+rows+'</div>';
            }).catch(function(){ box.innerHTML=''; });
        }, function(){ box.innerHTML=''; });
    }
    function empPipHtml(p){
        if(!(typeof isDiscAdmin==='function' && isDiscAdmin())) return '';
        var pip=(typeof rosterState!=='undefined' && rosterState.pips) ? rosterState.pips[p.id] : null;
        var nm=(p.name||'').replace(/&/g,'').replace(/"/g,'');
        var h='<div style="margin-top:16px;border-top:1px solid #eef0f5;padding-top:14px;">';
        h+='<div style="font-size:11px;font-weight:700;color:#5b6675;text-transform:uppercase;margin-bottom:8px;">Corrective action &middot; restricted</div>';
        if(pip){
            h+='<div style="background:#fff4f6;border:1px solid #f3c9d6;border-radius:10px;padding:11px;font-size:13px;">';
            h+='<div style="font-weight:700;color:#b4264b;">On a Performance Improvement Plan</div>';
            h+='<div style="color:#6b7686;margin-top:3px;">'+escapeHtml(String(pip.start||''))+' &rarr; '+escapeHtml(String(pip['end']||''))+(pip.reason?('<br>'+escapeHtml(String(pip.reason))):'')+'</div>';
            h+='<button onclick="openDecision('+pip.pip_id+',&quot;'+escapeHtml(nm)+'&quot;)" style="margin-top:9px;background:#b4264b;color:#fff;border:none;font-weight:700;font-size:13px;padding:8px 13px;border-radius:9px;cursor:pointer;">Record decision</button>';
            h+='</div>';
        } else {
            h+='<div style="font-size:13px;color:#6b7686;margin-bottom:8px;">No active corrective action on file.</div>';
            h+='<button onclick="openPip('+p.id+',&quot;'+escapeHtml(nm)+'&quot;,&quot;'+escapeHtml(String(p.store||''))+'&quot;,&quot;'+escapeHtml(String(p.role||''))+'&quot;)" style="background:#fff;border:1px solid #b4264b;color:#b4264b;font-weight:700;font-size:13px;padding:8px 13px;border-radius:9px;cursor:pointer;">Start corrective action / PIP</button>';
        }
        h+='</div>';
        return h;
    }
    function toggleEmpPromote(forceHide){
        var f=document.getElementById('empPromoteForm'); if(!f) return;
        if(forceHide){ f.style.display='none'; return; }
        var show=f.style.display==='none'; f.style.display=show?'block':'none';
        if(show){ var d=document.getElementById('empPromoteDate'); if(d&&!d.value){ d.value=schedFmt(new Date()); } var m=document.getElementById('empPromoteMsg'); if(m) m.style.display='none'; }
    }
    function submitEmpPromote(){
        var p=_empProfile; if(!p) return;
        var role=(document.getElementById('empPromoteRole')||{}).value||'';
        var date=(document.getElementById('empPromoteDate')||{}).value||'';
        var reason=((document.getElementById('empPromoteReason')||{}).value||'').trim();
        var msg=document.getElementById('empPromoteMsg');
        function show(t,c){ if(msg){ msg.style.display='block'; msg.style.color=c||'#c0264b'; msg.innerHTML=t; } }
        if(!reason){ show('Please enter a reason &mdash; role changes require one.'); return; }
        if(!date){ show('Please choose an effective date.'); return; }
        if(role===(p.role||'')){ show('Choose a different role, or Cancel.'); return; }
        if(!confirm('Change '+(p.name||'this employee')+' from "'+(p.role||'')+'" to "'+role+'" effective '+date+'? This is recorded in their employment history and the audit log.')) return;
        show('Saving&hellip;','#6b7686');
        // PIN-REPROMPT FIX (2026-07-18): see openEmployeeProfile() above.
        withPin(function(pin){
            supabaseClient.rpc('app_emp_promote',{p_username:currentUser.username,p_password:pin,p_employee_id:p.id,p_new_role:role,p_effective_date:date,p_reason:reason}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; var m=String(r.error.message||''); show(m.indexOf('forbidden')>=0?'You do not have permission to change roles.':(m.indexOf('reason_required')>=0?'A reason is required.':('Could not save: '+escapeHtml(m)))); return; }
                show('&#10003; Role updated to '+escapeHtml(role)+'. Recorded in history + audit log.','#1f7a3d');
                if(typeof loadRoster==='function'){ try{ loadRoster(); }catch(e){} }
                setTimeout(function(){ openEmployeeProfile(p.id, p.name); }, 1000);
            }).catch(function(){ show('Connection error. Please try again.'); });
        }, function(){ show('PIN required to save this change.'); });
    }

    // ===== Development Passport (Phase 2) — skills · 5 levels · hours · sign-offs =====
    var PASSPORT_LEVELS=[
        {k:'Learning',c:'#9aa7b4',d:'Getting started — observing and learning the station.'},
        {k:'Developing',c:'#3f86d6',d:'Practicing with guidance; not yet cleared to run solo.'},
        {k:'Qualified',c:'#1f7a3d',d:'Cleared to run the station independently.'},
        {k:'Ace',c:'#D85A30',d:'Fast, consistent and reliable under pressure.'},
        {k:'Coach',c:'#7b2d8b',d:'Mastery — can train and sign off others.'}
    ];
    function passportRank(l){ return ({Learning:1,Developing:2,Qualified:3,Ace:4,Coach:5})[l]||1; }
    function passportColor(l){ for(var i=0;i<PASSPORT_LEVELS.length;i++){ if(PASSPORT_LEVELS[i].k===l) return PASSPORT_LEVELS[i].c; } return '#9aa7b4'; }
    function passportMeter(level){
        var r=passportRank(level), c=passportColor(level), h='<div style="display:flex;gap:3px;">';
        for(var i=1;i<=5;i++){ h+='<div style="flex:1;height:6px;border-radius:99px;background:'+(i<=r?c:'#edf0f4')+';"></div>'; }
        return h+'</div>';
    }
    function passStat(v,label){ return '<div style="flex:1;background:rgba(255,255,255,.16);border-radius:10px;padding:8px 6px;text-align:center;"><div style="font-size:18px;font-weight:800;">'+v+'</div><div style="font-size:10px;opacity:.92;line-height:1.2;margin-top:1px;">'+label+'</div></div>'; }
    function loadPassport(empId){
        var box=document.getElementById('empPassportBox'); if(!box) return;
        box.innerHTML='<div style="margin-top:16px;color:#5b6675;font-size:13px;">Loading development passport&hellip;</div>';
        // PIN-REPROMPT FIX (2026-07-18): see openEmployeeProfile() above.
        withPin(function(pin){
            Promise.all([
                supabaseClient.rpc('app_passport_get',{p_username:currentUser.username,p_password:pin,p_employee_id:empId}),
                supabaseClient.rpc('app_position_tally',{p_username:currentUser.username,p_password:pin,p_employee_id:empId}).then(function(r){return r;},function(){return {data:null};}),
                supabaseClient.rpc('app_passport_extra_get',{p_username:currentUser.username,p_password:pin,p_employee_id:empId}).then(function(r){return r;},function(){return {data:null};})
            ]).then(function(res){
                var pr=res[0]; if(pr.error){ if(pr.error.code==='42501') sessionPin=null; box.innerHTML=''; return; }
                var tally=(res[1]&&res[1].data)||{};
                var extra=(res[2]&&res[2].data)||{};
                renderPassport(empId, pr.data||{}, tally, extra);
            }).catch(function(){ box.innerHTML=''; });
        }, function(){ box.innerHTML='<div style="margin-top:16px;color:#5b6675;font-size:13px;">PIN required to load the development passport.</div>'; });
    }
    function passportBadges(positions, certs){
        var b=[];
        positions.filter(function(p){return p.level==='Coach';}).forEach(function(p){ b.push({ic:'&#127891;',t:'Coach · '+(p.name||''),c:'#7b2d8b',bg:'#f3e9f7'}); });
        var aces=positions.filter(function(p){return p.level==='Ace';});
        if(aces.length) b.push({ic:'&#11088;',t:aces.length+' Ace'+(aces.length>1?' stations':''),c:'#9a6b00',bg:'#fdf0dd'});
        var qplus=positions.filter(function(p){return passportRank(p.level)>=3;});
        if(positions.length && qplus.length===positions.length) b.push({ic:'&#127942;',t:'All-Rounder',c:'#1f7a3d',bg:'#e7f6ec'});
        else if(qplus.length>=3) b.push({ic:'&#128081;',t:qplus.length+' stations qualified',c:'#1f7a3d',bg:'#e7f6ec'});
        (certs||[]).forEach(function(c){ var exp=c.expires?new Date(String(c.expires)):null; if(!exp||exp>=new Date()) b.push({ic:'&#128203;',t:(c.type||'Certified'),c:'#185FA5',bg:'#e9f1fb'}); });
        return b;
    }
    function renderPassport(empId,d,tally,extra){
        extra=extra||{};
        var box=document.getElementById('empPassportBox'); if(!box) return;
        var positions=d.positions||[]; var byPos=(tally&&tally.days_by_position)||{}; var totalDays=(tally&&tally.total_days)||0;
        var canManage=!!d.can_manage; window._passportPositions=positions;
        var hours=extra.hours||{}; var goals=extra.goals||[]; var history=extra.history||[];
        var qualified=positions.filter(function(p){return passportRank(p.level)>=3;}).length;
        var certCount=(d.certs||[]).length;
        var totalHours=0; Object.keys(hours).forEach(function(k){ var hh=hours[k]||{}; totalHours+=(+hh.confirmed||0)+(+hh.unconfirmed||0); });
        var h='<div style="margin-top:18px;border:1px solid #ece6f5;border-radius:16px;overflow:hidden;">';
        h+='<div style="background:linear-gradient(120deg,#7b2d8b,#ec3e7e 55%,#f0772f);padding:15px 16px 14px;color:#fff;">';
        h+='<div style="display:flex;align-items:center;justify-content:space-between;"><div><div style="font-size:11px;font-weight:800;letter-spacing:.09em;opacity:.85;">DEVELOPMENT PASSPORT</div><div style="font-size:17px;font-weight:800;margin-top:1px;">Skills &amp; Growth</div></div><div style="font-size:25px;">&#128706;</div></div>';
        h+='<div style="display:flex;gap:8px;margin-top:12px;">'+passStat(qualified,'Stations qualified+')+passStat(certCount,'Certifications')+passStat(totalHours>0?(Math.round(totalHours)+'h'):totalDays,totalHours>0?'Hours logged':'Days on floor')+'</div>';
        h+='</div>';
        var badges=passportBadges(positions, d.certs||[]);
        if(badges.length){ h+='<div style="padding:11px 13px;border-bottom:1px solid #f0ecf7;display:flex;flex-wrap:wrap;gap:6px;">'; badges.forEach(function(bd){ h+='<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;color:'+bd.c+';background:'+bd.bg+';padding:4px 9px;border-radius:99px;">'+bd.ic+' '+escapeHtml(bd.t)+'</span>'; }); h+='</div>'; }
        h+='<div style="padding:11px 13px;background:#faf8fd;border-bottom:1px solid #f0ecf7;display:flex;flex-wrap:wrap;gap:6px;">';
        PASSPORT_LEVELS.forEach(function(L){ h+='<span title="'+escapeHtml(L.d)+'" style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#5b5566;background:#fff;border:1px solid #ece6f5;padding:3px 8px;border-radius:99px;"><span style="width:9px;height:9px;border-radius:50%;background:'+L.c+';"></span>'+L.k+'</span>'; });
        h+='</div>';
        if(!positions.length){ h+='<div style="padding:16px;color:#5b6675;font-size:13px;">No stations configured yet.</div>'; }
        else {
            h+='<div style="padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
            positions.forEach(function(p){
                var days=byPos[p.name]||0; var c=passportColor(p.level); var nmJs=(p.name||'').replace(/&/g,'').replace(/"/g,'');
                var hr=hours[String(p.position_id)]||{}; var logged=(+hr.confirmed||0)+(+hr.unconfirmed||0); var conf=(+hr.confirmed||0);
                var hrsHtml; if(logged>0){ hrsHtml=Math.round(logged)+'h'+(conf>=logged?' &#10003;':(conf>0?' ('+Math.round(conf)+'h conf)':' unconf')); } else if(days>0){ hrsHtml='~'+(days*5)+'h est'; } else { hrsHtml='&mdash;'; }
                h+='<div style="border:1px solid #eef0f5;border-radius:13px;padding:12px;background:#fff;">';
                h+='<div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;"><span style="width:10px;height:10px;border-radius:50%;flex:0 0 auto;background:'+(p.color||'#bbb')+';"></span><span style="font-weight:700;font-size:13px;color:#1f2a44;flex:1;line-height:1.2;">'+escapeHtml(p.name||'')+'</span>'+(p.cleared?'<span style="font-size:9.5px;font-weight:800;color:#1f7a3d;background:#e7f6ec;padding:2px 6px;border-radius:6px;letter-spacing:.04em;">CLEARED</span>':'')+'</div>';
                h+=passportMeter(p.level);
                h+='<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px;"><span style="font-size:13px;font-weight:800;color:'+c+';">'+escapeHtml(p.level)+'</span><span style="font-size:11.5px;color:#5b6675;">'+hrsHtml+'</span></div>';
                h+='<div style="font-size:10px;color:#c2c9d4;margin-top:2px;">'+days+' day'+(days===1?'':'s')+' on floor</div>';
                if(p.approved_by) h+='<div style="font-size:10px;color:#aab2bd;margin-top:4px;">&#10003; '+escapeHtml(String(p.approved_by))+'</div>';
                if(canManage){ h+='<div style="display:flex;gap:6px;margin-top:9px;"><button onclick="openPassportAdjust('+empId+','+p.position_id+',&quot;'+escapeHtml(nmJs)+'&quot;,&quot;'+p.level+'&quot;)" style="flex:1;background:#f7f4fc;color:#7b2d8b;border:none;border-radius:8px;padding:7px;font-size:11.5px;font-weight:700;cursor:pointer;">Level</button><button onclick="openPassportHours('+empId+','+p.position_id+',&quot;'+escapeHtml(nmJs)+'&quot;)" style="flex:1;background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:7px;font-size:11.5px;font-weight:700;cursor:pointer;">Hours</button></div>'; }
                h+='</div>';
            });
            h+='</div>';
        }
        h+='<div style="padding:0 13px 10px;"><div style="font-size:11px;color:#5b6675;background:#faf8fd;border:1px dashed #e3dcf0;border-radius:9px;padding:9px;">&#9201; Hours show as <b>logged</b> where recorded (estimated &rarr; confirmed), and a <b>~estimate from days</b> otherwise. They fill in automatically once the time clock + published schedule are in everyday use.</div></div>';
        h+='<div style="padding:2px 13px 12px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;"><div style="font-size:11px;font-weight:800;color:#5b6675;text-transform:uppercase;letter-spacing:.05em;">Growth goals &amp; cross-training</div>'+(canManage?'<button onclick="openPassportGoal('+empId+')" style="background:#fff;border:1px solid #7b2d8b;color:#7b2d8b;font-size:11px;font-weight:700;padding:4px 10px;border-radius:8px;cursor:pointer;">+ Add</button>':'')+'</div>';
        if(goals.length){ goals.forEach(function(g){ var label=g.kind==='cross_train'?('Wants to train on <b>'+escapeHtml(g.position||'a station')+'</b>'):escapeHtml(g.text||'Goal'); h+='<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f0eef4;font-size:13px;"><span style="font-size:14px;">'+(g.kind==='cross_train'?'&#127891;':'&#127919;')+'</span><span style="flex:1;color:#33303a;">'+label+(g.by?(' <span style="color:#aab2bd;font-size:11px;">· '+escapeHtml(g.by)+'</span>'):'')+'</span>'+(canManage?'<button onclick="passportGoalDone('+g.id+','+empId+')" style="background:#eef7f0;color:#1f7a3d;border:none;font-size:11px;font-weight:700;padding:4px 9px;border-radius:7px;cursor:pointer;">Done</button>':'')+'</div>'; }); }
        else { h+='<div style="font-size:12.5px;color:#5b6675;">No goals yet. '+(canManage?'Add a growth goal or a station someone wants to learn.':'Ask your manager to add one.')+'</div>'; }
        h+='</div>';
        if(history.length){ h+='<div style="padding:2px 13px 14px;"><div style="font-size:11px;font-weight:800;color:#5b6675;text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px;">Level history</div>'; history.slice(0,8).forEach(function(e){ var when=e.at?String(e.at).slice(0,10):''; h+='<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0eef4;font-size:12.5px;"><span style="color:#33303a;"><b>'+escapeHtml(e.position||'Station')+'</b> &rarr; '+escapeHtml(e.level||'')+(e['from']?(' <span style="color:#aab2bd;">(from '+escapeHtml(e['from'])+')</span>'):'')+'</span><span style="color:#5b6675;">'+escapeHtml(when)+'</span></div>'; }); h+='</div>'; }
        h+='</div>';
        box.innerHTML=h;
    }
    function openPassportGoal(empId){
        var ex=document.getElementById('passportGoalModal'); if(ex&&ex.parentNode) ex.parentNode.removeChild(ex);
        var posOpts=(window._passportPositions||[]).map(function(p){return '<option value="'+p.position_id+'">'+escapeHtml(p.name||'')+'</option>';}).join('');
        var m=document.createElement('div'); m.id='passportGoalModal'; m.style.cssText='position:fixed;inset:0;background:rgba(20,16,30,.55);display:flex;align-items:center;justify-content:center;z-index:99999;padding:18px;';
        m.innerHTML='<div style="background:#fff;border-radius:16px;max-width:380px;width:100%;padding:18px;"><div style="font-size:16px;font-weight:800;color:#1f2a44;">Add a goal or interest</div><div style="font-size:12px;color:#6b7686;margin:4px 0 12px;">A growth goal, or a station this person wants to learn.</div><label style="font-size:12px;color:#6b7686;display:block;margin-bottom:3px;">Type</label><select id="pgKind" onchange="pgKindChange()" style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:14px;margin-bottom:10px;"><option value="goal">Growth goal</option><option value="cross_train">Cross-training interest</option></select><div id="pgGoalWrap"><label style="font-size:12px;color:#6b7686;display:block;margin-bottom:3px;">Goal</label><textarea id="pgText" rows="2" placeholder="e.g., Ready for Shift Leader by fall" style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:14px;box-sizing:border-box;"></textarea></div><div id="pgPosWrap" style="display:none;"><label style="font-size:12px;color:#6b7686;display:block;margin-bottom:3px;">Station of interest</label><select id="pgPos" style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:14px;">'+posOpts+'</select></div><div id="pgMsg" style="display:none;font-size:13px;margin-top:8px;"></div><div style="display:flex;gap:8px;margin-top:14px;"><button onclick="submitPassportGoal('+empId+')" style="flex:1;background:linear-gradient(90deg,#ec3e7e,#7b2d8b);color:#fff;font-weight:800;border:none;padding:11px;border-radius:10px;cursor:pointer;font-size:14px;">Save</button><button onclick="closePassportModal(\'passportGoalModal\')" style="background:#eef1f5;color:#5b6472;border:none;padding:11px 16px;border-radius:10px;cursor:pointer;font-size:14px;">Cancel</button></div></div>';
        document.body.appendChild(m);
    }
    function pgKindChange(){ var k=(document.getElementById('pgKind')||{}).value; var g=document.getElementById('pgGoalWrap'), p=document.getElementById('pgPosWrap'); if(g&&p){ g.style.display=k==='goal'?'block':'none'; p.style.display=k==='cross_train'?'block':'none'; } }
    function closePassportModal(id){ var e=document.getElementById(id); if(e&&e.parentNode) e.parentNode.removeChild(e); }
    function submitPassportGoal(empId){
        var kind=(document.getElementById('pgKind')||{}).value||'goal'; var text=((document.getElementById('pgText')||{}).value||'').trim(); var pos=(document.getElementById('pgPos')||{}).value||null;
        var msg=document.getElementById('pgMsg'); function show(t,c){ if(msg){msg.style.display='block';msg.style.color=c||'#c0264b';msg.innerHTML=t;} }
        if(kind==='goal' && !text){ show('Enter the goal.'); return; } if(kind==='cross_train' && !pos){ show('Pick a station.'); return; }
        show('Saving&hellip;','#6b7686');
        // PIN-REPROMPT FIX (2026-07-18): see openEmployeeProfile() above.
        withPin(function(pin){
            supabaseClient.rpc('app_dev_goal_add',{p_username:currentUser.username,p_password:pin,p_employee_id:empId,p_kind:kind,p_position_id:kind==='cross_train'?parseInt(pos,10):null,p_text:kind==='goal'?text:null}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; show(String(r.error.message||'').indexOf('forbidden')>=0?'You do not have permission.':'Could not save.'); return; }
                closePassportModal('passportGoalModal'); loadPassport(empId);
            }).catch(function(){ show('Connection error.'); });
        }, function(){ show('PIN required to save.'); });
    }
    // PIN-REPROMPT FIX (2026-07-18): see openEmployeeProfile() above.
    function passportGoalDone(goalId,empId){ withPin(function(pin){ supabaseClient.rpc('app_dev_goal_done',{p_username:currentUser.username,p_password:pin,p_goal_id:goalId}).then(function(r){ if(!r.error) loadPassport(empId); else if(r.error.code==='42501') sessionPin=null; }).catch(function(){}); }); }
    function openPassportHours(empId,posId,posName){
        var ex=document.getElementById('passportHoursModal'); if(ex&&ex.parentNode) ex.parentNode.removeChild(ex);
        var posOpts=(window._passportPositions||[]).map(function(p){return '<option value="'+p.position_id+'">'+escapeHtml(p.name||'')+'</option>';}).join('');
        var today=schedFmt(new Date());
        var m=document.createElement('div'); m.id='passportHoursModal'; m.style.cssText='position:fixed;inset:0;background:rgba(20,16,30,.55);display:flex;align-items:center;justify-content:center;z-index:99999;padding:18px;';
        m.innerHTML='<div style="background:#fff;border-radius:16px;max-width:380px;width:100%;padding:18px;"><div style="font-size:16px;font-weight:800;color:#1f2a44;">Log hours &mdash; '+escapeHtml(posName)+'</div><div style="font-size:12px;color:#6b7686;margin:4px 0 12px;">Record floor time on this station. Set <b>scheduled</b> if they were planned elsewhere (planned vs actual). Auto-fills from the clock + schedule once those are live.</div><label style="font-size:12px;color:#6b7686;display:block;margin-bottom:3px;">Date</label><input type="date" id="phDate" value="'+today+'" style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:14px;margin-bottom:10px;"><label style="font-size:12px;color:#6b7686;display:block;margin-bottom:3px;">Hours</label><input type="number" id="phHours" min="0" step="0.25" value="6" style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:14px;margin-bottom:10px;"><label style="font-size:12px;color:#6b7686;display:block;margin-bottom:3px;">Scheduled (planned) station</label><select id="phPlanned" style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:14px;margin-bottom:10px;"><option value="">&mdash; same / not set &mdash;</option>'+posOpts+'</select><label style="font-size:12px;color:#6b7686;display:block;margin-bottom:3px;">Status</label><select id="phStatus" style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:14px;margin-bottom:10px;"><option value="confirmed">Confirmed</option><option value="unconfirmed">Unconfirmed</option><option value="estimated">Estimated</option></select><div id="phMsg" style="display:none;font-size:13px;margin-top:4px;"></div><div style="display:flex;gap:8px;margin-top:12px;"><button onclick="submitPassportHours('+empId+','+posId+')" style="flex:1;background:linear-gradient(90deg,#ec3e7e,#7b2d8b);color:#fff;font-weight:800;border:none;padding:11px;border-radius:10px;cursor:pointer;font-size:14px;">Save hours</button><button onclick="closePassportModal(\'passportHoursModal\')" style="background:#eef1f5;color:#5b6472;border:none;padding:11px 16px;border-radius:10px;cursor:pointer;font-size:14px;">Cancel</button></div></div>';
        document.body.appendChild(m);
    }
    function submitPassportHours(empId,posId){
        var date=(document.getElementById('phDate')||{}).value||null; var hrs=parseFloat((document.getElementById('phHours')||{}).value||'0')||0; var planned=(document.getElementById('phPlanned')||{}).value||null; var status=(document.getElementById('phStatus')||{}).value||'confirmed';
        var msg=document.getElementById('phMsg'); function show(t,c){ if(msg){msg.style.display='block';msg.style.color=c||'#c0264b';msg.innerHTML=t;} }
        show('Saving&hellip;','#6b7686');
        // PIN-REPROMPT FIX (2026-07-18): see openEmployeeProfile() above.
        withPin(function(pin){
            supabaseClient.rpc('app_passport_hours_log',{p_username:currentUser.username,p_password:pin,p_employee_id:empId,p_position_id:posId,p_work_date:date,p_planned_position_id:planned?parseInt(planned,10):null,p_hours:hrs,p_status:status,p_note:null}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; show(String(r.error.message||'').indexOf('forbidden')>=0?'You do not have permission.':'Could not save.'); return; }
                closePassportModal('passportHoursModal'); loadPassport(empId);
            }).catch(function(){ show('Connection error.'); });
        }, function(){ show('PIN required to save.'); });
    }

    function openPassportAdjust(empId,posId,posName,curLevel){
        var ex=document.getElementById('passportAdjustModal'); if(ex&&ex.parentNode) ex.parentNode.removeChild(ex);
        var lvls=PASSPORT_LEVELS.map(function(L){ return '<option value="'+L.k+'"'+(L.k===curLevel?' selected':'')+'>'+L.k+'</option>'; }).join('');
        var m=document.createElement('div'); m.id='passportAdjustModal';
        m.style.cssText='position:fixed;inset:0;background:rgba(20,16,30,.55);display:flex;align-items:center;justify-content:center;z-index:99999;padding:18px;';
        m.innerHTML='<div style="background:#fff;border-radius:16px;max-width:380px;width:100%;padding:18px;box-shadow:0 18px 50px rgba(0,0,0,.3);">'+
            '<div style="font-size:16px;font-weight:800;color:#1f2a44;">Adjust level &mdash; '+escapeHtml(posName)+'</div>'+
            '<div style="font-size:12px;color:#6b7686;margin-top:4px;margin-bottom:12px;line-height:1.45;">Qualified, Ace and Coach require a sign-off note. Ace &amp; Coach are manager-approved; a Shift Lead can approve Qualified only with the qualification permission and Coach standing on this station. Recorded in the audit log.</div>'+
            '<label style="font-size:12px;color:#6b7686;display:block;margin-bottom:3px;">Level</label>'+
            '<select id="passportAdjLevel" style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:14px;margin-bottom:10px;">'+lvls+'</select>'+
            '<label style="font-size:12px;color:#6b7686;display:block;margin-bottom:3px;">Sign-off note <span style="color:#5b6675;">(required for Qualified+)</span></label>'+
            '<textarea id="passportAdjNote" rows="2" placeholder="e.g., Observed running the station solo through a rush — accurate and clean." style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:14px;box-sizing:border-box;"></textarea>'+
            '<div id="passportAdjMsg" style="display:none;font-size:13px;margin-top:8px;"></div>'+
            '<div style="display:flex;gap:8px;margin-top:14px;">'+
            '<button onclick="submitPassportAdjust('+empId+','+posId+')" style="flex:1;background:linear-gradient(90deg,#ec3e7e,#7b2d8b);color:#fff;font-weight:800;border:none;padding:11px;border-radius:10px;cursor:pointer;font-size:14px;">Save level</button>'+
            '<button onclick="closePassportAdjust()" style="background:#eef1f5;color:#5b6472;border:none;padding:11px 16px;border-radius:10px;cursor:pointer;font-size:14px;">Cancel</button>'+
            '</div></div>';
        document.body.appendChild(m);
    }
    function closePassportAdjust(){ var e=document.getElementById('passportAdjustModal'); if(e&&e.parentNode) e.parentNode.removeChild(e); }
    function submitPassportAdjust(empId,posId){
        var level=(document.getElementById('passportAdjLevel')||{}).value||'';
        var note=((document.getElementById('passportAdjNote')||{}).value||'').trim();
        var msg=document.getElementById('passportAdjMsg');
        function show(t,c){ if(msg){ msg.style.display='block'; msg.style.color=c||'#c0264b'; msg.innerHTML=t; } }
        if(['Qualified','Ace','Coach'].indexOf(level)>=0 && !note){ show('A sign-off note is required for Qualified, Ace or Coach.'); return; }
        show('Saving&hellip;','#6b7686');
        // PIN-REPROMPT FIX (2026-07-18): see openEmployeeProfile() above.
        withPin(function(pin){
            supabaseClient.rpc('app_passport_set_level',{p_username:currentUser.username,p_password:pin,p_employee_id:empId,p_position_id:posId,p_level:level,p_note:note}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; var mt=String(r.error.message||'');
                    show(mt.indexOf('forbidden')>=0?'You do not have permission to set that level.':(mt.indexOf('note_required')>=0?'A sign-off note is required.':'Could not save: '+escapeHtml(mt))); return; }
                show('&#10003; Saved.','#1f7a3d');
                setTimeout(function(){ closePassportAdjust(); loadPassport(empId); },650);
            }).catch(function(){ show('Connection error — please try again.'); });
        }, function(){ show('PIN required to save.'); });
    }


    function empInjectTabStyles(){
        if(document.getElementById('empTabStyles')) return;
        var s=document.createElement('style'); s.id='empTabStyles';
        s.textContent='.emp-tabbar{display:flex;gap:2px;overflow-x:auto;border-bottom:2px solid #eef0f5;margin-top:14px;}.emp-tab{flex:0 0 auto;background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;padding:9px 12px;font-size:13px;font-weight:600;color:#8a93a3;cursor:pointer;white-space:nowrap;}.emp-tab.active{color:#7b2d8b;border-bottom-color:#7b2d8b;}.emp-card{background:#fff;border:1px solid #e6ebf2;border-radius:14px;padding:16px;margin-top:14px;}.emp-sec{font-size:11px;font-weight:700;color:#5b6675;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;}.emp-row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #eef0f5;font-size:13px;}.emp-row span:first-child{color:#6b7686;}.emp-empty{color:#8a93a3;font-size:13px;line-height:1.55;}.emp-note{margin-top:10px;font-size:11px;color:#5b6675;line-height:1.5;}';
        document.head.appendChild(s);
    }
    function empFirst(p){ return escapeHtml(String(((p&&p.name)||'this team member')).split(' ')[0]); }
    function empTabsFor(p){
        var t=[{k:'overview',label:'Overview'},{k:'passport',label:'Passport'},{k:'training',label:'Training'}];
        if(typeof isManagerRole==='function' && isManagerRole()){ t.push({k:'documents',label:'Documents'}); t.push({k:'notes',label:'Manager Notes'}); }
        if(typeof isDiscAdmin==='function' && isDiscAdmin()){ t.push({k:'corrective',label:'Corrective Action'}); t.push({k:'confidential',label:'Confidential'}); }
        return t;
    }
    function empShowTab(k){
        window._empTab=k;
        var pbox=document.getElementById('empProfileBody'); if(pbox){ Array.prototype.forEach.call(pbox.querySelectorAll('.emp-tab'), function(b){ b.classList.toggle('active', b.getAttribute('data-tab')===k); }); }
        var body=document.getElementById('empTabBody'); if(!body) return;
        var p=_empProfile||{};
        if(k==='overview'){ body.innerHTML=empOverviewHtml(p); loadEmpEvents(p.id); }
        else if(k==='passport'){ body.innerHTML='<div id="empPassportBox"></div>'; loadPassport(p.id); }
        else if(k==='training'){ body.innerHTML='<div class="emp-card"><div class="emp-sec">Training &amp; experience</div><div id="empTrainBox" class="emp-empty">Loading&hellip;</div></div>'; loadEmpTraining(p.id); }
        else if(k==='schedule'){ body.innerHTML='<div class="emp-card"><div class="emp-sec">Scheduling &amp; attendance</div><div class="emp-empty">No published schedule yet. Once weekly schedules are published and the time clock is in everyday use, this tab shows '+empFirst(p)+'&rsquo;s upcoming shifts, hours, and attendance.</div></div>'; }
        else if(k==='recognition'){ body.innerHTML='<div class="emp-card"><div class="emp-sec">Recognition</div><div class="emp-empty">Shout-outs, milestones, and anniversaries for '+empFirst(p)+' will surface here from the Recognition feed.</div></div>'; }
        else if(k==='documents'){ body.innerHTML='<div class="emp-card"><div class="emp-sec">Employment documents</div><div class="emp-empty">This tab tracks document <b>status</b> (offer, I-9, handbook, food-handler card) as a checklist. Files are intentionally not stored here yet &mdash; they&rsquo;ll be served only through secure, backend-gated links once that path is approved.</div></div>'; }
        else if(k==='notes'){ body.innerHTML='<div id="empNotesBox" class="emp-card"><div class="emp-sec">Notes</div><div class="emp-empty">Loading&hellip;</div></div>'; loadEmpNotes(p.id); }
        else if(k==='corrective'){ body.innerHTML=empPipHtml(p)||'<div class="emp-card"><div class="emp-sec">Corrective action</div><div class="emp-empty">No corrective action on file.</div></div>'; }
        else if(k==='confidential'){ body.innerHTML='<div class="emp-card"><div class="emp-sec">Confidential records</div><div class="emp-empty">Medical, banking, background, and other sensitive records are gated behind the full permission + audit foundation. They are intentionally not accessible until that foundation is complete and every access is logged per category.</div></div>'; }
    }
    function empOverviewHtml(p){
        var certs=(p.certs||[]).map(function(c){ return '<div class="emp-row"><span>'+escapeHtml(c.type||'')+'</span><span>'+(c.expires?('exp '+escapeHtml(String(c.expires))):'&mdash;')+'</span></div>'; }).join('') || '<div class="emp-empty">None on file.</div>';
        var h='<div class="emp-card"><div class="emp-sec">Overview</div>';
        h+='<div class="emp-row"><span>Email</span><span>'+escapeHtml(p.email||'&mdash;')+'</span></div>';
        h+='<div class="emp-row"><span>Home store</span><span>'+escapeHtml(p.store||'&mdash;')+'</span></div>';
        h+='<div class="emp-row"><span>Status</span><span>'+escapeHtml(p.status||'Active')+'</span></div>';
        h+='<div class="emp-row" style="border:none;"><span>Cleared positions</span><span>'+(p.cleared_positions||0)+'</span></div>';
        h+='</div>';
        h+='<div class="emp-card"><div class="emp-sec">Certifications</div>'+certs+'</div>';
        h+=empManageHtml(p);
        h+='<div id="empEventsBox"></div>';
        h+='<p class="emp-note">Permission-aware profile &middot; this view was recorded in the audit log.</p>';
        return h;
    }
    function loadEmpTraining(empId){
        var box=document.getElementById('empTrainBox'); if(!box) return;
        // PIN-REPROMPT FIX (2026-07-18): was calling the RPC directly with sessionPin, and on
        // any error (including a null PIN) showed "Training history isn't available for this
        // view" -- a misleading permissions-sounding message for what was often really just a
        // cleared PIN with no way to re-enter it. See openEmployeeProfile() above.
        withPin(function(pin){
            supabaseClient.rpc('app_position_tally',{p_username:currentUser.username,p_password:pin,p_employee_id:empId}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; box.innerHTML='Training history isn&rsquo;t available for this view.'; return; }
                var d=r.data||{}; var by=d.days_by_position||{}; var total=d.total_days||0; var keys=Object.keys(by);
                box.className='';
                var rows=keys.length?keys.map(function(k){ return '<div class="emp-row"><span>'+escapeHtml(k)+'</span><span>'+by[k]+' day'+(by[k]==1?'':'s')+'</span></div>'; }).join(''):'<div class="emp-empty">No floor time recorded yet.</div>';
                box.innerHTML=rows+'<div class="emp-row" style="border:none;"><span><b>Total days on the floor</b></span><span><b>'+total+'</b></span></div><p class="emp-note">Lessons &amp; the training library live in the Training Portal. Hours-based experience turns on with the time clock + published schedule.</p>';
            }).catch(function(){ box.innerHTML='Could not load training.'; });
        }, function(){ box.innerHTML='PIN required to load training history.'; });
    }

    /* ===== Employee tiered notes (#98) ===== */
    function _noteTierMeta(t){ return ({support:['Support','#e7f6ec','#1b7a3d'],manager:['Manager','#eef3fb','#185FA5'],corrective:['Corrective','#fdeaea','#a01b3e']})[t]||['Note','#eef0f3','#5b6472']; }
    function loadEmpNotes(empId){ if(!sessionPin){ withPin(function(){ loadEmpNotes(empId); }); return; }
        var box=document.getElementById('empNotesBox'); if(!box) return; window._empNotesId=empId;
        supabaseClient.rpc('app_emp_notes_list',{p_username:currentUser.username,p_password:sessionPin,p_employee_id:empId}).then(function(r){
            if(r.error){ box.innerHTML='<div class="emp-sec">Notes</div><div class="emp-empty">'+(String(r.error.message||'').indexOf('forbidden')>=0?'You do not have access to notes for this person.':escapeHtml(r.error.message))+'</div>'; return; }
            renderEmpNotes(r.data||{},empId);
        }).catch(function(){ box.innerHTML='<div class="emp-sec">Notes</div><div class="emp-empty">Could not load notes.</div>'; });
    }
    function renderEmpNotes(d,empId){
        var box=document.getElementById('empNotesBox'); if(!box) return; var notes=d.notes||[];
        var h='<div class="emp-sec">Notes &middot; tiered</div>';
        if(d.can_add){
            var topts='<option value="support">Support / coaching</option><option value="manager">Manager note</option>'+(d.can_add_corrective?'<option value="corrective">Corrective (sensitive)</option>':'');
            h+='<div style="background:#fbfcfe;border:1px solid #e6ebf2;border-radius:10px;padding:11px;margin-bottom:10px;"><div style="margin-bottom:6px;"><select id="empNoteTier" style="padding:8px;border:1px solid #d6deea;border-radius:8px;font-size:12.5px;width:100%;">'+topts+'</select></div><textarea id="empNoteBody" rows="2" placeholder="Add a note&hellip;" style="width:100%;padding:8px;border:1px solid #d6deea;border-radius:8px;box-sizing:border-box;font-size:13px;"></textarea><button onclick="empNoteAdd('+empId+')" style="margin-top:8px;background:#185FA5;color:#fff;border:none;border-radius:8px;padding:8px 13px;font-weight:700;font-size:13px;cursor:pointer;">Add note</button></div>';
        }
        if(!notes.length){ h+='<div class="emp-empty">No notes on file'+(d.can_add?'. Use the box above to add one.':'.')+'</div>'; }
        notes.forEach(function(n){
            var m=_noteTierMeta(n.tier); var del=n.is_deleted;
            h+='<div style="border:1px solid #eef0f5;border-radius:10px;padding:10px;margin-bottom:8px;'+(del?'opacity:.65;':'')+'">'+
               '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><span style="background:'+m[1]+';color:'+m[2]+';font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:99px;">'+m[0]+'</span><span style="flex:1;font-size:11px;color:#5b6675;">'+escapeHtml(n.author||'')+' &middot; '+escapeHtml(String(n.created_at||'').slice(0,10))+(n.edited_at?' &middot; edited':'')+'</span></div>'+
               '<div style="font-size:13px;color:#26242b;white-space:pre-wrap;'+(del?'text-decoration:line-through;':'')+'">'+escapeHtml(n.body||'')+'</div>'+
               (del?'<div style="font-size:11px;color:#a01b3e;margin-top:3px;">Removed: '+escapeHtml(n.delete_reason||'')+'</div>':'')+
               '<div style="display:flex;gap:6px;margin-top:7px;flex-wrap:wrap;">'+
               ((n.can_edit&&!del)?'<button onclick="empNoteEdit('+n.id+','+empId+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:7px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Edit</button>':'')+
               ((n.can_delete&&!del)?'<button onclick="empNoteDelete('+n.id+','+empId+')" style="background:#fdeaea;color:#c0264b;border:none;border-radius:7px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Remove</button>':'')+
               (d.senior?'<button onclick="empNoteAudit('+n.id+')" style="background:#f3f4f8;color:#6b7686;border:none;border-radius:7px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">History</button>':'')+
               '</div></div>';
        });
        h+='<p class="emp-note">Support notes are visible to the team member; Manager and Corrective notes are management-only. Every edit and removal is recorded in the audit log.</p>';
        box.innerHTML=h;
    }
    function empNoteAdd(empId){ if(!sessionPin){ withPin(function(){ empNoteAdd(empId); }); return; }
        var tier=(document.getElementById('empNoteTier')||{}).value||'support'; var body=(document.getElementById('empNoteBody')||{}).value||'';
        if(!body.trim()){ alert('Type a note first.'); return; }
        supabaseClient.rpc('app_emp_note_add',{p_username:currentUser.username,p_password:sessionPin,p_employee_id:empId,p_tier:tier,p_body:body}).then(function(r){
            if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'You cannot add that note tier.':r.error.message); return; }
            loadEmpNotes(empId);
        }).catch(function(){ alert('Could not save.'); });
    }
    function empNoteEdit(noteId,empId){ if(!sessionPin){ withPin(function(){ empNoteEdit(noteId,empId); }); return; }
        var nb=prompt('Edit note:'); if(nb===null) return; if(!nb.trim()){ alert('Note cannot be empty.'); return; }
        supabaseClient.rpc('app_emp_note_edit',{p_username:currentUser.username,p_password:sessionPin,p_note_id:noteId,p_body:nb}).then(function(r){
            if(r.error){ alert(r.error.message); return; } loadEmpNotes(empId);
        }).catch(function(){ alert('Could not save.'); });
    }
    function empNoteDelete(noteId,empId){ if(!sessionPin){ withPin(function(){ empNoteDelete(noteId,empId); }); return; }
        var rs=prompt('Reason for removing this note (recorded in the audit log):'); if(rs===null) return; if(!rs.trim()){ alert('A reason is required.'); return; }
        supabaseClient.rpc('app_emp_note_delete',{p_username:currentUser.username,p_password:sessionPin,p_note_id:noteId,p_reason:rs}).then(function(r){
            if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Only senior managers can remove notes.':r.error.message); return; } loadEmpNotes(empId);
        }).catch(function(){ alert('Could not remove.'); });
    }
    function empNoteAudit(noteId){ if(!sessionPin){ withPin(function(){ empNoteAudit(noteId); }); return; }
        supabaseClient.rpc('app_emp_note_audit',{p_username:currentUser.username,p_password:sessionPin,p_note_id:noteId}).then(function(r){
            if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Senior managers only.':r.error.message); return; }
            var a=r.data||[]; var txt=a.length?a.map(function(x){return (String(x.at||'').slice(0,16).replace('T',' '))+'  '+x.action+'  '+(x.actor||'')+((x.detail&&x.detail.reason)?(' — '+x.detail.reason):'');}).join('\n'):'No history.';
            alert('Note history:\n\n'+txt);
        }).catch(function(){ alert('Could not load history.'); });
    }
    function renderRosterTable(){
        const box=document.getElementById('rosterList');
        const q=(document.getElementById('rosterSearch').value||'').toLowerCase();
        const showInactive=document.getElementById('rosterShowInactive').checked;
        const rows=rosterState.list.filter(e=> (showInactive||e.active) && (!q || (e.name||'').toLowerCase().indexOf(q)>-1) );
        const total=rosterState.list.length, linked=rosterState.list.filter(e=>e.is_linked).length;
        document.getElementById('rosterSummary').innerText=total+' employees · '+linked+' linked · '+(total-linked)+' unlinked';
        if(!rows.length){ box.innerHTML='<p style="text-align:center;padding:24px;color:#6b7686;">No employees match.</p>'; return; }
        let html='<table class="roster-tbl"><thead><tr><th>Name</th><th>Role</th><th>Home store</th><th>Hours (7d)</th><th>Login</th><th></th></tr></thead><tbody>';
        rows.forEach(e=>{
            const dot = e.position_color ? '<span class="role-dot" style="background:'+rosterEsc(e.position_color)+'"></span>' : '';
            const role = e.position_name ? dot+rosterEsc(e.position_name) : '<span style="color:#aab2bd">&mdash;</span>';
            const home = e.home_location ? rosterEsc(e.home_location) : '<span style="color:#aab2bd">&mdash;</span>';
            const login = e.is_linked
                ? '<span class="rtag linked">'+rosterEsc(e.linked_username)+'</span><button class="roster-act" onclick="rosterUnlink('+e.id+')">Unlink</button>'
                : '<span class="rtag unlinked">Not linked</span><button class="roster-act" onclick="openRosterLink('+e.id+')">Link</button>';
            const nmJs = (e.name||'').replace(/&/g,'').replace(/"/g,'');
            const pip = (rosterState.pips && rosterState.pips[e.id]) ? rosterState.pips[e.id] : null;
            const pipBadge = pip ? ' <span class="pip-badge" title="On PIP: '+pip.start+' to '+pip['end']+(pip.reason?(' — '+rosterEsc(pip.reason)):'')+'" onclick="openDecision('+pip.pip_id+',&quot;'+rosterEsc(nmJs)+'&quot;)">PIP</span>' : '';
            const pipAct = pip
                ? '<button class="roster-act" onclick="openDecision('+pip.pip_id+',&quot;'+rosterEsc(nmJs)+'&quot;)">Decision</button>'
                : '<button class="roster-act" onclick="openPip('+e.id+',&quot;'+rosterEsc(nmJs)+'&quot;,&quot;'+rosterEsc((e.home_location||'').replace(/&/g,'').replace(/"/g,''))+'&quot;,&quot;'+rosterEsc((e.position_name||'').replace(/&/g,'').replace(/"/g,''))+'&quot;)">+PIP</button>';
            const termBtn = e.active
                ? '<button class="roster-act" style="color:#c0264b;" onclick="rosterSetActive('+e.id+',false,&quot;'+rosterEsc(nmJs)+'&quot;)">Terminate</button>'
                : '<button class="roster-act" style="color:#1f7a3d;" onclick="rosterSetActive('+e.id+',true,&quot;'+rosterEsc(nmJs)+'&quot;)">Reactivate</button>';
            const celIc = celebRosterMap[e.id]==='birthday' ? ' <span title="Birthday coming up">🎂</span>' : (celebRosterMap[e.id] ? ' <span title="Work anniversary coming up">🎉</span>' : '');
            const hoursVal = (rosterState.hours && rosterState.hours[e.id]!=null) ? rosterState.hours[e.id] : null;
            const hours = hoursVal!=null ? (Number(hoursVal).toFixed(1)+' hrs') : '<span style="color:#aab2bd" title="No Axial punches matched yet">&mdash;</span>';
            html+='<tr class="'+(e.active?'':'roster-row-inactive')+'"><td>'+rosterEsc(e.name)+celIc+(e.active?'':' <small style="color:#c0264b">(inactive)</small>')+'</td><td>'+role+'</td><td>'+home+'</td><td>'+hours+'</td><td>'+login+'</td><td style="text-align:right;white-space:nowrap;">'+((rosterState.phones&&rosterState.phones[e.id])?('<a class="roster-act" style="color:#1f7a3d;" href="tel:'+String(rosterState.phones[e.id]).replace(/[^0-9+]/g,'')+'">&#128222; '+rosterEsc(String(rosterState.phones[e.id]))+'</a>'):'')+'<button class="roster-act" onclick="openEmployeeProfile('+e.id+',&quot;'+rosterEsc(nmJs)+'&quot;)">&#128100; Profile</button><button class="roster-act" onclick="openRosterModal('+e.id+')">Edit</button>'+'<button class="roster-act" onclick="openEmpCerts('+e.id+',&quot;'+rosterEsc(nmJs)+'&quot;)">&#128203; Certs</button>'+termBtn+'</td></tr>';
        });
        html+='</tbody></table>';
        box.innerHTML=html;
    }
    function rosterFillSelects(){
        document.getElementById('rosterHome').innerHTML='<option value="">&mdash; none &mdash;</option>'+(rosterState.meta.locations||[]).map(l=>'<option>'+rosterEsc(l.name)+'</option>').join('');
        document.getElementById('rosterPos').innerHTML='<option value="">&mdash; none &mdash;</option>'+(rosterState.meta.positions||[]).map(p=>'<option value="'+p.id+'">'+rosterEsc(p.name)+'</option>').join('');
    }
    // DATA-LOSS FIX (2026-07-18): the Edit modal used to show itself (fully editable, Save
    // enabled) before its async wage/start-date/birthday fetches resolved; a slow network or
    // a failed fetch left those fields blank with no indicator, and saveRoster() would then
    // push that blank straight through as a real null (see saveRoster() below). rosterFieldsLoaded
    // tracks each async field as false (still pending) / true (loaded ok) / 'error' (failed);
    // Save stays disabled until neither field is pending, and stays disabled (with a visible
    // message) if either errored, instead of silently allowing a blank save. _rosterModalToken
    // guards against a stale fetch from a previously-opened employee landing after the modal
    // has been reopened for someone else.
    var rosterFieldsLoaded = {wage:true, dates:true};
    var _rosterModalToken = 0;
    function _rosterModalSetSaveEnabled(enabled){
        var btn=document.querySelector('#rosterModal button[onclick="saveRoster()"]');
        if(btn){ btn.disabled=!enabled; btn.style.opacity=enabled?'1':'.55'; btn.style.cursor=enabled?'pointer':'not-allowed'; }
    }
    function _rosterModalLoadMsg(text, isError){
        var msg=document.getElementById('rosterModalMsg'); if(!msg) return;
        if(!text){ msg.style.display='none'; msg.innerHTML=''; return; }
        msg.style.display='block'; msg.style.color=isError?'#c0264b':'#6b7686'; msg.innerHTML=text;
    }
    function _rosterModalCheckReady(){
        if(rosterFieldsLoaded.wage===false || rosterFieldsLoaded.dates===false) return;
        if(rosterFieldsLoaded.wage==='error' || rosterFieldsLoaded.dates==='error'){
            var parts=[]; if(rosterFieldsLoaded.wage==='error') parts.push('wage'); if(rosterFieldsLoaded.dates==='error') parts.push('start date / birthday');
            _rosterModalLoadMsg('Could not load '+parts.join(' and ')+' for this employee, so Save is disabled (to avoid overwriting it blank). Close and reopen Edit to try again.', true);
            _rosterModalSetSaveEnabled(false);
            return;
        }
        _rosterModalLoadMsg('');
        _rosterModalSetSaveEnabled(true);
    }
    function openRosterModal(id){
        rosterFillSelects();
        const msg=document.getElementById('rosterModalMsg'); msg.style.display='none';
        document.getElementById('rosterStoresWrap').style.display='none';
        document.getElementById('rosterStoresList').innerHTML='';
        rosterStoresLoaded=false;
        document.getElementById('rosterAddStoresWrap').style.display='none';
        document.getElementById('rosterAddStoresList').innerHTML='';
        document.getElementById('rosterWage').value='';
        var rmAdm=(typeof isAdminManager==='function' && isAdminManager());
        document.getElementById('rosterBdayWrap').style.display=rmAdm?'block':'none';
        document.getElementById('rosterStart').value=''; document.getElementById('rosterBday').value='';
        document.getElementById('rosterStart').disabled=false; document.getElementById('rosterStartLock').style.display='none';
        var myToken=++_rosterModalToken;
        if(id){
            const e=rosterState.list.find(x=>x.id===id); if(!e) return;
            document.getElementById('rosterModalTitle').innerText='Edit Employee';
            document.getElementById('rosterEditId').value=e.id;
            document.getElementById('rosterName').value=e.name||'';
            document.getElementById('rosterPhone').value=(rosterState.phones&&rosterState.phones[e.id])?(rosterState.phones[e.id]||''):'';
            document.getElementById('rosterHome').value=e.home_location||'';
            document.getElementById('rosterPos').value=e.position_id?String(e.position_id):'';
            document.getElementById('rosterActive').checked=!!e.active;
            document.getElementById('rosterActiveWrap').style.display='flex';
            rosterFieldsLoaded={wage:(e.hourly_wage!=null), dates:false};
            _rosterModalSetSaveEnabled(false);
            _rosterModalLoadMsg('Loading wage &amp; dates&hellip;');
            if(e.hourly_wage!=null) document.getElementById('rosterWage').value=e.hourly_wage;
            else withPin(function(pin){
                supabaseClient.rpc('app_emp_wage',{p_username:currentUser.username,p_password:pin,p_employee_id:e.id}).then(function(r){
                    if(myToken!==_rosterModalToken) return;
                    if(r.error){ rosterFieldsLoaded.wage='error'; _rosterModalCheckReady(); return; }
                    if(r.data!=null) document.getElementById('rosterWage').value=r.data;
                    rosterFieldsLoaded.wage=true; _rosterModalCheckReady();
                }).catch(function(){ if(myToken!==_rosterModalToken) return; rosterFieldsLoaded.wage='error'; _rosterModalCheckReady(); });
            }, function(){ if(myToken!==_rosterModalToken) return; rosterFieldsLoaded.wage='error'; _rosterModalCheckReady(); });
            loadRosterStores(e.id);
            withPin(function(pin){
                supabaseClient.rpc('app_emp_dates_get',{p_username:currentUser.username,p_password:pin,p_employee_id:e.id}).then(function(r){
                    if(myToken!==_rosterModalToken) return;
                    if(r.error){ rosterFieldsLoaded.dates='error'; _rosterModalCheckReady(); return; }
                    var d=r.data||{};
                    if(d.start_date){ document.getElementById('rosterStart').value=String(d.start_date).slice(0,10); if(!rmAdm){ document.getElementById('rosterStart').disabled=true; document.getElementById('rosterStartLock').style.display='block'; } }
                    if(rmAdm && d.birthday){ document.getElementById('rosterBday').value=String(d.birthday).slice(0,10); }
                    rosterFieldsLoaded.dates=true; _rosterModalCheckReady();
                }).catch(function(){ if(myToken!==_rosterModalToken) return; rosterFieldsLoaded.dates='error'; _rosterModalCheckReady(); });
            }, function(){ if(myToken!==_rosterModalToken) return; rosterFieldsLoaded.dates='error'; _rosterModalCheckReady(); });
        } else {
            document.getElementById('rosterModalTitle').innerText='Add Employee';
            document.getElementById('rosterEditId').value='';
            document.getElementById('rosterName').value='';
            document.getElementById('rosterPhone').value='';
            document.getElementById('rosterHome').value='';
            document.getElementById('rosterPos').value='';
            document.getElementById('rosterActive').checked=true;
            document.getElementById('rosterActiveWrap').style.display='none';
            renderRosterAddStores();
            rosterFieldsLoaded={wage:true, dates:true};
            _rosterModalSetSaveEnabled(true);
        }
        document.getElementById('rosterModal').style.display='flex';
    }
    function renderRosterAddStores(){
        var locs=(rosterState.meta.locations||[]);
        var h=locs.map(function(l){ var nm=rosterEsc(l.name);
            return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:5px 0;border-bottom:1px solid #f3f3f3;"><input type="checkbox" class="ras-store" value="'+nm+'"> '+nm+'</label>';
        }).join('');
        document.getElementById('rosterAddStoresList').innerHTML=h||'<p style="font-size:12px;color:#6b7686;">No stores defined yet.</p>';
        document.getElementById('rosterAddStoresWrap').style.display='block';
    }
    function closeRosterModal(){ document.getElementById('rosterModal').style.display='none'; }
    function saveRoster(){
        const id=document.getElementById('rosterEditId').value;
        // DATA-LOSS FIX (2026-07-18): guard against Save firing while the async wage/date
        // GETs in openRosterModal() are still pending or failed -- belt-and-suspenders
        // alongside the disabled Save button there, so a blank field from an unfinished or
        // failed load can never be written back as a real null.
        if(id && (rosterFieldsLoaded.wage===false || rosterFieldsLoaded.dates===false || rosterFieldsLoaded.wage==='error' || rosterFieldsLoaded.dates==='error')){
            const lmsg=document.getElementById('rosterModalMsg'); lmsg.style.display='block'; lmsg.style.color='#c0264b'; lmsg.innerText='Wage/start date are still loading (or failed to load) — please wait, or close and reopen Edit, before saving.';
            return;
        }
        const name=document.getElementById('rosterName').value.trim();
        const home=document.getElementById('rosterHome').value;
        const posV=document.getElementById('rosterPos').value;
        const pos=posV?parseInt(posV,10):null;
        const wageV=document.getElementById('rosterWage').value;
        const wage=(wageV!==''&&!isNaN(parseFloat(wageV)))?parseFloat(wageV):null;
        const srAdm=(typeof isAdminManager==='function' && isAdminManager());
        const startD=document.getElementById('rosterStart').value||null;
        const bdayD=srAdm?(document.getElementById('rosterBday').value||null):null;
        const msg=document.getElementById('rosterModalMsg');
        if(!name){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Name is required.'; return; }
        withPin(function(pin){
            if(id){
                const active=document.getElementById('rosterActive').checked;
                supabaseClient.rpc('app_roster_update',{p_username:currentUser.username,p_password:pin,p_employee_id:parseInt(id,10),p_name:name,p_home_location:home,p_position_id:pos,p_active:active}).then(({error})=>{
                    if(error){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Error: '+error.message; if(error.code==='42501') sessionPin=null; return; }
                    var locs=[].slice.call(document.querySelectorAll('.rs-store:checked')).map(function(x){return x.value;});
                    var sm=[].slice.call(document.querySelectorAll('.rs-sm:checked')).map(function(x){return x.value;});
                    var am=[].slice.call(document.querySelectorAll('.rs-am:checked')).map(function(x){return x.value;});
                    // DATA-LOSS FIX (2026-07-18): only overwrite store/SM/AM assignments when the
                    // store list actually loaded (rosterStoresLoaded). If loadRosterStores' GET
                    // failed or never ran, the .rs-* checkboxes are absent, so locs/sm/am would be
                    // empty -- writing that would silently WIPE existing assignments. Skip the write
                    // in that case (existing assignments preserved); the other fields still save.
                    var storesSet = rosterStoresLoaded
                        ? supabaseClient.rpc('app_emp_admin_set',{p_username:currentUser.username,p_password:pin,p_employee_id:parseInt(id,10),p_locations:locs,p_sm:sm,p_am:am})
                        : Promise.resolve({error:null});
                    Promise.all([
                        storesSet,
                        supabaseClient.rpc('app_emp_set_wage',{p_username:currentUser.username,p_password:pin,p_employee_id:parseInt(id,10),p_wage:wage}),
                        supabaseClient.rpc('app_emp_set_dates',{p_username:currentUser.username,p_password:pin,p_employee_id:parseInt(id,10),p_start_date:startD,p_birthday:bdayD}),
                        supabaseClient.rpc('app_emp_set_phone',{p_username:currentUser.username,p_password:pin,p_emp_id:parseInt(id,10),p_phone:document.getElementById('rosterPhone').value})
                    ]).then(function(rs){
                        // DATA-LOSS FIX (2026-07-18): previously only rs[0] (store/SM/AM
                        // assignment) was checked here -- a wage/dates/phone error was
                        // silently ignored and the modal closed as if everything saved, which
                        // is how a real wage or start date could get wiped with zero error
                        // shown. Every result is now checked; the modal only closes when all
                        // four calls actually succeeded, and every failure is listed (not just
                        // the first one).
                        var labels=['Store/role assignment','Wage','Start date / birthday','Phone number'];
                        var fails=[];
                        rs.forEach(function(r,i){ if(r&&r.error){ fails.push(labels[i]+': '+r.error.message); if(r.error.code==='42501') sessionPin=null; } });
                        if(fails.length){
                            msg.style.display='block'; msg.style.color='#c0264b';
                            msg.innerHTML='Some changes did NOT save:<br>'+fails.map(function(f){return '&bull; '+escapeHtml(f);}).join('<br>')+'<br>Please try again.';
                            return;
                        }
                        closeRosterModal(); loadRoster();
                    }).catch(function(){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Connection error while saving — please check and try again.'; });
                });
            } else {
                var locs=[].slice.call(document.querySelectorAll('.ras-store:checked')).map(function(x){return x.value;});
                supabaseClient.rpc('app_emp_add',{p_username:currentUser.username,p_password:pin,p_name:name,p_wage:wage,p_position_id:pos,p_home:home,p_stores:locs}).then(({data,error})=>{
                    if(error){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Error: '+error.message; if(error.code==='42501') sessionPin=null; return; }
                    var newId=(typeof data==='number')?data:((data&&data.id)||(data&&data[0]&&data[0].id));
                    // DATA-LOSS FIX (2026-07-18): these were fire-and-forget with an empty
                    // .catch() -- which only catches network-level rejections, not a normal
                    // {error} response (e.g. a validation/permission failure) -- so a failed
                    // date or phone save on a brand-new hire was silently dropped with no
                    // indication it never saved. Both are now awaited and any failure is
                    // reported after the fact (the employee record itself already saved by
                    // this point, so the modal can still close normally).
                    var postSaves=[];
                    if(newId && (startD||bdayD)) postSaves.push(supabaseClient.rpc('app_emp_set_dates',{p_username:currentUser.username,p_password:pin,p_employee_id:newId,p_start_date:startD,p_birthday:bdayD}).then(function(r){return {field:'Start date / birthday',error:r&&r.error};},function(){return {field:'Start date / birthday',error:{message:'connection error'}};}));
                    var _rphone=((document.getElementById('rosterPhone')||{}).value||'').trim();
                    if(newId && _rphone) postSaves.push(supabaseClient.rpc('app_emp_set_phone',{p_username:currentUser.username,p_password:pin,p_emp_id:newId,p_phone:_rphone}).then(function(r){return {field:'Phone number',error:r&&r.error};},function(){return {field:'Phone number',error:{message:'connection error'}};}));
                    closeRosterModal();
                    var sv=document.getElementById('scheduleBuilderView');
                    if(sv && sv.style.display==='block'){ fetchScheduleWeek(); } else { loadRoster(); }
                    if(postSaves.length){
                        Promise.all(postSaves).then(function(results){
                            var fails=results.filter(function(x){return x.error;});
                            if(fails.length){ alert('The employee was added, but this did not save:\n'+fails.map(function(x){return '- '+x.field+': '+(x.error.message||'');}).join('\n')+'\n\nOpen Edit for this employee to fix it.'); }
                        });
                    }
                });
            }
        });
    }
    var rosterStoresData=null;
    // DATA-LOSS FIX (2026-07-18): true only after app_emp_admin_get loads store/SM/AM for the
    // open employee; saveRoster skips the assignment overwrite when this is false so a failed or
    // never-run load can't silently wipe existing store & manager assignments (mirrors the
    // rosterFieldsLoaded gate used for wage/dates above).
    var rosterStoresLoaded=false;
    function loadRosterStores(empId){
        withPin(function(pin){
            supabaseClient.rpc('app_emp_admin_get',{p_username:currentUser.username,p_password:pin,p_employee_id:empId}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; return; }
                rosterStoresData=r.data||{};
                rosterStoresLoaded=true;
                var all=rosterStoresData.all_stores||[], stores=rosterStoresData.stores||[], sm=rosterStoresData.sm||[], am=rosterStoresData.am||[];
                var h=all.map(function(s){ var esc=rosterEsc(s);
                    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid #f3f3f3;">' +
                        '<label style="display:flex;align-items:center;gap:8px;font-size:13px;flex:1;"><input type="checkbox" class="rs-store" value="'+esc+'"'+(stores.indexOf(s)>-1?' checked':'')+'> '+esc+'</label>' +
                        '<span style="white-space:nowrap;font-size:11px;color:#6b7686;"><label style="margin-right:8px;"><input type="checkbox" class="rs-sm" value="'+esc+'"'+(sm.indexOf(s)>-1?' checked':'')+'> SM</label>' +
                        '<label><input type="checkbox" class="rs-am" value="'+esc+'"'+(am.indexOf(s)>-1?' checked':'')+'> AM</label></span></div>';
                }).join('');
                document.getElementById('rosterStoresList').innerHTML=h||'<p style="font-size:12px;color:#6b7686;">No stores defined yet.</p>';
                document.getElementById('rosterStoresWrap').style.display='block';
            });
        });
    }
    function openRosterLink(id){
        const e=rosterState.list.find(x=>x.id===id); if(!e) return;
        document.getElementById('rosterLinkWho').innerText='Employee: '+e.name;
        const sel=document.getElementById('rosterLinkSelect');
        sel.innerHTML='<option value="">&mdash; choose login &mdash;</option>'+(rosterState.meta.users||[]).map(u=>'<option value="'+rosterEsc(u.username)+'"'+(u.linked?' disabled':'')+'>'+rosterEsc(u.name||u.username)+' ('+rosterEsc(u.username)+')'+(u.linked?' — linked':'')+'</option>').join('');
        sel.setAttribute('data-emp',id);
        document.getElementById('rosterLinkMsg').style.display='none';
        document.getElementById('rosterLinkModal').style.display='flex';
    }
    function closeRosterLink(){ document.getElementById('rosterLinkModal').style.display='none'; }
    function saveRosterLink(){
        const sel=document.getElementById('rosterLinkSelect');
        const id=parseInt(sel.getAttribute('data-emp'),10);
        const u=sel.value;
        const msg=document.getElementById('rosterLinkMsg');
        if(!u){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Pick a login.'; return; }
        withPin(function(pin){
            supabaseClient.rpc('app_roster_link',{p_username:currentUser.username,p_password:pin,p_employee_id:id,p_link_username:u})
            .then(({error})=>{ if(error){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Error: '+error.message; if(error.code==='42501') sessionPin=null; return; } closeRosterLink(); loadRosterMeta(); loadRoster(); });
        });
    }
    function rosterUnlink(id){
        if(!confirm('Unlink this login from the employee?')) return;
        withPin(function(pin){
            supabaseClient.rpc('app_roster_unlink',{p_username:currentUser.username,p_password:pin,p_employee_id:id})
            .then(({error})=>{ if(error){ alert('Error: '+error.message); if(error.code==='42501') sessionPin=null; return; } loadRosterMeta(); loadRoster(); });
        });
    }
    function rosterSetActive(id, active, name){
        var verb = active ? 'Reactivate' : 'Terminate';
        if(!confirm(verb+' '+(name||'this employee')+'?'+(active?'':'\n\nThey will be archived (no schedule access) but their history is kept. You can reactivate any time.'))) return;
        withPin(function(pin){
            supabaseClient.rpc('app_emp_set_active',{p_username:currentUser.username,p_password:pin,p_employee_id:id,p_active:active})
            .then(({error})=>{ if(error){ alert('Error: '+error.message); if(error.code==='42501') sessionPin=null; return; } loadRoster(); });
        });
    }
    function openRolesModal(){
        document.getElementById('rolesMsg').style.display='none';
        document.getElementById('roleName').value='';
        renderRolesList();
        document.getElementById('rolesModal').style.display='flex';
    }
    function closeRolesModal(){ document.getElementById('rolesModal').style.display='none'; }
    function renderRolesList(){
        var ps=(rosterState.meta.positions||[]);
        if(!ps.length){ document.getElementById('rolesList').innerHTML='<p style="font-size:12px;color:#6b7686;padding:8px 0;">No roles yet. Add one below.</p>'; return; }
        var byDept={};
        ps.forEach(function(p){ var d=p.department||'store'; (byDept[d]=byDept[d]||[]).push(p); });
        var labels={store:'Store',catering:'Catering & Vending'};
        var h='';
        Object.keys(byDept).forEach(function(d){
            h+='<div style="font-size:11px;font-weight:800;color:#6b7686;text-transform:uppercase;letter-spacing:.4px;margin:8px 0 4px;">'+(labels[d]||rosterEsc(d))+'</div>';
            byDept[d].forEach(function(p){
                var c=p.color||'#888780';
                h+='<div style="display:flex;align-items:center;gap:9px;padding:5px 0;border-bottom:1px solid #f3f3f3;"><span class="role-dot" style="background:'+rosterEsc(c)+';"></span><span style="font-size:13.5px;">'+rosterEsc(p.name)+'</span></div>';
            });
        });
        document.getElementById('rolesList').innerHTML=h;
    }
    function saveNewRole(){
        var name=document.getElementById('roleName').value.trim();
        var color=document.getElementById('roleColor').value||'#888780';
        var dept=document.getElementById('roleDept').value||'store';
        var msg=document.getElementById('rolesMsg');
        if(!name){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Role name is required.'; return; }
        withPin(function(pin){
            supabaseClient.rpc('app_position_add',{p_username:currentUser.username,p_password:pin,p_name:name,p_color:color,p_department:dept}).then(({error})=>{
                if(error){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Error: '+error.message; if(error.code==='42501') sessionPin=null; return; }
                msg.style.display='block'; msg.style.color='#1f7a3d'; msg.innerText='Added "'+name+'".';
                document.getElementById('roleName').value='';
                loadRosterMeta();
                setTimeout(function(){ renderRolesList(); }, 600);
            });
        });
    }
    function rosterAutolink(){
        if(!confirm('Auto-link app logins to employees whose names match exactly?')) return;
        withPin(function(pin){
            supabaseClient.rpc('app_roster_autolink',{p_username:currentUser.username,p_password:pin})
            .then(({data,error})=>{ if(error){ alert('Error: '+error.message); if(error.code==='42501') sessionPin=null; return; }
                const m=(data&&data.matched!=null)?data.matched:0; const sk=(data&&data.skipped)||[];
                alert('Auto-linked '+m+' employee(s).'+(sk.length?'\n\nNot matched ('+sk.length+'): '+sk.slice(0,15).join(', ')+(sk.length>15?'…':''):''));
                loadRosterMeta(); loadRoster();
            });
        });
    }
    function openRosterImport(){ document.getElementById('rosterImportText').value=''; document.getElementById('rosterImportMsg').style.display='none'; document.getElementById('rosterImportModal').style.display='flex'; }
    function closeRosterImport(){ document.getElementById('rosterImportModal').style.display='none'; }
    function saveRosterImport(){
        const txt=document.getElementById('rosterImportText').value;
        const msg=document.getElementById('rosterImportMsg');
        const rows=txt.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{ const parts=l.split(',').map(s=>s.trim()); return { name:parts[0], home_location:parts[1]||'', position:parts[2]||'' }; }).filter(r=>r.name);
        if(!rows.length){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Nothing to import.'; return; }
        withPin(function(pin){
            supabaseClient.rpc('app_roster_import',{p_username:currentUser.username,p_password:pin,p_rows:rows})
            .then(({data,error})=>{ if(error){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Error: '+error.message; if(error.code==='42501') sessionPin=null; return; }
                msg.style.display='block'; msg.style.color='#1f7a3d'; msg.innerText='Imported '+(data!=null?data:0)+' new employee(s); duplicates skipped.';
                loadRoster();
                setTimeout(closeRosterImport, 1400);
            });
        });
    }

    // ============================================================
    // MANAGER COMMAND CENTER (live ops, managers+)
    // ============================================================
    var PERM_OVR={};
    var PERM_PROTECTED_ROLES=['Admin Manager','Vice President/Co-Owner'];
    var PERM_FEATURES=[{id:'mgmt_tab',label:'Management tab'},{id:'command_center',label:'Command Center'},{id:'manager_action_center',label:'Manager Action Center'},{id:'store_health_scorecard',label:'Store Health Scorecard'},{id:'admin_dash',label:'Admin Dashboard'},{id:'admin_console',label:'Admin Console'},{id:'roster',label:'Employee Roster'},{id:'manager_admin',label:'Manager tools'},{id:'knowledge_base',label:'Knowledge Base (Scoopy)'},{id:'sales',label:'Sales'},{id:'prime_cost',label:'Prime Cost'},{id:'requests',label:'Requests'},{id:'assign_task',label:'Assign Task'},{id:'shortage_trends',label:'Shortage Trends'},{id:'team_dev',label:'Team Development'},{id:'fundraiser',label:'Fundraiser Hub'},{id:'forms_links',label:'Forms & Links'},{id:'announce',label:'Announcements'},{id:'discipline',label:'Disciplinary Actions'},{id:'attendance',label:'Attendance'},{id:'preshift',label:'Pre-Shift Lineup'},{id:'avail_approvals',label:'Availability Approvals'},{id:'celebrations',label:'Celebrations'},{id:'crew_trainer',label:'Crew Trainer'},{id:'popin',label:'Pop-In'},{id:'inventory',label:'Inventory'},{id:'maint_billing',label:'Maintenance Billing'},{id:'maint_dash',label:'Maintenance Dashboard'},{id:'scorecards',label:'Store Scorecards'},{id:'store_manager',label:'Manage Stores'},
    // H4 fix (2026-07-17): these 12 feature ids were already gated via permAllow() at their tile's
    // applyRoleUI() call site (js/05_admin_tasks_pip_disciplinary.js) but had no row here, so an
    // Admin Manager had no way to actually toggle them for a role -- the screen's own copy ("turn
    // its tools on or off") over-promised what it covered. Added additively; see permDefault() below
    // for matching default on/off state per role.
    {id:'pay_tools',label:'Pay Tools'},{id:'catering',label:'Catering Pipeline'},{id:'daily_report',label:'Daily Store Report'},{id:'shift_console',label:'Shift Leader Console'},{id:'site_inspection',label:'Store & Site Inspection'},{id:'ops_meeting',label:'Ops Meeting Hub'},{id:'writeup_templates',label:'Performance Write-Ups'},{id:'marketing',label:'Marketing Hub'},{id:'marketing_v2',label:'Marketing Hub (v2)'},{id:'team_growth',label:'Team Growth & Evaluations'},{id:'training_hub',label:'Training Hub'},{id:'requests_rails',label:'Requests & Orders'}
    ];
    // Added 'Assistant Manager' (2026-07-17) -- it's a real rung on the Roster's own promotion
    // ladder but had no row here, so an Admin Manager had no way to configure its tool access at all.
    var PERM_ROLES=['Manager','Store Manager','Assistant Manager','Finance Approver','Maintenance Lead','Shift Lead','Crew Trainer','Maintenance','Blue Apron','Crew Member'];
    function permAllow(fid, def){
        // Dev "allow everything" is suppressed while a "View as" preview is active, so
        // previewing as a lower role honestly reflects that role. Read path uses
        // effectiveRole(); with no override it equals currentUser.role (unchanged).
        try{ if(currentUser && currentUser.is_developer===true && (typeof isPreviewMode!=='function'||!isPreviewMode()) && !window._viewAsRole) return true; }catch(e){}
        var role=(typeof effectiveRole==='function' ? effectiveRole() : ((currentUser&&currentUser.role)||''));
        if(PERM_PROTECTED_ROLES.indexOf(role)>=0) return true;
        var o=PERM_OVR[role];
        if(o && Object.prototype.hasOwnProperty.call(o,fid)) return (o[fid]===1||o[fid]===true);
        return !!def;
    }
    function permDefault(role, fid){
        var isMgr=(role==='Admin Manager'||role==='Manager'||role==='Vice President/Co-Owner');
        var isAdmin=(role==='Admin Manager'||role==='Vice President/Co-Owner');
        var sl=(role==='Shift Lead'); var tr=/trainer/i.test(role||'');
        var inB=function(arr){return arr.indexOf(role)>=0;};
        switch(fid){
            case 'mgmt_tab': case 'command_center': case 'sales': case 'prime_cost': case 'requests': case 'assign_task': case 'shortage_trends': case 'team_dev': case 'fundraiser': case 'forms_links': case 'announce': return isMgr;
            case 'admin_dash': case 'manager_admin': case 'knowledge_base': case 'roster': case 'admin_console': return isAdmin;
            case 'discipline': case 'attendance': case 'preshift': case 'avail_approvals': case 'celebrations': return isMgr||sl;
            case 'crew_trainer': return isMgr||sl||tr;
            case 'popin': case 'inventory': return isMgr||sl;
            case 'maint_billing': case 'maint_dash': return isMgr||inB(['Vice President/Co-Owner','Store Manager','Finance Approver','Maintenance Lead']);
            case 'store_health_scorecard': return isMgr||inB(['Vice President/Co-Owner','Store Manager','Assistant Manager']);
            case 'store_manager': case 'scorecards': case 'catering': case 'manager_action_center': return isMgr||inB(['Vice President/Co-Owner','Store Manager']);
            // H4 fix (2026-07-17): default-state cases for the 12 feature ids added to PERM_FEATURES
            // above, mirrored from the same OR-lists their tiles actually use in applyRoleUI()
            // (js/05_admin_tasks_pip_disciplinary.js ~lines 495-507), so the matrix's "default on/off"
            // tag and initial checkbox state reflect real current behavior instead of always "off".
            case 'ops_meeting': case 'pay_tools': return isMgr||inB(['Vice President/Co-Owner','Store Manager','Office']);
            case 'daily_report': case 'shift_console': return isMgr||sl||inB(['Vice President/Co-Owner','Store Manager','Shift Leader','Office']);
            case 'site_inspection': case 'writeup_templates': return isMgr||sl||inB(['Vice President/Co-Owner','Store Manager','Shift Leader']);
            case 'marketing': return isMgr||inB(['Vice President/Co-Owner','Store Manager','Marketing Manager','Designer/Creative']);
            case 'marketing_v2': return isMgr||inB(['Vice President/Co-Owner','Store Manager','Marketing Manager','Office']);
            case 'team_growth': case 'training_hub': case 'requests_rails': return true;
            default: return false;
        }
    }
    function permEffective(role, fid){
        if(PERM_PROTECTED_ROLES.indexOf(role)>=0) return true;
        var o=PERM_OVR[role];
        if(o && Object.prototype.hasOwnProperty.call(o,fid)) return (o[fid]===1||o[fid]===true);
        return !!permDefault(role,fid);
    }
    function loadPermMatrix(){
        try{
            supabaseClient.rpc('app_settings_get',{p_username:currentUser.username,p_password:sessionPin,p_group:'perm_matrix'}).then(function(r){
                if(r&&!r.error&&r.data){ var m={}; (r.data||[]).forEach(function(row){ try{ m[row.key]=JSON.parse(row.value||'{}')||{}; }catch(e){ m[row.key]={}; } }); PERM_OVR=m; if(typeof applyRoleUI==='function'){ try{ applyRoleUI(); }catch(e){} } }
            }).catch(function(){});
        }catch(e){}
    }
    function pmxOv(){ var o=document.getElementById('permMatrixModal'); if(!o){ o=document.createElement('div'); o.id='permMatrixModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function pmxClose(){ var o=document.getElementById('permMatrixModal'); if(o) o.style.display='none'; }
    function openPermMatrix(){
        if(!(currentUser&&(currentUser.is_developer===true||PERM_PROTECTED_ROLES.indexOf(currentUser.role)>=0))){ alert('Roles & Permissions is for Admin Managers.'); return; }
        var ov=pmxOv();
        ov.innerHTML='<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">Roles &amp; Permissions</b><button onclick="pmxClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:15px;">&times;</button></div><div style="max-width:640px;margin:0 auto;padding:16px 16px 60px;"><p style="font-size:13px;color:#6b7686;margin-top:0;line-height:1.55;">Choose a role, then turn its tools on or off. Everything starts on the built-in defaults &mdash; changes take effect at that person&rsquo;s next screen refresh. Admin Managers and the VP / Co-Owner always keep full access and can&rsquo;t be locked out.</p><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;"><label style="font-size:13px;color:#33303a;font-weight:700;">Role</label><select id="pmxRole" onchange="pmxRender()" style="flex:1;min-width:160px;padding:9px;border:1px solid #d6deea;border-radius:8px;font-size:14px;"></select></div><div id="pmxList"></div></div>';
        var sel=document.getElementById('pmxRole'); var opts=PERM_PROTECTED_ROLES.concat(PERM_ROLES);
        sel.innerHTML=opts.map(function(r){return '<option value="'+escapeHtml(r)+'"'+(r==='Manager'?' selected':'')+'>'+escapeHtml(r)+(PERM_PROTECTED_ROLES.indexOf(r)>=0?' (always full access)':'')+'</option>';}).join('');
        pmxRender();
    }
    function pmxRender(){
        var role=document.getElementById('pmxRole').value; var box=document.getElementById('pmxList'); if(!box) return;
        if(PERM_PROTECTED_ROLES.indexOf(role)>=0){ box.innerHTML='<div style="background:#e8f5ec;border:1px solid #bfe6cc;border-radius:10px;padding:14px;color:#1b7a3d;font-size:13.5px;">'+escapeHtml(role)+' always has full access to every tool. This protects admins from being locked out. Pick another role to adjust its access.</div>'; return; }
        var h='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;overflow:hidden;">';
        PERM_FEATURES.forEach(function(f,i){
            var on=permEffective(role,f.id); var def=!!permDefault(role,f.id);
            var ovr=PERM_OVR[role]&&Object.prototype.hasOwnProperty.call(PERM_OVR[role],f.id);
            var tag= ovr ? (on?'<span style="font-size:10.5px;color:#185FA5;font-weight:700;margin-left:6px;">changed</span>':'<span style="font-size:10.5px;color:#c0264b;font-weight:700;margin-left:6px;">removed</span>') : '<span style="font-size:10.5px;color:#5b6675;margin-left:6px;">default '+(def?'on':'off')+'</span>';
            h+='<label style="display:flex;align-items:center;gap:10px;padding:11px 13px;'+(i?'border-top:1px solid #f3f4f8;':'')+'cursor:pointer;"><input type="checkbox" '+(on?'checked':'')+' onchange="pmxToggle(\''+f.id+'\',this.checked)" style="width:18px;height:18px;cursor:pointer;"><span style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(f.label)+tag+'</span></label>';
        });
        h+='</div>';
        var hasOvr=PERM_OVR[role]&&Object.keys(PERM_OVR[role]).length>0;
        if(hasOvr){ h+='<div style="margin-top:12px;text-align:right;"><button onclick="pmxResetRole()" style="background:none;border:none;color:#5b6675;font-size:12px;text-decoration:underline;cursor:pointer;">Reset '+escapeHtml(role)+' to defaults</button></div>'; }
        box.innerHTML=h;
    }
    function pmxToggle(fid, checked){
        var role=document.getElementById('pmxRole').value; if(PERM_PROTECTED_ROLES.indexOf(role)>=0) return;
        if(!PERM_OVR[role]) PERM_OVR[role]={};
        var def=!!permDefault(role,fid);
        if((!!checked)===def){ delete PERM_OVR[role][fid]; } else { PERM_OVR[role][fid]=checked?1:0; }
        withPin(function(pin){
            supabaseClient.rpc('app_settings_set',{p_username:currentUser.username,p_password:pin,p_key:role,p_group:'perm_matrix',p_label:role,p_value:JSON.stringify(PERM_OVR[role]||{}),p_sort:0}).then(function(r){
                if(r&&r.error){ alert('Could not save: '+r.error.message); }
                if(role===currentUser.role && typeof applyRoleUI==='function'){ try{ applyRoleUI(); }catch(e){} }
                pmxRender();
            }).catch(function(){ alert('Could not save.'); });
        });
    }
    function pmxResetRole(){
        var role=document.getElementById('pmxRole').value; if(!role||PERM_PROTECTED_ROLES.indexOf(role)>=0) return;
        if(!confirm('Reset '+role+' back to the built-in defaults? This clears the custom tool access you set for '+role+' only \u2014 other roles are not affected.')) return;
        withPin(function(pin){
            supabaseClient.rpc('app_settings_set',{p_username:currentUser.username,p_password:pin,p_key:role,p_group:'perm_matrix',p_label:role,p_value:'{}',p_sort:0}).then(function(r){
                if(r&&r.error){ alert('Could not reset: '+r.error.message); return; }
                delete PERM_OVR[role]; if(role===currentUser.role && typeof applyRoleUI==='function'){ try{ applyRoleUI(); }catch(e){} } pmxRender();
            }).catch(function(){ alert('Could not reset.'); });
        });
    }

    // ROLE-STRING FIX (2026-07-18): added 'Store Manager'. This shared helper is used across
    // the app (js/18 Daily Store Report's Leadership dashboard + audit history, js/19 Shift
    // Leader Console, and many others) to decide who counts as a manager, but it omitted
    // 'Store Manager' even though js/05's own local isManager const (~line 480), the
    // PERM_ROLES list above, and permDefault() above all already treat 'Store Manager' as a
    // real management role. That mismatch locked Store Managers out of the Shift Leader
    // Console, the Leadership Dashboard, and audit history. Additive only -- nobody loses access.
    function isManagerRole(){ return currentUser && (currentUser.role==='Admin Manager' || currentUser.role==='Manager' || currentUser.role==='Store Manager' || currentUser.role==='Vice President/Co-Owner' || currentUser.is_developer===true); }
    // Broad "management" gate: Shift Lead and above, store/assistant managers, admins, or developer.
    // Used to lock management-only tools (Pop-In, Inventory, HR forms) away from line staff.
    // ROLE-STRING FIX (2026-07-17): added the 'Assistant Manager' role-string check. This
    // function's own comment above already says "Shift Lead and above, store/assistant
    // managers" -- but assistant managers only ever got in via the isStoreManager flag (a
    // separate per-store assignment system). Someone promoted to "Assistant Manager" via the
    // Roster's role ladder alone (no separate per-store assignment) fell through every check
    // here and was treated as line staff. This is additive -- nobody loses access.
    function isMgmt(){ return currentUser && (currentUser.is_developer===true || isManagerRole() || currentUser.role==='Shift Lead' || currentUser.role==='Assistant Manager' || currentUser.isStoreManager===true); }
    function openCommandCenter(){
        if(!isManagerRole()){ alert('Managers only.'); return; }
        triggerTransition(()=>{
            document.querySelectorAll('.app-view').forEach(v=>v.style.display='none');
            document.getElementById('commandCenterView').style.display='block';
            ccLoad();
        });
    }
    function ccCard(num,lbl,sub,color){ return '<div class="cc-card"><div class="cc-lbl">'+lbl+'</div><div class="cc-num" style="color:'+color+';">'+num+'</div><div class="cc-sub">'+sub+'</div></div>'; }
    function ccLoad(){
        const today=schedFmt(new Date());
        const wkStart=schedFmt(schedMondayOf(new Date()));
        const body=document.getElementById('ccBody');
        body.innerHTML='<p style="text-align:center;color:#6b7686;padding:24px;">Loading&hellip;</p>';
        withPin(function(pin){
            const u=currentUser.username;
            Promise.all([
                supabaseClient.rpc('app_clock_live',{p_username:u,p_password:pin}),
                supabaseClient.rpc('app_timesheet',{p_username:u,p_password:pin,p_start:today,p_end:today}),
                supabaseClient.rpc('app_timesheet',{p_username:u,p_password:pin,p_start:wkStart,p_end:today}),
                supabaseClient.rpc('app_admin_tasks_get',{p_username:u,p_password:pin})
            ]).then(function(res){
                const e0=res[0].error;
                if(e0 && e0.code==='42501'){ sessionPin=null; }
                if(e0){ body.innerHTML='<p style="color:red;text-align:center;padding:20px;">Error: '+e0.message+'</p>'; return; }
                const live=res[0].data||[];
                const todayTs=res[1].data||{rows:[],open_count:0};
                const weekTs=res[2].data||{rows:[],open_count:0};
                const tasks=(res[3] && res[3].data && res[3].data.tasks) ? res[3].data.tasks : [];
                ccRender(live, todayTs, weekTs, wkStart, tasks);
            }).catch(function(){ body.innerHTML='<p style="color:red;text-align:center;padding:20px;">Connection error.</p>'; });
        }, function(){ body.innerHTML='<p style="text-align:center;color:#6b7686;padding:20px;">PIN required.</p>'; });
    }
    function ccRender(live, todayTs, weekTs, wkStart, tasks){
        tasks = tasks || [];
        const onClock=live.length;
        const onBreak=live.filter(p=>p.on_break).length;
        const workedToday=(todayTs.rows||[]).reduce((a,r)=>a+(r.total_hours||0),0);
        const peopleToday=(todayTs.rows||[]).length;
        const openPunch=todayTs.open_count||weekTs.open_count||0;
        const otRows=(weekTs.rows||[]).filter(r=>(r.ot_hours||0)>0);
        const approaching=(weekTs.rows||[]).filter(r=>(r.ot_hours||0)===0 && (r.total_hours||0)>=35);
        const weekTotal=(weekTs.rows||[]).reduce((a,r)=>a+(r.total_hours||0),0);
        const weekOt=(weekTs.rows||[]).reduce((a,r)=>a+(r.ot_hours||0),0);
        let h='';
        h+='<div class="cc-grid">';
        h+=ccCard(onClock, 'On the clock', onBreak?(onBreak+' on break'):'right now', '#16a34a');
        h+=ccCard(workedToday.toFixed(1), 'Hours today', peopleToday+' worked', 'var(--caliches-blue)');
        h+=ccCard(openPunch, 'Open punches', openPunch?'not clocked out':'all clear', openPunch?'#e67e22':'#16a34a');
        h+=ccCard(weekOt.toFixed(1), 'OT this week', weekTotal.toFixed(1)+' h total', weekOt>0?'#c0392b':'#16a34a');
        h+='</div>';
        // ── Time-sensitive admin tasks ──
        var overdueN = tasks.filter(function(t){ return t.days_left < 0; }).length;
        h+='<div class="cc-section"><h3 style="display:flex;justify-content:space-between;align-items:center;">&#9203; Time-Sensitive Tasks'+(overdueN?(' <span class="cc-urg" style="background:#c0392b;">'+overdueN+' overdue</span>'):'')+' <button class="roster-act" style="margin-left:auto;" onclick="openAddTask()">&#10133; Add</button></h3>';
        if(!tasks.length){ h+='<p style="color:#6b7686;font-size:13px;margin:0;">No upcoming admin tasks. &#127881;</p>'; }
        else { tasks.forEach(function(t){
            var d=t.days_left, color, badge;
            if(d<0){ color='#c0392b'; badge=Math.abs(d)+'d overdue'; }
            else if(d<=7){ color='#e67e22'; badge=(d===0?'due today':'in '+d+'d'); }
            else { color='#16a34a'; badge='in '+d+'d'; }
            var act = (t.category==='PIP Review' && t.related_pip_id)
                ? '<button class="roster-act" onclick="openDecision('+t.related_pip_id+',&quot;'+escapeHtml((t.employee||'').replace(/&/g,'').replace(/"/g,''))+'&quot;)">Decision</button>'
                : '<button class="roster-act" onclick="ccCompleteTask('+t.id+')">Done</button>';
            h+='<div class="cc-row" style="border-left:5px solid '+color+';"><div><div style="font-weight:bold;">'+escapeHtml(t.title)+'</div><div style="font-size:12px;color:#6b7686;">'+escapeHtml(t.category)+' &bull; due '+t.due_date+(t.employee?(' &bull; '+escapeHtml(t.employee)):'')+'</div></div><div style="text-align:right;white-space:nowrap;"><span class="cc-urg" style="background:'+color+';">'+badge+'</span>'+act+'</div></div>';
        }); }
        h+='</div>';
        h+='<div class="cc-section"><h3>&#128994; On the clock now</h3>';
        if(!live.length){ h+='<p style="color:#6b7686;font-size:13px;margin:0;">Nobody is clocked in right now.</p>'; }
        else { live.forEach(function(p){ const hrs=(p.minutes/60).toFixed(2); h+='<div class="cc-row" style="border-left:5px solid '+(p.on_break?'#e67e22':'#16a34a')+';"><div><div style="font-weight:bold;">'+escapeHtml(p.employee)+(p.flagged?' &#9888;':'')+'</div><div style="font-size:12px;color:#6b7686;">'+escapeHtml(p.location||'')+' &bull; since '+p.since+'</div></div><div style="text-align:right;"><div style="font-weight:900;color:var(--caliches-blue);">'+hrs+' h</div>'+(p.on_break?'<div style="font-size:11px;color:#e67e22;font-weight:bold;">ON BREAK</div>':'')+'</div></div>'; }); }
        h+='</div>';
        h+='<div class="cc-section"><h3>&#9888; Overtime watch (week of '+wkStart+')</h3>';
        if(!otRows.length && !approaching.length){ h+='<p style="color:#6b7686;font-size:13px;margin:0;">No one is in or near overtime.</p>'; }
        else {
            otRows.forEach(function(r){ h+='<div class="cc-row" style="border-left:5px solid #c0392b;"><div style="font-weight:bold;">'+escapeHtml(r.name)+'</div><div style="text-align:right;font-weight:900;color:#c0392b;">'+r.total_hours.toFixed(1)+' h <span style="font-size:11px;">('+r.ot_hours.toFixed(1)+' OT)</span></div></div>'; });
            approaching.forEach(function(r){ h+='<div class="cc-row" style="border-left:5px solid #e67e22;"><div style="font-weight:bold;">'+escapeHtml(r.name)+'</div><div style="text-align:right;font-weight:800;color:#e67e22;">'+r.total_hours.toFixed(1)+' h <span style="font-size:11px;">(approaching)</span></div></div>'; });
        }
        h+='</div>';
        h+='<div class="cc-section"><h3>&#9889; Quick actions</h3><div class="cc-actions">';
        h+='<button onclick="openScheduling()">&#128197; Schedule</button>';
        h+='<button onclick="openTimesheets()">&#128202; Timesheets</button>';
        h+='<button onclick="openLiveBoard()">&#128994; On the Clock</button>';
        if(isAdminManager()) h+='<button onclick="openRoster()">&#128101; Roster</button>';
        h+='<button onclick="openDashboard()">&#128200; Manager Dashboard</button>';
        h+='</div></div>';
        document.getElementById('ccBody').innerHTML=h;
    }
