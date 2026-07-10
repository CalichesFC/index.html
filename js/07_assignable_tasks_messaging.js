    // ============================================================
    // ASSIGNABLE TASKS + MESSAGING
    // ============================================================
    function socFmt(s){ if(!s) return ''; try{ var d=new Date(s); return d.toLocaleDateString([], {month:'short',day:'numeric'})+' '+d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }catch(e){ return s; } }

    // ---- Multi-store context ----
    var myStores=[];
    function activeStoreLoc(){ return (currentUser&&currentUser.activeStore) || (myStores[0]&&myStores[0].location) || ''; }
    function refreshMyStores(){
        if(!currentUser||!currentUser.username) return;
        withPin(function(pin){
            supabaseClient.rpc('app_my_stores',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; return; }
                var d=r.data||{}; if(d.linked===false){ myStores=[]; return; }
                myStores=d.stores||[];
                var role=currentUser.role; if(role==='Vice President/Co-Owner') role='Admin Manager';
                var isAdmin=(d.is_admin===true)||(role==='Admin Manager')||(currentUser.is_developer===true);
                currentUser.isAdminStores=isAdmin;
                currentUser.isStoreManager=isAdmin||myStores.some(function(s){return s.role==='store_manager'||s.role==='assistant_manager';});
                // Admin managers can view every store, not just their assigned ones
                var locs=isAdmin?SCHED_LOCATIONS.slice():myStores.map(function(s){return s.location;});
                var saved=null; try{ saved=localStorage.getItem('calichesActiveStore'); }catch(e){}
                currentUser.activeStore=(saved&&locs.indexOf(saved)>-1)?saved:(locs[0]||'');
                var sel=document.getElementById('storeSelect'); if(sel) sel.innerHTML=locs.map(function(l){return '<option value="'+l.replace(/"/g,'')+'"'+(l===currentUser.activeStore?' selected':'')+'>'+escapeHtml(l)+'</option>';}).join('');
                var sw=document.getElementById('storeSwitcher'); if(sw) sw.style.display=(locs.length>1)?'flex':'none';
                if(currentUser.isStoreManager){ var mt=document.getElementById('tab-management'); if(mt) mt.style.display='flex';
                    var pib=document.getElementById('btn-popIn'); if(pib) pib.style.display='block';
                    var inb=document.getElementById('btn-inventory'); if(inb) inb.style.display='block';
                    var atb2=document.getElementById('btn-attendance'); if(atb2) atb2.style.display='block'; }
                var atb=document.getElementById('assignTaskBtn'); if(atb&&currentUser.isStoreManager) atb.style.display='block';
                var rqb=document.getElementById('requestsBtn'); if(rqb&&currentUser.isStoreManager) rqb.style.display='block';
            });
        });
    }
    function setActiveStore(loc){ currentUser.activeStore=loc; try{ localStorage.setItem('calichesActiveStore', loc); }catch(e){} var mv=document.getElementById('messagesView'); if(mv&&mv.style.display==='block'&&msgTab==='store') loadStoreFeed(); }

    // ---- My Tasks (Employee Home) ----
    var myTasksCardId='empTasksCard';
    // ===== Celebrations (birthdays, anniversaries, achievements) =====
    var celebQueue=[]; var celebIndex=0; var celebConfetti=null; var _celChecked=false;
    function celebMascotImg(m){ var map={scoopy:'scoopy-cheer.png',cherry:'cherry-thumbsup.png',poochie:'poochie-point.png'}; return map[(m||'scoopy').toLowerCase()]||'scoopy-cheer.png'; }
    function celebCapWords(s){ return (s||'').replace(/\b\w/g,function(ch){return ch.toUpperCase();}); }
    function celebTitle(c){ var first=c.first||((c.name||'').split(' ')[0])||''; if(c.kind==='birthday') return '🎂 Happy Birthday, '+first+'!'; if(c.kind==='milestone'){ var l=(c.label||''); if(l.indexOf('year')>-1) return "🎉 "+celebCapWords(l)+" with Caliche's!"; return '🏅 '+celebCapWords(l)+' strong!'; } return '⭐ '+(c.label||'Achievement')+'!'; }
    function celebFire(){ try{ var cv=document.getElementById('celebCanvas'); if(!celebConfetti && window.confetti && window.confetti.create){ celebConfetti=window.confetti.create(cv,{resize:true,useWorker:true}); } var C=['#ec3e7e','#106ab3','#eee441','#7b2d8b','#ff2e8a']; if(celebConfetti){ celebConfetti({particleCount:130,spread:90,startVelocity:46,origin:{y:0.6},colors:C,zIndex:5}); celebConfetti({particleCount:60,angle:60,spread:70,origin:{x:0,y:0.7},colors:C}); celebConfetti({particleCount:60,angle:120,spread:70,origin:{x:1,y:0.7},colors:C}); } }catch(e){} }
    function celebShow(){ if(!window._celEsc){ window._celEsc=true; try{ document.addEventListener('keydown', function(e){ if(e.key==='Escape'||e.keyCode===27){ var o=document.getElementById('celebrationOverlay'); if(o && o.style.display!=='none') celebDismiss(); } }); }catch(e){} } var c=celebQueue[celebIndex]; var ov=document.getElementById('celebrationOverlay'); if(!c){ if(ov) ov.style.display='none'; return; } var im=document.getElementById('celebImg'); im.src=celebMascotImg(c.mascot); im.style.display='block'; document.getElementById('celebTitle').textContent=celebTitle(c); document.getElementById('celebBody').textContent=c.message||''; ov.style.display='flex'; var card=document.getElementById('celebCard'); card.style.animation='none'; void card.offsetWidth; card.style.animation='calPop .5s cubic-bezier(.18,1.5,.4,1) both'; setTimeout(celebFire,160); }
    function celebSeenLocal(){ try{ return JSON.parse(localStorage.getItem('calichesCelebSeen')||'[]'); }catch(e){ return []; } }
    function celebMarkSeenLocal(id){ try{ if(id==null) return; var a=celebSeenLocal(); var k=String(id); if(a.indexOf(k)<0){ a.push(k); if(a.length>300) a=a.slice(-300); localStorage.setItem('calichesCelebSeen', JSON.stringify(a)); } }catch(e){} }
    function celebNext(){ var c=celebQueue[celebIndex]; if(c){ celebMarkSeenLocal(c.id); try{ if(sessionPin){ supabaseClient.rpc('app_celebration_seen',{p_username:currentUser.username,p_password:sessionPin,p_id:c.id}).catch(function(){}); } }catch(e){} } celebIndex++; if(celebIndex<celebQueue.length){ celebShow(); } else { var ov=document.getElementById('celebrationOverlay'); if(ov) ov.style.display='none'; } }
    function celebDismiss(){ var ov=document.getElementById('celebrationOverlay'); if(ov) ov.style.display='none'; try{ (celebQueue||[]).forEach(function(c){ if(c){ celebMarkSeenLocal(c.id); try{ if(sessionPin){ supabaseClient.rpc('app_celebration_seen',{p_username:currentUser.username,p_password:sessionPin,p_id:c.id}).catch(function(){}); } }catch(e){} } }); }catch(e){} celebQueue=[]; celebIndex=0; }
    function checkCelebrations(){ if(!currentUser||!currentUser.username||!sessionPin) return; supabaseClient.rpc('app_my_celebrations',{p_username:currentUser.username,p_password:sessionPin}).then(function(r){ if(r.error||!r.data||!r.data.length) return; var seen=celebSeenLocal(); celebQueue=r.data.filter(function(c){ return c && seen.indexOf(String(c.id))<0; }); celebIndex=0; if(celebQueue.length) celebShow(); }).catch(function(){}); }
    // ---- Celebrations management view (managers) ----
    var celebKindIcon={birthday:'🎂',anniversary:'🎉',milestone:'🎉',custom:'⭐'};
    function openCelebrations(){
        openForm('celebrationsView');
        var addCard=document.getElementById('celebAddCard');
        var adm=(typeof isAdminManager==='function' && isAdminManager());
        if(addCard) addCard.style.display=adm?'block':'none';
        loadUpcomingCelebrations();
        if(adm) celebFillEmployees();
    }
    function loadUpcomingCelebrations(){
        var box=document.getElementById('celebUpcomingList'); if(!box) return;
        box.innerHTML='<p style="color:#6b7686;font-size:13px;">Loading&hellip;</p>';
        withPin(function(pin){
            supabaseClient.rpc('app_upcoming_celebrations',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ box.innerHTML='<p style="color:#c0264b;font-size:13px;">Could not load ('+(r.error.message||'error')+').</p>'; return; }
                var rows=r.data||[]; if(rows.length&&rows[0]&&rows[0].items) rows=rows[0].items;
                if(!rows.length){ box.innerHTML='<p style="color:#6b7686;font-size:13px;">Nothing in the next 30 days.</p>'; return; }
                var h=''; var today=new Date(); today.setHours(0,0,0,0);
                rows.forEach(function(c){
                    var nm=c.name||c.employee_name||'—';
                    var kind=(c.kind||'').toLowerCase();
                    var ic=celebKindIcon[kind]||'🎉';
                    var lbl=c.label||(kind==='birthday'?'Birthday':'Anniversary');
                    var dateStr=c.on_date||c.event_date||c.next_date||'';
                    var d=null; if(dateStr){ var dt=new Date(dateStr+'T00:00:00'); if(!isNaN(dt)) d=Math.round((dt-today)/86400000); }
                    var when=(d==null?'':(d<=0?'<b style="color:#c0264b;">Today</b>':(d===1?'Tomorrow':'in '+d+' days')));
                    h+='<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid #f0edf5;">'+
                       '<span style="font-size:20px;">'+ic+'</span>'+
                       '<div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:14px;color:#26242b;">'+escapeHtml(nm)+'</div>'+
                       '<div style="font-size:12px;color:#6b6275;">'+escapeHtml(lbl)+(dateStr?' &middot; '+escapeHtml(dateStr):'')+'</div></div>'+
                       '<div style="font-size:12px;color:#5b6472;white-space:nowrap;">'+when+'</div></div>';
                });
                box.innerHTML=h;
            }).catch(function(e){ box.innerHTML='<p style="color:#c0264b;font-size:13px;">Could not load.</p>'; });
        });
    }
    function celebFillEmployees(){
        var sel=document.getElementById('celebEmp'); if(!sel) return;
        var list=(typeof rosterState!=='undefined'&&rosterState&&rosterState.list)?rosterState.list:null;
        function fill(arr){ var cur=sel.value; sel.innerHTML='<option value="">Select&hellip;</option>'+arr.filter(function(e){return e.active!==false;}).map(function(e){ return '<option value="'+e.id+'">'+escapeHtml(e.name||('#'+e.id))+'</option>'; }).join(''); sel.value=cur; }
        if(list&&list.length){ fill(list); return; }
        withPin(function(pin){ supabaseClient.rpc('app_roster_list',{p_username:currentUser.username,p_password:pin}).then(function(r){ if(r.error||!r.data) return; var arr=r.data.employees||r.data||[]; fill(arr); }).catch(function(){}); });
    }
    function celebAddAchievement(){
        var emp=document.getElementById('celebEmp').value;
        var label=(document.getElementById('celebLabel').value||'').trim();
        var mascot=document.getElementById('celebMascot').value||'scoopy';
        var msg=(document.getElementById('celebMsg').value||'').trim();
        var out=document.getElementById('celebAddMsg');
        if(!emp){ out.style.color='#c0264b'; out.textContent='Pick an employee.'; return; }
        if(!label){ out.style.color='#c0264b'; out.textContent='Enter an achievement name.'; return; }
        out.style.color='#5b6472'; out.textContent='Saving…';
        withPin(function(pin){
            supabaseClient.rpc('app_achievement_add',{p_username:currentUser.username,p_password:pin,p_employee_id:parseInt(emp,10),p_label:label,p_mascot:mascot,p_message:msg||null}).then(function(r){
                if(r.error){ out.style.color='#c0264b'; out.textContent='Error: '+(r.error.message||'failed'); return; }
                out.style.color='#1c7c3a'; out.textContent='✓ Added — '+ (document.getElementById('celebEmp').selectedOptions[0]||{}).text +' will see it on next open.';
                document.getElementById('celebLabel').value=''; document.getElementById('celebMsg').value='';
                loadUpcomingCelebrations();
            }).catch(function(e){ out.style.color='#c0264b'; out.textContent='Error saving.'; });
        });
    }
    // ===== Recognition / Shout-Outs =====
    var RECOG_TYPES = { shoutout:'🎉 Shout-out', compliment:'💛 Customer compliment', greatwork:'⭐ Great work', welcome:'👋 Welcome', congrats:'🎊 Congrats', anniversary:'🎂 Anniversary', award:'🏅 Mr. Scoopy Award' };
    function recogTypeLabel(t){ return RECOG_TYPES[(t||'shoutout')] || '🎉 Shout-out'; }
    function recogIcon(t){ return recogTypeLabel(t).split(' ')[0]; }
    function loadRecognition(){
        var box=document.getElementById('homeRecognition'); if(!box || !currentUser || !sessionPin) return;
        supabaseClient.rpc('app_recognition_feed',{p_username:currentUser.username,p_password:sessionPin}).then(function(r){
            if(r.error){ if(r.error.code==='42501') sessionPin=null; box.innerHTML=_hubRetryHtml('Couldn&rsquo;t load shout-outs','loadRecognition()'); return; }
            var items=r.data||[]; var mgr=(typeof isManagerRole==='function' && isManagerRole());
            var h='<div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">'+
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'+
                '<span style="font-size:15px;font-weight:700;color:#7d1d4b;">🎉 Shout-Outs &amp; Wins</span>'+
                '<button onclick="openShoutout()" style="background:var(--caliches-pink);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:bold;cursor:pointer;">+ Give a shout-out</button></div>';
            if(mgr) h+='<div id="recogPendingBar" style="display:none;margin-bottom:10px;"></div>';
            if(!items.length){ h+='<p style="color:#6b7686;font-size:13px;margin:0;">No shout-outs yet — be the first! 💛</p>'; }
            else items.slice(0,5).forEach(function(it){
                h+='<div style="display:flex;gap:10px;padding:8px 2px;border-bottom:1px solid #f0edf5;">'+
                   '<span style="font-size:20px;">'+recogIcon(it.type)+'</span>'+
                   '<div style="flex:1;min-width:0;"><div style="font-size:13.5px;color:#26242b;">'+
                   (it.about?('<b>'+escapeHtml(it.about)+'</b> — '):'')+escapeHtml(it.message||'')+'</div>'+
                   '<div style="font-size:11px;color:#6b6275;">'+escapeHtml(recogTypeLabel(it.type).replace(/^\S+\s/,''))+' · from '+escapeHtml(it.from||"Caliche's")+'</div></div></div>';
            });
            h+='</div>'; box.innerHTML=h;
            if(mgr) loadRecogPending();
        }).catch(function(){ box.innerHTML=_hubRetryHtml('Couldn&rsquo;t load shout-outs','loadRecognition()'); });
    }
    function loadRecogPending(){
        if(!sessionPin) return;
        supabaseClient.rpc('app_recognition_pending',{p_username:currentUser.username,p_password:sessionPin}).then(function(r){
            if(r.error||!r.data||!r.data.length) return;
            var bar=document.getElementById('recogPendingBar'); if(!bar) return; bar.style.display='block';
            bar.innerHTML='<div style="background:#fff7ed;border:1px solid #fde4c8;border-radius:8px;padding:8px 11px;font-size:12.5px;color:#9a5a00;display:flex;justify-content:space-between;align-items:center;gap:8px;"><span>'+r.data.length+' shout-out'+(r.data.length>1?'s':'')+' awaiting approval</span><button onclick="openRecogApprovals()" style="background:#f59e0b;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer;">Review</button></div>';
        }).catch(function(){ var bar=document.getElementById('recogPendingBar'); if(bar){ bar.style.display='block'; bar.innerHTML=_hubRetryHtml('Couldn&rsquo;t check pending shout-outs','loadRecogPending()'); } });
    }
    function openShoutout(){
        var sel=document.getElementById('shoutoutEmp');
        function fill(arr){ sel.innerHTML='<option value="">— a team / the whole store —</option>'+arr.filter(function(e){return e.active!==false;}).map(function(e){ return '<option value="'+e.id+'">'+escapeHtml(e.name||('#'+e.id))+'</option>'; }).join(''); }
        var list=(typeof rosterState!=='undefined'&&rosterState&&rosterState.list&&rosterState.list.length)?rosterState.list:null;
        if(list) fill(list);
        else withPin(function(pin){ supabaseClient.rpc('app_roster_list',{p_username:currentUser.username,p_password:pin}).then(function(r){ if(!r.error&&r.data) fill(r.data.employees||r.data||[]); }); });
        document.getElementById('shoutoutAbout').value=''; document.getElementById('shoutoutMsg').value='';
        document.getElementById('shoutoutType').value='shoutout'; document.getElementById('shoutoutMsgErr').textContent='';
        document.getElementById('shoutoutModal').style.display='flex';
    }
    function closeShoutout(){ document.getElementById('shoutoutModal').style.display='none'; }
    function submitShoutout(){
        var emp=document.getElementById('shoutoutEmp').value;
        var about=(document.getElementById('shoutoutAbout').value||'').trim();
        var type=document.getElementById('shoutoutType').value||'shoutout';
        var msg=(document.getElementById('shoutoutMsg').value||'').trim();
        var err=document.getElementById('shoutoutMsgErr');
        if(!msg){ err.textContent='Please write a message.'; return; }
        err.textContent='Sending…';
        withPin(function(pin){
            supabaseClient.rpc('app_recognition_post',{p_username:currentUser.username,p_password:pin,p_type:type,p_about_emp:(emp?parseInt(emp,10):null),p_about_text:(emp?null:(about||null)),p_message:msg,p_location:(currentUser.activeStore||null)}).then(function(r){
                if(r.error){ err.textContent='Error: '+r.error.message; return; }
                closeShoutout();
                var mgr=(typeof isManagerRole==='function' && isManagerRole());
                alert(mgr?'Shout-out posted! 🎉':'Thanks! Your shout-out was sent for a quick manager approval. 💛');
                loadRecognition();
            }).catch(function(){ err.textContent='Could not send.'; });
        });
    }
    function openRecogApprovals(){
        var box=document.getElementById('recogApprovalsBody');
        box.innerHTML='<p style="color:#6b7686;font-size:13px;">Loading…</p>';
        document.getElementById('recogApprovalsModal').style.display='flex';
        withPin(function(pin){
            supabaseClient.rpc('app_recognition_pending',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ box.innerHTML='<p style="color:#c0264b;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var items=r.data||[];
                if(!items.length){ box.innerHTML='<p style="color:#6b7686;font-size:13px;">Nothing pending. 🎉</p>'; return; }
                var h=''; items.forEach(function(it){
                    h+='<div style="border:1px solid #eee;border-radius:10px;padding:10px 12px;margin-bottom:8px;">'+
                       '<div style="font-size:13.5px;color:#26242b;">'+recogIcon(it.type)+' '+(it.about?('<b>'+escapeHtml(it.about)+'</b> — '):'')+escapeHtml(it.message||'')+'</div>'+
                       '<div style="font-size:11px;color:#6b6275;margin-top:3px;">from '+escapeHtml(it.from||'Someone')+'</div>'+
                       '<div style="margin-top:8px;display:flex;gap:8px;"><button onclick="recogDecide('+it.id+',true,this)" style="background:#1c7c3a;color:#fff;border:none;border-radius:7px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;">Approve</button>'+
                       '<button onclick="recogDecide('+it.id+',false,this)" style="background:#eee;color:#c0264b;border:none;border-radius:7px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;">Reject</button></div></div>';
                }); box.innerHTML=h;
            });
        });
    }
    function closeRecogApprovals(){ document.getElementById('recogApprovalsModal').style.display='none'; loadRecognition(); }
    function recogDecide(id, approve, btn){
        if(btn) btn.disabled=true;
        withPin(function(pin){
            supabaseClient.rpc('app_recognition_decide',{p_username:currentUser.username,p_password:pin,p_id:id,p_approve:approve}).then(function(r){
                if(r.error){ alert('Error: '+r.error.message); if(btn) btn.disabled=false; return; }
                openRecogApprovals();
            }).catch(function(){ if(btn) btn.disabled=false; });
        });
    }

    // ===== Training & Resources Library =====
    function loadTraining(){
        var box=document.getElementById('trainingList'); if(!box) return;
        var admin=(typeof isAdminManager==='function' && isAdminManager());
        var addBtn=document.getElementById('trainingAddBtn'); if(addBtn) addBtn.style.display=admin?'block':'none';
        withPin(function(pin){
            supabaseClient.rpc('app_training_list',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; box.innerHTML='<p style="color:#c0264b;text-align:center;padding:20px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var mods=r.data||[]; window._trainingMods=mods;
                if(!mods.length){ box.innerHTML='<p style="text-align:center;color:#6b7686;padding:20px;">No training modules yet.'+(admin?' Tap &ldquo;Add module&rdquo; to start.':'')+'</p>'; return; }
                var groups={}, order=[];
                mods.forEach(function(m){ var c=m.category||'General'; if(!groups[c]){ groups[c]=[]; order.push(c); } groups[c].push(m); });
                var h='';
                order.forEach(function(cat){
                    h+='<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#6b6275;margin:14px 0 6px;">'+escapeHtml(cat)+'</div>';
                    groups[cat].forEach(function(m){
                        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;margin-bottom:8px;box-shadow:0 2px 6px rgba(0,0,0,.04);">'+
                           '<button onclick="toggleTraining('+m.id+')" style="width:100%;text-align:left;background:none;border:none;padding:13px 15px;cursor:pointer;display:flex;align-items:center;gap:10px;">'+
                           '<b style="flex:1;font-size:14.5px;color:#26242b;">'+escapeHtml(m.title)+'</b><span style="color:#aab;font-size:20px;">&rsaquo;</span></button>'+
                           '<div id="trn'+m.id+'" style="display:none;padding:0 15px 14px;"></div></div>';
                    });
                });
                box.innerHTML=h;
            });
        });
    }
    function toggleTraining(id){
        var d=document.getElementById('trn'+id); if(!d) return;
        if(d.style.display==='block'){ d.style.display='none'; return; }
        var m=(window._trainingMods||[]).filter(function(x){return x.id===id;})[0]; if(!m) return;
        var admin=(typeof isAdminManager==='function' && isAdminManager());
        var body=((m.body||'').trim())||'(No content yet.)';
        var h='<div style="font-size:13.5px;color:#333;line-height:1.6;white-space:pre-wrap;">'+escapeHtml(body)+'</div>';
        if(admin){ h+='<div style="margin-top:10px;display:flex;gap:8px;"><button onclick="openTrainingEdit('+m.id+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:7px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;">Edit</button>'+
           '<button onclick="deleteTrainingModule('+m.id+')" style="background:#fdeaea;color:#c0264b;border:none;border-radius:7px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;">Remove</button></div>'; }
        d.innerHTML=h; d.style.display='block';
    }
    function openTrainingEdit(id){
        var m=id?((window._trainingMods||[]).filter(function(x){return x.id===id;})[0]||null):null;
        // Training categories: display-only suggestion list, configurable via cfgListOr('training_cats').
        // Free-text category (stored/grouped only, never branched on) so this is safe to make configurable.
        var _tcDefaults=['Recipes','How-To','Policies','Customer Service','Onboarding'];
        var _tcList=(typeof cfgListOr==='function'?cfgListOr('training_cats',_tcDefaults):_tcDefaults);
        var _tcDL=document.getElementById('trainingCats');
        if(_tcDL&&_tcList&&_tcList.length){ _tcDL.innerHTML=_tcList.map(function(c){ return '<option value="'+escapeHtml(String(c))+'"></option>'; }).join(''); }
        document.getElementById('trainingEditId').value = id||'';
        document.getElementById('trainingEditTitle').value = m?m.title:'';
        document.getElementById('trainingEditCat').value = m?(m.category||''):'';
        document.getElementById('trainingEditBody').value = m?(m.body||''):'';
        document.getElementById('trainingEditMsg').textContent='';
        document.getElementById('trainingEditTitleH').textContent = id?'Edit module':'Add training module';
        document.getElementById('trainingEditModal').style.display='flex';
    }
    function closeTrainingEdit(){ document.getElementById('trainingEditModal').style.display='none'; }
    function saveTrainingModule(){
        var id=document.getElementById('trainingEditId').value;
        var title=(document.getElementById('trainingEditTitle').value||'').trim();
        var cat=(document.getElementById('trainingEditCat').value||'').trim();
        var body=document.getElementById('trainingEditBody').value;
        var msg=document.getElementById('trainingEditMsg');
        if(!title){ msg.style.color='#c0264b'; msg.textContent='Give it a title.'; return; }
        msg.style.color='#5b6472'; msg.textContent='Saving…';
        withPin(function(pin){
            supabaseClient.rpc('app_training_save',{p_username:currentUser.username,p_password:pin,p_id:(id?parseInt(id,10):null),p_category:cat,p_title:title,p_body:body}).then(function(r){
                if(r.error){ msg.style.color='#c0264b'; msg.textContent='Error: '+r.error.message; return; }
                closeTrainingEdit(); loadTraining();
            }).catch(function(){ msg.style.color='#c0264b'; msg.textContent='Could not save.'; });
        });
    }
    function deleteTrainingModule(id){
        if(!confirm('Remove this training module from the library?')) return;
        withPin(function(pin){
            supabaseClient.rpc('app_training_delete',{p_username:currentUser.username,p_password:pin,p_id:id}).then(function(r){
                if(r.error){ alert('Error: '+r.error.message); return; }
                loadTraining();
            });
        });
    }

    // ============================================================
    // EQUIPMENT HISTORY + QR CODES
    // ============================================================
    var EQUIP_BASE = 'https://calichesfc.github.io/index.html/index.html';
    function equipQrUrl(id, size, action){ var _u=EQUIP_BASE+'?equip='+id+(action?'&go='+action:''); return 'https://api.qrserver.com/v1/create-qr-code/?size='+size+'x'+size+'&margin=8&data='+encodeURIComponent(_u); }
    function equipStatusBadge(st){
        st=(st||'ok').toLowerCase();
        var map={ok:['#1f7a3d','#e7f6ec','Operational'], watch:['#854F0B','#fdf3e8','Watch'], down:['#c0264b','#fdeaea','Down']};
        var m=map[st]||map.ok;
        return '<span style="background:'+m[1]+';color:'+m[0]+';font-size:11px;font-weight:800;padding:3px 9px;border-radius:99px;white-space:nowrap;">'+m[2]+'</span>';
    }
    function openEquipment(){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        document.getElementById('equipmentView').style.display='block';
        window.scrollTo(0,0);
        var sel=document.getElementById('equipStoreSel');
        if(sel && !sel.getAttribute('data-init')){
            var s=(currentUser&&(currentUser.store||currentUser.location))||'';
            for(var i=0;i<sel.options.length;i++){ if(sel.options[i].value===s){ sel.selectedIndex=i; break; } }
            sel.setAttribute('data-init','1');
        }
        loadEquipment();
    }
    function loadEquipment(){
        var box=document.getElementById('equipList'); if(!box) return;
        var admin=(typeof isAdminManager==='function' && isAdminManager());
        var addBtn=document.getElementById('equipAddBtn'); if(addBtn) addBtn.style.display=admin?'block':'none';
        var prtBtn=document.getElementById('equipPrintAllBtn'); if(prtBtn) prtBtn.style.display='block';
        var store=document.getElementById('equipStoreSel').value;
        window._equipIsWarehouse=(store==='Warehouse');
        box.innerHTML='<p style="text-align:center;color:#6b7686;padding:20px;">Loading&hellip;</p>';
        withPin(function(pin){
            var call=window._equipIsWarehouse
                ? supabaseClient.rpc('app_warehouse_list',{p_username:currentUser.username,p_password:pin})
                : supabaseClient.rpc('app_equipment_list',{p_username:currentUser.username,p_password:pin,p_store:store});
            call.then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; box.innerHTML='<p style="color:#c0264b;text-align:center;padding:20px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                window._equipList=r.data||[];
                renderEquipmentList();
            }).catch(function(){ box.innerHTML='<p style="color:#c0264b;text-align:center;padding:20px;">Could not load equipment.</p>'; });
        });
    }
    function equipRowHtml(e){
        var mgr=(typeof isAdminManager==='function' && isAdminManager());
        var toggle='';
        if(window._equipIsWarehouse && mgr){
            toggle = e.is_backup
              ? '<button onclick="event.stopPropagation();setEquipBackup('+e.id+',false)" style="background:#e8f5ec;color:#1b7a3d;border:none;border-radius:7px;padding:6px 9px;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;">&#8593; In use</button>'
              : '<button onclick="event.stopPropagation();setEquipBackup('+e.id+',true)" style="background:#fff4e0;color:#9a5b00;border:none;border-radius:7px;padding:6px 9px;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;">&#8595; Backup</button>';
        }
        return '<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;margin-bottom:8px;box-shadow:0 2px 6px rgba(0,0,0,.04);display:flex;align-items:center;">'+
               '<button onclick="openEquipmentDetail('+e.id+')" style="flex:1;text-align:left;background:none;border:none;padding:13px 15px;cursor:pointer;display:flex;align-items:center;gap:10px;">'+
               '<b style="flex:1;font-size:14.5px;color:#26242b;">'+escapeHtml(e.name||'(unnamed)')+
               (e.open_issue?'<span style="display:block;font-size:11.5px;font-weight:600;color:#c0264b;margin-top:2px;">&#9888;&#65039; '+escapeHtml(e.open_issue)+'</span>':'')+'</b>'+
               equipStatusBadge(e.status)+'<span style="color:#aab;font-size:20px;">&rsaquo;</span></button>'+
               (toggle?'<div style="padding-right:12px;">'+toggle+'</div>':'')+'</div>';
    }
    function renderEquipmentList(){
        var box=document.getElementById('equipList'); if(!box) return;
        var list=window._equipList||[];
        var q=(document.getElementById('equipSearch').value||'').trim().toLowerCase();
        if(q) list=list.filter(function(e){ return (e.name||'').toLowerCase().indexOf(q)>=0; });
        if(!list.length){ box.innerHTML='<p style="text-align:center;color:#6b7686;padding:24px;">No equipment'+(q?' matches that search':(window._equipIsWarehouse?' at the warehouse yet. Add it with &#10133; Add equipment.':' on file for this store'))+'.</p>'; return; }
        if(window._equipIsWarehouse){
            var inUse=list.filter(function(e){return !e.is_backup;}), backups=list.filter(function(e){return e.is_backup;});
            var hh='';
            hh+='<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#1b7a3d;margin:4px 0 8px;">&#9989; In use &middot; '+inUse.length+'</div>';
            hh+= inUse.length?inUse.map(equipRowHtml).join(''):'<p style="color:#6b7686;font-size:13px;margin:0 0 12px;">Nothing marked in use.</p>';
            hh+='<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#9a5b00;margin:16px 0 8px;">&#128230; Unused backups &middot; '+backups.length+'</div>';
            hh+= backups.length?backups.map(equipRowHtml).join(''):'<p style="color:#6b7686;font-size:13px;margin:0;">No spare/backup units.</p>';
            box.innerHTML=hh; return;
        }
        box.innerHTML=list.map(equipRowHtml).join('');
    }
    function setEquipBackup(id,backup){
        withPin(function(pin){
            supabaseClient.rpc('app_equipment_set_backup',{p_username:currentUser.username,p_password:pin,p_id:id,p_backup:backup}).then(function(r){
                if(r.error){ alert('Could not update: '+r.error.message); return; }
                loadEquipment();
            }).catch(function(){ alert('Could not update.'); });
        });
    }
    function openEquipmentDetail(id){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        document.getElementById('equipmentDetailView').style.display='block';
        window.scrollTo(0,0);
        var box=document.getElementById('equipDetailBody');
        box.innerHTML='<p style="text-align:center;color:#6b7686;padding:40px;">Loading&hellip;</p>';
        withPin(function(pin){
            supabaseClient.rpc('app_equipment_get',{p_username:currentUser.username,p_password:pin,p_id:id}).then(function(r){
                if(r.error){ box.innerHTML='<p style="color:#c0264b;text-align:center;padding:20px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                if(!r.data){ box.innerHTML='<p style="text-align:center;color:#6b7686;padding:24px;">Equipment not found.</p>'; return; }
                window._equipCur=r.data; renderEquipmentDetail(r.data);
            }).catch(function(){ box.innerHTML='<p style="color:#c0264b;text-align:center;padding:20px;">Could not load record.</p>'; });
        });
    }
    function renderEquipmentDetail(e){
        var box=document.getElementById('equipDetailBody');
        var admin=(typeof isAdminManager==='function' && isAdminManager());
        function row(lbl,val){ if(!val) return ''; return '<div style="padding:10px 0;border-bottom:1px solid #f0eef4;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#9a93a4;">'+escapeHtml(lbl)+'</div><div style="font-size:14px;color:#2c2933;line-height:1.55;white-space:pre-wrap;margin-top:2px;">'+escapeHtml(val)+'</div></div>'; }
        function rowLink(lbl,val){ if(!val) return ''; var safe=escapeHtml(val).replace(new RegExp('(https?://[^ <]+)','g'),'<a href="$1" target="_blank" rel="noopener" style="color:#185FA5;word-break:break-all;">$1</a>'); return '<div style="padding:10px 0;border-bottom:1px solid #f0eef4;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#9a93a4;">'+escapeHtml(lbl)+'</div><div style="font-size:14px;color:#2c2933;line-height:1.55;white-space:pre-wrap;margin-top:2px;">'+safe+'</div></div>'; }
        function rowCollapse(lbl,val){ if(!val) return ''; return '<details style="padding:8px 0;border-bottom:1px solid #f0eef4;"><summary style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#9a93a4;cursor:pointer;">'+escapeHtml(lbl)+'</summary><div style="font-size:14px;color:#2c2933;line-height:1.55;white-space:pre-wrap;margin-top:6px;">'+escapeHtml(val)+'</div></details>'; }
        var h='';
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.05);">';
        h+='<div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;">'+
           '<div style="flex:1;min-width:160px;"><h2 style="margin:0 0 4px;color:#854F0B;font-size:21px;">'+escapeHtml(e.name||'(unnamed)')+'</h2>'+
           '<div style="font-size:12.5px;color:#6b6275;">'+escapeHtml(e.store||'')+(e.store==='Warehouse'?(e.is_backup?' &middot; <span style="color:#9a5b00;font-weight:700;">Unused backup</span>':' &middot; <span style="color:#1b7a3d;font-weight:700;">In use</span>'):'')+'</div></div>'+equipStatusBadge(e.status)+'</div>';
        if(e.open_issue){ h+='<div style="margin-top:12px;background:#fdeaea;border:1px solid #f6c9d2;border-radius:10px;padding:10px 12px;font-size:13.5px;color:#a01b3e;"><b>&#9888;&#65039; Open issue:</b> '+escapeHtml(e.open_issue)+'</div>'; }
        // QR block
        h+='<div style="text-align:center;margin:16px 0;padding:14px;background:#faf8f4;border:1px dashed #d8cfc2;border-radius:12px;">'+
           '<img src="'+equipQrUrl(e.id,180)+'" alt="QR code" style="width:180px;height:180px;display:block;margin:0 auto;background:#fff;">'+
           '<div style="font-size:11.5px;color:#6b6275;margin-top:8px;">Scan to open this record</div>'+
           '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px;"><button onclick="printEquipmentQR()" style="background:#854F0B;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer;">&#128424;&#65039; Print QR label</button>'+'<button onclick="printEquipmentQR(&quot;report&quot;)" style="background:#D85A30;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer;">&#128295; &quot;Report a problem&quot; label</button></div></div>';
        h+=row('Model',e.model)+row('Serial #',e.serial)+row('Vendor / service',e.vendor)+row('Warranty',e.warranty)+rowLink('Manuals / links',e.manuals)+rowCollapse('Troubleshooting',e.troubleshooting)+rowCollapse('Notes / repair history',e.notes);
        h+='<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">'+
           '<button onclick="woReportForEquipment('+e.id+')" style="flex:1;min-width:140px;background:#eef3fb;color:#185FA5;border:none;border-radius:9px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;">&#128295; Report a problem</button>';
        if(admin){ h+='<button onclick="openEquipmentEdit('+e.id+')" style="flex:1;min-width:120px;background:#f3eede;color:#854F0B;border:none;border-radius:9px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;">&#9998; Edit</button>'+
           '<button onclick="deleteEquipment('+e.id+')" style="background:#fdeaea;color:#c0264b;border:none;border-radius:9px;padding:10px 14px;font-size:13px;font-weight:700;cursor:pointer;">Remove</button>'; }
        h+='</div></div>';
        h+='<div id="pmSection" style="margin-top:14px;"></div>';
        h+='<div id="maintHistSection" style="margin-top:14px;"></div>';
        box.innerHTML=h;
        if(typeof loadPmFor==='function') loadPmFor(e.id);
        if(typeof loadMaintHistFor==='function') loadMaintHistFor(e.id);
    }
    /* ===== Preventive Maintenance ===== */
    function pmStatusBadge(st){
        var m={overdue:['#fdeaea','#a01b3e','Overdue'],due_soon:['#fff4e0','#9a5b00','Due soon'],ok:['#e8f5ec','#1b7a3d','On track']};
        var c=m[st]||m.ok;
        return '<span style="background:'+c[0]+';color:'+c[1]+';font-size:11px;font-weight:800;padding:3px 8px;border-radius:99px;white-space:nowrap;">'+c[2]+'</span>';
    }
    /* ===== PM structured checklists ===== */
    var _pmck={pmId:null,equipId:null,steps:[],ver:1,title:''};
    function completePmSimple(pmId,equipId){
        var notes=prompt('Log this service as done today?\n\nOptional note (e.g. parts replaced):','');
        if(notes===null) return;
        withPin(function(pin){
            supabaseClient.rpc('app_pm_complete',{p_username:currentUser.username,p_password:pin,p_id:pmId,p_done_on:null,p_notes:notes||null}).then(function(r){
                if(r.error){ alert('Could not log: '+r.error.message); return; }
                supabaseClient.rpc('app_pm_close_tickets',{p_username:currentUser.username,p_password:pin,p_pm_id:pmId}).catch(function(){});
                loadPmFor(equipId);
            }).catch(function(){ alert('Could not log the service.'); });
        });
    }
    function pmckStart(pmId,equipId,title){
        withPin(function(pin){
            supabaseClient.rpc('app_pm_checklist_get',{p_username:currentUser.username,p_password:pin,p_pm_id:pmId}).then(function(r){
                var steps=(r.data&&r.data.steps)||[];
                if(!steps.length){ completePmSimple(pmId,equipId); return; }
                _pmck={pmId:pmId,equipId:equipId,steps:steps,ver:(r.data&&r.data.version)||1,title:title||'Service'};
                pmckRender();
            }).catch(function(){ completePmSimple(pmId,equipId); });
        });
    }
    function pmckOv(){ var o=document.getElementById('pmckModal'); if(!o){ o=document.createElement('div'); o.id='pmckModal'; o.style.cssText='position:fixed;inset:0;background:rgba(20,20,30,.55);z-index:100060;display:flex;align-items:flex-end;justify-content:center;'; document.body.appendChild(o); } o.style.display='flex'; return o; }
    function pmckClose(){ var o=document.getElementById('pmckModal'); if(o) o.style.display='none'; }
    function pmckRender(){
        var steps=_pmck.steps||[];
        var rows=steps.map(function(s,i){ return '<label style="display:flex;align-items:flex-start;gap:9px;padding:9px 4px;border-bottom:1px solid #f0f2f6;font-size:13.5px;color:#26242b;cursor:pointer;"><input type="checkbox" id="pmck_'+i+'" style="width:19px;height:19px;margin-top:1px;flex:none;cursor:pointer;"><span>'+escapeHtml(String(s))+'</span></label>'; }).join('');
        var h='<div style="background:#fff;border-radius:16px 16px 0 0;width:100%;max-width:560px;max-height:88vh;overflow:auto;padding:16px 16px 26px;">';
        h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><b style="flex:1;font-size:16px;color:#1f2a44;">'+escapeHtml(_pmck.title)+' &mdash; checklist</b><button onclick="pmckClose()" style="background:#eef0f3;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:15px;">&times;</button></div>';
        h+='<div style="font-size:12px;color:#6b6275;margin-bottom:8px;">Check off each step as you complete it. Your answers are saved with this service record (checklist v'+_pmck.ver+').</div>';
        h+=rows;
        h+='<div style="display:flex;gap:8px;margin:10px 0 4px;"><button onclick="pmckAll(true)" style="flex:1;background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:7px;font-size:12.5px;font-weight:700;cursor:pointer;">Check all</button><button onclick="pmckAll(false)" style="flex:1;background:#f3f4f8;color:#6b7686;border:none;border-radius:8px;padding:7px;font-size:12.5px;font-weight:700;cursor:pointer;">Clear</button></div>';
        h+='<textarea id="pmckNote" rows="2" placeholder="Optional note (parts replaced, issues found&hellip;)" style="width:100%;padding:9px;border:1px solid #d6deea;border-radius:9px;box-sizing:border-box;margin-top:6px;font-size:13px;"></textarea>';
        h+='<button onclick="pmckSubmit()" style="width:100%;background:var(--pass-green,#1f7a3d);color:#fff;border:none;border-radius:10px;padding:12px;font-size:14.5px;font-weight:800;cursor:pointer;margin-top:10px;">&#9989; Mark serviced</button>';
        h+='</div>';
        pmckOv().innerHTML=h;
    }
    function pmckAll(v){ (_pmck.steps||[]).forEach(function(s,i){ var c=document.getElementById('pmck_'+i); if(c) c.checked=v; }); }
    function pmckSubmit(){
        var steps=_pmck.steps||[]; var done=0;
        var responses=steps.map(function(s,i){ var c=document.getElementById('pmck_'+i); var ok=!!(c&&c.checked); if(ok) done++; return {step:String(s),done:ok}; });
        var note=(document.getElementById('pmckNote')||{}).value||'';
        if(done<steps.length){ if(!confirm((steps.length-done)+' step(s) are not checked. Log the service anyway?')) return; }
        var pmId=_pmck.pmId, equipId=_pmck.equipId;
        withPin(function(pin){
            supabaseClient.rpc('app_pm_complete',{p_username:currentUser.username,p_password:pin,p_id:pmId,p_done_on:null,p_notes:note||null}).then(function(r){
                if(r.error){ alert('Could not log: '+r.error.message); return; }
                supabaseClient.rpc('app_pm_checklist_record',{p_username:currentUser.username,p_password:pin,p_pm_id:pmId,p_responses:responses}).catch(function(){});
                supabaseClient.rpc('app_pm_close_tickets',{p_username:currentUser.username,p_password:pin,p_pm_id:pmId}).catch(function(){});
                pmckClose(); loadPmFor(equipId);
            }).catch(function(){ alert('Could not log the service.'); });
        });
    }
    function pmChecklistEdit(pmId,equipId){
        withPin(function(pin){
            supabaseClient.rpc('app_pm_checklist_get',{p_username:currentUser.username,p_password:pin,p_pm_id:pmId}).then(function(r){
                var steps=(r.data&&r.data.steps)||[];
                var txt=prompt('Checklist steps for this service — one per line. The crew checks these off when servicing:', steps.join('\n'));
                if(txt===null) return;
                var arr=txt.split('\n').map(function(s){return s.trim();}).filter(Boolean);
                supabaseClient.rpc('app_pm_checklist_set',{p_username:currentUser.username,p_password:pin,p_pm_id:pmId,p_steps:arr}).then(function(rr){
                    if(rr.error){ alert(String(rr.error.message||'').indexOf('forbidden')>=0?'Only managers can edit checklists.':rr.error.message); return; }
                    loadPmFor(equipId);
                }).catch(function(){ alert('Could not save checklist.'); });
            }).catch(function(){ alert('Could not load checklist.'); });
        });
    }
    function pmIsMgr(){ return (typeof isManagerRole==='function'?isManagerRole():(typeof isAdminManager==='function'&&isAdminManager())); }
    function loadPmFor(equipId){
        window._pmEquipId=equipId;
        var box=document.getElementById('pmSection'); if(!box) return;
        box.innerHTML='<div style="background:var(--surface,#fff);border:1px solid var(--bd,#ececf2);border-radius:14px;padding:16px;color:var(--txt2,#8a8594);font-size:13px;">Loading maintenance&hellip;</div>';
        withPin(function(pin){
            supabaseClient.rpc('app_pm_for_equipment',{p_username:currentUser.username,p_password:pin,p_equipment_id:equipId}).then(function(r){
                if(r.error){ box.innerHTML=''; return; }
                renderPmSection(r.data||{schedules:[],log:[]},equipId);
            }).catch(function(){ box.innerHTML=''; });
        });
    }
    function renderPmSection(data,equipId){
        var box=document.getElementById('pmSection'); if(!box) return;
        var mgr=pmIsMgr(); var scheds=data.schedules||[], log=data.log||[];
        window._pmScheds=scheds; window._pmEquipId=equipId;
        var h='<div style="background:var(--surface,#fff);border:1px solid var(--bd,#ececf2);border-radius:14px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,.05);">';
        h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><span style="font-size:18px;">&#128295;</span><b style="flex:1;font-size:15px;color:var(--txt,#26242b);">Preventive maintenance</b>';
        if(mgr){ h+='<button onclick="openPmEdit('+equipId+',null)" style="background:var(--caliches-pink);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:700;cursor:pointer;">&#10133; Add</button>'; }
        h+='</div>';
        if(!scheds.length){
            h+='<div style="color:var(--txt2,#8a8594);font-size:13px;padding:4px 0;">No service schedules yet'+(mgr?'. Tap &#10133; Add to set one (e.g. "Sanitize every 7 days").':'.')+'</div>';
        } else {
            scheds.forEach(function(sc){
                var d=sc.days_until; var dt=(d<0?Math.abs(d)+'d overdue':(d===0?'due today':'in '+d+'d'));
                h+='<details style="border:1px solid var(--bd,#f0eef4);border-radius:11px;padding:11px 12px;margin-bottom:8px;">'+
                   '<summary style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;"><div style="flex:1;min-width:0;">'+
                   '<div style="font-weight:700;font-size:14px;color:var(--txt,#26242b);">'+escapeHtml(sc.title)+'</div>'+
                   '<div style="font-size:12px;color:var(--txt2,#8a8594);margin-top:2px;">Every '+sc.interval_days+' days &middot; next '+escapeHtml(sc.next_due||'')+' &middot; '+dt+((sc.checklist&&sc.checklist.length)?(' &middot; &#9776; '+sc.checklist.length+'-step list'):'')+'</div>'+
                   '</div>'+pmStatusBadge(sc.status)+'</summary>'+
                   (sc.instructions?'<div style="font-size:12px;color:var(--txt2,#8a8594);margin-top:8px;white-space:pre-wrap;">'+escapeHtml(sc.instructions)+'</div>':'')+
                   '<div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap;">'+
                   '<button onclick="completePm('+sc.id+','+equipId+')" style="flex:1;min-width:120px;background:var(--pass-green);color:#fff;border:none;border-radius:8px;padding:8px;font-size:12.5px;font-weight:700;cursor:pointer;">&#9989; Mark serviced</button>'+
                   (mgr?'<button onclick="openPmEdit('+equipId+','+sc.id+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:8px 11px;font-size:12.5px;font-weight:700;cursor:pointer;">&#9998;</button>'+'<button onclick="pmChecklistEdit('+sc.id+','+equipId+')" style="background:#fff4e0;color:#9a5b00;border:none;border-radius:8px;padding:8px 11px;font-size:12.5px;font-weight:700;cursor:pointer;">&#9776;</button>'+
                        '<button onclick="deletePmSched('+sc.id+','+equipId+')" style="background:#fdeaea;color:#c0264b;border:none;border-radius:8px;padding:8px 11px;font-size:12.5px;font-weight:700;cursor:pointer;">&#128465;&#65039;</button>':'')+
                   '</div></details>';
            });
        }
        if(log.length){
            h+='<div style="margin-top:6px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:var(--txt2,#9a93a4);">Service history</div>';
            log.forEach(function(l){
                h+='<div style="font-size:12px;color:var(--txt2,#8a8594);padding:4px 0;border-bottom:1px solid var(--bd,#f0eef4);">'+escapeHtml(l.done_on||'')+' &middot; '+escapeHtml(l.title||'')+(l.by?' &middot; '+escapeHtml(l.by):'')+(l.notes?' &middot; '+escapeHtml(l.notes):'')+'</div>';
            });
        }
        h+='</div>';
        box.innerHTML=h;
    }
    function completePm(pmId,equipId){ var sc=(window._pmScheds||[]).filter(function(x){return x.id===pmId;})[0]; pmckStart(pmId,equipId,sc?sc.title:'Service'); }
    function openPmEdit(equipId,pmId){
        window._pmEquipId=equipId; window._pmEditId=pmId;
        var sc=(window._pmScheds||[]).filter(function(x){return x.id===pmId;})[0]||null;
        document.getElementById('pmEditTitle').value=sc?sc.title:'';
        document.getElementById('pmEditInterval').value=sc?sc.interval_days:7;
        document.getElementById('pmEditNext').value=sc?(sc.next_due||''):'';
        document.getElementById('pmEditInstr').value=sc?(sc.instructions||''):'';
        document.getElementById('pmEditH').textContent=sc?'Edit schedule':'New service schedule';
        document.getElementById('pmEditMsg').textContent='';
        document.getElementById('pmEditModal').style.display='flex';
    }
    function closePmEdit(){ document.getElementById('pmEditModal').style.display='none'; }
    function savePmEdit(){
        var title=(document.getElementById('pmEditTitle').value||'').trim();
        var msg=document.getElementById('pmEditMsg');
        if(!title){ msg.style.color='#c0264b'; msg.textContent='Give the service a name.'; return; }
        var interval=parseInt(document.getElementById('pmEditInterval').value,10)||7;
        var next=document.getElementById('pmEditNext').value||null;
        var instr=document.getElementById('pmEditInstr').value||null;
        msg.style.color='#5b6472'; msg.textContent='Saving…';
        withPin(function(pin){
            supabaseClient.rpc('app_pm_save',{p_username:currentUser.username,p_password:pin,p_id:window._pmEditId||null,p_equipment_id:window._pmEquipId,p_title:title,p_interval_days:interval,p_instructions:instr,p_next_due:next}).then(function(r){
                if(r.error){ msg.style.color='#c0264b'; msg.textContent='Error: '+r.error.message; return; }
                closePmEdit(); loadPmFor(window._pmEquipId);
            }).catch(function(){ msg.style.color='#c0264b'; msg.textContent='Could not save.'; });
        });
    }
    function deletePmSched(pmId,equipId){
        if(!confirm('Remove this service schedule? (It will be archived.)')) return;
        withPin(function(pin){
            supabaseClient.rpc('app_pm_delete',{p_username:currentUser.username,p_password:pin,p_id:pmId}).then(function(r){
                if(r.error){ alert('Could not remove: '+r.error.message); return; }
                loadPmFor(equipId);
            }).catch(function(){ alert('Could not remove.'); });
        });
    }
    function maintStatusBadge(st){
        var s=(st||'').toLowerCase();
        var c = (s.indexOf('resolv')>=0||s.indexOf('done')>=0||s.indexOf('complet')>=0) ? ['#e8f5ec','#1b7a3d','Resolved']
              : (s.indexOf('progress')>=0||s.indexOf('working')>=0) ? ['#eef3fb','#185FA5','In progress']
              : ['#fdeaea','#a01b3e',(st||'Open')];
        return '<span style="background:'+c[0]+';color:'+c[1]+';font-size:11px;font-weight:800;padding:3px 8px;border-radius:99px;white-space:nowrap;">'+escapeHtml(c[2])+'</span>';
    }
    function maintIsResolved(r){ var s=((r.status||'')+'').toLowerCase(); return !!r.resolution || s.indexOf('resolv')>=0 || s.indexOf('done')>=0 || s.indexOf('complet')>=0; }
    function loadMaintHistFor(equipId){
        var box=document.getElementById('maintHistSection'); if(!box) return;
        box.innerHTML='<div style="background:var(--surface,#fff);border:1px solid var(--bd,#ececf2);border-radius:14px;padding:16px;color:var(--txt2,#8a8594);font-size:13px;">Loading maintenance reports&hellip;</div>';
        withPin(function(pin){
            supabaseClient.rpc('app_maint_for_equipment',{p_username:currentUser.username,p_password:pin,p_equipment_id:equipId}).then(function(r){
                if(r.error){ box.innerHTML=''; return; }
                renderMaintHist(r.data||[],equipId);
            }).catch(function(){ box.innerHTML=''; });
        });
    }
    function renderMaintHist(list,equipId){
        var box=document.getElementById('maintHistSection'); if(!box) return;
        window._maintHist=list; window._maintHistEquip=equipId;
        var mgr=(typeof isManagerRole==='function'?isManagerRole():(typeof isAdminManager==='function'&&isAdminManager()));
        var h='<div style="background:var(--surface,#fff);border:1px solid var(--bd,#ececf2);border-radius:14px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,.05);">';
        h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><span style="font-size:18px;">&#128221;</span><b style="flex:1;font-size:15px;color:var(--txt,#26242b);">Maintenance reports</b>'+
           '<button onclick="openMaintenanceForEquipment((window._equipCur||{}).store,(window._equipCur||{}).name)" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:700;cursor:pointer;">&#10133; New</button></div>';
        if(!list.length){ h+='<div style="color:var(--txt2,#8a8594);font-size:13px;padding:4px 0;">No maintenance reports for this machine yet.</div>'; }
        else {
            list.forEach(function(r){
                var resolved=maintIsResolved(r);
                var when=(r.report_date||(r.created_at?String(r.created_at).slice(0,10):''));
                h+='<div style="border:1px solid var(--bd,#f0eef4);border-radius:11px;padding:11px 12px;margin-bottom:8px;">'+
                   '<div style="display:flex;align-items:flex-start;gap:8px;"><div style="flex:1;min-width:0;">'+
                   '<div style="font-weight:700;font-size:14px;color:var(--txt,#26242b);">'+escapeHtml(r.item||'Maintenance')+'</div>'+
                   '<div style="font-size:12px;color:var(--txt2,#8a8594);margin-top:2px;">'+escapeHtml(when)+(r.reporter?' &middot; '+escapeHtml(r.reporter):'')+(r.urgency?' &middot; '+escapeHtml(r.urgency):'')+'</div>'+
                   (r.issue?'<div style="font-size:12.5px;color:var(--txt,#33303a);margin-top:4px;white-space:pre-wrap;">'+escapeHtml(r.issue)+'</div>':'')+
                   '</div>'+maintStatusBadge(r.status)+'</div>';
                if(resolved && (r.resolution||r.resolved_by)){
                    h+='<div style="margin-top:8px;background:#f0f8f2;border:1px solid #cfe8d6;border-radius:9px;padding:8px 10px;font-size:12.5px;color:#1b5e2e;"><b>&#9989; Resolution:</b> '+escapeHtml(r.resolution||'(marked resolved)')+(r.resolved_by?'<span style="color:#5b8169;"> &middot; '+escapeHtml(r.resolved_by)+'</span>':'')+'</div>';
                } else if(mgr){
                    h+='<div style="margin-top:8px;"><button onclick="resolveMaint('+r.id+')" style="background:var(--pass-green,#1f7a3d);color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:700;cursor:pointer;">&#9989; Mark resolved&hellip;</button></div>';
                }
                if(r.pdf){ h+='<div style="margin-top:6px;"><a href="'+escapeHtml(r.pdf)+'" target="_blank" rel="noopener" style="font-size:12px;color:#185FA5;font-weight:700;">&#128196; View report PDF</a></div>'; }
                h+='</div>';
            });
        }
        h+='</div>';
        box.innerHTML=h;
    }
    function resolveMaint(id){
        var txt=prompt('How was this resolved? (e.g. "Replaced compressor — vendor invoice #123")','');
        if(txt===null) return;
        withPin(function(pin){
            supabaseClient.rpc('app_maint_resolve',{p_username:currentUser.username,p_password:pin,p_id:id,p_resolution:txt,p_by:(currentUser&&currentUser.name)||currentUser.username}).then(function(r){
                if(r.error){ alert('Could not resolve: '+r.error.message); return; }
                loadMaintHistFor(window._maintHistEquip);
            }).catch(function(){ alert('Could not resolve.'); });
        });
    }
    function openMaintDue(){
        var box=document.getElementById('maintDueBox'); if(!box) return;
        if(box.getAttribute('data-open')==='1'){ box.style.display='none'; box.setAttribute('data-open','0'); return; }
        box.style.display='block'; box.setAttribute('data-open','1'); loadMaintDue();
    }
    function loadMaintDue(){
        var box=document.getElementById('maintDueBox'); if(!box) return;
        var store=document.getElementById('equipStoreSel').value;
        box.innerHTML='<p style="text-align:center;color:var(--txt2,#888);padding:10px;">Loading&hellip;</p>';
        withPin(function(pin){
            supabaseClient.rpc('app_pm_list',{p_username:currentUser.username,p_password:pin,p_store:store}).then(function(r){
                if(r.error){ box.innerHTML='<p style="color:#c0264b;text-align:center;padding:10px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var list=r.data||[];
                if(!list.length){ box.innerHTML='<div style="background:var(--surface,#fff);border:1px solid var(--bd,#ececf2);border-radius:12px;padding:14px;text-align:center;color:var(--txt2,#8a8594);font-size:13px;">&#9989; Nothing due in the next 2 weeks for '+escapeHtml(store)+'.</div>'; return; }
                var h='<div style="background:var(--surface,#fff);border:1px solid var(--bd,#ececf2);border-radius:12px;padding:4px 12px;">';
                list.forEach(function(it){
                    var d=it.days_until; var dt=(d<0?Math.abs(d)+'d overdue':(d===0?'due today':'in '+d+'d'));
                    h+='<button onclick="openEquipmentDetail('+it.equipment_id+')" style="width:100%;text-align:left;background:none;border:none;border-bottom:1px solid var(--bd,#f0eef4);padding:10px 2px;cursor:pointer;display:flex;align-items:center;gap:9px;">'+
                       '<div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:13.5px;color:var(--txt,#26242b);">'+escapeHtml(it.equipment||'')+'</div>'+
                       '<div style="font-size:11.5px;color:var(--txt2,#8a8594);">'+escapeHtml(it.title||'')+' &middot; '+dt+'</div></div>'+pmStatusBadge(it.status)+'</button>';
                });
                h+='</div>';
                box.innerHTML=h;
            }).catch(function(){ box.innerHTML='<p style="color:#c0264b;text-align:center;padding:10px;">Could not load.</p>'; });
        });
    }
    function printEquipmentQR(action){ var _rep=(action==='report');
        var e=window._equipCur; if(!e) return;
        var w=window.open('','_blank');
        if(!w){ alert('Please allow pop-ups to print the QR label.'); return; }
        w.document.write('<html><head><title>QR - '+escapeHtml(e.name||'')+'</title></head><body style="font-family:Arial,sans-serif;text-align:center;padding:40px;">'+
          '<img src="'+equipQrUrl(e.id,260,_rep?'report':null)+'" style="width:260px;height:260px;"><h2 style="margin:14px 0 2px;">'+escapeHtml(e.name||'')+'</h2>'+
          '<div style="color:#555;font-size:14px;">'+escapeHtml(e.store||'')+(e.model?' &middot; '+escapeHtml(e.model):'')+'</div>'+
          '<div style="color:#6b7686;font-size:12px;margin-top:6px;">'+(_rep?'Scan to report a problem':'Scan to open equipment record')+'</div></body></html>');
        w.document.close();
        setTimeout(function(){ try{ w.focus(); w.print(); }catch(err){} }, 600);
    }
    function printStoreQRSheet(){
        var list=window._equipList||[]; if(!list.length){ alert('No equipment to print for this store.'); return; }
        var store=document.getElementById('equipStoreSel').value;
        var w=window.open('','_blank');
        if(!w){ alert('Please allow pop-ups to print the QR sheet.'); return; }
        var cells='';
        list.forEach(function(e){
            cells+='<div style="display:inline-block;width:30%;text-align:center;margin:1.5%;vertical-align:top;page-break-inside:avoid;">'+
              '<img src="'+equipQrUrl(e.id,200)+'" style="width:150px;height:150px;"><div style="font-weight:bold;font-size:13px;margin-top:4px;">'+escapeHtml(e.name||'')+'</div>'+
              '<div style="font-size:11px;color:#6b7686;">'+escapeHtml(store)+'</div></div>';
        });
        w.document.write('<html><head><title>QR codes - '+escapeHtml(store)+'</title></head><body style="font-family:Arial,sans-serif;padding:20px;">'+
          '<h2 style="text-align:center;">'+escapeHtml(store)+' &mdash; Equipment QR codes</h2>'+cells+'</body></html>');
        w.document.close();
        setTimeout(function(){ try{ w.focus(); w.print(); }catch(err){} }, 900);
    }
    function openEquipmentEdit(id){
        var e=id?(window._equipCur&&window._equipCur.id===id?window._equipCur:(window._equipList||[]).filter(function(x){return x.id===id;})[0]):null;
        if(id && (!e || e.id!==id)){
            // need full record; fetch then open
            withPin(function(pin){
                supabaseClient.rpc('app_equipment_get',{p_username:currentUser.username,p_password:pin,p_id:id}).then(function(r){
                    if(r.data){ window._equipCur=r.data; fillEquipmentEdit(r.data); }
                });
            });
            return;
        }
        fillEquipmentEdit(e);
    }
    function fillEquipmentEdit(e){
        document.getElementById('equipEditId').value = e?e.id:'';
        document.getElementById('equipEditStore').value = e?(e.store||''):(document.getElementById('equipStoreSel').value||'Roadrunner');
        document.getElementById('equipEditName').value = e?(e.name||''):'';
        document.getElementById('equipEditModel').value = e?(e.model||''):'';
        document.getElementById('equipEditSerial').value = e?(e.serial||''):'';
        document.getElementById('equipEditVendor').value = e?(e.vendor||''):'';
        document.getElementById('equipEditWarranty').value = e?(e.warranty||''):'';
        document.getElementById('equipEditManuals').value = e?(e.manuals||''):'';
        document.getElementById('equipEditTrouble').value = e?(e.troubleshooting||''):'';
        document.getElementById('equipEditNotes').value = e?(e.notes||''):'';
        document.getElementById('equipEditStatus').value = e?(e.status||'ok'):'ok';
        document.getElementById('equipEditIssue').value = e?(e.open_issue||''):'';
        document.getElementById('equipEditMsg').textContent='';
        document.getElementById('equipEditTitleH').textContent = e?'Edit equipment':'Add equipment';
        document.getElementById('equipDeleteBtn').style.display = e?'inline-block':'none';
        document.getElementById('equipEditModal').style.display='flex';
    }
    function closeEquipmentEdit(){ document.getElementById('equipEditModal').style.display='none'; }
    function saveEquipment(){
        var id=document.getElementById('equipEditId').value;
        var name=(document.getElementById('equipEditName').value||'').trim();
        var msg=document.getElementById('equipEditMsg');
        if(!name){ msg.style.color='#c0264b'; msg.textContent='Give the equipment a name.'; return; }
        msg.style.color='#5b6472'; msg.textContent='Saving…';
        var args={ p_username:currentUser.username, p_id:(id?parseInt(id,10):null),
            p_store:document.getElementById('equipEditStore').value,
            p_name:name,
            p_model:document.getElementById('equipEditModel').value,
            p_serial:document.getElementById('equipEditSerial').value,
            p_vendor:document.getElementById('equipEditVendor').value,
            p_warranty:document.getElementById('equipEditWarranty').value,
            p_manuals:document.getElementById('equipEditManuals').value,
            p_troubleshooting:document.getElementById('equipEditTrouble').value,
            p_notes:document.getElementById('equipEditNotes').value,
            p_status:document.getElementById('equipEditStatus').value,
            p_open_issue:document.getElementById('equipEditIssue').value };
        withPin(function(pin){
            args.p_password=pin;
            supabaseClient.rpc('app_equipment_save',args).then(function(r){
                if(r.error){ msg.style.color='#c0264b'; msg.textContent='Error: '+r.error.message; return; }
                closeEquipmentEdit();
                var newId=r.data?(r.data.id||r.data):null;
                loadEquipment();
                if(newId && document.getElementById('equipmentDetailView').style.display==='block'){ openEquipmentDetail(parseInt(newId,10)); }
            }).catch(function(){ msg.style.color='#c0264b'; msg.textContent='Could not save.'; });
        });
    }
    function deleteEquipment(id){
        if(!confirm('Remove this equipment record? (It will be archived, not permanently deleted.)')) return;
        withPin(function(pin){
            supabaseClient.rpc('app_equipment_delete',{p_username:currentUser.username,p_password:pin,p_id:id}).then(function(r){
                if(r.error){ alert('Error: '+r.error.message); return; }
                closeEquipmentEdit(); openEquipment();
            });
        });
    }

    // ============================================================
    // PRE-SHIFT LINEUP + POSITION PROGRESS (Phase 3)
    // ============================================================
    var PS_POSITIONS = ['Shift Leader','Front Register','Drive Register','Machine','Scooper','Item Maker'];
    function psTodayStr(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
    function openPreshift(){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        document.getElementById('preshiftView').style.display='block';
        window.scrollTo(0,0);
        var sel=document.getElementById('psStore');
        if(sel && !sel.getAttribute('data-init')){
            try{ var _locs=(typeof SCHED_LOCATIONS!=='undefined'&&SCHED_LOCATIONS&&SCHED_LOCATIONS.length)?SCHED_LOCATIONS:null; if(_locs){ sel.innerHTML=_locs.map(function(l){return '<option>'+escapeHtml(l)+'</option>';}).join(''); } }catch(e){}
            var s=(currentUser&&(currentUser.store||currentUser.location))||'';
            for(var i=0;i<sel.options.length;i++){ if(sel.options[i].value===s){ sel.selectedIndex=i; break; } }
            sel.setAttribute('data-init','1');
        }
        var dt=document.getElementById('psDate'); if(dt && !dt.value) dt.value=psTodayStr();
        loadPreshift();
    }
    function loadPreshift(){
        var box=document.getElementById('psRoster'); if(!box) return;
        var store=document.getElementById('psStore').value, date=document.getElementById('psDate').value||psTodayStr(), type=document.getElementById('psType').value;
        box.innerHTML='<p style="text-align:center;color:#6b7686;padding:20px;">Loading crew&hellip;</p>';
        document.getElementById('psMsg').textContent='';
        withPin(function(pin){
            Promise.all([
                supabaseClient.rpc('app_preshift_roster',{p_username:currentUser.username,p_password:pin,p_location:store}),
                supabaseClient.rpc('app_preshift_get',{p_username:currentUser.username,p_password:pin,p_location:store,p_date:date,p_type:type})
            ]).then(function(res){
                var rr=res[0], gg=res[1];
                if(rr.error){ if(rr.error.code==='42501') sessionPin=null; box.innerHTML='<p style="color:#c0264b;text-align:center;padding:20px;">'+escapeHtml(rr.error.message)+'</p>'; return; }
                var roster=rr.data||[];
                var existing=(gg&&!gg.error&&gg.data)?gg.data:{exists:false,assignments:[]};
                if(existing.exists){ document.getElementById('psGoal1').value=existing.goal1||''; document.getElementById('psGoal2').value=existing.goal2||''; }
                else { document.getElementById('psGoal1').value=''; document.getElementById('psGoal2').value=''; }
                var rosterById={}; roster.forEach(function(e){ rosterById[e.id]=e.name; });
                var exa=(existing.assignments||[]).map(function(a){ return {pos:a.position, name:(a.employee_name||rosterById[a.employee_id]||''), empId:a.employee_id}; });
                renderPreshiftSlots(roster, exa);
            }).catch(function(){ box.innerHTML='<p style="color:#c0264b;text-align:center;padding:20px;">Could not load the crew.</p>'; });
        });
    }
    var PS_DEFAULT_SLOTS=['Shift Leader','Machine','Front Register','Drive Register','Item Maker'];
    function renderPreshiftSlots(roster, existing){
        window._psRoster=roster||[];
        var box=document.getElementById('psRoster'); if(!box) return;
        var slots=PS_DEFAULT_SLOTS.map(function(p){ return {pos:p,name:''}; });
        (existing||[]).forEach(function(a){
            var placed=false;
            for(var i=0;i<slots.length;i++){ if(slots[i].pos===a.pos && !slots[i].name){ slots[i].name=a.name; placed=true; break; } }
            if(!placed) slots.push({pos:a.pos,name:a.name});
        });
        window._psSlotSeq=0;
        var dl='<datalist id="psNames">'+(roster||[]).map(function(e){ return '<option value="'+escapeHtml(e.name)+'"></option>'; }).join('')+'</datalist>';
        var h=dl;
        h+='<button type="button" onclick="psLoadScheduled()" style="width:100%;margin-bottom:8px;background:#e8f1fb;color:#185FA5;border:1px solid #b9d4f1;border-radius:9px;padding:9px;font-size:12.5px;font-weight:700;cursor:pointer;">&#128197; Load today&rsquo;s scheduled crew</button>';
        slots.forEach(function(s){ h+=psSlotHtml(s.pos,s.name); });
        h+='<button type="button" onclick="psAddSlot()" style="width:100%;margin-top:4px;background:#eef3fb;color:#185FA5;border:1px dashed #9cc0ec;border-radius:9px;padding:9px;font-size:13px;font-weight:700;cursor:pointer;">+ Add slot</button>';
        if(!(roster||[]).length){ h='<p style="text-align:center;color:#9a7400;background:#fff8e6;border:1px solid #ffe39a;border-radius:9px;padding:9px;margin-bottom:8px;font-size:12.5px;">No active crew loaded for this store yet — you can still type names in below.</p>'+h; }
        box.innerHTML=h;
    }
    function psSlotHtml(pos,name){
        var sid=++window._psSlotSeq;
        var opts=PS_POSITIONS.map(function(p){ return '<option value="'+p+'"'+(p===pos?' selected':'')+'>'+p+'</option>'; }).join('');
        return '<div class="ps-slot" data-sid="'+sid+'" style="display:flex;align-items:center;gap:7px;background:#fff;border:1px solid #ececf2;border-radius:10px;padding:8px 10px;margin-bottom:6px;">'+
               '<select class="ps-slot-pos" style="flex:0 0 116px;padding:7px;border:1px solid #ddd;border-radius:7px;font-size:12.5px;">'+opts+'</select>'+
               '<input class="ps-slot-name" list="psNames" value="'+escapeHtml(name||'')+'" placeholder="Type or pick a name" autocomplete="off" style="flex:1;min-width:80px;padding:7px;border:1px solid #ddd;border-radius:7px;font-size:13px;">'+
               '<button type="button" onclick="psSlotProgress(this)" title="Training progress" style="background:#eef3fb;color:#185FA5;border:none;border-radius:7px;padding:7px 8px;font-size:13px;cursor:pointer;">&#128200;</button>'+
               '<button type="button" onclick="psRemoveSlot(this)" title="Remove slot" style="background:#fbeaef;color:#c0264b;border:none;border-radius:7px;padding:6px 9px;font-size:15px;line-height:1;cursor:pointer;">&times;</button>'+
               '</div>';
    }
    function psAddSlot(){
        var box=document.getElementById('psRoster'); if(!box) return;
        var addBtn=box.querySelector('button[onclick="psAddSlot()"]');
        var tmp=document.createElement('div'); tmp.innerHTML=psSlotHtml('Item Maker','');
        var node=tmp.firstChild;
        if(addBtn) box.insertBefore(node,addBtn); else box.appendChild(node);
    }
    function psRemoveSlot(btn){ var row=btn.closest('.ps-slot'); if(row && row.parentNode) row.parentNode.removeChild(row); }
    function psMatchName(nm){ var roster=window._psRoster||[]; var t=(nm||'').trim().toLowerCase(); if(!t) return null; for(var i=0;i<roster.length;i++){ if((roster[i].name||'').trim().toLowerCase()===t) return roster[i]; } return null; }
    function psSlotProgress(btn){ var row=btn.closest('.ps-slot'); if(!row) return; var nm=row.querySelector('.ps-slot-name').value; var emp=psMatchName(nm); if(!emp){ alert('Type or pick a saved employee name first to see their training progress.'); return; } openPositionProgress(emp.id,emp.name); }
    function savePreshift(){
        var store=document.getElementById('psStore').value, date=document.getElementById('psDate').value||psTodayStr(), type=document.getElementById('psType').value;
        var rows=document.querySelectorAll('#psRoster .ps-slot'); var assignments=[];
        rows.forEach(function(row){
            var pos=row.querySelector('.ps-slot-pos').value;
            var nm=(row.querySelector('.ps-slot-name').value||'').trim(); if(!nm) return;
            var emp=psMatchName(nm);
            assignments.push({employee_id: emp?emp.id:null, employee_name: emp?emp.name:nm, position: pos});
        });
        var msg=document.getElementById('psMsg'); msg.style.color='#5b6472'; msg.textContent='Saving…';
        withPin(function(pin){
            supabaseClient.rpc('app_preshift_save',{p_username:currentUser.username,p_password:pin,p_location:store,p_date:date,p_type:type,
                p_goal1:document.getElementById('psGoal1').value, p_goal2:document.getElementById('psGoal2').value, p_assignments:assignments}).then(function(r){
                if(r.error){ msg.style.color='#c0264b'; msg.textContent='Error: '+r.error.message; return; }
                msg.style.color='#1f7a3d'; msg.textContent='✓ Lineup saved ('+assignments.length+' assigned).';
            }).catch(function(){ msg.style.color='#c0264b'; msg.textContent='Could not save.'; });
        });
    }
    function psLoadScheduled(){
        var store=document.getElementById('psStore').value, date=document.getElementById('psDate').value||psTodayStr();
        var msg=document.getElementById('psMsg'); msg.style.color='#5b6472'; msg.textContent='Loading the published schedule…';
        withPin(function(pin){
            supabaseClient.rpc('app_preshift_scheduled',{p_username:currentUser.username,p_password:pin,p_location:store,p_date:date}).then(function(r){
                if(r.error){ msg.style.color='#c0264b'; msg.textContent=(String(r.error.message||'').indexOf('forbidden')>=0?'You do not have access to the schedule.':r.error.message); return; }
                var sched=r.data||[];
                if(!sched.length){ msg.style.color='#9a7400'; msg.textContent='No published schedule for this store/day yet — type names below. (This auto-loads once a weekly schedule is published.)'; return; }
                var exa=sched.map(function(a){ return {pos:(a.position||'Item Maker'), name:(a.employee_name||''), empId:a.employee_id}; }).filter(function(a){ return a.name; });
                renderPreshiftSlots(window._psRoster||[], exa);
                msg.style.color='#1f7a3d'; msg.textContent='✓ Loaded '+exa.length+' crew from the published schedule. Adjust if needed, then Save.';
            }).catch(function(){ msg.style.color='#c0264b'; msg.textContent='Could not load the scheduled crew.'; });
        });
    }
    function psBar(label, done, goal){
        var pct=Math.min(100, Math.round((done/goal)*100));
        var doneStage=done>=goal;
        return '<div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px;"><b style="color:#33303a;">'+label+'</b>'+
               '<span style="color:'+(doneStage?'#1f7a3d':'#8a8594')+';font-weight:700;">'+done+' / '+goal+' days'+(doneStage?' ✓':'')+'</span></div>'+
               '<div style="background:#eee;border-radius:99px;height:9px;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:'+(doneStage?'#1f7a3d':'#185FA5')+';"></div></div></div>';
    }
    function openPositionProgress(empId, name){
        document.getElementById('posProgressName').textContent=(name||'Employee')+' — Training Progress';
        document.getElementById('posProgressBody').innerHTML='<p style="text-align:center;color:#6b7686;padding:20px;">Loading…</p>';
        document.getElementById('posProgressModal').style.display='flex';
        withPin(function(pin){
            supabaseClient.rpc('app_position_tally',{p_username:currentUser.username,p_password:pin,p_employee_id:empId}).then(function(r){
                var body=document.getElementById('posProgressBody');
                if(r.error){ body.innerHTML='<p style="color:#c0264b;text-align:center;padding:14px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var d=r.data||{}; var m=d.milestones||{};
                var h=psBar('1. Training',(m.training||{}).done||0,(m.training||{}).goal||7)+
                      psBar('2. Scooping',(m.scooping||{}).done||0,(m.scooping||{}).goal||7)+
                      psBar('3. Register',(m.register||{}).done||0,(m.register||{}).goal||7)+
                      psBar('4. Machine',(m.machine||{}).done||0,(m.machine||{}).goal||7);
                var total=d.total_days||0;
                h+='<div style="margin-top:8px;padding-top:10px;border-top:1px solid #f0eef4;font-size:12.5px;color:#6b6275;">Total days on the floor: <b style="color:#33303a;">'+total+'</b>';
                var by=d.days_by_position||{}; var parts=Object.keys(by).map(function(k){ return escapeHtml(k)+': '+by[k]; });
                if(parts.length) h+='<br>By position — '+parts.join(' &middot; ');
                h+='</div>';
                if(typeof isManagerRole==='function' ? isManagerRole() : true){
                    h+='<button onclick="openClearance('+empId+','+JSON.stringify(name||'')+')" style="margin-top:12px;width:100%;background:#eef3fb;color:#185FA5;border:none;border-radius:9px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;">&#9881;&#65039; Cleared positions &amp; food-handler card</button>';
                }
                body.innerHTML=h;
            }).catch(function(){ document.getElementById('posProgressBody').innerHTML='<p style="color:#c0264b;text-align:center;padding:14px;">Could not load progress.</p>'; });
        });
    }
    // ----- Clearance & cert setup (managers) -----
    function ensurePositions(cb){
        if(window._allPositions && window._allPositions.length){ cb(window._allPositions); return; }
        if(schedState.data && schedState.data.positions && schedState.data.positions.length){ window._allPositions=schedState.data.positions; cb(window._allPositions); return; }
        var loc=(currentUser&&(currentUser.store||currentUser.location))||'Roadrunner';
        var d=new Date(); var day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); var ws=schedFmt(d);
        withPin(function(pin){ supabaseClient.rpc('app_sched_week_context',{p_username:currentUser.username,p_password:pin,p_location:loc,p_week_start:ws}).then(function(r){ window._allPositions=(r.data&&r.data.positions)||[]; cb(window._allPositions); }).catch(function(){ cb([]); }); });
    }
    function openClearance(empId, name){
        window._clearEmp=empId;
        document.getElementById('clearName').textContent=(name||'Employee');
        document.getElementById('clearBody').innerHTML='<p style="text-align:center;color:#6b7686;padding:18px;">Loading…</p>';
        document.getElementById('clearModal').style.display='flex';
        ensurePositions(function(positions){
            withPin(function(pin){
                Promise.all([
                    supabaseClient.rpc('app_clearance_get',{p_username:currentUser.username,p_password:pin,p_employee_id:empId}),
                    supabaseClient.rpc('app_compliance_all',{p_username:currentUser.username,p_password:pin,p_location:(currentUser.store||'')})
                ]).then(function(res){
                    var cleared=((res[0]&&!res[0].error&&res[0].data)||[]).map(Number);
                    var comp=(res[1]&&!res[1].error&&res[1].data)||{}; var me=comp[empId]||comp[String(empId)]||{};
                    var h='<div style="font-size:12.5px;color:#5b6472;margin-bottom:8px;">Tick the positions this person is cleared to be scheduled on.</div>';
                    if(!positions.length){ h+='<p style="color:#854F0B;font-size:13px;">No positions found — add roles in “Manage roles” first.</p>'; }
                    positions.forEach(function(p){
                        var on=cleared.indexOf(Number(p.id))>=0;
                        h+='<label style="display:flex;align-items:center;gap:9px;padding:7px 4px;border-bottom:1px solid #f0eef4;cursor:pointer;"><input type="checkbox" class="clearchk" value="'+p.id+'"'+(on?' checked':'')+' style="width:17px;height:17px;"><span style="font-size:14px;color:var(--txt,#26242b);">'+escapeHtml(p.name)+'</span></label>';
                    });
                    h+='<label class="rm-lbl" style="margin-top:12px;">Food-handler card expires</label><input id="clearCert" type="date" value="'+(me.cert_expires||'')+'" class="rm-inp">';
                    h+='<div id="clearMsg" style="font-size:12.5px;margin-top:8px;"></div>';
                    document.getElementById('clearBody').innerHTML=h;
                });
            });
        });
    }
    function closeClearance(){ document.getElementById('clearModal').style.display='none'; }
    function saveClearance(){
        var empId=window._clearEmp; var ids=[]; document.querySelectorAll('#clearBody .clearchk:checked').forEach(function(c){ ids.push(parseInt(c.value,10)); });
        var cert=(document.getElementById('clearCert')||{}).value||null;
        var msg=document.getElementById('clearMsg'); if(msg){ msg.style.color='#5b6472'; msg.textContent='Saving…'; }
        withPin(function(pin){
            Promise.all([
                supabaseClient.rpc('app_clearance_set',{p_username:currentUser.username,p_password:pin,p_employee_id:empId,p_position_ids:ids}),
                supabaseClient.rpc('app_cert_set',{p_username:currentUser.username,p_password:pin,p_employee_id:empId,p_expires:cert})
            ]).then(function(res){
                var err=(res[0]&&res[0].error)||(res[1]&&res[1].error);
                if(err){ if(msg){ msg.style.color='#c0264b'; msg.textContent='Error: '+err.message; } return; }
                closeClearance();
                if(typeof fetchScheduleWeek==='function' && document.getElementById('schedGrid')) { try{ fetchScheduleWeek(); }catch(e){} }
            });
        });
    }
