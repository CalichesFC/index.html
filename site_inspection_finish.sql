-- ============================================================================
-- Caliche's Hub — STORE & SITE INSPECTION "finish" pass (site_inspection_finish.sql)
-- Additive, idempotent. Run AFTER site_inspection.sql in Supabase SQL editor
-- (proj ikgbihwkqhsfahnswfbz). Same SECURITY DEFINER + _insp_auth role-gate
-- pattern as site_inspection.sql. Closes Aaron's spec gaps:
--
--   1) AUTO FOLLOW-UP INSPECTION — insp_submit (re-created below with its FULL
--      current behavior preserved byte-for-byte, then extended) now also
--      pre-creates a linked DRAFT follow-up inspection when the submit lands
--      below the follow-up threshold (default 80%) or has any critical
--      finding. Scheduled per the inspection's followup_date, else
--      current_date + app_settings ['insp_rules'/'followup_days'] (seeded, 14).
--      Leadership is notified via the same _insp_notify_mgrs call insp_submit
--      already uses for criticals.
--   2) REMINDERS — insp_reminder_scan(p_username,p_password) finds draft
--      follow-up/scheduled inspections due within 3 days (due_soon) or past
--      due (overdue) and creates a dedup-safe store-targeted task for the
--      location's managers via the SAME defensive dynamic-EXECUTE
--      app_task_create pattern as dsr_action_create (daily_store_report.sql):
--      a live signature mismatch is recorded, never raised. Dedup ledger =
--      insp_reminder (unique inspection+bucket+day, re-nag window 3 days).
--   3) Scoopy Q&A seeds for the two features (teach_scoopy.sql pattern).
--
-- NEW TABLE: insp_reminder (RLS enabled, NO policies — RPC-only, deny-all)
-- NEW COLUMNS: insp_inspection.followup_of_id, insp_inspection.is_followup
-- NEW RPCS: insp_reminder_scan(p_username,p_password)
-- REPLACED RPCS: insp_submit (existing behavior preserved + follow-up block)
-- ============================================================================


-- ============================================================================
-- 1) ADDITIVE COLUMNS — follow-up lineage on insp_inspection
-- ============================================================================
alter table public.insp_inspection
  add column if not exists followup_of_id bigint references public.insp_inspection(id);
alter table public.insp_inspection
  add column if not exists is_followup boolean not null default false;
create index if not exists insp_inspection_followup_of_idx
  on public.insp_inspection(followup_of_id);


-- ============================================================================
-- 2) NEW TABLE — reminder dedup ledger (RLS on, no policies: deny-all)
-- ============================================================================
create table if not exists public.insp_reminder (
  id            bigserial primary key,
  inspection_id bigint not null references public.insp_inspection(id),
  bucket        text not null,                       -- due_soon | overdue
  sent_on       date not null default current_date,
  location      text,
  task_id       text,                                -- app_task id (or failure note)
  created_by    text,
  created_at    timestamptz not null default now(),
  unique (inspection_id, bucket, sent_on)
);
create index if not exists insp_reminder_insp_idx on public.insp_reminder(inspection_id);
alter table public.insp_reminder enable row level security;


-- ============================================================================
-- 3) CONFIG SEED — group 'insp_rules', key 'followup_days' (insert-if-absent).
-- app_settings PK is skey, so 'on conflict (skey) do nothing' = insert-if-absent.
-- ============================================================================
insert into public.app_settings(skey,sgroup,label,svalue,sort) values
  ('followup_days','insp_rules','Auto follow-up inspection: days out when no date was set','14',10)
on conflict (skey) do nothing;

-- days-out for the auto-created follow-up draft: insp_rules/followup_days
-- first, else the existing insp_config/insp_followup_days, else 14.
create or replace function public._insp_rule_followup_days()
returns int language sql stable as $fn$
  select coalesce(
    (select svalue::int from public.app_settings
      where skey = 'followup_days' and sgroup = 'insp_rules' and svalue ~ '^[0-9]+$'),
    public._insp_cfg_num('insp_followup_days', 14)::int,
    14);
$fn$;


