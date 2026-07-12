-- ============================================================================
-- Caliche's Hub — MONTHLY OPS MEETING HUB  (ops_meeting.sql)  — ADDITIVE ONLY
-- ============================================================================
-- Monthly store-manager <-> shift-leader meeting workspace:
--   performance packet + manager notes + AI(Cherry)-assisted insights +
--   pre-meeting shift-leader brief/questions + attendance + notes/decisions +
--   action items (real tasks via app_task_create) + carry-forward follow-up +
--   leadership dashboard.
--
-- Conventions (CONTRACT_wave2.md):
--   * create table if not exists / create or replace function. RLS enabled,
--     NO policies — all access via SECURITY DEFINER RPCs.
--   * Every RPC: security definer set search_path=public,extensions and the
--     first args are (p_username text, p_password text).
--   * Auth reuses public._pp_auth (employee_passport.sql — LIVE in prod).
--   * Employee identity = public.schedule_employees.id (bigint).
--   * Config lives in app_settings (skey, sgroup='opm_config', svalue).
--   * Follow-up tasks reuse the EXISTING app_task_create (called DEFENSIVELY
--     via EXECUTE, mirroring daily_store_report.sql's dsr_action_create).
--   * Notifications reuse push_enqueue(p_emp users.id, title, body, url, type)
--     always wrapped in `exception when others then null`.
--
-- PRIVACY / YOUR VOICE GUARDRAILS (request doc §11, §20 — enforced server-side)
--   * Your Voice data is only ever read as AGGREGATE THEME COUNTS for the
--     non-confidential pathways. The 'concern' pathway, anonymous authorship,
--     submission bodies, subjects and author identities are NEVER selected,
--     stored, or returned by any opm_* RPC.
--   * If confidential ('concern') items exist for the store, the ONLY thing
--     produced is a manager-only alert with a count — "review them inside
--     Your Voice" — never content, never in shift-leader views.
--   * Shift leaders receive a SANITIZED meeting view: approved + 'normal'
--     sensitivity agenda items only, 'sl_'-prefixed sections only, no AI
--     suggestion queue, no rejected/deferred items, no manager notes, no
--     private decision trail. Filtering happens in SQL, not the client.
--   * Every suggestion decision (used / rejected / deferred / privately
--     handled) is recorded on the insight row + audit_log.
--
-- GET/SAVE SHAPE (contract — the frontend js/21_ops_meeting.js reads EXACTLY):
--   opm_get -> { meeting:{...}, sections:{key:val}, agenda:[...],
--                insights:[...], inputs:[...], attendance:[...], actions:[...],
--                carry:[...], perf:{...}, acks:[...], me:{...} }
--   opm_save_section accepts ONE bulk jsonb object {field1:v, field2:v, ...}
--   and upserts one row per field (unique(meeting_id, field_key)).
--
-- MEETING STATUS FLOW:
--   draft -> agenda_locked -> brief_published -> in_progress -> completed
--         -> recap_sent            (cancelled allowed from any pre-completed)
-- ============================================================================

-- ============================================================================
-- 1) TABLES  (all opm_*)
-- ============================================================================

