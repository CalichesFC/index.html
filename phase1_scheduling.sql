-- ============================================================================
-- Caliche's Hub — PHASE 1 SCHEDULING BACKEND   (additive, idempotent)
-- Open-shift marketplace (release / pick-up / swap + manager approval),
-- shift reminders + no-show scan (called by a scheduled task later), and
-- PTO balances. Run in Supabase SQL editor (proj ikgbihwkqhsfahnswfbz).
--
-- STYLE: mirrors catering_module.sql / preventive_maintenance.sql —
--   * every RPC is SECURITY DEFINER, set search_path=public,extensions
--   * app-facing RPCs take (p_username text, p_password text, ...) and
--     authenticate via public._pm_auth(p_username,p_password) which returns
--     table(uid bigint, urole text, uname text). Raise 'Not authorized' on no row.
--   * ADDITIVE ONLY. New tables get RLS enabled with NO policies (deny-all);
--     all access is through the SECURITY DEFINER RPCs below. Never reads or
--     rewrites existing app_sched_*/app_* RPCs.
--   * push_enqueue(p_emp bigint, p_title text, p_body text, p_url text, p_type text)
--     is wrapped in BEGIN/EXCEPTION so a notification can NEVER block a write.
--
-- BUILDS ON (pre-existing objects, created directly in Supabase — NOT here):
--   shifts(id bigint, location text, shift_date date, employee_id bigint NULL=open,
--          position_id, start_time time, end_time time, note, published bool,
--          created_by, created_at)  -- trigger shifts_integrity() enforces
--          no-overlap / duration / minor-hours; our assigns go through normal
--          UPDATE so that trigger fires and its error is surfaced to the caller.
--   schedule_employees(id, name, home_location, linked_username, hourly_wage,
--          phone, default_position_id, food_handler_expires)
--   employee_position_clearance(employee_id, position_id)
--   users(id, username, role, store)   -- a logged-in employee maps to
--          schedule_employees via linked_username = users.username
--   schedule_positions(id, name, color)
--   time_punches(...)  -- ASSUMED NAME (see NOTE ON PUNCHES below)
--
-- NOTE ON PUNCHES: the punches table is not defined in any migration file in
--   this repo (it was created directly in Supabase). Frontend + existing RPCs
--   (app_clock_in / app_clock_out / app_open_punches / app_attendance_autoscan)
--   show the columns are: employee_id, location, clock_in (timestamptz),
--   clock_out (timestamptz). This module ASSUMES the table is public.time_punches
--   with those columns. If the real name/columns differ, the ONLY place to fix
--   is the helper public._sched_has_punch() below — every no-show path routes
--   through it, so a one-line edit re-points the whole feature.
-- ============================================================================


-- ============================================================================
-- 0) HELPERS
-- ============================================================================

-- manager role check (matches catering _cat_mgr) ------------------------------
create or replace function public._sched_mgr(p_role text)
returns boolean language sql immutable as $fn$
  select p_role in ('Manager','Admin Manager','Vice President/Co-Owner','Store Manager');
$fn$;

-- resolve the caller's schedule_employees.id from their username --------------
-- (a logged-in employee links to the roster via linked_username = users.username)
create or replace function public._sched_emp_id(p_username text)
returns bigint language sql stable set search_path=public,extensions as $fn$
  select se.id from public.schedule_employees se
  where se.linked_username = p_username
  order by se.id limit 1;
$fn$;

-- is an employee cleared for a position? --------------------------------------
create or replace function public._sched_cleared(p_emp bigint, p_position bigint)
returns boolean language sql stable set search_path=public,extensions as $fn$
  select p_position is null
      or exists(select 1 from public.employee_position_clearance c
                where c.employee_id = p_emp and c.position_id = p_position);
$fn$;

-- would taking this shift overlap a shift the employee already has? -----------
-- (time-of-day overlap on the same calendar date; excludes the shift itself)
create or replace function public._sched_overlaps(p_emp bigint, p_shift_id bigint)
returns boolean language sql stable set search_path=public,extensions as $fn$
  select exists(
    select 1
    from public.shifts s          -- the shift being considered
    join public.shifts o          -- the employee's other shifts, same day
      on o.shift_date = s.shift_date
     and o.employee_id = p_emp
     and o.id <> s.id
     and o.start_time < s.end_time
     and s.start_time < o.end_time
    where s.id = p_shift_id
  );
$fn$;

-- does the employee have a clock-in punch overlapping a shift window? ---------
-- >>> THE ONE PLACE TO FIX IF THE PUNCHES TABLE NAME/COLUMNS DIFFER <<<
-- Returns true if there is any punch for that employee on the shift's date
-- whose clock_in falls on/after (shift_date + start_time). Used by no-show scan.
create or replace function public._sched_has_punch(
  p_emp bigint, p_shift_date date, p_start time, p_grace_min int)
