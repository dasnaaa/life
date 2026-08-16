const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FREQUENCY_DAYS = 14;
const DEFAULT_FAMILY_FREQUENCY_DAYS = 3;

export function daysSince(dateIso: string | null): number | null {
  if (!dateIso) return null;
  const diff = Date.now() - new Date(dateIso).getTime();
  return Math.max(0, Math.floor(diff / DAY_MS));
}

// Familie bekommt einen strengeren Schwellenwert (Spec-Beispiel: "alle 3
// Tage"), es sei denn der Nutzer hat manuell eine noch striktere Frequenz
// gesetzt.
export function effectiveThreshold(contactFrequencyDays: number | null, isFamily: boolean): number {
  if (isFamily) {
    return contactFrequencyDays ? Math.min(contactFrequencyDays, DEFAULT_FAMILY_FREQUENCY_DAYS) : DEFAULT_FAMILY_FREQUENCY_DAYS;
  }
  return contactFrequencyDays ?? DEFAULT_FREQUENCY_DAYS;
}

export type ContactStatus = "ok" | "due_soon" | "overdue";

// gruen (< normal) / gelb (> normal) / rot (>> normal, ab dem doppelten Schwellenwert)
export function classifyContactStatus(daysSinceContact: number | null, threshold: number): ContactStatus {
  if (daysSinceContact === null) return "due_soon";
  if (daysSinceContact <= threshold) return "ok";
  if (daysSinceContact <= threshold * 2) return "due_soon";
  return "overdue";
}

// Tage bis zum naechsten Geburtstag (Jahr in `birthday` wird ignoriert -
// Google-Kontakte ohne bekanntes Jahr speichern 1900 als Platzhalter, siehe
// Paket 2). Naechstes Vorkommen von Monat/Tag ab heute, ueber Jahreswechsel
// hinweg.
export function daysUntilNextBirthday(birthdayIso: string | null): number | null {
  if (!birthdayIso) return null;

  const birthday = new Date(birthdayIso);
  if (Number.isNaN(birthday.getTime())) return null;

  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  let next = new Date(today.getFullYear(), birthday.getMonth(), birthday.getDate()).getTime();
  if (next < todayMidnight) {
    next = new Date(today.getFullYear() + 1, birthday.getMonth(), birthday.getDate()).getTime();
  }

  return Math.round((next - todayMidnight) / DAY_MS);
}