create table if not exists public.opm_meetings (
  id             bigserial primary key,
  location       text not null,
  meeting_month  text not null,                 -- normalized 'YYYY-MM'
  meeting_kind   text not null default 'monthly',  -- monthly | special
  meeting_date   date,
  meeting_time   text,
  status         text not null default 'draft',
  owner_uid      bigint,
  owner_name     text,
  recap_text     text,                          -- manager-approved recap body
  locked_at      timestamptz, locked_by      text,
  published_at   timestamptz, published_by   text,
  completed_at   timestamptz, completed_by   text,
  recap_sent_at  timestamptz, recap_sent_by  text,
  created_by     text,
  updated_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- one PRIMARY meeting per store per month (special meetings are extra)
create unique index if not exists opm_meetings_month_uidx
  on public.opm_meetings(location, meeting_month) where meeting_kind = 'monthly';
create index if not exists opm_meetings_loc_idx on public.opm_meetings(location, meeting_month desc);

-- Bulk section fields (performance metric explanations, manual fallbacks,
-- manager notes, training focus, marketing update, live-meeting notes...).
-- VISIBILITY RULE: field_key beginning 'sl_' = shift-leader visible after the
-- brief is published; everything else is manager/leadership only.
create table if not exists public.opm_sections (
  id          bigserial primary key,
  meeting_id  bigint not null references public.opm_meetings(id) on delete cascade,
  field_key   text not null,
  svalue      text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  unique (meeting_id, field_key)
);

-- Agenda items. source_ref preserves WHERE a topic came from (audit §17/§20)
-- but backlinks are only rendered for roles allowed to see the source.
create table if not exists public.opm_agenda (
  id            bigserial primary key,
  meeting_id    bigint not null references public.opm_meetings(id) on delete cascade,
  title         text not null,
  details       text,
  source        text not null default 'manual',   -- manual|ai|leadership|shift_leader|carry_forward|your_voice
  source_ref    jsonb,
  sensitivity   text not null default 'normal',   -- normal | manager_only | sensitive
  status        text not null default 'approved', -- suggested|approved|rejected|deferred|removed
  required_flag boolean not null default false,   -- leadership-required topic
  ack_at        timestamptz, ack_by text,         -- manager acknowledgement of required topic
  in_recap      boolean not null default true,
  discussed     boolean not null default false,   -- live-meeting check-off
  decision_note text,                             -- decision log per topic
  sort_order    int not null default 0,
  created_by    text,
  decided_by    text, decided_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists opm_agenda_mtg_idx on public.opm_agenda(meeting_id);

-- AI/Cherry suggestions queue. Suggestions are NEVER shift-leader visible;
-- accepting one copies it into opm_agenda under manager control.
create table if not exists public.opm_insights (
  id          bigserial primary key,
  meeting_id  bigint not null references public.opm_meetings(id) on delete cascade,
  source      text not null,                     -- performance|logbook|tasks|maintenance|supply|your_voice|follow_up|cherry|manual
  sensitivity text not null default 'normal',    -- normal | sensitive
  title       text not null,
  body        text,
  meta        jsonb,                             -- source metadata + refreshed_at (auditable "why suggested")
  status      text not null default 'suggested', -- suggested|accepted|rejected|deferred|private
  decided_by  text, decided_at timestamptz,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists opm_insights_mtg_idx on public.opm_insights(meeting_id);

-- Shift-leader pre-meeting questions / suggested topics (manager review queue).
-- Not visible to OTHER shift leaders unless approved (then it becomes agenda).
create table if not exists public.opm_sl_inputs (
  id           bigserial primary key,
  meeting_id   bigint not null references public.opm_meetings(id) on delete cascade,
  author_uid   bigint,
  author_name  text,
  employee_id  bigint,                            -- schedule_employees.id when linkable
  kind         text not null default 'topic',     -- topic | question
  body         text not null,
  status       text not null default 'submitted', -- submitted|approved|merged|rejected|responded
  mgr_response text,
  responded_by text, responded_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists opm_sl_inputs_mtg_idx on public.opm_sl_inputs(meeting_id);

-- Meeting attendance (expected roster is seeded at brief publish).
create table if not exists public.opm_attendance (
  id           bigserial primary key,
  meeting_id   bigint not null references public.opm_meetings(id) on delete cascade,
  employee_id  bigint,                            -- schedule_employees.id (null for manual add)
  display_name text not null,
  emp_role     text,
  status       text not null default 'expected',  -- expected|present|late|absent|excused
  marked_by    text, marked_at timestamptz,
  unique (meeting_id, employee_id)
);
create index if not exists opm_attendance_mtg_idx on public.opm_attendance(meeting_id);

-- Pre-meeting brief read receipts.
create table if not exists public.opm_brief_acks (
  id         bigserial primary key,
  meeting_id bigint not null references public.opm_meetings(id) on delete cascade,
  uid        bigint not null,
  uname      text,
  acked_at   timestamptz not null default now(),
  unique (meeting_id, uid)
);

-- Action items. task_id stores the id returned by the EXISTING app_task_create
-- so completion can be reconciled with the shared task engine.
create table if not exists public.opm_actions (
  id           bigserial primary key,
  meeting_id   bigint not null references public.opm_meetings(id) on delete cascade,
  agenda_id    bigint,
  title        text not null,
  details      text,
  owner_emp    bigint,                            -- schedule_employees.id
  owner_name   text,
  due_date     date,
  task_id      text,                              -- shared task-engine id (text-safe)
  status       text not null default 'open',      -- open | done | dropped
  carried_from bigint,                            -- prior opm_meetings.id (follow-up lineage)
  completed_at timestamptz, completed_by text,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists opm_actions_mtg_idx on public.opm_actions(meeting_id);
create index if not exists opm_actions_status_idx on public.opm_actions(status);

alter table public.opm_meetings   enable row level security;
alter table public.opm_sections   enable row level security;
alter table public.opm_agenda     enable row level security;
alter table public.opm_insights   enable row level security;
alter table public.opm_sl_inputs  enable row level security;
alter table public.opm_attendance enable row level security;
alter table public.opm_brief_acks enable row level security;
alter table public.opm_actions    enable row level security;

-- ============================================================================
-- 2) CONFIG SEEDS  (app_settings — sgroup 'opm_config'; skey is a GLOBAL pk,
--    hence the opm_ prefix). Everything tunable by admins in Business Settings.
-- ============================================================================
insert into public.app_settings (skey, sgroup, label, svalue, sort) values
  ('opm_meeting_dow',   'opm_config', 'Meeting day of week (0=Sun … 6=Sat)',              '6',  1),
  ('opm_meeting_week',  'opm_config', 'Which occurrence of that weekday (1 = first)',      '1',  2),
  ('opm_default_time',  'opm_config', 'Default meeting time label',                        '9:00 AM', 3),
  ('opm_carry_window',  'opm_config', 'Months of past meetings scanned for follow-up',     '6',  4),
  ('opm_repeat_window', 'opm_config', 'Meetings scanned for repeated-topic signals',       '4',  5),
  ('opm_repeat_min',    'opm_config', 'Times a topic must repeat to flag a review signal', '3',  6),
  ('opm_notify_leads',  'opm_config', 'Push-notify shift leaders on brief/recap (1/0)',    '1',  7),
  ('opm_labor_watch',   'opm_config', 'Labor % above this shows Watch/Concern',            '25', 8),
  ('opm_sales_watch',   'opm_config', 'Sales vs LY %% below this shows Concern (e.g. -5)', '-5', 9),
  ('opm_recap_footer',  'opm_config', 'Footer on shift-leader recap views',
     'Note: manager-only information is excluded from shift leader recap views.', 10)
on conflict (skey) do nothing;

-- ============================================================================
-- 3) HELPERS
-- ============================================================================

-- role gates -----------------------------------------------------------------
-- NOTE: intentionally STRICTER than the generic contract gate for manager-only
-- writes — the request doc (§5, §11, §20) requires shift leaders to have
-- limited access, so bare '%lead%' does NOT pass the manager gate here.
create or replace function public._opm_is_mgr(p_role text)
returns boolean language sql immutable as $fn$
  select coalesce(p_role,'') ilike any (array['%manager%','%admin%','%owner%','%vp%','%vice president%','%president%','%director%']);
$fn$;

-- above-store leadership (company dashboard + required topics)
create or replace function public._opm_is_leadership(p_role text)
returns boolean language sql immutable as $fn$
  select coalesce(p_role,'') ilike any (array['%admin%','%owner%','%vp%','%vice president%','%president%','%director%']);
$fn$;

-- shift leader OR manager (module entry / brief access)
create or replace function public._opm_is_lead(p_role text)
returns boolean language sql immutable as $fn$
  select public._opm_is_mgr(p_role) or coalesce(p_role,'') ilike any (array['%lead%','%supervisor%']);
$fn$;

-- config reader ---------------------------------------------------------------
create or replace function public._opm_cfg(p_key text, p_fb text)
returns text language sql security definer set search_path=public,extensions as $fn$
  select coalesce(nullif((select svalue from public.app_settings
                          where skey = p_key and sgroup = 'opm_config'), ''), p_fb);
$fn$;

create or replace function public._opm_cfg_num(p_key text, p_fb numeric)
returns numeric language plpgsql security definer set search_path=public,extensions as $fn$
declare v numeric;
begin
  begin v := public._opm_cfg(p_key, null)::numeric; exception when others then v := null; end;
  return coalesce(v, p_fb);
end $fn$;

-- audit (existing audit_log table from Phase 1; never blocks) ------------------
create or replace function public._opm_audit(
  p_actor_id bigint, p_actor text, p_action text, p_emp bigint,
  p_before jsonb, p_after jsonb, p_reason text)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
begin
  begin
    insert into public.audit_log(actor_id,actor_name,action,affected_employee_id,
                                 before_value,after_value,source_module,reason)
    values (p_actor_id,p_actor,p_action,p_emp,p_before,p_after,'ops_meeting',p_reason);
  exception when others then null; end;
end $fn$;

-- caller's roster row (schedule_employees.id) ----------------------------------
create or replace function public._opm_emp_of(p_username text)
returns bigint language sql security definer set search_path=public,extensions as $fn$
  select se.id from public.schedule_employees se
  where se.linked_username = p_username limit 1;
$fn$;

-- default meeting date: Nth <dow> of the month (config; default 1st Saturday) --
create or replace function public._opm_default_date(p_month text)
returns date language plpgsql security definer set search_path=public,extensions as $fn$
declare d0 date; v_dow int; v_week int; v_first date;
begin
  d0 := (p_month || '-01')::date;
  v_dow  := coalesce(public._opm_cfg_num('opm_meeting_dow', 6), 6)::int;
  v_week := greatest(1, coalesce(public._opm_cfg_num('opm_meeting_week', 1), 1)::int);
  v_first := d0 + (((v_dow - extract(dow from d0)::int) + 7) % 7);
  return v_first + 7 * (v_week - 1);
exception when others then
  return d0 + (((6 - extract(dow from d0)::int) + 7) % 7);
end $fn$;

-- generic "try a count over live-DB tables that may not exist" -----------------
create or replace function public._opm_try_num(p_sql text)
returns numeric language plpgsql security definer set search_path=public,extensions as $fn$
declare v numeric;
begin
  execute p_sql into v;
  return v;
exception when others then
  return null;
end $fn$;

-- status guard ------------------------------------------------------------
create or replace function public._opm_mtg(p_id bigint)
returns public.opm_meetings language sql security definer set search_path=public,extensions as $fn$
  select * from public.opm_meetings where id = p_id;
$fn$;

-- ============================================================================
-- 4) opm_config_get — config bundle + computed next meeting date
-- ============================================================================
create or replace function public.opm_config_get(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_month text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  v_month := to_char(current_date, 'YYYY-MM');
  return jsonb_build_object(
    'meeting_dow',    public._opm_cfg('opm_meeting_dow','6'),
    'meeting_week',   public._opm_cfg('opm_meeting_week','1'),
    'default_time',   public._opm_cfg('opm_default_time','9:00 AM'),
    'carry_window',   public._opm_cfg('opm_carry_window','6'),
    'repeat_window',  public._opm_cfg('opm_repeat_window','4'),
    'repeat_min',     public._opm_cfg('opm_repeat_min','3'),
    'notify_leads',   public._opm_cfg('opm_notify_leads','1'),
    'labor_watch',    public._opm_cfg('opm_labor_watch','25'),
    'sales_watch',    public._opm_cfg('opm_sales_watch','-5'),
    'recap_footer',   public._opm_cfg('opm_recap_footer','Note: manager-only information is excluded from shift leader recap views.'),
    'this_month',     v_month,
    'this_month_date', public._opm_default_date(v_month),
    'next_month_date', public._opm_default_date(to_char(current_date + interval '1 month','YYYY-MM')));
end $fn$;

-- ============================================================================
-- 5) opm_create — manager creates (or returns) the month's meeting draft.
--    Imports carry-forward: open action items from prior meetings are linked
--    as agenda suggestions (source 'carry_forward') for the prep area.
-- ============================================================================
create or replace function public.opm_create(
  p_username text, p_password text,
  p_store text, p_month text default null,
  p_date date default null, p_time text default null,
  p_kind text default 'monthly')
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_month text; v_id bigint;
        v_date date; v_kind text; v_carry int := 0; r record;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  if coalesce(p_store,'') = '' then raise exception 'Store is required.'; end if;

  v_month := coalesce(nullif(p_month,''), to_char(current_date,'YYYY-MM'));
  if v_month !~ '^\d{4}-\d{2}$' then raise exception 'Month must be YYYY-MM.'; end if;
  v_kind := case when lower(coalesce(p_kind,'monthly')) = 'special' then 'special' else 'monthly' end;

  if v_kind = 'monthly' then
    select id into v_id from public.opm_meetings
    where location = p_store and meeting_month = v_month and meeting_kind = 'monthly';
    if v_id is not null then
      return jsonb_build_object('ok', true, 'id', v_id, 'existing', true);
    end if;
  end if;

  v_date := coalesce(p_date, public._opm_default_date(v_month));

  insert into public.opm_meetings(location, meeting_month, meeting_kind, meeting_date,
                                  meeting_time, owner_uid, owner_name, created_by, updated_by)
  values (p_store, v_month, v_kind, v_date,
          coalesce(nullif(p_time,''), public._opm_cfg('opm_default_time','9:00 AM')),
          v_uid, v_name, v_name, v_name)
  returning id into v_id;

  -- carry-forward: surface still-open action items from earlier meetings
  for r in
    select a.id, a.title, a.owner_name, a.due_date, a.meeting_id, m.meeting_month
    from public.opm_actions a
    join public.opm_meetings m on m.id = a.meeting_id
    where m.location = p_store and a.status = 'open' and a.meeting_id <> v_id
      and m.meeting_month >= to_char((v_month||'-01')::date
            - (coalesce(public._opm_cfg_num('opm_carry_window',6),6)::int || ' months')::interval, 'YYYY-MM')
    order by m.meeting_month desc, a.id
    limit 40
  loop
    insert into public.opm_agenda(meeting_id, title, details, source, source_ref,
                                  sensitivity, status, created_by, sort_order)
    values (v_id, 'Follow up: ' || r.title,
            'Carried forward from the ' || r.meeting_month || ' meeting'
              || case when r.owner_name is not null then ' (owner: ' || r.owner_name || ')' else '' end
              || case when r.due_date is not null then ' — was due ' || to_char(r.due_date,'Mon DD') else '' end || '.',
            'carry_forward',
            jsonb_build_object('action_id', r.id, 'from_meeting_id', r.meeting_id, 'from_month', r.meeting_month),
            'normal', 'suggested', 'System (carry-forward)', 900 + v_carry);
    v_carry := v_carry + 1;
  end loop;

  perform public._opm_audit(v_uid, v_name, 'opm_create', null, null,
     jsonb_build_object('meeting_id', v_id, 'store', p_store, 'month', v_month, 'kind', v_kind,
                        'carried_items', v_carry), null);
  return jsonb_build_object('ok', true, 'id', v_id, 'carried', v_carry);
end $fn$;

-- ============================================================================
-- 6) opm_list — role-aware meeting list.
--    Shift leaders only see published+ meetings for their store (limited cols).
-- ============================================================================
create or replace function public.opm_list(
  p_username text, p_password text, p_store text default null, p_limit int default 24)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_out jsonb; v_mystore text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_lead(v_role) then raise exception 'forbidden'; end if;

  if public._opm_is_mgr(v_role) then
    select coalesce(jsonb_agg(x order by x->>'meeting_month' desc, (x->>'id')::bigint desc), '[]'::jsonb)
      into v_out
    from (
      select jsonb_build_object(
        'id', m.id, 'location', m.location, 'meeting_month', m.meeting_month,
        'meeting_kind', m.meeting_kind, 'meeting_date', m.meeting_date,
        'meeting_time', m.meeting_time, 'status', m.status, 'owner_name', m.owner_name,
        'open_actions', (select count(*) from public.opm_actions a where a.meeting_id = m.id and a.status = 'open'),
        'pending_insights', (select count(*) from public.opm_insights i where i.meeting_id = m.id and i.status = 'suggested'),
        'pending_inputs', (select count(*) from public.opm_sl_inputs s where s.meeting_id = m.id and s.status = 'submitted')) x
      from public.opm_meetings m
      where (coalesce(p_store,'') = '' or m.location = p_store)
      order by m.meeting_month desc, m.id desc
      limit greatest(1, least(coalesce(p_limit,24), 60))
    ) q;
  else
    select u.store into v_mystore from public.users u where u.id = v_uid;
    select coalesce(jsonb_agg(x order by x->>'meeting_month' desc, (x->>'id')::bigint desc), '[]'::jsonb)
      into v_out
    from (
      select jsonb_build_object(
        'id', m.id, 'location', m.location, 'meeting_month', m.meeting_month,
        'meeting_kind', m.meeting_kind, 'meeting_date', m.meeting_date,
        'meeting_time', m.meeting_time, 'status', m.status, 'owner_name', m.owner_name) x
      from public.opm_meetings m
      where m.status in ('brief_published','in_progress','completed','recap_sent')
        and (coalesce(v_mystore,'') = '' or m.location = v_mystore)
        and (coalesce(p_store,'') = '' or m.location = p_store)
      order by m.meeting_month desc, m.id desc
      limit greatest(1, least(coalesce(p_limit,24), 60))
    ) q;
  end if;
  return v_out;
end $fn$;

-- ============================================================================
-- 7) opm_get — the full meeting workspace, ROLE-FILTERED IN SQL.
--    Top-level keys (frontend reads these exactly — see shape note at top):
--    meeting, sections, agenda, insights, inputs, attendance, actions,
--    carry, perf, acks, me
-- ============================================================================
create or replace function public.opm_get(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_m public.opm_meetings;
        v_is_mgr boolean; v_is_leader boolean; v_emp bigint;
        v_sections jsonb; v_agenda jsonb; v_insights jsonb; v_inputs jsonb;
        v_att jsonb; v_actions jsonb; v_carry jsonb; v_perf jsonb; v_acks jsonb;
        v_review text; v_r0 date; v_r1 date; v_recap text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_lead(v_role) then raise exception 'forbidden'; end if;
  v_is_mgr := public._opm_is_mgr(v_role);

  select * into v_m from public.opm_meetings where id = p_id;
  if v_m.id is null then raise exception 'not_found'; end if;
  if not v_is_mgr and v_m.status in ('draft','agenda_locked') then
    raise exception 'forbidden';   -- shift leaders never see unpublished drafts
  end if;
  v_emp := public._opm_emp_of(p_username);

  -- performance snapshot: REVIEW month = the month BEFORE the meeting month --
  v_review := to_char((v_m.meeting_month||'-01')::date - interval '1 month', 'YYYY-MM');
  v_r0 := (v_review||'-01')::date;
  v_r1 := (v_r0 + interval '1 month')::date;
  begin
    if to_regclass('public.store_metrics') is not null then
      select jsonb_build_object(
        'review_month',  v_review,
        'source',        'store_metrics',
        'days_reported', count(*),
        'sales',         round(coalesce(sum(sales),0), 2),
        'sales_ly',      round(coalesce(sum(sales_ly),0), 2),
        'guests',        coalesce(sum(guest_count),0),
        'labor_pct',     round(avg(labor_pct)::numeric, 1),
        'speed_seconds', round(avg(speed_seconds)::numeric, 0),
        'complaints',    coalesce(sum(complaints),0),
        'last_refreshed', max(metric_date),
        'ytd_sales',     (select round(coalesce(sum(s2.sales),0),2) from public.store_metrics s2
                          where s2.location = v_m.location
                            and s2.metric_date >= date_trunc('year', v_r0)::date and s2.metric_date < v_r1),
        'ytd_sales_ly',  (select round(coalesce(sum(s2.sales_ly),0),2) from public.store_metrics s2
                          where s2.location = v_m.location
                            and s2.metric_date >= date_trunc('year', v_r0)::date and s2.metric_date < v_r1))
      into v_perf
      from public.store_metrics
      where location = v_m.location and metric_date >= v_r0 and metric_date < v_r1;
    end if;
  exception when others then v_perf := null; end;
  v_perf := coalesce(v_perf, jsonb_build_object('review_month', v_review, 'source', 'manual',
                                                'days_reported', 0));

  -- sections (shift leaders: only 'sl_' keys) --------------------------------
  select coalesce(jsonb_object_agg(field_key, coalesce(svalue,'')), '{}'::jsonb) into v_sections
  from public.opm_sections
  where meeting_id = p_id and (v_is_mgr or field_key like 'sl\_%');

  -- agenda (shift leaders: approved + normal sensitivity only) ---------------
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'details', a.details, 'source', a.source,
      'source_ref', case when v_is_mgr then a.source_ref else null end,
      'sensitivity', a.sensitivity, 'status', a.status,
      'required_flag', a.required_flag, 'ack_at', a.ack_at,
      'in_recap', a.in_recap, 'discussed', a.discussed,
      'decision_note', case when v_is_mgr then a.decision_note
                            when a.status='approved' and a.sensitivity='normal' then a.decision_note
                            else null end,
      'sort_order', a.sort_order, 'created_by', case when v_is_mgr then a.created_by else null end)
      order by a.sort_order, a.id), '[]'::jsonb)
    into v_agenda
  from public.opm_agenda a
  where a.meeting_id = p_id
    and a.status <> 'removed'
    and (v_is_mgr or (a.status = 'approved' and a.sensitivity = 'normal'));

  -- AI insight queue: MANAGER ONLY, never in shift-leader payloads -----------
  if v_is_mgr then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'source', i.source, 'sensitivity', i.sensitivity,
        'title', i.title, 'body', i.body, 'meta', i.meta, 'status', i.status,
        'decided_by', i.decided_by, 'decided_at', i.decided_at,
        'created_by', i.created_by, 'created_at', i.created_at)
        order by case i.status when 'suggested' then 0 else 1 end,
                 case i.sensitivity when 'sensitive' then 0 else 1 end, i.id), '[]'::jsonb)
      into v_insights
    from public.opm_insights i where i.meeting_id = p_id;
  else
    v_insights := '[]'::jsonb;
  end if;

  -- shift-leader inputs: manager sees all; a shift leader sees only THEIR own
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'kind', s.kind, 'body', s.body, 'status', s.status,
      'author_name', case when v_is_mgr or s.author_uid = v_uid then s.author_name else null end,
      'mine', (s.author_uid = v_uid),
      'mgr_response', case when v_is_mgr or s.author_uid = v_uid then s.mgr_response else null end,
      'responded_by', case when v_is_mgr then s.responded_by else null end,
      'created_at', s.created_at) order by s.id), '[]'::jsonb)
    into v_inputs
  from public.opm_sl_inputs s
  where s.meeting_id = p_id and (v_is_mgr or s.author_uid = v_uid);

  -- attendance ---------------------------------------------------------------
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'employee_id', t.employee_id, 'display_name', t.display_name,
      'emp_role', t.emp_role, 'status', t.status,
      'marked_by', case when v_is_mgr then t.marked_by else null end)
      order by t.display_name), '[]'::jsonb)
    into v_att
  from public.opm_attendance t where t.meeting_id = p_id;

  -- action items (shift leaders: only their own) ------------------------------
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'agenda_id', a.agenda_id, 'title', a.title, 'details', a.details,
      'owner_emp', a.owner_emp, 'owner_name', a.owner_name, 'due_date', a.due_date,
      'task_id', a.task_id, 'status', a.status, 'carried_from', a.carried_from,
      'completed_at', a.completed_at) order by a.id), '[]'::jsonb)
    into v_actions
  from public.opm_actions a
  where a.meeting_id = p_id
    and (v_is_mgr or (v_emp is not null and a.owner_emp = v_emp));

  -- carry-forward: OPEN actions from EARLIER meetings at this store -----------
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'meeting_id', a.meeting_id, 'from_month', m2.meeting_month,
      'title', a.title, 'owner_name', a.owner_name, 'due_date', a.due_date,
      'task_id', a.task_id,
      'overdue', (a.due_date is not null and a.due_date < current_date))
      order by m2.meeting_month desc, a.id), '[]'::jsonb)
    into v_carry
  from public.opm_actions a
  join public.opm_meetings m2 on m2.id = a.meeting_id
  where m2.location = v_m.location and a.status = 'open' and a.meeting_id <> p_id
    and m2.meeting_month < v_m.meeting_month
    and (v_is_mgr or (v_emp is not null and a.owner_emp = v_emp));

  -- brief read receipts (manager view only) ----------------------------------
  if v_is_mgr then
    select coalesce(jsonb_agg(jsonb_build_object('uname', b.uname, 'acked_at', b.acked_at)
                              order by b.acked_at), '[]'::jsonb)
      into v_acks
    from public.opm_brief_acks b where b.meeting_id = p_id;
  else
    v_acks := '[]'::jsonb;
  end if;

  -- recap: shift leaders only after send, with the privacy footer -------------
  v_recap := case
    when v_is_mgr then v_m.recap_text
    when v_m.status = 'recap_sent' then
      coalesce(v_m.recap_text,'') || chr(10) || chr(10)
        || public._opm_cfg('opm_recap_footer','Note: manager-only information is excluded from shift leader recap views.')
    else null end;

  return jsonb_build_object(
    'meeting', jsonb_build_object(
       'id', v_m.id, 'location', v_m.location, 'meeting_month', v_m.meeting_month,
       'meeting_kind', v_m.meeting_kind, 'meeting_date', v_m.meeting_date,
       'meeting_time', v_m.meeting_time, 'status', v_m.status,
       'owner_name', v_m.owner_name, 'recap_text', v_recap,
       'locked_at', v_m.locked_at, 'published_at', v_m.published_at,
       'completed_at', v_m.completed_at, 'recap_sent_at', v_m.recap_sent_at,
       'review_month', v_review),
    'sections',  v_sections,
    'agenda',    v_agenda,
    'insights',  v_insights,
    'inputs',    v_inputs,
    'attendance', v_att,
    'actions',   v_actions,
    'carry',     v_carry,
    'perf',      v_perf,
    'acks',      v_acks,
    'me', jsonb_build_object(
       'can_manage', v_is_mgr,
       'is_leadership', public._opm_is_leadership(v_role),
       'employee_id', v_emp,
       'brief_acked', exists(select 1 from public.opm_brief_acks b
                             where b.meeting_id = p_id and b.uid = v_uid)));
