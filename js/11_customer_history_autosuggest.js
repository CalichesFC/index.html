    // ============================================================
    // CUSTOMER HISTORY AUTOSUGGEST (Quote tab)
    // ============================================================
    let quoteSuggestTimer = null;
    let quoteSuggestReqId = 0; // Wave 2 fix (2026-07-18): stale-response guard, see onQuoteContactNameInput

    function onQuoteContactNameInput(input) {
        const query = input.value.trim();
        const box = document.getElementById('quoteContactSuggestions');
        if (quoteSuggestTimer) clearTimeout(quoteSuggestTimer);
        if (query.length < 2) { box.style.display = 'none'; box.innerHTML = ''; return; }
        quoteSuggestTimer = setTimeout(() => {
            const myReqId = ++quoteSuggestReqId;
            supabaseClient.rpc('app_quote_search_contacts', { p_query: query })
            .then(({ data, error }) => {
                // Wave 2 fix (2026-07-18): stale-response guard -- a slower earlier request can
                // resolve after a newer one; discard it instead of letting it overwrite the current,
                // correct suggestions/matches (was: whichever response arrived last always won).
                if (myReqId !== quoteSuggestReqId) return;
                if (error || !data || data.length === 0) { box.style.display = 'none'; box.innerHTML = ''; return; }
                // De-duplicate by contact name + company
                const seen = {}; const matches = [];
                data.forEach(row => {
                    const key = (row.contact_name || '').toLowerCase() + '|' + (row.company || '').toLowerCase();
                    if (!seen[key]) { seen[key] = true; matches.push(row); }
                });
                if (matches.length === 0) { box.style.display = 'none'; box.innerHTML = ''; return; }
                let html = '';
                matches.slice(0, 5).forEach((row, i) => {
                    html += '<div onclick="selectQuoteContact(' + i + ')" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;" onmousedown="event.preventDefault();">';
                    html += '<div style="font-weight:bold;color:#333;">' + escapeHtml(row.contact_name || '') + (row.company ? ' &mdash; ' + escapeHtml(row.company) : '') + '</div>';
                    html += '<div style="font-size:12px;color:#6b7686;">' + escapeHtml(row.contact_phone || '') + (row.contact_phone && row.contact_email ? ' &bull; ' : '') + escapeHtml(row.contact_email || '') + '</div>';
                    html += '</div>';
                });
                window._quoteContactMatches = matches;
                box.innerHTML = html;
                box.style.display = 'block';
            }).catch(() => { if (myReqId !== quoteSuggestReqId) return; box.style.display = 'none'; box.innerHTML = ''; });
        }, 300);
    }

    function selectQuoteContact(idx) {
        const row = (window._quoteContactMatches || [])[idx];
        if (!row) return;
        const form = document.getElementById('quoteForm');
        form.querySelector('input[name="ContactName"]').value = row.contact_name || '';
        form.querySelector('input[name="Company"]').value = row.company || '';
        if (row.contact_phone) form.querySelector('input[name="ContactPhone"]').value = row.contact_phone;
        if (row.contact_email) form.querySelector('input[name="ContactEmail"]').value = row.contact_email;
        hideQuoteContactSuggestions();
    }

    function hideQuoteContactSuggestions() {
        const box = document.getElementById('quoteContactSuggestions');
        if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    }

    function addQuoteRow(qty, desc, price) {
        quoteRowCount++;
        const id = quoteRowCount;
        const row = document.createElement('div');
        row.className = 'quote-row';
        row.id = 'quoteRow' + id;
        row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;';
        row.innerHTML =
            '<div style="flex:0 0 70px;"><input type="number" min="0" step="1" value="' + (qty != null ? qty : 1) + '" class="quote-qty" onchange="recalcQuoteTotals()" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;"></div>' +
            '<div style="flex:1 1 200px;"><input type="text" value="' + (desc || '') + '" class="quote-desc" placeholder="e.g., Custard Cart Service (2 hrs)" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;"></div>' +
            '<div style="flex:0 0 100px;"><input type="number" min="0" step="0.01" value="' + (price != null ? price : '') + '" class="quote-price" placeholder="0.00" onchange="recalcQuoteTotals()" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;"></div>' +
            '<div style="flex:0 0 100px;"><div class="quote-line-subtotal" style="padding:10px;font-weight:bold;color:#7b2d8b;">$0.00</div></div>' +
            '<button type="button" onclick="removeQuoteRow(' + id + ')" style="flex:0 0 36px;background:#fceceb;color:var(--damage-red);border:2px solid var(--damage-red);border-radius:8px;padding:9px;cursor:pointer;font-weight:bold;">&times;</button>';
        document.getElementById('quoteItemsContainer').appendChild(row);
        recalcQuoteTotals();
    }

    function removeQuoteRow(id) {
        const row = document.getElementById('quoteRow' + id);
        if (row) row.remove();
        recalcQuoteTotals();
    }

    function recalcQuoteTotals() {
        let subtotal = 0;
        document.querySelectorAll('#quoteItemsContainer .quote-row').forEach(row => {
            const qty = Math.max(0, parseFloat(row.querySelector('.quote-qty').value) || 0);
            const price = Math.max(0, parseFloat(row.querySelector('.quote-price').value) || 0);
            const lineSub = qty * price;
            row.querySelector('.quote-line-subtotal').innerText = '$' + lineSub.toFixed(2);
            subtotal += lineSub;
        });
        // Round to cents so Subtotal + Tax always equals Grand Total exactly.
        subtotal = Math.round(subtotal * 100) / 100;
        var _tf = (typeof hubTaxFrac==='function') ? hubTaxFrac() : QUOTE_TAX_RATE;
        const tax = Math.round(subtotal * _tf * 100) / 100;
        const total = Math.round((subtotal + tax) * 100) / 100;
        try{ var _tl=document.getElementById('quoteTaxLabel'); if(_tl){ var _tc=(typeof hubTaxCityLabel==='function')?hubTaxCityLabel():''; _tl.innerText='Tax ('+(Math.round(_tf*10000)/100)+'%'+(_tc?(' \u2014 '+_tc):'')+'):'; } }catch(e){}
        document.getElementById('quoteSubtotal').innerText = '$' + subtotal.toFixed(2);
        document.getElementById('quoteTax').innerText = '$' + tax.toFixed(2);
        document.getElementById('quoteTotal').innerText = '$' + total.toFixed(2);
    }

    function submitQuote() {
        const btn = document.getElementById('submitQuoteBtn');
        const form = document.getElementById('quoteForm');
        const contactName = form.querySelector('input[name="ContactName"]').value.trim();
        const eventDate = form.querySelector('input[name="EventDate"]').value;
        if (!contactName || !eventDate) { return alert('Please enter the contact name and event date!'); }
        var _qValid=[].slice.call(document.querySelectorAll('#quoteItemsContainer .quote-row')).filter(function(r){ return (r.querySelector('.quote-desc').value||'').trim() && (parseFloat(r.querySelector('.quote-price').value)||0)>0; });
        if(_qValid.length===0){ return alert('Add at least one line item (a description and a price over $0) before sending the quote.'); }
        btn.innerText = 'Generating PDF...'; btn.disabled = true;

        const company = form.querySelector('input[name="Company"]').value;
        const phone = form.querySelector('input[name="ContactPhone"]').value;
        const email = form.querySelector('input[name="ContactEmail"]').value;
        const eventType = form.querySelector('input[name="EventType"]').value;
        const notes = form.querySelector('textarea[name="Notes"]').value;
        const editing = window._editingQuote || null;
        const orderNum = (editing && editing.order_num) ? editing.order_num : Math.floor(1000 + Math.random() * 9000);
        const eventDateStr = new Date(eventDate + 'T00:00:00').toLocaleDateString();

        let pdfHtml = getBrandHeader('Catering Quote', '#7b2d8b');
        pdfHtml += '<p style="margin:0 0 20px 0;color:#666;font-size:14px;">Date: ' + new Date().toLocaleDateString() + ' &nbsp;&nbsp; Order #' + orderNum + '</p>';
        pdfHtml += '<table border="1" cellpadding="10" style="border-collapse:collapse;width:100%;font-size:14px;border-color:#ccc;margin-bottom:20px;"><tr><td style="width:50%;"><strong>Contact\'s Name:</strong> ' + contactName + '</td><td><strong>Company:</strong> ' + (company || '&mdash;') + '</td></tr><tr><td><strong>Contact\'s Tel:</strong> ' + (phone || '&mdash;') + '</td><td><strong>Contact Email:</strong> ' + (email || '&mdash;') + '</td></tr><tr><td><strong>Event Date:</strong> ' + eventDateStr + '</td><td><strong>Event Type:</strong> ' + (eventType || '&mdash;') + '</td></tr></table>';
        pdfHtml += '<table border="1" cellpadding="10" style="border-collapse:collapse;width:100%;font-size:14px;border-color:#ccc;"><tr style="background:#f0f0f0;"><th style="text-align:left;">Quantity</th><th style="text-align:left;">Description</th><th style="text-align:left;">Price</th><th style="text-align:left;">Subtotal</th></tr>';
        let subtotal = 0;
        let lineItemsArr = [];
        document.querySelectorAll('#quoteItemsContainer .quote-row').forEach(row => {
            const qty = Math.max(0, parseFloat(row.querySelector('.quote-qty').value) || 0);
            const desc = row.querySelector('.quote-desc').value || '';
            const price = Math.max(0, parseFloat(row.querySelector('.quote-price').value) || 0);
            if (!desc) return;
            const lineSub = qty * price;
            subtotal += lineSub;
            lineItemsArr.push({ qty: qty, desc: desc, price: price, subtotal: lineSub });
            pdfHtml += '<tr><td>' + qty + '</td><td>' + desc + '</td><td style="text-align:right;">$' + price.toFixed(2) + '</td><td style="text-align:right;">$' + lineSub.toFixed(2) + '</td></tr>';
        });
        pdfHtml += '</table>';
        // Round to cents so the PDF/stored Subtotal + Tax always equals the Grand Total.
        subtotal = Math.round(subtotal * 100) / 100;
        var _tf = (typeof hubTaxFrac==='function') ? hubTaxFrac() : QUOTE_TAX_RATE;
        var _tcity = (typeof hubTaxCityLabel==='function') ? hubTaxCityLabel() : '';
        const tax = Math.round(subtotal * _tf * 100) / 100;
        const total = Math.round((subtotal + tax) * 100) / 100;
        pdfHtml += '<table border="1" cellpadding="10" style="border-collapse:collapse;width:100%;font-size:13px;border-color:#ccc;border-top:none;margin-bottom:20px;"><tr><td style="width:60%;vertical-align:top;"><strong>Notes:</strong> ' + (notes || '&mdash;') + '</td><td style="width:40%;padding:0;vertical-align:top;"><table style="width:100%;border-collapse:collapse;font-size:14px;"><tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #ccc;">Subtotal</td><td style="padding:8px;text-align:right;border-bottom:1px solid #ccc;">$' + subtotal.toFixed(2) + '</td></tr><tr><td style="padding:8px;font-weight:bold;border-bottom:1px solid #ccc;">Tax (' + (Math.round(_tf*10000)/100) + '%' + (_tcity?(' \u2014 '+_tcity):'') + ')</td><td style="padding:8px;text-align:right;border-bottom:1px solid #ccc;">$' + tax.toFixed(2) + '</td></tr><tr><td style="padding:8px;font-weight:900;font-size:16px;">Grand Total</td><td style="padding:8px;text-align:right;font-weight:900;font-size:16px;">$' + total.toFixed(2) + '</td></tr></table></td></tr></table>';
        var DEFAULT_BOOKING = 'At Caliche\'s Frozen Custard, we\'ve updated our booking and payment terms to better serve our clients. We no longer require a 50% non-refundable deposit to secure your event. To confirm your booking, simply respond with your approval to your Caliche\'s Frozen Custard contact, and we will take care of scheduling your event. The full balance is due on the day of the event, offering you greater flexibility. We accept payments in cash, by check, or online via credit card, according to what\'s most convenient for you.';
        var _booking = (typeof cfg==='function'?cfg('policies','booking', DEFAULT_BOOKING):DEFAULT_BOOKING);
        pdfHtml += '<div style="font-size:12px;color:#666;line-height:1.6;border-top:1px solid #eee;padding-top:15px;"><strong>Updated Booking and Payment Policy:</strong> ' + _booking + '</div>';
        pdfHtml += '<p style="text-align:center;color:#6b7686;font-size:11px;margin-top:25px;border-top:1px solid #eee;padding-top:10px;">Caliche\'s Catering Quote</p>';
        pdfHtml += '</div>';
        document.getElementById('quoteReportHtml').value = pdfHtml;

        const fd = new FormData(form);
        fetch(G_URL, { method: 'POST', body: fd })
        .then(res => res.json())
        .then(googleData => {
            console.log('[Quote] GAS:', googleData);
            btn.disabled = false; btn.innerText = '\u{1F680} GENERATE QUOTE PDF';
            const linkDiv = document.getElementById('quoteResultLink');
            const pdfUrl = (googleData.pdfUrl && googleData.pdfUrl !== 'No PDF') ? googleData.pdfUrl : null;
            if (pdfUrl) {
                linkDiv.innerHTML = '<a href="' + pdfUrl + '" target="_blank" style="display:inline-block;background:#7b2d8b;color:white;padding:14px 28px;border-radius:8px;font-weight:bold;text-decoration:none;">\u{1F4C4} View / Download Quote PDF</a>';
            } else {
                linkDiv.innerHTML = '<p style="color:#e74c3c;">PDF generation failed. Please try again.</p>';
            }
            linkDiv.style.display = 'block';
            try { linkDiv.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e) {}

            // Persist quote to Supabase — create new, or UPDATE the existing row if editing
            var qfields = { p_contact_name: contactName, p_company: company || null, p_contact_phone: phone || null, p_contact_email: email || null, p_event_date: eventDate, p_event_type: eventType || null, p_notes: notes || null, p_line_items: lineItemsArr, p_subtotal: subtotal, p_tax: tax, p_total: total, p_pdf_url: pdfUrl };
            var afterSaved = function(token) {
                if (!token) return;
                const acceptUrl = publicLinkBase() + '?accept=' + token;
                const linkBtn = document.createElement('button');
                linkBtn.className = 'save-btn blue-btn'; linkBtn.style.marginTop = '12px'; linkBtn.style.marginBottom = '0';
                linkBtn.innerText = '\u{1F517} Copy Customer Acceptance Link';
                linkBtn.onclick = function() { navigator.clipboard.writeText(acceptUrl).then(() => { linkBtn.innerText = '✅ Link Copied!'; setTimeout(() => { linkBtn.innerText = '\u{1F517} Copy Customer Acceptance Link'; }, 2000); }).catch(() => { alert('Acceptance link:\n' + acceptUrl); }); };
                linkDiv.appendChild(document.createElement('br')); linkDiv.appendChild(linkBtn);
            };
            if (editing) {
                withPin(function(pin) {
                    var args = { p_admin_username: currentUser.username, p_admin_password: pin, p_id: editing.id };
                    Object.keys(qfields).forEach(function(k){ args[k] = qfields[k]; });
                    supabaseClient.rpc('app_quote_update', args).then(({ data, error }) => {
                        if (error) { if (error.code === '42501') sessionPin = null; console.error('[Quote] update error:', error.message); alert('The PDF was made, but updating the quote failed: ' + error.message); }
                        else { clearQuoteEdit(); afterSaved(data && data.accept_token); }
                    }).catch(err => console.error('[Quote] update unexpected:', err));
                });
            } else {
                var cargs = { p_order_num: orderNum, p_submitted_by: currentUser.name || null };
                Object.keys(qfields).forEach(function(k){ cargs[k] = qfields[k]; });
                supabaseClient.rpc('app_quote_create', cargs).then(({ data, error }) => {
                    if (error) { console.error('[Quote] Supabase insert error:', error.code, error.message); alert('The PDF was made, but saving the quote failed: ' + error.message); }
                    else { afterSaved(data && data[0] && data[0].accept_token); }
                }).catch(err => console.error('[Quote] Unexpected Supabase error:', err));
            }
        })
        .catch(err => { console.error('[Quote] GAS error:', err); alert('Could not reach PDF server: ' + err.message); btn.disabled = false; btn.innerText = '\u{1F680} GENERATE QUOTE PDF'; });
    }

    // ============================================================
    // SALES PIPELINE (Issac only)
    // ============================================================
    let pipelineStatusFilter = 'All';

    function openSalesPipeline() {
        triggerTransition(() => {
            document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
            document.getElementById('salesPipelineView').style.display = 'block';
            fetchSalesPipeline();
        });
    }

    function copyAcceptLink(token, btn) {
        const url = publicLinkBase() + '?accept=' + token;
        navigator.clipboard.writeText(url).then(() => {
            const orig = btn.innerText;
            btn.innerText = '✅ Copied!';
            setTimeout(() => { btn.innerText = orig; }, 2000);
        }).catch(() => alert('Acceptance link:\n' + url));
    }

    // ===== Edit & resend an existing quote =====
    function editQuote(id){
        var list=window._pipelineQuotes||[]; var q=null;
        for(var i=0;i<list.length;i++){ if(list[i].id===id){ q=list[i]; break; } }
        if(!q){ alert('Quote not found. Refresh the pipeline and try again.'); return; }
        window._editingQuote=q;
        triggerTransition(function(){
            document.querySelectorAll('.app-view').forEach(function(v){ v.style.display='none'; });
            document.getElementById('quotesView').style.display='block';
            fillQuoteForm(q);
        });
    }
    function fillQuoteForm(q){
        var form=document.getElementById('quoteForm'); if(!form) return;
        function setv(name,val){ var el=form.querySelector('[name="'+name+'"]'); if(el) el.value=(val==null?'':val); }
        setv('ContactName',q.contact_name); setv('Company',q.company); setv('ContactPhone',q.contact_phone); setv('ContactEmail',q.contact_email); setv('EventType',q.event_type); setv('Notes',q.notes);
        setv('EventDate', q.event_date? String(q.event_date).slice(0,10):'');
        var cont=document.getElementById('quoteItemsContainer'); if(cont) cont.innerHTML='';
        var items=q.line_items; if(typeof items==='string'){ try{ items=JSON.parse(items); }catch(e){ items=[]; } } items=items||[];
        if(!items.length){ addQuoteRow(); } else { items.forEach(function(it){ addQuoteRow(it.qty!=null?it.qty:(it.quantity||1), it.desc||it.description||'', it.price!=null?it.price:(it.unit_price||'')); }); }
        recalcQuoteTotals();
        var b=document.getElementById('submitQuoteBtn'); if(b) b.innerHTML='\u{1F504} UPDATE &amp; RESEND QUOTE #'+escapeHtml(String(q.order_num));
        var rl=document.getElementById('quoteResultLink'); if(rl){ rl.style.display='none'; rl.innerHTML=''; }
        var bn=document.getElementById('quoteEditBanner');
        if(!bn){ bn=document.createElement('div'); bn.id='quoteEditBanner'; bn.style.cssText='background:#f3e8fb;border:1px solid #d9b8ec;color:#7b2d8b;border-radius:8px;padding:10px 13px;margin-bottom:14px;font-size:13px;font-weight:bold;'; if(form.parentNode) form.parentNode.insertBefore(bn, form); }
        bn.innerHTML='✏️ Editing quote #'+escapeHtml(String(q.order_num))+' for '+escapeHtml(q.contact_name||'')+'. Adjust anything below and tap Update &amp; Resend &mdash; the customer’s accept link stays the same.';
        bn.style.display='block';
        window.scrollTo(0,0);
    }
    function clearQuoteEdit(){
        window._editingQuote=null;
        var b=document.getElementById('submitQuoteBtn'); if(b) b.innerHTML='\u{1F680} GENERATE QUOTE PDF';
        var bn=document.getElementById('quoteEditBanner'); if(bn) bn.style.display='none';
    }

    function updateQuoteStatus(id, status) {
        withPin(function(pin) {
            supabaseClient.rpc('app_quote_admin_update_status', { p_admin_username: currentUser.username, p_admin_password: pin, p_id: id, p_status: status })
            .then(({ error }) => {
                if (error && error.code === '42501') sessionPin = null;
                if (error) { alert('Error: ' + error.message); } else { fetchSalesPipeline(); }
            });
        });
    }

    function sendQuoteReminder(id, btn) {
        const quote = (window._pipelineQuotes || []).find(q => q.id === id);
        if (!quote) return;
        if (btn) { btn.disabled = true; btn.innerText = 'Sending...'; }

        const daysPending = quote.created_at ? Math.floor((Date.now() - new Date(quote.created_at)) / 86400000) : 0;
        const who = quote.contact_name + (quote.company ? ' (' + quote.company + ')' : '');
        const message = 'Quote #' + quote.order_num + ' for ' + who + ' &mdash; $' + (Number(quote.total) || 0).toFixed(2) + ' &mdash; has been pending ' + daysPending + ' day' + (daysPending === 1 ? '' : 's') + '. Follow up with the customer.';

        withPin(function(pin) {
            supabaseClient.rpc('app_admin_notification_insert', {
                p_admin_username: currentUser.username, p_admin_password: pin,
                p_title: 'Quote Follow-up Reminder', p_message: message,
                p_form_type: 'Quote Reminder', p_pdf_url: quote.pdf_url || null
            }).then(({ error: notifError }) => {
                if (notifError && notifError.code === '42501') sessionPin = null;
                if (notifError) { alert('Error sending reminder: ' + notifError.message); fetchSalesPipeline(); return; }
                supabaseClient.rpc('app_quote_admin_mark_reminder_sent', { p_admin_username: currentUser.username, p_admin_password: pin, p_id: id })
                .then(({ error }) => {
                    if (error && error.code === '42501') sessionPin = null;
                    if (error) alert('Error: ' + error.message);
                    if (typeof fetchNotifications === 'function') fetchNotifications();
                    fetchSalesPipeline();
                });
            }).catch(err => { alert('Error: ' + err.message); fetchSalesPipeline(); });
        }, function() { fetchSalesPipeline(); });
    }

    function fetchSalesPipeline() {
        const resultsDiv = document.getElementById('pipelineResults');
        const summaryDiv = document.getElementById('pipelineSummary');
        const filtersDiv = document.getElementById('pipelineFilters');
        resultsDiv.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">Loading pipeline...</p>';

        withPin(function(pin) {
        supabaseClient.rpc('app_quote_admin_list', { p_admin_username: currentUser.username, p_admin_password: pin })
        .then(({ data, error }) => {
            if (error && error.code === '42501') sessionPin = null;
            if (error) { resultsDiv.innerHTML = '<p style="color:#e74c3c;text-align:center;">Error loading quotes: ' + escapeHtml(error.message) + '</p>'; return; }
            if (!data || data.length === 0) {
                summaryDiv.innerHTML = '';
                filtersDiv.innerHTML = '';
                resultsDiv.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">No quotes yet. Create one from the Catering Quote tab!</p>';
                return;
            }

            const statusColors = { 'Pending': 'var(--maint-orange)', 'Accepted': 'var(--pass-green)', 'Declined': 'var(--fail-red)', 'Expired': 'var(--na-gray)' };
            const FOLLOWUP_DAYS = 3;
            window._pipelineQuotes = data;

            // Summary stats
            const counts = {}; const totals = {};
            let grandTotal = 0, openTotal = 0, followUpCount = 0;
            data.forEach(q => {
                const st = q.status || 'Pending';
                const amt = Number(q.total) || 0;
                counts[st] = (counts[st] || 0) + 1;
                totals[st] = (totals[st] || 0) + amt;
                grandTotal += amt;
                if (st === 'Pending') {
                    openTotal += amt;
                    const days = q.created_at ? Math.floor((Date.now() - new Date(q.created_at)) / 86400000) : 0;
                    if (days >= FOLLOWUP_DAYS) followUpCount++;
                }
            });

            let summaryHtml = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:15px;">';
            summaryHtml += '<div style="flex:1;min-width:120px;background:#7b2d8b;color:white;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:22px;font-weight:900;">' + data.length + '</div><div style="font-size:12px;text-transform:uppercase;opacity:.9;">Total Quotes</div></div>';
            summaryHtml += '<div style="flex:1;min-width:120px;background:var(--pass-green);color:white;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:22px;font-weight:900;">$' + grandTotal.toFixed(2) + '</div><div style="font-size:12px;text-transform:uppercase;opacity:.9;">Pipeline Value</div></div>';
            summaryHtml += '<div style="flex:1;min-width:120px;background:var(--maint-orange);color:white;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:22px;font-weight:900;">$' + openTotal.toFixed(2) + '</div><div style="font-size:12px;text-transform:uppercase;opacity:.9;">Pending Value</div></div>';
            summaryHtml += '<div style="flex:1;min-width:120px;background:' + (followUpCount > 0 ? 'var(--fail-red)' : 'var(--na-gray)') + ';color:white;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:22px;font-weight:900;">' + followUpCount + '</div><div style="font-size:12px;text-transform:uppercase;opacity:.9;">Needs Follow-up</div></div>';
            summaryHtml += '</div>';

            summaryHtml += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:15px;justify-content:center;">';
            Object.keys(counts).forEach(st => {
                summaryHtml += '<div style="background:' + (statusColors[st] || '#888') + ';color:white;border-radius:20px;padding:6px 14px;font-size:12px;font-weight:bold;">' + escapeHtml(st) + ': ' + counts[st] + ' &bull; $' + totals[st].toFixed(2) + '</div>';
            });
            summaryHtml += '</div>';
            summaryDiv.innerHTML = summaryHtml;

            // Filters
            const allStatuses = ['All', 'Pending', 'Accepted', 'Declined', 'Expired'];
            let filterHtml = '';
            allStatuses.forEach(st => {
                const active = (pipelineStatusFilter === st);
                filterHtml += '<button onclick="pipelineStatusFilter=\'' + st + '\';fetchSalesPipeline();" style="border:none;border-radius:20px;padding:6px 14px;font-size:12px;font-weight:bold;cursor:pointer;background:' + (active ? '#7b2d8b' : '#eee') + ';color:' + (active ? 'white' : '#555') + ';">' + st + '</button>';
            });
            filtersDiv.innerHTML = filterHtml;

            // Filtered quote list
            let filtered = data;
            if (pipelineStatusFilter !== 'All') filtered = data.filter(q => (q.status || 'Pending') === pipelineStatusFilter);

            if (filtered.length === 0) {
                resultsDiv.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">No quotes with status "' + escapeHtml(pipelineStatusFilter) + '".</p>';
                return;
            }

            let html = '';
            filtered.forEach(q => {
                const st = q.status || 'Pending';
                const color = statusColors[st] || '#888';
                const eventDateStr = q.event_date ? new Date(q.event_date + 'T00:00:00').toLocaleDateString() : '&mdash;';
                const createdStr = q.created_at ? new Date(q.created_at).toLocaleDateString() : '';
                const daysPending = q.created_at ? Math.floor((Date.now() - new Date(q.created_at)) / 86400000) : 0;
                const needsFollowUp = (st === 'Pending' && daysPending >= FOLLOWUP_DAYS);
                html += '<div class="maint-card" style="border-left-color:' + color + ';">';
                html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px;">';
                html += '<div><div class="maint-card-title">#' + escapeHtml(q.order_num) + ' &mdash; ' + escapeHtml(q.contact_name) + (q.company ? ' (' + escapeHtml(q.company) + ')' : '') + '</div>';
                html += '<div class="maint-card-meta">Event: ' + eventDateStr + (q.event_type ? ' &bull; ' + escapeHtml(q.event_type) : '') + ' &bull; Submitted ' + createdStr + (q.submitted_by ? ' by ' + escapeHtml(q.submitted_by) : '') + '</div></div>';
                html += '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">';
                html += '<div style="background:' + color + ';color:white;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:bold;white-space:nowrap;">' + escapeHtml(st) + '</div>';
                if (needsFollowUp) html += '<div style="background:var(--fail-red);color:white;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:bold;white-space:nowrap;">&#9200; Follow-up (' + daysPending + 'd)</div>';
                html += '</div>';
                html += '</div>';
                try{ window._qCache = window._qCache || {}; window._qCache[q.id] = q; }catch(_e){}
                html += '<div style="font-size:20px;font-weight:900;color:var(--caliches-blue);margin:8px 0;">$' + (Number(q.total) || 0).toFixed(2) + '</div>';
                if (q.accepted_at) html += '<div class="maint-card-meta" style="color:var(--pass-green);font-weight:bold;">&#10003; Accepted on ' + new Date(q.accepted_at).toLocaleDateString() + '</div>';
                if (q.invoice_number) html += '<div class="maint-card-meta" style="color:#1f7a3d;font-weight:bold;">🧾 Invoice ' + escapeHtml(q.invoice_number) + '</div>';
                if (q.invoice_status === 'Paid') html += '<div class="maint-card-meta" style="color:#1b7a3d;font-weight:bold;">💳 Paid' + (q.paid_at ? ' on ' + new Date(q.paid_at).toLocaleDateString() : '') + '</div>';
                else if (q.square_payment_url) {
                    html += '<div class="maint-card-meta" style="color:#185FA5;font-weight:bold;">💳 Pay link ready — awaiting payment</div>';
                    // H3 fix: if Square's "Paid" webhook never lands (e.g. the webhook secrets
                    // aren't set yet — see SQUARE_INVOICE_SETUP.md), an old pay link just sits
                    // here looking identical to "customer hasn't paid yet." Flag it once it's
                    // stale so a manager knows to double-check with the customer / Square instead
                    // of assuming it's simply unpaid. Reuses the same FOLLOWUP_DAYS threshold as
                    // the pending-quote follow-up flag below.
                    var _linkAge = q.invoiced_at || q.accepted_at;
                    var _linkDays = _linkAge ? Math.floor((Date.now() - new Date(_linkAge)) / 86400000) : 0;
                    if (_linkDays >= FOLLOWUP_DAYS) html += '<div class="maint-card-meta" style="color:var(--fail-red);font-weight:bold;">⚠️ Sent ' + _linkDays + 'd ago, still unpaid — verify with the customer/Square (the auto-Paid webhook may not be live yet)</div>';
                }
                else if (st === 'Accepted' && q.accepted_at && (Date.now() - new Date(q.accepted_at)) > 10 * 60000) {
                    // H3 fix: autoSendSquareInvoice() (js/02_on_load.js) only console.error's when
                    // the customer-side pay-link creation fails (missing/bad Square secrets, Square
                    // error, etc.) — nothing alerts staff. This is that staff-visible signal: an
                    // Accepted quote with no pay link, more than 10 minutes after acceptance (a
                    // grace period so this doesn't fire while the auto-send is simply still in
                    // flight).
                    html += '<div class="maint-card-meta" style="color:var(--maint-orange);font-weight:bold;">⚠️ No pay link yet — the auto-send may have failed. Use "Create Pay Link" below, or confirm the customer is paying cash/check.</div>';
                }
                if (q.reminder_sent) html += '<div class="maint-card-meta" style="color:var(--maint-orange);font-weight:bold;">&#128276; Follow-up reminder sent</div>';
                html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">';
                if (q.pdf_url) html += '<a href="' + q.pdf_url + '" target="_blank" style="background:#7b2d8b;color:white;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:bold;text-decoration:none;">&#128196; View PDF</a>';
                if (q.accept_token) html += '<button onclick="copyAcceptLink(\'' + q.accept_token + '\', this)" style="background:var(--caliches-blue);color:white;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:bold;cursor:pointer;">&#128279; Copy Accept Link</button>';
                html += '<button onclick="editQuote(' + q.id + ')" style="background:#7b2d8b;color:white;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:bold;cursor:pointer;">&#9999;&#65039; Edit &amp; Resend</button>';
                // Pay link is available on ANY unpaid quote (not just Accepted), so it's always reachable.
                if (q.invoice_status !== 'Paid') {
                    var _sqLabel = q.square_payment_url ? '💳 Refresh Pay Link' : '💳 Create Pay Link';
                    html += '<button onclick="sendSquareInvoice(' + q.id + ', this)" style="background:#0f7a3d;color:white;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:bold;cursor:pointer;">' + _sqLabel + '</button>';
                }
                if (q.square_payment_url) html += '<button onclick="copyPayLink(' + q.id + ', this)" style="background:#185FA5;color:white;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:bold;cursor:pointer;">🔗 Copy Pay Link</button>';
                if (q.invoice_status !== 'Paid') html += '<button onclick="markQuotePaid(' + q.id + ')" style="background:#1b7a3d;color:white;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:bold;cursor:pointer;">&#128179; Mark Paid</button>';
                if (q.invoice_status === 'Paid') html += '<button onclick="showQuoteReceipt(' + q.id + ')" style="background:#185FA5;color:white;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:bold;cursor:pointer;">&#129534; Receipt</button>';
                if (st === 'Accepted') {
                    html += '<button onclick="quoteInvoice(' + q.id + ', this)" style="background:#1f7a3d;color:white;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:bold;cursor:pointer;">🧾 Print Invoice</button>';
                }
                if (st === 'Pending') {
                    html += '<button onclick="updateQuoteStatus(' + q.id + ', \'Accepted\')" style="background:var(--pass-green);color:white;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:bold;cursor:pointer;">Mark Accepted</button>';
                    html += '<button onclick="updateQuoteStatus(' + q.id + ', \'Declined\')" style="background:var(--fail-red);color:white;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:bold;cursor:pointer;">Mark Declined</button>';
                }
                if (needsFollowUp) {
                    html += '<button onclick="sendQuoteReminder(' + q.id + ', this)" style="background:var(--maint-orange);color:white;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:bold;cursor:pointer;">&#128276; ' + (q.reminder_sent ? 'Send Reminder Again' : 'Send Follow-up Reminder') + '</button>';
                }
                html += '</div>';
                html += '</div>';
            });
            resultsDiv.innerHTML = html;
        })
        .catch(err => { resultsDiv.innerHTML = '<p style="color:#e74c3c;text-align:center;">Error: ' + escapeHtml(err.message) + '</p>'; });
        }, function() { resultsDiv.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">PIN required to load Sales Pipeline.</p>'; });
    }

    // ============================================================
    // SHORTAGE TRENDS (Managers)
    // ============================================================
    let shortageTrendsDaysFilter = 30;

    function openShortageTrends() {
        triggerTransition(() => {
            document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
            document.getElementById('shortageTrendsView').style.display = 'block';
            fetchShortageTrends();
        });
    }

    function openFormsLinks() {
        const isMgr = currentUser && (currentUser.role === 'Manager' || currentUser.role === 'Admin Manager' || currentUser.role === 'Vice President/Co-Owner' || currentUser.is_developer === true);
        document.querySelectorAll('.forms-mgr-only').forEach(el => { el.style.display = isMgr ? 'block' : 'none'; });
        triggerTransition(() => {
            document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
            document.getElementById('formsLinksView').style.display = 'block';
        });
    }

    function fetchShortageTrends() {
        const resultsDiv = document.getElementById('shortageTrendsResults');
        const summaryDiv = document.getElementById('shortageTrendsSummary');
        const filtersDiv = document.getElementById('shortageTrendsFilters');
        resultsDiv.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">Loading shortage trends...</p>';

        // Filters (render immediately so they're clickable while loading)
        const dayOptions = [{ label: '7 Days', val: 7 }, { label: '30 Days', val: 30 }, { label: '90 Days', val: 90 }, { label: 'All Time', val: 0 }];
        let filterHtml = '';
        dayOptions.forEach(opt => {
            const active = (shortageTrendsDaysFilter === opt.val);
            filterHtml += '<button onclick="shortageTrendsDaysFilter=' + opt.val + ';fetchShortageTrends();" style="border:none;border-radius:20px;padding:6px 14px;font-size:12px;font-weight:bold;cursor:pointer;background:' + (active ? 'var(--pass-green)' : '#eee') + ';color:' + (active ? 'white' : '#555') + ';">' + opt.label + '</button>';
        });
        filtersDiv.innerHTML = filterHtml;

        withPin(function(pin) {
        supabaseClient.rpc('app_manager_shortage_trends', { p_username: currentUser.username, p_password: pin })
        .then(({ data, error }) => {
            if (error && error.code === '42501') sessionPin = null;
            if (error) { resultsDiv.innerHTML = '<p style="color:#e74c3c;text-align:center;">Error loading shortages: ' + escapeHtml(error.message) + '</p>'; return; }
            if (!data || data.length === 0) {
                summaryDiv.innerHTML = '';
                resultsDiv.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">No shortage reports yet.</p>';
                return;
            }

            // Apply date filter (based on OrderDate, falling back to created_at)
            let filtered = data;
            if (shortageTrendsDaysFilter > 0) {
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - shortageTrendsDaysFilter);
                filtered = data.filter(row => {
                    const dateStr = row.OrderDate || row.created_at;
                    if (!dateStr) return true;
                    const d = new Date(dateStr);
                    return !isNaN(d) && d >= cutoff;
                });
            }

            if (filtered.length === 0) {
                summaryDiv.innerHTML = '';
                resultsDiv.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">No shortage reports in this time range.</p>';
                return;
            }

            // Aggregate items and stores
            const itemMap = {};
            const storeMap = {};
            filtered.forEach(row => {
                const store = (row.Store || 'Unknown').toString().trim();
                storeMap[store] = (storeMap[store] || 0) + 1;
                [1, 2].forEach(i => {
                    const rawName = (row['Item' + i] || '').toString().trim();
                    if (!rawName) return;
                    const key = rawName.toLowerCase();
                    const qty = (row['Qty' + i] || '').toString().trim();
                    if (!itemMap[key]) itemMap[key] = { label: rawName, count: 0, stores: {}, qtys: [] };
                    itemMap[key].count++;
                    itemMap[key].stores[store] = (itemMap[key].stores[store] || 0) + 1;
                    if (qty) itemMap[key].qtys.push(qty);
                });
            });

            const sortedItems = Object.values(itemMap).sort((a, b) => b.count - a.count);
            const sortedStores = Object.entries(storeMap).sort((a, b) => b[1] - a[1]);
            const topItem = sortedItems[0];
            const topStore = sortedStores[0];

            // Summary cards
            let summaryHtml = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:15px;">';
            summaryHtml += '<div style="flex:1;min-width:120px;background:var(--pass-green);color:white;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:22px;font-weight:900;">' + filtered.length + '</div><div style="font-size:12px;text-transform:uppercase;opacity:.9;">Shortage Reports</div></div>';
            summaryHtml += '<div style="flex:1;min-width:120px;background:var(--caliches-blue);color:white;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:18px;font-weight:900;">' + (topItem ? escapeHtml(topItem.label) : '&mdash;') + '</div><div style="font-size:12px;text-transform:uppercase;opacity:.9;">Most Requested Item' + (topItem ? ' (' + topItem.count + 'x)' : '') + '</div></div>';
            summaryHtml += '<div style="flex:1;min-width:120px;background:var(--maint-orange);color:white;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:18px;font-weight:900;">' + (topStore ? escapeHtml(topStore[0]) : '&mdash;') + '</div><div style="font-size:12px;text-transform:uppercase;opacity:.9;">Top Reporting Store' + (topStore ? ' (' + topStore[1] + 'x)' : '') + '</div></div>';
            summaryHtml += '</div>';

            // Store breakdown chips
            summaryHtml += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:15px;justify-content:center;">';
            sortedStores.forEach(([store, count]) => {
                summaryHtml += '<div style="background:#e8f5e9;color:var(--pass-green);border:1px solid var(--pass-green);border-radius:20px;padding:6px 14px;font-size:12px;font-weight:bold;">' + escapeHtml(store) + ': ' + count + '</div>';
            });
            summaryHtml += '</div>';
            summaryDiv.innerHTML = summaryHtml;

            // Top items list
            let html = '<div class="maint-card" style="border-left-color:var(--pass-green);"><div class="maint-card-title" style="margin-bottom:10px;">&#128200; Most Requested Items</div>';
            sortedItems.slice(0, 15).forEach((item, idx) => {
                const storeList = Object.entries(item.stores).sort((a, b) => b[1] - a[1]).map(([s, c]) => escapeHtml(s) + (c > 1 ? ' (' + c + 'x)' : '')).join(', ');
                html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;' + (idx < sortedItems.length - 1 && idx < 14 ? 'border-bottom:1px solid #eee;' : '') + '">';
                html += '<div><div style="font-weight:bold;">' + escapeHtml(item.label) + '</div><div class="maint-card-meta">Requested by: ' + storeList + '</div></div>';
                html += '<div style="background:var(--pass-green);color:white;border-radius:20px;padding:4px 12px;font-size:12px;font-weight:bold;white-space:nowrap;">' + item.count + 'x</div>';
                html += '</div>';
            });
            html += '</div>';
            resultsDiv.innerHTML = html;
        })
        .catch(err => { resultsDiv.innerHTML = '<p style="color:#e74c3c;text-align:center;">Error: ' + escapeHtml(err.message) + '</p>'; });
        }, function() { resultsDiv.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">PIN required to load shortage trends.</p>'; });
    }

        // ============================================================
        // IN-APP NOTIFICATIONS (replaces email alerts to managers)
        // ============================================================
        let notifPollTimer = null;
        let lastSeenNotifId = null;
        let notifBannerTimer = null;
        let notifBannerLink = null;

        function lsGet(k,d){try{var v=localStorage.getItem(k);return v===null?d:v;}catch(e){return d;}}
        function lsSet(k,v){try{localStorage.setItem(k,v);}catch(e){}}
        function escapeHtml(str) {
            if (str === null || str === undefined) return "";
            return String(str)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }

        /* ---- Messages unread badge (red dot on the 💬 button + More tab) ----
           Derived from RPCs that already exist: app_dm_threads (per-thread unread) +
           app_announce_feed (per-item read flag). No new RPC. Never prompts for PIN —
           it rides the same 60s notifications tick and skips when no PIN is cached. */
        function msgBadgeEnsure() {
            try {
                var b = document.getElementById('topMessagesBtn');
                if (b && !document.getElementById('msgUnreadDot')) {
                    b.style.position = 'relative';
                    var s = document.createElement('span'); s.id = 'msgUnreadDot';
                    s.style.cssText = 'position:absolute;top:-4px;right:-4px;background:#e0245e;color:#fff;border-radius:99px;min-width:16px;height:16px;font-size:10px;line-height:16px;font-weight:800;display:none;text-align:center;padding:0 3px;box-sizing:border-box;pointer-events:none;';
                    b.appendChild(s);
                }
                var m = document.getElementById('hbn-more');
                if (m && !document.getElementById('msgUnreadDotMore')) {
                    m.style.position = 'relative';
                    var s2 = document.createElement('span'); s2.id = 'msgUnreadDotMore';
                    s2.style.cssText = 'position:absolute;top:4px;right:26%;background:#e0245e;border-radius:99px;width:9px;height:9px;display:none;pointer-events:none;';
                    m.appendChild(s2);
                }
            } catch(e) {}
        }
        function msgBadgeRender(n) {
            try {
                msgBadgeEnsure();
                var d = document.getElementById('msgUnreadDot');
                if (d) { d.style.display = n > 0 ? 'block' : 'none'; d.textContent = n > 9 ? '9+' : String(n || ''); }
                var m = document.getElementById('msgUnreadDotMore');
                if (m) m.style.display = n > 0 ? 'block' : 'none';
            } catch(e) {}
        }
        function msgBadgeTick() {
            try {
                if (!currentUser || !currentUser.username) return;
                if (!notifHasCachedPin()) return; /* silent: never pop the PIN prompt from a poll */
                withPin(function(pin) {
                    var u = { p_username: currentUser.username, p_password: pin };
                    Promise.all([
                        supabaseClient.rpc('app_dm_threads', u).then(function(r){ return r.error ? null : r.data; }).catch(function(){ return null; }),
                        supabaseClient.rpc('app_announce_feed', u).then(function(r){ return r.error ? null : r.data; }).catch(function(){ return null; })
                    ]).then(function(res) {
                        var n = 0;
                        ((res[0] && res[0].threads) || []).forEach(function(t){ n += (parseInt(t.unread, 10) || 0); });
                        ((res[1] && res[1].items) || []).forEach(function(a){ if (!a.read) n++; });
                        msgBadgeRender(n);
                    }).catch(function(){});
                }, function(){});
            } catch(e) {}
        }
        function msgBadgeClear() {
            try { lsSet('calichesMsgsSeenAt', String(Date.now())); } catch(e) {}
            msgBadgeRender(0);
        }

        function setupNotifications() {
            const isManager = (currentUser.role === 'Admin Manager' || currentUser.role === 'Manager' || currentUser.role === 'Store Manager' || currentUser.role === 'Vice President/Co-Owner');
            const wrap = document.getElementById('notifBellWrap');
            if (!wrap) return;

            if (!isManager) {
                wrap.style.display = "none";
                /* Non-managers keep the same single 60s tick, but it only refreshes the
                   Messages unread badge (guarded on cached PIN — never prompts). */
                try { msgBadgeTick(); } catch(e) {}
                if (notifPollTimer) clearInterval(notifPollTimer);
                notifPollTimer = setInterval(function(){ try { msgBadgeTick(); } catch(e) {} }, 60000);
                return;
            }

            wrap.style.display = "block";
            fetchNotifications(true);
            try { msgBadgeTick(); } catch(e) {}

            if (notifPollTimer) clearInterval(notifPollTimer);
            notifPollTimer = setInterval(function(){ fetchNotifications(true); try { msgBadgeTick(); } catch(e) {} }, 60000);
        }

        function notifHasCachedPin() {
            if (sessionPin) return true;
            try { return localStorage.getItem('calichesKeep') !== '0' && !!sessionStorage.getItem('calichesPin'); } catch(e) { return false; }
        }

        function fetchNotifications(silentPoll) {
            /* Background polling must never pop the native PIN prompt — skip silently
               when no PIN is cached. Only a manual bell tap (no flag) may prompt. */
            if (silentPoll && !notifHasCachedPin()) return;
            withPin(function(pin) {
                supabaseClient.rpc('app_admin_notifications_list', { p_admin_username: currentUser.username, p_admin_password: pin })
                    .then(({ data, error }) => {
                        if (error && error.code === '42501') sessionPin = null;
                        if (error) {
                            console.error('[Notifications] fetch error:', error);
                            return;
                        }
                        renderNotifications(data || []);
                    })
                    .catch(err => console.error('[Notifications] network error:', err));
            }, function() {});
        }

        // ---- Sound: drive-thru style "ding-ding" bell ----
        function playNotifSound() {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const now = ctx.currentTime;
                [0, 0.22].forEach((offset) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.value = 1318.51; // E6 bell tone
                    gain.gain.setValueAtTime(0.0001, now + offset);
                    gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.01);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.6);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now + offset);
                    osc.stop(now + offset + 0.6);
                });
            } catch (e) { console.error('[Notifications] sound error:', e); }
        }

        // ---- App icon badge (PWA Badging API) ----
        function updateAppBadge(count) {
            if (!('setAppBadge' in navigator)) return;
            try {
                if (count > 0) navigator.setAppBadge(count); else navigator.clearAppBadge();
            } catch (e) { /* ignore unsupported */ }
        }

        // ---- Top banner ----
        function showNotifBanner(item) {
            const banner = document.getElementById('notifTopBanner');
            if (!banner) return;
            banner.innerHTML = '<span class="notif-banner-title">New Notification</span>' + escapeHtml(item.title || 'Notification');
            notifBannerLink = item.id;
            banner.classList.add('show');
            if (notifBannerTimer) clearTimeout(notifBannerTimer);
            notifBannerTimer = setTimeout(() => { banner.classList.remove('show'); }, 6000);
        }

        function handleTopBannerClick() {
            const banner = document.getElementById('notifTopBanner');
            if (banner) banner.classList.remove('show');
            if (notifBannerTimer) { clearTimeout(notifBannerTimer); notifBannerTimer = null; }
            toggleNotifPanel();
        }

        function renderNotifications(items) {
            const panel = document.getElementById('notifPanel');
            const badge = document.getElementById('notifBadge');
            if (!panel || !badge) return;

            // Detect newly-arrived notifications (for sound + banner)
            if (items.length > 0) {
                const maxId = Math.max.apply(null, items.map(n => n.id));
                if (lastSeenNotifId === null) {
                    lastSeenNotifId = maxId;
                } else if (maxId > lastSeenNotifId) {
                    const newest = items.filter(n => n.id > lastSeenNotifId).sort((a,b) => b.id - a.id)[0];
                    playNotifSound();
                    if (newest) showNotifBanner(newest);
                    lastSeenNotifId = maxId;
                }
            }

            const unreadCount = items.filter(n => !n.is_read).length;
            if (unreadCount > 0) {
                badge.innerText = unreadCount > 99 ? '99+' : unreadCount;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
            updateAppBadge(unreadCount);

            let html = '<div class="notif-panel-header"><span>Notifications</span>' +
                (items && items.length ? '<button class="notif-clear-all" onclick="clearAllNotifications(event)">Clear All</button>' : '') +
                '</div>';

            if (!items || items.length === 0) {
                html += '<div class="notif-empty">No notifications yet.</div>';
                panel.innerHTML = html;
                return;
            }

            html += items.map(n => {
                const date = n.created_at ? new Date(n.created_at).toLocaleString() : '';
                const pdfLink = (n.pdf_url && n.pdf_url.indexOf('http') === 0)
                    ? `<br><a href="${escapeHtml(n.pdf_url)}" target="_blank" onclick="event.stopPropagation();">View PDF</a>`
                    : '';
                const meta = [n.location, date].filter(Boolean).map(escapeHtml).join(' \u00b7 ');
                return `<div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="markNotificationRead(${n.id})">
                    <button class="notif-dismiss" title="Clear" onclick="dismissNotification(${n.id}, event)">&times;</button>
                    <div class="notif-title">${escapeHtml(n.title || 'Notification')}</div>
                    <div>${escapeHtml(n.message || '')}</div>
                    ${pdfLink}
                    <div class="notif-meta">${meta}</div>
                </div>`;
            }).join('');

            panel.innerHTML = html;
        }

        function toggleNotifPanel() {
            const panel = document.getElementById('notifPanel');
            if (!panel) return;
            const isOpen = panel.style.display === 'block';
            if (!isOpen) {
                const bell = document.querySelector('.notif-bell');
                if (bell) {
                    const rect = bell.getBoundingClientRect();
                    panel.style.top = (rect.bottom + 8) + 'px';
                }
                fetchNotifications();
            }
            panel.style.display = isOpen ? 'none' : 'block';
        }

        function markNotificationRead(id) {
            withPin(function(pin) {
                supabaseClient.rpc('app_admin_notification_mark_read', { p_admin_username: currentUser.username, p_admin_password: pin, p_id: id })
                    .then(({ error }) => {
                        if (error && error.code === '42501') sessionPin = null;
                        if (error) console.error('[Notifications] mark read error:', error);
                        fetchNotifications();
                    })
                    .catch(err => console.error('[Notifications] network error:', err));
            }, function() {});
        }

        function dismissNotification(id, event) {
            if (event) event.stopPropagation();
            withPin(function(pin) {
                supabaseClient.rpc('app_admin_notification_dismiss', { p_admin_username: currentUser.username, p_admin_password: pin, p_id: id })
                    .then(({ error }) => {
                        if (error && error.code === '42501') sessionPin = null;
                        if (error) console.error('[Notifications] dismiss error:', error);
                        fetchNotifications();
                    })
                    .catch(err => console.error('[Notifications] network error:', err));
            }, function() {});
        }

        function clearAllNotifications(event) {
            if (event) event.stopPropagation();
            withPin(function(pin) {
                supabaseClient.rpc('app_admin_notifications_clear_all', { p_admin_username: currentUser.username, p_admin_password: pin })
                    .then(({ error }) => {
                        if (error && error.code === '42501') sessionPin = null;
                        if (error) console.error('[Notifications] clear all error:', error);
                        fetchNotifications();
                    })
                    .catch(err => console.error('[Notifications] network error:', err));
            }, function() {});
        }

        // ============================================================
        // KNOWLEDGE BASE
        // ============================================================
        function renderScoopyTrainPrompt(){
            var card=document.getElementById('scoopyTrainCard'); if(!card) return;
            if(!(typeof isAdminManager==='function' && isAdminManager())){ card.style.display='none'; return; }
            supabaseClient.rpc('get_knowledge_base').then(function(r){
                if(r.error||!r.data){ return; }
                var pending=r.data.filter(function(row){ return String(row.category||'').indexOf('HR Policy')===0 && !(row.answer && String(row.answer).trim()); }).length;
                if(pending<=0){ card.style.display='none'; return; }
                card.style.display='block';
                card.innerHTML='<div onclick="openKnowledgeBase()" style="cursor:pointer;background:linear-gradient(135deg,#fff0d6,#ffe2ad);border:1px solid #e9b84e;border-radius:14px;padding:14px 16px;margin:2px 0 14px;display:flex;align-items:center;gap:12px;">'+
                    '<img src="scoopy-point.png" onerror="this.style.display=\'none\'" style="height:46px;">'+
                    '<div style="flex:1;"><div style="font-weight:800;color:#8a5a00;font-size:14.5px;">Help train Mr. Scoopy</div>'+
                    '<div style="font-size:12.5px;color:#8a5a00;">'+pending+' HR question'+(pending===1?'':'s')+' waiting for your answer &rarr;</div></div></div>';
            }).catch(function(){});
        }
        function openKnowledgeBase() {
            closeScoopyOnboarding();
            triggerTransition(() => {
                document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
                document.getElementById('kbView').style.display = 'block';
                loadKnowledgeBase();
            });
        }

        function showScoopyOnboarding() {
            // Don't show once KB has been completed at least once
            if (localStorage.getItem('scoopy_kb_completed')) return;
            // Respect "Maybe Later" snooze (3 days)
            const snoozed = localStorage.getItem('scoopy_kb_snoozed');
            if (snoozed && (Date.now() - parseInt(snoozed)) < 3*24*60*60*1000) return;
            const modal = document.getElementById('scoopyOnboardingModal');
            if (modal) modal.style.display = 'flex';
        }

        function closeScoopyOnboarding() {
            const modal = document.getElementById('scoopyOnboardingModal');
            if (modal) modal.style.display = 'none';
        }

        function scoopyOnboardingGo() { openKnowledgeBase(); }

        function scoopyOnboardingLater() {
            closeScoopyOnboarding();
            localStorage.setItem('scoopy_kb_snoozed', Date.now().toString());
        }

        // -- APP HOW-TO TOUR (role-aware first-launch walkthrough) --
        var appTourSteps = [];
        var appTourIdx = 0;

        function buildAppTourSteps() {
            var name = (currentUser && currentUser.name) ? currentUser.name.split(' ')[0] : 'there';
            var steps = [
                { img:'scoopy-wave.png', title:'Welcome to the Hub, ' + name + '! \uD83C\uDF66',
                  body:"This is Caliche's Operations Hub \u2014 your one place for shifts, clocking in, daily tasks, checklists, messages, and reports. This quick tour shows you where everything lives. Tap Next to begin!" },
                { img:'scoopy-point.png', title:'Getting around',
                  body:"Use the sections in the More menu: \uD83C\uDFE0 Home, \uD83D\uDCC5 Schedule, \uD83C\uDF66 Work, \uD83E\uDD1D Team, and (for managers) \u26A1 Admin. The Home tab also has quick-tap cards for the things you use most." },
                { img:'scoopy-hero.png', title:'Your Home base',
                  body:"Tap \uD83C\uDFE0 My Home to see your upcoming shifts, any tasks assigned to you, and team updates. Check it at the start of every shift so nothing slips by." },
                { img:'scoopy-thumbsup.png', title:'Clocking in & out',
                  body:"Go to Schedule \u2192 \u23F1\uFE0F Time Clock to clock in and out. Your ID is the last 4 digits of your SSN. Clock in within 5 minutes of your shift start (or when a manager tells you to)." },
                { img:'scoopy-point.png', title:'Requesting time off',
                  body:"Schedule \u2192 \uD83C\uDF34 Request Time Off. Submit at least 14 days ahead and always include a reason. You'll see your requests update once a manager reviews them." },
                { img:'scoopy-cheer.png', title:'Daily store tasks',
                  body:"In Work you'll find \u2705 Shift Checklists (open/close/clean), \uD83C\uDF21\uFE0F Temperature Logs, \uD83D\uDCE6 Inventory Count, the Store Pop-In, and \uD83D\uDE9A Supply Request. 'My Submissions' keeps a record of everything you've turned in." },
                { img:'scoopy-hero.png', title:'Trucks, trailers & catering',
                  body:"In Work's \uD83D\uDE9A Vending & Catering section, do the Vehicle & Trailer Check-Out before you drive. See something broken? File \uD83D\uDD27 Report a Repair, or report \u26A0\uFE0F Vehicle / Trailer Damage with photos." },
                { img:'scoopy-wave2.png', title:'Messages',
                  body:"Tap the \uD83D\uDCAC Messages card on Home for team chat and broadcasts from the office. It's the fastest way to reach your team and stay in the loop." },
                { img:'scoopy-point.png', title:'Forms & Documents',
                  body:"Need a payroll, HR, or hiring form? Tap \uD83D\uDCC4 Forms & Documents in Team for direct links to everything \u2014 W-4/I-9, direct deposit, applications and more." },
                { img:'cherry-peace.png', title:'Report a Concern \uD83D\uDD12',
                  body:"Something not right? Open \uD83D\uDCAC Your Voice (Team) and choose Report a Concern to confidentially report harassment or misconduct. It goes straight to the Admin Managers \u2014 not your store manager \u2014 and you can even submit it anonymously." },
                { img:'scoopy-thumbsup.png', title:'Ask Mr. Scoopy anytime \uD83C\uDF66',
                  body:"See the floating \uD83C\uDF66 Ask Mr. Scoopy button in the corner of every screen? Tap it to ask about store policies, recipes, or how to use the Hub. I'm always here to help!" }
            ];
            if (typeof isManagerRole === 'function' && isManagerRole()) {
                steps.push(
                    { img:'scoopy-cheer.png', title:'Manager: Build the schedule',
                      body:"Schedule \u2192 \uD83E\uDD4F Open Schedule Builder to build and publish the weekly shifts. Schedules post one week in advance." },
                    { img:'scoopy-point.png', title:'Manager: Approvals & tasks',
                      body:"Review \uD83D\uDCC5 Time-Off & Swap Approvals, send work with \uD83D\uDCCB Assign Task, and check \uD83D\uDCCA Timesheets for hours and overtime \u2014 all in the Schedule tab." },
                    { img:'scoopy-hero.png', title:'Manager: Oversight tools',
                      body:"Team has \u26A0\uFE0F Disciplinary Actions and \uD83D\uDCC5 Attendance & Call-outs; Work has \uD83D\uDEE0 Work Orders. In Work's vending section you can \uD83D\uDCDD Create a Catering Quote and track leads in the Sales Pipeline." },
                    { img:'scoopy-thumbsup.png', title:'Manager: Admin',
                      body:"The \u26A1 Admin tab brings together \uD83D\uDCCA Dashboards (Live, Command Center, Manager, Scorecards & Maintenance in one place), Daily Sales & Labor, and Weekly Prime Cost. The Employee Roster now lives in Team." },
                    { img:'scoopy-wave.png', title:'Admin: Teach Mr. Scoopy',
                      body:"Admins can open \uD83E\uDDE0 Teach Mr. Scoopy (\u26A1 Admin) to add answers to the Knowledge Base. The more you teach me, the better I help the whole team." },
                    { img:'scoopy-point.png', title:'Manager: Attendance & call-outs',
                      body:"Team \u2192 \uD83D\uDCC5 Attendance & Call-outs. Tap 'Mark called out' to log a call-in, tardy, or early-out \u2014 it builds each employee's attendance record and flags patterns like repeat same-day absences." },
                    { img:'scoopy-cheer.png', title:'Manager: Disciplinary, step by step',
                      body:"\u26A0\uFE0F Disciplinary Actions follows the progressive path \u2014 Verbal \u2192 Written \u2192 Write-up. Pick the form, capture statements and signatures, and submitting notifies that employee's store managers and opens a follow-up task. Termination is a separate, Admin-only assessment." },
                    { img:'cherry-thumbsup.png', title:'Celebrations \uD83C\uDF89',
                      body:"Admin Dashboard \u2192 \uD83C\uDF89 Celebrations shows upcoming birthdays and work anniversaries. Admin Managers can also hand out a custom achievement \u2014 the employee gets a fun mascot pop-up next time they open the Hub." },
                    { img:'scoopy-point.png', title:'Admin: Start dates & birthdays',
                      body:"On the Employee Roster, open any employee's Edit to set their Start date (back-date it for staff who started before the app) and Birthday. Those power the automatic anniversary and birthday celebrations \u2014 and birthdays are visible to Admin Managers only." }
                );
            }
            appTourSteps = steps;
        }

        function renderAppTourStep() {
            var s = appTourSteps[appTourIdx];
            if (!s) return;
            var img = document.getElementById('appTourImg');
            if (img) { img.src = s.img; }
            document.getElementById('appTourTitle').innerHTML = s.title;
            document.getElementById('appTourBody').innerHTML = s.body;
            document.getElementById('appTourCounter').innerText = 'Step ' + (appTourIdx + 1) + ' of ' + appTourSteps.length;
            var back = document.getElementById('appTourBack');
            if (back) back.style.visibility = (appTourIdx === 0) ? 'hidden' : 'visible';
            var next = document.getElementById('appTourNext');
            if (next) next.innerHTML = (appTourIdx === appTourSteps.length - 1) ? "Got it! \uD83C\uDF66" : 'Next';
            var dots = document.getElementById('appTourDots');
            if (dots) {
                var h = '';
                for (var i = 0; i < appTourSteps.length; i++) {
                    var on = (i === appTourIdx);
                    h += '<span style="width:' + (on ? '20px' : '7px') + ';height:7px;border-radius:99px;background:' + (on ? 'var(--caliches-pink)' : '#dfe4ea') + ';transition:all .2s;"></span>';
                }
                dots.innerHTML = h;
            }
        }

        function appTourNext() {
            if (appTourIdx >= appTourSteps.length - 1) { finishAppTour(); return; }
            appTourIdx++; renderAppTourStep();
        }
        function appTourPrev() {
            if (appTourIdx > 0) { appTourIdx--; renderAppTourStep(); }
        }
        function finishAppTour() {
            var m = document.getElementById('appTourModal');
            if (m) m.style.display = 'none';
            localStorage.setItem('app_tour_completed', '1');
        }
        function skipAppTour() {
            var m = document.getElementById('appTourModal');
            if (m) m.style.display = 'none';
            localStorage.setItem('app_tour_completed', '1');
        }
        // On launch: tour on first run, then hand off to the Scoopy "Teach me" nudge.
        function showAppTour() {
            // "How to Use the Hub" tour is still in progress - NOT released to users yet.
            // Auto-popup disabled; falls back to prior onboarding. Re-enable when ready.
            if (typeof showScoopyOnboarding === 'function') showScoopyOnboarding();
            return;
        }
        function openAppTour() {
            buildAppTourSteps();
            appTourIdx = 0;
            renderAppTourStep();
            var m = document.getElementById('appTourModal');
            if (m) m.style.display = 'flex';
        }


        // ── AI GAP TRACKING ──────────────────────────────────────────
        async function logScoopyGap(userQuestion) {
            // Format as a clear KB question and insert into Supabase
            const kbQ = 'How should we respond when staff asks: "' + userQuestion + '"?';
            try {
                const { data, error } = await supabaseClient.rpc('insert_kb_question', {
                    p_question: kbQ,
                    p_category: 'Employee Questions'
                });
                if (!error && data === true) {
                    // New question inserted — increment badge count
                    const n = parseInt(localStorage.getItem('scoopy_gap_count') || '0') + 1;
                    localStorage.setItem('scoopy_gap_count', n.toString());
                    updateScoopyGapBadge();
                    showDraftToast('📚 Added to Mr. Scoopy\'s learning queue!');
                }
            } catch(e) { console.log('[Scoopy gap]', e); }
        }

        function updateScoopyGapBadge() {
            const kbBtn = document.getElementById('knowledgeBaseBtn');
            if (!kbBtn) return;
            const n = parseInt(localStorage.getItem('scoopy_gap_count') || '0');
            let badge = document.getElementById('kbGapBadge');
            if (n > 0) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.id = 'kbGapBadge';
                    badge.style.cssText = 'background:var(--caliches-pink);color:#fff;font-size:10px;font-weight:900;border-radius:99px;padding:2px 8px;margin-left:8px;vertical-align:middle;display:inline-block;';
                    kbBtn.appendChild(badge);
                }
                badge.innerText = n + ' new';
            } else if (badge) {
                badge.remove();
            }
        }

        function loadKnowledgeBase() {
            // Clear gap badge when KB is opened
            localStorage.removeItem('scoopy_gap_count');
            updateScoopyGapBadge();

            const container = document.getElementById('kbContent');
            container.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">Loading questions...</p>';
            supabaseClient.rpc('get_knowledge_base')
            .then(({ data, error }) => {
                if (error) { container.innerHTML = '<p style="text-align:center;padding:30px;color:#c00;">Failed to load. Please try again.</p>'; return; }
                if (!data || data.length === 0) { container.innerHTML = '<p style="text-align:center;padding:30px;color:#6b7686;">No questions found.</p>'; return; }
                // Group by category
                const byCategory = {};
                data.forEach(row => {
                    const cat = row.category || 'General';
                    if (!byCategory[cat]) byCategory[cat] = [];
                    byCategory[cat].push(row);
                });
                let html = '';
                Object.keys(byCategory).sort().forEach(cat => {
                    html += '<div class="kb-category">';
                    html += '<div class="kb-category-title"><span class="kb-cat-text">' + escapeHtml(cat) + '</span><span class="kb-cat-line"></span></div>';
                    byCategory[cat].forEach(row => {
                        const updated = row.updated_at ? new Date(row.updated_at).toLocaleDateString() : '';
                        html += '<div class="kb-item" id="kb-item-' + row.id + '">';
                        html += '<div class="kb-question">' + escapeHtml(row.question) + '</div>';
                        html += '<textarea class="kb-textarea" id="kb-ta-' + row.id + '" placeholder="Add answer here...">' + escapeHtml(row.answer || '') + '</textarea>';
                        if (updated) html += '<div class="kb-updated">Last updated: ' + updated + '</div>';
                        html += '<button class="kb-save-btn" onclick="saveKBAnswer(' + row.id + ')">&#128190; Save</button>';
                        html += '<span class="kb-saved-label" id="kb-saved-' + row.id + '">&#10003; Saved!</span>';
                        html += '</div>';
                    });
                    html += '</div>';
                });
                container.innerHTML = html;
            }).catch(err => { container.innerHTML = '<p style="text-align:center;padding:30px;color:#c00;">Error loading.</p>'; });
        }

        function saveKBAnswer(id) {
            const ta = document.getElementById('kb-ta-' + id);
            const btn = ta ? ta.parentElement.querySelector('.kb-save-btn') : null;
            const label = document.getElementById('kb-saved-' + id);
            if (!ta) return;
            const answer = ta.value.trim();
            if (btn) { btn.disabled = true; btn.innerText = 'Saving...'; }
            withPin(function(pin) {
                supabaseClient.rpc('app_kb_save_answer', { p_username: currentUser.username, p_password: pin, p_id: id, p_answer: answer })
                .then(({ data, error }) => {
                    if (error && error.code === '42501') sessionPin = null;
                    if (error) { alert('Save failed: ' + error.message); }
                    else { if (label) { label.style.display = 'inline'; setTimeout(() => label.style.display = 'none', 2500); } }
                    if (btn) { btn.disabled = false; btn.innerText = '💾 Save'; }
                }).catch(() => { if (btn) { btn.disabled = false; btn.innerText = '💾 Save'; } });
            }, function() { if (btn) { btn.disabled = false; btn.innerText = '💾 Save'; } });
        }


