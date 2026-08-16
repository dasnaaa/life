import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BriefCard } from "../../components/BriefCard";
import { SectionHeader } from "../../components/SectionHeader";

export default function DashboardScreen() {
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="px-4 pt-4">
          <Text className="text-2xl font-bold text-slate-50">Daily Brief</Text>
          <Text className="mt-1 text-sm text-slate-400">
            Noch keine Daten verbunden. Der echte Brief wird ab Paket 7 (AI-Brief-Generierung) hier angezeigt.
          </Text>
        </View>

        <SectionHeader title="E-Mail" subtitle="kommt in Paket 2 & 7" />
        <BriefCard icon="mail-outline" title="E-Mail-Zusammenfassung" summary="Noch nicht verbunden." />

        <SectionHeader title="Nachrichten" subtitle="kommt in Paket 3, 4 & 7" />
        <BriefCard icon="chatbubbles-outline" title="WhatsApp / Slack / ClickUp" summary="Noch nicht verbunden." />

        <SectionHeader title="News" subtitle="kommt in Paket 7" />
        <BriefCard icon="newspaper-outline" title="Österreich & Politik" summary="Noch nicht verbunden." />

        <SectionHeader title="Tages-Vorschau" subtitle="kommt in Paket 6 & 7" />
        <BriefCard icon="today-outline" title="Kalender & Geburtstage" summary="Noch nicht verbunden." />
      </ScrollView>
    </SafeAreaView>
  );
}
