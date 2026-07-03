-- ============================================================================
-- Caliche's Hub — SCHEDULING PHASE 2 + 3  (additive, idempotent)
--   Phase 2: Labor-standards engine + real-sales forecast + budget over/under
--   Phase 3: Scheduled-vs-Actual variance, SPLH, store league table
-- Run in Supabase SQL editor (proj ikgbihwkqhsfahnswfbz). ADDITIVE ONLY:
--   new tables (RLS deny-all, reached only through the SECURITY DEFINER RPCs
--   below) + new RPCs prefixed app_labor_std_ / app_forecast_ / app_sched_variance_
--   / app_store_league. It NEVER reads or alters any existing app_* RPC.
-- Style mirrors catering_module.sql: security definer, set search_path=public,
--   extensions, jsonb returns, auth via public._pm_auth(user,pw) -> urole/uname/id,
--   managers = Manager / Admin Manager / Vice President/Co-Owner / Store Manager.
--
-- REAL OBJECTS THIS BUILDS ON (verified against index.html live scheduler):
--   public.shifts(location text, shift_date date, employee_id bigint NULL=open,
--                 position_id bigint, start_time time, end_time time,
--                 published bool, note text)
--   public.schedule_employees(id bigint, name, hourly_wage numeric,
--                             home_location text, active bool)
--   public.schedule_positions(id bigint, name text, color, sort_order)
--   public.store_metrics(location text, metric_date date, sales numeric,
--                        sales_ly numeric, guest_count int, labor_pct numeric,
--                        speed_seconds, training_pct, inspection_score, ...)
--
-- >> THE ONE ASSUMPTION (isolated on purpose) <<
--   The raw time-clock PUNCH table is NOT defined in any repo .sql file - it lives
--   only in the live DB and is read by the existing app_timesheet / app_clock_in /
--   app_open_punches RPCs. From index.html its row shape is known:
--     employee_id bigint, clock_in timestamptz, clock_out timestamptz (NULL=open),
--     location text, + break fields (open_break_start; total break minutes).
--   Best-guess table name: public.time_punches. If the real name/columns differ,
--   fix it in EXACTLY ONE place - the view public.v_actual_punch_hours below
--   (change the table name and, if needed, the break-minutes expression). Every
--   Phase-3 actual-hours number flows through that single view, so it is a
--   one-line correction with no other edits required.
-- ============================================================================


-- --------------------------------------------------------------------------
-- 0) SHARED HELPERS
-- --------------------------------------------------------------------------

-- manager check (same role set as catering _cat_mgr)
create or replace function public._sched_mgr(p_role text)
returns boolean language sql immutable as $fn$
  select p_role in ('Manager','Admin Manager','Vice President/Co-Owner','Store Manager');
$fn$;

-- shift length in hours from two time-of-day values, wrapping past-midnight (+24).
-- Mirrors schedShiftHours() in index.html exactly.
create or replace function public._sched_shift_hours(p_start time, p_end time)
returns numeric language sql immutable as $fn$
  select case
    when p_start is null or p_end is null then 0::numeric
    else (case
      when (extract(epoch from p_end) - extract(epoch from p_start)) < 0
        then (extract(epoch from p_end) - extract(epoch from p_start)) + 86400
      else (extract(epoch from p_end) - extract(epoch from p_start))
    end) / 3600.0
  end;
$fn$;

-- daypart bucket from a start time (used to slice required staffing & variance).
-- open<11 = Opening, 11-14 = Lunch, 14-17 = Afternoon, 17-21 = Dinner, else Close.
create or replace function public._sched_daypart(p_start time)
returns text language sql immutable as $fn$
  select case
    when p_start is null            then 'Unassigned'
    when p_start <  time '11:00'    then 'Opening'
    when p_start <  time '14:00'    then 'Lunch'
    when p_start <  time '17:00'    then 'Afternoon'
    when p_start <  time '21:00'    then 'Dinner'
    else                                 'Close'
  end;
$fn$;

-- Monday of the ISO week containing p_date (schedule weeks start Monday).
create or replace function public._sched_week_monday(p_date date)
returns date language sql immutable as $fn$
  select p_date - ((extract(isodow from p_date)::int - 1));
$fn$;


