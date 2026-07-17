-- ============================================================================
-- SECURITY FIX (2026-07-17) -- payraise_adjust_security_fix.sql -- ADDITIVE ONLY
-- Closes a confidentiality hole found in the pre-launch audit: app_tg_proposal_
-- adjust_list authenticated the caller but never checked their ROLE, so any
-- logged-in employee (any username/password, including regular crew) could call
-- it directly with sequential proposal ids and read every employee's pay-raise
-- adjustment history -- old rate, new rate, reason, who approved it, when.
--
-- This is a `create or replace function` on the exact same function already
-- created in payraise_adjust.sql -- no table changes, no other function
-- touched, nothing else in the app affected. The only caller of this RPC
-- (js/25_payraise_deltas.js) already lives inside an admin-only Pay Tools
-- screen, so this only blocks access that was never supposed to be reachable
-- in the first place.
--
-- HOW TO APPLY: paste this whole file into the Supabase SQL editor for
-- project ikgbihwkqhsfahnswfbz and run it. Safe to run any time; no downtime,
-- no data change.
-- ============================================================================

create or replace function public.app_tg_proposal_adjust_list(
  p_username text, p_password text, p_proposal_id bigint
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $fn$
declare v_uid bigint; v_role text; v_name text;
begin
  select uid,urole,uname into v_uid,v_role,v_name from public._pp_auth(p_username,p_password);
  if v_uid is null then raise exception 'forbidden'; end if;

  -- FIX: was missing entirely -- any authenticated user could read anyone's
  -- pay-adjustment history. Matches the same corporate-only gate already used
  -- by the sibling report functions in this module (app_tg_report_*).
  if not public._tg_is_corp(v_role) then
    raise exception 'forbidden';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(a) order by a.adjusted_at desc)
    from public.tg_pay_proposal_adjustments a where a.proposal_id = p_proposal_id
  ), '[]'::jsonb);
end $fn$;
