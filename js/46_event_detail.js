    // ============================================================
    // CATERING EVENT DETAIL PAGE  (js/46_event_detail.js)
    // Entry: openEventDetail(id)   Overlay id: edModal
    //
    // One screen per event: the quote/invoice/pay-link (reuses the existing
    // money functions — copyPayLink, copyAcceptLink, editQuote, openSalesPipeline),
    // the run sheet (location + time [NEW, saved], cart from the Asset Register,
    // crew status, loadout checklist), billing (PO# + Tax-exempt [NEW, saved]),
    // contact, and a timeline. New fields persist via app_quote_details_set;
    // reads via app_quote_details_get. Additive, self-contained.
    // ============================================================
    var _ed = { id:null, q:null, cart:null, crew:[], loading:false, saving:false, err:null };
    var _edTypes=null, _edTpl=null, _edAssets=null;
    var ED_DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], ED_MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    function edEsc(s){ return (typeof escapeHtml==='function')?escapeHtml(s==null?'':String(s)):String(s==null?'':s); }
    function edMoney(n){ n=Number(n)||0; return '$'+n.toFixed(2); }
    function edDate(s){ if(!s) return '—'; var p=String(s).slice(0,10).split('-'); if(p.length<3) return String(s); var d=new Date(+p[0],+p[1]-1,+p[2]); return ED_DOW[d.getDay()]+' '+ED_MON[d.getMonth()]+' '+(+p[2])+', '+p[0]; }
    function edDS(s){ if(!s) return ''; try{ var d=new Date(s); return ED_MON[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear(); }catch(e){ return String(s).slice(0,10); } }
    function edVal(id){ var e=document.getElementById(id); return e?e.value:''; }

    function edOv(){ var o=document.getElementById('edModal'); if(!o){ o=document.createElement('div'); o.id='edModal'; o.style.cssText='position:fixed;inset:0;background:#eef1f6;z-index:100060;overflow:auto;'; document.body.appendChild(o);} o.style.display='block'; return o; }
    function edClose(){ var o=document.getElementById('edModal'); if(o)o.style.display='none'; }
    function openEventDetail(id){ if(typeof currentUser==='undefined'||!currentUser) return; _ed.id=id; _ed.q=null; _ed.err=null; edLoad(); }

    function edSafe(p){ return p.then(function(r){return r;}).catch(function(){return {error:true,data:null};}); }
    function edLoad(){
        _ed.loading=true; edRender();
        if(typeof withPin!=='function'||typeof supabaseClient==='undefined'||!currentUser){ _ed.loading=false; _ed.err='Please sign in first.'; edRender(); return; }
        withPin(function(pin){
            var admin={p_admin_username:currentUser.username,p_admin_password:pin};
            var cv={p_username:currentUser.username,p_password:pin};
            Promise.all([
                edSafe(supabaseClient.rpc('app_quote_details_get', Object.assign({p_id:_ed.id}, admin))),
                _edTypes?Promise.resolve(null):edSafe(supabaseClient.rpc('app_cv_event_type_list', cv)),
                _edTpl?Promise.resolve(null):edSafe(supabaseClient.rpc('app_cv_checklist_version_list', cv)),
                _edAssets?Promise.resolve(null):edSafe(supabaseClient.rpc('app_cv_asset_list', cv)),
                edSafe(supabaseClient.rpc('app_cart_list', admin)),
                edSafe(supabaseClient.rpc('app_shift_list', admin))
            ]).then(function(res){
                _ed.loading=false;
                var q=res[0]&&res[0].data; if(q&&q.data) q=q.data; // in case wrapped
                if(!q||typeof q!=='object'||q.id==null){ _ed.err='Could not load this event.'; edRender(); return; }
                _ed.q=q;
                if(res[1]&&res[1].data){ _edTypes=(res[1].data.event_types)||res[1].data||[]; }
                if(res[2]&&res[2].data){ _edTpl=(res[2].data.templates)||res[2].data||[]; }
                if(res[3]&&res[3].data){ _edAssets=(res[3].data.assets)||res[3].data||[]; }
                var carts=(res[4]&&res[4].data)||[]; _ed.cart=null;
                for(var i=0;i<carts.length;i++){ if(String(carts[i].quote_id)===String(_ed.id)){ _ed.cart=carts[i].cart; break; } }
                var sh=(res[5]&&res[5].data)||[]; _ed.crew=sh.filter(function(s){ return String(s.quote_id)===String(_ed.id); });
                edRender();
            }).catch(function(){ _ed.loading=false; _ed.err='Connection error. Please try again.'; edRender(); });
        }, function(){ _ed.loading=false; _ed.err='PIN required.'; edRender(); });
    }

    function edSave(){
        if(_ed.saving||!_ed.q) return; _ed.saving=true; edRender();
        var payload={ event_time:edVal('edTime'), event_location:edVal('edLocation'), event_type:edVal('edType'), po_number:edVal('edPO'), tax_exempt:(document.getElementById('edTaxx')?document.getElementById('edTaxx').checked:false) };
        withPin(function(pin){
            supabaseClient.rpc('app_quote_details_set',{p_admin_username:currentUser.username,p_admin_password:pin,p_id:_ed.id,p_payload:payload}).then(function(r){
                _ed.saving=false;
                if(r.error){ alert(r.error.message||'Could not save.'); edRender(); return; }
                edLoad();
            }).catch(function(){ _ed.saving=false; alert('Connection error.'); edRender(); });
        });
    }
    window.edSave=edSave; window.edClose=edClose; window.openEventDetail=openEventDetail;

    function edTypeLabel(q){
        if(q.event_type_key&&_edTypes){ for(var i=0;i<_edTypes.length;i++){ if(_edTypes[i].key===q.event_type_key) return _edTypes[i].label; } }
        return q.event_type||'';
    }
    function edStage(q){ return (typeof catStageOf==='function')?catStageOf(q):(q.status||''); }
    function edNext(q){
        var st=edStage(q);
        var m={ 'Paid':['Paid ✓','#0f7a3d'], 'Lost':['Closed — declined or expired','#9ca3af'], 'Completed':['Event done — confirm final payment','#14b8a6'], 'Booked':['Invoice sent — awaiting payment','#2563eb'], 'Approved':['Accepted — send the invoice / pay link','#0ea5e9'], 'Quoted':['Quote sent — awaiting the customer','#e67e22'], 'Inquiry':['New inquiry — build the quote','#8b5cf6'] };
        var r=m[st]||['—','#6b7686']; var t=r[0];
        if(!_ed.cart&&(st==='Approved'||st==='Booked')) t+=' · needs a cart';
        return {t:t,c:r[1],st:st};
    }
    function edAssetKind(name){ if(!_edAssets) return null; for(var i=0;i<_edAssets.length;i++){ if(_edAssets[i].name===name) return _edAssets[i].kind; } return null; }
    function edTemplateFor(kind){ if(!_edTpl) return null; var unit=(kind==='trailer')?'trailer':'store'; for(var i=0;i<_edTpl.length;i++){ if(_edTpl[i].operating_unit===unit) return _edTpl[i]; } return _edTpl[0]||null; }

    function edCard(inner){ return '<div style="background:#fff;border:1px solid #e7eaf1;border-radius:15px;padding:16px 17px;margin-bottom:13px;box-shadow:0 3px 12px rgba(0,0,0,.05);">'+inner+'</div>'; }
    function edSec(t){ return '<h2 style="font-size:15px;margin:0 0 10px;">'+t+'</h2>'; }
    function edKV(k,v){ return '<div style="display:flex;gap:9px;font-size:13px;padding:6px 0;border-bottom:1px solid #f4f6f9;"><div style="color:#8a8594;min-width:110px;font-weight:700;">'+k+'</div><div style="color:#26242b;flex:1;">'+v+'</div></div>'; }
    function edInp(id,val,ph){ return '<input id="'+id+'" value="'+edEsc(val||'')+'" placeholder="'+edEsc(ph||'')+'" style="border:1px solid #cfd6e0;border-radius:8px;padding:7px 10px;font-size:13px;width:100%;box-sizing:border-box;">'; }
    function edBtn(label,onclick,bg){ return '<button onclick="'+onclick+'" style="border:none;border-radius:9px;padding:9px 13px;font-size:12.5px;font-weight:800;color:#fff;background:'+bg+';cursor:pointer;">'+label+'</button>'; }

    function edRender(){
        var o=edOv();
        var hdr='<div style="background:linear-gradient(120deg,#EC3E7E,#106AB3);color:#fff;padding:13px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><button onclick="edClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 11px;font-size:13px;font-weight:800;cursor:pointer;">&#8592; Back</button><b style="flex:1;font-size:15px;">Event detail</b></div>';
        if(_ed.loading){ o.innerHTML=hdr+'<p style="text-align:center;padding:44px;color:#6b7686;">Loading event&hellip;</p>'; return; }
        if(_ed.err){ o.innerHTML=hdr+'<p style="text-align:center;padding:44px;color:#c0264b;font-weight:600;">'+edEsc(_ed.err)+'</p>'; return; }
        var q=_ed.q; var nx=edNext(q); var wrap='<div style="max-width:780px;margin:0 auto;padding:14px 14px 48px;">';

        // ZONE 1 — header
        wrap+='<div style="background:linear-gradient(120deg,#EC3E7E,#106AB3);color:#fff;border-radius:16px;padding:16px 18px;margin-bottom:13px;box-shadow:0 8px 22px rgba(0,0,0,.12);">'
            +'<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;">'
            +'<div><div style="font-size:19px;font-weight:800;">'+edEsc(q.contact_name||('#'+q.order_num))+(q.company?' <span style="opacity:.85;font-weight:600;font-size:14px;">· '+edEsc(q.company)+'</span>':'')+'</div>'
            +'<div style="font-size:12.5px;opacity:.95;margin-top:3px;">#'+edEsc(q.order_num)+' · '+edDate(q.event_date)+(q.event_time?(' · '+edEsc(q.event_time)):'')+(edTypeLabel(q)?(' · '+edEsc(edTypeLabel(q))):'')+'</div></div>'
            +'<div style="text-align:right;"><span style="background:'+nx.c+';color:#fff;border-radius:999px;padding:5px 12px;font-size:12px;font-weight:800;">'+edEsc(nx.st)+'</span><div style="font-size:19px;font-weight:900;margin-top:7px;">'+edMoney(q.total)+'</div></div></div>'
            +'<div style="background:rgba(255,255,255,.16);border-radius:11px;padding:9px 12px;margin-top:11px;font-size:13px;font-weight:700;">&#10132; <b>Next:</b> '+edEsc(nx.t)+'</div></div>';

        // ZONE 2 — money
        var items=q.line_items; if(typeof items==='string'){ try{ items=JSON.parse(items); }catch(e){ items=[]; } } items=items||[];
        var money=edSec('&#128181; Quote → Invoice → Payment');
        money+='<table style="width:100%;border-collapse:collapse;font-size:13px;">';
        for(var i=0;i<items.length;i++){ var it=items[i]; var d=it.desc||it.description||it.label||''; var qty=(it.qty!=null?it.qty:(it.quantity!=null?it.quantity:1)); var pr=(it.price!=null?it.price:(it.unit_price!=null?it.unit_price:it.amount)); var sub=(it.subtotal!=null?it.subtotal:(Number(qty)*Number(pr||0)));
            money+='<tr><td style="padding:6px 0;border-bottom:1px solid #f1f3f7;color:#3a4353;">'+edEsc(d)+'</td><td style="padding:6px 0;border-bottom:1px solid #f1f3f7;text-align:right;white-space:nowrap;font-weight:700;">'+edMoney(sub)+'</td></tr>'; }
        money+='</table>';
        money+='<div style="display:flex;justify-content:space-between;font-size:13px;padding:5px 0;color:#6b7686;"><span>Subtotal</span><span>'+edMoney(q.subtotal)+'</span></div>';
        money+='<div style="display:flex;justify-content:space-between;font-size:13px;padding:2px 0;color:#6b7686;"><span>Tax'+(q.tax_exempt?' (exempt)':'')+'</span><span>'+edMoney(q.tax_exempt?0:q.tax)+'</span></div>';
        money+='<div style="display:flex;justify-content:space-between;font-size:16px;font-weight:900;color:#106ab3;border-top:2px solid #eef0f5;margin-top:5px;padding-top:8px;"><span>Total</span><span>'+edMoney(q.total)+'</span></div>';
        // status line
        var statusLine=''; if(q.invoice_status==='Paid'||q.payment_source){ statusLine='<div style="color:#0f7a3d;font-weight:800;font-size:12.5px;margin-top:8px;">&#128179; Paid'+(q.paid_at?(' on '+edDS(q.paid_at)):'')+'</div>'; }
        else if(q.square_payment_url){ statusLine='<div style="color:#185FA5;font-weight:800;font-size:12.5px;margin-top:8px;">&#128279; Pay link ready — awaiting payment</div>'; }
        money+=statusLine;
        // billing NEW fields
        money+='<div style="background:#eef7ff;border:1px dashed #9cc7ec;border-radius:11px;padding:11px 12px;margin-top:12px;">'
            +'<div style="font-weight:800;font-size:12.5px;color:#185FA5;margin-bottom:7px;">Billing details — for schools &amp; government</div>'
            +'<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">'
            +'<label style="font-size:12px;font-weight:700;color:#3a4353;flex:1;min-width:150px;">PO Number'+edInp('edPO',q.po_number,'Add PO # for their records')+'</label>'
            +'<label style="font-size:12.5px;font-weight:700;color:#3a4353;display:flex;align-items:center;gap:7px;margin-top:16px;"><input type="checkbox" id="edTaxx" '+(q.tax_exempt?'checked':'')+'> Tax-exempt</label>'
            +'</div></div>';
        // actions (reuse existing money functions)
        var acts='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:13px;">';
        acts+=edBtn('&#9999;&#65039; Edit quote',"edClose();if(typeof editQuote==='function')editQuote("+q.id+")",'#7b2d8b');
        if(q.square_payment_url) acts+=edBtn('&#128279; Copy Pay Link',"if(typeof copyPayLink==='function')copyPayLink("+q.id+",this)",'#185FA5');
        if(q.accept_token&&q.invoice_status!=='Paid'&&!q.payment_source) acts+=edBtn('&#128279; Copy Accept Link',"if(typeof copyAcceptLink==='function')copyAcceptLink('"+edEsc(q.accept_token)+"',this)",'#106ab3');
        acts+=edBtn('&#128202; Manage in Quotes &amp; Invoices',"edClose();if(typeof openSalesPipeline==='function')openSalesPipeline()",'#26242b');
        acts+='</div>';
        money+=acts;
        wrap+=edCard(money);

        // ZONE 3 — run sheet
        var kind=edAssetKind(_ed.cart); var tpl=_ed.cart?edTemplateFor(kind):null;
        var rs=edSec('&#128666; Event &amp; Run Sheet');
        rs+='<label style="display:block;font-size:12px;font-weight:700;color:#3a4353;margin-bottom:8px;">Location'+edInp('edLocation',q.event_location,'Address / venue')+'</label>';
        rs+='<div style="display:flex;gap:10px;flex-wrap:wrap;">'
            +'<label style="flex:1;min-width:150px;font-size:12px;font-weight:700;color:#3a4353;">Event time'+edInp('edTime',q.event_time,'e.g. 7:00–8:30 PM')+'</label>'
            +'<label style="flex:1;min-width:150px;font-size:12px;font-weight:700;color:#3a4353;">Event type'+edTypeInput(q)+'</label></div>';
        rs+='<div style="margin-top:12px;">'
            +edKV('Cart / trailer', (_ed.cart?('<b>'+edEsc(_ed.cart)+'</b>'+(kind?(' <span style="color:#8a8594;">('+edEsc(kind)+')</span>'):'')):'<span style="color:#c0264b;">Not assigned yet</span>')+' &nbsp; <a href="#" onclick="edClose();if(typeof openCateringCarts===\'function\')openCateringCarts();return false;" style="color:#106ab3;font-weight:700;">'+(_ed.cart?'Change':'Assign')+'</a>')
            +edKV('Crew', edCrewSummary()+' &nbsp; <a href="#" onclick="edClose();if(typeof openCateringCrew===\'function\')openCateringCrew();return false;" style="color:#106ab3;font-weight:700;">Edit</a>');
        if(q.notes){ rs+=edKV('Notes','<span style="white-space:pre-wrap;">'+edEsc(q.notes)+'</span>'); }
        rs+='</div>';
        // loadout checklist (checkable, saved per event)
        rs+='<div id="edChecklist" style="margin-top:12px;">'+edChecklistHtml()+'</div>';
        wrap+=edCard(rs);

        // ZONE 4 — contact
        var ct=edSec('&#128231; Contact');
        ct+=edKV('Contact', edEsc(q.contact_name||'')+(q.company?(' · '+edEsc(q.company)):''));
        if(q.contact_phone) ct+=edKV('Phone','<a href="tel:'+edEsc(q.contact_phone)+'" style="color:#106ab3;">'+edEsc(q.contact_phone)+'</a>');
        if(q.contact_email) ct+=edKV('Email','<a href="mailto:'+edEsc(q.contact_email)+'" style="color:#106ab3;">'+edEsc(q.contact_email)+'</a>');
        wrap+=edCard(ct);

        // ZONE 5 — timeline
        var tl=edSec('&#128340; Timeline');
        tl+='<div style="font-size:12.5px;color:#3a4353;line-height:1.9;">';
        if(q.created_at) tl+='&#9679; Quote #'+edEsc(q.order_num)+' created — '+edDS(q.created_at)+'<br>';
        if(q.invoiced_at) tl+='&#9679; Invoice / pay link sent — '+edDS(q.invoiced_at)+'<br>';
        if(q.accepted_at) tl+='&#9679; Customer accepted — '+edDS(q.accepted_at)+'<br>';
        if(q.reminder_sent) tl+='&#9679; Follow-up reminder sent<br>';
        if(q.invoice_status==='Paid'||q.payment_source) tl+='&#9679; Paid'+(q.paid_at?(' — '+edDS(q.paid_at)):'')+'<br>'; else tl+='&#9675; Awaiting payment<br>';
        tl+='</div>';
        wrap+=edCard(tl);

        // save bar
        wrap+='<div style="position:sticky;bottom:0;background:linear-gradient(0deg,#eef1f6 70%,rgba(238,241,246,0));padding:12px 0 0;text-align:center;">'
            +'<button onclick="edSave()" '+(_ed.saving?'disabled':'')+' style="background:#0f7a3d;color:#fff;border:none;border-radius:11px;padding:12px 26px;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(15,122,61,.3);">'+(_ed.saving?'Saving…':'&#128190; Save event details')+'</button></div>';

        wrap+='</div>';
        o.innerHTML=hdr+wrap;
    }

    function edTypeInput(q){
        var opts=''; if(_edTypes){ for(var i=0;i<_edTypes.length;i++){ var t=_edTypes[i]; if(t.active===false) continue; opts+='<option value="'+edEsc(t.label)+'">'; } }
        return '<input id="edType" list="edTypeList" value="'+edEsc(q.event_type||'')+'" placeholder="Type the event — e.g. Wedding, Car show, School event" style="border:1px solid #cfd6e0;border-radius:8px;padding:7px 10px;font-size:13px;width:100%;box-sizing:border-box;"><datalist id="edTypeList">'+opts+'</datalist>';
    }
    function edCrewSummary(){
        var c=_ed.crew||[]; if(!c.length) return '<span style="color:#8a8594;">No crew yet</span>';
        var appr=true; for(var i=0;i<c.length;i++){ if(c[i].status!=='approved'){ appr=false; break; } }
        return c.length+' '+(c.length===1?'person':'people')+' · '+(appr?'<span style="color:#0f7a3d;font-weight:700;">Approved</span>':'<span style="color:#e67e22;font-weight:700;">Draft — needs approval</span>');
    }
    function edChecklistDone(){ var d=_ed.q&&_ed.q.checklist_done; if(typeof d==='string'){ try{d=JSON.parse(d);}catch(e){d=[];} } return d||[]; }
    function edChecklistHtml(){
        if(!_ed.q||!_ed.cart) return '';
        var tpl=edTemplateFor(edAssetKind(_ed.cart));
        if(!tpl||!tpl.items||!tpl.items.length) return '<div style="font-size:12px;color:#8a8594;">No loadout checklist for this asset yet.</div>';
        _ed.tplItems=tpl.items;
        var done=edChecklistDone(), ct=0;
        for(var d=0;d<tpl.items.length;d++){ if(done.indexOf(tpl.items[d].label)>=0) ct++; }
        var h='<div style="background:#f8fafc;border:1px solid #eef0f5;border-radius:11px;padding:11px 12px;">'
            +'<div style="font-weight:800;font-size:12.5px;color:#26242b;margin-bottom:7px;">&#128203; '+edEsc(tpl.label||'Loadout')+' <span style="color:#8a8594;font-weight:600;">· run sheet · '+ct+'/'+tpl.items.length+' packed</span></div>';
        for(var i=0;i<tpl.items.length;i++){ var it=tpl.items[i], on=done.indexOf(it.label)>=0;
            h+='<label style="display:flex;align-items:center;gap:9px;padding:4px 0;font-size:12.5px;color:'+(on?'#8a8594':'#3a4353')+';cursor:pointer;"><input type="checkbox" onchange="edToggleCheck('+i+',this.checked)" '+(on?'checked':'')+' style="width:16px;height:16px;flex-shrink:0;cursor:pointer;"><span style="'+(on?'text-decoration:line-through;':'')+'">'+edEsc(it.label||'')+(it.is_critical?' <span style="color:#c0264b;font-weight:800;font-size:10px;">CRITICAL</span>':'')+'</span></label>';
        }
        h+='<div style="font-size:11px;color:#8a8594;margin-top:6px;">Tap to check off as you pack — saved automatically.</div></div>';
        return h;
    }
    function edToggleCheck(i, checked){
        if(!_ed.q||!_ed.tplItems||!_ed.tplItems[i]) return;
        var label=_ed.tplItems[i].label, done=edChecklistDone().slice(), idx=done.indexOf(label);
        if(checked&&idx<0) done.push(label);
        if(!checked&&idx>=0) done.splice(idx,1);
        _ed.q.checklist_done=done;
        var el=document.getElementById('edChecklist'); if(el) el.innerHTML=edChecklistHtml();
        withPin(function(pin){ supabaseClient.rpc('app_quote_details_set',{p_admin_username:currentUser.username,p_admin_password:pin,p_id:_ed.id,p_payload:{checklist_done:done}}).then(function(){}).catch(function(){}); });
    }
    window.edToggleCheck=edToggleCheck;
