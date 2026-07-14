-- ============================================================================
-- Caliche's Hub — TRAINING HUB FINISH (training_finish.sql)
-- Aaron's Training Hub spec gaps: READY-TO-START (paid pre-start certificate
-- + time capture) and QUICK SCOOP (refresher / retraining engine), plus a
-- tiny SCORM pointer reader for the Path Builder and Scoopy knowledge.
--
-- ADDITIVE + IDEMPOTENT. Does NOT redefine anything from training_hub.sql.
-- New tables = trh_prestart / trh_quickscoop / trh_qs_assignments — RLS on,
-- NO policies (deny-all): access only via SECURITY DEFINER RPCs below.
-- Employee identity = public.schedule_employees.id (bigint), same as trh_*.
--
-- REUSED (must already exist — all live per employee_passport.sql /
-- team_growth.sql / training_hub.sql):
--   public._pp_auth(username,password) -> uid,urole,uname
--   public._pp_audit(actor_id,actor,action,emp,before,after,reason)
--   public._trh_cfg(key,fallback)             (group trh_config)
--   public._trh_role_match(role,csv)
--   public._trh_emp_of(username) -> schedule_employees.id
--   public._trh_notify_emp / _trh_notify_mgrs (never throw)
--   public._tg_emp_location(employee_id)
--   public.trh_paths / trh_certifications     (cert award mirrors trh_award_cert)
--   public.employee_certs                     (guarded mirror, same as award)
--   public.app_settings (skey PK, sgroup, label, svalue, sort)
-- ============================================================================

-- ============================== 1) TABLES ==================================

-- READY-TO-START: paid pre-start training per new hire. Minutes accumulate
-- SERVER-SIDE from start/finish timestamps (never trusted from the client),
-- capped by app_settings 'trh_rules'.'prestart_max_minutes' (default 120).
create table if not exists public.trh_prestart (
  id                      bigserial primary key,
  employee_id             bigint not null,          -- schedule_employees.id
  path_id                 bigint,                   -- optional trh_paths ref (the pre-start course/path)
  cert_name               text,                     -- entry cert awarded on approval (falls back to path / rule)
  status                  text not null default 'assigned'
                          check (status in ('assigned','in_progress','completed','approved')),
  assigned_by             text,
  assigned_at             timestamptz not null default now(),
  started_at              timestamptz,              -- first session start
  session_started_at      timestamptz,              -- open session marker (null = no session running)
  completed_at            timestamptz,
  minutes_spent           int not null default 0,   -- server-accumulated, capped
  approved_by             text,
  approved_at             timestamptz,
  cert_id                 bigint,                   -- trh_certifications.id once approved
  pay_period_exported_at  timestamptz,              -- stamped by trh_prestart_payroll_export
  note                    text
);
create index if not exists trh_prestart_emp_idx on public.trh_prestart(employee_id);
-- one open (not yet approved) pre-start record per employee
create unique index if not exists trh_prestart_open_uq
  on public.trh_prestart(employee_id) where status <> 'approved';
alter table public.trh_prestart enable row level security;

-- QUICK SCOOP: a short refresher/retraining bite. Cadence = one-off (assign
-- when needed); audience is role csv / store / all (used for bulk targeting).
create table if not exists public.trh_quickscoop (
  id             bigserial primary key,
  title          text not null,
  body           text,                              -- plain text, rendered escaped with line breaks
  audience_role  text,                              -- csv role filter, '' = all roles
  audience_store text,                              -- '' = all stores
  due_days       int not null default 3,
  check_question text,                              -- optional 1-question check shown at completion
  active         boolean not null default true,
  created_by     text, created_at timestamptz not null default now(),
  updated_by     text, updated_at timestamptz not null default now()
);
alter table public.trh_quickscoop enable row level security;

