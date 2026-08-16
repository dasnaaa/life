import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SectionHeader } from "../../components/SectionHeader";

export default function WorkScreen() {
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionHeader title="Slack & ClickUp" subtitle="kommt in Paket 4" />
      </ScrollView>
    </SafeAreaView>
  );
}
