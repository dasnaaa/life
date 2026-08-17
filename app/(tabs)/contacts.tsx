import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";

import { ContactCard } from "../../components/ContactCard";
import { EmptyState } from "../../components/EmptyState";
import { SectionHeader } from "../../components/SectionHeader";
import { SkeletonList } from "../../components/Skeleton";
import { colors } from "../../constants/colors";
import { classifyContactStatus, daysSince, daysUntilNextBirthday, effectiveThreshold } from "../../lib/contactStatus";
import { supabase } from "../../supabase/client";

type ContactRow = {
  id: string;
  contact_name: string;
  contact_identifier: string | null;
  platform: string | null;
  last_contacted_at: string | null;
  contact_frequency_days: number | null;
  is_priority: boolean;
  is_family: boolean;
  birthday: string | null;
};

const OCCASIONS = [
  { key: "geburtstag", label: "Geburtstag" },
  { key: "lange_nicht_gesprochen", label: "Lange nicht gesprochen" },
  { key: "nachfrage", label: "Kurze Nachfrage" },
];

export default function ContactsScreen() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestion, setSuggestion] = useState<{ contactId: string; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("contact_tracking")
      .select(
        "id, contact_name, contact_identifier, platform, last_contacted_at, contact_frequency_days, is_priority, is_family, birthday"
      )
      .order("contact_name", { ascending: true });

    if (!error) setContacts((data ?? []) as ContactRow[]);
    setIsLoading(false);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
  }

  async function handleAnalyze() {
    setIsAnalyzing(true);
    await supabase.rpc("refresh_contact_frequency", { p_days_back: 90, p_top_n: 30 });
    await load();
    setIsAnalyzing(false);
  }

  async function handleGenerate(contactId: string, occasion: string) {
    setIsGenerating(true);
    setSuggestion(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-message-suggestion", {
        body: { contact_id: contactId, occasion },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSuggestion({ contactId, text: data.suggestion.suggested_text });
    } catch (error) {
      setSuggestion({
        contactId,
        text: `Fehler: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleCopy(text: string, contactId: string) {
    await Clipboard.setStringAsync(text);
    setCopiedId(contactId);
    setTimeout(() => setCopiedId((current) => (current === contactId ? null : current)), 2000);
  }

  if (isLoading) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
        <SectionHeader title="Kontakte" />
        <SkeletonList />
      </SafeAreaView>
    );
  }

  const withStatus = contacts.map((contact) => {
    const days = daysSince(contact.last_contacted_at);
    const threshold = effectiveThreshold(contact.contact_frequency_days, contact.is_family);
    return { ...contact, days, threshold, status: classifyContactStatus(days, threshold) };
  });

  const priorityContacts = withStatus
    .filter((c) => c.is_priority || c.is_family)
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1));

  const birthdaysThisWeek = withStatus
    .map((c) => ({ ...c, daysUntil: daysUntilNextBirthday(c.birthday) }))
    .filter((c) => c.daysUntil !== null && c.daysUntil <= 7)
    .sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0));

  const birthdaysNextWeek = withStatus
    .map((c) => ({ ...c, daysUntil: daysUntilNextBirthday(c.birthday) }))
    .filter((c) => c.daysUntil !== null && c.daysUntil! > 7 && c.daysUntil! <= 14)
    .sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0));

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
      >
        <View className="flex-row items-center justify-between px-4 pt-4">
          <Text className="text-2xl font-bold text-slate-50">Kontakte</Text>
          <Pressable
            onPress={handleAnalyze}
            disabled={isAnalyzing}
            className="rounded-lg bg-sky-500 px-3 py-2 active:opacity-80 disabled:opacity-50"
          >
            {isAnalyzing ? (
              <ActivityIndicator color="#0F172A" />
            ) : (
              <Text className="text-sm font-semibold text-slate-900">Kontakte aktualisieren</Text>
            )}
          </Pressable>
        </View>

        {(birthdaysThisWeek.length > 0 || birthdaysNextWeek.length > 0) && (
          <>
            <SectionHeader title="Geburtstage" subtitle="Diese Woche & nächste Woche" />
            {birthdaysThisWeek.map((c) => (
              <View key={c.id} className="mx-4 mb-2 flex-row items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                <Text className="font-medium text-slate-50">{c.contact_name}</Text>
                <Text className="text-xs text-amber-300">
                  {c.daysUntil === 0 ? "Heute!" : `in ${c.daysUntil} ${c.daysUntil === 1 ? "Tag" : "Tagen"}`}
                </Text>
              </View>
            ))}
            {birthdaysNextWeek.map((c) => (
              <View key={c.id} className="mx-4 mb-2 flex-row items-center justify-between rounded-xl border border-slate-700 bg-slate-800 p-3">
                <Text className="font-medium text-slate-50">{c.contact_name}</Text>
                <Text className="text-xs text-slate-400">in {c.daysUntil} Tagen</Text>
              </View>
            ))}
          </>
        )}

        <SectionHeader title="Prioritätskontakte" subtitle="Familie & manuell markierte Kontakte" />
        {priorityContacts.length === 0 ? (
          <EmptyState
            icon="star-outline"
            title="Noch keine Prioritätskontakte"
            subtitle="Markiere Kontakte weiter unten oder in den Einstellungen."
          />
        ) : (
          priorityContacts.map((contact) => (
            <View key={contact.id}>
              <Pressable onPress={() => setActiveContactId(activeContactId === contact.id ? null : contact.id)}>
                <ContactCard
                  name={contact.contact_name}
                  daysSinceContact={contact.days ?? 0}
                  normalFrequencyDays={contact.threshold}
                  isPriority={contact.is_priority}
                />
              </Pressable>

              {activeContactId === contact.id ? (
                <View className="mx-4 mb-3 rounded-xl border border-slate-700 bg-slate-800 p-3">
                  <Text className="mb-2 text-xs font-semibold uppercase text-slate-500">Nachrichtenvorschlag</Text>
                  <View className="mb-2 flex-row flex-wrap gap-2">
                    {OCCASIONS.map((occasion) => (
                      <Pressable
                        key={occasion.key}
                        onPress={() => handleGenerate(contact.id, occasion.key)}
                        disabled={isGenerating}
                        className="rounded-full border border-slate-600 px-3 py-1 active:opacity-70 disabled:opacity-50"
                      >
                        <Text className="text-xs text-slate-300">{occasion.label}</Text>
                      </Pressable>
                    ))}
                  </View>

                  {isGenerating ? <ActivityIndicator color="#38BDF8" /> : null}

                  {suggestion && suggestion.contactId === contact.id ? (
                    <View className="rounded-lg bg-slate-900 p-3">
                      <Text className="text-sm text-slate-200">{suggestion.text}</Text>
                      <Pressable
                        onPress={() => handleCopy(suggestion.text, contact.id)}
                        className="mt-2 items-center rounded-lg border border-slate-600 py-2 active:opacity-70"
                      >
                        <Text className="text-xs text-slate-300">
                          {copiedId === contact.id ? "Kopiert ✓" : "Kopieren"}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          ))
        )}

        <SectionHeader title="Alle Kontakte" />
        {withStatus.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title="Noch keine Kontakte analysiert"
            subtitle='Tippe oben auf „Kontakte aktualisieren", um sie aus deinen Nachrichten zu erkennen.'
          />
        ) : (
          withStatus.map((contact) => (
            <ContactCard
              key={contact.id}
              name={contact.contact_name}
              daysSinceContact={contact.days ?? 0}
              normalFrequencyDays={contact.threshold}
              isPriority={contact.is_priority}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
