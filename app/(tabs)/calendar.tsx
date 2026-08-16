import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SectionHeader } from "../../components/SectionHeader";
import { buildWeekPreview, groupByDay, isWorkAccountLabel, type CalendarEventSource } from "../../lib/calendarPreview";
import { nextOccurrence, weeksRemainingFromRule } from "../../lib/recurrence";
import { supabase } from "../../supabase/client";

type EventRow = {
  id: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  recurrence_rule: string | null;
  location: string | null;
  connected_accounts: { account_label: string | null } | null;
};

type CourseRow = {
  id: string;
  title: string;
  frequency: string | null;
  estimated_end_text: string | null;
  requires_signup: boolean;
  reasoning: string | null;
  is_confirmed: boolean;
  is_dismissed: boolean;
  calendar_event_id: string | null;
  calendar_events_cache: { start_time: string | null; recurrence_rule: string | null } | null;
};

const WEEKDAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: "long", day: "2-digit", month: "2-digit" };
const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

export default function CalendarScreen() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const load = useCallback(async () => {
    const [eventsResult, coursesResult] = await Promise.all([
      supabase
        .from("calendar_events_cache")
        .select("id, title, start_time, end_time, recurrence_rule, location, connected_accounts(account_label)")
        .order("start_time", { ascending: true }),
      supabase
        .from("detected_courses")
        .select(
          "id, title, frequency, estimated_end_text, requires_signup, reasoning, is_confirmed, is_dismissed, calendar_event_id, calendar_events_cache(start_time, recurrence_rule)"
        )
        .eq("is_dismissed", false)
        .order("detected_at", { ascending: false }),
    ]);

    if (!eventsResult.error) setEvents((eventsResult.data ?? []) as unknown as EventRow[]);
    if (!coursesResult.error) setCourses((coursesResult.data ?? []) as unknown as CourseRow[]);
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

  async function handleAnalyze() {
    setIsAnalyzing(true);
    await supabase.functions.invoke("analyze-calendar", { body: {} });
    await load();
    setIsAnalyzing(false);
  }

  async function handleConfirmCourse(courseId: string, isConfirmed: boolean) {
    await supabase.from("detected_courses").update({ is_confirmed: isConfirmed }).eq("id", courseId);
    load();
  }

  async function handleDismissCourse(courseId: string) {
    await supabase.from("detected_courses").update({ is_dismissed: true }).eq("id", courseId);
    load();
  }

  async function handleSaveTitle(courseId: string) {
    if (editingTitle.trim()) {
      await supabase.from("detected_courses").update({ title: editingTitle.trim() }).eq("id", courseId);
    }
    setEditingCourseId(null);
    load();
  }

  if (isLoading) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 items-center justify-center bg-slate-900">
        <ActivityIndicator color="#38BDF8" />
      </SafeAreaView>
    );
  }

  const rangeStart = new Date();
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(rangeStart.getTime() + 8 * 24 * 60 * 60 * 1000 - 1);

  const previewEvents: CalendarEventSource[] = events.map((event) => ({
    id: event.id,
    title: event.title,
    start_time: event.start_time,
    end_time: event.end_time,
    recurrence_rule: event.recurrence_rule,
    location: event.location,
    isWork: isWorkAccountLabel(event.connected_accounts?.account_label),
  }));

  const dayGroups = groupByDay(buildWeekPreview(previewEvents, rangeStart, rangeEnd));

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-slate-900">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#38BDF8" />}
      >
        <View className="flex-row items-center justify-between px-4 pt-4">
          <Text className="text-2xl font-bold text-slate-50">Kalender & Kurse</Text>
          <Pressable
            onPress={handleAnalyze}
            disabled={isAnalyzing}
            className="rounded-lg bg-sky-500 px-3 py-2 active:opacity-80 disabled:opacity-50"
          >
            {isAnalyzing ? (
              <ActivityIndicator color="#0F172A" />
            ) : (
              <Text className="text-sm font-semibold text-slate-900">Kalender analysieren</Text>
            )}
          </Pressable>
        </View>

        <SectionHeader title="Erkannte Kurse" subtitle="Kinder-Aktivitäten & Kurse" />
        {courses.length === 0 ? (
          <Text className="mx-4 mb-4 text-sm text-slate-500">
            Noch keine Kurse erkannt. Tippe oben auf „Kalender analysieren".
          </Text>
        ) : (
          courses.map((course) => {
            const next = nextOccurrence(
              course.calendar_events_cache?.start_time ?? null,
              course.calendar_events_cache?.recurrence_rule ?? null
            );
            const weeksLeft = weeksRemainingFromRule(course.calendar_events_cache?.recurrence_rule ?? null);
            const warnSoon = weeksLeft !== null && weeksLeft <= 4;

            return (
              <View key={course.id} className="mx-4 mb-3 rounded-xl border border-slate-700 bg-slate-800 p-3">
                {editingCourseId === course.id ? (
                  <TextInput
                    value={editingTitle}
                    onChangeText={setEditingTitle}
                    onBlur={() => handleSaveTitle(course.id)}
                    autoFocus
                    className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-slate-50"
                  />
                ) : (
                  <Pressable
                    onPress={() => {
                      setEditingCourseId(course.id);
                      setEditingTitle(course.title);
                    }}
                  >
                    <Text className="font-semibold text-slate-50">
                      {course.title} {course.is_confirmed ? "✓" : ""}
                    </Text>
                  </Pressable>
                )}

                {course.frequency ? <Text className="mt-0.5 text-xs text-slate-500">{course.frequency}</Text> : null}

                <View className="mt-2 flex-row flex-wrap gap-3">
                  {next ? (
                    <Text className="text-xs text-slate-300">
                      Nächster Termin: {next.toLocaleDateString("de-AT", WEEKDAY_FORMAT)}
                    </Text>
                  ) : null}
                  {weeksLeft !== null ? (
                    <Text className={`text-xs ${warnSoon ? "text-amber-300" : "text-slate-300"}`}>
                      noch {weeksLeft} {weeksLeft === 1 ? "Woche" : "Wochen"}
                    </Text>
                  ) : course.estimated_end_text ? (
                    <Text className="text-xs text-slate-400">Ende (geschätzt): {course.estimated_end_text}</Text>
                  ) : null}
                </View>

                {warnSoon ? (
                  <View className="mt-2 rounded-lg bg-amber-500/10 p-2">
                    <Text className="text-xs font-medium text-amber-300">
                      Kurs endet bald – jetzt für Folgekurs anmelden?
                    </Text>
                  </View>
                ) : null}

                {course.requires_signup ? (
                  <Text className="mt-1 text-xs text-sky-300">Anmeldung nötig</Text>
                ) : null}
                {course.reasoning ? <Text className="mt-1 text-xs text-slate-500">{course.reasoning}</Text> : null}

                <View className="mt-3 flex-row gap-2">
                  <Pressable
                    onPress={() => handleConfirmCourse(course.id, !course.is_confirmed)}
                    className="flex-1 items-center rounded-lg border border-slate-600 py-1.5 active:opacity-70"
                  >
                    <Text className="text-xs text-slate-300">{course.is_confirmed ? "Bestätigt" : "Bestätigen"}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDismissCourse(course.id)}
                    className="flex-1 items-center rounded-lg border border-slate-600 py-1.5 active:opacity-70"
                  >
                    <Text className="text-xs text-slate-400">Ist kein Kurs</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}

        <SectionHeader title="Diese Woche" subtitle="Heute + nächste 7 Tage" />
        {dayGroups.length === 0 ? (
          <Text className="mx-4 text-sm text-slate-500">Keine Termine in den nächsten 7 Tagen.</Text>
        ) : (
          dayGroups.map((group) => (
            <View key={group.dateKey} className="mb-3">
              <Text className="mx-4 mb-1 text-xs font-semibold uppercase text-slate-500">
                {group.date.toLocaleDateString("de-AT", WEEKDAY_FORMAT)}
              </Text>
              {group.items.map((item, index) => (
                <View
                  key={`${item.eventId}-${index}`}
                  className={`mx-4 mb-2 flex-row items-center justify-between rounded-xl border-l-4 ${
                    item.isWork ? "border-sky-400" : "border-emerald-400"
                  } border-y border-r border-slate-700 bg-slate-800 p-3`}
                >
                  <View className="flex-1 pr-3">
                    <Text className="font-medium text-slate-50">{item.title}</Text>
                    {item.location ? <Text className="mt-0.5 text-xs text-slate-500">{item.location}</Text> : null}
                  </View>
                  <View className="items-end">
                    <Text className="text-xs text-slate-400">{item.start.toLocaleTimeString("de-AT", TIME_FORMAT)}</Text>
                    {item.hasConflict ? (
                      <Text className="mt-0.5 text-xs font-medium text-rose-400">Konflikt!</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
