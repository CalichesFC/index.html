-- ============================================================================
-- Caliche's Hub — MARKETING COMMAND CENTER v2 GAP-FILL   (marketing_v2.sql)
-- ADDITIVE ONLY. Complements marketing_command_center.sql — every existing
-- mkt_* table/RPC is left 100% intact. Frontend: js/27_marketing_v2.js
-- (entry openMarketingV2(), overlay id marketingV2Modal).
--
-- Fills the v2 developer-request gaps:
--   A) doc 14   Store instruction packets + acknowledgements (materials
--               received, signage up/down, local photos, feedback)
--   B) doc 6.8/13 Structured campaign closeout + computed scorecard
--   C) doc 6.6/18 Approval thresholds ENFORCED from app_settings
--   D) doc 10   Budget lifecycle stages: Needs Revision/Purchased/Received/Closed
--   E) doc 11   Notifications: request/budget triggers + mkt2_notify_scan
--   F) doc 16   Leadership spend report + richer campaign search filters
--   G) doc 6.4  Marketing view of the SHARED task board (best-effort, config)
--
-- Conventions per specs/CONTRACT_wave2.md:
--   create table if not exists / create or replace function (idempotent);
--   RLS ON, NO policies (SECURITY DEFINER RPCs only);
--   every RPC: security definer set search_path=public,extensions,
--   first args p_username/p_password, auth via public._pp_auth;
--   ALL tunables in app_settings (skey,sgroup,svalue) — groups:
--     mkt_approval_rules : tier1_max(250) tier1_roles('Marketing Manager')
--                          tier2_max(1000) tier2_roles('Admin Manager')
--                          tier3_roles('Vice President/Co-Owner')  [unlimited]
--     mkt2_config        : material_warn_days(14) budget_stale_days(3)
--                          ack_keys(csv) closeout_required(csv)
--                          tasks_table('tasks') task_prefix('Marketing')
--                          notify_requests(1) notify_budgets(1)
--                          notify_instructions(1) notify_scan_leaders(1)
--     mkt_request_types  : one row per intake type (label) — list editor
--   Reuses (must exist live): _pp_auth, _mkt_leader, _mkt_log, push_enqueue,
--   app_settings, users(.store), mkt_campaigns/mkt_budget_items/mkt_requests/
--   mkt_approvals/mkt_metrics.
-- ============================================================================

-- ===========================================================================
-- 1) TABLES (RLS on, deny-all)
-- ===========================================================================

-- A. Per-campaign per-store instruction packet (what to put up / tell staff)
create table if not exists public.mkt2_store_instructions (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references public.mkt_campaigns(id) on delete cascade,
  location        text not null,
  instructions    text,                          -- what to put up / do
  employee_script text,                          -- what to tell employees
  materials_info  text,                          -- what materials are coming
  starts_on       date,
  ends_on         date,
  ack_keys        jsonb not null default '[]'::jsonb,  -- required confirm keys
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(campaign_id, location)
);
create index if not exists mkt2_instr_loc_idx  on public.mkt2_store_instructions(location);
create index if not exists mkt2_instr_camp_idx on public.mkt2_store_instructions(campaign_id);
alter table public.mkt2_store_instructions enable row level security;

-- B. Acknowledgements — BULK upsert, ONE ROW PER FIELD (contract shape rule)
create table if not exists public.mkt2_instruction_acks (
  id             uuid primary key default gen_random_uuid(),
  instruction_id uuid not null references public.mkt2_store_instructions(id) on delete cascade,
  field_key      text not null,                  -- materials_received / signage_installed / ...
  field_val      text,                           -- 'yes' | feedback text | photo url
  acked_by       text,
  acked_at       timestamptz not null default now(),
  unique(instruction_id, field_key)
);
alter table public.mkt2_instruction_acks enable row level security;

-- C. Structured closeout — BULK upsert, ONE ROW PER FIELD (contract shape rule)
create table if not exists public.mkt2_campaign_results (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.mkt_campaigns(id) on delete cascade,
  field_key   text not null,                     -- what_worked / repeat_next_year / ...
  field_val   text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  unique(campaign_id, field_key)
);
create index if not exists mkt2_results_camp_idx on public.mkt2_campaign_results(campaign_id);
alter table public.mkt2_campaign_results enable row level security;

-- ===========================================================================
-- 2) HELPERS
-- ===========================================================================

-- config readers (app_settings: skey, sgroup, svalue — contract pattern)
create or replace function public._mkt2_cfg(p_key text, p_fb text)
returns text language sql security definer set search_path=public,extensions as $fn$
  select coalesce((select svalue from public.app_settings
                   where skey=p_key and sgroup='mkt2_config' limit 1), p_fb);
