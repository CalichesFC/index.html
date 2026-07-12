-- ============================================================================
-- Caliche's Hub — PAY-RAISE DELTAS (Adri gap review items 1-5)  [ADDITIVE]
-- payraise_deltas.sql — apply AFTER team_growth.sql + tg_finish.sql are live.
--
-- Builds the 4 approved deltas on top of the existing tg_* pay-proposal flow:
--   1. Performance-concern gate  (app_tg_proposal_concerns + app_tg_proposal_submit_v2)
--   2. Promotion-Ready           (tg_promo_recommendations + app_tg_promo_*)
--   3. Effective date + justification on the proposal (+ sheet RPC for print)
--   4. Corporate money cards     (typ_weekly_hours + app_tg_payroll_exposure)
--
-- HARD RULES HONORED:
--   * Nothing existing is redefined. app_tg_proposal_create/save/validate/
--     submit/decide/mark_payroll and app_tg_payrange_* are UNTOUCHED — new
--     behavior lives in NEW columns (with defaults) + NEW wrapper RPCs.
--   * create table if not exists / alter table add column if not exists /
--     create or replace function only. RLS on, NO policies.
--   * Reuses the shipped helpers: _pp_auth, _pp_is_self, _pp_audit,
--     _tg_is_mgr, _tg_is_corp, _tg_cfg_num, _tg_emp_location, _tg_emp_wage,
--     _tg_notify_employee, _tg_notify_corporate  (team_growth.sql).
--
-- >>> INTEGRATOR: VERIFY AGAINST THE LIVE DB BEFORE APPLYING <<<
--   (1) Proposal table is public.tg_pay_proposals with columns employee_id,
--       location, current_role_name, proposed_role, current_rate,
--       proposed_rate, proposed_effective_date, raise_type, reason, status,
--       flags, corporate_decision_at, notes (per team_growth.sql).
--   (2) The DISCIPLINE table name is NOT in-repo (created live before the
--       repo snapshot; js/06 only calls app_discipline_* RPCs). The concern
--       reader below tries public.employee_discipline THEN
--       public.disciplinary_actions, assuming columns
--       (employee_id, level, category, action_date, status['active'|voided]).
--       Every probe is to_regclass-guarded AND exception-wrapped, so a wrong
--       guess degrades to "no concerns found from that source" — but VERIFY
--       the real name/columns and fix the two EXECUTE blocks in
--       _tg_open_concerns if they differ, or the gate silently sees nothing.
--   (3) public.employee_notes has employee_id + the additive columns
--       team_growth.sql added (note_type, resolved). Also exception-wrapped.
--   (4) public.schedule_employees exists (typ_weekly_hours is added to it).
--   (5) public.employee_certs (employee_id, cert_type, issued_date,
--       expires_date) exists (training_hub.sql mirrors into it).
--   (6) After apply: add the 11 new app_tg_* RPCs below to rpc_manifest.json.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Additive columns
-- ----------------------------------------------------------------------------

-- Delta 3: explicit effective date + justification on the proposal record.
-- (proposed_effective_date already exists; effective_date is the confirmed/
--  printable one — the extras-save RPC mirrors it into proposed_effective_date
--  so the existing validate flags keep working unchanged.)
alter table public.tg_pay_proposals add column if not exists effective_date date;
alter table public.tg_pay_proposals add column if not exists justification text;
-- Delta 1: concern-gate bookkeeping (defaults keep old callers unaffected).
alter table public.tg_pay_proposals add column if not exists concern_ack boolean not null default false;
alter table public.tg_pay_proposals add column if not exists concerns_snapshot jsonb;
-- Delta 4: hours snapshot on the proposal (frozen at save/submit time).
alter table public.tg_pay_proposals add column if not exists typ_weekly_hours numeric;

-- Delta 4: manager-entered "typical weekly hours" on the employee record.
-- schedule_employees is the ONE employee identity table (contract rule).
do $do$
begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='schedule_employees') then
    alter table public.schedule_employees add column if not exists typ_weekly_hours numeric;
  end if;
end;
$do$;

