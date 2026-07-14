// Supabase Edge Function: send-push
// Drains one push_outbox row and sends an encrypted Web Push to that employee's subscriptions.
// Secrets required (set in Edge Function secrets): VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT (optional).
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") || "mailto:admin@caliches.com",
  Deno.env.get("VAPID_PUBLIC")!,
  Deno.env.get("VAPID_PRIVATE")!,
);

Deno.serve(async (req) => {
  try {
    const { outbox_id } = await req.json();
    const { data: row } = await sb
      .from("push_outbox")
      .select("*")
      .eq("id", outbox_id)
      .is("sent_at", null)
      .maybeSingle();
    if (!row) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: subs } = await sb
      .from("push_subscriptions")
      .select("*")
      .eq("employee_id", row.employee_id);

    const payload = JSON.stringify({
      title: row.title,
      body: row.body,
      url: row.url,
    });

    let sent = 0, gone = 0;
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (e) {
        const code = (e && (e.statusCode || e.status)) || 0;
        if (code === 404 || code === 410) {
          await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          gone++;
        }
      }
    }

    await sb
      .from("push_outbox")
      .update({ sent_at: new Date().toISOString(), attempts: (row.attempts ?? 0) + 1 })
      .eq("id", outbox_id);

    return new Response(JSON.stringify({ sent, gone }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
