import { supabaseAdmin } from "./supabaseAdmin.ts";

const TOKEN_ENDPOINT = "https://slack.com/api/oauth.v2.access";
const EXPIRY_BUFFER_MS = 60_000;

type SlackTokenPayload = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  scope?: string;
  token_type?: string;
  provider_email?: string | null;
};

// Klassische Slack User Tokens laufen nicht ab (kein refresh_token). Nur
// Workspaces mit aktivierter "Token Rotation" liefern einen refresh_token
// und ein echtes Ablaufdatum - in dem Fall wird hier tatsaechlich erneuert.
export async function getValidSlackAccessToken(accountId: string): Promise<string> {
  const admin = supabaseAdmin();
  const { data: tokens, error } = await admin.rpc("get_connected_account_tokens", {
    p_account_id: accountId,
  });

  if (error || !tokens) {
    throw new Error(`Keine gespeicherten Slack-Tokens fuer Account ${accountId} gefunden.`);
  }

  const payload = tokens as SlackTokenPayload;

  if (!payload.refresh_token) {
    return payload.access_token;
  }

  const expiresAt = new Date(payload.expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - EXPIRY_BUFFER_MS > Date.now()) {
    return payload.access_token;
  }

  const clientId = Deno.env.get("SLACK_CLIENT_ID");
  const clientSecret = Deno.env.get("SLACK_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("SLACK_CLIENT_ID / SLACK_CLIENT_SECRET nicht konfiguriert.");
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: payload.refresh_token,
    }),
  });

  const refreshed = await response.json();
  if (!refreshed.ok) {
    throw new Error(`Slack Token-Refresh fehlgeschlagen: ${refreshed.error ?? "unbekannt"}`);
  }

  const newExpiresAt = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    : payload.expires_at;

  const newPayload: SlackTokenPayload = {
    ...payload,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token ?? payload.refresh_token,
    expires_at: newExpiresAt,
  };

  const { error: updateError } = await admin.rpc("update_connected_account_tokens", {
    p_account_id: accountId,
    p_token_payload: newPayload,
  });
  if (updateError) {
    console.error("Konnte aktualisierte Slack-Tokens nicht speichern:", updateError);
  }

  return newPayload.access_token;
}

async function slackFetch(accessToken: string, method: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`https://slack.com/api/${method}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack API Fehler (${method}): ${data.error ?? "unbekannt"}`);
  }
  return data;
}

type SlackConversation = {
  id: string;
  type: "im" | "mpim" | "channel";
  name: string;
};

async function listSlackConversations(accessToken: string): Promise<SlackConversation[]> {
  const conversations: SlackConversation[] = [];
  let cursor: string | undefined;

  do {
    const data = await slackFetch(accessToken, "users.conversations", {
      types: "public_channel,private_channel,mpim,im",
      exclude_archived: "true",
      limit: "200",
      ...(cursor ? { cursor } : {}),
    });

    for (const channel of data.channels ?? []) {
      conversations.push({
        id: channel.id,
        type: channel.is_im ? "im" : channel.is_mpim ? "mpim" : "channel",
        name: channel.name || channel.id,
      });
    }

    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return conversations;
}

async function resolveSlackUserName(
  accessToken: string,
  userId: string | undefined,
  cache: Map<string, string>
): Promise<string> {
  if (!userId) return "Unbekannt";
  if (cache.has(userId)) return cache.get(userId)!;

  try {
    const data = await slackFetch(accessToken, "users.info", { user: userId });
    const name = data.user?.profile?.display_name || data.user?.real_name || data.user?.name || userId;
    cache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

export type SlackMessageInfo = {
  id: string;
  channelId: string;
  channelName: string;
  channelType: "im" | "mpim" | "channel";
  userId: string | null;
  userName: string;
  text: string;
  ts: number; // ms
  hasMention: boolean;
};

// Holt fuer jede Konversation, in der der Nutzer Mitglied ist, alle
// Nachrichten seit dem letzten Lesezeitpunkt (last_read) innerhalb des
// hoursBack-Fensters. DMs zaehlen komplett, bei Channels wird zusaetzlich
// per hasMention markiert, ob der Nutzer erwaehnt wurde - die Kategorie-
// Zuordnung (dm/mention/channel) passiert im aufrufenden sync-slack.
export async function fetchRecentSlackMessages(
  accessToken: string,
  selfUserId: string,
  hoursBack = 48
): Promise<SlackMessageInfo[]> {
  const conversations = await listSlackConversations(accessToken);
  const userNameCache = new Map<string, string>();
  const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
  const results: SlackMessageInfo[] = [];

  for (const conversation of conversations) {
    try {
      const info = await slackFetch(accessToken, "conversations.info", { channel: conversation.id });
      const lastReadMs = parseFloat(info.channel?.last_read ?? "0") * 1000;
      const oldestMs = Math.max(lastReadMs, cutoff);

      const history = await slackFetch(accessToken, "conversations.history", {
        channel: conversation.id,
        oldest: String(oldestMs / 1000),
        limit: "100",
      });

      const channelName =
        conversation.type === "im"
          ? await resolveSlackUserName(accessToken, info.channel?.user, userNameCache)
          : conversation.name;

      for (const message of history.messages ?? []) {
        if (message.subtype) continue; // System-Nachrichten (joins, topic changes, ...) ueberspringen
        if (message.user === selfUserId) continue; // eigene Nachrichten nicht als "ungelesen" zaehlen

        const messageTs = Number(message.ts) * 1000;
        if (messageTs < cutoff) continue;

        const hasMention = typeof message.text === "string" && message.text.includes(`<@${selfUserId}>`);
        const userName = await resolveSlackUserName(accessToken, message.user, userNameCache);

        results.push({
          id: `${conversation.id}-${message.ts}`,
          channelId: conversation.id,
          channelName,
          channelType: conversation.type,
          userId: message.user ?? null,
          userName,
          text: message.text ?? "",
          ts: messageTs,
          hasMention,
        });
      }
    } catch (error) {
      console.warn(`Slack: Konversation ${conversation.id} konnte nicht gesynct werden:`, error);
    }
  }

  return results;
}
