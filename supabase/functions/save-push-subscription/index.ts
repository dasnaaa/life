// Speichert/entfernt das Web-Push-Abo des eingeloggten Nutzers.
// Aufgerufen aus lib/pushNotifications.ts bei "Benachrichtigungen aktivieren"
// (subscribe) bzw. "deaktivieren" (unsubscribe) in den Einstellungen.
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type SubscribeBody = {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
};
type UnsubscribeBody = { unsubscribe: true; endpoint: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    const admin = supabaseAdmin();

    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData?.user) {
      return json({ error: "Ungueltige Session" }, 401);
    }
    const userId = userData.user.id;

    const body = (await req.json().catch(() => ({}))) as Partial<SubscribeBody & UnsubscribeBody>;

    if (body.unsubscribe) {
      if (!body.endpoint) return json({ error: "endpoint ist erforderlich." }, 400);
      const { error } = await admin
        .from("push_subscriptions")
        .delete()
        .eq("user_id", userId)
        .eq("endpoint", body.endpoint);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, unsubscribed: true });
    }

    const subscription = body.subscription;
    if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return json({ error: "subscription (endpoint + keys.p256dh + keys.auth) ist erforderlich." }, 400);
    }

    const { error } = await admin.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      { onConflict: "endpoint" }
    );
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, subscribed: true });
  } catch (error) {
    console.error("save-push-subscription error:", error);
    return json({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