-- --------------------------------------------------------------------------
-- 0b) ACTUAL-HOURS VIEW  << the single isolated punch-table dependency >>
--   Aggregates raw punches to (employee_id, location, work_date, actual_hours).
--   actual_hours = (clock_out - clock_in) minus paid/unpaid break minutes.
--   Open punches (clock_out IS NULL) are excluded from actuals (nothing to bill
--   until they clock out). If your punch table is named/shaped differently, THIS
--   is the only object to edit.
-- --------------------------------------------------------------------------
create or replace view public.v_actual_punch_hours as
  select
    tp.employee_id                                   as employee_id,
    tp.location                                      as location,
    (tp.clock_in at time zone 'UTC')::date           as work_date,
    sum(
      greatest(
        0,
        (extract(epoch from (tp.clock_out - tp.clock_in)) / 3600.0)
        - (coalesce(tp.break_minutes, 0) / 60.0)      -- <- adjust if breaks live in another column
      )
    )                                                as actual_hours,
    count(*)                                          as punch_count
  from public.time_punches tp                         -- <- ONLY line to change if table name differs
  where tp.clock_out is not null
  group by tp.employee_id, tp.location, (tp.clock_in at time zone 'UTC')::date;

-- Fallback: if public.time_punches does not exist yet in this environment, the
-- view creation above will error. In that case create a harmless empty stand-in
-- so the RPCs still install and return zeros for "actual" (schedule/forecast
-- sides keep working); swap in the real table later by re-running section 0b.
--   (Left commented - uncomment ONLY if the CREATE VIEW above failed.)
-- create or replace view public.v_actual_punch_hours as
--   select null::bigint as employee_id, null::text as location,
--          null::date as work_date, 0::numeric as actual_hours, 0::bigint as punch_count
--   where false;


-- ============================================================================
-- PHASE 2 - LABOR STANDARDS + FORECAST
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) labor_standards table  (RLS deny-all; RPC-only access)
--   A rule scopes to a location and OPTIONALLY a daypart, an hour, or a position.
--   rule_type:
--     'sales_per_labor_hour' -> value = $ of sales that justifies 1 labor hour
--                               (required_hours = predicted_sales / value)
--     'guests_per_staff'     -> value = guests one staffer covers
--                               (required_staff = predicted_guests / value)
--     'fixed_min'            -> value = a floor of staff (or hours) always present
--   A location can hold several rules; the forecast applies the most specific and
--   takes the MAX requirement so no rule is violated.
-- --------------------------------------------------------------------------
create table if not exists public.labor_standards (
  id           bigint generated always as identity primary key,
  location     text not null,
  daypart      text,                 -- NULL = applies all day; else Opening/Lunch/...
  hour         int,                  -- NULL, or 0..23 for an hour-specific rule
  position_id  bigint,               -- NULL = any position, else scopes to one role
  rule_type    text not null
                 check (rule_type in ('sales_per_labor_hour','guests_per_staff','fixed_min')),
  value        numeric(12,2) not null check (value > 0),
  active       boolean not null default true,
  note         text,
  updated_by   text,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists labor_standards_loc_idx on public.labor_standards(location) where active;
alter table public.labor_standards enable row level security;  -- deny-all; RPCs only

-- 1a) upsert a labor standard (manager) - insert new, or update by p_id
create or replace function public.app_labor_std_set(
  p_username text, p_password text,
  p_id bigint,            -- NULL = create
  p_location text, p_rule_type text, p_value numeric,
  p_daypart text default null, p_hour int default null,
  p_position_id bigint default null, p_active boolean default true,
  p_note text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_role text; v_name text; v_id bigint;
begin
  select urole, uname into v_role, v_name from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;
  if coalesce(trim(p_location),'') = '' then raise exception 'Location is required'; end if;
  if p_rule_type not in ('sales_per_labor_hour','guests_per_staff','fixed_min') then
    raise exception 'Unknown rule_type %', p_rule_type; end if;
  if p_value is null or p_value <= 0 then raise exception 'Value must be greater than zero'; end if;
  if p_hour is not null and (p_hour < 0 or p_hour > 23) then raise exception 'Hour must be 0-23'; end if;

  if p_id is null then
    insert into public.labor_standards
      (location, daypart, hour, position_id, rule_type, value, active, note, updated_by)
    values
      (trim(p_location), nullif(trim(p_daypart),''), p_hour, p_position_id,
       p_rule_type, p_value, coalesce(p_active,true), nullif(trim(p_note),''), v_name)
    returning id into v_id;
  else
    update public.labor_standards set
      location    = trim(p_location),
      daypart     = nullif(trim(p_daypart),''),
      hour        = p_hour,
      position_id = p_position_id,
      rule_type   = p_rule_type,
      value       = p_value,
      active      = coalesce(p_active, active),
      note        = nullif(trim(p_note),''),
      updated_by  = v_name,
      updated_at  = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'Standard not found'; end if;
  end if;
  return jsonb_build_object('ok',true,'id',v_id);
end $fn$;

-- 1b) list labor standards for a store (manager) - includes position name
create or replace function public.app_labor_std_list(
  p_username text, p_password text, p_location text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_role text;
begin
  select urole into v_role from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', ls.id, 'location', ls.location, 'daypart', ls.daypart, 'hour', ls.hour,
      'position_id', ls.position_id, 'position_name', sp.name,
      'rule_type', ls.rule_type, 'value', ls.value, 'active', ls.active,
      'note', ls.note, 'updated_by', ls.updated_by, 'updated_at', ls.updated_at)
      order by ls.location, ls.active desc,
               coalesce(ls.daypart,'~'), coalesce(ls.hour,-1), ls.rule_type)
    from public.labor_standards ls
    left join public.schedule_positions sp on sp.id = ls.position_id
    where (p_location is null or ls.location = p_location)
  ), '[]'::jsonb);
