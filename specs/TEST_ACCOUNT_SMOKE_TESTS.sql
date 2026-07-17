-- ============================================================================
-- Caliche's Hub — TEST ACCOUNT SMOKE TESTS (consolidated)
-- Compiled 2026-07-17. NOT executed by the agent that assembled this file —
-- that sandbox has no network path to Supabase. This file is for ISSAC to run
-- himself, in the Supabase SQL editor, against project ikgbihwkqhsfahnswfbz.
--
-- HOW TO USE (plain English):
--   1. Open the Supabase SQL editor.
--   2. Run ONE block at a time — do NOT run this whole file top-to-bottom in
--      one go. Several blocks create real rows (evaluations, PTO adjustments,
--      shift claims/offers, pay-proposal reads, etc.) or reassign a real
--      shift, and most blocks have a "replace <placeholder>" value you fill in
--      first by running the small lookup SELECT sitting right above it.
--   3. Both test accounts use PIN 1111: 'test_admin' (Admin-Manager-tier
--      login) and 'test_crew' (line-crew-tier login).
--
--   WHAT PASS LOOKS LIKE:
--     - A line commented "-- expect: forbidden" -> PASS means Postgres returns
--       a red ERROR (e.g. "ERROR: forbidden" / "ERROR: Managers only" /
--       "ERROR: Not authorized"). If it instead returns a normal result, that
--       is a FAIL — a security gate isn't working and is letting in someone
--       who shouldn't be let in.
--     - A line commented "-- expect: <jsonb ...>" / "-- expect: {...}" -> PASS
--       means you get a JSON result back (even an empty [] or {} is fine
--       unless the comment says otherwise) with NO red error. An error here
--       is a FAIL — something is broken for a caller who SHOULD be allowed.
--     - Blocks marked [SKIPPED] are not runnable tests. They're notes
--       explaining why: the underlying database function's source code isn't
--       committed anywhere in this repo, so its exact behavior can't be
--       verified without live DB access. Read the note; there's nothing to
--       run or to pass/fail.
--     - Block B4's admin half is deliberately NOT an automatic pass/fail —
--       it's an instruction to go inspect the data and use judgment. Do not
--       treat it as a script to execute blindly.
--
-- ORGANIZATION:
--   PART A    — every pre-existing "test_admin/test_crew, PIN 1111" smoke
--                test already written into this repo's .sql files, compiled
--                here in one place, grouped by source file.
--   PART B    — new smoke tests for the 5 fixes from this work session
--                (pay-raise history security fix, Report-a-Concern gate,
--                checklist Opening/open casing bug, delete-user, and a
--                cross-account submit -> approve workflow chain).
--   APPENDIX  — RPC names this pass found are called by the frontend and/or
--                listed in rpc_manifest.json but have NO .sql source anywhere
--                in this repo — a punch list for next time you need one.
-- ============================================================================


-- ############################################################################
-- ## PART A — EXISTING SMOKE TESTS (compiled from already-shipped modules)  ##
-- ############################################################################

-- ----------------------------------------------------------------------------
-- A1 -- SOURCE: dsr_finish.sql (~line 91)
-- ----------------------------------------------------------------------------
-- NEW RPCS: dsr_dashboard (dsr_submit replaced in place)
select public.dsr_dashboard('test_admin','1111','{}'::jsonb);
-- expect: a jsonb dashboard result (no explicit expect-comment in source; this
-- is an admin/manager dashboard read, so test_admin should succeed)


-- ----------------------------------------------------------------------------
-- A2 -- SOURCE: dsr_opm_finish.sql (lines 635-645)
-- ----------------------------------------------------------------------------
-- NEW RPCS: opm_perf_autofill, opm_audit_list
-- NEW HELPERS: _opm_perf_month
-- REPLACED IN PLACE (behavior preserved + marketing/training sources added): opm_insights_generate
-- VERIFY (test accounts PIN 1111; replace <meetingId>):
--   select public.opm_perf_autofill('test_admin','1111',<meetingId>);
--   select public.opm_audit_list('test_admin','1111',<meetingId>);
--   select public.opm_insights_generate('test_admin','1111',<meetingId>);
--   select public._opm_perf_month('Roadrunner', (date_trunc('month', current_date) - interval '1 month')::date);
-- expect: jsonb results for all three RPC calls (test_admin is an OPM meeting participant/mgr)


