-- ============================================================================
-- Caliche's Hub — TEAM GROWTH & EVALUATIONS  (backend foundation, Phase 0-1)
-- Additive, idempotent. Run in Supabase SQL editor (proj ikgbihwkqhsfahnswfbz).
--
-- Scope: evaluation templates + evaluations + scores, configurable pay ranges,
-- pay-proposal workflow + validation-flag engine (NEVER auto-approves), review
-- scheduling config, the employee "My Growth Path" self view, and a manager
-- dashboard. See specs/PLAN_evaluations_build.md §4a/§4b for the full plan
-- (this file implements Phase 0-1 only — dashboards/reports/automation for
-- corporate, review-task generation, and PDF export are later phases).
--
-- Reuses the SAME auth/audit foundation already shipped with the passport:
--   public._pp_auth(username,password)  -> (uid bigint, urole text, uname text)
--   public._pp_is_self(username, employee_id) -> boolean
--   public._pp_audit(actor_id,actor_name,action,employee_id,before,after,reason)
-- (defined in employee_passport.sql — NOT redefined here.)
--
-- Identity: employee = public.schedule_employees.id (roster id). NEVER a new
-- employee table. schedule_employees.linked_username -> users account.
--
-- >>> VERIFY THESE BEFORE RUNNING (see VERIFY block at bottom) <<<
--   (1) public._pp_auth / public._pp_is_self / public._pp_audit exist
--       (they ship with employee_passport.sql — apply that first if not live).
--   (2) public.schedule_employees has: id, name, linked_username. This file
--       ALSO tries home_location and hourly_wage but reads them through
--       defensive helpers (_tg_emp_location / _tg_emp_wage) that swallow an
--       "undefined_column" error and return null — so a wrong/missing column
--       name there degrades gracefully instead of breaking every RPC.
--   (3) public.audit_log columns match: actor_id,actor_name,action,
--       affected_employee_id,before_value,after_value,source_module,reason.
--   (4) public.app_settings exists (admin_settings.sql) — used to read the
--       configurable "normal raise %" threshold (group 'tg_config').
--   (5) The recognition table backing app_recognition_post is NOT confirmed
--       in-repo (no create table found anywhere). app_tg_my_growth guesses
--       public.recognition(recognition_type, message, about_emp, created_at)
--       and wraps that read in its own exception block — if the real table/
--       columns differ, that one section silently returns [] instead of
--       erroring. Author: fix that block once the real name/columns are known.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Small helper functions (module-local, "_tg_" prefix; not app_ RPCs, do
--    NOT add these to rpc_manifest.json — mirrors the "_pp_"/"_rr_" pattern).
-- ----------------------------------------------------------------------------

-- role gate: managers/admin/leads/VP/owner (team + pay actions) -------------
create or replace function public._tg_is_mgr(p_role text)
returns boolean language sql immutable as $fn$
  select p_role is not null and (
    p_role ilike '%manager%' or p_role ilike '%admin%' or p_role ilike '%lead%'
    or p_role ilike '%owner%' or p_role ilike '%VP%' or p_role ilike '%president%'
  );
$fn$;

-- corporate/leadership gate: pay-range edits + proposal decisions -----------
create or replace function public._tg_is_corp(p_role text)
returns boolean language sql immutable as $fn$
  select p_role is not null and (
    p_role ilike '%admin%' or p_role ilike '%owner%' or p_role ilike '%VP%' or p_role ilike '%president%'
  );
$fn$;

-- configurable numeric setting reader (app_settings.skey), safe cast -------
create or replace function public._tg_cfg_num(p_key text, p_default numeric)
returns numeric language plpgsql stable security definer set search_path=public,extensions as $fn$
declare v_val text; v_num numeric;
begin
  select svalue into v_val from public.app_settings where skey = p_key;
  if v_val is null then return p_default; end if;
  begin
    v_num := v_val::numeric;
  exception when others then
    v_num := p_default;
  end;
  return coalesce(v_num, p_default);
end $fn$;

-- defensive employee lookups: never blow up the caller if a column name on
-- schedule_employees turns out to differ from what the plan assumed. -------
create or replace function public._tg_emp_location(p_employee_id bigint)
returns text language plpgsql stable security definer set search_path=public,extensions as $fn$
declare v_loc text;
begin
  begin
    select home_location into v_loc from public.schedule_employees where id = p_employee_id;
  exception when undefined_column then
    v_loc := null;
  end;
  return v_loc;
end $fn$;

create or replace function public._tg_emp_wage(p_employee_id bigint)
returns numeric language plpgsql stable security definer set search_path=public,extensions as $fn$
declare v_w numeric;
begin
  begin
    select hourly_wage into v_w from public.schedule_employees where id = p_employee_id;
  exception when undefined_column then
    v_w := null;
  end;
  return v_w;
end $fn$;

-- notify one employee (resolves roster id -> linked_username -> users.id),
-- never blocks the caller on a notification failure. -------------------------
create or replace function public._tg_notify_employee(p_employee_id bigint, p_title text, p_body text)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uname text; v_uid bigint;
begin
  begin
    select linked_username into v_uname from public.schedule_employees where id = p_employee_id;
    if v_uname is not null then
      select id into v_uid from public.users where username = v_uname;
    end if;
    if v_uid is not null then
      perform public.push_enqueue(v_uid, p_title, p_body, '');
    end if;
  exception when others then
    null; -- notifications never block a write
  end;
end $fn$;

-- notify all corporate/leadership users (best-effort). -----------------------
create or replace function public._tg_notify_corporate(p_title text, p_body text)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
declare r record;
begin
  begin
    for r in select id from public.users where public._tg_is_corp(role) loop
      perform public.push_enqueue(r.id, p_title, p_body, '');
    end loop;
  exception when others then
    null;
  end;
end $fn$;

-- ----------------------------------------------------------------------------
-- 1) Tables (create table if not exists, RLS on, NO policies — access only
--    through the SECURITY DEFINER RPCs below).
-- ----------------------------------------------------------------------------

