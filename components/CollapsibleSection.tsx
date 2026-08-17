import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { colors } from "../constants/colors";

type CollapsibleSectionProps = {
  title: string;
  subtitle?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
};

// Macht lange Formular-Screens (v.a. Einstellungen) ueberschaubar: nur der
// Titel ist immer sichtbar, der Inhalt klappt auf Tippen auf/zu. Kein
// externer State noetig - jede Sektion verwaltet ihren eigenen offen/zu-Status.
export function CollapsibleSection({ title, subtitle, defaultExpanded = false, children }: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <View className="mx-4 mb-3 overflow-hidden rounded-2xl border border-slate-700 bg-slate-800/60">
      <Pressable
        onPress={() => setIsExpanded((current) => !current)}
        className="flex-row items-center justify-between px-4 py-3.5 active:opacity-80"
      >
        <View>
          <Text className="text-base font-semibold text-slate-50">{title}</Text>
          {subtitle ? <Text className="mt-0.5 text-xs text-slate-500">{subtitle}</Text> : null}
        </View>
        <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} />
      </Pressable>

      {isExpanded ? <View className="border-t border-slate-700 p-3">{children}</View> : null}
    </View>
  );
}