end $fn$;

-- ============================================================================
-- 8) opm_save_section — BULK save (one jsonb object {field:value,...});
--    upserts one row per field. Manager only. Keys starting 'sl_' become
--    shift-leader visible once the brief is published (visibility rule above).
-- ============================================================================
create or replace function public.opm_save_section(
  p_username text, p_password text, p_id bigint, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_m public.opm_meetings;
        k text; v text; v_n int := 0;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_m from public.opm_meetings where id = p_id;
  if v_m.id is null then raise exception 'not_found'; end if;
  if v_m.status = 'recap_sent' then raise exception 'This meeting is finalized.'; end if;

  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p_fields,'{}'::jsonb))
  loop
    insert into public.opm_sections(meeting_id, field_key, svalue, updated_by, updated_at)
    values (p_id, k, v, v_name, now())
    on conflict (meeting_id, field_key)
    do update set svalue = excluded.svalue, updated_by = excluded.updated_by, updated_at = now();
    v_n := v_n + 1;
  end loop;

  update public.opm_meetings set updated_by = v_name, updated_at = now() where id = p_id;
  perform public._opm_audit(v_uid, v_name, 'opm_save_section', null, null,
     jsonb_build_object('meeting_id', p_id, 'fields',
       (select coalesce(jsonb_agg(key),'[]'::jsonb) from jsonb_each(coalesce(p_fields,'{}'::jsonb)))), null);
  return jsonb_build_object('ok', true, 'saved', v_n);
