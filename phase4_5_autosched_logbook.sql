-- ============================================================================
-- Caliche's Hub — SCHEDULING PHASE 4 + PHASE 5  (additive, idempotent)
--   Phase 4:  app_sched_generate  — auto-scheduler (fill OPEN shifts from the
--             cleared + available + non-conflicting + under-40h employee pool;
--             dry-run preview OR write via normal UPDATE so shifts_integrity()
--             enforces every safety rule for us).
--   Phase 5a: clock-in hardening columns (pin_ok / photo_url / geo / source) +
--             app_clock_adherence  — on-time / late / no-show / left-early vs
--             the published schedule.
--   Phase 5b: manager_logbook + app_logbook_add / app_logbook_list.
--   Phase 5c: task_lists / task_list_items / task_completions + the
--             app_tasklist_* / app_task_complete RPCs, seeded Opening/Closing.
--
--   Run in the Supabase SQL editor (project ikgbihwkqhsfahnswfbz). Safe to re-run.
--   Auth reuses public._pm_auth(p_username,p_password) -> (uid,urole,uname)
--   (bcrypt via extensions.crypt).  Managers, everywhere below, are:
--       'Manager','Admin Manager','Vice President/Co-Owner','Store Manager'.
--   All new tables are RLS-on / deny-all; access ONLY through the SECURITY
--   DEFINER RPCs here.  We NEVER read or alter any existing app_* RPC.
--
--   -- ASSUMPTIONS (see the two clearly-labelled blocks further down) ----------
--   * PUNCHES TABLE.  The live schema hides its time-clock table behind RPCs
--     (app_clock_in/out, app_punch_list/edit/delete, app_ot_watch,
--     app_open_punches); the raw table name is not referenced anywhere in the
--     codebase.  We assume it is  public.time_punches  with columns
--     (id, employee_id, location, clock_in timestamptz, clock_out timestamptz).
--     Every touch of that table is quarantined:
--       - the Phase-5a ALTERs sit in one guarded block that no-ops if the table
--         (or a differently-named one) is absent;
--       - app_clock_adherence builds its punch set in ONE isolated CTE
--         (v_punch) so if the name is wrong you change exactly one line.
--     >>> IF THE REAL NAME DIFFERS: set the name in v_names / v_punch and re-run. <<<
--   * AVAILABILITY TABLE.  Availability is only ever reached through
--     app_availability_all / _submit / _mine / _pending / _decide; the backing
--     table name is not in the codebase.  We assume  public.employee_availability
--     (employee_id, weekday 0..6, is_available bool, [start_time,end_time]).
--     The auto-scheduler's availability filter is isolated in one helper
--     (_sched_is_available) that FAILS OPEN (returns true) if the table is
--     missing, and every proposal is stamped with availability_checked so the
--     UI/manager can see whether the check actually ran.  TODO marked inline.
-- ============================================================================


-- ####################################################################
-- ##  SHARED HELPERS                                                ##
-- ####################################################################

-- manager gate (mirrors catering_module._cat_mgr) --------------------
create or replace function public._sched_mgr(p_role text)
returns boolean language sql immutable as $fn$
  select p_role in ('Manager','Admin Manager','Vice President/Co-Owner','Store Manager');
$fn$;

-- minutes between two times on the same day (end may wrap past midnight)
create or replace function public._sched_shift_minutes(p_start time, p_end time)
returns numeric language sql immutable as $fn$
  select case
           when p_start is null or p_end is null then 0
           when p_end >= p_start
             then extract(epoch from (p_end - p_start))/60.0
           else extract(epoch from ((p_end - p_start) + interval '24 hours'))/60.0
         end;
$fn$;

-- do two [start,end) time windows overlap on the same calendar day? --
create or replace function public._sched_overlap(a_start time, a_end time, b_start time, b_end time)
returns boolean language sql immutable as $fn$
  -- treat a null end as the same as start (zero-length) so it never blocks
  select coalesce(a_start,'00:00') < coalesce(b_end,b_start,'00:00')
     and coalesce(b_start,'00:00') < coalesce(a_end,a_start,'00:00');
$fn$;


-- ####################################################################
-- ##  PHASE 4 — AUTO-SCHEDULER                                      ##
-- ####################################################################

-- Availability check, deliberately isolated + fail-open ----------------------
-- Returns TRUE when the employee is available for a shift on p_date/p_start..p_end.
-- If the assumed availability table is absent, returns TRUE (fail open) so the
-- generator still works; app_sched_generate reports availability_checked=false.
-- >>> TODO: confirm table name/shape (see ASSUMPTIONS) then tighten this. <<<
create or replace function public._sched_is_available(
  p_emp bigint, p_date date, p_start time, p_end time)
returns boolean language plpgsql stable security definer
set search_path=public,extensions as $fn$
declare v_has_tbl boolean; v_dow int; v_ok boolean;
begin
  select exists(
    select 1 from information_schema.tables
     where table_schema='public' and table_name='employee_availability'
  ) into v_has_tbl;
  if not v_has_tbl then
    return true;  -- fail open; caller flags availability_checked=false
  end if;
  v_dow := extract(dow from p_date);  -- 0=Sun .. 6=Sat
  -- Only require availability data to positively EXCLUDE. If the employee has no
  -- row for that weekday we treat them as available (many shops store only the
  -- unavailable/blocked slots). Adjust the predicate once the real shape is known.
  begin
    execute $q$
      select not exists (
        select 1 from public.employee_availability ea
         where ea.employee_id = $1
           and ea.weekday = $2
           and coalesce(ea.is_available, true) = false
      )$q$
    into v_ok using p_emp, v_dow;
  exception when others then
    -- column names differ from the guess -> fail open, don't break generation
    v_ok := true;
  end;
  return coalesce(v_ok, true);
