-- ============================================================================
-- SHIFT LEADER CONSOLE / ACTIVE SHIFT MODE  (shift_console.sql)  — ADDITIVE ONLY
-- Pairs with js/19_shift_console.js (entry openShiftConsole()).
--
-- WHAT IS NEW HERE (shc_*): only the genuinely-new state —
--   * shc_shift_sessions   : the active-shift session (parent object that links
--                            checklist/temp/log-book/closeout work + recap)
--   * shc_session_events   : per-session audit/event trail (notes, smart-prompt
--                            accepted/dismissed, quick actions, start/end/reopen)
--   * shc_store_priorities : short "Store Priority" cards (leadership/ops-meeting
--                            items marked shift-visible)
--
-- EVERYTHING ELSE IS REUSED, NOT REBUILT: dsr_* (closeout/log book/labor/actions),
-- app_temp_points / app_temp_log_save / app_temp_history, app_checklist_items /
-- app_checklist_toggle / app_checklist_windows, app_my_tasks, app_contacts_list,
-- app_recognition_post, app_settings_get/_set.
--
-- Conventions per specs/CONTRACT_wave2.md:
--   * create table if not exists / create or replace function; RLS enabled, NO
--     policies (access only via SECURITY DEFINER RPCs).
--   * every RPC: security definer set search_path=public,extensions;
--     first args p_username text, p_password text; auth via public._pp_auth.
--   * "lead gate"  = manager|admin|lead|owner|VP   (shift leaders included)
--   * "mgr gate"   = manager|admin|owner|VP        (priorities, reopen, list)
--   * config lives in app_settings group 'shc_config' (seed block at bottom).
--
-- GET/SAVE SHAPE (must match js/19 — see the shape comment there):
--   shc_session_open / _current / _get / _set / _end / _reopen all return ONE
--   jsonb whose TOP-LEVEL keys are: id, location, business_date, shift_type,
--   leader_name, support_names, started_at, ended_at, status, dsr_report_id,
--   recap, events (array of {id,kind,body,meta,by,at}).
--   shc_session_current returns {"id":null} when there is no active session.
--   shc_sessions_list returns a jsonb ARRAY of summary rows.
--   shc_priorities_get returns a jsonb ARRAY of priority cards.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------
create table if not exists public.shc_shift_sessions (
  id             bigserial primary key,
  location       text not null,
  business_date  date not null,
  shift_type     text not null default 'AM',
  leader_uid     bigint,
  leader_name    text,
  support_names  text,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  status         text not null default 'Active',   -- Active | Ended
  device_meta    text,
  dsr_report_id  bigint,                            -- link to daily store report (dsr_*)
  recap          jsonb,                             -- End Shift Summary payload
  created_at     timestamptz not null default now()
);
-- only ONE active session per store+date+shift type
create unique index if not exists shc_sessions_active_uniq
  on public.shc_shift_sessions(location, business_date, shift_type)
  where status = 'Active';
create index if not exists shc_sessions_loc_date_idx
  on public.shc_shift_sessions(location, business_date);
alter table public.shc_shift_sessions enable row level security;

create table if not exists public.shc_session_events (
  id          bigserial primary key,
  session_id  bigint not null references public.shc_shift_sessions(id) on delete cascade,
  kind        text not null,   -- start|note|prompt_accepted|prompt_dismissed|quick_action|temp_flag|checklist|end|reopen|link_dsr
  body        text,
  meta        jsonb,
  by_uid      bigint,
  by_name     text,
  created_at  timestamptz not null default now()
);
create index if not exists shc_events_session_idx on public.shc_session_events(session_id);
alter table public.shc_session_events enable row level security;

create table if not exists public.shc_store_priorities (
  id          bigserial primary key,
  location    text not null default 'ALL',   -- 'ALL' or one store label
  title       text not null,
  body        text,
  starts_on   date,
  ends_on     date,
  active      boolean not null default true,
  source      text default 'manual',         -- manual | ops_meeting | inspection | leadership
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists shc_priorities_loc_idx on public.shc_store_priorities(location);
alter table public.shc_store_priorities enable row level security;

-- ---------------------------------------------------------------------------
-- INTERNAL: one canonical session -> jsonb serializer (shape used everywhere)
-- ---------------------------------------------------------------------------
create or replace function public.shc__session_json(p_sid bigint)
returns jsonb language sql security definer set search_path=public,extensions as $fn$
  select jsonb_build_object(
    'id',            s.id,
    'location',      s.location,
    'business_date', to_char(s.business_date,'YYYY-MM-DD'),
    'shift_type',    s.shift_type,
    'leader_name',   s.leader_name,
    'support_names', s.support_names,
    'started_at',    s.started_at,
    'ended_at',      s.ended_at,
    'status',        s.status,
    'dsr_report_id', s.dsr_report_id,
    'recap',         s.recap,
    'events', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', e.id, 'kind', e.kind, 'body', e.body, 'meta', e.meta,
                 'by', e.by_name, 'at', e.created_at)
               order by e.created_at)
        from public.shc_session_events e where e.session_id = s.id
      ), '[]'::jsonb)
  )
  from public.shc_shift_sessions s where s.id = p_sid;
