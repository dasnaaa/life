-- Daily Brief: Settings & Onboarding (Paket 9)

create table user_settings (
  user_id uuid primary key references auth.users,
  -- In Wiener Ortszeit gemeint (siehe trigger_generate_daily_briefs unten,
  -- das rechnet mit "at time zone 'Europe/Vienna'" - damit klappt die
  -- Sommerzeit automatisch, ohne dass wir das manuell nachfuehren muessen).
  brief_time time not null default '06:30:00',
  sections_enabled jsonb not null default '{"email":true,"news":true,"messages":true,"calendar":true}'::jsonb,
  news_sources text[] not null default array['derstandard.at','orf.at','diepresse.com','apa.at'],
  has_completed_onboarding boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

create policy "user_settings_owner_all" on user_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- trigger_generate_daily_briefs ersetzen: statt einmal taeglich fuer ALLE
-- Nutzer zu feuern, laeuft der Cron jetzt alle 15 Minuten und dispatcht nur
-- fuer Nutzer, deren individuell gewaehlte brief_time gerade (+/- 7 Minuten,
-- die halbe Taktbreite) erreicht ist - macht "Brief-Uhrzeit waehlen" aus
-- der Spec tatsaechlich wirksam statt nur ein ignoriertes UI-Feld zu sein.
-- ============================================================
create or replace function public.trigger_generate_daily_briefs() returns void
language plpgsql
security definer
set search_path = public, extensions, vault, net
as $$
declare
  v_url text;
  v_key text;
  v_user record;
  v_now_time time := (now() at time zone 'Europe/Vienna')::time;
  v_diff_minutes numeric;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'cron_supabase_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'cron_service_role_key' limit 1;

  if v_url is null or v_key is null then
    raise warning 'cron_supabase_url / cron_service_role_key fehlen im Vault - generate-daily-brief wird uebersprungen.';
    return;
  end if;

  for v_user in
    select distinct ca.user_id, coalesce(us.brief_time, '06:30:00'::time) as brief_time
    from connected_accounts ca
    left join user_settings us on us.user_id = ca.user_id
    where ca.is_active = true
  loop
    v_diff_minutes := abs(extract(epoch from (v_now_time - v_user.brief_time)) / 60);
    if v_diff_minutes > 720 then
      v_diff_minutes := 1440 - v_diff_minutes; -- Wraparound um Mitternacht
    end if;

    if v_diff_minutes > 7 then
      continue;
    end if;

    perform net.http_post(
      url := v_url || '/functions/v1/generate-daily-brief',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object('user_id', v_user.user_id)
    );
  end loop;
end;
$$;

revoke all on function public.trigger_generate_daily_briefs() from public, anon, authenticated;

select cron.schedule('daily-brief', '*/15 * * * *', $$select public.trigger_generate_daily_briefs()$$);
