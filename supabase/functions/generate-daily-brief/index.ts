// Das Herzstueck der App. Generiert die 4 Brief-Sektionen (email, news,
// messages, calendar) und speichert sie in daily_briefs. Laeuft entweder
// auf Anfrage der App ("Brief neu generieren") mit Nutzer-JWT, oder spaeter
// per Cron (Paket 8) mit Service-Role-Key + explizitem user_id im Body.
//
// Rate-Limit-Handling: alle Gemini-Calls laufen ueber generateJson() /
// summarize() aus _shared/gemini.ts (60s-Retry bei 429, danach strukturierter
// Fallback ohne KI - nie ein kompletter Fehlschlag der Sektion).
import { classifyUrgency } from "../_shared/clickup.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { generateJson } from "../_shared/gemini.ts";
import { fetchAustrianNews, fetchAustrianPoliticsNews } from "../_shared/newsapi.ts";
import { isBirthdayThisWeek, isBirthdayToday, isContactOverdue, isEventToday } from "../_shared/calendarToday.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type AdminClient = ReturnType<typeof supabaseAdmin>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    const admin = supabaseAdmin();

    const body = await req.json().catch(() => ({}));
    const isServiceRoleCall = jwt.length > 0 && jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    let userId: string;
    if (isServiceRoleCall) {
      if (!body.user_id) return json({ error: "user_id ist erforderlich bei Service-Role-Aufrufen." }, 400);
      userId = body.user_id;
    } else {
      const { data: userData, error: userError } = await admin.auth.getUser(jwt);
      if (userError || !userData?.user) return json({ error: "Ungueltige Session" }, 401);
      userId = userData.user.id;
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [emailsResult, messagesResult, eventsResult, contactsResult] = await Promise.all([
      admin
        .from("messages_cache")
        .select("sender_name, content_preview, received_at, raw_data, connected_accounts!inner(user_id)")
        .eq("platform", "gmail")
        .eq("is_read", false)
        .eq("connected_accounts.user_id", userId)
        .gte("received_at", since24h),
      admin
        .from("messages_cache")
        .select("platform, sender_name, content_preview, received_at, raw_data, connected_accounts!inner(user_id)")
        .in("platform", ["whatsapp", "slack", "clickup"])
        .eq("is_read", false)
        .eq("connected_accounts.user_id", userId),
      admin
        .from("calendar_events_cache")
        .select("title, start_time, recurrence_rule, location, connected_accounts!inner(user_id)")
        .eq("connected_accounts.user_id", userId),
      admin
        .from("contact_tracking")
        .select("contact_name, last_contacted_at, contact_frequency_days, is_family, birthday")
        .eq("user_id", userId),
    ]);

    const emails = emailsResult.data ?? [];
    const messages = messagesResult.data ?? [];
    const events = eventsResult.data ?? [];
    const contacts = contactsResult.data ?? [];

    const [emailSection, newsSection, messagesSection] = await Promise.all([
      buildEmailSection(emails),
      buildNewsSection(),
      buildMessagesSection(messages),
    ]);
    const calendarSection = buildCalendarSection(events, contacts, messages);

    const sections: Record<string, unknown> = {
      email: emailSection,
      news: newsSection,
      messages: messagesSection,
      calendar: calendarSection,
    };

    const briefDate = new Date().toISOString().slice(0, 10);
    const generatedAt = new Date().toISOString();
    const rows = Object.entries(sections).map(([section, content]) => ({
      user_id: userId,
      brief_date: briefDate,
      section,
      content,
      generated_at: generatedAt,
    }));

    const { error: upsertError } = await admin
      .from("daily_briefs")
      .upsert(rows, { onConflict: "user_id,brief_date,section" });

    if (upsertError) {
      return json({ error: `daily_briefs upsert fehlgeschlagen: ${upsertError.message}` }, 500);
    }

    return json({ ok: true, brief_date: briefDate, generated_at: generatedAt, sections });
  } catch (error) {
    console.error("generate-daily-brief error:", error);
    return json({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }, 500);
  }
});

