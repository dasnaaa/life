// Web-Push-Steuerung fuer die Web-Deployment. Nativ (iOS/Android) bleibt
// weiterhin lib/backgroundSync.ts (lokale Benachrichtigungen via
// expo-notifications) zustaendig - Service Worker/PushManager gibt es dort
// nicht. Auf Web ist das hier der einzige Weg zu Benachrichtigungen, die
// auch bei geschlossenem Tab ankommen.
import { Platform } from "react-native";

import { supabase } from "../supabase/client";

export function isPushSupported(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  return "serviceWorker" in navigator && "PushManager" in window;
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isPushSupported()) return { ok: false, error: "Push-Benachrichtigungen werden von diesem Browser nicht unterstützt." };

  const vapidPublicKey = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) return { ok: false, error: "EXPO_PUBLIC_VAPID_PUBLIC_KEY ist nicht konfiguriert." };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { ok: false, error: "Berechtigung für Benachrichtigungen wurde nicht erteilt." };
    }

    const registration = await navigator.serviceWorker.register("/service-worker.js");
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { ok: false, error: "Nicht eingeloggt." };

    const { error } = await supabase.functions.invoke("save-push-subscription", {
      body: { subscription: subscription.toJSON() },
    });
    if (error) return { ok: false, error: error.message };

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function unsubscribeFromPush(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const subscription = await getCurrentPushSubscription();
    if (!subscription) return { ok: true };

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();

    const { error } = await supabase.functions.invoke("save-push-subscription", {
      body: { unsubscribe: true, endpoint },
    });
    if (error) return { ok: false, error: error.message };

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// PushManager.subscribe() erwartet den VAPID Public Key als Uint8Array, wir
// generieren/speichern ihn aber als base64url-String (siehe .env.example).
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}