end $fn$;

-- ============================================================================
-- 9) opm_agenda_add — manager adds a topic; above-store leadership may add a
--    REQUIRED company topic (required_flag) the manager must acknowledge.
-- ============================================================================
create or replace function public.opm_agenda_add(
  p_username text, p_password text, p_id bigint,
  p_title text, p_details text default null,
  p_sensitivity text default 'normal', p_required boolean default false)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_m public.opm_meetings;
        v_sens text; v_src text; v_req boolean; v_new bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_m from public.opm_meetings where id = p_id;
  if v_m.id is null then raise exception 'not_found'; end if;
  if v_m.status in ('completed','recap_sent') then raise exception 'This meeting is finished.'; end if;
  if coalesce(trim(p_title),'') = '' then raise exception 'Title is required.'; end if;

  v_req := coalesce(p_required,false) and public._opm_is_leadership(v_role);
  v_src := case when v_req then 'leadership' else 'manual' end;
  v_sens := case when p_sensitivity in ('normal','manager_only','sensitive') then p_sensitivity else 'normal' end;

  insert into public.opm_agenda(meeting_id, title, details, source, sensitivity,
                                status, required_flag, created_by,
                                sort_order)
  values (p_id, trim(p_title), p_details, v_src, v_sens, 'approved', v_req, v_name,
          coalesce((select max(sort_order)+1 from public.opm_agenda where meeting_id = p_id), 0))
  returning id into v_new;

  perform public._opm_audit(v_uid, v_name, 'opm_agenda_add', null, null,
     jsonb_build_object('meeting_id', p_id, 'agenda_id', v_new, 'required', v_req,
                        'sensitivity', v_sens), null);
  return jsonb_build_object('ok', true, 'id', v_new);
end $fn$;

