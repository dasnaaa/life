import { isBirthdayThisWeek, isBirthdayToday, isContactOverdue, isEventToday } from "./calendarToday.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("isEventToday: non-recurring event today", () => {
  const today = new Date();
  today.setHours(14, 0, 0, 0);
  assertEquals(isEventToday(today.toISOString(), null), true, "event at 14:00 today should be today");
});

Deno.test("isEventToday: non-recurring event tomorrow", () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  assertEquals(isEventToday(tomorrow.toISOString(), null), false, "event tomorrow should not be today");
});

Deno.test("isEventToday: weekly recurring matching today's weekday", () => {
  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
  const dayNames = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const rrule = `RRULE:FREQ=WEEKLY;BYDAY=${dayNames[fourWeeksAgo.getDay()]}`;
  assertEquals(isEventToday(fourWeeksAgo.toISOString(), rrule), true, "weekly series on today's weekday should be today");
});

Deno.test("isEventToday: weekly recurring wrong weekday", () => {
  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
  const dayNames = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const wrongDay = dayNames[(fourWeeksAgo.getDay() + 1) % 7];
  const rrule = `RRULE:FREQ=WEEKLY;BYDAY=${wrongDay}`;
  assertEquals(isEventToday(fourWeeksAgo.toISOString(), rrule), false, "weekly series on a different weekday should not be today");
});

Deno.test("isEventToday: weekly series already ended (UNTIL in the past)", () => {
  const start = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const untilStr = `${yesterday.getFullYear()}${String(yesterday.getMonth() + 1).padStart(2, "0")}${String(yesterday.getDate()).padStart(2, "0")}`;
  const rrule = `RRULE:FREQ=WEEKLY;UNTIL=${untilStr}T000000Z`;
  assertEquals(isEventToday(start.toISOString(), rrule), false, "series that already ended should not be today");
});

Deno.test("isBirthdayToday", () => {
  const today = new Date();
  const birthdayStr = `1990-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  assertEquals(isBirthdayToday(birthdayStr), true, "birthday matching today's month/day should be true");
  assertEquals(isBirthdayToday(null), false, "null birthday should be false");
});

Deno.test("isBirthdayThisWeek: in 5 days -> true, in 20 days -> false", () => {
  const now = new Date();
  const in5Days = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const birthdayIn5Days = `1990-${String(in5Days.getMonth() + 1).padStart(2, "0")}-${String(in5Days.getDate()).padStart(2, "0")}`;
  assertEquals(isBirthdayThisWeek(birthdayIn5Days), true, "birthday in 5 days should be this week");

  const in20Days = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000);
  const birthdayIn20Days = `1990-${String(in20Days.getMonth() + 1).padStart(2, "0")}-${String(in20Days.getDate()).padStart(2, "0")}`;
  assertEquals(isBirthdayThisWeek(birthdayIn20Days), false, "birthday in 20 days should not be this week");
});

Deno.test("isContactOverdue: family threshold caps at 3 days", () => {
  const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  assertEquals(isContactOverdue(fourDaysAgo, 14, true), true, "family contact 4 days ago should be overdue (cap=3)");
  assertEquals(isContactOverdue(fourDaysAgo, 14, false), false, "non-family with 14-day frequency, 4 days ago is fine");
});

Deno.test("isContactOverdue: no last contact -> not overdue (unknown)", () => {
  assertEquals(isContactOverdue(null, 5, false), false, "unknown last contact should not be flagged overdue");
});
