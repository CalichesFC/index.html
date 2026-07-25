// ============================================================
// R-08 OPERATIONAL DEAD-END FIXES  (js/40_r08_fixes.js)
// Self-contained, append-only module: it edits NO other file (not index.html,
// not rpc_manifest.json, not any existing js/*). Screen entry is hooked by
// append-only wraps of the global functions — the same proven pattern as
// js/38 (hookOpen) and js/39. Backend companion: migrations/0005_r08_dead_ends.sql.
//
// WHAT IT FIXES (each block independently fail-safe; any error renders nothing
// and never throws onto a screen):
//   1) SCHEDULE CONFLICTS were write-only: "Something is wrong with my
//      schedule" saved a note into schedule_conflicts that NO screen ever
//      read. Injects a "Flagged conflicts" panel into the manager's Schedule
//      confirmations modal (wrap of openWeekConfirms) plus a banner on the
//      schedule builder (wrap of openScheduling), backed by the new
//      app_week_conflicts_list / app_week_conflict_resolve RPCs. If the
//      backend isn't deployed yet, nothing is rendered.
//   2) MAINTENANCE ROUTING: the legacy "Report a Repair" form only reached
//      maintenance_logs (Manager Dashboard tab) — never the live Work Orders
//      queue that maintenance actually works. Wraps submitMaintenance to ALSO
//      file a real work order via the existing app_wo_create (+photos via
//      app_wo_add_photo), with a duplicate-guard so a retry after a PDF-server
//      failure can't double-file. The legacy PDF/email path still runs.
//   3) SUPPLY REQUESTS had no decline/cancel anywhere: the only path was the
//      linear Submitted→…→Closed chain, so bad requests sat forever. Adds an
//      office "Decline" (existing app_supply_advance) and a requester
//      "Cancel my request" (new app_supply_cancel) to the detail modal, fixes
//      the status filter (it offered never-produced statuses and was missing
//      'Fulfilling'), and gives Declined/Cancelled real colors and a banner.
//   4) SILENT SAVE FAILURES, surfaced with clear messages (each replacement is
//      fingerprint-checked: if the original was already fixed/changed, we
//      leave it alone):
//        - lmsRecord (js/08): showed the full "you passed!" screen even when
//          app_lp_complete returned an error — training silently unrecorded.
//        - _scMaybeComplete (js/01): SCORM completion swallowed errors AND
//          set done=true first, so a failed save never retried.
//        - clockBreakToggle (js/05): no .catch — a connection blip meant the
//          break was never recorded and nobody was told.
//        - schedSetForecast (js/03): app_labor_set failures were ignored; the
//          grid showed a forecast that was never saved.
//
// FAIL-SAFE ABSOLUTELY: auto-rendering panels use ONLY the cached session PIN
// (never prompt). Click-initiated actions use the app's own withPin idiom.
// Every RPC is try/caught; errors always produce a visible, plain message.
// ============================================================
(function(){
    'use strict';
    try{ if (typeof window === 'undefined') return; if (window.__r08FixesInjected) return; window.__r08FixesInjected = true; }catch(e){ return; }

    // ---------- tiny safe helpers (mirror js/38 / js/39) ----------
    function esc(s){ try{ if(typeof escapeHtml==='function') return escapeHtml(s==null?'':String(s)); }catch(e){} return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return '&#'+c.charCodeAt(0)+';'; }); }
    function assign(t,s){ try{ if(Object.assign) return Object.assign(t,s); }catch(e){} for(var k in s){ if(Object.prototype.hasOwnProperty.call(s,k)) t[k]=s[k]; } return t; }
    function byId(id){ try{ return document.getElementById(id); }catch(e){ return null; } }
    function pinCached(){
        try{ if(typeof sessionPin!=='undefined' && sessionPin) return sessionPin; }catch(e){}
        try{ if(typeof localStorage!=='undefined' && localStorage.getItem('calichesKeep')!=='0'){ var kp=sessionStorage.getItem('calichesPin'); if(kp) return kp; } }catch(e){}
        return null;
    }
    function hasCreds(){
        try{ return !!(typeof supabaseClient!=='undefined' && supabaseClient && typeof currentUser!=='undefined' && currentUser && currentUser.username && pinCached()); }catch(e){ return false; }
    }
    // Quiet RPC for auto-rendered panels: cached PIN only, never prompts.
    function quietRpc(name,args,cb,onerr){
        try{
            if(!hasCreds()){ if(onerr) onerr({message:'nocreds'}); return; }
            supabaseClient.rpc(name, assign({p_username:currentUser.username, p_password:pinCached()}, args||{}))
                .then(function(res){ try{ if(res && res.error){ if(onerr) onerr(res.error); return; } cb(res?res.data:null); }catch(e){ if(onerr) onerr({message:'render'}); } })
                .catch(function(){ if(onerr) onerr({message:'connection'}); });
        }catch(e){ if(onerr) onerr({message:'connection'}); }
    }
    // PIN-prompting RPC for click-initiated actions (the app's withPin idiom).
    function pinRpc(name,args,cb,onerr){
        try{
            var run=function(pin){
                try{
                    supabaseClient.rpc(name, assign({p_username:currentUser.username, p_password:pin}, args||{}))
                        .then(function(res){ try{ if(res && res.error){ if(onerr) onerr(res.error); return; } cb(res?res.data:null); }catch(e){ if(onerr) onerr({message:'render'}); } })
                        .catch(function(){ if(onerr) onerr({message:'connection'}); });
                }catch(e){ if(onerr) onerr({message:'connection'}); }
            };
            if(typeof withPin==='function'){ withPin(run, function(){ if(onerr) onerr({message:'cancelled'}); }); }
            else if(pinCached()){ run(pinCached()); }
            else if(onerr) onerr({message:'nocreds'});
        }catch(e){ if(onerr) onerr({message:'connection'}); }
    }
    function isMgrish(){
        try{ if(typeof schedIsMgr==='function') return !!schedIsMgr(); }catch(e){}
        try{ if(typeof isManagerRole==='function') return !!isManagerRole(); }catch(e){}
        try{ return /manager|admin|vice|owner/i.test((currentUser&&currentUser.role)||''); }catch(e){ return false; }
    }
    // Wrap window[fnName]: run original first, then after(sameArgs). Retries for late include.
    function hookAfter(fnName, afterFn, tries){
        try{
            var orig=null; try{ orig=window[fnName]; }catch(e){}
            if(typeof orig==='function'){
                if(!orig.__r08Wrapped){
                    var w=(function(o){ function wrapped(){ var r; try{ r=o.apply(this,arguments); }catch(e){} try{ afterFn.apply(this,arguments); }catch(e){} return r; } wrapped.__r08Wrapped=true; return wrapped; })(orig);
                    try{ window[fnName]=w; }catch(e){}
                }
                return;
            }
        }catch(e){}
        if((tries||0)<40){ try{ setTimeout(function(){ hookAfter(fnName, afterFn, (tries||0)+1); },250); }catch(e){} }
    }

    var R = {};            // public handlers (inline onclick)
    try{ window.r08 = R; }catch(e){ return; }

    // ============================================================
    // 1) SCHEDULE CONFLICTS — reader UI for the write-only table
    // ============================================================
    function conflictRowHtml(c){
        var when=''; try{ when=c.created_at?new Date(c.created_at).toLocaleDateString():''; }catch(e){}
        return '<div style="padding:8px 0;border-bottom:1px solid #f0eef4;">'
            + '<div style="display:flex;align-items:center;gap:8px;">'
            +   '<b style="flex:1;font-size:13.5px;color:#1f2a44;">'+esc(c.employee_name||('#'+c.employee_id))+'</b>'
            +   '<span style="font-size:11px;color:#8a94a6;">week of '+esc(String(c.week_start||'').slice(0,10))+(when?(' &middot; sent '+esc(when)):'')+'</span>'
            +   '<button onclick="r08.resolveConflict('+(parseInt(c.id,10)||0)+')" style="background:#e8f5ec;color:#1b7a3d;border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:800;cursor:pointer;">Resolved</button>'
            + '</div>'
            + '<div style="font-size:13px;color:#33404e;margin-top:3px;">'+(c.note?esc(c.note):'<i style="color:#8a94a6;">(no details typed)</i>')+'</div>'
            + '</div>';
    }
    function paintConflicts(boxId){
        var box=byId(boxId); if(!box) return;
        quietRpc('app_week_conflicts_list', {}, function(d){
            var list=d||[]; if(!list.length){ box.innerHTML='<div style="font-size:12px;color:#8a94a6;padding:4px 0;">No unresolved schedule conflicts. &#128077;</div>'; return; }
            var h='<div style="font-size:12px;font-weight:800;color:#a01b3e;margin-bottom:2px;">&#9888;&#65039; '+list.length+' unresolved conflict'+(list.length===1?'':'s')+' flagged by staff</div>';
            for(var i=0;i<list.length;i++) h+=conflictRowHtml(list[i]);
            box.innerHTML=h;
        }, function(){ box.innerHTML=''; });   // backend absent / no creds => stay invisible
    }
    R.resolveConflict=function(id){
        try{ if(!id) return; }catch(e){ return; }
        pinRpc('app_week_conflict_resolve', {p_id:id}, function(){
            try{ paintConflicts('r08ConflictsBody'); }catch(e){}
            try{ mountSchedBanner(); }catch(e){}
        }, function(err){ try{ alert('Could not mark it resolved: '+((err&&err.message)||'connection problem')+'. Nothing was changed — try again.'); }catch(e){} });
    };
    // (a) inside the Schedule confirmations modal
    function mountConfirmsPanel(){
        try{
            var ov=byId('weekConfirmsModal'); if(!ov || !ov.firstChild) return;
            if(!isMgrish()) return;
            var card=ov.firstChild;
            var boxWrap=byId('r08ConflictsWrap');
            if(!boxWrap){
                boxWrap=document.createElement('div'); boxWrap.id='r08ConflictsWrap';
                boxWrap.style.cssText='border-top:2px solid #f0eef4;margin-top:12px;padding-top:10px;';
                boxWrap.innerHTML='<div style="font-size:13px;font-weight:800;color:#26242b;margin-bottom:4px;">Flagged conflicts <span style="font-weight:400;color:#8a94a6;font-size:11px;">&mdash; what staff typed under &ldquo;Something is wrong with my schedule&rdquo;</span></div><div id="r08ConflictsBody"></div>';
                card.appendChild(boxWrap);
            } else if(boxWrap.parentNode!==card){ try{ card.appendChild(boxWrap); }catch(e){} }
            paintConflicts('r08ConflictsBody');
        }catch(e){}
    }
    // (b) banner on the schedule builder
    function mountSchedBanner(){
        try{
            if(!isMgrish()) return;
            var grid=byId('schedGrid'); if(!grid || !grid.parentNode) return;
            quietRpc('app_week_conflicts_list', {}, function(d){
                var n=(d||[]).length; var b=byId('r08ConflictBanner');
                if(!n){ if(b&&b.parentNode) b.parentNode.removeChild(b); return; }
                if(!b){
                    b=document.createElement('div'); b.id='r08ConflictBanner';
                    b.setAttribute('onclick','try{ openWeekConfirms(); }catch(e){}');
                    b.style.cssText='background:#fdeaea;border:1px solid #f3c2cb;color:#a01b3e;border-radius:10px;padding:9px 13px;margin:0 0 10px;font-size:13px;font-weight:700;cursor:pointer;';
                    grid.parentNode.insertBefore(b, grid);
                }
                b.innerHTML='&#9888;&#65039; '+n+' schedule conflict'+(n===1?'':'s')+' flagged by staff &mdash; tap to review &rsaquo;';
            }, function(){ /* backend absent => no banner */ });
        }catch(e){}
    }
    hookAfter('openWeekConfirms', function(){ try{ setTimeout(mountConfirmsPanel,0); }catch(e){} }, 0);
    hookAfter('openScheduling',   function(){ try{ setTimeout(mountSchedBanner,350); }catch(e){} }, 0);

    // ============================================================
    // 2) MAINTENANCE ROUTING — legacy "Report a Repair" -> Work Orders bridge
    // ============================================================
    function maintNoteEl(){
        var el=byId('r08MaintNote');
        if(!el){
            var btn=byId('submitMaintBtn');
            if(btn && btn.parentNode){ el=document.createElement('div'); el.id='r08MaintNote'; el.style.cssText='font-size:12.5px;margin-top:8px;text-align:center;'; btn.parentNode.insertBefore(el, btn.nextSibling); }
        }
        return el;
    }
    function maintNote(txt,color){ var el=maintNoteEl(); if(el){ el.style.color=color||'#6b7686'; el.innerHTML=txt||''; } }
    function hookMaintenance(tries){
        try{
            var orig=null; try{ orig=window.submitMaintenance; }catch(e){}
            if(typeof orig==='function'){
                if(orig.__r08Wrapped) return;
                var wrapped=function(){
                    var self=this, args=arguments, ranOriginal=false;
                    function runOriginal(){ if(ranOriginal) return; ranOriginal=true; try{ orig.apply(self,args); }catch(e){} }
                    try{
                        var form=byId('maintenanceForm');
                        var itemEl=form?form.querySelector('input[name="MaintenanceItem"]'):null;
                        var repEl=form?form.querySelector('input[name="ReporterName"]'):null;
                        var item=itemEl?String(itemEl.value||'').trim():'';
                        var reporter=repEl?String(repEl.value||'').trim():'';
                        if(!form || !item || !reporter){ runOriginal(); return; }   // original shows its own validation alert
                        var locEl=byId('maintLoc'); var loc=locEl?String(locEl.value||''):'';
                        var urgEl=form.querySelector('select[name="Urgency"]'); var urgRaw=urgEl?String(urgEl.value||''):'';
                        var descEl=form.querySelector('textarea[name="IssueDescription"]'); var desc=descEl?String(descEl.value||'').trim():'';
                        var pri=/high/i.test(urgRaw)?'high':(/low/i.test(urgRaw)?'low':'medium');
                        var safety=/safety/i.test(urgRaw);
                        var fp=[loc,item,desc].join('|');
                        window._r08MaintDone=window._r08MaintDone||{};
                        if(window._r08MaintDone[fp]){   // retry after a PDF-server failure: WO already filed
                            maintNote('&#9989; Already in the Work Orders queue as <b>'+esc(window._r08MaintDone[fp])+'</b> &mdash; finishing the PDF report&hellip;','#1b7a3d');
                            runOriginal(); return;
                        }
                        if(window._r08MaintBusy){ return; }
                        window._r08MaintBusy=true; setTimeout(function(){ window._r08MaintBusy=false; },12000);
                        var fallback=setTimeout(function(){ runOriginal(); },12000);   // never strand the legacy path
                        maintNote('Routing to the Work Orders queue&hellip;','#6b7686');
                        pinRpc('app_wo_create',{
                            p_title:'Repair: '+item,
                            p_description:(desc?desc+'\n':'')+'Reported by '+reporter+(urgRaw?(' — urgency: '+urgRaw):'')+'\n(Filed via the Report a Repair form; PDF also emailed to the office.)',
                            p_asset_id:null, p_asset_label:item, p_location:loc||null,
                            p_category:'repair', p_priority:pri, p_equipment_use_status:null, p_safety_impact:safety
                        }, function(d){
                            clearTimeout(fallback); window._r08MaintBusy=false;
                            var won=(d&&d.wo_number)||'';
                            window._r08MaintDone[fp]=won||'WO';
                            maintNote('&#9989; Added to the Work Orders queue'+(won?(' as <b>'+esc(won)+'</b>'):'')+' &mdash; maintenance will see it. Finishing the PDF report&hellip;','#1b7a3d');
                            try{   // best-effort photos onto the work order
                                var ph=[]; try{ if(typeof maintPhotos!=='undefined' && maintPhotos && maintPhotos.length) ph=maintPhotos.slice(0,6); }catch(e){}
                                if(won && ph.length){ var i=0; (function up(){ if(i>=ph.length) return; pinRpc('app_wo_add_photo',{p_wo_number:won,p_photo:ph[i]},function(){ i++; up(); },function(){ i++; up(); }); })(); }
                            }catch(e){}
                            runOriginal();
                        }, function(err){
                            clearTimeout(fallback); window._r08MaintBusy=false;
                            var m=(err&&err.message)||'connection problem';
                            if(m==='cancelled'||m==='nocreds'){ maintNote('&#9888;&#65039; Not added to the Work Orders queue (PIN not confirmed). The PDF report is still being emailed &mdash; a manager should file a work order for this repair.','#a05a00'); }
                            else{ maintNote('&#9888;&#65039; Could not add this to the Work Orders queue ('+esc(m)+'). The PDF report is still being emailed &mdash; a manager should file a work order for this repair.','#a05a00'); }
                            runOriginal();
                        });
                    }catch(e){ runOriginal(); }
                };
                wrapped.__r08Wrapped=true;
                try{ window.submitMaintenance=wrapped; }catch(e){}
                return;
            }
        }catch(e){}
        if((tries||0)<40){ try{ setTimeout(function(){ hookMaintenance((tries||0)+1); },250); }catch(e){} }
    }
    hookMaintenance(0);

    // ============================================================
    // 3) SUPPLY REQUESTS — decline / cancel path + honest status vocabulary
    // ============================================================
    var SUPPLY_FLOW=['','Submitted','Assigned','Fulfilling','In transit','Received','Closed','Declined','Cancelled'];
    // colors for the two statuses the original map doesn't know
    (function(){
        try{
            var orig=window.supplyStatusColor;
            if(typeof orig==='function' && !orig.__r08Wrapped){
                var w=function(sx){ if(sx==='Declined') return '#c0264b'; if(sx==='Cancelled') return '#6b7686'; try{ return orig(sx); }catch(e){ return '#6b7686'; } };
                w.__r08Wrapped=true; window.supplyStatusColor=w;
            }
        }catch(e){}
    })();
    // status filter: only statuses this app can actually produce (or that exist in the data)
    hookAfter('supplyRenderRows', function(scope){
        try{
            if(scope!=='incoming') return;
            var box=byId('supplyIncomingList'); if(!box) return;
            var sel=box.querySelector('select[onchange*="_supplyFilter.status"]'); if(!sel) return;
            var have={}; var all=(window._supplyData&&window._supplyData.incoming)||[];
            for(var i=0;i<all.length;i++){ if(all[i]&&all[i].status) have[all[i].status]=true; }
            var f=(window._supplyFilter||{}); var cur=f.status||'';
            var opts=SUPPLY_FLOW.slice();
            for(var k in have){ if(Object.prototype.hasOwnProperty.call(have,k) && opts.indexOf(k)<0) opts.push(k); }
            if(cur && opts.indexOf(cur)<0) opts.push(cur);
            var h=''; for(var j=0;j<opts.length;j++){ var v=opts[j]; h+='<option value="'+esc(v)+'"'+(cur===v?' selected':'')+'>'+(v?esc(v):'All statuses')+'</option>'; }
            sel.innerHTML=h;
        }catch(e){}
    }, 0);
    // detail modal: banner for finished-by-decline + the two ways out
    hookAfter('supplyRenderDetail', function(d){
        try{
            if(!d) return;
            var body=byId('supplyDetailBody'); if(!body) return;
            var st=String(d.status||'');
            if(st==='Declined'||st==='Cancelled'){
                var b=document.createElement('div');
                b.style.cssText='background:'+(st==='Declined'?'#fdeaea':'#eef0f3')+';border:1px solid '+(st==='Declined'?'#f3c2cb':'#d6deea')+';color:'+(st==='Declined'?'#a01b3e':'#5b6472')+';border-radius:10px;padding:9px 12px;margin-bottom:10px;font-size:13px;font-weight:700;';
                b.innerHTML=(st==='Declined'?'&#10060; This request was declined by the office.':'&#8998; This request was cancelled.')+' <span style="font-weight:400;">Details are in the notes above. Submit a new request if the store still needs these items.</span>';
                body.insertBefore(b, body.firstChild);
                return;
            }
            var active=['Submitted','Assigned','Fulfilling','In transit'].indexOf(st)>=0;
            if(!active) return;
            var id=window._supplyDetailId; if(!id) return;
            var wrap=document.createElement('div');
            wrap.style.cssText='border-top:1px solid #eef0f5;margin-top:12px;padding-top:10px;';
            var h='';
            if(d.can_manage){
                h+='<button onclick="r08.supplyDecline('+id+')" style="width:100%;background:#fff;border:1.5px solid #c0264b;color:#c0264b;font-weight:800;padding:10px;border-radius:9px;cursor:pointer;font-size:13.5px;">&#10060; Decline / cancel this request</button>'
                 + '<div style="font-size:11px;color:#8a94a6;margin-top:4px;text-align:center;">For duplicates or requests that can&rsquo;t be filled &mdash; the requester keeps the reason in the notes.</div>';
            } else if(st==='Submitted'){
                var mine=false; try{ mine=!!(currentUser && currentUser.name && d.requester_name===currentUser.name); }catch(e){}
                if(mine){
                    h+='<button onclick="r08.supplyCancelMine('+id+')" style="width:100%;background:#fff;border:1.5px solid #6b7686;color:#5b6472;font-weight:800;padding:10px;border-radius:9px;cursor:pointer;font-size:13.5px;">&#8998; Cancel my request</button>'
                     + '<div style="font-size:11px;color:#8a94a6;margin-top:4px;text-align:center;">You can cancel while it&rsquo;s still Submitted. After that, ask the office.</div>';
                }
            }
            if(!h) return;
            wrap.innerHTML=h; body.appendChild(wrap);
        }catch(e){}
    }, 0);
    function supplyRefreshAround(id){
        try{ if(typeof supplyOpenDetail==='function') supplyOpenDetail(id); }catch(e){}
        try{ var inc=byId('supplyPanel-incoming'); if(inc&&inc.style.display!=='none'&&typeof supplyLoadList==='function') supplyLoadList('incoming'); }catch(e){}
        try{ var mine=byId('supplyPanel-mine'); if(mine&&mine.style.display!=='none'&&typeof supplyLoadList==='function') supplyLoadList('mine'); }catch(e){}
    }
    R.supplyDecline=function(id){
        try{
            var note=prompt('Decline this supply request?\n\nReason (required — the requester will see it in the notes):','');
            if(note===null) return;
            note=String(note||'').trim();
            if(!note){ alert('A short reason is required so the store knows why.'); return; }
            pinRpc('app_supply_advance',{p_request_id:id,p_new_status:'Declined',p_note:note},function(){
                supplyRefreshAround(id);
            },function(err){ alert('Could not decline: '+((err&&err.message)||'connection problem')+'. Nothing was changed.'); });
        }catch(e){}
    };
    R.supplyCancelMine=function(id){
        try{
            if(!confirm('Cancel your supply request? The office will stop working on it.')) return;
            var note=prompt('Optional note (why it’s no longer needed):','')||'';
            pinRpc('app_supply_cancel',{p_request_id:id,p_note:String(note).trim()},function(){
                supplyRefreshAround(id);
            },function(err){
                var m=(err&&err.message)||'connection problem';
                if(/does not exist|not exist|404|function/i.test(m)){ alert('Cancelling isn’t available yet on this version — ask a manager to decline it from the Incoming tab.'); }
                else{ alert('Could not cancel: '+m+'. Nothing was changed.'); }
            });
        }catch(e){}
    };

    // ============================================================
    // 4) SILENT SAVE FAILURES — fingerprint-checked replacements
    //    (if the original changed since this was written, we leave it alone)
    // ============================================================
    function srcOf(fn){ try{ return String(fn); }catch(e){ return ''; } }

    // 4a) lmsRecord: quiz result screen used to show even when app_lp_complete errored.
    function fixLmsRecord(tries){
        try{
            var orig=window.lmsRecord;
            if(typeof orig==='function'){
                var s=srcOf(orig);
                if(s.indexOf('app_lp_complete')>=0 && s.indexOf('.error')<0 && !orig.__r08Fixed){
                    var repl=function(courseId,score,pass,correct,total,responses){
                        try{
                            withPin(function(pin){
                                supabaseClient.rpc('app_lp_complete',{p_username:currentUser.username,p_password:pin,p_course_id:courseId,p_score:score,p_passed:pass,p_responses:(responses||[])}).then(function(r){
                                    if(r&&r.error){ var msg=byId('lmsQuizMsg'); if(msg){ msg.style.color='#c0264b'; msg.textContent='Your result was NOT saved: '+(r.error.message||'error')+' — your answers are still here, tap Submit again.'; } else { alert('Your quiz result was NOT saved: '+(r.error.message||'error')+'. Tap Submit again.'); } return; }
                                    Promise.all([supabaseClient.rpc('app_lp_my',{p_username:currentUser.username,p_password:pin}),supabaseClient.rpc('app_lp_gamify',{p_username:currentUser.username,p_password:pin})]).then(function(gr){
                                        try{
                                            if(gr[0]&&gr[0].data) _lms.my=gr[0].data;
                                            if(gr[1]&&gr[1].data) _lms.gamify=gr[1].data;
                                        }catch(e){}
                                        lmsResult(courseId,score,pass,correct,total,(r&&r.data)?r.data:null);
                                    }).catch(function(){ try{ lmsResult(courseId,score,pass,correct,total,(r&&r.data)?r.data:null); }catch(e){} });   // refresh failed but the completion IS saved
                                }).catch(function(){ var msg=byId('lmsQuizMsg'); if(msg){ msg.style.color='#c0264b'; msg.textContent='Could not save (connection). Your answers are still here — tap Submit again.'; } });
                            });
                        }catch(e){ try{ orig(courseId,score,pass,correct,total,responses); }catch(_){} }
                    };
                    repl.__r08Fixed=true;
                    window.lmsRecord=repl;
                }
                return;
            }
        }catch(e){}
        if((tries||0)<40){ try{ setTimeout(function(){ fixLmsRecord((tries||0)+1); },250); }catch(e){} }
    }
    fixLmsRecord(0);

    // 4b) _scMaybeComplete (SCORM): done=true was set before the save and errors were
    //     swallowed, so a failed save was lost forever with no message.
    function fixScorm(tries){
        try{
            var orig=window._scMaybeComplete;
            if(typeof orig==='function'){
                var s=srcOf(orig);
                if(s.indexOf('app_lp_complete')>=0 && s.indexOf('error')<0 && !orig.__r08Fixed){
                    var repl=function(){
                        try{
                            if(typeof _scorm==='undefined' || !_scorm || _scorm.done) return;
                            var st=String((typeof _scStr==='function'?_scStr():'')).toLowerCase();
                            if(st!=='passed' && st!=='completed') return;
                            _scorm.done=true;
                            var sc=(typeof _scScore==='function'?_scScore():null); var cid=_scorm.cid;
                            withPin(function(pin){
                                supabaseClient.rpc('app_lp_complete',{p_username:currentUser.username,p_password:pin,p_course_id:cid,p_score:sc,p_passed:(st==='passed'||(sc!=null&&sc>=80)),p_responses:[{q:'SCORM module',type:'scorm',answer:st,score:sc}]}).then(function(r){
                                    if(r&&r.error){ _scorm.done=false; r08ScormWarn('Your module finished but the completion was NOT saved ('+(r.error.message||'error')+'). Keep this screen open — it will retry — or tell a manager.'); }
                                }).catch(function(){ _scorm.done=false; r08ScormWarn('Your module finished but the completion could not be saved (connection). Keep this screen open — it will retry — or tell a manager.'); });
                            });
                        }catch(e){}
                    };
                    repl.__r08Fixed=true;
                    window._scMaybeComplete=repl;
                }
                return;
            }
        }catch(e){}
        if((tries||0)<40){ try{ setTimeout(function(){ fixScorm((tries||0)+1); },250); }catch(e){} }
    }
    function r08ScormWarn(msg){
        try{
            var now=Date.now();
            if(window._r08ScormWarnAt && (now-window._r08ScormWarnAt)<30000) return;   // don't nag on every SCORM commit
            window._r08ScormWarnAt=now;
            alert(msg);
        }catch(e){}
    }
    fixScorm(0);

    // 4c) clockBreakToggle: no .catch — a connection blip silently skipped the break punch.
    function fixBreakToggle(tries){
        try{
            var orig=window.clockBreakToggle;
            if(typeof orig==='function'){
                var s=srcOf(orig);
                if(s.indexOf('app_break_end')>=0 && s.indexOf('.catch')<0 && !orig.__r08Fixed){
                    var repl=function(){
                        try{
                            var emp=(typeof clockSelectedEmp==='function')?clockSelectedEmp():null; if(!emp) return;
                            if(window._clockBusy) return; window._clockBusy=true; var done=function(){ window._clockBusy=false; }; setTimeout(done,8000);
                            var onBreak=false; try{ onBreak=!!(clockState && clockState.status && clockState.status.open_punch && clockState.status.open_punch.open_break_start); }catch(e){}
                            withPin(function(pin){
                                var params={p_username:currentUser.username,p_password:pin,p_employee_id:emp};
                                var handle=function(res){ done(); try{ var data=res?res.data:null, error=res?res.error:null; if(error){ alert('Error: '+error.message); return; } if(data && data.ok===false){ alert(data.error||'Could not complete.'); } if(typeof clockRefreshStatus==='function') clockRefreshStatus(); }catch(e){} };
                                var fail=function(){ done(); alert('Connection problem — the break was NOT recorded. Check the Wi-Fi and tap it again.'); };
                                if(onBreak) supabaseClient.rpc('app_break_end',params).then(handle).catch(fail);
                                else supabaseClient.rpc('app_break_start',params).then(handle).catch(fail);
                            }, function(){ done(); });
                        }catch(e){ try{ window._clockBusy=false; }catch(_){} try{ orig(); }catch(_){} }
                    };
                    repl.__r08Fixed=true;
                    window.clockBreakToggle=repl;
                }
                return;
            }
        }catch(e){}
        if((tries||0)<40){ try{ setTimeout(function(){ fixBreakToggle((tries||0)+1); },250); }catch(e){} }
    }
    fixBreakToggle(0);

    // 4d) schedSetForecast: app_labor_set failures were ignored — the grid showed a
    //     forecast number that was never saved and vanished on reload.
    function fixForecast(tries){
        try{
            var orig=window.schedSetForecast;
            if(typeof orig==='function'){
                var s=srcOf(orig);
                if(s.indexOf('app_labor_set')>=0 && s.indexOf('error')<0 && !orig.__r08Fixed){
                    var repl=function(ds,val){
                        try{
                            var amt=parseFloat(val); if(isNaN(amt)) return;
                            schedState.forecast=schedState.forecast||{};
                            var had=Object.prototype.hasOwnProperty.call(schedState.forecast,ds); var prev=schedState.forecast[ds];
                            schedState.forecast[ds]=amt;
                            var revert=function(){ try{ if(had) schedState.forecast[ds]=prev; else delete schedState.forecast[ds]; if(typeof renderScheduleGrid==='function') renderScheduleGrid(); }catch(e){} };
                            withPin(function(pin){
                                supabaseClient.rpc('app_labor_set',{p_username:currentUser.username,p_password:pin,p_location:schedState.location,p_date:ds,p_amount:amt}).then(function(r){
                                    if(r&&r.error){ revert(); alert('Forecast NOT saved: '+(r.error.message||'error')+'. The number was put back — try again.'); }
                                }).catch(function(){ revert(); alert('Forecast NOT saved (connection problem). The number was put back — try again.'); });
                            }, function(){ revert(); });
                        }catch(e){ try{ orig(ds,val); }catch(_){} }
                    };
                    repl.__r08Fixed=true;
                    window.schedSetForecast=repl;
                }
                return;
            }
        }catch(e){}
        if((tries||0)<40){ try{ setTimeout(function(){ fixForecast((tries||0)+1); },250); }catch(e){} }
    }
    fixForecast(0);

    // ---------- safety net: if the confirmations modal is already open, mount now ----------
    try{ var _wc=byId('weekConfirmsModal'); if(_wc && _wc.style && _wc.style.display==='flex') setTimeout(mountConfirmsPanel,0); }catch(e){}
})();
