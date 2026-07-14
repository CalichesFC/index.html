// Supabase Edge Function: square-invoice
// ----------------------------------------------------------------------------
// Creates a Square ONLINE PAYMENT LINK (hosted checkout) for a Caliche's
// catering quote and writes it onto the quote, so the Hub invoice's
// "Pay Now with Square" button opens Square's secure checkout for the exact
// amount. Square sends the customer NO emails — the customer only ever gets
// the ONE invoice you (or Cherry) send, with this pay button on it.
//
// (Previously this created + emailed a Square Invoice; changed to a payment
// link per owner request to avoid sending customers extra emails.)
//
// Invoked from the Hub with:
//     supabaseClient.functions.invoke('square-invoice', { body: { token } })
//   token = the quote's accept_token.
//
// Secrets (Supabase → Edge Functions → Manage secrets):
//   SQUARE_ACCESS_TOKEN   (required)  Sandbox or Production access token
//   SQUARE_ENV            (optional)  'sandbox' (default) | 'production'
//   SQUARE_LOCATION_ID    (optional)  recommended in prod; else first ACTIVE location
//   SQUARE_VERSION        (optional)  Square-Version header, default 2025-01-23
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// Deploy WITH jwt verification (default) — called with the Hub's anon key.
// Idempotent: if the quote already has a pay link, it just returns it.
// ----------------------------------------------------------------------------
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SQUARE_ENV = (Deno.env.get("SQUARE_ENV") || "sandbox").toLowerCase();
const SQUARE_BASE = SQUARE_ENV === "production"
  ? "https://connect.squareup.com"
  : "https://connect.squareupsandbox.com";
const SQUARE_VERSION = Deno.env.get("SQUARE_VERSION") || "2025-01-23";
const TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") || "";

// Thin Square REST helper — throws with Square's own error detail on failure.
async function sq(path: string, method: string, body?: unknown) {
  const res = await fetch(SQUARE_BASE + path, {
    method,
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const detail = data?.errors?.[0]?.detail || data?.raw || res.statusText;
    throw new Error(`Square ${method} ${path} → ${res.status}: ${detail}`);
  }
  return data;
}

async function getLocationId(): Promise<string> {
  const preset = Deno.env.get("SQUARE_LOCATION_ID");
  if (preset) return preset;
  const data = await sq("/v2/locations", "GET");
  const locs = (data?.locations || []).filter((l: any) => l.status === "ACTIVE");
  if (locs.length === 0) throw new Error("No ACTIVE Square location found on this account.");
  if (locs.length > 1) {
    console.warn(`[square-invoice] ${locs.length} active locations — using ${locs[0].id}. Set SQUARE_LOCATION_ID to pin one.`);
  }
  return locs[0].id;
}

// Integer cents from a total that may arrive as a number or a messy string.
function centsOf(total: unknown): number {
  const n = Number(String(total ?? "").replace(/[^0-9.\-]/g, ""));
  return Math.round(n * 100);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  // Handled errors return HTTP 200 with { ok:false, error } so the Hub can show
  // Square's real message instead of a generic "non-2xx" from the client SDK.
  try {
    if (!TOKEN) return json({ ok: false, error: "SQUARE_ACCESS_TOKEN not set" });

    const { token } = await req.json().catch(() => ({}));
    if (!token) return json({ ok: false, error: "token required" });

    // 1) Load the quote by accept_token (service role → bypasses RLS)
    const { data: q, error: qErr } = await sb.from("quotes").select("*").eq("accept_token", token).maybeSingle();
    if (qErr) throw qErr;
    if (!q) return json({ ok: false, error: "Quote not found" });

    const amount = centsOf(q.total);
    if (!(amount > 0)) return json({ ok: false, error: "Quote total must be greater than $0." });

    // 2) Idempotent: already has a pay link FOR THIS AMOUNT → just return it.
    //    If the quote total changed since the link was minted (e.g. $620 → $350),
    //    fall through and mint a fresh link for the new amount instead of
    //    handing the customer a stale link for the old total.
    const savedAmount = Number(q.square_link_amount ?? NaN);
    if (q.square_payment_url && q.square_invoice_id && savedAmount === amount) {
      return json({ ok: true, already: true, public_url: q.square_payment_url, order_id: q.square_order_id || null });
    }

    const locationId = await getLocationId();

    // 3) Create a Square ONLINE PAYMENT LINK for the exact amount (no email sent).
    //    quick_pay = a one-off hosted checkout for a single named line + price.
    //    Fresh idempotency key per attempt. The real duplicate guard is the DB
    //    check above (returns the saved link once one exists), so a prior attempt
    //    that created a Square link but failed to persist can be retried cleanly
    //    instead of being permanently blocked by a reused key (400 "already used").
    const linkRes = await sq("/v2/online-checkout/payment-links", "POST", {
      idempotency_key: `plink-${q.id}-${crypto.randomUUID()}`,
      quick_pay: {
        name: `Catering — Quote #${q.order_num}`,
        price_money: { amount, currency: "USD" },
        location_id: locationId,
      },
      checkout_options: { ask_for_shipping_address: false },
    });
    const link = linkRes?.payment_link;
    const publicUrl = link?.url || link?.long_url || null;
    if (!publicUrl) throw new Error("Square did not return a payment link URL.");

    // 4) Write the pay link back onto the quote (the invoice's Pay button reads this)
    const patch: Record<string, unknown> = {
      square_payment_url: publicUrl,
      square_order_id: link?.order_id || null,
      square_invoice_id: link?.id || null,   // payment-link id (kept for idempotency)
      square_link_amount: amount,            // cents the link was minted for (regen guard)
      invoice_status: "PayLinkReady",
      invoiced_at: q.invoiced_at || new Date().toISOString(),
    };
    const { error: upErr } = await sb.from("quotes").update(patch).eq("id", q.id);
    if (upErr) throw upErr;

    return json({ ok: true, public_url: publicUrl, order_id: link?.order_id || null });
  } catch (e) {
    console.error("[square-invoice]", e?.message || e);
    return json({ ok: false, error: String(e?.message || e) });
  }
});
