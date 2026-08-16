// Redirect-Ziel, das Slack direkt im Browser aufruft (kein Supabase-JWT im
// Request!). Tauscht den code gegen einen User-Token, verschluesselt ihn
// via Vault (upsert_connected_account RPC) und schickt den Browser zurueck
// in die App (siehe _shared/oauthFinish.ts).
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { verifyState, type OAuthState } from "../_shared/state.ts";
import { finishOAuth } from "../_shared/oauthFinish.ts";

const TOKEN_ENDPOINT = "https://slack.com/api/oauth.v2.access";
const FAR_FUTURE_ISO = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const stateSecret = Deno.env.get("OAUTH_STATE_SECRET");
  const clientId = Deno.env.get("SLACK_CLIENT_ID");
  const clientSecret = Deno.env.get("SLACK_CLIENT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  if (!stateSecret || !clientId || !clientSecret || !supabaseUrl) {
    return finishOAuth("web", "error", "Server-Konfigurationsfehler: Slack OAuth Secrets fehlen.");
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
    return finishOAuth(state.platform, "error", `Slack hat den Zugriff verweigert: ${oauthError}`);
  }
  if (!code) {
    return finishOAuth(state.platform, "error", "Kein Autorisierungscode von Slack erhalten.");
  }

  try {
    const redirectUri = `${supabaseUrl}/functions/v1/slack-oauth-callback`;

    const tokenResponse = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    const tokens = await tokenResponse.json();

    if (!tokens.ok) {
      console.error("Slack token exchange failed:", tokens);
      return finishOAuth(
        state.platform,
        "error",
        `Token-Austausch mit Slack ist fehlgeschlagen: ${tokens.error ?? "unbekannt"}`
      );
    }

    const authedUser = tokens.authed_user;
    if (!authedUser?.access_token) {
      return finishOAuth(
        state.platform,
        "error",
        "Slack hat keinen User-Token zurueckgegeben (fehlende user_scope-Zustimmung?)."
      );
    }

    const admin = supabaseAdmin();
    // Klassische Slack User Tokens laufen nicht ab. Nur wenn Slacks "Token
    // Rotation" fuer den Workspace aktiv ist, liefert Slack expires_in mit.
    const expiresAt = authedUser.expires_in
      ? new Date(Date.now() + authedUser.expires_in * 1000).toISOString()
      : FAR_FUTURE_ISO;

    const { data: account, error: upsertError } = await admin.rpc("upsert_connected_account", {
      p_user_id: state.user_id,
      p_provider: "slack",
      p_account_label: state.account_label,
      p_provider_account_id: authedUser.id ?? null,
      p_token_payload: {
        access_token: authedUser.access_token,
        refresh_token: authedUser.refresh_token ?? null,
        expires_at: expiresAt,
        scope: authedUser.scope ?? null,
        token_type: "user",
        // provider_email wird hier fuer den Workspace-/Team-Namen zweckentfremdet
        // (generisches Feld aus Paket 2, dort urspruenglich fuer Google-E-Mails gedacht).
        provider_email: tokens.team?.name ?? null,
      },
    });

    if (upsertError || !account) {
      console.error("upsert_connected_account failed:", upsertError);
      return finishOAuth(state.platform, "error", "Konnte den verbundenen Slack-Account nicht speichern.");
    }

    return finishOAuth(state.platform, "success", `"${state.account_label}" ist jetzt verbunden.`, account.id);
  } catch (error) {
    console.error("slack-oauth-callback error:", error);
    return finishOAuth(state.platform, "error", "Unerwarteter Fehler beim Verbinden mit Slack.");
  }
});
