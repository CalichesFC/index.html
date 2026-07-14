-- ============================================================================
-- Caliche's Hub — TEAM GROWTH FINISH (team_growth_finish.sql)  [ADDITIVE]
-- Closes the remaining "Team Growth & Evaluations" spec gaps + wires the
-- employee-development spine into eligibility. Apply AFTER team_growth.sql,
-- tg_finish.sql and payraise_deltas.sql (training_hub.sql /
-- employee_passport.sql / passport_phase2.sql should also be live — every
-- read of their tables below is to_regclass-guarded / exception-wrapped so a
-- missing module degrades instead of erroring).
--
-- Adds:
--   1. app_tg_corp_dashboard   — corporate "Company" tab: per-store + company
--        rollups (eval compliance %, pending proposals + $ exposure, promotion
--        queue, certs expiring, recognition 30d, open concerns).
--   2. Four printable report RPCs — app_tg_report_evals / app_tg_report_certs
--        / app_tg_report_growth / app_tg_report_recognition.
--   3. app_tg_automation_scan  — overdue-review task+notify (deduped) and
--        "cert completed yesterday" store-manager notices, plus an AFTER
--        INSERT trigger on trh_certifications that syncs cert awards into
--        employee_certs and (config-mapped ONLY) position clearance/passport.
--   4. app_tg_spine            — passport level + LMS/training-path progress
--        + clearances for the Development card in the employee detail (js/17).
--   5. Mr. Scoopy Q&A rows for the new surfaces (teach_scoopy.sql pattern).
--
-- HARD RULES HONORED:
--   * Additive + idempotent only: create table if not exists /
--     create or replace function / drop+create trigger. Nothing redefined.
--   * New table RLS-enabled, NO policies (deny-all; RPC-only access).
--   * Every RPC: SECURITY DEFINER, set search_path=public,extensions,
--     (p_username text, p_password text, ...) first args, auth via
--     public._pp_auth + role gates public._tg_is_mgr / public._tg_is_corp
--     (exact same helper pattern as team_growth.sql / payraise_deltas.sql).
--   * app_task_create is called DEFENSIVELY via dynamic EXECUTE inside an
--     exception handler — the dsr_action_create pattern (daily_store_report.sql).
--   * Config via app_settings (group tg_config + new group cert_position_map).
--
-- >>> INTEGRATOR: VERIFY AGAINST THE LIVE DB BEFORE APPLYING <<<
--   (1) team_growth.sql + payraise_deltas.sql applied (uses _tg_is_mgr,
--       _tg_is_corp, _tg_cfg_num, _tg_emp_location, _tg_emp_typ_hours,
--       _tg_open_concerns, _tg_notify_employee, tg_pay_proposals,
--       tg_promo_recommendations, tg_evaluations).
--   (2) public.employee_certs(employee_id, cert_type, cert_number,
--       issued_date, expires_date) exists live (training_hub.sql mirrors into
--       it; app_emp_certs_get reads it). All reads/writes guarded anyway.
--   (3) public.recognition is NOT confirmed in-repo (same caveat as
--       team_growth.sql). All recognition reads are dynamic + guarded and
--       return "unavailable" instead of erroring.
--   (4) public.audit_log time column is `at` (as read by passport_phase2.sql
--       app_passport_extra_get). The growth report reads it guarded.
--   (5) The shared tasks TABLE name is not in-repo (tasks are created via the
--       live app_task_create RPC). The open-task dedupe probe reads the name
--       from app_settings skey 'tg_tasks_table' (default 'tasks' — same
--       convention as mkt2_config tasks_table) and is fully guarded; the
--       tg_automation_log ledger below is the authoritative dedupe either way.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Config seeds (idempotent; admin-editable via app_settings_get/_set)
-- ----------------------------------------------------------------------------
insert into public.app_settings(skey, sgroup, label, svalue, sort)
select v.skey, 'tg_config', v.label, v.svalue, v.sort
from (values
  ('tg_cert_expiring_days',        'Team Growth: Company dashboard — certification "expiring soon" window (days)', '30', 40),
  ('tg_review_overdue_task_days',  'Team Growth: automation — create a follow-up task when a review is this many days overdue', '30', 41),
  ('tg_tasks_table',               'Team Growth: automation — shared tasks table name for the open-task dedupe probe (same convention as mkt2 tasks_table)', 'tasks', 42),
  ('tg_cert_award_passport_level', 'Team Growth: cert-award sync — passport level granted for a cert-mapped position (Learning/Developing/Qualified/Ace/Coach)', 'Qualified', 43)
) as v(skey, label, svalue, sort)
where not exists (select 1 from public.app_settings s where s.skey = v.skey);

-- Cert -> position mapping lives in app_settings group 'cert_position_map':
--   label  = the EXACT cert name as awarded (trh_certifications.cert_name)
--   svalue = the schedule_positions.id that cert clears the employee for
-- NO mappings are seeded (do not invent them). Example — uncomment and set a
-- real position id to activate:
-- insert into public.app_settings(skey, sgroup, label, svalue, sort)
-- select 'cert_position_map_blue_apron', 'cert_position_map',
--        'Blue Apron Certification', '<schedule_positions.id>', 0
-- where not exists (select 1 from public.app_settings where skey = 'cert_position_map_blue_apron');

-- ----------------------------------------------------------------------------
-- 1) Automation ledger (RLS on, deny-all — written only by the RPCs below).
--    One OPEN row per (kind, employee) is the overdue-task dedupe; the partial
--    unique index makes cert-award notices idempotent via ON CONFLICT.
-- ----------------------------------------------------------------------------
create table if not exists public.tg_automation_log (
  id          bigserial primary key,
  kind        text not null,          -- 'review_overdue_task' | 'cert_award_notice'
  employee_id bigint,
  ref_id      bigint,                 -- trh_certifications.id for cert notices
  marker      text,                   -- task marker title used for dedupe
  details     jsonb,
  created_at  timestamptz not null default now(),
  cleared_at  timestamptz             -- set when the condition resolves (re-arms the alert)
);
alter table public.tg_automation_log enable row level security;
create index if not exists tg_automation_log_open_idx
  on public.tg_automation_log(kind, employee_id) where cleared_at is null;
