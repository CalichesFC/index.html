    // ============================================================
    // MY MAINTENANCE SUBMISSIONS (Staff)
    // ============================================================
    function openMySubmissions() {
        triggerTransition(() => {
            document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
            document.getElementById('mySubmissionsView').style.display = 'block';
            fetchMySubmissions();
        });
    }

    function fetchMySubmissions() {
        const container = document.getElementById('mySubmissionsResults');
        container.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">Loading your submissions...</p>';
        withPin(function(pin) {
        supabaseClient.rpc('app_my_maintenance_submissions', { p_username: currentUser.username, p_password: pin })
        .then(({ data, error }) => {
            if (error && error.code === '42501') sessionPin = null;
            if (error || !data) { container.innerHTML = '<p style="color:red;">Error loading submissions: ' + (error ? error.message : 'no data') + '</p>'; return; }
            if (!data.length) { container.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">You have not submitted any maintenance requests yet.</p>'; return; }
            const todayStr = new Date().toISOString().split('T')[0];
            let html = '';
            data.forEach(row => {
                let status = row.Status || 'Pending';
                let overdue = row.deadline && status !== 'Resolved' && row.deadline < todayStr;
                let statusColor = status === 'Resolved' ? 'var(--pass-green)' : (status === 'In Progress' ? 'var(--caliches-blue)' : '#999');
                html += '<div class="my-sub-card">';
                html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">';
                html += '<div><div class="maint-card-title">' + escapeHtml(row.MaintenanceItem) + '</div><div class="maint-card-meta">' + escapeHtml(row.Location) + ' &bull; ' + escapeHtml(row.ReportDate) + '</div></div>';
                html += '<span class="status-pill" style="background:' + statusColor + ';">' + escapeHtml(status) + '</span>';
                html += '</div>';
                html += '<p class="maint-card-desc">' + escapeHtml(row.IssueDescription) + '</p>';
                if (row.deadline) html += '<div style="font-size:12px;margin-bottom:8px;color:#555;"><strong>Deadline:</strong> ' + escapeHtml(row.deadline) + (overdue ? ' <span style="color:var(--fail-red);font-weight:bold;">(Overdue)</span>' : '') + '</div>';
                if (row.manager_notes) html += '<div class="maint-readonly-note"><strong>Manager Notes:</strong> ' + escapeHtml(row.manager_notes) + '</div>';
                html += '</div>';
            });
            container.innerHTML = html;
        }).catch(() => { container.innerHTML = '<p style="color:red;">Connection error.</p>'; });
        }, function() { container.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">PIN required to load your submissions.</p>'; });
    }

    function refreshCurrentDashboard() { fetchDashboard(currentDashTab, document.querySelector('.dash-tab.active')); }

    // ============================================================
    // DASHBOARD
    // ============================================================
    function fetchDashboard(tabName, btnElement) {
        currentDashTab = tabName;
        if (btnElement) { document.querySelectorAll('.dash-tab').forEach(b => b.classList.remove('active')); btnElement.classList.add('active'); }
        const results = document.getElementById('dashboardResults');
        results.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">Fetching ' + tabName + ' data...</p>';
        document.getElementById('dashboardFilterDiv').style.display = 'flex';
        const tableMap = { 'Pop-Ins':'pop_ins','Shortages':'shortages','Driver Logs':'driver_logs','Maintenance Logs':'maintenance_logs','Damage Reports':'damage_reports' };
        withPin(function(pin) {
            supabaseClient.rpc('app_admin_dashboard_list', { p_admin_username: currentUser.username, p_admin_password: pin, p_table: tableMap[tabName] })
            .then(({ data: supaData, error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if (error) { console.error('[Dashboard] Error:', error); results.innerHTML = '<p style="color:red;padding:20px;">Error (' + error.code + '): ' + error.message + '</p>'; return; }
                if (!supaData || supaData.length === 0) { results.innerHTML = '<p style="padding:20px;">No data found. Submit a form then check this tab.</p>'; return; }
                let allKeys = Object.keys(supaData[0]).filter(k => k !== 'id');
                let hasPdf = allKeys.includes('PDF_Archive');
                let headers = allKeys.filter(k => k !== 'PDF_Archive');
                let maxCols = hasPdf ? 9 : 10;
                let html = '<div class="table-wrapper"><table class="data-table"><thead><tr>';
                headers.forEach((h,i) => { if(i<maxCols) html += '<th>' + h + '</th>'; });
                if(hasPdf) html += '<th>PDF</th>';
                if(tabName==='Maintenance Logs'||tabName==='Damage Reports') html += '<th>Action</th>';
                html += '</tr></thead><tbody>';
                supaData.forEach(row => {
                    html += '<tr>';
                    headers.forEach((h,i) => {
                        if(i>=maxCols) return;
                        let cellData = (row[h]!==null&&row[h]!==undefined)?row[h]:'';
                        if(cellData.toString().startsWith('http')) { html += '<td><a href="' + cellData + '" target="_blank" style="background:var(--caliches-pink);color:white;padding:5px 10px;border-radius:4px;text-decoration:none;font-weight:bold;display:inline-block;">View PDF</a></td>'; }
                        else { html += '<td>' + cellData + '</td>'; }
                    });
                    if(hasPdf) {
                        let pdfVal = row['PDF_Archive'];
                        if(pdfVal && pdfVal.toString().startsWith('http')) html += '<td><a href="' + pdfVal + '" target="_blank" style="background:var(--caliches-pink);color:white;padding:5px 10px;border-radius:4px;text-decoration:none;font-weight:bold;display:inline-block;">View PDF</a></td>';
                        else html += '<td>' + (pdfVal||'') + '</td>';
                    }
                    if(tabName==='Maintenance Logs'||tabName==='Damage Reports') {
                        let st = row['Status']||'Pending';
                        html += '<td><select id="status-' + row.id + '" class="role-select"><option value="Pending"' + (st==='Pending'?' selected':'') + '>Pending</option><option value="In Progress"' + (st==='In Progress'?' selected':'') + '>In Progress</option><option value="Resolved"' + (st==='Resolved'?' selected':'') + '>Resolved</option></select><button class="update-action-btn" onclick="updateItemStatus(\'' + tabName + '\',' + row.id + ')">Save</button></td>';
                    }
                    html += '</tr>';
                });
                html += '</tbody></table></div>';
                results.innerHTML = html;
            }).catch(err => { results.innerHTML = '<p style="color:red;padding:20px;">Connection Error: ' + err.message + '</p>'; });
        }, function() { results.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">PIN required to load ' + tabName + ' data.</p>'; });
    }

    function updateItemStatus(tabName, rowId) {
        let newStatus = document.getElementById('status-' + rowId).value;
        const tableMap = { 'Maintenance Logs':'maintenance_logs','Damage Reports':'damage_reports' };
        withPin(function(pin) {
            supabaseClient.rpc('app_admin_dashboard_update_status', { p_admin_username: currentUser.username, p_admin_password: pin, p_table: tableMap[tabName], p_id: rowId, p_status: newStatus })
            .then(({ error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if(!error) alert('Status updated to: ' + newStatus); else alert('Error: ' + error.message);
            });
        });
    }

    function fetchUsers(btnElement) {
        currentDashTab = 'Users';
        document.querySelectorAll('.dash-tab').forEach(b => b.classList.remove('active')); btnElement.classList.add('active');
        document.getElementById('dashboardFilterDiv').style.display = 'none';
        const results = document.getElementById('dashboardResults');
        results.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">Loading Staff Database...</p>';
        withPin(function(pin) {
            supabaseClient.rpc('app_admin_list_users', { p_admin_username: currentUser.username, p_admin_password: pin })
            .then(({ data, error }) => {
                if (error || !data) {
                    if (error && error.code === '42501') sessionPin = null;
                    results.innerHTML = '<p style="color:red;">Error: ' + (error?error.message:'no data') + '</p>'; return;
                }
                let html = '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Forms Allowed</th><th>Action</th></tr></thead><tbody>';
                data.forEach(u => {
                    let perms = u.permissions || FORM_KEYS.map(f=>f.key);
                    let checks = FORM_KEYS.map(f => '<label style="margin-right:8px;font-size:11px;font-weight:bold;white-space:nowrap;"><input type="checkbox" data-key="' + f.key + '" ' + (perms.indexOf(f.key)!==-1?'checked':'') + ' style="transform:scale(1.2);vertical-align:middle;"> ' + f.label + '</label>').join('');
                    if (u.role === 'Manager' || u.role === 'Admin Manager') {
                        let maintBoardChecked = (u.maint_board_access !== false);
                        checks += '<label style="margin-right:8px;font-size:11px;font-weight:bold;white-space:nowrap;color:var(--maint-orange);"><input type="checkbox" id="mb-' + u.id + '" ' + (maintBoardChecked?'checked':'') + ' style="transform:scale(1.2);vertical-align:middle;"> Maint. Board</label>';
                    }
                    html += '<tr><td style="font-weight:500;">' + u.name + '</td><td style="color:var(--na-gray);">' + u.username + '</td><td style="color:var(--na-gray);">' + (u.email||'—') + '</td><td><select id="role-select-' + u.id + '" class="role-select"><option value="Blue Apron"' + (u.role==='Blue Apron'?' selected':'') + '>Blue Apron</option><option value="Shift Lead"' + (u.role==='Shift Lead'?' selected':'') + '>Shift Lead</option><option value="Manager"' + (u.role==='Manager'?' selected':'') + '>Manager</option><option value="Maintenance"' + (u.role==='Maintenance'?' selected':'') + '>Maintenance</option><option value="Admin Manager"' + (u.role==='Admin Manager'?' selected':'') + '>Admin Manager</option>' + (u.role==='Vice President/Co-Owner' ? '<option value="Vice President/Co-Owner" selected>Vice President/Co-Owner</option>' : '') + '</select></td><td><div id="perm-' + u.id + '" style="display:flex;flex-wrap:wrap;gap:2px;max-width:260px;">' + checks + '</div></td><td style="white-space:nowrap;"><button class="update-role-btn" onclick="updateRole(' + u.id + ')">Save Role</button><button class="update-action-btn" onclick="updatePermissions(' + u.id + ')" style="margin-left:5px;">Save Forms</button><button class="delete-btn" onclick="deleteUser(' + u.id + ')">Delete</button></td></tr>';
                });
                html += '</tbody></table></div>'; results.innerHTML = html;
            }).catch(() => { results.innerHTML = '<p style="color:red;">Connection Error.</p>'; });
        }, function() { results.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">PIN required to load Staff Database.</p>'; });
    }

    function updateRole(id) {
        let newRole = document.getElementById('role-select-' + id).value;
        withPin(function(pin) {
            supabaseClient.rpc('app_admin_update_role', { p_admin_username: currentUser.username, p_admin_password: pin, p_user_id: id, p_role: newRole })
            .then(({ error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if(!error) alert('Role updated to ' + newRole + '!'); else alert('Error: ' + error.message);
            });
        });
    }

    function updatePermissions(id) {
        let container = document.getElementById('perm-' + id);
        if (!container) return;
        let checked = Array.from(container.querySelectorAll('input[type="checkbox"][data-key]:checked')).map(c => c.dataset.key);
        let mbCheckbox = document.getElementById('mb-' + id);
        let maintBoardAccess = mbCheckbox ? mbCheckbox.checked : null;
        withPin(function(pin) {
            supabaseClient.rpc('app_admin_update_permissions', { p_admin_username: currentUser.username, p_admin_password: pin, p_user_id: id, p_permissions: checked, p_maint_board_access: maintBoardAccess })
            .then(({ error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if(!error) alert('Form access updated!'); else alert('Error: ' + error.message);
            });
        });
    }

    function deleteUser(id) {
        if(!confirm('Are you sure you want to permanently delete this user?')) return;
        withPin(function(pin) {
            supabaseClient.rpc('app_admin_delete_user', { p_admin_username: currentUser.username, p_admin_password: pin, p_user_id: id })
            .then(({ error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if(!error) { alert('User deleted.'); fetchUsers(document.querySelector('.dash-tab.active')); } else alert('Error: ' + error.message);
            });
        });
    }

    // ============================================================
    // SLIDER
    // ============================================================
    const SLIDE_COUNT = 5;
    function updateSlider() { document.getElementById('slider-track').style.transform = 'translateX(-' + (currentSlide*(100/SLIDE_COUNT)) + '%)'; }
    function moveSlide(direction) { currentSlide = (currentSlide+direction+SLIDE_COUNT)%SLIDE_COUNT; updateSlider(); resetTimer(); }
    function resetTimer() { clearInterval(slideTimer); slideTimer = setInterval(() => moveSlide(1), 10000); }

    // ============================================================
    // WEEKLY ROTATING LEADERSHIP QUOTES (changes every Monday)
    // ============================================================
    const LEADERSHIP_QUOTES = [
        { text: "Quality is not an act, it is a habit.", author: "Aristotle" },
        { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
        { text: "Great things in business are never done by one person. They're done by a team of people.", author: "Steve Jobs" },
        { text: "It is not the employer who pays the wages. Employers only handle the money. It is the customer who pays the wages.", author: "Henry Ford" },
        { text: "Take care of your employees and they will take care of your customers.", author: "Richard Branson" },
        { text: "The customer's perception is your reality.", author: "Kate Zabriskie" },
        { text: "Whether you think you can or think you can't, you're right.", author: "Henry Ford" },
        { text: "Excellence is not a skill, it's an attitude.", author: "Ralph Marston" },
        { text: "Coming together is a beginning, staying together is progress, and working together is success.", author: "Henry Ford" },
        { text: "People will forget what you said, people will forget what you did, but people will never forget how you made them feel.", author: "Maya Angelou" },
        { text: "Do what you do so well that people can't resist telling others about you.", author: "Walt Disney" },
        { text: "Leadership is not about being in charge. It's about taking care of those in your charge.", author: "Simon Sinek" }
    ];

    function getISOWeekNumber(d) {
        const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const dayNum = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    }

    function applyWeeklyQuotes() {
        const week = getISOWeekNumber(new Date());
        const total = LEADERSHIP_QUOTES.length;
        for (let i = 0; i < 3; i++) {
            const q = LEADERSHIP_QUOTES[(week * 3 + i) % total];
            const slide = document.getElementById('quote-slide-' + (i + 1));
            if (!slide) continue;
            const textEl = slide.querySelector('.quote-text');
            const authorEl = slide.querySelector('.quote-author');
            if (textEl) textEl.innerHTML = '“' + escapeHtml(q.text) + '”';
            if (authorEl) authorEl.innerHTML = '— ' + escapeHtml(q.author);
        }
    }

    // ============================================================
    // ANNOUNCEMENT BAR (company news)
    // ============================================================
    function fetchAnnouncement() {
        supabaseClient.from('app_announcement').select('*').eq('id', 1).single()
            .then(({ data, error }) => {
                if (error || !data) return;
                const bar = document.getElementById('announcementBar');
                const textEl = document.getElementById('announcementText');
                if (!bar || !textEl) return;
                const msg = (data.message || '').trim();
                const dismissedKey = 'calichesAnnounceDismissed';
                const dismissedMsg = localStorage.getItem(dismissedKey);
                if (msg && msg !== dismissedMsg) {
                    textEl.innerText = msg;
                    bar.style.display = 'flex';
                } else {
                    bar.style.display = 'none';
                }
                // Prefill editor for managers
                const input = document.getElementById('announcementInput');
                if (input) input.value = msg;
            })
            .catch(err => console.error('[Announcement] fetch error:', err));
    }

    function dismissAnnouncement() {
        const bar = document.getElementById('announcementBar');
        const textEl = document.getElementById('announcementText');
        if (textEl) localStorage.setItem('calichesAnnounceDismissed', textEl.innerText);
        if (bar) bar.style.display = 'none';
    }

    function openAnnouncementEditor() {
        const modal = document.getElementById('announcementModal');
        const msg = document.getElementById('announcementMsg');
        if (msg) msg.innerText = '';
        if (modal) modal.style.display = 'flex';
        fetchAnnouncement();
    }

    function closeAnnouncementEditor() {
        const modal = document.getElementById('announcementModal');
        if (modal) modal.style.display = 'none';
    }

    function saveAnnouncement() {
        const input = document.getElementById('announcementInput');
        const msg = document.getElementById('announcementMsg');
        if (!input) return;
        const text = input.value.trim();
        withPin(function(pin) {
            supabaseClient.rpc('app_manager_update_announcement', { p_username: currentUser.username, p_password: pin, p_message: text })
                .then(({ error }) => {
                    if (error && error.code === '42501') sessionPin = null;
                    if (error) { if (msg) msg.innerText = 'Error: ' + error.message; return; }
                    localStorage.removeItem('calichesAnnounceDismissed');
                    if (msg) msg.innerText = 'Announcement posted!';
                    fetchAnnouncement();
                })
                .catch(err => console.error('[Announcement] save error:', err));
        }, function() { if (msg) msg.innerText = 'PIN required to post announcement.'; });
    }

    function clearAnnouncement() {
        const input = document.getElementById('announcementInput');
        const msg = document.getElementById('announcementMsg');
        withPin(function(pin) {
            supabaseClient.rpc('app_manager_update_announcement', { p_username: currentUser.username, p_password: pin, p_message: '' })
                .then(({ error }) => {
                    if (error && error.code === '42501') sessionPin = null;
                    if (error) { if (msg) msg.innerText = 'Error: ' + error.message; return; }
                    if (input) input.value = '';
                    localStorage.removeItem('calichesAnnounceDismissed');
                    if (msg) msg.innerText = 'Announcement cleared.';
                    fetchAnnouncement();
                })
                .catch(err => console.error('[Announcement] clear error:', err));
        }, function() { if (msg) msg.innerText = 'PIN required to clear announcement.'; });
    }

    // ============================================================
    // PDF HEADER HELPER
    // ============================================================
    function getBrandHeader(title, color) { return '<div style="font-family:Helvetica Neue,Helvetica,Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px;background-color:#ffffff;"><div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:4px solid ' + color + ';padding-bottom:18px;margin-bottom:25px;"><div><h1 style="color:' + color + ';font-size:32px;margin:0;font-weight:800;">' + title + '</h1><p style="color:#6b7686;font-size:12px;margin:6px 0 0 0;">Generated: ' + new Date().toLocaleString() + '</p></div><img src="https://calichesfc.github.io/index.html/catering-logo-circle.png" style="height:85px;width:auto;" alt="Caliche\'s Logo"></div>'; }

    // ============================================================
    // SUPABASE SAVE HELPER
    // ============================================================
    function saveToSupabase(tableName, form, pdfUrl, onSuccess) {
        let insertObj = Object.fromEntries(new FormData(form).entries());
        delete insertObj.ReportHTML; delete insertObj.action;
        insertObj.PDF_Archive = pdfUrl || 'PDF Failed to Generate';
        console.log('[Supabase] Inserting into ' + tableName + ':', insertObj);
        supabaseClient.rpc('app_form_insert', { p_table: tableName, p_data: insertObj })
        .then(({ data, error }) => {
            console.log('[Supabase] Response from ' + tableName + ':', { data, error });
            if (error) { console.error('[Supabase] Error:', error.code, error.message); alert('PDF was emailed BUT failed to save to dashboard.\n\nError (' + error.code + '): ' + error.message); return; }
            onSuccess();
        }).catch(err => { console.error('[Supabase] Unexpected error:', err); alert('Unexpected error: ' + (err.message||err)); });
    }

    // ============================================================
    // POP-IN QUESTIONS GENERATOR
    // ============================================================
    const questions = [
        { cat:'Team Member Performance', q:['Moving with a purpose, motivated to work, positive attitude','All team members are following dress code','Teamwork is being conducted','Multitasking when possible','Respecting the no talking when windows are open policy','Backups are being done in a timely manner','During busy hours everyone is staying composed and collected','Register runners are small talking with customers','Everyone is listening to the orders being called out','Register runners providing excellent customer service','Everyone is lending a hand to get out lines faster','Team members are handing out items correctly'] },
        { cat:'Shift Leader Performance', q:['Moving with a purpose, motivated, positive attitude','Constantly lending a helping hand','Ensuring duties are performed efficiently to standard','Always staying composed and collected','Communicating and providing good direction to team','Promoting a positive and healthy work environment','Displaying good judgment','Coaching team members and helping train new staff','Ensuring compliance with company health/safety policies','Shift is organized and is on or ahead of schedule','Can influence the team\'s efforts through leadership','Easily adapts to changing conditions and delegates','Monitoring that machine runner is performing to standard'] },
        { cat:'Cleanliness', q:['Stations are being wiped down after use','Glove protocol is being followed','Dirty dishes are being pre-rinsed and tape taken off','Sani buckets are being changed when dirty (or every 2 hrs)','Spills or messes on floors are being addressed','Exterior front counters are being wiped down','Middle sink in dish area is maintained clean and free of dishes','Machine area is clean and being wiped down','Hands are being washed','Malt collars are attended to after orders/before leaving area','Caliche and shake machines attended to after orders','Team members are wearing clean aprons','Quick spiffs are being maintained','Custard Quality station is maintained to emphasize product integrity'] },
        { cat:'Quality', q:['Machine runner\'s custard is high quality and fresh','All fruits are fresh to taste','All backups in walk-in rotated correctly (labels face center)','Hot dogs are hot and plump, not cold or old','Coleslaw is made correctly','Tostadas are fresh to taste','Enough hot dog buns are being defrosted','Hot fudge warmers are set to 140 degrees (F)','Caramel warmers are set to 100 degrees (F)','Machine runner is keeping up with melts','Items are being scooped properly','Caliches and shakes are being blended properly'] }
    ];

    (function generatePopInQuestions() {
        let html = ''; let qIdx = 1;
        questions.forEach(group => {
            html += '<div class="category"><h2>' + group.cat + '</h2>';
            group.q.forEach(text => {
                questionPhotos[qIdx] = [];
                html += '<div class="question"><p>' + text + '</p><div class="rating-group"><input type="radio" name="q' + qIdx + '" id="q' + qIdx + '-0" value="0" onchange="calc()"><label for="q' + qIdx + '-0">N/A</label>';
                for(let i=1;i<=5;i++) { html += '<input type="radio" name="q' + qIdx + '" id="q' + qIdx + '-' + i + '" value="' + i + '" onchange="calc()"><label for="q' + qIdx + '-' + i + '">' + i + '</label>'; }
                html += '</div><input type="text" id="note' + qIdx + '" name="note' + qIdx + '" class="note-input" placeholder="Add specific feedback..."><div><label class="photo-btn">&#128248; Attach Photos<input type="file" accept="image/*" multiple onchange="compressAndPreview(event,' + qIdx + ')" style="display:none;"></label><div id="imgPreviewContainer' + qIdx + '" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;"></div></div></div>';
                qIdx++;
            });
            html += '</div>';
        });
        document.getElementById('questionsContainer').innerHTML = html;
        totalQuestions = qIdx - 1;

        // Listen to note input changes for draft auto-save
        document.getElementById('questionsContainer').addEventListener('input', function(e) {
            if (e.target.classList.contains('note-input')) scheduleDraftSave();
        });
        // Listen to header field changes
        ['loc','dt','shiftTime','sldr','conductor'].forEach(id => {
            let el = document.getElementById(id);
            if (el) el.addEventListener('change', scheduleDraftSave);
        });
        document.getElementById('overallComments').addEventListener('input', scheduleDraftSave);
    })();

    // ============================================================
    // SCORE CALCULATOR
    // ============================================================
    function calc() {
        let totalScore = 0; let questionsCounted = 0; let answered = 0;
        for(let i=1;i<=totalQuestions;i++) { let sel = document.querySelector('input[name="q'+i+'"]:checked'); if(sel) { answered++; let val = parseInt(sel.value); if(val>0) { totalScore+=val; questionsCounted++; } } }
        let maxPossible = questionsCounted*5;
        let p = maxPossible===0?0:Math.round((totalScore/maxPossible)*100);
        document.getElementById('ts').innerText = totalScore;
        document.getElementById('maxPts').innerText = maxPossible;
        document.getElementById('finalScore').value = totalScore;
        document.getElementById('pct').innerText = p;
        document.getElementById('finalPct').value = p + '%';
        let badge = document.getElementById('st');
        if(answered===totalQuestions) { let stat = p>=85?'EXCELLENT':(p>=75?'MEETS STANDARD':'NEEDS IMPROVEMENT'); badge.innerText = stat; document.getElementById('finalStatus').value = stat; badge.style.backgroundColor = p>=75?'var(--pass-green)':'var(--fail-red)'; }
        updateProgressBar();
        scheduleDraftSave();
    }

    // ============================================================
    // IMAGE COMPRESSION
    // ============================================================
    function compressAndPreview(event, qId) { let files = event.target.files; if(!files||files.length===0) return; let pc = document.getElementById('imgPreviewContainer'+qId); Array.from(files).forEach(file => { let r = new FileReader(); r.onload = function(e) { let img = new Image(); img.onload = function() { let c = document.createElement('canvas'); let ctx = c.getContext('2d'); let scale = Math.min(300/img.width,1); c.width = img.width*scale; c.height = img.height*scale; ctx.drawImage(img,0,0,c.width,c.height); let b64 = c.toDataURL('image/jpeg',0.4); questionPhotos[qId].push(b64); let pi = document.createElement('img'); pi.src = b64; pi.style.cssText = 'width:60px;height:60px;border-radius:6px;border:1px solid #ccc;object-fit:cover;'; pc.appendChild(pi); }; img.src = e.target.result; }; r.readAsDataURL(file); }); }
    function compressToGlobal(event, previewId, targetArray) { let files = event.target.files; if(!files||files.length===0) return; let pc = document.getElementById(previewId); Array.from(files).forEach(file => { let r = new FileReader(); r.onload = function(e) { let img = new Image(); img.onload = function() { let c = document.createElement('canvas'); let ctx = c.getContext('2d'); let scale = Math.min(400/img.width,1); c.width = img.width*scale; c.height = img.height*scale; ctx.drawImage(img,0,0,c.width,c.height); let b64 = c.toDataURL('image/jpeg',0.4); targetArray.push(b64); let pi = document.createElement('img'); pi.src = b64; pi.style.cssText = 'height:80px;border-radius:6px;border:1px solid #ccc;'; pc.appendChild(pi); }; img.src = e.target.result; }; r.readAsDataURL(file); }); }

    // ============================================================
    // FORM SUBMISSIONS
    // ============================================================
    function submitAudit() {
        const btn = document.getElementById('submitBtn'); const form = document.getElementById('auditForm');
        if(!document.getElementById('loc').value||!document.getElementById('sldr').value||!document.getElementById('conductor').value) { return alert('Please fill out Location, Shift Leader, and Conducted By!'); }
        let answered = 0; for(let i=1;i<=totalQuestions;i++) { if(document.querySelector('input[name="q'+i+'"]:checked')) answered++; }
        if(answered<totalQuestions) { return alert('Please answer all questions. You have answered '+answered+' out of '+totalQuestions+'.'); }
        // Collect failed items (scored 1-2) for the corrective-action step.
        window._popInFailed = []; var _li=1;
        questions.forEach(function(group){ group.q.forEach(function(text){ var sel=document.querySelector('input[name="q'+_li+'"]:checked'); var sc=sel?parseInt(sel.value):0; var nEl=document.getElementById('note'+_li); if(sc===1||sc===2){ window._popInFailed.push({ text:text, score:sc, note:(nEl?nEl.value:'') }); } _li++; }); });
        window._popInStore = document.getElementById('loc').value; window._popInDate = document.getElementById('dt').value;
        btn.innerText = 'Generating PDF...'; btn.disabled = true;
        let pdfHtml = getBrandHeader('Store Pop-In Inspection','#4a68b1');
        pdfHtml += '<table style="width:100%;margin-bottom:20px;"><tr><td style="padding:8px;"><strong>Location:</strong> '+document.getElementById('loc').value+'</td><td style="padding:8px;"><strong>Date:</strong> '+document.getElementById('dt').value+'</td></tr><tr><td style="padding:8px;"><strong>Conducted By:</strong> '+document.getElementById('conductor').value+'</td><td style="padding:8px;"><strong>Shift Leader:</strong> '+document.getElementById('sldr').value+' ('+document.getElementById('shiftTime').value+')</td></tr></table>';
        pdfHtml += '<div style="background:#f0f4f8;padding:20px;border-radius:8px;margin-bottom:30px;text-align:center;"><h2 style="color:#4a68b1;margin:0;font-size:28px;">Score: '+document.getElementById('pct').innerText+'%</h2><h3 style="color:#555;margin:5px 0 15px 0;">Status: '+document.getElementById('st').innerText+'</h3><p style="margin:0;text-align:left;padding-top:15px;border-top:1px solid #ddd;"><strong>Comments:</strong> '+(document.getElementById('overallComments').value||'None')+'</p></div>';
        pdfHtml += '<table border="1" cellpadding="12" style="border-collapse:collapse;width:100%;font-size:14px;border-color:#ddd;"><tr style="background:#4a68b1;color:white;"><th style="text-align:left;">Question</th><th style="width:60px;text-align:center;">Score</th><th>Notes</th></tr>';
        let loopIdx=1; questions.forEach(group => { pdfHtml += '<tr style="background:#f9f9f9;"><td colspan="3"><strong>'+group.cat+'</strong></td></tr>'; group.q.forEach(text => { let sel = document.querySelector('input[name="q'+loopIdx+'"]:checked'); let note = document.getElementById('note'+loopIdx).value; let score = sel?sel.value:'N/A'; if(score==='0') score='N/A'; pdfHtml += '<tr><td>'+text+'</td><td style="text-align:center;font-weight:bold;">'+score+'</td><td>'+note+'</td></tr>'; loopIdx++; }); });
        pdfHtml += '</table></div>';
        document.getElementById('popInReportHtml').value = pdfHtml;
        btn.innerText = 'Saving…';
        /* DB-FIRST (Phase 3): save the inspection to Supabase before attempting the Apps-Script PDF,
           so a PDF-server hiccup can never lose the inspection data. */
        saveToSupabase('pop_ins', form, null, () => {
            localStorage.removeItem('calichesDraft_popIn');
            var _popInPrint = function(e) { if (e && e.preventDefault) e.preventDefault(); document.body.innerHTML = pdfHtml; setTimeout(() => { window.print(); location.reload(); }, 500); };
            var _popInCorrective = function() { if(window._popInFailed && window._popInFailed.length && typeof openCorrectiveActions==='function'){ setTimeout(function(){ openCorrectiveActions(window._popInFailed, window._popInStore, window._popInDate); }, 500); } };
            btn.innerText = 'Saved ✓ — generating PDF…';
            fetch(G_URL, { method:'POST', body:new FormData(form) })
            .then(res => res.json())
            .then(googleData => {
                console.log('[Pop-In] GAS:', googleData);
                btn.disabled = false; btn.style.backgroundColor = 'var(--pass-green)'; btn.innerText = 'SENT! (TAP TO PRINT)';
                btn.onclick = _popInPrint;
                _popInCorrective();
            })
            .catch(err => {
                console.error('[Pop-In] GAS error:', err);
                alert('Saved ✓ — PDF generation failed, you can reprint later.');
                btn.disabled = false; btn.style.backgroundColor = 'var(--pass-green)'; btn.innerText = 'SAVED ✓ (TAP TO PRINT)';
                btn.onclick = _popInPrint;
                _popInCorrective();
            });
        });
    }

    function submitDriverForm() {
        const btn = document.getElementById('submitDriverBtn'); const form = document.getElementById('driverForm');
        if(!document.getElementById('vehicle').value||!document.getElementById('signature').value) { return alert('Please select a vehicle and sign the form!'); }
        btn.innerText = 'Generating PDF...'; btn.disabled = true;
        let pdfHtml = getBrandHeader('Vehicle & Trailer Check-Out','#c53a74');
        pdfHtml += '<table border="1" cellpadding="12" style="border-collapse:collapse;width:100%;font-size:15px;border-color:#ddd;">';
        new FormData(form).forEach((value,key) => { if(key!=='ReportHTML'&&value.toString().trim()!=='') { pdfHtml += '<tr><td style="background:#f9f9f9;font-weight:bold;color:#c53a74;width:40%;">'+key.replace(/_/g,' ').toUpperCase()+'</td><td>'+value+'</td></tr>'; } });
        pdfHtml += '</table></div>';
        document.getElementById('driverReportHtml').value = pdfHtml;
        fetch(G_URL, { method:'POST', body:new FormData(form) })
        .then(res => res.json())
        .then(googleData => { console.log('[Driver] GAS:', googleData); saveToSupabase('driver_logs', form, googleData.pdfUrl, () => { btn.disabled=false; btn.style.backgroundColor='var(--pass-green)'; btn.innerText='LOG SECURED AND SENT!'; setTimeout(() => { form.reset(); btn.style.backgroundColor='var(--caliches-pink)'; btn.innerText='SUBMIT DRIVER CHECKLIST'; openMenu(); }, 3000); }); })
        .catch(err => { console.error('[Driver] GAS error:', err); alert('Could not reach PDF server: '+err.message); btn.disabled=false; btn.innerText='SUBMIT DRIVER CHECKLIST'; });
    }

    function supplyOpenDetail(id){
        var modal=document.getElementById('supplyDetailModal'); modal.style.display='flex';
        var body=document.getElementById('supplyDetailBody'); body.innerHTML='<p style="text-align:center;color:#6b7686;padding:30px;">Loading&hellip;</p>';
        window._supplyDetailId=id;
        supabaseClient.rpc('app_supply_detail',{p_username:currentUser.username,p_password:sessionPin,p_request_id:id}).then(function(r){
            if(r.error||!r.data){ body.innerHTML='<p style="color:#c0264b;padding:16px;">'+(String((r.error&&r.error.message)||'').indexOf('forbidden')>=0?'You do not have access to this request.':'Could not load request.')+'</p>'; return; }
            supplyRenderDetail(r.data);
        }).catch(function(){ body.innerHTML='<p style="color:#c0264b;padding:16px;">Connection error.</p>'; });
    }
    function supplyFmtTs(t){ if(!t) return ''; try{ var d=new Date(t); return d.toLocaleDateString()+' '+d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); }catch(e){ return String(t); } }
    function supplyRenderDetail(d){
        document.getElementById('supplyDetailTitle').innerText=d.request_no||('SR-'+d.id);
        var order=['Submitted','Assigned','Fulfilling','In transit','Received','Closed'];
        var ci=order.indexOf(d.status); if(ci<0) ci=0;
        var tsMap={'Submitted':d.created_at,'In transit':d.in_transit_at,'Received':d.received_at,'Closed':d.closed_at};
        var timeline=order.map(function(st,i){
            var done=i<=ci; var ts=tsMap[st]?('<span style="color:#5b6675;font-size:11px;"> &middot; '+supplyFmtTs(tsMap[st])+'</span>'):'';
            var who=(st==='Assigned'&&d.assigned_to)?(' &middot; '+escapeHtml(d.assigned_to)):((st==='Received'&&d.received_by)?(' &middot; '+escapeHtml(d.received_by)):'');
            return '<div style="display:flex;align-items:center;gap:9px;padding:4px 0;"><div style="width:18px;height:18px;border-radius:50%;flex:none;background:'+(done?supplyStatusColor(st):'#e6ebf2')+';color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center;">'+(done?'&#10003;':'')+'</div><div style="font-size:13px;color:'+(done?'#1f2a44':'#9aa7b4')+';font-weight:'+(i===ci?'700':'400')+';">'+st+who+ts+'</div></div>';
        }).join('');
        var items=supplyItemsHtml(d);
        var urg=(d.urgency&&d.urgency!=='Normal')?'<span style="font-weight:700;color:'+(d.urgency==='Critical'?'#c0264b':'#b8860b')+';">'+escapeHtml(d.urgency)+'</span> &middot; ':'';
        var h='<div style="font-size:12px;color:#6b7686;margin-bottom:10px;">'+urg+escapeHtml(d.location||'')+' &middot; '+escapeHtml(d.requester_name||'')+(d.needed_by_date?(' &middot; needed '+escapeHtml(String(d.needed_by_date))+(d.needed_by_time?(' '+escapeHtml(d.needed_by_time)):'')):'')+'</div>';
        if(d.reason) h+='<div style="font-size:13px;color:#1f2a44;margin-bottom:4px;"><b>Reason:</b> '+escapeHtml(d.reason)+'</div>';
        if(d.notes) h+='<div style="font-size:13px;color:#6b7686;margin-bottom:8px;">'+escapeHtml(d.notes)+'</div>';
        h+='<div style="font-size:11px;font-weight:700;color:#5b6675;text-transform:uppercase;margin:12px 0 4px;">Items</div>'+items;
        h+='<div style="font-size:11px;font-weight:700;color:#5b6675;text-transform:uppercase;margin:14px 0 4px;">Status</div><div style="background:#fafbfd;border:1px solid #eef0f5;border-radius:10px;padding:10px;">'+timeline+'</div>';
        if(d.fulfillment_source||d.transporter){ h+='<div style="font-size:12px;color:#6b7686;margin-top:8px;">'+(d.fulfillment_source?('<b>Source:</b> '+escapeHtml(d.fulfillment_source)+' '):'')+(d.transporter?('&middot; <b>Transporter:</b> '+escapeHtml(d.transporter)):'')+'</div>'; }
        if(['Assigned','Fulfilling','In transit'].indexOf(d.status)>=0 && (d.can_manage || (currentUser&&currentUser.name===d.requester_name) || (currentUser&&currentUser.store&&currentUser.store===d.location))){ h+='<button onclick="supplyConfirmReceive()" style="width:100%;background:#1f7a3d;color:#fff;border:none;font-weight:800;padding:11px;border-radius:9px;cursor:pointer;font-size:14px;margin-top:10px;">&#10003; Confirm receipt at store</button>'; }
        if(d.can_manage){
            var next=({'Submitted':'Assigned','Assigned':'Fulfilling','Fulfilling':'In transit','In transit':'Received','Received':'Closed'})[d.status];
            h+='<div style="border-top:1px solid #eef0f5;margin-top:14px;padding-top:12px;">';
            h+='<div style="font-size:11px;font-weight:700;color:#5b6675;text-transform:uppercase;margin-bottom:6px;">Office actions</div>';
            h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;"><input id="supplyFulSource" placeholder="Fulfillment source" value="'+escapeHtml(d.fulfillment_source||'')+'" style="flex:1;min-width:120px;padding:8px;border:1px solid #d6deea;border-radius:7px;"><input id="supplyFulTransporter" placeholder="Transporter" value="'+escapeHtml(d.transporter||'')+'" style="flex:1;min-width:120px;padding:8px;border:1px solid #d6deea;border-radius:7px;"><button onclick="supplyDetailFulfill()" style="background:#0a6cb4;color:#fff;border:none;font-weight:700;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:13px;">Save</button></div>';
            h+='<textarea id="supplyAdvNote" rows="2" placeholder="Optional note for this update" style="width:100%;padding:8px;border:1px solid #d6deea;border-radius:7px;box-sizing:border-box;margin-bottom:8px;"></textarea>';
            if(next){ h+='<button onclick="supplyDetailAdvance(&quot;'+next+'&quot;)" style="width:100%;background:#D85A30;color:#fff;border:none;font-weight:800;padding:11px;border-radius:9px;cursor:pointer;font-size:14px;">Mark '+next+'</button>'; }
            else { h+='<div style="text-align:center;color:#1f7a3d;font-weight:700;font-size:13px;">This request is closed.</div>'; }
            h+='</div>';
        }
        document.getElementById('supplyDetailBody').innerHTML=h;
    }
    function supplyDetailAdvance(status){
        var id=window._supplyDetailId; var note=(document.getElementById('supplyAdvNote')||{}).value||'';
        supabaseClient.rpc('app_supply_advance',{p_username:currentUser.username,p_password:sessionPin,p_request_id:id,p_new_status:status,p_note:note}).then(function(r){
            if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'You do not have permission for that.':r.error.message); return; }
            supplyOpenDetail(id);
            if(document.getElementById('supplyPanel-incoming').style.display!=='none') supplyLoadList('incoming');
            if(document.getElementById('supplyPanel-mine').style.display!=='none') supplyLoadList('mine');
        }).catch(function(){ alert('Connection error.'); });
    }
    function supplyDetailFulfill(){
        var id=window._supplyDetailId;
        var src=(document.getElementById('supplyFulSource')||{}).value||'';
        var tr=(document.getElementById('supplyFulTransporter')||{}).value||'';
        supabaseClient.rpc('app_supply_fulfill',{p_username:currentUser.username,p_password:sessionPin,p_request_id:id,p_source:src,p_transporter:tr}).then(function(r){
            if(r.error){ alert(r.error.message); return; }
            supplyOpenDetail(id);
        }).catch(function(){ alert('Connection error.'); });
    }
    function supplyItemsHtml(d){
        var mng=!!d.can_manage; var editable=['Assigned','Fulfilling','In transit'].indexOf(d.status)>=0;
        var rows=(d.items||[]).map(function(i){
            var ful=(i.fulfilled_qty!=null&&i.fulfilled_qty!=='')?('<span style="color:#1f7a3d;font-weight:700;"> &middot; fulfilled '+escapeHtml(String(i.fulfilled_qty))+'</span>'):'';
            var sub=i.approved_substitute?('<div style="color:#9a5b00;font-size:11.5px;">&#8631; approved substitute: '+escapeHtml(i.approved_substitute)+'</div>'):'';
            var line='<div style="padding:6px 0;border-bottom:1px solid #f0f2f6;font-size:13px;">';
            line+='<div style="display:flex;justify-content:space-between;gap:8px;"><span>'+escapeHtml(i.item_name||'')+'</span><span style="color:#6b7686;white-space:nowrap;">'+(i.requested_qty?escapeHtml(String(i.requested_qty)):'')+' '+escapeHtml(i.unit_of_measure||'')+(i.on_hand!=null?(' &middot; on hand '+escapeHtml(String(i.on_hand))):'')+ful+'</span></div>';
            if(i.item_note) line+='<div style="color:#5b6675;font-size:11.5px;">'+escapeHtml(i.item_note)+'</div>';
            line+=sub;
            if(mng&&editable){
                line+='<div style="display:flex;gap:6px;margin-top:5px;align-items:center;flex-wrap:wrap;"><input id="supF_'+i.id+'" type="number" step="0.1" min="0" placeholder="fulfilled qty" value="'+(i.fulfilled_qty!=null?escapeHtml(String(i.fulfilled_qty)):'')+'" style="width:100px;padding:6px;border:1px solid #d6deea;border-radius:6px;font-size:12.5px;"><input id="supS_'+i.id+'" placeholder="approved substitute (optional)" value="'+escapeHtml(i.approved_substitute||'')+'" style="flex:1;min-width:130px;padding:6px;border:1px solid #d6deea;border-radius:6px;font-size:12.5px;"><button onclick="supplyItemSet('+i.id+')" style="background:#0a6cb4;color:#fff;border:none;border-radius:6px;padding:6px 11px;font-size:12px;font-weight:700;cursor:pointer;">Save</button></div>';
            }
            line+='</div>';
            return line;
        }).join('')||'<div style="color:#5b6675;font-size:13px;">No items.</div>';
        return rows;
    }
    function supplyItemSet(itemId){
        var f=(document.getElementById('supF_'+itemId)||{}).value; var s=(document.getElementById('supS_'+itemId)||{}).value||'';
        supabaseClient.rpc('app_supply_item_set',{p_username:currentUser.username,p_password:sessionPin,p_item_id:itemId,p_fulfilled_qty:(f===''||f==null?null:parseFloat(f)),p_approved_substitute:s}).then(function(r){
            if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Only the office or the assigned person can update items.':r.error.message); return; }
            supplyOpenDetail(window._supplyDetailId);
        }).catch(function(){ alert('Connection error.'); });
    }
    function supplyConfirmReceive(){
        var id=window._supplyDetailId;
        if(!confirm('Confirm that this order was received at your store?')) return;
        supabaseClient.rpc('app_supply_receive',{p_username:currentUser.username,p_password:sessionPin,p_request_id:id}).then(function(r){
            if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Only the requester, store staff, or the office can confirm receipt.':r.error.message); return; }
            supplyOpenDetail(id);
            var inc=document.getElementById('supplyPanel-incoming'); if(inc&&inc.style.display!=='none') supplyLoadList('incoming');
            var mine=document.getElementById('supplyPanel-mine'); if(mine&&mine.style.display!=='none') supplyLoadList('mine');
        }).catch(function(){ alert('Connection error.'); });
    }
    function supplyCatalogClear(){ document.getElementById('supplyCatId').value=''; document.getElementById('supplyCatName').value=''; document.getElementById('supplyCatCategory').value=''; document.getElementById('supplyCatUom').value=''; var m=document.getElementById('supplyCatMsg'); if(m) m.style.display='none'; }
    function supplyLoadCatalogAdmin(){
        var box=document.getElementById('supplyCatList'); box.innerHTML='<p style="text-align:center;color:#6b7686;padding:14px;">Loading&hellip;</p>';
        supabaseClient.rpc('app_supply_catalog',{p_username:currentUser.username,p_password:sessionPin}).then(function(r){
            if(r.error||!r.data){ box.innerHTML='<p style="color:#c0264b;padding:10px;">Could not load.</p>'; return; }
            window._supplyCat=r.data;
            if(!r.data.length){ box.innerHTML='<p style="text-align:center;color:#5b6675;padding:14px;">No items yet.</p>'; return; }
            var cat=''; var html='';
            r.data.forEach(function(c){
                if((c.category||'')!==cat){ cat=c.category||''; html+='<div style="font-size:11px;font-weight:700;color:#5b6675;text-transform:uppercase;margin:10px 0 4px;">'+escapeHtml(cat||'Uncategorized')+'</div>'; }
                html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f0f2f6;font-size:13px;"><span>'+escapeHtml(c.name||'')+(c.uom?(' <span style="color:#5b6675;">&middot; '+escapeHtml(c.uom)+'</span>'):'')+'</span><span style="white-space:nowrap;"><button onclick="supplyCatalogEdit('+c.id+')" style="background:#eef4fb;border:none;color:#0a6cb4;font-weight:700;font-size:12px;padding:5px 10px;border-radius:7px;cursor:pointer;margin-right:5px;">Edit</button><button onclick="supplyCatalogRemove('+c.id+')" style="background:#fbeaec;border:none;color:#c0264b;font-weight:800;font-size:12px;padding:5px 9px;border-radius:7px;cursor:pointer;">Remove</button></span></div>';
            });
            box.innerHTML=html;
        }).catch(function(){ box.innerHTML='<p style="color:#c0264b;padding:10px;">Connection error.</p>'; });
    }
    function supplyCatalogEdit(id){
        var c=(window._supplyCat||[]).filter(function(x){return x.id===id;})[0]; if(!c) return;
        document.getElementById('supplyCatId').value=c.id;
        document.getElementById('supplyCatName').value=c.name||'';
        document.getElementById('supplyCatCategory').value=c.category||'';
        document.getElementById('supplyCatUom').value=c.uom||'';
        try{ document.getElementById('supplyCatName').scrollIntoView({block:'center'}); }catch(e){}
    }
    function supplyCatalogSave(){
        var msg=document.getElementById('supplyCatMsg');
        function show(t,col){ msg.style.display='block'; msg.style.color=col||'#c0264b'; msg.innerHTML=t; }
        var name=(document.getElementById('supplyCatName').value||'').trim();
        if(!name){ show('Enter an item name.'); return; }
        var id=document.getElementById('supplyCatId').value||'';
        supabaseClient.rpc('app_supply_catalog_save',{p_username:currentUser.username,p_password:sessionPin,p_id:id?parseInt(id,10):0,p_name:name,p_category:document.getElementById('supplyCatCategory').value||'',p_uom:document.getElementById('supplyCatUom').value||''}).then(function(r){
            if(r.error){ show(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; }
            show('&#10003; Saved.','#1f7a3d'); supplyCatalogClear(); supplyLoadCatalogAdmin();
        }).catch(function(){ show('Connection error.'); });
    }
    function supplyCatalogRemove(id){
        if(!confirm('Remove this item from the catalog? It stays on past requests.')) return;
        supabaseClient.rpc('app_supply_catalog_remove',{p_username:currentUser.username,p_password:sessionPin,p_id:id}).then(function(r){
            if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; }
            supplyLoadCatalogAdmin();
        }).catch(function(){ alert('Connection error.'); });
    }
    function openCrewTrainer(){
        document.querySelectorAll('.app-view').forEach(function(v){v.style.display='none';});
        var m=document.getElementById('main-menu'); if(m) m.style.display='none';
        var v=document.getElementById('crewTrainerView'); if(v) v.style.display='block';
        var role=(currentUser&&currentUser.role)||'';
        var mgr=(typeof isManagerRole==='function'&&isManagerRole())||/manager|admin|vice|shift lead/i.test(role);
        var mt=document.getElementById('ctTab-manage'); if(mt) mt.setAttribute('data-mgr', mgr?'1':'0');
        crewTrainerTab('mine');
    }
    function crewTrainerTab(t){
        ['mine','manage'].forEach(function(k){
            var p=document.getElementById('ctPanel-'+k); if(p) p.style.display=(k===t)?'block':'none';
            var b=document.getElementById('ctTab-'+k); var hidden=(k==='manage'&&b&&b.getAttribute('data-mgr')!=='1');
            if(b){ b.style.cssText='flex:1;padding:9px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;border:1px solid '+(k===t?'#7b2d8b':'#d6deea')+';background:'+(k===t?'#7b2d8b':'#fff')+';color:'+(k===t?'#fff':'#6b7686')+';'+(hidden?'display:none;':''); }
        });
        if(t==='mine') ctLoadMine();
        if(t==='manage') ctLoadManage();
    }
    function ctLoadMine(){
        var box=document.getElementById('ctMineList'); box.innerHTML='<p style="text-align:center;color:#6b7686;padding:20px;">Loading&hellip;</p>';
        supabaseClient.rpc('app_trainer_assignments',{p_username:currentUser.username,p_password:sessionPin,p_scope:'mine'}).then(function(r){
            if(r.error){ box.innerHTML='<p style="color:#c0264b;padding:14px;">'+escapeHtml(r.error.message)+'</p>'; return; }
            var rows=r.data||[];
            if(!rows.length){ box.innerHTML='<p style="text-align:center;color:#5b6675;padding:24px;">No trainees assigned to you yet. A manager assigns trainees under &ldquo;Assign &amp; manage.&rdquo;</p>'; return; }
            box.innerHTML=rows.map(function(a){
                var nm=(a.trainee||'').replace(/&/g,'').replace(/"/g,'');
                var tp=(a.topic||'').replace(/&/g,'').replace(/"/g,'');
                return '<div style="background:#fff;border:1px solid #e6ebf2;border-radius:12px;padding:13px;margin-bottom:10px;"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;"><div><div style="font-weight:800;color:#1f2a44;font-size:14px;">'+escapeHtml(a.trainee||'')+'</div><div style="font-size:12px;color:#6b7686;">'+(a.topic?escapeHtml(a.topic):'General')+(a.store?(' &middot; '+escapeHtml(a.store)):'')+' &middot; '+(a.signoffs||0)+' coaching note'+((a.signoffs===1)?'':'s')+'</div></div><button onclick="ctOpenCoach('+a.trainee_id+',&quot;'+escapeHtml(nm)+'&quot;,&quot;'+escapeHtml(tp)+'&quot;)" style="background:#7b2d8b;color:#fff;border:none;font-weight:700;font-size:12px;padding:8px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;">Record coaching</button></div></div>';
            }).join('');
        }).catch(function(){ box.innerHTML='<p style="color:#c0264b;padding:14px;">Connection error.</p>'; });
    }
    function ctOpenCoach(traineeId, name, topic){
        document.getElementById('ctCoachModal').style.display='flex';
        document.getElementById('ctCoachTrainee').value=traineeId;
        document.getElementById('ctCoachWho').innerText='Trainee: '+name;
        document.getElementById('ctCoachTopic').value=topic||'';
        document.getElementById('ctCoachNote').value='';
        var m=document.getElementById('ctCoachMsg'); if(m) m.style.display='none';
    }
    function ctSaveCoach(){
        var msg=document.getElementById('ctCoachMsg');
        function show(t,c){ msg.style.display='block'; msg.style.color=c||'#c0264b'; msg.innerHTML=t; }
        var id=parseInt(document.getElementById('ctCoachTrainee').value,10);
        var topic=document.getElementById('ctCoachTopic').value||'';
        var note=(document.getElementById('ctCoachNote').value||'').trim();
        if(!note){ show('Add a short note on what you covered.'); return; }
        show('Saving&hellip;','#6b7686');
        supabaseClient.rpc('app_trainer_signoff',{p_username:currentUser.username,p_password:sessionPin,p_trainee_id:id,p_topic:topic,p_note:note}).then(function(r){
            if(r.error){ show(String(r.error.message||'').indexOf('forbidden')>=0?'You can only record coaching for trainees assigned to you.':r.error.message); return; }
            show('&#10003; Coaching recorded.','#1f7a3d');
            setTimeout(function(){ document.getElementById('ctCoachModal').style.display='none'; ctLoadMine(); }, 900);
        }).catch(function(){ show('Connection error.'); });
    }
    function ctLoadManage(){
        supabaseClient.rpc('app_roster_list',{p_username:currentUser.username,p_password:sessionPin}).then(function(r){
            var people=(r&&r.data)?r.data:[];
            var opts='<option value="">&mdash; choose &mdash;</option>'+people.map(function(x){return '<option value="'+x.id+'">'+escapeHtml(x.name||'')+'</option>';}).join('');
            var ts=document.getElementById('ctTrainerSel'); var te=document.getElementById('ctTraineeSel');
            if(ts) ts.innerHTML=opts; if(te) te.innerHTML=opts;
        }).catch(function(){});
        var box=document.getElementById('ctManageList'); box.innerHTML='<p style="text-align:center;color:#6b7686;padding:14px;">Loading&hellip;</p>';
        supabaseClient.rpc('app_trainer_assignments',{p_username:currentUser.username,p_password:sessionPin,p_scope:'all'}).then(function(r){
            if(r.error){ box.innerHTML='<p style="color:#c0264b;padding:14px;">'+(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':escapeHtml(r.error.message))+'</p>'; return; }
            var rows=r.data||[];
            if(!rows.length){ box.innerHTML='<p style="text-align:center;color:#5b6675;padding:14px;">No active assignments.</p>'; return; }
            box.innerHTML=rows.map(function(a){
                return '<div style="background:#fff;border:1px solid #e6ebf2;border-radius:12px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px;"><div style="font-size:13px;"><b style="color:#1f2a44;">'+escapeHtml(a.trainee||'')+'</b> <span style="color:#5b6675;">trained by</span> <b style="color:#1f2a44;">'+escapeHtml(a.trainer||'')+'</b><div style="font-size:12px;color:#6b7686;">'+(a.topic?escapeHtml(a.topic):'General')+' &middot; '+(a.signoffs||0)+' notes</div></div><button onclick="ctEnd('+a.id+')" style="background:#fbeaec;border:none;color:#c0264b;font-weight:700;font-size:12px;padding:7px 11px;border-radius:8px;cursor:pointer;">End</button></div>';
            }).join('');
        }).catch(function(){ box.innerHTML='<p style="color:#c0264b;padding:14px;">Connection error.</p>'; });
    }
    function ctAssign(){
        var msg=document.getElementById('ctAssignMsg');
        function show(t,c){ msg.style.display='block'; msg.style.color=c||'#c0264b'; msg.innerHTML=t; }
        var trainer=document.getElementById('ctTrainerSel').value||'';
        var trainee=document.getElementById('ctTraineeSel').value||'';
        var topic=document.getElementById('ctTopic').value||'';
        if(!trainer||!trainee){ show('Pick a trainer and a trainee.'); return; }
        if(trainer===trainee){ show('Trainer and trainee must be different people.'); return; }
        show('Saving&hellip;','#6b7686');
        supabaseClient.rpc('app_trainer_assign',{p_username:currentUser.username,p_password:sessionPin,p_trainee_id:parseInt(trainee,10),p_trainer_id:parseInt(trainer,10),p_topic:topic,p_store:''}).then(function(r){
            if(r.error){ show(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; }
            show('&#10003; Assigned.','#1f7a3d');
            document.getElementById('ctTopic').value='';
            ctLoadManage();
        }).catch(function(){ show('Connection error.'); });
    }
    function ctEnd(id){
        if(!confirm('End this training assignment? Past coaching notes are kept.')) return;
        supabaseClient.rpc('app_trainer_end',{p_username:currentUser.username,p_password:sessionPin,p_assignment_id:id}).then(function(r){
            if(r.error){ alert(r.error.message); return; }
            ctLoadManage();
        }).catch(function(){ alert('Connection error.'); });
    }
    function openSupplyRequest(){
        document.querySelectorAll('.app-view').forEach(function(v){v.style.display='none';});
        var m=document.getElementById('main-menu'); if(m) m.style.display='none';
        var v=document.getElementById('supplyRequestView'); if(v) v.style.display='block';
        var mgr=(typeof isManagerRole==='function'&&isManagerRole())||(typeof isMgmt==='function'&&isMgmt());
        document.getElementById('supplyTab-incoming').setAttribute('data-mgr', mgr?'1':'0'); var _ct=document.getElementById('supplyTab-catalog'); if(_ct) _ct.setAttribute('data-mgr', mgr?'1':'0');
        document.getElementById('supplyReqInfo').innerHTML='Requested by <b>'+escapeHtml((currentUser&&currentUser.name)||'')+'</b> &middot; '+new Date().toLocaleDateString();
        var _ss=document.getElementById('supplyStore'); if(_ss){ var _cur=_ss.value; var _stores=(typeof HUB_STORES!=='undefined'?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell']); _ss.innerHTML='<option value="">Select store&hellip;</option>'+_stores.map(function(s){return '<option>'+escapeHtml(s)+'</option>';}).join('')+'<option>Warehouse</option>'; if(_cur) _ss.value=_cur; else if(currentUser&&currentUser.store){ _ss.value=currentUser.store; } }
        var _nd=document.getElementById('supplyNeededDate'); if(_nd){ try{ _nd.min=new Date().toISOString().slice(0,10); }catch(e){} }
        var st=document.getElementById('supplyStore'); if(st && !st.value) st.value=(currentUser&&currentUser.store)||'';
        if(!document.getElementById('supplyItems').children.length) supplyAddItemRow();
        supplyLoadCatalog();
        supplyTab('new');
    }
    function supplyTab(t){
        ['new','mine','incoming','catalog'].forEach(function(k){
            var p=document.getElementById('supplyPanel-'+k); if(p) p.style.display=(k===t)?'block':'none';
            var b=document.getElementById('supplyTab-'+k); var hidden=((k==='incoming'||k==='catalog')&&b&&b.getAttribute('data-mgr')!=='1');
            if(b){ b.style.cssText='flex:1;padding:9px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;border:1px solid '+(k===t?'#D85A30':'#d6deea')+';background:'+(k===t?'#D85A30':'#fff')+';color:'+(k===t?'#fff':'#6b7686')+';'+(hidden?'display:none;':''); }
        });
        if(t==='mine') supplyLoadList('mine');
        if(t==='incoming') supplyLoadList('incoming');
        if(t==='catalog') supplyLoadCatalogAdmin();
    }
    function supplyLoadCatalog(){
        supabaseClient.rpc('app_supply_catalog',{p_username:currentUser.username,p_password:sessionPin}).then(function(r){
            if(r.error||!r.data) return;
            window._supplyCat=r.data;
            document.getElementById('supplyCatalogDL').innerHTML=r.data.map(function(c){return '<option value="'+escapeHtml(c.name||'')+'">'+escapeHtml((c.category||'')+(c.uom?(' - '+c.uom):''))+'</option>';}).join('');
        }).catch(function(){});
    }
    function supplyAddItemRow(){
        var wrap=document.getElementById('supplyItems'); if(!wrap) return;
        var d=document.createElement('div'); d.className='supply-item-row';
        d.style.cssText='display:flex;gap:6px;margin-bottom:6px;align-items:center;';
        d.innerHTML='<input list="supplyCatalogDL" class="si-name" placeholder="Item name" style="flex:2;padding:8px;border:1px solid #d6deea;border-radius:7px;min-width:0;"><input class="si-qty" type="number" min="0" placeholder="Qty" style="width:62px;padding:8px;border:1px solid #d6deea;border-radius:7px;"><input class="si-uom" placeholder="Unit" style="width:70px;padding:8px;border:1px solid #d6deea;border-radius:7px;"><button onclick="this.parentNode.remove()" style="background:#fbeaec;border:none;color:#c0264b;font-weight:800;width:30px;height:30px;border-radius:7px;cursor:pointer;">&times;</button>';
        wrap.appendChild(d);
    }
    function supplySubmit(){
        var msg=document.getElementById('supplyMsg');
        function show(t,c){ msg.style.display='block'; msg.style.color=c||'#c0264b'; msg.innerHTML=t; }
        var items=[];
        document.querySelectorAll('#supplyItems .supply-item-row').forEach(function(row){
            var name=(row.querySelector('.si-name').value||'').trim(); if(!name) return;
            var qty=(row.querySelector('.si-qty').value||'').trim();
            var uom=(row.querySelector('.si-uom').value||'').trim();
            var cat=(window._supplyCat||[]).filter(function(c){return c.name===name;})[0];
            items.push({name:name, qty:qty, uom:uom||(cat?cat.uom:''), catalog_id:cat?String(cat.id):''});
        });
        if(!items.length){ show('Add at least one item.'); return; }
        var reason=(document.getElementById('supplyReason').value||'').trim();
        if(!reason){ show('Please add a short reason.'); return; }
        if((document.getElementById('supplyUrgency').value||'Normal')==='Critical' && reason.trim().length<10){ show('Critical requests need a clear explanation — what ran out and the impact on the store.'); return; }
        show('Submitting&hellip;','#6b7686');
        supabaseClient.rpc('app_supply_create',{p_username:currentUser.username,p_password:sessionPin,
            p_store:document.getElementById('supplyStore').value||'',
            p_needed_by:document.getElementById('supplyNeededDate').value||null,
            p_needed_by_time:document.getElementById('supplyNeededTime').value||'',
            p_urgency:document.getElementById('supplyUrgency').value||'Normal',
            p_runout:document.getElementById('supplyRunout').value||'',
            p_reason:reason, p_notes:document.getElementById('supplyNotes').value||'',
            p_photo_url:null, p_items:items}).then(function(r){
            if(r.error){ show(String(r.error.message||'').indexOf('forbidden')>=0?'You do not have access.':('Could not submit: '+escapeHtml(r.error.message))); return; }
            show('&#10003; Request '+escapeHtml((r.data&&r.data.request_no)||'')+' submitted!','#1f7a3d');
            document.getElementById('supplyReason').value=''; document.getElementById('supplyNotes').value='';
            document.getElementById('supplyItems').innerHTML=''; supplyAddItemRow();
            setTimeout(function(){ supplyTab('mine'); }, 1100);
        }).catch(function(){ show('Connection error.'); });
    }
    function supplyStatusColor(sx){ return ({'Submitted':'#6b7686','Assigned':'#b8860b','Fulfilling':'#0a6cb4','In transit':'#7b2d8b','Received':'#1f7a3d','Closed':'#9aa7b4'})[sx]||'#6b7686'; }
    function supplyAdvanceBtns(rq){
        var next=({'Submitted':'Assigned','Assigned':'Fulfilling','Fulfilling':'In transit','In transit':'Received','Received':'Closed'})[rq.status];
        if(!next) return '';
        return '<div style="margin-top:9px;"><button onclick="supplyAdvance('+rq.id+',&quot;'+next+'&quot;)" style="background:#D85A30;color:#fff;border:none;font-weight:700;font-size:12px;padding:7px 12px;border-radius:8px;cursor:pointer;">Mark '+next+'</button></div>';
    }
    function supplyLoadList(scope){
        var box=document.getElementById(scope==='incoming'?'supplyIncomingList':'supplyMineList');
        box.innerHTML='<p style="text-align:center;color:#6b7686;padding:20px;">Loading&hellip;</p>';
        supabaseClient.rpc('app_supply_list',{p_username:currentUser.username,p_password:sessionPin,p_scope:scope}).then(function(r){
            if(r.error){ box.innerHTML='<p style="color:#c0264b;padding:14px;">'+(String(r.error.message||'').indexOf('forbidden')>=0?'You do not have access to this list.':escapeHtml(r.error.message))+'</p>'; return; }
            window._supplyData=window._supplyData||{}; window._supplyData[scope]=r.data||[];
            supplyRenderRows(scope);
        }).catch(function(){ box.innerHTML='<p style="color:#c0264b;padding:14px;">Connection error.</p>'; });
    }
    function supplyRenderRows(scope){
        var box=document.getElementById(scope==='incoming'?'supplyIncomingList':'supplyMineList'); if(!box) return;
        var all=(window._supplyData&&window._supplyData[scope])||[]; var bar='';
        if(scope==='incoming'){
            window._supplyFilter=window._supplyFilter||{status:lsGet('supFilterStatus',''),urgency:lsGet('supFilterUrg',''),q:''}; var f=window._supplyFilter; try{lsSet('supFilterStatus',f.status||'');lsSet('supFilterUrg',f.urgency||'');}catch(e){}
            var sts=['','New','Submitted','Reviewing','Approved','Assigned','In transit','Received','Closed','Declined'];
            bar='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center;">'
              +'<select onchange="window._supplyFilter.status=this.value;supplyRenderRows(\'incoming\')" style="padding:7px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;">'+sts.map(function(x){return '<option value="'+x+'"'+(f.status===x?' selected':'')+'>'+(x||'All statuses')+'</option>';}).join('')+'</select>'
              +'<select onchange="window._supplyFilter.urgency=this.value;supplyRenderRows(\'incoming\')" style="padding:7px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;"><option value="">All urgency</option><option'+(f.urgency==='Critical'?' selected':'')+'>Critical</option><option'+(f.urgency==='High'?' selected':'')+'>High</option><option'+(f.urgency==='Normal'?' selected':'')+'>Normal</option></select>'
              +'<input value="'+escapeHtml(f.q||'')+'" oninput="window._supplyFilter.q=this.value;supplyRenderRows(\'incoming\')" placeholder="Search store / item&hellip;" style="flex:1;min-width:120px;padding:7px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;">'
              +'<button onclick="supplyExportCSV(\'incoming\')" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-weight:700;font-size:12.5px;cursor:pointer;">&#8595; CSV</button></div>';
            var q=(f.q||'').toLowerCase();
            all=all.filter(function(rq){
                if(f.status && rq.status!==f.status) return false;
                if(f.urgency && (rq.urgency||'Normal')!==f.urgency) return false;
                if(q){ var hay=((rq.store||'')+' '+(rq.requester||'')+' '+((rq.items||[]).map(function(i){return i.name||'';}).join(' '))).toLowerCase(); if(hay.indexOf(q)<0) return false; }
                return true;
            });
        }
        if(!all.length){ box.innerHTML=bar+'<p style="text-align:center;color:#5b6675;padding:24px;">No requests'+(scope==='incoming'?' match.':' yet.')+'</p>'; return; }
        box.innerHTML=bar+all.map(function(rq){
            var items=(rq.items||[]).map(function(i){return escapeHtml(i.name||'')+(i.qty?(' &times;'+i.qty):'')+(i.uom?(' '+escapeHtml(i.uom)):'');}).join(', ');
            var crit=(rq.urgency==='Critical');
            var urg=(rq.urgency&&rq.urgency!=='Normal')?'<span style="font-size:11px;font-weight:700;color:'+(crit?'#c0264b':'#b8860b')+';">'+escapeHtml(rq.urgency)+(crit?' &#9888;':'')+'</span> &middot; ':'';
            return '<div onclick="supplyOpenDetail('+rq.id+')" style="background:#fff;border:1px solid '+(crit?'#f3b4b4':'#e6ebf2')+';border-left:'+(crit?'4px solid #c0264b':'1px solid #e6ebf2')+';border-radius:12px;padding:13px;margin-bottom:10px;cursor:pointer;">'
              +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:800;color:#1f2a44;font-size:14px;">'+escapeHtml(rq.no||('SR-'+rq.id))+'</div><span style="background:'+supplyStatusColor(rq.status)+';color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;">'+escapeHtml(rq.status||'')+'</span></div>'
              +'<div style="font-size:12px;color:#6b7686;margin-top:4px;">'+urg+escapeHtml(rq.store||'')+(scope==='incoming'?(' &middot; '+escapeHtml(rq.requester||'')):'')+(rq.needed_by?(' &middot; needed '+escapeHtml(String(rq.needed_by))):'')+'</div>'
              +'<div style="font-size:13px;color:#1f2a44;margin-top:6px;">'+items+'</div>'
              +(rq.reason?('<div style="font-size:12px;color:#5b6675;margin-top:4px;">'+escapeHtml(rq.reason)+'</div>'):'')
              +'<div style="text-align:right;color:#5b6675;font-size:11px;margin-top:6px;">Tap for details &amp; status &rsaquo;</div></div>';
        }).join('');
    }
    function supplyExportCSV(scope){
        var all=(window._supplyData&&window._supplyData[scope])||[]; var rows=[['Request #','Status','Urgency','Store','Requester','Needed by','Items','Reason']];
        all.forEach(function(rq){ rows.push([rq.no||('SR-'+rq.id),rq.status||'',rq.urgency||'',rq.store||'',rq.requester||'',rq.needed_by||'',(rq.items||[]).map(function(i){return (i.name||'')+(i.qty?(' x'+i.qty):'');}).join('; '),rq.reason||'']); });
        if(typeof downloadCSV==='function') downloadCSV('supply_requests.csv',rows); else alert('Export unavailable.');
    }
    function supplyAdvance(id, status){
        supabaseClient.rpc('app_supply_advance',{p_username:currentUser.username,p_password:sessionPin,p_request_id:id,p_new_status:status,p_note:''}).then(function(r){
            if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'You do not have permission for that.':r.error.message); return; }
            supplyLoadList('incoming');
        }).catch(function(){ alert('Connection error.'); });
    }
    function submitShortage() {
        const btn = document.getElementById('submitShortageBtn'); const form = document.getElementById('shortageForm');
        if(!form.querySelector('select[name="Store"]').value||!form.querySelector('input[name="ManagerName"]').value) { return alert('Please select a store and enter your name!'); }
        btn.innerText = 'Generating PDF...'; btn.disabled = true;
        let pdfHtml = getBrandHeader('Store Shortage Report','#28a745');
        pdfHtml += '<table border="1" cellpadding="12" style="border-collapse:collapse;width:100%;font-size:15px;border-color:#ddd;">';
        new FormData(form).forEach((value,key) => { if(key!=='ReportHTML'&&value.toString().trim()!=='') { pdfHtml += '<tr><td style="background:#f4fbf5;font-weight:bold;color:#28a745;width:40%;">'+key.replace(/([A-Z])/g,' $1').trim().toUpperCase()+'</td><td>'+value+'</td></tr>'; } });
        pdfHtml += '</table></div>';
        document.getElementById('shortageReportHtml').value = pdfHtml;
        fetch(G_URL, { method:'POST', body:new FormData(form) })
        .then(res => res.json())
        .then(googleData => { console.log('[Shortage] GAS:', googleData); saveToSupabase('shortages', form, googleData.pdfUrl, () => { btn.disabled=false; btn.style.backgroundColor='var(--pass-green)'; btn.innerText='REPORT SUBMITTED!'; setTimeout(() => { form.reset(); btn.style.backgroundColor='var(--pass-green)'; btn.innerText='SUBMIT SHORTAGE REPORT'; openMenu(); }, 3000); }); })
        .catch(err => { console.error('[Shortage] GAS error:', err); alert('Could not reach PDF server: '+err.message); btn.disabled=false; btn.innerText='SUBMIT SHORTAGE REPORT'; });
    }

    function submitMaintenance() {
        const btn = document.getElementById('submitMaintBtn'); const form = document.getElementById('maintenanceForm');
        if(!form.querySelector('input[name="MaintenanceItem"]').value||!form.querySelector('input[name="ReporterName"]').value) { return alert('Please fill out the required fields!'); }
        btn.innerText = 'Generating PDF...'; btn.disabled = true;
        document.getElementById('maintenanceSubmittedBy').value = currentUser.name || form.querySelector('input[name="ReporterName"]').value;
        let pdfHtml = getBrandHeader('Required Maintenance','#e67e22');
        pdfHtml += '<table border="1" cellpadding="12" style="border-collapse:collapse;width:100%;font-size:15px;border-color:#ddd;">';
        new FormData(form).forEach((value,key) => { if(key!=='ReportHTML'&&key!=='submitted_by'&&value.toString().trim()!=='') { pdfHtml += '<tr><td style="background:#fdf3e8;font-weight:bold;color:#e67e22;width:40%;">'+key.replace(/([A-Z])/g,' $1').trim().toUpperCase()+'</td><td>'+value+'</td></tr>'; } });
        if(maintPhotos.length>0) { pdfHtml += '<tr><td style="background:#fdf3e8;font-weight:bold;color:#e67e22;">PHOTOS</td><td><div style="display:flex;gap:10px;flex-wrap:wrap;">'; maintPhotos.forEach(p => { pdfHtml += '<img src="'+p+'" style="max-height:150px;border-radius:8px;border:1px solid #ccc;">'; }); pdfHtml += '</div></td></tr>'; }
        pdfHtml += '</table></div>';
        document.getElementById('maintenanceReportHtml').value = pdfHtml;
        fetch(G_URL, { method:'POST', body:new FormData(form) })
        .then(res => res.json())
        .then(googleData => { console.log('[Maintenance] GAS:', googleData); saveToSupabase('maintenance_logs', form, googleData.pdfUrl, () => { btn.disabled=false; btn.style.backgroundColor='var(--pass-green)'; btn.innerText='MAINTENANCE REPORT SENT!'; setTimeout(() => { form.reset(); maintPhotos=[]; document.getElementById('maintPrev').innerHTML=''; btn.style.backgroundColor='#e67e22'; btn.innerText='SUBMIT MAINTENANCE REQUEST'; openMenu(); }, 3000); }); })
        .catch(err => { console.error('[Maintenance] GAS error:', err); alert('Could not reach PDF server: '+err.message); btn.disabled=false; btn.innerText='SUBMIT MAINTENANCE REQUEST'; });
    }

    function submitDamage() {
        const btn = document.getElementById('submitDamageBtn'); const form = document.getElementById('damageForm');
        if(!form.querySelector('select[name="DamageAsset"]').value||!form.querySelector('input[name="ReporterName"]').value) { return alert('Please select an asset and enter your name!'); }
        btn.innerText = 'Generating PDF...'; btn.disabled = true;
        let pdfHtml = getBrandHeader('Vehicle & Trailer Damage','#e74c3c');
        pdfHtml += '<table border="1" cellpadding="12" style="border-collapse:collapse;width:100%;font-size:15px;border-color:#ddd;">';
        new FormData(form).forEach((value,key) => { if(key!=='ReportHTML'&&value.toString().trim()!=='') { pdfHtml += '<tr><td style="background:#fceceb;font-weight:bold;color:#e74c3c;width:40%;">'+key.replace(/([A-Z])/g,' $1').trim().toUpperCase()+'</td><td>'+value+'</td></tr>'; } });
        if(damagePhotos.length>0) { pdfHtml += '<tr><td style="background:#fceceb;font-weight:bold;color:#e74c3c;">DAMAGE PHOTOS</td><td><div style="display:flex;gap:10px;flex-wrap:wrap;">'; damagePhotos.forEach(p => { pdfHtml += '<img src="'+p+'" style="max-height:150px;border-radius:8px;border:1px solid #ccc;">'; }); pdfHtml += '</div></td></tr>'; }
        pdfHtml += '</table></div>';
        document.getElementById('damageReportHtml').value = pdfHtml;
        fetch(G_URL, { method:'POST', body:new FormData(form) })
        .then(res => res.json())
        .then(googleData => { console.log('[Damage] GAS:', googleData); saveToSupabase('damage_reports', form, googleData.pdfUrl, () => { btn.disabled=false; btn.style.backgroundColor='var(--pass-green)'; btn.innerText='DAMAGE REPORT SENT!'; setTimeout(() => { form.reset(); damagePhotos=[]; document.getElementById('damagePrev').innerHTML=''; btn.style.backgroundColor='#e74c3c'; btn.innerText='SUBMIT DAMAGE REPORT'; openMenu(); }, 3000); }); })
        .catch(err => { console.error('[Damage] GAS error:', err); alert('Could not reach PDF server: '+err.message); btn.disabled=false; btn.innerText='SUBMIT DAMAGE REPORT'; });
    }

    // ============================================================
    // CATERING QUOTE BUILDER (Issac only)
    // ============================================================
    const QUOTE_TAX_RATE = 0.0839;

    // ===== Per-city catering tax — configurable in-app (app_settings group 'tax_rates') =====
    // Reuses app_settings_get/set/delete (no new backend). Falls back to QUOTE_TAX_RATE
    // when no city is picked or a city has no rate yet, so nothing breaks before it's configured.
    var HUB_TAX_RATES = {};  // { 'City Name': 8.39 }  percent numbers
    function hubTaxFrac(){
        try{ var sel=document.getElementById('quoteTaxCity'); var c=sel?sel.value:''; if(c && HUB_TAX_RATES[c]!=null){ var pp=parseFloat(HUB_TAX_RATES[c]); if(!isNaN(pp)) return pp/100; } }catch(e){}
        return QUOTE_TAX_RATE;
    }
    function hubTaxCityLabel(){ try{ var sel=document.getElementById('quoteTaxCity'); var c=sel?sel.value:''; return (c&&HUB_TAX_RATES[c]!=null)?c:''; }catch(e){ return ''; } }
    function hubLoadTaxRates(){
        try{
            var pin=sessionPin; if(!pin||!currentUser||!currentUser.username) return;
            supabaseClient.rpc('app_settings_get',{p_username:currentUser.username,p_password:pin,p_group:'tax_rates'}).then(function(r){
                HUB_TAX_RATES={}; ((r&&r.data)||[]).forEach(function(row){ var pct=parseFloat(row.value); if(!isNaN(pct)) HUB_TAX_RATES[row.label||row.key]=pct; });
                var sel=document.getElementById('quoteTaxCity');
                if(sel){ var cur=sel.value; var hh='<option value="">Default ('+(QUOTE_TAX_RATE*100).toFixed(2)+'%)</option>'; Object.keys(HUB_TAX_RATES).sort().forEach(function(c){ hh+='<option value="'+escapeHtml(c)+'">'+escapeHtml(c)+' ('+HUB_TAX_RATES[c]+'%)</option>'; }); sel.innerHTML=hh; if(cur && HUB_TAX_RATES[cur]!=null) sel.value=cur; }
                if(typeof recalcQuoteTotals==='function') recalcQuoteTotals();
            }).catch(function(){});
        }catch(e){}
    }
    function openTaxRatesEditor(){ var ov=document.getElementById('taxRatesModal'); if(!ov){ ov=document.createElement('div'); ov.id='taxRatesModal'; ov.style.cssText='position:fixed;inset:0;background:rgba(20,20,30,.55);z-index:100060;display:flex;align-items:center;justify-content:center;padding:16px;'; document.body.appendChild(ov); } ov.style.display='flex'; taxRatesRender(); }
    function taxRatesCloseEditor(){ var o=document.getElementById('taxRatesModal'); if(o) o.style.display='none'; }
    function taxRatesRender(){
        var ov=document.getElementById('taxRatesModal'); if(!ov) return;
        var rows=Object.keys(HUB_TAX_RATES).sort().map(function(c){ var cj=String(c).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); return '<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #eee;"><div style="flex:1;font-size:13px;">'+escapeHtml(c)+'</div><div style="width:70px;font-size:13px;text-align:right;">'+HUB_TAX_RATES[c]+'%</div><button onclick="taxRatesEdit(\''+cj+'\')" style="background:#eef0f3;border:none;border-radius:7px;padding:5px 9px;cursor:pointer;">Edit</button><button onclick="taxRatesRemove(\''+cj+'\')" style="background:#fdeaea;color:#a01b3e;border:none;border-radius:7px;padding:5px 9px;cursor:pointer;">Remove</button></div>'; }).join('') || '<div style="color:#6b7686;font-size:13px;padding:8px 0;">No cities yet. Add the cities you cater in and their sales-tax rate.</div>';
        ov.innerHTML='<div style="background:#fff;border-radius:16px;max-width:460px;width:100%;max-height:88vh;overflow:auto;padding:18px;"><div style="font-size:18px;font-weight:800;color:#1f2a44;margin-bottom:4px;">Tax rates by city</div><div style="font-size:12.5px;color:#6b7686;margin-bottom:12px;">Set each city&#39;s sales-tax rate. A quote uses the rate for the city you pick on the quote (otherwise the default '+(QUOTE_TAX_RATE*100).toFixed(2)+'%).</div>'+rows+'<div style="display:flex;gap:8px;margin-top:12px;"><input id="taxNewCity" placeholder="City name" style="flex:1;padding:9px;border:1px solid #ddd;border-radius:8px;"><input id="taxNewRate" type="number" step="0.01" placeholder="Rate %" style="width:90px;padding:9px;border:1px solid #ddd;border-radius:8px;"><button onclick="taxRatesSaveNew()" style="background:#185FA5;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-weight:800;cursor:pointer;">Add</button></div><button onclick="taxRatesCloseEditor()" style="width:100%;background:#eef0f3;border:none;border-radius:9px;padding:11px;margin-top:12px;font-weight:700;cursor:pointer;">Done</button></div>';
    }
    function taxRatesSaveNew(){ var c=((document.getElementById('taxNewCity')||{}).value||'').trim(); var v=(document.getElementById('taxNewRate')||{}).value; if(!c){ alert('Enter a city name.'); return; } var pp=parseFloat(v); if(isNaN(pp)||pp<0){ alert('Enter a valid rate %.'); return; } taxRatesSave(c,pp); }
    function taxRatesEdit(c){ var v=prompt('Tax rate % for '+c+':', HUB_TAX_RATES[c]); if(v===null) return; var pp=parseFloat(v); if(isNaN(pp)||pp<0){ alert('Invalid rate.'); return; } taxRatesSave(c,pp); }
    function taxRatesSave(city,pct){ withPin(function(pin){ var key='city_'+String(city).toLowerCase().replace(/[^a-z0-9]+/g,'_'); supabaseClient.rpc('app_settings_set',{p_username:currentUser.username,p_password:pin,p_key:key,p_group:'tax_rates',p_label:city,p_value:String(pct),p_sort:0}).then(function(r){ if(r.error){ alert(r.error.message||'Could not save. (Managers only.)'); return; } HUB_TAX_RATES[city]=pct; taxRatesRender(); hubLoadTaxRates(); }).catch(function(){ alert('Could not save.'); }); }); }
    function taxRatesRemove(city){ if(!confirm('Remove '+city+'?')) return; withPin(function(pin){ var key='city_'+String(city).toLowerCase().replace(/[^a-z0-9]+/g,'_'); supabaseClient.rpc('app_settings_delete',{p_username:currentUser.username,p_password:pin,p_key:key,p_group:'tax_rates'}).then(function(r){ if(r.error){ alert(r.error.message||'Could not remove.'); return; } delete HUB_TAX_RATES[city]; taxRatesRender(); hubLoadTaxRates(); }).catch(function(){ alert('Could not remove.'); }); }); }

    let quoteRowCount = 0;

    // Common line-item templates for quick-adding to a quote
    const QUOTE_TEMPLATES = [
        { label: 'Custard Cart Service (2 hrs)', desc: 'Custard Cart Service (2 hrs)', qty: 1, price: 350 },
        { label: 'Custard Cart Service (3 hrs)', desc: 'Custard Cart Service (3 hrs)', qty: 1, price: 475 },
        { label: 'Additional Hour of Service', desc: 'Additional Hour of Service', qty: 1, price: 100 },
        { label: 'Per-Person Custard Package (per guest)', desc: 'Per-Person Custard Package (per guest)', qty: 50, price: 6 },
        { label: 'Topping Bar Add-On', desc: 'Topping Bar Add-On', qty: 1, price: 75 },
        { label: 'Staffing Fee (per attendant)', desc: 'Staffing Fee (per attendant)', qty: 1, price: 75 },
        { label: 'Delivery Fee', desc: 'Delivery Fee', qty: 1, price: 50 },
        { label: 'Setup / Breakdown Fee', desc: 'Setup / Breakdown Fee', qty: 1, price: 50 }
    ];

    function populateQuoteTemplates() {
        const sel = document.getElementById('quoteTemplateSelect');
        if (!sel || sel.options.length) return;
        const blank = document.createElement('option');
        blank.value = '';
        blank.innerText = 'Select an item to add…';
        sel.appendChild(blank);
        QUOTE_TEMPLATES.forEach((t, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.innerText = t.label + ' — $' + t.price.toFixed(2) + (t.qty > 1 ? ' x' + t.qty : '');
            sel.appendChild(opt);
        });
    }

    function addQuoteTemplateRow() {
        const sel = document.getElementById('quoteTemplateSelect');
        if (!sel || sel.value === '') return;
        const t = QUOTE_TEMPLATES[parseInt(sel.value, 10)];
        if (!t) return;
        addQuoteRow(t.qty, t.desc, t.price);
    }
