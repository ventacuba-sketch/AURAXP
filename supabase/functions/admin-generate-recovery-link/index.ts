import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) throw new Error("not_authenticated");

    const adminDb = createClient(url, service);
    const { data: profile } = await adminDb.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
    if (!profile?.is_admin) throw new Error("not_authorized");

    const { userId } = await req.json();
    if (!userId) throw new Error("missing_user_id");
    const { data: target, error: userError } = await adminDb.auth.admin.getUserById(userId);
    if (userError || !target.user?.email) throw new Error("user_not_found");

    const redirectTo = "https://auravs.app/recover-scan?channel=magic_link";
    const { data: linkData, error: linkError } = await adminDb.auth.admin.generateLink({
      type: "magiclink",
      email: target.user.email,
      options: { redirectTo },
    });
    if (linkError || !linkData.properties?.action_link) throw linkError ?? new Error("link_failed");

    await adminDb.from("user_recovery_attempts").insert({
      user_id: userId, channel: "magic_link", action: "generated", created_by: user.id,
      metadata: { redirect_to: redirectTo },
    });

    const message = `🔥 Tu Aura todavía no ha sido medida 👀\n\nTu cuenta de AURA VS ya está lista. Entra directamente y descubre cuánta Aura tienes:\n\n${linkData.properties.action_link}`;
    return new Response(JSON.stringify({ email: target.user.email, magicLink: linkData.properties.action_link, message }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown_error";
    const status = message === "not_authorized" ? 403 : message === "not_authenticated" ? 401 : 400;
    return new Response(JSON.stringify({ error: message }), { status, headers: { ...cors, "Content-Type": "application/json" } });
  }
});