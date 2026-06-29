// Supabase Edge Function: scorm-upload
// Manager-gated, PATH-PRESERVING signed upload-URL minter for hosting unzipped SCORM
// packages under  scorm/<course_id>/<relpath>  in the public 'training-materials' bucket.
// Unlike 'material-upload' (which flattens "/" into "_"), this preserves the package's
// folder structure so the SCO's relative asset links keep working.
//
// Deploy:  supabase functions deploy scorm-upload   (or paste in the dashboard Edge Functions editor)
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BUCKET = "training-materials";
const MGR_ROLES = ["Admin Manager", "Manager", "Vice President/Co-Owner", "Store Manager"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// keep folder structure; strip traversal + unsafe chars but preserve "/"
function cleanPath(s: string): string {
  return String(s || "")
    .replace(/\\/g, "/")
    .replace(/\.\.+/g, "")
    .replace(/^\/+/, "")
    .split("/")
    .map((seg) => seg.replace(/[^A-Za-z0-9._-]/g, "_"))
    .filter((seg) => seg.length > 0)
    .join("/");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { username, pin, course_id, relpath } = await req.json();

    // Verify the caller is a manager, reusing the app's own login RPC.
    const { data: who, error: aerr } = await sb.rpc("app_login", { p_username: username, p_password: pin });
    const u = Array.isArray(who) ? who[0] : who;
    if (aerr || !u || !(u.is_developer === true || MGR_ROLES.includes(u.role))) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 200, headers: CORS });
    }

    const cid = parseInt(course_id, 10);
    const rel = cleanPath(relpath);
    if (!cid || !rel) {
      return new Response(JSON.stringify({ error: "missing course_id or relpath" }), { status: 200, headers: CORS });
    }

    const path = `scorm/${cid}/${rel}`;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 200, headers: CORS });
    }
    const pub = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${BUCKET}/${path}`;
    return new Response(JSON.stringify({ path: data.path, token: data.token, url: pub }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 200, headers: CORS });
  }
});
