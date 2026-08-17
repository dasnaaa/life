import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "../../components/EmptyState";
import { MessageItem } from "../../components/MessageItem";
import { SectionHeader } from "../../components/SectionHeader";
import { SkeletonList } from "../../components/Skeleton";
import { TaskItem } from "../../components/TaskItem";
import { colors } from "../../constants/colors";
import { classifyTaskUrgency, urgencyRank } from "../../lib/urgency";
import { supabase } from "../../supabase/client";

type CacheRow = {
  id: string;
  platform: "slack" | "clickup";
  sender_name: string | null;
  sender_id: string | null;
  content_preview: string | null;
  received_at: string | null;
  raw_data: Record<string, any> | null;
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

export default function WorkScreen() {
  const [rows, setRows] = useState<CacheRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("messages_cache")
      .select("id, platform, sender_name, sender_id, content_preview, received_at, raw_data")
      .in("platform", ["slack", "clickup"])
      .eq("is_read", false)
      .order("received_at", { ascending: false });

    if (!error) setRows((data ?? []) as CacheRow[]);
    setIsLoading(false);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
  }

  if (isLoading) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
        <SectionHeader title="Slack" />
        <SkeletonList />
      </SafeAreaView>
    );
  }

  const slackRows = rows.filter((row) => row.platform === "slack");
  const slackByCategory = {
    dm: slackRows.filter((row) => row.raw_data?.category === "dm"),
    mention: slackRows.filter((row) => row.raw_data?.category === "mention"),
    channel: slackRows.filter((row) => row.raw_data?.category === "channel"),
  };

  const clickupTasks = rows
    .filter((row) => row.platform === "clickup" && row.raw_data?.kind === "task")
    .map((row) => ({ ...row, urgency: classifyTaskUrgency(row.raw_data?.due_date ?? null) }))
    .sort((a, b) => {
      const rankDiff = urgencyRank[a.urgency] - urgencyRank[b.urgency];
      if (rankDiff !== 0) return rankDiff;
      return (a.raw_data?.due_date ?? Infinity) - (b.raw_data?.due_date ?? Infinity);
    });

  const clickupMentions = rows.filter((row) => row.platform === "clickup" && row.raw_data?.kind === "comment_mention");

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
      >
        <SectionHeader title="Slack" subtitle="Direktnachrichten · Erwähnungen · Channels" />

        {slackRows.length === 0 ? (
          <EmptyState icon="checkmark-done-outline" title="Keine ungelesenen Slack-Nachrichten" />
        ) : (
          <>
            {slackByCategory.dm.length > 0 ? (
              <View className="mb-3">
                <Text className="mx-4 mb-1 text-xs font-semibold uppercase text-slate-500">Direktnachrichten</Text>
                {slackByCategory.dm.map((row) => (
                  <MessageItem
                    key={row.id}
                    platform="slack"
                    senderName={row.sender_name ?? "Unbekannt"}
                    preview={row.content_preview ?? ""}
                    receivedAt={formatTime(row.received_at)}
                  />
                ))}
              </View>
            ) : null}

            {slackByCategory.mention.length > 0 ? (
              <View className="mb-3">
                <Text className="mx-4 mb-1 text-xs font-semibold uppercase text-slate-500">Erwähnungen</Text>
                {slackByCategory.mention.map((row) => (
                  <MessageItem
                    key={row.id}
                    platform="slack"
                    senderName={`${row.sender_name ?? "Unbekannt"} in #${row.raw_data?.channel_name ?? ""}`}
                    preview={row.content_preview ?? ""}
                    receivedAt={formatTime(row.received_at)}
                  />
                ))}
              </View>
            ) : null}

            {slackByCategory.channel.length > 0 ? (
              <View className="mb-3">
                <Text className="mx-4 mb-1 text-xs font-semibold uppercase text-slate-500">Channels</Text>
                {slackByCategory.channel.map((row) => (
                  <MessageItem
                    key={row.id}
                    platform="slack"
                    senderName={`${row.sender_name ?? "Unbekannt"} in #${row.raw_data?.channel_name ?? ""}`}
                    preview={row.content_preview ?? ""}
                    receivedAt={formatTime(row.received_at)}
                  />
                ))}
              </View>
            ) : null}
          </>
        )}

        <SectionHeader title="ClickUp" subtitle="Nach Dringlichkeit sortiert" />

        {clickupTasks.length === 0 ? (
          <EmptyState icon="checkmark-circle-outline" title="Keine offenen Tasks" />
        ) : (
          clickupTasks.map((task) => (
            <TaskItem
              key={task.id}
              title={task.content_preview ?? "Task"}
              listName={task.raw_data?.list_name ?? null}
              dueDate={task.raw_data?.due_date ?? null}
              urgency={task.urgency}
            />
          ))
        )}

        {clickupMentions.length > 0 ? (
          <>
            <SectionHeader title="Erwähnungen in Kommentaren" />
            {clickupMentions.map((row) => (
              <MessageItem
                key={row.id}
                platform="clickup"
                senderName={`${row.sender_name ?? "Unbekannt"} zu "${row.raw_data?.task_name ?? ""}"`}
                preview={row.content_preview ?? ""}
                receivedAt={formatTime(row.received_at)}
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
