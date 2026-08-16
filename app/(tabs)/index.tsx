import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BriefCard } from "../../components/BriefCard";
import { SectionHeader } from "../../components/SectionHeader";
import { supabase } from "../../supabase/client";

type BriefRow = {
  section: "email" | "news" | "messages" | "calendar";
  content: any;
  generated_at: string;
};

function formatTimestamp(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}

function emailSummary(content: any): string {
  if (!content) return "Noch nicht generiert.";
  const dringend = content.dringend?.length ?? 0;
  const persoenlich = content.persoenlich?.length ?? 0;
  const automatisch = content.automatisch_count ?? 0;
  if (dringend + persoenlich + automatisch === 0) return "Keine ungelesenen E-Mails der letzten 24h.";
  return `${dringend} dringend · ${persoenlich} persönlich · ${automatisch} automatisch`;
}

function newsSummary(content: any): string {
  if (!content) return "Noch nicht generiert.";
  if (content.error) return `Nicht verfügbar: ${content.error}`;
  const at = content.oesterreich?.length ?? 0;
  const politik = content.politik?.length ?? 0;
  return `${at} Meldungen Österreich · ${politik} Politik`;
}

function messagesSummary(content: any): string {
  if (!content) return "Noch nicht generiert.";
  const heute = content.muss_heute_beantwortet_werden?.length ?? 0;
  const total = (content.whatsapp?.length ?? 0) + (content.slack?.length ?? 0) + (content.clickup?.length ?? 0);
  if (total === 0) return "Keine ungelesenen Nachrichten.";
  return `${heute} brauchen heute eine Antwort · ${total} insgesamt`;
}

function calendarSummary(content: any): string {
  if (!content) return "Noch nicht generiert.";
  const termine = content.heutige_termine?.length ?? 0;
  const geburtstage = (content.geburtstage_heute?.length ?? 0) + (content.geburtstage_diese_woche?.length ?? 0);
  const ueberfaellig = content.ueberfaellige_kontakte?.length ?? 0;
  return `${termine} Termine heute · ${geburtstage} Geburtstage · ${ueberfaellig} überfällige Kontakte`;
}

