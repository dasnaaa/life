// Redirect-Ziel, das Google direkt im Browser aufruft (kein Supabase-JWT im
// Request!). Tauscht den code gegen Tokens, verschluesselt sie via Vault
// (upsert_connected_account RPC) und schickt den Browser zurueck in die App:
// native ueber den dailybrief://-Scheme-Redirect, web ueber eine kleine
// HTML-Seite, die sich selbst schliesst (siehe finish()).
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { verifyState, type OAuthState } from "../_shared/state.ts";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const APP_SCHEME = "dailybrief";

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
    return finish("web", "error", "Server-Konfigurationsfehler: Google OAuth Secrets fehlen.");
  }

  if (!stateParam) {
    return finish("web", "error", "Ungueltige Anfrage: state fehlt.");
  }

  let state: OAuthState;
  try {
    state = await verifyState(stateParam, stateSecret);
  } catch (error) {
    console.error("Invalid oauth state:", error);
    return finish("web", "error", "Sicherheitspruefung fehlgeschlagen (state ungueltig oder abgelaufen). Bitte erneut versuchen.");
  }

  if (oauthError) {
    return finish(state.platform, "error", `Google hat den Zugriff verweigert: ${oauthError}`);
  }
  if (!code) {
    return finish(state.platform, "error", "Kein Autorisierungscode von Google erhalten.");
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
      return finish(state.platform, "error", "Token-Austausch mit Google ist fehlgeschlagen.");
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
      return finish(state.platform, "error", "Konnte den verbundenen Account nicht speichern.");
    }

    return finish(state.platform, "success", `"${state.account_label}" ist jetzt verbunden.`, account.id);
  } catch (error) {
    console.error("google-oauth-callback error:", error);
    return finish(state.platform, "error", "Unerwarteter Fehler beim Verbinden mit Google.");
  }
});

function finish(
  platform: "web" | "native",
  status: "success" | "error",
  message: string,
  accountId?: string
): Response {
  if (platform === "native") {
    const target = new URL(`${APP_SCHEME}://oauth-callback`);
    target.searchParams.set("status", status);
    target.searchParams.set("message", message);
    if (accountId) target.searchParams.set("account_id", accountId);
    return new Response(null, { status: 302, headers: { Location: target.toString() } });
  }

  const safeMessage = escapeHtml(message);
  const color = status === "success" ? "#4ADE80" : "#F87171";
  const accountIdLiteral = accountId ? `"${accountId}"` : "null";
  const body = `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Daily Brief</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#0F172A; color:#F8FAFC; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
  <div style="text-align:center; padding:24px; max-width:360px;">
    <p style="color:${color}; font-size:18px; font-weight:600;">${safeMessage}</p>
    <p style="color:#94A3B8; font-size:14px;">Dieses Fenster kann geschlossen werden.</p>
  </div>
  <script>
    try {
      window.opener && window.opener.postMessage(
        { source: "daily-brief-oauth", status: "${status}", accountId: ${accountIdLiteral} },
        "*"
      );
    } catch (e) {}
    setTimeout(function () { window.close(); }, 1200);
  </script>
</body>
</html>`;

  return new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
