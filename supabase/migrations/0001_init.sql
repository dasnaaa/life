-- Daily Brief: initial schema (Paket 1)

-- Verbundene Accounts
create table connected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  provider text not null, -- 'google', 'slack', 'clickup', 'whatsapp'
  account_label text, -- z.B. 'Privat', 'Arbeit SPÖ'
  credentials jsonb, -- verschluesselt gespeichert
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Gecachte Nachrichten
create table messages_cache (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references connected_accounts not null,
  platform text not null,
  sender_name text,
  sender_id text,
  content_preview text,
  received_at timestamptz,
  is_read boolean default false,
  raw_data jsonb,
  synced_at timestamptz default now()
);

-- Kontakt-Tracking
create table contact_tracking (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  contact_name text not null,
  contact_identifier text,
  platform text,
  last_contacted_at timestamptz,
  contact_frequency_days integer,
  is_priority boolean default false,
  birthday date,
  notes text
);

-- Kalender-Events gecacht
create table calendar_events_cache (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references connected_accounts not null,
  event_id text unique,
  title text,
  start_time timestamptz,
  end_time timestamptz,
  recurrence_rule text,
  participants jsonb,
  location text,
  raw_data jsonb,
  synced_at timestamptz default now()
);

-- AI-generierte Briefs
create table daily_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  brief_date date default current_date,
  section text, -- 'messages', 'email', 'calendar', 'news', 'work'
  content jsonb,
  generated_at timestamptz default now()
);

-- Nachrichtenvorschlaege
create table message_suggestions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contact_tracking not null,
  suggested_text text,
  context text,
  created_at timestamptz default now(),
  was_used boolean default false
);

-- Indizes fuer die haeufigsten Zugriffsmuster
create index messages_cache_account_id_idx on messages_cache (account_id);
create index calendar_events_cache_account_id_idx on calendar_events_cache (account_id);
create index contact_tracking_user_id_idx on contact_tracking (user_id);
create index message_suggestions_contact_id_idx on message_suggestions (contact_id);

-- ============================================================
-- Row Level Security: jeder Nutzer sieht ausschliesslich eigene Daten
-- ============================================================

alter table connected_accounts enable row level security;
alter table messages_cache enable row level security;
alter table contact_tracking enable row level security;
alter table calendar_events_cache enable row level security;
alter table daily_briefs enable row level security;
alter table message_suggestions enable row level security;

-- connected_accounts: direkter user_id-Bezug
create policy "connected_accounts_owner_all" on connected_accounts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- messages_cache: Eigentum ueber connected_accounts.user_id
create policy "messages_cache_owner_all" on messages_cache
  for all
  using (
    exists (
      select 1 from connected_accounts
      where connected_accounts.id = messages_cache.account_id
        and connected_accounts.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from connected_accounts
      where connected_accounts.id = messages_cache.account_id
        and connected_accounts.user_id = auth.uid()
    )
  );

-- contact_tracking: direkter user_id-Bezug
create policy "contact_tracking_owner_all" on contact_tracking
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- calendar_events_cache: Eigentum ueber connected_accounts.user_id
create policy "calendar_events_cache_owner_all" on calendar_events_cache
  for all
  using (
    exists (
      select 1 from connected_accounts
      where connected_accounts.id = calendar_events_cache.account_id
        and connected_accounts.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from connected_accounts
      where connected_accounts.id = calendar_events_cache.account_id
        and connected_accounts.user_id = auth.uid()
    )
  );

-- daily_briefs: direkter user_id-Bezug
create policy "daily_briefs_owner_all" on daily_briefs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- message_suggestions: Eigentum ueber contact_tracking.user_id
create policy "message_suggestions_owner_all" on message_suggestions
  for all
  using (
    exists (
      select 1 from contact_tracking
      where contact_tracking.id = message_suggestions.contact_id
        and contact_tracking.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from contact_tracking
      where contact_tracking.id = message_suggestions.contact_id
        and contact_tracking.user_id = auth.uid()
    )
  );