create table if not exists public.trh_qs_assignments (
  id             bigserial primary key,
  quickscoop_id  bigint not null,
  employee_id    bigint not null,                   -- schedule_employees.id
  assigned_by    text,
  assigned_at    timestamptz not null default now(),
  due_at         date,
  completed_at   timestamptz,
  ack            boolean not null default false,
  check_response jsonb,                             -- optional 1-question check answer
  source         text                               -- 'manual' | 'audience' | 'failed_signoff'
);
create index if not exists trh_qs_assign_emp_idx   on public.trh_qs_assignments(employee_id);
create index if not exists trh_qs_assign_scoop_idx on public.trh_qs_assignments(quickscoop_id);
alter table public.trh_qs_assignments enable row level security;

-- ============================ 2) RULES SEED =================================
-- Group trh_rules (separate from trh_config so payroll knobs stay together).
insert into public.app_settings(skey, sgroup, label, svalue, sort)
values
  ('prestart_max_minutes', 'trh_rules', 'Ready-to-Start: max paid pre-start minutes per hire', '120', 10),
  ('prestart_cert_name',   'trh_rules', 'Ready-to-Start: entry certificate name awarded on approval', 'Ready-to-Start Certificate', 20)
on conflict (skey) do nothing;

-- ============================== 3) HELPERS =================================

-- rules reader (group trh_rules in app_settings; seed above, default in code)
create or replace function public._trh_rule(p_key text, p_fb text)
returns text language sql security definer set search_path=public,extensions as $fn$
  select coalesce(nullif(btrim((select svalue from public.app_settings
                                where skey=p_key and sgroup='trh_rules')),''), p_fb);
$fn$;

-- pre-start minutes cap (guarded int parse, floor 1)
create or replace function public._trh_prestart_cap()
returns int language plpgsql security definer set search_path=public,extensions as $fn$
declare v int;
begin
  begin
    v := coalesce(nullif(btrim(public._trh_rule('prestart_max_minutes','120')),'')::int, 120);
  exception when others then v := 120;
  end;
  return greatest(1, v);
end $fn$;

-- one pre-start row -> jsonb (shared by my/team readers)
create or replace function public._trh_prestart_json(p_id bigint)
returns jsonb language sql security definer set search_path=public,extensions as $fn$
  select jsonb_build_object(
    'id', pp.id, 'employee_id', pp.employee_id,
    'employee', (select se.name from public.schedule_employees se where se.id = pp.employee_id),
    'store', coalesce(public._tg_emp_location(pp.employee_id),''),
    'path_id', pp.path_id,
    'path_title', (select t.title from public.trh_paths t where t.id = pp.path_id),
    'cert_name', coalesce(nullif(btrim(pp.cert_name),''),
                          (select nullif(btrim(t.cert_name),'') from public.trh_paths t where t.id = pp.path_id),
                          public._trh_rule('prestart_cert_name','Ready-to-Start Certificate')),
    'status', pp.status, 'assigned_by', pp.assigned_by, 'assigned_at', pp.assigned_at,
    'started_at', pp.started_at, 'completed_at', pp.completed_at,
    'minutes_spent', pp.minutes_spent,
    'session_open', (pp.session_started_at is not null),
    'session_started_at', pp.session_started_at,
    'approved_by', pp.approved_by, 'approved_at', pp.approved_at,
    'cert_id', pp.cert_id, 'exported', (pp.pay_period_exported_at is not null),
    'note', pp.note)
  from public.trh_prestart pp where pp.id = p_id;
$fn$;

revoke execute on function public._trh_rule(text,text)      from anon, authenticated;
revoke execute on function public._trh_prestart_cap()       from anon, authenticated;
revoke execute on function public._trh_prestart_json(bigint) from anon, authenticated;

-- ======================= 4) READY-TO-START RPCs ============================

