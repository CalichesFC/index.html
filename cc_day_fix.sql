create or replace function public._cc_day_json(p_store text, p_day date, p_t jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $fn$
declare
  m  jsonb; ds jsonb; dd jsonb;
  v_sales numeric; v_sales_ly numeric; v_ly_pct numeric;
  v_labor_cost numeric; v_labor_pct numeric;
  v_mgr numeric; v_crew numeric; v_mgr_share numeric; v_crew_share numeric;
  v_splh numeric; v_guests numeric; v_speed numeric;
  st_labor text; st_splh text; st_sales text; st_speed text;
  t_lo    numeric := coalesce((p_t->>'labor_pct_lo')::numeric, 18);
  t_hi    numeric := coalesce((p_t->>'labor_pct_hi')::numeric, 23);
  t_splh  numeric := coalesce((p_t->>'splh_target')::numeric, 60);
  t_speed numeric := coalesce((p_t->>'speed_target_seconds')::numeric, 240);
  t_lyw   numeric := coalesce((p_t->>'ly_warn_pct')::numeric, -5);
begin
  -- each read isolated: missing table/column can never break the response
  begin
    select to_jsonb(x) into m from public.store_metrics x
     where x.location = p_store and x.metric_date = p_day limit 1;
  exception when others then m := null; end;
  begin
    select to_jsonb(x) into ds from public.daily_sales x
     where x.location = p_store and x.business_date = p_day limit 1;
  exception when others then ds := null; end;
  begin
    select to_jsonb(x) into dd from public.daily_sales_detail x
     where x.location = p_store and x.sale_date = p_day limit 1;
  exception when others then dd := null; end;

  -- sales: scorecard first (Axial-synced), then detail net, then lumped gross
  v_sales      := coalesce(nullif(m->>'sales','')::numeric,
                           nullif(dd->>'net_sales','')::numeric,
                           nullif(ds->>'gross_sales','')::numeric);
  v_sales_ly   := nullif(m->>'sales_ly','')::numeric;
  if v_sales is not null and coalesce(v_sales_ly,0) > 0 then
    v_ly_pct := round((v_sales - v_sales_ly) / v_sales_ly * 100, 1);
  end if;

  -- TRUE labor (incl. management): prefer the synced labor_pct (Axial "Total
  -- Labor incl. management"); else derive from labor dollars / sales
  v_labor_cost := coalesce(nullif(ds->>'labor_cost','')::numeric,
                           nullif(dd->>'labor','')::numeric);
  v_labor_pct  := coalesce(nullif(m->>'labor_pct','')::numeric,
                           case when coalesce(v_sales,0) > 0 and v_labor_cost is not null
                                then round(v_labor_cost / v_sales * 100, 1) end);

  -- crew vs management split (Axial-sync keys; null-safe if columns absent)
  v_mgr  := nullif(m->>'mgr_labor','')::numeric;
  v_crew := nullif(m->>'crew_labor','')::numeric;
  -- Only show a manager/crew split when there is REAL, separate manager-job labor.
  -- At Caliche's everyone (crew, shift-leaders, store managers) clocks under one job
  -- ("Runner"), so management labor is already inside labor_cost/labor_pct and there is
  -- no separate figure to split out. Requiring v_mgr>0 prevents a misleading "Manager 0%".
  if coalesce(v_mgr,0) > 0 and coalesce(v_crew,0) > 0 then
    v_mgr_share  := round(v_mgr / (v_mgr + v_crew) * 100, 1);
    v_crew_share := round(100 - v_mgr_share, 1);
  end if;

  v_splh   := nullif(m->>'splh','')::numeric;   -- sales per labor hour (Axial)
  v_guests := coalesce(nullif(m->>'guest_count','')::numeric,
                       nullif(ds->>'transactions','')::numeric,
                       nullif(dd->>'checks','')::numeric);
  v_speed  := nullif(m->>'speed_seconds','')::numeric;

  -- RED / AMBER / GREEN statuses vs the config thresholds (server-authoritative)
  if v_labor_pct is not null then
    st_labor := case when v_labor_pct > t_hi then 'red'
                     when v_labor_pct < t_lo then 'amber'   -- suspiciously low = understaffed risk
                     else 'green' end;
  end if;
  if v_splh is not null then
    st_splh := case when v_splh >= t_splh then 'green'
                    when v_splh >= t_splh * 0.85 then 'amber'
                    else 'red' end;
  end if;
  if v_ly_pct is not null then
    st_sales := case when v_ly_pct >= 0 then 'green'
                     when v_ly_pct >= t_lyw then 'amber'
                     else 'red' end;
  end if;
  if v_speed is not null then
    st_speed := case when v_speed <= t_speed then 'green'
                     when v_speed <= t_speed * 1.25 then 'amber'
                     else 'red' end;
  end if;

  return jsonb_build_object(
    'date',          to_char(p_day, 'YYYY-MM-DD'),
    'dow',           trim(to_char(p_day, 'Dy')),
    'sales',         v_sales,
    'sales_ly',      v_sales_ly,
    'ly_pct',        v_ly_pct,
    'labor_cost',    v_labor_cost,
    'labor_pct',     v_labor_pct,
    'mgr_labor',     v_mgr,
    'crew_labor',    v_crew,
    'mgr_share',     v_mgr_share,
    'crew_share',    v_crew_share,
    'splh',          v_splh,
    'guests',        v_guests,
    'speed_seconds', v_speed,
    'note',          m->>'note',
    'has_data',      (m is not null or ds is not null or dd is not null),
    'status',        jsonb_build_object('labor', st_labor, 'splh', st_splh,
                                        'sales', st_sales, 'speed', st_speed)
  );
end $fn$;