// ---------- E-Mail-Brief ----------

async function buildEmailSection(emails: any[]) {
  if (emails.length === 0) {
    return { dringend: [], persoenlich: [], newsletter_summary: [], automatisch_count: 0 };
  }

  const emailInput = emails.map((email) => ({
    von: email.sender_name,
    betreff: email.raw_data?.subject ?? "",
    vorschau: email.content_preview,
    kategorie_hinweis: email.raw_data?.category ?? null,
  }));

  const prompt = `Du bist ein persönlicher Assistent. Fasse diese E-Mails zusammen.
Sprache: Deutsch.
Kategorien: DRINGEND (Antwort heute nötig), PERSÖNLICH, NEWSLETTER, AUTOMATISCH.
Für Newsletter: extrahiere die 3 wichtigsten Punkte in je einem Satz.
Antworte als JSON mit Feldern: dringend[], persoenlich[], newsletter_summary[], automatisch_count.
E-Mails: ${JSON.stringify(emailInput)}`;

  return generateJson(prompt, buildEmailFallback(emails));
}

function buildEmailFallback(emails: any[]) {
  const persoenlich: string[] = [];
  const newsletterSummary: string[] = [];
  let automatischCount = 0;

  for (const email of emails) {
    const category = email.raw_data?.category ?? "persoenlich";
    if (category === "newsletter") {
      newsletterSummary.push(email.raw_data?.subject ?? email.sender_name ?? "Newsletter");
    } else if (category === "automatisch") {
      automatischCount++;
    } else {
      persoenlich.push(`${email.sender_name ?? "Unbekannt"}: ${email.raw_data?.subject ?? email.content_preview ?? ""}`);
    }
  }

  return { dringend: [], persoenlich, newsletter_summary: newsletterSummary, automatisch_count: automatischCount };
}

// ---------- News-Brief ----------

async function buildNewsSection() {
  const apiKey = Deno.env.get("NEWS_API_KEY");
  if (!apiKey) {
    return { oesterreich: [], politik: [], error: "NEWS_API_KEY ist serverseitig nicht konfiguriert." };
  }

  let general: Awaited<ReturnType<typeof fetchAustrianNews>> = [];
  let politics: Awaited<ReturnType<typeof fetchAustrianPoliticsNews>> = [];
  try {
    [general, politics] = await Promise.all([fetchAustrianNews(apiKey, 15), fetchAustrianPoliticsNews(apiKey, 15)]);
  } catch (error) {
    console.error("NewsAPI Fehler:", error);
    return {
      oesterreich: [],
      politik: [],
      error: error instanceof Error ? error.message : "NewsAPI nicht erreichbar.",
    };
  }

  if (general.length === 0 && politics.length === 0) {
    return { oesterreich: [], politik: [] };
  }

  const prompt = `Fasse die wichtigsten Nachrichten des Tages zusammen.
Fokus: Österreich, Politik, SPÖ.
Sprache: Deutsch, prägnant.
Antworte als JSON: { oesterreich: [{titel, zusammenfassung, quelle}], politik: [{titel, zusammenfassung, quelle}] }
Nachrichten: ${JSON.stringify({
    oesterreich: general.map((a) => ({ titel: a.title, text: a.description, quelle: a.source })),
    politik: politics.map((a) => ({ titel: a.title, text: a.description, quelle: a.source })),
  })}`;

  const fallback = {
    oesterreich: general.slice(0, 5).map((a) => ({ titel: a.title, zusammenfassung: a.description ?? "", quelle: a.source })),
    politik: politics.slice(0, 3).map((a) => ({ titel: a.title, zusammenfassung: a.description ?? "", quelle: a.source })),
  };

  return generateJson(prompt, fallback);
}

// ---------- Nachrichten-Brief ----------

