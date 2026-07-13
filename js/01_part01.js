    const G_URL = 'https://script.google.com/macros/s/AKfycbw7zND3eu3BFEFEfVYU4pW5cEqBcEhd9mUI_FWPZB02BnI8yEup3yemiynKOaaNEp7dBQ/exec';
    const { createClient } = window.supabase;
    const supabaseUrl = 'https://ikgbihwkqhsfahnswfbz.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrZ2JpaHdrcWhzZmFobnN3ZmJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExOTkxODYsImV4cCI6MjA5Njc3NTE4Nn0.tWnk67bgCWfMmR5WYWnk23BOhlZ4KbRSNWO5SMH3JhI';
    const supabaseClient = createClient(supabaseUrl, supabaseKey);

    const APP_VERSION = '2026.07.12.2329';
    let swReloadPending = false;
    let swRefreshing = false;
    // Views that hold unsaved user input — never reload out from under them.
    const UNSAFE_RELOAD_VIEWS = ['popInView','driverView','shortageView','supplyRequestView','crewTrainerView','maintenanceView','damageView','quotesView','kbView'];
    function isSafeToReload() {
        return !UNSAFE_RELOAD_VIEWS.some(function(id){
            var v = document.getElementById(id);
            return v && v.style.display !== 'none' && v.style.display !== '';
        });
    }
    function applyPendingReloadIfSafe() {
        if (swReloadPending && !swRefreshing && isSafeToReload()) {
            swRefreshing = true;
            location.reload();
        }
    }
    let currentSlide = 0; let slideTimer; let currentUser = { name:'', role:'' }; let currentDashTab = 'Pop-Ins'; var _activityLogData = [];
    let deferredInstallPrompt = null;
    // In-memory only PIN cache (never persisted to localStorage). Used to re-verify
    // sensitive account/admin actions against the secure RPC functions.
    let sessionPin = null;
    function withPin(callback, onCancel) {
        if (sessionPin) { callback(sessionPin); return; }
        try { if (localStorage.getItem('calichesKeep')!=='0') { var _kp=sessionStorage.getItem('calichesPin'); if(_kp){ sessionPin=_kp; callback(sessionPin); return; } } } catch(e){}
        const entered = prompt('Enter your PIN to confirm:');
        if (entered === null || entered.trim() === '') { if (onCancel) onCancel(); return; }
        sessionPin = entered.trim();
        try { if (localStorage.getItem('calichesKeep')!=='0') sessionStorage.setItem('calichesPin', sessionPin); } catch(e){}
        callback(sessionPin);
    }
    let autoSaveTimer = null;
    let savedDraftData = null;
    let questionPhotos = {}; let maintPhotos = []; let damagePhotos = [];
    let totalQuestions = 0;

    // Form permission keys (used for manager-configurable per-user form visibility)
    const FORM_KEYS = [
        { key:'popIn', label:'Pop-In', btnId:'btn-popIn', roleGated:true }, /* visibility owned by applyRoleUI unless explicit per-user perms exist */
        { key:'driver', label:'Driver', btnId:'btn-driver' },
        { key:'shortage', label:'Shortage', btnId:'btn-shortage' },
        { key:'maintenance', label:'Maint.', btnId:'btn-maintenance' },
        { key:'damage', label:'Damage', btnId:'btn-damage' }
    ];

    // ── Theme switch: Blue Light → Pink Light → Dark Scoop ──
    var CAL_THEMES=['blue','pink','dark'];
    var CAL_ICON={ blue:'&#128153;', pink:'&#127800;', dark:'&#127769;' }; // 💙 blue, 🌸 pink, 🌙 dark
    var CAL_TITLE={ blue:'Theme: Blue (light) — tap for Pink', pink:'Theme: Pink (light) — tap for Dark', dark:'Theme: Dark Scoop — tap for Blue' };
    function applyTheme(t){
        if(CAL_THEMES.indexOf(t)<0) t='blue';
        document.body.classList.remove('pinklight','night');
        if(t==='pink') document.body.classList.add('pinklight');
        else if(t==='dark') document.body.classList.add('night');
        try{ localStorage.setItem('calichesTheme', t); }catch(e){}
        var b=document.getElementById('nightToggle'); if(b){ b.innerHTML=CAL_ICON[t]; b.title=CAL_TITLE[t]; }
    }
    function applyNightPref(){
        var t='blue'; try{ t=localStorage.getItem('calichesTheme')||'blue'; }catch(e){}
        applyTheme(t);
    }
    function toggleNight(){
        var cur='blue'; try{ cur=localStorage.getItem('calichesTheme')||'blue'; }catch(e){}
        var i=CAL_THEMES.indexOf(cur); if(i<0) i=0;
        applyTheme(CAL_THEMES[(i+1)%CAL_THEMES.length]);
    }
    try{ document.body.classList.add('newlook'); applyNightPref(); }catch(e){}

    function isPreviewMode() { return localStorage.getItem('calichesPreviewMode') === 'on'; }

    function togglePreviewMode() {
        localStorage.setItem('calichesPreviewMode', isPreviewMode() ? 'off' : 'on');
        applyRoleUI();
        applyFormPermissions();
    }

    // ── MENU TAB SWITCHER ─────────────────────────────────────────
    function switchMenuTab(tab) {
        document.querySelectorAll('.menu-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.menu-tab-content').forEach(c => c.classList.remove('tab-visible'));
        const btn = document.getElementById('tab-' + tab);
        const content = document.getElementById('tab-content-' + tab);
        if (btn) btn.classList.add('active');
        if (content) content.classList.add('tab-visible');
        if (tab === 'home' && typeof loadHomeDay === 'function') loadHomeDay();
        if (tab === 'scheduling' && typeof schedInit === 'function') schedInit();
        if (tab === 'operations' && typeof opsInit === 'function') opsInit();
        syncBottomNav(tab);
    }

    // ── Maintenance & Damage segment (Report / Board) ──
    function opsInit() {
        var board = document.getElementById('maintBoardBtn');
        var seg = document.getElementById('maintSegBoard');
        var canBoard = board && board.style.display !== 'none';
        if (seg) seg.style.display = canBoard ? 'block' : 'none';
        maintSeg('report');
    }
    function maintSeg(which) {
        var rep = (which === 'report');
        var pr = document.getElementById('maintPaneReport'); if (pr) pr.style.display = rep ? 'block' : 'none';
        var pb = document.getElementById('maintPaneBoard'); if (pb) pb.style.display = rep ? 'none' : 'block';
        var br = document.getElementById('maintSegReport'); if (br) br.classList.toggle('on', rep);
        var bb = document.getElementById('maintSegBoard'); if (bb) bb.classList.toggle('on', !rep);
    }

    // ── Merged Tasks screen (My Tasks / Assign) ──
    function openTasks() {
        document.getElementById('main-menu').style.display = 'none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display = 'none'; });
        document.getElementById('tasksView').style.display = 'block';
        window.scrollTo(0, 0);
        var mgr = (typeof schedIsMgr === 'function') && schedIsMgr();
        var st = document.getElementById('taskSegTeam'); if (st) st.style.display = mgr ? 'block' : 'none';
        var sa = document.getElementById('taskSegAssign'); if (sa) sa.style.display = mgr ? 'block' : 'none';
        taskSeg('mine');
        loadMyTasks('tasksMineCard');
    }
    function taskSeg(which) {
        var panes = { mine: 'taskPaneMine', team: 'taskPaneTeam', assign: 'taskPaneAssign' };
        var segs = { mine: 'taskSegMine', team: 'taskSegTeam', assign: 'taskSegAssign' };
        Object.keys(panes).forEach(function(k) {
            var p = document.getElementById(panes[k]); if (p) p.style.display = (k === which) ? 'block' : 'none';
            var b = document.getElementById(segs[k]); if (b) b.classList.toggle('on', k === which);
        });
        if (which === 'team') loadTeamTasks();
    }
    var teamTaskStoreFilter = null, teamShowDone = false, _teamTasksCache = [];
    function loadTeamTasks() {
        var c = document.getElementById('teamTasksList'); if (!c) return;
        var admin = currentUser && (currentUser.isAdminStores === true);
        var loc = admin ? null : (typeof activeStoreLoc === 'function' ? activeStoreLoc() : '');
        var hint = document.getElementById('teamTasksHint');
        if (hint) hint.innerText = admin ? 'Showing tasks for every store.' : ('Showing tasks for ' + (loc || 'your store') + '. Switch stores from the menu.');
        // Quick-add controls (store list from HUB_STORES, due defaults to today)
        var qs = document.getElementById('tqaStore');
        if (qs && !qs.getAttribute('data-init')) {
            qs.innerHTML = (HUB_STORES || []).map(function(s) { return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>'; }).join('');
            var _as = (typeof activeStoreLoc === 'function' ? activeStoreLoc() : '') || '';
            for (var qi = 0; qi < qs.options.length; qi++) { if (qs.options[qi].value === _as) { qs.selectedIndex = qi; break; } }
            qs.setAttribute('data-init', '1');
        }
        var qd = document.getElementById('tqaDue'); if (qd && !qd.value) qd.value = _teamTodayStr();
        c.innerHTML = '<p style="text-align:center;color:#6b7686;font-size:13px;padding:14px;">Loading team tasks&hellip;</p>';
        withPin(function(pin) {
            supabaseClient.rpc('app_tasks_overview', { p_username: currentUser.username, p_password: pin, p_location: (loc || null) }).then(function(r) {
                if (r.error) { if (r.error.code === '42501') sessionPin = null; c.innerHTML = '<p style="color:#c0264b;text-align:center;font-size:13px;padding:10px;">' + escapeHtml(r.error.message) + '</p>'; return; }
                var tasks = r.data || [];
                // Auto-clear: once everyone assigned has finished a task, drop it off the active board (record stays in the database).
                tasks = tasks.filter(function(t) { return !(t.total > 0 && t.done >= t.total); });
                _teamTasksCache = tasks;
                renderTeamTasks();
                if (teamShowDone) loadTeamDone(); else { var dl = document.getElementById('teamDoneList'); if (dl) dl.innerHTML = ''; }
            }).catch(function() { c.innerHTML = '<p style="color:#c0264b;text-align:center;font-size:13px;">Connection error.</p>'; });
        });
    }
    function _teamTodayStr(){ var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function teamTaskStoreOf(t){
        if (t.location) return t.location;
        if (t.store) return t.store;
        var tg = String(t.target || ''), stores = HUB_STORES || [];
        for (var i = 0; i < stores.length; i++) { if (stores[i] && tg.indexOf(stores[i]) >= 0) return stores[i]; }
        return null;
    }
    function renderTeamTasks(){
        var c = document.getElementById('teamTasksList'); if (!c) return;
        var todayStr = _teamTodayStr();
        var all = _teamTasksCache || [];
        // Per-store OPEN / OVERDUE chips
        var chipDiv = document.getElementById('teamTaskChips');
        var byStore = {}, order = [];
        all.forEach(function(t) {
            var s = teamTaskStoreOf(t); if (!s) return;
            if (!byStore[s]) { byStore[s] = { open: 0, late: 0 }; order.push(s); }
            byStore[s].open++;
            if (t.due_date && String(t.due_date) < todayStr) byStore[s].late++;
        });
        window._teamChipStores = order;
        if (teamTaskStoreFilter && order.indexOf(teamTaskStoreFilter) < 0) teamTaskStoreFilter = null;
        if (chipDiv) {
            chipDiv.innerHTML = order.map(function(s, i) {
                var b = byStore[s], on = (teamTaskStoreFilter === s);
                return '<button onclick="teamChipFilter(' + i + ')" style="font-size:11.5px;border:1px solid ' + (on ? '#185FA5' : '#dfe4ea') + ';background:' + (on ? '#185FA5' : '#fff') + ';color:' + (on ? '#fff' : '#33404e') + ';border-radius:99px;padding:5px 11px;font-weight:700;cursor:pointer;">' + escapeHtml(s) + ' &middot; ' + b.open + ' open' + (b.late ? (' &middot; <span style="color:' + (on ? '#ffd9df' : '#c0264b') + ';font-weight:800;">' + b.late + ' late</span>') : '') + '</button>';
            }).join('');
        }
        var tasks = teamTaskStoreFilter ? all.filter(function(t) { return teamTaskStoreOf(t) === teamTaskStoreFilter; }) : all.slice();
        if (!tasks.length) { c.innerHTML = '<p style="text-align:center;color:#6b7686;font-size:13px;padding:14px;">' + (teamTaskStoreFilter ? ('No open tasks for ' + escapeHtml(teamTaskStoreFilter) + '.') : 'No open team tasks. &#127881;') + '</p>'; return; }
        // Sort: overdue first, then by due date (no due date last)
        tasks.sort(function(a, b) {
            var ao = (a.due_date && String(a.due_date) < todayStr) ? 0 : 1;
            var bo = (b.due_date && String(b.due_date) < todayStr) ? 0 : 1;
            if (ao !== bo) return ao - bo;
            var ad = a.due_date ? String(a.due_date) : '9999-12-31', bd = b.due_date ? String(b.due_date) : '9999-12-31';
            return ad < bd ? -1 : (ad > bd ? 1 : 0);
        });
        var h = '';
        tasks.forEach(function(t) {
            var doneAll = (t.total > 0 && t.done >= t.total);
            var dueChip = '', overdue = false;
            if (t.due_date) {
                var dl = Math.round((Date.parse(String(t.due_date)) - Date.parse(todayStr)) / 86400000);
                if (!isNaN(dl)) {
                    var _col, _badge;
                    if (dl < 0) { _col = '#c0392b'; _badge = Math.abs(dl) + 'd overdue'; overdue = true; }
                    else if (dl <= 7) { _col = '#e67e22'; _badge = (dl === 0 ? 'due today' : 'in ' + dl + 'd'); }
                    else { _col = '#16a34a'; _badge = 'in ' + dl + 'd'; }
                    dueChip = ' <span style="background:' + _col + ';color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;white-space:nowrap;">' + _badge + '</span>';
                }
            }
            h += '<div style="background:#fff;border-radius:12px;padding:13px 15px;margin-bottom:10px;box-shadow:0 2px 4px rgba(0,0,0,0.05);' + (overdue ? 'border-left:5px solid #c0392b;' : '') + '">';
            h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;"><div style="font-size:14px;font-weight:700;color:#333;">' + escapeHtml(t.title) + (t.requires_photo ? ' <span style="font-size:10px;color:#185FA5;white-space:nowrap;">&#128247; photo</span>' : '') + '</div>' +
                 '<span style="font-size:11px;font-weight:700;white-space:nowrap;color:' + (doneAll ? '#1d9e75' : (t.total ? '#185FA5' : '#c0264b')) + ';">' + (t.total ? (t.done + '/' + t.total + ' done') : 'no one assigned') + '</span></div>';
            if (t.details) h += '<div style="font-size:12px;color:#6b7686;margin-top:2px;">' + escapeHtml(t.details) + '</div>';
            h += '<div style="font-size:11px;color:#aab;margin-top:4px;">' + escapeHtml(t.target || '') + (t.due_date ? (' &middot; due ' + escapeHtml(t.due_date)) : '') + dueChip + ' &middot; from ' + escapeHtml(t['from'] || '') + '</div>';
            var asg = t.assignees || [];
            if (asg.length) {
                h += '<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:4px;">';
                asg.forEach(function(a) {
                    var d = (a.status === 'done');
                    if (d && a.has_photo) {
                        h += '<button onclick="showTaskPhoto(' + a.assignee_id + ')" style="font-size:10px;border:none;border-radius:8px;padding:2px 8px;background:#e7f7ef;color:#1d7a56;cursor:pointer;">&#128247; ' + escapeHtml(a.name) + '</button>';
                    } else {
                        h += '<span style="font-size:10px;border-radius:8px;padding:2px 8px;background:' + (d ? '#e7f7ef' : '#f1f1f1') + ';color:' + (d ? '#1d7a56' : '#777') + ';">' + (d ? '&#10003; ' : '') + escapeHtml(a.name) + '</span>';
                    }
                });
                h += '</div>';
            }
            h += '<div style="text-align:right;margin-top:8px;"><button onclick="taskNudge(' + t.id + ',this)" style="font-size:11px;border:1px solid #b9d4f1;background:#eef5fd;color:#185FA5;border-radius:8px;padding:4px 10px;font-weight:700;cursor:pointer;margin-right:6px;">&#128073; Nudge</button><button onclick="clearTeamTask(' + t.id + ',this)" style="font-size:11px;border:1px solid #f0c0cc;background:#fff5f8;color:#c0264b;border-radius:8px;padding:4px 10px;font-weight:700;cursor:pointer;">&#128465; Clear</button></div>';
            h += '</div>';
        });
        c.innerHTML = h;
    }
    function teamChipFilter(i){
        var s = (window._teamChipStores || [])[i]; if (!s) return;
        teamTaskStoreFilter = (teamTaskStoreFilter === s) ? null : s;
        renderTeamTasks();
    }
    function teamQuickAdd(){
        var ti = document.getElementById('tqaTitle'), st = document.getElementById('tqaStore'), du = document.getElementById('tqaDue');
        var title = ((ti && ti.value) || '').trim(), store = st && st.value, due = (du && du.value) || null;
        var say = function(m){ if (typeof showUndo === 'function') showUndo(m); else alert(m); };
        if (!title) { say('Type a task title first.'); return; }
        if (!store) { say('Pick a store.'); return; }
        if (!due) { say('Pick a due date — every task is time-sensitive.'); return; }
        withPin(function(pin) {
            supabaseClient.rpc('app_task_create', { p_username: currentUser.username, p_password: pin, p_title: title, p_details: '', p_due: due, p_target_type: 'store', p_target_value: store, p_employee_ids: null, p_completion_mode: 'store' }).then(function(r) {
                if (r.error) { if (r.error.code === '42501') sessionPin = null; say('Error: ' + r.error.message); return; }
                if (ti) ti.value = '';
                say('Task added for ' + store + '.');
                loadTeamTasks();
            }).catch(function() { say('Connection error.'); });
        });
    }
    function taskNudge(taskId, btn){
        if (btn) btn.disabled = true;
        withPin(function(pin) {
            supabaseClient.rpc('app_task_nudge', { p_username: currentUser.username, p_password: pin, p_task_id: taskId }).then(function(r) {
                if (btn) btn.disabled = false;
                if (r.error || !r.data || r.data.ok !== true) {
                    if (r.error && r.error.code === '42501') sessionPin = null;
                    if (btn) btn.style.display = 'none';
                    if (typeof showUndo === 'function') showUndo('Nudge isn\'t available yet.');
                    return;
                }
                var n = r.data.nudged || 0;
                if (typeof showUndo === 'function') showUndo('Reminder sent to ' + n + ' ' + (n === 1 ? 'person' : 'people') + '.'); else alert('Reminder sent to ' + n + '.');
            }).catch(function() { if (btn) { btn.disabled = false; btn.style.display = 'none'; } if (typeof showUndo === 'function') showUndo('Nudge isn\'t available yet.'); });
        }, function() { if (btn) btn.disabled = false; });
    }
    function toggleTeamDone(){
        teamShowDone = !teamShowDone;
        var b = document.getElementById('teamDoneToggleBtn');
        if (b) { b.style.background = teamShowDone ? '#1d9e75' : '#fff'; b.style.color = teamShowDone ? '#fff' : '#1d7a56'; b.style.borderColor = teamShowDone ? '#1d9e75' : '#cfe7da'; }
        var dl = document.getElementById('teamDoneList');
        if (!teamShowDone) { if (dl) dl.innerHTML = ''; return; }
        loadTeamDone();
    }
    function loadTeamDone(){
        var dl = document.getElementById('teamDoneList'); if (!dl) return;
        dl.innerHTML = '<p style="text-align:center;color:#6b7686;font-size:12.5px;padding:8px;">Loading completed tasks&hellip;</p>';
        var needsDb = '<p style="text-align:center;color:#9a7400;background:#fff8e6;border:1px solid #ffe39a;border-radius:9px;padding:9px;font-size:12.5px;">Completed-task history needs the new database update.</p>';
        withPin(function(pin) {
            supabaseClient.rpc('app_tasks_done_recent', { p_username: currentUser.username, p_password: pin, p_days: 7 }).then(function(r) {
                if (r.error || !Array.isArray(r.data)) { if (r.error && r.error.code === '42501') sessionPin = null; dl.innerHTML = needsDb; return; }
                var rows = r.data;
                window._teamDoneRows = rows;
                if (!rows.length) { dl.innerHTML = '<p style="text-align:center;color:#6b7686;font-size:12.5px;padding:8px;">Nothing completed in the last 7 days.</p>'; return; }
                var h = '<div style="margin-top:14px;"><div style="font-size:12px;font-weight:800;color:#1d7a56;margin:0 2px 8px;">&#9989; RECENTLY COMPLETED (7 DAYS)</div>';
                rows.forEach(function(d, i) {
                    h += '<div style="background:#f7f9f8;border:1px solid #e2ece6;border-radius:12px;padding:11px 13px;margin-bottom:8px;opacity:.92;">' +
                         '<div style="font-size:13.5px;font-weight:700;color:#4a5560;text-decoration:line-through;">' + escapeHtml(d.title || '') + '</div>' +
                         (d.details ? '<div style="font-size:12px;color:#8a94a0;">' + escapeHtml(d.details) + '</div>' : '') +
                         '<div style="font-size:11px;color:#6b7686;margin-top:4px;">&#10003; ' + escapeHtml(d.completed_by || '') + (d.completed_at ? (' &middot; ' + socFmt(d.completed_at)) : '') + (d.location ? (' &middot; ' + escapeHtml(d.location)) : '') + (d.target_desc ? (' &middot; ' + escapeHtml(d.target_desc)) : '') + '</div>';
                    if (d.proof_photo) {
                        h += '<div style="margin-top:6px;"><button onclick="teamDoneShowPhoto(' + i + ')" style="font-size:10px;border:none;border-radius:8px;padding:2px 8px;background:#e7f7ef;color:#1d7a56;cursor:pointer;">&#128247; ' + escapeHtml(d.completed_by || 'View photo') + '</button></div>';
                    }
                    h += '</div>';
                });
                h += '</div>';
                dl.innerHTML = h;
            }).catch(function() { dl.innerHTML = needsDb; });
        });
    }
    function teamDoneShowPhoto(i){
        var d = (window._teamDoneRows || [])[i]; if (!d || !d.proof_photo) return;
        var src = String(d.proof_photo);
        if (/^\d+$/.test(src)) { showTaskPhoto(Number(src)); return; }
        var body = document.getElementById('taskPhotoBody');
        var m = document.getElementById('taskPhotoModal'); if (m) m.style.display = 'flex';
        if (body) {
            if (src.indexOf('data:image') === 0 || src.indexOf('http') === 0) { body.innerHTML = '<img src="' + src.replace(/"/g, '&quot;') + '" style="max-width:100%;max-height:70vh;border-radius:8px;">'; }
            else { body.innerHTML = '<span style="color:#c0264b;">No photo available.</span>'; }
        }
    }

    // ── Merged Schedule screen (My Shifts / Build) ──
    function schedIsMgr() {
        var r = currentUser && currentUser.role;
        if (r === 'Vice President/Co-Owner') r = 'Admin Manager';
        return (r === 'Admin Manager' || r === 'Manager') ||
               (currentUser && currentUser.is_developer === true) ||
               (currentUser && currentUser.isStoreManager === true);
    }
    function schedInit() {
        var mgr = schedIsMgr();
        var r = currentUser && currentUser.role;
        if (r === 'Vice President/Co-Owner') r = 'Admin Manager';
        var admin = (r === 'Admin Manager') || (currentUser && currentUser.is_developer === true);
        var setD = function(id, on, disp) { var e = document.getElementById(id); if (e) e.style.display = on ? (disp || 'block') : 'none'; };
        setD('schedSegBuild', mgr, 'block');
        setD('btn-scheduling', mgr, 'block');
        setD('schedTimesheetsBtn', mgr, 'block');
        setD('schedRosterBtn', admin, 'block');
        schedSeg('mine');
        loadSchedMyShifts();
        schedInitDragReorder();
    }
    function schedSeg(which) {
        var mine = (which === 'mine');
        var pm = document.getElementById('schedPaneMine'); if (pm) pm.style.display = mine ? 'block' : 'none';
        var pb = document.getElementById('schedPaneBuild'); if (pb) pb.style.display = mine ? 'none' : 'block';
        var bm = document.getElementById('schedSegMine'); if (bm) bm.classList.toggle('on', mine);
        var bb = document.getElementById('schedSegBuild'); if (bb) bb.classList.toggle('on', !mine);
    }
    function loadSchedMyShifts() {
        var c = document.getElementById('schedMyShifts'); if (!c) return;
        withPin(function(pin) {
            supabaseClient.rpc('app_emp_home', { p_username: currentUser.username, p_password: pin }).then(function(res) {
                if (res.error) { if (res.error.code === '42501') sessionPin = null; c.innerHTML = '<p style="color:#6b7686;font-size:13px;text-align:center;padding:10px;">Could not load shifts.</p>'; return; }
                var d = res.data || {};
                if (d.linked !== true) { c.innerHTML = '<div class="home-card"><p style="margin:0;color:#667;font-size:13px;">Your shifts show here once a manager links your login in the Roster.</p></div>'; return; }
                var sh = d.shifts || [];
                if (typeof empHomeState === 'object' && empHomeState) empHomeState.shifts = sh;
                if (!sh.length) { c.innerHTML = '<div class="home-card"><p style="margin:0;color:#445;font-size:13px;">No upcoming shifts scheduled &mdash; enjoy the break! &#127846;</p></div>'; return; }
                var h = '<div class="home-card"><div class="home-card-label">MY UPCOMING SHIFTS</div>';
                sh.forEach(function(s, i) {
                    h += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;' + (i < sh.length - 1 ? 'border-bottom:1px solid #eee;' : '') + '">' +
                        '<span style="font-size:14px;color:#333;">' + escapeHtml((s.date || '') + '  ' + (s.start || '') + '-' + (s.end || '') + (s.location ? ('  @ ' + s.location) : '')) + '</span>' +
                        '<button onclick="openSwap(' + s.id + ',' + i + ')" style="background:#0d6eaf;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:bold;cursor:pointer;white-space:nowrap;">Request cover</button></div>';
                });
                h += '</div>'; c.innerHTML = h;
            }).catch(function() { c.innerHTML = '<p style="color:#6b7686;font-size:13px;text-align:center;padding:10px;">Connection error.</p>'; });
        }, function() { c.innerHTML = '<p style="color:#6b7686;font-size:13px;text-align:center;padding:10px;">PIN required to load shifts.</p>'; });
    }

    // ── App bottom nav ──
    function syncBottomNav(tab) {
        var map = { home:'home', scheduling:'schedule', operations:'more', teamhr:'more', management:'more', sections:'more' };
        var dest = map[tab] || '';
        document.querySelectorAll('.hbn-item').forEach(function(b){ b.classList.remove('active'); });
        var el = document.getElementById('hbn-' + dest);
        if (el) el.classList.add('active');
    }
    function ensureMenuVisible() {
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display = 'none'; });
        var m = document.getElementById('main-menu');
        if (m) m.style.display = 'block';
    }
    function hubNav(dest) {
        if (dest === 'home') { ensureMenuVisible(); switchMenuTab('home'); window.scrollTo(0,0); }
        else if (dest === 'schedule') { ensureMenuVisible(); switchMenuTab('scheduling'); window.scrollTo(0,0); }
        else if (dest === 'tasks') { openTasks(); }
        else if (dest === 'more') { ensureMenuVisible(); switchMenuTab('sections'); window.scrollTo(0,0); }
    }

    /* Phase-3: small inline "couldn't load" card with a retry button (replaces silent catches) */
    function _hubRetryHtml(label, call){ return '<div style="background:var(--surface,#fff);border:1px solid var(--bd,#ececf2);border-radius:11px;padding:10px 12px;margin:6px 0;font-size:12.5px;color:var(--txt2,#6b7686);display:flex;align-items:center;gap:8px;"><span>&#9888;&#65039;</span><span style="flex:1;">'+label+'</span><button onclick="'+call+'" style="background:#185FA5;color:#fff;border:none;border-radius:7px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;">Tap to retry</button></div>'; }
    // ── Personal Home: next shift + tasks ──
    function loadHomeDay() {
        var el = document.getElementById('homeDayCard');
        if (!el) return;
        renderJumpTo();
        loadMyTasks('homeTasksCard');
        if (typeof loadRecognition === 'function') loadRecognition();
        withPin(function(pin) {
            supabaseClient.rpc('app_emp_home', { p_username: currentUser.username, p_password: pin }).then(function(res) {
                if (res.error) { if (res.error.code === '42501') sessionPin = null; renderHomeDay(null); return; }
                renderHomeDay(res.data || {});
            }).catch(function(){ renderHomeDay(null); });
        }, function(){ renderHomeDay(null); });
    }
    /* ===================== NEEDS YOU TODAY (personal action hub) ===================== */
    function _aiIsFinance(){ var r=(currentUser&&currentUser.role)||''; var m=false; try{ m=(typeof woIsMgr==='function'&&woIsMgr()); }catch(e){} return m || r==='Finance Approver'; }
    function aiCard(){ var host=document.getElementById('homeDayCard'); if(!host) return null; var c=document.getElementById('homeActionCard'); if(!c){ c=document.createElement('div'); c.id='homeActionCard'; host.parentNode.insertBefore(c, host); } return c; }
    function aiRow(emoji,label,count,color,onclick){
        return '<button onclick="'+onclick+'" style="display:flex;width:100%;align-items:center;gap:10px;text-align:left;background:#fff;border:1px solid #ececf2;border-radius:11px;padding:11px 13px;margin-bottom:7px;cursor:pointer;">'+
            '<span style="font-size:18px;">'+emoji+'</span>'+
            '<span style="flex:1;font-size:13.5px;color:#26242b;font-weight:600;">'+label+'</span>'+
            '<span style="background:'+(color||'#185FA5')+';color:#fff;font-size:12px;font-weight:800;min-width:22px;text-align:center;padding:2px 8px;border-radius:99px;">'+count+'</span>'+
            '<span style="color:#c2c7d0;font-size:16px;">&rsaquo;</span></button>';
    }
    function loadActionItems(){
        var card=aiCard(); if(!card) return;
        withPin(function(pin){
            var u={p_username:currentUser.username,p_password:pin};
            var _aiErr=false;
            function rc(fn,extra){ return supabaseClient.rpc(fn,Object.assign({},u,extra||{})).then(function(r){ if(r.error){ _aiErr=true; return null; } return r.data; }).catch(function(){ _aiErr=true; return null; }); }
            var jobs=[ rc('app_pending_schedule_confirm'), rc('app_supply_list',{p_scope:'incoming'}), rc('app_wo_list',{p_scope:'queue'}), rc('app_lp_my'), rc('app_my_support_notes'), (_aiIsFinance()?rc('wo_invoice_list'):Promise.resolve(null)) ];
            Promise.all(jobs).then(function(res){
                var sched=res[0], supply=res[1]||[], wo=res[2]||[], lp=res[3]||{}, notes=res[4], inv=res[5];
                var items=[];
                if(sched && sched.needs_confirm===true){ items.push(aiRow('&#128197;','Confirm your schedule for the week','!','#a01b3e','hubNav(\'schedule\')')); }
                var sCount=(supply||[]).filter(function(x){ return ['Received','Closed','Cancelled','Denied'].indexOf(String(x.status||''))<0; }).length;
                if(sCount>0){ items.push(aiRow('&#128230;','Supply requests need your action',sCount,'#9a5b00','openSupplyRequest()')); }
                var wCount=(wo||[]).filter(function(x){ return String(x.status||'').toLowerCase().indexOf('complet')<0; }).length;
                if(wCount>0){ items.push(aiRow('&#128295;','Work orders assigned to you',wCount,'#185FA5','openWorkOrders()')); }
                if(Array.isArray(inv)){ var iCount=inv.filter(function(x){ var s=String(x.status||''); return s==='submitted'||s==='operational_verified'; }).length; if(iCount>0){ items.push(aiRow('&#129534;','Invoices awaiting your approval',iCount,'#5b3aa6','openMaintBilling()')); } }
                var tCount=((lp&&lp.enrollments)||[]).filter(function(e){ return String(e.status||'')!=='completed'; }).length;
                if(tCount>0){ items.push(aiRow('&#127891;','Training to finish',tCount,'#1f7a3d','openTrainingPortal()')); }
                var nCount=(notes&&notes.notes)?notes.notes.length:0;
                if(nCount>0){ items.push(aiRow('&#128172;','New coaching notes for you',nCount,'#5b3aa6','openMyNotes()')); }
                if(!items.length){ if(_aiErr){ card.innerHTML=_hubRetryHtml('Couldn&rsquo;t load your action items','loadActionItems()'); return; } card.innerHTML='<div class="home-card" style="background:#f3faf5;border:1px solid #d8eede;"><div style="display:flex;align-items:center;gap:8px;"><span style="font-size:18px;">&#9989;</span><div style="font-size:13.5px;color:#1b7a3d;font-weight:700;">You&rsquo;re all caught up today</div></div></div>'; return; }
                card.innerHTML='<div class="home-card" style="background:linear-gradient(135deg,#ffffff,#f6f4ff);border:1px solid #e6e2f3;">'+
                    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:9px;"><span style="font-size:18px;">&#9889;</span><div class="home-card-label" style="color:#5b3aa6;">NEEDS YOU TODAY</div><span style="flex:1;"></span><span style="font-size:11px;color:#5b6675;">'+items.length+' item'+(items.length===1?'':'s')+'</span></div>'+
                    items.join('')+'</div>';
            });
        });
    }
    /* =================== END NEEDS YOU TODAY =================== */
    /* Hide the Ask Mr. Scoopy widget while a form or modal is open so it never covers a Save/Submit button */
    function hubSyncScoopy(){
        try{
            var w=document.getElementById('aiChatWidget'); if(!w) return;
            var panel=document.getElementById('aiChatPanel');
            if(panel){ var pcs=window.getComputedStyle(panel); if(pcs.display!=='none'){ w.classList.remove('scoopy-hidden'); return; } }
            var blocked=false,i,els;
            els=document.querySelectorAll('.modal-overlay,[id$="Modal"]');
            for(i=0;i<els.length;i++){ if(els[i].id==='aiChatPanel') continue; var cs=window.getComputedStyle(els[i]); if(cs.display!=='none' && cs.visibility!=='hidden'){ blocked=true; break; } }
            if(!blocked){ els=document.getElementsByClassName('save-btn'); for(i=0;i<els.length;i++){ if(els[i].offsetParent!==null){ blocked=true; break; } } }
            w.classList.toggle('scoopy-hidden', blocked);
        }catch(e){}
    }
    try{ if(!window._scoopySyncStarted){ window._scoopySyncStarted=true; setInterval(hubSyncScoopy, 500); } }catch(e){}
    /* ===================== HOME QUICK-JUMP SEARCH ===================== */
    function renderHomeSearch(){
        var host=document.getElementById('homeDayCard'); if(!host) return;
        var c=document.getElementById('homeSearchCard');
        if(!c){ c=document.createElement('div'); c.id='homeSearchCard'; host.parentNode.insertBefore(c, host); }
        if(document.getElementById('hubSearchInput')) return;
        c.innerHTML='<div style="position:relative;margin-bottom:10px;"><span style="position:absolute;left:12px;top:11px;font-size:15px;opacity:.6;">&#128269;</span><input id="hubSearchInput" oninput="hubQuickSearch(this.value)" onfocus="hubQuickSearch(this.value)" onkeydown="hubSearchKey(event)" placeholder="Find anything&hellip;" autocomplete="off" style="width:100%;padding:11px 13px 11px 36px;border:1px solid #e0e0ea;border-radius:11px;font-size:14px;box-sizing:border-box;background:#fff;"><div id="hubSearchResults" style="display:none;position:absolute;left:0;right:0;top:46px;background:#fff;border:1px solid #ececf2;border-radius:11px;box-shadow:0 6px 22px rgba(0,0,0,.12);z-index:50;overflow:hidden;"></div></div>';
    }
    /* "Find Anything" search — runs on the single HUB_REGISTRY (auto DOM tiles + static
       destinations). Ranked by usage (trackUse data) then label-match quality. Role-aware:
       hidden tiles / failed roleChecks never appear. Same engine drives the Home dropdown
       (#hubSearchResults) and the header 🔍 overlay (#hubSearchOvResults). */
    function hubSearchScore(e,q){
        var L=String(e.label||'').toLowerCase();
        if(L===q) return 100;
        if(L.indexOf(q)===0) return 90;
        if((' '+L).indexOf(' '+q)>=0) return 80;
        if(L.indexOf(q)>=0) return 70;
        var kws=e.keywords||[],i,k;
        for(i=0;i<kws.length;i++){ k=String(kws[i]).toLowerCase(); if(k===q) return 65; if(k.indexOf(q)===0) return 60; if(k.indexOf(q)>=0) return 50; }
        if(String(e.sub||'').toLowerCase().indexOf(q)>=0) return 40;
        if(String(e.section||'').toLowerCase().indexOf(q)>=0) return 20;
        if(q.indexOf(' ')>0){ /* multi-word: every word somewhere in the haystack */
            var hay=(L+' '+kws.join(' ')+' '+String(e.sub||'')).toLowerCase();
            var ws=q.split(/\s+/),ok=true;
            for(i=0;i<ws.length;i++){ if(ws[i] && hay.indexOf(ws[i])<0){ ok=false; break; } }
            if(ok) return 30;
        }
        return 0;
    }
    function hubSearchSelect(it, boxId){
        try{ var inp=document.getElementById('hubSearchInput'); if(inp) inp.value=''; }catch(e){}
        try{ var box=document.getElementById(boxId); if(box){ box.style.display='none'; box.innerHTML=''; } }catch(e){}
        if(boxId==='hubSearchOvResults'){ try{ closeHubSearchOverlay(); }catch(e){} }
        if(it.key){ try{ trackUse(it.key); }catch(e){} }
        try{ it.go(); }catch(e){}
    }
    function hubSearchRow(it, boxId, isNew){
        var b=document.createElement('button');
        b.style.cssText='display:flex;width:100%;align-items:center;gap:9px;text-align:left;background:#fff;border:none;border-bottom:1px solid #f3f4f8;padding:10px 13px;cursor:pointer;font-size:13.5px;color:#26242b;';
        b.innerHTML='<span style="font-size:16px;">'+(it.emoji||'&#128204;')+'</span>'+
            '<span style="flex:1;min-width:0;"><span style="display:block;">'+escapeHtml(it.label||'')+(isNew?' <span style="background:#ede4fb;color:#5b3aa6;font-size:9.5px;font-weight:800;padding:1px 6px;border-radius:99px;vertical-align:1px;">NEW</span>':'')+'</span>'+
            (it.section?'<span style="display:block;font-size:10.5px;color:#9aa2b1;">'+escapeHtml(it.section)+'</span>':'')+'</span>';
        b.addEventListener('click',function(){ hubSearchSelect(it, boxId); });
        return b;
    }
    function hubQuickSearch(q, boxId){
        boxId=boxId||'hubSearchResults';
        var box=document.getElementById(boxId); if(!box) return;
        q=(q||'').trim().toLowerCase();
        var reg=[]; try{ reg=hubRegistryAll(); }catch(e){ reg=[]; }
        if(!q){
            /* Empty query: "✨ New this month" — recent additions, role-filtered by the registry. */
            var fresh=[]; try{ (NEW_THIS_MONTH||[]).forEach(function(id){ for(var i=0;i<reg.length;i++){ if(reg[i].id===id){ fresh.push(reg[i]); break; } } }); }catch(e){}
            if(!fresh.length){ box.style.display='none'; box.innerHTML=''; return; }
            box.innerHTML='';
            var hd=document.createElement('div');
            hd.style.cssText='padding:9px 13px 5px;font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#5b3aa6;background:#faf8ff;';
            hd.innerHTML='&#10024; New this month';
            box.appendChild(hd);
            fresh.slice(0,6).forEach(function(it){ box.appendChild(hubSearchRow(it, boxId, true)); });
            box.style.display='block';
            return;
        }
        var u={}; try{ u=getUsage(); }catch(e){}
        var out=[];
        reg.forEach(function(e){ var s=hubSearchScore(e,q); if(s>0){ e._score=s; e._use=u[e.key]||0; out.push(e); } });
        if(!out.length){ box.style.display='block'; box.innerHTML='<div style="padding:11px 13px;color:#5b6675;font-size:13px;">No tools match that.</div>'; return; }
        out.sort(function(a,b){ return (b._use-a._use) || (b._score-a._score) || String(a.label).localeCompare(String(b.label)); });
        box.innerHTML='';
        out.slice(0,8).forEach(function(it){ box.appendChild(hubSearchRow(it, boxId, false)); });
        box.style.display='block';
    }
    function hubSearchKey(ev, boxId){
        boxId=boxId||'hubSearchResults';
        try{
            if(ev.key==='Enter'){ ev.preventDefault(); var box=document.getElementById(boxId); if(box){ var first=box.querySelector('button'); if(first) first.click(); } }
            else if(ev.key==='Escape'){ if(boxId==='hubSearchOvResults'){ closeHubSearchOverlay(); } else { var b2=document.getElementById(boxId); if(b2){ b2.style.display='none'; } } }
        }catch(e){}
    }
    /* Header 🔍 — the same search from every main screen, as a small overlay sheet. */
    function openHubSearchOverlay(){
        var o=document.getElementById('hubSearchOverlay');
        if(!o){
            o=document.createElement('div'); o.id='hubSearchOverlay';
            o.style.cssText='position:fixed;inset:0;background:rgba(20,24,40,.45);z-index:100060;display:none;';
            o.innerHTML='<div style="max-width:560px;margin:14px auto 0;padding:0 12px;">'+
                '<div style="background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden;">'+
                '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #f0f1f6;">'+
                '<span style="font-size:15px;opacity:.6;">&#128269;</span>'+
                '<input id="hubSearchOvInput" oninput="hubQuickSearch(this.value,\'hubSearchOvResults\')" onkeydown="hubSearchKey(event,\'hubSearchOvResults\')" placeholder="Find anything&hellip;" autocomplete="off" style="flex:1;border:none;outline:none;font-size:15px;background:transparent;color:#26242b;">'+
                '<button onclick="closeHubSearchOverlay()" style="background:#eef0f3;border:none;border-radius:8px;padding:6px 10px;font-weight:800;cursor:pointer;color:#5b6675;">&times;</button></div>'+
                '<div id="hubSearchOvResults" style="max-height:62vh;overflow:auto;"></div></div></div>';
            o.addEventListener('click',function(ev){ if(ev.target===o) closeHubSearchOverlay(); });
            document.body.appendChild(o);
        }
        o.style.display='block';
        var inp=document.getElementById('hubSearchOvInput');
        if(inp){ inp.value=''; try{ hubQuickSearch('', 'hubSearchOvResults'); }catch(e){} setTimeout(function(){ try{ inp.focus(); }catch(e){} }, 60); }
    }
    function closeHubSearchOverlay(){ var o=document.getElementById('hubSearchOverlay'); if(o) o.style.display='none'; }
    /* =================== END HOME QUICK-JUMP SEARCH =================== */
    /* ===================== DATA RETENTION ===================== */
    var HUB_RETENTION_YEARS='7';
    function rtOv(){ var o=document.getElementById('rtModal'); if(!o){ o=document.createElement('div'); o.id='rtModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(o);} o.style.display='block'; return o; }
    function rtClose(){ var o=document.getElementById('rtModal'); if(o) o.style.display='none'; }
    function rtIsAdmin(){ return !!(currentUser&&(currentUser.is_developer===true||['Admin Manager','Vice President/Co-Owner'].indexOf(currentUser.role)>=0)); }
    function rtLabel(t){ var m={discipline_actions:'Discipline actions',employee_notes:'Employee notes',work_orders:'Work orders',wo_invoices:'Maintenance invoices',supply_requests:'Supply requests',yv_cases:'Your Voice cases',store_metrics:'Store scorecards',fr_fundraisers:'Fundraisers'}; return m[t]||t; }
    function openRetention(){ if(!rtIsAdmin()){ alert('Data retention is for admins.'); return; }
        rtOv().innerHTML='<div style="padding:12px 14px;"><button onclick="rtClose()" style="background:#eef0f3;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:700;">&times; Close</button></div><div style="text-align:center;color:#6b7686;padding:34px;">Loading data retention&hellip;</div>';
        withPin(function(pin){
            supabaseClient.rpc('app_settings_get',{p_username:currentUser.username,p_password:pin,p_group:'retention'}).then(function(r){
                var yrs='7'; (r.data||[]).forEach(function(x){ if(x.key==='years') yrs=x.value||'7'; }); HUB_RETENTION_YEARS=yrs;
                supabaseClient.rpc('app_retention_status',{p_username:currentUser.username,p_password:pin}).then(function(s){ rtRender(yrs,s.data||[],s.error); }).catch(function(){ rtRender(yrs,[],{message:'Could not load status.'}); });
            }).catch(function(){ rtOv().innerHTML='<div style="padding:30px;text-align:center;color:#c0264b;">Could not load.</div><div style="text-align:center;"><button onclick="rtClose()" style="background:#eef0f3;border:none;border-radius:9px;padding:10px 16px;cursor:pointer;">Close</button></div>'; });
        });
    }
    function rtSaveYears(){ var v=(document.getElementById('rtYears')||{}).value||'7'; v=String(v).trim(); if(!(parseInt(v,10)>=1)){ alert('Enter a number of years (1 or more).'); return; }
        withPin(function(pin){ supabaseClient.rpc('app_settings_set',{p_username:currentUser.username,p_password:pin,p_key:'years',p_group:'retention',p_label:'Minimum retention (years)',p_value:v,p_sort:0}).then(function(r){ if(r.error){ alert(r.error.message||'Could not save.'); return; } HUB_RETENTION_YEARS=v; alert('Saved. Records are kept at least '+v+' years.'); }).catch(function(){ alert('Could not save.'); }); });
    }
    function rtRender(yrs,rows,err){
        var h='<div style="background:linear-gradient(120deg,#3b2f6b,#106ab3);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">Data Retention</b><button onclick="rtClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:15px;">&times;</button></div>';
        h+='<div style="max-width:680px;margin:0 auto;padding:16px 16px 50px;">';
        h+='<p style="font-size:13px;color:#6b7686;margin-top:0;">Records are <b>retained, not deleted</b> &mdash; everything in the Hub soft-archives. This sets the minimum number of years we keep data, and shows how far back each record type currently goes.</p>';
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:14px;margin-bottom:14px;"><label style="font-size:13px;font-weight:700;color:#26242b;">Minimum retention (years)</label><div style="display:flex;gap:8px;margin-top:6px;"><input id="rtYears" type="number" min="1" value="'+escapeHtml(yrs)+'" style="flex:1;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;"><button onclick="rtSaveYears()" style="background:var(--caliches-blue,#185FA5);color:#fff;border:none;border-radius:8px;padding:0 18px;font-weight:800;cursor:pointer;">Save</button></div></div>';
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:6px;">How far back our records go</div>';
        if(err){ h+='<div style="color:#c0264b;font-size:13px;">'+escapeHtml(err.message||'Could not load status.')+'</div>'; }
        else if(!rows.length){ h+='<div style="color:#5b6675;font-size:13px;">No records yet.</div>'; }
        else { h+='<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="text-align:left;color:#5b6675;font-size:11px;text-transform:uppercase;"><th style="padding:6px;">Record type</th><th style="padding:6px;text-align:right;">Rows</th><th style="padding:6px;text-align:right;">Oldest</th></tr></thead><tbody>';
            rows.forEach(function(r){ h+='<tr style="border-top:1px solid #f0eef4;"><td style="padding:6px;font-weight:600;color:#26242b;">'+escapeHtml(rtLabel(r.tbl))+'</td><td style="padding:6px;text-align:right;">'+(r.row_count==null?'&mdash;':r.row_count)+'</td><td style="padding:6px;text-align:right;color:#6b7686;">'+(r.oldest?escapeHtml(String(r.oldest).slice(0,10)):'&mdash;')+'</td></tr>'; });
            h+='</tbody></table>'; }
        h+='</div>'; rtOv().innerHTML=h;
    }
    /* =================== END DATA RETENTION =================== */
    /* ===================== FUNDRAISER ORGANIZER PORTAL ===================== */
    function fhOrgPortal(){ var f=_fh.cur; if(!f) return;
        fhRpc('app_fr_org_portal',{p_fundraiser_id:f.id,p_enable:true},function(r){
            var base=location.origin+location.pathname;
            var link=base+'?fundraiser='+encodeURIComponent(r.code||'')+'&k='+encodeURIComponent(r.access_code||'');
            var msg='Organizer portal is ON for this fundraiser.\n\nFundraiser code: '+(r.code||'')+'\nAccess code: '+(r.access_code||'')+'\n\nShareable link (organizer needs no login):\n'+link;
            if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(link).then(function(){ alert(msg+'\n\n(Link copied to your clipboard.)'); },function(){ alert(msg); }); } else { alert(msg); }
        });
    }
    function frOrgOv(){ var o=document.getElementById('frOrgModal'); if(!o){ o=document.createElement('div'); o.id='frOrgModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(o);} o.style.display='block'; return o; }
    function frOrgClose(){ var o=document.getElementById('frOrgModal'); if(o) o.style.display='none'; try{ if(new URLSearchParams(location.search).get('fundraiser')){ location.href=location.origin+location.pathname; } }catch(e){} }
    function frOrgWrap(b){ frOrgOv().innerHTML='<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;"><b style="flex:1;font-size:16px;">Fundraiser status</b><button onclick="frOrgClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:15px;">&times;</button></div><div style="max-width:520px;margin:0 auto;padding:16px;">'+b+'</div>'; }
    function foVal(id){ var e=document.getElementById(id); return e?e.value.trim():''; }
    function frOrgGate(c,k){ var h='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;"><div style="font-size:18px;font-weight:800;color:#1f2a44;">Check your fundraiser</div><p style="font-size:13px;color:#6b7686;">Enter the two codes Caliche&rsquo;s gave you &mdash; no login needed.</p><label style="font-size:12px;color:#6b7686;">Fundraiser code</label><input id="foCode" value="'+escapeHtml(c||'')+'" placeholder="FR-YYYYMMDD-####" autocomplete="off" style="width:100%;padding:10px;border:1px solid #d6deea;border-radius:8px;box-sizing:border-box;margin-bottom:8px;"><label style="font-size:12px;color:#6b7686;">Access code</label><input id="foAcc" value="'+escapeHtml(k||'')+'" placeholder="8 characters" autocomplete="off" style="width:100%;padding:10px;border:1px solid #d6deea;border-radius:8px;box-sizing:border-box;"><div id="foErr" style="color:#c0264b;font-size:12.5px;margin:8px 0;min-height:16px;"></div><button onclick="frOrgGo()" style="width:100%;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:12px;font-weight:800;cursor:pointer;">Check status</button></div>'; frOrgWrap(h); }
    function frOrgGo(){ var c=foVal('foCode'),k=foVal('foAcc'); var er=document.getElementById('foErr'); if(!c||!k){ if(er)er.textContent='Please enter both codes.'; return; } if(er)er.textContent='Checking…';
        supabaseClient.rpc('app_fr_org_status',{p_code:c,p_access:k}).then(function(r){ if(r.error){ if(er)er.textContent=(String(r.error.message||'').indexOf('Too many')>=0?r.error.message:'Not found — please check your codes.'); return; } frOrgView(r.data); }).catch(function(){ if(er)er.textContent='Connection error. Please try again.'; });
    }
    function frOrgRow(l,v){ return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f8;font-size:13.5px;"><span style="color:#6b7686;">'+l+'</span><b style="color:#26242b;">'+escapeHtml(v==null||v===''?'—':String(v))+'</b></div>'; }
    function frOrgView(d){ d=d||{};
        var appr=parseInt(d.cards_approved,10)||0, iss=parseInt(d.cards_issued,10)||0; var pct=appr>0?Math.min(100,Math.round(100*iss/appr)):0;
        var h='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;"><div style="font-size:12px;color:#6b6275;">'+escapeHtml(d.code||'')+'</div><div style="margin:4px 0 10px;"><span style="background:#ede4fb;color:#5b3aa6;font-size:13px;font-weight:800;padding:4px 12px;border-radius:99px;">'+escapeHtml(d.status||'In progress')+'</span></div>';
        if(appr>0){ h+='<div style="margin:4px 0 12px;"><div style="display:flex;justify-content:space-between;font-size:11.5px;color:#6b7686;margin-bottom:3px;"><span>Cards issued</span><span>'+iss+' of '+appr+'</span></div><div style="height:9px;background:#eef0f5;border-radius:99px;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,#185FA5,#1f7a3d);"></div></div></div>'; }
        h+=frOrgRow('Selling starts',d.approved_start)+frOrgRow('Selling ends',d.approved_end)+frOrgRow('Return due',d.return_due)+frOrgRow('Pickup',((d.pickup_at?String(d.pickup_at).slice(0,10):'')+(d.pickup_store?(' · '+d.pickup_store):'')).trim())+frOrgRow('Cards approved',d.cards_approved)+frOrgRow('Cards issued',d.cards_issued)+frOrgRow('Cards returned',d.cards_returned);
        h+='<p style="font-size:11.5px;color:#5b6675;margin-top:12px;">Questions? Contact your Caliche&rsquo;s coordinator. Thank you for fundraising with us! &#127846;</p></div><div style="margin-top:10px;"><button onclick="frOrgClose()" style="background:#eef0f3;border:none;border-radius:9px;padding:10px 16px;cursor:pointer;">Close</button></div>';
        frOrgWrap(h);
    }
    function frOrgRoute(){ try{ var p=new URLSearchParams(location.search); var c=p.get('fundraiser'); if(!c) return false; var k=p.get('k')||''; var sp=document.getElementById('splash-screen'); if(sp) sp.style.display='none'; var lv=document.getElementById('login-view'); if(lv) lv.style.display='none'; frOrgGate(c,k); if(k) frOrgGo(); return true; }catch(e){ return false; } }
    /* =================== END FUNDRAISER ORGANIZER PORTAL =================== */
    /* ===================== EMPLOYEE DUPLICATE SCAN (read-only) ===================== */
    function dsOv(){ var o=document.getElementById('dsModal'); if(!o){ o=document.createElement('div'); o.id='dsModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(o);} o.style.display='block'; return o; }
    function dsClose(){ var o=document.getElementById('dsModal'); if(o) o.style.display='none'; }
    function openDupScan(){ if(!(currentUser&&(currentUser.is_developer===true||['Admin Manager','Vice President/Co-Owner','Store Manager'].indexOf(currentUser.role)>=0))){ alert('This is for admins.'); return; }
        dsOv().innerHTML='<div style="padding:12px 14px;"><button onclick="dsClose()" style="background:#eef0f3;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:700;">&times; Close</button></div><div style="text-align:center;color:#6b7686;padding:34px;">Scanning for possible duplicate employees&hellip;</div>';
        withPin(function(pin){
            supabaseClient.rpc('app_emp_dupscan',{p_username:currentUser.username,p_password:pin,p_threshold:0.5}).then(function(r){
                if(r.error){ dsOv().innerHTML='<div style="padding:30px;text-align:center;color:#c0264b;">'+escapeHtml(r.error.message||'Error')+'</div><div style="text-align:center;"><button onclick="dsClose()" style="background:#eef0f3;border:none;border-radius:9px;padding:10px 16px;cursor:pointer;">Close</button></div>'; return; }
                dsRender((r.data&&r.data.pairs)||[]);
            }).catch(function(){ dsOv().innerHTML='<div style="padding:30px;text-align:center;color:#c0264b;">Connection error.</div>'; });
        });
    }
    function dsRender(pairs){
        var h='<div style="background:linear-gradient(120deg,#3b2f6b,#106ab3);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">Possible duplicate employees</b><button onclick="dsClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:15px;">&times;</button></div>';
        h+='<div style="max-width:680px;margin:0 auto;padding:16px 16px 50px;">';
        h+='<p style="font-size:12.5px;color:#6b7686;margin-top:0;">Pairs of roster names that look similar &mdash; for <b>review only</b>. Nothing is changed or merged here; this just surfaces possible duplicates so you can check them. (Safe merge &amp; rehire tools come next.)</p>';
        if(!pairs.length){ h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:24px;text-align:center;color:#6b6275;">No likely duplicates found. &#127881;</div>'; }
        else { h+='<div style="font-size:11px;color:#5b6675;margin-bottom:6px;">'+pairs.length+' pair'+(pairs.length===1?'':'s')+' to review</div>';
            pairs.forEach(function(p){
                var pct=Math.round((p.score||0)*100);
                h+='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:12px;margin-bottom:8px;">'+
                    '<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(p.a_name||'')+' &harr; '+escapeHtml(p.b_name||'')+'</b><span style="background:'+(pct>=70?'#fbe4ea':'#eef0f5')+';color:'+(pct>=70?'#a01b3e':'#5b6472')+';font-size:11px;font-weight:800;padding:2px 8px;border-radius:99px;">'+pct+'% match</span></div>'+
                    '<div style="font-size:11.5px;color:#6b6275;margin-top:3px;">'+escapeHtml(p.a_store||'—')+(p.a_active?'':' (inactive)')+' &middot; '+escapeHtml(p.b_store||'—')+(p.b_active?'':' (inactive)')+(p.same_store?' &middot; <b style="color:#9a5b00;">same store</b>':'')+'</div>'+
                '</div>';
            });
        }
        h+='</div>'; dsOv().innerHTML=h;
    }
    /* =================== END EMPLOYEE DUPLICATE SCAN =================== */
    /* ===================== SCORM RUNTIME + LAUNCHER ===================== */
    var _scorm={cid:null,init:false,err:'0',data:{},done:false};
    function _scStr(){ var d=_scorm.data; return d['cmi.core.lesson_status']||d['cmi.completion_status']||d['cmi.success_status']||''; }
    function _scScore(){ var d=_scorm.data; var s=(d['cmi.core.score.raw']!=null)?d['cmi.core.score.raw']:d['cmi.score.raw']; var n=parseFloat(s); return isNaN(n)?100:Math.round(n); }
    function _scMaybeComplete(){ if(_scorm.done) return; var st=String(_scStr()).toLowerCase(); if(st==='passed'||st==='completed'){ _scorm.done=true; var sc=_scScore(); var cid=_scorm.cid; withPin(function(pin){ supabaseClient.rpc('app_lp_complete',{p_username:currentUser.username,p_password:pin,p_course_id:cid,p_score:sc,p_passed:(st==='passed'||sc>=80),p_responses:[{q:'SCORM module',type:'scorm',answer:st,score:sc}]}).catch(function(){}); }); } }
    function _scSet(k,v){ _scorm.data[k]=String(v); _scorm.err='0'; if(k==='cmi.core.lesson_status'||k==='cmi.completion_status'||k==='cmi.success_status') _scMaybeComplete(); return 'true'; }
    function _scGet(k){ _scorm.err='0'; return (_scorm.data[k]!=null)?_scorm.data[k]:''; }
    function _scInit(){ _scorm.init=true; _scorm.err='0'; return 'true'; }
    function _scCommit(){ _scorm.err='0'; _scMaybeComplete(); return 'true'; }
    function _scFinish(){ _scorm.init=false; _scorm.err='0'; _scMaybeComplete(); return 'true'; }
    function lmsBuildScormApi(){
        window.API={ LMSInitialize:_scInit, LMSFinish:_scFinish, LMSGetValue:_scGet, LMSSetValue:_scSet, LMSCommit:_scCommit, LMSGetLastError:function(){return _scorm.err;}, LMSGetErrorString:function(){return '';}, LMSGetDiagnostic:function(){return '';} };
        window.API_1484_11={ Initialize:_scInit, Terminate:_scFinish, GetValue:_scGet, SetValue:_scSet, Commit:_scCommit, GetLastError:function(){return _scorm.err;}, GetErrorString:function(){return '';}, GetDiagnostic:function(){return '';} };
    }
    /* Resolve a possibly-relative href against the SCO base folder. Returns '' for links we must NOT touch (absolute http(s), protocol-relative, data:, blob:). */
    function _scoResolveCssHref(href, baseHref){
        if(!href) return '';
        var h=String(href).trim().replace(/^['"]|['"]$/g,'');
        if(!h) return '';
        if(/^(?:https?:|data:|blob:)/i.test(h)) return '';
        if(/^\/\//.test(h)) return '';
        try{ return new URL(h, baseHref).href; }catch(e){ return ''; }
    }
    /* Replace every <link rel="stylesheet" href="..."> with an inlined <style> (Supabase serves CSS as text/plain, which the browser refuses to apply as a stylesheet). Relative hrefs are fetched and inlined; absolute CDN links are left untouched; each fetch is isolated so one failure cannot break the launch. */
    async function _scoInlineStylesheets(html, baseHref){
        var linkRe=/<link\b[^>]*>/gi, links=[], m;
        while((m=linkRe.exec(html))){ links.push(m[0]); }
        for(var i=0;i<links.length;i++){
            var tag=links[i];
            if(!/rel\s*=\s*['"]?\s*stylesheet/i.test(tag)) continue;
            var hm=/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
            var href=hm?(hm[2]!=null?hm[2]:(hm[3]!=null?hm[3]:hm[4])):'';
            var abs=_scoResolveCssHref(href, baseHref);
            if(!abs) continue;
            var mediaM=/media\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
            var media=mediaM?(mediaM[2]!=null?mediaM[2]:(mediaM[3]!=null?mediaM[3]:mediaM[4])):'';
            try{
                var css=await (await fetch(abs,{cache:'no-store'})).text();
                var styleTag='<style'+(media?' media="'+media.replace(/"/g,'&quot;')+'"':'')+'>\n'+css+'\n</style>';
                html=html.replace(tag, styleTag);
            }catch(e){}
        }
        return html;
    }
    async function lmsLaunchScorm(courseId,url,version){
        if(!url){ alert('No SCORM package is attached to this course yet.'); return; }
        _scorm={cid:courseId,init:false,err:'0',data:{},done:false}; lmsBuildScormApi();
        var ov=lmsOverlay(); ov.innerHTML=lmsHeader('Training module','lmsClose()')+'<div style="position:fixed;inset:0;top:52px;background:#000;"><iframe id="scoLaunchFrame" style="width:100%;height:100%;border:0;" allow="autoplay; fullscreen" allowfullscreen></iframe><div id="scoLaunchMsg" style="position:fixed;left:10px;top:60px;color:#cfd6df;font:12px -apple-system,Segoe UI,sans-serif;background:rgba(0,0,0,.55);padding:4px 9px;border-radius:7px;z-index:5;">Loading module&hellip;</div></div>';
        /* Supabase signed uploads store files as text/plain, so iframing the storage URL shows blank. Fetch the launch page and render it through a SAME-ORIGIN blob (always parsed as HTML) with a <base> so relative assets resolve and the SCO can reach window.API. External <link> stylesheets are inlined as <style> first (the browser refuses text/plain stylesheets in standards mode). */
        var launchUrl=url;
        try{ var hash=url.indexOf('#')>=0?url.slice(url.indexOf('#')+1):''; var m=/(?:^|&)launch=([^&]+)/.exec(hash); if(m){ launchUrl=decodeURIComponent(m[1]); } else if(url.indexOf('scorm-player.html')>=0){ launchUrl=''; } }catch(e){}
        if(!launchUrl){ var m0=document.getElementById('scoLaunchMsg'); if(m0) m0.textContent='Could not find the module launch file.'; return; }
        var baseHref=launchUrl.split('?')[0].replace(/[^\/]*$/,'');
        try{
            var html=await (await fetch(launchUrl,{cache:'no-store'})).text();
            if(/<head[^>]*>/i.test(html)){ html=html.replace(/<head([^>]*)>/i,'<head$1><base href="'+baseHref+'">'); } else { html='<!doctype html><base href="'+baseHref+'">'+html; }
            try{ html=await _scoInlineStylesheets(html, baseHref); }catch(e){}
            var b=URL.createObjectURL(new Blob([html],{type:'text/html'}));
            var fr=document.getElementById('scoLaunchFrame'); if(fr){ fr.src=b; } var m1=document.getElementById('scoLaunchMsg'); if(m1){ m1.style.display='none'; }
        }catch(e){ var fr=document.getElementById('scoLaunchFrame'); if(fr){ fr.src=launchUrl; } var m2=document.getElementById('scoLaunchMsg'); if(m2){ m2.textContent='Could not load the module.'; } }
    }
    function lmsSetScorm(courseId,cur){ var url=prompt('Paste the SCORM package launch URL (must be hosted on this site’s domain). Leave blank to remove.', cur||''); if(url===null) return; withPin(function(pin){ supabaseClient.rpc('app_lp_set_scorm',{p_username:currentUser.username,p_password:pin,p_course_id:courseId,p_url:url.trim(),p_version:'1.2'}).then(function(r){ if(r.error){ alert('Could not save: '+(r.error.message||'')); return; } alert(url.trim()?'SCORM module attached.':'SCORM module removed.'); if(typeof lmsOpenCourse==='function') lmsOpenCourse(courseId); }).catch(function(){ alert('Could not save.'); }); }); }
    function lmsScormBtns(c){ if(!c) return ''; var h=''; var u=c.scorm_url?encodeURI(String(c.scorm_url)).replace(/'/g,'%27'):''; if(c.scorm_url){ h+='<button onclick="lmsLaunchScorm('+c.id+',\''+u+'\',\''+escapeHtml(c.scorm_version||'1.2')+'\')" style="width:100%;margin-top:14px;background:#7d1d4b;color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:800;cursor:pointer;">&#9654; Launch training module (SCORM)</button>'; } if(typeof isManagerRole==='function'&&isManagerRole()){ h+='<button onclick="lmsSetScorm('+c.id+',\''+u+'\')" style="width:100%;margin-top:8px;background:#eef0f3;color:#5b6472;border:none;border-radius:9px;padding:9px;font-size:12.5px;font-weight:700;cursor:pointer;">&#128279; '+(c.scorm_url?'Replace':'Attach')+' SCORM package</button>'; h+='<button onclick="lmsUploadScorm('+c.id+')" style="width:100%;margin-top:8px;background:#7d1d4b;color:#fff;border:none;border-radius:9px;padding:9px;font-size:12.5px;font-weight:700;cursor:pointer;">&#11014; Upload SCORM .zip</button>'; } return h; }
    /* =================== END SCORM RUNTIME + LAUNCHER =================== */
    /* ===================== SCORM UPLOAD (manager self-serve .zip) ===================== */
    function lmsScormType(n){ n=String(n).toLowerCase(); if(/\.html?$/.test(n))return'text/html'; if(/\.js$/.test(n))return'text/javascript'; if(/\.css$/.test(n))return'text/css'; if(/\.json$/.test(n))return'application/json'; if(/\.xml$/.test(n))return'text/xml'; if(/\.png$/.test(n))return'image/png'; if(/\.jpe?g$/.test(n))return'image/jpeg'; if(/\.gif$/.test(n))return'image/gif'; if(/\.svg$/.test(n))return'image/svg+xml'; if(/\.mp4$/.test(n))return'video/mp4'; if(/\.mp3$/.test(n))return'audio/mpeg'; if(/\.woff2$/.test(n))return'font/woff2'; if(/\.woff$/.test(n))return'font/woff'; return'application/octet-stream'; }
    function lmsUploadScorm(courseId){ if(typeof JSZip==='undefined'){ alert('The unzip tool is still loading — please try again in a few seconds.'); return; } withPin(function(pin){ var inp=document.createElement('input'); inp.type='file'; inp.accept='.zip,application/zip'; inp.onchange=function(){ var f=inp.files&&inp.files[0]; if(f) lmsScormDoUpload(courseId,f,pin); }; inp.click(); }); }
    async function _scSign(courseId,pin,relpath){ var r=await fetch(supabaseUrl+'/functions/v1/scorm-upload',{method:'POST',headers:{apikey:supabaseKey,Authorization:'Bearer '+supabaseKey,'Content-Type':'application/json'},body:JSON.stringify({username:currentUser.username,pin:pin,course_id:courseId,relpath:relpath})}); var d=await r.json(); if(!d||d.error) throw new Error((d&&d.error)||'Could not authorize upload (managers only).'); return d; }
    async function lmsScormDoUpload(courseId,file,pin){
        var ov=lmsOverlay(); ov.innerHTML=lmsHeader('Upload SCORM','lmsHome()')+'<div style="max-width:560px;margin:0 auto;padding:20px;"><div id="scUpMsg" style="font-size:14px;color:#33303a;">Reading package&hellip;</div><div style="height:8px;background:#eef0f5;border-radius:99px;margin-top:10px;overflow:hidden;"><div id="scUpBar" style="height:100%;width:0;background:linear-gradient(90deg,#185FA5,#1f7a3d);transition:width .2s;"></div></div></div>';
        function msg(t){ var e=document.getElementById('scUpMsg'); if(e) e.textContent=t; }
        function bar(p){ var e=document.getElementById('scUpBar'); if(e) e.style.width=Math.round(p)+'%'; }
        try{
            var zip=await JSZip.loadAsync(file);
            var names=Object.keys(zip.files).filter(function(n){return !zip.files[n].dir;});
            if(!names.length){ msg('That .zip appears to be empty.'); return; }
            var manName=names.find(function(n){return /(^|\/)imsmanifest\.xml$/i.test(n);});
            var launchRel='';
            if(manName){ var xml=await zip.files[manName].async('string'); var base=manName.replace(/imsmanifest\.xml$/i,''); var doc=new DOMParser().parseFromString(xml,'text/xml');
                var orgs=doc.getElementsByTagName('organizations')[0]; var defId=orgs&&orgs.getAttribute('default'); var org=null; var olist=doc.getElementsByTagName('organization');
                for(var oi=0;oi<olist.length;oi++){ if(!org) org=olist[oi]; if(defId&&olist[oi].getAttribute('identifier')===defId) org=olist[oi]; }
                var ref=''; if(org){ var it=org.getElementsByTagName('item'); for(var ii=0;ii<it.length;ii++){ if(it[ii].getAttribute('identifierref')){ ref=it[ii].getAttribute('identifierref'); break; } } }
                var rlist=doc.getElementsByTagName('resource'); var href='';
                for(var ri=0;ri<rlist.length;ri++){ if(ref&&rlist[ri].getAttribute('identifier')===ref){ href=rlist[ri].getAttribute('href'); break; } }
                if(!href){ for(var ri2=0;ri2<rlist.length;ri2++){ if(rlist[ri2].getAttribute('href')){ href=rlist[ri2].getAttribute('href'); break; } } }
                if(href) launchRel=base+href;
            }
            if(!launchRel){ var htmls=names.filter(function(n){return /\.html?$/i.test(n);}).sort(function(a,b){return a.length-b.length;}); launchRel=htmls[0]||''; }
            if(!launchRel){ msg('Could not find a launch page (no imsmanifest.xml or HTML file). Is this a SCORM package?'); return; }
            var launchClean=launchRel.split('?')[0].replace(/^\.?\//,''); var launchQuery=launchRel.indexOf('?')>=0?launchRel.slice(launchRel.indexOf('?')):'';
            var launchUrl=''; var scVer='v'+Date.now();
            for(var k=0;k<names.length;k++){ var name=names[k];
                msg('Uploading file '+(k+1)+' of '+names.length+'…'); bar(100*k/(names.length+1));
                var blob=await zip.files[name].async('blob');
                var d=await _scSign(courseId,pin,scVer+'/'+name);
                var up=await supabaseClient.storage.from('training-materials').uploadToSignedUrl(d.path,d.token,blob,{contentType:lmsScormType(name)});
                if(up.error) throw new Error(up.error.message);
                if(name.replace(/^\.?\//,'')===launchClean) launchUrl=d.url+launchQuery;
            }
            msg('Installing the player…'); bar(100*names.length/(names.length+1));
            var playerTxt=await (await fetch('scorm-player.html',{cache:'no-store'})).text();
            var pd=await _scSign(courseId,pin,scVer+'/scorm-player.html');
            var pu=await supabaseClient.storage.from('training-materials').uploadToSignedUrl(pd.path,pd.token,new Blob([playerTxt],{type:'text/html'}),{contentType:'text/html'});
            if(pu.error) throw new Error(pu.error.message);
            if(!launchUrl){ var ld=await _scSign(courseId,pin,scVer+'/'+launchClean); launchUrl=ld.url+launchQuery; }
            var scormUrl=pd.url+'#course='+courseId+'&launch='+encodeURIComponent(launchUrl);
            await new Promise(function(res,rej){ supabaseClient.rpc('app_lp_set_scorm',{p_username:currentUser.username,p_password:pin,p_course_id:courseId,p_url:scormUrl,p_version:'1.2'}).then(function(r){ if(r.error) rej(new Error(r.error.message)); else res(); }).catch(rej); });
            bar(100); msg('✓ SCORM package uploaded and attached! Learners can launch it now.');
            setTimeout(function(){ if(typeof lmsOpenCourse==='function') lmsOpenCourse(courseId); },1500);
        }catch(e){ msg('Upload failed: '+(e&&e.message?e.message:e)); }
    }
    /* =================== END SCORM UPLOAD =================== */
    /* ===================== MAINTENANCE LEADERSHIP DASHBOARD ===================== */
    function mdOv(){ var o=document.getElementById('mdModal'); if(!o){ o=document.createElement('div'); o.id='mdModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100040;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function mdClose(){ var o=document.getElementById('mdModal'); if(o) o.style.display='none'; }
    function mdMoney(n){ var x=parseFloat(n); return '$'+(isNaN(x)?'0':x.toLocaleString(undefined,{maximumFractionDigits:0})); }
    function openMaintDashboard(){ mdLoad(90); }
    function mdLoad(days){
        mdOv().innerHTML='<div style="padding:12px 14px;"><button onclick="mdClose()" style="background:#eef0f3;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:700;">&times; Close</button></div><div style="text-align:center;color:#6b7686;padding:40px;">Loading maintenance dashboard&hellip;</div>';
        withPin(function(pin){
            supabaseClient.rpc('app_maint_dashboard',{p_username:currentUser.username,p_password:pin,p_days:days}).then(function(r){
                if(r.error){ mdOv().innerHTML='<div style="padding:12px 14px;"><button onclick="mdClose()" style="background:#eef0f3;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:700;">&times; Close</button></div><div style="padding:24px;text-align:center;color:#c0264b;">'+(String(r.error.message||'').indexOf('forbidden')>=0?'You don&rsquo;t have access to this view.':escapeHtml(r.error.message||'Error'))+'</div>'; return; }
                mdRender(r.data||{}, days);
            }).catch(function(){ mdOv().innerHTML='<div style="padding:12px 14px;"><button onclick="mdClose()" style="background:#eef0f3;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:700;">&times; Close</button></div><div style="padding:30px;text-align:center;color:#c0264b;">Connection error.</div>'; });
        });
    }
    function mdTile(label,val,sub,color){ return '<div style="flex:1;min-width:120px;background:#fff;border:1px solid #eef0f5;border-radius:11px;padding:11px 13px;"><div style="font-size:10.5px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;">'+label+'</div><div style="font-size:20px;font-weight:800;color:'+(color||'#1f2a44')+';margin-top:2px;">'+val+'</div>'+(sub?'<div style="font-size:11px;color:#6b6275;">'+sub+'</div>':'')+'</div>'; }
    function mdRender(d, days){
        var s=d.summary||{};
        var winBtn=function(n,lbl){ return '<button onclick="mdLoad('+n+')" style="background:'+(days===n?'#185FA5':'#eef0f3')+';color:'+(days===n?'#fff':'#5b6472')+';border:none;border-radius:7px;padding:5px 11px;font-size:12px;font-weight:700;cursor:pointer;">'+lbl+'</button>'; };
        var h='<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">Maintenance &mdash; Leadership View</b><button onclick="mdClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:15px;">&times;</button></div>';
        h+='<div style="max-width:880px;margin:0 auto;padding:14px 16px 50px;">';
        h+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;"><span style="font-size:12px;color:#6b7686;">Window:</span>'+winBtn(30,'30 days')+winBtn(90,'90 days')+winBtn(365,'1 year')+'</div>';
        h+='<div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:14px;">';
        h+=mdTile('Open work orders', (s.open_wo!=null?s.open_wo:'0'),'',(s.open_wo>0?'#9a5b00':'#1b7a3d'));
        h+=mdTile('On hold', (s.on_hold!=null?s.on_hold:'0'),'',(s.on_hold>0?'#a01b3e':'#1f2a44'));
        h+=mdTile('Completed', (s.completed_in_window!=null?s.completed_in_window:'0'),'in window','#1b7a3d');
        h+=mdTile('Cost logged', mdMoney(d.cost_logged),'in window');
        h+=mdTile('Invoices open', mdMoney(d.invoice_open_total),'awaiting',(d.invoice_open_total>0?'#9a5b00':'#1f2a44'));
        h+=mdTile('Invoices paid', mdMoney(d.invoice_paid_total),'in window','#1b7a3d');
        h+='</div>';
        h+='<div style="background:#fff;border:1px solid #eef0f5;border-radius:13px;padding:13px;margin-bottom:12px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">By store</div>';
        var bs=d.by_store||[];
        if(!bs.length){ h+='<div style="color:#5b6675;font-size:13px;">No work orders yet.</div>'; }
        else { h+='<table style="width:100%;border-collapse:collapse;font-size:13px;"><tr style="color:#5b6675;font-size:11px;text-transform:uppercase;"><td style="text-align:left;padding:3px 0;">Store</td><td style="text-align:center;">Open WOs</td><td style="text-align:right;">Cost (window)</td></tr>';
            bs.forEach(function(r){ h+='<tr style="border-top:1px solid #f3f4f8;"><td style="padding:6px 0;color:#26242b;font-weight:600;">'+escapeHtml(r.location||'')+'</td><td style="text-align:center;color:'+(r.open_wo>0?'#9a5b00':'#1b7a3d')+';font-weight:700;">'+(r.open_wo||0)+'</td><td style="text-align:right;color:#1f2a44;">'+mdMoney(r.cost)+'</td></tr>'; });
            h+='</table>'; }
        h+='</div>';
        h+='<div style="display:flex;gap:12px;flex-wrap:wrap;">';
        h+='<div style="flex:1;min-width:240px;background:#fff;border:1px solid #eef0f5;border-radius:13px;padding:13px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Open by category</div>';
        var bc=d.by_category||[];
        if(!bc.length){ h+='<div style="color:#5b6675;font-size:13px;">Nothing open.</div>'; } else { bc.forEach(function(r){ h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-top:1px solid #f7f8fb;font-size:13px;"><span style="color:#33303a;">'+escapeHtml(r.category||'')+'</span><b style="color:#185FA5;">'+(r.open_wo||0)+'</b></div>'; }); }
        h+='</div>';
        h+='<div style="flex:1;min-width:240px;background:#fff;border:1px solid #eef0f5;border-radius:13px;padding:13px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Cost by type (window)</div>';
        var bk=d.cost_by_kind||[];
        if(!bk.length){ h+='<div style="color:#5b6675;font-size:13px;">No costs logged.</div>'; } else { bk.forEach(function(r){ h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-top:1px solid #f7f8fb;font-size:13px;"><span style="color:#33303a;text-transform:capitalize;">'+escapeHtml(r.kind||'')+'</span><b style="color:#1f2a44;">'+mdMoney(r.total)+'</b></div>'; }); }
        h+='</div></div>';
        h+='<div id="mdVendorSpend" style="margin-top:12px;"></div>';
        h+='<p style="font-size:11.5px;color:#5b6675;margin-top:14px;">Numbers come from logged work-order costs and maintenance invoices. As more work orders are closed and invoices entered, this view fills in automatically.</p>';
        h+='</div>';
        mdOv().innerHTML=h;
        if(typeof mdLoadVendorSpend==='function') mdLoadVendorSpend(days);
    }
    function mdVendorDateFrom(days){ var d=new Date(Date.now()-(days||90)*86400000); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
    function mdLoadVendorSpend(days){
        var box=document.getElementById('mdVendorSpend'); if(!box) return;
        box.innerHTML='<div style="background:#fff;border:1px solid #eef0f5;border-radius:13px;padding:13px;color:#5b6675;font-size:13px;">Loading vendor spend&hellip;</div>';
        withPin(function(pin){
            supabaseClient.rpc('app_maint_vendor_spend',{p_username:currentUser.username,p_password:pin,p_from:mdVendorDateFrom(days),p_to:null}).then(function(r){
                if(r.error||!r.data){ box.innerHTML='<div style="background:#fff;border:1px solid #eef0f5;border-radius:13px;padding:13px;color:#5b6675;font-size:13px;">Vendor spend unavailable.</div>'; return; }
                window._mdVendorData=r.data; mdRenderVendorSpend(r.data);
            }).catch(function(){ box.innerHTML='<div style="background:#fff;border:1px solid #eef0f5;border-radius:13px;padding:13px;color:#5b6675;font-size:13px;">Vendor spend unavailable.</div>'; });
        });
    }
    function mdRenderVendorSpend(d){
        var box=document.getElementById('mdVendorSpend'); if(!box) return;
        var v=(d&&d.vendors)||[]; var t=(d&&d.totals)||{};
        var h='<div style="background:#fff;border:1px solid #eef0f5;border-radius:13px;padding:13px;">';
        h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><div style="flex:1;font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;">Invoice spend by vendor</div>';
        if(v.length) h+='<button onclick="mdVendorCsv()" style="background:#eef3fb;color:#185FA5;border:none;border-radius:7px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">&#11015; CSV</button>';
        h+='</div>';
        if(!v.length){ h+='<div style="color:#5b6675;font-size:13px;">No vendor invoices in this window yet. As invoices are entered (including in-house Caliche&rsquo;s Maintenance), spend by vendor fills in here.</div></div>'; box.innerHTML=h; return; }
        h+='<table style="width:100%;border-collapse:collapse;font-size:13px;"><tr style="color:#5b6675;font-size:10.5px;text-transform:uppercase;"><td style="text-align:left;padding:3px 0;">Vendor</td><td style="text-align:center;">Inv</td><td style="text-align:right;">Invoiced</td><td style="text-align:right;">Paid</td><td style="text-align:right;">Outstanding</td></tr>';
        v.forEach(function(r){ h+='<tr style="border-top:1px solid #f3f4f8;"><td style="padding:6px 0;color:#26242b;font-weight:600;">'+escapeHtml(r.vendor||'')+'</td><td style="text-align:center;color:#5b6675;">'+(r.invoices||0)+'</td><td style="text-align:right;color:#1f2a44;">'+mdMoney(r.invoiced)+'</td><td style="text-align:right;color:#1b7a3d;">'+mdMoney(r.paid)+'</td><td style="text-align:right;color:'+((r.outstanding>0)?'#9a5b00':'#9aa7b4')+';font-weight:'+((r.outstanding>0)?'700':'400')+';">'+mdMoney(r.outstanding)+'</td></tr>'; });
        h+='<tr style="border-top:2px solid #e6e9f0;font-weight:800;"><td style="padding:7px 0;color:#1f2a44;">Total</td><td style="text-align:center;color:#5b6675;">'+(t.invoices||0)+'</td><td style="text-align:right;color:#1f2a44;">'+mdMoney(t.invoiced)+'</td><td style="text-align:right;color:#1b7a3d;">'+mdMoney(t.paid)+'</td><td style="text-align:right;color:'+((t.outstanding>0)?'#9a5b00':'#1f2a44')+';">'+mdMoney(t.outstanding)+'</td></tr>';
        h+='</table></div>';
        box.innerHTML=h;
    }
    function mdVendorCsv(){
        var d=window._mdVendorData; if(!d||!(d.vendors||[]).length){ alert('No vendor spend to export yet.'); return; }
        var rows=[['Vendor','Invoices','Invoiced','Paid','Outstanding']];
        (d.vendors||[]).forEach(function(r){ rows.push([r.vendor||'',r.invoices||0,r.invoiced||0,r.paid||0,r.outstanding||0]); });
        var t=d.totals||{}; rows.push(['TOTAL',t.invoices||0,t.invoiced||0,t.paid||0,t.outstanding||0]);
        var csv=rows.map(function(row){ return row.map(function(c){ var x=String(c); return /[",\n]/.test(x)?('"'+x.replace(/"/g,'""')+'"'):x; }).join(','); }).join('\r\n');
        var blob=new Blob([csv],{type:'text/csv'}); var url=URL.createObjectURL(blob); var a=document.createElement('a'); a.href=url; a.download='vendor-spend_'+(d.from||'')+'_to_'+(d.to||'')+'.csv'; document.body.appendChild(a); a.click(); setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); },100);
    }
    /* =================== END MAINTENANCE LEADERSHIP DASHBOARD =================== */
    /* ===================== MY COACHING NOTES (employee self-view) ===================== */
    function myNotesOv(){ var o=document.getElementById('myNotesModal'); if(!o){ o=document.createElement('div'); o.id='myNotesModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100040;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function myNotesClose(){ var o=document.getElementById('myNotesModal'); if(o) o.style.display='none'; }
    function openMyNotes(){
        var ov=myNotesOv();
        ov.innerHTML='<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">My Coaching Notes</b><button onclick="myNotesClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:15px;">&times;</button></div><div style="max-width:620px;margin:0 auto;padding:16px 16px 50px;" id="myNotesBody"><div style="text-align:center;color:#6b7686;padding:40px;">Loading&hellip;</div></div>';
        withPin(function(pin){
            supabaseClient.rpc('app_my_support_notes',{p_username:currentUser.username,p_password:pin}).then(function(r){
                var box=document.getElementById('myNotesBody'); if(!box) return;
                if(r.error){ box.innerHTML='<div style="background:#fff;border:1px solid #f3d9d9;border-radius:12px;padding:20px;color:#c0264b;">Could not load your notes right now.</div>'; return; }
                var notes=(r.data&&r.data.notes)||[];
                var intro='<p style="font-size:12.5px;color:#6b7686;margin-top:0;">Supportive notes your managers have shared with you. These are for encouragement and coaching &mdash; they are not discipline.</p>';
                if(!notes.length){ box.innerHTML=intro+'<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:26px;text-align:center;color:#6b6275;"><div style="font-size:30px;margin-bottom:6px;">&#128172;</div>No coaching notes yet. When a manager shares a supportive note with you, it will show up here.</div>'; return; }
                var rows=notes.map(function(n){
                    var when=String(n.created_at||'').slice(0,10);
                    return '<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:13px 14px;margin-bottom:9px;">'+
                        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;"><span style="background:#e8f5ec;color:#1b7a3d;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:99px;text-transform:uppercase;letter-spacing:.3px;">Support</span><span style="flex:1;"></span><span style="font-size:11.5px;color:#5b6675;">'+escapeHtml(when)+'</span></div>'+
                        '<div style="font-size:14px;color:#26242b;white-space:pre-wrap;line-height:1.45;">'+escapeHtml(n.body||'')+'</div>'+
                        '<div style="font-size:11.5px;color:#5b6675;margin-top:6px;">&mdash; '+escapeHtml(n.author_name||'A manager')+'</div>'+
                    '</div>';
                }).join('');
                box.innerHTML=intro+rows;
            }).catch(function(){ var box=document.getElementById('myNotesBody'); if(box) box.innerHTML='<div style="background:#fff;border:1px solid #f3d9d9;border-radius:12px;padding:20px;color:#c0264b;">Connection error. Please try again.</div>'; });
        });
    }
    function _homeMyNotesCard(){
        return '<button onclick="openMyNotes()" class="home-card" style="display:block;width:100%;text-align:left;border:1px solid #e6e2f3;background:#faf8ff;cursor:pointer;margin-top:10px;"><div style="display:flex;align-items:center;gap:9px;"><span style="font-size:18px;">&#128172;</span><div style="flex:1;"><div class="home-card-label" style="color:#5b3aa6;">MY COACHING NOTES</div><div style="font-size:12.5px;color:#6b6477;margin-top:2px;">Supportive notes your managers shared with you</div></div><span style="color:#9b8fc2;font-size:18px;">&rsaquo;</span></div></button>';
    }
    /* =================== END MY COACHING NOTES =================== */
    function renderHomeDay(d) {
        var el = document.getElementById('homeDayCard');
        if (!el) return;
        var h;
        if (!d || d.linked !== true) {
            h = '<div class="home-card"><div class="home-card-label">YOUR NEXT SHIFT</div><p style="margin:6px 0 0;color:#667;font-size:13px;">Your shifts show here once a manager links your login in the Roster.</p></div>';
        } else {
            var shifts = d.shifts || [];
            if (!shifts.length) {
                h = '<div class="home-card"><div class="home-card-label">YOUR NEXT SHIFT</div><p style="margin:6px 0 0;color:#445;font-size:14px;">No upcoming shifts scheduled &mdash; enjoy the break! &#127846;</p></div>';
            } else {
                var s = shifts[0];
                h = '<div class="home-card"><div style="display:flex;justify-content:space-between;align-items:center;"><div class="home-card-label">YOUR NEXT SHIFT</div><span style="font-size:18px;">&#128197;</span></div>' +
                    '<div style="font-size:17px;font-weight:800;color:var(--caliches-blue);margin-top:4px;">' + escapeHtml(s.date || '') + ' &middot; ' + escapeHtml((s.start || '') + '-' + (s.end || '')) + '</div>' +
                    (s.location ? '<div style="font-size:13px;color:#7a8aa0;">' + escapeHtml(s.location) + '</div>' : '') + '</div>';
            }
        }
        el.innerHTML = h + _homeMyNotesCard();
        try{ renderHomeSearch(); }catch(e){}
        try{ loadActionItems(); }catch(e){}
    }

    // ── Personalized "Jump to": most-used tools, learned from clicks ──
    var QUICK_REG = [
        { key:'scheduling',  btn:'btn-scheduling',  label:'Scheduling',      emoji:'&#128197;', fn:function(){ openScheduling(); } },
        { key:'driver',      btn:'btn-driver',      label:'Driver Checklist',emoji:'&#128666;', fn:function(){ openForm('driverView'); } },
        { key:'popin',       btn:'btn-popIn',       label:'Pop-In',          emoji:'&#128203;', fn:function(){ openPopIn(); } },
        { key:'temp',        btn:'btn-tempLogs',    label:'Temp Logs',       emoji:'&#127777;', fn:function(){ openTempLogs(); } },
        { key:'checklists',  btn:'btn-checklists',  label:'Checklists',      emoji:'&#9989;',   fn:function(){ openChecklists(); } },
        { key:'inventory',   btn:'btn-inventory',   label:'Inventory',       emoji:'&#128230;', fn:function(){ openInventory(); } },
        { key:'shortage',    btn:'btn-shortage',    label:'Supply Request', emoji:'&#128666;', fn:function(){ openSupplyRequest(); } },
        { key:'maintenance', btn:'btn-maintenance', label:'Maintenance',     emoji:'&#128295;', fn:function(){ openForm('maintenanceView'); } },
        { key:'damage',      btn:'btn-damage',      label:'Damage Report',   emoji:'&#9888;',   fn:function(){ openForm('damageView'); } },
        { key:'messages',    btn:'topMessagesBtn',  label:'Messages',        emoji:'&#128172;', fn:function(){ openMessages(); } },
        { key:'quotes',      btn:'quotesBtn',       label:'Catering Quote',  emoji:'&#128221;', fn:function(){ if(typeof clearQuoteEdit==='function')clearQuoteEdit(); openForm('quotesView'); } },
        { key:'mynotes',    btn:'',                 label:'My Coaching Notes',         emoji:'&#128172;', fn:function(){ if(typeof openMyNotes==='function') openMyNotes(); } },
        { key:'maintdash',  btn:'btn-maintDash',    label:'Maintenance Dashboard',     emoji:'&#128295;', fn:function(){ if(typeof openDashboards==='function') openDashboards('maint'); else openMaintDashboard(); } },
        { key:'scorecards2',btn:'btn-scorecards',   label:'Store Scorecards',          emoji:'&#128202;', fn:function(){ if(typeof openDashboards==='function') openDashboards('scorecards'); else openScorecards(); } },
        { key:'maintbill',  btn:'btn-maintBilling', label:'Maintenance Billing',       emoji:'&#129534;', fn:function(){ if(typeof openMaintBilling==='function') openMaintBilling(); } },
        { key:'fundraiser2',btn:'btn-fundraiserHub',label:'Fundraiser Hub',            emoji:'&#128203;', fn:function(){ if(typeof openFundraiserHub==='function') openFundraiserHub(); } },
        { key:'marketing2', btn:'btn-marketingHub', label:'Marketing Command Center',  emoji:'&#128226;', fn:function(){ if(typeof openMarketing==='function') openMarketing(); } },
        { key:'teamgrowth', btn:'btn-teamGrowth', label:'Team Growth & Evaluations', emoji:'&#127793;', fn:function(){ if(typeof openTeamGrowth==='function') openTeamGrowth(); } },
        { key:'dailyreport', btn:'btn-dailyReport', label:'Daily Store Report', emoji:'&#128203;', fn:function(){ if(typeof openDailyReport==='function') openDailyReport(); } },
        { key:'stores2',    btn:'btn-storeManager', label:'Manage Stores',             emoji:'&#127978;', fn:function(){ if(typeof openStoreManager==='function') openStoreManager(); } },
        { key:'catering',   btn:'btn-catering',     label:'Catering Pipeline',         emoji:'&#127846;', fn:function(){ if(typeof openCatering==='function') openCatering(); } },
        { key:'admincon',   btn:'btn-admin-console',label:'Admin Console',             emoji:'&#128736;', fn:function(){ if(typeof openAdminConsole==='function') openAdminConsole(); } },
        { key:'retention',  btn:'btn-admin-console',label:'Data Retention',            emoji:'&#128451;', fn:function(){ if(typeof openRetention==='function') openRetention(); } },
        { key:'dupscan',    btn:'btn-admin-console',label:'Duplicate Employees',       emoji:'&#128101;', fn:function(){ if(typeof openDupScan==='function') openDupScan(); } }
    ];
    function getUsage(){ try { return JSON.parse(localStorage.getItem('calichesUsage') || '{}'); } catch(e){ return {}; } }
    function trackUse(key){ try { var u = getUsage(); u[key] = (u[key] || 0) + 1; localStorage.setItem('calichesUsage', JSON.stringify(u)); } catch(e){} }
    function wireUsageTracking(){
        QUICK_REG.forEach(function(it){
            var b = document.getElementById(it.btn);
            if (b && !b._usageWired){ b._usageWired = true; b.addEventListener('click', function(){ trackUse(it.key); }); }
        });
    }
    function renderJumpTo(){
        var grid = document.getElementById('jumpToGrid');
        if (!grid) return;
        wireUsageTracking();
        var u = getUsage();
        var top = [];
        /* Prefer real usage from the FULL registry (so non-tile destinations like PIP or
           Recently-completed earn a spot once used). Falls back to the classic QUICK_REG list. */
        try{
            var used = hubRegistryAll().filter(function(e){ return (u[e.key]||0) > 0; });
            used.sort(function(a,b){ return (u[b.key]||0) - (u[a.key]||0); });
            top = used.slice(0, 4);
        }catch(e){ top = []; }
        if (top.length < 4){
            var avail = QUICK_REG.filter(function(it){ var b = document.getElementById(it.btn); return b && b.style.display !== 'none'; });
            avail.sort(function(a,b){ return (u[b.key] || 0) - (u[a.key] || 0); });
            for (var i=0; i<avail.length && top.length<4; i++){
                (function(q){
                    for (var j=0;j<top.length;j++){ if (top[j].key === q.key) return; }
                    top.push({ label:q.label, emoji:q.emoji, key:q.key, go:q.fn });
                })(avail[i]);
            }
        }
        if (!top.length){ grid.innerHTML = '<p style="flex-basis:100%;text-align:center;color:#aab;font-size:12px;margin:0;">Your most-used tools will show up here.</p>'; return; }
        window._jumpToItems = top;
        grid.innerHTML = top.map(function(it, idx){
            var n = u[it.key] || 0;
            return '<div class="qcard" onclick="jumpToGo(' + idx + ')"><div class="ic">' + (it.emoji||'&#128204;') + '</div><b>' + escapeHtml(it.label||'') + '</b><small>' + (n ? ('Used ' + n + '&times;') : 'Tap to open') + '</small></div>';
        }).join('');
    }
    function jumpToGo(i){
        var it = (window._jumpToItems||[])[i];
        if (!it) return;
        try{ trackUse(it.key); }catch(e){}
        try{ it.go(); }catch(e){}
    }
    function quickLaunch(key){
        var it = null;
        for (var i=0;i<QUICK_REG.length;i++){ if (QUICK_REG[i].key === key){ it = QUICK_REG[i]; break; } }
        if (!it) return;
        trackUse(key);
        if (typeof it.fn === 'function') it.fn();
    }

    /* ===================== FIND ANYTHING — HUB REGISTRY (Phase 1) ===================== */
    /* ONE registry of ~every destination in the Hub, merged at runtime from two sources:
       (a) AUTO — every .menu-btn tile in #main-menu (its visibility = role truth, its own onclick = the action);
       (b) STATIC — destinations that are NOT tiles (PIP, admin-console cards, schedule tools, etc.).
       Entries: {id,label,emoji,keywords,roleCheck,go,key(usage)}. All go() calls are wrapped so a
       missing anchor degrades silently. Static entries with a `btn` enrich that tile with keywords
       (and inherit its label/emoji/visibility) instead of duplicating it. */
    var NEW_THIS_MONTH = ['dashboards','vehicles','myday','recentdone','nudge','pip','teamtasks'];
    function _hubRole(fn){ return function(){ try{ return (typeof window[fn]==='function') && !!window[fn](); }catch(e){ return false; } }; }
    function _hubScrollTo(id){ setTimeout(function(){ try{ var el=document.getElementById(id); if(el && el.scrollIntoView) el.scrollIntoView({behavior:'smooth',block:'start'}); }catch(e){} }, 350); }
    var HUB_STATIC_REG = [
        /* --- destinations that are NOT tiles --- */
        { id:'myday', label:'My Day (Home)', emoji:'&#127968;', section:'Home', keywords:['my day','today','overview','home','next shift','snapshot'], roleCheck:null, go:function(){ hubNav('home'); } },
        { id:'mytasks', label:'My Tasks', emoji:'&#9989;', section:'Tasks', keywords:['task','to do','todo','assigned to me'], roleCheck:null, go:function(){ openTasks(); } },
        { id:'teamtasks', label:'Team Task Board (quick-add)', emoji:'&#128203;', section:'Tasks', keywords:['team','board','quick add','assign','store tasks'], roleCheck:_hubRole('schedIsMgr'), go:function(){ openTasks(); taskSeg('team'); } },
        { id:'recentdone', label:'Recently Completed Tasks', emoji:'&#9989;', section:'Tasks', keywords:['recent','completed','done','finished','last 7 days','task history'], roleCheck:_hubRole('schedIsMgr'), go:function(){ openTasks(); taskSeg('team'); try{ if(!teamShowDone) toggleTeamDone(); }catch(e){} } },
        { id:'nudge', label:'Nudge a Task (remind assignee)', emoji:'&#128276;', section:'Tasks', keywords:['nudge','remind','reminder','poke','follow up'], roleCheck:_hubRole('schedIsMgr'), go:function(){ openTasks(); taskSeg('team'); } },
        { id:'pip', label:'Performance Improvement Plan (PIP)', emoji:'&#128200;', section:'Discipline', keywords:['pip','performance','improvement','plan','write up','corrective','probation'], roleCheck:_hubRole('isDiscAdmin'), go:function(){ openDiscipline(); } },
        { id:'keycontacts', label:'Key Contacts Editor (Emergency screen)', emoji:'&#128222;', section:'Admin Console', keywords:['key contacts','emergency numbers','after hours','police','utility'], roleCheck:_hubRole('isAdminManager'), go:function(){ openAdminConsole(); _hubScrollTo('admContactsList'); } },
        { id:'hublists', label:'Manage Lists (positions, checklists, inventory, temps)', emoji:'&#128221;', section:'Admin Console', keywords:['lists','positions','checklist items','inventory items','temp points','configure'], roleCheck:_hubRole('isAdminManager'), go:function(){ openAdminConsole(); _hubScrollTo('admListBox'); } },
        { id:'notifmatrix', label:'Notifications by Role', emoji:'&#128276;', section:'Admin Console', keywords:['notification','push','alerts','matrix','mute','role'], roleCheck:_hubRole('isAdminManager'), go:function(){ openAdminConsole(); _hubScrollTo('admNotifBox'); } },
        { id:'contactsadmin', label:'Contacts Directory Manager', emoji:'&#128222;', section:'Admin Console', keywords:['contacts directory','vendor list','manage contacts','escalation'], roleCheck:_hubRole('isAdminManager'), go:function(){ openAdminConsole(); _hubScrollTo('admContactsDirBox'); } },
        { id:'retention', key:'retention', label:'Data Retention', emoji:'&#128451;', section:'Admin Console', keywords:['retention','archive','keep records','years','history'], roleCheck:_hubRole('isAdminManager'), go:function(){ openRetention(); } },
        { id:'dupscan', key:'dupscan', label:'Duplicate Employees Scan', emoji:'&#128101;', section:'Admin Console', keywords:['duplicate','merge','same name','doubles','roster cleanup'], roleCheck:_hubRole('isAdminManager'), go:function(){ openDupScan(); } },
        { id:'mynotes', key:'mynotes', label:'My Coaching Notes', emoji:'&#128172;', section:'Home', keywords:['coaching','notes','feedback for me','support'], roleCheck:null, go:function(){ openMyNotes(); } },
        { id:'schedtemplates', label:'Schedule Templates', emoji:'&#129513;', section:'Schedule tools', keywords:['template','week template','copy schedule','reuse'], roleCheck:_hubRole('schedIsMgr'), go:function(){ openScheduling(); setTimeout(function(){ try{ openSchedTemplates(); }catch(e){} }, 600); } },
        { id:'schedconfirms', label:'Schedule Confirmations', emoji:'&#9989;', section:'Schedule tools', keywords:['confirm','confirmation','who has seen','acknowledged','week confirm'], roleCheck:_hubRole('schedIsMgr'), go:function(){ openScheduling(); setTimeout(function(){ try{ openWeekConfirms(); }catch(e){} }, 600); } },
        { id:'yvmine', label:'Your Voice — My Submissions', emoji:'&#128203;', section:'Your Voice', keywords:['my submissions','reference code','access code','check status','case','follow up'], roleCheck:null, go:function(){ openYourVoice(); setTimeout(function(){ try{ yv2Mine(); }catch(e){} }, 500); } },
        { id:'whatsnew', label:"What's New", emoji:'&#127881;', section:'Help', keywords:['whats new','new features','update','release','how to use'], roleCheck:null, go:function(){ openHowTo(); } },
        { id:'learningpaths', label:'My Training — Learning Paths', emoji:'&#127891;', section:'Training', keywords:['learning path','lms','course','lesson','quiz','certification','apron','scorm'], roleCheck:null, go:function(){ openLmsPreview(); } },
        { id:'messages', key:'messages', label:'Messages', emoji:'&#128172;', section:'Messages', keywords:['message','chat','dm','direct','announcement','broadcast','inbox','updates'], roleCheck:null, go:function(){ openMessages(); } },
        /* --- tile enrichments: inherit the tile's label/emoji/visibility, add search keywords --- */
        { id:'scheduling', key:'scheduling', btn:'btn-scheduling', keywords:['schedule builder','build','publish','weekly shifts','rota'] },
        { id:'preshift', btn:'btn-preshift', keywords:['pre shift','lineup','positions','huddle','goals'] },
        { id:'crewtrainer', btn:'btn-crewtrainer', keywords:['crew trainer','trainee','coach','training delivered'] },
        { id:'availability', btn:'btn-availApprovals', keywords:['availability requests','approve availability','deny'] },
        { id:'requests', btn:'requestsBtn', keywords:['time off approvals','swap','approve','deny','requests'] },
        { id:'assigntask', btn:'assignTaskBtn', keywords:['assign task','delegate','send task','crew task'] },
        { id:'timesheets', btn:'schedTimesheetsBtn', keywords:['timesheet','hours','overtime','payroll'] },
        { id:'roster', btn:'schedRosterBtn', keywords:['roster','staff list','logins','phone numbers','employees'] },
        { id:'roster2', btn:'rosterBtn', keywords:['roster','staff list','logins','phone numbers','employees'] },
        { id:'popin', key:'popin', btn:'btn-popIn', keywords:['pop in','inspection','walk through','store visit','audit'] },
        { id:'templogs', key:'temp', btn:'btn-tempLogs', keywords:['temperature','temp log','food safety','fridge','freezer','cooler'] },
        { id:'checklists', key:'checklists', btn:'btn-checklists', keywords:['checklist','opening','closing','cleaning','shift duties'] },
        { id:'inventory', key:'inventory', btn:'btn-inventory', keywords:['inventory','inventory count','inventory and supplies','count','par','reorder','supplies','stock'] },
        { id:'supply', key:'shortage', btn:'btn-shortage', keywords:['supply','shortage','report shortages','order','transfer','warehouse','restock','out of'] },
        { id:'discipline', btn:'btn-discipline', keywords:['discipline','write up','warning','verbal','written','final','termination'] },
        { id:'attendance', btn:'btn-attendance', keywords:['attendance','call out','callout','no show','absent','late','record','points'] },
        { id:'maintreport', key:'maintenance', btn:'btn-maintenance', keywords:['maintenance','required maintenance','report a repair','repair','flag','broken','fix'] },
        { id:'equipment', btn:'btn-equipment', keywords:['equipment','machine','qr code','pm','preventive','history'] },
        { id:'workorders', btn:'btn-workorders', keywords:['work order','wo','repair ticket','assign repair','track'] },
        { id:'contactsdir', btn:'btn-contacts', keywords:['contacts','phone','vendor','utility','directory','call','numbers'] },
        { id:'damage', key:'damage', btn:'btn-damage', keywords:['damage','accident','crash','vehicle','trailer','photos'] },
        { id:'maintboard', btn:'maintBoardBtn', keywords:['maintenance board','prioritize','repairs'] },
        { id:'mysubmissions', btn:'mySubmissionsBtn', keywords:['my submissions','past reports','history','sent'] },
        { id:'driver', key:'driver', btn:'btn-driver', keywords:['driver','vehicle','trailer','checkout','check out','pre roll','fleet','safety'] },
        { id:'quotes', key:'quotes', btn:'quotesBtn', keywords:['quote','catering','event','pricing','estimate'] },
        { id:'salespipeline', btn:'salesPipelineBtn', keywords:['pipeline','leads','catering sales'] },
        { id:'dashboards', btn:'btn-dashboards', keywords:['dashboard','dashboards','metrics','kpi','numbers','reports'] },
        { id:'livedash', btn:'adminDashBtn', keywords:['live dashboard','dashboards','ncr','square','pulse','revenue','sales now'], go:function(){ openDashboards('live'); } },
        { id:'commandcenter', btn:'commandCenterBtn', keywords:['command center','dashboards','ops','at a glance','live ops'], go:function(){ openDashboards('command'); } },
        { id:'dailysales', btn:'salesBtn', keywords:['daily sales','labor','sales entry','deposit'] },
        { id:'primecost', btn:'primeCostBtn', keywords:['prime cost','food cost','labor cost','weekly','xlsx'] },
        { id:'managerdash', btn:'managerBtn', keywords:['manager dashboard','dashboards','submissions','activity'], go:function(){ openDashboards('manager'); } },
        { id:'teachscoopy', btn:'knowledgeBaseBtn', keywords:['teach','scoopy','ai','knowledge base','chatbot','train'] },
        { id:'adminconsole', key:'admincon', btn:'btn-admin-console', keywords:['admin console','settings','configure','manage the hub'] },
        { id:'permmatrix', btn:'btn-permMatrix', keywords:['permissions','roles','access','who sees what'] },
        { id:'celebrations', btn:'celebrationsBtn', keywords:['birthday','anniversary','milestone','award','celebrate','recognition'] },
        { id:'shortagetrends', btn:'shortageTrendsBtn', keywords:['shortage trends','runs low','often','analytics'] },
        { id:'teamdev', btn:'teamDevBtn', keywords:['team development','growth','promotion','progression','training status'] },
        { id:'fundraiser', key:'fundraiser2', btn:'btn-fundraiserHub', keywords:['fundraiser','cards','organizer','reconciliation','inquiries'] },
        { id:'marketing', key:'marketing2', btn:'btn-marketingHub', keywords:['marketing','campaign','social','promotion','budget','assets','advertising','flyer'] },
        { id:'teamgrowth', key:'teamgrowth', btn:'btn-teamGrowth', keywords:['growth','evaluation','review','pay','raise','proposal','certification','development','passport'] },
        { id:'dailyreport', key:'dailyreport', btn:'btn-dailyReport', keywords:['daily','closeout','close out','ring out','log book','labor','deposit','over short','store report'] },
        { id:'maintbilling', key:'maintbill', btn:'btn-maintBilling', keywords:['invoice','billing','vendor rates','approve','pay','finance'] },
        { id:'maintdash', key:'maintdash', btn:'btn-maintDash', keywords:['maintenance dashboard','dashboards','costs by store','vendor spend','leadership'], go:function(){ openDashboards('maint'); } },
        { id:'storemanager', key:'stores2', btn:'btn-storeManager', keywords:['stores','locations','add store','rename store'] },
        { id:'catering', key:'catering', btn:'btn-catering', keywords:['catering','quote','event','inquiry','booking','beo','sundae cart','treat trailer'] },
        { id:'scorecards', key:'scorecards2', btn:'btn-scorecards', keywords:['scorecard','dashboards','metrics','kpi','sales vs ly','labor','speed','inspection'], go:function(){ openDashboards('scorecards'); } },
        { id:'vehicles', btn:'btn-vehicles', keywords:['vehicle service','vehicles','oil change','mileage','fleet service','truck','trailer service','service tracker'] },
        { id:'emergency', btn:'btn-emergency', keywords:['emergency','fire','robbery','power outage','911','procedures','food safety'] },
        { id:'myhome', btn:'btn-empHome', keywords:['my home','my shifts','my updates','employee home'] },
        { id:'forms', btn:'btn-formsDocs', keywords:['forms','documents','payroll','hr','w2','w4','hiring','pdf'] },
        { id:'training', btn:'btn-training', keywords:['training','recipes','how to','guides','resources','portal'] },
        { id:'yourvoice', btn:'btn-report', keywords:['your voice','concern','anonymous','confidential','idea','feedback','help','survey','speak up','report'] },
        { id:'apptour', btn:'btn-howto', keywords:['tour','walkthrough','how to use the hub','guide'] }
    ];
    function hubTileSection(el){
        try{
            if(!el || !el.closest) return '';
            var p=el.closest('.menu-tab-content'); if(!p) return '';
            return ({ 'tab-content-home':'Home', 'tab-content-scheduling':'Schedule', 'tab-content-operations':'Work', 'tab-content-teamhr':'Team', 'tab-content-management':'Admin', 'tab-content-sections':'All Sections' })[p.id] || '';
        }catch(e){ return ''; }
    }
    function _hubTileHidden(t){
        if (t.style.display==='none') return true; /* hidden by role/permission gates */
        try{
            if (t.closest && t.closest('#futureIntegrations')) return true; /* placeholder integrations stub */
            /* role-gated segment panes: the pane's seg button is the role truth for its tiles */
            var pane=t.closest ? t.closest('.sched-pane') : null;
            if(pane){ var seg={ schedPaneBuild:'schedSegBuild', maintPaneBoard:'maintSegBoard' }[pane.id];
                if(seg){ var sb=document.getElementById(seg); if(sb && sb.style.display==='none') return true; } }
        }catch(e){}
        return false;
    }
    function hubRegistryAll(){
        var out=[], seenLabels={}, claimed={}, btnKey={};
        try{ (typeof QUICK_REG!=='undefined'?QUICK_REG:[]).forEach(function(q){ if(q.btn && !btnKey[q.btn]) btnKey[q.btn]=q.key; }); }catch(e){}
        /* 1. static entries (richer keywords win the label over the plain tile sweep) */
        (HUB_STATIC_REG||[]).forEach(function(s){
            try{
                var el = s.btn ? document.getElementById(s.btn) : null;
                if (s.btn){ claimed[s.btn]=1; if(!el || _hubTileHidden(el)) return; }
                if (s.roleCheck && !s.roleCheck()) return;
                var label=s.label||'', emoji=s.emoji||'', sub=s.sub||'', section=s.section||'';
                if (el){
                    var lb=el.querySelector('b'); if(lb && lb.textContent) label=lb.textContent.trim();
                    var ic=el.querySelector('.tile-ic'); if(ic && ic.textContent) emoji=ic.textContent;
                    var sm=el.querySelector('small'); if(sm) sub=(sm.textContent||'');
                    if(!section) section=hubTileSection(el);
                }
                if (!label) return;
                var go = s.go || (el ? (function(e2){ return function(){ e2.click(); }; })(el) : null);
                if (!go) return;
                var lk=label.toLowerCase(); if(seenLabels[lk]) return; seenLabels[lk]=1;
                out.push({ id:s.id, label:label, emoji:emoji, sub:sub, section:section, keywords:s.keywords||[], go:go, key:(s.key || (s.btn && btnKey[s.btn]) || ('find:'+s.id)) });
            }catch(e){}
        });
        /* 2. auto sweep: every remaining visible menu tile (role truth from the DOM) */
        try{
            var tiles=document.querySelectorAll('#main-menu .menu-btn');
            for(var i=0;i<tiles.length;i++){
                (function(t){
                    if(t.id && claimed[t.id]) return;
                    if(_hubTileHidden(t)) return;
                    var lb=t.querySelector('b'); var label=lb?(lb.textContent||'').trim():''; if(!label) return;
                    var lk=label.toLowerCase(); if(seenLabels[lk]) return; seenLabels[lk]=1;
                    var ic=t.querySelector('.tile-ic'); var sm=t.querySelector('small');
                    out.push({ id:'tile:'+(t.id||lk), label:label, emoji:ic?(ic.textContent||''):'', sub:sm?(sm.textContent||''):'', section:hubTileSection(t), keywords:[], go:function(){ t.click(); }, key:((t.id && btnKey[t.id]) || ('tile:'+(t.id||lk))) });
                })(tiles[i]);
            }
        }catch(e){}
        return out;
    }
    /* =================== END FIND ANYTHING — HUB REGISTRY =================== */

    function updatePreviewToggleBtn() {
        const btn = document.getElementById('previewToggleBtn');
        if (!btn) return;
        if (currentUser.is_developer !== true) { btn.style.display = 'none'; return; }
        btn.style.display = 'block';
        btn.innerText = isPreviewMode() ? '👁️ Exit Preview (Show All Tabs)' : '👁️ Preview as Staff (Hide Dev Tabs)';
    }

    function applyFormPermissions() {
        const perms = currentUser.permissions;
        const devOverride = currentUser.is_developer === true && !isPreviewMode();
        FORM_KEYS.forEach(f => {
            const btn = document.getElementById(f.btnId);
            if (!btn) return;
            /* Default-deny: with no explicit per-user permissions saved, never un-hide a role-gated
               tile — applyRoleUI() already decided its visibility (fixes employees seeing Pop-In). */
            if (f.roleGated && !devOverride && !perms) return;
            btn.style.display = (devOverride || !perms || perms.indexOf(f.key) !== -1) ? 'block' : 'none';
        });
    }


    // ============================================================
    // GLOBAL "get me out of here" — Escape key + phone/browser Back
    // close the top open full-screen overlay or return an app-view to the
    // main menu. Fixes screens (Marketing/Fundraiser/etc.) that trapped the
    // user because the hardware Back button did nothing.
    // ============================================================
    function hubTopOverlayClose(){
        try{
            var nested=['mcModal2','fhModal2','wobModal2','invoicePreviewOv','setPwModal'];
            for(var i=0;i<nested.length;i++){ var n=document.getElementById(nested[i]); if(n && n.offsetParent!==null && getComputedStyle(n).display!=='none'){ n.style.display='none'; return true; } }
            var full=['marketingModal','fundraiserHubModal','wobModal'];
            for(var j=0;j<full.length;j++){ var o=document.getElementById(full[j]); if(o && getComputedStyle(o).display!=='none'){ o.style.display='none'; return true; } }
            var mm=document.getElementById('main-menu');
            var views=document.querySelectorAll('.app-view');
            for(var k=0;k<views.length;k++){ var v=views[k]; if(v.id && v.id!=='main-menu' && v.id!=='login-view' && v.id!=='splash-screen' && getComputedStyle(v).display!=='none'){ v.style.display='none'; if(mm) mm.style.display='block'; try{ window.scrollTo(0,0); }catch(e){} return true; } }
        }catch(e){}
        return false;
    }
    window.hubTopOverlayClose=hubTopOverlayClose;
    document.addEventListener('keydown', function(e){ if(e.key==='Escape' || e.keyCode===27){ if(hubTopOverlayClose()){ e.preventDefault(); } } });
    // Keep one sentinel history entry so the FIRST Back press closes an overlay
    // instead of leaving the app. Re-push after each close so it keeps working.
    try{ if(!window.__hubBackWired){ window.__hubBackWired=true; history.pushState({hub:1},''); window.addEventListener('popstate', function(){ var closed=hubTopOverlayClose(); if(closed){ try{ history.pushState({hub:1},''); }catch(e){} } }); } }catch(e){}