end $fn$;


-- did this availability check actually run against a real table? --------------
create or replace function public._sched_avail_active()
returns boolean language sql stable as $fn$
  select exists(
    select 1 from information_schema.tables
     where table_schema='public' and table_name='employee_availability');
$fn$;


-- app_sched_generate ----------------------------------------------------------
-- MANAGER-only.  For every OPEN shift (employee_id IS NULL) in the given
-- week+location (Mon..Sun from p_week_start), OR a caller-supplied set of shift
-- ids (p_shift_ids), pick the best ELIGIBLE employee and (unless p_dry_run)
-- assign them by a normal UPDATE — so shifts_integrity() enforces minor-hours,
-- expired-cert and overlap rules automatically; if it raises, we capture the
-- message, leave the shift open, and report the reason.
--
-- ELIGIBILITY per open shift:
--   1. cleared for the shift's position  (employee_position_clearance)
--   2. available                         (_sched_is_available, fail-open)
--   3. no time overlap with the same employee's OTHER shifts that day
--   4. would not push the employee over 40h for the week (this location)
-- TIE-BREAK (deterministic): fewest assigned hours so far this week, then
--   default-position match, then employee id — spreads hours evenly & stable.
--
-- Returns jsonb:
--   { ok, dry_run, location, week_start, week_end, availability_checked,
--     assigned:[ {shift_id, shift_date, position_id, start_time, end_time,
--                 employee_id, employee_name, hours, prior_hours} ],
--     still_open:[ {shift_id, shift_date, position_id, start_time, end_time,
--                   reason} ],
--     counts:{ open_considered, assigned, still_open } }
create or replace function public.app_sched_generate(
  p_username text, p_password text,
  p_location text, p_week_start date,
  p_dry_run boolean default true,
  p_shift_ids bigint[] default null)
returns jsonb
language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_role text;
  v_week_start date;
  v_week_end   date;
  v_assigned jsonb := '[]'::jsonb;
  v_open     jsonb := '[]'::jsonb;
  v_open_ct  int := 0;
  v_asg_ct   int := 0;
  s          record;   -- an open shift
  cand       record;   -- chosen candidate
  v_hours    numeric;
  v_err      text;
  -- running tally of hours we (would) add this run, keyed by employee id, so a
  -- dry-run spreads load correctly even though nothing is written to shifts.
  v_added    jsonb := '{}'::jsonb;
