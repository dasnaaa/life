// Terminkoordination mit Kinderbetreuung (Paket 12): Freundin schlaegt per
// WhatsApp einen Termin vor -> Kalender pruefen -> Anfrage an die
// Kinderbetreuung formulieren -> Antwort auswerten -> Termin eintragen +
// Freundin bestaetigen. Absichtlich NICHT vollautomatisch - jeder Versand
// wird vom Nutzer im Client ausgeloest (siehe lib/whatsappService.ts), diese
// Funktionen bereiten nur Text/Status vor.
import { generateJson } from "./gemini.ts";

type AdminClient = ReturnType<typeof import("./supabaseAdmin.ts").supabaseAdmin>;

const VIENNA_TZ = "Europe/Vienna";

function viennaNowContext(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("de-AT", { timeZone: VIENNA_TZ, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" });
  return dateStr;
}

// ---------- 1. Erkennung: ist das ueberhaupt ein Terminvorschlag? ----------

type ProposalDetection = { is_date_proposal: boolean; proposed_time_text: string | null; proposed_time_iso: string | null };

async function detectDateProposal(messageText: string): Promise<ProposalDetection> {
  const prompt = `Heute ist ${viennaNowContext()} (Zeitzone Europe/Vienna).

Nachricht von einem Kontakt: "${messageText}"

Schlaegt diese Nachricht ein konkretes Treffen/Date/Verabredung zu einem bestimmten Zeitpunkt vor (z.B. "Hast du am Freitag Zeit?", "Lust auf einen Kaffee morgen Nachmittag?", "Wollen wir uns Samstagabend treffen?")? Reine Grussnachrichten, Fragen ohne Zeitbezug oder Gruppenchat-Smalltalk zaehlen NICHT.

Gib zurueck:
- is_date_proposal: true/false
- proposed_time_text: die im Text erwaehnte Zeitangabe woertlich (z.B. "Freitagabend"), oder null
- proposed_time_iso: ISO-8601 Datum+Uhrzeit (Europe/Vienna), aus dem Kontext berechnet ausgehend von heute; wenn keine Uhrzeit genannt wird, 19:00 annehmen; null falls kein Datum erkennbar ist`;

  return generateJson<ProposalDetection>(prompt, {
    is_date_proposal: false,
    proposed_time_text: null,
    proposed_time_iso: null,
  });
}

// ---------- 2. Entwurf: Nachricht an die Kinderbetreuung ----------

async function draftChildcareMessage(friendName: string, proposedTimeText: string, childcareContactName: string): Promise<string> {
  const prompt = `Ich moechte mich mit ${friendName} treffen (${proposedTimeText || "Termin noch unklar"}) und brauche dafuer Kinderbetreuung.

Formuliere eine kurze, herzliche WhatsApp-Nachricht an ${childcareContactName}, die fragt, ob an diesem Termin Zeit fuer die Kinderbetreuung waere. Locker und direkt, auf Deutsch, ohne foermliche Anrede-Floskeln, maximal 2-3 Saetze.

Antworte als JSON: { "message": string }`;

  const result = await generateJson<{ message: string }>(prompt, {
    message: `Hallo! Hättest du am ${proposedTimeText || "vorgeschlagenen Termin"} Zeit für die Kinder? Wollte mich mit ${friendName} treffen. Liebe Grüße!`,
  });
  return result.message;
}

// ---------- 3. Antwort der Kinderbetreuung auswerten ----------

type ReplyClassification = { available: boolean | null; summary: string };

async function classifyChildcareReply(askedMessage: string, replyText: string): Promise<ReplyClassification> {
  const prompt = `Ich hatte gefragt: "${askedMessage}"
Antwort: "${replyText}"

Ist die Person fuer die Kinderbetreuung verfuegbar? Antworte als JSON:
{ "available": true/false/null (null nur wenn wirklich unklar), "summary": string (eine kurze Zusammenfassung der Antwort auf Deutsch) }`;

  return generateJson<ReplyClassification>(prompt, { available: null, summary: replyText.slice(0, 200) });
}

// ---------- 4. Entwurf: Bestaetigung an die Freundin ----------

async function draftFriendConfirmation(friendName: string, proposedTimeText: string): Promise<string> {
  const prompt = `Die Kinderbetreuung ist organisiert. Formuliere eine kurze, freundliche WhatsApp-Nachricht an ${friendName}, dass ich am ${proposedTimeText || "vorgeschlagenen Termin"} Zeit habe und mich freue. Auf Deutsch, locker, maximal 2 Saetze.

Antworte als JSON: { "message": string }`;

  const result = await generateJson<{ message: string }>(prompt, {
    message: `Hey! Ich habe die Kinderbetreuung organisiert - ${proposedTimeText || "der Termin"} passt bei mir! Freu mich schon 😊`,
  });
  return result.message;
}

// ---------- Orchestrierung ----------

type NewMessage = {
  id: string;
  content_preview: string;
  sender_name: string | null;
  sender_id: string | null;
};

// Wird aus sync-whatsapp fuer jede NEU eingegangene Nachricht aufgerufen, die
// nicht von einem Familien- oder Kinderbetreuungs-Kontakt kommt (siehe
// Aufrufer). Legt bei erkanntem Terminvorschlag direkt eine
// coordination_requests-Zeile inkl. fertigem Entwurf + Kalender-Konfliktcheck
// an - kein zweiter Cron-Durchlauf noetig.
export async function detectAndDraftCoordination(admin: AdminClient, userId: string, message: NewMessage): Promise<void> {
  if (!message.content_preview || !message.sender_id) return;

  const detection = await detectDateProposal(message.content_preview);
  if (!detection.is_date_proposal) return;

  const { data: childcareContact } = await admin
    .from("contact_tracking")
    .select("id, contact_name")
    .eq("user_id", userId)
    .eq("is_childcare_contact", true)
    .limit(1)
    .maybeSingle();

  // Ohne hinterlegten Kinderbetreuungs-Kontakt gibt es niemanden zu fragen -
  // dann lieber gar keine Anfrage anlegen als eine, die nirgendwo hinfuehrt.
  if (!childcareContact) return;

  let hasCalendarConflict = false;
  if (detection.proposed_time_iso) {
    const proposedDate = new Date(detection.proposed_time_iso);
    const windowStart = new Date(proposedDate.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(proposedDate.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("calendar_events_cache")
      .select("id", { count: "exact", head: true })
      .lt("start_time", windowEnd)
      .gt("end_time", windowStart);
    hasCalendarConflict = (count ?? 0) > 0;
  }

  const friendName = message.sender_name || "Unbekannt";
  const childcareDraft = await draftChildcareMessage(
    friendName,
    detection.proposed_time_text ?? "",
    childcareContact.contact_name
  );

  const { error: insertError } = await admin.from("coordination_requests").insert({
    user_id: userId,
    friend_name: friendName,
    friend_whatsapp_id: message.sender_id,
    source_message_id: message.id,
    childcare_contact_id: childcareContact.id,
    proposed_time_text: detection.proposed_time_text,
    proposed_time: detection.proposed_time_iso,
    has_calendar_conflict: hasCalendarConflict,
    status: "childcare_draft_ready",
    childcare_message_draft: childcareDraft,
  });

  if (insertError) {
    console.error("coordination_requests insert fehlgeschlagen:", insertError);
    return;
  }

  const { notify } = await import("./notify.ts");
  await notify(
    admin,
    userId,
    "coordination",
    "Neuer Terminvorschlag erkannt",
    `${friendName} schlägt ${detection.proposed_time_text ?? "einen Termin"} vor. Entwurf für die Kinderbetreuung ist bereit.`,
    { proposed_time_text: detection.proposed_time_text }
  );
}

// Wird aus sync-whatsapp fuer jede NEU eingegangene Nachricht aufgerufen, die
// von einem Kinderbetreuungs-Kontakt kommt, waehrend eine coordination_request
// im Status "childcare_sent" auf genau diese Antwort wartet.
export async function classifyIncomingChildcareReply(
  admin: AdminClient,
  userId: string,
  senderContactId: string,
  replyText: string
): Promise<void> {
  const { data: pending } = await admin
    .from("coordination_requests")
    .select("id, childcare_message_draft, friend_name, proposed_time_text")
    .eq("user_id", userId)
    .eq("childcare_contact_id", senderContactId)
    .eq("status", "childcare_sent")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pending) return;

  const classification = await classifyChildcareReply(pending.childcare_message_draft ?? "", replyText);
  const newStatus = classification.available === true ? "childcare_confirmed" : classification.available === false ? "childcare_declined" : "childcare_sent";

  const update: Record<string, unknown> = {
    childcare_reply_text: replyText,
    childcare_reply_available: classification.available,
    updated_at: new Date().toISOString(),
  };
  if (newStatus !== "childcare_sent") update.status = newStatus;

  if (newStatus === "childcare_confirmed") {
    update.friend_confirmation_draft = await draftFriendConfirmation(pending.friend_name, pending.proposed_time_text ?? "");
  }

  await admin.from("coordination_requests").update(update).eq("id", pending.id);

  const { notify } = await import("./notify.ts");
  await notify(
    admin,
    userId,
    "coordination",
    newStatus === "childcare_confirmed" ? "Kinderbetreuung bestätigt" : newStatus === "childcare_declined" ? "Kinderbetreuung hat abgesagt" : "Antwort erhalten",
    classification.summary,
    { coordination_request_id: pending.id }
  );
}
