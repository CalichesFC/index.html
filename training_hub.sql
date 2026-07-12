-- ============================================================================
-- Caliche's Hub — TRAINING HUB / LEARNING PATHS & CERTIFICATION ARCHITECTURE
-- (Wave 2 · js/22_training_hub.js · entry openTrainingHub())
--
-- Expands the existing Training portal (app_lp_* LMS) into the central engine
-- for onboarding, station skills, certifications and role learning paths.
-- White Apron = onboarding STATUS (an aspiring Blue Apron). The path teaches
-- and validates the SAME competencies, then awards the Blue Apron
-- Certification after digital learning + knowledge checks + on-the-job
-- practice + practical sign-offs + final manager approval.
--
-- ADDITIVE ONLY. Does NOT redefine/replace any app_lp_* / app_passport_* /
-- app_cert* / app_clearance* function or any lp_* table. New tables = trh_*.
-- Employee identity = public.schedule_employees.id (bigint). RLS on, no
-- policies — access only via SECURITY DEFINER RPCs (auth via _pp_auth).
--
-- REUSED (must already exist — all live per employee_passport.sql /
-- passport_phase2.sql / team_growth.sql):
--   public._pp_auth(username,password) -> uid,urole,uname
--   public._pp_is_self(username, employee_id)
--   public._pp_audit(actor_id,actor,action,emp,before,after,reason)
--   public._pp_rank(level)
--   public._tg_emp_location(employee_id)        (store filter; column-guarded)
--   public.push_enqueue(user_id,title,body,url) (guarded in exception blocks)
--   public.app_settings (skey PK, sgroup, label, svalue, sort)
--   LMS content: public.learning_paths / lp_courses / lp_course_completions
--     — referenced READ-ONLY and guarded with exception handlers so this file
--       still applies even if a column name differs (verify below).
--   public.employee_certs (employee_id,cert_type,cert_number,issued_date,
--     expires_date) — cert award mirrors here so app_passport_get shows it.
--   public.employee_position_clearance (employee_id,position_id) +
--   public.employee_passport — cert award can set "permitted to do"
--     (config-gated, guarded).
--
-- VERIFY BEFORE PROD RUN (see VERIFY block at the very bottom).
-- ============================================================================

-- ============================== 1) TABLES ==================================

-- Learning-path definitions (the Master Matrix rows: Blue Apron, Shift Leader,
-- Assistant Manager, Store Manager, Multi-Location, Catering/Mobile Vending,
-- Warehouse/Fulfillment, Maintenance, future Corporate, later Crew Trainer —
-- adding a role later = one new row here, no rebuild).
create table if not exists public.trh_paths (
  id                bigserial primary key,
  code              text,
  title             text not null,
  description       text,
  icon              text default '🎓',
  target_role       text,                 -- audience label e.g. 'Crew','Shift Leader'
  onboarding_status text,                 -- status shown while in progress, e.g. 'White Apron'
  cert_name         text,                 -- certification awarded on completion, e.g. 'Blue Apron Certification'
  cert_expires_days int,                  -- null/0 = no expiration
  lp_path_id        bigint,               -- optional link to existing LMS learning_paths (digital curriculum)
  version           int  not null default 1,   -- bumped on stage/requirement edits; snapshotted on enroll + award
  active            boolean not null default true,
  sort              int  not null default 100,
  created_by        text, created_at timestamptz not null default now(),
  updated_by        text, updated_at timestamptz not null default now()
);
alter table public.trh_paths enable row level security;

-- Ordered stages within a path (e.g. Digital Learning -> Knowledge Checks ->
-- On-the-Job Practice -> Sign-offs & Final Approval).
create table if not exists public.trh_stages (
  id          bigserial primary key,
  path_id     bigint not null,
  title       text   not null,
  description text,
  sort        int    not null default 100,
  active      boolean not null default true,
  created_by  text, created_at timestamptz not null default now(),
  updated_by  text, updated_at timestamptz not null default now()
);
create index if not exists trh_stages_path_idx on public.trh_stages(path_id);
alter table public.trh_stages enable row level security;

-- Requirement items inside a stage. course completion != proof of skill:
-- each kind is validated differently (digital, knowledge check, OJT practice,
-- observed practical sign-off, external credential, final manager approval).
create table if not exists public.trh_requirements (
  id            bigserial primary key,
  path_id       bigint not null,
  stage_id      bigint not null,
  kind          text   not null check (kind in
                  ('digital_course','knowledge_check','ojt_practice',
                   'practical_signoff','external_credential','manager_approval')),
  title         text   not null,
  criteria      jsonb  not null default '[]'::jsonb,  -- observable criteria lines (no single "looks good" button)
  lp_course_id  bigint,               -- link to existing lp_courses (digital_course / knowledge_check)
  position_id   bigint,               -- link to schedule_positions (practical_signoff -> "permitted to do")
  cert_type     text,                 -- external_credential match vs employee_certs.cert_type (e.g. 'Food Handler')
  min_count     int    not null default 1,   -- witnessed repetitions / practice sessions required
  approver_role text   not null default 'lead' check (approver_role in ('lead','manager','admin')),
  est_minutes   int,
  sort          int    not null default 100,
  active        boolean not null default true,
  created_by    text, created_at timestamptz not null default now(),
  updated_by    text, updated_at timestamptz not null default now()
);
create index if not exists trh_requirements_path_idx  on public.trh_requirements(path_id);
create index if not exists trh_requirements_stage_idx on public.trh_requirements(stage_id);
alter table public.trh_requirements enable row level security;

-- Per-employee path enrollment (materialized assignment; snapshot of version).
create table if not exists public.trh_enrollments (
  id           bigserial primary key,
  employee_id  bigint not null,             -- schedule_employees.id
  path_id      bigint not null,
  path_version int    not null default 1,
  status       text   not null default 'active' check (status in ('active','completed','archived')),
  assigned_by  text,
  assigned_at  timestamptz not null default now(),
  due_date     date,
  completed_at timestamptz,
  cert_id      bigint,
  note         text
);
create index if not exists trh_enrollments_emp_idx  on public.trh_enrollments(employee_id);
create index if not exists trh_enrollments_path_idx on public.trh_enrollments(path_id);
-- one ACTIVE enrollment per employee+path (history rows keep other statuses)
create unique index if not exists trh_enrollments_active_uq
  on public.trh_enrollments(employee_id, path_id) where status='active';
alter table public.trh_enrollments enable row level security;

-- Progress / sign-off log. APPEND-ONLY: every attempt and result is preserved,
-- prior sign-offs are never overwritten (spec 12.3).
create table if not exists public.trh_progress (
  id               bigserial primary key,
  enrollment_id    bigint not null,
  employee_id      bigint not null,
  requirement_id   bigint not null,
  kind             text   not null,
  status           text   not null check (status in
                     ('requested','logged','pass','partial','fail',
                      'not_observed','exception','waived','approved')),
  note             text,
  evidence_url     text,                    -- Supabase Storage URL (training-materials bucket)
  criteria_results jsonb,                   -- per-criterion checklist results
  recorded_by      text,
  recorded_role    text,
  recorded_at      timestamptz not null default now(),
  employee_ack_at  timestamptz              -- employee acknowledged the feedback
);
create index if not exists trh_progress_enr_idx on public.trh_progress(enrollment_id, requirement_id);
create index if not exists trh_progress_emp_idx on public.trh_progress(employee_id);
alter table public.trh_progress enable row level security;

