-- ============================================================================
-- Caliche's Hub — CATERING PIPELINE MODULE   (additive, idempotent)
-- One record per catering job: inquiry -> quoted -> approved -> booked ->
-- completed -> paid (+ lost). Run in Supabase SQL editor (proj ikgbihwkqhsfahnswfbz).
-- Auth reuses public._pm_auth (bcrypt check). Notifications use push_enqueue
-- 4-arg (always-on), fully exception-wrapped so they can never block a write.
-- ============================================================================

-- 1) The event object -------------------------------------------------------
create table if not exists public.catering_events (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  status           text not null default 'inquiry'
                     check (status in ('inquiry','quoted','approved','booked','completed','paid','lost')),
  source           text not null default 'website',      -- website|phone|walk-in|manager
  customer_name    text not null,
  customer_email   text,
  customer_phone   text,
  contact_pref     text,
  event_date       date,
  start_time       time,
  hours            numeric(4,1),
  location         text,
  guest_count      int,
  occasion         text,
  scoop_type       text default 'single',                 -- single|double
  toppings_requested int,                                 -- TOTAL toppings asked for (null = unspecified)
  travel           boolean not null default false,        -- outside immediate Las Cruces
  equipment        text,                                  -- Sundae Cart | Treat Trailer (auto from guest_count)
  notes            text,
  quote            jsonb,                                 -- {lineItems:[{label,amount}],subtotal,travelFee,total,...}
  quote_subtotal   numeric(10,2),
  travel_fee       numeric(10,2),
  deposit_amount   numeric(10,2),
  deposit_paid     boolean not null default false,
  deposit_method   text,
  deposit_ref      text,
  balance_paid     boolean not null default false,
  signed_name      text,
  signed_at        timestamptz,
  assigned_manager text,
  lost_reason      text,
  status_history   jsonb not null default '[]'::jsonb,    -- [{from,to,by,at,note}] + [{type:'note',...}]
  public_token     uuid not null default gen_random_uuid(),
  created_by       text
);
create index if not exists catering_events_date_idx   on public.catering_events(event_date);
create index if not exists catering_events_status_idx on public.catering_events(status);
alter table public.catering_events enable row level security;  -- deny-all; access only via RPCs below

-- equipment router -----------------------------------------------------------
create or replace function public._cat_equipment(p_guests int)
returns text language sql immutable as $fn$
  select case when coalesce(p_guests,0) >= 500 then 'Treat Trailer' else 'Sundae Cart' end;
$fn$;

-- manager check helper --------------------------------------------------------
create or replace function public._cat_mgr(p_role text)
returns boolean language sql immutable as $fn$
  select p_role in ('Manager','Admin Manager','Vice President/Co-Owner','Store Manager');
$fn$;

-- 2) PUBLIC (anon) inquiry create — the ONLY anon write path -------------------
create or replace function public.catering_request_create(
  p_name text, p_email text, p_phone text, p_event_date date,
  p_start_time text, p_location text, p_guest_count int,
  p_occasion text, p_scoops text, p_notes text, p_website text default '')
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_recent int; v_time time; v_id uuid;
begin
  -- honeypot: bots fill the hidden field -> pretend success, write nothing
  if coalesce(p_website,'') <> '' then return jsonb_build_object('ok',true); end if;
  -- rate limit
  select count(*) into v_recent from public.catering_events
   where source='website' and created_at > now() - interval '10 minutes';
  if v_recent >= 10 then
    raise exception 'We are getting a lot of requests right now — please call the store and we will take care of you.';
  end if;
  -- validation
  if length(trim(coalesce(p_name,''))) < 2 or length(p_name) > 120 then
    raise exception 'Please tell us your name.'; end if;
  if coalesce(nullif(trim(p_email),''),nullif(trim(p_phone),'')) is null then
    raise exception 'Please include an email or phone number so we can reach you.'; end if;
  if p_guest_count is not null and (p_guest_count < 1 or p_guest_count > 50000) then
    raise exception 'Guest count looks off — please double-check it.'; end if;
  if length(coalesce(p_notes,'')) > 2000 or length(coalesce(p_occasion,'')) > 200
     or length(coalesce(p_location,'')) > 300 or length(coalesce(p_email,'')) > 200
     or length(coalesce(p_phone,'')) > 40 then
    raise exception 'One of the fields is too long.'; end if;
  begin v_time := nullif(trim(p_start_time),'')::time; exception when others then v_time := null; end;
  insert into public.catering_events
    (status, source, customer_name, customer_email, customer_phone, event_date,
     start_time, location, guest_count, occasion,
     scoop_type, notes, equipment, status_history)
  values
    ('inquiry','website', trim(p_name), nullif(trim(p_email),''), nullif(trim(p_phone),''), p_event_date,
     v_time, nullif(trim(p_location),''), p_guest_count, nullif(trim(p_occasion),''),
     case when lower(coalesce(p_scoops,'single')) = 'double' then 'double' else 'single' end,
     nullif(trim(p_notes),''), public._cat_equipment(p_guest_count),
     jsonb_build_array(jsonb_build_object('to','inquiry','by','Website form','at',now())))
  returning id into v_id;
  return jsonb_build_object('ok',true);
