        // ============================================================
        // AI CHAT WIDGET
        // ============================================================
        let aiChatHistory = [];
        let aiChatOpen = false;

        function toggleAIChatPanel() {
            const panel = document.getElementById('aiChatPanel');
            if (!panel) return;
            aiChatOpen = !aiChatOpen;
            panel.style.display = aiChatOpen ? 'flex' : 'none';
            if (aiChatOpen && aiChatHistory.length === 0) {
                appendAIMessage('bot', "Hi! I'm Mr. Scoopy 🍦 Ask me anything about Caliche's operations, policies, or procedures!");
            }
        }

        function appendAIMessage(role, text) {
            const msgs = document.getElementById('aiChatMessages');
            if (!msgs) return;
            const div = document.createElement('div');
            const isBot = role === 'bot';
            div.style.cssText = 'max-width:85%;padding:9px 13px;border-radius:' + (isBot ? '4px 14px 14px 14px' : '14px 4px 14px 14px') + ';font-size:13.5px;line-height:1.45;word-break:break-word;' + (isBot ? 'background:#f0f4ff;color:#222;align-self:flex-start;' : 'background:var(--caliches-pink);color:#fff;align-self:flex-end;');
            div.innerText = text;
            msgs.appendChild(div);
            msgs.scrollTop = msgs.scrollHeight;
        }

        // Build a friendly description of who Scoopy is talking to (name, role, store) plus a tone cue.
        function scoopyUserContext() {
            try {
                if (!currentUser || !currentUser.name) return 'Team Member';
                var role = currentUser.role || 'team member';
                if (role === 'Vice President/Co-Owner') role = 'Vice President / Co-Owner';
                var store = (typeof activeStoreLoc === 'function' && activeStoreLoc()) || currentUser.home_location || '';
                var who = currentUser.name + ', who is a ' + role + (store ? ' (home store: ' + store + ')' : '');
                return who + '. Greet them by their first name, keep things warm and personable, and respond with genuine empathy and emotion when the situation calls for it';
            } catch (e) { return (currentUser && currentUser.name) || 'Team Member'; }
        }

        async function sendAIMessage() {
            const input = document.getElementById('aiChatInput');
            if (!input) return;
            const msg = input.value.trim();
            if (!msg) return;
            input.value = '';
            appendAIMessage('user', msg);
            appendAIMessage('bot', '...');
            const msgs = document.getElementById('aiChatMessages');
            const typingEl = msgs ? msgs.lastChild : null;

            try {
                const resp = await fetch(G_URL + '?action=ai&message=' + encodeURIComponent(msg) + '&history=' + encodeURIComponent(JSON.stringify(aiChatHistory)) + '&userName=' + encodeURIComponent(scoopyUserContext()));
                const json = await resp.json();
                const reply = (json && json.reply) ? json.reply : "I'm not sure about that. Please check with your manager!";
                if (typingEl) typingEl.innerText = reply;
                else appendAIMessage('bot', reply);
                aiChatHistory.push({ role: 'user', parts: [{ text: msg }] });
                aiChatHistory.push({ role: 'model', parts: [{ text: reply }] });
                if (aiChatHistory.length > 20) aiChatHistory = aiChatHistory.slice(-20);
                // Gap tracking: log unanswered questions
                if (reply && (reply.toLowerCase().includes("not sure") || reply.toLowerCase().includes("check with") || reply.toLowerCase().includes("don't have") || reply.toLowerCase().includes("contact your manager"))) {
                    logScoopyGap(msg);
                }
            } catch(e) {
                if (typingEl) typingEl.innerText = "Sorry, I couldn't connect right now. Try again!";
            }
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'aiChatInput') {
                sendAIMessage();
            }
        });

    /* ===== P4 FEATURE BUNDLE ===== (P4_FEATURE_BUNDLE_SENTINEL)
       Sick leave · auto-late scan · manager logbook · announcement read receipts ·
       OT watch + open punches · my attendance · under-15 curfew · checklist due-windows.
       Append-only module: wraps existing functions by reassignment, never edits them. */
    function p4Esc(s){ try{ return escapeHtml(s==null?'':String(s)); }catch(e){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return '&#'+c.charCodeAt(0)+';';}); } }
    function p4Mgr(){ try{ return (typeof isManagerRole==='function'&&isManagerRole())||(typeof schedIsMgr==='function'&&schedIsMgr()); }catch(e){ return false; } }
    var P4_DB_MSG='This feature needs the database update — it will light up after the next deploy.';
    function p4Rpc(name,args,cb,errcb){
        try{
            withPin(function(pin){
                var full={p_username:currentUser.username,p_password:pin};
                for(var k in (args||{})){ full[k]=args[k]; }
                supabaseClient.rpc(name,full).then(function(r){
                    if(r.error){ if(r.error.code==='42501') sessionPin=null;
                        var m=String(r.error.message||'');
                        if(/could not find|does not exist|schema cache/i.test(m)) m=P4_DB_MSG;
                        if(errcb) errcb(m); else alert(m); return; }
                    cb(r.data);
                }).then(null,function(){ if(errcb) errcb('Connection error.'); });
            },function(){ if(errcb) errcb('PIN required.'); });
        }catch(e){ if(errcb) errcb(P4_DB_MSG); }
    }
    function p4View(id,html){
        var v=document.getElementById(id);
        if(!v){ v=document.createElement('div'); v.id=id; v.className='app-view'; v.style.display='none'; document.body.appendChild(v); }
        v.innerHTML=html; return v;
    }
    function p4Open(id){
        try{ document.getElementById('main-menu').style.display='none'; }catch(e){}
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        var v=document.getElementById(id); if(v) v.style.display='block';
        window.scrollTo(0,0);
    }
    function p4CardO(t,sub){ return '<div style="background:var(--surface,#fff);border:1px solid var(--bd,#ececf2);border-radius:14px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,.05);margin-top:14px;"><b style="font-size:15px;color:var(--txt,#26242b);">'+t+'</b>'+(sub?'<div style="font-size:12.5px;color:var(--txt2,#8a8594);margin:4px 0 8px;">'+sub+'</div>':'')+''; }
    function p4StatusChip(st){
        var m={pending:['#fff3cd','#854F0B','Pending'],approved:['#e7f6ec','#1f7a3d','Approved'],denied:['#fdecea','#c0392b','Denied']};
        var c=m[String(st||'').toLowerCase()]||['#eef1f6','#5b6472',st||''];
        return '<span style="background:'+c[0]+';color:'+c[1]+';padding:2px 10px;border-radius:99px;font-size:11.5px;font-weight:800;">'+p4Esc(c[2])+'</span>';
    }

    /* ---------- 1. SICK LEAVE ---------- */
    var p4SickTabCur='req';
    function openSickLeave(){
        var mgrTab=p4Mgr()?'<button id="p4skTabQ" onclick="p4SickTab(\'q\')" class="msg-tab">Approvals</button>':'';
        p4View('p4SickView',
            '<button class="back-btn" onclick="openMenu()">&#128281; Back to Menu</button>'+
            '<div class="hb-head" style="background:linear-gradient(120deg,#0d6eaf,#31a06a);"><div class="hb-ico">&#129298;</div><div><h2>Sick Leave</h2><div class="hb-sub">Request paid sick time &middot; New Mexico HWA</div></div></div>'+
            '<div class="container" style="max-width:680px;">'+
            '<div style="display:flex;gap:6px;margin-bottom:10px;"><button id="p4skTabReq" onclick="p4SickTab(\'req\')" class="msg-tab active">Request</button><button id="p4skTabMine" onclick="p4SickTab(\'mine\')" class="msg-tab">My requests</button>'+mgrTab+'</div>'+
            '<div id="p4skPaneReq">'+p4CardO('&#129298; Request sick leave','Pick your dates and hours. If the request can&rsquo;t be granted, we&rsquo;ll tell you exactly why.')+
                '<label class="rm-lbl">First day</label><input id="p4skStart" type="date" class="rm-inp">'+
                '<label class="rm-lbl" style="margin-top:8px;">Last day</label><input id="p4skEnd" type="date" class="rm-inp">'+
                '<label class="rm-lbl" style="margin-top:8px;">Total hours requested</label><input id="p4skHours" type="number" min="0.5" step="0.5" class="rm-inp" placeholder="e.g. 8">'+
                '<label class="rm-lbl" style="margin-top:8px;">Note (optional)</label><textarea id="p4skNote" rows="2" class="rm-inp" placeholder="Anything your manager should know"></textarea>'+
                '<div id="p4skWhy" style="display:none;background:#fdecea;border:1px solid #f3c2cb;color:#a01b3e;border-radius:10px;padding:10px 12px;margin-top:10px;font-size:13.5px;font-weight:600;"></div>'+
                '<button onclick="p4SickSubmit()" class="sched-btn publish" style="width:100%;margin-top:12px;">Submit request</button>'+
                '<p style="font-size:11.5px;color:var(--txt2,#8a8594);margin:10px 0 0;">Your manager is notified and will approve or deny it. Sick time follows the NM Healthy Workplaces Act.</p></div>'+
            '</div>'+
            '<div id="p4skPaneMine" style="display:none;">'+p4CardO('&#128203; My sick-leave requests','Last 12 months')+'<div id="p4skMineList"><p style="color:#6b7686;font-size:13px;">Loading&hellip;</p></div></div></div>'+
            '<div id="p4skPaneQ" style="display:none;">'+p4CardO('&#9989; Team requests — approve or deny','Pending first. Denials always include the reason.')+'<div id="p4skQList"><p style="color:#6b7686;font-size:13px;">Loading&hellip;</p></div></div></div>'+
            '</div>');
        p4Open('p4SickView'); p4SickTab('req');
    }
    function p4SickTab(t){
        p4SickTabCur=t;
        var m={req:'p4skPaneReq',mine:'p4skPaneMine',q:'p4skPaneQ'};
        Object.keys(m).forEach(function(k){ var el=document.getElementById(m[k]); if(el) el.style.display=(k===t)?'block':'none'; });
        [['p4skTabReq','req'],['p4skTabMine','mine'],['p4skTabQ','q']].forEach(function(p){ var el=document.getElementById(p[0]); if(el) el.className='msg-tab'+(p4SickTabCur===p[1]?' active':''); });
        if(t==='mine') p4SickLoadMine();
        if(t==='q') p4SickLoadQueue();
    }
    function p4SickSubmit(){
        var s=document.getElementById('p4skStart').value, e=document.getElementById('p4skEnd').value||s;
        var h=parseFloat(document.getElementById('p4skHours').value);
        var note=document.getElementById('p4skNote').value.trim();
        var why=document.getElementById('p4skWhy');
        why.style.display='none';
        if(!s){ alert('Pick the first day.'); return; }
        if(!h||h<=0){ alert('Enter the hours you need.'); return; }
        p4Rpc('app_sick_request',{p_start_date:s,p_end_date:e,p_hours:h,p_note:note||null},function(d){
            d=d||{};
            if(d.ok===false){ why.innerHTML='&#9888;&#65039; '+p4Esc(d.reason||'This request can&rsquo;t be granted right now.'); why.style.display='block'; try{ why.scrollIntoView({behavior:'smooth',block:'center'}); }catch(e2){} return; }
            document.getElementById('p4skStart').value=''; document.getElementById('p4skEnd').value=''; document.getElementById('p4skHours').value=''; document.getElementById('p4skNote').value='';
            alert('Request sent! Your manager has been notified.');
            p4SickTab('mine');
        },function(m){ why.innerHTML='&#9888;&#65039; '+p4Esc(m); why.style.display='block'; });
    }
    function p4SickRow(r,mgr){
        var when=p4Esc(r.start_date||'')+(r.end_date&&r.end_date!==r.start_date?' &rarr; '+p4Esc(r.end_date):'');
        var h='<div style="padding:10px 0;border-bottom:1px solid var(--bd,#eee);">'+
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><b style="font-size:13.5px;color:var(--txt,#333);">'+(mgr?p4Esc(r.name||'')+' &middot; ':'')+when+'</b>'+p4StatusChip(r.status)+'</div>'+
            '<div style="font-size:12.5px;color:var(--txt2,#6b7686);margin-top:2px;">'+p4Esc(String(r.hours||0))+' hr'+(r.location?' &middot; '+p4Esc(r.location):'')+(r.note?' &middot; &ldquo;'+p4Esc(r.note)+'&rdquo;':'')+(r.decided_by?' &middot; decided by '+p4Esc(r.decided_by):'')+'</div>';
        if(mgr && String(r.status||'').toLowerCase()==='pending'){
            h+='<div style="display:flex;gap:8px;margin-top:8px;"><button onclick="p4SickDecide('+r.id+',true)" style="flex:1;background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:8px;font-weight:800;cursor:pointer;">Approve</button><button onclick="p4SickDecide('+r.id+',false)" style="flex:1;background:#fff2f3;color:#c0264b;border:1px solid #f0b8c3;border-radius:8px;padding:8px;font-weight:800;cursor:pointer;">Deny</button></div>';
        }
        return h+'</div>';
    }
    function p4SickLoadMine(){
        var el=document.getElementById('p4skMineList'); if(!el) return;
        el.innerHTML='<p style="color:#6b7686;font-size:13px;">Loading&hellip;</p>';
        p4Rpc('app_sick_list',{p_scope:'self'},function(d){
            var rows=d||[];
            el.innerHTML=rows.length?rows.map(function(r){ return p4SickRow(r,false); }).join(''):'<p style="color:#6b7686;font-size:13px;">No sick-leave requests yet.</p>';
        },function(m){ el.innerHTML='<p style="color:#c0392b;font-size:13px;">'+p4Esc(m)+'</p>'; });
    }
    function p4SickLoadQueue(){
        var el=document.getElementById('p4skQList'); if(!el) return;
        if(!p4Mgr()){ el.innerHTML='<p style="color:#6b7686;font-size:13px;">Approvals are for managers.</p>'; return; }
        el.innerHTML='<p style="color:#6b7686;font-size:13px;">Loading&hellip;</p>';
        p4Rpc('app_sick_list',{p_scope:'all'},function(d){
            var rows=d||[];
            el.innerHTML=rows.length?rows.map(function(r){ return p4SickRow(r,true); }).join(''):'<p style="color:#6b7686;font-size:13px;">No requests from the team yet.</p>';
        },function(m){ el.innerHTML='<p style="color:#c0392b;font-size:13px;">'+p4Esc(m)+'</p>'; });
    }
    function p4SickDecide(id,approve){
        if(!approve && !confirm('Deny this sick-leave request? The employee will see the reason.')) return;
        p4Rpc('app_sick_decide',{p_id:id,p_approve:approve},function(d){
            d=d||{};
            if(d.ok===false){ alert(d.reason||'Could not record the decision.'); p4SickLoadQueue(); return; }
            p4SickLoadQueue();
        });
    }

    /* ---------- 2. AUTO-LATE SCAN (Attendance screen, mgr) ---------- */
    openAttendance=(function(orig){ return function(){ orig.apply(this,arguments); try{ p4AttInject(); }catch(e){} }; })(openAttendance);
    function p4AttInject(){
        var v=document.getElementById('attendanceView'); if(!v||v.style.display==='none') return;
        if(!document.getElementById('p4attScanCard')){
            var d=document.createElement('div'); d.id='p4attScanCard';
            var host=v.querySelector('.container')||v;
            host.insertBefore(d, host.firstChild&&host.firstChild.nextSibling?host.firstChild.nextSibling:null);
        }
        document.getElementById('p4attScanCard').innerHTML=p4CardO('&#9889; Unreported late clock-ins','Compares today&rsquo;s published shifts with actual clock-ins. Tardies found are logged automatically and appear in the record below.')+
            '<button onclick="p4AttScan()" class="sched-btn publish" style="width:100%;">Scan today</button><div id="p4attScanOut" style="margin-top:10px;"></div></div>';
    }
    function p4AttScan(){
        var out=document.getElementById('p4attScanOut'); if(!out) return;
        out.innerHTML='<p style="color:#6b7686;font-size:13px;">Scanning today&rsquo;s shifts&hellip;</p>';
        p4Rpc('app_attendance_autoscan',{},function(d){
            d=d||{};
            if(d.ok===false){ out.innerHTML='<p style="color:#c0392b;font-size:13px;">'+p4Esc(d.reason||'Scan failed.')+'</p>'; return; }
            var t=d.tardies_logged||[], n=d.no_shows||[], h='';
            h+='<div style="font-size:12px;color:#6b7686;margin-bottom:6px;">Scanned '+p4Esc(String(d.scanned||0))+' shift(s) for '+p4Esc(d.date||'today')+' &middot; late = '+p4Esc(String(d.threshold_min||7))+'+ min</div>';
            if(!t.length&&!n.length){ h+='<div style="background:#e7f6ec;color:#1f7a3d;border-radius:8px;padding:9px 11px;font-size:13px;font-weight:700;">&#9989; Nothing unreported — everyone clocked in on time.</div>'; }
            if(t.length){ h+='<div style="font-weight:800;font-size:13px;color:#854F0B;margin:6px 0 3px;">&#9200; Tardies logged automatically ('+t.length+')</div>'+t.map(function(x){ return '<div style="font-size:13px;padding:3px 0;">'+p4Esc(x.name||'')+' &middot; '+p4Esc(String(x.minutes_late||0))+' min late'+(x.location?' &middot; '+p4Esc(x.location):'')+'</div>'; }).join(''); }
            if(n.length){ h+='<div style="font-weight:800;font-size:13px;color:#a01b3e;margin:8px 0 3px;">&#10067; No punch yet — possible no-shows (not auto-logged)</div>'+n.map(function(x){ return '<div style="font-size:13px;padding:3px 0;">'+p4Esc(x.name||'')+' &middot; shift started '+p4Esc(x.shift_start||'')+(x.location?' &middot; '+p4Esc(x.location):'')+'</div>'; }).join('')+'<div style="font-size:11.5px;color:#6b7686;margin-top:4px;">Confirm with the store before logging a no-show.</div>'; }
            out.innerHTML=h;
        },function(m){ out.innerHTML='<p style="color:#c0392b;font-size:13px;">'+p4Esc(m)+'</p>'; });
    }

    /* ---------- 3. MANAGER LOGBOOK ---------- */
    function openLogbook(){
        if(!p4Mgr()){ alert('The Manager Logbook is for shift leads and managers.'); return; }
        var stores=(typeof HUB_STORES!=='undefined'&&HUB_STORES.length)?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell'];
        var opts=stores.map(function(s){ return '<option'+(currentUser&&currentUser.store===s?' selected':'')+'>'+p4Esc(s)+'</option>'; }).join('');
        p4View('p4LogView',
            '<button class="back-btn" onclick="openMenu()">&#128281; Back to Menu</button>'+
            '<div class="hb-head" style="background:linear-gradient(120deg,#3b2f6b,#7a4bd3);"><div class="hb-ico">&#128211;</div><div><h2>Manager Logbook</h2><div class="hb-sub">Shift diary &mdash; pass the torch between shifts</div></div></div>'+
            '<div class="container" style="max-width:680px;">'+
            p4CardO('&#9999;&#65039; Add a note','What should the next shift know? Staffing, equipment, incidents, wins&hellip;')+
                '<div style="display:flex;gap:8px;"><select id="p4lbStore" class="rm-inp" style="flex:2;">'+opts+'</select><select id="p4lbShift" class="rm-inp" style="flex:1;"><option>AM</option><option>PM</option></select></div>'+
                '<textarea id="p4lbNote" rows="3" class="rm-inp" style="margin-top:8px;" placeholder="e.g. Freezer 2 running warm — PM watch it. Maria crushed the rush."></textarea>'+
                '<button onclick="p4LogAdd()" class="sched-btn publish" style="width:100%;margin-top:10px;">Save to logbook</button></div>'+
            p4CardO('&#128214; Today','Newest first')+'<div id="p4lbToday"><p style="color:#6b7686;font-size:13px;">Loading&hellip;</p></div></div>'+
            '<div style="margin-top:14px;"><button onclick="p4LogToggleHist()" style="width:100%;background:none;border:1px dashed var(--bd,#ccc);border-radius:12px;padding:10px;color:var(--txt2,#6b7686);font-weight:700;cursor:pointer;" id="p4lbHistBtn">&#9662; Show last 7 days</button><div id="p4lbHist" style="display:none;margin-top:8px;"></div></div>'+
            '</div>');
        p4Open('p4LogView'); p4LogLoad();
    }
    function p4LogAdd(){
        var loc=document.getElementById('p4lbStore').value, sh=document.getElementById('p4lbShift').value, note=document.getElementById('p4lbNote').value.trim();
        if(!note){ alert('Write the note first.'); return; }
        p4Rpc('app_logbook_add',{p_location:loc,p_shift:sh,p_note:note},function(d){
            if(d&&d.ok===false){ alert(d.reason||'Could not save.'); return; }
            document.getElementById('p4lbNote').value='';
            p4LogLoad();
        });
    }
    function p4LogRowHtml(r){
        return '<div style="padding:9px 0;border-bottom:1px solid var(--bd,#eee);"><div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--txt2,#8a8594);"><span><b style="color:var(--txt,#444);">'+p4Esc(r.author_name||'')+'</b> &middot; '+p4Esc(r.location||'')+' &middot; '+p4Esc(r.shift||'')+'</span><span>'+p4Esc(r.entry_date||'')+'</span></div><div style="font-size:13.5px;color:var(--txt,#333);white-space:pre-wrap;margin-top:3px;">'+p4Esc(r.note||'')+'</div></div>';
    }
    function p4LogLoad(){
        var elT=document.getElementById('p4lbToday'), elH=document.getElementById('p4lbHist');
        if(!elT) return;
        p4Rpc('app_logbook_list',{p_location:'All',p_days:7},function(d){
            var rows=d||[]; var today=new Date(); var tzoff=today.getTimezoneOffset()*60000;
            var todayStr=new Date(today-tzoff).toISOString().slice(0,10);
            var t=rows.filter(function(r){ return r.entry_date===todayStr; });
            var old=rows.filter(function(r){ return r.entry_date!==todayStr; });
            elT.innerHTML=t.length?t.map(p4LogRowHtml).join(''):'<p style="color:#6b7686;font-size:13px;">No notes yet today. Be the first!</p>';
            if(elH) elH.innerHTML=old.length?old.map(p4LogRowHtml).join(''):'<p style="color:#6b7686;font-size:13px;">Nothing in the last 7 days.</p>';
        },function(m){ elT.innerHTML='<p style="color:#c0392b;font-size:13px;">'+p4Esc(m)+'</p>'; });
    }
    function p4LogToggleHist(){
        var h=document.getElementById('p4lbHist'), b=document.getElementById('p4lbHistBtn');
        if(!h) return; var open=h.style.display!=='none';
        h.style.display=open?'none':'block';
        if(b) b.innerHTML=open?'&#9662; Show last 7 days':'&#9652; Hide history';
    }

    /* ---------- 4. ANNOUNCEMENT READ RECEIPTS ---------- */
    loadUpdates=(function(){ return function(){
        var c=document.getElementById('msgContent');
        withPin(function(pin){
            supabaseClient.rpc('app_announce_feed',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; c.innerHTML='<p style="color:red;text-align:center;">'+p4Esc(r.error.message)+'</p>'; return; }
                if(r.data && r.data.linked===false){ c.innerHTML='<p style="text-align:center;padding:20px;color:#6b7686;">Your login isn\'t linked yet — ask a manager to link your account.</p>'; return; }
                var items=(r.data&&r.data.items)||[]; var h='';
                if(isMgr()){
                    h+='<div style="background:#fff;border:1px solid #eee;border-radius:12px;padding:14px;margin-bottom:14px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">' +
                        '<div style="font-size:14px;font-weight:500;color:#6a3fb5;margin-bottom:8px;">Post an update</div>' +
                        '<input id="anTitle" placeholder="Title (optional)" style="width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px;">' +
                        '<textarea id="anBody" rows="2" placeholder="What&#39;s the update? (new item, policy change…)" style="width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px;"></textarea>' +
                        '<div style="display:flex;gap:8px;"><select id="anAud" onchange="anAudChange()" style="flex:1;padding:9px;border:1px solid #ccc;border-radius:8px;"><option value="everyone">Everyone</option><option value="store">A store</option></select>' +
                        '<select id="anStore" style="flex:1;padding:9px;border:1px solid #ccc;border-radius:8px;display:none;"></select>' +
                        '<button onclick="postAnnounce()" style="background:#6a3fb5;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-weight:bold;cursor:pointer;">Post</button></div></div>';
                }
                if(!items.length){ h+='<p style="color:#6b7686;text-align:center;padding:10px;font-size:13px;">No updates yet.</p>'; }
                else items.forEach(function(a){
                    var _amg=isMgr()?('<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;"><button onclick="annEditItem('+a.id+')" style="background:#f3eeff;color:#6a3fb5;border:1px solid #d9c9f5;border-radius:7px;padding:4px 11px;font-size:12px;font-weight:700;cursor:pointer;">Edit</button><button onclick="annDeleteItem('+a.id+')" style="background:#fff2f3;color:#c0264b;border:1px solid #f0b8c3;border-radius:7px;padding:4px 11px;font-size:12px;font-weight:700;cursor:pointer;">Delete</button><button onclick="p4AnnWho('+a.id+')" style="background:#eef6fd;color:#0d6eaf;border:1px solid #bcdcf2;border-radius:7px;padding:4px 11px;font-size:12px;font-weight:700;cursor:pointer;">&#128065; Who&rsquo;s read</button></div><div id="p4annwho-'+a.id+'" style="display:none;font-size:12px;margin-top:6px;background:var(--surface2,#f7f8fb);border-radius:8px;padding:8px 10px;color:#445;"></div>'):'';
                    h+='<div style="background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 4px 6px rgba(0,0,0,0.05);'+(a.read?'':'border-left:4px solid #6a3fb5;')+'">' +
                        (a.title?'<div style="font-size:15px;font-weight:500;color:#333;">'+p4Esc(a.title)+'</div>':'') +
                        '<div style="font-size:14px;color:#444;white-space:pre-wrap;">'+p4Esc(a.body)+'</div>' +
                        '<div style="font-size:11px;color:#aab;margin-top:6px;">'+p4Esc(a['from']||'')+' &bull; '+socFmt(a.at)+(a.mine?' &bull; &#10003; Read by '+(a.reads||0):'')+'</div>'+_amg+'</div>';
                });
                c.innerHTML=h;
                if(isMgr() && taTargets===null){ withPin(function(p2){ supabaseClient.rpc('app_task_targets',{p_username:currentUser.username,p_password:p2}).then(function(rr){ if(!rr.error){ taTargets=rr.data||{}; var sel=document.getElementById('anStore'); if(sel) sel.innerHTML=(taTargets.stores||[]).map(function(s){return '<option value="'+p4Esc(s)+'">'+p4Esc(s)+'</option>';}).join(''); } }); }); }
                else if(isMgr()){ var sel=document.getElementById('anStore'); if(sel&&taTargets) sel.innerHTML=(taTargets.stores||[]).map(function(s){return '<option value="'+p4Esc(s)+'">'+p4Esc(s)+'</option>';}).join(''); }
                // mark unread read (legacy badge counter)
                (items||[]).forEach(function(a){ if(!a.read){ withPin(function(p3){ supabaseClient.rpc('app_announce_read',{p_username:currentUser.username,p_password:p3,p_id:a.id}); }); } });
                // P4: fire-and-forget read receipts for every rendered announcement (idempotent)
                try{
                    withPin(function(p4){
                        (items||[]).slice(0,30).forEach(function(a){
                            try{ supabaseClient.rpc('app_announce_mark_read',{p_username:currentUser.username,p_password:p4,p_key:String(a.id)}).then(function(){},function(){}); }catch(e){}
                        });
                    });
                }catch(e){}
            });
        });
    }; })();
    function p4AnnWho(id){
        var box=document.getElementById('p4annwho-'+id); if(!box) return;
        if(box.style.display!=='none'){ box.style.display='none'; return; }
        box.style.display='block'; box.innerHTML='Checking&hellip;';
        p4Rpc('app_announce_read_status',{p_key:String(id)},function(d){
            d=d||{};
            if(d.ok===false){ box.innerHTML=p4Esc(d.reason||'Managers only.'); return; }
            var rd=(d.read||[]).map(p4Esc).join(', ')||'&mdash;', un=(d.unread||[]).map(p4Esc).join(', ')||'&mdash;';
            box.innerHTML='<b style="color:#1f7a3d;">Read ('+(d.read_count||0)+'):</b> '+rd+'<br><b style="color:#a01b3e;">Unread ('+(d.unread_count||0)+'):</b> '+un;
        },function(m){ box.innerHTML=p4Esc(m); });
    }

    /* ---------- 5. OT WATCH + OPEN PUNCHES (Timesheets, mgr) ---------- */
    openTimesheets=(function(orig){ return function(){ orig.apply(this,arguments); try{ p4TsInject(); }catch(e){} }; })(openTimesheets);
    function p4TsInject(){
        var sum=document.getElementById('timesheetSummary'); if(!sum) return;
        if(!document.getElementById('p4tsCards')){
            var d=document.createElement('div'); d.id='p4tsCards';
            sum.parentNode.insertBefore(d,sum);
        }
        document.getElementById('p4tsCards').innerHTML=
            p4CardO('&#9201; Overtime watch — over 38 hrs this week','Catch overtime before it happens. Open punches count as time-so-far.')+'<div id="p4tsOt" style="margin-top:4px;"><p style="color:#6b7686;font-size:13px;">Loading&hellip;</p></div></div>'+
            p4CardO('&#128564; Possible forgotten clock-outs','Punches still open 14+ hours after clock-in (last 30 days). Fix them in Punches.')+'<div id="p4tsOpen" style="margin-top:4px;"><p style="color:#6b7686;font-size:13px;">Loading&hellip;</p></div></div>'+
            '<div style="height:14px;"></div>';
        p4Rpc('app_ot_watch',{},function(d){
            var rows=d||[]; var el=document.getElementById('p4tsOt'); if(!el) return;
            el.innerHTML=rows.length?rows.map(function(r){ return '<div style="display:flex;justify-content:space-between;font-size:13.5px;padding:4px 0;border-bottom:1px solid var(--bd,#f0f0f0);"><span>'+p4Esc(r.name||'')+'</span><b style="color:'+(Number(r.hours)>=40?'#c0392b':'#854F0B')+';">'+Number(r.hours||0).toFixed(1)+' h</b></div>'; }).join(''):'<p style="color:#1f7a3d;font-size:13px;font-weight:700;">&#9989; No one is over 38 hours this week.</p>';
        },function(m){ var el=document.getElementById('p4tsOt'); if(el) el.innerHTML='<p style="color:#c0392b;font-size:12.5px;">'+p4Esc(m)+'</p>'; });
        p4Rpc('app_open_punches',{},function(d){
            var rows=d||[]; var el=document.getElementById('p4tsOpen'); if(!el) return;
            el.innerHTML=rows.length?rows.map(function(r){ return '<div style="display:flex;justify-content:space-between;font-size:13.5px;padding:4px 0;border-bottom:1px solid var(--bd,#f0f0f0);"><span>'+p4Esc(r.name||'')+' <span style="color:#6b7686;font-size:12px;">in '+p4Esc(String(r.clock_in||'').replace('T',' ').slice(0,16))+'</span></span><b style="color:#c0392b;">'+Number(r.hours_open||0).toFixed(0)+' h open</b></div>'; }).join(''):'<p style="color:#1f7a3d;font-size:13px;font-weight:700;">&#9989; No forgotten clock-outs found.</p>';
        },function(m){ var el=document.getElementById('p4tsOpen'); if(el) el.innerHTML='<p style="color:#c0392b;font-size:12.5px;">'+p4Esc(m)+'</p>'; });
    }

    /* ---------- 6. MY ATTENDANCE (staff, My Home) ---------- */
    function p4MyAttMount(){
        try{
            var home=document.getElementById('tab-content-home');
            if(!home||document.getElementById('p4myatt')) return;
            var d=document.createElement('div'); d.id='p4myatt';
            d.innerHTML='<button onclick="p4MyAttToggle()" id="p4myattBtn" style="width:100%;background:none;border:1px dashed var(--bd,#ccc);border-radius:12px;padding:10px;color:var(--txt2,#6b7686);font-weight:700;cursor:pointer;margin-top:10px;">&#128197; My attendance (90 days) &#9662;</button><div id="p4myattBody" style="display:none;background:var(--surface,#fff);border:1px solid var(--bd,#ececf2);border-radius:12px;padding:12px 14px;margin-top:8px;"></div>';
            home.appendChild(d);
        }catch(e){}
    }
    function p4MyAttToggle(){
        var b=document.getElementById('p4myattBody'); if(!b) return;
        if(b.style.display!=='none'){ b.style.display='none'; return; }
        b.style.display='block';
        if(!b._loaded){ p4MyAttLoad(); }
    }
    function p4MyAttLoad(){
        var b=document.getElementById('p4myattBody'); if(!b) return;
        b.innerHTML='<p style="color:#6b7686;font-size:13px;">Loading&hellip;</p>';
        p4Rpc('app_my_attendance',{},function(d){
            b._loaded=true;
            var rows=d||[]; var tn={callin:'Call-in',tardy:'Tardy',early:'Left early'};
            if(!rows.length){ b.innerHTML='<p style="color:#1f7a3d;font-size:13px;font-weight:700;margin:0;">&#127775; Clean record — nothing in the last 90 days!</p>'; return; }
            b.innerHTML=rows.map(function(e){ return '<div style="padding:7px 0;border-bottom:1px solid var(--bd,#eee);font-size:13px;"><b>'+p4Esc(tn[e.event_type]||e.event_type||'')+'</b> <span style="color:#6b7686;">'+p4Esc(e.event_date||'')+(e.location?' &middot; '+p4Esc(e.location):'')+'</span>'+((e.reason||e.comments)?'<div style="color:#6b7686;font-size:12px;">'+p4Esc(e.reason||'')+(e.comments?' — '+p4Esc(e.comments):'')+'</div>':'')+'</div>'; }).join('')+
                '<p style="font-size:11.5px;color:var(--txt2,#8a8594);margin:8px 0 0;">Think something here is wrong? Talk to your manager or use Your Voice.</p>';
        },function(m){ b.innerHTML='<p style="color:#c0392b;font-size:13px;">'+p4Esc(m)+'</p>'; });
    }

    /* ---------- 7. UNDER-15 CURFEW GUARDRAIL (publish gate) ---------- */
    var p4CurfewCutoff=null;
    function p4CurfewLoad(done){
        if(p4CurfewCutoff){ done(); return; }
        try{
            withPin(function(pin){
                supabaseClient.rpc('app_settings_get',{p_username:currentUser.username,p_password:pin,p_group:'curfew_under15'}).then(function(r){
                    try{
                        var rows=(r&&r.data)||[]; var v=null;
                        rows.forEach(function(x){ var raw=x&&(x.value||x.val); if(!raw) return; try{ var j=JSON.parse(raw); if(j&&j.cutoff) v=j.cutoff; }catch(e){ if(/^\d{1,2}:\d{2}$/.test(String(raw).trim())) v=String(raw).trim(); } });
                        p4CurfewCutoff=v||'21:00';
                    }catch(e){ p4CurfewCutoff='21:00'; }
                    done();
                }).then(null,function(){ p4CurfewCutoff='21:00'; done(); });
            },function(){ p4CurfewCutoff='21:00'; done(); });
        }catch(e){ p4CurfewCutoff='21:00'; done(); }
    }
    function p4CurfewWarn(s){
        try{
            if(!s||s.employee_id==null||!s.end_time) return null;
            var emp=((schedState&&schedState.data&&schedState.data.employees)||[]).find(function(x){ return x.id===s.employee_id; });
            if(!emp||!emp.birthday) return null; /* skip silently when birthday absent */
            var bd=new Date(emp.birthday+'T00:00:00'), sd=new Date((s.shift_date||'')+'T00:00:00');
            if(isNaN(bd)||isNaN(sd)) return null;
            var age=sd.getFullYear()-bd.getFullYear(); var m=sd.getMonth()-bd.getMonth();
            if(m<0||(m===0&&sd.getDate()<bd.getDate())) age--;
            if(age>=15||age<10) return null; /* <10 = almost certainly bad data */
            var cut=p4CurfewCutoff||'21:00';
            var end=String(s.end_time).slice(0,5), start=String(s.start_time||'00:00').slice(0,5);
            var late=(end>cut)||(end<start); /* past cutoff, or wraps past midnight */
            if(!late) return null;
            return 'Under-15 curfew: shift ends '+end+', after the '+cut+' cutoff for employees under 15';
        }catch(e){ return null; }
    }
    shiftWarnings=(function(orig){ return function(s){
        var w=[]; try{ w=orig.apply(this,arguments)||[]; }catch(e){ w=[]; }
        try{ var cw=p4CurfewWarn(s); if(cw) w.push(cw); }catch(e){}
        return w;
    }; })(shiftWarnings);
    schedPublish=(function(orig){ return function(){
        var args=arguments, self=this;
        try{ p4CurfewLoad(function(){ orig.apply(self,args); }); }
        catch(e){ orig.apply(self,args); }
    }; })(schedPublish);

    /* ============================================================
       CATERING PIPELINE — inquiries → quotes → bookings → run sheets
       ============================================================ */
    var CAT_PRICING = { CART_THRESHOLD:500, CART_BASE_FEE:200.00, CART_INCLUDED_HOURS:1, TRAILER_BASE_FEE:500.00, TRAILER_INCLUDED_HOURS:2, TRAILER_FOOTPRINT_NOTE:'requires a 28-foot footprint for parking, spacing, and setup clearance', ADDITIONAL_HOUR_RATE:50.00, SCOOP_PRICE:{single:2.00,double:3.00}, INCLUDED_TOPPINGS:4, EXTRA_TOPPING_RATE:25.00, TRAVEL_FEE:75.00 };
    function catQuoteCalc(inp){ var P=CAT_PRICING; var r2=function(x){return Math.round(x*100)/100;}; var scoopType=String(inp.scoopType==null?'':inp.scoopType).toLowerCase(); if(!Object.prototype.hasOwnProperty.call(P.SCOOP_PRICE,scoopType)){ throw new Error("scoopType must be 'single' or 'double'"); } var headcount=inp.headcount; var hours=inp.hours; var toppingsRequested=(inp.toppingsRequested===undefined)?null:inp.toppingsRequested; var travelFee=!!inp.travelFee; if(!(headcount>0)) throw new Error('headcount must be positive'); if(!(hours>0)) throw new Error('hours must be positive'); if(toppingsRequested!==null&&toppingsRequested<0) throw new Error('toppings cannot be negative'); var equipment,baseFee,includedHours,footprintNote; if(headcount<P.CART_THRESHOLD){ equipment='Sundae Cart'; baseFee=P.CART_BASE_FEE; includedHours=P.CART_INCLUDED_HOURS; footprintNote=null; } else { equipment='Treat Trailer'; baseFee=P.TRAILER_BASE_FEE; includedHours=P.TRAILER_INCLUDED_HOURS; footprintNote=P.TRAILER_FOOTPRINT_NOTE; } var billableHours=Math.ceil(hours); var extraHours=Math.max(0,billableHours-includedHours); var extraHoursCost=extraHours*P.ADDITIONAL_HOUR_RATE; var scoopPrice=P.SCOOP_PRICE[scoopType]; var servingCost=headcount*scoopPrice; var extraToppings=0; var extraToppingsCost=0.0; if(toppingsRequested!==null&&toppingsRequested>P.INCLUDED_TOPPINGS){ extraToppings=toppingsRequested-P.INCLUDED_TOPPINGS; extraToppingsCost=extraToppings*P.EXTRA_TOPPING_RATE; } var travelFeeCost=travelFee?P.TRAVEL_FEE:0.0; var subtotal=baseFee+extraHoursCost+servingCost+extraToppingsCost+travelFeeCost; var lineItems=[{label:equipment+' base setup ('+includedHours+' hr'+(includedHours>1?'s':'')+' included)',amount:r2(baseFee)}]; if(extraHours>0){ lineItems.push({label:'Additional hours ('+extraHours+' hr @ $'+P.ADDITIONAL_HOUR_RATE.toFixed(2)+'/hr)',amount:r2(extraHoursCost)}); } lineItems.push({label:'Custard servings ('+headcount+' '+scoopType+' scoops @ $'+scoopPrice.toFixed(2)+'/ea)',amount:r2(servingCost)}); if(extraToppings>0){ lineItems.push({label:'Extra toppings ('+extraToppings+' over the '+P.INCLUDED_TOPPINGS+' included @ $'+P.EXTRA_TOPPING_RATE.toFixed(2)+'/ea)',amount:r2(extraToppingsCost)}); } if(travelFeeCost>0){ lineItems.push({label:'Travel fee (outside immediate Las Cruces)',amount:r2(travelFeeCost)}); } return { equipment:equipment, footprintNote:footprintNote, lineItems:lineItems, subtotal:r2(subtotal), travelFee:r2(travelFeeCost), total:r2(subtotal), includedHours:includedHours, billableHours:billableHours, extraHours:extraHours }; }

    var catList=[],catCur=null,catFilter='active';
    var CAT_STAGES=['inquiry','quoted','approved','booked','completed','paid'];
    var CAT_NEXT={inquiry:['quoted','lost'],quoted:['approved','lost'],approved:['booked','lost'],booked:['completed','lost'],completed:['paid'],lost:['inquiry']};
    var CAT_COLORS={inquiry:'#f59e0b',quoted:'#3b82f6',approved:'#8b5cf6',booked:'#10b981',completed:'#6b7280',paid:'#065f46',lost:'#9ca3af'};
    var CAT_LABELS={inquiry:'Inquiry',quoted:'Quoted',approved:'Approved',booked:'Booked',completed:'Completed',paid:'Paid',lost:'Lost'};
    var CAT_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function catMoney(x){ return '$'+Number(x==null?0:x).toFixed(2); }
    function catDateFmt(d){ if(!d) return 'No date'; var p=String(d).slice(0,10).split('-'); if(p.length<3) return String(d); var mi=parseInt(p[1],10)-1; if(isNaN(mi)||mi<0||mi>11) return String(d); return CAT_MONTHS[mi]+' '+parseInt(p[2],10); }
    function catTimeFmt(t){ if(!t) return ''; var p=String(t).slice(0,5).split(':'); var h=parseInt(p[0],10); if(isNaN(h)) return String(t); var m=p[1]||'00'; var ap=h>=12?'PM':'AM'; h=h%12; if(h===0) h=12; return h+':'+m+' '+ap; }
    function catEquipShort(eq){ if(!eq) return ''; if(String(eq).indexOf('Trailer')>=0) return 'Trailer'; if(String(eq).indexOf('Cart')>=0) return 'Cart'; return String(eq); }
    function catPill(st){ return '<span style="display:inline-block;background:'+(CAT_COLORS[st]||'#9ca3af')+';color:#fff;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;">'+escapeHtml(CAT_LABELS[st]||st||'')+'</span>'; }
    function catRpc(name,args,cb,errCb){
        withPin(function(pin){
            supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args)).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; if(errCb){ errCb(r.error); } else { alert(r.error.message||'Something went wrong.'); } return; }
                cb(r.data);
            }).catch(function(){ if(errCb){ errCb({message:'Connection error. Please try again.'}); } else { alert('Connection error. Please try again.'); } });
        });
    }
    function openCatering(){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        document.getElementById('cateringView').style.display='block';
        window.scrollTo(0,0);
        catLoad();
    }
    function catSetFilter(f){ catFilter=f; catLoad(); }
    function catLoad(){
        var box=document.getElementById('catBody'); if(!box) return;
        box.innerHTML='<p style="text-align:center;padding:30px;color:#6b7686;">Loading catering pipeline&hellip;</p>';
        catRpc('app_catering_list',{p_filter:catFilter},function(d){ catList=d||[]; catRenderBoard(); },
            function(err){ box.innerHTML='<p style="text-align:center;padding:30px;color:#c0264b;">'+escapeHtml(err.message||'Could not load.')+'</p>'; });
    }
    function catChipsHtml(){
        var counts={}; for(var i=0;i<catList.length;i++){ var s=catList[i].status; counts[s]=(counts[s]||0)+1; }
        function chip(val,label,count){ var on=(catFilter===val); return '<button onclick="catSetFilter(\''+val+'\')" style="border:none;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;'+(on?'background:#26242b;color:#fff;':'background:#eef0f3;color:#3a4353;')+'">'+label+(count?' ('+count+')':'')+'</button>'; }
        var html='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">';
        html+=chip('active','All active',(catFilter==='active'||catFilter==='all')?catList.length:0);
        html+=chip('all','All',0);
        var order=CAT_STAGES.concat(['lost']);
        for(var j=0;j<order.length;j++){ html+=chip(order[j],CAT_LABELS[order[j]],counts[order[j]]||0); }
        html+='</div>'; return html;
    }
    function catCardHtml(r){
        var right='<div style="font-weight:800;color:#26242b;">'+escapeHtml(catDateFmt(r.event_date))+(r.start_time?(' &middot; '+escapeHtml(catTimeFmt(r.start_time))):'')+'</div>';
        var bits=[];
        if(r.guest_count!=null&&r.guest_count!=='') bits.push(escapeHtml(String(r.guest_count))+' guests');
        var eq=catEquipShort(r.equipment); if(eq) bits.push(escapeHtml(eq));
        if(r.quote_subtotal!=null&&r.quote_subtotal!=='') bits.push(catMoney(r.quote_subtotal));
        if(bits.length) right+='<div style="color:#6b7686;margin-top:2px;">'+bits.join(' &middot; ')+'</div>';
        if(r.conflict) right+='<div style="color:#c0264b;font-weight:800;margin-top:2px;">&#9888; date clash</div>';
        var srcChip=(String(r.source||'').toLowerCase()==='website')?' <span style="background:#c0264b;color:#fff;border-radius:6px;font-size:9.5px;font-weight:800;padding:2px 6px;vertical-align:middle;">WEBSITE</span>':'';
        var sub=[]; if(r.occasion) sub.push(r.occasion); if(r.location) sub.push(r.location);
        return '<div onclick="catOpenDetail(\''+r.id+'\')" style="display:flex;justify-content:space-between;gap:10px;background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.04);">'
            +'<div style="flex:1;min-width:0;"><div style="font-weight:800;color:#26242b;">'+escapeHtml(r.customer_name||'(no name)')+srcChip+'</div>'
            +(sub.length?('<div style="font-size:12px;color:#6b7686;margin-top:2px;">'+escapeHtml(sub.join(' — '))+'</div>'):'')
            +'</div><div style="text-align:right;font-size:12px;flex-shrink:0;">'+right+'</div></div>';
    }
    function catRenderBoard(){
        var box=document.getElementById('catBody'); if(!box) return;
        var html=catChipsHtml();
        html+='<button onclick="catNewForm()" style="width:100%;background:var(--caliches-pink,#c0264b);color:#fff;border:none;border-radius:11px;padding:12px;font-size:14px;font-weight:800;cursor:pointer;margin-bottom:14px;">+ New event (phone/walk-in)</button>';
        if(!catList.length){ html+='<p style="text-align:center;color:#8a8594;padding:26px 10px;font-size:13.5px;">Nothing here yet. Website inquiries land in this pipeline automatically, or add a phone/walk-in event above.</p>'; box.innerHTML=html; return; }
        var order=CAT_STAGES.concat(['lost']);
        for(var s=0;s<order.length;s++){
            var st=order[s], rows=[];
            for(var i=0;i<catList.length;i++){ if(catList[i].status===st) rows.push(catList[i]); }
            if(!rows.length) continue;
            html+='<div style="display:flex;align-items:center;gap:8px;margin:16px 0 8px;">'+catPill(st)+'<span style="font-size:12px;color:#8a8594;font-weight:700;">'+rows.length+'</span></div>';
            for(var k=0;k<rows.length;k++){ html+=catCardHtml(rows[k]); }
        }
        box.innerHTML=html;
    }
    function catOpenDetail(id){
        var box=document.getElementById('catBody');
        if(box) box.innerHTML='<p style="text-align:center;padding:30px;color:#6b7686;">Loading event&hellip;</p>';
        catRpc('app_catering_get',{p_id:id},function(d){ catCur=d; catRenderDetail(); },
            function(err){ if(box) box.innerHTML='<p style="text-align:center;padding:30px;color:#c0264b;">'+escapeHtml(err.message||'Could not load this event.')+'</p><p style="text-align:center;"><button onclick="catLoad()" style="background:#eef0f3;border:none;border-radius:9px;padding:9px 16px;font-weight:700;cursor:pointer;">&larr; Back to pipeline</button></p>'; });
    }
    function catSec(title,inner){ return '<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:14px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,.04);"><div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#8a8594;text-transform:uppercase;margin-bottom:8px;">'+title+'</div>'+inner+'</div>'; }
    function catKV(k,v){ return '<div style="display:flex;gap:10px;font-size:13.5px;padding:3px 0;"><div style="min-width:110px;color:#6b7686;">'+k+'</div><div style="flex:1;font-weight:600;color:#26242b;">'+v+'</div></div>'; }
    function catProgressHtml(st){
        if(st==='lost') return '<div style="margin:6px 0 2px;">'+catPill('lost')+'</div>';
        var idx=CAT_STAGES.indexOf(st), html='<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:6px 0 2px;">';
        for(var i=0;i<CAT_STAGES.length;i++){
            var style=(i===idx)?('background:'+CAT_COLORS[CAT_STAGES[i]]+';color:#fff;'):((i<idx)?'background:#e6e9ef;color:#3a4353;':'background:#f3f4f7;color:#a7adba;');
            html+='<span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;'+style+'">'+escapeHtml(CAT_LABELS[CAT_STAGES[i]])+'</span>';
            if(i<CAT_STAGES.length-1) html+='<span style="color:#c3c8d4;font-size:10px;">&rsaquo;</span>';
        }
        return html+'</div>';
    }
    function catQuoteLinesTable(items,subtotal){
        var html='<table style="width:100%;border-collapse:collapse;font-size:13px;">';
        for(var i=0;i<items.length;i++){ html+='<tr><td style="padding:3px 0;color:#3a4353;">'+escapeHtml(items[i].label)+'</td><td style="padding:3px 0;text-align:right;font-weight:600;white-space:nowrap;">'+catMoney(items[i].amount)+'</td></tr>'; }
        html+='<tr><td style="padding:6px 0 0;border-top:1px solid #eef0f5;font-weight:800;">Subtotal (before tax)</td><td style="padding:6px 0 0;border-top:1px solid #eef0f5;text-align:right;font-weight:800;white-space:nowrap;">'+catMoney(subtotal)+'</td></tr></table>';
        return html;
    }
    function catQuoteSectionHtml(d){
        var html='';
        if(d.quote&&d.quote.lineItems&&d.quote.lineItems.length){
            html+='<div style="font-size:12px;font-weight:800;color:#10b981;margin-bottom:4px;">Saved quote</div>'+catQuoteLinesTable(d.quote.lineItems,(d.quote_subtotal!=null?d.quote_subtotal:d.quote.subtotal))+'<div style="height:12px;"></div>';
        }
        function num(id,label,val,step){ return '<label style="flex:1;min-width:110px;font-size:11.5px;font-weight:700;color:#3a4353;">'+label+'<input id="'+id+'" type="number"'+(step?(' step="'+step+'"'):'')+' min="0" value="'+escapeHtml(val==null?'':String(val))+'" oninput="catQuoteRecalc()" style="width:100%;box-sizing:border-box;margin-top:3px;padding:8px;border:1px solid #dfe3ea;border-radius:8px;font-size:13.5px;"></label>'; }
        var sc=(String(d.scoop_type||'single').toLowerCase()==='double')?'double':'single';
        html+='<div style="font-size:12px;font-weight:800;color:#3a4353;margin-bottom:6px;">'+(d.quote?'Re-price / update quote':'Build a quote')+'</div>';
        html+='<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">'
            +num('catQGuests','Guests',d.guest_count)
            +num('catQHours','Hours',d.hours,'0.5')
            +'<label style="flex:1;min-width:110px;font-size:11.5px;font-weight:700;color:#3a4353;">Scoops<select id="catQScoop" onchange="catQuoteRecalc()" style="width:100%;box-sizing:border-box;margin-top:3px;padding:8px;border:1px solid #dfe3ea;border-radius:8px;font-size:13.5px;background:#fff;"><option value="single"'+(sc==='single'?' selected':'')+'>Single ($2.00)</option><option value="double"'+(sc==='double'?' selected':'')+'>Double ($3.00)</option></select></label>'
            +num('catQTops','Toppings (blank = unset)',d.toppings_requested)
            +'</div>'
            +'<label style="display:block;font-size:12.5px;font-weight:700;color:#3a4353;margin-bottom:8px;"><input type="checkbox" id="catQTravel"'+(d.travel?' checked':'')+' onchange="catQuoteRecalc()"> Travel fee (outside immediate Las Cruces, +$75.00)</label>'
            +'<div id="catQuoteOut" style="margin-bottom:10px;"></div>'
            +'<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;">'
            +'<label style="flex:1;min-width:130px;font-size:11.5px;font-weight:700;color:#3a4353;">Deposit (optional)<input id="catQDeposit" type="number" step="0.01" min="0" value="'+escapeHtml(d.deposit_amount==null?'':String(d.deposit_amount))+'" style="width:100%;box-sizing:border-box;margin-top:3px;padding:8px;border:1px solid #dfe3ea;border-radius:8px;font-size:13.5px;"></label>'
            +'<button onclick="catQuoteSaveGo()" style="background:#3b82f6;color:#fff;border:none;border-radius:9px;padding:10px 16px;font-size:13px;font-weight:800;cursor:pointer;">Save quote to event</button>'
            +'</div>';
        return html;
    }
    function catQuoteRecalc(){
        var out=document.getElementById('catQuoteOut'); if(!out) return;
        var g=parseFloat((document.getElementById('catQGuests')||{}).value);
        var h=parseFloat((document.getElementById('catQHours')||{}).value);
        var sc=(document.getElementById('catQScoop')||{}).value||'single';
        var tRaw=String((document.getElementById('catQTops')||{}).value||'').trim();
        var tv=!!((document.getElementById('catQTravel')||{}).checked);
        var tops=(tRaw==='')?null:parseInt(tRaw,10);
        try{
            var q=catQuoteCalc({headcount:g,hours:h,scoopType:sc,toppingsRequested:tops,travelFee:tv});
            q.inputs={headcount:g,hours:h,scoopType:sc,toppingsRequested:tops,travelFee:tv};
            window._catQuoteDraft=q;
            out.innerHTML='<div style="font-size:13px;font-weight:700;color:#26242b;margin-bottom:4px;">'+escapeHtml(q.equipment)+(q.footprintNote?(' <span style="font-weight:400;color:#8a8594;">('+escapeHtml(q.footprintNote)+')</span>'):'')+'</div>'+catQuoteLinesTable(q.lineItems,q.subtotal);
        }catch(e){
            window._catQuoteDraft=null;
            out.innerHTML='<p style="font-size:12.5px;color:#8a8594;margin:0;">'+escapeHtml(e&&e.message?e.message:'Enter guests and hours to price this event.')+'</p>';
        }
    }
    function catQuoteSaveGo(){
        if(!catCur) return;
        catQuoteRecalc();
        var q=window._catQuoteDraft;
        if(!q){ alert('Fix the quote inputs first — guests and hours are required.'); return; }
        var depRaw=String((document.getElementById('catQDeposit')||{}).value||'').trim();
        var dep=(depRaw==='')?null:parseFloat(depRaw);
        if(dep!==null&&(isNaN(dep)||dep<0)){ alert('Deposit must be a number, or leave it blank.'); return; }
        var id=catCur.id;
        catRpc('app_catering_quote_save',{p_id:id,p_quote:q,p_subtotal:q.subtotal,p_travel_fee:q.travelFee,p_deposit:dep},function(){ catOpenDetail(id); });
    }
    function catActionsHtml(st){
        var next=CAT_NEXT[st]||[];
        if(!next.length) return '<p style="font-size:12.5px;color:#8a8594;margin:0;">This event is fully closed out.</p>';
        var lbl={quoted:'Mark Quoted',approved:'Mark Approved (customer accepted)',booked:'Mark Booked (deposit)',completed:'Mark Completed (event done)',paid:'Mark Paid (final balance)',lost:'Mark Lost',inquiry:'Reopen as Inquiry'};
        var html='<div style="display:flex;flex-wrap:wrap;gap:8px;">';
        for(var i=0;i<next.length;i++){
            var to=next[i], color=(to==='lost')?'#8a8594':(CAT_COLORS[to]||'#26242b');
            html+='<button onclick="catAdvance(\''+to+'\')" style="background:'+color+';color:#fff;border:none;border-radius:9px;padding:10px 14px;font-size:13px;font-weight:800;cursor:pointer;">'+(lbl[to]||to)+'</button>';
        }
        return html+'</div>';
    }
    function catAdvance(to){
        if(!catCur) return;
        var extra=null, note=null;
        if(to==='approved'){
            var nm=prompt('Who accepted? (typed name)'); if(nm===null) return; nm=nm.trim();
            if(!nm){ alert('A typed name is required to mark approved.'); return; }
            extra={signed_name:nm};
        } else if(to==='booked'){
            var amt=prompt('Deposit amount (numbers only):'); if(amt===null) return;
            var amtN=parseFloat(amt); if(isNaN(amtN)||amtN<0){ alert('Enter a valid deposit amount (0 is okay).'); return; }
            var meth=prompt('Deposit method (e.g. card/cash/check):'); if(meth===null) return;
            var ref=prompt('Payment reference (optional):'); if(ref===null) ref='';
            extra={deposit_amount:amtN,deposit_method:String(meth||'').trim(),deposit_ref:String(ref||'').trim()};
        } else if(to==='paid'){
            if(!confirm('Mark final balance received?')) return;
        } else if(to==='lost'){
            var rsn=prompt('Why was this lost? (reason)'); if(rsn===null) return; rsn=rsn.trim();
            if(!rsn){ alert('A reason is required to mark lost.'); return; }
            extra={lost_reason:rsn}; note=rsn;
        } else if(to==='inquiry'){
            if(!confirm('Reopen this as a new inquiry?')) return;
        }
        var id=catCur.id;
        catRpc('app_catering_advance',{p_id:id,p_to:to,p_note:note,p_extra:extra},function(d){
            if(d&&d.warning) alert(d.warning);
            catOpenDetail(id);
        });
    }
    function catAddNote(){
        if(!catCur) return;
        var n=prompt('Add a note to this event:'); if(n===null) return; n=n.trim(); if(!n) return;
        var id=catCur.id;
        catRpc('app_catering_note',{p_id:id,p_note:n},function(){ catOpenDetail(id); });
    }
    function catHistoryHtml(){
        var h=(catCur&&catCur.status_history)||[];
        if(!h.length) return '<p style="font-size:12.5px;color:#8a8594;margin:6px 0 0;">No history yet.</p>';
        var html='';
        for(var i=h.length-1;i>=0;i--){
            var e=h[i]||{}; var when=e.at?String(e.at).replace('T',' ').slice(0,16):'';
            if(e.type==='note'){
                html+='<div style="padding:7px 0;border-bottom:1px solid #f3f4f7;font-size:13px;">&#128172; <b>'+escapeHtml(e.by||'')+'</b> <span style="color:#8a8594;font-size:11.5px;">'+escapeHtml(when)+'</span><br>'+escapeHtml(e.note||'')+'</div>';
            } else {
                html+='<div style="padding:7px 0;border-bottom:1px solid #f3f4f7;font-size:13px;">'+escapeHtml(e.from||'—')+' &rarr; <b>'+escapeHtml(e.to||'')+'</b> <span style="color:#8a8594;font-size:11.5px;">by '+escapeHtml(e.by||'')+' '+escapeHtml(when)+'</span>'+(e.note?('<br><span style="color:#3a4353;">'+escapeHtml(e.note)+'</span>'):'')+'</div>';
            }
        }
        return html;
    }
    function catRenderDetail(){
        var box=document.getElementById('catBody'); if(!box||!catCur) return;
        var d=catCur;
        var html='<button onclick="catLoad()" style="background:none;border:none;color:#0d6eaf;font-size:13px;font-weight:700;cursor:pointer;padding:0;margin-bottom:10px;">&larr; Back to pipeline</button>';
        html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:12px;">';
        html+='<div style="min-width:0;"><div style="font-size:20px;font-weight:800;color:#26242b;">'+escapeHtml(d.customer_name||'(no name)')+'</div>'+catProgressHtml(d.status)+'</div>';
        html+='<div style="display:flex;gap:6px;flex-shrink:0;">'
            +'<button onclick="catEditForm()" style="background:#eef0f3;border:none;border-radius:9px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;">&#9998; Edit</button>'
            +'<button onclick="catBEO()" style="background:#eef0f3;border:none;border-radius:9px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;">&#128424; Print BEO</button>'
            +'</div></div>';
        var sd=[], all=d.same_day||[];
        for(var i=0;i<all.length;i++){ var s=all[i]; if(s&&s.id!==d.id&&s.status!=='lost') sd.push(s); }
        if(sd.length){
            var names=[];
            for(var j=0;j<sd.length;j++){ names.push(escapeHtml(sd[j].customer_name||'?')+' ('+escapeHtml(catEquipShort(sd[j].equipment)||'?')+(sd[j].start_time?(' at '+escapeHtml(catTimeFmt(sd[j].start_time))):'')+', '+escapeHtml(sd[j].status||'')+')'); }
            html+='<div style="background:#fff3f3;border:1px solid #f0caca;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12.5px;color:#7a2222;"><b>&#9888; Same-day events:</b> '+names.join(' &middot; ')+' &mdash; check equipment overlap.</div>';
        }
        if(d.status==='lost'&&d.lost_reason){ html+='<div style="background:#f3f4f7;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12.5px;color:#3a4353;"><b>Lost:</b> '+escapeHtml(d.lost_reason)+'</div>'; }
        var cust='';
        cust+=catKV('Name',escapeHtml(d.customer_name||'—'));
        cust+=catKV('Phone',d.customer_phone?('<a href="tel:'+escapeHtml(d.customer_phone)+'" style="color:#0d6eaf;">'+escapeHtml(d.customer_phone)+'</a>'):'—');
        cust+=catKV('Email',d.customer_email?('<a href="mailto:'+escapeHtml(d.customer_email)+'" style="color:#0d6eaf;">'+escapeHtml(d.customer_email)+'</a>'):'—');
        cust+=catKV('Prefers',escapeHtml(d.contact_pref||'—'));
        html+=catSec('Customer',cust);
        var ev='';
        ev+=catKV('Date',escapeHtml(catDateFmt(d.event_date))+(d.start_time?(' &middot; '+escapeHtml(catTimeFmt(d.start_time))):''));
        ev+=catKV('Hours',(d.hours!=null&&d.hours!=='')?(escapeHtml(String(d.hours))+' hr'):'—');
        ev+=catKV('Location',escapeHtml(d.location||'—'));
        ev+=catKV('Guests',(d.guest_count!=null&&d.guest_count!=='')?escapeHtml(String(d.guest_count)):'—');
        ev+=catKV('Occasion',escapeHtml(d.occasion||'—'));
        var eqTxt=escapeHtml(d.equipment||'—');
        if(String(d.equipment||'').indexOf('Trailer')>=0) eqTxt+=' <span style="font-weight:400;color:#8a8594;">('+escapeHtml(CAT_PRICING.TRAILER_FOOTPRINT_NOTE)+')</span>';
        ev+=catKV('Equipment',eqTxt);
        ev+=catKV('Travel fee',d.travel?'Yes (outside immediate Las Cruces)':'No');
        ev+=catKV('Notes',d.notes?escapeHtml(d.notes):'—');
        html+=catSec('Event',ev);
        html+=catSec('Quote',catQuoteSectionHtml(d));
        var mo='';
        mo+=catKV('Deposit',((d.deposit_amount!=null)?catMoney(d.deposit_amount):'—')+(d.deposit_method?(' &middot; '+escapeHtml(d.deposit_method)):'')+(d.deposit_ref?(' &middot; ref '+escapeHtml(d.deposit_ref)):'')+' &middot; '+(d.deposit_paid?'<span style="color:#10b981;font-weight:800;">received</span>':'<span style="color:#8a8594;">not received</span>'));
        mo+=catKV('Final balance',d.balance_paid?'<span style="color:#10b981;font-weight:800;">paid</span>':'<span style="color:#8a8594;">not paid</span>');
        mo+=catKV('Accepted by',d.signed_name?(escapeHtml(d.signed_name)+(d.signed_at?(' <span style="color:#8a8594;font-weight:400;">'+escapeHtml(String(d.signed_at).replace('T',' ').slice(0,16))+'</span>'):'')):'—');
        if(d.assigned_manager) mo+=catKV('Manager',escapeHtml(d.assigned_manager));
        html+=catSec('Money',mo);
        html+=catSec('Actions',catActionsHtml(d.status));
        html+=catSec('Notes &amp; history','<button onclick="catAddNote()" style="background:#eef0f3;border:none;border-radius:9px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;margin-bottom:6px;">&#128172; Add note</button>'+catHistoryHtml());
        box.innerHTML=html;
        catQuoteRecalc();
        window.scrollTo(0,0);
    }
    function catNewForm(){ catRenderForm(null); }
    function catEditForm(){ if(catCur) catRenderForm(catCur); }
    function catRenderForm(d){
        var box=document.getElementById('catBody'); if(!box) return;
        var isEdit=!!(d&&d.id);
        function fi(id,label,type,val,extra){ return '<div style="margin-bottom:10px;"><label style="display:block;font-size:12px;font-weight:700;color:#3a4353;margin-bottom:4px;">'+label+'</label><input id="'+id+'" type="'+type+'" value="'+escapeHtml(val==null?'':String(val))+'"'+(extra||'')+' style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #dfe3ea;border-radius:9px;font-size:14px;background:#fff;"></div>'; }
        var html='<button onclick="'+(isEdit?'catRenderDetail()':'catLoad()')+'" style="background:none;border:none;color:#0d6eaf;font-size:13px;font-weight:700;cursor:pointer;padding:0;margin-bottom:10px;">&larr; Cancel</button>';
        html+='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:16px;box-shadow:0 2px 6px rgba(0,0,0,.04);">';
        html+='<h3 style="margin:0 0 12px;font-size:16px;color:#26242b;">'+(isEdit?'Edit event':'New event (phone / walk-in)')+'</h3>';
        html+=fi('catFName','Customer name *','text',d?d.customer_name:'');
        html+=fi('catFPhone','Phone','tel',d?d.customer_phone:'');
        html+=fi('catFEmail','Email','email',d?d.customer_email:'');
        html+=fi('catFDate','Event date','date',(d&&d.event_date)?String(d.event_date).slice(0,10):'');
        html+=fi('catFTime','Start time','time',(d&&d.start_time)?String(d.start_time).slice(0,5):'');
        html+=fi('catFHours','Hours','number',d?d.hours:'',' step="0.5" min="0"');
        html+=fi('catFLoc','Event location / address','text',d?d.location:'');
        html+=fi('catFGuests','Estimated guests','number',d?d.guest_count:'',' min="1"');
        html+=fi('catFOcc','Occasion','text',d?d.occasion:'');
        var sc=(d&&String(d.scoop_type||'').toLowerCase()==='double')?'double':'single';
        html+='<div style="margin-bottom:10px;"><label style="display:block;font-size:12px;font-weight:700;color:#3a4353;margin-bottom:4px;">Scoops</label><select id="catFScoop" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #dfe3ea;border-radius:9px;font-size:14px;background:#fff;"><option value="single"'+(sc==='single'?' selected':'')+'>Single scoop ($2.00/guest)</option><option value="double"'+(sc==='double'?' selected':'')+'>Double scoop ($3.00/guest)</option></select></div>';
        html+='<div style="margin-bottom:10px;"><label style="display:block;font-size:12px;font-weight:700;color:#3a4353;margin-bottom:4px;">Notes</label><textarea id="catFNotes" rows="3" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #dfe3ea;border-radius:9px;font-size:14px;background:#fff;">'+escapeHtml((d&&d.notes)||'')+'</textarea></div>';
        if(isEdit) html+=fi('catFMgr','Assigned manager','text',d.assigned_manager||'');
        html+='<button onclick="catFormSave('+(isEdit?('\''+d.id+'\''):'null')+')" style="width:100%;background:var(--caliches-pink,#c0264b);color:#fff;border:none;border-radius:11px;padding:12px;font-size:14px;font-weight:800;cursor:pointer;">'+(isEdit?'Save changes':'Create event')+'</button>';
        html+='</div>';
        box.innerHTML=html;
        window.scrollTo(0,0);
    }
    function catFormSave(id){
        var nm=String((document.getElementById('catFName')||{}).value||'').trim();
        if(!nm){ alert('Customer name is required.'); return; }
        function v(fid){ var el=document.getElementById(fid); return el?String(el.value||'').trim():''; }
        var p={ customer_name:nm, customer_phone:v('catFPhone'), customer_email:v('catFEmail'), location:v('catFLoc'), occasion:v('catFOcc'), scoop_type:v('catFScoop')||'single', notes:v('catFNotes') };
        var dv=v('catFDate'); if(dv) p.event_date=dv;
        var tv=v('catFTime'); if(tv) p.start_time=tv;
        var hv=v('catFHours'); if(hv) p.hours=hv;
        var gv=v('catFGuests'); if(gv) p.guest_count=gv;
        if(document.getElementById('catFMgr')) p.assigned_manager=v('catFMgr');
        catRpc('app_catering_save',{p_id:id||null,p:p},function(newId){ catOpenDetail(newId||id); });
    }
    function catBEO(){
        if(!catCur) return;
        var d=catCur;
        var w=window.open('','_blank');
        if(!w){ alert('Pop-up blocked. Allow pop-ups to print the run sheet.'); return; }
        var q=(d.quote&&d.quote.lineItems&&d.quote.lineItems.length)?d.quote:null;
        var eqNote=(String(d.equipment||'').indexOf('Trailer')>=0)?(' <span style="color:#555;font-weight:normal;">('+escapeHtml(CAT_PRICING.TRAILER_FOOTPRINT_NOTE)+')</span>'):'';
        var html='<!DOCTYPE html><html><head><title>Catering Run Sheet</title><style>'
            +'body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:28px;}'
            +'h1{font-size:20px;margin:0 0 2px;} .sub{font-size:12px;color:#666;margin-bottom:4px;}'
            +'h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#888;margin:18px 0 6px;border-bottom:1px solid #ddd;padding-bottom:3px;}'
            +'table{width:100%;border-collapse:collapse;font-size:13px;} td{padding:3px 0;vertical-align:top;}'
            +'.kv td:first-child{color:#666;width:170px;} .r{text-align:right;white-space:nowrap;} .tot td{border-top:1px solid #999;font-weight:bold;padding-top:6px;}'
            +'</style></head><body>';
        html+='<h1>Caliche&#39;s Frozen Custard &mdash; Catering Run Sheet</h1>';
        html+='<div class="sub">Status: '+escapeHtml(CAT_LABELS[d.status]||d.status||'')+' &middot; Printed '+escapeHtml(new Date().toLocaleDateString())+'</div>';
        html+='<h2>Event</h2><table class="kv">'
            +'<tr><td>Customer</td><td>'+escapeHtml(d.customer_name||'—')+'</td></tr>'
            +'<tr><td>Phone / Email</td><td>'+escapeHtml(d.customer_phone||'—')+' &middot; '+escapeHtml(d.customer_email||'—')+'</td></tr>'
            +'<tr><td>Date &amp; time</td><td>'+escapeHtml(catDateFmt(d.event_date))+(d.start_time?(' &middot; '+escapeHtml(catTimeFmt(d.start_time))):'')+((d.hours!=null&&d.hours!=='')?(' &middot; '+escapeHtml(String(d.hours))+' hr'):'')+'</td></tr>'
            +'<tr><td>Location</td><td>'+escapeHtml(d.location||'—')+'</td></tr>'
            +'<tr><td>Occasion</td><td>'+escapeHtml(d.occasion||'—')+'</td></tr>'
            +'<tr><td>Equipment</td><td><b>'+escapeHtml(d.equipment||'—')+'</b>'+eqNote+'</td></tr>'
            +'<tr><td>Servings</td><td>'+escapeHtml((d.guest_count!=null&&d.guest_count!=='')?String(d.guest_count):'?')+' guests &times; '+escapeHtml(d.scoop_type||'single')+' scoops</td></tr>'
            +'<tr><td>Toppings requested</td><td>'+escapeHtml(d.toppings_requested==null?('Unspecified ('+CAT_PRICING.INCLUDED_TOPPINGS+' included)'):String(d.toppings_requested))+'</td></tr>'
            +'<tr><td>Assigned manager</td><td>'+escapeHtml(d.assigned_manager||'—')+'</td></tr>'
            +'</table>';
        if(q){
            html+='<h2>Quote (as saved)</h2><table>';
            for(var i=0;i<q.lineItems.length;i++){ html+='<tr><td>'+escapeHtml(q.lineItems[i].label)+'</td><td class="r">'+catMoney(q.lineItems[i].amount)+'</td></tr>'; }
            html+='<tr class="tot"><td>Subtotal (before tax)</td><td class="r">'+catMoney(d.quote_subtotal!=null?d.quote_subtotal:q.subtotal)+'</td></tr></table>';
        } else {
            html+='<h2>Quote</h2><p style="font-size:13px;color:#666;">No quote saved yet.</p>';
        }
        html+='<h2>Money</h2><table class="kv">'
            +'<tr><td>Deposit</td><td>'+((d.deposit_amount!=null)?catMoney(d.deposit_amount):'—')+(d.deposit_method?(' &middot; '+escapeHtml(d.deposit_method)):'')+(d.deposit_ref?(' &middot; ref '+escapeHtml(d.deposit_ref)):'')+' &middot; '+(d.deposit_paid?'<b>RECEIVED</b>':'not received')+'</td></tr>'
            +'<tr><td>Final balance</td><td>'+(d.balance_paid?'<b>PAID</b>':'due')+'</td></tr>'
            +'</table>';
        if(d.notes){ html+='<h2>Notes</h2><p style="font-size:13px;">'+escapeHtml(d.notes)+'</p>'; }
        html+='</body></html>';
        w.document.write(html); w.document.close(); w.focus();
        setTimeout(function(){ try{ w.print(); }catch(e){} },350);
    }
    /* ===== END CATERING PIPELINE ===== */

    /* ---------- 8. CHECKLIST DUE-WINDOWS ---------- */
    var p4CkwCache=null, p4CkwAt=0;
    function p4CkwFetch(cb){
        var now=Date.now();
        if(p4CkwCache&&(now-p4CkwAt)<300000){ cb(p4CkwCache); return; }
        p4Rpc('app_checklist_windows',{},function(d){ p4CkwCache=d||[]; p4CkwAt=Date.now(); cb(p4CkwCache); },function(){ cb(p4CkwCache||[]); });
    }
    function p4ClChip(){
        var prog=document.getElementById('clProgress'); if(!prog) return;
        var chip=document.getElementById('p4clChip');
        if(!chip){ chip=document.createElement('div'); chip.id='p4clChip'; chip.style.cssText='margin:6px 0 10px;'; prog.parentNode.insertBefore(chip,prog.nextSibling); }
        chip.innerHTML='';
        var loc=null; try{ loc=tempStoreLoc(); }catch(e){}
        if(!loc) return;
        var shift=(typeof clShift!=='undefined')?clShift:'open';
        p4CkwFetch(function(rows){
            var w=(rows||[]).find(function(x){ return x&&x.active!==false&&x.location===loc&&String(x.shift_type||'').toLowerCase()===String(shift).toLowerCase(); });
            var el=document.getElementById('p4clChip'); if(!el) return;
            if(!w||!w.due_time){ el.innerHTML=''; return; }
            var due=String(w.due_time).slice(0,5);
            var n=new Date(); var nowM=n.getHours()*60+n.getMinutes();
            var dp=due.split(':'); var dueM=parseInt(dp[0],10)*60+parseInt(dp[1],10);
            var esc=parseInt(w.escalate_after_min||30,10);
            var html;
            if(nowM<=dueM){ html='<span style="background:#eef6fd;color:#0d6eaf;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:800;">&#9200; Due by '+p4Esc(due)+'</span>'; }
            else{
                var lateBy=nowM-dueM;
                if(lateBy<=esc) html='<span style="background:#fff3cd;color:#854F0B;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:800;">&#9200; Due by '+p4Esc(due)+' &middot; '+lateBy+' min late</span>';
                else html='<span style="background:#fdecea;color:#c0392b;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:800;">&#9888;&#65039; '+lateBy+' min past the '+p4Esc(due)+' due time</span>';
            }
            el.innerHTML=html;
        });
    }
    setChecklistTab=(function(orig){ return function(shift){ orig.apply(this,arguments); try{ p4ClChip(); }catch(e){} }; })(setChecklistTab);
    /* Admin editor card (in Admin Console) */
    function p4CkwAdminLoad(){
        var box=document.getElementById('p4ckwBox'); if(!box) return;
        var stores=(typeof HUB_STORES!=='undefined'&&HUB_STORES.length)?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell'];
        var sel=document.getElementById('p4ckwLoc');
        if(sel) sel.innerHTML=stores.map(function(s){ return '<option>'+p4Esc(s)+'</option>'; }).join('');
        box.innerHTML='<p style="color:var(--txt2,#8a8594);font-size:13px;">Loading&hellip;</p>';
        p4CkwCache=null;
        p4CkwFetch(function(rows){
            rows=rows||[];
            box.innerHTML=rows.length?rows.map(function(w){
                return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--bd,#eee);font-size:13px;"><span>'+p4Esc(w.location||'')+' &middot; <b>'+p4Esc(w.shift_type||'')+'</b> &middot; due '+p4Esc(String(w.due_time||'').slice(0,5))+' &middot; escalate +'+p4Esc(String(w.escalate_after_min||30))+'m'+(w.active===false?' &middot; <i>off</i>':'')+'</span>'+(w.active!==false?'<button onclick="p4CkwOff('+w.id+',\''+p4Esc(w.location||'').replace(/'/g,"\\'")+'\',\''+p4Esc(w.shift_type||'')+'\',\''+p4Esc(String(w.due_time||'').slice(0,5))+'\','+(w.escalate_after_min||30)+')" style="background:#fff2f3;color:#c0264b;border:1px solid #f0b8c3;border-radius:7px;padding:3px 9px;font-size:11.5px;font-weight:700;cursor:pointer;">Turn off</button>':'')+'</div>';
            }).join(''):'<p style="color:var(--txt2,#8a8594);font-size:13px;">No due times set yet — add the first one above.</p>';
        });
    }
    function p4CkwSave(){
        var loc=document.getElementById('p4ckwLoc').value, sh=document.getElementById('p4ckwShift').value, t=document.getElementById('p4ckwTime').value, esc=parseInt(document.getElementById('p4ckwEsc').value,10)||30;
        if(!t){ alert('Pick a due time.'); return; }
        p4Rpc('app_checklist_window_set',{p_location:loc,p_shift_type:sh,p_due_time:t,p_escalate_min:esc,p_active:true},function(d){
            if(d&&d.ok===false){ alert(d.reason||'Could not save.'); return; }
            p4CkwCache=null; p4CkwAdminLoad();
        });
    }
    function p4CkwOff(id,loc,sh,t,esc){
        p4Rpc('app_checklist_window_set',{p_location:loc,p_shift_type:sh,p_due_time:t||'10:00',p_escalate_min:esc||30,p_active:false},function(){ p4CkwCache=null; p4CkwAdminLoad(); });
    }
    openAdminConsole=(function(orig){ return function(){ orig.apply(this,arguments); try{ p4CkwAdminLoad(); }catch(e){} }; })(openAdminConsole);

    /* ---------- TILE VISIBILITY + REGISTRY ---------- */
    function p4ApplyVis(){
        try{
            var lb=document.getElementById('btn-logbook'); if(lb) lb.style.display=p4Mgr()?'block':'none';
            p4MyAttMount();
        }catch(e){}
    }
    if(typeof switchMenuTab==='function'){
        switchMenuTab=(function(orig){ return function(){ var r=orig.apply(this,arguments); try{ p4ApplyVis(); }catch(e){} return r; }; })(switchMenuTab);
    }
    try{ p4ApplyVis(); }catch(e){}
    try{
        HUB_STATIC_REG.push(
            { id:'sickleave', key:'sickleave', btn:'btn-sickLeave', keywords:['sick','sick leave','sick time','pto','paid leave','hwa','healthy workplaces','call in sick'] },
            { id:'logbook', key:'logbook', btn:'btn-logbook', keywords:['logbook','log book','shift notes','diary','handoff','pass down','manager notes'] },
            { id:'myattendance', label:'My Attendance (90 days)', emoji:'&#128197;', section:'Home', keywords:['my attendance','my record','tardies','call ins','points','late'], roleCheck:null, go:function(){ hubNav('home'); setTimeout(function(){ try{ var b=document.getElementById('p4myattBody'); if(b&&b.style.display==='none') p4MyAttToggle(); var t=document.getElementById('p4myattBtn'); if(t&&t.scrollIntoView) t.scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){} },400); } },
            { id:'checklistwindows', label:'Checklist due times', emoji:'&#9200;', section:'Admin Console', keywords:['checklist due','due time','opening deadline','late checklist','escalate'], roleCheck:_hubRole('isAdminManager'), go:function(){ openAdminConsole(); _hubScrollTo('p4ckwCard'); } }
        );
        NEW_THIS_MONTH.push('sickleave','logbook','myattendance');
    }catch(e){}
    /* ===== END P4 FEATURE BUNDLE ===== */
