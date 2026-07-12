-- ============================================================================
-- Caliche's Hub — STORE & SITE INSPECTION (leadership brand-standards system)
-- Additive, idempotent. Run in Supabase SQL editor / dashboard Monaco
-- (proj ikgbihwkqhsfahnswfbz). Mirrors the _dsr_*/_pp_* SECURITY DEFINER
-- pattern (daily_store_report.sql / employee_passport.sql).
--
-- Scored inspection form (1-5 + N/A per line, sections from an ADMIN-EDITABLE
-- template in app_settings) -> severity + required photo evidence enforced
-- SERVER-side at submit -> auto-routed corrective tasks (app_task_create,
-- store-targeted) -> leadership dashboard. Inspection records are historical:
-- closing/deleting a routed task never mutates the inspection.
--
-- FRONTEND CONTRACT (js/20_site_inspection.js reads EXACTLY these shapes):
--   insp_get / insp_start / insp_section_save / insp_submit return ONE jsonb:
--     top-level = insp_inspection columns (template column stripped)
--     + 'sections':[{key,label,section_comment,pct,items:[{key,label,line_id,
--         score,na,severity,note,no_photo_reason,photos[]}]}]
--     + 'actions':[insp_action rows] + 'answered' + 'total_items'
--   insp_list returns a jsonb ARRAY of header cards.
--   insp_dashboard returns {locations[],criticals[],repeat_issues[],
--     section_avgs[],summary{},from,to}.
--   insp_validate/insp_submit blockers: [{code,item_key,label}].
--
-- ⚠ insp_action_create calls the EXISTING app_task_create / app_wo_create /
-- app_supply_create RPCs via dynamic EXECUTE + USING inside an exception
-- handler (same defensive pattern as dsr_action_create) — a live-DB signature
-- mismatch degrades to a 'pending_manual' insp_action row instead of failing
-- the migration or the caller. ASSUMED signatures (VERIFY in prod with
-- pg_get_functiondef before trusting the auto-create path):
--   app_task_create(p_username,p_password,p_title,p_details,p_due date,
--     p_target_type,p_target_value,p_employee_ids bigint[],p_completion_mode)
--   app_wo_create(p_username,p_password,p_title,p_description,p_asset_id int,
--     p_asset_label,p_location,p_category,p_priority,p_equipment_use_status,
--     p_safety_impact boolean)
--   app_supply_create(p_username,p_password,p_store,p_needed_by,
--     p_needed_by_time,p_urgency,p_runout,p_reason,p_notes,p_photo_url,
--     p_items jsonb)
--   push_enqueue(user_id bigint, title text, body text, url text)
--
-- CONFIG = app_settings group 'insp_config' (skey/sgroup/svalue). Scalar keys
-- are seeded below (on conflict do nothing) so they surface in Business
-- Settings; the checklist template default lives in _insp_default_template()
-- and is OVERRIDDEN by setting skey='insp_template' (svalue = JSON text with
-- {"sections":[{"key","label","items":[{"key","label"}]}]}). Each inspection
-- SNAPSHOTS the template at start, so editing the template never corrupts
-- historical records.
-- ============================================================================


-- ============================================================================
-- 1) TABLES (create table if not exists; RLS on; no policies — RPC-only)
-- ============================================================================

create table if not exists public.insp_inspection (
  id                   bigserial primary key,
  location             text not null,
  site_type            text not null default 'Store',
  insp_type            text not null default 'Quarterly Full',
  inspector_name       text,
  inspector_id         bigint,          -- users.id of the inspector
  manager_on_duty      text,
  announced            text not null default 'scheduled',  -- scheduled | unannounced
  weather              text,
  status               text not null default 'draft',      -- draft | submitted
  template             jsonb not null default '{}'::jsonb, -- snapshot at start
  overall_pct          numeric,         -- server-computed
  critical_count       int not null default 0,             -- server-computed
  followup_recommended boolean not null default false,
  followup_date        date,
  top_strengths        text,
  top_issues           text,
  urgent_notes         text,
  maint_notes          text,
  supply_notes         text,
  mgr_followup         boolean,
  mgr_followup_note    text,
  pride_score          int,
  pride_comment        text,
  final_notes          text,
  started_at           timestamptz not null default now(),
  submitted_at         timestamptz,
  submitted_by         text,
  created_by           text,
  created_by_id        bigint,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists insp_inspection_loc_idx on public.insp_inspection(location, submitted_at desc);
create index if not exists insp_inspection_status_idx on public.insp_inspection(status);
alter table public.insp_inspection enable row level security;

-- one row per template section actually touched (comment + cached pct)
create table if not exists public.insp_section (
  id              bigserial primary key,
  inspection_id   bigint not null references public.insp_inspection(id),
  section_key     text not null,
  section_label   text,
  section_comment text,
  section_pct     numeric,   -- server-computed
  updated_at      timestamptz not null default now(),
  unique (inspection_id, section_key)
);
create index if not exists insp_section_insp_idx on public.insp_section(inspection_id);
alter table public.insp_section enable row level security;

-- one row per scored/answered checklist line (bulk-upserted per section save)
create table if not exists public.insp_line (
  id              bigserial primary key,
  inspection_id   bigint not null references public.insp_inspection(id),
  section_key     text not null,
  item_key        text not null,
  item_label      text,
  score           int check (score between 1 and 5),
  na              boolean not null default false,
  severity        text,      -- server-derived: critical | poor | attention | ok
  note            text,
  no_photo_reason text,      -- why a photo was not possible (evidence rule)
  photos          jsonb not null default '[]'::jsonb,  -- [{url,caption,by,at}]
  updated_at      timestamptz not null default now(),
  unique (inspection_id, item_key)
);
create index if not exists insp_line_insp_idx on public.insp_line(inspection_id);
create index if not exists insp_line_item_idx on public.insp_line(item_key);
alter table public.insp_line enable row level security;

-- corrective actions: the routed link between a finding and the module that
-- fixes it. Closing/deleting the routed task never mutates the inspection.
create table if not exists public.insp_action (
  id                bigserial primary key,
  inspection_id     bigint not null references public.insp_inspection(id),
  line_id           bigint references public.insp_line(id),
  section_key       text,
  item_key          text,
  kind              text not null,     -- task|maintenance|supply|coaching|safety|vendor|it|signage|other
  title             text,
  notes             text,
  severity          text,
  owner_name        text,
  due_date          date,
  status            text not null default 'open',  -- open|in_progress|done|pending_manual|cancelled
  target_table      text,              -- app_task | app_wo | app_supply | null
  target_id         text,              -- id / wo_number / request_no in the target module
  source            text not null default 'Store Site Inspection',
  auto_created      boolean not null default false,
  completion_note   text,
  completion_photos jsonb not null default '[]'::jsonb,
  created_by        text,
  created_by_id     bigint,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  closed_at         timestamptz,
  closed_by         text
);
create index if not exists insp_action_insp_idx on public.insp_action(inspection_id);
create index if not exists insp_action_status_idx on public.insp_action(status);
alter table public.insp_action enable row level security;

create table if not exists public.insp_audit (
  id            bigserial primary key,
  inspection_id bigint,
  actor_id      bigint,
  actor_name    text,
  action        text,
  detail        text,
  created_at    timestamptz not null default now()
);
create index if not exists insp_audit_insp_idx on public.insp_audit(inspection_id);
alter table public.insp_audit enable row level security;


-- ============================================================================
-- 2) CONFIG SEEDS (group 'insp_config' — every tunable admin-adjustable)
-- ============================================================================
insert into public.app_settings(skey,sgroup,label,svalue,sort) values
  ('insp_evidence_min_score','insp_config','Score at/below this requires note + photo (or reason)','2',10),
  ('insp_critical_score','insp_config','Score at/below this = CRITICAL severity','1',20),
  ('insp_auto_task_max_score','insp_config','Auto-create corrective task for lines scored at/below','2',30),
  ('insp_followup_threshold_pct','insp_config','Overall % below this recommends a follow-up inspection','80',40),
  ('insp_cadence_days','insp_config','Full inspection cadence per location (days)','90',50),
  ('insp_followup_days','insp_config','Recommended follow-up inspection window (days)','14',60),
  ('insp_task_due_days','insp_config','Default corrective task due (days out)','7',70),
  ('insp_critical_due_days','insp_config','Critical corrective task due (days out)','2',80),
  ('insp_types','insp_config','Inspection types (comma-separated)','Quarterly Full,Follow-Up,Annual Deep Property,Spot Check,Special Site',90),
  ('insp_site_types','insp_config','Site types (comma-separated)','Store,Warehouse,Trailer,Other Site',100)