-- ----------------------------------------------------------------------------
-- A3 -- SOURCE: employee_passport.sql (lines 218-231)
-- ----------------------------------------------------------------------------
-- VERIFY (run first; expect rows for both):
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='audit_log'
--     and column_name in ('actor_id','actor_name','action','affected_employee_id',
--                         'before_value','after_value','source_module','reason');
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='schedule_employees'
--     and column_name in ('name','linked_username');
-- SMOKE TEST (test accounts, PIN 1111 — replace <empId> with a roster id):
--   select public.app_passport_get('test_admin','1111',<empId>);
--   select public.app_passport_set_level('test_admin','1111',<empId>,<posId>,'Ace','Strong all shift');
--   select public.app_passport_set_level('test_crew','1111',<empId>,<posId>,'Coach','x'); -- expect forbidden


-- ----------------------------------------------------------------------------
-- A4 -- SOURCE: employee_readiness_report.sql (lines 151-164)
-- ----------------------------------------------------------------------------
-- VERIFY (run these first; expect rows):
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='schedule_employees'
--       and column_name in ('id','name','active');
--   select proname from pg_proc where proname in ('_pp_auth','_pp_rank');
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='audit_log'
--       and column_name in ('actor_id','actor_name','action','affected_employee_id',
--                           'before_value','after_value','source_module','reason');
-- SMOKE TEST (test accounts, PIN 1111):
--   select public.app_readiness_report('test_admin','1111');     -- expect jsonb report
--   select public.app_readiness_report('test_crew','1111');      -- expect: forbidden


-- ----------------------------------------------------------------------------
-- A5 -- SOURCE: passport_phase2.sql (lines 157-161)
-- ----------------------------------------------------------------------------
-- VERIFY / SMOKE (test accounts PIN 1111; replace <empId>,<posId>):
--   select public.app_passport_extra_get('test_admin','1111',<empId>);
--   select public.app_dev_goal_add('test_admin','1111',<empId>,'cross_train',<posId>,null);
--   select public.app_passport_hours_log('test_admin','1111',<empId>,<posId>,current_date,<posId>,6,'confirmed','test');


-- ----------------------------------------------------------------------------
-- A6 -- SOURCE: site_inspection.sql (lines 1062-1074)
-- ----------------------------------------------------------------------------
-- NEW RPCS: insp_config_get, insp_start, insp_get, insp_section_save,
--   insp_photo_add, insp_summary_save, insp_validate, insp_action_create,
--   insp_action_update, insp_submit, insp_list, insp_dashboard
-- NEW TABLES: insp_inspection, insp_section, insp_line, insp_action, insp_audit
-- VERIFY after apply:
--   select public.insp_config_get('test_admin','1111');
--   select public.insp_dashboard('test_admin','1111','{}'::jsonb);
--   select pg_get_functiondef('public.app_task_create'::regproc);
--   select pg_get_functiondef('public.app_wo_create'::regproc);
--   select pg_get_functiondef('public.app_supply_create'::regproc);
--   select pg_get_functiondef('public.push_enqueue'::regproc);


-- ----------------------------------------------------------------------------
-- A7 -- SOURCE: site_inspection_finish.sql (lines 292-299)
-- ----------------------------------------------------------------------------
-- VERIFY after apply:
--   select public._insp_rule_followup_days();
--   select public.insp_reminder_scan('test_admin','1111');
--   select id, location, insp_type, status, is_followup, followup_of_id,
--          followup_date from public.insp_inspection order by id desc limit 5;
--   select pg_get_functiondef('public.insp_submit'::regproc);


