-- Caliche's Hub — Square pay-link regen guard (2026-07-13). Idempotent.
-- Adds the column the updated square-invoice Edge Function uses to know what
-- amount the current pay link was minted for, so changing a quote's total
-- automatically mints a fresh link instead of returning the stale one.
alter table public.quotes add column if not exists square_link_amount integer;
comment on column public.quotes.square_link_amount is
  'Cents the current square_payment_url was minted for; square-invoice regenerates the link when the quote total differs.';
