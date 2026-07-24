    // ============================================================
    // ADMIN CONFIG  (js/14) — the cfg foundation + App Settings editor
    // Implements specs/CONFIG_CONTRACT.md. Classic script: the functions
    // below are top-level → global (same style as js/13_marketing.js).
    // Reads/writes app_settings via the existing app_settings_get / _set RPCs.
    // NO new SQL. Keep hardcoded values as fallbacks so nothing breaks pre-config.
    // ============================================================

    // ---- in-memory config cache: { group: { key: {label,value,sort} } } ----
    var HUB_CFG = {};
    var CFG_GROUPS = ['targets','policies','emergency','training_cats','admin_task_cats','attendance_reasons','leadership_names','mkt_campaign_types','mkt_channels','mkt_budget_cats','mkt_asset_cats','disc_reasons_verbal','disc_reasons_written','dsr_registers','dsr_checklist','dsr_config','tg_config','cc_config','shc_config','insp_config','opm_config','trh_config','mkt_approval_rules','mkt2_config'];

    // Preload every contract group with the caller's creds. Tolerant of errors
    // (a missing/empty group just becomes {}). cb() fires once all groups settle.
    function cfgLoadAll(cb){
      var done = function(){ if(typeof cb==='function') cb(); };
      var user, pin;
      try{ user = (typeof currentUser!=='undefined') ? currentUser : null; }catch(e){ user=null; }
      try{ pin  = (typeof sessionPin!=='undefined')  ? sessionPin  : null; }catch(e){ pin=null; }
      if(!user || !user.username || !pin || typeof supabaseClient==='undefined'){ done(); return; }
      var remaining = CFG_GROUPS.length;
      var tick = function(){ remaining--; if(remaining<=0) done(); };
      CFG_GROUPS.forEach(function(g){
        try{
          supabaseClient.rpc('app_settings_get',{p_username:user.username,p_password:pin,p_group:g}).then(function(r){
            if(!r.error && r.data){
              var map={};
              (r.data||[]).forEach(function(row){ map[row.key]={label:row.label,value:row.value,sort:row.sort||0}; });
              HUB_CFG[g]=map;
            } else if(!HUB_CFG[g]){ HUB_CFG[g]={}; }
            tick();
          }).catch(function(){ if(!HUB_CFG[g]) HUB_CFG[g]={}; tick(); });
        }catch(e){ if(!HUB_CFG[g]) HUB_CFG[g]={}; tick(); }
      });
    }

    // ---- synchronous readers (contract interface) ----
    function cfg(group,key,fb){ try{ var g=HUB_CFG[group]; if(g&&g[key]&&g[key].value!=null&&g[key].value!=='') return g[key].value; }catch(e){} return fb; }
    function cfgNum(group,key,fb){ var v=cfg(group,key,null); var n=parseFloat(v); return isNaN(n)?fb:n; }
    function cfgList(group){ try{ var g=HUB_CFG[group]||{}; return Object.keys(g).map(function(k){return {key:k,label:g[k].label,value:g[k].value,sort:g[k].sort||0};}).sort(function(a,b){return a.sort-b.sort;}); }catch(e){ return []; } }

    // ---- writer: withPin -> app_settings_set -> update cache -> cb(errOrNull) ----
    function cfgSet(group,key,label,value,sort,cb){
      var val = (value==null?'':String(value));
      withPin(function(pin){
        supabaseClient.rpc('app_settings_set',{p_username:currentUser.username,p_password:pin,p_key:key,p_group:group,p_label:label,p_value:val,p_sort:sort||0}).then(function(r){
          if(r.error){ alert(r.error.message||'Could not save. Managers only.'); if(cb) cb(r.error); return; }
          if(!HUB_CFG[group]) HUB_CFG[group]={};
          HUB_CFG[group][key]={label:label,value:val,sort:sort||0};
          if(cb) cb(null);
        }).catch(function(){ alert('Connection error while saving.'); if(cb) cb({message:'Connection error'}); });
      });
    }

    // Save a batch of {group,key,label,value,sort} sequentially, then done().
    function acBatchSet(items, done){
      var i=0, hadErr=false;
      (function next(){
        if(i>=items.length){ if(done) done(hadErr); return; }
        var it=items[i++];
        cfgSet(it.group,it.key,it.label,it.value,it.sort,function(err){ if(err) hadErr=true; next(); });
      })();
    }

    // =====================================================================
    //  App Settings admin editor  (#appSettingsModal full-screen overlay)
    // =====================================================================
    var _ac = { tab:'targets' };

    // Contract group `targets` — key, label, default (kept as fallback/seed).
    var AC_TARGETS = [
      {k:'labor_pct',      l:'Labor % target (scheduling)',    d:25},
      {k:'ot_threshold_hrs',l:'Overtime after (hrs/week)',     d:40},
      {k:'ot_multiplier',  l:'Overtime pay multiplier',        d:1.5},
      {k:'ot_near_hrs',    l:'Near-OT warning (hrs)',          d:36},
      {k:'food_pct_lo',    l:'Food cost target — low %',       d:30},
      {k:'food_pct_hi',    l:'Food cost target — high %',      d:33},
      {k:'labor_pct_lo',   l:'Labor cost target — low %',      d:18},
      {k:'labor_pct_hi',   l:'Labor cost target — high %',     d:23},
      {k:'prime_pct_lo',   l:'Prime cost target — low %',      d:48},
      {k:'prime_pct_hi',   l:'Prime cost target — high %',     d:56},
      {k:'prime_tax_pct',  l:'Prime-cost gross-receipt tax %', d:8.31},
      {k:'lms_pass_pct',   l:'Quiz/SCORM pass score %',        d:80}
    ];

    // Contract group `emergency` — the [____] slots in the Emergency screens.
    var AC_EMERG = [
      {k:'manager_on_call', l:'Manager on call'},
      {k:'utility',         l:'Electric / gas utility'},
      {k:'internet',        l:'Internet / phone provider'},
      {k:'machine_vendor',  l:'Machine / equipment vendor'},
      {k:'water_utility',   l:'Water utility'},
      {k:'police',          l:'Police (non-emergency)'}
    ];

    var AC_POLICY_DEFAULT = 'A 50% deposit is due to reserve your event date; the remaining balance is due on or before the event. Cancellations made within 7 days of the event may forfeit the deposit. (Paste your full Booking & Payment Policy here.)';

    var SCOOPY_TONE_DEFAULT = 'Greet them by their first name, keep things warm and personable, and respond with genuine empathy and emotion when the situation calls for it';
    var AC_POLICIES = [
      {key:'booking', label:'Booking & Payment Policy', head:'Booking &amp; Payment Policy', sub:'Shown on catering quotes / PDFs and the public quote form. Paste your current policy here.', def:AC_POLICY_DEFAULT, rows:12},
      {key:'scoopy_tone', label:'Mr. Scoopy \u2014 Assistant Tone', head:'Mr. Scoopy &mdash; Assistant Tone', sub:'How Mr. Scoopy talks to the team in the AI chat \u2014 describe the personality and tone (warm, upbeat, concise, etc.).', def:SCOOPY_TONE_DEFAULT, rows:4}
    ];

    function acEsc(s){ try{ return (typeof escapeHtml==='function') ? escapeHtml(String(s==null?'':s)) : String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }catch(e){ return ''; } }

    function acOverlay(){ var o=document.getElementById('appSettingsModal'); if(!o){ o=document.createElement('div'); o.id='appSettingsModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100000;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function appSettingsClose(){ var o=document.getElementById('appSettingsModal'); if(o) o.style.display='none'; }
    function acHeader(){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:5;"><b style="flex:1;font-size:16px;">&#9881;&#65039; App Settings &mdash; Admin</b><button onclick="appSettingsClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">&times;</button></div>'; }
    function acTabs(){ var t=_ac.tab; function b(id,label){ var on=t===id; return '<button onclick="acTab(\''+id+'\')" style="background:'+(on?'#185FA5':'#eef0f3')+';color:'+(on?'#fff':'#26242b')+';border:none;border-radius:8px;padding:8px 13px;font-weight:700;font-size:12.5px;cursor:pointer;">'+label+'</button>'; } return '<div style="display:flex;gap:8px;flex-wrap:wrap;max-width:760px;margin:12px auto 0;padding:0 16px;">'+b('targets','Business Numbers')+b('policies','Policy Text')+b('emergency','Emergency Numbers')+(typeof acRenderChoiceLists==='function'?b('lists','Lists'):'')+b('dsr','Daily Report')+b('tg','Team Growth')+'</div>'; }
    function acShell(body){ acOverlay().innerHTML=acHeader()+acTabs()+'<div style="max-width:760px;margin:0 auto;padding:16px;">'+body+'</div>'; }
    function acCard(head,sub,inner){ return '<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:4px;">'+head+'</div>'+(sub?'<div style="font-size:12px;color:#6b7686;margin-bottom:8px;">'+sub+'</div>':'')+inner+'</div>'; }
    function acSaveBtn(fn,label){ return '<div style="margin-top:16px;"><button onclick="'+fn+'" style="background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:11px 18px;font-weight:800;cursor:pointer;">'+label+'</button></div>'; }

    function acTab(t){ _ac.tab=t; acRender(); }
    function acRender(){ if(_ac.tab==='policies') acRenderPolicy(); else if(_ac.tab==='emergency') acRenderEmergency(); else if(_ac.tab==='lists' && typeof acRenderChoiceLists==='function') acRenderChoiceLists(); else if(_ac.tab==='dsr') acRenderDsr(); else if(_ac.tab==='tg') acRenderTg(); else acRenderTargets(); }

    function acRenderTargets(){
      var rows=AC_TARGETS.map(function(f){
        var v=cfg('targets',f.k,f.d);
        return '<label style="display:block;font-size:12px;color:#6b7686;margin:10px 0 3px;">'+acEsc(f.l)+'</label><input id="ac_t_'+f.k+'" type="number" step="any" value="'+acEsc(String(v))+'" style="width:100%;max-width:260px;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">';
      }).join('');
      acShell(acCard('Business Numbers','These targets drive scheduling, prime-cost, overtime warnings, and quiz/SCORM pass scores across the Hub.',rows+acSaveBtn('acSaveTargets()','Save business numbers')));
    }
    function acSaveTargets(){
      var items=AC_TARGETS.map(function(f,i){ var el=document.getElementById('ac_t_'+f.k); var val=el?String(el.value).trim():''; return {group:'targets',key:f.k,label:f.l,value:val,sort:i}; });
      acBatchSet(items,function(err){ if(!err) alert('Business numbers saved.'); });
    }

    var AC_DSR = [
      {k:'dsr_drawer_base', l:'Register drawer base ($)', d:120},
      {k:'dsr_overshort_threshold', l:'Over/short alert threshold ($)', d:5},
      {k:'dsr_rating_comment_max', l:'Ratings: comment required at/below', d:8},
      {k:'dsr_labor_target_low', l:'Labor target \u2014 low (%)', d:22},
      {k:'dsr_labor_target_high', l:'Labor target \u2014 high (%)', d:26},
      {k:'dsr_change_target', l:'Change reconciliation target ($)', d:200}
    ];
    function acRenderDsr(){
      var rows=AC_DSR.map(function(f){ var v=cfg('dsr_config',f.k,f.d); return '<label style="display:block;font-size:12px;color:#6b7686;margin:10px 0 3px;">'+acEsc(f.l)+'</label><input id="ac_dsr_'+f.k+'" type="number" step="any" value="'+acEsc(String(v))+'" style="width:100%;max-width:260px;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'; }).join('');
      var mode=cfg('dsr_config','dsr_sales_source_mode','off');
      function opt(val,lbl){ return '<option value="'+val+'"'+(mode===val?' selected':'')+'>'+lbl+'</option>'; }
      var modeSel='<label style="display:block;font-size:12px;color:#6b7686;margin:14px 0 3px;">When a Daily Report is submitted, how should it feed store sales?</label>'+'<select id="ac_dsr_mode" style="width:100%;max-width:340px;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+opt('off','Off \u2014 don\u2019t touch store sales (default)')+opt('dsr_writes','Daily Report writes the day\u2019s sales into Scorecards')+opt('reconcile','Keep separate \u2014 reconcile later')+'</select>'+'<div style="font-size:11px;color:#8a91a0;margin-top:4px;">\u201CWrites\u201D pushes the closeout\u2019s day sales (and labor %) into store metrics so Scorecards light up. Leave Off until you\u2019re ready.</div>';
      acShell(acCard('Daily Store Report','Drawer base, thresholds, labor target and the sales-source behavior \u2014 all used live by the closeout math and submit.',rows+modeSel+acSaveBtn('acSaveDsr()','Save Daily Report settings')));
    }
    function acSaveDsr(){
      var items=AC_DSR.map(function(f,i){ var el=document.getElementById('ac_dsr_'+f.k); var val=el?String(el.value).trim():''; return {group:'dsr_config',key:f.k,label:f.l,value:val,sort:i}; });
      var ms=document.getElementById('ac_dsr_mode'); items.push({group:'dsr_config',key:'dsr_sales_source_mode',label:'Sales source mode',value:ms?ms.value:'off',sort:99});
      acBatchSet(items,function(err){ if(!err) alert('Daily Report settings saved.'); });
    }

    function acTgRpc(name,args,cb){ withPin(function(pin){ supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){ if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Admins only.':r.error.message); return;} cb(r.data);}).catch(function(){ alert('Connection error.'); }); }); }
    function acRenderTg(){
      var nr=cfg('tg_config','tg_normal_raise_pct',8);
      var c1=acCard('Team Growth','Pay-proposal guardrails and review cadences \u2014 read live by the evaluations engine.','<label style="display:block;font-size:12px;color:#6b7686;margin:6px 0 3px;">\u201CNormal\u201D raise % threshold (proposals above this get flagged)</label><input id="ac_tg_nr" type="number" step="any" value="'+acEsc(String(nr))+'" style="width:100%;max-width:220px;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+acSaveBtn('acSaveTgCfg()','Save threshold'));
      var c2=acCard('Review cadences','How often each role / lifecycle event triggers a review (days). Corporate-editable.','<div id="ac_tg_sched"><div style="color:#6b7686;font-size:12px;padding:10px;">Loading\u2026</div></div>');
      acShell(c1+c2); acTgSchedLoad();
    }
    function acSaveTgCfg(){ var el=document.getElementById('ac_tg_nr'); var v=el?String(el.value).trim():''; cfgSet('tg_config','tg_normal_raise_pct','Team Growth: normal raise %',v,0,function(err){ if(!err) alert('Saved.'); }); }
    function acTgSchedLoad(){
      acTgRpc('app_tg_review_schedule_list',{},function(rows){ rows=rows||[];
        var h=rows.map(function(r){ var pre='ac_sc_'+r.id+'_'; return '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid #f0f0f4;">'+'<input id="'+pre+'role" value="'+acEsc(r.role_name||'')+'" placeholder="Role (blank=all)" style="width:120px;padding:6px;border:1px solid #ddd;border-radius:6px;">'+'<input id="'+pre+'event" value="'+acEsc(r.lifecycle_event||'')+'" style="width:150px;padding:6px;border:1px solid #ddd;border-radius:6px;">'+'<input id="'+pre+'days" type="number" value="'+acEsc(String(r.cadence_days))+'" style="width:70px;padding:6px;border:1px solid #ddd;border-radius:6px;"><span style="font-size:11px;color:#8a91a0;">days</span>'+'<label style="font-size:12px;color:#5b6675;display:flex;align-items:center;gap:4px;"><input type="checkbox" id="'+pre+'active"'+(r.active?' checked':'')+'>active</label>'+'<button onclick="acTgSchedSave('+r.id+')" style="background:#eef0f3;color:#185FA5;border:none;border-radius:7px;padding:5px 9px;font-weight:700;font-size:11.5px;cursor:pointer;">Save</button>'+'</div>'; }).join('');
        h+='<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:12px;">'+'<input id="ac_sc_new_role" placeholder="Role (blank=all)" style="width:120px;padding:6px;border:1px solid #ddd;border-radius:6px;">'+'<input id="ac_sc_new_event" placeholder="lifecycle_event" style="width:150px;padding:6px;border:1px solid #ddd;border-radius:6px;">'+'<input id="ac_sc_new_days" type="number" placeholder="days" style="width:70px;padding:6px;border:1px solid #ddd;border-radius:6px;">'+'<button onclick="acTgSchedAdd()" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-weight:800;cursor:pointer;">Add cadence</button></div>';
        var el=document.getElementById('ac_tg_sched'); if(el) el.innerHTML=h||'<div style="color:#6b7686;font-size:12px;">No cadences yet.</div>';
      });
    }
    function acTgSchedSave(id){ var pre='ac_sc_'+id+'_'; var g=function(s){var e=document.getElementById(pre+s);return e?e.value:'';}; var ac=document.getElementById(pre+'active'); acTgRpc('app_tg_review_schedule_save',{p_payload:{id:id,role_name:g('role'),lifecycle_event:g('event'),cadence_days:g('days'),active:!!(ac&&ac.checked)}},function(){ acTgSchedLoad(); }); }
    function acTgSchedAdd(){ var g=function(s){var e=document.getElementById('ac_sc_new_'+s);return e?e.value:'';}; if(!g('event')){ alert('lifecycle_event required'); return; } acTgRpc('app_tg_review_schedule_save',{p_payload:{role_name:g('role'),lifecycle_event:g('event'),cadence_days:g('days')||30,active:true}},function(){ acTgSchedLoad(); }); }

    function acRenderPolicy(){
      var cards=AC_POLICIES.map(function(p){
        var v=cfg('policies',p.key,p.def);
        var inner='<textarea id="ac_policy_'+p.key+'" rows="'+(p.rows||8)+'" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;font-family:inherit;">'+acEsc(String(v))+'</textarea>'+acSaveBtn("acSavePolicyKey('"+p.key+"')",'Save');
        return acCard(p.head||p.label,p.sub||'',inner);
      }).join('<div style="height:14px;"></div>');
      acShell(cards);
    }
    function acSavePolicyKey(key){
      var p=AC_POLICIES.filter(function(x){return x.key===key;})[0]; if(!p) return;
      var el=document.getElementById('ac_policy_'+key); var v=el?el.value:'';
      cfgSet('policies',key,p.label,v,0,function(err){ if(!err) alert(p.label+' saved.'); });
    }

    function acRenderEmergency(){
      var rows=AC_EMERG.map(function(f){
        var v=cfg('emergency',f.k,'');
        return '<label style="display:block;font-size:12px;color:#6b7686;margin:10px 0 3px;">'+acEsc(f.l)+'</label><input id="ac_e_'+f.k+'" type="text" value="'+acEsc(String(v))+'" placeholder="e.g. (555) 123-4567" style="width:100%;max-width:320px;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">';
      }).join('');
      acShell(acCard('Emergency Numbers','These fill the [____] blanks in the Emergency Procedures screens.',rows+acSaveBtn('acSaveEmergency()','Save emergency numbers')));
    }
    function acSaveEmergency(){
      var items=AC_EMERG.map(function(f,i){ var el=document.getElementById('ac_e_'+f.k); var val=el?String(el.value).trim():''; return {group:'emergency',key:f.k,label:f.l,value:val,sort:i}; });
      acBatchSet(items,function(err){ if(!err) alert('Emergency numbers saved.'); });
    }

    // ---- gated opener (devs / managers only) ----
    function openAppSettingsAdmin(){
      var ok=false;
      try{ ok = !!(currentUser && (currentUser.is_developer===true || (typeof isManagerRole==='function'&&isManagerRole()) || currentUser.role==='Admin Manager')); }catch(e){ ok=false; }
      if(!ok){ alert('App Settings is available to managers and admins only.'); return; }
      _ac.tab='targets';
      acRender();                       // open instantly (shows cached/defaults)
      cfgLoadAll(function(){ acRender(); }); // refresh once groups load
    }