-- Certification awards (e.g. Blue Apron Certification). Suspend/revoke keeps
-- the row + reason + audit; nothing is deleted.
create table if not exists public.trh_certifications (
  id            bigserial primary key,
  employee_id   bigint not null,
  path_id       bigint,
  enrollment_id bigint,
  cert_name     text   not null,
  version       int    not null default 1,      -- path version the cert was earned under
  status        text   not null default 'active' check (status in ('active','expired','suspended','revoked')),
  issued_by     text,
  issued_at     timestamptz not null default now(),
  expires_date  date,
  status_reason text,
  status_by     text,
  status_at     timestamptz,
  note          text
);
create index if not exists trh_certifications_emp_idx on public.trh_certifications(employee_id);
alter table public.trh_certifications enable row level security;

-- ============================== 2) HELPERS =================================

-- config reader (group trh_config in app_settings; admin-editable in-app)
create or replace function public._trh_cfg(p_key text, p_fb text)
returns text language sql security definer set search_path=public,extensions as $fn$
  select coalesce(nullif(btrim((select svalue from public.app_settings
                                where skey=p_key and sgroup='trh_config')),''), p_fb);
$fn$;

-- csv role matcher: does p_role contain any token of the csv list?
create or replace function public._trh_role_match(p_role text, p_csv text)
returns boolean language sql immutable as $fn$
  select exists (select 1 from unnest(string_to_array(coalesce(p_csv,''),',')) t(tok)
                 where btrim(t.tok) <> '' and coalesce(p_role,'') ilike '%'||btrim(t.tok)||'%');
$fn$;

-- caller's roster employee id
create or replace function public._trh_emp_of(p_username text)
returns bigint language sql security definer set search_path=public,extensions as $fn$
  select id from public.schedule_employees where linked_username = p_username limit 1;
$fn$;

-- notify one employee (roster id -> users.id -> push). Never throws.
create or replace function public._trh_notify_emp(p_employee_id bigint, p_title text, p_body text)
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
  exception when others then null;
  end;
end $fn$;

-- notify the manager loop. Never throws.
create or replace function public._trh_notify_mgrs(p_title text, p_body text)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
declare r record;
begin
  begin
    for r in select id from public.users
             where role ilike '%manager%' or role ilike '%admin%'
                or role ilike '%president%' or role ilike '%owner%'
    loop
      begin perform public.push_enqueue(r.id, p_title, p_body, ''); exception when others then null; end;
    end loop;
  exception when others then null;
  end;
end $fn$;

-- Did this employee complete this LMS course (pass)? READ-ONLY view of the
-- existing LMS lp_course_completions; column-guarded so a name difference
-- degrades to false instead of breaking (verify in the VERIFY block).
create or replace function public._trh_course_done(p_emp bigint, p_course_id bigint)
returns boolean language plpgsql security definer set search_path=public,extensions as $fn$
declare v_ok boolean := false;
begin
  if p_course_id is null then return false; end if;
  begin
    select exists(
      select 1 from public.lp_course_completions c
      join public.users u on u.id = c.user_id
      join public.schedule_employees se on se.linked_username = u.username
      where se.id = p_emp and c.course_id = p_course_id and coalesce(c.passed, true)
    ) into v_ok;
  exception when undefined_table or undefined_column then
    begin
      select exists(
        select 1 from public.lp_course_completions c
        where c.employee_id = p_emp and c.course_id = p_course_id and coalesce(c.passed, true)
      ) into v_ok;
    exception when others then v_ok := false;
    end;
  end;
  return coalesce(v_ok, false);
end $fn$;

