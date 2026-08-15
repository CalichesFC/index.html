    // ============================================================
    // CATERING CALENDAR  (js/43_catering_calendar.js)
    // Entry: openCateringCalendar()   Tile: btn-cateringCalendar (managers)
    // Overlay id: ccModal (full-screen, mirrors js/30 calModal).
    //
    // A visual calendar of REAL catering bookings — sourced from the working
    // quotes engine (app_quote_admin_list), the SAME data the "Quotes & Invoices"
    // pipeline (js/11) already uses. Month / Week / Day views + an Upcoming list,
    // colored by the quote's stage (Pending / Accepted / Paid / Declined / Expired).
    // Clicking an event reuses the pipeline's own working actions (edit, pay link).
    // This is a read-only calendar LAYER over the existing system — nothing new is
    // stored, nothing is duplicated.
    // ============================================================
    var _cc = { view:'month', cursor:null, data:null, byDate:null, sel:null, loading:false, err:null };

    function ccEsc(s){ return (typeof escapeHtml==='function') ? escapeHtml(s==null?'':String(s)) : String(s==null?'':s); }
    function ccMoney(n){ n=Number(n)||0; return '$'+n.toFixed(2); }

    // ---- stage color/label (aligned to the quotes pipeline: js/11 statusColors + Paid) ----
    function ccKey(q){ if(q && q.invoice_status==='Paid') return 'Paid'; return (q && q.status) || 'Pending'; }
    var CC_COLOR = { 'Pending':'#e67e22', 'Accepted':'#28a745', 'Paid':'#0f7a3d', 'Declined':'#dc3545', 'Expired':'#9ca3af' };
    function ccColor(q){ return CC_COLOR[ccKey(q)] || '#106ab3'; }

    // ---- date helpers (event_date is 'YYYY-MM-DD' — parse as LOCAL to avoid TZ drift) ----
    function ccToday(){ var d=new Date(); return new Date(d.getFullYear(),d.getMonth(),d.getDate()); }
    function ccParse(s){ var p=String(s).slice(0,10).split('-'); return new Date(+p[0],(+p[1]-1),+p[2]); }
    function ccIso(d){ return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
    function ccSameDay(a,b){ return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }
    var CC_MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
    var CC_DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // ---- load REAL quotes via the working admin list (same call js/11 uses) ----
    function ccLoad(){
        _cc.loading=true; _cc.err=null; ccRender();
        if(typeof withPin!=='function' || typeof supabaseClient==='undefined' || !currentUser){ _cc.loading=false; _cc.err='Please sign in first.'; ccRender(); return; }
        withPin(function(pin){
            supabaseClient.rpc('app_quote_admin_list', { p_admin_username: currentUser.username, p_admin_password: pin })
            .then(function(r){
                _cc.loading=false;
                if(r.error){
                    if(r.error.code==='42501' && typeof sessionPin!=='undefined') sessionPin=null;
                    _cc.err = (String(r.error.message||'').indexOf('forbidden')>=0) ? 'This calendar is for managers. Ask an admin for access.' : (r.error.message||'Could not load the calendar.');
                    ccRender(); return;
                }
                _cc.data = (r.data||[]).filter(function(q){ return q && q.event_date; });
                ccIndex(); ccRender();
            })
            .catch(function(){ _cc.loading=false; _cc.err='Connection error. Please try again.'; ccRender(); });
        });
    }
    function ccIndex(){
        var m={}; (_cc.data||[]).forEach(function(q){ var k=String(q.event_date).slice(0,10); (m[k]=m[k]||[]).push(q); });
        Object.keys(m).forEach(function(k){ m[k].sort(function(a,b){ return (a.order_num||0)-(b.order_num||0); }); });
        _cc.byDate=m;
    }

    // ---- overlay shell ----
    function ccOv(){ var o=document.getElementById('ccModal'); if(!o){ o=document.createElement('div'); o.id='ccModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function ccClose(){ var o=document.getElementById('ccModal'); if(o) o.style.display='none'; _cc.sel=null; }
    function openCateringCalendar(){ if(typeof currentUser==='undefined'||!currentUser) return; if(!_cc.cursor) _cc.cursor=ccToday(); ccLoad(); }

    function ccHeader(){ return '<div style="background:linear-gradient(120deg,#EC3E7E,#106AB3);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">&#128197; Catering Calendar</b><button onclick="ccClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }

    function ccRangeLabel(){
        var c=_cc.cursor||ccToday();
        if(_cc.view==='month') return CC_MON[c.getMonth()]+' '+c.getFullYear();
        if(_cc.view==='day')   return CC_DOW[c.getDay()]+', '+CC_MON[c.getMonth()]+' '+c.getDate();
        if(_cc.view==='week'){ var ws=new Date(c.getFullYear(),c.getMonth(),c.getDate()-c.getDay()); var we=new Date(ws.getFullYear(),ws.getMonth(),ws.getDate()+6); return CC_MON[ws.getMonth()].slice(0,3)+' '+ws.getDate()+' – '+CC_MON[we.getMonth()].slice(0,3)+' '+we.getDate()+', '+we.getFullYear(); }
        return 'Upcoming events';
    }
    function ccToolbar(){
        function vb(v,l){ var on=_cc.view===v; return '<button onclick="ccSetView(\''+v+'\')" style="border:none;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:800;cursor:pointer;'+(on?'background:#106ab3;color:#fff;':'background:#eef0f3;color:#3a4353;')+'">'+l+'</button>'; }
        var nav=(_cc.view==='upcoming')?'':'<div style="display:flex;gap:6px;align-items:center;"><button onclick="ccNav(-1)" style="border:none;background:#eef0f3;border-radius:8px;width:32px;height:32px;font-size:18px;line-height:1;cursor:pointer;color:#3a4353;">&#8249;</button><button onclick="ccGoToday()" style="border:none;background:#26242b;color:#fff;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:800;cursor:pointer;">Today</button><button onclick="ccNav(1)" style="border:none;background:#eef0f3;border-radius:8px;width:32px;height:32px;font-size:18px;line-height:1;cursor:pointer;color:#3a4353;">&#8250;</button></div>';
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">'
            +'<div style="font-size:18px;font-weight:900;color:#26242b;min-width:150px;">'+ccEsc(ccRangeLabel())+'</div>'
            +nav
            +'<div style="display:flex;gap:6px;flex-wrap:wrap;">'+vb('month','Month')+vb('week','Week')+vb('day','Day')+vb('upcoming','Upcoming')+'</div>'
            +'</div>';
    }
    function ccLegend(){
        var items=[['Pending','#e67e22'],['Accepted','#28a745'],['Paid','#0f7a3d'],['Declined','#dc3545'],['Expired','#9ca3af']];
        var h='<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:16px;justify-content:center;">';
        for(var i=0;i<items.length;i++){ h+='<div style="display:flex;align-items:center;gap:5px;font-size:11.5px;color:#6b7686;font-weight:700;"><span style="width:10px;height:10px;border-radius:50%;background:'+items[i][1]+';display:inline-block;"></span>'+items[i][0]+'</div>'; }
        h+='</div>'; return h;
    }

    function ccChip(q){
        return '<div onclick="ccOpen('+q.id+')" title="'+ccEsc(q.contact_name||'')+' — '+ccMoney(q.total)+'" style="margin-top:3px;background:'+ccColor(q)+';color:#fff;border-radius:5px;padding:2px 5px;font-size:10.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;">'+ccEsc(q.contact_name||('#'+q.order_num))+'</div>';
    }
    function ccMonth(){
        var c=_cc.cursor, y=c.getFullYear(), m=c.getMonth();
        var first=new Date(y,m,1), startDow=first.getDay();
        var gridStart=new Date(y,m,1-startDow), today=ccToday();
        var h='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:#e3e9f0;border:1px solid #e3e9f0;border-radius:12px;overflow:hidden;">';
        for(var i=0;i<7;i++){ h+='<div style="background:#fff;padding:8px 6px;text-align:center;font-size:11px;font-weight:800;color:#8a8594;text-transform:uppercase;">'+CC_DOW[i]+'</div>'; }
        for(var d=0; d<42; d++){
            var day=new Date(gridStart.getFullYear(),gridStart.getMonth(),gridStart.getDate()+d);
            var inMonth=(day.getMonth()===m), iso=ccIso(day), evs=(_cc.byDate&&_cc.byDate[iso])||[], isToday=ccSameDay(day,today);
            h+='<div style="background:'+(inMonth?'#fff':'#f7f9fb')+';min-height:94px;padding:5px 6px;vertical-align:top;">';
            h+='<div style="font-size:12px;font-weight:'+(isToday?'900':'700')+';'+(isToday?'background:#106ab3;color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;':('color:'+(inMonth?'#26242b':'#b8c0cc')+';'))+'">'+day.getDate()+'</div>';
            var shown=evs.slice(0,3);
            for(var e=0;e<shown.length;e++){ h+=ccChip(shown[e]); }
            if(evs.length>3){ h+='<div onclick="ccSetDay(\''+iso+'\')" style="font-size:10.5px;color:#6b7686;font-weight:700;cursor:pointer;margin-top:3px;">+'+(evs.length-3)+' more</div>'; }
            h+='</div>';
        }
        h+='</div>'; return h;
    }
    function ccWeek(){
        var c=_cc.cursor, ws=new Date(c.getFullYear(),c.getMonth(),c.getDate()-c.getDay()), today=ccToday();
        var h='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;">';
        for(var i=0;i<7;i++){
            var day=new Date(ws.getFullYear(),ws.getMonth(),ws.getDate()+i), iso=ccIso(day), evs=(_cc.byDate&&_cc.byDate[iso])||[], isToday=ccSameDay(day,today);
            h+='<div style="background:#fff;border:1px solid '+(isToday?'#106ab3':'#eef0f5')+';border-radius:10px;min-height:150px;padding:8px;">';
            h+='<div style="font-size:11px;font-weight:800;color:'+(isToday?'#106ab3':'#8a8594')+';margin-bottom:4px;">'+CC_DOW[i]+' '+day.getDate()+'</div>';
            if(!evs.length){ h+='<div style="color:#c8cfda;font-size:11px;">&mdash;</div>'; }
            for(var e=0;e<evs.length;e++){ h+=ccChip(evs[e]); }
            h+='</div>';
        }
        h+='</div>'; return h;
    }
    function ccRow(q){
        return '<div onclick="ccOpen('+q.id+')" style="display:flex;justify-content:space-between;gap:10px;border-left:4px solid '+ccColor(q)+';background:#fbfdff;border-radius:8px;padding:10px 12px;margin-bottom:7px;cursor:pointer;">'
            +'<div style="min-width:0;"><div style="font-weight:800;color:#26242b;">'+ccEsc(q.contact_name||('#'+q.order_num))+(q.company?' <span style="color:#6b7686;font-weight:600;">('+ccEsc(q.company)+')</span>':'')+'</div>'
            +'<div style="font-size:12px;color:#6b7686;">#'+ccEsc(q.order_num)+(q.event_type?(' &middot; '+ccEsc(q.event_type)):'')+'</div></div>'
            +'<div style="text-align:right;flex-shrink:0;"><div style="font-weight:800;color:#106ab3;">'+ccMoney(q.total)+'</div><div style="font-size:11px;font-weight:800;color:'+ccColor(q)+';">'+ccEsc(ccKey(q))+'</div></div></div>';
    }
    function ccDay(){
        var c=_cc.cursor, iso=ccIso(c), evs=(_cc.byDate&&_cc.byDate[iso])||[];
        var h='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:14px;">';
        h+='<div style="font-size:15px;font-weight:800;color:#26242b;margin-bottom:10px;">'+CC_DOW[c.getDay()]+', '+CC_MON[c.getMonth()]+' '+c.getDate()+', '+c.getFullYear()+'</div>';
        if(!evs.length){ h+='<p style="color:#8a8594;font-size:13px;margin:6px 0;">No catering events this day.</p>'; }
        for(var e=0;e<evs.length;e++){ h+=ccRow(evs[e]); }
        h+='</div>'; return h;
    }
    function ccUpcoming(){
        var today=ccToday();
        var arr=(_cc.data||[]).filter(function(q){ return ccParse(q.event_date)>=today; }).sort(function(a,b){ return ccParse(a.event_date)-ccParse(b.event_date); });
        var h='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:14px;">';
        h+='<div style="font-size:13px;font-weight:800;color:#26242b;margin-bottom:6px;">Upcoming events ('+arr.length+')</div>';
        if(!arr.length){ h+='<p style="color:#8a8594;font-size:13px;">Nothing upcoming on the books.</p>'; }
        var lastMonth='';
        for(var i=0;i<arr.length;i++){
            var q=arr[i], d=ccParse(q.event_date), mk=CC_MON[d.getMonth()]+' '+d.getFullYear();
            if(mk!==lastMonth){ h+='<div style="font-size:11px;font-weight:800;color:#8a8594;text-transform:uppercase;margin:12px 0 4px;">'+mk+'</div>'; lastMonth=mk; }
            h+='<div onclick="ccOpen('+q.id+')" style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #f0f3f7;cursor:pointer;">'
                +'<div style="text-align:center;min-width:42px;"><div style="font-size:17px;font-weight:900;color:#26242b;line-height:1;">'+d.getDate()+'</div><div style="font-size:10px;color:#8a8594;font-weight:700;">'+CC_DOW[d.getDay()]+'</div></div>'
                +'<span style="width:9px;height:9px;border-radius:50%;background:'+ccColor(q)+';flex-shrink:0;display:inline-block;"></span>'
                +'<div style="flex:1;min-width:0;"><div style="font-weight:700;color:#26242b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+ccEsc(q.contact_name||('#'+q.order_num))+(q.company?' <span style="color:#6b7686;font-weight:500;">('+ccEsc(q.company)+')</span>':'')+'</div><div style="font-size:11.5px;color:#6b7686;">'+ccEsc(ccKey(q))+(q.event_type?(' &middot; '+ccEsc(q.event_type)):'')+'</div></div>'
                +'<div style="font-weight:800;color:#106ab3;font-size:13px;flex-shrink:0;">'+ccMoney(q.total)+'</div></div>';
        }
        h+='</div>'; return h;
    }

    function ccKV(k,v){ return '<div style="display:flex;gap:10px;font-size:13.5px;padding:5px 0;border-bottom:1px solid #f2f4f7;"><div style="min-width:80px;color:#6b7686;">'+k+'</div><div style="flex:1;font-weight:700;color:#26242b;">'+v+'</div></div>'; }
    function ccSelPopover(){
        var q=_cc.sel; if(!q) return ''; var d=ccParse(q.event_date);
        var acts='<button onclick="ccActEdit('+q.id+')" style="background:#7b2d8b;color:#fff;border:none;border-radius:9px;padding:10px 14px;font-size:13px;font-weight:800;cursor:pointer;">&#9999;&#65039; Edit / Resend</button>';
        if(q.square_payment_url) acts+='<button onclick="ccActPay('+q.id+')" style="background:#185FA5;color:#fff;border:none;border-radius:9px;padding:10px 14px;font-size:13px;font-weight:800;cursor:pointer;">&#128279; Copy Pay Link</button>';
        acts+='<button onclick="ccActPipeline()" style="background:#26242b;color:#fff;border:none;border-radius:9px;padding:10px 14px;font-size:13px;font-weight:800;cursor:pointer;">&#128202; Open in Quotes &amp; Invoices</button>';
        var rows=ccKV('When', CC_DOW[d.getDay()]+', '+CC_MON[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear());
        if(q.event_type) rows+=ccKV('Type', ccEsc(q.event_type));
        rows+=ccKV('Stage', '<span style="color:'+ccColor(q)+';font-weight:800;">'+ccEsc(ccKey(q))+'</span>');
        rows+=ccKV('Total', ccMoney(q.total));
        if(q.invoice_number) rows+=ccKV('Invoice', ccEsc(q.invoice_number));
        if(q.invoice_status==='Paid') rows+=ccKV('Paid', q.paid_at?new Date(q.paid_at).toLocaleDateString():'Yes');
        else if(q.square_payment_url) rows+=ccKV('Pay link','Ready &mdash; awaiting payment');
        return '<div onclick="ccCloseSel()" style="position:fixed;inset:0;background:rgba(20,26,40,.45);z-index:100060;display:flex;align-items:center;justify-content:center;padding:16px;">'
            +'<div onclick="event.stopPropagation()" style="background:#fff;border-radius:16px;max-width:420px;width:100%;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);">'
            +'<div style="background:linear-gradient(120deg,#EC3E7E,#106AB3);color:#fff;padding:14px 16px;"><div style="font-size:16px;font-weight:900;">'+ccEsc(q.contact_name||('#'+q.order_num))+'</div><div style="font-size:12px;opacity:.92;">#'+ccEsc(q.order_num)+(q.company?(' &middot; '+ccEsc(q.company)):'')+'</div></div>'
            +'<div style="padding:14px 16px;">'+rows+'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">'+acts+'</div>'
            +'<button onclick="ccCloseSel()" style="width:100%;margin-top:10px;background:#eef0f3;border:none;border-radius:9px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;color:#3a4353;">Close</button></div>'
            +'</div></div>';
    }

    function ccRender(){
        var o=ccOv(), body;
        if(_cc.loading){ body='<p style="text-align:center;padding:40px;color:#6b7686;">Loading your catering calendar&hellip;</p>'; }
        else if(_cc.err){ body='<p style="text-align:center;padding:40px;color:#c0264b;font-weight:600;">'+ccEsc(_cc.err)+'</p>'; }
        else if(_cc.view==='month'){ body=ccMonth(); }
        else if(_cc.view==='week'){ body=ccWeek(); }
        else if(_cc.view==='day'){ body=ccDay(); }
        else { body=ccUpcoming(); }
        var toolbar=(_cc.loading||_cc.err)?'':ccToolbar();
        var legend=(_cc.loading||_cc.err)?'':ccLegend();
        o.innerHTML = ccHeader() + '<div style="max-width:1000px;margin:0 auto;padding:14px 16px 44px;">' + toolbar + body + legend + '</div>' + (_cc.sel?ccSelPopover():'');
    }

    // ---- navigation + interactions ----
    function ccNav(delta){ var c=_cc.cursor||ccToday(); if(_cc.view==='month'){ _cc.cursor=new Date(c.getFullYear(),c.getMonth()+delta,1); } else if(_cc.view==='week'){ _cc.cursor=new Date(c.getFullYear(),c.getMonth(),c.getDate()+7*delta); } else { _cc.cursor=new Date(c.getFullYear(),c.getMonth(),c.getDate()+delta); } ccRender(); }
    function ccGoToday(){ _cc.cursor=ccToday(); ccRender(); }
    function ccSetView(v){ _cc.view=v; ccRender(); }
    function ccSetDay(iso){ _cc.cursor=ccParse(iso); _cc.view='day'; ccRender(); }
    function ccOpen(id){ var q=(_cc.data||[]).filter(function(x){ return String(x.id)===String(id); })[0]; if(q){ _cc.sel=q; ccRender(); } }
    function ccCloseSel(){ _cc.sel=null; ccRender(); }
    function ccActEdit(id){ ccClose(); if(typeof editQuote==='function'){ editQuote(id); } else if(typeof openSalesPipeline==='function'){ openSalesPipeline(); } }
    function ccActPay(id){ try{ if(typeof copyPayLink==='function'){ copyPayLink(id); return; } }catch(e){} ccActPipeline(); }
    function ccActPipeline(){ ccClose(); if(typeof openSalesPipeline==='function'){ openSalesPipeline(); } }

    // ---- expose (inline onclick handlers resolve against window) ----
    window.openCateringCalendar=openCateringCalendar;
    window.ccSetView=ccSetView; window.ccNav=ccNav; window.ccGoToday=ccGoToday;
    window.ccOpen=ccOpen; window.ccCloseSel=ccCloseSel; window.ccClose=ccClose; window.ccSetDay=ccSetDay;
    window.ccActEdit=ccActEdit; window.ccActPay=ccActPay; window.ccActPipeline=ccActPipeline;