on conflict (skey) do nothing;
-- 'insp_template' (JSON) is intentionally NOT seeded: default lives in
-- _insp_default_template(); admins override via app_settings_set('insp_template',...).


-- ============================================================================
-- 3) HELPERS (mirror _dsr_* style)
-- ============================================================================

create or replace function public._insp_auth(p_username text, p_password text)
returns table(uid bigint, urole text, uname text)
language sql security definer set search_path=public,extensions as $fn$
  select u.id, u.role, u.name
  from public.users u
  where u.username = p_username
    and u.password = extensions.crypt(p_password, u.password)
  limit 1;
$fn$;

create or replace function public._insp_is_mgr(p_role text)
returns boolean language sql immutable as $fn$
  select coalesce(p_role,'') ilike '%manager%' or coalesce(p_role,'') ilike '%admin%'
      or coalesce(p_role,'') ilike '%lead%'    or coalesce(p_role,'') ilike '%owner%'
      or coalesce(p_role,'') ilike '%VP%'      or coalesce(p_role,'') ilike '%president%';
$fn$;

create or replace function public._insp_cfg_num(p_key text, p_default numeric)
returns numeric language sql stable as $fn$
  select coalesce(
    (select svalue::numeric from public.app_settings
      where skey = p_key and sgroup = 'insp_config' and svalue ~ '^-?[0-9.]+$'),
    p_default);
$fn$;

create or replace function public._insp_cfg_text(p_key text, p_default text)
returns text language sql stable as $fn$
  select coalesce(
    (select svalue from public.app_settings where skey = p_key and sgroup = 'insp_config'),
    p_default);
$fn$;

create or replace function public._insp_audit(
  p_inspection_id bigint, p_actor_id bigint, p_actor text, p_action text, p_detail text)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
begin
  insert into public.insp_audit(inspection_id, actor_id, actor_name, action, detail)
  values (p_inspection_id, p_actor_id, p_actor, p_action, p_detail);
end $fn$;

-- best-effort push to every manager/leadership user; never blocks a write.
create or replace function public._insp_notify_mgrs(p_title text, p_body text)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
declare r record;
begin
  begin
    for r in select id from public.users where public._insp_is_mgr(role) loop
      perform public.push_enqueue(r.id, p_title, p_body, '');
    end loop;
  exception when others then
    null;
  end;
end $fn$;

-- score -> severity (thresholds admin-adjustable)
create or replace function public._insp_severity(p_score int, p_critical int, p_evidence int)
returns text language sql immutable as $fn$
  select case when p_score is null then null
              when p_score <= p_critical then 'critical'
              when p_score <= p_evidence then 'poor'
              when p_score = 3 then 'attention'
              else 'ok' end;
$fn$;

