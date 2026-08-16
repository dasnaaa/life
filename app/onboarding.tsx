import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { connectOAuthAccount } from "../lib/connectAccount";
import { supabase } from "../supabase/client";

const STEPS = [
  { key: "google", title: "1. Google verbinden", subtitle: "Gmail & Kalender" },
  { key: "whatsapp", title: "2. WhatsApp verbinden", subtitle: "QR-Code scannen" },
  { key: "work", title: "3. Slack & ClickUp", subtitle: "Arbeit verbinden" },
  { key: "contacts", title: "4. Prioritätskontakte", subtitle: "Wer ist dir wichtig?" },
];

type ContactRow = { id: string; contact_name: string; is_priority: boolean };

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);

  async function withBusy(fn: () => Promise<void>) {
    setIsBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConnectGoogle() {
    await withBusy(async () => {
      await connectOAuthAccount("google-oauth-start", "Privat");
      setMessage("Google verbunden.");
    });
  }

  async function handleConnectSlack() {
    await withBusy(async () => {
      await connectOAuthAccount("slack-oauth-start", "Arbeit");
      setMessage("Slack verbunden.");
    });
  }

  async function handleAnalyzeContacts() {
    await withBusy(async () => {
      await supabase.rpc("refresh_contact_frequency", { p_days_back: 90, p_top_n: 30 });
      const { data } = await supabase.from("contact_tracking").select("id, contact_name, is_priority").limit(15);
      setContacts((data ?? []) as ContactRow[]);
    });
  }

  async function toggleContactPriority(contact: ContactRow) {
    await supabase.from("contact_tracking").update({ is_priority: !contact.is_priority }).eq("id", contact.id);
    setContacts((prev) => prev.map((c) => (c.id === contact.id ? { ...c, is_priority: !c.is_priority } : c)));
  }

  async function handleFinish() {
    await withBusy(async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      await supabase
        .from("user_settings")
        .upsert({ user_id: userData.user.id, has_completed_onboarding: true }, { onConflict: "user_id" });

      await supabase.functions.invoke("generate-daily-brief", { body: {} });
      router.replace("/(tabs)");
    });
  }

  async function handleSkipOnboarding() {
    await withBusy(async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      await supabase
        .from("user_settings")
        .upsert({ user_id: userData.user.id, has_completed_onboarding: true }, { onConflict: "user_id" });
      router.replace("/(tabs)");
    });
  }

  const current = STEPS[step];

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text className="text-2xl font-bold text-slate-50">Willkommen bei Daily Brief</Text>
        <Text className="mt-1 mb-6 text-sm text-slate-400">Verbinde deine Accounts - du kannst jeden Schritt später in den Einstellungen nachholen.</Text>

        <View className="mb-4 flex-row gap-2">
          {STEPS.map((s, i) => (
            <View key={s.key} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-sky-500" : "bg-slate-700"}`} />
          ))}
        </View>

        <Text className="text-lg font-semibold text-slate-50">{current.title}</Text>
        <Text className="mb-4 text-sm text-slate-400">{current.subtitle}</Text>

        {message ? <Text className="mb-3 text-sm text-amber-300">{message}</Text> : null}

        {current.key === "google" ? (
          <Pressable
            onPress={handleConnectGoogle}
            disabled={isBusy}
            className="items-center rounded-lg bg-sky-500 py-3 active:opacity-80 disabled:opacity-50"
          >
            {isBusy ? <ActivityIndicator color="#0F172A" /> : <Text className="font-semibold text-slate-900">Google-Account verbinden</Text>}
          </Pressable>
        ) : null}

        {current.key === "whatsapp" ? (
          <View className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <Text className="text-sm text-slate-300">
              WhatsApp läuft über einen eigenen Service auf deinem Mac oder VPS (whatsapp-service/). Starte ihn dort mit{" "}
              <Text className="font-mono text-sky-300">npm start</Text> und scanne den QR-Code. Die Verbindungsdaten trägst
              du danach in den Einstellungen ein.
            </Text>
          </View>
        ) : null}

        {current.key === "work" ? (
          <View className="gap-3">
            <Pressable
              onPress={handleConnectSlack}
              disabled={isBusy}
              className="items-center rounded-lg bg-sky-500 py-3 active:opacity-80 disabled:opacity-50"
            >
              {isBusy ? <ActivityIndicator color="#0F172A" /> : <Text className="font-semibold text-slate-900">Slack verbinden</Text>}
            </Pressable>
            <Text className="text-center text-xs text-slate-500">ClickUp-Token kannst du in den Einstellungen eintragen.</Text>
          </View>
        ) : null}

        {current.key === "contacts" ? (
          <View>
            <Pressable
              onPress={handleAnalyzeContacts}
              disabled={isBusy}
              className="mb-3 items-center rounded-lg border border-slate-600 py-3 active:opacity-70 disabled:opacity-50"
            >
              {isBusy ? <ActivityIndicator color="#38BDF8" /> : <Text className="text-sm text-slate-200">Kontakte analysieren</Text>}
            </Pressable>
            {contacts.length === 0 ? (
              <Text className="text-sm text-slate-500">Noch keine Kontakte - das kannst du später in den Einstellungen nachholen.</Text>
            ) : (
              contacts.map((contact) => (
                <Pressable
                  key={contact.id}
                  onPress={() => toggleContactPriority(contact)}
                  className="mb-2 flex-row items-center justify-between rounded-lg border border-slate-700 bg-slate-800 p-3"
                >
                  <Text className="text-slate-200">{contact.contact_name}</Text>
                  <Text className={contact.is_priority ? "text-sky-400" : "text-slate-500"}>
                    {contact.is_priority ? "Priorität ✓" : "markieren"}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        ) : null}

        <View className="mt-6 flex-row justify-between">
          <Pressable onPress={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="px-4 py-2 disabled:opacity-30">
            <Text className="text-slate-400">Zurück</Text>
          </Pressable>

          {step < STEPS.length - 1 ? (
            <Pressable onPress={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} className="px-4 py-2">
              <Text className="font-medium text-sky-400">Weiter</Text>
            </Pressable>
          ) : (
            <Pressable onPress={handleFinish} disabled={isBusy} className="rounded-lg bg-emerald-500 px-4 py-2 disabled:opacity-50">
              {isBusy ? <ActivityIndicator color="#0F172A" /> : <Text className="font-semibold text-slate-900">Fertig</Text>}
            </Pressable>
          )}
        </View>

        <Pressable onPress={handleSkipOnboarding} className="mt-4 items-center">
          <Text className="text-xs text-slate-500">Onboarding überspringen</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
