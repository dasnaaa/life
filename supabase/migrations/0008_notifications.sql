-- Daily Brief: Notifications (Paket 11)
--
-- Zwei Tabellen:
--   * notifications: In-App-Feed (Glocke im Header), plattformunabhaengig.
--   * push_subscriptions: Web-Push-Abos (VAPID) fuer die Web-Deployment,
--     damit Benachrichtigungen auch ankommen, wenn der Browser-Tab
--     geschlossen ist. Nativer Build hat dafuer bereits lokale
--     Benachrichtigungen via expo-notifications (Paket 8, lib/backgroundSync.ts) -
--     das hier ergaenzt echten Server-Push, primaer fuers Web.

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  type text not null, -- 'daily_brief', 'urgent_message', 'birthday', 'contact_overdue', 'course_ending'
  title text not null,
  body text not null,
  data jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_id_created_at_idx on notifications (user_id, created_at desc);

alter table notifications enable row level security;

create policy "notifications_owner_all" on notifications
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

-- Eigene Policy statt "owner_all": Inserts/Updates laufen ueber die
-- save-push-subscription Edge Function mit Service-Role (der Browser kennt
-- seinen eigenen Endpoint, aber wir wollen keine Client-Schreibrechte auf
-- eine Tabelle, die als Versand-Adressliste dient). Lesen/Loeschen bleibt
-- dem Owner vorbehalten, z.B. um Push in den Einstellungen zu deaktivieren.
create policy "push_subscriptions_owner_read" on push_subscriptions
  for select
  using (auth.uid() = user_id);

create policy "push_subscriptions_owner_delete" on push_subscriptions
  for delete
  using (auth.uid() = user_id);

-- Realtime fuer die Glocke im Header (analog messages_cache/useUnreadBadge).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;