$fn$;

create or replace function public._mkt2_cfgn(p_key text, p_group text, p_fb numeric)
returns numeric language plpgsql security definer set search_path=public,extensions as $fn$
declare v numeric;
begin
  begin
    select svalue::numeric into v from public.app_settings
     where skey=p_key and sgroup=p_group limit 1;
  exception when others then v := null; end;
  return coalesce(v, p_fb);
end $fn$;

-- broad marketing-surface gate (managers, admins, leads, owners, VP, mkt team)
create or replace function public._mkt2_mgr(p_role text)
returns boolean language sql immutable as $fn$
  select coalesce(p_role,'') ilike any (array[
    '%manager%','%admin%','%lead%','%owner%','%vp%','%vice president%',
    '%marketing%','%creative%']);
$fn$;

-- csv membership (exact role name, case/space-insensitive)
create or replace function public._mkt2_in_csv(p_val text, p_csv text)
returns boolean language sql immutable as $fn$
  select exists (select 1 from unnest(string_to_array(coalesce(p_csv,''),',')) x
                 where lower(trim(x)) = lower(trim(coalesce(p_val,''))));
$fn$;

-- notify marketing leadership (never blocks)
create or replace function public._mkt2_notify_leaders(p_title text, p_body text)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
begin
  begin
    perform public.push_enqueue(u.id, p_title, p_body, '', 'marketing')
    from public.users u
    where u.role ilike '%marketing%' or u.role ilike '%admin%'
       or u.role ilike '%owner%' or u.role ilike '%vice president%';
  exception when others then null; end;
end $fn$;

-- ===========================================================================
-- 3) STORE INSTRUCTIONS + ACKNOWLEDGEMENTS (doc 14)
-- ===========================================================================

create or replace function public.mkt2_instruction_save(
  p_username text, p_password text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_id uuid;
        p jsonb := coalesce(p_payload,'{}'::jsonb); v_keys jsonb; v_camp text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%owner%'
          or v_role ilike '%vice president%' or v_role ilike '%marketing%') then
    raise exception 'forbidden'; end if;
  if nullif(p->>'campaign_id','') is null then raise exception 'campaign_id required'; end if;
  if nullif(p->>'location','') is null then raise exception 'location required'; end if;
  v_keys := coalesce(p->'ack_keys',
    to_jsonb(string_to_array(public._mkt2_cfg('ack_keys',
      'materials_received,signage_installed,signage_removed,photos_uploaded,feedback'), ',')));
  insert into public.mkt2_store_instructions
    (campaign_id, location, instructions, employee_script, materials_info,
     starts_on, ends_on, ack_keys, created_by)
  values
    ((p->>'campaign_id')::uuid, p->>'location', p->>'instructions', p->>'employee_script',
     p->>'materials_info', (nullif(p->>'starts_on',''))::date, (nullif(p->>'ends_on',''))::date,
     v_keys, v_name)
  on conflict (campaign_id, location) do update set
    instructions=coalesce(excluded.instructions, mkt2_store_instructions.instructions),
    employee_script=coalesce(excluded.employee_script, mkt2_store_instructions.employee_script),
    materials_info=coalesce(excluded.materials_info, mkt2_store_instructions.materials_info),
    starts_on=coalesce(excluded.starts_on, mkt2_store_instructions.starts_on),
    ends_on=coalesce(excluded.ends_on, mkt2_store_instructions.ends_on),
    ack_keys=excluded.ack_keys, updated_at=now()
  returning id into v_id;
  perform public._mkt_log('instruction', v_id, 'save', v_uid, v_name, null, p);
  -- heads-up to that store's managers (generic text; content lives in the app)
  begin
    if public._mkt2_cfg('notify_instructions','1') = '1' then
      select name into v_camp from public.mkt_campaigns where id=(p->>'campaign_id')::uuid;
      perform public.push_enqueue(u.id, '📣 Campaign instructions for your store',
        'Marketing posted instructions for "'||coalesce(v_camp,'a campaign')||'" at '||(p->>'location')||'. Open the Hub to review and confirm.',
        '', 'marketing')
      from public.users u
      where u.role ilike '%manager%' and coalesce(u.store,'') = p->>'location';
    end if;
  exception when others then null; end;
  return jsonb_build_object('ok',true,'id',v_id);
end $fn$;

