import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SectionHeader } from "../../components/SectionHeader";

export default function MessagesScreen() {
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionHeader
          title="Alle Nachrichten"
          subtitle="WhatsApp, Gmail, Slack — kommt in Paket 2, 3 & 4"
        />
      </ScrollView>
    </SafeAreaView>
  );
}
