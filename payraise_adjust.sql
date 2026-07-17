-- ============================================================================
-- ADJUST APPROVED RAISE  (payraise_adjust.sql)  -- ADDITIVE ONLY
-- Lets leadership amend / reverse / supersede an ALREADY-APPROVED pay proposal
-- and keeps a full history. Additive to the existing tg_pay_proposals flow.
-- NOTE: this changes the Hub RECORD only; the actual pay rate must still be
-- keyed into Aloha (the payroll source of truth). Surfaced in Pay Tools (js/25).
-- ============================================================================

create table if not exists public.tg_pay_proposal_adjustments (
  id                  bigint generated always as identity primary key,
  proposal_id         bigint not null,
  action              text   not null,            -- 'amend' | 'reverse' | 'supersede'
  old_rate            numeric,
  new_rate            numeric,
  old_effective_date  date,
  new_effective_date  date,
  reason              text,
  adjusted_by         bigint,
  adjusted_by_name    text,
  adjusted_at         timestamptz not null default now()
);
alter table public.tg_pay_proposal_adjustments enable row level security;
create index if not exists tg_pp_adj_prop_idx on public.tg_pay_proposal_adjustments(proposal_id);
-- NOTE (2026-07-14): adjusted_by was originally uuid, matching a v_uid uuid bug in
-- both functions below -- _pp_auth's uid is actually bigint, so app_tg_proposal_adjust
-- failed on its very first line every time it was called and never inserted a row
-- here. Column changed to bigint (table had zero rows, so this is a no-op cast) and
-- both functions below fixed to declare v_uid bigint.
alter table public.tg_pay_proposal_adjustments alter column adjusted_by type bigint using adjusted_by::text::bigint;

-- Adjust an approved raise. Manager/corporate only. Only works once the proposal
-- has been approved (corporate_decision approved, or payroll processed, or status
-- says approved). Records the change and updates the live record accordingly.
create or replace function public.app_tg_proposal_adjust(
  p_username text, p_password text,
  p_proposal_id bigint,
  p_action text,                                  -- amend | reverse | supersede
  p_new_rate numeric default null,
  p_new_effective_date date default null,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $fn$
declare
  v_uid bigint; v_role text; v_name text;
  v_p public.tg_pay_proposals;
  v_approved boolean;
  v_act text := lower(coalesce(p_action,'amend'));
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%owner%'
          or v_role ilike '%VP%' or v_role ilike '%office%' or v_role ilike '%corp%') then
    raise exception 'forbidden';
  end if;

  select * into v_p from public.tg_pay_proposals where id = p_proposal_id;
  if v_p.id is null then raise exception 'proposal not found'; end if;

  v_approved := (coalesce(v_p.corporate_decision,'') ilike '%approv%')
             or (v_p.payroll_processed_at is not null)
             or (coalesce(v_p.status,'') ilike '%approv%')
             or (coalesce(v_p.status,'') ilike '%payroll%');
  if not v_approved then
    raise exception 'This raise is not approved yet — edit the proposal instead of adjusting it.';
  end if;
  if v_act not in ('amend','reverse','supersede') then raise exception 'bad action'; end if;

  insert into public.tg_pay_proposal_adjustments(
    proposal_id, action, old_rate, new_rate, old_effective_date, new_effective_date,
    reason, adjusted_by, adjusted_by_name)
  values (
    p_proposal_id, v_act, v_p.proposed_rate,
    case when v_act='reverse' then v_p.current_rate else coalesce(p_new_rate, v_p.proposed_rate) end,
    coalesce(v_p.effective_date, v_p.proposed_effective_date),
    case when v_act='reverse' then null else coalesce(p_new_effective_date, v_p.effective_date, v_p.proposed_effective_date) end,
    p_reason, v_uid, v_name);

  if v_act = 'reverse' then
    update public.tg_pay_proposals
       set status = 'Reversed',
           notes  = trim(both from coalesce(notes,'') || ' | REVERSED ' || to_char(now(),'YYYY-MM-DD') || ': ' || coalesce(p_reason,''))
     where id = p_proposal_id returning * into v_p;
  else  -- amend or supersede: move the live rate/date
    update public.tg_pay_proposals
       set proposed_rate = coalesce(p_new_rate, proposed_rate),
           effective_date = coalesce(p_new_effective_date, effective_date, proposed_effective_date),
           proposed_effective_date = coalesce(p_new_effective_date, proposed_effective_date, effective_date),
           status = case when v_act='supersede' then 'Superseded-Active' else coalesce(status,'Approved') end,
           notes  = trim(both from coalesce(notes,'') || ' | ' || upper(v_act) || ' ' || to_char(now(),'YYYY-MM-DD') || ': ' || coalesce(p_reason,''))
     where id = p_proposal_id returning * into v_p;
  end if;

  begin
    perform public._pp_audit(v_uid, v_name, 'tg_proposal_adjust', v_p.employee_id, null,
      jsonb_build_object('proposal_id',p_proposal_id,'action',v_act,'new_rate',p_new_rate,'new_effective_date',p_new_effective_date),
      coalesce(p_reason,''));
  exception when others then null; end;

  return jsonb_build_object('id', v_p.id, 'action', v_act, 'status', v_p.status,
    'proposed_rate', v_p.proposed_rate, 'effective_date', coalesce(v_p.effective_date, v_p.proposed_effective_date),
    'reminder', 'Enter the new rate in Aloha to make it effective on payroll.');
end $fn$;

-- History for a proposal (newest first).
create or replace function public.app_tg_proposal_adjust_list(
  p_username text, p_password text, p_proposal_id bigint
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $fn$
declare v_uid bigint; v_role text; v_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(a) order by a.adjusted_at desc)
    from public.tg_pay_proposal_adjustments a where a.proposal_id = p_proposal_id
  ), '[]'::jsonb);
end $fn$;
