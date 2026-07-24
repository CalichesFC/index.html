// ============================================================
// CATERING & VENDING — MANAGER TOOLS  (js/37_cv_assets.js)
// GO_LIVE_20 C&V asset register · checklist template versioning · event-type
// taxonomy. Self-contained, append-only module: it edits NO other file. It
// injects three manager panels into the existing Catering/C&V screen
// (#cateringView) as a SIBLING just AFTER the #catBody content container, so
// catLoad()/cvRenderDashboard()'s repeated innerHTML rewrites of #catBody never
// clobber it. Screen entry is hooked by an append-only wrap of the global
// openCatering() (same pattern as js/31 wrapping switchMenuTab).
//
// GATING: every RPC is manager-gated server-side (public._cv_mgr admits
//   manager/admin/owner/vp/president/director/lead/supervisor/catering/vending).
//   A client-side effectiveRole() pre-check mirrors that list (View-As aware) so
//   line staff never see the tools — the RPC remains the real gate.
//
// FAIL-SAFE ABSOLUTELY: credentials come ONLY from the in-memory sessionPin /
//   sessionStorage('calichesPin') cache — this module NEVER calls prompt() on
//   auto-render. Every RPC is try/caught; any error / 404 (backend not deployed
//   yet) / unauthorized / empty response makes the affected panel render NOTHING
//   and never throws or blocks. If ALL THREE panels' RPCs fail (e.g. the whole
//   GO_LIVE_20 migration is not live yet) the entire injected root is removed, so
//   the screen looks exactly as it does today until the backend ships.
//
// BACKEND CONTRACT (specs/GO_LIVE_20_CV_ASSETS_TAXONOMY.sql), all jsonb:
//   app_cv_asset_list(p_username,p_password,p_status?,p_kind?) -> {assets:[...]}
//   app_cv_asset_save(p_username,p_password,p_payload)
//       payload: {asset_id?, name, kind, identifier, market, status, notes}
//   app_cv_asset_retire(p_username,p_password,p_id,p_note?)
//   app_cv_checklist_version_list(p_username,p_password,p_template_key?)
//       -> {templates:[...], versions:[...]}
//   app_cv_checklist_template_save(p_username,p_password,p_payload)
//       payload: {template_key, label, operating_unit?, event_type_key?,
//                 items[], version_label?, active?, change_note?}
//   app_cv_event_type_list(p_username,p_password,p_include_inactive?)
//       -> {event_types:[...]}
//   app_cv_event_type_save(p_username,p_password,p_payload)
//       payload: {id?, key, label, active, sort}
// (Per-event linking RPCs app_cv_event_asset_set/list are event-scoped and live
//  on the event-detail surface, not this screen-level register.)
// ============================================================
(function(){
    'use strict';
    // Guard double-injection (script included twice) — never run our setup twice.
    try{ if (typeof window === 'undefined') return; if (window.__cvaAssetsInjected) return; window.__cvaAssetsInjected = true; }catch(e){ return; }

    // ---------- tiny safe helpers ----------
    // Reuse the app's escapeHtml with a defensive fallback so a load-order hiccup never throws.
    function esc(s){ try{ if(typeof escapeHtml==='function') return escapeHtml(s==null?'':String(s)); }catch(e){} return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return '&#'+c.charCodeAt(0)+';'; }); }
    // Single-quoted JS string literal for inline on* handlers.
    function q(s){ return "'"+String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,' ')+"'"; }
    function assign(t,s){ try{ if(Object.assign) return Object.assign(t,s); }catch(e){} for(var k in s){ if(Object.prototype.hasOwnProperty.call(s,k)) t[k]=s[k]; } return t; }
    function findById(arr,id){ arr=arr||[]; for(var i=0;i<arr.length;i++){ if(arr[i] && String(arr[i].id)===String(id)) return arr[i]; } return null; }
    function safeJson(o){ try{ return JSON.stringify(o,null,2); }catch(e){ return ''; } }

    // ---------- credentials: sessionPin / sessionStorage ONLY (never prompt) ----------
    function pin(){
        try{ if(typeof sessionPin!=='undefined' && sessionPin) return sessionPin; }catch(e){}
        try{ if(typeof localStorage!=='undefined' && localStorage.getItem('calichesKeep')!=='0'){ var kp=sessionStorage.getItem('calichesPin'); if(kp) return kp; } }catch(e){}
        return null;
    }
    function hasCreds(){
        try{ return !!(typeof supabaseClient!=='undefined' && supabaseClient && typeof currentUser!=='undefined' && currentUser && currentUser.username && pin()); }catch(e){ return false; }
    }

    // ---------- manager gate (mirrors public._cv_mgr; View-As aware) ----------
    function canSee(){
        try{
            if(typeof currentUser==='undefined' || !currentUser) return false;
            var previewing=false; try{ previewing=!!(window._viewAsRole && typeof canUseViewAs==='function' && canUseViewAs()); }catch(e){}
            var r=''; try{ r=String((typeof effectiveRole==='function'?effectiveRole():'')||(currentUser&&currentUser.role)||'').toLowerCase(); }catch(e){ r=String((currentUser&&currentUser.role)||'').toLowerCase(); }
            var pats=['manager','admin','owner','vp','vice president','president','director','lead','supervisor','catering','vending'];
            for(var i=0;i<pats.length;i++){ if(r.indexOf(pats[i])>=0) return true; }
            if(!previewing){ try{ if(currentUser.is_developer===true) return true; }catch(e){} }
            return false;
        }catch(e){ return false; }
    }

    // ---------- RPC wrapper: fail-safe, credential-merged, NEVER prompts ----------
    function rpc(name,args,cb,onerr){
        try{
            if(!hasCreds()){ if(onerr) onerr({message:'nocreds'}); return; }
            supabaseClient.rpc(name, assign({p_username:currentUser.username, p_password:pin()}, args||{}))
                .then(function(res){ try{ if(res && res.error){ if(onerr) onerr(res.error); return; } cb(res?res.data:null); }catch(e){ if(onerr) onerr({message:'render'}); } })
                .catch(function(){ if(onerr) onerr({message:'connection'}); });
        }catch(e){ if(onerr) onerr({message:'connection'}); }
    }

    // ---------- module state ----------
    var S = {
        loaded:{assets:null, tpl:null, types:null},
        assets:[], assetFilter:'', assetForm:null, assetFormErr:'',
        tpl:{templates:[],versions:[]}, tplForm:null, tplOpenKey:null, tplOpenVer:null, tplErr:'',
        types:[], typeForm:null, typeErr:''
    };

    // ---------- shared style builders (match app inline-style vocabulary) ----------
    function card(title,right,body){
        return '<div style="background:#fff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,.05);overflow:hidden;margin-bottom:14px;">'
            +'<div style="background:linear-gradient(135deg,#b3202c 0%,#7a1620 100%);color:#fff;padding:10px 14px;display:flex;align-items:center;gap:8px;">'
            +'<b style="flex:1;font-size:14.5px;">'+title+'</b>'+(right||'')+'</div>'
            +'<div style="padding:12px 14px;">'+body+'</div></div>';
    }
    function btn(label,onclick,style){
        var bg,col; style=style||'dark';
        if(style==='primary'){ bg='#fff'; col='#b3202c'; }
        else if(style==='ghost'){ bg='rgba(255,255,255,.22)'; col='#fff'; }
        else if(style==='light'){ bg='#eef0f3'; col='#3a4353'; }
        else if(style==='danger'){ bg='#fdeaea'; col='#a01b3e'; }
        else { bg='#26242b'; col='#fff'; }
        return '<button type="button" onclick="'+onclick+'" style="background:'+bg+';color:'+col+';border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap;">'+label+'</button>';
    }
    function pill(text,bg,col){ return '<span style="display:inline-block;background:'+bg+';color:'+col+';border-radius:999px;padding:2px 9px;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.02em;">'+esc(text)+'</span>'; }
    function statusPill(s){ s=String(s||''); if(s==='active') return pill('active','#e6f6ec','#1f7a3d'); if(s==='maintenance') return pill('maint','#fff4e0','#9a5b00'); if(s==='retired') return pill('retired','#eef0f3','#6b7280'); return pill(s||'?','#eef0f3','#6b7280'); }
    function kindPill(k){ return pill(k||'equipment','#eef3fb','#185FA5'); }
    function lbl(t){ return '<div style="font-size:11px;font-weight:800;color:#6b7280;text-transform:uppercase;letter-spacing:.03em;margin:2px 0 3px;">'+esc(t)+'</div>'; }
    function inp(id,val,ph,type){ return '<input id="'+id+'" type="'+(type||'text')+'" value="'+esc(val==null?'':val)+'" placeholder="'+esc(ph||'')+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d7dbe2;border-radius:8px;font-size:13px;margin-bottom:8px;">'; }
    function ta(id,val,ph,rows){ return '<textarea id="'+id+'" rows="'+(rows||3)+'" placeholder="'+esc(ph||'')+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d7dbe2;border-radius:8px;font-size:12.5px;font-family:inherit;margin-bottom:8px;">'+esc(val==null?'':val)+'</textarea>'; }
    function sel(id,val,opts){ var h='<select id="'+id+'" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d7dbe2;border-radius:8px;font-size:13px;margin-bottom:8px;background:#fff;">'; for(var i=0;i<opts.length;i++){ var v=opts[i][0], l=opts[i][1]; h+='<option value="'+esc(v)+'"'+(String(val==null?'':val)===String(v)?' selected':'')+'>'+esc(l)+'</option>'; } return h+'</select>'; }
    function errBox(msg){ return msg? '<div style="background:#fdeaea;color:#a01b3e;border-radius:8px;padding:8px 10px;font-size:12.5px;font-weight:700;margin-bottom:8px;">'+esc(msg)+'</div>' : ''; }
    function gv(id){ try{ var el=document.getElementById(id); return el? el.value : ''; }catch(e){ return ''; } }
    function paint(panelId,html){ try{ var el=document.getElementById(panelId); if(el) el.innerHTML=html||''; }catch(e){} }

    // ============================================================
    // PANEL 1 — ASSET REGISTER  (list / add / edit / retire)
    // ============================================================
    function assetChip(val,label){ var on=(S.assetFilter===val); return '<button type="button" onclick="cva.assetFilter('+q(val)+')" style="border:none;border-radius:999px;padding:5px 11px;font-size:11.5px;font-weight:700;cursor:pointer;margin:0 5px 8px 0;'+(on?'background:#b3202c;color:#fff;':'background:#eef0f3;color:#3a4353;')+'">'+esc(label)+'</button>'; }
    function assetFormHtml(){
        var a=S.assetForm||{}; var editing=!!a.id;
        return '<div style="background:#fafbfc;border:1px solid #eef0f5;border-radius:10px;padding:12px;margin:4px 0 10px;">'
            +'<div style="font-weight:800;font-size:13px;color:#26242b;margin-bottom:8px;">'+(editing?'Edit asset':'New asset')+'</div>'
            +errBox(S.assetFormErr)
            +lbl('Name')+inp('cva_a_name',a.name,'e.g. Vending Trailer #2')
            +lbl('Kind')+sel('cva_a_kind',a.kind||'equipment',[['vehicle','Vehicle'],['cart','Cart'],['trailer','Trailer'],['equipment','Equipment']])
            +lbl('Identifier (plate / VIN / serial)')+inp('cva_a_ident',a.identifier,'')
            +lbl('Market')+inp('cva_a_market',a.market,'')
            +lbl('Status')+sel('cva_a_status',a.status||'active',[['active','Active'],['maintenance','Maintenance'],['retired','Retired']])
            +lbl('Notes')+ta('cva_a_notes',a.notes,'',2)
            +'<div style="display:flex;gap:8px;margin-top:2px;">'+btn('Save','cva.assetSave()','')+btn('Cancel','cva.assetCancel()','light')+'</div></div>';
    }
    function assetRowHtml(a){
        a=a||{};
        var meta=[]; if(a.identifier) meta.push(esc(a.identifier)); if(a.market) meta.push(esc(a.market));
        var actions=btn('Edit','cva.assetEdit('+(a.id||0)+')','light');
        if(String(a.status)!=='retired') actions+=' '+btn('Retire','cva.assetRetire('+(a.id||0)+')','danger');
        return '<div style="border-top:1px solid #f0f2f6;padding:9px 0;">'
            +'<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;"><b style="font-size:13.5px;color:#26242b;">'+esc(a.name||'(unnamed)')+'</b>'+kindPill(a.kind)+statusPill(a.status)+'</div>'
            +(meta.length?'<div style="font-size:12px;color:#6b7280;margin-top:2px;">'+meta.join(' &middot; ')+'</div>':'')
            +(a.notes?'<div style="font-size:12px;color:#6b7280;margin-top:2px;">'+esc(a.notes)+'</div>':'')
            +'<div style="margin-top:6px;display:flex;gap:6px;">'+actions+'</div></div>';
    }
    function assetsHtml(){
        var right=btn('&#43; Add','cva.assetAdd()','ghost');
        var body='<div style="display:flex;flex-wrap:wrap;">'+assetChip('','All')+assetChip('active','Active')+assetChip('maintenance','Maintenance')+assetChip('retired','Retired')+'</div>';
        if(S.assetForm!==null) body+=assetFormHtml();
        var a=S.assets||[];
        if(!a.length) body+='<div style="text-align:center;color:#8a93a2;font-size:13px;padding:14px 6px;">No assets'+(S.assetFilter?(' with status &ldquo;'+esc(S.assetFilter)+'&rdquo;'):' yet')+'.</div>';
        else for(var i=0;i<a.length;i++) body+=assetRowHtml(a[i]);
        return card('&#128666; Asset Register', right, body);
    }
    function renderAssets(){ paint('cvaAssetsPanel', assetsHtml()); }
    function loadAssets(){
        rpc('app_cv_asset_list', S.assetFilter?{p_status:S.assetFilter}:{}, function(d){
            try{ S.assets=(d&&d.assets)||[]; renderAssets(); settle('assets',true); }catch(e){ paint('cvaAssetsPanel',''); settle('assets',false); }
        }, function(){ paint('cvaAssetsPanel',''); settle('assets',false); });
    }
    function assetSave(){
        try{
            var payload={ name:String(gv('cva_a_name')).trim(), kind:gv('cva_a_kind'), identifier:String(gv('cva_a_ident')).trim(), market:String(gv('cva_a_market')).trim(), status:gv('cva_a_status'), notes:String(gv('cva_a_notes')).trim() };
            if(S.assetForm && S.assetForm.id) payload.asset_id=S.assetForm.id;
            if(!payload.asset_id && !payload.name){ S.assetFormErr='Name is required.'; renderAssets(); return; }
            S.assetFormErr='';
            rpc('app_cv_asset_save', {p_payload:payload}, function(){ S.assetForm=null; S.assetFormErr=''; loadAssets(); },
                function(err){ S.assetFormErr=(err&&err.message)||'Could not save.'; renderAssets(); });
        }catch(e){ S.assetFormErr='Could not save.'; try{ renderAssets(); }catch(_){} }
    }

    // ============================================================
    // PANEL 2 — CHECKLIST TEMPLATE VERSIONS  (viewer / saver)
    // ============================================================
    function tplItemsHtml(items){
        items=items||[]; if(!items.length) return '<div style="font-size:11.5px;color:#8a93a2;margin-top:4px;">No items.</div>';
        var h='<div style="margin-top:6px;">';
        for(var i=0;i<items.length;i++){ var it=items[i]||{};
            h+='<div style="font-size:11.5px;color:#3a4353;padding:3px 0;border-top:'+(i?'1px dashed #e6e8ee':'none')+';">'
                +(it.is_critical?'&#9888; ':'')+'<b>'+esc(it.label||'')+'</b>'
                +(it.category?(' <span style="color:#8a93a2;">&middot; '+esc(it.category)+'</span>'):'')
                +(it.uom?(' <span style="color:#8a93a2;">&middot; '+esc(it.uom)+((it.required_qty!=null&&it.required_qty!=='')?(' &times;'+esc(it.required_qty)):'')+'</span>'):'')
                +(it.stage?(' <span style="color:#b0b4bd;">['+esc(it.stage)+']</span>'):'')+'</div>';
        }
        return h+'</div>';
    }
    function tplVersionsHtml(key){
        var vs=((S.tpl&&S.tpl.versions)||[]).filter(function(v){ return v && v.template_key===key; });
        if(!vs.length) return '<div style="font-size:12px;color:#8a93a2;margin-top:6px;">No version history.</div>';
        var h='<div style="background:#fafbfc;border-radius:9px;padding:8px 10px;margin-top:8px;">';
        for(var i=0;i<vs.length;i++){ var v=vs[i]||{}; var vid=key+'#'+v.version; var vo=(S.tplOpenVer===vid);
            h+='<div style="border-top:'+(i?'1px solid #eef0f5':'none')+';padding:7px 0;">'
                +'<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;cursor:pointer;" onclick="cva.tplVer('+q(key)+','+(v.version||0)+')">'
                +pill('v'+(v.version||'?'),'#f3e8ee','#7a1620')+(v.is_current?pill('current','#e6f6ec','#1f7a3d'):'')
                +'<span style="font-size:12px;color:#26242b;font-weight:700;">'+(v.item_count!=null?v.item_count:'0')+' items</span>'
                +(v.version_label?('<span style="font-size:11px;color:#8a93a2;">'+esc(v.version_label)+'</span>'):'')+'</div>'
                +(v.change_note?('<div style="font-size:11.5px;color:#6b7280;margin-top:2px;">'+esc(v.change_note)+'</div>'):'')
                +'<div style="font-size:10.5px;color:#a0a6b0;margin-top:1px;">'+esc(v.created_by||'')+(v.created_at?(' &middot; '+esc(String(v.created_at).slice(0,10))):'')+'</div>'
                +(vo?tplItemsHtml(v.items):'')+'</div>';
        }
        return h+'</div>';
    }
    function tplRowHtml(t){
        t=t||{}; var key=t.template_key||''; var open=(S.tplOpenKey===key);
        var badges=(t.is_current!==false?pill('current','#e6f6ec','#1f7a3d'):'')+(t.operating_unit?(' '+pill(t.operating_unit,'#eef3fb','#185FA5')):'')+(t.active===false?(' '+pill('inactive','#eef0f3','#6b7280')):'');
        var cnt=(t.items&&t.items.length!=null)?t.items.length:'';
        var h='<div style="border-top:1px solid #f0f2f6;padding:9px 0;">'
            +'<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;"><b style="font-size:13.5px;color:#26242b;cursor:pointer;" onclick="cva.tplToggle('+q(key)+')">'+esc(t.label||key)+'</b>'+pill('v'+(t.version||1),'#f3e8ee','#7a1620')+badges+'</div>'
            +'<div style="font-size:11.5px;color:#6b7280;margin-top:2px;">'+esc(key)+(cnt!==''?(' &middot; '+cnt+' items'):'')+(t.version_label?(' &middot; '+esc(t.version_label)):'')+'</div>'
            +'<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">'+btn(open?'Hide history':'History','cva.tplToggle('+q(key)+')','light')+btn('New version','cva.tplEditFrom('+q(key)+')','light')+'</div>';
        if(open) h+=tplVersionsHtml(key);
        return h+'</div>';
    }
    function tplFormHtml(){
        var f=S.tplForm||{}; var editing=!!f.template_key;
        var itemsStr=(f.items!=null)?(typeof f.items==='string'?f.items:safeJson(f.items)):'';
        return '<div style="background:#fafbfc;border:1px solid #eef0f5;border-radius:10px;padding:12px;margin:4px 0 10px;">'
            +'<div style="font-weight:800;font-size:13px;color:#26242b;margin-bottom:8px;">'+(editing?'New version of &ldquo;'+esc(f.template_key)+'&rdquo;':'New checklist template')+'</div>'
            +errBox(S.tplErr)
            +lbl('Template key')+inp('cva_t_key',f.template_key,'e.g. trailer_loadout')
            +lbl('Label')+inp('cva_t_label',f.label,'')
            +lbl('Operating unit')+sel('cva_t_ou',f.operating_unit||'',[['','—'],['store','Store'],['trailer','Trailer'],['treat_truck','Treat Truck'],['warehouse','Warehouse']])
            +lbl('Event type key (optional)')+inp('cva_t_etk',f.event_type_key,'')
            +lbl('Items (JSON array)')+ta('cva_t_items',itemsStr,'[{"stage":"pack_out","category":"Supplies","label":"Cups","uom":"case","is_critical":false,"sort":10}]',6)
            +lbl('Change note')+inp('cva_t_note','','What changed in this version')
            +'<div style="display:flex;gap:8px;margin-top:2px;">'+btn('Save version','cva.tplSave()','')+btn('Cancel','cva.tplCancel()','light')+'</div></div>';
    }
    function templatesHtml(){
        var right=btn('&#43; New','cva.tplNew()','ghost');
        var body='';
        if(S.tplForm!==null) body+=tplFormHtml();
        var t=(S.tpl&&S.tpl.templates)||[];
        if(!t.length) body+='<div style="text-align:center;color:#8a93a2;font-size:13px;padding:14px 6px;">No checklist templates yet.</div>';
        else for(var i=0;i<t.length;i++) body+=tplRowHtml(t[i]);
        return card('&#128203; Checklist Templates', right, body);
    }
    function renderTemplates(){ paint('cvaTplPanel', templatesHtml()); }
    function loadTemplates(){
        rpc('app_cv_checklist_version_list', {}, function(d){
            try{ S.tpl={ templates:(d&&d.templates)||[], versions:(d&&d.versions)||[] }; renderTemplates(); settle('tpl',true); }catch(e){ paint('cvaTplPanel',''); settle('tpl',false); }
        }, function(){ paint('cvaTplPanel',''); settle('tpl',false); });
    }
    function tplEditFrom(key){
        try{
            var vs=((S.tpl&&S.tpl.versions)||[]).filter(function(v){ return v && v.template_key===key; });
            var cur=null,i; for(i=0;i<vs.length;i++){ if(vs[i].is_current){ cur=vs[i]; break; } } if(!cur && vs.length) cur=vs[0];
            var t=null,ts=(S.tpl&&S.tpl.templates)||[]; for(i=0;i<ts.length;i++){ if(ts[i].template_key===key){ t=ts[i]; break; } }
            var src=cur||t||{};
            S.tplForm={ template_key:key, label:src.label||(t&&t.label)||'', operating_unit:src.operating_unit||(t&&t.operating_unit)||'', event_type_key:src.event_type_key||(t&&t.event_type_key)||'', items:(src.items!=null?src.items:(t&&t.items))||[] };
            S.tplErr=''; renderTemplates();
        }catch(e){}
    }
    function tplSave(){
        try{
            var key=String(gv('cva_t_key')).trim();
            if(!key){ S.tplErr='Template key is required.'; renderTemplates(); return; }
            var raw=String(gv('cva_t_items')||'').trim(); var items;
            try{ items = raw ? JSON.parse(raw) : []; }catch(pe){ S.tplErr='Items must be valid JSON (an array).'; renderTemplates(); return; }
            if(!(items instanceof Array)){ S.tplErr='Items must be a JSON array.'; renderTemplates(); return; }
            var payload={ template_key:key, label:String(gv('cva_t_label')).trim(), items:items, change_note:String(gv('cva_t_note')).trim() };
            var ou=gv('cva_t_ou'); if(ou) payload.operating_unit=ou;
            var et=String(gv('cva_t_etk')).trim(); if(et) payload.event_type_key=et;
            S.tplErr='';
            rpc('app_cv_checklist_template_save', {p_payload:payload}, function(){ S.tplForm=null; S.tplErr=''; loadTemplates(); },
                function(err){ S.tplErr=(err&&err.message)||'Could not save.'; renderTemplates(); });
        }catch(e){ S.tplErr='Could not save.'; try{ renderTemplates(); }catch(_){} }
    }

    // ============================================================
    // PANEL 3 — EVENT-TYPE TAXONOMY  (manager list)
    // ============================================================
    function typeFormHtml(){
        var f=S.typeForm||{}; var editing=!!f.id; var checked=(f.active!==false)?' checked':'';
        return '<div style="background:#fafbfc;border:1px solid #eef0f5;border-radius:10px;padding:12px;margin:4px 0 10px;">'
            +'<div style="font-weight:800;font-size:13px;color:#26242b;margin-bottom:8px;">'+(editing?'Edit event type':'New event type')+'</div>'
            +errBox(S.typeErr)
            +lbl('Key')+inp('cva_e_key',f.key,'e.g. corporate')
            +lbl('Label')+inp('cva_e_label',f.label,'')
            +lbl('Sort')+inp('cva_e_sort',(f.sort==null?'':f.sort),'0','number')
            +'<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#3a4353;margin:2px 0 10px;cursor:pointer;"><input id="cva_e_active" type="checkbox"'+checked+' style="width:16px;height:16px;"> Active</label>'
            +'<div style="display:flex;gap:8px;">'+btn('Save','cva.typeSave()','')+btn('Cancel','cva.typeCancel()','light')+'</div></div>';
    }
    function typeRowHtml(e){
        e=e||{};
        var actPill=(e.active!==false)?pill('active','#e6f6ec','#1f7a3d'):pill('inactive','#eef0f3','#6b7280');
        return '<div style="border-top:1px solid #f0f2f6;padding:9px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
            +'<div style="flex:1;min-width:150px;"><b style="font-size:13.5px;color:#26242b;">'+esc(e.label||e.key||'')+'</b> '+actPill
            +'<div style="font-size:11.5px;color:#6b7280;margin-top:2px;">'+esc(e.key||'')+' &middot; sort '+esc(e.sort==null?'0':e.sort)+'</div></div>'
            +btn('Edit','cva.typeEdit('+(e.id||0)+')','light')+btn((e.active!==false)?'Deactivate':'Activate','cva.typeToggleActive('+(e.id||0)+')','light')+'</div>';
    }
    function typesHtml(){
        var right=btn('&#43; Add','cva.typeAdd()','ghost');
        var body='';
        if(S.typeForm!==null) body+=typeFormHtml();
        var t=S.types||[];
        if(!t.length) body+='<div style="text-align:center;color:#8a93a2;font-size:13px;padding:14px 6px;">No event types yet.</div>';
        else for(var i=0;i<t.length;i++) body+=typeRowHtml(t[i]);
        return card('&#127991; Event Types', right, body);
    }
    function renderTypes(){ paint('cvaTypesPanel', typesHtml()); }
    function loadTypes(){
        rpc('app_cv_event_type_list', {p_include_inactive:true}, function(d){
            try{ S.types=(d&&d.event_types)||[]; renderTypes(); settle('types',true); }catch(e){ paint('cvaTypesPanel',''); settle('types',false); }
        }, function(){ paint('cvaTypesPanel',''); settle('types',false); });
    }
    function typeSave(){
        try{
            var payload={ key:String(gv('cva_e_key')).trim(), label:String(gv('cva_e_label')).trim() };
            var act=document.getElementById('cva_e_active'); payload.active = act ? !!act.checked : true;
            var sort=String(gv('cva_e_sort')).trim(); if(sort!=='') payload.sort=sort;
            if(S.typeForm && S.typeForm.id) payload.id=S.typeForm.id;
            if(!payload.id && !payload.key){ S.typeErr='Key is required.'; renderTypes(); return; }
            S.typeErr='';
            rpc('app_cv_event_type_save', {p_payload:payload}, function(){ S.typeForm=null; S.typeErr=''; loadTypes(); },
                function(err){ S.typeErr=(err&&err.message)||'Could not save.'; renderTypes(); });
        }catch(e){ S.typeErr='Could not save.'; try{ renderTypes(); }catch(_){} }
    }
    function typeToggleActive(id){
        try{ var e=findById(S.types,id); if(!e) return;
            rpc('app_cv_event_type_save', {p_payload:{id:e.id, active:(e.active===false)}}, function(){ loadTypes(); }, function(){ /* silent, fail-safe */ });
        }catch(e){}
    }

    // ============================================================
    // MOUNT / INJECTION
    // ============================================================
    function headerHtml(){
        return '<div style="margin:14px 2px 12px;"><div style="font-size:16px;font-weight:800;color:#26242b;">Catering &amp; Vending &mdash; Manager Tools</div>'
            +'<div style="font-size:11.5px;color:#8a93a2;">Asset register, checklist versions &amp; event-type taxonomy</div></div>';
    }
    // Locate/create our root as a SIBLING just after #catBody inside #cateringView,
    // so #catBody innerHTML rewrites never clobber it. Returns null when the screen
    // anchor is absent (module then simply no-ops until the next openCatering()).
    function root(){
        try{
            var body=document.getElementById('catBody'); if(!body || !body.parentNode) return null;
            var el=document.getElementById('cvaRoot');
            if(!el){ el=document.createElement('div'); el.id='cvaRoot'; el.style.cssText='max-width:860px;margin:6px auto 42px;padding:0 16px;box-sizing:border-box;'; }
            var parent=body.parentNode;
            if(el.parentNode!==parent || body.nextSibling!==el){ try{ if(body.nextSibling) parent.insertBefore(el, body.nextSibling); else parent.appendChild(el); }catch(e){ return el; } }
            return el;
        }catch(e){ return null; }
    }
    function removeRoot(){ try{ var el=document.getElementById('cvaRoot'); if(el && el.parentNode) el.parentNode.removeChild(el); }catch(e){} }

    // When all three panels' RPCs fail (backend not deployed yet / unauthorized),
    // remove the entire root so the screen is unchanged from today.
    function settle(key,ok){
        try{
            S.loaded[key]= ok?'ok':'err';
            if(S.loaded.assets!==null && S.loaded.tpl!==null && S.loaded.types!==null){
                if(S.loaded.assets==='err' && S.loaded.tpl==='err' && S.loaded.types==='err') removeRoot();
            }
        }catch(e){}
    }

    function mount(){
        try{
            if(!canSee()){ removeRoot(); return; }        // line staff / View-As preview: nothing
            if(!hasCreds()){ removeRoot(); return; }       // no cached pin -> never prompt on auto-render
            var el=root(); if(!el) return;                 // screen anchor absent -> no-op
            S.loaded={assets:null, tpl:null, types:null};
            S.assetForm=null; S.assetFormErr=''; S.tplForm=null; S.tplErr=''; S.tplOpenKey=null; S.tplOpenVer=null; S.typeForm=null; S.typeErr='';
            el.innerHTML = headerHtml()
                + '<div id="cvaAssetsPanel"></div>'
                + '<div id="cvaTplPanel"></div>'
                + '<div id="cvaTypesPanel"></div>';
            loadAssets(); loadTemplates(); loadTypes();
        }catch(e){ /* never throw onto the screen */ }
    }

    // ---------- expose action namespace (single global: window.cva) ----------
    try{
        window.cva = {
            assetAdd:function(){ S.assetForm={}; S.assetFormErr=''; renderAssets(); },
            assetEdit:function(id){ var a=findById(S.assets,id); S.assetForm=a?assign({},a):{}; S.assetFormErr=''; renderAssets(); },
            assetCancel:function(){ S.assetForm=null; S.assetFormErr=''; renderAssets(); },
            assetSave:assetSave,
            assetFilter:function(f){ S.assetFilter=f||''; loadAssets(); },
            assetRetire:function(id){ try{ if(typeof confirm==='function' && !confirm('Retire this asset? It stays in history but is marked retired.')) return; }catch(e){} rpc('app_cv_asset_retire', {p_id:id}, function(){ loadAssets(); }, function(){ loadAssets(); }); },
            tplNew:function(){ S.tplForm={}; S.tplErr=''; renderTemplates(); },
            tplEditFrom:tplEditFrom,
            tplCancel:function(){ S.tplForm=null; S.tplErr=''; renderTemplates(); },
            tplSave:tplSave,
            tplToggle:function(k){ S.tplOpenKey=(S.tplOpenKey===k?null:k); S.tplOpenVer=null; renderTemplates(); },
            tplVer:function(k,v){ var id=k+'#'+v; S.tplOpenVer=(S.tplOpenVer===id?null:id); renderTemplates(); },
            typeAdd:function(){ S.typeForm={active:true,sort:0}; S.typeErr=''; renderTypes(); },
            typeEdit:function(id){ var e=findById(S.types,id); S.typeForm=e?assign({},e):{active:true}; S.typeErr=''; renderTypes(); },
            typeCancel:function(){ S.typeForm=null; S.typeErr=''; renderTypes(); },
            typeSave:typeSave,
            typeToggleActive:typeToggleActive,
            _mount:mount
        };
    }catch(e){}

    // ---------- hook screen entry: append-only wrap of openCatering() ----------
    // Same pattern as js/31 wrapping switchMenuTab. Guarded to wrap ONCE. A short
    // retry covers the (unexpected) case where openCatering is not yet defined.
    function wrapOpen(tries){
        try{
            if(typeof openCatering==='function'){
                if(!openCatering.__cvaWrapped){
                    var _cvaWrapped=(function(orig){
                        function w(){ var r; try{ r=orig.apply(this,arguments); }catch(e){} try{ setTimeout(mount,0); }catch(e){ try{ mount(); }catch(_){} } return r; }
                        w.__cvaWrapped=true; return w;
                    })(openCatering);
                    openCatering=_cvaWrapped;
                    try{ window.openCatering=_cvaWrapped; }catch(e){}
                }
                return;
            }
        }catch(e){}
        if((tries||0) < 40){ try{ setTimeout(function(){ wrapOpen((tries||0)+1); }, 250); }catch(e){} }
    }
    try{ wrapOpen(0); }catch(e){}

    // ---------- safety net: paint now if the C&V screen is already visible ----------
    try{ var _v=document.getElementById('cateringView'); if(_v && _v.style && _v.style.display==='block'){ setTimeout(mount,0); } }catch(e){}
})();
