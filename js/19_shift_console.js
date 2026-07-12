    // ============================================================
    // SHIFT LEADER CONSOLE / ACTIVE SHIFT MODE (js/19)
    // A refinement/expansion of the Daily Store Report (js/18): one
    // progressive-disclosure work surface used only while actively
    // running a shift. Gathers closeout, log book, labor, shift
    // checklist and temperature log behind ONE console; the Daily
    // Store Report remains the final record and is REUSED, not
    // rebuilt (all dsr_* RPCs + dsrWorkspace/openDailyReport).
    // Entry point: openShiftConsole(). Overlay id: shiftConsoleModal.
    // Tile: btn-shiftConsole (author wires the tile + script tag).
    //
    // SERVER SHAPE CONTRACT (matches shift_console.sql exactly):
    //   shc_session_open/_current/_get/_set/_end/_reopen -> jsonb with
    //     TOP-LEVEL keys: id, location, business_date, shift_type,
    //     leader_name, support_names, started_at, ended_at, status,
    //     dsr_report_id, recap, events:[{id,kind,body,meta,by,at}]
    //     (shc_session_current returns {id:null} when none active).
    //   shc_sessions_list -> ARRAY of summary rows.
    //   shc_priorities_get -> ARRAY of {id,location,title,body,
    //     starts_on,ends_on,active,source}.
    // Config: app_settings group 'shc_config' (loaded here directly via
    // app_settings_get; every value has a hardcoded fallback below).
    // ============================================================

    var _shc = {
        view:'start', cfg:null, session:null,
        data:{ temps:null, checks:{}, windows:null, tasks:null, dsrRow:undefined, priorities:null, contacts:null },
        sec:{}, dismissed:{}, dsrWatch:null, histFilters:{ location:'', status:'' }
    };

    var SHC_DEFAULTS = {
        shc_shift_types:'AM,PM,Mid,Custom,5:00 Ring-Out Only,Closing',
        shc_leader_roles:'Shift Leader,Team Lead',
        shc_ringout_due:'17:00',
        shc_close_due:'21:00',
        shc_temp_due_times:'11:00,15:00,19:00',
        shc_overdue_grace_min:'45',
        shc_start_prompts:'Pep talk & uniform check|Walk the lobby, food bar & restrooms|Count your drawer before opening|Check today’s store priorities below',
        shc_prompt_min_len:'12',
        shc_kw_maintenance:'broken,broke,leak,leaking,repair,not working,stopped working,went down,is down,fix,error code,compressor,motor',
        shc_kw_supply:'out of,low on,ran out,running low,shortage,need more,86,eighty-six,restock',
        shc_kw_attendance:'late,no show,no-show,called in,called out,call out,left early,tardy,didn’t show',
        shc_kw_employee:'attitude,coaching,performance issue,warning,write up,wrote up,insubordinate',
        shc_kw_shoutout:'great job,awesome,killed it,crushed it,shout out,shoutout,amazing,went above,stepped up',
        shc_kw_customer:'customer complaint,complaint,refund,upset customer,angry customer,comped,bad review',
        shc_kw_delivery:'delivery,driver,truck,vendor,shorted us,missing item,wrong item,invoice',
        shc_kw_safety:'injury,injured,hurt,slip,fell,burn,cut,accident,hazard,unsafe',
        shc_kw_cash:'over/short,drawer short,drawer over,count out,count-out,missing cash,deposit off,short on cash',
        shc_recap_ask_priority:'1'
    };

    // Log-book sections mirror js/18 DSR_LOG_SECTIONS so notes land in the report.
    var SHC_LOG_SECTIONS = [['general_notes','General notes'],['employee_am','Employee / Scheduling — AM'],['employee_pm','Employee / Scheduling — PM'],['customer_comments','Customer comments'],['building_maint','Building maintenance'],['cleaning','Cleaning items'],['manager_requests','Manager requests'],['delivery_issues','Delivery issues'],['balancing_comments','Balancing comments']];

    // Smart-prompt categories: keyword cfg key -> suggested follow-up route.
    var SHC_PROMPT_DEFS = [
        { kind:'maintenance',     key:'shc_kw_maintenance', label:'🔧 Create a maintenance ticket' },
        { kind:'supply',          key:'shc_kw_supply',      label:'📦 Create a supply request' },
        { kind:'task_attendance', key:'shc_kw_attendance',  label:'🕒 Attendance follow-up for manager review' },
        { kind:'task_employee',   key:'shc_kw_employee',    label:'📝 Employee-note follow-up (manager review)' },
        { kind:'shoutout',        key:'shc_kw_shoutout',    label:'🎉 Post a shoutout' },
        { kind:'task_customer',   key:'shc_kw_customer',    label:'💬 Customer-issue follow-up' },
        { kind:'task_delivery',   key:'shc_kw_delivery',    label:'🚚 Delivery-issue follow-up' },
        { kind:'task_safety',     key:'shc_kw_safety',      label:'⚠️ Safety follow-up' },
        { kind:'task_cash',       key:'shc_kw_cash',        label:'💵 Cash / count-out review follow-up' }
    ];
    var SHC_TASK_PREFIX = { task_attendance:'Attendance follow-up: ', task_employee:'Employee note follow-up: ', task_customer:'Customer issue: ', task_delivery:'Delivery issue: ', task_safety:'Safety: ', task_cash:'Cash/count-out review: ' };

    // ---- RPC wrapper (mirrors scRpc / dsrRpc) ----
    function shcRpc(name,args,cb,onerr){
        withPin(function(pin){
            supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){
                if(r.error){ if(onerr) onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'Shift leaders and managers only.':r.error.message); return; }
                cb(r.data);
            }).catch(function(){ if(onerr) onerr({message:'Connection error'}); else alert('Connection error.'); });
        });
    }

    // ---- config (app_settings group shc_config; tolerant, always has fallbacks) ----
    function shcLoadCfg(cb){
        if(_shc.cfg){ cb(); return; }
        withPin(function(pin){
            supabaseClient.rpc('app_settings_get',{p_username:currentUser.username,p_password:pin,p_group:'shc_config'}).then(function(r){
                var map={};
                if(!r.error && r.data){ (r.data||[]).forEach(function(row){ if(row && row.key!=null) map[row.key]=row.value; }); }
                _shc.cfg=map; cb();
            }).catch(function(){ _shc.cfg={}; cb(); });
        }, function(){ _shc.cfg={}; cb(); });
    }
    function shcCfg(key,fb){
        try{ var v=_shc.cfg && _shc.cfg[key]; if(v!=null && v!=='') return v; }catch(e){}
        try{ if(typeof cfg==='function'){ var v2=cfg('shc_config',key,null); if(v2!=null && v2!=='') return v2; } }catch(e){}
        return (fb!==undefined)?fb:SHC_DEFAULTS[key];
    }
    function shcCsv(key){ return String(shcCfg(key)||'').split(',').map(function(s){return s.trim();}).filter(Boolean); }
    function shcPipes(key){ return String(shcCfg(key)||'').split('|').map(function(s){return s.trim();}).filter(Boolean); }

    // ---- role gate: managers/admin/VP + configurable "leader" roles ----
    function shcCanUse(){
        if(!currentUser) return false;
        try{ if(isManagerRole()||isAdminManager()||isDiscAdmin()) return true; }catch(e){}
        var role=String(currentUser.role||'').toLowerCase();
        if(role.indexOf('lead')>=0) return true;
        var extra=shcCsv('shc_leader_roles');
        for(var i=0;i<extra.length;i++){ if(extra[i] && role===extra[i].toLowerCase()) return true; }
        return false;
    }
    function shcIsMgr(){ try{ return !!(isManagerRole()||isAdminManager()||isDiscAdmin()); }catch(e){ return false; } }

    // ---- overlay shell (cloned from js/18 dsrOverlay/dsrHeader pattern) ----
    function shcOverlay(){ var ov=document.getElementById('shiftConsoleModal'); if(!ov){ ov=document.createElement('div'); ov.id='shiftConsoleModal'; ov.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100000;overflow:auto;'; document.body.appendChild(ov); } ov.style.display='block'; return ov; }
    function shcClose(){ var ov=document.getElementById('shiftConsoleModal'); if(ov) ov.style.display='none'; if(_shc.dsrWatch){ clearInterval(_shc.dsrWatch); _shc.dsrWatch=null; } }
    function shcHeader(title,back){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;">'+(back?('<button onclick="'+back+'" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;">&#8249; Back</button>'):'')+'<b style="flex:1;font-size:16px;">'+escapeHtml(title||'')+'</b><button onclick="shcClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }
    function shcCard(inner,title,accent){ return '<div style="background:#fff;border:1px solid '+(accent?accent:'#ececf2')+';border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,.04);">'+(title?('<div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#5b6675;margin-bottom:10px;letter-spacing:.3px;">'+title+'</div>'):'')+inner+'</div>'; }
    function shcBtn(label,onclick,kind){ var bg=kind==='primary'?'#1f7a3d':(kind==='danger'?'#c0264b':(kind==='ghost'?'#eef0f3':'#185FA5')); var col=kind==='ghost'?'#33404e':'#fff'; return '<button onclick="'+onclick+'" style="background:'+bg+';color:'+col+';border:none;border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:700;cursor:pointer;margin-top:4px;">'+label+'</button>'; }
    function shcEmpty(msg){ return '<div style="text-align:center;color:#6b7686;padding:18px 12px;font-size:13px;">'+escapeHtml(msg)+'</div>'; }
    function shcChip(label,color,bg){ return '<span style="display:inline-block;background:'+(bg||'#fff4e0')+';color:'+(color||'#9a5b00')+';padding:4px 10px;border-radius:99px;font-size:11.5px;font-weight:700;margin:0 5px 5px 0;">'+label+'</span>'; }
    function shcTodayIso(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
    function shcNowMin(){ var n=new Date(); return n.getHours()*60+n.getMinutes(); }
    function shcHMtoMin(hm){ var p=String(hm||'').split(':'); var h=parseInt(p[0],10), m=parseInt(p[1],10); if(isNaN(h)) return null; return h*60+(isNaN(m)?0:m); }
    function shcTimeFmt(s){ if(!s) return ''; try{ return new Date(s).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }catch(e){ return ''; } }
    function shcStoreLoc(){ return (typeof tempStoreLoc==='function' && tempStoreLoc()) || (currentUser && currentUser.home_location) || ''; }
    function shcSess(){ return _shc.session||{}; }
    function shcEvents(kind){ var ev=(shcSess().events)||[]; return kind?ev.filter(function(e){return e.kind===kind;}):ev; }

    // ============================================================
    // ENTRY
    // ============================================================
    function openShiftConsole(){
        if(!shcCanUse()){ alert('The Shift Leader Console is for shift leaders and managers. Ask a manager if you should have access.'); return; }
        var ov=shcOverlay();
        ov.innerHTML=shcHeader('Shift Leader Console','')+'<div style="max-width:760px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading&hellip;</div>';
        shcLoadCfg(function(){
            var loc=shcStoreLoc();
            if(!loc){ _shc.view='start'; _shc.session=null; shcRenderStart(); return; }
            shcRpc('shc_session_current',{p_location:loc,p_business_date:shcTodayIso()},function(d){
                if(d && d.id!=null){ _shc.session=d; _shc.view='console'; shcRenderConsole(); shcLoadAll(); }
                else { _shc.session=null; _shc.view='start'; shcRenderStart(); }
            }, function(err){
                ov.innerHTML=shcHeader('Shift Leader Console','')+'<div style="max-width:760px;margin:0 auto;padding:30px 16px;color:#c0264b;text-align:center;">'+escapeHtml((err&&err.message)||'Could not load. Has shift_console.sql been applied?')+'</div>';
            });
        });
    }

    // ============================================================
    // START SHIFT (landing when no active session)
    // ============================================================
    function shcRenderStart(){
        var ov=shcOverlay();
        var stores=(typeof HUB_STORES!=='undefined'?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell']);
        var myLoc=shcStoreLoc();
        var types=shcCsv('shc_shift_types');
        var prompts=shcPipes('shc_start_prompts');
        var h=shcHeader('Shift Leader Console','');
        h+='<div style="max-width:760px;margin:0 auto;padding:16px 16px 60px;">';
        h+='<p style="font-size:12.5px;color:#6b7686;margin-top:0;">Run your shift from one place — checklist, temps, log book and closeout, with follow-ups routed into the Hub. Off the clock? Just close this; nothing here follows you home.</p>';

        var body='<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
            '<div style="flex:1;min-width:170px;"><label style="display:block;font-size:11px;font-weight:700;color:#5b6675;margin-bottom:3px;">Store</label><select id="shcS_loc" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;">'+stores.map(function(s){return '<option value="'+escapeHtml(s)+'"'+(myLoc===s?' selected':'')+'>'+escapeHtml(s)+'</option>';}).join('')+'</select></div>'+
            '<div style="flex:1;min-width:170px;"><label style="display:block;font-size:11px;font-weight:700;color:#5b6675;margin-bottom:3px;">Shift type</label><select id="shcS_type" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;">'+types.map(function(t){return '<option value="'+escapeHtml(t)+'">'+escapeHtml(t)+'</option>';}).join('')+'</select></div>'+
            '</div>'+
            '<div style="margin-bottom:9px;"><label style="display:block;font-size:11px;font-weight:700;color:#5b6675;margin-bottom:3px;">Supporting leaders (optional)</label><input id="shcS_support" type="text" placeholder="e.g. Maria (drive-thru lead)" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;"></div>'+
            '<div style="font-size:12px;color:#6b7686;margin:4px 0 8px;">Leader on duty: <b style="color:#1f2a44;">'+escapeHtml((currentUser&&currentUser.name)||'')+'</b> &middot; '+escapeHtml(shcTodayIso())+'</div>'+
            shcBtn('&#9654; Start shift','shcStartShift()','primary');
        h+=shcCard(body,'Start / continue a shift');

        if(prompts.length){
            h+=shcCard('<ul style="margin:0;padding-left:18px;">'+prompts.map(function(p){ return '<li style="font-size:12.5px;color:#33404e;margin-bottom:4px;">'+escapeHtml(p)+'</li>'; }).join('')+'</ul>','Before you start');
        }

        var links='<div style="display:flex;gap:8px;flex-wrap:wrap;">';
        links+=shcBtn('Daily Store Reports','shcOpenDsrModule()','ghost');
        if(shcIsMgr()){ links+=shcBtn('Past shift recaps','shcHistory()','ghost'); }
        links+='</div>';
        h+=shcCard(links,'More');
        h+='</div>';
        ov.innerHTML=h;
    }
    function shcOpenDsrModule(){ shcClose(); if(typeof openDailyReport==='function') openDailyReport(); else alert('The Daily Store Report module is not loaded.'); }

    function shcStartShift(){
        var loc=(document.getElementById('shcS_loc')||{}).value||shcStoreLoc();
        var type=(document.getElementById('shcS_type')||{}).value||'AM';
        var support=(document.getElementById('shcS_support')||{}).value||'';
        if(!loc){ alert('Pick a store first.'); return; }
        var device=''; try{ device=(navigator.userAgent||'').slice(0,180); }catch(e){}
        shcRpc('shc_session_open',{p_location:loc,p_shift_type:type,p_business_date:shcTodayIso(),p_support:support,p_device:device},function(d){
            _shc.session=d||{}; _shc.view='console'; _shc.sec={}; shcRenderConsole(); shcLoadAll();
        });
    }

    // ============================================================
    // DATA LOADS (all reuse existing RPCs; each patches the console)
    // ============================================================
    function shcLoadAll(){
        var s=shcSess(); var loc=s.location; if(!loc) return;
        withPin(function(pin){
            var U={p_username:currentUser.username,p_password:pin};
            supabaseClient.rpc('app_temp_points',Object.assign({p_location:loc},U)).then(function(r){ if(!r.error){ _shc.data.temps=r.data||[]; shcPatch(); } }).catch(function(){});
            ['open','close','clean'].forEach(function(sh){
                supabaseClient.rpc('app_checklist_items',Object.assign({p_shift:sh,p_location:loc},U)).then(function(r){ if(!r.error){ _shc.data.checks[sh]=r.data||[]; shcPatch(); } }).catch(function(){});
            });
            supabaseClient.rpc('app_checklist_windows',U).then(function(r){ if(!r.error){ _shc.data.windows=r.data||[]; shcPatch(); } }).catch(function(){});
            supabaseClient.rpc('app_my_tasks',U).then(function(r){ if(!r.error){ _shc.data.tasks=(r.data&&r.data.tasks)||[]; shcPatch(); } }).catch(function(){});
            supabaseClient.rpc('shc_priorities_get',Object.assign({p_location:loc},U)).then(function(r){ if(!r.error){ _shc.data.priorities=r.data||[]; shcPatch(); } }).catch(function(){});
            supabaseClient.rpc('dsr_list',Object.assign({p_filters:{location:loc,date:(s.business_date||shcTodayIso()),status:''}},U)).then(function(r){ if(!r.error){ var rows=r.data||[]; _shc.data.dsrRow=rows.length?rows[0]:null; shcPatch(); } }).catch(function(){});
            supabaseClient.rpc('app_contacts_list',Object.assign({p_location:loc},U)).then(function(r){ if(!r.error){ _shc.data.contacts=r.data||[]; shcPatch(); } }).catch(function(){});
        });
    }
    function shcRefreshSession(cb){
        shcRpc('shc_session_get',{p_session_id:shcSess().id},function(d){ _shc.session=d||_shc.session; if(cb) cb(); else shcPatch(); });
    }

    // ============================================================
    // CONSOLE (active shift landing — progressive disclosure)
    // ============================================================
    function shcRenderConsole(){
        var ov=shcOverlay(); var s=shcSess();
        var h=shcHeader('Active Shift — '+(s.location||''),'');
        h+='<div style="max-width:760px;margin:0 auto;padding:14px 16px 90px;">';

        // header strip
        var strip='<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">'+
            '<span style="font-size:20px;">&#127981;</span>'+
            '<div style="flex:1;min-width:200px;"><b style="font-size:15px;color:#1f2a44;">'+escapeHtml(s.location||'')+'</b> &middot; <span style="font-size:12.5px;color:#5b6675;">'+escapeHtml(String(s.business_date||'').slice(0,10))+' &middot; '+escapeHtml(s.shift_type||'')+'</span>'+
            '<div style="font-size:12px;color:#6b7686;">Leader: <b>'+escapeHtml(s.leader_name||'')+'</b>'+(s.support_names?(' &middot; with '+escapeHtml(s.support_names)):'')+' &middot; started '+escapeHtml(shcTimeFmt(s.started_at))+'</div></div>'+
            '<span style="background:'+(s.status==='Active'?'#1f7a3d':'#5b6472')+';color:#fff;padding:4px 12px;border-radius:99px;font-size:11px;font-weight:800;">'+escapeHtml(s.status||'')+'</span>'+
            '</div><div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">'+
            shcBtn('&#9632; End shift','shcEndShift()','danger')+
            shcBtn('Refresh','shcLoadAll(); shcRefreshSession();','ghost')+
            '</div>';
        h+=shcCard(strip,'');

        // due now
        h+=shcCard('<div id="shcDueBox">'+shcDueHtml()+'</div>','&#9200; Due now');

        // store priorities (only if any)
        h+='<div id="shcPrioWrap">'+shcPrioHtml()+'</div>';

        // shift-relevant tasks (filtered, never the whole task list)
        h+='<div id="shcTasksWrap">'+shcTasksHtml()+'</div>';

        // progressive-disclosure sections
        h+=shcSecShell('temps','🌡️ Temperature log',shcTempsSummary());
        h+=shcSecShell('checks','✅ Shift checklist',shcChecksSummary());
        h+=shcSecShell('log','📓 Log book',shcLogSummary());
        h+=shcSecShell('closeout','💰 Ring-out / closeout',shcCloseoutSummary());
        h+=shcSecShell('recap','🧾 Shift activity so far',shcEvents().length+' entries');
        h+=shcSecShell('emergency','🆘 Emergency resources','Contacts & procedures — read-only');

        h+='</div>';
        // floating quick-action button
        h+='<button onclick="shcQuickSheet()" title="Add follow-up" style="position:fixed;right:18px;bottom:18px;z-index:100002;background:#185FA5;color:#fff;border:none;border-radius:99px;padding:13px 18px;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);">&#10133; Add follow-up</button>';
        h+='<div id="shcSheet"></div>';
        ov.innerHTML=h;
        shcRestoreLogDraft();
    }

    function shcSecShell(key,title,summary){
        var open=!!_shc.sec[key];
        var hdr='<div onclick="shcToggleSec(&quot;'+key+'&quot;)" style="display:flex;align-items:center;gap:10px;cursor:pointer;">'+
            '<b style="flex:1;font-size:14px;color:#1f2a44;">'+title+'</b>'+
            '<span id="shcSum_'+key+'" style="font-size:11.5px;color:#6b7686;">'+(summary||'')+'</span>'+
            '<span style="color:#8a91a0;font-size:14px;">'+(open?'&#9650;':'&#9660;')+'</span></div>';
        var body=open?('<div id="shcSec_'+key+'" style="margin-top:12px;">'+shcSecBody(key)+'</div>'):'';
        return '<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:13px 14px;margin-bottom:10px;box-shadow:0 2px 6px rgba(0,0,0,.04);">'+hdr+body+'</div>';
    }
    function shcToggleSec(key){ _shc.sec[key]=!_shc.sec[key]; shcRenderConsole(); }
    function shcSecBody(key){
        switch(key){
            case 'temps': return shcTempsBody();
            case 'checks': return shcChecksBody();
            case 'log': return shcLogBody();
            case 'closeout': return shcCloseoutBody();
            case 'recap': return shcRecapBody();
            case 'emergency': return shcEmergencyBody();
        }
        return '';
    }
    // Patch summaries / boxes in place after async loads (no full re-render while typing).
    function shcPatch(){
        if(_shc.view!=='console') return;
        var el;
        el=document.getElementById('shcDueBox'); if(el) el.innerHTML=shcDueHtml();
        el=document.getElementById('shcPrioWrap'); if(el) el.innerHTML=shcPrioHtml();
        el=document.getElementById('shcTasksWrap'); if(el) el.innerHTML=shcTasksHtml();
        el=document.getElementById('shcSum_temps'); if(el) el.innerHTML=shcTempsSummary();
        el=document.getElementById('shcSum_checks'); if(el) el.innerHTML=shcChecksSummary();
        el=document.getElementById('shcSum_log'); if(el) el.innerHTML=shcLogSummary();
        el=document.getElementById('shcSum_closeout'); if(el) el.innerHTML=shcCloseoutSummary();
        el=document.getElementById('shcSum_recap'); if(el) el.innerHTML=shcEvents().length+' entries';
        el=document.getElementById('shcSec_temps'); if(el) el.innerHTML=shcTempsBody();
        el=document.getElementById('shcSec_checks'); if(el) el.innerHTML=shcChecksBody();
        el=document.getElementById('shcSec_closeout'); if(el) el.innerHTML=shcCloseoutBody();
        el=document.getElementById('shcSec_recap'); if(el) el.innerHTML=shcRecapBody();
        el=document.getElementById('shcSec_emergency'); if(el) el.innerHTML=shcEmergencyBody();
        // (log section intentionally NOT re-patched — protects in-progress typing)
    }

    // ---- Due-now (the heart of progressive disclosure) ----
    function shcDueHtml(){
        var items=[]; var nowM=shcNowMin(); var grace=parseInt(shcCfg('shc_overdue_grace_min'),10)||45;
        var s=shcSess(); var loc=s.location;
        // temps
        var temps=_shc.data.temps;
        if(temps && temps.length){
            var notLogged=temps.filter(function(p){ return !p.last; }).length;
            var failed=temps.filter(function(p){ return p.last && p.last.status!=='pass'; }).length;
            var dueTimes=shcCsv('shc_temp_due_times').map(shcHMtoMin).filter(function(x){return x!=null;});
            var anyDue=dueTimes.some(function(t){ return nowM>=t; });
            if(failed) items.push({html:'&#9888; '+failed+' temperature reading'+(failed>1?'s':'')+' OUT OF RANGE — corrective action needed', warn:true, go:"shcOpenSec('temps')"});
            if(notLogged && anyDue){ var over=dueTimes.some(function(t){ return nowM>=(t+grace); }); items.push({html:'🌡️ '+notLogged+' temp point'+(notLogged>1?'s':'')+' not logged today', warn:over, go:"shcOpenSec('temps')"}); }
        }
        // checklists (windows drive due times when configured)
        var names={open:'Opening',close:'Closing',clean:'Cleaning'};
        ['open','close','clean'].forEach(function(sh){
            var list=_shc.data.checks[sh]; if(!list || !list.length) return;
            var done=list.filter(function(i){return i.done;}).length;
            if(done>=list.length) return;
            var w=(_shc.data.windows||[]).find(function(x){ return x && x.active!==false && x.location===loc && String(x.shift_type||'').toLowerCase()===sh; });
            var dueM=w&&w.due_time?shcHMtoMin(String(w.due_time).slice(0,5)):null;
            if(dueM==null || nowM>=(dueM-120)){
                var late=(dueM!=null && nowM>(dueM+(parseInt(w.escalate_after_min||30,10))));
                items.push({html:'&#129534; '+names[sh]+' checklist '+done+'/'+list.length+(dueM!=null?(' — due '+String(w.due_time).slice(0,5)):''), warn:late, go:"shcOpenSec('checks')"});
            }
        });
        // ring-out / closeout
        var row=_shc.data.dsrRow;
        var ringM=shcHMtoMin(shcCfg('shc_ringout_due')); var closeM=shcHMtoMin(shcCfg('shc_close_due'));
        var dsrStatus=row?row.status:null;
        if(row===null){ items.push({html:'📄 Today’s Daily Store Report not started', warn:(ringM!=null&&nowM>=ringM), go:"shcOpenSec('closeout')"}); }
        else if(row && (dsrStatus==='Draft'||dsrStatus==='In Progress')){
            if(ringM!=null && nowM>=ringM) items.push({html:'💰 5:00 ring-out window — report is '+escapeHtml(dsrStatus), warn:false, go:"shcOpenSec('closeout')"});
            if(closeM!=null && nowM>=closeM) items.push({html:'🌙 Nightly closeout due — finish &amp; submit the report', warn:true, go:"shcOpenSec('closeout')"});
        }
        if(!items.length){
            if(_shc.data.temps==null && _shc.data.dsrRow===undefined) return '<div style="color:#6b7686;font-size:12.5px;">Checking what’s due&hellip;</div>';
            return '<div style="color:#1f7a3d;font-size:13px;font-weight:700;">&#10003; Nothing due right now — you’re on top of it.</div>';
        }
        return items.map(function(it){
            return '<div onclick="'+it.go+'" style="display:flex;align-items:center;gap:8px;background:'+(it.warn?'#fdf0f2':'#fffaf0')+';border:1px solid '+(it.warn?'#f3ccd4':'#f3e6c8')+';border-radius:10px;padding:9px 11px;margin-bottom:6px;cursor:pointer;">'+
                '<span style="flex:1;font-size:12.5px;color:'+(it.warn?'#a01b3e':'#7a5b12')+';font-weight:600;">'+it.html+'</span><span style="color:#c2c7d0;">&rsaquo;</span></div>';
        }).join('');
    }
    function shcOpenSec(key){ _shc.sec[key]=true; shcRenderConsole(); }

    // ---- Store priorities ----
    function shcPrioHtml(){
        var pr=_shc.data.priorities;
        var mgr=shcIsMgr();
        if((!pr || !pr.length) && !mgr) return '';
        var inner='';
        if(pr && pr.length){
            inner=pr.map(function(p){
                return '<div style="background:#f2f7ff;border:1px solid #d8e6f7;border-radius:10px;padding:9px 11px;margin-bottom:6px;">'+
                    '<div style="display:flex;gap:8px;align-items:center;"><b style="flex:1;font-size:12.5px;color:#185FA5;">&#11088; '+escapeHtml(p.title||'')+'</b>'+
                    (mgr?('<button onclick="shcRetirePriority('+p.id+')" style="background:#eef0f3;border:none;border-radius:7px;padding:4px 8px;font-size:10.5px;font-weight:700;color:#5b6472;cursor:pointer;">Retire</button>'):'')+'</div>'+
                    (p.body?('<div style="font-size:12px;color:#33404e;margin-top:3px;">'+escapeHtml(p.body)+'</div>'):'')+
                    (p.ends_on?('<div style="font-size:10.5px;color:#8a91a0;margin-top:3px;">through '+escapeHtml(p.ends_on)+'</div>'):'')+
                '</div>';
            }).join('');
        } else { inner=shcEmpty('No active store priorities.'); }
        if(mgr) inner+=shcBtn('&#10133; Add priority','shcAddPriority()','ghost');
        return shcCard(inner,'&#11088; Store priorities');
    }
    function shcAddPriority(){
        var title=prompt('Priority (short & action-oriented, e.g. "Focus: closing cleanliness"):'); if(title===null||!title.trim()) return;
        var body=prompt('One-line detail (optional):','')||'';
        var ends=prompt('Show through date (YYYY-MM-DD, optional):','')||'';
        var loc=prompt('Store (blank = this store, ALL = every store):','')||'';
        var payload={ title:title.trim(), body:body.trim(), ends_on:ends.trim(), location:(loc.trim()||shcSess().location), source:'manual', active:true };
        shcRpc('shc_priority_save',{p_payload:payload},function(){ shcLoadAll(); });
    }
    function shcRetirePriority(id){
        if(!confirm('Retire this priority card?')) return;
        shcRpc('shc_priority_save',{p_payload:{id:id,active:false}},function(){ shcLoadAll(); });
    }

    // ---- Shift-relevant tasks (filtered: overdue / due today only) ----
    function shcTasksHtml(){
        var tasks=_shc.data.tasks;
        if(tasks==null) return '';
        var today=shcTodayIso();
        var rel=(tasks||[]).filter(function(t){
            if(t.status==='done') return false;
            if(!t.due) return false;
            var d=String(t.due).slice(0,10);
            return d<=today;
        }).slice(0,5);
        if(!rel.length) return '';
        var inner=rel.map(function(t){
            var d=String(t.due||'').slice(0,10); var late=d<today;
            return '<div style="display:flex;gap:8px;align-items:center;border-bottom:1px solid #f1f2f6;padding:7px 0;">'+
                '<span style="font-size:14px;">'+(late?'&#9888;':'&#128203;')+'</span>'+
                '<span style="flex:1;font-size:12.5px;color:#33404e;font-weight:600;">'+escapeHtml(t.title||'')+'</span>'+
                '<span style="font-size:11px;color:'+(late?'#c0264b':'#8a91a0')+';font-weight:700;">'+(late?'overdue':'due today')+'</span></div>';
        }).join('');
        inner+='<div style="font-size:10.5px;color:#8a91a0;margin-top:6px;">Only shift-relevant tasks show here — the full list stays in My Day / Tasks.</div>';
        return shcCard(inner,'&#128203; Shift tasks ('+rel.length+')');
    }

    // ---- Temperature log (reuses app_temp_points / app_temp_log_save) ----
    function shcTempsSummary(){
        var t=_shc.data.temps; if(t==null) return 'loading…'; if(!t.length) return 'no equipment configured';
        var logged=t.filter(function(p){return p.last;}).length; var bad=t.filter(function(p){return p.last&&p.last.status!=='pass';}).length;
        return logged+'/'+t.length+' logged today'+(bad?(' · <b style="color:#c0264b;">'+bad+' out of range</b>'):'');
    }
    function shcTempsBody(){
        var list=_shc.data.temps;
        if(list==null) return shcEmpty('Loading equipment…');
        if(!list.length) return shcEmpty('No temp-log equipment configured for this store yet (Admin → Manage Lists).');
        return list.map(function(p){
            var last=p.last; var lastHtml;
            if(last){ var ok=(last.status==='pass'); lastHtml='<span style="font-size:11.5px;color:'+(ok?'#1f7a3d':'#c0264b')+';font-weight:700;">'+(ok?'&#10004;':'&#9888;')+' '+last.temp+'&deg;F '+escapeHtml(shcTimeFmt(last.at))+(ok?'':' — OUT OF RANGE')+'</span>'; }
            else lastHtml='<span style="font-size:11.5px;color:#b06a00;font-weight:700;">Not logged today</span>';
            return '<div style="border:1px solid #eef0f5;border-radius:10px;padding:9px 11px;margin-bottom:8px;">'+
                '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;"><b style="flex:1;font-size:13px;color:#1f2a44;">'+escapeHtml(p.name)+'</b><span style="font-size:11px;color:#8a91a0;">'+p.min+'&deg;–'+p.max+'&deg;F</span></div>'+
                '<div style="margin:3px 0 7px;">'+lastHtml+'</div>'+
                '<div style="display:flex;gap:6px;align-items:center;">'+
                    '<input type="number" inputmode="decimal" id="shcTv_'+p.id+'" placeholder="&deg;F" style="width:76px;padding:8px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;">'+
                    '<input type="text" id="shcTn_'+p.id+'" placeholder="Note (optional)" style="flex:1;min-width:0;padding:8px;border:1px solid #cdd5e0;border-radius:8px;font-size:12px;">'+
                    '<button onclick="shcSaveTemp('+p.id+','+p.min+','+p.max+')" style="background:#185FA5;color:#fff;border:none;border-radius:8px;padding:8px 13px;font-size:12.5px;font-weight:700;cursor:pointer;">Log</button>'+
                '</div></div>';
        }).join('');
    }
    function shcSaveTemp(pointId,minT,maxT){
        var inp=document.getElementById('shcTv_'+pointId); var noteEl=document.getElementById('shcTn_'+pointId);
        if(!inp) return; var val=parseFloat(inp.value);
        if(isNaN(val)){ alert('Enter a temperature.'); inp.focus(); return; }
        var note=noteEl?noteEl.value.trim():'';
        var out=(val<minT||val>maxT);
        if(out && !note){
            var ca=prompt(val+'°F is outside the safe range ('+minT+'–'+maxT+'°F). What corrective action are you taking? (required)');
            if(ca===null) return;
            if(!ca.trim()){ alert('A corrective action is required for out-of-range temps.'); return; }
            note='Corrective action: '+ca.trim();
        }
        shcRpc('app_temp_log_save',{p_point_id:pointId,p_temp_f:val,p_note:note},function(d){
            var st=(d&&d.status)||'';
            if(st==='fail'||out){
                shcRpc('shc_event_log',{p_session_id:shcSess().id,p_kind:'temp_flag',p_body:'Out-of-range temp: '+val+'°F on point #'+pointId+(note?(' — '+note):''),p_meta:{point_id:pointId,temp:val}},function(){ shcRefreshSession(); },function(){});
                if(confirm('Logged. This looks equipment-related — create a maintenance ticket now?')){
                    shcQuickCreate('maintenance','Temp out of range: '+val+'°F — check equipment (point #'+pointId+')');
                }
            }
            shcLoadAll();
        });
    }

    // ---- Shift checklist (reuses app_checklist_items / app_checklist_toggle) ----
    var _shcClTab='open';
    function shcChecksSummary(){
        var parts=[]; var names={open:'Open',close:'Close',clean:'Clean'};
        ['open','close','clean'].forEach(function(sh){ var l=_shc.data.checks[sh]; if(l&&l.length){ var d=l.filter(function(i){return i.done;}).length; parts.push(names[sh]+' '+d+'/'+l.length); } });
        return parts.length?parts.join(' · '):'loading…';
    }
    function shcChecksBody(){
        var h='<div style="display:flex;gap:6px;margin-bottom:10px;">'+['open','close','clean'].map(function(sh){
            var on=_shcClTab===sh; var lbl={open:'Opening',close:'Closing',clean:'Cleaning'}[sh];
            return '<button onclick="shcClTab(&quot;'+sh+'&quot;)" style="background:'+(on?'#185FA5':'#eef0f3')+';color:'+(on?'#fff':'#5b6472')+';border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;">'+lbl+'</button>';
        }).join('')+'</div>';
        var list=_shc.data.checks[_shcClTab];
        if(list==null) return h+shcEmpty('Loading…');
        if(!list.length) return h+shcEmpty('No items configured for this list (Admin → Manage Lists).');
        h+=list.map(function(i){
            return '<div onclick="shcToggleCheck('+i.id+','+(i.done?'false':'true')+')" style="display:flex;align-items:center;gap:10px;border-bottom:1px solid #f1f2f6;padding:8px 0;cursor:pointer;'+(i.done?'opacity:.65;':'')+'">'+
                '<div style="width:22px;height:22px;border-radius:6px;border:2px solid '+(i.done?'#1f7a3d':'#bbb')+';background:'+(i.done?'#1f7a3d':'#fff')+';color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">'+(i.done?'&#10004;':'')+'</div>'+
                '<div style="flex:1;"><div style="font-size:13px;font-weight:600;color:#33404e;'+(i.done?'text-decoration:line-through;color:#8a91a0;':'')+'">'+escapeHtml(i.label)+'</div>'+
                (i.done&&i.by?('<div style="font-size:10.5px;color:#8a91a0;">'+escapeHtml(i.by)+' · '+escapeHtml(shcTimeFmt(i.at))+'</div>'):'')+'</div></div>';
        }).join('');
        h+='<div style="font-size:10.5px;color:#8a91a0;margin-top:8px;">Unfinished items will appear on your End Shift Summary. The manager checklist inside the Daily Report (pep talk, walk-arounds…) lives on the report’s Log Book tab.</div>';
        return h;
    }
    function shcClTab(sh){ _shcClTab=sh; var el=document.getElementById('shcSec_checks'); if(el) el.innerHTML=shcChecksBody(); }
    function shcToggleCheck(itemId,done){
        shcRpc('app_checklist_toggle',{p_item_id:itemId,p_location:shcSess().location,p_done:done},function(){
            withPin(function(pin){
                supabaseClient.rpc('app_checklist_items',{p_username:currentUser.username,p_password:pin,p_shift:_shcClTab,p_location:shcSess().location}).then(function(r){ if(!r.error){ _shc.data.checks[_shcClTab]=r.data||[]; shcPatch(); } }).catch(function(){});
            });
        });
    }

    // ---- Log book (writes into the DSR log via dsr_log_note_add + smart prompts) ----
    function shcLogSummary(){ var n=shcEvents('note').length; return n?(n+' note'+(n>1?'s':'')+' this shift'):'write it as it happens'; }
    function shcLogBody(){
        var h='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;">'+
            '<select id="shcLogSec" style="padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;">'+SHC_LOG_SECTIONS.map(function(s){ return '<option value="'+s[0]+'">'+escapeHtml(s[1])+'</option>'; }).join('')+'</select></div>'+
            '<textarea id="shcLogTxt" rows="3" placeholder="What’s happening? Write naturally — the console will suggest follow-ups when it can help." oninput="shcLogInput()" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;font-family:inherit;"></textarea>'+
            '<div id="shcPromptBox" style="margin-top:6px;"></div>'+
            '<div style="display:flex;gap:8px;align-items:center;margin-top:4px;">'+shcBtn('Save to log book','shcSaveLogNote()','primary')+'<span id="shcLogMsg" style="font-size:11.5px;color:#6b7686;"></span></div>'+
            '<div style="font-size:10.5px;color:#8a91a0;margin-top:6px;">Notes save into today’s Daily Store Report log book (drafts autosave on this device). Suggestions are optional — nothing is created unless you choose it.</div>';
        var notes=shcEvents('note');
        if(notes.length){
            h+='<div style="margin-top:10px;">'+notes.slice(-5).reverse().map(function(n){
                return '<div style="background:#fafbfd;border:1px solid #eef0f5;border-radius:8px;padding:7px 9px;margin-bottom:5px;font-size:12.5px;color:#33303a;">'+escapeHtml(n.body||'')+'<div style="font-size:10.5px;color:#8a91a0;margin-top:2px;">'+escapeHtml(n.by||'')+' · '+escapeHtml(shcTimeFmt(n.at))+'</div></div>';
            }).join('')+'</div>';
        }
        return h;
    }
    function shcDraftKey(){ return 'shcDraft_'+(shcSess().id||'x'); }
    function shcRestoreLogDraft(){ try{ var el=document.getElementById('shcLogTxt'); if(el){ var d=localStorage.getItem(shcDraftKey()); if(d && !el.value){ el.value=d; shcLogInput(); } } }catch(e){} }
    var _shcDetT=null;
    function shcLogInput(){
        try{ var el=document.getElementById('shcLogTxt'); if(el) localStorage.setItem(shcDraftKey(), el.value); }catch(e){}
        if(_shcDetT) clearTimeout(_shcDetT);
        _shcDetT=setTimeout(shcRunDetect,450);
    }
    function shcRunDetect(){
        var el=document.getElementById('shcLogTxt'); var box=document.getElementById('shcPromptBox');
        if(!el||!box) return;
        var txt=el.value||'';
        var minLen=parseInt(shcCfg('shc_prompt_min_len'),10)||12;
        if(txt.trim().length<minLen){ box.innerHTML=''; return; }
        var hits=shcDetect(txt).filter(function(m){ return !_shc.dismissed[m.kind]; }).slice(0,3);
        if(!hits.length){ box.innerHTML=''; return; }
        box.innerHTML='<div style="font-size:10.5px;color:#8a91a0;margin-bottom:4px;">Suggested follow-ups (optional):</div>'+hits.map(function(m){
            return '<span style="display:inline-flex;align-items:center;gap:6px;background:#f2f7ff;border:1px solid #d8e6f7;border-radius:99px;padding:5px 6px 5px 11px;margin:0 6px 6px 0;">'+
                '<a onclick="shcPromptAccept(&quot;'+m.kind+'&quot;)" style="font-size:11.5px;color:#185FA5;font-weight:700;cursor:pointer;">'+m.label+'</a>'+
                '<a onclick="shcPromptDismiss(&quot;'+m.kind+'&quot;)" title="Dismiss" style="color:#8a91a0;cursor:pointer;font-size:12px;padding:0 5px;">&times;</a></span>';
        }).join('');
    }
    function shcDetect(text){
        var t=' '+String(text||'').toLowerCase()+' ';
        var out=[];
        SHC_PROMPT_DEFS.forEach(function(def){
            var kws=String(shcCfg(def.key)||'').split(',').map(function(s){return s.trim().toLowerCase();}).filter(Boolean);
            for(var i=0;i<kws.length;i++){ if(kws[i] && t.indexOf(kws[i])>=0){ out.push(def); return; } }
        });
        return out;
    }
    function shcPromptAccept(kind){
        var def=SHC_PROMPT_DEFS.filter(function(d){return d.kind===kind;})[0]||{};
        var txt=(document.getElementById('shcLogTxt')||{}).value||'';
        shcRpc('shc_event_log',{p_session_id:shcSess().id,p_kind:'prompt_accepted',p_body:kind,p_meta:{text:txt.slice(0,300)}},function(){},function(){});
        shcQuickCreate(kind, txt.slice(0,140));
    }
    function shcPromptDismiss(kind){
        _shc.dismissed[kind]=true;
        shcRpc('shc_event_log',{p_session_id:shcSess().id,p_kind:'prompt_dismissed',p_body:kind},function(){},function(){});
        shcRunDetect();
    }
    function shcSaveLogNote(){
        var el=document.getElementById('shcLogTxt'); var secEl=document.getElementById('shcLogSec'); var msg=document.getElementById('shcLogMsg');
        var body=el?el.value.trim():''; if(!body){ if(msg) msg.textContent='Write something first.'; return; }
        var section=secEl?secEl.value:'general_notes';
        if(msg) msg.textContent='Saving…';
        shcEnsureDsr(function(dsrId){
            shcRpc('dsr_log_note_add',{p_id:dsrId,p_section:section,p_body:body},function(){
                shcRpc('shc_event_log',{p_session_id:shcSess().id,p_kind:'note',p_body:body,p_meta:{section:section}},function(){
                    try{ localStorage.removeItem(shcDraftKey()); }catch(e){}
                    if(el) el.value=''; var box=document.getElementById('shcPromptBox'); if(box) box.innerHTML='';
                    if(msg) msg.textContent='Saved to the log book ✓';
                    shcRefreshSession(function(){ var b=document.getElementById('shcSec_log'); if(b) b.innerHTML=shcLogBody(); shcPatch(); });
                },function(){ if(msg) msg.textContent='Saved to report (session event failed).'; });
            },function(err){ if(msg) msg.textContent=(err&&err.message)||'Could not save.'; });
        });
    }

    // ---- Ring-out / closeout (the existing DSR does the real work) ----
    function shcCloseoutSummary(){
        var r=_shc.data.dsrRow;
        if(r===undefined) return 'loading…';
        return r?('report: '+(r.status||'Draft')):'not started';
    }
    function shcCloseoutBody(){
        var r=_shc.data.dsrRow;
        var h='<div style="font-size:12.5px;color:#33404e;margin-bottom:8px;">The full 5:00 ring-out, night closeout, combined totals, labor worksheet and submit flow live in the Daily Store Report — all formulas are preserved there (server-computed over/short, labor %). This console links you straight in and ties the report to this shift.</div>';
        h+='<div style="margin-bottom:8px;">'+(r?('Today’s report: <b>'+escapeHtml(r.status||'Draft')+'</b>'):'Today’s report has not been started yet.')+'</div>';
        h+='<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
            shcBtn('💰 Open today’s closeout','shcJumpToDsr()','primary')+
            shcBtn('All Daily Reports','shcOpenDsrModule()','ghost')+
        '</div>';
        h+='<div style="font-size:10.5px;color:#8a91a0;margin-top:8px;">During rollout, keep running the Excel closeout side-by-side until leadership validates the app’s numbers.</div>';
        return h;
    }
    function shcEnsureDsr(cb){
        var s=shcSess();
        if(s.dsr_report_id!=null){ cb(s.dsr_report_id); return; }
        shcRpc('dsr_open',{p_location:s.location,p_business_date:(s.business_date||shcTodayIso())},function(d){
            var id=d&&(d.id!=null?d.id:(d.report&&d.report.id));
            if(id==null){ alert('Could not open today’s report.'); return; }
            shcRpc('shc_session_set',{p_session_id:s.id,p_patch:{dsr_report_id:id}},function(sd){ _shc.session=sd||_shc.session; cb(id); }, function(){ cb(id); });
        });
    }
    function shcJumpToDsr(){
        shcEnsureDsr(function(id){
            var ov=document.getElementById('shiftConsoleModal'); if(ov) ov.style.display='none';
            if(typeof dsrWorkspace==='function') dsrWorkspace(id); else { alert('Daily Report module not loaded.'); if(ov) ov.style.display='block'; return; }
            if(_shc.dsrWatch) clearInterval(_shc.dsrWatch);
            _shc.dsrWatch=setInterval(function(){
                var dm=document.getElementById('dsrModal');
                if(!dm || dm.style.display==='none'){
                    clearInterval(_shc.dsrWatch); _shc.dsrWatch=null;
                    var o=document.getElementById('shiftConsoleModal'); if(o) o.style.display='block';
                    _shc.data.dsrRow=undefined; shcLoadAll(); shcRefreshSession();
                }
            },600);
        });
    }

    // ---- Shift activity / recap-so-far ----
    function shcRecapBody(){
        var ev=shcEvents();
        if(!ev.length) return shcEmpty('Nothing logged yet this shift.');
        var icons={start:'&#9654;',note:'&#128211;',prompt_accepted:'&#128161;',prompt_dismissed:'&#128683;',quick_action:'&#10133;',temp_flag:'&#9888;',checklist:'&#129534;',end:'&#9632;',reopen:'&#8635;',link_dsr:'&#128196;'};
        return ev.slice(-25).reverse().map(function(e){
            return '<div style="display:flex;gap:8px;border-bottom:1px solid #f1f2f6;padding:6px 0;font-size:12px;color:#33404e;">'+
                '<span>'+(icons[e.kind]||'&#8226;')+'</span><span style="flex:1;">'+escapeHtml(e.body||e.kind||'')+'</span>'+
                '<span style="color:#8a91a0;white-space:nowrap;">'+escapeHtml(shcTimeFmt(e.at))+'</span></div>';
        }).join('');
    }

    // ---- Emergency resources (read-only; reuses contacts + emergency cfg) ----
    function shcEmergencyBody(){
        var h='';
        var em=[];
        try{ if(typeof cfgList==='function'){ em=cfgList('emergency')||[]; } }catch(e){}
        if(em.length){
            h+='<div style="margin-bottom:10px;">'+em.map(function(x){
                var v=String(x.value||'').trim(); if(!v) return '';
                return '<div style="display:flex;gap:8px;border-bottom:1px solid #f1f2f6;padding:6px 0;font-size:12.5px;"><span style="flex:1;color:#33404e;font-weight:600;">'+escapeHtml(x.label||x.key)+'</span><a href="tel:'+escapeHtml(v)+'" style="color:#185FA5;font-weight:700;text-decoration:none;">&#128222; '+escapeHtml(v)+'</a></div>';
            }).join('')+'</div>';
        }
        var cts=_shc.data.contacts;
        if(cts==null) h+=shcEmpty('Loading contacts…');
        else if(cts.length){
            var pr={emergency:0,preferred:1,backup:2};
            var sorted=cts.slice().sort(function(a,b){ return (pr[a.priority]!=null?pr[a.priority]:3)-(pr[b.priority]!=null?pr[b.priority]:3); }).slice(0,12);
            h+=sorted.map(function(c){
                return '<div style="display:flex;gap:8px;border-bottom:1px solid #f1f2f6;padding:6px 0;font-size:12.5px;align-items:center;">'+
                    (c.priority==='emergency'?'<span style="background:#fdeaea;color:#a01b3e;padding:1px 7px;border-radius:99px;font-size:9.5px;font-weight:800;">24/7</span>':'')+
                    '<span style="flex:1;color:#33404e;"><b>'+escapeHtml(c.name||'')+'</b>'+(c.category?(' <span style="color:#8a91a0;font-size:10.5px;">'+escapeHtml(c.category)+'</span>'):'')+'</span>'+
                    (c.phone?('<a href="tel:'+escapeHtml(c.phone)+'" style="color:#185FA5;font-weight:700;text-decoration:none;">&#128222;</a>'):'')+'</div>';
            }).join('');
        } else h+=shcEmpty('No contacts configured for this store.');
        h+='<div style="margin-top:8px;">'+shcBtn('Full emergency procedures','shcOpenEmergency()','ghost')+'</div>';
        h+='<div style="font-size:10.5px;color:#8a91a0;margin-top:6px;">Read-only here — managers edit contacts in the Admin Console.</div>';
        return h;
    }
    function shcOpenEmergency(){ shcClose(); if(typeof openEmergency==='function') openEmergency(); else alert('Emergency screen not available.'); }

    // ============================================================
    // QUICK ACTIONS (+ Add Follow-Up) — doorway into existing modules
    // ============================================================
    function shcQuickSheet(){
        var box=document.getElementById('shcSheet'); if(!box) return;
        var opts=[
            ['maintenance','🔧 Maintenance ticket'],
            ['supply','📦 Supply request'],
            ['task','📋 Task for the team'],
            ['shoutout','🎉 Shoutout / recognition'],
            ['task_attendance','🕒 Attendance follow-up'],
            ['task_employee','📝 Employee-note follow-up'],
            ['task_customer','💬 Customer issue'],
            ['task_delivery','🚚 Delivery issue'],
            ['task_safety','⚠️ Safety issue'],
            ['task_cash','💵 Cash / count-out review']
        ];
        box.innerHTML='<div onclick="shcSheetClose(event)" id="shcSheetBg" style="position:fixed;inset:0;background:rgba(20,25,35,.45);z-index:100003;display:flex;align-items:flex-end;justify-content:center;">'+
            '<div onclick="event.stopPropagation()" style="background:#fff;border-radius:16px 16px 0 0;max-width:520px;width:100%;padding:16px 16px 24px;max-height:70vh;overflow:auto;">'+
            '<div style="display:flex;align-items:center;margin-bottom:10px;"><b style="flex:1;font-size:14px;color:#1f2a44;">Add a follow-up</b><button onclick="shcSheetClose()" style="background:#eef0f3;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">&times;</button></div>'+
            '<div style="font-size:11.5px;color:#6b7686;margin-bottom:10px;">These create the real record in the right Hub module (tasks, maintenance, supply, recognition) and link it to this shift.</div>'+
            opts.map(function(o){ return '<button onclick="shcSheetClose(); shcQuickCreate(&quot;'+o[0]+'&quot;)" style="display:block;width:100%;text-align:left;background:#fafbfd;border:1px solid #eef0f5;border-radius:10px;padding:11px 13px;margin-bottom:7px;font-size:13px;font-weight:600;color:#33404e;cursor:pointer;">'+o[1]+'</button>'; }).join('')+
            '</div></div>';
    }
    function shcSheetClose(ev){ if(ev && ev.target && ev.target.id!=='shcSheetBg') return; var box=document.getElementById('shcSheet'); if(box) box.innerHTML=''; }

    function shcQuickCreate(kind, prefill){
        if(kind==='shoutout'){
            var about=prompt('Who / what team is the shoutout about?',''); if(about===null) return;
            var msg=prompt('Shoutout message:', prefill||''); if(msg===null||!msg.trim()) return;
            shcRpc('app_recognition_post',{p_type:'shoutout',p_about_emp:null,p_about_text:(about.trim()||null),p_message:msg.trim(),p_location:(shcSess().location||null)},function(){
                shcLogQuickAction('shoutout', msg.trim());
                alert('Shoutout posted 🎉');
            });
            return;
        }
        var dsrKind = (kind==='maintenance'||kind==='supply') ? kind : 'task';
        var prefix = SHC_TASK_PREFIX[kind]||'';
        var labels = { maintenance:'maintenance ticket', supply:'supply request', task:'task' };
        var title=prompt('Title for the '+(labels[dsrKind]||'follow-up')+':', prefix+(prefill||'')); if(title===null||!title.trim()) return;
        var notes=prompt('Details / notes (optional):','')||'';
        var payload={ title:title.trim(), notes:notes };
        if(dsrKind==='maintenance'){ payload.priority='Normal'; payload.category='General'; }
        if(dsrKind==='supply'){ payload.urgency='Normal'; }
        shcEnsureDsr(function(dsrId){
            shcRpc('dsr_action_create',{p_id:dsrId,p_kind:dsrKind,p_payload:payload},function(){
                shcLogQuickAction(kind, title.trim());
                alert('Follow-up created and routed — it’s in the manager pipeline now.');
            },function(err){ alert((err&&err.message)||'Could not create.'); });
        });
    }
    function shcLogQuickAction(kind,title){
        shcRpc('shc_event_log',{p_session_id:shcSess().id,p_kind:'quick_action',p_body:'['+kind+'] '+title,p_meta:{kind:kind}},function(){ shcRefreshSession(); },function(){});
    }

    // ============================================================
    // END SHIFT — summary before final confirmation
    // ============================================================
    function shcEndShift(){ _shc.view='end'; shcRenderEnd(); }
    function shcRenderEnd(){
        var ov=shcOverlay(); var s=shcSess();
        var h=shcHeader('End Shift Summary — '+(s.location||''),'shcBackToConsole()');
        h+='<div style="max-width:760px;margin:0 auto;padding:16px 16px 60px;">';

        var unresolved=[];
        // checklist status
        var names={open:'Opening',close:'Closing',clean:'Cleaning'};
        var ckHtml=''; var ckRec={};
        ['open','close','clean'].forEach(function(sh){
            var l=_shc.data.checks[sh]; if(!l||!l.length) return;
            var d=l.filter(function(i){return i.done;}).length;
            ckRec[sh]={done:d,total:l.length};
            var ok=d>=l.length;
            if(!ok) unresolved.push(names[sh]+' checklist incomplete ('+d+'/'+l.length+')');
            ckHtml+=shcChip(names[sh]+' '+d+'/'+l.length, ok?'#1f7a3d':'#9a5b00', ok?'#e8f5ec':'#fff4e0');
        });
        h+=shcCard(ckHtml||shcEmpty('No checklists configured.'),'&#129534; Checklists');

        // temps status
        var temps=_shc.data.temps||[];
        var tLog=temps.filter(function(p){return p.last;}).length;
        var tBad=temps.filter(function(p){return p.last&&p.last.status!=='pass';}).length;
        var tMiss=temps.length-tLog;
        if(tMiss>0) unresolved.push(tMiss+' temp point(s) never logged today');
        if(tBad>0) unresolved.push(tBad+' out-of-range temp(s) — make sure corrective action is noted');
        var tHtml=temps.length?(shcChip(tLog+'/'+temps.length+' logged',tMiss?'#9a5b00':'#1f7a3d',tMiss?'#fff4e0':'#e8f5ec')+(tBad?shcChip(tBad+' out of range','#a01b3e','#fdeaea'):'')):shcEmpty('No temp equipment configured.');
        h+=shcCard(tHtml,'🌡️ Temperature log');

        // closeout / report status
        var r=_shc.data.dsrRow; var st=r?(r.status||'Draft'):'not started';
        var dsrOk=(st==='Submitted'||st==='Reviewed'||st==='Locked'||st==='Under Review');
        if(!dsrOk) unresolved.push('Daily Store Report is '+st+' — finish the closeout and submit it');
        h+=shcCard(shcChip('Report: '+st, dsrOk?'#1f7a3d':'#9a5b00', dsrOk?'#e8f5ec':'#fff4e0')+'<div style="margin-top:6px;">'+shcBtn('Open closeout','shcJumpToDsr()','ghost')+'</div>','💰 Ring-out / closeout');

        // notes, prompts, follow-ups
        var notes=shcEvents('note'); var qa=shcEvents('quick_action');
        var pa=shcEvents('prompt_accepted').length, pd=shcEvents('prompt_dismissed').length;
        var actHtml='<div style="font-size:12.5px;color:#33404e;">'+notes.length+' log-book note(s) · '+qa.length+' follow-up(s) created · prompts: '+pa+' accepted / '+pd+' dismissed</div>';
        if(qa.length){ actHtml+='<div style="margin-top:6px;">'+qa.map(function(e){ return '<div style="font-size:12px;color:#5b6675;padding:3px 0;">&#10133; '+escapeHtml(e.body||'')+'</div>'; }).join('')+'</div>'; }
        h+=shcCard(actHtml,'📓 Shift activity');

        // unresolved
        if(unresolved.length){
            h+=shcCard('<ul style="margin:0;padding-left:18px;">'+unresolved.map(function(u){ return '<li style="font-size:12.5px;color:#a01b3e;margin-bottom:4px;">'+escapeHtml(u)+'</li>'; }).join('')+'</ul><div style="font-size:11px;color:#8a91a0;margin-top:6px;">You can still end the shift — unresolved items are recorded in the recap for the manager.</div>','&#9888; Unresolved items','#f3ccd4');
        }

        // priority note (optional, configurable)
        var askPr=(String(shcCfg('shc_recap_ask_priority'))==='1') && (_shc.data.priorities||[]).length>0;
        if(askPr){
            h+=shcCard('<div style="font-size:12px;color:#5b6675;margin-bottom:6px;">Anything to report on the active store priorities? (optional)</div><textarea id="shcPrNote" rows="2" style="width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;font-family:inherit;"></textarea>','&#11088; Priority notes');
        }

        h+=shcCard('<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#33404e;margin-bottom:10px;"><input type="checkbox" id="shcEndConfirm"> I confirm this End Shift Summary is accurate.</label>'+
            shcBtn('&#9632; End shift &amp; send recap','shcSubmitEnd()','danger')+
            '<div style="font-size:11px;color:#8a91a0;margin-top:6px;">Managers get a recap notification. Reopening an ended shift requires a manager and a reason (audited).</div>','Confirm');
        h+='</div>';
        ov.innerHTML=h;
    }
    function shcBackToConsole(){ _shc.view='console'; shcRenderConsole(); shcLoadAll(); }
    function shcSubmitEnd(){
        var cf=document.getElementById('shcEndConfirm');
        if(!cf||!cf.checked){ alert('Please confirm the summary first.'); return; }
        var temps=_shc.data.temps||[];
        var recap={
            checklist:{}, temps:{ total:temps.length, logged:temps.filter(function(p){return p.last;}).length, out_of_range:temps.filter(function(p){return p.last&&p.last.status!=='pass';}).length },
            notes:shcEvents('note').length,
            followups:shcEvents('quick_action').map(function(e){return e.body;}),
            prompts:{ accepted:shcEvents('prompt_accepted').length, dismissed:shcEvents('prompt_dismissed').length },
            dsr_status:(_shc.data.dsrRow?(_shc.data.dsrRow.status||'Draft'):'not started'),
            priority_note:((document.getElementById('shcPrNote')||{}).value||'').trim()||null
        };
        ['open','close','clean'].forEach(function(sh){ var l=_shc.data.checks[sh]; if(l&&l.length) recap.checklist[sh]={done:l.filter(function(i){return i.done;}).length,total:l.length}; });
        shcRpc('shc_session_end',{p_session_id:shcSess().id,p_recap:recap},function(d){
            _shc.session=d||_shc.session; _shc.view='done'; shcRenderDone();
        });
    }
    function shcRenderDone(){
        var ov=shcOverlay(); var s=shcSess();
        var dsrOk=(_shc.data.dsrRow && ['Submitted','Reviewed','Locked','Under Review'].indexOf(_shc.data.dsrRow.status)>=0);
        var h=shcHeader('Shift ended','');
        h+='<div style="max-width:640px;margin:0 auto;padding:30px 16px 60px;text-align:center;">';
        h+='<div style="font-size:44px;">&#127881;</div>';
        h+='<h3 style="color:#1f2a44;margin:8px 0 4px;">Shift recap sent</h3>';
        h+='<p style="font-size:13px;color:#6b7686;">'+escapeHtml(s.location||'')+' · '+escapeHtml(String(s.business_date||'').slice(0,10))+' · '+escapeHtml(s.shift_type||'')+' — managers can review it in Past shift recaps.</p>';
        if(!dsrOk){ h+='<p style="font-size:12.5px;color:#9a5b00;font-weight:700;">&#9888; Don’t forget: the Daily Store Report still needs to be finished/submitted.</p><div>'+shcBtn('Open the report','shcJumpToDsr()','primary')+'</div>'; }
        h+='<div style="margin-top:14px;">'+shcBtn('Close','shcClose()','ghost')+'</div>';
        h+='</div>';
        ov.innerHTML=h;
    }

    // ============================================================
    // MANAGER REVIEW — past shift recaps
    // ============================================================
    function shcHistory(){
        if(!shcIsMgr()){ alert('Managers only.'); return; }
        _shc.view='history';
        var ov=shcOverlay();
        ov.innerHTML=shcHeader('Shift recaps','openShiftConsole()')+'<div style="max-width:860px;margin:0 auto;padding:30px 16px;text-align:center;color:#6b7686;">Loading&hellip;</div>';
        var f=_shc.histFilters;
        shcRpc('shc_sessions_list',{p_filters:{location:f.location||'',status:f.status||''}},function(rows){ shcRenderHistory(rows||[]); });
    }
    function shcRenderHistory(rows){
        var ov=shcOverlay();
        var stores=(typeof HUB_STORES!=='undefined'?HUB_STORES:[]);
        var f=_shc.histFilters;
        var h=shcHeader('Shift recaps (last 14 days)','openShiftConsole()');
        h+='<div style="max-width:860px;margin:0 auto;padding:14px 16px 60px;">';
        h+='<div style="background:#fff;border:1px solid #e6ebf2;border-radius:12px;padding:10px 12px;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;">'+
            '<select onchange="_shc.histFilters.location=this.value; shcHistory();" style="padding:7px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;"><option value="">All stores</option>'+stores.map(function(s){return '<option value="'+escapeHtml(s)+'"'+(f.location===s?' selected':'')+'>'+escapeHtml(s)+'</option>';}).join('')+'</select>'+
            '<select onchange="_shc.histFilters.status=this.value; shcHistory();" style="padding:7px 9px;border:1px solid #cdd5e0;border-radius:8px;font-size:12.5px;"><option value="">Any status</option><option'+(f.status==='Active'?' selected':'')+'>Active</option><option'+(f.status==='Ended'?' selected':'')+'>Ended</option></select></div>';
        if(!rows.length) h+=shcEmpty('No shift sessions in this range.');
        else{
            h+='<table style="width:100%;border-collapse:collapse;font-size:12.5px;background:#fff;border-radius:12px;overflow:hidden;"><thead><tr>'+['Date','Store','Shift','Leader','Status','Follow-ups','Flags'].map(function(x){return '<th style="text-align:left;padding:8px;color:#8a91a0;font-size:11px;">'+x+'</th>';}).join('')+'</tr></thead><tbody>';
            rows.forEach(function(r){
                h+='<tr style="border-top:1px solid #f1f2f6;cursor:pointer;" onclick="shcViewSession('+r.id+')">'+
                    '<td style="padding:8px;">'+escapeHtml(String(r.business_date||'').slice(0,10))+'</td>'+
                    '<td style="padding:8px;">'+escapeHtml(r.location||'')+'</td>'+
                    '<td style="padding:8px;">'+escapeHtml(r.shift_type||'')+'</td>'+
                    '<td style="padding:8px;">'+escapeHtml(r.leader_name||'')+'</td>'+
                    '<td style="padding:8px;"><span style="background:'+(r.status==='Active'?'#1f7a3d':'#5b6472')+';color:#fff;padding:2px 9px;border-radius:99px;font-size:10.5px;font-weight:800;">'+escapeHtml(r.status||'')+'</span></td>'+
                    '<td style="padding:8px;">'+(r.followups||0)+'</td>'+
                    '<td style="padding:8px;color:'+((r.temp_flags||0)>0?'#c0264b':'#5b6675')+';">'+(r.temp_flags||0)+' temp'+((r.prompts_dismissed||0)>0?(' · '+r.prompts_dismissed+' dismissed'):'')+'</td></tr>';
            });
            h+='</tbody></table>';
        }
        h+='</div>';
        ov.innerHTML=h;
    }
    function shcViewSession(id){
        shcRpc('shc_session_get',{p_session_id:id},function(d){
            var ov=shcOverlay(); var s=d||{};
            var h=shcHeader('Shift — '+(s.location||'')+' · '+String(s.business_date||'').slice(0,10),'shcHistory()');
            h+='<div style="max-width:760px;margin:0 auto;padding:16px 16px 60px;">';
            h+=shcCard('<div style="font-size:13px;color:#33404e;"><b>'+escapeHtml(s.shift_type||'')+'</b> shift · leader '+escapeHtml(s.leader_name||'')+(s.support_names?(' (with '+escapeHtml(s.support_names)+')'):'')+'<br>'+escapeHtml(shcTimeFmt(s.started_at))+' → '+(s.ended_at?escapeHtml(shcTimeFmt(s.ended_at)):'—')+' · status <b>'+escapeHtml(s.status||'')+'</b>'+(s.dsr_report_id?('<br>Daily Report #'+s.dsr_report_id+' <a onclick="shcClose(); if(typeof dsrWorkspace===\'function\') dsrWorkspace('+s.dsr_report_id+');" style="color:#185FA5;font-weight:700;cursor:pointer;">open</a>'):'')+'</div>','Session');
            if(s.recap){
                var rc=s.recap; var bits=[];
                if(rc.checklist){ Object.keys(rc.checklist).forEach(function(k){ var c=rc.checklist[k]; bits.push(shcChip(k+' '+c.done+'/'+c.total, c.done>=c.total?'#1f7a3d':'#9a5b00', c.done>=c.total?'#e8f5ec':'#fff4e0')); }); }
                if(rc.temps) bits.push(shcChip('temps '+rc.temps.logged+'/'+rc.temps.total+(rc.temps.out_of_range?(' · '+rc.temps.out_of_range+' out'):''), rc.temps.out_of_range?'#a01b3e':'#1f7a3d', rc.temps.out_of_range?'#fdeaea':'#e8f5ec'));
                if(rc.dsr_status) bits.push(shcChip('report: '+rc.dsr_status,'#185FA5','#f2f7ff'));
                var body=bits.join('')+'<div style="font-size:12.5px;color:#33404e;margin-top:6px;">'+(rc.notes||0)+' note(s) · '+((rc.followups||[]).length)+' follow-up(s) · prompts '+((rc.prompts&&rc.prompts.accepted)||0)+' accepted / '+((rc.prompts&&rc.prompts.dismissed)||0)+' dismissed</div>';
                if((rc.followups||[]).length) body+='<div style="margin-top:6px;">'+rc.followups.map(function(x){ return '<div style="font-size:12px;color:#5b6675;padding:2px 0;">&#10133; '+escapeHtml(String(x))+'</div>'; }).join('')+'</div>';
                if(rc.priority_note) body+='<div style="margin-top:8px;font-size:12.5px;color:#33404e;"><b>Priority note:</b> '+escapeHtml(rc.priority_note)+'</div>';
                h+=shcCard(body,'Recap');
            }
            var ev=(s.events||[]);
            h+=shcCard(ev.length?ev.slice().reverse().map(function(e){ return '<div style="display:flex;gap:8px;border-bottom:1px solid #f1f2f6;padding:6px 0;font-size:12px;color:#33404e;"><span style="color:#8a91a0;white-space:nowrap;">'+escapeHtml(shcTimeFmt(e.at))+'</span><b style="white-space:nowrap;">'+escapeHtml(e.kind||'')+'</b><span style="flex:1;">'+escapeHtml(e.body||'')+'</span><span style="color:#8a91a0;">'+escapeHtml(e.by||'')+'</span></div>'; }).join(''):shcEmpty('No events.'),'Full audit trail');
            if(s.status==='Ended' && shcIsMgr()) h+=shcCard(shcBtn('Reopen this shift','shcReopenSession('+s.id+')','danger')+'<div style="font-size:11px;color:#8a91a0;margin-top:6px;">Requires a reason; the reopen is audited and edits resume.</div>','Corrections');
            h+='</div>';
            ov.innerHTML=h;
        });
    }
    function shcReopenSession(id){
        var reason=prompt('Reason for reopening this shift (required, audited):');
        if(reason===null) return;
        if(!reason.trim()){ alert('A reason is required.'); return; }
        shcRpc('shc_session_reopen',{p_session_id:id,p_reason:reason.trim()},function(){ alert('Shift reopened.'); shcViewSession(id); });
    }