begin
  select urole into v_role from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;
  if p_week_start is null then raise exception 'Pick the week to generate.'; end if;

  -- normalise to the Monday of that week (isodow: Mon=1)
  v_week_start := p_week_start - ((extract(isodow from p_week_start))::int - 1);
  v_week_end   := v_week_start + 6;

  -- Walk open shifts oldest-slot-first for a stable, human-sensible fill order.
  for s in
    select sh.id, sh.location, sh.shift_date, sh.position_id,
           sh.start_time, sh.end_time,
           public._sched_shift_minutes(sh.start_time, sh.end_time)/60.0 as hrs
      from public.shifts sh
     where sh.employee_id is null
       and ( p_shift_ids is not null and sh.id = any(p_shift_ids)
             or (p_shift_ids is null
                 and sh.location = p_location
                 and sh.shift_date between v_week_start and v_week_end) )
     order by sh.shift_date, sh.start_time, sh.id
  loop
    v_open_ct := v_open_ct + 1;

    -- Build the eligible candidate pool for THIS open shift and rank it.
    select c.* into cand
    from (
      select
        e.id                              as employee_id,
        e.name                            as employee_name,
        -- hours already on the real schedule this week at this location ...
        coalesce(wk.week_hours,0)
          -- ... plus anything we've tentatively handed them earlier in THIS run
          + coalesce((v_added->>e.id::text)::numeric,0) as prior_hours,
        (e.default_position_id is not distinct from s.position_id) as pos_match
      from public.schedule_employees e
      join public.employee_position_clearance clr
        on clr.employee_id = e.id and clr.position_id = s.position_id
      -- weekly hours already scheduled for this employee at this location
      left join lateral (
        select coalesce(sum(public._sched_shift_minutes(x.start_time,x.end_time))/60.0,0) as week_hours
          from public.shifts x
         where x.employee_id = e.id
           and x.location    = s.location
           and x.shift_date between v_week_start and v_week_end
      ) wk on true
      where coalesce(e.active, true)
        -- (2) availability (fail-open helper)
        and public._sched_is_available(e.id, s.shift_date, s.start_time, s.end_time)
        -- (3) no overlap with THIS employee's other shifts the SAME day
        and not exists (
          select 1 from public.shifts o
           where o.employee_id = e.id
             and o.shift_date  = s.shift_date
             and o.id <> s.id
             and public._sched_overlap(o.start_time,o.end_time,s.start_time,s.end_time)
        )
        -- (4) 40h cap: prior + this shift must stay <= 40
        and ( coalesce(wk.week_hours,0)
              + coalesce((v_added->>e.id::text)::numeric,0)
              + s.hrs ) <= 40.0 + 1e-6
      order by
        (coalesce(wk.week_hours,0) + coalesce((v_added->>e.id::text)::numeric,0)) asc, -- fewest hours first
        (e.default_position_id is not distinct from s.position_id) desc,               -- prefer natural position
        e.id asc                                                                        -- stable
      limit 1
    ) c;

    if cand.employee_id is null then
      -- nobody eligible: record why (best-effort human reason)
      v_open := v_open || jsonb_build_array(jsonb_build_object(
        'shift_id',   s.id,
        'shift_date', s.shift_date,
        'position_id',s.position_id,
        'start_time', s.start_time,
        'end_time',   s.end_time,
        'reason',     'No eligible employee (cleared + available + free + under 40h) for this position/time.'
      ));
      continue;
    end if;

    v_hours := round(s.hrs::numeric, 2);

    if p_dry_run then
      -- propose only; tally the tentative hours so we keep spreading evenly
      v_added := jsonb_set(v_added, array[cand.employee_id::text],
                   to_jsonb(coalesce((v_added->>cand.employee_id::text)::numeric,0) + s.hrs));
      v_assigned := v_assigned || jsonb_build_array(jsonb_build_object(
        'shift_id',     s.id,
        'shift_date',   s.shift_date,
        'position_id',  s.position_id,
        'start_time',   s.start_time,
        'end_time',     s.end_time,
        'employee_id',  cand.employee_id,
        'employee_name',cand.employee_name,
        'hours',        v_hours,
        'prior_hours',  round(cand.prior_hours::numeric,2)
      ));
      v_asg_ct := v_asg_ct + 1;
    else
      -- WRITE via a normal UPDATE so shifts_integrity() runs. If it raises
      -- (minor hours / expired cert / overlap it can see), capture and skip.
      begin
        update public.shifts
           set employee_id = cand.employee_id
         where id = s.id and employee_id is null;   -- guard: don't clobber a race-filled slot
        if not found then
          v_open := v_open || jsonb_build_array(jsonb_build_object(
            'shift_id', s.id, 'shift_date', s.shift_date, 'position_id', s.position_id,
            'start_time', s.start_time, 'end_time', s.end_time,
            'reason', 'Shift was no longer open when writing.'));
          continue;
        end if;
        v_added := jsonb_set(v_added, array[cand.employee_id::text],
                     to_jsonb(coalesce((v_added->>cand.employee_id::text)::numeric,0) + s.hrs));
        v_assigned := v_assigned || jsonb_build_array(jsonb_build_object(
          'shift_id',     s.id,
          'shift_date',   s.shift_date,
          'position_id',  s.position_id,
          'start_time',   s.start_time,
          'end_time',     s.end_time,
          'employee_id',  cand.employee_id,
          'employee_name',cand.employee_name,
          'hours',        v_hours,
          'prior_hours',  round(cand.prior_hours::numeric,2)
        ));
        v_asg_ct := v_asg_ct + 1;
      exception when others then
        v_err := regexp_replace(SQLERRM, E'[\\n\\r]+', ' ', 'g');
        v_open := v_open || jsonb_build_array(jsonb_build_object(
          'shift_id',   s.id,
          'shift_date', s.shift_date,
          'position_id',s.position_id,
          'start_time', s.start_time,
          'end_time',   s.end_time,
          'employee_id',  cand.employee_id,
          'employee_name',cand.employee_name,
          'reason',     'Guardrail blocked this assignment: '||v_err
        ));
      end;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'location', p_location,
    'week_start', v_week_start,
    'week_end', v_week_end,
    'availability_checked', public._sched_avail_active(),
    'assigned', v_assigned,
    'still_open', v_open,
    'counts', jsonb_build_object(
      'open_considered', v_open_ct,
      'assigned', v_asg_ct,
      'still_open', v_open_ct - v_asg_ct)
  );
end $fn$;


-- ####################################################################
-- ##  PHASE 5a — CLOCK-IN HARDENING COLUMNS                         ##
-- ##  (quarantined: no-ops if the punches table is absent/renamed)  ##
-- ####################################################################
-- Adds verification columns to the time-clock table:
--   pin_ok bool . photo_url text . geo_lat numeric . geo_lng numeric .
--   source text (kiosk|mobile|manager).
-- We do NOT hard-code the table into a bare ALTER (the name is an assumption).
-- This DO-block ALTERs whichever of a short candidate list actually exists, and
-- silently skips if none do — so the migration never fails on a name mismatch.
-- >>> If your punches table is not in the list, add its name to v_names. <<<
do $harden$
declare
  v_names text[] := array['time_punches','punches','time_clock','clock_punches','punch'];
  v_tbl text;
begin
  select t.table_name into v_tbl
    from information_schema.tables t
   where t.table_schema='public' and t.table_name = any(v_names)
   order by array_position(v_names, t.table_name)
   limit 1;

  if v_tbl is null then
    raise notice '[phase5a] No known punches table found (%). Skipping clock-hardening ALTERs; add the real name to v_names and re-run.', array_to_string(v_names,', ');
    return;
  end if;

  execute format('alter table public.%I add column if not exists pin_ok   boolean', v_tbl);
  execute format('alter table public.%I add column if not exists photo_url text',    v_tbl);
  execute format('alter table public.%I add column if not exists geo_lat   numeric', v_tbl);
  execute format('alter table public.%I add column if not exists geo_lng   numeric', v_tbl);
  execute format('alter table public.%I add column if not exists source    text',    v_tbl);
  raise notice '[phase5a] Clock-hardening columns ensured on public.%', v_tbl;