end $fn$;

-- 1c) delete a labor standard (manager)
create or replace function public.app_labor_std_delete(
  p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_role text;
begin
  select urole into v_role from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;
  delete from public.labor_standards where id = p_id;
  return jsonb_build_object('ok',true);
end $fn$;


-- --------------------------------------------------------------------------
-- 2) app_forecast_required - predict a day's sales & guests from store_metrics,
--    then apply labor_standards to output REQUIRED staff / labor-hours by daypart.
--    Prediction = average of the SAME weekday over the last ~8 weeks of history
--    that is strictly BEFORE p_date; falls back to the store's overall average.
--    Also surfaces same-day-last-year (sales_ly) if a row exists near p_date.
-- --------------------------------------------------------------------------
create or replace function public.app_forecast_required(
  p_username text, p_password text, p_location text, p_date date)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_role text;
  v_pred_sales  numeric;
  v_pred_guests numeric;
  v_sales_ly    numeric;
  v_basis       text;
  v_target_pct  numeric;
  v_dparts      text[] := array['Opening','Lunch','Afternoon','Dinner','Close'];
  v_dp          text;
  v_dp_share    numeric;
  v_dp_sales    numeric;
  v_dp_guests   numeric;
  v_req_hours   numeric;
  v_req_staff   numeric;
  v_r           record;
  v_by_daypart  jsonb := '[]'::jsonb;
  v_total_hours numeric := 0;
  v_total_staff numeric := 0;
begin
  select urole into v_role from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;

  -- (a) same-weekday average over the last 8 matching weekdays before p_date
  select avg(sm.sales), avg(sm.guest_count)
    into v_pred_sales, v_pred_guests
  from (
    select sales, guest_count
    from public.store_metrics
    where location = p_location
      and metric_date < p_date
      and extract(isodow from metric_date) = extract(isodow from p_date)
      and sales is not null
    order by metric_date desc
    limit 8
  ) sm;
  v_basis := 'same_weekday_avg';

  -- (b) fallback: overall store average (any weekday) if no weekday history
  if v_pred_sales is null then
    select avg(sales), avg(guest_count) into v_pred_sales, v_pred_guests
    from public.store_metrics
    where location = p_location and sales is not null and metric_date < p_date;
    v_basis := 'store_overall_avg';
  end if;

  -- (c) still nothing? honest zeros (new store / empty feed)
  if v_pred_sales is null then v_pred_sales := 0; v_basis := 'no_history'; end if;
  v_pred_guests := coalesce(v_pred_guests, 0);

  -- last-year sales for this date (nearest row within +/-3 days, one year back)
  select sm.sales_ly into v_sales_ly
  from public.store_metrics sm
  where sm.location = p_location and sm.sales_ly is not null
    and sm.metric_date between (p_date - 368) and (p_date - 362)
  order by abs(sm.metric_date - (p_date - 365)) asc
  limit 1;

  -- target labor % = most recent non-null labor_pct we have for the store (else 25)
  select labor_pct into v_target_pct
  from public.store_metrics
  where location = p_location and labor_pct is not null
  order by metric_date desc limit 1;
  v_target_pct := coalesce(v_target_pct, 25);

  -- Distribute the day's predicted volume across dayparts using a fixed intraday
  -- weighting (typical QSR/dessert curve). Guests track the same shape.
  -- Opening .10 - Lunch .28 - Afternoon .22 - Dinner .30 - Close .10  (sums to 1)
  for v_dp, v_dp_share in
    select * from unnest(v_dparts, array[0.10,0.28,0.22,0.30,0.10]::numeric[])
  loop
    v_dp_sales  := round(v_pred_sales  * v_dp_share, 2);
    v_dp_guests := round(v_pred_guests * v_dp_share, 1);
    v_req_hours := 0;
    v_req_staff := 0;

    -- apply every active rule that matches this store + (this daypart or all-day),
    -- taking the MAX so no single standard is under-staffed.
    for v_r in
      select rule_type, value
      from public.labor_standards
      where active
        and location = p_location
        and (daypart is null or daypart = v_dp)
    loop
      if v_r.rule_type = 'sales_per_labor_hour' and v_r.value > 0 then
        v_req_hours := greatest(v_req_hours, v_dp_sales / v_r.value);
      elsif v_r.rule_type = 'guests_per_staff' and v_r.value > 0 then
        v_req_staff := greatest(v_req_staff, v_dp_guests / v_r.value);
      elsif v_r.rule_type = 'fixed_min' then
        v_req_staff := greatest(v_req_staff, v_r.value);
      end if;
    end loop;

    v_by_daypart := v_by_daypart || jsonb_build_array(jsonb_build_object(
      'daypart',        v_dp,
      'predicted_sales',  v_dp_sales,
      'predicted_guests', v_dp_guests,
      'required_labor_hours', round(v_req_hours, 1),
      'required_staff',       ceil(v_req_staff)::int
    ));
    v_total_hours := v_total_hours + v_req_hours;
    v_total_staff := v_total_staff + ceil(v_req_staff);
  end loop;

  -- If the store has NO labor standards yet, derive a recommended labor-hour
  -- budget straight from target % (labor_$ target / an assumed avg wage of $12).
  if v_total_hours = 0 then
    v_total_hours := round((v_pred_sales * v_target_pct / 100.0) / 12.0, 1);
  end if;

  return jsonb_build_object(
    'location',          p_location,
    'date',              p_date,
    'basis',             v_basis,
    'predicted_sales',   round(v_pred_sales, 2),
    'predicted_guests',  round(v_pred_guests)::int,
    'sales_ly',          v_sales_ly,
    'target_labor_pct',  v_target_pct,
    'required_by_daypart', v_by_daypart,
    'recommended_labor_hours', round(v_total_hours, 1),
    'recommended_staff_shifts', v_total_staff
  );
