import { Pressable, Text, View } from "react-native";

export type MessageItemProps = {
  platform: "whatsapp" | "gmail" | "slack" | "clickup";
  senderName: string;
  preview: string;
  receivedAt: string;
  isRead?: boolean;
  onPress?: () => void;
};

const platformLabel: Record<MessageItemProps["platform"], string> = {
  whatsapp: "WhatsApp",
  gmail: "Gmail",
  slack: "Slack",
  clickup: "ClickUp",
};

export function MessageItem({ platform, senderName, preview, receivedAt, isRead, onPress }: MessageItemProps) {
  return (
    <Pressable
      onPress={onPress}
      className="mx-4 mb-2 flex-row items-start justify-between rounded-xl border border-slate-700 bg-slate-800 p-3 active:opacity-80"
    >
      <View className="flex-1 pr-3">
        <View className="flex-row items-center gap-2">
          {!isRead ? <View className="h-2 w-2 rounded-full bg-sky-400" /> : null}
          <Text className="font-medium text-slate-50">{senderName}</Text>
          <Text className="text-xs text-slate-500">· {platformLabel[platform]}</Text>
        </View>
        <Text numberOfLines={2} className="mt-1 text-sm text-slate-400">
          {preview}
        </Text>
      </View>
      <Text className="text-xs text-slate-500">{receivedAt}</Text>
    </Pressable>
  );
}