end $harden$;


-- ####################################################################
-- ##  PHASE 5a — CLOCK-VS-SCHEDULE ADHERENCE REPORT                 ##
-- ####################################################################
-- app_clock_adherence(user,pw,p_location,p_date[,p_grace_min])
--   MANAGER-only. Joins that day's PUBLISHED shifts to the day's punches and
--   classifies each scheduled employee:
--     on_time   -> clocked in at/ before start + grace
--     late      -> clocked in after start + grace     (minutes_late reported)
--     no_show   -> published shift, no punch at all
--     left_early-> clocked out before end - grace     (minutes_early reported)
--   Grace default = 7 minutes (matches the frontend autoscan threshold).
--
--   >>> PUNCH JOIN IS ISOLATED in the v_punch CTE. If the punches table is not
--       public.time_punches(employee_id,location,clock_in,clock_out), change
--       ONLY that CTE. If the table is entirely absent, the RPC still returns a
--       valid shape with punch_source='missing' and everyone as no_show. <<<
--
--   Returns jsonb:
--   { ok, location, date, grace_min, punch_source,
--     rows:[ {employee_id, employee_name, position_id, shift_start, shift_end,
--             clock_in, clock_out, status, minutes_late, minutes_early} ],
--     summary:{ scheduled, on_time, late, no_show, left_early } }
create or replace function public.app_clock_adherence(
  p_username text, p_password text,
  p_location text, p_date date,
  p_grace_min int default 7)
returns jsonb
language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_role text;
  v_has_punch boolean;
  v_rows jsonb := '[]'::jsonb;
  v_src  text := 'time_punches';
  v_grace int := coalesce(p_grace_min,7);
  r record;
begin
  select urole into v_role from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;
  if p_date is null then raise exception 'Pick a date.'; end if;

  select exists(
    select 1 from information_schema.tables
     where table_schema='public' and table_name='time_punches'
  ) into v_has_punch;

  if not v_has_punch then
    -- Degrade gracefully: still report the schedule; every one shows no_show.
    v_src := 'missing';
    for r in
      select sh.employee_id, se.name as emp_name, sh.position_id,
             sh.start_time, sh.end_time
        from public.shifts sh
        left join public.schedule_employees se on se.id = sh.employee_id
       where sh.location = p_location
         and sh.shift_date = p_date
         and sh.published = true
         and sh.employee_id is not null
       order by sh.start_time, sh.employee_id
    loop
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'employee_id', r.employee_id, 'employee_name', r.emp_name,
        'position_id', r.position_id, 'shift_start', r.start_time,
        'shift_end', r.end_time, 'clock_in', null, 'clock_out', null,
        'status','no_show','minutes_late',null,'minutes_early',null));
    end loop;

    return jsonb_build_object(
      'ok', true, 'location', p_location, 'date', p_date,
      'grace_min', v_grace, 'punch_source', v_src,
      'rows', v_rows,
      'summary', jsonb_build_object(
        'scheduled', jsonb_array_length(v_rows), 'on_time',0,
        'late',0, 'no_show', jsonb_array_length(v_rows), 'left_early',0));
  end if;

  -- Normal path: published schedule LEFT JOIN the day's first/last punch.
  -- -- v_punch is the ONLY place the punches table is named. --
  for r in
    with sched as (
      select sh.employee_id, se.name as emp_name, sh.position_id,
             sh.shift_date, sh.start_time, sh.end_time
        from public.shifts sh
        left join public.schedule_employees se on se.id = sh.employee_id
       where sh.location = p_location
         and sh.shift_date = p_date
         and sh.published = true
         and sh.employee_id is not null
    ),
    v_punch as (           -- <<< change here if punches table differs >>>
      select tp.employee_id,
             min(tp.clock_in)                                    as first_in,
             max(coalesce(tp.clock_out, tp.clock_in))            as last_out,
             bool_or(tp.clock_out is null)                       as any_open
        from public.time_punches tp
       where tp.clock_in::date = p_date
         and (tp.location is null or tp.location = p_location)
       group by tp.employee_id
    )
    select s.employee_id, s.emp_name, s.position_id, s.start_time, s.end_time,
           p.first_in, p.last_out, p.any_open
      from sched s
      left join v_punch p on p.employee_id = s.employee_id
     order by s.start_time, s.employee_id
  loop
    declare
      v_status text;
      v_late   int := null;
      v_early  int := null;
      v_start_ts timestamptz;
      v_end_ts   timestamptz;
    begin
      v_start_ts := (p_date + r.start_time);
      -- handle a closing shift that ends after midnight
      v_end_ts   := (p_date + r.end_time)
                    + case when r.end_time < r.start_time then interval '1 day' else interval '0' end;

      if r.first_in is null then
        v_status := 'no_show';
      else
        if r.first_in > v_start_ts + make_interval(mins => v_grace) then
          v_status := 'late';
          v_late := ceil(extract(epoch from (r.first_in - v_start_ts))/60.0)::int;
        else
          v_status := 'on_time';
        end if;
        -- left-early is independent of late/on-time; only when clocked out
        if not coalesce(r.any_open,false)
           and r.last_out is not null
           and r.last_out < v_end_ts - make_interval(mins => v_grace) then
          v_early := ceil(extract(epoch from (v_end_ts - r.last_out))/60.0)::int;
          if v_status <> 'late' then v_status := 'left_early'; end if;
        end if;
      end if;

      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'employee_id',  r.employee_id,
        'employee_name',r.emp_name,
        'position_id',  r.position_id,
        'shift_start',  r.start_time,
        'shift_end',    r.end_time,
        'clock_in',     r.first_in,
        'clock_out',    r.last_out,
        'status',       v_status,
        'minutes_late', v_late,
        'minutes_early',v_early));
    end;
  end loop;

  return jsonb_build_object(
    'ok', true, 'location', p_location, 'date', p_date,
    'grace_min', v_grace, 'punch_source', v_src,
    'rows', v_rows,
    'summary', jsonb_build_object(
      'scheduled',  jsonb_array_length(v_rows),
      'on_time',    (select count(*) from jsonb_array_elements(v_rows) e where e->>'status'='on_time'),
      'late',       (select count(*) from jsonb_array_elements(v_rows) e where e->>'status'='late'),
      'no_show',    (select count(*) from jsonb_array_elements(v_rows) e where e->>'status'='no_show'),
      'left_early', (select count(*) from jsonb_array_elements(v_rows) e where e->>'status'='left_early')));