create unique index if not exists tg_automation_log_ref_uq
  on public.tg_automation_log(kind, ref_id) where ref_id is not null;

-- ----------------------------------------------------------------------------
-- 2) Module-local helper (_tg_ prefix — NOT an app_ RPC, keep out of manifest)
-- ----------------------------------------------------------------------------
create or replace function public._tg_cfg_text(p_key text, p_default text)
returns text language plpgsql stable security definer set search_path=public,extensions as $fn$
declare v_val text;
begin
  begin
    select svalue into v_val from public.app_settings where skey = p_key;
  exception when others then
    v_val := null;
  end;
  return coalesce(nullif(btrim(coalesce(v_val,'')),''), p_default);
end $fn$;
revoke execute on function public._tg_cfg_text(text,text) from anon, authenticated;

-- ============================================================================
-- 3) app_tg_corp_dashboard — per-store + company rollups (corporate/admin)
--    Review-due logic = app_tg_status_labels (latest eval's next_review_date);
--    $ exposure = app_tg_payroll_exposure's pending-bucket internals
--    (delta rate x typical weekly hours — ESTIMATES, label them in the UI).
-- GET shape:
--   { ok, generated_at, recognition_available,
--     company:{ employees, evals_overdue, evals_due_soon, never_evaluated,
--       compliance_pct, open_concerns, pending_proposals,
--       pending_weekly_exposure, pending_monthly_exposure, promotion_queue,
--       certs_expiring, recognition_30d, is_estimate, default_weekly_hours,
--       cert_expiring_days },
--     stores:[{ location, employees, evals_overdue, evals_due_soon,
--       never_evaluated, compliance_pct, open_concerns, pending_proposals,
--       pending_weekly_exposure, pending_monthly_exposure, promotion_queue,
--       certs_expiring, recognition_30d }] }
-- ============================================================================
create or replace function public.app_tg_corp_dashboard(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text;
  v_cert_days int    := coalesce(public._tg_cfg_num('tg_cert_expiring_days',30),30)::int;
  v_def       numeric := coalesce(public._tg_cfg_num('tg_default_weekly_hours',25),25);
  v_factor    numeric := coalesce(public._tg_cfg_num('tg_hours_per_month_factor',4.33),4.33);
  v_emp_agg   jsonb := '[]'::jsonb;
  v_prop_agg  jsonb := '[]'::jsonb;
  v_promo_agg jsonb := '[]'::jsonb;
  v_certs_total int; v_certs_by_store jsonb := '{}'::jsonb;
  v_rec_total   int; v_rec_by_store   jsonb := '{}'::jsonb; v_rec_available boolean := false;
  v_stores jsonb := '{}'::jsonb; v_stores_arr jsonb := '[]'::jsonb;
  j jsonb; k text;
  v_total_emp int; v_total_overdue int; v_total_due_soon int; v_total_never int;
  v_total_concerns int; v_total_pending int; v_total_pending_wk numeric; v_total_promo int;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_corp(v_role) then raise exception 'forbidden'; end if;

  -- (a) roster + review compliance + open concerns per store ------------------
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'location', t.loc, 'employees', t.employees,
        'evals_overdue', t.evals_overdue, 'evals_due_soon', t.evals_due_soon,
        'never_evaluated', t.never_evaluated, 'open_concerns', t.open_concerns,
        'compliance_pct', case when t.employees > 0
           then round(100.0 * (t.employees - t.evals_overdue) / t.employees) end
      )), '[]'::jsonb)
    into v_emp_agg
    from (
      select coalesce(emp.loc,'') as loc,
             count(*)::int as employees,
             (count(*) filter (where le.next_review_date is not null
                                 and le.next_review_date < current_date))::int as evals_overdue,
             (count(*) filter (where le.next_review_date is not null
                                 and le.next_review_date >= current_date
                                 and le.next_review_date <= current_date + 14))::int as evals_due_soon,
             (count(*) filter (where le.eval_id is null))::int as never_evaluated,
             (count(*) filter (where jsonb_array_length(public._tg_open_concerns(emp.id)) > 0))::int as open_concerns
      from (select se.id, public._tg_emp_location(se.id) as loc
            from public.schedule_employees se) emp
      left join lateral (
        select e.id as eval_id, e.next_review_date
        from public.tg_evaluations e
        where e.employee_id = emp.id
        order by e.eval_date desc
        limit 1
      ) le on true
      group by 1
    ) t;
  exception when others then
    v_emp_agg := '[]'::jsonb;
  end;

  -- (b) pending proposals + estimated weekly $ exposure per store -------------
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'location', s.loc, 'pending_proposals', s.cnt,
        'pending_weekly_exposure', s.wk,
        'pending_monthly_exposure', round(s.wk * v_factor, 2))), '[]'::jsonb)
    into v_prop_agg
    from (
      select coalesce(pp.location,'') as loc, count(*)::int as cnt,
             coalesce(round(sum(case when pp.current_rate is not null and pp.proposed_rate is not null
               then (pp.proposed_rate - pp.current_rate)
                    * coalesce(pp.typ_weekly_hours, public._tg_emp_typ_hours(pp.employee_id), v_def) end), 2), 0) as wk
      from public.tg_pay_proposals pp
      where pp.status in ('submitted','corporate_review','needs_info')
      group by 1
    ) s;
  exception when others then
    -- payraise_deltas.sql not applied yet (no typ_weekly_hours column):
    -- degrade to default-hours-only estimates rather than erroring.
    begin
      select coalesce(jsonb_agg(jsonb_build_object(
          'location', s.loc, 'pending_proposals', s.cnt,
          'pending_weekly_exposure', s.wk,
          'pending_monthly_exposure', round(s.wk * v_factor, 2))), '[]'::jsonb)
      into v_prop_agg
      from (
        select coalesce(pp.location,'') as loc, count(*)::int as cnt,
               coalesce(round(sum(case when pp.current_rate is not null and pp.proposed_rate is not null
                 then (pp.proposed_rate - pp.current_rate) * v_def end), 2), 0) as wk
        from public.tg_pay_proposals pp
        where pp.status in ('submitted','corporate_review','needs_info')
        group by 1
      ) s;
    exception when others then
      v_prop_agg := '[]'::jsonb;
    end;
  end;

  -- (c) promotion queue per store ---------------------------------------------
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'location', s.loc, 'promotion_queue', s.cnt)), '[]'::jsonb)
    into v_promo_agg
    from (
      select coalesce(r.location,'') as loc, count(*)::int as cnt
      from public.tg_promo_recommendations r
      where r.status in ('pending','under_review')
      group by 1
    ) s;
  exception when others then
    v_promo_agg := '[]'::jsonb;
  end;

  -- (d) certifications expiring within the window (guarded — live table) ------
  begin
    select count(*)::int into v_certs_total
    from public.employee_certs ec
    where ec.expires_date is not null
      and ec.expires_date >= current_date
      and ec.expires_date <= current_date + v_cert_days;
    select coalesce(jsonb_object_agg(s.loc, s.cnt), '{}'::jsonb) into v_certs_by_store
    from (
      select coalesce(public._tg_emp_location(ec.employee_id),'') as loc, count(*)::int as cnt
      from public.employee_certs ec
      where ec.expires_date is not null
        and ec.expires_date >= current_date
        and ec.expires_date <= current_date + v_cert_days
      group by 1
    ) s;
  exception when others then
    v_certs_total := null; v_certs_by_store := '{}'::jsonb;
  end;

  -- (e) recognition last 30 days (table not confirmed in-repo — dynamic + guarded,
  --     same caveat as app_tg_my_growth's recognition block) -------------------
  begin
    if to_regclass('public.recognition') is not null then
      execute 'select count(*)::int from public.recognition r where r.created_at >= now() - interval ''30 days'''
        into v_rec_total;
      v_rec_available := true;
      begin
        execute 'select coalesce(jsonb_object_agg(s.loc, s.cnt), ''{}''::jsonb) from ('
             || ' select coalesce(r.location,'''') as loc, count(*)::int as cnt'
             || ' from public.recognition r where r.created_at >= now() - interval ''30 days'''
             || ' group by 1) s'
          into v_rec_by_store;
      exception when others then
        v_rec_by_store := '{}'::jsonb; -- no location column live: company total only
      end;
    end if;
  exception when others then
    v_rec_total := null; v_rec_available := false;
  end;

  -- merge the per-store aggregates into one object keyed by location ----------
  for j in select value from jsonb_array_elements(v_emp_agg) loop
    k := coalesce(j->>'location','');
    v_stores := v_stores || jsonb_build_object(k, coalesce(v_stores->k,'{}'::jsonb) || j);
  end loop;
  for j in select value from jsonb_array_elements(v_prop_agg) loop
    k := coalesce(j->>'location','');
    v_stores := v_stores || jsonb_build_object(k, coalesce(v_stores->k,'{}'::jsonb) || j);
  end loop;
  for j in select value from jsonb_array_elements(v_promo_agg) loop
    k := coalesce(j->>'location','');
    v_stores := v_stores || jsonb_build_object(k, coalesce(v_stores->k,'{}'::jsonb) || j);
  end loop;

  select coalesce(jsonb_agg(
      (v.value || jsonb_build_object(
        'location', v.key,
        'certs_expiring', coalesce((v_certs_by_store->>v.key)::int, 0),
        'recognition_30d', case when v_rec_available then coalesce((v_rec_by_store->>v.key)::int, 0) end))
      order by nullif(v.key,'') nulls last, v.key), '[]'::jsonb)
  into v_stores_arr
  from jsonb_each(v_stores) as v;

  select coalesce(sum((x.value->>'employees')::int),0),
         coalesce(sum((x.value->>'evals_overdue')::int),0),
         coalesce(sum((x.value->>'evals_due_soon')::int),0),
         coalesce(sum((x.value->>'never_evaluated')::int),0),
         coalesce(sum((x.value->>'open_concerns')::int),0),
         coalesce(sum((x.value->>'pending_proposals')::int),0),
         coalesce(sum((x.value->>'pending_weekly_exposure')::numeric),0),
         coalesce(sum((x.value->>'promotion_queue')::int),0)
  into v_total_emp, v_total_overdue, v_total_due_soon, v_total_never,
       v_total_concerns, v_total_pending, v_total_pending_wk, v_total_promo
  from jsonb_array_elements(v_stores_arr) x;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'recognition_available', v_rec_available,
    'company', jsonb_build_object(
      'employees', v_total_emp,
      'evals_overdue', v_total_overdue,
      'evals_due_soon', v_total_due_soon,
      'never_evaluated', v_total_never,
      'compliance_pct', case when v_total_emp > 0
         then round(100.0 * (v_total_emp - v_total_overdue) / v_total_emp) end,
      'open_concerns', v_total_concerns,
      'pending_proposals', v_total_pending,
      'pending_weekly_exposure', round(v_total_pending_wk, 2),
      'pending_monthly_exposure', round(v_total_pending_wk * v_factor, 2),
      'promotion_queue', v_total_promo,
      'certs_expiring', coalesce(v_certs_total, 0),
      'recognition_30d', case when v_rec_available then coalesce(v_rec_total, 0) end,
      'is_estimate', true,
      'default_weekly_hours', v_def,
      'cert_expiring_days', v_cert_days),
    'stores', v_stores_arr);
