// Web Push (VAPID) fuer Browser-Benachrichtigungen, primaer fuer die
// Web-Deployment (life.wrkt.at) - dort greift lib/backgroundSync.ts NICHT
// (expo-background-fetch/-task-manager sind Web nicht verfuegbar). Native
// Builds haben bereits lokale Benachrichtigungen (Paket 8); dieser Kanal ist
// zusaetzlich, plattformuebergreifend und funktioniert auch bei geschlossenem
// Tab/Browser.
//
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY einmalig generieren (z.B. via
// `npx web-push generate-vapid-keys`) und als Supabase Secrets setzen:
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:du@example.com
// VAPID_PUBLIC_KEY muss zusaetzlich als EXPO_PUBLIC_VAPID_PUBLIC_KEY beim
// Web-Build gesetzt werden (siehe lib/pushNotifications.ts) - er ist nicht
// geheim, das ist bei VAPID so vorgesehen.
import webpush from "npm:web-push@3.6.7";

let isConfigured = false;

function ensureConfigured() {
  if (isConfigured) return;
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:noreply@example.com";
  if (!publicKey || !privateKey) {
    throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY nicht gesetzt.");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  isConfigured = true;
}

export type PushSubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };

// Sendet an alle uebergebenen Subscriptions parallel. Abgelaufene/ungueltige
// Subscriptions (410 Gone, 404 Not Found - der Browser hat das Abo beendet)
// werden zurueckgegeben, damit der Aufrufer sie aus push_subscriptions
// loeschen kann statt bei jeder Benachrichtigung erneut ins Leere zu senden.
export async function sendWebPush(
  subscriptions: PushSubscriptionRow[],
  payload: { title: string; body: string; data?: unknown }
): Promise<{ staleSubscriptionIds: string[] }> {
  if (subscriptions.length === 0) return { staleSubscriptionIds: [] };
  ensureConfigured();

  const staleSubscriptionIds: string[] = [];
  const payloadJson = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadJson
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          staleSubscriptionIds.push(sub.id);
        } else {
          console.error("Web-Push fehlgeschlagen fuer Subscription", sub.id, error);
        }
      }
    })
  );

  return { staleSubscriptionIds };
}