-- Requirement state for one enrollment: done?, counts, latest attempt.
create or replace function public._trh_req_state(p_emp bigint, p_enr bigint, p_req bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare r public.trh_requirements%rowtype;
        v_cnt int := 0; v_done boolean := false; v_extok boolean := false;
        v_ls text; v_ln text; v_lb text; v_la timestamptz; v_lid bigint;
begin
  select * into r from public.trh_requirements where id = p_req;
  if r.id is null then return jsonb_build_object('done',false,'count',0); end if;

  if r.kind = 'ojt_practice' then
    select count(*) into v_cnt from public.trh_progress
      where enrollment_id=p_enr and requirement_id=p_req and status in ('logged','pass');
  elsif r.kind = 'practical_signoff' then
    select count(*) into v_cnt from public.trh_progress
      where enrollment_id=p_enr and requirement_id=p_req and status='pass';
  end if;

  if r.kind in ('digital_course','knowledge_check') then
    v_done := public._trh_course_done(p_emp, r.lp_course_id);
    if not v_done then  -- manual credit (legacy import / equivalent prior credit)
      v_done := exists(select 1 from public.trh_progress
                       where enrollment_id=p_enr and requirement_id=p_req and status='pass');
    end if;
  elsif r.kind in ('ojt_practice','practical_signoff') then
    v_done := v_cnt >= greatest(1, coalesce(r.min_count,1));
  elsif r.kind = 'external_credential' then
    begin
      select exists(select 1 from public.employee_certs ec
                    where ec.employee_id = p_emp
                      and ec.cert_type ilike '%'||coalesce(r.cert_type,'')||'%'
                      and coalesce(r.cert_type,'') <> ''
                      and (ec.expires_date is null or ec.expires_date >= current_date))
        into v_extok;
    exception when others then v_extok := false;
    end;
    v_done := v_extok;
  elsif r.kind = 'manager_approval' then
    v_done := exists(select 1 from public.trh_progress
                     where enrollment_id=p_enr and requirement_id=p_req and status='approved');
  end if;

  if not v_done then  -- documented exception/waiver satisfies any kind
    v_done := exists(select 1 from public.trh_progress
                     where enrollment_id=p_enr and requirement_id=p_req and status='waived');
  end if;

  select p.status, p.note, p.recorded_by, p.recorded_at, p.id
    into v_ls, v_ln, v_lb, v_la, v_lid
  from public.trh_progress p
  where p.enrollment_id=p_enr and p.requirement_id=p_req
  order by p.recorded_at desc, p.id desc limit 1;

  return jsonb_build_object(
    'done', v_done, 'count', v_cnt,
    'latest_status', v_ls, 'latest_note', v_ln, 'latest_by', v_lb,
    'latest_at', v_la, 'latest_id', v_lid,
    'pending', (v_ls = 'requested'));
end $fn$;

-- Full enrollment JSON (stages -> reqs + state, pct, next action, ready flag).
-- SHAPE CONTRACT with js/22: top-level keys read directly by the frontend.
create or replace function public._trh_enr_json(p_enrollment_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare e public.trh_enrollments%rowtype; p public.trh_paths%rowtype;
        v_stages jsonb; v_total int := 0; v_done int := 0;
        v_next jsonb; v_ready boolean := false;
begin
  select * into e from public.trh_enrollments where id = p_enrollment_id;
  if e.id is null then return null; end if;
  select * into p from public.trh_paths where id = e.path_id;

  select coalesce(jsonb_agg(z.sj order by z.s_sort, z.s_id), '[]'::jsonb) into v_stages
  from (
    select s.sort as s_sort, s.id as s_id,
      jsonb_build_object(
        'id', s.id, 'title', s.title, 'description', s.description, 'sort', s.sort,
        'reqs', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', rq.id, 'kind', rq.kind, 'title', rq.title, 'criteria', rq.criteria,
              'lp_course_id', rq.lp_course_id, 'position_id', rq.position_id,
              'position', (select sp.name from public.schedule_positions sp where sp.id = rq.position_id),
              'cert_type', rq.cert_type, 'min_count', rq.min_count,
              'approver_role', rq.approver_role, 'est_minutes', rq.est_minutes, 'sort', rq.sort)
            || public._trh_req_state(e.employee_id, e.id, rq.id)
            order by rq.sort, rq.id)
          from public.trh_requirements rq
          where rq.stage_id = s.id and rq.active), '[]'::jsonb)
      ) as sj
    from public.trh_stages s
    where s.path_id = e.path_id and s.active
  ) z;

  select count(*), count(*) filter (where coalesce((xx.elem->>'done')::boolean, false))
    into v_total, v_done
  from jsonb_array_elements(v_stages) st(elem)
  cross join lateral jsonb_array_elements(st.elem->'reqs') xx(elem);

  select xx.elem into v_next
  from jsonb_array_elements(v_stages) with ordinality st(elem, i)
  cross join lateral jsonb_array_elements(st.elem->'reqs') with ordinality xx(elem, j)
  where not coalesce((xx.elem->>'done')::boolean, false)
  order by st.i, xx.j
  limit 1;

  v_ready := (v_total > 0) and not exists (
    select 1 from jsonb_array_elements(v_stages) st(elem)
    cross join lateral jsonb_array_elements(st.elem->'reqs') xx(elem)
    where xx.elem->>'kind' <> 'manager_approval'
      and not coalesce((xx.elem->>'done')::boolean, false));

  return jsonb_build_object(
    'enrollment_id', e.id, 'employee_id', e.employee_id,
    'path_id', e.path_id, 'path_version', e.path_version,
    'title', coalesce(p.title,''), 'icon', coalesce(p.icon,'🎓'),
    'target_role', p.target_role, 'onboarding_status', p.onboarding_status,
    'cert_name', p.cert_name, 'cert_expires_days', p.cert_expires_days,
    'status', e.status, 'due_date', e.due_date,
    'assigned_at', e.assigned_at, 'assigned_by', e.assigned_by,
    'completed_at', e.completed_at, 'cert_id', e.cert_id,
    'stages', v_stages, 'total', v_total, 'done', v_done,
    'pct', case when v_total > 0 then round(100.0 * v_done / v_total) else 0 end,
    'ready', v_ready, 'next', v_next);
end $fn$;

-- internal helpers are not callable through the API
revoke execute on function public._trh_cfg(text,text)                 from anon, authenticated;
revoke execute on function public._trh_emp_of(text)                   from anon, authenticated;
revoke execute on function public._trh_notify_emp(bigint,text,text)   from anon, authenticated;
revoke execute on function public._trh_notify_mgrs(text,text)         from anon, authenticated;
revoke execute on function public._trh_course_done(bigint,bigint)     from anon, authenticated;
revoke execute on function public._trh_req_state(bigint,bigint,bigint) from anon, authenticated;
revoke execute on function public._trh_enr_json(bigint)               from anon, authenticated;

-- ============================== 3) RPCs ====================================

-- ---- trh_my : the employee's own Training Hub home --------------------------
-- Returns { employee_id, employee_name, enrollments:[enrJson...],
--           certs:[...], ext_certs:[...] }
create or replace function public.trh_my(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint; v_emp_name text;
        v_enr jsonb; v_certs jsonb; v_ext jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  v_emp := public._trh_emp_of(p_username);
  if v_emp is null then
    return jsonb_build_object('employee_id', null, 'employee_name', v_name,
      'enrollments','[]'::jsonb,'certs','[]'::jsonb,'ext_certs','[]'::jsonb);
  end if;
  select name into v_emp_name from public.schedule_employees where id = v_emp;

  select coalesce(jsonb_agg(public._trh_enr_json(e.id)
           order by case e.status when 'active' then 0 else 1 end, e.assigned_at desc), '[]'::jsonb)
    into v_enr
  from public.trh_enrollments e
  where e.employee_id = v_emp and e.status in ('active','completed');

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'cert_name', c.cert_name, 'issued_by', c.issued_by,
      'issued_at', c.issued_at, 'expires_date', c.expires_date, 'version', c.version,
      'status', case when c.status='active' and c.expires_date is not null
                      and c.expires_date < current_date then 'expired' else c.status end)
      order by c.issued_at desc), '[]'::jsonb)
    into v_certs
  from public.trh_certifications c where c.employee_id = v_emp;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'type', cert_type, 'number', cert_number, 'issued', issued_date, 'expires', expires_date)
        order by expires_date nulls last), '[]'::jsonb)
      into v_ext
    from public.employee_certs where employee_id = v_emp;
  exception when others then v_ext := '[]'::jsonb;
  end;

  return jsonb_build_object('employee_id', v_emp, 'employee_name', coalesce(v_emp_name, v_name),
    'enrollments', v_enr, 'certs', v_certs, 'ext_certs', v_ext);
end $fn$;