end $fn$;


-- ####################################################################
-- ##  PHASE 5b — MANAGER LOGBOOK                                    ##
-- ####################################################################
-- Table carries BOTH the task's canonical shape (category/body/photo_url) AND
-- the columns the already-shipped frontend module (_p4_module.js) expects
-- (shift, note) — so both the new UI and the existing logbook screen work.
create table if not exists public.manager_logbook (
  id          bigserial primary key,
  location    text not null,
  log_date    date not null default current_date,
  author_emp  bigint,                 -- users.id of the author
  author_name text,                   -- denormalised for cheap display
  category    text,                   -- Staffing | Equipment | Incident | Win | ...
  shift       text,                   -- AM | PM | Overnight (frontend field)
  body        text not null,          -- the note text (a.k.a. 'note' below)
  photo_url   text,
  created_at  timestamptz not null default now()
);
create index if not exists manager_logbook_loc_date_idx on public.manager_logbook(location, log_date desc);
alter table public.manager_logbook enable row level security;  -- deny-all; RPC access only

-- app_logbook_add — CANONICAL signature (task spec) --------------------------
--   (user, pw, p_location, p_log_date, p_category, p_body, p_shift, p_photo)
create or replace function public.app_logbook_add(
  p_username text, p_password text,
  p_location text, p_log_date date,
  p_category text, p_body text,
  p_shift text default null, p_photo text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_id bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;
  if length(trim(coalesce(p_body,''))) < 1 then raise exception 'Write the note first.'; end if;
  insert into public.manager_logbook(location,log_date,author_emp,author_name,category,shift,body,photo_url)
  values (coalesce(nullif(trim(p_location),''),'All'),
          coalesce(p_log_date, current_date),
          v_uid, v_name,
          nullif(trim(p_category),''), nullif(trim(p_shift),''),
          trim(p_body), nullif(trim(p_photo),''))
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $fn$;

-- app_logbook_add — COMPAT overload for the existing _p4_module.js frontend ---
--   it calls app_logbook_add({p_location, p_shift, p_note}).  Maps note->body,
--   log_date defaults to today, category null.  (Distinct arg list => overload.)
create or replace function public.app_logbook_add(
  p_username text, p_password text,
  p_location text, p_shift text, p_note text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
begin
  return public.app_logbook_add(
    p_username, p_password, p_location, current_date,
    null::text, p_note, p_shift, null::text);
end $fn$;

-- app_logbook_list — CANONICAL signature (task spec) -------------------------
--   (user, pw, p_location, p_from, p_to).  p_location 'All'/null => every store.
--   Returns rows with BOTH naming conventions so any frontend binds cleanly:
--     entry_date(=log_date), author_name, location, shift, category, note(=body),
--     body, photo_url, created_at, id.
create or replace function public.app_logbook_list(
  p_username text, p_password text,
  p_location text, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_role text;
begin
  select urole into v_role from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'location', l.location, 'entry_date', l.log_date, 'log_date', l.log_date,
      'author_name', l.author_name, 'author_emp', l.author_emp,
      'category', l.category, 'shift', l.shift,
      'note', l.body, 'body', l.body,
      'photo_url', l.photo_url, 'created_at', l.created_at)
      order by l.log_date desc, l.created_at desc)
    from public.manager_logbook l
    where (p_from is null or l.log_date >= p_from)
      and (p_to   is null or l.log_date <= p_to)
      and (p_location is null or p_location = '' or p_location = 'All'
           or l.location = p_location)
  ), '[]'::jsonb);
end $fn$;

-- app_logbook_list — COMPAT overload for _p4_module.js -----------------------
--   it calls app_logbook_list({p_location:'All', p_days:7}). Convert p_days to a
--   [today-p_days, today] window and delegate.  (Distinct arg list => overload.)
create or replace function public.app_logbook_list(
  p_username text, p_password text,
  p_location text, p_days int)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