-- items: TOP-LEVEL key the UI reads is data.items (contract shape rule)
create or replace function public.mkt2_instruction_list(
  p_username text, p_password text, p_campaign_id uuid, p_location text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_store text; v_loc text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._mkt2_mgr(v_role) then raise exception 'forbidden'; end if;
  select store into v_store from public.users where id=v_uid;
  v_loc := nullif(p_location,'');
  -- store managers / shift leads only see their own store
  if (v_role ilike '%store manager%' or v_role ilike '%lead%') and nullif(v_store,'') is not null then
    v_loc := v_store;
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',i.id,'campaign_id',i.campaign_id,'campaign_name',c.name,'campaign_status',c.status,
      'location',i.location,'instructions',i.instructions,'employee_script',i.employee_script,
      'materials_info',i.materials_info,'starts_on',i.starts_on,'ends_on',i.ends_on,
      'required',i.ack_keys,
      'acks', coalesce((select jsonb_object_agg(a.field_key,
                jsonb_build_object('val',a.field_val,'by',a.acked_by,'at',a.acked_at))
              from public.mkt2_instruction_acks a where a.instruction_id=i.id), '{}'::jsonb)
    ) order by i.created_at desc)
    from public.mkt2_store_instructions i
    join public.mkt_campaigns c on c.id=i.campaign_id
    where (p_campaign_id is null or i.campaign_id=p_campaign_id)
      and (v_loc is null or i.location=v_loc)
  ), '[]'::jsonb));
end $fn$;

-- BULK ack: p_acks = {field_key: value, ...} — one row per field upsert
create or replace function public.mkt2_instruction_ack(
  p_username text, p_password text, p_instruction_id uuid, p_acks jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_i public.mkt2_store_instructions;
        v_k text; v_v text; v_n int := 0; v_req int; v_done int; v_camp text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._mkt2_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_i from public.mkt2_store_instructions where id=p_instruction_id;
  if v_i.id is null then raise exception 'Not found'; end if;
  for v_k, v_v in select key, value from jsonb_each_text(coalesce(p_acks,'{}'::jsonb)) loop
    if nullif(trim(coalesce(v_v,'')),'') is null then continue; end if;
    insert into public.mkt2_instruction_acks(instruction_id, field_key, field_val, acked_by, acked_at)
    values (p_instruction_id, v_k, v_v, v_name, now())
    on conflict (instruction_id, field_key) do update
      set field_val=excluded.field_val, acked_by=excluded.acked_by, acked_at=now();
    v_n := v_n + 1;
  end loop;
  select count(*) into v_req from jsonb_array_elements_text(coalesce(v_i.ack_keys,'[]'::jsonb));
  select count(*) into v_done from public.mkt2_instruction_acks a
   where a.instruction_id=p_instruction_id
     and a.field_key in (select jsonb_array_elements_text(coalesce(v_i.ack_keys,'[]'::jsonb)));
  if v_req > 0 and v_done >= v_req then
    select name into v_camp from public.mkt_campaigns where id=v_i.campaign_id;
    perform public._mkt2_notify_leaders('✅ Store confirmed campaign actions',
      v_i.location||' completed all to-dos for "'||coalesce(v_camp,'campaign')||'".');
  end if;
  perform public._mkt_log('instruction', p_instruction_id, 'ack', v_uid, v_name, null, p_acks);
  return jsonb_build_object('ok',true,'saved',v_n,'done',v_done,'required',v_req);
end $fn$;

-- ===========================================================================
-- 4) STRUCTURED CLOSEOUT + SCORECARD (doc 6.8, 13)
-- ===========================================================================

-- BULK save: p_fields = {field_key: value, ...} — one row per field upsert
create or replace function public.mkt2_results_save(
  p_username text, p_password text, p_campaign_id uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_k text; v_v text; v_n int := 0;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._mkt2_mgr(v_role) then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.mkt_campaigns where id=p_campaign_id) then
    raise exception 'Not found'; end if;
  for v_k, v_v in select key, value from jsonb_each_text(coalesce(p_fields,'{}'::jsonb)) loop
    if nullif(trim(coalesce(v_v,'')),'') is null then continue; end if;
    insert into public.mkt2_campaign_results(campaign_id, field_key, field_val, updated_by, updated_at)
    values (p_campaign_id, v_k, v_v, v_name, now())
    on conflict (campaign_id, field_key) do update
      set field_val=excluded.field_val, updated_by=excluded.updated_by, updated_at=now();
    v_n := v_n + 1;
  end loop;
  -- keep the v1 campaign record coherent for these mirrored fields
  update public.mkt_campaigns set
    actual_spend    = coalesce((nullif(p_fields->>'actual_spend',''))::numeric, actual_spend),
    results_summary = coalesce(nullif(p_fields->>'results_summary',''), results_summary),
    lessons         = coalesce(nullif(p_fields->>'lessons',''), lessons),
    updated_at = now()
  where id = p_campaign_id;
  perform public._mkt_log('campaign', p_campaign_id, 'closeout', v_uid, v_name, null, p_fields);
  return jsonb_build_object('ok',true,'saved',v_n);