-- ----------------------------------------------------------------------------
-- 2) Delta 2 table: promotion recommendations (the corporate queue)
-- ----------------------------------------------------------------------------
create table if not exists public.tg_promo_recommendations (
  id                  bigserial primary key,
  employee_id         bigint not null,
  location            text,
  target_role         text,
  notes               text,
  recommended_by      text,          -- username snapshot
  recommended_by_name text,
  readiness_snapshot  jsonb,         -- computed readiness at recommend time
  status              text not null default 'pending'
                      check (status in ('pending','under_review','accepted','declined','withdrawn')),
  decided_by          text,
  decided_at          timestamptz,
  decision_notes      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.tg_promo_recommendations enable row level security;
create index if not exists tg_promo_rec_emp_idx on public.tg_promo_recommendations(employee_id);
create index if not exists tg_promo_rec_status_idx on public.tg_promo_recommendations(status);

-- ----------------------------------------------------------------------------
-- 3) Config seeds (ALL tunables admin-editable via app_settings, group
--    tg_config — same group as the existing tg_normal_raise_pct; the author
--    surfaces them in Business Settings via app_settings_get/app_settings_set)
-- ----------------------------------------------------------------------------
insert into public.app_settings(skey, sgroup, label, svalue, sort)
select v.skey, 'tg_config', v.label, v.svalue, v.sort
from (values
  ('tg_concern_lookback_days',         'Team Growth: concern gate — days back an active write-up counts as an open concern', '90', 10),
  ('tg_concern_require_justification', 'Team Growth: concern gate — require a justification note to submit when concerns exist (1=yes, 0=warn only)', '1', 11),
  ('tg_default_weekly_hours',          'Team Growth: default typical weekly hours used for payroll-impact ESTIMATES when none entered for an employee', '25', 20),
  ('tg_hours_per_month_factor',        'Team Growth: weeks-per-month factor for monthly payroll-impact estimates', '4.33', 21),
  ('tg_promo_min_certs',               'Team Growth: Promotion-Ready — minimum current (non-expired) certifications required', '1', 30),
  ('tg_promo_eval_window_days',        'Team Growth: Promotion-Ready — evaluation must be within this many days', '180', 31),
  ('tg_promo_min_eval_score',          'Team Growth: Promotion-Ready — minimum overall evaluation score', '4', 32)
) as v(skey, label, svalue, sort)
where not exists (select 1 from public.app_settings s where s.skey = v.skey);

-- ----------------------------------------------------------------------------
-- 4) Module-local helpers (_tg_ prefix — NOT app_ RPCs, do NOT add to manifest)
-- ----------------------------------------------------------------------------

-- Open performance concerns for an employee: active write-ups within the
-- configured lookback + unresolved coaching/concern notes. Every source is
-- to_regclass-guarded and exception-wrapped: a schema mismatch on the live DB
-- degrades to "that source contributes nothing" instead of breaking the RPCs.
create or replace function public._tg_open_concerns(p_employee_id bigint)
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $fn$
declare
  v_out  jsonb := '[]'::jsonb;
  v_rows jsonb;
  v_tbl  text;
  v_days int := coalesce(public._tg_cfg_num('tg_concern_lookback_days', 90), 90)::int;
