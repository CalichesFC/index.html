-- ============================================================================
-- requests_rails.sql — REQUESTS RAILS  (ADDITIVE ONLY — idempotent)
-- Three lightweight request workflows riding the EXISTING task + push rails:
--   1) HR / Office requests : Employment Verification or W-2 reprint, by the
--      employee themselves OR a manager on their behalf. Tracked
--      requested → in_progress → fulfilled with a record of what was issued
--      and to whom/where.
--   2) Party-Pack orders    : order entry auto-creates a prep/fulfillment
--      task at the right store (catering smart-trigger pattern).
--   3) Gift-Card orders     : (esp. bulk/corporate) auto-creates a
--      fulfillment task routed to Office with qty/denominations/delivery.
--
-- Conventions (specs/CONTRACT_wave2.md):
--   * create table if not exists / create or replace function ONLY.
--   * RLS enabled, NO policies — access via SECURITY DEFINER RPCs only.
--   * Every RPC: security definer set search_path=public,extensions;
--     first args p_username, p_password; auth via public._pp_auth.
--   * Employee identity = public.schedule_employees.id (bigint).
--   * Config = app_settings (skey/sgroup/svalue), sgroup 'rq_config' —
--     EVERY list and tunable below is admin-editable (hard rule).
--   * Prefix rq_ / _rq_ chosen because _rr_ is TAKEN by
--     employee_readiness_report.sql (_rr_roster).
--
-- EXISTING objects reused (verify against live DB before apply — see the
-- ASSUMPTIONS block at the bottom):
--   public._pp_auth(p_username,p_password)  -> (uid,urole,uname)
--   public._pp_is_self(p_username,p_employee_id)
--   public.audit_log (actor_id,actor_name,action,affected_employee_id,
--                     before_value,after_value,source_module,reason)
--   public.app_task_create(...)   -- called DEFENSIVELY via dynamic execute,
--                                    same pattern as dsr_action_create
--   public.push_enqueue(user_id,title,body,url)  -- 4-arg form, wrapped in
--                                    exception when others then null
--   public.app_settings / app_settings_set (admin editing rail)
--   public.schedule_employees (id,name,linked_username,active)
--   public.users (id,username,role,store)
-- ============================================================================


-- ============================================================================
-- 1) TABLE — one shared requests table with a type column
-- ============================================================================
create table if not exists public.rq_request (
  id             bigserial primary key,
  rtype          text not null,                     -- 'hr' | 'party_pack' | 'gift_card'
  subtype        text,                              -- hr: 'Employment Verification' / 'W-2 Reprint' (rq_hr_types)
  status         text not null default 'requested', -- validated against rq_statuses config
  employee_id    bigint,                            -- subject (schedule_employees.id) — HR requests
  employee_name  text,                              -- denormalized display name of the subject
  store          text,                              -- party pack: event store; gift card: requesting store
  event_date     date,                              -- pp: event date; gc: needed-by; hr: null
  details        jsonb not null default '{}'::jsonb,-- per-type payload (items / lines / delivery / notes …)
  task_id        text,                              -- linked app_task id (best effort)
  task_status    text,                              -- 'created' | 'failed: …' | null
  issued_what    text,                              -- fulfillment record: what was issued
  issued_to      text,                              -- fulfillment record: to whom / where it went
  fulfill_note   text,
  fulfilled_by   text,
  fulfilled_at   timestamptz,
  status_history jsonb not null default '[]'::jsonb,
  created_by_uid bigint,                            -- users.id of the requester (push target)
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists rq_request_status_idx  on public.rq_request(status);
create index if not exists rq_request_rtype_idx   on public.rq_request(rtype);
create index if not exists rq_request_creator_idx on public.rq_request(created_by_uid);
create index if not exists rq_request_emp_idx     on public.rq_request(employee_id);
alter table public.rq_request enable row level security;


-- ============================================================================
-- 2) CONFIG SEEDS  (sgroup 'rq_config'; skey is a GLOBAL pk → rq_ prefix)
--    Comma-separated lists follow the site_inspection.sql convention and are
--    editable through app_settings_set / Business Settings.
-- ============================================================================
insert into public.app_settings(skey,sgroup,label,svalue,sort) values
  ('rq_hr_types',          'rq_config', 'HR/Office request types (comma-separated)',
     'Employment Verification,W-2 Reprint', 10),
  ('rq_statuses',          'rq_config', 'Request statuses in order (comma-separated)',
     'requested,in_progress,fulfilled,cancelled', 20),
  ('rq_pp_items',          'rq_config', 'Party-pack items (comma-separated)',
     'Vanilla Custard Tub,Chocolate Custard Tub,Flavor of the Week Tub,Cones (24-pack),Party Cups (25),Toppings Kit,Spoons & Napkins Kit,Dry Ice Pack', 30),
  ('rq_gc_denoms',         'rq_config', 'Gift-card denominations $ (comma-separated)',
     '10,25,50,100', 40),
  ('rq_gc_delivery',       'rq_config', 'Gift-card delivery methods (comma-separated)',
     'Pickup in store,Deliver to business,Mail', 50),
  ('rq_hr_delivery',       'rq_config', 'HR document delivery methods (comma-separated)',
     'Pickup at office,Email PDF,Mail,Fax to verifier', 60),
  ('rq_office_roles',      'rq_config', 'Roles routed HR + gift-card requests (comma-separated)',
     'Admin Manager,Vice President/Co-Owner', 70),
  ('rq_store_roles',       'rq_config', 'Roles notified of party-pack orders (comma-separated)',
     'Manager,Store Manager,Admin Manager,Vice President/Co-Owner', 80),
  ('rq_office_task_store', 'rq_config', 'Store the Office fulfillment tasks are filed under',
     'Warehouse', 90),
  ('rq_hr_due_days',       'rq_config', 'HR request task due (days out)', '5', 100),
  ('rq_pp_prep_days',      'rq_config', 'Party-pack prep task due (days BEFORE event)', '1', 110),
  ('rq_gc_due_days',       'rq_config', 'Gift-card task due (days out, if no needed-by)', '3', 120)
