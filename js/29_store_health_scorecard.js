    // ============================================================
    // STORE HEALTH SCORECARD  (js/29_store_health_scorecard.js)
    // Entry: openStoreHealthScorecard()   Tile: btn-storeHealth (target)
    // Overlay id: shsModal (full-screen, mirrors js/26 ccOv + js/28 macOv).
    // Store-management-gated (managers + Assistant Manager). The backend RPC is
    // the real gate and returns 'forbidden' for front-line users -> shown inline
    // as "Managers only." (never a dead screen).
    //
    // BACKEND CONTRACT (must agree with GO_LIVE_5_STORE_HEALTH_SCORECARD.sql):
    //   app_store_health_scorecard(p_username,p_password,p_location,p_date) ->
    //   { location, date, status:'ok'|'insufficient_data', has_data,
    //     overall:{ score(0-100|null), band:'green'|'yellow'|'red'|'gray', label },
    //     trend:{ direction:'up'|'down'|'flat'|'none', delta, prior_score, prior_date },
    //     freshness:{ metric_date, days_old, stale, source },
    //     note,
    //     categories:[ {key,label,score,band,driver,source,proxy} ] (the 4 #1s),
    //     pillars:[ {key,label,weight,score,band,included,note} ] (8 SPEC cats),
    //     actions:[ {label,target,severity} ],  weights, generated_at }
    // Action targets map to LIVE Hub entry points (connect, never duplicate):
    //   command_center->openCommandCenter, manager_action_center->openManagerActionCenter,
    //   work_orders->openWorkOrders, scorecards->openScorecards.
    // ============================================================
    var _shs = { store:'', date:'', data:null };
    var SHS_ACTION_FN = { command_center:'openCommandCenter', manager_action_center:'openManagerActionCenter', work_orders:'openWorkOrders', scorecards:'openScorecards' };

    // Credential wrapper — identical pattern to scRpc/ccRpc/macRpc: withPin +
    // p_username/p_password merged into the args, 'forbidden' surfaced kindly.
    function shsRpc(name,args,cb,onerr){ withPin(function(pin){ supabaseClient.rpc(name,Object.assign({p_username:currentUser.username,p_password:pin},args||{})).then(function(r){ if(r.error){ if(onerr)onerr(r.error); else alert(String(r.error.message||'').indexOf('forbidden')>=0?'Managers only.':r.error.message); return; } cb(r.data); }).catch(function(){ if(onerr)onerr({message:'Connection error'}); else alert('Connection error.'); }); }); }

    function shsOv(){ var o=document.getElementById('shsModal'); if(!o){ o=document.createElement('div'); o.id='shsModal'; o.style.cssText='position:fixed;inset:0;background:#f4f5f8;z-index:100050;overflow:auto;'; document.body.appendChild(o); } o.style.display='block'; return o; }
    function shsClose(){ var o=document.getElementById('shsModal'); if(o) o.style.display='none'; }
    // On-brand header gradient: Caliche's pink (#EC3E7E) -> blue (#106AB3).
    function shsHeader(){ return '<div style="background:linear-gradient(120deg,#EC3E7E,#106AB3);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:3;"><b style="flex:1;font-size:16px;">&#128737;&#65039; Store Health Scorecard</b><button onclick="shsClose()" style="background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;">&times;</button></div>'; }

    // Broad UI gate (mirror macCanSee). The RPC still enforces the real rule.
    // Store management = managers + Assistant Manager (SPEC §4 / Clarifications §4.3).
    function shsCanSee(){ if(!currentUser) return false; if(currentUser.is_developer===true) return true; if(typeof isManagerRole==='function'&&isManagerRole()) return true; var r=String(currentUser.role||'').toLowerCase(); return r.indexOf('manager')>=0||r.indexOf('admin')>=0||r.indexOf('owner')>=0||r.indexOf('vp')>=0||r.indexOf('vice president')>=0; }
    function shsStores(){ return (typeof HUB_STORES!=='undefined'?HUB_STORES:['Roadrunner','Valley','Lenox','Alamogordo','Roswell']); }
    function shsEmoji(loc){ return (typeof hubStoreEmoji==='function'?hubStoreEmoji(loc):'&#128205;'); }
    function shsTodayIso(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }

    // Band -> colors (mirror ccStatusCol; our bands are green/yellow/red/gray).
    function shsBandBg(b){ return b==='red'?'#fdeaea':(b==='yellow'?'#fff4e0':(b==='green'?'#e8f5ec':'#eef0f3')); }
    function shsInk(b,fb){ return b==='red'?'#a01b3e':(b==='yellow'?'#9a5b00':(b==='green'?'#1b7a3d':(fb||'#5b6675'))); }
    function shsDot(b){ return '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+shsInk(b,'#c3ccd8')+';"></span>'; }
    function shsScoreTxt(n){ return (n==null||n===''||isNaN(parseFloat(n)))?'&mdash;':String(Math.round(parseFloat(n))); }
    function shsPrettyDate(s){ if(!s) return ''; var p=String(s).slice(0,10).split('-'); if(p.length!==3) return String(s); var dt=new Date(+p[0],+p[1]-1,+p[2]); if(isNaN(dt.getTime())) return String(s); return dt.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}); }

    function openStoreHealthScorecard(){
        if(!shsCanSee()){ alert('The Store Health Scorecard is for store management and leadership.'); return; }
        if(!_shs.store){ var a=(typeof activeStoreLoc==='function'?activeStoreLoc():'')||''; _shs.store=(shsStores().indexOf(a)>=0)?a:shsStores()[0]; }
        if(!_shs.date) _shs.date=shsTodayIso();
        shsLoad();
    }
    function shsPickStore(loc){ _shs.store=loc; shsLoad(); }
    function shsPickDate(v){ _shs.date=v||shsTodayIso(); shsLoad(); }
    function shsGo(target){ var n=SHS_ACTION_FN[target]; shsClose(); if(n && typeof window[n]==='function') window[n](); }

    function shsLoad(){
        var ov=shsOv();
        ov.innerHTML=shsHeader()+'<div style="max-width:860px;margin:0 auto;padding:40px 16px;text-align:center;color:#6b7686;">Loading store health&hellip;</div>';
        shsRpc('app_store_health_scorecard',{p_location:_shs.store,p_date:_shs.date},function(d){ _shs.data=d||{}; shsRender(); },function(e){
            var msg=String((e&&e.message)||'');
            var body=(msg.indexOf('forbidden')>=0)
              ? '<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:30px;text-align:center;color:#6b6275;">&#128274; Managers only.</div>'
              : '<div style="background:#fff;border:1px solid #ececf2;border-radius:12px;padding:24px;text-align:center;color:#a01b3e;">'+escapeHtml(msg||'Could not load.')+'</div>';
            ov.innerHTML=shsHeader()+'<div style="max-width:860px;margin:0 auto;padding:16px;">'+shsControls()+body+'</div>';
        });
    }

    function shsControls(){
        var h='<div style="background:#fff;border:1px solid #e6ebf2;border-radius:12px;padding:10px 12px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">';
        h+='<select onchange="shsPickStore(this.value)" style="padding:8px;border:1px solid #cdd5e0;border-radius:8px;font-size:13px;font-weight:700;">'+shsStores().map(function(s){ return '<option value="'+escapeHtml(s)+'"'+(_shs.store===s?' selected':'')+'>'+shsEmoji(s)+' '+escapeHtml(s)+'</option>'; }).join('')+'</select>';
        h+='<input type="date" value="'+escapeHtml(_shs.date||'')+'" max="'+shsTodayIso()+'" onchange="shsPickDate(this.value)" style="border:1px solid #cdd5e0;border-radius:8px;padding:7px 9px;font-size:12.5px;">';
        if(_shs.date!==shsTodayIso()) h+='<button onclick="shsPickDate(&quot;&quot;)" style="background:#eef0f3;border:none;border-radius:8px;padding:7px 11px;font-size:12px;font-weight:700;cursor:pointer;">&#8634; Today</button>';
        h+='<span style="flex:1;"></span><button onclick="shsLoad()" style="background:#106AB3;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;">&#8635; Refresh</button>';
        h+='</div>';
        return h;
    }

    // Big overall-score gauge + label + trend chip.
    function shsScoreCard(o,tr){
        var b=(o&&o.band)||'gray'; var ink=shsInk(b,'#5b6675'); var bg=shsBandBg(b);
        var trend='';
        if(tr){ if(tr.direction==='up') trend='<span style="color:#1b7a3d;font-weight:800;">&#9650; +'+shsScoreTxt(tr.delta)+'</span>';
            else if(tr.direction==='down') trend='<span style="color:#a01b3e;font-weight:800;">&#9660; '+shsScoreTxt(tr.delta)+'</span>';
            else if(tr.direction==='flat') trend='<span style="color:#5b6675;font-weight:800;">&#8212; no change</span>';
            if(trend && tr.prior_score!=null) trend+='<span style="color:#98a2b0;font-weight:600;"> vs '+shsScoreTxt(tr.prior_score)+' on '+escapeHtml(shsPrettyDate(tr.prior_date))+'</span>'; }
        var h='<div style="background:#fff;border:1px solid #e6ebf2;border-radius:14px;padding:16px;display:flex;align-items:center;gap:16px;margin-bottom:12px;">';
        h+='<div style="width:96px;height:96px;border-radius:50%;border:8px solid '+ink+';background:'+bg+';display:flex;flex-direction:column;align-items:center;justify-content:center;flex:none;">'
            +'<div style="font-size:30px;font-weight:900;color:'+ink+';line-height:1;">'+shsScoreTxt(o&&o.score)+'</div>'
            +'<div style="font-size:9px;font-weight:800;color:'+ink+';letter-spacing:.5px;">/ 100</div></div>';
        h+='<div style="flex:1;min-width:0;">'
            +'<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;">Overall store health</div>'
            +'<div style="font-size:20px;font-weight:900;color:'+ink+';margin:2px 0;">'+(escapeHtml((o&&o.label)||'')||'&mdash;')+'</div>'
            +(trend?'<div style="font-size:12px;">'+trend+'</div>':'')
            +'</div></div>';
        return h;
    }

    // One of the four #1 tiles.
    function shsCatTile(c){ c=c||{}; var b=c.band||'gray'; var ink=shsInk(b,'#5b6675');
        return '<div style="flex:1;min-width:150px;background:#fff;border:1px solid #eef0f5;border-left:4px solid '+ink+';border-radius:12px;padding:11px 13px;">'
            +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">'+shsDot(b)+'<span style="font-size:11px;font-weight:800;color:#5b6675;">'+escapeHtml(c.label||'')+(c.proxy?' <span style="font-weight:600;color:#98a2b0;">(V1 proxy)</span>':'')+'</span></div>'
            +'<div style="font-size:24px;font-weight:900;color:'+ink+';line-height:1.05;">'+shsScoreTxt(c.score)+'<span style="font-size:11px;color:#98a2b0;font-weight:700;"> /100</span></div>'
            +(c.driver?'<div style="font-size:11px;color:#6b6275;margin-top:2px;">'+escapeHtml(c.driver)+'</div>':'')
            +(c.source?'<div style="font-size:10px;color:#98a2b0;margin-top:1px;">'+escapeHtml(c.source)+'</div>':'')
            +'</div>';
    }

    // One row in the eight-category "Score breakdown" (contributions + freshness).
    function shsPillarRow(p){ p=p||{}; var b=p.band||'gray'; var included=(p.included===true);
        var right= included ? '<b style="color:'+shsInk(b,'#1f2a44')+';font-size:13px;">'+shsScoreTxt(p.score)+'</b>'
                            : '<span style="font-size:10px;font-weight:800;color:#98a2b0;background:#eef0f3;padding:2px 7px;border-radius:99px;">NOT CONNECTED</span>';
        return '<div style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-top:1px solid #f0f2f6;">'
            +shsDot(included?b:'gray')
            +'<div style="flex:1;min-width:0;"><div style="font-size:12.5px;font-weight:700;color:#1f2a44;">'+escapeHtml(p.label||'')+' <span style="font-size:10px;color:#98a2b0;font-weight:600;">'+shsScoreTxt(p.weight)+'%</span></div>'
            +(p.note?'<div style="font-size:10.5px;color:#8a93a2;">'+escapeHtml(p.note)+'</div>':'')+'</div>'
            +right+'</div>';
    }

    function shsActionBtns(actions){ if(!actions||!actions.length) return '';
        var h='<div style="display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 2px;">';
        actions.forEach(function(a){ var red=(a.severity==='red');
            h+='<button onclick="shsGo(\''+String(a.target||'').replace(/[^a-z_]/g,'')+'\')" style="background:'+(red?'#fdeaea':'#eef3fb')+';color:'+(red?'#a01b3e':'#106AB3')+';border:1px solid '+(red?'#f4c9d2':'#cfe0f5')+';border-radius:9px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;">'+(red?'&#9888; ':'&#128279; ')+escapeHtml(a.label||'Open')+'</button>'; });
        h+='</div>'; return h;
    }

    function shsRender(){
        var d=_shs.data||{}; var h=shsHeader()+'<div style="max-width:860px;margin:0 auto;padding:14px 16px 60px;">';
        h+=shsControls();
        h+='<div style="display:flex;align-items:center;gap:8px;margin:2px 0 10px;"><b style="font-size:15px;color:#1f2a44;">'+shsEmoji(d.location)+' '+escapeHtml(d.location||'')+' &mdash; '+escapeHtml(shsPrettyDate(d.date))+'</b></div>';

        if(d.status==='insufficient_data' || d.has_data!==true){
            h+='<div style="background:#fff;border:1px dashed #cdd5e0;border-radius:14px;padding:28px 18px;text-align:center;color:#5b6675;">'
                +'<div style="font-size:30px;">&#128202;</div>'
                +'<b style="display:block;color:#1f2a44;margin:6px 0 3px;">Not enough data to score this store yet</b>'
                +'<div style="font-size:12.5px;line-height:1.5;">Only stores with entered / Axial-synced numbers get a health score. Missing data is never scored as a red &mdash; it just shows here as Not Connected.<br>Managers can enter numbers any time via <b>Store Scorecards</b>.</div>'
                +'<div style="display:flex;justify-content:center;margin-top:12px;">'+shsActionBtns(d.actions)+'</div></div>';
            h+='</div>'; shsOv().innerHTML=h; return;
        }

        // Overall score gauge + trend
        h+=shsScoreCard(d.overall,d.trend);

        // The four #1 tiles
        h+='<div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;margin:6px 2px 8px;">The 4 #1s</div>';
        var cats=d.categories||[];
        if(cats.length){ h+='<div style="display:flex;gap:8px;flex-wrap:wrap;">'+cats.map(shsCatTile).join('')+'</div>'; }

        // Action links (connect to live modules)
        if(d.actions && d.actions.length){
            h+='<div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;margin:16px 2px 6px;">Action needed</div>';
            h+=shsActionBtns(d.actions);
        }

        // Score breakdown (eight SPEC categories + contributions)
        h+='<div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#5b6675;letter-spacing:.3px;margin:16px 2px 4px;">Score breakdown</div>';
        h+='<div style="background:#fff;border:1px solid #eef0f5;border-radius:12px;padding:4px 12px 8px;">'+(d.pillars||[]).map(shsPillarRow).join('')+'</div>';

        // Manager context note
        if(d.note) h+='<div style="font-size:11.5px;color:#6b6275;margin-top:10px;background:#fff;border:1px solid #eef0f5;border-radius:10px;padding:10px 12px;">&#128221; '+escapeHtml(d.note)+'</div>';

        // Freshness / source footer
        var fr=d.freshness||{};
        h+='<div style="font-size:10.5px;color:#98a2b0;text-align:center;margin-top:16px;">as of '+(escapeHtml(shsPrettyDate(fr.metric_date))||'&mdash;')+(fr.stale?' &middot; <span style="color:#9a5b00;font-weight:700;">Stale</span>':' &middot; fresh')+' &middot; source: '+escapeHtml(fr.source||'Store Scorecards')+' &middot; weights & thresholds adjustable in Business Settings (scorecard_config)</div>';

        h+='</div>'; shsOv().innerHTML=h;
    }

    // Entry point exposed on window (matches js/28 openManagerActionCenter convention).
    window.openStoreHealthScorecard = openStoreHealthScorecard;
