-- Nearify consent foundation, consented roster, organizer insights.
-- Deployable ADDITIVE migration. Does not remove existing broad policies.
-- Apply only after checking live schema and verifying a restorable backup.
-- This is a single atomic transaction; any error rolls back all changes.
-- WARNING: not a complete privacy lockdown.
begin;


-- SOURCE: event-discovery/consent-foundation.sql
-- Event attendee discovery: additive, default-off consent foundation.
-- REVIEW ONLY: not executed in production by this PR.
-- This migration does NOT replace existing permissive SELECT policies or fix
-- get_public_event_attendees; those need a coordinated web/iOS rollout.

create table if not exists public.event_discovery_preferences (
  event_id uuid not null references public.events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  discoverable boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (event_id, profile_id)
);

alter table public.event_discovery_preferences enable row level security;
revoke all on public.event_discovery_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.event_discovery_preferences to authenticated;

-- Ownership is checked against profiles.user_id, not profiles.id.
-- An attendee can manage only their own event-specific preference.
create policy "event_discovery_select_own" on public.event_discovery_preferences
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = profile_id and p.user_id = (select auth.uid())
  ));
create policy "event_discovery_insert_own_attendance" on public.event_discovery_preferences
  for insert to authenticated
  with check (exists (
    select 1 from public.profiles p
    join public.event_attendees ea on ea.profile_id = p.id
    where p.id = profile_id and p.user_id = (select auth.uid())
      and ea.event_id = event_id and ea.status in ('joined', 'inEvent')
  ));
create policy "event_discovery_update_own_attendance" on public.event_discovery_preferences
  for update to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = profile_id and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.profiles p
    join public.event_attendees ea on ea.profile_id = p.id
    where p.id = profile_id and p.user_id = (select auth.uid())
      and ea.event_id = event_id and ea.status in ('joined', 'inEvent')
  ));
create policy "event_discovery_delete_own" on public.event_discovery_preferences
  for delete to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = profile_id and p.user_id = (select auth.uid())
  ));

-- Returns only the current caller's own preference. A missing row means false.
-- No roster or other participant's preferences are exposed.
create or replace function public.get_my_event_discovery_preference(p_event_id uuid)
returns boolean
language sql stable security invoker
set search_path = ''
as $$
  select coalesce((
    select edp.discoverable
    from public.event_discovery_preferences edp
    join public.profiles p on p.id = edp.profile_id
    where edp.event_id = p_event_id and p.user_id = (select auth.uid())
  ), false);
$$;

revoke all on function public.get_my_event_discovery_preference(uuid) from public, anon;
grant execute on function public.get_my_event_discovery_preference(uuid) to authenticated;


-- SOURCE: event-discovery/consented-attendees-rpc.sql
-- SECURITY REVIEW / STAGING ONLY. Do not apply to production without approval.
-- Requires event-discovery/consent-foundation.sql to have been applied.
-- Adds a consent-filtered, member-only discovery endpoint. This is not the
-- cutover: the legacy get_public_event_attendees and broad SELECT policies
-- remain exposed until web/iOS consumers are migrated and access revoked.

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



-- SOURCE: event-discovery/organizer-insights-aggregate-rpc.sql
-- REVIEW / STAGING ONLY. Do not execute against production without approval.
-- Authorization: events.created_by = profiles.id; profiles.user_id = auth.uid().
-- Aggregates only; no attendee IDs or raw profile rows returned.
-- Small events (< 5 active attendees) return no metrics; groups with < 3
-- contributors are suppressed. Confirm privacy/product semantics in staging.

create or replace function public.get_organizer_event_insights(p_event_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_with_goals bigint;
  v_goals jsonb;
  v_interests jsonb;
  v_skills jsonb;
begin
  if auth.uid() is null or p_event_id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.events e
    join public.profiles organizer on organizer.id = e.created_by
    where e.id = p_event_id
      and organizer.user_id = auth.uid()
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select count(*), count(*) filter (where ea.intent_primary is not null)
    into v_total, v_with_goals
  from public.event_attendees ea
  where ea.event_id = p_event_id
    and ea.status in ('joined', 'inEvent');

  if v_total < 5 then
    return jsonb_build_object(
      'suppressed', true,
      'total', null,
      'withGoals', null,
      'sortedGoals', '[]'::jsonb,
      'topInterests', '[]'::jsonb,
      'topSkills', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_array(goal, n) order by n desc, goal), '[]'::jsonb)
    into v_goals
  from (
    select ea.intent_primary::text as goal, count(*) as n
    from public.event_attendees ea
    where ea.event_id = p_event_id
      and ea.status in ('joined', 'inEvent')
      and ea.intent_primary is not null
    group by ea.intent_primary
    having count(*) >= 3
  ) g;

  -- Each distinct tag is counted once per profile, and rare tags are omitted.
  -- Both profile tag columns are text[]. Unnest the actual array elements:
  -- casting arrays to text and splitting on commas corrupts tags with commas.
  select coalesce(jsonb_agg(jsonb_build_array(tag, n) order by n desc, tag), '[]'::jsonb)
    into v_interests
  from (
    select tag, count(*) as n
    from (
      select distinct ea.profile_id, btrim(t.tag) as tag
      from public.event_attendees ea
      join public.profiles p on p.id = ea.profile_id
      cross join lateral unnest(coalesce(p.interests, array[]::text[])) as t(tag)
      where ea.event_id = p_event_id
        and ea.status in ('joined', 'inEvent')
        and btrim(t.tag) <> ''
    ) distinct_tags
    group by tag
    having count(*) >= 3
    order by n desc, tag
    limit 10
  ) ranked;

  select coalesce(jsonb_agg(jsonb_build_array(tag, n) order by n desc, tag), '[]'::jsonb)
    into v_skills
  from (
    select tag, count(*) as n
    from (
      select distinct ea.profile_id, btrim(t.tag) as tag
      from public.event_attendees ea
      join public.profiles p on p.id = ea.profile_id
      cross join lateral unnest(coalesce(p.skills, array[]::text[])) as t(tag)
      where ea.event_id = p_event_id
        and ea.status in ('joined', 'inEvent')
        and btrim(t.tag) <> ''
    ) distinct_tags
    group by tag
    having count(*) >= 3
    order by n desc, tag
    limit 10
  ) ranked;

  return jsonb_build_object(
    'suppressed', false,
    'total', v_total,
    'withGoals', v_with_goals,
    'sortedGoals', v_goals,
    'topInterests', v_interests,
    'topSkills', v_skills
  );
end;
$$;

revoke all on function public.get_organizer_event_insights(uuid) from public, anon;
grant execute on function public.get_organizer_event_insights(uuid) to authenticated;



commit;
