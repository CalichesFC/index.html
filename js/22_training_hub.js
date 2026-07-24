    // ============================================================
    // TRAINING HUB — js/22_training_hub.js  (Wave 2)
    // Learning paths, station skills, practical sign-offs and
    // certifications on top of the existing LMS (app_lp_*).
    // White Apron = onboarding status (aspiring Blue Apron); the
    // path validates the same competencies then awards the Blue
    // Apron Certification after digital learning + knowledge checks
    // + OJT practice + practical sign-offs + final manager approval.
    // Entry point: openTrainingHub(). Overlay id: trainingHubModal.
    //
    // GET/SAVE SHAPES (server RPCs in training_hub.sql agree EXACTLY):
    //  trh_my         -> { employee_id, employee_name, enrollments:[enr], certs:[], ext_certs:[] }
    //    enr = { enrollment_id, path_id, path_version, title, icon, target_role,
    //            onboarding_status, cert_name, status, due_date, stages:[{id,title,
    //            description, reqs:[{id,kind,title,criteria,lp_course_id,position,
    //            cert_type,min_count,est_minutes,done,count,latest_status,latest_note,
    //            latest_by,latest_at,latest_id,pending}]}], total, done, pct, ready, next }
    //  trh_team       -> { pending:[], team:[enr - stages/next + name,role,store,pending_count], recent_certs:[] }
    //  trh_emp_detail -> { enrollment:enr, employee:{id,name} }
    //  trh_admin_get  -> { paths:[{...,stages:[{...,reqs:[]}]}], lp_paths:[], lp_courses:[],
    //                      positions:[], employees:[], config:[] }
    // Reuses existing LMS openers (lmsLoad/lmsOpenCourse/openLmsPreview)
    // for digital lessons — this module never redefines them.
    // ============================================================

    var _trh = { tab:'my', my:null, team:null, admin:null, store:'', detail:null, evidenceUrl:'', evidenceName:'', psMine:null, psTeam:null, qsMine:null, qsTeam:null };

    var TRH_KINDS = {
        digital_course:     ['💻','Digital lesson'],
        knowledge_check:    ['📝','Knowledge check'],
        ojt_practice:       ['🤝','On-the-job practice'],
        practical_signoff:  ['✅','Practical sign-off'],
        external_credential:['🪪','External credential'],
        manager_approval:   ['🏅','Final manager approval']
    };
    var TRH_STATUS_COLORS = { pass:'#1f7a3d', approved:'#1f7a3d', logged:'#185FA5', requested:'#9a5b00',
        partial:'#9a5b00', fail:'#c0264b', not_observed:'#5b6472', exception:'#7d1d4b', waived:'#5b3aa6',
        active:'#1f7a3d', expired:'#9a5b00', suspended:'#c0264b', revoked:'#c0264b' };

    function trhRpc(name,args,cb,onerr){
        withPin(function(pin){
            supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){
                if(r.error){ if(onerr) onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':trhErrMsg(r.error.message)); return; }
                cb(r.data);
            }).catch(function(){ if(onerr) onerr({message:'Connection error'}); else alert('Connection error.'); });
        });
    }
    function trhErrMsg(m){
        m=String(m||'');
        if(m.indexOf('note_required')>=0) return 'A note explaining the decision is required.';
        if(m.indexOf('reason_required')>=0) return 'A reason is required.';
        if(m.indexOf('not_ready')>=0) return 'Not all requirements are complete yet. Use the override (with a note) only if leadership approves an exception.';
        if(m.indexOf('already_requested')>=0) return 'A sign-off request is already pending for this item.';
        if(m.indexOf('complete_in_training_portal')>=0) return 'Digital lessons are completed in the Training Portal — tap Continue instead.';
        if(m.indexOf('title_required')>=0) return 'A title is required.';
        if(m.indexOf('already_approved')>=0) return 'That record is already approved.';
        if(m.indexOf('already_completed')>=0) return 'Already marked finished — a manager can approve it now.';
        return m;
    }
    function trhIsMgr(){ return !!(currentUser&&(currentUser.is_developer===true||(typeof isManagerRole==='function'&&isManagerRole()))); }
    function trhIsLead(){ return !!(currentUser&&/lead/i.test(currentUser.role||'')); }
    function trhCanTeam(){ return trhIsMgr()||trhIsLead(); }

    // ---------- overlay ----------
    function trhOv(){ var ov=document.getElementById('trainingHubModal'); if(!ov){ ov=document.createElement('div'); ov.id='trainingHubModal'; ov.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(ov); } ov.style.display='block'; return ov; }
    function trhClose(){ var ov=document.getElementById('trainingHubModal'); if(ov) ov.style.display='none'; trhM2Close(); }
    function trhHeader(){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><span style="font-size:20px;">🎓</span><b style="flex:1;font-size:16px;">Training Hub</b><button onclick="trhClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }
    function trhTabs(){
        var t=_trh.tab;
        function b(id,lbl){ return '<button onclick="trhSetTab(&quot;'+id+'&quot;)" style="flex:1;background:'+(t===id?'#185FA5':'#eef0f3')+';color:'+(t===id?'#fff':'#5b6472')+';border:none;padding:10px 6px;font-size:12.5px;font-weight:700;cursor:pointer;border-radius:9px;">'+lbl+'</button>'; }
        var h='<div style="display:flex;gap:6px;max-width:860px;margin:14px auto 0;padding:0 16px;">'+b('my','My Path');
        if(trhCanTeam()) h+=b('team','Team');
        if(trhIsMgr()) h+=b('certs','Certifications')+b('build','Path Builder');
        return h+'</div>';
    }
    function trhSetTab(t){ _trh.tab=t; _trh.detail=null;
        if(t==='my'&&!_trh.my){ trhLoadMy(); return; }
        if((t==='team'||t==='certs')&&!_trh.team){ trhLoadTeam(); return; }
        if(t==='build'&&!_trh.admin){ trhLoadAdmin(); return; }
        trhRender();
    }
    function trhLoading(msg){ trhOv().innerHTML=trhHeader()+'<div style="max-width:860px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">'+msg+'</div>'; }
    function trhFail(msg){ trhOv().innerHTML=trhHeader()+trhTabs()+'<div style="max-width:860px;margin:0 auto;padding:30px 16px;color:#c0264b;text-align:center;">'+escapeHtml(msg||'Could not load.')+'</div>'; }

    function openTrainingHub(){ _trh.tab='my'; _trh.my=null; _trh.team=null; _trh.admin=null; _trh.detail=null; _trh.psMine=null; _trh.psTeam=null; _trh.qsMine=null; _trh.qsTeam=null; trhLoadMy(); }
    function trhLoadMy(){ trhLoading('Loading your training&hellip;'); trhRpc('trh_my',{},function(d){ _trh.my=d||{}; trhRender(); trhLoadMyExtras(); },function(e){ trhFail(e.message); }); }
    function trhLoadMyExtras(){
        trhRpc('trh_prestart_my',{},function(d){ _trh.psMine=d||{rows:[]}; if(_trh.tab==='my'&&!_trh.detail) trhRender(); },function(e){ if(!_trh.psMine) _trh.psMine={rows:[],_err:(e&&e.message)||'Could not load.'}; if(_trh.tab==='my'&&!_trh.detail) trhRender(); });
        trhRpc('trh_qs_my',{},function(d){ _trh.qsMine=d||{rows:[]}; if(_trh.tab==='my'&&!_trh.detail) trhRender(); },function(e){ if(!_trh.qsMine) _trh.qsMine={rows:[],_err:(e&&e.message)||'Could not load.'}; if(_trh.tab==='my'&&!_trh.detail) trhRender(); });
    }
    function trhLoadTeam(){ trhLoading('Loading team&hellip;'); trhRpc('trh_team',{p_store:_trh.store||''},function(d){ _trh.team=d||{}; trhRender(); trhLoadTeamExtras(); },function(e){ trhFail(String(e.message||'').indexOf('forbidden')>=0?'Managers and leads only.':e.message); }); }
    function trhLoadTeamExtras(){
        if(!trhIsMgr()) return;
        trhRpc('trh_prestart_team',{},function(d){ _trh.psTeam=d||{rows:[]}; if((_trh.tab==='team'||_trh.tab==='certs')&&!_trh.detail) trhRender(); },function(e){ if(!_trh.psTeam) _trh.psTeam={rows:[],_err:(e&&e.message)||'Could not load.'}; if((_trh.tab==='team'||_trh.tab==='certs')&&!_trh.detail) trhRender(); });
        trhRpc('trh_qs_team',{p_store:_trh.store||''},function(d){ _trh.qsTeam=d||{scoops:[],open:[]}; if((_trh.tab==='team'||_trh.tab==='certs')&&!_trh.detail) trhRender(); },function(e){ if(!_trh.qsTeam) _trh.qsTeam={scoops:[],open:[],_err:(e&&e.message)||'Could not load.'}; if((_trh.tab==='team'||_trh.tab==='certs')&&!_trh.detail) trhRender(); });
    }
    function trhLoadAdmin(){ trhLoading('Loading path builder&hellip;'); trhRpc('trh_admin_get',{},function(d){ _trh.admin=d||{}; trhRender(); },function(e){ trhFail(String(e.message||'').indexOf('forbidden')>=0?'Managers only.':e.message); }); }
    function trhRender(){
        var body;
        if(_trh.detail) body=trhDetailHtml();
        else if(_trh.tab==='team') body=trhTeamHtml();
        else if(_trh.tab==='certs') body=trhCertsHtml();
        else if(_trh.tab==='build') body=trhBuildHtml();
        else body=trhMyHtml();
        trhOv().innerHTML=trhHeader()+trhTabs()+'<div style="max-width:860px;margin:0 auto;padding:14px 16px 50px;">'+body+'</div>';
    }
    function trhCard(inner,title){ return '<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:14px 15px;margin-bottom:11px;box-shadow:0 2px 8px rgba(0,0,0,.04);">'+(title?'<div style="font-size:11.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#8a91a0;margin-bottom:8px;">'+title+'</div>':'')+inner+'</div>'; }
    function trhEmpty(msg){ return '<div style="background:#fff;border:1px dashed #d8dce4;border-radius:12px;padding:20px;text-align:center;color:#6b7686;font-size:13px;">'+msg+'</div>'; }
    function trhChip(txt,color){ return '<span style="background:'+(color||'#5b6472')+'18;color:'+(color||'#5b6472')+';padding:2px 9px;border-radius:99px;font-size:11px;font-weight:700;">'+txt+'</span>'; }
    function trhBar(pct,color){ return '<div style="background:#eef0f5;border-radius:99px;height:8px;overflow:hidden;"><div style="height:100%;width:'+(pct||0)+'%;background:'+(color||'#1f7a3d')+';transition:width .3s;"></div></div>'; }
    function trhDate(s){ if(!s) return ''; try{ return new Date(s).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }catch(e){ return String(s).slice(0,10); } }

    // ---------- modal2 (small centered dialog) ----------
    function trhM2(html){ var m=document.getElementById('trhModal2'); if(!m){ m=document.createElement('div'); m.id='trhModal2'; m.style.cssText='position:fixed;inset:0;background:rgba(20,22,30,.45);z-index:100060;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:16px;'; document.body.appendChild(m); } m.style.display='flex'; m.innerHTML='<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;margin-top:36px;padding:18px;box-shadow:0 16px 50px rgba(0,0,0,.3);">'+html+'</div>'; }
    function trhM2Close(){ var m=document.getElementById('trhModal2'); if(m) m.style.display='none'; }
    function trhVal(id){ var el=document.getElementById(id); return el?String(el.value||'').trim():''; }
    function trhInp(id,label,val,ph,type){ return '<div style="margin-top:8px;"><label style="font-size:11.5px;font-weight:700;color:#5b6472;">'+label+'</label><input id="'+id+'" type="'+(type||'text')+'" value="'+escapeHtml(val==null?'':String(val))+'" placeholder="'+escapeHtml(ph||'')+'" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #d8dce4;border-radius:9px;font-size:13.5px;margin-top:3px;"></div>'; }
    function trhTxt(id,label,val,ph){ return '<div style="margin-top:8px;"><label style="font-size:11.5px;font-weight:700;color:#5b6472;">'+label+'</label><textarea id="'+id+'" placeholder="'+escapeHtml(ph||'')+'" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #d8dce4;border-radius:9px;font-size:13.5px;margin-top:3px;min-height:64px;">'+escapeHtml(val==null?'':String(val))+'</textarea></div>'; }
    function trhSel(id,label,opts,val){ var h='<div style="margin-top:8px;"><label style="font-size:11.5px;font-weight:700;color:#5b6472;">'+label+'</label><select id="'+id+'" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #d8dce4;border-radius:9px;font-size:13.5px;margin-top:3px;background:#fff;">'; (opts||[]).forEach(function(o){ h+='<option value="'+escapeHtml(String(o[0]))+'"'+(String(o[0])===String(val==null?'':val)?' selected':'')+'>'+escapeHtml(o[1])+'</option>'; }); return h+'</select></div>'; }
    function trhBtnRow(saveLabel,saveOnclick){ return '<div style="display:flex;gap:8px;margin-top:14px;"><button onclick="trhM2Close()" style="flex:1;background:#eef0f3;color:#5b6472;border:none;border-radius:10px;padding:11px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="'+saveOnclick+'" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">'+saveLabel+'</button></div>'; }

    // ============================================================
    // MY PATH (employee view)
    // ============================================================
    function trhMyHtml(){
        var d=_trh.my||{}; var enr=d.enrollments||[]; var certs=d.certs||[]; var ext=d.ext_certs||[];
        var h='';
        if(!d.employee_id){
            h+=trhEmpty('Your login isn’t linked to a roster profile yet, so no learning path can be assigned. Ask a manager to link your account on the Employee Roster.');
            return h;
        }
        h+=trhPsMineHtml();
        var active=enr.filter(function(e){ return e.status==='active'; });
        var done=enr.filter(function(e){ return e.status==='completed'; });
        if(!active.length&&!done.length){
            h+=trhEmpty('No learning path assigned yet. Your manager assigns paths from the Training Hub'+(trhIsMgr()?' — open the <b>Path Builder</b> tab to assign one.':'.'));
        }
        active.forEach(function(e){ h+=trhEnrCard(e,false); });
        h+=trhQsMineHtml();
        // certifications
        var ch='';
        certs.forEach(function(c){
            var col=TRH_STATUS_COLORS[c.status]||'#5b6472';
            ch+='<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f1f2f6;">'+
                '<span style="font-size:20px;">🏅</span><div style="flex:1;"><b style="font-size:13.5px;color:#26242b;">'+escapeHtml(c.cert_name||'')+'</b>'+
                '<div style="font-size:11.5px;color:#8a91a0;">Issued '+trhDate(c.issued_at)+(c.issued_by?' by '+escapeHtml(c.issued_by):'')+(c.expires_date?' &middot; expires '+trhDate(c.expires_date):'')+'</div></div>'+
                trhChip(escapeHtml(c.status||''),col)+'</div>';
        });
        ext.forEach(function(c){
            var expired=c.expires&&String(c.expires)<new Date().toISOString().slice(0,10);
            ch+='<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f1f2f6;">'+
                '<span style="font-size:20px;">🪪</span><div style="flex:1;"><b style="font-size:13.5px;color:#26242b;">'+escapeHtml(c.type||'')+'</b>'+
                '<div style="font-size:11.5px;color:#8a91a0;">'+(c.number?'#'+escapeHtml(c.number)+' &middot; ':'')+(c.expires?'expires '+trhDate(c.expires):'no expiration')+'</div></div>'+
                trhChip(expired?'expired':'on file',expired?'#c0264b':'#1f7a3d')+'</div>';
        });
        h+=trhCard(ch||'<div style="color:#6b7686;font-size:12.5px;">No certifications yet — finish your learning path to earn your first one.</div>','My certifications &amp; credentials');
        if(done.length){
            var dh=''; done.forEach(function(e){ dh+='<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f1f2f6;font-size:13px;color:#26242b;"><span>'+escapeHtml(e.icon||'🎓')+'</span><b style="flex:1;">'+escapeHtml(e.title||'')+'</b><span style="font-size:11.5px;color:#8a91a0;">completed '+trhDate(e.completed_at)+'</span></div>'; });
            h+=trhCard(dh,'Completed paths');
        }
        return h;
    }
    function trhEnrCard(e,mgrMode){
        var statusLabel=(e.status==='active'&&e.onboarding_status)?e.onboarding_status:e.status;
        var h='<div style="display:flex;align-items:center;gap:9px;"><span style="font-size:24px;">'+escapeHtml(e.icon||'🎓')+'</span>'+
            '<div style="flex:1;"><b style="font-size:15px;color:#26242b;">'+escapeHtml(e.title||'')+'</b>'+
            '<div style="font-size:11.5px;color:#8a91a0;">'+(e.cert_name?'Leads to: <b style="color:#1f7a3d;">'+escapeHtml(e.cert_name)+'</b>':'')+(e.due_date?' &middot; due '+trhDate(e.due_date):'')+'</div></div>'+
            trhChip(escapeHtml(statusLabel||''),e.status==='active'?'#185FA5':'#1f7a3d')+'</div>'+
            '<div style="margin:10px 0 4px;">'+trhBar(e.pct)+'</div>'+
            '<div style="font-size:11.5px;color:#6b7686;">'+(e.done||0)+' of '+(e.total||0)+' requirements complete ('+(e.pct||0)+'%)'+(e.ready?' &middot; <b style="color:#1f7a3d;">ready for final review!</b>':'')+'</div>';
        // next action
        if(!mgrMode&&e.status==='active'&&e.next){
            var n=e.next; var km=TRH_KINDS[n.kind]||['➡️',n.kind];
            h+='<div style="background:#f2f7f3;border:1px solid #d9eadf;border-radius:11px;padding:10px 12px;margin-top:10px;display:flex;align-items:center;gap:9px;">'+
               '<span style="font-size:18px;">'+km[0]+'</span><div style="flex:1;"><div style="font-size:10.5px;font-weight:800;color:#1f7a3d;text-transform:uppercase;letter-spacing:.4px;">Next up &middot; '+km[1]+'</div>'+
               '<b style="font-size:13.5px;color:#26242b;">'+escapeHtml(n.title||'')+'</b>'+(n.est_minutes?'<span style="font-size:11px;color:#8a91a0;"> &middot; ~'+n.est_minutes+' min</span>':'')+'</div>'+
               trhNextBtn(e,n)+'</div>';
        }
        h+='<div style="margin-top:10px;">'+(e.stages||[]).map(function(s){ return trhStageHtml(e,s,mgrMode); }).join('')+'</div>';
        return trhCard(h);
    }
    function trhNextBtn(e,n){
        if(n.kind==='digital_course'||n.kind==='knowledge_check'){
            if(n.lp_course_id) return '<button onclick="trhContinue('+n.lp_course_id+')" style="background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:800;cursor:pointer;">Continue &rsaquo;</button>';
            return '<button onclick="openLmsPreview()" style="background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:800;cursor:pointer;">Training Portal &rsaquo;</button>';
        }
        if(n.kind==='external_credential') return '<button onclick="alert(\'Bring your '+escapeHtml((n.cert_type||'credential').replace(/'/g,''))+' to a manager so they can add it to your profile.\')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:700;cursor:pointer;">How?</button>';
        if(n.pending) return '<span style="font-size:11.5px;color:#9a5b00;font-weight:700;">Requested — waiting on a leader</span>';
        return '<button onclick="trhRequestSignoff('+e.enrollment_id+','+n.id+')" style="background:#185FA5;color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:800;cursor:pointer;">Request sign-off</button>';
    }
    function trhStageHtml(e,s,mgrMode){
        var reqs=s.reqs||[];
        var sdone=reqs.filter(function(r){ return r.done; }).length;
        var h='<div style="border:1px solid #ececf2;border-radius:11px;margin-bottom:8px;overflow:hidden;">'+
            '<div style="background:#f7f8fb;padding:9px 12px;display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13px;color:#33303a;">'+escapeHtml(s.title||'')+'</b><span style="font-size:11.5px;color:'+(sdone>=reqs.length&&reqs.length?'#1f7a3d':'#8a91a0')+';font-weight:700;">'+sdone+'/'+reqs.length+'</span></div>';
        if(!reqs.length) h+='<div style="padding:10px 12px;font-size:12px;color:#8a91a0;">No requirements in this stage yet.</div>';
        reqs.forEach(function(r){
            var km=TRH_KINDS[r.kind]||['•',r.kind];
            var stat;
            if(r.done) stat=trhChip('done','#1f7a3d');
            else if(r.pending) stat=trhChip('requested','#9a5b00');
            else if(r.latest_status&&r.latest_status!=='requested') stat=trhChip(escapeHtml(String(r.latest_status).replace(/_/g,' ')),TRH_STATUS_COLORS[r.latest_status]||'#5b6472');
            else stat=trhChip('to do','#5b6472');
            h+='<div style="padding:9px 12px;border-top:1px solid #f1f2f6;">'+
               '<div style="display:flex;align-items:center;gap:8px;"><span title="'+km[1]+'">'+km[0]+'</span>'+
               '<div style="flex:1;"><span style="font-size:13px;color:#26242b;font-weight:600;">'+escapeHtml(r.title||'')+'</span>'+
               '<div style="font-size:11px;color:#8a91a0;">'+km[1]+(r.position?' &middot; '+escapeHtml(r.position):'')+(r.min_count>1?' &middot; '+(r.count||0)+'/'+r.min_count+' recorded':'')+(r.est_minutes?' &middot; ~'+r.est_minutes+' min':'')+'</div></div>'+stat;
            if(mgrMode) h+='<button onclick="trhRecordModal('+e.enrollment_id+','+r.id+')" style="margin-left:6px;background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Record</button>';
            else if(!r.done&&!r.pending&&(r.kind==='ojt_practice'||r.kind==='practical_signoff'||r.kind==='manager_approval')) h+='<button onclick="trhRequestSignoff('+e.enrollment_id+','+r.id+')" style="margin-left:6px;background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Request</button>';
            else if(!r.done&&!r.pending&&(r.kind==='digital_course'||r.kind==='knowledge_check')&&r.lp_course_id) h+='<button onclick="trhContinue('+r.lp_course_id+')" style="margin-left:6px;background:#e8f5ec;color:#1f7a3d;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Open</button>';
            h+='</div>';
            if(r.latest_note&&(mgrMode||r.latest_status!=='requested')) h+='<div style="font-size:11.5px;color:#6b7686;background:#f7f8fb;border-radius:8px;padding:6px 9px;margin-top:6px;">'+(r.latest_by?'<b>'+escapeHtml(r.latest_by)+':</b> ':'')+escapeHtml(r.latest_note)+'</div>';
            h+='</div>';
        });
        return h+'</div>';
    }
    function trhContinue(courseId){
        if(typeof lmsLoad==='function'&&typeof lmsOpenCourse==='function'){ lmsLoad(function(){ lmsOpenCourse(courseId); }); }
        else if(typeof openLmsPreview==='function'){ openLmsPreview(); }
        else alert('Open My Training — Learning Paths to take this lesson.');
    }
    function trhRequestSignoff(enrId,reqId){
        var note=prompt('Anything the observing leader should know? (optional)','');
        if(note===null) return;
        trhRpc('trh_request_signoff',{p_enrollment_id:enrId,p_requirement_id:reqId,p_note:note||null},function(){
            alert('Request sent — a leader will observe and sign you off.');
            _trh.my=null; trhLoadMy();
        });
    }

    // ============================================================
    // TEAM (manager/lead view)
    // ============================================================
    function trhTeamHtml(){
        var d=_trh.team||{}; var pending=d.pending||[]; var team=d.team||[];
        var stores=[''].concat(typeof HUB_STORES!=='undefined'?HUB_STORES:[]).concat(['Warehouse']);
        var h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;"><span style="font-size:12px;color:#6b6275;">Store</span>'+
            '<select onchange="_trh.store=this.value;_trh.team=null;trhLoadTeam();" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:9px;font-size:13px;background:#fff;">'+
            stores.map(function(s){ return '<option value="'+escapeHtml(s)+'"'+(_trh.store===s?' selected':'')+'>'+(s||'All stores')+'</option>'; }).join('')+'</select></div>';
        // pending sign-off requests
        var ph='';
        pending.forEach(function(p){
            var km=TRH_KINDS[p.kind]||['•',p.kind];
            ph+='<div style="display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:1px solid #f1f2f6;">'+
                '<span style="font-size:18px;">'+km[0]+'</span><div style="flex:1;"><b style="font-size:13.5px;color:#26242b;">'+escapeHtml(p.employee||'')+'</b> <span style="font-size:12px;color:#5b6472;">&middot; '+escapeHtml(p.req_title||'')+'</span>'+
                '<div style="font-size:11px;color:#8a91a0;">'+escapeHtml(p.path_title||'')+' &middot; asked '+trhDate(p.requested_at)+(p.note?' &middot; “'+escapeHtml(p.note)+'”':'')+'</div></div>'+
                '<button onclick="trhRecordModal('+p.enrollment_id+','+p.requirement_id+')" style="background:#185FA5;color:#fff;border:none;border-radius:9px;padding:8px 12px;font-size:12px;font-weight:800;cursor:pointer;">Record result</button></div>';
        });
        h+=trhCard(ph||'<div style="color:#6b7686;font-size:12.5px;">No pending sign-off requests. 🎉</div>','Pending sign-off requests ('+pending.length+')');
        // roster progress
        var th='';
        var ready=team.filter(function(t){ return t.ready; });
        if(ready.length){
            th+='<div style="background:#e8f5ec;border:1px solid #cfe9d8;border-radius:11px;padding:9px 12px;margin-bottom:10px;font-size:12.5px;color:#1b7a3d;font-weight:700;">🏅 '+ready.length+' team member'+(ready.length>1?'s are':' is')+' ready for final certification review</div>';
        }
        team.forEach(function(t){
            th+='<div onclick="trhOpenEmp('+t.enrollment_id+')" style="border:1px solid #ececf2;border-radius:12px;padding:11px 13px;margin-bottom:8px;cursor:pointer;">'+
                '<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(t.name||'')+'</b>'+
                '<span style="font-size:11px;color:#8a91a0;">'+escapeHtml(t.role||'')+(t.store?' &middot; '+escapeHtml(t.store):'')+'</span>'+
                (t.ready?trhChip('ready 🏅','#1f7a3d'):(t.pending_count?trhChip(t.pending_count+' waiting','#9a5b00'):''))+'</div>'+
                '<div style="font-size:11.5px;color:#6b7686;margin:6px 0 4px;">'+escapeHtml(t.title||'')+(t.onboarding_status?' &middot; '+escapeHtml(t.onboarding_status):'')+(t.due_date?' &middot; due '+trhDate(t.due_date):'')+'</div>'+
                trhBar(t.pct)+'<div style="font-size:11px;color:#8a91a0;margin-top:4px;">'+(t.done||0)+'/'+(t.total||0)+' ('+(t.pct||0)+'%)</div></div>';
        });
        h+=trhCard(th||'<div style="color:#6b7686;font-size:12.5px;">No active learning-path enrollments'+(_trh.store?' at this store':'')+'. Assign one from the Path Builder tab.</div>','Active trainees ('+team.length+')');
        if(trhIsMgr()){ h+=trhPsTeamHtml(); h+=trhQsTeamHtml(); }
        return h;
    }
    function trhOpenEmp(enrId){
        trhLoading('Loading trainee&hellip;');
        trhRpc('trh_emp_detail',{p_enrollment_id:enrId},function(d){ _trh.detail=d; trhRender(); },function(e){ trhFail(e.message); });
    }
    function trhDetailHtml(){
        var d=_trh.detail||{}; var e=d.enrollment||{}; var emp=d.employee||{};
        var h='<button onclick="_trh.detail=null;trhRender();" style="background:#eef0f3;border:none;border-radius:9px;padding:8px 13px;font-size:12.5px;font-weight:700;color:#5b6472;cursor:pointer;margin-bottom:10px;">&#8249; Back</button>';
        h+='<div style="display:flex;align-items:center;gap:9px;margin-bottom:10px;"><b style="font-size:17px;color:#26242b;">'+escapeHtml(emp.name||'')+'</b>'+(e.ready?trhChip('ready for final review 🏅','#1f7a3d'):'')+'</div>';
        h+=trhEnrCard(e,trhCanTeam());
        if(trhIsMgr()&&e.status==='active'){
            h+=trhCard('<div style="font-size:12.5px;color:#6b7686;margin-bottom:9px;">Awarding the certification records it on the Development Passport'+(e.cert_name?' as <b>'+escapeHtml(e.cert_name)+'</b>':'')+', grants position clearance for passed sign-off stations, and completes this path.'+(e.ready?'':' <b style="color:#9a5b00;">Requirements are not all complete — award requires a documented override.</b>')+'</div>'+
                '<button onclick="trhAwardModal('+e.enrollment_id+')" style="background:'+(e.ready?'#1f7a3d':'#9a5b00')+';color:#fff;border:none;border-radius:10px;padding:11px 16px;font-size:13.5px;font-weight:800;cursor:pointer;">🏅 Award '+escapeHtml(e.cert_name||'certification')+'</button>','Final certification');
        }
        return h;
    }

    // ---------- record a result (sign-off / OJT log / approval) ----------
    var _trhRec={enr:null,req:null,meta:null};
    function trhFindReq(reqId){
        var pools=[];
        if(_trh.detail&&_trh.detail.enrollment) pools.push(_trh.detail.enrollment);
        (_trh.my&&_trh.my.enrollments||[]).forEach(function(e){ pools.push(e); });
        for(var i=0;i<pools.length;i++){ var st=pools[i].stages||[]; for(var j=0;j<st.length;j++){ var rr=(st[j].reqs||[]); for(var k=0;k<rr.length;k++){ if(rr[k].id===reqId) return rr[k]; } } }
        var pend=(_trh.team&&_trh.team.pending||[]).filter(function(p){ return p.requirement_id===reqId; })[0];
        if(pend) return {id:reqId,kind:pend.kind,title:pend.req_title,criteria:pend.criteria,min_count:pend.min_count};
        return null;
    }
    function trhRecordModal(enrId,reqId){
        var r=trhFindReq(reqId)||{id:reqId,kind:'practical_signoff',title:'Requirement',criteria:[]};
        var empId=null,empName='';
        if(_trh.detail&&_trh.detail.enrollment&&_trh.detail.enrollment.enrollment_id===enrId){ empId=_trh.detail.enrollment.employee_id; empName=(_trh.detail.employee&&_trh.detail.employee.name)||''; }
        else{ ((_trh.team&&_trh.team.pending)||[]).some(function(p){ if(p.enrollment_id===enrId){ empId=p.employee_id; empName=p.employee||''; return true; } return false; }); }
        _trhRec={enr:enrId,req:reqId,meta:r,empId:empId,empName:empName}; _trh.evidenceUrl=''; _trh.evidenceName='';
        var km=TRH_KINDS[r.kind]||['•',r.kind];
        var opts;
        if(r.kind==='ojt_practice') opts=[['logged','Practice session logged'],['pass','Pass — practice complete'],['partial','Partial — needs more practice'],['not_observed','Not observed'],['exception','Exception (explain)']];
        else if(r.kind==='manager_approval') opts=[['approved','Approve'],['partial','Not yet — needs work (explain)'],['exception','Exception (explain)']];
        else opts=[['pass','Pass'],['partial','Partial — needs practice'],['fail','Fail / unsafe (explain)'],['not_observed','Not observed'],['exception','Exception (explain)'],['waived','Waive — equivalent prior credit (managers, explain)']];
        var crit=r.criteria||[]; var ch='';
        if(crit.length){
            ch='<div style="margin-top:10px;"><label style="font-size:11.5px;font-weight:700;color:#5b6472;">Observable criteria</label>';
            crit.forEach(function(c,i){ ch+='<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#33303a;padding:5px 0;"><input type="checkbox" id="trhCr_'+i+'" checked> '+escapeHtml(String(c))+'</label>'; });
            ch+='</div>';
        }
        trhM2('<b style="font-size:15px;color:#1f2a44;">'+km[0]+' Record: '+escapeHtml(r.title||'')+'</b>'+
            '<div style="font-size:11.5px;color:#8a91a0;margin-top:2px;">'+km[1]+(r.min_count>1?' &middot; needs '+r.min_count+' recorded':'')+' &middot; every attempt is saved, nothing is overwritten</div>'+
            trhSel('trhRecStatus','Result',opts,opts[0][0])+ch+
            trhTxt('trhRecNote','Notes / remediation guidance','','Required for partial, fail, exception or waive — the employee sees this as coaching guidance.')+
            '<div style="margin-top:8px;"><button onclick="trhUploadEvidence()" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;">📷 Attach photo evidence</button> <span id="trhEvName" style="font-size:11.5px;color:#6b7686;"></span></div>'+
            trhBtnRow('Save result','trhRecordSubmit()'));
    }
    function trhRecordSubmit(){
        var r=_trhRec.meta||{}; var crit=r.criteria||[];
        var results=[]; crit.forEach(function(c,i){ var el=document.getElementById('trhCr_'+i); results.push({criterion:String(c),met:!!(el&&el.checked)}); });
        var st=trhVal('trhRecStatus'); var note=trhVal('trhRecNote');
        if(['partial','fail','exception','waived','not_observed'].indexOf(st)>=0&&!note){ alert('Please add a note explaining this result — it becomes the employee’s remediation guidance.'); return; }
        trhRpc('trh_record',{p_enrollment_id:_trhRec.enr,p_requirement_id:_trhRec.req,p_status:st,p_note:note||null,p_evidence_url:_trh.evidenceUrl||null,p_criteria_results:results.length?results:null},function(){
            trhM2Close();
            _trh.team=null; _trh.my=null;
            if(_trh.detail){ trhOpenEmp(_trhRec.enr); } else if(_trh.tab==='team'){ trhLoadTeam(); } else { trhLoadMy(); }
            if(st==='fail'&&r.kind==='practical_signoff'&&trhIsMgr()&&_trhRec.empId){ trhQsOfferFromFail(_trhRec.empId,_trhRec.empName,r.title||'this station'); }
        });
    }
    function trhUploadEvidence(){
        var inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
        inp.onchange=function(){
            var f=inp.files&&inp.files[0]; if(!f) return;
            var lbl=document.getElementById('trhEvName'); if(lbl) lbl.textContent='Uploading…';
            withPin(function(pin){
                supabaseClient.functions.invoke('material-upload',{body:{username:currentUser.username,pin:pin,filename:f.name,contentType:f.type||'application/octet-stream'}}).then(function(res){
                    var err=(res&&res.error)?res.error.message:((res&&res.data&&res.data.error)?res.data.error:null);
                    if(err){ if(lbl) lbl.textContent=''; alert('Upload failed: '+err); return; }
                    var d=res&&res.data;
                    if(!d||!d.token){ if(lbl) lbl.textContent=''; alert('Upload could not start.'); return; }
                    supabaseClient.storage.from('training-materials').uploadToSignedUrl(d.path,d.token,f,{contentType:f.type||undefined}).then(function(up){
                        if(up.error){ if(lbl) lbl.textContent=''; alert('Upload failed: '+up.error.message); return; }
                        var pub=(supabaseClient.storage.from('training-materials').getPublicUrl(d.path)||{}).data||{};
                        _trh.evidenceUrl=d.publicUrl||d.url||pub.publicUrl||d.path; _trh.evidenceName=f.name;
                        if(lbl) lbl.textContent='✓ '+f.name;
                    }).catch(function(){ if(lbl) lbl.textContent=''; alert('Upload failed.'); });
                }).catch(function(){ if(lbl) lbl.textContent=''; alert('Upload failed.'); });
            });
        };
        inp.click();
    }

    // ---------- award certification ----------
    var _trhAward={enr:null};
    function trhAwardModal(enrId){
        var e=(_trh.detail&&_trh.detail.enrollment)||{};
        _trhAward={enr:enrId};
        var expDefault=''; if(e.cert_expires_days){ var d=new Date(); d.setDate(d.getDate()+e.cert_expires_days); expDefault=d.toISOString().slice(0,10); }
        trhM2('<b style="font-size:15px;color:#1f2a44;">🏅 Award '+escapeHtml(e.cert_name||'certification')+'</b>'+
            '<div style="font-size:12px;color:#6b7686;margin-top:4px;">'+(e.ready?'All requirements verified — this records the certification, updates the Development Passport, and grants station clearance.':'<b style="color:#9a5b00;">Requirements are NOT all complete.</b> Awarding anyway requires the override box and a written reason (this is audited).')+'</div>'+
            trhInp('trhAwExpires','Expiration date (blank = '+(expDefault?'default '+expDefault:'no expiration')+')',expDefault,'','date')+
            trhTxt('trhAwNote','Note'+(e.ready?' (optional)':' / override reason (required)'),'','')+
            (e.ready?'':'<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#c0264b;margin-top:8px;"><input type="checkbox" id="trhAwOverride"> I approve this exception despite incomplete requirements</label>')+
            trhBtnRow('Award certification','trhAwardSubmit('+(e.ready?'true':'false')+')'));
    }
    function trhAwardSubmit(ready){
        var note=trhVal('trhAwNote'); var exp=trhVal('trhAwExpires');
        var ov=false;
        if(!ready){ var cb=document.getElementById('trhAwOverride'); ov=!!(cb&&cb.checked);
            if(!ov){ alert('Check the override box (or finish the remaining requirements first).'); return; }
            if(!note){ alert('An override reason is required.'); return; } }
        trhRpc('trh_award_cert',{p_enrollment_id:_trhAward.enr,p_note:note||null,p_expires:exp||null,p_override:ov},function(d){
            trhM2Close(); alert('🏅 '+((d&&d.cert_name)||'Certification')+' awarded!');
            _trh.detail=null; _trh.team=null; _trh.tab='team'; trhLoadTeam();
        });
    }

    // ============================================================
    // CERTIFICATIONS (manager registry)
    // ============================================================
    function trhCertsHtml(){
        var d=_trh.team||{}; var certs=d.recent_certs||[];
        var h='';
        var ch='';
        certs.forEach(function(c){
            var col=TRH_STATUS_COLORS[c.status]||'#5b6472';
            ch+='<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid #f1f2f6;flex-wrap:wrap;">'+
                '<span style="font-size:19px;">🏅</span><div style="flex:1;min-width:160px;"><b style="font-size:13.5px;color:#26242b;">'+escapeHtml(c.employee||'')+'</b> <span style="font-size:12.5px;color:#5b6472;">&middot; '+escapeHtml(c.cert_name||'')+'</span>'+
                '<div style="font-size:11px;color:#8a91a0;">Issued '+trhDate(c.issued_at)+(c.issued_by?' by '+escapeHtml(c.issued_by):'')+(c.expires_date?' &middot; expires '+trhDate(c.expires_date):'')+' &middot; v'+(c.version||1)+(c.status_reason?' &middot; '+escapeHtml(c.status_reason):'')+'</div></div>'+
                trhChip(escapeHtml(c.status||''),col);
            if(c.status==='active') ch+='<button onclick="trhCertAction('+c.id+',&quot;suspended&quot;)" style="background:#fff4e0;color:#9a5b00;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Suspend</button>'+
                '<button onclick="trhCertAction('+c.id+',&quot;revoked&quot;)" style="background:#fdeaea;color:#c0264b;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Revoke</button>';
            else if(c.status==='suspended'||c.status==='revoked'||c.status==='expired') ch+='<button onclick="trhCertAction('+c.id+',&quot;active&quot;)" style="background:#e8f5ec;color:#1f7a3d;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Reinstate</button>';
            ch+='</div>';
        });
        h+=trhCard(ch||'<div style="color:#6b7686;font-size:12.5px;">No certifications awarded yet. When a trainee finishes their path, award it from their Team detail page.</div>','Awarded certifications (latest 50)');
        h+='<div style="font-size:11.5px;color:#8a91a0;">Suspending or revoking always requires a written reason and is recorded in the audit log. History is never deleted.</div>';
        return h;
    }
    function trhCertAction(certId,status){
        var verb=status==='active'?'reinstate':status.replace('ed','e');
        var reason=prompt('Reason to '+verb+' this certification (required, audited):','');
        if(reason===null) return;
        if(!String(reason).trim()){ alert('A reason is required.'); return; }
        trhRpc('trh_cert_status',{p_cert_id:certId,p_status:status,p_reason:reason},function(){ _trh.team=null; trhLoadTeam(); });
    }

    // ============================================================
    // PATH BUILDER (admin)
    // ============================================================
    function trhBuildHtml(){
        var d=_trh.admin||{}; var paths=d.paths||[];
        var h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;"><div style="flex:1;font-size:12px;color:#6b7686;">Paths, stages and requirements are live configuration — edits create a new path version; records already earned keep the version they were earned under.</div>'+
            '<button onclick="trhPathForm(null)" style="background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:9px 13px;font-size:12.5px;font-weight:800;cursor:pointer;white-space:nowrap;">+ New path</button></div>';
        if(!paths.length) h+=trhEmpty('No learning paths yet. Create the first one — e.g. “White → Blue Apron”.');
        paths.forEach(function(p){
            var ph='<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;"><span style="font-size:21px;">'+escapeHtml(p.icon||'🎓')+'</span>'+
                '<div style="flex:1;min-width:150px;"><b style="font-size:14.5px;color:#26242b;">'+escapeHtml(p.title||'')+'</b>'+
                '<div style="font-size:11px;color:#8a91a0;">'+(p.target_role?escapeHtml(p.target_role)+' &middot; ':'')+(p.onboarding_status?'status: '+escapeHtml(p.onboarding_status)+' &middot; ':'')+(p.cert_name?'awards: '+escapeHtml(p.cert_name)+' &middot; ':'')+'v'+(p.version||1)+' &middot; '+(p.enrolled_count||0)+' enrolled</div></div>'+
                '<button onclick="trhAssignForm('+p.id+')" style="background:#185FA5;color:#fff;border:none;border-radius:8px;padding:7px 11px;font-size:11.5px;font-weight:700;cursor:pointer;">Assign</button>'+
                '<button onclick="trhPathForm('+p.id+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:7px 11px;font-size:11.5px;font-weight:700;cursor:pointer;">Edit</button>'+
                '<button onclick="trhArchive(&quot;path&quot;,'+p.id+')" style="background:#fdeaea;color:#c0264b;border:none;border-radius:8px;padding:7px 11px;font-size:11.5px;font-weight:700;cursor:pointer;">Archive</button></div>';
            (p.stages||[]).forEach(function(s){
                ph+='<div style="border:1px solid #ececf2;border-radius:10px;margin-top:9px;overflow:hidden;">'+
                    '<div style="background:#f7f8fb;padding:8px 11px;display:flex;align-items:center;gap:7px;"><b style="flex:1;font-size:12.5px;color:#33303a;">'+escapeHtml(s.title||'')+'</b>'+
                    '<button onclick="trhReqForm('+p.id+','+s.id+',null)" style="background:#e8f5ec;color:#1f7a3d;border:none;border-radius:7px;padding:5px 9px;font-size:11px;font-weight:700;cursor:pointer;">+ Req</button>'+
                    '<button onclick="trhStageForm('+p.id+','+s.id+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:7px;padding:5px 9px;font-size:11px;font-weight:700;cursor:pointer;">Edit</button>'+
                    '<button onclick="trhArchive(&quot;stage&quot;,'+s.id+')" style="background:#fdeaea;color:#c0264b;border:none;border-radius:7px;padding:5px 9px;font-size:11px;font-weight:700;cursor:pointer;">&times;</button></div>';
                (s.reqs||[]).forEach(function(r){
                    var km=TRH_KINDS[r.kind]||['•',r.kind];
                    ph+='<div style="padding:7px 11px;border-top:1px solid #f1f2f6;display:flex;align-items:center;gap:7px;font-size:12.5px;color:#26242b;">'+
                        '<span title="'+km[1]+'">'+km[0]+'</span><span style="flex:1;">'+escapeHtml(r.title||'')+
                        ' <span style="font-size:10.5px;color:#8a91a0;">'+km[1]+(r.min_count>1?' ×'+r.min_count:'')+' &middot; '+escapeHtml(r.approver_role||'lead')+'</span></span>'+
                        '<button onclick="trhReqForm('+p.id+','+s.id+','+r.id+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:7px;padding:4px 8px;font-size:11px;font-weight:700;cursor:pointer;">Edit</button>'+
                        '<button onclick="trhArchive(&quot;requirement&quot;,'+r.id+')" style="background:#fdeaea;color:#c0264b;border:none;border-radius:7px;padding:4px 8px;font-size:11px;font-weight:700;cursor:pointer;">&times;</button></div>';
                });
                if(!(s.reqs||[]).length) ph+='<div style="padding:7px 11px;border-top:1px solid #f1f2f6;font-size:11.5px;color:#8a91a0;">No requirements — add digital lessons, sign-offs, OJT practice, credentials or the final approval.</div>';
                ph+='</div>';
            });
            ph+='<button onclick="trhStageForm('+p.id+',null)" style="margin-top:8px;background:#eef0f3;color:#5b6472;border:none;border-radius:8px;padding:7px 11px;font-size:11.5px;font-weight:700;cursor:pointer;">+ Add stage</button>';
            h+=trhCard(ph);
        });
        h+='<div style="font-size:11.5px;color:#8a91a0;margin-top:4px;">Adding a future role (e.g. Crew Trainer) later = just a new path here — no rebuild. Tunables live in Business Settings &rsaquo; group <b>trh_config</b>.</div>';
        return h;
    }
    function trhFindPath(id){ return ((_trh.admin&&_trh.admin.paths)||[]).filter(function(p){ return p.id===id; })[0]||null; }
    function trhPathForm(id){
        var p=id?trhFindPath(id):{};
        p=p||{};
        var lpOpts=[['','— none —']].concat(((_trh.admin&&_trh.admin.lp_paths)||[]).map(function(x){ return [x.id,x.title]; }));
        trhM2('<b style="font-size:15px;color:#1f2a44;">'+(id?'Edit':'New')+' learning path</b>'+
            trhInp('trhPfTitle','Title *',p.title||'','e.g. White → Blue Apron')+
            trhInp('trhPfIcon','Icon (emoji)',p.icon||'🎓','')+
            trhInp('trhPfRole','Audience / target role',p.target_role||'','e.g. Crew, Shift Leader')+
            trhInp('trhPfStatus','Onboarding status label while in progress',p.onboarding_status||'','e.g. White Apron (blank for none)')+
            trhInp('trhPfCert','Certification awarded on completion',p.cert_name||'','e.g. Blue Apron Certification')+
            trhInp('trhPfExp','Cert validity (days, blank = never expires)',p.cert_expires_days||'','','number')+
            trhSel('trhPfLp','Linked Training Portal path (optional, for course picking)',lpOpts,p.lp_path_id||'')+
            trhTxt('trhPfDesc','Description',p.description||'','')+
            trhInp('trhPfSort','Sort',p.sort!=null?p.sort:100,'','number')+
            trhBtnRow('Save path','trhPathSave('+(id||'null')+')'));
    }
    function trhPathSave(id){
        var t=trhVal('trhPfTitle'); if(!t){ alert('Title is required.'); return; }
        trhRpc('trh_path_save',{p_id:id,p_code:null,p_title:t,p_description:trhVal('trhPfDesc'),p_icon:trhVal('trhPfIcon'),p_target_role:trhVal('trhPfRole'),p_onboarding_status:trhVal('trhPfStatus'),p_cert_name:trhVal('trhPfCert'),p_cert_expires_days:trhVal('trhPfExp')?parseInt(trhVal('trhPfExp'),10):null,p_lp_path_id:trhVal('trhPfLp')?parseInt(trhVal('trhPfLp'),10):null,p_sort:trhVal('trhPfSort')?parseInt(trhVal('trhPfSort'),10):100,p_active:true},function(){ trhM2Close(); _trh.admin=null; trhLoadAdmin(); });
    }
    function trhStageForm(pathId,id){
        var p=trhFindPath(pathId)||{}; var s=id?((p.stages||[]).filter(function(x){ return x.id===id; })[0]||{}):{};
        trhM2('<b style="font-size:15px;color:#1f2a44;">'+(id?'Edit':'New')+' stage</b>'+
            trhInp('trhSfTitle','Title *',s.title||'','e.g. Digital Learning')+
            trhTxt('trhSfDesc','Description',s.description||'','')+
            trhInp('trhSfSort','Sort',s.sort!=null?s.sort:100,'','number')+
            trhBtnRow('Save stage','trhStageSave('+pathId+','+(id||'null')+')'));
    }
    function trhStageSave(pathId,id){
        var t=trhVal('trhSfTitle'); if(!t){ alert('Title is required.'); return; }
        trhRpc('trh_stage_save',{p_id:id,p_path_id:pathId,p_title:t,p_description:trhVal('trhSfDesc'),p_sort:trhVal('trhSfSort')?parseInt(trhVal('trhSfSort'),10):100,p_active:true},function(){ trhM2Close(); _trh.admin=null; trhLoadAdmin(); });
    }
    function trhReqForm(pathId,stageId,id){
        var p=trhFindPath(pathId)||{}; var r={};
        (p.stages||[]).forEach(function(s){ (s.reqs||[]).forEach(function(x){ if(id&&x.id===id) r=x; }); });
        var courses=((_trh.admin&&_trh.admin.lp_courses)||[]);
        if(p.lp_path_id) courses=courses.filter(function(c){ return c.path_id===p.lp_path_id; }).concat(courses.filter(function(c){ return c.path_id!==p.lp_path_id; }));
        var cOpts=[['','— none —']].concat(courses.map(function(c){ return [c.id,c.title]; }));
        var posOpts=[['','— none —']].concat(((_trh.admin&&_trh.admin.positions)||[]).map(function(x){ return [x.id,x.name]; }));
        var kOpts=Object.keys(TRH_KINDS).map(function(k){ return [k,TRH_KINDS[k][0]+' '+TRH_KINDS[k][1]]; });
        var critLines=(r.criteria||[]).map(function(c){ return String(c); }).join('\n');
        trhM2('<b style="font-size:15px;color:#1f2a44;">'+(id?'Edit':'New')+' requirement</b>'+
            trhSel('trhRfKind','Type *',kOpts,r.kind||'practical_signoff')+
            trhInp('trhRfTitle','Title *',r.title||'','e.g. Item-Making Foundations')+
            trhSel('trhRfCourse','Linked Training Portal course (digital / knowledge check)',cOpts,r.lp_course_id||'')+
            trhScormRowHtml()+
            trhSel('trhRfPos','Station / position (practical sign-off → grants clearance on award)',posOpts,r.position_id||'')+
            trhInp('trhRfCert','External credential type (matches cert list, e.g. Food Handler)',r.cert_type||'','')+
            trhTxt('trhRfCrit','Observable criteria (one per line — shown as a checklist at sign-off)',critLines,'Follows procedure without prompting\nMeets speed and accuracy standards')+
            trhInp('trhRfMin','Times required (practice sessions / witnessed reps)',r.min_count||1,'','number')+
            trhSel('trhRfAppr','Who may record this',[['lead','Shift Lead or above'],['manager','Manager or above'],['admin','Admin / VP / Owner only']],r.approver_role||'lead')+
            trhInp('trhRfMins','Estimated minutes (shown to the employee)',r.est_minutes||'','','number')+
            trhInp('trhRfSort','Sort',r.sort!=null?r.sort:100,'','number')+
            trhBtnRow('Save requirement','trhReqSave('+pathId+','+stageId+','+(id||'null')+')'));
    }
    function trhReqSave(pathId,stageId,id){
        var t=trhVal('trhRfTitle'); if(!t){ alert('Title is required.'); return; }
        var crit=trhVal('trhRfCrit').split('\n').map(function(s){ return s.trim(); }).filter(Boolean);
        trhRpc('trh_req_save',{p_id:id,p_path_id:pathId,p_stage_id:stageId,p_kind:trhVal('trhRfKind'),p_title:t,p_criteria:crit,p_lp_course_id:trhVal('trhRfCourse')?parseInt(trhVal('trhRfCourse'),10):null,p_position_id:trhVal('trhRfPos')?parseInt(trhVal('trhRfPos'),10):null,p_cert_type:trhVal('trhRfCert'),p_min_count:trhVal('trhRfMin')?parseInt(trhVal('trhRfMin'),10):1,p_approver_role:trhVal('trhRfAppr'),p_est_minutes:trhVal('trhRfMins')?parseInt(trhVal('trhRfMins'),10):null,p_sort:trhVal('trhRfSort')?parseInt(trhVal('trhRfSort'),10):100,p_active:true},function(){ trhM2Close(); _trh.admin=null; trhLoadAdmin(); });
    }
    function trhArchive(kind,id){
        if(!confirm('Archive this '+kind+'? It disappears from active paths but every record earned under it is preserved (never deleted).')) return;
        trhRpc('trh_archive',{p_kind:kind,p_id:id},function(){ _trh.admin=null; trhLoadAdmin(); });
    }
    function trhAssignForm(pathId){
        var p=trhFindPath(pathId)||{};
        var emps=((_trh.admin&&_trh.admin.employees)||[]);
        var eh=emps.map(function(x){
            return '<label data-trhname="'+escapeHtml(String(x.name||'').toLowerCase())+'" style="display:flex;align-items:center;gap:8px;font-size:13px;color:#33303a;padding:4px 0;"><input type="checkbox" class="trhAsEmp" value="'+x.id+'"> '+escapeHtml(x.name||'')+' <span style="font-size:10.5px;color:#8a91a0;">'+escapeHtml(x.role||'')+(x.store?' &middot; '+escapeHtml(x.store):'')+'</span></label>';
        }).join('');
        trhM2('<b style="font-size:15px;color:#1f2a44;">Assign: '+escapeHtml(p.title||'path')+'</b>'+
            '<div style="font-size:11.5px;color:#8a91a0;margin-top:2px;">Already-active enrollments are skipped automatically (no duplicates).</div>'+
            trhInp('trhAsDue','Due date (optional)','','','date')+
            '<div style="margin-top:8px;"><input id="trhAsFilter" placeholder="Type to filter names…" onkeyup="trhAsFilter()" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #d8dce4;border-radius:9px;font-size:13px;"></div>'+
            '<div id="trhAsList" style="max-height:260px;overflow:auto;margin-top:6px;border:1px solid #ececf2;border-radius:9px;padding:6px 10px;">'+(eh||'<div style="font-size:12px;color:#8a91a0;padding:8px 0;">No roster employees found.</div>')+'</div>'+
            trhBtnRow('Assign path','trhAssignSave('+pathId+')'));
    }
    function trhAsFilter(){
        var q=trhVal('trhAsFilter').toLowerCase();
        var list=document.getElementById('trhAsList'); if(!list) return;
        Array.prototype.forEach.call(list.querySelectorAll('label[data-trhname]'),function(l){ l.style.display=(!q||l.getAttribute('data-trhname').indexOf(q)>=0)?'flex':'none'; });
    }
    function trhAssignSave(pathId){
        var ids=[]; Array.prototype.forEach.call(document.querySelectorAll('.trhAsEmp:checked'),function(c){ ids.push(parseInt(c.value,10)); });
        if(!ids.length){ alert('Pick at least one employee.'); return; }
        trhRpc('trh_enroll',{p_path_id:pathId,p_employee_ids:ids,p_due:trhVal('trhAsDue')||null},function(d){
            trhM2Close(); alert(((d&&d.enrolled)||0)+' assigned'+((d&&d.skipped)?(', '+d.skipped+' already active (skipped)'):'')+'.');
            _trh.admin=null; _trh.team=null; trhLoadAdmin();
        });
    }

    // ============================================================
    // READY-TO-START (paid pre-start certificate + time capture)
    // Server accumulates minutes from start/finish timestamps and caps
    // them at app_settings trh_rules.prestart_max_minutes (default 120).
    // ============================================================
    function trhPsStatusChip(r){
        var map={assigned:['assigned','#185FA5'],in_progress:['in progress','#9a5b00'],completed:['finished — review','#185FA5'],approved:['approved','#1f7a3d']};
        var m=map[r.status]||[r.status,'#5b6472'];
        return trhChip(escapeHtml(m[0]),m[1]);
    }
    function trhPsMineHtml(){
        var d=_trh.psMine; if(!d) return '';
        if(!(d.rows||[]).length) return d._err?trhCard('<div style="color:#c0264b;font-size:12.5px;">Couldn&rsquo;t load your Ready-to-Start training: '+escapeHtml(d._err)+' <button onclick="trhLoadMyExtras()" style="margin-left:4px;background:#fdeaea;color:#c0264b;border:none;border-radius:7px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Retry</button></div>'):'';
        var cap=d.cap||120; var h='';
        (d.rows||[]).forEach(function(r){
            h+='<div style="border:1px solid #ececf2;border-radius:11px;padding:10px 12px;margin-bottom:8px;">'+
               '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span style="font-size:18px;">💵</span>'+
               '<div style="flex:1;min-width:150px;"><b style="font-size:13.5px;color:#26242b;">'+escapeHtml(r.path_title||'Pre-start training')+'</b>'+
               '<div style="font-size:11px;color:#8a91a0;">Earns: '+escapeHtml(r.cert_name||'entry certificate')+' &middot; assigned '+trhDate(r.assigned_at)+'</div></div>'+trhPsStatusChip(r)+'</div>'+
               '<div style="font-size:12.5px;color:#33303a;margin-top:7px;"><b>'+(r.minutes_spent||0)+'</b> paid minute'+((r.minutes_spent||0)===1?'':'s')+' recorded (max '+cap+')'+(r.session_open?' &middot; <b style="color:#1f7a3d;">session running</b>':'')+'</div>';
            if(r.status==='approved'){
                h+='<div style="font-size:12px;color:#1f7a3d;font-weight:700;margin-top:7px;">🏅 '+escapeHtml(r.cert_name||'Certificate')+' awarded'+(r.approved_by?' by '+escapeHtml(r.approved_by):'')+' '+trhDate(r.approved_at)+'.</div>';
            } else if(r.status==='completed'){
                h+='<div style="font-size:12px;color:#9a5b00;font-weight:700;margin-top:7px;">Waiting on a manager to review and award your certificate.</div>';
            } else {
                h+='<div style="display:flex;gap:8px;margin-top:9px;flex-wrap:wrap;">';
                if(r.session_open) h+='<button onclick="trhPsAction('+r.id+',&quot;finish&quot;)" style="background:#9a5b00;color:#fff;border:none;border-radius:9px;padding:9px 13px;font-size:12.5px;font-weight:800;cursor:pointer;">⏹ End session</button>';
                else h+='<button onclick="trhPsAction('+r.id+',&quot;start&quot;)" style="background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:9px 13px;font-size:12.5px;font-weight:800;cursor:pointer;">▶ Start session</button>';
                h+='<button onclick="trhPsAction('+r.id+',&quot;complete&quot;)" style="background:#eef3fb;color:#185FA5;border:none;border-radius:9px;padding:9px 13px;font-size:12.5px;font-weight:700;cursor:pointer;">✓ I finished the course</button></div>';
            }
            h+='</div>';
        });
        h+='<div style="font-size:11.5px;color:#6b7686;background:#f2f7f3;border:1px solid #d9eadf;border-radius:9px;padding:8px 10px;">💵 <b>This pre-start training is paid time.</b> Tap Start session while you learn and End session when you stop — your minutes (up to '+cap+') are recorded here and sent to payroll after a manager approves.</div>';
        return trhCard(h,'Ready-to-Start — paid pre-start training');
    }
    function trhPsAction(id,action){
        if(action==='complete'&&!confirm('Mark the whole pre-start course finished? Any running session is ended, and a manager will review and award your certificate.')) return;
        trhRpc('trh_prestart_progress',{p_id:id,p_action:action},function(){
            trhRpc('trh_prestart_my',{},function(d){ _trh.psMine=d||{rows:[]}; if(_trh.tab==='my'&&!_trh.detail) trhRender(); },function(){});
        });
    }
    function trhPsTeamHtml(){
        var d=_trh.psTeam;
        var head='<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">'+
            '<button onclick="trhPsAssignForm()" style="background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:8px 12px;font-size:12px;font-weight:800;cursor:pointer;">+ Assign pre-start</button>'+
            '<button onclick="trhPsExport()" style="background:#185FA5;color:#fff;border:none;border-radius:9px;padding:8px 12px;font-size:12px;font-weight:800;cursor:pointer;">⬇ Export payroll CSV'+(d&&d.unexported?' ('+d.unexported+')':'')+'</button></div>';
        if(!d) return trhCard(head+'<div style="color:#6b7686;font-size:12.5px;">Loading&hellip;</div>','Ready-to-Start — paid pre-start');
        var rows=d.rows||[]; var h=head;
        if(!rows.length) h+=(d._err?('<div style="color:#c0264b;font-size:12.5px;">Couldn&rsquo;t load pre-start assignments: '+escapeHtml(d._err)+' <button onclick="trhLoadTeamExtras()" style="margin-left:4px;background:#fdeaea;color:#c0264b;border:none;border-radius:7px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Retry</button></div>'):'<div style="color:#6b7686;font-size:12.5px;">No pre-start assignments yet. New hires complete paid, timed pre-start training before their first shift, then you approve it to award the entry certificate.</div>');
        rows.forEach(function(r){
            h+='<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f1f2f6;flex-wrap:wrap;">'+
               '<div style="flex:1;min-width:160px;"><b style="font-size:13.5px;color:#26242b;">'+escapeHtml(r.employee||'')+'</b>'+(r.store?' <span style="font-size:11px;color:#8a91a0;">&middot; '+escapeHtml(r.store)+'</span>':'')+
               '<div style="font-size:11px;color:#8a91a0;">'+(r.path_title?escapeHtml(r.path_title)+' &middot; ':'')+(r.minutes_spent||0)+' paid min'+(r.session_open?' &middot; session running':'')+' &middot; assigned '+trhDate(r.assigned_at)+(r.status==='approved'?(r.exported?' &middot; sent to payroll':' &middot; awaiting payroll export'):'')+'</div></div>'+
               trhPsStatusChip(r);
            if(r.status!=='approved') h+='<button onclick="trhPsApprove('+r.id+','+(r.status==='completed'?'true':'false')+')" style="background:'+(r.status==='completed'?'#1f7a3d':'#eef0f3')+';color:'+(r.status==='completed'?'#fff':'#5b6472')+';border:none;border-radius:8px;padding:7px 11px;font-size:11.5px;font-weight:700;cursor:pointer;">🏅 Approve</button>';
            h+='</div>';
        });
        h+='<div style="font-size:11px;color:#8a91a0;margin-top:8px;">Approving awards the entry certificate and queues the recorded minutes for the payroll export. Paid time is capped at '+(d.cap||120)+' minutes per hire (Business Settings &rsaquo; group <b>trh_rules</b>).</div>';
        return trhCard(h,'Ready-to-Start — paid pre-start');
    }
    function trhPsAssignForm(){
        var d=_trh.psTeam||{}; var emps=d.employees||[];
        if(!emps.length){ alert('Still loading the roster — try again in a second.'); return; }
        var pOpts=[['','— none (self-guided) —']].concat((d.paths||[]).map(function(p){ return [p.id,p.title]; }));
        var eh=emps.map(function(x){
            return '<label data-trhname="'+escapeHtml(String(x.name||'').toLowerCase())+'" style="display:flex;align-items:center;gap:8px;font-size:13px;color:#33303a;padding:4px 0;"><input type="checkbox" class="trhPsEmp" value="'+x.id+'"> '+escapeHtml(x.name||'')+' <span style="font-size:10.5px;color:#8a91a0;">'+escapeHtml(x.role||'')+(x.store?' &middot; '+escapeHtml(x.store):'')+'</span></label>';
        }).join('');
        trhM2('<b style="font-size:15px;color:#1f2a44;">💵 Assign Ready-to-Start (paid)</b>'+
            '<div style="font-size:11.5px;color:#8a91a0;margin-top:2px;">Timed, paid pre-start training. Anyone with an open pre-start record is skipped automatically.</div>'+
            trhSel('trhPsPath','Pre-start course / learning path (optional)',pOpts,'')+
            trhInp('trhPsCert','Entry certificate name (blank = '+escapeHtml(d.default_cert||'Ready-to-Start Certificate')+')','','')+
            '<div style="margin-top:8px;"><input id="trhPsFilter" placeholder="Type to filter names…" onkeyup="trhPsFilter()" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #d8dce4;border-radius:9px;font-size:13px;"></div>'+
            '<div id="trhPsList" style="max-height:240px;overflow:auto;margin-top:6px;border:1px solid #ececf2;border-radius:9px;padding:6px 10px;">'+eh+'</div>'+
            trhBtnRow('Assign','trhPsAssignSave()'));
    }
    function trhPsFilter(){
        var q=trhVal('trhPsFilter').toLowerCase();
        var list=document.getElementById('trhPsList'); if(!list) return;
        Array.prototype.forEach.call(list.querySelectorAll('label[data-trhname]'),function(l){ l.style.display=(!q||l.getAttribute('data-trhname').indexOf(q)>=0)?'flex':'none'; });
    }
    function trhPsAssignSave(){
        var ids=[]; Array.prototype.forEach.call(document.querySelectorAll('.trhPsEmp:checked'),function(c){ ids.push(parseInt(c.value,10)); });
        if(!ids.length){ alert('Pick at least one employee.'); return; }
        trhRpc('trh_prestart_assign',{p_employee_ids:ids,p_path_id:trhVal('trhPsPath')?parseInt(trhVal('trhPsPath'),10):null,p_cert_name:trhVal('trhPsCert')||null,p_note:null},function(d){
            trhM2Close(); alert(((d&&d.assigned)||0)+' assigned'+((d&&d.skipped)?(', '+d.skipped+' already had an open pre-start (skipped)'):'')+'.');
            trhLoadTeamExtras();
        });
    }
    function trhPsApprove(id,ready){
        var note=prompt((ready?'':'This person has not marked the course finished yet. ')+'Approve and award the entry certificate? Optional note:','');
        if(note===null) return;
        trhRpc('trh_prestart_approve',{p_id:id,p_note:note||null},function(d){
            alert('🏅 '+((d&&d.cert_name)||'Certificate')+' awarded — '+((d&&d.minutes_spent)||0)+' paid minutes queued for payroll export.');
            trhLoadTeamExtras();
        });
    }
    function trhCsvCell(s){ s=String(s==null?'':s); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
    function trhPsExport(){
        trhRpc('trh_prestart_payroll_export',{},function(d){
            var rows=(d&&d.rows)||[];
            if(!rows.length){ alert('Nothing to export — no approved, unexported pre-start records.'); return; }
            var csv='Employee,Date,Minutes\r\n'+rows.map(function(r){ return trhCsvCell(r.employee)+','+trhCsvCell(r.date)+','+(r.minutes||0); }).join('\r\n')+'\r\n';
            var a=document.createElement('a');
            a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
            a.download='ready_to_start_payroll_'+new Date().toISOString().slice(0,10)+'.csv';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            alert(rows.length+' row'+(rows.length>1?'s':'')+' exported and stamped — the same minutes will never export twice.');
            trhLoadTeamExtras();
        });
    }

    // ============================================================
    // QUICK SCOOPS (refresher / retraining bites)
    // ============================================================
    function trhQsMineHtml(){
        var d=_trh.qsMine; if(!d) return '';
        if(!(d.rows||[]).length) return d._err?trhCard('<div style="color:#c0264b;font-size:12.5px;">Couldn&rsquo;t load your Quick Scoops: '+escapeHtml(d._err)+' <button onclick="trhLoadMyExtras()" style="margin-left:4px;background:#fdeaea;color:#c0264b;border:none;border-radius:7px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Retry</button></div>'):'';
        var h='';
        (d.rows||[]).forEach(function(r){
            h+='<div style="border:1px solid #ececf2;border-radius:11px;padding:10px 12px;margin-bottom:8px;">'+
               '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:17px;">🍦</span><b style="flex:1;font-size:13.5px;color:#26242b;">'+escapeHtml(r.title||'')+'</b>'+
               (r.overdue?trhChip('overdue','#c0264b'):(r.due_at?trhChip('due '+trhDate(r.due_at),'#9a5b00'):''))+'</div>'+
               (r.body?'<div style="font-size:13px;color:#33303a;line-height:1.55;margin-top:7px;white-space:pre-wrap;">'+escapeHtml(r.body)+'</div>':'')+
               '<div style="font-size:11px;color:#8a91a0;margin-top:6px;">From '+escapeHtml(r.assigned_by||'your manager')+' &middot; '+trhDate(r.assigned_at)+'</div>';
            if(r.check_question) h+='<div style="margin-top:8px;"><label style="font-size:11.5px;font-weight:700;color:#5b6472;">'+escapeHtml(r.check_question)+'</label><input id="trhQsAns_'+r.id+'" placeholder="Your answer…" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #d8dce4;border-radius:8px;font-size:13px;margin-top:3px;"></div>';
            h+='<button onclick="trhQsDone('+r.id+','+(r.check_question?'true':'false')+')" style="margin-top:9px;background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:9px 13px;font-size:12.5px;font-weight:800;cursor:pointer;">✓ Mark done</button></div>';
        });
        return trhCard(h,'Quick Scoops — refreshers ('+(d.rows||[]).length+')');
    }
    function trhQsDone(assignId,hasCheck){
        var resp=null;
        if(hasCheck){
            var row=((_trh.qsMine&&_trh.qsMine.rows)||[]).filter(function(r){ return r.id===assignId; })[0]||{};
            var el=document.getElementById('trhQsAns_'+assignId);
            var ans=el?String(el.value||'').trim():'';
            if(!ans){ alert('Answer the quick check question first — it shows your manager the scoop landed.'); return; }
            resp={question:row.check_question||'',answer:ans};
        }
        trhRpc('trh_qs_complete',{p_assignment_id:assignId,p_response:resp},function(){
            trhRpc('trh_qs_my',{},function(d){ _trh.qsMine=d||{rows:[]}; if(_trh.tab==='my'&&!_trh.detail) trhRender(); },function(){});
        });
    }
    function trhQsTeamHtml(){
        var d=_trh.qsTeam;
        var head='<div style="display:flex;gap:8px;margin-bottom:10px;"><div style="flex:1;font-size:12px;color:#6b7686;">Short refreshers and retraining bites — create one, assign it (by person or audience), and watch completion.</div>'+
            '<button onclick="trhQsForm(null)" style="background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:8px 12px;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap;">+ New scoop</button></div>';
        if(!d) return trhCard(head+'<div style="color:#6b7686;font-size:12.5px;">Loading&hellip;</div>','Quick Scoops');
        var h=head; var scoops=d.scoops||[]; var open=d.open||[];
        if(!scoops.length) h+=(d._err?('<div style="color:#c0264b;font-size:12.5px;">Couldn&rsquo;t load Quick Scoops: '+escapeHtml(d._err)+' <button onclick="trhLoadTeamExtras()" style="margin-left:4px;background:#fdeaea;color:#c0264b;border:none;border-radius:7px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Retry</button></div>'):'<div style="color:#6b7686;font-size:12.5px;">No Quick Scoops yet — e.g. “Cup sizes refresher” or “New closing checklist”.</div>');
        scoops.forEach(function(s){
            h+='<div style="border:1px solid #ececf2;border-radius:10px;padding:9px 11px;margin-bottom:7px;'+(s.active?'':'opacity:.55;')+'">'+
               '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;"><b style="flex:1;min-width:140px;font-size:13px;color:#26242b;">🍦 '+escapeHtml(s.title||'')+'</b>'+
               '<span style="font-size:11px;color:#8a91a0;">'+(s.audience_role?escapeHtml(s.audience_role):'all roles')+' &middot; '+(s.audience_store?escapeHtml(s.audience_store):'all stores')+' &middot; due in '+(s.due_days||3)+'d</span>'+
               trhChip((s.done||0)+'/'+(s.assigned||0)+' done',(s.assigned&&s.done>=s.assigned)?'#1f7a3d':'#185FA5')+(s.overdue?trhChip(s.overdue+' overdue','#c0264b'):'')+
               '<button onclick="trhQsAssignForm('+s.id+')" style="background:#185FA5;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Assign</button>'+
               '<button onclick="trhQsForm('+s.id+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Edit</button></div></div>';
        });
        if(open.length){
            h+='<div style="font-size:11.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#8a91a0;margin:10px 0 4px;">Waiting on ('+open.length+')</div>';
            open.forEach(function(o){
                h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f2f6;font-size:12.5px;color:#26242b;"><b style="flex:1;">'+escapeHtml(o.employee||'')+'</b><span style="color:#5b6472;">'+escapeHtml(o.title||'')+'</span>'+(o.overdue?trhChip('overdue','#c0264b'):(o.due_at?'<span style="font-size:11px;color:#8a91a0;">due '+trhDate(o.due_at)+'</span>':''))+'</div>';
            });
        }
        return trhCard(h,'Quick Scoops');
    }
    function trhQsFind(id){ return ((_trh.qsTeam&&_trh.qsTeam.scoops)||[]).filter(function(s){ return s.id===id; })[0]||null; }
    function trhQsForm(id){
        var s=id?(trhQsFind(id)||{}):{};
        var stores=[['','All stores']].concat(((typeof HUB_STORES!=='undefined'?HUB_STORES:[]).concat(['Warehouse'])).map(function(x){ return [x,x]; }));
        trhM2('<b style="font-size:15px;color:#1f2a44;">'+(id?'Edit':'New')+' Quick Scoop</b>'+
            trhInp('trhQsfTitle','Title *',s.title||'','e.g. Cup sizes refresher')+
            trhTxt('trhQsfBody','What should they read / re-learn?',s.body||'','Keep it short — a scoop, not a course.')+
            trhInp('trhQsfRole','Audience roles (csv, blank = all)',s.audience_role||'','e.g. crew,lead')+
            trhSel('trhQsfStore','Audience store',stores,s.audience_store||'')+
            trhInp('trhQsfDue','Due in (days)',s.due_days!=null?s.due_days:3,'','number')+
            trhInp('trhQsfCheck','Optional 1-question check',s.check_question||'','e.g. What size is a Small?')+
            (id?'<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#33303a;margin-top:8px;"><input type="checkbox" id="trhQsfActive"'+(s.active!==false?' checked':'')+'> Active (assignable)</label>':'')+
            trhBtnRow('Save scoop','trhQsSave('+(id||'null')+')'));
    }
    function trhQsSave(id){
        var t=trhVal('trhQsfTitle'); if(!t){ alert('Title is required.'); return; }
        var ac=true; if(id){ var cb=document.getElementById('trhQsfActive'); ac=!!(cb&&cb.checked); }
        trhRpc('trh_qs_save',{p_id:id,p_title:t,p_body:trhVal('trhQsfBody')||null,p_audience_role:trhVal('trhQsfRole')||null,p_audience_store:trhVal('trhQsfStore')||null,p_due_days:trhVal('trhQsfDue')?parseInt(trhVal('trhQsfDue'),10):3,p_check_question:trhVal('trhQsfCheck')||null,p_active:ac},function(){
            trhM2Close(); trhLoadTeamExtras();
        });
    }
    function trhQsAssignForm(scoopId){
        var d=_trh.qsTeam||{}; var s=trhQsFind(scoopId)||{}; var emps=d.employees||[];
        var eh=emps.map(function(x){
            return '<label data-trhname="'+escapeHtml(String(x.name||'').toLowerCase())+'" style="display:flex;align-items:center;gap:8px;font-size:13px;color:#33303a;padding:4px 0;"><input type="checkbox" class="trhQsEmp" value="'+x.id+'"> '+escapeHtml(x.name||'')+' <span style="font-size:10.5px;color:#8a91a0;">'+escapeHtml(x.role||'')+(x.store?' &middot; '+escapeHtml(x.store):'')+'</span></label>';
        }).join('');
        trhM2('<b style="font-size:15px;color:#1f2a44;">Assign: '+escapeHtml(s.title||'Quick Scoop')+'</b>'+
            '<div style="font-size:11.5px;color:#8a91a0;margin-top:2px;">Anyone who already has this scoop open is skipped (no duplicates).</div>'+
            '<button onclick="trhQsAssignSave('+scoopId+',true)" style="width:100%;margin-top:10px;background:#eef3fb;color:#185FA5;border:none;border-radius:9px;padding:10px;font-size:12.5px;font-weight:800;cursor:pointer;">📣 Assign to the scoop&rsquo;s audience ('+(s.audience_role?escapeHtml(s.audience_role):'all roles')+' &middot; '+(s.audience_store?escapeHtml(s.audience_store):'all stores')+')</button>'+
            '<div style="font-size:11px;color:#8a91a0;margin-top:8px;">…or pick specific people:</div>'+
            '<div style="margin-top:6px;"><input id="trhQsFilter" placeholder="Type to filter names…" onkeyup="trhQsFilterList()" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #d8dce4;border-radius:9px;font-size:13px;"></div>'+
            '<div id="trhQsList" style="max-height:220px;overflow:auto;margin-top:6px;border:1px solid #ececf2;border-radius:9px;padding:6px 10px;">'+(eh||'<div style="font-size:12px;color:#8a91a0;padding:8px 0;">No roster employees found.</div>')+'</div>'+
            trhBtnRow('Assign to selected','trhQsAssignSave('+scoopId+',false)'));
    }
    function trhQsFilterList(){
        var q=trhVal('trhQsFilter').toLowerCase();
        var list=document.getElementById('trhQsList'); if(!list) return;
        Array.prototype.forEach.call(list.querySelectorAll('label[data-trhname]'),function(l){ l.style.display=(!q||l.getAttribute('data-trhname').indexOf(q)>=0)?'flex':'none'; });
    }
    function trhQsAssignSave(scoopId,audience){
        var ids=[];
        if(!audience){
            Array.prototype.forEach.call(document.querySelectorAll('.trhQsEmp:checked'),function(c){ ids.push(parseInt(c.value,10)); });
            if(!ids.length){ alert('Pick at least one employee (or use the audience button).'); return; }
        }
        trhRpc('trh_qs_assign',{p_quickscoop_id:scoopId,p_employee_ids:ids,p_source:audience?'audience':'manual'},function(d){
            trhM2Close(); alert(((d&&d.assigned)||0)+' assigned'+((d&&d.skipped)?(', '+d.skipped+' already open (skipped)'):'')+'.');
            trhLoadTeamExtras();
        });
    }
    // failed practical sign-off -> offer a pre-filled Quick Scoop (retraining,
    // never discipline). Hooked from trhRecordSubmit; managers only.
    var _trhQsFail={emp:null};
    function trhQsOfferFromFail(empId,empName,station){
        _trhQsFail={emp:empId};
        trhM2('<b style="font-size:15px;color:#1f2a44;">🍦 Assign a Quick Scoop?</b>'+
            '<div style="font-size:12.5px;color:#6b7686;margin-top:4px;">'+escapeHtml(empName||'This employee')+' didn&rsquo;t pass <b>'+escapeHtml(station)+'</b>. A Quick Scoop sends a short refresher they read and mark done — remediation guidance, never automatic discipline.</div>'+
            trhInp('trhQfTitle','Title *','Refresher: '+station,'')+
            trhTxt('trhQfBody','What should they review?','Quick refresher after the "'+station+'" sign-off. Review the steps with your leader&rsquo;s notes in mind, then mark done. You can request your next sign-off any time.','')+
            trhInp('trhQfCheck','Optional 1-question check','','e.g. What are the three steps?')+
            trhBtnRow('Create &amp; assign','trhQsFailSave()'));
    }
    function trhQsFailSave(){
        var t=trhVal('trhQfTitle'); if(!t){ alert('Title is required.'); return; }
        trhRpc('trh_qs_save',{p_id:null,p_title:t,p_body:trhVal('trhQfBody')||null,p_audience_role:null,p_audience_store:null,p_due_days:3,p_check_question:trhVal('trhQfCheck')||null,p_active:true},function(d){
            var sid=d&&d.id;
            if(!sid){ alert('Could not create the scoop.'); return; }
            trhRpc('trh_qs_assign',{p_quickscoop_id:sid,p_employee_ids:[_trhQsFail.emp],p_source:'failed_signoff'},function(a){
                trhM2Close(); alert(((a&&a.assigned)?'Quick Scoop assigned.':'They already had this scoop open — nothing duplicated.'));
                trhLoadTeamExtras();
            });
        });
    }

    // ============================================================
    // SCORM PACKAGE (attach to the linked LMS course) — minimal + honest.
    // Hosts the unzipped package via the scorm-upload edge function
    // (path-preserving signed uploads) and stores the launch URL with
    // app_lp_set_scorm. NO runtime / scoring bridge is built here:
    // completion is still recorded by the sign-off / knowledge check.
    // ============================================================
    function trhScormRowHtml(){
        return '<div style="margin-top:8px;"><label style="font-size:11.5px;font-weight:700;color:#5b6472;">SCORM package (for the linked course)</label>'+
            '<div style="display:flex;gap:6px;margin-top:3px;align-items:center;flex-wrap:wrap;">'+
            '<button onclick="trhScormUpload()" style="background:#7d1d4b;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;">⬆ Upload .zip</button>'+
            '<button onclick="trhScormLaunch()" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;">▶ Launch</button>'+
            '<span id="trhScormMsg" style="font-size:11.5px;color:#6b7686;"></span></div>'+
            '<div style="font-size:10.5px;color:#8a91a0;margin-top:3px;">Opens the interactive course; completion is recorded by your sign-off/quiz.</div></div>';
    }
    function trhScormSetMsg(t){ var e=document.getElementById('trhScormMsg'); if(e) e.textContent=t||''; }
    function trhScormCourseId(){ var v=parseInt(trhVal('trhRfCourse'),10); return isNaN(v)?0:v; }
    function trhScormUpload(){
        var cid=trhScormCourseId();
        if(!cid){ alert('Pick a linked Training Portal course first — the SCORM package attaches to that course.'); return; }
        if(typeof JSZip==='undefined'){ alert('The unzip tool is still loading — please try again in a few seconds.'); return; }
        withPin(function(pin){
            var inp=document.createElement('input'); inp.type='file'; inp.accept='.zip,application/zip';
            inp.onchange=function(){ var f=inp.files&&inp.files[0]; if(f) trhScormDoUpload(cid,f,pin); };
            inp.click();
        });
    }
    async function trhScormDoUpload(cid,file,pin){
        // Shared with "My Training" (scormUploadPackage, js/01_part01.js) so there's
        // one zip/manifest/upload implementation instead of two drifting copies. This
        // also means a Training Hub-attached package now gets the scorm-player.html
        // companion deployed alongside it (previously skipped here), so a direct
        // launch actually has a working window.API shim instead of none. Training
        // Hub's own completion source (sign-off/quiz) is unaffected either way.
        try{
            var scormUrl=await scormUploadPackage(cid,file,pin,function(t){ trhScormSetMsg(t); });
            trhScormSetMsg('Attaching to the course…');
            await new Promise(function(res,rej){ supabaseClient.rpc('app_lp_set_scorm',{p_username:currentUser.username,p_password:pin,p_course_id:cid,p_url:scormUrl,p_version:'1.2'}).then(function(r){ if(r.error) rej(new Error(r.error.message)); else res(); }).catch(rej); });
            trhScormSetMsg('✓ SCORM package attached');
        }catch(e){ trhScormSetMsg(''); alert('Upload failed: '+((e&&e.message)?e.message:e)); }
    }
    function trhScormLaunch(){
        var cid=trhScormCourseId();
        if(!cid){ alert('Pick a linked Training Portal course first.'); return; }
        var w=window.open('about:blank','_blank');
        trhRpc('trh_scorm_info',{p_course_id:cid},function(d){
            if(d&&d.scorm_url){ if(w){ w.location=d.scorm_url; } else { window.open(d.scorm_url,'_blank'); } }
            else{ if(w) w.close(); alert('No SCORM package attached to this course yet — upload a .zip first.'); }
        },function(e){ if(w) w.close(); alert(trhErrMsg((e&&e.message)||'Could not check the course.')); });
    }

    // ===== export =====
    window.openTrainingHub = openTrainingHub;