returns boolean language plpgsql stable set search_path=public,extensions as $fn$
declare v_has boolean := false;
begin
  begin
    select exists(
      select 1 from public.time_punches tp
      where tp.employee_id = p_emp
        and tp.clock_in >= (p_shift_date + p_start)
        and tp.clock_in <= (p_shift_date + p_start) + make_interval(mins => greatest(0,coalesce(p_grace_min,15)))
    ) into v_has;
  exception when others then
    -- table/columns not as assumed -> treat as "cannot confirm punch"
    -- (returns false so the scan still runs; fix the query above to enable).
    v_has := false;
  end;
  return v_has;
end $fn$;


-- ============================================================================
-- 1) OPEN-SHIFT MARKETPLACE — tables
-- ============================================================================

-- an offer to give away / swap an ASSIGNED shift ------------------------------
create table if not exists public.shift_offers (
  id                 bigserial primary key,
  shift_id           bigint not null references public.shifts(id) on delete cascade,
  offered_by         bigint not null,                 -- schedule_employees.id (current owner)
  offer_type         text   not null default 'release'
                       check (offer_type in ('release','swap')),
  target_employee_id bigint,                           -- swap: the specific coworker; release: null
  claimed_by         bigint,                           -- who requested to pick up a released offer
  status             text   not null default 'open'
                       check (status in ('open','accepted','approved','denied','cancelled')),
  created_at         timestamptz not null default now(),
  decided_by         bigint,                           -- manager users.id
  decided_at         timestamptz
);
create index if not exists shift_offers_shift_idx  on public.shift_offers(shift_id);
create index if not exists shift_offers_status_idx on public.shift_offers(status);
alter table public.shift_offers enable row level security;  -- deny-all; RPCs only

-- a claim on an OPEN shift (employee_id is null on the shift) ------------------
create table if not exists public.shift_claims (
  id           bigserial primary key,
  shift_id     bigint not null references public.shifts(id) on delete cascade,
  employee_id  bigint not null,                        -- schedule_employees.id (claimant)
  status       text   not null default 'pending'
                 check (status in ('pending','approved','denied')),
  created_at   timestamptz not null default now(),
  decided_by   bigint,
  decided_at   timestamptz
);
create index if not exists shift_claims_shift_idx  on public.shift_claims(shift_id);
create index if not exists shift_claims_status_idx on public.shift_claims(status);
alter table public.shift_claims enable row level security;  -- deny-all; RPCs only

-- idempotent reminder marker on shifts (added, never dropped) ------------------
alter table public.shifts add column if not exists reminder_sent boolean not null default false;


-- ============================================================================
-- 2) OPEN-SHIFT MARKETPLACE — employee RPCs
-- ============================================================================

-- app_openshift_list : OPEN shifts (unassigned + published) the caller is
-- ELIGIBLE for — cleared for the position, and no overlap with their own shifts.
create or replace function public.app_openshift_list(
  p_username text, p_password text, p_location text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_emp bigint;
begin
  select uid into v_uid from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;
  v_emp := public._sched_emp_id(p_username);
  if v_emp is null then
    -- caller has no roster link -> nothing they can pick up
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',            s.id,
      'location',      s.location,
      'shift_date',    s.shift_date,
      'start_time',    s.start_time,
      'end_time',      s.end_time,
      'position_id',   s.position_id,
      'position_name', p.name,
      'position_color',p.color,
      'note',          s.note,
      'already_claimed', exists(select 1 from public.shift_claims c
                                where c.shift_id = s.id and c.employee_id = v_emp
                                  and c.status = 'pending')
    ) order by s.shift_date asc, s.start_time asc)
    from public.shifts s
    left join public.schedule_positions p on p.id = s.position_id
    where s.employee_id is null
      and s.published = true
      and s.shift_date >= current_date
      and (p_location is null or s.location = p_location)
      and public._sched_cleared(v_emp, s.position_id)
      and not public._sched_overlaps(v_emp, s.id)
  ), '[]'::jsonb);
end $fn$;

