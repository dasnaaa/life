import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { colors } from "../constants/colors";
import { getWhatsAppServiceConfig, sendWhatsAppMessage } from "../lib/whatsappService";
import { useToast } from "../lib/ToastProvider";
import { supabase } from "../supabase/client";

type CoordinationRow = {
  id: string;
  friend_name: string;
  friend_whatsapp_id: string;
  proposed_time_text: string | null;
  proposed_time: string | null;
  has_calendar_conflict: boolean;
  status: string;
  childcare_message_draft: string | null;
  childcare_reply_text: string | null;
  friend_confirmation_draft: string | null;
  created_at: string;
  contact_tracking: { contact_name: string; contact_identifier: string | null } | null;
};

const STATUS_LABEL: Record<string, string> = {
  detected: "Erkannt",
  childcare_draft_ready: "Entwurf bereit",
  childcare_sent: "Warte auf Antwort",
  childcare_confirmed: "Betreuung bestätigt",
  childcare_declined: "Betreuung abgesagt",
  calendar_confirmed: "Termin eingetragen",
  friend_notified: "Abgeschlossen",
  cancelled: "Abgebrochen",
};

export default function CoordinationScreen() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<CoordinationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("coordination_requests")
      .select(
        "id, friend_name, friend_whatsapp_id, proposed_time_text, proposed_time, has_calendar_conflict, status, childcare_message_draft, childcare_reply_text, friend_confirmation_draft, created_at, contact_tracking(contact_name, contact_identifier)"
      )
      .not("status", "in", "(friend_notified,cancelled)")
      .order("created_at", { ascending: false });

    if (!error) setRows((data ?? []) as unknown as CoordinationRow[]);
    setIsLoading(false);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("coordination_screen_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "coordination_requests" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
  }

  async function callAction(coordinationId: string, action: string) {
    const { data, error } = await supabase.functions.invoke("coordination-action", {
      body: { coordination_id: coordinationId, action },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function sendViaWhatsApp(to: string, message: string): Promise<boolean> {
    const { url, apiKey } = await getWhatsAppServiceConfig();
    if (!url || !apiKey) {
      showToast("WhatsApp-Service ist nicht konfiguriert (siehe Einstellungen).", "error");
      return false;
    }
    await sendWhatsAppMessage(url, apiKey, to, message);
    return true;
  }

  async function handleSendToChildcare(row: CoordinationRow) {
    if (!row.contact_tracking?.contact_identifier || !row.childcare_message_draft) return;
    setBusyId(row.id);
    try {
      const sent = await sendViaWhatsApp(row.contact_tracking.contact_identifier, row.childcare_message_draft);
      if (!sent) return;
      await callAction(row.id, "childcare_sent");
      showToast("Nachricht gesendet.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Senden fehlgeschlagen.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirmCalendar(row: CoordinationRow) {
    setBusyId(row.id);
    try {
      await callAction(row.id, "confirm_calendar");
      showToast("Termin eingetragen.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Termin eintragen fehlgeschlagen.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSendToFriend(row: CoordinationRow) {
    if (!row.friend_confirmation_draft) return;
    setBusyId(row.id);
    try {
      const sent = await sendViaWhatsApp(row.friend_whatsapp_id, row.friend_confirmation_draft);
      if (!sent) return;
      await callAction(row.id, "friend_notified");
      showToast("Freundin informiert.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Senden fehlgeschlagen.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(row: CoordinationRow) {
    setBusyId(row.id);
    try {
      await callAction(row.id, "cancel");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Abbrechen fehlgeschlagen.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCopy(text: string) {
    await Clipboard.setStringAsync(text);
    showToast("In Zwischenablage kopiert.", "info");
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <View className="flex-row items-center justify-between px-4 pt-4">
        <Text className="text-2xl font-bold text-slate-50">Terminkoordination</Text>
        <Pressable onPress={() => router.back()} className="rounded-full bg-slate-800 p-2 active:opacity-70">
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {isLoading ? (
        <SkeletonList count={2} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="people-circle-outline"
          title="Keine offenen Terminanfragen"
          subtitle="Sobald eine Freundin per WhatsApp einen Termin vorschlägt, taucht die Anfrage hier auf."
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
        >
          {rows.map((row) => (
            <View key={row.id} className="mx-4 mb-3 rounded-2xl border border-slate-700 bg-slate-800 p-4">
              <View className="flex-row items-center justify-between">
                <Text className="font-semibold text-slate-50">
                  {row.friend_name} · {row.proposed_time_text ?? "Zeitpunkt unklar"}
                </Text>
                <Text className="text-xs text-slate-400">{STATUS_LABEL[row.status] ?? row.status}</Text>
              </View>

              {row.has_calendar_conflict ? (
                <Text className="mt-1 text-xs text-amber-300">⚠ Möglicher Kalenderkonflikt zu diesem Zeitpunkt</Text>
              ) : null}

              {row.status === "childcare_draft_ready" ? (
                <ActionBlock
                  label={`Entwurf für ${row.contact_tracking?.contact_name ?? "Kinderbetreuung"}`}
                  draft={row.childcare_message_draft}
                  onCopy={() => row.childcare_message_draft && handleCopy(row.childcare_message_draft)}
                  onSend={() => handleSendToChildcare(row)}
                  sendLabel={`An ${row.contact_tracking?.contact_name ?? "Kinderbetreuung"} senden`}
                  disabled={!row.contact_tracking?.contact_identifier}
                  busy={busyId === row.id}
                />
              ) : null}

              {row.status === "childcare_sent" ? (
                <Text className="mt-3 text-sm text-slate-400">
                  Nachricht gesendet – warte auf Antwort von {row.contact_tracking?.contact_name ?? "Kinderbetreuung"}.
                </Text>
              ) : null}

              {row.status === "childcare_confirmed" ? (
                <View className="mt-3">
                  {row.childcare_reply_text ? (
                    <Text className="mb-2 text-sm text-emerald-300">✓ „{row.childcare_reply_text}"</Text>
                  ) : null}
                  <Pressable
                    onPress={() => handleConfirmCalendar(row)}
                    disabled={busyId === row.id}
                    className="items-center rounded-lg bg-sky-500 py-2.5 active:opacity-80 disabled:opacity-50"
                  >
                    {busyId === row.id ? (
                      <ActivityIndicator color="#0F172A" />
                    ) : (
                      <Text className="font-semibold text-slate-900">Termin eintragen</Text>
                    )}
                  </Pressable>
                </View>
              ) : null}

              {row.status === "childcare_declined" ? (
                <Text className="mt-3 text-sm text-rose-300">
                  ✕ {row.childcare_reply_text ?? "Keine Verfügbarkeit."}
                </Text>
              ) : null}

              {row.status === "calendar_confirmed" ? (
                <ActionBlock
                  label={`Bestätigung für ${row.friend_name}`}
                  draft={row.friend_confirmation_draft}
                  onCopy={() => row.friend_confirmation_draft && handleCopy(row.friend_confirmation_draft)}
                  onSend={() => handleSendToFriend(row)}
                  sendLabel={`An ${row.friend_name} senden`}
                  disabled={false}
                  busy={busyId === row.id}
                />
              ) : null}

              {row.status !== "friend_notified" && row.status !== "cancelled" ? (
                <Pressable onPress={() => handleCancel(row)} disabled={busyId === row.id} className="mt-3 items-center py-1">
                  <Text className="text-xs text-slate-500">Anfrage abbrechen</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ActionBlock({
  label,
  draft,
  onCopy,
  onSend,
  sendLabel,
  disabled,
  busy,
}: {
  label: string;
  draft: string | null;
  onCopy: () => void;
  onSend: () => void;
  sendLabel: string;
  disabled: boolean;
  busy: boolean;
}) {
  return (
    <View className="mt-3 rounded-xl border border-slate-700 bg-slate-900 p-3">
      <Text className="mb-1 text-xs font-semibold uppercase text-slate-500">{label}</Text>
      <Text className="mb-3 text-sm text-slate-200">{draft}</Text>
      <View className="flex-row gap-2">
        <Pressable onPress={onCopy} className="flex-1 items-center rounded-lg border border-slate-600 py-2 active:opacity-70">
          <Text className="text-xs text-slate-300">Kopieren</Text>
        </Pressable>
        <Pressable
          onPress={onSend}
          disabled={disabled || busy}
          className="flex-1 items-center rounded-lg bg-sky-500 py-2 active:opacity-80 disabled:opacity-50"
        >
          {busy ? <ActivityIndicator color="#0F172A" /> : <Text className="text-xs font-semibold text-slate-900">{sendLabel}</Text>}
        </Pressable>
      </View>
    </View>
  );
}