end $fn$;

-- ============================================================================
-- 4) Four report RPCs (corporate/admin; p_location ''/null = all stores).
--    Simple gated selects — the frontend prints them (tgxPrintSheet pattern).
-- ============================================================================

-- (a) Evaluation Compliance by store/employee --------------------------------
create or replace function public.app_tg_report_evals(p_username text, p_password text, p_location text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_out jsonb; v_loc text;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_corp(v_role) then raise exception 'forbidden'; end if;
  v_loc := nullif(btrim(coalesce(p_location,'')),'');

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'employee_id', emp.id, 'name', emp.name, 'location', emp.loc,
        'last_eval_date', le.eval_date, 'last_eval_type', le.eval_type,
        'overall_score', le.overall_score, 'eval_status', le.status,
        'next_review_date', le.next_review_date,
        'review_status', case
          when le.eval_date is null then 'Never evaluated'
          when le.next_review_date is not null and le.next_review_date < current_date then 'Overdue'
          when le.next_review_date is not null and le.next_review_date <= current_date + 14 then 'Due soon'
          else 'On track' end
      ) order by emp.loc nulls last, emp.name), '[]'::jsonb)
    into v_out
    from (select se.id, se.name, public._tg_emp_location(se.id) as loc
          from public.schedule_employees se) emp
    left join lateral (
      select e.eval_date, e.eval_type, e.overall_score, e.status, e.next_review_date
      from public.tg_evaluations e
      where e.employee_id = emp.id
      order by e.eval_date desc
      limit 1
    ) le on true
    where (v_loc is null or emp.loc = v_loc);
  exception when others then
    v_out := '[]'::jsonb;
  end;

  return coalesce(v_out, '[]'::jsonb);
