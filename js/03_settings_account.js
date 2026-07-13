    // ============================================================
    // SETTINGS / ACCOUNT
    // ============================================================
    function openSettings() {
        document.getElementById('settingsName').value = currentUser.name || '';
        document.getElementById('settingsEmail').value = currentUser.email || '';
        document.getElementById('settingsCurrentPin').value = '';
        document.getElementById('settingsNewPin').value = '';
        document.getElementById('settingsConfirmPin').value = '';
        document.getElementById('pinMsg').style.display = 'none';
        document.getElementById('accountMsg').style.display = 'none';
        document.getElementById('appVersionLabel').innerText = APP_VERSION;
        document.getElementById('privacyPolicyText').style.display = 'none';
        updateBioToggleBtn();
        updatePushToggleBtn();
        loadMyPhoto();
        document.getElementById('settingsModal').style.display = 'flex';
    }
    function closeSettings() {
        document.getElementById('settingsModal').style.display = 'none';
    }
    function togglePrivacyPolicy() {
        const el = document.getElementById('privacyPolicyText');
        el.style.display = (el.style.display === 'none') ? 'block' : 'none';
    }
    function changePin() {
        const currentPin = document.getElementById('settingsCurrentPin').value;
        const newPin = document.getElementById('settingsNewPin').value;
        const confirmPin = document.getElementById('settingsConfirmPin').value;
        const msg = document.getElementById('pinMsg');
        msg.style.display = 'none';
        if (!currentPin || !newPin || !confirmPin) { msg.innerText = 'Please fill all fields.'; msg.className = 'settings-msg err'; msg.style.display = 'block'; return; }
        if (newPin !== confirmPin) { msg.innerText = 'PINs do not match.'; msg.className = 'settings-msg err'; msg.style.display = 'block'; return; }
        if (newPin.length < 4) { msg.innerText = 'PIN must be at least 4 characters.'; msg.className = 'settings-msg err'; msg.style.display = 'block'; return; }
        supabaseClient.rpc('app_change_pin', { p_username: currentUser.username, p_old_password: currentPin, p_new_password: newPin })
        .then(({ data, error }) => {
            if (error) { msg.innerText = 'Error: ' + error.message; msg.className = 'settings-msg err'; msg.style.display = 'block'; return; }
            if (!data) { msg.innerText = 'Current PIN is incorrect.'; msg.className = 'settings-msg err'; msg.style.display = 'block'; return; }
            sessionPin = newPin;
            try { if(localStorage.getItem('calichesKeep')!=='0') sessionStorage.setItem('calichesPin', newPin); } catch(e){}
            msg.innerText = 'PIN updated successfully!'; msg.className = 'settings-msg ok'; msg.style.display = 'block';
            document.getElementById('settingsCurrentPin').value = ''; document.getElementById('settingsNewPin').value = ''; document.getElementById('settingsConfirmPin').value = '';
        }).catch(() => { msg.innerText = 'Connection error. Please try again.'; msg.className = 'settings-msg err'; msg.style.display = 'block'; });
    }
    function updateAccountInfo() {
        const name = document.getElementById('settingsName').value.trim();
        const email = document.getElementById('settingsEmail').value.trim();
        const msg = document.getElementById('accountMsg');
        msg.style.display = 'none';
        if (!name) { msg.innerText = 'Name cannot be empty.'; msg.className = 'settings-msg err'; msg.style.display = 'block'; return; }
        withPin(function(pin) {
            supabaseClient.rpc('app_update_profile', { p_username: currentUser.username, p_password: pin, p_name: name, p_email: email })
            .then(({ data, error }) => {
                if (error) { msg.innerText = 'Error: ' + error.message; msg.className = 'settings-msg err'; msg.style.display = 'block'; return; }
                if (!data) { msg.innerText = 'PIN verification failed.'; msg.className = 'settings-msg err'; msg.style.display = 'block'; sessionPin = null; return; }
                currentUser.name = name; currentUser.email = email;
                localStorage.setItem('calichesUser', JSON.stringify(currentUser));
                document.getElementById('greetingName').innerText = 'Hello, ' + name;
                msg.innerText = 'Account info updated!'; msg.className = 'settings-msg ok'; msg.style.display = 'block';
            }).catch(() => { msg.innerText = 'Connection error. Please try again.'; msg.className = 'settings-msg err'; msg.style.display = 'block'; });
        });
    }

    function setPhotoPreview(url){
        const pv=document.getElementById('photoPreview'); const rm=document.getElementById('photoRemoveBtn');
        if(url){ pv.style.backgroundImage='url('+url+')'; pv.innerHTML=''; rm.style.display='block'; }
        else { pv.style.backgroundImage='none'; pv.innerHTML='&#128100;'; rm.style.display='none'; }
    }
    function loadMyPhoto(){
        setPhotoPreview(null);
        document.getElementById('photoMsg').style.display='none';
        withPin(function(pin){
            supabaseClient.rpc('app_my_photo',{p_username:currentUser.username,p_password:pin}).then(function(r){ if(!r.error && r.data) setPhotoPreview(r.data); });
        });
    }
    function onPhotoPicked(ev){
        const f=ev.target.files && ev.target.files[0]; if(!f) return;
        const msg=document.getElementById('photoMsg'); msg.style.display='none';
        if(!/^image\//.test(f.type)){ msg.innerText='Please choose an image.'; msg.className='settings-msg err'; msg.style.display='block'; return; }
        const reader=new FileReader();
        reader.onload=function(e){
            const img=new Image();
            img.onload=function(){
                const S=160; const c=document.createElement('canvas'); c.width=S; c.height=S; const ctx=c.getContext('2d');
                const scale=Math.max(S/img.width, S/img.height); const w=img.width*scale, h=img.height*scale;
                ctx.drawImage(img,(S-w)/2,(S-h)/2,w,h);
                const dataUrl=c.toDataURL('image/jpeg',0.82);
                setPhotoPreview(dataUrl);
                msg.innerText='Saving…'; msg.className='settings-msg'; msg.style.display='block';
                withPin(function(pin){
                    supabaseClient.rpc('app_set_my_photo',{p_username:currentUser.username,p_password:pin,p_photo:dataUrl}).then(function(r){
                        if(r.error){ msg.innerText='Error: '+r.error.message; msg.className='settings-msg err'; if(r.error.code==='42501') sessionPin=null; return; }
                        msg.innerText='Photo saved! Reminder: it must be an appropriate photo of you.'; msg.className='settings-msg ok';
                    });
                });
            };
            img.src=e.target.result;
        };
        reader.readAsDataURL(f);
        ev.target.value='';
    }
    function removeMyPhoto(){
        if(!confirm('Remove your profile photo?')) return;
        const msg=document.getElementById('photoMsg');
        withPin(function(pin){
            supabaseClient.rpc('app_set_my_photo',{p_username:currentUser.username,p_password:pin,p_photo:null}).then(function(r){
                if(r.error){ msg.innerText='Error: '+r.error.message; msg.className='settings-msg err'; msg.style.display='block'; return; }
                setPhotoPreview(null); msg.innerText='Photo removed.'; msg.className='settings-msg ok'; msg.style.display='block';
            });
        });
    }

    // ============================================================
    // NAVIGATION
    // ============================================================
    function triggerTransition(callback) { const loader = document.getElementById('neon-loader'); loader.style.display = 'flex'; setTimeout(() => { loader.style.opacity = '1'; }, 10); setTimeout(() => { callback(); window.scrollTo(0,0); loader.style.opacity = '0'; setTimeout(() => { loader.style.display = 'none'; }, 300); }, 200); /* was 1200ms — artificial delay cut for snappy navigation */ }
    function openMenu() { triggerTransition(() => { document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none'); document.getElementById('main-menu').style.display = 'block'; switchMenuTab('home'); window.scrollTo(0,0); applyPendingReloadIfSafe(); }); }

    // ============================================================
    // ONE-STEP BACK NAVIGATION (history of screens)
    // ============================================================
    var _navStack = [], _navCurrent = null, _navSuppress = false;
    function _navScreenId(){
        var views = document.querySelectorAll('.app-view');
        for (var i=0;i<views.length;i++){ if (views[i].style.display==='block') return 'view:'+views[i].id; }
        var menu = document.getElementById('main-menu');
        if (menu && menu.style.display==='block') return 'menu';
        return null;
    }
    function _navOnChange(){
        if (_navSuppress) return;
        var s=_navScreenId();
        if (!s || s===_navCurrent) return;
        if (_navCurrent){ _navStack.push(_navCurrent); if(_navStack.length>50) _navStack.shift(); }
        _navCurrent=s;
    }
    // Opt-in reloaders so a deep Back refreshes list screens instead of showing stale data.
    var _viewReload = {
        'view:rosterView': function(){ if(typeof loadRoster==='function') loadRoster(); },
        'view:requestsView': function(){ if(typeof loadRequests==='function') loadRequests(); },
        'view:inventoryView': function(){ if(typeof loadInventory==='function') loadInventory(); },
        'view:trainingPortalView': function(){ if(typeof loadTraining==='function') loadTraining(); },
        'view:timesheetsView': function(){ if(typeof loadTimesheet==='function') loadTimesheet(); },
        'view:availabilityView': function(){ if(typeof loadAvailability==='function') loadAvailability(); },
        'view:mySubmissionsView': function(){ if(typeof fetchMySubmissions==='function') fetchMySubmissions(); },
        'view:shortageTrendsView': function(){ if(typeof fetchShortageTrends==='function') fetchShortageTrends(); },
        'view:messagesView': function(){ if(typeof loadMsgTab==='function') loadMsgTab(); },
        /* Phase-3: also refresh these when the user comes BACK to them, so they never show stale data */
        'view:tasksView': function(){ try{ if(typeof loadMyTasks==='function') loadMyTasks('tasksMineCard'); }catch(e){} try{ if(typeof renderTeamTasks==='function') renderTeamTasks(); }catch(e){} },
        'view:supplyRequestView': function(){ try{ if(typeof supplyLoadList==='function'){ supplyLoadList('mine'); supplyLoadList('incoming'); } }catch(e){} },
        'view:equipmentView': function(){ try{ if(typeof openEquipment==='function') openEquipment(); }catch(e){} },
        'view:maintDashView': function(){ try{ if(typeof woLoad==='function'&&typeof woRender==='function') woLoad(function(){ woRender(); }); }catch(e){} },
        'view:notificationsView': function(){ try{ if(typeof loadNotifications==='function') loadNotifications(); }catch(e){} }
    };
    function _navApply(screen){
        if (screen.indexOf('view:')===0){
            var id=screen.slice(5);
            var m=document.getElementById('main-menu'); if(m) m.style.display='none';
            document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
            var el=document.getElementById(id); if(el) el.style.display='block';
            try{ if(_viewReload[screen]) _viewReload[screen](); }catch(e){}
            window.scrollTo(0,0);
        } else if (screen==='menu'){
            document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
            var m2=document.getElementById('main-menu'); if(m2) m2.style.display='block';
            window.scrollTo(0,0);
        }
    }
    function goBack(){
        // A Back press first dismisses any visible dynamically-created full-screen overlay
        // (ids ending in "Modal", incl. the yv2 overlay) — these are not .app-view/.modal-overlay.
        var _dynOv=null;
        document.querySelectorAll('[id$="Modal"]').forEach(function(x){ try{ if(getComputedStyle(x).display!=='none') _dynOv=x; }catch(e){} });
        if (_dynOv){ _dynOv.style.display='none'; return; }
        // If a modal is open, a Back just closes it
        var openM=null; document.querySelectorAll('.modal-overlay').forEach(function(x){ var d=x.style.display; if(d==='flex'||d==='block') openM=x; });
        if (openM){ openM.style.display='none'; return; }
        if (!_navStack.length){ if(typeof openMenu==='function') openMenu(); return; }
        var prev=_navStack.pop();
        _navSuppress=true;
        _navApply(prev);
        _navCurrent=prev;
        setTimeout(function(){ _navSuppress=false; }, 60);
    }
    function _navRepointBacks(){
        document.querySelectorAll('.back-btn').forEach(function(b){
            var oc=b.getAttribute('onclick')||'';
            if (/openMenu\(\)/.test(oc) && !b.getAttribute('data-back1')){
                b.setAttribute('onclick','goBack()');
                b.setAttribute('data-back1','1');
                b.innerHTML='&#8249; Back';
            }
        });
    }
    (function(){
        if (!window.MutationObserver) return;
        var obs=new MutationObserver(function(){ _navOnChange(); });
        function startNav(){
            document.querySelectorAll('.app-view').forEach(function(v){ obs.observe(v,{attributes:true,attributeFilter:['style']}); });
            var m=document.getElementById('main-menu'); if(m) obs.observe(m,{attributes:true,attributeFilter:['style']});
            _navCurrent=_navScreenId();
            _navRepointBacks();
        }
        if (document.readyState!=='loading') startNav(); else document.addEventListener('DOMContentLoaded', startNav);
    })();

    // ============================================================
    // SCHEDULING (Phase 1, TEST) - Admin Manager builder
    // ============================================================
    /* ===================== CONFIGURABLE STORES ===================== */
    var DEFAULT_STORES=['Roadrunner','Valley','Lenox','Alamogordo','Roswell'];
    var HUB_STORES=DEFAULT_STORES.slice();
    var HUB_STORE_ABBR={Roadrunner:'RR',Valley:'V',Lenox:'L',Alamogordo:'A',Roswell:'R'};
    var STORE_NAME_SET={}; DEFAULT_STORES.forEach(function(s){STORE_NAME_SET[s]=1;});
    var HUB_STORE_EMOJI={Roadrunner:'🛣️',Valley:'🌄',Lenox:'🏙️',Alamogordo:'🌵',Roswell:'🛸'};
    function hubStoreEmoji(s){ return HUB_STORE_EMOJI[s]||'📍'; }
    function hubStoreAbbr(s){ return HUB_STORE_ABBR[s]||(s?String(s).replace(/[^A-Za-z]/g,'').slice(0,2).toUpperCase():''); }
    function applyStoreCfgFromRows(rows){
        if(!rows||!rows.length) return;
        HUB_STORES=rows.map(function(x){return x.label;}).filter(Boolean);
        HUB_STORES.forEach(function(s){STORE_NAME_SET[s]=1;});
        HUB_STORE_ABBR={}; HUB_STORE_EMOJI={};
        rows.forEach(function(x){ var v=String(x.value||'').split('|'); HUB_STORE_ABBR[x.label]=v[0]||hubStoreAbbr(x.label); if(v[1]) HUB_STORE_EMOJI[x.label]=v[1]; });
        try{ SCHED_LOCATIONS=HUB_STORES.concat(['Catering & Vending']); }catch(e){}
        try{ SCHED_STORE_ABBR={}; HUB_STORES.forEach(function(s){SCHED_STORE_ABBR[s]=hubStoreAbbr(s);}); SCHED_STORE_ABBR['Catering & Vending']='C&V'; }catch(e){}
        hubApplyStores();
    }
    function loadHubStores(){
        if(!currentUser||!sessionPin) return;
        supabaseClient.rpc('app_settings_get',{p_username:currentUser.username,p_password:sessionPin,p_group:'stores'}).then(function(r){
            if(r.error||!r.data||!r.data.length) return;
            applyStoreCfgFromRows(r.data.slice().sort(function(a,b){return (a.sort||0)-(b.sort||0);}));
        }).catch(function(){});
    }
    function hubApplyStores(){
        try{
            var sels=document.querySelectorAll('select');
            for(var k=0;k<sels.length;k++){
                var sel=sels[k]; var opts=[].slice.call(sel.options);
                var first=-1,last=-1;
                for(var i=0;i<opts.length;i++){ if(STORE_NAME_SET[opts[i].text]){ if(first<0)first=i; last=i; } }
                if(first<0) continue;
                var cur=sel.value, html='';
                for(var a=0;a<first;a++) html+=opts[a].outerHTML;
                HUB_STORES.forEach(function(s){ html+='<option>'+String(s).replace(/[<>]/g,'')+'</option>'; });
                for(var z=last+1;z<opts.length;z++) html+=opts[z].outerHTML;
                sel.innerHTML=html; if(cur){ try{ sel.value=cur; }catch(e){} }
            }
        }catch(e){}
    }
    /* ---- Store manager (managers) ---- */
    var _sm={rows:[]};
    function smRpc(name,args,cb){ withPin(function(pin){ supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args)).then(function(r){ if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; } cb(r.data); }).catch(function(){ alert('Connection error.'); }); }); }
    function openStoreManager(){ if(!(currentUser&&(currentUser.is_developer===true||(typeof woIsMgr==='function'&&woIsMgr())))){ alert('Store management is for managers.'); return; } smReload(); }
    function smReload(){ smRpc('app_settings_get',{p_group:'stores'},function(d){ _sm.rows=(d||[]).slice().sort(function(a,b){return (a.sort||0)-(b.sort||0);}); if(_sm.rows.length) applyStoreCfgFromRows(_sm.rows); smRender(); }); }
    function smOv(){ var o=document.getElementById('smModal'); if(!o){ o=document.createElement('div'); o.id='smModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function smClose(){ var o=document.getElementById('smModal'); if(o) o.style.display='none'; }
    function smRender(){
        var h='<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">Manage Stores</b><button onclick="smClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">&times;</button></div>';
        h+='<div style="max-width:560px;margin:0 auto;padding:16px 16px 50px;">';
        h+='<p style="font-size:13px;color:#6b7686;margin-top:0;">These are the stores used in dropdowns across the Hub (reporting, work orders, supply requests, scheduling). Add, rename, or remove a store here — no developer needed.</p>';
        if(!_sm.rows.length) h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:11px;padding:20px;text-align:center;color:#6b6275;">No stores configured yet.</div>';
        _sm.rows.forEach(function(r){
            var emo=String(r.value||'').split('|')[1]||'📍';
            h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:11px;padding:11px 13px;margin-bottom:8px;display:flex;align-items:center;gap:9px;"><span style="font-size:18px;">'+emo+'</span><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(r.label||'')+'</b><button onclick="smRename(\''+r.key+'\')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:7px;padding:6px 11px;font-size:12px;font-weight:700;cursor:pointer;">Rename</button><button onclick="smRemove(\''+r.key+'\')" style="background:#fdeaea;color:#c0264b;border:none;border-radius:7px;padding:6px 11px;font-size:12px;font-weight:700;cursor:pointer;">Remove</button></div>';
        });
        h+='<button onclick="smAdd()" style="width:100%;background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;margin-top:6px;">&#10133; Add store</button>';
        h+='<p style="font-size:11.5px;color:#5b6675;margin-top:12px;">After adding or renaming, the change shows in dropdowns right away on this device; others see it next time they open the app.</p></div>';
        smOv().innerHTML=h;
    }
    function smAdd(){ var name=prompt('New store name:'); if(!name) return; name=name.trim(); if(!name) return; if((_sm.rows||[]).some(function(r){return String(r.label||'').trim().toLowerCase()===name.toLowerCase();})){ alert('A store with that name already exists.'); return; } var key='store_'+Date.now(); var sort=(_sm.rows.length?Math.max.apply(null,_sm.rows.map(function(r){return r.sort||0;})):0)+1; var emoji=(prompt('An emoji for this store (optional):')||'📍').trim()||'📍'; var abbr=name.replace(/[^A-Za-z]/g,'').slice(0,2).toUpperCase(); smRpc('app_settings_set',{p_key:key,p_group:'stores',p_label:name,p_value:abbr+'|'+emoji,p_sort:sort},function(){ smReload(); }); }
    function smRename(key){ var row=_sm.rows.filter(function(r){return r.key===key;})[0]; if(!row) return; var name=prompt('Rename store:',row.label); if(name===null) return; name=name.trim(); if(!name) return; smRpc('app_settings_set',{p_key:key,p_group:'stores',p_label:name,p_value:row.value||'',p_sort:row.sort||0},function(){ smReload(); }); }
    function smRemove(key){ var row=_sm.rows.filter(function(r){return r.key===key;})[0]; if(!row) return; if(!confirm('Remove "'+row.label+'" from the store list? Existing records keep their store name; it just stops appearing in dropdowns.')) return; smRpc('app_settings_delete',{p_key:key},function(){ smReload(); }); }
    /* =================== END CONFIGURABLE STORES =================== */
    var SCHED_LOCATIONS = ['Roadrunner','Valley','Lenox','Alamogordo','Roswell','Catering & Vending'];
    let schedState = { location:'Roadrunner', weekStart:null, data:{positions:[],employees:[],shifts:[]}, editing:{employeeId:null,date:null,shiftId:null} };

    function isAdminManager() { return currentUser && (currentUser.role === 'Admin Manager' || currentUser.role === 'Vice President/Co-Owner' || currentUser.is_developer === true); }

    function openScheduling() {
        triggerTransition(() => {
            document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
            document.getElementById('scheduleBuilderView').style.display = 'block';
            initScheduleBuilder();
        });
    }

    function schedMondayOf(d){ const dt=new Date(d); const day=(dt.getDay()+6)%7; dt.setDate(dt.getDate()-day); dt.setHours(0,0,0,0); return dt; }
    function schedFmt(dt){ const m=String(dt.getMonth()+1).padStart(2,'0'); const da=String(dt.getDate()).padStart(2,'0'); return dt.getFullYear()+'-'+m+'-'+da; }
    function schedAddDays(dt,n){ const x=new Date(dt); x.setDate(x.getDate()+n); return x; }

    function initScheduleBuilder() {
        const mgr = (typeof schedIsMgr==='function' ? schedIsMgr() : isAdminManager());
        schedState.mode = mgr ? 'mgr' : 'staff';
        document.getElementById('schedNavMgr').style.display = mgr ? 'flex' : 'none';
        document.getElementById('schedNavStaff').style.display = mgr ? 'none' : 'flex';
        document.getElementById('schedPublishBtn').style.display = mgr ? '' : 'none';
        document.getElementById('schedLocation').parentElement.style.display = mgr ? '' : 'none';
        document.getElementById('schedSearch').parentElement.style.display = mgr ? '' : 'none';
        const sel = document.getElementById('schedLocation');
        if (sel && !sel.options.length) sel.innerHTML = SCHED_LOCATIONS.map(l => '<option>'+l+'</option>').join('');
        schedState.location = sel ? sel.value : 'Roadrunner';
        if (!schedState.weekStart) schedState.weekStart = schedMondayOf(new Date());
        if (mgr) fetchScheduleWeek(); else fetchMyShifts();
    }
    function schedChangeLocation(){ schedState.location = document.getElementById('schedLocation').value; fetchScheduleWeek(); }
    function schedShiftWeek(days){ schedState.weekStart = schedAddDays(schedState.weekStart, days); if(schedState.mode==='staff') fetchMyShifts(); else fetchScheduleWeek(); }
    function schedToday(){ schedState.weekStart = schedMondayOf(new Date()); if(schedState.mode==='staff') fetchMyShifts(); else fetchScheduleWeek(); }
    function toggleSchedRail(){ document.getElementById('schedPortal').classList.toggle('railopen'); }
    function schedRailNav(action, el){
        if (el){ var nav = el.closest('.sp-nav'); if(nav){ nav.querySelectorAll('a').forEach(function(a){ a.classList.remove('active'); }); } el.classList.add('active'); }
        document.getElementById('schedPortal').classList.remove('railopen');
        switch(action){
            case 'schedule': case 'myshifts': initScheduleBuilder(); break;
            case 'timesheets': openTimesheets(); break;
            case 'live': openLiveBoard(); break;
            case 'clock': openTimeClock(); break;
            case 'roster': openRoster(); break;
            case 'copy': schedCopyLastWeek(); break;
            case 'templates': openSchedTemplates(); break;
            case 'confirms': openWeekConfirms(); break;
            case 'addemp': schedAddEmployee(); break;
            case 'roles': openRolesModal(); break;
            case 'print': schedPrint(); break;
            case 'timeoff': openTimeOff(); break;
            case 'availability': if(typeof openAvailability==='function'){ openAvailability(); } else { alert('Open Availability from the main menu.'); } break;
        }
    }

    function fetchScheduleWeek() {
        const grid = document.getElementById('schedGrid');
        grid.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">Loading&hellip;</p>';
        const ws = schedFmt(schedState.weekStart);
        const loc = schedState.location;
        withPin(function(pin){
            Promise.all([
                supabaseClient.rpc('app_sched_week_context', { p_username: currentUser.username, p_password: pin, p_location: loc, p_week_start: ws }),
                supabaseClient.rpc('app_emp_photos', { p_username: currentUser.username, p_password: pin, p_location: loc }),
                supabaseClient.rpc('app_sched_layout_get', { p_username: currentUser.username, p_password: pin, p_location: loc }),
                supabaseClient.rpc('app_labor_get', { p_username: currentUser.username, p_password: pin, p_location: loc, p_week_start: ws }),
                supabaseClient.rpc('app_availability_all', { p_username: currentUser.username, p_password: pin, p_location: loc }),
                supabaseClient.rpc('app_compliance_all', { p_username: currentUser.username, p_password: pin, p_location: loc })
            ]).then(function(res){
                const r0 = res[0];
                if (r0.error && r0.error.code === '42501') sessionPin = null;
                if (r0.error) { grid.innerHTML = '<p style="color:red;text-align:center;padding:20px;">Error: ' + r0.error.message + '</p>'; return; }
                const data = r0.data || {};
                schedState.data = { positions: data.positions||[], employees: data.employees||[], shifts: data.shifts||[] };
                schedState.elsewhere = data.elsewhere || [];
                schedState.timeoff = data.time_off || [];
                schedState.photos = (res[1] && res[1].data) || {};
                const lay = (res[2] && res[2].data) || {};
                schedState.sortMode = lay.sort_mode || 'first';
                schedState.empOrder = lay.emp_order || [];
                schedState.forecast = (res[3] && res[3].data) || {};
                schedState.avail = (res[4] && res[4].data) || {};
                schedState.compliance = (res[5] && !res[5].error && res[5].data) || {};
                if (!schedState.selectedDay) schedState.selectedDay = 0;
                renderScheduleGrid();
            }).catch(() => { grid.innerHTML = '<p style="color:red;text-align:center;">Connection error.</p>'; });
        }, function(){ grid.innerHTML = '<p style="text-align:center;padding:20px;color:#6b7686;">PIN required.</p>'; });
    }
    var SCHED_STORE_ABBR = { 'Roadrunner':'RR','Valley':'V','Lenox':'L','Alamogordo':'A','Roswell':'R','Catering & Vending':'C&V' };
    function schedAbbr(name){ return SCHED_STORE_ABBR[name] || (name||'').slice(0,2).toUpperCase(); }
    function schedSortedEmps(emps){
        const mode = schedState.sortMode || 'first';
        const arr = emps.slice();
        if (mode === 'custom' && (schedState.empOrder||[]).length){
            const order = schedState.empOrder; const idx = {}; order.forEach((id,i)=>idx[id]=i);
            arr.sort((a,b)=>{ const ai=(a.id in idx)?idx[a.id]:9999, bi=(b.id in idx)?idx[b.id]:9999; return ai-bi || (a.name||'').localeCompare(b.name||''); });
        } else if (mode === 'last'){
            const last = n => { const p=String(n||'').trim().split(/\s+/); return (p[p.length-1]||'').toLowerCase(); };
            arr.sort((a,b)=> last(a.name).localeCompare(last(b.name)) || (a.name||'').localeCompare(b.name||''));
        } else {
            arr.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
        }
        return arr;
    }
    function schedSetSort(mode){ schedState.sortMode = mode; schedSaveLayout(); renderScheduleGrid(); }
    function schedSaveLayout(){
        withPin(function(pin){
            supabaseClient.rpc('app_sched_layout_set', { p_username: currentUser.username, p_password: pin, p_location: schedState.location, p_sort_mode: schedState.sortMode||'first', p_emp_order: schedState.empOrder||[] }).then(function(){});
        });
    }
    // ---- Reusable drag-to-reorder (mouse + touch), used by schedule/roster/training/equipment ----
    function initDragReorder(container, opts){
        if(!container || container.getAttribute('data-dragreorder')) return;
        container.setAttribute('data-dragreorder','1');
        var drag=null, parent=null, pid=null, moved=false;
        container.addEventListener('pointerdown', function(e){
            var h = e.target.closest ? e.target.closest('.dragrip') : null; if(!h) return;
            var row = h.closest('['+opts.idAttr+']'); if(!row) return;
            e.preventDefault();
            drag=row; parent=row.parentNode; pid=e.pointerId; moved=false;
            row.classList.add('reorder-drag');
            try{ container.setPointerCapture(pid); }catch(_){}
        });
        container.addEventListener('pointermove', function(e){
            if(!drag) return; e.preventDefault(); moved=true;
            var y=e.clientY, best=-Infinity, after=null;
            [].slice.call(parent.querySelectorAll('['+opts.idAttr+']')).forEach(function(el){
                if(el===drag) return;
                var b=el.getBoundingClientRect(), off=y-b.top-b.height/2;
                if(off<0 && off>best){ best=off; after=el; }
            });
            if(after) parent.insertBefore(drag, after); else parent.appendChild(drag);
        });
        function end(){
            if(!drag) return;
            drag.classList.remove('reorder-drag');
            try{ container.releasePointerCapture(pid); }catch(_){}
            var ids=[].slice.call(parent.querySelectorAll('['+opts.idAttr+']')).map(function(x){ return x.getAttribute(opts.idAttr); });
            drag=null;
            if(moved && opts.onDrop) opts.onDrop(ids);
        }
        container.addEventListener('pointerup', end);
        container.addEventListener('pointercancel', end);
    }
    var DRAG_GRIP = '<span class="dragrip" title="Drag to reorder" aria-hidden="true"><svg width="11" height="16" viewBox="0 0 11 16"><circle cx="3" cy="3" r="1.4"/><circle cx="8" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="8" cy="13" r="1.4"/></svg></span>';
    function schedInitDragReorder(){
        var g=document.getElementById('schedGrid'); if(!g) return;
        initDragReorder(g, { idAttr:'data-empid', onDrop:function(ids){
            ids = ids.map(function(x){ return parseInt(x,10); }).filter(function(n){ return !isNaN(n); });
            if(!ids.length) return;
            schedState.empOrder = ids; schedState.sortMode = 'custom';
            schedSaveLayout(); renderScheduleGrid();
        }});
    }
    function schedLaborTarget(){ var t=parseFloat(localStorage.getItem('laborTargetPct')); var d=(typeof cfgNum==='function'?cfgNum('targets','labor_pct',25):25); return (isNaN(t)||t<=0)?d:t; }
    function schedSetLaborTarget(v){ var t=parseFloat(v); if(!isNaN(t)&&t>0){ try{ localStorage.setItem('laborTargetPct',t); }catch(e){} renderScheduleGrid(); } }
    // Shared with the Command Center: green ok / amber near-target / red over. near = points below target that still counts as "near".
    function schedPctCol(pct,tgt,near){ if(pct==null) return '#5b6675'; near=near||2; if(pct>tgt) return '#c0392b'; if(pct>=tgt-near) return '#b06a00'; return '#1f7a3d'; }
    function schedSetForecast(ds, val){
        const amt = parseFloat(val); if (isNaN(amt)) return;
        schedState.forecast = schedState.forecast || {}; schedState.forecast[ds] = amt;
        withPin(function(pin){
            supabaseClient.rpc('app_labor_set', { p_username: currentUser.username, p_password: pin, p_location: schedState.location, p_date: ds, p_amount: amt }).then(function(){});
        });
    }

    function schedPosById(id){ return (schedState.data.positions || []).find(p => p.id === id); }
    function schedShiftHours(s){ if(!s.start_time||!s.end_time) return 0; const a=s.start_time.split(':').map(Number); const b=s.end_time.split(':').map(Number); let h=(b[0]*60+b[1]-(a[0]*60+a[1]))/60; if(h<0) h+=24; return h; }
    // pick black or white text for legibility on a colored chip (WCAG-ish luminance)
    function hbTextOn(hex){ if(!hex||hex[0]!=='#'||hex.length<7) return '#fff'; const r=parseInt(hex.substr(1,2),16),g=parseInt(hex.substr(3,2),16),b=parseInt(hex.substr(5,2),16); return ((0.299*r+0.587*g+0.114*b)/255) > 0.5 ? '#1f2a44' : '#fff'; }
    function renderScheduleGrid() {
        var OT_THRESH=(typeof cfgNum==='function'?cfgNum('targets','ot_threshold_hrs',40):40);
        var OT_MULT=(typeof cfgNum==='function'?cfgNum('targets','ot_multiplier',1.5):1.5);
        var OT_NEAR=(typeof cfgNum==='function'?cfgNum('targets','ot_near_hrs',36):36);
        const ws = schedState.weekStart;
        const days = []; for (let i=0;i<7;i++) days.push(schedAddDays(ws,i));
        const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        const lbl = document.getElementById('schedWeekLabel');
        if (lbl) lbl.innerText = (ws.getMonth()+1)+'/'+ws.getDate()+' – '+(days[6].getMonth()+1)+'/'+days[6].getDate()+', '+ws.getFullYear();
        const shifts = schedState.data.shifts || [];
        const emps = schedState.data.employees || [];
        const wageOf = {}; emps.forEach(e => wageOf[e.id] = Number(e.hourly_wage)||0);
        const money = n => '$'+Math.round(n).toLocaleString();
        // cross-store + time-off maps
        const elseMap = {}; (schedState.elsewhere||[]).forEach(x => { const k=x.employee_id+'|'+x.shift_date; (elseMap[k]=elseMap[k]||[]).push(x); });
        const offMap = {}; (schedState.timeoff||[]).forEach(t => { days.forEach(d => { const ds=schedFmt(d); if(ds>=t.start_date && ds<=t.end_date){ offMap[t.employee_id+'|'+ds]=t.reason||'Time off'; } }); });
        const byKey = {}, dayHrs = {}, dayCost = {}, empHrs = {}, empRoleCount = {};
        shifts.forEach(s => {
            const k = s.employee_id + '|' + s.shift_date;
            (byKey[k] = byKey[k] || []).push(s);
            const h = schedShiftHours(s);
            dayHrs[s.shift_date] = (dayHrs[s.shift_date]||0) + h;
            if (s.employee_id != null) {
                empHrs[s.employee_id] = (empHrs[s.employee_id]||0) + h;
                dayCost[s.shift_date] = (dayCost[s.shift_date]||0) + h * (wageOf[s.employee_id]||0);
                const pr = schedPosById(s.position_id);
                if (pr) { if (!empRoleCount[s.employee_id]) empRoleCount[s.employee_id] = {}; empRoleCount[s.employee_id][pr.name] = (empRoleCount[s.employee_id][pr.name]||0) + 1; }
            }
        });
        const empRole = {};
        Object.keys(empRoleCount).forEach(eid => { let best='', n=-1; Object.keys(empRoleCount[eid]).forEach(r => { if (empRoleCount[eid][r] > n) { n = empRoleCount[eid][r]; best = r; } }); empRole[eid] = best; });
        let conflicts = 0;
        const chipHtml = (s, conflict) => {
            const p = schedPosById(s.position_id); const col = p ? p.color : '#6b7280';
            const txt = hbTextOn(col);
            const lblTxt = (p ? p.name : '') + (s.note ? (' · ' + s.note) : '');
            const empArg = (s.employee_id != null ? s.employee_id : 'null');
            return '<div class="sched-chip'+(conflict?' sched-chip-conflict':'')+'" data-shiftid="'+s.id+'" tabindex="0" role="button" style="background:'+col+';color:'+txt+';" onclick="event.stopPropagation();schedOpenModal('+empArg+",'"+s.shift_date+"',"+s.id+')">'+(s.start_time||'')+'-'+(s.end_time||'')+'<br>'+escapeHtml(lblTxt)+(conflict?' &#9888;':'')+(s.published?'':' *')+'</div>';
        };
        const hbTime = t => { if(!t) return ''; const p=String(t).split(':'); let h=+p[0]||0; const m=+p[1]||0; const ap=h<12?'a':'p'; let hh=h%12; if(hh===0) hh=12; return hh+(m?(':'+String(m).padStart(2,'0')):'')+ap; };
        const initialsOf = nm => { const parts=String(nm||'').trim().split(/\s+/); return ((parts[0]||'')[0]||'').toUpperCase()+((parts[1]||'')[0]||'').toUpperCase() || '?'; };
        const avatarColor = e => { const p=schedPosById(e.default_position_id); return (p && p.color) ? p.color : '#185FA5'; };
        const blockHtml = (s, conflict) => {
            const p = schedPosById(s.position_id); const col = p ? p.color : '#6b7280';
            const txt = hbTextOn(col);
            const role = (p ? p.name : 'Shift') + (s.note ? (' · ' + s.note) : '');
            const empArg = (s.employee_id != null ? s.employee_id : 'null');
            var sw = (typeof shiftWarnings==='function') ? shiftWarnings(s) : [];
            return '<div class="hbg-blk'+(conflict?' hbg-conf':'')+(sw.length?' avail-flag':'')+'" data-shiftid="'+s.id+'" tabindex="0" role="button" style="position:relative;background:'+col+';color:'+txt+';" onclick="event.stopPropagation();schedOpenModal('+empArg+",'"+s.shift_date+"',"+s.id+')">'+(sw.length?'<span class="avail-badge" title="'+escapeHtml(sw.join('; '))+'">&#9888;</span>':'')+hbTime(s.start_time)+'&ndash;'+hbTime(s.end_time)+(s.published?'':' *')+'<br>'+escapeHtml(role)+(conflict?' &#9888;':'')+'</div>';
        };
        const q = (document.getElementById('schedSearch') ? document.getElementById('schedSearch').value : '').toLowerCase().trim();
        let shownEmps = schedSortedEmps(emps);
        if (q) shownEmps = shownEmps.filter(e => (e.name||'').toLowerCase().indexOf(q) > -1);
        const custom = (schedState.sortMode === 'custom');
        const ssel = document.getElementById('schedSort'); if (ssel) ssel.value = schedState.sortMode || 'first';
        const elseEmpSet = {}, elseStoreSet = {};
        (schedState.elsewhere||[]).forEach(x => { elseEmpSet[x.employee_id]=1; if(x.location) elseStoreSet[x.location]=1; });
        const elseEmpN = Object.keys(elseEmpSet).length, elseStoreN = Object.keys(elseStoreSet).length;
        const photoOf = id => (schedState.photos||{})[id];
        const avatarHtml = e => { const ph=photoOf(e.id); return ph ? '<span class="hbg-av" style="background-image:url('+ph+');background-size:cover;background-position:center;"></span>' : '<span class="hbg-av" style="background:'+avatarColor(e)+';">'+initialsOf(e.name)+'</span>'; };
        const tagOf = e => { const list=(e.stores&&e.stores.length)?e.stores:(e.home_location?[e.home_location]:[]); return list.length?'<span class="hbg-tag">'+list.map(schedAbbr).join('&middot;')+'</span> ':''; };
        const dayStaff = {}; shifts.forEach(s => { if(s.employee_id!=null){ (dayStaff[s.shift_date]=dayStaff[s.shift_date]||{})[s.employee_id]=1; } });
        let weekHrs=0, weekCost=0;
        emps.forEach(e=>{ const eh=empHrs[e.id]||0; const reg=Math.min(eh,OT_THRESH),ot=Math.max(0,eh-OT_THRESH); weekCost+=reg*(wageOf[e.id]||0)+ot*(wageOf[e.id]||0)*OT_MULT; });
        days.forEach(d=>{ weekHrs += dayHrs[schedFmt(d)]||0; });
        const fc = schedState.forecast||{};
        var _tgt=schedLaborTarget(), _near=(typeof cfgNum==='function'?cfgNum('cc_config','cc_proj_near_pp',2):2);
        const mobile = window.innerWidth < 760;
        shownEmps.forEach(e=>{ days.forEach(d=>{ const ds=schedFmt(d); if((byKey[e.id+'|'+ds]||[]).length>0 && (elseMap[e.id+'|'+ds]||[]).length>0) conflicts++; }); });

        let html='';
        if (mobile) {
            const di = Math.max(0, Math.min(6, schedState.selectedDay||0));
            const dd = days[di], ds = schedFmt(dd);
            const longNames=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
            html += '<div class="sp-daypick">'+days.map((d,i)=>'<button class="'+(i===di?'on':'')+'" onclick="schedPickDay('+i+')">'+dayNames[i]+'<br><b>'+d.getDate()+'</b></button>').join('')+'</div>';
            html += '<div style="padding:7px 12px;font-size:12px;color:#5b6472;background:#f6f8fb;display:flex;justify-content:space-between;border-bottom:1px solid #eef1f5;"><span>'+longNames[di]+', '+(dd.getMonth()+1)+'/'+dd.getDate()+'</span><span>'+(dayStaff[ds]?Object.keys(dayStaff[ds]).length:0)+' scheduled &middot; '+(dayHrs[ds]||0).toFixed(1)+'h</span></div>';
            const oc = byKey['null|'+ds]||[];
            if(oc.length){ html += '<div class="sp-mrow" style="background:#faf7ff;"><div style="flex:1;font-weight:700;color:#5b3fb8;font-size:12px;">&#10753; Open shifts</div><div style="text-align:right;">'; oc.forEach(s=>{ html+=blockHtml(s,false); }); html+='</div></div>'; }
            if(!shownEmps.length) html += '<div style="text-align:center;padding:24px;color:#6b7686;font-size:13px;">'+(emps.length?'No team members match your search.':'No employees yet — add one from the menu.')+'</div>';
            shownEmps.forEach(e=>{
                const k=e.id+'|'+ds; const cell=byKey[k]||[]; const off=offMap[k]; const elsw=elseMap[k]||[]; const conflict=(cell.length>0&&elsw.length>0);
                let right='';
                if(off && !cell.length){ right='<div class="hbg-off">&#128197; Time-off &middot; '+escapeHtml(off)+'</div>'; }
                else { cell.forEach(s=>{ right+=blockHtml(s,conflict); }); elsw.forEach(x=>{ right+='<div class="hbg-loc">&#128205; '+escapeHtml(x.location)+' '+hbTime(x.start_time)+'</div>'; }); if(!cell.length&&!elsw.length) right='<button class="sp-addbtn" onclick="schedOpenModal('+e.id+",'"+ds+"',null)\">+ Add</button>"; }
                html += '<div class="sp-mrow" data-empid="'+e.id+'" oncontextmenu="schedCtx(event,'+e.id+",'"+ds+"',"+(cell[0]?cell[0].id:'null')+')">'+DRAG_GRIP+avatarHtml(e)+'<div style="flex:1;min-width:0;"><div class="hbg-nm">'+escapeHtml(e.name)+'</div><div class="hbg-sub">'+tagOf(e)+(empRole[e.id]?escapeHtml(empRole[e.id]):'')+'</div></div><div style="text-align:right;max-width:48%;">'+right+'</div></div>';
            });
            const pv=(ds in fc)?fc[ds]:'';
            var _mpct=(parseFloat(pv)||0)>0?((dayCost[ds]||0)/(parseFloat(pv)||0)*100):null;
            html += '<div class="sp-laborbar"><div><div class="lbl">'+dayNames[di]+' labor</div><b>'+money(dayCost[ds]||0)+'</b>'+(_mpct!=null?'<div style="font-size:10px;font-weight:700;color:'+schedPctCol(_mpct,_tgt,_near)+';">'+_mpct.toFixed(0)+'% labor</div>':'')+'</div><div style="text-align:center;"><div class="lbl">Predicted</div><input type="number" class="sp-pred" value="'+pv+'" placeholder="$" onchange="schedSetForecast(\''+ds+'\',this.value)"></div><div style="text-align:right;"><div class="lbl">Week</div><b>'+money(weekCost)+'</b></div></div>';
        } else {
            html += '<table class="hbg"><thead><tr><th class="hbg-e">Team member <span style="font-weight:400;color:#5b6675;font-size:10px;">(drag &#8942;&#8942; to reorder)</span></th>';
            days.forEach((d,i) => { html += '<th>'+dayNames[i]+'<br><span style="font-weight:400;color:#5b6675;">'+(d.getMonth()+1)+'/'+d.getDate()+'</span></th>'; });
            html += '<th>Hrs &middot; $</th></tr></thead><tbody>';
            let openN=0, openH=0; days.forEach(d=>{ const oc=byKey['null|'+schedFmt(d)]||[]; oc.forEach(s=>{ openN++; openH+=schedShiftHours(s); }); });
            html += '<tr class="hbg-band"><td class="hbg-e">&#10753; Open shifts ('+openN+') <span style="font-weight:400;color:#5b6675;">'+openH.toFixed(1)+'h</span></td>';
            days.forEach(d => { const ds=schedFmt(d); const oc=byKey['null|'+ds]||[]; html+='<td class="hbg-cell" data-emp="null" data-date="'+ds+'" onclick="schedOpenModal(null,\''+ds+'\',null)" oncontextmenu="schedCtx(event,null,\''+ds+'\','+(oc[0]?oc[0].id:'null')+')">'; oc.forEach(s=>{html+=blockHtml(s,false);}); if(!oc.length)html+='<div class="hbg-add">+</div>'; html+='</td>'; });
            html += '<td></td></tr>';
            html += '<tr class="hbg-band"><td class="hbg-e" colspan="9"><span style="color:#1f2a44;">Team members ('+emps.length+')</span>'+(elseEmpN?' &nbsp; <span style="font-weight:400;color:#5b6675;">&#128205; '+elseEmpN+' scheduled at '+elseStoreN+' other location'+(elseStoreN>1?'s':'')+'</span>':'')+'</td></tr>';
            if (!shownEmps.length) html += '<tr><td colspan="9" style="text-align:center;padding:20px;color:#6b7686;">'+(emps.length?'No team members match your search.':'No employees on this store yet. Use Tools &rarr; Add employee.')+'</td></tr>';
            shownEmps.forEach(e => {
                const eh = empHrs[e.id]||0; const reg=Math.min(eh,OT_THRESH), ot=Math.max(0,eh-OT_THRESH); const cost=reg*(wageOf[e.id]||0)+ot*(wageOf[e.id]||0)*OT_MULT;
                html += '<tr class="hbg-emprow" data-empid="'+e.id+'"><td class="hbg-e"><div style="display:flex;align-items:center;gap:6px;">'+DRAG_GRIP+avatarHtml(e)+'<div style="min-width:0;"><div class="hbg-nm">'+escapeHtml(e.name)+'</div><div class="hbg-sub">'+tagOf(e)+(empRole[e.id]?escapeHtml(empRole[e.id]):'')+'</div></div></div></td>';
                days.forEach(d => {
                    const ds=schedFmt(d); const k=e.id+'|'+ds; const cell=byKey[k]||[]; const off=offMap[k]; const elsw=elseMap[k]||[]; const conflict=(cell.length>0&&elsw.length>0);
                    if (off && !cell.length) {
                        html += '<td class="hbg-cell" data-emp="'+e.id+'" data-date="'+ds+'" oncontextmenu="schedCtx(event,'+e.id+",'"+ds+"',null)\"><div class=\"hbg-off\">&#128197; Time-off<br><small style=\"font-weight:400;\">"+escapeHtml(off)+'</small></div></td>';
                    } else {
                        html += '<td class="hbg-cell" data-emp="'+e.id+'" data-date="'+ds+'" onclick="schedOpenModal('+e.id+",'"+ds+"',null)\" oncontextmenu=\"schedCtx(event,"+e.id+",'"+ds+"',"+(cell[0]?cell[0].id:'null')+')">';
                        cell.forEach(s=>{html+=blockHtml(s,conflict);});
                        elsw.forEach(x=>{html+='<div class="hbg-loc">&#128205; '+escapeHtml(x.location)+'<br>'+hbTime(x.start_time)+'&ndash;'+hbTime(x.end_time)+'</div>';});
                        if(!cell.length&&!elsw.length)html+='<div class="hbg-add">+</div>';
                        html += '</td>';
                    }
                });
                var otCls = ot>0?' hbg-ot':(eh>=OT_NEAR?' hbg-near':'');
                html += '<td class="hbg-rowt'+otCls+'" title="'+(ot>0?'In overtime':(eh>=OT_NEAR?'Approaching 40h overtime':''))+'">'+eh.toFixed(1)+'h<br>'+money(cost)+(ot>0?'<br><span class="hbg-ot">'+ot.toFixed(1)+' OT</span>':(eh>=OT_NEAR?'<br><span class="hbg-near">near OT</span>':''))+'</td></tr>';
            });
            html += '</tbody><tfoot><tr><td class="hbg-e">Hours <span style="color:#185FA5;">'+weekHrs.toFixed(1)+'</span></td>';
            days.forEach(d => { const ds=schedFmt(d); const hh=dayHrs[ds]||0; const n=dayStaff[ds]?Object.keys(dayStaff[ds]).length:0; html += '<td>&#128100; '+n+'<br><span style="font-weight:400;font-size:10px;color:#7a828f;">'+hh.toFixed(1)+'h</span></td>'; });
            html += '<td></td></tr></tfoot></table>';
            html += '<div class="sp-laborbar wide"><div class="lbl" style="min-width:96px;">Labor / day<br><span style="font-weight:400;font-size:10px;color:#5b6675;">target <input type="number" value="'+_tgt+'" onchange="schedSetLaborTarget(this.value)" style="width:34px;padding:1px 3px;font-size:10px;">%</span></div>';
            var _weekPred=0;
            days.forEach((d,di2)=>{ const ds=schedFmt(d); const pv=(ds in fc)?fc[ds]:''; const cst=dayCost[ds]||0; const pred=parseFloat(pv)||0; _weekPred+=pred; const pct=pred>0?(cst/pred*100):null; const ph=(pct!=null)?'<div style="font-size:10px;font-weight:700;color:'+schedPctCol(pct,_tgt,_near)+';" title="'+((pct-_tgt)>=0?'+':'')+(pct-_tgt).toFixed(1)+' pts vs '+_tgt+'% target">'+pct.toFixed(0)+'% labor</div>':''; html += '<div class="lcell"><div class="lbl">'+dayNames[di2]+' &middot; '+money(cst)+'</div><input type="number" class="sp-pred" value="'+pv+'" placeholder="pred" onchange="schedSetForecast(\''+ds+'\',this.value)">'+ph+'</div>'; });
            var _wpct=_weekPred>0?(weekCost/_weekPred*100):null;
            html += '<div style="text-align:right;min-width:78px;"><div class="lbl">Week</div><b>'+money(weekCost)+'</b>'+(_wpct!=null?'<div style="font-size:10px;font-weight:700;color:'+schedPctCol(_wpct,_tgt,_near)+';" title="week labor vs '+_tgt+'% target">'+_wpct.toFixed(0)+'%</div>':'')+'</div></div>';
        }
        const pb = document.getElementById('schedPublishBtn');
        if (conflicts>0) {
            html = '<div class="sp-banner">&#9888; '+conflicts+' double-book'+(conflicts>1?'s':'')+' across stores — resolve before publishing.</div>' + html;
            if (pb){ pb.disabled=true; pb.style.opacity=.5; pb.style.cursor='not-allowed'; pb.title='Resolve cross-store conflicts to publish'; }
        } else if (pb){ pb.disabled=false; pb.style.opacity=1; pb.style.cursor='pointer'; pb.title=''; }
        document.getElementById('schedGrid').innerHTML = html;
        schedInitDragReorder();
        if(typeof schedInitShiftDrag==='function') schedInitShiftDrag();
    }
    function schedPickDay(i){ schedState.selectedDay=i; renderScheduleGrid(); }
    function schedCloseCtx(){ var m=document.getElementById('schedCtxMenu'); if(m) m.remove(); }
    function schedCtx(ev, empId, ds, shiftId){
        ev.preventDefault(); ev.stopPropagation(); schedCloseCtx();
        var m=document.createElement('div'); m.id='schedCtxMenu'; m.className='sched-ctx';
        var items='';
        if(shiftId && shiftId!=='null') items += '<button onclick="schedCopyShift('+shiftId+')">&#128203; Copy shift</button>';
        if(schedState.clip) items += '<button style="color:#185FA5;" onclick="schedPasteShift('+(empId==null?'null':empId)+',\''+ds+'\')">&#128229; Paste here</button>';
        if(shiftId && shiftId!=='null') items += '<button onclick="schedOpenModal('+(empId==null?'null':empId)+',\''+ds+'\','+shiftId+')">&#9999;&#65039; Edit</button>';
        if(shiftId && shiftId!=='null') items += '<button style="color:#c0392b;" onclick="schedClearShift('+shiftId+')">&#128465;&#65039; Clear</button>';
        if(!items) items='<button disabled style="color:#6b7686;">Right-click a shift to copy it</button>';
        m.innerHTML=items; document.body.appendChild(m);
        var x=Math.min(ev.clientX||ev.pageX||100, window.innerWidth-172), y=Math.min(ev.clientY||ev.pageY||100, window.innerHeight-170);
        m.style.left=x+'px'; m.style.top=y+'px';
    }
    function schedCopyShift(id){ var s=(schedState.data.shifts||[]).find(x=>x.id===id); if(s){ schedState.clip={start_time:s.start_time,end_time:s.end_time,position_id:s.position_id,note:s.note}; } schedCloseCtx(); }
    function schedPasteShift(empId, ds){ var c=schedState.clip; if(!c) return; schedCloseCtx(); withPin(function(pin){ supabaseClient.rpc('app_sched_upsert_shift',{p_username:currentUser.username,p_password:pin,p_id:null,p_location:schedState.location,p_shift_date:ds,p_employee_id:empId,p_position_id:c.position_id||null,p_start:c.start_time,p_end:c.end_time,p_note:c.note||null}).then(function(r){ if(r.error){alert('Error: '+r.error.message);return;} fetchScheduleWeek(); }); }); }
    function schedClearShift(id){ schedCloseCtx(); var s=(schedState.data.shifts||[]).find(function(x){return x.id===id;}); withPin(function(pin){ supabaseClient.rpc('app_sched_delete_shift',{p_username:currentUser.username,p_password:pin,p_id:id}).then(function(r){ if(r.error){alert('Error: '+r.error.message);return;} fetchScheduleWeek(); if(s) showUndo('Shift cleared.', function(){ schedRecreateShift(s); }); }); }); }
    document.addEventListener('click', schedCloseCtx);
    window.addEventListener('resize', function(){ var v=document.getElementById('scheduleBuilderView'); if(v && v.style.display==='block' && schedState.mode==='mgr'){ clearTimeout(schedState._rt); schedState._rt=setTimeout(renderScheduleGrid, 200); } });
    function fetchMyShifts() {
        const grid = document.getElementById('schedGrid');
        grid.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">Loading&hellip;</p>';
        const ws = schedFmt(schedState.weekStart);
        withPin(function(pin){
            supabaseClient.rpc('app_my_week_shifts', { p_username: currentUser.username, p_password: pin, p_week_start: ws })
            .then(({ data, error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if (error) { grid.innerHTML = '<p style="color:red;text-align:center;padding:20px;">Error: ' + error.message + '</p>'; return; }
                schedState.mine = data || { shifts: [], time_off: [] };
                renderMyShifts();
            }).catch(() => { grid.innerHTML = '<p style="color:red;text-align:center;">Connection error.</p>'; });
        }, function(){ grid.innerHTML = '<p style="text-align:center;padding:20px;color:#6b7686;">PIN required.</p>'; });
    }
    function renderMyShifts() {
        const ws = schedState.weekStart;
        const days = []; for (let i=0;i<7;i++) days.push(schedAddDays(ws,i));
        const dayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
        const lbl = document.getElementById('schedWeekLabel');
        if (lbl) lbl.innerText = (ws.getMonth()+1)+'/'+ws.getDate()+' – '+(days[6].getMonth()+1)+'/'+days[6].getDate()+', '+ws.getFullYear();
        const hbTime = t => { if(!t) return ''; const p=String(t).split(':'); let h=+p[0]||0; const m=+p[1]||0; const ap=h<12?'a':'p'; let hh=h%12; if(hh===0) hh=12; return hh+(m?(':'+String(m).padStart(2,'0')):'')+ap; };
        const mine = schedState.mine || { shifts: [], time_off: [] };
        const byDay = {}; (mine.shifts||[]).forEach(s => { (byDay[s.shift_date]=byDay[s.shift_date]||[]).push(s); });
        const offMap = {}; (mine.time_off||[]).forEach(t => { days.forEach(d => { const ds=schedFmt(d); if(ds>=t.start_date && ds<=t.end_date) offMap[ds]=t.reason||'Time off'; }); });
        let total = 0;
        let html = '<div style="padding:14px;max-width:640px;margin:0 auto;">';
        html += '<h2 style="margin:4px 0 12px;font-size:18px;color:#1f2a44;">My shifts</h2>';
        days.forEach((d,i) => {
            const ds = schedFmt(d); const list = byDay[ds] || []; const off = offMap[ds];
            html += '<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #eef1f5;">';
            html += '<div style="width:104px;flex:none;"><div style="font-weight:700;color:#1f2a44;font-size:13px;">'+dayNames[i]+'</div><div style="font-size:11px;color:#5b6675;">'+(d.getMonth()+1)+'/'+d.getDate()+'</div></div>';
            html += '<div style="flex:1;min-width:0;">';
            if (off && !list.length) { html += '<div class="hbg-off" style="display:inline-block;">&#128197; Time off &middot; '+escapeHtml(off)+'</div>'; }
            else if (!list.length) { html += '<div style="color:#b3bcc7;font-size:13px;">Off</div>'; }
            else { list.forEach(s => { const col=s.color||'#185FA5'; const h=((function(x){if(!x.start_time||!x.end_time)return 0;const a=x.start_time.split(":").map(Number),b=x.end_time.split(":").map(Number);let hh=(b[0]*60+b[1]-(a[0]*60+a[1]))/60;if(hh<0)hh+=24;return hh;})(s)); total+=h;
                html += '<div style="background:'+col+';color:'+hbTextOn(col)+';border-radius:7px;padding:7px 10px;margin-bottom:5px;font-size:13px;"><b>'+hbTime(s.start_time)+'&ndash;'+hbTime(s.end_time)+'</b> &middot; '+escapeHtml(s.position_name||'Shift')+' <span style="opacity:.85;">@ '+escapeHtml(s.location||'')+'</span></div>'; }); }
            html += '</div></div>';
        });
        html += '<div class="sp-weekbar" style="margin-top:14px;border-radius:10px;"><span>This week</span><span><b>'+total.toFixed(1)+' hrs</b> scheduled</span></div>';
        html += '<div id="weekConfirmBar" style="margin-top:10px;"></div>';
        html += '<p style="font-size:12px;color:#5b6675;margin-top:10px;">Only published shifts are shown &mdash; if your week looks empty, your manager may not have posted it yet. Need a day off? Use <b>Request time off</b> in the menu.</p></div>';
        document.getElementById('schedGrid').innerHTML = html;
        loadWeekConfirm(schedFmt(schedState.weekStart), (mine.shifts||[]).length>0);
    }
    function loadWeekConfirm(ws, hasShifts){
        var box=document.getElementById('weekConfirmBar'); if(!box) return;
        if(!hasShifts){ box.innerHTML=''; return; }
        withPin(function(pin){
            supabaseClient.rpc('app_week_confirm_status',{p_username:currentUser.username,p_password:pin,p_week_start:ws}).then(function(r){
                if(r.error||!r.data||!r.data.linked){ box.innerHTML=''; return; }
                if(r.data.confirmed){
                    var when=r.data.confirmed_at?(' on '+String(r.data.confirmed_at).slice(0,10)):'';
                    box.innerHTML='<div style="background:#e8f5ec;border:1px solid #b8e0c4;color:#1b7a3d;border-radius:10px;padding:10px 12px;text-align:center;font-size:13px;font-weight:700;">&#9989; You confirmed this schedule'+when+'</div>';
                } else {
                    box.innerHTML='<button onclick="confirmWeek(\''+ws+'\')" style="width:100%;background:var(--pass-green,#1f7a3d);color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:800;cursor:pointer;">&#9989; Confirm my schedule</button><div style="font-size:11.5px;color:#5b6675;text-align:center;margin-top:5px;">Lets your manager know you have seen this week.</div><button onclick="schedFlagConflict()" style="width:100%;background:none;border:none;color:#b08600;font-size:12.5px;text-decoration:underline;cursor:pointer;margin-top:9px;padding:4px;">Something is wrong with my schedule</button>';
                }
            }).catch(function(){ box.innerHTML=''; });
        });
    }
    function closeWeekConfirms(){ var ov=document.getElementById('weekConfirmsModal'); if(ov) ov.style.display='none'; }
    function openWeekConfirms(){
        var ws=schedFmt(schedState.weekStart); var loc=schedState.location||'';
        var ov=document.getElementById('weekConfirmsModal');
        if(!ov){ ov=document.createElement('div'); ov.id='weekConfirmsModal'; ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px;'; ov.addEventListener('click',function(e){ if(e.target===ov) ov.style.display='none'; }); document.body.appendChild(ov); }
        ov.style.display='flex';
        ov.innerHTML='<div style="background:var(--surface,#fff);border-radius:14px;max-width:460px;width:100%;max-height:85vh;overflow:auto;padding:18px;box-shadow:0 10px 40px rgba(0,0,0,.2);">'+
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><b style="flex:1;font-size:16px;color:var(--txt,#26242b);">Schedule confirmations</b><button onclick="closeWeekConfirms()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;line-height:1;">&times;</button></div>'+
          '<div style="font-size:12.5px;color:var(--txt2,#8a8594);margin-bottom:10px;">Week of '+escapeHtml(ws)+(loc?(' &middot; '+escapeHtml(loc)):'')+'</div>'+
          '<div id="weekConfirmsBody"><p style="text-align:center;color:#6b7686;padding:20px;">Loading&hellip;</p></div></div>';
        withPin(function(pin){
          supabaseClient.rpc('app_week_confirm_roster',{p_username:currentUser.username,p_password:pin,p_location:loc,p_week_start:ws}).then(function(r){
            var body=document.getElementById('weekConfirmsBody'); if(!body) return;
            if(r.error){ body.innerHTML='<p style="color:#c0264b;text-align:center;">'+escapeHtml(r.error.message)+'</p>'; return; }
            var list=r.data||[]; if(!list.length){ body.innerHTML='<p style="color:#6b7686;text-align:center;padding:16px;">No active staff for this store.</p>'; return; }
            var done=list.filter(function(x){return x.confirmed;}).length;
            var h='<div style="font-size:12.5px;font-weight:700;color:var(--txt,#26242b);margin-bottom:8px;">'+done+' of '+list.length+' confirmed</div>';
            list.forEach(function(x){
              h+='<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--bd,#f0eef4);">'+
                 '<span style="flex:1;font-size:14px;color:var(--txt,#26242b);">'+escapeHtml(x.name||'')+'</span>'+
                 (x.confirmed?'<span style="color:#1b7a3d;font-weight:700;font-size:12.5px;">&#9989; '+escapeHtml(x.confirmed_at?String(x.confirmed_at).slice(0,10):'confirmed')+'</span>':'<span style="color:#b08600;font-weight:700;font-size:12.5px;">&#8230; waiting</span>')+
                 '</div>';
            });
            body.innerHTML=h;
          }).catch(function(){ var body=document.getElementById('weekConfirmsBody'); if(body) body.innerHTML='<p style="color:#c0264b;text-align:center;">Could not load.</p>'; });
        });
    }
    function confirmWeek(ws){
        var box=document.getElementById('weekConfirmBar'); if(box) box.innerHTML='<div style="text-align:center;color:#5b6675;font-size:13px;padding:6px;">Saving&hellip;</div>';
        withPin(function(pin){
            supabaseClient.rpc('app_week_confirm',{p_username:currentUser.username,p_password:pin,p_week_start:ws}).then(function(r){
                if(r.error){ if(box) box.innerHTML='<div style="color:#c0264b;text-align:center;font-size:13px;">'+escapeHtml(r.error.message)+'</div>'; return; }
                loadWeekConfirm(ws, true);
            }).catch(function(){ if(box) box.innerHTML='<div style="color:#c0264b;text-align:center;font-size:13px;">Could not save.</div>'; });
        });
    }

    function schedOpenModal(empId, date, shiftId) {
        schedState.editing = { employeeId: empId, date: date, shiftId: shiftId };
        const posSel = document.getElementById('shiftPosition');
        posSel.innerHTML = '<option value="">&mdash; position &mdash;</option>' + (schedState.data.positions||[]).map(p => '<option value="'+p.id+'">'+escapeHtml(p.name)+'</option>').join('');
        var empSel=document.getElementById('shiftEmployee'); if(empSel){ var _curE = (typeof shiftId!=='undefined' && shiftId && (schedState.data.shifts||[]).find(x=>x.id===shiftId)) ? (schedState.data.shifts||[]).find(x=>x.id===shiftId).employee_id : empId; empSel.innerHTML='<option value="">&mdash; Open shift (no one yet) &mdash;</option>'+(schedState.data.employees||[]).map(function(e){return '<option value="'+e.id+'">'+escapeHtml(e.name||('#'+e.id))+'</option>';}).join(''); empSel.value=(_curE!=null&&_curE!=='')?String(_curE):''; }
        let s = shiftId ? (schedState.data.shifts||[]).find(x => x.id === shiftId) : null;
        document.getElementById('shiftModalTitle').innerText = shiftId ? 'Edit Shift' : (empId == null ? 'Add Open Shift' : 'Add Shift');
        document.getElementById('shiftStart').value = s ? (s.start_time||'') : '';
        document.getElementById('shiftEnd').value = s ? (s.end_time||'') : '';
        document.getElementById('shiftNote').value = s ? (s.note||'') : '';
        posSel.value = (s && s.position_id) ? String(s.position_id) : '';
        document.getElementById('shiftDeleteBtn').style.display = shiftId ? 'block' : 'none';
        var _rw=document.getElementById('shiftRepeatWrap'); if(_rw) _rw.style.display = shiftId ? 'none' : 'block';
        var _rs=document.getElementById('shiftRepeat'); if(_rs) _rs.value='0';
        document.getElementById('shiftModal').style.display = 'flex';
        schedValidateShift();
        schedShowAvailBadge(empId, date);
    }
    function schedShowAvailBadge(empId, date){
        var am=document.getElementById('shiftAvailMsg'); if(!am) return; am.style.display='none';
        if(empId!=null && (schedState.avail||{})){ var days=(schedState.avail||{})[empId]||(schedState.avail||{})[String(empId)];
            if(days&&days.length){ var dd=days[availDowOf(date)]; if(dd){ am.style.display='block';
                if(dd.mode==='off'){ am.style.background='#fdeaea'; am.style.color='#c0264b'; am.innerHTML='&#9888; Marked <b>unavailable</b> this day'; }
                else if(dd.mode==='window'){ am.style.background='#eef3fb'; am.style.color='#185FA5'; am.innerHTML='&#128337; Available '+availFmt(dd.from)+'&ndash;'+availFmt(dd.to)+' this day'; }
                else { am.style.background='#e7f6ec'; am.style.color='#1f7a3d'; am.innerHTML='&#10003; Available all day'; }
            } }
        }
    }
    function schedModalEmpChanged(){
        var sel=document.getElementById('shiftEmployee'); if(!sel||!schedState.editing) return;
        var v = sel.value!=='' ? parseInt(sel.value,10) : null;
        schedState.editing.employeeId=v;
        schedShowAvailBadge(v, schedState.editing.date);
        if(typeof schedShiftComplianceMsg==='function') schedShiftComplianceMsg();
    }
    function schedCloseModal(){ document.getElementById('shiftModal').style.display = 'none'; }

    function schedSaveShift() {
        const ed = schedState.editing;
        const pos = document.getElementById('shiftPosition').value;
        const st = document.getElementById('shiftStart').value;
        const en = document.getElementById('shiftEnd').value;
        const note = document.getElementById('shiftNote').value;
        if (!st || !en) { alert('Please enter start and end times.'); return; }
        var _empSel=document.getElementById('shiftEmployee'); if(_empSel){ ed.employeeId = _empSel.value!=='' ? parseInt(_empSel.value,10) : null; }
        var repeat = (!ed.shiftId) ? (parseInt((document.getElementById('shiftRepeat')||{}).value,10)||0) : 0;
        withPin(function(pin){
            supabaseClient.rpc('app_sched_upsert_shift', { p_username: currentUser.username, p_password: pin, p_id: ed.shiftId, p_location: schedState.location, p_shift_date: ed.date, p_employee_id: ed.employeeId, p_position_id: pos ? parseInt(pos,10) : null, p_start: st, p_end: en, p_note: note })
            .then(({ error }) => { if (error) { alert('Error: ' + error.message); return; }
                if(repeat>0){ for(var i=1;i<=repeat;i++){ var nd=schedFmt(schedAddDays(new Date(ed.date+'T00:00:00'), 7*i)); supabaseClient.rpc('app_sched_upsert_shift', { p_username: currentUser.username, p_password: pin, p_id:null, p_location: schedState.location, p_shift_date: nd, p_employee_id: ed.employeeId, p_position_id: pos ? parseInt(pos,10) : null, p_start: st, p_end: en, p_note: note }).then(function(){}); } }
                schedCloseModal(); fetchScheduleWeek();
            });
        });
    }
    function schedDeleteShift() {
        const id = schedState.editing.shiftId; if (!id) return;
        const s = (schedState.data.shifts||[]).find(x => x.id === id);
        withPin(function(pin){
            supabaseClient.rpc('app_sched_delete_shift', { p_username: currentUser.username, p_password: pin, p_id: id })
            .then(({ error }) => { if (error) { alert('Error: ' + error.message); return; } schedCloseModal(); fetchScheduleWeek(); if(s) showUndo('Shift deleted.', function(){ schedRecreateShift(s); }); });
        });
    }
    // ---- Undo toast + shift move/copy/validate (Phase 1 ergonomics) ----
    function showUndo(msg, undoFn){
        var t=document.getElementById('undoToast');
        if(!t){ t=document.createElement('div'); t.id='undoToast'; t.style.cssText='position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#1f2a44;color:#fff;border-radius:10px;padding:11px 16px;font-size:14px;z-index:4500;display:flex;align-items:center;gap:14px;box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:92vw;'; document.body.appendChild(t); }
        t.innerHTML='';
        var span=document.createElement('span'); span.textContent=msg; t.appendChild(span);
        if(undoFn){ var b=document.createElement('button'); b.textContent='Undo'; b.style.cssText='background:transparent;border:1px solid #fff;color:#fff;border-radius:7px;padding:4px 13px;font-size:13px;cursor:pointer;font-weight:700;'; b.onclick=function(){ clearTimeout(window._undoTimer); t.style.display='none'; undoFn(); }; t.appendChild(b); }
        t.style.display='flex';
        clearTimeout(window._undoTimer); window._undoTimer=setTimeout(function(){ if(t) t.style.display='none'; }, 6500);
    }
    function schedRecreateShift(s){ withPin(function(pin){ supabaseClient.rpc('app_sched_upsert_shift',{p_username:currentUser.username,p_password:pin,p_id:null,p_location:schedState.location,p_shift_date:s.shift_date,p_employee_id:s.employee_id,p_position_id:s.position_id||null,p_start:s.start_time,p_end:s.end_time,p_note:s.note||null}).then(function(){ fetchScheduleWeek(); }); }); }
    function schedMoveShiftTo(shiftId, newEmpId, newDate, copy){
        var s=(schedState.data.shifts||[]).find(function(x){return x.id===shiftId;}); if(!s) return;
        var origEmp=s.employee_id, origDate=s.shift_date;
        withPin(function(pin){
            supabaseClient.rpc('app_sched_upsert_shift',{ p_username:currentUser.username, p_password:pin, p_id:(copy?null:shiftId), p_location:schedState.location, p_shift_date:newDate, p_employee_id:newEmpId, p_position_id:s.position_id||null, p_start:s.start_time, p_end:s.end_time, p_note:s.note||null })
            .then(function(r){ if(r.error){ alert('Error: '+r.error.message); return; }
                fetchScheduleWeek();
                if(copy){ var nid=r.data&&(r.data.id||(Array.isArray(r.data)?(r.data[0]&&r.data[0].id):null)); showUndo('Shift copied.', nid?function(){ schedClearShift(nid); }:null); }
                else { showUndo('Shift moved.', function(){ schedMoveShiftTo(shiftId, origEmp, origDate, false); }); }
            });
        });
    }
    function schedShiftComplianceMsg(){
        var m=document.getElementById('shiftCompMsg'); if(!m) return;
        var ed=schedState.editing||{}; if(ed.employeeId==null || typeof complianceCheck!=='function'){ m.style.display='none'; return; }
        var st=(document.getElementById('shiftStart')||{}).value, en=(document.getElementById('shiftEnd')||{}).value;
        var pos=(document.getElementById('shiftPosition')||{}).value;
        var w=complianceCheck(ed.employeeId, ed.date, st, en, pos?parseInt(pos,10):null);
        if(!w.length){ m.style.display='none'; return; }
        m.style.display='block'; m.innerHTML='&#9888; '+w.map(escapeHtml).join('<br>&#9888; ');
    }
    function schedValidateShift(){
        var st=(document.getElementById('shiftStart')||{}).value, en=(document.getElementById('shiftEnd')||{}).value;
        if(typeof schedShiftComplianceMsg==='function') schedShiftComplianceMsg();
        var m=document.getElementById('shiftValMsg'); if(!m) return;
        if(!st||!en){ m.style.display='none'; return; }
        var a=st.split(':').map(Number), b=en.split(':').map(Number);
        var mins=(b[0]*60+b[1])-(a[0]*60+a[1]); var overnight=false;
        if(mins<=0){ mins+=24*60; overnight=true; }
        m.style.display='block';
        if(overnight){ m.style.color='#854F0B'; m.innerHTML='&#9203; Ends before it starts &mdash; reads as an overnight shift ('+(mins/60).toFixed(1)+'h). Fix the times if that’s not intended.'; }
        else { m.style.color='#1f7a3d'; m.innerHTML='&#10003; '+(mins/60).toFixed(1)+'h shift'; }
    }
    // Drag a shift block to another cell to MOVE it (hold Ctrl/Cmd to COPY) — mouse only.
    (function(){
        var startX=0,startY=0,shiftId=null,dragging=false,ghost=null,pending=false,capId=null;
        function gridEl(){ return document.getElementById('schedGrid'); }
        function onDown(e){
            if(e.pointerType && e.pointerType!=='mouse') return;
            var blk=e.target.closest ? e.target.closest('[data-shiftid]') : null; if(!blk) return;
            shiftId=parseInt(blk.getAttribute('data-shiftid'),10); if(isNaN(shiftId)){ shiftId=null; return; }
            startX=e.clientX; startY=e.clientY; pending=true; dragging=false;
        }
        function onMove(e){
            if(!pending) return;
            if(!dragging){ if(Math.abs(e.clientX-startX)<6 && Math.abs(e.clientY-startY)<6) return;
                dragging=true; document.body.style.userSelect='none';
                try{ capId=e.pointerId; gridEl().setPointerCapture(capId); }catch(_){}
                ghost=document.createElement('div'); ghost.style.cssText='position:fixed;z-index:5000;pointer-events:none;background:#185FA5;color:#fff;font-size:12px;font-weight:700;padding:5px 10px;border-radius:7px;box-shadow:0 4px 12px rgba(0,0,0,.3);'; document.body.appendChild(ghost);
            }
            e.preventDefault();
            if(ghost){ ghost.style.left=(e.clientX+12)+'px'; ghost.style.top=(e.clientY+12)+'px'; ghost.textContent=(e.ctrlKey||e.metaKey)?'Copy shift here':'Move shift here'; }
        }
        function onUp(e){
            if(!pending) return; pending=false;
            try{ if(capId!=null) gridEl().releasePointerCapture(capId); }catch(_){}
            capId=null;
            if(!dragging){ return; }
            dragging=false; document.body.style.userSelect='';
            if(ghost){ ghost.remove(); ghost=null; }
            window._schedDragJustHappened=true; setTimeout(function(){ window._schedDragJustHappened=false; }, 60);
            var tgt=document.elementFromPoint(e.clientX,e.clientY);
            var cell=tgt && tgt.closest ? tgt.closest('[data-date]') : null; if(!cell) return;
            var ds=cell.getAttribute('data-date'); var empRaw=cell.getAttribute('data-emp');
            var emp=(empRaw==='null'||empRaw==null||empRaw==='')?null:parseInt(empRaw,10);
            var s=(schedState.data.shifts||[]).find(function(x){return x.id===shiftId;}); if(!s) return;
            if(s.employee_id===emp && s.shift_date===ds) return;
            schedMoveShiftTo(shiftId, emp, ds, (e.ctrlKey||e.metaKey));
        }
        window.schedInitShiftDrag=function(){
            var g=gridEl(); if(!g||g.getAttribute('data-shiftdrag')) return; g.setAttribute('data-shiftdrag','1');
            g.addEventListener('pointerdown', onDown);
            g.addEventListener('pointermove', onMove);
            g.addEventListener('pointerup', onUp);
            g.addEventListener('pointercancel', onUp);
            g.addEventListener('click', function(e){ if(window._schedDragJustHappened){ e.preventDefault(); e.stopPropagation(); } }, true);
        };
    })();
    function schedDayName(ds){ var dn=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; return dn[availDowOf(ds)]+' '+String(ds).slice(5); }
    function schedPublish() {
        var conflicts=[];
        (schedState.data.shifts||[]).forEach(function(s){ if(s.employee_id!=null){ var w=(typeof shiftWarnings==='function')?shiftWarnings(s):[]; if(w.length){ var e=(schedState.data.employees||[]).find(function(x){return x.id===s.employee_id;}); conflicts.push({s:s,name:e?e.name:'Employee',why:w.join('; ')}); } } });
        if(conflicts.length){ schedShowPublishGate(conflicts); return; }
        schedDoPublish();
    }
    function schedDoPublish(){
        if (!confirm('Publish this week’s schedule for ' + schedState.location + '? Staff with shifts will be notified.')) return;
        const ws = schedFmt(schedState.weekStart);
        withPin(function(pin){
            supabaseClient.rpc('app_sched_publish_week', { p_username: currentUser.username, p_password: pin, p_location: schedState.location, p_week_start: ws })
            .then(({ data, error }) => { if (error) { alert('Error: ' + error.message); return; } alert('Published ' + (data||0) + ' shift(s) for ' + schedState.location + '.'); fetchScheduleWeek(); });
        });
    }
    function schedShowPublishGate(conflicts){
        function isHard(why){ return /minor:|expired/i.test(why||''); }
        var hard=conflicts.filter(function(c){return isHard(c.why);});
        var soft=conflicts.filter(function(c){return !isHard(c.why);});
        window._pubHard=hard; window._pubSoft=soft;
        function row(c,col){ return '<div style="font-size:12.5px;color:'+col+';padding:3px 0;"><b>'+escapeHtml(c.name)+'</b> · '+escapeHtml(schedDayName(c.s.shift_date))+' '+escapeHtml((c.s.start_time||'')+'-'+(c.s.end_time||''))+' · '+escapeHtml(c.why)+'</div>'; }
        var h='';
        if(hard.length){ h+='<div style="background:#fdeaea;border:1px solid #f3c2cb;border-radius:10px;padding:10px 12px;margin-bottom:10px;"><div style="font-weight:800;color:#a01b3e;font-size:13px;margin-bottom:6px;">&#9940; Must be fixed before publishing</div>'+hard.map(function(c){return row(c,'#7a1f33');}).join('')+'<div style="font-size:11.5px;color:#a01b3e;margin-top:6px;">These are legal or food-safety limits and cannot be overridden. Fix the shifts, then publish.</div></div>'; }
        if(soft.length){ h+='<div style="background:#fff8ec;border:1px solid #f1d9a8;border-radius:10px;padding:10px 12px;margin-bottom:10px;"><div style="font-weight:800;color:#854F0B;font-size:13px;margin-bottom:6px;">&#9888;&#65039; Warnings &mdash; you can override with a reason</div>'+soft.map(function(c){return row(c,'#6b5320');}).join('')+'<label style="display:block;font-size:12px;color:#6b5320;margin-top:8px;">Reason for overriding (required &mdash; saved for the record)</label><textarea id="pubGateReason" oninput="schedPubReasonInput()" rows="2" style="width:100%;padding:8px;border:1px solid #e0c896;border-radius:8px;box-sizing:border-box;font-size:13px;"></textarea></div>'; }
        document.getElementById('pubGateList').innerHTML=h;
        var cnt=document.getElementById('pubGateCount'); if(cnt) cnt.textContent=conflicts.length;
        var gb=document.getElementById('pubGateBtn');
        if(hard.length){ gb.disabled=true; gb.style.opacity=.5; gb.textContent='Fix '+hard.length+' to publish'; }
        else if(soft.length){ gb.disabled=true; gb.style.opacity=.5; gb.textContent='Enter a reason to publish'; }
        else { gb.disabled=false; gb.style.opacity=1; gb.textContent='Publish'; }
        document.getElementById('pubGateModal').style.display='flex';
    }
    function schedPubReasonInput(){
        var gb=document.getElementById('pubGateBtn'); if(!gb) return;
        if((window._pubHard||[]).length) return;
        var r=((document.getElementById('pubGateReason')||{}).value||'').trim();
        if(r.length>=4){ gb.disabled=false; gb.style.opacity=1; gb.textContent='Override & publish'; }
        else { gb.disabled=true; gb.style.opacity=.5; gb.textContent='Enter a reason to publish'; }
    }
    function schedClosePubGate(){ document.getElementById('pubGateModal').style.display='none'; }
    function schedPubGatePublish(){
        if((window._pubHard||[]).length) return;
        var soft=window._pubSoft||[];
        if(soft.length){
            var reason=((document.getElementById('pubGateReason')||{}).value||'').trim(); if(reason.length<4) return;
            var summary=soft.map(function(c){return c.name+': '+c.why;}).join(' | ');
            withPin(function(pin){
                supabaseClient.rpc('app_sched_log_override',{p_username:currentUser.username,p_password:pin,p_location:schedState.location,p_week_start:schedFmt(schedState.weekStart),p_reason:reason,p_summary:summary}).then(function(){ schedClosePubGate(); schedDoPublish(); }).catch(function(){ schedClosePubGate(); schedDoPublish(); });
            });
        } else { schedClosePubGate(); schedDoPublish(); }
    }
    function schedCopyLastWeek() {
        const to = schedFmt(schedState.weekStart); const from = schedFmt(schedAddDays(schedState.weekStart,-7));
        if (!confirm("Copy last week's shifts into this week?")) return;
        withPin(function(pin){
            supabaseClient.rpc('app_sched_copy_week', { p_username: currentUser.username, p_password: pin, p_location: schedState.location, p_from_week: from, p_to_week: to })
            .then(({ data, error }) => { if (error) { alert('Error: ' + error.message); return; } alert('Copied ' + (data||0) + ' shift(s) into this week.'); fetchScheduleWeek(); });
        });
    }
    /* ===== Scheduler: named templates ===== */
    function openSchedTemplates(){
        document.getElementById('schedTplName').value='';
        document.getElementById('schedTplMsg').textContent='';
        document.getElementById('schedTplList').innerHTML='<p style="color:#6b6275;font-size:13px;">Loading&hellip;</p>';
        document.getElementById('schedTplModal').style.display='flex';
        withPin(function(pin){
            supabaseClient.rpc('app_template_list',{p_username:currentUser.username,p_password:pin,p_location:schedState.location}).then(function(r){
                if(r.error){ document.getElementById('schedTplList').innerHTML='<p style="color:#c0264b;font-size:13px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                window._schedTpls=r.data||[]; renderSchedTemplates();
            }).catch(function(){ document.getElementById('schedTplList').innerHTML='<p style="color:#c0264b;font-size:13px;">Could not load.</p>'; });
        });
    }
    function closeSchedTemplates(){ document.getElementById('schedTplModal').style.display='none'; }
    function renderSchedTemplates(){
        var box=document.getElementById('schedTplList'); var list=window._schedTpls||[];
        if(!list.length){ box.innerHTML='<p style="color:#6b6275;font-size:13px;">No templates yet. Save this week below.</p>'; return; }
        box.innerHTML=list.map(function(t,i){
            return '<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid #f0eef4;">'+
                '<div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:13.5px;color:#26242b;">'+escapeHtml(t.name||'')+'</div>'+
                '<div style="font-size:12px;color:#6b6275;">'+(t.shifts||0)+' shift'+((t.shifts===1)?'':'s')+(t.location?(' &middot; '+escapeHtml(t.location)):' &middot; all stores')+'</div></div>'+
                '<button onclick="applySchedTemplate('+i+')" style="background:#e8f5ec;color:#1b7a3d;border:none;border-radius:8px;padding:6px 11px;font-size:12.5px;font-weight:700;cursor:pointer;">Load</button>'+
                '<button onclick="renameSchedTemplate('+i+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:6px 9px;font-size:12.5px;font-weight:700;cursor:pointer;">&#9998;</button>'+
                '<button onclick="deleteSchedTemplate('+i+')" style="background:#fdeaea;color:#c0264b;border:none;border-radius:8px;padding:6px 9px;font-size:12.5px;font-weight:700;cursor:pointer;">&#128465;&#65039;</button></div>';
        }).join('');
    }
    function saveSchedTemplate(){
        var name=(document.getElementById('schedTplName').value||'').trim(); var msg=document.getElementById('schedTplMsg');
        if(!name){ msg.style.color='#c0264b'; msg.textContent='Name the template.'; return; }
        var shifts=(schedState.data&&schedState.data.shifts)||[];
        if(!shifts.length){ msg.style.color='#c0264b'; msg.textContent='This week has no shifts to save.'; return; }
        var ws=schedState.weekStart;
        var pattern=shifts.map(function(s){ var d=new Date(s.shift_date+'T00:00:00'); var dow=Math.round((d-ws)/86400000);
            return {dow:dow, emp:s.employee_id, pos:s.position_id||null, start:s.start_time, end:s.end_time, note:s.note||null}; })
            .filter(function(p){ return p.dow>=0 && p.dow<=6; });
        msg.style.color='#5b6472'; msg.textContent='Saving&hellip;';
        withPin(function(pin){
            supabaseClient.rpc('app_template_save',{p_username:currentUser.username,p_password:pin,p_id:null,p_name:name,p_location:schedState.location,p_pattern:pattern}).then(function(r){
                if(r.error){ msg.style.color='#c0264b'; msg.textContent='Error: '+r.error.message; return; }
                document.getElementById('schedTplName').value=''; openSchedTemplates();
            }).catch(function(){ msg.style.color='#c0264b'; msg.textContent='Could not save.'; });
        });
    }
    function applySchedTemplate(i){
        var t=(window._schedTpls||[])[i]; if(!t) return;
        if(!confirm('Load "'+(t.name||'')+'" into the week of '+schedFmt(schedState.weekStart)+'? It adds the template shifts to this week.')) return;
        var msg=document.getElementById('schedTplMsg'); msg.style.color='#5b6472'; msg.textContent='Loading template&hellip;';
        withPin(function(pin){
            supabaseClient.rpc('app_template_get',{p_username:currentUser.username,p_password:pin,p_id:t.id}).then(function(r){
                if(r.error||!r.data){ msg.style.color='#c0264b'; msg.textContent='Could not load template.'; return; }
                var pattern=(r.data.pattern)||[]; if(!pattern.length){ msg.style.color='#c0264b'; msg.textContent='Template is empty.'; return; }
                var ws=schedState.weekStart; var done=0, total=pattern.length;
                pattern.forEach(function(p){
                    var ds=schedFmt(schedAddDays(ws, p.dow||0));
                    supabaseClient.rpc('app_sched_upsert_shift',{p_username:currentUser.username,p_password:pin,p_id:null,p_location:schedState.location,p_shift_date:ds,p_employee_id:p.emp,p_position_id:p.pos||null,p_start:p.start,p_end:p.end,p_note:p.note||null}).then(function(){ done++; if(done===total){ closeSchedTemplates(); fetchScheduleWeek(); } }).catch(function(){ done++; if(done===total){ closeSchedTemplates(); fetchScheduleWeek(); } });
                });
            }).catch(function(){ msg.style.color='#c0264b'; msg.textContent='Could not load template.'; });
        });
    }
    function renameSchedTemplate(i){
        var t=(window._schedTpls||[])[i]; if(!t) return;
        var nn=prompt('Rename template:', t.name||''); if(nn===null) return; nn=(nn||'').trim(); if(!nn) return;
        withPin(function(pin){
            supabaseClient.rpc('app_template_save',{p_username:currentUser.username,p_password:pin,p_id:t.id,p_name:nn,p_location:t.location||null,p_pattern:null}).then(function(r){
                if(r.error){ alert('Error: '+r.error.message); return; } openSchedTemplates();
            }).catch(function(){ alert('Could not rename.'); });
        });
    }
    function deleteSchedTemplate(i){
        var t=(window._schedTpls||[])[i]; if(!t) return;
        if(!confirm('Delete template "'+(t.name||'')+'"?')) return;
        withPin(function(pin){
            supabaseClient.rpc('app_template_delete',{p_username:currentUser.username,p_password:pin,p_id:t.id}).then(function(r){
                if(r.error){ alert('Error: '+r.error.message); return; } openSchedTemplates();
            }).catch(function(){ alert('Could not delete.'); });
        });
    }
    function schedAddEmployee() {
        if (isAdminManager()) {
            if ((rosterState.meta.locations||[]).length) { openRosterModal(null); }
            else { loadRosterMeta(); setTimeout(function(){ openRosterModal(null); }, 600); }
            return;
        }
        const name = prompt('New employee name (test roster):'); if (!name) return;
        withPin(function(pin){
            supabaseClient.rpc('app_sched_add_employee', { p_username: currentUser.username, p_password: pin, p_name: name, p_linked_username: '' })
            .then(({ error }) => { if (error) { alert('Error: ' + error.message); return; } fetchScheduleWeek(); });
        });
    }
    function schedPrint() {
        const node = document.getElementById('schedGrid');
        if (!node || !node.innerHTML) { alert('Load a schedule first.'); return; }
        const wkEl = document.getElementById('schedWeekLabel');
        const title = 'Schedule — ' + schedState.location + ' — week of ' + (wkEl ? wkEl.innerText : '');
        const w = window.open('', '_blank');
        if (!w) { alert('Pop-up blocked. Allow pop-ups for this site to print.'); return; }
        w.document.write('<html><head><title>'+title+'</title><style>body{font-family:Arial,sans-serif;padding:16px;color:#222;}h2{margin:0 0 12px;}table{width:100%;border-collapse:collapse;font-size:11px;}th,td{border:1px solid #999;padding:4px;vertical-align:top;text-align:center;}td:first-child,th:first-child{text-align:left;}.sched-chip{display:block;border-radius:4px;padding:2px 4px;margin-bottom:2px;color:#fff;font-size:10px;}p{font-size:10px;color:#6b7686;}</style></head><body><h2>'+title+'</h2>'+node.innerHTML+'</body></html>');
        w.document.close(); w.focus(); setTimeout(function(){ w.print(); }, 300);
    }
