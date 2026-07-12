    // ============================================================
    // PAY-RAISE DELTAS — js/25_payraise_deltas.js (ADDITIVE add-on to js/17 Team Growth)
    // Backend: payraise_deltas.sql — NEW RPCs only, nothing existing altered:
    //   app_tg_proposal_concerns, app_tg_proposal_submit_v2, app_tg_proposal_extras_save,
    //   app_tg_proposal_sheet, app_tg_typ_hours_get, app_tg_typ_hours_save,
    //   app_tg_payroll_exposure, app_tg_promo_status, app_tg_promo_recommend,
    //   app_tg_promo_queue, app_tg_promo_decide
    //
    // GET/SAVE SHAPES (mirrors of the SQL comments — keep in sync):
    //   app_tg_proposal_concerns -> { concerns:[{source,level,category,occurred_on,status}],
    //                                 count, require_justification, lookback_days }
    //   app_tg_proposal_extras_save <- p_payload { effective_date, justification, typ_weekly_hours }
    //   app_tg_proposal_sheet    -> flat object: employee_name, current_role, proposed_role,
    //                                 current_rate, proposed_rate, raise_pct, effective_date,
    //                                 raise_type, reason, justification, status, submitted_by,
    //                                 corporate_decision(_by/_at), typ_weekly_hours,
    //                                 est_weekly_impact, is_estimate, concerns_snapshot
    //   app_tg_payroll_exposure  -> { month, location, is_estimate, default_weekly_hours,
    //                                 weeks_per_month_factor, approved_count,
    //                                 approved_weekly_impact, approved_monthly_impact,
    //                                 pending_count, pending_weekly_impact,
    //                                 pending_monthly_impact, using_default_hours_count, items:[] }
    //   app_tg_promo_status      -> { readiness:{certs_ok,eval_ok,concerns_ok,recommended,ready,...},
    //                                 recommendation:{id,status,...}|null }
    //   app_tg_promo_queue       -> ARRAY of rows, each row has a live .readiness object
    //
    // ─── INTEGRATION HOOK POINTS (all inside js/17_team_growth.js) ───────────
    // HOOK 1 — proposal form extras (effective date + justification + typical
    //   weekly hours + concern banner). In tgProposalRenderForm (js/17 ~line 371),
    //   right AFTER the Reason textarea line, add:
    //       h+=tgxProposalExtrasHtml(p);
    //   and AFTER its final tgModal2Body(h); line, add:
    //       tgxProposalExtrasInit(p);
    // HOOK 2 — concern-gated submit. In tgProposalSubmitForm (js/17 ~line 409),
    //   REPLACE the inner call:
    //       tgRpc('app_tg_proposal_submit',{p_proposal_id:p.id}, function(){ ... });
    //   WITH:
    //       tgxProposalSubmit(p, function(){ tgModal2Close(); alert('Proposal submitted for corporate review.'); tgLoadPayTab(); });
    //   (tgxProposalSubmit saves the extras, enforces justification-when-concerns,
    //    then calls app_tg_proposal_submit_v2. The old RPC still works untouched
    //    for any caller not migrated yet.)
    // HOOK 3 — printable raise sheet. In tgProposalOpenView (js/17 ~line 421),
    //   just before its tgModal2Body(h); add:
    //       h+=tgxRaiseSheetBtnHtml(p.id);
    // HOOK 4 — corporate money cards on the Pay Proposals tab. In tgPayTabHtml
    //   (js/17 ~line 342) prepend to the returned html:
    //       '<div id="tgxMoneyCards"></div>'
    //   and in the tgLoadPayTab success callback (after tgBodySet) add:
    //       tgxLoadMoneyCards(_tg.store||'', null, 'tgxMoneyCards');
    // HOOK 5 — promotion queue entry. Also in tgPayTabHtml (or the corp admin
    //   tab) add near the top:
    //       h+=tgxPromoQueueBtnHtml();
    // HOOK 6 — recommend-for-promotion on My Team rows (js/17 ~line 209, next
    //   to the Submit Pay Proposal button) add:
    //       h+='<button onclick="tgxPromoRecommend('+e.employee_id+')" style="background:#f3e8f7;color:#7b2d8b;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Promotion</button>';
    //   (only the id is needed; the modal loads name + readiness itself)
    // OPTIONAL HOOK 7 — typical-hours editor anywhere an employee row exists:
    //       tgxTypHours(employeeId)
    //
    // Everything below is a top-level function (classic script tag => global).
    // Depends on shipped globals: currentUser, supabaseClient, withPin,
    // escapeHtml; reuses tgModal2Body/tgModal2Close from js/17 when present
    // (falls back to its own overlay so the file is self-testable).
    // ============================================================

    var _tgx = { concerns:null, exposure:null, month:null, queue:[], sheet:null, empId:null, empName:null, itemsOpen:false, moneyContainer:null, moneyLoc:'' };

    // ===== RPC wrapper (mirror of tgRpc / scRpc js/09:13) =====
    function tgxRpc(name,args,cb,onerr){
        withPin(function(pin){
            supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){
                if(r.error){ if(onerr) onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; }
                cb(r.data);
            }).catch(function(){ if(onerr) onerr({message:'Connection error'}); else alert('Connection error.'); });
        });
    }

    // ===== small helpers =====
    function tgxEsc(s){ return (typeof escapeHtml==='function')?escapeHtml(s==null?'':s):String(s==null?'':s); }
    function tgxMoney(n){ if(n==null||isNaN(n)) return '—'; var v=Number(n); return (v<0?'-$':'$')+Math.abs(v).toFixed(2); }
    function tgxVal(id){ var e=document.getElementById(id); return e?e.value:''; }
    function tgxNum(id){ var e=document.getElementById(id); var n=e?parseFloat(e.value):NaN; return isNaN(n)?null:n; }
    function tgxDate(d){ if(!d) return '—'; try{ return new Date(String(d).slice(0,10)+'T12:00:00').toLocaleDateString(); }catch(e){ return String(d); } }
    // modal: reuse the Team Growth secondary modal when js/17 is loaded
    function tgxModalBody(html){
        if(typeof tgModal2Body==='function') return tgModal2Body(html);
        var o=document.getElementById('tgxModal');
        if(!o){ o=document.createElement('div'); o.id='tgxModal'; o.style.cssText='position:fixed;inset:0;background:rgba(20,20,30,.5);z-index:100020;display:flex;align-items:flex-start;justify-content:center;padding:18px;overflow:auto;'; o.addEventListener('click',function(e){ if(e.target===o) o.style.display='none'; }); document.body.appendChild(o); }
        o.style.display='flex';
        o.innerHTML='<div style="background:#fff;border-radius:14px;max-width:640px;width:100%;margin-top:24px;padding:18px;box-shadow:0 16px 50px rgba(0,0,0,.3);max-height:88vh;overflow:auto;box-sizing:border-box;">'+html+'</div>';
        return o;
    }
    function tgxModalClose(){ if(typeof tgModal2Close==='function'){ tgModal2Close(); } var o=document.getElementById('tgxModal'); if(o) o.style.display='none'; }
    function tgxIsCorp(){ if(typeof tgIsCorp==='function') return tgIsCorp(); return (typeof isDiscAdmin==='function'&&isDiscAdmin())||(typeof isAdminManager==='function'&&isAdminManager()); }

    // ============================================================
    // DELTA 1 + 3 — proposal form extras + performance-concern gate
    // ============================================================
    function tgxProposalExtrasHtml(p){
        var eff=p.effective_date||p.proposed_effective_date||'';
        var h='<div id="tgxExtras" style="border-top:1px dashed #d8dbe2;margin-top:8px;padding-top:8px;">';
        h+='<div id="tgxConcernBox"></div>';
        h+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Effective date</label>';
        h+='<input type="date" id="tgxEffDate" value="'+tgxEsc(String(eff).slice(0,10))+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">';
        h+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Justification <span id="tgxJustReq" style="color:#c0264b;display:none;">(required — open performance concerns)</span></label>';
        h+='<textarea id="tgxJust" placeholder="Why this raise is justified (tie to the evaluation / performance)…" style="width:100%;min-height:56px;padding:8px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+tgxEsc(p.justification||'')+'</textarea>';
        h+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Typical weekly hours (for payroll-impact ESTIMATE)</label>';
        h+='<input type="number" step="0.5" min="0" max="100" id="tgxTypHrs" value="'+tgxEsc(p.typ_weekly_hours==null?'':p.typ_weekly_hours)+'" oninput="tgxImpactPreview()" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:9px;margin:4px 0 4px;box-sizing:border-box;">';
        h+='<div id="tgxImpactPrev" style="font-size:12px;color:#6b7686;margin-bottom:8px;"></div>';
        h+='</div>';
        return h;
    }
    function tgxProposalExtrasInit(p){
        _tgx.concerns=null;
        // prefill typical hours from the employee record if the form is blank
        if(!tgxVal('tgxTypHrs')){
            tgxRpc('app_tg_typ_hours_get',{p_employee_id:p.employee_id}, function(d){
                var e=document.getElementById('tgxTypHrs');
                if(e&&!e.value&&d){ e.value=(d.typ_weekly_hours!=null?d.typ_weekly_hours:(d.default_weekly_hours!=null?d.default_weekly_hours:'')); tgxImpactPreview(); }
            }, function(){});
        }
        tgxImpactPreview();
        tgxRpc('app_tg_proposal_concerns',{p_employee_id:p.employee_id}, function(d){
            _tgx.concerns=d||{concerns:[],count:0};
            tgxRenderConcernBox();
        }, function(){ var b=document.getElementById('tgxConcernBox'); if(b) b.innerHTML=''; });
    }
    function tgxRenderConcernBox(){
        var box=document.getElementById('tgxConcernBox'); if(!box) return;
        var d=_tgx.concerns||{}; var list=d.concerns||[];
        var req=document.getElementById('tgxJustReq');
        if(!list.length){ box.innerHTML=''; if(req) req.style.display='none'; return; }
        if(req&&d.require_justification) req.style.display='inline';
        var h='<div style="background:#fdeaea;border:1px solid #e8b4b4;color:#8a1f1f;border-radius:9px;padding:10px 12px;font-size:12.5px;margin-bottom:10px;">';
        h+='<b>&#9888; '+list.length+' open performance concern'+(list.length===1?'':'s')+' on file (last '+tgxEsc(d.lookback_days||90)+' days)</b>';
        h+=list.map(function(c){
            var what=(c.source==='coaching_note')?'Unresolved coaching note':'Active write-up';
            return '<div style="margin-top:5px;">&bull; '+what+(c.level?' — '+tgxEsc(c.level):'')+(c.category&&c.category!==c.level?' ('+tgxEsc(c.category)+')':'')+(c.occurred_on?' — '+tgxDate(c.occurred_on):'')+'</div>';
        }).join('');
        h+='<div style="margin-top:6px;font-weight:700;">'+(d.require_justification?'A justification note is required before this proposal can be submitted.':'Please review before submitting.')+'</div></div>';
        box.innerHTML=h;
    }
    function tgxImpactPreview(){
        var prev=document.getElementById('tgxImpactPrev'); if(!prev) return;
        var cur=tgxNum('tgPCurRate'), prop=tgxNum('tgPPropRate'), hrs=tgxNum('tgxTypHrs');
        if(cur==null||prop==null||hrs==null){ prev.innerHTML='Enter rates + hours to preview the estimated weekly impact.'; return; }
        var wk=(prop-cur)*hrs;
        prev.innerHTML='Estimated weekly impact: <b>'+tgxMoney(wk)+'</b> ('+tgxMoney(prop-cur)+'/hr &times; '+hrs+' hrs) — <i>ESTIMATE, not actual hours</i>. Server value is authoritative.';
    }
    function tgxCollectExtras(){
        return { effective_date:tgxVal('tgxEffDate'), justification:tgxVal('tgxJust'), typ_weekly_hours:tgxNum('tgxTypHrs') };
    }
    // Concern-gated submit — call INSTEAD of the raw app_tg_proposal_submit
    // (see HOOK 2). onDone(result) runs after a successful submit.
    function tgxProposalSubmit(p,onDone){
        if(!p||!p.id){ alert('Save the proposal first.'); return; }
        var extras=tgxCollectExtras();
        var just=String(extras.justification||'').replace(/^\s+|\s+$/g,'');
        var d=_tgx.concerns;
        if(d&&d.require_justification&&!just){
            tgxRenderConcernBox();
            var e=document.getElementById('tgxJust'); if(e) e.focus();
            alert('This employee has open performance concerns. Add a justification note to continue.');
            return;
        }
        if(d&&(d.count||0)>0&&!confirm('This employee has '+d.count+' open performance concern(s). Submit this pay proposal anyway?')) return;
        tgxRpc('app_tg_proposal_extras_save',{p_proposal_id:p.id,p_payload:extras}, function(){
            tgxRpc('app_tg_proposal_submit_v2',{p_proposal_id:p.id,p_justification:just||null}, function(res){
                if(onDone) onDone(res); else alert('Proposal submitted for corporate review.');
            }, function(err){
                var m=String((err&&err.message)||'');
                if(m.indexOf('justification_required')>=0){
                    // server-side gate (authoritative) — surface it kindly
                    var e2=document.getElementById('tgxJust'); if(e2) e2.focus();
                    alert('This employee has open performance concerns — a justification note is required before submitting.');
                } else { alert(m||'Could not submit.'); }
            });
        });
    }

    // ============================================================
    // DELTA 3 — printable one-page raise sheet
    // (print pattern mirrors fhGenReceipt/fhPrintReceipt, js/09:226-227)
    // ============================================================
    function tgxRaiseSheetBtnHtml(proposalId){
        return '<button onclick="tgxRaiseSheet('+proposalId+')" style="width:100%;margin-top:10px;background:#eef3fb;color:#185FA5;border:1px solid #cfe0f5;border-radius:10px;padding:10px;font-weight:800;cursor:pointer;">&#128424; Printable Raise Sheet</button>';
    }
    function tgxSheetRow(k,v){
        return '<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid #f0f0f0;font-size:13px;"><span style="color:#6b7686;">'+tgxEsc(k)+'</span><b style="text-align:right;">'+(v==null||v===''?'&mdash;':v)+'</b></div>';
    }
    function tgxRaiseSheet(proposalId){
        tgxRpc('app_tg_proposal_sheet',{p_proposal_id:proposalId}, function(s){
            _tgx.sheet=s||{};
            var r='<div id="tgxSheet" style="font-family:Georgia,serif;color:#222;">';
            r+='<div style="text-align:center;border-bottom:2px solid #185FA5;padding-bottom:8px;margin-bottom:10px;">';
            r+='<div style="font-size:20px;font-weight:800;color:#185FA5;">Caliche&rsquo;s Frozen Custard &mdash; Pay Raise Sheet</div>';
            r+='<div style="font-size:12px;color:#666;">Proposal #'+tgxEsc(s.id)+' &bull; Generated '+new Date().toLocaleDateString()+'</div></div>';
            r+=tgxSheetRow('Employee',tgxEsc(s.employee_name||('#'+s.employee_id)));
            r+=tgxSheetRow('Store / location',tgxEsc(s.location||''));
            r+=tgxSheetRow('Role',tgxEsc(s.current_role||'')+(s.proposed_role&&s.proposed_role!==s.current_role?' &rarr; '+tgxEsc(s.proposed_role):''));
            r+=tgxSheetRow('Current rate',tgxMoney(s.current_rate)+'/hr');
            r+=tgxSheetRow('Proposed rate',tgxMoney(s.proposed_rate)+'/hr'+(s.raise_pct!=null?' ('+tgxEsc(s.raise_pct)+'%)':''));
            r+=tgxSheetRow('Effective date',tgxDate(s.effective_date));
            r+=tgxSheetRow('Raise type',tgxEsc(String(s.raise_type||'').replace(/_/g,' ')));
            r+=tgxSheetRow('Status',tgxEsc(String(s.status||'').replace(/_/g,' ')));
            r+=tgxSheetRow('Submitted by',tgxEsc(s.submitted_by||''));
            if(s.corporate_decision) r+=tgxSheetRow('Corporate decision',tgxEsc(s.corporate_decision)+(s.corporate_decision_by?' &mdash; '+tgxEsc(s.corporate_decision_by):'')+(s.corporate_decision_at?' ('+tgxDate(s.corporate_decision_at)+')':''));
            if(s.payroll_processed_at) r+=tgxSheetRow('Payroll processed',tgxDate(s.payroll_processed_at)+(s.payroll_processed_by?' &mdash; '+tgxEsc(s.payroll_processed_by):''));
            r+=tgxSheetRow('Est. weekly payroll impact*',(s.est_weekly_impact!=null?tgxMoney(s.est_weekly_impact)+' ('+tgxEsc(s.typ_weekly_hours)+' hrs/wk)':'&mdash;'));
            if(s.reason){ r+='<div style="margin-top:10px;"><div style="font-size:11px;font-weight:800;color:#6b7686;text-transform:uppercase;">Reason</div><div style="font-size:13px;white-space:pre-wrap;">'+tgxEsc(s.reason)+'</div></div>'; }
            if(s.justification){ r+='<div style="margin-top:8px;"><div style="font-size:11px;font-weight:800;color:#6b7686;text-transform:uppercase;">Justification</div><div style="font-size:13px;white-space:pre-wrap;">'+tgxEsc(s.justification)+'</div></div>'; }
            var cs=s.concerns_snapshot||[];
            if(cs.length){ r+='<div style="margin-top:8px;"><div style="font-size:11px;font-weight:800;color:#8a1f1f;text-transform:uppercase;">Performance concerns acknowledged at submit ('+cs.length+')</div>'+cs.map(function(c){ return '<div style="font-size:12px;">&bull; '+tgxEsc(c.source==='coaching_note'?'Coaching note':'Write-up')+(c.level?' — '+tgxEsc(c.level):'')+(c.occurred_on?' — '+tgxDate(c.occurred_on):'')+'</div>'; }).join('')+'</div>'; }
            r+='<div style="margin-top:10px;font-size:10.5px;color:#6b7686;">*Weekly impact is an ESTIMATE using manager-entered typical weekly hours &mdash; not actual worked hours.</div>';
            r+='<div style="display:flex;gap:24px;margin-top:26px;">';
            ['Manager','Corporate approver','Employee'].forEach(function(who){ r+='<div style="flex:1;"><div style="border-top:1px solid #444;padding-top:4px;font-size:11px;color:#444;">'+who+' signature / date</div></div>'; });
            r+='</div></div>';
            tgxModalBody(r+'<div style="display:flex;gap:8px;margin-top:12px;"><button onclick="tgxModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Close</button><button onclick="tgxPrintSheet()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Print / Save PDF</button></div>');
        });
    }
    function tgxPrintSheet(){
        var c=document.getElementById('tgxSheet'); if(!c) return;
        var w=window.open('','_blank'); if(!w) return;
        w.document.write('<html><head><title>Pay Raise Sheet</title></head><body style="font-family:Georgia,serif;padding:24px;max-width:720px;margin:0 auto;">'+c.innerHTML+'</body></html>');
        w.document.close(); w.print();
    }

    // ============================================================
    // DELTA 4 — corporate money cards + payroll exposure (ESTIMATES)
    // ============================================================
    function tgxLoadMoneyCards(location,month,containerId){
        var el=document.getElementById(containerId||'tgxMoneyCards'); if(!el) return;
        _tgx.moneyContainer=containerId||'tgxMoneyCards'; _tgx.moneyLoc=location||''; if(month) _tgx.month=month;
        el.innerHTML='<div style="text-align:center;color:#6b7686;padding:14px;font-size:12.5px;">Loading payroll exposure&hellip;</div>';
        tgxRpc('app_tg_payroll_exposure',{p_location:_tgx.moneyLoc||null,p_month:_tgx.month||null}, function(d){
            _tgx.exposure=d||{}; _tgx.month=(d&&d.month)||_tgx.month;
            el.innerHTML=tgxMoneyCardsHtml();
        }, function(err){ el.innerHTML='<div style="color:#c0264b;font-size:12.5px;padding:8px;">'+tgxEsc((err&&err.message)||'Could not load exposure.')+'</div>'; });
    }
    function tgxMoneyMonth(dir){
        var m=_tgx.month||''; var parts=m.split('-');
        var dt=parts.length===2?new Date(parseInt(parts[0],10),parseInt(parts[1],10)-1+dir,1):new Date();
        _tgx.month=dt.getFullYear()+'-'+('0'+(dt.getMonth()+1)).slice(-2);
        tgxLoadMoneyCards(_tgx.moneyLoc,_tgx.month,_tgx.moneyContainer);
    }
    function tgxMoneyToggleItems(){ _tgx.itemsOpen=!_tgx.itemsOpen; var el=document.getElementById(_tgx.moneyContainer); if(el) el.innerHTML=tgxMoneyCardsHtml(); }
    function tgxMoneyCardsHtml(){
        var d=_tgx.exposure||{};
        var card=function(v,label,color,sub){ return '<div style="flex:1;min-width:130px;background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px;text-align:center;"><div style="font-size:19px;font-weight:800;color:'+color+';">'+v+'</div><div style="font-size:10.5px;color:#6b6275;margin-top:2px;">'+tgxEsc(label)+'</div>'+(sub?'<div style="font-size:10px;color:#9aa2ae;margin-top:2px;">'+tgxEsc(sub)+'</div>':'')+'</div>'; };
        var h='<div style="background:#f8f9fc;border:1px solid #ececf2;border-radius:14px;padding:12px;margin-bottom:14px;">';
        h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
        h+='<button onclick="tgxMoneyMonth(-1)" style="background:#eef0f3;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-weight:800;">&#8249;</button>';
        h+='<b style="flex:1;text-align:center;font-size:13px;color:#33303a;">Raise money cards &mdash; '+tgxEsc(d.month||'')+(d.location?' &bull; '+tgxEsc(d.location):' &bull; all stores')+'</b>';
        h+='<button onclick="tgxMoneyMonth(1)" style="background:#eef0f3;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;font-weight:800;">&#8250;</button></div>';
        h+='<div style="display:flex;gap:8px;flex-wrap:wrap;">';
        h+=card(String(d.approved_count!=null?d.approved_count:'—'),'Approved raises this month','#1f7a3d');
        h+=card(tgxMoney(d.approved_weekly_impact),'Est. weekly impact (approved)','#185FA5',tgxMoney(d.approved_monthly_impact)+'/mo est.');
        h+=card(String(d.pending_count!=null?d.pending_count:'—'),'Pending proposals','#9a5b00');
        h+=card(tgxMoney(d.pending_weekly_impact),'Est. weekly exposure (pending)','#a85217',tgxMoney(d.pending_monthly_impact)+'/mo est.');
        h+='</div>';
        h+='<div style="font-size:10.5px;color:#8a8f99;margin-top:8px;">&#9432; ESTIMATES ONLY &mdash; delta rate &times; manager-entered typical weekly hours (default '+tgxEsc(d.default_weekly_hours)+' hrs where missing'+(d.using_default_hours_count?'; '+d.using_default_hours_count+' using the default':'')+'). Becomes exact when clock/POS hours land.</div>';
        var items=d.items||[];
        if(items.length){
            h+='<button onclick="tgxMoneyToggleItems()" style="margin-top:8px;background:none;border:none;color:#185FA5;font-size:12px;font-weight:700;cursor:pointer;padding:0;">'+(_tgx.itemsOpen?'&#9652; Hide':'&#9662; Show')+' exposure detail ('+items.length+')</button>';
            if(_tgx.itemsOpen){
                h+='<div style="margin-top:6px;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:11.5px;">';
                h+='<tr style="color:#6b7686;text-align:left;"><th style="padding:4px 6px;">Employee</th><th style="padding:4px 6px;">Bucket</th><th style="padding:4px 6px;">Rate</th><th style="padding:4px 6px;">Hrs/wk</th><th style="padding:4px 6px;">Weekly $</th></tr>';
                items.forEach(function(it){
                    h+='<tr style="border-top:1px solid #ececf2;"><td style="padding:4px 6px;">'+tgxEsc(it.employee_name||('#'+it.employee_id))+'</td>';
                    h+='<td style="padding:4px 6px;">'+tgxEsc(it.bucket==='approved_this_month'?'approved':'pending')+'</td>';
                    h+='<td style="padding:4px 6px;">'+tgxMoney(it.current_rate)+' &rarr; '+tgxMoney(it.proposed_rate)+'</td>';
                    h+='<td style="padding:4px 6px;">'+tgxEsc(it.weekly_hours)+(it.hours_source==='default'?'*':'')+'</td>';
                    h+='<td style="padding:4px 6px;font-weight:700;">'+tgxMoney(it.weekly_impact)+'</td></tr>';
                });
                h+='</table><div style="font-size:10px;color:#9aa2ae;margin-top:3px;">* default hours (none entered for this employee)</div></div>';
            }
        }
        h+='</div>';
        return h;
    }

    // ===== typical weekly hours editor (admin-editable per employee) =====
    function tgxTypHours(empId,empName){
        _tgx.empId=empId; _tgx.empName=empName||('#'+empId);
        tgxRpc('app_tg_typ_hours_get',{p_employee_id:empId}, function(d){
            var h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="flex:1;font-size:16px;color:#1f2a44;">Typical weekly hours &mdash; '+tgxEsc(_tgx.empName)+'</b><button onclick="tgxModalClose()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div>';
            h+='<div style="font-size:12px;color:#6b7686;margin-bottom:8px;">Used ONLY for payroll-impact estimates until real clock/POS hours are available. Default when blank: '+tgxEsc(d.default_weekly_hours)+' hrs.</div>';
            h+='<input type="number" step="0.5" min="0" max="100" id="tgxHrsEdit" value="'+tgxEsc(d.typ_weekly_hours==null?'':d.typ_weekly_hours)+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:9px;margin:4px 0 12px;box-sizing:border-box;">';
            h+='<button onclick="tgxTypHoursSave()" style="width:100%;background:#1f7a3d;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">Save</button>';
            tgxModalBody(h);
        });
    }
    function tgxTypHoursSave(){
        var hrs=tgxNum('tgxHrsEdit');
        tgxRpc('app_tg_typ_hours_save',{p_employee_id:_tgx.empId,p_hours:hrs}, function(){ tgxModalClose(); alert('Saved.'); });
    }

    // ============================================================
    // DELTA 2 — Promotion-Ready (badge, recommend action, corporate queue)
    // ============================================================
    function tgxReadyChip(ok,label){ var c=ok?'#1f7a3d':'#9aa2ae'; return '<span style="background:'+c+'1a;color:'+c+';font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:99px;white-space:nowrap;">'+(ok?'&#10003; ':'&#9675; ')+tgxEsc(label)+'</span>'; }
    function tgxReadinessChips(rd){
        rd=rd||{};
        return '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px;">'
            + tgxReadyChip(rd.certs_ok,'Certs '+(rd.certs_count!=null?rd.certs_count+'/'+rd.certs_required:''))
            + tgxReadyChip(rd.eval_ok,'Eval'+(rd.eval_score!=null?' '+rd.eval_score:''))
            + tgxReadyChip(rd.concerns_ok,(rd.open_concerns?rd.open_concerns+' concern(s)':'No concerns'))
            + tgxReadyChip(rd.recommended,'Recommended')
            + (rd.ready?'<span style="background:#7b2d8b;color:#fff;font-size:10.5px;font-weight:800;padding:2px 9px;border-radius:99px;">&#127775; PROMOTION READY</span>':'')
            + '</div>';
    }
    // Manager action — recommend for promotion (HOOK 6; only the id needed)
    function tgxPromoRecommend(empId){
        _tgx.empId=empId;
        tgxRpc('app_tg_promo_status',{p_employee_id:empId}, function(d){
            var rd=(d&&d.readiness)||{}; var rec=d&&d.recommendation;
            var h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="flex:1;font-size:16px;color:#1f2a44;">Recommend for Promotion</b><button onclick="tgxModalClose()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div>';
            h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:4px;">Promotion-Ready checkpoints</div>'+tgxReadinessChips(rd);
            if(rec&&(rec.status==='pending'||rec.status==='under_review')){ h+='<div style="background:#f3e8f7;border:1px solid #dcc3e6;color:#7b2d8b;border-radius:9px;padding:8px 10px;font-size:12px;margin-top:10px;">A recommendation by '+tgxEsc(rec.recommended_by_name||'')+' is already in the corporate queue ('+tgxEsc(rec.status)+') — saving updates it.</div>'; }
            h+='<label style="font-size:12px;font-weight:700;color:#5b6675;display:block;margin-top:10px;">Target role</label>';
            h+='<input type="text" id="tgxPromoRole" value="'+tgxEsc((rec&&rec.target_role)||'')+'" placeholder="e.g. Shift Lead" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">';
            h+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Why this person is ready</label>';
            h+='<textarea id="tgxPromoNotes" style="width:100%;min-height:60px;padding:8px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+tgxEsc((rec&&rec.notes)||'')+'</textarea>';
            if(!rd.certs_ok||!rd.eval_ok||!rd.concerns_ok){ h+='<div style="background:#fff4e0;border:1px solid #ffe2a8;color:#9a5b00;border-radius:9px;padding:8px 10px;font-size:12px;margin-bottom:10px;">Some checkpoints are not met yet &mdash; you can still recommend; corporate sees the live readiness.</div>'; }
            h+='<button onclick="tgxPromoRecommendSend()" style="width:100%;background:#7b2d8b;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">Send to Corporate Queue</button>';
            tgxModalBody(h);
        });
    }
    function tgxPromoRecommendSend(){
        tgxRpc('app_tg_promo_recommend',{p_employee_id:_tgx.empId,p_payload:{target_role:tgxVal('tgxPromoRole'),notes:tgxVal('tgxPromoNotes')}}, function(){
            tgxModalClose(); alert('Recommendation sent to the corporate queue.');
        });
    }
    // Corporate queue (HOOK 5)
    function tgxPromoQueueBtnHtml(){
        return '<button onclick="tgxOpenPromoQueue()" style="width:100%;background:#f3e8f7;color:#7b2d8b;border:1px solid #dcc3e6;border-radius:10px;padding:11px;font-size:13px;font-weight:800;cursor:pointer;margin-bottom:10px;">&#127775; Promotion Queue</button>';
    }
    function tgxOpenPromoQueue(){
        tgxModalBody('<div style="text-align:center;color:#6b7686;padding:30px;">Loading promotion queue&hellip;</div>');
        tgxRpc('app_tg_promo_queue',{p_filters:{}}, function(list){
            _tgx.queue=list||[];
            tgxRenderPromoQueue();
        });
    }
    function tgxRenderPromoQueue(){
        var list=_tgx.queue||[]; var corp=tgxIsCorp();
        var h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="flex:1;font-size:16px;color:#1f2a44;">&#127775; Promotion Queue</b><button onclick="tgxModalClose()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div>';
        if(!list.length){ h+='<div style="text-align:center;color:#6b7686;padding:22px;font-size:13px;">No promotion recommendations yet. Managers add them from My Team.</div>'; }
        list.forEach(function(r){
            var open=(r.status==='pending'||r.status==='under_review');
            var sc={pending:'#9a5b00',under_review:'#7b2d8b',accepted:'#1f7a3d',declined:'#c0264b',withdrawn:'#5b6472'}[r.status]||'#5b6472';
            h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:11px 13px;margin-bottom:9px;'+(open?'':'opacity:.65;')+'">';
            h+='<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13.5px;color:#26242b;">'+tgxEsc(r.employee_name||('#'+r.employee_id))+'</b><span style="background:'+sc+'1a;color:'+sc+';font-size:10.5px;font-weight:800;padding:2px 9px;border-radius:99px;">'+tgxEsc(String(r.status).replace(/_/g,' '))+'</span></div>';
            h+='<div style="font-size:11.5px;color:#6b7686;margin-top:2px;">'+(r.target_role?'&rarr; '+tgxEsc(r.target_role)+' &bull; ':'')+(r.location?tgxEsc(r.location)+' &bull; ':'')+'by '+tgxEsc(r.recommended_by_name||'')+'</div>';
            if(r.notes) h+='<div style="font-size:12px;color:#33303a;margin-top:4px;white-space:pre-wrap;">'+tgxEsc(r.notes)+'</div>';
            h+=tgxReadinessChips(r.readiness);
            if(r.decision_notes) h+='<div style="font-size:11.5px;color:#6b7686;margin-top:4px;">Corporate: '+tgxEsc(r.decision_notes)+(r.decided_by?' &mdash; '+tgxEsc(r.decided_by):'')+'</div>';
            if(corp&&open){
                h+='<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">';
                h+='<button onclick="tgxPromoDecide('+r.id+',&quot;accepted&quot;)" style="flex:1;min-width:90px;background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:8px;font-size:12px;font-weight:800;cursor:pointer;">Accept</button>';
                h+='<button onclick="tgxPromoDecide('+r.id+',&quot;declined&quot;)" style="flex:1;min-width:90px;background:#c0264b;color:#fff;border:none;border-radius:8px;padding:8px;font-size:12px;font-weight:800;cursor:pointer;">Decline</button>';
                if(r.status!=='under_review') h+='<button onclick="tgxPromoDecide('+r.id+',&quot;under_review&quot;)" style="flex:1;min-width:90px;background:#7b2d8b;color:#fff;border:none;border-radius:8px;padding:8px;font-size:12px;font-weight:800;cursor:pointer;">Under Review</button>';
                h+='<button onclick="tgxPromoDecide('+r.id+',&quot;withdrawn&quot;)" style="flex:1;min-width:90px;background:#5b6472;color:#fff;border:none;border-radius:8px;padding:8px;font-size:12px;font-weight:800;cursor:pointer;">Withdraw</button>';
                h+='</div>';
            }
            h+='</div>';
        });
        tgxModalBody(h);
    }
    function tgxPromoDecide(recId,decision){
        var notes=prompt('Notes for this decision (optional):','')||'';
        if(!confirm('Confirm: '+decision.replace(/_/g,' ')+' this promotion recommendation?')) return;
        tgxRpc('app_tg_promo_decide',{p_rec_id:recId,p_decision:decision,p_notes:notes}, function(){ tgxOpenPromoQueue(); });
    }
    // Optional async badge for team rows: tgxPromoBadgeInto('someElId', empId)
    function tgxPromoBadgeInto(elId,empId){
        tgxRpc('app_tg_promo_status',{p_employee_id:empId}, function(d){
            var el=document.getElementById(elId); if(!el) return;
            var rd=(d&&d.readiness)||{};
            el.innerHTML=rd.ready?'<span style="background:#7b2d8b;color:#fff;font-size:10.5px;font-weight:800;padding:2px 9px;border-radius:99px;">&#127775; PROMOTION READY</span>':'';
        }, function(){});
    }

