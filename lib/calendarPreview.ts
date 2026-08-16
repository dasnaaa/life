import { occurrencesInRange } from "./recurrence";

export type CalendarEventSource = {
  id: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  recurrence_rule: string | null;
  location: string | null;
  isWork: boolean;
};

export type CalendarInstance = {
  eventId: string;
  title: string;
  start: Date;
  end: Date;
  location: string | null;
  isWork: boolean;
  hasConflict: boolean;
};

export function buildWeekPreview(events: CalendarEventSource[], rangeStart: Date, rangeEnd: Date): CalendarInstance[] {
  const instances: CalendarInstance[] = [];

  for (const event of events) {
    const occurrences = occurrencesInRange(event.start_time, event.recurrence_rule, rangeStart, rangeEnd);
    const durationMs =
      event.start_time && event.end_time
        ? new Date(event.end_time).getTime() - new Date(event.start_time).getTime()
        : 0;

    for (const occurrence of occurrences) {
      instances.push({
        eventId: event.id,
        title: event.title,
        start: occurrence,
        end: new Date(occurrence.getTime() + Math.max(0, durationMs)),
        location: event.location,
        isWork: event.isWork,
        hasConflict: false,
      });
    }
  }

  instances.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Sweep ueber die zeitlich sortierte Liste: sobald instances[j] erst nach
  // dem Ende von instances[i] beginnt, koennen auch alle folgenden j (noch
  // spaeterer Start) nicht mehr ueberlappen - daher der fruehe break.
  for (let i = 0; i < instances.length; i++) {
    for (let j = i + 1; j < instances.length; j++) {
      if (instances[j].start >= instances[i].end) break;
      if (instances[i].start < instances[j].end) {
        instances[i].hasConflict = true;
        instances[j].hasConflict = true;
      }
    }
  }

  return instances;
}

export type CalendarDayGroup = { dateKey: string; date: Date; items: CalendarInstance[] };

export function groupByDay(instances: CalendarInstance[]): CalendarDayGroup[] {
  const map = new Map<string, CalendarInstance[]>();
  for (const instance of instances) {
    const key = instance.start.toDateString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(instance);
  }
  return Array.from(map.entries())
    .map(([dateKey, items]) => ({ dateKey, date: items[0].start, items }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function isWorkAccountLabel(accountLabel: string | null | undefined): boolean {
  if (!accountLabel) return false;
  return /arbeit|work|business|firma|job/i.test(accountLabel);
}