create table if not exists public.tg_roles (
  role_id       bigserial primary key,
  role_name     text not null unique,
  role_category text,
  role_level    int,
  description   text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table public.tg_roles enable row level security;

create table if not exists public.tg_pay_ranges (
  id                 bigserial primary key,
  location           text,
  market             text,
  role_name          text,
  minimum_rate       numeric,
  maximum_rate       numeric,
  starting_rate      numeric,
  fully_trained_min  numeric,
  fully_trained_max  numeric,
  max_role_rate      numeric,
  effective_date     date,
  expiration_date    date,
  notes              text,
  active             boolean not null default true,
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.tg_pay_ranges enable row level security;
create index if not exists tg_pay_ranges_role_loc_idx on public.tg_pay_ranges(role_name, location);

create table if not exists public.tg_eval_templates (
  id          bigserial primary key,
  eval_type   text not null,   -- 30_day, skill_cert, standard, leadership, promotion_readiness, pay_raise, performance_improvement
  role_scope  text,
  title       text not null,
  categories  jsonb not null default '[]'::jsonb,   -- list of category names
  scale_min   int not null default 1,
  scale_max   int not null default 5,
  active      boolean not null default true,
  version     int not null default 1,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.tg_eval_templates enable row level security;
create index if not exists tg_eval_templates_type_idx on public.tg_eval_templates(eval_type, active);

create table if not exists public.tg_evaluations (
  id                      bigserial primary key,
  employee_id             bigint not null,
  eval_type               text not null,
  template_id             bigint,
  manager_id              bigint,     -- public.users.id of the evaluator
  manager_name            text,
  location                text,
  eval_date               date not null default current_date,
  period_start            date,
  period_end              date,
  overall_score           numeric,
  status                  text not null default 'draft'
                          check (status in ('draft','submitted','acknowledged','corporate_review','finalized')),
  strengths               text,
  improvement_areas       text,
  manager_recommendation  text,
  next_review_date        date,
  employee_ack_status     text not null default 'pending'
                          check (employee_ack_status in ('pending','acknowledged','declined')),
  employee_ack_at         timestamptz,
  corporate_review_status text,
  pdf_url                 text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
alter table public.tg_evaluations enable row level security;
create index if not exists tg_evaluations_employee_idx on public.tg_evaluations(employee_id);
create index if not exists tg_evaluations_status_idx on public.tg_evaluations(status);

create table if not exists public.tg_evaluation_scores (
  id             bigserial primary key,
  evaluation_id  bigint not null references public.tg_evaluations(id) on delete cascade,
  category_name  text not null,
  score          int,
  comment        text,
  created_at     timestamptz not null default now()
);
alter table public.tg_evaluation_scores enable row level security;
create index if not exists tg_evaluation_scores_eval_idx on public.tg_evaluation_scores(evaluation_id);

create table if not exists public.tg_pay_proposals (
  id                          bigserial primary key,
  employee_id                 bigint not null,
  submitted_by                text,       -- username snapshot
  location                    text,
  current_role_name           text,
  proposed_role                text,
  current_rate                numeric,
  proposed_rate                numeric,
  proposed_effective_date      date,
  raise_type                   text,       -- merit, promotion, market_adjustment, cost_of_living, other
  reason                       text,
  checklist                    jsonb not null default '[]'::jsonb,
  supporting_evaluation_id     bigint references public.tg_evaluations(id),
  supporting_cert_id           bigint,
  status                       text not null default 'draft'
                               check (status in ('draft','submitted','needs_info','corporate_review','approved',
                                                  'denied','delayed','payroll_processed','cancelled')),
  flags                        jsonb not null default '[]'::jsonb,   -- validation results
  corporate_decision           text,
  corporate_decision_by        text,
  corporate_decision_at        timestamptz,
  payroll_processed_at         timestamptz,
  payroll_processed_by         text,
  notes                        text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);
alter table public.tg_pay_proposals enable row level security;
create index if not exists tg_pay_proposals_employee_idx on public.tg_pay_proposals(employee_id);
create index if not exists tg_pay_proposals_status_idx on public.tg_pay_proposals(status);

create table if not exists public.tg_review_schedule (
  id             bigserial primary key,
  role_name      text,           -- null = applies to all roles
  lifecycle_event text not null, -- e.g. 30_day_new_hire, semiannual_hourly, quarterly_leadership
  cadence_days   int not null,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
alter table public.tg_review_schedule enable row level security;
create index if not exists tg_review_schedule_role_idx on public.tg_review_schedule(role_name);

-- Extend existing employee_notes (additive) instead of a new table -----------
do $do$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='employee_notes') then
    alter table public.employee_notes add column if not exists note_type text;
    alter table public.employee_notes add column if not exists follow_up_date date;
    alter table public.employee_notes add column if not exists resolved boolean not null default false;
    alter table public.employee_notes add column if not exists resolved_at timestamptz;
  end if;
end;
$do$;

-- ----------------------------------------------------------------------------
-- 2) Seed data (idempotent — safe to re-run)
-- ----------------------------------------------------------------------------

-- default eval template: 30-Day Review
insert into public.tg_eval_templates(eval_type, role_scope, title, categories, scale_min, scale_max, active, version)
select '30_day', null, '30-Day Review',
  '["Speed","Cleanliness","Friendliness","Product Quality","Teamwork","Reliability"]'::jsonb,
  1, 5, true, 1
where not exists (
  select 1 from public.tg_eval_templates where eval_type = '30_day' and title = '30-Day Review'
);

-- default review cadence rows (Appendix B rhythm — admin can add more via
-- a future app_tg_review_schedule_save RPC; these three are the confirmed
-- defaults from the plan: 30-day new hire, semiannual hourly, quarterly leadership)
insert into public.tg_review_schedule(role_name, lifecycle_event, cadence_days, active)
select v.role_name, v.lifecycle_event, v.cadence_days, true
from (values
  (null::text,   '30_day_new_hire',       30),
  ('Hourly',     'semiannual_hourly',     182),
  ('Leadership', 'quarterly_leadership',  91)
) as v(role_name, lifecycle_event, cadence_days)
where not exists (
  select 1 from public.tg_review_schedule rs where rs.lifecycle_event = v.lifecycle_event
);

-- default configurable "normal raise %" threshold used by the validation engine
insert into public.app_settings(skey, sgroup, label, svalue, sort)
select 'tg_normal_raise_pct', 'tg_config', 'Team Growth: "normal" raise % threshold', '8', 0
where not exists (select 1 from public.app_settings where skey = 'tg_normal_raise_pct');

-- tg_pay_ranges intentionally left EMPTY — admin fills via the pay-range editor.
-- tg_roles intentionally left EMPTY — admin fills via a future role-ladder editor.

-- ============================================================================
-- 3) RPCs — Evaluations
-- ============================================================================

-- app_tg_eval_templates: list active templates (managers) --------------------
create or replace function public.app_tg_eval_templates(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_out jsonb;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'eval_type', eval_type, 'role_scope', role_scope, 'title', title,
      'categories', categories, 'scale_min', scale_min, 'scale_max', scale_max, 'version', version
    ) order by eval_type, title), '[]'::jsonb)
  into v_out
  from public.tg_eval_templates where active;

  return v_out;
