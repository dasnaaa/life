import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { colors } from "../constants/colors";

type EmptyStateProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ icon, title, subtitle, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View className="mx-4 mt-2 items-center rounded-2xl border border-dashed border-slate-700 px-6 py-10">
      <View className="mb-3 h-12 w-12 items-center justify-center rounded-full bg-slate-800">
        <Ionicons name={icon} size={22} color={colors.textMuted} />
      </View>
      <Text className="text-center text-sm font-medium text-slate-300">{title}</Text>
      {subtitle ? <Text className="mt-1 text-center text-xs text-slate-500">{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} className="mt-4 rounded-lg border border-slate-600 px-4 py-2 active:opacity-70">
          <Text className="text-xs font-medium text-slate-200">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