end $fn$;

-- (b) Training & Certification status ----------------------------------------
-- GET shape: { certs:[{employee_id,name,location,cert_type,cert_number,
--                      issued,expires,status}],
--              training:[{employee_id,name,location,path,status,pct,due_date,
--                         completed_at}] }
create or replace function public.app_tg_report_certs(p_username text, p_password text, p_location text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_loc text;
  v_days int := coalesce(public._tg_cfg_num('tg_cert_expiring_days',30),30)::int;
  v_certs jsonb := '[]'::jsonb; v_training jsonb := '[]'::jsonb;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_corp(v_role) then raise exception 'forbidden'; end if;
  v_loc := nullif(btrim(coalesce(p_location,'')),'');

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'employee_id', ec.employee_id, 'name', se.name,
        'location', public._tg_emp_location(ec.employee_id),
        'cert_type', ec.cert_type, 'cert_number', ec.cert_number,
        'issued', ec.issued_date, 'expires', ec.expires_date,
        'status', case
          when ec.expires_date is null then 'No expiry'
          when ec.expires_date < current_date then 'Expired'
          when ec.expires_date <= current_date + v_days then 'Expiring soon'
          else 'Current' end
      ) order by ec.expires_date nulls last, se.name), '[]'::jsonb)
    into v_certs
    from public.employee_certs ec
    left join public.schedule_employees se on se.id = ec.employee_id
    where (v_loc is null or public._tg_emp_location(ec.employee_id) = v_loc);
  exception when others then
    v_certs := '[]'::jsonb;
  end;

  begin
    if to_regclass('public.trh_enrollments') is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
          'employee_id', e.employee_id, 'name', se.name,
          'location', public._tg_emp_location(e.employee_id),
          'path', coalesce(p.title,''), 'status', e.status,
          'pct', case when e.status = 'completed' then 100
                      else coalesce((public._trh_enr_json(e.id)->>'pct')::numeric, 0) end,
          'due_date', e.due_date, 'completed_at', e.completed_at
        ) order by e.status, se.name), '[]'::jsonb)
      into v_training
      from (select * from public.trh_enrollments
             where status in ('active','completed')
             order by assigned_at desc limit 500) e
      left join public.trh_paths p on p.id = e.path_id
      left join public.schedule_employees se on se.id = e.employee_id
      where (v_loc is null or public._tg_emp_location(e.employee_id) = v_loc);
    end if;
  exception when others then
    v_training := '[]'::jsonb;
  end;

  return jsonb_build_object('certs', v_certs, 'training', v_training,
                            'expiring_days', v_days);
end $fn$;