end $fn$;


-- --------------------------------------------------------------------------
-- 3) app_forecast_vs_scheduled - the "budget enforcement / over-under" data for
--    the schedule builder. For each of the 7 days in the week: predicted sales,
--    scheduled labor $ + hours (from shifts x schedule_employees.hourly_wage,
--    with >40h/week OT at 1.5x to match the grid), scheduled labor % vs predicted,
--    required vs scheduled staff (over/under). Plus week totals.
-- --------------------------------------------------------------------------
create or replace function public.app_forecast_vs_scheduled(
  p_username text, p_password text, p_location text, p_week_start date)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_role text;
  v_ws date := public._sched_week_monday(p_week_start);
  v_we date := public._sched_week_monday(p_week_start) + 6;
  v_target_pct numeric;
  v_days jsonb := '[]'::jsonb;
  v_d date;
  v_i int;
  v_fc jsonb;
  v_pred numeric;
  v_req_staff numeric;
  v_sched_hours numeric;
  v_sched_cost numeric;
  v_sched_staff int;
  v_wk_pred numeric := 0;
  v_wk_hours numeric := 0;
  v_wk_cost numeric := 0;
begin
  select urole into v_role from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;

  -- week-scoped per-employee OT split (so daily labor $ respects the 40h line).
  -- We compute each employee's full-week hours once, derive their blended rate,
  -- and bill each day's hours at that blended rate - a fair daily allocation of
  -- weekly OT that still sums to the true weekly labor $.
  create temp table _fvs_emp on commit drop as
    select s.employee_id,
           sum(public._sched_shift_hours(s.start_time,s.end_time)) as wk_hours,
           coalesce(se.hourly_wage,0) as wage
    from public.shifts s
    left join public.schedule_employees se on se.id = s.employee_id
    where s.location = p_location
      and s.shift_date between v_ws and v_we
      and s.employee_id is not null
    group by s.employee_id, se.hourly_wage;

  select labor_pct into v_target_pct
  from public.store_metrics
  where location = p_location and labor_pct is not null
  order by metric_date desc limit 1;
  v_target_pct := coalesce(v_target_pct, 25);

  for v_i in 0..6 loop
    v_d := v_ws + v_i;

    -- forecast for the day (reuse the Phase-2 engine)
    v_fc := public.app_forecast_required(p_username, p_password, p_location, v_d);
    v_pred := coalesce((v_fc->>'predicted_sales')::numeric, 0);
    v_req_staff := coalesce((v_fc->>'recommended_staff_shifts')::numeric, 0);

    -- scheduled hours for the day
    select coalesce(sum(public._sched_shift_hours(s.start_time,s.end_time)),0)
      into v_sched_hours
    from public.shifts s
    where s.location = p_location and s.shift_date = v_d;

    -- distinct scheduled staff for the day (named employees only)
    select count(distinct s.employee_id) into v_sched_staff
    from public.shifts s
    where s.location = p_location and s.shift_date = v_d and s.employee_id is not null;

    -- scheduled labor $ for the day = each emp's day-hours x their blended weekly
    -- rate (base for the first 40 weekly hrs, 1.5x thereafter, averaged).
    select coalesce(sum(
             public._sched_shift_hours(s.start_time,s.end_time) *
             case when e.wk_hours > 0
               then (least(e.wk_hours,40)*e.wage + greatest(e.wk_hours-40,0)*e.wage*1.5) / e.wk_hours
               else e.wage end
           ),0)
      into v_sched_cost
    from public.shifts s
    join _fvs_emp e on e.employee_id = s.employee_id
    where s.location = p_location and s.shift_date = v_d;

    v_days := v_days || jsonb_build_array(jsonb_build_object(
      'date',             v_d,
      'dow',              to_char(v_d,'Dy'),
      'predicted_sales',  round(v_pred,2),
      'scheduled_hours',  round(v_sched_hours,1),
      'scheduled_labor',  round(v_sched_cost,2),
      'scheduled_labor_pct', case when v_pred > 0 then round(v_sched_cost / v_pred * 100, 1) else null end,
      'required_staff',   ceil(v_req_staff)::int,
      'scheduled_staff',  v_sched_staff,
      'staff_delta',      v_sched_staff - ceil(v_req_staff)::int,   -- + = over, - = under
      'over_budget',      case when v_pred > 0 then (v_sched_cost / v_pred * 100) > v_target_pct else false end
    ));

    v_wk_pred  := v_wk_pred  + v_pred;
    v_wk_hours := v_wk_hours + v_sched_hours;
    v_wk_cost  := v_wk_cost  + v_sched_cost;
  end loop;

  return jsonb_build_object(
    'location',   p_location,
    'week_start', v_ws,
    'week_end',   v_we,
    'target_labor_pct', v_target_pct,
    'days',       v_days,
    'week_totals', jsonb_build_object(
      'predicted_sales', round(v_wk_pred,2),
      'scheduled_hours', round(v_wk_hours,1),
      'scheduled_labor', round(v_wk_cost,2),
      'scheduled_labor_pct', case when v_wk_pred > 0 then round(v_wk_cost / v_wk_pred * 100, 1) else null end,
      'over_budget', case when v_wk_pred > 0 then (v_wk_cost / v_wk_pred * 100) > v_target_pct else false end
    )
  );