end $fn$;

-- 3) Manager list -------------------------------------------------------------
create or replace function public.app_catering_list(
  p_username text, p_password text, p_filter text default 'active')
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_role text;
begin
  select urole into v_role from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._cat_mgr(v_role) then raise exception 'Managers only'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',e.id,'status',e.status,'customer_name',e.customer_name,
      'event_date',e.event_date,'start_time',e.start_time,'guest_count',e.guest_count,
      'equipment',e.equipment,'location',e.location,'occasion',e.occasion,
      'quote_subtotal',e.quote_subtotal,'deposit_paid',e.deposit_paid,
      'assigned_manager',e.assigned_manager,'source',e.source,'created_at',e.created_at,
      'conflict', exists(select 1 from public.catering_events c2
        where c2.id <> e.id and c2.event_date = e.event_date
          and c2.equipment = e.equipment and c2.status in ('approved','booked')))
      order by case e.status when 'inquiry' then 1 when 'quoted' then 2 when 'approved' then 3
                             when 'booked' then 4 when 'completed' then 5 when 'paid' then 6 else 7 end,
               e.event_date asc nulls last, e.created_at desc)
    from public.catering_events e
    where case
      when p_filter = 'all' then true
      when p_filter = 'active' then e.status not in ('paid','lost')
      else e.status = p_filter end
  ), '[]'::jsonb);
end $fn$;

-- 4) Manager get (full record + same-day conflicts) ----------------------------
create or replace function public.app_catering_get(
  p_username text, p_password text, p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_role text; v_row public.catering_events; v_conf jsonb;
begin
  select urole into v_role from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._cat_mgr(v_role) then raise exception 'Managers only'; end if;
  select * into v_row from public.catering_events where id = p_id;
  if v_row.id is null then raise exception 'Not found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',c2.id,'customer_name',c2.customer_name,'status',c2.status,
           'equipment',c2.equipment,'start_time',c2.start_time)),'[]'::jsonb)
    into v_conf
    from public.catering_events c2
   where c2.id <> v_row.id and c2.event_date = v_row.event_date
     and c2.status not in ('lost');
  return to_jsonb(v_row) || jsonb_build_object('same_day', v_conf);
end $fn$;

-- 5) Manager create/update (whitelisted fields) ---------------------------------
create or replace function public.app_catering_save(
  p_username text, p_password text, p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path=public,extensions as $fn$
declare v_role text; v_name text; v_id uuid;
begin
  select urole,uname into v_role,v_name from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._cat_mgr(v_role) then raise exception 'Managers only'; end if;
  if p_id is null then
    insert into public.catering_events
      (status, source, customer_name, customer_email, customer_phone, contact_pref,
       event_date, start_time, hours, location, guest_count, occasion, scoop_type,
       toppings_requested, travel, notes, assigned_manager, equipment, created_by, status_history)
    values
      ('inquiry', coalesce(p->>'source','phone'), coalesce(p->>'customer_name','(no name)'),
       p->>'customer_email', p->>'customer_phone', p->>'contact_pref',
       (p->>'event_date')::date, (nullif(p->>'start_time',''))::time, (nullif(p->>'hours',''))::numeric,
       p->>'location', (nullif(p->>'guest_count',''))::int, p->>'occasion',
       coalesce(p->>'scoop_type','single'), (nullif(p->>'toppings_requested',''))::int,
       coalesce((p->>'travel')::boolean,false), p->>'notes', p->>'assigned_manager',
       coalesce(nullif(p->>'equipment',''), public._cat_equipment((nullif(p->>'guest_count',''))::int)),
       v_name,
       jsonb_build_array(jsonb_build_object('to','inquiry','by',v_name,'at',now())))
    returning id into v_id;
    return v_id;
  end if;
  update public.catering_events e set
    customer_name    = case when p ? 'customer_name'  then p->>'customer_name'  else e.customer_name end,
    customer_email   = case when p ? 'customer_email' then p->>'customer_email' else e.customer_email end,
    customer_phone   = case when p ? 'customer_phone' then p->>'customer_phone' else e.customer_phone end,
    contact_pref     = case when p ? 'contact_pref'   then p->>'contact_pref'   else e.contact_pref end,
    event_date       = case when p ? 'event_date'     then (nullif(p->>'event_date',''))::date else e.event_date end,
    start_time       = case when p ? 'start_time'     then (nullif(p->>'start_time',''))::time else e.start_time end,
    hours            = case when p ? 'hours'          then (nullif(p->>'hours',''))::numeric else e.hours end,
    location         = case when p ? 'location'       then p->>'location' else e.location end,
    guest_count      = case when p ? 'guest_count'    then (nullif(p->>'guest_count',''))::int else e.guest_count end,
    occasion         = case when p ? 'occasion'       then p->>'occasion' else e.occasion end,
    scoop_type       = case when p ? 'scoop_type'     then p->>'scoop_type' else e.scoop_type end,
    toppings_requested = case when p ? 'toppings_requested' then (nullif(p->>'toppings_requested',''))::int else e.toppings_requested end,
    travel           = case when p ? 'travel'         then coalesce((p->>'travel')::boolean,false) else e.travel end,
    notes            = case when p ? 'notes'          then p->>'notes' else e.notes end,
    assigned_manager = case when p ? 'assigned_manager' then p->>'assigned_manager' else e.assigned_manager end,
    equipment        = case when p ? 'equipment' and nullif(p->>'equipment','') is not null then p->>'equipment'
                            when p ? 'guest_count' then public._cat_equipment((nullif(p->>'guest_count',''))::int)
                            else e.equipment end,
    updated_at = now()
  where e.id = p_id returning e.id into v_id;
  if v_id is null then raise exception 'Not found'; end if;
  return v_id;
end $fn$;

-- 6) Save a quote onto the event (auto-advances inquiry -> quoted) ---------------
create or replace function public.app_catering_quote_save(
  p_username text, p_password text, p_id uuid,
  p_quote jsonb, p_subtotal numeric, p_travel_fee numeric, p_deposit numeric)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_role text; v_name text; v_status text;
