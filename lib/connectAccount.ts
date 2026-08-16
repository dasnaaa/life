import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";

import { supabase } from "../supabase/client";

const APP_REDIRECT = "dailybrief://oauth-callback";

// Web: OAuth-Consent in einem Popup oeffnen und warten, bis es sich
// schliesst (die jeweilige *-oauth-callback Edge Function schliesst es
// selbst nach Erfolg/Fehler, siehe supabase/functions/_shared/oauthFinish.ts).
function openWebAuthPopup(url: string): Promise<void> {
  return new Promise((resolve) => {
    const popup = window.open(url, "daily-brief-oauth", "width=480,height=720");
    if (!popup) {
      resolve();
      return;
    }
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        resolve();
      }
    }, 500);
  });
}

// Gemeinsamer OAuth-Popup-Flow fuer Google UND Slack - beide Edge Functions
// (google-oauth-start / slack-oauth-start) folgen demselben Vertrag: nimmt
// { account_label, platform } entgegen, gibt { url } zurueck.
export async function connectOAuthAccount(startFunctionName: string, accountLabel: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke(startFunctionName, {
    body: { account_label: accountLabel, platform: Platform.OS === "web" ? "web" : "native" },
  });
  if (error) throw error;
  if (!data?.url) throw new Error(data?.error ?? "Keine OAuth-URL erhalten.");

  if (Platform.OS === "web") {
    await openWebAuthPopup(data.url);
  } else {
    await WebBrowser.openAuthSessionAsync(data.url, APP_REDIRECT);
  }
}

export async function connectClickUpAccount(accountLabel: string, apiToken: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("clickup-connect", {
    body: { account_label: accountLabel, api_token: apiToken },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}
