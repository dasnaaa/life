-- Daily Brief: Terminkoordination mit Kinderbetreuung (Paket 12)
--
-- Ablauf: Freundin schlaegt per WhatsApp einen Termin vor -> App prueft den
-- Kalender, formuliert eine Anfrage an die Kinderbetreuung, wertet deren
-- Antwort aus und schlaegt danach vor, den Termin einzutragen + der
-- Freundin zu bestaetigen. Bewusst NICHT vollautomatisch (siehe
-- coordination_requests.status) - jeder Versand wird vom Nutzer selbst
-- ausgeloest, die App bereitet nur vor.

alter table contact_tracking
  add column if not exists is_childcare_contact boolean not null default false;

create table coordination_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,

  -- Freundin/Freund, die/der den Termin vorgeschlagen hat. Kein FK auf
  -- contact_tracking, weil die Person zum Zeitpunkt der Erkennung noch
  -- nicht zwingend als Kontakt angelegt ist - wir kennen sie nur aus der
  -- WhatsApp-Nachricht (sender_name/sender_id).
  friend_name text not null,
  friend_whatsapp_id text not null,
  source_message_id uuid references messages_cache on delete set null,

  -- Kinderbetreuungs-Kontakt (muss vorher in den Einstellungen als solcher
  -- markiert sein, siehe contact_tracking.is_childcare_contact).
  childcare_contact_id uuid references contact_tracking not null,

  proposed_time_text text,
  proposed_time timestamptz,
  has_calendar_conflict boolean not null default false,

  -- status-Ablauf: detected -> childcare_draft_ready -> childcare_sent
  --   -> childcare_confirmed | childcare_declined -> calendar_confirmed
  --   -> friend_notified
  -- (oder jederzeit -> cancelled)
  status text not null default 'detected',

  childcare_message_draft text,
  childcare_reply_text text,
  childcare_reply_available boolean,

  friend_confirmation_draft text,
  calendar_event_id uuid references calendar_events_cache on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index coordination_requests_user_id_status_idx on coordination_requests (user_id, status);
create index coordination_requests_childcare_contact_idx on coordination_requests (childcare_contact_id);

alter table coordination_requests enable row level security;

create policy "coordination_requests_owner_all" on coordination_requests
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'coordination_requests'
  ) then
    alter publication supabase_realtime add table coordination_requests;
  end if;
end $$;
