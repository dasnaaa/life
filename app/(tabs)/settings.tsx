import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";

import { SectionHeader } from "../../components/SectionHeader";
import { supabase } from "../../supabase/client";

type ConnectedAccount = {
  id: string;
  account_label: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  credentials: { provider_email?: string | null } | null;
};

const APP_REDIRECT = "dailybrief://oauth-callback";

function formatTimestamp(value: string | null): string {
  if (!value) return "noch nie";
  return new Date(value).toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Web: OAuth-Consent in einem Popup oeffnen und warten, bis es sich
// schliesst (die Callback-Function schliesst es selbst nach Erfolg/Fehler).
function openWebAuthPopup(url: string): Promise<void> {
  return new Promise((resolve) => {
    const popup = window.open(url, "daily-brief-google-oauth", "width=480,height=720");
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

export default function SettingsScreen() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const loadAccounts = useCallback(async () => {
    setIsLoadingAccounts(true);
    const { data, error } = await supabase
      .from("connected_accounts")
      .select("id, account_label, is_active, last_synced_at, credentials")
      .eq("provider", "google")
      .order("created_at", { ascending: true });

    if (error) {
      setFeedback({ type: "error", text: `Accounts konnten nicht geladen werden: ${error.message}` });
    } else {
      setAccounts((data ?? []) as ConnectedAccount[]);
    }
    setIsLoadingAccounts(false);
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  async function handleSync(accountId: string) {
    setSyncingAccountId(accountId);
    setFeedback(null);
    try {
      const { data, error } = await supabase.functions.invoke("sync-google", {
        body: { account_id: accountId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setFeedback({ type: "success", text: "Sync abgeschlossen." });
    } catch (error) {
      setFeedback({
        type: "error",
        text: `Sync fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setSyncingAccountId(null);
      loadAccounts();
    }
  }

  async function handleConnect() {
    const label = newLabel.trim();
    if (!label) {
      setFeedback({ type: "error", text: 'Bitte zuerst ein Label eingeben (z.B. "Privat").' });
      return;
    }

    setIsConnecting(true);
    setFeedback(null);
    try {
      const { data, error } = await supabase.functions.invoke("google-oauth-start", {
        body: { account_label: label, platform: Platform.OS === "web" ? "web" : "native" },
      });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error ?? "Keine OAuth-URL erhalten.");

      if (Platform.OS === "web") {
        await openWebAuthPopup(data.url);
      } else {
        await WebBrowser.openAuthSessionAsync(data.url, APP_REDIRECT);
      }

      setNewLabel("");
      await loadAccounts();

      // Neu verbundene Accounts (noch nie gesynct) direkt einmal syncen.
      const { data: fresh } = await supabase
        .from("connected_accounts")
        .select("id, last_synced_at")
        .eq("provider", "google")
        .is("last_synced_at", null);
      for (const account of fresh ?? []) {
        await handleSync(account.id);
      }
    } catch (error) {
      setFeedback({
        type: "error",
        text: `Verbinden fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleToggleActive(account: ConnectedAccount) {
    const { error } = await supabase
      .from("connected_accounts")
      .update({ is_active: !account.is_active })
      .eq("id", account.id);
    if (error) {
      setFeedback({ type: "error", text: `Konnte Status nicht aendern: ${error.message}` });
      return;
    }
    loadAccounts();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <SectionHeader title="Account-Verbindungen" subtitle="Google · WhatsApp, Slack, ClickUp folgen in Paket 3 & 4" />

        {feedback ? (
          <View className="mx-4 mb-3 rounded-xl border border-slate-700 bg-slate-800 p-3">
            <Text className={feedback.type === "error" ? "text-sm text-rose-400" : "text-sm text-emerald-400"}>
              {feedback.text}
            </Text>
          </View>
        ) : null}

        <View className="mx-4 mb-4">
          <Text className="mb-2 text-sm font-medium text-slate-300">Google-Accounts</Text>

          {isLoadingAccounts ? (
            <ActivityIndicator color="#38BDF8" />
          ) : accounts.length === 0 ? (
            <Text className="text-sm text-slate-500">Noch kein Google-Account verbunden.</Text>
          ) : (
            <View className="gap-2">
              {accounts.map((account) => (
                <View key={account.id} className="rounded-xl border border-slate-700 bg-slate-800 p-3">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 pr-3">
                      <Text className="font-medium text-slate-50">{account.account_label ?? "Google Account"}</Text>
                      {account.credentials?.provider_email ? (
                        <Text className="text-xs text-slate-400">{account.credentials.provider_email}</Text>
                      ) : null}
                      <Text className="mt-1 text-xs text-slate-500">
                        Letzter Sync: {formatTimestamp(account.last_synced_at)}
                      </Text>
                    </View>
                    <Switch value={account.is_active} onValueChange={() => handleToggleActive(account)} />
                  </View>

                  <Pressable
                    onPress={() => handleSync(account.id)}
                    disabled={syncingAccountId === account.id || !account.is_active}
                    className="mt-3 items-center rounded-lg border border-slate-600 py-2 active:opacity-70 disabled:opacity-40"
                  >
                    {syncingAccountId === account.id ? (
                      <ActivityIndicator color="#38BDF8" />
                    ) : (
                      <Text className="text-sm text-slate-200">Jetzt syncen</Text>
                    )}
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        <View className="mx-4 rounded-xl border border-slate-700 bg-slate-800 p-3">
          <Text className="mb-2 text-sm font-medium text-slate-300">Google Account hinzufuegen</Text>
          <TextInput
            value={newLabel}
            onChangeText={setNewLabel}
            placeholder='Label, z.B. "Privat" oder "Arbeit SPÖ"'
            placeholderTextColor="#64748B"
            className="mb-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-50"
          />
          <Pressable
            onPress={handleConnect}
            disabled={isConnecting}
            className="items-center rounded-lg bg-sky-500 py-2.5 active:opacity-80 disabled:opacity-50"
          >
            {isConnecting ? (
              <ActivityIndicator color="#0F172A" />
            ) : (
              <Text className="font-semibold text-slate-900">Google Account hinzufuegen</Text>
            )}
          </Pressable>
        </View>

        <Pressable onPress={handleSignOut} className="mx-4 mt-8 items-center rounded-xl border border-rose-900 py-3">
          <Text className="text-sm font-medium text-rose-400">Abmelden</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
