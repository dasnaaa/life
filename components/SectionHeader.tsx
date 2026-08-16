import { Text, View } from "react-native";

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
};

export function SectionHeader({ title, subtitle }: SectionHeaderProps) {
  return (
    <View className="mb-3 mt-6 px-4">
      <Text className="text-lg font-semibold text-slate-50">{title}</Text>
      {subtitle ? <Text className="mt-0.5 text-sm text-slate-400">{subtitle}</Text> : null}
    </View>
  );
}