export default function DashboardScreen() {
  const [sections, setSections] = useState<Record<string, BriefRow>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("daily_briefs")
      .select("section, content, generated_at")
      .eq("brief_date", today);

    if (!error) {
      const map: Record<string, BriefRow> = {};
      for (const row of (data ?? []) as BriefRow[]) map[row.section] = row;
      setSections(map);
    }
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

  async function handleGenerate() {
    setIsGenerating(true);
    try {
      await supabase.functions.invoke("generate-daily-brief", { body: {} });
    } finally {
      await load();
      setIsGenerating(false);
    }
  }

  if (isLoading) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 items-center justify-center bg-slate-900">
        <ActivityIndicator color="#38BDF8" />
      </SafeAreaView>
    );
  }

  const hasAnyBrief = Object.keys(sections).length > 0;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#38BDF8" />}
      >
        <View className="flex-row items-center justify-between px-4 pt-4">
          <View>
            <Text className="text-2xl font-bold text-slate-50">Daily Brief</Text>
            <Text className="mt-1 text-sm text-slate-400">
              {hasAnyBrief ? "Heutiger Brief" : "Noch kein Brief für heute generiert."}
            </Text>
          </View>
          <Pressable
            onPress={handleGenerate}
            disabled={isGenerating}
            className="rounded-lg bg-sky-500 px-3 py-2 active:opacity-80 disabled:opacity-50"
          >
            {isGenerating ? (
              <ActivityIndicator color="#0F172A" />
            ) : (
              <Text className="text-sm font-semibold text-slate-900">Neu generieren</Text>
            )}
          </Pressable>
        </View>

        <SectionHeader title="E-Mail" />
        <BriefCard
          icon="mail-outline"
          title="E-Mail-Zusammenfassung"
          summary={emailSummary(sections.email?.content)}
          generatedAt={formatTimestamp(sections.email?.generated_at)}
          onPress={() => setExpanded(expanded === "email" ? null : "email")}
        />
        {expanded === "email" && sections.email ? <EmailDetails content={sections.email.content} /> : null}

        <SectionHeader title="News" subtitle="Österreich & Politik" />
        <BriefCard
          icon="newspaper-outline"
          title="Nachrichten des Tages"
          summary={newsSummary(sections.news?.content)}
          generatedAt={formatTimestamp(sections.news?.generated_at)}
          onPress={() => setExpanded(expanded === "news" ? null : "news")}
        />
        {expanded === "news" && sections.news ? <NewsDetails content={sections.news.content} /> : null}

        <SectionHeader title="Nachrichten" subtitle="WhatsApp · Slack · ClickUp" />
        <BriefCard
          icon="chatbubbles-outline"
          title="Was heute wichtig ist"
          summary={messagesSummary(sections.messages?.content)}
          generatedAt={formatTimestamp(sections.messages?.generated_at)}
          onPress={() => setExpanded(expanded === "messages" ? null : "messages")}
        />
        {expanded === "messages" && sections.messages ? <MessagesDetails content={sections.messages.content} /> : null}

        <SectionHeader title="Tages-Vorschau" />
        <BriefCard
          icon="today-outline"
          title="Kalender & Geburtstage"
          summary={calendarSummary(sections.calendar?.content)}
          generatedAt={formatTimestamp(sections.calendar?.generated_at)}
          onPress={() => setExpanded(expanded === "calendar" ? null : "calendar")}
        />
        {expanded === "calendar" && sections.calendar ? <CalendarDetails content={sections.calendar.content} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailCard({ children }: { children: React.ReactNode }) {
  return <View className="mx-4 -mt-1 mb-3 rounded-2xl border border-slate-700 bg-slate-800/60 p-4">{children}</View>;
}

function DetailLabel({ children }: { children: React.ReactNode }) {
  return <Text className="mb-1 mt-3 text-xs font-semibold uppercase text-slate-500">{children}</Text>;
}

function EmailDetails({ content }: { content: any }) {
  return (
    <DetailCard>
      {content.dringend?.length ? (
        <>
          <DetailLabel>Dringend</DetailLabel>
          {content.dringend.map((item: any, i: number) => (
            <Text key={i} className="text-sm text-rose-300">
              • {typeof item === "string" ? item : JSON.stringify(item)}
            </Text>
          ))}
        </>
      ) : null}
      {content.persoenlich?.length ? (
        <>
          <DetailLabel>Persönlich</DetailLabel>
          {content.persoenlich.map((item: any, i: number) => (
            <Text key={i} className="text-sm text-slate-300">
              • {typeof item === "string" ? item : JSON.stringify(item)}
            </Text>
          ))}
        </>
      ) : null}
      {content.newsletter_summary?.length ? (
        <>
          <DetailLabel>Newsletter</DetailLabel>
          {content.newsletter_summary.map((item: any, i: number) => (
            <Text key={i} className="text-sm text-slate-400">
              • {typeof item === "string" ? item : JSON.stringify(item)}
            </Text>
          ))}
        </>
      ) : null}
      <Text className="mt-3 text-xs text-slate-500">{content.automatisch_count ?? 0} automatische Benachrichtigungen</Text>
    </DetailCard>
  );
}

function NewsDetails({ content }: { content: any }) {
  return (
    <DetailCard>
      {content.error ? <Text className="text-sm text-rose-300">{content.error}</Text> : null}
      {content.oesterreich?.length ? (
        <>
          <DetailLabel>Österreich</DetailLabel>
          {content.oesterreich.map((item: any, i: number) => (
            <View key={i} className="mb-2">
              <Text className="text-sm font-medium text-slate-200">{item.titel}</Text>
              <Text className="text-xs text-slate-400">
                {item.zusammenfassung} {item.quelle ? `(${item.quelle})` : ""}
              </Text>
            </View>
          ))}
        </>
      ) : null}
      {content.politik?.length ? (
        <>
          <DetailLabel>Politik</DetailLabel>
          {content.politik.map((item: any, i: number) => (
            <View key={i} className="mb-2">
              <Text className="text-sm font-medium text-slate-200">{item.titel}</Text>
              <Text className="text-xs text-slate-400">
                {item.zusammenfassung} {item.quelle ? `(${item.quelle})` : ""}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </DetailCard>
  );
}

function MessagesDetails({ content }: { content: any }) {
  return (
    <DetailCard>
      {content.muss_heute_beantwortet_werden?.length ? (
        <>
          <DetailLabel>Heute beantworten</DetailLabel>
          {content.muss_heute_beantwortet_werden.map((item: any, i: number) => (
            <Text key={i} className="text-sm text-rose-300">
              • {item.von} ({item.plattform}) – {item.grund}
            </Text>
          ))}
        </>
      ) : null}
      {content.whatsapp?.length ? (
        <>
          <DetailLabel>WhatsApp</DetailLabel>
          {content.whatsapp.map((item: any, i: number) => (
            <Text key={i} className="text-sm text-slate-300">
              • {item.von} {item.ist_gruppe ? "(Gruppe)" : ""}: {item.zusammenfassung}
            </Text>
          ))}
        </>
      ) : null}
      {content.slack?.length ? (
        <>
          <DetailLabel>Slack</DetailLabel>
          {content.slack.map((item: any, i: number) => (
            <Text key={i} className="text-sm text-slate-300">
              • {item.von} ({item.kategorie}): {item.zusammenfassung}
            </Text>
          ))}
        </>
      ) : null}
      {content.clickup?.length ? (
        <>
          <DetailLabel>ClickUp</DetailLabel>
          {content.clickup.map((item: any, i: number) => (
            <Text key={i} className="text-sm text-slate-300">
              • {item.titel}: {item.zusammenfassung}
            </Text>
          ))}
        </>
      ) : null}
    </DetailCard>
  );
}

function CalendarDetails({ content }: { content: any }) {
  return (
    <DetailCard>
      {content.heutige_termine?.length ? (
        <>
          <DetailLabel>Heutige Termine</DetailLabel>
          {content.heutige_termine.map((item: any, i: number) => (
            <Text key={i} className="text-sm text-slate-300">
              • {item.uhrzeit ? new Date(item.uhrzeit).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" }) : ""}{" "}
              {item.titel}
            </Text>
          ))}
        </>
      ) : (
        <Text className="text-sm text-slate-500">Keine Termine heute.</Text>
      )}
      {content.geburtstage_heute?.length ? (
        <>
          <DetailLabel>Geburtstage heute</DetailLabel>
          <Text className="text-sm text-amber-300">{content.geburtstage_heute.join(", ")}</Text>
        </>
      ) : null}
      {content.geburtstage_diese_woche?.length ? (
        <>
          <DetailLabel>Geburtstage diese Woche</DetailLabel>
          <Text className="text-sm text-slate-300">{content.geburtstage_diese_woche.join(", ")}</Text>
        </>
      ) : null}
      {content.ueberfaellige_kontakte?.length ? (
        <>
          <DetailLabel>Überfällige Kontakte</DetailLabel>
          <Text className="text-sm text-slate-300">{content.ueberfaellige_kontakte.join(", ")}</Text>
        </>
      ) : null}
      {content.clickup_faellig_heute?.length ? (
        <>
          <DetailLabel>ClickUp fällig heute</DetailLabel>
          {content.clickup_faellig_heute.map((item: any, i: number) => (
            <Text key={i} className="text-sm text-slate-300">
              • {item.titel}
            </Text>
          ))}
        </>
      ) : null}
    </DetailCard>
  );
}
