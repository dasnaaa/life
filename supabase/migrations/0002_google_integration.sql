-- Daily Brief: Google Integration (Paket 2)
--
-- Ergaenzt das Schema aus 0001_init.sql um das, was fuer einen echten,
-- wiederholbaren Google-Sync noetig ist:
--   * last_synced_at auf connected_accounts (Settings-UI zeigt das an)
--   * external_id auf messages_cache + Unique-Index, damit wiederholte
--     Syncs Nachrichten upserten statt zu duplizieren
--   * Unique-Index auf contact_tracking(user_id, contact_identifier) aus
--     demselben Grund fuer den Google-Contacts-Merge
--   * Supabase-Vault-gestuetzte Verschluesselung der OAuth-Tokens
--     (Sicherheitsregel: "OAuth Tokens verschluesselt speichern")
--
-- Hinweis: Supabase Vault (Schema `vault`, basierend auf pgsodium) ist auf
-- gehosteten Supabase-Projekten und im lokalen CLI-Dev bereits aktiviert.

alter table connected_accounts
  add column if not exists last_synced_at timestamptz;

alter table messages_cache
  add column if not exists external_id text;

-- Kein partieller Index (WHERE external_id IS NOT NULL): Postgres behandelt
-- NULL-Werte in Unique-Indizes ohnehin als paarweise verschieden, ein
-- normaler Index deckt also beide Faelle ab und bleibt gleichzeitig als
-- ON CONFLICT-Ziel fuer PostgREST/supabase-js-upserts zuverlaessig nutzbar.
create unique index if not exists messages_cache_account_external_uidx
  on messages_cache (account_id, external_id);

create unique index if not exists contact_tracking_user_identifier_uidx
  on contact_tracking (user_id, contact_identifier);

-- ============================================================
-- Vault-gestuetzte OAuth-Token-Verwaltung
--
-- credentials jsonb auf connected_accounts speichert NIE Klartext-Tokens,
-- sondern nur { vault_secret_id, provider_account_id, provider_email,
-- expires_at, scope }. Die eigentlichen Tokens liegen verschluesselt in
-- vault.secrets und sind ausschliesslich ueber die folgenden
-- security-definer-Funktionen erreichbar, deren EXECUTE-Recht auf
-- service_role beschraenkt ist (Edge Functions) - niemals auf
-- anon/authenticated, sonst koennte ein Client fremde Tokens entschluesseln.
-- ============================================================

create or replace function public.upsert_connected_account(
  p_user_id uuid,
  p_provider text,
  p_account_label text,
  p_provider_account_id text,
  p_token_payload jsonb
) returns connected_accounts
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_existing_id uuid;
  v_existing_secret_id uuid;
  v_old_payload jsonb;
  v_merged_payload jsonb;
  v_secret_id uuid;
  v_account connected_accounts;
begin
  select id, (credentials->>'vault_secret_id')::uuid
    into v_existing_id, v_existing_secret_id
  from connected_accounts
  where user_id = p_user_id
    and provider = p_provider
    and p_provider_account_id is not null
    and credentials->>'provider_account_id' = p_provider_account_id
  limit 1;

  v_merged_payload := p_token_payload;

  -- Google liefert refresh_token nur beim allerersten Consent. Bei einem
  -- erneuten Verbinden (z.B. Label-Aenderung) muessen wir den vorhandenen
  -- refresh_token aus dem Vault-Secret uebernehmen, statt ihn zu loeschen.
  if v_existing_secret_id is not null and (p_token_payload->>'refresh_token') is null then
    select decrypted_secret::jsonb into v_old_payload
    from vault.decrypted_secrets
    where id = v_existing_secret_id;

    if v_old_payload is not null then
      v_merged_payload := p_token_payload || jsonb_build_object(
        'refresh_token', v_old_payload->>'refresh_token'
      );
    end if;
  end if;

  if v_existing_id is not null then
    perform vault.update_secret(v_existing_secret_id, v_merged_payload::text);

    update connected_accounts
    set account_label = p_account_label,
        is_active = true,
        credentials = jsonb_build_object(
          'vault_secret_id', v_existing_secret_id,
          'provider_account_id', p_provider_account_id,
          'provider_email', p_token_payload->>'provider_email',
          'expires_at', p_token_payload->>'expires_at',
          'scope', p_token_payload->>'scope'
        )
    where id = v_existing_id
    returning * into v_account;
  else
    v_secret_id := vault.create_secret(
      new_secret => v_merged_payload::text,
      new_name => gen_random_uuid()::text,
      new_description => 'oauth tokens: ' || p_provider || '/' || coalesce(p_provider_account_id, 'unknown')
    );

    insert into connected_accounts (user_id, provider, account_label, credentials, is_active)
    values (
      p_user_id, p_provider, p_account_label,
      jsonb_build_object(
        'vault_secret_id', v_secret_id,
        'provider_account_id', p_provider_account_id,
        'provider_email', p_token_payload->>'provider_email',
        'expires_at', p_token_payload->>'expires_at',
        'scope', p_token_payload->>'scope'
      ),
      true
    )
    returning * into v_account;
  end if;

  return v_account;
end;
$$;

create or replace function public.get_connected_account_tokens(p_account_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_secret_id uuid;
  v_secret text;
begin
  select (credentials->>'vault_secret_id')::uuid into v_secret_id
  from connected_accounts
  where id = p_account_id;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where id = v_secret_id;

  if v_secret is null then
    return null;
  end if;

  return v_secret::jsonb;
end;
$$;

create or replace function public.update_connected_account_tokens(
  p_account_id uuid,
  p_token_payload jsonb
) returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_secret_id uuid;
begin
  select (credentials->>'vault_secret_id')::uuid into v_secret_id
  from connected_accounts
  where id = p_account_id;

  if v_secret_id is null then
    raise exception 'connected_accounts % hat kein Vault-Secret', p_account_id;
  end if;

  perform vault.update_secret(v_secret_id, p_token_payload::text);

  update connected_accounts
  set credentials = credentials || jsonb_build_object('expires_at', p_token_payload->>'expires_at')
  where id = p_account_id;
end;
$$;

create or replace function public.touch_connected_account_sync(p_account_id uuid) returns void
language sql
security definer
set search_path = public
as $$
  update connected_accounts set last_synced_at = now() where id = p_account_id;
$$;

revoke all on function public.upsert_connected_account(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.get_connected_account_tokens(uuid) from public, anon, authenticated;
revoke all on function public.update_connected_account_tokens(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.touch_connected_account_sync(uuid) from public, anon, authenticated;

grant execute on function public.upsert_connected_account(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.get_connected_account_tokens(uuid) to service_role;
grant execute on function public.update_connected_account_tokens(uuid, jsonb) to service_role;
grant execute on function public.touch_connected_account_sync(uuid) to service_role;