-- app_openshift_claim : caller requests to take an OPEN shift (pending claim) --
create or replace function public.app_openshift_claim(
  p_username text, p_password text, p_shift_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_emp bigint; v_shift public.shifts; v_id bigint;
begin
  select uid into v_uid from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;
  v_emp := public._sched_emp_id(p_username);
  if v_emp is null then raise exception 'You are not linked to the roster yet — ask a manager.'; end if;
  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift.id is null then raise exception 'Shift not found'; end if;
  if v_shift.employee_id is not null then raise exception 'That shift is already assigned.'; end if;
  if not coalesce(v_shift.published,false) then raise exception 'That shift is not published yet.'; end if;
  if not public._sched_cleared(v_emp, v_shift.position_id) then
    raise exception 'You are not cleared for that position yet.'; end if;
  if public._sched_overlaps(v_emp, v_shift.id) then
    raise exception 'That overlaps a shift you already have.'; end if;
  -- block a duplicate pending claim by the same person
  if exists(select 1 from public.shift_claims c
            where c.shift_id = p_shift_id and c.employee_id = v_emp and c.status = 'pending') then
    raise exception 'You already have a pending request for this shift.'; end if;
  insert into public.shift_claims(shift_id, employee_id, status)
  values (p_shift_id, v_emp, 'pending') returning id into v_id;
  -- notify managers of that store (never blocks)
  begin
    perform public.push_enqueue(u.id, '🙋 Open-shift request',
      (select name from public.schedule_employees where id=v_emp)||' wants the '||
      to_char(v_shift.shift_date,'Mon DD')||' '||to_char(v_shift.start_time,'HH12:MIam')||' shift at '||
      coalesce(v_shift.location,'?')||'.', '', 'schedule_open_shift')
    from public.users u
    where public._sched_mgr(u.role) and (u.store = v_shift.location or u.store is null);
  exception when others then null; end;
  return jsonb_build_object('ok',true,'claim_id',v_id);
end $fn$;

-- app_shift_release : caller offers THEIR OWN assigned shift to the pool -------
create or replace function public.app_shift_release(
  p_username text, p_password text, p_shift_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_emp bigint; v_shift public.shifts; v_id bigint;
begin
  select uid into v_uid from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;
  v_emp := public._sched_emp_id(p_username);
  if v_emp is null then raise exception 'You are not linked to the roster yet — ask a manager.'; end if;
  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift.id is null then raise exception 'Shift not found'; end if;
  if v_shift.employee_id is distinct from v_emp then
    raise exception 'You can only release your own shift.'; end if;
  if exists(select 1 from public.shift_offers o
            where o.shift_id = p_shift_id and o.status in ('open','accepted')) then
    raise exception 'This shift is already offered.'; end if;
  insert into public.shift_offers(shift_id, offered_by, offer_type, status)
  values (p_shift_id, v_emp, 'release', 'open') returning id into v_id;
  -- notify managers so they know coverage may be needed (never blocks)
  begin
    perform public.push_enqueue(u.id, '📤 Shift released',
      (select name from public.schedule_employees where id=v_emp)||' released their '||
      to_char(v_shift.shift_date,'Mon DD')||' shift at '||coalesce(v_shift.location,'?')||
      ' — pending a pick-up.', '', 'schedule_release')
    from public.users u
    where public._sched_mgr(u.role) and (u.store = v_shift.location or u.store is null);
  exception when others then null; end;
  return jsonb_build_object('ok',true,'offer_id',v_id);
end $fn$;

-- app_offer_pickup : an eligible peer requests to take a RELEASED shift --------
create or replace function public.app_offer_pickup(
  p_username text, p_password text, p_offer_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_emp bigint; v_offer public.shift_offers; v_shift public.shifts;
begin
  select uid into v_uid from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;
  v_emp := public._sched_emp_id(p_username);
  if v_emp is null then raise exception 'You are not linked to the roster yet — ask a manager.'; end if;
  select * into v_offer from public.shift_offers where id = p_offer_id;
  if v_offer.id is null then raise exception 'Offer not found'; end if;
  if v_offer.status <> 'open' then raise exception 'That offer is no longer open.'; end if;
  if v_offer.offer_type <> 'release' then raise exception 'That is a swap offer, not an open release.'; end if;
  if v_offer.offered_by = v_emp then raise exception 'You released this shift — you cannot pick it up.'; end if;
  select * into v_shift from public.shifts where id = v_offer.shift_id;
  if v_shift.id is null then raise exception 'Shift no longer exists'; end if;
  if not public._sched_cleared(v_emp, v_shift.position_id) then
    raise exception 'You are not cleared for that position yet.'; end if;
  if public._sched_overlaps(v_emp, v_shift.id) then
    raise exception 'That overlaps a shift you already have.'; end if;
  -- mark this pick-up request; a manager approves it via app_offer_decide
  update public.shift_offers
     set claimed_by = v_emp, status = 'accepted'
   where id = p_offer_id;
  begin
    perform public.push_enqueue(u.id, '🤝 Pick-up requested',
      (select name from public.schedule_employees where id=v_emp)||' wants to cover the '||
      to_char(v_shift.shift_date,'Mon DD')||' shift at '||coalesce(v_shift.location,'?')||
      ' — needs your approval.', '', 'schedule_pickup')
    from public.users u
    where public._sched_mgr(u.role) and (u.store = v_shift.location or u.store is null);
  exception when others then null; end;
  return jsonb_build_object('ok',true,'offer_id',p_offer_id);
end $fn$;

-- app_swap_offer : offer a SPECIFIC shift to a SPECIFIC coworker ---------------
create or replace function public.app_swap_offer(
  p_username text, p_password text, p_shift_id bigint, p_target_emp bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_emp bigint; v_shift public.shifts; v_id bigint; v_tuser bigint;
begin
  select uid into v_uid from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;
  v_emp := public._sched_emp_id(p_username);
  if v_emp is null then raise exception 'You are not linked to the roster yet — ask a manager.'; end if;
  if p_target_emp is null or p_target_emp = v_emp then
    raise exception 'Pick a coworker to offer the shift to.'; end if;
  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift.id is null then raise exception 'Shift not found'; end if;
  if v_shift.employee_id is distinct from v_emp then
    raise exception 'You can only offer your own shift.'; end if;
  if not public._sched_cleared(p_target_emp, v_shift.position_id) then
    raise exception 'That coworker is not cleared for this position.'; end if;
  if public._sched_overlaps(p_target_emp, v_shift.id) then
    raise exception 'That coworker already has an overlapping shift.'; end if;
  if exists(select 1 from public.shift_offers o
            where o.shift_id = p_shift_id and o.status in ('open','accepted')) then
    raise exception 'This shift is already offered.'; end if;
  insert into public.shift_offers(shift_id, offered_by, offer_type, target_employee_id, claimed_by, status)
  values (p_shift_id, v_emp, 'swap', p_target_emp, p_target_emp, 'accepted')
  returning id into v_id;
  -- notify the targeted coworker (if they have a linked login) + managers
  begin
    select u.id into v_tuser from public.users u
     join public.schedule_employees se on se.linked_username = u.username
     where se.id = p_target_emp limit 1;
    if v_tuser is not null then
      perform public.push_enqueue(v_tuser, '🔁 Shift offered to you',
        (select name from public.schedule_employees where id=v_emp)||' offered you the '||
        to_char(v_shift.shift_date,'Mon DD')||' shift at '||coalesce(v_shift.location,'?')||
        '. A manager will confirm.', '', 'schedule_swap');
    end if;
    perform public.push_enqueue(u.id, '🔁 Swap needs approval',
      (select name from public.schedule_employees where id=v_emp)||' → '||
      (select name from public.schedule_employees where id=p_target_emp)||' for the '||
      to_char(v_shift.shift_date,'Mon DD')||' shift at '||coalesce(v_shift.location,'?')||'.',
      '', 'schedule_swap')
    from public.users u
    where public._sched_mgr(u.role) and (u.store = v_shift.location or u.store is null);
  exception when others then null; end;
  return jsonb_build_object('ok',true,'offer_id',v_id);
end $fn$;


-- ============================================================================
-- 3) OPEN-SHIFT MARKETPLACE — manager RPCs
-- ============================================================================

-- app_offers_pending : manager inbox — claims + offers awaiting a decision -----
create or replace function public.app_offers_pending(
  p_username text, p_password text, p_location text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_claims jsonb; v_offers jsonb;
begin
  select uid,urole into v_uid,v_role from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;
  -- pending claims on OPEN shifts
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind','claim',
           'claim_id',   c.id,
           'shift_id',   s.id,
           'employee_id',c.employee_id,
           'employee_name', se.name,
           'location',   s.location,
           'shift_date', s.shift_date,
           'start_time', s.start_time,
           'end_time',   s.end_time,
           'position_name', p.name,
           'created_at', c.created_at
         ) order by s.shift_date asc, s.start_time asc), '[]'::jsonb)
    into v_claims
    from public.shift_claims c
    join public.shifts s on s.id = c.shift_id
    left join public.schedule_employees se on se.id = c.employee_id
    left join public.schedule_positions  p  on p.id = s.position_id
   where c.status = 'pending'
     and (p_location is null or s.location = p_location);
  -- release/swap offers that a peer has accepted, awaiting manager approval
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind','offer',
           'offer_id',   o.id,
           'offer_type', o.offer_type,
           'shift_id',   s.id,
           'from_employee_id', o.offered_by,
           'from_name',  fe.name,
           'to_employee_id',   o.claimed_by,
           'to_name',    te.name,
           'location',   s.location,
           'shift_date', s.shift_date,
           'start_time', s.start_time,
           'end_time',   s.end_time,
           'position_name', p.name,
           'created_at', o.created_at
         ) order by s.shift_date asc, s.start_time asc), '[]'::jsonb)
    into v_offers
    from public.shift_offers o
    join public.shifts s on s.id = o.shift_id
    left join public.schedule_employees fe on fe.id = o.offered_by
    left join public.schedule_employees te on te.id = o.claimed_by
    left join public.schedule_positions  p  on p.id = s.position_id
   where o.status = 'accepted'
     and o.claimed_by is not null
     and (p_location is null or s.location = p_location);
  return jsonb_build_object('claims', v_claims, 'offers', v_offers);
