-- REVIEW / STAGING ONLY. Do not execute against production without approval.
-- Authorization: events.created_by = profiles.id; profiles.user_id = auth.uid().
-- Aggregates only; no attendee IDs or raw profile rows returned.
-- Small events (< 5 active attendees) return no metrics; groups with < 3
-- contributors are suppressed. Confirm privacy/product semantics in staging.
begin;

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