-- ---- trh_prestart_assign : manager assigns paid pre-start to new hires -----
-- Dedupe: an employee with an open (not yet approved) record is skipped.
create or replace function public.trh_prestart_assign(
  p_username text, p_password text, p_employee_ids bigint[],
  p_path_id bigint, p_cert_name text, p_note text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_eid bigint; v_id bigint;
        v_n int := 0; v_skip int := 0; v_cap int;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%'
          or v_role ilike '%owner%' or v_role ilike '%VP%' or v_role ilike '%president%') then
    raise exception 'forbidden';
  end if;
  if p_path_id is not null and not exists (select 1 from public.trh_paths where id = p_path_id) then
    raise exception 'not_found';
  end if;
  v_cap := public._trh_prestart_cap();

  foreach v_eid in array coalesce(p_employee_ids, '{}'::bigint[]) loop
    if exists (select 1 from public.trh_prestart
               where employee_id = v_eid and status <> 'approved') then
      v_skip := v_skip + 1;  -- idempotent: one open pre-start per hire
      continue;
    end if;
    insert into public.trh_prestart(employee_id, path_id, cert_name, assigned_by, note)
    values (v_eid, p_path_id, nullif(btrim(p_cert_name),''), v_name, nullif(btrim(p_note),''))
    returning id into v_id;
    v_n := v_n + 1;
    perform public._pp_audit(v_uid, v_name, 'trh_prestart_assign', v_eid, null,
      jsonb_build_object('prestart_id', v_id, 'path_id', p_path_id,
                         'cert_name', nullif(btrim(p_cert_name),''), 'cap_minutes', v_cap), nullif(btrim(p_note),''));
    perform public._trh_notify_emp(v_eid, '💵 Paid pre-start training',
      format('Your Ready-to-Start training is assigned. Open the Training Hub and tap Start session — your time is paid (up to %s minutes).', v_cap));
  end loop;
  return jsonb_build_object('ok', true, 'assigned', v_n, 'skipped', v_skip);
end $fn$;