begin
  -- (a) active write-ups — live discipline table name is unverified in-repo;
  --     try the two known candidates (see VERIFY note at top).
  begin
    if to_regclass('public.employee_discipline') is not null then
      v_tbl := 'public.employee_discipline';
    elsif to_regclass('public.disciplinary_actions') is not null then
      v_tbl := 'public.disciplinary_actions';
    end if;
    if v_tbl is not null then
      execute 'select coalesce(jsonb_agg(jsonb_build_object('
           || quote_literal('source') || ', ' || quote_literal('write_up') || ', '
           || quote_literal('level') || ', d.level, '
           || quote_literal('category') || ', d.category, '
           || quote_literal('occurred_on') || ', d.action_date, '
           || quote_literal('status') || ', d.status)'
           || ' order by d.action_date desc nulls last), ' || quote_literal('[]') || '::jsonb)'
           || ' from ' || v_tbl || ' d'
           || ' where d.employee_id = $1'
           || ' and coalesce(lower(d.status::text), ' || quote_literal('active') || ') not in (' || quote_literal('resolved') || ',' || quote_literal('closed') || ',' || quote_literal('void') || ',' || quote_literal('voided') || ',' || quote_literal('rescinded') || ',' || quote_literal('withdrawn') || ')'
           || ' and coalesce(d.action_date, current_date) >= current_date - $2'
      into v_rows using p_employee_id, v_days;
      v_out := v_out || coalesce(v_rows, '[]'::jsonb);
    end if;
  exception when others then
    null; -- wrong column guess -> this source contributes nothing
  end;

  -- (b) unresolved coaching / concern notes (employee_notes got note_type +
  --     resolved additively in team_growth.sql).
  begin
    if to_regclass('public.employee_notes') is not null then
      execute 'select coalesce(jsonb_agg(jsonb_build_object('
           || quote_literal('source') || ', ' || quote_literal('coaching_note') || ', '
           || quote_literal('level') || ', n.note_type, '
           || quote_literal('category') || ', n.note_type, '
           || quote_literal('occurred_on') || ', n.created_at::date, '
           || quote_literal('status') || ', ' || quote_literal('unresolved') || ')'
           || ' order by n.created_at desc), ' || quote_literal('[]') || '::jsonb)'
           || ' from public.employee_notes n'
           || ' where n.employee_id = $1 and coalesce(n.resolved, false) = false'
           || ' and (n.note_type ilike ' || quote_literal('%coach%')
           || '   or n.note_type ilike ' || quote_literal('%concern%')
           || '   or n.note_type ilike ' || quote_literal('%performance%') || ')'
      into v_rows using p_employee_id;
      v_out := v_out || coalesce(v_rows, '[]'::jsonb);
    end if;
  exception when others then
    null;
  end;

  return v_out;
end $fn$;

-- Defensive typ_weekly_hours reader (mirror of _tg_emp_wage).
create or replace function public._tg_emp_typ_hours(p_employee_id bigint)
returns numeric language plpgsql stable security definer set search_path=public,extensions as $fn$
declare v_h numeric;
begin
  begin
    select typ_weekly_hours into v_h from public.schedule_employees where id = p_employee_id;
  exception when undefined_column then
    v_h := null;
  end;
  return v_h;
end $fn$;

-- Promotion-Ready computation: current certs + recent passing evaluation +
-- no open concerns + a manager recommendation on file. Pure read, defensive.
create or replace function public._tg_promo_readiness(p_employee_id bigint)
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $fn$
declare
  v_min_certs int     := coalesce(public._tg_cfg_num('tg_promo_min_certs', 1), 1)::int;
  v_window    int     := coalesce(public._tg_cfg_num('tg_promo_eval_window_days', 180), 180)::int;
  v_min_score numeric := coalesce(public._tg_cfg_num('tg_promo_min_eval_score', 4), 4);
  v_certs int := 0; v_eval_score numeric; v_eval_date date;
  v_concerns jsonb; v_rec_id bigint; v_rec_status text;
begin
  begin
    select count(*) into v_certs from public.employee_certs
     where employee_id = p_employee_id
       and (expires_date is null or expires_date >= current_date);
  exception when others then
    v_certs := 0;
  end;

  begin
    select overall_score, eval_date into v_eval_score, v_eval_date
      from public.tg_evaluations
     where employee_id = p_employee_id
       and status in ('submitted','acknowledged','corporate_review','finalized')
       and overall_score is not null
       and eval_date >= current_date - v_window
     order by eval_date desc limit 1;
  exception when others then
    v_eval_score := null; v_eval_date := null;
  end;

  v_concerns := public._tg_open_concerns(p_employee_id);

  select id, status into v_rec_id, v_rec_status
    from public.tg_promo_recommendations
   where employee_id = p_employee_id and status in ('pending','under_review','accepted')
   order by created_at desc limit 1;

  return jsonb_build_object(
    'certs_count',           v_certs,
    'certs_required',        v_min_certs,
    'certs_ok',              (v_certs >= v_min_certs),
    'eval_score',            v_eval_score,
    'eval_date',             v_eval_date,
    'eval_min_score',        v_min_score,
    'eval_window_days',      v_window,
    'eval_ok',               (v_eval_score is not null and v_eval_score >= v_min_score),
    'open_concerns',         jsonb_array_length(v_concerns),
    'concerns_ok',           (jsonb_array_length(v_concerns) = 0),
    'recommended',           (v_rec_id is not null),
    'recommendation_id',     v_rec_id,
    'recommendation_status', v_rec_status,
    'ready', ( (v_certs >= v_min_certs)
           and (v_eval_score is not null and v_eval_score >= v_min_score)
           and (jsonb_array_length(v_concerns) = 0)
           and (v_rec_id is not null) )
  );
