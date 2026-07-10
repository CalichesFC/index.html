    // ============================================================
    // DAILY STORE REPORT / DIGITAL CLOSEOUT (js/18)
    // Digitizes the 5:00 Ring-Out, Night Ring-Out, Combined Totals,
    // Log Book, and Labor Projection workbook. Server computes all
    // money/percent math (over/short, labor cost/%, change recon) —
    // this file only renders a live client preview where noted and
    // always displays the server-returned value as the final number.
    // Entry point: openDailyReport(). Overlay id: dsrModal.
    // ============================================================

    var _dsr = { view:'landing', list:[], filters:{ location:'', date:'', status:'' }, report:null, reportId:null, wtab:'header', lastValidation:null };

    var DSR_DENOMS = [['c_misc','Misc $'],['c_ones','$1s'],['c_fives','$5s'],['c_tens','$10s'],['c_twenties','$20s'],['c_fifties','$50s'],['c_hundreds','$100s'],['checks','Checks'],['change','Change']];
    var DSR_PAY_CATS = [['mc_visa','MC / Visa'],['donation_gc','Donation GC'],['voids','Voids'],['apple_pay','Apple Pay'],['caliches_gc',"Caliche's GC"],['other','Other']];
    var DSR_RATING_CATS = [['speed','Speed'],['cleanliness','Cleanliness'],['friendliness','Friendliness'],['quality','Quality / Consistency']];
    var DSR_LOG_SECTIONS = [['employee_am','Employee / Scheduling — AM'],['employee_pm','Employee / Scheduling — PM'],['customer_comments','Customer comments'],['building_maint','Building maintenance'],['cleaning','Cleaning items'],['manager_requests','Manager requests'],['delivery_issues','Delivery issues'],['balancing_comments','Balancing comments'],['general_notes','General notes']];
    var DSR_TABS = [['header','Header'],['five','5:00 Closeout'],['night','Night Closeout'],['combined','Combined Totals'],['logbook','Log Book'],['labor','Labor'],['review','Review & Submit']];
    var DSR_STATUS_COLORS = { Draft:'#9a5b00', 'In Progress':'#9a5b00', Submitted:'#185FA5', 'Under Review':'#185FA5', Reviewed:'#1f7a3d', Locked:'#5b6472', Correction:'#c0264b', 'Correction Requested':'#c0264b', Reopened:'#7d1d4b' };

    // ---- RPC wrapper (mirrors scRpc / tgRpc) ----
    function dsrRpc(name,args,cb,onerr){
        withPin(function(pin){
            supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){
                if(r.error){ if(onerr) onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; }
                cb(r.data);
            }).catch(function(){ if(onerr) onerr({message:'Connection error'}); else alert('Connection error.'); });
        });
    }

    // ---- overlay shell (cloned from js/08 tdOverlay/tdHeader) ----
    function dsrOverlay(){ var ov=document.getElementById('dsrModal'); if(!ov){ ov=document.createElement('div'); ov.id='dsrModal'; ov.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100000;overflow:auto;'; document.body.appendChild(ov); } ov.style.display='block'; return ov; }
    function dsrClose(){ var ov=document.getElementById('dsrModal'); if(ov) ov.style.display='none'; }
    function dsrHeader(title,back){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;">'+(back?('<button onclick="'+back+'" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;">&#8249; Back</button>'):'')+'<b style="flex:1;font-size:16px;">'+escapeHtml(title||'')+'</b><button onclick="dsrClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }

    // ---- small render helpers ----
    function dsrCard(inner,title){ return '<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,.04);">'+(title?('<div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#5b6675;margin-bottom:10px;letter-spacing:.3px;">'+escapeHtml(title)+'</div>'):'')+inner+'</div>'; }
    function dsrBtn(label,onclick,kind){ var bg=kind==='primary'?'#1f7a3d':(kind==='danger'?'#c0264b':'#185FA5'); return '<button onclick="'+onclick+'" style="background:'+bg+';color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:700;cursor:pointer;margin-top:4px;">'+label+'</button>'; }
    function dsrEmpty(msg){ return '<div style="text-align:center;color:#6b7686;padding:26px 14px;font-size:13px;">'+escapeHtml(msg)+'</div>'; }
    function dsrIn(id,label,val,type){ type=type||'text'; return '<div style="margin-bottom:9px;"><label style="display:block;font-size:11px;font-weight:700;color:#5b6675;margin-bottom:3px;">'+escapeHtml(label)+'</label><input id="'+id+'" type="'+type+'" value="'+escapeHtml(val==null?'':String(val))+'" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;"></div>'; }
    function dsrNumIn(id,label,val){ return dsrIn(id,label,(val==null?'':val),'number'); }
    function dsrTA(id,label,val){ return '<div style="margin-bottom:9px;"><label style="display:block;font-size:11px;font-weight:700;color:#5b6675;margin-bottom:3px;">'+escapeHtml(label)+'</label><textarea id="'+id+'" rows="3" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;font-family:inherit;">'+escapeHtml(val||'')+'</textarea></div>'; }
    function dsrVal(id){ var e=document.getElementById(id); return e?e.value:''; }
    function dsrValF(id){ var v=parseFloat(dsrVal(id)); return isNaN(v)?0:v; }
    function dsrMoney(n){ if(n==null||n==='') return '—'; var x=parseFloat(n); return isNaN(x)?'—':'$'+x.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
    function dsrTotalTile(label,val,color){ return '<div style="flex:1;min-width:120px;background:#fafbfd;border:1px solid #eef0f5;border-radius:10px;padding:9px 11px;"><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#5b6675;">'+escapeHtml(label)+'</div><div style="font-size:16px;font-weight:800;color:'+(color||'#1f2a44')+';">'+val+'</div></div>'; }
    function dsrTodayIso(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
    function dsrSum(a,b){ if(a==null&&b==null) return null; return (parseFloat(a)||0)+(parseFloat(b)||0); }
    function dsrStatusColor(s){ return DSR_STATUS_COLORS[s]||'#5b6675'; }
    function dsrBadge(status){ return '<span style="background:'+dsrStatusColor(status)+';color:#fff;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:800;">'+escapeHtml(status||'Draft')+'</span>'; }
    function dsrWarnChip(label){ return '<span style="background:#fff4e0;color:#9a5b00;padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:700;margin-right:4px;margin-top:4px;display:inline-block;">&#9888; '+escapeHtml(label)+'</span>'; }
    function dsrIsOffice(){ return !!(currentUser && (isAdminManager() || isDiscAdmin() || currentUser.role==='Finance Approver')); }
    function dsrPositions(){
        try{
            var v=(typeof cfg==='function')?cfg('dsr','register_positions',null):null;
            if(v && Object.prototype.toString.call(v)==='[object Array]') return v;
            if(typeof v==='string' && v.indexOf(',')>=0) return v.split(',').map(function(s){return s.trim();}).filter(Boolean);
        }catch(e){}
        return ['Front #1','Front #2','Drive-Thru'];
    }

    // ============================================================
    // LANDING
    // ============================================================
    function openDailyReport(){ _dsr.view='landing'; dsrLoadList(); }

    function dsrLoadList(){
        var ov=dsrOverlay();
        ov.innerHTML=dsrHeader('Daily Store Report','')+'<div style="max-width:860px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading reports&hellip;</div>';
        dsrRpc('dsr_list',{p_filters:_dsr.filters},function(d){ _dsr.list=d||[]; dsrRenderLanding(); }, function(err){
            ov.innerHTML=dsrHeader('Daily Store Report','')+'<div style="max-width:860px;margin:0 auto;padding:30px 16px;color:#c0264b;text-align:center;">'+escapeHtml((err&&err.message)||'Could not load reports.')+'</div>';
        });
    }

    function dsrQuickFilter(status){ _dsr.filters.status=status; dsrLoadList(); }
    function dsrClearFilters(){ _dsr.filters={location:'',date:'',status:''}; dsrLoadList(); }

    function dsrRenderLanding(){
        var ov=dsrOverlay();
        var rows=_dsr.list||[];
        var stores=(typeof HUB_STORES!=='undefined'?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell']);
        var f=_dsr.filters;
        var h=dsrHeader('Daily Store Report','');
        h+='<div style="max-width:860px;margin:0 auto;padding:14px 16px 60px;">';
        h+='<p style="font-size:12.5px;color:#6b7686;margin-top:0;">Digital 5:00 &amp; Night closeout, log book, and labor projection &mdash; replaces the paper workbook.</p>';

        h+='<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">';
        h+=dsrBtn('Open Today','dsrOpenToday()','primary');
        h+=dsrBtn('Continue Draft','dsrQuickFilter(&quot;Draft&quot;)');
        if(typeof isManagerRole==='function' && (isManagerRole()||isAdminManager()||isDiscAdmin())) h+=dsrBtn('Review Submitted','dsrQuickFilter(&quot;Submitted&quot;)');
        h+=dsrBtn('Refresh','dsrLoadList()');
        h+='</div>';

        h+='<div style="background:#fff;border:1px solid #e6ebf2;border-radius:12px;padding:10px 12px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">';
        h+='<select onchange="_dsr.filters.location=this.value; dsrLoadList();" style="padding:7px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;"><option value="">All stores</option>'+stores.map(function(s){return '<option value="'+escapeHtml(s)+'"'+(f.location===s?' selected':'')+'>'+escapeHtml(s)+'</option>';}).join('')+'</select>';
        h+='<input type="date" value="'+escapeHtml(f.date||'')+'" onchange="_dsr.filters.date=this.value; dsrLoadList();" style="padding:7px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;">';
        h+='<select onchange="_dsr.filters.status=this.value; dsrLoadList();" style="padding:7px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;"><option value="">Any status</option>'+['Draft','Submitted','Reviewed','Locked','Correction','Reopened'].map(function(s){return '<option value="'+s+'"'+(f.status===s?' selected':'')+'>'+s+'</option>';}).join('')+'</select>';
        if(f.location||f.date||f.status) h+=dsrBtn('Clear filters','dsrClearFilters()');
        h+='</div>';

        if(!rows.length){ h+=dsrEmpty('No daily store reports yet. Tap "Open Today" to start the 5:00 closeout.'); }
        else{ rows.forEach(function(r){ h+=dsrLandingCard(r); }); }
        h+='</div>';
        ov.innerHTML=h;
    }

    function dsrRowWarnings(r){
        var w=[];
        if(r.missing_sections){ var m=r.missing_sections; if(Object.prototype.toString.call(m)==='[object Array]' && m.length) w.push(m.length+' section(s) missing'); else if(typeof m==='number' && m>0) w.push(m+' section(s) missing'); }
        if(r.open_over_short) w.push('Over/short unresolved');
        if(r.low_scores) w.push('Low ratings');
        if(r.unreviewed) w.push('Needs review');
        if(r.warnings && Object.prototype.toString.call(r.warnings)==='[object Array]'){ r.warnings.forEach(function(x){ w.push(String(x)); }); }
        return w;
    }

    function dsrLandingCard(r){
        var warnings=dsrRowWarnings(r);
        var dateShown=r.business_date?String(r.business_date).slice(0,10):'';
        var h='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:13px 14px;margin-bottom:10px;box-shadow:0 2px 6px rgba(0,0,0,.04);">';
        h+='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><b style="font-size:14.5px;color:#26242b;">'+escapeHtml(r.location||'')+'</b><span style="font-size:12px;color:#6b7686;">'+escapeHtml(dateShown)+'</span><span style="flex:1;"></span>'+dsrBadge(r.status)+'</div>';
        if(warnings.length) h+='<div style="margin-top:8px;">'+warnings.map(dsrWarnChip).join('')+'</div>';
        h+='<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">';
        h+=dsrBtn('Open','dsrOpenReport('+r.id+')');
        if(r.status==='Locked') h+=dsrBtn('Create Correction','dsrCreateCorrection('+r.id+')');
        if(r.status==='Locked' && (isAdminManager()||isDiscAdmin())) h+=dsrBtn('Reopen','dsrReopen('+r.id+')','danger');
        h+='</div></div>';
        return h;
    }

    function dsrOpenToday(){
        var loc=(typeof tempStoreLoc==='function' && tempStoreLoc())||'';
        if(!loc){ alert('No store is set on your account yet — filter by store above and tap Open on a card instead.'); return; }
        dsrRpc('dsr_open',{p_location:loc,p_business_date:dsrTodayIso()},function(d){
            var id=d&&(d.id!=null?d.id:(d.report&&d.report.id));
            if(id==null){ alert("Could not open today's report."); return; }
            dsrWorkspace(id);
        });
    }
    function dsrOpenReport(id){ dsrWorkspace(id); }
    function dsrCreateCorrection(id){
        if(!confirm('Create a correction for this locked report? This opens a new linked draft.')) return;
        dsrRpc('dsr_create_correction',{p_id:id},function(d){ var nid=d&&(d.id!=null?d.id:(d.report&&d.report.id)); if(nid!=null) dsrWorkspace(nid); else dsrLoadList(); });
    }
    function dsrReopen(id){
        var reason=prompt('Reason for reopening this report (required, audited):');
        if(reason===null) return;
        if(!reason.trim()){ alert('A reason is required.'); return; }
        dsrRpc('dsr_reopen',{p_id:id,p_reason:reason.trim()},function(){ alert('Report reopened.'); if(_dsr.view==='workspace' && _dsr.reportId===id) dsrLoadReport(); else dsrLoadList(); });
    }

    // ============================================================
    // WORKSPACE
    // ============================================================
    function dsrWorkspace(id){ _dsr.view='workspace'; _dsr.wtab='header'; _dsr.reportId=id; _dsr.lastValidation=null; dsrLoadReport(); }

    function dsrLoadReport(){
        var ov=dsrOverlay();
        ov.innerHTML=dsrHeader('Loading report&hellip;','openDailyReport()')+'<div style="max-width:900px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading&hellip;</div>';
        dsrRpc('dsr_get',{p_id:_dsr.reportId},function(d){ _dsr.report=d||{}; dsrRenderWorkspace(); }, function(err){
            ov.innerHTML=dsrHeader('Daily Store Report','openDailyReport()')+'<div style="max-width:900px;margin:0 auto;padding:30px 16px;color:#c0264b;text-align:center;">'+escapeHtml((err&&err.message)||'Could not load report.')+'</div>';
        });
    }

    // ---- nested-data accessors (defensive — backend not built yet) ----
    function dsrRep(){ var r=_dsr.report||{}; return r.report||r; }
    function dsrCloseouts(){ var r=_dsr.report||{}; return r.closeouts||[]; }
    function dsrCloseoutOf(type){ var list=dsrCloseouts(); for(var i=0;i<list.length;i++){ if(list[i].closeout_type===type) return list[i]; } return null; }
    function dsrRegistersOf(type){ var c=dsrCloseoutOf(type); return (c&&c.registers)||[]; }
    function dsrPayAdjOf(type){ var c=dsrCloseoutOf(type); return (c&&(c.payment_adj||c.payment_adjustments))||[]; }
    function dsrChecklistItems(){ var r=_dsr.report||{}; return r.checklist_items||[]; }
    function dsrChecklistEntries(){ var r=_dsr.report||{}; return r.checklist_entries||[]; }
    function dsrChecklistEntryOf(itemId){ var e=dsrChecklistEntries(); for(var i=0;i<e.length;i++){ if(e[i].item_id===itemId) return e[i]; } return null; }
    function dsrRatings(){ var r=_dsr.report||{}; return r.ratings||[]; }
    function dsrRatingOf(cat){ var rr=dsrRatings(); for(var i=0;i<rr.length;i++){ if(rr[i].category===cat) return rr[i]; } return null; }
    function dsrLogNotes(section){ var r=_dsr.report||{}; var all=r.log_notes||[]; return section?all.filter(function(n){return n.section===section;}):all; }
    function dsrAttachments(section){ var r=_dsr.report||{}; var all=r.attachments||[]; return section?all.filter(function(a){return a.section===section;}):all; }
    function dsrLabor(){ var r=_dsr.report||{}; return r.labor||{}; }
    function dsrOfficeReview(){ var r=_dsr.report||{}; return r.office_review||{}; }
    function dsrChangeRecon(){ var r=_dsr.report||{}; return r.change_recon||{}; }
    function dsrPromo(){ var r=_dsr.report||{}; return r.promo||{}; }

    function dsrTabsHtml(){
        var t=_dsr.wtab; var tabs=DSR_TABS.slice();
        if(dsrIsOffice()) tabs.push(['office','Office Review']);
        return '<div style="display:flex;gap:5px;overflow-x:auto;max-width:900px;margin:14px auto 0;padding:0 16px;">'+tabs.map(function(x){
            var id=x[0],lbl=x[1];
            return '<button onclick="dsrSetTab(&quot;'+id+'&quot;)" style="white-space:nowrap;background:'+(t===id?'#185FA5':'#eef0f3')+';color:'+(t===id?'#fff':'#5b6472')+';border:none;padding:9px 12px;font-size:12.5px;font-weight:700;cursor:pointer;border-radius:9px;">'+escapeHtml(lbl)+'</button>';
        }).join('')+'</div>';
    }
    function dsrSetTab(t){ _dsr.wtab=t; dsrRenderWorkspace(); }

    function dsrStatusBar(){
        var rep=dsrRep();
        return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;"><span style="font-size:12px;color:#6b7686;">Status:</span>'+dsrBadge(rep.status)+(rep.correction_of_id?('<span style="font-size:11.5px;color:#c0264b;font-weight:700;">Correction of #'+escapeHtml(String(rep.correction_of_id))+'</span>'):'')+'</div>';
    }

    function dsrRenderWorkspace(){
        var rep=dsrRep();
        var ov=dsrOverlay();
        var title='Daily Store Report'+(rep.location?(' — '+rep.location):'')+(rep.business_date?(' · '+String(rep.business_date).slice(0,10)):'');
        var body;
        switch(_dsr.wtab){
            case 'header': body=dsrHeaderTab(); break;
            case 'five': body=dsrCloseoutTab('five'); break;
            case 'night': body=dsrCloseoutTab('night'); break;
            case 'combined': body=dsrCombinedTab(); break;
            case 'logbook': body=dsrLogBookTab(); break;
            case 'labor': body=dsrLaborTab(); break;
            case 'office': body=dsrOfficeTab(); break;
            case 'review': body=dsrReviewTab(); break;
            default: body=dsrHeaderTab();
        }
        ov.innerHTML=dsrHeader(title,'openDailyReport()')+dsrTabsHtml()+'<div style="max-width:900px;margin:0 auto;padding:16px 16px 60px;">'+dsrStatusBar()+body+'</div>';
    }

    // ---- Header tab ----
    function dsrHeaderTab(){
        var rep=dsrRep();
        var stores=(typeof HUB_STORES!=='undefined'?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell']);
        var h='<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
            '<div style="flex:1;min-width:160px;"><label style="display:block;font-size:11px;font-weight:700;color:#5b6675;margin-bottom:3px;">Store</label><select id="dsrH_loc" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;">'+stores.map(function(s){return '<option value="'+escapeHtml(s)+'"'+(rep.location===s?' selected':'')+'>'+escapeHtml(s)+'</option>';}).join('')+'</select></div>'+
            '<div style="flex:1;min-width:140px;">'+dsrIn('dsrH_date','Business date',rep.business_date?String(rep.business_date).slice(0,10):'','date')+'</div>'+
            '</div><div style="display:flex;gap:8px;flex-wrap:wrap;">'+
            '<div style="flex:1;min-width:160px;">'+dsrIn('dsrH_am','AM Manager',rep.am_manager||'')+'</div>'+
            '<div style="flex:1;min-width:160px;">'+dsrIn('dsrH_pm','PM Manager',rep.pm_manager||'')+'</div>'+
            '<div style="flex:1;min-width:140px;">'+dsrIn('dsrH_weather','Weather',rep.weather||'')+'</div>'+
            '</div>'+
            dsrTA('dsrH_notes','Ops notes',rep.ops_notes||'')+
            dsrBtn('Save header','dsrSaveHeader()','primary');
        return dsrCard(h,'Header');
    }
    function dsrSaveHeader(){
        var patch={ location:dsrVal('dsrH_loc'), business_date:dsrVal('dsrH_date'), am_manager:dsrVal('dsrH_am'), pm_manager:dsrVal('dsrH_pm'), weather:dsrVal('dsrH_weather'), ops_notes:dsrVal('dsrH_notes') };
        dsrRpc('dsr_header_save',{p_id:_dsr.reportId,p_patch:patch},function(){ dsrLoadReport(); });
    }

    // ---- 5:00 / Night closeout tab ----
    function dsrCloseoutTab(type){
        var label=type==='five'?'5:00 Closeout':'Night Closeout';
        var c=dsrCloseoutOf(type)||{};
        var positions=dsrPositions();
        var registers=dsrRegistersOf(type);
        var payAdj=dsrPayAdjOf(type);
        var h='';

        var detIn='<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
            '<div style="flex:1;min-width:120px;">'+dsrIn('dsrC_'+type+'_ring','Ring-out time',c.ring_out_time||'','time')+'</div>'+
            '<div style="flex:1;min-width:140px;">'+dsrIn('dsrC_'+type+'_prep','Prepared by',c.prepared_by||'')+'</div>'+
            '<div style="flex:1;min-width:120px;">'+dsrNumIn('dsrC_'+type+'_tape','Tape/POS total ($)',c.tape_total)+'</div>'+
            (type==='night'?('<div style="flex:1;min-width:150px;">'+dsrNumIn('dsrC_'+type+'_netTape','Net tape total ($, after 5:00 subtracted)',c.net_tape_total)+'</div>'):'')+
            '</div><div style="display:flex;gap:8px;flex-wrap:wrap;">'+
            '<div style="flex:1;min-width:100px;">'+dsrNumIn('dsrC_'+type+'_bags','Bag count',c.bag_count)+'</div>'+
            '<div style="flex:1;min-width:120px;">'+dsrNumIn('dsrC_'+type+'_deposit','Deposit ($)',c.deposit)+'</div>'+
            '<div style="flex:1;min-width:120px;">'+dsrNumIn('dsrC_'+type+'_tx','Total transactions',c.transactions)+'</div>'+
            '</div>'+
            dsrBtn('Save closeout details','dsrSaveCloseout(&quot;'+type+'&quot;)','primary');
        h+=dsrCard(detIn,label+' details');

        var regBody='';
        if(!positions.length){ regBody=dsrEmpty('No register positions configured yet.'); }
        else{
            positions.forEach(function(pos,idx){
                var existing=registers.filter(function(r){return r.position_label===pos;})[0]||{};
                var pre='dsrR_'+type+'_'+idx+'_';
                var rowH='<div style="font-size:13px;font-weight:800;color:#1f2a44;margin:10px 0 6px;">'+escapeHtml(pos)+'</div>';
                rowH+=dsrIn(pre+'emp','Employee',existing.employee_id!=null?existing.employee_id:(existing.employee_name||''));
                rowH+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;">'+DSR_DENOMS.map(function(d){ return dsrNumIn(pre+d[0],d[1],existing[d[0]]); }).join('')+'</div>';
                rowH+='<div style="margin:8px 0;font-size:12.5px;color:#5b6675;">Server total (final): <b style="color:#1f2a44;">'+dsrMoney(existing.register_total)+'</b></div>';
                rowH+=dsrBtn('Save register',"dsrSaveRegister('"+type+"',"+idx+","+(existing.id!=null?existing.id:'null')+")");
                regBody+='<div style="border:1px solid #eef0f5;border-radius:10px;padding:10px 12px;margin-bottom:10px;">'+rowH+'</div>';
            });
        }
        h+=dsrCard(regBody,'Registers');

        var payBody='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">'+DSR_PAY_CATS.map(function(pc){ var ex=payAdj.filter(function(p){return p.category===pc[0];})[0]||{}; return dsrNumIn('dsrP_'+type+'_'+pc[0],pc[1],ex.amount); }).join('')+'</div>';
        payBody+=dsrBtn('Save payment adjustments','dsrSavePaymentAdj(&quot;'+type+'&quot;)');
        h+=dsrCard(payBody,'Payment adjustments');

        var os=c.over_short;
        var osColor=(os==null)?'#5b6675':(Math.abs(os)>0.004?'#c0264b':'#1f7a3d');
        h+=dsrCard(
            '<div style="display:flex;flex-wrap:wrap;gap:10px;">'+
                dsrTotalTile('Register total',dsrMoney(c.register_total))+
                dsrTotalTile('Adjusted total',dsrMoney(c.adj_total))+
                dsrTotalTile('Over/Short',(os==null?'Incomplete':dsrMoney(os)),osColor)+
            '</div><div style="font-size:11px;color:#8a91a0;margin-top:8px;">Final numbers come from the server once you save each section above &mdash; not client-side math.</div>',
            'Totals (server-computed, final)'
        );

        if(type==='night'){
            var cr=dsrChangeRecon();
            var crOS=cr.over_short;
            var crBody='<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
                '<div style="flex:1;min-width:130px;">'+dsrNumIn('dsrCR_inSafe','Change in safe ($)',cr.change_in_safe)+'</div>'+
                '<div style="flex:1;min-width:130px;">'+dsrNumIn('dsrCR_target','Required target ($)',cr.required_target)+'</div>'+
                '<div style="flex:1;min-width:150px;">'+dsrNumIn('dsrCR_need','Need additional ($)',cr.need_additional)+'</div>'+
                '</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;">'+DSR_DENOMS.slice(0,7).map(function(d){ return dsrNumIn('dsrCR_'+d[0],d[1],cr[d[0]]); }).join('')+'</div>'+
                '<div style="margin:8px 0;font-size:12.5px;color:#5b6675;">Server total: <b>'+dsrMoney(cr.total)+'</b> &middot; Over/Short: <b style="color:'+(crOS==null?'#5b6675':(Math.abs(crOS)>0.004?'#c0264b':'#1f7a3d'))+';">'+(crOS==null?'Incomplete':dsrMoney(crOS))+'</b></div>'+
                dsrBtn('Save change reconciliation','dsrSaveChangeRecon()','primary');
            h+=dsrCard(crBody,'Change reconciliation');

            var pr=dsrPromo();
            var prBody='<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
                '<div style="flex:1;min-width:140px;">'+dsrNumIn('dsrPR_freeItems','Free items (#)',pr.free_items)+'</div>'+
                '<div style="flex:1;min-width:120px;">'+dsrNumIn('dsrPR_totalAmt','Promo total ($)',pr.promo_total_amt)+'</div>'+
                '<div style="flex:1;min-width:120px;">'+dsrNumIn('dsrPR_totalNum','Promo total (#)',pr.promo_total_num)+'</div>'+
                '</div><div style="display:flex;gap:8px;flex-wrap:wrap;">'+
                '<div style="flex:1;min-width:120px;">'+dsrNumIn('dsrPR_openDisc','Open discount ($)',pr.open_discount)+'</div>'+
                '<div style="flex:1;min-width:120px;">'+dsrNumIn('dsrPR_foodWaste','Food waste ($)',pr.food_waste)+'</div>'+
                '<div style="flex:1;min-width:150px;">'+dsrNumIn('dsrPR_empDisc','Employee discount ($)',pr.employee_discount)+'</div>'+
                '</div>'+
                dsrBtn('Save promo / waste','dsrSavePromo()','primary');
            h+=dsrCard(prBody,'Promo &amp; waste');
        }
        return h;
    }

    function dsrSaveCloseout(type){
        var payload={ ring_out_time:dsrVal('dsrC_'+type+'_ring'), prepared_by:dsrVal('dsrC_'+type+'_prep'), tape_total:dsrValF('dsrC_'+type+'_tape'), bag_count:dsrValF('dsrC_'+type+'_bags'), deposit:dsrValF('dsrC_'+type+'_deposit'), transactions:dsrValF('dsrC_'+type+'_tx') };
        if(type==='night') payload.net_tape_total=dsrValF('dsrC_'+type+'_netTape');
        dsrRpc('dsr_closeout_save',{p_id:_dsr.reportId,p_type:type,p_payload:payload},function(){ dsrLoadReport(); });
    }
    function dsrSaveRegister(type,idx,existingId){
        var c=dsrCloseoutOf(type);
        if(!c || c.id==null){ alert('Save the closeout details above first.'); return; }
        var pos=dsrPositions()[idx];
        var pre='dsrR_'+type+'_'+idx+'_';
        var payload={ position_label:pos, employee_id:dsrVal(pre+'emp')||null };
        DSR_DENOMS.forEach(function(d){ payload[d[0]]=dsrValF(pre+d[0]); });
        if(existingId!=null) payload.id=existingId;
        dsrRpc('dsr_register_save',{p_closeout_id:c.id,p_payload:payload},function(){ dsrLoadReport(); });
    }
    function dsrSavePaymentAdj(type){
        var c=dsrCloseoutOf(type);
        if(!c || c.id==null){ alert('Save the closeout details above first.'); return; }
        var payload={};
        DSR_PAY_CATS.forEach(function(pc){ payload[pc[0]]=dsrValF('dsrP_'+type+'_'+pc[0]); });
        dsrRpc('dsr_payment_adj_save',{p_closeout_id:c.id,p_payload:payload},function(){ dsrLoadReport(); });
    }
    function dsrSaveChangeRecon(){
        var payload={ change_in_safe:dsrValF('dsrCR_inSafe'), required_target:dsrValF('dsrCR_target'), need_additional:dsrValF('dsrCR_need') };
        DSR_DENOMS.slice(0,7).forEach(function(d){ payload[d[0]]=dsrValF('dsrCR_'+d[0]); });
        dsrRpc('dsr_change_recon_save',{p_id:_dsr.reportId,p_payload:payload},function(){ dsrLoadReport(); });
    }
    function dsrSavePromo(){
        var payload={ free_items:dsrValF('dsrPR_freeItems'), promo_total_amt:dsrValF('dsrPR_totalAmt'), promo_total_num:dsrValF('dsrPR_totalNum'), open_discount:dsrValF('dsrPR_openDisc'), food_waste:dsrValF('dsrPR_foodWaste'), employee_discount:dsrValF('dsrPR_empDisc') };
        dsrRpc('dsr_promo_save',{p_id:_dsr.reportId,p_payload:payload},function(){ dsrLoadReport(); });
    }

    // ---- Combined Totals (read-only rollup) ----
    function dsrCombinedTab(){
        var five=dsrCloseoutOf('five')||{}, night=dsrCloseoutOf('night')||{};
        function row(label,key){ return '<tr><td style="padding:6px 8px;color:#5b6675;font-size:12.5px;">'+escapeHtml(label)+'</td><td style="padding:6px 8px;text-align:right;font-weight:700;">'+dsrMoney(five[key])+'</td><td style="padding:6px 8px;text-align:right;font-weight:700;">'+dsrMoney(night[key])+'</td><td style="padding:6px 8px;text-align:right;font-weight:800;color:#185FA5;">'+dsrMoney(dsrSum(five[key],night[key]))+'</td></tr>'; }
        var h='<table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:6px 8px;font-size:11px;color:#8a91a0;">Field</th><th style="text-align:right;padding:6px 8px;font-size:11px;color:#8a91a0;">5:00</th><th style="text-align:right;padding:6px 8px;font-size:11px;color:#8a91a0;">Night</th><th style="text-align:right;padding:6px 8px;font-size:11px;color:#8a91a0;">Total</th></tr></thead><tbody>'+
            row('Register total','register_total')+row('Tape total','tape_total')+row('Adjusted total','adj_total')+row('Deposit','deposit')+row('Over/Short','over_short')+
            '</tbody></table>';
        h+='<div style="margin-top:8px;font-size:11px;color:#8a91a0;">Read-only rollup of the 5:00 and Night sections you saved. Office Use fields are on the Office Review tab.</div>';
        return dsrCard(h,'Combined Totals (rollup)');
    }

    // ---- Log Book tab ----
    function dsrLogBookTab(){
        var h='';
        var items=dsrChecklistItems();
        var ckBody='';
        if(!items.length){ ckBody=dsrEmpty('No checklist lines configured yet.'); }
        else{
            items.forEach(function(it){
                var en=dsrChecklistEntryOf(it.id)||{};
                var pre='dsrCK_'+it.id+'_';
                ckBody+='<div style="border-bottom:1px solid #f1f2f6;padding:8px 0;">'+
                    '<div style="font-size:13px;font-weight:700;color:#1f2a44;margin-bottom:6px;">'+escapeHtml(it.label||'')+'</div>'+
                    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">'+
                        '<div style="width:70px;">'+dsrIn(pre+'am','AM initials',en.am_initials||'')+'</div>'+
                        '<div style="width:70px;">'+dsrIn(pre+'pm','PM initials',en.pm_initials||'')+'</div>'+
                        '<label style="font-size:12px;color:#5b6675;display:flex;align-items:center;gap:5px;margin-bottom:9px;"><input type="checkbox" id="'+pre+'complete"'+(en.complete?' checked':'')+'> Complete</label>'+
                        '<div style="flex:1;min-width:140px;">'+dsrIn(pre+'comment','Comment',en.comment||'')+'</div>'+
                        dsrBtn('Save','dsrSaveChecklistEntry('+it.id+')')+
                    '</div></div>';
            });
        }
        h+=dsrCard(ckBody,'Checklist');

        var threshold=(typeof cfgNum==='function')?cfgNum('dsr','rating_threshold',8):8;
        var rtBody='';
        DSR_RATING_CATS.forEach(function(rc){
            var cat=rc[0],lbl=rc[1]; var ex=dsrRatingOf(cat)||{}; var pre='dsrRT_'+cat+'_';
            rtBody+='<div style="border-bottom:1px solid #f1f2f6;padding:10px 0;">'+
                '<div style="font-size:13px;font-weight:700;color:#1f2a44;margin-bottom:6px;">'+escapeHtml(lbl)+' <span style="font-weight:400;color:#8a91a0;font-size:11px;">(1&ndash;10; a comment is required at or below '+threshold+')</span></div>'+
                '<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
                    '<div style="width:70px;">'+dsrNumIn(pre+'am','AM score',ex.am_score)+'</div>'+
                    '<div style="width:70px;">'+dsrIn(pre+'amInit','AM init.',ex.am_initials||'')+'</div>'+
                    '<div style="flex:1;min-width:140px;">'+dsrIn(pre+'amC','AM comment',ex.am_comment||'')+'</div>'+
                '</div><div style="display:flex;gap:8px;flex-wrap:wrap;">'+
                    '<div style="width:70px;">'+dsrNumIn(pre+'pm','PM score',ex.pm_score)+'</div>'+
                    '<div style="width:70px;">'+dsrIn(pre+'pmInit','PM init.',ex.pm_initials||'')+'</div>'+
                    '<div style="flex:1;min-width:140px;">'+dsrIn(pre+'pmC','PM comment',ex.pm_comment||'')+'</div>'+
                '</div>'+dsrBtn('Save '+lbl+' rating','dsrSaveRating(&quot;'+cat+'&quot;)')+
                '<div id="dsrRT_'+cat+'_err" style="color:#c0264b;font-size:11.5px;margin-top:4px;"></div>'+
            '</div>';
        });
        h+=dsrCard(rtBody,'Shift ratings (Speed / Cleanliness / Friendliness / Quality)');

        var lnBody='';
        DSR_LOG_SECTIONS.forEach(function(sec){
            var key=sec[0],lbl=sec[1]; var notes=dsrLogNotes(key);
            lnBody+='<div style="margin-bottom:12px;"><div style="font-size:12.5px;font-weight:700;color:#1f2a44;margin-bottom:4px;">'+escapeHtml(lbl)+'</div>';
            if(notes.length){ lnBody+='<div style="margin-bottom:6px;">'+notes.map(function(n){ return '<div style="background:#fafbfd;border:1px solid #eef0f5;border-radius:8px;padding:7px 9px;margin-bottom:5px;font-size:12.5px;color:#33303a;">'+escapeHtml(n.body||'')+'<div style="font-size:10.5px;color:#8a91a0;margin-top:3px;">'+escapeHtml(n.by||'')+(n.at?(' &middot; '+escapeHtml(String(n.at).slice(0,16).replace('T',' '))):'')+'</div></div>'; }).join('')+'</div>'; }
            else{ lnBody+=dsrEmpty('No notes yet.'); }
            lnBody+='<div style="display:flex;gap:8px;"><input id="dsrLN_'+key+'" type="text" placeholder="Add a note&hellip;" style="flex:1;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;">'+dsrBtn('Add','dsrAddLogNote(&quot;'+key+'&quot;)')+'</div></div>';
        });
        h+=dsrCard(lnBody,'Notes &amp; narratives');

        var atts=dsrAttachments();
        var atBody='';
        if(atts.length){ atBody+='<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">'+atts.map(function(a){ return '<a href="'+escapeHtml(a.url)+'" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:#fafbfd;border:1px solid #eef0f5;border-radius:8px;text-decoration:none;color:#185FA5;font-size:12px;font-weight:700;">&#128206; '+escapeHtml(a.caption||a.section||'Attachment')+'</a>'; }).join('')+'</div>'; }
        else{ atBody+=dsrEmpty('No attachments yet.'); }
        atBody+='<div id="dsrAtMsg" style="font-size:12px;color:#6b7686;margin-bottom:6px;"></div>'+dsrBtn('Upload attachment','dsrUploadAttachment()');
        h+=dsrCard(atBody,'Attachments');
        return h;
    }

    function dsrSaveChecklistEntry(itemId){
        var pre='dsrCK_'+itemId+'_';
        var cb=document.getElementById(pre+'complete');
        var payload={ am_initials:dsrVal(pre+'am'), pm_initials:dsrVal(pre+'pm'), complete:!!(cb&&cb.checked), comment:dsrVal(pre+'comment') };
        dsrRpc('dsr_checklist_entry_save',{p_id:_dsr.reportId,p_item_id:itemId,p_payload:payload},function(){ dsrLoadReport(); });
    }
    function dsrSaveRating(cat){
        var pre='dsrRT_'+cat+'_';
        var payload={ am_score:dsrValF(pre+'am')||null, am_initials:dsrVal(pre+'amInit'), am_comment:dsrVal(pre+'amC'), pm_score:dsrValF(pre+'pm')||null, pm_initials:dsrVal(pre+'pmInit'), pm_comment:dsrVal(pre+'pmC') };
        var errEl=document.getElementById('dsrRT_'+cat+'_err');
        if(errEl) errEl.textContent='';
        dsrRpc('dsr_rating_save',{p_id:_dsr.reportId,p_category:cat,p_payload:payload},function(){ dsrLoadReport(); }, function(err){
            var msg=(err&&err.message)||'Could not save rating.';
            if(errEl) errEl.textContent=msg; else alert(msg);
        });
    }
    function dsrAddLogNote(section){
        var el=document.getElementById('dsrLN_'+section);
        var body=el?el.value.trim():'';
        if(!body) return;
        dsrRpc('dsr_log_note_add',{p_id:_dsr.reportId,p_section:section,p_body:body},function(){ dsrLoadReport(); });
    }
    function dsrUploadAttachment(){
        var section=prompt('Attach to which section? (e.g. deposit_slip, five, night, logbook)','logbook');
        if(section===null) return;
        var inp=document.createElement('input'); inp.type='file'; inp.accept='image/*,application/pdf';
        inp.onchange=function(){
            var f=inp.files&&inp.files[0]; if(!f) return;
            var msg=document.getElementById('dsrAtMsg');
            function say(t){ if(msg) msg.textContent=t; }
            say('Preparing upload&hellip;');
            withPin(function(pin){
                supabaseClient.functions.invoke('material-upload',{body:{username:currentUser.username,pin:pin,filename:f.name,contentType:f.type||'application/octet-stream'}}).then(function(res){
                    var err=(res&&res.error)?res.error.message:((res&&res.data&&res.data.error)?res.data.error:null);
                    if(err){ say(''); alert('Upload failed: '+(String(err).indexOf('forbidden')>=0?'managers only':err)); return; }
                    var d=res&&res.data;
                    if(!d||!d.token){ say(''); alert('Upload could not start.'); return; }
                    say('Uploading '+f.name+'&hellip;');
                    supabaseClient.storage.from('training-materials').uploadToSignedUrl(d.path,d.token,f,{contentType:f.type||undefined}).then(function(up){
                        if(up.error){ say(''); alert('Upload failed: '+up.error.message); return; }
                        var pub=(supabaseClient.storage.from('training-materials').getPublicUrl(d.path)||{}).data||{};
                        var url=d.publicUrl||d.url||pub.publicUrl||d.path;
                        dsrRpc('dsr_attachment_add',{p_id:_dsr.reportId,p_section:section,p_url:url,p_caption:f.name},function(){ say(''); dsrLoadReport(); });
                    }).catch(function(){ say(''); alert('Upload failed.'); });
                }).catch(function(){ say(''); alert('Upload failed.'); });
            });
        };
        inp.click();
    }

    // ---- Labor tab ----
    function dsrLaborTab(){
        var l=dsrLabor();
        var h='<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
            '<div style="flex:1;min-width:150px;">'+dsrNumIn('dsrL_projAm','Projected AM sales ($)',l.proj_am_sales)+'</div>'+
            '<div style="flex:1;min-width:150px;">'+dsrNumIn('dsrL_projPm','Projected PM sales ($)',l.proj_pm_sales)+'</div>'+
            '<div style="flex:1;min-width:130px;">'+dsrNumIn('dsrL_wage','Avg hourly wage ($)',l.avg_wage)+'</div>'+
            '</div><div style="display:flex;gap:8px;flex-wrap:wrap;">'+
            '<div style="flex:1;min-width:100px;">'+dsrNumIn('dsrL_amHours','AM hours',l.am_hours)+'</div>'+
            '<div style="flex:1;min-width:100px;">'+dsrNumIn('dsrL_pmHours','PM hours',l.pm_hours)+'</div>'+
            '<div style="flex:1;min-width:140px;">'+dsrIn('dsrL_amMgr','AM manager',l.am_mgr||'')+'</div>'+
            '<div style="flex:1;min-width:140px;">'+dsrIn('dsrL_pmMgr','PM manager',l.pm_mgr||'')+'</div>'+
            '</div>'+dsrBtn('Save labor projection','dsrSaveLabor()','primary');
        h=dsrCard(h,'Labor projection inputs');

        var pctFmt=function(v){ return v==null?'Incomplete':(parseFloat(v).toFixed(1)+'%'); };
        var costFmt=function(v){ return v==null?'Incomplete':dsrMoney(v); };
        var dailyPctColor=(l.daily_pct!=null && (l.daily_pct<22 || l.daily_pct>26))?'#c0264b':'#1f7a3d';
        h+=dsrCard(
            '<div style="display:flex;flex-wrap:wrap;gap:10px;">'+
                dsrTotalTile('AM labor cost',costFmt(l.am_cost))+dsrTotalTile('PM labor cost',costFmt(l.pm_cost))+dsrTotalTile('Daily labor cost',costFmt(l.daily_cost))+
                dsrTotalTile('AM labor %',pctFmt(l.am_pct))+dsrTotalTile('PM labor %',pctFmt(l.pm_pct))+dsrTotalTile('Daily labor %',pctFmt(l.daily_pct),l.daily_pct!=null?dailyPctColor:undefined)+
            '</div><div style="font-size:11px;color:#8a91a0;margin-top:8px;">Computed by the server after you save. Shown as "Incomplete" (never a divide-by-zero error) until enough inputs are saved.</div>',
            'Labor cost &amp; % (server-computed)'
        );
        return h;
    }
    function dsrSaveLabor(){
        var payload={ proj_am_sales:dsrValF('dsrL_projAm'), proj_pm_sales:dsrValF('dsrL_projPm'), avg_wage:dsrValF('dsrL_wage'), am_hours:dsrValF('dsrL_amHours'), pm_hours:dsrValF('dsrL_pmHours'), am_mgr:dsrVal('dsrL_amMgr'), pm_mgr:dsrVal('dsrL_pmMgr') };
        dsrRpc('dsr_labor_save',{p_id:_dsr.reportId,p_payload:payload},function(){ dsrLoadReport(); });
    }

    // ---- Office Review tab (office/admin only) ----
    function dsrOfficeTab(){
        var o=dsrOfficeReview();
        var h='<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
            '<div style="flex:1;min-width:120px;">'+dsrNumIn('dsrO_cc','Credit cards ($)',o.credit_cards)+'</div>'+
            '<div style="flex:1;min-width:120px;">'+dsrNumIn('dsrO_checks','Checks ($)',o.checks)+'</div>'+
            '<div style="flex:1;min-width:120px;">'+dsrNumIn('dsrO_cash','Cash ($)',o.cash)+'</div>'+
            '</div><div style="display:flex;gap:8px;flex-wrap:wrap;">'+
            '<div style="flex:1;min-width:170px;">'+dsrNumIn('dsrO_ccDep','Cash/check deposit ($)',o.cash_check_deposit)+'</div>'+
            '<div style="flex:1;min-width:160px;">'+dsrIn('dsrO_depBy','Deposited by',o.deposited_by||'')+'</div>'+
            '<div style="flex:1;min-width:170px;">'+dsrIn('dsrO_verBy','Deposit verified by',o.deposit_verified_by||'')+'</div>'+
            '</div>'+dsrTA('dsrO_notes','Review notes',o.review_notes||'')+
            '<div style="margin-bottom:9px;"><label style="display:block;font-size:11px;font-weight:700;color:#5b6675;margin-bottom:3px;">Review status</label><select id="dsrO_status" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;">'+['Pending','Reviewed','Needs Follow-up'].map(function(s){return '<option value="'+s+'"'+(o.review_status===s?' selected':'')+'>'+s+'</option>';}).join('')+'</select></div>'+
            dsrBtn('Save office review','dsrSaveOfficeReview()','primary');
        return dsrCard(h,'Office Use Only');
    }
    function dsrSaveOfficeReview(){
        var payload={ credit_cards:dsrValF('dsrO_cc'), checks:dsrValF('dsrO_checks'), cash:dsrValF('dsrO_cash'), cash_check_deposit:dsrValF('dsrO_ccDep'), deposited_by:dsrVal('dsrO_depBy'), deposit_verified_by:dsrVal('dsrO_verBy'), review_notes:dsrVal('dsrO_notes'), review_status:dsrVal('dsrO_status') };
        dsrRpc('dsr_office_review_save',{p_id:_dsr.reportId,p_payload:payload},function(){ dsrLoadReport(); });
    }

    // ---- Review & Submit tab ----
    function dsrValidationHtml(v){
        if(v.ok) return '<div style="color:#1f7a3d;font-weight:700;font-size:13px;">&#10003; Ready to submit &mdash; no blockers.</div>';
        var b=v.blockers||[];
        return '<div style="color:#c0264b;font-weight:700;font-size:13px;margin-bottom:6px;">'+b.length+' blocker(s):</div><ul style="margin:0;padding-left:18px;">'+b.map(function(x){ return '<li style="font-size:12.5px;color:#33303a;margin-bottom:3px;">'+escapeHtml(String(x))+'</li>'; }).join('')+'</ul>';
    }
    function dsrValidate(){
        dsrRpc('dsr_validate',{p_id:_dsr.reportId},function(d){ _dsr.lastValidation=d||{ok:false,blockers:['No response from server.']}; dsrRenderWorkspace(); });
    }
    function dsrSubmit(){
        if(!confirm('Submit this report? It will lock normal edits and settle totals into daily sales.')) return;
        dsrRpc('dsr_submit',{p_id:_dsr.reportId},function(){ alert('Report submitted.'); dsrLoadReport(); }, function(err){ alert((err&&err.message)||'Could not submit.'); });
    }
    function dsrReviewTab(){
        var rep=dsrRep();
        var h=dsrCard(dsrBtn('Run validation check','dsrValidate()','primary')+'<div id="dsrValRes" style="margin-top:10px;">'+(_dsr.lastValidation?dsrValidationHtml(_dsr.lastValidation):'')+'</div>','Validate');
        var canSubmit=!!(_dsr.lastValidation && _dsr.lastValidation.ok);
        if(rep.status==='Locked'){
            h+=dsrCard('<div style="color:#5b6472;font-size:13px;">This report is locked.'+((isAdminManager()||isDiscAdmin())?(' <button onclick="dsrReopen('+rep.id+')" style="margin-left:8px;background:#c0264b;color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:700;cursor:pointer;">Reopen</button>'):'')+'</div>','Submit');
        } else {
            h+=dsrCard(dsrBtn('Submit report',canSubmit?'dsrSubmit()':'dsrValidate()','primary')+'<div style="font-size:11.5px;color:#8a91a0;margin-top:6px;">Run validation first &mdash; submit is blocked until there are no blockers.</div>','Submit');
        }
        return h;
    }
