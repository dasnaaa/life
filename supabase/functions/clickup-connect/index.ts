// ClickUp nutzt einen persoenlichen API-Token statt OAuth - kein
// Consent-Flow noetig. Von der App aufgerufen (mit Nutzer-JWT), wenn der
// User seinen ClickUp-Token in den Einstellungen eintraegt (UI folgt in
// Paket 9, dieser Endpoint ist bereits vollstaendig nutzbar).
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { verifyClickUpToken } from "../_shared/clickup.ts";

const FAR_FUTURE_ISO = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();

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
    const apiToken = typeof body.api_token === "string" ? body.api_token.trim() : "";

    if (!accountLabel || !apiToken) {
      return json({ error: "account_label und api_token sind erforderlich" }, 400);
    }

    let profile: { userId: number; username: string; email: string };
    try {
      profile = await verifyClickUpToken(apiToken);
    } catch (error) {
      console.error("ClickUp Token-Verifikation fehlgeschlagen:", error);
      return json({ error: "ClickUp-Token konnte nicht verifiziert werden. Ist der Token korrekt?" }, 400);
    }

    const { data: account, error: upsertError } = await admin.rpc("upsert_connected_account", {
      p_user_id: userData.user.id,
      p_provider: "clickup",
      p_account_label: accountLabel,
      p_provider_account_id: String(profile.userId),
      p_token_payload: {
        access_token: apiToken,
        refresh_token: null,
        expires_at: FAR_FUTURE_ISO,
        scope: null,
        token_type: "personal",
        // provider_email wird hier fuer den ClickUp-Username zweckentfremdet
        // (generisches Feld aus Paket 2) - sync-clickup braucht ihn fuer die
        // @username-Erwaehnungserkennung in Kommentaren.
        provider_email: profile.username,
      },
    });

    if (upsertError || !account) {
      console.error("upsert_connected_account failed:", upsertError);
      return json({ error: "Konnte den ClickUp-Account nicht speichern." }, 500);
    }

    return json({ ok: true, account_id: account.id });
  } catch (error) {
    console.error("clickup-connect error:", error);
    return json({ error: "Interner Fehler beim Verbinden mit ClickUp." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
