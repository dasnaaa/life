// Pollt den selbst gehosteten whatsapp-web.js-Service (whatsapp-service/,
// laeuft auf dem Mac oder einem kleinen VPS - NICHT in Supabase) und
// schreibt ungelesene Nachrichten in messages_cache.
//
// Der Service selbst pusht neue eingehende Nachrichten zusaetzlich live per
// utils/supabase-sync.js direkt nach Supabase. Dieser Pull-Sync ist das
// zuverlaessige Backup dafuer (in Paket 8 alle 15 Minuten per Cron) - falls
// der Live-Push mal ausfaellt oder der Service neu gestartet wurde.
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type AdminClient = ReturnType<typeof supabaseAdmin>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    const admin = supabaseAdmin();

    const body = await req.json().catch(() => ({}));
    const accountId = body.account_id as string | undefined;
    if (!accountId) {
      return json({ error: "account_id ist erforderlich" }, 400);
    }

    const { data: account, error: accountError } = await admin
      .from("connected_accounts")
      .select("id, user_id, provider, is_active")
      .eq("id", accountId)
      .maybeSingle();

    if (accountError || !account) {
      return json({ error: "Account nicht gefunden." }, 404);
    }

    const isServiceRoleCall = jwt.length > 0 && jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!isServiceRoleCall) {
      const { data: userData, error: userError } = await admin.auth.getUser(jwt);
      if (userError || !userData?.user || userData.user.id !== account.user_id) {
        return json({ error: "Nicht autorisiert fuer diesen Account." }, 403);
      }
    }

    if (account.provider !== "whatsapp") {
      return json({ error: "Account ist kein WhatsApp-Account." }, 400);
    }
    if (!account.is_active) {
      return json({ error: "Account ist deaktiviert." }, 400);
    }

    const serviceUrl = Deno.env.get("WHATSAPP_SERVICE_URL");
    const serviceApiKey = Deno.env.get("WHATSAPP_SERVICE_API_KEY");
    if (!serviceUrl || !serviceApiKey) {
      return json(
        { error: "WHATSAPP_SERVICE_URL / WHATSAPP_SERVICE_API_KEY sind serverseitig nicht konfiguriert." },
        500
      );
    }

    const statusResponse = await serviceFetch(serviceUrl, serviceApiKey, "/status");
    if (!statusResponse.connected) {
      return json({
        ok: false,
        error: "WhatsApp-Service ist aktuell nicht verbunden (QR-Scan noetig?).",
        status: statusResponse,
      });
    }

    const [messagesResponse, contactsResponse] = await Promise.all([
      serviceFetch(serviceUrl, serviceApiKey, "/messages"),
      serviceFetch(serviceUrl, serviceApiKey, "/contacts/frequent"),
    ]);

    const messageCount = await syncMessages(admin, accountId, messagesResponse.messages ?? []);

    await admin.rpc("touch_connected_account_sync", { p_account_id: accountId });

    return json({
      ok: true,
      account_id: accountId,
      summary: {
        status: statusResponse,
        messages_synced: messageCount,
        // Haeufigste Kontakte werden erst in Paket 5 nach contact_tracking
        // gemerged (cross-platform Frequenz-Analyse) - hier nur zur
        // Sichtbarkeit im Response mitgeliefert, nicht persistiert.
        frequent_contacts_preview: (contactsResponse.contacts ?? []).slice(0, 5),
      },
    });
  } catch (error) {
    console.error("sync-whatsapp error:", error);
    return json({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }, 500);
  }
});

async function serviceFetch(baseUrl: string, apiKey: string, path: string): Promise<any> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WhatsApp-Service Fehler (${response.status}) fuer ${path}: ${text}`);
  }
  return response.json();
}

async function syncMessages(admin: AdminClient, accountId: string, messages: any[]): Promise<number> {
  if (messages.length === 0) return 0;

  const rows = messages.map((message) => ({
    account_id: accountId,
    platform: "whatsapp",
    sender_name: message.senderName,
    sender_id: message.senderId,
    content_preview: typeof message.body === "string" ? message.body.slice(0, 500) : "",
    received_at: new Date(message.timestamp).toISOString(),
    is_read: Boolean(message.isRead),
    external_id: message.id,
    raw_data: { chat_id: message.chatId, is_group: message.isGroup },
    synced_at: new Date().toISOString(),
  }));

  const { error } = await admin.from("messages_cache").upsert(rows, { onConflict: "account_id,external_id" });
  if (error) throw new Error(`messages_cache upsert fehlgeschlagen: ${error.message}`);
  return rows.length;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
