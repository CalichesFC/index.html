    // ============================================================
    // ON LOAD
    // ============================================================
    function enterAppView() {
        document.getElementById('splash-screen').style.display = 'none';
        loadHubStores(); loadPermMatrix();
        if (currentUser.role === 'Maintenance') {
            document.getElementById('maintenanceBoardView').style.display = 'block';
            switchMaintTab('stores');
            fetchMaintenanceBoard();
            fetchVehicleMaintTracker();
        } else {
            document.getElementById('main-menu').style.display = 'block';
            switchMenuTab('home');
            applyWeeklyQuotes();
            fetchAnnouncement();
            setTimeout(showAppTour, 800);
            setTimeout(maybeShowHowTo, 1300);
        }
        if (window._pendingEquip) { var _eq=window._pendingEquip; var _eqGo=window._pendingEquipGo; window._pendingEquip=null; window._pendingEquipGo=null; try { if(history.replaceState) history.replaceState(null,'',location.pathname); } catch(e){} setTimeout(function(){ if(_eqGo==='report' && typeof woReportForEquipment==='function'){ woReportForEquipment(parseInt(_eq,10)); } else if(typeof openEquipmentDetail==='function'){ openEquipmentDetail(parseInt(_eq,10)); } }, 800); }
        if (window._pendingGo === 'tasks') { window._pendingGo=null; try { if(history.replaceState) history.replaceState(null,'',location.pathname); } catch(e){} setTimeout(function(){ try { if(typeof hubNav==='function') hubNav('tasks'); } catch(e){} }, 700); }
        setTimeout(checkScheduleGate, 450);
        resetTimer();
    }
    function checkScheduleGate(){
        if(!currentUser||!currentUser.username||!sessionPin) return;
        supabaseClient.rpc('app_pending_schedule_confirm',{p_username:currentUser.username,p_password:sessionPin}).then(function(r){
            if(r.error||!r.data||!r.data.needs_confirm) return;
            window._gatePin=sessionPin;
            showScheduleGate(r.data);
        }).catch(function(){});
    }
    function gateTime(t){ if(!t) return ''; var p=String(t).split(':'); var h=+p[0]||0; var m=+p[1]||0; var ap=h<12?'a':'p'; var hh=h%12; if(hh===0) hh=12; return hh+(m?(':'+String(m).padStart(2,'0')):'')+ap; }
    function showScheduleGate(d){
        window._gateWeek=d.week_start;
        var ov=document.getElementById('scheduleGate');
        if(!ov){ ov=document.createElement('div'); ov.id='scheduleGate'; document.body.appendChild(ov); }
        ov.style.cssText='position:fixed;inset:0;background:rgba(18,18,28,.97);z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:18px;overflow:auto;';
        var shifts=d.shifts||[];
        var rows = shifts.length ? shifts.map(function(s){
            var dn=s.shift_date||''; try{ var dt=new Date(s.shift_date+'T00:00:00'); dn=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()]+' '+(dt.getMonth()+1)+'/'+dt.getDate(); }catch(e){}
            return '<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #edf0f5;"><span style="width:74px;flex:none;color:#6b7686;font-size:13px;font-weight:700;">'+escapeHtml(dn)+'</span><span style="flex:1;color:#1f2a44;font-size:13.5px;">'+gateTime(s.start)+'&ndash;'+gateTime(s.end)+' &middot; '+escapeHtml(s.position||'Shift')+' <span style="color:#5b6675;">@ '+escapeHtml(s.location||'')+'</span></span></div>';
        }).join('') : '<div style="color:#5b6675;font-size:13px;">No shifts listed for this week.</div>';
        ov.innerHTML='<div style="background:#fff;border-radius:18px;max-width:460px;width:100%;max-height:90vh;overflow:auto;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.5);">'+
            '<div style="text-align:center;font-size:34px;line-height:1;">&#128197;</div>'+
            '<h2 style="margin:8px 0 4px;text-align:center;color:#1f2a44;font-size:20px;">Confirm your schedule</h2>'+
            '<p style="text-align:center;color:#6b7686;font-size:13.5px;margin:0 0 14px;">Please review your shifts for the week of <b>'+escapeHtml(String(d.week_start||''))+'</b> before you continue.</p>'+
            '<div style="background:#f6f8fb;border:1px solid #e6ebf2;border-radius:12px;padding:8px 14px;margin-bottom:16px;">'+rows+'</div>'+
            '<button id="scheduleGateBtn" onclick="confirmScheduleGate()" style="width:100%;background:#1f7a3d;color:#fff;border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:800;cursor:pointer;">&#9989; I&rsquo;ve seen my schedule &mdash; Confirm</button>'+
            '<button onclick="schedGateFlagConflict()" style="width:100%;background:none;border:1px solid #e6c200;color:#8a6d00;border-radius:10px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;margin-top:10px;">Something is wrong &mdash; tell my manager</button>'+
            '<p style="text-align:center;color:#5b6675;font-size:11.5px;margin:10px 0 0;">Confirm to continue, or tap &ldquo;Something is wrong&rdquo; to flag it for your manager.</p>'+
            '</div>';
        ov.style.display='flex';
    }
    function schedFlagConflict(){
        var ws=(typeof schedFmt==='function' && schedState && schedState.weekStart)?schedFmt(schedState.weekStart):null; if(!ws) return;
        var note=prompt('What is the conflict with this schedule? Your manager will be notified.'); if(note===null) return; note=(note||'').trim();
        withPin(function(pin){
            supabaseClient.rpc('app_week_flag_conflict',{p_username:currentUser.username,p_password:pin,p_week_start:ws,p_note:note}).then(function(r){
                if(r&&r.error){ alert('Could not send: '+r.error.message); return; }
                if(typeof showUndo==='function') showUndo('Sent to your manager.'); else alert('Sent to your manager.');
            }).catch(function(){ alert('Could not send right now.'); });
        });
    }
    function schedGateFlagConflict(){
        var ws=window._gateWeek;
        var note=prompt('What is the conflict with this schedule? Your manager will be notified.'); if(note===null) return; note=(note||'').trim();
        var pin=window._gatePin||sessionPin;
        supabaseClient.rpc('app_week_flag_conflict',{p_username:currentUser.username,p_password:pin,p_week_start:ws,p_note:note}).then(function(){
            var ov=document.getElementById('scheduleGate'); if(ov) ov.style.display='none';
            alert('Thanks - your manager has been notified about the conflict.');
        }).catch(function(){ var ov=document.getElementById('scheduleGate'); if(ov) ov.style.display='none'; });
    }
    function confirmScheduleGate(){
        var ws=window._gateWeek; var btn=document.getElementById('scheduleGateBtn');
        if(btn){ btn.disabled=true; btn.textContent='Saving...'; }
        var pin=window._gatePin||sessionPin;
        if(!pin){ if(btn){ btn.disabled=false; btn.textContent='Try again'; } return; }
        supabaseClient.rpc('app_week_confirm',{p_username:currentUser.username,p_password:pin,p_week_start:ws}).then(function(r){
            if(r.error){ if(btn){ btn.disabled=false; btn.textContent='Try again'; } alert('Could not confirm: '+r.error.message); return; }
            var ov=document.getElementById('scheduleGate'); if(ov) ov.style.display='none';
        }).catch(function(){ if(btn){ btn.disabled=false; btn.textContent='Try again'; } });
    }

    // ============================================================
    // QUOTE ACCEPTANCE (public link, no login required)
    // ============================================================
    function renderQuoteAccept(quote) {
        const c = document.getElementById('quoteAcceptContent');
        if (!quote) {
            c.innerHTML = '<h2 style="color:var(--fail-red);margin-top:0;">Quote Not Found</h2><p style="color:#666;">This link is invalid or has expired. Please contact Caliche\'s Frozen Custard directly for help.</p>';
            return;
        }
        let itemsHtml = (quote.line_items || []).map(li =>
            '<tr><td style="padding:6px 4px;border-bottom:1px solid #eee;">' + escapeHtml(li.desc) + ' &times; ' + li.qty + '</td><td style="padding:6px 4px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">$' + Number(li.subtotal).toFixed(2) + '</td></tr>'
        ).join('');
        let header = '<h2 style="color:var(--caliches-blue);margin-top:0;">Catering Quote #' + escapeHtml(String(quote.order_num)) + '</h2>' +
            '<p style="color:#666;margin:0 0 15px 0;font-size:14px;">For: <strong>' + escapeHtml(quote.contact_name || '') + '</strong>' + (quote.company ? ' (' + escapeHtml(quote.company) + ')' : '') + '<br>Event Date: ' + escapeHtml(quote.event_date || 'TBD') + (quote.event_type ? '<br>Event Type: ' + escapeHtml(quote.event_type) : '') + '</p>' +
            '<table style="width:100%;border-collapse:collapse;margin-bottom:10px;font-size:14px;">' + itemsHtml + '</table>' +
            '<div style="text-align:right;font-size:14px;color:#444;line-height:1.6;"><div>Subtotal: $' + Number(quote.subtotal).toFixed(2) + '</div><div>Tax: $' + Number(quote.tax).toFixed(2) + '</div><div style="font-weight:900;font-size:20px;color:var(--caliches-blue);margin-top:5px;">Total: $' + Number(quote.total).toFixed(2) + '</div></div>';

        if (quote.status === 'Accepted') {
            var _sqNote = (quote.invoice_status === 'Paid')
                ? '&#9989; Paid — thank you!'
                : (quote.square_payment_url ? '<a href="' + quote.square_payment_url + '" target="_blank" style="color:#1f7a3d;font-weight:bold;">Pay online now &#8594;</a>' : '');
            c.innerHTML = header + '<div style="margin-top:20px;padding:15px;background:#eafaf0;border-radius:8px;text-align:center;color:var(--pass-green);font-weight:bold;">&#10003; Quote Accepted' + (quote.accepted_at ? ' on ' + new Date(quote.accepted_at).toLocaleDateString() : '') + '!<br><span style="font-weight:normal;font-size:13px;color:#555;">We\'ll be in touch to finalize the details.</span></div>' +
                '<div id="sqInvNote" style="margin-top:12px;text-align:center;font-size:13px;color:#1f7a3d;font-weight:bold;">' + _sqNote + '</div>' +
                (quote.pdf_url ? '<a href="' + quote.pdf_url + '" target="_blank" style="display:block;text-align:center;margin-top:15px;color:var(--caliches-blue);font-weight:bold;text-decoration:underline;">View Full PDF</a>' : '');
        } else {
            c.innerHTML = header +
                '<button class="save-btn green-btn" style="margin-top:15px;margin-bottom:10px;" onclick="acceptQuote(\'' + quote.accept_token + '\')">&#10003; Accept This Quote</button>' +
                (quote.pdf_url ? '<a href="' + quote.pdf_url + '" target="_blank" style="display:block;text-align:center;color:var(--caliches-blue);font-weight:bold;text-decoration:underline;">View Full PDF</a>' : '');
        }
    }

    function checkQuoteAcceptRoute() {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('accept');
        if (!token) return false;
        document.getElementById('splash-screen').style.display = 'none';
        document.getElementById('quoteAcceptView').style.display = 'flex';
        supabaseClient.rpc('app_quote_get_by_token', { p_token: token }).maybeSingle()
            .then(({ data, error }) => {
                if (error) { console.error('[QuoteAccept] fetch error:', error.message); renderQuoteAccept(null); return; }
                renderQuoteAccept(data);
            }).catch(err => { console.error('[QuoteAccept] unexpected fetch error:', err); renderQuoteAccept(null); });
        return true;
    }

    function acceptQuote(token) {
        const c = document.getElementById('quoteAcceptContent');
        c.style.opacity = '0.6';
        supabaseClient.rpc('app_quote_accept_by_token', { p_token: token }).single()
            .then(({ data, error }) => {
                c.style.opacity = '1';
                if (error) { console.error('[QuoteAccept] update error:', error.message); alert('Something went wrong accepting this quote. Please contact us directly.'); return; }
                renderQuoteAccept(data);
                autoSendSquareInvoice(token);
            }).catch(err => { c.style.opacity = '1'; console.error('[QuoteAccept] unexpected update error:', err); alert('Something went wrong accepting this quote. Please contact us directly.'); });
    }

    // On acceptance, automatically create + email the customer a REAL Square invoice
    // (Hub-native via the square-invoice Edge Function). Idempotent + non-blocking:
    // acceptance already succeeded regardless of this result.
    function autoSendSquareInvoice(token){
        try {
            supabaseClient.functions.invoke('square-invoice', { body: { token: token } })
              .then(function(r){
                  var d = (r && r.data) || {};
                  if (r && r.error) { console.error('[square-invoice] invoke error:', r.error.message || r.error); return; }
                  if (!d.ok) { console.error('[square-invoice] failed:', d.error || 'unknown'); return; }
                  var note = document.getElementById('sqInvNote');
                  if (note && d.public_url) note.innerHTML = '<a href="' + d.public_url + '" target="_blank" style="color:#1f7a3d;font-weight:bold;">Pay online now &#8594;</a>';
              }, function(e){ console.error('[square-invoice] invoke exception:', e); });
        } catch(e){ console.error('[square-invoice] exception:', e); }
    }

    // ============================================================
    // CATERING INVOICE (from an accepted quote) — printable + public link
    // ============================================================
    function _invItems(q){ var items=q.line_items; if(typeof items==='string'){ try{ items=JSON.parse(items); }catch(e){ items=[]; } } return items||[]; }
    function buildInvoiceHtml(q, invNum){
        var rows=_invItems(q).map(function(li){
            var qty=(li.qty!=null?li.qty:(li.quantity!=null?li.quantity:1));
            var desc=li.desc||li.description||'';
            var sub=(li.subtotal!=null?li.subtotal:(Number(li.price!=null?li.price:(li.unit_price||0))*Number(qty)));
            return '<tr><td style="padding:7px 6px;border-bottom:1px solid #eee;">'+escapeHtml(desc)+'</td><td style="padding:7px 6px;border-bottom:1px solid #eee;text-align:center;">'+escapeHtml(String(qty))+'</td><td style="padding:7px 6px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">$'+Number(sub).toFixed(2)+'</td></tr>';
        }).join('');
        var dateStr=q.invoiced_at?new Date(q.invoiced_at).toLocaleDateString():new Date().toLocaleDateString();
        var ev=q.event_date?String(q.event_date).slice(0,10):'TBD';
        invNum=invNum||q.invoice_number||('INV-'+q.order_num);
        return ''+
        '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;color:#222;">'+
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #C9357D;padding-bottom:12px;margin-bottom:16px;gap:12px;flex-wrap:wrap;">'+
            '<div><div style="font-size:23px;font-weight:900;color:#185FA5;">Caliche&#39;s Frozen Custard</div><div style="font-size:12px;color:#6b7686;">Creating Memories Since 1996</div></div>'+
            '<div style="text-align:right;"><div style="font-size:21px;font-weight:900;color:#C9357D;">INVOICE</div><div style="font-size:13px;color:#444;font-weight:bold;">'+escapeHtml(invNum)+'</div><div style="font-size:12px;color:#6b7686;">Date: '+escapeHtml(dateStr)+'</div></div>'+
          '</div>'+
          '<div style="display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:16px;font-size:13px;line-height:1.5;">'+
            '<div><div style="font-weight:800;color:#185FA5;margin-bottom:3px;">Bill To</div>'+escapeHtml(q.contact_name||'')+(q.company?'<br>'+escapeHtml(q.company):'')+(q.contact_phone?'<br>'+escapeHtml(q.contact_phone):'')+(q.contact_email?'<br>'+escapeHtml(q.contact_email):'')+'</div>'+
            '<div style="text-align:right;"><div style="font-weight:800;color:#185FA5;margin-bottom:3px;">Event</div>'+escapeHtml(ev)+(q.event_type?'<br>'+escapeHtml(q.event_type):'')+'</div>'+
          '</div>'+
          '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px;"><thead><tr style="background:#f3f6fa;"><th style="text-align:left;padding:8px 6px;">Description</th><th style="text-align:center;padding:8px 6px;">Qty</th><th style="text-align:right;padding:8px 6px;">Amount</th></tr></thead><tbody>'+rows+'</tbody></table>'+
          '<div style="text-align:right;font-size:14px;line-height:1.7;"><div>Subtotal: $'+Number(q.subtotal||0).toFixed(2)+'</div><div>Tax: $'+Number(q.tax||0).toFixed(2)+'</div><div style="font-weight:900;font-size:20px;color:#185FA5;margin-top:4px;">Amount Due: $'+Number(q.total||0).toFixed(2)+'</div></div>'+
          (q.invoice_status==='Paid'
             ? '<div style="text-align:center;margin-top:18px;"><span style="display:inline-block;background:#eafaf0;color:#1b7a3d;font-weight:900;font-size:16px;padding:12px 26px;border-radius:10px;">&#9989; Paid'+(q.paid_at?(' on '+new Date(q.paid_at).toLocaleDateString()):'')+' — Thank you!</span></div>'
             : (q.square_payment_url?'<div style="text-align:center;margin-top:18px;"><a href="'+escapeHtml(q.square_payment_url)+'" target="_blank" style="display:inline-block;background:#1f7a3d;color:#fff;text-decoration:none;font-weight:900;font-size:16px;padding:13px 28px;border-radius:10px;">💳 Pay Now with Square</a><div style="font-size:11px;color:#6b7686;margin-top:6px;">Secure checkout powered by Square</div></div>':''))+
          (q.notes?'<div style="margin-top:16px;font-size:12px;color:#6b7686;border-top:1px solid #eee;padding-top:8px;"><b>Notes:</b> '+escapeHtml(q.notes)+'</div>':'')+
          '<div style="margin-top:18px;font-size:11px;color:#8a8a99;border-top:1px solid #eee;padding-top:8px;text-align:center;">Thank you for choosing Caliche&#39;s Frozen Custard! Please contact us with any questions about this invoice.</div>'+
        '</div>';
    }
    function printInvoiceHtml(html){
        if(!html){ alert('Nothing to print yet.'); return; }
        var w=window.open('','_blank'); if(!w){ alert('Please allow pop-ups to print or save the invoice as a PDF.'); return; }
        w.document.write('<!doctype html><html><head><title>Caliche&#39;s Invoice</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:22px;">'+html+'</body></html>');
        w.document.close(); w.focus(); setTimeout(function(){ try{ w.print(); }catch(e){} }, 350);
    }
    function publicLinkBase(){ return 'https://calichesfc.github.io/index.html'; }
    function copyInvoiceLink(token, btn){
        var url=publicLinkBase()+'?invoice='+token;
        navigator.clipboard.writeText(url).then(function(){ if(btn){ var o=btn.innerText; btn.innerText='✅ Copied!'; setTimeout(function(){ btn.innerText=o; },2000); } }).catch(function(){ alert('Invoice link:\n'+url); });
    }
    function openInvoicePreview(q, invNum, token){
        var html=buildInvoiceHtml(q, invNum); window._curInvoiceHtml=html;
        var ov=document.getElementById('invoicePreviewOv');
        if(!ov){ ov=document.createElement('div'); ov.id='invoicePreviewOv'; ov.style.cssText='position:fixed;inset:0;background:rgba(20,30,50,.55);z-index:100050;overflow:auto;padding:16px;box-sizing:border-box;'; document.body.appendChild(ov); }
        ov.style.display='block';
        var link=token?(publicLinkBase()+'?invoice='+token):'';
        ov.innerHTML='<div style="max-width:780px;margin:0 auto;background:#fff;border-radius:14px;padding:16px;">'+
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">'+
            '<button onclick="printInvoiceHtml(window._curInvoiceHtml)" style="background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px 16px;font-weight:800;cursor:pointer;">🖨️ Print / Save as PDF</button>'+
            (link?'<button onclick="copyInvoiceLink(\''+token+'\', this)" style="background:#1f7a3d;color:#fff;border:none;border-radius:9px;padding:10px 16px;font-weight:800;cursor:pointer;">🔗 Copy customer link</button>':'')+
            '<button onclick="document.getElementById(\'invoicePreviewOv\').style.display=\'none\'" style="background:#eef0f3;color:#333;border:none;border-radius:9px;padding:10px 16px;font-weight:800;cursor:pointer;margin-left:auto;">Close</button>'+
          '</div>'+
          (link?'<div style="font-size:12px;color:#6b7686;margin-bottom:10px;word-break:break-all;">Send this to the customer: '+escapeHtml(link)+'</div>':'')+
          '<div style="border:1px solid #e3e8ef;border-radius:10px;padding:16px;">'+html+'</div>'+
        '</div>';
    }
    function quoteInvoice(id, btn){
        var list=window._pipelineQuotes||[]; var q=null; for(var i=0;i<list.length;i++){ if(list[i].id===id){ q=list[i]; break; } }
        if(!q){ alert('Quote not found. Refresh the pipeline and try again.'); return; }
        var _o=''; if(btn){ btn.disabled=true; _o=btn.innerHTML; btn.innerHTML='Working…'; }
        withPin(function(pin){
            supabaseClient.rpc('app_quote_create_invoice', { p_admin_username:currentUser.username, p_admin_password:pin, p_id:id })
            .then(function(r){
                if(btn){ btn.disabled=false; btn.innerHTML=_o; }
                if(r.error){ if(r.error.code==='42501') sessionPin=null; alert('Error: '+r.error.message); return; }
                var d=r.data||{}; var invNum=d.invoice_number||('INV-'+q.order_num); var tok=d.accept_token||q.accept_token;
                q.invoice_number=invNum; q.invoice_status='Invoiced'; if(!q.invoiced_at) q.invoiced_at=new Date().toISOString();
                openInvoicePreview(q, invNum, tok);
            }, function(){ if(btn){ btn.disabled=false; btn.innerHTML=_o; } alert('Connection error.'); });
        });
    }
    // Admin: create + email a REAL Square invoice for an accepted quote (Hub-native).
    function sendSquareInvoice(id, btn){
        var list=window._pipelineQuotes||[]; var q=null; for(var i=0;i<list.length;i++){ if(list[i].id===id){ q=list[i]; break; } }
        if(!q){ alert('Quote not found. Refresh the pipeline and try again.'); return; }
        if(!q.accept_token){ alert('This quote needs an accept link first. Open it, Save/Resend, then try again.'); return; }
        var _o=''; if(btn){ btn.disabled=true; _o=btn.innerHTML; btn.innerHTML='Sending…'; }
        supabaseClient.functions.invoke('square-invoice', { body: { token: q.accept_token } })
          .then(function(r){
              if(btn){ btn.disabled=false; btn.innerHTML=_o; }
              var d=(r&&r.data)||{};
              if((r&&r.error) || !d.ok){ alert('Square error: '+((d&&d.error) || (r&&r.error&&r.error.message) || 'unknown')); return; }
              q.square_payment_url=d.public_url; if(q.invoice_status!=='Paid') q.invoice_status='Sent'; if(d.invoice_number) q.invoice_number=d.invoice_number; if(!q.invoiced_at) q.invoiced_at=new Date().toISOString();
              if(typeof toast==='function') toast(d.already?'Pay link already created.':'Pay link created.');
              if(typeof fetchSalesPipeline==='function') fetchSalesPipeline();
          }, function(){ if(btn){ btn.disabled=false; btn.innerHTML=_o; } alert('Connection error contacting Square.'); });
    }
    function copyPayLink(id, btn){
        var list=window._pipelineQuotes||[]; var q=null; for(var i=0;i<list.length;i++){ if(list[i].id===id){ q=list[i]; break; } }
        if(!q||!q.square_payment_url){ alert('No Square pay link yet. Send the Square invoice first.'); return; }
        navigator.clipboard.writeText(q.square_payment_url).then(function(){ if(btn){ var o=btn.innerHTML; btn.innerHTML='✅ Copied!'; setTimeout(function(){ btn.innerHTML=o; },1500);} }).catch(function(){ alert('Pay link:\n'+q.square_payment_url); });
    }
    function renderInvoice(quote){
        var c=document.getElementById('quoteAcceptContent');
        if(!quote){ c.innerHTML='<h2 style="color:var(--fail-red);margin-top:0;">Invoice Not Found</h2><p style="color:#666;">This link is invalid or the invoice is not ready yet. Please contact Caliche&#39;s Frozen Custard directly for help.</p>'; return; }
        window._curInvoiceQuote=quote;
        var html=buildInvoiceHtml(quote, quote.invoice_number); window._curInvoiceHtml=html;
        c.innerHTML='<button class="save-btn blue-btn" style="margin-bottom:14px;" onclick="printInvoiceHtml(window._curInvoiceHtml)">🖨️ Print / Save as PDF</button>'+html;
    }
    function checkInvoiceRoute(){
        var params=new URLSearchParams(window.location.search); var token=params.get('invoice');
        if(!token) return false;
        document.getElementById('splash-screen').style.display='none';
        document.getElementById('quoteAcceptView').style.display='flex';
        supabaseClient.rpc('app_quote_invoice_get_by_token', { p_token: token }).maybeSingle()
            .then(function(r){
                if(r.error){ console.error('[Invoice] fetch error:', r.error.message); renderInvoice(null); return; }
                var quote=r.data; if(!quote){ renderInvoice(null); return; }
                // Merge live payment fields so the Pay button / Paid badge show even if the
                // invoice RPC predates the Square columns.
                supabaseClient.rpc('app_quote_payment_status', { p_token: token }).maybeSingle()
                  .then(function(p){ var d=p&&p.data; if(d){ if(d.square_payment_url&&!quote.square_payment_url) quote.square_payment_url=d.square_payment_url; if(d.invoice_status) quote.invoice_status=d.invoice_status; if(d.paid_at) quote.paid_at=d.paid_at; if(d.invoice_number&&!quote.invoice_number) quote.invoice_number=d.invoice_number; } finishInvoice(quote, token); },
                          function(){ finishInvoice(quote, token); });
            })
            .catch(function(err){ console.error('[Invoice] unexpected error:', err); renderInvoice(null); });
        return true;
    }
    function finishInvoice(quote, token){ renderInvoice(quote); if(quote && quote.invoice_status!=='Paid') startInvoicePoll(token); }
    // Live-flip the public invoice page to "Paid" once Square's webhook marks it paid.
    function startInvoicePoll(token){
        if(window._invPoll) clearInterval(window._invPoll);
        window._invPoll=setInterval(function(){
            supabaseClient.rpc('app_quote_payment_status', { p_token: token }).maybeSingle()
              .then(function(r){ var d=r&&r.data; if(!d) return;
                  if(d.invoice_status==='Paid' && window._curInvoiceQuote){
                      clearInterval(window._invPoll); window._invPoll=null;
                      window._curInvoiceQuote.invoice_status='Paid'; window._curInvoiceQuote.paid_at=d.paid_at;
                      renderInvoice(window._curInvoiceQuote);
                  }
              }, function(){});
        }, 20000);
    }
    window.addEventListener('load', function() {
        if (frOrgRoute()) return;
        if (checkQuoteAcceptRoute()) return;
        if (checkInvoiceRoute()) return;
        try { var _qsp=new URLSearchParams(window.location.search); window._pendingEquip = _qsp.get('equip'); window._pendingEquipGo = _qsp.get('go'); window._pendingGo = (!_qsp.get('equip') && _qsp.get('go')==='tasks') ? 'tasks' : null; } catch(e) {}
        addQuoteRow(); addQuoteRow(); addQuoteRow();
        populateQuoteTemplates();
        let savedUser = localStorage.getItem('calichesUser');
        if (savedUser) {
            currentUser = JSON.parse(savedUser);
            try { localStorage.removeItem('calichesPin'); if (localStorage.getItem('calichesKeep')!=='0') { var _kp=sessionStorage.getItem('calichesPin'); if(_kp) sessionPin=_kp; } } catch(e){}
            document.getElementById('greetingName').innerText = 'Hello, ' + currentUser.name;
            document.getElementById('greetingRole').innerText = 'Role: ' + currentUser.role;
            /* SECURITY (login hardening): never enter the app on a saved profile
               alone. Re-verify the stored credential against the server first. If
               "Keep me logged in" was off there is no stored credential, so send
               the user to the password screen. Biometric unlock is preserved: it
               is only reached AFTER the server verifies the stored credential. */
            if (sessionPin) { verifyStoredSessionThenEnter(); }
            else { showLoginScreenNow(); }
        } else {
            setTimeout(function() {
                document.getElementById('splash-screen').style.opacity = '0';
                setTimeout(() => { document.getElementById('splash-screen').style.display = 'none'; document.getElementById('login-view').style.display = 'flex'; }, 500);
            }, 3500);
        }
        let today = new Date().toISOString().split('T')[0];
        ['dt','driverDt','shortageDt','maintDt','damageDt'].forEach(id => { let el = document.getElementById(id); if(el) el.value = today; });

        // PWA install prompt
        window.addEventListener('beforeinstallprompt', function(e) {
            e.preventDefault();
            deferredInstallPrompt = e;
            document.getElementById('installBtn').style.display = 'block';
        });
        window.addEventListener('appinstalled', function() {
            document.getElementById('installBtn').style.display = 'none';
            deferredInstallPrompt = null;
        });

        // Service Worker + auto-update (safe reload)
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
                .then(reg => {
                    // Check for a new version now, and whenever the app regains focus.
                    reg.update().catch(() => {});
                    document.addEventListener('visibilitychange', () => {
                        if (document.visibilityState === 'visible') reg.update().catch(() => {});
                    });
                    window.addEventListener('focus', () => reg.update().catch(() => {}));
                    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
                })
                .catch(err => console.log('SW error:', err));

            // When a new service worker takes control, reload to the new version —
            // but only when it's safe (not while someone is filling out a form).
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (swRefreshing) return;
                if (isSafeToReload()) { swRefreshing = true; location.reload(); }
                else { swReloadPending = true; }
            });
        }
    });

    // If the app is restored from the back-forward cache (e.g. reopened from
    // the phone's app switcher after being closed), force a full reload so it
    // always restarts from the main menu / login screen instead of whatever
    // screen it was left on.
    window.addEventListener('pageshow', function(e) {
        if (e.persisted) { location.reload(); }
    });

    // ============================================================
    // PROGRESS BAR
    // ============================================================
    function updateProgressBar() {
        let answered = 0;
        for (let i = 1; i <= totalQuestions; i++) {
            if (document.querySelector('input[name="q' + i + '"]:checked')) answered++;
        }
        let pct = totalQuestions > 0 ? Math.round((answered / totalQuestions) * 100) : 0;
        document.getElementById('progressText').innerText = answered + ' / ' + totalQuestions + ' answered';
        document.getElementById('progressPct').innerText = pct + '%';
        let fill = document.getElementById('progressFill');
        fill.style.width = pct + '%';
        fill.style.background = pct === 100 ? 'var(--pass-green)' : pct >= 50 ? 'var(--caliches-blue)' : 'var(--caliches-pink)';
    }

    // ============================================================
    // AUTO-SAVE DRAFTS
    // ============================================================
    function scheduleDraftSave() {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(saveDraft, 3000);
    }

    function saveDraft() {
        if (!document.getElementById('popInView') || document.getElementById('popInView').style.display === 'none') return;
        let draft = {
            savedAt: new Date().toISOString(),
            location: document.getElementById('loc').value,
            date: document.getElementById('dt').value,
            shiftTime: document.getElementById('shiftTime').value,
            shiftLeader: document.getElementById('sldr').value,
            conductor: document.getElementById('conductor').value,
            overallComments: document.getElementById('overallComments').value,
            ratings: {}, notes: {}
        };
        for (let i = 1; i <= totalQuestions; i++) {
            let sel = document.querySelector('input[name="q' + i + '"]:checked');
            if (sel) draft.ratings[i] = sel.value;
            let noteEl = document.getElementById('note' + i);
            if (noteEl && noteEl.value) draft.notes[i] = noteEl.value;
        }
        try {
            localStorage.setItem('calichesDraft_popIn', JSON.stringify(draft));
            showDraftToast('Draft saved');
            document.getElementById('hasDraftBadge').style.display = 'inline-block';
        } catch(e) { console.log('Draft save failed:', e); }
    }

    function showDraftToast(msg) {
        let toast = document.getElementById('draftToast');
        toast.innerText = msg || 'Draft saved';
        toast.style.display = 'block';
        clearTimeout(window.draftToastTimer);
        window.draftToastTimer = setTimeout(() => { toast.style.display = 'none'; }, 2200);
    }

    function checkForDraft() {
        let saved = localStorage.getItem('calichesDraft_popIn');
        if (!saved) return;
        try {
            savedDraftData = JSON.parse(saved);
            document.getElementById('hasDraftBadge').style.display = 'inline-block';
            showDraftBanner();
        } catch(e) { localStorage.removeItem('calichesDraft_popIn'); }
    }

    function showDraftBanner() {
        let banner = document.getElementById('draftBanner');
        banner.style.display = 'flex';
        banner.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function restoreSavedDraft() {
        if (!savedDraftData) return;
        let d = savedDraftData;
        document.getElementById('loc').value = d.location || '';
        document.getElementById('dt').value = d.date || '';
        document.getElementById('shiftTime').value = d.shiftTime || 'Day';
        document.getElementById('sldr').value = d.shiftLeader || '';
        document.getElementById('conductor').value = d.conductor || '';
        document.getElementById('overallComments').value = d.overallComments || '';
        for (let i = 1; i <= totalQuestions; i++) {
            if (d.ratings && d.ratings[i]) {
                let radio = document.querySelector('input[name="q' + i + '"][value="' + d.ratings[i] + '"]');
                if (radio) radio.checked = true;
            }
            if (d.notes && d.notes[i]) {
                let noteEl = document.getElementById('note' + i);
                if (noteEl) noteEl.value = d.notes[i];
            }
        }
        document.getElementById('draftBanner').style.display = 'none';
        calc();
        showDraftToast('Draft restored!');
    }

    function discardDraft() {
        localStorage.removeItem('calichesDraft_popIn');
        savedDraftData = null;
        document.getElementById('draftBanner').style.display = 'none';
        document.getElementById('hasDraftBadge').style.display = 'none';
        showDraftToast('Draft discarded');
    }

    // ============================================================
    // PWA INSTALL
    // ============================================================
    function installApp() {
        if (!deferredInstallPrompt) {
            alert('To install on iOS: tap the Share button then "Add to Home Screen".\nOn Android: tap the menu then "Add to Home Screen".');
            return;
        }
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(function(choice) {
            if (choice.outcome === 'accepted') document.getElementById('installBtn').style.display = 'none';
            deferredInstallPrompt = null;
        });
    }

    // ============================================================
    // ACTIVITY LOGGING
    // ============================================================
    function logActivity(username, name, action) {
        supabaseClient.rpc('app_log_activity', { p_username: username, p_name: name, p_action: action })
        .then(({ error }) => { if(error) console.log('[Activity] Log error:', error.message); });
    }

    function fetchActivityLog(btnElement) {
        currentDashTab = 'Activity';
        document.querySelectorAll('.dash-tab').forEach(b => b.classList.remove('active'));
        btnElement.classList.add('active');
        document.getElementById('dashboardFilterDiv').style.display = 'none';
        const results = document.getElementById('dashboardResults');
        results.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">Loading activity log...</p>';
        withPin(function(pin) {
            supabaseClient.rpc('app_admin_activity_log', { p_admin_username: currentUser.username, p_admin_password: pin })
            .then(({ data, error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if (error) { results.innerHTML = '<p style="color:red;padding:20px;">Error (' + error.code + '): ' + error.message + '</p>'; return; }
                if (!data || data.length === 0) { results.innerHTML = '<p style="padding:20px;">No activity recorded yet. Activity is logged on each login.</p>'; return; }
                _activityLogData = data;
                let html = '<div style="text-align:right;margin:0 0 8px;"><button onclick="exportActivityCSV()" style="background:var(--pass-green);color:#fff;border:none;padding:8px 14px;border-radius:8px;font-weight:bold;font-size:13px;cursor:pointer;">&#11015; Export to CSV</button></div><div class="table-wrapper"><table class="data-table"><thead><tr><th>Name</th><th>Username</th><th>Action</th><th>Time</th></tr></thead><tbody>';
                data.forEach(row => {
                    let time = row.created_at ? new Date(row.created_at).toLocaleString() : '';
                    let col = row.action === 'login' ? 'var(--pass-green)' : 'var(--caliches-blue)';
                    html += '<tr><td style="font-weight:500;">' + (row.name||'') + '</td><td style="color:var(--na-gray);">' + (row.username||'') + '</td><td><span style="background:' + col + '22;color:' + col + ';padding:3px 10px;border-radius:4px;font-size:12px;font-weight:bold;">' + (row.action||'') + '</span></td><td style="color:var(--na-gray);font-size:12px;">' + time + '</td></tr>';
                });
                html += '</tbody></table></div>';
                results.innerHTML = html;
            }).catch(err => { results.innerHTML = '<p style="color:red;padding:20px;">Connection Error: ' + err.message + '</p>'; });
        }, function() { results.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">PIN required to load activity log.</p>'; });
    }

    // ============================================================
    // FORGOT PIN
    // ============================================================
    function openForgotPin() {
        document.getElementById('forgotPinModal').style.display = 'flex';
        document.getElementById('forgotUsername').value = '';
        document.getElementById('forgotEmail').value = '';
        document.getElementById('forgotPinError').style.display = 'none';
        document.getElementById('forgotPinBtn').innerText = 'Send My PIN';
        document.getElementById('forgotPinBtn').disabled = false;
    }

    function closeForgotPin() {
        document.getElementById('forgotPinModal').style.display = 'none';
    }

    function submitForgotPin() {
        let username = document.getElementById('forgotUsername').value.trim();
        let email = document.getElementById('forgotEmail').value.trim();
        let errorEl = document.getElementById('forgotPinError');
        let btn = document.getElementById('forgotPinBtn');
        if (!username || !email) { errorEl.innerText = 'Please fill in both fields.'; errorEl.style.display = 'block'; return; }
        btn.innerText = 'Sending...'; btn.disabled = true; errorEl.style.display = 'none';
        supabaseClient.rpc('app_forgot_pin', { p_username: username, p_email: email })
        .then(({ data, error }) => {
            if (error) { errorEl.innerText = 'Error: ' + error.message; errorEl.style.display = 'block'; btn.innerText = 'Send My PIN'; btn.disabled = false; return; }
            if (!data || data.length === 0) { errorEl.innerText = 'No account found with that username and email. Contact your manager.'; errorEl.style.display = 'block'; btn.innerText = 'Send My PIN'; btn.disabled = false; return; }
            let user = data[0];
            let fd = new FormData();
            fd.append('forgotPassword', 'true');
            fd.append('name', user.name);
            fd.append('email', email);
            fd.append('pin', user.pin);
            fetch(G_URL, { method: 'POST', body: fd })
            .then(res => res.json())
            .then(() => {
                closeForgotPin();
                alert('PIN sent to ' + email + '. Check your inbox (and spam folder).');
            })
            .catch(() => { errorEl.innerText = 'Could not send email. Contact your manager.'; errorEl.style.display = 'block'; btn.innerText = 'Send My PIN'; btn.disabled = false; });
        });
    }

    // ============================================================
    // AUTH
    // ============================================================
    function toggleRegister() {
        let lf = document.getElementById('loginForm'); let rf = document.getElementById('registerForm');
        document.getElementById('loginError').style.display = 'none'; document.getElementById('registerError').style.display = 'none';
        if (lf.style.display === 'none') { lf.style.display = 'block'; rf.style.display = 'none'; }
        else { lf.style.display = 'none'; rf.style.display = 'block'; }
    }

    function refreshSessionUser(){
        try{
            if(!currentUser||!currentUser.username||!sessionPin) return;
            supabaseClient.rpc('app_login',{p_username:currentUser.username,p_password:sessionPin}).then(function(r){
                var data=r&&r.data; if(!data||!data.length) return;
                var u=data[0];
                var changed=(currentUser.role!==u.role)||(currentUser.is_developer!==(u.is_developer===true));
                currentUser.name=u.name; currentUser.role=u.role; currentUser.permissions=u.permissions||null; currentUser.maint_board_access=(u.maint_board_access!==false); currentUser.username=u.username; currentUser.email=u.email||''; currentUser.is_developer=(u.is_developer===true);
                try{ localStorage.setItem('calichesUser', JSON.stringify(currentUser)); }catch(e){}
                try{ var gr=document.getElementById('greetingRole'); if(gr) gr.innerText='Role: '+currentUser.role; }catch(e){}
                if(changed){ try{ applyRoleUI(); }catch(e){} try{ if(typeof applyFormPermissions==='function') applyFormPermissions(); }catch(e){} }
            }).catch(function(){});
        }catch(e){}
    }
    // Login hardening helpers ------------------------------------------------
    // Show the password screen (fail-closed) and drop any stored credential.
    function showLoginScreenNow(){
        try{ sessionStorage.removeItem('calichesPin'); }catch(e){}
        sessionPin = null;
        var sp = document.getElementById('splash-screen');
        var lv = document.getElementById('login-view');
        try{ document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; }); }catch(e){}
        var bio = document.getElementById('biometricLockModal'); if(bio) bio.style.display='none';
        if(sp){ sp.style.opacity='0'; setTimeout(function(){ sp.style.display='none'; if(lv) lv.style.display='flex'; }, 400); }
        else if(lv){ lv.style.display='flex'; }
    }
    // Verify a restored "keep me logged in" credential against the server before
    // entering the app. No verified row => back to the password screen.
    function verifyStoredSessionThenEnter(){
        try{
            supabaseClient.rpc('app_login',{p_username:currentUser.username,p_password:sessionPin}).then(function(r){
                if((r && r.error) || !r || !r.data || !r.data.length){ showLoginScreenNow(); return; }
                var u = r.data[0];
                currentUser.name=u.name; currentUser.role=u.role; currentUser.permissions=u.permissions||null; currentUser.maint_board_access=(u.maint_board_access!==false); currentUser.username=u.username; currentUser.email=u.email||''; currentUser.is_developer=(u.is_developer===true);
                try{ localStorage.setItem('calichesUser', JSON.stringify(currentUser)); }catch(e){}
                try{ document.getElementById('greetingName').innerText='Hello, '+currentUser.name; document.getElementById('greetingRole').innerText='Role: '+currentUser.role; }catch(e){}
                applyRoleUI(); setupNotifications(); applyFormPermissions();
                var bioId = localStorage.getItem('calichesBiometricId');
                if(bioId && window.PublicKeyCredential){
                    document.getElementById('splash-screen').style.display='none';
                    document.getElementById('bioWelcomeName').innerText=', '+currentUser.name;
                    document.getElementById('biometricLockModal').style.display='flex';
                } else { enterAppView(); }
                if(u.must_set_password===true){ setTimeout(function(){ promptSetPassword(); }, 800); }
            }).catch(function(){ showLoginScreenNow(); });
        }catch(e){ showLoginScreenNow(); }
    }
    function attemptLogin() {
        const btn = document.getElementById('loginBtn'); const form = document.getElementById('loginForm'); const errorMsg = document.getElementById('loginError');
        if (!form.username.value || !form.password.value) { errorMsg.innerText = 'Please enter both fields.'; errorMsg.style.display = 'block'; return; }
        btn.innerText = 'Verifying...'; btn.disabled = true; errorMsg.style.display = 'none';
        const enteredUsername = form.username.value.trim(); const enteredPassword = form.password.value.trim();
        supabaseClient.rpc('app_login', { p_username: enteredUsername, p_password: enteredPassword })
        .then(({ data, error }) => {
            console.log('[Login] Supabase:', { data, error });
            if (error) { errorMsg.innerText = 'Login error (' + error.code + '): ' + error.message; errorMsg.style.display = 'block'; btn.innerText = 'ENTER HUB'; btn.disabled = false; return; }
            if (!data || data.length === 0) { errorMsg.innerText = 'Invalid Username or PIN. Please try again.'; errorMsg.style.display = 'block'; btn.innerText = 'ENTER HUB'; btn.disabled = false; return; }
            const user = data[0];
            sessionPin = enteredPassword;
            currentUser.name = user.name; currentUser.role = user.role; currentUser.permissions = user.permissions || null; currentUser.maint_board_access = (user.maint_board_access !== false);
            currentUser.username = user.username; currentUser.email = user.email || ''; currentUser.is_developer = (user.is_developer === true);
            localStorage.setItem('calichesUser', JSON.stringify(currentUser));
            try { var _keep = !document.getElementById('keepLoggedIn') || document.getElementById('keepLoggedIn').checked; if(_keep){ localStorage.setItem('calichesKeep','1'); sessionStorage.setItem('calichesPin', sessionPin); } else { localStorage.setItem('calichesKeep','0'); sessionStorage.removeItem('calichesPin'); } try{ localStorage.removeItem('calichesPin'); }catch(e){} } catch(e){}
            logActivity(user.username, user.name, 'login');
            document.getElementById('greetingName').innerText = 'Hello, ' + user.name;
            document.getElementById('greetingRole').innerText = 'Role: ' + user.role;
            applyRoleUI();
            setupNotifications();
            applyFormPermissions();
            triggerTransition(() => {
                document.getElementById('login-view').style.display = 'none';
                if (user.role === 'Maintenance') {
                    document.getElementById('maintenanceBoardView').style.display = 'block';
                    switchMaintTab('stores');
                    fetchMaintenanceBoard();
                    fetchVehicleMaintTracker();
                } else {
                    document.getElementById('main-menu').style.display = 'block';
                    setTimeout(showAppTour, 600);
                }
                resetTimer();
            });
            if (user.must_set_password === true) { setTimeout(function(){ promptSetPassword(); }, 800); }
            btn.innerText = 'ENTER HUB'; btn.disabled = false; form.reset();
        }).catch(err => { errorMsg.innerText = 'Connection error. Check your internet.'; errorMsg.style.display = 'block'; btn.innerText = 'ENTER HUB'; btn.disabled = false; });
    }

    function promptSetPassword(){
        var ov=document.getElementById('setPwModal');
        if(!ov){ ov=document.createElement('div'); ov.id='setPwModal'; ov.style.cssText='position:fixed;inset:0;background:rgba(20,20,30,.6);z-index:100050;display:flex;align-items:center;justify-content:center;padding:18px;'; document.body.appendChild(ov); }
        ov.innerHTML='<div style="background:#fff;border-radius:16px;max-width:420px;width:100%;padding:22px;box-shadow:0 10px 40px rgba(0,0,0,.3);"><div style="font-size:19px;font-weight:800;color:#1f2a44;margin-bottom:4px;">Set a secure password</div><div style="font-size:13px;color:#6b7686;margin-bottom:14px;">We are upgrading logins from short PINs to passwords to better protect employee and customer information. Please choose a password (at least 8 characters).</div><input id="setPw1" type="password" placeholder="New password" style="width:100%;padding:12px;border:2px solid #eee;border-radius:8px;font-size:15px;box-sizing:border-box;margin-bottom:8px;"><input id="setPw2" type="password" placeholder="Confirm new password" style="width:100%;padding:12px;border:2px solid #eee;border-radius:8px;font-size:15px;box-sizing:border-box;margin-bottom:8px;"><div id="setPwMsg" style="font-size:12.5px;color:#c0264b;min-height:16px;margin-bottom:8px;"></div><button onclick="submitSetPassword()" style="width:100%;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:13px;font-size:15px;font-weight:800;cursor:pointer;">Save password</button><button onclick="var m=document.getElementById(\'setPwModal\'); if(m) m.style.display=\'none\';" style="width:100%;background:none;border:none;color:#6b6275;font-size:13px;cursor:pointer;margin-top:8px;">Remind me later</button></div>';
        ov.style.display='flex';
    }
    function submitSetPassword(){
        var p1=(document.getElementById('setPw1')||{}).value||''; var p2=(document.getElementById('setPw2')||{}).value||''; var msg=document.getElementById('setPwMsg');
        if(p1.length<8){ if(msg){ msg.style.color='#c0264b'; msg.textContent='Password must be at least 8 characters.'; } return; }
        if(p1!==p2){ if(msg){ msg.style.color='#c0264b'; msg.textContent='Passwords do not match.'; } return; }
        if(msg){ msg.style.color='#6b7686'; msg.textContent='Saving...'; }
        supabaseClient.rpc('app_set_password',{p_username:currentUser.username,p_current:sessionPin,p_new:p1}).then(function(r){
            if(r.error){ if(msg){ msg.style.color='#c0264b'; msg.textContent=(r.error.message||'Could not save.'); } return; }
            sessionPin=p1; try{ if(localStorage.getItem('calichesKeep')!=='0') sessionStorage.setItem('calichesPin', sessionPin); }catch(e){}
            var ov=document.getElementById('setPwModal'); if(ov) ov.style.display='none';
            try{ alert('Password set. Use it the next time you log in.'); }catch(e){}
        }).catch(function(){ if(msg){ msg.style.color='#c0264b'; msg.textContent='Connection error.'; } });
    }
    function attemptRegister() {
        const btn = document.getElementById('registerBtn'); const form = document.getElementById('registerForm'); const errorMsg = document.getElementById('registerError');
        if (!form.name.value || !form.username.value || !form.email.value || !form.password.value) { errorMsg.innerText = 'Please fill all fields.'; errorMsg.style.display = 'block'; return; }
        btn.innerText = 'Creating Account...'; btn.disabled = true; errorMsg.style.display = 'none';
        const newPassword = form.password.value.trim();
        supabaseClient.rpc('app_register', { p_name: form.name.value.trim(), p_username: form.username.value.trim(), p_email: form.email.value.trim(), p_password: newPassword })
        .then(({ data, error }) => {
            console.log('[Register] Supabase:', { data, error });
            if (error) { errorMsg.innerText = error.code === '23505' ? 'That username is already taken.' : 'Error (' + error.code + '): ' + error.message; errorMsg.style.display = 'block'; btn.innerText = 'CREATE ACCOUNT'; btn.disabled = false; return; }
            if (!data || data.length === 0) { errorMsg.innerText = 'Registration failed. Check Supabase grants.'; errorMsg.style.display = 'block'; btn.innerText = 'CREATE ACCOUNT'; btn.disabled = false; return; }
            const user = data[0];
            sessionPin = newPassword;
            try { localStorage.setItem('calichesKeep','1'); sessionStorage.setItem('calichesPin', sessionPin); } catch(e){}
            currentUser.name = user.name; currentUser.role = user.role;
            currentUser.username = user.username; currentUser.email = user.email || ''; currentUser.is_developer = (user.is_developer === true);
            localStorage.setItem('calichesUser', JSON.stringify(currentUser));
            document.getElementById('greetingName').innerText = 'Hello, ' + user.name;
            document.getElementById('greetingRole').innerText = 'Role: ' + user.role;
            document.getElementById('managerBtn').style.display = 'none';
            triggerTransition(() => { document.getElementById('login-view').style.display = 'none'; document.getElementById('main-menu').style.display = 'block'; resetTimer(); });
            btn.innerText = 'CREATE ACCOUNT'; btn.disabled = false; form.reset();
        }).catch(err => { errorMsg.innerText = 'Connection error.'; errorMsg.style.display = 'block'; btn.innerText = 'CREATE ACCOUNT'; btn.disabled = false; });
    }

    function logout() {
        triggerTransition(() => {
            document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
            document.getElementById('login-view').style.display = 'flex';
            localStorage.removeItem('calichesUser'); localStorage.removeItem('calichesKeep'); localStorage.removeItem('calichesPin'); sessionStorage.removeItem('calichesPin'); currentUser = { name:'', role:'' }; sessionPin = null; clearInterval(slideTimer);
            const aiWidget = document.getElementById('aiChatWidget');
            if (aiWidget) { aiWidget.style.display = 'none'; }
            aiChatHistory = []; aiChatOpen = false;
            const panel = document.getElementById('aiChatPanel');
            if (panel) panel.style.display = 'none';
            applyPendingReloadIfSafe();
        });
    }

    // ============================================================
    // REFRESH APP
    // ============================================================
    function refreshApp() {
        var tasks = [];
        if ('caches' in window) {
            tasks.push(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
        }
        if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
            tasks.push(navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))));
        }
        var done = function(){
            // Cache-busting navigation so the browser HTTP cache can't serve a stale shell.
            try { location.replace(location.pathname + '?v=' + Date.now()); }
            catch (e) { location.reload(); }
        };
        Promise.all(tasks).then(done).catch(done);
    }

    // ============================================================
    // WEB PUSH NOTIFICATIONS
    // ============================================================
    var VAPID_PUBLIC_KEY = 'BHwILHEGPVpgUlnzwNUaOYtu78s210ErmPBEOZ7w2eNf_PBD8ouIsEsk4D1p82KZg8qY7jdiAZVNFaJQHaIIfJk';
    function urlBase64ToUint8Array(base64String) {
        var padding = '='.repeat((4 - base64String.length % 4) % 4);
        var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        var raw = atob(base64); var arr = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        return arr;
    }
    function pushSupported() { return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window); }
    function isStandalonePWA() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (window.navigator.standalone === true); }
    function isIOSdevice() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
    function pushSetMsg(t, color) { var el = document.getElementById('pushMsg'); if (el) { el.innerText = t || ''; el.style.color = color || '#8a8594'; } }
    function updatePushToggleBtn() {
        var btn = document.getElementById('pushToggleBtn'); var badge = document.getElementById('pushStatusBadge'); var iosHint = document.getElementById('pushIosHint');
        if (!btn) return;
        if (!pushSupported()) {
            btn.style.display = 'none';
            if (badge) { badge.innerText = 'Unsupported'; badge.className = 'settings-status off'; }
            if (iosHint && isIOSdevice() && !isStandalonePWA()) iosHint.style.display = 'block';
            return;
        }
        btn.style.display = 'block';
        if (iosHint) iosHint.style.display = (isIOSdevice() && !isStandalonePWA()) ? 'block' : 'none';
        navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
            var on = !!sub && Notification.permission === 'granted';
            btn.innerText = on ? 'Disable Push Notifications' : 'Enable Push Notifications';
            if (badge) { badge.innerText = on ? 'On' : 'Off'; badge.className = 'settings-status ' + (on ? 'on' : 'off'); }
        }).catch(function () {});
    }
    function togglePush() {
        navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
            if (sub && Notification.permission === 'granted') { return pushDisable(); }
            return pushEnable();
        }).catch(function () { pushEnable(); });
    }
    function pushEnable() {
        if (!pushSupported()) { pushSetMsg('This browser does not support push notifications.', '#c0264b'); return; }
        if (isIOSdevice() && !isStandalonePWA()) {
            pushSetMsg('On iPhone/iPad, add the Hub to your Home Screen first, then enable alerts.', '#c0264b');
            var h = document.getElementById('pushIosHint'); if (h) h.style.display = 'block'; return;
        }
        pushSetMsg('Enabling…');
        Notification.requestPermission().then(function (perm) {
            if (perm !== 'granted') { pushSetMsg('Notifications were not allowed. You can turn them on in your browser settings.', '#c0264b'); updatePushToggleBtn(); return; }
            navigator.serviceWorker.ready.then(function (reg) {
                return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
            }).then(function (sub) {
                var j = sub.toJSON();
                withPin(function (pin) {
                    supabaseClient.rpc('app_push_subscribe', { p_username: currentUser.username, p_password: pin, p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent }).then(function (r) {
                        if (r.error) { pushSetMsg('Saved on device, but server error: ' + r.error.message, '#c0264b'); }
                        else { pushSetMsg('✓ Push notifications are on for this device.', '#1c7c3a'); }
                        updatePushToggleBtn();
                    }).catch(function () { pushSetMsg('Could not reach the server.', '#c0264b'); });
                });
            }).catch(function (e) { pushSetMsg('Could not subscribe: ' + (e && e.message ? e.message : e), '#c0264b'); });
        });
    }
    function pushDisable() {
        navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
            if (!sub) { updatePushToggleBtn(); return; }
            var ep = sub.endpoint;
            sub.unsubscribe().then(function () {
                supabaseClient.rpc('app_push_unsubscribe', { p_endpoint: ep }).catch(function () {});
                pushSetMsg('Push notifications turned off for this device.'); updatePushToggleBtn();
            });
        }).catch(function () {});
    }
    function pushEnableSilent() {
        navigator.serviceWorker.ready.then(function (reg) {
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
        }).then(function (sub) {
            var j = sub.toJSON();
            if (!sessionPin) return;
            supabaseClient.rpc('app_push_subscribe', { p_username: currentUser.username, p_password: sessionPin, p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent }).catch(function () {});
        }).catch(function () {});
    }
    var _pushChecked = false;
    function maybePromptPush() {
        if (_pushChecked || !pushSupported() || !currentUser || !currentUser.username) return;
        _pushChecked = true;
        if (Notification.permission === 'granted') {
            navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) { if (!sub) pushEnableSilent(); }).catch(function () {});
            return;
        }
        if (Notification.permission === 'denied') return;
        if (localStorage.getItem('pushPromptDismissed') === '1') return;
        if (isIOSdevice() && !isStandalonePWA()) return;
        var bar = document.getElementById('pushPromptBar'); if (bar) bar.style.display = 'flex';
    }
    function pushPromptYes() { var b = document.getElementById('pushPromptBar'); if (b) b.style.display = 'none'; pushEnable(); }
    function pushPromptNo() { var b = document.getElementById('pushPromptBar'); if (b) b.style.display = 'none'; localStorage.setItem('pushPromptDismissed', '1'); }

    // ============================================================
    // BIOMETRIC (FACE ID / TOUCH ID / FINGERPRINT) APP LOCK
    // ============================================================
    function bufferToBase64(buf) {
        return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
    }
    function base64ToBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }
    function updateBioToggleBtn() {
        const btn = document.getElementById('bioToggleBtn');
        const badge = document.getElementById('bioStatusBadge');
        if (!btn) return;
        if (!window.PublicKeyCredential) {
            btn.style.display = 'none';
            if (badge) { badge.innerText = 'Unsupported'; badge.className = 'settings-status off'; }
            return;
        }
        const enabled = !!localStorage.getItem('calichesBiometricId');
        btn.style.display = 'block';
        btn.innerText = enabled ? 'Disable Biometric Unlock' : 'Enable Biometric Unlock';
        if (badge) { badge.innerText = enabled ? 'On' : 'Off'; badge.className = 'settings-status ' + (enabled ? 'on' : 'off'); }
    }
    function toggleBiometric() {
        let bioId = localStorage.getItem('calichesBiometricId');
        if (bioId) {
            if (confirm('Turn off Face ID / Touch ID unlock for this device?')) {
                localStorage.removeItem('calichesBiometricId');
                updateBioToggleBtn();
                alert('Biometric unlock has been turned off.');
            }
            return;
        }
        if (!window.PublicKeyCredential) { alert('This device or browser does not support Face ID / Touch ID / fingerprint unlock.'); return; }
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(available => {
            if (!available) { alert('No Face ID / Touch ID / fingerprint sensor was found on this device.'); return; }
            const challenge = new Uint8Array(32); crypto.getRandomValues(challenge);
            const userId = new Uint8Array(16); crypto.getRandomValues(userId);
            navigator.credentials.create({
                publicKey: {
                    challenge: challenge,
                    rp: { name: "Caliche's Operations Hub" },
                    user: { id: userId, name: currentUser.name || 'user', displayName: currentUser.name || 'User' },
                    pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
                    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
                    timeout: 60000
                }
            }).then(cred => {
                localStorage.setItem('calichesBiometricId', bufferToBase64(cred.rawId));
                updateBioToggleBtn();
                alert('Face ID / Touch ID unlock is now enabled on this device!');
            }).catch(err => { alert('Could not set up biometric unlock: ' + err.message); });
        });
    }
    function biometricUnlock() {
        let bioId = localStorage.getItem('calichesBiometricId');
        const errEl = document.getElementById('bioLockError');
        errEl.style.display = 'none';
        if (!bioId || !window.PublicKeyCredential) { biometricFallbackLogout(); return; }
        const challenge = new Uint8Array(32); crypto.getRandomValues(challenge);
        navigator.credentials.get({
            publicKey: {
                challenge: challenge,
                allowCredentials: [{ id: base64ToBuffer(bioId), type: 'public-key' }],
                userVerification: 'required',
                timeout: 60000
            }
        }).then(() => {
            document.getElementById('biometricLockModal').style.display = 'none';
            enterAppView();
        }).catch(err => {
            errEl.innerText = 'Unlock failed: ' + err.message;
            errEl.style.display = 'block';
        });
    }
    function biometricFallbackLogout() {
        document.getElementById('biometricLockModal').style.display = 'none';
        logout();
    }
