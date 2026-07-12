    // ============================================================
    // STORE INTELLIGENCE COMMAND CENTER  (js/26) -- Phase 1 + Phase 2
    // Entry: openCommandCenter()  Tile: btn-commandCenter (chart emoji)
    // Overlay id: ccModal (full-screen, clone of js/08 tdOverlay pattern).
    //
    // DATA SHAPE (must match command_center.sql app_command_center EXACTLY):
    //   { store, date,
    //     targets:{labor_pct,labor_pct_lo,labor_pct_hi,splh_target,
    //              speed_target_seconds,ly_warn_pct},
    //     today:{date,dow,sales,sales_ly,ly_pct,labor_cost,labor_pct,
    //            mgr_labor,crew_labor,mgr_share,crew_share,splh,guests,
    //            speed_seconds,note,has_data,
    //            status:{labor,splh,sales,speed}},   // 'red'|'amber'|'green'|null
    //     days:[ ...same day objects, ascending, window ends on date... ],
    //     week:{days,days_with_data,sales_total,sales_ly_total,ly_pct,
    //           labor_pct_wavg,splh_avg,guests_total},
    //     generated_at }
    //
    // Phase 2 exports (globals for the js/03 schedule builder):
    //   laborProjection(store,dateISO,scheduledHours,avgRate,projectedSales)
    //     -> {projLaborPct,target,delta,status,laborCost}
    //   laborProjectionChip(...same args) -> ready-to-concat html chip ('' if n/a)
    // Config: app_settings group 'cc_config' (server reads it directly; the
    // frontend cfgNum('cc_config',...) works once the author adds 'cc_config'
    // to CFG_GROUPS in js/14 -- safe fallbacks are baked in either way).
    // ============================================================
    var _cc = { store:'', date:'', data:null };

    function ccRpc(name,args,cb,onerr){ withPin(function(pin){ supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){ if(r.error){ if(onerr)onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; } cb(r.data); }).catch(function(){ if(onerr)onerr({message:'Connection error'}); else alert('Connection error.'); }); }); }

    function ccOv(){ var o=document.getElementById('ccModal'); if(!o){ o=document.createElement('div'); o.id='ccModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function ccClose(){ var o=document.getElementById('ccModal'); if(o) o.style.display='none'; }
    function ccHeader(){ return '<div style="background:linear-gradient(120deg,#185FA5,#1f7a3d);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">&#128202; Store Intelligence</b><button onclick="ccClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }

    function ccCanSee(){ if(!currentUser) return false; if(currentUser.is_developer===true) return true; if(typeof isManagerRole==='function'&&isManagerRole()) return true; var r=String(currentUser.role||'').toLowerCase(); return r.indexOf('manager')>=0||r.indexOf('admin')>=0||r.indexOf('lead')>=0||r.indexOf('owner')>=0||r.indexOf('vp')>=0; }
    function ccTodayIso(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
    function ccStores(){ return (typeof HUB_STORES!=='undefined'?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell']); }
    function ccEmoji(loc){ return (typeof hubStoreEmoji==='function'?hubStoreEmoji(loc):'&#128205;'); }
    function ccMoney(n){ if(n==null||n===''||isNaN(parseFloat(n))) return '&mdash;'; return '$'+parseFloat(n).toLocaleString(undefined,{maximumFractionDigits:0}); }
    function ccNum(n,suffix){ if(n==null||n===''||isNaN(parseFloat(n))) return '&mdash;'; return parseFloat(n).toLocaleString()+(suffix||''); }
    function ccStatusCol(st){ return st==='red'?['#fdeaea','#a01b3e']:(st==='amber'?['#fff4e0','#9a5b00']:(st==='green'?['#e8f5ec','#1b7a3d']:['#eef0f3','#5b6675'])); }
    function ccInk(st,fb){ return st==='red'?'#a01b3e':(st==='amber'?'#9a5b00':(st==='green'?'#1b7a3d':(fb||'#1f2a44'))); }
    function ccChip(st,txt){ var c=ccStatusCol(st); return '<span style="background:'+c[0]+';color:'+c[1]+';font-size:11px;font-weight:800;padding:3px 10px;border-radius:99px;white-space:nowrap;">'+txt+'</span>'; }
    function ccPrettyDate(s){ if(!s) return ''; var p=String(s).slice(0,10).split('-'); if(p.length!==3) return String(s); var dt=new Date(+p[0],+p[1]-1,+p[2]); if(isNaN(dt.getTime())) return String(s); return dt.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}); }

    function openCommandCenter(){
        if(!ccCanSee()){ alert('The Command Center is for managers and leadership.'); return; }
        if(!_cc.store){ var a=(typeof activeStoreLoc==='function'?activeStoreLoc():'')||''; _cc.store=(ccStores().indexOf(a)>=0)?a:ccStores()[0]; }
        if(!_cc.date) _cc.date=ccTodayIso();
        ccLoad();
    }
    function ccPickStore(loc){ _cc.store=loc; ccLoad(); }
    function ccPickDate(v){ _cc.date=v||ccTodayIso(); ccLoad(); }
    function ccLoad(){
        var ov=ccOv();
        ov.innerHTML=ccHeader()+'<div style="max-width:860px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading store intelligence&hellip;</div>';
        ccRpc('app_command_center',{p_store:_cc.store,p_date:_cc.date},function(d){ _cc.data=d||{}; ccRender(); },function(e){
            ov.innerHTML=ccHeader()+'<div style="max-width:860px;margin:0 auto;padding:30px 16px;text-align:center;color:#c0264b;">'+(String(e.message||'').indexOf('forbidden')>=0?'Managers and leadership only.':escapeHtml(e.message||'Could not load.'))+'</div>';
        });
    }

    function ccControls(){
        var h='<div style="background:#fff;border:1px solid #e6ebf2;border-radius:12px;padding:10px 12px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">';
        h+='<select onchange="ccPickStore(this.value)" style="padding:8px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;font-weight:700;">'+ccStores().map(function(s){ return '<option value="'+escapeHtml(s)+'"'+(_cc.store===s?' selected':'')+'>'+ccEmoji(s)+' '+escapeHtml(s)+'</option>'; }).join('')+'</select>';
        h+='<input type="date" value="'+escapeHtml(_cc.date||'')+'" max="'+ccTodayIso()+'" onchange="ccPickDate(this.value)" style="border:1px solid #cdd5e0;border-radius:8px;padding:7px 9px;font-size:12.5px;">';
        if(_cc.date!==ccTodayIso()) h+='<button onclick="ccPickDate(&quot;&quot;)" style="background:#eef0f3;border:none;border-radius:8px;padding:7px 11px;font-size:12px;font-weight:700;cursor:pointer;">&#8634; Today</button>';
        h+='<span style="flex:1;"></span><button onclick="ccLoad()" style="background:#185FA5;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;">&#8635; Refresh</button>';
        h+='</div>';
        return h;
    }

    function ccTile(label,val,sub,ink){ return '<div style="flex:1;min-width:118px;background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:10px 12px;"><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;">'+label+'</div><div style="font-size:19px;font-weight:800;color:'+(ink||'#1f2a44')+';">'+val+'</div>'+(sub?'<div style="font-size:10.5px;color:#6b7686;margin-top:1px;">'+sub+'</div>':'')+'</div>'; }

    function ccAlertChips(t,tg){
        var st=(t&&t.status)||{}; var chips=[];
        if(st.labor){ chips.push(ccChip(st.labor,(st.labor==='red'?'&#128308; ':(st.labor==='amber'?'&#128993; ':'&#128994; '))+'Labor '+ccNum(t.labor_pct,'%')+(st.labor==='red'?' &mdash; over the '+ccNum(tg.labor_pct_hi,'%')+' ceiling':(st.labor==='amber'?' &mdash; under the '+ccNum(tg.labor_pct_lo,'%')+' floor (understaffed?)':' &mdash; in range')))); }
        if(st.sales){ chips.push(ccChip(st.sales,(st.sales==='green'?'&#128994; ':(st.sales==='amber'?'&#128993; ':'&#128308; '))+'Sales '+(t.ly_pct>=0?'+':'')+ccNum(t.ly_pct,'%')+' vs LY')); }
        if(st.splh){ chips.push(ccChip(st.splh,(st.splh==='green'?'&#128994; ':(st.splh==='amber'?'&#128993; ':'&#128308; '))+'SPLH '+ccMoney(t.splh)+' (target '+ccMoney(tg.splh_target)+')')); }
        if(st.speed){ chips.push(ccChip(st.speed,(st.speed==='green'?'&#128994; ':(st.speed==='amber'?'&#128993; ':'&#128308; '))+'Speed '+ccNum(t.speed_seconds,'s')+' (target &le;'+ccNum(tg.speed_target_seconds,'s')+')')); }
        if(!chips.length) return '';
        return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 2px;">'+chips.join('')+'</div>';
    }

    function ccSplitBar(t){
        if(t.mgr_share==null&&t.crew_share==null) return '';
        var mgr=parseFloat(t.mgr_share)||0, crew=parseFloat(t.crew_share)||0;
        var h='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:10px 12px;margin-top:8px;">';
        h+='<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;margin-bottom:6px;">Crew vs management labor</div>';
        h+='<div style="display:flex;height:14px;border-radius:99px;overflow:hidden;border:1px solid #e6ebf2;">';
        h+='<div style="width:'+crew+'%;background:#185FA5;" title="Crew"></div><div style="width:'+mgr+'%;background:#7d1d4b;" title="Management"></div></div>';
        h+='<div style="display:flex;justify-content:space-between;font-size:11px;color:#5b6675;margin-top:5px;"><span><span style="display:inline-block;width:9px;height:9px;background:#185FA5;border-radius:2px;"></span> Crew '+ccNum(t.crew_share,'%')+(t.crew_labor!=null?' ('+ccMoney(t.crew_labor)+')':'')+'</span><span><span style="display:inline-block;width:9px;height:9px;background:#7d1d4b;border-radius:2px;"></span> Mgmt '+ccNum(t.mgr_share,'%')+(t.mgr_labor!=null?' ('+ccMoney(t.mgr_labor)+')':'')+'</span></div></div>';
        return h;
    }

    function ccEmptyCard(store){
        return '<div style="background:#fff;border:1px dashed #cdd5e0;border-radius:14px;padding:26px 18px;text-align:center;color:#5b6675;">'
          +'<div style="font-size:30px;">&#128225;</div>'
          +'<b style="display:block;color:#1f2a44;margin:4px 0 3px;">No numbers yet for '+escapeHtml(store)+' on this day</b>'
          +'<div style="font-size:12.5px;line-height:1.5;">Only Roadrunner is syncing from Axial right now &mdash; other stores fill in automatically as they come online.<br>Managers can also enter numbers any time via <b>Store Scorecards</b>.</div></div>';
    }

    function ccDayRow(d,tg){
        var st=(d&&d.status)||{};
        var tr='<tr style="border-top:1px solid #f0f2f6;">';
        tr+='<td style="padding:7px 8px;font-size:12px;font-weight:700;color:#1f2a44;white-space:nowrap;">'+escapeHtml(d.dow||'')+' '+escapeHtml(String(d.date||'').slice(5))+'</td>';
        if(!d.has_data){ tr+='<td colspan="6" style="padding:7px 8px;font-size:11.5px;color:#98a2b0;">no data</td></tr>'; return tr; }
        tr+='<td style="padding:7px 8px;font-size:12.5px;font-weight:700;color:#1f2a44;">'+ccMoney(d.sales)+'</td>';
        tr+='<td style="padding:7px 8px;font-size:12px;font-weight:700;color:'+ccInk(st.sales,'#5b6675')+';">'+(d.ly_pct!=null?((d.ly_pct>=0?'&#9650; +':'&#9660; ')+d.ly_pct+'%'):'&mdash;')+'</td>';
        tr+='<td style="padding:7px 8px;font-size:12px;font-weight:800;color:'+ccInk(st.labor,'#5b6675')+';">'+ccNum(d.labor_pct,'%')+'</td>';
        tr+='<td style="padding:7px 8px;font-size:12px;font-weight:700;color:'+ccInk(st.splh,'#5b6675')+';">'+(d.splh!=null?ccMoney(d.splh):'&mdash;')+'</td>';
        tr+='<td style="padding:7px 8px;font-size:12px;color:#1f2a44;">'+ccNum(d.guests)+'</td>';
        tr+='<td style="padding:7px 8px;font-size:12px;font-weight:700;color:'+ccInk(st.speed,'#5b6675')+';">'+ccNum(d.speed_seconds,'s')+'</td>';
        tr+='</tr>';
        return tr;
    }

    function ccRender(){
        var d=_cc.data||{}; var t=d.today||{}; var tg=d.targets||{}; var days=d.days||[]; var wk=d.week||{};
        var h=ccHeader()+'<div style="max-width:860px;margin:0 auto;padding:14px 16px 60px;">';
        h+=ccControls();

        // ---- TODAY ----
        h+='<div style="display:flex;align-items:center;gap:8px;margin:2px 0 8px;"><b style="font-size:15px;color:#1f2a44;">'+ccEmoji(d.store)+' '+escapeHtml(d.store||'')+' &mdash; '+escapeHtml(ccPrettyDate(d.date))+'</b></div>';
        if(!t.has_data){ h+=ccEmptyCard(d.store||''); }
        else {
            h+='<div style="display:flex;gap:8px;flex-wrap:wrap;">';
            h+=ccTile('True labor % (incl. mgmt)',ccNum(t.labor_pct,'%'),'target '+ccNum(tg.labor_pct_lo,'')+'&ndash;'+ccNum(tg.labor_pct_hi,'%')+(t.labor_cost!=null?' &middot; '+ccMoney(t.labor_cost):''),ccInk((t.status||{}).labor));
            h+=ccTile('Sales / labor hour',t.splh!=null?ccMoney(t.splh):'&mdash;','target &ge;'+ccMoney(tg.splh_target),ccInk((t.status||{}).splh));
            h+=ccTile('Sales',ccMoney(t.sales),(t.ly_pct!=null?((t.ly_pct>=0?'&#9650; +':'&#9660; ')+t.ly_pct+'% vs LY ('+ccMoney(t.sales_ly)+')'):'no LY comparison'),ccInk((t.status||{}).sales));
            h+=ccTile('Guests',ccNum(t.guests),'');
            h+=ccTile('Speed of service',ccNum(t.speed_seconds,'s'),'target &le;'+ccNum(tg.speed_target_seconds,'s'),ccInk((t.status||{}).speed));
            h+='</div>';
            h+=ccAlertChips(t,tg);
            h+=ccSplitBar(t);
            if(t.note) h+='<div style="font-size:11.5px;color:#6b6275;margin-top:7px;">&#128221; '+escapeHtml(t.note)+'</div>';
        }

        // ---- TREND (trailing days) ----
        h+='<div style="display:flex;align-items:center;gap:8px;margin:18px 0 8px;"><b style="font-size:14px;color:#1f2a44;">Last '+(wk.days||days.length||7)+' days</b><span style="font-size:11px;color:#6b7686;">'+(wk.days_with_data||0)+' day'+((wk.days_with_data||0)===1?'':'s')+' with data</span></div>';
        if(!days.length||!(wk.days_with_data>0)){
            h+='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:18px;text-align:center;color:#98a2b0;font-size:12.5px;">No history yet for this window.</div>';
        } else {
            h+='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;overflow:auto;"><table style="width:100%;border-collapse:collapse;min-width:560px;">';
            h+='<thead><tr>'+['Day','Sales','vs LY','Labor %','SPLH','Guests','Speed'].map(function(c){ return '<th style="text-align:left;padding:8px;font-size:10px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;">'+c+'</th>'; }).join('')+'</tr></thead><tbody>';
            for(var i=days.length-1;i>=0;i--){ h+=ccDayRow(days[i],tg); }
            h+='</tbody></table></div>';
            // week summary strip
            h+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">';
            h+=ccTile('Sales ('+(wk.days||7)+'d)',ccMoney(wk.sales_total),(wk.ly_pct!=null?((wk.ly_pct>=0?'&#9650; +':'&#9660; ')+wk.ly_pct+'% vs LY'):''),(wk.ly_pct!=null?(wk.ly_pct>=0?'#1b7a3d':'#a01b3e'):'#1f2a44'));
            h+=ccTile('Avg labor %',ccNum(wk.labor_pct_wavg,'%'),'sales-weighted',(wk.labor_pct_wavg!=null?(wk.labor_pct_wavg>parseFloat(tg.labor_pct_hi||23)?'#a01b3e':'#1b7a3d'):'#1f2a44'));
            h+=ccTile('Avg SPLH',wk.splh_avg!=null?ccMoney(wk.splh_avg):'&mdash;','');
            h+=ccTile('Guests ('+(wk.days||7)+'d)',ccNum(wk.guests_total),'');
            h+='</div>';
        }

        h+='<div style="font-size:10.5px;color:#98a2b0;text-align:center;margin-top:16px;">True labor includes management &middot; thresholds adjustable in Business Settings (targets + cc_config) &middot; data from Axial sync + Store Scorecards</div>';
        h+='</div>';
        ccOv().innerHTML=h;
    }

    // ============================================================
    // PHASE 2 -- LABOR-AWARE SCHEDULING HOOK (globals for js/03)
    // laborProjection: pure math + config, no network. Server stays the
    // authority for ACTUAL labor; this is a live scheduling preview only.
    // ============================================================
    function laborProjection(store,dateISO,scheduledHours,avgRate,projectedSales){
        var target=(typeof cfgNum==='function'?cfgNum('targets','labor_pct',25):25);
        var near=(typeof cfgNum==='function'?cfgNum('cc_config','cc_proj_near_pp',2):2);
        var hrs=parseFloat(scheduledHours)||0, rate=parseFloat(avgRate)||0, sales=parseFloat(projectedSales)||0;
        var cost=hrs*rate;
        var pct=(sales>0)?(cost/sales*100):null;
        var delta=(pct!=null)?Math.round((pct-target)*10)/10:null;
        var status=(pct==null)?'unknown':(pct>target?'over':(pct>=target-near?'near':'ok'));
        return { projLaborPct:(pct!=null)?Math.round(pct*10)/10:null, target:target, delta:delta, status:status, laborCost:Math.round(cost*100)/100 };
    }
    function laborProjectionChip(store,dateISO,scheduledHours,avgRate,projectedSales){
        var p=laborProjection(store,dateISO,scheduledHours,avgRate,projectedSales);
        if(p.projLaborPct==null) return '';
        var col=(p.status==='over')?'#c0392b':((p.status==='near')?'#b06a00':'#1f7a3d');
        return '<div style="font-size:10px;font-weight:700;color:'+col+';" title="Projected labor vs the '+p.target+'% target ('+(p.delta>=0?'+':'')+p.delta+' pts, ~$'+Math.round(p.laborCost).toLocaleString()+' labor)">proj '+p.projLaborPct.toFixed(1)+'% vs '+p.target+'%</div>';
    }