-- ============================================================================
-- 10) opm_agenda_set — approve/reject/defer/edit/remove/ack/discuss/decision/
--     recap_toggle/sensitivity on one agenda item.  p_payload keys by op:
--       edit: {title, details}   decision: {note}   sort: {sort_order}
--       sensitivity: {sensitivity}
-- ============================================================================
create or replace function public.opm_agenda_set(
  p_username text, p_password text, p_item_id bigint, p_op text,
  p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_a public.opm_agenda;
        v_m public.opm_meetings; v_before jsonb; v_sens text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_a from public.opm_agenda where id = p_item_id;
  if v_a.id is null then raise exception 'not_found'; end if;
  select * into v_m from public.opm_meetings where id = v_a.meeting_id;
  if v_m.status = 'recap_sent' then raise exception 'This meeting is finalized.'; end if;
  v_before := jsonb_build_object('status', v_a.status, 'sensitivity', v_a.sensitivity,
                                 'title', v_a.title);

  if p_op = 'approve' then
    update public.opm_agenda set status='approved', decided_by=v_name, decided_at=now(), updated_at=now()
    where id = p_item_id;
  elsif p_op = 'reject' then
    update public.opm_agenda set status='rejected', decided_by=v_name, decided_at=now(), updated_at=now()
    where id = p_item_id;
  elsif p_op = 'defer' then
    update public.opm_agenda set status='deferred', decided_by=v_name, decided_at=now(), updated_at=now()
    where id = p_item_id;
  elsif p_op = 'remove' then
    if v_a.required_flag and not public._opm_is_leadership(v_role) then
      raise exception 'Leadership-required topics can only be removed by leadership.';
    end if;
    update public.opm_agenda set status='removed', decided_by=v_name, decided_at=now(), updated_at=now()
    where id = p_item_id;
  elsif p_op = 'ack' then
    update public.opm_agenda set ack_at=now(), ack_by=v_name, updated_at=now() where id = p_item_id;
  elsif p_op = 'edit' then
    update public.opm_agenda
       set title = coalesce(nullif(trim(p_payload->>'title'),''), title),
           details = coalesce(p_payload->>'details', details),
           updated_at = now()
     where id = p_item_id;
  elsif p_op = 'discuss' then
    update public.opm_agenda set discussed = not discussed, updated_at=now() where id = p_item_id;
  elsif p_op = 'decision' then
    update public.opm_agenda set decision_note = p_payload->>'note', updated_at=now() where id = p_item_id;
  elsif p_op = 'recap_toggle' then
    update public.opm_agenda set in_recap = not in_recap, updated_at=now() where id = p_item_id;
  elsif p_op = 'sort' then
    update public.opm_agenda set sort_order = coalesce((p_payload->>'sort_order')::int, sort_order),
           updated_at=now() where id = p_item_id;
  elsif p_op = 'sensitivity' then
    v_sens := p_payload->>'sensitivity';
    if v_sens not in ('normal','manager_only','sensitive') then raise exception 'bad_sensitivity'; end if;
    -- downgrading a sensitive item to shift-leader-visible is allowed only
    -- with an explicit reason (the UI shows the §20 warning first)
    if v_a.sensitivity in ('sensitive','manager_only') and v_sens = 'normal'
       and coalesce(trim(p_payload->>'reason'),'') = '' then
      raise exception 'A reason is required to make a sensitive item shift-leader visible.';
    end if;
    update public.opm_agenda set sensitivity = v_sens, updated_at=now() where id = p_item_id;
  else
    raise exception 'Unknown op %', p_op;
  end if;

  perform public._opm_audit(v_uid, v_name, 'opm_agenda_'||p_op, null, v_before,
     jsonb_build_object('agenda_id', p_item_id, 'payload', p_payload), p_payload->>'reason');
  return jsonb_build_object('ok', true);
end $fn$;

-- ============================================================================
-- 11) opm_insights_generate — the server-side "Cherry prep" pass. Scans ONLY
--     approved sources (request doc §10), each defensively (missing live
--     tables are skipped, never fatal), and files suggestions in the
--     manager-only queue. YOUR VOICE: aggregate non-confidential theme counts
--     ONLY — see the guardrail block at the top of this file.
-- ============================================================================
create or replace function public.opm_insights_generate(
  p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_m public.opm_meetings;
        v_review text; v_r0 date; v_r1 date; v_n int := 0;
        v_sales numeric; v_ly numeric; v_pct numeric; v_labor numeric;
        v_watch numeric; v_swatch numeric; v_cnt numeric; r record;
        v_yv_tbl text; v_rw int; v_rmin int;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_m from public.opm_meetings where id = p_id;
  if v_m.id is null then raise exception 'not_found'; end if;
  if v_m.status in ('completed','recap_sent') then raise exception 'This meeting is finished.'; end if;

  v_review := to_char((v_m.meeting_month||'-01')::date - interval '1 month', 'YYYY-MM');
  v_r0 := (v_review||'-01')::date; v_r1 := (v_r0 + interval '1 month')::date;

  -- refresh: clear previous UNDECIDED auto suggestions (decisions are kept)
  delete from public.opm_insights where meeting_id = p_id and status = 'suggested'
    and created_by = 'Cherry (auto)';

  -- ---- performance (store_metrics) ----------------------------------------
  begin
    if to_regclass('public.store_metrics') is not null then
      select sum(sales), sum(sales_ly), avg(labor_pct) into v_sales, v_ly, v_labor
      from public.store_metrics
      where location = v_m.location and metric_date >= v_r0 and metric_date < v_r1;
      v_watch  := public._opm_cfg_num('opm_labor_watch', 25);
      v_swatch := public._opm_cfg_num('opm_sales_watch', -5);
      if coalesce(v_ly,0) > 0 and v_sales is not null then
        v_pct := round(100.0 * (v_sales - v_ly) / v_ly, 1);
        insert into public.opm_insights(meeting_id, source, sensitivity, title, body, meta, created_by)
        values (p_id, 'performance', 'normal',
          case when v_pct >= 0 then 'Sales up '||v_pct||'% vs last year'
               else 'Sales down '||abs(v_pct)||'% vs last year' end,
          v_review||' sales were $'||to_char(round(v_sales),'FM999,999,999')||' vs $'
            ||to_char(round(v_ly),'FM999,999,999')||' last year ('
            ||case when v_pct>=0 then '+' else '' end||v_pct||'%). '
            ||case when v_pct < v_swatch then 'This is below the watch threshold — consider making it a discussion topic.'
                   when v_pct >= 0 then 'Worth celebrating with the team.'
                   else 'Slightly down — watch.' end,
          jsonb_build_object('review_month', v_review, 'sales', v_sales, 'sales_ly', v_ly,
                             'pct', v_pct, 'refreshed_at', now(), 'source_table', 'store_metrics'),
          'Cherry (auto)');
        v_n := v_n + 1;
      end if;
      if v_labor is not null then
        insert into public.opm_insights(meeting_id, source, sensitivity, title, body, meta, created_by)
        values (p_id, 'performance', 'normal',
          'Labor averaged '||round(v_labor,1)||'%'||case when v_labor > v_watch then ' — above target' else '' end,
          'Average labor for '||v_review||' was '||round(v_labor,1)||'% (watch level: '||v_watch||'%).'
            ||case when v_labor > v_watch then ' Consider a scheduling discussion topic.' else '' end,
          jsonb_build_object('review_month', v_review, 'labor_pct', round(v_labor,1),
                             'refreshed_at', now(), 'source_table', 'store_metrics'),
          'Cherry (auto)');
        v_n := v_n + 1;
      end if;
    end if;
  exception when others then null; end;

  -- ---- manager logbook themes (manager_logbook) ----------------------------
  begin
    if to_regclass('public.manager_logbook') is not null then
      for r in
        select category, count(*) c from public.manager_logbook
        where location = v_m.location and log_date >= v_r0 and log_date < v_r1
          and coalesce(category,'') <> ''
        group by category order by c desc limit 3
      loop
        insert into public.opm_insights(meeting_id, source, sensitivity, title, body, meta, created_by)
        values (p_id, 'logbook', 'normal',
          r.c||' logbook note'||case when r.c>1 then 's' else '' end||' about '||r.category,
          'The manager logbook has '||r.c||' '||r.category||' entr'||case when r.c>1 then 'ies' else 'y' end
            ||' during '||v_review||'. Review them for a possible discussion topic.',
          jsonb_build_object('category', r.category, 'count', r.c, 'review_month', v_review,
                             'refreshed_at', now(), 'source_table', 'manager_logbook'),
          'Cherry (auto)');
        v_n := v_n + 1;
      end loop;
    end if;
  exception when others then null; end;

  -- ---- open maintenance (live-DB table name may vary; fully defensive) -----
  begin
    v_cnt := public._opm_try_num(
      'select count(*) from public.work_orders where location = '||quote_literal(v_m.location)
      ||' and coalesce(status,'''') not ilike ''%closed%'' and coalesce(status,'''') not ilike ''%complete%''');
    if v_cnt is null then
      v_cnt := public._opm_try_num(
        'select count(*) from public.maintenance_reports where location = '||quote_literal(v_m.location)
        ||' and coalesce(status,'''') not ilike ''%closed%'' and coalesce(status,'''') not ilike ''%resolved%''');
    end if;
    if coalesce(v_cnt,0) > 0 then
      insert into public.opm_insights(meeting_id, source, sensitivity, title, body, meta, created_by)
      values (p_id, 'maintenance', 'normal',
        v_cnt||' open maintenance item'||case when v_cnt>1 then 's' else '' end,
        'There are '||v_cnt||' open maintenance work orders for '||v_m.location
          ||'. Consider a status recap or equipment-care topic.',
        jsonb_build_object('open_count', v_cnt, 'refreshed_at', now()),
        'Cherry (auto)');
      v_n := v_n + 1;
    end if;
  exception when others then null; end;

  -- ---- supply request pattern (defensive) -----------------------------------
  begin
    v_cnt := public._opm_try_num(
      'select count(*) from public.supply_requests where store = '||quote_literal(v_m.location)
      ||' and created_at >= '||quote_literal(v_r0::text)||'::date and created_at < '||quote_literal(v_r1::text)||'::date');
    if coalesce(v_cnt,0) >= 3 then
      insert into public.opm_insights(meeting_id, source, sensitivity, title, body, meta, created_by)
      values (p_id, 'supply', 'normal',
        v_cnt||' supply requests last month',
        v_m.location||' filed '||v_cnt||' supply requests during '||v_review
          ||'. If the same items keep running short, consider a par-level or ordering-routine topic.',
        jsonb_build_object('count', v_cnt, 'review_month', v_review, 'refreshed_at', now()),
        'Cherry (auto)');
      v_n := v_n + 1;
    end if;
  exception when others then null; end;

  -- ---- YOUR VOICE — GUARDRAILED (doc §11) -----------------------------------
  -- Aggregate NON-CONFIDENTIAL theme counts only. Never selects subject, body,
  -- author, or anonymous flag content. 'concern' pathway rows produce ONLY a
  -- manager-only count alert pointing back into Your Voice itself.
  begin
    v_yv_tbl := null;
    if to_regclass('public.yv_cases') is not null then v_yv_tbl := 'public.yv_cases';
    elsif to_regclass('public.yv_submissions') is not null then v_yv_tbl := 'public.yv_submissions';
    end if;
    if v_yv_tbl is not null then
      -- non-sensitive theme counts (ideas / feedback style pathways only)
      for r in execute
        'select category, count(*) c from '||v_yv_tbl
        ||' where coalesce(store,'''') = '||quote_literal(v_m.location)
        ||' and created_at >= '||quote_literal(v_r0::text)||'::date'
        ||' and created_at < '||quote_literal(v_r1::text)||'::date'
        ||' and coalesce(pathway,'''') not in (''concern'')'
        ||' and coalesce(category,'''') <> '''' group by category order by c desc limit 3'
      loop
        insert into public.opm_insights(meeting_id, source, sensitivity, title, body, meta, created_by)
        values (p_id, 'your_voice', 'normal',
          'Team voice theme: '||r.c||' item'||case when r.c>1 then 's' else '' end||' about '||r.category,
          'Your Voice received '||r.c||' non-confidential submission'||case when r.c>1 then 's' else '' end
            ||' in the "'||r.category||'" category during '||v_review
            ||'. If you bring this up, use only the sanitized theme — never the submission, the author, or details.',
          jsonb_build_object('category', r.category, 'count', r.c, 'review_month', v_review,
                             'refreshed_at', now(), 'privacy', 'aggregate-only; no content or identity read'),
          'Cherry (auto)');
        v_n := v_n + 1;
      end loop;
      -- confidential items -> manager-only alert (count only, no content)
      v_cnt := public._opm_try_num(
        'select count(*) from '||v_yv_tbl
        ||' where coalesce(store,'''') = '||quote_literal(v_m.location)
        ||' and coalesce(pathway,'''') = ''concern'''
        ||' and coalesce(status,'''') not ilike ''%closed%''');
      if coalesce(v_cnt,0) > 0 then
        insert into public.opm_insights(meeting_id, source, sensitivity, title, body, meta, created_by)
        values (p_id, 'your_voice', 'sensitive',
          'Private: confidential Your Voice items need review',
          'There '||case when v_cnt=1 then 'is 1 open confidential item' else 'are '||v_cnt||' open confidential items' end
            ||' for this store. Review them privately inside Your Voice. These are never shown in meetings, '
            ||'briefs, or recaps, and this alert is manager-only.',
          jsonb_build_object('open_confidential_count', v_cnt, 'refreshed_at', now(),
                             'privacy', 'count only; content stays in Your Voice'),
          'Cherry (auto)');
        v_n := v_n + 1;
      end if;
    end if;
  exception when others then null; end;

  -- ---- follow-up / repeated-topic review signal (doc §15) -------------------
  begin
    v_rw   := coalesce(public._opm_cfg_num('opm_repeat_window',4),4)::int;
    v_rmin := coalesce(public._opm_cfg_num('opm_repeat_min',3),3)::int;
    for r in
      select lower(trim(a.title)) tkey, min(a.title) title,
             count(distinct a.meeting_id) mtgs
      from public.opm_agenda a
      where a.meeting_id in (
        select m2.id from public.opm_meetings m2
        where m2.location = v_m.location and m2.id <> p_id
          and m2.status in ('completed','recap_sent')
        order by m2.meeting_month desc limit v_rw)
        and a.status = 'approved'
      group by lower(trim(a.title))
      having count(distinct a.meeting_id) >= v_rmin
      limit 5
    loop
      select count(*) into v_cnt
      from public.opm_actions x
      join public.opm_agenda ag on ag.id = x.agenda_id
      join public.opm_meetings mm on mm.id = ag.meeting_id
      where mm.location = v_m.location and lower(trim(ag.title)) = r.tkey
        and x.status = 'open' and coalesce(x.due_date, current_date) < current_date;
      insert into public.opm_insights(meeting_id, source, sensitivity, title, body, meta, created_by)
      values (p_id, 'follow_up', 'normal',
        'Repeated topic: "'||r.title||'"',
        '"'||r.title||'" has come up in '||r.mtgs||' of the last '||v_rw||' meetings'
          ||case when coalesce(v_cnt,0)>0 then ' and still has '||v_cnt||' overdue action item'
             ||case when v_cnt>1 then 's' else '' end else '' end
          ||'. Treat this as a manager review signal and possible agenda topic.',
        jsonb_build_object('topic', r.title, 'meetings', r.mtgs, 'window', v_rw,
                           'overdue_actions', coalesce(v_cnt,0), 'refreshed_at', now()),
        'Cherry (auto)');
      v_n := v_n + 1;
    end loop;
    -- open carry-forward volume
    select count(*) into v_cnt from public.opm_actions a
    join public.opm_meetings m2 on m2.id = a.meeting_id
    where m2.location = v_m.location and a.status='open' and a.meeting_id <> p_id
      and m2.meeting_month < v_m.meeting_month;
    if coalesce(v_cnt,0) > 0 then
      insert into public.opm_insights(meeting_id, source, sensitivity, title, body, meta, created_by)
      values (p_id, 'follow_up', 'normal',
        v_cnt||' action item'||case when v_cnt>1 then 's' else '' end||' still open from past meetings',
        'Start the meeting with follow-up: '||v_cnt||' item'||case when v_cnt>1 then 's are' else ' is' end
          ||' still open from previous months. They are listed in the Follow-up tab.',
        jsonb_build_object('open_carry', v_cnt, 'refreshed_at', now()),
        'Cherry (auto)');
      v_n := v_n + 1;
    end if;
  exception when others then null; end;

  perform public._opm_audit(v_uid, v_name, 'opm_insights_generate', null, null,
     jsonb_build_object('meeting_id', p_id, 'generated', v_n), null);
  return jsonb_build_object('ok', true, 'generated', v_n);
end $fn$;

-- ============================================================================
-- 12) opm_insight_set — record the manager's decision on a suggestion.
--     accept -> copies into the agenda (sensitivity carried; sensitive ones
--     become manager_only agenda items so they can NEVER leak to the brief).
--     ops: accept | reject | defer | private   (doc §11: decision is recorded)
-- ============================================================================
create or replace function public.opm_insight_set(
  p_username text, p_password text, p_insight_id bigint, p_op text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_i public.opm_insights; v_new bigint;
        v_sens text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_i from public.opm_insights where id = p_insight_id;
  if v_i.id is null then raise exception 'not_found'; end if;

  if p_op = 'accept' then
    v_sens := case when v_i.sensitivity = 'sensitive' then 'manager_only' else 'normal' end;
    insert into public.opm_agenda(meeting_id, title, details, source, source_ref,
                                  sensitivity, status, created_by)
    values (v_i.meeting_id, v_i.title, v_i.body,
            case when v_i.source = 'your_voice' then 'your_voice' else 'ai' end,
            coalesce(v_i.meta,'{}'::jsonb) || jsonb_build_object('insight_id', v_i.id),
            v_sens, 'approved', v_name)
    returning id into v_new;
    update public.opm_insights set status='accepted', decided_by=v_name, decided_at=now()
    where id = p_insight_id;
  elsif p_op in ('reject','defer','private') then
    update public.opm_insights
       set status = case p_op when 'reject' then 'rejected' when 'defer' then 'deferred' else 'private' end,
           decided_by = v_name, decided_at = now()
     where id = p_insight_id;
  else
    raise exception 'Unknown op %', p_op;
  end if;

  perform public._opm_audit(v_uid, v_name, 'opm_insight_'||p_op, null,
     jsonb_build_object('insight_id', p_insight_id, 'source', v_i.source, 'sensitivity', v_i.sensitivity),
     jsonb_build_object('agenda_id', v_new), null);
  return jsonb_build_object('ok', true, 'agenda_id', v_new);
end $fn$;

-- ============================================================================
-- 13) opm_lock / opm_publish_brief / opm_brief_ack
-- ============================================================================
create or replace function public.opm_lock(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_m public.opm_meetings; v_unack int;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_m from public.opm_meetings where id = p_id;
  if v_m.id is null then raise exception 'not_found'; end if;
  if v_m.status <> 'draft' then raise exception 'Only a draft agenda can be locked.'; end if;
  select count(*) into v_unack from public.opm_agenda
  where meeting_id = p_id and required_flag and ack_at is null and status <> 'removed';
  if v_unack > 0 then
    raise exception 'Acknowledge the % leadership-required topic(s) before locking.', v_unack;
  end if;
  update public.opm_meetings
     set status='agenda_locked', locked_at=now(), locked_by=v_name, updated_by=v_name, updated_at=now()
   where id = p_id;
  perform public._opm_audit(v_uid, v_name, 'opm_lock', null, null,
     jsonb_build_object('meeting_id', p_id), null);
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.opm_publish_brief(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_m public.opm_meetings; r record; v_seeded int := 0;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_m from public.opm_meetings where id = p_id;
  if v_m.id is null then raise exception 'not_found'; end if;
  if v_m.status not in ('agenda_locked') then raise exception 'Lock the agenda before publishing the brief.'; end if;

  -- seed expected attendance: active shift leaders (and leads) of this store
  begin
    for r in
      select se.id emp_id, se.name, u.role urole
      from public.schedule_employees se
      join public.users u on u.username = se.linked_username
      where coalesce(se.active, true)
        and (u.role ilike '%lead%' or u.role ilike '%supervisor%')
        and (coalesce(se.home_location,'') = v_m.location or coalesce(u.store,'') = v_m.location)
    loop
      insert into public.opm_attendance(meeting_id, employee_id, display_name, emp_role)
      values (p_id, r.emp_id, r.name, r.urole)
      on conflict (meeting_id, employee_id) do nothing;
      v_seeded := v_seeded + 1;
    end loop;
  exception when others then null; end;

  update public.opm_meetings
     set status='brief_published', published_at=now(), published_by=v_name,
         updated_by=v_name, updated_at=now()
   where id = p_id;

  -- notify shift leaders — GENERIC text only (doc §20: nothing sensitive in
  -- notification channels; the alert just points into the app)
  begin
    if public._opm_cfg('opm_notify_leads','1') = '1' then
      perform public.push_enqueue(u.id, '🗓️ Monthly Ops Meeting brief',
        'Your pre-meeting brief for the '||v_m.location||' monthly meeting is ready. Open the Hub to review it and submit questions.',
        '', 'ops_meeting')
      from public.users u
      where (u.role ilike '%lead%' or u.role ilike '%supervisor%')
        and (coalesce(u.store,'') = v_m.location or u.store is null);
    end if;
  exception when others then null; end;

  perform public._opm_audit(v_uid, v_name, 'opm_publish_brief', null, null,
     jsonb_build_object('meeting_id', p_id, 'seeded_attendance', v_seeded), null);
  return jsonb_build_object('ok', true, 'seeded', v_seeded);
end $fn$;

create or replace function public.opm_brief_ack(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_lead(v_role) then raise exception 'forbidden'; end if;
  insert into public.opm_brief_acks(meeting_id, uid, uname)
  values (p_id, v_uid, v_name)
  on conflict (meeting_id, uid) do nothing;
  return jsonb_build_object('ok', true);
end $fn$;

-- ============================================================================
-- 14) opm_input_submit / opm_input_review — shift-leader questions & topics
-- ============================================================================
create or replace function public.opm_input_submit(
  p_username text, p_password text, p_id bigint, p_kind text, p_body text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_m public.opm_meetings; v_new bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_lead(v_role) then raise exception 'forbidden'; end if;
  select * into v_m from public.opm_meetings where id = p_id;
  if v_m.id is null then raise exception 'not_found'; end if;
  if v_m.status not in ('brief_published','in_progress') then
    raise exception 'Questions open once the pre-meeting brief is published.';
  end if;
  if coalesce(trim(p_body),'') = '' then raise exception 'Please write your question or topic.'; end if;

  insert into public.opm_sl_inputs(meeting_id, author_uid, author_name, employee_id, kind, body)
  values (p_id, v_uid, v_name, public._opm_emp_of(p_username),
          case when p_kind = 'question' then 'question' else 'topic' end, trim(p_body))
  returning id into v_new;

  -- generic manager heads-up
  begin
    perform public.push_enqueue(u.id, '🗓️ Meeting question submitted',
      'A shift leader submitted a pre-meeting item for '||v_m.location||'. Review it in the Monthly Ops Meeting Hub.',
      '', 'ops_meeting')
    from public.users u
    where public._opm_is_mgr(u.role) and (coalesce(u.store,'') = v_m.location or u.store is null);
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'id', v_new);
end $fn$;

create or replace function public.opm_input_review(
  p_username text, p_password text, p_input_id bigint, p_op text, p_response text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_s public.opm_sl_inputs; v_new bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_s from public.opm_sl_inputs where id = p_input_id;
  if v_s.id is null then raise exception 'not_found'; end if;

  if p_op = 'approve' then
    insert into public.opm_agenda(meeting_id, title, details, source, source_ref, sensitivity, status, created_by)
    values (v_s.meeting_id,
            left(coalesce(nullif(trim(p_response),''), v_s.body), 120),
            v_s.body, 'shift_leader',
            jsonb_build_object('input_id', v_s.id, 'submitted_by', v_s.author_name),
            'normal', 'approved', v_name)
    returning id into v_new;
    update public.opm_sl_inputs set status='approved', responded_by=v_name, responded_at=now()
    where id = p_input_id;
  elsif p_op = 'merge' then
    update public.opm_sl_inputs set status='merged', mgr_response=p_response,
           responded_by=v_name, responded_at=now() where id = p_input_id;
  elsif p_op = 'reject' then
    update public.opm_sl_inputs set status='rejected', mgr_response=p_response,
           responded_by=v_name, responded_at=now() where id = p_input_id;
  elsif p_op = 'respond' then
    update public.opm_sl_inputs set status='responded', mgr_response=p_response,
           responded_by=v_name, responded_at=now() where id = p_input_id;
  else
    raise exception 'Unknown op %', p_op;
  end if;

  perform public._opm_audit(v_uid, v_name, 'opm_input_'||p_op, v_s.employee_id, null,
     jsonb_build_object('input_id', p_input_id, 'agenda_id', v_new), null);
  return jsonb_build_object('ok', true, 'agenda_id', v_new);
end $fn$;

-- ============================================================================
-- 15) opm_leaders — roster for attendance / action-owner pickers
-- ============================================================================
create or replace function public.opm_leaders(p_username text, p_password text, p_store text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_out jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'employee_id', q.emp_id, 'name', q.name, 'role', q.urole) order by q.name), '[]'::jsonb)
    into v_out
  from (
    select se.id emp_id, se.name, u.role urole
    from public.schedule_employees se
    join public.users u on u.username = se.linked_username
    where coalesce(se.active, true)
      and public._opm_is_lead(u.role)
      and (coalesce(p_store,'') = '' or coalesce(se.home_location,'') = p_store
           or coalesce(u.store,'') = p_store)
  ) q;
  return v_out;
