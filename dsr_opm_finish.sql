-- ============================================================================
-- Caliche's Hub — DSR + OPS MEETING FINISH PASS  (dsr_opm_finish.sql)
-- ADDITIVE + IDEMPOTENT (create or replace only; NO new tables needed).
-- Run in Supabase SQL editor AFTER daily_store_report.sql / dsr_finish*.sql /
-- ops_meeting.sql. Conventions (CONTRACT): SECURITY DEFINER, first args
-- (p_username, p_password), set search_path=public,extensions; auth reuses
-- public._pp_auth and the _opm_* role gates ops_meeting.sql already installed.
--
-- CONTENTS
--   1) _opm_perf_month       helper — ONE location-month rollup, fully
--                            defensive over live tables (store_metrics,
--                            daily_sales, daily_sales_detail,
--                            prime_cost_weeks / prime_cost_days). Missing
--                            tables/columns yield NULLs, never errors.
--   2) opm_perf_autofill     NEW RPC — the meeting's REVIEW month vs the
--                            prior month vs the same month last year for the
--                            meeting's store: sales, labor $ and %, prime
--                            cost %, transactions, average ticket. NULLs
--                            where a store has no Axial data (today only
--                            Roadrunner syncs), so the manual-fallback fields
--                            in js/21 stay authoritative. The frontend only
--                            FILLS the manual inputs — the manager reviews,
--                            edits, and saves (manager-approval philosophy).
--   3) opm_audit_list        NEW RPC — read-only meeting history: status
--                            changes, AI-insight decisions, agenda decisions,
--                            shift-leader input reviews, recap send. Built
--                            from the opm_* tables' first-class decision
--                            columns (always present) + Phase-1 audit_log
--                            rows read DEFENSIVELY (to_regclass + exception).
--                            No new audit table is needed: every event the
--                            History tab lists is already recorded.
--   4) opm_insights_generate create or replace — the FULL original body from
--                            ops_meeting.sql preserved unchanged, plus two
--                            new defensive packet sources appended:
--                            marketing (mkt_campaigns — the repo's table
--                            name; the spec's "mkt_campaign" does not exist)
--                            and training (trh_enrollments), both in the same
--                            to_regclass + exception-swallowing style the
--                            function already uses for manager_logbook.
--
-- DSR NOTE: the Daily Store Report print / Dropbox-archive / History
-- additions are FRONTEND-ONLY (js/18): printing mirrors opmPrint(), archiving
-- reuses the existing hubGenHrPdf Apps-Script pipeline (js/06), and the
-- History section reads dsr_audit_list, which already exists in
-- daily_store_report.sql — no new DSR SQL is required.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) _opm_perf_month — one location-month performance rollup (defensive).
--    Sales preference mirrors _cc_day_json (command_center.sql): Axial-synced
--    store_metrics first, then daily_sales_detail net, then daily_sales gross.
--    prime_cost_weeks / prime_cost_days live only in the prod DB (written by
--    the weekly prime-cost form's app_prime_save), so they are probed through
--    _opm_try_num — a missing table or column simply returns NULL.
-- ----------------------------------------------------------------------------
create or replace function public._opm_perf_month(p_location text, p_m0 date)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  m1 date := (p_m0 + interval '1 month')::date;
  v_days int; v_sales numeric; v_guests numeric;
  v_labor_pct numeric; v_labor_w numeric; v_labor_base numeric;
  v_ds_sales numeric; v_ds_labor numeric; v_ds_tx numeric;
  v_dd_sales numeric; v_dd_labor numeric; v_dd_checks numeric;
  v_tx numeric; v_labor_cost numeric; v_prime numeric; v_avg numeric;
begin
  -- store_metrics (Axial scorecard sync) — isolated so a missing table/column
  -- can never break the response
  begin
    if to_regclass('public.store_metrics') is not null then
      select count(*), sum(sales), sum(guest_count),
             sum(labor_pct * sales) filter (where labor_pct is not null and coalesce(sales,0) > 0),
             sum(sales)             filter (where labor_pct is not null and coalesce(sales,0) > 0),
             avg(labor_pct)
        into v_days, v_sales, v_guests, v_labor_w, v_labor_base, v_labor_pct
      from public.store_metrics
      where location = p_location and metric_date >= p_m0 and metric_date < m1;
      -- sales-weighted labor % when possible (falls back to the plain average)
      if coalesce(v_labor_base,0) > 0 then v_labor_pct := v_labor_w / v_labor_base; end if;
    end if;
  exception when others then
    v_days := null; v_sales := null; v_guests := null; v_labor_pct := null;
  end;

  -- daily_sales / daily_sales_detail (live tables; probed defensively)
  v_ds_sales  := public._opm_try_num('select sum(gross_sales) from public.daily_sales where location = '
                   ||quote_literal(p_location)||' and business_date >= '||quote_literal(p_m0::text)
                   ||'::date and business_date < '||quote_literal(m1::text)||'::date');
  v_ds_labor  := public._opm_try_num('select sum(labor_cost) from public.daily_sales where location = '
                   ||quote_literal(p_location)||' and business_date >= '||quote_literal(p_m0::text)
                   ||'::date and business_date < '||quote_literal(m1::text)||'::date');
  v_ds_tx     := public._opm_try_num('select sum(transactions) from public.daily_sales where location = '
                   ||quote_literal(p_location)||' and business_date >= '||quote_literal(p_m0::text)
                   ||'::date and business_date < '||quote_literal(m1::text)||'::date');
  v_dd_sales  := public._opm_try_num('select sum(net_sales) from public.daily_sales_detail where location = '
                   ||quote_literal(p_location)||' and sale_date >= '||quote_literal(p_m0::text)
                   ||'::date and sale_date < '||quote_literal(m1::text)||'::date');
  v_dd_labor  := public._opm_try_num('select sum(labor) from public.daily_sales_detail where location = '
                   ||quote_literal(p_location)||' and sale_date >= '||quote_literal(p_m0::text)
                   ||'::date and sale_date < '||quote_literal(m1::text)||'::date');
  v_dd_checks := public._opm_try_num('select sum(checks) from public.daily_sales_detail where location = '
                   ||quote_literal(p_location)||' and sale_date >= '||quote_literal(p_m0::text)
                   ||'::date and sale_date < '||quote_literal(m1::text)||'::date');

  v_sales := coalesce(v_sales, v_dd_sales, v_ds_sales);

  -- labor $: real labor dollars first, else derived from the synced labor %
  v_labor_cost := coalesce(v_ds_labor, v_dd_labor,
                    case when v_sales is not null and v_labor_pct is not null
                         then round(v_sales * v_labor_pct / 100.0, 2) end);
  if v_labor_pct is null and coalesce(v_sales,0) > 0 and v_labor_cost is not null then
    v_labor_pct := v_labor_cost / v_sales * 100.0;
  end if;

  v_tx := coalesce(v_guests, v_ds_tx, v_dd_checks);
  if coalesce(v_tx,0) > 0 and v_sales is not null then v_avg := v_sales / v_tx; end if;

  -- prime cost % — live prime-cost tables (weekly form / Axial); NULL if absent
  v_prime := public._opm_try_num('select avg(prime_pct) from public.prime_cost_weeks where location = '
               ||quote_literal(p_location)||' and week_start >= '||quote_literal(p_m0::text)
               ||'::date and week_start < '||quote_literal(m1::text)||'::date');
  if v_prime is null then
    v_prime := public._opm_try_num('select avg(prime_pct) from public.prime_cost_days where location = '
                 ||quote_literal(p_location)||' and day >= '||quote_literal(p_m0::text)
                 ||'::date and day < '||quote_literal(m1::text)||'::date');
  end if;

  return jsonb_build_object(
    'month',         to_char(p_m0, 'YYYY-MM'),
    'days_reported', coalesce(v_days, 0),
    'sales',         case when v_sales      is not null then round(v_sales, 2)      end,
    'labor_cost',    case when v_labor_cost is not null then round(v_labor_cost, 2) end,
    'labor_pct',     case when v_labor_pct  is not null then round(v_labor_pct, 1)  end,
    'prime_pct',     case when v_prime      is not null then round(v_prime, 1)      end,
    'transactions',  case when v_tx         is not null then round(v_tx)            end,
    'avg_ticket',    case when v_avg        is not null then round(v_avg, 2)        end);
end $fn$;


-- ----------------------------------------------------------------------------
-- 2) opm_perf_autofill — manager+. Same review-month rule as opm_get (the
--    month BEFORE the meeting month). Returns current / prior / last_year
--    period rollups plus a 'suggest' object keyed to the existing manual
--    section fields (sl_manual_sales, sl_manual_sales_ly, sl_manual_labor,
--    sl_manual_guests). The RPC saves NOTHING — js/21 fills the inputs and
--    the manager saves through the existing opm_save_section.
-- ----------------------------------------------------------------------------
create or replace function public.opm_perf_autofill(
  p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_m public.opm_meetings;
        v_review text; v_r0 date; v_cur jsonb; v_prior jsonb; v_ly jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_m from public.opm_meetings where id = p_id;
  if v_m.id is null then raise exception 'not_found'; end if;

  -- review month = the month BEFORE the meeting month (matches opm_get)
  v_review := to_char((v_m.meeting_month||'-01')::date - interval '1 month', 'YYYY-MM');
  v_r0 := (v_review||'-01')::date;

  v_cur   := public._opm_perf_month(v_m.location, v_r0);
  v_prior := public._opm_perf_month(v_m.location, (v_r0 - interval '1 month')::date);
  v_ly    := public._opm_perf_month(v_m.location, (v_r0 - interval '12 months')::date);

  perform public._opm_audit(v_uid, v_name, 'opm_perf_autofill', null, null,
     jsonb_build_object('meeting_id', p_id, 'review_month', v_review), null);

  return jsonb_build_object(
    'ok', true,
    'review_month', v_review,
    'current',   v_cur,
    'prior',     v_prior,
    'last_year', v_ly,
    'suggest', jsonb_build_object(
      'sl_manual_sales',    v_cur->>'sales',
      'sl_manual_sales_ly', v_ly->>'sales',
      'sl_manual_labor',    v_cur->>'labor_pct',
      'sl_manual_guests',   v_cur->>'transactions'));
end $fn$;


-- ----------------------------------------------------------------------------
-- 3) opm_audit_list — manager+. Read-only meeting history for the History tab.
--    Primary events come from first-class columns on the opm_* tables (they
--    are always recorded): meeting lifecycle timestamps, insight decisions
--    (decided_by/decided_at + status), agenda decisions, shift-leader input
--    reviews. Extra context (section saves, sensitivity changes with reasons,
--    attendance marks, action-item ops, insight generation runs) is merged in
--    from the Phase-1 audit_log DEFENSIVELY — if that table is missing or
--    shaped differently, the primary events still return.
--    Shape: { meeting_id, events:[ {at, actor, action, detail, reason} ... ] }
-- ----------------------------------------------------------------------------
create or replace function public.opm_audit_list(
  p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_m public.opm_meetings;
        v_events jsonb; v_extra jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._opm_is_mgr(v_role) then raise exception 'forbidden'; end if;
  select * into v_m from public.opm_meetings where id = p_id;
  if v_m.id is null then raise exception 'not_found'; end if;

  -- 1) first-class events (always available from the opm_* tables)
  select coalesce(jsonb_agg(q.e order by (q.e->>'at') desc), '[]'::jsonb)
    into v_events
  from (
    select jsonb_build_object('at', m.created_at,
             'actor', coalesce(m.created_by, m.owner_name), 'action', 'created',
             'detail', 'Meeting draft created', 'reason', null::text) as e
    from public.opm_meetings m where m.id = p_id
    union all
    select jsonb_build_object('at', m.locked_at, 'actor', m.locked_by,
             'action', 'status', 'detail', 'Agenda locked', 'reason', null::text)
    from public.opm_meetings m where m.id = p_id and m.locked_at is not null
    union all
    select jsonb_build_object('at', m.published_at, 'actor', m.published_by,
             'action', 'status', 'detail', 'Pre-meeting brief published', 'reason', null::text)
    from public.opm_meetings m where m.id = p_id and m.published_at is not null
    union all
    select jsonb_build_object('at', m.completed_at, 'actor', m.completed_by,
             'action', 'status', 'detail', 'Meeting completed', 'reason', null::text)
    from public.opm_meetings m where m.id = p_id and m.completed_at is not null
    union all
    select jsonb_build_object('at', m.recap_sent_at, 'actor', m.recap_sent_by,
             'action', 'recap_sent', 'detail', 'Recap sent to shift leaders & leadership', 'reason', null::text)
    from public.opm_meetings m where m.id = p_id and m.recap_sent_at is not null
    union all
    select jsonb_build_object('at', i.decided_at, 'actor', i.decided_by,
             'action', 'insight_'||i.status,
             'detail', 'AI suggestion "'||i.title||'" '
               ||case i.status when 'accepted' then 'accepted onto the agenda'
                               when 'rejected' then 'rejected'
                               when 'deferred' then 'deferred'
                               when 'private'  then 'handled privately'
                               else i.status end,
             'reason', null::text)
    from public.opm_insights i where i.meeting_id = p_id and i.decided_at is not null
    union all
    select jsonb_build_object('at', a.decided_at, 'actor', a.decided_by,
             'action', 'agenda_'||a.status,
             'detail', 'Topic "'||a.title||'" '
               ||case a.status when 'approved' then 'approved'
                               when 'rejected' then 'rejected'
                               when 'deferred' then 'deferred'
                               when 'removed'  then 'removed'
                               else a.status end,
             'reason', null::text)
    from public.opm_agenda a where a.meeting_id = p_id and a.decided_at is not null
    union all
    select jsonb_build_object('at', s.responded_at, 'actor', s.responded_by,
             'action', 'input_'||s.status,
             'detail', 'Shift-leader '||s.kind||' from '||coalesce(s.author_name, 'a shift leader')||' '
               ||case s.status when 'approved'  then 'approved as a topic'
                               when 'merged'    then 'merged into an existing topic'
                               when 'rejected'  then 'declined'
                               when 'responded' then 'answered privately'
                               else s.status end,
             'reason', null::text)
    from public.opm_sl_inputs s where s.meeting_id = p_id and s.responded_at is not null
  ) q;

  -- 2) audit_log extras (Phase-1 table; probed defensively — never fatal)
  begin
    if to_regclass('public.audit_log') is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
          'at', a.at, 'actor', a.actor_name, 'action', a.action,
          'detail', case a.action
                      when 'opm_save_section'       then 'Meeting notes / sections saved'
                      when 'opm_insights_generate'  then 'AI insights generated'
                      when 'opm_attendance_mark'    then 'Attendance marked'
                      when 'opm_agenda_sensitivity' then 'Topic visibility changed'
                      when 'opm_agenda_edit'        then 'Topic edited'
                      when 'opm_agenda_ack'         then 'Leadership-required topic acknowledged'
                      when 'opm_agenda_recap_toggle' then 'Topic recap flag toggled'
                      when 'opm_action_add'         then 'Action item added'
                      when 'opm_action_done'        then 'Action item completed'
                      when 'opm_action_reopen'      then 'Action item reopened'
                      when 'opm_action_drop'        then 'Action item dropped'
                      else a.action end,
          'reason', a.reason)), '[]'::jsonb)
        into v_extra
      from public.audit_log a
      where a.source_module = 'ops_meeting'
        and a.action in ('opm_save_section','opm_insights_generate','opm_attendance_mark',
                         'opm_agenda_sensitivity','opm_agenda_edit','opm_agenda_ack',
                         'opm_agenda_recap_toggle','opm_action_add','opm_action_done',
                         'opm_action_reopen','opm_action_drop')
        and ( (a.after_value->>'meeting_id') = p_id::text
              or nullif(a.after_value->>'agenda_id','') in
                   (select g.id::text from public.opm_agenda g where g.meeting_id = p_id)
              or nullif(a.after_value->>'action_id','') in
                   (select x.id::text from public.opm_actions x where x.meeting_id = p_id) );
    end if;
  exception when others then v_extra := null; end;

  -- merge + newest-first + cap
  select coalesce(jsonb_agg(t.x order by (t.x->>'at') desc), '[]'::jsonb)
    into v_events
  from (
    select u.x from (
      select jsonb_array_elements(v_events) as x
      union all
      select jsonb_array_elements(coalesce(v_extra, '[]'::jsonb)) as x
    ) u
    order by (u.x->>'at') desc nulls last
    limit 200
  ) t;

  return jsonb_build_object('meeting_id', p_id, 'events', v_events);
