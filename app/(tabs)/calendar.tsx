import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SectionHeader } from "../../components/SectionHeader";

export default function CalendarScreen() {
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionHeader
          title="Kalender & Kurse"
          subtitle="Google Calendar & Kurs-Erkennung — kommt in Paket 2 & 6"
        />
      </ScrollView>
    </SafeAreaView>
  );
}
