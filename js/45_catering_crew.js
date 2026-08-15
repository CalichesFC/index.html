    // ============================================================
    // CATERING CREW SCHEDULE + APPROVAL  (js/45_catering_crew.js)
    // Entry: openCateringCrew()   Overlay id: csModal
    //
    // Draft the crew for each upcoming booking (staff + role), then a manager
    // (any Store Manager — delegable, not locked to one person) APPROVES it.
    // Nothing counts as scheduled until it's approved. Reads app_quote_admin_list
    // + app_shift_list; writes via app_shift_set / app_shift_delete /
    // app_shift_approve. Additive layer over the working quotes engine.
    //
    // NOTE: this is the catering-crew approval layer. Feeding approved crew into
    // the Hub's main Schedule section is a follow-up to wire with your input.
    // ============================================================
    var _cs = { events:null, byQuote:null, loading:false, err:null, busy:false };
    var CS_DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], CS_MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    function csEsc(s){ return (typeof escapeHtml==='function')?escapeHtml(s==null?'':String(s)):String(s==null?'':s); }
    function csToday(){ var d=new Date(); return new Date(d.getFullYear(),d.getMonth(),d.getDate()); }
    function csParse(s){ var p=String(s).slice(0,10).split('-'); return new Date(+p[0],(+p[1]-1),+p[2]); }
    function csPretty(s){ var d=csParse(s); return CS_DOW[d.getDay()]+' '+CS_MON[d.getMonth()]+' '+d.getDate(); }

    function csOv(){ var o=document.getElementById('csModal'); if(!o){ o=document.createElement('div'); o.id='csModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(o);} o.style.display='block'; return o; }
    function csClose(){ var o=document.getElementById('csModal'); if(o)o.style.display='none'; }
    function openCateringCrew(){ if(typeof currentUser==='undefined'||!currentUser) return; csLoad(); }

    function csLoad(){
        _cs.loading=true; _cs.err=null; csRender();
        if(typeof withPin!=='function'||typeof supabaseClient==='undefined'||!currentUser){ _cs.loading=false; _cs.err='Please sign in first.'; csRender(); return; }
        withPin(function(pin){
            supabaseClient.rpc('app_quote_admin_list',{p_admin_username:currentUser.username,p_admin_password:pin}).then(function(r){
                if(r.error){ _cs.loading=false; _cs.err=(String(r.error.message||'').indexOf('forbidden')>=0)?'This screen is for managers. Ask an admin for access.':(r.error.message||'Could not load.'); csRender(); return; }
                var evs=(r.data||[]).filter(function(q){ return q&&q.event_date; });
                supabaseClient.rpc('app_shift_list',{p_admin_username:currentUser.username,p_admin_password:pin}).then(function(r2){
                    _cs.loading=false;
                    var m={}; if(!r2.error){ (r2.data||[]).forEach(function(s){ (m[s.quote_id]=m[s.quote_id]||[]).push(s); }); }
                    _cs.byQuote=m; _cs.events=evs; csRender();
                }).catch(function(){ _cs.loading=false; _cs.byQuote={}; _cs.events=evs; csRender(); });
            }).catch(function(){ _cs.loading=false; _cs.err='Connection error. Please try again.'; csRender(); });
        });
    }

    function csRpc(name,args,after){
        if(_cs.busy) return; _cs.busy=true; csRender();
        withPin(function(pin){
            supabaseClient.rpc(name,Object.assign({p_admin_username:currentUser.username,p_admin_password:pin},args)).then(function(r){
                _cs.busy=false;
                if(r.error){ alert(r.error.message||'Something went wrong.'); csRender(); return; }
                csLoad();  // reload fresh state
            }).catch(function(){ _cs.busy=false; alert('Connection error.'); csRender(); });
        });
    }
    function csAdd(qid){
        var name=window.prompt('Crew member name:'); if(!name||!name.trim()) return;
        var role=window.prompt('Role (Server, Driver, Lead… optional):')||'';
        csRpc('app_shift_set',{p_quote_id:qid,p_shift_id:null,p_staff_name:name,p_role:role});
    }
    function csDelete(sid){ csRpc('app_shift_delete',{p_shift_id:sid}); }
    function csApprove(qid,approve){ csRpc('app_shift_approve',{p_quote_id:qid,p_approve:!!approve}); }

    function csStatus(shifts){
        if(!shifts||!shifts.length) return {label:'No crew yet',color:'#9ca3af'};
        var anyDraft=false; for(var i=0;i<shifts.length;i++){ if(shifts[i].status!=='approved'){ anyDraft=true; break; } }
        return anyDraft ? {label:'Draft — needs approval',color:'#e67e22'} : {label:'Approved',color:'#28a745'};
    }
    function csHeader(){ return '<div style="background:linear-gradient(120deg,#EC3E7E,#106AB3);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">&#128101; Catering Crew Schedule</b><button onclick="csClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }

    function csEventCard(q){
        var shifts=(_cs.byQuote&&_cs.byQuote[q.id])||[];
        var st=csStatus(shifts);
        var h='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:13px 14px;margin-bottom:10px;">'
            +'<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">'
            +'<div style="min-width:0;"><div style="font-weight:800;color:#26242b;">'+csEsc(q.contact_name||('#'+q.order_num))+'</div>'
            +'<div style="font-size:12px;color:#6b7686;">'+csPretty(q.event_date)+(q.event_type?(' &middot; '+csEsc(q.event_type)):'')+' &middot; #'+csEsc(q.order_num)+'</div></div>'
            +'<span style="flex-shrink:0;background:'+st.color+';color:#fff;border-radius:999px;font-size:10.5px;font-weight:800;padding:3px 10px;">'+st.label+'</span></div>';
        // crew list
        h+='<div style="margin-top:10px;">';
        if(!shifts.length){ h+='<div style="color:#9aa7b4;font-size:12.5px;">No crew drafted yet.</div>'; }
        for(var i=0;i<shifts.length;i++){ var s=shifts[i];
            h+='<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f2f4f7;">'
              +'<div style="font-size:13px;color:#26242b;"><b>'+csEsc(s.staff_name)+'</b>'+(s.role?(' <span style="color:#6b7686;font-weight:600;">— '+csEsc(s.role)+'</span>'):'')+(s.status==='approved'?' <span style="color:#28a745;font-weight:800;font-size:11px;">&#10003; approved</span>':'')+'</div>'
              +'<button onclick="csDelete('+s.id+')" '+(_cs.busy?'disabled':'')+' style="border:none;background:#fbe9ee;color:#c0264b;border-radius:7px;padding:4px 9px;font-size:11px;font-weight:700;cursor:pointer;">Remove</button></div>';
        }
        h+='</div>';
        // actions
        h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:11px;">'
          +'<button onclick="csAdd('+q.id+')" '+(_cs.busy?'disabled':'')+' style="border:none;background:#106ab3;color:#fff;border-radius:9px;padding:8px 13px;font-size:12.5px;font-weight:800;cursor:pointer;">+ Add crew</button>';
        if(shifts.length){
            if(st.label.indexOf('Approved')===0){
                h+='<button onclick="csApprove('+q.id+',false)" '+(_cs.busy?'disabled':'')+' style="border:none;background:#eef0f3;color:#3a4353;border-radius:9px;padding:8px 13px;font-size:12.5px;font-weight:800;cursor:pointer;">Reopen (unapprove)</button>';
            } else {
                h+='<button onclick="csApprove('+q.id+',true)" '+(_cs.busy?'disabled':'')+' style="border:none;background:#28a745;color:#fff;border-radius:9px;padding:8px 13px;font-size:12.5px;font-weight:800;cursor:pointer;">&#10003; Approve &amp; publish</button>';
            }
        }
        h+='</div></div>';
        return h;
    }

    function csRender(){
        var o=csOv();
        if(_cs.loading){ o.innerHTML=csHeader()+'<p style="text-align:center;padding:40px;color:#6b7686;">Loading crew schedule&hellip;</p>'; return; }
        if(_cs.err){ o.innerHTML=csHeader()+'<p style="text-align:center;padding:40px;color:#c0264b;font-weight:600;">'+csEsc(_cs.err)+'</p>'; return; }
        var today=csToday();
        var up=(_cs.events||[]).filter(function(q){ return csParse(q.event_date)>=today; }).sort(function(a,b){ return csParse(a.event_date)-csParse(b.event_date); });
        var pending=up.filter(function(q){ var sh=(_cs.byQuote&&_cs.byQuote[q.id])||[]; return sh.length && csStatus(sh).label.indexOf('Draft')===0; });
        var h='<div style="max-width:820px;margin:0 auto;padding:14px 16px 44px;">';
        h+='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:11px 14px;margin-bottom:14px;font-size:12.5px;color:#3a4353;">'
          +'Draft the crew for each booking, then <b>Approve &amp; publish</b>. Nothing is scheduled until it\'s approved — and any Store Manager can approve it.'
          +(pending.length?(' <span style="color:#e67e22;font-weight:800;">'+pending.length+' awaiting approval.</span>'):'')+'</div>';
        for(var i=0;i<up.length;i++){ h+=csEventCard(up[i]); }
        if(!up.length) h+='<p style="color:#8a8594;font-size:13px;">No upcoming bookings to staff.</p>';
        h+='</div>';
        o.innerHTML=csHeader()+h;
    }

    window.openCateringCrew=openCateringCrew; window.csClose=csClose;
    window.csAdd=csAdd; window.csDelete=csDelete; window.csApprove=csApprove;