-- ---- trh_prestart_my : the employee's own pre-start records -----------------
create or replace function public.trh_prestart_my(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint; v_rows jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  v_emp := public._trh_emp_of(p_username);
  if v_emp is null then
    return jsonb_build_object('employee_id', null, 'cap', public._trh_prestart_cap(), 'rows', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(public._trh_prestart_json(pp.id) order by pp.assigned_at desc), '[]'::jsonb)
    into v_rows
  from public.trh_prestart pp where pp.employee_id = v_emp;
  return jsonb_build_object('employee_id', v_emp, 'cap', public._trh_prestart_cap(), 'rows', v_rows);
end $fn$;

-- ---- trh_prestart_progress : employee marks start / finish of a session -----
-- Minutes accumulate SERVER-SIDE from timestamps; single sessions and the
-- running total are both capped at 'trh_rules'.'prestart_max_minutes'.
-- p_action: 'start' | 'finish' | 'complete' (finish any open session, then
-- mark the whole pre-start course done so a manager can approve it).
create or replace function public.trh_prestart_progress(
  p_username text, p_password text, p_id bigint, p_action text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint;
        r public.trh_prestart%rowtype; v_cap int; v_add int := 0;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if coalesce(p_action,'') not in ('start','finish','complete') then raise exception 'bad_action'; end if;
  v_emp := public._trh_emp_of(p_username);
  select * into r from public.trh_prestart where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if v_emp is null or r.employee_id <> v_emp then raise exception 'forbidden'; end if;
  if r.status = 'approved' then raise exception 'already_approved'; end if;
  v_cap := public._trh_prestart_cap();

  if p_action = 'start' then
    if r.status = 'completed' then raise exception 'already_completed'; end if;
    if r.session_started_at is null then
      update public.trh_prestart
         set session_started_at = now(),
             started_at = coalesce(started_at, now()),
             status = 'in_progress'
       where id = r.id;
    end if;  -- a session already running is a no-op (no timer reset)
  else
    -- close any open session, crediting whole minutes (30s rounds up to 1)
    if r.session_started_at is not null then
      v_add := greatest(0, ceil(extract(epoch from (now() - r.session_started_at)) / 60.0)::int);
      v_add := least(v_add, v_cap);
    end if;
    update public.trh_prestart
       set minutes_spent = least(v_cap, coalesce(minutes_spent,0) + v_add),
           session_started_at = null,
           started_at = coalesce(started_at, now()),
           status = case when p_action = 'complete' then 'completed'
                         when status = 'completed' then 'completed'
                         else 'in_progress' end,
           completed_at = case when p_action = 'complete' then coalesce(completed_at, now())
                               else completed_at end
     where id = r.id;
    if p_action = 'complete' and r.status <> 'completed' then
      perform public._trh_notify_mgrs('💵 Ready-to-Start finished',
        format('%s finished the pre-start training (%s paid min recorded) — ready for approval in the Training Hub.',
               coalesce((select se.name from public.schedule_employees se where se.id = r.employee_id), v_name),
               (select minutes_spent from public.trh_prestart where id = r.id)));
    end if;
  end if;

  select * into r from public.trh_prestart where id = p_id;
  return jsonb_build_object('ok', true, 'status', r.status,
    'minutes_spent', r.minutes_spent, 'cap', v_cap,
    'session_open', (r.session_started_at is not null));
end $fn$;

-- ---- trh_prestart_team : manager dashboard + pickers ------------------------
create or replace function public.trh_prestart_team(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text;
        v_rows jsonb; v_emps jsonb; v_paths jsonb; v_unexported int;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%'
          or v_role ilike '%owner%' or v_role ilike '%VP%' or v_role ilike '%president%') then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(public._trh_prestart_json(pp.id)
           order by case pp.status when 'completed' then 0 when 'in_progress' then 1
                                   when 'assigned' then 2 else 3 end, pp.assigned_at desc), '[]'::jsonb)
    into v_rows
  from public.trh_prestart pp;

  select count(*) into v_unexported
  from public.trh_prestart where status = 'approved' and pay_period_exported_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', se.id, 'name', se.name,
      'role', (select u.role from public.users u where u.username = se.linked_username limit 1),
      'store', coalesce(public._tg_emp_location(se.id),''))
      order by se.name),'[]'::jsonb)
    into v_emps from public.schedule_employees se;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'cert_name', t.cert_name)
           order by t.sort, t.id),'[]'::jsonb)
    into v_paths from public.trh_paths t where t.active;

  return jsonb_build_object('rows', v_rows, 'employees', v_emps, 'paths', v_paths,
    'cap', public._trh_prestart_cap(),
    'default_cert', public._trh_rule('prestart_cert_name','Ready-to-Start Certificate'),
    'unexported', v_unexported);
end $fn$;

