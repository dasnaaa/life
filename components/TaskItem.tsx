import { Pressable, Text, View } from "react-native";

import type { TaskUrgency } from "../lib/urgency";

export type TaskItemProps = {
  title: string;
  listName?: string | null;
  dueDate: number | null;
  urgency: TaskUrgency;
  onPress?: () => void;
};

const urgencyStyles: Record<TaskUrgency, { border: string; bg: string; text: string; label: string }> = {
  overdue: { border: "border-rose-500", bg: "bg-rose-500/20", text: "text-rose-300", label: "Überfällig" },
  due_today: { border: "border-rose-500", bg: "bg-rose-500/20", text: "text-rose-300", label: "Heute fällig" },
  this_week: { border: "border-amber-400", bg: "bg-amber-400/20", text: "text-amber-300", label: "Diese Woche" },
  later: { border: "border-slate-700", bg: "bg-slate-700", text: "text-slate-300", label: "Später" },
  none: { border: "border-slate-700", bg: "bg-slate-700", text: "text-slate-300", label: "Ohne Termin" },
};

function formatDueDate(dueDate: number | null): string {
  if (!dueDate) return "";
  return new Date(dueDate).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" });
}

export function TaskItem({ title, listName, dueDate, urgency, onPress }: TaskItemProps) {
  const style = urgencyStyles[urgency];

  return (
    <Pressable
      onPress={onPress}
      className={`mx-4 mb-2 flex-row items-center justify-between rounded-xl border-y border-r border-l-4 ${style.border} border-slate-700 bg-slate-800 p-3 active:opacity-80`}
    >
      <View className="flex-1 pr-3">
        <Text className="font-medium text-slate-50" numberOfLines={2}>
          {title}
        </Text>
        {listName ? <Text className="mt-0.5 text-xs text-slate-500">{listName}</Text> : null}
      </View>
      <View className="items-end gap-1">
        <View className={`rounded-full px-2 py-0.5 ${style.bg}`}>
          <Text className={`text-xs font-medium ${style.text}`}>{style.label}</Text>
        </View>
        {dueDate ? <Text className="text-xs text-slate-500">{formatDueDate(dueDate)}</Text> : null}
      </View>
    </Pressable>
  );
}
