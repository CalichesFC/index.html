# Audit — Catering Invoices, Square Payments & Receipt Visibility

**Auditor:** Cowork agent (read-only investigation) · **Date:** 2026-07-17
**Scope:** Catering Pipeline / Create Catering Quote / quote→accept→invoice→pay flow, the two Square Edge Functions, receipt visibility for staff, and the related Fundraiser Hub.
**Method:** Code + SQL + docs read directly; network reachability probed where possible. **No payment (sandbox or real) was attempted. No file changed except this report.**

---

## Top-line verdict

> ## Square payments appear to be: **NOT CONFIGURED FOR PRODUCTION** — and this needs a Supabase dashboard check to confirm the exact secret state.
>
> More precisely, from code + the repo's own recent notes:
> - The full Square code path (create pay link → customer pays on Square's hosted checkout → webhook flips the quote to **Paid**) **is fully built and the webhook is deployed and reachable.**
> - **But the "go-live" secrets are documented as NOT set.** The webhook `square-webhook` **fails closed** without its signature key, so **nothing is ever auto-marked Paid.** And the pay-link creator needs `SQUARE_ACCESS_TOKEN`; if that is unset, **no pay link is ever created and customers have no way to pay online.**
> - The repo's own status file (`OPEN_ITEMS_Aaron_Adri.md`, updated 2026-07-13 — 4 days ago) lists **"Square production token + webhook signature key"** as an **unchecked, still-open owner task**, with the note *"Until then the manual **Mark Paid** button works."*
>
> **Plain-English answer to Issac's question:** As best I can tell from the code and the most recent internal notes, the catering invoices are **not currently taking real (production) card payments automatically.** A staff member can still record a payment by hand (the **Mark Paid** button), and once a quote is marked Paid **there IS a printable receipt inside the Hub** (the **Receipt** button). What I *cannot* see from code is the live value of the Square secrets — that's the one thing only the Supabase **Edge Functions → Secrets** page can confirm. See "Open questions" at the end for exactly what to check.

**Why "cannot fully determine from code alone":** Supabase secret *values* are not exposed by any API I can reach. I inferred the state from (a) the code's fail-closed behavior, (b) four separate current repo docs that all say the secrets are unset, and (c) a network probe. The dashboard is the authority.

---

## What I verified in code (so the verdict is grounded, not guessed)

**Full lifecycle traced end-to-end:**

1. **Create quote** — `submitQuote()` (`js/11_customer_history_autosuggest.js:95`) → `app_quote_create` → returns `accept_token` → "Copy Customer Acceptance Link" (`?accept=<token>`).
2. **Customer accept page** — `?accept=` → `checkQuoteAcceptRoute()` (`js/02_on_load.js:116`) → `app_quote_get_by_token` → "Accept This Quote" → `acceptQuote()` → `app_quote_accept_by_token` (sets `Accepted`), then **auto-fires** `autoSendSquareInvoice()` (`js/02_on_load.js:138,145`).
3. **Pay link creation** — `autoSendSquareInvoice()` / admin `sendSquareInvoice()` (`js/02_on_load.js:234`) call `supabaseClient.functions.invoke('square-invoice', {body:{token}})`. The edge function (`edge-functions/square-invoice.ts`) creates a Square **online payment link** (`quick_pay` hosted checkout) for the exact total and writes `square_payment_url`, `square_order_id`, `square_invoice_id`, `square_link_amount`, `invoice_status='PayLinkReady'` onto the quote (`square-invoice.ts:127-150`).
4. **Public invoice page** — `?invoice=` → `checkInvoiceRoute()` (`js/02_on_load.js:261`) → `app_quote_invoice_get_by_token` + `app_quote_payment_status` → renders the invoice with a **"Pay Now with Square"** button when `square_payment_url` is present, or a green **Paid** badge when paid (`buildInvoiceHtml`, `js/02_on_load.js:184-186`). The page **polls `app_quote_payment_status` every 20s** to live-flip to Paid (`startInvoicePoll`, `js/02_on_load.js:281`).
5. **Payment heard** — Square calls `square-webhook` (`edge-functions/square-webhook.ts`) → verifies HMAC signature → `app_quote_mark_paid_by_square` sets `invoice_status='Paid'`, `paid_at`, `amount_paid` (`square_invoice_migration.sql:54-75`). It matches on **`square_invoice_id` OR `square_order_id`** (payment-link payments arrive keyed by order id) — correctly handled (`square-webhook.ts:99-106`, `square_invoice_migration.sql:70-71`).
6. **Hub reflects Paid** — pipeline card shows `💳 Paid on <date>` and a **Receipt** button (`js/11...:379,393`); the public invoice page flips to Paid via the poll.

**Config behavior confirmed by reading the actual code:**
- **`SQUARE_ENV` defaults to `sandbox`** if the secret is unset: `const SQUARE_ENV = (Deno.env.get("SQUARE_ENV") || "sandbox").toLowerCase();` and the base URL is the **sandbox** host unless it equals `production` (`square-invoice.ts:44-47`). So an unset env → the function talks to Square **sandbox** (fake money).
- **Missing `SQUARE_ACCESS_TOKEN`** → `square-invoice` returns `{ok:false, error:"SQUARE_ACCESS_TOKEN not set"}` (HTTP 200) and creates no link (`square-invoice.ts:97`). The admin "Create Pay Link" button surfaces this as an alert, **but the customer-accept auto-fire swallows the error to the console only** (`js/02_on_load.js:150-151`) — so on the customer path it fails **silently** (no link, no visible error).
- **Missing `SQUARE_WEBHOOK_SIGNATURE_KEY` / `SQUARE_WEBHOOK_URL`** → `square-webhook` **fails closed**: logs `"rejected: ... not set"` and returns `401` (`square-webhook.ts:42-46,78-80`). No unverified request can ever mark a quote paid. Good security posture; also means no auto-Paid until the secrets exist.

**Idempotency fix — CONFIRMED present in code (not just a comment):**
`idempotency_key: \`plink-${q.id}-${crypto.randomUUID()}\`` (`square-invoice.ts:128`). The old fixed `plink-<id>` key that caused the July "400 idempotency key already used" permanent block is gone; the key is now unique per attempt, and the real duplicate guard is the DB check "already has a link for this amount → return it" (`square-invoice.ts:114-117`). This also correctly **regenerates** the link if the quote total changed (`square_link_amount` guard, added by `supabase_step1_square_link_amount.sql`).

**Network reachability probe (what I could and couldn't determine):**
- Workspace shell has **no outbound network** (proxy returns `403` on CONNECT), so `curl` tests were impossible.
- Via the fetch tool (GET only, no custom headers): **`square-webhook` is DEPLOYED and reachable** — a raw unauthenticated GET returns `ok` (text/plain), which exactly matches its code (`if (req.method !== "POST") return new Response("ok", 200)`), confirming it is live **with JWT verification OFF** as required.
- **`square-invoice` deployment could NOT be confirmed** from my position: the fetch tool collapses a 401 (deployed-but-JWT-gated) and a 404 (not deployed) to the same empty response — a known-nonexistent function name and the known-deployed `send-push` both returned identically empty. Given the two functions are deployed together per the setup checklist and the webhook is confirmed live, `square-invoice` is *probably* deployed too, but I am flagging this as **unconfirmed**, not asserting it.
- **I cannot read secret values** by any means available to me.

---

## Blockers

**B1 — Square is not taking automatic payments; go-live secrets are unset (per code + 4 corroborating current docs). [Blocker]**
The webhook fails closed without `SQUARE_WEBHOOK_SIGNATURE_KEY`, so quotes never auto-flip to Paid; and without a production `SQUARE_ACCESS_TOKEN` + `SQUARE_ENV=production`, no real pay link is created. Evidence:
- `catering_receipt.sql:5-10` — *"the automatic paid-status webhook (square-webhook) is deployed but currently fails closed because the `SQUARE_WEBHOOK_SIGNATURE_KEY` secret is not set, so nothing is ever auto-marked Paid."*
- `OPEN_ITEMS_Aaron_Adri.md:6` — unchecked `- [ ]` **"Square production token + webhook signature key … Until then the manual Mark Paid button works."** (file header: everything not under "Still open" is live.)
- `DEPLOY_STEPS_2026-07-13.md:41` and `MASTER_CHECKLIST.md:17` — both list the Square token/webhook secret as an outstanding owner item.
**Impact:** if a customer today opened a catering invoice, either (a) there is no Pay Now button at all (token unset), or (b) they could pay but the Hub would never know it was paid (webhook key unset). Real-money capture + auto-status is not live.
**Fix (owner-only, no code):** follow `SQUARE_INVOICE_SETUP.md` section H — set `SQUARE_ACCESS_TOKEN`=production token, `SQUARE_ENV=production`, register a production webhook (events `payment.updated`, `payment.created`, `invoice.payment_made`, `invoice.updated`), and put its Signature Key + exact URL into the two webhook secrets.

---

## High-priority issues

**H1 — Silent failure on the customer accept path. [High]**
When a customer accepts a quote, `autoSendSquareInvoice()` invokes `square-invoice`; if the token/secret is missing or Square errors, the failure is only `console.error`'d (`js/02_on_load.js:150-151`). The customer sees an accepted quote with **no pay link and no error**, and no staff alert is raised. Combined with B1, a customer could accept and simply have no way to pay, with nobody notified. Recommend surfacing a manager notification (or a "pay link pending" flag on the pipeline card) when the auto-fire fails.

**H2 — "Paid" via the manual button is an honor-system record, not verified proof. [High]**
Because the webhook isn't firing (B1), the only way a quote reaches Paid today is the manual **Mark Paid** button (`markQuotePaid`, `js/11...:1063`), which prompts a human for amount/method/reference and calls `app_quote_mark_paid_manual` (`catering_receipt.sql:19-68`). That's a reasonable stopgap (and correctly role-gated to manager/admin/lead/owner/office), but the resulting "receipt" reflects **typed-in** data, not a confirmed Square transaction. Once the webhook is live, real payments will auto-populate `amount_paid`/`paid_at`, but the Hub still won't capture Square's own payment id / receipt URL / card brand+last4 (see idea C3).

**H3 — After Mark Paid, the pipeline doesn't auto-refresh (dead function reference). [Medium-High]**
`markQuotePaid` finishes by calling `loadSalesPipeline()` or `searchCustomerHistory()` (`js/11...:1078-1079`) — **neither function exists anywhere in the codebase.** The real refresh function is `fetchSalesPipeline()` (`js/11...:288`). The DB update succeeds, but the manager must manually reload/re-open the pipeline to see the Paid badge and the new **Receipt** button. Low-risk one-line fix (call `fetchSalesPipeline()`), but user-visible.

---

## Missing / incomplete features — including the receipt-visibility question

**Receipt visibility — ANSWERED: yes, a manager-facing receipt exists in the Hub, with caveats.**
- The pipeline card shows a **Receipt** button on any quote where `invoice_status==='Paid'` (`js/11...:393`). It opens `showQuoteReceipt()` (`js/11...:1084-1128`), a proper **"PAID RECEIPT"** modal showing: business header, invoice/quote number, **customer**, **event date/type**, **paid date**, **payment method**, **payment reference**, itemized lines, **subtotal**, **tax**, and **Amount Paid**, with a **Print / Save PDF** button. This directly satisfies Issac's ask ("I need the receipts to be available on the hub") — for quotes that are marked Paid.
- **Caveats / gaps:**
  1. **Only reachable per-quote, after Paid.** There is no central "Payments" or "Receipts" ledger — a manager must find the specific paid quote in the pipeline and click Receipt. No at-a-glance list of what's been paid, when, how much.
  2. **Receipt detail depends on columns I can't verify.** `showQuoteReceipt` reads `amount_paid`, `payment_method`, `payment_reference`, `subtotal`, `tax` from the pipeline row cache, which is populated by `app_quote_admin_list`. That RPC's SQL is **not in the repo** (deployed straight to the DB), so I could not confirm it returns those fields. The card already renders the Paid badge, so it returns `invoice_status`/`paid_at`; but if it doesn't also return `amount_paid`/`payment_method`/`payment_reference`, the receipt will show a correct total (it falls back to `q.total`) but **blank method/reference**. Worth a 1-minute DB check (see Open questions).
  3. **No electronic proof captured.** Even once Square is live, nothing stores Square's payment id / receipt URL, so the Hub receipt can't link to Square's official receipt.

**Other missing/incomplete on the catering side:**
- **No deposit / partial-payment support.** The pay link is a single lump-sum for the full total (`square-invoice.ts:127-135`). Catering commonly needs a deposit + balance; Square Invoices and Toast both support deposits/schedules. (Note: the quote PDF policy text says they moved *away* from a required 50% deposit — `js/11...:138` — so this may be intentional, but partial-payment recording would still help.)
- **No payment/receipts export.** The pipeline has no CSV/QuickBooks export of payments (the Fundraiser Hub, by contrast, has a CSV export — `fhExportCSV`, `js/09...:187`).
- **No due-date / payment reminders on sent-but-unpaid invoices.** There's a follow-up reminder for pending *quotes* (`sendQuoteReminder`, `js/11...:260`), but nothing chases an *unpaid invoice*.

**Fundraiser Hub (in scope, separate) — assessed, no payment processing involved.**
`openFundraiserHub` (`js/09_work_orders_maintenance_phase.js:144`) is a complete card-fundraiser manager: pipeline, org registry, card-movement ledger (`fr_card_move`), reconciliation (`fhReconcile`/`fr_reconcile` — cards sold/returned/voided, amount received, variance, discrepancy flag, deposit reference), and its **own printable receipt** (`fhGenReceipt`, `js/09...:226`). It does **not** integrate Square or any card processor — money is reconciled manually (cash + deposit reference). So it is a tracking/reconciliation tool, not a payment taker; nothing here charges cards. Notably it already models what the catering side lacks: variance/discrepancy tracking, a deposit reference, and an audit timeline — a good internal precedent for improving the catering receipt.

---

## Stale-content candidates

- **`SQUARE_INVOICE_SETUP.md` describes the old "emailed Square Invoice" model.** It repeatedly says the flow "creates + emails a Square invoice" and "Square emails the customer" (title, section G, "How it works"). The **current code creates a no-email payment LINK** — `square-invoice.ts:1-10` explicitly says *"Square sends the customer NO emails."* The setup doc's webhook step (E3) also lists only `invoice.payment_made`/`invoice.updated`; for the payment-link model the relevant events are `payment.updated`/`payment.created` (which the webhook code and `OPEN_ITEMS` correctly include, but the setup doc does not). Recommend updating the setup doc to the payment-link reality.
- **Misleading code comments.** `autoSendSquareInvoice`/`sendSquareInvoice` are commented as *"create + email a REAL Square invoice"* (`js/02_on_load.js:142-143,233`) — they actually create a no-email pay link. Comment drift, not a bug.
- **`API_REFERENCE.md` anon-key location is stale.** §2 says the anon key is at `index.html` ~line 2575; the file is only 2509 lines and the key now lives in `js/01_part01.js:4` (the JS was split into modules). Harmless but misleading for the next developer.

---

## Competitor-inspired ideas (receipt / payment-visibility gap)

Benchmarks — how peers surface payment records to staff:
- **Square Invoices** (same processor): team members with the *invoices* permission view/track invoices in the Square Dashboard; staff can record cash/check/other and **"Mark as paid,"** payment status is real-time, and **text/email receipts** go out for every payment. (The Hub already mirrors the Mark-Paid pattern; what's in Square's dashboard isn't surfaced in the Hub.)
- **Toast Invoicing** (catering-specific): calendar of orders integrated with POS/KDS, accessible to catering managers *and* back-of-house; supports **deposits** and payment due dates/reminders; payments flow into standard **Sales Summary** reports on the payment date.
- **HoneyBook**: a dedicated **Payments dashboard** listing outstanding vs paid; a clean **invoice-vs-receipt** model (receipt = proof of payment, auto-emailed with a link); **offline payments tracked** into Reports/Bookkeeping; **bookkeeper role** + QuickBooks sync.

Concrete improvements for Caliche's Hub:
1. **Add a central "Catering Payments / Receipts" ledger** (HoneyBook/Square style): one screen listing every paid quote with amount, date paid, method, reference, invoice #, and a Receipt link — instead of hunting per-card. This most directly delivers Issac's "receipts available on the hub" ask.
2. **Capture Square's real payment record when the webhook goes live** (Square): store `payment.id`, `receipt_url`, and card brand/last-4 from the webhook payload onto the quote, and show/link Square's official receipt from the Hub receipt. Turns H2's honor-system record into verifiable proof.
3. **Support deposits / partial payments** (Toast/Square): allow a deposit + balance (or at least record partial "amount received" like the Fundraiser reconcile already does) rather than one lump pay link.
4. **One-click payments export** (HoneyBook/QuickBooks): a CSV/QuickBooks export of catering payments for the owner's bookkeeping — the Fundraiser Hub already has CSV export to copy from.
5. **Invoice due-dates + automatic unpaid reminders** (all three): extend the existing quote-reminder mechanism to chase sent-but-unpaid invoices.

---

## Test records created

**None.** I did **not** create a test quote or call any RPC, because the sandbox has **no usable outbound path to the Supabase API**: the workspace shell's network is proxy-blocked (`403` on CONNECT), and the only working fetch tool is GET-only and cannot send the `apikey`/`Authorization` header or a JSON RPC body required by `app_quote_create` / `app_quote_admin_list` / `app_quote_search_contacts`. The task's offered curl test was therefore not executable from my environment. The **only** external calls I made were harmless, payload-free **GET reachability probes** to the two Edge Function URLs (`.../functions/v1/square-webhook` and `.../square-invoice`) — no body, no auth, nothing that could touch money or data. **No money action of any kind (sandbox or real) was attempted.**

> Suggested follow-up if live confirmation of the read/create RPCs is wanted: run the `app_quote_create` / `app_quote_admin_list` / `app_quote_search_contacts` checks from a machine with network access, using `test_admin`/`1111` and contact name **"TEST - audit - do not process"**, and stop before Accept (do not trigger `square-invoice`).

---

## Open questions for Issac (and exactly what only the dashboard can confirm)

1. **[Dashboard only] Are the Square secrets set, and to what?** In Supabase → project `ikgbihwkqhsfahnswfbz` → **Edge Functions → Secrets**, confirm the presence and (env) value of `SQUARE_ACCESS_TOKEN`, `SQUARE_ENV` (`sandbox` vs `production`), `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_URL` (and optional `SQUARE_LOCATION_ID`). This is the single fact that flips the verdict from "not configured" to "live" and that I cannot see. Code + 4 recent docs say they're unset as of 2026-07-13.
2. **[Dashboard only] Is the Square webhook subscription registered** in the Square dashboard for `payment.updated`/`payment.created` (+ `invoice.*`), pointing at `https://ikgbihwkqhsfahnswfbz.supabase.co/functions/v1/square-webhook`, and does Square's "Send test event" return 200?
3. **[Dashboard only] Is `square-invoice` actually deployed** (I confirmed `square-webhook` is; I could not confirm `square-invoice` from code/network)? Check Edge Functions list — and that `square-invoice` has **Verify JWT = ON** and `square-webhook` has **Verify JWT = OFF**.
4. **[Quick DB check] Does `app_quote_admin_list` return `amount_paid`, `payment_method`, `payment_reference`, `subtotal`, `tax`?** If not, the in-Hub receipt will show blanks for method/reference. (Its SQL isn't in the repo, so I couldn't verify.)
5. **[Product decision] Is a lump-sum pay link intended, or do you want deposits/partial payments?** The quote policy text says you dropped the required 50% deposit — confirm that's still the intent before building deposit support.
6. **[Confirm] Once secrets are live, do you also want Square's official receipt captured/linked in the Hub** (idea C3), or is the Hub's own printable receipt sufficient for your recordkeeping?
