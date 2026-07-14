// Supabase Edge Function: square-webhook
// ----------------------------------------------------------------------------
// Receives Square webhook events and marks the matching Caliche's quote PAID so
// the Hub knows the moment an invoice is paid — no manual checking.
//
// Handles: invoice.payment_made, invoice.updated (status PAID),
//          payment.updated / payment.created (COMPLETED, matched via invoice id).
//
// Secrets (Supabase → Edge Functions → Manage secrets):
//   SQUARE_WEBHOOK_SIGNATURE_KEY  (required) signature key from the Square subscription
//   SQUARE_WEBHOOK_URL            (required) the EXACT public URL of THIS function,
//                                 e.g. https://<proj>.supabase.co/functions/v1/square-webhook
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// Deploy with JWT verification OFF (Square can't send a Supabase JWT):
//   supabase functions deploy square-webhook --no-verify-jwt
// Security is the Square HMAC signature. This endpoint FAILS CLOSED: if the
// signature secrets are missing or the signature doesn't match, the request is
// rejected — an unverified request can never mark an invoice paid.
// ----------------------------------------------------------------------------
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SIG_KEY = Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY") || "";
const HOOK_URL = Deno.env.get("SQUARE_WEBHOOK_URL") || "";

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

// Square signature = base64( HMAC-SHA256( key = signatureKey, msg = notificationUrl + rawBody ) )
async function validSignature(rawBody: string, headerSig: string): Promise<boolean> {
  if (!SIG_KEY || !HOOK_URL) {
    // FAIL CLOSED — without both secrets we cannot verify, so we reject.
    console.error("[square-webhook] rejected: SQUARE_WEBHOOK_SIGNATURE_KEY and/or SQUARE_WEBHOOK_URL not set");
    return false;
  }
  if (!headerSig) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SIG_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(HOOK_URL + rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return timingSafeEqual(expected, headerSig);
}

// Route through the guarded RPC (coalesce paid_at, only-if-not-already-Paid).
async function markPaidByInvoiceId(invoiceId: string, amountCents?: number) {
  if (!invoiceId) return;
  const { error } = await sb.rpc("app_quote_mark_paid_by_square", {
    p_square_invoice_id: invoiceId,
    p_amount: typeof amountCents === "number" ? amountCents / 100 : null,
  });
  if (error) console.error("[square-webhook] mark paid failed:", error.message);
  else console.log("[square-webhook] marked paid:", invoiceId);
}
// Alias kept so both invoice-id and order-id call sites read clearly.
const markPaidBySquare = markPaidByInvoiceId;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  const raw = await req.text();
  const sig = req.headers.get("x-square-hmacsha256-signature") || "";
  if (!(await validSignature(raw, sig))) {
    return new Response("bad signature", { status: 401 });
  }

  let evt: any = {};
  try { evt = JSON.parse(raw); } catch { return new Response("bad json", { status: 200 }); }

  const type = evt?.type || "";
  const obj = evt?.data?.object || {};

  try {
    if (type === "invoice.payment_made") {
      const inv = obj.invoice || {};
      const paid = inv?.payment_requests?.[0]?.total_completed_amount_money?.amount;
      await markPaidByInvoiceId(inv.id, paid);
    } else if (type === "invoice.updated") {
      const inv = obj.invoice || {};
      if (inv.status === "PAID") {
        const paid = inv?.payment_requests?.[0]?.total_completed_amount_money?.amount;
        await markPaidByInvoiceId(inv.id, paid);
      }
    } else if (type === "payment.updated" || type === "payment.created") {
      const pay = obj.payment || {};
      // Payment-link payments carry an order_id (not an invoice_id). Match on the
      // invoice id if present, otherwise the order id we saved as square_order_id.
      const key = pay.invoice_id || pay.invoice?.id || pay.order_id || null;
      if (pay.status === "COMPLETED" && key) {
        await markPaidBySquare(key, pay.amount_money?.amount);
      }
    }
    // Any other event type is acknowledged and ignored.
  } catch (e) {
    console.error("[square-webhook] handler error:", e?.message || e);
    // Still 200 so Square doesn't hammer retries; we log for follow-up.
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