-- ---- trh_request_signoff : employee asks a leader to observe/sign off ------
create or replace function public.trh_request_signoff(
  p_username text, p_password text, p_enrollment_id bigint, p_requirement_id bigint, p_note text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint;
        e public.trh_enrollments%rowtype; r public.trh_requirements%rowtype;
        v_last text; v_ptitle text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  v_emp := public._trh_emp_of(p_username);
  select * into e from public.trh_enrollments where id = p_enrollment_id;
  if e.id is null or e.status <> 'active' then raise exception 'not_found'; end if;
  if v_emp is null or e.employee_id <> v_emp then raise exception 'forbidden'; end if;
  select * into r from public.trh_requirements where id = p_requirement_id and path_id = e.path_id;
  if r.id is null then raise exception 'not_found'; end if;
  if r.kind in ('digital_course','knowledge_check') then raise exception 'complete_in_training_portal'; end if;

  select status into v_last from public.trh_progress
    where enrollment_id = e.id and requirement_id = r.id
    order by recorded_at desc, id desc limit 1;
  if v_last = 'requested' then raise exception 'already_requested'; end if;

  insert into public.trh_progress(enrollment_id,employee_id,requirement_id,kind,status,note,recorded_by,recorded_role)
  values (e.id, e.employee_id, r.id, r.kind, 'requested', nullif(btrim(p_note),''), v_name, 'self');

  select title into v_ptitle from public.trh_paths where id = e.path_id;
  if public._trh_cfg('trh_notify_signoff_request','yes') = 'yes' then
    perform public._trh_notify_mgrs('🎓 Sign-off requested',
      format('%s is ready for "%s" (%s).', v_name, r.title, coalesce(v_ptitle,'learning path')));
  end if;
  perform public._pp_audit(v_uid, v_name, 'trh_signoff_request', e.employee_id, null,
    jsonb_build_object('enrollment_id',e.id,'requirement_id',r.id,'title',r.title), nullif(btrim(p_note),''));
  return jsonb_build_object('ok', true);
end $fn$;

-- ---- trh_ack : employee acknowledges sign-off feedback ----------------------
create or replace function public.trh_ack(p_username text, p_password text, p_progress_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  v_emp := public._trh_emp_of(p_username);
  update public.trh_progress set employee_ack_at = now()
   where id = p_progress_id and employee_id = v_emp and employee_ack_at is null;
  return jsonb_build_object('ok', true);
end $fn$;

-- ---- trh_team : manager/lead dashboard --------------------------------------
-- Returns { pending:[...], team:[...], recent_certs:[...] }
create or replace function public.trh_team(p_username text, p_password text, p_store text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_pending jsonb; v_team jsonb := '[]'::jsonb;
        v_certs jsonb; e record; j jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%' or v_role ilike '%president%') then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'progress_id', pr.id, 'enrollment_id', pr.enrollment_id, 'requirement_id', pr.requirement_id,
      'employee_id', en.employee_id,
      'employee', (select se.name from public.schedule_employees se where se.id = en.employee_id),
      'req_title', rq.title, 'kind', rq.kind, 'criteria', rq.criteria,
      'min_count', rq.min_count, 'approver_role', rq.approver_role,
      'path_title', (select pp.title from public.trh_paths pp where pp.id = en.path_id),
      'requested_at', pr.recorded_at, 'note', pr.note)
      order by pr.recorded_at asc), '[]'::jsonb)
    into v_pending
  from public.trh_progress pr
  join public.trh_enrollments en on en.id = pr.enrollment_id and en.status = 'active'
  join public.trh_requirements rq on rq.id = pr.requirement_id
  where pr.status = 'requested'
    and not exists (select 1 from public.trh_progress p2
                    where p2.enrollment_id = pr.enrollment_id
                      and p2.requirement_id = pr.requirement_id
                      and p2.id > pr.id and p2.status <> 'requested')
    and (coalesce(p_store,'') = '' or coalesce(public._tg_emp_location(en.employee_id),'') = p_store);

  for e in
    select en.id
    from public.trh_enrollments en
    where en.status = 'active'
      and (coalesce(p_store,'') = '' or coalesce(public._tg_emp_location(en.employee_id),'') = p_store)
    order by en.assigned_at desc
  loop
    j := public._trh_enr_json(e.id);
    if j is not null then
      j := j || jsonb_build_object(
        'name', (select se.name from public.schedule_employees se where se.id = (j->>'employee_id')::bigint),
        'role', (select u.role from public.users u join public.schedule_employees se
                   on se.linked_username = u.username where se.id = (j->>'employee_id')::bigint limit 1),
        'store', coalesce(public._tg_emp_location((j->>'employee_id')::bigint),''),
        'pending_count', (select count(*) from public.trh_progress pr
                           where pr.enrollment_id = (j->>'enrollment_id')::bigint and pr.status='requested'
                             and not exists (select 1 from public.trh_progress p2
                                             where p2.enrollment_id = pr.enrollment_id
                                               and p2.requirement_id = pr.requirement_id
                                               and p2.id > pr.id and p2.status <> 'requested')));
      v_team := v_team || jsonb_build_array(j - 'stages' - 'next');
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'employee_id', c.employee_id,
      'employee', (select se.name from public.schedule_employees se where se.id = c.employee_id),
      'cert_name', c.cert_name, 'issued_by', c.issued_by, 'issued_at', c.issued_at,
      'expires_date', c.expires_date, 'version', c.version,
      'status', case when c.status='active' and c.expires_date is not null
                      and c.expires_date < current_date then 'expired' else c.status end,
      'status_reason', c.status_reason)
      order by c.issued_at desc), '[]'::jsonb)
    into v_certs
  from (select * from public.trh_certifications order by issued_at desc limit 50) c;

  return jsonb_build_object('pending', v_pending, 'team', v_team, 'recent_certs', v_certs);
end $fn$;