-- ----------------------------------------------------------------------------
-- A8 -- SOURCE: team_growth.sql (lines 1124-1140)
-- ----------------------------------------------------------------------------
-- VERIFY (run after applying):
--   select table_name from information_schema.tables
--     where table_schema='public' and table_name like 'tg_%' order by table_name;
--   select routine_name from information_schema.routines
--     where routine_schema='public' and routine_name like 'app_tg_%' order by routine_name;
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='employee_notes'
--     and column_name in ('note_type','follow_up_date','resolved','resolved_at');
-- SMOKE TEST (test accounts, PIN 1111 — replace <empId> with a real roster id):
--   select public.app_tg_eval_templates('test_admin','1111');
--   select public.app_tg_eval_start('test_admin','1111',<empId>,'30_day', (select id from public.tg_eval_templates where eval_type='30_day' limit 1));
--   select public.app_tg_my_growth('test_crew','1111');
--   select public.app_tg_mgr_dashboard('test_admin','1111', null);
--   select public.app_tg_eval_templates('test_crew','1111'); -- expect forbidden


-- ----------------------------------------------------------------------------
-- A9 -- SOURCE: team_growth_finish.sql (lines 1004-1021)
-- ----------------------------------------------------------------------------
-- VERIFY (run after applying):
--   select routine_name from information_schema.routines
--     where routine_schema='public' and routine_name in
--     ('app_tg_corp_dashboard','app_tg_report_evals','app_tg_report_certs',
--      'app_tg_report_growth','app_tg_report_recognition','app_tg_spine',
--      'app_tg_automation_scan') order by 1;
--   select tgname from pg_trigger where tgname='tg_cert_award_sync';
--   select relname, relrowsecurity from pg_class where relname='tg_automation_log';
-- SMOKE TEST (test accounts, PIN 1111 — replace <empId> with a roster id):
--   select public.app_tg_corp_dashboard('test_admin','1111');
--   select public.app_tg_report_evals('test_admin','1111', null);
--   select public.app_tg_report_certs('test_admin','1111', null);
--   select public.app_tg_report_growth('test_admin','1111', null);
--   select public.app_tg_report_recognition('test_admin','1111', null);
--   select public.app_tg_spine('test_admin','1111', <empId>);
--   select public.app_tg_automation_scan('test_admin','1111');
--   select public.app_tg_corp_dashboard('test_crew','1111');  -- expect forbidden


-- ----------------------------------------------------------------------------
-- A10 -- SOURCE: training_finish.sql (lines 649-671)
-- ----------------------------------------------------------------------------
-- VERIFY (run BEFORE prod apply; all should return rows / true):
--   1) helpers exist:
--      select proname from pg_proc where proname in
--        ('_pp_auth','_pp_audit','_trh_cfg','_trh_role_match','_trh_emp_of',
--         '_trh_notify_emp','_trh_notify_mgrs','_tg_emp_location');
--   2) app_settings rules seeded:
--      select * from app_settings where sgroup='trh_rules';
--   3) knowledge_base has (category,question,answer,updated_at,updated_by).
-- SMOKE (test accounts PIN 1111; replace <ids>):
--   select public.trh_prestart_assign('test_admin','1111',array[<empId>]::bigint[],null,null,null);
--   select public.trh_prestart_my('test_crew','1111');
--   select public.trh_prestart_progress('test_crew','1111',<id>,'start');
--   select public.trh_prestart_progress('test_crew','1111',<id>,'complete');
--   select public.trh_prestart_approve('test_admin','1111',<id>,null);
--   select public.trh_prestart_payroll_export('test_admin','1111');
--   select public.trh_qs_save('test_admin','1111',null,'Cup sizes refresher','Small=8oz...', 'crew','',3,'What size is a Small?',true);
--   select public.trh_qs_assign('test_admin','1111',<scoopId>,array[<empId>]::bigint[],'manual');
--   select public.trh_qs_my('test_crew','1111');
--   select public.trh_qs_complete('test_crew','1111',<assignId>,'{"question":"What size is a Small?","answer":"8oz"}'::jsonb);
--   select public.trh_qs_team('test_admin','1111','');
--   select public.trh_scorm_info('test_admin','1111',<courseId>);


