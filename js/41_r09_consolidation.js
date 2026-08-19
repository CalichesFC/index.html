// ============================================================
// R-09 — PARALLEL / DUPLICATE SYSTEM CONSOLIDATION  (js/41_r09_consolidation.js)
// Self-contained, append-only module: it edits NO other file (not index.html,
// not rpc_manifest.json, not any existing js/*). Screen entry is hooked by
// append-only wraps of the global open functions — the same proven pattern as
// js/39_admin_settings_tabs.js (hookOpen/retireOldPermUI).
//
// THE PROBLEM (verified in code + captured schema):
//   Three features exist twice — an old engine and a new one running in
//   parallel — so new data could land in an orphaned table nobody watches.
//
//   1) MAINTENANCE
//      OLD: "Report a Repair" tile (index.html btn-maintenance ->
//           openForm('maintenanceView') -> submitMaintenance(), js/10) writes
//           maintenance_logs via app_form_insert. The old Maintenance Board is
//           already retired (js/05: "Work Orders replaces the Maintenance
//           Board"), yet this intake stayed live for every default user
//           (users.permissions default includes 'maintenance').
//      NEW (system of record): Work Orders (btn-workorders -> openWorkOrders(),
//           js/09) -> app_wo_* -> work_orders (+ costs/events/photos/invoices).
//           js/05:574: "Work Orders is now the single repair flow for all staff".
//   2) SUPPLY REQUESTS
//      OLD: Inventory & Supplies inline "Request" button (js/06 requestInv())
//           -> app_inventory_request -> inventory_orders. No lifecycle, no
//           server-side close (the pending list is trimmed via localStorage).
//           Also the fully orphaned Store Shortage form (submitShortage ->
//           'shortages' table, unreachable per js/10's own audit note).
//      NEW (system of record): Supply Request module (btn-shortage ->
//           openSupplyRequest(), js/10) -> app_supply_* -> supply_requests +
//           supply_request_items, full Submitted->...->Closed lifecycle + CSV.
//   3) CONCERNS
//      OLD: Report-a-Concern view (openHarassReport()/harassSubmit(), js/06)
//           -> app_harassment_create -> harassment_reports. openHarassReport
//           already has NO callers (orphaned), but the functions + view + RPCs
//           remain callable.
//      NEW (system of record): Your Voice 2.0 (btn-report -> openYourVoice(),
//           js/08) -> yv_submit -> yv_cases (ref + access codes, dashboard).
//           js/08:437: "Your Voice 2.0 above is the live system."
//
// WHAT THIS MODULE DOES (client side of the fix; DB side is
// migrations/0006_r09_bridges.sql which mirrors any residual legacy writes
// into the winner tables so nothing is ever orphaned):
//   - Redirects every losing ENTRY point to its winner, with a clear
//     "this has moved" notice (never a dead end: if the winner function is
//     missing for any reason, the original behavior runs unchanged).
//   - Injects a visible "this has moved" banner into the legacy views, so even
//     back-navigation (_navApply 'view:maintenanceView') or a stale bookmark
//     shows the notice.
//   - Carries the user's typed input into the winner form where practical.
//   - Leaves every legacy READ path untouched: My Submissions, the Admin
//     Dashboard "Maintenance Logs" tab, the legacy concern list inside Your
//     Voice, and the old inventory pending-requests list all keep showing old
//     data. Nothing is deleted or hidden.
//
// FAIL-SAFE ABSOLUTELY: every handler is try/caught; every redirect checks the
// winner exists first and otherwise falls through to the original function.
// No new RPCs are called (rpc_manifest.json needs no change for this file).
// ============================================================
(function(){
    'use strict';
    try{ if (typeof window === 'undefined') return; if (window.__r09Consolidated) return; window.__r09Consolidated = true; }catch(e){ return; }

    function byId(id){ try{ return document.getElementById(id); }catch(e){ return null; } }
    function esc(s){ try{ if(typeof escapeHtml==='function') return escapeHtml(s==null?'':String(s)); }catch(e){} return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return '&#'+c.charCodeAt(0)+';'; }); }

    // ---------- floating "this has moved" toast ----------
    var _toastTimer=null;
    function notice(html){
        try{
            var t=byId('r09Toast');
            if(!t){
                t=document.createElement('div'); t.id='r09Toast';
                t.style.cssText='position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:92vw;width:470px;background:#1f2a44;color:#fff;border-radius:12px;padding:13px 42px 13px 16px;font-size:13.5px;line-height:1.5;z-index:100095;box-shadow:0 12px 30px rgba(0,0,0,.35);display:none;box-sizing:border-box;';
                var s=document.createElement('span'); s.id='r09ToastMsg'; t.appendChild(s);
                var x=document.createElement('button'); x.innerHTML='&times;';
                x.style.cssText='position:absolute;top:5px;right:6px;background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:4px 9px;line-height:1;';
                x.onclick=function(){ try{ t.style.display='none'; }catch(e){} };
                t.appendChild(x);
                document.body.appendChild(t);
            }
            var m=byId('r09ToastMsg'); if(m) m.innerHTML=html;
            t.style.display='block';
            if(_toastTimer) clearTimeout(_toastTimer);
            _toastTimer=setTimeout(function(){ try{ t.style.display='none'; }catch(e){} }, 9000);
        }catch(e){}
    }

    // ---------- banner injected into the legacy static views ----------
    function injectBanner(viewId, bannerId, html){
        try{
            if(byId(bannerId)) return;
            var view=byId(viewId); if(!view) return;
            var d=document.createElement('div'); d.id=bannerId;
            d.style.cssText='background:#fff7e6;border:2px solid #e0a13c;border-radius:12px;padding:13px 15px;margin:12px 14px;font-size:13.5px;color:#6b4a00;line-height:1.55;';
            d.innerHTML=html;
            var form=view.querySelector('form');
            if(form && form.parentNode){ form.parentNode.insertBefore(d, form); }
            else {
                var back=view.querySelector('.back-btn');
                if(back && back.nextSibling){ view.insertBefore(d, back.nextSibling); }
                else { view.insertBefore(d, view.firstChild); }
            }
        }catch(e){}
    }
    function bannerBtn(label, onclick){
        return '<button onclick="'+onclick+'" style="display:inline-block;margin-top:8px;background:#185FA5;color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:13px;font-weight:800;cursor:pointer;">'+label+'</button>';
    }

    // ---------- append-only wrap helper (same pattern as js/39 hookOpen) ----------
    function hookFn(fnName, makeWrapper, tries){
        try{
            var orig=null; try{ orig=window[fnName]; }catch(e){}
            if(typeof orig==='function'){
                if(!orig.__r09Wrapped){
                    var w=makeWrapper(orig);
                    w.__r09Wrapped=true;
                    try{ window[fnName]=w; }catch(e){}
                }
                return;
            }
        }catch(e){}
        if((tries||0) < 40){ try{ setTimeout(function(){ hookFn(fnName, makeWrapper, (tries||0)+1); }, 250); }catch(e){} }
    }

    // ---------- deferred field prefill (winner screens render async) ----------
    function prefill(vals, tries){
        try{
            var pending=false;
            for(var id in vals){ if(Object.prototype.hasOwnProperty.call(vals,id)){
                var el=byId(id);
                if(el){ try{ if(vals[id]!=null && vals[id]!=='' && !el.value) el.value=vals[id]; }catch(e){} }
                else pending=true;
            } }
            if(pending && (tries||0)<20){ setTimeout(function(){ prefill(vals,(tries||0)+1); }, 300); }
        }catch(e){}
    }

    // ============================================================
    // 1) MAINTENANCE — legacy Report-a-Repair -> Work Orders
    // ============================================================
    function goWorkOrdersReport(pre){
        try{
            if(typeof window.openWorkOrders!=='function') return false;
            window.openWorkOrders();
            try{ if(typeof _wo!=='undefined' && _wo) _wo.tab='report'; }catch(e){}
            notice('&#128736; <b>Report a Repair has moved.</b> Repairs are now reported and tracked in <b>Work Orders</b> — you are in the right place. Your past reports are still under <b>My Submissions</b>.');
            if(pre){ setTimeout(function(){ prefill(pre,0); }, 400); }
            return true;
        }catch(e){ return false; }
    }

    // --- DAMAGE (maintenance #2, one intake): Vehicle/Trailer/Cart Damage -> Work Orders ---
    // damage_reports is a 0-row orphan store (its old "Report a Repair" sibling already redirects
    // here). Fold it into Work Orders the same way, forcing Type = Damage. Work Orders is strictly
    // more capable for a damage repair (photos, priority, safety flag, assignment, board tracking).
    function goWorkOrdersDamage(pre, carryPhotos){
        try{
            if(typeof window.openWorkOrders!=='function') return false;
            window.openWorkOrders();
            try{ if(typeof _wo!=='undefined' && _wo) _wo.tab='report'; }catch(e){}
            notice('&#9888;&#65039; <b>Damage reports are now Work Orders.</b> Vehicle, trailer &amp; cart damage is logged here (Type: Damage) so it gets photos, a priority, an owner and board tracking. Fill in the details and submit.');
            setTimeout(function(){
                try{ var c=byId('woCat'); if(c) c.value='damage'; }catch(e){}
                if(carryPhotos){
                    try{
                        var ph=null; try{ ph=window.damagePhotos; }catch(e){}
                        if(ph && ph.length && typeof _wo!=='undefined' && _wo){
                            _wo.repPhotos=(_wo.repPhotos||[]).concat(ph.slice());
                            if(typeof woRepPhotoRender==='function') woRepPhotoRender();
                        }
                    }catch(e){}
                }
            }, 500);
            if(pre){ setTimeout(function(){ prefill(pre,0); }, 450); }
            return true;
        }catch(e){ return false; }
    }
    // Read whatever the user typed in the legacy damage form (back-nav / deep-link case) so a
    // submit there carries into the Work Order instead of being lost.
    function damagePrefill(){
        try{
            var f=byId('damageForm'); if(!f) return null;
            var g=function(sel){ var el=f.querySelector(sel); return el?(el.value||''):''; };
            var asset=g('[name="DamageAsset"]'), cause=g('[name="IncidentCause"]'),
                when=g('[name="IncidentDate"]'), desc=g('[name="DamageDescription"]');
            var d=[]; if(cause) d.push('What happened: '+cause); if(when) d.push('Date of incident: '+when); if(desc) d.push(desc);
            return { woItem:asset, woTitle:(asset?('Damage: '+asset):'Damage report'), woDesc:d.join('\n') };
        }catch(e){ return null; }
    }

    hookFn('openForm', function(orig){
        return function(formId){
            try{
                if(formId==='maintenanceView' && goWorkOrdersReport(null)) return;
                if(formId==='damageView' && goWorkOrdersDamage(null,false)) return;
            }catch(e){}
            return orig.apply(this, arguments);
        };
    }, 0);

    hookFn('openMaintenanceForEquipment', function(orig){
        return function(store, name){
            try{
                var eq=null; try{ eq=window._equipCur; }catch(e){}
                if(eq && eq.id && typeof window.woReportForEquipment==='function'){
                    notice('&#128736; <b>Repairs have moved to Work Orders.</b> Reporting a problem with <b>'+esc(name||eq.name||'this equipment')+'</b> there instead.');
                    window.woReportForEquipment(eq.id);
                    return;
                }
                if(goWorkOrdersReport({ woItem:(name||''), woTitle:(name?('Repair needed: '+name):'') })) return;
            }catch(e){}
            return orig.apply(this, arguments);
        };
    }, 0);

    hookFn('submitMaintenance', function(orig){
        return function(){
            try{
                if(typeof window.openWorkOrders==='function'){
                    var item='', desc='', loc='';
                    try{ var i1=byId('maintItemInput'); if(i1) item=i1.value||''; }catch(e){}
                    try{ var f=byId('maintenanceForm'); if(f){ var d=f.querySelector('textarea[name="IssueDescription"]'); if(d) desc=d.value||''; } }catch(e){}
                    try{ var l=byId('maintLoc'); if(l) loc=l.value||''; }catch(e){}
                    if(goWorkOrdersReport({ woTitle:item, woDesc:desc, woStore:loc })) return;
                }
            }catch(e){}
            return orig.apply(this, arguments);
        };
    }, 0);

    hookFn('submitDamage', function(orig){
        return function(){
            try{
                if(typeof window.openWorkOrders==='function'){
                    if(goWorkOrdersDamage(damagePrefill(), true)) return;
                }
            }catch(e){}
            return orig.apply(this, arguments);
        };
    }, 0);

    // ============================================================
    // 2) SUPPLY — legacy inline inventory request + orphaned shortage form
    //    -> Supply Request module
    // ============================================================
    function goSupply(pre){
        try{
            if(typeof window.openSupplyRequest!=='function') return false;
            window.openSupplyRequest();
            notice('&#128666; <b>Supply requests have moved.</b> All requests now go through the <b>Supply Request</b> screen so the office can assign, fulfill and track them. Add your item below and submit.');
            if(pre){ setTimeout(function(){
                try{
                    var row=document.querySelector('#supplyItems .supply-item-row');
                    if(row){
                        var n=row.querySelector('.si-name'); if(n && !n.value && pre.item) n.value=pre.item;
                        var q=row.querySelector('.si-qty'); if(q && !q.value && pre.qty) q.value=pre.qty;
                    }
                    if(pre.reason){ var r=byId('supplyReason'); if(r && !r.value) r.value=pre.reason; }
                }catch(e){}
            }, 350); }
            return true;
        }catch(e){ return false; }
    }

    hookFn('requestInv', function(orig){
        return function(itemId, name){
            try{
                if(goSupply({ item:(name||''), reason:'Running low — reorder from inventory count' })) return;
            }catch(e){}
            return orig.apply(this, arguments);
        };
    }, 0);

    hookFn('submitShortage', function(orig){
        return function(){
            try{ if(goSupply(null)) return; }catch(e){}
            return orig.apply(this, arguments);
        };
    }, 0);

    // Legacy pending-requests list (openInvRequests) stays readable — just make
    // clear it is history, not the live queue.
    hookFn('openInvRequests', function(orig){
        return function(){
            var r=orig.apply(this, arguments);
            try{
                var body=byId('invReqBody');
                if(body && body.parentNode && !byId('r09InvReqNote')){
                    var d=document.createElement('div'); d.id='r09InvReqNote';
                    d.style.cssText='background:#fff7e6;border:1.5px solid #e0a13c;border-radius:10px;padding:9px 11px;margin:0 0 10px;font-size:12px;color:#6b4a00;line-height:1.5;';
                    d.innerHTML='&#9888;&#65039; <b>Legacy list.</b> New supply requests now go through the <b>Supply Request</b> screen (its Incoming tab is the live queue). Entries here are older inline-inventory requests kept for reference.';
                    body.parentNode.insertBefore(d, body);
                }
            }catch(e){}
            return r;
        };
    }, 0);

    // ============================================================
    // 3) CONCERNS — legacy Report-a-Concern -> Your Voice (concern pathway)
    // ============================================================
    function goVoiceConcern(){
        try{
            if(typeof window.openYourVoice!=='function') return false;
            window.openYourVoice();
            try{ if(typeof window.yv2Form==='function') window.yv2Form('concern'); }catch(e){}
            notice('&#128274; <b>Confidential reports have moved to Your Voice.</b> Same protections — goes only to Admin Managers, with a fully anonymous option — plus a reference + access code so you can follow up. Past reports remain visible to Admin Managers inside Your Voice.');
            return true;
        }catch(e){ return false; }
    }

    hookFn('openHarassReport', function(orig){
        return function(){
            try{ if(goVoiceConcern()) return; }catch(e){}
            return orig.apply(this, arguments);
        };
    }, 0);

    hookFn('harassSubmit', function(orig){
        return function(){
            try{ if(goVoiceConcern()) return; }catch(e){}
            return orig.apply(this, arguments);
        };
    }, 0);

    // ============================================================
    // Visible banners on the legacy views themselves (covers back-navigation,
    // deep links and anything that shows the view without its open function).
    // The views are static in index.html, so they exist at load time.
    // ============================================================
    function injectAll(){
        injectBanner('maintenanceView','r09MaintMoved',
            '&#128736; <b>This form has moved.</b> Repairs are now reported and tracked in <b>Work Orders</b> — one place to report, assign and complete repairs. Submitting here will open Work Orders instead. Your past reports are still under <b>My Submissions</b>.'
            + bannerBtn('Open Work Orders', "try{if(window.r09)window.r09.wo();}catch(e){}"));
        injectBanner('damageView','r09DamageMoved',
            '&#9888;&#65039; <b>This form now creates a Work Order.</b> Vehicle, trailer &amp; cart damage is tracked in <b>Work Orders</b> (Type: Damage) with photos, a priority and an owner. Submitting here will open Work Orders with your details carried over.'
            + bannerBtn('Open Work Orders', "try{if(window.r09)window.r09.damage();}catch(e){}"));
        injectBanner('harassReportView','r09HarassMoved',
            '&#128274; <b>This form has moved.</b> Confidential concerns now go through <b>Your Voice &rarr; Report a Concern</b> — the same privacy (Admin Managers only, anonymous option) plus a reference + access code to follow up. Submitting here will open Your Voice instead.'
            + bannerBtn('Open Your Voice', "try{if(window.r09)window.r09.voice();}catch(e){}"));
        injectBanner('shortageView','r09ShortageMoved',
            '&#128666; <b>This form has moved.</b> Shortages and supply needs now go through the <b>Supply Request</b> screen, where the office assigns and tracks every request to delivery.'
            + bannerBtn('Open Supply Request', "try{if(window.r09)window.r09.supply();}catch(e){}"));
        // Retitle the legacy menu tile so nobody is surprised by the redirect.
        try{
            var b=byId('btn-maintenance');
            if(b){ var sm=b.querySelector('small'); if(sm) sm.textContent='Opens Work Orders — report & track repairs'; }
        }catch(e){}
        try{
            var bd=byId('btn-damage');
            if(bd){ var smd=bd.querySelector('small'); if(smd) smd.textContent='Creates a Work Order (Type: Damage) with photos'; }
        }catch(e){}
    }

    // public surface for the banner buttons (inline onclick)
    try{
        window.r09 = {
            wo: function(){ try{ if(!goWorkOrdersReport(null) && typeof openMenu==='function') openMenu(); }catch(e){} },
            damage: function(){ try{ if(!goWorkOrdersDamage(null,false) && typeof openMenu==='function') openMenu(); }catch(e){} },
            supply: function(){ try{ if(!goSupply(null) && typeof openMenu==='function') openMenu(); }catch(e){} },
            voice: function(){ try{ if(!goVoiceConcern() && typeof openMenu==='function') openMenu(); }catch(e){} }
        };
    }catch(e){}

    try{
        if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', function(){ try{ injectAll(); }catch(e){} }); }
        else injectAll();
        // Belt & braces: re-try once shortly after load in case views mount late.
        setTimeout(function(){ try{ injectAll(); }catch(e){} }, 1500);
    }catch(e){}
})();
