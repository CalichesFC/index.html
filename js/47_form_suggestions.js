    // ============================================================
    // QUOTE FORM SMART SUGGESTIONS  (js/47_form_suggestions.js)
    // Remembers what you've quoted before and suggests it as you type:
    //   • line-item descriptions (picking one fills its usual price)
    //   • event types (Quote Builder + the event detail page)
    //   • locations (event detail page — builds up as you use it)
    // Data from app_quote_suggestions. Self-contained: attaches native
    // <datalist>s to existing inputs via a debounced MutationObserver; edits
    // NO other file. (Returning-customer autofill already lives in js/11.)
    // ============================================================
    (function(){
        'use strict';
        try{ if(typeof window==='undefined'||window.__fsInjected) return; window.__fsInjected=true; }catch(e){ return; }
        var LOADED=false, LOADING=false, DESC=[], TYPES=[], LOCS=[], PRICEBY={};

        function esc(s){ return String(s==null?'':s).replace(/"/g,'&quot;'); }
        function dl(id){ var e=document.getElementById(id); if(!e){ e=document.createElement('datalist'); e.id=id; document.body.appendChild(e); } return e; }
        function fillList(el,arr){ if(!el) return; var h=''; for(var i=0;i<arr.length;i++){ if(arr[i]==null||arr[i]==='') continue; h+='<option value="'+esc(arr[i])+'">'; } el.innerHTML=h; }

        function load(){
            if(LOADED||LOADING) return;
            if(typeof withPin!=='function'||typeof supabaseClient==='undefined'||typeof currentUser==='undefined'||!currentUser) return;
            LOADING=true;
            withPin(function(pin){
                supabaseClient.rpc('app_quote_suggestions',{p_admin_username:currentUser.username,p_admin_password:pin}).then(function(r){
                    LOADING=false;
                    if(!r||r.error||!r.data){ return; }
                    var d=r.data;
                    var li=d.line_items||[]; DESC=[]; PRICEBY={};
                    for(var i=0;i<li.length;i++){ if(li[i]&&li[i].desc!=null){ DESC.push(li[i].desc); if(li[i].price!=null) PRICEBY[String(li[i].desc).trim().toLowerCase()]=li[i].price; } }
                    TYPES=d.event_types||[]; LOCS=d.locations||[];
                    LOADED=true; paint();
                }).catch(function(){ LOADING=false; });
            }, function(){ LOADING=false; });
        }
        function paint(){
            fillList(dl('fsDesc'),DESC); fillList(dl('fsType'),TYPES); fillList(dl('fsLoc'),LOCS);
            // enrich the detail page's own event-type datalist with past free-text types
            var edl=document.getElementById('edTypeList');
            if(edl){ var have={}; var opts=edl.querySelectorAll('option'); for(var k=0;k<opts.length;k++){ have[(opts[k].value||'').toLowerCase()]=1; }
                var add=''; for(var t=0;t<TYPES.length;t++){ if(TYPES[t]&&!have[String(TYPES[t]).toLowerCase()]) add+='<option value="'+esc(TYPES[t])+'">'; }
                if(add) edl.innerHTML=edl.innerHTML+add;
            }
        }

        function onDesc(inp){
            try{
                var key=String(inp.value||'').trim().toLowerCase(); if(!key||PRICEBY[key]==null) return;
                var row=inp.closest?inp.closest('.quote-row'):null; if(!row) return;
                var pe=row.querySelector('.quote-price');
                if(pe&&(pe.value===''||pe.value==null)){ pe.value=PRICEBY[key]; if(typeof recalcQuoteTotals==='function') recalcQuoteTotals(); }
            }catch(e){}
        }

        function attach(){
            var need=false;
            var descs=document.querySelectorAll('.quote-desc:not([data-fs])');
            for(var i=0;i<descs.length;i++){ (function(inp){ inp.setAttribute('data-fs','1'); inp.setAttribute('list','fsDesc');
                inp.addEventListener('change',function(){ onDesc(inp); }); inp.addEventListener('input',function(){ onDesc(inp); }); })(descs[i]); need=true; }
            var et=document.querySelector('#quoteForm input[name="EventType"]:not([data-fs])'); if(et){ et.setAttribute('data-fs','1'); et.setAttribute('list','fsType'); need=true; }
            var loc=document.getElementById('edLocation'); if(loc&&!loc.getAttribute('data-fs')){ loc.setAttribute('data-fs','1'); loc.setAttribute('list','fsLoc'); need=true; }
            if(document.getElementById('edTypeList')&&LOADED) paint();
            if(need) { load(); if(LOADED) paint(); }
        }

        var _t=null;
        function schedule(){ if(_t) return; _t=setTimeout(function(){ _t=null; attach(); },250); }
        try{ var mo=new MutationObserver(schedule); mo.observe(document.body,{childList:true,subtree:true}); }catch(e){}
        if(document.readyState!=='loading') setTimeout(attach,1200); else document.addEventListener('DOMContentLoaded',function(){ setTimeout(attach,600); });
        window.__fsAttach=attach;
    })();
