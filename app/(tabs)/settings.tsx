import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SectionHeader } from "../../components/SectionHeader";

export default function SettingsScreen() {
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionHeader
          title="Account-Verbindungen"
          subtitle="Google, WhatsApp, Slack, ClickUp — kommt in Paket 2 & 9"
        />
      </ScrollView>
    </SafeAreaView>
  );
}