// ── Pay Tools launcher (self-contained; corporate money cards + promo queue) ──
window.openPayTools = function(){
  var loc = (typeof activeStoreLoc==='function' ? activeStoreLoc() : '') || '';
  var h = '<div style="background:#fff;border-radius:14px;max-width:820px;width:100%;margin:0 auto;padding:20px;">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
    + '<h2 style="margin:0;font-size:20px;color:#185FA5;">&#128179; Pay Tools</h2>'
    + '<button onclick="tgxModalClose()" style="background:#eef0f3;border:none;border-radius:9px;padding:8px 14px;font-weight:700;cursor:pointer;">Close</button></div>'
    + '<div style="font-size:12.5px;color:#6b7686;margin-bottom:12px;">Approved raises this month, estimated payroll impact, and the promotion-ready queue. Figures marked ESTIMATE use typical weekly hours until real hours are available.</div>'
    + '<div id="tgxMoneyCards"></div>'
    + '<div style="margin-top:14px;">' + (typeof tgxPromoQueueBtnHtml==='function'?tgxPromoQueueBtnHtml():'') + ' <button onclick="tgxAdjustPanel()" style="background:#7b2d8b;color:#fff;border:none;border-radius:9px;padding:10px 16px;font-weight:800;cursor:pointer;margin-left:8px;">Adjust an approved raise</button></div>'
    + '</div>';
  tgxModalBody(h);
  if(typeof tgxLoadMoneyCards==='function') tgxLoadMoneyCards(loc, null, 'tgxMoneyCards');
};

