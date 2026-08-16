import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "../constants/colors";

export type BriefCardProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  summary: string;
  generatedAt?: string;
  onPress?: () => void;
};

export function BriefCard({ icon, title, summary, generatedAt, onPress }: BriefCardProps) {
  return (
    <Pressable
      onPress={onPress}
      className="mx-4 mb-3 rounded-2xl border border-slate-700 bg-slate-800 p-4 active:opacity-80"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Ionicons name={icon} size={18} color={colors.accent} />
          <Text className="text-base font-semibold text-slate-50">{title}</Text>
        </View>
        {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
      </View>
      <Text className="mt-2 text-sm text-slate-300">{summary}</Text>
      {generatedAt ? (
        <Text className="mt-3 text-xs text-slate-500">Generiert um {generatedAt}</Text>
      ) : null}
    </Pressable>
  );
}