-- ============================================================================
-- 4) insp_submit — FULL current behavior preserved (copied verbatim from
-- site_inspection.sql), extended with the AUTO FOLLOW-UP block (marked).
-- ============================================================================
create or replace function public.insp_submit(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_val jsonb; v_i record;
  v_auto_max int; v_threshold numeric; v_followup_days int; v_line record;
  v_followup boolean; v_routed int := 0;
  v_fu_date date; v_fu_id bigint;  -- AUTO FOLLOW-UP additions
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

  -- ==== AUTO FOLLOW-UP INSPECTION (site_inspection_finish.sql) ==============
  -- Below threshold or any critical finding -> pre-create the follow-up walk
  -- as a linked draft for the same location/site type, scheduled per the
  -- (post-update) followup_date, else +_insp_rule_followup_days(). Guarded so
  -- it can never block a submit, and never duplicates (one per parent).
  if v_followup and not exists (
      select 1 from public.insp_inspection f where f.followup_of_id = p_id) then
    begin
      -- inspector-set recommended date (pre-update snapshot in v_i) wins;
      -- else current_date + app_settings['insp_rules'/'followup_days'] (14).
      v_fu_date := coalesce(v_i.followup_date, current_date + public._insp_rule_followup_days());

      insert into public.insp_inspection(location, site_type, insp_type,
          manager_on_duty, announced, status, template, followup_date,
          is_followup, followup_of_id, created_by, created_by_id)
      values (v_i.location, v_i.site_type, 'Follow-Up', v_i.manager_on_duty,
          'scheduled', 'draft', public._insp_template(), v_fu_date,
          true, p_id, v_name, v_uid)
      returning id into v_fu_id;

      perform public._insp_audit(p_id, v_uid, v_name, 'followup_autocreate',
          'follow-up inspection #'||v_fu_id||' scheduled '||v_fu_date);
      perform public._insp_audit(v_fu_id, v_uid, v_name, 'auto_followup',
          'auto-created from inspection #'||p_id);

      -- same leadership notification mechanism insp_submit already uses.
      perform public._insp_notify_mgrs(
          'Follow-up inspection scheduled — '||v_i.location,
          'Auto-created from inspection #'||p_id||' ('
          ||coalesce(v_i.overall_pct::text,'?')||'% overall, '||v_i.critical_count
          ||' critical). Target date '||v_fu_date||'.');
    exception when others then
      null;  -- follow-up creation must never block a submit.
    end;
  end if;
  -- ==== /AUTO FOLLOW-UP ======================================================

  return jsonb_build_object('ok', true) || public._insp_get(p_id);
end $fn$;


-- ============================================================================
-- 5) insp_reminder_scan — due-soon (<= 3 days out) / overdue draft follow-ups.
-- Creates ONE store-targeted reminder task per inspection+bucket per 3-day
-- window (insp_reminder ledger; unique(inspection_id,bucket,sent_on) also
-- makes concurrent scans safe). app_task_create is called via the defensive
-- dynamic EXECUTE + USING pattern from dsr_action_create: a live signature
-- mismatch is logged on the ledger row, counted, and never raised.
-- ============================================================================
create or replace function public.insp_reminder_scan(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; r record;
  v_bucket text; v_title text; v_details text; v_due date;
  v_res jsonb; v_err text; v_task_id text; v_rid bigint;
  v_due_soon int := 0; v_overdue int := 0; v_created int := 0;
  v_skipped int := 0; v_failed int := 0;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._insp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._insp_is_mgr(v_role) then raise exception 'forbidden'; end if;

  for r in
    select i.* from public.insp_inspection i
     where i.status = 'draft'
       and i.followup_date is not null
       and (coalesce(i.is_followup, false) or coalesce(i.followup_recommended, false))
       and i.followup_date <= current_date + 3
     order by i.followup_date, i.id
  loop
    v_bucket := case when r.followup_date < current_date then 'overdue' else 'due_soon' end;
    if v_bucket = 'overdue' then v_overdue := v_overdue + 1; else v_due_soon := v_due_soon + 1; end if;

    -- dedup: at most one reminder per inspection+bucket every 3 days.
    if exists (select 1 from public.insp_reminder x
                where x.inspection_id = r.id and x.bucket = v_bucket
                  and x.sent_on > current_date - 3) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_rid := null;
    insert into public.insp_reminder(inspection_id, bucket, location, created_by)
    values (r.id, v_bucket, r.location, v_name)
    on conflict (inspection_id, bucket, sent_on) do nothing
    returning id into v_rid;
    if v_rid is null then v_skipped := v_skipped + 1; continue; end if;  -- concurrent scan won

    v_title := case when v_bucket = 'overdue'
        then 'OVERDUE follow-up inspection — '||r.location
        else 'Follow-up inspection due '||r.followup_date||' — '||r.location end;
    v_details := 'Store & Site Inspection reminder ('||replace(v_bucket,'_',' ')||'). '
        ||'Draft inspection #'||r.id||' ('||coalesce(r.insp_type,'Follow-Up')||') for '||r.location
        ||' is scheduled for '||r.followup_date
        ||case when r.followup_of_id is not null
               then ' (follow-up of inspection #'||r.followup_of_id||')' else '' end
        ||'. Open Store & Site Inspection to complete it.';
    v_due := greatest(r.followup_date, current_date);

    begin
      execute 'select public.app_task_create(p_username=>$1,p_password=>$2,p_title=>$3,'
              ||'p_details=>$4,p_due=>$5,p_target_type=>$6,p_target_value=>$7,'
              ||'p_employee_ids=>$8,p_completion_mode=>$9)'
        into v_res
        using p_username, p_password, v_title, v_details, v_due,
              'store', r.location, null::bigint[], 'store';
      v_task_id := coalesce(v_res->>'id', v_res#>>'{}');
      update public.insp_reminder set task_id = v_task_id where id = v_rid;
      v_created := v_created + 1;
    exception when others then
      get stacked diagnostics v_err = message_text;
      v_failed := v_failed + 1;
      update public.insp_reminder set task_id = '[task failed: '||coalesce(v_err,'unknown error')||']'
       where id = v_rid;
    end;

    perform public._insp_audit(r.id, v_uid, v_name, 'reminder:'||v_bucket,
        r.location||' follow-up '||r.followup_date);
  end loop;

  if v_created > 0 or v_failed > 0 then
    perform public._insp_notify_mgrs('Inspection reminders',
        v_due_soon||' due soon, '||v_overdue||' overdue. '
        ||v_created||' reminder task(s) created.');
  end if;

  return jsonb_build_object('ok', true, 'due_soon', v_due_soon, 'overdue', v_overdue,
      'created', v_created, 'skipped_recent', v_skipped, 'task_failed', v_failed);
end $fn$;


-- ============================================================================
-- 6) TEACH MR. SCOOPY (teach_scoopy.sql pattern — insert-if-absent)
-- ============================================================================
insert into public.knowledge_base (category, question, answer, updated_at, updated_by)
select 'App Help', q, a, now(), 'Cowork build' from (values
  ('What happens if a store scores low on a site inspection?',
   'When an inspection is submitted below the follow-up threshold (80% by default) or with any critical finding, the Hub automatically creates a linked draft follow-up inspection for that location and notifies leadership. The follow-up is scheduled for the recommended follow-up date, or a set number of days out (14 by default, adjustable in Business Settings).'),
  ('How do follow-up inspections get scheduled?',
   'Follow-ups schedule themselves. A low-scoring or critical submitted inspection auto-creates a draft Follow-Up inspection linked to the original, dated per the inspector''s recommended follow-up date or the configured default days out. It appears in the inspection list as a draft until a leader walks and submits it.'),
  ('How do inspection reminders work?',
   'On the inspection leadership dashboard, tap the Reminders button. It scans for draft follow-up inspections due within 3 days or past due, creates a reminder task for that store''s managers, and pings leadership. Reminders are dedup-safe - the same inspection is not re-nagged more than once every 3 days.')
) v(q,a)
where not exists (select 1 from public.knowledge_base kb where kb.question = v.q);


-- ============================================================================
-- VERIFY after apply:
--   select public._insp_rule_followup_days();
--   select public.insp_reminder_scan('test_admin','1111');
--   select id, location, insp_type, status, is_followup, followup_of_id,
--          followup_date from public.insp_inspection order by id desc limit 5;
--   select pg_get_functiondef('public.insp_submit'::regproc);
-- ============================================================================
