// Hintergrund-Sync + lokale Push-Benachrichtigungen (Paket 8).
//
// Wichtige Einschraenkung: expo-background-fetch/-task-manager funktionieren
// nur in einem Dev- oder EAS-Build zuverlaessig, NICHT in Expo Go. Auch dort
// entscheidet am Ende das Betriebssystem (iOS/Android), wann der Task
// tatsaechlich laeuft - "alle 15 Minuten" ist ein Wunsch, keine Garantie.
import * as BackgroundFetch from "expo-background-fetch";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";

import { classifyContactStatus, daysSince, effectiveThreshold } from "./contactStatus";
import { supabase } from "../supabase/client";

export const BACKGROUND_SYNC_TASK = "daily-brief-background-sync";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    const foundSomething = await checkForNotifiableUpdates();
    return foundSomething ? BackgroundFetch.BackgroundFetchResult.NewData : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (error) {
    console.error("Background sync failed:", error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

async function notify(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
}

// Prueft die drei in der Spec genannten Signale: neue dringende Nachricht /
// Geburtstag heute / ueberfaelliger Kontakt. Gibt true zurueck, wenn
// mindestens eine Benachrichtigung ausgeloest wurde.
async function checkForNotifiableUpdates(): Promise<boolean> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return false;

  let foundSomething = false;

  const { data: urgentMessages } = await supabase
    .from("messages_cache")
    .select("id, platform, sender_name, raw_data")
    .eq("is_read", false)
    .in("platform", ["whatsapp", "slack"])
    .order("received_at", { ascending: false })
    .limit(10);

  const urgent = (urgentMessages ?? []).find(
    (m) => m.platform === "whatsapp" || m.raw_data?.category === "dm" || m.raw_data?.category === "mention"
  );
  if (urgent) {
    await notify("Neue wichtige Nachricht", `${urgent.sender_name ?? "Jemand"} hat dir geschrieben.`);
    foundSomething = true;
  }

  const { data: contacts } = await supabase
    .from("contact_tracking")
    .select("contact_name, birthday, last_contacted_at, contact_frequency_days, is_family");

  const today = new Date();
  const birthdayToday = (contacts ?? []).find((c) => {
    if (!c.birthday) return false;
    const b = new Date(c.birthday);
    return b.getMonth() === today.getMonth() && b.getDate() === today.getDate();
  });
  if (birthdayToday) {
    await notify("Geburtstag heute 🎂", `${birthdayToday.contact_name} hat heute Geburtstag.`);
    foundSomething = true;
  }

  const overdue = (contacts ?? []).find((c) => {
    const days = daysSince(c.last_contacted_at);
    const threshold = effectiveThreshold(c.contact_frequency_days, Boolean(c.is_family));
    return classifyContactStatus(days, threshold) === "overdue";
  });
  if (overdue) {
    await notify("Lange nicht gesprochen", `Du hast schon lange nichts mehr von ${overdue.contact_name} gehoert.`);
    foundSomething = true;
  }

  return foundSomething;
}

export async function registerBackgroundSync(): Promise<void> {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      return;
    }

    await Notifications.requestPermissionsAsync();

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
        minimumInterval: 15 * 60,
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch (error) {
    // Auf Web bzw. in Expo Go nicht verfuegbar - bewusst kein harter Fehler.
    console.warn("Background-Sync konnte nicht registriert werden:", error);
  }
}