// ── Catering: manual Mark Paid + printable Receipt (added for Square paid-status) ──
window.markQuotePaid = function(id){
  var q = (window._qCache||{})[id] || {};
  var amt = prompt('Amount received for '+(q.company||q.contact_name||('quote #'+id))+'?\nLeave blank to use the quote total ($'+(Number(q.total)||0).toFixed(2)+').');
  if (amt === null) return; // cancelled
  var method = prompt('Payment method? (Square, Cash, Card, Check, Other)', 'Square');
  if (method === null) return;
  var ref = prompt('Reference / confirmation # (optional):', '') || '';
  withPin(function(pin){
    supabaseClient.rpc('app_quote_mark_paid_manual', {
      p_username: currentUser.username, p_password: pin, p_id: id,
      p_amount: amt.trim()===''? null : (parseFloat(amt)||null),
      p_method: method || 'Manual', p_reference: ref
    }).then(function(r){
      if (r.error){ alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers/office only.':r.error.message); return; }
      alert('Marked paid. A receipt is now available on this quote.');
      // H1 fix: this used to call loadSalesPipeline()/searchCustomerHistory(), neither of
      // which exists anywhere in the codebase (dead reference), so the pipeline never
      // refreshed after a successful Mark Paid. fetchSalesPipeline() is the real pipeline
      // loader (see openSalesPipeline/updateQuoteStatus/sendSquareInvoice above), matching
      // how every other successful-save action here refreshes the view.
      if (typeof fetchSalesPipeline==='function') fetchSalesPipeline();
    }).catch(function(){ alert('Connection error.'); });
  });
};

window.showQuoteReceipt = function(id){
  var q = (window._qCache||{})[id];
  if (!q){ alert('Reopen the pipeline and try again.'); return; }
  var esc = (typeof escapeHtml==='function') ? escapeHtml : function(x){return (''+x);};
  var money = function(v){ return '$'+(Number(v)||0).toFixed(2); };
  var items = [];
  try { items = Array.isArray(q.line_items) ? q.line_items : (q.line_items ? JSON.parse(q.line_items) : []); } catch(e){ items = []; }
  var rows = items.map(function(it){
    var name = it.name||it.label||it.item||it.description||'Item';
    var qty  = it.qty||it.quantity||1;
    var line = (it.amount!=null)? it.amount : ((Number(it.price||it.unit||0))*(Number(qty)||1));
    return '<tr><td style="padding:4px 0;">'+esc(name)+' &times; '+esc(qty)+'</td><td style="padding:4px 0;text-align:right;">'+money(line)+'</td></tr>';
  }).join('');
  var paidLine = q.paid_at ? new Date(q.paid_at).toLocaleDateString() : new Date().toLocaleDateString();
  var rc = '<div id="qReceipt" style="font-family:Georgia,serif;color:#222;max-width:420px;margin:0 auto;">'
    + '<div style="text-align:center;border-bottom:2px solid #185FA5;padding-bottom:8px;margin-bottom:10px;">'
    + '<div style="font-size:20px;font-weight:800;color:#185FA5;">Caliche’s Frozen Custard</div>'
    + '<div style="font-size:13px;color:#1b7a3d;font-weight:700;">PAID RECEIPT</div>'
    + '<div style="font-size:11px;color:#666;">'+esc(q.invoice_number||q.order_num||('Quote #'+id))+'</div></div>'
    + '<div style="font-size:12.5px;color:#333;">'
    + '<div><b>Customer:</b> '+esc(q.company||q.contact_name||'')+(q.company&&q.contact_name?(' ('+esc(q.contact_name)+')'):'')+'</div>'
    + (q.event_date?'<div><b>Event:</b> '+esc(q.event_type||'')+' &middot; '+new Date(q.event_date).toLocaleDateString()+'</div>':'')
    + '<div><b>Paid:</b> '+paidLine+(q.payment_method?(' &middot; '+esc(q.payment_method)):'')+(q.payment_reference?(' &middot; ref '+esc(q.payment_reference)):'')+'</div>'
    + '</div>'
    + '<table style="width:100%;border-collapse:collapse;font-size:12.5px;margin-top:10px;border-top:1px solid #e5e5e5;">'+rows+'</table>'
    + '<div style="border-top:1px solid #e5e5e5;margin-top:6px;padding-top:6px;font-size:12.5px;">'
    + (q.subtotal!=null?'<div style="display:flex;justify-content:space-between;"><span>Subtotal</span><span>'+money(q.subtotal)+'</span></div>':'')
    + (q.tax!=null?'<div style="display:flex;justify-content:space-between;"><span>Tax</span><span>'+money(q.tax)+'</span></div>':'')
    + '<div style="display:flex;justify-content:space-between;font-weight:800;font-size:15px;color:#185FA5;margin-top:4px;"><span>Amount Paid</span><span>'+money(q.amount_paid!=null?q.amount_paid:q.total)+'</span></div>'
    + '</div>'
    + '<div style="text-align:center;margin-top:12px;font-size:11px;color:#6b7686;">Thank you for choosing Caliche’s! &middot; Generated '+new Date().toLocaleDateString()+'</div></div>';
  var ov = document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;z-index:100090;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px;';
  ov.onclick=function(e){ if(e.target===ov) document.body.removeChild(ov); };
  ov.innerHTML='<div style="background:#fff;border-radius:14px;padding:20px;max-width:460px;width:100%;max-height:90vh;overflow:auto;">'+rc
    + '<div style="display:flex;gap:8px;margin-top:14px;"><button id="qrClose" style="flex:1;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;">Close</button>'
    + '<button id="qrPrint" style="flex:2;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:800;cursor:pointer;">Print / Save PDF</button></div></div>';
  document.body.appendChild(ov);
  document.getElementById('qrClose').onclick=function(){ document.body.removeChild(ov); };
  document.getElementById('qrPrint').onclick=function(){
    var w=window.open('','_blank'); if(!w){ alert('Allow pop-ups to print.'); return; }
    w.document.write('<html><head><title>Receipt</title></head><body style="margin:20px;">'+rc+'</body></html>');
    w.document.close(); w.focus(); setTimeout(function(){ w.print(); }, 250);
  };
};