end $fn$;

create or replace function public.mkt2_results_get(
  p_username text, p_password text, p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_req text[]; v_fields jsonb;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._mkt2_mgr(v_role) then raise exception 'forbidden'; end if;
  v_req := string_to_array(public._mkt2_cfg('closeout_required','what_worked,what_didnt,repeat_next_year'), ',');
  v_fields := coalesce((select jsonb_object_agg(field_key, field_val)
    from public.mkt2_campaign_results where campaign_id=p_campaign_id), '{}'::jsonb);
  return jsonb_build_object(
    'fields', v_fields,
    'required', to_jsonb(v_req),
    'missing', coalesce((select jsonb_agg(k) from unnest(v_req) k
       where nullif(trim(coalesce(v_fields->>trim(k),'')),'') is null), '[]'::jsonb));
end $fn$;

create or replace function public.mkt2_scorecard(
  p_username text, p_password text, p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_c public.mkt_campaigns; v_fields jsonb;
        v_req text[]; v_missing int; v_ontime boolean;
        v_stores int; v_confirmed int;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._mkt2_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_c from public.mkt_campaigns where id=p_campaign_id;
  if v_c.id is null then raise exception 'Not found'; end if;
  v_fields := coalesce((select jsonb_object_agg(field_key, field_val)
    from public.mkt2_campaign_results where campaign_id=p_campaign_id), '{}'::jsonb);
  v_req := string_to_array(public._mkt2_cfg('closeout_required','what_worked,what_didnt,repeat_next_year'), ',');
  select count(*) into v_missing from unnest(v_req) k
   where nullif(trim(coalesce(v_fields->>trim(k),'')),'') is null;
  -- on-time launch: reached Live on/before launch_date (null if never Live)
  v_ontime := null;
  if v_c.launch_date is not null then
    begin
      select bool_or(((h->>'at')::timestamptz)::date <= v_c.launch_date)
        into v_ontime
        from jsonb_array_elements(coalesce(v_c.status_history,'[]'::jsonb)) h
       where h->>'to' = 'Live';
    exception when others then v_ontime := null; end;
  end if;
  select count(*) into v_stores from public.mkt2_store_instructions where campaign_id=p_campaign_id;
  select count(*) into v_confirmed from public.mkt2_store_instructions i
   where i.campaign_id=p_campaign_id
     and not exists (select 1 from jsonb_array_elements_text(coalesce(i.ack_keys,'[]'::jsonb)) k
       where not exists (select 1 from public.mkt2_instruction_acks a
         where a.instruction_id=i.id and a.field_key=k));
  return jsonb_build_object(
    'campaign', jsonb_build_object('id',v_c.id,'name',v_c.name,'status',v_c.status,
      'launch_date',v_c.launch_date,'end_date',v_c.end_date,
      'budget_requested',v_c.budget_requested,'budget_approved',v_c.budget_approved,
      'actual_spend',v_c.actual_spend,'stores',v_c.stores,'goal',v_c.goal),
    'fields', v_fields,
    'metrics', coalesce((select jsonb_agg(jsonb_build_object(
        'channel',m.channel,'metric_date',m.metric_date,'store',m.store,'source',m.source,
        'metric_key',m.metric_key,'metric_value',m.metric_value) order by m.metric_date desc)
      from public.mkt_metrics m where m.campaign_id=p_campaign_id), '[]'::jsonb),
    'calc', jsonb_build_object(
      'approved', coalesce(v_c.budget_approved,0),
      'spent', coalesce(v_c.actual_spend,0),
      'variance', coalesce(v_c.budget_approved,0) - coalesce(v_c.actual_spend,0),
      'pct_of_budget', case when coalesce(v_c.budget_approved,0) > 0
        then round(100.0 * coalesce(v_c.actual_spend,0) / v_c.budget_approved, 1) end,
      'duration_days', case when v_c.launch_date is not null and v_c.end_date is not null
        then (v_c.end_date - v_c.launch_date) end,
      'on_time_launch', v_ontime,
      'results_submitted', (v_missing = 0),
      'missing_required', v_missing,
      'stores_total', v_stores,
      'stores_confirmed', v_confirmed));
end $fn$;

-- ===========================================================================
-- 5) THRESHOLD-ENFORCED BUDGET APPROVAL + LIFECYCLE (doc 6.6, 10, 18)
-- ===========================================================================

create or replace function public.mkt2_budget_decide(
  p_username text, p_password text, p_id uuid, p_decision text, p_amount numeric, p_note text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_b public.mkt_budget_items;
        v_amt numeric; v_max numeric; v_t1r text; v_t2r text; v_t3r text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  select * into v_b from public.mkt_budget_items where id=p_id;
  if v_b.id is null then raise exception 'Not found'; end if;
  if v_b.requested_by = v_uid then
    raise exception 'Separation of duties: you cannot approve a budget line you requested.';
  end if;
  if p_decision not in ('Approved','Declined','Changes Requested') then
    raise exception 'Unknown decision %', p_decision; end if;
  -- resolve the caller approval ceiling from app_settings (mkt_approval_rules)
  v_t1r := (select svalue from public.app_settings where skey='tier1_roles' and sgroup='mkt_approval_rules' limit 1);
  v_t2r := (select svalue from public.app_settings where skey='tier2_roles' and sgroup='mkt_approval_rules' limit 1);
  v_t3r := (select svalue from public.app_settings where skey='tier3_roles' and sgroup='mkt_approval_rules' limit 1);
  v_t1r := coalesce(nullif(v_t1r,''),'Marketing Manager');
  v_t2r := coalesce(nullif(v_t2r,''),'Admin Manager');
  v_t3r := coalesce(nullif(v_t3r,''),'Vice President/Co-Owner');
  if public._mkt2_in_csv(v_role, v_t3r) then
    v_max := null;   -- unlimited
  elsif public._mkt2_in_csv(v_role, v_t2r) then
    v_max := public._mkt2_cfgn('tier2_max','mkt_approval_rules',1000);
  elsif public._mkt2_in_csv(v_role, v_t1r) then
    v_max := public._mkt2_cfgn('tier1_max','mkt_approval_rules',250);
  else
    raise exception 'forbidden: your role is not an approver (see Admin settings > mkt_approval_rules)';
  end if;
  v_amt := coalesce(p_amount, v_b.est_cost, 0);
  if p_decision = 'Approved' and v_max is not null and v_amt > v_max then
    raise exception 'This amount ($%) is above your approval limit ($%). A higher tier must approve it.', v_amt, v_max;
  end if;
  update public.mkt_budget_items set
    status = case p_decision when 'Approved' then 'Approved' when 'Declined' then 'Declined' else 'Needs Revision' end,
    approved_amount = case when p_decision='Approved' then v_amt else approved_amount end,
    approved_by = v_uid, approved_by_name = v_name, approval_date = now(),
    notes = case when nullif(p_note,'') is not null
      then coalesce(notes,'')||E'\n['||p_decision||'] '||p_note else notes end
  where id = p_id;
  insert into public.mkt_approvals(target_kind,target_id,decision,decided_by,decided_by_name,note)
  values ('budget', p_id, p_decision, v_uid, v_name, p_note);
  if v_b.campaign_id is not null then
    update public.mkt_campaigns c set budget_approved = (
      select coalesce(sum(approved_amount),0) from public.mkt_budget_items
      where campaign_id = v_b.campaign_id and status='Approved'), updated_at=now()
    where c.id = v_b.campaign_id;
  end if;
  perform public._mkt_log('budget', p_id, 'decide2:'||p_decision, v_uid, v_name,
    to_jsonb(v_b), jsonb_build_object('decision',p_decision,'amount',p_amount,'limit',v_max));
  -- tell the requester (generic text)
  begin
    perform public.push_enqueue(v_b.requested_by, '💰 Budget decision',
      'Your budget line "'||v_b.title||'" was marked '||p_decision||'. Details are in the Hub.',
      '', 'marketing');
  exception when others then null; end;
  return jsonb_build_object('ok',true,'decision',p_decision,'limit',v_max);
end $fn$;

-- post-approval lifecycle (doc 10 budget statuses)
create or replace function public.mkt2_budget_stage(
  p_username text, p_password text, p_id uuid, p_stage text, p_actual numeric)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_b public.mkt_budget_items;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%owner%'
          or v_role ilike '%vice president%' or v_role ilike '%marketing%') then
    raise exception 'forbidden'; end if;
  if p_stage not in ('Needs Revision','Purchased','Received','Closed') then
    raise exception 'Unknown stage %', p_stage; end if;
  select * into v_b from public.mkt_budget_items where id=p_id;
  if v_b.id is null then raise exception 'Not found'; end if;
  update public.mkt_budget_items set
    status = p_stage,
    actual_cost = coalesce(p_actual, actual_cost)
  where id = p_id;
  if v_b.campaign_id is not null then
    update public.mkt_campaigns c set actual_spend = (
      select coalesce(sum(actual_cost),0) from public.mkt_budget_items
      where campaign_id = v_b.campaign_id and actual_cost is not null), updated_at=now()
    where c.id = v_b.campaign_id;
  end if;
  perform public._mkt_log('budget', p_id, 'stage:'||p_stage, v_uid, v_name,
    to_jsonb(v_b), jsonb_build_object('stage',p_stage,'actual',p_actual));
  return jsonb_build_object('ok',true,'stage',p_stage);
end $fn$;

-- ===========================================================================
-- 6) LEADERSHIP: SPEND REPORT + RICHER SEARCH (doc 16, 20)
-- ===========================================================================