end $fn$;

-- ============================================================================
-- 16) opm_attendance_mark — BULK upsert [{employee_id,name,role,status}, ...]
-- ============================================================================
create or replace function public.opm_attendance_mark(
  p_username text, p_password text, p_id bigint, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_m public.opm_meetings; r jsonb; v_n int := 0;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_m from public.opm_meetings where id = p_id;
  if v_m.id is null then raise exception 'not_found'; end if;
  if v_m.status not in ('brief_published','in_progress') then
    raise exception 'Attendance opens after the brief is published.';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb))
  loop
    if coalesce(r->>'name','') = '' then continue; end if;
    insert into public.opm_attendance(meeting_id, employee_id, display_name, emp_role, status, marked_by, marked_at)
    values (p_id, nullif(r->>'employee_id','')::bigint, r->>'name', r->>'role',
            case when r->>'status' in ('expected','present','late','absent','excused')
                 then r->>'status' else 'present' end,
            v_name, now())
    on conflict (meeting_id, employee_id)
    do update set status = excluded.status, display_name = excluded.display_name,
                  marked_by = excluded.marked_by, marked_at = now();
    v_n := v_n + 1;
  end loop;

  if v_m.status = 'brief_published' then
    update public.opm_meetings set status='in_progress', updated_by=v_name, updated_at=now()
    where id = p_id;
  end if;

  perform public._opm_audit(v_uid, v_name, 'opm_attendance_mark', null, null,
     jsonb_build_object('meeting_id', p_id, 'rows', v_n), null);
  return jsonb_build_object('ok', true, 'marked', v_n);