-- ----------------------------------------------------------------------------
-- A11 -- SOURCE: training_hub.sql (lines 1130-1149)
-- ----------------------------------------------------------------------------
-- VERIFY (run BEFORE prod apply; all should return rows / true):
--   1) helpers exist:
--      select proname from pg_proc where proname in
--        ('_pp_auth','_pp_is_self','_pp_audit','_pp_rank','_tg_emp_location','push_enqueue');
--   2) LMS completion columns (drives digital/knowledge requirement status —
--      _trh_course_done tries user_id first, then employee_id, else false):
--      select column_name from information_schema.columns
--       where table_name='lp_course_completions';       -- expect user_id or employee_id, course_id, passed
--   3) cert mirror + clearance targets:
--      select column_name from information_schema.columns where table_name='employee_certs';
--      select column_name from information_schema.columns where table_name='employee_position_clearance';
--   4) app_settings columns are (skey,sgroup,label,svalue,sort)  per admin_settings.sql
-- SMOKE (test accounts PIN 1111; replace <ids>):
--   select public.trh_admin_get('test_admin','1111');
--   select public.trh_enroll('test_admin','1111',(select id from trh_paths where code='BLUE'),array[<empId>]::bigint[], current_date+14);
--   select public.trh_my('test_crew','1111');
--   select public.trh_record('test_admin','1111',<enrId>,<reqId>,'pass','Solid demo',null,null);
--   select public.trh_award_cert('test_admin','1111',<enrId>,null,null,false);

-- NOTE on Part A: these 11 blocks are reproduced verbatim from their source
-- files, so most lines don't carry an explicit "-- expect" comment (that
-- wasn't this pass's job — Part A is a compile, not a rewrite). General rule
-- for reading them: test_admin calls into a manager/admin-gated RPC should
-- return jsonb data; test_crew calls into a manager/admin/corp-gated RPC
-- should return "forbidden" (only the lines that already say so were verified
-- against their gate at write time); test_crew calls into a self-service
-- "_my"/"_mine" style RPC (e.g. app_tg_my_growth, trh_prestart_my, trh_my,
-- trh_qs_my) are expected to SUCCEED — those are the crew member's own data.


-- ############################################################################
-- ## PART B — NEW SMOKE TESTS FOR THIS SESSION'S FIXES                      ##
-- ############################################################################

-- ----------------------------------------------------------------------------
-- B1 -- app_tg_proposal_adjust_list must reject crew, allow admin
-- SOURCE OF THE FIX: payraise_adjust_security_fix.sql (2026-07-17)
-- ----------------------------------------------------------------------------
-- What changed: this RPC returns full pay-raise ADJUSTMENT HISTORY (old_rate,
-- new_rate, reason, who approved it, when) for a given proposal. It
-- authenticated the caller but never checked their ROLE — any logged-in
-- employee, crew included, could read anyone's pay-adjustment history by
-- guessing/incrementing p_proposal_id. The fix adds:
--   if not public._tg_is_corp(v_role) then raise exception 'forbidden'; end if;
-- _tg_is_corp (team_growth.sql:56) = role ilike any of
--   '%admin%', '%owner%', '%VP%', '%president%'.
-- Current signature (unchanged by the fix): app_tg_proposal_adjust_list(
--   p_username text, p_password text, p_proposal_id bigint) returns jsonb.
--
-- Grab a real proposal id first (any row is fine — the RPC legitimately
-- returns [] if that proposal has no adjustments logged yet; you're testing
-- the GATE here, not the data):
select id, employee_id, status from public.tg_pay_proposals order by id desc limit 5;

