-- Axial -> Hub per-employee hours sync.
-- Adds a mapping column (schedule_employees.axial_employee_id) and a daily hours table,
-- plus two RPCs: app_employee_hours_sync (the Axial sync step calls this to upsert hours,
-- auto-linking unmapped employees by exact name match when unambiguous) and
-- app_employee_hours_for_roster (the roster UI reads per-employee totals from this).
-- Additive, idempotent, safe -- mirrors store_metrics_labor_extra.sql's pattern.

alter table public.schedule_employees add column if not exists axial_employee_id uuid;
create unique index if not exists schedule_employees_axial_id_uidx
  on public.schedule_employees(axial_employee_id) where axial_employee_id is not null;

create table if not exists public.employee_hours_daily (
  id bigserial primary key,
  employee_id bigint not null references public.schedule_employees(id) on delete cascade,
  location text,
  work_date date not null,
  hours numeric not null default 0,
  labor_cost numeric,
  source text not null default 'axial',
  synced_at timestamptz not null default now(),
  unique(employee_id, work_date)
);
create index if not exists employee_hours_daily_date_idx on public.employee_hours_daily(work_date);

-- Sync entrypoint: upserts a batch of {axial_id, axial_name, location, work_date, hours, labor_cost}.
-- Auto-links schedule_employees.axial_employee_id by exact case-insensitive name match
-- WITHIN the same home_location, but only when the match is unambiguous (exactly one
-- unmapped candidate). Rows that can't be matched are returned in `unmatched` for manual review.
create or replace function public.app_employee_hours_sync(
  p_username text, p_password text, p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $fn$
declare
  v_uid bigint; v_role text; v_name text;
  r record;
  v_emp_id bigint;
  v_upserted int := 0;
  v_unmatched jsonb := '[]'::jsonb;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%' or v_role ilike '%office%') then
    raise exception 'forbidden'; end if;

  for r in select * from jsonb_to_recordset(p_rows) as x(
      axial_id uuid, axial_name text, location text, work_date date,
      hours numeric, labor_cost numeric)
  loop
    -- already mapped?
    select id into v_emp_id from public.schedule_employees where axial_employee_id = r.axial_id;

    if v_emp_id is null then
      -- try an unambiguous exact-name match among unmapped employees at the same store
      if (select count(*) from public.schedule_employees
           where axial_employee_id is null
             and lower(trim(name)) = lower(trim(r.axial_name))
             and (r.location is null or home_location ilike r.location)) = 1
      then
        select id into v_emp_id from public.schedule_employees
         where axial_employee_id is null
           and lower(trim(name)) = lower(trim(r.axial_name))
           and (r.location is null or home_location ilike r.location);
        update public.schedule_employees set axial_employee_id = r.axial_id where id = v_emp_id;
      end if;
    end if;

    if v_emp_id is null then
      v_unmatched := v_unmatched || jsonb_build_object('axial_id',r.axial_id,'axial_name',r.axial_name,'work_date',r.work_date);
      continue;
    end if;

    insert into public.employee_hours_daily(employee_id, location, work_date, hours, labor_cost, source, synced_at)
    values (v_emp_id, r.location, r.work_date, coalesce(r.hours,0), r.labor_cost, 'axial', now())
    on conflict (employee_id, work_date) do update
      set hours = excluded.hours, labor_cost = excluded.labor_cost,
          location = excluded.location, synced_at = now();
    v_upserted := v_upserted + 1;
  end loop;

  return jsonb_build_object('ok',true,'upserted',v_upserted,'unmatched',v_unmatched);
end $fn$;

-- Roster read: per-employee total hours over a date range (caller passes explicit dates;
-- defaults only cover an ad-hoc call with no args).
create or replace function public.app_employee_hours_for_roster(
  p_username text, p_password text,
  p_start_date date default current_date,
  p_end_date date default current_date
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $fn$
declare v_uid bigint; v_role text; v_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('employee_id',employee_id,'hours',total_hours))
    from (
      select employee_id, round(sum(hours),2) as total_hours
      from public.employee_hours_daily
      where work_date between p_start_date and p_end_date
      group by employee_id
    ) t
  ), '[]'::jsonb);
end $fn$;
