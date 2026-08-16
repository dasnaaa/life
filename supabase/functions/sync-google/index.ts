// Synct Gmail (ungelesen), Calendar (naechste 60 Tage) und Contacts
// (Geburtstage) fuer einen einzelnen connected_accounts-Eintrag.
//
// Aufrufbar
//   a) von der App mit dem Nutzer-JWT (Settings: "Jetzt syncen" /
//      automatisch nach dem Verbinden) - dann muss account.user_id == JWT-User
//      sein, sonst 403.
//   b) spaeter vom Cron-Scheduler (Paket 8) mit dem Service-Role-Key, um
//      Accounts beliebiger Nutzer zu syncen.
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  classifyEmail,
  fetchGoogleContactsWithBirthdays,
  fetchUnreadGmailMessages,
  fetchUpcomingCalendarEvents,
  getValidAccessToken,
  parseFrom,
} from "../_shared/google.ts";

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

    if (account.provider !== "google") {
      return json({ error: "Account ist kein Google-Account." }, 400);
    }
    if (!account.is_active) {
      return json({ error: "Account ist deaktiviert." }, 400);
    }

    const accessToken = await getValidAccessToken(accountId);

    const [gmailResult, calendarResult, contactsResult] = await Promise.allSettled([
      syncGmail(admin, accountId, accessToken),
      syncCalendar(admin, accountId, accessToken),
      syncContacts(admin, account.user_id, accessToken),
    ]);

    await admin.rpc("touch_connected_account_sync", { p_account_id: accountId });

    return json({
      ok: true,
      account_id: accountId,
      summary: {
        gmail: settledSummary(gmailResult),
        calendar: settledSummary(calendarResult),
        contacts: settledSummary(contactsResult),
      },
    });
  } catch (error) {
    console.error("sync-google error:", error);
    return json({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }, 500);
  }
});

function settledSummary(result: PromiseSettledResult<number>) {
  if (result.status === "fulfilled") return { ok: true, count: result.value };
  console.error(result.reason);
  return { ok: false, error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
}

async function syncGmail(admin: AdminClient, accountId: string, accessToken: string): Promise<number> {
  const messages = await fetchUnreadGmailMessages(accessToken, 100);
  if (messages.length === 0) return 0;

  const rows = messages.map((message) => {
    const { name, email } = parseFrom(message.from);
    const category = classifyEmail({ listUnsubscribe: message.listUnsubscribe, from: message.from });
    return {
      account_id: accountId,
      platform: "gmail",
      sender_name: name,
      sender_id: email,
      content_preview: message.snippet,
      received_at: new Date(Number(message.internalDate)).toISOString(),
      is_read: false,
      external_id: message.id,
      raw_data: {
        message_id: message.id,
        thread_id: message.threadId,
        subject: message.subject,
        category,
        list_unsubscribe: message.listUnsubscribe,
      },
      synced_at: new Date().toISOString(),
    };
  });

  const { error } = await admin.from("messages_cache").upsert(rows, { onConflict: "account_id,external_id" });
  if (error) throw new Error(`messages_cache upsert fehlgeschlagen: ${error.message}`);
  return rows.length;
}

async function syncCalendar(admin: AdminClient, accountId: string, accessToken: string): Promise<number> {
  const events = await fetchUpcomingCalendarEvents(accessToken, 60);
  if (events.length === 0) return 0;

  const rows = events.map((event) => ({
    account_id: accountId,
    event_id: event.id,
    title: event.title,
    start_time: event.startTime,
    end_time: event.endTime,
    recurrence_rule: event.recurrenceRule,
    participants: event.participants,
    location: event.location,
    raw_data: event.raw,
    synced_at: new Date().toISOString(),
  }));

  const { error } = await admin.from("calendar_events_cache").upsert(rows, { onConflict: "event_id" });
  if (error) throw new Error(`calendar_events_cache upsert fehlgeschlagen: ${error.message}`);
  return rows.length;
}

async function syncContacts(admin: AdminClient, userId: string, accessToken: string): Promise<number> {
  const contacts = await fetchGoogleContactsWithBirthdays(accessToken);
  if (contacts.length === 0) return 0;

  const rows = contacts.map((contact) => ({
    user_id: userId,
    contact_name: contact.name,
    contact_identifier: contact.email,
    platform: "google",
    birthday: contact.birthday,
  }));

  const { error } = await admin
    .from("contact_tracking")
    .upsert(rows, { onConflict: "user_id,contact_identifier" });
  if (error) throw new Error(`contact_tracking upsert fehlgeschlagen: ${error.message}`);
  return rows.length;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
