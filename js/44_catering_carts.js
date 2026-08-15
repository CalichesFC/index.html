    // ============================================================
    // CATERING CARTS & TRAILERS  (js/44_catering_carts.js)
    // Entry: openCateringCarts()   Overlay id: ctModal  (mirrors js/43 ccModal)
    //
    // Reads your REAL fleet from the Asset Register (app_cv_asset_list, Active
    // only) so carts/trailers are never hard-coded. Assign any asset to any
    // booking (app_cart_list / app_cart_assign_set over the real quotes).
    //
    // BOOKING RULE (per Issac): each asset is booked individually; multiple
    // events at the SAME TIME are fine as long as they use different assets.
    // Running the SAME asset on more than one event in a day is ALLOWED — it
    // depends on timing/distance, which is HIS call. So a same-asset same-day
    // overlap is shown as a HEADS-UP (never a hard block); he accepts or
    // reassigns. (Event time + location come from the detail page next; once
    // present, tighten the heads-up to true time overlap.)
    // ============================================================
    var _ct = { events:null, assets:[], colorByName:{}, loading:false, err:null, saving:null };
    var CT_PALETTE=['#106ab3','#ec3e7e','#e67e22','#7b2d8b','#0f7a3d','#2563eb','#0ea5e9','#c0264b','#14b8a6','#d4a017'];
    var CT_DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], CT_MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    function ctEsc(s){ return (typeof escapeHtml==='function')?escapeHtml(s==null?'':String(s)):String(s==null?'':s); }
    function ctJs(s){ return String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
    function ctMoney(n){ n=Number(n)||0; return '$'+n.toFixed(2); }
    function ctToday(){ var d=new Date(); return new Date(d.getFullYear(),d.getMonth(),d.getDate()); }
    function ctParse(s){ var p=String(s).slice(0,10).split('-'); return new Date(+p[0],(+p[1]-1),+p[2]); }
    function ctPretty(s){ var d=ctParse(s); return CT_DOW[d.getDay()]+' '+CT_MON[d.getMonth()]+' '+d.getDate(); }
    function ctColor(name){ return (_ct.colorByName&&_ct.colorByName[name])||'#6b7686'; }
    function ctBuildColors(){ _ct.colorByName={}; (_ct.assets||[]).forEach(function(a,i){ if(a&&a.name) _ct.colorByName[a.name]=CT_PALETTE[i%CT_PALETTE.length]; }); }

    function ctOv(){ var o=document.getElementById('ctModal'); if(!o){ o=document.createElement('div'); o.id='ctModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(o);} o.style.display='block'; return o; }
    function ctClose(){ var o=document.getElementById('ctModal'); if(o)o.style.display='none'; }
    function openCateringCarts(){ if(typeof currentUser==='undefined'||!currentUser) return; ctLoad(); }

    function ctLoad(){
        _ct.loading=true; _ct.err=null; ctRender();
        if(typeof withPin!=='function'||typeof supabaseClient==='undefined'||!currentUser){ _ct.loading=false; _ct.err='Please sign in first.'; ctRender(); return; }
        withPin(function(pin){
            // 1) real fleet from the Asset Register (Active only)
            supabaseClient.rpc('app_cv_asset_list',{p_username:currentUser.username,p_password:pin}).then(function(ra){
                var list=[]; try{ list=(ra&&ra.data&&ra.data.assets)?ra.data.assets:((ra&&ra.data)||[]); }catch(e){}
                _ct.assets=(list||[]).filter(function(a){ return a&&String(a.status||'active').toLowerCase()==='active'; });
            }).catch(function(){ _ct.assets=[]; }).then(function(){ ctBuildColors(); ctLoadQuotes(pin); });
        });
    }
    function ctLoadQuotes(pin){
        var A={p_admin_username:currentUser.username,p_admin_password:pin};
        supabaseClient.rpc('app_quote_admin_list',A).then(function(r){
            if(r.error){ _ct.loading=false; _ct.err=(String(r.error.message||'').indexOf('forbidden')>=0)?'This screen is for managers. Ask an admin for access.':(r.error.message||'Could not load.'); ctRender(); return; }
            var evs=(r.data||[]).filter(function(q){ return q&&q.event_date; });
            supabaseClient.rpc('app_cart_list',A).then(function(r2){
                _ct.loading=false;
                var map={}; if(!r2.error){ (r2.data||[]).forEach(function(a){ map[a.quote_id]=a.cart; }); }
                evs.forEach(function(q){ q.cart=map[q.id]||null; });
                _ct.events=evs; ctRender();
            }).catch(function(){ _ct.loading=false; evs.forEach(function(q){ q.cart=null; }); _ct.events=evs; ctRender(); });
        }).catch(function(){ _ct.loading=false; _ct.err='Connection error. Please try again.'; ctRender(); });
    }

    function ctAssign(qid, cart){
        if(_ct.saving) return; _ct.saving=qid; ctRender();
        withPin(function(pin){
            supabaseClient.rpc('app_cart_assign_set',{p_admin_username:currentUser.username,p_admin_password:pin,p_quote_id:qid,p_cart:cart||''}).then(function(r){
                _ct.saving=null;
                if(r.error){ alert(r.error.message||'Could not save.'); ctRender(); return; }
                if(_ct.events){ for(var i=0;i<_ct.events.length;i++){ if(String(_ct.events[i].id)===String(qid)){ _ct.events[i].cart=cart||null; } } }
                ctRender();
            }).catch(function(){ _ct.saving=null; alert('Connection error.'); ctRender(); });
        });
    }

    // same asset + same day + >1 upcoming booking = HEADS-UP (not a block)
    function ctConflicts(){
        var up=(_ct.events||[]).filter(function(q){ return q.cart && ctParse(q.event_date)>=ctToday(); });
        var byKey={}; up.forEach(function(q){ var k=q.cart+'|'+String(q.event_date).slice(0,10); (byKey[k]=byKey[k]||[]).push(q); });
        var out=[]; Object.keys(byKey).forEach(function(k){ if(byKey[k].length>1) out.push({cart:byKey[k][0].cart,date:byKey[k][0].event_date,items:byKey[k]}); });
        out.sort(function(a,b){ return ctParse(a.date)-ctParse(b.date); });
        return out;
    }

    function ctHeader(){ return '<div style="background:linear-gradient(120deg,#EC3E7E,#106AB3);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">&#128666; Carts &amp; Trailers</b><button onclick="ctClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }

    function ctPicker(q){
        var A=_ct.assets||[];
        if(!A.length) return '<div style="margin-top:6px;font-size:12px;color:#c0264b;">No carts in the Asset Register yet &mdash; add them under Manager Tools.</div>';
        var h='<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-top:6px;">', lastKind=null;
        for(var i=0;i<A.length;i++){ var c=A[i].name, on=(q.cart===c);
            if(A[i].kind!==lastKind){ lastKind=A[i].kind; h+='<span style="font-size:10px;font-weight:800;color:#8a8594;text-transform:uppercase;margin:0 2px 0 '+(i?'8px':'0')+';">'+ctEsc(A[i].kind==='trailer'?'Trailers':'Carts')+'</span>'; }
            h+='<button onclick="ctAssign('+q.id+',\''+ctJs(c)+'\')" '+(_ct.saving===q.id?'disabled':'')+' style="border:none;border-radius:999px;padding:5px 11px;font-size:11.5px;font-weight:800;cursor:pointer;'+(on?('background:'+ctColor(c)+';color:#fff;'):'background:#eef0f3;color:#3a4353;')+'">'+ctEsc(c)+'</button>';
        }
        if(q.cart) h+='<button onclick="ctAssign('+q.id+',\'\')" '+(_ct.saving===q.id?'disabled':'')+' style="border:none;border-radius:999px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;background:#fbe9ee;color:#c0264b;margin-left:6px;">Clear</button>';
        h+='</div>'; return h;
    }
    function ctEventRow(q, showPicker){
        var tag=q._dup?' <span style="background:#fff2d6;color:#9a5b00;border:1px solid #f0d391;border-radius:6px;font-size:9.5px;font-weight:800;padding:2px 6px;">&#128276; '+q._dup+'&times; this day</span>':'';
        return '<div style="background:#fff;border:1px solid '+(q._dup?'#f0d391':'#eef0f5')+';border-radius:10px;padding:10px 12px;margin-bottom:7px;">'
            +'<div style="display:flex;justify-content:space-between;gap:10px;"><div style="min-width:0;"><div style="font-weight:800;color:#26242b;">'+ctEsc(q.contact_name||('#'+q.order_num))+tag+'</div>'
            +'<div style="font-size:12px;color:#6b7686;">'+ctPretty(q.event_date)+(q.event_type?(' &middot; '+ctEsc(q.event_type)):'')+' &middot; #'+ctEsc(q.order_num)+'</div></div>'
            +'<div style="font-weight:800;color:#106ab3;font-size:13px;flex-shrink:0;">'+ctMoney(q.total)+'</div></div>'
            +(showPicker?ctPicker(q):'')+'</div>';
    }

    function ctRender(){
        var o=ctOv();
        if(_ct.loading){ o.innerHTML=ctHeader()+'<p style="text-align:center;padding:40px;color:#6b7686;">Loading your fleet &amp; bookings&hellip;</p>'; return; }
        if(_ct.err){ o.innerHTML=ctHeader()+'<p style="text-align:center;padding:40px;color:#c0264b;font-weight:600;">'+ctEsc(_ct.err)+'</p>'; return; }
        var today=ctToday();
        var up=(_ct.events||[]).filter(function(q){ return ctParse(q.event_date)>=today; });
        // mark same-day same-asset heads-ups (count per event)
        var conf=ctConflicts(), dupCount={}; conf.forEach(function(c){ c.items.forEach(function(q){ dupCount[q.id]=c.items.length; }); });
        up.forEach(function(q){ q._dup=dupCount[q.id]||0; });

        var h='<div style="max-width:900px;margin:0 auto;padding:14px 16px 44px;">';

        // heads-up banner (never a hard block)
        if(conf.length){
            h+='<div style="background:#fff7e6;border:1px solid #f3d9a0;border-radius:12px;padding:12px 14px;margin-bottom:14px;">'
              +'<div style="font-weight:800;color:#9a5b00;margin-bottom:6px;">&#128276; Heads-up &mdash; same '+(conf.length>1?'assets are':'asset is')+' on more than one event that day</div>';
            for(var i=0;i<conf.length;i++){ var c=conf[i];
                h+='<div style="font-size:13px;color:#3a4353;margin:4px 0;"><b style="color:'+ctColor(c.cart)+';">'+ctEsc(c.cart)+'</b> is on '+c.items.length+' events on '+ctPretty(c.date)+' &mdash; '+c.items.map(function(q){return ctEsc(q.contact_name||('#'+q.order_num));}).join(', ')+'</div>';
            }
            h+='<div style="font-size:11.5px;color:#8a8594;margin-top:4px;">That&rsquo;s fine if the timing &amp; distance work &mdash; your call. Reassign below only if you need to.</div></div>';
        }

        // fleet cards — one per asset in the register
        var A=_ct.assets||[];
        if(A.length){
            h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:16px;">';
            for(var k=0;k<A.length;k++){ var name=A[k].name, kind=A[k].kind==='trailer'?'Trailer':'Cart';
                var list=up.filter(function(q){ return q.cart===name; }).sort(function(a,b){ return ctParse(a.event_date)-ctParse(b.event_date); });
                h+='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;overflow:hidden;">'
                  +'<div style="background:'+ctColor(name)+';color:#fff;padding:10px 12px;font-weight:800;display:flex;justify-content:space-between;align-items:center;"><span>'+ctEsc(name)+' <span style="font-weight:600;opacity:.85;font-size:11px;">'+kind+'</span></span><span style="background:rgba(255,255,255,.25);border-radius:999px;font-size:11px;padding:2px 9px;">'+list.length+' upcoming</span></div>'
                  +'<div style="padding:10px 12px;">';
                if(!list.length){ h+='<div style="color:#9aa7b4;font-size:12.5px;">Open &mdash; no bookings yet.</div>'; }
                for(var j=0;j<list.length;j++){ var q=list[j];
                    h+='<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid #f2f4f7;'+(q._dup?'color:#9a5b00;font-weight:700;':'')+'">'
                      +'<span style="font-size:12.5px;">'+(q._dup?'&#128276; ':'')+ctPretty(q.event_date)+'</span><span style="font-size:12.5px;color:#26242b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;">'+ctEsc(q.contact_name||('#'+q.order_num))+'</span></div>';
                }
                h+='</div></div>';
            }
            h+='</div>';
        }

        // assign section — any asset to any booking
        var sorted=up.slice().sort(function(a,b){ return ctParse(a.event_date)-ctParse(b.event_date); });
        var unassigned=sorted.filter(function(q){ return !q.cart; });
        h+='<div style="font-size:13px;font-weight:800;color:#26242b;margin:4px 0 4px;">Assign a cart or trailer to each booking'+(unassigned.length?(' &middot; '+unassigned.length+' still open'):' &middot; all set &#10003;')+'</div>';
        h+='<div style="font-size:11.5px;color:#8a8594;margin:0 0 8px;">Multiple events at once is fine &mdash; just not the same cart on overlapping jobs (you&rsquo;ll get a heads-up, not a block).</div>';
        for(var m=0;m<sorted.length;m++){ h+=ctEventRow(sorted[m], true); }
        if(!sorted.length) h+='<p style="color:#8a8594;font-size:13px;">No upcoming bookings.</p>';

        h+='</div>';
        o.innerHTML=ctHeader()+h;
    }

    window.openCateringCarts=openCateringCarts; window.ctClose=ctClose; window.ctAssign=ctAssign;