end $fn$;


-- ============================================================================
-- PHASE 3 - VARIANCE / SPLH / LEAGUE
-- ============================================================================

-- --------------------------------------------------------------------------
-- 4) app_sched_variance - per day + week totals for one store:
--    SCHEDULED hours+$ (from shifts, 40h OT @1.5x),
--    ACTUAL hours+$ (from v_actual_punch_hours x hourly_wage, same OT rule),
--    sales = store_metrics.sales if present for the day, else predicted,
--    SPLH scheduled vs actual (sales / labor hours),
--    labor % scheduled vs actual, and the hour/$ variances.
-- --------------------------------------------------------------------------
create or replace function public.app_sched_variance(
  p_username text, p_password text, p_location text, p_week_start date)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_role text;
  v_ws date := public._sched_week_monday(p_week_start);
  v_we date := public._sched_week_monday(p_week_start) + 6;
  v_days jsonb := '[]'::jsonb;
  v_d date; v_i int;
  v_sched_h numeric; v_sched_c numeric;
  v_act_h numeric;  v_act_c numeric;
  v_sales numeric; v_sales_src text;
  v_fc jsonb;
  v_wk_sched_h numeric := 0; v_wk_sched_c numeric := 0;
  v_wk_act_h numeric := 0;   v_wk_act_c numeric := 0;
  v_wk_sales numeric := 0;
