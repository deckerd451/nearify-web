-- SECURITY REVIEW / STAGING ONLY. Do not apply to production without approval.
-- Requires event-discovery/consent-foundation.sql to have been applied.
-- Adds a consent-filtered, member-only discovery endpoint. This is not the
-- cutover: the legacy get_public_event_attendees and broad SELECT policies
-- remain exposed until web/iOS consumers are migrated and access revoked.
begin;

create or replace function public.get_consented_event_attendees(p_event_id uuid)
returns table (
  profile_id uuid,
  name text,
  avatar_url text,
  intent_primary text,
  intent_secondary text,
  interests text[],
  skills text[]
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_caller_profile_id uuid;
begin
  if auth.uid() is null or p_event_id is null then
    return;
  end if;

  select p.id into v_caller_profile_id
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;

  if v_caller_profile_id is null then
    return;
  end if;

  -- Caller must currently attend the exact event. A profile without a
  -- valid auth user cannot bypass this gate.
  if not exists (
    select 1 from public.event_attendees mine
    where mine.event_id = p_event_id
      and mine.profile_id = v_caller_profile_id
      and mine.status in ('joined', 'inEvent')
  ) then
    return;
  end if;

  return query
    select p.id, p.name::text, p.avatar_url::text,
           ea.intent_primary::text, ea.intent_secondary::text,
           p.interests, p.skills
    from public.event_attendees ea
    join public.profiles p on p.id = ea.profile_id
    join public.event_discovery_preferences pref
      on pref.event_id = ea.event_id and pref.profile_id = ea.profile_id
    where ea.event_id = p_event_id
      and ea.status in ('joined', 'inEvent')
      and pref.discoverable is true
    order by ea.joined_at, ea.profile_id
    limit 200;
end;
$$;

revoke all on function public.get_consented_event_attendees(uuid)
  from public, anon;
grant execute on function public.get_consented_event_attendees(uuid)
  to authenticated;

commit;
