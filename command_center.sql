-- ============================================================================
-- Caliche's Hub -- STORE INTELLIGENCE COMMAND CENTER (command_center.sql)
-- ADDITIVE ONLY. Read-side module: NO new tables. One new GET RPC
--   app_command_center(p_username,p_password,p_store,p_date) -> ONE jsonb
-- plus two small helpers (_cc_num config reader, _cc_day_json per-day builder)
-- and an app_settings seed for group 'cc_config'.
--
-- READS (existing live objects -- verify columns before applying, see notes):
--   public.store_metrics       (location text, metric_date date, sales, sales_ly,
--                               guest_count, labor_pct, speed_seconds, note, ...
--                               + Axial-sync keys mgr_labor, crew_labor, splh)
--   public.daily_sales         (location, business_date date, gross_sales,
--                               labor_cost, transactions, note)
--   public.daily_sales_detail  (location, sale_date date, net_sales, checks,
--                               labor, cash, card, house)
--   public.app_settings        (skey, sgroup, svalue [, label, sort])
--   public._pp_auth(p_username,p_password) -> (uid, urole, uname)
--
-- RESILIENCE: every table read goes through to_jsonb(row) + ->> key extraction
-- inside its own exception block, so a missing column (e.g. mgr_labor/crew_labor/
-- splh not yet added on prod) or even a missing table yields NULLs and empty
-- states -- it never errors the whole RPC.
--
-- All money/percent math is SERVER-side here (contract rule); the frontend
-- (js/26_command_center.js) only renders what this returns.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- _cc_num : numeric config reader with fallback.
--   select public._cc_num('targets','labor_pct_hi',23)
-- ---------------------------------------------------------------------------
create or replace function public._cc_num(p_group text, p_key text, p_fb numeric)
returns numeric language plpgsql stable security definer set search_path=public,extensions as $fn$
declare v numeric;
begin
  begin
    select svalue::numeric into v
      from public.app_settings
     where skey = p_key and sgroup = p_group
     limit 1;
  exception when others then v := null;
  end;
  return coalesce(v, p_fb);
end $fn$;


-- ---------------------------------------------------------------------------
-- _cc_day_json : one store-day as jsonb. p_t = thresholds jsonb built by the
-- caller (so config is read once per request, not once per day).
-- Returned keys (frontend js/26 reads EXACTLY these):
--   date, dow, sales, sales_ly, ly_pct, labor_cost, labor_pct,
--   mgr_labor, crew_labor, mgr_share, crew_share, splh, guests,
--   speed_seconds, note, has_data,
--   status: { labor, splh, sales, speed }  each 'red'|'amber'|'green'|null
-- ---------------------------------------------------------------------------
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
  if coalesce(v_mgr,0) + coalesce(v_crew,0) > 0 then
    v_mgr_share  := round(coalesce(v_mgr,0)  / (coalesce(v_mgr,0)+coalesce(v_crew,0)) * 100, 1);
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


