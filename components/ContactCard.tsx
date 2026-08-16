import { Pressable, Text, View } from "react-native";

export type ContactCardProps = {
  name: string;
  daysSinceContact: number;
  normalFrequencyDays: number;
  isPriority?: boolean;
  onPress?: () => void;
};

function statusColor(daysSinceContact: number, normalFrequencyDays: number) {
  if (daysSinceContact <= normalFrequencyDays) return "bg-emerald-400";
  if (daysSinceContact <= normalFrequencyDays * 2) return "bg-amber-400";
  return "bg-rose-400";
}

export function ContactCard({ name, daysSinceContact, normalFrequencyDays, isPriority, onPress }: ContactCardProps) {
  return (
    <Pressable
      onPress={onPress}
      className="mx-4 mb-2 flex-row items-center justify-between rounded-xl border border-slate-700 bg-slate-800 p-3 active:opacity-80"
    >
      <View className="flex-row items-center gap-3">
        <View className={`h-2.5 w-2.5 rounded-full ${statusColor(daysSinceContact, normalFrequencyDays)}`} />
        <View>
          <Text className="font-medium text-slate-50">
            {name}
            {isPriority ? " ⭐" : ""}
          </Text>
          <Text className="text-xs text-slate-400">
            zuletzt vor {daysSinceContact} {daysSinceContact === 1 ? "Tag" : "Tagen"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