// ── Adjust an APPROVED raise (amend / reverse / supersede) with history ──
window.tgxAdjustPanel = function(){
  tgxRpc('app_tg_proposal_list', {}, function(rows){
    rows = rows || [];
    var appr = rows.filter(function(p){
      var st=(p.status||'')+' '+(p.corporate_decision||'');
      return /approv|payroll|superseded/i.test(st) || p.payroll_processed_at;
    });
    var list = appr.length ? appr.map(function(p){
      var who = tgxEsc(p.employee_name||p.name||p.contact_name||('Employee #'+p.employee_id));
      return '<div style="border-top:1px solid #eef0f3;padding:8px 0;display:flex;justify-content:space-between;align-items:center;gap:10px;">'
        + '<div style="font-size:13px;"><b>'+who+'</b><div style="color:#6b7686;font-size:12px;">'+tgxMoney(p.current_rate)+' &rarr; '+tgxMoney(p.proposed_rate)+' &middot; '+tgxEsc(p.status||'')+'</div></div>'
        + '<button onclick="tgxAdjustOpen('+p.id+','+(Number(p.proposed_rate)||0)+')" style="background:#7b2d8b;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;">Adjust</button></div>';
    }).join('') : '<div style="color:#6b7686;font-size:13px;padding:14px 0;">No approved raises to adjust yet.</div>';
    var h='<div style="background:#fff;border-radius:14px;max-width:640px;width:100%;margin:0 auto;padding:20px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><h2 style="margin:0;font-size:19px;color:#7b2d8b;">Adjust an approved raise</h2>'
      + '<button onclick="openPayTools()" style="background:#eef0f3;border:none;border-radius:9px;padding:8px 14px;font-weight:700;cursor:pointer;">&larr; Back</button></div>'
      + '<div style="font-size:12px;color:#6b7686;margin-bottom:6px;">Amend the rate/effective date, reverse it, or supersede with a new one. Every change is logged. Remember to key the new rate into Aloha to make it effective on payroll.</div>'
      + list + '</div>';
    tgxModalBody(h);
  });
};
window.tgxAdjustOpen = function(id, curRate){
  var h='<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;margin:0 auto;padding:20px;">'
    + '<h2 style="margin:0 0 10px;font-size:18px;color:#7b2d8b;">Adjust raise #'+id+'</h2>'
    + '<label style="font-size:12px;font-weight:700;color:#3a4352;">Action</label>'
    + '<select id="tgxAdjAction" onchange="(function(){var r=document.getElementById(\'tgxAdjRateWrap\');r.style.display=document.getElementById(\'tgxAdjAction\').value===\'reverse\'?\'none\':\'block\';})()" style="width:100%;padding:9px;border:1px solid #d8dbe3;border-radius:8px;margin:4px 0 10px;">'
    + '<option value="amend">Amend (correct the rate/date)</option><option value="supersede">Supersede (replace with a new raise)</option><option value="reverse">Reverse (undo, back to old rate)</option></select>'
    + '<div id="tgxAdjRateWrap"><label style="font-size:12px;font-weight:700;color:#3a4352;">New rate ($/hr)</label>'
    + '<input id="tgxAdjRate" type="number" step="0.01" value="'+(curRate||'')+'" style="width:100%;padding:9px;border:1px solid #d8dbe3;border-radius:8px;margin:4px 0 10px;">'
    + '<label style="font-size:12px;font-weight:700;color:#3a4352;">New effective date</label>'
    + '<input id="tgxAdjDate" type="date" style="width:100%;padding:9px;border:1px solid #d8dbe3;border-radius:8px;margin:4px 0 10px;"></div>'
    + '<label style="font-size:12px;font-weight:700;color:#3a4352;">Reason</label>'
    + '<textarea id="tgxAdjReason" rows="2" style="width:100%;padding:9px;border:1px solid #d8dbe3;border-radius:8px;margin:4px 0 12px;" placeholder="Why is this being adjusted?"></textarea>'
    + '<div style="display:flex;gap:8px;"><button onclick="tgxAdjustPanel()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button>'
    + '<button onclick="tgxAdjustSave('+id+')" style="flex:2;background:#7b2d8b;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Save adjustment</button></div>'
    + '<div style="font-size:11px;color:#6b7686;margin-top:8px;">Hub record only &mdash; enter the new rate in Aloha for payroll.</div></div>';
  tgxModalBody(h);
};
window.tgxAdjustSave = function(id){
  var act=tgxVal('tgxAdjAction')||'amend';
  var rate=act==='reverse'?null:(parseFloat(tgxVal('tgxAdjRate'))||null);
  var date=act==='reverse'?null:(tgxVal('tgxAdjDate')||null);
  var reason=tgxVal('tgxAdjReason')||'';
  if(!reason.trim()){ alert('Please add a reason.'); return; }
  tgxRpc('app_tg_proposal_adjust', {p_proposal_id:id, p_action:act, p_new_rate:rate, p_new_effective_date:date, p_reason:reason}, function(r){
    alert((r&&r.reminder)||'Adjustment saved. Enter the new rate in Aloha for payroll.');
    tgxAdjustPanel();
  }, function(e){ alert(String(e&&e.message||'').indexOf('forbidden')>=0?'Leadership only.':(e&&e.message)||'Error'); });
};