-- TEST 1a -- test_admin (corp-tier): should succeed.
select public.app_tg_proposal_adjust_list('test_admin','1111', <proposalId>);
-- expect: succeeds, returns a jsonb array (possibly [] — that's still a PASS)

-- TEST 1b -- test_crew (line-crew tier): THIS is the actual fix under test.
select public.app_tg_proposal_adjust_list('test_crew','1111', <proposalId>);
-- expect: forbidden. If test_crew gets data back instead of a red error, the
-- security fix did not apply — re-run payraise_adjust_security_fix.sql and
-- confirm it's the live definition with: select pg_get_functiondef('public.app_tg_proposal_adjust_list'::regproc);


-- ----------------------------------------------------------------------------
-- B2 -- [SKIPPED -- not a runnable test] Report-a-Concern reviewer/list gate
-- ----------------------------------------------------------------------------
-- What changed (frontend, confirmed in the working tree): js/08_availability.js
-- lines 313-321 — yv2CanManage(), which gates the whole "Team Voice Dashboard"
-- (bundles the confidential "concern" pathway together with talk/idea/
-- feedback/help in one view), was tightened from isManagerRole() (true for
-- any 'Manager', 'Admin Manager', or 'Vice President/Co-Owner') to
-- isDiscAdmin()-only (role==='Admin Manager' or 'Vice President/Co-Owner' or
-- is_developer===true). The inline comment is dated 2026-07-17 and cites the
-- exact reasoning: the app's own printed promise is that a concern "goes only
-- to Admin Managers... not visible to store management."
--
-- Why there's no SQL test here: the dashboard's actual data comes from RPCs
-- yv_list / yv_get (called at js/08_availability.js:376 and nearby). I
-- searched every .sql file in this repo (all root-level files; there is no
-- /sql directory) for "yv_", "yv_list", "yv_get", and any "create function"
-- touching a yv_ name, and found NONE. These RPCs ARE real and deployed —
-- they're registered in rpc_manifest.json (lines 545-556: yv_advance,
-- yv_assign, yv_assignable, yv_get, yv_list, yv_message, yv_mine, yv_note,
-- yv_status, yv_submit, yv_win_list, yv_win_save) and called from the
-- frontend — but their CREATE FUNCTION source was never committed to this
-- repo. This exactly matches specs/audit_team_hr.md finding B1, which
-- independently concluded: "Backend confirmation needed (can't test here)...
-- Unverified today." Per this task's instructions, that means skip rather
-- than guess a signature.
--
-- So: the FRONTEND gate fix is real and present in the working tree. Whether
-- yv_list/yv_get themselves also restrict pathway='concern' rows to
-- Admin-Manager/VP-only callers is UNKNOWN from this repo.
--
-- TO UNBLOCK once you have live DB access, pull the real signature + body,
-- then write the test yourself:
--   select pg_get_functiondef('public.yv_list'::regproc);
--   select pg_get_functiondef('public.yv_get'::regproc);
-- Live test once you have the signature: sign in as test_crew (or any
-- non-admin manager account) and confirm concern-pathway submissions do NOT
-- appear in the yv_list result; sign in as test_admin and confirm they do.
--
-- Also un-sourced, same situation: the LEGACY concern list, app_harassment_list
-- (js/08_availability.js:384, frontend-gated Disc-Admin-only per its own
-- comment). specs/OPEN_QUESTIONS_FOR_ISSAC.md ("Team / HR") asks whether to
-- retire this legacy screen now that Your Voice replaces it — if retired,
-- this whole legacy RPC becomes moot.


