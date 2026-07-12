/* ============================================================================
 * Caliche's Hub — MONTHLY OPS MEETING HUB  (js/21_ops_meeting.js)
 * Entry: openOpsMeeting()   Overlay id: opsMeetingModal   Tables: opm_*
 *
 * SERVER SHAPE (must match ops_meeting.sql — opm_get returns a jsonb whose
 * TOP-LEVEL keys the code below reads EXACTLY):
 *   { meeting:{id,location,meeting_month,meeting_kind,meeting_date,meeting_time,
 *              status,owner_name,recap_text,review_month,...},
 *     sections:{field_key:value,...},        // 'sl_' keys = shift-leader visible
 *     agenda:[{id,title,details,source,sensitivity,status,required_flag,ack_at,
 *              in_recap,discussed,decision_note,sort_order}],
 *     insights:[{id,source,sensitivity,title,body,meta,status}],  // mgr only
 *     inputs:[{id,kind,body,status,author_name,mine,mgr_response}],
 *     attendance:[{id,employee_id,display_name,emp_role,status}],
 *     actions:[{id,title,details,owner_emp,owner_name,due_date,task_id,status}],
 *     carry:[{id,meeting_id,from_month,title,owner_name,due_date,overdue}],
 *     perf:{review_month,source,days_reported,sales,sales_ly,guests,labor_pct,
 *           speed_seconds,complaints,last_refreshed,ytd_sales,ytd_sales_ly},
 *     acks:[{uname,acked_at}],
 *     me:{can_manage,is_leadership,employee_id,brief_acked} }
 *
 * opm_save_section takes ONE BULK object: {field1:'v', field2:'v', ...}.
 *
 * PRIVACY: shift-leader filtering happens SERVER-side. This file additionally
 * never renders the insights queue, non-'sl_' sections, or decision internals
 * for non-managers, shows the doc §20 warning before making a sensitive item
 * shift-leader visible, and keeps every notification-facing string generic.
 * ==========================================================================*/

    var _opm = { view:'home', mid:null, data:null, list:[], dash:null, cfgd:null,
                 tab:'prep', store:'', leaders:null, followup:null, busy:false };

    function opmRpc(name,args,cb,onerr){ withPin(function(pin){ supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){ if(r.error){ if(onerr)onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return;} cb(r.data);}).catch(function(){ if(onerr)onerr({message:'Connection error'}); else alert('Connection error.'); }); }); }

    function opmEsc(s){ return (typeof escapeHtml==='function')?escapeHtml(s==null?'':String(s)):String(s==null?'':s); }
    function opmIsMgrRole(){ var r=(currentUser&&currentUser.role)||''; return /(manager|admin|owner|vp|vice president|president|director)/i.test(r) || (currentUser&&currentUser.is_developer===true); }
    function opmIsLeadership(){ var r=(currentUser&&currentUser.role)||''; return /(admin|owner|vp|vice president|president|director)/i.test(r); }
    function opmStores(){ return (typeof HUB_STORES!=='undefined'&&HUB_STORES&&HUB_STORES.length)?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell']; }

    function opmOverlay(){ var ov=document.getElementById('opsMeetingModal'); if(!ov){ ov=document.createElement('div'); ov.id='opsMeetingModal'; ov.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100000;overflow:auto;'; document.body.appendChild(ov); } ov.style.display='block'; return ov; }
    function opmClose(){ var ov=document.getElementById('opsMeetingModal'); if(ov) ov.style.display='none'; }
    function opmHeader(title,back){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:5;">'+(back?'<button onclick="'+back+'" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;">&#8249; Back</button>':'')+'<b style="flex:1;font-size:16px;">&#128197; '+opmEsc(title)+'</b><button onclick="opmClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }
    function opmWrap(html){ opmOverlay().innerHTML=html; }
    function opmLoading(msg){ opmWrap(opmHeader('Monthly Ops Meeting','')+'<div style="max-width:820px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">'+opmEsc(msg||'Loading…')+'</div>'); }
    function opmMoney(n){ if(n==null||n===''||isNaN(parseFloat(n))) return '—'; return '$'+parseFloat(n).toLocaleString(); }
    function opmDate(s){ if(!s) return '—'; var p=String(s).slice(0,10).split('-'); if(p.length!==3) return String(s); var d=new Date(+p[0],+p[1]-1,+p[2]); return isNaN(d.getTime())?String(s):d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}); }
    function opmMonthLbl(m){ if(!m) return ''; var p=String(m).split('-'); var d=new Date(+p[0],+p[1]-1,1); return isNaN(d.getTime())?m:d.toLocaleDateString(undefined,{month:'long',year:'numeric'}); }
    function opmBadge(txt,bg,fg){ return '<span style="background:'+bg+';color:'+fg+';font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:99px;white-space:nowrap;">'+txt+'</span>'; }
    function opmSensBadge(s){ if(s==='sensitive') return opmBadge('Sensitive &ndash; Private Review','#fbe4ea','#a01b3e'); if(s==='manager_only') return opmBadge('Manager Only','#fdf0dd','#9a5b00'); return opmBadge('Shift Leader Visible','#e4f3e8','#1b7a3d'); }
    function opmStatusLbl(s){ return {draft:'Draft',agenda_locked:'Agenda locked',brief_published:'Brief published',in_progress:'Meeting in progress',completed:'Completed',recap_sent:'Recap sent',cancelled:'Cancelled'}[s]||s; }
    function opmStatusChip(s){ var c={draft:['#eef0f3','#5b6472'],agenda_locked:['#e3ecfa','#185FA5'],brief_published:['#ede4fb','#5b3aa6'],in_progress:['#fdf0dd','#9a5b00'],completed:['#e4f3e8','#1b7a3d'],recap_sent:['#e4f3e8','#1b7a3d']}[s]||['#eef0f3','#5b6472']; return opmBadge(opmEsc(opmStatusLbl(s)),c[0],c[1]); }
    function opmCard(inner){ return '<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:14px;margin-bottom:10px;">'+inner+'</div>'; }
    function opmEmpty(emoji,msg){ return '<div style="text-align:center;color:#6b7686;padding:26px 12px;"><div style="font-size:34px;">'+emoji+'</div><div style="font-size:13px;margin-top:6px;">'+msg+'</div></div>'; }
    function opmBtn(label,fn,color){ return '<button onclick="'+fn+'" style="background:'+(color||'#185FA5')+';color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:700;cursor:pointer;">'+label+'</button>'; }
    function opmBtnGhost(label,fn){ return '<button onclick="'+fn+'" style="background:#eef0f3;color:#3a4352;border:none;border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:700;cursor:pointer;">'+label+'</button>'; }
    function opmVal(id){ var e=document.getElementById(id); return e?e.value.trim():''; }

    /* ===== entry + home ===================================================== */
    function openOpsMeeting(){
        _opm.view='home'; _opm.mid=null; _opm.data=null;
        _opm.store=_opm.store||(typeof activeStoreLoc==='function'&&activeStoreLoc())||(currentUser&&currentUser.home_location)||'';
        opmLoading('Loading meetings…');
        opmRpc('opm_config_get',{},function(cfgd){ _opm.cfgd=cfgd||{};
            opmRpc('opm_list',{p_store:null,p_limit:24},function(list){ _opm.list=list||[]; opmHomeRender(); });
        });
    }

    function opmHomeRender(){
        var mgr=opmIsMgrRole(), c=_opm.cfgd||{}, month=c.this_month||'';
        var h=opmHeader('Monthly Ops Meeting','');
        h+='<div style="max-width:820px;margin:0 auto;padding:14px 16px 50px;">';
        if(mgr){
            var stores=opmStores();
            h+='<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">'
             +'<span style="font-size:12px;color:#6b6275;font-weight:700;">Store</span>'
             +'<select id="opmStoreSel" onchange="_opm.store=this.value;opmHomeRender();" style="flex:1;min-width:150px;padding:9px;border:1px solid #ddd;border-radius:9px;font-size:13px;">'
             +stores.map(function(s){ return '<option value="'+opmEsc(s)+'"'+(_opm.store===s?' selected':'')+'>'+opmEsc(s)+'</option>'; }).join('')+'</select>'
             +(opmIsLeadership()?opmBtnGhost('&#128202; All-store dashboard','opmDashOpen()'):'')
             +'</div>';
            if(!_opm.store) _opm.store=stores[0];
            var cur=null; (_opm.list||[]).forEach(function(m){ if(m.location===_opm.store&&m.meeting_month===month&&m.meeting_kind==='monthly') cur=m; });
            if(cur){
                var steps=opmMissingSteps(cur);
                h+=opmCard('<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><b style="flex:1;font-size:15px;color:#1f2a44;">'+opmEsc(opmMonthLbl(month))+' &mdash; '+opmEsc(_opm.store)+'</b>'+opmStatusChip(cur.status)+'</div>'
                 +'<div style="font-size:12.5px;color:#5b6472;margin:7px 0;">&#128197; '+opmEsc(opmDate(cur.meeting_date))+(cur.meeting_time?' &middot; '+opmEsc(cur.meeting_time):'')+' &middot; Led by '+opmEsc(cur.owner_name||'—')+'</div>'
                 +(steps.length?'<div style="background:#fdf6e8;border:1px solid #f3e3bd;border-radius:10px;padding:9px 12px;font-size:12.5px;color:#7a5b12;margin-bottom:9px;"><b>Next steps:</b> '+steps.map(opmEsc).join(' &rarr; ')+'</div>':'')
                 +'<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;color:#5b6472;margin-bottom:10px;">'
                 +((cur.pending_insights||0)>0?opmBadge((cur.pending_insights)+' AI suggestion'+(cur.pending_insights>1?'s':'')+' waiting','#ede4fb','#5b3aa6'):'')
                 +((cur.pending_inputs||0)>0?opmBadge((cur.pending_inputs)+' shift-leader question'+(cur.pending_inputs>1?'s':''),'#e3ecfa','#185FA5'):'')
                 +((cur.open_actions||0)>0?opmBadge((cur.open_actions)+' open action item'+(cur.open_actions>1?'s':''),'#fdf0dd','#9a5b00'):'')
                 +'</div>'
                 +opmBtn('Open meeting workspace','opmOpen('+cur.id+')'));
            } else {
                h+=opmCard('<b style="font-size:15px;color:#1f2a44;">'+opmEsc(opmMonthLbl(month))+' &mdash; '+opmEsc(_opm.store)+'</b>'
                 +'<div style="font-size:12.5px;color:#5b6472;margin:7px 0;">No meeting yet this month. The default date is <b>'+opmEsc(opmDate(c.this_month_date))+'</b> ('+opmEsc(c.default_time||'9:00 AM')+') &mdash; adjustable in Business Settings.</div>'
                 +'<div style="display:flex;gap:8px;flex-wrap:wrap;">'+opmBtn('&#10133; Create this month\'s meeting','opmCreate(false)','#1f7a3d')+opmBtnGhost('Add a special meeting','opmCreate(true)')+'</div>');
            }
        } else {
            h+='<p style="font-size:13px;color:#5b6472;">Your store\'s monthly meeting briefs, questions, action items, and recaps live here. You\'ll see a meeting once your manager publishes the pre-meeting brief.</p>';
        }
        var rest=(_opm.list||[]).filter(function(m){ return !(mgr&&m.location===_opm.store&&m.meeting_month===(c.this_month||'')&&m.meeting_kind==='monthly'); });
        if(mgr) rest=rest.filter(function(m){ return m.location===_opm.store; });
        h+='<h3 style="font-size:13px;color:#5b6472;text-transform:uppercase;letter-spacing:.4px;margin:16px 0 8px;">'+(mgr?'Past & other meetings':'Your meetings')+'</h3>';
        if(!rest.length) h+=opmCard(opmEmpty('&#128197;',mgr?'No other meetings yet. Each completed month builds the follow-up history.':'No meetings published for you yet. Check back after your manager shares the brief.'));
        rest.forEach(function(m){
            h+='<div onclick="opmOpen('+m.id+')" style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:11px 14px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:10px;">'
             +'<div style="flex:1;"><b style="font-size:13.5px;color:#1f2a44;">'+opmEsc(opmMonthLbl(m.meeting_month))+' &mdash; '+opmEsc(m.location)+(m.meeting_kind==='special'?' (special)':'')+'</b>'
             +'<div style="font-size:11.5px;color:#6b7686;">'+opmEsc(opmDate(m.meeting_date))+(m.owner_name?' &middot; '+opmEsc(m.owner_name):'')+'</div></div>'
             +opmStatusChip(m.status)+'</div>';
        });
        h+='</div>';
        opmWrap(h);
    }

    function opmMissingSteps(m){
        var s=m.status, out=[];
        if(s==='draft'){ out.push('Review performance'); out.push('Generate & review AI insights'); out.push('Build agenda'); out.push('Lock agenda'); }
        else if(s==='agenda_locked'){ out.push('Publish pre-meeting brief'); }
        else if(s==='brief_published'){ out.push('Hold the meeting (attendance + notes)'); }
        else if(s==='in_progress'){ out.push('Create action items'); out.push('Complete meeting'); }
        else if(s==='completed'){ out.push('Send recap'); }
        return out;
    }

    function opmCreate(special){
        var c=_opm.cfgd||{};
        if(!confirm((special?'Add a SPECIAL meeting':'Create the monthly meeting draft')+' for '+_opm.store+' — '+opmMonthLbl(c.this_month)+'?')) return;
        opmLoading('Creating meeting…');
        opmRpc('opm_create',{p_store:_opm.store,p_month:c.this_month||null,p_kind:special?'special':'monthly'},function(r){
            if(r&&r.carried) alert(r.carried+' open follow-up item'+(r.carried>1?'s':'')+' from past meetings were pulled into your prep area.');
            opmOpen(r.id);
        },function(e){ alert(e.message||'Could not create the meeting.'); opmHomeRender(); });
    }

    /* ===== meeting workspace ================================================ */
    function opmOpen(id){ _opm.mid=id; _opm.view='meeting'; opmLoading('Loading meeting…');
        opmRpc('opm_get',{p_id:id},function(d){ _opm.data=d||{}; _opm.tab=(d&&d.me&&d.me.can_manage)?_opm.tab:'brief'; if(!_opm.data.me) _opm.data.me={}; opmRender(); },
        function(e){ alert(e.message||'Could not open the meeting.'); openOpsMeeting(); });
    }
    function opmReload(){ if(_opm.mid) opmRpc('opm_get',{p_id:_opm.mid},function(d){ _opm.data=d||{}; opmRender(); }); }
    function opmSetTab(t){ _opm.tab=t; opmRender(); }

    function opmTabsHtml(){
        var d=_opm.data, mgr=d.me.can_manage, t=_opm.tab;
        var tabs=mgr?[['prep','Prep'],['perf','Performance'],['agenda','Agenda + AI'],['brief','Brief & Questions'],['live','Live Meeting'],['actions','Action Items'],['recap','Recap'],['followup','Follow-up']]
                    :[['brief','My Brief'],['actions','My Action Items'],['recap','Recap']];
        var h='<div style="display:flex;gap:6px;max-width:860px;margin:12px auto 0;padding:0 16px;overflow-x:auto;">';
        tabs.forEach(function(x){ h+='<button onclick="opmSetTab(\''+x[0]+'\')" style="flex:0 0 auto;background:'+(t===x[0]?'#185FA5':'#eef0f3')+';color:'+(t===x[0]?'#fff':'#5b6472')+';border:none;padding:9px 13px;font-size:12.5px;font-weight:700;cursor:pointer;border-radius:9px;white-space:nowrap;">'+x[1]+'</button>'; });
        return h+'</div>';
    }

    function opmRender(){
        var d=_opm.data; if(!d||!d.meeting){ opmHomeRender(); return; }
        var m=d.meeting, mgr=d.me.can_manage;
        var h=opmHeader(m.location+' — '+opmMonthLbl(m.meeting_month),'openOpsMeeting()');
        h+='<div style="max-width:860px;margin:10px auto 0;padding:0 16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
         +opmStatusChip(m.status)
         +'<span style="font-size:12px;color:#5b6472;">&#128197; '+opmEsc(opmDate(m.meeting_date))+(m.meeting_time?' &middot; '+opmEsc(m.meeting_time):'')+' &middot; '+opmEsc(m.owner_name||'')+'</span>'
         +'<span style="flex:1;"></span>'
         +(mgr?opmBtnGhost('&#128424; Print packet','opmPrint()'):'')
         +'</div>';
        h+=opmTabsHtml();
        var t=_opm.tab, body='';
        if(t==='prep') body=opmPrepHtml(); else if(t==='perf') body=opmPerfHtml();
        else if(t==='agenda') body=opmAgendaHtml(); else if(t==='brief') body=mgr?opmBriefMgrHtml():opmBriefSLHtml();
        else if(t==='live') body=opmLiveHtml(); else if(t==='actions') body=opmActionsHtml();
        else if(t==='recap') body=opmRecapHtml(); else if(t==='followup') body=opmFollowupHtml();
        h+='<div style="max-width:860px;margin:0 auto;padding:12px 16px 60px;">'+body+'</div>';
        opmWrap(h);
        if(t==='followup'&&mgr&&!_opm.followup) opmFollowupLoad();
        if(t==='actions'&&mgr&&!_opm.leaders){ _opm.leaders=[]; opmLeadersLoad(); }
    }

    /* ===== PREP (manager first screen) ===================================== */
    function opmPrepHtml(){
        var d=_opm.data, m=d.meeting;
        var steps=opmMissingSteps(m);
        var sugg=(d.insights||[]).filter(function(i){ return i.status==='suggested'; }).length;
        var pend=(d.inputs||[]).filter(function(i){ return i.status==='submitted'; }).length;
        var openA=(d.actions||[]).filter(function(a){ return a.status==='open'; }).length;
        var h='';
        h+=opmCard('<b style="font-size:14px;color:#1f2a44;">Where this meeting stands</b>'
          +(steps.length?'<div style="background:#fdf6e8;border:1px solid #f3e3bd;border-radius:10px;padding:9px 12px;font-size:12.5px;color:#7a5b12;margin:8px 0;"><b>Next:</b> '+steps.map(opmEsc).join(' &rarr; ')+'</div>'
                        :'<div style="font-size:12.5px;color:#1b7a3d;margin:8px 0;">All steps complete. &#127881;</div>')
          +'<div style="display:flex;gap:8px;flex-wrap:wrap;">'
          +(sugg?opmBadge(sugg+' AI suggestion'+(sugg>1?'s':'')+' to review','#ede4fb','#5b3aa6'):'')
          +(pend?opmBadge(pend+' shift-leader submission'+(pend>1?'s':''),'#e3ecfa','#185FA5'):'')
          +((d.carry||[]).length?opmBadge((d.carry.length)+' carry-forward item'+(d.carry.length>1?'s':''),'#fdf0dd','#9a5b00'):'')
          +(openA?opmBadge(openA+' open action item'+(openA>1?'s':''),'#fdf0dd','#9a5b00'):'')
          +'</div>'
          +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:11px;">'
          +(m.status==='draft'?opmBtn('&#128274; Lock agenda','opmLock()'):'')
          +(m.status==='agenda_locked'?opmBtn('&#128228; Publish pre-meeting brief','opmPublish()','#5b3aa6'):'')
          +(m.status==='brief_published'||m.status==='in_progress'?opmBtn('&#9989; Complete meeting','opmCompletePrompt()','#1f7a3d'):'')
          +(m.status==='completed'?opmBtn('&#128232; Send recap','opmSetTab(\'recap\')','#1f7a3d'):'')
          +'</div>');
        h+=opmCard('<b style="font-size:13.5px;color:#1f2a44;">Meeting details</b>'
          +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:end;">'
          +'<div><label style="font-size:11px;color:#6b7686;display:block;">Date</label><input type="date" id="opmMDate" value="'+opmEsc(m.meeting_date||'')+'" style="padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;"></div>'
          +'<div><label style="font-size:11px;color:#6b7686;display:block;">Time</label><input id="opmMTime" value="'+opmEsc(m.meeting_time||'')+'" style="padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;width:110px;"></div>'
          +opmBtnGhost('Save','opmSaveDetails()')
          +'</div><div style="font-size:11px;color:#8a93a3;margin-top:6px;">Default cadence (first-Saturday etc.) is set by admins in Business Settings &rarr; Ops Meeting.</div>');
        if((d.carry||[]).length){
            var cc='';
            d.carry.forEach(function(x){ cc+='<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid #f2f2f6;font-size:12.5px;color:#3a4352;"><span style="flex:1;">'+opmEsc(x.title)+' <span style="color:#8a93a3;">('+opmEsc(x.from_month)+(x.owner_name?' &middot; '+opmEsc(x.owner_name):'')+')</span></span>'+(x.overdue?opmBadge('Overdue','#fbe4ea','#a01b3e'):opmBadge('Follow Up Next Month','#fdf0dd','#9a5b00'))+'</div>'; });
            h+=opmCard('<b style="font-size:13.5px;color:#1f2a44;">&#128260; Still open from past meetings</b>'+cc);
        }
        return h;
    }
    function opmSaveDetails(){
        // reschedules are stored as sections (kept simple: the original record
        // date stays for history; the override is shown on the packet/brief)
        var f={}; f['sl_meeting_date_override']=opmVal('opmMDate'); f['sl_meeting_time_override']=opmVal('opmMTime');
        opmRpc('opm_save_section',{p_id:_opm.mid,p_fields:f},function(){ alert('Saved. The rescheduled date/time is shown to shift leaders on the brief.'); opmReload(); });
    }
    function opmLock(){ if(!confirm('Lock the agenda? Leadership-required topics must be acknowledged first.')) return;
        opmRpc('opm_lock',{p_id:_opm.mid},function(){ opmReload(); }); }
    function opmPublish(){ if(!confirm('Publish the pre-meeting brief to your shift leaders?\n\nThey will see ONLY approved, shift-leader-visible topics and sl_ marked notes — never manager-only or sensitive content.')) return;
        opmRpc('opm_publish_brief',{p_id:_opm.mid},function(r){ alert('Brief published.'+(r&&r.seeded?(' '+r.seeded+' shift leader(s) added to the expected attendance list.'):'')); opmReload(); }); }

    /* ===== PERFORMANCE ====================================================== */
    function opmPerfLabel(kind,val){
        var c=_opm.cfgd||{};
        if(val==null) return opmBadge('Needs Review','#eef0f3','#5b6472');
        if(kind==='sales'){ var th=parseFloat(c.sales_watch||'-5'); if(val>=0) return opmBadge('Improved','#e4f3e8','#1b7a3d'); if(val>=th) return opmBadge('Watch','#fdf0dd','#9a5b00'); return opmBadge('Concern','#fbe4ea','#a01b3e'); }
        if(kind==='labor'){ var lt=parseFloat(c.labor_watch||'25'); if(val<=lt) return opmBadge('Improved','#e4f3e8','#1b7a3d'); if(val<=lt+3) return opmBadge('Watch','#fdf0dd','#9a5b00'); return opmBadge('Concern','#fbe4ea','#a01b3e'); }
        return '';
    }
    function opmPerfHtml(){
        var d=_opm.data, p=d.perf||{}, mgr=d.me.can_manage, s=d.sections||{};
        var h='<div style="font-size:12px;color:#6b7686;margin-bottom:8px;">Reviewing <b>'+opmEsc(opmMonthLbl(p.review_month))+'</b> &middot; Source: <b>'+opmEsc(p.source||'manual')+'</b>'+(p.last_refreshed?' &middot; last refreshed '+opmEsc(opmDate(p.last_refreshed)):'')+'</div>';
        var hasData=(p.days_reported||0)>0;
        if(hasData){
            var pct=(p.sales_ly>0&&p.sales!=null)?Math.round(1000.0*(p.sales-p.sales_ly)/p.sales_ly)/10:null;
            var ypct=(p.ytd_sales_ly>0&&p.ytd_sales!=null)?Math.round(1000.0*(p.ytd_sales-p.ytd_sales_ly)/p.ytd_sales_ly)/10:null;
            function tile(lbl,val,sub,badge){ return '<div style="flex:1;min-width:130px;background:#fff;border:1px solid #ececf2;border-radius:12px;padding:11px;"><div style="font-size:10.5px;font-weight:800;text-transform:uppercase;color:#5b6675;">'+lbl+'</div><div style="font-size:19px;font-weight:800;color:#1f2a44;">'+val+'</div><div style="font-size:11px;color:#6b7686;">'+(sub||'')+'</div><div style="margin-top:4px;">'+(badge||'')+'</div></div>'; }
            h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">'
             +tile('Sales',opmMoney(p.sales),(pct!=null?((pct>=0?'+':'')+pct+'% vs last year'):'no LY data'),opmPerfLabel('sales',pct))
             +tile('Sales YTD',opmMoney(p.ytd_sales),(ypct!=null?((ypct>=0?'+':'')+ypct+'% vs LY'):''),opmPerfLabel('sales',ypct))
             +tile('Guests',(p.guests!=null?Number(p.guests).toLocaleString():'—'),'','')
             +tile('Labor',(p.labor_pct!=null?p.labor_pct+'%':'—'),'',opmPerfLabel('labor',p.labor_pct))
             +tile('Speed',(p.speed_seconds!=null?p.speed_seconds+'s':'—'),'','')
             +tile('Complaints',(p.complaints!=null?p.complaints:'—'),'',(p.complaints>0?opmBadge('Needs Review','#fbe4ea','#a01b3e'):''))
             +'</div>';
        } else {
            h+=opmCard(opmEmpty('&#128200;','No scorecard numbers found for '+opmEsc(opmMonthLbl(p.review_month))+' yet.'+(mgr?' Use the manual fields below — they never overwrite source data.':'')));
        }
        function noteRow(key,label){
            var v=s[key]||'';
            if(!mgr) return v?('<div style="padding:7px 0;border-top:1px solid #f2f2f6;font-size:12.5px;color:#3a4352;"><b style="color:#5b6675;">'+label+':</b> '+opmEsc(v)+'</div>'):'';
            return '<label style="display:block;font-size:11.5px;color:#6b7686;margin:8px 0 3px;">'+label+' <span style="color:#1b7a3d;font-weight:700;">(shift-leader visible)</span></label><textarea id="opm_'+key+'" rows="2" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;">'+opmEsc(v)+'</textarea>';
        }
        var inner='<b style="font-size:13.5px;color:#1f2a44;">Explain the numbers (plain English for the team)</b>'
          +noteRow('sl_perf_sales','Sales — what happened & why')
          +noteRow('sl_perf_labor','Labor & scheduling context')
          +noteRow('sl_perf_wins','What went WELL last month')
          +noteRow('sl_perf_focus','Focus areas for the coming month');
        if(mgr&&!hasData){
            inner+='<div style="border-top:1px dashed #ddd;margin-top:10px;padding-top:8px;"><b style="font-size:12.5px;color:#1f2a44;">Manual fallback numbers</b> <span style="font-size:11px;color:#8a93a3;">(shown with the packet; source data is never overwritten)</span>'
              +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">'
              +'<input id="opm_sl_manual_sales" placeholder="Sales $" value="'+opmEsc(s.sl_manual_sales||'')+'" style="flex:1;min-width:110px;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;">'
              +'<input id="opm_sl_manual_sales_ly" placeholder="Sales LY $" value="'+opmEsc(s.sl_manual_sales_ly||'')+'" style="flex:1;min-width:110px;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;">'
              +'<input id="opm_sl_manual_labor" placeholder="Labor %" value="'+opmEsc(s.sl_manual_labor||'')+'" style="flex:1;min-width:90px;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;">'
              +'<input id="opm_sl_manual_guests" placeholder="Guests" value="'+opmEsc(s.sl_manual_guests||'')+'" style="flex:1;min-width:90px;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;">'
              +'</div></div>';
        }
        if(mgr) inner+='<div style="margin-top:10px;">'+opmBtn('Save performance notes','opmPerfSave()')+'</div>';
        h+=opmCard(inner);
        if(mgr) h+=opmCard('<b style="font-size:13.5px;color:#1f2a44;">Manager-only performance notes</b><textarea id="opm_mgr_perf_private" rows="3" placeholder="Private context, staffing/HR notes — never shown to shift leaders." style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;margin-top:6px;">'+opmEsc(s.mgr_perf_private||'')+'</textarea><div style="display:flex;align-items:center;gap:8px;margin-top:8px;">'+opmSensBadge('manager_only')+opmBtnGhost('Save private note','opmPerfSave()')+'</div>');
        return h;
    }
    function opmPerfSave(){
        var keys=['sl_perf_sales','sl_perf_labor','sl_perf_wins','sl_perf_focus','sl_manual_sales','sl_manual_sales_ly','sl_manual_labor','sl_manual_guests','mgr_perf_private'];
        var f={}; keys.forEach(function(k){ var e=document.getElementById('opm_'+k); if(e) f[k]=e.value; });
        opmRpc('opm_save_section',{p_id:_opm.mid,p_fields:f},function(){ opmReload(); });
    }

    /* ===== AGENDA + AI INSIGHTS ============================================ */
    function opmSrcBadge(src){ var map={manual:['Manager','#eef0f3','#5b6472'],ai:['Cherry suggestion','#ede4fb','#5b3aa6'],leadership:['Leadership Required','#fbe4ea','#a01b3e'],shift_leader:['From a shift leader','#e3ecfa','#185FA5'],carry_forward:['Follow Up Next Month','#fdf0dd','#9a5b00'],your_voice:['Team voice theme','#e4f3e8','#1b7a3d']}; var x=map[src]||map.manual; return opmBadge(x[0],x[1],x[2]); }
    function opmAgendaHtml(){
        var d=_opm.data, m=d.meeting, mgr=d.me.can_manage, h='';
        if(!mgr) return opmBriefSLHtml();
        // --- AI insight queue (manager only) ---
        var sugg=(d.insights||[]).filter(function(i){ return i.status==='suggested'; });
        var decided=(d.insights||[]).filter(function(i){ return i.status!=='suggested'; });
        var ih='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><b style="flex:1;font-size:13.5px;color:#1f2a44;">&#129302; Cherry\'s suggested topics</b>'
          +opmBtn('&#10024; Generate insights','opmGenInsights()','#5b3aa6')+'</div>'
          +'<div style="font-size:11.5px;color:#6b7686;margin:5px 0 8px;">Suggestions only — nothing reaches shift leaders until YOU approve it. Your Voice items are aggregate themes only; confidential submissions never appear here, only a private review alert.</div>';
        if(!sugg.length) ih+=opmEmpty('&#129302;','No suggestions waiting. Tap Generate to have Cherry scan performance, logbook, maintenance, supply, team-voice themes, and past-meeting follow-ups.');
        sugg.forEach(function(i){
            var sens=(i.sensitivity==='sensitive');
            ih+='<div style="border:1px solid '+(sens?'#f3b4b4':'#ececf2')+';border-radius:11px;padding:10px 12px;margin-bottom:8px;background:'+(sens?'#fdf7f8':'#fafbfd')+';">'
              +'<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;"><b style="flex:1;font-size:13px;color:#1f2a44;">'+opmEsc(i.title)+'</b>'+opmSrcBadge(i.source==='your_voice'?'your_voice':'ai')+(sens?opmSensBadge('sensitive'):'')+'</div>'
              +(i.body?'<div style="font-size:12.5px;color:#3a4352;margin:5px 0;">'+opmEsc(i.body)+'</div>':'')
              +'<div style="font-size:10.5px;color:#8a93a3;">Source: '+opmEsc(i.source)+(i.meta&&i.meta.refreshed_at?' &middot; refreshed '+opmEsc(String(i.meta.refreshed_at).slice(0,16).replace('T',' ')):'')+'</div>'
              +'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px;">'
              +opmBtn(sens?'Accept as Manager-Only topic':'Add to agenda','opmInsight('+i.id+',\'accept\')','#1f7a3d')
              +opmBtnGhost('Reject','opmInsight('+i.id+',\'reject\')')
              +opmBtnGhost('Defer','opmInsight('+i.id+',\'defer\')')
              +opmBtnGhost('Handle privately','opmInsight('+i.id+',\'private\')')
              +'</div></div>';
        });
        if(decided.length) ih+='<div style="font-size:11px;color:#8a93a3;margin-top:4px;">'+decided.length+' earlier suggestion'+(decided.length>1?'s':'')+' decided (kept for the audit trail).</div>';
        h+=opmCard(ih);
        // --- agenda ---
        var items=(d.agenda||[]).filter(function(a){ return a.status!=='rejected'; });
        var rejected=(d.agenda||[]).filter(function(a){ return a.status==='rejected'; });
        var ah='<b style="font-size:13.5px;color:#1f2a44;">&#128203; Agenda</b>';
        if(!items.length) ah+=opmEmpty('&#128203;','No agenda topics yet. Accept a suggestion or add your own below.');
        items.forEach(function(a){
            var pend=(a.status==='suggested'||a.status==='deferred');
            ah+='<div style="border:1px solid #ececf2;border-radius:11px;padding:10px 12px;margin:8px 0;background:'+(pend?'#fffdf5':'#fff')+';">'
              +'<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;"><b style="flex:1;font-size:13px;color:#1f2a44;">'+opmEsc(a.title)+'</b>'
              +opmSrcBadge(a.source)+opmSensBadge(a.sensitivity)
              +(a.required_flag?(a.ack_at?opmBadge('Required &middot; acknowledged','#e4f3e8','#1b7a3d'):opmBadge('Leadership Required &mdash; acknowledge','#fbe4ea','#a01b3e')):'')
              +(a.in_recap?opmBadge('Added to Recap','#e3ecfa','#185FA5'):'')
              +(pend?opmBadge(a.status==='deferred'?'Deferred':'Suggested','#fdf0dd','#9a5b00'):'')
              +'</div>'
              +(a.details?'<div style="font-size:12.5px;color:#3a4352;margin:5px 0;">'+opmEsc(a.details)+'</div>':'')
              +'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">'
              +(pend?opmBtn('Approve','opmAgendaOp('+a.id+',\'approve\')','#1f7a3d'):'')
              +(pend?opmBtnGhost('Reject','opmAgendaOp('+a.id+',\'reject\')'):'')
              +(a.required_flag&&!a.ack_at?opmBtn('Acknowledge','opmAgendaOp('+a.id+',\'ack\')','#a01b3e'):'')
              +opmBtnGhost('Edit','opmAgendaEdit('+a.id+')')
              +opmBtnGhost(a.in_recap?'Pull from recap':'Add to recap','opmAgendaOp('+a.id+',\'recap_toggle\')')
              +opmBtnGhost('Visibility','opmAgendaSens('+a.id+')')
              +opmBtnGhost('Remove','opmAgendaOp('+a.id+',\'remove\')')
              +'</div></div>';
        });
        if(rejected.length) ah+='<div style="font-size:11px;color:#8a93a3;">'+rejected.length+' rejected topic'+(rejected.length>1?'s':'')+' hidden (audit kept; never shown to shift leaders).</div>';
        ah+='<div style="border-top:1px dashed #ddd;margin-top:10px;padding-top:10px;"><b style="font-size:12.5px;color:#1f2a44;">Add a topic</b>'
          +'<input id="opmAgTitle" placeholder="Topic title" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:13px;margin:6px 0;">'
          +'<textarea id="opmAgDet" rows="2" placeholder="Talking points (optional)" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;"></textarea>'
          +'<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:7px;">'
          +'<select id="opmAgSens" style="padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;"><option value="normal">Shift Leader Visible</option><option value="manager_only">Manager Only</option><option value="sensitive">Sensitive &ndash; Private Review</option></select>'
          +(d.me.is_leadership?'<label style="font-size:12px;color:#a01b3e;font-weight:700;"><input type="checkbox" id="opmAgReq"> Company-required topic</label>':'')
          +opmBtn('Add topic','opmAgendaAdd()')
          +'</div></div>';
        h+=opmCard(ah);
        return h;
    }
    function opmGenInsights(){ if(_opm.busy) return; _opm.busy=true;
        opmRpc('opm_insights_generate',{p_id:_opm.mid},function(r){ _opm.busy=false; alert('Cherry filed '+((r&&r.generated)||0)+' suggestion'+((r&&r.generated)===1?'':'s')+' for your review.'); opmReload(); },function(e){ _opm.busy=false; alert(e.message||'Could not generate.'); }); }
    function opmInsight(id,op){
        if(op==='accept'){ var i=null; (_opm.data.insights||[]).forEach(function(x){ if(x.id===id) i=x; });
            if(i&&i.sensitivity==='sensitive'&&!confirm('This is a SENSITIVE item. Accepting adds it as a MANAGER-ONLY agenda topic — it will never appear in the shift-leader brief or recap. Continue?')) return; }
        opmRpc('opm_insight_set',{p_insight_id:id,p_op:op},function(){ opmReload(); });
    }
    function opmAgendaAdd(){
        var t=opmVal('opmAgTitle'); if(!t){ alert('Give the topic a title.'); return; }
        var req=document.getElementById('opmAgReq');
        opmRpc('opm_agenda_add',{p_id:_opm.mid,p_title:t,p_details:opmVal('opmAgDet')||null,p_sensitivity:opmVal('opmAgSens')||'normal',p_required:!!(req&&req.checked)},function(){ opmReload(); });
    }
    function opmAgendaOp(id,op){ opmRpc('opm_agenda_set',{p_item_id:id,p_op:op,p_payload:{}},function(){ opmReload(); }); }
    function opmAgendaEdit(id){
        var a=null; (_opm.data.agenda||[]).forEach(function(x){ if(x.id===id) a=x; }); if(!a) return;
        var t=prompt('Topic title:',a.title||''); if(t==null) return;
        var det=prompt('Talking points:',a.details||''); if(det==null) det=a.details;
        opmRpc('opm_agenda_set',{p_item_id:id,p_op:'edit',p_payload:{title:t,details:det}},function(){ opmReload(); });
    }
    function opmAgendaSens(id){
        var a=null; (_opm.data.agenda||[]).forEach(function(x){ if(x.id===id) a=x; }); if(!a) return;
        var v=prompt('Visibility: type one of  normal / manager_only / sensitive',a.sensitivity||'normal'); if(!v) return; v=v.trim();
        if(['normal','manager_only','sensitive'].indexOf(v)<0){ alert('Use normal, manager_only, or sensitive.'); return; }
        var payload={sensitivity:v};
        if((a.sensitivity==='sensitive'||a.sensitivity==='manager_only')&&v==='normal'){
            if(!confirm('⚠️ WARNING: you are about to make a sensitive / manager-only item VISIBLE TO SHIFT LEADERS in the brief and recap.\n\nMake sure it contains no employee-identifying or confidential Your Voice information. Continue?')) return;
            var reason=prompt('Required: why is this now safe to share? (recorded in the audit trail)'); if(!reason){ alert('A reason is required.'); return; }
            payload.reason=reason;
        }
        opmRpc('opm_agenda_set',{p_item_id:id,p_op:'sensitivity',p_payload:payload},function(){ opmReload(); });
    }

    /* ===== BRIEF & QUESTIONS =============================================== */
    function opmBriefMgrHtml(){
        var d=_opm.data, m=d.meeting, h='';
        var pubd=['brief_published','in_progress','completed','recap_sent'].indexOf(m.status)>=0;
        h+=opmCard('<b style="font-size:13.5px;color:#1f2a44;">Pre-meeting brief</b>'
          +'<div style="font-size:12.5px;color:#5b6472;margin:6px 0;">Shift leaders receive: approved <b>Shift Leader Visible</b> topics, the performance summary with your explanations, and any notes saved with shift-leader visibility. Manager-only and sensitive items are excluded automatically.</div>'
          +(pubd?'<div style="font-size:12.5px;color:#1b7a3d;">&#9989; Published '+opmEsc(m.published_at?String(m.published_at).slice(0,16).replace('T',' '):'')+'</div>'
                :(m.status==='agenda_locked'?opmBtn('&#128228; Publish brief to shift leaders','opmPublish()','#5b3aa6')
                :'<div style="font-size:12.5px;color:#9a5b00;">Lock the agenda first (Prep tab), then publish.</div>')));
        if(pubd){
            var acks=d.acks||[];
            h+=opmCard('<b style="font-size:13px;color:#1f2a44;">Read receipts</b>'+(acks.length?('<div style="font-size:12.5px;color:#3a4352;margin-top:5px;">'+acks.map(function(a){ return opmEsc(a.uname)+' ('+opmEsc(String(a.acked_at||'').slice(0,10))+')'; }).join(', ')+'</div>'):opmEmpty('&#128064;','No shift leaders have opened the brief yet.')));
        }
        var subs=d.inputs||[];
        var sh='<b style="font-size:13.5px;color:#1f2a44;">Shift-leader questions & suggested topics</b>';
        if(!subs.length) sh+=opmEmpty('&#128172;','Nothing submitted yet. Shift leaders can send questions once the brief is published.');
        subs.forEach(function(s){
            sh+='<div style="border:1px solid #ececf2;border-radius:11px;padding:10px 12px;margin-top:8px;">'
              +'<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;"><b style="flex:1;font-size:12.5px;color:#1f2a44;">'+opmEsc(s.author_name||'Shift leader')+' &middot; '+(s.kind==='question'?'Question':'Suggested topic')+'</b>'+opmBadge(opmEsc(s.status),'#eef0f3','#5b6472')+'</div>'
              +'<div style="font-size:12.5px;color:#3a4352;margin:5px 0;">'+opmEsc(s.body)+'</div>'
              +(s.mgr_response?'<div style="font-size:12px;color:#5b3aa6;background:#f5f0fc;border-radius:8px;padding:6px 9px;">Your reply: '+opmEsc(s.mgr_response)+'</div>':'')
              +(s.status==='submitted'?('<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">'
                +opmBtn('Approve as topic','opmInputOp('+s.id+',\'approve\')','#1f7a3d')
                +opmBtnGhost('Respond privately','opmInputOp('+s.id+',\'respond\')')
                +opmBtnGhost('Merge/absorb','opmInputOp('+s.id+',\'merge\')')
                +opmBtnGhost('Decline','opmInputOp('+s.id+',\'reject\')')+'</div>'):'')
              +'</div>';
        });
        h+=opmCard(sh);
        return h;
    }
    function opmInputOp(id,op){
        var resp=null;
        if(op==='respond'||op==='merge'||op==='reject'){ resp=prompt(op==='respond'?'Private reply to the submitter:':(op==='merge'?'Note (e.g. which topic this was merged into):':'Optional note back to the submitter:')); if(op==='respond'&&!resp) return; }
        if(op==='approve'){ resp=prompt('Optional: rename the topic for the agenda (blank keeps their wording):')||null; }
        opmRpc('opm_input_review',{p_input_id:id,p_op:op,p_response:resp},function(){ opmReload(); });
    }
    function opmBriefSLHtml(){
        var d=_opm.data, m=d.meeting, s=d.sections||{}, h='';
        h+=opmCard('<b style="font-size:14px;color:#1f2a44;">Pre-meeting brief &mdash; '+opmEsc(opmMonthLbl(m.meeting_month))+'</b>'
          +'<div style="font-size:12px;color:#5b6472;margin:5px 0;">&#128197; '+opmEsc(opmDate(m.meeting_date))+(m.meeting_time?' &middot; '+opmEsc(m.meeting_time):'')+' &middot; led by '+opmEsc(m.owner_name||'your manager')+'</div>'
          +(d.me.brief_acked?'<div style="font-size:12px;color:#1b7a3d;">&#9989; You marked this brief as read.</div>':opmBtn('&#9989; I\'ve read the brief','opmAck()','#1f7a3d')));
        // performance summary (server already sanitized)
        var p=d.perf||{};
        if((p.days_reported||0)>0||s.sl_manual_sales){
            var pct=(p.sales_ly>0&&p.sales!=null)?Math.round(1000.0*(p.sales-p.sales_ly)/p.sales_ly)/10:null;
            h+=opmCard('<b style="font-size:13px;color:#1f2a44;">How our store did ('+opmEsc(opmMonthLbl(p.review_month))+')</b>'
              +'<div style="font-size:12.5px;color:#3a4352;margin-top:6px;">Sales: <b>'+((p.days_reported||0)>0?opmMoney(p.sales):opmEsc(s.sl_manual_sales||'—'))+'</b>'+(pct!=null?(' ('+(pct>=0?'+':'')+pct+'% vs last year)'):'')
              +((p.labor_pct!=null)?' &middot; Labor: <b>'+p.labor_pct+'%</b>':(s.sl_manual_labor?' &middot; Labor: <b>'+opmEsc(s.sl_manual_labor)+'%</b>':''))
              +((p.guests!=null)?' &middot; Guests: <b>'+Number(p.guests).toLocaleString()+'</b>':'')+'</div>'
              +(s.sl_perf_sales?'<div style="font-size:12.5px;color:#3a4352;margin-top:6px;"><b>Sales:</b> '+opmEsc(s.sl_perf_sales)+'</div>':'')
              +(s.sl_perf_labor?'<div style="font-size:12.5px;color:#3a4352;margin-top:4px;"><b>Labor:</b> '+opmEsc(s.sl_perf_labor)+'</div>':'')
              +(s.sl_perf_wins?'<div style="font-size:12.5px;color:#1b7a3d;margin-top:4px;"><b>Wins:</b> '+opmEsc(s.sl_perf_wins)+'</div>':'')
              +(s.sl_perf_focus?'<div style="font-size:12.5px;color:#9a5b00;margin-top:4px;"><b>Focus:</b> '+opmEsc(s.sl_perf_focus)+'</div>':''));
        }
        var items=d.agenda||[];
        var ah='<b style="font-size:13px;color:#1f2a44;">What we\'ll cover</b>';
        if(!items.length) ah+=opmEmpty('&#128203;','The agenda will appear here once your manager publishes it.');
        items.forEach(function(a){ ah+='<div style="padding:8px 0;border-top:1px solid #f2f2f6;"><b style="font-size:13px;color:#1f2a44;">'+opmEsc(a.title)+'</b>'+(a.details?'<div style="font-size:12.5px;color:#3a4352;">'+opmEsc(a.details)+'</div>':'')+(a.decision_note?'<div style="font-size:12px;color:#5b3aa6;">Decision: '+opmEsc(a.decision_note)+'</div>':'')+'</div>'; });
        h+=opmCard(ah);
        // submit question / topic
        var canAsk=['brief_published','in_progress'].indexOf(m.status)>=0;
        var qh='<b style="font-size:13px;color:#1f2a44;">Ask a question or suggest a topic</b>';
        if(canAsk){
            qh+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:7px;">'
              +'<select id="opmSlKind" style="padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;"><option value="question">Question</option><option value="topic">Suggested topic</option></select>'
              +'<input id="opmSlBody" placeholder="What\'s on your mind?" style="flex:1;min-width:180px;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:13px;">'
              +opmBtn('Send to my manager','opmSlSubmit()')+'</div>'
              +'<div style="font-size:11px;color:#8a93a3;margin-top:5px;">Only your manager sees this unless they approve it as a shared topic.</div>';
        } else qh+='<div style="font-size:12px;color:#6b7686;margin-top:5px;">Submissions open while the brief is out and close when the meeting wraps.</div>';
        var mine=(d.inputs||[]).filter(function(x){ return x.mine; });
        mine.forEach(function(x){ qh+='<div style="border-top:1px solid #f2f2f6;padding:7px 0;font-size:12.5px;color:#3a4352;">'+opmEsc(x.body)+' '+opmBadge(opmEsc(x.status),'#eef0f3','#5b6472')+(x.mgr_response?'<div style="font-size:12px;color:#5b3aa6;">Manager: '+opmEsc(x.mgr_response)+'</div>':'')+'</div>'; });
        h+=opmCard(qh);
        return h;
    }
    function opmAck(){ opmRpc('opm_brief_ack',{p_id:_opm.mid},function(){ opmReload(); }); }
    function opmSlSubmit(){ var b=opmVal('opmSlBody'); if(!b){ alert('Write your question or topic first.'); return; }
        opmRpc('opm_input_submit',{p_id:_opm.mid,p_kind:opmVal('opmSlKind')||'topic',p_body:b},function(){ alert('Sent to your manager.'); opmReload(); }); }

    /* ===== LIVE MEETING ===================================================== */
    var _opmAtt=null;
    function opmLiveHtml(){
        var d=_opm.data, m=d.meeting, s=d.sections||{}, h='';
        var live=['brief_published','in_progress'].indexOf(m.status)>=0;
        if(!live&&['completed','recap_sent'].indexOf(m.status)<0) h+=opmCard('<div style="font-size:12.5px;color:#9a5b00;">The live meeting tools unlock after the brief is published.</div>');
        // attendance
        _opmAtt=_opmAtt||JSON.parse(JSON.stringify(d.attendance||[]));
        var at='<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13.5px;color:#1f2a44;">&#9995; Attendance</b>'+(live?opmBtnGhost('&#10133; Add person','opmAttAdd()'):'')+'</div>';
        if(!_opmAtt.length) at+=opmEmpty('&#9995;','Expected attendees appear when the brief is published. Add people manually if needed.');
        _opmAtt.forEach(function(a,idx){
            var states=['present','late','absent','excused'];
            at+='<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid #f2f2f6;flex-wrap:wrap;"><span style="flex:1;font-size:13px;color:#1f2a44;">'+opmEsc(a.display_name)+(a.emp_role?' <span style="font-size:11px;color:#8a93a3;">('+opmEsc(a.emp_role)+')</span>':'')+'</span>';
            states.forEach(function(st){ var on=a.status===st; at+='<button '+(live?'onclick="opmAttSet('+idx+',\''+st+'\')"':'disabled')+' style="background:'+(on?(st==='present'?'#1b7a3d':st==='late'?'#9a5b00':'#a01b3e'):'#eef0f3')+';color:'+(on?'#fff':'#5b6472')+';border:none;border-radius:8px;padding:5px 9px;font-size:11px;font-weight:700;cursor:pointer;">'+st.charAt(0).toUpperCase()+st.slice(1)+'</button>'; });
            at+='</div>';
        });
        if(live) at+='<div style="margin-top:9px;">'+opmBtn('Save attendance','opmAttSave()','#1f7a3d')+'</div>';
        h+=opmCard(at);
        // agenda checklist with decisions
        var mg='<b style="font-size:13.5px;color:#1f2a44;">&#128203; Meeting guide &mdash; check topics off as you go</b>';
        var items=(d.agenda||[]).filter(function(a){ return a.status==='approved'; });
        if(!items.length) mg+=opmEmpty('&#128203;','No approved topics. Build the agenda first.');
        items.forEach(function(a){
            mg+='<div style="padding:8px 0;border-top:1px solid #f2f2f6;">'
              +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><label style="flex:1;font-size:13px;color:#1f2a44;cursor:pointer;"><input type="checkbox" '+(a.discussed?'checked':'')+' onchange="opmAgendaOp('+a.id+',\'discuss\')"> <b>'+opmEsc(a.title)+'</b></label>'+opmSensBadge(a.sensitivity)+'</div>'
              +(a.details?'<div style="font-size:12px;color:#5b6472;margin:3px 0 0 22px;">'+opmEsc(a.details)+'</div>':'')
              +'<div style="margin:5px 0 0 22px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'
              +'<input id="opmDec'+a.id+'" placeholder="Decision / outcome…" value="'+opmEsc(a.decision_note||'')+'" style="flex:1;min-width:160px;padding:7px;border:1px solid #ddd;border-radius:8px;font-size:12px;">'
              +opmBtnGhost('Save decision','opmDecision('+a.id+')')
              +opmBtnGhost('&#10133; Action item','opmSetTab(\'actions\')')
              +'</div></div>';
        });
        h+=opmCard(mg);
        // notes
        h+=opmCard('<b style="font-size:13.5px;color:#1f2a44;">Meeting notes</b>'
          +'<label style="display:block;font-size:11.5px;color:#6b7686;margin:7px 0 3px;">Shared summary <span style="color:#1b7a3d;font-weight:700;">(shift-leader visible in recap views)</span></label>'
          +'<textarea id="opm_sl_meeting_summary" rows="3" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;">'+opmEsc(s.sl_meeting_summary||'')+'</textarea>'
          +'<label style="display:block;font-size:11.5px;color:#9a5b00;margin:8px 0 3px;">Manager-only notes '+opmSensBadge('manager_only')+'</label>'
          +'<textarea id="opm_mgr_live_notes" rows="3" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;">'+opmEsc(s.mgr_live_notes||'')+'</textarea>'
          +'<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">'+opmBtn('Save notes','opmLiveNotesSave()')
          +(live?opmBtn('&#9989; Complete meeting','opmCompletePrompt()','#1f7a3d'):'')+'</div>');
        return h;
    }
    function opmAttSet(idx,st){ if(_opmAtt&&_opmAtt[idx]){ _opmAtt[idx].status=st; opmRender(); } }
    function opmAttAdd(){ var n=prompt('Name of the extra attendee:'); if(!n) return; _opmAtt.push({employee_id:null,display_name:n,emp_role:null,status:'present'}); opmRender(); }
    function opmAttSave(){
        var rows=(_opmAtt||[]).map(function(a){ return {employee_id:a.employee_id,name:a.display_name,role:a.emp_role,status:a.status}; });
        opmRpc('opm_attendance_mark',{p_id:_opm.mid,p_rows:rows},function(){ _opmAtt=null; opmReload(); });
    }
    function opmDecision(id){ var e=document.getElementById('opmDec'+id); opmRpc('opm_agenda_set',{p_item_id:id,p_op:'decision',p_payload:{note:(e?e.value:'')}},function(){ opmReload(); }); }
    function opmLiveNotesSave(){
        var f={}; ['sl_meeting_summary','mgr_live_notes'].forEach(function(k){ var e=document.getElementById('opm_'+k); if(e) f[k]=e.value; });
        opmRpc('opm_save_section',{p_id:_opm.mid,p_fields:f},function(){ opmReload(); });
    }
    function opmCompletePrompt(){
        if(!confirm('Complete this meeting? A recap draft is generated from shift-leader-safe content for you to edit before sending.')) return;
        opmRpc('opm_complete',{p_id:_opm.mid},function(){ _opm.tab='recap'; opmReload(); });
    }

    /* ===== ACTION ITEMS ===================================================== */
    function opmActionsHtml(){
        var d=_opm.data, mgr=d.me.can_manage, h='';
        var open=(d.actions||[]).filter(function(a){ return a.status==='open'; });
        var done=(d.actions||[]).filter(function(a){ return a.status!=='open'; });
        var ah='<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13.5px;color:#1f2a44;">&#9989; Action items'+(mgr?'':' assigned to you')+'</b>'+(mgr?opmBtnGhost('&#8635; Sync with task board','opmTaskSync()'):'')+'</div>';
        if(!open.length&&!done.length) ah+=opmEmpty('&#9989;','No action items yet.'+(mgr?' Create one below — it becomes a real task on the task board.':''));
        function row(a){
            var od=a.due_date&&a.status==='open'&&a.due_date<new Date().toISOString().slice(0,10);
            return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid #f2f2f6;flex-wrap:wrap;">'
              +'<span style="flex:1;font-size:13px;color:#1f2a44;'+(a.status==='done'?'text-decoration:line-through;color:#8a93a3;':'')+'"><b>'+opmEsc(a.title)+'</b>'
              +(a.owner_name?' <span style="font-size:11.5px;color:#5b6472;">&middot; '+opmEsc(a.owner_name)+'</span>':'')
              +(a.due_date?' <span style="font-size:11.5px;color:'+(od?'#a01b3e':'#5b6472')+';">&middot; due '+opmEsc(opmDate(a.due_date))+'</span>':'')+'</span>'
              +(a.task_id?opmBadge('Task #'+opmEsc(a.task_id),'#e3ecfa','#185FA5'):opmBadge('Meeting-only','#eef0f3','#5b6472'))
              +(od?opmBadge('Overdue','#fbe4ea','#a01b3e'):'')
              +(a.carried_from?opmBadge('Carried forward','#fdf0dd','#9a5b00'):'')
              +(a.status==='open'?opmBtn('Done','opmActionOp('+a.id+',\'done\')','#1f7a3d'):(mgr?opmBtnGhost('Reopen','opmActionOp('+a.id+',\'reopen\')'):''))
              +(mgr&&a.status==='open'?opmBtnGhost('Drop','opmActionOp('+a.id+',\'drop\')'):'')
              +'</div>';
        }
        open.forEach(function(a){ ah+=row(a); });
        done.forEach(function(a){ ah+=row(a); });
        h+=opmCard(ah);
        if(mgr){
            var leaders=_opm.leaders||[];
            var fh='<b style="font-size:13px;color:#1f2a44;">New action item</b>'
              +'<input id="opmActTitle" placeholder="What needs to happen?" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:13px;margin:6px 0;">'
              +'<textarea id="opmActDet" rows="2" placeholder="Details (optional)" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;"></textarea>'
              +'<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:7px;">'
              +'<select id="opmActOwner" style="padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;min-width:160px;"><option value="">Whole store (shared)</option>'
              +leaders.map(function(l){ return '<option value="'+l.employee_id+'|'+opmEsc(l.name)+'">'+opmEsc(l.name)+'</option>'; }).join('')+'</select>'
              +'<input type="date" id="opmActDue" style="padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;">'
              +'<label style="font-size:12px;color:#5b6472;"><input type="checkbox" id="opmActTask" checked> Create a real task</label>'
              +opmBtn('Add action item','opmActionAdd()','#1f7a3d')+'</div>'
              +(leaders.length?'':'<div style="font-size:11px;color:#8a93a3;margin-top:5px;">'+opmBtnGhost('Load owner list','opmLeadersLoad()')+'</div>');
            h+=opmCard(fh);
            if((d.carry||[]).length){
                var ch='<b style="font-size:13px;color:#1f2a44;">&#128260; Follow-up from past meetings</b>';
                d.carry.forEach(function(x){ ch+='<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid #f2f2f6;flex-wrap:wrap;"><span style="flex:1;font-size:12.5px;color:#3a4352;">'+opmEsc(x.title)+' <span style="color:#8a93a3;">('+opmEsc(x.from_month)+(x.owner_name?' &middot; '+opmEsc(x.owner_name):'')+')</span></span>'+(x.overdue?opmBadge('Overdue','#fbe4ea','#a01b3e'):'')+opmBtn('Mark done','opmActionOp('+x.id+',\'done\')','#1f7a3d')+'</div>'; });
                h+=opmCard(ch);
            }
        }
        return h;
    }
    function opmLeadersLoad(){ opmRpc('opm_leaders',{p_store:_opm.data.meeting.location},function(l){ _opm.leaders=l||[]; opmRender(); }); }
    function opmActionAdd(){
        var t=opmVal('opmActTitle'); if(!t){ alert('Describe the action first.'); return; }
        var own=opmVal('opmActOwner'), emp=null, oname=null;
        if(own){ var p=own.split('|'); emp=parseInt(p[0],10)||null; oname=p[1]||null; }
        var mk=document.getElementById('opmActTask');
        opmRpc('opm_action_add',{p_id:_opm.mid,p_title:t,p_details:opmVal('opmActDet')||null,p_owner_emp:emp,p_owner_name:oname,p_due:opmVal('opmActDue')||null,p_agenda_id:null,p_make_task:!!(mk&&mk.checked)},function(r){
            if(r&&!r.task_id&&mk&&mk.checked) alert('Saved as a meeting action item. (The task board could not be reached, so no task was created.)');
            opmReload();
        });
    }
    function opmActionOp(id,op){ opmRpc('opm_action_set',{p_action_id:id,p_op:op},function(){ opmReload(); }); }
    function opmTaskSync(){ opmRpc('opm_task_sync',{p_id:_opm.mid},function(r){ if(r&&r.closed) alert(r.closed+' action item'+(r.closed>1?'s':'')+' auto-closed from the task board.'); opmReload(); }); }

    /* ===== RECAP ============================================================ */
    function opmRecapHtml(){
        var d=_opm.data, m=d.meeting, mgr=d.me.can_manage, h='';
        if(!mgr){
            if(m.status==='recap_sent'&&m.recap_text) return opmCard('<b style="font-size:13.5px;color:#1f2a44;">Meeting recap</b><div style="white-space:pre-wrap;font-size:13px;color:#3a4352;margin-top:7px;">'+opmEsc(m.recap_text)+'</div>');
            return opmCard(opmEmpty('&#128232;','The recap will appear here after your manager sends it.'));
        }
        if(['completed','recap_sent'].indexOf(m.status)<0)
            return opmCard(opmEmpty('&#128232;','Complete the meeting first — a recap draft is then generated from shift-leader-safe content for you to edit.'));
        h+=opmCard('<b style="font-size:13.5px;color:#1f2a44;">Recap '+(m.status==='recap_sent'?'(sent)':'draft')+'</b>'
          +'<div style="font-size:11.5px;color:#6b7686;margin:5px 0;">Built only from approved shift-leader-visible topics, decisions, and action items. A privacy footer is added automatically on shift-leader views. Review before sending.</div>'
          +'<textarea id="opmRecapText" rows="12" '+(m.status==='recap_sent'?'readonly':'')+' style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;white-space:pre-wrap;">'+opmEsc(m.recap_text||'')+'</textarea>'
          +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:9px;">'
          +(m.status==='completed'?opmBtn('&#128232; Send recap to shift leaders & leadership','opmSendRecap()','#1f7a3d'):'')
          +(m.status==='completed'?opmBtnGhost('&#10024; Polish with AI','opmAiRecap()'):'')
          +'</div>');
        return h;
    }
    function opmSendRecap(){
        if(!confirm('Send the recap? Attending shift leaders and leadership get a generic notification pointing into the app (no content travels in the notification).')) return;
        opmRpc('opm_send_recap',{p_id:_opm.mid,p_recap:opmVal('opmRecapText')||null},function(){ alert('Recap sent.'); opmReload(); });
    }
    function opmAiRecap(){
        var ta=document.getElementById('opmRecapText'); if(!ta) return;
        var base=ta.value||'';
        if(typeof G_URL!=='undefined'&&G_URL){
            ta.value=base+'\n\n(Polishing with Cherry…)';
            var prompt='Rewrite this monthly store meeting recap so it is warm, clear, and easy for shift leaders to read. Keep every topic, decision, owner and due date. Do not add any employee-sensitive information. Recap:\n'+base;
            fetch(G_URL+'?action=ai&message='+encodeURIComponent(prompt)+'&history='+encodeURIComponent('[]')+'&userName='+encodeURIComponent((currentUser&&currentUser.name)||'Manager'))
              .then(function(r){ return r.json(); })
              .then(function(j){ ta.value=(j&&j.reply)?j.reply:base; })
              .catch(function(){ ta.value=base; alert('AI service not reachable — recap unchanged.'); });
        } else {
            // client-side fallback: prepend a friendly performance line from loaded data
            var p=(_opm.data&&_opm.data.perf)||{};
            var line='';
            if(p.sales!=null&&p.sales_ly>0){ var pc=Math.round(1000.0*(p.sales-p.sales_ly)/p.sales_ly)/10; line='Last month sales were '+opmMoney(p.sales)+' ('+(pc>=0?'+':'')+pc+'% vs last year).'; }
            ta.value=(line?line+'\n\n':'')+base;
            alert('AI assistant is not configured — added a performance summary line instead.');
        }
    }

    /* ===== FOLLOW-UP ======================================================== */
    function opmFollowupLoad(){
        opmRpc('opm_followup',{p_store:_opm.data.meeting.location},function(r){ _opm.followup=r||{items:[],signals:[]}; opmRender(); },function(){ _opm.followup={items:[],signals:[]}; opmRender(); });
    }
    function opmFollowupHtml(){
        var f=_opm.followup, h='';
        if(!f) return opmCard(opmEmpty('&#8987;','Loading follow-up history…'));
        var sig=f.signals||[];
        var sh='<b style="font-size:13.5px;color:#1f2a44;">&#128257; Repeated-topic review signals</b>';
        if(!sig.length) sh+=opmEmpty('&#128257;','No repeated topics detected across recent meetings. That\'s a good sign.');
        sig.forEach(function(x){ sh+='<div style="padding:7px 0;border-top:1px solid #f2f2f6;font-size:12.5px;color:#3a4352;"><b>'+opmEsc(x.topic)+'</b> — discussed in '+x.meetings+' of the last '+x.window+' meetings. Treat as a manager review signal.</div>'; });
        h+=opmCard(sh);
        var items=f.items||[];
        var ih='<b style="font-size:13.5px;color:#1f2a44;">&#128260; All open items across meetings</b>';
        if(!items.length) ih+=opmEmpty('&#9989;','Nothing open from past meetings. Fully caught up.');
        items.forEach(function(x){ ih+='<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid #f2f2f6;flex-wrap:wrap;"><span style="flex:1;font-size:12.5px;color:#3a4352;">'+opmEsc(x.title)+' <span style="color:#8a93a3;">('+opmEsc(x.from_month)+(x.owner_name?' &middot; '+opmEsc(x.owner_name):'')+')</span></span>'+(x.overdue?opmBadge('Overdue','#fbe4ea','#a01b3e'):'')+opmBtn('Done','opmFollowDone('+x.id+')','#1f7a3d')+'</div>'; });
        h+=opmCard(ih);
        return h;
    }
    function opmFollowDone(id){ opmRpc('opm_action_set',{p_action_id:id,p_op:'done'},function(){ _opm.followup=null; opmFollowupLoad(); }); }

    /* ===== LEADERSHIP DASHBOARD ============================================ */
    function opmDashOpen(){ _opm.view='dash'; opmLoading('Loading company dashboard…');
        opmRpc('opm_dashboard',{},function(r){ _opm.dash=r||{}; opmDashRender(); },function(e){ alert(e.message||'Managers only.'); opmHomeRender(); }); }
    function opmDashRender(){
        var r=_opm.dash||{}, byLoc={}; (r.stores||[]).forEach(function(x){ byLoc[x.location]=x; });
        var h=opmHeader('Ops Meetings — All Stores','openOpsMeeting()');
        h+='<div style="max-width:860px;margin:0 auto;padding:14px 16px 50px;">';
        h+='<p style="font-size:12.5px;color:#6b7686;margin-top:0;">'+opmEsc(opmMonthLbl(r.month))+' &middot; default meeting date '+opmEsc(opmDate(r.default_date))+'. Are meetings happening, is follow-up getting done, and which store needs help?</p>';
        opmStores().forEach(function(loc){
            var x=byLoc[loc];
            var emoji=(typeof hubStoreEmoji==='function'?hubStoreEmoji(loc):'&#128205;');
            var inner='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><b style="flex:1;font-size:14px;color:#1f2a44;">'+emoji+' '+opmEsc(loc)+'</b>'+(x?opmStatusChip(x.status):opmBadge('No meeting yet','#fbe4ea','#a01b3e'))+'</div>';
            if(x){
                inner+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:#3a4352;">'
                  +'<span>&#128197; '+opmEsc(opmDate(x.meeting_date))+'</span>'
                  +'<span>&#9995; Attendance: <b>'+(x.attendance_pct!=null?x.attendance_pct+'%':'—')+'</b></span>'
                  +'<span>&#9989; Open actions: <b>'+(x.open_actions||0)+'</b>'+(x.overdue_actions?' <span style="color:#a01b3e;font-weight:700;">('+x.overdue_actions+' overdue)</span>':'')+'</span>'
                  +'<span>&#128260; Carry-over: <b>'+(x.carry_open||0)+'</b></span>'
                  +(x.last_completed_month?'<span>Last completed: <b>'+opmEsc(x.last_completed_month)+'</b></span>':'')
                  +'</div><div style="margin-top:8px;">'+opmBtnGhost('Open','opmOpen('+x.meeting_id+')')+'</div>';
            } else {
                inner+='<div style="font-size:12px;color:#6b7686;margin-top:6px;">This store has not created its monthly meeting. Nudge the store manager.</div>';
            }
            h+=opmCard(inner);
        });
        h+='</div>';
        opmWrap(h);
    }

    /* ===== PRINT PACKET (shift-leader-safe content only) ==================== */
    function opmPrint(){
        var d=_opm.data; if(!d||!d.meeting) return;
        var m=d.meeting, s=d.sections||{}, p=d.perf||{};
        var items=(d.agenda||[]).filter(function(a){ return a.status==='approved'&&a.sensitivity==='normal'; });
        var acts=(d.actions||[]).filter(function(a){ return a.status!=='dropped'; });
        var w=window.open('','_blank'); if(!w){ alert('Allow pop-ups to print the packet.'); return; }
        var x='<html><head><title>Meeting packet</title><style>body{font-family:Arial,sans-serif;color:#222;max-width:680px;margin:24px auto;}h1{font-size:20px;}h2{font-size:15px;border-bottom:1px solid #ccc;padding-bottom:3px;}li{margin:4px 0;font-size:13px;}p{font-size:13px;}</style></head><body>';
        x+='<h1>Monthly Ops Meeting &mdash; '+opmEsc(m.location)+' ('+opmEsc(opmMonthLbl(m.meeting_month))+')</h1>';
        x+='<p>'+opmEsc(opmDate(m.meeting_date))+(m.meeting_time?' &middot; '+opmEsc(m.meeting_time):'')+' &middot; Led by '+opmEsc(m.owner_name||'')+'</p>';
        x+='<h2>Performance ('+opmEsc(opmMonthLbl(p.review_month))+')</h2><p>Sales: '+opmMoney(p.sales)+(p.sales_ly?' (LY '+opmMoney(p.sales_ly)+')':'')+(p.labor_pct!=null?' &middot; Labor '+p.labor_pct+'%':'')+(p.guests!=null?' &middot; Guests '+Number(p.guests).toLocaleString():'')+'</p>';
        ['sl_perf_sales','sl_perf_labor','sl_perf_wins','sl_perf_focus'].forEach(function(k){ if(s[k]) x+='<p>'+opmEsc(s[k])+'</p>'; });
        x+='<h2>Agenda</h2><ul>'+items.map(function(a){ return '<li><b>'+opmEsc(a.title)+'</b>'+(a.details?' &mdash; '+opmEsc(a.details):'')+'</li>'; }).join('')+'</ul>';
        if(acts.length) x+='<h2>Action items</h2><ul>'+acts.map(function(a){ return '<li>'+opmEsc(a.title)+(a.owner_name?' &mdash; '+opmEsc(a.owner_name):'')+(a.due_date?' (due '+opmEsc(opmDate(a.due_date))+')':'')+'</li>'; }).join('')+'</ul>';
        x+='<p style="color:#777;font-size:11px;">This packet contains shift-leader-visible content only. Manager-only and sensitive items are excluded.</p>';
        x+='</body></html>';
        w.document.write(x); w.document.close();
        setTimeout(function(){ try{ w.print(); }catch(e){} },300);
    }
