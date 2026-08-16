import { supabaseAdmin } from "./supabaseAdmin.ts";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const EXPIRY_BUFFER_MS = 60_000;

type TokenPayload = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  scope?: string;
  token_type?: string;
  provider_email?: string | null;
};

// Holt einen gueltigen Access Token fuer den Account; erneuert ihn ueber den
// gespeicherten refresh_token falls er (mit 60s Puffer) abgelaufen ist, und
// persistiert das Ergebnis verschluesselt via update_connected_account_tokens.
export async function getValidAccessToken(accountId: string): Promise<string> {
  const admin = supabaseAdmin();
  const { data: tokens, error } = await admin.rpc("get_connected_account_tokens", {
    p_account_id: accountId,
  });

  if (error || !tokens) {
    throw new Error(`Keine gespeicherten Google-Tokens fuer Account ${accountId} gefunden.`);
  }

  const payload = tokens as TokenPayload;
  const expiresAt = new Date(payload.expires_at).getTime();

  if (Number.isFinite(expiresAt) && expiresAt - EXPIRY_BUFFER_MS > Date.now()) {
    return payload.access_token;
  }

  if (!payload.refresh_token) {
    throw new Error(
      `Access Token fuer Account ${accountId} ist abgelaufen und es liegt kein Refresh Token vor. Bitte Account neu verbinden.`
    );
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET nicht konfiguriert.");
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: payload.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Token-Refresh fehlgeschlagen (${response.status}): ${errText}`);
  }

  const refreshed = await response.json();
  const newExpiresAt = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString();

  const newPayload: TokenPayload = {
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
    console.error("Konnte aktualisierte Google-Tokens nicht speichern:", updateError);
  }

  return newPayload.access_token;
}

async function googleFetch(accessToken: string, url: string): Promise<any> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google API Fehler (${response.status}) fuer ${url}: ${text}`);
  }
  return response.json();
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------- Gmail ----------

export type GmailHeaderInfo = {
  id: string;
  threadId: string;
  snippet: string;
  from: string;
  subject: string;
  listUnsubscribe: string | null;
  internalDate: string;
};

const AUTOMATED_SENDER_PATTERN = /no-?reply|do-not-reply|notifications?@|alerts?@|mailer-daemon|updates?@/i;

export function classifyEmail(headers: {
  listUnsubscribe: string | null;
  from: string;
}): "newsletter" | "automatisch" | "persoenlich" {
  if (headers.listUnsubscribe) return "newsletter";
  if (AUTOMATED_SENDER_PATTERN.test(headers.from)) return "automatisch";
  return "persoenlich";
}

export function parseFrom(fromHeader: string): { name: string; email: string } {
  const match = fromHeader.match(/^(.*?)\s*<(.+)>$/);
  if (match) {
    const name = match[1].replace(/"/g, "").trim();
    return { name: name || match[2], email: match[2].trim() };
  }
  return { name: fromHeader.trim(), email: fromHeader.trim() };
}

export async function fetchUnreadGmailMessages(accessToken: string, maxResults = 100): Promise<GmailHeaderInfo[]> {
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", "is:unread");
  listUrl.searchParams.set("maxResults", String(maxResults));

  const list = await googleFetch(accessToken, listUrl.toString());
  const messageRefs: { id: string }[] = list.messages ?? [];

  return mapWithConcurrency(messageRefs, 8, async (ref) => {
    const detailUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}`);
    detailUrl.searchParams.set("format", "metadata");
    ["From", "Subject", "List-Unsubscribe", "Date"].forEach((header) =>
      detailUrl.searchParams.append("metadataHeaders", header)
    );

    const detail = await googleFetch(accessToken, detailUrl.toString());
    const headerList: { name: string; value: string }[] = detail.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headerList.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

    return {
      id: detail.id,
      threadId: detail.threadId,
      snippet: detail.snippet ?? "",
      from: getHeader("From"),
      subject: getHeader("Subject"),
      listUnsubscribe: getHeader("List-Unsubscribe") || null,
      internalDate: detail.internalDate,
    };
  });
}

// ---------- Calendar ----------

export type CalendarEventInfo = {
  id: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  recurrenceRule: string | null;
  participants: unknown;
  location: string | null;
  raw: unknown;
};

export async function fetchUpcomingCalendarEvents(accessToken: string, daysAhead = 60): Promise<CalendarEventInfo[]> {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  const eventsUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  eventsUrl.searchParams.set("timeMin", timeMin);
  eventsUrl.searchParams.set("timeMax", timeMax);
  // singleEvents=false: wiederkehrende Termine kommen als EINE Serie mit
  // recurrence-Feld zurueck (statt in Einzeltermine expandiert) - genau das
  // brauchen wir, um Kurse/Serien ueber die Recurrence Rule zu erkennen.
  eventsUrl.searchParams.set("singleEvents", "false");
  eventsUrl.searchParams.set("maxResults", "250");

  const allItems: any[] = [];
  let pageToken: string | undefined;
  do {
    if (pageToken) eventsUrl.searchParams.set("pageToken", pageToken);
    else eventsUrl.searchParams.delete("pageToken");
    const page = await googleFetch(accessToken, eventsUrl.toString());
    allItems.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return allItems
    .filter((event) => event.status !== "cancelled")
    .map((event) => ({
      id: event.id,
      title: event.summary ?? "(ohne Titel)",
      startTime: event.start?.dateTime ?? event.start?.date ?? null,
      endTime: event.end?.dateTime ?? event.end?.date ?? null,
      recurrenceRule: Array.isArray(event.recurrence) ? event.recurrence.join(";") : null,
      participants: event.attendees ?? null,
      location: event.location ?? null,
      raw: event,
    }));
}

// ---------- Contacts ----------

export type GoogleContactInfo = {
  name: string;
  email: string;
  birthday: string; // 'YYYY-MM-DD', Jahr 1900 = Platzhalter fuer "Jahr unbekannt"
};

export async function fetchGoogleContactsWithBirthdays(accessToken: string): Promise<GoogleContactInfo[]> {
  const contacts: GoogleContactInfo[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL("https://people.googleapis.com/v1/people/me/connections");
    url.searchParams.set("personFields", "names,birthdays,emailAddresses");
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const page = await googleFetch(accessToken, url.toString());
    for (const person of page.connections ?? []) {
      const name: string | undefined = person.names?.[0]?.displayName;
      const email: string | undefined = person.emailAddresses?.[0]?.value;
      const birthdayDate = person.birthdays?.[0]?.date;

      if (!name || !email || !birthdayDate?.month || !birthdayDate?.day) continue;

      const year = birthdayDate.year ?? 1900;
      const birthday = `${String(year).padStart(4, "0")}-${String(birthdayDate.month).padStart(2, "0")}-${String(
        birthdayDate.day
      ).padStart(2, "0")}`;

      contacts.push({ name, email, birthday });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  return contacts;
}
