-- ============================================================================
-- Caliche's Hub — DAILY STORE REPORT / DIGITAL CLOSEOUT (Phase 1-2 backend)
-- Additive, idempotent. Run in Supabase SQL editor / dashboard Monaco
-- (proj ikgbihwkqhsfahnswfbz). Mirrors the `_pp_auth`/`_pp_audit` SECURITY
-- DEFINER pattern from employee_passport.sql (see CONTRACT_aaron_foundations.md).
--
-- Scope = PLAN_daily_report_build.md Phase 1 (container + closeouts + server
-- math) + Phase 2 (checklist/ratings/labor/attachments). Combined Totals /
-- Office Review / Correction workflow / dashboards / Cherry hooks are later
-- phases — this file only builds what §5.1/§5.2 of the plan assign to 1-2,
-- plus dsr_office_review (table+RPC) since Combined Totals reads off it.
--
-- ⚠ SALES SOURCE-OF-TRUTH IS UNDECIDED (PLAN §7.1). dsr_submit does NOT
-- write to daily_sales / store_metrics yet — see the TODO(sales-source)
-- block inside dsr_submit. Do not remove that guard without Aaron/Issac's
-- explicit go-ahead; writing there before the decision risks double-counting
-- sales in Scorecards / Prime Cost autofill / Scheduling forecast.
--
-- ⚠ dsr_action_create calls the EXISTING app_task_create / app_wo_create /
-- app_supply_create RPCs. Their exact argument names are NOT in this repo
-- (confirmed live-DB-only — rpc_manifest.json only has the name list, no
-- signature). Those three calls run through dynamic EXECUTE + USING params
-- inside an exception handler (see dsr_action_create), so a signature
-- mismatch degrades to a `pending_manual` dsr_action row instead of failing
-- this whole migration or the caller's request. VERIFY the real signatures
-- in prod (pg_get_functiondef('public.app_task_create'::regproc) etc.)
-- before relying on the auto-create path; tighten the EXECUTE strings once
-- confirmed.
-- ============================================================================


-- ============================================================================
-- 1) TABLES  (create table if not exists; RLS on; no policies — RPC-only)
-- ============================================================================

-- dsr_report — one per store per business_date. Admin-flagged "exception"
-- rows (corrections) are allowed to coexist with the real row for that
-- store/date via the partial unique index below.
create table if not exists public.dsr_report (
  id                bigserial primary key,
  location          text not null,
  business_date     date not null,
  status            text not null default 'draft',
  weather           text,
  ops_notes         text,
  am_manager        text,
  pm_manager        text,
  created_by        text,
  created_by_id     bigint,
  submitted_by      text,
  reviewed_by       text,
  created_at        timestamptz not null default now(),
  submitted_at      timestamptz,
  reviewed_at       timestamptz,
  locked_at         timestamptz,
  correction_of_id  bigint references public.dsr_report(id),
  is_exception      boolean not null default false,
  exception_reason  text,
  exception_by      text,
  updated_at        timestamptz not null default now()
);
-- Status values used by the RPCs below (not a hard CHECK — status vocabulary
-- is expected to grow in later phases; additive-only convention):
--   draft, five_in_progress, night_in_progress, submitted, reviewed,
--   locked, reopened
create index if not exists dsr_report_loc_date_idx on public.dsr_report(location, business_date);
create index if not exists dsr_report_status_idx on public.dsr_report(status);
create unique index if not exists dsr_report_loc_date_uq
  on public.dsr_report(location, business_date) where not is_exception;
alter table public.dsr_report enable row level security;

-- dsr_closeout — two rows per report: closeout_type in ('five','night').
create table if not exists public.dsr_closeout (
  id              bigserial primary key,
  report_id       bigint not null references public.dsr_report(id),
  closeout_type   text not null check (closeout_type in ('five','night')),
  ring_out_time   text,
  prepared_by     text,
  tape_total      numeric,
  net_tape_total  numeric,   -- night only; running/cumulative POS total at night ring-out
  register_total  numeric,   -- server-computed
  adj_total       numeric,   -- server-computed
  over_short      numeric,   -- server-computed
  bag_count       int,
  deposit         numeric,
  transactions    int,
  sign_off_by     text,
  sign_off_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (report_id, closeout_type)
);
create index if not exists dsr_closeout_report_idx on public.dsr_closeout(report_id);
alter table public.dsr_closeout enable row level security;

