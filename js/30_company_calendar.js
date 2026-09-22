    // ============================================================
    // COMPANY CALENDAR + ANNOUNCEMENT ACKNOWLEDGEMENT  (js/30_company_calendar.js)
    // Entry: openCompanyCalendar()   Tile: btn-companyCalendar (everyone)
    // Overlay id: calModal (full-screen, mirrors js/29 shsModal + js/28 macOv).
    //
    // This is an EVERYONE screen. (2026-09-22: the My Inbox + Announce tabs were retired —
    // announcements now live in ONE place, Messages > Announcements, js/09.) Originally three tabs:
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

    function openCompanyCalendar(){ if(!currentUser){ return; } if(!_cal.tab) _cal.tab='calendar'; calLoad(); }
    function calTab(t){ _cal.tab=t; _cal.newOpen=false; _cal.statusFor=null; calLoad(); }
    function calPickStore(v){ _cal.store=v; calLoad(); }

    function calLoad(){
        var ov=calOv();
        ov.innerHTML=calHeader()+calTabBar()+'<div style="max-width:900px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading&hellip;</div>';
        // default: calendar
        calRpc('cal_event_list',{p_store:_cal.store||null},function(d){ _cal.data=d||{}; _cal.cats=(d&&d.categories)||[]; calRender(); },function(e){ calErr(e); });
    }
    function calErr(e){
        var msg=String((e&&e.message)||''); var ov=calOv();
        var body=(msg.indexOf('forbidden')>=0)
          ? '<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:30px;text-align:center;color:#6b6275;">&#128274; Managers only.</div>'
          : '<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:24px;text-align:center;color:#a01b3e;">'+calEsc(msg||'Could not load.')+'</div>';
        ov.innerHTML=calHeader()+calTabBar()+'<div style="max-width:900px;margin:0 auto;padding:16px;">'+body+'</div>';
    }

    function calTabBar(){
        function tb(id,label){ var on=(_cal.tab===id); return '<button onclick="calTab(\''+id+'\')" style="background:'+(on?'#fff':'transparent')+';color:'+(on?'#106AB3':'#5b6675')+';border:none;border-bottom:3px solid '+(on?'#EC3E7E':'transparent')+';padding:10px 14px;font-size:13px;font-weight:800;cursor:pointer;">'+label+'</button>'; }
        return '<div style="background:#eef0f3;border-bottom:1px solid #e2e6ec;display:flex;gap:2px;padding:0 8px;position:sticky;top:52px;z-index:2;">'+tb('calendar','&#128197; Calendar')+'</div>';
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

    // (retired 2026-09-22) The Inbox and Announcements tabs moved to Messages > Announcements (js/09). Calendar keeps the calendar.

    // ---- ROUTER ----------------------------------------------------------------
    function calRender(){
        var ov=calOv(); var body;
        _cal.tab='calendar'; body=calRenderCalendar();
        ov.innerHTML=calHeader()+calTabBar()+'<div style="max-width:900px;margin:0 auto;padding:14px 16px 60px;">'+body+'</div>';
    }

    // Entry point exposed on window (matches js/29 openStoreHealthScorecard convention).
    window.openCompanyCalendar = openCompanyCalendar;
