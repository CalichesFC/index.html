    // ============================================================
    // DISCIPLINARY ACTIONS
    // ============================================================
    function isDiscAdmin(){ return currentUser && (currentUser.role==='Admin Manager' || currentUser.role==='Vice President/Co-Owner' || currentUser.is_developer===true); }
    function discSafe(s){ return String(s===null||s===undefined?'':s).replace(/['"\\<>&]/g,''); }
    function discLevelMeta(l){
        switch(l){
            case 'verbal': return {label:'Verbal Warning', color:'#b8860b'};
            case 'written': return {label:'Written Warning', color:'#d9730d'};
            case 'final': return {label:'Write-Up', color:'#c0392b'};
            case 'termination': return {label:'Termination', color:'#7a1010'};
            default: return {label:l||'', color:'#888'};
        }
    }
    function discFillLevels(suggested){
        var sel=document.getElementById('discLevel'); if(!sel) return;
        var admin=isDiscAdmin();
        var opts=admin ? ['verbal','written','final','termination'] : ['verbal','written'];
        var pick=(suggested && opts.indexOf(suggested)>-1) ? suggested : opts[0];
        sel.innerHTML=opts.map(function(l){ var m=discLevelMeta(l); return '<option value="'+l+'"'+(l===pick?' selected':'')+'>'+m.label+'</option>'; }).join('');
    }
    function openDiscipline(){
        if(typeof isMgmt==='function' && !isMgmt()){ alert('Disciplinary Actions are for management only.'); return; }
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        document.getElementById('disciplineView').style.display='block';
        window.scrollTo(0,0);
        document.getElementById('discStanding').style.display='none';
        var b=document.getElementById('discCountBadge'); if(b) b.style.display='none';
        discInitForms();
        discLoadEmployees();
        discLoadFeed();
    }
    function discLoadEmployees(){
        var sel=document.getElementById('discEmp');
        withPin(function(pin){
            supabaseClient.rpc('app_discipline_employees',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; sel.innerHTML='<option value="">Could not load</option>'; return; }
                var list=r.data||[];
                window._discEmps=list; /* cached so the PIP picker card can pass name/location to openPip */
                sel.innerHTML='<option value="">— Select employee —</option>'+list.map(function(e){
                    return '<option value="'+e.id+'">'+escapeHtml(e.name)+(e.location?' ('+escapeHtml(e.location)+')':'')+(e.open>0?'  •  '+e.open+' on file':'')+'</option>';
                }).join('');
            }).catch(function(){ sel.innerHTML='<option value="">Connection error</option>'; });
        }, function(){ sel.innerHTML='<option value="">PIN required</option>'; });
    }
    function discEmpChange(){
        var id=document.getElementById('discEmp').value;
        var box=document.getElementById('discStanding');
        var badge=document.getElementById('discCountBadge');
        if(!id){ box.style.display='none'; if(badge) badge.style.display='none'; return; }
        withPin(function(pin){
            supabaseClient.rpc('app_discipline_history',{p_username:currentUser.username,p_password:pin,p_employee_id:parseInt(id,10)}).then(function(r){
                if(r.error){ box.style.display='none'; if(badge) badge.style.display='none'; return; }
                var d=r.data||{}; var c=d.counts||{};
                var total=(c.verbal||0)+(c.written||0)+(c.final||0);
                // Suggested next step never escalates to termination (that is a separate admin assessment).
                var nx=d.next_level; if(nx==='termination') nx='final';
                var m=discLevelMeta(nx);
                box.style.display='block';
                box.innerHTML='On file: '+(c.verbal||0)+' verbal, '+(c.written||0)+' written, '+(c.final||0)+' write-up.'+
                    ' &nbsp;Suggested next step: <b style="color:'+m.color+';">'+m.label+'</b>'+
                    ' &nbsp;<a href="#" onclick="openDiscHistory('+id+',\''+discSafe((d.employee&&d.employee.name)||'')+'\');return false;" style="color:#0d6eaf;">View full history</a>';
                if(badge){
                    badge.style.display='block';
                    var num=document.getElementById('discCountNum'), lbl=document.getElementById('discCountLbl');
                    num.textContent=total;
                    if(total===0){ badge.style.background='#e7f6ec'; badge.style.borderColor='#b6e0c2'; num.style.color='#1f7a3d'; lbl.style.color='#1f7a3d'; lbl.textContent='no priors'; }
                    else { badge.style.background='#fdeaea'; badge.style.borderColor='#e8b4b4'; num.style.color='#c0264b'; lbl.style.color='#c0264b'; lbl.textContent=(total===1?'prior on file':'priors on file'); }
                }
            });
        });
    }
    function discLoadFeed(){
        var c=document.getElementById('discFeed');
        withPin(function(pin){
            supabaseClient.rpc('app_discipline_feed',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; c.innerHTML='<p style="color:red;font-size:13px;">Could not load.</p>'; return; }
                var list=r.data||[];
                if(!list.length){ c.innerHTML='<p style="color:#6b7686;font-size:13px;margin:0;">No actions on record yet.</p>'; return; }
                c.innerHTML=list.map(function(a,i){
                    var m=discLevelMeta(a.level);
                    var voided=(a.status!=='active');
                    return '<div style="padding:10px 0;'+(i<list.length-1?'border-bottom:1px solid #eee;':'')+(voided?'opacity:0.55;':'')+'">'+
                        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'+
                          '<span style="font-weight:bold;color:#333;font-size:14px;cursor:pointer;" onclick="openDiscHistory('+a.employee_id+',\''+discSafe(a.employee||'')+'\')">'+escapeHtml(a.employee||'')+'</span>'+
                          '<span style="background:'+m.color+';color:#fff;border-radius:10px;padding:2px 9px;font-size:11px;font-weight:bold;white-space:nowrap;">'+m.label+(voided?' (voided)':'')+'</span>'+
                        '</div>'+
                        '<div style="font-size:12.5px;color:#666;margin-top:3px;">'+escapeHtml(a.category||'')+(a.date?' • '+escapeHtml(a.date):'')+(a.by?' • by '+escapeHtml(a.by):'')+(a.location?' • '+escapeHtml(a.location):'')+'</div>'+
                    '</div>';
                }).join('');
            }).catch(function(){ c.innerHTML='<p style="color:red;font-size:13px;">Connection error.</p>'; });
        }, function(){ c.innerHTML='<p style="color:#6b7686;font-size:13px;">PIN required.</p>'; });
    }
    // ===== Multi-form disciplinary builder (verbal / write-up / final / termination) =====
    var discCurForm='written';
    // Written and Write-up are the SAME Disciplinary Action Form; the form's radio
    // (Only Written Warning vs Write-Up) decides the level on submit.
    var DISC_FORMS={
        verbal:{level:'verbal',title:'Notice of Verbal Warning',label:'Verbal',reasons:['Performance','Conduct/Behavior','Carelessness','Dress Code','Attendance/Tardies','Other'],sigs:['Employee','Shift Lead','Store Manager']},
        written:{level:'written',title:'Disciplinary Action Form',label:'Written',reasons:['Carelessness','Attendance','Dress Code','Conduct','Other'],rec:true,recDefault:'Only Written Warning',sigs:['Employee','Shift Leader','Store Manager']},
        writeup:{level:'final',title:'Disciplinary Action Form',label:'Write-up',reasons:['Carelessness','Attendance','Dress Code','Conduct','Other'],rec:true,recDefault:'Write-Up',sigs:['Employee','Shift Leader','Store Manager']},
        termination:{level:'termination',title:'Termination Assessment',label:'Termination',admin:true,term:true,sigs:['Manager']}
    };
    function discInitForms(){
        var admin=(typeof isDiscAdmin==='function' && isDiscAdmin());
        if(DISC_FORMS[discCurForm].admin && !admin) discCurForm='written';
        var picker=document.getElementById('discFormPicker'); if(!picker) return;
        picker.innerHTML=['verbal','written','writeup','termination'].map(function(k){
            var f=DISC_FORMS[k]; var dis=(f.admin&&!admin);
            return '<button type="button" onclick="discSetForm(\''+k+'\')"'+(dis?' disabled':'')+' style="flex:1;min-width:80px;border:1px solid #cfcfcf;background:'+(k===discCurForm?'#8a1f1f':'#fff')+';color:'+(k===discCurForm?'#fff':(dis?'#bbb':'#555'))+';border-radius:8px;padding:8px 6px;font-size:12px;font-weight:bold;cursor:'+(dis?'not-allowed':'pointer')+';">'+f.label+(f.admin?' · admin':'')+'</button>';
        }).join('');
        /* 5th card: PIP (admin only — same gate as termination). Opens the existing PIP modal for the selected employee. */
        if(admin) picker.innerHTML+='<button type="button" onclick="discOpenPip()" style="flex-basis:100%;border:1px solid #b4264b;background:#fff;color:#b4264b;border-radius:8px;padding:8px 6px;font-size:12px;font-weight:bold;cursor:pointer;">&#128200; Performance Improvement Plan (PIP) · admin</button>';
        discRenderForm();
    }
    function discOpenPip(){
        if(!(typeof isDiscAdmin==='function' && isDiscAdmin())){ alert('PIPs can only be started by Admin Managers.'); return; }
        var sel=document.getElementById('discEmp');
        var id=sel?parseInt(sel.value,10):0;
        if(!id){ alert('Pick the employee first.'); return; }
        var emp=null, list=window._discEmps||[];
        for(var i=0;i<list.length;i++){ if(String(list[i].id)===String(id)){ emp=list[i]; break; } }
        var nm=emp?String(emp.name||''):String((sel.options[sel.selectedIndex]||{}).text||'').replace(/\s*\(.*$/,'').trim();
        if(typeof openPip==='function') openPip(id, nm, (emp&&emp.location)?String(emp.location):'', '');
    }
    function discSetForm(k){ if(DISC_FORMS[k].admin && !(typeof isDiscAdmin==='function' && isDiscAdmin())){ alert('Final warnings and termination can only be issued by Admin Managers.'); return; } discCurForm=k; discInitForms(); }
    function discPad(role){ return '<div style="background:#faf7f2;border-radius:9px;padding:8px;margin-bottom:7px;"><div style="font-size:12px;color:#6b7686;margin-bottom:4px;">'+escapeHtml(role)+'</div><canvas class="disc-pad" data-role="'+escapeHtml(role)+'" style="width:100%;height:70px;background:#fff;border:1px solid #cfcfcf;border-radius:7px;touch-action:none;display:block;cursor:crosshair;"></canvas><div style="text-align:right;margin-top:3px;"><button type="button" onclick="discClearPad(this)" style="background:#eee;border:none;border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;">Clear</button></div></div>'; }
    function discClearPad(btn){ var box=btn.parentNode.parentNode; var cv=box.querySelector('canvas'); if(cv){ cv.getContext('2d').clearRect(0,0,cv.width,cv.height); cv._has=false; } }
    function discInitPad(cv){ var ctx=cv.getContext('2d'),draw=false; cv.width=cv.offsetWidth; cv.height=cv.offsetHeight; ctx.strokeStyle='#222'; ctx.lineWidth=2; ctx.lineCap='round'; ctx.lineJoin='round';
        function pos(e){ var r=cv.getBoundingClientRect(); var t=e.touches?e.touches[0]:e; return [t.clientX-r.left,t.clientY-r.top]; }
        cv.addEventListener('pointerdown',function(e){ draw=true; cv._has=true; var p=pos(e); ctx.beginPath(); ctx.moveTo(p[0],p[1]); e.preventDefault(); });
        cv.addEventListener('pointermove',function(e){ if(!draw)return; var p=pos(e); ctx.lineTo(p[0],p[1]); ctx.stroke(); e.preventDefault(); });
        window.addEventListener('pointerup',function(){ draw=false; });
    }
    function discRenderForm(){
        var f=DISC_FORMS[discCurForm]; var lab='font-size:13px;font-weight:bold;color:#555;display:block;margin:10px 0 5px;'; var inp='width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;font-size:14px;'; var h='';
        h+='<div style="font-size:12.5px;background:'+(f.admin?'#fbf1df':'#e8f2fb')+';color:'+(f.admin?'#8a5a00':'#0d6eaf')+';border-radius:8px;padding:7px 10px;"><b>'+f.title+'</b>'+(f.admin?' · Admin Managers only':'')+'</div>';
        h+='<label style="'+lab+'">Date</label><input type="date" id="discFDate" style="'+inp+'">';
        if(f.term){
            h+='<label style="'+lab+'">Separation reason</label><div id="discSep">'+['Voluntary (attach resignation)','Indefinite layoff','Reduction-in-force','Contract expiration','Involuntary (explain)'].map(function(r,i){return '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;border:1px solid #cfcfcf;border-radius:8px;padding:5px 9px;margin:0 6px 6px 0;"><input type="radio" name="discSep" value="'+escapeHtml(r)+'"'+(i===4?' checked':'')+'>'+r+'</label>';}).join('')+'</div>';
            h+='<label style="'+lab+'">Final employee assessment</label><div style="overflow-x:auto;-webkit-overflow-scrolling:touch;"><table id="discMx" style="min-width:480px;border-collapse:collapse;font-size:12px;border:1px solid #eee;"><tr style="background:#f7f3ee;"><th style="padding:6px 9px;text-align:left;">Criteria</th><th>Unsat.</th><th>Fair</th><th>Satis.</th><th>Good</th><th>Exc.</th></tr>'+['Punctuality','Cooperation','Initiative','Job knowledge','Quality of work'].map(function(c,i){var t='<td style="padding:6px 9px;font-weight:bold;">'+c+'</td>';for(var j=0;j<5;j++)t+='<td style="text-align:center;border-top:1px solid #eee;"><input type="radio" name="discMx'+i+'" value="'+['Unsatisfactory','Fair','Satisfactory','Good','Excellent'][j]+'"></td>';return '<tr>'+t+'</tr>';}).join('')+'</table></div>';
            h+='<div style="display:flex;gap:10px;"><div style="flex:1;"><label style="'+lab+'">Eligible for re-hire?</label><select id="discRehire" style="'+inp+'"><option>No</option><option>Yes</option></select></div><div style="flex:1;"><label style="'+lab+'">Property returned?</label><select id="discProp" style="'+inp+'"><option>Yes</option><option>No</option></select></div></div>';
            h+='<label style="'+lab+'">Comments</label><textarea id="discComments" rows="2" style="'+inp+'resize:vertical;"></textarea>';
        } else {
            h+='<label style="'+lab+'">'+(discCurForm==='written'?'Violation':'Reason(s)')+'</label><div id="discReasons">'+f.reasons.map(function(r){return '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;border:1px solid #cfcfcf;border-radius:8px;padding:5px 9px;margin:0 6px 6px 0;"><input type="checkbox" value="'+escapeHtml(r)+'">'+r+'</label>';}).join('')+'</div>';
            if(f.rec){ var rd=f.recDefault||'Write-Up'; h+='<label style="'+lab+'">Recommended action</label><div id="discRec" style="font-size:11.5px;color:#6b7686;margin-bottom:2px;">This sets the level: Written warning or Write-up.</div><div><label style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;border:1px solid #cfcfcf;border-radius:8px;padding:5px 9px;margin-right:6px;"><input type="radio" name="discRec" value="Only Written Warning"'+(rd==='Only Written Warning'?' checked':'')+'>Only written warning</label><label style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;border:1px solid #cfcfcf;border-radius:8px;padding:5px 9px;"><input type="radio" name="discRec" value="Write-Up"'+(rd==='Write-Up'?' checked':'')+'>Write-up</label></div>'; }
            h+='<label style="'+lab+'">Company statement</label><textarea id="discCompany" rows="3" placeholder="Describe the incident and the expectation set." style="'+inp+'resize:vertical;"></textarea>';
            h+='<div style="font-size:12px;background:#e8f2fb;color:#0d6eaf;border-radius:8px;padding:7px 10px;margin-top:8px;">The employee can add their own statement before signing.</div>';
            h+='<label style="'+lab+'">Employee statement</label><textarea id="discEmpStmt" rows="2" placeholder="Employee response (optional)." style="'+inp+'resize:vertical;"></textarea>';
        }
        h+='<label style="'+lab+'">'+(f.term?'Prepared by &amp; signature':'Signatures')+'</label>'+f.sigs.map(discPad).join('');
        var body=document.getElementById('discFormBody'); body.innerHTML=h;
        try{ document.getElementById('discFDate').value=new Date().toISOString().slice(0,10); }catch(e){}
        body.querySelectorAll('canvas.disc-pad').forEach(discInitPad);
    }
    function discCollectSigs(){ var out={}; document.querySelectorAll('#discFormBody canvas.disc-pad').forEach(function(cv){ if(cv._has){ out[cv.getAttribute('data-role')]=cv.toDataURL('image/png'); } }); return out; }
    // ===== HR signed-PDF generation (files to Dropbox Store/Employee folder via Apps Script) =====
    function hubHrReportHtml(title, color, fields, statements, sigs){
        var h=(typeof getBrandHeader==='function')?getBrandHeader(title,color):('<div style="font-family:Helvetica Neue,Helvetica,Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px;background:#fff;"><h1 style="color:'+color+';margin:0 0 18px;font-weight:800;">'+escapeHtml(title)+'</h1>');
        h+='<p style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:'+color+';font-weight:700;margin:0 0 20px;">Caliche&#39;s Frozen Custard &amp; More &mdash; Confidential HR Document</p>';
        function sec(label){ return '<div style="font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#444;border-bottom:2px solid '+color+';padding-bottom:5px;margin:0 0 12px;">'+escapeHtml(label)+'</div>'; }
        h+=sec('Details');
        h+='<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">';
        (fields||[]).forEach(function(f){ h+='<tr><td style="padding:8px 10px;font-weight:700;color:#555;width:36%;border-bottom:1px solid #ececec;vertical-align:top;">'+escapeHtml(f[0])+'</td><td style="padding:8px 10px;border-bottom:1px solid #ececec;color:#222;">'+escapeHtml(f[1]||'—')+'</td></tr>'; });
        h+='</table>';
        (statements||[]).forEach(function(s){ h+='<div style="margin-bottom:20px;">'+sec(s[0])+'<div style="font-size:13px;line-height:1.65;color:#222;white-space:pre-wrap;min-height:46px;border:1px solid #ececec;border-radius:6px;padding:11px 13px;background:#fafafa;">'+(s[1]?escapeHtml(s[1]):'<span style="color:#6b7686;">(none provided)</span>')+'</div></div>'; });
        var roles=Object.keys(sigs||{}); var cells=roles.length?roles:['Signature'];
        h+='<div style="margin-top:8px;">'+sec('Acknowledgement &amp; Signatures')+'</div>';
        h+='<table style="width:100%;border-collapse:collapse;margin-top:6px;"><tr>';
        cells.forEach(function(role){ var img=(sigs&&sigs[role])?('<img src="'+sigs[role]+'" style="height:44px;max-width:96%;display:block;margin-bottom:2px;">'):'<div style="height:44px;"></div>'; h+='<td style="vertical-align:bottom;padding:0 14px 0 0;width:'+Math.floor(100/cells.length)+'%;">'+img+'<div style="border-top:1.5px solid #333;padding-top:5px;font-size:11px;color:#666;line-height:1.5;"><b style="color:#222;">'+escapeHtml(role)+'</b><br>Date: _______________</div></td>'; });
        h+='</tr></table>';
        h+='<p style="margin-top:34px;font-size:10px;color:#6b7686;text-align:center;border-top:1px solid #eee;padding-top:12px;line-height:1.6;">This document was generated by Caliche&#39;s Hub on '+escapeHtml(new Date().toLocaleString())+'. It is a confidential HR record &mdash; distribution is limited to authorized management.</p>';
        h+='</div>';
        return h;
    }
    function hubGenHrPdf(category, store, employee, fileName, html, cb){
        var done=false; var to=setTimeout(function(){ if(!done){ done=true; cb(''); } }, 16000);
        try{
            var body=new URLSearchParams(); body.append('action','hr_pdf'); body.append('category',category||'Disciplinary'); body.append('store',store||''); body.append('employee',employee||''); body.append('fileName',fileName||'HR_Document'); body.append('ReportHTML',html||'');
            fetch(G_URL,{method:'POST',body:body}).then(function(r){return r.json();}).then(function(j){ if(done)return; done=true; clearTimeout(to); cb((j&&(j.pdfUrl||j.url))||''); }).catch(function(){ if(done)return; done=true; clearTimeout(to); cb(''); });
        }catch(e){ if(!done){ done=true; clearTimeout(to); cb(''); } }
    }
    function hubEmpStore(sel){ try{ var t=(sel.options[sel.selectedIndex].text)||''; var store=''; var m=t.match(/\(([^)]+)\)/); if(m) store=m[1].trim(); var name=t.split(' (')[0].split('  •')[0].trim(); return {name:name, store:store}; }catch(e){ return {name:'',store:''}; } }
    function discSubmitForm(){
        var id=document.getElementById('discEmp').value;
        if(!id){ alert('Please select an employee.'); return; }
        var f=DISC_FORMS[discCurForm];
        var lvl=f.level;
        var date=document.getElementById('discFDate').value||null;
        var sigs=discCollectSigs();
        var fd={ form:discCurForm }; var cat='Other'; var company=''; var empStmt='';
        if(f.term){
            var sep=document.querySelector('#discSep input:checked'); fd.separation_reason=sep?sep.value:'';
            var ratings={}; ['Punctuality','Cooperation','Initiative','Job knowledge','Quality of work'].forEach(function(c,i){ var rr=document.querySelector('input[name=discMx'+i+']:checked'); ratings[c]=rr?rr.value:''; }); fd.ratings=ratings;
            fd.eligible_rehire=document.getElementById('discRehire').value; fd.property_returned=document.getElementById('discProp').value;
            company=document.getElementById('discComments').value.trim(); cat='Termination';
        } else {
            var reasons=[]; document.querySelectorAll('#discReasons input:checked').forEach(function(c){ reasons.push(c.value); }); fd.violations=reasons; if(reasons.length) cat=reasons[0];
            if(f.rec){ var rec=document.querySelector('input[name=discRec]:checked'); fd.recommended_action=rec?rec.value:''; lvl=(rec && rec.value==='Write-Up')?'final':'written'; }
            company=document.getElementById('discCompany').value.trim();
            empStmt=document.getElementById('discEmpStmt').value.trim();
        }
        if(!f.term && !sigs['Employee']){ if(!confirm('No employee signature captured yet. Submit anyway?')) return; }
        var lvlName=discLevelMeta(lvl).label;
        if(!confirm('Submit '+f.title+' for this employee?')) return;
        var btn=document.getElementById('discSubmitBtn'); btn.disabled=true; var old=btn.textContent; btn.textContent='Generating PDF...';
        var es=hubEmpStore(document.getElementById('discEmp'));
        var flds=[['Form',f.title],['Employee',es.name],['Store',es.store],['Date',date||''],['Level',lvlName],['Category',cat]];
        if(fd.violations&&fd.violations.length) flds.push(['Violation / Reason',fd.violations.join(', ')]);
        if(fd.recommended_action) flds.push(['Recommended action',fd.recommended_action]);
        if(fd.separation_reason) flds.push(['Separation reason',fd.separation_reason]);
        if(f.term&&fd.ratings){ Object.keys(fd.ratings).forEach(function(k){ if(fd.ratings[k]) flds.push(['Rating: '+k,fd.ratings[k]]); }); }
        flds.push(['Issued by',currentUser.name||currentUser.username]);
        var html=hubHrReportHtml(f.title,(f.term?'#7a1010':'#8a1f1f'),flds,[['Company Statement',company],['Employee Statement',empStmt]],sigs);
        var fileName=(date||new Date().toISOString().slice(0,10))+' - '+lvlName+'.pdf';
        var doCreate=function(pdfUrl){
            btn.textContent='Submitting...';
            withPin(function(pin){
                supabaseClient.rpc('app_discipline_create_v2',{p_username:currentUser.username,p_password:pin,p_employee_id:parseInt(id,10),p_level:lvl,p_category:cat,p_company_statement:company,p_employee_statement:empStmt,p_action_date:date,p_signatures:sigs,p_form_data:fd,p_pdf_url:(pdfUrl||null),p_form_type:discCurForm}).then(function(r){
                    btn.disabled=false; btn.textContent=old;
                    if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; }
                    try{ fetch(G_URL+'?action=discipline_notify&level='+encodeURIComponent(f.level)+'&by='+encodeURIComponent(currentUser.name||currentUser.username),{mode:'no-cors'}); }catch(e){}
                    alert(f.title+' submitted.'+(f.term?' Admin Managers notified.':' Store managers notified and a follow-up task was created for the Store Manager.')+(pdfUrl?' Signed PDF filed to Dropbox.':''));
                    discRenderForm(); discEmpChange(); discLoadFeed(); discLoadEmployees();
                }).catch(function(){ btn.disabled=false; btn.textContent=old; alert('Connection error.'); });
            }, function(){ btn.disabled=false; btn.textContent=old; });
        };
        hubGenHrPdf('Disciplinary',es.store,es.name,fileName,html,doCreate);
    }
    function openDiscHistory(empId,name){
        var modal=document.getElementById('discHistModal');
        document.getElementById('discHistName').textContent=(name||'Employee')+' — History';
        document.getElementById('discHistBody').innerHTML='<p style="color:#6b7686;">Loading...</p>';
        modal.style.display='flex';
        withPin(function(pin){
            supabaseClient.rpc('app_discipline_history',{p_username:currentUser.username,p_password:pin,p_employee_id:parseInt(empId,10)}).then(function(r){
                if(r.error){ document.getElementById('discHistBody').innerHTML='<p style="color:red;">Could not load.</p>'; return; }
                var d=r.data||{}; var acts=d.actions||[]; var c=d.counts||{};
                var admin=isDiscAdmin();
                var html='<div style="font-size:12.5px;color:#555;background:#f7f7f7;border-radius:8px;padding:8px 10px;margin-bottom:12px;">On file: '+(c.verbal||0)+' verbal, '+(c.written||0)+' written, '+(c.final||0)+' write-up'+((c.termination||0)?', '+c.termination+' termination':'')+'.</div>';
                if(!acts.length){ html+='<p style="color:#6b7686;">No actions recorded.</p>'; }
                else acts.forEach(function(a){
                    var m=discLevelMeta(a.level); var voided=(a.status!=='active');
                    html+='<div style="border:1px solid #eee;border-radius:10px;padding:10px 12px;margin-bottom:8px;'+(voided?'opacity:0.55;':'')+'">'+
                        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'+
                          '<span style="background:'+m.color+';color:#fff;border-radius:10px;padding:2px 9px;font-size:11px;font-weight:bold;">'+m.label+(voided?' (voided)':'')+'</span>'+
                          '<span style="font-size:12px;color:#6b7686;">'+escapeHtml(a.date||'')+'</span>'+
                        '</div>'+
                        '<div style="font-size:12.5px;color:#666;margin-top:5px;"><b>'+escapeHtml(a.category||'')+'</b>'+(a.by?' • by '+escapeHtml(a.by):'')+'</div>'+
                        (a.details?'<div style="font-size:13px;color:#333;margin-top:5px;white-space:pre-wrap;">'+escapeHtml(a.details)+'</div>':'')+
                        ((admin&&!voided)?'<div style="margin-top:7px;"><button onclick="discRescind('+a.id+','+empId+',\''+discSafe(name||'')+'\')" style="background:#eee;color:#7a2222;border:none;border-radius:7px;padding:5px 11px;font-size:12px;font-weight:bold;cursor:pointer;">Void this action</button></div>':'')+
                    '</div>';
                });
                document.getElementById('discHistBody').innerHTML=html;
            });
        });
    }
    function discRescind(id,empId,name){
        if(!confirm('Void (rescind) this disciplinary action? It will no longer count toward the employee\'s standing.')) return;
        withPin(function(pin){
            supabaseClient.rpc('app_discipline_rescind',{p_username:currentUser.username,p_password:pin,p_id:id}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; }
                openDiscHistory(empId,name);
                discLoadFeed();
                if(document.getElementById('discEmp').value==String(empId)) discEmpChange();
            }).catch(function(){ alert('Connection error.'); });
        });
    }

    // ============================================================
    // ATTENDANCE & CALL-OUTS
    // ============================================================
    var attType='callin'; var attCtx=null;
    function openAttendance(){
        if(typeof isMgmt==='function' && !isMgmt()){ alert('Attendance is for management only.'); return; }
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        document.getElementById('attendanceView').style.display='block';
        window.scrollTo(0,0);
        try{ document.getElementById('attDate').value=new Date().toISOString().slice(0,10); }catch(e){}
        attRenderTypePicker();
        attInitSig();
        attLoadEmployees();
    }
    function attRenderTypePicker(){
        var picker=document.getElementById('attTypePicker'); if(!picker) return;
        var opts=[['callin','Call-in'],['tardy','Tardy'],['early','Left early']];
        picker.innerHTML=opts.map(function(o){ var on=(o[0]===attType); return '<button type="button" onclick="attSetType(\''+o[0]+'\')" style="flex:1;border:1px solid #cfcfcf;background:'+(on?'#0d6eaf':'#fff')+';color:'+(on?'#fff':'#555')+';border-radius:8px;padding:8px 6px;font-size:12px;font-weight:bold;cursor:pointer;">'+o[1]+'</button>'; }).join('');
        var lbl=document.getElementById('attDateLbl'); if(lbl) lbl.textContent=(attType==='tardy'?'Date of tardy':(attType==='early'?'Date left early':'Date of absence'));
    }
    function attSetType(t){ attType=t; attRenderTypePicker(); }
    function attInitSig(){ var cv=document.getElementById('attSigPad'); if(!cv) return; attCtx=cv.getContext('2d'); cv.width=cv.offsetWidth; cv.height=cv.offsetHeight; attCtx.strokeStyle='#222'; attCtx.lineWidth=2; attCtx.lineCap='round'; attCtx.lineJoin='round'; cv._has=false;
        var draw=false; function pos(e){ var r=cv.getBoundingClientRect(); var t=e.touches?e.touches[0]:e; return [t.clientX-r.left,t.clientY-r.top]; }
        cv.onpointerdown=function(e){ draw=true; cv._has=true; var p=pos(e); attCtx.beginPath(); attCtx.moveTo(p[0],p[1]); e.preventDefault(); };
        cv.onpointermove=function(e){ if(!draw)return; var p=pos(e); attCtx.lineTo(p[0],p[1]); attCtx.stroke(); e.preventDefault(); };
        window.addEventListener('pointerup',function(){ draw=false; });
    }
    function attClearSig(){ var cv=document.getElementById('attSigPad'); if(cv&&attCtx){ attCtx.clearRect(0,0,cv.width,cv.height); cv._has=false; } }
    function attLoadEmployees(){
        var sel=document.getElementById('attEmp');
        withPin(function(pin){
            supabaseClient.rpc('app_discipline_employees',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; sel.innerHTML='<option value="">Could not load</option>'; return; }
                var list=r.data||[];
                sel.innerHTML='<option value="">— Select employee —</option>'+list.map(function(e){ return '<option value="'+e.id+'">'+escapeHtml(e.name)+(e.location?' ('+escapeHtml(e.location)+')':'')+'</option>'; }).join('');
            }).catch(function(){ sel.innerHTML='<option value="">Connection error</option>'; });
        }, function(){ sel.innerHTML='<option value="">PIN required</option>'; });
    }
    function attRecord(){
        var id=document.getElementById('attEmp').value;
        var body=document.getElementById('attRecordBody'); var flags=document.getElementById('attFlags'); var badge=document.getElementById('attCountBadge');
        if(!id){ body.innerHTML=''; flags.innerHTML=''; if(badge) badge.style.display='none'; return; }
        body.innerHTML='<p style="color:#6b7686;font-size:13px;">Loading…</p>';
        withPin(function(pin){
            supabaseClient.rpc('app_attendance_record',{p_username:currentUser.username,p_password:pin,p_employee_id:parseInt(id,10)}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; body.innerHTML='<p style="color:red;font-size:13px;">Could not load.</p>'; return; }
                var d=r.data||{}; var c=d.counts||{}; var evs=d.events||[]; var fl=d.flags||[];
                if(badge){ badge.style.display='block'; document.getElementById('attCountNum').textContent=d.total90||0; }
                flags.innerHTML=fl.length? fl.map(function(f){ return '<div style="font-size:12.5px;background:#fdeaea;color:#c0264b;border-radius:8px;padding:8px 10px;margin-bottom:8px;">&#9873; '+escapeHtml(f.text)+'</div>'; }).join('') : '<div style="font-size:12.5px;background:#e7f6ec;color:#1f7a3d;border-radius:8px;padding:8px 10px;margin-bottom:8px;">No concerning pattern.</div>';
                var tn={callin:'Call-in',tardy:'Tardy',early:'Left early'};
                var head='<div style="font-size:12px;color:#6b7686;margin-bottom:6px;">'+(c.callin||0)+' call-ins &middot; '+(c.tardy||0)+' tardies &middot; '+(c.early||0)+' early-outs (90 days)</div>';
                body.innerHTML=head+(evs.length? evs.map(function(e){ return '<div style="padding:8px 0;border-bottom:1px solid #eee;font-size:13px;"><b>'+(tn[e.type]||e.type)+'</b> <span style="color:#6b7686;">'+escapeHtml(e.reason||'')+'</span><div style="color:#6b7686;font-size:12px;">'+escapeHtml(e.date||'')+(e.covered?' &middot; covered by '+escapeHtml(e.covered_by||'someone'):'')+'</div></div>'; }).join('') : '<p style="color:#6b7686;font-size:13px;">No attendance events on record.</p>');
            }).catch(function(){ body.innerHTML='<p style="color:red;font-size:13px;">Connection error.</p>'; });
        }, function(){ body.innerHTML='<p style="color:#6b7686;font-size:13px;">PIN required.</p>'; });
    }
    function attSubmit(){
        var id=document.getElementById('attEmp').value;
        if(!id){ alert('Please select an employee.'); return; }
        var date=document.getElementById('attDate').value||null;
        var time=document.getElementById('attTime').value||'';
        var shift=document.getElementById('attShift').value||'';
        var reason=(document.querySelector('input[name=attReason]:checked')||{}).value||'';
        var comments=document.getElementById('attComments').value||'';
        var coveredBy=document.getElementById('attCoveredBy').value||'';
        var docType=document.getElementById('attDoc').value||'';
        var cv=document.getElementById('attSigPad'); var sigs={}; if(cv&&cv._has){ sigs['Call taken by']=cv.toDataURL('image/png'); }
        var btn=document.getElementById('attSubmitBtn'); btn.disabled=true; var old=btn.textContent; btn.textContent='Generating PDF...';
        var es=hubEmpStore(document.getElementById('attEmp'));
        var typeLabel={callin:'Call-in',tardy:'Tardy',early:'Left early'}[attType]||'Call-in';
        var flds=[['Report type',typeLabel],['Team member',es.name],['Store',es.store],['Date',date||''],['Time of call',time],['Scheduled shift',shift],['Reason',reason],['Covered by',coveredBy],['Documentation',docType||'None'],['Logged by',currentUser.name||currentUser.username]];
        var html=hubHrReportHtml('Call-In / Tardy Report','#0d6eaf',flds,[['Comments',comments]],sigs);
        var fileName=(date||new Date().toISOString().slice(0,10))+' - '+typeLabel+(reason?' ('+reason+')':'')+'.pdf';
        var doLog=function(pdfUrl){
            btn.textContent='Logging…';
            withPin(function(pin){
                supabaseClient.rpc('app_attendance_create',{p_username:currentUser.username,p_password:pin,p_employee_id:parseInt(id,10),p_event_type:attType,p_event_date:date,p_call_time:time,p_scheduled_shift:shift,p_reason:reason,p_comments:comments,p_covered:!!coveredBy.trim(),p_covered_by:coveredBy,p_documentation:!!docType,p_doc_type:docType,p_signatures:sigs,p_pdf_url:(pdfUrl||null),p_shift_id:null}).then(function(r){
                    btn.disabled=false; btn.textContent=old;
                    if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; }
                    alert('Logged. The attendance record has been updated.'+(pdfUrl?' PDF filed to Dropbox.':''));
                    document.getElementById('attComments').value=''; document.getElementById('attCoveredBy').value=''; attClearSig();
                    attRecord();
                }).catch(function(){ btn.disabled=false; btn.textContent=old; alert('Connection error.'); });
            }, function(){ btn.disabled=false; btn.textContent=old; });
        };
        hubGenHrPdf('Attendance',es.store,es.name,fileName,html,doLog);
    }

    // ============================================================
    // REPORT A CONCERN (confidential harassment/misconduct)
    // ============================================================
    function openHarassReport(){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        document.getElementById('harassReportView').style.display='block';
        window.scrollTo(0,0);
        try{ document.getElementById('harassDate').value=new Date().toISOString().slice(0,10); }catch(e){}
        var locs=(typeof SCHED_LOCATIONS!=='undefined'?SCHED_LOCATIONS:['Roadrunner','Valley','Lenox','Alamogordo','Roswell','Catering & Vending']);
        var cur=(currentUser&&(currentUser.activeStore||currentUser.home_location))||'';
        document.getElementById('harassStore').innerHTML=locs.map(function(l){ return '<option'+(l===cur?' selected':'')+'>'+escapeHtml(l)+'</option>'; }).join('');
        document.getElementById('harassAnon').checked=false; harassAnonToggle();
        document.getElementById('harassName').value=(currentUser&&currentUser.name)||'';
        var panel=document.getElementById('harassAdminPanel');
        if(typeof isAdminManager==='function' && isAdminManager()){ panel.style.display='block'; harassLoadAdmin(); } else { panel.style.display='none'; }
    }
    function harassAnonToggle(){ var anon=document.getElementById('harassAnon').checked; document.getElementById('harassNameWrap').style.display=anon?'none':'block'; }
    function harassSubmit(){
        var anon=document.getElementById('harassAnon').checked;
        var store=document.getElementById('harassStore').value||'';
        var date=document.getElementById('harassDate').value||null;
        var about=document.getElementById('harassAbout').value||'';
        var details=document.getElementById('harassDetails').value||'';
        var wit=document.getElementById('harassWitnesses').value||'';
        if(!details.trim()){ alert('Please describe what happened.'); return; }
        var btn=document.getElementById('harassSubmitBtn'); btn.disabled=true; var old=btn.textContent; btn.textContent='Submitting…';
        withPin(function(pin){
            supabaseClient.rpc('app_harassment_create',{p_username:currentUser.username,p_password:pin,p_anonymous:anon,p_location:store,p_incident_date:date,p_about_who:about,p_details:details,p_witnesses:wit}).then(function(r){
                btn.disabled=false; btn.textContent=old;
                if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; }
                alert('Your report was submitted privately to Admin Managers. Thank you for speaking up.');
                document.getElementById('harassAbout').value=''; document.getElementById('harassDetails').value=''; document.getElementById('harassWitnesses').value='';
                if(typeof isAdminManager==='function' && isAdminManager()) harassLoadAdmin();
            }).catch(function(){ btn.disabled=false; btn.textContent=old; alert('Connection error.'); });
        }, function(){ btn.disabled=false; btn.textContent=old; });
    }
    function harassLoadAdmin(){
        var c=document.getElementById('harassAdminList');
        withPin(function(pin){
            supabaseClient.rpc('app_harassment_list',{p_admin_username:currentUser.username,p_admin_password:pin}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; c.innerHTML='<p style="color:red;font-size:13px;">Could not load.</p>'; return; }
                var list=r.data||[];
                if(!list.length){ c.innerHTML='<p style="color:#6b7686;font-size:13px;margin:0;">No reports on file.</p>'; return; }
                c.innerHTML=list.map(function(a){
                    var st=(a.status||'new');
                    return '<div style="border:1px solid #eee;border-radius:10px;padding:11px;margin-bottom:9px;">'+
                        '<div style="display:flex;justify-content:space-between;gap:8px;"><b style="font-size:13px;color:#4a2f80;">Report #'+a.id+'</b><span style="font-size:11px;background:'+(st==='resolved'?'#1f7a3d':'#b06a00')+';color:#fff;border-radius:10px;padding:2px 9px;">'+escapeHtml(st)+'</span></div>'+
                        '<div style="font-size:12px;color:#6b7686;margin-top:3px;">From: '+escapeHtml(a.reporter||'-')+(a.location?' · '+escapeHtml(a.location):'')+(a.incident_date?' · '+escapeHtml(a.incident_date):'')+'</div>'+
                        (a.about_who?'<div style="font-size:12.5px;margin-top:5px;"><b>About:</b> '+escapeHtml(a.about_who)+'</div>':'')+
                        '<div style="font-size:13px;color:#333;margin-top:5px;white-space:pre-wrap;">'+escapeHtml(a.details||'')+'</div>'+
                        (a.witnesses?'<div style="font-size:12px;color:#666;margin-top:5px;"><b>Witnesses:</b> '+escapeHtml(a.witnesses)+'</div>':'')+
                        (a.assigned_to?'<div style="font-size:12px;color:#0d6eaf;margin-top:5px;">Assigned to: '+escapeHtml(a.assigned_to)+'</div>':'')+
                        '<div style="margin-top:8px;display:flex;gap:7px;flex-wrap:wrap;">'+
                          '<button onclick="harassAssign('+a.id+')" style="background:#eef;border:none;border-radius:7px;padding:5px 11px;font-size:12px;cursor:pointer;">Assign / reassign</button>'+
                          '<button onclick="harassResolve('+a.id+')" style="background:#e7f6ec;border:none;border-radius:7px;padding:5px 11px;font-size:12px;color:#1f7a3d;font-weight:bold;cursor:pointer;">Mark resolved</button>'+
                        '</div>'+
                    '</div>';
                }).join('');
            }).catch(function(){ c.innerHTML='<p style="color:red;font-size:13px;">Connection error.</p>'; });
        }, function(){ c.innerHTML='<p style="color:#6b7686;font-size:13px;">PIN required.</p>'; });
    }
    function harassAssign(id){ var who=prompt('Assign this report to (name):'); if(who===null) return; harassDoUpdate(id,'in progress',who,''); }
    function harassResolve(id){ var note=prompt('Resolution note (optional):'); if(note===null) return; harassDoUpdate(id,'resolved','',note); }
    function harassDoUpdate(id,status,assignee,notes){
        withPin(function(pin){
            supabaseClient.rpc('app_harassment_update',{p_admin_username:currentUser.username,p_admin_password:pin,p_id:id,p_status:status,p_assigned_to:assignee,p_notes:notes}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; }
                harassLoadAdmin();
            }).catch(function(){ alert('Connection error.'); });
        });
    }

    // ============================================================
    // TEMPERATURE LOGS (food safety)
    // ============================================================
    function tempStoreLoc(){ return (typeof activeStoreLoc==='function' && activeStoreLoc()) || (currentUser && currentUser.home_location) || ''; }
    function openTempLogs(){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        document.getElementById('tempLogsView').style.display='block';
        window.scrollTo(0,0);
        var loc=tempStoreLoc();
        document.getElementById('tempStoreLabel').innerHTML='&#127970; '+escapeHtml(loc||'No store set');
        var hb=document.getElementById('tempHistBtn'); if(hb) hb.style.display=(typeof isDiscAdmin==='function'&&(isDiscAdmin()||isManagerRole()))?'inline-block':'none';
        loadTempPoints();
    }
    function tempTimeFmt(s){ if(!s) return ''; try{ return new Date(s).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }catch(e){ return ''; } }
    function loadTempPoints(){
        var c=document.getElementById('tempPointsList');
        var loc=tempStoreLoc();
        if(!loc){ c.innerHTML='<p style="color:#6b7686;text-align:center;padding:20px;">No store is set on your account. Ask an admin to assign your store.</p>'; return; }
        c.innerHTML='<p style="text-align:center;padding:20px;color:#6b7686;">Loading equipment...</p>';
        withPin(function(pin){
            supabaseClient.rpc('app_temp_points',{p_username:currentUser.username,p_password:pin,p_location:loc}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; c.innerHTML='<p style="color:red;text-align:center;padding:20px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var list=r.data||[];
                if(!list.length){ c.innerHTML='<p style="color:#6b7686;text-align:center;padding:20px;">No equipment set up for this store yet.</p>'; return; }
                c.innerHTML=list.map(function(p){
                    var last=p.last;
                    var statusHtml;
                    if(last){
                        var ok=(last.status==='pass');
                        statusHtml='<div style="font-size:12px;margin-top:3px;color:'+(ok?'#1f7a3d':'#c0264b')+';font-weight:bold;">'+
                            (ok?'✔':'⚠')+' '+last.temp+'°F logged '+tempTimeFmt(last.at)+(last.by?' by '+escapeHtml(last.by):'')+(ok?'':' — OUT OF RANGE')+'</div>';
                    } else {
                        statusHtml='<div style="font-size:12px;margin-top:3px;color:#b06a00;font-weight:bold;">Not logged today</div>';
                    }
                    return '<div style="background:#fff;border-radius:12px;padding:14px;margin-bottom:12px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">'+
                        '<div style="font-weight:bold;color:#0a5152;font-size:15px;">'+escapeHtml(p.name)+'</div>'+
                        '<div style="font-size:12px;color:#6b7686;">Safe range: '+p.min+'° to '+p.max+'°F</div>'+
                        statusHtml+
                        '<div style="display:flex;gap:8px;margin-top:10px;align-items:center;">'+
                          '<input type="number" inputmode="numeric" id="tempval-'+p.id+'" placeholder="°F" style="width:90px;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:15px;">'+
                          '<input type="text" id="tempnote-'+p.id+'" placeholder="Note (optional)" style="flex:1;min-width:0;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:13px;">'+
                          '<button onclick="saveTempReading('+p.id+')" style="background:#0e7c7b;color:#fff;border:none;border-radius:8px;padding:10px 14px;font-size:14px;font-weight:bold;cursor:pointer;white-space:nowrap;">Log</button>'+
                        '</div>'+
                    '</div>';
                }).join('');
            }).catch(function(){ c.innerHTML='<p style="color:red;text-align:center;padding:20px;">Connection error.</p>'; });
        }, function(){ c.innerHTML='<p style="color:#6b7686;text-align:center;padding:20px;">PIN required.</p>'; });
    }
    function saveTempReading(pointId){
        var inp=document.getElementById('tempval-'+pointId);
        var noteEl=document.getElementById('tempnote-'+pointId);
        if(!inp) return;
        var val=parseFloat(inp.value);
        if(isNaN(val)){ alert('Enter a temperature.'); inp.focus(); return; }
        var note=noteEl?noteEl.value.trim():'';
        withPin(function(pin){
            supabaseClient.rpc('app_temp_log_save',{p_username:currentUser.username,p_password:pin,p_point_id:pointId,p_temp_f:val,p_note:note}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; }
                var st=(r.data&&r.data.status)||'';
                if(st==='fail'){ alert('⚠ '+val+'°F is OUT OF the safe range. Management has been notified. Please address it.'); }
                loadTempPoints();
            }).catch(function(){ alert('Connection error.'); });
        });
    }
    function openTempHistory(){
        var modal=document.getElementById('tempHistModal');
        document.getElementById('tempHistBody').innerHTML='<p style="color:#6b7686;">Loading...</p>';
        modal.style.display='flex';
        withPin(function(pin){
            supabaseClient.rpc('app_temp_history',{p_username:currentUser.username,p_password:pin,p_location:tempStoreLoc(),p_days:7}).then(function(r){
                if(r.error){ document.getElementById('tempHistBody').innerHTML='<p style="color:red;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var list=r.data||[];
                if(!list.length){ document.getElementById('tempHistBody').innerHTML='<p style="color:#6b7686;">No readings in the last 7 days.</p>'; return; }
                document.getElementById('tempHistBody').innerHTML=list.map(function(l){
                    var ok=(l.status==='pass');
                    return '<div style="padding:8px 0;border-bottom:1px solid #eee;display:flex;justify-content:space-between;gap:8px;">'+
                        '<div><div style="font-weight:bold;font-size:13px;color:#333;">'+escapeHtml(l.point)+'</div>'+
                          '<div style="font-size:11.5px;color:#6b7686;">'+socFmt(l.at)+(l.by?' • '+escapeHtml(l.by):'')+(l.note?' • '+escapeHtml(l.note):'')+'</div></div>'+
                        '<div style="font-weight:bold;white-space:nowrap;color:'+(ok?'#1f7a3d':'#c0264b')+';">'+l.temp+'°F '+(ok?'✔':'⚠')+'</div>'+
                    '</div>';
                }).join('');
            });
        });
    }

    // ============================================================
    // SHIFT CHECKLISTS
    // ============================================================
    var clShift='open';
    function openChecklists(){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        document.getElementById('checklistsView').style.display='block';
        window.scrollTo(0,0);
        document.getElementById('clStoreLabel').innerHTML='&#127970; '+escapeHtml(tempStoreLoc()||'No store set');
        clShift='open'; setChecklistTab('open');
    }
    function setChecklistTab(shift){
        clShift=shift;
        ['open','close','clean'].forEach(function(s){ var b=document.getElementById('cl-tab-'+s); if(b) b.classList.toggle('active', s===shift); });
        loadChecklist();
    }
    function loadChecklist(){
        var c=document.getElementById('clItems'); var loc=tempStoreLoc();
        if(!loc){ c.innerHTML='<p style="color:#6b7686;text-align:center;padding:20px;">No store set on your account.</p>'; document.getElementById('clProgress').textContent=''; return; }
        c.innerHTML='<p style="text-align:center;padding:20px;color:#6b7686;">Loading...</p>';
        withPin(function(pin){
            supabaseClient.rpc('app_checklist_items',{p_username:currentUser.username,p_password:pin,p_shift:clShift,p_location:loc}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; c.innerHTML='<p style="color:red;text-align:center;padding:20px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var list=r.data||[]; var done=list.filter(function(i){return i.done;}).length;
                if(!list.length){
                    document.getElementById('clProgress').textContent='';
                    c.innerHTML='<div style="background:#fff;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 4px rgba(0,0,0,0.05);"><div style="font-size:26px;">&#129534;</div><p style="color:#556070;font-size:13.5px;margin:8px 0 0;">No checklist items configured for this shift yet &mdash; managers can add them in Admin.</p></div>';
                    return;
                }
                document.getElementById('clProgress').innerHTML='<b>'+done+' / '+list.length+'</b> done today';
                c.innerHTML=list.map(function(i){
                    return '<div onclick="toggleChecklistItem('+i.id+','+(i.done?'false':'true')+')" style="background:#fff;border-radius:10px;padding:13px 14px;margin-bottom:9px;box-shadow:0 2px 4px rgba(0,0,0,0.05);cursor:pointer;display:flex;align-items:center;gap:12px;'+(i.done?'opacity:0.7;':'')+'">'+
                        '<div style="width:26px;height:26px;border-radius:7px;border:2px solid '+(i.done?'#2e7d32':'#bbb')+';background:'+(i.done?'#2e7d32':'#fff')+';color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">'+(i.done?'✔':'')+'</div>'+
                        '<div style="flex:1;"><div style="font-size:14px;font-weight:600;color:#333;'+(i.done?'text-decoration:line-through;color:#6b7686;':'')+'">'+escapeHtml(i.label)+'</div>'+
                        (i.done&&i.by?'<div style="font-size:11px;color:#6b7686;">'+escapeHtml(i.by)+' • '+tempTimeFmt(i.at)+'</div>':'')+'</div>'+
                    '</div>';
                }).join('');
            }).catch(function(){ c.innerHTML='<p style="color:red;text-align:center;padding:20px;">Connection error.</p>'; });
        }, function(){ c.innerHTML='<p style="color:#6b7686;text-align:center;padding:20px;">PIN required.</p>'; });
    }
    function toggleChecklistItem(itemId, done){
        withPin(function(pin){
            supabaseClient.rpc('app_checklist_toggle',{p_username:currentUser.username,p_password:pin,p_item_id:itemId,p_location:tempStoreLoc(),p_done:done}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; }
                loadChecklist();
            }).catch(function(){ alert('Connection error.'); });
        });
    }

    // ============================================================
    // INVENTORY & SUPPLIES
    // ============================================================
    function openInventory(){
        if (!isMgmt()) { alert('Inventory & Supplies is for management only.'); return; }
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        document.getElementById('inventoryView').style.display='block';
        window.scrollTo(0,0);
        document.getElementById('invStoreLabel').innerHTML='&#127970; '+escapeHtml(tempStoreLoc()||'No store set');
        var rb=document.getElementById('invReqBtn'); if(rb) rb.style.display=(typeof isDiscAdmin==='function'&&(isDiscAdmin()||isManagerRole()))?'inline-block':'none';
        loadInventory();
    }
    function loadInventory(){
        var c=document.getElementById('invList'); var loc=tempStoreLoc();
        if(!loc){ c.innerHTML='<p style="color:#6b7686;text-align:center;padding:20px;">No store set on your account.</p>'; return; }
        c.innerHTML='<p style="text-align:center;padding:20px;color:#6b7686;">Loading...</p>';
        withPin(function(pin){
            supabaseClient.rpc('app_inventory_list',{p_username:currentUser.username,p_password:pin,p_location:loc}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; c.innerHTML='<p style="color:red;text-align:center;padding:20px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var list=r.data||[];
                if(!list.length){ c.innerHTML='<p style="color:#6b7686;text-align:center;padding:20px;">No items set up for this store.</p>'; return; }
                c.innerHTML=list.map(function(i){
                    var oh=(i.on_hand===null||i.on_hand===undefined)?null:Number(i.on_hand);
                    var low=(oh!==null && i.par!==null && oh<=Number(i.par));
                    return '<div style="background:#fff;border-radius:12px;padding:13px 14px;margin-bottom:11px;box-shadow:0 2px 4px rgba(0,0,0,0.05);'+(low?'border:1.5px solid #d9534f;':'')+'">'+
                        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">'+
                          '<span style="font-weight:bold;color:#6e3700;font-size:15px;">'+escapeHtml(i.name)+'</span>'+
                          '<span style="font-size:12px;color:#6b7686;">par '+i.par+' '+escapeHtml(i.unit||'')+'</span>'+
                        '</div>'+
                        '<div style="font-size:12px;margin-top:2px;color:'+(low?'#c0264b':'#666')+';font-weight:'+(low?'bold':'normal')+';">'+
                          (oh===null?'No count yet':('On hand: '+oh+' '+escapeHtml(i.unit||'')+(low?' — LOW, reorder':'')))+'</div>'+
                        '<div style="display:flex;gap:8px;margin-top:9px;align-items:center;">'+
                          '<input type="number" inputmode="decimal" id="invcount-'+i.id+'" placeholder="count" style="width:90px;padding:9px;border:1px solid #ccc;border-radius:8px;font-size:14px;">'+
                          '<button onclick="saveInvCount('+i.id+')" style="background:#555;color:#fff;border:none;border-radius:8px;padding:9px 12px;font-size:13px;font-weight:bold;cursor:pointer;">Save</button>'+
                          '<button onclick="requestInv('+i.id+',\''+discSafe(i.name)+'\')" style="background:#a35200;color:#fff;border:none;border-radius:8px;padding:9px 12px;font-size:13px;font-weight:bold;cursor:pointer;margin-left:auto;">Request</button>'+
                        '</div>'+
                    '</div>';
                }).join('');
            }).catch(function(){ c.innerHTML='<p style="color:red;text-align:center;padding:20px;">Connection error.</p>'; });
        }, function(){ c.innerHTML='<p style="color:#6b7686;text-align:center;padding:20px;">PIN required.</p>'; });
    }
    function saveInvCount(itemId){
        var inp=document.getElementById('invcount-'+itemId); if(!inp) return;
        var val=parseFloat(inp.value);
        if(isNaN(val)){ alert('Enter a count.'); inp.focus(); return; }
        withPin(function(pin){
            supabaseClient.rpc('app_inventory_count_save',{p_username:currentUser.username,p_password:pin,p_item_id:itemId,p_on_hand:val}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; }
                loadInventory();
            }).catch(function(){ alert('Connection error.'); });
        });
    }
    function requestInv(itemId, name){
        var qty=prompt('How many '+name+' to request?','');
        if(qty===null) return;
        var note=prompt('Note for the office (optional):','')||'';
        withPin(function(pin){
            supabaseClient.rpc('app_inventory_request',{p_username:currentUser.username,p_password:pin,p_item_id:itemId,p_qty:parseFloat(qty)||0,p_note:note}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; }
                alert('Request sent to the office.');
            }).catch(function(){ alert('Connection error.'); });
        });
    }
    function openInvRequests(){
        var modal=document.getElementById('invReqModal');
        document.getElementById('invReqBody').innerHTML='<p style="color:#6b7686;">Loading...</p>';
        modal.style.display='flex';
        withPin(function(pin){
            supabaseClient.rpc('app_inventory_requests',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ document.getElementById('invReqBody').innerHTML='<p style="color:red;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var list=r.data||[];
                if(!list.length){ document.getElementById('invReqBody').innerHTML='<p style="color:#6b7686;">No pending requests. 🎉</p>'; return; }
                document.getElementById('invReqBody').innerHTML=list.map(function(o){
                    return '<div style="padding:9px 0;border-bottom:1px solid #eee;">'+
                        '<div style="font-weight:bold;font-size:14px;color:#333;">'+escapeHtml(o.item)+' × '+o.qty+'</div>'+
                        '<div style="font-size:12px;color:#6b7686;">'+escapeHtml(o.location||'')+' • '+escapeHtml(o.by||'')+' • '+socFmt(o.at)+(o.note?' • '+escapeHtml(o.note):'')+'</div>'+
                    '</div>';
                }).join('');
            });
        });
    }

    // ============================================================
    // DAILY SALES & LABOR
    // ============================================================
    function openSales(){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        document.getElementById('salesView').style.display='block';
        window.scrollTo(0,0);
        document.getElementById('salesStoreLabel').innerHTML='&#127970; '+escapeHtml(tempStoreLoc()||'No store set');
        try{ document.getElementById('salesDate').value=new Date().toISOString().slice(0,10); }catch(e){}
        loadSalesRecent();
    }
    function saveSales(){
        var loc=tempStoreLoc();
        if(!loc){ alert('No store set on your account.'); return; }
        var date=document.getElementById('salesDate').value||null;
        var gross=parseFloat(document.getElementById('salesGross').value);
        var labor=parseFloat(document.getElementById('salesLabor').value);
        var tx=parseInt(document.getElementById('salesTx').value,10);
        var note=document.getElementById('salesNote').value.trim();
        if(isNaN(gross)){ alert('Enter gross sales.'); return; }
        if(gross<0||(!isNaN(labor)&&labor<0)){ alert('Sales and labor cannot be negative.'); return; }
        if(window._savingSales) return;
        withPin(function(pin){
            window._savingSales=true;
            supabaseClient.rpc('app_sales_save',{p_username:currentUser.username,p_password:pin,p_location:loc,p_date:date,p_gross:gross,p_labor:isNaN(labor)?null:labor,p_tx:isNaN(tx)?null:tx,p_note:note}).then(function(r){
                window._savingSales=false;
                if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; }
                document.getElementById('salesGross').value=''; document.getElementById('salesLabor').value=''; document.getElementById('salesTx').value=''; document.getElementById('salesNote').value='';
                loadSalesRecent();
            }).catch(function(){ window._savingSales=false; alert('Connection error.'); });
        });
    }
    function loadSalesRecent(){
        var c=document.getElementById('salesRecent'); var loc=tempStoreLoc();
        if(!loc){ c.innerHTML='<p style="color:#6b7686;">No store set.</p>'; return; }
        withPin(function(pin){
            supabaseClient.rpc('app_sales_recent',{p_username:currentUser.username,p_password:pin,p_location:loc,p_days:30}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; c.innerHTML='<p style="color:red;font-size:13px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var list=r.data||[];
                if(!list.length){ c.innerHTML='<p style="color:#6b7686;font-size:13px;margin:0;">No days entered yet.</p>'; return; }
                var lLo=(typeof cfgNum==='function'?cfgNum('targets','labor_pct_lo',18):18), lHi=(typeof cfgNum==='function'?cfgNum('targets','labor_pct_hi',23):23);
                var html='<div style="font-size:11.5px;color:#6b7686;margin-bottom:6px;">Labor target <b>'+lLo+'%–'+lHi+'%</b>. <span style="color:#c0264b;">Red</span> = over '+lHi+'% · <span style="color:#1b7a3d;">Green</span> = on target · <span style="color:#b06a00;">Amber</span> = under '+lLo+'%.</div>'+
                    '<table style="width:100%;border-collapse:collapse;font-size:13px;"><tr style="color:#6b7686;text-align:left;border-bottom:1px solid #eee;"><th style="padding:6px 4px;">Date</th><th>Sales</th><th>Labor</th><th>Labor%</th></tr>';
                list.forEach(function(d){
                    var lp=d.labor_pct;
                    var pct=(lp===null||lp===undefined)?'—':lp+'%';
                    var color='#1b7a3d';
                    if(lp!==null&&lp!==undefined){ if(lp>lHi) color='#c0264b'; else if(lp<lLo) color='#b06a00'; }
                    html+='<tr style="border-bottom:1px solid #f3f3f3;"><td style="padding:7px 4px;">'+escapeHtml(d.date)+'</td>'+
                        '<td>$'+(d.gross!=null?Number(d.gross).toLocaleString():'—')+'</td>'+
                        '<td>$'+(d.labor!=null?Number(d.labor).toLocaleString():'—')+'</td>'+
                        '<td style="font-weight:bold;color:'+color+';">'+pct+'</td></tr>';
                });
                html+='</table>';
                c.innerHTML=html;
            }).catch(function(){ c.innerHTML='<p style="color:red;font-size:13px;">Connection error.</p>'; });
        });
    }

    // ============================================================
    // ADMIN LIVE DASHBOARD — NCR Pulse + Square (placeholder data)
    // ============================================================
    var AD_ROUTES=[
        {town:'Deming',ic:'🎡',cups:1840,rev:5260},
        {town:'Hatch',ic:'🌶️',cups:1320,rev:3910},
        {town:'Silver City',ic:'⛏️',cups:1610,rev:4720}
    ];
    var AD_CATER=[
        {ic:'💍',name:'Sanchez Wedding',town:'Las Cruces',amt:1450},
        {ic:'🎓',name:'NMSU Grad Bash',town:'Las Cruces',amt:980},
        {ic:'🏢',name:'Spaceport Mixer',town:'T or C',amt:1720},
        {ic:'🎂',name:'Quinceañera — Reyes',town:'Deming',amt:640}
    ];
    var adTimer=null;
    function adMoney(n){ return '$'+Math.round(n).toLocaleString(); }
    function openAdminDash(){
        if(!isAdminManager()){ alert('The Live Dashboard is for Admin Managers only.'); return; }
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        document.getElementById('adminDashView').style.display='block';
        window.scrollTo(0,0);
        adRender();
        if(adTimer) clearInterval(adTimer);
        adTimer=setInterval(function(){
            if(document.getElementById('adminDashView').style.display!=='block'){ clearInterval(adTimer); return; }
            adLoadNcr();
        }, 60000);
    }
    // Pull the latest real day per store from the Daily Sales & Labor feed (app_sales_recent).
    function adLoadNcr(){
        var box=document.getElementById('adNcr'); if(!box) return;
        var stores=(typeof HUB_STORES!=='undefined'?HUB_STORES.slice():['Roadrunner','Valley','Lenox','Alamogordo','Roswell']);
        if(box.getAttribute('data-loaded')!=='1') box.innerHTML='<p style="color:#6b7686;font-size:13px;">Loading store sales&hellip;</p>';
        withPin(function(pin){
            var results={}, pending=stores.length, gotErr=false;
            function done(){ pending--; if(pending===0){ box.setAttribute('data-loaded','1'); adRenderNcrReal(stores, results, gotErr); } }
            stores.forEach(function(loc){
                supabaseClient.rpc('app_sales_recent',{p_username:currentUser.username,p_password:pin,p_location:loc,p_days:30}).then(function(r){
                    if(r.error){ if(r.error.code==='42501') sessionPin=null; gotErr=true; }
                    else if(r.data && r.data.length){ var latest=r.data[0]; r.data.forEach(function(d){ if((d.date||'')>(latest.date||'')) latest=d; }); results[loc]=latest; }
                    done();
                }).catch(function(){ done(); });
            });
        }, function(){ box.innerHTML='<p style="color:#6b7686;font-size:13px;">PIN required to load sales.</p>'; });
    }
    function adRenderNcrReal(stores, results, gotErr){
        var pins=(typeof HUB_STORE_EMOJI!=='undefined'?HUB_STORE_EMOJI:{Roadrunner:'🛣️',Valley:'🌄',Lenox:'🏙️',Alamogordo:'🌵',Roswell:'🛸'});
        var st='font-size:10px;letter-spacing:1px;color:#5b6675;font-weight:800;text-transform:uppercase;';
        var any=false;
        var html=stores.map(function(loc){
            var d=results[loc]; var pin=pins[loc]||'🏪';
            if(!d){ return '<div style="background:#f7f9fb;border:1px solid #e7eef5;border-left:5px solid #c9d4de;border-radius:12px;padding:13px 15px;margin-bottom:9px;display:flex;align-items:center;gap:12px;">'+
                '<span style="font-weight:900;font-size:15px;min-width:130px;">'+pin+' '+loc+'</span>'+
                '<span style="color:#5b6675;font-size:13px;">No sales entered yet</span></div>'; }
            any=true;
            var lLo=(typeof cfgNum==='function'?cfgNum('targets','labor_pct_lo',18):18), lHi=(typeof cfgNum==='function'?cfgNum('targets','labor_pct_hi',23):23);
            var lp=d.labor_pct; var laborCol=(lp==null)?'#7a8a98':(lp>lHi?'#c0264b':(lp<lLo?'#b06a00':'#1f7a3d'));
            return '<div style="background:linear-gradient(100deg,#fbfdff,#f3f8fd);border:1px solid #e7eef5;border-left:5px solid #106ab3;border-radius:12px;padding:13px 15px;margin-bottom:9px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;">'+
              '<span style="font-weight:900;font-size:15px;min-width:130px;">'+pin+' '+loc+'</span>'+
              '<span style="display:flex;flex-direction:column;"><small style="'+st+'">Net Sales</small><b style="font-size:17px;color:#0f4d7e;">'+(d.gross!=null?adMoney(d.gross):'—')+'</b></span>'+
              '<span style="display:flex;flex-direction:column;"><small style="'+st+'">Labor</small><b style="font-size:16px;color:'+laborCol+';">'+(lp!=null?lp+'%':'—')+'</b></span>'+
              '<span style="display:flex;flex-direction:column;"><small style="'+st+'">Transactions</small><b style="font-size:17px;">'+(d.tx!=null?d.tx:'—')+'</b></span>'+
              '<span style="margin-left:auto;font-size:11px;color:#5b6675;font-weight:700;">&#9679; '+escapeHtml(d.date||'')+'</span>'+
            '</div>';
        }).join('');
        if(gotErr && !any){ html='<p style="color:#c0264b;font-size:13px;">Could not load sales for these stores — check access.</p>'; }
        document.getElementById('adNcr').innerHTML=html;
    }
    function adRender(){
        adLoadNcr();
        var max=Math.max.apply(null, AD_ROUTES.map(function(r){return r.rev;}));
        document.getElementById('adRoutes').innerHTML=AD_ROUTES.map(function(r){
            return '<div style="background:#fff;border:1px solid #e7eef5;border-radius:12px;padding:13px 15px;margin-bottom:10px;box-shadow:0 3px 10px rgba(20,50,80,.05);">'+
              '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><span style="font-weight:900;font-size:15px;">'+r.ic+' '+r.town+'</span><span style="margin-left:auto;font-weight:900;color:#1f7a3d;font-size:17px;">'+adMoney(r.rev)+'</span></div>'+
              '<div style="height:12px;border-radius:999px;background:#eef4fa;overflow:hidden;"><i style="display:block;height:100%;width:'+Math.round(r.rev/max*100)+'%;background:linear-gradient(90deg,#ec3e7e,#106ab3);"></i></div>'+
              '<div style="font-size:12px;color:#5b6675;font-weight:700;margin-top:6px;">&#127847; '+r.cups.toLocaleString()+' cups served · this month</div>'+
            '</div>';
        }).join('');
        var tot=AD_CATER.reduce(function(a,b){return a+b.amt;},0);
        document.getElementById('adCater').innerHTML='<div style="font-size:13px;color:#555;margin-bottom:8px;">Pre-booked event revenue (MTD): <b style="color:#1f7a3d;font-size:18px;">'+adMoney(tot)+'</b> &middot; '+AD_CATER.length+' events</div>'+
            AD_CATER.map(function(c){ return '<div style="display:flex;align-items:center;gap:11px;padding:10px 2px;border-bottom:1px dashed #eee;"><span style="font-size:18px;">'+c.ic+'</span><span><b>'+escapeHtml(c.name)+'</b><br><small style="color:#6b7686;">'+escapeHtml(c.town)+' · paid via text link</small></span><span style="margin-left:auto;font-weight:900;color:#1f7a3d;">'+adMoney(c.amt)+'</span></div>'; }).join('');
    }

    // ============================================================
    // WEEKLY PRIME COST FORM
    // ============================================================
    var PC_DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    var pcInvPhotos=[];
    function pcMonday(){ var d=new Date(); var off=(d.getDay()+6)%7; d.setDate(d.getDate()-off); return d.toISOString().slice(0,10); }
    function pcNum(id){ var el=document.getElementById(id); var v=el?parseFloat(el.value):NaN; return isNaN(v)?0:v; }
    function pcMoney(n){ return '$'+Math.round(n).toLocaleString(); }
    function openPrimeCost(){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
        document.getElementById('primeCostView').style.display='block';
        window.scrollTo(0,0);
        document.getElementById('pcStoreLabel').innerHTML='&#127970; '+escapeHtml(tempStoreLoc()||'No store set');
        document.getElementById('pcWeek').value=pcMonday();
        document.getElementById('pcTax').value=(typeof cfgNum==='function'?cfgNum('targets','prime_tax_pct',8.31):8.31);
        document.getElementById('pcMgr').value=''; document.getElementById('pcBeg').value=''; document.getElementById('pcEnd').value=''; document.getElementById('pcNote').value='';
        buildPcGrid();
        document.getElementById('pcInvRows').innerHTML=''; addInvoiceRow();
        pcInvPhotos=[]; var pp=document.getElementById('pcPhotoPrev'); if(pp) pp.innerHTML='';
        pcCalc();
        loadPrimeRecent();
        pcCarryInventory();
        var _pw=document.getElementById('pcWeek'); if(_pw && !_pw._carryBound){ _pw._carryBound=true; _pw.addEventListener('change',pcCarryInventory); }
    }
    function pcCarryInventory(){
        var loc=tempStoreLoc(); if(!loc) return;
        var wk=document.getElementById('pcWeek').value; if(!wk) return;
        var beg=document.getElementById('pcBeg'); if(!beg || (beg.value!==''&&beg.value!=null)) return;
        withPin(function(pin){
            supabaseClient.rpc('app_prime_last_end',{p_username:currentUser.username,p_password:pin,p_location:loc,p_before:wk}).then(function(r){
                if(r.error||r.data==null) return;
                if(beg.value===''||beg.value==null){ beg.value=Number(r.data).toFixed(2); pcCalc();
                    var hint=document.getElementById('pcBegHint'); if(hint){ hint.textContent='↪ carried from last week&#39;s ending count'; hint.style.display='block'; }
                }
            }).catch(function(){});
        });
    }
    function buildPcGrid(){
        var b=document.getElementById('pcGridBody'); var html='';
        for(var i=0;i<7;i++){
            html+='<tr style="border-bottom:1px solid #eee;">'+
              '<td style="padding:5px 6px;font-weight:600;color:#333;white-space:nowrap;">'+PC_DAYS[i].slice(0,3)+'</td>'+
              '<td style="padding:4px;"><input type="number" inputmode="decimal" id="pcDep'+i+'" oninput="pcCalc()" style="width:78px;padding:7px;border:1px solid #ccc;border-radius:6px;font-size:13px;"></td>'+
              '<td style="padding:4px;"><input type="number" inputmode="decimal" id="pcMc'+i+'" oninput="pcCalc()" style="width:78px;padding:7px;border:1px solid #ccc;border-radius:6px;font-size:13px;"></td>'+
              '<td style="padding:4px;"><input type="number" inputmode="decimal" id="pcHos'+i+'" oninput="pcCalc()" style="width:78px;padding:7px;border:1px solid #ccc;border-radius:6px;font-size:13px;"></td>'+
              '<td style="padding:4px;"><input type="number" inputmode="decimal" id="pcHr'+i+'" oninput="pcCalc()" style="width:78px;padding:7px;border:1px solid #ccc;border-radius:6px;font-size:13px;"></td>'+
              '<td style="padding:4px;"><input type="number" inputmode="numeric" id="pcTx'+i+'" oninput="pcCalc()" style="width:64px;padding:7px;border:1px solid #ccc;border-radius:6px;font-size:13px;"></td>'+
            '</tr>';
        }
        b.innerHTML=html;
    }
    function pcWeekDates(){
        var wk=document.getElementById('pcWeek').value; if(!wk) return [];
        var p=wk.split('-'); if(p.length!==3) return [];
        var out=[];
        for(var i=0;i<7;i++){ var d=new Date(+p[0],+p[1]-1,+p[2]); d.setDate(d.getDate()+i); out.push(d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)); }
        return out;
    }
    function pcAutofill(btn){
        var loc=tempStoreLoc(); if(!loc){ alert('No store set on your account.'); return; }
        var wk=document.getElementById('pcWeek').value; if(!wk){ alert('Pick the week beginning (Monday) first.'); return; }
        var dates=pcWeekDates(); if(!dates.length){ alert('Pick a valid week first.'); return; }
        var _o; if(btn){ btn.disabled=true; _o=btn.innerHTML; btn.innerHTML='Pulling…'; }
        var taxR=(parseFloat(document.getElementById('pcTax').value)||0)/100;
        withPin(function(pin){
            var creds={p_username:currentUser.username,p_password:pin,p_location:loc,p_days:120};
            Promise.all([
                supabaseClient.rpc('app_sales_detail',creds).then(function(r){ return (r&&!r.error&&r.data)?r.data:[]; }).catch(function(){ return []; }),
                supabaseClient.rpc('app_sales_recent',creds).then(function(r){ return r||{}; }).catch(function(){ return {error:{message:'Connection error.'}}; })
            ]).then(function(res){
                if(btn){ btn.disabled=false; btn.innerHTML=_o; }
                var rec=res[1]||{};
                if(rec.error && !(res[0]&&res[0].length)){ if(rec.error.code==='42501') sessionPin=null; alert('Error: '+(rec.error.message||'Connection error.')); return; }
                var det={}; (res[0]||[]).forEach(function(d){ det[String(d.date).slice(0,10)]=d; });
                var lump={}; ((rec.data)||[]).forEach(function(d){ lump[String(d.date).slice(0,10)]=d; });
                var salesFilled=0, laborFilled=0, splitDays=0, missing=[];
                for(var i=0;i<7;i++){
                    var dt=dates[i], d=det[dt], l=lump[dt];
                    var net=(d&&d.net!=null)?Number(d.net):((l&&l.gross!=null)?Number(l.gross):null);
                    if(net==null){ missing.push(PC_DAYS[i].slice(0,3)); continue; }
                    var target=net*(1+taxR);
                    var ap=d?(Number(d.cash||0)+Number(d.card||0)+Number(d.house||0)):0;
                    if(ap>0){
                        document.getElementById('pcDep'+i).value=(target*Number(d.cash||0)/ap).toFixed(2);
                        document.getElementById('pcMc'+i).value=(target*Number(d.card||0)/ap).toFixed(2);
                        document.getElementById('pcHos'+i).value=(target*Number(d.house||0)/ap).toFixed(2);
                        splitDays++;
                    } else {
                        document.getElementById('pcDep'+i).value=target.toFixed(2);
                    }
                    var lab=(d&&d.labor!=null)?d.labor:((l&&l.labor!=null)?l.labor:null);
                    if(lab!=null){ document.getElementById('pcHr'+i).value=Number(lab).toFixed(2); laborFilled++; }
                    var tx=(d&&d.checks!=null)?d.checks:((l&&l.tx!=null)?l.tx:null);
                    if(tx!=null){ document.getElementById('pcTx'+i).value=tx; }
                    salesFilled++;
                }
                pcCalc();
                var msg=document.getElementById('pcAutofillMsg');
                if(msg){
                    if(salesFilled===0){ msg.style.display='block'; msg.style.background='#fff4e0'; msg.style.borderColor='#f0d49a'; msg.innerHTML='⚠️ No sales found for the week of '+escapeHtml(wk)+' in the Daily Sales feed yet. Enter the days by hand, or let the Axial / POS sync fill them.'; }
                    else { msg.style.display='block'; msg.style.background='#e8f3ec'; msg.style.borderColor='#bcdcc6'; msg.innerHTML='✅ Auto-filled '+salesFilled+' day'+(salesFilled===1?'':'s')+' from Axial / POS: '+(splitDays?('cash went to <b>Deposits</b> and card to <b>MC/Visa</b> — the real split, scaled so net sales still match Axial'):('net sales grossed-up by your '+(taxR*100).toFixed(2)+'% tax into <b>Deposits</b>'))+', check counts into <b>Trans.</b>'+(laborFilled?(', and labor $ into <b>Hourly $</b> for '+laborFilled+' day'+(laborFilled===1?'':'s')):'')+'.'+(missing.length?(' No data yet for: '+missing.join(', ')+'.'):'')+'<br><span style="color:#5b6675;">Manager wages, ending inventory and food invoices stay manual.</span>'; }
                }
            }).catch(function(){ if(btn){ btn.disabled=false; btn.innerHTML=_o; } alert('Connection error.'); });
        });
    }
    function addInvoiceRow(pf){
        pf=pf||{};
        var wrap=document.getElementById('pcInvRows');
        var div=document.createElement('div');
        div.className='pc-inv-row';
        div.style.cssText='display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 0;border-bottom:1px dashed #eee;';
        div.innerHTML=
          '<input type="text" class="pc-inv-vendor" placeholder="Vendor" value="'+escapeHtml(pf.vendor||'')+'" style="flex:2;min-width:110px;padding:7px;border:1px solid #ccc;border-radius:6px;font-size:13px;">'+
          '<input type="date" class="pc-inv-date" value="'+escapeHtml(pf.inv_date||'')+'" style="flex:1;min-width:120px;padding:7px;border:1px solid #ccc;border-radius:6px;font-size:13px;">'+
          '<input type="number" inputmode="decimal" class="pc-inv-amt" oninput="pcCalc()" placeholder="Amount" value="'+(pf.amount!=null?pf.amount:'')+'" style="width:90px;padding:7px;border:1px solid #ccc;border-radius:6px;font-size:13px;">'+
          '<input type="number" inputmode="decimal" class="pc-inv-cred" oninput="pcCalc()" placeholder="Credits" value="'+(pf.credits!=null?pf.credits:'')+'" style="width:84px;padding:7px;border:1px solid #ccc;border-radius:6px;font-size:13px;">'+
          '<input type="number" inputmode="decimal" class="pc-inv-equip" oninput="pcCalc()" placeholder="Equip." value="'+(pf.equipment!=null?pf.equipment:'')+'" style="width:80px;padding:7px;border:1px solid #ccc;border-radius:6px;font-size:13px;">'+
          '<button onclick="this.parentNode.remove();pcCalc();" title="Remove" style="background:#eee;color:#c0264b;border:none;border-radius:6px;padding:7px 10px;font-size:14px;font-weight:bold;cursor:pointer;">&times;</button>';
        wrap.appendChild(div);
    }
    function pcCalc(){
        var gross=0,hourly=0;
        for(var i=0;i<7;i++){ gross+=pcNum('pcDep'+i)+pcNum('pcMc'+i)+pcNum('pcHos'+i); hourly+=pcNum('pcHr'+i); }
        var taxRate=pcNum('pcTax')/100;
        var net=(1+taxRate)>0?gross/(1+taxRate):0;
        var purchases=0;
        document.querySelectorAll('#pcInvRows .pc-inv-row').forEach(function(r){
            var a=parseFloat(r.querySelector('.pc-inv-amt').value)||0;
            var c=parseFloat(r.querySelector('.pc-inv-cred').value)||0;
            var e=parseFloat(r.querySelector('.pc-inv-equip').value)||0;
            purchases+=(a-c-e);
        });
        var cogs=pcNum('pcBeg')+purchases-pcNum('pcEnd');
        var labor=pcNum('pcMgr')+hourly;
        var prime=cogs+labor;
        document.getElementById('pcInvTotal').textContent='Total purchases: '+pcMoney(purchases);
        function band(v,lo,hi){ if(v>hi) return '#ff8a8a'; if(v<lo) return '#ffd27f'; return '#9be8b4'; }
        var pcFLo=(typeof cfgNum==='function'?cfgNum('targets','food_pct_lo',30):30), pcFHi=(typeof cfgNum==='function'?cfgNum('targets','food_pct_hi',33):33), pcLLo=(typeof cfgNum==='function'?cfgNum('targets','labor_pct_lo',18):18), pcLHi=(typeof cfgNum==='function'?cfgNum('targets','labor_pct_hi',23):23), pcPLo=(typeof cfgNum==='function'?cfgNum('targets','prime_pct_lo',48):48), pcPHi=(typeof cfgNum==='function'?cfgNum('targets','prime_pct_hi',56):56);
        var lpct=net>0?labor/net*100:0, fpct=net>0?cogs/net*100:0, ppct=net>0?prime/net*100:0;
        document.getElementById('pcSummary').innerHTML=
          '<div style="font-weight:bold;font-size:15px;margin-bottom:8px;">Live Prime Cost</div>'+
          '<div style="display:flex;flex-wrap:wrap;gap:14px;">'+
            '<div>Net sales<br><b>'+pcMoney(net)+'</b></div>'+
            '<div>Food (COGS)<br><b>'+pcMoney(cogs)+'</b> <span style="color:'+band(fpct,pcFLo,pcFHi)+';">'+(net>0?fpct.toFixed(1)+'%':'—')+'</span></div>'+
            '<div>Labor<br><b>'+pcMoney(labor)+'</b> <span style="color:'+band(lpct,pcLLo,pcLHi)+';">'+(net>0?lpct.toFixed(1)+'%':'—')+'</span></div>'+
            '<div>Prime cost<br><b>'+pcMoney(prime)+'</b> <span style="color:'+band(ppct,pcPLo,pcPHi)+';font-weight:bold;">'+(net>0?ppct.toFixed(1)+'%':'—')+'</span></div>'+
          '</div>';
    }
    function gatherPrime(){
        var days=[];
        for(var i=0;i<7;i++){ days.push({d:i,deposits:pcNum('pcDep'+i),mcvisa:pcNum('pcMc'+i),hospital:pcNum('pcHos'+i),hourly:pcNum('pcHr'+i),tx:pcNum('pcTx'+i)}); }
        var inv=[];
        document.querySelectorAll('#pcInvRows .pc-inv-row').forEach(function(r){
            var vendor=r.querySelector('.pc-inv-vendor').value.trim();
            var amt=parseFloat(r.querySelector('.pc-inv-amt').value)||0;
            if(vendor||amt){ inv.push({vendor:vendor,date:r.querySelector('.pc-inv-date').value||'',amount:amt,credits:parseFloat(r.querySelector('.pc-inv-cred').value)||0,equipment:parseFloat(r.querySelector('.pc-inv-equip').value)||0}); }
        });
        return {days:days,inv:inv};
    }
    function pcPrevObj(data){
        if(!data||!data.exists) return null;
        var days=data.days||[], invs=data.invoices||[], wk=data.week||{};
        var dep=0,mc=0,hos=0,hr=0,tx=0;
        days.forEach(function(x){ dep+=Number(x.deposits)||0; mc+=Number(x.mcvisa)||0; hos+=Number(x.hospital)||0; hr+=Number(x.hourly_labor)||0; tx+=Number(x.transactions)||0; });
        var pur=0; invs.forEach(function(x){ pur+=(Number(x.amount)||0)-(Number(x.credits)||0)-(Number(x.equipment)||0); });
        var cogs=(Number(wk.beginning_inventory)||0)+pur-(Number(wk.ending_inventory)||0);
        return {deposits:dep,mcvisa:mc,hospital:hos,cogs:cogs,mgr:Number(wk.mgr_labor)||0,hourly:hr,tx:tx};
    }
    function pcPrevWeekStr(wk){ try{ var p=wk.split('-'); var d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2])); d.setDate(d.getDate()-7); var m=('0'+(d.getMonth()+1)).slice(-2), dy=('0'+d.getDate()).slice(-2); return d.getFullYear()+'-'+m+'-'+dy; }catch(e){ return null; } }
    function savePrimeCost(){
        var loc=tempStoreLoc();
        if(!loc){ alert('No store set on your account.'); return; }
        var wk=document.getElementById('pcWeek').value;
        if(!wk){ alert('Pick the week beginning date.'); return; }
        var g=gatherPrime();
        withPin(function(pin){
            var doSave=function(prevObj){
                supabaseClient.rpc('app_prime_save',{p_username:currentUser.username,p_password:pin,p_location:loc,p_week_start:wk,p_week_end:null,p_tax:pcNum('pcTax')/100,p_mgr_labor:pcNum('pcMgr'),p_begin:pcNum('pcBeg'),p_end:pcNum('pcEnd'),p_note:document.getElementById('pcNote').value.trim(),p_days:g.days,p_invoices:g.inv}).then(function(r){
                    if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; }
                    alert('Saved for the week of '+wk+'.'+((prevObj&&prevObj._week)?(' Previous week ('+prevObj._week+') auto-filled for the comparison.'):' (No prior week on file yet — comparison will fill in next week.)')+' Building your prime cost report in your master format…');
                    var payload={store:loc,location:loc,week:wk,tax:pcNum('pcTax')/100,mgr:pcNum('pcMgr'),begin:pcNum('pcBeg'),end:pcNum('pcEnd'),days:g.days,invoices:g.inv,prev:prevObj,photos:pcInvPhotos};
                    fetch(G_URL,{method:'POST',body:new URLSearchParams({action:'prime_report',payload:JSON.stringify(payload)})}).then(function(rr){return rr.json();}).then(function(res){
                        if(res&&res.result==='ok'&&res.url){
                            supabaseClient.rpc('app_prime_set_url',{p_username:currentUser.username,p_password:pin,p_location:loc,p_week_start:wk,p_url:res.url}).then(function(){ loadPrimeRecent(); });
                            alert('Report filed ✓  Saved to Dropbox (with invoice photos), and downloadable from Recent Weeks.');
                        } else { loadPrimeRecent(); }
                    }).catch(function(){ loadPrimeRecent(); });
                }).catch(function(){ alert('Connection error.'); });
            };
            // Auto-pull the most recent prior week for this store for the Weekly Comparison tab.
            supabaseClient.rpc('app_prime_prev',{p_username:currentUser.username,p_password:pin,p_location:loc,p_before:wk}).then(function(pr){
                var pd=(pr&&pr.data&&pr.data.found)?pr.data:null;
                var prevObj=pd?{deposits:pd.deposits,mcvisa:pd.mcvisa,hospital:pd.hospital,cogs:pd.cogs,mgr:pd.mgr,hourly:pd.hourly,tx:pd.tx,_week:pd.week_start}:null;
                doSave(prevObj);
            }).catch(function(){ doSave(null); });
        });
    }
    function loadPrimeRecent(){
        var c=document.getElementById('pcRecent'); var loc=tempStoreLoc();
        if(!loc){ c.innerHTML='<p style="color:#6b7686;font-size:13px;">No store set.</p>'; return; }
        withPin(function(pin){
            supabaseClient.rpc('app_prime_list',{p_username:currentUser.username,p_password:pin,p_location:loc}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; c.innerHTML='<p style="color:red;font-size:13px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var list=r.data||[];
                if(!list.length){ c.innerHTML='<p style="color:#6b7686;font-size:13px;margin:0;">No weeks saved yet.</p>'; return; }
                function col(v,lo,hi){ if(v==null) return '#888'; if(v>hi) return '#c0264b'; if(v<lo) return '#b06a00'; return '#1b7a3d'; }
                var wkFLo=(typeof cfgNum==='function'?cfgNum('targets','food_pct_lo',30):30), wkFHi=(typeof cfgNum==='function'?cfgNum('targets','food_pct_hi',33):33), wkLLo=(typeof cfgNum==='function'?cfgNum('targets','labor_pct_lo',18):18), wkLHi=(typeof cfgNum==='function'?cfgNum('targets','labor_pct_hi',23):23), wkPLo=(typeof cfgNum==='function'?cfgNum('targets','prime_pct_lo',48):48), wkPHi=(typeof cfgNum==='function'?cfgNum('targets','prime_pct_hi',56):56);
                var html='<table style="width:100%;border-collapse:collapse;font-size:12.5px;"><tr style="color:#6b7686;text-align:left;border-bottom:1px solid #eee;"><th style="padding:6px 3px;">Week</th><th>Net</th><th>Food%</th><th>Labor%</th><th>Prime%</th><th></th></tr>';
                list.forEach(function(w){
                    html+='<tr style="border-bottom:1px solid #f3f3f3;"><td style="padding:6px 3px;">'+escapeHtml(w.week_start)+'</td>'+
                        '<td>'+pcMoney(w.net||0)+'</td>'+
                        '<td style="font-weight:bold;color:'+col(w.food_pct,wkFLo,wkFHi)+';">'+(w.food_pct!=null?w.food_pct+'%':'—')+'</td>'+
                        '<td style="font-weight:bold;color:'+col(w.labor_pct,wkLLo,wkLHi)+';">'+(w.labor_pct!=null?w.labor_pct+'%':'—')+'</td>'+
                        '<td style="font-weight:bold;color:'+col(w.prime_pct,wkPLo,wkPHi)+';">'+(w.prime_pct!=null?w.prime_pct+'%':'—')+'</td>'+
                        '<td>'+(w.xlsx_url?'<a href="'+escapeHtml(w.xlsx_url)+'" target="_blank" style="color:#0f4d27;font-weight:bold;text-decoration:none;">&#128202; Excel</a>':'')+'</td></tr>';
                });
                html+='</table>';
                c.innerHTML=html;
            }).catch(function(){ c.innerHTML='<p style="color:red;font-size:13px;">Connection error.</p>'; });
        });
    }