end $fn$;

-- app_claim_decide : manager approves/denies a claim on an OPEN shift ----------
-- on approve: set shifts.employee_id (fires shifts_integrity(); its error is
-- surfaced verbatim) and push both parties. Other pending claims auto-denied.
create or replace function public.app_claim_decide(
  p_username text, p_password text, p_claim_id bigint, p_approve boolean)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_name text;
  v_claim public.shift_claims; v_shift public.shifts; v_tuser bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;
  select * into v_claim from public.shift_claims where id = p_claim_id;
  if v_claim.id is null then raise exception 'Claim not found'; end if;
  if v_claim.status <> 'pending' then raise exception 'That request was already decided.'; end if;
  select * into v_shift from public.shifts where id = v_claim.shift_id;
  if v_shift.id is null then raise exception 'Shift no longer exists'; end if;

  if not p_approve then
    update public.shift_claims set status='denied', decided_by=v_uid, decided_at=now()
     where id = p_claim_id;
    begin
      select u.id into v_tuser from public.users u
       join public.schedule_employees se on se.linked_username=u.username
       where se.id = v_claim.employee_id limit 1;
      if v_tuser is not null then
        perform public.push_enqueue(v_tuser, '❌ Shift request declined',
          'Your request for the '||to_char(v_shift.shift_date,'Mon DD')||
          ' shift wasn''t approved. Check the open shifts for others.', '', 'schedule_open_shift');
      end if;
    exception when others then null; end;
    return jsonb_build_object('ok',true,'approved',false);
  end if;

  if v_shift.employee_id is not null then
    raise exception 'That shift was already assigned to someone else.'; end if;

  -- ASSIGN — normal UPDATE so shifts_integrity() fires; surface its message.
  begin
    update public.shifts set employee_id = v_claim.employee_id where id = v_shift.id;
  exception when others then
    raise exception 'Could not assign: %', SQLERRM;
  end;

  update public.shift_claims set status='approved', decided_by=v_uid, decided_at=now()
   where id = p_claim_id;
  -- deny any other pending claims on the same (now-filled) shift
  update public.shift_claims set status='denied', decided_by=v_uid, decided_at=now()
   where shift_id = v_shift.id and status='pending' and id <> p_claim_id;

  begin
    select u.id into v_tuser from public.users u
     join public.schedule_employees se on se.linked_username=u.username
     where se.id = v_claim.employee_id limit 1;
    if v_tuser is not null then
      perform public.push_enqueue(v_tuser, '✅ Shift is yours!',
        'You got the '||to_char(v_shift.shift_date,'Mon DD')||' '||
        to_char(v_shift.start_time,'HH12:MIam')||' shift at '||coalesce(v_shift.location,'?')||'.',
        '', 'schedule_open_shift');
    end if;
  exception when others then null; end;
  return jsonb_build_object('ok',true,'approved',true,'shift_id',v_shift.id,'employee_id',v_claim.employee_id);
