// ============================================================
// R-11: UNAMBIGUOUS PAYMENT STATE  (js/42_r11_payment_state.js)
// Self-contained, append-only module (pattern of js/39): edits NO other file.
// Requires migrations/0007_r11_payment_source.sql.
//
// WHAT THIS FIXES
//   quotes.invoice_status='Paid' used to look identical whether a manager
//   clicked "Mark Paid" or Square's HMAC-verified webhook confirmed a real
//   payment (the old Mark Paid prompt even DEFAULTED payment_method to
//   'Square'). 0007 added quotes.payment_source / paid_marked_by / _at.
//   This module makes that provenance VISIBLE and makes manual marking honest:
//
//   1) Sales Pipeline cards: every quote gets an explicit payment badge —
//        - PAID — confirmed by Square            (green,  payment_source='square_confirmed')
//        - PAID — manual entry by <who>, not verified by Square
//                                                (amber,  payment_source='manual_entry')
//        - PAID — recorded before source tracking (grey,   'unknown_legacy')
//        - unpaid states: "pay link sent — UNPAID" / "invoiced — UNPAID".
//      (The base card could never show ANY of this: app_quote_admin_list does
//      not return the invoice/payment columns. Data comes from the new
//      read-only RPC app_quote_payment_admin_list, gated like the list itself.)
//      On a paid card the redundant "Mark Paid" button is hidden and a
//      "Receipt" button is ensured.
//   2) window.markQuotePaid is replaced with an honest flow: it says up front
//      that this records a MANUAL, non-Square-verified entry under the
//      caller's name, and no longer suggests 'Square' as the default method.
//      Server-side the RPC is capability-gated ('approve_invoice') by 0007.
//   3) Receipt overlay gets an on-screen (never printed) provenance note.
//   4) Maintenance Billing invoice view (js/09): a paid vendor bill shows who
//      marked it paid (wo_invoices.paid_source/paid_marked_by via 0007).
//
// FAIL-SAFE: every hook is try/caught; if the 0007 backend or credentials are
// missing, annotations simply don't appear and the original behaviour runs.
// ============================================================
(function(){
    'use strict';
    try{ if (typeof window === 'undefined') return; if (window.__r11PaymentState) return; window.__r11PaymentState = true; }catch(e){ return; }

    // ---------- tiny safe helpers (mirror js/39) ----------
    function esc(s){ try{ if(typeof escapeHtml==='function') return escapeHtml(s==null?'':String(s)); }catch(e){} return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return '&#'+c.charCodeAt(0)+';'; }); }
    function pin(){
        try{ if(typeof sessionPin!=='undefined' && sessionPin) return sessionPin; }catch(e){}
        try{ if(typeof localStorage!=='undefined' && localStorage.getItem('calichesKeep')!=='0'){ var kp=sessionStorage.getItem('calichesPin'); if(kp) return kp; } }catch(e){}
        return null;
    }
    function hasCreds(){
        try{ return !!(typeof supabaseClient!=='undefined' && supabaseClient && typeof currentUser!=='undefined' && currentUser && currentUser.username && pin()); }catch(e){ return false; }
    }
    function dstr(v){ try{ return v ? new Date(v).toLocaleDateString() : ''; }catch(e){ return ''; } }
    function whoAmI(){ try{ return (currentUser && (currentUser.name || currentUser.username)) || ''; }catch(e){ return ''; } }

    // ---------- payment-provenance cache (quote id -> row) ----------
    var PAY = { byId:{}, loaded:false, loading:false, waiters:[] };
    function invalidatePay(){ try{ PAY.byId={}; PAY.loaded=false; }catch(e){} }
    function loadPay(cb){
        try{
            if(PAY.loaded){ if(cb) cb(true); return; }
            if(cb) PAY.waiters.push(cb);
            if(PAY.loading) return;
            if(!hasCreds()){ flush(false); return; }
            PAY.loading = true;
            supabaseClient.rpc('app_quote_payment_admin_list', {
                p_admin_username: currentUser.username, p_admin_password: pin()
            }).then(function(res){
                PAY.loading = false;
                try{
                    if(res && res.error){
                        try{ if(res.error.code==='42501' && typeof sessionPin!=='undefined') sessionPin=null; }catch(_e){}
                        flush(false); return;
                    }
                    var rows = (res && res.data) || [];
                    var map = {};
                    for(var i=0;i<rows.length;i++){ if(rows[i] && rows[i].id!=null) map[rows[i].id]=rows[i]; }
                    PAY.byId = map; PAY.loaded = true;
                    flush(true);
                }catch(e){ flush(false); }
            }).catch(function(){ PAY.loading=false; flush(false); });
        }catch(e){ try{ PAY.loading=false; }catch(_e){} flush(false); }
        function flush(ok){ try{ var w=PAY.waiters; PAY.waiters=[]; for(var i=0;i<w.length;i++){ try{ w[i](ok); }catch(_e){} } }catch(_e){} }
    }

    // ---------- badge vocabulary ----------
    function paidBadgeHtml(p){
        var src = p.payment_source;
        if(src === 'square_confirmed'){
            return badge('#dff3e6','#1b7a3d','&#9989; PAID — confirmed by Square'
                + (p.paid_at ? ' on '+esc(dstr(p.paid_at)) : ''));
        }
        if(src === 'manual_entry'){
            return badge('#fff4e0','#9a5b00','&#9997;&#65039; PAID — manual entry'
                + (p.paid_marked_by ? ' by '+esc(p.paid_marked_by) : '')
                + (p.paid_marked_at ? ' ('+esc(dstr(p.paid_marked_at))+')' : '')
                + ' &middot; not verified by Square');
        }
        // unknown_legacy (or any unexpected value): never dress it up as confirmed
        return badge('#eef0f3','#5b6472','&#10068; PAID — recorded before source tracking (unverified)'
            + (p.paid_at ? ' &middot; '+esc(dstr(p.paid_at)) : ''));
    }
    function unpaidLineHtml(p){
        if(p.square_payment_url){
            return line('#185FA5','&#128179; Pay link sent — UNPAID (waiting on the customer / Square)');
        }
        if(p.invoice_status){
            return line('#5b6472','&#129534; '+esc(p.invoice_status)+' — UNPAID');
        }
        return '';
    }
    function badge(bg,fg,inner){
        return '<div class="r11-pay-badge" style="background:'+bg+';color:'+fg+';border-radius:8px;'
             + 'padding:7px 10px;font-size:12px;font-weight:800;margin:8px 0 2px;line-height:1.35;">'+inner+'</div>';
    }
    function line(fg,inner){
        return '<div class="r11-pay-badge" style="color:'+fg+';font-size:11.5px;font-weight:700;margin:6px 0 0;">'+inner+'</div>';
    }

    // ---------- pipeline annotation ----------
    function quoteIdFromCard(card){
        try{
            var m = (card.innerHTML||'').match(/(?:editQuote|markQuotePaid|showQuoteReceipt|quoteInvoice)\((\d+)[,)]/);
            return m ? parseInt(m[1],10) : null;
        }catch(e){ return null; }
    }
    function annotatePipeline(){
        try{
            var box = document.getElementById('pipelineResults');
            if(!box) return false;
            var cards = box.querySelectorAll('.maint-card');
            if(!cards.length) return false;
            var did = false;
            for(var i=0;i<cards.length;i++){
                var card = cards[i];
                if(card.querySelector('.r11-pay-badge')) { did = true; continue; }
                var id = quoteIdFromCard(card);
                if(id==null) continue;
                var p = PAY.byId[id];
                if(!p) continue;
                // keep the receipt modal honest too: give it the real payment fields
                try{
                    window._qCache = window._qCache || {};
                    var qc = window._qCache[id] = window._qCache[id] || {};
                    qc.invoice_status=p.invoice_status; qc.paid_at=p.paid_at; qc.amount_paid=p.amount_paid;
                    qc.payment_method=p.payment_method; qc.payment_reference=p.payment_reference;
                    qc.payment_source=p.payment_source; qc.paid_marked_by=p.paid_marked_by; qc.paid_marked_at=p.paid_marked_at;
                    if(p.invoice_number) qc.invoice_number=p.invoice_number;
                }catch(e){}
                var isPaid = (p.invoice_status==='Paid' || p.payment_source);
                var html = isPaid ? paidBadgeHtml(p) : unpaidLineHtml(p);
                if(html){
                    try{
                        var holder = document.createElement('div');
                        holder.innerHTML = html;
                        card.insertBefore(holder.firstChild, card.firstChild);
                        did = true;
                    }catch(e){}
                }
                if(isPaid){
                    try{
                        var btns = card.querySelectorAll('button'); var hasReceipt=false, markBtn=null;
                        for(var b=0;b<btns.length;b++){
                            var oc = btns[b].getAttribute('onclick')||'';
                            if(oc.indexOf('markQuotePaid('+id+')')>=0) markBtn=btns[b];
                            if(oc.indexOf('showQuoteReceipt('+id+')')>=0) hasReceipt=true;
                        }
                        if(markBtn) markBtn.style.display='none';   // already paid — don't invite a second mark
                        if(!hasReceipt && markBtn && markBtn.parentNode){
                            var rb=document.createElement('button');
                            rb.setAttribute('onclick','showQuoteReceipt('+id+')');
                            rb.setAttribute('style','background:#185FA5;color:white;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:bold;cursor:pointer;');
                            rb.innerHTML='&#129534; Receipt';
                            markBtn.parentNode.appendChild(rb);
                        }
                    }catch(e){}
                }
            }
            return did;
        }catch(e){ return true; /* never loop forever on an unexpected DOM */ }
    }
    function armAnnotator(){
        try{
            invalidatePay();
            var tries = 0;
            var t = setInterval(function(){
                tries++;
                try{
                    if(tries>24){ clearInterval(t); return; }
                    var box = document.getElementById('pipelineResults');
                    if(!box || !box.querySelectorAll('.maint-card').length) return;   // still loading
                    loadPay(function(ok){
                        try{ clearInterval(t); }catch(e){}
                        if(ok) annotatePipeline();
                    });
                }catch(e){ try{ clearInterval(t); }catch(_e){} }
            }, 350);
        }catch(e){}
    }

    // ---------- hook: pipeline loader ----------
    function hookOpen(fnName, after){
        try{
            var orig = window[fnName];
            if(typeof orig !== 'function') return false;
            if(orig.__r11Wrapped) return true;
            var wrapped = function(){
                var r;
                try{ r = orig.apply(this, arguments); }
                finally{ try{ after(); }catch(e){} }
                return r;
            };
            wrapped.__r11Wrapped = true;
            window[fnName] = wrapped;
            return true;
        }catch(e){ return false; }
    }

    // ---------- honest manual Mark Paid ----------
    var _origMarkQuotePaid = null;
    function installMarkPaid(){
        try{
            if(typeof window.markQuotePaid === 'function' && !window.markQuotePaid.__r11Wrapped){
                _origMarkQuotePaid = window.markQuotePaid;
            }
            var fn = function(id){
                try{
                    var q = (window._qCache||{})[id] || {};
                    var p = PAY.byId[id];
                    if(p && (p.payment_source || p.invoice_status==='Paid')){
                        if(!confirm('This quote is ALREADY marked paid'
                            + (p.payment_source==='square_confirmed' ? ' (confirmed by Square)' :
                               p.payment_source==='manual_entry' ? ' (manual entry'+(p.paid_marked_by?' by '+p.paid_marked_by:'')+')' : ' (source unknown)')
                            + '.\n\nRecord another manual payment entry anyway?')) return;
                    }
                    var who = whoAmI();
                    if(!confirm('Record a MANUAL payment on '+(q.company||q.contact_name||('quote #'+id))+'?\n\n'
                        + 'This marks the invoice paid WITHOUT Square verification and is permanently labelled:\n\n'
                        + '    "manual entry by '+(who||'you')+' — not verified by Square"\n\n'
                        + 'If the customer pays through the Square pay link, the Hub records "confirmed by Square" automatically — you do not need this button for that.')) return;
                    var amt = prompt('Amount received?\nLeave blank to use the quote total ($'+(Number(q.total)||0).toFixed(2)+').');
                    if(amt===null) return;
                    var method = prompt('How did the customer actually pay? (Cash, Check, Card in person, Zelle, Other)','Cash');
                    if(method===null) return;
                    var ref = prompt('Reference / confirmation # (optional):','') || '';
                    if(typeof withPin !== 'function' || typeof supabaseClient === 'undefined'){
                        if(_origMarkQuotePaid){ _origMarkQuotePaid(id); } return;
                    }
                    withPin(function(pinVal){
                        try{
                            supabaseClient.rpc('app_quote_mark_paid_manual', {
                                p_username: currentUser.username, p_password: pinVal, p_id: id,
                                p_amount: amt.trim()===''? null : (parseFloat(amt)||null),
                                p_method: (method||'Manual'), p_reference: ref
                            }).then(function(r){
                                if(r && r.error){
                                    var msg = String(r.error.message||'');
                                    try{ if(r.error.code==='42501' && typeof sessionPin!=='undefined') sessionPin=null; }catch(_e){}
                                    if(msg.indexOf('forbidden')>=0){
                                        alert('You do not have the "Approve invoices" permission, so you cannot mark payments.\nAsk an admin to grant approve_invoice in Access & Permissions.');
                                    } else { alert(msg || 'Could not record the payment.'); }
                                    return;
                                }
                                var d = (r && r.data) || {};
                                alert('Recorded as a MANUAL payment entry'
                                    + (d.paid_marked_by ? ' by '+d.paid_marked_by : '')
                                    + '.\nThe pipeline will show it as "manual entry — not verified by Square".');
                                invalidatePay();
                                try{ if(typeof fetchSalesPipeline==='function') fetchSalesPipeline(); }catch(e){}
                            }).catch(function(){ alert('Connection error.'); });
                        }catch(e){ alert('Connection error.'); }
                    });
                }catch(e){
                    try{ if(_origMarkQuotePaid) _origMarkQuotePaid(id); }catch(_e){}
                }
            };
            fn.__r11Wrapped = true;
            window.markQuotePaid = fn;
        }catch(e){}
    }

    // ---------- receipt overlay: on-screen provenance note (never printed) ----------
    function installReceiptNote(){
        try{
            var orig = window.showQuoteReceipt;
            if(typeof orig !== 'function' || orig.__r11Wrapped) return;
            var wrapped = function(id){
                var r;
                try{ r = orig.apply(this, arguments); }
                finally{
                    try{
                        var p = PAY.byId[id];
                        var rec = document.getElementById('qReceipt');
                        if(p && rec && rec.parentNode && !rec.parentNode.querySelector('.r11-receipt-note')){
                            var n = document.createElement('div');
                            n.className='r11-receipt-note';
                            var s = p.payment_source;
                            var txt, bg, fg;
                            if(s==='square_confirmed'){ bg='#dff3e6'; fg='#1b7a3d'; txt='&#9989; Payment confirmed by Square'+(p.paid_at?(' on '+esc(dstr(p.paid_at))):''); }
                            else if(s==='manual_entry'){ bg='#fff4e0'; fg='#9a5b00'; txt='&#9997;&#65039; Recorded MANUALLY'+(p.paid_marked_by?' by '+esc(p.paid_marked_by):'')+(p.paid_marked_at?(' on '+esc(dstr(p.paid_marked_at))):'')+' — not verified by Square'; }
                            else { bg='#eef0f3'; fg='#5b6472'; txt='&#10068; Recorded before payment-source tracking — confirmation source unknown'; }
                            n.setAttribute('style','background:'+bg+';color:'+fg+';border-radius:8px;padding:8px 10px;font-size:11.5px;font-weight:700;margin-top:10px;');
                            n.innerHTML = txt + ' <span style="font-weight:400;">(internal note — not on the printed receipt)</span>';
                            rec.parentNode.insertBefore(n, rec.nextSibling);
                        }
                    }catch(e){}
                }
                return r;
            };
            wrapped.__r11Wrapped = true;
            window.showQuoteReceipt = wrapped;
        }catch(e){}
    }

    // ---------- vendor bills (js/09): who marked it paid ----------
    function installWobNote(){
        try{
            var orig = window.wobInvoice;
            if(typeof orig !== 'function' || orig.__r11Wrapped) return;
            var wrapped = function(){
                var r;
                try{ r = orig.apply(this, arguments); }
                finally{
                    try{
                        var iv = (typeof _wob!=='undefined' && _wob) ? _wob.cur : null;
                        var m = document.getElementById('wobModal');
                        if(iv && m && iv.status==='paid' && !m.querySelector('.r11-wob-note')){
                            var wrap = m.children && m.children[1];
                            if(wrap){
                                var n = document.createElement('div');
                                n.className='r11-wob-note';
                                var manual = (iv.paid_source==='manual_entry');
                                n.setAttribute('style','max-width:680px;margin:0 auto 10px;background:'+(manual?'#fff4e0':'#eef0f3')+';color:'+(manual?'#9a5b00':'#5b6472')+';border-radius:9px;padding:8px 12px;font-size:12px;font-weight:700;');
                                n.innerHTML = manual
                                    ? ('&#9997;&#65039; Marked paid manually'+(iv.paid_marked_by?(' by '+esc(iv.paid_marked_by)):'')+' — hand-recorded, no processor confirmation exists for vendor bills.')
                                    : '&#10068; Paid before payment-source tracking — no record of who marked it.';
                                wrap.insertBefore(n, wrap.firstChild);
                            }
                        }
                    }catch(e){}
                }
                return r;
            };
            wrapped.__r11Wrapped = true;
            window.wobInvoice = wrapped;
        }catch(e){}
    }

    // ---------- install (retry until the base scripts have defined their globals) ----------
    var installTries = 0;
    function installAll(){
        try{
            installTries++;
            var okPipeline = hookOpen('fetchSalesPipeline', armAnnotator);
            if(typeof window.markQuotePaid === 'function' && !window.markQuotePaid.__r11Wrapped) installMarkPaid();
            installReceiptNote();
            installWobNote();
            var done = okPipeline
                && (typeof window.markQuotePaid==='function' && window.markQuotePaid.__r11Wrapped)
                && (typeof window.showQuoteReceipt!=='function' || window.showQuoteReceipt.__r11Wrapped)
                && (typeof window.wobInvoice!=='function' || window.wobInvoice.__r11Wrapped);
            if(!done && installTries < 40) setTimeout(installAll, 250);
        }catch(e){ if(installTries < 40) setTimeout(installAll, 250); }
    }
    try{
        if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installAll);
        else installAll();
    }catch(e){ try{ installAll(); }catch(_e){} }
})();