-- built-in v1 checklist (Appendix A of the request doc). Overridden by
-- app_settings skey='insp_template' (group insp_config, svalue = JSON text).
create or replace function public._insp_default_template()
returns jsonb language sql immutable as $fn$
select $tpl$
{"sections":[
 {"key":"first_impression","label":"Customer First Impression","items":[
  {"key":"fi_01","label":"Walk-up counter area is clean and free of graffiti, markings, stickers, and damage."},
  {"key":"fi_02","label":"Drive-thru area is clean and free of graffiti, markings, stickers, and damage."},
  {"key":"fi_03","label":"Patio, benches, tables, and customer gathering areas are clean and presentable."},
  {"key":"fi_04","label":"Parking canopy and poles are clean, presentable, and free of graffiti/stickers/damage."},
  {"key":"fi_05","label":"Menu boards are clean, updated, maintained, and all lighting works."},
  {"key":"fi_06","label":"Customer-facing windows, including hard-to-reach windows, are clean."},
  {"key":"fi_07","label":"Window seals and tracks are clean."},
  {"key":"fi_08","label":"Exterior and customer-facing trash cans are presentable and not worn out."},
  {"key":"fi_09","label":"No foul odors are present in customer areas or near customer traffic paths."},
  {"key":"fi_10","label":"Store signage is current, relevant, clean, and not worn out."}]},
 {"key":"exterior","label":"Exterior Property and Grounds","items":[
  {"key":"ex_01","label":"Parking lot is maintained with regular blowing and power washing."},
  {"key":"ex_02","label":"Drive-thru lane shows no visible spilled drinks, custard, gum, or custard trails."},
  {"key":"ex_03","label":"No spilled custard trails or spots are visible between the building and dumpster area."},
  {"key":"ex_04","label":"Neon lights around the building and road signs are working where applicable."},
  {"key":"ex_05","label":"Exterior building lights and parking lot lights are working, clean, and free of bugs."},
  {"key":"ex_06","label":"Black and white exterior tiles are not cracked and not excessively covered with hard water buildup."},
  {"key":"ex_07","label":"Irrigation system works properly with no visible leaks."},
  {"key":"ex_08","label":"Trees, bushes, and landscape areas appear watered and maintained."},
  {"key":"ex_09","label":"Landscaping company work is acceptable: no overgrowth, trash, or neglected areas."},
  {"key":"ex_10","label":"No bird nests, spiderwebs, or buildup on building, canopy, or property structures."},
  {"key":"ex_11","label":"Dumpster, dumpster enclosure, and surrounding area are clean and show regular power washing."},
  {"key":"ex_12","label":"Dumpster area has no foul-smelling odors."},
  {"key":"ex_13","label":"Curbs, concrete, parking bumpers, and visible parking areas are not creating safety or appearance issues."},
  {"key":"ex_14","label":"Building exterior does not show obvious paint, roofline, drainage, or structural concerns requiring follow-up."}]},
 {"key":"restrooms_customer","label":"Restrooms and Customer Areas","items":[
  {"key":"rc_01","label":"Public restrooms are in good working order and cleaned regularly."},
  {"key":"rc_02","label":"Public restrooms have no graffiti, vandalism, foul odor, or visible neglect."},
  {"key":"rc_03","label":"In-store employee restrooms are in good working order and cleaned regularly."},
  {"key":"rc_04","label":"In-store employee restrooms have no graffiti, vandalism, foul odor, or visible neglect."},
  {"key":"rc_05","label":"Floors in customer and store areas are in good condition with no cracked tiles, lifting vinyl, dirty grout lines, marks, or heavy stains."},
  {"key":"rc_06","label":"Ceiling tiles, lights, registers, vents, and fans are clean and maintained."},
  {"key":"rc_07","label":"Interior walls throughout the establishment are clean with no lint buildup, graffiti, or visible neglected areas."},
  {"key":"rc_08","label":"All old, worn-out, unnecessary, or irrelevant signs have been removed or updated."}]},
 {"key":"boh_cleanliness","label":"Back-of-House Cleanliness and Food Areas","items":[
  {"key":"bo_01","label":"Dish areas are clean and organized with no dirty walls, dirty floors, random unused utensils, or unused dishes."},
  {"key":"bo_02","label":"Employee dishes are clean and kept up with."},
  {"key":"bo_03","label":"Soda fountain area is maintained with no sticky syrup buildup, floor drain odor, mold, or accumulation of lids behind/under the unit."},
  {"key":"bo_04","label":"Main dipping cabinet is maintained and cleaned with no excessive neglected custard/topping buildup."},
  {"key":"bo_05","label":"Area for pre-packed quarts and pints is regularly cleaned, organized, and FIFO is being used."},
  {"key":"bo_06","label":"Steam table wells do not have excessive hard water buildup or scale."},
  {"key":"bo_07","label":"Steam table dishes do not have excessive hard water buildup or scale."},
  {"key":"bo_08","label":"All floor drains are cleaned, maintained, covered, and free of odor."},
  {"key":"bo_09","label":"Tea and sugar water containers do not leak."},
  {"key":"bo_10","label":"No foul-smelling odors are present in any part of the establishment."}]},
 {"key":"equipment","label":"Equipment Condition","items":[
  {"key":"eq_01","label":"All faucets work properly and do not leak when shut off."},
  {"key":"eq_02","label":"Pre-rinse sprayer is not clogged and is in good working condition."},
  {"key":"eq_03","label":"Knives are sharp and in good working order."},
  {"key":"eq_04","label":"Can opener is sharp and in good working order."},
  {"key":"eq_05","label":"Caliche machine operates correctly with no strange sounds, vibrations, or severe damage."},
  {"key":"eq_06","label":"Caliche machine pedal works correctly."},
  {"key":"eq_07","label":"Caliche machine shield is accessible and being used."},
  {"key":"eq_08","label":"Custard machine(s) are in good working order with no damaged components."},
  {"key":"eq_09","label":"Custard machine panels, floor underneath, and inside areas are free of old custard buildup."},
  {"key":"eq_10","label":"Ice machine is maintained and ice bin is regularly cleaned/descaled."},
  {"key":"eq_11","label":"Water heater is maintained and appears to be in good working order."},
  {"key":"eq_12","label":"Dryer works properly and does not have excessive lint buildup in or around the unit."},
  {"key":"eq_13","label":"Washer works properly with no damage or excessive dirtiness."},
  {"key":"eq_14","label":"All speakers are working inside and outside the establishment."},
  {"key":"eq_15","label":"Register areas are clean, presentable, organized, and free of dust/pest evidence."},
  {"key":"eq_16","label":"Register standing areas do not have excessive foot marks or markings."}]},
 {"key":"storage","label":"Walk-In, Freezer, and Storage Areas","items":[
  {"key":"st_01","label":"Walk-in cooler is swept and mopped daily and has no forgotten product or food under hard-to-reach areas."},
  {"key":"st_02","label":"Walk-in freezer is swept and mopped daily and has no forgotten product or food under hard-to-reach areas."},
  {"key":"st_03","label":"Dry storage is clean, organized, and free of old/random/outdated product."},
  {"key":"st_04","label":"Dry storage has no signs of pests."},
  {"key":"st_05","label":"Outside storage areas are clean, organized, and free of unnecessary clutter or unused items."},
  {"key":"st_06","label":"Store dishes, food containers, and lids are clean and in good working order with no excessive wear or damage."},
  {"key":"st_07","label":"FIFO appears to be followed in storage areas and pre-packed product areas."}]},
 {"key":"tools_supplies","label":"Tools, Supplies, Uniform Items, and Laundry","items":[
  {"key":"ts_01","label":"Inside trash cans are in good working order and look presentable, not worn out."},
  {"key":"ts_02","label":"Outside trash cans and lids are in good working order and look presentable, not worn out."},
  {"key":"ts_03","label":"Sani and wash buckets are in good working order."},
  {"key":"ts_04","label":"Scrub brushes look presentable and not overly worn out."},
  {"key":"ts_05","label":"Towels look presentable and not overly worn out."},
  {"key":"ts_06","label":"Aprons look presentable and not overly worn out."},
  {"key":"ts_07","label":"Mop heads look presentable and not overly worn out."},
  {"key":"ts_08","label":"Brooms and dustpans look presentable and not overly worn out."},
  {"key":"ts_09","label":"Laundry room is clean and organized."},
  {"key":"ts_10","label":"Laundry room has no empty chemical bottles, unlabeled chemicals, or detergent trash present."},
  {"key":"ts_11","label":"Chemicals are labeled, properly stored, and not creating safety or cleanliness issues."}]},
 {"key":"safety","label":"Safety, Security, and Compliance","items":[
  {"key":"sa_01","label":"Emergency exits are clear and accessible."},
  {"key":"sa_02","label":"Electrical panels are accessible and not blocked."},
  {"key":"sa_03","label":"No unsafe extension cords or trip hazards are visible."},
  {"key":"sa_04","label":"Fire extinguishers are accessible and appear current."},
  {"key":"sa_05","label":"First aid kit is stocked or flagged if missing items."},
  {"key":"sa_06","label":"Back doors, customer doors, locks, handles, hinges, and closers are in good condition."},
  {"key":"sa_07","label":"Security cameras are working, clean, and aimed appropriately where visible."},
  {"key":"sa_08","label":"Exterior lighting supports safe customer and employee movement."},
  {"key":"sa_09","label":"Pest control evidence, traps, and door seals look acceptable where applicable."}]},
 {"key":"brand_ownership","label":"Manager Office and Brand Ownership","items":[
  {"key":"br_01","label":"Manager office is clean and organized."},
  {"key":"br_02","label":"No personal clothes, food, or belongings are being left to sit for long periods of time."},
  {"key":"br_03","label":"Employee communication boards are current, clean, and not cluttered with old information."},
  {"key":"br_04","label":"Store feels cared for and not tired, forgotten, or ignored."},
  {"key":"br_05","label":"Store is aligned with Caliche's standards of cleanliness, friendliness, accuracy, and speed."},
  {"key":"br_06","label":"Inspector would be comfortable showing this location to a vendor, banker, community leader, or future partner."},
  {"key":"br_07","label":"Manager can identify the top three physical or cleanliness improvements needed at the store."}]}
]}
$tpl$::jsonb;
$fn$;

