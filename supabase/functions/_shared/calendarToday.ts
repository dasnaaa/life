// Leichtgewichtige "ist das heute?"-Pruefung fuer den Tages-Vorschau-Teil
// des Briefs. Bewusst simpler als lib/recurrence.ts (App-Seite): FREQ=WEEKLY
// ignoriert hier INTERVAL (eine zweiwoechentliche Serie kann also in der
// Vorschau faelschlich jede Woche auftauchen) - fuer eine "was ist heute
// los"-Uebersicht ist ein gelegentlicher falscher Treffer unkritisch,
// waehrend die vollstaendige Logik fuer den Kalender-Tab (Paket 6) in der
// App-eigenen lib/recurrence.ts liegt.
export function isEventToday(startTime: string | null, recurrenceRule: string | null): boolean {
  if (!startTime) return false;

  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) return false;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

  if (!recurrenceRule) {
    return start >= todayStart && start <= todayEnd;
  }

  const freqMatch = recurrenceRule.match(/FREQ=([A-Z]+)/);
  if (!freqMatch || freqMatch[1] !== "WEEKLY") {
    return start >= todayStart && start <= todayEnd;
  }

  if (start > todayEnd) return false; // Serie hat noch nicht begonnen

  const untilMatch = recurrenceRule.match(/UNTIL=(\d{8})/);
  if (untilMatch) {
    const ymd = untilMatch[1];
    const until = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
    if (todayStart > until) return false;
  }

  const dayMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const byDayMatch = recurrenceRule.match(/BYDAY=([A-Z,]+)/);
  const targetDays = byDayMatch ? byDayMatch[1].split(",").map((day) => dayMap[day]) : [start.getDay()];

  return targetDays.includes(now.getDay());
}

export function isBirthdayToday(birthday: string | null): boolean {
  if (!birthday) return false;
  const b = new Date(birthday);
  if (Number.isNaN(b.getTime())) return false;
  const now = new Date();
  return b.getMonth() === now.getMonth() && b.getDate() === now.getDate();
}

export function isBirthdayThisWeek(birthday: string | null): boolean {
  if (!birthday) return false;
  const b = new Date(birthday);
  if (Number.isNaN(b.getTime())) return false;

  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisYear = new Date(now.getFullYear(), b.getMonth(), b.getDate());
  const target = thisYear >= todayMidnight ? thisYear : new Date(now.getFullYear() + 1, b.getMonth(), b.getDate());

  const diffDays = (target.getTime() - todayMidnight.getTime()) / (24 * 60 * 60 * 1000);
  return diffDays >= 0 && diffDays <= 7;
}

export function isContactOverdue(
  lastContactedAt: string | null,
  frequencyDays: number | null,
  isFamily: boolean
): boolean {
  if (!lastContactedAt) return false;
  const days = Math.floor((Date.now() - new Date(lastContactedAt).getTime()) / (24 * 60 * 60 * 1000));
  const threshold = isFamily ? Math.min(frequencyDays ?? 3, 3) : frequencyDays ?? 14;
  return days > threshold;
}