-- ---------------------------------------------------------------------------
-- app_command_center : THE new GET RPC. Manager/leadership gate.
-- Returns ONE jsonb (top-level keys are exactly what js/26 reads):
--   store, date, targets{labor_pct,labor_pct_lo,labor_pct_hi,splh_target,
--                        speed_target_seconds,ly_warn_pct},
--   today{ _cc_day_json },              -- the p_date day (also last of days[])
--   days[ _cc_day_json x cc_days_back ] -- ascending, window ENDS on p_date
--   week{ days,days_with_data,sales_total,sales_ly_total,ly_pct,
--         labor_pct_wavg,splh_avg,guests_total },
--   generated_at
-- ---------------------------------------------------------------------------
create or replace function public.app_command_center(
  p_username text, p_password text,
  p_store text, p_date text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $fn$
declare
  v_uid bigint; v_role text; v_name text;
  v_day date; v_back int; v_t jsonb;
  v_days jsonb := '[]'::jsonb; d date; dj jsonb;
  s numeric;
  w_n int := 0;
  w_sales numeric := 0;
  w_ly_sales numeric := 0; w_ly_base numeric := 0;   -- only days where BOTH exist
  w_labor numeric := 0; w_labor_sales numeric := 0;  -- weighted labor%
  w_splh_sum numeric := 0; w_splh_n int := 0;
  w_guests numeric := 0;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%') then
    raise exception 'forbidden';
  end if;
  if coalesce(trim(p_store),'') = '' then raise exception 'A store is required.'; end if;

  v_day  := coalesce(nullif(trim(coalesce(p_date,'')),'')::date, current_date);
  v_back := greatest(2, least(31, public._cc_num('cc_config','cc_days_back',7)::int));

  v_t := jsonb_build_object(
    'labor_pct',            public._cc_num('targets','labor_pct',25),
    'labor_pct_lo',         public._cc_num('targets','labor_pct_lo',18),
    'labor_pct_hi',         public._cc_num('targets','labor_pct_hi',23),
    'splh_target',          public._cc_num('cc_config','cc_splh_target',60),
    'speed_target_seconds', public._cc_num('cc_config','cc_speed_target_seconds',240),
    'ly_warn_pct',          public._cc_num('cc_config','cc_ly_warn_pct',-5));

  for d in select generate_series(v_day - (v_back - 1), v_day, interval '1 day')::date loop
    dj := public._cc_day_json(p_store, d, v_t);
    v_days := v_days || dj;
    if coalesce(dj->>'has_data','false') = 'true' then w_n := w_n + 1; end if;
    s := nullif(dj->>'sales','')::numeric;
    w_sales  := w_sales  + coalesce(s, 0);
    w_guests := w_guests + coalesce(nullif(dj->>'guests','')::numeric, 0);
    if s is not null and nullif(dj->>'sales_ly','')::numeric is not null then
      w_ly_sales := w_ly_sales + s;
      w_ly_base  := w_ly_base  + (dj->>'sales_ly')::numeric;
    end if;
    if coalesce(s,0) > 0 and nullif(dj->>'labor_pct','')::numeric is not null then
      w_labor       := w_labor + (dj->>'labor_pct')::numeric * s;
      w_labor_sales := w_labor_sales + s;
    end if;
    if nullif(dj->>'splh','')::numeric is not null then
      w_splh_sum := w_splh_sum + (dj->>'splh')::numeric;
      w_splh_n   := w_splh_n + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'store',   p_store,
    'date',    to_char(v_day, 'YYYY-MM-DD'),
    'targets', v_t,
    'today',   public._cc_day_json(p_store, v_day, v_t),
    'days',    v_days,
    'week', jsonb_build_object(
      'days',            v_back,
      'days_with_data',  w_n,
      'sales_total',     round(w_sales, 2),
      'sales_ly_total',  case when w_ly_base > 0 then round(w_ly_base, 2) end,
      'ly_pct',          case when w_ly_base > 0
                              then round((w_ly_sales - w_ly_base) / w_ly_base * 100, 1) end,
      'labor_pct_wavg',  case when w_labor_sales > 0 then round(w_labor / w_labor_sales, 1) end,
      'splh_avg',        case when w_splh_n > 0 then round(w_splh_sum / w_splh_n, 1) end,
      'guests_total',    w_guests),
    'generated_at', now());
end $fn$;


-- ---------------------------------------------------------------------------
-- CONFIG SEED -- app_settings group 'cc_config' (skey/sgroup/svalue [+label,sort]).
-- Tries the full label/sort insert first; falls back to the 3-column shape;
-- every failure is swallowed (keys can always be added later via
-- app_settings_set through Business Settings).
-- ---------------------------------------------------------------------------
do $seed$
declare
  kv text[][] := array[
    ['cc_splh_target',          '60',  'SPLH green threshold (sales $ per labor hour)', '1'],
    ['cc_speed_target_seconds', '240', 'Speed of service target (seconds)',             '2'],
    ['cc_ly_warn_pct',          '-5',  'Sales vs last year: amber floor % (below = red)','3'],
    ['cc_days_back',            '7',   'Command Center trend window (days)',            '4'],
    ['cc_proj_near_pp',         '2',   'Projected labor: points below target = amber',  '5']
  ];
  i int;
begin
  for i in 1..array_length(kv,1) loop
    begin
      insert into public.app_settings(skey, sgroup, label, svalue, sort)
      select kv[i][1], 'cc_config', kv[i][3], kv[i][2], kv[i][4]::int
      where not exists (select 1 from public.app_settings
                        where skey = kv[i][1] and sgroup = 'cc_config');
    exception when others then
      begin
        insert into public.app_settings(skey, sgroup, svalue)
        select kv[i][1], 'cc_config', kv[i][2]
        where not exists (select 1 from public.app_settings
                          where skey = kv[i][1] and sgroup = 'cc_config');
      exception when others then null;
      end;
    end;
  end loop;
end $seed$;