end $fn$;

-- ============================================================================
-- 17) opm_action_add — action item; optionally creates a REAL task through the
--     EXISTING app_task_create (dynamic call, mirroring dsr_action_create).
-- ============================================================================
create or replace function public.opm_action_add(
  p_username text, p_password text, p_id bigint,
  p_title text, p_details text default null,
  p_owner_emp bigint default null, p_owner_name text default null,
  p_due date default null, p_agenda_id bigint default null,
  p_make_task boolean default true)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_m public.opm_meetings;
        v_new bigint; v_res jsonb; v_task text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_m from public.opm_meetings where id = p_id;
  if v_m.id is null then raise exception 'not_found'; end if;
  if v_m.status = 'recap_sent' then raise exception 'This meeting is finalized.'; end if;
  if coalesce(trim(p_title),'') = '' then raise exception 'Title is required.'; end if;

  if coalesce(p_make_task, true) then
    begin
      if p_owner_emp is not null then
        execute 'select public.app_task_create(p_username=>$1,p_password=>$2,p_title=>$3,'
                ||'p_details=>$4,p_due=>$5,p_target_type=>$6,p_target_value=>$7,'
                ||'p_employee_ids=>$8,p_completion_mode=>$9)'
          into v_res
          using p_username, p_password, 'Ops Meeting: '||trim(p_title),
                coalesce(p_details,'')||' (from the '||v_m.meeting_month||' '||v_m.location||' ops meeting)',
                p_due, 'individual', null::text, array[p_owner_emp]::bigint[], 'individual';
      else
        execute 'select public.app_task_create(p_username=>$1,p_password=>$2,p_title=>$3,'
                ||'p_details=>$4,p_due=>$5,p_target_type=>$6,p_target_value=>$7,'
                ||'p_employee_ids=>$8,p_completion_mode=>$9)'
          into v_res
          using p_username, p_password, 'Ops Meeting: '||trim(p_title),
                coalesce(p_details,'')||' (from the '||v_m.meeting_month||' '||v_m.location||' ops meeting)',
                p_due, 'store', v_m.location, null::bigint[], 'store';
      end if;
      v_task := coalesce(v_res->>'id', v_res->>'task_id', v_res #>> '{}');
    exception when others then
      v_task := null;   -- task engine unavailable: keep the meeting action anyway
    end;
  end if;

  insert into public.opm_actions(meeting_id, agenda_id, title, details, owner_emp,
                                 owner_name, due_date, task_id, created_by)
  values (p_id, p_agenda_id, trim(p_title), p_details, p_owner_emp, p_owner_name,
          p_due, v_task, v_name)
  returning id into v_new;

  perform public._opm_audit(v_uid, v_name, 'opm_action_add', p_owner_emp, null,
     jsonb_build_object('meeting_id', p_id, 'action_id', v_new, 'task_id', v_task), null);
  return jsonb_build_object('ok', true, 'id', v_new, 'task_id', v_task);
end $fn$;

-- ============================================================================
-- 18) opm_action_set — done | reopen | drop
-- ============================================================================
create or replace function public.opm_action_set(
  p_username text, p_password text, p_action_id bigint, p_op text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_a public.opm_actions;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  select * into v_a from public.opm_actions where id = p_action_id;
  if v_a.id is null then raise exception 'not_found'; end if;
  -- managers, or the action's owner marking their own item done
  if not public._opm_is_mgr(v_role) then
    if not (p_op = 'done' and v_a.owner_emp is not null
            and v_a.owner_emp = public._opm_emp_of(p_username)) then
      raise exception 'forbidden';
    end if;
  end if;

  if p_op = 'done' then
    update public.opm_actions set status='done', completed_at=now(), completed_by=v_name,
           updated_at=now() where id = p_action_id;
  elsif p_op = 'reopen' then
    update public.opm_actions set status='open', completed_at=null, completed_by=null,
           updated_at=now() where id = p_action_id;
  elsif p_op = 'drop' then
    update public.opm_actions set status='dropped', updated_at=now() where id = p_action_id;
  else
    raise exception 'Unknown op %', p_op;
  end if;

  perform public._opm_audit(v_uid, v_name, 'opm_action_'||p_op, v_a.owner_emp, null,
     jsonb_build_object('action_id', p_action_id), null);
  return jsonb_build_object('ok', true);
end $fn$;

-- ============================================================================
-- 19) opm_task_sync — reconcile action completion with the shared task engine.
--     The task table lives only in the live DB, so candidates are probed
--     defensively; a miss is harmless (frontend also cross-checks via the
--     existing app_tasks_overview).
-- ============================================================================
create or replace function public.opm_task_sync(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; r record; t text; v_done boolean; v_n int := 0;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;

  for r in select * from public.opm_actions
           where meeting_id = p_id and status = 'open' and task_id is not null
  loop
    v_done := null;
    foreach t in array array['public.app_tasks','public.tasks','public.team_tasks']
    loop
      if v_done is null and to_regclass(t) is not null then
        begin
          execute 'select (coalesce(status,'''') ilike ''%done%'' or coalesce(status,'''') ilike ''%complete%'''
                  ||' or completed_at is not null) from '||t||' where id::text = $1 limit 1'
            into v_done using r.task_id;
        exception when others then v_done := null; end;
      end if;
    end loop;
    if coalesce(v_done,false) then
      update public.opm_actions set status='done', completed_at=now(),
             completed_by='Task engine sync', updated_at=now() where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'closed', v_n);
