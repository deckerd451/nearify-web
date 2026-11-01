-- Event attendee discovery: additive, default-off consent foundation.
-- REVIEW ONLY: not executed in production by this PR.
-- This migration does NOT replace existing permissive SELECT policies or fix
-- get_public_event_attendees; those need a coordinated web/iOS rollout.
begin;

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
commit;