-- ---- trh_emp_detail : one enrollment in full (manager/lead OR self) --------
-- Returns { enrollment:{enrJson}, employee:{id,name} }
create or replace function public.trh_emp_detail(p_username text, p_password text, p_enrollment_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; e public.trh_enrollments%rowtype; v_self boolean;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  select * into e from public.trh_enrollments where id = p_enrollment_id;
  if e.id is null then raise exception 'not_found'; end if;
  v_self := public._pp_is_self(p_username, e.employee_id);
  if not (v_self or v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%' or v_role ilike '%president%') then
    raise exception 'forbidden';
  end if;
  return jsonb_build_object(
    'enrollment', public._trh_enr_json(e.id),
    'employee', jsonb_build_object('id', e.employee_id,
      'name', (select name from public.schedule_employees where id = e.employee_id)));
end $fn$;

-- ---- trh_record : leader records OJT log / practical sign-off / approval ----
-- Statuses: logged (OJT practice session), pass, partial, fail, not_observed,
-- exception, waived (documented equivalent credit), approved (final approval).
-- APPEND-ONLY — never updates prior rows. A failed/partial result is
-- remediation guidance, never automatic discipline.
create or replace function public.trh_record(
  p_username text, p_password text, p_enrollment_id bigint, p_requirement_id bigint,
  p_status text, p_note text, p_evidence_url text, p_criteria_results jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text;
        e public.trh_enrollments%rowtype; r public.trh_requirements%rowtype;
        v_is_admin boolean; v_is_mgr boolean; v_is_lead boolean; v_ok boolean := false;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if p_status not in ('logged','pass','partial','fail','not_observed','exception','waived','approved') then
    raise exception 'bad_status';
  end if;
  select * into e from public.trh_enrollments where id = p_enrollment_id;
  if e.id is null or e.status <> 'active' then raise exception 'not_found'; end if;
  select * into r from public.trh_requirements where id = p_requirement_id and path_id = e.path_id;
  if r.id is null then raise exception 'not_found'; end if;

  v_is_admin := (v_role ilike '%admin%' or v_role ilike '%president%' or v_role ilike '%owner%');
  v_is_mgr   := (v_is_admin or v_role ilike '%manager%' or v_role ilike '%VP%');
  v_is_lead  := (v_role ilike '%lead%');

  -- who may record what (spec 12.3 / AC-05: leads observe, cannot issue
  -- restricted approvals). waived/approved require final-approver roles.
  if p_status in ('waived','approved') then
    v_ok := public._trh_role_match(v_role, public._trh_cfg('trh_final_approver_roles','manager,admin,president,owner,VP'));
  else
    if r.approver_role = 'admin' then v_ok := v_is_admin;
    elsif r.approver_role = 'manager' then v_ok := v_is_mgr;
    else v_ok := v_is_mgr or (v_is_lead and public._trh_role_match(v_role,
           public._trh_cfg('trh_observer_roles','lead,manager,admin,president,owner,VP')));
    end if;
  end if;
  if not v_ok then raise exception 'forbidden'; end if;

  -- explanation required for anything that isn't a clean pass/log/approve
  if p_status in ('partial','fail','exception','waived','not_observed')
     and coalesce(btrim(p_note),'') = '' then
    raise exception 'note_required';
  end if;
  if p_status = 'approved' and r.kind <> 'manager_approval' then raise exception 'bad_status'; end if;

  insert into public.trh_progress(enrollment_id,employee_id,requirement_id,kind,status,note,
                                  evidence_url,criteria_results,recorded_by,recorded_role)
  values (e.id, e.employee_id, r.id, r.kind, p_status, nullif(btrim(p_note),''),
          nullif(btrim(p_evidence_url),''), p_criteria_results, v_name, v_role);

  perform public._pp_audit(v_uid, v_name, 'trh_record', e.employee_id, null,
    jsonb_build_object('enrollment_id',e.id,'requirement_id',r.id,'title',r.title,'status',p_status),
    nullif(btrim(p_note),''));

  if public._trh_cfg('trh_notify_progress','yes') = 'yes' and p_status <> 'logged' then
    perform public._trh_notify_emp(e.employee_id, '🎓 Training update',
      format('"%s" was marked %s%s.', r.title, replace(p_status,'_',' '),
             case when p_status='pass' then ' — nice work!' else '' end));
  end if;
  return jsonb_build_object('ok', true);
end $fn$;

-- ---- trh_award_cert : final approval -> certification award -----------------
-- Validates every requirement is satisfied (or explicit documented override),
-- writes trh_certifications, MIRRORS into employee_certs (so the Development
-- Passport / app_passport_get shows it), and — config-gated — grants position
-- clearance + raises passport level for every passed practical-sign-off
-- station, so the cert reflects "permitted to do".
create or replace function public.trh_award_cert(
  p_username text, p_password text, p_enrollment_id bigint,
  p_note text, p_expires date, p_override boolean)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text;
        e public.trh_enrollments%rowtype; p public.trh_paths%rowtype;
        j jsonb; v_ready boolean; v_cert_id bigint; v_cert_name text;
        v_exp date; v_days int; v_lvl text; rp record; v_emp_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._trh_role_match(v_role, public._trh_cfg('trh_final_approver_roles','manager,admin,president,owner,VP')) then
    raise exception 'forbidden';
  end if;
  select * into e from public.trh_enrollments where id = p_enrollment_id;
  if e.id is null or e.status <> 'active' then raise exception 'not_found'; end if;
  select * into p from public.trh_paths where id = e.path_id;
  v_cert_name := coalesce(nullif(btrim(p.cert_name),''), p.title || ' Certification');

  j := public._trh_enr_json(e.id);
  v_ready := coalesce((j->>'ready')::boolean, false);
  if not v_ready and not coalesce(p_override, false) then raise exception 'not_ready'; end if;
  if coalesce(p_override, false) and not v_ready and coalesce(btrim(p_note),'') = '' then
    raise exception 'note_required';  -- overriding prerequisites requires an explanation
  end if;

  v_exp := p_expires;
  if v_exp is null then
    v_days := coalesce(p.cert_expires_days,
                nullif(public._trh_cfg('trh_default_cert_expires_days',''),'')::int, 0);
    if coalesce(v_days,0) > 0 then v_exp := current_date + v_days; end if;
  end if;

  insert into public.trh_certifications(employee_id,path_id,enrollment_id,cert_name,version,
                                        status,issued_by,expires_date,note)
  values (e.employee_id, e.path_id, e.id, v_cert_name, e.path_version,
          'active', v_name, v_exp, nullif(btrim(p_note),''))
  returning id into v_cert_id;

  -- close out any still-open final-approval requirement rows
  insert into public.trh_progress(enrollment_id,employee_id,requirement_id,kind,status,note,recorded_by,recorded_role)
  select e.id, e.employee_id, rq.id, rq.kind, 'approved',
         'Approved with '||v_cert_name, v_name, v_role
  from public.trh_requirements rq
  where rq.path_id = e.path_id and rq.active and rq.kind = 'manager_approval'
    and not exists (select 1 from public.trh_progress pr
                    where pr.enrollment_id = e.id and pr.requirement_id = rq.id and pr.status = 'approved');

  -- mirror into the shared Development Passport cert list (guarded)
  begin
    insert into public.employee_certs(employee_id, cert_type, issued_date, expires_date)
    select e.employee_id, v_cert_name, current_date, v_exp
    where not exists (select 1 from public.employee_certs ec
                      where ec.employee_id = e.employee_id and ec.cert_type = v_cert_name
                        and coalesce(ec.expires_date, '9999-12-31'::date) >= current_date);
  exception when others then null;
  end;

  -- "permitted to do": clearance + passport level per passed sign-off station
  if public._trh_cfg('trh_award_sets_clearance','yes') = 'yes' then
    for rp in select distinct rq.position_id
              from public.trh_requirements rq
              where rq.path_id = e.path_id and rq.active
                and rq.kind = 'practical_signoff' and rq.position_id is not null
    loop
      begin
        insert into public.employee_position_clearance(employee_id, position_id)
        select e.employee_id, rp.position_id
        where not exists (select 1 from public.employee_position_clearance c
                          where c.employee_id = e.employee_id and c.position_id = rp.position_id);
      exception when others then null;
      end;
      v_lvl := public._trh_cfg('trh_award_passport_level','Qualified');
      if v_lvl <> '' and v_lvl in ('Learning','Developing','Qualified','Ace','Coach') then
        begin
          insert into public.employee_passport(employee_id,position_id,level,approved_by,approved_role,approved_at,signoff_note)
          values (e.employee_id, rp.position_id, v_lvl, v_name, v_role, now(), 'Awarded with '||v_cert_name)
          on conflict (employee_id,position_id) do update
            set level = excluded.level, approved_by = excluded.approved_by,
                approved_role = excluded.approved_role, approved_at = now(),
                signoff_note = excluded.signoff_note, updated_at = now()
            where public._pp_rank(employee_passport.level) < public._pp_rank(excluded.level);
        exception when others then null;
        end;
      end if;
    end loop;
  end if;

  update public.trh_enrollments
     set status = 'completed', completed_at = now(), cert_id = v_cert_id
   where id = e.id;

  select name into v_emp_name from public.schedule_employees where id = e.employee_id;
  perform public._pp_audit(v_uid, v_name, 'trh_cert_award', e.employee_id,
    jsonb_build_object('ready', v_ready),
    jsonb_build_object('cert_id', v_cert_id, 'cert_name', v_cert_name,
                       'path_id', e.path_id, 'version', e.path_version,
                       'expires', v_exp, 'override', coalesce(p_override,false) and not v_ready),
    nullif(btrim(p_note),''));
  if public._trh_cfg('trh_notify_award','yes') = 'yes' then
    perform public._trh_notify_emp(e.employee_id, '🏅 Certification earned!',
      format('Congratulations — you earned the %s.', v_cert_name));
    perform public._trh_notify_mgrs('🏅 Certification awarded',
      format('%s awarded the %s to %s.', v_name, v_cert_name, coalesce(v_emp_name,'an employee')));
  end if;
  return jsonb_build_object('ok', true, 'cert_id', v_cert_id, 'cert_name', v_cert_name, 'expires', v_exp);
end $fn$;

-- ---- trh_cert_status : suspend / revoke / reinstate / expire (with reason) --
create or replace function public.trh_cert_status(
  p_username text, p_password text, p_cert_id bigint, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; c public.trh_certifications%rowtype;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._trh_role_match(v_role, public._trh_cfg('trh_final_approver_roles','manager,admin,president,owner,VP')) then
    raise exception 'forbidden';
  end if;
  if p_status not in ('active','expired','suspended','revoked') then raise exception 'bad_status'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into c from public.trh_certifications where id = p_cert_id;
  if c.id is null then raise exception 'not_found'; end if;

  update public.trh_certifications
     set status = p_status, status_reason = btrim(p_reason), status_by = v_name, status_at = now()
   where id = p_cert_id;

  perform public._pp_audit(v_uid, v_name, 'trh_cert_status', c.employee_id,
    jsonb_build_object('cert_id', c.id, 'cert_name', c.cert_name, 'status', c.status),
    jsonb_build_object('cert_id', c.id, 'cert_name', c.cert_name, 'status', p_status),
    btrim(p_reason));
  return jsonb_build_object('ok', true);
end $fn$;

-- ---- trh_enroll : assign a path to employees (dedupe, notify, audit) --------
create or replace function public.trh_enroll(
  p_username text, p_password text, p_path_id bigint, p_employee_ids bigint[], p_due date)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; p public.trh_paths%rowtype;
        v_id bigint; v_n int := 0; v_skip int := 0; v_eid bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%' or v_role ilike '%president%') then
    raise exception 'forbidden';
  end if;
  select * into p from public.trh_paths where id = p_path_id and active;
  if p.id is null then raise exception 'not_found'; end if;

  foreach v_eid in array coalesce(p_employee_ids, '{}'::bigint[]) loop
    if exists (select 1 from public.trh_enrollments
               where employee_id = v_eid and path_id = p.id and status = 'active') then
      v_skip := v_skip + 1;  -- idempotent: no duplicate assignments
      continue;
    end if;
    insert into public.trh_enrollments(employee_id, path_id, path_version, assigned_by, due_date)
    values (v_eid, p.id, p.version, v_name, p_due)
    returning id into v_id;
    v_n := v_n + 1;
    perform public._pp_audit(v_uid, v_name, 'trh_enroll', v_eid, null,
      jsonb_build_object('enrollment_id', v_id, 'path_id', p.id, 'path', p.title,
                         'version', p.version, 'due', p_due), null);
    perform public._trh_notify_emp(v_eid, '🎓 New learning path',
      format('You''ve been assigned "%s"%s. Open the Training Hub to get started.',
             p.title, case when p_due is not null then ' (due '||to_char(p_due,'Mon DD')||')' else '' end));
  end loop;
  return jsonb_build_object('ok', true, 'enrolled', v_n, 'skipped', v_skip);
end $fn$;

-- ---- trh_admin_get : everything the path builder needs ----------------------
-- Returns { paths:[{...,stages:[{...,reqs:[...]}]}], lp_paths:[], lp_courses:[],
--           positions:[], employees:[], config:[] }
create or replace function public.trh_admin_get(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text;
        v_paths jsonb; v_lpp jsonb := '[]'::jsonb; v_lpc jsonb := '[]'::jsonb;
        v_pos jsonb; v_emps jsonb; v_cfg jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%' or v_role ilike '%president%') then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(pj order by p_sort, p_id), '[]'::jsonb) into v_paths
  from (
    select p.sort as p_sort, p.id as p_id, jsonb_build_object(
      'id', p.id, 'code', p.code, 'title', p.title, 'description', p.description,
      'icon', p.icon, 'target_role', p.target_role, 'onboarding_status', p.onboarding_status,
      'cert_name', p.cert_name, 'cert_expires_days', p.cert_expires_days,
      'lp_path_id', p.lp_path_id, 'version', p.version, 'active', p.active, 'sort', p.sort,
      'enrolled_count', (select count(*) from public.trh_enrollments en
                         where en.path_id = p.id and en.status = 'active'),
      'stages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'title', s.title, 'description', s.description, 'sort', s.sort, 'active', s.active,
          'reqs', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', rq.id, 'kind', rq.kind, 'title', rq.title, 'criteria', rq.criteria,
              'lp_course_id', rq.lp_course_id, 'position_id', rq.position_id,
              'cert_type', rq.cert_type, 'min_count', rq.min_count,
              'approver_role', rq.approver_role, 'est_minutes', rq.est_minutes,
              'sort', rq.sort, 'active', rq.active)
              order by rq.sort, rq.id)
            from public.trh_requirements rq where rq.stage_id = s.id and rq.active), '[]'::jsonb))
          order by s.sort, s.id)
        from public.trh_stages s where s.path_id = p.id and s.active), '[]'::jsonb)
    ) as pj
    from public.trh_paths p where p.active
  ) z;

  begin
    select coalesce(jsonb_agg(jsonb_build_object('id', lp.id, 'title', lp.title) order by lp.title),'[]'::jsonb)
      into v_lpp from public.learning_paths lp;
  exception when others then v_lpp := '[]'::jsonb;
  end;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'path_id', c.path_id, 'title', c.title)
             order by c.path_id, c.title),'[]'::jsonb)
      into v_lpc from public.lp_courses c;
  exception when others then v_lpc := '[]'::jsonb;
  end;

  select coalesce(jsonb_agg(jsonb_build_object('id', sp.id, 'name', sp.name) order by sp.sort_order, sp.name),'[]'::jsonb)
    into v_pos from public.schedule_positions sp where sp.active;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', se.id, 'name', se.name,
      'role', (select u.role from public.users u where u.username = se.linked_username limit 1),
      'store', coalesce(public._tg_emp_location(se.id),''))
      order by se.name),'[]'::jsonb)
    into v_emps from public.schedule_employees se;

  select coalesce(jsonb_agg(jsonb_build_object('key', skey, 'label', label, 'value', svalue) order by sort, skey),'[]'::jsonb)
    into v_cfg from public.app_settings where sgroup = 'trh_config';

  return jsonb_build_object('paths', v_paths, 'lp_paths', v_lpp, 'lp_courses', v_lpc,
                            'positions', v_pos, 'employees', v_emps, 'config', v_cfg);