-- ----------------------------------------------------------------------------
-- B3 -- [SKIPPED -- not a runnable assertion] Checklist Opening/open casing bug
-- ----------------------------------------------------------------------------
-- The bug (specs/audit_daily_ops.md, finding B1): the Admin Console writes
-- checklist_items.shift_type as the CAPITALIZED literal 'Opening' / 'Closing'
-- / 'Cleaning' — confirmed live in this repo at admin_lists.sql:33-35
-- (`coalesce(nullif(p_fields->>'shift',''),'Opening')`, default also
-- 'Opening') and index.html:2272 (`<select id="admListShift"><option>Opening
-- </option>...` — no value= attribute, so the option VALUE is the capitalized
-- text itself). The crew-facing Shift Checklists screen instead queries with
-- p_shift = 'open' / 'close' / 'clean' — lowercase and truncated — confirmed
-- live at js/06_disciplinary_actions.js:550,557,569
-- (`var clShift='open'`; `setChecklistTab('open')`;
-- `supabaseClient.rpc('app_checklist_items',{...,p_shift:clShift,...})`).
-- If app_checklist_items does a plain `where shift_type = p_shift`, this is a
-- silent, permanent, zero-rows-ever-match bug for every store.
--
-- Why there's no SQL test here: app_checklist_items has NO .sql source
-- anywhere in this repo — confirmed by grepping every root .sql file for
-- "checklist" (8 files matched; none define this function) and for
-- "app_checklist" directly (1 hit: a REFERENCE COMMENT, not a definition, at
-- shift_console.sql:14-15, listing it among RPCs the frontend needs). As of
-- this session's `git diff`, js/06_disciplinary_actions.js has NOT had
-- clShift's values touched — so whichever fix approach the parallel session
-- takes (frontend constant change vs. backend WHERE-clause change) had not
-- landed in this snapshot of the repo yet. Per this task's instructions:
-- flagged and skipped rather than guessed.
--
-- IMPORTANT: if the eventual fix turns out to be JS-side only (e.g. changing
-- clShift's values to 'Opening'/'Closing'/'Cleaning' to match the DB, or
-- changing setChecklistTab's tab keys to match), there is NOTHING here for a
-- .sql smoke test to check — confirm by re-reading js/06_disciplinary_actions.js
-- for a changed clShift/setChecklistTab, not by looking for a new .sql file.
--
-- TO UNBLOCK once you have live DB access, pull the real signature + body:
--   select pg_get_functiondef('public.app_checklist_items'::regproc);
--
-- One REAL, fully-sourced diagnostic you CAN run today (this RPC's source
-- lives right here in admin_lists.sql:3-19) — it won't test app_checklist_items
-- itself, but it directly shows you what's actually sitting in the table,
-- which is half the diagnosis:
select public.app_list_get('test_admin','1111','checklist');
-- expect: a jsonb array of checklist items. Look at each item's "shift"
-- value — if you see "Opening"/"Closing"/"Cleaning" (capitalized) here AND
-- the crew Shift Checklists screen still shows "No checklist items configured
-- for this shift yet" on the matching tab, that CONFIRMS the casing-mismatch
-- bug end-to-end without needing app_checklist_items's source at all. (Per
-- the audit: this is also a 30-second manual live test — add a checklist item
-- as Opening via Admin Console, then check the crew Opening tab.)


