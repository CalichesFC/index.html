-- =====================================================================
-- Daily Store Report — FINISH pass (additive, create-or-replace only)
-- 1) dsr_submit now settles day totals into store_metrics WHEN an admin
--    turns it on via config dsr_sales_source_mode = 'dsr_writes' (default
--    'off' — dormant until an admin opts in, so no double-counting).
-- 2) dsr_dashboard — leadership rollup for a date range.
-- Everything it reads is admin-adjustable via app_settings group 'dsr_config'.
-- =====================================================================

create or replace function public.dsr_submit(p_username text, p_password text, p_id bigint)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_name text; v_val jsonb;
        v_mode text; v_loc text; v_bd date; v_day_sales numeric; v_labor numeric;
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

  -- Admin-controlled sales-source settle. Off by default.
  v_mode := public._dsr_cfg_text('dsr_sales_source_mode', 'off');
  if v_mode = 'dsr_writes' then
    begin
      select location, business_date into v_loc, v_bd from public.dsr_report where id = p_id;
      -- combined day sales = end-of-day running net tape (night) else 5:00 tape
      select coalesce(
        (select net_tape_total from public.dsr_closeout where report_id = p_id and closeout_type = 'night'),
        (select tape_total     from public.dsr_closeout where report_id = p_id and closeout_type = 'five'),
        0) into v_day_sales;
      select daily_labor_pct into v_labor from public.dsr_labor where report_id = p_id;
      perform public.app_metrics_save(p_username, p_password, v_loc, v_bd,
        jsonb_build_object('sales', v_day_sales)
        || (case when v_labor is not null then jsonb_build_object('labor_pct', v_labor) else '{}'::jsonb end));
      perform public._dsr_audit(p_id, v_uid, v_name, 'settle:store_metrics', 'sales', null, v_day_sales::text, 'sales_source_mode=dsr_writes');
    exception when others then
      -- never block a submit because the optional settle failed
      perform public._dsr_audit(p_id, v_uid, v_name, 'settle_failed', null, null, null, SQLERRM);
    end;
  end if;

  return jsonb_build_object('ok', true, 'report', (select to_jsonb(r.*) from public.dsr_report r where r.id = p_id));
end $fn$;

-- Leadership rollup for a date range (managers+).
create or replace function public.dsr_dashboard(p_username text, p_password text, p_filters jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare v_uid bigint; v_role text; v_from date; v_to date; v_loc text; v_rows jsonb; v_summary jsonb;
begin
  select uid,urole into v_uid,v_role from public._dsr_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not public._dsr_is_mgr(v_role) then raise exception 'forbidden'; end if;

  v_loc  := nullif(coalesce(p_filters,'{}'::jsonb)->>'location','');
  v_from := coalesce(nullif(p_filters->>'from','')::date, current_date - 6);
  v_to   := coalesce(nullif(p_filters->>'to','')::date, current_date);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'location', r.location, 'business_date', r.business_date, 'status', r.status,
      'submitted_at', r.submitted_at,
      'over_short_total', (select sum(c.over_short) from public.dsr_closeout c where c.report_id = r.id),
      'labor_pct', (select l.daily_labor_pct from public.dsr_labor l where l.report_id = r.id),
      'avg_rating', (select round(avg(v)::numeric,1) from (
                       select unnest(array_remove(array[rt.am_score, rt.pm_score], null)) v
                       from public.dsr_rating rt where rt.report_id = r.id) s)
    ) order by r.business_date desc, r.location), '[]'::jsonb)
  into v_rows
  from public.dsr_report r
  where r.business_date between v_from and v_to and (v_loc is null or r.location = v_loc);

  select jsonb_build_object(
      'total', count(*),
      'submitted', count(*) filter (where status in ('submitted','reviewed','locked')),
      'reviewed', count(*) filter (where status in ('reviewed','locked')),
      'in_progress', count(*) filter (where status not in ('submitted','reviewed','locked'))
    ) into v_summary
  from public.dsr_report
  where business_date between v_from and v_to and (v_loc is null or location = v_loc);

  return jsonb_build_object('from', v_from, 'to', v_to, 'location', v_loc, 'rows', v_rows, 'summary', v_summary);
end $fn$;

-- NEW RPCS: dsr_dashboard (dsr_submit replaced in place)
-- VERIFY: select public.dsr_dashboard('test_admin','1111','{}'::jsonb);