-- ---- trh_prestart_approve : manager confirms -> awards the entry cert -------
-- Same mechanism as trh_award_cert: writes trh_certifications and mirrors
-- into employee_certs (guarded) so the Development Passport shows it.
create or replace function public.trh_prestart_approve(
  p_username text, p_password text, p_id bigint, p_note text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text;
        r public.trh_prestart%rowtype; v_cap int; v_add int := 0;
        v_cert_name text; v_cert_id bigint; v_ver int; v_emp_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._trh_role_match(v_role, public._trh_cfg('trh_final_approver_roles','manager,admin,president,owner,VP')) then
    raise exception 'forbidden';
  end if;
  select * into r from public.trh_prestart where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status = 'approved' then raise exception 'already_approved'; end if;
  v_cap := public._trh_prestart_cap();

  -- close a forgotten open session before approving (server-side minutes)
  if r.session_started_at is not null then
    v_add := least(greatest(0, ceil(extract(epoch from (now() - r.session_started_at)) / 60.0)::int), v_cap);
  end if;

  v_cert_name := coalesce(nullif(btrim(r.cert_name),''),
                          (select nullif(btrim(t.cert_name),'') from public.trh_paths t where t.id = r.path_id),
                          public._trh_rule('prestart_cert_name','Ready-to-Start Certificate'));
  v_ver := coalesce((select t.version from public.trh_paths t where t.id = r.path_id), 1);

  insert into public.trh_certifications(employee_id, path_id, enrollment_id, cert_name, version,
                                        status, issued_by, expires_date, note)
  values (r.employee_id, r.path_id, null, v_cert_name, v_ver,
          'active', v_name, null,
          coalesce(nullif(btrim(p_note),''), 'Ready-to-Start pre-start approval'))
  returning id into v_cert_id;

  -- mirror into the shared Development Passport cert list (guarded, like trh_award_cert)
  begin
    insert into public.employee_certs(employee_id, cert_type, issued_date, expires_date)
    select r.employee_id, v_cert_name, current_date, null
    where not exists (select 1 from public.employee_certs ec
                      where ec.employee_id = r.employee_id and ec.cert_type = v_cert_name
                        and coalesce(ec.expires_date, '9999-12-31'::date) >= current_date);
  exception when others then null;
  end;

  update public.trh_prestart
     set status = 'approved',
         approved_by = v_name, approved_at = now(),
         completed_at = coalesce(completed_at, now()),
         minutes_spent = least(v_cap, coalesce(minutes_spent,0) + v_add),
         session_started_at = null,
         cert_id = v_cert_id
   where id = r.id;

  select name into v_emp_name from public.schedule_employees where id = r.employee_id;
  perform public._pp_audit(v_uid, v_name, 'trh_prestart_approve', r.employee_id,
    jsonb_build_object('prestart_id', r.id, 'status', r.status, 'minutes', r.minutes_spent),
    jsonb_build_object('prestart_id', r.id, 'status', 'approved', 'cert_id', v_cert_id,
                       'cert_name', v_cert_name,
                       'minutes', (select minutes_spent from public.trh_prestart where id = r.id)),
    nullif(btrim(p_note),''));
  if public._trh_cfg('trh_notify_award','yes') = 'yes' then
    perform public._trh_notify_emp(r.employee_id, '🏅 Ready to start!',
      format('Congratulations — you earned the %s. Your paid pre-start minutes go to payroll.', v_cert_name));
    perform public._trh_notify_mgrs('🏅 Ready-to-Start approved',
      format('%s approved %s — %s awarded.', v_name, coalesce(v_emp_name,'a new hire'), v_cert_name));
  end if;
  return jsonb_build_object('ok', true, 'cert_id', v_cert_id, 'cert_name', v_cert_name,
    'minutes_spent', (select minutes_spent from public.trh_prestart where id = r.id));
end $fn$;

-- ---- trh_prestart_payroll_export : leadership pulls unexported paid minutes -
-- Returns employee/date/minutes rows for APPROVED, never-exported records and
-- stamps pay_period_exported_at so the same minutes are never paid twice.
create or replace function public.trh_prestart_payroll_export(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_rows jsonb; v_n int := 0; v_now timestamptz := now();
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._trh_role_match(v_role, public._trh_cfg('trh_final_approver_roles','manager,admin,president,owner,VP')) then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', pp.id, 'employee_id', pp.employee_id,
      'employee', (select se.name from public.schedule_employees se where se.id = pp.employee_id),
      'store', coalesce(public._tg_emp_location(pp.employee_id),''),
      'date', to_char(coalesce(pp.completed_at, pp.approved_at, pp.assigned_at)::date, 'YYYY-MM-DD'),
      'minutes', pp.minutes_spent)
      order by pp.approved_at, pp.id), '[]'::jsonb), count(*)
    into v_rows, v_n
  from public.trh_prestart pp
  where pp.status = 'approved' and pp.pay_period_exported_at is null;

  update public.trh_prestart
     set pay_period_exported_at = v_now
   where status = 'approved' and pay_period_exported_at is null;

  begin
    perform public._pp_audit(v_uid, v_name, 'trh_prestart_payroll_export', null, null,
      jsonb_build_object('rows', v_n, 'exported_at', v_now), null);
  exception when others then null;  -- audit_log.affected_employee_id may be NOT NULL
  end;
  return jsonb_build_object('ok', true, 'exported', v_n, 'exported_at', v_now, 'rows', v_rows);