end $fn$;

-- ---- trh_path_save ----------------------------------------------------------
create or replace function public.trh_path_save(
  p_username text, p_password text, p_id bigint, p_code text, p_title text,
  p_description text, p_icon text, p_target_role text, p_onboarding_status text,
  p_cert_name text, p_cert_expires_days int, p_lp_path_id bigint, p_sort int, p_active boolean)
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
    insert into public.trh_paths(code,title,description,icon,target_role,onboarding_status,
                                 cert_name,cert_expires_days,lp_path_id,sort,active,created_by,updated_by)
    values (nullif(btrim(p_code),''), btrim(p_title), nullif(btrim(p_description),''),
            coalesce(nullif(btrim(p_icon),''),'🎓'), nullif(btrim(p_target_role),''),
            nullif(btrim(p_onboarding_status),''), nullif(btrim(p_cert_name),''),
            p_cert_expires_days, p_lp_path_id, coalesce(p_sort,100), coalesce(p_active,true), v_name, v_name)
    returning id into v_id;
  else
    update public.trh_paths
       set code = nullif(btrim(p_code),''), title = btrim(p_title),
           description = nullif(btrim(p_description),''),
           icon = coalesce(nullif(btrim(p_icon),''),'🎓'),
           target_role = nullif(btrim(p_target_role),''),
           onboarding_status = nullif(btrim(p_onboarding_status),''),
           cert_name = nullif(btrim(p_cert_name),''),
           cert_expires_days = p_cert_expires_days, lp_path_id = p_lp_path_id,
           sort = coalesce(p_sort,100), active = coalesce(p_active,true),
           updated_by = v_name, updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  begin
    perform public._pp_audit(v_uid, v_name, 'trh_path_save', null, null,
      jsonb_build_object('path_id', v_id, 'title', btrim(p_title)), null);
  exception when others then null;  -- audit_log.affected_employee_id may be NOT NULL
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

