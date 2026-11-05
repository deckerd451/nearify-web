-- Event-level relationship history, combining co-attendance and claimed guest saves.
-- Run manually in production Supabase SQL Editor AFTER merging this PR.
-- Read-only, account-scoped, distinct by event_id.
begin;
create or replace function public.get_relationship_event_history(p_other_profile_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
with caller as (
  select p.id as profile_id from public.profiles p
  where p.user_id = auth.uid() limit 1
), evidence as (
  -- Both accounts attended the same event.
  select ea1.event_id, 'co_attended'::text as source
  from public.event_attendees ea1
  join public.event_attendees ea2 on ea1.event_id = ea2.event_id
  join caller c on c.profile_id = ea1.profile_id
  where ea2.profile_id = p_other_profile_id
    and c.profile_id <> p_other_profile_id
  union all
  -- One claimed guest saved another claimed guest at the event.
  -- Direction is intentionally accepted either way for shared history.
  select gc.event_id, 'guest_save'::text
  from public.ghost_guest_connections gc
  join public.ghost_participants owner_gp on owner_gp.id = gc.from_ghost_id
  join public.ghost_participants target_gp on target_gp.id = gc.to_ghost_id
  cross join caller c
  where (owner_gp.claimed_by_profile_id = c.profile_id
     and target_gp.claimed_by_profile_id = p_other_profile_id)
     or (target_gp.claimed_by_profile_id = c.profile_id
     and owner_gp.claimed_by_profile_id = p_other_profile_id)
), distinct_events as (
  select event_id, bool_or(source = 'guest_save') as has_guest_save
  from evidence group by event_id
)
select coalesce(jsonb_agg(jsonb_build_object(
  'event_id', e.id, 'event_name', e.name,
  'event_at', e.starts_at,
  'recovered_guest_connection', d.has_guest_save
) order by e.starts_at desc nulls last, e.id), '[]'::jsonb)
from distinct_events d
join public.events e on e.id = d.event_id;
$$;
revoke all on function public.get_relationship_event_history(uuid) from public, anon;
grant execute on function public.get_relationship_event_history(uuid) to authenticated;
commit;
