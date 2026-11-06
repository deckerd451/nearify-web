-- Private relationship context. Apply after 010; safe to rerun.
begin;
create table if not exists public.relationship_context_private (
 owner_id uuid not null references public.profiles(id) on delete cascade,
 person_id uuid not null references public.profiles(id) on delete cascade,
 note text not null default '' check(char_length(note)<=1000),
 updated_at timestamptz not null default now(),
 snoozed_until timestamptz,
 primary key(owner_id,person_id),check(owner_id<>person_id)
);
alter table public.relationship_context_private enable row level security;
revoke all on public.relationship_context_private from public,anon,authenticated;

create or replace function public.ambient_context(p_other uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();v_result jsonb;begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 select to_jsonb(t) into v_result from(
  select person_id as profile_id,note,updated_at,snoozed_until from public.relationship_context_private
  where owner_id=v_me and person_id=p_other
 )t;
 return coalesce(v_result,jsonb_build_object('profile_id',p_other,'note',''));
end $$;

create or replace function public.ambient_context_save(p_other uuid,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();v_note text:=btrim(coalesce(p_note,''));begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if char_length(v_note)>1000 then raise exception 'Keep notes within 1000 characters' using errcode='22023';end if;
 -- Owners can erase existing notes even after a block or loss of connection.
 if v_note='' then delete from public.relationship_context_private where owner_id=v_me and person_id=p_other;return public.ambient_context(p_other);end if;
 if p_other=v_me or not(
  exists(select 1 from public.person_saves where owner_id=v_me and person_id=p_other)
  or exists(select 1 from public.account_qr_saves where from_profile_id=v_me and to_profile_id=p_other)
  or exists(select 1 from public.connections where status='accepted' and
   ((requester_profile_id=v_me and addressee_profile_id=p_other)or(requester_profile_id=p_other and addressee_profile_id=v_me)))
 ) then raise exception 'Save this person before adding a note' using errcode='42501';end if;
 insert into public.relationship_context_private(owner_id,person_id,note) values(v_me,p_other,v_note)
 on conflict(owner_id,person_id) do update set note=excluded.note,
 updated_at=case when relationship_context_private.note is distinct from excluded.note then now() else relationship_context_private.updated_at end,
 snoozed_until=case when relationship_context_private.note is distinct from excluded.note then null else relationship_context_private.snoozed_until end;
 return public.ambient_context(p_other);
end $$;

create or replace function public.ambient_contexts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();v_result jsonb;begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc),'[]'::jsonb) into v_result from(
  select n.person_id as profile_id,n.note,n.updated_at,n.snoozed_until,public.web_can_message(n.person_id) as can_message,
   (select max(m.created_at) from public.messages m join public.conversations c on c.id=m.conversation_id
    where m.sender_profile_id=v_me and ((c.participant_a=v_me and c.participant_b=n.person_id)or(c.participant_b=v_me and c.participant_a=n.person_id))) as latest_outbound_at
  from public.relationship_context_private n where n.owner_id=v_me
  and not exists(select 1 from public.connections b where b.status='blocked' and
   ((b.requester_profile_id=v_me and b.addressee_profile_id=n.person_id)or(b.requester_profile_id=n.person_id and b.addressee_profile_id=v_me)))
  order by n.updated_at desc limit 100
 )t;return v_result;
end $$;

create or replace function public.ambient_context_snooze(p_other uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 update public.relationship_context_private set snoozed_until=now()+interval '7 days' where owner_id=v_me and person_id=p_other;
end $$;
revoke all on function public.ambient_context(uuid),public.ambient_context_save(uuid,text),public.ambient_contexts(),public.ambient_context_snooze(uuid) from public,anon,authenticated;
grant execute on function public.ambient_context(uuid),public.ambient_context_save(uuid,text),public.ambient_contexts(),public.ambient_context_snooze(uuid) to authenticated;
commit;
