    // ============================================================
    // ADMIN TASKS + PIP / DISCIPLINARY (Admin Manager only)
    // ============================================================
    function ccRefresh(){ if(document.getElementById('commandCenterView').style.display==='block') ccLoad(); if(document.getElementById('rosterView').style.display==='block') loadRoster(); }

    function ccCompleteTask(id){
        withPin(function(pin){
            supabaseClient.rpc('app_admin_task_complete',{p_username:currentUser.username,p_password:pin,p_id:id})
            .then(({error})=>{ if(error){ alert('Error: '+error.message); if(error.code==='42501') sessionPin=null; return; } ccRefresh(); });
        });
    }
    function openAddTask(){
        document.getElementById('atTitle').value=''; document.getElementById('atCategory').value='Payroll';
        document.getElementById('atDue').value=''; document.getElementById('atLink').value='';
        document.getElementById('atMsg').style.display='none';
        document.getElementById('addTaskModal').style.display='flex';
    }
    function closeAddTask(){ document.getElementById('addTaskModal').style.display='none'; }
    function saveAddTask(){
        const title=document.getElementById('atTitle').value.trim();
        const cat=document.getElementById('atCategory').value;
        const due=document.getElementById('atDue').value;
        const link=document.getElementById('atLink').value.trim();
        const msg=document.getElementById('atMsg');
        if(!title || !due){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Title and due date are required.'; return; }
        withPin(function(pin){
            supabaseClient.rpc('app_admin_task_add',{p_username:currentUser.username,p_password:pin,p_title:title,p_category:cat,p_due_date:due,p_link_url:link,p_employee_id:null})
            .then(({error})=>{ if(error){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Error: '+error.message; if(error.code==='42501') sessionPin=null; return; } closeAddTask(); ccRefresh(); });
        });
    }

    function openPip(empId, name, location, designation){
        document.getElementById('pipEmpId').value=empId;
        document.getElementById('pipLocation').value=location||'';
        document.getElementById('pipDesignation').value=designation||'';
        document.getElementById('pipWho').innerText='Employee: '+(name||'');
        const t=new Date(); const e=new Date(); e.setDate(e.getDate()+30);
        document.getElementById('pipStart').value=schedFmt(t);
        document.getElementById('pipEnd').value=schedFmt(e);
        document.getElementById('pipIncident').value=schedFmt(t);
        document.getElementById('pipManager').value=(currentUser && currentUser.name) ? currentUser.name : '';
        document.getElementById('pipIssue').value='performance';
        document.getElementById('pipReason').value='';
        document.getElementById('pipMsg').style.display='none';
        document.getElementById('pipModal').style.display='flex';
    }
    function closePip(){ document.getElementById('pipModal').style.display='none'; }
    function savePip(){
        const empId=parseInt(document.getElementById('pipEmpId').value,10);
        const start=document.getElementById('pipStart').value, end=document.getElementById('pipEnd').value;
        const incident=document.getElementById('pipIncident').value;
        const issueVal=document.getElementById('pipIssue').value;
        const issueLabel=({performance:'Performance',conduct:'Conduct',attendance:'Attendance'})[issueVal]||issueVal;
        const expected=document.getElementById('pipReason').value.trim();
        const location=document.getElementById('pipLocation').value;
        const designation=document.getElementById('pipDesignation').value;
        const mgrName=(document.getElementById('pipManager').value||'').trim() || (currentUser.name||currentUser.username);
        const empName=(document.getElementById('pipWho').innerText||'').replace('Employee: ','').trim();
        const msg=document.getElementById('pipMsg');
        if(!start||!end){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='PIP start and end dates are required.'; return; }
        const combined='Issue: '+issueLabel+(incident?(' on '+incident):'')+(expected?('. Expected actions: '+expected):'');
        withPin(function(pin){
            supabaseClient.rpc('app_pip_create',{p_username:currentUser.username,p_password:pin,p_employee_id:empId,p_start:start,p_end:end,p_reason:combined})
            .then(({data,error})=>{
                if(error){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Error: '+error.message; if(error.code==='42501') sessionPin=null; return; }
                msg.style.display='block'; msg.style.color='#1f7a3d'; msg.innerText='PIP started ✓  Generating Written Warning Letter…';
                const pipId=data;
                const qs='?action=pip_warning_letter&employee='+encodeURIComponent(empName)+'&designation='+encodeURIComponent(designation)+'&location='+encodeURIComponent(location)+'&issue='+encodeURIComponent(issueLabel)+'&incident_date='+encodeURIComponent(incident||'')+'&expected='+encodeURIComponent(expected)+'&manager='+encodeURIComponent(mgrName)+'&pip_start='+encodeURIComponent(start)+'&pip_end='+encodeURIComponent(end)+'&final_review='+encodeURIComponent(end)+'&pip_id='+encodeURIComponent(pipId||'');
                let done=false;
                const finishOnce=function(){ if(done) return; done=true; clearTimeout(t); closePip(); if(typeof loadRoster==='function') loadRoster(); if(typeof ccRefresh==='function') ccRefresh(); };
                var t=setTimeout(finishOnce, 15000);
                fetch(G_URL+qs).then(r=>r.json()).then(()=>finishOnce()).catch(()=>finishOnce());
            });
        });
    }

    let decEmpName='';
    function openDecision(pipId, name){
        decEmpName=name||'';
        document.getElementById('decPipId').value=pipId;
        document.getElementById('decWho').innerText='Employee: '+decEmpName;
        document.querySelectorAll('input[name="decChoice"]').forEach(function(r){ r.checked=false; });
        document.querySelectorAll('#decisionModal .dm-radio').forEach(function(l){ l.classList.remove('sel'); });
        document.getElementById('decExtendWrap').style.display='none';
        document.getElementById('decNewEnd').value='';
        document.getElementById('decNotes').value='';
        document.getElementById('decMsg').style.display='none';
        document.getElementById('decisionModal').style.display='flex';
    }
    function closeDecision(){ document.getElementById('decisionModal').style.display='none'; }
    function decPick(el){
        document.querySelectorAll('#decisionModal .dm-radio').forEach(function(l){ l.classList.remove('sel'); });
        if(el.checked) el.closest('.dm-radio').classList.add('sel');
        document.getElementById('decExtendWrap').style.display = (el.value==='extended') ? 'block' : 'none';
    }
    function saveDecision(){
        const pipId=parseInt(document.getElementById('decPipId').value,10);
        const chosen=document.querySelector('input[name="decChoice"]:checked');
        const notes=document.getElementById('decNotes').value.trim();
        const newEnd=document.getElementById('decNewEnd').value;
        const msg=document.getElementById('decMsg');
        if(!chosen){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Please choose a final decision.'; return; }
        if(!notes){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Notes / justification are required.'; return; }
        if(chosen.value==='extended' && !newEnd){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Enter the new end date for the extension.'; return; }
        const btn=document.getElementById('decSaveBtn'); if(btn){ btn.disabled=true; btn.innerText='Saving...'; }
        withPin(function(pin){
            // Best-effort PDF generation (filed in Dropbox via Apps Script); never blocks the in-app save.
            const qs='?action=pip_decision&pip_id='+pipId+'&employee='+encodeURIComponent(decEmpName)+'&decision='+encodeURIComponent(chosen.value)+'&notes='+encodeURIComponent(notes)+'&new_end='+encodeURIComponent(newEnd||'')+'&manager='+encodeURIComponent(currentUser.name||currentUser.username);
            const finish=function(pdfUrl){
                supabaseClient.rpc('app_pip_decide',{p_username:currentUser.username,p_password:pin,p_pip_id:pipId,p_decision:chosen.value,p_notes:notes,p_new_end:newEnd||null,p_pdf_url:pdfUrl||''})
                .then(({error})=>{
                    if(btn){ btn.disabled=false; btn.innerText='Record Decision'; }
                    if(error){ msg.style.display='block'; msg.style.color='#c0264b'; msg.innerText='Error: '+error.message; if(error.code==='42501') sessionPin=null; return; }
                    closeDecision(); ccRefresh();
                });
            };
            let done=false;
            const finishOnce=function(pdfUrl){ if(done) return; done=true; clearTimeout(t); finish(pdfUrl); };
            var t=setTimeout(function(){ finishOnce(''); }, 15000); // don't wait forever on the PDF (cold starts can take ~10s)
            fetch(G_URL+qs).then(r=>r.json()).then(j=>{ finishOnce(j && j.url ? j.url : ''); }).catch(()=>{ finishOnce(''); });
        }, function(){ if(btn){ btn.disabled=false; btn.innerText='Record Decision'; } });
    }

    // ============================================================
    // TIME CLOCK (Phase 2a, TEST) - clock in/out/breaks
    // ============================================================
    let clockState = { status: null, timer: null };
    function clockSelectedEmp() { const s = document.getElementById('clockEmpSelect'); return s && s.value ? parseInt(s.value,10) : null; }

    function openTimeClock() {
        triggerTransition(() => {
            document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
            document.getElementById('timeClockView').style.display = 'block';
            const loc = document.getElementById('clockLocSelect');
            if (loc && !loc.options.length) loc.innerHTML = SCHED_LOCATIONS.map(l => '<option>'+l+'</option>').join('');
            loadClockEmployees();
        });
    }

    function loadClockEmployees() {
        const sel = document.getElementById('clockEmpSelect');
        withPin(function(pin){
            supabaseClient.rpc('app_sched_employees', { p_username: currentUser.username, p_password: pin })
            .then(({ data, error }) => {
                if (error) { sel.innerHTML = '<option>Error loading</option>'; return; }
                const list = data || [];
                sel.innerHTML = list.map(e => '<option value="'+e.id+'">'+escapeHtml(e.name)+'</option>').join('');
                clockRefreshStatus();
            });
        });
    }

    function clockRefreshStatus() {
        const emp = clockSelectedEmp(); if (!emp) return;
        withPin(function(pin){
            supabaseClient.rpc('app_clock_status', { p_username: currentUser.username, p_password: pin, p_employee_id: emp })
            .then(({ data, error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if (error) { document.getElementById('clockStatusBig').innerText = 'Error: ' + error.message; return; }
                clockState.status = data || {};
                renderClockCard();
            });
        });
    }

    function renderClockCard() {
        const st = clockState.status || {};
        const open = st.open_punch;
        const mainBtn = document.getElementById('clockMainBtn');
        const breakBtn = document.getElementById('clockBreakBtn');
        if (clockState.timer) { clearInterval(clockState.timer); clockState.timer = null; }
        if (open) {
            const onBreak = !!open.open_break_start;
            document.getElementById('clockStatusBig').innerText = onBreak ? 'On break' : 'Clocked in';
            mainBtn.innerText = 'Clock Out'; mainBtn.className = 'save-btn red-btn'; mainBtn.style.background = '';
            breakBtn.style.display = 'block';
            breakBtn.innerText = onBreak ? 'End Break' : 'Start Break';
            const startMs = new Date(open.clock_in).getTime();
            const tick = () => {
                const s = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
                const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
                const el = document.getElementById('clockTimer'); if (el) el.innerText = h + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
            };
            tick(); clockState.timer = setInterval(tick, 1000);
        } else {
            document.getElementById('clockStatusBig').innerText = 'Not clocked in';
            document.getElementById('clockTimer').innerText = '—';
            mainBtn.innerText = 'Clock In'; mainBtn.className = 'save-btn blue-btn'; mainBtn.style.background = '';
            breakBtn.style.display = 'none';
        }
        document.getElementById('clockTodayHrs').innerText = 'Today: ' + (((st.today_minutes||0)/60).toFixed(2)) + ' hrs';
        const list = st.today || [];
        const c = document.getElementById('clockTodayList');
        c.innerHTML = list.length ? list.map(function(p){
            return '<div style="display:flex;justify-content:space-between;padding:8px 10px;border:1px solid #eee;border-radius:8px;margin-bottom:6px;font-size:13px;"><span>'+escapeHtml(p.location||'')+'</span><span>'+(p.clock_in||'')+' &ndash; '+(p.clock_out||'<b style="color:#1f9d55">now</b>')+(p.flagged?' &#9888;':'')+'</span></div>';
        }).join('') : '<p style="color:#6b7686;font-size:13px;">No punches today.</p>';
    }

    function clockToggle() {
        const emp = clockSelectedEmp(); if (!emp) { alert('Pick an employee first.'); return; }
        if (window._clockBusy) return;
        const open = clockState.status && clockState.status.open_punch;
        const loc = document.getElementById('clockLocSelect').value;
        withPin(function(pin){
            if (window._clockBusy) return; window._clockBusy = true; var _clkDone=function(){ window._clockBusy=false; }; setTimeout(_clkDone, 8000);
            const rpc = open ? 'app_clock_out' : 'app_clock_in';
            const params = open ? { p_username: currentUser.username, p_password: pin, p_employee_id: emp }
                                : { p_username: currentUser.username, p_password: pin, p_employee_id: emp, p_location: loc };
            supabaseClient.rpc(rpc, params).then(({ data, error }) => {
                _clkDone();
                if (error) { alert('Error: ' + error.message); return; }
                if (data && data.ok === false) { alert(data.error || 'Could not complete.'); }
                clockRefreshStatus();
            });
        });
    }

    function clockBreakToggle() {
        const emp = clockSelectedEmp(); if (!emp) return;
        const onBreak = clockState.status && clockState.status.open_punch && clockState.status.open_punch.open_break_start;
        withPin(function(pin){
            const rpc = onBreak ? 'app_break_end' : 'app_break_start';
            supabaseClient.rpc(rpc, { p_username: currentUser.username, p_password: pin, p_employee_id: emp })
            .then(({ data, error }) => { if (error) { alert('Error: ' + error.message); return; } if (data && data.ok === false) { alert(data.error); } clockRefreshStatus(); });
        });
    }

    // ============================================================
    // TIMESHEETS & LIVE BOARD (Phase 2b) - managers
    // ============================================================
    let tsRows = [];

    function openLiveBoard() {
        triggerTransition(() => {
            document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
            document.getElementById('liveClockView').style.display = 'block';
            loadLiveBoard();
        });
    }
    function loadLiveBoard() {
        const c = document.getElementById('liveBoard');
        c.innerHTML = '<p style="text-align:center;color:#6b7686;padding:20px;">Loading&hellip;</p>';
        withPin(function(pin){
            supabaseClient.rpc('app_clock_live', { p_username: currentUser.username, p_password: pin })
            .then(({ data, error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if (error) { c.innerHTML = '<p style="color:red;text-align:center;">' + error.message + '</p>'; return; }
                const list = data || [];
                if (!list.length) { c.innerHTML = '<p style="text-align:center;color:#6b7686;padding:20px;">Nobody is clocked in right now.</p>'; return; }
                c.innerHTML = list.map(function(p){
                    const hrs = (p.minutes/60).toFixed(2);
                    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border:1px solid #e5e5e5;border-left:5px solid '+(p.on_break?'#e67e22':'#16a34a')+';border-radius:10px;margin-bottom:8px;"><div><div style="font-weight:bold;">'+escapeHtml(p.employee)+(p.flagged?' &#9888;':'')+'</div><div style="font-size:12px;color:#6b7686;">'+escapeHtml(p.location||'')+' &bull; since '+p.since+'</div></div><div style="text-align:right;"><div style="font-weight:900;color:var(--caliches-blue);">'+hrs+' h</div>'+(p.on_break?'<div style="font-size:11px;color:#e67e22;font-weight:bold;">ON BREAK</div>':'')+'</div></div>';
                }).join('');
            });
        });
    }

    function tsDefaultRange() {
        const to = new Date(); const from = new Date(); from.setDate(from.getDate()-13);
        const f = document.getElementById('tsFrom'), t = document.getElementById('tsTo');
        if (f && !f.value) f.value = schedFmt(from);
        if (t && !t.value) t.value = schedFmt(to);
    }
    function openTimesheets() {
        triggerTransition(() => {
            document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
            document.getElementById('timesheetsView').style.display = 'block';
            tsDefaultRange();
            loadTimesheet();
        });
    }
    function loadTimesheet() {
        const from = document.getElementById('tsFrom').value, to = document.getElementById('tsTo').value;
        if (!from || !to) { alert('Pick a date range.'); return; }
        const tbl = document.getElementById('timesheetTable'); const sum = document.getElementById('timesheetSummary');
        tbl.innerHTML = '<p style="text-align:center;color:#6b7686;padding:20px;">Loading&hellip;</p>'; sum.innerHTML = '';
        withPin(function(pin){
            supabaseClient.rpc('app_timesheet', { p_username: currentUser.username, p_password: pin, p_start: from, p_end: to })
            .then(({ data, error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if (error) { tbl.innerHTML = '<p style="color:red;">' + error.message + '</p>'; return; }
                const d = data || {}; tsRows = d.rows || [];
                let warn = '';
                if (d.open_count) warn += '<span style="background:#fff3cd;color:#854F0B;padding:4px 10px;border-radius:99px;font-size:12px;font-weight:bold;margin-right:8px;">&#9888; '+d.open_count+' open punch(es) &mdash; not clocked out</span>';
                if (d.flagged_count) warn += '<span style="background:#fdecea;color:#c0392b;padding:4px 10px;border-radius:99px;font-size:12px;font-weight:bold;">&#9873; '+d.flagged_count+' flagged</span>';
                sum.innerHTML = warn ? '<div style="margin-bottom:12px;">'+warn+'</div>' : '';
                if (!tsRows.length) { tbl.innerHTML = '<p style="text-align:center;color:#6b7686;padding:20px;">No hours in this range.</p>'; return; }
                let tot = 0, totOt = 0;
                let h = '<div style="overflow-x:auto;"><table class="sched-table"><thead><tr><th class="sched-emp">Employee</th><th>Regular</th><th>OT</th><th>Total</th><th></th></tr></thead><tbody>';
                tsRows.forEach(function(r){
                    tot += r.total_hours; totOt += r.ot_hours;
                    h += '<tr><td class="sched-emp">'+escapeHtml(r.name)+'</td><td style="text-align:center;">'+r.regular_hours.toFixed(2)+'</td><td style="text-align:center;color:'+(r.ot_hours>0?'#c0392b':'#333')+';font-weight:'+(r.ot_hours>0?'bold':'normal')+';">'+r.ot_hours.toFixed(2)+'</td><td style="text-align:center;font-weight:bold;">'+r.total_hours.toFixed(2)+'</td><td style="text-align:center;"><button class="update-action-btn" onclick="openPunchEditor('+r.employee_id+')">Punches</button></td></tr>';
                });
                h += '</tbody><tfoot><tr><td class="sched-emp">Totals</td><td></td><td style="text-align:center;color:#c0392b;font-weight:bold;">'+totOt.toFixed(2)+'</td><td style="text-align:center;font-weight:900;">'+tot.toFixed(2)+'</td><td></td></tr></tfoot></table></div>';
                tbl.innerHTML = h;
            });
        });
    }
    function downloadTimesheetCSV() {
        if (!tsRows.length) { alert('Load a timesheet first.'); return; }
        const from = document.getElementById('tsFrom').value, to = document.getElementById('tsTo').value;
        let csv = 'Employee,Regular Hours,OT Hours,Total Hours\n';
        tsRows.forEach(function(r){ csv += '"'+(r.name||'').replace(/"/g,'""')+'",'+r.regular_hours+','+r.ot_hours+','+r.total_hours+'\n'; });
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'timesheet_'+from+'_to_'+to+'.csv'; a.click();
    }

    function openPunchEditor(empId) {
        const r = tsRows.find(function(x){ return x.employee_id === empId; });
        document.getElementById('punchModalTitle').innerText = 'Punches — ' + (r ? r.name : '');
        document.getElementById('punchModal').style.display = 'flex';
        loadPunchList(empId);
    }
    function loadPunchList(empId) {
        const from = document.getElementById('tsFrom').value, to = document.getElementById('tsTo').value;
        const c = document.getElementById('punchList');
        c.innerHTML = '<p style="color:#6b7686;">Loading&hellip;</p>';
        withPin(function(pin){
            supabaseClient.rpc('app_punch_list', { p_username: currentUser.username, p_password: pin, p_employee_id: empId, p_start: from, p_end: to })
            .then(({ data, error }) => {
                if (error) { c.innerHTML = '<p style="color:red;">' + error.message + '</p>'; return; }
                const list = data || [];
                if (!list.length) { c.innerHTML = '<p style="color:#6b7686;">No punches in this range.</p>'; return; }
                c.innerHTML = list.map(function(p){
                    const io = 'p' + p.id;
                    return '<div style="border:1px solid #eee;border-radius:10px;padding:10px;margin-bottom:10px;font-size:13px;">'
                      + (p.flagged ? '<div style="color:#c0392b;font-size:11px;margin-bottom:4px;">&#9888; '+escapeHtml(p.flag_reason||'flagged')+'</div>' : '')
                      + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">In <input type="date" id="'+io+'_id" value="'+(p.in_date||'')+'" style="padding:5px;border:1px solid #ccc;border-radius:6px;"> <input type="time" id="'+io+'_it" value="'+(p.in_time||'')+'" style="padding:5px;border:1px solid #ccc;border-radius:6px;"></div>'
                      + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;">Out <input type="date" id="'+io+'_od" value="'+(p.out_date||'')+'" style="padding:5px;border:1px solid #ccc;border-radius:6px;"> <input type="time" id="'+io+'_ot" value="'+(p.out_time||'')+'" style="padding:5px;border:1px solid #ccc;border-radius:6px;"></div>'
                      + '<div style="margin-top:6px;"><input type="text" id="'+io+'_r" placeholder="reason for edit" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;"></div>'
                      + '<div style="display:flex;gap:6px;margin-top:8px;"><button class="update-action-btn" onclick="savePunch('+p.id+','+empId+')">Save</button><button class="update-action-btn" style="background:var(--fail-red);" onclick="deletePunch('+p.id+','+empId+')">Delete</button>'
                      + (p.edited_by ? '<span style="font-size:11px;color:#6b7686;align-self:center;">edited by '+escapeHtml(p.edited_by)+'</span>' : '') + '</div></div>';
                }).join('');
            });
        });
    }
    function savePunch(id, empId) {
        const io = 'p' + id;
        const inD = document.getElementById(io+'_id').value, inT = document.getElementById(io+'_it').value;
        const outD = document.getElementById(io+'_od').value, outT = document.getElementById(io+'_ot').value;
        const reason = document.getElementById(io+'_r').value;
        if (!inD || !inT) { alert('Clock-in date & time required.'); return; }
        const pIn = inD + ' ' + inT;
        const pOut = (outD && outT) ? (outD + ' ' + outT) : '';
        if(pOut && new Date(pOut.replace(' ','T')) <= new Date(pIn.replace(' ','T'))){ alert('Clock-out must be after clock-in.'); return; }
        withPin(function(pin){
            supabaseClient.rpc('app_punch_edit', { p_username: currentUser.username, p_password: pin, p_id: id, p_in: pIn, p_out: pOut, p_reason: reason })
            .then(({ data, error }) => { if (error) { alert('Error: ' + error.message); return; } if (data && data.ok === false) { alert(data.error); return; } loadPunchList(empId); loadTimesheet(); });
        });
    }
    function deletePunch(id, empId) {
        if (!confirm('Delete this punch?')) return;
        withPin(function(pin){
            supabaseClient.rpc('app_punch_delete', { p_username: currentUser.username, p_password: pin, p_id: id })
            .then(({ error }) => { if (error) { alert('Error: ' + error.message); return; } loadPunchList(empId); loadTimesheet(); });
        });
    }

    function openForm(formId) { triggerTransition(() => { document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none'); document.getElementById(formId).style.display = 'block'; }); }

    function openPopIn() {
        if (!isMgmt()) { alert('Store Pop-In Inspections are for management only.'); return; }
        triggerTransition(() => {
            document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
            document.getElementById('popInView').style.display = 'block';
            setTimeout(checkForDraft, 300);
        });
    }

    function openDashboard() {
        triggerTransition(() => {
            document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
            document.getElementById('managerView').style.display = 'block';
            fetchDashboard('Pop-Ins', document.querySelector('.dash-tab'));
        });
    }

    /* ===== MERGED DASHBOARDS SCREEN (Phase 2) =====
       One tile → five tabs. Light wrapper only: each tab calls the EXISTING dashboard
       open function into its existing container/overlay (nothing rewritten). A tab shows
       only if its legacy tile (hidden in #legacyDashTiles) is allowed by applyRoleUI /
       per-user permissions — the legacy tiles stay the single source of role truth.
       Deep-linkable: openDashboards('live'|'command'|'manager'|'scorecards'|'maint'). */
    var DASH_TABS=[
        { k:'live',       emoji:'&#128225;', short:'Live',       title:'Live Dashboard',      btn:'adminDashBtn',     desc:'NCR Pulse net sales, labor &amp; transactions per store, plus vending routes &amp; catering.', go:function(){ openAdminDash(); } },
        { k:'command',    emoji:'&#128202;', short:'Command',    title:'Command Center',      btn:'commandCenterBtn', desc:'Who is on the clock right now, hours today &amp; this week, and open tasks.', go:function(){ openCommandCenter(); } },
        { k:'manager',    emoji:'&#128200;', short:'Manager',    title:'Manager Dashboard',   btn:'managerBtn',       desc:'Submitted forms &amp; activity: pop-ins, checklists, temp logs &amp; more.', go:function(){ openDashboard(); } },
        { k:'scorecards', emoji:'&#127978;', short:'Scorecards', title:'Store Scorecards',    btn:'btn-scorecards',   desc:'Per-store scorecard: sales vs last year, labor, speed, inspection &amp; training.', go:function(){ openScorecards(); } },
        { k:'maint',      emoji:'&#128295;', short:'Maintenance', title:'Maintenance Leadership', btn:'btn-maintDash', desc:'Open work orders, costs by store &amp; vendor spend for leadership.', go:function(){ openMaintDashboard(); } }
    ];
    function dashTabAllowed(t){ var b=document.getElementById(t.btn); return !!(b && b.style.display!=='none'); }
    function dashAnyAllowed(){ for(var i=0;i<DASH_TABS.length;i++){ if(dashTabAllowed(DASH_TABS[i])) return true; } return false; }
    function renderDashTabs(active){
        var bar=document.getElementById('dashTabsBar'), body=document.getElementById('dashBody');
        if(!bar || !body) return;
        var tabs=DASH_TABS.filter(dashTabAllowed);
        if(!tabs.length){ bar.innerHTML=''; body.innerHTML='<p style="text-align:center;color:#6b7686;padding:24px;">No dashboards are available for your role.</p>'; return; }
        bar.innerHTML=tabs.map(function(t){ return '<button class="sgb'+(t.k===active?' on':'')+'" style="flex:1 1 30%;min-width:104px;" onclick="dashGo(\''+t.k+'\')">'+t.emoji+' '+t.short+'</button>'; }).join('');
        body.innerHTML='<p style="font-size:12.5px;color:#6b7686;margin:2px 2px 12px;">All your dashboards in one place &mdash; pick one. It opens full-screen; tap Back to return here.</p>'+
            tabs.map(function(t){
                return '<button onclick="dashGo(\''+t.k+'\')" style="display:flex;width:100%;align-items:center;gap:12px;text-align:left;background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px 15px;margin-bottom:8px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.04);">'+
                    '<span style="font-size:22px;">'+t.emoji+'</span>'+
                    '<span style="flex:1;"><b style="font-size:14.5px;color:#26242b;display:block;">'+t.title+'</b><small style="color:#6b6275;font-size:12px;">'+t.desc+'</small></span>'+
                    '<span style="color:#aab;font-size:20px;">&rsaquo;</span></button>';
            }).join('');
    }
    function dashGo(k){
        var t=null; for(var i=0;i<DASH_TABS.length;i++){ if(DASH_TABS[i].k===k){ t=DASH_TABS[i]; break; } }
        if(!t || !dashTabAllowed(t)) return;
        renderDashTabs(k);
        try{ t.go(); }catch(e){}
    }
    function openDashboards(tab){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        var v=document.getElementById('dashboardsView'); if(v) v.style.display='block';
        window.scrollTo(0,0);
        renderDashTabs(tab||null);
        if(tab) dashGo(tab);
    }

    function openTrainingPortal() {
        document.getElementById('main-menu').style.display = 'none';
        document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
        document.getElementById('trainingPortalView').style.display = 'block';
        window.scrollTo(0,0);
        loadTraining();
        var _lp=document.getElementById('lmsPreviewBtn'); if(_lp) _lp.style.display='block';
    }

    // ============================================================
    // ROLE-BASED UI / MAINTENANCE BOARD
    // ============================================================
    function applyRoleUI() {
        let role = currentUser.role;
        if (role === 'Vice President/Co-Owner') role = 'Admin Manager';
        const isManager = (role === 'Admin Manager' || role === 'Manager' || role === 'Store Manager' || role === 'Vice President/Co-Owner');
        const maintBoardAllowed = (currentUser.maint_board_access !== false);
        const devOverride = currentUser.is_developer === true && !isPreviewMode();

        // ── Show/hide Management tab for managers ──
        const mgmtTab = document.getElementById('tab-management');
        if (mgmtTab) mgmtTab.style.display = permAllow('mgmt_tab', (devOverride || isManager)) ? 'flex' : 'none';

        // ── Buttons within Management tab ──
        const commandCenterBtn = document.getElementById('commandCenterBtn');
        if (commandCenterBtn) commandCenterBtn.style.display = permAllow('command_center', (devOverride || isManager)) ? 'block' : 'none';
        const adminDashBtn = document.getElementById('adminDashBtn');
        if (adminDashBtn) adminDashBtn.style.display = permAllow('admin_dash', (devOverride || role === 'Admin Manager')) ? 'block' : 'none';
        var _adminConsoleBtn = document.getElementById('btn-admin-console'); if (_adminConsoleBtn) _adminConsoleBtn.style.display = permAllow('admin_console', (devOverride || role === 'Admin Manager' || role === 'Vice President/Co-Owner')) ? 'block' : 'none';
        var _permMxBtn=document.getElementById('btn-permMatrix'); if(_permMxBtn) _permMxBtn.style.display=(devOverride || role === 'Admin Manager' || role === 'Vice President/Co-Owner') ? 'block' : 'none';
        const salesBtn = document.getElementById('salesBtn');
        if (salesBtn) salesBtn.style.display = permAllow('sales', (devOverride || isManager)) ? 'block' : 'none';
        const primeCostBtn = document.getElementById('primeCostBtn');
        if (primeCostBtn) primeCostBtn.style.display = permAllow('prime_cost', (devOverride || isManager)) ? 'block' : 'none';
        const requestsBtn = document.getElementById('requestsBtn');
        if (requestsBtn) requestsBtn.style.display = permAllow('requests', (devOverride || isManager)) ? 'block' : 'none';
        const assignTaskBtn = document.getElementById('assignTaskBtn');
        if (assignTaskBtn) assignTaskBtn.style.display = permAllow('assign_task', (devOverride || isManager)) ? 'block' : 'none';
        // ── Disciplinary Actions: Shift Lead and above ──
        const disciplineBtn = document.getElementById('btn-discipline');
        if (disciplineBtn) disciplineBtn.style.display = permAllow('discipline', (devOverride || isManager || role === 'Shift Lead')) ? 'block' : 'none';
        const attendanceBtn = document.getElementById('btn-attendance');
        if (attendanceBtn) attendanceBtn.style.display = permAllow('attendance', (devOverride || isManager || role === 'Shift Lead')) ? 'block' : 'none';
        const preshiftBtn = document.getElementById('btn-preshift');
        if (preshiftBtn) preshiftBtn.style.display = permAllow('preshift', (devOverride || isManager || role === 'Shift Lead')) ? 'block' : 'none';
        const crewTrainerBtn = document.getElementById('btn-crewtrainer');
        if (crewTrainerBtn) crewTrainerBtn.style.display = permAllow('crew_trainer', (devOverride || isManager || role === 'Shift Lead' || /trainer/i.test(currentUser.role||''))) ? 'block' : 'none';
        const availApprBtn = document.getElementById('btn-availApprovals');
        if (availApprBtn) availApprBtn.style.display = permAllow('avail_approvals', (devOverride || isManager || role === 'Shift Lead')) ? 'block' : 'none';
        // ── Pop-In & Inventory: management only (Shift Lead and above / store managers) ──
        const mgmtTools = (devOverride || isManager || role === 'Shift Lead');
        const popInBtn = document.getElementById('btn-popIn');
        if (popInBtn) popInBtn.style.display = permAllow('popin', mgmtTools) ? 'block' : 'none';
        const inventoryBtn = document.getElementById('btn-inventory');
        if (inventoryBtn) inventoryBtn.style.display = permAllow('inventory', mgmtTools) ? 'block' : 'none';
        if (typeof refreshMyStores === 'function') refreshMyStores();
        document.getElementById('managerBtn').style.display = permAllow('manager_admin', (devOverride || role === 'Admin Manager')) ? 'block' : 'none';
        const kbBtn = document.getElementById('knowledgeBaseBtn');
        if (kbBtn) kbBtn.style.display = permAllow('knowledge_base', (devOverride || role === 'Admin Manager')) ? 'block' : 'none';
        const rosterBtn = document.getElementById('rosterBtn');
        if (rosterBtn) rosterBtn.style.display = permAllow('roster', (devOverride || role === 'Admin Manager')) ? 'block' : 'none';
        const celebrationsBtn = document.getElementById('celebrationsBtn');
        if (celebrationsBtn) celebrationsBtn.style.display = permAllow('celebrations', (devOverride || isManager || role === 'Shift Lead')) ? 'block' : 'none';
        const shortageTrendsBtn = document.getElementById('shortageTrendsBtn');
        if (shortageTrendsBtn) shortageTrendsBtn.style.display = permAllow('shortage_trends', (devOverride || isManager)) ? 'block' : 'none';
        var _teamDevBtn=document.getElementById('teamDevBtn'); if(_teamDevBtn) _teamDevBtn.style.display=permAllow('team_dev', (devOverride||isManager))?'block':'none';
        var _frBtn=document.getElementById('btn-fundraiserHub'); if(_frBtn) _frBtn.style.display=permAllow('fundraiser', (devOverride||isManager))?'block':'none';
        var _mktBtn=document.getElementById('btn-marketingHub'); if(_mktBtn) _mktBtn.style.display=permAllow('marketing', (devOverride||isManager||['Vice President/Co-Owner','Store Manager','Marketing Manager','Designer/Creative'].indexOf(role)>=0))?'block':'none';
        var _asBtn=document.getElementById('tileAppSettings'); if(_asBtn) _asBtn.style.display=(devOverride||isManager||role==='Admin Manager'||role==='Vice President/Co-Owner')?'block':'none';
        var _mbBtn=document.getElementById('btn-maintBilling'); if(_mbBtn) _mbBtn.style.display=permAllow('maint_billing', (devOverride||isManager||['Vice President/Co-Owner','Store Manager','Finance Approver','Maintenance Lead'].indexOf(role)>=0))?'block':'none';
        var _smBtn=document.getElementById('btn-storeManager'); if(_smBtn) _smBtn.style.display=permAllow('store_manager', (devOverride||isManager||['Vice President/Co-Owner','Store Manager'].indexOf(role)>=0))?'block':'none';
        var _scBtn=document.getElementById('btn-scorecards'); if(_scBtn) _scBtn.style.display=permAllow('scorecards', (devOverride||isManager||['Vice President/Co-Owner','Store Manager'].indexOf(role)>=0))?'block':'none';
        var _catBtn=document.getElementById('btn-catering'); if(_catBtn) _catBtn.style.display=permAllow('catering', (devOverride||isManager||['Vice President/Co-Owner','Store Manager'].indexOf(role)>=0))?'block':'none';
        var _mdBtn=document.getElementById('btn-maintDash'); if(_mdBtn) _mdBtn.style.display=permAllow('maint_dash', (devOverride||isManager||['Vice President/Co-Owner','Store Manager','Finance Approver','Maintenance Lead'].indexOf(role)>=0))?'block':'none';
        /* Merged Dashboards tile: visible when ANY of the five legacy dashboard tiles is allowed (they stay the role truth). */
        var _dashBtn=document.getElementById('btn-dashboards'); if(_dashBtn) _dashBtn.style.display=(typeof dashAnyAllowed==='function'&&dashAnyAllowed())?'block':'none';
        const formsLinksBtn = document.getElementById('formsLinksBtn');
        if (formsLinksBtn) formsLinksBtn.style.display = permAllow('forms_links', (devOverride || isManager)) ? 'block' : 'none';
        const quotesBtn = document.getElementById('quotesBtn');
        if (quotesBtn) quotesBtn.style.display = ((typeof isManagerRole==='function'&&isManagerRole())||devOverride) ? 'block' : 'none';
        const salesPipelineBtn = document.getElementById('salesPipelineBtn');
        if (salesPipelineBtn) salesPipelineBtn.style.display = ((typeof isManagerRole==='function'&&isManagerRole())||devOverride) ? 'block' : 'none';
        document.getElementById('developerBtn').style.display = (currentUser.is_developer === true) ? 'block' : 'none';
        const futureIntegrations = document.getElementById('futureIntegrations');
        if (futureIntegrations) futureIntegrations.style.display = devOverride ? 'block' : 'none';

        // ── Buttons within Maintenance tab ──
        document.getElementById('maintBoardBtn').style.display = 'none'; /* retired: Work Orders replaces the Maintenance Board (kept in code, hidden) */
        var _vehBtn=document.getElementById('btn-vehicles'); if(_vehBtn) _vehBtn.style.display=((devOverride||isManager)&&maintBoardAllowed)?'block':'none'; /* Vehicles & Service: managers only, honors the old board's per-user access switch */
        var _woBtn=document.getElementById('btn-workorders'); if(_woBtn){ _woBtn.style.display='block'; /* Work Orders is now the single repair flow for all staff */ }
        document.getElementById('mySubmissionsBtn').style.display = (!devOverride && role === 'Maintenance') ? 'none' : 'block';

        // ── AI widget, announce, badge ──
        const aiWidget = document.getElementById('aiChatWidget');
        if (aiWidget) aiWidget.style.display = 'flex';
        const announceBtn = document.getElementById('announceBtn');
        if (announceBtn) announceBtn.style.display = permAllow('announce', (devOverride || isManager)) ? 'block' : 'none';
        if (devOverride || role === 'Admin Manager') {
            setTimeout(updateScoopyGapBadge, 500);
            setTimeout(renderScoopyTrainPrompt, 700);
        }
        const heroNameEl = document.getElementById('heroName');
        if (heroNameEl) heroNameEl.textContent = (currentUser.name || '').trim().split(' ')[0] || 'team';
        const quickAdminCard = document.getElementById('quickAdminCard');
        if (quickAdminCard) quickAdminCard.style.display = (devOverride || isManager) ? 'block' : 'none';
        const sectionsAdminCard = document.getElementById('sectionsAdminCard');
        if (sectionsAdminCard) sectionsAdminCard.style.display = (devOverride || isManager) ? 'block' : 'none';
        updateBioToggleBtn();
        updatePreviewToggleBtn();
    }

    function maintBoardBack() {
        if (currentUser.role === 'Maintenance') { logout(); } else { openMenu(); }
    }

    function openMaintenanceBoard() {
        triggerTransition(() => {
            document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
            document.getElementById('maintenanceBoardView').style.display = 'block';
            switchMaintTab('stores');
            fetchMaintenanceBoard();
            fetchVehicleMaintTracker();
        });
    }

    /* Vehicles & Service (Phase 2): opens the retired Maintenance Board DIRECTLY on its
       Vehicles pane — the vehicle service tracker was stranded when the board was retired.
       The stores pane stays loaded-but-hidden; nothing about the board is un-retired. */
    function openVehiclesService() {
        triggerTransition(() => {
            document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
            document.getElementById('maintenanceBoardView').style.display = 'block';
            switchMaintTab('vehicles');
            fetchVehicleMaintTracker();
            fetchMaintenanceBoard(); /* keep the stores pane truthful if a Maintenance-role user lands here */
        });
    }

    function switchMaintTab(which) {
        ['stores', 'vehicles'].forEach(t => {
            const btn = document.getElementById('maintTab-' + t);
            const panel = document.getElementById('maintPanel-' + t);
            if (btn) btn.classList.toggle('active', t === which);
            if (panel) panel.style.display = (t === which) ? 'block' : 'none';
        });
    }

    // ============================================================
    // VEHICLE MAINTENANCE TRACKER (mileage-based due dates)
    // ============================================================
    let vmtMileageByVehicle = {};
    let vmtScheduleById = {};

    function fetchVehicleMaintTracker() {
        const container = document.getElementById('vehicleMaintTracker');
        if (!container) return;
        const isManager = (currentUser.role === 'Admin Manager' || currentUser.role === 'Manager' || currentUser.role === 'Vice President/Co-Owner');
        const canEdit = (currentUser.role === 'Maintenance' || isManager);
        container.innerHTML = '<p style="text-align:center;padding:10px;color:#6b7686;font-size:13px;">Loading vehicle maintenance...</p>';
        withPin(function(pin) {
        supabaseClient.rpc('app_vehicle_tracker_data', { p_username: currentUser.username, p_password: pin })
        .then(({ data, error }) => {
            if (error && error.code === '42501') sessionPin = null;
            if (error || !data || !data.schedule) { container.innerHTML = ''; return; }
            vmtMileageByVehicle = data.mileage || {};
            vmtScheduleById = {};
            const byVehicle = {};
            data.schedule.forEach(row => {
                vmtScheduleById[row.id] = row;
                if (!byVehicle[row.vehicle]) byVehicle[row.vehicle] = [];
                byVehicle[row.vehicle].push(row);
            });
            let html = '<h2 style="margin:0 0 10px 0;color:var(--caliches-blue);font-size:16px;">&#128663; Vehicle Maintenance Tracker</h2>';
            Object.keys(byVehicle).forEach(vehicle => {
                const currentMileage = vmtMileageByVehicle[vehicle];
                html += '<div class="vmt-card">';
                html += '<div class="vmt-title">' + escapeHtml(vehicle) + '</div>';
                html += '<div class="vmt-mileage">Current Mileage: ' + (currentMileage != null ? currentMileage.toLocaleString() + ' mi (from latest driver log)' : 'No mileage logged yet') + '</div>';
                byVehicle[vehicle].forEach(item => {
                    let statusChip, statusColor, remainText = '';
                    if (item.last_service_mileage == null || currentMileage == null) {
                        statusColor = '#999'; statusChip = 'Not Set';
                    } else {
                        const dueAt = item.last_service_mileage + item.interval_miles;
                        const remaining = dueAt - currentMileage;
                        if (remaining <= 0) { statusColor = 'var(--fail-red)'; statusChip = 'Overdue'; }
                        else if (remaining <= 500) { statusColor = 'var(--maint-orange)'; statusChip = 'Due Soon'; }
                        else { statusColor = 'var(--pass-green)'; statusChip = 'OK'; }
                        remainText = (remaining >= 0 ? Math.round(remaining).toLocaleString() + ' mi left' : Math.abs(Math.round(remaining)).toLocaleString() + ' mi over');
                    }
                    html += '<div class="vmt-row">';
                    html += '<div><strong>' + escapeHtml(item.service_type) + '</strong><br><span style="color:#6b7686;font-size:11px;">Every ' + item.interval_miles.toLocaleString() + ' mi' + (item.last_service_mileage != null ? ' &bull; last serviced at ' + item.last_service_mileage.toLocaleString() + ' mi' : '') + '</span></div>';
                    html += '<div style="display:flex;align-items:center;gap:8px;">';
                    if (remainText) html += '<span style="font-size:11px;color:#6b7686;">' + remainText + '</span>';
                    html += '<span class="vmt-chip" style="background:' + statusColor + ';">' + statusChip + '</span>';
                    if (canEdit) html += '<button class="vmt-set-btn" onclick="markServiceDone(' + item.id + ')">Mark Serviced</button>';
                    html += '</div></div>';
                });
                html += '</div>';
            });
            container.innerHTML = html;
        }).catch(() => { container.innerHTML = ''; });
        }, function() { container.innerHTML = ''; });
    }

    function markServiceDone(scheduleId) {
        const data = vmtScheduleById[scheduleId];
        if (!data) { alert('Error: could not load item.'); return; }
        const currentMileage = vmtMileageByVehicle[data.vehicle];
        const defaultMileage = currentMileage != null ? currentMileage : 0;
        const input = prompt('Mark "' + data.service_type + '" for ' + data.vehicle + ' as serviced at what mileage?', defaultMileage);
        if (input === null) return;
        const mileage = parseInt(input, 10);
        if (isNaN(mileage)) { alert('Please enter a valid mileage.'); return; }
        const today = new Date().toISOString().split('T')[0];
        withPin(function(pin) {
            supabaseClient.rpc('app_vehicle_mark_serviced', { p_username: currentUser.username, p_password: pin, p_schedule_id: scheduleId, p_mileage: mileage, p_date: today })
            .then(({ error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if (error) alert('Error: ' + error.message); else fetchVehicleMaintTracker();
            });
        });
    }

    function fetchMaintenanceBoard() {
        const container = document.getElementById('maintBoardResults');
        const isManager = (currentUser.role === 'Admin Manager' || currentUser.role === 'Manager' || currentUser.role === 'Vice President/Co-Owner');
        const canEditTech = (currentUser.role === 'Maintenance' || isManager);
        container.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">Loading maintenance board...</p>';
        withPin(function(pin) {
        supabaseClient.rpc('app_maintboard_list', { p_username: currentUser.username, p_password: pin })
        .then(({ data, error }) => {
            if (error && error.code === '42501') sessionPin = null;
            if (error || !data) { container.innerHTML = '<p style="color:red;">Error loading board: ' + (error ? error.message : 'no data') + '</p>'; return; }
            data = data.filter(row => (row.Status || 'Pending') !== 'Resolved');
            if (!data.length) { container.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">No open maintenance tickets. Great job! &#127881;</p>'; return; }
            // Sort by manager-set priority (Critical=1 first), then by deadline, then report date
            data.sort(function(a, b) {
                var ra = parseInt(a.priority_rank, 10) || 3, rb = parseInt(b.priority_rank, 10) || 3;
                if (ra !== rb) return ra - rb;
                var da = a.deadline || '9999-12-31', db = b.deadline || '9999-12-31';
                if (da !== db) return da < db ? -1 : 1;
                return (a.ReportDate || '') < (b.ReportDate || '') ? -1 : 1;
            });
            const todayStr = new Date().toISOString().split('T')[0];
            let brokenHtml = '', pmHtml = '', pmCount = 0;
            data.forEach((row, idx) => {
                var _isPM = (row.ReporterName||'').indexOf('Preventive Maintenance') >= 0;
                var html = '';
                let status = row.Status || 'Pending';
                let urgency = row.Urgency || '';
                let urgColor = urgency.indexOf('High') !== -1 ? 'var(--damage-red)' : (urgency.indexOf('Medium') !== -1 ? 'var(--maint-orange)' : 'var(--pass-green)');
                let overdue = row.deadline && status !== 'Resolved' && row.deadline < todayStr;
                let statusColor = status === 'Resolved' ? 'var(--pass-green)' : (status === 'In Progress' ? 'var(--caliches-blue)' : '#999');
                html += '<div class="maint-card" style="border-left-color:' + (overdue ? 'var(--fail-red)' : urgColor) + ';">';
                html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">';
                html += '<div><div class="maint-card-title">' + escapeHtml(row.MaintenanceItem) + '</div><div class="maint-card-meta">' + escapeHtml(row.Location) + ' &bull; ' + escapeHtml(row.ReportDate) + ' &bull; by ' + escapeHtml(row.ReporterName || row.submitted_by) + '</div></div>';
                if (isAdminManager()) {
                    var pr = parseInt(row.priority_rank, 10) || 3;
                    html += '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">';
                    html += '<label style="font-size:9px;font-weight:bold;color:#6b7686;text-transform:uppercase;letter-spacing:0.5px;">Priority</label>';
                    html += '<select class="maint-prio-select" onchange="setMaintPriorityLevel(' + row.id + ',this.value)">';
                    [[1, '🔴 Critical'], [2, '🟠 High'], [3, '🔵 Normal'], [4, '⚪ Low']].forEach(function(o) {
                        html += '<option value="' + o[0] + '"' + (pr === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
                    });
                    html += '</select></div>';
                }
                html += '</div>';
                html += '<p class="maint-card-desc">' + escapeHtml(row.IssueDescription) + '</p>';
                html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">';
                var pm = maintPrioMeta(row.priority_rank);
                html += '<span class="urgency-chip" style="background:' + pm.color + ';">&#9733; ' + pm.label + '</span>';
                html += '<span class="urgency-chip" style="background:' + urgColor + ';">' + escapeHtml(urgency) + '</span>';
                if (overdue) html += '<span class="overdue-chip">&#9888; Overdue</span>';
                html += '</div>';
                html += '<div style="display:flex;gap:6px;margin-bottom:10px;">';
                ['Pending', 'In Progress', 'Resolved'].forEach(s => {
                    html += '<button class="status-btn' + (status === s ? ' active' : '') + '" style="' + (status === s ? ('background:' + statusColor + ';color:white;') : '') + '" onclick="updateMaintStatus(' + row.id + ',\'' + s + '\')">' + s + '</button>';
                });
                html += '</div>';
                if ((row.ReporterName||'').indexOf('Preventive Maintenance') >= 0) {
                    html += '<div style="margin-bottom:10px;"><button class="update-action-btn" style="background:var(--pass-green,#1f7a3d);color:#fff;font-weight:700;" onclick="maintPmDone(' + row.id + ')">&#9989; Mark PM done &amp; roll next service date</button><div style="font-size:11px;color:#6b7686;margin-top:3px;">Auto-created from the equipment&rsquo;s preventive-maintenance schedule.</div></div>';
                }
                if (isManager) {
                    html += '<div style="font-size:12px;margin-bottom:10px;"><label style="font-weight:bold;color:#555;display:block;margin-bottom:4px;">Deadline:</label><input type="date" value="' + (row.deadline || '') + '" onchange="updateMaintDeadline(' + row.id + ',this.value)" style="padding:6px;border-radius:6px;border:1px solid #ccc;font-size:13px;"></div>';
                } else if (row.deadline) {
                    html += '<div style="font-size:12px;margin-bottom:10px;color:#555;"><strong>Deadline:</strong> ' + escapeHtml(row.deadline) + (overdue ? ' <span style="color:var(--fail-red);font-weight:bold;">(Overdue)</span>' : '') + '</div>';
                }
                if (isManager) {
                    html += '<div style="margin-bottom:10px;"><label style="font-size:12px;font-weight:bold;color:#555;display:block;margin-bottom:4px;">Manager Instructions:</label><textarea rows="2" id="mgrnotes-' + row.id + '" class="maint-note-box" placeholder="Instructions for the maintenance tech...">' + escapeHtml(row.manager_notes || '') + '</textarea><button class="update-action-btn" style="margin-top:5px;" onclick="saveMaintNote(' + row.id + ',\'manager_notes\',\'mgrnotes-' + row.id + '\')">Save</button></div>';
                } else if (row.manager_notes) {
                    html += '<div class="maint-readonly-note"><strong>Manager Notes:</strong> ' + escapeHtml(row.manager_notes) + '</div>';
                }
                if (canEditTech) {
                    html += '<div><label style="font-size:12px;font-weight:bold;color:#555;display:block;margin-bottom:4px;">Tech Notes:</label><textarea rows="2" id="technotes-' + row.id + '" class="maint-note-box" placeholder="Notes from maintenance...">' + escapeHtml(row.tech_notes || '') + '</textarea><button class="update-action-btn" style="margin-top:5px;" onclick="saveMaintNote(' + row.id + ',\'tech_notes\',\'technotes-' + row.id + '\')">Save</button></div>';
                } else if (row.tech_notes) {
                    html += '<div class="maint-readonly-note" style="background:#eef2fb;"><strong>Tech Notes:</strong> ' + escapeHtml(row.tech_notes) + '</div>';
                }
                html += '</div>';
                if (_isPM) { pmHtml += html; pmCount++; } else { brokenHtml += html; }
            });
            var out = brokenHtml;
            if (!out && pmCount) { out = '<p style="text-align:center;padding:16px;color:#6b7686;">No broken or reported items right now.</p>'; }
            if (pmCount) { out += '<div style="margin:14px 0 6px;"><button onclick="maintTogglePm(this)" style="width:100%;background:#eef2fb;border:1px solid #d6e0f0;border-radius:10px;padding:11px;font-weight:700;color:#185FA5;cursor:pointer;font-size:14px;">&#128295; Preventive maintenance (' + pmCount + ') &mdash; show / hide</button><div style="display:none;margin-top:8px;">' + pmHtml + '</div></div>'; }
            container.innerHTML = out;
        }).catch(() => { container.innerHTML = '<p style="color:red;">Connection error.</p>'; });
        }, function() { container.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">PIN required to load maintenance board.</p>'; });
    }

    function maintTogglePm(btn){ var d=btn.nextElementSibling; if(d){ d.style.display=(d.style.display==='none'?'block':'none'); } }

    function maintPmDone(id){
        if(!confirm('Mark this preventive-maintenance task done?\n\nIt logs the service and rolls the next due date forward.')) return;
        var notes=''; var ta=document.getElementById('technotes-'+id); if(ta) notes=ta.value;
        withPin(function(pin){
            supabaseClient.rpc('app_pm_ticket_done',{p_username:currentUser.username,p_password:pin,p_ticket_id:id,p_notes:notes||null}).then(function(r){
                if(r.error){ alert('Error: '+r.error.message); return; }
                fetchMaintenanceBoard();
            }).catch(function(){ alert('Could not complete the task.'); });
        });
    }
    function updateMaintStatus(id, status) {
        withPin(function(pin) {
            supabaseClient.rpc('app_maintboard_update_status', { p_username: currentUser.username, p_password: pin, p_id: id, p_status: status })
            .then(({ error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if (error) { alert('Error: ' + error.message); } else { fetchMaintenanceBoard(); }
            });
        });
    }

    function updateMaintDeadline(id, value) {
        withPin(function(pin) {
            supabaseClient.rpc('app_maintboard_update_deadline', { p_username: currentUser.username, p_password: pin, p_id: id, p_deadline: value || null })
            .then(({ error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if (error) { alert('Error: ' + error.message); } else { fetchMaintenanceBoard(); }
            });
        });
    }

    function saveMaintNote(id, field, textareaId) {
        const val = document.getElementById(textareaId).value;
        withPin(function(pin) {
            supabaseClient.rpc('app_maintboard_save_note', { p_username: currentUser.username, p_password: pin, p_id: id, p_field: field, p_value: val })
            .then(({ error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if (error) alert('Error: ' + error.message); else alert('Saved!');
            });
        });
    }

    // ============================================================
    // EMPLOYEE HOME + TIME-OFF + SHIFT-SWAPS
    // ============================================================
    var empHomeState = { shifts: [] };

    function openEmployeeHome() {
        document.getElementById('main-menu').style.display = 'none';
        document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
        document.getElementById('employeeHomeView').style.display = 'block';
        window.scrollTo(0, 0);
        loadEmployeeHome();
    }

    function loadEmployeeHome() {
        var c = document.getElementById('empHomeContent');
        c.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">Loading your info...</p>';
        withPin(function(pin) {
            supabaseClient.rpc('app_emp_home', { p_username: currentUser.username, p_password: pin }).then(function(res) {
                if (res.error) { if (res.error.code === '42501') sessionPin = null; c.innerHTML = '<p style="color:red;text-align:center;padding:20px;">Could not load: ' + escapeHtml(res.error.message) + '</p>'; return; }
                empHomeRender(res.data || {});
                if (res.data && res.data.linked) loadMyTasks('empTasksCard');
            }).catch(function() { c.innerHTML = '<p style="color:red;text-align:center;padding:20px;">Connection error.</p>'; });
        }, function() { c.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">PIN required.</p>'; });
    }

    function ehChip(status) {
        var s = (status || '').toLowerCase(), col = '#888';
        if (s === 'approved') col = 'var(--pass-green)';
        else if (s === 'pending' || s === 'open') col = 'var(--maint-orange)';
        else if (s === 'denied') col = 'var(--damage-red)';
        else if (s === 'cancelled') col = '#aaa';
        return '<span style="background:' + col + ';color:#fff;font-size:11px;font-weight:bold;padding:2px 8px;border-radius:10px;text-transform:uppercase;">' + escapeHtml(status || '') + '</span>';
    }

    function empHomeRender(d) {
        var c = document.getElementById('empHomeContent');
        if (!d || d.linked !== true) {
            c.innerHTML = '<div style="background:#fff;border-radius:12px;padding:24px;text-align:center;box-shadow:0 4px 6px rgba(0,0,0,0.05);">' +
                '<p style="font-size:15px;color:#444;margin:0 0 8px;">Your login isn\'t linked to your employee profile yet.</p>' +
                '<p style="font-size:13px;color:#6b7686;margin:0;">Ask a manager to link your account in the Employee Roster, then your shifts and requests will show up here.</p></div>';
            return;
        }
        empHomeState.shifts = d.shifts || [];
        var name = (d.employee && d.employee.name) ? d.employee.name : 'there';
        var html = '<div style="background:#fff;border-radius:12px;padding:18px;margin-bottom:14px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">' +
            '<h2 style="margin:0;color:var(--caliches-blue);font-size:20px;">Hi, ' + escapeHtml(name) + '! &#128075;</h2>' +
            (d.employee && d.employee.home_location ? '<p style="margin:4px 0 0;color:#6b7686;font-size:13px;">Home store: ' + escapeHtml(d.employee.home_location) + '</p>' : '') + '</div>';
        html += '<div id="empTasksCard"></div>';

        // PIP banner (own status, supportive tone)
        if (d.pip && d.pip.active) {
            html += '<div style="background:#fff7e6;border:1px solid #f0c36d;border-left:5px solid var(--maint-orange);border-radius:10px;padding:14px;margin-bottom:14px;">' +
                '<strong style="color:#b35000;">You\'re on a performance improvement plan</strong>' +
                (d.pip.end_date ? ' through <strong>' + escapeHtml(d.pip.end_date) + '</strong>' : '') +
                '.<br><span style="font-size:13px;color:#8a5a1a;">Your manager is here to help you succeed — reach out with any questions.</span></div>';
        }

        // Upcoming shifts
        html += '<div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">' +
            '<h3 style="margin:0 0 10px;color:var(--caliches-blue);font-size:16px;">&#128197; My Upcoming Shifts (next 2 weeks)</h3>';
        if (!empHomeState.shifts.length) {
            html += '<p style="color:#6b7686;font-size:13px;margin:0;">No published shifts scheduled.</p>';
        } else {
            empHomeState.shifts.forEach(function(s, i) {
                var lbl = s.date + '  ' + (s.start || '') + '-' + (s.end || '') + (s.location ? '  @ ' + s.location : '');
                html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;' + (i < empHomeState.shifts.length - 1 ? 'border-bottom:1px solid #eee;' : '') + '">' +
                    '<span style="font-size:14px;color:#333;">' + escapeHtml(lbl) + '</span>' +
                    '<button onclick="openSwap(' + s.id + ',' + i + ')" style="background:#0d6eaf;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:bold;cursor:pointer;white-space:nowrap;">Request cover</button></div>';
            });
        }
        html += '</div>';

        // Time off
        html += '<div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><h3 style="margin:0;color:var(--caliches-blue);font-size:16px;">&#127796; Time Off</h3>' +
            '<button onclick="openTimeOff()" style="background:var(--caliches-pink);color:#fff;border:none;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:bold;cursor:pointer;">+ Request</button></div>';
        var to = d.time_off || [];
        if (!to.length) { html += '<p style="color:#6b7686;font-size:13px;margin:0;">No time-off requests.</p>'; }
        else {
            to.forEach(function(t, i) {
                html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;' + (i < to.length - 1 ? 'border-bottom:1px solid #eee;' : '') + '">' +
                    '<span style="font-size:14px;color:#333;">' + escapeHtml(t.start) + ' → ' + escapeHtml(t.end) + (t.manager_note ? '<br><span style="font-size:12px;color:#6b7686;">Note: ' + escapeHtml(t.manager_note) + '</span>' : '') + '</span>' +
                    '<span style="white-space:nowrap;">' + ehChip(t.status) + (t.status === 'pending' ? ' <button onclick="cancelTimeOff(' + t.id + ')" style="background:#eee;border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">Cancel</button>' : '') + '</span></div>';
            });
        }
        html += '</div>';

        // Swaps
        html += '<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">' +
            '<h3 style="margin:0 0 10px;color:var(--caliches-blue);font-size:16px;">&#128260; My Shift Cover Requests</h3>';
        var sw = d.swaps || [];
        if (!sw.length) { html += '<p style="color:#6b7686;font-size:13px;margin:0;">No cover requests.</p>'; }
        else {
            sw.forEach(function(w, i) {
                html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;' + (i < sw.length - 1 ? 'border-bottom:1px solid #eee;' : '') + '">' +
                    '<span style="font-size:14px;color:#333;">' + escapeHtml(w.date || '') + '  ' + escapeHtml(w.start || '') + '-' + escapeHtml(w.end || '') + (w.manager_note ? '<br><span style="font-size:12px;color:#6b7686;">Note: ' + escapeHtml(w.manager_note) + '</span>' : '') + '</span>' + ehChip(w.status) + '</div>';
            });
        }
        html += '</div>';
        c.innerHTML = html;
    }

    // Time-off modal
    function openTimeOff() { document.getElementById('toStart').value=''; document.getElementById('toEnd').value=''; document.getElementById('toReason').value=''; document.getElementById('timeOffModal').style.display='flex'; }
    function closeTimeOff() { document.getElementById('timeOffModal').style.display='none'; }
    function saveTimeOff() {
        var st=document.getElementById('toStart').value, en=document.getElementById('toEnd').value, rs=document.getElementById('toReason').value;
        if(!st||!en){ alert('Please pick a start and end date.'); return; }
        if(en<st){ alert('End date can\'t be before the start date.'); return; }
        var btn=document.getElementById('toSubmitBtn'); btn.disabled=true; btn.innerText='Submitting...';
        withPin(function(pin){
            supabaseClient.rpc('app_time_off_create',{p_username:currentUser.username,p_password:pin,p_start:st,p_end:en,p_reason:rs}).then(function(res){
                btn.disabled=false; btn.innerText='Submit Request';
                if(res.error){ if(res.error.code==='42501') sessionPin=null; alert('Could not submit: '+res.error.message); return; }
                closeTimeOff(); loadEmployeeHome();
            }).catch(function(){ btn.disabled=false; btn.innerText='Submit Request'; alert('Connection error.'); });
        }, function(){ btn.disabled=false; btn.innerText='Submit Request'; });
    }
    function cancelTimeOff(id) {
        if(!confirm('Cancel this time-off request?')) return;
        withPin(function(pin){
            supabaseClient.rpc('app_time_off_cancel',{p_username:currentUser.username,p_password:pin,p_id:id}).then(function(res){
                if(res.error){ if(res.error.code==='42501') sessionPin=null; alert('Error: '+res.error.message); return; }
                loadEmployeeHome();
            });
        });
    }

    // Swap modal
    function openSwap(shiftId, idx) {
        var s = empHomeState.shifts[idx] || {};
        window._swapShiftId = shiftId;
        document.getElementById('swapShiftLabel').innerText = (s.date||'') + '  ' + (s.start||'') + '-' + (s.end||'') + (s.location ? '  @ '+s.location : '');
        document.getElementById('swapNote').value='';
        document.getElementById('swapModal').style.display='flex';
    }
    function closeSwap() { document.getElementById('swapModal').style.display='none'; }
    function saveSwap() {
        var note=document.getElementById('swapNote').value;
        var btn=document.getElementById('swapSubmitBtn'); btn.disabled=true; btn.innerText='Submitting...';
        withPin(function(pin){
            supabaseClient.rpc('app_swap_create',{p_username:currentUser.username,p_password:pin,p_shift_id:window._swapShiftId,p_note:note}).then(function(res){
                btn.disabled=false; btn.innerText='Submit Request';
                if(res.error){ if(res.error.code==='42501') sessionPin=null; alert('Could not submit: '+res.error.message); return; }
                closeSwap(); loadEmployeeHome();
            }).catch(function(){ btn.disabled=false; btn.innerText='Submit Request'; alert('Connection error.'); });
        }, function(){ btn.disabled=false; btn.innerText='Submit Request'; });
    }

    // Manager: pending requests
    function openRequests() {
        document.getElementById('main-menu').style.display = 'none';
        document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
        document.getElementById('requestsView').style.display = 'block';
        window.scrollTo(0, 0);
        loadRequests();
    }
    function loadRequests() {
        var c=document.getElementById('requestsContent');
        c.innerHTML='<p style="text-align:center;padding:30px;color:#6b7686;">Loading requests...</p>';
        withPin(function(pin){
            supabaseClient.rpc('app_requests_pending',{p_username:currentUser.username,p_password:pin}).then(function(res){
                if(res.error){ if(res.error.code==='42501') sessionPin=null; c.innerHTML='<p style="color:red;text-align:center;padding:20px;">Could not load: '+escapeHtml(res.error.message)+'</p>'; return; }
                requestsRender(res.data||{});
            }).catch(function(){ c.innerHTML='<p style="color:red;text-align:center;padding:20px;">Connection error.</p>'; });
        }, function(){ c.innerHTML='<p style="text-align:center;padding:30px;color:#6b7686;">PIN required.</p>'; });
    }
    function requestsRender(d) {
        var c=document.getElementById('requestsContent');
        var to=d.time_off||[], sw=d.swaps||[];
        var html='<div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">' +
            '<h3 style="margin:0 0 10px;color:var(--caliches-blue);font-size:16px;">&#127796; Pending Time-Off ('+to.length+')</h3>';
        if(!to.length){ html+='<p style="color:#6b7686;font-size:13px;margin:0;">None pending. &#127881;</p>'; }
        else to.forEach(function(t,i){
            html+='<div style="padding:10px 0;'+(i<to.length-1?'border-bottom:1px solid #eee;':'')+'">' +
                '<div style="font-size:14px;color:#333;font-weight:bold;">'+escapeHtml(t.employee)+'</div>' +
                '<div style="font-size:13px;color:#555;">'+escapeHtml(t.start)+' → '+escapeHtml(t.end)+(t.reason?' — '+escapeHtml(t.reason):'')+'</div>' +
                '<div style="margin-top:6px;display:flex;gap:8px;"><button onclick="reqDecide(\'time_off\','+t.id+',true)" style="background:var(--pass-green);color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:bold;cursor:pointer;">Approve</button>' +
                '<button onclick="reqDecide(\'time_off\','+t.id+',false)" style="background:var(--damage-red);color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:bold;cursor:pointer;">Deny</button></div></div>';
        });
        html+='</div>';
        html+='<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">' +
            '<h3 style="margin:0 0 10px;color:var(--caliches-blue);font-size:16px;">&#128260; Pending Shift Cover ('+sw.length+')</h3>';
        if(!sw.length){ html+='<p style="color:#6b7686;font-size:13px;margin:0;">None pending. &#127881;</p>'; }
        else sw.forEach(function(w,i){
            html+='<div style="padding:10px 0;'+(i<sw.length-1?'border-bottom:1px solid #eee;':'')+'">' +
                '<div style="font-size:14px;color:#333;font-weight:bold;">'+escapeHtml(w.employee)+'</div>' +
                '<div style="font-size:13px;color:#555;">'+escapeHtml(w.date||'')+'  '+escapeHtml(w.start||'')+'-'+escapeHtml(w.end||'')+(w.note?' — '+escapeHtml(w.note):'')+'</div>' +
                '<div style="margin-top:6px;display:flex;gap:8px;"><button onclick="reqDecide(\'swap\','+w.id+',true)" style="background:var(--pass-green);color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:bold;cursor:pointer;">Approve</button>' +
                '<button onclick="reqDecide(\'swap\','+w.id+',false)" style="background:var(--damage-red);color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:bold;cursor:pointer;">Deny</button></div></div>';
        });
        html+='</div>';
        c.innerHTML=html;
    }
    function reqDecide(type, id, approve) {
        var note='';
        if(!approve){ note=prompt('Optional note to the employee (reason for denial):','')||''; }
        var fn = type==='swap' ? 'app_swap_decide' : 'app_time_off_decide';
        withPin(function(pin){
            supabaseClient.rpc(fn,{p_username:currentUser.username,p_password:pin,p_id:id,p_approve:approve,p_note:note}).then(function(res){
                if(res.error){ if(res.error.code==='42501') sessionPin=null; alert('Error: '+res.error.message); return; }
                loadRequests();
            }).catch(function(){ alert('Connection error.'); });
        });
    }