end $fn$;

-- ========================== 5) QUICK SCOOP RPCs ============================

-- ---- trh_qs_save : manager creates / edits a Quick Scoop --------------------
create or replace function public.trh_qs_save(
  p_username text, p_password text, p_id bigint, p_title text, p_body text,
  p_audience_role text, p_audience_store text, p_due_days int,
  p_check_question text, p_active boolean)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_id bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%'
          or v_role ilike '%owner%' or v_role ilike '%VP%' or v_role ilike '%president%') then
    raise exception 'forbidden';
  end if;
  if coalesce(btrim(p_title),'') = '' then raise exception 'title_required'; end if;
  if p_id is null then
    insert into public.trh_quickscoop(title, body, audience_role, audience_store, due_days,
                                      check_question, active, created_by, updated_by)
    values (btrim(p_title), nullif(btrim(p_body),''), nullif(btrim(p_audience_role),''),
            nullif(btrim(p_audience_store),''), greatest(1, coalesce(p_due_days,3)),
            nullif(btrim(p_check_question),''), coalesce(p_active,true), v_name, v_name)
    returning id into v_id;
  else
    update public.trh_quickscoop
       set title = btrim(p_title), body = nullif(btrim(p_body),''),
           audience_role = nullif(btrim(p_audience_role),''),
           audience_store = nullif(btrim(p_audience_store),''),
           due_days = greatest(1, coalesce(p_due_days,3)),
           check_question = nullif(btrim(p_check_question),''),
           active = coalesce(p_active,true),
           updated_by = v_name, updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  begin
    perform public._pp_audit(v_uid, v_name, 'trh_qs_save', null, null,
      jsonb_build_object('quickscoop_id', v_id, 'title', btrim(p_title)), null);
  exception when others then null;  -- audit_log.affected_employee_id may be NOT NULL
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

-- ---- trh_qs_assign : create assignments (explicit ids OR audience), dedupe --
-- p_employee_ids empty/null = target the scoop's audience (role csv / store /
-- all). Employees with that scoop still open are skipped (no duplicates).
create or replace function public.trh_qs_assign(
  p_username text, p_password text, p_quickscoop_id bigint,
  p_employee_ids bigint[], p_source text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; s public.trh_quickscoop%rowtype;
        v_eid bigint; v_n int := 0; v_skip int := 0; v_due date;
        v_targets bigint[];
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%'
          or v_role ilike '%owner%' or v_role ilike '%VP%' or v_role ilike '%president%') then
    raise exception 'forbidden';
  end if;
  select * into s from public.trh_quickscoop where id = p_quickscoop_id and active;
  if s.id is null then raise exception 'not_found'; end if;
  v_due := current_date + greatest(1, coalesce(s.due_days,3));

  if coalesce(array_length(p_employee_ids,1),0) > 0 then
    v_targets := p_employee_ids;
  else
    select coalesce(array_agg(se.id), '{}'::bigint[]) into v_targets
    from public.schedule_employees se
    where (coalesce(s.audience_store,'') = ''
           or coalesce(public._tg_emp_location(se.id),'') = s.audience_store)
      and (coalesce(s.audience_role,'') = ''
           or public._trh_role_match(
                coalesce((select u.role from public.users u where u.username = se.linked_username limit 1),''),
                s.audience_role));
  end if;

  foreach v_eid in array coalesce(v_targets, '{}'::bigint[]) loop
    if exists (select 1 from public.trh_qs_assignments
               where quickscoop_id = s.id and employee_id = v_eid and completed_at is null) then
      v_skip := v_skip + 1;  -- dedupe: still open for this person
      continue;
    end if;
    insert into public.trh_qs_assignments(quickscoop_id, employee_id, assigned_by, due_at, source)
    values (s.id, v_eid, v_name, v_due,
            coalesce(nullif(btrim(p_source),''),
                     case when coalesce(array_length(p_employee_ids,1),0) > 0 then 'manual' else 'audience' end));
    v_n := v_n + 1;
    perform public._trh_notify_emp(v_eid, '🍦 Quick Scoop',
      format('Quick refresher: "%s" — read it and mark done by %s in the Training Hub.',
             s.title, to_char(v_due,'Mon DD')));
  end loop;

  begin
    perform public._pp_audit(v_uid, v_name, 'trh_qs_assign', null, null,
      jsonb_build_object('quickscoop_id', s.id, 'title', s.title, 'assigned', v_n,
                         'skipped', v_skip, 'source', nullif(btrim(p_source),'')), null);
  exception when others then null;
  end;
  return jsonb_build_object('ok', true, 'assigned', v_n, 'skipped', v_skip, 'due_at', v_due);
