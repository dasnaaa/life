// Verbindungsdaten fuer den lokalen whatsapp-service (Paket 3) - laeuft
// ausserhalb von Supabase auf dem Mac/VPS des Nutzers, daher kennt die App
// dessen URL/API-Key nicht automatisch. Wird geraetelokal in SecureStore
// abgelegt (kein Supabase-Secret - jedes Geraet kann auf einen anderen
// Service zeigen, z.B. "localhost" beim Testen auf demselben Mac vs. eine
// VPS-Domain vom Handy aus).
import * as SecureStore from "expo-secure-store";

const URL_KEY = "whatsapp_service_url";
const API_KEY_KEY = "whatsapp_service_api_key";

export async function getWhatsAppServiceConfig(): Promise<{ url: string | null; apiKey: string | null }> {
  const [url, apiKey] = await Promise.all([
    SecureStore.getItemAsync(URL_KEY),
    SecureStore.getItemAsync(API_KEY_KEY),
  ]);
  return { url, apiKey };
}

export async function setWhatsAppServiceConfig(url: string, apiKey: string): Promise<void> {
  await Promise.all([SecureStore.setItemAsync(URL_KEY, url), SecureStore.setItemAsync(API_KEY_KEY, apiKey)]);
}

export type WhatsAppStatus = {
  status: "starting" | "qr" | "connected" | "disconnected";
  connected: boolean;
  qr: string | null;
  phoneNumber: string | null;
  lastSyncAt: string | null;
  cachedMessageCount: number;
};

export async function fetchWhatsAppStatus(url: string, apiKey: string): Promise<WhatsAppStatus> {
  const response = await fetch(`${url.replace(/\/$/, "")}/status`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Service antwortete mit ${response.status}`);
  }
  return response.json();
}