-- ----------------------------------------------------------------------------
-- B4 -- delete-user: test_crew must be forbidden; test_admin needs manual
--        inspection, NOT an automatic destructive assertion
-- ----------------------------------------------------------------------------
-- The RPC: app_admin_delete_user. Confirmed real and deployed (registered in
-- rpc_manifest.json line 10; called from the Manager Dashboard's Users tab
-- "Delete" button at js/10_my_maintenance_submissions.js:160-166 —
-- confirm dialog text: "Are you sure you want to permanently delete this
-- user?"). Grepping every root .sql file for "delete_user" (which would also
-- match "app_admin_delete_user" as a substring) returns ZERO matches — like
-- B2/B3 above, there is NO .sql source for this function anywhere in this
-- repo. UNLIKE B2/B3, this task explicitly asks for a test_crew-forbidden
-- call here regardless, so it's included below — but flagged clearly:
--
--   SIGNATURE SOURCE: NOT a .sql file. Taken verbatim from the one real
--   caller: js/10_my_maintenance_submissions.js:163 —
--     supabaseClient.rpc('app_admin_delete_user',
--       { p_admin_username: currentUser.username, p_admin_password: pin, p_user_id: id })
--   If the call below errors with something like 42883 ("function ... does
--   not exist" / "no function matches the given name and argument types"),
--   the live parameter names/order differ from this frontend call — pull the
--   real signature first with:
--     select pg_get_functiondef('public.app_admin_delete_user'::regproc);
--   and adjust the call to match before re-running.
--
-- Look up both test accounts' login ids first:
select id, username, role from public.users where username in ('test_admin','test_crew');

-- TEST 4a -- test_crew attempts to delete a user account: MUST be forbidden.
-- SAFETY: target test_crew's OWN id (from the lookup above) as the "user to
-- delete" — never a real employee's login. That way, if the forbidden-gate
-- turns out to be broken, the worst case is limited to the disposable
-- test_crew account, not a real person's account.
select public.app_admin_delete_user('test_crew','1111', <test_crew_users_id>);
-- expect: forbidden / an authorization error. If it SUCCEEDS instead, that is
-- a live confidentiality/authorization bug — any employee could delete any
-- user's login — treat as a Blocker and stop using this RPC until it's fixed.
-- (If test_crew's own login just got deleted because this test failed, you'll
-- need to recreate it before using test_crew again.)
--
-- TEST 4b -- test_admin: DO NOT actually run app_admin_delete_user here.
-- Instead, this is a manual inspection instruction, not an automatic
-- assertion:
--   1) Pick a target user id and record its CURRENT state before touching
--      anything:
--        select * from public.users where id = <targetUserId>;
--      (If you want to know which columns exist first:
--        select column_name from information_schema.columns
--        where table_schema='public' and table_name='users';)
--   2) Only if you actually intend to test the delete path, run
--      app_admin_delete_user as test_admin against a DISPOSABLE test row you
--      created specifically for this purpose — never a real employee login —
--      then re-run the same SELECT from step 1 and compare.
--   3) READ the result; don't assume which kind of "delete" it is:
--        - Row is GONE (0 rows returned)               -> HARD delete (a real SQL DELETE).
--        - Row still EXISTS but an active/is_active/status-style flag flipped -> SOFT delete.
--        - Row still EXISTS with no obvious flag change  -> inspect every
--          column for an archived/deleted/status field before concluding
--          anything; don't guess.
--   This matters because specs/audit_admin_dashboards.md (finding #6) and
--   specs/OPEN_QUESTIONS_FOR_ISSAC.md ("Admin / Time Clock") both flag this
--   as an open, unresolved question: the Admin Console's own Data Retention
--   copy promises "Records are archived, never hard-deleted," and the
--   Employee Roster already has a confirmed soft-delete alternative,
--   app_emp_set_active (toggles an `active` flag — also un-sourced in this
--   repo, see Appendix). If app_admin_delete_user turns out to be a literal
--   hard DELETE, it directly contradicts that promise and can orphan
--   discipline/notes/timesheet/schedule rows that still reference the
--   deleted user's id.


-- ----------------------------------------------------------------------------
-- B5 -- test accounts working together: submit -> approve -> verify
-- SOURCE: phase1_scheduling.sql (open-shift marketplace + PTO backend —
-- pre-existing, not one of this session's fixes; included because the task
-- asked for a cross-account workflow chain and this is the real one)
-- ----------------------------------------------------------------------------
-- Auth helper here is _pm_auth, not _pp_auth — same query shape against
-- public.users though (confirmed at preventive_maintenance.sql:43-51), so
-- test_admin/test_crew authenticate the same way. Manager gate here is
-- public._sched_mgr(role) = role IN ('Manager','Admin Manager',
-- 'Vice President/Co-Owner','Store Manager') — an EXACT-match list (not
-- ilike '%admin%' like most other modules) — but 'Admin Manager' is one of
-- the four, so test_admin qualifies.
--
-- Note: this codebase's PTO system (app_pto_get/app_pto_adjust/app_pto_accrue/
-- app_pto_consume, all in phase1_scheduling.sql) is a manager-adjusted BALANCE
-- LEDGER, not a crew-submitted request/approval ticket — there is no
-- "employee requests time off" RPC to pair with an approve/deny step. The
-- real submit -> approve/deny workflow in this codebase is the OPEN-SHIFT
-- MARKETPLACE below, which is what this test uses.
--
-- PREREQUISITE -- test_crew must be linked to a roster row
-- (schedule_employees.linked_username = 'test_crew'), and there must be at
-- least one OPEN shift (employee_id IS NULL, published = true, shift_date >=
-- today) that test_crew is cleared for. Check/find both first:
select id, name, linked_username from public.schedule_employees where linked_username in ('test_admin','test_crew');

select s.id as open_shift_id, s.location, s.shift_date, s.start_time, s.end_time, s.position_id
from public.shifts s
where s.employee_id is null and s.published = true and s.shift_date >= current_date
order by s.shift_date, s.start_time limit 5;
-- If this returns no rows: ask a manager to publish one open shift for
-- testing, or run this whole B5 later once one exists. If test_crew isn't
-- roster-linked, both steps below will fail with "You are not linked to the
-- roster yet" — that's a setup gap, not a bug in the fix being tested.

-- STEP 1 (submit) -- test_crew requests the open shift found above:
select public.app_openshift_claim('test_crew','1111', <open_shift_id>);
-- expect: {"ok":true,"claim_id":<n>} — note the claim_id for steps 2 and 3.
-- (If you get "You are not cleared for that position yet" or "overlaps a
-- shift you already have" instead, pick a different open_shift_id that
-- test_crew is actually eligible for.)