-- (c) Employee Growth — level/status changes in the last 90 days --------------
-- Rows: {kind:'passport_level'|'certification'|'evaluation'|'promotion',
--        employee_id, name, location, detail, by, at}
create or replace function public.app_tg_report_growth(p_username text, p_password text, p_location text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_loc text; v_out jsonb := '[]'::jsonb; v_rows jsonb;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_corp(v_role) then raise exception 'forbidden'; end if;
  v_loc := nullif(btrim(coalesce(p_location,'')),'');

  -- passport level changes (audit_log.at per passport_phase2.sql; guarded)
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'kind', 'passport_level',
        'employee_id', a.affected_employee_id, 'name', se.name,
        'location', public._tg_emp_location(a.affected_employee_id),
        'detail', coalesce(a.before_value->>'level','(none)') || ' -> ' || coalesce(a.after_value->>'level','?')
          || coalesce(' — ' || (select sp.name from public.schedule_positions sp
                                where sp.id = nullif(a.after_value->>'position_id','')::bigint), ''),
        'by', a.actor_name, 'at', a.at)), '[]'::jsonb)
    into v_rows
    from public.audit_log a
    left join public.schedule_employees se on se.id = a.affected_employee_id
    where a.source_module = 'development_passport'
      and a.action = 'passport_level_change'
      and a.at >= now() - interval '90 days'
      and (v_loc is null or public._tg_emp_location(a.affected_employee_id) = v_loc);
    v_out := v_out || coalesce(v_rows,'[]'::jsonb);
  exception when others then null;
  end;

  -- certifications awarded (training hub; guarded)
  begin
    if to_regclass('public.trh_certifications') is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
          'kind', 'certification',
          'employee_id', c.employee_id, 'name', se.name,
          'location', public._tg_emp_location(c.employee_id),
          'detail', c.cert_name || coalesce(' (expires ' || c.expires_date || ')',''),
          'by', c.issued_by, 'at', c.issued_at)), '[]'::jsonb)
      into v_rows
      from public.trh_certifications c
      left join public.schedule_employees se on se.id = c.employee_id
      where c.issued_at >= now() - interval '90 days'
        and (v_loc is null or public._tg_emp_location(c.employee_id) = v_loc);
      v_out := v_out || coalesce(v_rows,'[]'::jsonb);
    end if;
  exception when others then null;
  end;

  -- evaluations submitted/finalized
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'kind', 'evaluation',
        'employee_id', e.employee_id, 'name', se.name, 'location', e.location,
        'detail', e.eval_type || coalesce(' — score ' || e.overall_score, '') || ' (' || e.status || ')',
        'by', e.manager_name, 'at', e.eval_date)), '[]'::jsonb)
    into v_rows
    from public.tg_evaluations e
    left join public.schedule_employees se on se.id = e.employee_id
    where e.eval_date >= current_date - 90
      and e.status in ('submitted','acknowledged','corporate_review','finalized')
      and (v_loc is null or e.location = v_loc);
    v_out := v_out || coalesce(v_rows,'[]'::jsonb);
  exception when others then null;
  end;

  -- promotion recommendations decided (payraise_deltas; guarded)
  begin
    if to_regclass('public.tg_promo_recommendations') is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
          'kind', 'promotion',
          'employee_id', r.employee_id, 'name', se.name, 'location', r.location,
          'detail', 'Recommendation ' || r.status
            || coalesce(' — ' || r.target_role, ''),
          'by', coalesce(r.decided_by, r.recommended_by_name), 'at', coalesce(r.decided_at, r.created_at))), '[]'::jsonb)
      into v_rows
      from public.tg_promo_recommendations r
      left join public.schedule_employees se on se.id = r.employee_id
      where coalesce(r.decided_at, r.created_at) >= now() - interval '90 days'
        and (v_loc is null or r.location = v_loc);
      v_out := v_out || coalesce(v_rows,'[]'::jsonb);
    end if;
  exception when others then null;
  end;

  -- newest first (ISO text ordering is chronological enough across date/ts)
  select coalesce(jsonb_agg(x.value order by x.value->>'at' desc nulls last), '[]'::jsonb)
  into v_out from jsonb_array_elements(v_out) x;

  return coalesce(v_out, '[]'::jsonb);
end $fn$;

