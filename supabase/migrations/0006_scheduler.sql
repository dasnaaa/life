-- Daily Brief: Sync-Scheduler & Hintergrund-Updates (Paket 8)
--
-- pg_cron kann keine Deno Edge Functions direkt aufrufen - der uebliche
-- Supabase-Weg ist pg_cron + pg_net (asynchrone HTTP-Requests aus
-- Postgres). Die dafuer noetigen Secrets (Projekt-URL + Service-Role-Key)
-- werden bewusst NICHT hart in dieser Migration einprogrammiert (die Datei
-- landet im Git-Repo!), sondern liegen im selben Supabase Vault, den auch
-- die OAuth-Tokens aus Paket 2 nutzen. Einmalig nach dem Deploy im
-- SQL-Editor auszufuehren:
--
--   select vault.create_secret('https://DEIN-PROJEKT.supabase.co', 'cron_supabase_url');
--   select vault.create_secret('DEIN-SERVICE-ROLE-KEY', 'cron_service_role_key');
--
-- Auf gehosteten Supabase-Projekten sind pg_cron/pg_net i.d.R. bereits
-- aktiviert (sonst: Database -> Extensions im Dashboard).
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_generate_daily_briefs() returns void
language plpgsql
security definer
set search_path = public, extensions, vault, net
as $$
declare
  v_url text;
  v_key text;
  v_user record;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'cron_supabase_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'cron_service_role_key' limit 1;

  if v_url is null or v_key is null then
    raise warning 'cron_supabase_url / cron_service_role_key fehlen im Vault - generate-daily-brief wird uebersprungen.';
    return;
  end if;

  for v_user in select distinct user_id from connected_accounts where is_active = true loop
    perform net.http_post(
      url := v_url || '/functions/v1/generate-daily-brief',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object('user_id', v_user.user_id)
    );
  end loop;
end;
$$;

-- Deckt "sync-messages" (alle 15 Minuten) ab: alle aktiven Accounts ueber
-- alle Nachrichten-Provider hinweg. sync-google buendelt bei uns Gmail +
-- Calendar + Contacts in einem Aufruf (Paket 2) - daher ist "sync-calendar"
-- weiter unten fuer Google technisch redundant, aber harmlos (idempotente
-- Upserts) und haelt sich an die in der Spec vorgegebenen zwei separaten Jobs.
create or replace function public.trigger_sync_all_messages() returns void
language plpgsql
security definer
set search_path = public, extensions, vault, net
as $$
declare
  v_url text;
  v_key text;
  v_account record;
  v_function_name text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'cron_supabase_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'cron_service_role_key' limit 1;

  if v_url is null or v_key is null then
    raise warning 'cron_supabase_url / cron_service_role_key fehlen im Vault - Message-Sync wird uebersprungen.';
    return;
  end if;

  for v_account in
    select id, provider from connected_accounts
    where is_active = true and provider in ('google', 'whatsapp', 'slack', 'clickup')
  loop
    v_function_name := case v_account.provider
      when 'google' then 'sync-google'
      when 'whatsapp' then 'sync-whatsapp'
      when 'slack' then 'sync-slack'
      when 'clickup' then 'sync-clickup'
    end;

    perform net.http_post(
      url := v_url || '/functions/v1/' || v_function_name,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object('account_id', v_account.id)
    );
  end loop;
end;
$$;

create or replace function public.trigger_sync_calendar() returns void
language plpgsql
security definer
set search_path = public, extensions, vault, net
as $$
declare
  v_url text;
  v_key text;
  v_account record;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'cron_supabase_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'cron_service_role_key' limit 1;

  if v_url is null or v_key is null then
    raise warning 'cron_supabase_url / cron_service_role_key fehlen im Vault - Calendar-Sync wird uebersprungen.';
    return;
  end if;

  for v_account in select id from connected_accounts where is_active = true and provider = 'google' loop
    perform net.http_post(
      url := v_url || '/functions/v1/sync-google',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object('account_id', v_account.id)
    );
  end loop;
end;
$$;

revoke all on function public.trigger_generate_daily_briefs() from public, anon, authenticated;
revoke all on function public.trigger_sync_all_messages() from public, anon, authenticated;
revoke all on function public.trigger_sync_calendar() from public, anon, authenticated;

-- cron.schedule() aktualisiert einen bestehenden Job mit gleichem Namen
-- statt ihn zu duplizieren - diese Migration ist also gefahrlos erneut
-- anwendbar. WICHTIG: pg_cron laeuft in UTC. "30 6 * * *" ist 6:30 UTC,
-- also 7:30 (Winter) bzw. 8:30 (Sommerzeit) in Wien - fuer wirklich 6:30
-- Wiener Zeit selbst anpassen (z.B. auf '30 4 * * *' fuer Sommerzeit).
select cron.schedule('daily-brief', '30 6 * * *', $$select public.trigger_generate_daily_briefs()$$);
select cron.schedule('sync-messages', '*/15 * * * *', $$select public.trigger_sync_all_messages()$$);
select cron.schedule('sync-calendar', '0 * * * *', $$select public.trigger_sync_calendar()$$);

-- Realtime fuer messages_cache aktivieren (Badge-Counter in der App).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages_cache'
  ) then
    alter publication supabase_realtime add table messages_cache;
  end if;
end $$;