begin
  select urole,uname into v_role,v_name from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._cat_mgr(v_role) then raise exception 'Managers only'; end if;
  select status into v_status from public.catering_events where id=p_id;
  if v_status is null then raise exception 'Not found'; end if;
  update public.catering_events set
    quote = p_quote, quote_subtotal = p_subtotal, travel_fee = p_travel_fee,
    deposit_amount = p_deposit, updated_at = now(),
    status = case when status='inquiry' then 'quoted' else status end,
    status_history = case when status='inquiry'
      then status_history || jsonb_build_array(jsonb_build_object(
             'from','inquiry','to','quoted','by',v_name,'at',now(),'note','Quote saved'))
      else status_history end
  where id = p_id;
  return jsonb_build_object('ok',true);
end $fn$;

-- 7) Advance status (server-enforced machine + conflict warning) -----------------
create or replace function public.app_catering_advance(
  p_username text, p_password text, p_id uuid, p_to text,
  p_note text default null, p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_role text; v_name text; v_row public.catering_events;
  v_allowed text[]; v_force boolean; v_warn text := null;
begin
  select urole,uname into v_role,v_name from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._cat_mgr(v_role) then raise exception 'Managers only'; end if;
  select * into v_row from public.catering_events where id=p_id;
  if v_row.id is null then raise exception 'Not found'; end if;
  if p_to not in ('inquiry','quoted','approved','booked','completed','paid','lost') then
    raise exception 'Unknown status %', p_to; end if;
  v_force := v_role in ('Admin Manager','Vice President/Co-Owner');
  v_allowed := case v_row.status
    when 'inquiry'   then array['quoted','lost']
    when 'quoted'    then array['approved','lost']
    when 'approved'  then array['booked','lost']
    when 'booked'    then array['completed','lost']
    when 'completed' then array['paid']
    when 'lost'      then array['inquiry']
    else array[]::text[] end;
  if not (p_to = any(v_allowed)) and not v_force then
    raise exception 'Cannot move from % to % — allowed next: %', v_row.status, p_to, array_to_string(v_allowed,', ');
  end if;
  if p_to in ('approved','booked') and v_row.event_date is not null then
    if exists(select 1 from public.catering_events c2
      where c2.id <> p_id and c2.event_date = v_row.event_date
        and c2.equipment = v_row.equipment and c2.status in ('approved','booked')) then
      v_warn := 'Heads up: another '||v_row.equipment||' event is already approved/booked on '||to_char(v_row.event_date,'Mon DD')||'.';
    end if;
  end if;
  update public.catering_events e set
    status = p_to,
    signed_name = case when p_to='approved' then coalesce(nullif(p_extra->>'signed_name',''), e.signed_name) else e.signed_name end,
    signed_at   = case when p_to='approved' and e.signed_at is null then now() else e.signed_at end,
    deposit_amount = case when p_to='booked' and nullif(p_extra->>'deposit_amount','') is not null
                          then (p_extra->>'deposit_amount')::numeric else e.deposit_amount end,
    deposit_method = case when p_to='booked' then coalesce(nullif(p_extra->>'deposit_method',''), e.deposit_method) else e.deposit_method end,
    deposit_ref    = case when p_to='booked' then coalesce(nullif(p_extra->>'deposit_ref',''), e.deposit_ref) else e.deposit_ref end,
    deposit_paid   = case when p_to='booked' then true else e.deposit_paid end,
    balance_paid   = case when p_to='paid' then true else e.balance_paid end,
    lost_reason    = case when p_to='lost' then coalesce(nullif(p_extra->>'lost_reason',''), p_note, e.lost_reason) else e.lost_reason end,
    status_history = e.status_history || jsonb_build_array(jsonb_build_object(
      'from', v_row.status, 'to', p_to, 'by', v_name, 'at', now(), 'note', p_note)),
    updated_at = now()
  where e.id = p_id;
  return jsonb_build_object('ok',true,'status',p_to,'warning',v_warn);
end $fn$;

-- 8) Add a note -----------------------------------------------------------------
create or replace function public.app_catering_note(
  p_username text, p_password text, p_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_role text; v_name text;
begin
  select urole,uname into v_role,v_name from public._pm_auth(p_username,p_password);
  if v_role is null then raise exception 'Not authorized'; end if;
  if not public._cat_mgr(v_role) then raise exception 'Managers only'; end if;
  if length(trim(coalesce(p_note,''))) < 1 then raise exception 'Empty note'; end if;
  update public.catering_events set
    status_history = status_history || jsonb_build_array(jsonb_build_object(
      'type','note','by',v_name,'at',now(),'note',p_note)),
    updated_at = now()
  where id = p_id;
  return jsonb_build_object('ok',true);
end $fn$;

-- 9) Notify managers on new website inquiry (can NEVER block the insert) ----------
create or replace function public.catering_notify_fn()
returns trigger language plpgsql security definer set search_path=public,extensions as $fn$
declare r record;
begin
  begin
    if new.source = 'website' then
      for r in select id from public.users
        where role in ('Admin Manager','Vice President/Co-Owner','Manager')
      loop
        perform public.push_enqueue(r.id, '🍨 New Catering Inquiry',
          new.customer_name || ' — ' ||
          coalesce(to_char(new.event_date,'Mon DD'),'date TBD') || ' — ' ||
          coalesce(new.guest_count::text,'?') || ' guests', '');
      end loop;
    end if;
  exception when others then null;
  end;
  return new;
