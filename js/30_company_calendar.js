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
    var _cal = { tab:'calendar', store:'', data:null, inbox:null, ann:null, feed:null, cats:[], newOpen:false, editId:null, statusFor:null };

    // Credential wrapper — identical pattern to shsRpc/scRpc/macRpc.
    function calRpc(name,args,cb,onerr){ withPin(function(pin){ supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){ if(r.error){ if(onerr)onerr(r.error); else hubTell(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; } cb(r.data); }).catch(function(){ if(onerr)onerr({message:'Connection error'}); else hubTell('Connection error.'); }); }); }

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
        if(e.source_module&&e.source_module!=='manual') badges+=' <span style="font-size:10px;color:#8a6d3b;background:#fbf4e8;border-radius:99px;padding:1px 8px;">Added automatically</span>';
        var canEdit=!!((_cal.data||{}).can_create);
        if(canEdit || (e.visibility&&e.visibility!=='all')) badges+=' <span style="font-size:12px;color:#5b3ea8;background:#f0ecfb;border-radius:99px;padding:1px 8px;">'+(canEdit?'Seen by: ':'')+calEsc(calWhoLabel(e.visibility))+'</span>';
        if(e.status&&e.status!=='scheduled'&&e.status!=='active') badges+=' <span style="font-size:10px;color:#9a5b00;background:#fff4e0;border-radius:99px;padding:1px 8px;">'+calEsc(e.status)+'</span>';
        var h='<div style="background:#fff;border:1px solid #eef0f5;border-left:4px solid '+col+';border-radius:12px;padding:11px 13px;margin-bottom:8px;">';
        h+='<div style="display:flex;align-items:baseline;gap:8px;"><b style="flex:1;font-size:14px;color:#1f2a44;">'+calEsc(e.title)+'</b><span style="font-size:12px;font-weight:700;color:'+col+';white-space:nowrap;">'+span+'</span></div>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:5px;"><span style="font-size:10px;font-weight:800;color:#fff;background:'+col+';border-radius:99px;padding:2px 8px;">'+calEsc(calCatLabel(e.category))+'</span>'+badges+'</div>';
        if(e.notes) h+='<div style="font-size:12px;color:#6b6275;margin-top:6px;">'+calEsc(e.notes)+'</div>';
        if(canEdit) h+='<div style="margin-top:8px;text-align:right;"><button type="button" onclick="calEdit('+Number(e.id)+')" style="background:none;border:none;color:#106AB3;font-size:13px;font-weight:700;cursor:pointer;padding:6px 2px;min-height:32px;font-family:inherit;">Edit</button></div>';
        return h+'</div>';
    }
    function calRenderCalendar(){
        var d=_cal.data||{}; var h=calControls(d);
        if(_cal.newOpen || _cal.editId) h+=calNewEventForm();
        var ev=d.events||[];
        if(!ev.length){ h+='<div style="background:#fff;border:1px dashed #cdd5e0;border-radius:14px;padding:28px 18px;text-align:center;color:#5b6675;"><div style="font-size:30px;">&#128197;</div><b style="display:block;color:#1f2a44;margin:6px 0 3px;">No upcoming events in your view</b><div style="font-size:12.5px;">You see only the calendar items for your role and store. '+(d.can_create?'Add one with <b>+ New event</b>.':'Managers add company events here.')+'</div></div>'; }
        else { h+=ev.map(calEventCard).join(''); }
        h+='<div style="font-size:12px;color:#7a8594;text-align:center;margin-top:16px;">Showing '+calEsc(calPrettyDate(d.from))+' to '+calEsc(calPrettyDate(d.to))+'. You see the events meant for your role and store.</div>';
        return h;
    }
    var CAL_WHO={ all:'Everyone', managers:'Managers only', leadership:'Leadership only' };
    function calWhoLabel(v){ return CAL_WHO[v]||CAL_WHO.all; }
    function calToggleNew(){ _cal.editId=null; _cal.newOpen=!_cal.newOpen; calRender(); }
    function calEdit(id){ _cal.newOpen=false; _cal.editId=id; calRender(); try{ var f=document.getElementById('calEventForm'); if(f&&f.scrollIntoView) f.scrollIntoView({block:'start'}); }catch(e){} }
    function calCancelForm(){ _cal.newOpen=false; _cal.editId=null; calRender(); }
    // One form for a new event and for changing one. "Who sees this" is enforced on the server.
    function calNewEventForm(){
        var d=_cal.data||{}; var ev=null;
        if(_cal.editId){ ev=(d.events||[]).filter(function(x){ return String(x.id)===String(_cal.editId); })[0]||null; if(!ev){ _cal.editId=null; if(!_cal.newOpen) return ''; } }
        var v=ev||{};
        function sel(a,b){ return String(a||'')===String(b||'')?' selected':''; }
        var lab='display:block;font-size:12px;font-weight:700;color:#5b6675;margin:10px 0 4px;';
        var box='width:100%;box-sizing:border-box;padding:10px;border:1px solid #cdd5e0;border-radius:8px;font-size:14px;font-family:inherit;background:#fff;';
        var opts=(_cal.cats||[]).map(function(c){ return '<option value="'+calEsc(c.key)+'"'+sel(c.key,v.category||'company')+'>'+calEsc(c.label)+'</option>'; }).join('');
        var stores=calStores().map(function(s){ return '<option value="'+calEsc(s)+'"'+sel(s,v.store)+'>'+calEsc(s)+'</option>'; }).join('');
        var who=['all','managers'].concat(d.can_leadership||v.visibility==='leadership'?['leadership']:[]).map(function(k){ return '<option value="'+k+'"'+sel(k,v.visibility||'all')+'>'+CAL_WHO[k]+'</option>'; }).join('');
        var h='<div id="calEventForm" style="background:#fff;border:1px solid #cfe0f5;border-radius:12px;padding:14px;margin-bottom:12px;">';
        h+='<b style="font-size:16px;color:#1f2a44;">'+(ev?'Change this event':'New calendar event')+'</b>';
        h+='<label for="calNewTitle" style="'+lab+'">Title</label><input id="calNewTitle" maxlength="140" value="'+calEsc(v.title||'')+'" style="'+box+'">';
        h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0 10px;">';
        h+='<div><label for="calNewCat" style="'+lab+'">Type</label><select id="calNewCat" style="'+box+'">'+opts+'</select></div>';
        h+='<div><label for="calNewStore" style="'+lab+'">Store</label><select id="calNewStore" style="'+box+'"><option value="">Company-wide</option>'+stores+'</select></div>';
        h+='<div><label for="calNewDate" style="'+lab+'">Date</label><input id="calNewDate" type="date" value="'+calEsc(String(v.event_date||calTodayIso()).slice(0,10))+'" style="'+box+'"></div>';
        h+='<div><label for="calNewEnd" style="'+lab+'">Last day (if more than one)</label><input id="calNewEnd" type="date" value="'+calEsc(String(v.end_date||'').slice(0,10))+'" style="'+box+'"></div>';
        h+='</div>';
        h+='<label for="calNewVis" style="'+lab+'">Who sees this</label><select id="calNewVis" style="'+box+'">'+who+'</select>';
        h+='<div style="font-size:12px;color:#7a8594;margin-top:4px;">Who counts as a manager or leadership is set in Roles &amp; Permissions.</div>';
        h+='<label for="calNewNotes" style="'+lab+'">Notes</label><textarea id="calNewNotes" style="'+box+'min-height:56px;">'+calEsc(v.notes||'')+'</textarea>';
        if(!ev) h+='<label style="display:block;font-size:13px;color:#3d4757;margin-top:10px;"><input id="calNewTask" type="checkbox"> Also make a prep task for this</label>';
        h+='<div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;align-items:center;"><button type="button" onclick="calCancelForm()" style="background:none;border:none;color:#5b6675;font-size:14px;font-weight:700;padding:12px 14px;cursor:pointer;min-height:44px;font-family:inherit;">Cancel</button><button type="button" onclick="calCreateEvent()" style="background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:800;padding:12px 18px;cursor:pointer;min-height:44px;font-family:inherit;">'+(ev?'Save changes':'Add event')+'</button></div>';
        return h+'</div>';
    }
    function calCreateEvent(){
        var g=function(id){ return (document.getElementById(id)||{}).value||''; };
        var t=g('calNewTitle'); if(!t.trim()){ hubTell('A title is required.'); return; }
        var payload={ title:t.trim(), category:g('calNewCat')||'company', event_date:g('calNewDate')||calTodayIso(), end_date:g('calNewEnd')||null, store:g('calNewStore')||null, visibility:g('calNewVis')||'all', notes:g('calNewNotes')||null };
        var fail=function(e){ var m=String((e&&e.message)||''); hubTell(m.indexOf('forbidden')>=0?'You don’t have the switch for that. Ask an admin to check Roles & Permissions.':(m||'Could not save the event.')); };
        if(_cal.editId){
            calRpc('cal_event_save',{p_id:_cal.editId,p_payload:payload},function(){ _cal.editId=null; calLoad(); },fail);
        } else {
            payload.requires_task=!!((document.getElementById('calNewTask')||{}).checked);
            calRpc('cal_event_create',{p_payload:payload},function(){ _cal.newOpen=false; calLoad(); },fail);
        }
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