end $fn$;

-- app_tg_eval_template_save: upsert a template (corporate/admin) ------------
create or replace function public.app_tg_eval_template_save(p_username text, p_password text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_id bigint; v_before jsonb; v_after jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_corp(v_role) then raise exception 'forbidden'; end if;

  v_id := nullif(p_payload->>'id','')::bigint;
  if v_id is not null then
    select to_jsonb(t) into v_before from public.tg_eval_templates t where id = v_id;
  end if;

  if v_id is null then
    insert into public.tg_eval_templates(eval_type, role_scope, title, categories, scale_min, scale_max, active, version, created_by)
    values (
      p_payload->>'eval_type', nullif(p_payload->>'role_scope',''), p_payload->>'title',
      coalesce(p_payload->'categories', '[]'::jsonb),
      coalesce((p_payload->>'scale_min')::int, 1), coalesce((p_payload->>'scale_max')::int, 5),
      coalesce((p_payload->>'active')::boolean, true), coalesce((p_payload->>'version')::int, 1), v_name)
    returning id into v_id;
  else
    update public.tg_eval_templates set
      eval_type  = coalesce(nullif(p_payload->>'eval_type',''), eval_type),
      role_scope = coalesce(nullif(p_payload->>'role_scope',''), role_scope),
      title      = coalesce(nullif(p_payload->>'title',''), title),
      categories = coalesce(p_payload->'categories', categories),
      scale_min  = coalesce((p_payload->>'scale_min')::int, scale_min),
      scale_max  = coalesce((p_payload->>'scale_max')::int, scale_max),
      active     = coalesce((p_payload->>'active')::boolean, active),
      version    = coalesce((p_payload->>'version')::int, version) + 1,
      updated_at = now()
    where id = v_id;
  end if;

  select to_jsonb(t) into v_after from public.tg_eval_templates t where id = v_id;
  perform public._pp_audit(v_uid, v_name, 'tg_eval_template_save', null, v_before, v_after, null);

  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

-- app_tg_eval_start: create a draft evaluation for an employee ---------------
create or replace function public.app_tg_eval_start(
  p_username text, p_password text, p_employee_id bigint, p_eval_type text, p_template_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_id bigint; v_loc text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  v_loc := public._tg_emp_location(p_employee_id);

  insert into public.tg_evaluations(employee_id, eval_type, template_id, manager_id, manager_name, location, eval_date, status)
  values (p_employee_id, p_eval_type, p_template_id, v_uid, v_name, v_loc, current_date, 'draft')
  returning id into v_id;

  perform public._pp_audit(v_uid, v_name, 'tg_eval_start', p_employee_id, null,
    jsonb_build_object('evaluation_id', v_id, 'eval_type', p_eval_type), null);

  return jsonb_build_object('ok', true, 'evaluation_id', v_id);
end $fn$;

-- app_tg_eval_save: scores + text, draft only --------------------------------
create or replace function public.app_tg_eval_save(
  p_username text, p_password text, p_evaluation_id bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_status text; v_emp bigint; v_score jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select status, employee_id into v_status, v_emp from public.tg_evaluations where id = p_evaluation_id;
  if v_emp is null then raise exception 'not found'; end if;
  if v_status = 'finalized' then raise exception 'evaluation is finalized'; end if;

  update public.tg_evaluations set
    strengths               = coalesce(p_payload->>'strengths', strengths),
    improvement_areas       = coalesce(p_payload->>'improvement_areas', improvement_areas),
    manager_recommendation  = coalesce(p_payload->>'manager_recommendation', manager_recommendation),
    next_review_date        = coalesce(nullif(p_payload->>'next_review_date','')::date, next_review_date),
    period_start             = coalesce(nullif(p_payload->>'period_start','')::date, period_start),
    period_end               = coalesce(nullif(p_payload->>'period_end','')::date, period_end),
    updated_at               = now()
  where id = p_evaluation_id;

  if p_payload ? 'scores' then
    delete from public.tg_evaluation_scores where evaluation_id = p_evaluation_id;
    for v_score in select * from jsonb_array_elements(p_payload->'scores') loop
      insert into public.tg_evaluation_scores(evaluation_id, category_name, score, comment)
      values (
        p_evaluation_id,
        coalesce(v_score->>'category_name', v_score->>'category'),
        nullif(v_score->>'score','')::int,
        v_score->>'comment');
    end loop;
  end if;

  perform public._pp_audit(v_uid, v_name, 'tg_eval_save', v_emp, null,
    jsonb_build_object('evaluation_id', p_evaluation_id), null);

  return jsonb_build_object('ok', true);
end $fn$;

-- app_tg_eval_submit: compute overall_score, submit, notify employee --------
create or replace function public.app_tg_eval_submit(p_username text, p_password text, p_evaluation_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint; v_avg numeric;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select employee_id into v_emp from public.tg_evaluations where id = p_evaluation_id;
  if v_emp is null then raise exception 'not found'; end if;

  select avg(score) into v_avg from public.tg_evaluation_scores
    where evaluation_id = p_evaluation_id and score is not null;

  update public.tg_evaluations
    set status = 'submitted', overall_score = round(coalesce(v_avg,0)::numeric,2),
        employee_ack_status = 'pending', updated_at = now()
    where id = p_evaluation_id;

  perform public._pp_audit(v_uid, v_name, 'tg_eval_submit', v_emp, null,
    jsonb_build_object('evaluation_id', p_evaluation_id, 'overall_score', v_avg), null);

  perform public._tg_notify_employee(v_emp, '📋 New Evaluation',
    'A new evaluation has been submitted for your review.');

  return jsonb_build_object('ok', true, 'overall_score', round(coalesce(v_avg,0)::numeric,2));
end $fn$;

-- app_tg_eval_ack: employee acknowledgement (self only) ----------------------
create or replace function public.app_tg_eval_ack(p_username text, p_password text, p_evaluation_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint; v_status text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;

  select employee_id, status into v_emp, v_status from public.tg_evaluations where id = p_evaluation_id;
  if v_emp is null then raise exception 'not found'; end if;
  if not public._pp_is_self(p_username, v_emp) then raise exception 'forbidden'; end if;
  if v_status is distinct from 'submitted' then
    raise exception 'evaluation is not awaiting acknowledgement (status=%)', v_status;
  end if;

  update public.tg_evaluations
    set employee_ack_status = 'acknowledged', employee_ack_at = now(), status = 'acknowledged', updated_at = now()
    where id = p_evaluation_id;

  perform public._pp_audit(v_uid, v_name, 'tg_eval_ack', v_emp, null,
    jsonb_build_object('evaluation_id', p_evaluation_id), null);

  return jsonb_build_object('ok', true);
end $fn$;

-- app_tg_eval_list: filtered list for dashboards/history ---------------------
create or replace function public.app_tg_eval_list(p_username text, p_password text, p_filters jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_out jsonb;
  v_f_emp bigint; v_f_loc text; v_f_status text; v_f_type text;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;

  v_f_emp    := nullif(coalesce(p_filters,'{}'::jsonb)->>'employee_id','')::bigint;
  v_f_loc    := nullif(coalesce(p_filters,'{}'::jsonb)->>'location','');
  v_f_status := nullif(coalesce(p_filters,'{}'::jsonb)->>'status','');
  v_f_type   := nullif(coalesce(p_filters,'{}'::jsonb)->>'eval_type','');

  if public._tg_is_mgr(v_role) then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'employee_id', e.employee_id, 'employee_name', se.name,
        'eval_type', e.eval_type, 'location', e.location, 'eval_date', e.eval_date,
        'status', e.status, 'overall_score', e.overall_score,
        'next_review_date', e.next_review_date, 'employee_ack_status', e.employee_ack_status
      ) order by e.eval_date desc), '[]'::jsonb)
    into v_out
    from public.tg_evaluations e
    left join public.schedule_employees se on se.id = e.employee_id
    where (v_f_emp is null or e.employee_id = v_f_emp)
      and (v_f_loc is null or e.location = v_f_loc)
      and (v_f_status is null or e.status = v_f_status)
      and (v_f_type is null or e.eval_type = v_f_type);
  else
    if v_f_emp is null or not public._pp_is_self(p_username, v_f_emp) then raise exception 'forbidden'; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'eval_type', e.eval_type, 'eval_date', e.eval_date, 'status', e.status,
        'overall_score', e.overall_score, 'next_review_date', e.next_review_date,
        'employee_ack_status', e.employee_ack_status
      ) order by e.eval_date desc), '[]'::jsonb)
    into v_out
    from public.tg_evaluations e
    where e.employee_id = v_f_emp and e.status in ('submitted','acknowledged','finalized');
  end if;

  return v_out;