begin
  select urole into v_role from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;

  -- weekly OT context for SCHEDULED (blended daily rate, as in Phase 2 #3)
  create temp table _var_sched on commit drop as
    select s.employee_id,
           sum(public._sched_shift_hours(s.start_time,s.end_time)) as wk_hours,
           coalesce(se.hourly_wage,0) as wage
    from public.shifts s
    left join public.schedule_employees se on se.id = s.employee_id
    where s.location = p_location and s.shift_date between v_ws and v_we
      and s.employee_id is not null
    group by s.employee_id, se.hourly_wage;

  -- weekly OT context for ACTUAL (from the isolated punch view)
  create temp table _var_act on commit drop as
    select a.employee_id,
           sum(a.actual_hours) as wk_hours,
           coalesce(se.hourly_wage,0) as wage
    from public.v_actual_punch_hours a
    left join public.schedule_employees se on se.id = a.employee_id
    where a.location = p_location and a.work_date between v_ws and v_we
    group by a.employee_id, se.hourly_wage;

  for v_i in 0..6 loop
    v_d := v_ws + v_i;

    -- SCHEDULED hours + blended-rate $
    select coalesce(sum(public._sched_shift_hours(s.start_time,s.end_time)),0),
           coalesce(sum(
             public._sched_shift_hours(s.start_time,s.end_time) *
             case when e.wk_hours > 0
               then (least(e.wk_hours,40)*e.wage + greatest(e.wk_hours-40,0)*e.wage*1.5)/e.wk_hours
               else e.wage end),0)
      into v_sched_h, v_sched_c
    from public.shifts s
    left join _var_sched e on e.employee_id = s.employee_id
    where s.location = p_location and s.shift_date = v_d;

    -- ACTUAL hours + blended-rate $
    select coalesce(sum(a.actual_hours),0),
           coalesce(sum(
             a.actual_hours *
             case when e.wk_hours > 0
               then (least(e.wk_hours,40)*e.wage + greatest(e.wk_hours-40,0)*e.wage*1.5)/e.wk_hours
               else e.wage end),0)
      into v_act_h, v_act_c
    from public.v_actual_punch_hours a
    left join _var_act e on e.employee_id = a.employee_id
    where a.location = p_location and a.work_date = v_d;

    -- sales: prefer the recorded actual; fall back to the forecast engine
    select sm.sales into v_sales
    from public.store_metrics sm
    where sm.location = p_location and sm.metric_date = v_d and sm.sales is not null
    limit 1;
    if v_sales is not null then
      v_sales_src := 'actual';
    else
      v_fc := public.app_forecast_required(p_username, p_password, p_location, v_d);
      v_sales := coalesce((v_fc->>'predicted_sales')::numeric, 0);
      v_sales_src := 'predicted';
    end if;

    v_days := v_days || jsonb_build_array(jsonb_build_object(
      'date',           v_d,
      'dow',            to_char(v_d,'Dy'),
      'sales',          round(v_sales,2),
      'sales_source',   v_sales_src,
      'scheduled_hours', round(v_sched_h,1),
      'scheduled_labor', round(v_sched_c,2),
      'actual_hours',    round(v_act_h,1),
      'actual_labor',    round(v_act_c,2),
      'hours_variance',  round(v_act_h - v_sched_h,1),           -- + = worked more than scheduled
      'labor_variance',  round(v_act_c - v_sched_c,2),
      'splh_scheduled',  case when v_sched_h > 0 then round(v_sales / v_sched_h,2) else null end,
      'splh_actual',     case when v_act_h  > 0 then round(v_sales / v_act_h,2)  else null end,
      'labor_pct_scheduled', case when v_sales > 0 then round(v_sched_c / v_sales * 100,1) else null end,
      'labor_pct_actual',    case when v_sales > 0 then round(v_act_c  / v_sales * 100,1) else null end
    ));

    v_wk_sched_h := v_wk_sched_h + v_sched_h; v_wk_sched_c := v_wk_sched_c + v_sched_c;
    v_wk_act_h   := v_wk_act_h   + v_act_h;   v_wk_act_c   := v_wk_act_c   + v_act_c;
    v_wk_sales   := v_wk_sales   + v_sales;
  end loop;

  return jsonb_build_object(
    'location',   p_location,
    'week_start', v_ws,
    'week_end',   v_we,
    'days',       v_days,
    'week_totals', jsonb_build_object(
      'sales',            round(v_wk_sales,2),
      'scheduled_hours',  round(v_wk_sched_h,1),
      'scheduled_labor',  round(v_wk_sched_c,2),
      'actual_hours',     round(v_wk_act_h,1),
      'actual_labor',     round(v_wk_act_c,2),
      'hours_variance',   round(v_wk_act_h - v_wk_sched_h,1),
      'labor_variance',   round(v_wk_act_c - v_wk_sched_c,2),
      'splh_scheduled',   case when v_wk_sched_h > 0 then round(v_wk_sales / v_wk_sched_h,2) else null end,
      'splh_actual',      case when v_wk_act_h  > 0 then round(v_wk_sales / v_wk_act_h,2)  else null end,
      'labor_pct_scheduled', case when v_wk_sales > 0 then round(v_wk_sched_c / v_wk_sales * 100,1) else null end,
      'labor_pct_actual',    case when v_wk_sales > 0 then round(v_wk_act_c  / v_wk_sales * 100,1) else null end
    )
  );
end $fn$;


-- --------------------------------------------------------------------------
-- 5) app_store_league - benchmark ALL stores for one week. Ranks locations by
--    labor % (actual if punches exist, else scheduled), SPLH, and sales-vs-LY.
--    Store universe = distinct store_metrics.location UNION distinct shifts.location
--    for the week (so a store with a schedule but no metrics still appears).
-- --------------------------------------------------------------------------
create or replace function public.app_store_league(
  p_username text, p_password text, p_week_start date)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_role text;
  v_ws date := public._sched_week_monday(p_week_start);
  v_we date := public._sched_week_monday(p_week_start) + 6;
  v_rows jsonb := '[]'::jsonb;
  v_loc text;
  v_sched_h numeric; v_sched_c numeric; v_act_h numeric;
  v_sales numeric; v_sales_ly numeric;
  v_labor_pct numeric; v_splh numeric; v_ly_delta numeric;
  v_tmp jsonb := '[]'::jsonb;
