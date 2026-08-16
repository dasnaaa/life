// Von der App aufgerufen (mit Nutzer-JWT), wenn der User "Slack verbinden"
// tippt. Baut die Slack-Consent-URL inkl. signiertem state server-seitig -
// SLACK_CLIENT_ID verlaesst die Edge Function nie in den Client-Code.
//
// user_scope (nicht scope!): wir wollen Slack als der Nutzer selbst sehen
// (seine eigenen DMs/Mentions), keinen separaten Bot.
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { signState } from "../_shared/state.ts";

const SLACK_USER_SCOPES = [
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "users:read",
].join(",");

const STATE_TTL_MS = 5 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const admin = supabaseAdmin();
    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData?.user) {
      return json({ error: "Ungueltige Session" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const accountLabel = typeof body.account_label === "string" ? body.account_label.trim() : "";
    const platform = body.platform === "native" ? "native" : "web";

    if (!accountLabel) {
      return json({ error: "account_label ist erforderlich" }, 400);
    }

    const clientId = Deno.env.get("SLACK_CLIENT_ID");
    const stateSecret = Deno.env.get("OAUTH_STATE_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!clientId || !stateSecret || !supabaseUrl) {
      return json(
        { error: "Slack OAuth ist serverseitig nicht konfiguriert (SLACK_CLIENT_ID / OAUTH_STATE_SECRET fehlt)." },
        500
      );
    }

    const redirectUri = `${supabaseUrl}/functions/v1/slack-oauth-callback`;

    const state = await signState(
      {
        user_id: userData.user.id,
        account_label: accountLabel,
        platform,
        nonce: crypto.randomUUID(),
        exp: Date.now() + STATE_TTL_MS,
      },
      stateSecret
    );

    const authUrl = new URL("https://slack.com/oauth/v2/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("user_scope", SLACK_USER_SCOPES);
    authUrl.searchParams.set("state", state);

    return json({ url: authUrl.toString() });
  } catch (error) {
    console.error("slack-oauth-start error:", error);
    return json({ error: "Interner Fehler beim Start des Slack-OAuth-Flows." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