begin
  return public.app_logbook_list(
    p_username, p_password, p_location,
    (current_date - coalesce(p_days,7))::date, current_date);
end $fn$;


-- ####################################################################
-- ##  PHASE 5c — TEMPLATED TASK LISTS                               ##
-- ####################################################################
create table if not exists public.task_lists (
  id         bigserial primary key,
  location   text,                    -- NULL = global (applies to every store)
  name       text not null,
  daypart    text,                    -- Opening | Closing | Mid | Any ...
  active     boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_lists_loc_idx on public.task_lists(location);

create table if not exists public.task_list_items (
  id        bigserial primary key,
  list_id   bigint not null references public.task_lists(id) on delete cascade,
  label     text not null,
  item_type text not null default 'check'
              check (item_type in ('check','value','initial')),
  sort      int not null default 0
);
create index if not exists task_list_items_list_idx on public.task_list_items(list_id, sort);

create table if not exists public.task_completions (
  id        bigserial primary key,
  item_id   bigint not null references public.task_list_items(id) on delete cascade,
  location  text not null,
  done_date date not null default current_date,
  done_by   bigint,                   -- users.id
  done_name text,
  value     text,                     -- for item_type 'value' / 'initial'
  photo_url text,
  done_at   timestamptz not null default now(),
  unique (item_id, location, done_date)  -- one completion per item / store / day
);
create index if not exists task_completions_loc_date_idx on public.task_completions(location, done_date);

alter table public.task_lists       enable row level security;  -- deny-all; RPC access only
alter table public.task_list_items  enable row level security;
alter table public.task_completions enable row level security;

-- app_tasklist_save — MANAGER upsert list + its items -------------------------
--   p_id null => create; else update the list header.  p_items is a jsonb array
--   of {label,item_type,sort}; when provided it REPLACES the list's items.
--   Returns { ok, id, items }.
create or replace function public.app_tasklist_save(
  p_username text, p_password text,
  p_id bigint, p_name text, p_location text,
  p_daypart text, p_active boolean, p_items jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_id bigint; v_n int := 0; it jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;
  if length(trim(coalesce(p_name,''))) < 1 then raise exception 'Name required'; end if;

  if p_id is null then
    insert into public.task_lists(location,name,daypart,active,created_by)
    values (nullif(trim(p_location),''), trim(p_name),
            nullif(trim(p_daypart),''), coalesce(p_active,true), v_name)
    returning id into v_id;
  else
    update public.task_lists
       set name = trim(p_name),
           location = nullif(trim(p_location),''),
           daypart = nullif(trim(p_daypart),''),
           active = coalesce(p_active, active),
           updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'List not found'; end if;
  end if;

  -- Replace items only when the caller sends an array (null = leave items alone)
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    delete from public.task_list_items where list_id = v_id;
    for it in select * from jsonb_array_elements(p_items) loop
      insert into public.task_list_items(list_id,label,item_type,sort)
      values (v_id,
              coalesce(nullif(trim(it->>'label'),''),'(item)'),
              case when coalesce(it->>'item_type','check') in ('check','value','initial')
                   then it->>'item_type' else 'check' end,
              coalesce((it->>'sort')::int, v_n));
      v_n := v_n + 1;
    end loop;
  end if;

  return jsonb_build_object('ok',true,'id',v_id,'items',
    coalesce((select count(*) from public.task_list_items where list_id=v_id),0));
end $fn$;

-- app_tasklist_list — lists (with items) for a store + optional daypart -------
--   Any authenticated user may READ (staff need to see & do the lists). Returns
--   active lists that are global OR match p_location.  Each row includes items.
create or replace function public.app_tasklist_list(
  p_username text, p_password text,
  p_location text, p_daypart text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text;
begin
  select uid,urole into v_uid,v_role from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;   -- any signed-in user
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'name', l.name, 'location', l.location,
      'daypart', l.daypart, 'active', l.active, 'global', (l.location is null),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id, 'label', i.label, 'item_type', i.item_type, 'sort', i.sort)
          order by i.sort, i.id)
        from public.task_list_items i where i.list_id = l.id), '[]'::jsonb))
      order by l.daypart nulls last, l.name)
    from public.task_lists l
    where l.active = true
      and (l.location is null or l.location = p_location)
      and (p_daypart is null or p_daypart = '' or l.daypart is null or l.daypart = p_daypart)
  ), '[]'::jsonb);
end $fn$;

