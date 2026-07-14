    // ============================================================
    // MARKETING COMMAND CENTER  (v1 — INTERNAL DB only)
    // Clones the Fundraiser Hub (fh*) overlay pattern. Namespace: mc* / mkt*.
    // Every mktRpc(name,...) maps to a function in marketing_command_center.sql.
    // External surfaces (Hootsuite/social/email/POS) are LINK + manual fields
    // only — NO external API calls here.
    // ============================================================
    var _mc = { tab:'dash', actor:null, dash:null, list:[], cur:null, requests:[],
                budgets:[], assets:[], calendar:[], filters:{}, settingsRows:null };

    // ---- credential-injecting RPC helper (mirrors fhRpc/wobRpc) ----
    function mktRpc(name, args, cb, onerr){
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

    // ---- overlay + shell chrome ----
    function mcOverlay(){ var o=document.getElementById('marketingModal'); if(!o){ o=document.createElement('div'); o.id='marketingModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100000;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function mcClose(){ var o=document.getElementById('marketingModal'); if(o) o.style.display='none'; var m=document.getElementById('mcModal2'); if(m) m.style.display='none'; }
    function mcCanOpen(){ return currentUser && (currentUser.is_developer===true || (typeof isManagerRole==='function'&&isManagerRole()) || ['Store Manager','Marketing Manager','Designer/Creative'].indexOf(currentUser.role)>=0); }
    function mcHeader(title,back){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:5;">'+(back?'<button onclick="'+back+'" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;">&lsaquo; Back</button>':'')+'<b style="flex:1;font-size:16px;">'+title+'</b><button onclick="mcClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">&times;</button></div>'; }
    function mcMoney(n){ var x=parseFloat(n||0); if(isNaN(x)) x=0; return '$'+Math.round(x).toLocaleString(); }
    function mcDate(d){ if(!d) return ''; try{ return new Date(d+ (String(d).length<=10?'T00:00:00':'')).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }catch(e){ return String(d).slice(0,10); } }
    function mcVal(id){ var e=document.getElementById(id); return e?String(e.value).trim():''; }
    function mcLoading(){ mcOverlay().innerHTML=mcHeader('Marketing Command Center','')+'<div style="text-align:center;padding:50px;color:#6b7686;">Loading&hellip;</div>'; }
    function mcPanel(title,body){ return '<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:14px;margin-bottom:12px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">'+title+'</div>'+body+'</div>'; }
    function mcRow(k,v){ return '<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;font-size:12.5px;"><span style="color:#6b6275;">'+k+'</span><span style="color:#26242b;text-align:right;">'+(v==null||v===''?'&mdash;':escapeHtml(String(v)))+'</span></div>'; }
    function mcField(label,id,val,type){ return '<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">'+label+'</label><input id="'+id+'" type="'+(type||'text')+'" value="'+(val==null?'':escapeHtml(String(val)))+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'; }
    function mcArea(label,id,val){ return '<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">'+label+'</label><textarea id="'+id+'" rows="3" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+(val==null?'':escapeHtml(String(val)))+'</textarea>'; }
    function mcSelV(label,id,opts,val){ return '<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">'+label+'</label><select id="'+id+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+(opts||[]).map(function(o){ return '<option'+(o===val?' selected':'')+'>'+escapeHtml(o)+'</option>'; }).join('')+'</select>'; }
    function mcModal(html){ var m=document.getElementById('mcModal2'); if(!m){ m=document.createElement('div'); m.id='mcModal2'; m.style.cssText='position:fixed;inset:0;background:rgba(20,20,30,.5);z-index:100002;display:flex;align-items:center;justify-content:center;padding:16px;'; document.body.appendChild(m); } m.innerHTML='<div style="background:#fff;border-radius:16px;max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:18px;">'+html+'</div>'; m.style.display='flex'; }
    function mcModalClose(){ var m=document.getElementById('mcModal2'); if(m) m.style.display='none'; }
    function mcPill(s){ var map={'Idea':'#8a8594','Brief':'#185FA5','Budget Pending':'#9a5b00','Approved':'#1b7a3d','In Design':'#7d1d4b','Scheduled':'#185FA5','Live':'#1b7a3d','Wrap-Up':'#9a5b00','Complete':'#5b6675','Submitted':'#185FA5','In Review':'#9a5b00','Declined':'#c0264b','Converted':'#1b7a3d','Pending':'#9a5b00','Draft':'#8a8594','Cancelled':'#c0264b','Archived':'#8a8594'}; var c=map[s]||'#8a8594'; return '<span style="background:'+c+'22;color:'+c+';font-size:10.5px;font-weight:800;padding:2px 9px;border-radius:99px;">'+escapeHtml(s||'')+'</span>'; }
    function mcStoreOpts(sel){ var stores=(HUB_STORES||[]).slice(); var extras=['Companywide','Multiple / Companywide','Warehouse']; return '<option value=""'+(sel?'':' selected')+'>Select store&hellip;</option>'+stores.concat(extras).map(function(s){ return '<option'+(s===sel?' selected':'')+'>'+escapeHtml(s)+'</option>'; }).join(''); }

    // ---- config (reuse app_settings groups; fall back to sensible defaults) ----
    function mcCfg(group, fallback){
      var rows=_mc.settingsRows||[]; var vals=rows.filter(function(r){ return r.group===group; }).map(function(r){ return r.label || r.value; }).filter(Boolean);
      return vals.length ? vals : fallback;
    }
    var MC_DEF = {
      types:['Seasonal Promotion','Product Launch','Limited-Time Offer','Community Event','Fundraiser Support','Grand Opening','Loyalty / App','Brand Awareness','Holiday','Other'],
      statuses:['Idea','Brief','Budget Pending','Approved','In Design','Scheduled','Live','Wrap-Up','Complete'],
      channels:['In-store Signage','Social - Instagram','Social - Facebook','Social - TikTok','Email','SMS','Website','Radio','Print','Outdoor','POS / Menu','Local Partner'],
      budgetCats:['Print / Signage','Paid Social','Paid Search','Radio / TV','Influencer','Giveaways / Swag','Event','Design / Creative','Other'],
      assetCats:['Logo','Photo','Video','Graphic','Flyer','Menu','Social Post','Template','Brand Guide','Other']
    };

    // ---- ENTRY POINT (role-gated) ----
    function openMarketing(){
      if(!mcCanOpen()){ alert('The Marketing Command Center is for marketing and leadership.'); return; }
      _mc.tab='dash'; mcLoading();
      mktRpc('app_settings_get',{p_group:null},function(rows){ _mc.settingsRows=rows||[]; mcLoadActor(); }, function(){ _mc.settingsRows=[]; mcLoadActor(); });
    }
    function mcLoadActor(){ mktRpc('mkt_actor',{},function(a){ _mc.actor=a; mcLoadDash(); }); }

    // ---- tab bar + shell ----
    function mcTabs(){
      var t=_mc.tab; var a=_mc.actor||{};
      function b(id,lbl){ return '<button onclick="mcTab(\''+id+'\')" style="flex:1;min-width:86px;background:'+(t===id?'#185FA5':'#eef0f3')+';color:'+(t===id?'#fff':'#5b6472')+';border:none;padding:10px 6px;font-size:12.5px;font-weight:700;cursor:pointer;border-radius:9px;">'+lbl+'</button>'; }
      var h='<div style="display:flex;flex-wrap:wrap;gap:6px;max-width:1040px;margin:12px auto 0;padding:0 16px;">';
      h+=b('dash','Dashboard')+b('campaigns','Campaigns')+b('calendar','Calendar')+b('tasks','Task Board')+b('requests','Requests');
      if(a.can_budget) h+=b('budgets','Budgets');
      h+=b('assets','Assets')+b('results','Results')+b('profiles','Store Profiles');
      if(a.is_leader) h+=b('audit','Audit');
      /* Merged 2026-07-13: Store Tools (marketing v2) is reached from inside the one
         Marketing Command Center door instead of its own menu tile. */
      h+='<button onclick="if(typeof openMarketingV2===\'function\')openMarketingV2()" style="flex:1;min-width:86px;background:#c0264b;color:#fff;border:none;padding:10px 6px;font-size:12.5px;font-weight:700;cursor:pointer;border-radius:9px;">&#127978; Store Tools</button>';
      h+='</div>'; return h;
    }
    function mcTab(t){ _mc.tab=t;
      if(t==='dash') mcLoadDash(); else if(t==='campaigns') mcLoadList(); else if(t==='calendar') mcLoadCalendar();
      else if(t==='tasks') mcRenderTasks(); else if(t==='requests') mcLoadRequests(); else if(t==='budgets') mcLoadBudgets();
      else if(t==='assets') mcLoadAssets(); else if(t==='results') mcLoadResults(); else if(t==='profiles') mcRenderProfiles();
      else if(t==='audit') mcLoadAudit();
    }
    function mcShell(body){ mcOverlay().innerHTML=mcHeader('Marketing Command Center','')+mcTabs()+'<div style="max-width:1040px;margin:0 auto;padding:14px 16px 60px;">'+body+'</div>'; }

    // ======================= DASHBOARD =======================
    function mcLoadDash(){ mcLoading(); mktRpc('mkt_dashboard',{},function(d){ _mc.dash=d; if(d&&d.actor) _mc.actor=d.actor; mcRenderDash(d); }); }
    function mcRenderDash(d){
      var a=_mc.actor||{};
      function card(lbl,val,col){ return '<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px;text-align:center;"><div style="font-size:23px;font-weight:800;color:'+(col||'#1f2a44')+';">'+(val==null?0:val)+'</div><div style="font-size:11px;color:#6b6275;">'+lbl+'</div></div>'; }
      var by=d.by_status||{}; function cnt(s){ return by[s]||0; }
      var h='<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">';
      h+='<button onclick="mcNew()" style="background:#185FA5;color:#fff;border:none;border-radius:10px;padding:11px 16px;font-weight:800;cursor:pointer;">&#10133; New campaign</button>';
      h+='<button onclick="mcTab(\'requests\')" style="background:#1f7a3d;color:#fff;border:none;border-radius:10px;padding:11px 16px;font-weight:700;cursor:pointer;">&#128227; Requests ('+(d.requests_open||0)+')</button></div>';
      h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin-bottom:14px;">'
        +card('Ideas',cnt('Idea'),'#8a8594')+card('In brief',cnt('Brief'),'#185FA5')+card('Budget pending',(d.budgets_pending||0),'#9a5b00')
        +card('Approved',cnt('Approved'),'#1b7a3d')+card('Scheduled',cnt('Scheduled'),'#185FA5')+card('Live now',(d.live_now||[]).length,'#1b7a3d')
        +card('Assets to review',(d.assets_review||0),'#7d1d4b')+'</div>';
      // upcoming launches
      var up=d.upcoming||[]; h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:14px;margin-bottom:12px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Launching in the next 30 days</div>';
      if(!up.length) h+='<div style="color:#6b6275;font-size:13px;">Nothing scheduled to launch yet.</div>';
      up.forEach(function(x){ h+='<div onclick="mcOpen(\''+x.id+'\')" style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid #f0eef4;border-radius:9px;margin-bottom:6px;cursor:pointer;">'+mcPill(x.status)+'<b style="flex:1;font-size:13px;">'+escapeHtml(x.name||'')+'</b><span style="font-size:12px;color:#6b6275;">'+mcDate(x.launch_date)+'</span></div>'; });
      h+='</div>';
      // results due
      var rd=d.results_due||[]; if(rd.length){ h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:14px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#9a5b00;margin-bottom:8px;">Results still needed</div>';
        rd.forEach(function(x){ h+='<div onclick="mcOpen(\''+x.id+'\')" style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid #f7efe0;border-radius:9px;margin-bottom:6px;cursor:pointer;"><span style="background:#fff4e0;color:#9a5b00;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px;">Results due</span><b style="flex:1;font-size:13px;">'+escapeHtml(x.name||'')+'</b><span style="font-size:12px;color:#6b6275;">'+mcDate(x.results_due)+'</span></div>'; });
        h+='</div>'; }
      mcShell(h);
    }

    // ======================= CAMPAIGNS =======================
    function mcLoadList(){ mcLoading(); mktRpc('mkt_campaign_list',{p_filters:_mc.filters||{}},function(d){ _mc.list=d||[]; mcRenderList(); }); }
    function mcApplyFilters(){ _mc.filters={ q:mcVal('mcq'), status:mcVal('mcfs'), type:mcVal('mcft') }; mcLoadList(); }
    function mcRenderList(){
      var f=_mc.filters||{};
      var h='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:end;">';
      h+='<div style="flex:1;min-width:150px;"><label style="font-size:12px;color:#6b7686;">Search</label><input id="mcq" value="'+escapeHtml(f.q||'')+'" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;"></div>';
      h+='<div><label style="font-size:12px;color:#6b7686;">Status</label>'+mcSelV('','mcfs',[''].concat(mcCfg('mkt_statuses',MC_DEF.statuses)),f.status||'').replace('margin:8px 0 3px;','margin:0 0 0;')+'</div>';
      h+='<div><label style="font-size:12px;color:#6b7686;">Type</label>'+mcSelV('','mcft',[''].concat(mcCfg('mkt_campaign_types',MC_DEF.types)),f.type||'').replace('margin:8px 0 3px;','margin:0 0 0;')+'</div>';
      h+='<button onclick="mcApplyFilters()" style="background:#185FA5;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;">Filter</button>';
      h+='<button onclick="mcNew()" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;">&#10133; New</button></div>';
      var list=_mc.list||[];
      if(!list.length) h+='<div style="color:#6b6275;font-size:13px;padding:20px;text-align:center;">No campaigns yet. Create the first one.</div>';
      list.forEach(function(c){
        var stores=(c.stores&&c.stores.length)?c.stores.join(', '):'';
        h+='<div onclick="mcOpen(\''+c.id+'\')" style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px;margin-bottom:9px;cursor:pointer;">'
          +'<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14px;">'+escapeHtml(c.name||'')+'</b>'+mcPill(c.status)+'</div>'
          +'<div style="font-size:12px;color:#6b6275;margin-top:5px;">'+escapeHtml(c.type||'')+(c.season?' &middot; '+escapeHtml(c.season):'')+(stores?' &middot; '+escapeHtml(stores):'')+'</div>'
          +'<div style="font-size:12px;color:#6b6275;margin-top:3px;">Launch '+ (c.launch_date?mcDate(c.launch_date):'TBD') +(c.budget_requested?' &middot; Budget '+mcMoney(c.budget_requested):'')+'</div></div>';
      });
      mcShell(h);
    }
    function mcNew(){
      var types=mcCfg('mkt_campaign_types',MC_DEF.types);
      var h='<h3 style="margin:0 0 10px;">New campaign</h3>'
        +mcField('Name','mcn_name','')
        +mcSelV('Type','mcn_type',types,types[0])
        +mcSelV('Season','mcn_season',['','Spring','Summer','Fall','Winter','Holiday','Year-round'],'')
        +'<div style="display:flex;gap:8px;"><div style="flex:1;">'+mcSelV('Quarter','mcn_qtr',['','Q1','Q2','Q3','Q4'],'')+'</div><div style="flex:1;">'+mcField('Year','mcn_year',new Date().getFullYear(),'number')+'</div></div>'
        +'<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">Primary store</label><select id="mcn_store" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+mcStoreOpts('')+'</select>'
        +mcArea('Goal','mcn_goal','')
        +mcField('Launch date','mcn_launch','','date')
        +'<div id="mcnMsg" style="color:#c0264b;font-size:12.5px;margin-top:6px;"></div>'
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="mcModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="mcCreate()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Create</button></div>';
      mcModal(h);
    }
    function mcCreate(){
      if(!mcVal('mcn_name')){ document.getElementById('mcnMsg').textContent='Name is required.'; return; }
      var store=mcVal('mcn_store'); var payload={ name:mcVal('mcn_name'), type:mcVal('mcn_type'), season:mcVal('mcn_season'), quarter:mcVal('mcn_qtr'), year:mcVal('mcn_year'), goal:mcVal('mcn_goal'), launch_date:mcVal('mcn_launch'), stores: store?[store]:[] };
      mktRpc('mkt_campaign_save',{p_payload:payload},function(r){ mcModalClose(); mcOpen(r.id); });
    }
    function mcOpen(id){ mcLoading(); mktRpc('mkt_campaign_get',{p_id:id},function(d){ _mc.cur=d; mcRenderRecord(); }); }
    function mcRenderRecord(){
      var c=_mc.cur; if(!c) return; var a=_mc.actor||{};
      var body='<div style="max-width:1040px;margin:0 auto;padding:14px 16px 60px;">';
      body+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><b style="flex:1;font-size:18px;">'+escapeHtml(c.name||'')+'</b>'+mcPill(c.status)+'</div>';
      // status advance
      var statuses=mcCfg('mkt_statuses',MC_DEF.statuses);
      body+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">'
        +'<button onclick="mcEdit()" style="background:#185FA5;color:#fff;border:none;border-radius:9px;padding:9px 13px;font-weight:700;cursor:pointer;">Edit plan</button>'
        +'<button onclick="mcStatusPicker()" style="background:#eef3fb;color:#185FA5;border:none;border-radius:9px;padding:9px 13px;font-weight:700;cursor:pointer;">Change status</button>'
        +'<button onclick="mcChannels()" style="background:#eef3fb;color:#185FA5;border:none;border-radius:9px;padding:9px 13px;font-weight:700;cursor:pointer;">Channels</button>'
        +(a.can_budget?'<button onclick="mcBudgetNew(\''+c.id+'\')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:9px;padding:9px 13px;font-weight:700;cursor:pointer;">Add budget line</button>':'')
        +'<button onclick="mcContentNew(\''+c.id+'\')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:9px;padding:9px 13px;font-weight:700;cursor:pointer;">Add content post</button>'
        +'<button onclick="mcAddTaskFor(\''+c.id+'\')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:9px;padding:9px 13px;font-weight:700;cursor:pointer;">Add task</button></div>';
      // details grid
      body+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
      body+=mcPanel('Plan', mcRow('Type',c.type)+mcRow('Season',c.season)+mcRow('Quarter/Year',(c.quarter||'')+' '+(c.year||''))+mcRow('Owner',c.owner_name)+mcRow('Stores',(c.stores&&c.stores.length)?c.stores.join(', '):'')+mcRow('Audience',c.audience)+mcRow('Goal',c.goal));
      body+=mcPanel('Timeline', mcRow('Plan start',c.plan_start&&mcDate(c.plan_start))+mcRow('Creative due',c.creative_due&&mcDate(c.creative_due))+mcRow('Materials due',c.material_deadline&&mcDate(c.material_deadline))+mcRow('Launch',c.launch_date&&mcDate(c.launch_date))+mcRow('Ends',c.end_date&&mcDate(c.end_date))+mcRow('Results due',c.results_due&&mcDate(c.results_due)));
      body+='</div>';
      // channels
      var ch=(c.channels||[]); body+=mcPanel('Channels', ch.length?ch.map(function(x){ return '<span style="display:inline-block;background:#eef3fb;color:#185FA5;font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:99px;margin:2px;">'+escapeHtml(x)+'</span>'; }).join(''):'<span style="color:#6b6275;font-size:12.5px;">No channels selected.</span>');
      // budgets (leaders only)
      if(a.can_budget){ var bs=(c.budgets||[]); var bh=''; if(!bs.length) bh='<span style="color:#6b6275;font-size:12.5px;">No budget lines.</span>';
        bs.forEach(function(b){ bh+='<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f2f2f6;font-size:12.5px;"><b style="flex:1;">'+escapeHtml(b.title||'')+'</b><span style="color:#6b6275;">'+mcMoney(b.est_cost)+'</span>'+mcPill(b.status)+(b.status==='Pending'?'<button onclick="mcBudgetDecide(\''+b.id+'\',\''+c.id+'\')" style="background:#1f7a3d;color:#fff;border:none;border-radius:7px;padding:5px 9px;font-size:11.5px;font-weight:700;cursor:pointer;">Decide</button>':'')+'</div>'; });
        body+=mcPanel('Budget lines', bh); }
      // content posts
      var cps=(c.content||[]); var cph=''; if(!cps.length) cph='<span style="color:#6b6275;font-size:12.5px;">No content posts.</span>';
      cps.forEach(function(p){ cph+='<div style="padding:6px 0;border-bottom:1px solid #f2f2f6;font-size:12.5px;"><div style="display:flex;gap:8px;"><b style="flex:1;">'+escapeHtml(p.platform||'Post')+(p.content_type?' — '+escapeHtml(p.content_type):'')+'</b><span style="color:#6b6275;">'+(p.scheduled_date?mcDate(p.scheduled_date):'')+'</span>'+mcPill(p.approval_status||p.status)+'</div>'+(p.hootsuite_ref?'<div style="color:#185FA5;font-size:11.5px;word-break:break-all;">'+escapeHtml(p.hootsuite_ref)+'</div>':'')+'</div>'; });
      body+=mcPanel('Content posts (link + manual metrics)', cph);
      // results
      body+=mcPanel('Results', mcRow('Budget approved',c.budget_approved!=null?mcMoney(c.budget_approved):'')+mcRow('Actual spend',c.actual_spend!=null?mcMoney(c.actual_spend):'')+mcRow('Summary',c.results_summary)+mcRow('Lessons',c.lessons)+'<button onclick="mcResultsEdit(\''+c.id+'\')" style="margin-top:8px;background:#185FA5;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;">Record results</button>');
      body+='</div>';
      mcOverlay().innerHTML=mcHeader('Campaign','mcTab(\'campaigns\')')+body;
    }
    function mcEdit(){
      var c=_mc.cur; var types=mcCfg('mkt_campaign_types',MC_DEF.types);
      var h='<h3 style="margin:0 0 10px;">Edit campaign plan</h3>'
        +mcField('Name','mce_name',c.name)
        +mcSelV('Type','mce_type',types,c.type)
        +mcField('Audience','mce_aud',c.audience)
        +mcArea('Goal','mce_goal',c.goal)
        +mcArea('What success looks like','mce_succ',c.success_def)
        +'<div style="display:flex;gap:8px;"><div style="flex:1;">'+mcField('Plan start','mce_ps',c.plan_start,'date')+'</div><div style="flex:1;">'+mcField('Creative due','mce_cd',c.creative_due,'date')+'</div></div>'
        +'<div style="display:flex;gap:8px;"><div style="flex:1;">'+mcField('Materials due','mce_md',c.material_deadline,'date')+'</div><div style="flex:1;">'+mcField('Launch','mce_ld',c.launch_date,'date')+'</div></div>'
        +'<div style="display:flex;gap:8px;"><div style="flex:1;">'+mcField('End','mce_ed',c.end_date,'date')+'</div><div style="flex:1;">'+mcField('Results due','mce_rd',c.results_due,'date')+'</div></div>'
        +mcField('Budget requested ($)','mce_bud',c.budget_requested,'number')
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="mcModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="mcSaveEdit()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Save</button></div>';
      mcModal(h);
    }
    function mcSaveEdit(){
      var p={ id:_mc.cur.id, name:mcVal('mce_name'), type:mcVal('mce_type'), audience:mcVal('mce_aud'), goal:mcVal('mce_goal'), success_def:mcVal('mce_succ'),
        plan_start:mcVal('mce_ps'), creative_due:mcVal('mce_cd'), material_deadline:mcVal('mce_md'), launch_date:mcVal('mce_ld'), end_date:mcVal('mce_ed'), results_due:mcVal('mce_rd'), budget_requested:mcVal('mce_bud') };
      mktRpc('mkt_campaign_save',{p_payload:p},function(){ mcModalClose(); mcOpen(_mc.cur.id); });
    }
    function mcStatusPicker(){
      var statuses=mcCfg('mkt_statuses',MC_DEF.statuses).concat(['Cancelled','Archived']);
      var h='<h3 style="margin:0 0 10px;">Change status</h3>'+mcSelV('Status','mcsp',statuses,_mc.cur.status)
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="mcModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="mcApplyStatus()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Apply</button></div>';
      mcModal(h);
    }
    function mcApplyStatus(){ var s=document.getElementById('mcsp').value; mcModalClose(); mktRpc('mkt_campaign_set_status',{p_id:_mc.cur.id,p_status:s},function(){ mcOpen(_mc.cur.id); }); }
    function mcChannels(){
      var chosen=(_mc.cur.channels||[]); var all=mcCfg('mkt_channels',MC_DEF.channels);
      var h='<h3 style="margin:0 0 10px;">Channels</h3><div style="max-height:300px;overflow:auto;">'+all.map(function(ch,i){ return '<label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;"><input type="checkbox" id="mcch'+i+'" '+(chosen.indexOf(ch)>=0?'checked':'')+'> '+escapeHtml(ch)+'</label>'; }).join('')+'</div>'
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="mcModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="mcSaveChannels()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Save</button></div>';
      mcModal(h); _mc._chanOpts=all;
    }
    function mcSaveChannels(){ var all=_mc._chanOpts||[]; var picked=[]; all.forEach(function(ch,i){ var el=document.getElementById('mcch'+i); if(el&&el.checked) picked.push(ch); }); mktRpc('mkt_channels_set',{p_campaign_id:_mc.cur.id,p_channels:picked},function(){ mcModalClose(); mcOpen(_mc.cur.id); }); }
    function mcResultsEdit(id){
      var c=_mc.cur;
      var h='<h3 style="margin:0 0 10px;">Record results</h3>'+mcField('Actual spend ($)','mcr_spend',c.actual_spend,'number')+mcArea('Results summary','mcr_sum',c.results_summary)+mcArea('Lessons learned','mcr_les',c.lessons)
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="mcModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="mcResultsSave(\''+id+'\')" style="flex:2;background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Save</button></div>';
      mcModal(h);
    }
    function mcResultsSave(id){ mktRpc('mkt_results_save',{p_campaign_id:id,p_payload:{ actual_spend:mcVal('mcr_spend'), results_summary:mcVal('mcr_sum'), lessons:mcVal('mcr_les') }},function(){ mcModalClose(); mcOpen(id); }); }

    // ---- content posts (link + manual metrics; NO external API) ----
    function mcContentNew(cid){
      var h='<h3 style="margin:0 0 10px;">Add content post</h3>'
        +mcSelV('Platform','mcc_plat',['Instagram','Facebook','TikTok','Email','SMS','Website','In-store','Other'],'Instagram')
        +mcField('Content type','mcc_type','')
        +mcArea('Caption / copy','mcc_cap','')
        +mcField('Scheduled date','mcc_sch','','date')
        +mcField('Hootsuite / post link (manual)','mcc_hoot','')
        +'<div style="font-size:11.5px;color:#6b6275;margin-top:4px;">v1 is link + manual — no auto-posting. Reach/engagement numbers are entered by hand or imported later.</div>'
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="mcModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="mcContentSave(\''+cid+'\')" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Add</button></div>';
      mcModal(h);
    }
    function mcContentSave(cid){ mktRpc('mkt_content_save',{p_payload:{ campaign_id:cid, platform:mcVal('mcc_plat'), content_type:mcVal('mcc_type'), caption:mcVal('mcc_cap'), scheduled_date:mcVal('mcc_sch'), hootsuite_ref:mcVal('mcc_hoot') }},function(){ mcModalClose(); mcOpen(cid); }); }

    // ======================= CALENDAR =======================
    function mcLoadCalendar(){ mcLoading(); mktRpc('mkt_calendar',{p_from:null,p_to:null},function(d){ _mc.calendar=d||[]; mcRenderCalendar(); }); }
    function mcRenderCalendar(){
      var items=(_mc.calendar||[]).filter(function(x){ return x&&x.date; }).sort(function(a,b){ return a.date<b.date?-1:1; });
      var kindCol={launch:'#1b7a3d',creative:'#7d1d4b',material:'#9a5b00',results:'#185FA5',content:'#5b6675'};
      var h='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:10px;">Marketing calendar — all dated milestones</div>';
      if(!items.length) h+='<div style="color:#6b6275;font-size:13px;padding:20px;text-align:center;">Nothing on the calendar yet.</div>';
      var lastMonth='';
      items.forEach(function(x){
        var mo=''; try{ mo=new Date(x.date+'T00:00:00').toLocaleDateString(undefined,{month:'long',year:'numeric'}); }catch(e){ mo=String(x.date).slice(0,7); }
        if(mo!==lastMonth){ h+='<div style="font-size:13px;font-weight:800;color:#1f2a44;margin:14px 0 6px;">'+escapeHtml(mo)+'</div>'; lastMonth=mo; }
        var col=kindCol[x.kind]||'#8a8594';
        h+='<div onclick="'+(x.id?'mcOpen(\''+x.id+'\')':'')+'" style="display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #ececf2;border-radius:10px;padding:10px;margin-bottom:6px;cursor:pointer;"><div style="width:52px;text-align:center;"><div style="font-size:17px;font-weight:800;color:'+col+';">'+String(new Date(x.date+'T00:00:00').getDate())+'</div></div><b style="flex:1;font-size:13px;">'+escapeHtml(x.label||'')+'</b><span style="background:'+col+'22;color:'+col+';font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;">'+escapeHtml(x.kind||'')+'</span></div>';
      });
      mcShell(h);
    }

    // ======================= TASK BOARD =======================
    // Marketing tasks use the SHARED task engine (app_task_create). This view
    // surfaces campaigns as work rows and lets you spin a store task off any.
    function mcRenderTasks(){
      var list=_mc.list||[];
      var h='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Task board</div>'
        +'<div style="font-size:12.5px;color:#6b6275;margin-bottom:12px;">Marketing tasks run through the Hub\'s shared task system so they show up on the assignee\'s Today list. Open a campaign to add tasks, or create a quick store task below.</div>'
        +'<button onclick="mcQuickTask()" style="background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px 14px;font-weight:700;cursor:pointer;margin-bottom:14px;">&#10133; New marketing task</button>';
      if(!list.length){ h+='<div style="color:#6b6275;font-size:13px;">Load the Campaigns tab first to see active campaigns here.</div>'; mcShell(h); mktRpc('mkt_campaign_list',{p_filters:{}},function(d){ _mc.list=d||[]; mcRenderTasks(); }); return; }
      list.forEach(function(c){ h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:11px;padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13px;">'+escapeHtml(c.name||'')+'</b>'+mcPill(c.status)+'<button onclick="mcAddTaskFor(\''+c.id+'\')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:7px 11px;font-size:12px;font-weight:700;cursor:pointer;">Add task</button></div>'; });
      mcShell(h);
    }
    function mcQuickTask(){
      var h='<h3 style="margin:0 0 10px;">New marketing task</h3>'+mcField('Task','mct_title','')+mcArea('Details','mct_det','')+mcField('Due date','mct_due','','date')
        +'<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">Target store</label><select id="mct_store" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+mcStoreOpts('')+'</select>'
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="mcModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="mcSaveQuickTask()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Create task</button></div>';
      mcModal(h);
    }
    function mcSaveQuickTask(){
      if(!mcVal('mct_title')){ alert('Task title required'); return; }
      var store=mcVal('mct_store');
      mktRpc('app_task_create',{ p_title:'Marketing: '+mcVal('mct_title'), p_details:mcVal('mct_det'), p_due:mcVal('mct_due')||null, p_target_type:'store', p_target_value:store||null, p_employee_ids:null, p_completion_mode:'store' },function(){ mcModalClose(); alert('Task created.'); });
    }
    function mcAddTaskFor(cid){
      // convenience: reuse the quick-task modal, prefilling nothing but keeping the campaign context in the title
      var name=''; (_mc.cur&&_mc.cur.id===cid&&(name=_mc.cur.name)); (_mc.list||[]).forEach(function(c){ if(c.id===cid) name=c.name; });
      var h='<h3 style="margin:0 0 10px;">Add task'+(name?' — '+escapeHtml(name):'')+'</h3>'+mcField('Task','mct_title','')+mcArea('Details','mct_det','')+mcField('Due date','mct_due','','date')
        +'<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">Target store</label><select id="mct_store" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+mcStoreOpts('')+'</select>'
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="mcModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="mcSaveTaskFor(\''+(name?escapeHtml(name).replace(/\x27/g,""):'')+'\')" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Create task</button></div>';
      mcModal(h);
    }
    function mcSaveTaskFor(name){
      if(!mcVal('mct_title')){ alert('Task title required'); return; }
      var store=mcVal('mct_store'); var title='Marketing'+(name?' ('+name+')':'')+': '+mcVal('mct_title');
      mktRpc('app_task_create',{ p_title:title, p_details:mcVal('mct_det'), p_due:mcVal('mct_due')||null, p_target_type:'store', p_target_value:store||null, p_employee_ids:null, p_completion_mode:'store' },function(){ mcModalClose(); alert('Task created.'); });
    }

    // ======================= REQUESTS =======================
    function mcLoadRequests(){ mcLoading(); mktRpc('mkt_request_list',{p_filters:{}},function(d){ _mc.requests=d||[]; mcRenderRequests(); }); }
    function mcRenderRequests(){
      var a=_mc.actor||{}; var list=_mc.requests||[];
      var h='<div style="display:flex;gap:8px;margin-bottom:12px;"><button onclick="mcRequestNew()" style="background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px 14px;font-weight:700;cursor:pointer;">&#10133; Submit request</button></div>';
      if(!list.length) h+='<div style="color:#6b6275;font-size:13px;padding:16px;text-align:center;">No requests yet.</div>';
      list.forEach(function(r){
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px;margin-bottom:9px;">'
          +'<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14px;">'+escapeHtml(r.title||'')+'</b>'+mcPill(r.status)+'</div>'
          +'<div style="font-size:12px;color:#6b6275;margin-top:5px;">'+escapeHtml(r.location||'')+(r.req_type?' &middot; '+escapeHtml(r.req_type):'')+' &middot; by '+escapeHtml(r.requested_by_name||'')+(r.needed_by?' &middot; needed '+mcDate(r.needed_by):'')+'</div>';
        if(a.is_mgr && (r.status==='Submitted'||r.status==='In Review')){
          h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px;">'
            +'<button onclick="mcReqStatus(\''+r.id+'\',\'In Review\')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">Review</button>'
            +'<button onclick="mcReqConvert(\''+r.id+'\',\'campaign\')" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">&rarr; Campaign</button>'
            +'<button onclick="mcReqConvert(\''+r.id+'\',\'task\')" style="background:#185FA5;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">&rarr; Task</button>'
            +'<button onclick="mcReqDecline(\''+r.id+'\')" style="background:#fdeee8;color:#c0264b;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">Decline</button></div>';
        }
        if(r.converted_campaign_id) h+='<div style="margin-top:6px;"><button onclick="mcOpen(\''+r.converted_campaign_id+'\')" style="background:none;border:none;color:#185FA5;font-size:12px;font-weight:700;cursor:pointer;padding:0;">Open converted campaign &rarr;</button></div>';
        h+='</div>';
      });
      mcShell(h);
    }
    function mcRequestNew(){
      var types=['Signage / Print','Social Post','Event Support','Local Sponsorship','Promotion / LTO','Grand Opening','Other'];
      var h='<h3 style="margin:0 0 10px;">Submit a marketing request</h3>'
        +mcField('What do you need?','mrq_title','')
        +mcSelV('Type','mrq_type',types,types[0])
        +'<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">Store</label><select id="mrq_store" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+mcStoreOpts(currentUser&&currentUser.store)+'</select>'
        +'<div style="display:flex;gap:8px;"><div style="flex:1;">'+mcField('Needed by','mrq_needed','','date')+'</div><div style="flex:1;">'+mcField('Event date','mrq_event','','date')+'</div></div>'
        +mcArea('Details','mrq_desc','')
        +mcField('Goal','mrq_goal','')
        +mcField('Estimated cost ($)','mrq_cost','','number')
        +'<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;margin-top:8px;"><input type="checkbox" id="mrq_appr"> Needs budget approval</label>'
        +'<div id="mrqMsg" style="color:#c0264b;font-size:12.5px;margin-top:6px;"></div>'
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="mcModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="mcRequestSubmit()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Submit</button></div>';
      mcModal(h);
    }
    function mcRequestSubmit(){
      if(!mcVal('mrq_title')){ document.getElementById('mrqMsg').textContent='Please describe what you need.'; return; }
      var appr=document.getElementById('mrq_appr'); var store=mcVal('mrq_store');
      mktRpc('mkt_request_submit',{p_payload:{ title:mcVal('mrq_title'), req_type:mcVal('mrq_type'), location:(store&&store.indexOf('Select')<0)?store:'', needed_by:mcVal('mrq_needed'), event_date:mcVal('mrq_event'), description:mcVal('mrq_desc'), goal:mcVal('mrq_goal'), est_cost:mcVal('mrq_cost'), approval_needed:!!(appr&&appr.checked) }},function(){ mcModalClose(); mcLoadRequests(); });
    }
    function mcReqStatus(id,s){ mktRpc('mkt_request_set_status',{p_id:id,p_status:s,p_reason:''},function(){ mcLoadRequests(); }); }
    function mcReqDecline(id){ var r=prompt('Reason for declining (shown to the requester):'); if(r===null) return; mktRpc('mkt_request_set_status',{p_id:id,p_status:'Declined',p_reason:r},function(){ mcLoadRequests(); }); }
    function mcReqConvert(id,to){ if(!confirm('Convert this request to a '+to+'?')) return; mktRpc('mkt_request_convert',{p_id:id,p_to:to},function(r){ if(to==='campaign'&&r&&r.campaign_id){ mcOpen(r.campaign_id); } else { alert('Converted to a store task.'); mcLoadRequests(); } }); }

    // ======================= BUDGETS =======================
    function mcLoadBudgets(){ mcLoading(); mktRpc('mkt_budget_list',{p_filters:{}},function(d){ _mc.budgets=d||[]; mcRenderBudgets(); }, function(e){ mcShell('<div style="color:#c0264b;padding:20px;">'+escapeHtml(String(e.message||'Not available'))+'</div>'); }); }
    function mcRenderBudgets(){
      var list=_mc.budgets||[];
      var h='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:10px;">Budget lines &amp; approvals</div>'
        +'<div style="font-size:12px;color:#6b6275;margin-bottom:12px;">Separation of duties: you cannot approve a line you requested. Thresholds are configurable in Admin settings.</div>';
      if(!list.length) h+='<div style="color:#6b6275;font-size:13px;padding:16px;text-align:center;">No budget lines yet. Add them from a campaign.</div>';
      list.forEach(function(b){
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px;margin-bottom:9px;"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13.5px;">'+escapeHtml(b.title||'')+'</b>'+mcPill(b.status)+'</div>'
          +'<div style="font-size:12px;color:#6b6275;margin-top:5px;">'+escapeHtml(b.campaign_name||'—')+(b.category?' &middot; '+escapeHtml(b.category):'')+' &middot; est '+mcMoney(b.est_cost)+(b.approved_amount!=null?' &middot; approved '+mcMoney(b.approved_amount):'')+'</div>'
          +'<div style="font-size:11.5px;color:#8a8594;margin-top:3px;">Requested by '+escapeHtml(b.requested_by_name||'')+(b.approved_by_name?' &middot; decided by '+escapeHtml(b.approved_by_name):'')+'</div>'
          +(b.status==='Pending'?'<div style="margin-top:8px;"><button onclick="mcBudgetDecide(\''+b.id+'\',\''+(b.campaign_id||'')+'\')" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;">Approve / decline</button></div>':'')
          +'</div>';
      });
      mcShell(h);
    }
    function mcBudgetNew(cid){
      var cats=mcCfg('mkt_budget_cats',MC_DEF.budgetCats);
      var h='<h3 style="margin:0 0 10px;">Add budget line</h3>'+mcField('Title','mbg_title','')+mcSelV('Category','mbg_cat',cats,cats[0])+mcField('Estimated cost ($)','mbg_est','','number')+mcField('Vendor (optional)','mbg_vendor','')+mcField('Invoice / quote link','mbg_inv','')+mcArea('Notes','mbg_notes','')
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="mcModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="mcBudgetSave(\''+cid+'\')" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Add</button></div>';
      mcModal(h);
    }
    function mcBudgetSave(cid){ if(!mcVal('mbg_title')){ alert('Title required'); return; } mktRpc('mkt_budget_save',{p_payload:{ campaign_id:cid, title:mcVal('mbg_title'), category:mcVal('mbg_cat'), est_cost:mcVal('mbg_est'), vendor:mcVal('mbg_vendor'), invoice_url:mcVal('mbg_inv'), notes:mcVal('mbg_notes') }},function(){ mcModalClose(); if(_mc.cur&&_mc.cur.id===cid) mcOpen(cid); else mcLoadBudgets(); }); }
    function mcBudgetDecide(id,cid){
      var h='<h3 style="margin:0 0 10px;">Budget decision</h3>'+mcSelV('Decision','mbd_dec',['Approved','Declined','Changes Requested'],'Approved')+mcField('Approved amount ($)','mbd_amt','','number')+mcArea('Note','mbd_note','')
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="mcModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="mcBudgetDecideSave(\''+id+'\',\''+(cid||'')+'\')" style="flex:2;background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Submit</button></div>';
      mcModal(h);
    }
    function mcBudgetDecideSave(id,cid){
      var amt=mcVal('mbd_amt'); mktRpc('mkt_budget_decide',{p_id:id,p_decision:mcVal('mbd_dec'),p_amount:amt?parseFloat(amt):null,p_note:mcVal('mbd_note')},function(){ mcModalClose(); if(_mc.cur&&_mc.cur.id===cid) mcOpen(cid); else mcLoadBudgets(); }); }

    // ======================= ASSETS =======================
    function mcLoadAssets(){ mcLoading(); mktRpc('mkt_asset_list',{p_filters:{}},function(d){ _mc.assets=d||[]; mcRenderAssets(); }); }
    function mcRenderAssets(){
      var a=_mc.actor||{}; var list=_mc.assets||[];
      var h='<div style="display:flex;gap:8px;margin-bottom:12px;"><button onclick="mcAssetNew()" style="background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px 14px;font-weight:700;cursor:pointer;">&#10133; Add asset link</button></div>'
        +'<div style="font-size:12px;color:#6b6275;margin-bottom:12px;">Assets are Dropbox/Drive links — the file lives there, the Hub tracks type, tags, and approval.</div>';
      if(!list.length) h+='<div style="color:#6b6275;font-size:13px;padding:16px;text-align:center;">No assets yet.</div>';
      list.forEach(function(x){
        var tags=(x.tags&&x.tags.length)?x.tags.join(', '):'';
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px;margin-bottom:9px;"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13.5px;">'+escapeHtml(x.title||'')+'</b>'+mcPill(x.status)+'</div>'
          +'<div style="font-size:12px;color:#6b6275;margin-top:4px;">'+escapeHtml(x.asset_type||'')+(tags?' &middot; '+escapeHtml(tags):'')+'</div>'
          +(x.file_url?'<div style="margin-top:6px;"><a href="'+escapeHtml(x.file_url)+'" target="_blank" rel="noopener" style="color:#185FA5;font-size:12.5px;font-weight:700;word-break:break-all;">Open file &rarr;</a></div>':'')
          +'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">'
          +(a.is_leader&&x.status!=='Approved'?'<button onclick="mcAssetStatus(\''+x.id+'\',\'Approved\')" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">Approve</button>':'')
          +(x.status!=='In Review'?'<button onclick="mcAssetStatus(\''+x.id+'\',\'In Review\')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">Send to review</button>':'')
          +(x.status!=='Archived'?'<button onclick="mcAssetStatus(\''+x.id+'\',\'Archived\')" style="background:#f2f2f6;color:#6b6275;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">Archive</button>':'')
          +'</div></div>';
      });
      mcShell(h);
    }
    function mcAssetNew(){
      var cats=mcCfg('mkt_asset_cats',MC_DEF.assetCats);
      var h='<h3 style="margin:0 0 10px;">Add asset link</h3>'+mcField('Title','mas_title','')+mcSelV('Type','mas_type',cats,cats[0])+mcField('Dropbox / Drive link','mas_url','')+mcField('Tags (comma separated)','mas_tags','')+mcArea('Usage notes','mas_notes','')
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="mcModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="mcAssetSave()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Add</button></div>';
      mcModal(h);
    }
    function mcAssetSave(){ if(!mcVal('mas_title')){ alert('Title required'); return; } var tags=mcVal('mas_tags').split(',').map(function(s){ return s.trim(); }).filter(Boolean); mktRpc('mkt_asset_save',{p_payload:{ title:mcVal('mas_title'), asset_type:mcVal('mas_type'), file_url:mcVal('mas_url'), tags:tags, usage_notes:mcVal('mas_notes') }},function(){ mcModalClose(); mcLoadAssets(); }); }
    function mcAssetStatus(id,s){ mktRpc('mkt_asset_set_status',{p_id:id,p_status:s},function(){ mcLoadAssets(); }); }

    // ======================= RESULTS =======================
    function mcLoadResults(){ mcLoading(); mktRpc('mkt_campaign_list',{p_filters:{}},function(d){ _mc.list=d||[]; mcRenderResults(); }); }
    function mcRenderResults(){
      var list=_mc.list||[];
      var h='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:10px;">Results &amp; scorecards</div>'
        +'<div style="font-size:12px;color:#6b6275;margin-bottom:12px;">Manual metrics now; live social/email/POS numbers import into the same tables later. Open a campaign to record results.</div>';
      if(!list.length) h+='<div style="color:#6b6275;font-size:13px;padding:16px;text-align:center;">No campaigns yet.</div>';
      list.forEach(function(c){ h+='<div onclick="mcOpen(\''+c.id+'\')" style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px;margin-bottom:9px;cursor:pointer;display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13.5px;">'+escapeHtml(c.name||'')+'</b>'+mcPill(c.status)+'<span style="font-size:12px;color:#6b6275;">'+(c.budget_approved!=null?mcMoney(c.budget_approved):'')+'</span></div>'; });
      mcShell(h);
    }

    // ======================= STORE PROFILES =======================
    function mcRenderProfiles(){
      var stores=(HUB_STORES||[]);
      var h='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:10px;">Store marketing profiles</div>'
        +'<div style="font-size:12px;color:#6b6275;margin-bottom:12px;">Local market notes, partners, sponsorship history, and best campaigns — one per store.</div>';
      if(!stores.length) h+='<div style="color:#6b6275;font-size:13px;">No stores configured.</div>';
      stores.forEach(function(s){ h+='<div onclick="mcProfileOpen(\''+escapeHtml(s).replace(/\x27/g,"")+'\')" style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13.5px;">'+escapeHtml(s)+'</b><span style="color:#185FA5;font-size:12px;font-weight:700;">Open &rarr;</span></div>'; });
      mcShell(h);
    }
    function mcProfileOpen(loc){ mktRpc('mkt_store_profile_get',{p_location:loc},function(d){ mcProfileEdit(d||{location:loc}); }); }
    function mcProfileEdit(p){
      var h='<h3 style="margin:0 0 10px;">'+escapeHtml(p.location||'')+' — marketing profile</h3>'
        +mcField('Market','mpf_market',p.market)
        +mcArea('Audience notes','mpf_aud',p.audience_notes)
        +mcArea('Sponsorship history','mpf_spon',p.sponsorship_history)
        +mcArea('Fundraiser history','mpf_fund',p.fundraiser_history)
        +mcArea('Best campaigns','mpf_best',p.best_campaigns)
        +mcArea('Active materials','mpf_mat',p.active_materials)
        +mcArea('Manager notes','mpf_notes',p.manager_notes)
        +'<div style="display:flex;gap:8px;margin-top:10px;"><button onclick="mcModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="mcProfileSave(\''+escapeHtml(p.location||'').replace(/\x27/g,"")+'\')" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Save</button></div>';
      mcModal(h);
    }
    function mcProfileSave(loc){ mktRpc('mkt_store_profile_save',{p_payload:{ location:loc, market:mcVal('mpf_market'), audience_notes:mcVal('mpf_aud'), sponsorship_history:mcVal('mpf_spon'), fundraiser_history:mcVal('mpf_fund'), best_campaigns:mcVal('mpf_best'), active_materials:mcVal('mpf_mat'), manager_notes:mcVal('mpf_notes') }},function(){ mcModalClose(); alert('Saved.'); }); }

    // ======================= AUDIT (leaders) =======================
    function mcLoadAudit(){ mcLoading(); mktRpc('mkt_audit',{p_entity:null,p_id:null},function(d){ mcRenderAudit(d||[]); }, function(e){ mcShell('<div style="color:#c0264b;padding:20px;">'+escapeHtml(String(e.message||'Not available'))+'</div>'); }); }
    function mcRenderAudit(list){
      var h='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:10px;">Marketing audit log</div>';
      if(!list.length) h+='<div style="color:#6b6275;font-size:13px;padding:16px;text-align:center;">No audit entries yet.</div>';
      list.forEach(function(x){ h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:10px;padding:10px 12px;margin-bottom:6px;font-size:12.5px;display:flex;gap:8px;align-items:center;"><span style="background:#eef3fb;color:#185FA5;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:99px;">'+escapeHtml(x.entity||'')+'</span><b style="flex:1;">'+escapeHtml(x.action||'')+'</b><span style="color:#6b6275;">'+escapeHtml(x.actor_name||'')+'</span><span style="color:#8a8594;font-size:11px;">'+mcDate(x.at)+'</span></div>'; });
      mcShell(h);
    }
