// Redirect-Ziel, das Google direkt im Browser aufruft (kein Supabase-JWT im
// Request!). Tauscht den code gegen Tokens, verschluesselt sie via Vault
// (upsert_connected_account RPC) und schickt den Browser zurueck in die App
// (finishOAuth: native ueber dailybrief://-Scheme, web ueber eine
// selbstschliessende HTML-Seite).
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { verifyState, type OAuthState } from "../_shared/state.ts";
import { finishOAuth } from "../_shared/oauthFinish.ts";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const stateSecret = Deno.env.get("OAUTH_STATE_SECRET");
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  if (!stateSecret || !clientId || !clientSecret || !supabaseUrl) {
    return finishOAuth("web", "error", "Server-Konfigurationsfehler: Google OAuth Secrets fehlen.");
  }

  if (!stateParam) {
    return finishOAuth("web", "error", "Ungueltige Anfrage: state fehlt.");
  }

  let state: OAuthState;
  try {
    state = await verifyState(stateParam, stateSecret);
  } catch (error) {
    console.error("Invalid oauth state:", error);
    return finishOAuth(
      "web",
      "error",
      "Sicherheitspruefung fehlgeschlagen (state ungueltig oder abgelaufen). Bitte erneut versuchen."
    );
  }

  if (oauthError) {
    return finishOAuth(state.platform, "error", `Google hat den Zugriff verweigert: ${oauthError}`);
  }
  if (!code) {
    return finishOAuth(state.platform, "error", "Kein Autorisierungscode von Google erhalten.");
  }

  try {
    const redirectUri = `${supabaseUrl}/functions/v1/google-oauth-callback`;

    const tokenResponse = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      console.error("Google token exchange failed:", await tokenResponse.text());
      return finishOAuth(state.platform, "error", "Token-Austausch mit Google ist fehlgeschlagen.");
    }

    const tokens = await tokenResponse.json();

    let providerAccountId: string | null = null;
    let providerEmail: string | null = null;
    try {
      const profileResponse = await fetch(USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (profileResponse.ok) {
        const profile = await profileResponse.json();
        providerAccountId = profile.sub ?? null;
        providerEmail = profile.email ?? null;
      }
    } catch (profileError) {
      console.warn("Konnte Google-Profil nicht laden:", profileError);
    }

    const admin = supabaseAdmin();
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

    const { data: account, error: upsertError } = await admin.rpc("upsert_connected_account", {
      p_user_id: state.user_id,
      p_provider: "google",
      p_account_label: state.account_label,
      p_provider_account_id: providerAccountId,
      p_token_payload: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_at: expiresAt,
        scope: tokens.scope ?? null,
        token_type: tokens.token_type ?? "Bearer",
        provider_email: providerEmail,
      },
    });

    if (upsertError || !account) {
      console.error("upsert_connected_account failed:", upsertError);
      return finishOAuth(state.platform, "error", "Konnte den verbundenen Account nicht speichern.");
    }

    return finishOAuth(state.platform, "success", `"${state.account_label}" ist jetzt verbunden.`, account.id);
  } catch (error) {
    console.error("google-oauth-callback error:", error);
    return finishOAuth(state.platform, "error", "Unerwarteter Fehler beim Verbinden mit Google.");
  }
});