end $fn$;

-- ----------------------------------------------------------------------------
-- 5) Delta 1 RPCs — performance-concern gate
-- ----------------------------------------------------------------------------

-- GET shape (frontend reads exactly these top-level keys):
--   { concerns:[{source,level,category,occurred_on,status}], count,
--     require_justification, lookback_days }
create or replace function public.app_tg_proposal_concerns(
  p_username text, p_password text, p_employee_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_c jsonb;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  v_c := public._tg_open_concerns(p_employee_id);
  return jsonb_build_object(
    'concerns', v_c,
    'count', jsonb_array_length(v_c),
    'require_justification',
      (jsonb_array_length(v_c) > 0
       and coalesce(public._tg_cfg_num('tg_concern_require_justification',1),1) >= 1),
    'lookback_days', coalesce(public._tg_cfg_num('tg_concern_lookback_days',90),90)
  );
end $fn$;

-- Wrapper submit: records justification + a concerns snapshot, ENFORCES the
-- gate, then delegates to the EXISTING app_tg_proposal_submit (validate +
-- notify + audit path unchanged; old callers of the old RPC are unaffected).
create or replace function public.app_tg_proposal_submit_v2(
  p_username text, p_password text, p_proposal_id bigint, p_justification text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_name text;
  v_emp bigint; v_status text; v_old_just text;
  v_concerns jsonb; v_just text; v_res jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select employee_id, status, justification into v_emp, v_status, v_old_just
    from public.tg_pay_proposals where id = p_proposal_id;
  if v_emp is null then raise exception 'not found'; end if;
  if v_status not in ('draft','needs_info') then
    raise exception 'proposal cannot be submitted from status %', v_status;
  end if;

  v_concerns := public._tg_open_concerns(v_emp);
  v_just := coalesce(nullif(btrim(coalesce(p_justification,'')),''),
                     nullif(btrim(coalesce(v_old_just,'')),''));

  if jsonb_array_length(v_concerns) > 0
     and coalesce(public._tg_cfg_num('tg_concern_require_justification',1),1) >= 1
     and v_just is null then
    raise exception 'justification_required: this employee has open performance concerns — add a justification note to continue';
  end if;

  update public.tg_pay_proposals set
    justification     = coalesce(v_just, justification),
    concerns_snapshot = v_concerns,
    concern_ack       = (jsonb_array_length(v_concerns) > 0),
    updated_at        = now()
  where id = p_proposal_id;

  perform public._pp_audit(v_uid, v_name, 'tg_proposal_submit_v2', v_emp, null,
    jsonb_build_object('proposal_id', p_proposal_id,
                       'open_concerns', jsonb_array_length(v_concerns),
                       'justification', v_just), v_just);

  v_res := public.app_tg_proposal_submit(p_username, p_password, p_proposal_id);
  return coalesce(v_res,'{}'::jsonb)
      || jsonb_build_object('concerns', v_concerns,
                            'concern_count', jsonb_array_length(v_concerns));
end $fn$;

-- ----------------------------------------------------------------------------
-- 6) Delta 3 RPCs — effective date + justification (+ printable sheet data)
-- ----------------------------------------------------------------------------

-- Saves ONLY the new columns; mirrors effective_date into the pre-existing
-- proposed_effective_date so app_tg_proposal_validate flags keep working.
-- SAVE shape: bulk payload { effective_date, justification, typ_weekly_hours }.
create or replace function public.app_tg_proposal_extras_save(
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
    effective_date          = coalesce(nullif(p_payload->>'effective_date','')::date, effective_date),
    proposed_effective_date = coalesce(nullif(p_payload->>'effective_date','')::date, proposed_effective_date),
    justification           = coalesce(p_payload->>'justification', justification),
    typ_weekly_hours        = coalesce(nullif(p_payload->>'typ_weekly_hours','')::numeric, typ_weekly_hours),
    updated_at              = now()
  where id = p_proposal_id;

  perform public._pp_audit(v_uid, v_name, 'tg_proposal_extras_save', v_emp, null,
    jsonb_build_object('proposal_id', p_proposal_id) || coalesce(p_payload,'{}'::jsonb), null);

  return jsonb_build_object('ok', true);
end $fn$;

-- Everything the printable one-page raise sheet needs, in ONE call.
-- GET shape (top-level keys = exactly what tgxRaiseSheet reads):
--   { id, employee_id, employee_name, location, current_role, proposed_role,
--     current_rate, proposed_rate, raise_pct, effective_date, raise_type,
--     reason, justification, checklist, flags, status, submitted_by,
--     corporate_decision, corporate_decision_by, corporate_decision_at,
--     payroll_processed_at, payroll_processed_by, typ_weekly_hours,
--     est_weekly_impact, is_estimate, concerns_snapshot, created_at }
create or replace function public.app_tg_proposal_sheet(
  p_username text, p_password text, p_proposal_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_p record; v_emp_name text;
  v_hours numeric; v_def numeric := coalesce(public._tg_cfg_num('tg_default_weekly_hours',25),25);
  v_delta numeric; v_pct numeric;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select * into v_p from public.tg_pay_proposals where id = p_proposal_id;
  if v_p.id is null then raise exception 'not found'; end if;

  select name into v_emp_name from public.schedule_employees where id = v_p.employee_id;
  v_hours := coalesce(v_p.typ_weekly_hours, public._tg_emp_typ_hours(v_p.employee_id), v_def);
  if v_p.current_rate is not null and v_p.proposed_rate is not null then
    v_delta := v_p.proposed_rate - v_p.current_rate;
    if v_p.current_rate > 0 then
      v_pct := round((v_delta / v_p.current_rate) * 100, 2);
    end if;
  end if;

  return jsonb_build_object(
    'id', v_p.id, 'employee_id', v_p.employee_id, 'employee_name', v_emp_name,
    'location', v_p.location, 'current_role', v_p.current_role_name,
    'proposed_role', v_p.proposed_role, 'current_rate', v_p.current_rate,
    'proposed_rate', v_p.proposed_rate, 'raise_pct', v_pct,
    'effective_date', coalesce(v_p.effective_date, v_p.proposed_effective_date),
    'raise_type', v_p.raise_type, 'reason', v_p.reason,
    'justification', v_p.justification, 'checklist', v_p.checklist,
    'flags', v_p.flags, 'status', v_p.status, 'submitted_by', v_p.submitted_by,
    'corporate_decision', v_p.corporate_decision,
    'corporate_decision_by', v_p.corporate_decision_by,
    'corporate_decision_at', v_p.corporate_decision_at,
    'payroll_processed_at', v_p.payroll_processed_at,
    'payroll_processed_by', v_p.payroll_processed_by,
    'typ_weekly_hours', v_hours,
    'est_weekly_impact', case when v_delta is not null then round(v_delta * v_hours, 2) end,
    'is_estimate', true,
    'concerns_snapshot', coalesce(v_p.concerns_snapshot,'[]'::jsonb),
    'created_at', v_p.created_at
  );
end $fn$;

-- ----------------------------------------------------------------------------
-- 7) Delta 4 RPCs — typical weekly hours + payroll exposure (money cards)
-- ----------------------------------------------------------------------------

-- GET shape: { employee_id, typ_weekly_hours, default_weekly_hours }
create or replace function public.app_tg_typ_hours_get(
  p_username text, p_password text, p_employee_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'employee_id', p_employee_id,
    'typ_weekly_hours', public._tg_emp_typ_hours(p_employee_id),
    'default_weekly_hours', coalesce(public._tg_cfg_num('tg_default_weekly_hours',25),25));
end $fn$;

create or replace function public.app_tg_typ_hours_save(
  p_username text, p_password text, p_employee_id bigint, p_hours numeric)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_old numeric;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;
  if p_hours is not null and (p_hours < 0 or p_hours > 100) then
    raise exception 'typical weekly hours must be between 0 and 100';
  end if;

  v_old := public._tg_emp_typ_hours(p_employee_id);
  update public.schedule_employees set typ_weekly_hours = p_hours where id = p_employee_id;
  if not found then raise exception 'not found'; end if;

  perform public._pp_audit(v_uid, v_name, 'tg_typ_hours_save', p_employee_id,
    jsonb_build_object('typ_weekly_hours', v_old),
    jsonb_build_object('typ_weekly_hours', p_hours), null);

  return jsonb_build_object('ok', true, 'typ_weekly_hours', p_hours);
end $fn$;

-- Corporate money cards + payroll exposure report. ALL dollar figures are
-- ESTIMATES (delta_rate x manager-entered typical weekly hours; default when
-- none entered) until real clock/POS hours land — the UI must label them so.
-- Args: p_location ''/null = all stores; p_month 'YYYY-MM' (null = current).
-- GET shape:
--   { month, location, is_estimate, default_weekly_hours, weeks_per_month_factor,
--     approved_count, approved_weekly_impact, approved_monthly_impact,
--     pending_count, pending_weekly_impact, pending_monthly_impact,
--     using_default_hours_count,
--     items:[{proposal_id,employee_id,employee_name,status,current_rate,
--             proposed_rate,delta_rate,weekly_hours,hours_source,weekly_impact,
--             effective_date,decided_at,bucket}] }
create or replace function public.app_tg_payroll_exposure(
  p_username text, p_password text, p_location text, p_month text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text;
  v_start date; v_end date;
  v_def    numeric := coalesce(public._tg_cfg_num('tg_default_weekly_hours',25),25);
  v_factor numeric := coalesce(public._tg_cfg_num('tg_hours_per_month_factor',4.33),4.33);
  v_items jsonb; v_appr_cnt int; v_appr_wk numeric;
  v_pend_cnt int; v_pend_wk numeric; v_defaults int;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  begin
    v_start := to_date(coalesce(nullif(btrim(coalesce(p_month,'')),''),
                                to_char(current_date,'YYYY-MM')) || '-01','YYYY-MM-DD');
  exception when others then
    raise exception 'invalid month % — use YYYY-MM', p_month;
  end;
  v_end := (v_start + interval '1 month')::date;

  with base as (
    select pp.id, pp.employee_id, se.name as emp_name, pp.status,
           pp.current_rate, pp.proposed_rate,
           coalesce(pp.effective_date, pp.proposed_effective_date) as eff_date,
           pp.corporate_decision_at,
           (pp.proposed_rate - pp.current_rate) as delta_rate,
           coalesce(pp.typ_weekly_hours, public._tg_emp_typ_hours(pp.employee_id), v_def) as wk_hours,
           case when pp.typ_weekly_hours is not null then 'proposal'
                when public._tg_emp_typ_hours(pp.employee_id) is not null then 'employee'
                else 'default' end as hours_source,
           case
             when pp.status in ('approved','payroll_processed')
                  and pp.corporate_decision_at >= v_start and pp.corporate_decision_at < v_end
               then 'approved_this_month'
             when pp.status in ('submitted','corporate_review','needs_info')
               then 'pending'
             else null
           end as bucket
      from public.tg_pay_proposals pp
      left join public.schedule_employees se on se.id = pp.employee_id
     where (nullif(btrim(coalesce(p_location,'')),'') is null or pp.location = p_location)
       and pp.current_rate is not null and pp.proposed_rate is not null
  ), scoped as (
    select * from base where bucket is not null
  )
  select
    count(*) filter (where bucket = 'approved_this_month'),
    coalesce(round(sum(delta_rate * wk_hours) filter (where bucket = 'approved_this_month'), 2), 0),
    count(*) filter (where bucket = 'pending'),
    coalesce(round(sum(delta_rate * wk_hours) filter (where bucket = 'pending'), 2), 0),
    count(*) filter (where hours_source = 'default'),
    coalesce(jsonb_agg(jsonb_build_object(
      'proposal_id', id, 'employee_id', employee_id, 'employee_name', emp_name,
      'status', status, 'current_rate', current_rate, 'proposed_rate', proposed_rate,
      'delta_rate', round(delta_rate, 2), 'weekly_hours', wk_hours,
      'hours_source', hours_source, 'weekly_impact', round(delta_rate * wk_hours, 2),
      'effective_date', eff_date, 'decided_at', corporate_decision_at, 'bucket', bucket
    ) order by bucket, corporate_decision_at desc nulls last), '[]'::jsonb)
  into v_appr_cnt, v_appr_wk, v_pend_cnt, v_pend_wk, v_defaults, v_items
  from scoped;

  return jsonb_build_object(
    'month', to_char(v_start,'YYYY-MM'),
    'location', nullif(btrim(coalesce(p_location,'')),''),
    'is_estimate', true,
    'default_weekly_hours', v_def,
    'weeks_per_month_factor', v_factor,
    'approved_count', coalesce(v_appr_cnt,0),
    'approved_weekly_impact', coalesce(v_appr_wk,0),
    'approved_monthly_impact', round(coalesce(v_appr_wk,0) * v_factor, 2),
    'pending_count', coalesce(v_pend_cnt,0),
    'pending_weekly_impact', coalesce(v_pend_wk,0),
    'pending_monthly_impact', round(coalesce(v_pend_wk,0) * v_factor, 2),
    'using_default_hours_count', coalesce(v_defaults,0),
    'items', coalesce(v_items,'[]'::jsonb)
  );
end $fn$;

-- ----------------------------------------------------------------------------
-- 8) Delta 2 RPCs — Promotion-Ready
-- ----------------------------------------------------------------------------

-- Readiness for one employee (badge/detail). Managers, or the employee about
-- themselves. GET shape: { readiness:{...}, recommendation:{...}|null }
create or replace function public.app_tg_promo_status(
  p_username text, p_password text, p_employee_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_rec jsonb;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (public._tg_is_mgr(v_role) or public._pp_is_self(p_username, p_employee_id)) then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object('id', r.id, 'status', r.status, 'target_role', r.target_role,
           'notes', r.notes, 'recommended_by_name', r.recommended_by_name,
           'decided_by', r.decided_by, 'decided_at', r.decided_at,
           'decision_notes', r.decision_notes, 'created_at', r.created_at)
    into v_rec
    from public.tg_promo_recommendations r
   where r.employee_id = p_employee_id
   order by r.created_at desc limit 1;

  return jsonb_build_object(
    'readiness', public._tg_promo_readiness(p_employee_id),
    'recommendation', v_rec);
end $fn$;

-- Manager action: recommend for promotion (feeds the corporate queue).
-- SAVE shape: p_payload { target_role, notes }. Re-recommending while a
-- pending/under_review rec exists UPDATES it (no dup queue rows).
create or replace function public.app_tg_promo_recommend(
  p_username text, p_password text, p_employee_id bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_name text; v_id bigint;
  v_emp_name text; v_ready jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select name into v_emp_name from public.schedule_employees where id = p_employee_id;
  if v_emp_name is null then raise exception 'not found'; end if;

  select id into v_id from public.tg_promo_recommendations
   where employee_id = p_employee_id and status in ('pending','under_review')
   order by created_at desc limit 1;

  if v_id is not null then
    update public.tg_promo_recommendations set
      target_role         = coalesce(nullif(p_payload->>'target_role',''), target_role),
      notes               = coalesce(nullif(p_payload->>'notes',''), notes),
      recommended_by      = p_username,
      recommended_by_name = v_name,
      updated_at          = now()
    where id = v_id;
  else
    insert into public.tg_promo_recommendations(
      employee_id, location, target_role, notes, recommended_by, recommended_by_name, status)
    values (p_employee_id, public._tg_emp_location(p_employee_id),
            nullif(p_payload->>'target_role',''), nullif(p_payload->>'notes',''),
            p_username, v_name, 'pending')
    returning id into v_id;
  end if;

  v_ready := public._tg_promo_readiness(p_employee_id);
  update public.tg_promo_recommendations set readiness_snapshot = v_ready where id = v_id;

  perform public._pp_audit(v_uid, v_name, 'tg_promo_recommend', p_employee_id, null,
    jsonb_build_object('recommendation_id', v_id, 'readiness', v_ready)
      || coalesce(p_payload,'{}'::jsonb), null);

  perform public._tg_notify_corporate('🌟 Promotion Recommendation',
    format('%s recommended %s for promotion%s — review in Team Growth.', v_name, v_emp_name,
      case when nullif(p_payload->>'target_role','') is not null
           then ' to ' || (p_payload->>'target_role') else '' end));

  return jsonb_build_object('ok', true, 'recommendation_id', v_id, 'readiness', v_ready);
end $fn$;

-- Corporate queue. Filters: { status, location } (both optional).
-- GET shape: ARRAY of rows, each with a LIVE 'readiness' object.
create or replace function public.app_tg_promo_queue(
  p_username text, p_password text, p_filters jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_out jsonb;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'employee_id', r.employee_id, 'employee_name', se.name,
      'location', r.location, 'target_role', r.target_role, 'notes', r.notes,
      'status', r.status, 'recommended_by_name', r.recommended_by_name,
      'readiness_snapshot', r.readiness_snapshot,
      'readiness', public._tg_promo_readiness(r.employee_id),
      'decided_by', r.decided_by, 'decided_at', r.decided_at,
      'decision_notes', r.decision_notes, 'created_at', r.created_at
    ) order by (r.status in ('pending','under_review')) desc, r.created_at desc), '[]'::jsonb)
  into v_out
  from (select * from public.tg_promo_recommendations
         where (nullif(coalesce(p_filters,'{}'::jsonb)->>'status','') is null
                or status = nullif(coalesce(p_filters,'{}'::jsonb)->>'status',''))
           and (nullif(coalesce(p_filters,'{}'::jsonb)->>'location','') is null
                or location = nullif(coalesce(p_filters,'{}'::jsonb)->>'location',''))
         order by created_at desc limit 200) r
  left join public.schedule_employees se on se.id = r.employee_id;

  return v_out;
end $fn$;

-- Corporate decision on a recommendation (never automatic).
create or replace function public.app_tg_promo_decide(
  p_username text, p_password text, p_rec_id bigint, p_decision text, p_notes text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_name text;
  v_emp bigint; v_status text; v_by text; v_by_uid bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._tg_is_corp(v_role) then raise exception 'forbidden'; end if;

  if p_decision not in ('accepted','declined','under_review','withdrawn') then
    raise exception 'invalid decision %', p_decision;
  end if;

  select employee_id, status, recommended_by into v_emp, v_status, v_by
    from public.tg_promo_recommendations where id = p_rec_id;
  if v_emp is null then raise exception 'not found'; end if;
  if v_status not in ('pending','under_review') then
    raise exception 'recommendation already decided (status=%)', v_status;
  end if;

  update public.tg_promo_recommendations set
    status         = p_decision,
    decided_by     = v_name,
    decided_at     = case when p_decision = 'under_review' then decided_at else now() end,
    decision_notes = coalesce(p_notes, decision_notes),
    updated_at     = now()
  where id = p_rec_id;

  perform public._pp_audit(v_uid, v_name, 'tg_promo_decide', v_emp,
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', p_decision, 'notes', p_notes), p_notes);

  -- tell the recommending manager (best-effort, never blocks)
  begin
    select id into v_by_uid from public.users where username = v_by;
    if v_by_uid is not null then
      perform public.push_enqueue(v_by_uid, '🌟 Promotion Recommendation Update',
        format('A promotion recommendation you submitted is now: %s', replace(p_decision,'_',' ')), '');
    end if;
  exception when others then
    null;
  end;

  return jsonb_build_object('ok', true, 'status', p_decision);
end $fn$;

-- ============================================================================
-- NEW RPCS (add to rpc_manifest.json): app_tg_proposal_concerns,
--   app_tg_proposal_submit_v2, app_tg_proposal_extras_save,
--   app_tg_proposal_sheet, app_tg_typ_hours_get, app_tg_typ_hours_save,
--   app_tg_payroll_exposure, app_tg_promo_status, app_tg_promo_recommend,
--   app_tg_promo_queue, app_tg_promo_decide
-- (helpers _tg_open_concerns / _tg_emp_typ_hours / _tg_promo_readiness are
--  module-local — NOT in the manifest, same as the other _tg_ helpers)
-- ============================================================================
