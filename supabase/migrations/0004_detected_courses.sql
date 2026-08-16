-- Daily Brief: Kalender-Intelligenz / Kinder-Kurse (Paket 6)

create table detected_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  calendar_event_id uuid references calendar_events_cache on delete set null,
  title text not null,
  frequency text,
  -- Freitext statt `date`: Gemini liefert oft vage Angaben ("Ende Dezember")
  -- statt eines sauberen ISO-Datums. Die verlaessliche Berechnung "noch X
  -- Wochen" laeuft app-seitig ueber die RRULE UNTIL-Klausel, falls vorhanden.
  estimated_end_text text,
  requires_signup boolean not null default false,
  reasoning text,
  is_confirmed boolean not null default false,
  is_dismissed boolean not null default false,
  detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index detected_courses_user_event_uidx
  on detected_courses (user_id, calendar_event_id);

alter table detected_courses enable row level security;

create policy "detected_courses_owner_all" on detected_courses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