create or replace function public.mkt2_spend_report(
  p_username text, p_password text, p_year int)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_year int;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._mkt_leader(v_role) then raise exception 'forbidden: spend report is leaders only'; end if;
  v_year := coalesce(p_year, extract(year from current_date)::int);
  return jsonb_build_object(
    'year', v_year,
    'by_month', coalesce((select jsonb_agg(jsonb_build_object('mon',mon,'approved',appr,'actual',act) order by mon)
      from (select extract(month from coalesce(b.approval_date,b.created_at))::int as mon,
                   sum(coalesce(b.approved_amount,0)) as appr, sum(coalesce(b.actual_cost,0)) as act
            from public.mkt_budget_items b
            where extract(year from coalesce(b.approval_date,b.created_at))::int = v_year
            group by 1) m), '[]'::jsonb),
    'by_quarter', coalesce((select jsonb_agg(jsonb_build_object('q',qn,'approved',appr,'actual',act) order by qn)
      from (select ceil(extract(month from coalesce(b.approval_date,b.created_at))/3.0)::int as qn,
                   sum(coalesce(b.approved_amount,0)) as appr, sum(coalesce(b.actual_cost,0)) as act
            from public.mkt_budget_items b
            where extract(year from coalesce(b.approval_date,b.created_at))::int = v_year
            group by 1) q), '[]'::jsonb),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('category',cat,'approved',appr,'actual',act) order by appr desc)
      from (select coalesce(nullif(b.category,''),'Other') as cat,
                   sum(coalesce(b.approved_amount,0)) as appr, sum(coalesce(b.actual_cost,0)) as act
            from public.mkt_budget_items b
            where extract(year from coalesce(b.approval_date,b.created_at))::int = v_year
            group by 1) g), '[]'::jsonb),
    'by_type', coalesce((select jsonb_agg(jsonb_build_object('ctype',ct,'approved',appr,'actual',act) order by appr desc)
      from (select coalesce(nullif(c.type,''),'(no campaign)') as ct,
                   sum(coalesce(b.approved_amount,0)) as appr, sum(coalesce(b.actual_cost,0)) as act
            from public.mkt_budget_items b
            left join public.mkt_campaigns c on c.id=b.campaign_id
            where extract(year from coalesce(b.approval_date,b.created_at))::int = v_year
            group by 1) t), '[]'::jsonb),
    'total_approved', coalesce((select sum(approved_amount) from public.mkt_budget_items
      where extract(year from coalesce(approval_date,created_at))::int = v_year),0),
    'total_actual', coalesce((select sum(actual_cost) from public.mkt_budget_items
      where extract(year from coalesce(approval_date,created_at))::int = v_year),0));
