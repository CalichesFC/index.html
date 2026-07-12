-- Store Intelligence: persist the Axial labor split + sales-per-labor-hour on store_metrics.
-- app_metrics_save is static (fixed columns) and drops unknown json keys, so mgr_labor/
-- crew_labor/splh were being lost. This adds the columns + a tiny companion save RPC the
-- Axial sync calls after app_metrics_save. Additive, safe.
alter table public.store_metrics add column if not exists mgr_labor  numeric;
alter table public.store_metrics add column if not exists crew_labor numeric;
alter table public.store_metrics add column if not exists splh       numeric;

create or replace function public.app_metrics_labor_extra(
  p_username text, p_password text, p_location text, p_date date,
  p_mgr_labor numeric default null, p_crew_labor numeric default null, p_splh numeric default null
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $fn$
declare v_uid uuid; v_role text; v_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%' or v_role ilike '%office%') then
    raise exception 'forbidden'; end if;
  update public.store_metrics
     set mgr_labor=coalesce(p_mgr_labor,mgr_labor),
         crew_labor=coalesce(p_crew_labor,crew_labor),
         splh=coalesce(p_splh,splh),
         updated_at=now()
   where location=p_location and metric_date=p_date;
  return jsonb_build_object('ok',true,'location',p_location,'date',p_date);
end $fn$;
