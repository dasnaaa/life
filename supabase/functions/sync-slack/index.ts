// Synct ungelesene Slack-Nachrichten der letzten 48h fuer einen
// connected_accounts-Eintrag. Kategorisiert nach dm / mention / channel
// (Direktnachrichten > Erwaehnungen > Channel-Updates, siehe Spec Paket 4).
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { fetchRecentSlackMessages, getValidSlackAccessToken } from "../_shared/slack.ts";

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
      .select("id, user_id, provider, is_active, credentials")
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

    if (account.provider !== "slack") {
      return json({ error: "Account ist kein Slack-Account." }, 400);
    }
    if (!account.is_active) {
      return json({ error: "Account ist deaktiviert." }, 400);
    }

    const selfUserId = account.credentials?.provider_account_id as string | undefined;
    if (!selfUserId) {
      return json({ error: "Slack-User-ID fehlt auf diesem Account (bitte neu verbinden)." }, 400);
    }

    const accessToken = await getValidSlackAccessToken(accountId);
    const messages = await fetchRecentSlackMessages(accessToken, selfUserId, 48);

    const rows = messages.map((message) => {
      const category = message.channelType !== "channel" ? "dm" : message.hasMention ? "mention" : "channel";
      return {
        account_id: accountId,
        platform: "slack",
        sender_name: message.userName,
        sender_id: message.userId,
        content_preview: message.text.slice(0, 500),
        received_at: new Date(message.ts).toISOString(),
        is_read: false,
        external_id: message.id,
        raw_data: {
          channel_id: message.channelId,
          channel_name: message.channelName,
          channel_type: message.channelType,
          category,
          has_mention: message.hasMention,
        },
        synced_at: new Date().toISOString(),
      };
    });

    if (rows.length > 0) {
      const { error } = await admin.from("messages_cache").upsert(rows, { onConflict: "account_id,external_id" });
      if (error) throw new Error(`messages_cache upsert fehlgeschlagen: ${error.message}`);
    }

    await admin.rpc("touch_connected_account_sync", { p_account_id: accountId });

    return json({
      ok: true,
      account_id: accountId,
      summary: {
        dm: rows.filter((row) => row.raw_data.category === "dm").length,
        mention: rows.filter((row) => row.raw_data.category === "mention").length,
        channel: rows.filter((row) => row.raw_data.category === "channel").length,
      },
    });
  } catch (error) {
    console.error("sync-slack error:", error);
    return json({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