end $fn$;

-- app_offer_decide : manager approves/denies a release pick-up or a swap -------
-- on approve: reassign shifts.employee_id to claimed_by (fires integrity
-- trigger; error surfaced) and push both the giver and the taker.
create or replace function public.app_offer_decide(
  p_username text, p_password text, p_offer_id bigint, p_approve boolean)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_name text;
  v_offer public.shift_offers; v_shift public.shifts;
  v_from_user bigint; v_to_user bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;
  select * into v_offer from public.shift_offers where id = p_offer_id;
  if v_offer.id is null then raise exception 'Offer not found'; end if;
  if v_offer.status not in ('open','accepted') then raise exception 'That offer was already decided.'; end if;
  select * into v_shift from public.shifts where id = v_offer.shift_id;
  if v_shift.id is null then raise exception 'Shift no longer exists'; end if;

  if not p_approve then
    update public.shift_offers set status='denied', decided_by=v_uid, decided_at=now()
     where id = p_offer_id;
    begin
      -- tell the giver their release/swap wasn't approved
      select u.id into v_from_user from public.users u
       join public.schedule_employees se on se.linked_username=u.username
       where se.id = v_offer.offered_by limit 1;
      if v_from_user is not null then
        perform public.push_enqueue(v_from_user, '❌ Shift change declined',
          'Your '||v_offer.offer_type||' for the '||to_char(v_shift.shift_date,'Mon DD')||
          ' shift wasn''t approved — you are still on it.', '', 'schedule_release');
      end if;
    exception when others then null; end;
    return jsonb_build_object('ok',true,'approved',false);
  end if;

  -- must have someone to hand it to
  if v_offer.claimed_by is null then
    raise exception 'No one has accepted this offer yet.'; end if;
  if not public._sched_cleared(v_offer.claimed_by, v_shift.position_id) then
    raise exception 'The taker is not cleared for this position.'; end if;

  -- REASSIGN — normal UPDATE so shifts_integrity() fires; surface its message.
  begin
    update public.shifts set employee_id = v_offer.claimed_by where id = v_shift.id;
  exception when others then
    raise exception 'Could not reassign: %', SQLERRM;
  end;

  update public.shift_offers set status='approved', decided_by=v_uid, decided_at=now()
   where id = p_offer_id;

  begin
    select u.id into v_from_user from public.users u
     join public.schedule_employees se on se.linked_username=u.username
     where se.id = v_offer.offered_by limit 1;
    select u.id into v_to_user from public.users u
     join public.schedule_employees se on se.linked_username=u.username
     where se.id = v_offer.claimed_by limit 1;
    if v_from_user is not null then
      perform public.push_enqueue(v_from_user, '✅ Shift change approved',
        'You''re off the '||to_char(v_shift.shift_date,'Mon DD')||' shift at '||
        coalesce(v_shift.location,'?')||' — covered by '||
        (select name from public.schedule_employees where id=v_offer.claimed_by)||'.',
        '', 'schedule_release');
    end if;
    if v_to_user is not null then
      perform public.push_enqueue(v_to_user, '✅ Shift is yours!',
        'You''re covering the '||to_char(v_shift.shift_date,'Mon DD')||' '||
        to_char(v_shift.start_time,'HH12:MIam')||' shift at '||coalesce(v_shift.location,'?')||'.',
        '', 'schedule_pickup');
    end if;
  exception when others then null; end;
  return jsonb_build_object('ok',true,'approved',true,'shift_id',v_shift.id,'employee_id',v_offer.claimed_by);