-- dsr_register — N rows per closeout (Front#1/Front#2/Drive-Thru + future lanes).
-- ASSUMPTION: c_misc / checks / change are entered as DOLLAR AMOUNTS;
-- c_ones..c_hundreds are BILL COUNTS (multiplied by denomination value
-- server-side in dsr_register_save / _dsr_recompute_closeout). Confirm
-- against the workbook before the frontend ships if this doesn't match.
create table if not exists public.dsr_register (
  id             bigserial primary key,
  closeout_id    bigint not null references public.dsr_closeout(id),
  position_label text,
  employee_id    bigint,
  drawer_base    numeric not null default 0,
  c_misc         numeric not null default 0,
  c_ones         numeric not null default 0,
  c_fives        numeric not null default 0,
  c_tens         numeric not null default 0,
  c_twenties     numeric not null default 0,
  c_fifties      numeric not null default 0,
  c_hundreds     numeric not null default 0,
  checks         numeric not null default 0,
  change         numeric not null default 0,
  register_total numeric,   -- server-computed
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists dsr_register_closeout_idx on public.dsr_register(closeout_id);
alter table public.dsr_register enable row level security;

-- dsr_payment_adj — MC/Visa, Donation GC, voids, Apple Pay, Caliche's GC, other.
create table if not exists public.dsr_payment_adj (
  id          bigserial primary key,
  closeout_id bigint not null references public.dsr_closeout(id),
  category    text not null,   -- mc_visa | donation_gc | voids | apple_pay | caliches_gc | other
  amount      numeric not null default 0,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists dsr_payment_adj_closeout_idx on public.dsr_payment_adj(closeout_id);
alter table public.dsr_payment_adj enable row level security;

-- dsr_change_recon — night-only safe/change reconciliation.
create table if not exists public.dsr_change_recon (
  id              bigserial primary key,
  report_id       bigint not null references public.dsr_report(id) unique,
  change_in_safe  numeric,
  required_target numeric,
  need_additional numeric,   -- server-computed
  denom           jsonb not null default '{}'::jsonb,
  total           numeric,   -- server-computed
  over_short      numeric,   -- server-computed
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.dsr_change_recon enable row level security;

-- dsr_promo — night promo/waste block.
create table if not exists public.dsr_promo (
  id                bigserial primary key,
  report_id         bigint not null references public.dsr_report(id) unique,
  free_items        int,
  promo_total_amt   numeric,
  promo_total_num   int,
  open_discount     numeric,
  food_waste        numeric,
  employee_discount numeric,
  total_promos      numeric,   -- server-computed
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.dsr_promo enable row level security;

-- dsr_office_review — Combined Totals "Office Use Only" block.
create table if not exists public.dsr_office_review (
  id                  bigserial primary key,
  report_id           bigint not null references public.dsr_report(id) unique,
  credit_cards        numeric,
  checks              numeric,
  cash                numeric,
  cash_check_deposit  numeric,
  deposited_by        text,
  deposit_verified_by text,
  review_notes        text,
  review_status       text not null default 'pending',
  reviewed_by         text,
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.dsr_office_review enable row level security;

-- dsr_checklist_entry — configurable AM/PM checklist lines, entered per report.
-- Line labels are captured at entry time (item_key/item_label) rather than
-- pulled from a separate config table — keeps Phase 1-2 scope additive; a
-- dsr_checklist_item config table can be layered on later without a rename.
create table if not exists public.dsr_checklist_entry (
  id                 bigserial primary key,
  report_id          bigint not null references public.dsr_report(id),
  item_key           text not null,
  item_label         text,
  am_done            boolean not null default false,
  am_initials        text,
  am_user_id         bigint,
  am_at              timestamptz,
  pm_done            boolean not null default false,
  pm_initials        text,
  pm_user_id         bigint,
  pm_at              timestamptz,
  comment            text,
  followup_action_id bigint,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (report_id, item_key)
);
alter table public.dsr_checklist_entry enable row level security;

-- dsr_rating — 1-10 AM/PM ratings for speed/cleanliness/friendliness/quality.
create table if not exists public.dsr_rating (
  id          bigserial primary key,
  report_id   bigint not null references public.dsr_report(id),
  category    text not null check (category in ('speed','cleanliness','friendliness','quality')),
  am_score    int check (am_score between 1 and 10),
  am_comment  text,
  am_initials text,
  am_user_id  bigint,
  pm_score    int check (pm_score between 1 and 10),
  pm_comment  text,
  pm_initials text,
  pm_user_id  bigint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (report_id, category)
);
alter table public.dsr_rating enable row level security;

-- dsr_labor — labor projection inputs + server-computed cost/% cache.
-- The am_labor_cost.../daily_labor_pct columns are a CACHE only — they are
-- always fully recomputed server-side on every dsr_labor_save, never trusted
-- from the client, so trend queries can read them directly without redoing math.
create table if not exists public.dsr_labor (
  id                bigserial primary key,
  report_id         bigint not null references public.dsr_report(id) unique,
  proj_am_sales     numeric,
  proj_pm_sales     numeric,
  avg_wage          numeric,
  am_hours          numeric,
  pm_hours          numeric,
  am_mgr            text,
  pm_mgr            text,
  am_labor_cost     numeric,
  pm_labor_cost     numeric,
  daily_labor_cost  numeric,
  proj_daily_sales  numeric,
  am_labor_pct      numeric,
  pm_labor_pct      numeric,
  daily_labor_pct   numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.dsr_labor enable row level security;

-- dsr_action — generated follow-ups (task/maintenance/supply/cash/leadership review).
create table if not exists public.dsr_action (
  id            bigserial primary key,
  report_id     bigint not null references public.dsr_report(id),
  kind          text not null,   -- task | maintenance | supply | cash_review | leadership_review
  section       text,
  title         text,
  notes         text,
  target_table  text,            -- app_task | app_wo | app_supply | null
  target_id     text,            -- id / wo_number / request_no returned by the target RPC
  status        text not null default 'open',
  created_by    text,
  created_by_id bigint,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index if not exists dsr_action_report_idx on public.dsr_action(report_id);
alter table public.dsr_action enable row level security;

-- dsr_audit — who did what to which report, when, with before/after + reason.
create table if not exists public.dsr_audit (
  id          bigserial primary key,
  report_id   bigint references public.dsr_report(id),
  actor_id    bigint,
  actor_name  text,
  action      text not null,
  field       text,
  old_val     text,
  new_val     text,
  reason      text,
  at          timestamptz not null default now()
);
create index if not exists dsr_audit_report_idx on public.dsr_audit(report_id);
alter table public.dsr_audit enable row level security;

-- dsr_attachment — deposit-slip / counted-cash photos etc (material-upload URL).
create table if not exists public.dsr_attachment (
  id             bigserial primary key,
  report_id      bigint not null references public.dsr_report(id),
  section        text,
  url            text not null,
  caption        text,
  uploaded_by    text,
  uploaded_by_id bigint,
  created_at     timestamptz not null default now()
);
create index if not exists dsr_attachment_report_idx on public.dsr_attachment(report_id);
alter table public.dsr_attachment enable row level security;


-- ============================================================================
-- 2) HELPERS  (mirror _pp_auth / _pp_audit style from employee_passport.sql)
-- ============================================================================

-- PIN auth -> uid/role/name (identical pattern to _pp_auth / _adm_auth).
create or replace function public._dsr_auth(p_username text, p_password text)
returns table(uid bigint, urole text, uname text)
language sql security definer set search_path=public,extensions as $fn$
  select u.id, u.role, u.name
  from public.users u
  where u.username = p_username
    and u.password = extensions.crypt(p_password, u.password)
  limit 1;
$fn$;

-- role gate: managers/admin/leads/VP/owner (CONTRACT ilike pattern).
create or replace function public._dsr_is_mgr(p_role text)
returns boolean language sql immutable as $fn$
  select coalesce(p_role,'') ilike '%manager%' or coalesce(p_role,'') ilike '%admin%'
      or coalesce(p_role,'') ilike '%lead%'    or coalesce(p_role,'') ilike '%owner%'
      or coalesce(p_role,'') ilike '%VP%'      or coalesce(p_role,'') ilike '%president%';
$fn$;

-- config reader: app_settings group 'dsr_config' (numeric), with a default.
create or replace function public._dsr_cfg_num(p_key text, p_default numeric)
returns numeric language sql stable as $fn$
  select coalesce(
    (select svalue::numeric from public.app_settings
      where skey = p_key and sgroup = 'dsr_config' and svalue ~ '^-?[0-9.]+$'),
    p_default);
$fn$;

-- config reader: app_settings group 'dsr_config' (text/jsonb-as-text), with a default.
create or replace function public._dsr_cfg_text(p_key text, p_default text)
returns text language sql stable as $fn$
  select coalesce(
    (select svalue from public.app_settings where skey = p_key and sgroup = 'dsr_config'),
    p_default);
$fn$;

-- append a dsr_audit row.
create or replace function public._dsr_audit(
  p_report_id bigint, p_actor_id bigint, p_actor text, p_action text,
  p_field text, p_old text, p_new text, p_reason text)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
begin
  insert into public.dsr_audit(report_id, actor_id, actor_name, action, field, old_val, new_val, reason)
  values (p_report_id, p_actor_id, p_actor, p_action, p_field, p_old, p_new, p_reason);
end $fn$;

-- recompute a closeout's register_total/adj_total/over_short from its child rows.
-- Night over/short uses Net-Tape subtraction: night tape-used = net_tape_total
-- (running POS total at night ring-out) minus the SAME report's 5:00 tape_total,
-- isolating the night-only sales window (workbook §2, Nightly Ring_Out sheet).
create or replace function public._dsr_recompute_closeout(p_closeout_id bigint)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_type text; v_report_id bigint; v_tape numeric; v_net_tape numeric;
  v_reg_total numeric; v_adj_total numeric; v_five_tape numeric; v_tape_used numeric;
begin
  select closeout_type, report_id, tape_total, net_tape_total
    into v_type, v_report_id, v_tape, v_net_tape
  from public.dsr_closeout where id = p_closeout_id;

  select coalesce(sum(register_total), 0) into v_reg_total
    from public.dsr_register where closeout_id = p_closeout_id;
  select coalesce(sum(amount), 0) into v_adj_total
    from public.dsr_payment_adj where closeout_id = p_closeout_id;

  if v_type = 'night' and v_net_tape is not null then
    select tape_total into v_five_tape
      from public.dsr_closeout where report_id = v_report_id and closeout_type = 'five';
    v_tape_used := v_net_tape - coalesce(v_five_tape, 0);
  else
    v_tape_used := v_tape;
  end if;

  update public.dsr_closeout set
    register_total = v_reg_total,
    adj_total      = v_adj_total,
    over_short     = case when v_tape_used is null then null else (v_reg_total + v_adj_total) - v_tape_used end,
    updated_at     = now()
  where id = p_closeout_id;
end $fn$;


-- ============================================================================
-- 3) RPCs  (security definer, p_username/p_password first — CONTRACT pattern)
--    Created in dependency order: dsr_get before dsr_open; dsr_validate
--    before dsr_submit.
-- ============================================================================

-- dsr_get: full nested report snapshot.
create or replace function public.dsr_get(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_out jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;

  select jsonb_build_object(
    'report', to_jsonb(r.*),
    'closeouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'closeout', to_jsonb(c.*),
        'registers', coalesce((select jsonb_agg(to_jsonb(rg.*) order by rg.id)
                                from public.dsr_register rg where rg.closeout_id = c.id), '[]'::jsonb),
        'adjustments', coalesce((select jsonb_agg(to_jsonb(pa.*) order by pa.id)
                                  from public.dsr_payment_adj pa where pa.closeout_id = c.id), '[]'::jsonb)
      ) order by c.closeout_type)
      from public.dsr_closeout c where c.report_id = r.id
    ), '[]'::jsonb),
    'change_recon', (select to_jsonb(x.*) from public.dsr_change_recon x where x.report_id = r.id),
    'promo', (select to_jsonb(x.*) from public.dsr_promo x where x.report_id = r.id),
    'office_review', (select to_jsonb(x.*) from public.dsr_office_review x where x.report_id = r.id),
    'checklist', coalesce((select jsonb_agg(to_jsonb(x.*) order by x.item_key)
                            from public.dsr_checklist_entry x where x.report_id = r.id), '[]'::jsonb),
    'ratings', coalesce((select jsonb_agg(to_jsonb(x.*) order by x.category)
                          from public.dsr_rating x where x.report_id = r.id), '[]'::jsonb),
    'labor', (select to_jsonb(x.*) from public.dsr_labor x where x.report_id = r.id),
    'actions', coalesce((select jsonb_agg(to_jsonb(x.*) order by x.id desc)
                          from public.dsr_action x where x.report_id = r.id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(to_jsonb(x.*) order by x.id desc)
                              from public.dsr_attachment x where x.report_id = r.id), '[]'::jsonb)
  ) into v_out
  from public.dsr_report r where r.id = p_id;

  if v_out is null then raise exception 'not_found'; end if;
  return v_out;
end $fn$;

-- dsr_actor: shared actor/role/store gate for the frontend.
create or replace function public.dsr_actor(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_store text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;

  select coalesce(u.store, se.home_location) into v_store
  from public.users u
  left join public.schedule_employees se on se.linked_username = u.username
  where u.id = v_uid;

  return jsonb_build_object(
    'uid', v_uid, 'name', v_name, 'role', v_role,
    'is_mgr', public._dsr_is_mgr(v_role),
    'is_office', (coalesce(v_role,'') ilike '%office%' or coalesce(v_role,'') ilike '%admin%'),
    'store', v_store
  );
end $fn$;

-- dsr_list: filtered report rows for the landing page.
create or replace function public.dsr_list(p_username text, p_password text, p_filters jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_out jsonb;
  v_loc text; v_from date; v_to date; v_status text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;

  v_loc    := nullif(p_filters->>'location','');
  v_from   := nullif(p_filters->>'from','')::date;
  v_to     := nullif(p_filters->>'to','')::date;
  v_status := nullif(p_filters->>'status','');

  select coalesce(jsonb_agg(to_jsonb(r.*) order by r.business_date desc, r.location), '[]'::jsonb)
    into v_out
  from public.dsr_report r
  where (v_loc is null or r.location = v_loc)
    and (v_from is null or r.business_date >= v_from)
    and (v_to is null or r.business_date <= v_to)
    and (v_status is null or r.status = v_status)
  limit 500;

  return v_out;
end $fn$;

-- dsr_open: create-or-get (dedupe on location+business_date).
create or replace function public.dsr_open(
  p_username text, p_password text, p_location text, p_business_date date)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_id bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_location),'') = '' or p_business_date is null then
    raise exception 'location_and_date_required';
  end if;

  select id into v_id from public.dsr_report
   where location = p_location and business_date = p_business_date and not is_exception
   limit 1;

  if v_id is null then
    insert into public.dsr_report(location, business_date, status, created_by, created_by_id)
    values (p_location, p_business_date, 'draft', v_name, v_uid)
    returning id into v_id;
    perform public._dsr_audit(v_id, v_uid, v_name, 'report_created', null, null, null, null);
  end if;

  return public.dsr_get(p_username, p_password, v_id);
end $fn$;

-- dsr_header_save: report-level fields (weather, notes, AM/PM manager).
create or replace function public.dsr_header_save(
  p_username text, p_password text, p_id bigint, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_status text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select status into v_status from public.dsr_report where id = p_id;
  if v_status is null then raise exception 'not_found'; end if;
  if v_status = 'locked' then raise exception 'report_locked'; end if;

  update public.dsr_report set
    weather    = coalesce(p_patch->>'weather', weather),
    ops_notes  = coalesce(p_patch->>'ops_notes', ops_notes),
    am_manager = coalesce(p_patch->>'am_manager', am_manager),
    pm_manager = coalesce(p_patch->>'pm_manager', pm_manager),
    updated_at = now()
  where id = p_id;

  perform public._dsr_audit(p_id, v_uid, v_name, 'header_save', null, null, null, null);
  return public.dsr_get(p_username, p_password, p_id);
end $fn$;

-- dsr_closeout_save: upserts the five/night closeout header; recomputes
-- register/adj/over_short from child rows; returns computed + a validation object.
create or replace function public.dsr_closeout_save(
  p_username text, p_password text, p_id bigint, p_type text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_status text; v_closeout_id bigint;
  v_over_short numeric; v_threshold numeric; v_blockers text[] := '{}';
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;
  if p_type not in ('five','night') then raise exception 'bad_closeout_type'; end if;

  select status into v_status from public.dsr_report where id = p_id;
  if v_status is null then raise exception 'not_found'; end if;
  if v_status = 'locked' then raise exception 'report_locked'; end if;

  insert into public.dsr_closeout(report_id, closeout_type, ring_out_time, prepared_by,
      tape_total, net_tape_total, bag_count, deposit, transactions, sign_off_by, sign_off_at)
  values (p_id, p_type, p_payload->>'ring_out_time', p_payload->>'prepared_by',
      nullif(p_payload->>'tape_total','')::numeric, nullif(p_payload->>'net_tape_total','')::numeric,
      nullif(p_payload->>'bag_count','')::int, nullif(p_payload->>'deposit','')::numeric,
      nullif(p_payload->>'transactions','')::int, p_payload->>'sign_off_by',
      case when p_payload->>'sign_off_by' is not null then now() else null end)
  on conflict (report_id, closeout_type) do update set
    ring_out_time  = excluded.ring_out_time,
    prepared_by    = excluded.prepared_by,
    tape_total     = excluded.tape_total,
    net_tape_total = excluded.net_tape_total,
    bag_count      = excluded.bag_count,
    deposit        = excluded.deposit,
    transactions   = excluded.transactions,
    sign_off_by    = excluded.sign_off_by,
    sign_off_at    = case when excluded.sign_off_by is not null then now() else dsr_closeout.sign_off_at end,
    updated_at     = now()
  returning id into v_closeout_id;

  perform public._dsr_recompute_closeout(v_closeout_id);

  update public.dsr_report set
    status = case when status = 'draft'
                   then (case when p_type = 'five' then 'five_in_progress' else 'night_in_progress' end)
                   else status end,
    updated_at = now()
  where id = p_id;

  perform public._dsr_audit(p_id, v_uid, v_name, 'closeout_save:'||p_type, null, null, null, null);

  select over_short into v_over_short from public.dsr_closeout where id = v_closeout_id;
  v_threshold := public._dsr_cfg_num('dsr_overshort_threshold', 5);
  if v_over_short is not null and abs(v_over_short) > v_threshold then
    v_blockers := array_append(v_blockers, 'over_short_exceeds_threshold');
  end if;

  return jsonb_build_object(
    'closeout', (select to_jsonb(c.*) from public.dsr_closeout c where c.id = v_closeout_id),
    'validation', jsonb_build_object('ok', (array_length(v_blockers,1) is null), 'blockers', to_jsonb(v_blockers))
  );
end $fn$;

-- dsr_register_save: upsert one register's denominations; server computes register_total.
create or replace function public.dsr_register_save(
  p_username text, p_password text, p_closeout_id bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_reg_id bigint; v_report_id bigint;
  v_drawer_base numeric; v_total numeric;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select report_id into v_report_id from public.dsr_closeout where id = p_closeout_id;
  if v_report_id is null then raise exception 'not_found'; end if;

  v_drawer_base := coalesce(nullif(p_payload->>'drawer_base','')::numeric, public._dsr_cfg_num('dsr_drawer_base', 120));

  v_total := coalesce(nullif(p_payload->>'c_misc','')::numeric, 0)
           + coalesce(nullif(p_payload->>'c_ones','')::numeric, 0)     * 1
           + coalesce(nullif(p_payload->>'c_fives','')::numeric, 0)    * 5
           + coalesce(nullif(p_payload->>'c_tens','')::numeric, 0)     * 10
           + coalesce(nullif(p_payload->>'c_twenties','')::numeric, 0) * 20
           + coalesce(nullif(p_payload->>'c_fifties','')::numeric, 0)  * 50
           + coalesce(nullif(p_payload->>'c_hundreds','')::numeric, 0) * 100
           + coalesce(nullif(p_payload->>'checks','')::numeric, 0)
           + coalesce(nullif(p_payload->>'change','')::numeric, 0)
           - v_drawer_base;

  if nullif(p_payload->>'id','') is not null then
    update public.dsr_register set
      position_label = coalesce(p_payload->>'position_label', position_label),
      employee_id    = coalesce(nullif(p_payload->>'employee_id','')::bigint, employee_id),
      drawer_base    = v_drawer_base,
      c_misc         = coalesce(nullif(p_payload->>'c_misc','')::numeric, 0),
      c_ones         = coalesce(nullif(p_payload->>'c_ones','')::numeric, 0),
      c_fives        = coalesce(nullif(p_payload->>'c_fives','')::numeric, 0),
      c_tens         = coalesce(nullif(p_payload->>'c_tens','')::numeric, 0),
      c_twenties     = coalesce(nullif(p_payload->>'c_twenties','')::numeric, 0),
      c_fifties      = coalesce(nullif(p_payload->>'c_fifties','')::numeric, 0),
      c_hundreds     = coalesce(nullif(p_payload->>'c_hundreds','')::numeric, 0),
      checks         = coalesce(nullif(p_payload->>'checks','')::numeric, 0),
      change         = coalesce(nullif(p_payload->>'change','')::numeric, 0),
      register_total = v_total,
      updated_at     = now()
    where id = (p_payload->>'id')::bigint
    returning id into v_reg_id;
  else
    insert into public.dsr_register(
      closeout_id, position_label, employee_id, drawer_base,
      c_misc, c_ones, c_fives, c_tens, c_twenties, c_fifties, c_hundreds, checks, change, register_total)
    values (
      p_closeout_id, p_payload->>'position_label', nullif(p_payload->>'employee_id','')::bigint, v_drawer_base,
      coalesce(nullif(p_payload->>'c_misc','')::numeric, 0), coalesce(nullif(p_payload->>'c_ones','')::numeric, 0),
      coalesce(nullif(p_payload->>'c_fives','')::numeric, 0), coalesce(nullif(p_payload->>'c_tens','')::numeric, 0),
      coalesce(nullif(p_payload->>'c_twenties','')::numeric, 0), coalesce(nullif(p_payload->>'c_fifties','')::numeric, 0),
      coalesce(nullif(p_payload->>'c_hundreds','')::numeric, 0), coalesce(nullif(p_payload->>'checks','')::numeric, 0),
      coalesce(nullif(p_payload->>'change','')::numeric, 0), v_total)
    returning id into v_reg_id;
  end if;

  perform public._dsr_recompute_closeout(p_closeout_id);
  perform public._dsr_audit(v_report_id, v_uid, v_name, 'register_save', null, null, null, null);

  return jsonb_build_object(
    'register', (select to_jsonb(rg.*) from public.dsr_register rg where rg.id = v_reg_id),
    'closeout', (select to_jsonb(c.*) from public.dsr_closeout c where c.id = p_closeout_id)
  );
end $fn$;

-- dsr_payment_adj_save: upsert one payment-adjustment line.
create or replace function public.dsr_payment_adj_save(
  p_username text, p_password text, p_closeout_id bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_report_id bigint; v_id bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select report_id into v_report_id from public.dsr_closeout where id = p_closeout_id;
  if v_report_id is null then raise exception 'not_found'; end if;

  if nullif(p_payload->>'id','') is not null then
    update public.dsr_payment_adj set
      category = coalesce(p_payload->>'category', category),
      amount   = coalesce(nullif(p_payload->>'amount','')::numeric, amount),
      note     = coalesce(p_payload->>'note', note)
    where id = (p_payload->>'id')::bigint
    returning id into v_id;
  else
    insert into public.dsr_payment_adj(closeout_id, category, amount, note)
    values (p_closeout_id, p_payload->>'category', coalesce(nullif(p_payload->>'amount','')::numeric, 0), p_payload->>'note')
    returning id into v_id;
  end if;

  perform public._dsr_recompute_closeout(p_closeout_id);
  perform public._dsr_audit(v_report_id, v_uid, v_name, 'payment_adj_save', null, null, null, null);

  return jsonb_build_object(
    'adjustment', (select to_jsonb(pa.*) from public.dsr_payment_adj pa where pa.id = v_id),
    'closeout', (select to_jsonb(c.*) from public.dsr_closeout c where c.id = p_closeout_id)
  );
end $fn$;

-- dsr_change_recon_save: night safe/change reconciliation.
create or replace function public.dsr_change_recon_save(
  p_username text, p_password text, p_id bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text;
  v_change_safe numeric; v_target numeric; v_denom jsonb; v_total numeric; v_need numeric; v_over_short numeric;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;

  v_change_safe := nullif(p_payload->>'change_in_safe','')::numeric;
  v_target      := coalesce(nullif(p_payload->>'required_target','')::numeric, public._dsr_cfg_num('dsr_change_target', 0));
  v_denom       := coalesce(p_payload->'denom', '{}'::jsonb);

  select coalesce(sum(value::text::numeric), 0) into v_total
    from jsonb_each(v_denom) where value::text ~ '^-?[0-9.]+$';

  v_need       := case when v_target is not null and v_change_safe is not null
                        then greatest(v_target - v_change_safe, 0) else null end;
  v_over_short := case when v_target is not null then v_total - v_target else null end;

  insert into public.dsr_change_recon(report_id, change_in_safe, required_target, need_additional, denom, total, over_short)
  values (p_id, v_change_safe, v_target, v_need, v_denom, v_total, v_over_short)
  on conflict (report_id) do update set
    change_in_safe = excluded.change_in_safe, required_target = excluded.required_target,
    need_additional = excluded.need_additional, denom = excluded.denom,
    total = excluded.total, over_short = excluded.over_short, updated_at = now();

  perform public._dsr_audit(p_id, v_uid, v_name, 'change_recon_save', null, null, null, null);
  return (select to_jsonb(x.*) from public.dsr_change_recon x where x.report_id = p_id);
end $fn$;

-- dsr_promo_save: night promo/waste block.
create or replace function public.dsr_promo_save(
  p_username text, p_password text, p_id bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_total numeric;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;

  v_total := coalesce(nullif(p_payload->>'promo_total_amt','')::numeric, 0)
           + coalesce(nullif(p_payload->>'open_discount','')::numeric, 0)
           + coalesce(nullif(p_payload->>'food_waste','')::numeric, 0)
           + coalesce(nullif(p_payload->>'employee_discount','')::numeric, 0);

  insert into public.dsr_promo(report_id, free_items, promo_total_amt, promo_total_num,
      open_discount, food_waste, employee_discount, total_promos, notes)
  values (p_id, nullif(p_payload->>'free_items','')::int, nullif(p_payload->>'promo_total_amt','')::numeric,
      nullif(p_payload->>'promo_total_num','')::int, nullif(p_payload->>'open_discount','')::numeric,
      nullif(p_payload->>'food_waste','')::numeric, nullif(p_payload->>'employee_discount','')::numeric,
      v_total, p_payload->>'notes')
  on conflict (report_id) do update set
    free_items = excluded.free_items, promo_total_amt = excluded.promo_total_amt,
    promo_total_num = excluded.promo_total_num, open_discount = excluded.open_discount,
    food_waste = excluded.food_waste, employee_discount = excluded.employee_discount,
    total_promos = excluded.total_promos, notes = excluded.notes, updated_at = now();

  perform public._dsr_audit(p_id, v_uid, v_name, 'promo_save', null, null, null, null);
  return (select to_jsonb(x.*) from public.dsr_promo x where x.report_id = p_id);
end $fn$;

-- dsr_office_review_save: office/admin marks Combined Totals "Office Use Only".
create or replace function public.dsr_office_review_save(
  p_username text, p_password text, p_id bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (public._dsr_is_mgr(v_role) or coalesce(v_role,'') ilike '%office%') then
    raise exception 'forbidden';
  end if;

  insert into public.dsr_office_review(report_id, credit_cards, checks, cash, cash_check_deposit,
      deposited_by, deposit_verified_by, review_notes, review_status, reviewed_by, reviewed_at)
  values (p_id, nullif(p_payload->>'credit_cards','')::numeric, nullif(p_payload->>'checks','')::numeric,
      nullif(p_payload->>'cash','')::numeric, nullif(p_payload->>'cash_check_deposit','')::numeric,
      p_payload->>'deposited_by', p_payload->>'deposit_verified_by', p_payload->>'review_notes',
      coalesce(p_payload->>'review_status','pending'), v_name, now())
  on conflict (report_id) do update set
    credit_cards = excluded.credit_cards, checks = excluded.checks, cash = excluded.cash,
    cash_check_deposit = excluded.cash_check_deposit, deposited_by = excluded.deposited_by,
    deposit_verified_by = excluded.deposit_verified_by, review_notes = excluded.review_notes,
    review_status = excluded.review_status, reviewed_by = v_name, reviewed_at = now(),
    updated_at = now();

  if (p_payload->>'review_status') = 'reviewed' then
    update public.dsr_report set status = 'reviewed', reviewed_by = v_name, reviewed_at = now(), updated_at = now()
    where id = p_id and status <> 'locked';
  end if;

  perform public._dsr_audit(p_id, v_uid, v_name, 'office_review_save', null, null, null, null);
  return (select to_jsonb(x.*) from public.dsr_office_review x where x.report_id = p_id);
end $fn$;

-- dsr_rating_save: 1-10 rating; enforces a comment when score <= threshold
-- (app_settings group 'dsr_config' key 'dsr_rating_comment_max', default 8).
create or replace function public.dsr_rating_save(
  p_username text, p_password text, p_id bigint, p_category text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_max numeric;
  v_am_score int; v_pm_score int; v_am_comment text; v_pm_comment text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;
  if p_category not in ('speed','cleanliness','friendliness','quality') then raise exception 'bad_category'; end if;

  v_am_score   := nullif(p_payload->>'am_score','')::int;
  v_pm_score   := nullif(p_payload->>'pm_score','')::int;
  v_am_comment := p_payload->>'am_comment';
  v_pm_comment := p_payload->>'pm_comment';
  v_max        := public._dsr_cfg_num('dsr_rating_comment_max', 8);

  if v_am_score is not null and v_am_score <= v_max and coalesce(btrim(v_am_comment),'') = '' then
    raise exception 'comment_required_am';
  end if;
  if v_pm_score is not null and v_pm_score <= v_max and coalesce(btrim(v_pm_comment),'') = '' then
    raise exception 'comment_required_pm';
  end if;

  insert into public.dsr_rating(report_id, category, am_score, am_comment, am_initials, am_user_id,
      pm_score, pm_comment, pm_initials, pm_user_id)
  values (p_id, p_category, v_am_score, v_am_comment, p_payload->>'am_initials', v_uid,
      v_pm_score, v_pm_comment, p_payload->>'pm_initials', v_uid)
  on conflict (report_id, category) do update set
    am_score = excluded.am_score, am_comment = excluded.am_comment, am_initials = excluded.am_initials,
    pm_score = excluded.pm_score, pm_comment = excluded.pm_comment, pm_initials = excluded.pm_initials,
    updated_at = now();

  perform public._dsr_audit(p_id, v_uid, v_name, 'rating_save:'||p_category, null, null, null, null);
  return (select to_jsonb(x.*) from public.dsr_rating x where x.report_id = p_id and x.category = p_category);
end $fn$;

-- dsr_labor_save: server-computed AM/PM/daily labor cost + labor %.
-- Returns nulls ("Incomplete" per frontend convention) when wage/hours are
-- missing — never divides by zero.
create or replace function public.dsr_labor_save(
  p_username text, p_password text, p_id bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text;
  v_proj_am numeric; v_proj_pm numeric; v_wage numeric; v_am_h numeric; v_pm_h numeric;
  v_am_cost numeric; v_pm_cost numeric; v_daily_cost numeric; v_proj_daily numeric;
  v_am_pct numeric; v_pm_pct numeric; v_daily_pct numeric; v_complete boolean;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;

  v_proj_am := nullif(p_payload->>'proj_am_sales','')::numeric;
  v_proj_pm := nullif(p_payload->>'proj_pm_sales','')::numeric;
  v_wage    := nullif(p_payload->>'avg_wage','')::numeric;
  v_am_h    := nullif(p_payload->>'am_hours','')::numeric;
  v_pm_h    := nullif(p_payload->>'pm_hours','')::numeric;

  v_complete := (v_wage is not null and v_am_h is not null and v_pm_h is not null);

  if v_complete then
    v_am_cost    := v_wage * v_am_h;
    v_pm_cost    := v_wage * v_pm_h;
    v_daily_cost := v_am_cost + v_pm_cost;
  end if;

  v_proj_daily := case when v_proj_am is not null or v_proj_pm is not null
                        then coalesce(v_proj_am,0) + coalesce(v_proj_pm,0) else null end;

  v_am_pct    := case when v_am_cost is not null and v_proj_am is not null and v_proj_am <> 0
                       then round(v_am_cost / v_proj_am * 100, 2) else null end;
  v_pm_pct    := case when v_pm_cost is not null and v_proj_pm is not null and v_proj_pm <> 0
                       then round(v_pm_cost / v_proj_pm * 100, 2) else null end;
  v_daily_pct := case when v_daily_cost is not null and v_proj_daily is not null and v_proj_daily <> 0
                       then round(v_daily_cost / v_proj_daily * 100, 2) else null end;

  insert into public.dsr_labor(report_id, proj_am_sales, proj_pm_sales, avg_wage, am_hours, pm_hours,
      am_mgr, pm_mgr, am_labor_cost, pm_labor_cost, daily_labor_cost, proj_daily_sales,
      am_labor_pct, pm_labor_pct, daily_labor_pct)
  values (p_id, v_proj_am, v_proj_pm, v_wage, v_am_h, v_pm_h, p_payload->>'am_mgr', p_payload->>'pm_mgr',
      v_am_cost, v_pm_cost, v_daily_cost, v_proj_daily, v_am_pct, v_pm_pct, v_daily_pct)
  on conflict (report_id) do update set
    proj_am_sales = excluded.proj_am_sales, proj_pm_sales = excluded.proj_pm_sales, avg_wage = excluded.avg_wage,
    am_hours = excluded.am_hours, pm_hours = excluded.pm_hours, am_mgr = excluded.am_mgr, pm_mgr = excluded.pm_mgr,
    am_labor_cost = excluded.am_labor_cost, pm_labor_cost = excluded.pm_labor_cost,
    daily_labor_cost = excluded.daily_labor_cost, proj_daily_sales = excluded.proj_daily_sales,
    am_labor_pct = excluded.am_labor_pct, pm_labor_pct = excluded.pm_labor_pct, daily_labor_pct = excluded.daily_labor_pct,
    updated_at = now();

  perform public._dsr_audit(p_id, v_uid, v_name, 'labor_save', null, null, null, null);

  return jsonb_build_object(
    'labor', (select to_jsonb(x.*) from public.dsr_labor x where x.report_id = p_id),
    'complete', v_complete,
    'target_low', public._dsr_cfg_num('dsr_labor_target_low', 22),
    'target_high', public._dsr_cfg_num('dsr_labor_target_high', 26)
  );
end $fn$;

-- dsr_checklist_entry_save: upsert one AM/PM checklist line.
create or replace function public.dsr_checklist_entry_save(
  p_username text, p_password text, p_id bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_key text; v_am_done boolean; v_pm_done boolean;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;

  v_key := p_payload->>'item_key';
  if coalesce(btrim(v_key),'') = '' then raise exception 'item_key_required'; end if;
  v_am_done := coalesce((p_payload->>'am_done')::boolean, false);
  v_pm_done := coalesce((p_payload->>'pm_done')::boolean, false);

  insert into public.dsr_checklist_entry(report_id, item_key, item_label,
      am_done, am_initials, am_user_id, am_at, pm_done, pm_initials, pm_user_id, pm_at, comment)
  values (p_id, v_key, p_payload->>'item_label',
      v_am_done, p_payload->>'am_initials', case when v_am_done then v_uid else null end, case when v_am_done then now() else null end,
      v_pm_done, p_payload->>'pm_initials', case when v_pm_done then v_uid else null end, case when v_pm_done then now() else null end,
      p_payload->>'comment')
  on conflict (report_id, item_key) do update set
    item_label = coalesce(excluded.item_label, dsr_checklist_entry.item_label),
    am_done    = excluded.am_done, am_initials = excluded.am_initials,
    am_user_id = case when excluded.am_done then v_uid else dsr_checklist_entry.am_user_id end,
    am_at      = case when excluded.am_done then now() else dsr_checklist_entry.am_at end,
    pm_done    = excluded.pm_done, pm_initials = excluded.pm_initials,
    pm_user_id = case when excluded.pm_done then v_uid else dsr_checklist_entry.pm_user_id end,
    pm_at      = case when excluded.pm_done then now() else dsr_checklist_entry.pm_at end,
    comment    = coalesce(excluded.comment, dsr_checklist_entry.comment),
    updated_at = now();

  perform public._dsr_audit(p_id, v_uid, v_name, 'checklist_entry_save:'||v_key, null, null, null, null);
  return (select to_jsonb(x.*) from public.dsr_checklist_entry x where x.report_id = p_id and x.item_key = v_key);
end $fn$;

-- dsr_log_note_add: wraps the EXISTING app_logbook_add (canonical 8-arg
-- overload — confirmed in phase4_5_autosched_logbook.sql), tagging the body
-- with the report id/section since manager_logbook has no report_id column.
create or replace function public.dsr_log_note_add(
  p_username text, p_password text, p_id bigint, p_section text, p_body text, p_shift text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_loc text; v_date date; v_tagged text; v_res jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select location, business_date into v_loc, v_date from public.dsr_report where id = p_id;
  if v_loc is null then raise exception 'not_found'; end if;

  v_tagged := '[DSR#'||p_id||coalesce('|'||p_section,'')||'] '||coalesce(p_body,'');

  select public.app_logbook_add(p_username, p_password, v_loc, v_date, coalesce(p_section,'dsr'), v_tagged, p_shift, null)
    into v_res;

  perform public._dsr_audit(p_id, v_uid, v_name, 'log_note_add:'||coalesce(p_section,''), null, null, p_body, null);
  return v_res;
end $fn$;

-- dsr_attachment_add: photo/document attachment (material-upload URL).
create or replace function public.dsr_attachment_add(
  p_username text, p_password text, p_id bigint, p_section text, p_url text, p_caption text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_aid bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_url),'') = '' then raise exception 'url_required'; end if;

  insert into public.dsr_attachment(report_id, section, url, caption, uploaded_by, uploaded_by_id)
  values (p_id, p_section, p_url, p_caption, v_name, v_uid)
  returning id into v_aid;

  perform public._dsr_audit(p_id, v_uid, v_name, 'attachment_add:'||coalesce(p_section,''), null, null, p_url, null);
  return (select to_jsonb(x.*) from public.dsr_attachment x where x.id = v_aid);
end $fn$;

-- dsr_action_create: smart-action trigger. Calls the existing
-- app_task_create / app_wo_create / app_supply_create RPCs DEFENSIVELY via
-- dynamic EXECUTE (their real signatures are not in this repo — see file
-- header). A signature mismatch is caught and recorded as a
-- 'pending_manual' dsr_action instead of failing the caller.
create or replace function public.dsr_action_create(
  p_username text, p_password text, p_id bigint, p_kind text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_loc text;
  v_action_id bigint; v_target_table text; v_target_id text; v_status text := 'open';
  v_title text; v_notes text; v_res jsonb; v_err text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;
  if p_kind not in ('task','maintenance','supply','cash_review','leadership_review') then
    raise exception 'bad_kind';
  end if;

  select location into v_loc from public.dsr_report where id = p_id;
  if v_loc is null then raise exception 'not_found'; end if;

  v_title := coalesce(p_payload->>'title', 'DSR follow-up ('||p_kind||')');
  v_notes := p_payload->>'notes';

  begin
    if p_kind = 'task' then
      v_target_table := 'app_task';
      execute 'select public.app_task_create(p_username=>$1,p_password=>$2,p_title=>$3,'
              ||'p_details=>$4,p_due=>$5,p_target_type=>$6,p_target_value=>$7,'
              ||'p_employee_ids=>$8,p_completion_mode=>$9)'
        into v_res
        using p_username, p_password, v_title, coalesce(v_notes,''),
              nullif(p_payload->>'due','')::date, 'store', v_loc, null::bigint[], 'store';
      v_target_id := coalesce(v_res->>'id', v_res#>>'{}');

    elsif p_kind = 'maintenance' then
      v_target_table := 'app_wo';
      execute 'select public.app_wo_create(p_username=>$1,p_password=>$2,p_title=>$3,'
              ||'p_description=>$4,p_asset_id=>$5,p_asset_label=>$6,p_location=>$7,'
              ||'p_category=>$8,p_priority=>$9,p_equipment_use_status=>$10,p_safety_impact=>$11)'
        into v_res
        using p_username, p_password, v_title, coalesce(v_notes,''),
              nullif(p_payload->>'asset_id','')::int, p_payload->>'asset_label', v_loc,
              coalesce(p_payload->>'category','General'), coalesce(p_payload->>'priority','Normal'),
              p_payload->>'equipment_use_status', coalesce((p_payload->>'safety_impact')::boolean, false);
      v_target_id := coalesce(v_res->>'wo_number', v_res#>>'{}');

    elsif p_kind = 'supply' then
      v_target_table := 'app_supply';
      execute 'select public.app_supply_create(p_username=>$1,p_password=>$2,p_store=>$3,'
              ||'p_needed_by=>$4,p_needed_by_time=>$5,p_urgency=>$6,p_runout=>$7,p_reason=>$8,'
              ||'p_notes=>$9,p_photo_url=>$10,p_items=>$11)'
        into v_res
        using p_username, p_password, v_loc,
              p_payload->>'needed_by', p_payload->>'needed_by_time',
              coalesce(p_payload->>'urgency','Normal'), p_payload->>'runout', coalesce(v_notes,''),
              v_notes, null::text, coalesce(p_payload->'items', '[]'::jsonb);
      v_target_id := coalesce(v_res->>'request_no', v_res#>>'{}');

    else
      -- cash_review / leadership_review: no existing target RPC, internal flag only.
      v_target_table := null; v_target_id := null; v_res := null;
    end if;
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_status := 'pending_manual';
    v_notes  := coalesce(v_notes,'') || ' [auto-create failed: '||coalesce(v_err,'unknown error')||']';
  end;

  insert into public.dsr_action(report_id, kind, section, title, notes, target_table, target_id,
      status, created_by, created_by_id)
  values (p_id, p_kind, p_payload->>'section', v_title, v_notes, v_target_table, v_target_id,
      v_status, v_name, v_uid)
  returning id into v_action_id;

  perform public._dsr_audit(p_id, v_uid, v_name, 'action_create:'||p_kind, null, null, v_target_id, null);
  return (select to_jsonb(x.*) from public.dsr_action x where x.id = v_action_id);
end $fn$;

-- dsr_validate: one-per-store-per-date, required sections present, over/short
-- beyond threshold needs a reason (ops_notes). Returns {ok, blockers[]}.
create or replace function public.dsr_validate(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_report record;
  v_blockers text[] := '{}'; v_threshold numeric;
  v_five record; v_night record; v_dupe_id bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;

  select * into v_report from public.dsr_report where id = p_id;
  if v_report is null then raise exception 'not_found'; end if;

  select id into v_dupe_id from public.dsr_report
   where location = v_report.location and business_date = v_report.business_date
     and id <> p_id and not is_exception limit 1;
  if v_dupe_id is not null and not v_report.is_exception then
    v_blockers := array_append(v_blockers, 'duplicate_report_for_store_date');
  end if;

  select * into v_five  from public.dsr_closeout where report_id = p_id and closeout_type = 'five';
  select * into v_night from public.dsr_closeout where report_id = p_id and closeout_type = 'night';
  if v_five is null then v_blockers := array_append(v_blockers, 'missing_five_closeout'); end if;
  if v_night is null then v_blockers := array_append(v_blockers, 'missing_night_closeout'); end if;

  if not exists(select 1 from public.dsr_labor where report_id = p_id) then
    v_blockers := array_append(v_blockers, 'missing_labor_projection');
  end if;

  v_threshold := public._dsr_cfg_num('dsr_overshort_threshold', 5);
  if v_five is not null and v_five.over_short is not null and abs(v_five.over_short) > v_threshold
     and coalesce(btrim(v_report.ops_notes),'') = '' then
    v_blockers := array_append(v_blockers, 'five_over_short_needs_reason');
  end if;
  if v_night is not null and v_night.over_short is not null and abs(v_night.over_short) > v_threshold
     and coalesce(btrim(v_report.ops_notes),'') = '' then
    v_blockers := array_append(v_blockers, 'night_over_short_needs_reason');
  end if;

  return jsonb_build_object('ok', (array_length(v_blockers,1) is null), 'blockers', to_jsonb(v_blockers));
end $fn$;

-- dsr_submit: runs dsr_validate; sets status; writes dsr_audit.
-- Does NOT settle into daily_sales/store_metrics yet — see TODO below.
create or replace function public.dsr_submit(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_val jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;

  v_val := public.dsr_validate(p_username, p_password, p_id);
  if not (v_val->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'blockers', v_val->'blockers');
  end if;

  update public.dsr_report set status = 'submitted', submitted_by = v_name, submitted_at = now(), updated_at = now()
  where id = p_id;

  perform public._dsr_audit(p_id, v_uid, v_name, 'submit', null, null, null, null);

  -- TODO(sales-source): settle day totals into daily_sales/store_metrics once
  -- Aaron/Issac choose the source model (PLAN_daily_report_build.md §7.1 —
  -- DSR-becomes-the-daily_sales-writer vs. stays-separate-and-reconciles).
  -- When unblocked: fold dsr_report/dsr_closeout/dsr_office_review totals for
  -- p_id into daily_sales / daily_sales_detail (via app_sales_save) and
  -- store_metrics (via app_metrics_save — remember jsonb_build_object, NOT
  -- json_build_object, or the whole batch rolls back, per hub-axial-sync
  -- notes) so Scorecards, Prime Cost autofill, and Scheduling
  -- forecast/variance stay correct. DO NOT enable until that decision is
  -- made — writing here now would risk double-counting sales.

  return jsonb_build_object('ok', true, 'report', (select to_jsonb(r.*) from public.dsr_report r where r.id = p_id));
end $fn$;

-- dsr_reopen: admin only, audited.
create or replace function public.dsr_reopen(p_username text, p_password text, p_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_before text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (coalesce(v_role,'') ilike '%admin%' or coalesce(v_role,'') ilike '%owner%' or coalesce(v_role,'') ilike '%VP%') then
    raise exception 'forbidden';
  end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;

  select status into v_before from public.dsr_report where id = p_id;
  if v_before is null then raise exception 'not_found'; end if;

  update public.dsr_report set status = 'reopened', locked_at = null, updated_at = now() where id = p_id;

  perform public._dsr_audit(p_id, v_uid, v_name, 'reopen', 'status', v_before, 'reopened', p_reason);
  return (select to_jsonb(r.*) from public.dsr_report r where r.id = p_id);
end $fn$;

-- dsr_audit_list: full audit trail for a report.
create or replace function public.dsr_audit_list(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_out jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select coalesce(jsonb_agg(to_jsonb(a.*) order by a.at desc), '[]'::jsonb) into v_out
  from public.dsr_audit a where a.report_id = p_id;

  return v_out;
end $fn$;


-- ============================================================================
-- NEW RPCS: dsr_actor, dsr_open, dsr_get, dsr_list, dsr_header_save,
-- dsr_closeout_save, dsr_register_save, dsr_payment_adj_save,
-- dsr_change_recon_save, dsr_promo_save, dsr_office_review_save,
-- dsr_rating_save, dsr_labor_save, dsr_checklist_entry_save,
-- dsr_log_note_add, dsr_attachment_add, dsr_action_create, dsr_validate,
-- dsr_submit, dsr_reopen, dsr_audit_list
-- ============================================================================

-- VERIFY:
-- select table_name from information_schema.tables
--  where table_schema='public' and table_name like 'dsr_%'
-- union all
-- select routine_name from information_schema.routines
--  where routine_schema='public' and (routine_name like 'dsr_%' or routine_name like '_dsr_%')
-- order by 1;

-- ============================================================================
-- APPENDED (integrator): dsr_create_correction (frontend calls it)
-- ============================================================================
create or replace function public.dsr_create_correction(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_loc text; v_bd date; v_new bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select location, business_date into v_loc, v_bd from public.dsr_report where id = p_id;
  if v_loc is null then raise exception 'not_found'; end if;
  insert into public.dsr_report(location, business_date, status, created_by, created_by_id,
        correction_of_id, is_exception, exception_reason, exception_by)
  values (v_loc, v_bd, 'draft', v_name, v_uid, p_id, true, 'correction of report #'||p_id, v_name)
  returning id into v_new;
  perform public._dsr_audit(v_new, v_uid, v_name, 'create_correction', 'correction_of_id', p_id::text, v_new::text, null);
  return (select to_jsonb(r.*) from public.dsr_report r where r.id = v_new);
end $fn$;
-- NEW RPCS (appended): dsr_create_correction
