// Generiert einen Nachrichtenvorschlag fuer einen Kontakt via Gemini
// (gemini-1.5-flash, ueber den gemeinsamen summarize()-Helper aus Paket 1
// inkl. Rate-Limit-Fallback). Wird vom Kontakte-Tab aufgerufen, wenn der
// Nutzer bei einem Kontakt auf "Vorschlag generieren" tippt.
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { summarize } from "../_shared/gemini.ts";

const OCCASION_LABELS: Record<string, string> = {
  geburtstag: "Geburtstag",
  lange_nicht_gesprochen: "lange nicht gesprochen",
  nachfrage: "kurze Nachfrage / Check-in",
};

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
    const contactId = body.contact_id as string | undefined;
    const occasion = typeof body.occasion === "string" ? body.occasion : "nachfrage";

    if (!contactId) {
      return json({ error: "contact_id ist erforderlich" }, 400);
    }

    const { data: contact, error: contactError } = await admin
      .from("contact_tracking")
      .select("id, user_id, contact_name, last_contacted_at")
      .eq("id", contactId)
      .maybeSingle();

    if (contactError || !contact) {
      return json({ error: "Kontakt nicht gefunden." }, 404);
    }
    if (contact.user_id !== userData.user.id) {
      return json({ error: "Nicht autorisiert fuer diesen Kontakt." }, 403);
    }

    const tage = contact.last_contacted_at
      ? Math.max(0, Math.floor((Date.now() - new Date(contact.last_contacted_at).getTime()) / (24 * 60 * 60 * 1000)))
      : null;

    const anlassLabel = OCCASION_LABELS[occasion] ?? occasion;

    const prompt = `Schreibe eine kurze, persönliche, authentische Nachricht auf Deutsch.
Nicht förmlich, nicht überschwänglich. Max. 3 Sätze.
Anlass: ${anlassLabel}
Empfänger: ${contact.contact_name}
Letzter Kontakt: ${tage !== null ? `vor ${tage} Tagen` : "unbekannt"}`;

    const fallback =
      occasion === "geburtstag"
        ? `Alles Gute zum Geburtstag, ${contact.contact_name}! Ich hoffe, du hast einen schönen Tag. Lass uns bald mal wieder austauschen.`
        : `Hey ${contact.contact_name}, es ist schon eine Weile her - wie geht's dir gerade? Melde dich gern, wenn du Zeit hast.`;

    const suggestedText = (await summarize(prompt, fallback)).trim();

    const { data: suggestion, error: insertError } = await admin
      .from("message_suggestions")
      .insert({ contact_id: contactId, suggested_text: suggestedText, context: occasion })
      .select("id, suggested_text, context, created_at")
      .single();

    if (insertError || !suggestion) {
      console.error("message_suggestions insert failed:", insertError);
      return json({ error: "Vorschlag konnte nicht gespeichert werden." }, 500);
    }

    return json({ ok: true, suggestion });
  } catch (error) {
    console.error("generate-message-suggestion error:", error);
    return json({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