-- ---- trh_stage_save (bumps path version) ------------------------------------
create or replace function public.trh_stage_save(
  p_username text, p_password text, p_id bigint, p_path_id bigint,
  p_title text, p_description text, p_sort int, p_active boolean)
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
  if not exists (select 1 from public.trh_paths where id = p_path_id) then raise exception 'not_found'; end if;
  if p_id is null then
    insert into public.trh_stages(path_id,title,description,sort,active,created_by,updated_by)
    values (p_path_id, btrim(p_title), nullif(btrim(p_description),''),
            coalesce(p_sort,100), coalesce(p_active,true), v_name, v_name)
    returning id into v_id;
  else
    update public.trh_stages
       set title = btrim(p_title), description = nullif(btrim(p_description),''),
           sort = coalesce(p_sort,100), active = coalesce(p_active,true),
           updated_by = v_name, updated_at = now()
     where id = p_id and path_id = p_path_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  update public.trh_paths set version = version + 1, updated_by = v_name, updated_at = now()
   where id = p_path_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

-- ---- trh_req_save (bumps path version) ---------------------------------------
create or replace function public.trh_req_save(
  p_username text, p_password text, p_id bigint, p_path_id bigint, p_stage_id bigint,
  p_kind text, p_title text, p_criteria jsonb, p_lp_course_id bigint, p_position_id bigint,
  p_cert_type text, p_min_count int, p_approver_role text, p_est_minutes int,
  p_sort int, p_active boolean)
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
  if p_kind not in ('digital_course','knowledge_check','ojt_practice',
                    'practical_signoff','external_credential','manager_approval') then
    raise exception 'bad_kind';
  end if;
  if coalesce(p_approver_role,'lead') not in ('lead','manager','admin') then raise exception 'bad_role'; end if;
  if not exists (select 1 from public.trh_stages where id = p_stage_id and path_id = p_path_id) then
    raise exception 'not_found';
  end if;
  if p_id is null then
    insert into public.trh_requirements(path_id,stage_id,kind,title,criteria,lp_course_id,position_id,
                                        cert_type,min_count,approver_role,est_minutes,sort,active,created_by,updated_by)
    values (p_path_id, p_stage_id, p_kind, btrim(p_title), coalesce(p_criteria,'[]'::jsonb),
            p_lp_course_id, p_position_id, nullif(btrim(p_cert_type),''),
            greatest(1, coalesce(p_min_count,1)), coalesce(p_approver_role,'lead'),
            p_est_minutes, coalesce(p_sort,100), coalesce(p_active,true), v_name, v_name)
    returning id into v_id;
  else
    update public.trh_requirements
       set stage_id = p_stage_id, kind = p_kind, title = btrim(p_title),
           criteria = coalesce(p_criteria,'[]'::jsonb), lp_course_id = p_lp_course_id,
           position_id = p_position_id, cert_type = nullif(btrim(p_cert_type),''),
           min_count = greatest(1, coalesce(p_min_count,1)),
           approver_role = coalesce(p_approver_role,'lead'), est_minutes = p_est_minutes,
           sort = coalesce(p_sort,100), active = coalesce(p_active,true),
           updated_by = v_name, updated_at = now()
     where id = p_id and path_id = p_path_id returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  update public.trh_paths set version = version + 1, updated_by = v_name, updated_at = now()
   where id = p_path_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

-- ---- trh_archive : archive (never delete) a path / stage / requirement ------
create or replace function public.trh_archive(p_username text, p_password text, p_kind text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_path bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%'
          or v_role ilike '%owner%' or v_role ilike '%VP%' or v_role ilike '%president%') then
    raise exception 'forbidden';
  end if;
  if p_kind = 'path' then
    update public.trh_paths set active = false, updated_by = v_name, updated_at = now() where id = p_id;
  elsif p_kind = 'stage' then
    update public.trh_stages set active = false, updated_by = v_name, updated_at = now()
     where id = p_id returning path_id into v_path;
  elsif p_kind = 'requirement' then
    update public.trh_requirements set active = false, updated_by = v_name, updated_at = now()
     where id = p_id returning path_id into v_path;
  else
    raise exception 'bad_kind';
  end if;
  if v_path is not null then
    update public.trh_paths set version = version + 1, updated_by = v_name, updated_at = now()
     where id = v_path;
  end if;
  begin
    perform public._pp_audit(v_uid, v_name, 'trh_archive', null, null,
      jsonb_build_object('kind', p_kind, 'id', p_id), null);
  exception when others then null;  -- audit_log.affected_employee_id may be NOT NULL
  end;
  return jsonb_build_object('ok', true);
end $fn$;