end $fn$;

-- search: adds owner / launch date range / budget_status / archived toggle
create or replace function public.mkt2_campaign_search(
  p_username text, p_password text, p_filters jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; f jsonb := coalesce(p_filters,'{}'::jsonb);
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._mkt2_mgr(v_role) then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'type',c.type,'status',c.status,'season',c.season,
      'quarter',c.quarter,'year',c.year,'owner_name',c.owner_name,'stores',c.stores,
      'launch_date',c.launch_date,'end_date',c.end_date,'results_due',c.results_due,
      'budget_requested',c.budget_requested,'budget_approved',c.budget_approved,
      'actual_spend',c.actual_spend,'priority',c.priority)
      order by c.launch_date asc nulls last, c.created_at desc)
    from public.mkt_campaigns c
    where (coalesce(f->>'archived','') = '1' or c.archived_at is null)
      and (nullif(f->>'status','') is null or c.status = f->>'status')
      and (nullif(f->>'type','')   is null or c.type = f->>'type')
      and (nullif(f->>'year','')   is null or c.year = (f->>'year')::int)
      and (nullif(f->>'store','')  is null or c.stores ? (f->>'store'))
      and (nullif(f->>'owner','')  is null or c.owner_name ilike '%'||(f->>'owner')||'%')
      and (nullif(f->>'q','')      is null or c.name ilike '%'||(f->>'q')||'%')
      and (nullif(f->>'date_from','') is null or c.launch_date >= (f->>'date_from')::date)
      and (nullif(f->>'date_to','')   is null or c.launch_date <= (f->>'date_to')::date)
      and (nullif(f->>'budget_status','') is null or exists (
        select 1 from public.mkt_budget_items b
        where b.campaign_id=c.id and b.status = f->>'budget_status'))
  ), '[]'::jsonb);