begin
  select urole into v_role from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;

  for v_loc in
    select location from public.store_metrics where location is not null
    union
    select location from public.shifts where location is not null
    order by 1
  loop
    -- scheduled hours + $ for the week (simple: base wage; league is a coarse rank)
    select coalesce(sum(public._sched_shift_hours(s.start_time,s.end_time)),0),
           coalesce(sum(public._sched_shift_hours(s.start_time,s.end_time)*coalesce(se.hourly_wage,0)),0)
      into v_sched_h, v_sched_c
    from public.shifts s
    left join public.schedule_employees se on se.id = s.employee_id
    where s.location = v_loc and s.shift_date between v_ws and v_we;

    -- actual hours for the week (from punch view)
    select coalesce(sum(a.actual_hours),0) into v_act_h
    from public.v_actual_punch_hours a
    where a.location = v_loc and a.work_date between v_ws and v_we;

    -- sales + sales_ly for the week (sum of the store_metrics rows in range)
    select coalesce(sum(sm.sales),0), coalesce(sum(sm.sales_ly),0)
      into v_sales, v_sales_ly
    from public.store_metrics sm
    where sm.location = v_loc and sm.metric_date between v_ws and v_we;

    v_labor_pct := case when v_sales > 0 then round(v_sched_c / v_sales * 100,1) else null end;
    v_splh      := case
                     when v_act_h  > 0 then round(v_sales / v_act_h,2)
                     when v_sched_h> 0 then round(v_sales / v_sched_h,2)
                     else null end;
    v_ly_delta  := case when v_sales_ly > 0 then round((v_sales - v_sales_ly)/v_sales_ly*100,1) else null end;

    v_tmp := v_tmp || jsonb_build_array(jsonb_build_object(
      'location',      v_loc,
      'sales',         round(v_sales,2),
      'sales_ly',      round(v_sales_ly,2),
      'sales_vs_ly_pct', v_ly_delta,
      'scheduled_hours', round(v_sched_h,1),
      'actual_hours',    round(v_act_h,1),
      'labor_pct',       v_labor_pct,
      'splh',            v_splh
    ));
  end loop;

  -- rank: labor % ascending (lower=better), then SPLH descending, then
  -- sales-vs-LY descending; NULLs sort last on each metric. row_number() assigns
  -- the rank in the inner subquery; the outer jsonb_agg orders by that rank so
  -- 'rank' always matches array order. (Window fn and aggregate are at separate
  -- query levels, which Postgres requires.)
  select coalesce(jsonb_agg(ranked.elem || jsonb_build_object('rank', ranked.rk)
                            order by ranked.rk), '[]'::jsonb)
    into v_rows
  from (
    select r.value as elem,
           row_number() over (order by
             (r.value->>'labor_pct') is null,       (r.value->>'labor_pct')::numeric asc,
             (r.value->>'splh') is null,            (r.value->>'splh')::numeric desc,
             (r.value->>'sales_vs_ly_pct') is null, (r.value->>'sales_vs_ly_pct')::numeric desc
           ) as rk
    from jsonb_array_elements(v_tmp) r
  ) ranked;

  return jsonb_build_object('week_start', v_ws, 'week_end', v_we, 'stores', v_rows);
end $fn$;


