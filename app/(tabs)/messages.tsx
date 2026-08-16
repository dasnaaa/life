import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MessageItem } from "../../components/MessageItem";
import { SectionHeader } from "../../components/SectionHeader";
import { supabase } from "../../supabase/client";

type MessageRow = {
  id: string;
  platform: "whatsapp" | "gmail" | "slack" | "clickup";
  sender_name: string | null;
  content_preview: string | null;
  received_at: string | null;
};

function formatTime(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MessagesScreen() {
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("messages_cache")
      .select("id, platform, sender_name, content_preview, received_at")
      .eq("is_read", false)
      .order("received_at", { ascending: false })
      .limit(200);

    if (!error) setRows((data ?? []) as MessageRow[]);
    setIsLoading(false);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    load();

    // Live-Updates zusaetzlich zum manuellen Pull-to-Refresh (Realtime auf
    // messages_cache, siehe Migration 0006 + lib/useUnreadBadge.ts fuers
    // Tab-Badge).
    const channel = supabase
      .channel("messages_screen_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages_cache" }, () => load())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
  }

  if (isLoading) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 items-center justify-center bg-slate-900">
        <ActivityIndicator color="#38BDF8" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#38BDF8" />}
      >
        <SectionHeader title="Alle Nachrichten" subtitle={`${rows.length} ungelesen`} />
        {rows.length === 0 ? (
          <Text className="mx-4 text-sm text-slate-500">Keine ungelesenen Nachrichten.</Text>
        ) : (
          rows.map((row) => (
            <MessageItem
              key={row.id}
              platform={row.platform}
              senderName={row.sender_name ?? "Unbekannt"}
              preview={row.content_preview ?? ""}
              receivedAt={formatTime(row.received_at)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
