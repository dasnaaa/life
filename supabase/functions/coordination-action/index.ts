// Statusuebergaenge fuer die Terminkoordination (Paket 12), vom Nutzer im
// Client ausgeloest. Der eigentliche WhatsApp-Versand passiert davor/danach
// direkt im Client via lib/whatsappService.ts (der lokale whatsapp-service
// ist von Supabase aus nicht erreichbar) - diese Funktion bucht nur den
// jeweils naechsten Schritt.
import { corsHeaders } from "../_shared/cors.ts";
import { createCalendarEvent, getValidAccessToken } from "../_shared/google.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type AdminClient = ReturnType<typeof supabaseAdmin>;

const EVENT_DURATION_MS = 2 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    const admin = supabaseAdmin();

    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData?.user) {
      return json({ error: "Ungueltige Session" }, 401);
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const coordinationId = body.coordination_id as string | undefined;
    const action = body.action as string | undefined;

    if (!coordinationId || !action) {
      return json({ error: "coordination_id und action sind erforderlich." }, 400);
    }

    const { data: coordination, error: fetchError } = await admin
      .from("coordination_requests")
      .select("*")
      .eq("id", coordinationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError || !coordination) {
      return json({ error: "Terminanfrage nicht gefunden." }, 404);
    }

    switch (action) {
      case "childcare_sent":
        return await handleChildcareSent(admin, coordination);
      case "confirm_calendar":
        return await handleConfirmCalendar(admin, userId, coordination);
      case "friend_notified":
        return await handleFriendNotified(admin, coordination);
      case "cancel":
        await admin.from("coordination_requests").update({ status: "cancelled" }).eq("id", coordinationId);
        return json({ ok: true, status: "cancelled" });
      default:
        return json({ error: `Unbekannte action: ${action}` }, 400);
    }
  } catch (error) {
    console.error("coordination-action error:", error);
    return json({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }, 500);
  }
});

async function handleChildcareSent(admin: AdminClient, coordination: any) {
  if (coordination.status !== "childcare_draft_ready") {
    return json({ error: `Ungueltiger Status fuer diesen Schritt: ${coordination.status}` }, 400);
  }
  await admin.from("coordination_requests").update({ status: "childcare_sent" }).eq("id", coordination.id);
  return json({ ok: true, status: "childcare_sent" });
}

async function handleConfirmCalendar(admin: AdminClient, userId: string, coordination: any) {
  if (coordination.status !== "childcare_confirmed") {
    return json({ error: `Ungueltiger Status fuer diesen Schritt: ${coordination.status}` }, 400);
  }
  if (!coordination.proposed_time) {
    return json({ error: "Kein Zeitpunkt fuer den Termin erkannt - bitte manuell im Kalender eintragen." }, 400);
  }

  const { data: googleAccount } = await admin
    .from("connected_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!googleAccount) {
    return json({ error: "Kein aktiver Google-Account verbunden - Termin kann nicht angelegt werden." }, 400);
  }

  const startTime = new Date(coordination.proposed_time);
  const endTime = new Date(startTime.getTime() + EVENT_DURATION_MS);

  const accessToken = await getValidAccessToken(googleAccount.id);
  const created = await createCalendarEvent(accessToken, {
    title: `${coordination.friend_name} treffen`,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    description: "Automatisch angelegt von Daily Brief (Terminkoordination).",
  });

  const { data: cachedEvent, error: cacheError } = await admin
    .from("calendar_events_cache")
    .insert({
      account_id: googleAccount.id,
      event_id: created.id,
      title: `${coordination.friend_name} treffen`,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
    })
    .select("id")
    .single();

  if (cacheError) {
    console.error("calendar_events_cache insert fehlgeschlagen:", cacheError);
  }

  await admin
    .from("coordination_requests")
    .update({ status: "calendar_confirmed", calendar_event_id: cachedEvent?.id ?? null })
    .eq("id", coordination.id);

  return json({ ok: true, status: "calendar_confirmed", event_link: created.htmlLink });
}

async function handleFriendNotified(admin: AdminClient, coordination: any) {
  if (coordination.status !== "calendar_confirmed") {
    return json({ error: `Ungueltiger Status fuer diesen Schritt: ${coordination.status}` }, 400);
  }
  await admin.from("coordination_requests").update({ status: "friend_notified" }).eq("id", coordination.id);
  return json({ ok: true, status: "friend_notified" });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