-- STEP 2 (approve) -- test_admin approves that claim:
select public.app_claim_decide('test_admin','1111', <claim_id>, true);
-- expect: {"ok":true,"approved":true,"shift_id":<open_shift_id>,"employee_id":<test_crew's roster id>}
-- (Pass false instead of true to test the DENY path instead — expect
-- {"ok":true,"approved":false} and the shift stays open/unassigned.)

-- STEP 3 (verify) -- confirm the status actually changed in the data itself,
-- not just in the RPC's own echoed response:
select id, shift_id, employee_id, status, decided_by, decided_at
from public.shift_claims where id = <claim_id>;
-- expect: status = 'approved', decided_by = test_admin's public.users.id
-- (from the lookup above), decided_at is set (not null)

select id, employee_id, shift_date, start_time, location
from public.shifts where id = <open_shift_id>;
-- expect: employee_id now equals test_crew's schedule_employees.id — the
-- shift is no longer open.

-- Negative control (run against a SEPARATE open shift/claim; skip if you only
-- set up one):
select public.app_claim_decide('test_crew','1111', <some_other_claim_id>, true);
-- expect: forbidden ("Managers only") — crew cannot self-approve their own
-- shift requests.

-- ----------------------------------------------------------------------------
-- B5 VARIANT -- literal "shift-swap" naming (offer a shift TO a specific
-- coworker), if you'd rather test that path instead of / in addition to the
-- open-shift claim above. Needs a second real schedule_employees.id as the
-- target coworker (that coworker does not need their own login for this
-- test) and test_crew must already OWN an assigned, published shift.
-- ----------------------------------------------------------------------------
select id, employee_id, shift_date, location from public.shifts
where employee_id = (select id from public.schedule_employees where linked_username='test_crew')
  and published = true and shift_date >= current_date
order by shift_date limit 5;
-- pick one of these as <my_shift_id>; pick any OTHER coworker's
-- schedule_employees.id (cleared for that shift's position) as <targetEmpId>

select public.app_swap_offer('test_crew','1111', <my_shift_id>, <targetEmpId>);
-- expect: {"ok":true,"offer_id":<n>} — a direct-to-coworker swap offer goes
-- straight to "awaiting manager decision" status (see app_offers_pending's
-- WHERE o.status='accepted'); unlike a released-to-the-pool offer (picked up
-- via app_offer_pickup), it needs no separate peer-acceptance step.

select public.app_offer_decide('test_admin','1111', <offer_id>, true);
-- expect: {"ok":true,"approved":true,"shift_id":<my_shift_id>,"employee_id":<targetEmpId>}

select id, shift_id, offer_type, status, decided_by, decided_at
from public.shift_offers where id = <offer_id>;
-- expect: status = 'approved'


-- ############################################################################
-- ## APPENDIX — RPCs referenced by the frontend / manifest with NO .sql     ##
-- ## source anywhere in this repo (discovered while compiling this file)   ##
-- ############################################################################
-- Every one of these can be pulled live with:
--   select pg_get_functiondef('public.<name>'::regproc);
--
--   yv_advance, yv_assign, yv_assignable, yv_get, yv_list, yv_message,
--     yv_mine, yv_note, yv_status, yv_submit, yv_win_list, yv_win_save
--     (Your Voice 2.0 — see B2 above)
--   app_harassment_list / app_harassment_update
--     (legacy Report-a-Concern — see B2 above; possibly slated for retirement,
--     per specs/OPEN_QUESTIONS_FOR_ISSAC.md)
--   app_checklist_items, app_checklist_toggle, app_checklist_window_set,
--     app_checklist_windows
--     (Shift Checklists — see B3 above)
--   app_admin_delete_user
--     (Manager Dashboard Users-tab delete — see B4 above)
--   app_emp_set_active
--     (Employee Roster's confirmed-soft deactivate toggle — referenced in
--     specs/audit_admin_dashboards.md as the safe alternative to B4's RPC;
--     not tested in this file, but worth knowing it exists)
--
-- None of these are guessed at anywhere in this file — every place one is
-- mentioned above, it's flagged as unverified/skipped rather than tested.
-- ============================================================================
