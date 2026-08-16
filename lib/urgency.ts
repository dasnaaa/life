export type TaskUrgency = "overdue" | "due_today" | "this_week" | "later" | "none";

// Bewusst client-seitig zur Anzeigezeit berechnet (statt nur den beim Sync
// gespeicherten Wert aus raw_data.urgency zu uebernehmen) - sonst wuerde ein
// gestern als "heute faellig" gesynctes Task auch morgen noch so markiert
// bleiben, bis der naechste Sync laeuft.
export function classifyTaskUrgency(dueDate: number | null): TaskUrgency {
  if (!dueDate) return "none";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = startOfToday + 24 * 60 * 60 * 1000 - 1;
  const endOfWeek = Date.now() + 7 * 24 * 60 * 60 * 1000;

  if (dueDate < startOfToday) return "overdue";
  if (dueDate <= endOfToday) return "due_today";
  if (dueDate <= endOfWeek) return "this_week";
  return "later";
}

export const urgencyRank: Record<TaskUrgency, number> = {
  overdue: 0,
  due_today: 1,
  this_week: 2,
  later: 3,
  none: 4,
};
