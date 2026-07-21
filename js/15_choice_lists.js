    // ============================================================
    // CHOICE LISTS  (js/15) — generic "manage choice lists" editor.
    // Builds ON js/14 globals: cfg, cfgNum, cfgList, cfgSet, acShell,
    // acCard, acEsc, acSaveBtn, acBatchSet, HUB_CFG, withPin (all global,
    // classic-script style → these top-level functions are global too).
    // Display-only dropdown lists stored in app_settings via the existing
    // app_settings_get/_set/_delete RPCs. NO new SQL. Manager-gated by RPCs.
    // ============================================================

    // ---- registry: label + app_settings group + hardcoded defaults (seed) ----
    var CHOICE_GROUPS = [
      {group:'training_cats', label:'Training library categories', defaults:['Recipes','How-To','Policies','Customer Service','Onboarding']},
      {group:'admin_task_cats', label:'Admin task categories', defaults:['Payroll','Evaluation','Training','PIP Review','Other']},
      {group:'attendance_reasons', label:'Attendance / call-out reasons', defaults:['Illness','Accident','Personal','Bereavement','Other']},
      {group:'leadership_names', label:'Leadership names (Your Voice)', defaults:['Aaron Morales','Adriana Gomez']},
      {group:'mkt_campaign_types', label:'Marketing \u2013 campaign types', defaults:['Seasonal Promotion','Product Launch','Limited-Time Offer','Community Event','Fundraiser Support','Grand Opening','Loyalty / App','Brand Awareness','Holiday','Other']},
      {group:'mkt_channels', label:'Marketing \u2013 channels', defaults:['In-store Signage','Social - Instagram','Social - Facebook','Social - TikTok','Email','SMS','Website','Radio','Print','Outdoor','POS / Menu','Local Partner']},
      {group:'mkt_budget_cats', label:'Marketing \u2013 budget categories', defaults:['Print / Signage','Paid Social','Paid Search','Radio / TV','Influencer','Giveaways / Swag','Event','Design / Creative','Other']},
      {group:'mkt_asset_cats', label:'Marketing \u2013 asset categories', defaults:['Logo','Photo','Video','Graphic','Flyer','Menu','Social Post','Template','Brand Guide','Other']},
      {group:'disc_reasons_verbal', label:'Discipline \u2013 verbal warning reasons', defaults:['Performance','Conduct/Behavior','Carelessness','Dress Code','Attendance/Tardies','Other']},
      {group:'disc_reasons_written', label:'Discipline \u2013 written / write-up reasons', defaults:['Carelessness','Attendance','Dress Code','Conduct','Other']},
      {group:'dsr_registers', label:'Daily Report \u2013 register positions', defaults:['Front #1','Front #2','Drive-Thru']},
      {group:'dsr_checklist', label:'Daily Report \u2013 manager checklist lines', defaults:['Conducted pep talk and uniform check','Changeover manager walk around','Shift manager interaction w/ customers','Temperature checklist done','Food bar and fruit quality check','Custard quality (texture/taste hourly)']}
    ];

    // ---- READER HELPER (what feature files call) ----
    // Returns an array of LABEL STRINGS: configured rows if any, else fb,
    // else the registry defaults. Tolerant of cfgList being absent.
    function cfgListOr(group, fb){
      try{ var l=cfgList(group); if(l&&l.length) return l.map(function(x){return x.label;}); }catch(e){}
      if(fb) return fb;
      var g=CHOICE_GROUPS.filter(function(x){return x.group===group;})[0];
      return g?g.defaults.slice():[];
    }

    // ---- editor state + small style helpers ----
    var _acCl = { group:null };
    var CL_MINI   = 'background:#eef0f3;color:#26242b;border:none;border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:11px;';
    var CL_BTN    = 'background:#eef0f3;color:#185FA5;border:none;border-radius:7px;padding:5px 9px;font-weight:700;font-size:11.5px;cursor:pointer;';
    var CL_BTNDEL = 'background:#fdecec;color:#c0392b;border:none;border-radius:7px;padding:5px 9px;font-weight:700;font-size:11.5px;cursor:pointer;';

    function clSlug(s){ return String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''); }
    function clDef(group){ return CHOICE_GROUPS.filter(function(x){return x.group===group;})[0] || null; }
    function acClPick(group){ _acCl.group=group; acRenderChoiceLists(); }

    // ---- main renderer (called by js/14's tab system for the "Lists" tab) ----
    function acRenderChoiceLists(){
      if(!_acCl.group) _acCl.group = CHOICE_GROUPS[0].group;
      var group=_acCl.group, def=clDef(group);

      var picker=CHOICE_GROUPS.map(function(g){
        var on=g.group===group;
        return '<button onclick="acClPick(\''+g.group+'\')" style="background:'+(on?'#185FA5':'#eef0f3')+';color:'+(on?'#fff':'#26242b')+';border:none;border-radius:8px;padding:7px 11px;font-weight:700;font-size:12px;cursor:pointer;margin:0 6px 6px 0;">'+acEsc(g.label)+'</button>';
      }).join('');

      var saved=[]; try{ saved=cfgList(group)||[]; }catch(e){ saved=[]; }
      var body;
      if(saved.length){
        var rows=saved.map(function(it,i){
          var up = i>0             ? '<button onclick="clMove(\''+group+'\','+i+',-1)" style="'+CL_MINI+'">&#9650;</button>' : '<span style="display:inline-block;width:28px;"></span>';
          var dn = i<saved.length-1? '<button onclick="clMove(\''+group+'\','+i+',1)" style="'+CL_MINI+'">&#9660;</button>'  : '<span style="display:inline-block;width:28px;"></span>';
          return '<div style="display:flex;align-items:center;gap:6px;padding:7px 0;border-bottom:1px solid #f0f0f4;">'
            +'<span style="flex:1;font-size:14px;color:#26242b;">'+acEsc(it.label)+'</span>'
            +up+dn
            +'<button onclick="clRename(\''+group+'\',\''+it.key+'\')" style="'+CL_BTN+'">Rename</button>'
            +'<button onclick="clRemove(\''+group+'\',\''+it.key+'\')" style="'+CL_BTNDEL+'">Remove</button>'
            +'</div>';
        }).join('');
        var adder='<div style="display:flex;gap:8px;margin-top:12px;">'
          +'<input id="cl_add_input" type="text" placeholder="Add an item…" style="flex:1;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'
          +'<button onclick="clAdd(\''+group+'\')" style="background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:9px 15px;font-weight:800;cursor:pointer;">Add item</button></div>';
        body=acCard(acEsc(def?def.label:group),'Add, rename, reorder, or remove the choices shown in this dropdown across the Hub.',rows+adder);
      } else {
        var dl=(def?def.defaults:[]).map(function(x){ return '<div style="padding:6px 0;border-bottom:1px solid #f0f0f4;font-size:14px;color:#6b7686;">'+acEsc(x)+'</div>'; }).join('');
        var seedBtn='<div style="margin-top:14px;"><button onclick="clSeed(\''+group+'\')" style="background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:11px 18px;font-weight:800;cursor:pointer;">Save these defaults so they&rsquo;re editable</button></div>';
        body=acCard(acEsc(def?def.label:group),'This list is using its built-in defaults. Save them once to start renaming, reordering, and adding your own.',dl+seedBtn);
      }
      acShell('<div style="margin-bottom:12px;">'+picker+'</div>'+body);
    }

    // ---- CRUD (all manager-gated by the app_settings RPCs) ----
    function clSeed(group){
      var def=clDef(group); if(!def) return;
      var seen={}, items=def.defaults.map(function(lbl,i){
        var k=group+'__'+(clSlug(lbl)||('item_'+i)); var b=k, n=2; while(seen[k]){ k=b+'_'+(n++); } seen[k]=1;
        return {group:group,key:k,label:lbl,value:'',sort:i};
      });
      acBatchSet(items,function(err){ if(err) alert('Some items could not be saved. Managers only.'); acRenderChoiceLists(); });
    }

    function clAdd(group){
      var el=document.getElementById('cl_add_input'); var lbl=el?String(el.value).trim():'';
      if(!lbl){ if(el) el.focus(); return; }
      var existing=[]; try{ existing=cfgList(group)||[]; }catch(e){}
      var keys={}, maxSort=-1; existing.forEach(function(it){ keys[it.key]=1; if((it.sort||0)>maxSort) maxSort=it.sort||0; });
      var base=group+'__'+(clSlug(lbl)||('item_'+Date.now())), key=base, n=2; while(keys[key]){ key=base+'_'+(n++); }
      cfgSet(group,key,lbl,'',maxSort+1,function(err){ if(!err){ if(el) el.value=''; acRenderChoiceLists(); } });
    }

    function clRename(group,key){
      var existing=[]; try{ existing=cfgList(group)||[]; }catch(e){}
      var cur=existing.filter(function(it){return it.key===key;})[0]; if(!cur) return;
      var nv=prompt('Rename this item:', cur.label); if(nv==null) return; nv=String(nv).trim(); if(!nv) return;
      cfgSet(group,key,nv,cur.value||'',cur.sort||0,function(err){ if(!err) acRenderChoiceLists(); });
    }

    function clRemove(group,key){
      if(!confirm('Remove this item from the list?')) return;
      withPin(function(pin){
        supabaseClient.rpc('app_settings_delete',{p_username:currentUser.username,p_password:pin,p_key:key}).then(function(r){
          if(r.error){ alert(r.error.message||'Could not remove. Managers only.'); return; }
          try{ if(typeof HUB_CFG!=='undefined' && HUB_CFG[group]) delete HUB_CFG[group][key]; }catch(e){}
          acRenderChoiceLists();
        }).catch(function(){ alert('Connection error while removing.'); });
      });
    }

    function clMove(group,idx,dir){
      var items=[]; try{ items=cfgList(group)||[]; }catch(e){}
      var j=idx+dir; if(j<0||j>=items.length) return;
      var a=items[idx], b=items[j], as=a.sort||0, bs=b.sort||0;
      var pending=2, done=function(){ pending--; if(pending<=0) acRenderChoiceLists(); };
      cfgSet(group,a.key,a.label,a.value||'',bs,function(){ done(); });
      cfgSet(group,b.key,b.label,b.value||'',as,function(){ done(); });
    }
