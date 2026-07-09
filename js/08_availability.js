    // ============================================================
    // AVAILABILITY (Phase 2) — submit, approve, schedule warnings
    // ============================================================
    var AVAIL_ORDER = [['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6],['Sun',0]];
    function availFmt(t){ if(!t) return ''; var p=String(t).split(':'); var h=+p[0]||0,m=+p[1]||0,ap=h<12?'a':'p',hh=h%12; if(hh===0)hh=12; return hh+(m?(':'+String(m).padStart(2,'0')):'')+ap; }
    function availDowOf(ds){ var p=String(ds).split('-'); var d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2])); return d.getDay(); }
    function availDescDay(d){ if(!d||!d.mode||d.mode==='all') return 'All day'; if(d.mode==='off') return 'Off'; return availFmt(d.from)+'–'+availFmt(d.to); }
    function availSummary(days){ if(!days||!days.length) return 'Not set'; return AVAIL_ORDER.map(function(o){ return o[0]+' '+availDescDay(days[o[1]]); }).join(' · '); }
    function availCheck(empId, ds, st, en){
        var map=schedState.avail||{}; var days=map[empId]||map[String(empId)]; if(!days||!days.length) return null;
        var d=days[availDowOf(ds)]; if(!d) return null;
        if(d.mode==='off') return 'unavailable';
        if(d.mode==='window'){ if(!d.from||!d.to) return null; if(st<d.from || en>d.to) return 'outside '+availFmt(d.from)+'–'+availFmt(d.to); }
        return null;
    }
    // ----- Phase 3 compliance: readiness + NM teen-hours + cert -----
    function hhmmToMin(t){ var p=String(t||'').split(':'); return (+p[0]||0)*60+(+p[1]||0); }
    function ageOn(bd, ds){ if(!bd) return null; var b=new Date(bd), d=new Date(ds); if(isNaN(b)||isNaN(d)) return null; var a=d.getFullYear()-b.getFullYear(); var mm=d.getMonth()-b.getMonth(); if(mm<0||(mm===0&&d.getDate()<b.getDate())) a--; return a; }
    function isSchoolInSession(ds){ var d=new Date(ds); var m=d.getMonth(), day=d.getDate(); if(m===5||m===6) return false; if(m===7) return day>=15; return true; }
    function isSchoolDay(ds){ var dow=availDowOf(ds); return isSchoolInSession(ds) && dow>=1 && dow<=5; }
    function weekHoursFor(empId){ var t=0; (schedState.data.shifts||[]).forEach(function(s){ if(s.employee_id===empId) t+=schedShiftHours(s); }); return t; }
    function complianceCheck(empId, ds, st, en, posId){
        var warns=[]; var c=(schedState.compliance||{})[empId]||(schedState.compliance||{})[String(empId)]; if(!c) return warns;
        if(posId){ var cleared=(c.cleared||[]).map(Number); if(cleared.indexOf(Number(posId))<0){ var p=schedPosById(Number(posId)); warns.push('not cleared for '+(p?p.name:'this position')); } }
        if(c.cert_expires && String(c.cert_expires) < String(ds)){ warns.push('food-handler card expired '+c.cert_expires); }
        if(c.birthday){ var age=ageOn(c.birthday, ds);
            if(age!=null && age<16 && st && en){
                var mins=hhmmToMin(en)-hhmmToMin(st); if(mins<0) mins+=1440; var hrs=mins/60;
                if(isSchoolDay(ds)){ if(hrs>3) warns.push('minor: over 3h on a school day'); if(st<'07:00'||en>'19:00') warns.push('minor: school-day hours are 7a–7p'); }
                else { if(hrs>8) warns.push('minor: over 8h'); if(st<'07:00'||en>'21:00') warns.push('minor: hours are 7a–9p'); }
                var cap=isSchoolInSession(ds)?18:40; if(weekHoursFor(empId)>cap) warns.push('minor: over '+cap+'h this week');
            }
        }
        return warns;
    }
    // unified per-shift warnings (availability + compliance)
    function shiftWarnings(s){
        var w=[]; if(s.employee_id==null) return w;
        if(typeof availCheck==='function'){ var a=availCheck(s.employee_id,s.shift_date,s.start_time,s.end_time); if(a) w.push(a); }
        if(typeof complianceCheck==='function'){ complianceCheck(s.employee_id,s.shift_date,s.start_time,s.end_time,s.position_id).forEach(function(x){ w.push(x); }); }
        return w;
    }
    function openAvailability(){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        document.getElementById('availabilityView').style.display='block';
        window.scrollTo(0,0); loadAvailability();
    }
    function loadAvailability(){
        var box=document.getElementById('availEditor'); if(!box) return;
        box.innerHTML='<p style="text-align:center;color:#6b7686;padding:20px;">Loading&hellip;</p>';
        document.getElementById('availMsg').textContent='';
        withPin(function(pin){
            supabaseClient.rpc('app_availability_mine',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ box.innerHTML='<p style="color:#c0264b;text-align:center;padding:18px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var d=r.data||{};
                if(d.linked===false){ box.innerHTML='<p style="text-align:center;color:#854F0B;padding:18px;">Your login isn’t linked to an employee record yet. Ask a manager to link it in the Roster, then you can set availability.</p>'; return; }
                var start=(d.last_request&&d.last_request.days&&d.last_request.days.length)?d.last_request.days:(d.approved||[]);
                window._availDays=[]; for(var i=0;i<7;i++){ var x=start[i]||{mode:'all'}; window._availDays[i]={mode:x.mode||'all',from:x.from||'16:00',to:x.to||'22:00'}; }
                renderAvailEditor(d);
            }).catch(function(){ box.innerHTML='<p style="color:#c0264b;text-align:center;padding:18px;">Could not load.</p>'; });
        });
    }
    function renderAvailEditor(d){
        var box=document.getElementById('availEditor');
        var status='';
        var lr=d.last_request;
        if(lr&&lr.status==='pending') status='<div style="background:#fdf3e8;color:#854F0B;border-radius:9px;padding:9px 12px;font-size:13px;margin-bottom:12px;">⏳ Your last request is waiting for manager approval.</div>';
        else if(lr&&lr.status==='approved') status='<div style="background:#e7f6ec;color:#1f7a3d;border-radius:9px;padding:9px 12px;font-size:13px;margin-bottom:12px;">✓ Your availability is approved. Submit again to change it.</div>';
        else if(lr&&lr.status==='denied') status='<div style="background:#fdeaea;color:#c0264b;border-radius:9px;padding:9px 12px;font-size:13px;margin-bottom:12px;">Your last request was not approved'+(lr.decision_comment?' — '+escapeHtml(lr.decision_comment):'')+'. Adjust and resubmit.</div>';
        var h=status;
        AVAIL_ORDER.forEach(function(o){
            var dow=o[1], dd=window._availDays[dow];
            h+='<div style="display:flex;align-items:center;gap:8px;background:var(--surface,#fff);border:1px solid var(--bd,#ececf2);border-radius:10px;padding:8px 10px;margin-bottom:6px;flex-wrap:wrap;">'+
               '<b style="width:42px;font-size:13.5px;color:var(--txt,#26242b);">'+o[0]+'</b>'+
               '<select onchange="availSetMode('+dow+',this.value)" style="padding:7px;border:1px solid #ddd;border-radius:7px;font-size:13px;">'+
               '<option value="all"'+(dd.mode==='all'?' selected':'')+'>Available all day</option>'+
               '<option value="window"'+(dd.mode==='window'?' selected':'')+'>Specific hours</option>'+
               '<option value="off"'+(dd.mode==='off'?' selected':'')+'>Unavailable</option></select>'+
               '<span id="availWin'+dow+'" style="display:'+(dd.mode==='window'?'inline-flex':'none')+';align-items:center;gap:5px;">'+
               '<input type="time" value="'+dd.from+'" onchange="window._availDays['+dow+'].from=this.value" style="padding:6px;border:1px solid #ddd;border-radius:7px;font-size:13px;">'+
               '<span style="color:#6b7686;">to</span>'+
               '<input type="time" value="'+dd.to+'" onchange="window._availDays['+dow+'].to=this.value" style="padding:6px;border:1px solid #ddd;border-radius:7px;font-size:13px;"></span>'+
               '</div>';
        });
        h+='<label class="form-label" style="margin-top:8px;">Note for your manager (optional)</label><input id="availNote" type="text" placeholder="e.g. classes Wed mornings" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;">';
        box.innerHTML=h;
    }
    function availSetMode(dow, mode){ window._availDays[dow].mode=mode; var w=document.getElementById('availWin'+dow); if(w) w.style.display=(mode==='window')?'inline-flex':'none'; }
    function submitAvailability(){
        var days=[]; for(var i=0;i<7;i++){ var d=window._availDays[i]||{mode:'all'}; days[i]=(d.mode==='window')?{mode:'window',from:d.from,to:d.to}:{mode:d.mode}; }
        var note=(document.getElementById('availNote')||{}).value||'';
        var msg=document.getElementById('availMsg'); msg.style.color='#5b6472'; msg.textContent='Submitting…';
        withPin(function(pin){
            supabaseClient.rpc('app_availability_submit',{p_username:currentUser.username,p_password:pin,p_days:days,p_note:note}).then(function(r){
                if(r.error){ msg.style.color='#c0264b'; msg.textContent='Error: '+r.error.message; return; }
                msg.style.color='#1f7a3d'; msg.textContent='✓ Submitted! A manager will approve it.'; loadAvailability();
            }).catch(function(){ msg.style.color='#c0264b'; msg.textContent='Could not submit.'; });
        });
    }
    function openAvailApprovals(){ document.getElementById('availApprovalsModal').style.display='flex'; loadAvailPending(); }
    function closeAvailApprovals(){ document.getElementById('availApprovalsModal').style.display='none'; }
    function loadAvailPending(){
        var box=document.getElementById('availPendingList'); if(!box) return;
        box.innerHTML='<p style="text-align:center;color:#6b7686;padding:18px;">Loading&hellip;</p>';
        withPin(function(pin){
            supabaseClient.rpc('app_availability_pending',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ box.innerHTML='<p style="color:#c0264b;text-align:center;padding:14px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var list=r.data||[];
                if(!list.length){ box.innerHTML='<p style="text-align:center;color:#6b7686;padding:18px;">No availability requests waiting.</p>'; return; }
                box.innerHTML=list.map(function(rq){
                    return '<div style="background:var(--surface,#fff);border:1px solid var(--bd,#ececf2);border-radius:11px;padding:12px;margin-bottom:10px;">'+
                      '<b style="font-size:14.5px;color:var(--txt,#26242b);">'+escapeHtml(rq.employee_name||'Employee')+'</b>'+
                      '<div style="font-size:12.5px;color:#5b6472;line-height:1.6;margin:6px 0;">'+escapeHtml(availSummary(rq.days))+'</div>'+
                      (rq.note?'<div style="font-size:12.5px;color:#6b6275;margin-bottom:6px;">Note: “'+escapeHtml(rq.note)+'”</div>':'')+
                      '<input id="availCmt'+rq.id+'" type="text" placeholder="Comment (optional, sent to them)" style="width:100%;padding:7px;border:1px solid #ddd;border-radius:7px;font-size:12.5px;box-sizing:border-box;margin-bottom:8px;">'+
                      '<div style="display:flex;gap:8px;"><button onclick="availDecide('+rq.id+',true)" style="flex:1;background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:8px;font-size:13px;font-weight:700;cursor:pointer;">Approve</button>'+
                      '<button onclick="availDecide('+rq.id+',false)" style="flex:1;background:#fdeaea;color:#c0264b;border:none;border-radius:8px;padding:8px;font-size:13px;font-weight:700;cursor:pointer;">Deny</button></div></div>';
                }).join('');
            });
        });
    }
    function availDecide(id, approve){
        var cmt=(document.getElementById('availCmt'+id)||{}).value||'';
        withPin(function(pin){
            supabaseClient.rpc('app_availability_decide',{p_username:currentUser.username,p_password:pin,p_id:id,p_approve:approve,p_comment:cmt}).then(function(r){
                if(r.error){ alert('Error: '+r.error.message); return; }
                loadAvailPending(); if(typeof loadAvailBadge==='function') loadAvailBadge();
            });
        });
    }

    // ----- What's New / How-To popup -----
    var HOWTO_VERSION = '2026.06.25.aaron'; // bump to re-show after future how-to updates
    function openHowTo(){ var m=document.getElementById('howtoModal'); if(m) m.style.display='flex'; }
    function closeHowTo(){ var m=document.getElementById('howtoModal'); if(m) m.style.display='none'; try{ localStorage.setItem('howtoSeen_'+HOWTO_VERSION,'1'); }catch(e){} }
    function maybeShowHowTo(){ /* auto-popup on login removed per request; How-To still reachable manually */ return; }
    (function injectModalFitCss(){ try{ var st=document.createElement('style'); st.id='modal-fit-fix'; st.textContent='div[style*="position:fixed"][style*="align-items:center"]>div,div[style*="position: fixed"][style*="align-items: center"]>div{max-height:90vh;overflow-y:auto;-webkit-overflow-scrolling:touch;}@media (max-height:640px){div[style*="position:fixed"][style*="align-items:center"]>div,div[style*="position: fixed"][style*="align-items: center"]>div{max-height:95vh;}}'; (document.head||document.documentElement).appendChild(st); }catch(e){} })();

    // ----- Maintenance Request: equipment picklist tie-in -----
    function maintLoadEquip(preName){
        var sel=document.getElementById('maintEquipSel'); if(!sel) return;
        var loc=(document.getElementById('maintLoc')||{}).value||'';
        if(!loc){
            sel.innerHTML='<option value="">'+(loc==='Warehouse'?'No registry for Warehouse — type below':'Select a store first…')+'</option><option value="__other__">Other / not listed</option>';
            return;
        }
        sel.innerHTML='<option value="">Loading equipment…</option>';
        withPin(function(pin){
            supabaseClient.rpc('app_equipment_list',{p_username:currentUser.username,p_password:pin,p_store:loc}).then(function(r){
                var list=(r&&!r.error&&r.data)?r.data:[];
                var h='<option value="">— pick equipment —</option>';
                list.forEach(function(e){ h+='<option value="'+escapeHtml(e.name)+'">'+escapeHtml(e.name)+'</option>'; });
                h+='<option value="__other__">Other / not listed</option>';
                sel.innerHTML=h;
                if(preName){ sel.value=preName; maintEquipPicked(); }
            }).catch(function(){ sel.innerHTML='<option value="">— pick equipment —</option><option value="__other__">Other / not listed</option>'; });
        });
    }
    function maintEquipPicked(){
        var sel=document.getElementById('maintEquipSel'); var inp=document.getElementById('maintItemInput'); if(!sel||!inp) return;
        var v=sel.value;
        if(v==='__other__'){ inp.value=''; inp.readOnly=false; inp.focus(); }
        else if(v===''){ /* leave as-is */ }
        else { inp.value=v; inp.readOnly=false; }
    }
    function openMaintenanceForEquipment(store, name){
        openForm('maintenanceView');
        setTimeout(function(){
            var loc=document.getElementById('maintLoc');
            if(loc){ for(var i=0;i<loc.options.length;i++){ if(loc.options[i].value===store){ loc.selectedIndex=i; break; } } }
            var inp=document.getElementById('maintItemInput'); if(inp) inp.value=name||'';
            maintLoadEquip(name);
        }, 250);
    }

    // ===== Emergency Mode (static, works offline) =====
    var EMERGENCY = [
      {icon:'⚡', title:'Power outage', steps:[
        'Stay calm; keep team and customers safe (use phone flashlights if needed).',
        'Keep freezers and the dipping cabinet CLOSED to hold temperature as long as possible.',
        'Write down the time the power went out (for food-safety records).',
        'Call the manager on call: [____].',
        'Report the outage to the utility company: [____].',
        'If power is out more than [2 hours], check product temps and follow Food-Safety before serving.'
      ]},
      {icon:'📶', title:'Internet / Wi-Fi outage', steps:[
        'Switch the register to offline/backup mode if available, or take orders on paper.',
        'For card payments, see "Credit-card / payment failure".',
        'Restart the modem/router (unplug 30 seconds, plug back in).',
        'Call the manager on call: [____]; if still down, call the internet provider: [____].'
      ]},
      {icon:'💳', title:'Credit-card / payment failure', steps:[
        'Let customers know cards are temporarily down; offer cash or hold the order.',
        'Do NOT write down or key in card numbers by hand.',
        'Try restarting the card terminal.',
        'Call the manager on call: [____].'
      ]},
      {icon:'🌪️', title:'Severe weather', steps:[
        'Move customers and staff away from windows; follow any official shelter guidance.',
        'If told to evacuate, secure cash, lock up if safe, and leave.',
        'Keep freezers closed if power is affected (see Power outage).',
        'Call the manager on call: [____].'
      ]},
      {icon:'🔥', title:'Fire', steps:[
        'Get everyone out immediately — people first.',
        'Call 911.',
        'Only use an extinguisher on a small, contained fire if trained and safe (PASS: Pull, Aim, Squeeze, Sweep).',
        'Do NOT re-enter the building.',
        'Once safe, call the manager on call: [____].'
      ]},
      {icon:'🚨', title:'Robbery / threatening person', steps:[
        'Your safety comes first — do not resist. Stay calm and comply.',
        'Do not chase or confront anyone.',
        'Once it is safe, call 911.',
        'Lock the doors if safe; keep everyone together; do not touch what the person handled.',
        'Call the manager on call: [____]. Write down what you remember as soon as you can.'
      ]},
      {icon:'🍦', title:'Custard / shake machine failure', steps:[
        'Stop using the machine; note the time and what happened.',
        'Move product to a working freezer if needed to protect it.',
        'File a repair report (Work → Report a Repair).',
        'Call the manager on call: [____]; machine vendor: [____].'
      ]},
      {icon:'🚰', title:'Water interruption', steps:[
        'Stop any task that needs running water (handwashing, dishes, certain prep).',
        'Hand sanitizer is NOT a substitute for handwashing for food tasks.',
        'If water safety is in question, stop serving affected items and call the manager on call: [____].',
        'Report to the water utility: [____].'
      ]},
      {icon:'🦠', title:'Food-safety concern', steps:[
        'Stop serving the affected product; set it aside and label it "DO NOT USE" (do not discard yet).',
        'Check and record temperatures of the unit/product.',
        'Note what happened, when, and which products are affected.',
        'Call the manager on call: [____] before resuming.',
        'Follow management direction on discarding or keeping product.'
      ]}
    ];
    /* ===== Admin Console ===== */
    var NOTIF_TYPES=[
        {k:'equipment_maintenance',l:'Equipment maintenance due'},
        {k:'schedule_published',l:'New schedule published'},
        {k:'schedule_confirm',l:'Confirm-your-schedule reminder'},
        {k:'task_assigned',l:'Task assigned to you'},
        {k:'recognition',l:'Recognition / shout-outs'},
        {k:'announcement',l:'Store announcements'},
        {k:'preshift',l:'Pre-shift lineup reminder'},
        {k:'time_off',l:'Time-off / swap decisions'}
    ];
    var NOTIF_ROLES=['Admin Manager','Vice President/Co-Owner','Manager','Shift Lead','Employee'];
    function loadNotifPrefs(){
        var box=document.getElementById('admNotifBox'); if(!box) return;
        withPin(function(pin){
            supabaseClient.rpc('app_notif_prefs_get',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ box.innerHTML='<p style="color:#c0264b;font-size:13px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                window._notifPrefs=r.data||{}; renderNotifMatrix();
            }).catch(function(){ box.innerHTML='<p style="color:#c0264b;font-size:13px;">Could not load.</p>'; });
        });
    }
    function renderNotifMatrix(){
        var box=document.getElementById('admNotifBox'); if(!box) return; var p=window._notifPrefs||{};
        var h='<div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;font-size:12px;min-width:520px;"><thead><tr><th style="text-align:left;padding:6px 4px;"></th>';
        NOTIF_ROLES.forEach(function(role){ h+='<th style="padding:6px 4px;color:var(--txt,#26242b);font-size:11px;font-weight:700;">'+escapeHtml(role==='Vice President/Co-Owner'?'VP / Owner':role)+'</th>'; });
        h+='</tr></thead><tbody>';
        NOTIF_TYPES.forEach(function(t){
            h+='<tr><td style="padding:7px 4px;color:var(--txt,#26242b);border-top:1px solid var(--bd,#eee);">'+escapeHtml(t.l)+'</td>';
            NOTIF_ROLES.forEach(function(role){
                var on=(p[t.k+'|'+role]!==false);
                h+='<td style="text-align:center;padding:7px 4px;border-top:1px solid var(--bd,#eee);"><input type="checkbox"'+(on?' checked':'')+' onchange="toggleNotifPref(\''+t.k+'\',\''+role+'\',this.checked)" style="width:18px;height:18px;cursor:pointer;"></td>';
            });
            h+='</tr>';
        });
        h+='</tbody></table></div>';
        box.innerHTML=h;
    }
    function toggleNotifPref(type,role,enabled){
        withPin(function(pin){
            supabaseClient.rpc('app_notif_pref_set',{p_username:currentUser.username,p_password:pin,p_type:type,p_role:role,p_enabled:enabled}).then(function(r){
                if(r.error){ alert('Error: '+r.error.message); loadNotifPrefs(); return; }
                window._notifPrefs=window._notifPrefs||{}; window._notifPrefs[type+'|'+role]=enabled;
            }).catch(function(){ alert('Could not save.'); loadNotifPrefs(); });
        });
    }
    var CONTACT_CATS=['Emergency & Safety','Repairs & Maintenance','Store Services & Vendors',"Caliche's Internal Contacts"];
    var CONTACT_LOCS=['Companywide','Roadrunner','Valley','Lenox','Alamogordo','Roswell','Warehouse'];
    function openYourVoice(){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){v.style.display='none';});
        document.getElementById('yourVoiceView').style.display='block'; window.scrollTo(0,0);
        yv2Home();
    }
    /* ===================== YOUR VOICE 2.0 (real anonymity + COI + Team Voice dashboard) ===================== */
    var YV2_CATS={
      talk:['Shift Leader','Store Manager','Operations Leadership','Aaron','Adriana','Help me choose'],
      idea:['Customer Experience','Menu or Product','Store Operations','Equipment or Maintenance','Training','Employee Experience','Safety','Technology / Hub App','Community','Other'],
      feedback:['Training','Leadership','Communication','Scheduling','Tools','Workload','Workplace Environment','Hub App','Other'],
      help:['Scheduling or Hours','Pay or Payroll','Conflict with a Team Member','Concern Involving a Leader','Policy Question','Training Support','Personal Workplace Support','Other / Not Sure'],
      concern:['Harassment','Discrimination','Safety','Retaliation','Wage / Hour','Misconduct by a leader','Other']
    };
    var YV2_TITLES={talk:'Talk to Someone',idea:'Share an Idea',feedback:'Give Feedback',help:'Ask for Help',concern:'Report a Concern'};
    function yvRpc(name,args,cb,onerr){ withPin(function(pin){ var a=Object.assign({p_username:currentUser.username,p_password:pin},args||{}); supabaseClient.rpc(name,a).then(function(r){ if(r.error){ if(onerr) onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'You do not have access to this.':r.error.message); return; } cb(r.data); }).catch(function(){ if(onerr) onerr({message:'Connection error'}); else alert('Connection error.'); }); }); }
    function yv2CanManage(){ return currentUser && (currentUser.is_developer===true || (typeof isManagerRole==='function'&&isManagerRole())); }
    function yv2Ov(){ var o=document.getElementById('yv2Modal'); if(!o){ o=document.createElement('div'); o.id='yv2Modal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100040;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function yv2Close(){ var o=document.getElementById('yv2Modal'); if(o) o.style.display='none'; }
    function yv2Head(title){ return '<div style="background:linear-gradient(120deg,#5b3aa6,#106ab3);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><button onclick="yv2Close()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;">&lsaquo; Back</button><b style="flex:1;font-size:16px;">'+title+'</b></div>'; }
    function yv2Wrap(body){ yv2Ov().innerHTML=yv2Head('Your Voice')+'<div style="max-width:600px;margin:0 auto;padding:16px;">'+body+'</div>'; }
    function yvCard(icon,title,sub,fn,color){ return '<button onclick="'+fn+'" style="width:100%;text-align:left;background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px 15px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:12px;box-shadow:0 2px 6px rgba(0,0,0,.04);"><span style="font-size:23px;">'+icon+'</span><span style="flex:1;"><b style="font-size:14.5px;color:#26242b;display:block;">'+title+'</b><small style="color:#6b6275;font-size:12px;">'+sub+'</small></span><span style="color:'+(color||'#aab')+';font-size:20px;">&rsaquo;</span></button>'; }
    function yv2Home(){ var box=document.getElementById('voiceCards'); if(!box) return; var h='';
      h+=yvCard('&#128483;&#65039;','Talk to Someone','Request a private conversation','yv2Form(\'talk\')');
      h+=yvCard('&#128161;','Share an Idea','Help us improve Caliche\'s','yv2Form(\'idea\')');
      h+=yvCard('&#128172;','Give Feedback','What is working and what could be better','yv2Form(\'feedback\')');
      h+=yvCard('&#129309;','Ask for Help','Scheduling, pay, conflict, policy and more','yv2Form(\'help\')');
      h+=yvCard('&#128274;','Report a Concern','Confidential &mdash; or fully anonymous','yv2Form(\'concern\')','#a01b3e');
      h+=yvCard('&#128269;','Check on a Submission','Use your reference + access code','yv2StatusForm()');
      h+=yvCard('&#128194;','My Submissions','See what you sent &mdash; no code needed','yv2Mine()');
      if(yv2CanManage()) h+=yvCard('&#128202;','Team Voice Dashboard','Reviewers: manage submissions','yv2Dash()','#5b3aa6');
      box.innerHTML=h;
      yvRpc('yv_win_list',{},function(w){ if(w&&w.length){ var wh='<div style="margin-top:16px;background:#eef7ee;border:1px solid #cfe9cf;border-radius:12px;padding:13px;"><div style="font-size:12px;font-weight:800;color:#1b7a3d;text-transform:uppercase;margin-bottom:6px;">&#127881; You Spoke, We Listened</div>'; w.slice(0,5).forEach(function(x){ wh+='<div style="font-size:13px;color:#26242b;padding:5px 0;border-top:1px solid #dcecdc;"><b>'+escapeHtml(x.title||'')+'</b>'+(x.body?'<div style="font-size:12px;color:#5b6472;">'+escapeHtml(x.body)+'</div>':'')+'</div>'; }); wh+='</div>'; box.insertAdjacentHTML('beforeend',wh); } },function(){}); }
    function yv2val(id){ var e=document.getElementById(id); return e?String(e.value).trim():''; }
    function yv2Form(type){ var cats=YV2_CATS[type]||[]; var stores=[''].concat((typeof HUB_STORES!=='undefined'?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell'])).concat(['Multiple / Companywide']);
      var h='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;">';
      h+='<div style="font-size:18px;font-weight:800;color:#1f2a44;">'+escapeHtml(YV2_TITLES[type]||'Your Voice')+'</div><div style="font-size:12px;color:#6b6275;margin-bottom:10px;">Share as much or as little as you like.</div>';
      if(cats.length) h+='<label style="font-size:12px;color:#6b7686;">'+(type==='talk'?'Who would you like to speak with?':'Category')+'</label><select id="yvfCat" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin:3px 0 9px;box-sizing:border-box;">'+cats.map(function(c){return '<option>'+escapeHtml(c)+'</option>';}).join('')+'</select>';
      h+='<label style="font-size:12px;color:#6b7686;">Store</label><select id="yvfStore" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin:3px 0 9px;box-sizing:border-box;">'+stores.map(function(s){return '<option value="'+escapeHtml(s)+'">'+(s?escapeHtml(s):'(choose)')+'</option>';}).join('')+'</select>';
      h+='<label style="font-size:12px;color:#6b7686;">Subject (optional)</label><input id="yvfSubject" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin:3px 0 9px;box-sizing:border-box;">';
      h+='<label style="font-size:12px;color:#6b7686;">Tell us more</label><textarea id="yvfBody" rows="5" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin:3px 0 9px;box-sizing:border-box;" placeholder="What happened, your idea, or what you need."></textarea>';
      if(type==='concern') h+='<label style="font-size:12px;color:#6b7686;">Urgency</label><select id="yvfUrg" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin:3px 0 9px;box-sizing:border-box;"><option>Normal</option><option>High</option><option>Critical</option></select>';
      h+='<label style="display:flex;align-items:flex-start;gap:9px;background:#f7f4fc;border:1px solid #e6dcf6;border-radius:10px;padding:10px;margin-bottom:10px;cursor:pointer;"><input type="checkbox" id="yvfAnon" style="width:18px;height:18px;margin-top:1px;"><span style="font-size:12.5px;color:#4b3a7a;"><b>Submit anonymously.</b> If you check this, we will not record your name or who you are. You will get a private reference + access code &mdash; that code is the only way to check status or get a reply, so please save it.</span></label>';
      h+='<div id="yvfErr" style="font-size:12.5px;color:#c0264b;margin-bottom:8px;"></div>';
      h+='<div style="display:flex;gap:8px;"><button onclick="yv2Close();yv2Home()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:11px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="yv2Submit(\''+type+'\')" style="flex:2;background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">Send</button></div></div>';
      yv2Wrap(h); }
    function yv2Submit(type){ var body=yv2val('yvfBody'); var err=document.getElementById('yvfErr'); if(!body){ if(err) err.textContent='Please add a few words.'; return; }
      var anon=document.getElementById('yvfAnon'); var payload={pathway:type,category:yv2val('yvfCat'),store:yv2val('yvfStore'),subject:yv2val('yvfSubject'),body:body,urgency:(document.getElementById('yvfUrg')?yv2val('yvfUrg'):'Normal'),anonymous:!!(anon&&anon.checked)};
      yvRpc('yv_submit',{p_payload:payload},function(r){ yv2Confirm(r); }); }
    function yvCopyCode(ref,acc){ var t="Caliche's Your Voice\nReference: "+ref+"\nAccess code: "+acc; if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(function(){ alert('Copied. Paste it somewhere safe so you can check status later.'); },function(){ alert('Reference: '+ref+'\nAccess code: '+acc); }); } else { alert('Reference: '+ref+'\nAccess code: '+acc); } }
    function yv2Confirm(r){ var anon=(r&&r.anonymous); var ref=(r&&r.ref_code)||''; var acc=(r&&r.access_code)||'';
      var h='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:20px;text-align:center;"><div style="font-size:44px;">&#128172;</div><h2 style="margin:6px 0;color:#1b7a3d;">Thank you &mdash; received</h2><p style="font-size:13.5px;color:#33303a;">Your submission has been received'+(anon?' anonymously. We did not record your name.':'.')+'</p>';
      h+='<div style="background:#f3f0fb;border:1px solid #e0d8f5;border-radius:12px;padding:14px;margin:12px 0;"><div style="font-size:12px;color:#5b3aa6;font-weight:800;text-transform:uppercase;">Save this to check status</div><div style="font-size:20px;font-weight:800;color:#1f2a44;margin-top:6px;letter-spacing:1px;">'+escapeHtml(ref)+'</div><div style="font-size:13px;color:#5b6472;margin-top:4px;">Access code: <b style="letter-spacing:2px;">'+escapeHtml(acc)+'</b></div><button onclick="yvCopyCode(\''+escapeHtml(ref)+'\',\''+escapeHtml(acc)+'\')" style="margin-top:10px;background:#5b3aa6;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer;">&#128203; Copy my code</button></div>';
      h+=(anon?'<p style="font-size:12px;color:#a01b3e;">Because this is anonymous, this code is the ONLY way to follow up. Copy it now.</p>':'<p style="font-size:12px;color:#5b6472;">Since you are signed in, you can also find this anytime under <b>My Submissions</b> &mdash; no code needed.</p>');
      h+='<div style="display:flex;gap:8px;margin-top:8px;"><button onclick="yv2Close();yv2Home()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:11px;font-weight:700;cursor:pointer;">Done</button><button onclick="yv2StatusForm(\''+escapeHtml(ref)+'\')" style="flex:1;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">Check status</button></div></div>';
      yv2Wrap(h); }
    function yv2StatusForm(pref){ var h='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;"><div style="font-size:18px;font-weight:800;color:#1f2a44;margin-bottom:8px;">Check on a submission</div><label style="font-size:12px;color:#6b7686;">Reference code</label><input id="yvsRef" value="'+escapeHtml(pref||'')+'" placeholder="YV-..." style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin:3px 0 9px;box-sizing:border-box;"><label style="font-size:12px;color:#6b7686;">Access code</label><input id="yvsAcc" placeholder="6 characters" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin:3px 0 9px;box-sizing:border-box;"><div id="yvsErr" style="font-size:12.5px;color:#c0264b;margin-bottom:8px;"></div><button onclick="yv2StatusGo()" style="width:100%;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">Check status</button></div>'; yv2Wrap(h); }
    function yv2StatusGo(){ var ref=yv2val('yvsRef'),acc=yv2val('yvsAcc'); if(!ref||!acc){ var e=document.getElementById('yvsErr'); if(e) e.textContent='Enter both codes.'; return; } yvRpc('yv_status',{p_ref:ref,p_access:acc},function(d){ yv2StatusView(d,ref,acc); },function(er){ var e=document.getElementById('yvsErr'); if(e) e.textContent=er.message||'Not found.'; }); }
    function yv2StatusView(d,ref,acc){ var msgs=(d&&d.messages)||[]; var h='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;"><div style="font-size:12px;color:#6b6275;">'+escapeHtml(d.ref_code||ref)+'</div><div style="font-size:17px;font-weight:800;color:#1f2a44;">'+escapeHtml(d.subject||YV2_TITLES[d.pathway]||'Submission')+'</div><div style="margin:6px 0;"><span style="background:#ede4fb;color:#5b3aa6;font-size:12px;font-weight:800;padding:3px 10px;border-radius:99px;">'+escapeHtml(d.status||'New')+'</span></div><div style="margin-top:10px;font-size:11px;font-weight:800;color:#6b6275;text-transform:uppercase;">Messages</div>';
      if(!msgs.length) h+='<div style="font-size:13px;color:#5b6675;padding:6px 0;">No messages yet. A reviewer will respond here.</div>';
      msgs.forEach(function(m){ h+='<div style="background:'+(m.actor==='Submitter'?'#eef3fb':'#f7f8fb')+';border-radius:9px;padding:8px 10px;margin:5px 0;font-size:13px;color:#26242b;"><b style="font-size:11px;color:#6b7686;">'+escapeHtml(m.actor||'')+'</b><div>'+escapeHtml(m.detail||'')+'</div></div>'; });
      h+='<textarea id="yvsReply" rows="2" placeholder="Add a message (optional)" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin:8px 0;box-sizing:border-box;"></textarea><div style="display:flex;gap:8px;"><button onclick="yv2Close();yv2Home()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Close</button><button onclick="yv2Reply(\''+escapeHtml(ref)+'\',\''+escapeHtml(acc)+'\')" style="flex:1;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Send message</button></div></div>'; yv2Wrap(h); }
    function yv2Reply(ref,acc){ var b=yv2val('yvsReply'); if(!b) return; yvRpc('yv_message',{p_ref:ref,p_access:acc,p_body:b},function(){ yvRpc('yv_status',{p_ref:ref,p_access:acc},function(d){ yv2StatusView(d,ref,acc); }); }); }
    function yv2Mine(){ yv2Wrap('<div style="text-align:center;color:#6b7686;padding:30px;">Loading your submissions&hellip;</div>'); yvRpc('yv_mine',{},function(list){
      var h='<div style="font-size:18px;font-weight:800;color:#1f2a44;margin-bottom:4px;">My Submissions</div><div style="font-size:12px;color:#6b6275;margin-bottom:10px;">The ones you sent while signed in. Anonymous reports are not listed here &mdash; use your saved code for those.</div>';
      if(!list||!list.length){ h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:24px;text-align:center;color:#6b6275;">You have not sent any submissions yet.</div>'; }
      (list||[]).forEach(function(c){ h+='<div onclick="yv2MineOpen(\''+escapeHtml(c.ref_code||'')+'\',\''+escapeHtml(c.access_code||'')+'\')" style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer;"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(c.subject||YV2_TITLES[c.pathway]||'Submission')+'</b><span style="background:#ede4fb;color:#5b3aa6;font-size:11px;font-weight:800;padding:2px 8px;border-radius:99px;">'+escapeHtml(c.status||'New')+'</span></div><div style="font-size:11.5px;color:#6b6275;margin-top:3px;">'+escapeHtml(c.ref_code||'')+' &middot; '+escapeHtml(YV2_TITLES[c.pathway]||c.pathway||'')+'</div></div>'; });
      h+='<div style="margin-top:10px;"><button onclick="yv2Close();yv2Home()" style="background:#eef0f3;border:none;border-radius:9px;padding:10px 16px;cursor:pointer;">&lsaquo; Back</button></div>';
      yv2Wrap(h);
    }); }
    function yv2MineOpen(ref,acc){ yv2Wrap('<div style="text-align:center;color:#6b7686;padding:30px;">Loading&hellip;</div>'); yvRpc('yv_status',{p_ref:ref,p_access:acc},function(d){ yv2StatusView(d,ref,acc); }); }
    function yv2Dash(){ yv2Wrap('<div style="text-align:center;color:#6b7686;padding:30px;">Loading&hellip;</div>'); yvRpc('yv_list',{p_filters:(window._yvFilter||{})},function(d){ window._yvCases=d||[]; yv2DashRender(); }); }
    function yv2DashRender(){ var all=window._yvCases||[]; var f=window._yvFilter||{}; var sts=['','New','Reviewing','In progress','Resolved','Closed']; var pws=['','talk','idea','feedback','help','concern'];
      var h='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center;"><select onchange="window._yvFilter=Object.assign(window._yvFilter||{},{status:this.value});yv2Dash()" style="padding:7px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;">'+sts.map(function(x){return '<option value="'+x+'"'+(f.status===x?' selected':'')+'>'+(x||'All statuses')+'</option>';}).join('')+'</select><select onchange="window._yvFilter=Object.assign(window._yvFilter||{},{pathway:this.value});yv2Dash()" style="padding:7px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;">'+pws.map(function(x){return '<option value="'+x+'"'+(f.pathway===x?' selected':'')+'>'+(x?(YV2_TITLES[x]||x):'All types')+'</option>';}).join('')+'</select>'+(yv2CanManage()?'<button onclick="yv2WinAdd()" style="margin-left:auto;background:#1b7a3d;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-weight:700;font-size:12.5px;cursor:pointer;">+ Win</button>':'')+'</div>';
      if(!all.length) h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:28px;text-align:center;color:#6b6275;">No submissions match.</div>';
      all.forEach(function(c){ var crit=(c.urgency==='Critical'); h+='<div onclick="yv2Case('+c.id+')" style="background:#fff;border:1px solid '+(crit?'#f3b4b4':'#ececf2')+';border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer;"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(c.subject||YV2_TITLES[c.pathway]||'Submission')+'</b><span style="background:#ede4fb;color:#5b3aa6;font-size:11px;font-weight:800;padding:2px 8px;border-radius:99px;">'+escapeHtml(c.status||'New')+'</span></div><div style="font-size:11.5px;color:#6b6275;margin-top:3px;">'+escapeHtml(c.ref||'')+' &middot; '+escapeHtml(YV2_TITLES[c.pathway]||c.pathway||'')+(c.anonymous?' &middot; <span style="color:#5b3aa6;font-weight:700;">Anonymous</span>':'')+(c.urgency&&c.urgency!=='Normal'?(' &middot; <span style="color:'+(crit?'#c0264b':'#9a5b00')+';font-weight:700;">'+escapeHtml(c.urgency)+'</span>'):'')+(c.assigned_to?(' &middot; '+escapeHtml(c.assigned_to)):'')+'</div></div>'; });
      if(typeof isDiscAdmin==='function'&&isDiscAdmin()){ h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px 14px;margin-top:14px;"><div onclick="yvLegacyToggle()" style="display:flex;align-items:center;gap:8px;cursor:pointer;"><b style="flex:1;font-size:13.5px;color:#26242b;">&#128451;&#65039; Legacy concern reports</b><span style="font-size:11px;color:#6b7686;">Admin only</span><span id="yvLegacyChev" style="color:#6b7686;">&#9662;</span></div><div id="yvLegacyBody" style="display:none;margin-top:10px;"></div></div>'; }
      yv2Wrap(h); }
    /* Phase-3: the old Report-a-Concern admin list (renderVoiceCards) was removed, but the reports
       table + app_harassment_list/update RPCs remain. Surface them here, Disc-Admin only. */
    function yvLegacyToggle(){ var b=document.getElementById('yvLegacyBody'); var ch=document.getElementById('yvLegacyChev'); if(!b) return; if(b.style.display==='none'){ b.style.display='block'; if(ch) ch.innerHTML='&#9652;'; yvLegacyLoad(); } else { b.style.display='none'; if(ch) ch.innerHTML='&#9662;'; } }
    function yvLegacyLoad(){ var b=document.getElementById('yvLegacyBody'); if(!b) return; b.innerHTML='<div style="color:#6b7686;font-size:12.5px;">Loading&hellip;</div>';
      withPin(function(pin){ supabaseClient.rpc('app_harassment_list',{p_admin_username:currentUser.username,p_admin_password:pin}).then(function(r){
        if(r.error){ if(r.error.code==='42501') sessionPin=null; b.innerHTML='<div style="color:#a01b3e;font-size:12.5px;">Could not load. <button onclick="yvLegacyLoad()" style="background:#eef0f3;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;">Retry</button></div>'; return; }
        var list=r.data||[];
        if(!list.length){ b.innerHTML='<div style="color:#6b7686;font-size:12.5px;">No legacy reports on file.</div>'; return; }
        b.innerHTML=list.map(function(a){ var st=(a.status||'new');
          return '<div style="border:1px solid #eef0f5;border-radius:9px;padding:9px 11px;margin-bottom:7px;font-size:12.5px;">'+
            '<div style="display:flex;justify-content:space-between;gap:8px;"><b style="color:#26242b;">#'+a.id+(a.about_who?(' &middot; '+escapeHtml(a.about_who)):'')+'</b><span style="font-size:11px;background:'+(st==='resolved'?'#1f7a3d':'#b06a00')+';color:#fff;border-radius:10px;padding:2px 9px;">'+escapeHtml(st)+'</span></div>'+
            '<div style="color:#6b7686;margin-top:2px;">'+escapeHtml(a.incident_date||String(a.created_at||'').slice(0,10))+(a.location?(' &middot; '+escapeHtml(a.location)):'')+(a.reporter?(' &middot; from '+escapeHtml(a.reporter)):'')+(a.assigned_to?(' &middot; assigned: '+escapeHtml(a.assigned_to)):'')+'</div>'+
            (a.details?('<div style="color:#33303a;margin-top:4px;white-space:pre-wrap;">'+escapeHtml(a.details)+'</div>'):'')+
            (a.notes?('<div style="color:#5b6675;margin-top:3px;"><b>Notes:</b> '+escapeHtml(a.notes)+'</div>'):'')+
            '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;"><button onclick="yvLegacyUpdate('+a.id+',&quot;in progress&quot;)" style="background:#eef3fb;color:#185FA5;border:none;border-radius:7px;padding:4px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">In progress</button><button onclick="yvLegacyUpdate('+a.id+',&quot;resolved&quot;)" style="background:#e7f6ec;color:#1f7a3d;border:none;border-radius:7px;padding:4px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Resolve</button></div></div>'; }).join('');
      }).catch(function(){ b.innerHTML='<div style="color:#a01b3e;font-size:12.5px;">Connection error. <button onclick="yvLegacyLoad()" style="background:#eef0f3;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;">Retry</button></div>'; }); }, function(){ b.innerHTML='<div style="color:#6b7686;font-size:12.5px;">PIN required.</div>'; }); }
    function yvLegacyUpdate(id,status){ var note=''; if(status==='resolved'){ var n=prompt('Resolution note (optional):'); if(n===null) return; note=n; }
      withPin(function(pin){ supabaseClient.rpc('app_harassment_update',{p_admin_username:currentUser.username,p_admin_password:pin,p_id:id,p_status:status,p_assigned_to:'',p_notes:note}).then(function(r){ if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; } yvLegacyLoad(); }).catch(function(){ alert('Connection error.'); }); }); }
    function yv2Case(id){ yv2Wrap('<div style="text-align:center;color:#6b7686;padding:30px;">Loading&hellip;</div>'); yvRpc('yv_get',{p_id:id},function(c){ yv2CaseRender(c); },function(e){ yv2Wrap('<div style="background:#fff;border-radius:12px;padding:20px;text-align:center;color:#a01b3e;">'+escapeHtml(e.message||'Could not open.')+'</div><div style="text-align:center;margin-top:10px;"><button onclick="yv2Dash()" style="background:#eef0f3;border:none;border-radius:9px;padding:10px 16px;cursor:pointer;">Back to dashboard</button></div>'); }); }
    function yv2CaseRender(c){ var ev=(c.events||[]); var h='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;"><div style="font-size:12px;color:#6b6275;">'+escapeHtml(c.ref_code||'')+' &middot; '+escapeHtml(YV2_TITLES[c.pathway]||c.pathway||'')+'</div><div style="font-size:18px;font-weight:800;color:#1f2a44;">'+escapeHtml(c.subject||'(no subject)')+'</div><div style="font-size:12.5px;color:#5b6472;margin-top:3px;">From: <b>'+escapeHtml(c.submitter||'Anonymous')+'</b>'+(c.category?(' &middot; '+escapeHtml(c.category)):'')+(c.store?(' &middot; '+escapeHtml(c.store)):'')+(c.urgency?(' &middot; '+escapeHtml(c.urgency)):'')+'</div>'+(c.body?'<div style="font-size:13.5px;color:#26242b;margin-top:8px;background:#f7f8fb;border-radius:8px;padding:9px 11px;white-space:pre-wrap;">'+escapeHtml(c.body)+'</div>':'')+'<div style="margin-top:10px;"><span style="background:#ede4fb;color:#5b3aa6;font-size:12px;font-weight:800;padding:3px 10px;border-radius:99px;">'+escapeHtml(c.status||'New')+'</span>'+(c.assigned_to?'<span style="margin-left:6px;font-size:12px;color:#6b7686;">Reviewer: '+escapeHtml(c.assigned_to)+'</span>':'')+'</div></div>';
      h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:14px;margin-bottom:12px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Manage</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;"><select id="yvcStatus" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;">'+['New','Reviewing','In progress','Resolved','Closed'].map(function(s){return '<option'+(c.status===s?' selected':'')+'>'+s+'</option>';}).join('')+'</select><button onclick="yv2Advance('+c.id+')" style="background:#185FA5;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;">Update</button></div><div style="display:flex;gap:6px;margin-bottom:8px;"><select id="yvcAssign" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;"><option value="">Assign reviewer&hellip;</option></select><button onclick="yv2AssignGo('+c.id+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;">Assign</button></div><textarea id="yvcMsg" rows="2" placeholder="Message or internal note" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;margin-bottom:6px;"></textarea><div style="display:flex;gap:6px;"><button onclick="yv2Note('+c.id+',true)" style="flex:1;background:#f4f5f8;color:#5b6472;border:none;border-radius:8px;padding:9px;font-weight:700;font-size:12.5px;cursor:pointer;">Add internal note</button><button onclick="yv2Note('+c.id+',false)" style="flex:1;background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:9px;font-weight:700;font-size:12.5px;cursor:pointer;">Send to submitter</button></div></div>';
      var th=''; ev.forEach(function(e){ var dt=''; try{ dt=new Date(e.at).toLocaleString(); }catch(x){} th+='<div style="padding:6px 0;border-bottom:1px solid #f3f4f8;font-size:12.5px;"><span style="font-size:10px;color:#5b6675;">'+dt+(e.internal?' &middot; internal':' &middot; shared')+'</span><div style="color:#33303a;"><b>'+escapeHtml(e.actor||'')+':</b> '+escapeHtml(e.detail||e.kind||'')+'</div></div>'; });
      h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:14px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:6px;">Activity</div>'+(th||'<div style="color:#5b6675;font-size:13px;">No activity.</div>')+'</div>';
      yv2Ov().innerHTML=yv2Head('Case')+'<div style="max-width:600px;margin:0 auto;padding:16px;"><div style="margin-bottom:10px;"><button onclick="yv2Dash()" style="background:#eef0f3;border:none;border-radius:8px;padding:7px 12px;font-size:12.5px;cursor:pointer;">&lsaquo; All submissions</button></div>'+h+'</div>'; yvFillAssignable(c.assigned_to||''); }
    function yvFillAssignable(current){
      var sel=document.getElementById('yvcAssign'); if(!sel) return;
      yvRpc('yv_assignable',{},function(list){
        var s=document.getElementById('yvcAssign'); if(!s) return; var cur=current||'';
        var opts='<option value="">Assign reviewer&hellip;</option>';
        var found=false;
        (list||[]).forEach(function(p){ var isC=(p.name===cur); if(isC) found=true; opts+='<option value="'+escapeHtml(p.name)+'"'+(isC?' selected':'')+'>'+escapeHtml(p.name)+' &mdash; '+escapeHtml(p.role)+'</option>'; });
        if(cur && !found){ opts+='<option value="'+escapeHtml(cur)+'" selected>'+escapeHtml(cur)+'</option>'; }
        opts+='<option value="__other__">Other&hellip; (type a name)</option>';
        s.innerHTML=opts;
      }, function(){ /* not privileged or offline — leave the basic select usable via Other */ var s=document.getElementById('yvcAssign'); if(s){ s.innerHTML='<option value="">Assign reviewer&hellip;</option>'+(current?'<option value="'+escapeHtml(current)+'" selected>'+escapeHtml(current)+'</option>':'')+'<option value="__other__">Other&hellip; (type a name)</option>'; } });
    }
    function yv2Advance(id){ yvRpc('yv_advance',{p_id:id,p_status:yv2val('yvcStatus'),p_note:null},function(){ yv2Case(id); }); }
    function yv2AssignGo(id){ var sel=document.getElementById('yvcAssign'); var r=sel?sel.value:''; if(r==='__other__'){ r=(prompt('Reviewer name:')||'').trim(); } if(!r) return; yvRpc('yv_assign',{p_id:id,p_reviewer:r},function(){ yv2Case(id); }); }
    function yv2Note(id,internal){ var b=yv2val('yvcMsg'); if(!b){ alert('Type a note or message first.'); return; } yvRpc('yv_note',{p_id:id,p_body:b,p_internal:internal},function(){ yv2Case(id); }); }
    function yv2WinAdd(){ var t=prompt('Win title (what changed because someone spoke up):'); if(!t) return; var b=prompt('A sentence of detail (optional):')||''; yvRpc('yv_win_save',{p_title:t,p_body:b},function(){ alert('Posted to You Spoke, We Listened.'); yv2Dash(); }); }
    /* =================== END YOUR VOICE 2.0 =================== */
    /* (The retired Voice v1 module was removed in the Phase 2 cleanup. Your Voice 2.0 above is the live system.) */
    function lmsOverlay(){ var ov=document.getElementById('lmsModal'); if(!ov){ ov=document.createElement('div'); ov.id='lmsModal'; ov.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100000;overflow:auto;'; document.body.appendChild(ov); } ov.style.display='block'; return ov; }
    function lmsClose(){ var ov=document.getElementById('lmsModal'); if(ov) ov.style.display='none'; }
    function lmsHeader(title,back,badge){ return '<div style="background:linear-gradient(120deg,#185FA5,#7d1d4b);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:2;">'+(back?'<button onclick="'+back+'" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;">&#8249; Back</button>':'')+'<b style="flex:1;font-size:16px;">'+title+'</b>'+(badge?'<span style="background:#ffd84d;color:#5b3a00;font-size:10px;font-weight:800;padding:3px 8px;border-radius:99px;">'+badge+'</span>':'')+'<button onclick="lmsClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }
    function lmsStatusBadge(st){ var m={passed:['#e8f5ec','#1b7a3d','Certified'],in_progress:['#fff4e0','#9a5b00','In progress'],not_started:['#eef0f3','#6b7686','Not started']}; var c=m[st||'not_started']||m.not_started; return '<span style="background:'+c[0]+';color:'+c[1]+';font-size:11px;font-weight:800;padding:2px 8px;border-radius:99px;white-space:nowrap;">'+c[2]+'</span>'; }
    // ===== Learning Paths — real, database-backed (catalog + per-employee progress) =====
    var _lms={catalog:[],my:{passed_course_ids:[],completions:[],enrollments:[]}};
    function lmsPassedSet(){ var s={}; (_lms.my.passed_course_ids||[]).forEach(function(id){ s[id]=true; }); return s; }
    function lmsScoreOf(cid){ var c=(_lms.my.completions||[]).filter(function(x){return x.course_id===cid;})[0]; return c?c.score:null; }
    function lmsCourseStatus(cid){ var passed=lmsPassedSet(); if(passed[cid]) return 'passed'; if(lmsScoreOf(cid)!=null) return 'in_progress'; return 'not_started'; }
    function openLmsPreview(){ lmsLoad(function(){ lmsHome(); }); }
    function lmsLoad(cb){
        var ov=lmsOverlay(); ov.innerHTML=lmsHeader('My Training','')+'<div style="max-width:640px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading your training&hellip;</div>';
        withPin(function(pin){
            Promise.all([
                supabaseClient.rpc('app_lp_catalog',{p_username:currentUser.username,p_password:pin}),
                supabaseClient.rpc('app_lp_my',{p_username:currentUser.username,p_password:pin}),
                supabaseClient.rpc('app_lp_gamify',{p_username:currentUser.username,p_password:pin}),
                supabaseClient.rpc('app_lp_leaderboard',{p_username:currentUser.username,p_password:pin,p_store:''})
            ]).then(function(res){
                if(res[0].error){ ov.innerHTML=lmsHeader('My Training','')+'<div style="max-width:640px;margin:0 auto;padding:30px 16px;color:#c0264b;text-align:center;">Could not load training: '+escapeHtml(res[0].error.message)+'</div>'; return; }
                _lms.catalog=res[0].data||[]; _lms.my=(res[1]&&res[1].data)?res[1].data:{passed_course_ids:[],completions:[],enrollments:[]}; _lms.gamify=(res[2]&&res[2].data)||null; _lms.board=(res[3]&&res[3].data)||null;
                if(cb) cb();
            }).catch(function(){ ov.innerHTML=lmsHeader('My Training','')+'<div style="max-width:640px;margin:0 auto;padding:30px 16px;color:#c0264b;text-align:center;">Connection error.</div>'; });
        }, function(){ ov.innerHTML=lmsHeader('My Training','')+'<div style="max-width:640px;margin:0 auto;padding:30px 16px;color:#6b7686;text-align:center;">PIN required.</div>'; });
    }
    function lmsGamifyCard(){
        var g=_lms.gamify, brd=_lms.board; if(!g&&!brd) return '';
        var h='<div style="background:linear-gradient(120deg,#185FA5,#7d1d4b);color:#fff;border-radius:14px;padding:15px;margin-bottom:14px;box-shadow:0 3px 12px rgba(0,0,0,.12);">';
        h+='<div style="display:flex;align-items:center;gap:12px;"><div style="font-size:30px;font-weight:800;line-height:1;">'+((g&&g.points)||0)+'</div><div style="flex:1;"><div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;opacity:.9;">My points</div><div style="font-size:11.5px;opacity:.85;">'+((g&&g.courses)||0)+' course'+(((g&&g.courses)===1)?'':'s')+' passed'+((brd&&brd.me&&brd.me.rank)?(' &middot; #'+brd.me.rank+' at '+escapeHtml(brd.store||'your store')):'')+'</div></div></div>';
        if(g&&g.badges&&g.badges.length){ h+='<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:11px;">'+g.badges.map(function(x){return '<span style="background:rgba(255,255,255,.18);border-radius:99px;padding:3px 10px;font-size:11.5px;font-weight:700;">'+x.icon+' '+escapeHtml(x.name)+'</span>';}).join('')+'</div>'; }
        if(brd&&brd.top&&brd.top.length){ h+='<div style="background:rgba(255,255,255,.12);border-radius:10px;padding:9px 11px;margin-top:11px;"><div style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;opacity:.9;margin-bottom:5px;">'+escapeHtml(brd.store||'Store')+' leaderboard</div>';
            brd.top.slice(0,5).forEach(function(pp){ h+='<div style="display:flex;align-items:center;gap:8px;font-size:12.5px;padding:2px 0;'+(pp.me?'font-weight:800;':'')+'"><span style="width:18px;opacity:.85;">'+pp.rank+'</span><span style="flex:1;">'+escapeHtml(pp.name||'')+(pp.me?' (you)':'')+'</span><span>'+pp.points+'</span></div>'; });
            h+='</div>'; }
        return h+'</div>';
    }
    function lmsHome(){
        var ov=lmsOverlay(); var passed=lmsPassedSet(); var paths=_lms.catalog||[]; var next=null;
        paths.forEach(function(p){ (p.courses||[]).forEach(function(c){ if(!next && !passed[c.id]) next={c:c,p:p}; }); });
        var h=''; h+=lmsGamifyCard();
        if(next){ h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 2px 10px rgba(0,0,0,.05);"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;">Continue learning</div><div style="font-size:16px;font-weight:700;color:#26242b;margin:4px 0 2px;">'+escapeHtml(next.c.title)+'</div><div style="font-size:12px;color:#6b6275;margin-bottom:10px;">'+escapeHtml(next.p.title)+'</div><button onclick="lmsOpenCourse('+next.c.id+')" style="width:100%;background:#185FA5;color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:800;cursor:pointer;">Continue &rsaquo;</button></div>'; }
        else if(paths.length){ h+='<div style="background:#e8f5ec;border:1px solid #cdeed7;border-radius:14px;padding:16px;margin-bottom:14px;text-align:center;"><div style="font-size:32px;">&#127881;</div><b style="color:#1b7a3d;">All paths complete!</b><div style="font-size:12.5px;color:#5b6472;">You have earned every available certification. Nice work!</div></div>'; }
        if(!paths.length){ h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:20px;text-align:center;color:#6b6275;">No learning paths yet. A manager can add them under Team Development.</div>'; }
        paths.forEach(function(p){
            var courses=p.courses||[]; var done=courses.filter(function(c){return passed[c.id];}).length, tot=courses.length;
            h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.04);"><div style="display:flex;align-items:center;gap:8px;"><span style="font-size:18px;">'+escapeHtml(p.icon||'🎓')+'</span><b style="flex:1;font-size:15.5px;color:#26242b;">'+escapeHtml(p.title)+'</b><span style="font-size:12px;color:#6b6275;">'+done+'/'+tot+'</span></div>'+(p.description?'<div style="font-size:12.5px;color:#6b6275;margin:4px 0 8px;">'+escapeHtml(p.description)+'</div>':'<div style="height:6px;"></div>')+'<div style="background:#eee;border-radius:99px;height:7px;overflow:hidden;margin-bottom:10px;"><div style="height:100%;width:'+(tot?Math.round(100*done/tot):0)+'%;background:#1f7a3d;"></div></div>';
            var _mgr=(currentUser&&(currentUser.is_developer===true||(typeof isManagerRole==='function'&&isManagerRole())));
            courses.forEach(function(c){ var row=lmsCourseRow(c,_mgr); if(row) h+=row; });
            h+='</div>';
        });
        var certs=[]; paths.forEach(function(p){ (p.courses||[]).forEach(function(c){ if(passed[c.id]) certs.push(c.title); }); });
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:6px;">My certifications</div>'+(certs.length?('<div style="display:flex;flex-wrap:wrap;gap:6px;">'+certs.map(function(t){return '<span style="background:#e8f5ec;color:#1b7a3d;font-size:11.5px;font-weight:700;padding:4px 9px;border-radius:99px;">&#127894; '+escapeHtml(t)+'</span>';}).join('')+'</div>'):'<div style="font-size:12.5px;color:#6b6275;">Pass a course quiz to earn its certification.</div>')+'</div>';
        if(currentUser&&(currentUser.is_developer===true||(typeof isManagerRole==='function'&&isManagerRole()))){ h+='<button onclick="lmsManageCourses()" style="width:100%;background:#fff;border:1px dashed #cdd5e0;color:#185FA5;border-radius:10px;padding:11px;font-size:13.5px;font-weight:700;cursor:pointer;margin-top:4px;">&#9999;&#65039; Add or edit courses &amp; videos (admins)</button>'; }
        ov.innerHTML=lmsHeader('My Training','')+'<div style="max-width:640px;margin:0 auto;padding:16px;">'+h+'</div>';
    }
    function lmsCourseRow(c,_mgr){
        var draft=(c.pub_status==='draft');
        if(draft && !_mgr) return '';
        var sc=lmsScoreOf(c.id);
        var badge=draft?'<span style="background:#fff4e0;color:#9a5b00;font-size:10px;font-weight:800;padding:1px 6px;border-radius:99px;margin-right:5px;">DRAFT</span>':'';
        var h='<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">';
        h+='<button onclick="lmsOpenCourse('+c.id+')" style="flex:1;text-align:left;background:#faf9fc;border:1px solid '+(draft?'#f3d9a0':'#f0eef4')+';border-radius:10px;padding:11px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;"><span style="flex:1;font-size:13.5px;color:#33303a;">'+badge+escapeHtml(c.title)+'<small style="display:block;color:#5b6675;font-size:11px;">'+(c.has_video?'▶ video &middot; ':'')+(c.pages_count||0)+' lesson page'+((c.pages_count===1)?'':'s')+(c.version?(' &middot; v'+c.version):'')+(sc!=null?' &middot; scored '+sc+'%':'')+'</small></span>'+lmsStatusBadge(lmsCourseStatus(c.id))+'</button>';
        if(_mgr){ h+='<button onclick="lmsToggleStatus(event,'+c.id+',\''+(draft?'draft':'published')+'\')" title="'+(draft?'Publish for crew':'Move to draft')+'" style="flex:0 0 auto;background:'+(draft?'#e8f5ec':'#fff4e0')+';color:'+(draft?'#1b7a3d':'#9a5b00')+';border:none;border-radius:8px;padding:10px 11px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">'+(draft?'Publish':'Unpublish')+'</button>'; }
        h+='</div>';
        return h;
    }
    function lmsToggleStatus(ev,courseId,cur){
        if(ev&&ev.stopPropagation) ev.stopPropagation();
        var ns=(cur==='draft')?'published':'draft';
        withPin(function(pin){
            supabaseClient.rpc('app_lp_set_status',{p_username:currentUser.username,p_password:pin,p_course_id:courseId,p_status:ns}).then(function(r){
                if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Only managers can publish courses.':r.error.message); return; }
                lmsLoad(function(){ lmsHome(); });
            }).catch(function(){ alert('Could not change status.'); });
        });
    }
    function lmsManageCourses(){ lmsClose(); _td.tab='paths'; if(typeof tdLoad==='function'){ tdLoad(function(){ tdRender(); }); } else { alert('Open Team then Team Development then Paths to manage courses.'); } }
    function lmsOpenCourse(courseId){
        var ov=lmsOverlay(); ov.innerHTML=lmsHeader('Lesson','lmsHome()')+'<div style="max-width:640px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading&hellip;</div>';
        withPin(function(pin){
            supabaseClient.rpc('app_lp_course',{p_username:currentUser.username,p_password:pin,p_course_id:courseId}).then(function(r){
                if(r.error||!r.data||r.data.error){ ov.innerHTML=lmsHeader('Lesson','lmsHome()')+'<div style="max-width:640px;margin:0 auto;padding:30px 16px;color:#c0264b;text-align:center;">Could not load this course.</div>'; return; }
                window._lmsCur={course:r.data,page:0}; lmsRenderLesson();
            }).catch(function(){ ov.innerHTML=lmsHeader('Lesson','lmsHome()')+'<div style="max-width:640px;margin:0 auto;padding:30px 16px;color:#c0264b;text-align:center;">Connection error.</div>'; });
        });
    }
    function lmsVidKey(u){ var s=String(u||''),h=0,i; for(i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; } return 'cv'+Math.abs(h); }
    function lmsVideoEmbed(url){
        url=String(url||'').trim(); if(!url) return ''; var key=lmsVidKey(url);
        var yt=url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{6,})/);
        var vim=url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
        var bar='<div style="height:7px;background:#e9edf3;border-radius:99px;overflow:hidden;margin-top:8px;"><div id="'+key+'_bar" style="height:100%;width:0%;background:#1f7a3d;transition:width .3s;"></div></div><div id="'+key+'_lbl" style="font-size:11.5px;color:#6b6275;margin-top:4px;">&#9654; Press play &mdash; watch to continue</div>';
        if(yt) return '<div class="lmsVid" data-vkey="'+key+'" data-vtype="yt"><div style="position:relative;padding-bottom:56.25%;height:0;border-radius:12px;overflow:hidden;background:#000;"><iframe id="'+key+'_if" src="https://www.youtube.com/embed/'+escapeHtml(yt[1])+'?enablejsapi=1&rel=0&modestbranding=1" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>'+bar+'</div>';
        if(vim) return '<div class="lmsVid" data-vkey="'+key+'" data-vtype="vimeo"><div style="position:relative;padding-bottom:56.25%;height:0;border-radius:12px;overflow:hidden;background:#000;"><iframe id="'+key+'_if" src="https://player.vimeo.com/video/'+escapeHtml(vim[1])+'" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="autoplay; fullscreen; picture-in-picture"></iframe></div>'+bar+'</div>';
        if(/\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(url)) return '<div class="lmsVid" data-vkey="'+key+'" data-vtype="native"><video id="'+key+'_if" playsinline preload="metadata" controls controlsList="nodownload" style="width:100%;border-radius:12px;background:#000;display:block;" src="'+escapeHtml(url)+'"></video>'+bar+'</div>';
        return '<a href="'+escapeHtml(url)+'" target="_blank" rel="noopener" style="display:inline-block;background:#185FA5;color:#fff;padding:10px 14px;border-radius:9px;text-decoration:none;font-weight:700;">&#9654; Watch the video</a>';
    }
    var _lmsGate={req:0,done:{}};
    function lmsThr(){ return 0.95; }
    function lmsSetBar(key,pct){ pct=Math.max(0,Math.min(1,pct||0)); var b=document.getElementById(key+'_bar'); if(b) b.style.width=Math.round(pct*100)+'%'; var l=document.getElementById(key+'_lbl'); if(l){ if(pct>=lmsThr()){ l.innerHTML='&#10003; Watched &mdash; you can continue'; l.style.color='#1b7a3d'; } else { l.textContent='Watched '+Math.round(pct*100)+'% — keep watching to continue'; l.style.color='#8a8594'; } } }
    function lmsMarkWatched(key){ if(_lmsGate.done[key]) return; _lmsGate.done[key]=true; lmsSetBar(key,1); lmsGateCheck(); }
    function lmsGateCheck(){ var btn=document.getElementById('lmsAdvBtn'); if(!btn) return; var n=0,k; for(k in _lmsGate.done){ if(_lmsGate.done[k]) n++; } if(n>=_lmsGate.req){ btn.disabled=false; btn.style.opacity='1'; btn.style.cursor='pointer'; } }
    function lmsInitPlayers(){
        _lmsGate={req:0,done:{}}; var ov=lmsOverlay(); var vids=ov.querySelectorAll('.lmsVid'); var btn=document.getElementById('lmsAdvBtn');
        if(!vids||!vids.length) return;
        _lmsGate.req=vids.length;
        if(btn){ btn.disabled=true; btn.style.opacity='.5'; btn.style.cursor='not-allowed'; }
        [].forEach.call(vids,function(el){ var key=el.getAttribute('data-vkey'); var ty=el.getAttribute('data-vtype');
            var w=parseFloat(localStorage.getItem('cvw_w_'+key)||'0'); var d=parseFloat(localStorage.getItem('cvw_d_'+key)||'0');
            if(d>0 && w/d>=lmsThr()){ lmsSetBar(key,1); lmsMarkWatched(key); }
            if(ty==='native') lmsWireNative(key); else if(ty==='yt') lmsWireYT(key); else if(ty==='vimeo') lmsWireVimeo(key); else lmsMarkWatched(key);
        });
    }
    function lmsWireNative(key){
        var v=document.getElementById(key+'_if'); if(!v) return; var watched=parseFloat(localStorage.getItem('cvw_w_'+key)||'0');
        v.addEventListener('loadedmetadata',function(){ var d=v.duration||0; if(d){ localStorage.setItem('cvw_d_'+key,String(d)); var pos=parseFloat(localStorage.getItem('cvw_pos_'+key)||'0'); if(pos>1 && pos<d-1){ try{ v.currentTime=pos; }catch(e){} } lmsSetBar(key,Math.min(1,watched/d)); } else { lmsManualConfirm(key); } });
        v.addEventListener('timeupdate',function(){ var d=v.duration||0; if(!d) return; if(v.currentTime>watched+2.5){ try{ v.currentTime=watched; }catch(e){} return; } watched=Math.max(watched,v.currentTime); localStorage.setItem('cvw_w_'+key,String(watched)); localStorage.setItem('cvw_pos_'+key,String(v.currentTime)); var pct=watched/d; lmsSetBar(key,pct); if(pct>=lmsThr()) lmsMarkWatched(key); });
        v.addEventListener('ended',function(){ watched=v.duration||watched; localStorage.setItem('cvw_w_'+key,String(watched)); lmsMarkWatched(key); });
        v.addEventListener('error',function(){ lmsManualConfirm(key); });
    }
    function lmsLoadYT(cb){ if(window.YT&&window.YT.Player){ cb(); return; } if(!window._lmsYTcbs){ window._lmsYTcbs=[]; var t=document.createElement('script'); t.src='https://www.youtube.com/iframe_api'; document.head.appendChild(t); window.onYouTubeIframeAPIReady=function(){ var a=window._lmsYTcbs||[]; window._lmsYTcbs=null; a.forEach(function(f){ try{ f(); }catch(e){} }); }; } if(window._lmsYTcbs) window._lmsYTcbs.push(cb); else cb(); }
    function lmsWireYT(key){
        lmsLoadYT(function(){ try{
          var watched=parseFloat(localStorage.getItem('cvw_w_'+key)||'0'); var dur=0; var poll=null;
          var p=new YT.Player(key+'_if',{ events:{
            onReady:function(){ try{ dur=p.getDuration()||0; if(dur) localStorage.setItem('cvw_d_'+key,String(dur)); }catch(e){} },
            onStateChange:function(e){ if(e.data===1){ if(poll) clearInterval(poll); poll=setInterval(function(){ try{ var t=p.getCurrentTime(); if(!dur) dur=p.getDuration()||0; if(t>watched+2.6){ p.seekTo(watched,true); return; } watched=Math.max(watched,t); localStorage.setItem('cvw_w_'+key,String(watched)); if(dur){ var pct=watched/dur; lmsSetBar(key,pct); if(pct>=lmsThr()) lmsMarkWatched(key); } }catch(e){} },800); } else { if(poll){ clearInterval(poll); poll=null; } if(e.data===0) lmsMarkWatched(key); } }
          }});
        }catch(e){ lmsManualConfirm(key); } });
    }
    function lmsLoadVimeo(cb){ if(window.Vimeo&&window.Vimeo.Player){ cb(); return; } if(!window._lmsVcbs){ window._lmsVcbs=[]; var t=document.createElement('script'); t.src='https://player.vimeo.com/api/player.js'; t.onload=function(){ var a=window._lmsVcbs||[]; window._lmsVcbs=null; a.forEach(function(f){ try{ f(); }catch(e){} }); }; document.head.appendChild(t); } if(window._lmsVcbs) window._lmsVcbs.push(cb); else cb(); }
    function lmsWireVimeo(key){
        lmsLoadVimeo(function(){ try{ var ifr=document.getElementById(key+'_if'); if(!ifr) return; var pl=new Vimeo.Player(ifr); var watched=parseFloat(localStorage.getItem('cvw_w_'+key)||'0'); var dur=0;
          pl.getDuration().then(function(d){ dur=d||0; if(dur) localStorage.setItem('cvw_d_'+key,String(dur)); });
          pl.on('timeupdate',function(data){ var t=(data&&data.seconds)||0; if(!dur) dur=(data&&data.duration)||0; if(t>watched+2.6){ pl.setCurrentTime(watched); return; } watched=Math.max(watched,t); localStorage.setItem('cvw_w_'+key,String(watched)); if(dur){ var pct=watched/dur; lmsSetBar(key,pct); if(pct>=lmsThr()) lmsMarkWatched(key); } });
          pl.on('ended',function(){ lmsMarkWatched(key); });
        }catch(e){ lmsManualConfirm(key); } });
    }
    function lmsManualConfirm(key){ var l=document.getElementById(key+'_lbl'); if(l){ l.innerHTML='<button onclick="lmsMarkWatched(\''+key+'\')" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:700;cursor:pointer;">&#10003; I finished watching</button>'; } }
    function lmsRenderLesson(){
        var cur=window._lmsCur; if(!cur) return; var c=cur.course; var _vp=(c.video_url?[lmsVideoEmbed(c.video_url)]:[]); var _tp=(c.pages&&c.pages.length)?c.pages:[]; var pages=_vp.concat(_tp); if(!pages.length) pages=['<p>(No lesson content yet.)</p>']; var pg=Math.max(0,Math.min(pages.length-1,cur.page||0)); cur.page=pg;
        var dots=''; for(var i=0;i<pages.length;i++){ dots+='<span style="width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:5px;background:'+(i<=pg?'#185FA5':'#d6dbe6')+';"></span>'; }
        var h=lmsHeader('Lesson','lmsHome()')+'<div style="max-width:640px;margin:0 auto;padding:16px;"><div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.05);">';
        h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"><div>'+dots+'</div><span style="font-size:11.5px;color:#5b6675;">Page '+(pg+1)+' of '+pages.length+'</span></div>';
        h+='<h2 style="margin:0 0 10px;font-size:19px;color:#26242b;">'+escapeHtml(c.title)+'</h2><div style="font-size:14.5px;color:#33303a;line-height:1.6;">'+pages[pg]+'</div>'+((pg===pages.length-1)?(lmsMatsHtml(c)+lmsScormBtns(c)):'');
        h+='<div style="display:flex;gap:8px;margin-top:16px;">';
        if(pg>0) h+='<button onclick="lmsLessonPage(-1)" style="background:#eef3fb;color:#185FA5;border:none;border-radius:10px;padding:12px 16px;font-size:14px;font-weight:700;cursor:pointer;">&lsaquo; Back</button>';
        var _al,_aa,_ac='#185FA5'; if(pg<pages.length-1){ _al='Next &rsaquo;'; _aa='lmsLessonPage(1)'; } else if((c.quiz||[]).length){ _al='Take the quick check &rsaquo;'; _aa='lmsStartQuiz()'; _ac='#1f7a3d'; } else { _al='Mark complete &rsaquo;'; _aa='lmsMarkDone()'; _ac='#1f7a3d'; }
        h+='<button id="lmsAdvBtn" onclick="'+_aa+'" style="flex:1;background:'+_ac+';color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:800;cursor:pointer;">'+_al+'</button>';
        h+='</div></div></div>'; lmsOverlay().innerHTML=h; lmsInitPlayers();
    }
    function lmsLessonPage(dir){ var cur=window._lmsCur; if(!cur) return; cur.page=(cur.page||0)+dir; lmsRenderLesson(); }
    function lmsMarkDone(){ var c=window._lmsCur&&window._lmsCur.course; if(!c) return; lmsRecord(c.id,100,true,null,null); }
    function lmsStartQuiz(){
        var c=window._lmsCur&&window._lmsCur.course; if(!c) return; var qs=c.quiz||[];
        var h=lmsHeader('Quick check','lmsRenderLesson()')+'<div style="max-width:640px;margin:0 auto;padding:16px;"><div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:18px;"><div style="font-size:12.5px;color:#6b6275;margin-bottom:12px;">Answer all questions &mdash; you need '+(c.pass_pct||80)+'% to pass.</div>';
        qs.forEach(function(q,i){ var ty=q.type||'mc'; h+='<div style="margin-bottom:16px;"><div style="font-weight:700;font-size:14.5px;color:#26242b;margin-bottom:8px;">'+(i+1)+'. '+escapeHtml(q.q)+'</div>'; if(ty==='mc'){ (q.choices||[]).forEach(function(ch,ci){ h+='<label style="display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid #e6e6ee;border-radius:9px;margin-bottom:6px;cursor:pointer;font-size:13.5px;color:#33303a;"><input type="radio" name="lq'+i+'" value="'+ci+'" style="width:17px;height:17px;"> '+escapeHtml(ch)+'</label>'; }); } else if(ty==='short'){ h+='<input id="lq_short_'+i+'" placeholder="Your answer" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:13.5px;box-sizing:border-box;">'; } else { h+='<textarea id="lq_long_'+i+'" placeholder="Write your response" style="width:100%;height:80px;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:13.5px;box-sizing:border-box;"></textarea>'; } h+='</div>'; });
        h+='<div id="lmsQuizMsg" style="font-size:13px;margin-bottom:8px;"></div><button onclick="lmsSubmitQuiz()" style="width:100%;background:#185FA5;color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:800;cursor:pointer;">Submit</button></div></div>';
        lmsOverlay().innerHTML=h;
    }
    function lmsSubmitQuiz(){
        var cur=window._lmsCur; if(!cur) return; var c=cur.course; var qs=c.quiz||[]; var msg=document.getElementById('lmsQuizMsg'); var correct=0, gradable=0, unanswered=false; var responses=[];
        qs.forEach(function(q,i){ var ty=q.type||'mc'; if(ty==='long'){ var ta=document.getElementById('lq_long_'+i); if(!ta||!ta.value.trim()) unanswered=true; else responses.push({q:q.q,type:'long',answer:ta.value.trim()}); } else if(ty==='short'){ var si=document.getElementById('lq_short_'+i); if(!si||!si.value.trim()){ unanswered=true; } else { responses.push({q:q.q,type:'short',answer:si.value.trim()}); if(q.accept&&String(q.accept).trim()){ gradable++; if(si.value.trim().toLowerCase()===String(q.accept).trim().toLowerCase()) correct++; } } } else { var sel=document.querySelector('input[name="lq'+i+'"]:checked'); if(!sel){ unanswered=true; } else { gradable++; var _ci=parseInt(sel.value,10); if(_ci===q.a) correct++; responses.push({q:q.q,type:'mc',answer:((q.choices||[])[_ci]||''),correct:(_ci===q.a)}); } } });
        if(unanswered){ if(msg){ msg.style.color='#c0264b'; msg.textContent='Please answer every question.'; } return; }
        var score=gradable>0?Math.round(100*correct/gradable):100; var total=gradable||(qs.length||1); var pass=score>=(c.pass_pct||80);
        if(msg){ msg.style.color='#5b6472'; msg.textContent='Saving…'; }
        lmsRecord(c.id,score,pass,correct,total,responses);
    }
    function lmsRecord(courseId,score,pass,correct,total,responses){
        withPin(function(pin){
            supabaseClient.rpc('app_lp_complete',{p_username:currentUser.username,p_password:pin,p_course_id:courseId,p_score:score,p_passed:pass,p_responses:(responses||[])}).then(function(r){
                Promise.all([supabaseClient.rpc('app_lp_my',{p_username:currentUser.username,p_password:pin}),supabaseClient.rpc('app_lp_gamify',{p_username:currentUser.username,p_password:pin})]).then(function(gr){
                    if(gr[0]&&gr[0].data) _lms.my=gr[0].data;
                    if(gr[1]&&gr[1].data) _lms.gamify=gr[1].data;
                    lmsResult(courseId,score,pass,correct,total,(r&&r.data)?r.data:null);
                });
            }).catch(function(){ var msg=document.getElementById('lmsQuizMsg'); if(msg){ msg.style.color='#c0264b'; msg.textContent='Could not save. Try again.'; } });
        });
    }
    function lmsResult(courseId,score,pass,correct,total,info){
        var cur=window._lmsCur; var c=cur&&cur.course; var pathId=c&&c.path_id;
        var path=(_lms.catalog||[]).filter(function(p){return p.id===pathId;})[0];
        var passed=lmsPassedSet(); var nextC=null;
        if(path){ (path.courses||[]).forEach(function(cc){ if(!nextC && !passed[cc.id]) nextC=cc; }); }
        var pathDone=info&&info.path_total>0&&info.path_done>=info.path_total;
        var h=lmsHeader('Result','lmsHome()')+'<div style="max-width:640px;margin:0 auto;padding:16px;"><div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:24px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.05);">';
        h+='<div style="font-size:46px;">'+(pass?'&#127881;':'&#128170;')+'</div><h2 style="margin:8px 0 4px;color:'+(pass?'#1b7a3d':'#9a5b00')+';">'+(pass?'Passed!':'Almost there')+'</h2>'+(correct!=null?'<p style="font-size:15px;color:#33303a;">You scored <b>'+score+'%</b> ('+correct+' of '+total+').</p>':'<p style="font-size:15px;color:#33303a;">Lesson complete.</p>');
        if(pathDone&&path){ h+='<p style="color:#1b7a3d;font-size:13.5px;font-weight:700;">&#127894; '+escapeHtml(path.title)+' complete &mdash; certification earned!</p>'; }
        else if(pass){ h+='<p style="color:#1b7a3d;font-size:13px;">Course complete &mdash; saved to your record.</p>'; }
        else { h+='<p style="color:#9a5b00;font-size:13px;">You need '+((c&&c.pass_pct)||80)+'% to pass. Review the lesson and try again.</p>'; }
        if(_lms.gamify){ var _g=_lms.gamify; h+='<div style="background:#fff7e6;border:1px solid #ffe2a8;border-radius:12px;padding:11px;margin-top:8px;"><div style="font-size:22px;font-weight:800;color:#9a5b00;">'+(_g.points||0)+' pts</div>'+((_g.badges&&_g.badges.length)?('<div style="display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin-top:6px;">'+_g.badges.map(function(_b){return '<span style="background:#fff;border:1px solid #ffe2a8;border-radius:99px;padding:3px 9px;font-size:11.5px;font-weight:700;color:#9a5b00;">'+_b.icon+' '+escapeHtml(_b.name)+'</span>';}).join('')+'</div>'):'')+'</div>'; }
        h+='<div style="display:flex;gap:8px;margin-top:14px;">';
        if(!pass) h+='<button onclick="lmsRenderLesson()" style="flex:1;background:#eef3fb;color:#185FA5;border:none;border-radius:10px;padding:11px;font-weight:700;cursor:pointer;">Review lesson</button>';
        if(pass && nextC) h+='<button onclick="lmsOpenCourse('+nextC.id+')" style="flex:1;background:#1f7a3d;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">Next lesson &rsaquo;</button>';
        h+='<button onclick="lmsHome()" style="flex:1;background:#185FA5;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">'+((pass&&nextC)?'My training':'Back to training')+'</button>';
        h+='</div></div></div>'; lmsOverlay().innerHTML=h;
    }
    // ===== TEAM DEVELOPMENT — manager view (overview / builder+assign / promotions) =====
    var _td={team:[],catalog:[],reqs:[],store:'',tab:'team'};
    function tdOverlay(){ var ov=document.getElementById('teamDevModal'); if(!ov){ ov=document.createElement('div'); ov.id='teamDevModal'; ov.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100000;overflow:auto;'; document.body.appendChild(ov); } ov.style.display='block'; return ov; }
    function tdClose(){ var ov=document.getElementById('teamDevModal'); if(ov) ov.style.display='none'; var m=document.getElementById('tdModal2'); if(m) m.style.display='none'; }
    function tdHeader(title,back){ return '<div style="background:linear-gradient(120deg,#185FA5,#7d1d4b);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;">'+(back?'<button onclick="'+back+'" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;">&#8249; Back</button>':'')+'<b style="flex:1;font-size:16px;">'+title+'</b><button onclick="tdClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }
    function openTeamDev(){ _td.tab='team'; tdLoad(function(){ tdRender(); }); }
    function tdLoad(cb){
        var ov=tdOverlay(); ov.innerHTML=tdHeader('Team Development','')+'<div style="max-width:760px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading team&hellip;</div>';
        withPin(function(pin){
            Promise.all([
                supabaseClient.rpc('app_lp_team',{p_username:currentUser.username,p_password:pin,p_store:_td.store||''}),
                supabaseClient.rpc('app_lp_catalog',{p_username:currentUser.username,p_password:pin}),
                supabaseClient.rpc('app_lp_requirements_list',{p_username:currentUser.username,p_password:pin}),
                supabaseClient.rpc('app_lp_rule_list',{p_username:currentUser.username,p_password:pin})
            ]).then(function(res){
                if(res[0].error){ ov.innerHTML=tdHeader('Team Development','')+'<div style="max-width:760px;margin:0 auto;padding:30px 16px;color:#c0264b;text-align:center;">'+(String(res[0].error.message||'').indexOf('forbidden')>=0?'Managers only.':escapeHtml(res[0].error.message))+'</div>'; return; }
                _td.team=res[0].data||[]; _td.catalog=(res[1]&&res[1].data)||[]; _td.reqs=(res[2]&&res[2].data)||[]; _td.rules=(res[3]&&res[3].data)||[];
                if(cb) cb();
            }).catch(function(){ ov.innerHTML=tdHeader('Team Development','')+'<div style="max-width:760px;margin:0 auto;padding:30px 16px;color:#c0264b;text-align:center;">Connection error.</div>'; });
        }, function(){ ov.innerHTML=tdHeader('Team Development','')+'<div style="max-width:760px;margin:0 auto;padding:30px 16px;color:#6b7686;text-align:center;">PIN required.</div>'; });
    }
    function tdTabs(){ var t=_td.tab; function b(id,lbl){ return '<button onclick="tdSetTab(&quot;'+id+'&quot;)" style="flex:1;background:'+(t===id?'#185FA5':'#eef0f3')+';color:'+(t===id?'#fff':'#5b6472')+';border:none;padding:10px;font-size:13px;font-weight:700;cursor:pointer;border-radius:9px;">'+lbl+'</button>'; }
        return '<div style="display:flex;gap:6px;max-width:760px;margin:14px auto 0;padding:0 16px;">'+b('team','Team')+b('paths','Paths')+b('promos','Promotions')+b('rules','Auto-assign')+'</div>'; }
    function tdSetTab(t){ _td.tab=t; tdRender(); }
    function tdRender(){ var ov=tdOverlay(); var body=(_td.tab==='team')?tdTeamHtml():(_td.tab==='paths')?tdPathsHtml():(_td.tab==='rules')?tdRulesHtml():tdPromoHtml(); ov.innerHTML=tdHeader('Team Development','')+tdTabs()+'<div style="max-width:760px;margin:0 auto;padding:14px 16px 40px;">'+body+'</div>'; }
    function tdPct(done,total){ return total>0?Math.round(100*done/total):0; }
    function downloadCSV(filename, rows){ try{ var csv=rows.map(function(r){ return r.map(function(c){ c=(c==null?'':String(c)); if(/[",\n]/.test(c)) c='"'+c.replace(/"/g,'""')+'"'; return c; }).join(','); }).join('\r\n'); var blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); var url=URL.createObjectURL(blob); var a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function(){ URL.revokeObjectURL(url); },1000); }catch(e){ alert('Export failed.'); } }
    function tdExportCSV(){ var rows=[['Name','Role','Store','Training %','Positions cleared','Certifications','Coaching logs']]; (_td.team||[]).forEach(function(e){ var paths=e.paths||[]; var d=0,t=0; paths.forEach(function(p){ d+=(p.done||0); t+=(p.total||0); }); var pct=t>0?Math.round(100*d/t):0; rows.push([e.name||'',e.role||'',e.store||_td.store||'',pct,(e.cleared_positions||0),(e.certs_count||0),(e.coaching_count||0)]); }); downloadCSV('team_development.csv',rows); }
    function fhExportCSV(){ var rows=[['Code','Organization','Status','Market','Owner','Approved start','Approved end','Return due','Cards approved','Cards issued']]; (_fh.list||[]).forEach(function(x){ rows.push([x.code,x.org,x.status,x.market||'',x.owner||'',x.approved_start||'',x.approved_end||'',x.return_due||'',x.cards_approved||0,x.cards_issued||0]); }); downloadCSV('fundraisers.csv',rows); }
    function exportActivityCSV(){ var data=(typeof _activityLogData!=='undefined'&&_activityLogData)?_activityLogData:[]; if(!data.length){ alert('No activity to export yet.'); return; } var rows=[['Name','Username','Action','Time']]; data.forEach(function(r){ var t=r.created_at?new Date(r.created_at).toLocaleString():''; rows.push([r.name||'',r.username||'',r.action||'',t]); }); downloadCSV('activity_log_'+new Date().toISOString().slice(0,10)+'.csv',rows); }
    function tdTeamHtml(){
        var stores=[''].concat((typeof HUB_STORES!=='undefined'?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell'])).concat(['Warehouse']);
        var h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;"><span style="font-size:12px;color:#6b6275;">Store</span><select onchange="_td.store=this.value; tdLoad(function(){tdRender();});" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:9px;font-size:13px;">'+stores.map(function(s){return '<option value="'+s+'"'+(_td.store===s?' selected':'')+'>'+(s||'All stores')+'</option>';}).join('')+'</select><button onclick="tdExportCSV()" style="background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:8px 12px;font-size:12.5px;font-weight:700;cursor:pointer;">&#8595; CSV</button></div>';
        if(!_td.team.length){ return h+'<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:20px;text-align:center;color:#6b6275;">No team members here.</div>'; }
        _td.team.forEach(function(e){
            var paths=e.paths||[]; var totalDone=0,totalAll=0; paths.forEach(function(p){ totalDone+=(p.done||0); totalAll+=(p.total||0); });
            var pct=tdPct(totalDone,totalAll);
            h+='<div onclick="tdEmp('+e.employee_id+')" style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px 14px;margin-bottom:9px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.04);">'+
               '<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14.5px;color:#26242b;">'+escapeHtml(e.name||'')+'</b><span style="font-size:11.5px;color:#5b6675;">'+escapeHtml(e.role||'')+'</span></div>'+
               '<div style="background:#eee;border-radius:99px;height:7px;overflow:hidden;margin:8px 0 6px;"><div style="height:100%;width:'+pct+'%;background:#1f7a3d;"></div></div>'+
               '<div style="display:flex;flex-wrap:wrap;gap:5px;font-size:11px;color:#5b6472;">'+
                 '<span style="background:#eef3fb;color:#185FA5;padding:2px 8px;border-radius:99px;">'+pct+'% training</span>'+
                 '<span style="background:#f3eefb;color:#5b3aa6;padding:2px 8px;border-radius:99px;">'+(e.cleared_positions||0)+' positions</span>'+
                 '<span style="background:#e8f5ec;color:#1b7a3d;padding:2px 8px;border-radius:99px;">'+(e.certs_count||0)+' certs</span>'+
                 '<span style="background:#fff4e0;color:#9a5b00;padding:2px 8px;border-radius:99px;">'+(e.coaching_count||0)+' coaching</span>'+
               '</div></div>';
        });
        return h;
    }
    function tdEmp(empId){
        var e=_td.team.filter(function(x){return x.employee_id===empId;})[0]; if(!e) return;
        var ov=tdOverlay(); ov.innerHTML=tdHeader('Loading&hellip;','tdRender()')+'<div style="max-width:640px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading '+escapeHtml(e.name||'')+'&hellip;</div>';
        withPin(function(pin){
            Promise.all([
                supabaseClient.rpc('app_lp_promo',{p_username:currentUser.username,p_password:pin,p_employee_id:empId}),
                supabaseClient.rpc('app_lp_responses',{p_username:currentUser.username,p_password:pin,p_employee_id:empId}),
                supabaseClient.rpc('app_lp_attempts',{p_username:currentUser.username,p_password:pin,p_employee_id:empId})
            ]).then(function(res){
                tdEmpRender(e,(res[0]&&res[0].data)||{},(res[1]&&res[1].data)||[],(res[2]&&res[2].data)||[]);
            }).catch(function(){ tdEmpRender(e,{},[],[]); });
        });
    }
    function tdEmpRender(e,pr,resp,attempts){
        var ov=tdOverlay(); var paths=e.paths||[];
        var h='<div style="max-width:640px;margin:0 auto;padding:16px;">';
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;"><div style="font-size:18px;font-weight:800;color:#1f2a44;">'+escapeHtml(e.name||'')+'</div><div style="font-size:13px;color:#6b7686;">'+escapeHtml(e.role||'')+(e.store?(' &middot; '+escapeHtml(e.store)):'')+'</div></div>';
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Learning paths</div>';
        if(!paths.length) h+='<div style="font-size:13px;color:#5b6675;">No paths.</div>';
        paths.forEach(function(p){ var pct=tdPct(p.done,p.total); h+='<div style="margin-bottom:9px;"><div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:#33303a;">'+escapeHtml(p.title||'')+'</span><span style="color:#6b6275;">'+(p.done||0)+'/'+(p.total||0)+(p.status==='completed'?' ✓':'')+'</span></div><div style="background:#eee;border-radius:99px;height:6px;overflow:hidden;margin-top:3px;"><div style="height:100%;width:'+pct+'%;background:'+(pct>=100?'#1f7a3d':'#185FA5')+';"></div></div></div>'; });
        h+='</div>';
        h+='<div style="display:flex;gap:8px;margin-bottom:12px;"><div style="flex:1;background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#5b3aa6;">'+(e.cleared_positions||0)+'</div><div style="font-size:11px;color:#6b6275;">positions cleared</div></div><div style="flex:1;background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#1b7a3d;">'+(e.certs_count||0)+'</div><div style="font-size:11px;color:#6b6275;">certifications</div></div><div style="flex:1;background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#9a5b00;">'+(e.coaching_count||0)+'</div><div style="font-size:11px;color:#6b6275;">coaching logs</div></div></div>';
        var reqs=(pr.requirements)||_td.reqs||[];
        if(reqs.length){ h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Promotion readiness</div>';
          reqs.forEach(function(rq){ var rr=tdReadiness(rq,pr,e); h+='<div style="border:1px solid #eef0f5;border-radius:10px;padding:10px;margin-bottom:7px;"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13.5px;color:#26242b;">'+escapeHtml(rq.role||'')+'</b><span style="background:'+(rr.ready?'#e8f5ec':'#fdeee8')+';color:'+(rr.ready?'#1b7a3d':'#a85217')+';font-size:11px;font-weight:800;padding:2px 9px;border-radius:99px;">'+(rr.ready?'Ready':'In progress')+'</span></div>'+(rr.items.length?'<div style="font-size:11.5px;color:#6b7686;margin-top:5px;">'+rr.items.join(' &nbsp;&middot;&nbsp; ')+'</div>':'')+'</div>'; });
          h+='</div>'; }
        if(resp&&resp.length){ h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-top:12px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Written quiz answers</div>'; resp.forEach(function(rc){ h+='<div style="border:1px solid #eef0f5;border-radius:10px;padding:10px;margin-bottom:8px;"><div style="font-size:12.5px;font-weight:700;color:#185FA5;margin-bottom:5px;">'+escapeHtml(rc.course||'Course')+'</div>'; (rc.answers||[]).filter(function(a){return a&&(a.type==='long'||a.type==='short');}).forEach(function(a){ h+='<div style="margin-bottom:6px;"><div style="font-size:12px;color:#6b7686;">'+escapeHtml(a.q||'')+'</div><div style="font-size:13px;color:#26242b;background:#faf9fc;border:1px solid #f0eef4;border-radius:8px;padding:7px 9px;margin-top:2px;white-space:pre-wrap;">'+escapeHtml(a.answer||'')+'</div></div>'; }); h+='</div>'; }); h+='</div>'; }
        if(attempts&&attempts.length){ h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-top:12px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Quiz attempt history ('+attempts.length+')</div>'; attempts.forEach(function(at){ var dt=''; try{ dt=new Date(at.at).toLocaleDateString(); }catch(e2){} h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f3f4f8;font-size:12.5px;"><span style="flex:1;color:#33303a;">'+escapeHtml(at.course||'Course')+'</span><span style="color:#5b6675;">'+dt+'</span><span style="font-weight:700;color:'+(at.passed?'#1b7a3d':'#c0264b')+';">'+(at.score!=null?at.score+'%':'')+(at.passed?' \u2713':' \u2717')+'</span>'+((at.missed&&at.missed>0)?'<span style="color:#9a5b00;font-size:11px;">'+at.missed+' missed</span>':'')+'</div>'; }); h+='</div>'; }
        h+='</div>';
        ov.innerHTML=tdHeader(e.name||'Employee','tdRender()')+h;
    }
    function tdReadiness(rq,pr,e){
        var items=[]; var ready=true;
        var reqPaths=rq.required_path_ids||[]; var prog=(pr.path_progress)||[];
        reqPaths.forEach(function(pid){ var pp=prog.filter(function(x){return x.path_id===pid;})[0]; var done=pp&&pp.total>0&&pp.done>=pp.total; if(!done) ready=false; items.push((done?'✓ ':'○ ')+(pp?pp.title:('Path '+pid))); });
        var minc=rq.min_cleared_positions||0; var clr=(pr.cleared_positions!=null?pr.cleared_positions:(e.cleared_positions||0)); if(clr<minc) ready=false; if(minc) items.push((clr>=minc?'✓ ':'○ ')+clr+'/'+minc+' positions');
        var reqCerts=rq.required_cert_types||[]; var have=(pr.cert_types)||[]; reqCerts.forEach(function(ct){ var has=have.indexOf(ct)>=0; if(!has) ready=false; items.push((has?'✓ ':'○ ')+ct); });
        return {ready:ready,items:items};
    }
    function tdPathsHtml(){
        var h='<button onclick="tdEditPath(null)" style="width:100%;background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:800;cursor:pointer;margin-bottom:12px;">&#10133; New learning path</button>';
        if(!_td.catalog.length){ return h+'<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:18px;text-align:center;color:#6b6275;">No paths yet &mdash; create one above.</div>'; }
        _td.catalog.forEach(function(p){
            h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,.04);">';
            h+='<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:18px;">'+escapeHtml(p.icon||'🎓')+'</span><b style="flex:1;font-size:15px;color:#26242b;">'+escapeHtml(p.title)+'</b>'+
               '<button onclick="tdAssign('+p.id+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;">Assign</button>'+
               '<button onclick="tdEditPath('+p.id+')" style="background:#f4f5f8;color:#5b6472;border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;margin-left:5px;">Edit</button></div>';
            if(p.target_role||p.level) h+='<div style="font-size:11.5px;color:#5b6675;margin-top:3px;">'+escapeHtml([p.level,p.target_role?('→ '+p.target_role):''].filter(Boolean).join('  '))+'</div>';
            (p.courses||[]).forEach(function(c){ h+='<div style="display:flex;align-items:center;gap:8px;background:#faf9fc;border:1px solid #f0eef4;border-radius:9px;padding:9px 11px;margin-top:7px;"><span style="flex:1;font-size:13px;color:#33303a;">'+escapeHtml(c.title)+'<small style="display:block;color:#5b6675;font-size:11px;">'+(c.pages_count||0)+' pages &middot; '+(c.quiz_count||0)+' quiz Q</small></span><button onclick="tdEditCourse('+p.id+','+c.id+')" style="background:#fff;border:1px solid #e6e6ee;color:#5b6472;border-radius:7px;padding:4px 9px;font-size:11.5px;cursor:pointer;">Edit</button></div>'; });
            h+='<button onclick="tdEditCourse('+p.id+',null)" style="width:100%;background:#fff;border:1px dashed #cdd5e0;color:#185FA5;border-radius:9px;padding:8px;font-size:12.5px;font-weight:700;cursor:pointer;margin-top:8px;">&#10133; Add course</button>';
            h+='<button onclick="tdArchive(&quot;path&quot;,'+p.id+',&quot;'+escapeHtml((p.title||'').replace(/"/g,'')).replace(/&/g,'&amp;')+'&quot;)" style="width:100%;background:none;border:none;color:#c0264b;font-size:11.5px;cursor:pointer;margin-top:6px;">Archive path</button>';
            h+='</div>';
        });
        return h;
    }
    function tdModal(html){ var m=document.getElementById('tdModal2'); if(!m){ m=document.createElement('div'); m.id='tdModal2'; m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100001;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:18px;box-sizing:border-box;'; document.body.appendChild(m); } m.innerHTML='<div style="background:#fff;border-radius:14px;max-width:560px;width:100%;margin-top:16px;padding:18px;box-shadow:0 16px 50px rgba(0,0,0,.3);">'+html+'</div>'; m.style.display='flex'; return m; }
    function tdModalClose(){ var m=document.getElementById('tdModal2'); if(m) m.style.display='none'; }
    function tdField(id,label,val,ph){ return '<div style="margin-bottom:10px;"><label style="display:block;font-size:12px;color:#6b7686;margin-bottom:3px;">'+label+'</label><input id="'+id+'" value="'+String(val==null?'':val).replace(/"/g,'&quot;')+'" placeholder="'+(ph||'')+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;"></div>'; }
    function tdVal(id){ var el=document.getElementById(id); return el?el.value:''; }
    function tdEditPath(id){
        var p=id?(_td.catalog.filter(function(x){return x.id===id;})[0]||{}):{};
        var h='<h3 style="margin:0 0 12px;color:#1f2a44;">'+(id?'Edit path':'New learning path')+'</h3>';
        h+=tdField('tdpTitle','Title',p.title||'');
        h+=tdField('tdpDesc','Description',p.description||'');
        h+=tdField('tdpRole','Develops toward (role)',p.target_role||'');
        h+=tdField('tdpLevel','Level / apron label',p.level||'');
        h+=tdField('tdpIcon','Icon (emoji)',p.icon||'🎓');
        h+='<div id="tdpMsg" style="font-size:12.5px;color:#c0264b;margin:6px 0;"></div>';
        h+='<div style="display:flex;gap:8px;"><button onclick="tdModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:11px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="tdSavePath('+(id||'null')+')" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">Save</button></div>';
        tdModal(h);
    }
    function tdSavePath(id){
        var t=tdVal('tdpTitle').trim(); if(!t){ document.getElementById('tdpMsg').textContent='Give it a title.'; return; }
        withPin(function(pin){
            supabaseClient.rpc('app_lp_save_path',{p_username:currentUser.username,p_password:pin,p_id:(id||null),p_title:t,p_description:tdVal('tdpDesc'),p_target_role:tdVal('tdpRole'),p_level:tdVal('tdpLevel'),p_icon:tdVal('tdpIcon'),p_sort:null,p_active:true}).then(function(r){
                if(r.error){ document.getElementById('tdpMsg').textContent=(String(r.error.message).indexOf('forbidden')>=0?'Managers only.':r.error.message); return; }
                tdModalClose(); tdLoad(function(){ _td.tab='paths'; tdRender(); });
            }).catch(function(){ document.getElementById('tdpMsg').textContent='Could not save.'; });
        });
    }
    function tdEditCourse(pathId,id){
        if(id){ withPin(function(pin){ supabaseClient.rpc('app_lp_course',{p_username:currentUser.username,p_password:pin,p_course_id:id}).then(function(r){ tdCourseForm(pathId,id,(r&&r.data)||{}); }); }); }
        else tdCourseForm(pathId,null,{});
    }
    function tdCourseForm(pathId,id,c){
        var pagesText=((c.pages)||[]).join('\n---\n');
        window._tdQuiz=((c.quiz)||[]).map(function(q){ return {q:q.q||'',type:q.type||'mc',choices:(q.choices&&q.choices.length?q.choices.slice():['','','']),a:(q.a!=null?q.a:0),accept:q.accept||''}; });
        window._tdMats=((c.materials)||[]).map(function(m){ return {label:m.label||'',url:m.url||''}; });
        var h='<h3 style="margin:0 0 4px;color:#1f2a44;">'+(id?'Edit course':'New course')+'</h3>';
        h+=tdField('tdcTitle','Course title',c.title||'');
        h+=tdField('tdcSummary','Short summary',c.summary||'');
        h+=tdField('tdcVideo','Video link (YouTube, Vimeo, or .mp4) — optional',c.video_url||'');
        h+='<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">Lesson pages (separate each page with a line containing only ---)</label><textarea id="tdcPages" style="width:100%;height:120px;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;">'+escapeHtml(pagesText)+'</textarea>';
        h+='<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">Quiz questions</label><div id="tdcQuizWrap"></div><button onclick="tdQuizAdd()" style="width:100%;background:#eef3fb;color:#185FA5;border:none;border-radius:9px;padding:9px;font-size:13px;font-weight:700;cursor:pointer;margin-top:4px;">&#10133; Add question</button>';
        h+='<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">Materials &amp; resources &mdash; upload a file or paste a link. Images &amp; videos show right inside the lesson.</label><div id="tdcMatsWrap"></div><button onclick="tdMatUpload()" style="width:100%;background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:9px;font-size:13px;font-weight:700;cursor:pointer;margin-top:4px;">⬆ Upload a file</button><button onclick="tdMatAdd()" style="width:100%;background:#eef3fb;color:#185FA5;border:none;border-radius:9px;padding:9px;font-size:13px;font-weight:700;cursor:pointer;margin-top:4px;">&#10133; Add material</button>';
        h+='<div id="tdcMsg" style="font-size:12.5px;color:#c0264b;margin:6px 0;"></div>';
        h+='<div style="display:flex;gap:8px;"><button onclick="tdModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:11px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="tdSaveCourse('+pathId+','+(id||'null')+')" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">Save course</button></div>';
        tdModal(h);
        tdRenderQuizBuilder();
        tdRenderMats();
    }
    function tdSaveCourse(pathId,id){
        var t=tdVal('tdcTitle').trim(); if(!t){ document.getElementById('tdcMsg').textContent='Give it a title.'; return; }
        var pagesRaw=document.getElementById('tdcPages').value||'';
        var pages=pagesRaw.split(/\n-{3,}\n/).map(function(x){return x.trim();}).filter(function(x){return x.length;});
        tdQuizCapture(); var quiz=tdQuizClean(); var mats=tdMatsClean();
        withPin(function(pin){
            supabaseClient.rpc('app_lp_save_course',{p_username:currentUser.username,p_password:pin,p_id:(id||null),p_path_id:pathId,p_title:t,p_summary:tdVal('tdcSummary'),p_pages:pages,p_quiz:quiz,p_pass_pct:null,p_sort:null,p_active:true,p_video_url:tdVal('tdcVideo'),p_materials:mats}).then(function(r){
                if(r.error){ document.getElementById('tdcMsg').textContent=(String(r.error.message).indexOf('forbidden')>=0?'Managers only.':r.error.message); return; }
                tdModalClose(); tdLoad(function(){ _td.tab='paths'; tdRender(); });
            }).catch(function(){ document.getElementById('tdcMsg').textContent='Could not save.'; });
        });
    }
    var _tdQuiz=[];
    function tdQuizCapture(){ (_tdQuiz||[]).forEach(function(q,i){ var te=document.getElementById('tdq_'+i+'_text'); if(te) q.q=te.value; var ty=document.getElementById('tdq_'+i+'_type'); if(ty) q.type=ty.value; if(q.type==='mc'){ (q.choices||[]).forEach(function(c,ci){ var ce=document.getElementById('tdq_'+i+'_c'+ci); if(ce) q.choices[ci]=ce.value; }); var r=document.querySelector('input[name="tdq_'+i+'_correct"]:checked'); if(r) q.a=parseInt(r.value,10); } else if(q.type==='short'){ var ae=document.getElementById('tdq_'+i+'_accept'); if(ae) q.accept=ae.value; } }); }
    function tdRenderQuizBuilder(){ var wrap=document.getElementById('tdcQuizWrap'); if(!wrap) return; if(!_tdQuiz) _tdQuiz=[]; var h='';
        if(!_tdQuiz.length) h+='<div style="font-size:12.5px;color:#5b6675;padding:4px 0 8px;">No questions yet. Tap &ldquo;Add question&rdquo; below.</div>';
        _tdQuiz.forEach(function(q,i){ h+='<div style="border:1px solid #e6ebf2;border-radius:10px;padding:11px;margin-bottom:9px;background:#fbfcfe;">';
          h+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;"><b style="font-size:12px;color:#185FA5;">Q'+(i+1)+'</b><select id="tdq_'+i+'_type" onchange="tdQuizType('+i+',this.value)" style="flex:1;padding:6px;border:1px solid #ddd;border-radius:7px;font-size:12.5px;"><option value="mc"'+(q.type==='mc'?' selected':'')+'>Multiple choice</option><option value="short"'+(q.type==='short'?' selected':'')+'>Short answer</option><option value="long"'+(q.type==='long'?' selected':'')+'>Long response</option></select><button onclick="tdQuizDel('+i+')" style="background:none;border:none;color:#c0264b;font-size:17px;cursor:pointer;line-height:1;">&times;</button></div>';
          h+='<input id="tdq_'+i+'_text" value="'+String(q.q||'').replace(/"/g,'&quot;')+'" placeholder="Question" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:7px;font-size:13px;box-sizing:border-box;margin-bottom:6px;">';
          if(q.type==='mc'){ (q.choices||[]).forEach(function(c,ci){ h+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;"><input type="radio" name="tdq_'+i+'_correct" value="'+ci+'"'+(q.a===ci?' checked':'')+' title="Mark correct" style="width:16px;height:16px;"><input id="tdq_'+i+'_c'+ci+'" value="'+String(c||'').replace(/"/g,'&quot;')+'" placeholder="Choice '+(ci+1)+'" style="flex:1;padding:7px;border:1px solid #ddd;border-radius:7px;font-size:12.5px;">'+((q.choices.length>2)?'<button onclick="tdQuizChoiceDel('+i+','+ci+')" style="background:none;border:none;color:#c0264b;font-size:15px;cursor:pointer;">&times;</button>':'')+'</div>'; });
            h+='<button onclick="tdQuizChoiceAdd('+i+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:7px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;margin-top:2px;">+ Choice</button> <span style="font-size:11px;color:#5b6675;">select the dot = correct answer</span>'; }
          else if(q.type==='short'){ h+='<input id="tdq_'+i+'_accept" value="'+String(q.accept||'').replace(/"/g,'&quot;')+'" placeholder="Accepted answer (optional, enables auto-grading)" style="width:100%;padding:7px;border:1px solid #ddd;border-radius:7px;font-size:12.5px;box-sizing:border-box;">'; }
          else { h+='<div style="font-size:11.5px;color:#5b6675;">Trainee writes a paragraph. Counts as answered; reviewed by a manager (not auto-scored).</div>'; }
          h+='</div>'; });
        wrap.innerHTML=h; }
    function tdQuizAdd(){ tdQuizCapture(); _tdQuiz.push({q:'',type:'mc',choices:['','',''],a:0,accept:''}); tdRenderQuizBuilder(); }
    function tdQuizDel(i){ tdQuizCapture(); _tdQuiz.splice(i,1); tdRenderQuizBuilder(); }
    function tdQuizType(i,t){ tdQuizCapture(); _tdQuiz[i].type=t; if(t==='mc'&&(!_tdQuiz[i].choices||_tdQuiz[i].choices.length<2)) _tdQuiz[i].choices=['','','']; tdRenderQuizBuilder(); }
    function tdQuizChoiceAdd(i){ tdQuizCapture(); _tdQuiz[i].choices.push(''); tdRenderQuizBuilder(); }
    function tdQuizChoiceDel(i,ci){ tdQuizCapture(); _tdQuiz[i].choices.splice(ci,1); if(_tdQuiz[i].a>=_tdQuiz[i].choices.length) _tdQuiz[i].a=0; tdRenderQuizBuilder(); }
    function tdQuizClean(){ tdQuizCapture(); return (_tdQuiz||[]).filter(function(q){ return (q.q||'').trim(); }).map(function(q){ var o={q:q.q.trim(),type:q.type||'mc'}; if(o.type==='mc'){ o.choices=(q.choices||[]).map(function(c){return (c||'').trim();}).filter(function(c){return c.length;}); if(o.choices.length<2){ o.choices=(o.choices.concat(['Yes','No'])).slice(0,2); } o.a=Math.min(q.a||0,o.choices.length-1); } else if(o.type==='short'){ o.accept=(q.accept||'').trim(); } return o; }); }
    function tdRuleDesc(r){
        var who={everyone:'Everyone',role:'Role: '+(r.scope_value||'?'),store:'Store: '+(r.scope_value||'?'),newhire:'New hires'+(r.scope_value?(' ('+r.scope_value+')'):'')}[r.scope]||r.scope;
        return escapeHtml(who)+' &middot; due in '+(r.due_offset_days||14)+' days';
    }
    function tdRulesHtml(){
        var canEdit=(currentUser&&(currentUser.role==='Admin Manager'||currentUser.role==='Manager'||currentUser.role==='Vice President/Co-Owner'||currentUser.is_developer===true));
        var h='<div style="font-size:12px;color:#6b6275;margin-bottom:10px;">Rules auto-assign a path to the right people automatically &mdash; set once and it runs every morning. Perfect for onboarding new hires or rolling a course out to a whole role or store.</div>';
        if(canEdit){ h+='<div style="display:flex;gap:6px;margin-bottom:12px;"><button onclick="tdRuleForm(null)" style="flex:1;background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:800;cursor:pointer;">&#10133; New rule</button><button onclick="tdRunRules()" style="background:#1f7a3d;color:#fff;border:none;border-radius:10px;padding:11px 14px;font-size:13px;font-weight:800;cursor:pointer;">Run now</button></div>'; }
        if(!(_td.rules&&_td.rules.length)){ return h+'<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:18px;text-align:center;color:#6b6275;">No auto-assign rules yet.</div>'; }
        _td.rules.forEach(function(r){
            h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px 14px;margin-bottom:9px;box-shadow:0 2px 6px rgba(0,0,0,.04);"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(r.path_title||('Path '+r.path_id))+'</b>'+(r.active?'<span style="background:#e8f5ec;color:#1b7a3d;font-size:11px;font-weight:800;padding:2px 8px;border-radius:99px;">On</span>':'<span style="background:#eef0f3;color:#5b6675;font-size:11px;font-weight:800;padding:2px 8px;border-radius:99px;">Off</span>')+'</div><div style="font-size:12px;color:#6b7686;margin-top:3px;">'+tdRuleDesc(r)+'</div>'+(canEdit?'<div style="margin-top:7px;display:flex;gap:6px;"><button onclick="tdRuleForm('+r.id+')" style="background:#f4f5f8;color:#5b6472;border:none;border-radius:7px;padding:5px 11px;font-size:12px;cursor:pointer;">Edit</button><button onclick="tdRemoveRule('+r.id+')" style="background:none;border:none;color:#c0264b;font-size:12px;cursor:pointer;">Remove</button></div>':'')+'</div>';
        });
        return h;
    }
    function tdRuleForm(id){
        var r=id?(_td.rules.filter(function(x){return x.id===id;})[0]||{}):{scope:'newhire',due_offset_days:14,active:true};
        var pathOpts=(_td.catalog||[]).map(function(p){return '<option value="'+p.id+'"'+(r.path_id===p.id?' selected':'')+'>'+escapeHtml(p.title)+'</option>';}).join('');
        var roles={}; (_td.team||[]).forEach(function(e){ if(e.role) roles[e.role]=1; });
        window._trRoles=Object.keys(roles); window._trStores=((typeof HUB_STORES!=='undefined'?HUB_STORES.slice():['Roadrunner','Valley','Lenox','Alamogordo','Roswell']).concat(['Warehouse'])); window._trVal=r.scope_value||'';
        var h='<h3 style="margin:0 0 12px;color:#1f2a44;">'+(id?'Edit rule':'New auto-assign rule')+'</h3>';
        h+='<label style="display:block;font-size:12px;color:#6b7686;margin-bottom:3px;">Path to assign</label><select id="trPath" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin-bottom:10px;box-sizing:border-box;">'+pathOpts+'</select>';
        h+='<label style="display:block;font-size:12px;color:#6b7686;margin-bottom:3px;">Assign to</label><select id="trScope" onchange="tdRuleScopeChange()" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin-bottom:10px;box-sizing:border-box;"><option value="newhire"'+(r.scope==='newhire'?' selected':'')+'>New hires (auto-onboard)</option><option value="role"'+(r.scope==='role'?' selected':'')+'>A role</option><option value="store"'+(r.scope==='store'?' selected':'')+'>A store</option><option value="everyone"'+(r.scope==='everyone'?' selected':'')+'>Everyone</option></select>';
        h+='<div id="trValueWrap"></div>';
        h+='<label style="display:block;font-size:12px;color:#6b7686;margin:4px 0 3px;">Due within (days)</label><input id="trDue" type="number" value="'+(r.due_offset_days!=null?r.due_offset_days:14)+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin-bottom:10px;box-sizing:border-box;">';
        h+='<label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:10px;cursor:pointer;"><input type="checkbox" id="trActive"'+((r.active!==false)?' checked':'')+'> Rule is on</label>';
        h+='<div id="trMsg" style="font-size:12.5px;color:#c0264b;margin:6px 0;"></div>';
        h+='<div style="display:flex;gap:8px;"><button onclick="tdModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:11px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="tdSaveRule('+(id||'null')+')" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">Save rule</button></div>';
        tdModal(h); tdRuleScopeChange();
    }
    function tdRuleScopeChange(){
        var scEl=document.getElementById('trScope'); if(!scEl) return; var sc=scEl.value; var wrap=document.getElementById('trValueWrap'); if(!wrap) return; var val=window._trVal||'';
        if(sc==='role'){ wrap.innerHTML='<label style="display:block;font-size:12px;color:#6b7686;margin-bottom:3px;">Which role</label><select id="trValue" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin-bottom:10px;box-sizing:border-box;">'+(window._trRoles||[]).map(function(x){return '<option'+(x===val?' selected':'')+'>'+escapeHtml(x)+'</option>';}).join('')+'</select>'; }
        else if(sc==='store'){ wrap.innerHTML='<label style="display:block;font-size:12px;color:#6b7686;margin-bottom:3px;">Which store</label><select id="trValue" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin-bottom:10px;box-sizing:border-box;">'+(window._trStores||[]).map(function(x){return '<option'+(x===val?' selected':'')+'>'+escapeHtml(x)+'</option>';}).join('')+'</select>'; }
        else if(sc==='newhire'){ wrap.innerHTML='<label style="display:block;font-size:12px;color:#6b7686;margin-bottom:3px;">Limit to a role (optional)</label><select id="trValue" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin-bottom:10px;box-sizing:border-box;"><option value="">Any new hire</option>'+(window._trRoles||[]).map(function(x){return '<option'+(x===val?' selected':'')+'>'+escapeHtml(x)+'</option>';}).join('')+'</select>'; }
        else { wrap.innerHTML=''; }
    }
    function tdSaveRule(id){
        var path=parseInt((document.getElementById('trPath')||{}).value,10); var scope=(document.getElementById('trScope')||{}).value;
        var val=(document.getElementById('trValue')||{}).value||''; var due=parseInt((document.getElementById('trDue')||{}).value,10); if(isNaN(due))due=14;
        var active=(document.getElementById('trActive')||{}).checked;
        if(!path){ document.getElementById('trMsg').textContent='Pick a path.'; return; }
        withPin(function(pin){
            supabaseClient.rpc('app_lp_rule_save',{p_username:currentUser.username,p_password:pin,p_id:(id||null),p_path_id:path,p_scope:scope,p_scope_value:val,p_due_offset:due,p_active:active}).then(function(r){
                if(r.error){ document.getElementById('trMsg').textContent=(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; }
                tdModalClose(); tdLoad(function(){ _td.tab='rules'; tdRender(); });
            }).catch(function(){ document.getElementById('trMsg').textContent='Could not save.'; });
        });
    }
    function tdRemoveRule(id){ if(!confirm('Remove this auto-assign rule? People already assigned keep their training.')) return; withPin(function(pin){ supabaseClient.rpc('app_lp_rule_remove',{p_username:currentUser.username,p_password:pin,p_id:id}).then(function(r){ if(r.error){ alert(r.error.message); return; } tdLoad(function(){ _td.tab='rules'; tdRender(); }); }); }); }
    function tdRunRules(){ withPin(function(pin){ supabaseClient.rpc('app_lp_rules_run',{p_username:currentUser.username,p_password:pin}).then(function(r){ if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; } alert('Auto-assign ran — '+((r.data&&r.data.assigned)||0)+' new assignment(s) created.'); tdLoad(function(){ _td.tab='rules'; tdRender(); }); }); }); }
    var _tdMats=[];
    function tdMatCapture(){ (_tdMats||[]).forEach(function(m,i){ var l=document.getElementById('tdm_'+i+'_label'); if(l) m.label=l.value; var u=document.getElementById('tdm_'+i+'_url'); if(u) m.url=u.value; }); }
    function tdRenderMats(){ var wrap=document.getElementById('tdcMatsWrap'); if(!wrap) return; if(!_tdMats) _tdMats=[]; var h='';
        if(!_tdMats.length) h+='<div style="font-size:12px;color:#5b6675;padding:2px 0 6px;">Optional. Upload or link a PDF, image, audio, or video. Images and videos play right inside the lesson, and videos track watch progress.</div>';
        _tdMats.forEach(function(m,i){ h+='<div style="display:flex;gap:6px;margin-bottom:5px;align-items:center;"><input id="tdm_'+i+'_label" value="'+String(m.label||'').replace(/"/g,'&quot;')+'" placeholder="Label (e.g. Recipe PDF)" style="flex:1;padding:7px;border:1px solid #ddd;border-radius:7px;font-size:12.5px;box-sizing:border-box;"><input id="tdm_'+i+'_url" value="'+String(m.url||'').replace(/"/g,'&quot;')+'" placeholder="https://link-to-file" style="flex:1.4;padding:7px;border:1px solid #ddd;border-radius:7px;font-size:12.5px;box-sizing:border-box;"><button onclick="tdMatDel('+i+')" style="background:none;border:none;color:#c0264b;font-size:16px;cursor:pointer;line-height:1;">&times;</button></div>'; });
        wrap.innerHTML=h; }
    function tdMatAdd(){ tdMatCapture(); _tdMats.push({label:'',url:''}); tdRenderMats(); }
    function tdMatDel(i){ tdMatCapture(); _tdMats.splice(i,1); tdRenderMats(); }
    function tdMatsClean(){ tdMatCapture(); return (_tdMats||[]).filter(function(m){ return (m.url||'').trim(); }).map(function(m){ return {label:(m.label||'').trim()||(m.url||'').trim(),url:(m.url||'').trim()}; }); }
    function lmsMatIcon(u){ u=String(u||'').toLowerCase(); if(/\.pdf(\?|#|$)/.test(u)) return '📄'; if(/\.(jpg|jpeg|png|gif|webp)(\?|#|$)/.test(u)) return '🖼️'; if(/\.(mp3|wav|m4a|ogg)(\?|#|$)/.test(u)) return '🎧'; if(/\.(mp4|mov|webm)(\?|#|$)/.test(u)) return '🎬'; if(/\.(doc|docx)(\?|#|$)/.test(u)) return '📝'; if(/\.(xls|xlsx|csv)(\?|#|$)/.test(u)) return '📊'; if(/\.(ppt|pptx)(\?|#|$)/.test(u)) return '📑'; return '🔗'; }
    function lmsMatType(u){ u=String(u||'').toLowerCase(); if(/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|#|$)/.test(u)) return 'image'; if(/\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/.test(u)||/youtube\.com|youtu\.be|vimeo\.com/.test(u)) return 'video'; if(/\.(mp3|wav|m4a|aac|oga)(\?|#|$)/.test(u)) return 'audio'; if(/\.pdf(\?|#|$)/.test(u)) return 'pdf'; return 'file'; }
    function lmsMatsHtml(c){ var m=(c&&c.materials)||[]; if(!m.length) return '';
        var h='<div style="margin-top:16px;">';
        m.forEach(function(x){ var url=x.url||''; var lbl=x.label||url; var ty=lmsMatType(url); h+='<div style="margin-top:12px;">';
          if(lbl && ty!=='file') h+='<div style="font-size:12px;font-weight:700;color:#6b7686;margin-bottom:5px;">'+escapeHtml(lbl)+'</div>';
          if(ty==='image') h+='<img src="'+escapeHtml(url)+'" alt="'+escapeHtml(lbl)+'" style="width:100%;border-radius:12px;border:1px solid #eef0f5;display:block;">';
          else if(ty==='video') h+=lmsVideoEmbed(url);
          else if(ty==='audio') h+='<audio controls preload="metadata" style="width:100%;" src="'+escapeHtml(url)+'"></audio>';
          else if(ty==='pdf') h+='<div style="border:1px solid #eef0f5;border-radius:12px;overflow:hidden;"><iframe src="'+escapeHtml(url)+'" style="width:100%;height:460px;border:0;display:block;"></iframe></div><a href="'+escapeHtml(url)+'" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;font-size:12.5px;color:#185FA5;font-weight:700;text-decoration:none;">Open '+escapeHtml(lbl)+' &#8599;</a>';
          else h+='<a href="'+escapeHtml(url)+'" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fff;border:1px solid #e6e6ee;border-radius:9px;text-decoration:none;color:#185FA5;font-size:13px;font-weight:700;"><span>'+lmsMatIcon(url)+'</span><span style="flex:1;">'+escapeHtml(lbl)+'</span><span style="color:#5b6675;">&#8599;</span></a>';
          h+='</div>'; });
        return h+'</div>'; }
    function tdMatUpload(){
        var inp=document.createElement('input'); inp.type='file'; inp.accept='image/*,video/*,audio/*,application/pdf';
        inp.onchange=function(){ var f=inp.files&&inp.files[0]; if(!f) return;
            if(f.size>524288000){ alert('That file is over 500 MB. Please compress or trim it first.'); return; }
            var st=document.getElementById('tdcMsg'); function say(t,c){ if(st){ st.style.color=c||'#185FA5'; st.textContent=t; } }
            say('Preparing upload for '+f.name+'…');
            withPin(function(pin){
                supabaseClient.functions.invoke('material-upload',{body:{username:currentUser.username,pin:pin,filename:f.name,contentType:f.type||'application/octet-stream'}}).then(function(res){
                    var err=(res&&res.error)?res.error.message:((res&&res.data&&res.data.error)?res.data.error:null);
                    if(err){ say('',''); alert('Upload failed: '+(String(err).indexOf('forbidden')>=0?'managers only':err)); return; }
                    var d=res&&res.data; if(!d||!d.token){ say('',''); alert('Upload could not start.'); return; }
                    say('Uploading '+f.name+'… (large videos can take a minute)');
                    supabaseClient.storage.from('training-materials').uploadToSignedUrl(d.path,d.token,f,{contentType:f.type||undefined}).then(function(up){
                        if(up.error){ say('',''); alert('Upload failed: '+up.error.message); return; }
                        tdMatCapture(); _tdMats.push({label:f.name,url:d.url}); tdRenderMats(); say('Added '+f.name+' ✓','#1b7a3d'); setTimeout(function(){ say('',''); },2200);
                    }).catch(function(){ say('',''); alert('Upload failed during transfer.'); });
                }).catch(function(){ say('',''); alert('Upload failed.'); });
            });
        };
        inp.click();
    }
    function tdArchive(kind,id,name){
        if(!confirm('Archive this '+kind+'? Staff will no longer see it. (Hidden, not deleted.)')) return;
        withPin(function(pin){ supabaseClient.rpc('app_lp_archive',{p_username:currentUser.username,p_password:pin,p_kind:kind,p_id:id}).then(function(r){ if(r.error){ alert(r.error.message); return; } tdLoad(function(){ _td.tab='paths'; tdRender(); }); }); });
    }
    function tdAssign(pathId){
        var p=_td.catalog.filter(function(x){return x.id===pathId;})[0]||{};
        var roles={}; _td.team.forEach(function(e){ if(e.role) roles[e.role]=1; });
        var h='<h3 style="margin:0 0 4px;color:#1f2a44;">Assign: '+escapeHtml(p.title||'')+'</h3><div style="font-size:12px;color:#6b6275;margin-bottom:10px;">Pick people, or assign to a whole role.</div>';
        h+='<label style="display:block;font-size:12px;color:#6b7686;margin-bottom:3px;">Whole role (optional)</label><select id="tdaRole" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:13px;margin-bottom:10px;box-sizing:border-box;"><option value="">&mdash; specific people below &mdash;</option>'+Object.keys(roles).map(function(r){return '<option>'+escapeHtml(r)+'</option>';}).join('')+'</select>';
        h+='<label style="display:block;font-size:12px;color:#6b7686;margin-bottom:3px;">People</label><div style="max-height:200px;overflow:auto;border:1px solid #eef0f5;border-radius:9px;padding:8px;margin-bottom:10px;">'+_td.team.map(function(e){return '<label style="display:flex;align-items:center;gap:8px;padding:5px;font-size:13px;cursor:pointer;"><input type="checkbox" class="tdaEmp" value="'+e.employee_id+'"> '+escapeHtml(e.name||'')+' <span style="color:#5b6675;font-size:11px;">'+escapeHtml(e.role||'')+'</span></label>';}).join('')+'</div>';
        h+=tdField('tdaDue','Due date (optional)','','YYYY-MM-DD');
        h+='<div id="tdaMsg" style="font-size:12.5px;color:#c0264b;margin:6px 0;"></div>';
        h+='<div style="display:flex;gap:8px;"><button onclick="tdModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:11px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="tdDoAssign('+pathId+')" style="flex:2;background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">Assign</button></div>';
        tdModal(h);
    }
    function tdDoAssign(pathId){
        var ids=[].slice.call(document.querySelectorAll('.tdaEmp:checked')).map(function(c){return parseInt(c.value,10);});
        var role=tdVal('tdaRole'); var due=tdVal('tdaDue')||null;
        if(!ids.length && !role){ document.getElementById('tdaMsg').textContent='Pick at least one person or a role.'; return; }
        withPin(function(pin){
            supabaseClient.rpc('app_lp_assign',{p_username:currentUser.username,p_password:pin,p_path_id:pathId,p_employee_ids:ids,p_role:role,p_due:due}).then(function(r){
                if(r.error){ document.getElementById('tdaMsg').textContent=(String(r.error.message).indexOf('forbidden')>=0?'Managers only.':r.error.message); return; }
                tdModalClose(); alert('Assigned to '+((r.data&&r.data.count)||0)+' people.'); tdLoad(function(){ tdRender(); });
            }).catch(function(){ document.getElementById('tdaMsg').textContent='Could not assign.'; });
        });
    }
    function tdPromoHtml(){
        var canEdit=(currentUser&&(currentUser.role==='Admin Manager'||currentUser.role==='Vice President/Co-Owner'||currentUser.is_developer===true));
        var h='';
        if(canEdit) h+='<button onclick="tdEditReq(null)" style="width:100%;background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:800;cursor:pointer;margin-bottom:12px;">&#10133; Define a promotion requirement</button>';
        if(!_td.reqs.length){ return h+'<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:18px;text-align:center;color:#6b6275;">No promotion requirements yet.'+(canEdit?'':' Ask an admin to add them.')+'</div>'; }
        _td.reqs.forEach(function(rq){
            var ready=0, totalPpl=_td.team.length;
            _td.team.forEach(function(e){ if(tdTeamReady(rq,e)) ready++; });
            h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,.04);"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:15px;color:#26242b;">'+escapeHtml(rq.role||'')+'</b>'+(canEdit?'<button onclick="tdEditReq('+rq.id+')" style="background:#f4f5f8;color:#5b6472;border:none;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;">Edit</button>':'')+'</div>';
            if(rq.notes) h+='<div style="font-size:12px;color:#6b6275;margin:3px 0;">'+escapeHtml(rq.notes)+'</div>';
            h+='<div style="font-size:12px;color:#185FA5;margin-top:5px;font-weight:700;">'+ready+' of '+totalPpl+' ready (paths + positions)</div>';
            var names=_td.team.filter(function(e){return tdTeamReady(rq,e);}).map(function(e){return escapeHtml(e.name);});
            if(names.length) h+='<div style="font-size:12px;color:#1b7a3d;margin-top:4px;">Ready: '+names.join(', ')+'</div>';
            h+='</div>';
        });
        h+='<div style="font-size:11.5px;color:#5b6675;text-align:center;margin-top:4px;">Open a person on the Team tab to verify certifications too.</div>';
        return h;
    }
    function tdTeamReady(rq,e){
        var ok=true; var reqPaths=rq.required_path_ids||[]; var paths=e.paths||[];
        reqPaths.forEach(function(pid){ var pp=paths.filter(function(x){return x.path_id===pid;})[0]; if(!(pp&&pp.total>0&&pp.done>=pp.total)) ok=false; });
        if((rq.min_cleared_positions||0)>(e.cleared_positions||0)) ok=false;
        return ok;
    }
    function tdEditReq(id){
        var rq=id?(_td.reqs.filter(function(x){return x.id===id;})[0]||{}):{};
        var sel=rq.required_path_ids||[];
        var h='<h3 style="margin:0 0 12px;color:#1f2a44;">'+(id?'Edit requirement':'New promotion requirement')+'</h3>';
        h+=tdField('tdrRole','Role being qualified for',rq.role||'');
        h+='<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">Required paths</label><div style="border:1px solid #eef0f5;border-radius:9px;padding:8px;margin-bottom:10px;">'+(_td.catalog.length?_td.catalog.map(function(p){return '<label style="display:flex;align-items:center;gap:8px;padding:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="tdrPath" value="'+p.id+'"'+(sel.indexOf(p.id)>=0?' checked':'')+'> '+escapeHtml(p.title)+'</label>';}).join(''):'<span style="font-size:12px;color:#5b6675;">No paths yet.</span>')+'</div>';
        h+=tdField('tdrCerts','Required cert types (comma-separated)',(rq.required_cert_types||[]).join(', '));
        h+=tdField('tdrMin','Min positions cleared',(rq.min_cleared_positions!=null?rq.min_cleared_positions:0));
        h+=tdField('tdrNotes','Notes',rq.notes||'');
        h+='<div id="tdrMsg" style="font-size:12.5px;color:#c0264b;margin:6px 0;"></div>';
        h+='<div style="display:flex;gap:8px;"><button onclick="tdModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:11px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="tdSaveReq()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">Save</button></div>';
        tdModal(h);
    }
    function tdSaveReq(){
        var role=tdVal('tdrRole').trim(); if(!role){ document.getElementById('tdrMsg').textContent='Enter a role.'; return; }
        var paths=[].slice.call(document.querySelectorAll('.tdrPath:checked')).map(function(c){return parseInt(c.value,10);});
        var certs=tdVal('tdrCerts').split(',').map(function(x){return x.trim();}).filter(function(x){return x.length;});
        var minc=parseInt(tdVal('tdrMin'),10); if(isNaN(minc))minc=0;
        withPin(function(pin){
            supabaseClient.rpc('app_lp_requirements_save',{p_username:currentUser.username,p_password:pin,p_role:role,p_required_path_ids:paths,p_required_cert_types:certs,p_min_cleared:minc,p_notes:tdVal('tdrNotes')}).then(function(r){
                if(r.error){ document.getElementById('tdrMsg').textContent=(String(r.error.message).indexOf('forbidden')>=0?'Admin managers only.':r.error.message); return; }
                tdModalClose(); tdLoad(function(){ _td.tab='promos'; tdRender(); });
            }).catch(function(){ document.getElementById('tdrMsg').textContent='Could not save.'; });
        });
    }