end $fn$;

-- ===========================================================================
-- 7) DASHBOARD EXTRAS + SHARED TASK BOARD VIEW (doc 6.1, 6.4)
-- ===========================================================================

create or replace function public.mkt2_dashboard_extras(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_warn int;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._mkt2_mgr(v_role) then raise exception 'forbidden'; end if;
  v_warn := public._mkt2_cfgn('material_warn_days','mkt2_config',14)::int;
  return jsonb_build_object(
    'material_soon', coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'name',name,'material_deadline',material_deadline) order by material_deadline)
      from public.mkt_campaigns
      where archived_at is null and material_deadline is not null
        and material_deadline between current_date and current_date + v_warn), '[]'::jsonb),
    'results_overdue', coalesce((select jsonb_agg(jsonb_build_object(
        'id',c.id,'name',c.name,'results_due',c.results_due) order by c.results_due)
      from public.mkt_campaigns c
      where c.archived_at is null and c.results_due is not null and c.results_due < current_date
        and coalesce(c.results_summary,'') = ''
        and not exists (select 1 from public.mkt2_campaign_results r where r.campaign_id=c.id)), '[]'::jsonb),
    'approvals_pending', (select count(*) from public.mkt_budget_items where status='Pending'),
    'instr_open', coalesce((select jsonb_agg(jsonb_build_object(
        'id',i.id,'location',i.location,'campaign_name',c.name,
        'missing', (select count(*) from jsonb_array_elements_text(coalesce(i.ack_keys,'[]'::jsonb)) k
          where not exists (select 1 from public.mkt2_instruction_acks a
            where a.instruction_id=i.id and a.field_key=k))))
      from public.mkt2_store_instructions i
      join public.mkt_campaigns c on c.id=i.campaign_id
      where (i.ends_on is null or i.ends_on >= current_date)
        and exists (select 1 from jsonb_array_elements_text(coalesce(i.ack_keys,'[]'::jsonb)) k
          where not exists (select 1 from public.mkt2_instruction_acks a
            where a.instruction_id=i.id and a.field_key=k))), '[]'::jsonb),
    'spend', case when public._mkt_leader(v_role) then jsonb_build_object(
      'approved', coalesce((select sum(approved_amount) from public.mkt_budget_items
        where extract(year from coalesce(approval_date,created_at)) = extract(year from current_date)),0),
      'actual', coalesce((select sum(actual_cost) from public.mkt_budget_items
        where extract(year from coalesce(approval_date,created_at)) = extract(year from current_date)),0)) end);
end $fn$;

-- best-effort read of the SHARED task table (doc 6.4: do NOT duplicate task
-- logic). Table name + title prefix are configurable; only a "title" column
-- is assumed. If unreadable, returns available:false and the UI says so.
create or replace function public.mkt2_task_board(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_tbl text; v_pref text; v_reg regclass; v_rows jsonb;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._mkt2_mgr(v_role) then raise exception 'forbidden'; end if;
  v_tbl  := public._mkt2_cfg('tasks_table','tasks');
  v_pref := public._mkt2_cfg('task_prefix','Marketing');
  v_reg  := to_regclass('public.'||v_tbl);
  if v_reg is null then
    return jsonb_build_object('available',false,'tasks','[]'::jsonb,
      'note','Shared task table "'||v_tbl||'" was not found. Set mkt2_config > tasks_table in Admin settings.');
  end if;
  begin
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from %s t where (t.title)::text ilike %L',
      v_reg::text, v_pref||'%') into v_rows;
  exception when others then
    return jsonb_build_object('available',false,'tasks','[]'::jsonb,
      'note','Shared task table could not be read: '||sqlerrm);
  end;
  return jsonb_build_object('available',true,'tasks',v_rows,'note',null);
end $fn$;

