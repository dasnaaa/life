// Absichtlich kein voller iCal-RRULE-Parser: deckt den mit Abstand
// haeufigsten Fall fuer Kinder-Kurse ab (FREQ=WEEKLY, optional INTERVAL/
// BYDAY/UNTIL). Alles andere zeigt lieber "kein berechenbarer naechster
// Termin" statt eine falsche Berechnung.
export type ParsedRecurrence = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | null;
  interval: number;
  byDay: number[]; // 0=So .. 6=Sa
  until: Date | null;
  count: number | null;
};

const BYDAY_MAP: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseRecurrenceRule(rrule: string | null): ParsedRecurrence | null {
  if (!rrule) return null;

  const ruleLine = rrule.split(/;(?=DTSTART)|\r?\n/).find((line) => line.toUpperCase().includes("FREQ=")) ?? rrule;
  const cleaned = ruleLine.replace(/^RRULE:/i, "");

  const parts: Record<string, string> = {};
  for (const part of cleaned.split(";")) {
    const [key, value] = part.split("=");
    if (key && value) parts[key.toUpperCase()] = value;
  }

  if (!parts.FREQ) return null;

  const byDay = (parts.BYDAY ?? "")
    .split(",")
    .map((d) => BYDAY_MAP[d.trim().toUpperCase().slice(-2)])
    .filter((d): d is number => d !== undefined);

  return {
    freq: (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(parts.FREQ) ? parts.FREQ : null) as ParsedRecurrence["freq"],
    interval: parts.INTERVAL ? Number(parts.INTERVAL) || 1 : 1,
    byDay,
    until: parts.UNTIL ? parseIcalDate(parts.UNTIL) : null,
    count: parts.COUNT ? Number(parts.COUNT) : null,
  };
}

function parseIcalDate(value: string): Date | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

function alignedOccurrenceCheck(candidate: Date, start: Date, targetDays: number[], interval: number): boolean {
  if (!targetDays.includes(candidate.getDay())) return false;
  const weeksSinceStart = Math.floor((candidate.getTime() - start.getTime()) / (7 * DAY_MS));
  return weeksSinceStart >= 0 && weeksSinceStart % interval === 0;
}

// Naechster zukuenftiger Termin ab jetzt. Nur fuer FREQ=WEEKLY vollstaendig
// unterstuetzt; bei allen anderen Frequenzen wird nur das (gecachte) erste
// Vorkommen zurueckgegeben, falls es noch in der Zukunft liegt.
export function nextOccurrence(startIso: string | null, rrule: string | null): Date | null {
  if (!startIso) return null;
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;

  const parsed = parseRecurrenceRule(rrule);
  const now = new Date();

  if (!parsed || parsed.freq !== "WEEKLY") {
    return start > now ? start : null;
  }

  const targetDays = parsed.byDay.length > 0 ? parsed.byDay : [start.getDay()];
  const maxIterations = 366 * 2;

  for (let i = 0; i < maxIterations; i++) {
    const candidate = new Date(start.getTime() + i * DAY_MS);
    candidate.setHours(start.getHours(), start.getMinutes(), 0, 0);

    if (!alignedOccurrenceCheck(candidate, start, targetDays, parsed.interval)) continue;
    if (parsed.until && candidate > parsed.until) return null;
    if (candidate <= now) continue;

    return candidate;
  }

  return null;
}

// Alle Vorkommen innerhalb [rangeStart, rangeEnd] - fuer die 7-Tage-Vorschau.
export function occurrencesInRange(startIso: string | null, rrule: string | null, rangeStart: Date, rangeEnd: Date): Date[] {
  if (!startIso) return [];
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return [];

  const parsed = parseRecurrenceRule(rrule);
  if (!parsed || parsed.freq !== "WEEKLY") {
    return start >= rangeStart && start <= rangeEnd ? [start] : [];
  }

  const targetDays = parsed.byDay.length > 0 ? parsed.byDay : [start.getDay()];
  const occurrences: Date[] = [];
  const searchStart = start < rangeStart ? start : rangeStart;
  const totalDays = Math.ceil((rangeEnd.getTime() - searchStart.getTime()) / DAY_MS);
  if (totalDays < 0) return [];

  for (let i = 0; i <= totalDays; i++) {
    const candidate = new Date(searchStart.getTime() + i * DAY_MS);
    candidate.setHours(start.getHours(), start.getMinutes(), 0, 0);

    if (candidate < rangeStart || candidate > rangeEnd) continue;
    if (candidate < start) continue;
    if (!alignedOccurrenceCheck(candidate, start, targetDays, parsed.interval)) continue;
    if (parsed.until && candidate > parsed.until) continue;

    occurrences.push(candidate);
  }

  return occurrences;
}

export function weeksUntil(date: Date | null): number | null {
  if (!date) return null;
  const diffMs = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (7 * DAY_MS)));
}

// "noch X Wochen" fuer einen erkannten Kurs - nur berechenbar, wenn die
// RRULE selbst eine UNTIL-Klausel hat. Sonst zeigt die UI stattdessen
// Gemini's estimated_end_text als Freitext-Hinweis an.
export function weeksRemainingFromRule(rrule: string | null): number | null {
  const parsed = parseRecurrenceRule(rrule);
  if (!parsed?.until) return null;
  return weeksUntil(parsed.until);
}