-- active template = admin override (insp_template) if valid JSON, else default.
create or replace function public._insp_template()
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $fn$
declare v_txt text; v_j jsonb;
begin
  select svalue into v_txt from public.app_settings
   where skey = 'insp_template' and sgroup = 'insp_config';
  if v_txt is not null and btrim(v_txt) <> '' then
    begin
      v_j := v_txt::jsonb;
    exception when others then
      v_j := null;
    end;
  end if;
  if v_j is null or v_j->'sections' is null then
    v_j := public._insp_default_template();
  end if;
  return v_j;
end $fn$;

-- recompute cached section pcts + header overall_pct/critical_count.
create or replace function public._insp_recompute(p_id bigint)
returns void language plpgsql security definer set search_path=public,extensions as $fn$
declare v_critical int;
begin
  v_critical := public._insp_cfg_num('insp_critical_score', 1)::int;

  update public.insp_section s
     set section_pct = sub.pct, updated_at = now()
    from (select section_key,
                 round(100.0 * sum(score) / nullif(5 * count(*), 0), 1) as pct
            from public.insp_line
           where inspection_id = p_id and not na and score is not null
           group by section_key) sub
   where s.inspection_id = p_id and s.section_key = sub.section_key;

  update public.insp_inspection i
     set overall_pct = (select round(100.0 * sum(score) / nullif(5 * count(*), 0), 1)
                          from public.insp_line
                         where inspection_id = p_id and not na and score is not null),
         critical_count = (select count(*) from public.insp_line
                            where inspection_id = p_id and not na
                              and score is not null and score <= v_critical),
         updated_at = now()
   where i.id = p_id;
end $fn$;

-- full GET payload builder (shape documented in the file header).
create or replace function public._insp_get(p_id bigint)
returns jsonb language sql stable security definer set search_path=public,extensions as $fn$
  select (to_jsonb(i.*) - 'template') || jsonb_build_object(
    'sections', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'key',   ts.sec->>'key',
          'label', ts.sec->>'label',
          'section_comment', (select s.section_comment from public.insp_section s
                               where s.inspection_id = i.id and s.section_key = ts.sec->>'key'),
          'pct',   (select s.section_pct from public.insp_section s
                     where s.inspection_id = i.id and s.section_key = ts.sec->>'key'),
          'items', (
            select coalesce(jsonb_agg(jsonb_build_object(
                'key',   ti.it->>'key',
                'label', ti.it->>'label',
                'line_id', l.id,
                'score', l.score,
                'na',    coalesce(l.na, false),
                'severity', l.severity,
                'note',  l.note,
                'no_photo_reason', l.no_photo_reason,
                'photos', coalesce(l.photos, '[]'::jsonb)
              ) order by ti.iord), '[]'::jsonb)
            from jsonb_array_elements(ts.sec->'items') with ordinality ti(it, iord)
            left join public.insp_line l
              on l.inspection_id = i.id and l.item_key = ti.it->>'key')
        ) order by ts.sord), '[]'::jsonb)
      from jsonb_array_elements(i.template->'sections') with ordinality ts(sec, sord)),
    'actions', (select coalesce(jsonb_agg(to_jsonb(a.*) order by a.id), '[]'::jsonb)
                  from public.insp_action a where a.inspection_id = i.id),
    'answered', (select count(*) from public.insp_line
                  where inspection_id = i.id and (score is not null or na)),
    'total_items', (select count(*)
                      from jsonb_array_elements(i.template->'sections') s2,
                           jsonb_array_elements(s2.value->'items'))
  )
  from public.insp_inspection i where i.id = p_id;
$fn$;


-- ============================================================================
-- 4) RPCS
-- ============================================================================

-- config bundle for the frontend (template + thresholds + lists + role flag)
create or replace function public.insp_config_get(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._insp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'template', public._insp_template(),
    'evidence_min_score', public._insp_cfg_num('insp_evidence_min_score', 2),
    'critical_score',     public._insp_cfg_num('insp_critical_score', 1),
    'auto_task_max_score', public._insp_cfg_num('insp_auto_task_max_score', 2),
    'followup_threshold_pct', public._insp_cfg_num('insp_followup_threshold_pct', 80),
    'cadence_days',       public._insp_cfg_num('insp_cadence_days', 90),
    'followup_days',      public._insp_cfg_num('insp_followup_days', 14),
    'task_due_days',      public._insp_cfg_num('insp_task_due_days', 7),
    'critical_due_days',  public._insp_cfg_num('insp_critical_due_days', 2),
    'types', to_jsonb(string_to_array(public._insp_cfg_text('insp_types',
        'Quarterly Full,Follow-Up,Annual Deep Property,Spot Check,Special Site'), ',')),
    'site_types', to_jsonb(string_to_array(public._insp_cfg_text('insp_site_types',
        'Store,Warehouse,Trailer,Other Site'), ',')),
    'is_mgr', public._insp_is_mgr(v_role));
end $fn$;

-- start a new inspection (snapshots the active template)
create or replace function public.insp_start(
  p_username text, p_password text, p_location text, p_site_type text default 'Store',
  p_insp_type text default 'Quarterly Full', p_manager_on_duty text default null,
  p_announced text default 'scheduled', p_weather text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_id bigint;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._insp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._insp_is_mgr(v_role) then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_location),'') = '' then raise exception 'location_required'; end if;

  insert into public.insp_inspection(location, site_type, insp_type, inspector_name, inspector_id,
      manager_on_duty, announced, weather, template, created_by, created_by_id)
  values (btrim(p_location), coalesce(nullif(btrim(p_site_type),''),'Store'),
      coalesce(nullif(btrim(p_insp_type),''),'Quarterly Full'), v_name, v_uid,
      p_manager_on_duty, case when p_announced = 'unannounced' then 'unannounced' else 'scheduled' end,
      p_weather, public._insp_template(), v_name, v_uid)
  returning id into v_id;

  perform public._insp_audit(v_id, v_uid, v_name, 'start', p_location||' / '||coalesce(p_insp_type,''));
  return public._insp_get(v_id);