on conflict (skey) do nothing;


-- ============================================================================
-- 3) HELPERS
-- ============================================================================

-- contract manager gate ------------------------------------------------------
create or replace function public._rq_is_mgr(p_role text)
returns boolean language sql immutable as $fn$
  select coalesce(p_role,'') ilike any
    (array['%manager%','%admin%','%lead%','%owner%','%VP%','%vice president%']);
$fn$;

-- config readers --------------------------------------------------------------
create or replace function public._rq_cfg(p_key text, p_fb text)
returns text language sql security definer set search_path=public,extensions as $fn$
  select coalesce(
    (select nullif(btrim(svalue),'') from public.app_settings
      where skey = p_key and sgroup = 'rq_config'),
    p_fb);
$fn$;

create or replace function public._rq_cfg_num(p_key text, p_fb numeric)
returns numeric language plpgsql security definer set search_path=public,extensions as $fn$
declare v numeric;
begin
  begin
    v := public._rq_cfg(p_key, null)::numeric;
  exception when others then v := null; end;
  return coalesce(v, p_fb);
end $fn$;

create or replace function public._rq_cfg_list(p_key text, p_fb text)
returns text[] language sql security definer set search_path=public,extensions as $fn$
  select array(
    select btrim(x) from unnest(string_to_array(public._rq_cfg(p_key, p_fb), ',')) x
    where btrim(x) <> '');
$fn$;

-- caller's roster row (schedule_employees.id) ----------------------------------
create or replace function public._rq_emp_of(p_username text)
returns bigint language sql security definer set search_path=public,extensions as $fn$
  select se.id from public.schedule_employees se
  where se.linked_username = p_username limit 1;
$fn$;

-- audit (audit_log; never blocks the write) ------------------------------------
create or replace function public._rq_audit(
  p_actor_id bigint, p_actor text, p_action text, p_emp bigint,
  p_before jsonb, p_after jsonb, p_reason text)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
begin
  begin
    insert into public.audit_log(actor_id,actor_name,action,affected_employee_id,
                                 before_value,after_value,source_module,reason)
    values (p_actor_id,p_actor,p_action,p_emp,p_before,p_after,'requests_rails',p_reason);
  exception when others then null; end;
end $fn$;