-- (d) Recognition summary (last 90 days; table not confirmed in-repo —
--     dynamic + guarded; returns available:false instead of erroring) --------
-- GET shape: { available, days, note, items:[{employee_id,name,type,message,
--              location,created_at}], by_employee:[{employee_id,name,count}] }
create or replace function public.app_tg_report_recognition(p_username text, p_password text, p_location text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_loc text;
  v_items jsonb := '[]'::jsonb; v_by jsonb := '[]'::jsonb; v_ok boolean := false;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_corp(v_role) then raise exception 'forbidden'; end if;
  v_loc := nullif(btrim(coalesce(p_location,'')),'');

  if to_regclass('public.recognition') is null then
    return jsonb_build_object('available', false, 'days', 90,
      'note', 'Recognition table not found on this database.',
      'items', '[]'::jsonb, 'by_employee', '[]'::jsonb);
  end if;

  begin
    execute 'select coalesce(jsonb_agg(jsonb_build_object('
         || '''employee_id'', r.about_emp, ''type'', r.recognition_type, '
         || '''message'', r.message, ''location'', r.location, ''created_at'', r.created_at) '
         || 'order by r.created_at desc), ''[]''::jsonb) '
         || 'from public.recognition r '
         || 'where r.created_at >= now() - interval ''90 days'' '
         || 'and ($1 is null or r.location = $1)'
      into v_items using v_loc;
    v_ok := true;
  exception when others then
    begin
      execute 'select coalesce(jsonb_agg(jsonb_build_object('
           || '''employee_id'', r.about_emp, ''type'', r.recognition_type, '
           || '''message'', r.message, ''created_at'', r.created_at) '
           || 'order by r.created_at desc), ''[]''::jsonb) '
           || 'from public.recognition r '
           || 'where r.created_at >= now() - interval ''90 days'''
        into v_items;
      v_ok := true;
    exception when others then
      return jsonb_build_object('available', false, 'days', 90,
        'note', 'Recognition table could not be read: ' || sqlerrm,
        'items', '[]'::jsonb, 'by_employee', '[]'::jsonb);
    end;
  end;

  -- enrich with names + per-employee counts (from the fetched jsonb; no more
  -- assumptions about the live table's columns)
  select coalesce(jsonb_agg(
      x.value || jsonb_build_object('name',
        (select se.name from public.schedule_employees se
          where se.id = nullif(x.value->>'employee_id','')::bigint))
      order by x.value->>'created_at' desc), '[]'::jsonb)
  into v_items from jsonb_array_elements(v_items) x;

  select coalesce(jsonb_agg(jsonb_build_object(
      'employee_id', t.emp, 'name', se.name, 'count', t.cnt)
      order by t.cnt desc, se.name), '[]'::jsonb)
  into v_by
  from (
    select nullif(x.value->>'employee_id','')::bigint as emp, count(*)::int as cnt
    from jsonb_array_elements(v_items) x
    where nullif(x.value->>'employee_id','') is not null
    group by 1
  ) t
  left join public.schedule_employees se on se.id = t.emp;

  return jsonb_build_object('available', v_ok, 'days', 90, 'note', null,
    'items', v_items, 'by_employee', v_by);
end $fn$;

-- ============================================================================
-- 5) app_tg_spine — the development spine for one employee (Development card
--    in the js/17 employee detail). Managers, or the employee about themselves.
-- GET shape (spec keys + additive extras):
--   { ok, passport_level, lp_progress:[{path,pct,status,due_date,cert_name}],
--     clearances:[position names], levels:[{position,level,cleared}],
--     stations_total, stations_qualified }
-- ============================================================================
create or replace function public.app_tg_spine(p_username text, p_password text, p_employee_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text;
  v_levels jsonb := '[]'::jsonb; v_max_rank int; v_level text;
  v_total int := 0; v_qual int := 0;
  v_lp jsonb := '[]'::jsonb; v_clear jsonb := '[]'::jsonb;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (public._tg_is_mgr(v_role) or public._pp_is_self(p_username, p_employee_id)) then
    raise exception 'forbidden';
  end if;

  -- passport levels per active station (explicit level OR derived from
  -- clearance — same derivation as app_passport_get / employee_passport.sql)
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'position', sp.name,
             'level', coalesce(pp.level, case when cl.employee_id is not null then 'Qualified' else 'Learning' end),
             'cleared', (cl.employee_id is not null))
             order by sp.sort_order, sp.name), '[]'::jsonb),
           max(public._pp_rank(coalesce(pp.level, case when cl.employee_id is not null then 'Qualified' else 'Learning' end))),
           count(*)::int,
           (count(*) filter (where public._pp_rank(coalesce(pp.level,
              case when cl.employee_id is not null then 'Qualified' else 'Learning' end)) >= 3))::int
    into v_levels, v_max_rank, v_total, v_qual
    from public.schedule_positions sp
    left join public.employee_passport pp
           on pp.position_id = sp.id and pp.employee_id = p_employee_id
    left join public.employee_position_clearance cl
           on cl.position_id = sp.id and cl.employee_id = p_employee_id
    where coalesce(sp.active, true);
  exception when others then
    v_levels := '[]'::jsonb; v_max_rank := null; v_total := 0; v_qual := 0;
  end;

  v_level := case v_max_rank
    when 5 then 'Coach' when 4 then 'Ace' when 3 then 'Qualified'
    when 2 then 'Developing' when 1 then 'Learning' else null end;

  -- LMS / training-path progress (Training Hub enrollments; guarded)
  begin
    if to_regclass('public.trh_enrollments') is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
          'path', s.j->>'title',
          'pct', coalesce((s.j->>'pct')::numeric, 0),
          'status', s.j->>'status',
          'due_date', s.j->>'due_date',
          'cert_name', s.j->>'cert_name')
          order by case when s.j->>'status' = 'active' then 0 else 1 end,
                   s.j->>'assigned_at' desc), '[]'::jsonb)
      into v_lp
      from (select public._trh_enr_json(e.id) as j
            from public.trh_enrollments e
            where e.employee_id = p_employee_id
              and e.status in ('active','completed')) s
      where s.j is not null;
    end if;
  exception when others then
    v_lp := '[]'::jsonb;
  end;

  -- station clearances (position names)
  begin
    select coalesce(jsonb_agg(sp.name order by sp.name), '[]'::jsonb)
    into v_clear
    from public.employee_position_clearance c
    join public.schedule_positions sp on sp.id = c.position_id
    where c.employee_id = p_employee_id;
  exception when others then
    v_clear := '[]'::jsonb;
  end;

  return jsonb_build_object(
    'ok', true,
    'passport_level', v_level,
    'lp_progress', v_lp,
    'clearances', v_clear,
    'levels', v_levels,
    'stations_total', v_total,
    'stations_qualified', v_qual);
end $fn$;

