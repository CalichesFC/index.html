    // ============================================================
    // COMPANY CALENDAR + ANNOUNCEMENT ACKNOWLEDGEMENT  (js/30_company_calendar.js)
    // Entry: openCompanyCalendar()   Tile: btn-companyCalendar (everyone)
    // Overlay id: calModal (full-screen, mirrors js/29 shsModal + js/28 macOv).
    //
    // This is an EVERYONE screen with three tabs:
    //   • Calendar  — role/store/sensitivity-filtered business events, colored by
    //                 category. Managers/leadership get "+ New event".
    //   • My Inbox  — acknowledge-inbox: announcements targeted to ME that need my
    //                 read / acknowledge / complete. Available to ALL roles.
    //   • Announce  — managers/leadership only: publish a targeted announcement
    //                 (audience + require-ack / require-action) and see who's
    //                 acknowledged + the missing-acknowledgement feed.
    // Publishing + event creation are gated to store-management/leadership. The
    // backend RPCs are the real gate and return 'forbidden' for front-line users
    // -> shown inline (never a dead screen). NO shift scheduling here — this is
    // business planning + communication only (My Schedule stays separate).
    //
    // BACKEND CONTRACT (must agree with specs/GO_LIVE_8_COMPANY_CALENDAR.sql):
    //   cal_event_list(p_username,p_password,p_from,p_to,p_store) ->
    //     { ok, role, store, can_create, from, to,
    //       categories:[ {key,label,color} ],
    //       events:[ {id,title,category,color,event_date,end_date,all_day,store,
    //                 market,visibility,sensitivity,source_module,status,notes,...} ] }
    //   cal_event_create(p_username,p_password,p_payload) -> { ok, id, task, event }
    //   cal_event_save(p_username,p_password,p_id,p_payload) -> { ok, id, event }
    //   announcement_publish(p_username,p_password,p_payload) ->
    //     { ok, id, task:{task_id,task_status}, requires_ack, requires_action, announcement }
    //   announcement_ack_set(p_username,p_password,p_announcement_id,p_status) -> { ok, status }
    //   announcement_inbox(p_username,p_password) ->
    //     { ok, unread_required, items:[ {id,title,body,ann_type,requires_ack,
    //       requires_action,ack_statement,ack_due,action_due,my_status,needs_ack,needs_action} ] }
    //   announcement_status(p_username,p_password,p_announcement_id) ->
    //     { ok, announcement, counts:{targeted,read,acknowledged,completed,missing,ack_pct},
    //       acked:[ {name,role,store,status,at} ], missing:[ {name,role,store} ] }
    //   announcement_missing_ack_feed(p_username,p_password,p_store) ->
    //     { ok, store, feed:[ {announcement_id,title,ann_type,ack_due,overdue,targeted,acked,missing} ] }
    // ============================================================
    var _cal = { tab:'calendar', store:'', data:null, inbox:null, ann:null, feed:null, cats:[], newOpen:false, statusFor:null };

    // Credential wrapper — identical pattern to shsRpc/scRpc/macRpc.
    function calRpc(name,args,cb,onerr){ withPin(function(pin){ supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){ if(r.error){ if(onerr)onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; } cb(r.data); }).catch(function(){ if(onerr)onerr({message:'Connection error'}); else alert('Connection error.'); }); }); }

    function calOv(){ var o=document.getElementById('calModal'); if(!o){ o=document.createElement('div'); o.id='calModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function calClose(){ var o=document.getElementById('calModal'); if(o) o.style.display='none'; }
    // On-brand header gradient: Caliche's pink (#EC3E7E) -> blue (#106AB3).
    function calHeader(){ return '<div style="background:linear-gradient(120deg,#EC3E7E,#106AB3);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">&#128197; Company Calendar</b><button onclick="calClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }

    // Broad UI gate for PUBLISHING (mirror shsCanSee + backend _cal_mgr). The RPC
    // still enforces the real rule. Calendar + inbox are open to everyone.
    function calCanPublish(){ if(!currentUser) return false; if(currentUser.is_developer===true) return true; if(typeof isManagerRole==='function'&&isManagerRole()) return true; var r=String(currentUser.role||'').toLowerCase(); return r.indexOf('manager')>=0||r.indexOf('admin')>=0||r.indexOf('owner')>=0||r.indexOf('vp')>=0||r.indexOf('vice president')>=0||r.indexOf('director')>=0||r.indexOf('supervisor')>=0||r.indexOf('marketing')>=0||r.indexOf('catering')>=0||r.indexOf('vending')>=0; }
    function calStores(){ return (typeof HUB_STORES!=='undefined'?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell']); }
    function calEmoji(loc){ return (typeof hubStoreEmoji==='function'?hubStoreEmoji(loc):'&#128205;'); }
    function calTodayIso(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
    function calPrettyDate(s){ if(!s) return ''; var p=String(s).slice(0,10).split('-'); if(p.length!==3) return String(s); var dt=new Date(+p[0],+p[1]-1,+p[2]); if(isNaN(dt.getTime())) return String(s); return dt.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}); }
    function calEsc(s){ return (typeof escapeHtml==='function')?escapeHtml(s==null?'':String(s)):String(s==null?'':s); }
    function calCatColor(key){ var c=(_cal.cats||[]).filter(function(x){return x.key===key;})[0]; return (c&&c.color)||'#106AB3'; }
    function calCatLabel(key){ var c=(_cal.cats||[]).filter(function(x){return x.key===key;})[0]; return (c&&c.label)||key||'Event'; }

    var CAL_ANN_TYPES=[['fyi','FYI'],['ack','Acknowledge required'],['action','Action required'],['urgent','Urgent alert'],['manager_briefing','Manager briefing']];
    var CAL_ROLE_CHOICES=['White Apron','Blue Apron','Crew Trainer','Shift Leader','Assistant Manager','Store Manager','Office','Marketing Manager'];
    function calTypeChip(t){ var m={fyi:['#eef3fb','#106AB3','FYI'],ack:['#fff4e0','#9a5b00','Acknowledge'],action:['#fdeaea','#a01b3e','Action'],urgent:['#fde2e7','#c01a4b','Urgent'],manager_briefing:['#f0ecfb','#5b3ea8','Briefing']}; var x=m[t]||m.fyi; return '<span style="background:'+x[0]+';color:'+x[1]+';font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;">'+x[2]+'</span>'; }

    function openCompanyCalendar(){ if(!currentUser){ return; } if(!_cal.tab) _cal.tab='calendar'; calLoad(); }
    function calTab(t){ _cal.tab=t; _cal.newOpen=false; _cal.statusFor=null; calLoad(); }
    function calPickStore(v){ _cal.store=v; calLoad(); }

    function calLoad(){
        var ov=calOv();
        ov.innerHTML=calHeader()+calTabBar()+'<div style="max-width:900px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading&hellip;</div>';
        if(_cal.tab==='inbox'){ calLoadInbox(); return; }
        if(_cal.tab==='announce'){ calLoadAnnounce(); return; }
        // default: calendar
        calRpc('cal_event_list',{p_store:_cal.store||null},function(d){ _cal.data=d||{}; _cal.cats=(d&&d.categories)||[]; calRender(); },function(e){ calErr(e); });
    }
    function calLoadInbox(){ calRpc('announcement_inbox',{},function(d){ _cal.inbox=d||{}; calRender(); },function(e){ calErr(e); }); }
    function calLoadAnnounce(){
        if(!calCanPublish()){ _cal.ann={forbidden:true}; calRender(); return; }
        calRpc('announcement_missing_ack_feed',{p_store:_cal.store||null},function(f){ _cal.feed=f||{}; calRender(); },function(){ _cal.feed={feed:[]}; calRender(); });
    }
    function calErr(e){
        var msg=String((e&&e.message)||''); var ov=calOv();
        var body=(msg.indexOf('forbidden')>=0)
          ? '<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:30px;text-align:center;color:#6b6275;">&#128274; Managers only.</div>'
          : '<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:24px;text-align:center;color:#a01b3e;">'+calEsc(msg||'Could not load.')+'</div>';
        ov.innerHTML=calHeader()+calTabBar()+'<div style="max-width:900px;margin:0 auto;padding:16px;">'+body+'</div>';
    }

    function calTabBar(){
        var unread=(_cal.inbox&&_cal.inbox.unread_required)||0;
        function tb(id,label,extra){ var on=(_cal.tab===id); return '<button onclick="calTab(\''+id+'\')" style="background:'+(on?'#fff':'transparent')+';color:'+(on?'#106AB3':'#5b6675')+';border:none;border-bottom:3px solid '+(on?'#EC3E7E':'transparent')+';padding:10px 14px;font-size:13px;font-weight:800;cursor:pointer;">'+label+(extra||'')+'</button>'; }
        var badge=unread>0?'<span style="background:#EC3E7E;color:#fff;font-size:10px;font-weight:800;border-radius:99px;padding:1px 7px;margin-left:5px;">'+unread+'</span>':'';
        var h='<div style="background:#eef0f3;border-bottom:1px solid #e2e6ec;display:flex;gap:2px;padding:0 8px;position:sticky;top:52px;z-index:2;">';
        h+=tb('calendar','&#128197; Calendar')+tb('inbox','&#128233; My Inbox',badge);
        if(calCanPublish()) h+=tb('announce','&#128226; Announcements');
        h+='</div>'; return h;
    }

    // ---- CALENDAR TAB ----------------------------------------------------------
    function calControls(d){
        var h='<div style="background:#fff;border:1px solid #e6ebf2;border-radius:12px;padding:10px 12px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">';
        if(d.can_create){
            h+='<select onchange="calPickStore(this.value)" style="padding:8px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;font-weight:700;">';
            h+='<option value="">All stores</option>'+calStores().map(function(s){ return '<option value="'+calEsc(s)+'"'+(_cal.store===s?' selected':'')+'>'+calEmoji(s)+' '+calEsc(s)+'</option>'; }).join('');
            h+='</select>';
            h+='<button onclick="calToggleNew()" style="background:#106AB3;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:800;cursor:pointer;">+ New event</button>';
        }
        h+='<span style="flex:1;"></span><button onclick="calLoad()" style="background:#eef0f3;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;">&#8635; Refresh</button>';
        h+='</div>';
        // category legend
        if((_cal.cats||[]).length){ h+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">'+_cal.cats.map(function(c){ return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#5b6675;background:#fff;border:1px solid #eef0f5;border-radius:99px;padding:3px 9px;"><span style="width:9px;height:9px;border-radius:50%;background:'+c.color+';display:inline-block;"></span>'+calEsc(c.label)+'</span>'; }).join('')+'</div>'; }
        return h;
    }
    function calEventCard(e){
        var col=e.color||calCatColor(e.category);
        var span=calPrettyDate(e.event_date)+((e.end_date&&e.end_date!==e.event_date)?(' &ndash; '+calPrettyDate(e.end_date)):'');
        var badges='';
        if(e.store) badges+='<span style="font-size:10px;color:#5b6675;background:#eef0f3;border-radius:99px;padding:1px 8px;">'+calEmoji(e.store)+' '+calEsc(e.store)+'</span>';
        else badges+='<span style="font-size:10px;color:#106AB3;background:#eef3fb;border-radius:99px;padding:1px 8px;">Company-wide</span>';
        if(e.source_module&&e.source_module!=='manual') badges+=' <span style="font-size:10px;color:#8a6d3b;background:#fbf4e8;border-radius:99px;padding:1px 8px;">from '+calEsc(e.source_module)+'</span>';
        if(e.visibility&&e.visibility!=='all') badges+=' <span style="font-size:10px;color:#5b3ea8;background:#f0ecfb;border-radius:99px;padding:1px 8px;">'+calEsc(e.visibility)+'</span>';
        if(e.status&&e.status!=='scheduled'&&e.status!=='active') badges+=' <span style="font-size:10px;color:#9a5b00;background:#fff4e0;border-radius:99px;padding:1px 8px;">'+calEsc(e.status)+'</span>';
        var h='<div style="background:#fff;border:1px solid #eef0f5;border-left:4px solid '+col+';border-radius:12px;padding:11px 13px;margin-bottom:8px;">';
        h+='<div style="display:flex;align-items:baseline;gap:8px;"><b style="flex:1;font-size:14px;color:#1f2a44;">'+calEsc(e.title)+'</b><span style="font-size:12px;font-weight:700;color:'+col+';white-space:nowrap;">'+span+'</span></div>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:5px;"><span style="font-size:10px;font-weight:800;color:#fff;background:'+col+';border-radius:99px;padding:2px 8px;">'+calEsc(calCatLabel(e.category))+'</span>'+badges+'</div>';
        if(e.notes) h+='<div style="font-size:12px;color:#6b6275;margin-top:6px;">'+calEsc(e.notes)+'</div>';
        return h+'</div>';
    }
    function calRenderCalendar(){
        var d=_cal.data||{}; var h=calControls(d);
        if(_cal.newOpen) h+=calNewEventForm();
        var ev=d.events||[];
        if(!ev.length){ h+='<div style="background:#fff;border:1px dashed #cdd5e0;border-radius:14px;padding:28px 18px;text-align:center;color:#5b6675;"><div style="font-size:30px;">&#128197;</div><b style="display:block;color:#1f2a44;margin:6px 0 3px;">No upcoming events in your view</b><div style="font-size:12.5px;">You see only the calendar items for your role and store. '+(d.can_create?'Add one with <b>+ New event</b>.':'Managers add company events here.')+'</div></div>'; }
        else { h+=ev.map(calEventCard).join(''); }
        h+='<div style="font-size:10.5px;color:#98a2b0;text-align:center;margin-top:16px;">role/store/sensitivity-filtered &middot; '+calEsc(d.from||'')+' &rarr; '+calEsc(d.to||'')+' &middot; categories &amp; colors adjustable in Business Settings (calendar_config)</div>';
        return h;
    }
    function calToggleNew(){ _cal.newOpen=!_cal.newOpen; calRender(); }
    function calNewEventForm(){
        var opts=(_cal.cats||[]).map(function(c){ return '<option value="'+c.key+'">'+calEsc(c.label)+'</option>'; }).join('');
        var stores=calStores().map(function(s){ return '<option value="'+calEsc(s)+'">'+calEsc(s)+'</option>'; }).join('');
        var h='<div style="background:#fff;border:1px solid #cfe0f5;border-radius:12px;padding:14px;margin-bottom:12px;">';
        h+='<b style="font-size:13px;color:#106AB3;">New calendar event</b>';
        h+='<input id="calNewTitle" placeholder="Event title" style="width:100%;box-sizing:border-box;margin-top:8px;padding:9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;">';
        h+='<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">';
        h+='<select id="calNewCat" style="padding:8px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;">'+opts+'</select>';
        h+='<label style="font-size:11px;color:#5b6675;">Date <input id="calNewDate" type="date" value="'+calTodayIso()+'" style="border:1px solid #cdd5e0;border-radius:8px;padding:6px;font-size:12px;"></label>';
        h+='<label style="font-size:11px;color:#5b6675;">End <input id="calNewEnd" type="date" style="border:1px solid #cdd5e0;border-radius:8px;padding:6px;font-size:12px;"></label>';
        h+='<select id="calNewStore" style="padding:8px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;"><option value="">Company-wide</option>'+stores+'</select>';
        h+='<select id="calNewVis" style="padding:8px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;"><option value="all">Everyone</option><option value="managers">Managers only</option><option value="leadership">Leadership only</option></select>';
        h+='</div>';
        h+='<textarea id="calNewNotes" placeholder="Notes (optional)" style="width:100%;box-sizing:border-box;margin-top:8px;padding:9px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;min-height:52px;"></textarea>';
        h+='<label style="display:block;font-size:12px;color:#5b6675;margin-top:6px;"><input id="calNewTask" type="checkbox"> Create a follow-up prep task (Task Engine)</label>';
        h+='<div style="margin-top:10px;display:flex;gap:8px;"><button onclick="calCreateEvent()" style="background:#106AB3;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-size:12.5px;font-weight:800;cursor:pointer;">Create event</button><button onclick="calToggleNew()" style="background:#eef0f3;border:none;border-radius:8px;padding:9px 14px;font-size:12.5px;font-weight:700;cursor:pointer;">Cancel</button></div>';
        return h+'</div>';
    }
    function calCreateEvent(){
        var t=(document.getElementById('calNewTitle')||{}).value||''; if(!t.trim()){ alert('A title is required.'); return; }
        var payload={ title:t.trim(), category:(document.getElementById('calNewCat')||{}).value||'company', event_date:(document.getElementById('calNewDate')||{}).value||calTodayIso(), end_date:(document.getElementById('calNewEnd')||{}).value||null, store:(document.getElementById('calNewStore')||{}).value||null, visibility:(document.getElementById('calNewVis')||{}).value||'all', notes:(document.getElementById('calNewNotes')||{}).value||null, requires_task:!!((document.getElementById('calNewTask')||{}).checked) };
        calRpc('cal_event_create',{p_payload:payload},function(){ _cal.newOpen=false; calLoad(); },function(e){ alert(String((e&&e.message)||'').indexOf('forbidden')>=0?'Managers only.':(e&&e.message)||'Could not create.'); });
    }

    // ---- INBOX TAB -------------------------------------------------------------
    function calInboxCard(it){
        var due=it.action_due||it.ack_due; var st=it.my_status||'unseen';
        var stCol=(st==='completed')?'#1b7a3d':(st==='acknowledged'?'#106AB3':(st==='read'?'#5b6675':'#a01b3e'));
        var h='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:12px 14px;margin-bottom:8px;">';
        h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'+calTypeChip(it.ann_type)+'<b style="flex:1;font-size:14px;color:#1f2a44;">'+calEsc(it.title)+'</b>'+(due?'<span style="font-size:11px;color:#9a5b00;">due '+calPrettyDate(due)+'</span>':'')+'</div>';
        if(it.body) h+='<div style="font-size:12.5px;color:#4b5563;line-height:1.5;">'+calEsc(it.body)+'</div>';
        if(it.ack_statement) h+='<div style="font-size:11.5px;color:#6b6275;font-style:italic;margin-top:6px;border-left:3px solid #EC3E7E;padding-left:8px;">'+calEsc(it.ack_statement)+'</div>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:9px;">';
        h+='<span style="font-size:11px;font-weight:800;color:'+stCol+';">status: '+calEsc(st)+'</span><span style="flex:1;"></span>';
        if(it.needs_ack) h+='<button onclick="calAck('+it.id+',\'acknowledged\')" style="background:#106AB3;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:800;cursor:pointer;">&#10003; Acknowledge</button>';
        if(it.needs_action) h+='<button onclick="calAck('+it.id+',\'completed\')" style="background:#1b7a3d;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:800;cursor:pointer;">&#10003; Mark action complete</button>';
        if(!it.needs_ack&&!it.needs_action&&st==='unseen') h+='<button onclick="calAck('+it.id+',\'read\')" style="background:#eef0f3;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;">Mark read</button>';
        h+='</div>'; return h+'</div>';
    }
    function calRenderInbox(){
        var d=_cal.inbox||{}; var items=d.items||[];
        var h='<div style="display:flex;align-items:center;gap:8px;margin:2px 0 12px;"><b style="font-size:15px;color:#1f2a44;">&#128233; Things that need you</b>'+((d.unread_required>0)?'<span style="background:#EC3E7E;color:#fff;font-size:11px;font-weight:800;border-radius:99px;padding:1px 9px;">'+d.unread_required+' need acknowledgement</span>':'')+'<span style="flex:1;"></span><button onclick="calLoad()" style="background:#eef0f3;border:none;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:700;cursor:pointer;">&#8635;</button></div>';
        if(!items.length){ h+='<div style="background:#fff;border:1px dashed #cdd5e0;border-radius:14px;padding:28px 18px;text-align:center;color:#5b6675;"><div style="font-size:30px;">&#9989;</div><b style="display:block;color:#1f2a44;margin:6px 0 3px;">You&rsquo;re all caught up</b><div style="font-size:12.5px;">Announcements sent to you that need a read, acknowledgement, or action will show up here.</div></div>'; }
        else { h+=items.map(calInboxCard).join(''); }
        return h;
    }
    function calAck(id,status){ calRpc('announcement_ack_set',{p_announcement_id:id,p_status:status},function(){ calLoadInbox(); },function(e){ alert(String((e&&e.message)||'').indexOf('forbidden')>=0?'This message isn\'t addressed to you.':(e&&e.message)||'Could not save.'); }); }

    // ---- ANNOUNCE TAB (managers/leadership) ------------------------------------
    function calRenderAnnounce(){
        if(_cal.ann&&_cal.ann.forbidden){ return '<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:30px;text-align:center;color:#6b6275;">&#128274; Publishing is for store management and leadership.</div>'; }
        var h='<div style="display:flex;align-items:center;gap:8px;margin:2px 0 12px;"><b style="font-size:15px;color:#1f2a44;">&#128226; Publish an announcement</b></div>';
        h+=calPublishForm();
        // missing-acknowledgement feed (Manager Action Center mirror)
        var feed=(_cal.feed&&_cal.feed.feed)||[];
        h+='<div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;margin:18px 2px 8px;">Missing acknowledgements</div>';
        if(!feed.length){ h+='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:16px;text-align:center;color:#6b7686;font-size:12.5px;">No outstanding required acknowledgements. &#128077;</div>'; }
        else { h+=feed.map(calFeedRow).join(''); }
        return h;
    }
    function calFeedRow(f){
        var ov=f.overdue; var col=ov?'#a01b3e':'#9a5b00';
        var h='<div style="background:#fff;border:1px solid #eef0f5;border-left:4px solid '+col+';border-radius:12px;padding:11px 13px;margin-bottom:8px;">';
        h+='<div style="display:flex;align-items:center;gap:8px;">'+calTypeChip(f.ann_type)+'<b style="flex:1;font-size:13.5px;color:#1f2a44;">'+calEsc(f.title)+'</b><span style="font-size:11px;font-weight:800;color:'+col+';">'+f.missing+' missing</span></div>';
        h+='<div style="font-size:11px;color:#8a93a2;margin-top:4px;">'+f.acked+' of '+f.targeted+' acknowledged'+(f.ack_due?(' &middot; due '+calPrettyDate(f.ack_due)):'')+(ov?' &middot; <b style="color:#a01b3e;">OVERDUE</b>':'')+'</div>';
        h+='<button onclick="calShowStatus('+f.announcement_id+')" style="margin-top:8px;background:#eef3fb;color:#106AB3;border:1px solid #cfe0f5;border-radius:8px;padding:6px 11px;font-size:11.5px;font-weight:700;cursor:pointer;">See who hasn&rsquo;t acknowledged</button>';
        return h+'</div>';
    }
    function calPublishForm(){
        var types=CAL_ANN_TYPES.map(function(t){ return '<option value="'+t[0]+'">'+t[1]+'</option>'; }).join('');
        var roleBoxes=CAL_ROLE_CHOICES.map(function(r){ return '<label style="font-size:11px;color:#5b6675;background:#eef0f3;border-radius:99px;padding:3px 9px;"><input type="checkbox" class="calAudRole" value="'+calEsc(r)+'"> '+calEsc(r)+'</label>'; }).join('');
        var storeBoxes=calStores().map(function(s){ return '<label style="font-size:11px;color:#5b6675;background:#eef0f3;border-radius:99px;padding:3px 9px;"><input type="checkbox" class="calAudStore" value="'+calEsc(s)+'"> '+calEsc(s)+'</label>'; }).join('');
        var h='<div style="background:#fff;border:1px solid #cfe0f5;border-radius:12px;padding:14px;">';
        h+='<input id="calAnnTitle" placeholder="Announcement title" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;">';
        h+='<textarea id="calAnnBody" placeholder="Message body" style="width:100%;box-sizing:border-box;margin-top:8px;padding:9px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;min-height:64px;"></textarea>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center;">';
        h+='<select id="calAnnType" onchange="calTypeChanged()" style="padding:8px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;">'+types+'</select>';
        h+='<select id="calAnnVis" style="padding:8px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;"><option value="all">Everyone in audience</option><option value="managers">Managers only</option><option value="leadership">Leadership only</option></select>';
        h+='<select id="calAnnSens" style="padding:8px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;"><option value="normal">Normal</option><option value="customer">Customer-sensitive</option><option value="cash">Cash-sensitive</option><option value="hr">HR (leadership)</option><option value="legal">Legal (leadership)</option></select>';
        h+='</div>';
        h+='<div style="margin-top:10px;"><div style="font-size:11px;font-weight:800;color:#5b6675;margin-bottom:4px;">Audience roles <span style="font-weight:600;color:#98a2b0;">(none = everyone)</span></div><div style="display:flex;flex-wrap:wrap;gap:6px;">'+roleBoxes+'</div></div>';
        h+='<div style="margin-top:10px;"><div style="font-size:11px;font-weight:800;color:#5b6675;margin-bottom:4px;">Audience stores <span style="font-weight:600;color:#98a2b0;">(none = all stores)</span></div><div style="display:flex;flex-wrap:wrap;gap:6px;">'+storeBoxes+'</div></div>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:12px;align-items:center;">';
        h+='<label style="font-size:12.5px;color:#1f2a44;font-weight:700;"><input id="calAnnAck" type="checkbox"> Require acknowledgement</label>';
        h+='<label style="font-size:12.5px;color:#1f2a44;font-weight:700;"><input id="calAnnAction" type="checkbox"> Require action (creates a task)</label>';
        h+='</div>';
        h+='<div style="margin-top:10px;display:flex;gap:8px;"><button onclick="calPublish()" style="background:#EC3E7E;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:800;cursor:pointer;">&#128226; Publish</button></div>';
        h+='<div style="font-size:10.5px;color:#98a2b0;margin-top:8px;">Only targeted users receive it. Action-required announcements create a linked Task-Engine task. Nothing publishes automatically &mdash; this is a deliberate action.</div>';
        return h+'</div>';
    }
    function calTypeChanged(){ var t=(document.getElementById('calAnnType')||{}).value; var ack=document.getElementById('calAnnAck'); var act=document.getElementById('calAnnAction'); if(ack) ack.checked=(t==='ack'||t==='urgent'||t==='manager_briefing'); if(act) act.checked=(t==='action'); }
    function calGather(cls){ var out=[]; var els=document.querySelectorAll('.'+cls); for(var i=0;i<els.length;i++){ if(els[i].checked) out.push(els[i].value); } return out; }
    function calPublish(){
        var t=(document.getElementById('calAnnTitle')||{}).value||''; if(!t.trim()){ alert('A title is required.'); return; }
        var payload={ title:t.trim(), body:(document.getElementById('calAnnBody')||{}).value||null, ann_type:(document.getElementById('calAnnType')||{}).value||'fyi', visibility:(document.getElementById('calAnnVis')||{}).value||'all', sensitivity:(document.getElementById('calAnnSens')||{}).value||'normal', audience_roles:calGather('calAudRole'), audience_stores:calGather('calAudStore'), requires_ack:!!((document.getElementById('calAnnAck')||{}).checked), requires_action:!!((document.getElementById('calAnnAction')||{}).checked) };
        calRpc('announcement_publish',{p_payload:payload},function(r){ var task=(r&&r.task)||null; var m='Published.'; if(task){ m+= (task.task_status==='created')?' A linked task was created.':(' Task: '+(task.task_status||'')); } alert(m); calLoadAnnounce(); },function(e){ alert(String((e&&e.message)||'').indexOf('forbidden')>=0?'Managers only.':(e&&e.message)||'Could not publish.'); });
    }
    function calShowStatus(id){ calRpc('announcement_status',{p_announcement_id:id},function(d){ _cal.statusFor=d||{}; calRenderStatusModal(); },function(e){ alert(String((e&&e.message)||'').indexOf('forbidden')>=0?'Managers only.':(e&&e.message)||'Could not load.'); }); }
    function calRenderStatusModal(){
        var d=_cal.statusFor||{}; var c=d.counts||{}; var a=(d.announcement||{});
        var mk=function(list,acked){ if(!list||!list.length) return '<div style="font-size:12px;color:#98a2b0;padding:6px 0;">None</div>'; return list.map(function(u){ return '<div style="display:flex;gap:6px;font-size:12px;padding:4px 0;border-top:1px solid #f0f2f6;"><span style="flex:1;color:#1f2a44;">'+calEsc(u.name||'')+'</span><span style="color:#8a93a2;">'+calEsc(u.role||'')+(u.store?(' &middot; '+calEsc(u.store)):'')+'</span>'+(acked?'<span style="color:#1b7a3d;font-weight:700;">'+calEsc(u.status||'')+'</span>':'')+'</div>'; }).join(''); };
        var o=document.getElementById('calStatusModal'); if(!o){ o=document.createElement('div'); o.id='calStatusModal'; o.style.cssText='position:fixed;inset:0;background:rgba(20,24,33,.55);z-index:100060;display:flex;align-items:center;justify-content:center;padding:16px;'; document.body.appendChild(o); }
        var h='<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:82vh;overflow:auto;">';
        h+='<div style="background:linear-gradient(120deg,#EC3E7E,#106AB3);color:#fff;padding:12px 14px;display:flex;align-items:center;gap:8px;border-radius:14px 14px 0 0;"><b style="flex:1;font-size:14px;">'+calEsc(a.title||'Acknowledgement status')+'</b><button onclick="calCloseStatus()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:5px 9px;cursor:pointer;">&times;</button></div>';
        h+='<div style="padding:14px;">';
        h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">'
          +'<span style="background:#e8f5ec;color:#1b7a3d;font-size:12px;font-weight:800;border-radius:8px;padding:5px 10px;">'+(c.acknowledged||0)+' acknowledged</span>'
          +'<span style="background:#fdeaea;color:#a01b3e;font-size:12px;font-weight:800;border-radius:8px;padding:5px 10px;">'+(c.missing||0)+' missing</span>'
          +'<span style="background:#eef3fb;color:#106AB3;font-size:12px;font-weight:800;border-radius:8px;padding:5px 10px;">'+(c.ack_pct==null?'&mdash;':c.ack_pct+'%')+' complete</span></div>';
        h+='<div style="font-size:11px;font-weight:800;color:#a01b3e;text-transform:uppercase;margin:8px 0 2px;">Hasn&rsquo;t acknowledged</div>'+mk(d.missing,false);
        h+='<div style="font-size:11px;font-weight:800;color:#1b7a3d;text-transform:uppercase;margin:12px 0 2px;">Acknowledged</div>'+mk(d.acked,true);
        h+='</div></div>';
        o.innerHTML=h; o.style.display='flex';
    }
    function calCloseStatus(){ var o=document.getElementById('calStatusModal'); if(o) o.style.display='none'; }

    // ---- ROUTER ----------------------------------------------------------------
    function calRender(){
        var ov=calOv(); var body;
        if(_cal.tab==='inbox') body=calRenderInbox();
        else if(_cal.tab==='announce') body=calRenderAnnounce();
        else body=calRenderCalendar();
        ov.innerHTML=calHeader()+calTabBar()+'<div style="max-width:900px;margin:0 auto;padding:14px 16px 60px;">'+body+'</div>';
    }

    // Entry point exposed on window (matches js/29 openStoreHealthScorecard convention).
    window.openCompanyCalendar = openCompanyCalendar;
