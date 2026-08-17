// Zentrale Anlaufstelle fuers Benachrichtigen eines Nutzers: schreibt immer
// in die notifications-Tabelle (In-App-Glocke, plattformunabhaengig) und
// versucht zusaetzlich Web-Push, falls Subscriptions vorhanden sind. Ein
// Fehlschlag beim Push darf niemals den Aufrufer (z.B. generate-daily-brief)
// zum Scheitern bringen - Benachrichtigen ist ein Nice-to-have, kein
// kritischer Pfad.
import { sendWebPush } from "./webpush.ts";

type AdminClient = ReturnType<typeof import("./supabaseAdmin.ts").supabaseAdmin>;

export type NotificationType =
  | "daily_brief"
  | "urgent_message"
  | "birthday"
  | "contact_overdue"
  | "course_ending"
  | "coordination";

export async function notify(
  admin: AdminClient,
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  data?: unknown
): Promise<void> {
  const { error: insertError } = await admin
    .from("notifications")
    .insert({ user_id: userId, type, title, body, data: data ?? null });
  if (insertError) {
    console.error("notifications insert fehlgeschlagen:", insertError);
  }

  try {
    const { data: subscriptions } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    if (!subscriptions || subscriptions.length === 0) return;

    const { staleSubscriptionIds } = await sendWebPush(subscriptions, { title, body, data });

    if (staleSubscriptionIds.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", staleSubscriptionIds);
    }
  } catch (error) {
    console.error("Web-Push fehlgeschlagen (Benachrichtigung wurde trotzdem in-app gespeichert):", error);
  }
}