$fn$;

-- ---------------------------------------------------------------------------
-- shc_session_open : find-or-create the active session for store+date+type.
--   Lead gate. Returns the canonical session jsonb.
-- ---------------------------------------------------------------------------
create or replace function public.shc_session_open(
  p_username text, p_password text,
  p_location text, p_shift_type text,
  p_business_date text default null,
  p_support text default null,
  p_device text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_name text;
  v_date date; v_sid bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%') then
    raise exception 'forbidden';
  end if;
  if coalesce(trim(p_location),'') = '' then raise exception 'A store is required.'; end if;
  v_date := coalesce(nullif(trim(coalesce(p_business_date,'')),'')::date, current_date);

  select id into v_sid from public.shc_shift_sessions
   where location = p_location and business_date = v_date
     and shift_type = coalesce(nullif(trim(p_shift_type),''),'AM') and status = 'Active'
   limit 1;

  if v_sid is null then
    insert into public.shc_shift_sessions(location,business_date,shift_type,leader_uid,leader_name,support_names,device_meta)
    values (p_location, v_date, coalesce(nullif(trim(p_shift_type),''),'AM'), v_uid, v_name, nullif(trim(coalesce(p_support,'')),''), p_device)
    returning id into v_sid;
    insert into public.shc_session_events(session_id,kind,body,by_uid,by_name)
    values (v_sid,'start','Shift started ('||coalesce(nullif(trim(p_shift_type),''),'AM')||')',v_uid,v_name);
    perform public._pp_audit(v_uid,v_name,'shc_session_start',null,null,
      jsonb_build_object('session_id',v_sid,'location',p_location,'business_date',to_char(v_date,'YYYY-MM-DD'),'shift_type',p_shift_type),null);
  end if;

  return public.shc__session_json(v_sid);
end $fn$;

-- ---------------------------------------------------------------------------
-- shc_session_current : latest ACTIVE session for a store (+optional date).
--   Lead gate. {"id":null} when none.
-- ---------------------------------------------------------------------------
create or replace function public.shc_session_current(
  p_username text, p_password text,
  p_location text, p_business_date text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_name text; v_date date; v_sid bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%') then
    raise exception 'forbidden';
  end if;
  v_date := coalesce(nullif(trim(coalesce(p_business_date,'')),'')::date, current_date);
  select id into v_sid from public.shc_shift_sessions
   where location = p_location and business_date = v_date and status = 'Active'
   order by started_at desc limit 1;
  if v_sid is null then return jsonb_build_object('id', null); end if;
  return public.shc__session_json(v_sid);
end $fn$;

-- ---------------------------------------------------------------------------
-- shc_session_get : one session (any status). Lead gate.
-- ---------------------------------------------------------------------------
create or replace function public.shc_session_get(
  p_username text, p_password text, p_session_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%') then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.shc_shift_sessions where id=p_session_id) then
    raise exception 'Session not found.';
  end if;
  return public.shc__session_json(p_session_id);
end $fn$;

-- ---------------------------------------------------------------------------
-- shc_session_set : patch a small allow-list of session fields
--   (shift_type, support_names, dsr_report_id). Lead gate. Active only.
-- ---------------------------------------------------------------------------
create or replace function public.shc_session_set(
  p_username text, p_password text, p_session_id bigint, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_status text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%') then
    raise exception 'forbidden';
  end if;
  select status into v_status from public.shc_shift_sessions where id=p_session_id;
  if v_status is null then raise exception 'Session not found.'; end if;
  if v_status <> 'Active' then raise exception 'This shift has ended. A manager must reopen it first.'; end if;

  update public.shc_shift_sessions set
    shift_type    = coalesce(nullif(trim(coalesce(p_patch->>'shift_type','')),''), shift_type),
    support_names = case when p_patch ? 'support_names' then nullif(trim(coalesce(p_patch->>'support_names','')),'') else support_names end,
    dsr_report_id = case when p_patch ? 'dsr_report_id' then nullif(p_patch->>'dsr_report_id','')::bigint else dsr_report_id end
  where id = p_session_id;

  if p_patch ? 'dsr_report_id' then
    insert into public.shc_session_events(session_id,kind,body,meta,by_uid,by_name)
    values (p_session_id,'link_dsr','Linked Daily Store Report #'||coalesce(p_patch->>'dsr_report_id','?'),
            jsonb_build_object('dsr_report_id', nullif(p_patch->>'dsr_report_id','')::bigint), v_uid, v_name);
  end if;

  return public.shc__session_json(p_session_id);
end $fn$;

-- ---------------------------------------------------------------------------
-- shc_event_log : append one event to the session trail. Lead gate. Active only
--   (except kinds a reopened/ended session may still record: none — reopen first).
--   Returns the event row jsonb.
-- ---------------------------------------------------------------------------
create or replace function public.shc_event_log(
  p_username text, p_password text,
  p_session_id bigint, p_kind text, p_body text,
  p_meta jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_status text; v_id bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%') then
    raise exception 'forbidden';
  end if;
  select status into v_status from public.shc_shift_sessions where id=p_session_id;
  if v_status is null then raise exception 'Session not found.'; end if;
  if v_status <> 'Active' then raise exception 'This shift has ended.'; end if;
  if coalesce(trim(p_kind),'') = '' then raise exception 'Event kind required.'; end if;

  insert into public.shc_session_events(session_id,kind,body,meta,by_uid,by_name)
  values (p_session_id, trim(p_kind), p_body, p_meta, v_uid, v_name)
  returning id into v_id;

  return (select jsonb_build_object('id',e.id,'kind',e.kind,'body',e.body,'meta',e.meta,'by',e.by_name,'at',e.created_at)
          from public.shc_session_events e where e.id = v_id);
end $fn$;

-- ---------------------------------------------------------------------------
-- shc_session_end : close the shift, store the End Shift Summary recap,
--   audit it, and notify managers (best-effort). Lead gate.
-- ---------------------------------------------------------------------------
create or replace function public.shc_session_end(
  p_username text, p_password text,
  p_session_id bigint, p_recap jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_s record;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%') then
    raise exception 'forbidden';
  end if;
  select * into v_s from public.shc_shift_sessions where id=p_session_id;
  if v_s.id is null then raise exception 'Session not found.'; end if;
  if v_s.status <> 'Active' then raise exception 'This shift has already ended.'; end if;

  update public.shc_shift_sessions
     set status='Ended', ended_at=now(), recap=coalesce(p_recap, recap)
   where id=p_session_id;

  insert into public.shc_session_events(session_id,kind,body,meta,by_uid,by_name)
  values (p_session_id,'end','Shift ended', p_recap, v_uid, v_name);

  perform public._pp_audit(v_uid,v_name,'shc_session_end',null,null,
    jsonb_build_object('session_id',p_session_id,'location',v_s.location,
                       'business_date',to_char(v_s.business_date,'YYYY-MM-DD'),
                       'shift_type',v_s.shift_type,'recap',p_recap), null);

  -- best-effort manager heads-up (never blocks the save)
  begin
    perform public.push_enqueue(u.id, chr(128203)||' Shift recap: '||v_s.location,
      coalesce(v_name,'A shift leader')||' ended the '||coalesce(v_s.shift_type,'?')||' shift at '
      ||v_s.location||' ('||to_char(v_s.business_date,'Mon DD')||'). Recap is ready to review.',
      '', 'shift_console')
    from public.users u
    where (u.role ilike '%manager%' or u.role ilike '%admin%' or u.role ilike '%owner%' or u.role ilike '%VP%')
      and (u.store = v_s.location or u.store is null)
      and u.username is distinct from p_username;
  exception when others then null; end;

  return public.shc__session_json(p_session_id);
end $fn$;

-- ---------------------------------------------------------------------------
-- shc_session_reopen : manager-only, reason required, audited.
-- ---------------------------------------------------------------------------
create or replace function public.shc_session_reopen(
  p_username text, p_password text, p_session_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_s record;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%'
          or v_role ilike '%owner%' or v_role ilike '%VP%') then
    raise exception 'forbidden';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to reopen a shift.'; end if;
  select * into v_s from public.shc_shift_sessions where id=p_session_id;
  if v_s.id is null then raise exception 'Session not found.'; end if;
  if v_s.status = 'Active' then raise exception 'This shift is already active.'; end if;

  update public.shc_shift_sessions set status='Active', ended_at=null where id=p_session_id;
  insert into public.shc_session_events(session_id,kind,body,by_uid,by_name)
  values (p_session_id,'reopen',trim(p_reason),v_uid,v_name);
  perform public._pp_audit(v_uid,v_name,'shc_session_reopen',null,
    jsonb_build_object('session_id',p_session_id,'was','Ended'),
    jsonb_build_object('session_id',p_session_id,'now','Active'), trim(p_reason));

  return public.shc__session_json(p_session_id);
end $fn$;

-- ---------------------------------------------------------------------------
-- shc_sessions_list : manager review list (recaps / history). Mgr gate.
--   p_filters: { location, date_from, date_to, status }  (all optional)
--   Returns jsonb ARRAY of summary rows.
-- ---------------------------------------------------------------------------
create or replace function public.shc_sessions_list(
  p_username text, p_password text, p_filters jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_name text;
  v_loc text; v_from date; v_to date; v_status text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%'
          or v_role ilike '%owner%' or v_role ilike '%VP%') then
    raise exception 'forbidden';
  end if;
  v_loc    := nullif(trim(coalesce(p_filters->>'location','')),'');
  v_status := nullif(trim(coalesce(p_filters->>'status','')),'');
  v_from   := coalesce(nullif(trim(coalesce(p_filters->>'date_from','')),'')::date, current_date - 14);
  v_to     := coalesce(nullif(trim(coalesce(p_filters->>'date_to','')),'')::date, current_date);

  return coalesce((
    select jsonb_agg(row_j order by bd desc, sa desc) from (
      select s.business_date as bd, s.started_at as sa,
        jsonb_build_object(
          'id', s.id, 'location', s.location,
          'business_date', to_char(s.business_date,'YYYY-MM-DD'),
          'shift_type', s.shift_type, 'leader_name', s.leader_name,
          'started_at', s.started_at, 'ended_at', s.ended_at, 'status', s.status,
          'dsr_report_id', s.dsr_report_id,
          'followups', (select count(*) from public.shc_session_events e
                         where e.session_id=s.id and e.kind='quick_action'),
          'prompts_accepted', (select count(*) from public.shc_session_events e
                         where e.session_id=s.id and e.kind='prompt_accepted'),
          'prompts_dismissed', (select count(*) from public.shc_session_events e
                         where e.session_id=s.id and e.kind='prompt_dismissed'),
          'temp_flags', (select count(*) from public.shc_session_events e
                         where e.session_id=s.id and e.kind='temp_flag')
        ) as row_j
      from public.shc_shift_sessions s
      where s.business_date between v_from and v_to
        and (v_loc is null or s.location = v_loc)
        and (v_status is null or s.status = v_status)
      order by s.business_date desc, s.started_at desc
      limit 200
    ) q
  ), '[]'::jsonb);
end $fn$;

-- ---------------------------------------------------------------------------
-- shc_priorities_get : active, date-windowed Store Priority cards for a store.
--   Any authenticated user with console access (lead gate). jsonb ARRAY.
-- ---------------------------------------------------------------------------
create or replace function public.shc_priorities_get(
  p_username text, p_password text, p_location text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'location', p.location, 'title', p.title, 'body', p.body,
             'starts_on', case when p.starts_on is null then null else to_char(p.starts_on,'YYYY-MM-DD') end,
             'ends_on',   case when p.ends_on   is null then null else to_char(p.ends_on,'YYYY-MM-DD') end,
             'active', p.active, 'source', p.source)
           order by p.created_at desc)
    from public.shc_store_priorities p
    where p.active = true
      and (p.location = 'ALL' or p.location = p_location)
      and (p.starts_on is null or p.starts_on <= current_date)
      and (p.ends_on   is null or p.ends_on   >= current_date)
  ), '[]'::jsonb);
end $fn$;

-- ---------------------------------------------------------------------------
-- shc_priority_save : create/update/retire a Store Priority card. Mgr gate.
--   p_payload: { id?, location, title, body, starts_on, ends_on, active, source }
--   (bulk single-object payload per contract). Returns the saved row jsonb.
-- ---------------------------------------------------------------------------
create or replace function public.shc_priority_save(
  p_username text, p_password text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_id bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%'
          or v_role ilike '%owner%' or v_role ilike '%VP%') then
    raise exception 'forbidden';
  end if;

  v_id := nullif(coalesce(p_payload->>'id',''),'')::bigint;

  if v_id is null then
    if coalesce(trim(coalesce(p_payload->>'title','')),'') = '' then
      raise exception 'A title is required.';
    end if;
    insert into public.shc_store_priorities(location,title,body,starts_on,ends_on,active,source,created_by)
    values (coalesce(nullif(trim(coalesce(p_payload->>'location','')),''),'ALL'),
            trim(p_payload->>'title'),
            nullif(trim(coalesce(p_payload->>'body','')),''),
            nullif(trim(coalesce(p_payload->>'starts_on','')),'')::date,
            nullif(trim(coalesce(p_payload->>'ends_on','')),'')::date,
            coalesce((p_payload->>'active')::boolean, true),
            coalesce(nullif(trim(coalesce(p_payload->>'source','')),''),'manual'),
            v_name)
    returning id into v_id;
  else
    update public.shc_store_priorities set
      location  = coalesce(nullif(trim(coalesce(p_payload->>'location','')),''), location),
      title     = coalesce(nullif(trim(coalesce(p_payload->>'title','')),''), title),
      body      = case when p_payload ? 'body' then nullif(trim(coalesce(p_payload->>'body','')),'') else body end,
      starts_on = case when p_payload ? 'starts_on' then nullif(trim(coalesce(p_payload->>'starts_on','')),'')::date else starts_on end,
      ends_on   = case when p_payload ? 'ends_on'   then nullif(trim(coalesce(p_payload->>'ends_on','')),'')::date   else ends_on end,
      active    = coalesce((p_payload->>'active')::boolean, active),
      source    = coalesce(nullif(trim(coalesce(p_payload->>'source','')),''), source),
      updated_at = now()
    where id = v_id;
    if not found then raise exception 'Priority not found.'; end if;
  end if;

  perform public._pp_audit(v_uid,v_name,'shc_priority_save',null,null,
    jsonb_build_object('id',v_id,'payload',p_payload),null);

  return (select jsonb_build_object(
            'id', p.id, 'location', p.location, 'title', p.title, 'body', p.body,
            'starts_on', case when p.starts_on is null then null else to_char(p.starts_on,'YYYY-MM-DD') end,
            'ends_on',   case when p.ends_on   is null then null else to_char(p.ends_on,'YYYY-MM-DD') end,
            'active', p.active, 'source', p.source)
          from public.shc_store_priorities p where p.id = v_id);
end $fn$;

-- ---------------------------------------------------------------------------
-- CONFIG SEED — app_settings group 'shc_config'.
-- NOTE FOR THE AUTHOR: contract says app_settings columns are skey/sgroup/svalue.
-- If the live table also has NOT-NULL label/sort columns, this block silently
-- skips (exception swallowed) — the frontend has identical fallbacks and every
-- key can be added later through Business Settings / app_settings_set. VERIFY.
-- ---------------------------------------------------------------------------
do $seed$
declare
  k text; v text;
  kv text[][] := array[
    ['shc_shift_types',        'AM,PM,Mid,Custom,5:00 Ring-Out Only,Closing'],
    ['shc_leader_roles',       'Shift Leader,Team Lead'],
    ['shc_ringout_due',        '17:00'],
    ['shc_close_due',          '21:00'],
    ['shc_temp_due_times',     '11:00,15:00,19:00'],
    ['shc_overdue_grace_min',  '45'],
    ['shc_start_prompts',      'Pep talk & uniform check|Walk the lobby, food bar & restrooms|Count your drawer before opening|Check today''s store priorities below'],
    ['shc_prompt_min_len',     '12'],
    ['shc_kw_maintenance',     'broken,broke,leak,leaking,repair,not working,stopped working,went down,is down,fix,error code,compressor,motor'],
    ['shc_kw_supply',          'out of,low on,ran out,running low,shortage,need more,86,eighty-six,restock'],
    ['shc_kw_attendance',      'late,no show,no-show,called in,called out,call out,left early,tardy,didn''t show'],
    ['shc_kw_employee',        'attitude,coaching,performance issue,warning,write up,wrote up,insubordinate'],
    ['shc_kw_shoutout',        'great job,awesome,killed it,crushed it,shout out,shoutout,amazing,went above,stepped up'],
    ['shc_kw_customer',        'customer complaint,complaint,refund,upset customer,angry customer,comped,bad review'],
    ['shc_kw_delivery',        'delivery,driver,truck,vendor,shorted us,missing item,wrong item,invoice'],
    ['shc_kw_safety',          'injury,injured,hurt,slip,fell,burn,cut,accident,hazard,unsafe'],
    ['shc_kw_cash',            'over/short,drawer short,drawer over,count out,count-out,missing cash,deposit off,short on cash'],
    ['shc_recap_ask_priority', '1']
  ];
  i int;
begin
  for i in 1..array_length(kv,1) loop
    k := kv[i][1]; v := kv[i][2];
    begin
      insert into public.app_settings(skey, sgroup, svalue)
      select k, 'shc_config', v
      where not exists (select 1 from public.app_settings
                        where skey = k and sgroup = 'shc_config');
    exception when others then null;
    end;
  end loop;
end $seed$;