-- routed task via the EXISTING app_task_create (defensive dynamic call — the
-- dsr_action_create pattern: a live signature drift degrades to
-- task_status 'failed: …' instead of blocking the request insert). -----------
create or replace function public._rq_task(
  p_username text, p_password text, p_title text, p_details text,
  p_due date, p_store text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_res jsonb; v_err text;
begin
  begin
    execute 'select public.app_task_create(p_username=>$1,p_password=>$2,p_title=>$3,'
            ||'p_details=>$4,p_due=>$5,p_target_type=>$6,p_target_value=>$7,'
            ||'p_employee_ids=>$8,p_completion_mode=>$9)'
      into v_res
      using p_username, p_password, p_title, coalesce(p_details,''),
            p_due, 'store', p_store, null::bigint[], 'store';
    return jsonb_build_object('task_id', coalesce(v_res->>'id', v_res#>>'{}'),
                              'task_status', 'created');
  exception when others then
    get stacked diagnostics v_err = message_text;
    return jsonb_build_object('task_id', null,
                              'task_status', 'failed: '||coalesce(v_err,'unknown'));
  end;
end $fn$;

-- push to every user holding one of the configured roles (never blocks) --------
create or replace function public._rq_notify(
  p_title text, p_body text, p_roles text[], p_store text)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
begin
  begin
    perform public.push_enqueue(u.id, p_title, p_body, '')
    from public.users u
    where u.role ilike any (p_roles)
      and (p_store is null or u.store = p_store or u.store is null);
  exception when others then null; end;
end $fn$;

-- push straight to one user id (requester updates; never blocks) ---------------
create or replace function public._rq_notify_user(p_uid bigint, p_title text, p_body text)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
begin
  begin
    if p_uid is not null then
      perform public.push_enqueue(p_uid, p_title, p_body, '');
    end if;
  exception when others then null; end;
end $fn$;


-- ============================================================================
-- 4) RPCs
-- ============================================================================

-- rq_config_get : every list/tunable the module needs, in one call.
-- SHAPE (top-level keys read directly by js/24): { hr_types[], statuses[],
--   pp_items[], gc_denoms[], gc_delivery[], hr_delivery[], hr_due_days,
--   pp_prep_days, gc_due_days, office_task_store, is_mgr }
create or replace function public.rq_config_get(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'hr_types',    to_jsonb(public._rq_cfg_list('rq_hr_types','Employment Verification,W-2 Reprint')),
    'statuses',    to_jsonb(public._rq_cfg_list('rq_statuses','requested,in_progress,fulfilled,cancelled')),
    'pp_items',    to_jsonb(public._rq_cfg_list('rq_pp_items','Vanilla Custard Tub,Chocolate Custard Tub')),
    'gc_denoms',   to_jsonb(public._rq_cfg_list('rq_gc_denoms','10,25,50,100')),
    'gc_delivery', to_jsonb(public._rq_cfg_list('rq_gc_delivery','Pickup in store,Deliver to business,Mail')),
    'hr_delivery', to_jsonb(public._rq_cfg_list('rq_hr_delivery','Pickup at office,Email PDF,Mail')),
    'hr_due_days',  public._rq_cfg_num('rq_hr_due_days',5),
    'pp_prep_days', public._rq_cfg_num('rq_pp_prep_days',1),
    'gc_due_days',  public._rq_cfg_num('rq_gc_due_days',3),
    'office_task_store', public._rq_cfg('rq_office_task_store','Warehouse'),
    'is_mgr', public._rq_is_mgr(v_role));
end $fn$;

-- rq_emp_search : manager-only typeahead for "on behalf of".
-- SHAPE: { employees:[ {id,name} ] }
create or replace function public.rq_emp_search(p_username text, p_password text, p_q text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_out jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._rq_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', se.id, 'name', se.name) order by se.name), '[]'::jsonb)
    into v_out
  from (select id, name from public.schedule_employees
         where coalesce(active,true)
           and name ilike '%'||coalesce(btrim(p_q),'')||'%'
         order by name limit 20) se;
  return jsonb_build_object('employees', v_out);
end $fn$;

-- rq_hr_create : Employment Verification / W-2 reprint.
--   Self-service (p_employee_id null → caller's own roster row) OR a manager
--   on someone's behalf (manager gate). Routes an Office task + push.
-- SHAPE: { ok, id, task_id, task_status }
create or replace function public.rq_hr_create(
  p_username text, p_password text, p_employee_id bigint,
  p_subtype text, p_delivery text, p_notes text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint; v_emp_name text;
  v_id bigint; v_task jsonb; v_due date; v_office text; v_title text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;

  if coalesce(btrim(p_subtype),'') = '' or
     not (p_subtype = any (public._rq_cfg_list('rq_hr_types','Employment Verification,W-2 Reprint'))) then
    raise exception 'bad_type';
  end if;

  v_emp := coalesce(p_employee_id, public._rq_emp_of(p_username));
  -- On-behalf (a subject that is NOT the caller) requires the manager gate.
  if p_employee_id is not null and not public._pp_is_self(p_username, p_employee_id) then
    if not public._rq_is_mgr(v_role) then raise exception 'forbidden'; end if;
  end if;

  if v_emp is not null then
    select se.name into v_emp_name from public.schedule_employees se where se.id = v_emp;
  end if;
  v_emp_name := coalesce(v_emp_name, v_name);

  v_due    := current_date + public._rq_cfg_num('rq_hr_due_days',5)::int;
  v_office := public._rq_cfg('rq_office_task_store','Warehouse');
  v_title  := p_subtype||' — '||v_emp_name;

  v_task := public._rq_task(p_username, p_password, v_title,
    'Requests Rails: '||p_subtype||' for '||v_emp_name
    ||case when coalesce(btrim(p_delivery),'')<>'' then ' • Delivery: '||p_delivery else '' end
    ||case when coalesce(btrim(p_notes),'')<>'' then ' • '||p_notes else '' end,
    v_due, v_office);

  insert into public.rq_request(rtype, subtype, status, employee_id, employee_name,
      store, event_date, details, task_id, task_status, status_history,
      created_by_uid, created_by)
  values ('hr', p_subtype, 'requested', v_emp, v_emp_name,
      v_office, null,
      jsonb_build_object('delivery', p_delivery, 'notes', p_notes),
      v_task->>'task_id', v_task->>'task_status',
      jsonb_build_array(jsonb_build_object('at',now(),'by',v_name,'to','requested','note',null)),
      v_uid, v_name)
  returning id into v_id;

  perform public._rq_audit(v_uid, v_name, 'rq_hr_create:'||p_subtype, v_emp, null,
      jsonb_build_object('request_id',v_id,'delivery',p_delivery), p_notes);
  perform public._rq_notify(chr(128450)||' New '||p_subtype||' request',
      v_emp_name||' — '||coalesce(p_delivery,'delivery TBD')||'. Open Requests to fulfill.',
      public._rq_cfg_list('rq_office_roles','Admin Manager,Vice President/Co-Owner'), null);

  return jsonb_build_object('ok', true, 'id', v_id,
      'task_id', v_task->>'task_id', 'task_status', v_task->>'task_status');
end $fn$;

-- rq_party_pack_create : party-pack order → auto prep/fulfillment task at the
--   store (catering smart-trigger pattern). Any authenticated staff can enter.
--   p_items = [ {item, qty} ] (item from rq_pp_items; free text tolerated).
-- SHAPE: { ok, id, task_id, task_status }
create or replace function public.rq_party_pack_create(
  p_username text, p_password text, p_store text, p_event_date date,
  p_event_time text, p_customer text, p_items jsonb, p_notes text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_id bigint; v_task jsonb;
  v_due date; v_summary text; v_n int;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_store),'') = '' then raise exception 'store_required'; end if;
  if p_event_date is null then raise exception 'event_date_required'; end if;
  v_n := coalesce(jsonb_array_length(coalesce(p_items,'[]'::jsonb)),0);
  if v_n = 0 then raise exception 'items_required'; end if;

  select string_agg(coalesce(l->>'qty','1')||'x '||coalesce(l->>'item','?'), ', ')
    into v_summary from jsonb_array_elements(p_items) l;

  v_due := greatest(current_date, p_event_date - public._rq_cfg_num('rq_pp_prep_days',1)::int);

  v_task := public._rq_task(p_username, p_password,
    'Party Pack — '||to_char(p_event_date,'Mon DD')||coalesce(' — '||nullif(btrim(p_customer),''),''),
    'Requests Rails: prep a party pack. Event '||to_char(p_event_date,'YYYY-MM-DD')
    ||coalesce(' '||nullif(btrim(p_event_time),''),'')||' at '||p_store
    ||'. Items: '||coalesce(v_summary,'—')
    ||case when coalesce(btrim(p_notes),'')<>'' then ' • '||p_notes else '' end,
    v_due, p_store);

  insert into public.rq_request(rtype, subtype, status, employee_id, employee_name,
      store, event_date, details, task_id, task_status, status_history,
      created_by_uid, created_by)
  values ('party_pack', null, 'requested', public._rq_emp_of(p_username), v_name,
      p_store, p_event_date,
      jsonb_build_object('items', p_items, 'customer', p_customer,
                         'event_time', p_event_time, 'notes', p_notes, 'summary', v_summary),
      v_task->>'task_id', v_task->>'task_status',
      jsonb_build_array(jsonb_build_object('at',now(),'by',v_name,'to','requested','note',null)),
      v_uid, v_name)
  returning id into v_id;

  perform public._rq_audit(v_uid, v_name, 'rq_party_pack_create', null, null,
      jsonb_build_object('request_id',v_id,'store',p_store,'event_date',p_event_date), p_notes);
  perform public._rq_notify(chr(127881)||' Party Pack order — '||p_store,
      to_char(p_event_date,'Mon DD')||coalesce(' — '||nullif(btrim(p_customer),''),'')
      ||' — '||coalesce(v_summary,'')||'. Prep task created.',
      public._rq_cfg_list('rq_store_roles','Manager,Store Manager,Admin Manager,Vice President/Co-Owner'),
      p_store);

  return jsonb_build_object('ok', true, 'id', v_id,
      'task_id', v_task->>'task_id', 'task_status', v_task->>'task_status');
end $fn$;

-- rq_gift_card_create : gift-card order (esp. bulk/corporate) → fulfillment
--   task routed to Office. p_lines = [ {denom, qty} ] (denoms from
--   rq_gc_denoms). Totals are computed SERVER-side and are authoritative.
-- SHAPE: { ok, id, task_id, task_status, total_qty, total_amount }
create or replace function public.rq_gift_card_create(
  p_username text, p_password text, p_store text, p_needed_by date,
  p_delivery text, p_company text, p_lines jsonb, p_notes text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_id bigint; v_task jsonb;
  v_qty int; v_amount numeric; v_due date; v_office text; v_summary text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;

  select coalesce(sum(greatest(coalesce(nullif(l->>'qty','')::int,0),0)),0),
         coalesce(sum(coalesce(nullif(l->>'denom','')::numeric,0)
                    * greatest(coalesce(nullif(l->>'qty','')::int,0),0)),0),
         string_agg(coalesce(l->>'qty','0')||'x $'||coalesce(l->>'denom','?'), ', ')
    into v_qty, v_amount, v_summary
  from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) l;
  if v_qty <= 0 then raise exception 'cards_required'; end if;

  v_office := public._rq_cfg('rq_office_task_store','Warehouse');
  v_due := coalesce(p_needed_by, current_date + public._rq_cfg_num('rq_gc_due_days',3)::int);

  v_task := public._rq_task(p_username, p_password,
    'Gift Cards — '||v_qty||' cards ($'||v_amount||')'
      ||coalesce(' — '||nullif(btrim(p_company),''),''),
    'Requests Rails: fulfill a gift-card order. '||coalesce(v_summary,'')
    ||' • Delivery: '||coalesce(nullif(btrim(p_delivery),''),'TBD')
    ||coalesce(' • Needed by '||to_char(p_needed_by,'YYYY-MM-DD'),'')
    ||coalesce(' • For: '||nullif(btrim(p_company),''),'')
    ||case when coalesce(btrim(p_notes),'')<>'' then ' • '||p_notes else '' end,
    v_due, v_office);

  insert into public.rq_request(rtype, subtype, status, employee_id, employee_name,
      store, event_date, details, task_id, task_status, status_history,
      created_by_uid, created_by)
  values ('gift_card', null, 'requested', public._rq_emp_of(p_username), v_name,
      coalesce(nullif(btrim(p_store),''), v_office), p_needed_by,
      jsonb_build_object('lines', coalesce(p_lines,'[]'::jsonb), 'delivery', p_delivery,
                         'company', p_company, 'notes', p_notes, 'summary', v_summary,
                         'total_qty', v_qty, 'total_amount', v_amount),
      v_task->>'task_id', v_task->>'task_status',
      jsonb_build_array(jsonb_build_object('at',now(),'by',v_name,'to','requested','note',null)),
      v_uid, v_name)
  returning id into v_id;

  perform public._rq_audit(v_uid, v_name, 'rq_gift_card_create', null, null,
      jsonb_build_object('request_id',v_id,'total_qty',v_qty,'total_amount',v_amount), p_notes);
  perform public._rq_notify(chr(128179)||' Gift-card order — '||v_qty||' cards',
      coalesce(nullif(btrim(p_company),''), v_name)||' — '||coalesce(v_summary,'')
      ||' — '||coalesce(nullif(btrim(p_delivery),''),'delivery TBD')||'.',
      public._rq_cfg_list('rq_office_roles','Admin Manager,Vice President/Co-Owner'), null);

  return jsonb_build_object('ok', true, 'id', v_id,
      'task_id', v_task->>'task_id', 'task_status', v_task->>'task_status',
      'total_qty', v_qty, 'total_amount', v_amount);
end $fn$;

-- rq_list : scope 'mine' (any authenticated user — their own requests, either
--   created by them or about them) or 'queue' (manager gate — everything,
--   optionally filtered by status / rtype).
-- SHAPE: { requests:[ {id,rtype,subtype,status,employee_id,employee_name,
--   store,event_date,details,task_id,task_status,issued_what,issued_to,
--   fulfill_note,fulfilled_by,fulfilled_at,status_history,created_by,
--   created_by_uid,created_at,updated_at} ] }
create or replace function public.rq_list(
  p_username text, p_password text, p_scope text default 'mine',
  p_status text default null, p_rtype text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_emp bigint; v_out jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;

  if coalesce(p_scope,'mine') = 'queue' then
    if not public._rq_is_mgr(v_role) then raise exception 'forbidden'; end if;
    select coalesce(jsonb_agg(to_jsonb(x.*) order by x.created_at desc), '[]'::jsonb)
      into v_out
    from (select * from public.rq_request
           where (p_status is null or status = p_status)
             and (p_rtype  is null or rtype  = p_rtype)
           order by created_at desc limit 300) x;
  else
    v_emp := public._rq_emp_of(p_username);
    select coalesce(jsonb_agg(to_jsonb(x.*) order by x.created_at desc), '[]'::jsonb)
      into v_out
    from (select * from public.rq_request
           where (created_by_uid = v_uid or (v_emp is not null and employee_id = v_emp))
             and (p_status is null or status = p_status)
             and (p_rtype  is null or rtype  = p_rtype)
           order by created_at desc limit 100) x;
  end if;
  return jsonb_build_object('requests', v_out);
end $fn$;

-- rq_status_set : manager gate; status must exist in rq_statuses config.
--   Fulfilling via this path is allowed but rq_fulfill is preferred (it
--   records what was issued). Notifies the requester. Audited.
-- SHAPE: { ok, id, status }
create or replace function public.rq_status_set(
  p_username text, p_password text, p_id bigint, p_status text, p_note text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_row public.rq_request;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._rq_is_mgr(v_role) then raise exception 'forbidden'; end if;
  if not (p_status = any (public._rq_cfg_list('rq_statuses','requested,in_progress,fulfilled,cancelled'))) then
    raise exception 'bad_status';
  end if;

  select * into v_row from public.rq_request where id = p_id;
  if v_row.id is null then raise exception 'not_found'; end if;

  update public.rq_request set
    status = p_status,
    fulfilled_by = case when p_status = 'fulfilled' then v_name else fulfilled_by end,
    fulfilled_at = case when p_status = 'fulfilled' then now()  else fulfilled_at end,
    status_history = status_history || jsonb_build_array(jsonb_build_object(
      'at', now(), 'by', v_name, 'to', p_status, 'note', p_note)),
    updated_at = now()
  where id = p_id;

  perform public._rq_audit(v_uid, v_name, 'rq_status_set:'||p_status, v_row.employee_id,
      jsonb_build_object('status', v_row.status), jsonb_build_object('status', p_status), p_note);
  perform public._rq_notify_user(v_row.created_by_uid,
      chr(128203)||' Request update',
      'Your '||replace(coalesce(v_row.subtype, v_row.rtype),'_',' ')||' request is now '||p_status||'.');
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_status);
end $fn$;

-- rq_fulfill : manager gate; the audited fulfillment record — WHAT was issued
--   and to WHOM/WHERE. Sets status 'fulfilled' and notifies the requester.
-- SHAPE: { ok, id, status }
create or replace function public.rq_fulfill(
  p_username text, p_password text, p_id bigint,
  p_issued_what text, p_issued_to text, p_note text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_row public.rq_request;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._rq_is_mgr(v_role) then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_issued_what),'') = '' then raise exception 'issued_what_required'; end if;

  select * into v_row from public.rq_request where id = p_id;
  if v_row.id is null then raise exception 'not_found'; end if;
  if v_row.status = 'fulfilled' then raise exception 'already_fulfilled'; end if;

  update public.rq_request set
    status = 'fulfilled',
    issued_what = p_issued_what,
    issued_to = p_issued_to,
    fulfill_note = p_note,
    fulfilled_by = v_name,
    fulfilled_at = now(),
    status_history = status_history || jsonb_build_array(jsonb_build_object(
      'at', now(), 'by', v_name, 'to', 'fulfilled',
      'note', 'Issued: '||p_issued_what||coalesce(' → '||nullif(btrim(p_issued_to),''),''))),
    updated_at = now()
  where id = p_id;

  perform public._rq_audit(v_uid, v_name, 'rq_fulfill', v_row.employee_id,
      jsonb_build_object('status', v_row.status),
      jsonb_build_object('status','fulfilled','issued_what',p_issued_what,'issued_to',p_issued_to),
      p_note);
  perform public._rq_notify_user(v_row.created_by_uid,
      chr(9989)||' Request fulfilled',
      'Your '||replace(coalesce(v_row.subtype, v_row.rtype),'_',' ')||' request was fulfilled: '
      ||p_issued_what||coalesce(' → '||nullif(btrim(p_issued_to),''),'')||'.');
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'fulfilled');
end $fn$;

-- rq_cancel : the requester may cancel their OWN un-fulfilled request;
--   managers may cancel any un-fulfilled request. Audited.
-- SHAPE: { ok, id, status }
create or replace function public.rq_cancel(
  p_username text, p_password text, p_id bigint, p_note text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_row public.rq_request;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;

  select * into v_row from public.rq_request where id = p_id;
  if v_row.id is null then raise exception 'not_found'; end if;
  if v_row.status = 'fulfilled' then raise exception 'already_fulfilled'; end if;
  if v_row.created_by_uid is distinct from v_uid and not public._rq_is_mgr(v_role) then
    raise exception 'forbidden';
  end if;

  update public.rq_request set
    status = 'cancelled',
    status_history = status_history || jsonb_build_array(jsonb_build_object(
      'at', now(), 'by', v_name, 'to', 'cancelled', 'note', p_note)),
    updated_at = now()
  where id = p_id;

  perform public._rq_audit(v_uid, v_name, 'rq_cancel', v_row.employee_id,
      jsonb_build_object('status', v_row.status), jsonb_build_object('status','cancelled'), p_note);
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'cancelled');
end $fn$;

-- rq_task_retry : if the auto-task failed at create time (e.g. the requester
--   was not allowed to call app_task_create), a manager retries it with THEIR
--   credentials from the fulfillment queue.
-- SHAPE: { ok, id, task_id, task_status }
create or replace function public.rq_task_retry(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_row public.rq_request;
  v_task jsonb; v_due date; v_store text; v_title text; v_body text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._rq_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select * into v_row from public.rq_request where id = p_id;
  if v_row.id is null then raise exception 'not_found'; end if;
  if v_row.task_id is not null then raise exception 'task_exists'; end if;

  if v_row.rtype = 'party_pack' then
    v_store := v_row.store;
    v_due := greatest(current_date,
      coalesce(v_row.event_date, current_date) - public._rq_cfg_num('rq_pp_prep_days',1)::int);
    v_title := 'Party Pack — '||coalesce(to_char(v_row.event_date,'Mon DD'),'date TBD');
    v_body := 'Requests Rails (retry): '||coalesce(v_row.details->>'summary','see request #'||v_row.id);
  elsif v_row.rtype = 'gift_card' then
    v_store := public._rq_cfg('rq_office_task_store','Warehouse');
    v_due := coalesce(v_row.event_date, current_date + public._rq_cfg_num('rq_gc_due_days',3)::int);
    v_title := 'Gift Cards — '||coalesce(v_row.details->>'total_qty','?')||' cards';
    v_body := 'Requests Rails (retry): '||coalesce(v_row.details->>'summary','see request #'||v_row.id);
  else
    v_store := public._rq_cfg('rq_office_task_store','Warehouse');
    v_due := current_date + public._rq_cfg_num('rq_hr_due_days',5)::int;
    v_title := coalesce(v_row.subtype,'HR request')||' — '||coalesce(v_row.employee_name,'');
    v_body := 'Requests Rails (retry): '||coalesce(v_row.subtype,'HR request')
              ||' for '||coalesce(v_row.employee_name,'—');
  end if;

  v_task := public._rq_task(p_username, p_password, v_title, v_body, v_due, v_store);
  update public.rq_request set
    task_id = v_task->>'task_id', task_status = v_task->>'task_status', updated_at = now()
  where id = p_id;

  perform public._rq_audit(v_uid, v_name, 'rq_task_retry', v_row.employee_id, null, v_task, null);
  return jsonb_build_object('ok', (v_task->>'task_id') is not null, 'id', p_id,
      'task_id', v_task->>'task_id', 'task_status', v_task->>'task_status');
end $fn$;


-- ============================================================================
-- 5) TEACH SCOOPY (standing practice — additive, guarded)
-- ============================================================================
insert into public.knowledge_base (category, question, answer, updated_at, updated_by)
select 'App Help', q, a, now(), 'Cowork build' from (values
  ('How do I request an employment verification or a W-2 copy?',
   'Open the Requests tile and pick the HR / W-2 tab. Choose Employment Verification or W-2 Reprint, say how you want it delivered, and submit. The office gets a task and a notification, and you can watch the status (requested, in progress, fulfilled) under My requests. Managers can also submit one on an employee''s behalf.'),
  ('How do I place a party-pack order?',
   'Open the Requests tile and pick the Party Pack tab. Choose the store, event date and time, the items and quantities, and submit. A prep task is automatically created for that store the day before the event (admins can change the lead time), and the store''s managers get a notification.'),
  ('How do I order gift cards for a business or in bulk?',
   'Open the Requests tile and pick the Gift Cards tab. Add lines with the denomination and quantity, choose how they should be delivered, and submit. A fulfillment task is routed to the office with the totals, and you''ll get a notification when your order is fulfilled.')
) v(q,a)
where not exists (select 1 from public.knowledge_base kb where kb.question = v.q);


-- ============================================================================
-- ASSUMPTIONS the integrator MUST verify against the live DB before applying:
--   1. public.app_task_create signature is exactly
--      (p_username,p_password,p_title,p_details,p_due date,p_target_type,
--       p_target_value,p_employee_ids bigint[],p_completion_mode)
--      → run: select pg_get_functiondef('public.app_task_create'::regproc);
--      (called defensively; drift degrades to task_status='failed: …' + the
--       manager Retry button, it does not block requests)
--   2. public.push_enqueue accepts the 4-arg form (user_id,title,body,url).
--      shift_console.sql used a 5-arg form — if only 5-arg exists live, add
--      the tag argument in _rq_notify/_rq_notify_user.
--   3. public._pp_auth / _pp_is_self / audit_log exist (employee_passport.sql
--      shipped) and schedule_employees has an "active" boolean (emp_phone.sql
--      relies on it too).
--   4. app_settings PK is skey (seeds use on conflict (skey) do nothing) and
--      knowledge_base(category,question,answer,updated_at,updated_by) exists.
--   5. 'Warehouse' is an acceptable app_task store target for Office tasks
--      (js/08 store pickers include it); if not, admins change
--      rq_office_task_store in Business Settings.
--   6. If app_task_create is manager-gated live, staff-submitted party-pack /
--      gift-card orders will record task_status='failed: forbidden' — the
--      request + notifications still land, and the queue shows a Retry
--      button for managers (rq_task_retry).
-- ============================================================================
