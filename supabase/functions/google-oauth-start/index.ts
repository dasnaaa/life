// Von der App aufgerufen (mit Nutzer-JWT), wenn der User "Google Account
// hinzufuegen" tippt. Baut die Google-Consent-URL inkl. signiertem state
// server-seitig - GOOGLE_CLIENT_ID verlaesst die Edge Function nie in den
// Client-Code, nur in dieser generierten URL.
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { signState } from "../_shared/state.ts";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
  "openid",
  "email",
].join(" ");

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

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const stateSecret = Deno.env.get("OAUTH_STATE_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!clientId || !stateSecret || !supabaseUrl) {
      return json(
        { error: "Google OAuth ist serverseitig nicht konfiguriert (GOOGLE_CLIENT_ID / OAUTH_STATE_SECRET fehlt)." },
        500
      );
    }

    const redirectUri = `${supabaseUrl}/functions/v1/google-oauth-callback`;

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

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", GOOGLE_SCOPES);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("state", state);

    return json({ url: authUrl.toString() });
  } catch (error) {
    console.error("google-oauth-start error:", error);
    return json({ error: "Interner Fehler beim Start des Google-OAuth-Flows." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