end $fn$;

-- ---- trh_qs_my : the employee's open Quick Scoops ---------------------------
create or replace function public.trh_qs_my(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint; v_rows jsonb; v_done int := 0;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  v_emp := public._trh_emp_of(p_username);
  if v_emp is null then
    return jsonb_build_object('employee_id', null, 'rows', '[]'::jsonb, 'done_count', 0);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'quickscoop_id', a.quickscoop_id,
      'title', s.title, 'body', s.body, 'check_question', s.check_question,
      'assigned_by', a.assigned_by, 'assigned_at', a.assigned_at, 'due_at', a.due_at,
      'overdue', (a.due_at is not null and a.due_at < current_date), 'source', a.source)
      order by a.due_at asc nulls last, a.id), '[]'::jsonb)
    into v_rows
  from public.trh_qs_assignments a
  join public.trh_quickscoop s on s.id = a.quickscoop_id
  where a.employee_id = v_emp and a.completed_at is null;
  select count(*) into v_done from public.trh_qs_assignments
   where employee_id = v_emp and completed_at is not null;
  return jsonb_build_object('employee_id', v_emp, 'rows', v_rows, 'done_count', v_done);
end $fn$;

-- ---- trh_qs_complete : employee marks a scoop done (+ optional check) -------
create or replace function public.trh_qs_complete(
  p_username text, p_password text, p_assignment_id bigint, p_response jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint; a public.trh_qs_assignments%rowtype;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  v_emp := public._trh_emp_of(p_username);
  select * into a from public.trh_qs_assignments where id = p_assignment_id;
  if a.id is null then raise exception 'not_found'; end if;
  if v_emp is null or a.employee_id <> v_emp then raise exception 'forbidden'; end if;
  if a.completed_at is not null then return jsonb_build_object('ok', true); end if;  -- idempotent

  update public.trh_qs_assignments
     set completed_at = now(), ack = true, check_response = p_response
   where id = a.id;

  perform public._pp_audit(v_uid, v_name, 'trh_qs_complete', v_emp, null,
    jsonb_build_object('assignment_id', a.id, 'quickscoop_id', a.quickscoop_id,
                       'response', p_response), null);
  return jsonb_build_object('ok', true);
end $fn$;

-- ---- trh_qs_team : manager view — scoops, counts, who still owes one --------
create or replace function public.trh_qs_team(p_username text, p_password text, p_store text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_scoops jsonb; v_open jsonb; v_emps jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%'
          or v_role ilike '%owner%' or v_role ilike '%VP%' or v_role ilike '%president%') then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'title', s.title, 'body', s.body,
      'audience_role', s.audience_role, 'audience_store', s.audience_store,
      'due_days', s.due_days, 'check_question', s.check_question, 'active', s.active,
      'created_at', s.created_at, 'created_by', s.created_by,
      'assigned', (select count(*) from public.trh_qs_assignments a where a.quickscoop_id = s.id),
      'done', (select count(*) from public.trh_qs_assignments a
               where a.quickscoop_id = s.id and a.completed_at is not null),
      'overdue', (select count(*) from public.trh_qs_assignments a
                  where a.quickscoop_id = s.id and a.completed_at is null
                    and a.due_at is not null and a.due_at < current_date))
      order by s.active desc, s.created_at desc), '[]'::jsonb)
    into v_scoops
  from public.trh_quickscoop s;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'quickscoop_id', a.quickscoop_id, 'employee_id', a.employee_id,
      'employee', (select se.name from public.schedule_employees se where se.id = a.employee_id),
      'store', coalesce(public._tg_emp_location(a.employee_id),''),
      'title', s.title, 'assigned_at', a.assigned_at, 'due_at', a.due_at,
      'overdue', (a.due_at is not null and a.due_at < current_date), 'source', a.source)
      order by a.due_at asc nulls last, a.id), '[]'::jsonb)
    into v_open
  from public.trh_qs_assignments a
  join public.trh_quickscoop s on s.id = a.quickscoop_id
  where a.completed_at is null
    and (coalesce(p_store,'') = '' or coalesce(public._tg_emp_location(a.employee_id),'') = p_store);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', se.id, 'name', se.name,
      'role', (select u.role from public.users u where u.username = se.linked_username limit 1),
      'store', coalesce(public._tg_emp_location(se.id),''))
      order by se.name),'[]'::jsonb)
    into v_emps from public.schedule_employees se;

  return jsonb_build_object('scoops', v_scoops, 'open', v_open, 'employees', v_emps);