end $fn$;

-- app_tg_eval_get: full eval + scores, perm-gated ----------------------------
create or replace function public.app_tg_eval_get(p_username text, p_password text, p_evaluation_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint; v_status text; v_out jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;

  select employee_id, status into v_emp, v_status from public.tg_evaluations where id = p_evaluation_id;
  if v_emp is null then raise exception 'not found'; end if;

  if not (public._tg_is_mgr(v_role)
          or (public._pp_is_self(p_username, v_emp) and v_status in ('submitted','acknowledged','finalized'))) then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'id', e.id, 'employee_id', e.employee_id, 'employee_name', se.name,
    'eval_type', e.eval_type, 'template_id', e.template_id, 'manager_id', e.manager_id,
    'manager_name', e.manager_name, 'location', e.location, 'eval_date', e.eval_date,
    'period_start', e.period_start, 'period_end', e.period_end, 'overall_score', e.overall_score,
    'status', e.status, 'strengths', e.strengths, 'improvement_areas', e.improvement_areas,
    'manager_recommendation', e.manager_recommendation, 'next_review_date', e.next_review_date,
    'employee_ack_status', e.employee_ack_status, 'employee_ack_at', e.employee_ack_at,
    'corporate_review_status', e.corporate_review_status, 'pdf_url', e.pdf_url,
    'scores', coalesce((
      select jsonb_agg(jsonb_build_object('category_name', s.category_name, 'score', s.score, 'comment', s.comment) order by s.id)
      from public.tg_evaluation_scores s where s.evaluation_id = e.id
    ), '[]'::jsonb)
  ) into v_out
  from public.tg_evaluations e
  left join public.schedule_employees se on se.id = e.employee_id
  where e.id = p_evaluation_id;

  perform public._pp_audit(v_uid, v_name, 'tg_eval_view', v_emp, null, null, null);

  return v_out;
end $fn$;

-- ============================================================================
-- 4) RPCs — Pay ranges + proposals + validation
-- ============================================================================

-- app_tg_payrange_list: active ranges (managers, for validation UI) ---------
create or replace function public.app_tg_payrange_list(p_username text, p_password text, p_location text, p_role text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_out jsonb;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'location', location, 'market', market, 'role_name', role_name,
      'minimum_rate', minimum_rate, 'maximum_rate', maximum_rate, 'starting_rate', starting_rate,
      'fully_trained_min', fully_trained_min, 'fully_trained_max', fully_trained_max,
      'max_role_rate', max_role_rate, 'effective_date', effective_date, 'expiration_date', expiration_date,
      'notes', notes, 'active', active
    ) order by role_name, location), '[]'::jsonb)
  into v_out
  from public.tg_pay_ranges
  where active
    and (p_location is null or p_location = '' or location = p_location)
    and (p_role is null or p_role = '' or role_name = p_role);

  return v_out;
