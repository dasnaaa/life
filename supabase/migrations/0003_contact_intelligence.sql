-- Daily Brief: Kontakt-Tracking & Beziehungsmanagement (Paket 5)

alter table contact_tracking
  add column if not exists is_family boolean not null default false;

-- ============================================================
-- refresh_contact_frequency: analysiert messages_cache der letzten
-- p_days_back Tage plattformuebergreifend (WhatsApp, Slack, persoenliche
-- Gmail-Mails - Newsletter/Automatisch zaehlen bewusst nicht als
-- Kontakt-Kommunikation) und schreibt die Top p_top_n Kontakte nach
-- contact_tracking.
--
-- Bewusst SECURITY INVOKER (nicht DEFINER wie die Vault-Funktionen aus
-- Paket 2): diese Funktion braucht keine erhoehten Rechte, RLS auf
-- messages_cache/connected_accounts/contact_tracking scoped automatisch
-- auf die Daten des aufrufenden Nutzers. Direkt per supabase-js .rpc()
-- aus der App aufrufbar.
-- ============================================================
create or replace function public.refresh_contact_frequency(
  p_days_back integer default 90,
  p_top_n integer default 30
) returns setof contact_tracking
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'refresh_contact_frequency erfordert eine eingeloggte Session';
  end if;

  return query
  with candidate_messages as (
    select
      mc.platform,
      mc.sender_id,
      coalesce(mc.sender_name, mc.sender_id) as sender_name,
      mc.received_at
    from messages_cache mc
    join connected_accounts ca on ca.id = mc.account_id
    where ca.user_id = v_user_id
      and mc.sender_id is not null
      and mc.received_at is not null
      and mc.received_at >= now() - (p_days_back || ' days')::interval
      and mc.platform in ('whatsapp', 'slack', 'gmail')
      and not (
        mc.platform = 'gmail'
        and coalesce(mc.raw_data->>'category', 'persoenlich') <> 'persoenlich'
      )
  ),
  aggregated as (
    select
      platform,
      sender_id,
      max(sender_name) as sender_name,
      count(*) as message_count,
      min(received_at) as first_message_at,
      max(received_at) as last_message_at
    from candidate_messages
    group by platform, sender_id
  ),
  ranked as (
    select
      *,
      case
        when message_count > 1
          then greatest(1, extract(epoch from (last_message_at - first_message_at)) / 86400.0 / (message_count - 1))
        else null
      end as frequency_days
    from aggregated
    order by message_count desc
    limit p_top_n
  ),
  upserted as (
    insert into contact_tracking (
      user_id, contact_name, contact_identifier, platform, last_contacted_at, contact_frequency_days
    )
    select
      v_user_id, sender_name, sender_id, platform, last_message_at,
      round(frequency_days)::integer
    from ranked
    on conflict (user_id, contact_identifier) do update
      set contact_name = excluded.contact_name,
          platform = excluded.platform,
          last_contacted_at = excluded.last_contacted_at,
          contact_frequency_days = coalesce(excluded.contact_frequency_days, contact_tracking.contact_frequency_days)
    returning *
  )
  select * from upserted;
end;
$$;

grant execute on function public.refresh_contact_frequency(integer, integer) to authenticated;