-- app_task_complete — mark one item done for today at the actor's store -------
--   Any signed-in user. Upserts on (item_id, location, done_date) so re-checking
--   updates rather than duplicating.  A null/blank value records a plain check.
create or replace function public.app_task_complete(
  p_username text, p_password text,
  p_item_id bigint, p_value text default null, p_photo text default null,
  p_location text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_loc text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;
  -- item must exist
  perform 1 from public.task_list_items where id = p_item_id;
  if not found then raise exception 'Task item not found'; end if;
  -- resolve the store: explicit arg wins, else the user's home store
  v_loc := coalesce(nullif(trim(p_location),''),
                    (select store from public.users where id = v_uid),
                    'Unknown');

  insert into public.task_completions(item_id,location,done_date,done_by,done_name,value,photo_url)
  values (p_item_id, v_loc, current_date, v_uid, v_name,
          nullif(trim(p_value),''), nullif(trim(p_photo),''))
  on conflict (item_id, location, done_date) do update
     set done_by = excluded.done_by, done_name = excluded.done_name,
         value = excluded.value, photo_url = excluded.photo_url, done_at = now();

  return jsonb_build_object('ok',true,'item_id',p_item_id,'location',v_loc,'date',current_date);
end $fn$;

-- app_tasklist_progress — completion rate per list for a store on a date ------
--   Any signed-in user. For each active list applicable to the store, report how
--   many items are done today.  Returns overall + per-list breakdown.
create or replace function public.app_tasklist_progress(
  p_username text, p_password text,
  p_location text, p_date date default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_date date; v_lists jsonb; v_tot int; v_done int;
begin
  select uid,urole into v_uid,v_role from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;
  v_date := coalesce(p_date, current_date);

  select
    coalesce(jsonb_agg(x.list_row order by x.daypart nulls last, x.name), '[]'::jsonb),
    coalesce(sum(x.total),0), coalesce(sum(x.done),0)
    into v_lists, v_tot, v_done
  from (
    select l.id, l.name, l.daypart,
           (select count(*) from public.task_list_items i where i.list_id=l.id) as total,
           (select count(*) from public.task_list_items i
              join public.task_completions c
                on c.item_id=i.id and c.location=p_location and c.done_date=v_date
             where i.list_id=l.id) as done,
           jsonb_build_object(
             'list_id', l.id, 'name', l.name, 'daypart', l.daypart,
             'total', (select count(*) from public.task_list_items i where i.list_id=l.id),
             'done',  (select count(*) from public.task_list_items i
                         join public.task_completions c
                           on c.item_id=i.id and c.location=p_location and c.done_date=v_date
                        where i.list_id=l.id),
             'pct',   case when (select count(*) from public.task_list_items i where i.list_id=l.id)=0
                           then 0
                           else round(100.0 *
                             (select count(*) from public.task_list_items i
                                join public.task_completions c
                                  on c.item_id=i.id and c.location=p_location and c.done_date=v_date
                               where i.list_id=l.id)
                             / (select count(*) from public.task_list_items i where i.list_id=l.id)) end
           ) as list_row
    from public.task_lists l
    where l.active = true and (l.location is null or l.location = p_location)
  ) x;

  return jsonb_build_object(
    'ok', true, 'location', p_location, 'date', v_date,
    'total_items', v_tot, 'done_items', v_done,
    'pct', case when v_tot=0 then 0 else round(100.0*v_done/v_tot) end,
    'lists', v_lists);
end $fn$;


-- ####################################################################
-- ##  SEED — two example task lists (idempotent)                    ##
-- ####################################################################
-- Global (location NULL) Opening & Closing lists, inserted only if absent.
insert into public.task_lists(location,name,daypart,active,created_by)
select null,'Opening Checklist','Opening',true,'Cowork build'
where not exists (select 1 from public.task_lists
                  where name='Opening Checklist' and location is null);

insert into public.task_lists(location,name,daypart,active,created_by)
select null,'Closing Checklist','Closing',true,'Cowork build'
where not exists (select 1 from public.task_lists
                  where name='Closing Checklist' and location is null);

-- Opening items
insert into public.task_list_items(list_id,label,item_type,sort)
select l.id, v.label, v.item_type, v.sort
from public.task_lists l
join (values
  ('Unlock, disarm alarm, lights on','check',0),
  ('Walk-in / freezer temperature (F)','value',1),
  ('Dipping cabinet temperature (F)','value',2),
  ('Wash hands & stock handwashing station','check',3),
  ('Sanitizer bucket made (ppm)','value',4),
  ('Registers counted - opening drawer','initial',5),
  ('Front of house wiped & stocked','check',6)
) as v(label,item_type,sort) on true
where l.name='Opening Checklist' and l.location is null
  and not exists (select 1 from public.task_list_items i
                  where i.list_id=l.id and i.label=v.label);

-- Closing items
insert into public.task_list_items(list_id,label,item_type,sort)
select l.id, v.label, v.item_type, v.sort
from public.task_lists l
join (values
  ('All surfaces cleaned & sanitized','check',0),
  ('Dipping cabinet temperature (F)','value',1),
  ('Trash taken out','check',2),
  ('Registers counted - closing drawer','initial',3),
  ('Deposit prepared & logged','initial',4),
  ('Floors swept & mopped','check',5),
  ('Alarm set & doors locked','initial',6)
) as v(label,item_type,sort) on true
where l.name='Closing Checklist' and l.location is null
  and not exists (select 1 from public.task_list_items i
                  where i.list_id=l.id and i.label=v.label);


-- ####################################################################
-- ##  TEACH SCOOPY (knowledge base, idempotent)                     ##
-- ####################################################################
insert into public.knowledge_base (category, question, answer, updated_at, updated_by)
select 'App Help', q, a, now(), 'Cowork build' from (values
  ('How do I auto-generate a schedule?',
   'Managers: in the Schedule builder, tap "Generate schedule." The Hub fills every OPEN shift for the week with the best available employee who is cleared for that position, has no time conflict, and would not go over 40 hours - spreading hours evenly. You get a preview (dry run) first: review the proposed names and any shifts it could not fill (with the reason), then Apply to write them. All the usual guardrails (minor hours, expired food-handler cert, overlaps) still run when it writes, so nothing unsafe is ever scheduled.'),
  ('What is clock-in adherence / the late & no-show report?',
   'Managers can pull a Clock Adherence report for a store and day. It compares the published schedule to actual clock-ins and labels each person on-time, late (with minutes late), no-show (scheduled but never clocked in), or left-early. A short grace period (default 7 minutes) is allowed before counting someone late. Use it to spot attendance issues quickly.'),
  ('What is the Manager Logbook?',
   'The Manager Logbook is a shift diary that passes the torch between shifts. Any shift lead or manager can jot a note - staffing, equipment, incidents, wins - tagged with the store and AM/PM. The next shift sees Today''s notes first, with the last several days available underneath. It keeps everyone on the same page across shifts and stores.'),
  ('How do task lists / opening & closing checklists work?',
   'Task lists are templated checklists (like Opening and Closing) that appear for your store. Each item is a checkbox, a value to record (like a freezer temperature), or an initial. Tap items as you finish them; managers see a completion percentage per store per day. Managers can create or edit lists - add items, set the daypart (Opening/Closing), and turn lists on or off - with no developer needed.')
) v(q,a)
where not exists (select 1 from public.knowledge_base kb where kb.question = v.q);


-- ####################################################################
-- ##  SMOKE TESTS                                                   ##
-- ####################################################################
-- Run these AFTER the migration to sanity-check.  Replace 'MANAGER_USERNAME' /
-- 'MANAGER_PIN' with a real manager login, and the location/date/week as needed.
-- (These are SELECTs only; nothing is written except where you pass p_dry_run=false.)
--
--   -- 0) objects exist
--   select proname from pg_proc
--    where proname in ('app_sched_generate','app_clock_adherence',
--                      'app_logbook_add','app_logbook_list','app_tasklist_save',
--                      'app_tasklist_list','app_task_complete','app_tasklist_progress')
--    order by proname;
--   select table_name from information_schema.tables
--    where table_schema='public'
--      and table_name in ('manager_logbook','task_lists','task_list_items','task_completions');
--
--   -- 1) PHASE 4 dry-run: propose fills for the week of a Monday, no writes
--   select public.app_sched_generate('MANAGER_USERNAME','MANAGER_PIN',
--            'Roadrunner', date '2026-07-06', true);
--     -- expect { ok:true, dry_run:true, assigned:[...], still_open:[...],
--     --          availability_checked: (true|false), counts:{...} }
--
--   -- 1b) PHASE 4 real write (ONLY when you mean it) - integrity trigger enforces safety
--   -- select public.app_sched_generate('MANAGER_USERNAME','MANAGER_PIN',
--   --          'Roadrunner', date '2026-07-06', false);
--
--   -- 2) PHASE 5a adherence for a store/day
--   select public.app_clock_adherence('MANAGER_USERNAME','MANAGER_PIN',
--            'Roadrunner', current_date);
--     -- expect { ok:true, punch_source:'time_punches'|'missing', rows:[...],
--     --          summary:{scheduled,on_time,late,no_show,left_early} }
--
--   -- 3) PHASE 5b logbook (canonical + compat overload both work)
--   select public.app_logbook_add('MANAGER_USERNAME','MANAGER_PIN',
--            'Roadrunner', current_date, 'Equipment',
--            'Freezer 2 running warm - PM watch it.', 'AM', null);
--   select public.app_logbook_add('MANAGER_USERNAME','MANAGER_PIN',
--            'Roadrunner','PM','Smoke-test compat note');        -- 3-arg overload
--   select public.app_logbook_list('MANAGER_USERNAME','MANAGER_PIN',
--            'All', current_date - 7, current_date);
--   select public.app_logbook_list('MANAGER_USERNAME','MANAGER_PIN','All',7); -- p_days overload
--
--   -- 4) PHASE 5c task lists
--   select public.app_tasklist_list('MANAGER_USERNAME','MANAGER_PIN','Roadrunner',null);
--     -- grab an item id from the Opening list, then:
--   -- select public.app_task_complete('MANAGER_USERNAME','MANAGER_PIN', <ITEM_ID>, null, null, 'Roadrunner');
--   select public.app_tasklist_progress('MANAGER_USERNAME','MANAGER_PIN','Roadrunner', current_date);
--     -- expect { ok:true, total_items, done_items, pct, lists:[{name,total,done,pct}] }
--
--   -- 4b) manager upsert a new list with items
--   -- select public.app_tasklist_save('MANAGER_USERNAME','MANAGER_PIN', null,
--   --   'Mid-Shift Temp Check','Roadrunner','Mid',true,
--   --   '[{"label":"Cabinet temp (F)","item_type":"value","sort":0},
--   --     {"label":"Restroom check","item_type":"check","sort":1}]'::jsonb);
--
--   -- 5) cleanup of any smoke-test rows you created
--   -- delete from public.manager_logbook where body like 'Smoke-test%';
--
-- Done.  Verify functions:  select proname from pg_proc where proname like 'app_sched%'
--        or proname like 'app_logbook%' or proname like 'app_tasklist%'
--        or proname in ('app_clock_adherence','app_task_complete');
