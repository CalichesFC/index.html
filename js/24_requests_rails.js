    // ===== REQUESTS RAILS — HR/W-2 requests + Party-Pack orders + Gift-Card orders =====
    // Entry: openRequestsRails()  •  Overlay id: requestsRailsModal
    // Rides the existing task + push rails (app_task_create / push_enqueue, server-side).
    //
    // GET / SAVE SHAPES (must match requests_rails.sql exactly):
    //   rq_config_get            -> { hr_types:[], statuses:[], pp_items:[], gc_denoms:[],
    //                                 gc_delivery:[], hr_delivery:[], hr_due_days, pp_prep_days,
    //                                 gc_due_days, office_task_store, is_mgr }
    //   rq_list(p_scope,'mine'|'queue', p_status?, p_rtype?)
    //                            -> { requests:[ {id,rtype,subtype,status,employee_id,
    //                                 employee_name,store,event_date,details,task_id,task_status,
    //                                 issued_what,issued_to,fulfill_note,fulfilled_by,fulfilled_at,
    //                                 status_history,created_by,created_by_uid,created_at,updated_at} ] }
    //   rq_emp_search(p_q)       -> { employees:[ {id,name} ] }             (managers)
    //   rq_hr_create(p_employee_id|null, p_subtype, p_delivery, p_notes)
    //                            -> { ok,id,task_id,task_status }
    //   rq_party_pack_create(p_store, p_event_date, p_event_time, p_customer,
    //                        p_items:[{item,qty}], p_notes) -> { ok,id,task_id,task_status }
    //   rq_gift_card_create(p_store, p_needed_by, p_delivery, p_company,
    //                       p_lines:[{denom,qty}], p_notes)
    //                            -> { ok,id,task_id,task_status,total_qty,total_amount }
    //                               (totals are SERVER-side and authoritative; the form
    //                                total is a live preview only)
    //   rq_status_set(p_id,p_status,p_note) / rq_fulfill(p_id,p_issued_what,p_issued_to,p_note)
    //   rq_cancel(p_id,p_note) / rq_task_retry(p_id)   -> { ok,id,... }
    var _rq={tab:'hr',cfg:null,mine:[],queue:[],qStatus:'',qType:'',ppLines:[],gcLines:[],hrEmp:null,hrEmps:[]};
    function rqRpc(name,args,cb,onerr){ withPin(function(pin){ supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){ if(r.error){ if(onerr)onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; } cb(r.data); }).catch(function(){ if(onerr)onerr({message:'Connection error'}); else alert('Connection error.'); }); }); }
    function rqIsMgr(){ if(_rq.cfg&&_rq.cfg.is_mgr===true) return true; try{ if(typeof isManagerRole==='function') return isManagerRole(); }catch(e){} var r=(currentUser&&currentUser.role)||''; return /manager|admin|lead|owner|vp|vice president/i.test(r); }
    function rqOv(){ var ov=document.getElementById('requestsRailsModal'); if(!ov){ ov=document.createElement('div'); ov.id='requestsRailsModal'; ov.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(ov); } ov.style.display='block'; return ov; }
    function rqClose(){ var o=document.getElementById('requestsRailsModal'); if(o)o.style.display='none'; rqM2Close(); }
    function rqHeader(title){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">'+title+'</b><button onclick="rqClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }
    function rqList(key,fb){ var v=_rq.cfg&&_rq.cfg[key]; if(v&&v.length) return v; return fb; }
    function rqStores(){ return (typeof HUB_STORES!=='undefined'&&HUB_STORES&&HUB_STORES.length?HUB_STORES.slice():['Roadrunner','Valley','Lenox','Alamogordo','Roswell']); }
    function rqEsc(s){ return (typeof escapeHtml==='function')?escapeHtml(s==null?'':String(s)):String(s==null?'':s); }
    function rqAttr(s){ return rqEsc(s).replace(/'/g,'&#39;'); }
    function rqDate(s){ if(!s) return ''; try{ var p=String(s).slice(0,10).split('-'); var dt=new Date(+p[0],+p[1]-1,+p[2]); if(!isNaN(dt.getTime())) return dt.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }catch(e){} return String(s).slice(0,10); }
    function rqWhen(s){ if(!s) return ''; try{ return new Date(s).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }catch(e){ return String(s); } }
    var RQ_ICON={hr:'🗂️',party_pack:'🎉',gift_card:'💳'};
    var RQ_LABEL={hr:'HR / W-2',party_pack:'Party Pack',gift_card:'Gift Cards'};
    function rqChip(st){ var m={requested:['#9a5b00','#fff4e0'],in_progress:['#185FA5','#eef3fb'],fulfilled:['#1b7a3d','#e8f5ec'],cancelled:['#6b7686','#eef0f3']}; var c=m[st]||['#5b6472','#eef0f3']; return '<span style="background:'+c[1]+';color:'+c[0]+';font-size:11px;font-weight:800;padding:2px 9px;border-radius:99px;white-space:nowrap;">'+rqEsc(String(st||'').replace(/_/g,' '))+'</span>'; }
    var RQ_CARD='background:#fff;border:1px solid #ececf2;border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,.04);';
    var RQ_LBL='display:block;font-size:11px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;margin:10px 0 4px;';
    var RQ_IN='width:100%;box-sizing:border-box;border:1px solid #cdd5e0;border-radius:9px;padding:9px 10px;font-size:13.5px;background:#fff;';
    var RQ_BTN='background:#185FA5;color:#fff;border:none;border-radius:10px;padding:11px 16px;font-size:14px;font-weight:800;cursor:pointer;width:100%;margin-top:14px;';
    var RQ_MINI='background:#eef0f3;color:#185FA5;border:none;border-radius:7px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;';

    function openRequestsRails(){ _rq.tab='hr'; _rq.ppLines=[{item:'',qty:1}]; _rq.gcLines=[{denom:'',qty:1}]; _rq.hrEmp=null; _rq.hrEmps=[];
        rqOv().innerHTML=rqHeader('Requests')+'<div style="max-width:760px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading requests&hellip;</div>';
        rqRpc('rq_config_get',{},function(cfg){ _rq.cfg=cfg||{}; rqLoadMine(function(){ rqRender(); }); },function(e){ rqOv().innerHTML=rqHeader('Requests')+'<div style="max-width:760px;margin:0 auto;padding:30px 16px;text-align:center;color:#c0264b;">'+rqEsc(e.message||'Could not load.')+'</div>'; });
    }
    function rqLoadMine(cb){ rqRpc('rq_list',{p_scope:'mine'},function(d){ _rq.mine=(d&&d.requests)||[]; if(cb)cb(); },function(e){ _rq.mine=[]; alert('Could not load your requests: '+((e&&e.message)||'Error')+'.'); if(cb)cb(); }); }
    function rqLoadQueue(cb){ rqRpc('rq_list',{p_scope:'queue',p_status:_rq.qStatus||null,p_rtype:_rq.qType||null},function(d){ _rq.queue=(d&&d.requests)||[]; if(cb)cb(); },function(e){ _rq.queue=[]; alert(String(e.message||'').indexOf('forbidden')>=0?'Managers only.':(e.message||'Error')); if(cb)cb(); }); }
    function rqTabs(){ var t=_rq.tab; function b(id,lbl){ return '<button onclick="rqSetTab(\''+id+'\')" style="flex:1;background:'+(t===id?'#185FA5':'#eef0f3')+';color:'+(t===id?'#fff':'#5b6472')+';border:none;padding:10px 6px;font-size:12.5px;font-weight:700;cursor:pointer;border-radius:9px;white-space:nowrap;">'+lbl+'</button>'; }
        var h='<div style="display:flex;gap:6px;max-width:760px;margin:14px auto 0;padding:0 16px;">'+b('hr','🗂️ HR / W-2')+b('pp','🎉 Party Pack')+b('gc','💳 Gift Cards');
        if(rqIsMgr()) h+=b('queue','📥 Queue');
        return h+'</div>'; }
    function rqSetTab(t){ _rq.tab=t; if(t==='queue'){ rqOv().innerHTML=rqHeader('Requests')+rqTabs()+'<div style="max-width:760px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading queue&hellip;</div>'; rqLoadQueue(function(){ rqRender(); }); } else rqRender(); }
    function rqRender(){ var body=(_rq.tab==='pp')?rqPpHtml():(_rq.tab==='gc')?rqGcHtml():(_rq.tab==='queue')?rqQueueHtml():rqHrHtml();
        rqOv().innerHTML=rqHeader('Requests')+rqTabs()+'<div style="max-width:760px;margin:0 auto;padding:14px 16px 50px;">'+body+'</div>'; }

    // ---------- shared "my requests" strip ----------
    function rqMineHtml(rtype){ var rows=(_rq.mine||[]).filter(function(r){ return r.rtype===rtype; });
        var h='<div style="'+RQ_CARD+'"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#6b6275;margin-bottom:8px;">My '+rqEsc(RQ_LABEL[rtype]||'')+' requests</div>';
        if(!rows.length) return h+'<div style="font-size:13px;color:#6b7686;">Nothing yet &mdash; your requests will show up here with a live status.</div></div>';
        rows.forEach(function(r){ var d=r.details||{};
            var line=(rtype==='hr')?(r.subtype||'Request'):(rtype==='party_pack')?((d.summary||'Party pack')+(r.event_date?' • '+rqDate(r.event_date):'')):((d.summary||'Gift cards')+(d.total_amount!=null?' • $'+d.total_amount:''));
            h+='<div style="border:1px solid #eef0f5;border-radius:10px;padding:10px;margin-bottom:7px;">'
              +'<div style="display:flex;align-items:center;gap:8px;"><b style="flex:1;font-size:13.5px;color:#26242b;">'+rqEsc(line)+'</b>'+rqChip(r.status)+'</div>'
              +'<div style="font-size:11.5px;color:#6b7686;margin-top:4px;">#'+r.id+' • '+rqWhen(r.created_at)
              +(r.status==='fulfilled'&&r.issued_what?(' • Issued: '+rqEsc(r.issued_what)+(r.issued_to?' → '+rqEsc(r.issued_to):'')):'')
              +'</div>'
              +((r.status==='requested'&&(rqIsMgr()||r.created_by===currentUser.name))?'<div style="margin-top:6px;"><button onclick="rqCancelReq('+r.id+')" style="background:#fdecec;color:#c0392b;border:none;border-radius:7px;padding:4px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">Cancel</button></div>':'')
              +'</div>'; });
        return h+'</div>'; }

    // ---------- TAB 1: HR / W-2 ----------
    function rqHrHtml(){ var types=rqList('hr_types',['Employment Verification','W-2 Reprint']); var dels=rqList('hr_delivery',['Pickup at office','Email PDF','Mail']);
        var h='<div style="'+RQ_CARD+'"><div style="font-size:15px;font-weight:800;color:#1f2a44;">🗂️ Employment Verification / W-2</div>'
          +'<p style="font-size:12.5px;color:#6b7686;margin:6px 0 0;">Sends a tracked request to the office. You’ll get a notification at each step.</p>'
          +'<label style="'+RQ_LBL+'">What do you need?</label><select id="rqHrType" style="'+RQ_IN+'">'+types.map(function(t){return '<option value="'+rqAttr(t)+'">'+rqEsc(t)+'</option>';}).join('')+'</select>'
          +'<label style="'+RQ_LBL+'">How should it be delivered?</label><select id="rqHrDel" style="'+RQ_IN+'">'+dels.map(function(t){return '<option value="'+rqAttr(t)+'">'+rqEsc(t)+'</option>';}).join('')+'</select>';
        if(rqIsMgr()){ h+='<label style="'+RQ_LBL+'">For (managers can request on someone’s behalf)</label>'
          +'<div style="display:flex;gap:6px;"><input id="rqHrQ" placeholder="Search a name… (leave blank = myself)" style="'+RQ_IN+'flex:1;" oninput="if(!this.value){_rq.hrEmp=null;_rq.hrEmps=[];}"><button onclick="rqHrSearch()" style="'+RQ_MINI+'">Search</button></div>'
          +'<div id="rqHrEmpBox">'+rqHrEmpBoxHtml()+'</div>'; }
        h+='<label style="'+RQ_LBL+'">Notes (who is verifying, address, tax year…)</label><textarea id="rqHrNotes" rows="2" style="'+RQ_IN+'resize:vertical;"></textarea>'
          +'<button onclick="rqHrSubmit()" style="'+RQ_BTN+'">Submit request</button></div>';
        return h+rqMineHtml('hr'); }
    function rqHrEmpBoxHtml(){ if(_rq.hrEmp) return '<div style="font-size:12.5px;color:#1b7a3d;font-weight:700;margin-top:6px;">Requesting for: '+rqEsc(_rq.hrEmp.name)+' <button onclick="_rq.hrEmp=null;_rq.hrEmps=[];rqRender();" style="background:none;border:none;color:#c0392b;cursor:pointer;font-size:12px;">✕</button></div>';
        if(!_rq.hrEmps.length) return '';
        return '<div style="margin-top:6px;">'+_rq.hrEmps.map(function(e){ return '<button onclick="rqHrPick('+e.id+',\''+rqAttr(e.name)+'\')" style="'+RQ_MINI+'margin:0 5px 5px 0;">'+rqEsc(e.name)+'</button>'; }).join('')+'</div>'; }
    function rqHrSearch(){ var q=(document.getElementById('rqHrQ')||{}).value||''; if(!q.trim()){ alert('Type part of a name first.'); return; }
        rqRpc('rq_emp_search',{p_q:q.trim()},function(d){ _rq.hrEmps=(d&&d.employees)||[]; var box=document.getElementById('rqHrEmpBox'); if(box) box.innerHTML=_rq.hrEmps.length?rqHrEmpBoxHtml():'<div style="font-size:12px;color:#9a5b00;margin-top:6px;">No matches.</div>'; }); }
    function rqHrPick(id,name){ _rq.hrEmp={id:id,name:name}; _rq.hrEmps=[]; var box=document.getElementById('rqHrEmpBox'); if(box) box.innerHTML=rqHrEmpBoxHtml(); var q=document.getElementById('rqHrQ'); if(q) q.value=''; }
    function rqHrSubmit(){ var t=(document.getElementById('rqHrType')||{}).value; var del=(document.getElementById('rqHrDel')||{}).value; var notes=(document.getElementById('rqHrNotes')||{}).value||'';
        if(!t){ alert('Pick a request type.'); return; }
        rqRpc('rq_hr_create',{p_employee_id:_rq.hrEmp?_rq.hrEmp.id:null,p_subtype:t,p_delivery:del||'',p_notes:notes},function(res){
            alert('Request submitted.'+((res&&res.task_status&&String(res.task_status).indexOf('failed')===0)?' (Office was notified; a manager will file the task.)':''));
            _rq.hrEmp=null; rqLoadMine(function(){ rqRender(); }); }); }

    // ---------- TAB 2: Party Pack ----------
    function rqPpHtml(){ var items=rqList('pp_items',['Vanilla Custard Tub','Chocolate Custard Tub']); var stores=rqStores();
        var h='<div style="'+RQ_CARD+'"><div style="font-size:15px;font-weight:800;color:#1f2a44;">🎉 Party-Pack order</div>'
          +'<p style="font-size:12.5px;color:#6b7686;margin:6px 0 0;">Creates a prep task at the store automatically (due '+rqEsc(String((_rq.cfg&&_rq.cfg.pp_prep_days)!=null?_rq.cfg.pp_prep_days:1))+' day(s) before the event) and notifies its managers.</p>'
          +'<label style="'+RQ_LBL+'">Store</label><select id="rqPpStore" style="'+RQ_IN+'">'+stores.map(function(s){return '<option value="'+rqAttr(s)+'">'+rqEsc(s)+'</option>';}).join('')+'</select>'
          +'<div style="display:flex;gap:8px;"><div style="flex:1;"><label style="'+RQ_LBL+'">Event date</label><input type="date" id="rqPpDate" style="'+RQ_IN+'"></div>'
          +'<div style="flex:1;"><label style="'+RQ_LBL+'">Time</label><input type="time" id="rqPpTime" style="'+RQ_IN+'"></div></div>'
          +'<label style="'+RQ_LBL+'">Customer / occasion (optional)</label><input id="rqPpCust" style="'+RQ_IN+'" placeholder="e.g. Smith birthday">'
          +'<label style="'+RQ_LBL+'">Items</label><div id="rqPpLines">'+rqPpLinesHtml(items)+'</div>'
          +'<button onclick="rqPpAdd()" style="'+RQ_MINI+'margin-top:6px;">+ Add item</button>'
          +'<label style="'+RQ_LBL+'">Notes</label><textarea id="rqPpNotes" rows="2" style="'+RQ_IN+'resize:vertical;"></textarea>'
          +'<button onclick="rqPpSubmit()" style="'+RQ_BTN+'">Place party-pack order</button></div>';
        return h+rqMineHtml('party_pack'); }
    function rqPpLinesHtml(items){ return _rq.ppLines.map(function(l,i){
            return '<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">'
              +'<select onchange="_rq.ppLines['+i+'].item=this.value;" style="'+RQ_IN+'flex:1;"><option value="">Pick an item…</option>'+items.map(function(it){return '<option value="'+rqAttr(it)+'"'+(l.item===it?' selected':'')+'>'+rqEsc(it)+'</option>';}).join('')+'</select>'
              +'<input type="number" min="1" value="'+(parseInt(l.qty,10)||1)+'" onchange="_rq.ppLines['+i+'].qty=this.value;" style="'+RQ_IN+'width:72px;">'
              +(_rq.ppLines.length>1?'<button onclick="rqPpDel('+i+')" style="background:#fdecec;color:#c0392b;border:none;border-radius:7px;width:30px;height:34px;cursor:pointer;">✕</button>':'')
              +'</div>'; }).join(''); }
    function rqPpAdd(){ _rq.ppLines.push({item:'',qty:1}); rqRender(); }
    function rqPpDel(i){ _rq.ppLines.splice(i,1); rqRender(); }
    function rqPpSubmit(){ var store=(document.getElementById('rqPpStore')||{}).value; var d=(document.getElementById('rqPpDate')||{}).value; var tm=(document.getElementById('rqPpTime')||{}).value||''; var cust=(document.getElementById('rqPpCust')||{}).value||''; var notes=(document.getElementById('rqPpNotes')||{}).value||'';
        var items=(_rq.ppLines||[]).filter(function(l){ return l.item&&(parseInt(l.qty,10)||0)>0; }).map(function(l){ return {item:l.item,qty:parseInt(l.qty,10)||1}; });
        if(!store){ alert('Pick a store.'); return; } if(!d){ alert('Pick the event date.'); return; } if(!items.length){ alert('Add at least one item.'); return; }
        rqRpc('rq_party_pack_create',{p_store:store,p_event_date:d,p_event_time:tm,p_customer:cust,p_items:items,p_notes:notes},function(res){
            alert('Order placed.'+((res&&res.task_status==='created')?' A prep task was created at '+store+'.':' (Managers were notified; the task can be filed from the queue.)'));
            _rq.ppLines=[{item:'',qty:1}]; rqLoadMine(function(){ rqRender(); }); }); }

    // ---------- TAB 3: Gift Cards ----------
    function rqGcHtml(){ var denoms=rqList('gc_denoms',['10','25','50','100']); var dels=rqList('gc_delivery',['Pickup in store','Deliver to business','Mail']); var stores=rqStores();
        var tq=0,ta=0; (_rq.gcLines||[]).forEach(function(l){ var q=parseInt(l.qty,10)||0; var dn=parseFloat(l.denom)||0; tq+=q; ta+=q*dn; });
        var h='<div style="'+RQ_CARD+'"><div style="font-size:15px;font-weight:800;color:#1f2a44;">💳 Gift-card order</div>'
          +'<p style="font-size:12.5px;color:#6b7686;margin:6px 0 0;">Bulk / corporate orders welcome — a fulfillment task is routed to the office with the totals.</p>'
          +'<label style="'+RQ_LBL+'">Requesting store</label><select id="rqGcStore" style="'+RQ_IN+'">'+stores.map(function(s){return '<option value="'+rqAttr(s)+'">'+rqEsc(s)+'</option>';}).join('')+'</select>'
          +'<label style="'+RQ_LBL+'">Company / customer (optional)</label><input id="rqGcCo" style="'+RQ_IN+'" placeholder="e.g. Acme Realty — employee gifts">'
          +'<div style="display:flex;gap:8px;"><div style="flex:1;"><label style="'+RQ_LBL+'">Needed by</label><input type="date" id="rqGcDate" style="'+RQ_IN+'"></div>'
          +'<div style="flex:1;"><label style="'+RQ_LBL+'">Delivery</label><select id="rqGcDel" style="'+RQ_IN+'">'+dels.map(function(t){return '<option value="'+rqAttr(t)+'">'+rqEsc(t)+'</option>';}).join('')+'</select></div></div>'
          +'<label style="'+RQ_LBL+'">Cards</label><div id="rqGcLines">'+rqGcLinesHtml(denoms)+'</div>'
          +'<button onclick="rqGcAdd()" style="'+RQ_MINI+'margin-top:6px;">+ Add denomination</button>'
          +'<div style="background:#eef3fb;border-radius:10px;padding:9px 12px;margin-top:10px;font-size:13px;color:#185FA5;font-weight:700;">Preview: '+tq+' card(s) • $'+ta.toLocaleString()+' <span style="font-weight:400;color:#5b6675;">(final totals are computed by the server)</span></div>'
          +'<label style="'+RQ_LBL+'">Notes</label><textarea id="rqGcNotes" rows="2" style="'+RQ_IN+'resize:vertical;"></textarea>'
          +'<button onclick="rqGcSubmit()" style="'+RQ_BTN+'">Place gift-card order</button></div>';
        return h+rqMineHtml('gift_card'); }
    function rqGcLinesHtml(denoms){ return _rq.gcLines.map(function(l,i){
            return '<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">'
              +'<select onchange="_rq.gcLines['+i+'].denom=this.value;rqRender();" style="'+RQ_IN+'flex:1;"><option value="">Denomination…</option>'+denoms.map(function(dn){return '<option value="'+rqAttr(dn)+'"'+(String(l.denom)===String(dn)?' selected':'')+'>$'+rqEsc(dn)+'</option>';}).join('')+'</select>'
              +'<input type="number" min="1" value="'+(parseInt(l.qty,10)||1)+'" onchange="_rq.gcLines['+i+'].qty=this.value;rqRender();" style="'+RQ_IN+'width:72px;">'
              +(_rq.gcLines.length>1?'<button onclick="rqGcDel('+i+')" style="background:#fdecec;color:#c0392b;border:none;border-radius:7px;width:30px;height:34px;cursor:pointer;">✕</button>':'')
              +'</div>'; }).join(''); }
    function rqGcAdd(){ _rq.gcLines.push({denom:'',qty:1}); rqRender(); }
    function rqGcDel(i){ _rq.gcLines.splice(i,1); rqRender(); }
    function rqGcSubmit(){ var store=(document.getElementById('rqGcStore')||{}).value||''; var d=(document.getElementById('rqGcDate')||{}).value||null; var del=(document.getElementById('rqGcDel')||{}).value||''; var co=(document.getElementById('rqGcCo')||{}).value||''; var notes=(document.getElementById('rqGcNotes')||{}).value||'';
        var lines=(_rq.gcLines||[]).filter(function(l){ return l.denom&&(parseInt(l.qty,10)||0)>0; }).map(function(l){ return {denom:l.denom,qty:parseInt(l.qty,10)||1}; });
        if(!lines.length){ alert('Add at least one denomination.'); return; }
        rqRpc('rq_gift_card_create',{p_store:store,p_needed_by:d,p_delivery:del,p_company:co,p_lines:lines,p_notes:notes},function(res){
            alert('Order placed: '+(res&&res.total_qty)+' card(s), $'+(res&&res.total_amount)+'.'+((res&&res.task_status==='created')?' The office got a fulfillment task.':' (The office was notified; the task can be filed from the queue.)'));
            _rq.gcLines=[{denom:'',qty:1}]; rqLoadMine(function(){ rqRender(); }); }); }

    // ---------- TAB 4: Fulfillment queue (managers/office) ----------
    function rqQueueHtml(){ if(!rqIsMgr()) return '<div style="'+RQ_CARD+'text-align:center;color:#6b7686;">Managers only.</div>';
        var sts=[''].concat(rqList('statuses',['requested','in_progress','fulfilled','cancelled']));
        var types=[['','All types'],['hr','HR / W-2'],['party_pack','Party Pack'],['gift_card','Gift Cards']];
        var h='<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">'
          +'<select onchange="_rq.qStatus=this.value;rqSetTab(\'queue\');" style="'+RQ_IN+'width:auto;flex:1;min-width:130px;">'+sts.map(function(s){return '<option value="'+rqAttr(s)+'"'+(_rq.qStatus===s?' selected':'')+'>'+(s?rqEsc(s.replace(/_/g,' ')):'All statuses')+'</option>';}).join('')+'</select>'
          +'<select onchange="_rq.qType=this.value;rqSetTab(\'queue\');" style="'+RQ_IN+'width:auto;flex:1;min-width:130px;">'+types.map(function(t){return '<option value="'+t[0]+'"'+(_rq.qType===t[0]?' selected':'')+'>'+t[1]+'</option>';}).join('')+'</select>'
          +'<button onclick="rqSetTab(\'queue\')" style="'+RQ_MINI+'">↺ Refresh</button></div>';
        if(!_rq.queue.length) return h+'<div style="'+RQ_CARD+'text-align:center;color:#6b7686;">No requests here — the queue is clear. 🍦</div>';
        _rq.queue.forEach(function(r){ var d=r.details||{};
            var line=(r.rtype==='hr')?((r.subtype||'HR request')+' — '+(r.employee_name||'')):
                     (r.rtype==='party_pack')?((d.summary||'Party pack')+(r.event_date?' • event '+rqDate(r.event_date):'')+' • '+(r.store||'')):
                     ((d.summary||'Gift cards')+(d.total_amount!=null?' • $'+d.total_amount:'')+(d.delivery?' • '+d.delivery:''));
            h+='<div style="'+RQ_CARD+'margin-bottom:10px;">'
              +'<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:18px;">'+(RQ_ICON[r.rtype]||'📋')+'</span><b style="flex:1;font-size:14px;color:#26242b;">'+rqEsc(line)+'</b>'+rqChip(r.status)+'</div>'
              +'<div style="font-size:11.5px;color:#6b7686;margin-top:5px;">#'+r.id+' • '+rqEsc(RQ_LABEL[r.rtype]||r.rtype)+' • by '+rqEsc(r.created_by||'?')+' • '+rqWhen(r.created_at)
              +(d.notes?' • '+rqEsc(d.notes):'')+((r.rtype==='hr'&&d.delivery)?' • '+rqEsc(d.delivery):'')+'</div>'
              +(r.task_id?'<div style="font-size:11.5px;color:#1b7a3d;margin-top:3px;">✓ Task #'+rqEsc(r.task_id)+' created</div>':(r.task_status?'<div style="font-size:11.5px;color:#9a5b00;margin-top:3px;">⚠ Auto-task: '+rqEsc(r.task_status)+' <button onclick="rqRetryTask('+r.id+')" style="'+RQ_MINI+'">Retry task</button></div>':''))
              +(r.status==='fulfilled'?'<div style="font-size:12px;color:#1b7a3d;margin-top:5px;">Issued: <b>'+rqEsc(r.issued_what||'—')+'</b>'+(r.issued_to?' → '+rqEsc(r.issued_to):'')+' • by '+rqEsc(r.fulfilled_by||'')+' '+rqWhen(r.fulfilled_at)+'</div>':'')
              +((r.status!=='fulfilled'&&r.status!=='cancelled')?('<div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap;">'
                 +(r.status==='requested'?'<button onclick="rqStart('+r.id+')" style="'+RQ_MINI+'">▶ Start</button>':'')
                 +'<button onclick="rqFulfillOpen('+r.id+')" style="background:#1f7a3d;color:#fff;border:none;border-radius:7px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;">✓ Fulfill…</button>'
                 +'<button onclick="rqCancelReq('+r.id+')" style="background:#fdecec;color:#c0392b;border:none;border-radius:7px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;">Cancel</button>'
                 +'</div>'):'')
              +'</div>'; });
        return h; }
    function rqStart(id){ rqRpc('rq_status_set',{p_id:id,p_status:'in_progress',p_note:null},function(){ rqLoadQueue(function(){ rqRender(); }); }); }
    function rqRetryTask(id){ rqRpc('rq_task_retry',{p_id:id},function(res){ alert((res&&res.ok)?'Task created.':'Still failing: '+((res&&res.task_status)||'?')); rqLoadQueue(function(){ rqRender(); }); }); }
    function rqCancelReq(id){ var note=prompt('Cancel this request? Add a short reason (optional):'); if(note===null) return;
        rqRpc('rq_cancel',{p_id:id,p_note:note||''},function(){ rqLoadMine(function(){ if(_rq.tab==='queue') rqLoadQueue(function(){ rqRender(); }); else rqRender(); }); },function(e){ alert(String(e.message||'').indexOf('forbidden')>=0?'Only the person who submitted this request (or a manager) can cancel it.':((e&&e.message)||'Could not cancel this request.')); }); }

    // fulfill mini-modal (records WHAT was issued and to WHOM/WHERE — audited)
    function rqM2(){ var m=document.getElementById('rqModal2'); if(!m){ m=document.createElement('div'); m.id='rqModal2'; m.style.cssText='position:fixed;inset:0;background:rgba(20,24,32,.55);z-index:100060;display:none;overflow:auto;'; document.body.appendChild(m); } return m; }
    function rqM2Close(){ var m=document.getElementById('rqModal2'); if(m) m.style.display='none'; }
    function rqFulfillOpen(id){ var m=rqM2(); m.style.display='block';
        m.innerHTML='<div style="max-width:420px;margin:80px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.25);">'
          +'<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:12px 16px;display:flex;align-items:center;"><b style="flex:1;">Fulfill request #'+id+'</b><button onclick="rqM2Close()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:5px 9px;cursor:pointer;">&times;</button></div>'
          +'<div style="padding:14px 16px 18px;">'
          +'<label style="'+RQ_LBL+'">What was issued? *</label><input id="rqFulWhat" style="'+RQ_IN+'" placeholder="e.g. Verification letter / W-2 copy 2025 / 20 x $25 cards">'
          +'<label style="'+RQ_LBL+'">To whom / where?</label><input id="rqFulTo" style="'+RQ_IN+'" placeholder="e.g. mailed to Acme HR, 100 Main St">'
          +'<label style="'+RQ_LBL+'">Note (optional)</label><input id="rqFulNote" style="'+RQ_IN+'">'
          +'<button onclick="rqFulfillSave('+id+')" style="'+RQ_BTN+'background:#1f7a3d;">Mark fulfilled</button>'
          +'</div></div>'; }
    function rqFulfillSave(id){ var w=(document.getElementById('rqFulWhat')||{}).value||''; var to=(document.getElementById('rqFulTo')||{}).value||''; var note=(document.getElementById('rqFulNote')||{}).value||'';
        if(!w.trim()){ alert('Say what was issued — that’s the record.'); return; }
        rqRpc('rq_fulfill',{p_id:id,p_issued_what:w.trim(),p_issued_to:to.trim(),p_note:note},function(){ rqM2Close(); rqLoadQueue(function(){ rqRender(); }); }); }