end $fn$;


-- ----------------------------------------------------------------------------
-- 4) opm_insights_generate — create or replace. ORIGINAL BODY from
--    ops_meeting.sql preserved verbatim; the ONLY changes are (a) three new
--    declared variables (v_c0, v_c1, v_cnt2) and (b) two new defensive
--    source blocks — marketing (mkt_campaigns) and training (trh_enrollments)
--    — inserted after the follow-up block, before the closing audit call.
-- ----------------------------------------------------------------------------
create or replace function public.opm_insights_generate(
  p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_m public.opm_meetings;
        v_review text; v_r0 date; v_r1 date; v_n int := 0;
        v_sales numeric; v_ly numeric; v_pct numeric; v_labor numeric;
        v_watch numeric; v_swatch numeric; v_cnt numeric; r record;
        v_yv_tbl text; v_rw int; v_rmin int;
        v_c0 date; v_c1 date; v_cnt2 numeric;
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

  -- ---- marketing campaigns (mkt_campaigns; defensive — same style as the
  --      manager_logbook block). Forward-looking: campaigns launching or
  --      running during THE MEETING MONTH itself, filtered to this store
  --      (or Companywide / unscoped campaigns). Suggestion rows only —
  --      nothing reaches shift leaders until the manager approves.
  begin
    if to_regclass('public.mkt_campaigns') is not null then
      v_c0 := (v_m.meeting_month||'-01')::date;
      v_c1 := (v_c0 + interval '1 month')::date;
      for r in
        select c.name, c.status, c.launch_date, c.end_date
        from public.mkt_campaigns c
        where c.archived_at is null
          and coalesce(c.status,'') not ilike '%cancel%'
          and (c.stores ? v_m.location or c.stores ? 'Companywide' or c.stores = '[]'::jsonb)
          and ( (c.launch_date >= v_c0 and c.launch_date < v_c1)
                or (c.launch_date < v_c1 and coalesce(c.end_date, c.launch_date) >= v_c0) )
        order by c.launch_date nulls last, c.name
        limit 4
      loop
        insert into public.opm_insights(meeting_id, source, sensitivity, title, body, meta, created_by)
        values (p_id, 'marketing', 'normal',
          'Marketing: '||r.name
            ||case when r.launch_date >= v_c0 and r.launch_date < v_c1
                   then ' launches '||to_char(r.launch_date,'Mon DD') else ' is running' end,
          'The "'||r.name||'" campaign ('||coalesce(r.status,'planned')||') '
            ||case when r.launch_date >= v_c0 and r.launch_date < v_c1
                   then 'launches '||to_char(r.launch_date,'Mon DD') else 'is running' end
            ||case when r.end_date is not null then ' through '||to_char(r.end_date,'Mon DD') else '' end
            ||' during '||v_m.meeting_month||'. Brief the team on the promo, materials, and what to push.',
          jsonb_build_object('campaign', r.name, 'status', r.status, 'launch_date', r.launch_date,
                             'end_date', r.end_date, 'meeting_month', v_m.meeting_month,
                             'refreshed_at', now(), 'source_table', 'mkt_campaigns'),
          'Cherry (auto)');
        v_n := v_n + 1;
      end loop;
    end if;
  exception when others then null; end;

  -- ---- training (trh_enrollments; defensive). One aggregate themes row per
  --      store: completions during the review month + currently overdue
  --      enrollments. Counts only — no individual employee training records
  --      are surfaced here.
  begin
    if to_regclass('public.trh_enrollments') is not null
       and to_regclass('public.schedule_employees') is not null then
      select count(*) filter (where e.status = 'completed'
                                and e.completed_at >= v_r0 and e.completed_at < v_r1),
             count(*) filter (where e.status = 'active'
                                and e.due_date is not null and e.due_date < current_date)
        into v_cnt, v_cnt2
      from public.trh_enrollments e
      join public.schedule_employees se on se.id = e.employee_id
      left join public.users u on u.username = se.linked_username
      where (coalesce(se.home_location,'') = v_m.location or coalesce(u.store,'') = v_m.location);
      if coalesce(v_cnt,0) > 0 or coalesce(v_cnt2,0) > 0 then
        insert into public.opm_insights(meeting_id, source, sensitivity, title, body, meta, created_by)
        values (p_id, 'training', 'normal',
          'Training: '||coalesce(v_cnt,0)||' completion'||case when coalesce(v_cnt,0)=1 then '' else 's' end
            ||case when coalesce(v_cnt2,0) > 0 then ', '||v_cnt2||' overdue' else '' end,
          'During '||v_review||', '||coalesce(v_cnt,0)||' training path'
            ||case when coalesce(v_cnt,0)=1 then ' was' else 's were' end||' completed at '||v_m.location||'.'
            ||case when coalesce(v_cnt2,0) > 0 then ' '||v_cnt2||' enrollment'
               ||case when v_cnt2=1 then ' is' else 's are' end
               ||' past their due date — worth a recognition + catch-up plan topic.'
               else ' Consider recognizing the completions in the meeting.' end,
          jsonb_build_object('completions', coalesce(v_cnt,0), 'overdue', coalesce(v_cnt2,0),
                             'review_month', v_review, 'refreshed_at', now(),
                             'source_table', 'trh_enrollments'),
          'Cherry (auto)');
        v_n := v_n + 1;
      end if;
    end if;
  exception when others then null; end;

  perform public._opm_audit(v_uid, v_name, 'opm_insights_generate', null, null,
     jsonb_build_object('meeting_id', p_id, 'generated', v_n), null);
  return jsonb_build_object('ok', true, 'generated', v_n);
end $fn$;


-- ============================================================================
-- NEW RPCS: opm_perf_autofill, opm_audit_list
-- NEW HELPERS: _opm_perf_month
-- REPLACED IN PLACE (behavior preserved + marketing/training sources added):
--   opm_insights_generate
--
-- VERIFY (test accounts PIN 1111; replace <meetingId>):
--   select public.opm_perf_autofill('test_admin','1111',<meetingId>);
--   select public.opm_audit_list('test_admin','1111',<meetingId>);
--   select public.opm_insights_generate('test_admin','1111',<meetingId>);
--   select public._opm_perf_month('Roadrunner', (date_trunc('month', current_date) - interval '1 month')::date);
-- ============================================================================