-- ============================================================================
-- 6) app_tg_automation_scan — run manually (manager button) or on a schedule.
--    (a) Review >= N days overdue (N = tg_review_overdue_task_days, default 30;
--        latest-eval logic = app_tg_status_labels): creates ONE open follow-up
--        task per employee via the EXISTING app_task_create (defensive dynamic
--        EXECUTE — dsr_action_create pattern) + notifies the employee.
--        Dedupe: open tg_automation_log row per employee, PLUS a best-effort
--        probe of the shared tasks table (app_settings tg_tasks_table) for an
--        open task with the marker title. Ledger rows are cleared when the
--        employee is no longer >= N days overdue, so the alert re-arms.
--    (b) Certifications completed in the last day (trh_certifications):
--        notifies that store's managers (users.store match; falls back to the
--        manager loop). Deduped per cert via the partial unique index.
-- ============================================================================
create or replace function public.app_tg_automation_scan(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_name text;
  v_days int := coalesce(public._tg_cfg_num('tg_review_overdue_task_days',30),30)::int;
  v_tbl text; v_reg regclass; v_marker text; v_open boolean;
  v_res jsonb; v_err text; v_status text;
  v_tasks int := 0; v_task_fail int := 0; v_cleared int := 0; v_notes int := 0;
  v_loc text; v_emp_name text; v_notified int;
  r record; c record; u record;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  -- ---- (a0) re-arm: clear ledger rows for employees no longer >=N days overdue
  update public.tg_automation_log l
     set cleared_at = now()
   where l.kind = 'review_overdue_task'
     and l.cleared_at is null
     and coalesce((
       select (e.next_review_date is not null and e.next_review_date <= current_date - v_days)
       from public.tg_evaluations e
       where e.employee_id = l.employee_id
       order by e.eval_date desc
       limit 1), false) = false;
  get diagnostics v_cleared = row_count;

  -- ---- (a) overdue reviews -> one open task + employee notification ---------
  for r in
    select emp.id, emp.name, emp.loc, le.next_review_date
    from (select se.id, se.name, public._tg_emp_location(se.id) as loc
          from public.schedule_employees se) emp
    join lateral (
      select e.next_review_date
      from public.tg_evaluations e
      where e.employee_id = emp.id
      order by e.eval_date desc
      limit 1
    ) le on true
    where le.next_review_date is not null
      and le.next_review_date <= current_date - v_days
  loop
    v_marker := '[TG] Overdue review — ' || coalesce(r.name, '#' || r.id);

    -- dedupe 1: an open ledger row for this employee
    continue when exists (
      select 1 from public.tg_automation_log l
      where l.kind = 'review_overdue_task' and l.employee_id = r.id and l.cleared_at is null);

    -- dedupe 2 (best-effort): an open task with the marker title in the shared
    -- tasks table (name from app_settings tg_tasks_table; fully guarded)
    v_open := false;
    begin
      v_tbl := public._tg_cfg_text('tg_tasks_table','tasks');
      v_reg := to_regclass('public.' || v_tbl);
      if v_reg is not null then
        begin
          execute format(
            'select exists(select 1 from %s t where (t.title)::text = $1 and coalesce((t.status)::text, ''open'') not in (''done'',''completed'',''complete'',''closed'',''cancelled'',''archived''))',
            v_reg::text)
            into v_open using v_marker;
        exception when others then
          execute format('select exists(select 1 from %s t where (t.title)::text = $1)', v_reg::text)
            into v_open using v_marker;
        end;
      end if;
    exception when others then
      v_open := false;
    end;
    continue when v_open;

    -- create the task via the EXISTING app_task_create — defensive dynamic
    -- call, exact dsr_action_create pattern (a live signature drift is caught
    -- and recorded instead of failing the scan)
    v_status := 'task_created'; v_res := null; v_err := null;
    begin
      execute 'select public.app_task_create(p_username=>$1,p_password=>$2,p_title=>$3,'
           || 'p_details=>$4,p_due=>$5,p_target_type=>$6,p_target_value=>$7,'
           || 'p_employee_ids=>$8,p_completion_mode=>$9)'
        into v_res
        using p_username, p_password, v_marker,
              format('Automation: %s''s review is %s+ days overdue (next review was due %s). Complete an evaluation in Team Growth & Evaluations.',
                     coalesce(r.name,'This employee'), v_days, r.next_review_date),
              (current_date + 7), 'store', coalesce(r.loc,''), null::bigint[], 'store';
      v_tasks := v_tasks + 1;
    exception when others then
      get stacked diagnostics v_err = message_text;
      v_status := 'task_failed';
      v_task_fail := v_task_fail + 1;
    end;

    insert into public.tg_automation_log(kind, employee_id, marker, details)
    values ('review_overdue_task', r.id, v_marker,
            jsonb_build_object('status', v_status, 'task_result', v_res, 'error', v_err,
                               'next_review_date', r.next_review_date, 'location', r.loc));

    perform public._tg_notify_employee(r.id, '📋 Review overdue',
      'Your scheduled review is overdue — your manager has been asked to schedule it.');
  end loop;

  -- ---- (b) certifications completed in the last day -> store-manager notice -
  begin
    if to_regclass('public.trh_certifications') is not null then
      for c in
        select t.id, t.employee_id, t.cert_name, t.issued_at
        from public.trh_certifications t
        where t.issued_at >= now() - interval '1 day'
      loop
        -- dedupe per cert (partial unique index on (kind, ref_id))
        insert into public.tg_automation_log(kind, employee_id, ref_id, details)
        values ('cert_award_notice', c.employee_id, c.id,
                jsonb_build_object('cert_name', c.cert_name, 'issued_at', c.issued_at))
        on conflict do nothing;
        continue when not found;

        v_loc := public._tg_emp_location(c.employee_id);
        select name into v_emp_name from public.schedule_employees where id = c.employee_id;

        -- notify that store's managers (users.store per marketing_v2 contract);
        -- guarded — falls back to the manager loop if the column/match fails
        v_notified := 0;
        begin
          for u in
            select id from public.users
            where (role ilike '%manager%' or role ilike '%admin%')
              and coalesce(store,'') = coalesce(v_loc,'') and coalesce(v_loc,'') <> ''
          loop
            begin
              perform public.push_enqueue(u.id, '🏅 Certification completed',
                format('%s completed the %s%s.', coalesce(v_emp_name,'An employee'), c.cert_name,
                       case when coalesce(v_loc,'') <> '' then ' at ' || v_loc else '' end), '');
              v_notified := v_notified + 1;
            exception when others then null;
            end;
          end loop;
        exception when others then
          v_notified := 0;
        end;
        if v_notified = 0 then
          begin
            perform public._trh_notify_mgrs('🏅 Certification completed',
              format('%s completed the %s%s.', coalesce(v_emp_name,'An employee'), c.cert_name,
                     case when coalesce(v_loc,'') <> '' then ' at ' || v_loc else '' end));
          exception when others then null;
          end;
        end if;
        v_notes := v_notes + 1;
      end loop;
    end if;
  exception when others then
    null; -- cert notices never block the review scan result
  end;

  return jsonb_build_object('ok', true,
    'overdue_days', v_days,
    'overdue_tasks_created', v_tasks,
    'overdue_task_failures', v_task_fail,
    'overdue_cleared', v_cleared,
    'cert_notices', v_notes);
end $fn$;

-- ============================================================================
-- 7) Cert-award sync trigger — AFTER INSERT on trh_certifications (the table
--    trh_award_cert writes, training_hub.sql). Keeps the employee-cert store
--    that js/17 reads (public.employee_certs via app_emp_certs_get) in sync
--    for ANY insert path, and applies the config-mapped position effects.
--    NOTE ON PASSPORT WRITES:
--      * employee_position_clearance + employee_passport level are written
--        ONLY when a CLEAN mapping exists in app_settings group
--        'cert_position_map' (label = cert name, svalue = position id) —
--        the passport upsert mirrors trh_award_cert exactly (raise-only via
--        _pp_rank; unique (employee_id,position_id)).
--      * position_hours (passport_phase2.sql) is intentionally NOT written:
--        it records worked hours per date/position and a cert award carries
--        no hours semantics — writing there would fabricate data.
--      * audit_log passport_level_change events are NOT written from this
--        trigger: _pp_audit needs an authenticated actor and a trigger has
--        no auth context (level history therefore shows trigger-driven level
--        raises via employee_passport.approved_by/signoff_note instead).
-- ============================================================================
create or replace function public._tg_cert_award_sync()
returns trigger language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_lvl text;
  m record;