-- ============================ 4) CONFIG SEED ================================
-- Group trh_config — every tunable admin-editable in-app (Business Settings).
insert into public.app_settings(skey, sgroup, label, svalue, sort)
values
  ('trh_white_apron_label',       'trh_config', 'Onboarding status label (aspiring cert holders)', 'White Apron', 10),
  ('trh_blue_apron_cert',         'trh_config', 'Default onboarding certification name',           'Blue Apron Certification', 20),
  ('trh_final_approver_roles',    'trh_config', 'Roles that may award/waive/suspend certifications (csv, matched against user role)', 'manager,admin,president,owner,VP', 30),
  ('trh_observer_roles',          'trh_config', 'Roles that may observe & record sign-offs (csv)', 'lead,manager,admin,president,owner,VP', 40),
  ('trh_award_sets_clearance',    'trh_config', 'Cert award grants position clearance for passed sign-off stations (yes/no)', 'yes', 50),
  ('trh_award_passport_level',    'trh_config', 'Passport level set on award (Learning/Developing/Qualified/Ace/Coach, blank = leave passport alone)', 'Qualified', 60),
  ('trh_default_cert_expires_days','trh_config','Default certification validity in days (blank/0 = never expires)', '', 70),
  ('trh_default_min_signoffs',    'trh_config', 'Default witnessed repetitions per practical sign-off', '1', 80),
  ('trh_default_ojt_sessions',    'trh_config', 'Default guided-practice sessions per OJT requirement', '3', 90),
  ('trh_notify_signoff_request',  'trh_config', 'Push managers when an employee requests a sign-off (yes/no)', 'yes', 100),
  ('trh_notify_progress',         'trh_config', 'Push the employee when a sign-off result is recorded (yes/no)', 'yes', 110),
  ('trh_notify_award',            'trh_config', 'Push on certification award (yes/no)', 'yes', 120)
on conflict (skey) do nothing;

-- ============================ 5) STARTER PATHS ==============================
-- Seeded ONLY if the catalog is empty. These are editable admin DATA rows
-- (not code): the Master Matrix fills in courses/criteria later. Crew Trainer
-- is intentionally NOT seeded — adding it later is just a new trh_paths row.
do $seed$
declare v_pid bigint; v_sid_dig bigint; v_sid_kc bigint; v_sid_ojt bigint; v_sid_fin bigint;
        r record;
begin
  if exists (select 1 from public.trh_paths) then return; end if;

  -- 1) White Apron -> Blue Apron (the core onboarding progression)
  insert into public.trh_paths(code,title,description,icon,target_role,onboarding_status,cert_name,sort,created_by)
  values ('BLUE','White → Blue Apron',
          'Onboarding qualification path. A White Apron is an aspiring Blue Apron: digital learning, knowledge checks, guided practice, practical sign-offs, then final manager approval awards the Blue Apron Certification.',
          '🔵','Crew','White Apron','Blue Apron Certification',10,'seed')
  returning id into v_pid;

  insert into public.trh_stages(path_id,title,description,sort,created_by) values
    (v_pid,'Digital Learning','Culture, safety, menu knowledge, guest service, store flow, item making, register & security, operating expectations.',10,'seed')
    returning id into v_sid_dig;
  insert into public.trh_stages(path_id,title,description,sort,created_by) values
    (v_pid,'Knowledge Checks','Ready for Blue — knowledge validation quizzes.',20,'seed')
    returning id into v_sid_kc;
  insert into public.trh_stages(path_id,title,description,sort,created_by) values
    (v_pid,'On-the-Job Practice','Guided practice during scheduled shifts, logged by observing leaders.',30,'seed')
    returning id into v_sid_ojt;
  insert into public.trh_stages(path_id,title,description,sort,created_by) values
    (v_pid,'Sign-offs & Final Approval','Practical sign-offs against defined criteria, then Store Manager final review.',40,'seed')
    returning id into v_sid_fin;

  insert into public.trh_requirements(path_id,stage_id,kind,title,criteria,min_count,approver_role,est_minutes,sort,created_by) values
    (v_pid,v_sid_ojt,'ojt_practice','Guided practice shifts','["Practiced with an observing leader","Station, date and confidence level noted"]',3,'lead',null,10,'seed'),
    (v_pid,v_sid_fin,'practical_signoff','Station skills demonstration','["Follows procedure without prompting","Meets speed and accuracy standards","Safe food handling throughout","Clean as you go"]',1,'lead',null,10,'seed'),
    (v_pid,v_sid_fin,'external_credential','Food Handler Card on file','[]',1,'manager',null,20,'seed'),
    (v_pid,v_sid_fin,'manager_approval','Blue Apron final review','["All prerequisites verified","Ready to work independently"]',1,'manager',null,30,'seed');
  update public.trh_requirements set cert_type='Food Handler'
   where path_id=v_pid and kind='external_credential';

  -- 2..8) Role path shells (admins fill requirements from the Master Matrix)
  for r in select * from (values
      ('SL',  'Shift Leader Path',            'Shift Leader',        'Shift Leader Qualification',        20),
      ('AM',  'Assistant Manager Path',       'Assistant Manager',   'Assistant Manager Qualification',   30),
      ('SM',  'Store Manager Path',           'Store Manager',       'Store Manager Qualification',       40),
      ('EXEC','Multi-Location Leadership Path','Multi-Location Leader','Multi-Location Leadership Qualification',50),
      ('CAT', 'Catering & Mobile Vending Path','Catering / Vending', 'Event Lead Qualification',          60),
      ('WH',  'Warehouse & Fulfillment Path', 'Warehouse',           'Warehouse & Fulfillment Qualification',70),
      ('MAINT','Maintenance Path',            'Maintenance',         'Maintenance Qualification',         80)
    ) t(code,title,target_role,cert_name,sort)
  loop
    insert into public.trh_paths(code,title,description,icon,target_role,cert_name,sort,created_by)
    values (r.code, r.title, 'Support path shell — requirements are configured from the Master Training & Certification Matrix.',
            '🎓', r.target_role, r.cert_name, r.sort, 'seed')
    returning id into v_pid;
    insert into public.trh_stages(path_id,title,sort,created_by) values
      (v_pid,'Digital Learning',10,'seed'),
      (v_pid,'Knowledge Checks',20,'seed'),
      (v_pid,'On-the-Job Practice',30,'seed'),
      (v_pid,'Sign-offs & Final Approval',40,'seed');
  end loop;
end $seed$;

-- ============================== VERIFY =====================================
-- Run BEFORE prod apply (all should return rows / true):
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
--   4) app_settings columns are (skey,sgroup,label,svalue,sort)  ✔ per admin_settings.sql
-- SMOKE (test accounts PIN 1111; replace <ids>):
--   select public.trh_admin_get('test_admin','1111');
--   select public.trh_enroll('test_admin','1111',(select id from trh_paths where code='BLUE'),array[<empId>]::bigint[], current_date+14);
--   select public.trh_my('test_crew','1111');
--   select public.trh_record('test_admin','1111',<enrId>,<reqId>,'pass','Solid demo',null,null);
--   select public.trh_award_cert('test_admin','1111',<enrId>,null,null,false);
-- ============================================================================