end $fn$;

-- ============================================================================
-- 20) opm_complete / opm_send_recap
-- ============================================================================
create or replace function public.opm_complete(
  p_username text, p_password text, p_id bigint, p_recap text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_m public.opm_meetings; v_recap text; r record;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_m from public.opm_meetings where id = p_id;
  if v_m.id is null then raise exception 'not_found'; end if;
  if v_m.status not in ('brief_published','in_progress') then
    raise exception 'Publish the brief and hold the meeting before completing it.';
  end if;

  v_recap := nullif(trim(coalesce(p_recap,'')),'');
  if v_recap is null then
    -- server-side recap draft from SHIFT-LEADER-SAFE content only
    v_recap := 'Meeting recap — '||v_m.location||' ('||v_m.meeting_month||')'||chr(10);
    v_recap := v_recap||chr(10)||'Topics discussed:'||chr(10);
    for r in select title, decision_note from public.opm_agenda
             where meeting_id = p_id and status='approved' and sensitivity='normal'
               and in_recap order by sort_order, id
    loop
      v_recap := v_recap||'• '||r.title
        ||case when coalesce(r.decision_note,'') <> '' then ' — Decision: '||r.decision_note else '' end||chr(10);
    end loop;
    v_recap := v_recap||chr(10)||'Action items:'||chr(10);
    for r in select title, owner_name, due_date from public.opm_actions
             where meeting_id = p_id and status <> 'dropped' order by id
    loop
      v_recap := v_recap||'• '||r.title
        ||case when r.owner_name is not null then ' — '||r.owner_name else '' end
        ||case when r.due_date is not null then ' (due '||to_char(r.due_date,'Mon DD')||')' else '' end||chr(10);
    end loop;
  end if;

  update public.opm_meetings
     set status='completed', completed_at=now(), completed_by=v_name,
         recap_text=v_recap, updated_by=v_name, updated_at=now()
   where id = p_id;
  perform public._opm_audit(v_uid, v_name, 'opm_complete', null, null,
     jsonb_build_object('meeting_id', p_id), null);
  return jsonb_build_object('ok', true, 'recap', v_recap);
end $fn$;

create or replace function public.opm_send_recap(
  p_username text, p_password text, p_id bigint, p_recap text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_m public.opm_meetings;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_m from public.opm_meetings where id = p_id;
  if v_m.id is null then raise exception 'not_found'; end if;
  if v_m.status <> 'completed' then raise exception 'Complete the meeting before sending the recap.'; end if;

  update public.opm_meetings
     set status='recap_sent', recap_sent_at=now(), recap_sent_by=v_name,
         recap_text=coalesce(nullif(trim(coalesce(p_recap,'')),''), recap_text),
         updated_by=v_name, updated_at=now()
   where id = p_id;

  -- generic notification only (doc §20) — content lives in the app
  begin
    if public._opm_cfg('opm_notify_leads','1') = '1' then
      perform public.push_enqueue(u.id, '🗓️ Meeting recap ready',
        'The recap for the '||v_m.location||' monthly ops meeting is ready in the Hub.',
        '', 'ops_meeting')
      from public.users u
      where (u.role ilike '%lead%' or u.role ilike '%supervisor%' or public._opm_is_leadership(u.role))
        and (coalesce(u.store,'') = v_m.location or u.store is null);
    end if;
  exception when others then null; end;

  perform public._opm_audit(v_uid, v_name, 'opm_send_recap', null, null,
     jsonb_build_object('meeting_id', p_id), null);
  return jsonb_build_object('ok', true);
end $fn$;

-- ============================================================================
-- 21) opm_followup — open carry-forward items + repeat signals for a store
-- ============================================================================
create or replace function public.opm_followup(p_username text, p_password text, p_store text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_items jsonb; v_signals jsonb;
        v_rw int; v_rmin int;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'meeting_id', a.meeting_id, 'from_month', m.meeting_month,
      'title', a.title, 'owner_name', a.owner_name, 'due_date', a.due_date,
      'task_id', a.task_id,
      'overdue', (a.due_date is not null and a.due_date < current_date))
      order by m.meeting_month desc, a.id), '[]'::jsonb)
    into v_items
  from public.opm_actions a
  join public.opm_meetings m on m.id = a.meeting_id
  where m.location = p_store and a.status = 'open';

  v_rw   := coalesce(public._opm_cfg_num('opm_repeat_window',4),4)::int;
  v_rmin := coalesce(public._opm_cfg_num('opm_repeat_min',3),3)::int;
  select coalesce(jsonb_agg(jsonb_build_object('topic', q.title, 'meetings', q.mtgs, 'window', v_rw)
                            order by q.mtgs desc), '[]'::jsonb)
    into v_signals
  from (
    select min(a.title) title, count(distinct a.meeting_id) mtgs
    from public.opm_agenda a
    where a.meeting_id in (select m2.id from public.opm_meetings m2
                           where m2.location = p_store and m2.status in ('completed','recap_sent')
                           order by m2.meeting_month desc limit v_rw)
      and a.status = 'approved'
    group by lower(trim(a.title))
    having count(distinct a.meeting_id) >= v_rmin
  ) q;

  return jsonb_build_object('items', v_items, 'signals', v_signals);
end $fn$;

-- ============================================================================
-- 22) opm_dashboard — leadership oversight across stores (doc §16)
-- ============================================================================
create or replace function public.opm_dashboard(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_month text; v_out jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  v_month := to_char(current_date, 'YYYY-MM');

  select coalesce(jsonb_agg(jsonb_build_object(
      'location', q.location,
      'meeting_id', q.id,
      'status', q.status,
      'meeting_date', q.meeting_date,
      'attendance_pct', q.att_pct,
      'open_actions', q.open_actions,
      'overdue_actions', q.overdue_actions,
      'carry_open', q.carry_open,
      'last_completed_month', q.last_done) order by q.location), '[]'::jsonb)
    into v_out
  from (
    select m.location, m.id, m.status, m.meeting_date,
      (select case when count(*) = 0 then null
              else round(100.0 * count(*) filter (where t.status in ('present','late')) / count(*)) end
       from public.opm_attendance t where t.meeting_id = m.id) att_pct,
      (select count(*) from public.opm_actions a where a.meeting_id = m.id and a.status='open') open_actions,
      (select count(*) from public.opm_actions a where a.meeting_id = m.id and a.status='open'
         and a.due_date is not null and a.due_date < current_date) overdue_actions,
      (select count(*) from public.opm_actions a2
       join public.opm_meetings m2 on m2.id = a2.meeting_id
       where m2.location = m.location and a2.status='open' and m2.meeting_month < m.meeting_month) carry_open,
      (select max(m3.meeting_month) from public.opm_meetings m3
       where m3.location = m.location and m3.status in ('completed','recap_sent')) last_done
    from public.opm_meetings m
    where m.meeting_month = v_month and m.meeting_kind = 'monthly'
  ) q;

  return jsonb_build_object('month', v_month, 'stores', v_out,
    'default_date', public._opm_default_date(v_month));
end $fn$;

-- ============================================================================
-- END ops_meeting.sql
-- ============================================================================