end $fn$;

-- app_tg_payrange_save: upsert (corporate/admin only) ------------------------
create or replace function public.app_tg_payrange_save(p_username text, p_password text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_id bigint; v_before jsonb; v_after jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_corp(v_role) then raise exception 'forbidden'; end if;

  v_id := nullif(p_payload->>'id','')::bigint;
  if v_id is not null then
    select to_jsonb(t) into v_before from public.tg_pay_ranges t where id = v_id;
  end if;

  if v_id is null then
    insert into public.tg_pay_ranges(
      location, market, role_name, minimum_rate, maximum_rate, starting_rate,
      fully_trained_min, fully_trained_max, max_role_rate, effective_date, expiration_date, notes, active, created_by)
    values (
      p_payload->>'location', nullif(p_payload->>'market',''), p_payload->>'role_name',
      nullif(p_payload->>'minimum_rate','')::numeric, nullif(p_payload->>'maximum_rate','')::numeric,
      nullif(p_payload->>'starting_rate','')::numeric,
      nullif(p_payload->>'fully_trained_min','')::numeric, nullif(p_payload->>'fully_trained_max','')::numeric,
      nullif(p_payload->>'max_role_rate','')::numeric,
      nullif(p_payload->>'effective_date','')::date, nullif(p_payload->>'expiration_date','')::date,
      p_payload->>'notes', coalesce((p_payload->>'active')::boolean, true), v_name)
    returning id into v_id;
  else
    update public.tg_pay_ranges set
      location            = coalesce(nullif(p_payload->>'location',''), location),
      market               = coalesce(nullif(p_payload->>'market',''), market),
      role_name            = coalesce(nullif(p_payload->>'role_name',''), role_name),
      minimum_rate         = coalesce(nullif(p_payload->>'minimum_rate','')::numeric, minimum_rate),
      maximum_rate         = coalesce(nullif(p_payload->>'maximum_rate','')::numeric, maximum_rate),
      starting_rate        = coalesce(nullif(p_payload->>'starting_rate','')::numeric, starting_rate),
      fully_trained_min    = coalesce(nullif(p_payload->>'fully_trained_min','')::numeric, fully_trained_min),
      fully_trained_max    = coalesce(nullif(p_payload->>'fully_trained_max','')::numeric, fully_trained_max),
      max_role_rate        = coalesce(nullif(p_payload->>'max_role_rate','')::numeric, max_role_rate),
      effective_date       = coalesce(nullif(p_payload->>'effective_date','')::date, effective_date),
      expiration_date      = coalesce(nullif(p_payload->>'expiration_date','')::date, expiration_date),
      notes                = coalesce(p_payload->>'notes', notes),
      active               = coalesce((p_payload->>'active')::boolean, active),
      updated_at           = now()
    where id = v_id;
  end if;

  select to_jsonb(t) into v_after from public.tg_pay_ranges t where id = v_id;
  perform public._pp_audit(v_uid, v_name, 'tg_payrange_save', null, v_before, v_after, null);

  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

-- app_tg_proposal_create: draft proposal, prefilled from live wage ----------
create or replace function public.app_tg_proposal_create(p_username text, p_password text, p_employee_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_id bigint; v_wage numeric; v_loc text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  v_wage := public._tg_emp_wage(p_employee_id);
  v_loc  := public._tg_emp_location(p_employee_id);

  insert into public.tg_pay_proposals(employee_id, submitted_by, location, current_rate, status)
  values (p_employee_id, p_username, v_loc, v_wage, 'draft')
  returning id into v_id;

  perform public._pp_audit(v_uid, v_name, 'tg_proposal_create', p_employee_id, null,
    jsonb_build_object('proposal_id', v_id), null);

  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'current_rate', v_wage);
end $fn$;

-- app_tg_proposal_save: fields + digital checklist ---------------------------
create or replace function public.app_tg_proposal_save(
  p_username text, p_password text, p_proposal_id bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint; v_status text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select employee_id, status into v_emp, v_status from public.tg_pay_proposals where id = p_proposal_id;
  if v_emp is null then raise exception 'not found'; end if;
  if v_status not in ('draft','needs_info') and not public._tg_is_corp(v_role) then
    raise exception 'proposal is locked (status=%)', v_status;
  end if;

  update public.tg_pay_proposals set
    current_role_name         = coalesce(nullif(p_payload->>'current_role',''), current_role_name),
    proposed_role              = coalesce(nullif(p_payload->>'proposed_role',''), proposed_role),
    current_rate               = coalesce(nullif(p_payload->>'current_rate','')::numeric, current_rate),
    proposed_rate               = coalesce(nullif(p_payload->>'proposed_rate','')::numeric, proposed_rate),
    proposed_effective_date     = coalesce(nullif(p_payload->>'proposed_effective_date','')::date, proposed_effective_date),
    raise_type                  = coalesce(nullif(p_payload->>'raise_type',''), raise_type),
    reason                      = coalesce(p_payload->>'reason', reason),
    checklist                   = coalesce(p_payload->'checklist', checklist),
    supporting_evaluation_id    = coalesce(nullif(p_payload->>'supporting_evaluation_id','')::bigint, supporting_evaluation_id),
    supporting_cert_id          = coalesce(nullif(p_payload->>'supporting_cert_id','')::bigint, supporting_cert_id),
    notes                       = coalesce(p_payload->>'notes', notes),
    updated_at                  = now()
  where id = p_proposal_id;

  perform public._pp_audit(v_uid, v_name, 'tg_proposal_save', v_emp, null,
    jsonb_build_object('proposal_id', p_proposal_id), null);

  return jsonb_build_object('ok', true);
end $fn$;

-- app_tg_proposal_validate: compute + persist validation flags --------------
create or replace function public.app_tg_proposal_validate(p_username text, p_password text, p_proposal_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text;
  v_p record;
  v_flags jsonb := '[]'::jsonb;
  v_min numeric; v_max numeric;
  v_raise_pct numeric;
  v_normal_pct numeric;
  v_last_review date;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select * into v_p from public.tg_pay_proposals where id = p_proposal_id;
  if v_p.id is null then raise exception 'not found'; end if;

  -- below/above configured pay range
  select minimum_rate, maximum_rate into v_min, v_max
    from public.tg_pay_ranges
    where active
      and (v_p.location is null or location = v_p.location)
      and role_name = coalesce(v_p.proposed_role, v_p.current_role_name)
    order by effective_date desc nulls last
    limit 1;

  if v_min is not null and v_p.proposed_rate is not null and v_p.proposed_rate < v_min then
    v_flags := v_flags || jsonb_build_object('code','below_range','severity','warning',
      'message', format('Proposed rate %s is below the range minimum %s.', v_p.proposed_rate, v_min));
  end if;
  if v_max is not null and v_p.proposed_rate is not null and v_p.proposed_rate > v_max then
    v_flags := v_flags || jsonb_build_object('code','above_range','severity','warning',
      'message', format('Proposed rate %s is above the range maximum %s.', v_p.proposed_rate, v_max));
  end if;
  if v_min is null and v_max is null then
    v_flags := v_flags || jsonb_build_object('code','no_pay_range','severity','info',
      'message','No configured pay range found for this location/role — cannot validate against a band.');
  end if;

  -- missing supporting evaluation
  if v_p.supporting_evaluation_id is null then
    v_flags := v_flags || jsonb_build_object('code','missing_supporting_eval','severity','warning',
      'message','No supporting evaluation is linked to this proposal.');
  end if;

  -- missing supporting certification
  if v_p.supporting_cert_id is null then
    v_flags := v_flags || jsonb_build_object('code','missing_supporting_cert','severity','info',
      'message','No supporting certification is linked to this proposal.');
  end if;

  -- review overdue (most recent scheduled next_review_date for this employee)
  begin
    select max(next_review_date) into v_last_review
      from public.tg_evaluations where employee_id = v_p.employee_id and next_review_date is not null;
  exception when others then
    v_last_review := null;
  end;
  if v_last_review is not null and v_last_review < current_date then
    v_flags := v_flags || jsonb_build_object('code','review_overdue','severity','warning',
      'message', format('This employee''s next scheduled review (%s) is overdue.', v_last_review));
  end if;

  -- raise exceeds the configurable "normal" threshold
  v_normal_pct := public._tg_cfg_num('tg_normal_raise_pct', 8);
  if v_p.current_rate is not null and v_p.current_rate > 0 and v_p.proposed_rate is not null then
    v_raise_pct := round(((v_p.proposed_rate - v_p.current_rate) / v_p.current_rate) * 100, 2);
    if v_raise_pct > v_normal_pct then
      v_flags := v_flags || jsonb_build_object('code','raise_exceeds_normal','severity','warning',
        'message', format('Proposed raise of %s%% exceeds the normal threshold of %s%%.', v_raise_pct, v_normal_pct));
    end if;
  end if;

  -- effective date sanity
  if v_p.proposed_effective_date is null then
    v_flags := v_flags || jsonb_build_object('code','missing_effective_date','severity','warning',
      'message','No proposed effective date has been set.');
  elsif v_p.proposed_effective_date < current_date then
    v_flags := v_flags || jsonb_build_object('code','effective_date_past','severity','warning',
      'message','Proposed effective date is in the past.');
  elsif v_p.proposed_effective_date > (current_date + 180) then
    v_flags := v_flags || jsonb_build_object('code','effective_date_far_future','severity','info',
      'message','Proposed effective date is more than 180 days out.');
  end if;

  update public.tg_pay_proposals set flags = v_flags, updated_at = now() where id = p_proposal_id;

  return jsonb_build_object('ok', true, 'flags', v_flags, 'raise_pct', v_raise_pct);
end $fn$;

-- app_tg_proposal_submit: validate, submit, notify corporate ---------------
create or replace function public.app_tg_proposal_submit(p_username text, p_password text, p_proposal_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint; v_status text; v_flags jsonb; v_emp_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select employee_id, status into v_emp, v_status from public.tg_pay_proposals where id = p_proposal_id;
  if v_emp is null then raise exception 'not found'; end if;
  if v_status not in ('draft','needs_info') then
    raise exception 'proposal cannot be submitted from status %', v_status;
  end if;

  perform public.app_tg_proposal_validate(p_username, p_password, p_proposal_id);
  select flags into v_flags from public.tg_pay_proposals where id = p_proposal_id;

  update public.tg_pay_proposals set status = 'submitted', updated_at = now() where id = p_proposal_id;

  select name into v_emp_name from public.schedule_employees where id = v_emp;

  perform public._pp_audit(v_uid, v_name, 'tg_proposal_submit', v_emp, null,
    jsonb_build_object('proposal_id', p_proposal_id, 'flags', v_flags), null);

  perform public._tg_notify_corporate('💵 Pay Proposal Submitted',
    format('%s submitted a pay proposal for %s — awaiting corporate review.', v_name, coalesce(v_emp_name,'an employee')));

  return jsonb_build_object('ok', true, 'flags', v_flags);
end $fn$;

-- app_tg_proposal_decide: corporate decision (never auto-approved) ---------
create or replace function public.app_tg_proposal_decide(
  p_username text, p_password text, p_proposal_id bigint, p_decision text, p_notes text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint; v_status text; v_before jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_corp(v_role) then raise exception 'forbidden'; end if;

  if p_decision not in ('approved','denied','delayed','needs_info') then
    raise exception 'invalid decision %', p_decision;
  end if;

  select employee_id, status into v_emp, v_status from public.tg_pay_proposals where id = p_proposal_id;
  if v_emp is null then raise exception 'not found'; end if;
  if v_status not in ('submitted','corporate_review','needs_info') then
    raise exception 'proposal is not awaiting a decision (status=%)', v_status;
  end if;

  v_before := jsonb_build_object('status', v_status);

  update public.tg_pay_proposals set
    status                 = p_decision,
    corporate_decision     = p_decision,
    corporate_decision_by  = v_name,
    corporate_decision_at  = now(),
    notes                  = coalesce(p_notes, notes),
    updated_at              = now()
  where id = p_proposal_id;

  -- this IS the human decision point — pay is NEVER auto-approved by the engine
  perform public._pp_audit(v_uid, v_name, 'tg_proposal_decide', v_emp, v_before,
    jsonb_build_object('status', p_decision, 'notes', p_notes), p_notes);

  perform public._tg_notify_employee(v_emp,
    case when p_decision = 'approved' then '✅ Pay Proposal Approved' else '📋 Pay Proposal Update' end,
    format('Your pay proposal status is now: %s', p_decision));

  return jsonb_build_object('ok', true, 'status', p_decision);
end $fn$;

-- app_tg_proposal_list: queue/dashboards -------------------------------------
create or replace function public.app_tg_proposal_list(p_username text, p_password text, p_filters jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_out jsonb;
  v_f_loc text; v_f_status text; v_f_emp bigint;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  v_f_loc    := nullif(coalesce(p_filters,'{}'::jsonb)->>'location','');
  v_f_status := nullif(coalesce(p_filters,'{}'::jsonb)->>'status','');
  v_f_emp    := nullif(coalesce(p_filters,'{}'::jsonb)->>'employee_id','')::bigint;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', pp.id, 'employee_id', pp.employee_id, 'employee_name', se.name,
      'location', pp.location, 'current_role', pp.current_role_name, 'proposed_role', pp.proposed_role,
      'current_rate', pp.current_rate, 'proposed_rate', pp.proposed_rate,
      'proposed_effective_date', pp.proposed_effective_date, 'raise_type', pp.raise_type,
      'status', pp.status, 'flags', pp.flags, 'submitted_by', pp.submitted_by,
      'corporate_decision', pp.corporate_decision, 'created_at', pp.created_at
    ) order by pp.created_at desc), '[]'::jsonb)
  into v_out
  from public.tg_pay_proposals pp
  left join public.schedule_employees se on se.id = pp.employee_id
  where (v_f_loc is null or pp.location = v_f_loc)
    and (v_f_status is null or pp.status = v_f_status)
    and (v_f_emp is null or pp.employee_id = v_f_emp);

  return v_out;
end $fn$;

-- ============================================================================
-- 5) RPCs — Status engine + dashboards + employee self view
-- ============================================================================

-- app_tg_status_labels: per-employee computed labels (managers) -------------
create or replace function public.app_tg_status_labels(p_username text, p_password text, p_location text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_out jsonb;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'employee_id', emp.id,
        'name', emp.name,
        'location', emp.loc,
        'next_review_date', le.next_review_date,
        'overall_score', le.overall_score,
        'labels', array_remove(array[
          case when le.next_review_date is not null and le.next_review_date < current_date then 'Review Overdue'
               when le.next_review_date is not null and le.next_review_date <= current_date + 14 then 'Review Due Soon'
               else 'On Track' end,
          case when le.overall_score is not null and le.overall_score < 3 then 'Performance Concern' end,
          case when le.overall_score is not null and le.overall_score >= 4.5 then 'High Potential' end,
          case when le.manager_recommendation ilike '%promot%' then 'Promotion Ready' end,
          case when exists (
                 select 1 from public.tg_pay_proposals pr
                 where pr.employee_id = emp.id and pr.status in ('submitted','corporate_review')
               ) then 'Corporate Review Needed' end,
          case when le.status = 'finalized' and not exists (
                 select 1 from public.tg_pay_proposals pr2
                 where pr2.employee_id = emp.id
                   and pr2.status in ('draft','submitted','corporate_review','needs_info')
               ) then 'Eligible for Pay Proposal' end
        ], null)
      ) order by emp.name), '[]'::jsonb)
    into v_out
    from (
      select se.id, se.name, public._tg_emp_location(se.id) as loc
      from public.schedule_employees se
    ) emp
    left join lateral (
      select e.overall_score, e.next_review_date, e.manager_recommendation, e.status
      from public.tg_evaluations e
      where e.employee_id = emp.id
      order by e.eval_date desc
      limit 1
    ) le on true
    where (p_location is null or p_location = '' or emp.loc = p_location);
  exception when others then
    v_out := '[]'::jsonb;
  end;

  return coalesce(v_out, '[]'::jsonb);
