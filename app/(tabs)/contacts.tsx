import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SectionHeader } from "../../components/SectionHeader";

export default function ContactsScreen() {
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionHeader
          title="Kontakt-Tracking"
          subtitle="Prioritätskontakte & Geburtstage — kommt in Paket 5"
        />
      </ScrollView>
    </SafeAreaView>
  );
}