end $fn$;

-- ====================== 6) SCORM POINTER READER ============================
-- Read-only: the current SCORM attachment of one LMS course, so the Path
-- Builder's "SCORM package" row can offer Launch. Column-guarded like
-- _trh_course_done — a schema difference degrades to nulls, never an error.
create or replace function public.trh_scorm_info(p_username text, p_password text, p_course_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_url text; v_ver text; v_title text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  begin
    select c.scorm_url, c.scorm_version, c.title into v_url, v_ver, v_title
    from public.lp_courses c where c.id = p_course_id;
  exception when undefined_table or undefined_column then
    begin
      select c.title into v_title from public.lp_courses c where c.id = p_course_id;
    exception when others then null;
    end;
  end;
  return jsonb_build_object('course_id', p_course_id, 'title', v_title,
                            'scorm_url', v_url, 'scorm_version', v_ver);
end $fn$;

-- ========================= 7) TEACH MR. SCOOPY =============================
-- Standing practice (pattern from teach_scoopy.sql): idempotent Q&A inserts.
insert into public.knowledge_base (category, question, answer, updated_at, updated_by)
select 'App Help', q, a, now(), 'Cowork build' from (values
  ('What is Ready-to-Start pre-start training?',
   'Ready-to-Start is the paid training a new hire completes before their first shift. A manager assigns it in the Training Hub; the new hire opens My Path and uses Start session / End session while they learn, and the app records the paid minutes (up to the leadership-set cap). When they finish, a manager approves it, which awards the entry certificate and queues the minutes for payroll.'),
  ('How do I get paid for Ready-to-Start training?',
   'Your time is only counted while a session is running, so tap Start session when you begin and End session when you stop. After you mark the course finished and a manager approves it, leadership exports your recorded minutes to payroll - you do not need to do anything else.'),
  ('What is a Quick Scoop?',
   'A Quick Scoop is a short refresher or retraining note a manager sends from the Training Hub - for example after a policy change or a missed sign-off. It appears under Quick Scoops in your training view with a due date: read it, answer the quick check question if there is one, and tap Mark done so your manager can see the team is covered.')
) v(q,a)
where not exists (select 1 from public.knowledge_base kb where kb.question = v.q);

-- ============================== VERIFY =====================================
-- Run BEFORE prod apply (all should return rows / true):
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
-- ============================================================================
