import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { colors } from "../constants/colors";
import { supabase } from "../supabase/client";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
};

const ICON_BY_TYPE: Record<string, keyof typeof Ionicons.glyphMap> = {
  daily_brief: "sunny-outline",
  urgent_message: "chatbubble-ellipses-outline",
  birthday: "gift-outline",
  contact_overdue: "people-outline",
  course_ending: "school-outline",
  coordination: "people-circle-outline",
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("de-AT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function NotificationsScreen() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, body, is_read, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (!error) setRows((data ?? []) as NotificationRow[]);
    setIsLoading(false);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    load();

    const channel = supabase
      .channel("notifications_screen_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => load())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    // Beim Oeffnen alles als gelesen markieren - das hier ist der einzige
    // Ort, an dem der User "gelesen" bestaetigt, analog zu einer
    // klassischen Notification-Glocke.
    supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("is_read", false)
      .then(() => {});
  }, []);

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <View className="flex-row items-center justify-between px-4 pt-4">
        <Text className="text-2xl font-bold text-slate-50">Benachrichtigungen</Text>
        <Pressable onPress={() => router.back()} className="rounded-full bg-slate-800 p-2 active:opacity-70">
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {isLoading ? (
        <SkeletonList count={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title="Noch keine Benachrichtigungen"
          subtitle="Sobald dein Daily Brief bereit ist oder etwas Dringendes passiert, erscheint es hier."
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
        >
          {rows.map((row) => {
            const content = (
              <>
                <View className="mt-0.5">
                  <Ionicons name={ICON_BY_TYPE[row.type] ?? "notifications-outline"} size={18} color={colors.accent} />
                </View>
                <View className="flex-1">
                  <Text className="font-semibold text-slate-50">{row.title}</Text>
                  <Text className="mt-1 text-sm text-slate-300">{row.body}</Text>
                  <Text className="mt-2 text-xs text-slate-500">{formatTimestamp(row.created_at)}</Text>
                </View>
              </>
            );
            const rowClassName = `mx-4 mb-3 flex-row gap-3 rounded-2xl border p-4 ${
              row.is_read ? "border-slate-700 bg-slate-800" : "border-sky-500/40 bg-sky-500/5"
            }`;

            if (row.type === "coordination") {
              return (
                <Pressable
                  key={row.id}
                  onPress={() => router.push("/coordination")}
                  className={`${rowClassName} active:opacity-80`}
                >
                  {content}
                </Pressable>
              );
            }
            return (
              <View key={row.id} className={rowClassName}>
                {content}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
