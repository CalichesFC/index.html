-- ============================================================================
-- CATERING RECEIPT + MANUAL MARK-PAID  (catering_receipt.sql)  -- ADDITIVE ONLY
-- Pairs with the catering invoice card in js/11_customer_history_autosuggest.js.
--
-- WHY: Square pay-links settle as an Order/Payment. The automatic paid-status
-- webhook (square-webhook) is deployed but currently fails closed because the
-- SQUARE_WEBHOOK_SIGNATURE_KEY secret is not set, so nothing is ever auto-marked
-- Paid. This gives managers a manual "Mark Paid" path that works TODAY and a
-- printable receipt, independent of the webhook. When the signature key is set,
-- the webhook path (app_quote_mark_paid_by_square) keeps working unchanged.
-- ============================================================================

alter table public.quotes add column if not exists payment_method    text;
alter table public.quotes add column if not exists payment_reference  text;

-- Manual mark-paid: manager/office only. Idempotent on paid_at (coalesce), so
-- re-marking never overwrites the original paid timestamp. Defaults amount to
-- the quote total when not supplied.
create or replace function public.app_quote_mark_paid_manual(
  p_username  text,
  p_password  text,
  p_id        bigint,
  p_amount    numeric default null,
  p_method    text    default 'Manual',
  p_reference text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  -- v_uid is bigint (matches _pp_auth's real uid type) -- was uuid, which made
  -- every call fail on the auth line before it ever reached the update below.
  v_uid bigint; v_role text; v_name text;
  v_row public.quotes;
begin
  select uid, urole, uname into v_uid, v_role, v_name
    from public._pp_auth(p_username, p_password);
  if v_uid is null then raise exception 'forbidden'; end if;
  if not (v_role ilike '%manager%' or v_role ilike '%admin%' or v_role ilike '%lead%'
          or v_role ilike '%owner%' or v_role ilike '%VP%' or v_role ilike '%office%') then
    raise exception 'forbidden';
  end if;

  update public.quotes
     set paid_at           = coalesce(paid_at, now()),
         invoice_status    = 'Paid',
         amount_paid       = coalesce(p_amount, amount_paid, total),
         payment_method    = coalesce(p_method, 'Manual'),
         payment_reference = p_reference
   where id = p_id
   returning * into v_row;

  if v_row.id is null then raise exception 'quote not found'; end if;

  begin
    perform public._pp_audit(v_uid, v_name, 'quote_mark_paid_manual', null,
      null, jsonb_build_object('quote_id',p_id,'amount',v_row.amount_paid,'method',p_method,'reference',p_reference),
      'Manual payment recorded');
  exception when others then null; end;

  return jsonb_build_object(
    'id', v_row.id, 'invoice_status', v_row.invoice_status,
    'paid_at', v_row.paid_at, 'amount_paid', v_row.amount_paid,
    'payment_method', v_row.payment_method, 'payment_reference', v_row.payment_reference,
    'invoice_number', v_row.invoice_number
  );
end $fn$;
