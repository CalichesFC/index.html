    // ============================================================
    // TEAM GROWTH & EVALUATIONS — js/17_team_growth.js
    // One connected employee-development section: My Growth Path (self),
    // My Team (manager dashboard), Evaluations, Pay Proposals, Pay Rules/Admin.
    // Raises are never automatic — every pay proposal requires a human
    // corporate decision (app_tg_proposal_decide). See specs/PLAN_evaluations_build.md.
    // ============================================================
    var _tg = { tab:'my', store:'', myData:null, mgrData:null, statusLabels:[], evalList:[], evalTemplates:[], proposalList:[], payRanges:[], evalDraft:null, proposalDraft:null, rosterCache:null, corpData:null, corpReport:null };

    var TG_EVAL_TYPES = [
        ['30-day','30-Day Review'],
        ['skill-cert','Skill Certification'],
        ['standard','Standard Review'],
        ['leadership','Leadership Review'],
        ['promotion-readiness','Promotion Readiness'],
        ['pay-raise','Pay Raise Review'],
        ['performance-improvement','Performance Improvement']
    ];
    var TG_CHECKLIST_ITEMS = [
        ['eval_current','Current evaluation on file supporting this raise'],
        ['no_open_concerns','No unresolved performance concerns'],
        ['time_in_role','Meets minimum time-in-role for this raise type'],
        ['cert_current','Required certifications are current'],
        ['budget_confirmed','Budget confirmed with corporate / ownership'],
        ['manager_reviewed','Manager has reviewed the configured pay range for this role & location']
    ];
    var TG_STATUS_COLORS = { 'On Track':'#1f7a3d', 'Review Due':'#9a5b00', 'Review Overdue':'#c0264b', 'Eligible':'#185FA5', 'Concern':'#c0264b', 'Promotion Ready':'#7b2d8b', 'Corporate Review':'#a85217' };

    // ===== role helpers =====
    function tgIsMgr(){ return typeof isManagerRole==='function' && isManagerRole(); }
    function tgIsCorp(){ return (typeof isDiscAdmin==='function' && isDiscAdmin()) || (typeof isAdminManager==='function' && isAdminManager()); }

    // ===== RPC wrapper (mirrors scRpc / js/09:13) =====
    function tgRpc(name,args,cb,onerr){
        withPin(function(pin){
            supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){
                if(r.error){ if(onerr) onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; }
                cb(r.data);
            }).catch(function(){ if(onerr) onerr({message:'Connection error'}); else alert('Connection error.'); });
        });
    }

    // ===== small html helpers =====
    function tgAttrEsc(s){ return String(s==null?'':s).replace(/'/g,"\\'").replace(/"/g,'&quot;'); }
    function tgLoadingHtml(msg){ return '<div style="text-align:center;color:#6b7686;padding:40px 16px;">'+escapeHtml(msg||'Loading…')+'</div>'; }
    function tgErrHtml(msg){ return '<div style="text-align:center;color:#c0264b;padding:30px 16px;">'+escapeHtml(msg||'Something went wrong.')+'</div>'; }
    function tgEmptyCard(msg,sub){ return '<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:22px;text-align:center;color:#6b6275;"><div style="font-size:14px;font-weight:700;color:#33303a;">'+escapeHtml(msg||'')+'</div>'+(sub?('<div style="font-size:12.5px;margin-top:5px;">'+escapeHtml(sub)+'</div>'):'')+'</div>'; }
    function tgField(label,id,val,type){ return '<label style="font-size:12px;font-weight:700;color:#5b6675;">'+escapeHtml(label)+'</label><input type="'+(type||'text')+'" id="'+id+'" value="'+escapeHtml(val==null?'':val)+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'; }
    function tgVal(id){ var e=document.getElementById(id); return e?e.value:''; }
    function tgNum(id){ var e=document.getElementById(id); var n=e?parseFloat(e.value):NaN; return isNaN(n)?null:n; }
    function tgSummaryCard(v,label,color){ return '<div style="flex:1;min-width:96px;background:#fff;border:1px solid #ececf2;border-radius:12px;padding:10px;text-align:center;"><div style="font-size:20px;font-weight:800;color:'+color+';">'+(v==null?'—':v)+'</div><div style="font-size:10.5px;color:#6b6275;margin-top:2px;">'+escapeHtml(label)+'</div></div>'; }
    function tgStatusBadge(label){ if(!label) return ''; var c=TG_STATUS_COLORS[label]||'#5b6472'; return '<span style="background:'+c+'1a;color:'+c+';font-size:11px;font-weight:800;padding:3px 9px;border-radius:99px;">'+escapeHtml(label)+'</span>'; }
    function tgEvalStatusBadge(s){ var m={draft:'#9aa7b4',submitted:'#9a5b00',acknowledged:'#1f7a3d',corporate_review:'#7b2d8b',finalized:'#185FA5'}; var c=m[s]||'#5b6472'; return '<span style="background:'+c+'1a;color:'+c+';font-size:11px;font-weight:800;padding:2px 9px;border-radius:99px;">'+escapeHtml(s||'draft')+'</span>'; }
    function tgProposalStatusBadge(s){ var m={draft:'#9aa7b4',submitted:'#9a5b00',needs_info:'#c0264b',corporate_review:'#7b2d8b',approved:'#1f7a3d',denied:'#c0264b',delayed:'#9a5b00',payroll_processed:'#185FA5',cancelled:'#5b6472'}; var c=m[s]||'#5b6472'; return '<span style="background:'+c+'1a;color:'+c+';font-size:11px;font-weight:800;padding:2px 9px;border-radius:99px;">'+escapeHtml(String(s||'draft').replace(/_/g,' '))+'</span>'; }

    // ===== overlay shell (clone of tdOverlay/tdHeader/tdTabs/tdRender, js/08:615-637) =====
    function tgOverlay(){ var ov=document.getElementById('teamGrowthModal'); if(!ov){ ov=document.createElement('div'); ov.id='teamGrowthModal'; ov.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100000;overflow:auto;'; document.body.appendChild(ov); } ov.style.display='block'; return ov; }
    function tgClose(){ var ov=document.getElementById('teamGrowthModal'); if(ov) ov.style.display='none'; var m=document.getElementById('tgModal2'); if(m) m.style.display='none'; }
    function tgHeader(title,back){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;">'+(back?'<button onclick="'+back+'" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;">&#8249; Back</button>':'')+'<b style="flex:1;font-size:16px;">'+escapeHtml(title||'Team Growth &amp; Evaluations')+'</b><button onclick="tgClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }

    // secondary centered modal used for forms (mirrors certOverlay pattern, js/04:21)
    function tgModal2(){ var o=document.getElementById('tgModal2'); if(!o){ o=document.createElement('div'); o.id='tgModal2'; o.style.cssText='position:fixed;inset:0;background:rgba(20,20,30,.5);z-index:100010;display:flex;align-items:flex-start;justify-content:center;padding:18px;overflow:auto;'; o.addEventListener('click',function(e){ if(e.target===o) o.style.display='none'; }); document.body.appendChild(o); } o.style.display='flex'; return o; }
    function tgModal2Close(){ var o=document.getElementById('tgModal2'); if(o) o.style.display='none'; }
    function tgModal2Body(html){ var o=tgModal2(); o.innerHTML='<div style="background:#fff;border-radius:14px;max-width:640px;width:100%;margin-top:24px;padding:18px;box-shadow:0 16px 50px rgba(0,0,0,.3);max-height:88vh;overflow:auto;box-sizing:border-box;">'+html+'</div>'; return o; }

    function tgTabsAllowed(){
        var t=[{id:'my',label:'My Growth Path'}];
        if(tgIsMgr()) t.push({id:'mgr',label:'My Team'},{id:'eval',label:'Evaluations'},{id:'pay',label:'Pay Proposals'});
        if(tgIsCorp()) t.push({id:'corp',label:'Company'},{id:'admin',label:'Pay Rules / Admin'});
        return t;
    }
    function tgTabBar(){
        var t=_tg.tab; var tabs=tgTabsAllowed();
        if(tabs.length<2) return '';
        return '<div style="display:flex;gap:6px;max-width:900px;margin:14px auto 0;padding:0 16px;flex-wrap:wrap;">'+tabs.map(function(x){
            return '<button onclick="tgSetTab(&quot;'+x.id+'&quot;)" style="flex:1;min-width:120px;background:'+(t===x.id?'#185FA5':'#eef0f3')+';color:'+(t===x.id?'#fff':'#5b6472')+';border:none;padding:10px;font-size:12.5px;font-weight:700;cursor:pointer;border-radius:9px;">'+escapeHtml(x.label)+'</button>';
        }).join('')+'</div>';
    }
    function tgSetTab(id){ _tg.tab=id; tgRender(); }

    function openTeamGrowth(){
        var tabs=tgTabsAllowed(); var ids=tabs.map(function(t){return t.id;});
        if(ids.indexOf(_tg.tab)<0) _tg.tab=ids[0]||'my';
        tgRender();
    }
    function tgRender(){
        var ov=tgOverlay();
        ov.innerHTML=tgHeader('Team Growth & Evaluations')+tgTabBar()+'<div id="tgBody" style="max-width:900px;margin:0 auto;padding:14px 16px 50px;box-sizing:border-box;">'+tgLoadingHtml()+'</div>';
        tgLoadTab();
    }
    function tgBodySet(html){ var b=document.getElementById('tgBody'); if(b) b.innerHTML=html; }
    function tgLoadTab(){
        if(_tg.tab==='mgr') tgLoadMgrDash();
        else if(_tg.tab==='eval') tgLoadEvalTab();
        else if(_tg.tab==='pay') tgLoadPayTab();
        else if(_tg.tab==='corp') tgLoadCorpTab();
        else if(_tg.tab==='admin') tgLoadAdminTab();
        else tgLoadMyGrowth();
    }

    // ===== roster helper (used by Start Evaluation / New Pay Proposal employee pickers) =====
    function tgEnsureEmpList(cb){
        var emps=(_tg.mgrData&&_tg.mgrData.employees)||_tg.rosterCache;
        if(emps && emps.length){ cb(emps); return; }
        withPin(function(pin){
            supabaseClient.rpc('app_roster_list',{p_username:currentUser.username,p_password:pin}).then(function(r){
                var list=(r&&r.data&&(r.data.employees||r.data))||[];
                _tg.rosterCache=list; cb(list);
            }).catch(function(){ cb([]); });
        });
    }

    // ============================================================
    // MY GROWTH PATH (everyone, self, read-only) — app_tg_my_growth
    // ============================================================
    function tgLoadMyGrowth(){
        tgBodySet(tgLoadingHtml('Loading your growth path…'));
        tgRpc('app_tg_my_growth',{}, function(d){ _tg.myData=d||{}; tgBodySet(tgMyGrowthHtml()); }, function(err){ tgBodySet(tgErrHtml(err&&err.message)); });
    }
    function tgMyGrowthHtml(){
        var d=_tg.myData||{};
        var h='';
        h+='<div style="background:linear-gradient(135deg,#185FA5,#1f7a3d);color:#fff;border-radius:14px;padding:18px;margin-bottom:14px;">';
        h+='<div style="font-size:12px;opacity:.85;text-transform:uppercase;letter-spacing:.4px;">Your Growth Path</div>';
        h+='<div style="font-size:20px;font-weight:800;margin-top:4px;">'+escapeHtml(d.name||(currentUser&&currentUser.name)||'')+'</div>';
        if(d.level) h+='<div style="font-size:13px;margin-top:6px;opacity:.95;">Current level: <b>'+escapeHtml(d.level)+'</b></div>';
        h+='</div>';

        var pp=d.passport||{};
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;">';
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Development Passport</div>';
        if(pp.level && typeof passportMeter==='function'){
            h+=passportMeter(pp.level);
            h+='<div style="font-size:12.5px;color:#5b6675;margin-top:6px;">'+escapeHtml(pp.level)+(pp.total?(' &middot; '+(pp.done||0)+'/'+pp.total+' stations'):'')+'</div>';
        } else {
            h+='<div style="font-size:13px;color:#6b6275;">Your passport progress will show here once training begins.</div>';
        }
        h+='</div>';

        var certs=d.certs||[];
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;">';
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Certifications</div>';
        if(!certs.length) h+='<div style="font-size:13px;color:#6b6275;">No certifications on file yet.</div>';
        else certs.forEach(function(c){ h+='<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f3f4f8;"><span style="font-size:13px;color:#26242b;">'+escapeHtml(c.name||c.cert_type||'')+'</span>'+(typeof certExpiryBadge==='function'?certExpiryBadge(c.expires_on||c.expiry):'')+'</div>'; });
        h+='</div>';

        var rec=d.recognition||[];
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;">';
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Recognition</div>';
        if(!rec.length) h+='<div style="font-size:13px;color:#6b6275;">No shout-outs yet — keep it up!</div>';
        else rec.slice(0,6).forEach(function(r){ h+='<div style="padding:7px 0;border-bottom:1px solid #f3f4f8;"><div style="font-size:13px;color:#26242b;">&#127881; '+escapeHtml(r.message||r.type||'')+'</div><div style="font-size:11px;color:#8a93a3;">'+escapeHtml((r.created_at||'').slice(0,10))+'</div></div>'; });
        h+='</div>';

        var pending=(d.evaluations||[]).filter(function(e){ return e.status==='submitted' && e.employee_ack_status!=='acknowledged'; });
        if(pending.length){
            h+='<div style="background:#fff7e6;border:1px solid #ffe2a8;border-radius:14px;padding:16px;margin-bottom:12px;">';
            h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#9a5b00;margin-bottom:8px;">Needs your acknowledgement</div>';
            pending.forEach(function(e){ h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 0;"><span style="flex:1;font-size:13px;color:#33303a;">'+escapeHtml(e.eval_type||'Evaluation')+' &middot; '+escapeHtml((e.eval_date||'').slice(0,10))+'</span><button onclick="tgEvalAck('+e.id+')" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;">Acknowledge</button></div>'; });
            h+='</div>';
        }

        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;">';
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Next Review</div>';
        if(d.next_review_date) h+='<div style="font-size:13px;color:#26242b;">'+escapeHtml(d.next_review_type||'Review')+' expected around <b>'+escapeHtml((d.next_review_date||'').slice(0,10))+'</b></div>';
        else h+='<div style="font-size:13px;color:#6b6275;">No review scheduled yet.</div>';
        h+='</div>';

        h+='<div style="background:#eef3fb;border:1px solid #cfe0f5;border-radius:14px;padding:16px;">';
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#185FA5;margin-bottom:6px;">Your Next Step</div>';
        h+='<div style="font-size:13.5px;color:#1f2a44;">'+escapeHtml(d.next_step||'Keep building your skills — talk to your manager about what\'s next.')+'</div>';
        h+='</div>';

        return h;
    }
    function tgEvalAck(evalId){
        if(!confirm('Acknowledge this evaluation?')) return;
        tgRpc('app_tg_eval_ack',{p_evaluation_id:evalId}, function(){ tgLoadMyGrowth(); });
    }

    // ============================================================
    // MY TEAM (managers) — app_tg_mgr_dashboard + app_tg_status_labels
    // ============================================================
    function tgLoadMgrDash(){
        tgBodySet(tgLoadingHtml('Loading your team…'));
        tgRpc('app_tg_mgr_dashboard',{p_location:_tg.store||''}, function(d){
            _tg.mgrData=d||{};
            tgRpc('app_tg_status_labels',{p_location:_tg.store||''}, function(labels){ _tg.statusLabels=labels||[]; tgBodySet(tgMgrDashHtml()); }, function(){ _tg.statusLabels=[]; tgBodySet(tgMgrDashHtml()); });
        }, function(err){ tgBodySet(tgErrHtml(err&&err.message)); });
    }
    function tgMgrDashHtml(){
        var d=_tg.mgrData||{}; var summary=d.summary||d.cards||{};
        var stores=[''].concat((typeof HUB_STORES!=='undefined'?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell']));
        var h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;"><span style="font-size:12px;color:#6b6275;">Store</span><select onchange="_tg.store=this.value; tgLoadMgrDash();" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:9px;font-size:13px;">'+stores.map(function(s){return '<option value="'+escapeHtml(s)+'"'+(_tg.store===s?' selected':'')+'>'+escapeHtml(s||'All stores')+'</option>';}).join('')+'</select></div>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">';
        h+=tgSummaryCard(summary.team_size,'Team','#185FA5');
        h+=tgSummaryCard(summary.reviews_due,'Reviews due','#9a5b00');
        h+=tgSummaryCard(summary.eligible,'Eligible','#1f7a3d');
        h+=tgSummaryCard(summary.concerns,'Concerns','#c0264b');
        h+=tgSummaryCard(summary.promotion_ready,'Promotion ready','#7b2d8b');
        h+='</div>';
        var emps=d.employees||d.team||[];
        var labelMap={}; (_tg.statusLabels||[]).forEach(function(l){ labelMap[l.employee_id]=l.label||l.status_label; });
        if(!emps.length) return h+tgEmptyCard('No team members here yet.','Once employees are on the roster for this store, they\'ll show up here.');
        emps.forEach(function(e){
            var label=e.status_label||labelMap[e.employee_id]||'';
            h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px 14px;margin-bottom:9px;box-shadow:0 2px 6px rgba(0,0,0,.04);">';
            h+='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(e.name||('#'+e.employee_id))+'</b><span style="font-size:11.5px;color:#5b6675;">'+escapeHtml(e.role||'')+'</span>'+tgStatusBadge(label)+'</div>';
            h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">';
            h+='<button onclick="tgEvalStartPrep('+e.employee_id+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Start Evaluation</button>';
            h+='<button onclick="tgProposalNewPrep('+e.employee_id+')" style="background:#e8f5ec;color:#1b7a3d;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Submit Pay Proposal</button>';
            if(typeof tgxPromoRecommend==='function') h+='<button onclick="tgxPromoRecommend('+e.employee_id+')" style="background:#f3e8f7;color:#7b2d8b;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Promotion</button>';
            if(typeof openShoutout==='function') h+='<button onclick="tgAddRecognition('+e.employee_id+')" style="background:#fff4e0;color:#9a5b00;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Add Recognition</button>';
            h+='<button onclick="tgViewProfile('+e.employee_id+')" style="background:#f4f5f8;color:#5b6472;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">View Profile</button>';
            if(tgCanPip()) h+='<button onclick="tgPipStart('+e.employee_id+')" style="background:#fdeaea;color:#b4264b;border:none;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">PIP</button>';
            h+='</div></div>';
        });
        return h;
    }
    function tgAddRecognition(empId){ tgClose(); if(typeof openShoutout==='function') openShoutout(); }
    // Employee detail inside Team Growth: Development card (app_tg_spine) +
    // Active-PIP chip / PIP action (lazy app_pip_active — one call per detail
    // view, never per row) + eval/proposal history. Full roster profile is one
    // tap away via "Open full profile".
    function tgViewProfile(empId){ tgGrowthProfileView(empId); }
    function tgGrowthProfileView(empId){
        tgRpc('app_tg_growth_profile',{p_employee_id:empId}, function(d){
            var emp=(d&&d.employee)||{};
            var nm=emp.name||(d&&d.name)||('Employee #'+empId);
            var h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><b style="flex:1;font-size:16px;color:#1f2a44;">'+escapeHtml(nm)+'</b><span id="tgPipChip"></span><button onclick="tgModal2Close()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div>';
            h+='<div style="font-size:12px;color:#6b7686;margin-bottom:10px;">'+escapeHtml(emp.location||'')+(emp.wage!=null?(' &middot; '+tgMoneyC(emp.wage)+'/hr'):'')+'</div>';
            h+='<div id="tgPipRow"></div>';
            h+='<div id="tgSpineCard">'+tgLoadingHtml('Loading development…')+'</div>';
            var evs=(d&&d.evaluations)||[];
            h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px;margin-bottom:10px;">';
            h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:6px;">Evaluations</div>';
            if(!evs.length) h+='<div style="font-size:12px;color:#9aa2ae;">No evaluations yet.</div>';
            else evs.slice(0,6).forEach(function(e){ h+='<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f3f4f8;"><span style="flex:1;font-size:12.5px;color:#26242b;">'+escapeHtml(e.eval_type||'')+' &middot; '+escapeHtml(String(e.eval_date||'').slice(0,10))+'</span>'+(e.overall_score!=null?('<b style="font-size:12.5px;color:#185FA5;">'+escapeHtml(String(e.overall_score))+'</b>'):'')+tgEvalStatusBadge(e.status)+'</div>'; });
            h+='</div>';
            var prs=(d&&d.proposals)||[];
            h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px;margin-bottom:10px;">';
            h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:6px;">Pay proposals</div>';
            if(!prs.length) h+='<div style="font-size:12px;color:#9aa2ae;">No pay proposals yet.</div>';
            else prs.slice(0,6).forEach(function(p){ h+='<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f3f4f8;"><span style="flex:1;font-size:12.5px;color:#26242b;">'+(p.proposed_rate!=null?(tgMoneyC(p.proposed_rate)+'/hr'):'&mdash;')+(p.proposed_role?(' &middot; '+escapeHtml(p.proposed_role)):'')+'</span>'+tgProposalStatusBadge(p.status)+'</div>'; });
            h+='</div>';
            if(typeof openEmployeeProfile==='function') h+='<button onclick="tgOpenFullProfile('+empId+')" style="width:100%;background:#f4f5f8;color:#5b6472;border:none;border-radius:10px;padding:10px;font-weight:700;cursor:pointer;">Open full profile</button>';
            tgModal2Body(h);
            tgSpineLoad(empId);
            tgPipLoad(empId);
        });
    }
    function tgOpenFullProfile(empId){ tgModal2Close(); tgClose(); if(typeof openEmployeeProfile==='function') openEmployeeProfile(empId); }

    // ============================================================
    // EVALUATIONS (managers start/submit; self ack) —
    // app_tg_eval_templates / app_tg_eval_start / app_tg_eval_save /
    // app_tg_eval_submit / app_tg_eval_ack / app_tg_eval_list / app_tg_eval_get
    // ============================================================
    function tgLoadEvalTab(){
        tgBodySet(tgLoadingHtml('Loading evaluations…'));
        tgRpc('app_tg_eval_list',{p_filters:{location:_tg.store||''}}, function(d){ _tg.evalList=d||[]; tgBodySet(tgEvalTabHtml()); }, function(err){ tgBodySet(tgErrHtml(err&&err.message)); });
    }
    function tgEvalTabHtml(){
        var h='<button onclick="tgEvalStartPrep()" style="width:100%;background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:800;cursor:pointer;margin-bottom:14px;">&#10133; Start Evaluation</button>';
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Evaluation History</div>';
        if(!_tg.evalList.length){ h+=tgEmptyCard('No evaluations yet.','Start the first evaluation above.'); return h; }
        _tg.evalList.forEach(function(e){
            h+='<div onclick="tgEvalOpen('+e.id+')" style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px 14px;margin-bottom:9px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.04);">'+
               '<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(e.employee_name||('Employee #'+e.employee_id))+'</b>'+tgEvalStatusBadge(e.status)+'</div>'+
               '<div style="font-size:12px;color:#5b6675;margin-top:4px;">'+escapeHtml(e.eval_type||'')+' &middot; '+escapeHtml((e.eval_date||'').slice(0,10))+(e.overall_score!=null?(' &middot; score '+e.overall_score):'')+'</div></div>';
        });
        return h;
    }
    function tgEvalStartPrep(empId){
        tgEnsureEmpList(function(emps){
            tgRpc('app_tg_eval_templates',{}, function(tpls){
                _tg.evalTemplates=tpls||[];
                var body='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="flex:1;font-size:16px;color:#1f2a44;">Start Evaluation</b><button onclick="tgModal2Close()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div>';
                body+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Employee</label><select id="tgEvEmp" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+(emps.length?emps.map(function(e){ var id=e.employee_id||e.id; return '<option value="'+id+'"'+(empId===id?' selected':'')+'>'+escapeHtml(e.name||('#'+id))+'</option>'; }).join(''):'<option value="">No team found</option>')+'</select>';
                body+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Evaluation type</label><select id="tgEvType" onchange="tgEvalRenderTemplatePicker()" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+TG_EVAL_TYPES.map(function(t){return '<option value="'+t[0]+'">'+t[1]+'</option>';}).join('')+'</select>';
                body+='<div id="tgEvTplWrap"></div>';
                body+='<button onclick="tgEvalStartGo()" style="width:100%;background:#1f7a3d;color:#fff;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:800;cursor:pointer;margin-top:6px;">Continue</button>';
                tgModal2Body(body);
                tgEvalRenderTemplatePicker();
            }, function(err){ alert(err&&err.message||'Could not load templates.'); });
        });
    }
    function tgEvalRenderTemplatePicker(){
        var typeSel=document.getElementById('tgEvType'); var type=typeSel?typeSel.value:'';
        var wrap=document.getElementById('tgEvTplWrap'); if(!wrap) return;
        var matches=(_tg.evalTemplates||[]).filter(function(t){ return !type || t.eval_type===type; });
        if(!matches.length){ wrap.innerHTML='<div style="font-size:12.5px;color:#9a5b00;background:#fff7e6;border:1px solid #ffe2a8;border-radius:9px;padding:9px;margin-bottom:10px;">No template configured for this type yet — ask an admin to add one in Pay Rules / Admin.</div>'; return; }
        wrap.innerHTML='<label style="font-size:12px;font-weight:700;color:#5b6675;">Template</label><select id="tgEvTpl" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+matches.map(function(t){return '<option value="'+t.id+'">'+escapeHtml(t.title||t.eval_type)+'</option>';}).join('')+'</select>';
    }
    function tgEvalStartGo(){
        var empSel=document.getElementById('tgEvEmp'); var empId=empSel?parseInt(empSel.value,10):null;
        var typeSel=document.getElementById('tgEvType'); var type=typeSel?typeSel.value:'';
        var tplSel=document.getElementById('tgEvTpl'); var tplId=tplSel?parseInt(tplSel.value,10):null;
        if(!empId){ alert('Choose an employee.'); return; }
        if(!tplId){ alert('Choose a template (or add one in Pay Rules / Admin first).'); return; }
        tgRpc('app_tg_eval_start',{p_employee_id:empId,p_eval_type:type,p_template_id:tplId}, function(ev){ tgModal2Close(); tgEvalOpenForm(ev||{}); });
    }
    function tgEvalOpen(evalId){
        tgRpc('app_tg_eval_get',{p_evaluation_id:evalId}, function(ev){
            if(ev && ev.status==='draft') tgEvalOpenForm(ev); else tgEvalOpenView(ev);
        });
    }
    function tgEvalOpenForm(ev){
        var categories=(ev.template&&ev.template.categories)||ev.categories||[];
        var scoreMap={}; (ev.scores||[]).forEach(function(s){ scoreMap[s.category_name]=s; });
        _tg.evalDraft={ id:ev.id, employee_name:ev.employee_name, categories:categories, scores:scoreMap, strengths:ev.strengths||'', improvement_areas:ev.improvement_areas||'', manager_recommendation:ev.manager_recommendation||'' };
        tgEvalRenderForm();
    }
    function tgEvalRenderForm(){
        var d=_tg.evalDraft; if(!d) return;
        var h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="flex:1;font-size:16px;color:#1f2a44;">Evaluation &mdash; '+escapeHtml(d.employee_name||'')+'</b><button onclick="tgModal2Close()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div>';
        if(!d.categories.length) h+='<div style="font-size:12.5px;color:#9a5b00;margin-bottom:10px;">This template has no categories configured yet.</div>';
        d.categories.forEach(function(cat){
            var sc=d.scores[cat]||{}; var val=sc.score||0; var catAttr=tgAttrEsc(cat);
            h+='<div style="border:1px solid #ececf2;border-radius:10px;padding:10px;margin-bottom:9px;">';
            h+='<div style="font-size:13.5px;font-weight:700;color:#26242b;margin-bottom:6px;">'+escapeHtml(cat)+'</div>';
            h+='<div style="display:flex;gap:5px;">'+[1,2,3,4,5].map(function(n){ return '<button onclick="tgEvalSetScore(&quot;'+catAttr+'&quot;,'+n+')" style="flex:1;padding:8px;border-radius:8px;border:1px solid '+(val===n?'#185FA5':'#ddd')+';background:'+(val===n?'#185FA5':'#fff')+';color:'+(val===n?'#fff':'#5b6472')+';font-weight:800;cursor:pointer;">'+n+'</button>'; }).join('')+'</div>';
            h+='<input type="text" placeholder="Comment (optional)" value="'+escapeHtml(sc.comment||'')+'" oninput="tgEvalSetComment(&quot;'+catAttr+'&quot;,this.value)" style="width:100%;padding:7px;border:1px solid #eee;border-radius:8px;margin-top:6px;font-size:12.5px;box-sizing:border-box;">';
            h+='</div>';
        });
        h+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Strengths</label><textarea id="tgEvStrengths" oninput="_tg.evalDraft.strengths=this.value" style="width:100%;min-height:60px;padding:8px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+escapeHtml(d.strengths)+'</textarea>';
        h+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Areas for improvement</label><textarea id="tgEvImprove" oninput="_tg.evalDraft.improvement_areas=this.value" style="width:100%;min-height:60px;padding:8px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+escapeHtml(d.improvement_areas)+'</textarea>';
        h+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Manager recommendation</label><textarea id="tgEvRec" oninput="_tg.evalDraft.manager_recommendation=this.value" style="width:100%;min-height:50px;padding:8px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+escapeHtml(d.manager_recommendation)+'</textarea>';
        h+='<div style="display:flex;gap:8px;margin-top:6px;"><button onclick="tgEvalSaveDraft()" style="flex:1;background:#eef3fb;color:#185FA5;border:none;border-radius:10px;padding:11px;font-weight:700;cursor:pointer;">Save draft</button><button onclick="tgEvalSubmit()" style="flex:1;background:#1f7a3d;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">Submit</button></div>';
        tgModal2Body(h);
    }
    function tgEvalSetScore(cat,n){ if(!_tg.evalDraft) return; _tg.evalDraft.scores[cat]=Object.assign({},_tg.evalDraft.scores[cat],{score:n}); tgEvalRenderForm(); }
    function tgEvalSetComment(cat,val){ if(!_tg.evalDraft) return; _tg.evalDraft.scores[cat]=Object.assign({},_tg.evalDraft.scores[cat],{comment:val}); }
    function tgEvalPayload(){
        var d=_tg.evalDraft;
        var scores=d.categories.map(function(cat){ var s=d.scores[cat]||{}; return {category_name:cat,score:s.score||0,comment:s.comment||''}; });
        return { scores:scores, strengths:d.strengths, improvement_areas:d.improvement_areas, manager_recommendation:d.manager_recommendation };
    }
    function tgEvalSaveDraft(){ if(!_tg.evalDraft) return; tgRpc('app_tg_eval_save',{p_evaluation_id:_tg.evalDraft.id,p_payload:tgEvalPayload()}, function(){ alert('Draft saved.'); tgLoadEvalTab(); }); }
    function tgEvalSubmit(){
        if(!_tg.evalDraft) return;
        var d=_tg.evalDraft;
        var missing=d.categories.filter(function(cat){ return !(d.scores[cat]&&d.scores[cat].score); });
        if(missing.length && !confirm('Some categories are unscored ('+missing.join(', ')+'). Submit anyway?')) return;
        tgRpc('app_tg_eval_save',{p_evaluation_id:d.id,p_payload:tgEvalPayload()}, function(){
            tgRpc('app_tg_eval_submit',{p_evaluation_id:d.id}, function(){ tgModal2Close(); alert('Evaluation submitted.'); tgLoadEvalTab(); });
        });
    }
    function tgEvalOpenView(ev){
        if(!ev){ alert('Could not load evaluation.'); return; }
        var h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="flex:1;font-size:16px;color:#1f2a44;">Evaluation &mdash; '+escapeHtml(ev.employee_name||'')+'</b><button onclick="tgModal2Close()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div>';
        h+='<div style="margin-bottom:8px;">'+tgEvalStatusBadge(ev.status)+' <span style="font-size:12px;color:#6b7686;">'+escapeHtml(ev.eval_type||'')+' &middot; '+escapeHtml((ev.eval_date||'').slice(0,10))+'</span></div>';
        (ev.scores||[]).forEach(function(s){ h+='<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f8;"><span style="font-size:13px;color:#26242b;">'+escapeHtml(s.category_name)+'</span><b style="font-size:13px;color:#185FA5;">'+(s.score!=null?s.score+'/5':'—')+'</b></div>'; });
        if(ev.overall_score!=null) h+='<div style="margin-top:8px;font-size:13px;color:#1f2a44;">Overall score: <b>'+escapeHtml(String(ev.overall_score))+'</b></div>';
        if(ev.strengths) h+='<div style="margin-top:10px;"><div style="font-size:11px;font-weight:800;color:#6b6275;text-transform:uppercase;">Strengths</div><div style="font-size:13px;color:#26242b;white-space:pre-wrap;">'+escapeHtml(ev.strengths)+'</div></div>';
        if(ev.improvement_areas) h+='<div style="margin-top:10px;"><div style="font-size:11px;font-weight:800;color:#6b6275;text-transform:uppercase;">Areas for improvement</div><div style="font-size:13px;color:#26242b;white-space:pre-wrap;">'+escapeHtml(ev.improvement_areas)+'</div></div>';
        if(ev.manager_recommendation) h+='<div style="margin-top:10px;"><div style="font-size:11px;font-weight:800;color:#6b6275;text-transform:uppercase;">Manager recommendation</div><div style="font-size:13px;color:#26242b;white-space:pre-wrap;">'+escapeHtml(ev.manager_recommendation)+'</div></div>';
        if(ev.status==='submitted' && ev.employee_ack_status!=='acknowledged' && ev.self){ h+='<button onclick="tgEvalAck('+ev.id+')" style="width:100%;margin-top:14px;background:#1f7a3d;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">Acknowledge</button>'; }
        tgModal2Body(h);
    }

    // ============================================================
    // PAY PROPOSALS (managers create; corporate decides) —
    // app_tg_proposal_list / _create / _save / _validate / _submit / _decide / _mark_payroll
    // ============================================================
    function tgLoadPayTab(){
        tgBodySet(tgLoadingHtml('Loading pay proposals…'));
        tgRpc('app_tg_proposal_list',{p_filters:{location:_tg.store||''}}, function(d){ _tg.proposalList=d||[]; tgBodySet(tgPayTabHtml()); if(typeof tgxLoadMoneyCards==='function') tgxLoadMoneyCards(_tg.store||'', null, 'tgxMoneyCards'); }, function(err){ tgBodySet(tgErrHtml(err&&err.message)); });
    }
    function tgPayTabHtml(){
        var h='<div style="background:#fff4e0;border:1px solid #ffe2a8;color:#9a5b00;border-radius:10px;padding:10px 12px;font-size:12.5px;margin-bottom:12px;">Raises are never automatic — every proposal requires a human corporate decision.</div>';
        if(typeof tgxLoadMoneyCards==='function') h='<div id="tgxMoneyCards"></div>'+h;
        if(typeof tgxPromoQueueBtnHtml==='function') h+=tgxPromoQueueBtnHtml();
        h+='<button onclick="tgProposalNewPrep()" style="width:100%;background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:800;cursor:pointer;margin-bottom:14px;">&#10133; New Pay Proposal</button>';
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Proposals</div>';
        if(!_tg.proposalList.length) return h+tgEmptyCard('No pay proposals yet.','Create one above.');
        _tg.proposalList.forEach(function(p){
            h+='<div onclick="tgProposalOpen('+p.id+')" style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px 14px;margin-bottom:9px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.04);">'+
               '<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(p.employee_name||('Employee #'+p.employee_id))+'</b>'+tgProposalStatusBadge(p.status)+'</div>'+
               '<div style="font-size:12px;color:#5b6675;margin-top:4px;">'+(p.current_rate!=null?('$'+p.current_rate):'—')+' &rarr; '+(p.proposed_rate!=null?('$'+p.proposed_rate):'—')+(p.proposed_effective_date?(' &middot; eff. '+escapeHtml(p.proposed_effective_date)):'')+'</div></div>';
        });
        return h;
    }
    function tgProposalNewPrep(empId){
        if(empId){ tgProposalNew(empId); return; }
        tgEnsureEmpList(function(emps){
            var body='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="flex:1;font-size:16px;color:#1f2a44;">New Pay Proposal</b><button onclick="tgModal2Close()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div>';
            body+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Employee</label><select id="tgPropEmp" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+(emps.length?emps.map(function(e){ var id=e.employee_id||e.id; return '<option value="'+id+'">'+escapeHtml(e.name||('#'+id))+'</option>'; }).join(''):'<option value="">No team found</option>')+'</select>';
            body+='<button onclick="tgProposalNewGo()" style="width:100%;background:#1f7a3d;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">Continue</button>';
            tgModal2Body(body);
        });
    }
    function tgProposalNewGo(){ var sel=document.getElementById('tgPropEmp'); var empId=sel?parseInt(sel.value,10):null; if(!empId){ alert('Choose an employee.'); return; } tgProposalNew(empId); }
    function tgProposalNew(empId){ tgRpc('app_tg_proposal_create',{p_employee_id:empId}, function(p){ tgProposalOpenForm(p||{employee_id:empId}); }); }
    function tgProposalOpen(id){
        var p=(_tg.proposalList||[]).filter(function(x){return x.id===id;})[0];
        if(!p){ alert('Proposal not found — try reloading this tab.'); return; }
        if(p.status==='draft') tgProposalOpenForm(p); else tgProposalOpenView(p);
    }
    function tgProposalOpenForm(p){ _tg.proposalDraft=Object.assign({checklist:{}},p); if(!_tg.proposalDraft.checklist) _tg.proposalDraft.checklist={}; tgProposalRenderForm(); }
    function tgProposalRenderForm(){
        var p=_tg.proposalDraft; if(!p) return;
        var h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="flex:1;font-size:16px;color:#1f2a44;">Pay Proposal &mdash; '+escapeHtml(p.employee_name||('#'+p.employee_id))+'</b><button onclick="tgModal2Close()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div>';
        h+='<div style="background:#fff4e0;border:1px solid #ffe2a8;color:#9a5b00;border-radius:9px;padding:8px 10px;font-size:12px;margin-bottom:10px;">Raises are never automatic — submitting sends this for corporate decision.</div>';
        h+=tgField('Current role','tgPCurRole',p.current_role);
        h+=tgField('Proposed role','tgPPropRole',p.proposed_role);
        h+=tgField('Current rate ($/hr)','tgPCurRate',p.current_rate,'number');
        h+=tgField('Proposed rate ($/hr)','tgPPropRate',p.proposed_rate,'number');
        h+=tgField('Proposed effective date','tgPEffDate',p.proposed_effective_date,'date');
        h+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Raise type</label><select id="tgPRaiseType" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+['merit','promotion','market_adjustment','annual_review','equity'].map(function(t){return '<option value="'+t+'"'+(p.raise_type===t?' selected':'')+'>'+t.replace(/_/g,' ')+'</option>';}).join('')+'</select>';
        h+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Reason</label><textarea id="tgPReason" style="width:100%;min-height:60px;padding:8px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+escapeHtml(p.reason||'')+'</textarea>';
        if(typeof tgxProposalExtrasHtml==='function') h+=tgxProposalExtrasHtml(p);
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin:10px 0 6px;">Digital Raise Eligibility Checklist</div>';
        TG_CHECKLIST_ITEMS.forEach(function(it){ var checked=!!(p.checklist&&p.checklist[it[0]]); h+='<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#33303a;padding:5px 0;"><input type="checkbox" id="tgChk_'+it[0]+'" '+(checked?'checked':'')+' onchange="tgProposalChecklistToggle(&quot;'+it[0]+'&quot;,this.checked)"> '+escapeHtml(it[1])+'</label>'; });
        h+='<div id="tgPropFlags" style="margin:10px 0;"></div>';
        h+='<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;"><button onclick="tgProposalSaveForm()" style="flex:1;min-width:120px;background:#eef3fb;color:#185FA5;border:none;border-radius:10px;padding:11px;font-weight:700;cursor:pointer;">Save</button><button onclick="tgProposalValidateForm()" style="flex:1;min-width:120px;background:#f4f5f8;color:#5b6472;border:none;border-radius:10px;padding:11px;font-weight:700;cursor:pointer;">Validate</button><button onclick="tgProposalSubmitForm()" style="flex:1;min-width:120px;background:#1f7a3d;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">Submit</button></div>';
        tgModal2Body(h);
        if(typeof tgxProposalExtrasInit==='function') tgxProposalExtrasInit(p);
    }
    function tgProposalChecklistToggle(key,val){ if(!_tg.proposalDraft) return; _tg.proposalDraft.checklist=_tg.proposalDraft.checklist||{}; _tg.proposalDraft.checklist[key]=val; }
    function tgProposalCollect(){
        var p=_tg.proposalDraft;
        return { current_role:tgVal('tgPCurRole'), proposed_role:tgVal('tgPPropRole'), current_rate:tgNum('tgPCurRate'), proposed_rate:tgNum('tgPPropRate'), proposed_effective_date:tgVal('tgPEffDate'), raise_type:tgVal('tgPRaiseType'), reason:tgVal('tgPReason'), checklist:(p&&p.checklist)||{} };
    }
    function tgProposalSaveForm(cb){
        var p=_tg.proposalDraft; if(!p) return;
        var payload=tgProposalCollect();
        tgRpc('app_tg_proposal_save',{p_proposal_id:p.id,p_payload:payload}, function(r){ Object.assign(_tg.proposalDraft,payload); if(cb) cb(r); else alert('Saved.'); });
    }
    function tgProposalValidateForm(){ tgProposalSaveForm(function(){ tgRpc('app_tg_proposal_validate',{p_proposal_id:_tg.proposalDraft.id}, function(res){ tgRenderFlags(res); }); }); }
    function tgRenderFlags(res){
        var wrap=document.getElementById('tgPropFlags'); if(!wrap) return;
        var flags=(res&&res.flags)||res||[];
        if(!flags.length){ wrap.innerHTML='<div style="font-size:12.5px;color:#1f7a3d;">No issues found.</div>'; return; }
        wrap.innerHTML=flags.map(function(f){
            var sev=(f.severity||f.level||'amber');
            var c=sev==='red'?'#c0264b':'#9a5b00'; var bg=sev==='red'?'#fdeaea':'#fff4e0';
            return '<div style="background:'+bg+';border:1px solid '+c+'33;color:'+c+';border-radius:8px;padding:8px 10px;font-size:12.5px;margin-bottom:6px;font-weight:700;">&#9888; '+escapeHtml(f.message||f.flag||String(f))+'</div>';
        }).join('');
    }
    function tgProposalSubmitForm(){
        var p=_tg.proposalDraft; if(!p) return;
        tgProposalSaveForm(function(){
            tgRpc('app_tg_proposal_validate',{p_proposal_id:p.id}, function(res){
                var flags=(res&&res.flags)||res||[];
                var hasRed=flags.some(function(f){ return (f.severity||f.level)==='red'; });
                tgRenderFlags(res);
                if(hasRed && !confirm('This proposal has red flags. Submit anyway?')) return;
                if(typeof tgxProposalSubmit==='function'){ tgxProposalSubmit(p, function(){ tgModal2Close(); alert('Proposal submitted for corporate review.'); tgLoadPayTab(); }); } else { tgRpc('app_tg_proposal_submit',{p_proposal_id:p.id}, function(){ tgModal2Close(); alert('Proposal submitted for corporate review.'); tgLoadPayTab(); }); }
            });
        });
    }
    function tgProposalOpenView(p){
        var h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="flex:1;font-size:16px;color:#1f2a44;">Pay Proposal &mdash; '+escapeHtml(p.employee_name||('#'+p.employee_id))+'</b><button onclick="tgModal2Close()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div>';
        h+='<div style="margin-bottom:8px;">'+tgProposalStatusBadge(p.status)+'</div>';
        h+='<div style="font-size:13px;color:#26242b;margin-bottom:6px;">'+escapeHtml(p.current_role||'')+' &rarr; '+escapeHtml(p.proposed_role||p.current_role||'')+'</div>';
        h+='<div style="font-size:13px;color:#26242b;margin-bottom:6px;">Rate: '+(p.current_rate!=null?('$'+escapeHtml(String(p.current_rate))):'—')+' &rarr; <b>'+(p.proposed_rate!=null?('$'+escapeHtml(String(p.proposed_rate))):'—')+'</b></div>';
        if(p.proposed_effective_date) h+='<div style="font-size:13px;color:#26242b;margin-bottom:6px;">Effective: '+escapeHtml(p.proposed_effective_date)+'</div>';
        if(p.reason) h+='<div style="margin-top:8px;"><div style="font-size:11px;font-weight:800;color:#6b6275;text-transform:uppercase;">Reason</div><div style="font-size:13px;color:#26242b;white-space:pre-wrap;">'+escapeHtml(p.reason)+'</div></div>';
        var flags=p.flags||[];
        if(flags.length){ h+='<div style="margin-top:10px;">'; flags.forEach(function(f){ var sev=(f.severity||f.level||'amber'); var c=sev==='red'?'#c0264b':'#9a5b00'; h+='<div style="font-size:12px;color:'+c+';font-weight:700;">&#9888; '+escapeHtml(f.message||f.flag||'')+'</div>'; }); h+='</div>'; }
        if(tgIsCorp() && (p.status==='submitted'||p.status==='corporate_review'||p.status==='needs_info')){
            h+='<div style="margin-top:14px;"><label style="font-size:12px;font-weight:700;color:#5b6675;">Corporate notes</label><textarea id="tgPropDecNotes" style="width:100%;min-height:50px;padding:8px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;"></textarea>';
            h+='<div style="display:flex;gap:6px;flex-wrap:wrap;">';
            h+='<button onclick="tgProposalDecide('+p.id+',&quot;approve&quot;)" style="flex:1;min-width:100px;background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:9px;font-weight:800;cursor:pointer;">Approve</button>';
            h+='<button onclick="tgProposalDecide('+p.id+',&quot;deny&quot;)" style="flex:1;min-width:100px;background:#c0264b;color:#fff;border:none;border-radius:9px;padding:9px;font-weight:800;cursor:pointer;">Deny</button>';
            h+='<button onclick="tgProposalDecide('+p.id+',&quot;delay&quot;)" style="flex:1;min-width:100px;background:#9a5b00;color:#fff;border:none;border-radius:9px;padding:9px;font-weight:800;cursor:pointer;">Delay</button>';
            h+='<button onclick="tgProposalDecide('+p.id+',&quot;needs_info&quot;)" style="flex:1;min-width:100px;background:#5b6472;color:#fff;border:none;border-radius:9px;padding:9px;font-weight:800;cursor:pointer;">Needs Info</button>';
            h+='</div></div>';
        }
        if(tgIsCorp() && p.status==='approved'){ h+='<button onclick="tgProposalMarkPayroll('+p.id+')" style="width:100%;margin-top:12px;background:#185FA5;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">Mark Payroll Processed</button>'; }
        if(typeof tgxRaiseSheetBtnHtml==='function') h+=tgxRaiseSheetBtnHtml(p.id);
        tgModal2Body(h);
    }
    function tgProposalDecide(id,decision){
        var notesEl=document.getElementById('tgPropDecNotes'); var notes=notesEl?notesEl.value:'';
        if(!confirm('Confirm: '+decision.replace(/_/g,' ')+' this proposal?')) return;
        tgRpc('app_tg_proposal_decide',{p_proposal_id:id,p_decision:decision,p_notes:notes}, function(){ tgModal2Close(); alert('Decision recorded.'); tgLoadPayTab(); });
    }
    function tgProposalMarkPayroll(id){
        if(!confirm('Mark this proposal as payroll processed?')) return;
        tgRpc('app_tg_proposal_mark_payroll',{p_proposal_id:id}, function(){ tgModal2Close(); alert('Marked processed.'); tgLoadPayTab(); });
    }

    // ============================================================
    // PAY RULES / ADMIN (admin only) — app_tg_payrange_list/_save, app_tg_eval_templates/_template_save
    // ============================================================
    function tgLoadAdminTab(){
        if(!tgIsCorp()){ tgBodySet(tgErrHtml('Admins only.')); return; }
        tgBodySet(tgLoadingHtml('Loading pay rules…'));
        tgRpc('app_tg_payrange_list',{p_location:'',p_role:''}, function(ranges){
            _tg.payRanges=ranges||[];
            tgRpc('app_tg_eval_templates',{}, function(tpls){ _tg.evalTemplates=tpls||[]; tgBodySet(tgAdminTabHtml()); }, function(){ _tg.evalTemplates=[]; tgBodySet(tgAdminTabHtml()); });
        }, function(err){ tgBodySet(tgErrHtml(err&&err.message)); });
    }
    function tgAdminTabHtml(){
        var h='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Pay Ranges</div>';
        h+='<button onclick="tgPayRangeEdit(null)" style="width:100%;background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:10px;padding:11px;font-size:13.5px;font-weight:800;cursor:pointer;margin-bottom:12px;">&#10133; New pay range</button>';
        if(!_tg.payRanges.length) h+=tgEmptyCard('No pay ranges configured yet.','Add the first one above — pay-proposal validation flags won\'t work until ranges exist.');
        else _tg.payRanges.forEach(function(r){
            h+='<div onclick="tgPayRangeEdit('+r.id+')" style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:11px 13px;margin-bottom:8px;cursor:pointer;">'+
               '<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13.5px;color:#26242b;">'+escapeHtml(r.role_name||'')+'</b><span style="font-size:11.5px;color:#5b6675;">'+escapeHtml(r.location||'')+'</span></div>'+
               '<div style="font-size:12px;color:#5b6675;margin-top:3px;">$'+(r.minimum_rate!=null?escapeHtml(String(r.minimum_rate)):'—')+' &ndash; $'+(r.maximum_rate!=null?escapeHtml(String(r.maximum_rate)):'—')+'</div></div>';
        });
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin:18px 0 8px;">Evaluation Templates</div>';
        h+='<button onclick="tgEvalTemplateEdit(null)" style="width:100%;background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:10px;padding:11px;font-size:13.5px;font-weight:800;cursor:pointer;margin-bottom:12px;">&#10133; New template</button>';
        if(!_tg.evalTemplates.length) h+=tgEmptyCard('No evaluation templates yet.','Add the first one above — Start Evaluation needs at least one template per type.');
        else _tg.evalTemplates.forEach(function(t){
            h+='<div onclick="tgEvalTemplateEdit('+t.id+')" style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:11px 13px;margin-bottom:8px;cursor:pointer;">'+
               '<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13.5px;color:#26242b;">'+escapeHtml(t.title||t.eval_type||'')+'</b><span style="font-size:11px;color:#5b6675;">'+escapeHtml(t.eval_type||'')+'</span></div>'+
               '<div style="font-size:12px;color:#5b6675;margin-top:3px;">'+((t.categories||[]).length)+' categories</div></div>';
        });
        return h;
    }
    function tgPayRangeEdit(id){
        var r=id?((_tg.payRanges||[]).filter(function(x){return x.id===id;})[0]||{}):{};
        var stores=(typeof HUB_STORES!=='undefined'?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell']);
        var body='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="flex:1;font-size:16px;color:#1f2a44;">'+(id?'Edit':'New')+' Pay Range</b><button onclick="tgModal2Close()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div>';
        body+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Location</label><select id="tgPrLoc" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+stores.map(function(s){return '<option value="'+escapeHtml(s)+'"'+(r.location===s?' selected':'')+'>'+escapeHtml(s)+'</option>';}).join('')+'</select>';
        body+=tgField('Role name','tgPrRole',r.role_name);
        body+=tgField('Market','tgPrMarket',r.market);
        body+=tgField('Minimum rate','tgPrMin',r.minimum_rate,'number');
        body+=tgField('Maximum rate','tgPrMax',r.maximum_rate,'number');
        body+=tgField('Starting rate','tgPrStart',r.starting_rate,'number');
        body+=tgField('Fully trained min','tgPrFtMin',r.fully_trained_min,'number');
        body+=tgField('Fully trained max','tgPrFtMax',r.fully_trained_max,'number');
        body+=tgField('Max role rate','tgPrMaxRole',r.max_role_rate,'number');
        body+=tgField('Effective date','tgPrEff',r.effective_date,'date');
        body+=tgField('Expiration date','tgPrExp',r.expiration_date,'date');
        body+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Notes</label><textarea id="tgPrNotes" style="width:100%;min-height:50px;padding:8px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+escapeHtml(r.notes||'')+'</textarea>';
        body+='<button onclick="tgPayRangeSave('+(id||'null')+')" style="width:100%;background:#1f7a3d;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">Save</button>';
        tgModal2Body(body);
    }
    function tgPayRangeSave(id){
        var payload={ id:id||undefined, location:tgVal('tgPrLoc'), role_name:tgVal('tgPrRole'), market:tgVal('tgPrMarket'), minimum_rate:tgNum('tgPrMin'), maximum_rate:tgNum('tgPrMax'), starting_rate:tgNum('tgPrStart'), fully_trained_min:tgNum('tgPrFtMin'), fully_trained_max:tgNum('tgPrFtMax'), max_role_rate:tgNum('tgPrMaxRole'), effective_date:tgVal('tgPrEff')||null, expiration_date:tgVal('tgPrExp')||null, notes:tgVal('tgPrNotes'), active:true };
        tgRpc('app_tg_payrange_save',{p_payload:payload}, function(){ tgModal2Close(); tgLoadAdminTab(); });
    }
    function tgEvalTemplateEdit(id){
        var t=id?((_tg.evalTemplates||[]).filter(function(x){return x.id===id;})[0]||{}):{};
        var cats=(t.categories||[]).join('\n');
        var body='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="flex:1;font-size:16px;color:#1f2a44;">'+(id?'Edit':'New')+' Evaluation Template</b><button onclick="tgModal2Close()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div>';
        body+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Evaluation type</label><select id="tgTplType" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+TG_EVAL_TYPES.map(function(x){return '<option value="'+x[0]+'"'+(t.eval_type===x[0]?' selected':'')+'>'+x[1]+'</option>';}).join('')+'</select>';
        body+=tgField('Title','tgTplTitle',t.title);
        body+=tgField('Role scope (optional)','tgTplScope',t.role_scope);
        body+='<label style="font-size:12px;font-weight:700;color:#5b6675;">Categories (one per line)</label><textarea id="tgTplCats" style="width:100%;min-height:100px;padding:8px;border:1px solid #ddd;border-radius:9px;margin:4px 0 10px;box-sizing:border-box;">'+escapeHtml(cats)+'</textarea>';
        body+='<button onclick="tgEvalTemplateSave('+(id||'null')+')" style="width:100%;background:#1f7a3d;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">Save</button>';
        tgModal2Body(body);
    }
    function tgEvalTemplateSave(id){
        var catsRaw=tgVal('tgTplCats');
        var cats=catsRaw.split('\n').map(function(s){return s.trim();}).filter(Boolean);
        var payload={ id:id||undefined, eval_type:tgVal('tgTplType'), title:tgVal('tgTplTitle'), role_scope:tgVal('tgTplScope'), categories:cats, scale_min:1, scale_max:5, active:true };
        tgRpc('app_tg_eval_template_save',{p_payload:payload}, function(){ tgModal2Close(); tgLoadAdminTab(); });
    }

    // ===== export =====
    window.openTeamGrowth = openTeamGrowth;

    // ============================================================
    // COMPANY TAB (corporate/admin) — app_tg_corp_dashboard + four printable
    // reports (app_tg_report_evals/certs/growth/recognition), plus the
    // development spine (app_tg_spine) and PIP surfacing (openPip/app_pip_active)
    // used by the employee detail above. Backend: team_growth_finish.sql.
    // ============================================================
    function tgMoneyC(n){ if(typeof tgxMoney==='function') return tgxMoney(n); if(n==null||isNaN(n)) return '—'; var v=Number(n); return (v<0?'-$':'$')+Math.abs(v).toFixed(2); }
    function tgCanPip(){ return (typeof openPip==='function') && (typeof isDiscAdmin!=='function' || isDiscAdmin()); }
    function tgTeamRowById(empId){
        var d=_tg.mgrData||{}; var emps=d.employees||d.team||[];
        for(var i=0;i<emps.length;i++){ if(emps[i].employee_id===empId) return emps[i]; }
        return null;
    }
    function tgPipStart(empId){
        if(typeof openPip!=='function'){ alert('The PIP module is not available.'); return; }
        var row=tgTeamRowById(empId)||{};
        tgModal2Close(); tgClose();
        openPip(empId, row.name||'', row.location||'', row.role||'');
    }
    function tgPipLoad(empId){
        // lazy Active-PIP lookup: ONE app_pip_active call per detail view (same
        // call shape as js/04 loadRoster); quietly skips if the caller lacks access
        tgRpc('app_pip_active',{}, function(list){
            var pip=null; (list||[]).forEach(function(p){ if(p.employee_id===empId) pip=p; });
            var chip=document.getElementById('tgPipChip');
            if(chip&&pip) chip.innerHTML='<span style="background:#fdeaea;color:#b4264b;font-size:11px;font-weight:800;padding:3px 9px;border-radius:99px;">Active PIP</span>';
            var row=document.getElementById('tgPipRow'); if(!row) return;
            if(pip){
                row.innerHTML='<div style="background:#fff4f6;border:1px solid #f3c9d6;border-radius:10px;padding:10px 12px;font-size:12.5px;margin-bottom:10px;"><b style="color:#b4264b;">On a Performance Improvement Plan</b><div style="color:#6b7686;margin-top:3px;">'+escapeHtml(String(pip.start||''))+' &rarr; '+escapeHtml(String(pip['end']||''))+(pip.reason?('<br>'+escapeHtml(String(pip.reason))):'')+'</div></div>';
            } else if(tgCanPip()){
                row.innerHTML='<button onclick="tgPipStart('+empId+')" style="width:100%;background:#fff;border:1px solid #b4264b;color:#b4264b;border-radius:10px;padding:10px;font-weight:800;cursor:pointer;margin-bottom:10px;">Start corrective action / PIP</button>';
            }
        }, function(){ /* restricted (disc admins only) — leave the detail clean */ });
    }

    // ===== Development card (app_tg_spine) =====
    function tgSpineLoad(empId){
        tgRpc('app_tg_spine',{p_employee_id:empId}, function(s){
            var box=document.getElementById('tgSpineCard'); if(!box) return;
            box.innerHTML=tgSpineCardHtml(s||{});
        }, function(){ var b=document.getElementById('tgSpineCard'); if(b) b.innerHTML='<div style="font-size:12px;color:#9aa2ae;margin-bottom:10px;">Development data unavailable (apply team_growth_finish.sql).</div>'; });
    }
    function tgSpineCardHtml(s){
        var h='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px;margin-bottom:10px;">';
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:6px;">Development</div>';
        h+='<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:12.5px;color:#5b6675;">Passport level</span><b style="font-size:13.5px;color:#185FA5;">'+escapeHtml(s.passport_level||'—')+'</b></div>';
        if(s.passport_level&&typeof passportMeter==='function') h+='<div style="margin-top:5px;">'+passportMeter(s.passport_level)+'</div>';
        if(s.stations_total!=null) h+='<div style="font-size:11.5px;color:#8a93a3;margin-top:4px;">'+(s.stations_qualified||0)+'/'+s.stations_total+' stations at Qualified or above</div>';
        var lps=s.lp_progress||[];
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin:10px 0 4px;">Learning paths</div>';
        if(!lps.length) h+='<div style="font-size:12px;color:#9aa2ae;">No learning paths assigned.</div>';
        else lps.forEach(function(lp){
            var pct=Math.max(0,Math.min(100,Number(lp.pct)||0));
            h+='<div style="margin-bottom:6px;"><div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#33303a;"><span>'+escapeHtml(lp.path||'')+(lp.status==='completed'?' &#10003;':'')+'</span><b>'+pct+'%</b></div>';
            h+='<div style="height:6px;border-radius:99px;background:#edf0f4;margin-top:3px;"><div style="height:6px;border-radius:99px;width:'+pct+'%;background:'+(pct>=100?'#1f7a3d':'#185FA5')+';"></div></div></div>';
        });
        var cls=s.clearances||[];
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin:10px 0 4px;">Cleared stations</div>';
        if(!cls.length) h+='<div style="font-size:12px;color:#9aa2ae;">No station clearances yet.</div>';
        else h+='<div style="display:flex;gap:5px;flex-wrap:wrap;">'+cls.map(function(c){ return '<span style="background:#e8f5ec;color:#1b7a3d;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;">'+escapeHtml(c)+'</span>'; }).join('')+'</div>';
        h+='<div style="font-size:10.5px;color:#9aa2ae;margin-top:8px;">Real eligibility inputs — reviewed alongside evaluations when judging raises and promotions.</div>';
        h+='</div>';
        return h;
    }

    // ===== Company tab =====
    function tgLoadCorpTab(){
        if(!tgIsCorp()){ tgBodySet(tgErrHtml('Corporate / admin only.')); return; }
        tgBodySet(tgLoadingHtml('Loading company dashboard…'));
        tgRpc('app_tg_corp_dashboard',{}, function(d){ _tg.corpData=d||{}; tgBodySet(tgCorpTabHtml()); }, function(err){ tgBodySet(tgErrHtml((err&&err.message)||'Could not load (apply team_growth_finish.sql).')); });
    }
    function tgCorpTabHtml(){
        var d=_tg.corpData||{}; var c=d.company||{};
        var h='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Company Overview</div>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">';
        h+=tgSummaryCard(c.compliance_pct!=null?(c.compliance_pct+'%'):null,'Eval compliance','#185FA5');
        h+=tgSummaryCard(c.evals_overdue,'Reviews overdue','#c0264b');
        h+=tgSummaryCard(c.pending_proposals,'Pending proposals','#9a5b00');
        h+=tgSummaryCard(tgMoneyC(c.pending_weekly_exposure),'Est. weekly exposure','#a85217');
        h+='</div>';
        h+='<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px;">';
        h+=tgSummaryCard(c.promotion_queue,'Promotion queue','#7b2d8b');
        h+=tgSummaryCard(c.certs_expiring,'Certs expiring '+(c.cert_expiring_days||30)+'d','#9a5b00');
        h+=tgSummaryCard(c.recognition_30d!=null?c.recognition_30d:'—','Recognition 30d','#1f7a3d');
        h+=tgSummaryCard(c.open_concerns,'Open concerns','#c0264b');
        h+='</div>';
        h+='<div style="font-size:10.5px;color:#8a8f99;margin-bottom:14px;">&#9432; Dollar figures are ESTIMATES (delta rate &times; typical weekly hours, default '+escapeHtml(String(c.default_weekly_hours!=null?c.default_weekly_hours:25))+' hrs) &mdash; '+tgMoneyC(c.pending_monthly_exposure)+'/mo est. pending.'+(d.recognition_available===false?' Recognition feed is not readable on this database.':'')+'</div>';
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Printable Reports</div>';
        h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">';
        [['evals','Evaluation Compliance'],['certs','Training &amp; Certifications'],['growth','Employee Growth 90d'],['recognition','Recognition Summary']].forEach(function(rp){
            h+='<button onclick="tgCorpReport(&quot;'+rp[0]+'&quot;)" style="flex:1;min-width:150px;background:#eef3fb;color:#185FA5;border:1px solid #cfe0f5;border-radius:10px;padding:10px;font-size:12.5px;font-weight:800;cursor:pointer;">&#128424; '+rp[1]+'</button>';
        });
        h+='</div>';
        var stores=d.stores||[];
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Per-Store</div>';
        if(!stores.length) return h+tgEmptyCard('No store data yet.','Rows appear once employees and evaluations exist.');
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:6px;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:11.5px;min-width:640px;">';
        h+='<tr style="color:#6b7686;text-align:left;"><th style="padding:6px;">Store</th><th style="padding:6px;">Team</th><th style="padding:6px;">Compliance</th><th style="padding:6px;">Overdue</th><th style="padding:6px;">Pending $/wk</th><th style="padding:6px;">Promo</th><th style="padding:6px;">Certs exp.</th><th style="padding:6px;">Recog 30d</th><th style="padding:6px;">Concerns</th></tr>';
        stores.forEach(function(s){
            var comp=(s.compliance_pct!=null)?Number(s.compliance_pct):null;
            var compCol=comp==null?'#6b7686':(comp>=90?'#1f7a3d':(comp>=70?'#9a5b00':'#c0264b'));
            h+='<tr style="border-top:1px solid #ececf2;">';
            h+='<td style="padding:6px;font-weight:700;color:#26242b;">'+escapeHtml(s.location||'(unassigned)')+'</td>';
            h+='<td style="padding:6px;">'+(s.employees!=null?s.employees:'—')+'</td>';
            h+='<td style="padding:6px;font-weight:800;color:'+compCol+';">'+(comp!=null?(comp+'%'):'—')+'</td>';
            h+='<td style="padding:6px;">'+(s.evals_overdue!=null?s.evals_overdue:'—')+'</td>';
            h+='<td style="padding:6px;">'+(s.pending_proposals!=null?(s.pending_proposals+' / '+tgMoneyC(s.pending_weekly_exposure||0)):'—')+'</td>';
            h+='<td style="padding:6px;">'+(s.promotion_queue!=null?s.promotion_queue:0)+'</td>';
            h+='<td style="padding:6px;">'+(s.certs_expiring!=null?s.certs_expiring:0)+'</td>';
            h+='<td style="padding:6px;">'+(s.recognition_30d!=null?s.recognition_30d:'—')+'</td>';
            h+='<td style="padding:6px;font-weight:700;color:'+((s.open_concerns||0)>0?'#c0264b':'#26242b')+';">'+(s.open_concerns!=null?s.open_concerns:'—')+'</td>';
            h+='</tr>';
        });
        h+='</table></div>';
        return h;
    }

    // ===== four printable report views (print pattern mirrors tgxPrintSheet, js/25) =====
    var TG_CORP_REPORTS={ evals:'Evaluation Compliance', certs:'Training & Certification Status', growth:'Employee Growth — Last 90 Days', recognition:'Recognition Summary' };
    function tgCorpReport(kind){
        var title=TG_CORP_REPORTS[kind]||'Report';
        tgModal2Body('<div style="text-align:center;color:#6b7686;padding:30px;">Loading '+escapeHtml(title)+'&hellip;</div>');
        tgRpc('app_tg_report_'+kind,{p_location:''}, function(rows){
            _tg.corpReport={kind:kind,data:rows};
            var inner='';
            if(kind==='evals') inner=tgCorpReportEvalsHtml(rows||[]);
            else if(kind==='certs') inner=tgCorpReportCertsHtml(rows||{});
            else if(kind==='growth') inner=tgCorpReportGrowthHtml(rows||[]);
            else inner=tgCorpReportRecogHtml(rows||{});
            var h='<div id="tgCorpReport" style="font-family:Georgia,serif;color:#222;">';
            h+='<div style="text-align:center;border-bottom:2px solid #185FA5;padding-bottom:8px;margin-bottom:10px;">';
            h+='<div style="font-size:19px;font-weight:800;color:#185FA5;">Caliche&rsquo;s Frozen Custard &mdash; '+escapeHtml(title)+'</div>';
            h+='<div style="font-size:12px;color:#666;">Generated '+new Date().toLocaleDateString()+' &bull; all stores</div></div>';
            h+=inner+'</div>';
            h+='<div style="display:flex;gap:8px;margin-top:12px;"><button onclick="tgModal2Close()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Close</button><button onclick="tgCorpPrintReport(&quot;'+tgAttrEsc(title)+'&quot;)" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Print / Save PDF</button></div>';
            tgModal2Body(h);
        }, function(err){ tgModal2Body('<div style="color:#c0264b;padding:20px;">'+escapeHtml((err&&err.message)||'Could not load report.')+'</div><button onclick="tgModal2Close()" style="width:100%;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Close</button>'); });
    }
    function tgCorpPrintReport(title){
        var c=document.getElementById('tgCorpReport'); if(!c) return;
        var w=window.open('','_blank'); if(!w) return;
        w.document.write('<html><head><title>'+title+'</title></head><body style="font-family:Georgia,serif;padding:24px;max-width:840px;margin:0 auto;">'+c.innerHTML+'</body></html>');
        w.document.close(); w.print();
    }
    function tgCorpTable(headers,rowsHtml){
        return '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">'+
            '<tr style="text-align:left;color:#555;">'+headers.map(function(x){return '<th style="padding:5px 6px;border-bottom:2px solid #ccc;">'+x+'</th>';}).join('')+'</tr>'+rowsHtml+'</table></div>';
    }
    function tgCorpTd(v){ return '<td style="padding:5px 6px;border-bottom:1px solid #eee;">'+v+'</td>'; }
    function tgCorpReportEvalsHtml(rows){
        if(!rows.length) return '<div style="color:#666;padding:14px;">No employees found.</div>';
        var body=rows.map(function(r){
            var col=r.review_status==='Overdue'?'#c0264b':(r.review_status==='Due soon'?'#9a5b00':(r.review_status==='Never evaluated'?'#7b2d8b':'#1f7a3d'));
            return '<tr>'+tgCorpTd(escapeHtml(r.name||('#'+r.employee_id)))+tgCorpTd(escapeHtml(r.location||''))+
                tgCorpTd(r.last_eval_date?(escapeHtml(String(r.last_eval_date).slice(0,10))+' ('+escapeHtml(r.last_eval_type||'')+')'):'&mdash;')+
                tgCorpTd(r.overall_score!=null?escapeHtml(String(r.overall_score)):'&mdash;')+
                tgCorpTd(r.next_review_date?escapeHtml(String(r.next_review_date).slice(0,10)):'&mdash;')+
                '<td style="padding:5px 6px;border-bottom:1px solid #eee;font-weight:700;color:'+col+';">'+escapeHtml(r.review_status||'')+'</td></tr>';
        }).join('');
        return tgCorpTable(['Employee','Store','Last evaluation','Score','Next review','Status'],body);
    }
    function tgCorpReportCertsHtml(d){
        var certs=(d&&d.certs)||[]; var tr=(d&&d.training)||[];
        var h='<div style="font-size:12px;font-weight:800;color:#444;text-transform:uppercase;margin:4px 0 6px;">Certifications</div>';
        if(!certs.length) h+='<div style="color:#666;padding:4px 0 12px;">No certifications on file.</div>';
        else h+=tgCorpTable(['Employee','Store','Certification','Issued','Expires','Status'], certs.map(function(c){
            var col=c.status==='Expired'?'#c0264b':(c.status==='Expiring soon'?'#9a5b00':'#1f7a3d');
            return '<tr>'+tgCorpTd(escapeHtml(c.name||('#'+c.employee_id)))+tgCorpTd(escapeHtml(c.location||''))+
                tgCorpTd(escapeHtml(c.cert_type||''))+tgCorpTd(c.issued?escapeHtml(String(c.issued).slice(0,10)):'&mdash;')+
                tgCorpTd(c.expires?escapeHtml(String(c.expires).slice(0,10)):'&mdash;')+
                '<td style="padding:5px 6px;border-bottom:1px solid #eee;font-weight:700;color:'+col+';">'+escapeHtml(c.status||'')+'</td></tr>';
        }).join(''));
        h+='<div style="font-size:12px;font-weight:800;color:#444;text-transform:uppercase;margin:14px 0 6px;">Training paths</div>';
        if(!tr.length) h+='<div style="color:#666;padding:4px 0;">No training-path enrollments.</div>';
        else h+=tgCorpTable(['Employee','Store','Path','Status','Progress','Due'], tr.map(function(t){
            var pct=Math.max(0,Math.min(100,Number(t.pct)||0));
            return '<tr>'+tgCorpTd(escapeHtml(t.name||('#'+t.employee_id)))+tgCorpTd(escapeHtml(t.location||''))+
                tgCorpTd(escapeHtml(t.path||''))+tgCorpTd(escapeHtml(t.status||''))+
                tgCorpTd('<b>'+pct+'%</b>')+tgCorpTd(t.due_date?escapeHtml(String(t.due_date).slice(0,10)):'&mdash;')+'</tr>';
        }).join(''));
        return h;
    }
    function tgCorpReportGrowthHtml(rows){
        if(!rows.length) return '<div style="color:#666;padding:14px;">No growth events in the last 90 days.</div>';
        var KIND={passport_level:'Passport level',certification:'Certification',evaluation:'Evaluation',promotion:'Promotion'};
        var body=rows.map(function(r){
            return '<tr>'+tgCorpTd(escapeHtml(String(r.at||'').slice(0,10)))+tgCorpTd(escapeHtml(KIND[r.kind]||r.kind||''))+
                tgCorpTd(escapeHtml(r.name||('#'+(r.employee_id!=null?r.employee_id:''))))+tgCorpTd(escapeHtml(r.location||''))+
                tgCorpTd(escapeHtml(r.detail||''))+tgCorpTd(escapeHtml(r.by||''))+'</tr>';
        }).join('');
        return tgCorpTable(['Date','Type','Employee','Store','Change','By'],body);
    }
    function tgCorpReportRecogHtml(d){
        if(d&&d.available===false) return '<div style="color:#666;padding:14px;">'+escapeHtml(d.note||'Recognition feed is not readable on this database yet.')+'</div>';
        var by=(d&&d.by_employee)||[]; var items=(d&&d.items)||[];
        var h='<div style="font-size:12px;font-weight:800;color:#444;text-transform:uppercase;margin:4px 0 6px;">Shout-outs by employee (last '+((d&&d.days)||90)+' days)</div>';
        if(!by.length) h+='<div style="color:#666;padding:4px 0 12px;">No recognition recorded in this window.</div>';
        else h+=tgCorpTable(['Employee','Count'], by.map(function(b){
            return '<tr>'+tgCorpTd(escapeHtml(b.name||('#'+b.employee_id)))+tgCorpTd('<b>'+(b.count||0)+'</b>')+'</tr>';
        }).join(''));
        h+='<div style="font-size:12px;font-weight:800;color:#444;text-transform:uppercase;margin:14px 0 6px;">Recent shout-outs</div>';
        if(!items.length) h+='<div style="color:#666;padding:4px 0;">None.</div>';
        else items.slice(0,40).forEach(function(it){
            h+='<div style="padding:5px 0;border-bottom:1px solid #eee;font-size:12px;">&#127881; '+escapeHtml(it.message||it.type||'')+' <span style="color:#888;">&mdash; '+escapeHtml(it.name||'')+(it.location?(' &middot; '+escapeHtml(it.location)):'')+' &middot; '+escapeHtml(String(it.created_at||'').slice(0,10))+'</span></div>';
        });
        return h;
    }