-- ===========================================================================
-- 8) NOTIFICATION SCAN (doc 11) — run manually or on a schedule
-- ===========================================================================
create or replace function public.mkt2_notify_scan(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_warn int; v_stale int;
        v_res int; v_mat int; v_bud int; v_ins int := 0; v_loc text;
begin
  select uid,urole into v_uid,v_role from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._mkt2_mgr(v_role) then raise exception 'forbidden'; end if;
  v_warn  := public._mkt2_cfgn('material_warn_days','mkt2_config',14)::int;
  v_stale := public._mkt2_cfgn('budget_stale_days','mkt2_config',3)::int;
  select count(*) into v_res from public.mkt_campaigns c
   where c.archived_at is null and c.results_due is not null and c.results_due < current_date
     and coalesce(c.results_summary,'') = ''
     and not exists (select 1 from public.mkt2_campaign_results r where r.campaign_id=c.id);
  select count(*) into v_mat from public.mkt_campaigns
   where archived_at is null and material_deadline is not null
     and material_deadline between current_date and current_date + v_warn;
  select count(*) into v_bud from public.mkt_budget_items
   where status='Pending' and created_at < now() - make_interval(days => v_stale);
  if (v_res + v_mat + v_bud) > 0 and public._mkt2_cfg('notify_scan_leaders','1') = '1' then
    perform public._mkt2_notify_leaders('⏰ Marketing needs attention',
      v_res||' campaign(s) owe results, '||v_mat||' material deadline(s) inside '||v_warn||
      ' days, '||v_bud||' budget line(s) waiting over '||v_stale||' day(s). Open the Hub.');
  end if;
  if public._mkt2_cfg('notify_instructions','1') = '1' then
    for v_loc in
      select distinct i.location from public.mkt2_store_instructions i
      where (i.ends_on is null or i.ends_on >= current_date)
        and exists (select 1 from jsonb_array_elements_text(coalesce(i.ack_keys,'[]'::jsonb)) k
          where not exists (select 1 from public.mkt2_instruction_acks a
            where a.instruction_id=i.id and a.field_key=k))
    loop
      begin
        perform public.push_enqueue(u.id, '📣 Campaign to-dos pending',
          'Your store has marketing campaign actions waiting to be confirmed in the Hub.',
          '', 'marketing')
        from public.users u
        where u.role ilike '%manager%' and coalesce(u.store,'') = v_loc;
      exception when others then null; end;
      v_ins := v_ins + 1;
    end loop;
  end if;
  return jsonb_build_object('results_overdue',v_res,'materials_soon',v_mat,
    'budgets_stale',v_bud,'stores_reminded',v_ins);
end $fn$;

-- ===========================================================================
-- 9) NOTIFICATION TRIGGERS on EXISTING tables (additive; existing RPCs untouched)
-- ===========================================================================

create or replace function public.mkt2_request_notify_tg()
returns trigger language plpgsql security definer set search_path=public,extensions as $fn$
begin
  if tg_op = 'INSERT' then
    if public._mkt2_cfg('notify_requests','1') = '1' then
      perform public._mkt2_notify_leaders('📣 New marketing request',
        coalesce(new.location,'A store')||' submitted: "'||new.title||'". Review it in the Marketing Command Center.');
    end if;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    begin
      perform public.push_enqueue(new.requested_by, '📣 Marketing request update',
        'Your request "'||new.title||'" is now '||new.status||'.', '', 'marketing');
    exception when others then null; end;
  end if;
  return new;
end $fn$;

drop trigger if exists mkt2_request_notify on public.mkt_requests;
create trigger mkt2_request_notify
  after insert or update on public.mkt_requests
  for each row execute function public.mkt2_request_notify_tg();

create or replace function public.mkt2_budget_notify_tg()
returns trigger language plpgsql security definer set search_path=public,extensions as $fn$
begin
  if new.status = 'Pending' and public._mkt2_cfg('notify_budgets','1') = '1' then
    perform public._mkt2_notify_leaders('💰 Budget approval needed',
      'New budget line "'||new.title||'" (est $'||coalesce(new.est_cost,0)||') is waiting for approval in the Hub.');
  end if;
  return new;
end $fn$;

drop trigger if exists mkt2_budget_notify on public.mkt_budget_items;
create trigger mkt2_budget_notify
  after insert on public.mkt_budget_items
  for each row execute function public.mkt2_budget_notify_tg();

-- ===========================================================================
-- 10) GRANTS (mirror app exposure: anon + authenticated; gated in-body)
-- ===========================================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'mkt2\_%' escape '\' or p.proname like '\_mkt2\_%' escape '\')
  loop
    begin execute 'grant execute on function '||r.sig||' to anon, authenticated';
    exception when others then null; end;
  end loop;
end $$;