end $fn$;

-- app_tg_mgr_dashboard: summary cards + team rows (managers) ----------------
create or replace function public.app_tg_mgr_dashboard(p_username text, p_password text, p_location text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_out jsonb; v_labels jsonb;
  v_reviews_overdue int; v_reviews_due_soon int; v_concerns int;
  v_proposals_pending int; v_evals_draft int;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  v_labels := public.app_tg_status_labels(p_username, p_password, p_location);

  select
    count(*) filter (where (row_obj->'labels') ? 'Review Overdue'),
    count(*) filter (where (row_obj->'labels') ? 'Review Due Soon'),
    count(*) filter (where (row_obj->'labels') ? 'Performance Concern')
  into v_reviews_overdue, v_reviews_due_soon, v_concerns
  from jsonb_array_elements(v_labels) as row_obj;

  select count(*) into v_proposals_pending
    from public.tg_pay_proposals
    where status in ('submitted','corporate_review','needs_info')
      and (p_location is null or p_location = '' or location = p_location);

  select count(*) into v_evals_draft
    from public.tg_evaluations
    where status = 'draft'
      and (p_location is null or p_location = '' or location = p_location);

  v_out := jsonb_build_object(
    'summary', jsonb_build_object(
      'reviews_overdue', coalesce(v_reviews_overdue,0),
      'reviews_due_soon', coalesce(v_reviews_due_soon,0),
      'performance_concerns', coalesce(v_concerns,0),
      'pay_proposals_pending', coalesce(v_proposals_pending,0),
      'evaluations_in_draft', coalesce(v_evals_draft,0)
    ),
    'team', v_labels
  );

  return v_out;
end $fn$;

-- app_tg_my_growth: employee-safe self view (self only) ---------------------
create or replace function public.app_tg_my_growth(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_name text; v_emp bigint; v_out jsonb;
  v_passport jsonb; v_certs jsonb; v_recognition jsonb; v_next_review date; v_last_eval jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;

  select id into v_emp from public.schedule_employees where linked_username = p_username limit 1;
  if v_emp is null then
    return jsonb_build_object('ok', false, 'message', 'No linked roster profile found yet.');
  end if;

  -- station passport levels (defensive; degrade to [] on any schema surprise)
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'position_id', sp.id, 'name', sp.name,
        'level', coalesce(pp.level, case when cl.employee_id is not null then 'Qualified' else 'Learning' end)
      ) order by sp.sort_order, sp.name), '[]'::jsonb)
    into v_passport
    from public.schedule_positions sp
    left join public.employee_passport pp on pp.position_id = sp.id and pp.employee_id = v_emp
    left join public.employee_position_clearance cl on cl.position_id = sp.id and cl.employee_id = v_emp
    where coalesce(sp.active, true);
  exception when others then
    v_passport := '[]'::jsonb;
  end;

  -- certifications
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'type', cert_type, 'number', cert_number, 'issued', issued_date, 'expires', expires_date)
        order by expires_date nulls last), '[]'::jsonb)
    into v_certs
    from public.employee_certs where employee_id = v_emp;
  exception when others then
    v_certs := '[]'::jsonb;
  end;

  -- recognition feed (table/column names NOT confirmed in-repo — best guess;
  -- degrades to [] rather than erroring if the real shape differs; author:
  -- verify against information_schema and correct this block if needed)
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'type', r.recognition_type, 'message', r.message, 'created_at', r.created_at)
        order by r.created_at desc), '[]'::jsonb)
    into v_recognition
    from public.recognition r
    where r.about_emp = v_emp
    order by r.created_at desc
    limit 10;
  exception when others then
    v_recognition := '[]'::jsonb;
  end;

  -- most recent employee-visible evaluation
  begin
    select jsonb_build_object(
        'eval_type', eval_type, 'eval_date', eval_date, 'overall_score', overall_score,
        'status', status, 'next_review_date', next_review_date)
      into v_last_eval
    from public.tg_evaluations
    where employee_id = v_emp and status in ('submitted','acknowledged','finalized')
    order by eval_date desc limit 1;
  exception when others then
    v_last_eval := null;
  end;

  select max(next_review_date) into v_next_review
    from public.tg_evaluations
    where employee_id = v_emp and next_review_date is not null;

  v_out := jsonb_build_object(
    'ok', true,
    'employee', jsonb_build_object('id', v_emp, 'name', v_name),
    'passport', v_passport,
    'certs', v_certs,
    'recognition', v_recognition,
    'last_evaluation', coalesce(v_last_eval, '{}'::jsonb),
    'next_review_date', v_next_review
  );

  perform public._pp_audit(v_uid, v_name, 'tg_my_growth_view', v_emp, null, null, null);

  return v_out;
