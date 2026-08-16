// Analysiert alle wiederkehrenden Calendar-Events des Nutzers mit Gemini
// und erkennt darunter moegliche Kinder-Kurse/Aktivitaeten (Schwimmkurs,
// Musikschule, Sport, ...). Speichert Ergebnisse in detected_courses.
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { generateJson } from "../_shared/gemini.ts";

type CourseSuggestion = {
  event_id: string;
  titel: string;
  frequenz: string;
  geschaetztes_ende: string | null;
  anmeldung_noetig: boolean;
  begruendung: string;
};

const KIDS_ACTIVITY_KEYWORDS =
  /kurs|schwimm|musikschule|ballett|tanz(?:en|kurs)?|training|fussball|fußball|turnen|reiten|klavier|geige|malkurs|kinderturnen|schach|yoga.*kind/i;

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

    const { data: events, error: eventsError } = await admin
      .from("calendar_events_cache")
      .select("id, title, start_time, recurrence_rule, connected_accounts!inner(user_id)")
      .eq("connected_accounts.user_id", userData.user.id)
      .not("recurrence_rule", "is", null)
      .limit(150);

    if (eventsError) {
      return json({ error: `Kalender-Events konnten nicht geladen werden: ${eventsError.message}` }, 500);
    }

    const recurringEvents = (events ?? []).map((event) => ({
      id: event.id as string,
      title: event.title as string,
      start_time: event.start_time as string | null,
      recurrence_rule: event.recurrence_rule as string | null,
    }));

    if (recurringEvents.length === 0) {
      return json({ ok: true, detected: 0, message: "Keine wiederkehrenden Events gefunden." });
    }

    const prompt = `Analysiere diese Liste von Kalender-Events.
Identifiziere alle wiederkehrenden Aktivitäten die Kurse oder
Aktivitäten für Kinder sein könnten.
Antworte als JSON-Array mit Feldern:
event_id, titel, frequenz, geschaetztes_ende, anmeldung_noetig (boolean), begruendung
Nutze für event_id exakt die "id" aus der untenstehenden Event-Liste.
Events: ${JSON.stringify(
      recurringEvents.map((e) => ({
        id: e.id,
        titel: e.title,
        start: e.start_time,
        wiederholung: e.recurrence_rule,
      }))
    )}`;

    const fallback = heuristicFallback(recurringEvents);
    const suggestions = await generateJson<CourseSuggestion[]>(prompt, fallback);

    const validEventIds = new Set(recurringEvents.map((e) => e.id));
    const rows = (Array.isArray(suggestions) ? suggestions : fallback)
      .filter((suggestion) => suggestion && validEventIds.has(suggestion.event_id))
      .map((suggestion) => ({
        user_id: userData.user.id,
        calendar_event_id: suggestion.event_id,
        title: suggestion.titel,
        frequency: suggestion.frequenz ?? null,
        estimated_end_text: suggestion.geschaetztes_ende ?? null,
        requires_signup: Boolean(suggestion.anmeldung_noetig),
        reasoning: suggestion.begruendung ?? null,
        updated_at: new Date().toISOString(),
      }));

    if (rows.length > 0) {
      const { error: upsertError } = await admin
        .from("detected_courses")
        .upsert(rows, { onConflict: "user_id,calendar_event_id" });
      if (upsertError) {
        return json({ error: `detected_courses upsert fehlgeschlagen: ${upsertError.message}` }, 500);
      }
    }

    return json({ ok: true, detected: rows.length });
  } catch (error) {
    console.error("analyze-calendar error:", error);
    return json({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }, 500);
  }
});

function heuristicFallback(
  events: { id: string; title: string; recurrence_rule: string | null }[]
): CourseSuggestion[] {
  return events
    .filter((event) => KIDS_ACTIVITY_KEYWORDS.test(event.title))
    .map((event) => ({
      event_id: event.id,
      titel: event.title,
      frequenz: event.recurrence_rule ?? "unbekannt",
      geschaetztes_ende: null,
      anmeldung_noetig: false,
      begruendung: "Automatisch per Stichwort erkannt (Gemini nicht verfügbar).",
    }));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