end $fn$;

create or replace function public.insp_get(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._insp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._insp_is_mgr(v_role) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.insp_inspection where id = p_id) then raise exception 'not_found'; end if;
  return public._insp_get(p_id);
end $fn$;

-- BULK section save (contract shape): p_payload =
--   { "section_comment": "...", "items": { "<item_key>": {"score":1-5|null,
--     "na":bool, "note":"...", "no_photo_reason":"..."}, ... } }
-- Upserts one insp_line per item key (unique(inspection_id,item_key)).
-- Photos are appended separately via insp_photo_add and are preserved here.
create or replace function public.insp_section_save(
  p_username text, p_password text, p_id bigint, p_section text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_status text; v_tpl jsonb;
  v_critical int; v_evidence int; r record;
  v_score int; v_na boolean; v_label text; v_seclabel text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._insp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._insp_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select status, template into v_status, v_tpl from public.insp_inspection where id = p_id;
  if v_status is null then raise exception 'not_found'; end if;
  if v_status <> 'draft' then raise exception 'already_submitted'; end if;

  v_critical := public._insp_cfg_num('insp_critical_score', 1)::int;
  v_evidence := public._insp_cfg_num('insp_evidence_min_score', 2)::int;

  select ts.sec->>'label' into v_seclabel
    from jsonb_array_elements(v_tpl->'sections') ts(sec)
   where ts.sec->>'key' = p_section limit 1;

  -- section row (comment + label)
  insert into public.insp_section(inspection_id, section_key, section_label, section_comment)
  values (p_id, p_section, coalesce(v_seclabel, p_section), p_payload->>'section_comment')
  on conflict (inspection_id, section_key) do update
    set section_comment = excluded.section_comment,
        section_label   = coalesce(excluded.section_label, public.insp_section.section_label),
        updated_at = now();

  -- bulk line upsert
  for r in select e.key as ikey, e.value as ival
             from jsonb_each(coalesce(p_payload->'items','{}'::jsonb)) e
  loop
    v_na := coalesce((r.ival->>'na')::boolean, false);
    v_score := case when (r.ival->>'score') ~ '^[1-5]$' then (r.ival->>'score')::int else null end;
    if v_na then v_score := null; end if;

    select ti.it->>'label' into v_label
      from jsonb_array_elements(v_tpl->'sections') ts(sec)
      cross join lateral jsonb_array_elements(ts.sec->'items') ti(it)
     where ti.it->>'key' = r.ikey limit 1;

    insert into public.insp_line(inspection_id, section_key, item_key, item_label,
        score, na, severity, note, no_photo_reason)
    values (p_id, p_section, r.ikey, coalesce(v_label, r.ikey), v_score, v_na,
        public._insp_severity(v_score, v_critical, v_evidence),
        nullif(btrim(coalesce(r.ival->>'note','')),''),
        nullif(btrim(coalesce(r.ival->>'no_photo_reason','')),''))
    on conflict (inspection_id, item_key) do update
      set section_key = excluded.section_key,
          item_label  = excluded.item_label,
          score       = excluded.score,
          na          = excluded.na,
          severity    = excluded.severity,
          note        = excluded.note,
          no_photo_reason = excluded.no_photo_reason,
          updated_at  = now();
  end loop;

  perform public._insp_recompute(p_id);
  perform public._insp_audit(p_id, v_uid, v_name, 'section_save', p_section);
  return public._insp_get(p_id);
end $fn$;

-- append one photo to a line (creates the line if the item wasn't saved yet)
create or replace function public.insp_photo_add(
  p_username text, p_password text, p_id bigint, p_item_key text, p_url text, p_caption text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_status text; v_tpl jsonb;
  v_label text; v_sec text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._insp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._insp_is_mgr(v_role) then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_url),'') = '' then raise exception 'url_required'; end if;

  select status, template into v_status, v_tpl from public.insp_inspection where id = p_id;
  if v_status is null then raise exception 'not_found'; end if;

  select ti.it->>'label', ts.sec->>'key' into v_label, v_sec
    from jsonb_array_elements(v_tpl->'sections') ts(sec)
    cross join lateral jsonb_array_elements(ts.sec->'items') ti(it)
   where ti.it->>'key' = p_item_key limit 1;

  insert into public.insp_line(inspection_id, section_key, item_key, item_label, photos)
  values (p_id, coalesce(v_sec,'unknown'), p_item_key, coalesce(v_label, p_item_key),
      jsonb_build_array(jsonb_build_object('url',p_url,'caption',p_caption,'by',v_name,'at',now())))
  on conflict (inspection_id, item_key) do update
    set photos = coalesce(public.insp_line.photos,'[]'::jsonb)
               || jsonb_build_object('url',p_url,'caption',p_caption,'by',v_name,'at',now()),
        updated_at = now();

  perform public._insp_audit(p_id, v_uid, v_name, 'photo_add', p_item_key||' '||p_url);
  return public._insp_get(p_id);
end $fn$;

-- BULK summary save (final review screen fields)
create or replace function public.insp_summary_save(
  p_username text, p_password text, p_id bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_status text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._insp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._insp_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select status into v_status from public.insp_inspection where id = p_id;
  if v_status is null then raise exception 'not_found'; end if;
  if v_status <> 'draft' then raise exception 'already_submitted'; end if;

  update public.insp_inspection set
    manager_on_duty   = coalesce(p_payload->>'manager_on_duty', manager_on_duty),
    weather           = coalesce(p_payload->>'weather', weather),
    top_strengths     = coalesce(p_payload->>'top_strengths', top_strengths),
    top_issues        = coalesce(p_payload->>'top_issues', top_issues),
    urgent_notes      = coalesce(p_payload->>'urgent_notes', urgent_notes),
    maint_notes       = coalesce(p_payload->>'maint_notes', maint_notes),
    supply_notes      = coalesce(p_payload->>'supply_notes', supply_notes),
    mgr_followup      = coalesce((p_payload->>'mgr_followup')::boolean, mgr_followup),
    mgr_followup_note = coalesce(p_payload->>'mgr_followup_note', mgr_followup_note),
    followup_recommended = coalesce((p_payload->>'followup_recommended')::boolean, followup_recommended),
    followup_date     = coalesce(nullif(p_payload->>'followup_date','')::date, followup_date),
    pride_score       = coalesce(case when (p_payload->>'pride_score') ~ '^[1-5]$'
                                      then (p_payload->>'pride_score')::int end, pride_score),
    pride_comment     = coalesce(p_payload->>'pride_comment', pride_comment),
    final_notes       = coalesce(p_payload->>'final_notes', final_notes),
    updated_at = now()
  where id = p_id;

  perform public._insp_audit(p_id, v_uid, v_name, 'summary_save', null);
  return public._insp_get(p_id);
end $fn$;

-- server-side validation: every template item answered (score or N/A); lines
-- at/below the evidence threshold need a note AND (photo OR no_photo_reason).
create or replace function public.insp_validate(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_tpl jsonb; v_status text;
  v_evidence int; v_blockers jsonb := '[]'::jsonb; r record; l record;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._insp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._insp_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select status, template into v_status, v_tpl from public.insp_inspection where id = p_id;
  if v_status is null then raise exception 'not_found'; end if;

  v_evidence := public._insp_cfg_num('insp_evidence_min_score', 2)::int;

  for r in select ti.it->>'key' as ikey, ti.it->>'label' as lbl
             from jsonb_array_elements(v_tpl->'sections') ts(sec)
             cross join lateral jsonb_array_elements(ts.sec->'items') ti(it)
  loop
    select * into l from public.insp_line
     where inspection_id = p_id and item_key = r.ikey;
    if not found or (l.score is null and not l.na) then
      v_blockers := v_blockers || jsonb_build_object('code','unscored','item_key',r.ikey,'label',r.lbl);
    elsif not l.na and l.score <= v_evidence then
      if coalesce(btrim(l.note),'') = '' then
        v_blockers := v_blockers || jsonb_build_object('code','note_required','item_key',r.ikey,'label',r.lbl);
      end if;
      if jsonb_array_length(coalesce(l.photos,'[]'::jsonb)) = 0
         and coalesce(btrim(l.no_photo_reason),'') = '' then
        v_blockers := v_blockers || jsonb_build_object('code','photo_or_reason_required','item_key',r.ikey,'label',r.lbl);
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', jsonb_array_length(v_blockers) = 0, 'blockers', v_blockers);
end $fn$;

-- corrective action routing. kind: 'maintenance' -> app_wo_create,
-- 'supply' -> app_supply_create, everything else (task/coaching/safety/vendor/
-- it/signage/other) -> app_task_create (store-targeted). Dynamic EXECUTE +
-- exception handler: a live signature mismatch records a 'pending_manual'
-- insp_action instead of failing. p_payload->>'existing_ref' links an already-
-- open work order/request WITHOUT creating a duplicate (spec §9).
create or replace function public.insp_action_create(
  p_username text, p_password text, p_id bigint, p_line_id bigint, p_kind text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_loc text; v_insp_status text;
  v_line public.insp_line%rowtype;  -- %rowtype: null-initialized so field refs are safe when p_line_id is null
  v_title text; v_notes text; v_due date; v_status text := 'open';
  v_target_table text; v_target_id text; v_res jsonb; v_err text; v_aid bigint;
  v_severity text; v_auto boolean; v_details text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._insp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._insp_is_mgr(v_role) then raise exception 'forbidden'; end if;
  if p_kind not in ('task','maintenance','supply','coaching','safety','vendor','it','signage','other') then
    raise exception 'bad_kind';
  end if;

  select location, status into v_loc, v_insp_status from public.insp_inspection where id = p_id;
  if v_loc is null then raise exception 'not_found'; end if;

  if p_line_id is not null then
    select * into v_line from public.insp_line where id = p_line_id and inspection_id = p_id;
    if not found then raise exception 'line_not_found'; end if;
    v_severity := v_line.severity;
  end if;

  v_auto  := coalesce((p_payload->>'auto')::boolean, false);
  v_title := coalesce(nullif(btrim(coalesce(p_payload->>'title','')),''),
                      'Inspection: '||coalesce(left(v_line.item_label, 90), p_kind||' follow-up'));
  v_notes := coalesce(p_payload->>'notes', v_line.note);
  v_due   := coalesce(nullif(p_payload->>'due','')::date,
                      current_date + (case when v_severity = 'critical'
                        then public._insp_cfg_num('insp_critical_due_days', 2)
                        else public._insp_cfg_num('insp_task_due_days', 7) end)::int);
  v_details := 'From Store & Site Inspection #'||p_id||' — '||v_loc
             || coalesce(' — '||v_line.item_label, '')
             || coalesce(' — Severity: '||v_severity, '')
             || coalesce(chr(10)||'Note: '||v_notes, '');

  if nullif(btrim(coalesce(p_payload->>'existing_ref','')),'') is not null then
    -- link to an already-open work order/request: record only, no duplicate.
    v_target_table := case when p_kind = 'maintenance' then 'app_wo'
                           when p_kind = 'supply' then 'app_supply' else 'app_task' end;
    v_target_id := btrim(p_payload->>'existing_ref');
  else
    begin
      if p_kind = 'maintenance' then
        v_target_table := 'app_wo';
        execute 'select public.app_wo_create(p_username=>$1,p_password=>$2,p_title=>$3,'
                ||'p_description=>$4,p_asset_id=>$5,p_asset_label=>$6,p_location=>$7,'
                ||'p_category=>$8,p_priority=>$9,p_equipment_use_status=>$10,p_safety_impact=>$11)'
          into v_res
          using p_username, p_password, v_title, v_details,
                nullif(p_payload->>'asset_id','')::int, p_payload->>'asset_label', v_loc,
                coalesce(p_payload->>'category','General'),
                case when v_severity = 'critical' then 'Urgent' else coalesce(p_payload->>'priority','Normal') end,
                p_payload->>'equipment_use_status',
                coalesce((p_payload->>'safety_impact')::boolean, v_severity = 'critical');
        v_target_id := coalesce(v_res->>'wo_number', v_res->>'id', v_res#>>'{}');

      elsif p_kind = 'supply' then
        v_target_table := 'app_supply';
        execute 'select public.app_supply_create(p_username=>$1,p_password=>$2,p_store=>$3,'
                ||'p_needed_by=>$4,p_needed_by_time=>$5,p_urgency=>$6,p_runout=>$7,p_reason=>$8,'
                ||'p_notes=>$9,p_photo_url=>$10,p_items=>$11)'
          into v_res
          using p_username, p_password, v_loc,
                v_due::text, null::text,
                case when v_severity = 'critical' then 'Urgent' else 'Normal' end,
                null::text, v_title, v_details, null::text, coalesce(p_payload->'items','[]'::jsonb);
        v_target_id := coalesce(v_res->>'request_no', v_res->>'id', v_res#>>'{}');

      else
        v_target_table := 'app_task';
        execute 'select public.app_task_create(p_username=>$1,p_password=>$2,p_title=>$3,'
                ||'p_details=>$4,p_due=>$5,p_target_type=>$6,p_target_value=>$7,'
                ||'p_employee_ids=>$8,p_completion_mode=>$9)'
          into v_res
          using p_username, p_password, v_title, v_details, v_due,
                'store', v_loc, null::bigint[], 'store';
        v_target_id := coalesce(v_res->>'id', v_res#>>'{}');
      end if;
    exception when others then
      get stacked diagnostics v_err = message_text;
      v_status := 'pending_manual';
      v_notes  := coalesce(v_notes,'') || ' [auto-create failed: '||coalesce(v_err,'unknown error')||']';
    end;
  end if;

  insert into public.insp_action(inspection_id, line_id, section_key, item_key, kind, title,
      notes, severity, owner_name, due_date, status, target_table, target_id, auto_created,
      created_by, created_by_id)
  values (p_id, p_line_id, v_line.section_key, v_line.item_key, p_kind, v_title,
      v_notes, v_severity, p_payload->>'owner', v_due, v_status, v_target_table, v_target_id,
      v_auto, v_name, v_uid)
  returning id into v_aid;

  if p_kind = 'safety' or v_severity = 'critical' then
    perform public._insp_notify_mgrs('Inspection: critical/safety finding — '||v_loc,
        left(v_title,140)||' (due '||v_due||')');
  end if;

  perform public._insp_audit(p_id, v_uid, v_name, 'action_create:'||p_kind,
      coalesce(v_line.item_key,'')||' -> '||coalesce(v_target_table,'internal')||':'||coalesce(v_target_id,'-'));
  return (select to_jsonb(x.*) from public.insp_action x where x.id = v_aid);
end $fn$;

-- update a corrective action (status / completion note / proof photo).
-- Deliberately NEVER touches the parent inspection (historical record).
create or replace function public.insp_action_update(
  p_username text, p_password text, p_action_id bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_a record; v_new_status text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._insp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._insp_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select * into v_a from public.insp_action where id = p_action_id;
  if not found then raise exception 'not_found'; end if;

  v_new_status := nullif(btrim(coalesce(p_payload->>'status','')),'');
  if v_new_status is not null
     and v_new_status not in ('open','in_progress','done','pending_manual','cancelled') then
    raise exception 'bad_status';
  end if;

  update public.insp_action set
    status = coalesce(v_new_status, status),
    completion_note = coalesce(p_payload->>'completion_note', completion_note),
    completion_photos = case when nullif(btrim(coalesce(p_payload->>'photo_url','')),'') is not null
        then coalesce(completion_photos,'[]'::jsonb)
             || jsonb_build_object('url',p_payload->>'photo_url','by',v_name,'at',now())
        else completion_photos end,
    owner_name = coalesce(p_payload->>'owner', owner_name),
    due_date = coalesce(nullif(p_payload->>'due','')::date, due_date),
    closed_at = case when v_new_status in ('done','cancelled') then now() else closed_at end,
    closed_by = case when v_new_status in ('done','cancelled') then v_name else closed_by end,
    updated_at = now()
  where id = p_action_id;

  perform public._insp_audit(v_a.inspection_id, v_uid, v_name, 'action_update',
      p_action_id::text||' -> '||coalesce(v_new_status,'(fields)'));
  return (select to_jsonb(x.*) from public.insp_action x where x.id = p_action_id);
end $fn$;

-- submit: validate -> recompute -> AUTO-ROUTE corrective tasks for every
-- failing line (score <= insp_auto_task_max_score) that has no action yet ->
-- follow-up recommendation -> notify leadership. Returns {ok,blockers} or the
-- full get payload with ok:true.
create or replace function public.insp_submit(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_val jsonb; v_i record;
  v_auto_max int; v_threshold numeric; v_followup_days int; v_line record;
  v_followup boolean; v_routed int := 0;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._insp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._insp_is_mgr(v_role) then raise exception 'forbidden'; end if;

  select * into v_i from public.insp_inspection where id = p_id;
  if not found then raise exception 'not_found'; end if;
  if v_i.status <> 'draft' then raise exception 'already_submitted'; end if;

  v_val := public.insp_validate(p_username, p_password, p_id);
  if not (v_val->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'blockers', v_val->'blockers');
  end if;

  perform public._insp_recompute(p_id);
  select * into v_i from public.insp_inspection where id = p_id;

  v_auto_max      := public._insp_cfg_num('insp_auto_task_max_score', 2)::int;
  v_threshold     := public._insp_cfg_num('insp_followup_threshold_pct', 80);
  v_followup_days := public._insp_cfg_num('insp_followup_days', 14)::int;

  -- auto-route: one corrective task per failing line without an action yet.
  for v_line in
    select l.* from public.insp_line l
     where l.inspection_id = p_id and not l.na
       and l.score is not null and l.score <= v_auto_max
       and not exists (select 1 from public.insp_action a where a.line_id = l.id)
  loop
    begin
      perform public.insp_action_create(p_username, p_password, p_id, v_line.id, 'task',
          jsonb_build_object('auto', true));
      v_routed := v_routed + 1;
    exception when others then
      null;  -- routing must never block a submit; the finding itself is saved.
    end;
  end loop;

  v_followup := (coalesce(v_i.overall_pct, 100) < v_threshold) or (v_i.critical_count > 0);

  update public.insp_inspection set
    status = 'submitted', submitted_at = now(), submitted_by = v_name,
    followup_recommended = followup_recommended or v_followup,
    followup_date = case when (followup_recommended or v_followup) and followup_date is null
                         then current_date + v_followup_days else followup_date end,
    updated_at = now()
  where id = p_id;

  perform public._insp_audit(p_id, v_uid, v_name, 'submit',
      'overall='||coalesce(v_i.overall_pct::text,'-')||' criticals='||v_i.critical_count
      ||' auto_tasks='||v_routed);

  perform public._insp_notify_mgrs(
      'Site Inspection submitted — '||v_i.location,
      coalesce(v_i.overall_pct::text,'?')||'% overall, '||v_i.critical_count||' critical, '
      ||v_routed||' corrective task(s) routed.'
      || case when v_followup then ' Follow-up inspection recommended.' else '' end);

  return jsonb_build_object('ok', true) || public._insp_get(p_id);
end $fn$;

-- list inspections (managers+). p_filters: {location,status,insp_type,from,to}
create or replace function public.insp_list(p_username text, p_password text, p_filters jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_loc text; v_status text; v_type text;
  v_from date; v_to date; v_out jsonb;
begin
  select uid,urole into v_uid,v_role from public._insp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._insp_is_mgr(v_role) then raise exception 'forbidden'; end if;

  v_loc    := nullif(coalesce(p_filters,'{}'::jsonb)->>'location','');
  v_status := nullif(coalesce(p_filters,'{}'::jsonb)->>'status','');
  v_type   := nullif(coalesce(p_filters,'{}'::jsonb)->>'insp_type','');
  v_from   := nullif(coalesce(p_filters,'{}'::jsonb)->>'from','')::date;
  v_to     := nullif(coalesce(p_filters,'{}'::jsonb)->>'to','')::date;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'location', i.location, 'site_type', i.site_type, 'insp_type', i.insp_type,
      'status', i.status, 'announced', i.announced, 'inspector_name', i.inspector_name,
      'started_at', i.started_at, 'submitted_at', i.submitted_at,
      'overall_pct', i.overall_pct, 'critical_count', i.critical_count,
      'followup_recommended', i.followup_recommended, 'followup_date', i.followup_date,
      'open_actions', (select count(*) from public.insp_action a
                        where a.inspection_id = i.id
                          and a.status in ('open','in_progress','pending_manual'))
    ) order by i.started_at desc), '[]'::jsonb)
  into v_out
  from public.insp_inspection i
  where (v_loc is null or i.location = v_loc)
    and (v_status is null or i.status = v_status)
    and (v_type is null or i.insp_type = v_type)
    and (v_from is null or i.started_at::date >= v_from)
    and (v_to is null or i.started_at::date <= v_to)
  ;
  return v_out;
end $fn$;

-- leadership dashboard. p_filters: {location,from,to}
create or replace function public.insp_dashboard(p_username text, p_password text, p_filters jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_loc text; v_from date; v_to date;
  v_cadence int; v_evidence int;
  v_locs jsonb; v_crit jsonb; v_repeat jsonb; v_secavg jsonb; v_summary jsonb;
begin
  select uid,urole into v_uid,v_role from public._insp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._insp_is_mgr(v_role) then raise exception 'forbidden'; end if;

  v_loc  := nullif(coalesce(p_filters,'{}'::jsonb)->>'location','');
  v_from := coalesce(nullif(coalesce(p_filters,'{}'::jsonb)->>'from','')::date, current_date - 365);
  v_to   := coalesce(nullif(coalesce(p_filters,'{}'::jsonb)->>'to','')::date, current_date);
  v_cadence  := public._insp_cfg_num('insp_cadence_days', 90)::int;
  v_evidence := public._insp_cfg_num('insp_evidence_min_score', 2)::int;

  select coalesce(jsonb_agg(jsonb_build_object(
      'location', d.location,
      'last_id', d.last_id, 'last_date', d.last_date, 'last_pct', d.last_pct,
      'prev_pct', d.prev_pct, 'critical_count', d.critical_count,
      'next_due', d.next_due, 'overdue', (d.next_due is not null and d.next_due < current_date),
      'open_actions', d.open_actions, 'open_critical', d.open_critical
    ) order by d.location), '[]'::jsonb)
  into v_locs
  from (
    select locs.location,
           last.id as last_id, last.submitted_at::date as last_date,
           last.overall_pct as last_pct, last.critical_count,
           prev.overall_pct as prev_pct,
           (last.submitted_at::date + v_cadence) as next_due,
           (select count(*) from public.insp_action a
              join public.insp_inspection ii on ii.id = a.inspection_id
             where ii.location = locs.location
               and a.status in ('open','in_progress','pending_manual')) as open_actions,
           (select count(*) from public.insp_action a
              join public.insp_inspection ii on ii.id = a.inspection_id
             where ii.location = locs.location and a.severity = 'critical'
               and a.status in ('open','in_progress','pending_manual')) as open_critical
    from (select distinct location from public.insp_inspection
           where (v_loc is null or location = v_loc)) locs
    left join lateral (select * from public.insp_inspection x
        where x.location = locs.location and x.status = 'submitted'
        order by x.submitted_at desc limit 1) last on true
    left join lateral (select * from public.insp_inspection x
        where x.location = locs.location and x.status = 'submitted'
        order by x.submitted_at desc offset 1 limit 1) prev on true
  ) d;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'inspection_id', a.inspection_id, 'location', ii.location,
      'title', a.title, 'kind', a.kind, 'severity', a.severity, 'status', a.status,
      'due_date', a.due_date, 'owner_name', a.owner_name,
      'target_table', a.target_table, 'target_id', a.target_id
    ) order by a.due_date nulls last, a.id), '[]'::jsonb)
  into v_crit
  from public.insp_action a
  join public.insp_inspection ii on ii.id = a.inspection_id
  where a.severity = 'critical' and a.status in ('open','in_progress','pending_manual')
    and (v_loc is null or ii.location = v_loc);

  select coalesce(jsonb_agg(jsonb_build_object(
      'item_key', t.item_key, 'label', t.lbl, 'fail_count', t.c, 'locations', t.locs)
      order by t.c desc), '[]'::jsonb)
  into v_repeat
  from (
    select l.item_key, max(l.item_label) as lbl, count(*) as c,
           count(distinct ii.location) as locs
    from public.insp_line l
    join public.insp_inspection ii on ii.id = l.inspection_id
    where ii.status = 'submitted' and ii.submitted_at::date between v_from and v_to
      and (v_loc is null or ii.location = v_loc)
      and not l.na and l.score is not null and l.score <= v_evidence
    group by l.item_key
    having count(*) >= 2
    order by count(*) desc
    limit 12
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object(
      'section_key', t.section_key, 'label', t.lbl, 'avg_pct', t.avg_pct)
      order by t.avg_pct), '[]'::jsonb)
  into v_secavg
  from (
    select s.section_key, max(s.section_label) as lbl, round(avg(s.section_pct),1) as avg_pct
    from public.insp_section s
    join public.insp_inspection ii on ii.id = s.inspection_id
    where ii.status = 'submitted' and ii.submitted_at::date between v_from and v_to
      and (v_loc is null or ii.location = v_loc) and s.section_pct is not null
    group by s.section_key
  ) t;

  select jsonb_build_object(
      'inspections', count(*),
      'avg_pct', round(avg(overall_pct),1),
      'critical_findings', coalesce(sum(critical_count),0),
      'followups_recommended', count(*) filter (where followup_recommended))
  into v_summary
  from public.insp_inspection
  where status = 'submitted' and submitted_at::date between v_from and v_to
    and (v_loc is null or location = v_loc);

  return jsonb_build_object('from', v_from, 'to', v_to, 'location', v_loc,
      'locations', v_locs, 'criticals', v_crit, 'repeat_issues', v_repeat,
      'section_avgs', v_secavg, 'summary', v_summary);
end $fn$;

-- ============================================================================
-- NEW RPCS: insp_config_get, insp_start, insp_get, insp_section_save,
--   insp_photo_add, insp_summary_save, insp_validate, insp_action_create,
--   insp_action_update, insp_submit, insp_list, insp_dashboard
-- NEW TABLES: insp_inspection, insp_section, insp_line, insp_action, insp_audit
-- VERIFY after apply:
--   select public.insp_config_get('test_admin','1111');
--   select public.insp_dashboard('test_admin','1111','{}'::jsonb);
--   select pg_get_functiondef('public.app_task_create'::regproc);
--   select pg_get_functiondef('public.app_wo_create'::regproc);
--   select pg_get_functiondef('public.app_supply_create'::regproc);
--   select pg_get_functiondef('public.push_enqueue'::regproc);
-- ============================================================================