async function buildMessagesSection(messages: any[]) {
  if (messages.length === 0) {
    return { muss_heute_beantwortet_werden: [], whatsapp: [], slack: [], clickup: [] };
  }

  const input = messages.map((message) => ({
    plattform: message.platform,
    von: message.sender_name,
    inhalt: message.content_preview,
    kontext:
      message.platform === "slack"
        ? message.raw_data?.category
        : message.platform === "whatsapp"
        ? message.raw_data?.is_group
          ? "gruppe"
          : "einzelchat"
        : message.raw_data?.kind,
  }));

  const prompt = `Du bist ein persönlicher Assistent. Hier sind ungelesene Nachrichten aus WhatsApp, Slack und ClickUp.
Priorisiere: was muss heute beantwortet werden?
Sprache: Deutsch.
Antworte als JSON mit Feldern:
muss_heute_beantwortet_werden (Array aus {plattform, von, grund}),
whatsapp (Array aus {von, ist_gruppe (boolean), zusammenfassung}),
slack (Array aus {von, kategorie, zusammenfassung}),
clickup (Array aus {titel, zusammenfassung}).
Nachrichten: ${JSON.stringify(input)}`;

  return generateJson(prompt, buildMessagesFallback(messages));
}

function buildMessagesFallback(messages: any[]) {
  const whatsapp = messages
    .filter((m) => m.platform === "whatsapp")
    .map((m) => ({ von: m.sender_name, ist_gruppe: Boolean(m.raw_data?.is_group), zusammenfassung: m.content_preview }));

  const slack = messages
    .filter((m) => m.platform === "slack")
    .map((m) => ({ von: m.sender_name, kategorie: m.raw_data?.category, zusammenfassung: m.content_preview }));

  const clickup = messages
    .filter((m) => m.platform === "clickup")
    .map((m) => ({
      titel: m.content_preview,
      zusammenfassung: m.raw_data?.kind === "comment_mention" ? `Erwähnung von ${m.sender_name}` : "Task fällig/aktualisiert",
    }));

  const mussHeute = [
    ...messages
      .filter((m) => m.platform === "slack" && ["dm", "mention"].includes(m.raw_data?.category))
      .map((m) => ({ plattform: "slack", von: m.sender_name, grund: "Direktnachricht/Erwähnung" })),
    ...messages
      .filter((m) => m.platform === "clickup" && classifyUrgency(m.raw_data?.due_date ?? null) === "overdue")
      .map((m) => ({ plattform: "clickup", von: m.content_preview, grund: "Task überfällig" })),
  ];

  return { muss_heute_beantwortet_werden: mussHeute, whatsapp, slack, clickup };
}

// ---------- Tages-Vorschau ----------
// Bewusst ohne Gemini: reine strukturierte Daten, die Spec sieht hier keine
// KI-Zusammenfassung vor.

function buildCalendarSection(events: any[], contacts: any[], messages: any[]) {
  const heutigeTermine = events
    .filter((event) => isEventToday(event.start_time, event.recurrence_rule))
    .map((event) => ({ titel: event.title, uhrzeit: event.start_time, ort: event.location }))
    .sort((a, b) => (a.uhrzeit ?? "").localeCompare(b.uhrzeit ?? ""));

  const geburtstageHeute = contacts.filter((c) => isBirthdayToday(c.birthday)).map((c) => c.contact_name);
  const geburtstageDieseWoche = contacts
    .filter((c) => !isBirthdayToday(c.birthday) && isBirthdayThisWeek(c.birthday))
    .map((c) => c.contact_name);
  const ueberfaelligeKontakte = contacts
    .filter((c) => isContactOverdue(c.last_contacted_at, c.contact_frequency_days, c.is_family))
    .map((c) => c.contact_name);

  const clickupFaelligHeute = messages
    .filter((m) => m.platform === "clickup" && m.raw_data?.kind === "task")
    .map((m) => ({ titel: m.content_preview, urgency: classifyUrgency(m.raw_data?.due_date ?? null) }))
    .filter((task) => task.urgency === "due_today" || task.urgency === "overdue");

  return {
    heutige_termine: heutigeTermine,
    geburtstage_heute: geburtstageHeute,
    geburtstage_diese_woche: geburtstageDieseWoche,
    ueberfaellige_kontakte: ueberfaelligeKontakte,
    clickup_faellig_heute: clickupFaelligHeute,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