end $fn$;

-- ============================================================================
-- NEW RPCS: app_tg_eval_templates, app_tg_eval_template_save, app_tg_eval_start, app_tg_eval_save, app_tg_eval_submit, app_tg_eval_ack, app_tg_eval_list, app_tg_eval_get, app_tg_payrange_list, app_tg_payrange_save, app_tg_proposal_create, app_tg_proposal_save, app_tg_proposal_validate, app_tg_proposal_submit, app_tg_proposal_decide, app_tg_proposal_list, app_tg_status_labels, app_tg_my_growth, app_tg_mgr_dashboard
-- (internal helpers _tg_is_mgr, _tg_is_corp, _tg_cfg_num, _tg_emp_location, _tg_emp_wage,
--  _tg_notify_employee, _tg_notify_corporate are NOT frontend RPCs — do not add to rpc_manifest.json,
--  mirrors the existing _pp_*/_rr_* helper convention.)
-- ============================================================================

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
-- ============================================================================

-- ============================================================================
-- APPENDED (integrator): 2 RPCs the frontend calls, missing from the first pass
-- ============================================================================
create or replace function public.app_tg_growth_profile(p_username text, p_password text, p_employee_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_out jsonb; v_evals jsonb; v_props jsonb; v_emp_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select name into v_emp_name from public.schedule_employees where id = p_employee_id;
  if v_emp_name is null then raise exception 'not found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'eval_type', e.eval_type, 'eval_date', e.eval_date,
      'overall_score', e.overall_score, 'status', e.status,
      'next_review_date', e.next_review_date) order by e.eval_date desc nulls last), '[]'::jsonb)
  into v_evals from public.tg_evaluations e where e.employee_id = p_employee_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', pp.id, 'proposed_role', pp.proposed_role, 'proposed_rate', pp.proposed_rate,
      'status', pp.status, 'created_at', pp.created_at) order by pp.created_at desc), '[]'::jsonb)
  into v_props from public.tg_pay_proposals pp where pp.employee_id = p_employee_id;
  v_out := jsonb_build_object(
    'ok', true,
    'employee', jsonb_build_object('id', p_employee_id, 'name', v_emp_name,
        'location', public._tg_emp_location(p_employee_id), 'wage', public._tg_emp_wage(p_employee_id)),
    'evaluations', v_evals, 'proposals', v_props);
  return v_out;
end $fn$;

create or replace function public.app_tg_proposal_mark_payroll(p_username text, p_password text, p_proposal_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint; v_status text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_corp(v_role) then raise exception 'forbidden'; end if;
  select employee_id, status into v_emp, v_status from public.tg_pay_proposals where id = p_proposal_id;
  if v_emp is null then raise exception 'not found'; end if;
  if v_status <> 'approved' then raise exception 'proposal must be approved first (status=%)', v_status; end if;
  update public.tg_pay_proposals set
    status = 'payroll_processed', payroll_processed_at = now(), payroll_processed_by = v_name, updated_at = now()
  where id = p_proposal_id;
  perform public._pp_audit(v_uid, v_name, 'tg_proposal_payroll', v_emp,
    jsonb_build_object('status', v_status), jsonb_build_object('status','payroll_processed'), null);
  return jsonb_build_object('ok', true, 'status', 'payroll_processed');
end $fn$;
-- NEW RPCS (appended): app_tg_growth_profile, app_tg_proposal_mark_payroll
