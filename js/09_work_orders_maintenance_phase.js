    // ===== WORK ORDERS — Maintenance Phase 1 (BETA, test-gated; does NOT touch live Maintenance Board) =====
    var _wo={tab:'board',list:[],people:{maint:[]}};
    function woOverlay(){ var ov=document.getElementById('woModal'); if(!ov){ ov=document.createElement('div'); ov.id='woModal'; ov.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100000;overflow:auto;'; document.body.appendChild(ov);} ov.style.display='block'; return ov; }
    function woClose(){ var o=document.getElementById('woModal'); if(o)o.style.display='none'; var m=document.getElementById('woModal2'); if(m)m.style.display='none'; }
    function woHeader(title,back){ return '<div style="background:linear-gradient(120deg,#D85A30,#7d1d4b);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;">'+(back?'<button onclick="'+back+'" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;">&#8249; Back</button>':'')+'<b style="flex:1;font-size:16px;">'+title+'</b><button onclick="woClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }
    // ROLE-STRING FIX (2026-07-17): 'Maintenance' -- the actual, only assignable maintenance
    // role in the Roster (js/04 PERM_ROLES) -- was missing here entirely. A Maintenance-role
    // tech got neither My Queue, Board, nor Completed tabs; only Report. 'Maintenance
    // Contributor' isn't a real assignable role anywhere else in the app; left in place
    // (harmless) in case anything already relies on it.
    function woIsMaint(){ var r=currentUser.role; return r==='Maintenance'||r==='Maintenance Lead'||r==='Maintenance Contributor'; }
    function woIsMgr(){ return currentUser.is_developer===true||['Admin Manager','Manager','Vice President/Co-Owner','Store Manager'].indexOf(currentUser.role)>=0; }
    function openWorkOrders(){ _wo.preset=null; var _dt=woIsMaint()?'queue':(woIsMgr()?'board':'report'); var _st=lsGet('woTab',_dt); var _ok={report:1,board:woIsMgr(),queue:(woIsMaint()||woIsMgr()),history:(woIsMgr()||woIsMaint())}; _wo.tab=_ok[_st]?_st:_dt; woLoad(function(){ woRender(); }); }
    /* ===================== STORE SCORECARDS ===================== */
    var _sc={rows:[],selDate:null};
    var SC_FIELDS=[['sales','Sales ($)','From Axial: Dashboard &rarr; Net Sales'],['sales_ly','Sales last year ($)','From Axial: comparison tile (Same Date Last Year)'],['guest_count','Guest count'],['speed_seconds','Speed of service (sec)'],['labor_pct','Labor %','From Axial: Total Labor incl. management (% of Net) — requires managers to clock in under a Manager job'],['inspection_score','Inspection score'],['training_pct','Training %'],['maintenance_open','Open maintenance'],['pick_n_take','Pick-N-Take'],['flips','Flips'],['complaints','Complaints']];
    function scIsMgr(){ return !!(currentUser&&(currentUser.is_developer===true||(typeof woIsMgr==='function'&&woIsMgr()))); }
    function scRpc(name,args,cb){ withPin(function(pin){ supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){ if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; } cb(r.data); }).catch(function(){ alert('Connection error.'); }); }); }
    function scOv(){ var o=document.getElementById('scModal'); if(!o){ o=document.createElement('div'); o.id='scModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100040;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function scClose(){ var o=document.getElementById('scModal'); if(o) o.style.display='none'; }
    function scMoney(n){ if(n==null||n==='') return '—'; var x=parseFloat(n); return '$'+(isNaN(x)?'0':x.toLocaleString()); }
    function scNum(n){ return (n==null||n==='')?'—':String(n); }
    function scTodayIso(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
    function scPrettyDate(s){ if(!s) return ''; var p=String(s).slice(0,10).split('-'); if(p.length!==3) return String(s); var dt=new Date(+p[0],+p[1]-1,+p[2]); if(isNaN(dt.getTime())) return String(s); return dt.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'}); }
    function scLoadingHtml(){ return '<div style="padding:12px 14px;"><button onclick="scClose()" style="background:#eef0f3;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:700;">&times; Close</button></div><div style="text-align:center;color:#6b7686;padding:38px;">Loading scorecards&hellip;</div>'; }
    function openScorecards(){ scLoad(); }
    function scLoad(){ _sc.selDate=null; scOv().innerHTML=scLoadingHtml(); scRpc('app_metrics_latest',{},function(d){ _sc.rows=d||[]; scRender(); }); }
    function scLoadFor(date){ if(!date){ scLoad(); return; } _sc.selDate=date; scOv().innerHTML=scLoadingHtml(); scRpc('app_metrics_on_date',{p_date:date},function(d){ _sc.rows=d||[]; scRender(); }); }
    function scTile(label,val,sub,color){ return '<div style="flex:1;min-width:88px;background:#fff;border:1px solid #eef0f5;border-radius:10px;padding:8px 10px;"><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;">'+label+'</div><div style="font-size:16px;font-weight:800;color:'+(color||'#1f2a44')+';">'+val+'</div>'+(sub?'<div style="font-size:10.5px;color:#6b6275;">'+sub+'</div>':'')+'</div>'; }
    function scRender(){
        var stores=(typeof HUB_STORES!=='undefined'?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell']);
        var byLoc={}; (_sc.rows||[]).forEach(function(m){ byLoc[m.location]=m; });
        var h='<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">Store Scorecards</b><button onclick="scClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">&times;</button></div>';
        h+='<div style="max-width:840px;margin:0 auto;padding:14px 16px 50px;">';
        h+='<p style="font-size:12.5px;color:#6b7686;margin-top:0;">A snapshot per store. Managers can enter numbers now; Axial / POS sales + labor can auto-fill these.</p>';
        var _scShowing=_sc.selDate?('Showing the latest numbers <b>on or before '+escapeHtml(scPrettyDate(_sc.selDate))+'</b>'):'Showing the <b>latest available</b> numbers for each store';
        h+='<div style="background:#fff;border:1px solid #e6ebf2;border-radius:12px;padding:10px 12px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">'
         +'<div style="font-size:12.5px;color:#1f2a44;flex:1;min-width:190px;">📅 '+_scShowing+'</div>'
         +'<label for="scDatePick" style="font-size:11.5px;color:#5b6675;font-weight:700;">View a day:</label>'
         +'<input type="date" id="scDatePick" value="'+escapeHtml(_sc.selDate||'')+'" max="'+scTodayIso()+'" onchange="scLoadFor(this.value)" style="border:1px solid #cdd5e0;border-radius:8px;padding:6px 9px;font-size:12.5px;">'
         +(_sc.selDate?'<button onclick="scLoad()" style="background:#eef0f3;border:none;border-radius:8px;padding:7px 11px;font-size:12px;font-weight:700;cursor:pointer;">↺ Latest</button>':'')
         +'</div>';
        stores.forEach(function(loc){
            var m=byLoc[loc]; var emoji=(typeof hubStoreEmoji==='function'?hubStoreEmoji(loc):'📍');
            h+='<div style="background:#fafbfd;border:1px solid #e6ebf2;border-radius:14px;padding:13px;margin-bottom:10px;">';
            h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><b style="flex:1;font-size:15px;color:#1f2a44;">'+emoji+' '+escapeHtml(loc)+'</b>'+(m&&m.metric_date?'<span style="font-size:11px;color:#5b6675;white-space:nowrap;">📊 as of '+escapeHtml(scPrettyDate(m.metric_date))+'</span>':'')+(scIsMgr()?'<button onclick="scEnter(\''+loc.replace(/'/g,"")+'\')" style="background:#185FA5;color:#fff;border:none;border-radius:7px;padding:5px 11px;font-size:12px;font-weight:700;cursor:pointer;">'+(m?'Update':'Enter')+'</button>':'')+'</div>';
            if(!m){ h+='<div style="font-size:12.5px;color:#5b6675;">No numbers entered yet'+(scIsMgr()?' — tap Enter to add them.':'.')+'</div>'; }
            else {
                var dly=''; if(m.sales!=null&&m.sales_ly){ var pct=Math.round(((m.sales-m.sales_ly)/m.sales_ly)*100); dly=(pct>=0?'▲ +':'▼ ')+pct+'% vs LY'; }
                h+='<div style="display:flex;gap:8px;flex-wrap:wrap;">';
                h+=scTile('Sales',scMoney(m.sales),dly,(m.sales!=null&&m.sales_ly&&m.sales>=m.sales_ly)?'#1b7a3d':(m.sales_ly?'#a01b3e':'#1f2a44'));
                h+=scTile('Guests',scNum(m.guest_count),'');
                h+=scTile('Speed',m.speed_seconds!=null?(m.speed_seconds+'s'):'—','');
                h+=scTile('Labor',m.labor_pct!=null?(m.labor_pct+'%'):'—','',(m.labor_pct>25?'#a01b3e':(m.labor_pct!=null?'#1b7a3d':'#1f2a44')));
                h+=scTile('Inspection',scNum(m.inspection_score),'');
                h+=scTile('Training',m.training_pct!=null?(m.training_pct+'%'):'—','');
                h+=scTile('Maint open',scNum(m.maintenance_open),'',(m.maintenance_open>0?'#9a5b00':'#1f2a44'));
                h+=scTile('Pick-N-Take',scNum(m.pick_n_take),'');
                h+=scTile('Flips',scNum(m.flips),'');
                h+=scTile('Complaints',scNum(m.complaints),'',(m.complaints>0?'#a01b3e':'#1f2a44'));
                h+='</div>';
                if(m.note) h+='<div style="font-size:11.5px;color:#6b6275;margin-top:6px;">'+escapeHtml(m.note)+'</div>';
            }
            h+='</div>';
        });
        h+='</div>'; scOv().innerHTML=h;
    }
    function scEnter(loc){
        var m=(_sc.rows||[]).filter(function(x){return x.location===loc;})[0]||{};
        var today=new Date().toISOString().slice(0,10);
        var fields=SC_FIELDS.map(function(f){ return '<div style="flex:1;min-width:130px;"><label style="font-size:11.5px;color:#6b7686;display:block;margin-bottom:2px;">'+f[1]+'</label><input id="scf_'+f[0]+'" type="number" step="any" value="'+(m[f[0]]!=null?escapeHtml(String(m[f[0]])):'')+'" style="width:100%;padding:8px;border:1px solid #d6deea;border-radius:8px;font-size:13px;box-sizing:border-box;">'+(f[2]?'<div style="font-size:10px;color:#2563a8;margin-top:2px;line-height:1.2;">'+f[2]+'</div>':'')+'</div>'; }).join('');
        var h='<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><button onclick="scLoad()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;cursor:pointer;">&lsaquo; Back</button><b style="flex:1;font-size:16px;">'+escapeHtml(loc)+' — enter numbers</b></div>';
        h+='<div style="max-width:620px;margin:0 auto;padding:16px 16px 50px;">';
        h+='<div style="background:#eef5ff;border:1px solid #cfe0f5;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:11.5px;color:#27517f;line-height:1.4;">&#128202; <b>Pulling from Axial Shift?</b> Open your Axial dashboard for this store and copy the weekly numbers: <b>Net Sales</b> &rarr; Sales, the <b>comparison tile</b> &rarr; Sales last year, and <b>Hourly Labor (% of Net)</b> &rarr; Labor %. The blue hints below show where each one lives. Tip: set the Axial comparison metric to "Same Date Last Year" so the vs-LY math matches.</div>';
        h+='<label style="font-size:11.5px;color:#6b7686;display:block;margin-bottom:2px;">Date</label><input id="scfDate" type="date" value="'+(m.metric_date||today)+'" style="padding:8px;border:1px solid #d6deea;border-radius:8px;font-size:13px;margin-bottom:10px;">';
        h+='<div style="display:flex;gap:10px;flex-wrap:wrap;">'+fields+'</div>';
        h+='<label style="font-size:11.5px;color:#6b7686;display:block;margin:10px 0 2px;">Note (optional)</label><textarea id="scfNote" rows="2" style="width:100%;padding:8px;border:1px solid #d6deea;border-radius:8px;box-sizing:border-box;font-size:13px;">'+escapeHtml(m.note||'')+'</textarea>';
        h+='<button onclick="scSave(\''+loc.replace(/'/g,"")+'\')" style="width:100%;background:var(--pass-green,#1f7a3d);color:#fff;border:none;border-radius:10px;padding:12px;font-weight:800;cursor:pointer;margin-top:12px;">Save scorecard</button>';
        h+='</div>'; scOv().innerHTML=h;
    }
    function scSave(loc){
        var payload={}; SC_FIELDS.forEach(function(f){ var v=(document.getElementById('scf_'+f[0])||{}).value; if(v!==''&&v!=null) payload[f[0]]=v; });
        payload.note=(document.getElementById('scfNote')||{}).value||'';
        var bad=false; SC_FIELDS.forEach(function(f){ var v=payload[f[0]]; if(v!=null&&v!==''&&parseFloat(v)<0) bad=true; }); if(bad){ alert('Values cannot be negative.'); return; }
        var date=(document.getElementById('scfDate')||{}).value||null;
        scRpc('app_metrics_save',{p_location:loc,p_date:date,p_payload:payload},function(){ scLoad(); });
    }
    /* =================== END STORE SCORECARDS =================== */
    /* ===================== MAINTENANCE BILLING / INVOICES ===================== */
    var _wob={tab:'invoices',list:[],cur:null,rates:[],filter:{}};
    function wobRpc(name,args,cb,onerr){ withPin(function(pin){ var a=Object.assign({p_username:currentUser.username,p_password:pin},args||{}); supabaseClient.rpc(name,a).then(function(r){ if(r.error){ if(onerr) onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'You do not have access to this.':r.error.message); return; } cb(r.data); }).catch(function(){ if(onerr) onerr({message:'Connection error'}); else alert('Connection error.'); }); }); }
    function wobMoney(n){ var x=parseFloat(n||0); return '$'+(isNaN(x)?'0.00':x.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})); }
    function wobOv(){ var o=document.getElementById('wobModal'); if(!o){ o=document.createElement('div'); o.id='wobModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100040;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function wobClose(){ var o=document.getElementById('wobModal'); if(o) o.style.display='none'; }
    function wobHead(title,back){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;">'+(back?'<button onclick="'+back+'" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;">&lsaquo; Back</button>':'')+'<b style="flex:1;font-size:16px;">'+title+'</b><button onclick="wobClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">&times;</button></div>'; }
    function wobStatusPill(s){ var m={draft:['#eef0f3','#5b6472'],submitted:['#eef3fb','#185FA5'],operational_verified:['#fff4e0','#9a5b00'],finance_approved:['#e8f5ec','#1b7a3d'],paid:['#dff3e6','#1b7a3d'],void:['#fdeaea','#a01b3e']}; var c=m[s]||m.draft; var lbl={draft:'Draft',submitted:'Submitted',operational_verified:'Verified (ops)',finance_approved:'Finance approved',paid:'Paid',void:'Void'}[s]||s; return '<span style="background:'+c[0]+';color:'+c[1]+';font-size:11px;font-weight:800;padding:2px 9px;border-radius:99px;">'+lbl+'</span>'; }
    function openMaintBilling(){ if(!(currentUser&&(currentUser.is_developer===true||(typeof isManagerRole==='function'&&isManagerRole())||['Finance Approver','Maintenance Lead','Store Manager'].indexOf(currentUser.role)>=0))){ alert('Maintenance billing is for managers and finance.'); return; } _wob.tab='invoices'; wobLoad(); }
    function wobShell(body){ var t=_wob.tab; function tb(id,l){ return '<button onclick="_wob.tab=\''+id+'\';'+(id==='invoices'?'wobLoad()':'wobRates()')+'" style="flex:1;background:'+(t===id?'#185FA5':'#eef0f3')+';color:'+(t===id?'#fff':'#5b6472')+';border:none;padding:10px;font-size:13px;font-weight:700;border-radius:9px;cursor:pointer;">'+l+'</button>'; }
      wobOv().innerHTML=wobHead('Maintenance Billing','')+'<div style="display:flex;gap:6px;max-width:820px;margin:12px auto 0;padding:0 16px;">'+tb('invoices','Invoices')+tb('rates','Rate cards')+'</div><div style="max-width:820px;margin:0 auto;padding:14px 16px 50px;">'+body+'</div>'; }
    function wobLoad(){ wobOv().innerHTML=wobHead('Maintenance Billing','')+'<div style="text-align:center;color:#6b7686;padding:40px;">Loading&hellip;</div>'; wobRpc('wo_invoice_list',{p_filters:_wob.filter||{}},function(d){ _wob.list=d||[]; wobRender(); }); }
    function wobRender(){ var f=_wob.filter||{}; var sts=['','draft','submitted','operational_verified','finance_approved','paid','void'];
      var h='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;"><select onchange="_wob.filter={status:this.value};wobLoad()" style="padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12.5px;">'+sts.map(function(s){return '<option value="'+s+'"'+(f.status===s?' selected':'')+'>'+(s?wobStatusPill(s).replace(/<[^>]+>/g,''):'All statuses')+'</option>';}).join('')+'</select><button onclick="wobNew()" style="background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:800;cursor:pointer;">&#10133; New invoice</button><button onclick="wobExport()" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;">&#8595; CSV</button></div>';
      if(!_wob.list.length) h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:30px;text-align:center;color:#6b6275;">No invoices yet.</div>';
      _wob.list.forEach(function(i){ h+='<div onclick="wobOpen('+i.id+')" style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer;"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(i.invoice_number||'')+'</b>'+wobStatusPill(i.status)+'</div><div style="font-size:11.5px;color:#6b6275;margin-top:3px;">'+escapeHtml(i.vendor||'(no vendor)')+(i.wo?(' &middot; WO '+escapeHtml(i.wo)):'')+' &middot; '+wobMoney(i.total)+'</div></div>'; });
      wobShell(h); }
    function wobNew(){ var v=prompt('Vendor / provider for this invoice:'); if(v===null) return; v=v.trim(); if(!v){ alert('Vendor is required.'); return; } var wo=(prompt('Work order ID to link (optional). Leave blank for a standalone invoice. Tip: to pull a repair\'s logged costs in automatically, use the Billing button inside that work order instead:')||'').trim(); var woId=null; if(wo){ woId=parseInt(wo,10); if(isNaN(woId)||woId<0){ alert('Work order ID must be a number, or leave it blank.'); return; } } wobRpc('wo_invoice_create',{p_work_order_id:woId,p_vendor:v},function(r){ wobOpen(r.id); }); }
    function wobOpen(id){ wobOv().innerHTML=wobHead('Invoice','wobLoad()')+'<div style="text-align:center;color:#6b7686;padding:40px;">Loading&hellip;</div>'; wobRpc('wo_invoice_get',{p_id:id},function(d){ _wob.cur=d; wobInvoice(); }); }
    function wobInvoice(){ var iv=_wob.cur; if(!iv) return; var perm=iv.perm||{}; var lines=iv.lines||[]; var locked=(iv.status==='finance_approved'||iv.status==='paid'||iv.status==='void'); var canEdit=perm.mgr&&!locked;
      var h='<div style="max-width:680px;margin:0 auto;">';
      h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:18px;color:#1f2a44;">'+escapeHtml(iv.invoice_number||'')+'</b>'+wobStatusPill(iv.status)+'</div><div style="font-size:12.5px;color:#6b7686;margin-top:3px;">'+escapeHtml(iv.vendor||'(no vendor)')+(iv.work_order&&iv.work_order.wo_number?(' &middot; WO '+escapeHtml(iv.work_order.wo_number)+' — '+escapeHtml(iv.work_order.title||'')):'')+'</div>'+(iv.operational_verified_by?'<div style="font-size:11.5px;color:#9a5b00;margin-top:4px;">Operationally verified by '+escapeHtml(iv.operational_verified_by)+'</div>':'')+(iv.finance_approved_by?'<div style="font-size:11.5px;color:#1b7a3d;">Finance approved by '+escapeHtml(iv.finance_approved_by)+'</div>':'')+(iv.status==='paid'?'<div style="font-size:11.5px;color:#1b7a3d;">Paid'+(iv.payment_ref?(' &middot; ref '+escapeHtml(iv.payment_ref)):'')+(iv.qb_ref?(' &middot; QB '+escapeHtml(iv.qb_ref)):'')+'</div>':'')+(iv.void_reason?'<div style="font-size:11.5px;color:#a01b3e;">Void: '+escapeHtml(iv.void_reason)+'</div>':'')+'</div>';
      var lh=''; lines.forEach(function(l){ lh+='<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f3f4f8;font-size:13px;"><span style="background:#f3eefb;color:#5b3aa6;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px;text-transform:capitalize;">'+escapeHtml(l.kind||'')+'</span><span style="flex:1;color:#33303a;">'+escapeHtml(l.description||'')+' <small style="color:#5b6675;">'+(l.qty||1)+' &times; '+wobMoney(l.rate)+'</small></span><b style="color:#1f2a44;">'+wobMoney(l.amount)+'</b>'+(canEdit?'<button onclick="wobLineDel('+l.id+')" title="Remove line" style="background:none;border:none;color:#c0264b;font-size:18px;cursor:pointer;padding:8px 12px;min-width:40px;line-height:1;border-radius:8px;">&times;</button>':'')+'</div>'; });
      h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:6px;">Line items</div>'+(lh||'<div style="font-size:13px;color:#5b6675;">No line items yet.</div>')+'<div style="display:flex;justify-content:space-between;padding:9px 0 2px;font-size:15px;"><b>Total</b><b style="color:#1f2a44;">'+wobMoney(iv.total)+'</b></div>';
      if(canEdit){ h+='<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;"><select id="wobK" style="padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;"><option value="labor">Labor</option><option value="materials">Materials</option><option value="travel">Travel</option><option value="other">Other</option></select><input id="wobD" placeholder="Description" style="flex:1;min-width:110px;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;"><input id="wobQ" type="number" step="0.1" value="1" style="width:60px;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;"><input id="wobR" type="number" step="0.01" placeholder="rate" style="width:80px;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;"><button onclick="wobLineAdd()" style="background:#185FA5;color:#fff;border:none;border-radius:8px;padding:8px 13px;font-weight:700;cursor:pointer;font-size:13px;">Add</button></div>'; }
      h+='</div>';
      // actions
      var act='';
      if(perm.mgr && !locked && iv.status!=='operational_verified') act+='<button onclick="wobVerify('+iv.id+')" style="flex:1;background:#9a5b00;color:#fff;border:none;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">Operationally verify</button>';
      if(perm.finance && iv.status==='operational_verified') act+='<button onclick="wobApprove('+iv.id+')" style="flex:1;background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">Finance approve</button>';
      if(perm.finance && iv.status==='finance_approved') act+='<button onclick="wobPay('+iv.id+')" style="flex:1;background:#1b7a3d;color:#fff;border:none;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">Mark paid</button>';
      if(perm.finance && iv.status!=='void' && iv.status!=='paid') act+='<button onclick="wobVoid('+iv.id+')" style="background:#fdeaea;color:#a01b3e;border:none;border-radius:9px;padding:11px 14px;font-weight:700;cursor:pointer;">Void</button>';
      if(act) h+='<div style="display:flex;gap:8px;">'+act+'</div>';
      h+='<div style="font-size:11px;color:#5b6675;text-align:center;margin-top:10px;">Separation of duties: the person who operationally verifies an invoice cannot also finance-approve it.</div>';
      h+='</div>'; wobOv().innerHTML=wobHead('Invoice','wobLoad()')+'<div style="max-width:680px;margin:0 auto;padding:16px;">'+h+'</div>'; }
    function wobLineAdd(){ var k=(document.getElementById('wobK')||{}).value||'materials'; var d=(document.getElementById('wobD')||{}).value||''; var q=parseFloat((document.getElementById('wobQ')||{}).value)||1; var r=parseFloat((document.getElementById('wobR')||{}).value)||0; if(!d){ alert('Add a description.'); return; } if(q<0||r<0){ alert('Quantity and rate cannot be negative.'); return; } wobRpc('wo_invoice_line_add',{p_invoice_id:_wob.cur.id,p_kind:k,p_description:d,p_qty:q,p_rate:r},function(){ wobOpen(_wob.cur.id); }); }
    function wobLineDel(id){ wobRpc('wo_invoice_line_remove',{p_line_id:id},function(){ wobOpen(_wob.cur.id); }); }
    function wobVerify(id){ if(!confirm('Confirm the work and charges are correct (operational verification)?')) return; wobRpc('wo_invoice_verify',{p_id:id},function(){ wobOpen(id); }); }
    function wobApprove(id){ if(!confirm('Finance-approve this invoice for payment?')) return; wobRpc('wo_invoice_approve',{p_id:id},function(){ wobOpen(id); },function(e){ alert(e.message||'Could not approve.'); }); }
    function wobPay(id){ var ref=prompt('Payment reference (check #, transfer ID):'); if(ref===null) return; ref=ref.trim(); if(!ref){ alert('Payment reference is required to mark an invoice paid.'); return; } var qb=(prompt('QuickBooks reference (optional):')||'').trim(); wobRpc('wo_invoice_pay',{p_id:id,p_payment_ref:ref,p_qb_ref:qb},function(){ wobOpen(id); }); }
    function wobVoid(id){ var r=prompt('Reason for voiding this invoice:'); if(r===null) return; r=r.trim(); if(!r){ alert('A void reason is required.'); return; } wobRpc('wo_invoice_void',{p_id:id,p_reason:r},function(){ wobOpen(id); }); }
    function wobExport(){ var rows=[['Invoice','Vendor','Status','Work order','Total']]; (_wob.list||[]).forEach(function(i){ rows.push([i.invoice_number,i.vendor||'',i.status,i.wo||'',i.total||0]); }); if(typeof downloadCSV==='function') downloadCSV('maintenance_invoices.csv',rows); }
    function wobRates(){ wobOv().innerHTML=wobHead('Maintenance Billing','')+'<div style="text-align:center;color:#6b7686;padding:40px;">Loading&hellip;</div>'; wobRpc('wo_rate_list',{},function(d){ _wob.rates=d||[]; wobRatesRender(); }); }
    function wobRatesRender(){ var h='<button onclick="wobRateAdd()" style="width:100%;background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;margin-bottom:12px;">&#10133; New rate agreement</button>';
      if(!_wob.rates.length) h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:24px;text-align:center;color:#6b6275;">No rate agreements yet.</div>';
      _wob.rates.forEach(function(r){ h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px 14px;margin-bottom:8px;"><b style="font-size:14px;color:#26242b;">'+escapeHtml(r.vendor||'')+'</b><div style="font-size:12px;color:#6b7686;margin-top:3px;">Labor '+wobMoney(r.labor_rate)+'/hr &middot; Travel '+wobMoney(r.travel_rate)+(r.effective_from?(' &middot; from '+escapeHtml(String(r.effective_from))):'')+(r.effective_to?(' to '+escapeHtml(String(r.effective_to))):'')+'</div>'+(r.notes?'<div style="font-size:11.5px;color:#5b6675;margin-top:2px;">'+escapeHtml(r.notes)+'</div>':'')+'</div>'; });
      wobShell(h); }
    function wobRateAdd(){ var v=prompt('Vendor name:'); if(v===null) return; v=v.trim(); if(!v){ alert('Vendor name is required.'); return; } var lr=(prompt('Labor rate per hour:')||'').trim(); if(lr&&(isNaN(parseFloat(lr))||parseFloat(lr)<0)){ alert('Labor rate must be a number 0 or greater.'); return; } var tr=(prompt('Travel rate (flat or per trip):')||'').trim(); if(tr&&(isNaN(parseFloat(tr))||parseFloat(tr)<0)){ alert('Travel rate must be a number 0 or greater.'); return; } var ef=(prompt('Effective from (YYYY-MM-DD, optional):')||'').trim(); wobRpc('wo_rate_save',{p_payload:{vendor:v,labor_rate:lr,travel_rate:tr,effective_from:ef}},function(){ wobRates(); }); }
    /* =================== END MAINTENANCE BILLING =================== */
    /* ===================== FUNDRAISER HUB ===================== */
    var _fh={tab:'dash',list:[],cur:null,curOrg:null,settings:null,perm:null,orgs:[],tasks:[],taskScope:'all',report:null,filters:{}};
    var FH_FLOW=['Inquiry Received','Initial Review','Awaiting Information','Application Sent','Application Received','Approved & Scheduled','Cards Ordered','Cards Received','Pickup Scheduled','Cards Issued / Active','Return Due Soon','Reconciliation Pending','Receipt / Payout Pending','Completed'];
    function fhOverlay(){ var o=document.getElementById('fundraiserHubModal'); if(!o){ o=document.createElement('div'); o.id='fundraiserHubModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100000;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function fhClose(){ var o=document.getElementById('fundraiserHubModal'); if(o) o.style.display='none'; var m=document.getElementById('fhModal2'); if(m) m.style.display='none'; }
    function fhCanOpen(){ return currentUser && (currentUser.is_developer===true || (typeof isManagerRole==='function'&&isManagerRole())); }
    function fhHeader(title,back){ return '<div style="background:linear-gradient(120deg,#185FA5,#7d1d4b);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:5;">'+(back?'<button onclick="'+back+'" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:13px;cursor:pointer;">&lsaquo; Back</button>':'')+'<b style="flex:1;font-size:16px;">'+title+'</b><button onclick="fhClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">&times;</button></div>'; }
    function fhMoney(n){ var x=parseFloat(n||0); if(isNaN(x)) x=0; return '$'+Math.round(x).toLocaleString(); }
    function fhDate(d){ if(!d) return ''; try{ return new Date(d).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }catch(e){ return String(d).slice(0,10); } }
    function fhVal(id){ var e=document.getElementById(id); return e?String(e.value).trim():''; }
    function fhRpc(name,args,cb,onerr){ withPin(function(pin){ var a=Object.assign({p_username:currentUser.username,p_password:pin},args||{}); supabaseClient.rpc(name,a).then(function(r){ if(r.error){ if(onerr) onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'You do not have access to this.':r.error.message); return; } cb(r.data); }).catch(function(){ if(onerr) onerr({message:'Connection error'}); else alert('Connection error.'); }); }); }
    function openFundraiserHub(){ if(!fhCanOpen()){ alert('The Fundraiser Hub is for the program administrator and leadership.'); return; } _fh.tab='dash'; fhLoading(); fhRpc('fr_settings_get',{},function(d){ _fh.settings=(d&&d.value)||{}; fhLoadDash(); }, function(){ fhLoadDash(); }); }
    function fhLoading(){ fhOverlay().innerHTML=fhHeader('Fundraiser Hub','')+'<div style="text-align:center;padding:50px;color:#6b7686;">Loading&hellip;</div>'; }
    function fhTabs(){ var t=_fh.tab; function b(id,lbl){ return '<button onclick="fhTab(\''+id+'\')" style="flex:1;min-width:88px;background:'+(t===id?'#185FA5':'#eef0f3')+';color:'+(t===id?'#fff':'#5b6472')+';border:none;padding:10px 6px;font-size:12.5px;font-weight:700;cursor:pointer;border-radius:9px;">'+lbl+'</button>'; }
      var h='<div style="display:flex;flex-wrap:wrap;gap:6px;max-width:1000px;margin:12px auto 0;padding:0 16px;">'+b('dash','Dashboard')+b('pipeline','Pipeline')+b('calendar','Calendar')+b('orgs','Organizations')+b('tasks','Tasks')+b('reports','Reports'); if(_fh.perm&&_fh.perm.exec) h+=b('settings','Settings'); h+='</div>'; return h; }
    function fhTab(t){ _fh.tab=t; if(t==='dash') fhLoadDash(); else if(t==='pipeline') fhLoadList(); else if(t==='orgs') fhLoadOrgs(); else if(t==='tasks') fhLoadTasks(); else if(t==='reports') fhLoadReports(); else if(t==='settings') fhLoadSettings(); else if(t==='calendar') fhLoadCalendar(); }
    function fhShell(body){ fhOverlay().innerHTML=fhHeader('Fundraiser Hub','')+fhTabs()+'<div style="max-width:1000px;margin:0 auto;padding:14px 16px 60px;">'+body+'</div>'; }
    function fhPanel(title,body){ return '<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:14px;margin-bottom:12px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">'+title+'</div>'+body+'</div>'; }
    function fhStat(v,l){ return '<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px;text-align:center;"><div style="font-size:18px;font-weight:800;color:#1f2a44;">'+v+'</div><div style="font-size:10.5px;color:#6b6275;">'+l+'</div></div>'; }
    function fhRow(k,v){ return '<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;font-size:12.5px;"><span style="color:#6b6275;">'+k+'</span><span style="color:#26242b;text-align:right;">'+(v==null||v===''?'&mdash;':escapeHtml(String(v)))+'</span></div>'; }
    function fhField(label,id,type){ return '<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">'+label+'</label><input id="'+id+'" type="'+(type||'text')+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'; }
    function fhFieldV(label,id,val){ return '<label style="display:block;font-size:12px;color:#6b7686;margin:7px 0 3px;">'+label+'</label><input id="'+id+'" value="'+(val==null?'':escapeHtml(String(val)))+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'; }
    function fhSelect(label,id,opts){ return '<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">'+label+'</label><select id="'+id+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+(opts||[]).map(function(o){ return '<option>'+escapeHtml(o)+'</option>'; }).join('')+'</select>'; }
    function fhSelV(label,id,opts,val){ return '<label style="display:block;font-size:12px;color:#6b7686;margin:7px 0 3px;">'+label+'</label><select id="'+id+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;">'+(opts||[]).map(function(o){ return '<option'+(o===val?' selected':'')+'>'+escapeHtml(o)+'</option>'; }).join('')+'</select>'; }
    function fhModal(html){ var m=document.getElementById('fhModal2'); if(!m){ m=document.createElement('div'); m.id='fhModal2'; m.style.cssText='position:fixed;inset:0;background:rgba(20,20,30,.5);z-index:100002;display:flex;align-items:center;justify-content:center;padding:16px;'; document.body.appendChild(m); } m.innerHTML='<div style="background:#fff;border-radius:16px;max-width:520px;width:100%;max-height:90vh;overflow:auto;padding:18px;">'+html+'</div>'; m.style.display='flex'; }
    function fhModalClose(){ var m=document.getElementById('fhModal2'); if(m) m.style.display='none'; }
    function fhStatusPill(s){ var c='#eef3fb',t='#185FA5'; if(s==='Completed'){ c='#e8f5ec'; t='#1b7a3d'; } else if(s==='Exception / Discrepancy'){ c='#fdeee8'; t='#c0264b'; } else if(s==='Cards Issued / Active'){ c='#e8f5ec'; t='#1b7a3d'; } else if(/Return/.test(s||'')){ c='#fff4e0'; t='#9a5b00'; } return '<span style="background:'+c+';color:'+t+';font-size:11px;font-weight:800;padding:2px 9px;border-radius:99px;">'+escapeHtml(s||'')+'</span>'; }
    function fhElig(e){ var map={'Watch List':'#c0264b','Temporarily Ineligible':'#c0264b','Do Not Approve':'#c0264b','Preferred Partner':'#1b7a3d','High Impact':'#7d1d4b','Returning':'#185FA5','New':'#8a8594'}; var c=map[e]||'#8a8594'; return '<span style="background:'+c+'22;color:'+c+';font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:99px;">'+escapeHtml(e||'New')+'</span>'; }
    /* ---- Dashboard ---- */
    function fhLoadDash(){ fhLoading(); fhRpc('fr_dashboard',{},function(d){ _fh.perm=d.role; fhRenderDash(d); }); }
    function fhBrief(){ fhRpc('fr_brief',{},function(d){ alert(d.text||'No brief.'); }); }
    function fhRenderDash(d){
      function card(lbl,val,col){ return '<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px;text-align:center;"><div style="font-size:23px;font-weight:800;color:'+(col||'#1f2a44')+';">'+val+'</div><div style="font-size:11px;color:#6b6275;">'+lbl+'</div></div>'; }
      var h='<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">';
      if(_fh.perm&&_fh.perm.admin) h+='<button onclick="fhNew()" style="background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:10px;padding:11px 16px;font-weight:800;cursor:pointer;">&#10133; New fundraiser</button>';
      h+='<button onclick="fhBrief()" style="background:#185FA5;color:#fff;border:none;border-radius:10px;padding:11px 16px;font-weight:700;cursor:pointer;">&#127826; Cherry daily brief</button></div>';
      h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin-bottom:14px;">'+card('New inquiries',d.new_inquiries,'#185FA5')+card('In review',d.in_review)+card('Awaiting app/appr.',d.app_pending)+card('Cards stage',d.cards_stage)+card('Active selling',d.active,'#1b7a3d')+card('Recon pending',d.recon_pending,'#9a5b00')+card('Returns &le;7d',d.returns_due_soon,'#9a5b00')+card('Overdue',d.returns_overdue,'#c0264b')+card('Discrepancies',d.discrepancies,'#c0264b')+card('Pickups this wk',d.pickups_week)+card('Open tasks',d.open_tasks)+card('Card $ out',fhMoney(d.exposure),'#7d1d4b')+'</div>';
      if(d.capacity){ h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:14px;margin-bottom:14px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Capacity &mdash; companywide '+d.capacity.companywide_used+'/'+d.capacity.companywide_limit+'</div>';
        (d.capacity.markets||[]).forEach(function(m){ var pct=m.active_limit>0?Math.min(100,Math.round(100*m.active_used/m.active_limit)):0; var col=pct>=100?'#c0264b':(pct>=80?'#9a5b00':'#1b7a3d'); h+='<div style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;font-size:12.5px;"><span>'+escapeHtml(m.market)+'</span><span style="color:#6b6275;">'+m.active_used+'/'+m.active_limit+' active &middot; '+fhMoney(m.value_used)+'/'+fhMoney(m.value_limit)+'</span></div><div style="background:#eee;border-radius:99px;height:7px;margin-top:3px;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:'+col+';"></div></div></div>'; });
        h+='</div>'; }
      var att=d.attention||[]; h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:14px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">Needs attention</div>';
      if(!att.length) h+='<div style="color:#6b6275;font-size:13px;">Nothing urgent right now.</div>';
      att.forEach(function(x){ h+='<div onclick="fhOpen('+x.id+')" style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid #f0eef4;border-radius:9px;margin-bottom:6px;cursor:pointer;"><span style="background:#fdeee8;color:#c0264b;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px;">'+escapeHtml(x.why)+'</span><b style="flex:1;font-size:13px;">'+escapeHtml(x.org||x.code)+'</b><span style="font-size:11.5px;color:#6b6275;">'+escapeHtml(x.status)+'</span></div>'; });
      h+='</div>'; fhShell(h);
    }
    /* ---- New fundraiser ---- */
    function fhNew(){ var st=_fh.settings||{}; var markets=st.markets||['Las Cruces','Alamogordo','Roswell']; var types=st.org_types||['School','Nonprofit','Sports Team','Church','Community Group','Other'];
      var h='<h3 style="margin:0 0 12px;color:#1f2a44;">New fundraiser inquiry</h3>'+fhField('Organization name','fhn_org','text')+fhSelect('Organization type','fhn_type',types)+fhSelect('Market','fhn_market',markets)+fhField('Organizer name','fhn_cname','text')+fhField('Organizer email','fhn_cemail','email')+fhField('Organizer phone','fhn_cphone','text')+fhField('Cards requested','fhn_cards','number')+'<div id="fhnMsg" style="color:#c0264b;font-size:12.5px;margin:6px 0;"></div><div style="display:flex;gap:8px;"><button onclick="fhTab(\'dash\')" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:11px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="fhCreate()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">Create fundraiser</button></div>';
      fhOverlay().innerHTML=fhHeader('New fundraiser','fhTab(\'dash\')')+'<div style="max-width:560px;margin:0 auto;padding:16px;">'+h+'</div>'; }
    function fhCreate(){ if(!fhVal('fhn_org')){ document.getElementById('fhnMsg').textContent='Organization name is required.'; return; } fhRpc('fr_create',{p_payload:{org_name:fhVal('fhn_org'),org_type:fhVal('fhn_type'),market:fhVal('fhn_market'),contact_name:fhVal('fhn_cname'),contact_email:fhVal('fhn_cemail'),contact_phone:fhVal('fhn_cphone'),cards_requested:parseInt(fhVal('fhn_cards'),10)||0,source:'manual'}},function(r){ fhOpen(r.id); }); }
    /* ---- Pipeline ---- */
    function fhLoadList(){ fhLoading(); fhRpc('fr_list',{p_filters:_fh.filters||{}},function(d){ _fh.list=d||[]; fhRenderList(); }); }
    function fhApplyFilters(){ _fh.filters={q:fhVal('fhq'),status:fhVal('fhfs')}; fhLoadList(); }
    function fhRenderList(){ var statuses=['','Inquiry Received','Initial Review','Awaiting Information','Application Sent','Application Received','Approved & Scheduled','Cards Ordered','Cards Received','Pickup Scheduled','Cards Issued / Active','Return Due Soon','Reconciliation Pending','Exception / Discrepancy','Receipt / Payout Pending','Completed']; var f=_fh.filters||{};
      var h='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;"><input id="fhq" value="'+escapeHtml(f.q||'')+'" placeholder="Search org / code&hellip;" style="flex:1;min-width:140px;padding:8px;border:1px solid #ddd;border-radius:8px;"><select id="fhfs" style="padding:8px;border:1px solid #ddd;border-radius:8px;">'+statuses.map(function(s){ return '<option value="'+escapeHtml(s)+'"'+(f.status===s?' selected':'')+'>'+(s||'All statuses')+'</option>'; }).join('')+'</select><button onclick="fhApplyFilters()" style="background:#185FA5;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer;">Filter</button><button onclick="fhExportCSV()" style="background:#1f7a3d;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;">&#8595; CSV</button>';
      if(_fh.perm&&_fh.perm.admin) h+='<button onclick="fhNew()" style="background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:800;cursor:pointer;">&#10133; New</button>';
      h+='</div>';
      if(!_fh.list.length) h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:30px;text-align:center;color:#6b6275;">No fundraisers match.</div>';
      _fh.list.forEach(function(x){ h+='<div onclick="fhOpen('+x.id+')" style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:13px 14px;margin-bottom:8px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.04);"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14.5px;color:#26242b;">'+escapeHtml(x.org||'(no org)')+'</b>'+fhStatusPill(x.status)+'</div><div style="font-size:11.5px;color:#6b6275;margin-top:3px;">'+escapeHtml(x.code)+' &middot; '+escapeHtml(x.market||'&mdash;')+' &middot; '+(x.cards_approved||0)+' cards &middot; Next: '+escapeHtml(x.next_action)+(x.overdue?' &middot; <span style="color:#c0264b;font-weight:700;">OVERDUE</span>':'')+'</div></div>'; });
      fhShell(h); }
    /* ---- Record ---- */
    function fhOpen(id){ fhLoading(); fhRpc('fr_get',{p_id:id},function(d){ _fh.cur=d; fhRenderRecord(); }); }
    function fhAdvanceButtons(f){ if(f.locked) return '<span style="font-size:12px;color:#5b6675;">Record locked &mdash; completed.</span>'; if(!(f.perm&&f.perm.admin)) return ''; var i=FH_FLOW.indexOf(f.status); var nxt=(i>=0&&i<FH_FLOW.length-1)?FH_FLOW[i+1]:null; var h=''; if(nxt) h+='<button onclick="fhDoAdvance(\''+nxt.replace(/'/g,"\\'")+'\',false)" style="background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:9px 14px;font-weight:800;cursor:pointer;">Advance &rarr; '+escapeHtml(nxt)+'</button>'; h+='<button onclick="fhStatusPicker()" style="background:#eef3fb;color:#185FA5;border:none;border-radius:9px;padding:9px 12px;font-weight:700;cursor:pointer;">Change status&hellip;</button>'; return h; }
    function fhDoAdvance(to,override){ var meta={}; if(override){ var reason=prompt('Override reason (recorded in the audit trail):'); if(reason===null) return; meta.reason=reason; } fhRpc('fr_advance',{p_id:_fh.cur.id,p_to:to,p_meta:meta,p_override:!!override},function(){ fhOpen(_fh.cur.id); },function(err){ var msg=String(err.message||''); if(msg.indexOf('needs:')>=0 && _fh.cur.perm && _fh.cur.perm.exec){ if(confirm(msg+'\n\nApprove an executive override?')) fhDoAdvance(to,true); } else { alert(msg.indexOf('forbidden')>=0?'Managers only.':msg); } }); }
    function fhStatusPicker(){ var all=['Inquiry Received','Initial Review','Awaiting Information','Application Sent','Application Received','Waitlisted','Approved & Scheduled','Cards Ordered','Cards Received','Pickup Scheduled','Cards Issued / Active','Return Due Soon','Reconciliation Pending','Exception / Discrepancy','Receipt / Payout Pending','Completed','Deferred','Declined','Withdrawn','Cancelled','Closed Incomplete']; var ov=(_fh.cur.perm&&_fh.cur.perm.exec); var h='<h3 style="margin:0 0 10px;">Change status</h3><select id="fhsp" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin-bottom:10px;">'+all.map(function(s){ return '<option'+(s===_fh.cur.status?' selected':'')+'>'+escapeHtml(s)+'</option>'; }).join('')+'</select>'; if(ov) h+='<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;margin-bottom:10px;"><input type="checkbox" id="fhspov"> Executive override (skip required-field checks; audited)</label>'; h+='<div style="display:flex;gap:8px;"><button onclick="fhModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="fhApplyStatus()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Apply</button></div>'; fhModal(h); }
    function fhApplyStatus(){ var to=document.getElementById('fhsp').value; var ov=document.getElementById('fhspov'); fhModalClose(); fhDoAdvance(to, ov&&ov.checked); }
    function fhAct(lbl,fn){ return '<button onclick="'+fn+'" style="background:#fff;border:1px solid #e6e6ee;color:#185FA5;border-radius:9px;padding:8px 11px;font-size:12.5px;font-weight:700;cursor:pointer;">'+lbl+'</button>'; }
    function fhDetailRows(f){ return fhRow('Status',f.status)+fhRow('Organizer',(f.contact&&f.contact.name)||'&mdash;')+fhRow('Pickup store',f.pickup_store)+fhRow('Assigned mgr',f.assigned_manager)+fhRow('Approved sell',(f.approved_start||'?')+' &rarr; '+(f.approved_end||'?'))+fhRow('Return due',f.return_due)+fhRow('Pickup',f.pickup_at?fhDate(f.pickup_at):'&mdash;'); }
    function fhCardRows(f){ var out=((f.cards_issued||0)-(f.cards_returned||0)-(f.cards_voided||0))*(f.face_value||20); return fhRow('Requested',f.cards_requested)+fhRow('Approved',f.cards_approved)+fhRow('Ordered',f.cards_ordered)+fhRow('Received',f.cards_received)+fhRow('Issued',f.cards_issued)+fhRow('Sold',f.cards_sold)+fhRow('Returned',f.cards_returned)+fhRow('Missing',f.cards_missing)+fhRow('Outstanding $',fhMoney(out)); }
    function fhFinanceRows(f){ var model=f.financial_model==='100_return_payout'?'100% return &mdash; organizer returns all; Caliche pays org 50%':'50/50 &mdash; organizer keeps 50%, returns Caliche 50%'; return fhRow('Model',model)+fhRow('Face value',fhMoney(f.face_value))+fhRow('Gross sold',f.gross_sold!=null?fhMoney(f.gross_sold):'&mdash;')+fhRow('Caliche share',f.caliches_share!=null?fhMoney(f.caliches_share):'&mdash;')+fhRow('Org proceeds',f.org_share!=null?fhMoney(f.org_share):'&mdash;')+fhRow('Payout to org',f.payout_amount!=null?fhMoney(f.payout_amount):'&mdash;')+fhRow('Received',f.amount_received!=null?fhMoney(f.amount_received):'&mdash;')+fhRow('Variance',f.variance!=null?fhMoney(f.variance):'&mdash;')+fhRow('Receipt #',f.receipt_number); }
    function fhEventText(e){ if(e.kind==='status') return '<b>'+escapeHtml(e.to_status||'')+'</b>'+(e.from_status?' (from '+escapeHtml(e.from_status)+')':'')+(e.detail?' &mdash; '+escapeHtml(e.detail):''); if(e.kind==='card') return '&#127183; '+escapeHtml(e.detail||''); if(e.kind==='financial') return '&#128181; '+escapeHtml(e.detail||''); if(e.kind==='approval') return '&#9878; '+escapeHtml(e.detail||''); if(e.kind==='task') return '&#9989; '+escapeHtml(e.detail||''); return escapeHtml(e.detail||e.kind||''); }
    function fhRenderRecord(){ var f=_fh.cur; if(!f) return; var perm=f.perm||{};
      var h='<div style="max-width:760px;margin:0 auto;padding:16px;">';
      h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;"><div style="display:flex;align-items:flex-start;gap:8px;"><div style="flex:1;"><div style="font-size:18px;font-weight:800;color:#1f2a44;">'+escapeHtml((f.org&&f.org.name)||'(no org)')+'</div><div style="font-size:12px;color:#6b7686;">'+escapeHtml(f.code)+' &middot; '+escapeHtml(f.market||'&mdash;')+' &middot; Owner: '+escapeHtml(f.owner||'&mdash;')+(f.locked?' &middot; &#128274; Locked':'')+'</div></div>'+fhStatusPill(f.status)+'</div><div style="font-size:12.5px;color:#33303a;margin-top:8px;">Next: <b>'+escapeHtml(f.next_action)+'</b></div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">'+fhAdvanceButtons(f)+'</div></div>';
      if(perm.admin&&!f.locked) h+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">'+fhAct('&#9998; Edit details','fhEdit()')+fhAct('&#127183; Card move','fhCardMove()')+fhAct('&#129534; Reconcile','fhReconcile()')+fhAct('&#9989; Add task','fhAddTask()')+fhAct('&#128221; Note','fhAddNote()')+fhAct('&#128196; Receipt','fhGenReceipt()')+fhAct('&#128279; Organizer link','fhOrgPortal()')+'</div>';
      h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:0;">'+fhPanel('Schedule &amp; details',fhDetailRows(f))+fhPanel('Cards',fhCardRows(f))+'</div>';
      h+=fhPanel('Financial',fhFinanceRows(f));
      var tasks=f.tasks||[]; var th=''; if(!tasks.length) th='<div style="color:#5b6675;font-size:13px;">No tasks.</div>'; tasks.forEach(function(t){ th+='<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f3f4f8;"><span style="flex:1;font-size:13px;'+(t.status==='done'?'color:#5b6675;text-decoration:line-through;':'')+'">'+escapeHtml(t.title)+(t.due_date?' &middot; <small style="color:#5b6675;">due '+escapeHtml(t.due_date)+'</small>':'')+'</span>'+(t.status!=='done'&&perm.access?'<button onclick="fhTaskDone('+t.id+')" style="background:#1f7a3d;color:#fff;border:none;border-radius:7px;padding:4px 9px;font-size:11.5px;cursor:pointer;">Done</button>':'')+'</div>'; });
      h+=fhPanel('Tasks',th);
      var tl=f.timeline||[]; var lh=''; tl.forEach(function(e){ lh+='<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #f6f6fa;"><span style="font-size:10px;color:#5b6675;white-space:nowrap;min-width:42px;">'+fhDate(e.created_at)+'</span><span style="font-size:12.5px;color:#33303a;flex:1;">'+fhEventText(e)+'<small style="color:#5b6675;"> &mdash; '+escapeHtml(e.actor||'')+'</small></span></div>'; });
      h+=fhPanel('Activity timeline ('+tl.length+')',lh||'<div style="color:#5b6675;">No activity.</div>');
      h+='</div>'; fhOverlay().innerHTML=fhHeader('Fundraiser','fhTab(\'pipeline\')')+h; }
    function fhEdit(){ var f=_fh.cur; var st=_fh.settings||{}; var stores=st.pickup_stores||['Roadrunner','Valley','Lenox','Alamogordo','Roswell']; var markets=st.markets||['Las Cruces','Alamogordo','Roswell'];
      var h='<h3 style="margin:0 0 10px;">Edit fundraiser</h3>'+fhSelV('Market','fhe_market',markets,f.market)+fhSelV('Pickup store','fhe_pickup',stores,f.pickup_store)+fhFieldV('Assigned manager','fhe_mgr',f.assigned_manager)+fhFieldV('Approved start (YYYY-MM-DD)','fhe_as',f.approved_start)+fhFieldV('Approved end (YYYY-MM-DD)','fhe_ae',f.approved_end)+fhFieldV('Return due (YYYY-MM-DD)','fhe_rd',f.return_due)+fhFieldV('Cards approved','fhe_ca',f.cards_approved)+fhFieldV('Cards ordered','fhe_co',f.cards_ordered)+((f.perm&&f.perm.exec)?fhSelV('Financial model','fhe_fm',['50_50_return','100_return_payout'],f.financial_model):'')+'<div id="fheMsg" style="color:#c0264b;font-size:12px;margin:6px 0;"></div><div style="display:flex;gap:8px;"><button onclick="fhModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="fhSaveEdit()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Save</button></div>'; fhModal(h); }
    function fhSaveEdit(){ var p={market:fhVal('fhe_market'),pickup_store:fhVal('fhe_pickup'),assigned_manager:fhVal('fhe_mgr'),approved_start:fhVal('fhe_as'),approved_end:fhVal('fhe_ae'),return_due:fhVal('fhe_rd'),cards_approved:fhVal('fhe_ca'),cards_ordered:fhVal('fhe_co')}; var fm=document.getElementById('fhe_fm'); if(fm) p.financial_model=fm.value; fhRpc('fr_update',{p_id:_fh.cur.id,p_patch:p},function(){ fhModalClose(); fhOpen(_fh.cur.id); },function(err){ var m=document.getElementById('fheMsg'); if(m) m.textContent=String(err.message||'Error'); }); }
    function fhCardMove(){ var h='<h3 style="margin:0 0 10px;">Record card movement</h3>'+fhSelV('Type','fhcm_type',['receive','issue','return','void','redeem'],'issue')+fhFieldV('Quantity','fhcm_qty','')+fhFieldV('Employee (releasing/receiving)','fhcm_emp','')+fhFieldV('Organizer / party','fhcm_party','')+fhFieldV('Evidence (signature / photo note)','fhcm_ev','')+'<div style="display:flex;gap:8px;margin-top:8px;"><button onclick="fhModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="fhSaveMove()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Record</button></div>'; fhModal(h); }
    function fhSaveMove(){ var q=parseInt(fhVal('fhcm_qty'),10); if(!q){ alert('Quantity required'); return; } fhRpc('fr_card_move',{p_payload:{fundraiser_id:_fh.cur.id,move_type:fhVal('fhcm_type'),quantity:q,employee:fhVal('fhcm_emp'),to_party:fhVal('fhcm_party'),evidence:fhVal('fhcm_ev')}},function(){ fhModalClose(); fhOpen(_fh.cur.id); }); }
    function fhReconcile(){ var f=_fh.cur; var h='<h3 style="margin:0 0 4px;">Reconcile fundraiser</h3><div style="font-size:12px;color:#6b6275;margin-bottom:8px;">Issued: '+(f.cards_issued||0)+' &middot; Model: '+(f.financial_model==='100_return_payout'?'100% return + payout':'50/50 return')+'</div>'+fhFieldV('Cards sold','fhr_sold',f.cards_sold)+fhFieldV('Unsold returned','fhr_ret',f.cards_returned)+fhFieldV('Voided/damaged','fhr_void',f.cards_voided)+fhFieldV('Amount received ($)','fhr_recv',f.amount_received)+fhFieldV('Receipt number','fhr_rcpt',f.receipt_number)+fhFieldV('Deposit reference','fhr_dep',f.deposit_ref)+'<div id="fhrOut" style="font-size:12.5px;color:#1f2a44;margin:8px 0;"></div><div style="display:flex;gap:8px;"><button onclick="fhModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="fhSaveReconcile()" style="flex:2;background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Calculate &amp; save</button></div>'; fhModal(h); }
    function fhSaveReconcile(){ fhRpc('fr_reconcile',{p_id:_fh.cur.id,p_payload:{cards_sold:parseInt(fhVal('fhr_sold'),10)||0,cards_returned:parseInt(fhVal('fhr_ret'),10)||0,cards_voided:parseInt(fhVal('fhr_void'),10)||0,amount_received:parseFloat(fhVal('fhr_recv'))||0,receipt_number:fhVal('fhr_rcpt'),deposit_ref:fhVal('fhr_dep')}},function(r){ var o=document.getElementById('fhrOut'); if(o) o.innerHTML='Gross '+fhMoney(r.gross)+' &middot; Caliche '+fhMoney(r.caliches)+' &middot; Org '+fhMoney(r.org)+' &middot; Variance '+fhMoney(r.variance)+(r.discrepancy?' &middot; &#9888; discrepancy':' &middot; &#10003; balanced'); setTimeout(function(){ fhModalClose(); fhOpen(_fh.cur.id); },1500); }); }
    function fhAddTask(){ var h='<h3 style="margin:0 0 10px;">Add task</h3>'+fhFieldV('Task','fht_title','')+fhSelV('Assign to role','fht_scope',['admin','store','finance','leadership'],'admin')+fhFieldV('Assignee name','fht_assignee','')+fhFieldV('Due date (YYYY-MM-DD)','fht_due','')+'<div style="display:flex;gap:8px;margin-top:8px;"><button onclick="fhModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="fhSaveTask()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Add</button></div>'; fhModal(h); }
    function fhSaveTask(){ if(!fhVal('fht_title')){ alert('Task required'); return; } fhRpc('fr_task_save',{p_payload:{fundraiser_id:_fh.cur.id,title:fhVal('fht_title'),role_scope:fhVal('fht_scope'),assignee:fhVal('fht_assignee'),due_date:fhVal('fht_due')}},function(){ fhModalClose(); fhOpen(_fh.cur.id); }); }
    function fhTaskDone(id){ fhRpc('fr_task_complete',{p_id:id},function(){ fhOpen(_fh.cur.id); }); }
    function fhAddNote(){ var n=prompt('Add an internal note:'); if(!n) return; fhRpc('fr_update',{p_id:_fh.cur.id,p_patch:{note:n}},function(){ fhOpen(_fh.cur.id); }); }
    function fhGenReceipt(){ var f=_fh.cur; if(f.gross_sold==null){ alert('Reconcile the fundraiser first.'); return; } var r='<div id="fhReceipt" style="font-family:Georgia,serif;color:#222;"><div style="text-align:center;border-bottom:2px solid #ec3e7e;padding-bottom:8px;margin-bottom:10px;"><div style="font-size:20px;font-weight:800;color:#ec3e7e;">Caliche Fundraiser Receipt</div><div style="font-size:12px;color:#666;">'+escapeHtml(f.code)+'</div></div>'+fhRow('Organization',(f.org&&f.org.name)||'')+fhRow('Receipt #',f.receipt_number||'&mdash;')+fhRow('Cards sold',(f.cards_sold||0)+' @ '+fhMoney(f.face_value))+fhRow('Gross value',fhMoney(f.gross_sold))+fhRow('Organization proceeds',fhMoney(f.org_share))+fhRow('Caliche share',fhMoney(f.caliches_share))+fhRow('Amount received',fhMoney(f.amount_received))+fhRow('Variance',fhMoney(f.variance))+'<div style="margin-top:10px;font-size:11px;color:#6b7686;">Generated '+new Date().toLocaleDateString()+'</div></div>'; fhModal(r+'<div style="display:flex;gap:8px;margin-top:12px;"><button onclick="fhModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Close</button><button onclick="fhPrintReceipt()" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Print / Save PDF</button></div>'); }
    function fhPrintReceipt(){ var c=document.getElementById('fhReceipt'); if(!c) return; var w=window.open('','_blank'); if(!w) return; w.document.write('<html><head><title>Receipt</title></head><body style="font-family:Georgia,serif;padding:24px;">'+c.innerHTML+'</body></html>'); w.document.close(); w.print(); }
    /* ---- Organizations ---- */
    function fhLoadOrgs(){ fhLoading(); fhRpc('fr_org_list',{p_q:''},function(d){ _fh.orgs=d||[]; fhRenderOrgs(); }); }
    function fhOrgSearch(){ fhRpc('fr_org_list',{p_q:fhVal('fhoq')},function(d){ _fh.orgs=d||[]; fhRenderOrgs(); }); }
    function fhRenderOrgs(){ var h='<div style="display:flex;gap:6px;margin-bottom:12px;"><input id="fhoq" placeholder="Search organizations&hellip;" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;"><button onclick="fhOrgSearch()" style="background:#185FA5;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer;">Search</button>'+((_fh.perm&&_fh.perm.admin)?'<button onclick="fhOrgEdit(null)" style="background:var(--caliches-pink,#ec3e7e);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:800;cursor:pointer;">&#10133; Org</button>':'')+'</div>';
      if(!_fh.orgs.length) h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:30px;text-align:center;color:#6b6275;">No organizations yet.</div>';
      _fh.orgs.forEach(function(o){ h+='<div onclick="fhOpenOrg('+o.id+')" style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer;"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;">'+escapeHtml(o.name)+'</b>'+fhElig(o.eligibility)+'</div><div style="font-size:11.5px;color:#6b6275;margin-top:3px;">'+escapeHtml(o.type||'')+(o.market?' &middot; '+escapeHtml(o.market):'')+' &middot; '+(o.fundraisers||0)+' fundraisers &middot; '+fhMoney(o.lifetime_proceeds)+' raised</div></div>'; });
      fhShell(h); }
    function fhOpenOrg(id){ fhLoading(); fhRpc('fr_org_get',{p_id:id},function(o){ _fh.curOrg=o; fhRenderOrg(o); }); }
    function fhRenderOrg(o){ var s=o.stats||{}; var h='<div style="max-width:720px;margin:0 auto;padding:16px;">';
      h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;"><div style="display:flex;align-items:center;gap:8px;"><div style="flex:1;"><div style="font-size:18px;font-weight:800;color:#1f2a44;">'+escapeHtml(o.name)+'</div><div style="font-size:12px;color:#6b7686;">'+escapeHtml(o.org_type||'')+(o.market?' &middot; '+escapeHtml(o.market):'')+'</div></div>'+fhElig(o.eligibility)+'</div>'+((o.perm&&o.perm.admin)?'<button onclick="fhOrgEdit('+o.id+')" style="margin-top:8px;background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:700;cursor:pointer;">Edit organization</button>':'')+'</div>';
      h+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;">'+fhStat(s.fundraisers||0,'fundraisers')+fhStat(s.cards_sold||0,'cards sold')+fhStat(fhMoney(s.proceeds),'raised')+fhStat((s.sell_through!=null?s.sell_through+'%':'&mdash;'),'sell-through')+'</div>';
      var fr=o.fundraisers||[]; var fh2=''; fr.forEach(function(x){ fh2+='<div onclick="fhOpen('+x.id+')" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f3f4f8;cursor:pointer;font-size:13px;"><span style="flex:1;">'+escapeHtml(x.code)+'</span>'+fhStatusPill(x.status)+'<span style="color:#6b6275;">'+fhMoney(x.org_share)+'</span></div>'; });
      h+=fhPanel('Fundraiser history',fh2||'<div style="color:#5b6675;">No fundraisers yet.</div>');
      var ct=o.contacts||[]; var ch=''; ct.forEach(function(c){ ch+=fhRow(escapeHtml(c.name)+(c.role?' ('+escapeHtml(c.role)+')':''),(c.email||'')+' '+(c.phone||'')); }); h+=fhPanel('Contacts',ch||'<div style="color:#5b6675;">No contacts.</div>');
      h+='</div>'; fhOverlay().innerHTML=fhHeader('Organization','fhTab(\'orgs\')')+h; }
    function fhOrgEdit(id){ var o=(id&&_fh.curOrg&&_fh.curOrg.id===id)?_fh.curOrg:{}; var st=_fh.settings||{}; var types=st.org_types||['School','Nonprofit','Sports Team','Church','Community Group','Other']; var markets=st.markets||['Las Cruces','Alamogordo','Roswell']; var eligs=['New','Returning','Preferred Partner','High Impact','Watch List','Temporarily Ineligible','Do Not Approve']; var canElig=(_fh.perm&&_fh.perm.exec)||(o&&o.can_edit_eligibility);
      var h='<h3 style="margin:0 0 10px;">'+(id?'Edit':'New')+' organization</h3>'+fhFieldV('Name','fho_name',o.name)+fhSelV('Type','fho_type',types,o.org_type)+fhSelV('Market','fho_market',markets,o.market)+fhFieldV('City','fho_city',o.city)+fhFieldV('Website','fho_web',o.website)+(canElig?fhSelV('Eligibility (internal)','fho_elig',eligs,o.eligibility):'')+fhFieldV('Notes (internal)','fho_notes',o.notes)+'<div style="display:flex;gap:8px;margin-top:8px;"><button onclick="fhModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="fhSaveOrg('+(id||'null')+')" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Save</button></div>'; fhModal(h); }
    function fhSaveOrg(id){ if(!fhVal('fho_name')){ alert('Name required'); return; } var p={name:fhVal('fho_name'),org_type:fhVal('fho_type'),market:fhVal('fho_market'),city:fhVal('fho_city'),website:fhVal('fho_web'),notes:fhVal('fho_notes')}; if(id) p.id=id; var el=document.getElementById('fho_elig'); if(el) p.eligibility=el.value; fhRpc('fr_org_save',{p_payload:p},function(r){ fhModalClose(); if(id) fhOpenOrg(id); else fhLoadOrgs(); }); }
    /* ---- Tasks ---- */
    function fhLoadTasks(){ fhLoading(); fhRpc('fr_task_list',{p_scope:_fh.taskScope||'all'},function(d){ _fh.tasks=d||[]; fhRenderTasks(); }); }
    function fhRenderTasks(){ var sc=_fh.taskScope||'all'; function b(id,l){ return '<button onclick="_fh.taskScope=\''+id+'\';fhLoadTasks()" style="background:'+(sc===id?'#185FA5':'#eef0f3')+';color:'+(sc===id?'#fff':'#5b6472')+';border:none;border-radius:8px;padding:7px 11px;font-size:12px;font-weight:700;cursor:pointer;">'+l+'</button>'; }
      var h='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">'+b('all','All')+b('mine','Mine')+b('program','Program')+b('store','Store')+b('leadership','Leadership')+'</div>';
      if(!_fh.tasks.length) h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:30px;text-align:center;color:#6b6275;">No open tasks.</div>';
      _fh.tasks.forEach(function(t){ h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:8px;"><div style="flex:1;"><div style="font-size:13.5px;font-weight:600;color:#26242b;">'+escapeHtml(t.title)+'</div><div style="font-size:11.5px;color:#6b6275;">'+escapeHtml(t.org||'')+(t.code?' &middot; '+escapeHtml(t.code):'')+(t.due_date?' &middot; due '+escapeHtml(t.due_date):'')+(t.overdue?' &middot; <span style="color:#c0264b;font-weight:700;">overdue</span>':'')+'</div></div>'+(t.fundraiser_id?'<button onclick="fhOpen('+t.fundraiser_id+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:7px;padding:5px 10px;font-size:11.5px;cursor:pointer;">Open</button>':'')+'<button onclick="fhTaskDoneList('+t.id+')" style="background:#1f7a3d;color:#fff;border:none;border-radius:7px;padding:5px 10px;font-size:11.5px;cursor:pointer;">Done</button></div>'; });
      fhShell(h); }
    function fhTaskDoneList(id){ fhRpc('fr_task_complete',{p_id:id},function(){ fhLoadTasks(); }); }
    /* ---- Reports ---- */
    function fhLoadReports(){ fhLoading(); fhRpc('fr_report',{},function(d){ _fh.report=d; fhRenderReports(d); }); }
    function fhRenderReports(d){ var im=d.impact||{},op=d.operational||{},fi=d.financial||{};
      var h=fhPanel('Community impact','<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">'+fhStat(im.orgs||0,'organizations')+fhStat(im.cards_sold||0,'cards sold')+fhStat(fhMoney(im.org_proceeds),'community raised')+fhStat(im.completed||0,'completed')+fhStat(fhMoney(im.avg_raised),'avg / fundraiser')+'</div><div style="margin-top:10px;font-size:11px;font-weight:800;color:#6b6275;">TOP ORGANIZATIONS</div>'+(((im.top_orgs||[]).map(function(o){ return '<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0;border-bottom:1px solid #f3f4f8;"><span>'+escapeHtml(o.name)+'</span><span style="color:#1b7a3d;">'+fhMoney(o.proceeds)+'</span></div>'; }).join(''))||'<div style="color:#5b6675;">No data yet.</div>'));
      h+=fhPanel('Operational','<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">'+fhStat(op.active||0,'active')+fhStat((op.sell_through!=null?op.sell_through+'%':'&mdash;'),'sell-through')+fhStat((op.discrepancy_rate||0)+'%','discrepancy rate')+'</div>');
      h+=fhPanel('Financial &amp; control','<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">'+fhStat(fhMoney(fi.gross_sold),'gross sold')+fhStat(fhMoney(fi.caliches_share),'Caliche share')+fhStat(fhMoney(fi.org_proceeds),'org proceeds')+fhStat(fhMoney(fi.outstanding_exposure),'card $ outstanding')+fhStat(fi.missing_cards||0,'missing cards')+'</div>');
      var rel=d.relationship||[]; var rh=''; rel.forEach(function(r){ rh+='<div style="display:flex;align-items:center;gap:8px;font-size:12.5px;padding:4px 0;border-bottom:1px solid #f3f4f8;"><span style="flex:1;">'+escapeHtml(r.name)+'</span>'+fhElig(r.eligibility)+'<span style="color:#6b6275;width:54px;text-align:right;">'+(r.sell_through!=null?r.sell_through+'%':'&mdash;')+'</span><span style="color:#1b7a3d;width:80px;text-align:right;">'+fhMoney(r.proceeds)+'</span></div>'; });
      h+=fhPanel('Partner value (explainable)',rh||'<div style="color:#5b6675;">No data yet.</div>');
      fhShell(h); }
    /* ---- Calendar ---- */
    function fhLoadCalendar(){ fhLoading(); fhRpc('fr_list',{p_filters:{}},function(d){ _fh.list=d||[]; fhRenderCalendar(); }); }
    function fhRenderCalendar(){ var items=[]; _fh.list.forEach(function(x){ if(x.approved_start) items.push({d:x.approved_start,t:'Selling starts',x:x}); if(x.return_due) items.push({d:x.return_due,t:'Return due',x:x}); }); items.sort(function(a,b){ return (a.d<b.d?-1:1); });
      var today=new Date().toISOString().slice(0,10);
      var h='<div style="font-size:12px;color:#6b6275;margin-bottom:10px;">Upcoming selling starts and return deadlines across all markets.</div>';
      if(!items.length) h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:30px;text-align:center;color:#6b6275;">Nothing scheduled.</div>';
      items.forEach(function(it){ var od=(it.d<today); h+='<div onclick="fhOpen('+it.x.id+')" style="background:#fff;border:1px solid #ececf2;border-radius:10px;padding:10px 12px;margin-bottom:6px;cursor:pointer;display:flex;align-items:center;gap:10px;"><div style="min-width:52px;text-align:center;font-size:11px;color:#6b6275;">'+escapeHtml(String(it.d).slice(5))+'</div><div style="flex:1;"><b style="font-size:13px;">'+escapeHtml(it.x.org||it.x.code)+'</b><div style="font-size:11.5px;color:'+(it.t==='Return due'?'#9a5b00':'#185FA5')+';">'+it.t+(od?' &middot; <span style="color:#c0264b;">overdue</span>':'')+'</div></div>'+fhStatusPill(it.x.status)+'</div>'; });
      fhShell(h); }
    /* ---- Settings ---- */
    function fhLoadSettings(){ fhLoading(); fhRpc('fr_settings_get',{},function(d){ _fh.settings=d.value; fhRenderSettings(d); }); }
    function fhSetRow(label,id,val,canEdit){ return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;"><span style="flex:1;font-size:12.5px;color:#5b6472;">'+label+'</span><input id="'+id+'" '+(canEdit?'':'disabled')+' value="'+(val==null?'':escapeHtml(String(val)))+'" style="width:150px;padding:7px;border:1px solid #ddd;border-radius:7px;'+(canEdit?'':'background:#f6f6f8;color:#6b7686;')+'"></div>'; }
    function fhSetSel(label,id,opts,val,canEdit){ return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;"><span style="flex:1;font-size:12.5px;color:#5b6472;">'+label+'</span><select id="'+id+'" '+(canEdit?'':'disabled')+' style="width:170px;padding:7px;border:1px solid #ddd;border-radius:7px;">'+opts.map(function(o){ return '<option'+(o===val?' selected':'')+'>'+o+'</option>'; }).join('')+'</select></div>'; }
    function fhRenderSettings(d){ var v=d.value||{}; var canEdit=d.can_edit; var cap=v.capacity||{}; var mk=cap.markets||{};
      var h='<div style="font-size:12px;color:#6b6275;margin-bottom:10px;">Program policy (version '+(d.version||1)+'). '+(canEdit?'Editable by leadership; every change is versioned.':'Read-only for your role.')+'</div>';
      h+=fhPanel('Cards &amp; financial',fhSetRow('Card face value ($)','fhs_face',v.face_value,canEdit)+fhSetSel('Default financial model','fhs_model',['50_50_return','100_return_payout'],v.financial_model,canEdit)+fhSetRow('Selling window (days)','fhs_sell',v.selling_window_days,canEdit)+fhSetRow('Return grace (days)','fhs_grace',v.return_grace_days,canEdit)+fhSetRow('Min cards','fhs_min',v.min_cards,canEdit)+fhSetRow('Max cards','fhs_max',v.max_cards,canEdit)+fhSetRow('First-time max','fhs_first',v.first_time_max,canEdit)+fhSetRow('Approval threshold (cards)','fhs_appr',v.approval_threshold_cards,canEdit));
      var mh=fhSetRow('Companywide active limit','fhs_cw',cap.companywide_active,canEdit); Object.keys(mk).forEach(function(m){ var k=m.replace(/[^a-z]/gi,''); mh+=fhSetRow(m+' active limit','fhs_m_'+k,mk[m].active,canEdit)+fhSetRow(m+' card $ limit','fhs_v_'+k,mk[m].card_value,canEdit); });
      h+=fhPanel('Capacity by market',mh);
      h+=fhPanel('Season',fhSetRow('Season open (YYYY-MM-DD)','fhs_so',v.season_open,canEdit)+fhSetRow('Season close','fhs_sc',v.season_close,canEdit)+fhSetSel('Public applications','fhs_appstat',['open','closed'],v.applications_status,canEdit));
      if(canEdit) h+='<button onclick="fhSaveSettings()" style="width:100%;background:#185FA5;color:#fff;border:none;border-radius:10px;padding:12px;font-weight:800;cursor:pointer;">Save settings</button>';
      fhShell(h); }
    function fhSaveSettings(){ var v=Object.assign({},_fh.settings||{}); v.face_value=parseFloat(fhVal('fhs_face'))||20; v.financial_model=fhVal('fhs_model'); v.selling_window_days=parseInt(fhVal('fhs_sell'),10)||14; v.return_grace_days=parseInt(fhVal('fhs_grace'),10)||7; v.min_cards=parseInt(fhVal('fhs_min'),10)||0; v.max_cards=parseInt(fhVal('fhs_max'),10)||0; v.first_time_max=parseInt(fhVal('fhs_first'),10)||0; v.approval_threshold_cards=parseInt(fhVal('fhs_appr'),10)||0; v.season_open=fhVal('fhs_so'); v.season_close=fhVal('fhs_sc'); v.applications_status=fhVal('fhs_appstat'); var cap=v.capacity||{markets:{}}; cap.companywide_active=parseInt(fhVal('fhs_cw'),10)||0; var mk=cap.markets||{}; Object.keys(mk).forEach(function(m){ var k=m.replace(/[^a-z]/gi,''); mk[m].active=parseInt(fhVal('fhs_m_'+k),10)||0; mk[m].card_value=parseFloat(fhVal('fhs_v_'+k))||0; }); cap.markets=mk; v.capacity=cap; fhRpc('fr_settings_save',{p_value:v},function(){ alert('Settings saved.'); fhLoadSettings(); }); }
    /* =================== END FUNDRAISER HUB =================== */
    function woScope(){ return _wo.tab==='queue'?'queue':((_wo.tab==='board'||_wo.tab==='history')?(woIsMgr()?'all':'mine'):'mine'); }
    function woLoad(cb){
        var ov=woOverlay(); ov.innerHTML=woHeader('Work Orders','')+'<div style="max-width:680px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading&hellip;</div>';
        withPin(function(pin){
            Promise.all([
                supabaseClient.rpc('app_wo_list',{p_username:currentUser.username,p_password:pin,p_scope:woScope()}),
                supabaseClient.rpc('app_wo_people',{p_username:currentUser.username,p_password:pin}),
                supabaseClient.rpc('app_equipment_list',{p_username:currentUser.username,p_password:pin,p_store:(currentUser.store||currentUser.location||'')})
            ]).then(function(res){
                if(res[0].error){ ov.innerHTML=woHeader('Work Orders','')+'<div style="max-width:680px;margin:0 auto;padding:30px 16px;color:#c0264b;text-align:center;">'+(String(res[0].error.message||'').indexOf('forbidden')>=0?'Not available for your role.':escapeHtml(res[0].error.message))+'</div>'; return; }
                _wo.list=res[0].data||[]; _wo.people=(res[1]&&res[1].data)||{maint:[]}; _wo.equip=(res[2]&&res[2].data)||[];
                if(cb)cb();
            }).catch(function(){ ov.innerHTML=woHeader('Work Orders','')+'<div style="max-width:680px;margin:0 auto;padding:30px 16px;color:#c0264b;text-align:center;">Connection error.</div>'; });
        }, function(){ ov.innerHTML=woHeader('Work Orders','')+'<div style="max-width:680px;margin:0 auto;padding:30px 16px;color:#6b7686;text-align:center;">PIN required.</div>'; });
    }
    function woTabs(){ var t=_wo.tab; function b(id,lbl,show){ if(!show) return ''; return '<button onclick="woSetTab(&quot;'+id+'&quot;)" style="flex:1;background:'+(t===id?'#D85A30':'#eef0f3')+';color:'+(t===id?'#fff':'#5b6472')+';border:none;padding:10px;font-size:13px;font-weight:700;cursor:pointer;border-radius:9px;">'+lbl+'</button>'; }
        return '<div style="display:flex;gap:6px;max-width:680px;margin:14px auto 0;padding:0 16px;">'+b('report','Report',true)+b('board','Board',woIsMgr())+b('queue','My Queue',woIsMaint()||woIsMgr())+b('history','Completed',woIsMgr()||woIsMaint())+'</div>'; }
    function woSetTab(t){ _wo.preset=null; _wo.tab=t; try{lsSet('woTab',t);}catch(e){} if(t==='report'){ woRender(); } else { woLoad(function(){ woRender(); }); } }
    function woRender(){ var ov=woOverlay(); var body=_wo.tab==='report'?woReportHtml():(_wo.tab==='history'?woHistoryHtml():woBoardHtml()); ov.innerHTML=woHeader('Work Orders','')+woTabs()+'<div style="max-width:680px;margin:0 auto;padding:14px 16px 40px;">'+body+'</div>'; }
    function woPriColor(p){ return {critical:'#c0264b',high:'#b8860b',medium:'#185FA5',low:'#6b7686'}[p]||'#6b7686'; }
    function woStatusChip(s){ var m={'Reported':['#eef0f3','#5b6472'],'Assigned':['#eef3fb','#185FA5'],'In Progress':['#fff4e0','#9a5b00'],'On Hold':['#fdeee8','#a85217'],'Documented':['#f3eefb','#5b3aa6'],'Verified':['#e8f5ec','#1b7a3d'],'Closed':['#e8f5ec','#1b7a3d'],'Cancelled':['#f0f0f0','#999999']}; var c=m[s]||m['Reported']; return '<span style="background:'+c[0]+';color:'+c[1]+';font-size:11px;font-weight:800;padding:2px 9px;border-radius:99px;white-space:nowrap;">'+escapeHtml(s||'')+'</span>'; }
    function woField(id,label,val){ return '<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">'+label+'</label><input id="'+id+'" value="'+String(val||'').replace(/"/g,'&quot;')+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;font-size:13px;">'; }
    function woSelect(id,label,opts,sel){ return '<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">'+label+'</label><select id="'+id+'" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;font-size:13px;">'+opts.map(function(o){ var lbl=o===''?'—':o.replace(/_/g,' '); return '<option value="'+o+'"'+(o===sel?' selected':'')+'>'+lbl+'</option>'; }).join('')+'</select>'; }
    function woVal(id){ var e=document.getElementById(id); return e?e.value:''; }
    function woAssetField(){ var eq=(_wo.equip||[]); if(!eq.length){ return woField('woAsset','Equipment / item','')+'<input type="hidden" id="woAssetSel" value="">'; } var opts='<option value="">&mdash; select equipment &mdash;</option>'+eq.map(function(e){return '<option value="'+e.id+'">'+escapeHtml(e.name||('#'+e.id))+'</option>';}).join('')+'<option value="__other__">Other / not listed</option>'; var h='<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">Equipment / item</label>'; h+='<select id="woAssetSel" onchange="woAssetPick()" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;font-size:13px;">'+opts+'</select>'; h+='<input id="woAsset" placeholder="Describe the item" value="" style="display:none;width:100%;margin-top:6px;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;font-size:13px;">'; return h; }
    function woAssetPick(){ var s=document.getElementById('woAssetSel'); var t=document.getElementById('woAsset'); if(!s||!t)return; t.style.display=(s.value==='__other__')?'block':'none'; if(s.value!=='__other__') t.value=''; }
    function woCompress(file, cb){ var rd=new FileReader(); rd.onload=function(e){ var img=new Image(); img.onload=function(){ try{ var c=document.createElement('canvas'); var sc=Math.min(1000/img.width,1); c.width=Math.round(img.width*sc); c.height=Math.round(img.height*sc); c.getContext('2d').drawImage(img,0,0,c.width,c.height); cb(c.toDataURL('image/jpeg',0.6)); }catch(e2){ cb(null); } }; img.onerror=function(){ cb(null); }; img.src=e.target.result; }; rd.onerror=function(){ cb(null); }; rd.readAsDataURL(file); }
    function woRepPhotoPick(ev){ var fs=ev.target.files; if(!fs||!fs.length) return; _wo.repPhotos=_wo.repPhotos||[]; var arr=Array.prototype.slice.call(fs); ev.target.value=''; var done=0; arr.forEach(function(f){ woCompress(f,function(d){ if(d)_wo.repPhotos.push(d); done++; if(done===arr.length) woRepPhotoRender(); }); }); }
    function woRepPhotoRender(){ var c=document.getElementById('woRepPhotoCount'); var p=document.getElementById('woRepPhotoPrev'); var a=_wo.repPhotos||[]; if(c)c.textContent=a.length?(a.length+' photo'+(a.length>1?'s':'')+' attached'):''; if(p)p.innerHTML=a.map(function(d,i){return '<div style="position:relative;display:inline-block;"><img src="'+d+'" style="width:54px;height:54px;object-fit:cover;border-radius:8px;border:1px solid #ddd;"><span onclick="woRepPhotoDel('+i+')" style="position:absolute;top:-6px;right:-6px;background:#c0264b;color:#fff;border-radius:50%;width:18px;height:18px;font-size:12px;line-height:18px;text-align:center;cursor:pointer;">&times;</span></div>';}).join(''); }
    function woRepPhotoDel(i){ (_wo.repPhotos||[]).splice(i,1); woRepPhotoRender(); }
    function woLoadPhotos(won){ var box=document.getElementById('woPhotoList'); if(!box) return; withPin(function(pin){ supabaseClient.rpc('app_wo_photos',{p_username:currentUser.username,p_password:pin,p_wo_number:won}).then(function(r){ if(r.error){ box.innerHTML='<span style="font-size:12.5px;color:#c0264b;">Could not load photos.</span>'; return; } var ph=r.data||[]; if(!ph.length){ box.innerHTML='<span style="font-size:12.5px;color:#5b6675;">No photos yet.</span>'; return; } box.innerHTML=ph.map(function(d){return '<img src="'+d+'" onclick="woPhotoView(this.src)" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #ddd;cursor:pointer;">';}).join(''); }).catch(function(){ box.innerHTML='<span style="font-size:12.5px;color:#c0264b;">Could not load photos.</span>'; }); }); }
    function woPhotoView(src){ woModal('<div style="background:#fff;border-radius:12px;padding:10px;max-width:92%;max-height:88%;overflow:auto;text-align:center;"><img src="'+src+'" style="max-width:100%;max-height:78vh;border-radius:8px;"><br><button onclick="woModalClose()" style="margin-top:10px;padding:9px 16px;border:none;background:#185FA5;color:#fff;border-radius:8px;font-weight:700;cursor:pointer;">Close</button></div>'); }
    function woDetailPhotoPick(ev){ var fs=ev.target.files; if(!fs||!fs.length) return; var won=window._woDetailWoNum; if(!won) return; var box=document.getElementById('woPhotoList'); if(box) box.innerHTML='<span style="font-size:12.5px;color:#5b6675;">Uploading&hellip;</span>'; var arr=Array.prototype.slice.call(fs); ev.target.value=''; withPin(function(pin){ var i=0; (function up(){ if(i>=arr.length){ woLoadPhotos(won); return; } woCompress(arr[i],function(d){ if(!d){ i++; up(); return; } supabaseClient.rpc('app_wo_add_photo',{p_username:currentUser.username,p_password:pin,p_wo_number:won,p_photo:d}).then(function(){ i++; up(); }).catch(function(){ i++; up(); }); }); })(); }); }
    function woReportForEquipment(equipId){
        equipId=parseInt(equipId,10)||0; if(!equipId){ if(typeof openWorkOrders==='function') openWorkOrders(); return; }
        _wo.preset={assetId:equipId,assetLabel:'',store:''}; _wo.tab='report';
        var ov=woOverlay(); ov.innerHTML=woHeader('Work Orders','')+'<div style="max-width:680px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading&hellip;</div>';
        withPin(function(pin){
            supabaseClient.rpc('app_equipment_get',{p_username:currentUser.username,p_password:pin,p_id:equipId}).then(function(r){
                if(r&&r.data){ _wo.preset.assetLabel=r.data.name||''; _wo.preset.store=r.data.store||''; }
                woLoad(function(){ woRender(); woApplyPreset(); });
            }).catch(function(){ woLoad(function(){ woRender(); woApplyPreset(); }); });
        });
    }
    function woApplyPreset(){
        var p=_wo.preset; if(!p||!p.assetId) return;
        var st=document.getElementById('woStore'); if(st && p.store){ for(var i=0;i<st.options.length;i++){ if(st.options[i].value===p.store){ st.selectedIndex=i; break; } } }
        var sel=document.getElementById('woAssetSel');
        if(sel){ if(sel.tagName==='SELECT'){ var found=false; for(var j=0;j<sel.options.length;j++){ if(parseInt(sel.options[j].value,10)===parseInt(p.assetId,10)){ sel.selectedIndex=j; found=true; break; } } if(!found){ var o=document.createElement('option'); o.value=p.assetId; o.text=p.assetLabel||('#'+p.assetId); try{ sel.add(o, sel.options[sel.options.length-1]); }catch(e){ sel.add(o); } o.selected=true; } if(typeof woAssetPick==='function') woAssetPick(); }
            else { sel.value=p.assetId; var ta=document.getElementById('woAsset'); if(ta) ta.value=p.assetLabel||''; } }
        var msg=document.getElementById('woRepMsg'); if(msg && p.assetLabel){ msg.style.color='#185FA5'; msg.textContent='\uD83D\uDCCD Reporting a problem with: '+p.assetLabel; }
        var ti=document.getElementById('woTitle'); if(ti){ try{ ti.focus(); }catch(e){} }
    }
    function woReportHtml(){ _wo.repPhotos=[];
        var stores=((typeof HUB_STORES!=='undefined'?HUB_STORES.slice():['Roadrunner','Valley','Lenox','Alamogordo','Roswell']).concat(['Warehouse']));
        var def=(currentUser.store||currentUser.location||'Roadrunner');
        var h='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;">';
        h+='<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#5b6675;margin-bottom:8px;">Report a maintenance issue</div>';
        h+=woField('woTitle','What is wrong?','');
        h+=woField('woItem','Item / part affected (e.g. fryer, walk-in door handle)','');
        h+='<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">Details</label><textarea id="woDesc" style="width:100%;height:64px;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;font-size:13px;"></textarea>';
        h+=woSelect('woStore','Store / location',stores,def);
        h+=woAssetField();
        h+=woSelect('woCat','Type',['repair','damage','safety','other'],'repair');
        h+='<label style="display:block;font-size:12px;color:#6b7686;margin:8px 0 3px;">Priority</label><select id="woPri" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;font-size:13px;"><option value="low">Low &ndash; when convenient</option><option value="medium" selected>Medium &ndash; soon</option><option value="high">High &ndash; affects service</option><option value="critical">Critical &ndash; safety or stop-work</option></select>';
        h+=woSelect('woUse','Equipment status',['','in_use','backup','out_of_service'],'');
        h+='<label style="display:flex;align-items:center;gap:8px;margin:10px 0;font-size:13px;cursor:pointer;"><input type="checkbox" id="woSafety"> This is a safety issue</label>';
        h+='<div id="woRepMsg" style="font-size:12.5px;color:#c0264b;margin:6px 0;"></div>';
        h+='<div style="margin-top:10px;"><label style="display:inline-block;background:#185FA5;color:#fff;border-radius:8px;padding:8px 13px;font-size:13px;font-weight:700;cursor:pointer;">&#128247; Add photo<input type="file" accept="image/*" capture="environment" multiple onchange="woRepPhotoPick(event)" style="display:none;"></label><span id="woRepPhotoCount" style="font-size:12px;color:#6b7686;margin-left:8px;"></span><div id="woRepPhotoPrev" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;"></div></div>';
        h+='<button onclick="woSubmitReport()" style="width:100%;background:#D85A30;color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:800;cursor:pointer;">Submit work order</button>';
        h+='</div>';
        return h;
    }
    function woSubmitReport(){
        var t=woVal('woTitle').trim(); if(!t){ document.getElementById('woRepMsg').textContent='Describe what is wrong.'; return; }
        var safety=document.getElementById('woSafety').checked;
        var _item=woVal('woItem').trim();
        var _sel=document.getElementById('woAssetSel'); var _aid=null, _alabel=woVal('woAsset');
        if(_sel && _sel.value && _sel.value!=='__other__'){ _aid=parseInt(_sel.value,10); _alabel=((_sel.options[_sel.selectedIndex]||{}).text||_alabel); }
        withPin(function(pin){
            supabaseClient.rpc('app_wo_create',{p_username:currentUser.username,p_password:pin,p_title:t,p_description:(_item?'Item/part: '+_item+'\n':'')+woVal('woDesc'),p_asset_id:_aid,p_asset_label:_alabel,p_location:woVal('woStore'),p_category:woVal('woCat'),p_priority:woVal('woPri'),p_equipment_use_status:woVal('woUse')||null,p_safety_impact:safety}).then(function(r){
                if(r.error){ document.getElementById('woRepMsg').textContent=r.error.message; return; }
                var _won=(r.data&&r.data.wo_number)||''; var _ph=(_wo.repPhotos||[]); var _finish=function(){ _wo.repPhotos=[]; alert('Work order '+_won+' created'+(_ph.length?(' with '+_ph.length+' photo'+(_ph.length>1?'s':'')):'')+'.'); _wo.tab=woIsMgr()?'board':'queue'; woLoad(function(){ woRender(); }); }; if(_ph.length && _won){ var _i=0; (function _up(){ if(_i>=_ph.length){ _finish(); return; } supabaseClient.rpc('app_wo_add_photo',{p_username:currentUser.username,p_password:pin,p_wo_number:_won,p_photo:_ph[_i]}).then(function(){ _i++; _up(); }).catch(function(){ _i++; _up(); }); })(); } else { _finish(); }
            }).catch(function(){ document.getElementById('woRepMsg').textContent='Could not submit.'; });
        });
    }
    function woIsDone(s){ return ['Closed','Cancelled','Verified'].indexOf(s)>=0; }
    function woCardHtml(w){ var x='<div onclick="woOpenDetail('+w.id+')" style="background:#fff;border:1px solid #ececf2;border-left:4px solid '+woPriColor(w.priority)+';border-radius:12px;padding:12px 14px;margin-bottom:9px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.04);">'; x+='<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(w.title||'')+'</b>'+woStatusChip(w.status)+'</div>'; x+='<div style="font-size:11.5px;color:#5b6675;margin-top:3px;">'+escapeHtml(w.wo_number||'')+' &middot; '+escapeHtml(w.location||'')+(w.asset_label?(' &middot; '+escapeHtml(w.asset_label)):'')+(w.safety?' &middot; &#9888; safety':'')+'</div>'; x+='</div>'; return x; }
    function woHistoryHtml(){ var done=(_wo.list||[]).filter(function(w){return woIsDone(w.status);}); var h='<div style="font-size:12px;color:#5b6675;margin:0 2px 10px;">Completed &amp; past work orders'+(woIsMgr()?'':' assigned to you')+' &middot; '+done.length+' total</div>'; if(!done.length){ return h+'<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:20px;text-align:center;color:#6b6275;">No completed work orders yet.</div>'; } done.forEach(function(w){ h+=woCardHtml(w); }); return h; }
    function woBoardHtml(){
        var _act=(_wo.list||[]).filter(function(w){return !woIsDone(w.status);});
        if(!_act.length){ return '<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:20px;text-align:center;color:#6b6275;">No open work orders'+(_wo.tab==='queue'?' assigned to you':'')+' right now.</div>'; }
        var h='';
        _act.forEach(function(w){
            h+='<div onclick="woOpenDetail('+w.id+')" style="background:#fff;border:1px solid #ececf2;border-left:4px solid '+woPriColor(w.priority)+';border-radius:12px;padding:12px 14px;margin-bottom:9px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.04);">';
            h+='<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:14px;color:#26242b;">'+escapeHtml(w.title||'')+'</b>'+woStatusChip(w.status)+'</div>';
            h+='<div style="font-size:11.5px;color:#5b6675;margin-top:3px;">'+escapeHtml(w.wo_number||'')+' &middot; '+escapeHtml(w.location||'')+(w.asset_label?(' &middot; '+escapeHtml(w.asset_label)):'')+(w.safety?' &middot; &#9888; safety':'')+'</div>';
            h+='</div>';
        });
        return h;
    }
    function woOpenDetail(id){
        window._woDetailId=id; var ov=woOverlay(); ov.innerHTML=woHeader('Work Order','woRender()')+'<div style="max-width:640px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading&hellip;</div>';
        withPin(function(pin){ supabaseClient.rpc('app_wo_detail',{p_username:currentUser.username,p_password:pin,p_id:id}).then(function(r){ if(r.error||!r.data){ ov.innerHTML=woHeader('Work Order','woRender()')+'<div style="max-width:640px;margin:0 auto;padding:30px;color:#c0264b;text-align:center;">Could not load.</div>'; return; } woRenderDetail(r.data); }); });
    }
    function woFmt(t){ if(!t) return ''; try{ var d=new Date(t); return (d.getMonth()+1)+'/'+d.getDate()+' '+d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }
    function woRenderDetail(d){
        var ov=woOverlay(); var ev=d.events||[];
        var h='<div style="max-width:640px;margin:0 auto;padding:16px;">';
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;"><div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:17px;color:#1f2a44;">'+escapeHtml(d.title||'')+'</b>'+woStatusChip(d.status)+'</div>';
        h+='<div style="font-size:12px;color:#5b6675;margin-top:3px;">'+escapeHtml(d.wo_number||'')+' &middot; '+escapeHtml(d.location||'')+' &middot; <span style="color:'+woPriColor(d.priority)+';font-weight:700;">'+escapeHtml(d.priority||'')+'</span>'+(d.safety_impact?' &middot; &#9888; safety':'')+'</div>';
        if(d.description) h+='<div style="font-size:13.5px;color:#33303a;margin-top:8px;">'+escapeHtml(d.description)+'</div>';
        if(d.asset_label) h+='<div style="font-size:12.5px;color:#6b7686;margin-top:6px;">Equipment: '+escapeHtml(d.asset_label)+(d.equipment_use_status?(' ('+escapeHtml(String(d.equipment_use_status).replace(/_/g,' '))+')'):'')+'</div>';
        if(d.work_performed) h+='<div style="margin-top:8px;background:#f3f8ff;border:1px solid #d8e7fb;border-radius:9px;padding:9px;font-size:13px;color:#1f2a44;"><b>Work performed:</b> '+escapeHtml(d.work_performed)+'</div>';
        if(d.verification_required && d.status==='Documented') h+='<div style="margin-top:8px;font-size:12px;color:#a85217;font-weight:700;">&#9888; Awaiting operational verification before it can close.</div>';
        h+='</div>';
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;margin-bottom:12px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#5b6675;margin-bottom:8px;">Status timeline</div>';
        if(!ev.length) h+='<div style="font-size:13px;color:#5b6675;">No events.</div>';
        ev.forEach(function(e){ h+='<div style="display:flex;gap:9px;padding:5px 0;border-bottom:1px solid #f3f4f8;"><div style="font-size:11.5px;color:#5b6675;white-space:nowrap;min-width:62px;">'+woFmt(e.at)+'</div><div style="font-size:12.5px;color:#33303a;"><b>'+escapeHtml(e.to_status||e.type||'')+'</b> &middot; '+escapeHtml(e.actor||'')+(e.note?(' &mdash; '+escapeHtml(e.note)):'')+'</div></div>'; });
        h+='</div>';
        h+='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:14px;margin-bottom:12px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#5b6675;margin-bottom:8px;">Photos</div><div id="woPhotoList" style="display:flex;flex-wrap:wrap;gap:8px;"><span style="font-size:12.5px;color:#5b6675;">Loading&hellip;</span></div><label style="display:inline-block;margin-top:10px;background:#185FA5;color:#fff;border-radius:8px;padding:8px 13px;font-size:13px;font-weight:700;cursor:pointer;">&#128247; Add photo<input type="file" accept="image/*" capture="environment" multiple onchange="woDetailPhotoPick(event)" style="display:none;"></label></div>';
        h+='<div id="woCostBox" style="margin-bottom:12px;"></div>';
        if(woIsMgr()) h+='<div style="margin-bottom:12px;"><button onclick="woOpenBilling()" style="width:100%;background:#1f7a3d;color:#fff;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:800;cursor:pointer;">&#128179; Billing &amp; invoices for this work order</button></div>';
        h+='<div style="margin-bottom:12px;"><button onclick="openContactsDir()" style="width:100%;background:#185FA5;color:#fff;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:800;cursor:pointer;">&#128199; Vendor / important contacts</button></div>';
        h+=woActions(d);
        h+='</div>';
        ov.innerHTML=woHeader(d.wo_number||'Work Order','woRender()')+h;
        window._woDetailWoNum=d.wo_number; window._woDetailId=d.id; woLoadCosts(d.id); woLoadPhotos(d.wo_number);
    }
    function woOpenBilling(){
        var woId=window._woDetailId, woNum=window._woDetailWoNum||'';
        wobRpc('wo_invoice_list',{p_filters:{}},function(list){
            var mine=(list||[]).filter(function(i){return i.wo===woNum;});
            if(mine.length===1) return wobOpen(mine[0].id);
            if(mine.length>1){ _wob.tab='invoices'; _wob.list=mine; wobRender(); return; }
            var v=prompt('Vendor for this invoice \u2014 leave blank for in-house Caliche\'s Maintenance. Any costs already logged on this work order are pulled in automatically:'); if(v===null) return;
            wobRpc('wo_invoice_from_wo',{p_work_order_id:woId,p_vendor:v},function(c){ wobOpen(c.id); });
        });
    }
    function woBtn(label,onclick,bg,fg){ return '<button onclick="'+onclick+'" style="width:100%;background:'+bg+';color:'+(fg||'#fff')+';border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:800;cursor:pointer;">'+label+'</button>'; }
    function woActions(d){
        var canM=d.can_manage, canW=d.can_work, s=d.status, lead=(currentUser.role==='Maintenance Lead');
        var btns=[];
        if(canM && s==='Reported') btns.push(woBtn('Assign / route','woAssign('+d.id+')','#185FA5'));
        if(canW && (s==='Reported'||s==='Assigned')) btns.push(woBtn('Start work','woAct(&quot;start&quot;)','#D85A30'));
        if(canW && s==='In Progress'){ btns.push(woBtn('Document completion','woDocPrompt()','#1f7a3d')); btns.push(woBtn('Put on hold','woAct(&quot;hold&quot;)','#9a5b00')); }
        if(canW && s==='On Hold') btns.push(woBtn('Resume','woAct(&quot;resume&quot;)','#D85A30'));
        if((canM||lead) && s==='Documented') btns.push(woBtn('Verify &amp; close','woAct(&quot;verify&quot;)','#1f7a3d'));
        if((canM||lead) && s==='Closed') btns.push(woBtn('Reopen','woAct(&quot;reopen&quot;)','#9a5b00'));
        if(canM && s!=='Closed' && s!=='Cancelled' && s!=='Documented' && s!=='Reported') btns.push(woBtn('Reassign','woAssign('+d.id+')','#eef0f3','#5b6472'));
        // CANCEL ACTION (2026-07-17, audit_maintenance.md H5): 'Cancelled' was already a
        // defined terminal status (woIsDone/woStatusChip) but no control ever set it, so a
        // mis-reported/duplicate WO had to be pushed through the full lifecycle or sit open
        // forever. Same manager-tier gate (canM) as Assign/Reassign above -- no new permission
        // scheme. Hidden once the WO is already done (woIsDone covers Closed/Cancelled/Verified).
        if(canM && !woIsDone(s)) btns.push(woBtn('Cancel work order','woAct(&quot;cancel&quot;)','#fdeaea','#a01b3e'));
        if(!btns.length) return '';
        return '<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:8px;">'+btns.join('')+'</div>';
    }
    function woAct(action,workPerformed){
        var id=window._woDetailId; var note='';
        if(action==='hold'){ note=prompt('Reason for hold (optional):')||''; }
        if(action==='verify'){ note=prompt('Verification note (what you confirmed):')||''; }
        if(action==='reopen'){ note=prompt('Why are you reopening this?')||''; if(!note) return; }
        if(action==='cancel'){ if(!confirm('Cancel this work order? It will be marked Cancelled and kept in history — this cannot be undone from here.')) return; }
        withPin(function(pin){
            supabaseClient.rpc('app_wo_advance',{p_username:currentUser.username,p_password:pin,p_id:id,p_action:action,p_note:note,p_work_performed:workPerformed||null}).then(function(r){
                if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Not permitted for your role.':r.error.message); return; }
                woOpenDetail(id);
            }).catch(function(){ alert('Could not update.'); });
        });
    }
    function woDocPrompt(){ var wp=prompt('Describe the work performed (required):'); if(wp===null) return; if(!String(wp).trim()){ alert('Work documentation is required.'); return; } woAct('document',String(wp).trim()); }
    function woModal(html){ var m=document.getElementById('woModal2'); if(!m){ m=document.createElement('div'); m.id='woModal2'; m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100001;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:16px;box-sizing:border-box;'; document.body.appendChild(m); } m.innerHTML=html; m.style.display='flex'; return m; }
    function woModalClose(){ var m=document.getElementById('woModal2'); if(m)m.style.display='none'; }
    function woAssign(id){
        var maint=(_wo.people&&_wo.people.maint)||[];
        var opts='<option value="">&mdash; unchanged &mdash;</option>'+maint.map(function(p){return '<option value="'+p.id+'">'+escapeHtml(p.name)+' ('+escapeHtml(p.role)+')</option>';}).join('');
        var h='<div style="background:#fff;border-radius:14px;max-width:480px;width:100%;margin-top:20px;padding:18px;box-shadow:0 16px 50px rgba(0,0,0,.3);"><h3 style="margin:0 0 12px;color:#1f2a44;">Assign / route work order</h3>';
        h+='<label style="display:block;font-size:12px;color:#6b7686;margin-bottom:3px;">Owner (Maintenance)</label><select id="woaOwner" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin-bottom:8px;box-sizing:border-box;">'+opts+'</select>';
        h+='<label style="display:block;font-size:12px;color:#6b7686;margin-bottom:3px;">Backup (covers if owner is unavailable)</label><select id="woaBackup" style="width:100%;padding:9px;border:1px solid #ddd;border-radius:8px;margin-bottom:8px;box-sizing:border-box;">'+opts+'</select>';
        h+='<div id="woaMsg" style="font-size:12.5px;color:#c0264b;margin:6px 0;"></div>';
        h+='<div style="display:flex;gap:8px;"><button onclick="woModalClose()" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:11px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="woDoAssign('+id+')" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">Save</button></div></div>';
        woModal(h);
    }
    function woDoAssign(id){
        var owner=woVal('woaOwner'), backup=woVal('woaBackup');
        withPin(function(pin){
            supabaseClient.rpc('app_wo_assign',{p_username:currentUser.username,p_password:pin,p_id:id,p_assigned_to:owner?parseInt(owner,10):null,p_backup_to:backup?parseInt(backup,10):null,p_delegated_to:null,p_delegation_until:null,p_vendor_id:null}).then(function(r){
                if(r.error){ document.getElementById('woaMsg').textContent=(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; }
                woModalClose(); woOpenDetail(id);
            }).catch(function(){ document.getElementById('woaMsg').textContent='Could not save.'; });
        });
    }
    function woMoney(n){ var x=parseFloat(n||0); return '$'+(isNaN(x)?'0.00':x.toFixed(2)); }
    function woLoadCosts(id){
        var box=document.getElementById('woCostBox'); if(!box) return;
        withPin(function(pin){
            supabaseClient.rpc('app_wo_cost_list',{p_username:currentUser.username,p_password:pin,p_id:id}).then(function(r){
                if(r.error||!r.data){ box.innerHTML=''; return; }
                woRenderCosts(id,r.data);
            }).catch(function(){ box.innerHTML=''; });
        });
    }
    function woRenderCosts(id,c){
        var box=document.getElementById('woCostBox'); if(!box) return;
        var lines=c.lines||[];
        var h='<div style="background:#fff;border:1px solid #ececf2;border-radius:14px;padding:16px;">';
        h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><div style="flex:1;font-size:11px;font-weight:800;text-transform:uppercase;color:#5b6675;">Costs &amp; pricing</div>'+(c.approved?('<span style="background:#e8f5ec;color:#1b7a3d;font-size:11px;font-weight:800;padding:2px 9px;border-radius:99px;">&#10003; Approved'+(c.approved_by?(' &middot; '+escapeHtml(c.approved_by)):'')+'</span>'):'')+'</div>';
        if(!lines.length) h+='<div style="font-size:13px;color:#5b6675;">No costs entered yet. Amounts vary by job &mdash; add each part, labor, or vendor charge below.</div>';
        lines.forEach(function(l){ h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f3f4f8;font-size:13px;"><span style="background:#f3eefb;color:#5b3aa6;font-size:10px;font-weight:800;padding:2px 7px;border-radius:99px;text-transform:capitalize;">'+escapeHtml(l.kind||'')+'</span><span style="flex:1;color:#33303a;">'+escapeHtml(l.description||'')+'</span><b style="color:#1f2a44;">'+woMoney(l.amount)+'</b>'+(c.can_edit?'<button onclick="woRemoveCost('+l.id+','+id+')" style="background:none;border:none;color:#c0264b;font-size:16px;cursor:pointer;line-height:1;">&times;</button>':'')+'</div>'; });
        h+='<div style="display:flex;justify-content:space-between;padding:9px 0 2px;font-size:14px;"><b>Total</b><b style="color:#1f2a44;">'+woMoney(c.total)+'</b></div>';
        if(c.can_edit){
            h+='<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;"><select id="woCostKind" style="padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;"><option value="parts">Parts</option><option value="labor">Labor</option><option value="vendor">Vendor</option><option value="other">Other</option></select><input id="woCostDesc" placeholder="Description" style="flex:1;min-width:120px;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;"><input id="woCostAmt" type="number" step="0.01" placeholder="0.00" style="width:92px;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;"><button onclick="woAddCost('+id+')" style="background:#185FA5;color:#fff;border:none;border-radius:8px;padding:8px 13px;font-weight:700;cursor:pointer;font-size:13px;">Add</button></div>';
        }
        if(c.can_approve && lines.length){ h+='<button onclick="woApproveCost('+id+','+(c.approved?'false':'true')+')" style="width:100%;margin-top:10px;background:'+(c.approved?'#eef0f3':'#1f7a3d')+';color:'+(c.approved?'#5b6472':'#fff')+';border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;font-size:14px;">'+(c.approved?'Remove approval':('Approve costs ('+woMoney(c.total)+')'))+'</button>'; }
        else if(!c.can_approve && lines.length && !c.approved){ h+='<div style="margin-top:10px;font-size:11.5px;color:#5b6675;text-align:center;">Awaiting Finance Approver sign-off.</div>'; }
        h+='</div>'; box.innerHTML=h;
    }
    function woAddCost(id){
        var kind=woVal('woCostKind'), desc=woVal('woCostDesc'), amt=parseFloat(woVal('woCostAmt'));
        if(isNaN(amt)){ alert('Enter an amount.'); return; }
        withPin(function(pin){ supabaseClient.rpc('app_wo_cost_add',{p_username:currentUser.username,p_password:pin,p_id:id,p_kind:kind,p_description:desc,p_amount:amt}).then(function(r){ if(r.error){ alert(r.error.message); return; } woLoadCosts(id); }).catch(function(){ alert('Could not add.'); }); });
    }
    function woRemoveCost(lineId,id){ withPin(function(pin){ supabaseClient.rpc('app_wo_cost_remove',{p_username:currentUser.username,p_password:pin,p_line_id:lineId,p_id:id}).then(function(r){ if(r.error){ alert(r.error.message); return; } woLoadCosts(id); }); }); }
    function woApproveCost(id,approve){ withPin(function(pin){ supabaseClient.rpc('app_wo_cost_approve',{p_username:currentUser.username,p_password:pin,p_id:id,p_approve:approve}).then(function(r){ if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Finance approver only.':r.error.message); return; } woLoadCosts(id); }); }); }
    function openContactsDir(){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){v.style.display='none';});
        document.getElementById('contactsDirView').style.display='block'; window.scrollTo(0,0);
        var sel=document.getElementById('cdStore');
        if(sel && !sel.getAttribute('data-init')){ var s=(currentUser&&(currentUser.store||currentUser.location))||''; for(var i=0;i<sel.options.length;i++){ if(sel.options[i].value===s){ sel.selectedIndex=i; break; } } sel.setAttribute('data-init','1'); }
        loadContactsDir();
    }
    function loadContactsDir(){
        var box=document.getElementById('cdList'); if(!box) return;
        box.innerHTML='<p style="text-align:center;color:#6b7686;padding:20px;">Loading&hellip;</p>';
        var store=document.getElementById('cdStore').value;
        withPin(function(pin){
            supabaseClient.rpc('app_contacts_list',{p_username:currentUser.username,p_password:pin,p_location:store}).then(function(r){
                if(r.error){ box.innerHTML='<p style="color:#c0264b;text-align:center;padding:20px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                window._cdList=r.data||[]; renderContactsDir();
            }).catch(function(){ box.innerHTML='<p style="color:#c0264b;text-align:center;">Could not load.</p>'; });
        });
    }
    function cdDigits(s){ return String(s||'').replace(/[^0-9+]/g,''); }
    function priBadge(p){
        var m={emergency:['#fdeaea','#a01b3e','After-hours / Emergency'],preferred:['#e8f5ec','#1b7a3d','Preferred'],backup:['#eef0f3','#6b7686','Backup']};
        var c=m[(p||'preferred')]||m.preferred;
        return '<span style="background:'+c[0]+';color:'+c[1]+';font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:99px;white-space:nowrap;">'+c[2]+'</span>';
    }
    function contactCardHtml(c){
        var acts='';
        if(c.phone) acts+='<a href="tel:'+cdDigits(c.phone)+'" style="flex:1;min-width:70px;text-align:center;background:#1f7a3d;color:#fff;border-radius:8px;padding:8px;font-size:12.5px;font-weight:700;text-decoration:none;">&#128222; Call</a>';
        if(c.after_hours) acts+='<a href="tel:'+cdDigits(c.after_hours)+'" style="flex:1;min-width:70px;text-align:center;background:#9a5b00;color:#fff;border-radius:8px;padding:8px;font-size:12.5px;font-weight:700;text-decoration:none;">&#127769; After-hrs</a>';
        if(c.text_number) acts+='<a href="sms:'+cdDigits(c.text_number)+'" style="flex:1;min-width:60px;text-align:center;background:#eef3fb;color:#185FA5;border-radius:8px;padding:8px;font-size:12.5px;font-weight:700;text-decoration:none;">&#128172; Text</a>';
        if(c.email) acts+='<a href="mailto:'+escapeHtml(c.email)+'" style="flex:1;min-width:60px;text-align:center;background:#eef3fb;color:#185FA5;border-radius:8px;padding:8px;font-size:12.5px;font-weight:700;text-decoration:none;">&#9993; Email</a>';
        var locs=(c.locations&&c.locations.length)?(' &middot; '+escapeHtml((c.locations||[]).join(', '))):'';
        return '<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:12px 14px;margin-bottom:8px;box-shadow:0 2px 6px rgba(0,0,0,.04);">'+
            '<div style="display:flex;align-items:flex-start;gap:8px;"><b style="flex:1;font-size:14.5px;color:#26242b;">'+escapeHtml(c.name)+'</b>'+priBadge(c.priority)+'</div>'+
            ((c.service_type||locs)?'<div style="font-size:12px;color:#6b6275;margin-top:2px;">'+escapeHtml(c.service_type||'')+locs+'</div>':'')+
            (c.contact_person?'<div style="font-size:12.5px;color:#5b6472;margin-top:3px;">Ask for: '+escapeHtml(c.contact_person)+(c.hours?' &middot; '+escapeHtml(c.hours):'')+'</div>':'')+
            (c.instructions?'<div style="font-size:12.5px;color:#33303a;margin-top:5px;background:#f7f8fb;border-radius:8px;padding:7px 9px;">'+escapeHtml(c.instructions)+'</div>':'')+
            (c.account_number?'<div style="font-size:11.5px;color:#6b6275;margin-top:4px;">Acct #: '+escapeHtml(c.account_number)+'</div>':'')+
            (acts?'<div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap;">'+acts+'</div>':'')+
            (c.last_verified?'<div style="font-size:10.5px;color:#aab;margin-top:6px;">Last verified: '+escapeHtml(c.last_verified)+'</div>':'')+
            '<div style="margin-top:6px;text-align:right;"><a href="javascript:void(0)" onclick="cdFlag('+c.id+')" style="font-size:11px;color:#a01b3e;text-decoration:none;">&#9873; Report incorrect info</a></div>'+
            '</div>';
    }
    function renderContactsDir(){
        var box=document.getElementById('cdList'); if(!box) return;
        var list=window._cdList||[];
        var q=(document.getElementById('cdSearch').value||'').trim().toLowerCase();
        if(q) list=list.filter(function(c){ return (c.name+' '+(c.category||'')+' '+(c.service_type||'')+' '+(c.instructions||'')+' '+(c.contact_person||'')+' '+((c.locations||[]).join(' '))).toLowerCase().indexOf(q)>=0; });
        if(!list.length){ box.innerHTML='<p style="text-align:center;color:#6b7686;padding:24px;">No contacts'+(q?' match that search':' for this store yet')+'.</p>'; return; }
        var h='';
        CONTACT_CATS.forEach(function(cat){
            var inc=list.filter(function(c){return (c.category||'')===cat;});
            if(!inc.length) return;
            h+='<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#6b6275;margin:14px 0 8px;">'+escapeHtml(cat)+'</div>';
            inc.forEach(function(c){ h+=contactCardHtml(c); });
        });
        box.innerHTML=h;
    }
    function cdFlag(id){ var note=prompt('What is incorrect about this contact? (optional)'); if(note===null) return; withPin(function(pin){ supabaseClient.rpc('app_contact_flag',{p_username:currentUser.username,p_password:pin,p_id:id,p_note:note||''}).then(function(r){ if(r.error){ alert(r.error.message); return; } alert('Thanks \u2014 flagged for a manager to review.'); }); }); }
    function cdResolveFlag(id){ withPin(function(pin){ supabaseClient.rpc('app_contact_flag_clear',{p_username:currentUser.username,p_password:pin,p_id:id}).then(function(r){ if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; } loadImportantContacts(); }); }); }
    function cdRenderFlagPanel(){ var box=document.getElementById('admContactsDirBox'); if(!box) return; var fl=window._admFlags||[]; if(!fl.length) return; var h='<div style="background:#fdeaea;border:1px solid #f3b4b4;border-radius:10px;padding:10px 12px;margin-bottom:10px;"><div style="font-size:12px;font-weight:800;color:#a01b3e;margin-bottom:6px;">&#9873; Flagged for review ('+fl.length+')</div>'; fl.forEach(function(f){ h+='<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid #f6d5d5;font-size:12.5px;"><div style="flex:1;"><b>'+escapeHtml(f.name||'')+'</b>'+(f.note?(' &middot; '+escapeHtml(f.note)):'')+'<div style="font-size:10.5px;color:#9aa;">flagged by '+escapeHtml(f.by||'')+'</div></div><button onclick="cdResolveFlag('+f.id+')" style="background:#1f7a3d;color:#fff;border:none;border-radius:7px;padding:5px 10px;font-size:11.5px;cursor:pointer;">Resolve</button></div>'; }); h+='</div>'; box.insertAdjacentHTML('afterbegin',h); }
    function loadImportantContacts(){
        var box=document.getElementById('admContactsDirBox'); if(!box) return;
        withPin(function(pin){
            supabaseClient.rpc('app_contacts_admin_list',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ box.innerHTML='<p style="color:#c0264b;font-size:13px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                window._admContacts=r.data||[]; renderAdminContactsDir(); supabaseClient.rpc('app_contact_flags',{p_username:currentUser.username,p_password:pin}).then(function(fr){ window._admFlags=(fr&&fr.data)||[]; cdRenderFlagPanel(); }).catch(function(){});
            }).catch(function(){ box.innerHTML='<p style="color:#c0264b;font-size:13px;">Could not load.</p>'; });
        });
    }
    function _ctStale(c){ if(!c.last_verified) return true; try{ var d=new Date(c.last_verified); return (Date.now()-d.getTime())>90*864e5; }catch(e){ return false; } }
    function renderAdminContactsDir(){
        var box=document.getElementById('admContactsDirBox'); if(!box) return;
        var list=window._admContacts||[];
        if(!list.length){ box.innerHTML='<p style="color:var(--txt2,#8a8594);font-size:13px;">No contacts yet. Tap + Add to create the first one.</p>'; return; }
        var active=list.filter(function(c){return c.active;});
        var stale=active.filter(_ctStale).length;
        var flagged=active.filter(function(c){return c.flagged;}).length;
        var h='';
        if(stale||flagged){
            h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">';
            if(flagged) h+='<span style="background:#fdeaea;color:#a01b3e;font-size:12px;font-weight:800;padding:5px 11px;border-radius:99px;">&#9873; '+flagged+' flagged for review</span>';
            if(stale) h+='<span style="background:#fff4e0;color:#9a5b00;font-size:12px;font-weight:800;padding:5px 11px;border-radius:99px;">&#9888; '+stale+' need re-verifying (90+ days)</span>';
            h+='</div>';
        }
        list.forEach(function(c){
            var stl=c.active&&_ctStale(c);
            var ver=c.last_verified?('verified '+escapeHtml(String(c.last_verified))):'never verified';
            h+='<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--bd,#f0eef4);'+(c.active?'':'opacity:.55;')+'"><div style="flex:1;min-width:0;"><b style="font-size:13.5px;color:var(--txt,#26242b);">'+escapeHtml(c.name)+'</b>'+(c.active?'':' <small style="color:#c0264b;">(archived)</small>')+(c.flagged?' <span style="color:#a01b3e;font-size:11px;font-weight:700;">&#9873; flagged</span>':'')+
               '<div style="font-size:11.5px;color:var(--txt2,#8a8594);">'+escapeHtml(c.category||'')+(c.service_type?' &middot; '+escapeHtml(c.service_type):'')+' &middot; <span style="color:'+(stl?'#9a5b00':'#9aa7b4')+';">'+ver+(stl?' &#9888;':'')+'</span></div></div>'+
               (c.active?'<button onclick="cdVerifyContact('+c.id+')" style="background:#e8f5ec;color:#1b7a3d;border:none;border-radius:7px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">Verify</button>':'')+
               '<button onclick="openContactEdit('+c.id+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:7px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">Edit</button>'+
               '<button onclick="archiveContact('+c.id+','+(c.active?'false':'true')+')" style="background:'+(c.active?'#fdeaea':'#e8f5ec')+';color:'+(c.active?'#c0264b':'#1b7a3d')+';border:none;border-radius:7px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">'+(c.active?'Archive':'Restore')+'</button></div>';
        });
        box.innerHTML=h;
    }
    function cdVerifyContact(id){
        withPin(function(pin){
            supabaseClient.rpc('app_contact_verify',{p_username:currentUser.username,p_password:pin,p_id:id}).then(function(r){
                if(r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; }
                loadImportantContacts();
            }).catch(function(){ alert('Could not verify.'); });
        });
    }
    function openContactEdit(id){
        var c=id?(window._admContacts||[]).filter(function(x){return x.id===id;})[0]:null; window._contactEditId=id||null;
        var ov=certOverlay('contactEditModal');
        var prios=[['emergency','After-hours / Emergency'],['preferred','Preferred'],['backup','Backup']];
        var curLocs=(c&&c.locations)||[];
        ov.innerHTML='<div style="background:#fff;border-radius:14px;max-width:480px;width:100%;margin-top:20px;padding:18px;box-shadow:0 16px 50px rgba(0,0,0,.3);max-height:90vh;overflow:auto;">'+
          '<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:15px;color:#1f2a44;">'+(id?'Edit':'Add')+' contact</b><button data-x style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7686;">&times;</button></div>'+
          '<label class="rm-lbl">Company / contact name *</label><input id="cName" class="rm-inp" value="'+escapeHtml(c?(c.name||''):'')+'">'+
          '<label class="rm-lbl" style="margin-top:8px;">Category</label><select id="cCat" class="rm-inp">'+CONTACT_CATS.map(function(x){return '<option'+((c&&c.category===x)?' selected':'')+'>'+escapeHtml(x)+'</option>';}).join('')+'</select>'+
          '<label class="rm-lbl" style="margin-top:8px;">Service type (e.g. Refrigeration, Plumbing)</label><input id="cType" class="rm-inp" value="'+escapeHtml(c?(c.service_type||''):'')+'">'+
          '<label class="rm-lbl" style="margin-top:8px;">Locations served</label><div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;">'+CONTACT_LOCS.map(function(L){ return '<label style="font-size:12.5px;display:flex;align-items:center;gap:4px;"><input type="checkbox" class="cLoc" value="'+escapeHtml(L)+'"'+(curLocs.indexOf(L)>=0?' checked':'')+'> '+escapeHtml(L)+'</label>'; }).join('')+'</div>'+
          '<div style="display:flex;gap:8px;margin-top:8px;"><div style="flex:1;"><label class="rm-lbl">Primary phone</label><input id="cPhone" class="rm-inp" value="'+escapeHtml(c?(c.phone||''):'')+'"></div><div style="flex:1;"><label class="rm-lbl">After-hours phone</label><input id="cAfter" class="rm-inp" value="'+escapeHtml(c?(c.after_hours||''):'')+'"></div></div>'+
          '<div style="display:flex;gap:8px;margin-top:8px;"><div style="flex:1;"><label class="rm-lbl">Text number</label><input id="cText" class="rm-inp" value="'+escapeHtml(c?(c.text_number||''):'')+'"></div><div style="flex:1;"><label class="rm-lbl">Email</label><input id="cEmail" class="rm-inp" value="'+escapeHtml(c?(c.email||''):'')+'"></div></div>'+
          '<div style="display:flex;gap:8px;margin-top:8px;"><div style="flex:1;"><label class="rm-lbl">Ask for (person)</label><input id="cPerson" class="rm-inp" value="'+escapeHtml(c?(c.contact_person||''):'')+'"></div><div style="flex:1;"><label class="rm-lbl">Hours</label><input id="cHours" class="rm-inp" value="'+escapeHtml(c?(c.hours||''):'')+'"></div></div>'+
          '<label class="rm-lbl" style="margin-top:8px;">Priority</label><select id="cPrio" class="rm-inp">'+prios.map(function(p){return '<option value="'+p[0]+'"'+((c&&c.priority===p[0])?' selected':'')+'>'+p[1]+'</option>';}).join('')+'</select>'+
          '<label class="rm-lbl" style="margin-top:8px;">Instructions (what to check / report before calling)</label><textarea id="cInstr" class="rm-inp" rows="2">'+escapeHtml(c?(c.instructions||''):'')+'</textarea>'+
          '<div style="display:flex;gap:8px;margin-top:8px;"><div style="flex:1;"><label class="rm-lbl">Account # (managers only)</label><input id="cAcct" class="rm-inp" value="'+escapeHtml(c?(c.account_number||''):'')+'"></div><div style="flex:1;"><label class="rm-lbl">Last verified</label><input id="cVer" type="date" class="rm-inp" value="'+escapeHtml(c?(c.last_verified||''):'')+'"></div></div>'+
          '<div id="cMsg" style="font-size:12px;margin-top:8px;"></div>'+
          '<div style="display:flex;gap:8px;margin-top:12px;"><button data-x style="flex:1;background:#eef0f3;color:#444;border:none;border-radius:10px;padding:11px;font-weight:700;cursor:pointer;">Cancel</button><button onclick="saveContact()" style="flex:2;background:var(--pass-green,#1f7a3d);color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">Save</button></div></div>';
        ov.querySelectorAll('[data-x]').forEach(function(b){ b.onclick=function(){ ov.style.display='none'; }; });
    }
    function saveContact(){
        var name=(document.getElementById('cName').value||'').trim(); var msg=document.getElementById('cMsg');
        if(!name){ msg.style.color='#c0264b'; msg.textContent='Name is required.'; return; }
        var locs=[].slice.call(document.querySelectorAll('.cLoc')).filter(function(x){return x.checked;}).map(function(x){return x.value;});
        msg.style.color='#6b7686'; msg.textContent='Saving...';
        withPin(function(pin){
            supabaseClient.rpc('app_contact_save',{p_username:currentUser.username,p_password:pin,p_id:window._contactEditId,p_name:name,
              p_category:document.getElementById('cCat').value,p_service_type:document.getElementById('cType').value,p_locations:locs,
              p_phone:document.getElementById('cPhone').value,p_after_hours:document.getElementById('cAfter').value,p_text:document.getElementById('cText').value,
              p_email:document.getElementById('cEmail').value,p_contact_person:document.getElementById('cPerson').value,p_hours:document.getElementById('cHours').value,
              p_priority:document.getElementById('cPrio').value,p_instructions:document.getElementById('cInstr').value,p_account:document.getElementById('cAcct').value,
              p_last_verified:document.getElementById('cVer').value||null}).then(function(r){
                if(r.error){ msg.style.color='#c0264b'; msg.textContent='Error: '+r.error.message; return; }
                var ov=document.getElementById('contactEditModal'); if(ov) ov.style.display='none'; loadImportantContacts();
              }).catch(function(){ msg.style.color='#c0264b'; msg.textContent='Could not save.'; });
        });
    }
    function archiveContact(id,active){
        withPin(function(pin){
            supabaseClient.rpc('app_contact_archive',{p_username:currentUser.username,p_password:pin,p_id:id,p_active:active}).then(function(r){
                if(r.error){ alert('Error: '+r.error.message); return; } loadImportantContacts();
            }).catch(function(){ alert('Could not update.'); });
        });
    }
    function openAdminConsole(){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){v.style.display='none';});
        document.getElementById('adminConsoleView').style.display='block'; window.scrollTo(0,0);
        loadAdminContacts(); loadAdminList(); loadNotifPrefs(); loadImportantContacts();
    }
    function admListType(){ var s=document.getElementById('admListType'); return s?s.value:'positions'; }
    function admListTypeName(t){ return ({positions:'position',checklist:'checklist item',inventory:'inventory item',temp:'temp point'})[t]||'item'; }
    function loadAdminList(){
        var box=document.getElementById('admListBox'); if(!box) return; var list=admListType();
        box.innerHTML='<p style="color:var(--txt2,#8a8594);font-size:13px;">Loading&hellip;</p>';
        withPin(function(pin){
            supabaseClient.rpc('app_list_get',{p_username:currentUser.username,p_password:pin,p_list:list}).then(function(r){
                if(r.error){ box.innerHTML='<p style="color:#c0264b;font-size:13px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                window._admList=r.data||[]; renderAdminList();
            }).catch(function(){ box.innerHTML='<p style="color:#c0264b;font-size:13px;">Could not load.</p>'; });
        });
    }
    function renderAdminList(){
        var box=document.getElementById('admListBox'); if(!box) return; var list=window._admList||[]; var type=admListType();
        if(!list.length){ box.innerHTML='<p style="color:var(--txt2,#8a8594);font-size:13px;">Nothing here yet. Tap &#10133; Add.</p>'; return; }
        box.innerHTML=list.map(function(c,i){
            var sub='';
            if(type==='positions') sub='<span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:'+(c.color||'#888')+';margin-right:5px;vertical-align:middle;"></span>position';
            else if(type==='checklist') sub=escapeHtml(c.shift||'');
            else if(type==='inventory') sub=escapeHtml((c.loc||'')+(c.par!=null?(' &middot; par '+c.par+(c.unit?(' '+c.unit):'')):''));
            else if(type==='temp') sub=escapeHtml((c.loc||'')+(c.min!=null?(' &middot; '+c.min+'-'+c.max+'F'):''));
            return '<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--bd,#f0eef4);">'+
                '<div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:13.5px;color:var(--txt,#26242b);">'+escapeHtml(c.name||'')+'</div>'+
                '<div style="font-size:12px;color:var(--txt2,#8a8594);">'+sub+'</div></div>'+
                '<button onclick="openAdmList('+i+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">Edit</button>'+
                '<button onclick="deleteAdmList('+i+')" style="background:#fdeaea;color:#c0264b;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">Remove</button></div>';
        }).join('');
    }
    function admListShowFields(type){
        ['admlf_color','admlf_shift','admlf_loc','admlf_unit','admlf_par','admlf_min','admlf_max'].forEach(function(id){ var e=document.getElementById(id); if(e) e.style.display='none'; });
        function sh(id){ var e=document.getElementById(id); if(e) e.style.display='block'; }
        if(type==='positions') sh('admlf_color');
        else if(type==='checklist') sh('admlf_shift');
        else if(type==='inventory'){ sh('admlf_loc'); sh('admlf_unit'); sh('admlf_par'); }
        else if(type==='temp'){ sh('admlf_loc'); sh('admlf_min'); sh('admlf_max'); }
    }
    function openAdmList(i){
        var type=admListType(); var c=(i>=0)?(window._admList||[])[i]:null;
        window._admListEditId=c?c.id:null; admListShowFields(type);
        document.getElementById('admListName').value=c?(c.name||''):'';
        document.getElementById('admListColor').value=(c&&c.color)?c.color:'#106ab3';
        document.getElementById('admListShift').value=(c&&c.shift)?c.shift:'Opening';
        document.getElementById('admListLoc').value=(c&&c.loc)?c.loc:'Roadrunner';
        document.getElementById('admListUnit').value=(c&&c.unit)?c.unit:'';
        document.getElementById('admListPar').value=(c&&c.par!=null)?c.par:'';
        document.getElementById('admListMin').value=(c&&c.min!=null)?c.min:'';
        document.getElementById('admListMax').value=(c&&c.max!=null)?c.max:'';
        document.getElementById('admListTitle').textContent=(c?'Edit ':'Add ')+admListTypeName(type);
        document.getElementById('admListMsg').textContent='';
        document.getElementById('admListModal').style.display='flex';
    }
    function closeAdmList(){ document.getElementById('admListModal').style.display='none'; }
    function saveAdmList(){
        var type=admListType(); var msg=document.getElementById('admListMsg');
        var name=(document.getElementById('admListName').value||'').trim();
        if(!name){ msg.style.color='#c0264b'; msg.textContent='Give it a name.'; return; }
        var f={name:name};
        if(type==='positions'){ f.color=document.getElementById('admListColor').value; }
        else if(type==='checklist'){ f.shift=document.getElementById('admListShift').value; }
        else if(type==='inventory'){ f.loc=document.getElementById('admListLoc').value; f.unit=document.getElementById('admListUnit').value; f.par=document.getElementById('admListPar').value; }
        else if(type==='temp'){ f.loc=document.getElementById('admListLoc').value; f.min=document.getElementById('admListMin').value; f.max=document.getElementById('admListMax').value; }
        msg.style.color='#5b6472'; msg.textContent='Saving&hellip;';
        withPin(function(pin){
            supabaseClient.rpc('app_list_save',{p_username:currentUser.username,p_password:pin,p_list:type,p_id:window._admListEditId||null,p_fields:f}).then(function(r){
                if(r.error){ msg.style.color='#c0264b'; msg.textContent='Error: '+r.error.message; return; }
                closeAdmList(); loadAdminList();
            }).catch(function(){ msg.style.color='#c0264b'; msg.textContent='Could not save.'; });
        });
    }
    function deleteAdmList(i){
        var c=(window._admList||[])[i]; if(!c) return;
        if(!confirm('Remove "'+(c.name||'this')+'"?')) return;
        withPin(function(pin){
            supabaseClient.rpc('app_list_delete',{p_username:currentUser.username,p_password:pin,p_list:admListType(),p_id:c.id}).then(function(r){
                if(r.error){ alert('Could not remove: '+r.error.message); return; }
                loadAdminList();
            }).catch(function(){ alert('Could not remove.'); });
        });
    }
    function loadAdminContacts(){
        var box=document.getElementById('admContactsList'); if(!box) return;
        box.innerHTML='<p style="color:var(--txt2,#8a8594);font-size:13px;">Loading&hellip;</p>';
        withPin(function(pin){
            supabaseClient.rpc('app_settings_get',{p_username:currentUser.username,p_password:pin,p_group:'contacts'}).then(function(r){
                if(r.error){ box.innerHTML='<p style="color:#c0264b;font-size:13px;">'+escapeHtml(r.error.message)+'</p>'; return; }
                window._admContacts=r.data||[]; renderAdminContacts();
            }).catch(function(){ box.innerHTML='<p style="color:#c0264b;font-size:13px;">Could not load.</p>'; });
        });
    }
    function renderAdminContacts(){
        var box=document.getElementById('admContactsList'); if(!box) return;
        var list=window._admContacts||[];
        if(!list.length){ box.innerHTML='<p style="color:var(--txt2,#8a8594);font-size:13px;">No contacts yet. Tap &#10133; Add to put one here (and on the Emergency screen).</p>'; return; }
        box.innerHTML=list.map(function(c,i){
            return '<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--bd,#f0eef4);">'+
                '<div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:13.5px;color:var(--txt,#26242b);">'+escapeHtml(c.label||'(no label)')+'</div>'+
                '<div style="font-size:12.5px;color:var(--txt2,#8a8594);">'+escapeHtml(c.value||'')+'</div></div>'+
                '<button onclick="openAdmSetting('+i+')" style="background:#eef3fb;color:#185FA5;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">Edit</button>'+
                '<button onclick="deleteAdmSetting('+i+')" style="background:#fdeaea;color:#c0264b;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;">Remove</button></div>';
        }).join('');
    }
    function openAdmSetting(i){
        var c=(i>=0)?(window._admContacts||[])[i]:null;
        document.getElementById('admSettingKey').value=c?c.key:'';
        document.getElementById('admSettingLabel').value=c?(c.label||''):'';
        document.getElementById('admSettingValue').value=c?(c.value||''):'';
        document.getElementById('admSettingTitle').textContent=c?'Edit contact':'Add contact';
        document.getElementById('admSettingMsg').textContent='';
        document.getElementById('admSettingModal').style.display='flex';
    }
    function closeAdmSetting(){ document.getElementById('admSettingModal').style.display='none'; }
    function saveAdmSetting(){
        var label=(document.getElementById('admSettingLabel').value||'').trim();
        var value=(document.getElementById('admSettingValue').value||'').trim();
        var key=document.getElementById('admSettingKey').value||('contacts_'+Date.now());
        var msg=document.getElementById('admSettingMsg');
        if(!label){ msg.style.color='#c0264b'; msg.textContent='Give it a label.'; return; }
        msg.style.color='#5b6472'; msg.textContent='Saving&hellip;';
        withPin(function(pin){
            supabaseClient.rpc('app_settings_set',{p_username:currentUser.username,p_password:pin,p_key:key,p_group:'contacts',p_label:label,p_value:value,p_sort:0}).then(function(r){
                if(r.error){ msg.style.color='#c0264b'; msg.textContent='Error: '+r.error.message; return; }
                closeAdmSetting(); loadAdminContacts();
            }).catch(function(){ msg.style.color='#c0264b'; msg.textContent='Could not save.'; });
        });
    }
    function deleteAdmSetting(i){
        var c=(window._admContacts||[])[i]; if(!c) return;
        if(!confirm('Remove "'+(c.label||'this entry')+'"?')) return;
        withPin(function(pin){
            supabaseClient.rpc('app_settings_delete',{p_username:currentUser.username,p_password:pin,p_key:c.key}).then(function(r){
                if(r.error){ alert('Could not remove: '+r.error.message); return; }
                loadAdminContacts();
            }).catch(function(){ alert('Could not remove.'); });
        });
    }
    function loadEmgContacts(){
        var box=document.getElementById('emgContacts'); if(!box) return;
        try{ var cached=JSON.parse(localStorage.getItem('emgContacts')||'[]'); if(cached.length) renderEmgContacts(cached); }catch(e){}
        if(!currentUser) return;
        withPin(function(pin){
            supabaseClient.rpc('app_settings_get',{p_username:currentUser.username,p_password:pin,p_group:'contacts'}).then(function(r){
                if(r.error||!r.data) return;
                try{ localStorage.setItem('emgContacts',JSON.stringify(r.data)); }catch(e){}
                renderEmgContacts(r.data);
            }).catch(function(){});
        });
    }
    function renderEmgContacts(list){
        var box=document.getElementById('emgContacts'); if(!box) return;
        if(!list||!list.length){ box.innerHTML=''; return; }
        box.innerHTML='<div style="background:#fff;border:1px solid #f0d0d0;border-radius:12px;padding:12px 14px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,.05);">'+
            '<div style="font-size:13px;font-weight:800;color:#a01b3c;margin-bottom:6px;">&#128222; Key contacts</div>'+
            list.map(function(c){ return '<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid #f7eaea;font-size:13.5px;"><b style="flex:1;color:#26242b;">'+escapeHtml(c.label||'')+'</b><span style="color:#185FA5;font-weight:700;white-space:nowrap;">'+escapeHtml(c.value||'')+'</span></div>'; }).join('')+'</div>';
    }
    function openEmergency(){
        document.getElementById('main-menu').style.display='none';
        document.querySelectorAll('.app-view').forEach(function(v){v.style.display='none';});
        document.getElementById('emergencyView').style.display='block'; window.scrollTo(0,0);
        renderEmergency(); loadEmgContacts();
    }
    function renderEmergency(){
        var box=document.getElementById('emergencyList'); if(!box) return;
        box.innerHTML = EMERGENCY.map(function(s,idx){
            return '<div style="margin-bottom:10px;border:1px solid #f0d0d0;border-radius:12px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.05);">'+
                '<button onclick="toggleEmergency('+idx+')" style="width:100%;text-align:left;background:#fff;border:none;padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;">'+
                '<span style="font-size:24px;">'+s.icon+'</span><b style="flex:1;font-size:15px;color:#a01b3c;">'+escapeHtml(s.title)+'</b><span style="color:#c0264b;font-size:20px;">&rsaquo;</span></button>'+
                '<div id="emg'+idx+'" style="display:none;padding:0 16px 14px;"></div></div>';
        }).join('');
    }
    function toggleEmergency(idx){
        var d=document.getElementById('emg'+idx); if(!d) return;
        if(d.style.display==='block'){ d.style.display='none'; return; }
        document.querySelectorAll('[id^="emg"]').forEach(function(e){ if(/^emg\d+$/.test(e.id)) e.style.display='none'; });
        var s=EMERGENCY[idx];
        var h='<ol style="margin:0;padding-left:20px;font-size:13.5px;color:#26242b;line-height:1.6;">'+s.steps.map(function(st){ return '<li style="margin-bottom:6px;">'+escapeHtml(st)+'</li>'; }).join('')+'</ol>';
        d.innerHTML=h; d.style.display='block';
    }

    // ===== Corrective actions from failed inspection items =====
    var _correctiveItems=[];
    function openCorrectiveActions(items, store, date){
        _correctiveItems = items||[]; if(!_correctiveItems.length) return;
        window._corrStore=store||''; window._corrDate=date||'';
        document.getElementById('correctiveSub').innerText = _correctiveItems.length+' item'+(_correctiveItems.length>1?'s':'')+' scored 1–2 at '+(store||'this store')+'. Assign a fix for each (or skip).';
        var d=new Date(); d.setDate(d.getDate()+3); document.getElementById('correctiveDue').value=d.toISOString().slice(0,10);
        document.getElementById('correctivePhoto').checked=true; document.getElementById('correctiveMsg').textContent='';
        var sel=document.getElementById('correctiveAssignee');
        function fill(arr){ sel.innerHTML='<option value="">Select…</option>'+arr.filter(function(e){return e.active!==false;}).map(function(e){ return '<option value="'+e.id+'">'+escapeHtml(e.name||('#'+e.id))+'</option>'; }).join(''); }
        var list=(typeof rosterState!=='undefined'&&rosterState&&rosterState.list&&rosterState.list.length)?rosterState.list:null;
        if(list) fill(list); else withPin(function(pin){ supabaseClient.rpc('app_roster_list',{p_username:currentUser.username,p_password:pin}).then(function(r){ if(!r.error&&r.data) fill(r.data.employees||r.data||[]); }); });
        document.getElementById('correctiveList').innerHTML=_correctiveItems.map(function(it,idx){ return '<label style="display:flex;gap:8px;padding:7px 2px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333;"><input type="checkbox" class="corr-item" data-idx="'+idx+'" checked style="margin-top:3px;"><span><b>'+escapeHtml(it.text)+'</b> <span style="color:#c0264b;">('+it.score+'/5)</span>'+(it.note?'<br><span style="color:#6b7686;font-size:12px;">'+escapeHtml(it.note)+'</span>':'')+'</span></label>'; }).join('');
        document.getElementById('correctiveModal').style.display='flex';
    }
    function closeCorrective(){ document.getElementById('correctiveModal').style.display='none'; }
    function submitCorrective(){
        var assignee=document.getElementById('correctiveAssignee').value;
        var due=document.getElementById('correctiveDue').value;
        var photo=document.getElementById('correctivePhoto').checked;
        var msg=document.getElementById('correctiveMsg');
        if(!assignee){ msg.style.color='#c0264b'; msg.textContent='Pick who should fix these.'; return; }
        if(!due){ msg.style.color='#c0264b'; msg.textContent='Set a due date.'; return; }
        var picks=[]; document.querySelectorAll('#correctiveList .corr-item:checked').forEach(function(c){ picks.push(_correctiveItems[parseInt(c.getAttribute('data-idx'),10)]); });
        if(!picks.length){ closeCorrective(); return; }
        msg.style.color='#5b6472'; msg.textContent='Creating tasks…';
        withPin(function(pin){
            var done=0, made=0, failed=0;
            picks.forEach(function(it){
                var details='Pop-In corrective action — '+(window._corrStore||'')+(window._corrDate?(' · '+window._corrDate):'')+'. Scored '+it.score+'/5.'+(it.note?(' Note: '+it.note):'');
                supabaseClient.rpc('app_task_create',{p_username:currentUser.username,p_password:pin,p_title:'Fix: '+it.text,p_details:details,p_due:due,p_target_type:'individual',p_target_value:null,p_employee_ids:[parseInt(assignee,10)],p_completion_mode:'individual'}).then(function(r){
                    done++; if(r.error){ failed++; } else { made++; if(photo && r.data){ supabaseClient.rpc('app_task_set_photo_req',{p_username:currentUser.username,p_password:pin,p_task_id:r.data,p_required:true}).catch(function(){}); } }
                    if(done===picks.length){ msg.style.color=failed?'#c0264b':'#1c7c3a'; msg.textContent='✓ '+made+' fix task'+(made===1?'':'s')+' created'+(failed?(' ('+failed+' failed)'):'')+'.'; setTimeout(closeCorrective, 1300); }
                }).catch(function(){ done++; failed++; if(done===picks.length){ msg.textContent='Created '+made+'.'; setTimeout(closeCorrective, 1300); } });
            });
        });
    }

    function _myTasksErrHtml(){
        return '<div onclick="loadMyTasks()" style="background:#fff8e6;border:1px solid #ffe39a;border-radius:12px;padding:14px;margin-bottom:14px;text-align:center;color:#9a7400;font-size:13px;font-weight:700;cursor:pointer;">&#9888; Couldn&rsquo;t load your tasks &mdash; tap to retry</div>';
    }
    function loadMyTasks(cardId){
        if(cardId) myTasksCardId=cardId;
        var c=document.getElementById(myTasksCardId); if(!c) return;
        // "My Home" duplicate card: one live task surface — point people to My Day on the Home tab.
        if(myTasksCardId==='empTasksCard'){
            c.innerHTML='<div onclick="hubNav(\'home\')" style="background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:14px;box-shadow:0 4px 6px rgba(0,0,0,0.05);cursor:pointer;display:flex;align-items:center;gap:10px;">'+
                '<span style="font-size:18px;">&#128203;</span><span style="flex:1;font-size:13.5px;color:#33404e;font-weight:600;">See <b>My Day</b> on your Home tab for your tasks, checklist &amp; today&rsquo;s lineup</span><span style="color:#c2c7d0;font-size:16px;">&rsaquo;</span></div>';
            return;
        }
        var isHome=(myTasksCardId==='homeTasksCard');
        withPin(function(pin){
            supabaseClient.rpc('app_my_tasks',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; c.innerHTML=_myTasksErrHtml(); return; }
                var tasks=(r.data&&r.data.tasks)||[];
                // Auto-clear: hide tasks completed more than 24h ago (kept in the database).
                var _nowMs=Date.now();
                tasks=tasks.filter(function(t){
                    if(t.status!=='done') return true;
                    if(!t.completed_at) return true;
                    var ct=new Date(t.completed_at).getTime();
                    return isNaN(ct) ? true : (_nowMs - ct) < 86400000;
                });
                // Sort: overdue first, then due today, then the rest by due date; completed last.
                var _td=new Date();
                var todayStr=_td.getFullYear()+'-'+String(_td.getMonth()+1).padStart(2,'0')+'-'+String(_td.getDate()).padStart(2,'0');
                var rank=function(t){
                    if(t.status==='done') return 3;
                    if(t.due_date && String(t.due_date)<todayStr) return 0;
                    if(t.due_date && String(t.due_date)===todayStr) return 1;
                    return 2;
                };
                tasks.sort(function(a,b){
                    var ra=rank(a), rb=rank(b);
                    if(ra!==rb) return ra-rb;
                    var ad=a.due_date?String(a.due_date):'9999-12-31', bd=b.due_date?String(b.due_date):'9999-12-31';
                    return ad<bd?-1:(ad>bd?1:0);
                });
                var h='<div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span style="font-size:15px;font-weight:500;color:#185FA5;">'+(isHome?'&#128203; My Day':'&#9989; My Tasks')+'</span>' +
                    '<button onclick="openSelfTask()" style="background:var(--caliches-pink);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:bold;cursor:pointer;">+ Add</button></div>';
                if(!tasks.length){ h+='<p style="color:#6b7686;font-size:13px;margin:0;">No tasks. &#127881;</p>'; }
                else tasks.forEach(function(t){
                    var done=t.status==='done';
                    var chip='';
                    if(!done && t.due_date){
                        if(String(t.due_date)<todayStr) chip=' <span style="background:#c0392b;color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;white-space:nowrap;">Overdue</span>';
                        else if(String(t.due_date)===todayStr) chip=' <span style="background:#e67e22;color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;white-space:nowrap;">Today</span>';
                    }
                    h+='<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid #f0f0f0;">' +
                        '<input type="checkbox" '+(done?'checked':'')+' onchange="onTaskCheck('+t.assignee_id+',this.checked,'+(t.requires_photo?'true':'false')+','+(t.has_photo?'true':'false')+',this)" style="margin-top:3px;transform:scale(1.3);">' +
                        '<div style="flex:1;"><div style="font-size:14px;'+(done?'text-decoration:line-through;color:#6b7686;':'color:#333;')+'">'+escapeHtml(t.title)+(t.requires_photo?' <span style="font-size:10px;color:#185FA5;white-space:nowrap;">&#128247; photo</span>':'')+chip+'</div>' +
                        (t.details?'<div style="font-size:12px;color:#6b7686;">'+escapeHtml(t.details)+'</div>':'') +
                        '<div style="font-size:11px;color:#aab;">'+(t.due_date?('Due '+t.due_date+' &bull; '):'')+'from '+escapeHtml(t['from']||'')+'</div>'+
                        ((done&&t.completed_at)?'<div style="font-size:11px;color:#1f7a3d;">&#10003; Completed '+socFmt(t.completed_at)+'</div>':'')+'</div></div>';
                });
                if(isHome){ h+='<div id="myDayChecklistStrip"></div><div id="myDayPreshiftStrip"></div>'; }
                h+='</div>'; c.innerHTML=h;
                if(isHome && typeof loadMyDayStrips==='function'){ loadMyDayStrips(); }
                if(!_celChecked && sessionPin){ _celChecked=true; setTimeout(checkCelebrations, 600); }
                if(typeof maybePromptPush==='function'){ setTimeout(maybePromptPush, 1800); }
            }).catch(function(){ c.innerHTML=_myTasksErrHtml(); });
        }, function(){ c.innerHTML=_myTasksErrHtml(); });
    }
    // ── My Day strips: today's checklist status + my pre-shift lineup spot ──
    function loadMyDayStrips(){
        var cw=document.getElementById('myDayChecklistStrip'), pw=document.getElementById('myDayPreshiftStrip');
        if(!cw && !pw) return;
        var loc=(typeof tempStoreLoc==='function')?tempStoreLoc():'';
        withPin(function(pin){
            if(pw){
                supabaseClient.rpc('app_preshift_mine',{p_username:currentUser.username,p_password:pin}).then(function(r){
                    if(r.error || !r.data || r.data.ok!==true || r.data.none===true || !r.data.position) return;
                    var d=r.data;
                    var line='&#128095; Today: <b>'+escapeHtml(d.position)+'</b>'+(d.location?(' at '+escapeHtml(d.location)):'')+(d.shift?(' <span style="color:#8a94a0;">('+escapeHtml(d.shift)+')</span>'):'');
                    var extra='';
                    if(d.goals) extra+='<div style="font-size:12px;color:#5b6675;margin-top:2px;">&#127919; '+escapeHtml(d.goals)+'</div>';
                    if(d.note) extra+='<div style="font-size:12px;color:#5b6675;margin-top:2px;">&#128221; '+escapeHtml(d.note)+'</div>';
                    pw.innerHTML='<div style="background:#f4f8ff;border:1px solid #d7e6fa;border-radius:10px;padding:9px 12px;margin-top:8px;font-size:13px;color:#26425e;">'+line+extra+'</div>';
                }).catch(function(){});
            }
            if(cw && loc){
                var shifts=[{k:'open',label:'Opening'},{k:'close',label:'Closing'},{k:'clean',label:'Cleaning'}];
                Promise.all(shifts.map(function(s){
                    return supabaseClient.rpc('app_checklist_items',{p_username:currentUser.username,p_password:pin,p_shift:s.k,p_location:loc})
                        .then(function(r){ return (r.error || !Array.isArray(r.data)) ? null : r.data; })
                        .catch(function(){ return null; });
                })).then(function(res){
                    var h='';
                    shifts.forEach(function(s,i){
                        var list=res[i]; if(!list || !list.length) return;
                        var done=list.filter(function(x){ return x.done; }).length;
                        var allDone=(done>=list.length);
                        h+='<button onclick="myDayOpenChecklist(\''+s.k+'\')" style="display:flex;width:100%;align-items:center;gap:8px;text-align:left;background:'+(allDone?'#f3faf5':'#fff')+';border:1px solid '+(allDone?'#d8eede':'#ececf2')+';border-radius:10px;padding:9px 12px;margin-top:8px;cursor:pointer;font-size:13px;color:#33404e;">'+
                            '<span style="font-size:15px;">&#129534;</span><span style="flex:1;">'+s.label+' checklist: <b style="color:'+(allDone?'#1b7a3d':'#185FA5')+';">'+done+'/'+list.length+'</b> done</span><span style="color:#c2c7d0;font-size:15px;">&rarr;</span></button>';
                    });
                    cw.innerHTML=h;
                }).catch(function(){});
            }
        });
    }
    function myDayOpenChecklist(shift){
        if(typeof openChecklists!=='function') return;
        openChecklists();
        if(shift && shift!=='open' && typeof setChecklistTab==='function') setChecklistTab(shift);
    }
    function toggleTask(aid, done){
        withPin(function(pin){
            supabaseClient.rpc('app_task_complete',{p_username:currentUser.username,p_password:pin,p_assignee_id:aid,p_done:done}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); }
                else if(done && typeof showUndo==='function'){ showUndo('Task completed', function(){ toggleTask(aid,false); }); }
                loadMyTasks();
            });
        });
    }
    // Photo-proof completion: if a task requires a photo, capture one before marking done.
    function onTaskCheck(aid, checked, requiresPhoto, hasPhoto, el){
        if(checked && requiresPhoto && !hasPhoto){
            if(el) el.checked=false;
            captureTaskPhoto(aid);
            return;
        }
        toggleTask(aid, checked);
    }
    function captureTaskPhoto(aid){
        window._taskPhotoAid=aid;
        var inp=document.getElementById('taskPhotoInput');
        if(inp){ inp.value=''; inp.click(); }
    }
    function onTaskPhotoPicked(ev){
        var f=ev.target.files && ev.target.files[0]; if(!f) return;
        var aid=window._taskPhotoAid;
        var rd=new FileReader();
        rd.onload=function(e){ var img=new Image(); img.onload=function(){ var c=document.createElement('canvas'); var sc=Math.min(700/img.width,1); c.width=Math.round(img.width*sc); c.height=Math.round(img.height*sc); c.getContext('2d').drawImage(img,0,0,c.width,c.height); submitTaskPhoto(aid, c.toDataURL('image/jpeg',0.5)); }; img.src=e.target.result; };
        rd.readAsDataURL(f);
    }
    function submitTaskPhoto(aid, b64){
        withPin(function(pin){
            supabaseClient.rpc('app_task_complete_photo',{p_username:currentUser.username,p_password:pin,p_assignee_id:aid,p_photo:b64}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; }
                loadMyTasks();
            }).catch(function(){ alert('Could not upload photo. Please try again.'); });
        });
    }
    function showTaskPhoto(aid){
        var body=document.getElementById('taskPhotoBody'); if(body) body.innerHTML='Loading photo&hellip;';
        var m=document.getElementById('taskPhotoModal'); if(m) m.style.display='flex';
        withPin(function(pin){
            supabaseClient.rpc('app_task_photo',{p_username:currentUser.username,p_password:pin,p_assignee_id:aid}).then(function(r){
                if(r.error || !r.data){ if(body) body.innerHTML='<span style="color:#c0264b;">No photo available.</span>'; return; }
                if(body) body.innerHTML='<img src="'+r.data+'" style="max-width:100%;max-height:70vh;border-radius:8px;">';
            }).catch(function(){ if(body) body.innerHTML='<span style="color:#c0264b;">Could not load photo.</span>'; });
        });
    }
    function closeTaskPhoto(){ var m=document.getElementById('taskPhotoModal'); if(m) m.style.display='none'; }
    function clearTeamTask(taskId, btn){
        // Two-tap confirm: first tap arms the button, second tap (within 3s) deletes.
        if(btn){
            if(btn.getAttribute('data-armed')!=='1'){
                btn.setAttribute('data-armed','1');
                btn.setAttribute('data-orig', btn.innerHTML);
                btn.innerHTML='Tap again to remove for everyone';
                btn.style.background='#c0264b'; btn.style.color='#fff'; btn.style.borderColor='#c0264b';
                if(btn._armTimer) clearTimeout(btn._armTimer);
                btn._armTimer=setTimeout(function(){
                    btn.setAttribute('data-armed','0');
                    btn.innerHTML=btn.getAttribute('data-orig')||'&#128465; Clear';
                    btn.style.background='#fff5f8'; btn.style.color='#c0264b'; btn.style.borderColor='#f0c0cc';
                }, 3000);
                return;
            }
            if(btn._armTimer) clearTimeout(btn._armTimer);
            btn.disabled=true; btn.innerHTML='Removing&hellip;';
        } else {
            if(!confirm('Delete this task for everyone? This cannot be undone.')) return;
        }
        withPin(function(pin){
            supabaseClient.rpc('app_task_delete',{p_username:currentUser.username,p_password:pin,p_task_id:taskId}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); if(btn) btn.disabled=false; loadTeamTasks(); return; }
                loadTeamTasks();
            }).catch(function(){ alert('Could not delete the task.'); if(btn) btn.disabled=false; });
        });
    }

    // ---- Assign / add task modal ----
    var taTargets=null, taSelfOnly=false;
    function openSelfTask(){ taSelfOnly=true; document.getElementById('taAssignTitle').innerText='Add a task for myself'; document.getElementById('taTargetRow').style.display='none'; document.getElementById('taSaveBtn').innerText='Add'; taResetFields(); var pw=document.getElementById('taPhotoReqWrap'); if(pw) pw.style.display='none'; document.getElementById('taskAssignModal').style.display='flex'; }
    function openTaskAssign(){ taSelfOnly=false; document.getElementById('taAssignTitle').innerText='Assign Task'; document.getElementById('taTargetRow').style.display='block'; document.getElementById('taSaveBtn').innerText='Assign'; taResetFields(); var pw=document.getElementById('taPhotoReqWrap'); if(pw) pw.style.display='block';
        var globalMgr=currentUser&&(currentUser.role==='Admin Manager'||currentUser.role==='Manager'||currentUser.role==='Vice President/Co-Owner'||currentUser.is_developer===true);
        var tsel=document.getElementById('taTarget');
        if(globalMgr){
            tsel.innerHTML='<option value="self">Myself</option><option value="people">Specific people</option><option value="store">A whole store</option><option value="role">A role</option><option value="everyone">Everyone</option>';
            tsel.value='people';
            withPin(function(pin){ supabaseClient.rpc('app_task_targets',{p_username:currentUser.username,p_password:pin}).then(function(r){ if(r.error){ if(r.error.code==='42501') sessionPin=null; return; } taTargets=r.data||{}; populateTaTargets(); }); });
        } else {
            tsel.innerHTML='<option value="self">Myself</option><option value="people">Specific people</option><option value="store">A whole store</option>';
            tsel.value='store';
            var managed=myStores.filter(function(s){return s.role==='store_manager'||s.role==='assistant_manager';}).map(function(s){return s.location;});
            document.getElementById('taStore').innerHTML=managed.map(function(s){return '<option value="'+s.replace(/"/g,'')+'">'+escapeHtml(s)+'</option>';}).join('');
            // Store managers can target individuals too — people list filtered to their store's roster.
            withPin(function(pin){ supabaseClient.rpc('app_task_targets',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error||!r.data){ if(r.error&&r.error.code==='42501') sessionPin=null; var op=tsel.querySelector('option[value="people"]'); if(op) op.parentNode.removeChild(op); taTargetChange(); return; }
                var all=r.data||{};
                var ppl=(all.people||[]).filter(function(p){ return p.store && managed.indexOf(p.store)>=0; });
                taTargets={ stores:managed, roles:(all.roles||[]), people:ppl };
                populateTaTargets();
            }).catch(function(){ var op=tsel.querySelector('option[value="people"]'); if(op) op.parentNode.removeChild(op); taTargetChange(); }); });
        }
        taTargetChange();
        document.getElementById('taskAssignModal').style.display='flex'; }
    function taResetFields(){ document.getElementById('taTitle').value=''; document.getElementById('taDetails').value=''; document.getElementById('taDue').value=''; document.getElementById('taMsg').innerText=''; var rp=document.getElementById('taRequirePhoto'); if(rp) rp.checked=false; }
    function closeTaskAssign(){ document.getElementById('taskAssignModal').style.display='none'; }
    function populateTaTargets(){
        if(!taTargets) return;
        var st=document.getElementById('taStore'); st.innerHTML=(taTargets.stores||[]).map(function(s){return '<option value="'+escapeHtml(s)+'">'+escapeHtml(s)+'</option>';}).join('');
        var rl=document.getElementById('taRole'); rl.innerHTML=(taTargets.roles||[]).map(function(r){return '<option value="'+r.id+'">'+escapeHtml(r.name)+'</option>';}).join('');
        var pp=document.getElementById('taPeople');
        var pw=document.getElementById('taPeopleWrap');
        var people=taTargets.people||[];
        var rowsH=people.map(function(p){return '<label class="ta-person-row" data-name="'+escapeHtml(String(p.name||'').toLowerCase())+'" style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;"><input type="checkbox" class="ta-person" value="'+p.id+'">'+escapeHtml(p.name)+(p.store?' <span style="color:#aab;font-size:11px;">'+escapeHtml(p.store)+'</span>':'')+'</label>';}).join('');
        pw.innerHTML='<input id="taPeopleSearch" type="text" placeholder="&#128269; Type a name to filter&hellip;" oninput="taPeopleFilter()" autocomplete="off" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;margin-bottom:6px;">'+
            '<div id="taPeopleCount" style="font-size:11px;color:#8a94a0;margin:0 0 4px;">'+people.length+' of '+people.length+' shown</div>'+
            '<div id="taPeopleRows">'+rowsH+'</div>';
    }
    function taPeopleFilter(){
        var inp=document.getElementById('taPeopleSearch');
        var q=((inp&&inp.value)||'').trim().toLowerCase();
        var rows=document.querySelectorAll('#taPeopleRows .ta-person-row');
        var shown=0;
        rows.forEach(function(r){
            var ok=!q || (r.getAttribute('data-name')||'').indexOf(q)>=0;
            r.style.display=ok?'flex':'none';
            if(ok) shown++;
        });
        var cnt=document.getElementById('taPeopleCount');
        if(cnt) cnt.textContent=shown+' of '+rows.length+' shown';
    }
    function taTargetChange(){ var v=document.getElementById('taTarget').value; document.getElementById('taStoreWrap').style.display=(v==='store')?'block':'none'; document.getElementById('taRoleWrap').style.display=(v==='role')?'block':'none'; document.getElementById('taPeopleWrap').style.display=(v==='people')?'block':'none'; document.getElementById('taStoreSharedWrap').style.display=(v==='store')?'block':'none'; }
    function saveTask(){
        var title=document.getElementById('taTitle').value.trim();
        var details=document.getElementById('taDetails').value.trim();
        var due=document.getElementById('taDue').value||null;
        var msg=document.getElementById('taMsg');
        if(!title){ msg.style.color='#c0264b'; msg.innerText='Task title is required.'; return; }
        if(!due){ msg.style.color='#c0264b'; msg.innerText='A due date is required — every task is time-sensitive.'; return; }
        var target = taSelfOnly ? 'self' : document.getElementById('taTarget').value;
        var tval=null, ids=null;
        if(target==='store') tval=document.getElementById('taStore').value;
        else if(target==='role') tval=document.getElementById('taRole').value;
        else if(target==='people'){ ids=[].slice.call(document.querySelectorAll('.ta-person:checked')).map(function(x){return parseInt(x.value,10);}); if(!ids.length){ msg.style.color='#c0264b'; msg.innerText='Pick at least one person.'; return; } }
        var btn=document.getElementById('taSaveBtn'); btn.disabled=true;
        withPin(function(pin){
            supabaseClient.rpc('app_task_create',{p_username:currentUser.username,p_password:pin,p_title:title,p_details:details,p_due:due,p_target_type:target,p_target_value:tval,p_employee_ids:ids,p_completion_mode:(target==='store'&&document.getElementById('taStoreShared').checked)?'store':'individual'}).then(function(r){
                btn.disabled=false;
                if(r.error){ if(r.error.code==='42501') sessionPin=null; msg.style.color='#c0264b'; msg.innerText='Error: '+r.error.message; return; }
                var rp=document.getElementById('taRequirePhoto');
                if(rp && rp.checked && r.data){ supabaseClient.rpc('app_task_set_photo_req',{p_username:currentUser.username,p_password:pin,p_task_id:r.data,p_required:true}); }
                closeTaskAssign();
                var tv=document.getElementById('tasksView');
                if(document.getElementById('employeeHomeView').style.display==='block') loadMyTasks('empTasksCard');
                else if(tv && tv.style.display==='block') loadMyTasks('tasksMineCard');
                else alert('Task assigned.');
            }).catch(function(){ btn.disabled=false; msg.style.color='#c0264b'; msg.innerText='Connection error.'; });
        }, function(){ btn.disabled=false; });
    }

    // ---- Messaging ----
    var msgTab='updates';
    function openMessages(){ document.getElementById('main-menu').style.display='none'; document.querySelectorAll('.app-view').forEach(function(v){v.style.display='none';}); document.getElementById('messagesView').style.display='block'; window.scrollTo(0,0); msgTab='updates'; renderMsgTabs(); loadMsgTab(); try{ msgBadgeClear(); }catch(e){} }
    function renderMsgTabs(){ ['updates','dm','store'].forEach(function(t){ var el=document.getElementById('msgTab'+t.charAt(0).toUpperCase()+t.slice(1)); if(el) el.className='msg-tab'+(msgTab===t?' active':''); }); }
    function setMsgTab(t){ msgTab=t; renderMsgTabs(); loadMsgTab(); }
    function loadMsgTab(){ var c=document.getElementById('msgContent'); c.innerHTML='<p style="text-align:center;padding:30px;color:#6b7686;">Loading...</p>'; if(msgTab==='updates') loadUpdates(); else if(msgTab==='dm') loadDmThreads(); else loadStoreFeed(); }
    function isMgr(){ return currentUser && (currentUser.role==='Admin Manager'||currentUser.role==='Manager'||currentUser.role==='Vice President/Co-Owner'||currentUser.is_developer===true); }

    function loadUpdates(){
        var c=document.getElementById('msgContent');
        withPin(function(pin){
            supabaseClient.rpc('app_announce_feed',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; c.innerHTML='<p style="color:red;text-align:center;">'+escapeHtml(r.error.message)+'</p>'; return; }
                if(r.data && r.data.linked===false){ c.innerHTML='<p style="text-align:center;padding:20px;color:#6b7686;">Your login isn\'t linked yet — ask a manager to link your account.</p>'; return; }
                var items=(r.data&&r.data.items)||[]; var h='';
                if(isMgr()){
                    h+='<div style="background:#fff;border:1px solid #eee;border-radius:12px;padding:14px;margin-bottom:14px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">' +
                        '<div style="font-size:14px;font-weight:500;color:#6a3fb5;margin-bottom:8px;">Post an update</div>' +
                        '<input id="anTitle" placeholder="Title (optional)" style="width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px;">' +
                        '<textarea id="anBody" rows="2" placeholder="What&#39;s the update? (new item, policy change…)" style="width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px;"></textarea>' +
                        '<div style="display:flex;gap:8px;"><select id="anAud" onchange="anAudChange()" style="flex:1;padding:9px;border:1px solid #ccc;border-radius:8px;"><option value="everyone">Everyone</option><option value="store">A store</option></select>' +
                        '<select id="anStore" style="flex:1;padding:9px;border:1px solid #ccc;border-radius:8px;display:none;"></select>' +
                        '<button onclick="postAnnounce()" style="background:#6a3fb5;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-weight:bold;cursor:pointer;">Post</button></div></div>';
                }
                if(!items.length){ h+='<p style="color:#6b7686;text-align:center;padding:10px;font-size:13px;">No updates yet.</p>'; }
                else items.forEach(function(a){
                    var _amg=isMgr()?('<div style="display:flex;gap:8px;margin-top:8px;"><button onclick="annEditItem('+a.id+')" style="background:#f3eeff;color:#6a3fb5;border:1px solid #d9c9f5;border-radius:7px;padding:4px 11px;font-size:12px;font-weight:700;cursor:pointer;">Edit</button><button onclick="annDeleteItem('+a.id+')" style="background:#fff2f3;color:#c0264b;border:1px solid #f0b8c3;border-radius:7px;padding:4px 11px;font-size:12px;font-weight:700;cursor:pointer;">Delete</button></div>'):'';
                    h+='<div style="background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 4px 6px rgba(0,0,0,0.05);'+(a.read?'':'border-left:4px solid #6a3fb5;')+'">' +
                        (a.title?'<div style="font-size:15px;font-weight:500;color:#333;">'+escapeHtml(a.title)+'</div>':'') +
                        '<div style="font-size:14px;color:#444;white-space:pre-wrap;">'+escapeHtml(a.body)+'</div>' +
                        '<div style="font-size:11px;color:#aab;margin-top:6px;">'+escapeHtml(a['from']||'')+' &bull; '+socFmt(a.at)+(a.mine?' &bull; &#10003; Read by '+(a.reads||0):'')+'</div>'+_amg+'</div>';
                });
                c.innerHTML=h;
                if(isMgr() && taTargets===null){ withPin(function(p2){ supabaseClient.rpc('app_task_targets',{p_username:currentUser.username,p_password:p2}).then(function(rr){ if(!rr.error){ taTargets=rr.data||{}; var sel=document.getElementById('anStore'); if(sel) sel.innerHTML=(taTargets.stores||[]).map(function(s){return '<option value="'+escapeHtml(s)+'">'+escapeHtml(s)+'</option>';}).join(''); } }); }); }
                else if(isMgr()){ var sel=document.getElementById('anStore'); if(sel&&taTargets) sel.innerHTML=(taTargets.stores||[]).map(function(s){return '<option value="'+escapeHtml(s)+'">'+escapeHtml(s)+'</option>';}).join(''); }
                // mark unread read
                (items||[]).forEach(function(a){ if(!a.read){ withPin(function(p3){ supabaseClient.rpc('app_announce_read',{p_username:currentUser.username,p_password:p3,p_id:a.id}); }); } });
            });
        });
    }
    function anAudChange(){ document.getElementById('anStore').style.display=(document.getElementById('anAud').value==='store')?'block':'none'; }
    function postAnnounce(){
        var title=document.getElementById('anTitle').value.trim(), body=document.getElementById('anBody').value.trim();
        var aud=document.getElementById('anAud').value, av=aud==='store'?document.getElementById('anStore').value:null;
        if(!body){ alert('Write an update first.'); return; }
        withPin(function(pin){ supabaseClient.rpc('app_announce_post',{p_username:currentUser.username,p_password:pin,p_title:title,p_body:body,p_audience_type:aud,p_audience_value:av}).then(function(r){ if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; } var _t=document.getElementById('anTitle'); if(_t)_t.value=''; var _b=document.getElementById('anBody'); if(_b)_b.value=''; loadUpdates(); }); });
    }

    function annEditItem(id){ var nb=prompt('Edit this announcement (type the new text):'); if(nb===null) return; nb=nb.trim(); if(!nb){ alert('Announcement cannot be empty.'); return; } withPin(function(pin){ supabaseClient.rpc('app_announcement_edit',{p_username:currentUser.username,p_password:pin,p_id:id,p_body:nb}).then(function(r){ if(r.error){ if(r.error.code==='42501') sessionPin=null; alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':('Error: '+r.error.message)); return; } loadUpdates(); }).catch(function(){ alert('Connection error.'); }); }); }
    function annDeleteItem(id){ if(!confirm('Delete this announcement? This cannot be undone.')) return; withPin(function(pin){ supabaseClient.rpc('app_announcement_delete',{p_username:currentUser.username,p_password:pin,p_id:id}).then(function(r){ if(r.error){ if(r.error.code==='42501') sessionPin=null; alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':('Error: '+r.error.message)); return; } loadUpdates(); }).catch(function(){ alert('Connection error.'); }); }); }
    function loadDmThreads(){
        var c=document.getElementById('msgContent');
        withPin(function(pin){
            supabaseClient.rpc('app_dm_threads',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; c.innerHTML='<p style="color:red;text-align:center;">'+escapeHtml(r.error.message)+'</p>'; return; }
                if(r.data && r.data.linked===false){ c.innerHTML='<p style="text-align:center;padding:20px;color:#6b7686;">Your login isn\'t linked yet — ask a manager to link your account.</p>'; return; }
                var th=(r.data&&r.data.threads)||[];
                var h='<button onclick="newDm()" style="width:100%;background:#6a3fb5;color:#fff;border:none;border-radius:8px;padding:10px;font-weight:bold;cursor:pointer;margin-bottom:12px;">&#10133; New message</button>';
                if(!th.length){ h+='<p style="color:#6b7686;text-align:center;font-size:13px;">No conversations yet.</p>'; }
                else th.forEach(function(t){
                    h+='<div onclick="openDm('+t.emp+',&quot;'+escapeHtml((t.name||'').replace(/"/g,''))+'&quot;)" style="background:#fff;border-radius:10px;padding:12px;margin-bottom:8px;box-shadow:0 2px 4px rgba(0,0,0,0.05);cursor:pointer;display:flex;justify-content:space-between;align-items:center;">' +
                        '<div><div style="font-size:14px;font-weight:500;color:#333;">'+escapeHtml(t.name||'')+'</div><div style="font-size:12px;color:#6b7686;">'+escapeHtml((t.last||'').slice(0,40))+'</div></div>' +
                        (t.unread>0?'<span style="background:#6a3fb5;color:#fff;border-radius:10px;font-size:11px;font-weight:bold;padding:2px 7px;">'+t.unread+'</span>':'') + '</div>';
                });
                c.innerHTML=h;
            });
        });
    }
    function newDm(){
        var c=document.getElementById('msgContent'); c.innerHTML='<p style="text-align:center;padding:20px;color:#6b7686;">Loading directory...</p>';
        withPin(function(pin){
            supabaseClient.rpc('app_directory',{p_username:currentUser.username,p_password:pin}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; c.innerHTML='<p style="color:red;text-align:center;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var ppl=(r.data||[]).filter(function(p){return p.linked;});
                var h='<button onclick="loadDmThreads()" style="background:#eee;border:none;border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer;margin-bottom:12px;">&#8592; Back</button>' +
                    '<input id="dirSearch" onkeyup="dirFilter()" placeholder="Search name..." style="width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;margin-bottom:10px;">' +
                    '<div id="dirList">';
                ppl.forEach(function(p){ h+='<div class="dir-row" data-n="'+escapeHtml((p.name||'').toLowerCase())+'" onclick="openDm('+p.id+',&quot;'+escapeHtml((p.name||'').replace(/"/g,''))+'&quot;)" style="background:#fff;border-radius:10px;padding:11px;margin-bottom:7px;box-shadow:0 2px 4px rgba(0,0,0,0.05);cursor:pointer;font-size:14px;color:#333;">'+escapeHtml(p.name)+(p.store?' <span style="color:#aab;font-size:11px;">'+escapeHtml(p.store)+'</span>':'')+'</div>'; });
                if(!ppl.length) h+='<p style="color:#6b7686;text-align:center;font-size:13px;">No one else has a login yet.</p>';
                h+='</div>'; c.innerHTML=h;
            });
        });
    }
    function dirFilter(){ var q=(document.getElementById('dirSearch').value||'').toLowerCase(); [].slice.call(document.querySelectorAll('.dir-row')).forEach(function(d){ d.style.display=(d.getAttribute('data-n').indexOf(q)>-1)?'block':'none'; }); }
    var dmWith=null, dmWithName='';
    function openDm(emp, name){ dmWith=emp; dmWithName=name||''; renderDm(); }
    function renderDm(){
        var c=document.getElementById('msgContent');
        withPin(function(pin){
            supabaseClient.rpc('app_dm_thread',{p_username:currentUser.username,p_password:pin,p_with_emp:dmWith}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; c.innerHTML='<p style="color:red;text-align:center;">'+escapeHtml(r.error.message)+'</p>'; return; }
                var msgs=(r.data&&r.data.messages)||[];
                var h='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;"><button onclick="loadDmThreads()" style="background:#eee;border:none;border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer;">&#8592;</button><span style="font-size:15px;font-weight:500;color:#333;">'+escapeHtml(dmWithName)+'</span></div>' +
                    '<div style="background:#f7f5fb;border-radius:12px;padding:12px;max-height:50vh;overflow:auto;margin-bottom:10px;">';
                if(!msgs.length) h+='<p style="color:#6b7686;text-align:center;font-size:13px;">No messages yet. Say hi!</p>';
                msgs.forEach(function(m){ var rcpt=m.mine?(' &middot; '+(m.read?'&#10003; Read':'Sent')):''; h+='<div style="display:flex;justify-content:'+(m.mine?'flex-end':'flex-start')+';margin-bottom:6px;"><div style="max-width:75%;background:'+(m.mine?'#6a3fb5':'#fff')+';color:'+(m.mine?'#fff':'#333')+';border-radius:12px;padding:8px 11px;font-size:14px;box-shadow:0 1px 2px rgba(0,0,0,0.08);">'+escapeHtml(m.body)+'<div style="font-size:10px;opacity:.7;margin-top:2px;">'+socFmt(m.at)+rcpt+'</div></div></div>'; });
                h+='</div><div style="display:flex;gap:8px;"><input id="dmInput" onkeypress="if(event.key===&quot;Enter&quot;)sendDm()" placeholder="Message..." style="flex:1;padding:10px;border:1px solid #ccc;border-radius:8px;"><button onclick="sendDm()" style="background:#6a3fb5;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-weight:bold;cursor:pointer;">Send</button></div>';
                c.innerHTML=h; var inp=document.getElementById('dmInput'); if(inp) inp.focus();
            });
        });
    }
    function sendDm(){ var inp=document.getElementById('dmInput'); var body=(inp.value||'').trim(); if(!body) return; inp.value=''; withPin(function(pin){ supabaseClient.rpc('app_dm_send',{p_username:currentUser.username,p_password:pin,p_to_emp:dmWith,p_body:body}).then(function(r){ if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; } renderDm(); }); }); }

    function loadStoreFeed(){
        var c=document.getElementById('msgContent');
        withPin(function(pin){
            supabaseClient.rpc('app_store_feed',{p_username:currentUser.username,p_password:pin,p_location:activeStoreLoc()}).then(function(r){
                if(r.error){ if(r.error.code==='42501') sessionPin=null; c.innerHTML='<p style="color:red;text-align:center;">'+escapeHtml(r.error.message)+'</p>'; return; }
                if(r.data && r.data.linked===false){ c.innerHTML='<p style="text-align:center;padding:20px;color:#6b7686;">Your login isn\'t linked yet — ask a manager to link your account.</p>'; return; }
                var msgs=(r.data&&r.data.messages)||[]; var store=(r.data&&r.data.store)||'your store';
                var h='<div style="font-size:13px;color:#6b7686;margin-bottom:10px;">Team thread for <strong>'+escapeHtml(store)+'</strong></div>' +
                    '<div style="background:#f7f5fb;border-radius:12px;padding:12px;max-height:55vh;overflow:auto;margin-bottom:10px;">';
                if(!msgs.length) h+='<p style="color:#6b7686;text-align:center;font-size:13px;">No messages yet.</p>';
                msgs.forEach(function(m){ h+='<div style="display:flex;justify-content:'+(m.mine?'flex-end':'flex-start')+';margin-bottom:8px;"><div style="max-width:78%;background:'+(m.mine?'#6a3fb5':'#fff')+';color:'+(m.mine?'#fff':'#333')+';border-radius:12px;padding:8px 11px;font-size:14px;box-shadow:0 1px 2px rgba(0,0,0,0.08);">'+(!m.mine?'<div style="font-size:11px;font-weight:500;opacity:.8;">'+escapeHtml(m.name||'')+'</div>':'')+escapeHtml(m.body)+'<div style="font-size:10px;opacity:.7;margin-top:2px;">'+socFmt(m.at)+'</div></div></div>'; });
                h+='</div><div style="display:flex;gap:8px;"><input id="stInput" onkeypress="if(event.key===&quot;Enter&quot;)postStore()" placeholder="Message your store team..." style="flex:1;padding:10px;border:1px solid #ccc;border-radius:8px;"><button onclick="postStore()" style="background:#6a3fb5;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-weight:bold;cursor:pointer;">Send</button></div>';
                c.innerHTML=h;
            });
        });
    }
    function postStore(){ var inp=document.getElementById('stInput'); var body=(inp.value||'').trim(); if(!body) return; inp.value=''; withPin(function(pin){ supabaseClient.rpc('app_store_post',{p_username:currentUser.username,p_password:pin,p_location:activeStoreLoc(),p_body:body}).then(function(r){ if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; } loadStoreFeed(); }); }); }

    // Priority level meta (1=Critical .. 4=Low; default Normal)
    function maintPrioMeta(rank) {
        var r = parseInt(rank, 10) || 3;
        if (r <= 1) return { label: 'Critical', color: 'var(--damage-red)' };
        if (r === 2) return { label: 'High', color: 'var(--maint-orange)' };
        if (r === 3) return { label: 'Normal', color: 'var(--caliches-blue)' };
        return { label: 'Low', color: 'var(--na-gray)' };
    }

    // Manager sets an explicit priority level; board re-sorts automatically.
    function setMaintPriorityLevel(id, rank) {
        withPin(function(pin) {
            supabaseClient.rpc('app_maintboard_set_priority', { p_username: currentUser.username, p_password: pin, p_id: id, p_rank: parseInt(rank, 10) })
            .then(({ error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if (error) { alert('Error: ' + error.message); } else { fetchMaintenanceBoard(); }
            });
        });
    }
