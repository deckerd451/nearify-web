-- Apply after 011. Intentions are private and never sent automatically.
begin;
alter table public.relationship_context_private add column if not exists intention text not null default '' check(char_length(intention)<=280);
alter table public.relationship_context_private add column if not exists intention_completed boolean not null default false;
create or replace function public.ambient_context(p_other uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();v_result jsonb;begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 select to_jsonb(t) into v_result from(
  select person_id as profile_id,note,intention,intention_completed,updated_at,snoozed_until from public.relationship_context_private
  where owner_id=v_me and person_id=p_other
 )t;
 return coalesce(v_result,jsonb_build_object('profile_id',p_other,'note','','intention','','intention_completed',false));
end $$;

create or replace function public.ambient_context_save_v2(p_other uuid,p_note text,p_intention text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();v_note text:=btrim(coalesce(p_note,''));v_intention text:=btrim(coalesce(p_intention,''));begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if char_length(v_intention)>280 then raise exception 'Keep intentions within 280 characters' using errcode='22023';end if;
 if char_length(v_note)>1000 then raise exception 'Keep notes within 1000 characters' using errcode='22023';end if;
 -- Owners can erase existing notes even after a block or loss of connection.
 if v_note='' and v_intention='' then delete from public.relationship_context_private where owner_id=v_me and person_id=p_other;return public.ambient_context(p_other);end if;
 if p_other=v_me or not(
  exists(select 1 from public.person_saves where owner_id=v_me and person_id=p_other)
  or exists(select 1 from public.account_qr_saves where from_profile_id=v_me and to_profile_id=p_other)
  or exists(select 1 from public.connections where status='accepted' and
   ((requester_profile_id=v_me and addressee_profile_id=p_other)or(requester_profile_id=p_other and addressee_profile_id=v_me)))
 ) then raise exception 'Save this person before adding a note' using errcode='42501';end if;
 insert into public.relationship_context_private(owner_id,person_id,note,intention) values(v_me,p_other,v_note,v_intention)
 on conflict(owner_id,person_id) do update set note=excluded.note,intention=excluded.intention,
 intention_completed=case when relationship_context_private.note is distinct from excluded.note or relationship_context_private.intention is distinct from excluded.intention then false else relationship_context_private.intention_completed end,
 updated_at=case when relationship_context_private.note is distinct from excluded.note or relationship_context_private.intention is distinct from excluded.intention then now() else relationship_context_private.updated_at end,
 snoozed_until=case when relationship_context_private.note is distinct from excluded.note or relationship_context_private.intention is distinct from excluded.intention then null else relationship_context_private.snoozed_until end;
 return public.ambient_context(p_other);
end $$;


-- Old clients can edit/delete the note without erasing an intention.
create or replace function public.ambient_context_save(p_other uuid,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_intention text;begin
 select intention into v_intention from public.relationship_context_private where owner_id=public.current_profile_id() and person_id=p_other;
 return public.ambient_context_save_v2(p_other,p_note,coalesce(v_intention,''));
end $$;
create or replace function public.ambient_intention_complete(p_other uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 update public.relationship_context_private set intention_completed=true where owner_id=v_me and person_id=p_other and intention<>'';
 return public.ambient_context(p_other);
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
  and not exists(select 1 from public.connections b where b.status='blocked' and
   ((b.requester_profile_id=v_me and b.addressee_profile_id=n.person_id)or(b.requester_profile_id=n.person_id and b.addressee_profile_id=v_me)))
  order by n.updated_at desc limit 100
 )t;return v_result;
end $$;


-- Exact event links only; no event-title matching or inferred attendance.
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
  where n.owner_id=v_me and not n.intention_completed and(n.note<>'' or n.intention<>'')
   and(n.snoozed_until is null or n.snoozed_until<=now())
   and(exists(select 1 from roster r where r.profile_id=p.id)or exists(select 1 from public.account_qr_saves q where q.from_profile_id=v_me and q.to_profile_id=p.id and q.event_id=p_event))
   and not exists(select 1 from public.connections b where b.status='blocked' and
    ((b.requester_profile_id=v_me and b.addressee_profile_id=p.id)or(b.requester_profile_id=p.id and b.addressee_profile_id=v_me)))
  order by (n.intention<>'') desc,n.updated_at desc,p.id limit 3
 )t;
 return jsonb_build_object('event_id',p_event,'eligible',true,'people',v_people);
end $$;
revoke all on function public.ambient_context_save_v2(uuid,text,text),public.ambient_intention_complete(uuid),public.ambient_event_prep(uuid) from public,anon,authenticated;
grant execute on function public.ambient_context_save_v2(uuid,text,text),public.ambient_intention_complete(uuid),public.ambient_event_prep(uuid) to authenticated;
commit;