begin
  -- (a) mirror into employee_certs (no unique constraint on that live table,
  --     so ON CONFLICT has no arbiter — use WHERE NOT EXISTS exactly like the
  --     trh_award_cert mirror block; guarded so a schema drift never blocks
  --     the cert insert itself)
  begin
    insert into public.employee_certs(employee_id, cert_type, issued_date, expires_date)
    select new.employee_id, new.cert_name, coalesce(new.issued_at::date, current_date), new.expires_date
    where not exists (
      select 1 from public.employee_certs ec
      where ec.employee_id = new.employee_id and ec.cert_type = new.cert_name
        and coalesce(ec.expires_date, '9999-12-31'::date) >= current_date);
  exception when others then null;
  end;

  -- (b) config-mapped position clearance + passport level (see NOTE above)
  begin
    v_lvl := public._tg_cfg_text('tg_cert_award_passport_level','Qualified');
    if v_lvl not in ('Learning','Developing','Qualified','Ace','Coach') then
      v_lvl := 'Qualified';
    end if;
    for m in
      select nullif(btrim(s.svalue),'')::bigint as position_id
      from public.app_settings s
      where s.sgroup = 'cert_position_map'
        and s.label = new.cert_name
        and nullif(btrim(s.svalue),'') ~ '^[0-9]+$'
    loop
      begin
        insert into public.employee_position_clearance(employee_id, position_id)
        select new.employee_id, m.position_id
        where not exists (
          select 1 from public.employee_position_clearance c
          where c.employee_id = new.employee_id and c.position_id = m.position_id);
      exception when others then null;
      end;
      begin
        insert into public.employee_passport(employee_id, position_id, level, approved_by, approved_role, approved_at, signoff_note)
        values (new.employee_id, m.position_id, v_lvl,
                coalesce(new.issued_by,'system'), 'automation', now(),
                'Cert award sync: ' || new.cert_name)
        on conflict (employee_id, position_id) do update
          set level = excluded.level, approved_by = excluded.approved_by,
              approved_role = excluded.approved_role, approved_at = now(),
              signoff_note = excluded.signoff_note, updated_at = now()
          where public._pp_rank(employee_passport.level) < public._pp_rank(excluded.level);
      exception when others then null;
      end;
    end loop;
  exception when others then null;
  end;

  return new;
end $fn$;
revoke execute on function public._tg_cert_award_sync() from anon, authenticated;

do $do$
begin
  if to_regclass('public.trh_certifications') is not null then
    execute 'drop trigger if exists tg_cert_award_sync on public.trh_certifications';
    execute 'create trigger tg_cert_award_sync after insert on public.trh_certifications '
         || 'for each row execute function public._tg_cert_award_sync()';
  end if;
end;
$do$;

-- ============================================================================
-- 8) Teach Mr. Scoopy the new surfaces (exact teach_scoopy.sql pattern —
--    idempotent, inserts only when the question is not already known)
-- ============================================================================
insert into public.knowledge_base (category, question, answer, updated_at, updated_by)
select 'App Help', q, a, now(), 'Cowork build' from (values
  ('What is the Company tab in Team Growth?',
   'The Company tab (corporate/admin only, inside Team Growth & Evaluations) is the company-wide rollup: evaluation compliance percent per store, pending pay proposals with their estimated dollar exposure, the promotion queue, certifications expiring soon, recognition in the last 30 days, and open performance concerns. Dollar figures are estimates until real hours land.'),
  ('What reports can corporate print from Team Growth?',
   'Four printable reports live on the Company tab: Evaluation Compliance (by store and employee), Training & Certification status, Employee Growth (level and status changes in the last 90 days), and a Recognition summary. Open one and use Print / Save PDF for a clean copy.'),
  ('How do I start a PIP from Team Growth?',
   'On the My Team tab, each employee row has a PIP button, and the employee detail shows a Start corrective action / PIP button. It opens the same corrective-action form used on the roster. If someone is already on a plan, an Active PIP chip shows on their detail instead.'),
  ('What is the Development card in Team Growth?',
   'Open an employee from My Team to see their Development card: their Development Passport level, progress on each assigned learning path, and which stations they are cleared for. Managers use it as real input when judging raise or promotion eligibility.'),
  ('What does the Team Growth automation scan do?',
   'It creates one open follow-up task and a notification when an employee''s review is 30 or more days overdue (no duplicates while the task is open), and it tells that store''s managers when someone completed a certification in the last day. Certification awards also sync automatically onto the employee''s certification list.')
) v(q,a)
where not exists (select 1 from public.knowledge_base kb where kb.question = v.q);

-- ============================================================================
-- NEW RPCS (add to rpc_manifest.json): app_tg_corp_dashboard,
--   app_tg_report_evals, app_tg_report_certs, app_tg_report_growth,
--   app_tg_report_recognition, app_tg_spine, app_tg_automation_scan
-- (helpers _tg_cfg_text / _tg_cert_award_sync and table tg_automation_log are
--  module-local — NOT frontend RPCs, keep them out of the manifest, same as
--  the other _tg_ helpers.)
-- ============================================================================

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
-- ============================================================================