end $fn$;
drop trigger if exists catering_notify on public.catering_events;
create trigger catering_notify after insert on public.catering_events
  for each row execute function public.catering_notify_fn();

-- 10) Teach Scoopy ----------------------------------------------------------------
insert into public.knowledge_base (category, question, answer, updated_at, updated_by)
select 'App Help', q, a, now(), 'Cowork build' from (values
  ('How do I use the Catering Pipeline?',
   'Managers: open the Catering Pipeline tile on the dashboard. Every catering job is one card that moves through Inquiry → Quoted → Approved → Booked → Completed → Paid (or Lost). Website requests land automatically as Inquiries. Tap a card to see details, build the quote, add notes, and advance the status. Booking records the deposit (amount, method, reference). A warning appears if another event with the same equipment is already booked that day.'),
  ('How does catering pricing work?',
   'Pricing is automatic in the quote builder: under 500 guests = Sundae Cart ($200 base, 1 hour included); 500+ = Treat Trailer ($500 base, 2 hours included, needs a 28-foot footprint). Additional hours $50/hr (partial hours round up). Servings: $2 per single scoop, $3 per double, one per guest. 4 toppings included; extra toppings $25 each only if the customer asks for more than 4. $75 travel fee outside immediate Las Cruces. Subtotal is before tax.'),
  ('How do customers request catering?',
   'Customers fill out the public catering request page (linked from our site) — no login needed. Their request appears instantly on the Catering Pipeline board as an Inquiry, and managers get a push notification. You can also create an event manually for phone or walk-in requests with the New Event button.'),
  ('What is a BEO or catering run sheet?',
   'From any catering event''s detail screen, tap Print BEO to get a one-page run sheet: customer and contact info, date, time, location, equipment, servings and toppings, the itemized quote, deposit status, and notes. Use it for prep and day-of execution.')
) v(q,a)
where not exists (select 1 from public.knowledge_base kb where kb.question = v.q);

-- Done. Verify: select proname from pg_proc where proname like '%catering%';
