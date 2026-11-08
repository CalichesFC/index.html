    // ============================================================
    // SHIFT COVERS  (js/48_shift_covers.js)
    // "Can't work this?" -> ask every coworker who can take it -> first yes wins ->
    // someone with "Approve shift covers" OKs it and the schedule updates itself.
    // Approvers can also start a cover on any shift; the first yes is approved right away.
    //
    // Nothing here is tied to a job title. Who can approve, and who has to give a reason,
    // are permissions set in the app (Roles & permissions, or per person on their profile):
    //   approve_cover            "Approve shift covers"
    //   approve_without_reason   "Approve covers without a reason"
    // Every rule is enforced on the server; this file only draws the screens.
    //
    // Server calls: app_my_capabilities, app_cover_candidates, app_cover_request,
    // app_cover_respond, app_cover_withdraw, app_cover_cancel, app_cover_ask_more,
    // app_cover_decide, app_cover_mine, app_cover_manage_list, app_cover_rules_get,
    // app_cover_rules_set, app_cover_week_status, app_swap_create ("Send to my manager instead").
    // ============================================================
    var _cov = { caps: null, capsUser: null, capsWait: [], pick: null, home: null, mgr: null, rules: null, homeSeq: 0 };
    var COV_REASONS = [['Sick','🤒'],['Injury','🩹'],['School / exam','🎓'],['Family','👪'],['Other','📌']];
    var COV_BLUE = '#0d6eaf', COV_GREEN = '#1f7a3d', COV_RED = '#c0264b', COV_GREY = '#6b7686';

    function covEsc(s){ try{ if(typeof escapeHtml==='function') return escapeHtml(s==null?'':String(s)); }catch(e){} return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return '&#'+c.charCodeAt(0)+';'; }); }
    function covPlural(n, one, many){ return n+' '+(n===1?one:many); }

    // Signed-in call with the session PIN. Never shows a browser popup; errors go to onerr.
    function covRpc(name, args, cb, onerr){
        try{
            if(typeof withPin!=='function' || typeof supabaseClient==='undefined' || !currentUser || !currentUser.username){ if(onerr) onerr({message:'Please sign in again.'}); return; }
            withPin(function(pin){
                var p = { p_username: currentUser.username, p_password: pin }, k; args = args || {};
                for(k in args){ if(Object.prototype.hasOwnProperty.call(args,k)) p[k] = args[k]; }
                supabaseClient.rpc(name, p).then(function(res){
                    if(res.error){ if(res.error.code==='42501'){ try{ sessionPin=null; }catch(e){} } if(onerr) onerr(res.error); return; }
                    cb(res.data);
                }).catch(function(){ if(onerr) onerr({message:'Connection error. Try again.'}); });
            }, function(){ if(onerr) onerr({message:'PIN required.'}); });
        }catch(e){ if(onerr) onerr({message:'Something went wrong. Try again.'}); }
    }

    // Background loads (Home card, caps) only run when the PIN is already remembered,
    // so they never pop the "Enter your PIN" box on their own.
    function covHasPin(){
        try{ if(typeof sessionPin!=='undefined' && sessionPin) return true; }catch(e){}
        try{ if(localStorage.getItem('calichesKeep')!=='0' && sessionStorage.getItem('calichesPin')) return true; }catch(e){}
        return false;
    }

    // ---------- What this person is allowed to do (cached per login) ----------
    function covLoadCaps(cb, force){
        var u = currentUser && currentUser.username;
        if(!u){ if(cb) cb(null); return; }
        if(!force && _cov.caps && _cov.capsUser===u){ if(cb) cb(_cov.caps); return; }
        if(!covHasPin()){ if(cb) cb(_cov.caps||null); return; }
        if(cb) _cov.capsWait.push(cb);
        if(_cov.capsWait.length > 1 && !force) return;          // a load is already on the way
        covRpc('app_my_capabilities', {}, function(d){
            _cov.caps = d || {}; _cov.capsUser = u;
            try{ currentUser.caps = _cov.caps; }catch(e){}
            covApplyCaps();
            var w = _cov.capsWait; _cov.capsWait = []; w.forEach(function(f){ try{ f(_cov.caps); }catch(e){} });
        }, function(){
            var w = _cov.capsWait; _cov.capsWait = []; w.forEach(function(f){ try{ f(_cov.caps || null); }catch(e){} });
        });
    }
    function covCan(k){ return !!(_cov.caps && _cov.caps[k] === true); }
    function covApplyCaps(){
        try{ if(covCan('approve_cover')){ var b=document.getElementById('requestsBtn'); if(b) b.style.display='block'; } }catch(e){}
    }

    // ---------- Small UI pieces ----------
    function covModal(){
        var m = document.getElementById('covModal');
        if(!m){
            m = document.createElement('div'); m.id = 'covModal';
            m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100062;display:none;align-items:center;justify-content:center;padding:14px;box-sizing:border-box;';
            document.body.appendChild(m);
        }
        return m;
    }
    function covClose(){ var m=document.getElementById('covModal'); if(m){ m.style.display='none'; m.innerHTML=''; } _cov.pick=null; }
    function covShell(inner){ return '<div style="background:#fff;border-radius:16px;max-width:460px;width:100%;max-height:calc(100vh - 28px);overflow:auto;padding:18px;box-shadow:0 16px 50px rgba(0,0,0,.3);box-sizing:border-box;">'+inner+'</div>'; }
    function covBtn(label, onclick, kind, extra){
        var st = kind==='primary' ? 'background:'+COV_BLUE+';color:#fff;border:none;'
               : kind==='green' ? 'background:'+COV_GREEN+';color:#fff;border:none;'
               : kind==='red' ? 'background:#fff;color:'+COV_RED+';border:1.5px solid #f1c9d3;'
               : 'background:#fff;color:'+COV_BLUE+';border:1.5px solid #cfe0f1;';
        return '<button type="button" onclick="'+onclick+'" style="'+st+'border-radius:10px;padding:10px 12px;font-size:13.5px;font-weight:800;cursor:pointer;'+(extra||'')+'">'+label+'</button>';
    }
    // Two taps instead of a browser confirm box.
    function covTwoTap(btn, fn){
        if(!btn) { fn(); return; }
        if(btn.getAttribute('data-armed')==='1'){ btn.removeAttribute('data-armed'); fn(); return; }
        btn.setAttribute('data-armed','1'); btn.setAttribute('data-old', btn.innerHTML); btn.innerHTML='Tap again to confirm';
        setTimeout(function(){ try{ if(btn.getAttribute('data-armed')==='1'){ btn.removeAttribute('data-armed'); btn.innerHTML=btn.getAttribute('data-old')||btn.innerHTML; } }catch(e){} }, 4000);
    }
    function covDateLabel(ds){
        var p=String(ds||'').split('-'); if(p.length<3) return String(ds||'');
        var d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2])); if(isNaN(d.getTime())) return String(ds);
        return d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
    }
    function covTime(t){ if(!t) return ''; var p=String(t).split(':'); var h=+p[0]||0, m=+p[1]||0, ap=h<12?'am':'pm', hh=h%12; if(hh===0) hh=12; return hh+(m?(':'+String(m).padStart(2,'0')):'')+ap; }

    // ============================================================
    // 1) THE PICKER: crew "Can't work this?", manager "Find someone to cover", "Ask more people"
    // ============================================================
    function covOpenAsk(shiftId, idx){
        var s = (typeof empHomeState!=='undefined' && empHomeState.shifts && empHomeState.shifts[idx]) || {};
        var label = s.date ? (covDateLabel(s.date)+', '+covTime(s.start)+'–'+covTime(s.end)+(s.location?(' at '+s.location):'')) : '';
        covStartPick({ kind:'new', mode:'self', shiftId:shiftId, label:label });
    }
    function covOpenForShift(shiftId){
        if(!shiftId) return;
        covStartPick({ kind:'new', mode:'manager', shiftId:shiftId, label:'' });
    }
    function covStartPick(o){
        _cov.pick = { kind:o.kind, mode:o.mode, shiftId:o.shiftId, offerId:o.offerId||null, label:o.label||'',
                      reason:'', note:'', data:null, checked:{}, err:'', loading:true, loadErr:'', busy:false };
        var m = covModal(); m.style.display='flex'; covRenderPick();
        var want = o.shiftId;
        covRpc('app_cover_candidates', { p_shift_id:o.shiftId }, function(d){
            if(!_cov.pick || _cov.pick.shiftId!==want) return;
            var P=_cov.pick; P.data=d||{}; P.mode=(d&&d.mode)||P.mode; P.loading=false;
            covPrecheck(); covRenderPick();
        }, function(err){
            if(!_cov.pick || _cov.pick.shiftId!==want) return;
            _cov.pick.loading=false; _cov.pick.loadErr=(err&&err.message)||'Could not load who can cover.'; covRenderPick();
        });
    }
    function covAskedMap(){
        var P=_cov.pick, m={}; var ex=P&&P.data&&P.data.existing;
        if(P && P.kind==='more' && ex && ex.asked){ ex.asked.forEach(function(id){ m[id]=true; }); }
        return m;
    }
    function covPrecheck(){
        var P=_cov.pick; if(!P) return; P.checked={}; var asked=covAskedMap();
        ((P.data&&P.data.candidates)||[]).forEach(function(c){ if(c.pick && !asked[c.id]) P.checked[c.id]=true; });
    }
    function covOpenMore(offerId){
        var P=_cov.pick; if(!P || !P.data) return;
        P.kind='more'; P.offerId=offerId; P.err=''; covPrecheck(); covRenderPick();
    }
    function covCanList(){
        var P=_cov.pick, asked=covAskedMap();
        return ((P&&P.data&&P.data.candidates)||[]).filter(function(c){ return c.ok && !asked[c.id]; });
    }
    function covCheckedIds(){
        var P=_cov.pick; if(!P) return [];
        return covCanList().filter(function(c){ return !!P.checked[c.id]; }).map(function(c){ return Number(c.id); });
    }
    function covPickReason(r){ if(!_cov.pick) return; _cov.pick.reason=r; _cov.pick.err=''; covRenderPick(); }
    function covNoteInput(v){ if(_cov.pick) _cov.pick.note=v; }
    function covToggle(id, on){ if(!_cov.pick) return; _cov.pick.checked[id]=!!on; covPaintAskBtn(); }
    // "Select everyone who can" never sweeps in managers; tap them on purpose if you want them.
    function covSelectAll(){ var P=_cov.pick; if(!P) return; covCanList().forEach(function(c){ if(!c.leader) P.checked[c.id]=true; }); covRenderPick(); }
    function covToggleCant(){ var P=_cov.pick; if(!P) return; P.showCant=!P.showCant; covRenderPick(); }
    function covErr(t){ if(_cov.pick) _cov.pick.err=t||''; var el=document.getElementById('covMsg'); if(el) el.textContent=t||''; }
    function covPaintAskBtn(){
        var b=document.getElementById('covAskBtn'); if(!b) return; var n=covCheckedIds().length; var P=_cov.pick;
        b.disabled = !n || (P && P.busy);
        b.style.background = n ? COV_BLUE : '#b9c7d8'; b.style.cursor = n ? 'pointer' : 'default';
        b.textContent = (P && P.busy) ? 'Asking…' : (n ? ('Ask '+covPlural(n,'person','people')) : 'Pick who to ask');
    }

    function covRowHtml(c, i, already){
        var P=_cov.pick, can=c.ok && !already, on=can && !!P.checked[c.id], line, col=COV_GREY;
        if(already) line='Already asked';
        else if(!c.ok) line=c.why||'Can’t take this shift';
        else if(c.warn){ line=c.warn; col='#b35c00'; }
        else line = 'Free' + (c.alerts ? '' : ' · no phone alerts yet, give them a text too');
        var tag=function(t, fg, bg){ return ' <span style="font-size:10.5px;font-weight:800;color:'+fg+';background:'+bg+';border-radius:6px;padding:1px 6px;margin-left:3px;">'+t+'</span>'; };
        return '<label style="display:flex;align-items:center;gap:10px;padding:10px 12px;'+(i?'border-top:1px solid #f0f2f6;':'')+(can?'cursor:pointer;':'opacity:.55;')+'">'+
            '<input type="checkbox" '+(on?'checked ':'')+(can?'':'disabled ')+'onchange="covToggle('+Number(c.id)+',this.checked)" style="width:19px;height:19px;flex:0 0 auto;">'+
            '<div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:700;color:#26242b;">'+covEsc(c.name)+
              (c.same_role?tag('usual role', COV_GREEN, '#e7f6ec'):'')+(c.leader?tag('manager', '#5b6675', '#eef0f3'):'')+'</div>'+
            '<div style="font-size:12px;color:'+col+';">'+covEsc(line)+'</div></div>'+
            (c.hours!=null ? '<span title="Hours already scheduled this week" style="font-size:11.5px;color:#5b6675;white-space:nowrap;">'+covEsc(String(c.hours))+' hrs</span>' : '')+
            '</label>';
    }
    function covListHtml(){
        var P=_cov.pick, d=P.data||{}, list=d.candidates||[], asked=covAskedMap();
        if(!list.length) return '<div style="padding:12px;color:'+COV_GREY+';font-size:13px;">Nobody else is set up to work at this store yet.</div>';
        var canL=list.filter(function(c){ return c.ok && !asked[c.id]; }), cantL=list.filter(function(c){ return !(c.ok && !asked[c.id]); });
        var h='';
        if(canL.length){
            h+='<div style="border:1px solid #edf0f4;border-radius:12px;overflow:hidden;">';
            canL.forEach(function(c, i){ h+=covRowHtml(c, i, false); });
            h+='</div>';
        } else {
            h+='<div style="font-size:12.5px;color:#8a5200;background:#fff6e6;border-radius:10px;padding:9px 11px;">Nobody else can take this shift right now'+(P.mode==='self'?'. Send it to your manager instead.':'.')+'</div>';
        }
        if(cantL.length){
            h+='<a href="javascript:void(0)" onclick="covToggleCant()" style="display:inline-block;margin-top:8px;font-size:12.5px;color:'+COV_GREY+';font-weight:700;text-decoration:none;">'+
               (P.showCant ? 'Hide' : 'Show')+' '+covPlural(cantL.length,'person','people')+' who can’t take it '+(P.showCant?'&#9650;':'&#9660;')+'</a>';
            if(P.showCant){
                h+='<div style="border:1px solid #edf0f4;border-radius:12px;overflow:hidden;margin-top:6px;">';
                cantL.forEach(function(c, i){ h+=covRowHtml(c, i, !!asked[c.id]); });
                h+='</div>';
            }
        }
        return h;
    }

    function covExistingHtml(ex, d){
        var isMgr = d.mode==='manager';
        var txt = ex.status==='accepted'
            ? ('<b>'+covEsc(ex.taker||'Someone')+'</b> said yes. '+(ex.manager_started?'It should finish on its own; check Requests if it’s stuck.':'Waiting on a manager to approve.'))
            : ('Waiting for a yes. Asked '+covPlural((ex.asked||[]).length,'person','people')+(ex.said_no?(', '+ex.said_no+' said no'):'')+'.');
        var h='<div style="background:#eef5fc;border:1px solid #cfe0f1;border-radius:12px;padding:12px;margin-top:12px;font-size:13.5px;color:#1f3b57;line-height:1.5;">&#128257; '+(isMgr?'There’s already a cover request on this shift.':'You already asked for cover on this shift.')+'<br>'+txt+'</div>';
        h+='<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;">';
        if(ex.status==='open') h+=covBtn('Ask more people','covOpenMore('+Number(ex.id)+')','primary','width:100%;');
        if(isMgr && ex.status==='accepted' && typeof openRequests==='function') h+=covBtn('Review it in Requests','covClose();openRequests()','primary','width:100%;');
        h+='<button type="button" id="covCancelExisting" onclick="covTwoTap(this,function(){covCancel('+Number(ex.id)+')})" style="background:#fff;color:'+COV_RED+';border:1.5px solid #f1c9d3;border-radius:10px;padding:10px 12px;font-size:13.5px;font-weight:800;cursor:pointer;width:100%;">Cancel the request</button>';
        h+='</div><div id="covMsg" style="min-height:16px;font-size:12.5px;color:'+COV_RED+';margin-top:8px;"></div>';
        return h;
    }

    function covRenderPick(){
        var P=_cov.pick; if(!P) return; var m=covModal(), d=P.data||{}, sh=d.shift||{};
        var isMgr=(P.mode==='manager'), more=(P.kind==='more');
        var title = more ? 'Ask more people' : (isMgr ? 'Find someone to cover' : 'Can’t work this shift?');
        var label = sh.label || P.label || '';
        var h='<div style="display:flex;align-items:flex-start;gap:10px;"><div style="flex:1;min-width:0;">'+
              '<h3 style="margin:0 0 3px;color:#1f2a44;font-size:18px;">'+title+'</h3>'+
              '<div style="font-size:13px;color:#5b6675;">'+covEsc(label)+(sh.position?(' &middot; '+covEsc(sh.position)):'')+
              (isMgr?(' &middot; '+(sh.employee?('now: '+covEsc(sh.employee)):'open shift')):'')+'</div></div>'+
              '<button type="button" onclick="covClose()" aria-label="Close" style="background:none;border:none;font-size:24px;color:#9aa2ad;cursor:pointer;line-height:1;padding:0 2px;">&times;</button></div>';
        if(!P.loading && !P.loadErr && d.existing && !more){ m.innerHTML=covShell(h+covExistingHtml(d.existing, d)); return; }

        if(!more && !isMgr){
            h+='<div style="font-size:12.5px;color:#5b6675;margin:13px 0 6px;">What’s the reason? <span style="color:#9aa2ad;">Only managers see it.</span></div><div style="display:flex;flex-wrap:wrap;gap:7px;">';
            COV_REASONS.forEach(function(r, i){ var on=(P.reason===r[0]);
                h+='<button type="button" onclick="covPickReason(COV_REASONS['+i+'][0])" style="border:1.5px solid '+(on?COV_BLUE:'#dfe2e8')+';background:'+(on?COV_BLUE:'#fff')+';color:'+(on?'#fff':'#33303a')+';border-radius:10px;padding:8px 11px;font-size:13px;font-weight:700;cursor:pointer;">'+r[1]+' '+covEsc(r[0])+'</button>'; });
            h+='</div><textarea placeholder="Anything your manager should know (optional)" oninput="covNoteInput(this.value)" style="width:100%;height:50px;margin-top:9px;padding:9px;border:1px solid #ddd;border-radius:9px;box-sizing:border-box;font-size:13px;font-family:inherit;">'+covEsc(P.note)+'</textarea>';
        } else if(!more && isMgr){
            var req=!!d.reason_required;
            h+='<label style="display:block;font-size:12.5px;color:#5b6675;margin:13px 0 5px;">Why does this shift need someone?'+(req?' <b style="color:'+COV_RED+';">Required for you</b>':' <span style="color:#9aa2ad;">(optional)</span>')+'</label>'+
               '<input type="text" value="'+covEsc(P.note)+'" oninput="covNoteInput(this.value)" placeholder="e.g. Called out sick, the event got bigger" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:9px;box-sizing:border-box;font-size:13.5px;">';
        }

        h+='<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:14px 0 6px;"><b style="font-size:14px;color:#1f2a44;">Who can cover?</b>';
        if(!P.loading && !P.loadErr && covCanList().filter(function(c){ return !c.leader; }).length > 1) h+='<a href="javascript:void(0)" onclick="covSelectAll()" style="font-size:12.5px;color:'+COV_BLUE+';font-weight:700;text-decoration:none;">Select everyone who can</a>';
        h+='</div>';
        if(P.loading) h+='<div style="padding:16px;text-align:center;color:'+COV_GREY+';font-size:13px;">Finding who can cover&hellip;</div>';
        else if(P.loadErr) h+='<div style="padding:12px;color:'+COV_RED+';font-size:13px;background:#fdeef2;border-radius:10px;">'+covEsc(P.loadErr)+'</div>';
        else h+=covListHtml();

        h+='<div id="covMsg" style="min-height:16px;font-size:12.5px;color:'+COV_RED+';margin-top:8px;">'+covEsc(P.err||'')+'</div>';
        if(!P.loadErr) h+='<button type="button" id="covAskBtn" onclick="covSubmit()" style="width:100%;margin-top:4px;color:#fff;border:none;border-radius:11px;padding:12px;font-size:15px;font-weight:800;"></button>';
        if(!isMgr && !more) h+=covBtn('Send to my manager instead','covSendToManager()','', 'width:100%;margin-top:8px;');
        if(more) h+=covBtn('Back','covBackFromMore()','', 'width:100%;margin-top:8px;');
        h+='<div style="font-size:11.5px;color:#8a93a0;margin-top:10px;text-align:center;line-height:1.45;">'+
           (isMgr ? 'The first person who says yes gets the shift right away.' : 'The first person who says yes takes it once a manager approves. You’re still on the shift until then.')+'</div>';
        m.innerHTML=covShell(h);
        covPaintAskBtn();
    }
    function covBackFromMore(){ var P=_cov.pick; if(!P) return; P.kind='new'; P.offerId=null; P.err=''; covRenderPick(); }

    function covSubmit(){
        var P=_cov.pick; if(!P || P.busy) return; var d=P.data||{};
        var ids=covCheckedIds(); if(!ids.length){ covErr('Pick at least one person.'); return; }
        var note=String(P.note||'').trim();
        if(P.kind==='new' && P.mode==='self' && !P.reason){ covErr('Pick a reason first.'); return; }
        if(P.kind==='new' && P.mode==='manager' && d.reason_required && !note){ covErr('Add a reason first. Your access requires one.'); return; }
        P.busy=true; covErr(''); covPaintAskBtn();
        var done=function(r){ if(_cov.pick!==P) return; P.busy=false; covShowAsked(r||{}); covAfterChange(); };
        var fail=function(e){ if(_cov.pick!==P) return; P.busy=false; covErr((e&&e.message)||'Could not send.'); covPaintAskBtn(); };
        if(P.kind==='more') covRpc('app_cover_ask_more', { p_offer_id:P.offerId, p_ask:ids }, done, fail);
        else covRpc('app_cover_request', { p_shift_id:P.shiftId,
                                           p_reason: P.mode==='self' ? P.reason : note,
                                           p_note:   P.mode==='self' ? note : '',
                                           p_ask: ids }, done, fail);
    }
    function covShowAsked(r){
        var P=_cov.pick; var isMgr=P && P.mode==='manager'; var n=Number(r.asked||0);
        var skipped=(r.skipped||[]);
        var h='<h3 style="margin:0 0 8px;color:#1f2a44;">&#9989; Asked '+covPlural(n,'person','people')+'</h3>'+
              '<div style="background:'+(isMgr?'#eef5fc':'#fff6e6')+';border:1px solid '+(isMgr?'#cfe0f1':'#f0d9a8')+';border-radius:11px;padding:12px 13px;font-size:13.5px;line-height:1.5;color:'+(isMgr?'#1f3b57':'#6b5220')+';">'+
              (isMgr ? 'The first person who says yes gets the shift right away. You’ll get a heads-up.'
                     : '<b>This is still your shift</b> until someone says yes and a manager approves it. We’ll let you know.')+'</div>';
        if(skipped.length) h+='<div style="font-size:12px;color:'+COV_GREY+';margin-top:10px;">Couldn’t ask: '+covEsc(skipped.join('; '))+'</div>';
        h+=covBtn('Done','covClose()','primary','width:100%;margin-top:14px;');
        covModal().innerHTML=covShell(h);
    }

    // "Send to my manager instead" (the original can't-work path, still there).
    function covSendToManager(){
        var P=_cov.pick; if(!P || P.busy) return;
        if(!P.reason){ covErr('Pick a reason first.'); return; }
        var extra=String(P.note||'').trim(), note=P.reason+(extra?(' — '+extra):'');
        P.busy=true;
        covRpc('app_swap_create', { p_shift_id:P.shiftId, p_note:note }, function(){
            P.busy=false; covShowManagerSent(); covAfterChange();
        }, function(e){ P.busy=false; covErr('Could not send: '+((e&&e.message)||'')); });
    }
    function covShowManagerSent(){
        var btns=(typeof cwPendingContactButtons==='function') ? cwPendingContactButtons() : '';
        covModal().innerHTML=covShell('<h3 style="margin:0 0 8px;color:#1f2a44;">Sent to your manager</h3>'+
            '<div style="background:#fff6e6;border:1px solid #f0d9a8;border-radius:11px;padding:12px 13px;margin-bottom:12px;">'+
            '<div style="font-weight:900;font-size:14px;color:#8a5200;margin-bottom:3px;">&#9888;&#65039; This is still your shift</div>'+
            '<div style="font-size:13px;color:#6b5220;line-height:1.5;">You’re still scheduled until a manager approves it. Reach out now so it gets handled.</div></div>'+
            btns+covBtn('Done','covClose()','','width:100%;margin-top:10px;'));
    }
    function covSendToManagerFor(offerId){
        var m=(((_cov.home&&_cov.home.mine)||[]).filter(function(x){ return Number(x.offer_id)===Number(offerId); })[0]);
        if(!m) return;
        covRpc('app_swap_create', { p_shift_id:Number(m.shift_id), p_note:(m.reason||'Can’t work')+' — nobody I asked could cover' }, function(){
            covModal().style.display='flex'; covShowManagerSent(); covAfterChange();
        }, function(e){ covToastMsg('Could not send: '+((e&&e.message)||'')); });
    }

    function covCancel(offerId){
        covRpc('app_cover_cancel', { p_offer_id:offerId }, function(){
            if(_cov.pick) covClose(); covToastMsg('Cover request cancelled.'); covAfterChange();
        }, function(e){ covErr((e&&e.message)||'Could not cancel.'); covToastMsg((e&&e.message)||'Could not cancel.'); });
    }
    function covToastMsg(t){ try{ if(typeof schedToast==='function'){ schedToast(t); return; } }catch(e){} try{ if(typeof showUndo==='function'){ showUndo(t, null); return; } }catch(e){} }

    // Refresh whatever cover screens are on display after a change.
    function covAfterChange(){
        try{ var v=document.getElementById('employeeHomeView'); if(v && v.style.display!=='none' && typeof loadEmployeeHome==='function') loadEmployeeHome(); }catch(e){}
        try{ covRenderHome(); }catch(e){}
        try{ if(document.getElementById('covMgrBox')) covLoadManager(); }catch(e){}
        try{ _covWeek.at=0; if(document.getElementById('schedGrid') && typeof fetchScheduleWeek==='function') fetchScheduleWeek(); }catch(e){}
    }

    // ============================================================
    // 2) "CAN YOU COVER?" + MY REQUESTS (Home card + My Schedule page)
    // ============================================================
    function covAskHtml(a){
        var id=Number(a.offer_id), who=a.manager_started ? 'Your manager' : (a.from || 'A coworker');
        var place='<b>'+covEsc(a.label||'')+'</b>'+(a.position?(' &middot; '+covEsc(a.position)):'');
        var h='<div style="background:#fff;border:1px solid #e6ebf2;border-left:5px solid '+(a.ask_status==='yes'?COV_GREEN:'#ec3e7e')+';border-radius:12px;padding:12px 13px;margin-bottom:10px;">';
        if(a.ask_status==='yes'){
            h+='<div style="font-size:13.5px;color:#26242b;line-height:1.5;">&#128588; You said yes to '+place+'. Waiting on a manager to approve it.</div>'+
               '<div style="display:flex;gap:8px;margin-top:9px;"><button type="button" onclick="covTwoTap(this,function(){covWithdraw('+id+')})" style="background:#fff;color:'+COV_RED+';border:1.5px solid #f1c9d3;border-radius:10px;padding:9px 12px;font-size:13px;font-weight:800;cursor:pointer;">I can’t after all</button></div>';
        } else {
            h+='<div style="font-size:12px;font-weight:900;color:#ec3e7e;letter-spacing:.3px;margin-bottom:2px;">CAN YOU COVER?</div>'+
               '<div style="font-size:13.5px;color:#26242b;line-height:1.5;">'+covEsc(who)+' needs someone for '+place+'.</div>'+
               '<div style="display:flex;gap:8px;margin-top:9px;">'+
                 covBtn('I’ll cover it','covRespond('+id+',true,this)','green','flex:1;')+
                 covBtn('I can’t','covRespond('+id+',false,this)','','flex:1;')+'</div>';
        }
        return h+'<div id="covAskMsg'+id+'" style="font-size:12.5px;margin-top:6px;"></div></div>';
    }
    function covRespond(offerId, yes, btn){
        var msg=document.getElementById('covAskMsg'+offerId);
        if(btn){ try{ var p=btn.parentNode; [].forEach.call(p.querySelectorAll('button'), function(b){ b.disabled=true; b.style.opacity='.6'; }); }catch(e){} }
        if(msg){ msg.style.color=COV_GREY; msg.textContent='Sending…'; }
        covRpc('app_cover_respond', { p_offer_id:offerId, p_yes:!!yes }, function(r){
            r=r||{};
            if(msg){ msg.style.color = r.ok===false ? '#8a5200' : COV_GREEN; msg.textContent = r.message || 'Thanks!'; }
            setTimeout(covAfterChange, 1600);
        }, function(e){
            if(msg){ msg.style.color=COV_RED; msg.textContent=(e&&e.message)||'Could not send.'; }
            if(btn){ try{ [].forEach.call(btn.parentNode.querySelectorAll('button'), function(b){ b.disabled=false; b.style.opacity='1'; }); }catch(e2){} }
        });
    }
    function covWithdraw(offerId){
        var msg=document.getElementById('covAskMsg'+offerId);
        covRpc('app_cover_withdraw', { p_offer_id:offerId }, function(){
            if(msg){ msg.style.color=COV_GREY; msg.textContent='Got it. We let them know.'; }
            setTimeout(covAfterChange, 1200);
        }, function(e){ if(msg){ msg.style.color=COV_RED; msg.textContent=(e&&e.message)||'Could not update.'; } });
    }

    function covMineHtml(m){
        var id=Number(m.offer_id), st=m.status, label='<b>'+covEsc(m.label||'')+'</b>', line='', btns='', col='#1f3b57', bar=COV_BLUE;
        if(st==='open' && Number(m.waiting||0) > 0){
            line='&#9203; Asked '+covPlural(Number(m.asked||0),'person','people')+' for '+label+(Number(m.said_no||0)?(' ('+m.said_no+' said no)'):'')+'. Waiting for a yes. You’re still on it.';
            btns=covBtn('Ask more people','covOpenMoreFor('+Number(m.shift_id)+','+id+')','','flex:1;');
        } else if(st==='open'){
            line='&#128533; Nobody you asked can cover '+label+' yet. You’re still on it.'; col='#8a5200'; bar='#e3a008';
            btns=covBtn('Ask more people','covOpenMoreFor('+Number(m.shift_id)+','+id+')','primary','flex:1;')+
                 covBtn('Send to my manager','covSendToManagerFor('+id+')','','flex:1;');
        } else if(st==='accepted'){
            line='&#128588; <b>'+covEsc(m.taker||'Someone')+'</b> said yes to '+label+'. Waiting on a manager. You’re still on it until then.';
        } else if(st==='approved'){
            line='&#9989; <b>'+covEsc(m.taker||'A coworker')+'</b> is covering '+label+'. You’re off it.'; col=COV_GREEN; bar=COV_GREEN;
        } else if(st==='denied'){
            line='&#10060; Not approved for '+label+'. You’re still on it.'+(m.manager_note?(' Reason: '+covEsc(m.manager_note)):''); col=COV_RED; bar=COV_RED;
        } else if(st==='expired'){
            line='Closed when '+label+' started. You were still on it.'; col=COV_GREY; bar='#c3c9d2';
        } else if(st==='cancelled'){
            line=covEsc(m.closed_reason||'Cancelled')+': '+label+'. You’re still on it.'; col=COV_GREY; bar='#c3c9d2';
        }
        if(st==='open' || st==='accepted'){
            btns+='<button type="button" onclick="covTwoTap(this,function(){covCancel('+id+')})" style="flex:1;background:#fff;color:'+COV_RED+';border:1.5px solid #f1c9d3;border-radius:10px;padding:9px 12px;font-size:13px;font-weight:800;cursor:pointer;">Cancel</button>';
        }
        return '<div style="background:#fff;border:1px solid #e6ebf2;border-left:5px solid '+bar+';border-radius:12px;padding:11px 13px;margin-bottom:9px;">'+
               '<div style="font-size:13.5px;color:'+col+';line-height:1.5;">'+line+'</div>'+
               (btns?('<div style="display:flex;gap:8px;margin-top:9px;flex-wrap:wrap;">'+btns+'</div>'):'')+'</div>';
    }
    function covOpenMoreFor(shiftId, offerId){
        covStartPick({ kind:'more', mode:'self', shiftId:shiftId, offerId:offerId, label:'' });
    }

    function covApproverHtml(d){
        var h='';
        if(Number(d.waiting||0) > 0){
            h+='<div onclick="if(typeof openRequests===\'function\') openRequests()" style="cursor:pointer;background:#eef5fc;border:1px solid #cfe0f1;border-radius:12px;padding:12px 13px;margin-bottom:10px;display:flex;align-items:center;gap:10px;">'+
               '<div style="flex:1;font-size:13.5px;color:#1f3b57;line-height:1.45;">&#128257; <b>'+covPlural(Number(d.waiting),'cover is','covers are')+' waiting for your OK.</b></div>'+
               '<span style="background:'+COV_BLUE+';color:#fff;border-radius:9px;padding:8px 12px;font-size:12.5px;font-weight:800;">Review</span></div>';
        }
        if(Number(d.looking_soon||0) > 0){
            h+='<div onclick="if(typeof openRequests===\'function\') openRequests()" style="cursor:pointer;background:#fff6e6;border:1px solid #f0d9a8;border-radius:12px;padding:11px 13px;margin-bottom:10px;font-size:13px;color:#6b5220;">&#9888;&#65039; '+covPlural(Number(d.looking_soon),'shift','shifts')+' in the next 24 hours '+(Number(d.looking_soon)===1?'still needs':'still need')+' a cover.</div>';
        }
        return h;
    }

    function covPaintBoxes(){
        var d=_cov.home||{}; var asks=d.asks||[], mine=d.mine||[];
        // My Schedule page
        var a=document.getElementById('covAsksBox');
        if(a) a.innerHTML = covApproverHtml(d) + asks.map(covAskHtml).join('');
        var b=document.getElementById('covMineBox');
        if(b) b.innerHTML = mine.length ? ('<div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">'+
              '<h3 style="margin:0 0 10px;color:var(--caliches-blue);font-size:16px;">&#128257; My cover requests</h3>'+mine.map(covMineHtml).join('')+'</div>') : '';
        // Home tab card: only what needs attention right now
        var dayAgo = Date.now() - 24*3600*1000;
        var need = mine.filter(function(m){
            if(m.status==='open' || m.status==='accepted') return true;
            if(m.status==='cancelled' && !/manager|schedule/i.test(m.closed_reason||'')) return false;
            var t = m.decided_at ? Date.parse(m.decided_at) : 0; return t && t > dayAgo;
        });
        var inner = covApproverHtml(d) + asks.map(covAskHtml).join('') + need.map(covMineHtml).join('');
        var card=document.getElementById('covHomeCard');
        if(!inner){ if(card && card.parentNode) card.parentNode.removeChild(card); return; }
        card=covHomeCardEl(); if(card) card.innerHTML=inner;
    }
    // My Upcoming Shifts: a shift with a cover going shows where it stands instead of "Can't work this?".
    function covDecorateMyShifts(){
        var host=document.getElementById('empHomeContent'); if(!host) return;
        var byShift={}; (((_cov.home&&_cov.home.mine)||[])).forEach(function(m){ if(m.status==='open'||m.status==='accepted') byShift[Number(m.shift_id)]=m; });
        [].forEach.call(host.querySelectorAll('button[onclick^="openCantWork("]'), function(b){
            var mm=String(b.getAttribute('onclick')).match(/^openCantWork\((\d+),/); if(!mm) return;
            if(!b.getAttribute('data-orig')) b.setAttribute('data-orig', b.innerHTML);
            var m=byShift[Number(mm[1])];
            if(m){
                b.innerHTML = m.status==='accepted' ? ('&#128588; '+covEsc(m.taker||'Someone')+' said yes') : ('&#128257; Cover asked');
                b.style.background='#fff'; b.style.color=COV_BLUE; b.style.border='1.5px solid #cfe0f1';
            } else {
                b.innerHTML=b.getAttribute('data-orig'); b.style.background='#0d6eaf'; b.style.color='#fff'; b.style.border='none';
            }
        });
    }
    function covHomeCardEl(){
        var anchor=document.getElementById('homeTodayCard') || document.getElementById('homeTasksCard');
        if(!anchor || !anchor.parentNode) return null;
        var el=document.getElementById('covHomeCard');
        if(!el){ el=document.createElement('div'); el.id='covHomeCard'; el.style.cssText='margin-top:14px;text-align:left;'; }
        if(el.parentNode!==anchor.parentNode || el.nextSibling!==anchor){ try{ anchor.parentNode.insertBefore(el, anchor); }catch(e){} }
        return el;
    }
    function covRenderHome(){
        if(!currentUser || !currentUser.username || !covHasPin()) return;
        var seq=++_cov.homeSeq;
        covLoadCaps(function(){
            covRpc('app_cover_mine', {}, function(d){
                if(seq!==_cov.homeSeq) return;
                _cov.home=d||{}; covPaintBoxes(); covDecorateMyShifts();
            }, function(){ /* quiet: Home never shows an error for this card */ });
        });
    }
    function covRefreshEmpHome(){ covRenderHome(); }

    // ============================================================
    // 3) APPROVERS: the Requests screen section
    // ============================================================
    function covLoadManager(){
        var box=document.getElementById('covMgrBox'); if(!box) return;
        if(!box.innerHTML) box.innerHTML='<div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 4px 6px rgba(0,0,0,0.05);color:'+COV_GREY+';font-size:13px;">Loading cover requests&hellip;</div>';
        covRpc('app_cover_manage_list', {}, function(d){ _cov.mgr=d||{}; covPaintManager(); },
            function(e){
                var m=(e&&e.message)||'';
                box.innerHTML = /permission/i.test(m) ? '' : '<div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;color:'+COV_RED+';font-size:13px;">Could not load cover requests: '+covEsc(m)+'</div>';
            });
    }
    function covPaintManager(){
        var box=document.getElementById('covMgrBox'); if(!box) return; var d=_cov.mgr||{};
        var waiting=d.waiting||[], looking=d.looking||[], recent=d.recent||[], req=!!d.reason_required;
        var card=function(inner){ return '<div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">'+inner+'</div>'; };
        var h='<h3 style="margin:0 0 4px;color:var(--caliches-blue);font-size:16px;">&#128257; Covers waiting for your OK ('+waiting.length+')</h3>'+
              '<p style="margin:0 0 8px;font-size:12px;color:'+COV_GREY+';">A coworker said yes to covering a shift. Approve and the schedule updates itself.'+(req?' <b>You need to add a reason.</b>':'')+'</p>';
        if(!waiting.length) h+='<p style="color:'+COV_GREY+';font-size:13px;margin:0;">None right now. &#127881;</p>';
        waiting.forEach(function(w, i){
            var id=Number(w.id);
            h+='<div style="padding:11px 0;'+(i?'border-top:1px solid #eee;':'')+'">'+
               '<div style="font-size:14px;color:#26242b;"><b>'+covEsc(w.taker||'Someone')+'</b> will cover '+(w.requester?('<b>'+covEsc(w.requester)+'</b>’s'):'this')+' shift</div>'+
               '<div style="font-size:13px;color:#555;margin-top:1px;">'+covEsc(w.label||'')+(w.position?(' &middot; '+covEsc(w.position)):'')+'</div>'+
               ((w.reason||w.note)?('<div style="font-size:12.5px;color:#5b6675;margin-top:3px;">Reason: <b>'+covEsc(w.reason||'')+'</b>'+(w.note?(' — '+covEsc(w.note)):'')+'</div>'):'')+
               (w.manager_started&&w.started_by?('<div style="font-size:12px;color:'+COV_GREY+';margin-top:2px;">Started by '+covEsc(w.started_by)+'</div>'):'')+
               '<input id="covDecNote'+id+'" type="text" placeholder="'+(req?'Reason (required)':'Note (optional)')+'" style="width:100%;margin-top:8px;padding:9px;border:1px solid #ddd;border-radius:9px;box-sizing:border-box;font-size:13px;">'+
               '<div style="display:flex;gap:8px;margin-top:8px;">'+covBtn('Approve','covDecide('+id+',true)','green','flex:1;')+covBtn('Deny','covDecide('+id+',false)','red','flex:1;')+'</div>'+
               '<div id="covDecMsg'+id+'" style="font-size:12.5px;margin-top:6px;"></div></div>';
        });
        var out=card(h);
        if(looking.length){
            var g='<h3 style="margin:0 0 8px;color:var(--caliches-blue);font-size:16px;">&#128269; Still looking for a cover ('+looking.length+')</h3>';
            looking.forEach(function(l, i){
                var id=Number(l.id);
                g+='<div style="padding:10px 0;'+(i?'border-top:1px solid #eee;':'')+'">'+
                   '<div style="font-size:14px;color:#26242b;">'+(l.requester?('<b>'+covEsc(l.requester)+'</b>’s '):'Open shift: ')+covEsc(l.label||'')+'</div>'+
                   '<div style="font-size:12.5px;color:#5b6675;margin-top:2px;">Asked '+Number(l.asked||0)+' &middot; '+Number(l.said_no||0)+' said no &middot; '+Number(l.waiting||0)+' haven’t answered'+(l.reason?(' &middot; '+covEsc(l.reason)):'')+'</div>'+
                   '<div style="display:flex;gap:8px;margin-top:8px;">'+covBtn('Ask more people','covMgrAskMore('+id+')','','flex:1;')+
                   '<button type="button" onclick="covTwoTap(this,function(){covMgrClose('+id+')})" style="flex:1;background:#fff;color:'+COV_RED+';border:1.5px solid #f1c9d3;border-radius:10px;padding:10px 12px;font-size:13px;font-weight:800;cursor:pointer;">Close request</button></div>'+
                   '<div id="covLookMsg'+id+'" style="font-size:12.5px;margin-top:6px;"></div></div>';
            });
            out+=card(g);
        }
        if(recent.length){
            var r='<details><summary style="cursor:pointer;font-size:14px;font-weight:800;color:var(--caliches-blue);">Last 2 weeks ('+recent.length+')</summary><div style="margin-top:8px;">';
            recent.forEach(function(x, i){
                var word={approved:'Approved',denied:'Denied',cancelled:'Cancelled',expired:'Closed'}[x.status]||x.status;
                var col={approved:COV_GREEN,denied:COV_RED}[x.status]||COV_GREY;
                r+='<div style="padding:8px 0;'+(i?'border-top:1px solid #f0f0f0;':'')+'font-size:12.5px;color:#444;line-height:1.45;">'+
                   '<span style="color:'+col+';font-weight:800;">'+covEsc(word)+'</span> &middot; '+covEsc(x.label||'')+
                   (x.requester?(' &middot; '+covEsc(x.requester)+(x.taker&&x.status==='approved'?(' → '+covEsc(x.taker)):'')):(x.taker&&x.status==='approved'?(' → '+covEsc(x.taker)):''))+
                   (x.decided_by?(' &middot; by '+covEsc(x.decided_by)):'')+
                   (x.manager_note?('<br><span style="color:'+COV_GREY+';">Reason: '+covEsc(x.manager_note)+'</span>'):'')+
                   (x.closed_reason?('<br><span style="color:'+COV_GREY+';">'+covEsc(x.closed_reason)+'</span>'):'')+'</div>';
            });
            out+=card(r+'</div></details>');
        }
        out+='<div id="covRulesBox"></div>';
        box.innerHTML=out;
        covLoadRules();
    }
    function covDecide(id, approve){
        var inp=document.getElementById('covDecNote'+id), msg=document.getElementById('covDecMsg'+id);
        var note=String((inp&&inp.value)||'').trim();
        if(!note && _cov.mgr && _cov.mgr.reason_required){ if(msg){ msg.style.color=COV_RED; msg.textContent='Add a reason first. Your access requires one.'; } if(inp) inp.focus(); return; }
        if(msg){ msg.style.color=COV_GREY; msg.textContent=approve?'Approving…':'Denying…'; }
        covRpc('app_cover_decide', { p_offer_id:id, p_approve:!!approve, p_reason:note }, function(){
            if(msg){ msg.style.color=approve?COV_GREEN:COV_GREY; msg.textContent=approve?'Approved. The schedule is updated and both people were told.':'Denied. Both people were told.'; }
            setTimeout(covAfterChange, 1200);
        }, function(e){ if(msg){ msg.style.color=COV_RED; msg.textContent=(e&&e.message)||'Could not save.'; } });
    }
    function covMgrClose(id){
        var msg=document.getElementById('covLookMsg'+id);
        covRpc('app_cover_cancel', { p_offer_id:id }, function(){ if(msg){ msg.style.color=COV_GREY; msg.textContent='Closed.'; } setTimeout(covAfterChange, 800); },
            function(e){ if(msg){ msg.style.color=COV_RED; msg.textContent=(e&&e.message)||'Could not close.'; } });
    }
    function covMgrAskMore(id){
        var l=((_cov.mgr&&_cov.mgr.looking)||[]).filter(function(x){ return Number(x.id)===Number(id); })[0];
        if(!l || !l.shift_id) return;
        covStartPick({ kind:'more', mode:'manager', shiftId:Number(l.shift_id), offerId:Number(id), label:l.label||'' });
    }

    // Cover rules: shown to everyone who approves; editable with "Edit page settings".
    function covLoadRules(){
        covRpc('app_cover_rules_get', {}, function(d){ _cov.rules=d||{}; covPaintRules(false); }, function(){});
    }
    function covPaintRules(editing){
        var box=document.getElementById('covRulesBox'); if(!box) return; var r=_cov.rules||{};
        var ot=Number(r.ot_hours||40), lm=Number(r.last_minute_hours||12), rm=Number(r.remind_hours||2);
        if(!editing){
            box.innerHTML='<div style="font-size:12px;color:'+COV_GREY+';text-align:center;margin:4px 0 14px;line-height:1.6;">Cover rules: overtime warning at '+ot+' hrs/week &middot; last-minute alert '+lm+' hrs before &middot; reminders every '+rm+' hrs'+
                (r.can_edit?' &middot; <a href="javascript:void(0)" onclick="covPaintRules(true)" style="color:'+COV_BLUE+';font-weight:700;">Change</a>':'')+'</div>';
            return;
        }
        var inp=function(id,v,label,step){ return '<label style="display:block;font-size:12.5px;color:#5b6675;margin-top:8px;">'+label+'<input id="'+id+'" type="number" step="'+step+'" value="'+v+'" style="display:block;width:100%;margin-top:3px;padding:9px;border:1px solid #ddd;border-radius:9px;box-sizing:border-box;font-size:14px;"></label>'; };
        box.innerHTML='<div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">'+
            '<h3 style="margin:0 0 4px;color:var(--caliches-blue);font-size:15px;">Cover rules</h3>'+
            inp('covRuleOt',ot,'Show an overtime warning at (hours in a week)','1')+
            inp('covRuleLm',lm,'Alert managers right away when the shift is within (hours)','1')+
            inp('covRuleRm',rm,'Send a reminder when nobody has answered for (hours)','0.5')+
            '<div id="covRuleMsg" style="font-size:12.5px;margin-top:8px;"></div>'+
            '<div style="display:flex;gap:8px;margin-top:8px;">'+covBtn('Save','covSaveRules()','primary','flex:1;')+covBtn('Cancel','covPaintRules(false)','','flex:1;')+'</div></div>';
    }
    function covSaveRules(){
        var g=function(id){ var el=document.getElementById(id); return el?Number(el.value):NaN; };
        var msg=document.getElementById('covRuleMsg');
        covRpc('app_cover_rules_set', { p_ot_hours:g('covRuleOt'), p_last_minute_hours:g('covRuleLm'), p_remind_hours:g('covRuleRm') }, function(d){
            _cov.rules=d||_cov.rules; covPaintRules(false);
        }, function(e){ if(msg){ msg.style.color=COV_RED; msg.textContent=(e&&e.message)||'Could not save.'; } });
    }

    // ============================================================
    // 4) SCHEDULE BUILDER: "Find someone to cover this shift" in the shift editor
    // ============================================================
    function covSyncShiftModal(shiftId, s){
        var w=document.getElementById('shiftCoverWrap'); if(!w) return;
        w.style.display='none';
        if(!shiftId || !s) return;
        var today=new Date(); var ts=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
        if(String(s.shift_date||'') < ts) return;
        covLoadCaps(function(){
            if(!covCan('approve_cover')) return;
            var ed=(typeof schedState!=='undefined' && schedState.editing) || {};
            if(ed.shiftId===shiftId) w.style.display='block';
        });
    }
    // Badges on the schedule builder: shifts with a cover going get a small icon (hover for details).
    var _covWeek = { key:'', at:0, rows:[] };
    function covDecorateGrid(){
        try{
            if(typeof schedState==='undefined' || !schedState.location || !schedState.weekStart || typeof schedFmt!=='function') return;
            if(!_cov.caps){ if(covHasPin()) covLoadCaps(function(){ if(_cov.caps) covDecorateGrid(); }); return; }
            if(!(covCan('approve_cover') || covCan('manage_schedule'))) return;
            var ws=schedFmt(schedState.weekStart), key=schedState.location+'|'+ws;
            var paint=function(rows){
                (rows||[]).forEach(function(r){
                    [].forEach.call(document.querySelectorAll('[data-shiftid="'+Number(r.shift_id)+'"]'), function(el){
                        if(el.querySelector('.cov-badge')) return;
                        var sp=document.createElement('span'); sp.className='cov-badge';
                        sp.title = r.status==='accepted' ? ((r.taker||'Someone')+' said yes. Waiting for an OK in Requests.') : ('Cover asked. '+Number(r.waiting||0)+' not answered yet.');
                        sp.textContent = r.status==='accepted' ? ' \uD83D\uDE4C' : ' \uD83D\uDD01';
                        sp.style.cssText='font-size:11px;margin-left:3px;';
                        (el.querySelector('.hbg-t') || el).appendChild(sp);
                    });
                });
            };
            if(_covWeek.key===key && Date.now()-_covWeek.at < 60000){ paint(_covWeek.rows); return; }
            if(!covHasPin()) return;
            covRpc('app_cover_week_status', { p_location:schedState.location, p_week_start:ws }, function(rows){
                _covWeek={ key:key, at:Date.now(), rows:rows||[] }; paint(_covWeek.rows);
            }, function(){});
        }catch(e){}
    }
    function covOpenFromShiftModal(){
        var ed=(typeof schedState!=='undefined' && schedState.editing) || {};
        if(ed.shiftId) covOpenForShift(ed.shiftId);
    }

    // ============================================================
    // 5) HOOKS: refresh the Home card every time Home opens (same pattern as js/31)
    // ============================================================
    try{ window.covOpenAsk=covOpenAsk; window.covRenderHome=covRenderHome; window.covLoadManager=covLoadManager; window.covSyncShiftModal=covSyncShiftModal; }catch(e){}
    try{
        if(typeof switchMenuTab==='function' && !switchMenuTab.__covWrapped){
            var _covWrapped=(function(orig){
                function w(){ var r=orig.apply(this,arguments); try{ if(arguments[0]==='home') covRenderHome(); }catch(e){} return r; }
                w.__covWrapped=true; w.__homeTodayWrapped=orig.__homeTodayWrapped; return w;
            })(switchMenuTab);
            switchMenuTab=_covWrapped;
            try{ window.switchMenuTab=_covWrapped; }catch(e){}
        }
    }catch(e){}
    try{
        if(typeof renderScheduleGrid==='function' && !renderScheduleGrid.__covWrapped){
            var _covGridWrapped=(function(orig){
                function w(){ var r=orig.apply(this,arguments); try{ setTimeout(covDecorateGrid,0); }catch(e){} return r; }
                w.__covWrapped=true; return w;
            })(renderScheduleGrid);
            renderScheduleGrid=_covGridWrapped;
            try{ window.renderScheduleGrid=_covGridWrapped; }catch(e){}
        }
    }catch(e){}
    try{ var _covHome=document.getElementById('tab-content-home'); if(_covHome && _covHome.classList && _covHome.classList.contains('tab-visible')) covRenderHome(); }catch(e){}