end $fn$;


-- ============================================================================
-- 4) REMINDERS / NO-SHOW  (called by a scheduled task later)
-- ============================================================================

-- app_shift_reminders_due : for published shifts starting within the window,
-- push the assigned employee a reminder ONCE (idempotent via shifts.reminder_sent).
-- No auth args — invoked by the scheduled task (service role). Returns a summary.
create or replace function public.app_shift_reminders_due(
  p_within_minutes int default 90)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare r record; v_sent int := 0; v_uid bigint;
begin
  for r in
    select s.id, s.shift_date, s.start_time, s.location, s.employee_id, se.name
    from public.shifts s
    join public.schedule_employees se on se.id = s.employee_id
    where s.published = true
      and coalesce(s.reminder_sent,false) = false
      and s.employee_id is not null
      and (s.shift_date + s.start_time) between now()
          and now() + make_interval(mins => greatest(1,coalesce(p_within_minutes,90)))
  loop
    -- resolve the employee's login to a users.id to receive the push
    select u.id into v_uid from public.users u
     join public.schedule_employees se on se.linked_username = u.username
     where se.id = r.employee_id limit 1;
    if v_uid is not null then
      begin
        perform public.push_enqueue(v_uid, '⏰ Shift reminder',
          'Heads up '||coalesce(r.name,'')||' — you''re on at '||
          to_char(r.start_time,'HH12:MIam')||' at '||coalesce(r.location,'?')||'.',
          '', 'schedule_reminder');
      exception when others then null; end;
    end if;
    -- mark sent regardless (so we never spam even if the push path is down)
    update public.shifts set reminder_sent = true where id = r.id;
    v_sent := v_sent + 1;
  end loop;
  return jsonb_build_object('ok',true,'reminders_sent',v_sent,'window_min',greatest(1,coalesce(p_within_minutes,90)));
end $fn$;

-- app_noshow_scan : published shifts whose (start + grace) has passed with NO
-- matching clock-in punch -> push the managers of that store. No auth args
-- (scheduled task / service role). Punch lookup routes through _sched_has_punch
-- so re-pointing the punches table is a one-line fix there.
create or replace function public.app_noshow_scan(
  p_location text default null, p_grace_min int default 15)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare r record; v_flagged jsonb := '[]'::jsonb; v_n int := 0;
begin
  for r in
    select s.id, s.shift_date, s.start_time, s.location, s.employee_id, se.name
    from public.shifts s
    join public.schedule_employees se on se.id = s.employee_id
    where s.published = true
      and s.employee_id is not null
      and s.shift_date = current_date
      and (s.shift_date + s.start_time) + make_interval(mins => greatest(0,coalesce(p_grace_min,15))) <= now()
      and (p_location is null or s.location = p_location)
      and not public._sched_has_punch(s.employee_id, s.shift_date, s.start_time, p_grace_min)
  loop
    v_n := v_n + 1;
    v_flagged := v_flagged || jsonb_build_array(jsonb_build_object(
      'shift_id', r.id, 'employee_id', r.employee_id, 'employee_name', r.name,
      'location', r.location, 'start_time', r.start_time));
    -- push managers of that store (never blocks)
    begin
      perform public.push_enqueue(u.id, '🚫 Possible no-show',
        coalesce(r.name,'An employee')||' has not clocked in for the '||
        to_char(r.start_time,'HH12:MIam')||' shift at '||coalesce(r.location,'?')||
        ' ('||greatest(0,coalesce(p_grace_min,15))||' min grace passed).', '', 'schedule_noshow')
      from public.users u
      where public._sched_mgr(u.role) and (u.store = r.location or u.store is null);
    exception when others then null; end;
  end loop;
  return jsonb_build_object('ok',true,'no_shows',v_n,'flagged',v_flagged,'grace_min',greatest(0,coalesce(p_grace_min,15)));
