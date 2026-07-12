    // ============================================================
    // MARKETING COMMAND CENTER v2 — GAP-FILL OVERLAY  (js/27_marketing_v2.js)
    // ADDITIVE companion to js/13_marketing.js (untouched). Entry:
    // openMarketingV2()  — tile suggestion: btn-marketingV2 (📣), overlay id
    // marketingV2Modal. Backend: marketing_v2.sql (mkt2_* RPCs).
    //
    // RPC SHAPES (server + UI written to agree — CONTRACT_wave2 rule):
    //  mkt2_instruction_list -> { items:[ {id,campaign_id,campaign_name,campaign_status,
    //      location,instructions,employee_script,materials_info,starts_on,ends_on,
    //      required:[keys], acks:{key:{val,by,at}}} ] }
    //  mkt2_instruction_ack  <- p_acks = BULK {key:value,...} (one row per field)
    //  mkt2_results_get      -> { fields:{k:v}, required:[k], missing:[k] }
    //  mkt2_results_save     <- p_fields = BULK {k:v,...} (one row per field)
    //  mkt2_scorecard        -> { campaign:{}, fields:{}, metrics:[], calc:{} }
    //  mkt2_spend_report     -> { year, by_month:[{mon,approved,actual}], by_quarter:[{q,..}],
    //      by_category:[{category,..}], by_type:[{ctype,..}], total_approved, total_actual }
    //  mkt2_task_board       -> { available, tasks:[shared-task rows], note }
    //  mkt2_dashboard_extras -> { material_soon:[], results_overdue:[], approvals_pending:n,
    //      instr_open:[], spend:{approved,actual}|null }
    //  mkt2_campaign_search  -> [ campaign rows ] (same keys as mkt_campaign_list + actual_spend)
    // Reuses existing RPCs: mkt_budget_list, app_task_create, app_settings_get,
    // app_settings_set. Photo uploads: material-upload edge fn + training-materials
    // bucket (same pattern as js/18 dsrUploadAttachment). No Dropbox.
    // ============================================================
    var _m2 = { tab:'mystore', store:'', campaigns:[], items:[], budgets:[], cur:null,
                results:null, score:null, extras:null, board:null, spend:null, settingsRows:[] };

    function m2Rpc(name, args, cb, onerr){
      withPin(function(pin){
        var a = Object.assign({ p_username: currentUser.username, p_password: pin }, args || {});
        supabaseClient.rpc(name, a).then(function(r){
          if(r.error){
            if(onerr) onerr(r.error);
            else alert(String(r.error.message||'').indexOf('forbidden')>=0 ? 'You do not have access to this.' : r.error.message);
            return;
          }
          cb(r.data);
        }).catch(function(){ if(onerr) onerr({message:'Connection error'}); else alert('Connection error.'); });
      });
    }

    // ---- role gates ----
    function m2CanOpen(){
      if(!currentUser) return false;
      if(currentUser.is_developer === true) return true;
      if(typeof isManagerRole === 'function' && isManagerRole()) return true;
      var r = String(currentUser.role || '');
      return /manager|admin|lead|owner|vice|marketing|creative/i.test(r);
    }
    function m2IsLeader(){
      var r = String((currentUser&&currentUser.role) || '');
      return /admin|owner|vice/i.test(r) || r === 'Marketing Manager' || (currentUser&&currentUser.is_developer===true);
    }
    function m2IsAdmin(){
      if(typeof isAdminManager === 'function') return isAdminManager() || (currentUser&&currentUser.is_developer===true);
      return m2IsLeader();
    }

    // ---- chrome ----
    function m2Overlay(){ var o=document.getElementById('marketingV2Modal'); if(!o){ o=document.createElement('div'); o.id='marketingV2Modal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100000;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function m2Close(){ var o=document.getElementById('marketingV2Modal'); if(o) o.style.display='none'; var m=document.getElementById('m2Modal2'); if(m) m.style.display='none'; }
    function m2Header(title){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:5;"><b style="flex:1;font-size:16px;">'+title+'</b><button onclick="m2Close()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">&times;</button></div>'; }
    function m2Panel(title,body){ return '<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:14px;margin-bottom:12px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">'+title+'</div>'+body+'</div>'; }
    function m2Row(k,v){ return '<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;font-size:12.5px;"><span style="color:#6b6275;">'+k+'</span><span style="color:#26242b;text-align:right;">'+(v==null||v===''?'&mdash;':escapeHtml(String(v)))+'</span></div>'; }
    function m2Field(label,id,val,type){ return '<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">'+label+'</label><input id="'+id+'" type="'+(type||'text')+'" value="'+(val==null?'':escapeHtml(String(val)))+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'; }
    function m2Area(label,id,val){ return '<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">'+label+'</label><textarea id="'+id+'" rows="3" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+(val==null?'':escapeHtml(String(val)))+'</textarea>'; }
    function m2Sel(label,id,opts,val){ return '<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">'+label+'</label><select id="'+id+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+(opts||[]).map(function(o){ return '<option'+(o===val?' selected':'')+'>'+escapeHtml(o)+'</option>'; }).join('')+'</select>'; }
    function m2Modal(html){ var m=document.getElementById('m2Modal2'); if(!m){ m=document.createElement('div'); m.id='m2Modal2'; m.style.cssText='position:fixed;inset:0;background:rgba(20,20,30,.5);z-index:100002;display:flex;align-items:center;justify-content:center;padding:16px;'; document.body.appendChild(m); } m.innerHTML='<div style="background:#fff;border-radius:16px;max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:18px;">'+html+'</div>'; m.style.display='flex'; }
    function m2ModalClose(){ var m=document.getElementById('m2Modal2'); if(m) m.style.display='none'; }
    function m2Val(id){ var e=document.getElementById(id); return e?String(e.value).trim():''; }
    function m2Money(n){ var x=parseFloat(n||0); if(isNaN(x)) x=0; return '$'+Math.round(x).toLocaleString(); }
    function m2Date(d){ if(!d) return ''; try{ return new Date(d+(String(d).length<=10?'T00:00:00':'')).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }catch(e){ return String(d).slice(0,10); } }
    function m2Pill(s){ var map={'Approved':'#1b7a3d','Live':'#1b7a3d','Pending':'#9a5b00','Needs Revision':'#9a5b00','Declined':'#c0264b','Purchased':'#185FA5','Received':'#185FA5','Closed':'#5b6675','Idea':'#8a8594'}; var c=map[s]||'#185FA5'; return '<span style="background:'+c+'22;color:'+c+';font-size:10.5px;font-weight:800;padding:2px 9px;border-radius:99px;">'+escapeHtml(s||'')+'</span>'; }
    function m2Btn(lbl,fn,solid){ return '<button onclick="'+fn+'" style="background:'+(solid?'#185FA5':'#eef3fb')+';color:'+(solid?'#fff':'#185FA5')+';border:none;border-radius:9px;padding:9px 13px;font-weight:700;cursor:pointer;">'+lbl+'</button>'; }
    function m2Loading(){ m2Overlay().innerHTML=m2Header('Marketing v2')+'<div style="text-align:center;padding:50px;color:#6b7686;">Loading&hellip;</div>'; }
    function m2Empty(t){ return '<div style="color:#6b6275;font-size:13px;padding:16px;text-align:center;">'+t+'</div>'; }
    function m2StoreOpts(sel){ var stores=(typeof HUB_STORES!=='undefined'&&HUB_STORES||[]).slice(); return stores.map(function(s){ return '<option'+(s===sel?' selected':'')+'>'+escapeHtml(s)+'</option>'; }).join(''); }

    // ---- config (globals cfg/cfgNum/cfgListOr per contract; safe fallbacks) ----
    function m2Cfg(group,key,fb){ try{ if(typeof cfg==='function'){ var v=cfg(group,key,fb); if(v!=null&&v!=='') return v; } }catch(e){} return fb; }
    function m2CfgList(group,fb){
      try{ if(typeof cfgListOr==='function'){ var v=cfgListOr(group,fb); if(v&&v.length) return v; } }catch(e){}
      var rows=_m2.settingsRows||[]; var vals=rows.filter(function(r){ return r.group===group; }).map(function(r){ return r.label||r.value; }).filter(Boolean);
      return vals.length?vals:fb;
    }
    var M2_ACK_LABELS = { materials_received:'Materials received', signage_installed:'Signage installed',
      signage_removed:'Signage removed', photos_uploaded:'Local photos uploaded', feedback:'Local feedback added' };
    function m2AckLabel(k){ return M2_ACK_LABELS[k] || String(k).replace(/_/g,' '); }
    var M2_CLOSEOUT_FIELDS = [
      ['goal_recap','Goal recap','area'], ['materials_used','Materials used','area'],
      ['social_results','Social results (posts, reach, engagement...)','area'],
      ['website_results','Website results (forms, inquiries...)','area'],
      ['email_sms_results','Email / SMS results','area'],
      ['sales_results','Sales / POS observations','area'],
      ['manager_observations','Store manager observations','area'],
      ['customer_feedback','Customer feedback highlights','area'],
      ['what_worked','What worked','area'], ['what_didnt','What did not work','area'],
      ['repeat_next_year','Repeat next year?','select:Yes,No,Maybe'],
      ['recommended_changes','Recommended changes for next time','area'],
      ['actual_spend','Actual spend ($)','number'],
      ['results_summary','Results summary (shows on the v1 campaign record)','area'],
      ['lessons','Lessons learned (shows on the v1 campaign record)','area'] ];
    var M2_REQ_TYPES_DEF = ['Local Event','Fundraiser Support','Catering/Vending Opportunity',
      'School/Community Partnership','Signage','Social Post','Hiring Push','Donation/Sponsorship',
      'Photo/Video','Menu/Item Promotion','Other'];

    // ---- ENTRY POINT ----
    function openMarketingV2(){
      if(!m2CanOpen()){ alert('Marketing tools are for managers, leads, and the marketing team.'); return; }
      _m2.tab = m2IsLeader() ? 'alerts' : 'mystore';
      _m2.store = (currentUser && currentUser.store) || (typeof activeStoreLoc==='function' ? activeStoreLoc() : '') || ((typeof HUB_STORES!=='undefined'&&HUB_STORES[0])||'');
      m2Loading();
      m2Rpc('app_settings_get',{p_group:null},function(rows){ _m2.settingsRows=rows||[]; m2Tab(_m2.tab); },
        function(){ _m2.settingsRows=[]; m2Tab(_m2.tab); });
    }

    function m2Tabs(){
      var t=_m2.tab;
      function b(id,lbl){ return '<button onclick="m2Tab(\''+id+'\')" style="flex:1;min-width:86px;background:'+(t===id?'#185FA5':'#eef0f3')+';color:'+(t===id?'#fff':'#5b6472')+';border:none;padding:10px 6px;font-size:12.5px;font-weight:700;cursor:pointer;border-radius:9px;">'+lbl+'</button>'; }
      var h='<div style="display:flex;flex-wrap:wrap;gap:6px;max-width:1040px;margin:12px auto 0;padding:0 16px;">';
      h+=b('mystore','My Store')+b('instructions','Instructions')+b('closeout','Closeout');
      if(m2IsLeader()) h+=b('approvals','Approvals')+b('spend','Spend');
      h+=b('board','Board')+b('alerts','Alerts');
      if(m2IsAdmin()) h+=b('settings','Settings');
      h+='</div>'; return h;
    }
    function m2Shell(body){ m2Overlay().innerHTML=m2Header('Marketing Command Center v2')+m2Tabs()+'<div style="max-width:1040px;margin:0 auto;padding:14px 16px 60px;">'+body+'</div>'; }
    function m2Tab(t){ _m2.tab=t;
      if(t==='mystore') m2LoadMyStore(); else if(t==='instructions') m2LoadInstructions();
      else if(t==='closeout') m2LoadCloseout(); else if(t==='approvals') m2LoadApprovals();
      else if(t==='spend') m2LoadSpend(); else if(t==='board') m2LoadBoard();
      else if(t==='alerts') m2LoadAlerts(); else if(t==='settings') m2RenderSettings();
    }

    // ======================= MY STORE (store manager experience) =======================
    function m2LoadMyStore(){
      m2Loading(); var loc=_m2.store||'';
      m2Rpc('mkt2_campaign_search',{p_filters:{store:loc}},function(camps){
        _m2.campaigns=camps||[];
        m2Rpc('mkt2_instruction_list',{p_campaign_id:null,p_location:loc||null},function(d){
          _m2.items=(d&&d.items)||[]; m2RenderMyStore();
        });
      });
    }
    function m2StorePick(){ _m2.store=m2Val('m2storeSel'); m2LoadMyStore(); }
    function m2RenderMyStore(){
      var h='<div style="display:flex;gap:8px;align-items:end;margin-bottom:12px;"><div style="flex:1;"><label style="font-size:12px;color:#6b7686;">Store</label><select id="m2storeSel" onchange="m2StorePick()" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+m2StoreOpts(_m2.store)+'</select></div></div>';
      var camps=_m2.campaigns||[];
      var ch=''; if(!camps.length) ch=m2Empty('No campaigns touch this store yet.');
      camps.forEach(function(c){ ch+='<div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid #f0eef4;border-radius:9px;margin-bottom:6px;">'+m2Pill(c.status)+'<b style="flex:1;font-size:13px;">'+escapeHtml(c.name||'')+'</b><span style="font-size:12px;color:#6b6275;">'+(c.launch_date?('Launch '+m2Date(c.launch_date)):'')+'</span></div>'; });
      h+=m2Panel('Campaigns affecting '+escapeHtml(_m2.store||'this store'), ch);
      var items=_m2.items||[];
      if(!items.length) h+=m2Panel('Store instructions', m2Empty('No campaign instructions for this store yet.'));
      items.forEach(function(it,ix){ h+=m2InstrCard(it,ix,true); });
      m2Shell(h);
    }
    function m2InstrCard(it,ix,ackable){
      var req=(it.required||[]); var acks=it.acks||{};
      var b='<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'+m2Pill(it.campaign_status||'')+'<b style="flex:1;font-size:13.5px;">'+escapeHtml(it.campaign_name||'')+' &mdash; '+escapeHtml(it.location||'')+'</b><span style="font-size:12px;color:#6b6275;">'+(it.starts_on?m2Date(it.starts_on):'')+(it.ends_on?' &rarr; '+m2Date(it.ends_on):'')+'</span></div>';
      if(it.instructions) b+=m2Row('What to do',it.instructions);
      if(it.employee_script) b+=m2Row('Tell the team',it.employee_script);
      if(it.materials_info) b+=m2Row('Materials coming',it.materials_info);
      b+='<div style="margin-top:8px;font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;">Confirmations</div>';
      req.forEach(function(k){
        var a=acks[k];
        if(k==='feedback'){
          b+='<label style="display:block;font-size:12px;color:#6b7686;margin:6px 0 3px;">'+m2AckLabel(k)+(a?' <span style="color:#1b7a3d;font-weight:700;">(saved by '+escapeHtml(a.by||'')+')</span>':'')+'</label>'
            +(ackable?'<textarea id="m2ack_'+ix+'_'+k+'" rows="2" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+escapeHtml((a&&a.val&&a.val!=='yes')?a.val:'')+'</textarea>':(a?'<div style="font-size:12.5px;">'+escapeHtml(a.val||'')+'</div>':''));
        } else if(k==='photos_uploaded'){
          b+='<div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;"><span style="flex:1;">'+m2AckLabel(k)+(a?' <a href="'+escapeHtml(a.val||'#')+'" target="_blank" rel="noopener" style="color:#185FA5;font-weight:700;">view</a> <span style="color:#1b7a3d;font-size:11.5px;">by '+escapeHtml(a.by||'')+'</span>':'')+'</span>'
            +(ackable?'<button onclick="m2AckPhoto(\''+it.id+'\')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">Upload photo</button>':'')+'</div>';
        } else {
          b+='<label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;"><input type="checkbox" id="m2ack_'+ix+'_'+k+'" '+(a?'checked':'')+(ackable?'':' disabled')+'> '+m2AckLabel(k)+(a?' <span style="color:#1b7a3d;font-size:11.5px;">by '+escapeHtml(a.by||'')+' '+m2Date(a.at)+'</span>':'')+'</label>';
        }
      });
      if(ackable) b+='<div id="m2ackMsg_'+ix+'" style="color:#c0264b;font-size:12px;"></div><button onclick="m2AckSave(\''+it.id+'\','+ix+')" style="margin-top:8px;background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:9px 14px;font-weight:800;cursor:pointer;">Save confirmations</button>';
      return m2Panel('Campaign instructions', b);
    }
    function m2AckSave(id,ix){
      var it=(_m2.items||[])[ix]; if(!it) return;
      var acks={};
      (it.required||[]).forEach(function(k){
        if(k==='photos_uploaded') return; // handled by upload button
        var el=document.getElementById('m2ack_'+ix+'_'+k); if(!el) return;
        if(el.type==='checkbox'){ if(el.checked && !(it.acks&&it.acks[k])) acks[k]='yes'; }
        else { var v=String(el.value).trim(); if(v) acks[k]=v; }
      });
      if(!Object.keys(acks).length){ var m=document.getElementById('m2ackMsg_'+ix); if(m) m.textContent='Nothing new to save.'; return; }
      m2Rpc('mkt2_instruction_ack',{p_instruction_id:id,p_acks:acks},function(){ m2LoadMyStore(); });
    }
    // photo upload — SAME pattern as js/18 dsrUploadAttachment (Supabase Storage)
    function m2AckPhoto(instrId){
      var inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
      inp.onchange=function(){
        var f=inp.files&&inp.files[0]; if(!f) return;
        withPin(function(pin){
          supabaseClient.functions.invoke('material-upload',{body:{username:currentUser.username,pin:pin,filename:f.name,contentType:f.type||'application/octet-stream'}}).then(function(res){
            var err=(res&&res.error)?res.error.message:((res&&res.data&&res.data.error)?res.data.error:null);
            if(err){ alert('Upload failed: '+err); return; }
            var d=res&&res.data; if(!d||!d.token){ alert('Upload could not start.'); return; }
            supabaseClient.storage.from('training-materials').uploadToSignedUrl(d.path,d.token,f,{contentType:f.type||undefined}).then(function(up){
              if(up.error){ alert('Upload failed: '+up.error.message); return; }
              var pub=(supabaseClient.storage.from('training-materials').getPublicUrl(d.path)||{}).data||{};
              var url=d.publicUrl||d.url||pub.publicUrl||d.path;
              var acks={}; acks.photos_uploaded=url;
              m2Rpc('mkt2_instruction_ack',{p_instruction_id:instrId,p_acks:acks},function(){ m2LoadMyStore(); });
            }).catch(function(){ alert('Upload failed.'); });
          }).catch(function(){ alert('Upload failed.'); });
        });
      };
      inp.click();
    }

    // ======================= INSTRUCTIONS (marketing/managers author) =======================
    function m2LoadInstructions(){
      m2Loading();
      m2Rpc('mkt2_campaign_search',{p_filters:{}},function(camps){
        _m2.campaigns=camps||[];
        m2Rpc('mkt2_instruction_list',{p_campaign_id:null,p_location:null},function(d){
          _m2.items=(d&&d.items)||[]; m2RenderInstructions();
        });
      });
    }
    function m2RenderInstructions(){
      var h='<div style="display:flex;gap:8px;margin-bottom:12px;">'+m2Btn('&#10133; New instruction packet','m2InstrNew()',true)+'</div>'
        +'<div style="font-size:12px;color:#6b6275;margin-bottom:12px;">One packet per campaign per store: what to put up, what to tell the team, what materials are coming, and what the store must confirm.</div>';
      var items=_m2.items||[];
      if(!items.length) h+=m2Empty('No instruction packets yet.');
      items.forEach(function(it,ix){ h+=m2InstrCard(it,ix,false); });
      m2Shell(h);
    }
    function m2InstrNew(){
      var camps=_m2.campaigns||[];
      if(!camps.length){ alert('Create a campaign first (Marketing Command Center > New campaign).'); return; }
      var copts=camps.map(function(c){ return '<option value="'+c.id+'">'+escapeHtml(c.name||'')+'</option>'; }).join('');
      var h='<h3 style="margin:0 0 10px;">New instruction packet</h3>'
        +'<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">Campaign</label><select id="m2i_camp" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+copts+'</select>'
        +'<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">Store</label><select id="m2i_store" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+m2StoreOpts(_m2.store)+'</select>'
        +m2Area('What to do (signage, displays, setup)','m2i_instr','')
        +m2Area('What to tell employees','m2i_script','')
        +m2Area('Materials coming (what and when)','m2i_mat','')
        +'<div style="display:flex;gap:8px;"><div style="flex:1;">'+m2Field('Starts','m2i_start','','date')+'</div><div style="flex:1;">'+m2Field('Ends','m2i_end','','date')+'</div></div>'
        +'<div style="font-size:11.5px;color:#6b6275;margin-top:6px;">Required confirmations come from Admin settings (ack_keys) and can be tuned per rollout.</div>'
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="m2ModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="m2InstrSave()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Publish to store</button></div>';
      m2Modal(h);
    }
    function m2InstrSave(){
      var p={ campaign_id:m2Val('m2i_camp'), location:m2Val('m2i_store'), instructions:m2Val('m2i_instr'),
        employee_script:m2Val('m2i_script'), materials_info:m2Val('m2i_mat'),
        starts_on:m2Val('m2i_start'), ends_on:m2Val('m2i_end') };
      if(!p.campaign_id||!p.location){ alert('Campaign and store are required.'); return; }
      m2Rpc('mkt2_instruction_save',{p_payload:p},function(){ m2ModalClose(); m2LoadInstructions(); });
    }

    // ======================= CLOSEOUT (structured results + scorecard) =======================
    function m2LoadCloseout(){
      m2Loading();
      m2Rpc('mkt2_campaign_search',{p_filters:{}},function(camps){ _m2.campaigns=camps||[]; m2RenderCloseoutPick(); });
    }
    function m2RenderCloseoutPick(){
      var camps=_m2.campaigns||[];
      var h='<div style="font-size:12px;color:#6b6275;margin-bottom:12px;">Pick a campaign to record its structured closeout and see the scorecard.</div>';
      if(!camps.length) h+=m2Empty('No campaigns yet.');
      camps.forEach(function(c){ h+='<div onclick="m2CloseoutOpen(\''+c.id+'\')" style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13.5px;">'+escapeHtml(c.name||'')+'</b>'+m2Pill(c.status)+'<span style="font-size:12px;color:#6b6275;">'+(c.results_due?('Results due '+m2Date(c.results_due)):'')+'</span></div>'; });
      m2Shell(h);
    }
    function m2CloseoutOpen(id){
      m2Loading(); _m2.cur=id;
      m2Rpc('mkt2_results_get',{p_campaign_id:id},function(r){
        _m2.results=r||{fields:{},required:[],missing:[]};
        m2Rpc('mkt2_scorecard',{p_campaign_id:id},function(s){ _m2.score=s; m2RenderCloseout(); });
      });
    }
    function m2RenderCloseout(){
      var r=_m2.results||{fields:{}}; var s=_m2.score||{}; var c=s.campaign||{}; var calc=s.calc||{};
      var req=(r.required||[]).map(function(x){ return String(x).trim(); });
      var h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">'+m2Btn('&lsaquo; All campaigns','m2Tab(\'closeout\')')+'<b style="flex:1;font-size:16px;">'+escapeHtml(c.name||'')+'</b>'+m2Pill(c.status||'')+'</div>';
      var sc=m2Row('Budget approved',m2Money(calc.approved))+m2Row('Actual spend',m2Money(calc.spent))
        +m2Row('Variance',m2Money(calc.variance))+m2Row('% of budget used',calc.pct_of_budget!=null?calc.pct_of_budget+'%':'')
        +m2Row('Duration (days)',calc.duration_days)+m2Row('On-time launch',calc.on_time_launch===true?'Yes':(calc.on_time_launch===false?'No':'—'))
        +m2Row('Stores confirmed',(calc.stores_confirmed||0)+' of '+(calc.stores_total||0))
        +m2Row('Closeout complete',calc.results_submitted?'Yes':('No — '+(calc.missing_required||0)+' required field(s) missing'));
      h+=m2Panel('Scorecard', sc);
      var f=r.fields||{};
      var fh='';
      M2_CLOSEOUT_FIELDS.forEach(function(def){
        var k=def[0], lbl=def[1]+(req.indexOf(k)>=0?' *':''), typ=def[2];
        if(typ==='area') fh+=m2Area(lbl,'m2co_'+k,f[k]);
        else if(typ==='number') fh+=m2Field(lbl,'m2co_'+k,f[k],'number');
        else if(typ.indexOf('select:')===0){ var opts=['',].concat(typ.slice(7).split(',')); fh+=m2Sel(lbl,'m2co_'+k,opts,f[k]||''); }
        else fh+=m2Field(lbl,'m2co_'+k,f[k]);
      });
      fh+='<div style="font-size:11.5px;color:#6b6275;margin-top:4px;">* required before the closeout counts as complete (configurable in Admin settings).</div>';
      fh+='<button onclick="m2CloseoutSave()" style="margin-top:10px;background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:10px 16px;font-weight:800;cursor:pointer;">Save closeout</button>';
      h+=m2Panel('Closeout — every field saves as its own row (bulk upsert)', fh);
      var mets=(s.metrics||[]);
      var mh=''; if(!mets.length) mh=m2Empty('No manual metrics yet. Add them from the v1 Marketing module (Results) or future imports.');
      mets.forEach(function(m){ mh+='<div style="display:flex;gap:8px;font-size:12.5px;padding:4px 0;border-bottom:1px solid #f2f2f6;"><span style="flex:1;">'+escapeHtml(m.metric_key||'')+'</span><span style="color:#6b6275;">'+escapeHtml(m.channel||'')+'</span><b>'+escapeHtml(String(m.metric_value==null?'':m.metric_value))+'</b><span style="color:#8a8594;">'+m2Date(m.metric_date)+'</span></div>'; });
      h+=m2Panel('Metrics on record', mh);
      m2Shell(h);
    }
    function m2CloseoutSave(){
      var fields={};
      M2_CLOSEOUT_FIELDS.forEach(function(def){ var v=m2Val('m2co_'+def[0]); if(v) fields[def[0]]=v; });
      if(!Object.keys(fields).length){ alert('Nothing to save.'); return; }
      m2Rpc('mkt2_results_save',{p_campaign_id:_m2.cur,p_fields:fields},function(){ m2CloseoutOpen(_m2.cur); });
    }

    // ======================= APPROVALS (threshold-enforced) =======================
    function m2LoadApprovals(){
      m2Loading();
      m2Rpc('mkt_budget_list',{p_filters:{}},function(d){ _m2.budgets=d||[]; m2RenderApprovals(); },
        function(e){ m2Shell('<div style="color:#c0264b;padding:20px;">'+escapeHtml(String(e.message||'Not available'))+'</div>'); });
    }
    function m2RenderApprovals(){
      var t1=m2Cfg('mkt_approval_rules','tier1_max',250), t2=m2Cfg('mkt_approval_rules','tier2_max',1000);
      var h='<div style="font-size:12px;color:#6b6275;margin-bottom:12px;">Approval limits come from Admin settings: tier 1 up to '+m2Money(t1)+', tier 2 up to '+m2Money(t2)+', tier 3 unlimited. The server enforces your limit; you also cannot approve your own request.</div>';
      var list=_m2.budgets||[];
      if(!list.length) h+=m2Empty('No budget lines yet.');
      list.forEach(function(b){
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px;margin-bottom:9px;"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13.5px;">'+escapeHtml(b.title||'')+'</b>'+m2Pill(b.status)+'</div>'
          +'<div style="font-size:12px;color:#6b6275;margin-top:5px;">'+escapeHtml(b.campaign_name||'—')+(b.category?' &middot; '+escapeHtml(b.category):'')+' &middot; est '+m2Money(b.est_cost)+(b.approved_amount!=null?' &middot; approved '+m2Money(b.approved_amount):'')+(b.actual_cost!=null?' &middot; actual '+m2Money(b.actual_cost):'')+'</div>'
          +'<div style="font-size:11.5px;color:#8a8594;margin-top:3px;">Requested by '+escapeHtml(b.requested_by_name||'')+(b.approved_by_name?' &middot; decided by '+escapeHtml(b.approved_by_name):'')+'</div>'
          +'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">'
          +(b.status==='Pending'?'<button onclick="m2Decide(\''+b.id+'\')" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">Approve / decline</button>':'')
          +(b.status==='Approved'||b.status==='Purchased'||b.status==='Received'?'<button onclick="m2Stage(\''+b.id+'\',\''+escapeHtml(b.status)+'\')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">Next stage</button>':'')
          +'</div></div>';
      });
      m2Shell(h);
    }
    function m2Decide(id){
      var h='<h3 style="margin:0 0 10px;">Budget decision</h3>'
        +m2Sel('Decision','m2d_dec',['Approved','Declined','Changes Requested'],'Approved')
        +m2Field('Approved amount ($)','m2d_amt','','number')+m2Area('Note','m2d_note','')
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="m2ModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="m2DecideSave(\''+id+'\')" style="flex:2;background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Submit</button></div>';
      m2Modal(h);
    }
    function m2DecideSave(id){
      var amt=m2Val('m2d_amt');
      m2Rpc('mkt2_budget_decide',{p_id:id,p_decision:m2Val('m2d_dec'),p_amount:amt?parseFloat(amt):null,p_note:m2Val('m2d_note')},
        function(){ m2ModalClose(); m2LoadApprovals(); });
    }
    function m2Stage(id,curStatus){
      var next=curStatus==='Approved'?'Purchased':(curStatus==='Purchased'?'Received':'Closed');
      var h='<h3 style="margin:0 0 10px;">Update stage</h3>'
        +m2Sel('Stage','m2s_stage',['Purchased','Received','Closed','Needs Revision'],next)
        +m2Field('Actual cost ($) — rolls into campaign spend','m2s_actual','','number')
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="m2ModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="m2StageSave(\''+id+'\')" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Save</button></div>';
      m2Modal(h);
    }
    function m2StageSave(id){
      var a=m2Val('m2s_actual');
      m2Rpc('mkt2_budget_stage',{p_id:id,p_stage:m2Val('m2s_stage'),p_actual:a?parseFloat(a):null},
        function(){ m2ModalClose(); m2LoadApprovals(); });
    }

    // ======================= SPEND (leadership report) =======================
    function m2LoadSpend(){
      m2Loading(); var y=new Date().getFullYear();
      m2Rpc('mkt2_spend_report',{p_year:_m2.spendYear||y},function(d){ _m2.spend=d; m2RenderSpend(); });
    }
    function m2SpendYear(delta){ _m2.spendYear=((_m2.spend&&_m2.spend.year)||new Date().getFullYear())+delta; m2LoadSpend(); }
    function m2RenderSpend(){
      var d=_m2.spend||{}; var MN=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var h='<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">'+m2Btn('&lsaquo;','m2SpendYear(-1)')+'<b style="font-size:16px;">'+(d.year||'')+' marketing spend</b>'+m2Btn('&rsaquo;','m2SpendYear(1)')+'</div>';
      h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">'
        +'<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px;text-align:center;"><div style="font-size:22px;font-weight:800;color:#185FA5;">'+m2Money(d.total_approved)+'</div><div style="font-size:11px;color:#6b6275;">Approved</div></div>'
        +'<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px;text-align:center;"><div style="font-size:22px;font-weight:800;color:#1b7a3d;">'+m2Money(d.total_actual)+'</div><div style="font-size:11px;color:#6b6275;">Actual</div></div></div>';
      function tbl(rows,keyLbl,keyFld){
        if(!rows||!rows.length) return m2Empty('Nothing recorded.');
        var t='<div style="display:flex;font-size:11px;font-weight:800;color:#6b6275;text-transform:uppercase;padding:4px 0;"><span style="flex:1;">'+keyLbl+'</span><span style="width:90px;text-align:right;">Approved</span><span style="width:90px;text-align:right;">Actual</span></div>';
        rows.forEach(function(x){ var k=x[keyFld]; if(keyFld==='mon') k=MN[k]||k; if(keyFld==='q') k='Q'+k;
          t+='<div style="display:flex;font-size:12.5px;padding:4px 0;border-bottom:1px solid #f2f2f6;"><span style="flex:1;">'+escapeHtml(String(k))+'</span><span style="width:90px;text-align:right;">'+m2Money(x.approved)+'</span><span style="width:90px;text-align:right;">'+m2Money(x.actual)+'</span></div>'; });
        return t;
      }
      h+=m2Panel('By month', tbl(d.by_month,'Month','mon'));
      h+=m2Panel('By quarter', tbl(d.by_quarter,'Quarter','q'));
      h+=m2Panel('By category', tbl(d.by_category,'Category','category'));
      h+=m2Panel('By campaign type', tbl(d.by_type,'Type','ctype'));
      m2Shell(h);
    }

    // ======================= BOARD (shared task view) =======================
    function m2LoadBoard(){ m2Loading(); m2Rpc('mkt2_task_board',{},function(d){ _m2.board=d; m2RenderBoard(); }); }
    function m2RenderBoard(){
      var d=_m2.board||{}; var h='';
      h+='<div style="display:flex;gap:8px;margin-bottom:12px;">'+m2Btn('&#10133; New marketing task','m2TaskNew()',true)+'</div>';
      if(d.available===false){
        h+=m2Panel('Shared task board', '<div style="font-size:12.5px;color:#6b6275;">'+escapeHtml(d.note||'Shared task table not readable.')+'<br><br>Marketing tasks still work — they are created through the shared task engine (app_task_create) and appear on each assignee\'s Today list. This tab just cannot list them until the table name is configured (Admin settings &gt; tasks_table).</div>');
      } else {
        var tasks=d.tasks||[];
        if(!tasks.length) h+=m2Empty('No marketing-prefixed tasks found in the shared system.');
        var groups={};
        tasks.forEach(function(t){ var st=t.status||(t.completed_at||t.completed?'Completed':'Open'); (groups[st]=groups[st]||[]).push(t); });
        Object.keys(groups).forEach(function(st){
          var gh='';
          groups[st].forEach(function(t){
            var due=t.due||t.due_date||t.due_on||'';
            var overdue=due&&String(due).slice(0,10)<new Date().toISOString().slice(0,10)&&st!=='Completed';
            gh+='<div style="display:flex;align-items:center;gap:8px;padding:7px;border:1px solid '+(overdue?'#f3d3da':'#f0eef4')+';border-radius:9px;margin-bottom:6px;'+(overdue?'background:#fdf3f5;':'')+'"><b style="flex:1;font-size:13px;">'+escapeHtml(t.title||'')+'</b>'+(due?'<span style="font-size:12px;color:'+(overdue?'#c0264b':'#6b6275')+';">'+(overdue?'OVERDUE ':'')+m2Date(String(due).slice(0,10))+'</span>':'')+(t.target_value?'<span style="font-size:11.5px;color:#8a8594;">'+escapeHtml(String(t.target_value))+'</span>':'')+'</div>';
          });
          h+=m2Panel(st+' ('+groups[st].length+')', gh);
        });
      }
      m2Shell(h);
    }
    function m2TaskNew(){
      var h='<h3 style="margin:0 0 10px;">New marketing task</h3>'+m2Field('Task','m2t_title','')+m2Area('Details','m2t_det','')+m2Field('Due date','m2t_due','','date')
        +'<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">Target store</label><select id="m2t_store" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+m2StoreOpts(_m2.store)+'</select>'
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="m2ModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="m2TaskSave()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Create task</button></div>';
      m2Modal(h);
    }
    function m2TaskSave(){
      if(!m2Val('m2t_title')){ alert('Task title required'); return; }
      var pref=m2Cfg('mkt2_config','task_prefix','Marketing');
      m2Rpc('app_task_create',{ p_title:pref+': '+m2Val('m2t_title'), p_details:m2Val('m2t_det'), p_due:m2Val('m2t_due')||null, p_target_type:'store', p_target_value:m2Val('m2t_store')||null, p_employee_ids:null, p_completion_mode:'store' },function(){ m2ModalClose(); m2LoadBoard(); });
    }

    // ======================= ALERTS =======================
    function m2LoadAlerts(){ m2Loading(); m2Rpc('mkt2_dashboard_extras',{},function(d){ _m2.extras=d; m2RenderAlerts(); }); }
    function m2RenderAlerts(){
      var d=_m2.extras||{};
      var h='<div style="display:flex;gap:8px;margin-bottom:12px;">'+m2Btn('&#128276; Send reminder pushes now','m2ScanRun()',true)+'</div>';
      if(d.spend) h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">'
        +'<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#185FA5;">'+m2Money(d.spend.approved)+'</div><div style="font-size:11px;color:#6b6275;">Approved this year</div></div>'
        +'<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#1b7a3d;">'+m2Money(d.spend.actual)+'</div><div style="font-size:11px;color:#6b6275;">Spent this year</div></div></div>';
      var mats=d.material_soon||[]; var mh=''; if(!mats.length) mh=m2Empty('No material deadlines coming up.');
      mats.forEach(function(x){ mh+='<div style="display:flex;gap:8px;font-size:12.5px;padding:5px 0;border-bottom:1px solid #f2f2f6;"><b style="flex:1;">'+escapeHtml(x.name||'')+'</b><span style="color:#9a5b00;font-weight:700;">'+m2Date(x.material_deadline)+'</span></div>'; });
      h+=m2Panel('Material deadlines approaching', mh);
      var res=d.results_overdue||[]; var rh=''; if(!res.length) rh=m2Empty('No campaigns owe results. Nice.');
      res.forEach(function(x){ rh+='<div style="display:flex;gap:8px;font-size:12.5px;padding:5px 0;border-bottom:1px solid #f2f2f6;"><b style="flex:1;">'+escapeHtml(x.name||'')+'</b><span style="color:#c0264b;font-weight:700;">due '+m2Date(x.results_due)+'</span></div>'; });
      h+=m2Panel('Results overdue', rh);
      var ins=d.instr_open||[]; var ih=''; if(!ins.length) ih=m2Empty('Every store has confirmed its campaign actions.');
      ins.forEach(function(x){ ih+='<div style="display:flex;gap:8px;font-size:12.5px;padding:5px 0;border-bottom:1px solid #f2f2f6;"><b style="flex:1;">'+escapeHtml(x.campaign_name||'')+'</b><span>'+escapeHtml(x.location||'')+'</span><span style="color:#9a5b00;font-weight:700;">'+(x.missing||0)+' to confirm</span></div>'; });
      h+=m2Panel('Store confirmations pending', ih);
      h+=m2Panel('Budget approvals waiting', m2Row('Pending lines', d.approvals_pending||0)+(m2IsLeader()?'<div style="margin-top:6px;">'+m2Btn('Open approvals','m2Tab(\'approvals\')')+'</div>':''));
      m2Shell(h);
    }
    function m2ScanRun(){
      m2Rpc('mkt2_notify_scan',{},function(r){
        alert('Reminders sent.\nResults overdue: '+(r.results_overdue||0)+'\nMaterial deadlines soon: '+(r.materials_soon||0)+'\nStale budget lines: '+(r.budgets_stale||0)+'\nStores nudged: '+(r.stores_reminded||0));
      });
    }

    // ======================= SETTINGS (admin — everything tunable in-app) =======================
    function m2RenderSettings(){
      if(!m2IsAdmin()){ m2Shell(m2Empty('Admins only.')); return; }
      function num(lbl,id,group,key,fb){ return m2Field(lbl+' <span style="color:#8a8594;">('+group+' &rsaquo; '+key+')</span>',id,m2Cfg(group,key,fb),'number'); }
      function txt(lbl,id,group,key,fb){ return m2Field(lbl+' <span style="color:#8a8594;">('+group+' &rsaquo; '+key+')</span>',id,m2Cfg(group,key,fb)); }
      var h='';
      var ap=num('Tier 1 approval limit ($)','m2st_t1max','mkt_approval_rules','tier1_max',250)
        +txt('Tier 1 roles (comma-separated)','m2st_t1r','mkt_approval_rules','tier1_roles','Marketing Manager')
        +num('Tier 2 approval limit ($)','m2st_t2max','mkt_approval_rules','tier2_max',1000)
        +txt('Tier 2 roles','m2st_t2r','mkt_approval_rules','tier2_roles','Admin Manager')
        +txt('Tier 3 roles (unlimited)','m2st_t3r','mkt_approval_rules','tier3_roles','Vice President/Co-Owner')
        +'<button onclick="m2SettingsSaveApproval()" style="margin-top:10px;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:9px 14px;font-weight:800;cursor:pointer;">Save approval rules</button>';
      h+=m2Panel('Approval thresholds &amp; approvers (server-enforced)', ap);
      var tu=num('Material deadline warning (days)','m2st_warn','mkt2_config','material_warn_days',14)
        +num('Budget considered stale after (days)','m2st_stale','mkt2_config','budget_stale_days',3)
        +txt('Required store confirmations (csv keys)','m2st_acks','mkt2_config','ack_keys','materials_received,signage_installed,signage_removed,photos_uploaded,feedback')
        +txt('Required closeout fields (csv keys)','m2st_close','mkt2_config','closeout_required','what_worked,what_didnt,repeat_next_year')
        +txt('Shared task table name','m2st_ttable','mkt2_config','tasks_table','tasks')
        +txt('Marketing task title prefix','m2st_tpref','mkt2_config','task_prefix','Marketing')
        +m2Sel('Notify leaders on new request','m2st_nreq',['1','0'],String(m2Cfg('mkt2_config','notify_requests','1')))
        +m2Sel('Notify leaders on new budget line','m2st_nbud',['1','0'],String(m2Cfg('mkt2_config','notify_budgets','1')))
        +m2Sel('Notify stores about instructions','m2st_nins',['1','0'],String(m2Cfg('mkt2_config','notify_instructions','1')))
        +m2Sel('Reminder scan pings leaders','m2st_nscan',['1','0'],String(m2Cfg('mkt2_config','notify_scan_leaders','1')))
        +'<button onclick="m2SettingsSaveTunables()" style="margin-top:10px;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:9px 14px;font-weight:800;cursor:pointer;">Save tunables</button>';
      h+=m2Panel('Marketing v2 tunables (group mkt2_config)', tu);
      var rt=m2CfgList('mkt_request_types',M2_REQ_TYPES_DEF);
      var rh='<div style="font-size:12.5px;margin-bottom:8px;">'+rt.map(function(x){ return '<span style="display:inline-block;background:#eef3fb;color:#185FA5;font-weight:700;font-size:11.5px;padding:3px 9px;border-radius:99px;margin:2px;">'+escapeHtml(x)+'</span>'; }).join('')+'</div>'
        +m2Field('Add a request type','m2st_newrt','')
        +'<button onclick="m2SettingsAddList(\'mkt_request_types\',\'m2st_newrt\')" style="margin-top:8px;background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:8px 13px;font-weight:800;cursor:pointer;">Add type</button>'
        +'<div style="font-size:11.5px;color:#6b6275;margin-top:6px;">Removing/reordering items happens in Business Settings (choice lists).</div>';
      h+=m2Panel('Marketing request types (group mkt_request_types)', rh);
      var st=m2CfgList('mkt_statuses',['Idea','Brief Needed','Waiting on Approval','Approved','In Production','Ready for Review','Scheduled','Live','Results Needed','Completed','Archived','Canceled / Deferred']);
      var sh='<div style="font-size:12.5px;margin-bottom:8px;">'+st.map(function(x){ return '<span style="display:inline-block;background:#f2f2f6;color:#5b6472;font-weight:700;font-size:11.5px;padding:3px 9px;border-radius:99px;margin:2px;">'+escapeHtml(x)+'</span>'; }).join('')+'</div>'
        +m2Field('Add a campaign status','m2st_newst','')
        +'<button onclick="m2SettingsAddList(\'mkt_statuses\',\'m2st_newst\')" style="margin-top:8px;background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:8px 13px;font-weight:800;cursor:pointer;">Add status</button>'
        +'<div style="font-size:11.5px;color:#6b6275;margin-top:6px;">The v1 Marketing module already reads this group (mkt_statuses) — additions show up there too.</div>';
      h+=m2Panel('Campaign statuses (group mkt_statuses)', sh);
      m2Shell(h);
    }
    function m2SetKV(key,group,label,value,sort,done){
      m2Rpc('app_settings_set',{p_key:key,p_group:group,p_label:label,p_value:String(value),p_sort:sort||0},done||function(){});
    }
    function m2SettingsSaveApproval(){
      var jobs=[['tier1_max','Tier 1 max',m2Val('m2st_t1max')],['tier1_roles','Tier 1 roles',m2Val('m2st_t1r')],
        ['tier2_max','Tier 2 max',m2Val('m2st_t2max')],['tier2_roles','Tier 2 roles',m2Val('m2st_t2r')],
        ['tier3_roles','Tier 3 roles',m2Val('m2st_t3r')]];
      var i=0; (function next(){ if(i>=jobs.length){ alert('Approval rules saved.'); return; }
        var j=jobs[i++]; m2SetKV(j[0],'mkt_approval_rules',j[1],j[2],i,next); })();
    }
    function m2SettingsSaveTunables(){
      var jobs=[['material_warn_days','Material warn days',m2Val('m2st_warn')],
        ['budget_stale_days','Budget stale days',m2Val('m2st_stale')],
        ['ack_keys','Instruction ack keys',m2Val('m2st_acks')],
        ['closeout_required','Required closeout fields',m2Val('m2st_close')],
        ['tasks_table','Shared task table',m2Val('m2st_ttable')],
        ['task_prefix','Task title prefix',m2Val('m2st_tpref')],
        ['notify_requests','Notify on requests',m2Val('m2st_nreq')],
        ['notify_budgets','Notify on budgets',m2Val('m2st_nbud')],
        ['notify_instructions','Notify stores',m2Val('m2st_nins')],
        ['notify_scan_leaders','Scan pings leaders',m2Val('m2st_nscan')]];
      var i=0; (function next(){ if(i>=jobs.length){ alert('Tunables saved.'); return; }
        var j=jobs[i++]; m2SetKV(j[0],'mkt2_config',j[1],j[2],i,next); })();
    }
    function m2SettingsAddList(group,inputId){
      var v=m2Val(inputId); if(!v){ alert('Type a value first.'); return; }
      var key=v.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40)||('item_'+Date.now());
      m2SetKV(key,group,v,v,99,function(){
        m2Rpc('app_settings_get',{p_group:null},function(rows){ _m2.settingsRows=rows||[]; m2RenderSettings(); });
      });
    }
