import { classifyUrgency } from "./clickup.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("classifyUrgency: null due date -> none", () => {
  assertEquals(classifyUrgency(null), "none", "no due date should be 'none'");
});

Deno.test("classifyUrgency: yesterday -> overdue", () => {
  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  assertEquals(classifyUrgency(yesterday), "overdue", "a past due date should be overdue");
});

Deno.test("classifyUrgency: earlier today -> due_today", () => {
  const earlierToday = new Date();
  earlierToday.setHours(earlierToday.getHours() > 1 ? earlierToday.getHours() - 1 : 0, 0, 0, 0);
  assertEquals(classifyUrgency(earlierToday.getTime()), "due_today", "a due date earlier today should be due_today");
});

Deno.test("classifyUrgency: end of today -> due_today", () => {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  assertEquals(classifyUrgency(endOfToday.getTime()), "due_today", "23:59:59.999 today should still be due_today");
});

Deno.test("classifyUrgency: start of tomorrow -> this_week", () => {
  const startOfTomorrow = new Date();
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  startOfTomorrow.setHours(0, 0, 0, 0);
  assertEquals(classifyUrgency(startOfTomorrow.getTime()), "this_week", "midnight tomorrow should be this_week");
});

Deno.test("classifyUrgency: in 3 days -> this_week", () => {
  const in3Days = Date.now() + 3 * 24 * 60 * 60 * 1000;
  assertEquals(classifyUrgency(in3Days), "this_week", "3 days out should be this_week");
});

Deno.test("classifyUrgency: in 10 days -> later", () => {
  const in10Days = Date.now() + 10 * 24 * 60 * 60 * 1000;
  assertEquals(classifyUrgency(in10Days), "later", "10 days out should be later");
});