end $fn$;


-- ============================================================================
-- 5) PTO BALANCES
-- ============================================================================

create table if not exists public.pto_balances (
  employee_id   bigint primary key,               -- schedule_employees.id
  hours_accrued numeric(8,2) not null default 0,
  hours_used    numeric(8,2) not null default 0,
  updated_at    timestamptz  not null default now()
);
alter table public.pto_balances enable row level security;  -- deny-all; RPCs only

-- app_pto_get : {accrued, used, available}. Default target = the caller's own
-- balance. Managers may pass any p_emp; non-managers may only read their own.
create or replace function public.app_pto_get(
  p_username text, p_password text, p_emp bigint default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_self bigint; v_target bigint; v_row public.pto_balances;
begin
  select uid,urole into v_uid,v_role from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;
  v_self := public._sched_emp_id(p_username);
  v_target := coalesce(p_emp, v_self);
  if v_target is null then raise exception 'No employee to look up.'; end if;
  if v_target <> v_self and not public._sched_mgr(v_role) then
    raise exception 'You can only view your own PTO balance.'; end if;
  select * into v_row from public.pto_balances where employee_id = v_target;
  return jsonb_build_object(
    'employee_id', v_target,
    'accrued',   coalesce(v_row.hours_accrued,0),
    'used',      coalesce(v_row.hours_used,0),
    'available', coalesce(v_row.hours_accrued,0) - coalesce(v_row.hours_used,0),
    'updated_at',v_row.updated_at);
end $fn$;

-- app_pto_adjust : manager-only. p_delta_hours adjusts ACCRUED (+/-); logs
-- reason to nothing persistent here (keep it simple) but pushes the employee.
create or replace function public.app_pto_adjust(
  p_username text, p_password text, p_emp bigint, p_delta_hours numeric, p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_tuser bigint; v_new numeric;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pm_auth(p_username,p_password);
  if v_uid is null then raise exception 'Not authorized'; end if;
  if not public._sched_mgr(v_role) then raise exception 'Managers only'; end if;
  if p_emp is null then raise exception 'Pick an employee.'; end if;
  if p_delta_hours is null or p_delta_hours = 0 then raise exception 'Enter a non-zero hours adjustment.'; end if;
  insert into public.pto_balances(employee_id, hours_accrued, updated_at)
  values (p_emp, greatest(0, p_delta_hours), now())
  on conflict (employee_id) do update
    set hours_accrued = greatest(0, public.pto_balances.hours_accrued + p_delta_hours),
        updated_at = now()
  returning hours_accrued into v_new;
  begin
    select u.id into v_tuser from public.users u
     join public.schedule_employees se on se.linked_username=u.username
     where se.id = p_emp limit 1;
    if v_tuser is not null then
      perform public.push_enqueue(v_tuser, '🌴 PTO balance updated',
        'Your PTO was adjusted by '||to_char(p_delta_hours,'FM999990.0')||' hrs'||
        coalesce(' ('||nullif(trim(p_reason),'')||')','')||'. New accrued: '||
        to_char(v_new,'FM999990.0')||' hrs.', '', 'pto_adjust');
    end if;
  exception when others then null; end;
  return jsonb_build_object('ok',true,'employee_id',p_emp,'accrued',v_new);
end $fn$;

-- app_pto_accrue : batch accrue p_hours to every ACTIVE roster employee.
-- No auth args (scheduled task / service role). "Active" = has a linked login.
create or replace function public.app_pto_accrue(
  p_hours_per_active_employee numeric)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_n int := 0;
begin
  if p_hours_per_active_employee is null or p_hours_per_active_employee <= 0 then
    raise exception 'Accrual hours must be positive.'; end if;
  with active as (
    select se.id from public.schedule_employees se
    where se.linked_username is not null
      and exists(select 1 from public.users u where u.username = se.linked_username)
  ),
  upserted as (
    insert into public.pto_balances(employee_id, hours_accrued, updated_at)
    select id, p_hours_per_active_employee, now() from active
    on conflict (employee_id) do update
      set hours_accrued = public.pto_balances.hours_accrued + p_hours_per_active_employee,
          updated_at = now()
    returning employee_id
  )
  select count(*) into v_n from upserted;
  return jsonb_build_object('ok',true,'accrued_hours',p_hours_per_active_employee,'employees',v_n);
end $fn$;

-- app_pto_consume : deduct p_hours from an employee's balance (adds to USED).
-- No auth args — meant to be called by the frontend/a trigger when a time-off
-- request is APPROVED elsewhere. Does NOT modify existing time-off RPCs.
create or replace function public.app_pto_consume(
  p_emp bigint, p_hours numeric)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_new_used numeric;
begin
  if p_emp is null then raise exception 'No employee.'; end if;
  if p_hours is null or p_hours <= 0 then raise exception 'Hours to consume must be positive.'; end if;
  insert into public.pto_balances(employee_id, hours_used, updated_at)
  values (p_emp, p_hours, now())
  on conflict (employee_id) do update
    set hours_used = public.pto_balances.hours_used + p_hours,
        updated_at = now()
  returning hours_used into v_new_used;
  return jsonb_build_object('ok',true,'employee_id',p_emp,'used',v_new_used);
end $fn$;


-- ============================================================================
-- 6) TEACH SCOOPY  (App Help knowledge for the new features)
-- ============================================================================
insert into public.knowledge_base (category, question, answer, updated_at, updated_by)
select 'App Help', q, a, now(), 'Cowork build' from (values
  ('How do I give away or pick up a shift?',
   'Open My Shifts. To give away a shift you can''t work, tap Release — it goes to the open-shift pool and a manager is notified. To pick up an open shift, open the Open Shifts list (you only see shifts you''re cleared for that don''t clash with your own), tap the one you want, and request it. To hand a shift to a specific coworker, use Offer to a coworker. Every shift change is confirmed by a manager before it''s final.'),
  ('How do managers approve shift changes?',
   'Managers get a Shift Approvals inbox showing every pending open-shift claim, release pick-up, and swap for their store. Approve to reassign the shift to the new person (the schedule''s safety checks still run — no double-booking, breaks, or minor-hour limits), or decline. Both employees get a push notification either way.'),
  ('Will I get reminded about my shifts?',
   'Yes. The Hub sends a push reminder before your shift starts. Managers also get an automatic alert if someone hasn''t clocked in shortly after their shift begins, so no-shows get caught fast.'),
  ('How does PTO / paid time off work in the Hub?',
   'Your PTO balance (accrued, used, and available hours) shows on the Time Off screen. Hours accrue automatically over time. Managers can adjust a balance with a reason, and approved time off draws the hours down. If a number ever looks off, tell your manager.')
) v(q,a)
where not exists (select 1 from public.knowledge_base kb where kb.question = v.q);


-- ============================================================================
-- SMOKE TESTS  (run after applying; replace 'aaron'/'PW' with a real mgr login,
-- and the ids with real schedule_employees.id / shift.id / offer.id values)
-- ============================================================================
-- 1) Objects exist:
--    select proname from pg_proc where proname like 'app_openshift%'
--       or proname like 'app_shift_%' or proname like 'app_offer%'
--       or proname like 'app_claim%' or proname like 'app_swap%'
--       or proname like 'app_pto_%' or proname like 'app_noshow%'
--    order by proname;
--    select tablename from pg_tables where tablename in
--      ('shift_offers','shift_claims','pto_balances');
--    -- confirm reminder_sent column added:
--    select column_name from information_schema.columns
--      where table_name='shifts' and column_name='reminder_sent';
--
-- 2) Auth guard (should raise 'Not authorized'):
--    select public.app_openshift_list('nobody','wrong');
--
-- 3) Employee eligibility list (open shifts the caller can take):
--    select public.app_openshift_list('some_employee_username','their_pw', null);
--
-- 4) Manager inbox (claims + offers awaiting approval):
--    select public.app_offers_pending('aaron','PW', null);
--
-- 5) PTO — read self, adjust (mgr), read again:
--    select public.app_pto_get('some_employee_username','their_pw');
--    select public.app_pto_adjust('aaron','PW', 12 /*emp id*/, 8, 'Q3 grant');
--    select public.app_pto_get('aaron','PW', 12);
--
-- 6) Batch jobs (scheduled-task entry points — safe to run manually):
--    select public.app_shift_reminders_due(90);
--    select public.app_noshow_scan(null, 15);
--    select public.app_pto_accrue(1.5);
--
-- 7) End-to-end claim flow (as employee then manager), then verify assignment:
--    -- select public.app_openshift_claim('emp_user','pw', <open_shift_id>);
--    -- select public.app_claim_decide('aaron','PW', <claim_id>, true);
--    -- select employee_id from public.shifts where id = <open_shift_id>;  -- now the claimant
--
-- Done. Nothing above modifies existing app_sched_*/app_* RPCs or index.html.
-- ============================================================================