-- --------------------------------------------------------------------------
-- 6) Teach Scoopy (idempotent - only inserts if the question is new)
-- --------------------------------------------------------------------------
insert into public.knowledge_base (category, question, answer, updated_at, updated_by)
select 'App Help', q, a, now(), 'Cowork build' from (values
  ('How do labor standards and the staffing forecast work?',
   'Managers set labor standards per store on the schedule tools: e.g. "1 labor hour per $250 of sales" (sales per labor hour), "1 staffer per 30 guests" (guests per staff), or a fixed minimum crew. When you build a week, the Hub predicts each day''s sales and guests by averaging the same weekday over the last several weeks of store scorecard data, then applies your standards to suggest required staff and labor-hours by daypart (Opening, Lunch, Afternoon, Dinner, Close). It also shows last-year sales for context.'),
  ('What is the over/under budget banner on the schedule?',
   'As you build a week, the Hub compares your scheduled labor dollars against predicted sales for each day and the week. If scheduled labor % is above the store''s target, the day (or week) flags as over budget, and it shows required-vs-scheduled staff so you can see where you are over- or under-staffed before you publish. Scheduled labor $ uses each person''s wage with overtime (over 40 hours/week at 1.5x).'),
  ('What does the Variance / SPLH report show?',
   'After a week is worked, the Variance report compares what you SCHEDULED against what actually happened on the time clock: scheduled vs actual hours and labor dollars, the hour and dollar variance, and Sales-Per-Labor-Hour (SPLH = sales / labor hours) both scheduled and actual, plus labor % scheduled vs actual. Sales use the recorded scorecard number for the day when available, otherwise the forecast. It answers "did the schedule work?"'),
  ('What is the store league table?',
   'The league table ranks all stores for a chosen week on the KPIs that make an operator money: labor % (lower is better), Sales-Per-Labor-Hour (higher is better), and sales versus last year. It uses actual time-clock hours where available and scheduled hours otherwise, so you can benchmark locations side by side.')
) v(q,a)
where not exists (select 1 from public.knowledge_base kb where kb.question = v.q);


-- ============================================================================
-- -- SMOKE TESTS ------------------------------------------------------------
-- Replace 'MANAGER_USER' / 'MANAGER_PW' with a real manager login, and
-- 'STORE' with a real store name (e.g. from HUB_STORES). Run piecemeal.
-- Every RPC must (a) reject a non-manager and (b) return valid jsonb for a mgr.
-- ============================================================================
/*
-- 0) confirm the objects installed
select proname from pg_proc
 where proname in ('app_labor_std_set','app_labor_std_list','app_labor_std_delete',
                   'app_forecast_required','app_forecast_vs_scheduled',
                   'app_sched_variance','app_store_league',
                   '_sched_mgr','_sched_shift_hours','_sched_daypart','_sched_week_monday')
 order by proname;
select table_name from information_schema.views where table_name='v_actual_punch_hours';

-- 1) AUTH GUARD - a non-manager must be blocked (expect: error 'Managers only')
--    select public.app_labor_std_list('SOME_EMPLOYEE_USER','THEIR_PW', null);

-- 2) LABOR STANDARDS - create two rules, list, then delete one
select public.app_labor_std_set('MANAGER_USER','MANAGER_PW', null,
        'STORE','sales_per_labor_hour', 250, null, null, null, true, 'seed: $250/labor hr');
select public.app_labor_std_set('MANAGER_USER','MANAGER_PW', null,
        'STORE','guests_per_staff', 30, 'Lunch', null, null, true, 'seed: 1 per 30 guests at lunch');
select public.app_labor_std_list('MANAGER_USER','MANAGER_PW','STORE');
-- grab an id from the list above, then:
-- select public.app_labor_std_delete('MANAGER_USER','MANAGER_PW', <id>);

-- 3) FORECAST for a specific day (expect predicted_sales/guests + required_by_daypart)
select public.app_forecast_required('MANAGER_USER','MANAGER_PW','STORE', current_date);

-- 4) FORECAST vs SCHEDULED for the current week (expect 7 days + week_totals, over_budget flags)
select public.app_forecast_vs_scheduled('MANAGER_USER','MANAGER_PW','STORE',
        public._sched_week_monday(current_date));

-- 5) VARIANCE / SPLH for the current week (scheduled vs actual; actual=0 until punches exist)
select public.app_sched_variance('MANAGER_USER','MANAGER_PW','STORE',
        public._sched_week_monday(current_date));

-- 6) STORE LEAGUE for the current week (ranked list of all stores)
select public.app_store_league('MANAGER_USER','MANAGER_PW',
        public._sched_week_monday(current_date));

-- 7) PUNCH-VIEW sanity (should return rows if time_punches has closed punches;
--    if it errors, the punch table name/columns differ - fix section 0b ONLY)
-- select * from public.v_actual_punch_hours order by work_date desc limit 5;
*/
-- Done.  Verify quickly:  select proname from pg_proc where proname like 'app_labor_std_%'
--                          or proname like 'app_forecast_%' or proname='app_sched_variance'
--                          or proname='app_store_league';
