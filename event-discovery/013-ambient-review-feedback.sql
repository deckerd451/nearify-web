-- Apply after 012. Private feedback and explicit-finish review receipts only.
begin;
create table if not exists public.ambient_person_feedback(
 owner_id uuid not null references public.profiles(id) on delete cascade,
 person_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),primary key(owner_id,person_id),check(owner_id<>person_id)
);
create table if not exists public.ambient_event_reviews(
 owner_id uuid not null references public.profiles(id) on delete cascade,
 event_id uuid not null references public.events(id) on delete cascade,
 session_started_at timestamptz,finished_at timestamptz not null default now(),
 dismissed boolean not null default false,snoozed_until timestamptz,
 primary key(owner_id,event_id)
);
alter table public.ambient_person_feedback enable row level security;
alter table public.ambient_event_reviews enable row level security;
revoke all on public.ambient_person_feedback,public.ambient_event_reviews from public,anon,authenticated;
create or replace function public.ambient_person_dismiss(p_other uuid,p_dismissed boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_other=v_me then raise exception 'Invalid person' using errcode='22023';end if;
 if p_dismissed then insert into public.ambient_person_feedback(owner_id,person_id) values(v_me,p_other) on conflict do nothing;
 else delete from public.ambient_person_feedback where owner_id=v_me and person_id=p_other;end if;
end $$;
-- A client declaration after explicit Finish Event, not independent attendance evidence.
-- Does not mutate membership, live presence, connections or messages.
create or replace function public.ambient_review_record(p_event uuid,p_session_started_at timestamptz default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if not exists(select 1 from public.event_attendees where event_id=p_event and profile_id=v_me and status in('joined','inEvent','left')) then
  raise exception 'Event membership required' using errcode='42501';end if;
 if p_session_started_at>now() then raise exception 'Invalid session start' using errcode='22023';end if;
 insert into public.ambient_event_reviews(owner_id,event_id,session_started_at) values(v_me,p_event,p_session_started_at)
 on conflict(owner_id,event_id) do update set session_started_at=excluded.session_started_at,finished_at=now(),dismissed=false,snoozed_until=null
 where ambient_event_reviews.session_started_at is distinct from excluded.session_started_at;
end $$;
create or replace function public.ambient_review_action(p_event uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_action not in('later','done') or p_action is null then raise exception 'Invalid action' using errcode='22023';end if;
 if exists(select 1 from public.ambient_event_reviews where owner_id=v_me and event_id=p_event) then
  update public.ambient_event_reviews set dismissed=(p_action='done'),snoozed_until=case when p_action='later' then now()+interval '1 day' else null end where owner_id=v_me and event_id=p_event;
 elsif exists(select 1 from public.account_qr_saves q join public.events e on e.id=q.event_id where q.from_profile_id=v_me and q.event_id=p_event and (to_jsonb(e)->>'ends_at')::timestamptz between now()-interval '7 days' and now()) then
  insert into public.ambient_event_reviews(owner_id,event_id,finished_at,dismissed,snoozed_until)
  select v_me,p_event,(to_jsonb(e)->>'ends_at')::timestamptz,(p_action='done'),case when p_action='later' then now()+interval '1 day' else null end from public.events e where e.id=p_event
  on conflict(owner_id,event_id) do update set dismissed=excluded.dismissed,snoozed_until=excluded.snoozed_until;
 end if;
end $$;
create or replace function public.ambient_home_extras() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();v_dismissed jsonb;v_review jsonb;begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 select coalesce(jsonb_agg(person_id),'[]'::jsonb) into v_dismissed from public.ambient_person_feedback where owner_id=v_me;
 select jsonb_build_object('event_id',r.event_id,'event_name',e.name,'people',p.people,'count',p.total) into v_review
 from (
  select owner_id,event_id,finished_at,dismissed,snoozed_until from public.ambient_event_reviews where owner_id=v_me
  union all
  -- Web-only fallback uses an actual recorded end time, never an inferred end
  -- or a claim that the caller attended. Its people still come only from own QR saves.
  select v_me,e.id,(to_jsonb(e)->>'ends_at')::timestamptz,false,null::timestamptz from public.events e
  where (to_jsonb(e)->>'ends_at')::timestamptz between now()-interval '7 days' and now()
   and exists(select 1 from public.account_qr_saves q where q.from_profile_id=v_me and q.event_id=e.id)
   and not exists(select 1 from public.ambient_event_reviews done where done.owner_id=v_me and done.event_id=e.id)
 )r join public.events e on e.id=r.event_id
 cross join lateral(
  select jsonb_agg(jsonb_build_object('profile_id',t.id,'name',t.name,'has_context',t.has_context) order by t.saved_at desc) as people,count(*) as total from(
   select distinct on(q.to_profile_id) p.id,p.name,q.saved_at,
    exists(select 1 from public.relationship_context_private n where n.owner_id=v_me and n.person_id=p.id) as has_context
   from public.account_qr_saves q join public.profiles p on p.id=q.to_profile_id
   where q.from_profile_id=v_me and q.event_id=r.event_id
   and not exists(select 1 from public.ambient_person_feedback f where f.owner_id=v_me and f.person_id=p.id)
   and not exists(select 1 from public.connections b where b.status='blocked' and
    ((b.requester_profile_id=v_me and b.addressee_profile_id=p.id)or(b.requester_profile_id=p.id and b.addressee_profile_id=v_me)))
   order by q.to_profile_id,q.saved_at desc limit 100
  )t
 )p
 where r.owner_id=v_me and not r.dismissed and(r.snoozed_until is null or r.snoozed_until<=now())
 and r.finished_at>=now()-interval '7 days' and p.total>0
 order by r.finished_at desc limit 1;
 return jsonb_build_object('dismissed_people',v_dismissed,'review',v_review);
end $$;
create or replace function public.ambient_context(p_other uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();v_result jsonb;begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 select to_jsonb(t) into v_result from(
  select person_id as profile_id,note,intention,intention_completed,updated_at,snoozed_until from public.relationship_context_private
  where owner_id=v_me and person_id=p_other
 )t;
 return coalesce(v_result,jsonb_build_object('profile_id',p_other,'note','','intention','','intention_completed',false)) || jsonb_build_object('suggestions_dismissed',exists(select 1 from public.ambient_person_feedback f where f.owner_id=v_me and f.person_id=p_other));
end $$;

create or replace function public.ambient_contexts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();v_result jsonb;begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc),'[]'::jsonb) into v_result from(
  select n.person_id as profile_id,n.note,n.intention,n.intention_completed,n.updated_at,n.snoozed_until,public.web_can_message(n.person_id) as can_message,
   (select max(m.created_at) from public.messages m join public.conversations c on c.id=m.conversation_id
    where m.sender_profile_id=v_me and ((c.participant_a=v_me and c.participant_b=n.person_id)or(c.participant_b=v_me and c.participant_a=n.person_id))) as latest_outbound_at
  from public.relationship_context_private n where n.owner_id=v_me
  and not exists(select 1 from public.ambient_person_feedback f where f.owner_id=v_me and f.person_id=n.person_id)
  and not exists(select 1 from public.connections b where b.status='blocked' and
   ((b.requester_profile_id=v_me and b.addressee_profile_id=n.person_id)or(b.requester_profile_id=n.person_id and b.addressee_profile_id=v_me)))
  order by n.updated_at desc limit 100
 )t;return v_result;
end $$;


create or replace function public.ambient_event_prep(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();v_people jsonb;begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if not exists(select 1 from public.event_attendees a join public.events e on e.id=a.event_id
   where a.profile_id=v_me and a.event_id=p_event and a.status in('joined','inEvent')
   and e.starts_at>=now()-interval '3 hours' and e.starts_at<=now()+interval '14 days') then
  return jsonb_build_object('event_id',p_event,'eligible',false,'people','[]'::jsonb);
 end if;
 with roster as(select profile_id from public.get_consented_event_attendees(p_event))
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_people from(
  select p.id as profile_id,p.name,to_jsonb(p)->>'avatar_url' as avatar_url,
   n.note,n.intention,n.intention_completed,
   exists(select 1 from roster r where r.profile_id=p.id) as opted_in_listing,
   exists(select 1 from public.account_qr_saves q where q.from_profile_id=v_me and q.to_profile_id=p.id and q.event_id=p_event) as saved_for_event,
   history.event_name as previous_event_name,history.event_at as previous_event_at
  from public.relationship_context_private n join public.profiles p on p.id=n.person_id
  left join lateral(
   select e.name as event_name,e.starts_at as event_at from public.account_qr_saves q join public.events e on e.id=q.event_id
   where q.from_profile_id=v_me and q.to_profile_id=n.person_id and q.event_id<>p_event and e.starts_at<now()
   order by e.starts_at desc limit 1
  )history on true
  where n.owner_id=v_me and not exists(select 1 from public.ambient_person_feedback f where f.owner_id=v_me and f.person_id=n.person_id) and not n.intention_completed and(n.note<>'' or n.intention<>'')
   and(n.snoozed_until is null or n.snoozed_until<=now())
   and(exists(select 1 from roster r where r.profile_id=p.id)or exists(select 1 from public.account_qr_saves q where q.from_profile_id=v_me and q.to_profile_id=p.id and q.event_id=p_event))
   and not exists(select 1 from public.connections b where b.status='blocked' and
    ((b.requester_profile_id=v_me and b.addressee_profile_id=p.id)or(b.requester_profile_id=p.id and b.addressee_profile_id=v_me)))
  order by (n.intention<>'') desc,n.updated_at desc,p.id limit 3
 )t;
 return jsonb_build_object('event_id',p_event,'eligible',true,'people',v_people);
end $$;

revoke all on function public.ambient_person_dismiss(uuid,boolean),public.ambient_review_record(uuid,timestamptz),public.ambient_review_action(uuid,text),public.ambient_home_extras() from public,anon,authenticated;
grant execute on function public.ambient_person_dismiss(uuid,boolean),public.ambient_review_record(uuid,timestamptz),public.ambient_review_action(uuid,text),public.ambient_home_extras() to authenticated;
commit;
