-- Pre-check-in discovery uses Nearify's consented roster, not IE live presence.
-- Apply after 013. Read-only; does not grant messaging or change attendance.
begin;
create or replace function public.get_event_preparation_people(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();v_people jsonb;begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.name nulls last,t.profile_id),'[]'::jsonb) into v_people from(
  select r.profile_id,r.name,r.avatar_url from public.get_consented_event_attendees(p_event) r
  where r.profile_id<>v_me
   and not exists(select 1 from public.ambient_person_feedback f where f.owner_id=v_me and f.person_id=r.profile_id)
   and not exists(select 1 from public.connections b where b.status='blocked' and
    ((b.requester_profile_id=v_me and b.addressee_profile_id=r.profile_id)or(b.requester_profile_id=r.profile_id and b.addressee_profile_id=v_me)))
  order by r.name nulls last,r.profile_id limit 3
 )t;return v_people;
end $$;
revoke all on function public.get_event_preparation_people(uuid) from public,anon,authenticated;
grant execute on function public.get_event_preparation_people(uuid) to authenticated;
commit;
