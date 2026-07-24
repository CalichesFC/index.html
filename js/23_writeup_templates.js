    // ============================================================
    // WRITE-UP TEMPLATES  (js/23) — role-specific disciplinary write-up
    // templates layered ON TOP of the existing discipline system (js/06).
    // Entry: openWriteupTemplates()  — self-contained overlay, id
    // writeupTemplatesModal. The original generic flow (openDiscipline, js/06)
    // is untouched and is offered here as the "General" template.
    //
    // GET SHAPE (app_disc_tmpl_get -> ONE jsonb; TOP-LEVEL key this file reads
    // is exactly 'templates'):
    //   { "templates":[ { "key":"crew"|"trainer"|"shiftlead"|"mgmt",
    //       "label","title","intro","coach_intro","expect","ack","signer",
    //       "reasons":[ {"label","section","sort"} ],
    //       "coaching":[ {"label","sort"} ] } ] }
    //   Reason/coaching lists live in app_settings groups disc_tmpl_crew /
    //   disc_tmpl_trainer / disc_tmpl_shiftlead / disc_tmpl_mgmt (+ their
    //   *_coach twins) and wording in disc_tmpl_config — all admin-editable.
    //   WT_FALLBACK below (verbatim from the 4 form docs) only covers a
    //   not-yet-seeded DB so nothing ever renders empty.
    //
    // SAVE SHAPE — reuses the EXISTING app_discipline_create_v2, called with
    // the SAME contract js/06 already uses (existing callers unaffected):
    //   { p_username, p_password, p_employee_id:int,
    //     p_level:'written'|'final',            // from the Recommended-action radio
    //     p_category:'<template label> Performance',
    //     p_company_statement:text,             // "Additional details" box
    //     p_employee_statement:text,            // "<signer> comments" box
    //     p_action_date:'YYYY-MM-DD',
    //     p_signatures:{ '<signer>':dataURL, 'Supervisor':dataURL },
    //     p_form_data:{ form:'writeup', template:key, template_label,
    //                   violations:[..], other_detail, coaching:[..],
    //                   prior_coaching, recommended_action },
    //     p_pdf_url:url|null,
    //     p_form_type:'writeup' }               // a value js/06 already sends
    // Every save lands in the SAME unified employee discipline record
    // (feed / history / standing / void all keep working), signatures use the
    // existing discInitPad pad, and the signed PDF files to Dropbox through
    // the existing hubHrReportHtml + hubGenHrPdf pipeline (js/06).
    // ============================================================

    var WT_FALLBACK = [
     {
      "key": "crew",
      "label": "Pink & Blue Apron",
      "title": "Employee Performance Write-Up Form (Underperformance)",
      "intro": "On the date listed above, the employee was observed underperforming in the following area(s):",
      "coach_intro": "This issue was addressed during the shift by the supervisor through:",
      "expect": "The expectations for performance were clearly communicated, and the employee was informed that continued underperformance may result in further corrective action, up to and including termination if uncorrected.",
      "ack": "By signing below, you acknowledge that this performance issue has been reviewed with you. This form is not a guarantee of termination or discipline but serves as documentation of expectations being communicated.",
      "signer": "Employee",
      "reasons": [
       {
        "label": "Not following assigned duties or task list",
        "section": "",
        "sort": 10
       },
       {
        "label": "Excessive or uncommunicated breaks",
        "section": "",
        "sort": 20
       },
       {
        "label": "Repeated delays in making customer orders",
        "section": "",
        "sort": 30
       },
       {
        "label": "Neglecting food safety protocols",
        "section": "",
        "sort": 40
       },
       {
        "label": "Not supporting team during rushes or downtime",
        "section": "",
        "sort": 50
       },
       {
        "label": "Frequent call-ins, absences, or tardies",
        "section": "",
        "sort": 60
       },
       {
        "label": "Lack of urgency in task completion, item-making",
        "section": "",
        "sort": 70
       },
       {
        "label": "Clocking in before being ready to work",
        "section": "",
        "sort": 80
       },
       {
        "label": "Lack of initiative and/or awareness",
        "section": "",
        "sort": 90
       },
       {
        "label": "Resistant to feedback or redirection",
        "section": "",
        "sort": 100
       },
       {
        "label": "Lack of item knowledge, incomplete/incorrect orders",
        "section": "",
        "sort": 110
       },
       {
        "label": "Ignoring or failing to follow supervisor instructions",
        "section": "",
        "sort": 120
       },
       {
        "label": "Failure to communicate when leaving assigned area",
        "section": "",
        "sort": 130
       },
       {
        "label": "Incomplete or missed cleaning duties",
        "section": "",
        "sort": 140
       },
       {
        "label": "Engaging in excessive and distractive conversation",
        "section": "",
        "sort": 150
       },
       {
        "label": "Not following safety/security protocols",
        "section": "",
        "sort": 160
       },
       {
        "label": "Dirty workstation/leaving messes behind",
        "section": "",
        "sort": 170
       },
       {
        "label": "Unprofessional or disengaged body language",
        "section": "",
        "sort": 180
       },
       {
        "label": "Failure to acknowledge customers, leadership, coworkers",
        "section": "",
        "sort": 190
       },
       {
        "label": "Carelessness in job responsibilities and role",
        "section": "",
        "sort": 200
       },
       {
        "label": "Poor attitude towards customers, coworkers or leadership",
        "section": "",
        "sort": 210
       },
       {
        "label": "Other",
        "section": "",
        "sort": 220
       }
      ],
      "coaching": [
       {
        "label": "Verbal reminder",
        "sort": 10
       },
       {
        "label": "On-the-spot coaching and clarification",
        "sort": 20
       },
       {
        "label": "Reassignment or redirection",
        "sort": 30
       }
      ]
     },
     {
      "key": "trainer",
      "label": "Crew Trainer",
      "title": "Crew Trainer Performance Write-Up Form (Underperformance)",
      "intro": "On the date(s) listed above, the crew trainer was observed underperforming in the following leadership area(s):",
      "coach_intro": "This issue was addressed during or following the shift through:",
      "expect": "The expectations for Crew Trainer performance were clearly communicated, and the Crew Trainer was informed that continued underperformance may result in further corrective action, up to and including termination if uncorrected.",
      "ack": "By signing below, you acknowledge that this performance issue has been reviewed with you. This form is not a guarantee of termination or continued employment, but serves as documentation of expectations being communicated.",
      "signer": "Crew Trainer",
      "reasons": [
       {
        "label": "Not effectively training assigned team members",
        "section": "",
        "sort": 10
       },
       {
        "label": "Providing incomplete, inaccurate, or inconsistent training",
        "section": "",
        "sort": 20
       },
       {
        "label": "Failure to follow, model, or teach company procedures and standards correctly",
        "section": "",
        "sort": 30
       },
       {
        "label": "Lack of patience, professionalism, or engagement while training",
        "section": "",
        "sort": 40
       },
       {
        "label": "Not serving as a positive role model for new team members",
        "section": "",
        "sort": 50
       },
       {
        "label": "Failure to communicate trainee progress, concerns, or development needs to leadership",
        "section": "",
        "sort": 60
       },
       {
        "label": "Failure to provide coaching, guidance, or constructive feedback to trainees",
        "section": "",
        "sort": 70
       },
       {
        "label": "Not reinforcing company expectations, policies, or procedures",
        "section": "",
        "sort": 80
       },
       {
        "label": "Failure to ensure trainees are practicing proper food safety and operational standards",
        "section": "",
        "sort": 90
       },
       {
        "label": "Inadequate product knowledge or inability to answer trainee questions appropriately",
        "section": "",
        "sort": 100
       },
       {
        "label": "Unprofessional tone, attitude, or conduct in a trainer role",
        "section": "",
        "sort": 110
       },
       {
        "label": "Resistance to feedback or redirection regarding training responsibilities",
        "section": "",
        "sort": 120
       },
       {
        "label": "Failure to demonstrate expected standards of quality, cleanliness, friendliness, speed, or accuracy",
        "section": "",
        "sort": 130
       },
       {
        "label": "Attendance or reliability issues impacting training responsibilities",
        "section": "",
        "sort": 140
       },
       {
        "label": "Other",
        "section": "",
        "sort": 150
       }
      ],
      "coaching": [
       {
        "label": "Verbal reminder",
        "sort": 10
       },
       {
        "label": "On-the-spot coaching and clarification",
        "sort": 20
       },
       {
        "label": "Training observation & feedback",
        "sort": 30
       },
       {
        "label": "Development coaching conversation",
        "sort": 40
       }
      ]
     },
     {
      "key": "shiftlead",
      "label": "Shift Leader",
      "title": "Shift Leader Performance Write-Up Form (Underperformance)",
      "intro": "On the date(s) listed above, the shift leader was observed underperforming in the following leadership area(s):",
      "coach_intro": "This issue was addressed during or following the shift through:",
      "expect": "The expectations for leadership performance were clearly communicated, and the shift leader was informed that continued underperformance may result in further corrective action, up to and including termination if uncorrected.",
      "ack": "By signing below, you acknowledge that this performance issue has been reviewed with you. This form is not a guarantee of termination or continued employment, but serves as documentation of leadership expectations being communicated.",
      "signer": "Shift Leader",
      "reasons": [
       {
        "label": "Not effectively leading or directing the shift",
        "section": "",
        "sort": 10
       },
       {
        "label": "Lack of urgency or leadership presence during rushes or peak business",
        "section": "",
        "sort": 20
       },
       {
        "label": "Poor judgment or decision-making impacting service or operations",
        "section": "",
        "sort": 30
       },
       {
        "label": "Failure to hold team members accountable to expectations",
        "section": "",
        "sort": 40
       },
       {
        "label": "Inadequate communication with team members or leadership",
        "section": "",
        "sort": 50
       },
       {
        "label": "Failure to follow, model, or enforce company policies and procedures",
        "section": "",
        "sort": 60
       },
       {
        "label": "Inconsistent or incorrect execution of operational standards",
        "section": "",
        "sort": 70
       },
       {
        "label": "Not supporting, coaching, or guiding team members appropriately",
        "section": "",
        "sort": 80
       },
       {
        "label": "Poor shift organization, task delegation, or time management",
        "section": "",
        "sort": 90
       },
       {
        "label": "Failure to prioritize customer experience",
        "section": "",
        "sort": 100
       },
       {
        "label": "Resistance to feedback or redirection",
        "section": "",
        "sort": 110
       },
       {
        "label": "Unprofessional tone, attitude, or conduct in a leadership role",
        "section": "",
        "sort": 120
       },
       {
        "label": "Failure to escalate concerns appropriately or timely",
        "section": "",
        "sort": 130
       },
       {
        "label": "Attendance or reliability issues impacting leadership coverage",
        "section": "",
        "sort": 140
       },
       {
        "label": "Other",
        "section": "",
        "sort": 150
       }
      ],
      "coaching": [
       {
        "label": "Verbal reminder",
        "sort": 10
       },
       {
        "label": "On-the-spot coaching and clarification",
        "sort": 20
       },
       {
        "label": "Post-shift feedback discussion",
        "sort": 30
       },
       {
        "label": "Leadership coaching conversation",
        "sort": 40
       }
      ]
     },
     {
      "key": "mgmt",
      "label": "Management",
      "title": "Management Performance Write-Up Form (Underperformance)",
      "intro": "On the date(s) listed above, the manager was observed underperforming in the following leadership and management area(s):",
      "coach_intro": "This issue was addressed through:",
      "expect": "The expectations for management performance were clearly communicated, and the manager was informed that continued underperformance may result in further corrective action, up to and including termination if uncorrected.",
      "ack": "By signing below, you acknowledge that this performance issue has been reviewed with you. This form is not a guarantee of termination or continued employment but serves as documentation that expectations have been communicated.",
      "signer": "Manager",
      "reasons": [
       {
        "label": "Failure to hold team members accountable to company standards and expectations",
        "section": "Leadership & Accountability",
        "sort": 10
       },
       {
        "label": "Failure to effectively coach, develop, or support team members",
        "section": "Leadership & Accountability",
        "sort": 20
       },
       {
        "label": "Failure to address performance concerns, policy violations, or behavioral issues appropriately",
        "section": "Leadership & Accountability",
        "sort": 30
       },
       {
        "label": "Failure to create and maintain a positive, professional, and accountable team culture",
        "section": "Leadership & Accountability",
        "sort": 40
       },
       {
        "label": "Lack of leadership presence, urgency, or engagement within the store",
        "section": "Leadership & Accountability",
        "sort": 50
       },
       {
        "label": "Failure to lead by example through attitude, professionalism, work ethic, or conduct",
        "section": "Leadership & Accountability",
        "sort": 60
       },
       {
        "label": "Poor communication with team members, peers, or supervisors",
        "section": "Leadership & Accountability",
        "sort": 70
       },
       {
        "label": "Failure to maintain quality, cleanliness, friendliness, speed, or accuracy standards",
        "section": "Operations & Standards",
        "sort": 80
       },
       {
        "label": "Failure to follow, model, or enforce company policies and procedures",
        "section": "Operations & Standards",
        "sort": 90
       },
       {
        "label": "Inconsistent execution of operational standards and expectations",
        "section": "Operations & Standards",
        "sort": 100
       },
       {
        "label": "Failure to ensure food safety, sanitation, or security standards are being followed",
        "section": "Operations & Standards",
        "sort": 110
       },
       {
        "label": "Failure to maintain an organized, prepared, and operationally sound store environment",
        "section": "Operations & Standards",
        "sort": 120
       },
       {
        "label": "Failure to appropriately staff, schedule, and manage labor in accordance with business needs and company expectations",
        "section": "Staffing, Scheduling & Time Management",
        "sort": 130
       },
       {
        "label": "Failure to monitor attendance, tardiness, or team accountability",
        "section": "Staffing, Scheduling & Time Management",
        "sort": 140
       },
       {
        "label": "Failure to properly train, develop, or onboard team members",
        "section": "Staffing, Scheduling & Time Management",
        "sort": 150
       },
       {
        "label": "Failure to follow the required management schedule expectations",
        "section": "Staffing, Scheduling & Time Management",
        "sort": 160
       },
       {
        "label": "Failure to maintain expected availability or leadership coverage",
        "section": "Staffing, Scheduling & Time Management",
        "sort": 170
       },
       {
        "label": "Mismanagement of labor, scheduling, or personal hours resulting in unnecessary overtime, labor inefficiencies, or inadequate store coverage",
        "section": "Staffing, Scheduling & Time Management",
        "sort": 180
       },
       {
        "label": "Failure to utilize scheduled time effectively and productively",
        "section": "Staffing, Scheduling & Time Management",
        "sort": 190
       },
       {
        "label": "Failure to appropriately prioritize administrative, operational, or leadership responsibilities",
        "section": "Staffing, Scheduling & Time Management",
        "sort": 200
       },
       {
        "label": "Failure to complete assigned administrative duties accurately or on time",
        "section": "Communication & Administrative Responsibilities",
        "sort": 210
       },
       {
        "label": "Failure to communicate important information to leadership or team members",
        "section": "Communication & Administrative Responsibilities",
        "sort": 220
       },
       {
        "label": "Failure to follow up on assigned projects, tasks, or action items",
        "section": "Communication & Administrative Responsibilities",
        "sort": 230
       },
       {
        "label": "Failure to respond to communications in a timely manner",
        "section": "Communication & Administrative Responsibilities",
        "sort": 240
       },
       {
        "label": "Poor decision-making impacting store operations, customer or team experience",
        "section": "Business Performance",
        "sort": 250
       },
       {
        "label": "Failure to appropriately manage labor, food cost, inventory, or controllable expenses",
        "section": "Business Performance",
        "sort": 260
       },
       {
        "label": "Failure to execute company initiatives, promotions, or directives",
        "section": "Business Performance",
        "sort": 270
       },
       {
        "label": "Failure to take ownership of store performance and results",
        "section": "Business Performance",
        "sort": 280
       },
       {
        "label": "Resistance to feedback, coaching, or direction",
        "section": "Professionalism",
        "sort": 290
       },
       {
        "label": "Unprofessional conduct, attitude, or communication",
        "section": "Professionalism",
        "sort": 300
       },
       {
        "label": "Attendance, punctuality, or reliability concerns impacting leadership responsibilities",
        "section": "Professionalism",
        "sort": 310
       },
       {
        "label": "Other",
        "section": "Professionalism",
        "sort": 320
       }
      ],
      "coaching": [
       {
        "label": "Verbal reminder",
        "sort": 10
       },
       {
        "label": "Performance coaching conversation",
        "sort": 20
       },
       {
        "label": "Corrective action meeting",
        "sort": 30
       },
       {
        "label": "Leadership development discussion",
        "sort": 40
       }
      ]
     }
    ];

    var _wt = { tpls:null, emps:[], cur:null };

    // own rpc wrapper, mirrors scRpc (js/09) + optional onerr per contract
    function wtRpc(name,args,cb,onerr){ withPin(function(pin){ supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){ if(r.error){ if(onerr)onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; } cb(r.data); }).catch(function(){ if(onerr)onerr({message:'Connection error'}); else alert('Connection error.'); }); }); }

    function wtEsc(s){ return (typeof escapeHtml==='function')?escapeHtml(String(s==null?'':s)):String(s==null?'':s); }
    function wtOv(){ var ov=document.getElementById('writeupTemplatesModal'); if(!ov){ ov=document.createElement('div'); ov.id='writeupTemplatesModal'; ov.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(ov); } ov.style.display='block'; return ov; }
    function wtClose(){ var ov=document.getElementById('writeupTemplatesModal'); if(ov) ov.style.display='none'; }
    function wtHeader(title,back){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;">'+(back?'<button onclick="'+back+'" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;">&#8249; Back</button>':'')+'<b style="flex:1;font-size:16px;">'+wtEsc(title)+'</b><button onclick="wtClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }
    function wtWrap(inner){ return '<div style="max-width:760px;margin:0 auto;padding:14px 16px 40px;">'+inner+'</div>'; }
    function wtMsg(txt,color){ return wtWrap('<div style="padding:26px 10px;text-align:center;color:'+(color||'#6b7686')+';font-size:14px;">'+txt+'</div>'); }

    // merge server templates over the verbatim fallback so a half-seeded DB
    // still renders complete forms
    function wtMerge(list){
        var byKey={}; (list||[]).forEach(function(t){ if(t&&t.key) byKey[t.key]=t; });
        return WT_FALLBACK.map(function(fb){
            var t=byKey[fb.key]; if(!t) return fb;
            var out={};
            ['key','label','title','intro','coach_intro','expect','ack','signer'].forEach(function(k){ out[k]=(t[k]!=null&&t[k]!=='')?t[k]:fb[k]; });
            out.reasons=(t.reasons&&t.reasons.length)?t.reasons:fb.reasons;
            out.coaching=(t.coaching&&t.coaching.length)?t.coaching:fb.coaching;
            return out;
        });
    }

    function openWriteupTemplates(){
        if(typeof isMgmt==='function' && !isMgmt()){ alert('Write-ups are for management only.'); return; }
        var ov=wtOv();
        ov.innerHTML=wtHeader('Write-Up Templates','')+wtMsg('Loading templates&hellip;');
        withPin(function(pin){
            Promise.all([
                supabaseClient.rpc('app_disc_tmpl_get',{p_username:currentUser.username,p_password:pin}),
                supabaseClient.rpc('app_discipline_employees',{p_username:currentUser.username,p_password:pin})
            ]).then(function(res){
                if(res[1].error){
                    var m=String(res[1].error.message||'');
                    ov.innerHTML=wtHeader('Write-Up Templates','')+wtMsg(m.indexOf('forbidden')>=0?'Managers only.':wtEsc(m),'#c0264b');
                    return;
                }
                _wt.emps=res[1].data||[];
                // template config is best-effort: fall back to the verbatim doc lists
                _wt.tpls=wtMerge((!res[0].error && res[0].data && res[0].data.templates)?res[0].data.templates:[]);
                wtRenderPicker();
            }).catch(function(){ ov.innerHTML=wtHeader('Write-Up Templates','')+wtMsg('Connection error.','#c0264b'); });
        }, function(){ ov.innerHTML=wtHeader('Write-Up Templates','')+wtMsg('PIN required.'); });
    }

    function wtBackToPicker(){ _wt.cur=null; wtRenderPicker(); }

    function wtCard(title,sub,onclick,accent){
        return '<div onclick="'+onclick+'" style="background:#fff;border:1px solid #e6e6ea;border-left:5px solid '+(accent||'#185FA5')+';border-radius:12px;padding:13px 15px;margin-bottom:10px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.05);">'+
            '<div style="font-size:15px;font-weight:800;color:#26242b;">'+title+'</div>'+
            '<div style="font-size:12.5px;color:#6b7686;margin-top:3px;">'+sub+'</div></div>';
    }

    function wtRenderPicker(){
        var ov=wtOv();
        var h='<div style="font-size:12.5px;background:#e8f2fb;color:#0d6eaf;border-radius:8px;padding:8px 11px;margin-bottom:12px;">Pick the form that matches the person&rsquo;s role. Every write-up lands in the same employee discipline record, with signatures and history.</div>';
        h+=wtCard('&#128203; General (original forms)','Verbal warning, written warning, write-up, or termination — the existing disciplinary forms.','wtOpenGeneral()','#8a1f1f');
        var accents={crew:'#185FA5',trainer:'#1f7a3d',shiftlead:'#b8860b',mgmt:'#7d1d4b'};
        var emoji={crew:'&#127848;',trainer:'&#127891;',shiftlead:'&#11088;',mgmt:'&#128188;'};
        (_wt.tpls||[]).forEach(function(t){
            h+=wtCard((emoji[t.key]||'&#128221;')+' '+wtEsc(t.label),wtEsc(t.title)+' &middot; '+((t.reasons||[]).length)+' checkbox reasons',"wtOpenTmpl('"+t.key+"')",accents[t.key]||'#185FA5');
        });
        h+='<div style="font-size:11.5px;color:#6b7686;margin-top:8px;">Admins can edit every reason list and all form wording in Business Settings (groups disc_tmpl_&hellip;).</div>';
        ov.innerHTML=wtHeader('Write-Up Templates','')+wtWrap(h);
        ov.scrollTop=0;
    }

    function wtOpenGeneral(){ wtClose(); if(typeof openDiscipline==='function') openDiscipline(); else alert('The general disciplinary form is unavailable.'); }
    function wtOpenTmpl(key){
        var t=null; (_wt.tpls||[]).forEach(function(x){ if(x.key===key) t=x; });
        if(!t) return;
        _wt.cur=t; wtRenderForm();
    }

    // signature pad markup — reuse js/06 discPad when present (same .disc-pad
    // canvas contract that discInitPad expects)
    function wtPadHtml(role){
        if(typeof discPad==='function') return discPad(role);
        return '<div style="background:#faf7f2;border-radius:9px;padding:8px;margin-bottom:7px;"><div style="font-size:12px;color:#6b7686;margin-bottom:4px;">'+wtEsc(role)+'</div><canvas class="disc-pad" data-role="'+wtEsc(role)+'" style="width:100%;height:70px;background:#fff;border:1px solid #cfcfcf;border-radius:7px;touch-action:none;display:block;cursor:crosshair;"></canvas></div>';
    }
    function wtInitPads(){
        var body=document.getElementById('wtFormBody'); if(!body) return;
        body.querySelectorAll('canvas.disc-pad').forEach(function(cv){
            if(typeof discInitPad==='function'){ discInitPad(cv); return; }
            // minimal fallback (same behavior as discInitPad)
            var ctx=cv.getContext('2d'),draw=false; cv.width=cv.offsetWidth; cv.height=cv.offsetHeight; ctx.strokeStyle='#222'; ctx.lineWidth=2; ctx.lineCap='round'; ctx.lineJoin='round';
            function pos(e){ var r=cv.getBoundingClientRect(); var p=e.touches?e.touches[0]:e; return [p.clientX-r.left,p.clientY-r.top]; }
            cv.addEventListener('pointerdown',function(e){ draw=true; cv._has=true; var p=pos(e); ctx.beginPath(); ctx.moveTo(p[0],p[1]); e.preventDefault(); });
            cv.addEventListener('pointermove',function(e){ if(!draw)return; var p=pos(e); ctx.lineTo(p[0],p[1]); ctx.stroke(); e.preventDefault(); });
            window.addEventListener('pointerup',function(){ draw=false; });
        });
    }
    function wtCollectSigs(){ var out={}; document.querySelectorAll('#wtFormBody canvas.disc-pad').forEach(function(cv){ if(cv._has){ out[cv.getAttribute('data-role')]=cv.toDataURL('image/png'); } }); return out; }

    function wtRenderForm(){
        var t=_wt.cur; if(!t) return;
        var ov=wtOv();
        var lab='font-size:13px;font-weight:bold;color:#555;display:block;margin:14px 0 5px;';
        var inp='width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;font-size:14px;box-sizing:border-box;';
        var chip='display:inline-flex;align-items:center;gap:5px;font-size:12.5px;border:1px solid #cfcfcf;border-radius:8px;padding:5px 9px;margin:0 6px 6px 0;';
        var h='';
        h+='<div style="font-size:12.5px;background:#e8f2fb;color:#0d6eaf;border-radius:8px;padding:7px 10px;"><b>'+wtEsc(t.title)+'</b></div>';

        h+='<label style="'+lab+'">Employee</label><select id="wtEmp" style="'+inp+'"><option value="">&mdash; Select employee &mdash;</option>'+(_wt.emps||[]).map(function(e){
            return '<option value="'+e.id+'">'+wtEsc(e.name)+(e.location?' ('+wtEsc(e.location)+')':'')+(e.open>0?'  &bull;  '+e.open+' on file':'')+'</option>';
        }).join('')+'</select>';

        h+='<label style="'+lab+'">Date(s) of incident(s)</label><input type="date" id="wtDate" style="'+inp+'">';

        h+='<label style="'+lab+'">Description of Performance Concern</label>';
        if(t.intro) h+='<div style="font-size:12px;color:#6b7686;margin-bottom:7px;">'+wtEsc(t.intro)+'</div>';
        var lastSection=null, rh='';
        (t.reasons||[]).forEach(function(r){
            var sec=String(r.section||'');
            if(sec!==lastSection){
                if(sec) rh+='<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#185FA5;margin:'+(lastSection===null?'2px':'12px')+' 0 6px;">'+wtEsc(sec)+'</div>';
                lastSection=sec;
            }
            var isOther=(String(r.label).trim().toLowerCase()==='other');
            rh+='<label style="display:flex;align-items:flex-start;gap:8px;font-size:12.5px;color:#333;border:1px solid #e3e3e3;border-radius:8px;padding:7px 10px;margin:0 0 6px;cursor:pointer;background:#fff;"><input type="checkbox" value="'+wtEsc(r.label)+'" style="margin-top:2px;flex-shrink:0;"'+(isOther?' onchange="wtToggleOther(this)"':'')+'><span>'+wtEsc(r.label)+'</span></label>';
        });
        h+='<div id="wtReasons">'+rh+'</div>';
        h+='<div id="wtOtherWrap" style="display:none;margin-top:2px;"><input type="text" id="wtOtherTxt" placeholder="Describe the other concern&hellip;" style="'+inp+'"></div>';

        h+='<label style="'+lab+'">Additional details</label><textarea id="wtDetails" rows="3" placeholder="Describe what was observed and the expectation set." style="'+inp+'resize:vertical;"></textarea>';

        h+='<label style="'+lab+'">Coaching and Communication</label>';
        if(t.coach_intro) h+='<div style="font-size:12px;color:#6b7686;margin-bottom:7px;">'+wtEsc(t.coach_intro)+'</div>';
        h+='<div id="wtCoach">'+(t.coaching||[]).map(function(c){
            return '<label style="'+chip+'"><input type="checkbox" value="'+wtEsc(c.label)+'">'+wtEsc(c.label)+'</label>';
        }).join('')+'</div>';
        h+='<label style="'+lab+'">Prior conversations/coaching occurred on</label><input type="text" id="wtPrior" placeholder="Dates of earlier conversations (optional)" style="'+inp+'">';

        if(t.expect) h+='<div style="font-size:12px;background:#fbf1df;color:#8a5a00;border-radius:8px;padding:8px 11px;margin-top:12px;line-height:1.5;">'+wtEsc(t.expect)+'</div>';

        h+='<label style="'+lab+'">Recommended action</label><div style="font-size:11.5px;color:#6b7686;margin-bottom:4px;">This sets the level in the discipline record: Written warning or Write-up.</div>';
        h+='<div><label style="'+chip+'"><input type="radio" name="wtRec" value="Only Written Warning">Only written warning</label><label style="'+chip+'"><input type="radio" name="wtRec" value="Write-Up" checked>Write-up</label></div>';

        h+='<label style="'+lab+'">'+wtEsc(t.signer)+' comments (optional)</label><textarea id="wtEmpStmt" rows="2" placeholder="Their response, in their words." style="'+inp+'resize:vertical;"></textarea>';

        h+='<label style="'+lab+'">Acknowledgment of Write-Up</label>';
        if(t.ack) h+='<div style="font-size:12px;color:#6b7686;margin-bottom:7px;line-height:1.5;">'+wtEsc(t.ack)+'</div>';
        h+=wtPadHtml(t.signer)+wtPadHtml('Supervisor');

        h+='<button id="wtSubmitBtn" onclick="wtSubmit()" style="width:100%;background:#8a1f1f;color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:800;cursor:pointer;margin-top:14px;">Submit '+wtEsc(t.label)+' write-up</button>';

        ov.innerHTML=wtHeader(t.label+' Write-Up','wtBackToPicker()')+wtWrap('<div id="wtFormBody" style="background:#fff;border-radius:12px;padding:14px 16px;box-shadow:0 1px 4px rgba(0,0,0,.06);">'+h+'</div>');
        ov.scrollTop=0;
        try{ document.getElementById('wtDate').value=new Date().toISOString().slice(0,10); }catch(e){}
        wtInitPads();
    }

    function wtToggleOther(cb){ var w=document.getElementById('wtOtherWrap'); if(w) w.style.display=cb.checked?'block':'none'; }

    function wtSubmit(){
        var t=_wt.cur; if(!t) return;
        var id=document.getElementById('wtEmp').value;
        if(!id){ alert('Please select an employee.'); return; }
        var reasons=[];
        document.querySelectorAll('#wtReasons input[type=checkbox]').forEach(function(c){ if(c.checked) reasons.push(c.value); });
        if(!reasons.length){ alert('Check at least one performance concern.'); return; }
        var otherEl=document.getElementById('wtOtherTxt');
        var otherTxt=otherEl?String(otherEl.value||'').trim():'';
        if(otherTxt){ reasons=reasons.map(function(r){ return (String(r).trim().toLowerCase()==='other')?('Other: '+otherTxt):r; }); }
        var coach=[];
        document.querySelectorAll('#wtCoach input[type=checkbox]').forEach(function(c){ if(c.checked) coach.push(c.value); });
        var prior=String((document.getElementById('wtPrior')||{}).value||'').trim();
        var details=String((document.getElementById('wtDetails')||{}).value||'').trim();
        var empStmt=String((document.getElementById('wtEmpStmt')||{}).value||'').trim();
        var date=document.getElementById('wtDate').value||null;
        var recEl=document.querySelector('input[name=wtRec]:checked');
        var rec=recEl?recEl.value:'Write-Up';
        var lvl=(rec==='Write-Up')?'final':'written';
        var lvlName=(typeof discLevelMeta==='function')?discLevelMeta(lvl).label:(lvl==='final'?'Write-Up':'Written Warning');
        var sigs=wtCollectSigs();
        if(!sigs[t.signer]){ if(!confirm('No '+t.signer+' signature captured yet. Submit anyway?')) return; }
        if(!confirm('Submit '+t.title+' for this employee?')) return;

        var emp=null; (_wt.emps||[]).forEach(function(e){ if(String(e.id)===String(id)) emp=e; });
        var empName=emp?String(emp.name||''):'';
        var empStore=emp?String(emp.location||''):'';

        var fd={ form:'writeup', template:t.key, template_label:t.label, violations:reasons,
                 other_detail:otherTxt, coaching:coach, prior_coaching:prior, recommended_action:rec };
        var cat=t.label+' Performance';

        var btn=document.getElementById('wtSubmitBtn'); var old=btn.textContent;
        btn.disabled=true; btn.textContent='Generating PDF...';

        var doCreate=function(pdfUrl){
            btn.textContent='Submitting...';
            wtRpc('app_discipline_create_v2',{
                p_employee_id:parseInt(id,10), p_level:lvl, p_category:cat,
                p_company_statement:details, p_employee_statement:empStmt,
                p_action_date:date, p_signatures:sigs, p_form_data:fd,
                p_pdf_url:(pdfUrl||null), p_form_type:'writeup'
            }, function(){
                btn.disabled=false; btn.textContent=old;
                try{ if(typeof G_URL!=='undefined') fetch(G_URL+'?action=discipline_notify&level='+encodeURIComponent(lvl)+'&by='+encodeURIComponent(currentUser.name||currentUser.username),{mode:'no-cors'}); }catch(e){}
                alert(t.title+' submitted. It is filed in the employee\u2019s discipline record.'+(pdfUrl?' Signed PDF filed to Dropbox.':''));
                openWriteupTemplates(); // refresh counts + back to the picker
            }, function(err){
                btn.disabled=false; btn.textContent=old;
                alert(String(err.message||'').indexOf('forbidden')>=0?'Managers only.':(err.message||'Could not submit.'));
            });
        };

        // signed-PDF pipeline (js/06). If unavailable, save without a PDF.
        if(typeof hubHrReportHtml==='function' && typeof hubGenHrPdf==='function'){
            var flds=[['Form',t.title],['Template',t.label],['Employee',empName],['Store',empStore],
                      ['Date(s) of incident(s)',date||''],['Level',lvlName],['Category',cat],
                      ['Performance concerns',reasons.join('; ')],
                      ['Coaching provided',coach.join('; ')||'—'],
                      ['Prior conversations/coaching',prior||'—'],
                      ['Recommended action',rec],
                      ['Issued by',currentUser.name||currentUser.username]];
            var stmts=[['Additional Details',details],['Expectations Communicated',t.expect||''],[t.signer+' Comments',empStmt]];
            var html=hubHrReportHtml(t.title,'#8a1f1f',flds,stmts,sigs);
            var fileName=(date||new Date().toISOString().slice(0,10))+' - '+t.label+' '+lvlName+'.pdf';
            hubGenHrPdf('Disciplinary',empStore,empName,fileName,html,doCreate);
        } else {
            doCreate('');
        }
    }
