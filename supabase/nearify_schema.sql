--
-- PostgreSQL database dump
--

\restrict uHnXNCj2jDs3EhP3VBH0FcpvBcj7xrjRLG4jbu76kBZTnRPa0Y8S6GnV5Bi33G8

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.7 (Postgres.app)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: ambient_context(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ambient_context(p_other uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id();v_result jsonb;begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 select to_jsonb(t) into v_result from(
  select person_id as profile_id,note,intention,intention_completed,updated_at,snoozed_until from public.relationship_context_private
  where owner_id=v_me and person_id=p_other
 )t;
 return coalesce(v_result,jsonb_build_object('profile_id',p_other,'note','','intention','','intention_completed',false)) || jsonb_build_object('suggestions_dismissed',exists(select 1 from public.ambient_person_feedback f where f.owner_id=v_me and f.person_id=p_other));
end $$;


--
-- Name: ambient_context_save(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ambient_context_save(p_other uuid, p_note text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_intention text;begin
 select intention into v_intention from public.relationship_context_private where owner_id=public.current_profile_id() and person_id=p_other;
 return public.ambient_context_save_v2(p_other,p_note,coalesce(v_intention,''));
end $$;


--
-- Name: ambient_context_save_v2(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ambient_context_save_v2(p_other uuid, p_note text, p_intention text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: ambient_context_snooze(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ambient_context_snooze(p_other uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id();begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 update public.relationship_context_private set snoozed_until=now()+interval '7 days' where owner_id=v_me and person_id=p_other;
end $$;


--
-- Name: ambient_contexts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ambient_contexts() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: ambient_event_prep(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ambient_event_prep(p_event uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: ambient_home_extras(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ambient_home_extras() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: ambient_intention_complete(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ambient_intention_complete(p_other uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id();begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 update public.relationship_context_private set intention_completed=true where owner_id=v_me and person_id=p_other and intention<>'';
 return public.ambient_context(p_other);
end $$;


--
-- Name: ambient_person_dismiss(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ambient_person_dismiss(p_other uuid, p_dismissed boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id();begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_other=v_me then raise exception 'Invalid person' using errcode='22023';end if;
 if p_dismissed then insert into public.ambient_person_feedback(owner_id,person_id) values(v_me,p_other) on conflict do nothing;
 else delete from public.ambient_person_feedback where owner_id=v_me and person_id=p_other;end if;
end $$;


--
-- Name: ambient_review_action(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ambient_review_action(p_event uuid, p_action text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: ambient_review_record(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ambient_review_record(p_event uuid, p_session_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id();begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if not exists(select 1 from public.event_attendees where event_id=p_event and profile_id=v_me and status in('joined','inEvent','left')) then
  raise exception 'Event membership required' using errcode='42501';end if;
 if p_session_started_at>now() then raise exception 'Invalid session start' using errcode='22023';end if;
 insert into public.ambient_event_reviews(owner_id,event_id,session_started_at) values(v_me,p_event,p_session_started_at)
 on conflict(owner_id,event_id) do update set session_started_at=excluded.session_started_at,finished_at=now(),dismissed=false,snoozed_until=null
 where ambient_event_reviews.session_started_at is distinct from excluded.session_started_at;
end $$;


--
-- Name: capture_private_contact_preferences(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.capture_private_contact_preferences() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_has_details boolean;
begin
 if auth.uid() is null and current_setting('role',true) in('anon','authenticated') then raise exception 'Sign in required' using errcode='42501';end if;
 if auth.uid() is not null and new.user_id is distinct from auth.uid() then raise exception 'Only the owner may edit contact preferences' using errcode='42501';end if;
 new.public_email:=nullif(btrim(new.public_email),'');new.public_phone:=nullif(btrim(new.public_phone),'');
 new.linkedin_url:=nullif(btrim(new.linkedin_url),'');new.website_url:=nullif(btrim(new.website_url),'');
 v_has_details:=new.public_email is not null or new.public_phone is not null or new.linkedin_url is not null or new.website_url is not null or coalesce(new.share_email,false) or coalesce(new.share_phone,false) or coalesce(new.preferred_contact_method,'nearify')<>'nearify';
 -- A profile INSERT/UPSERT may resolve to an existing row with a different id.
 -- Never create a private preference row from a BEFORE INSERT trigger. Blank
 -- legacy profile writes are harmless no-ops and never erase private values.
 if v_has_details then
  if tg_op='INSERT' or auth.uid() is not null then raise exception 'Use private contact preferences to edit contact details' using errcode='42501';end if;
  -- Trusted maintenance of an existing profile may move nonempty legacy data
  -- into the private store, but no raw sharing value reaches a profile reader.
  insert into public.contact_preferences_private(profile_id,email,phone,linkedin,website,allow_email,allow_phone,preferred)
  values(new.id,new.public_email,new.public_phone,new.linkedin_url,new.website_url,coalesce(new.share_email,false),coalesce(new.share_phone,false),new.preferred_contact_method)
  on conflict(profile_id) do update set email=excluded.email,phone=excluded.phone,linkedin=excluded.linkedin,website=excluded.website,allow_email=excluded.allow_email,allow_phone=excluded.allow_phone,preferred=excluded.preferred,updated_at=now();
 end if;
 new.public_email:=null;new.public_phone:=null;new.linkedin_url:=null;new.website_url:=null;new.share_email:=false;new.share_phone:=false;new.preferred_contact_method:=null;
 return new;
end $$;


--
-- Name: claim_ghost_activity(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_ghost_activity(p_ghost_id uuid, p_profile_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_auth_profile_id uuid;
  v_headers jsonb;
  v_ghost_token text;
  v_interactions_claimed int := 0;
  v_ghosts_claimed int := 0;
begin
  v_auth_profile_id := public.current_profile_id();
  if v_auth_profile_id is null or v_auth_profile_id <> p_profile_id then
    raise exception 'Forbidden';
  end if;

  v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  v_ghost_token := coalesce(v_headers->>'x-ghost-token', v_headers->>'x-nearify-ghost-token');

  if v_ghost_token is null then
    raise exception 'Missing ghost token';
  end if;

  if not exists (
    select 1
    from public.ghost_participants gp
    where gp.id = p_ghost_id
      and gp.ghost_token = v_ghost_token
      and (
        gp.claimed_by_profile_id is null
        or gp.claimed_by_profile_id = p_profile_id
      )
  ) then
    raise exception 'Ghost claim not allowed';
  end if;

  update public.interaction_events ie
  set claimed_by_profile_id = p_profile_id
  where ie.from_ghost_id = p_ghost_id
    and (
      ie.claimed_by_profile_id is null
      or ie.claimed_by_profile_id = p_profile_id
    );

  get diagnostics v_interactions_claimed = row_count;

  update public.ghost_participants gp
  set claimed_by_profile_id = p_profile_id
  where gp.id = p_ghost_id
    and gp.ghost_token = v_ghost_token
    and (
      gp.claimed_by_profile_id is null
      or gp.claimed_by_profile_id = p_profile_id
    );

  get diagnostics v_ghosts_claimed = row_count;

  return jsonb_build_object(
    'ghost_id', p_ghost_id,
    'claimed_by_profile_id', p_profile_id,
    'interactions_claimed', v_interactions_claimed,
    'ghost_sessions_updated', v_ghosts_claimed
  );
end;
$$;


--
-- Name: claim_guest_network(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_guest_network(p_ghost_id uuid, p_ghost_token text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_profile_id uuid;
  v_claimed_by uuid;
  v_claimed_interactions int := 0;
  v_guest_edges int := 0;
begin
  select p.id into v_profile_id from public.profiles p
  where p.user_id = auth.uid() limit 1;
  if v_profile_id is null then
    raise exception 'Authenticated Nearify profile required' using errcode = 'P0001';
  end if;
  -- Lock the guest to prevent concurrent claims by different accounts.
  select gp.claimed_by_profile_id into v_claimed_by
  from public.ghost_participants gp
  where gp.id = p_ghost_id and gp.ghost_token = p_ghost_token
  for update;
  if not found or (v_claimed_by is not null and v_claimed_by <> v_profile_id) then
    raise exception 'Guest claim not allowed' using errcode = 'P0001';
  end if;

  update public.interaction_events ie
  set claimed_by_profile_id = v_profile_id
  where ie.from_ghost_id = p_ghost_id
    and (ie.claimed_by_profile_id is null or ie.claimed_by_profile_id = v_profile_id);
  get diagnostics v_claimed_interactions = row_count;

  update public.ghost_participants gp
  set claimed_by_profile_id = v_profile_id
  where gp.id = p_ghost_id and gp.ghost_token = p_ghost_token
    and (gp.claimed_by_profile_id is null or gp.claimed_by_profile_id = v_profile_id);

  select count(*) into v_guest_edges from public.ghost_guest_connections gc
  where gc.from_ghost_id = p_ghost_id;
  return jsonb_build_object(
    'profile_id', v_profile_id,
    'interactions_claimed', v_claimed_interactions,
    'guest_connections_preserved', v_guest_edges
  );
end;
$$;


--
-- Name: community_signal_connection(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.community_signal_connection(p_target_user uuid, p_invite boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_target uuid;v_state jsonb;begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 select id into v_target from public.profiles where user_id=p_target_user limit 1;
 if v_target is null or p_target_user=auth.uid() then raise exception 'Invalid person';end if;
 if not exists(select 1 from public.community_signals where sender_id=auth.uid() and recipient_id=p_target_user)
 or not exists(select 1 from public.community_signals where sender_id=p_target_user and recipient_id=auth.uid()) then raise exception 'Mutual acknowledgement required' using errcode='42501';end if;
 if p_invite then
  if not exists(select 1 from public.community_signal_preferences where user_id=p_target_user and discoverable and receive_signals)
   or not exists(select 1 from public.community_signal_preferences where user_id=auth.uid() and discoverable and receive_signals) then raise exception 'Participation required' using errcode='42501';end if;
  v_state:=public.web_contact_action(v_target,'request');
 else v_state:=public.web_followup_state(v_target);end if;
 return v_state||jsonb_build_object('profile_id',v_target,'can_invite',exists(select 1 from public.community_signal_preferences where user_id=p_target_user and discoverable and receive_signals) and exists(select 1 from public.community_signal_preferences where user_id=auth.uid() and discoverable and receive_signals));
end $$;


--
-- Name: community_signal_discover(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.community_signal_discover() RETURNS TABLE(user_id uuid, display_name text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    p.user_id,
    coalesce(
      nullif(left(trim(p.name), 100), ''),
      'Community member'
    )::text
  from public.community_signal_preferences c
  join public.profiles p
    on p.user_id = c.user_id
  where
    auth.uid() is not null
    and exists (
      select 1
      from public.community_signal_preferences mine
      where mine.user_id = auth.uid()
        and mine.discoverable = true
        and mine.receive_signals = true
    )
    and c.discoverable = true
    and c.receive_signals = true
    and c.user_id <> auth.uid()
  order by p.name nulls last
  limit 50;
$$;


--
-- Name: community_signal_discover_v2(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.community_signal_discover_v2() RETURNS TABLE(user_id uuid, display_name text, work_context text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 select p.user_id,coalesce(nullif(left(btrim(p.name),100),''),'Community member'),nullif(left(btrim(coalesce(to_jsonb(p)->>'bio','')),220),'')
 from public.profiles p join public.community_signal_preferences pref on pref.user_id=p.user_id
 where pref.discoverable and pref.receive_signals and p.user_id<>auth.uid()
 and exists(select 1 from public.community_signal_preferences where user_id=auth.uid() and discoverable and receive_signals)
 and not exists(select 1 from public.connections b where b.status='blocked' and
  ((b.requester_profile_id=public.current_profile_id() and b.addressee_profile_id=p.id)or(b.addressee_profile_id=public.current_profile_id() and b.requester_profile_id=p.id)))
 order by p.name nulls last limit 50;
$$;


--
-- Name: community_signal_send(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.community_signal_send(target uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  sender uuid := auth.uid();
  existing_id uuid;
  result_id uuid;
begin
  if sender is null then
    raise exception 'Authentication required';
  end if;

  if target is null or target = sender then
    raise exception 'Invalid recipient';
  end if;

  -- Serialize sends from the same member.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(sender::text, 2718)
  );

  if not exists (
    select 1
    from public.community_signal_preferences
    where user_id = sender
      and discoverable = true
      and receive_signals = true
  ) then
    raise exception 'Enable Community Signal first';
  end if;

  if not exists (
    select 1
    from public.community_signal_preferences
    where user_id = target
      and discoverable = true
      and receive_signals = true
  ) then
    raise exception 'Recipient is not participating';
  end if;

  -- Return an existing acknowledgement.
  select id into existing_id
  from public.community_signals
  where sender_id = sender
    and recipient_id = target;

  if existing_id is not null then
    return existing_id;
  end if;

  -- Limit new acknowledgements to 10 per 24 hours.
  if (
    select count(*)
    from public.community_signals
    where sender_id = sender
      and created_at >= now() - interval '24 hours'
  ) >= 10 then
    raise exception 'Daily acknowledgement limit reached';
  end if;

  insert into public.community_signals (
    sender_id,
    recipient_id
  )
  values (sender, target)
  returning id into result_id;

  return result_id;
end;
$$;


--
-- Name: compute_interaction_intelligence(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_interaction_intelligence(p_event_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_profile                 record;
  v_target                  record;
  v_score                   float;
  v_reason                  text;
  v_type                    text;
  v_count                   int     := 0;
  v_dwell                   int;
  v_confirmed_qr            boolean;
  v_intent_match            boolean;
  v_shared_events           int;
  v_is_confirmed            boolean;
  v_event_already_processed boolean;
BEGIN
  -- Capture whether re_engaged rows already exist BEFORE the DELETE so
  -- encounter_count is not double-incremented on re-runs for the same event.
  SELECT EXISTS (
    SELECT 1 FROM interaction_intelligence
    WHERE event_id = p_event_id AND type = 're_engaged'
  ) INTO v_event_already_processed;

  -- Clear previous intelligence for this event
  DELETE FROM interaction_intelligence WHERE event_id = p_event_id;

  -- For each attendee at the event
  FOR v_profile IN
    SELECT ea.profile_id, ea.intent_primary, ea.intent_secondary
    FROM event_attendees ea
    WHERE ea.event_id = p_event_id
  LOOP
    -- For each OTHER attendee
    FOR v_target IN
      SELECT ea.profile_id, ea.intent_primary, ea.intent_secondary
      FROM event_attendees ea
      WHERE ea.event_id = p_event_id
        AND ea.profile_id != v_profile.profile_id
    LOOP
      v_score  := 0;
      v_reason := '';

      -- --------------------------------------------------------
      -- Check for an existing confirmed relationship between
      -- this pair (canonical ordering: a < b lexicographically).
      -- --------------------------------------------------------
      SELECT EXISTS (
        SELECT 1 FROM relationships
        WHERE profile_a_id = LEAST(v_profile.profile_id, v_target.profile_id)
          AND profile_b_id = GREATEST(v_profile.profile_id, v_target.profile_id)
          AND status = 'confirmed'
      ) INTO v_is_confirmed;

      IF v_is_confirmed THEN
        -- Update health columns exactly once per pair per run.
        -- Guard 1: only the canonical (a→b) direction to avoid double-increment
        --          within a single run.
        -- Guard 2: skip if re_engaged rows already existed before this run
        --          (v_event_already_processed = true) to keep the function
        --          idempotent when called more than once for the same event.
        IF NOT v_event_already_processed
           AND v_profile.profile_id = LEAST(v_profile.profile_id, v_target.profile_id) THEN
          UPDATE relationships
          SET last_encounter_at = now(),
              encounter_count   = encounter_count + 1
          WHERE profile_a_id = v_profile.profile_id
            AND profile_b_id = v_target.profile_id
            AND status = 'confirmed';
        END IF;

        -- Write a re_engaged record for this direction.
        -- Both (a→b) and (b→a) rows are needed so get_my_intelligence
        -- surfaces the card for both parties.
        INSERT INTO interaction_intelligence
          (event_id, profile_id, target_profile_id, score, reason, type)
        VALUES (
          p_event_id,
          v_profile.profile_id,
          v_target.profile_id,
          100.0,
          'You have a confirmed relationship — you are both here again.',
          're_engaged'
        );

        v_count := v_count + 1;
        CONTINUE;
      END IF;

      -- --------------------------------------------------------
      -- Standard scoring for pairs with no confirmed relationship
      -- --------------------------------------------------------

      -- Aggregate interaction signals for this direction
      SELECT
        COALESCE(SUM(ie.dwell_seconds), 0),
        BOOL_OR(ie.interaction_type = 'qr_confirmed')
      INTO v_dwell, v_confirmed_qr
      FROM interaction_events ie
      WHERE ie.event_id        = p_event_id
        AND ie.from_profile_id = v_profile.profile_id
        AND ie.to_profile_id   = v_target.profile_id;

      -- Score: dwell time (max 40 pts)
      v_score := v_score + LEAST(v_dwell::float / 60.0 * 10.0, 40.0);

      -- Score: QR confirmation (30 pts)
      IF v_confirmed_qr THEN
        v_score  := v_score + 30.0;
        v_reason := v_reason || 'Confirmed connection. ';
      END IF;

      -- Score: intent alignment (30 pts)
      v_intent_match := (
        v_profile.intent_primary IS NOT NULL
        AND v_target.intent_primary IS NOT NULL
        AND (
          v_profile.intent_primary = v_target.intent_primary
          OR v_profile.intent_primary = ANY(v_target.intent_secondary)
          OR v_target.intent_primary  = ANY(v_profile.intent_secondary)
        )
      );

      IF v_intent_match THEN
        v_score  := v_score + 30.0;
        v_reason := v_reason || 'Shared intent: ' || v_target.intent_primary || '. ';
      END IF;

      -- Score: historical shared-event bonus (max +20 pts)
      -- Counts events the pair both attended before this one.
      SELECT COUNT(DISTINCT ea1.event_id)
      INTO v_shared_events
      FROM event_attendees ea1
      JOIN event_attendees ea2
        ON ea1.event_id    = ea2.event_id
       AND ea2.profile_id  = v_target.profile_id
      JOIN events e ON e.id = ea1.event_id
      WHERE ea1.profile_id = v_profile.profile_id
        AND ea1.event_id  != p_event_id
        AND e.starts_at    < (SELECT starts_at FROM events WHERE id = p_event_id);

      IF v_shared_events > 0 THEN
        v_score  := v_score + LEAST(v_shared_events * 5.0, 20.0);
        v_reason := v_reason
          || 'You''ve both attended '
          || v_shared_events
          || ' previous event'
          || CASE WHEN v_shared_events > 1 THEN 's' ELSE '' END
          || '. ';
      END IF;

      -- Clear snooze flag for this pair on new co-attendance signal
      -- (only for the canonical direction to avoid double-update)
      IF v_profile.profile_id = LEAST(v_profile.profile_id, v_target.profile_id) THEN
        UPDATE relationships
        SET snoozed_by_a = false,
            snoozed_by_b = false
        WHERE profile_a_id = v_profile.profile_id
          AND profile_b_id = v_target.profile_id
          AND status       = 'proposed'
          AND (snoozed_by_a OR snoozed_by_b);
      END IF;

      -- Determine intelligence type
      IF v_score >= 50 THEN
        v_type   := 'recommended';
        v_reason := v_reason || 'Strong match.';
      ELSIF v_dwell > 0 AND v_score < 30 THEN
        v_type   := 'follow_up';
        v_reason := v_reason || 'Brief interaction — notable signal.';
      ELSIF v_intent_match AND v_dwell = 0 THEN
        v_type   := 'missed';
        v_reason := v_reason || 'Aligned intent but no interaction recorded.';
      ELSE
        CONTINUE; -- skip low-signal pairs
      END IF;

      INSERT INTO interaction_intelligence
        (event_id, profile_id, target_profile_id, score, reason, type)
      VALUES (
        p_event_id,
        v_profile.profile_id,
        v_target.profile_id,
        v_score,
        v_reason,
        v_type
      );

      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;


--
-- Name: confirm_relationship(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_relationship(p_other_profile_id uuid, p_source_event_id uuid, p_source_intel_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_current_id        uuid;
  v_a_id              uuid;
  v_b_id              uuid;
  v_row               relationships%ROWTYPE;
  v_first_encounter   timestamptz;
BEGIN
  v_current_id := current_profile_id();
  IF v_current_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_current_id = p_other_profile_id THEN
    RAISE EXCEPTION 'Cannot confirm a relationship with yourself';
  END IF;

  -- Canonical pair ordering (lexicographic UUID sort)
  v_a_id := LEAST(v_current_id, p_other_profile_id);
  v_b_id := GREATEST(v_current_id, p_other_profile_id);

  -- Check for an existing row
  SELECT * INTO v_row
  FROM relationships
  WHERE profile_a_id = v_a_id
    AND profile_b_id = v_b_id;

  IF FOUND THEN
    -- Already confirmed — idempotent return
    IF v_row.status = 'confirmed' THEN
      RETURN jsonb_build_object(
        'relationship_id',   v_row.id,
        'status',            v_row.status,
        'first_encounter_at', v_row.first_encounter_at,
        'confirmed_at',      v_row.confirmed_at
      );
    END IF;

    -- Second confirmer: the other party proposed first (proposed_by_id is set
    -- and is not the current user). proposed_by_id IS NULL means the row was
    -- created by snooze_relationship() — that path is handled by the ELSIF
    -- below, not here, to prevent unilateral confirmation.
    IF v_row.proposed_by_id IS NOT NULL
       AND v_row.proposed_by_id IS DISTINCT FROM v_current_id THEN
      UPDATE relationships
      SET status       = 'confirmed',
          confirmed_at = now(),
          snoozed_by_a = CASE WHEN profile_a_id = v_current_id THEN false ELSE snoozed_by_a END,
          snoozed_by_b = CASE WHEN profile_b_id = v_current_id THEN false ELSE snoozed_by_b END
      WHERE id = v_row.id
      RETURNING * INTO v_row;

      RETURN jsonb_build_object(
        'relationship_id',    v_row.id,
        'status',             v_row.status,
        'first_encounter_at', v_row.first_encounter_at,
        'confirmed_at',       v_row.confirmed_at
      );

    -- First confirmer on a snooze-only row (proposed_by_id IS NULL).
    -- Set the current user as proposer; keep status = 'proposed' until
    -- the other party also confirms.
    ELSIF v_row.proposed_by_id IS NULL THEN
      UPDATE relationships
      SET proposed_by_id = v_current_id,
          source_event_id = p_source_event_id,
          source_intelligence_id = COALESCE(p_source_intel_id, source_intelligence_id),
          snoozed_by_a = CASE WHEN profile_a_id = v_current_id THEN false ELSE snoozed_by_a END,
          snoozed_by_b = CASE WHEN profile_b_id = v_current_id THEN false ELSE snoozed_by_b END
      WHERE id = v_row.id
      RETURNING * INTO v_row;

      RETURN jsonb_build_object(
        'relationship_id',    v_row.id,
        'status',             v_row.status,
        'first_encounter_at', v_row.first_encounter_at,
        'confirmed_at',       v_row.confirmed_at
      );

    -- Proposed by the current user already — idempotent, clear any snooze
    ELSE
      UPDATE relationships
      SET snoozed_by_a = CASE WHEN profile_a_id = v_current_id THEN false ELSE snoozed_by_a END,
          snoozed_by_b = CASE WHEN profile_b_id = v_current_id THEN false ELSE snoozed_by_b END
      WHERE id = v_row.id
      RETURNING * INTO v_row;

      RETURN jsonb_build_object(
        'relationship_id',    v_row.id,
        'status',             v_row.status,
        'first_encounter_at', v_row.first_encounter_at,
        'confirmed_at',       v_row.confirmed_at
      );
    END IF;
  END IF;

  -- No existing row — first confirmation. Compute first_encounter_at.
  -- Prefer the earliest interaction_events signal between the pair.
  SELECT MIN(ie.created_at)
  INTO v_first_encounter
  FROM interaction_events ie
  WHERE (ie.from_profile_id = v_current_id AND ie.to_profile_id = p_other_profile_id)
     OR (ie.from_profile_id = p_other_profile_id AND ie.to_profile_id = v_current_id);

  -- Fall back to earliest shared event attendance if no direct signal
  IF v_first_encounter IS NULL THEN
    SELECT MIN(e.starts_at)
    INTO v_first_encounter
    FROM event_attendees ea1
    JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
    JOIN events e ON e.id = ea1.event_id
    WHERE ea1.profile_id = v_current_id
      AND ea2.profile_id = p_other_profile_id;
  END IF;

  -- Last resort: use now()
  IF v_first_encounter IS NULL THEN
    v_first_encounter := now();
  END IF;

  INSERT INTO relationships (
    profile_a_id,
    profile_b_id,
    status,
    proposed_by_id,
    source_event_id,
    source_intelligence_id,
    first_encounter_at,
    encounter_count
  ) VALUES (
    v_a_id,
    v_b_id,
    'proposed',
    v_current_id,
    p_source_event_id,
    p_source_intel_id,
    v_first_encounter,
    1
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'relationship_id',    v_row.id,
    'status',             v_row.status,
    'first_encounter_at', v_row.first_encounter_at,
    'confirmed_at',       v_row.confirmed_at
  );
END;
$$;


--
-- Name: contact_details_action(uuid, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contact_details_action(p_other uuid, p_action text, p_fields text[] DEFAULT '{}'::text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id();v_pref public.contact_preferences_private;v_details jsonb:='{}';v_field text;v_value text;
begin
 if v_me is null or v_me=p_other then raise exception 'Invalid person' using errcode='42501';end if;
 if p_action not in('revoke','ignore') and not public.web_can_message(p_other) then raise exception 'Connect on Nearify first' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(least(v_me,p_other)::text||greatest(v_me,p_other)::text,0));
 if p_action not in('revoke','ignore') and not public.web_can_message(p_other) then raise exception 'Connect on Nearify first' using errcode='42501';end if;
 if p_action='request' then
  insert into public.contact_detail_requests(requester_id,owner_id) values(v_me,p_other)
  on conflict(requester_id,owner_id) do update set status='pending',created_at=case when public.contact_detail_requests.status='pending' then public.contact_detail_requests.created_at else now() end;
 elsif p_action='ignore' then
  update public.contact_detail_requests set status='ignored' where requester_id=p_other and owner_id=v_me;
 elsif p_action='revoke' then
  update public.contact_disclosures set details='{}',revoked_at=now() where owner_id=v_me and recipient_id=p_other;
 elsif p_action='share' then
  select * into v_pref from public.contact_preferences_private where profile_id=v_me;
  if coalesce(cardinality(p_fields),0)=0 then raise exception 'Choose at least one contact detail';end if;
  foreach v_field in array p_fields loop
   v_value:=case v_field when 'email' then case when v_pref.allow_email then v_pref.email end when 'phone' then case when v_pref.allow_phone then v_pref.phone end when 'linkedin' then v_pref.linkedin when 'website' then v_pref.website else null end;
   if v_value is null or v_field is null then raise exception 'Selected contact detail is unavailable';end if;
   v_details:=v_details||jsonb_build_object(v_field,v_value);
  end loop;
  v_details:=v_details||jsonb_build_object('preferred',v_pref.preferred);
  insert into public.contact_disclosures(owner_id,recipient_id,details) values(v_me,p_other,v_details)
  on conflict(owner_id,recipient_id) do update set details=excluded.details,source='explicit',shared_at=now(),revoked_at=null;
  update public.contact_detail_requests set status='fulfilled' where requester_id=p_other and owner_id=v_me;
 else raise exception 'Invalid action';end if;
 return public.web_followup_state(p_other);
end $$;


--
-- Name: contact_owner_preferences(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contact_owner_preferences() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id();v_result jsonb;
begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 select to_jsonb(p)-'profile_id'-'updated_at' into v_result from public.contact_preferences_private p where profile_id=v_me;
 return coalesce(v_result,jsonb_build_object('allow_email',false,'allow_phone',false,'preferred','nearify'));
end $$;


--
-- Name: contact_save_preferences(text, text, text, text, boolean, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contact_save_preferences(p_email text, p_phone text, p_linkedin text, p_website text, p_allow_email boolean, p_allow_phone boolean, p_preferred text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id();begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if greatest(length(coalesce(p_email,'')),length(coalesce(p_phone,'')),length(coalesce(p_linkedin,'')),length(coalesce(p_website,'')))>2000 or coalesce(p_preferred,'nearify') not in('nearify','email','phone','linkedin') then raise exception 'Invalid contact preferences';end if;
 insert into public.contact_preferences_private(profile_id,email,phone,linkedin,website,allow_email,allow_phone,preferred)
 values(v_me,nullif(btrim(p_email),''),nullif(btrim(p_phone),''),nullif(btrim(p_linkedin),''),nullif(btrim(p_website),''),coalesce(p_allow_email,false),coalesce(p_allow_phone,false),coalesce(p_preferred,'nearify'))
 on conflict(profile_id) do update set email=excluded.email,phone=excluded.phone,linkedin=excluded.linkedin,website=excluded.website,allow_email=excluded.allow_email,allow_phone=excluded.allow_phone,preferred=excluded.preferred,updated_at=now();
 return public.contact_owner_preferences();
end $$;


--
-- Name: create_ghost_participant(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_ghost_participant(p_event_id uuid, p_display_name text DEFAULT NULL::text) RETURNS TABLE(ghost_id uuid, ghost_token text, event_id uuid, display_name text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ghost_id uuid;
  v_ghost_token text;
begin
  if not exists (
    select 1
    from public.events e
    where e.id = p_event_id
      and e.deleted_at is null
      and coalesce(e.is_active, true) = true
  ) then
    raise exception 'Event not available';
  end if;

  v_ghost_id := gen_random_uuid();
  v_ghost_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.ghost_participants (
    id,
    event_id,
    ghost_token,
    display_name
  )
  values (
    v_ghost_id,
    p_event_id,
    v_ghost_token,
    nullif(trim(p_display_name), '')
  );

  return query
  select
    gp.id,
    gp.ghost_token,
    gp.event_id,
    gp.display_name
  from public.ghost_participants gp
  where gp.id = v_ghost_id;
end;
$$;


--
-- Name: current_profile_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_profile_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select id
  from public.profiles
  where user_id = auth.uid()
  limit 1;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text,
    email text,
    avatar_url text,
    bio text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    skills text[] DEFAULT '{}'::text[],
    interests text[] DEFAULT '{}'::text[],
    intent_primary text,
    public_email text,
    public_phone text,
    linkedin_url text,
    website_url text,
    share_email boolean DEFAULT false,
    share_phone boolean DEFAULT false,
    preferred_contact_method text
);


--
-- Name: ensure_profile(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_profile(p_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_avatar_url text DEFAULT NULL::text) RETURNS public.profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_profile public.profiles;
begin
  select *
  into v_profile
  from public.profiles
  where user_id = auth.uid();

  if v_profile.id is not null then
    return v_profile;
  end if;

  insert into public.profiles (user_id, name, email, avatar_url)
  values (auth.uid(), p_name, p_email, p_avatar_url)
  returning * into v_profile;

  return v_profile;
end;
$$;


--
-- Name: get_consented_event_attendees(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_consented_event_attendees(p_event_id uuid) RETURNS TABLE(profile_id uuid, name text, avatar_url text, intent_primary text, intent_secondary text, interests text[], skills text[])
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: get_event_connection_people(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_event_connection_people(p_event uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id();v_people jsonb;begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.name nulls last,t.profile_id),'[]'::jsonb) into v_people from(
  select r.profile_id,r.name,r.avatar_url,r.intent_primary,r.intent_secondary,r.interests,r.skills from public.get_consented_event_attendees(p_event) r
  where r.profile_id<>v_me
   and not exists(select 1 from public.ambient_person_feedback f where f.owner_id=v_me and f.person_id=r.profile_id)
   and not exists(select 1 from public.connections b where b.status='blocked' and
    ((b.requester_profile_id=v_me and b.addressee_profile_id=r.profile_id)or(b.requester_profile_id=r.profile_id and b.addressee_profile_id=v_me)))
  order by r.name nulls last,r.profile_id
 )t;return v_people;
end $$;


--
-- Name: get_event_context(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_event_context(p_event_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_profile_id uuid;
  v_result jsonb;
begin
  v_profile_id := public.current_profile_id();

  if v_profile_id is null then
    raise exception 'No profile found for current user';
  end if;

  select jsonb_build_object(
    'event_id', ea.event_id,
    'profile_id', ea.profile_id,
    'intent_primary', ea.intent_primary,
    'intent_secondary', ea.intent_secondary,
    'goals', ea.goals,
    'constraints', ea.constraints,
    'energy_level', ea.energy_level,
    'joined_at', ea.joined_at
  )
  into v_result
  from public.event_attendees ea
  where ea.event_id = p_event_id
    and ea.profile_id = v_profile_id;

  if v_result is null then
    raise exception 'Not attending this event';
  end if;

  return v_result;
end;
$$;


--
-- Name: get_event_preparation_people(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_event_preparation_people(p_event uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: get_ghost_connection_history(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_ghost_connection_history(p_ghost_id uuid, p_ghost_token text, p_event_id uuid DEFAULT NULL::uuid) RETURNS TABLE(interaction_id uuid, event_id uuid, to_profile_id uuid, to_profile_name text, connected_at timestamp with time zone, claimed_by_profile_id uuid, claimed_profile_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_ghost record;
BEGIN
  SELECT gp.id, gp.claimed_by_profile_id
  INTO v_ghost
  FROM public.ghost_participants gp
  WHERE gp.id = p_ghost_id
    AND gp.ghost_token = p_ghost_token
    AND (p_event_id IS NULL OR gp.event_id = p_event_id)
  LIMIT 1;

  IF v_ghost.id IS NULL THEN
    RAISE EXCEPTION 'Ghost session not found';
  END IF;

  RETURN QUERY
  SELECT
    ie.id                           AS interaction_id,
    ie.event_id,
    ie.to_profile_id,
    COALESCE(p.name, 'Attendee')    AS to_profile_name,
    ie.created_at                   AS connected_at,
    ie.claimed_by_profile_id,
    v_ghost.claimed_by_profile_id   AS claimed_profile_id
  FROM public.interaction_events ie
  LEFT JOIN public.profiles p ON p.id = ie.to_profile_id
  WHERE ie.from_ghost_id = p_ghost_id
    AND (p_event_id IS NULL OR ie.event_id = p_event_id)
    -- Include ghost_connect (written by record_ghost_connection) and
    -- qr_confirmed (written by QR scan flow) — previously only qr_confirmed
    -- was included, which caused the claim success names list to be empty.
    AND ie.interaction_type IN ('ghost_connect', 'qr_confirmed')
  ORDER BY ie.created_at DESC
  LIMIT 50;
END;
$$;


--
-- Name: get_meetup_activity_hourly(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_meetup_activity_hourly(p_hours integer DEFAULT 168) RETURNS TABLE(hour_bucket timestamp with time zone, funnel_stage text, cnt bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select
    date_trunc('hour', ae.created_at) as hour_bucket,
    ae.event_name                     as funnel_stage,
    count(*)                          as cnt
  from public.analytics_events ae
  where
    ae.event_name in (
      'meetup_handoff_view',
      'enter_live_network_clicked',
      'testflight_clicked',
      'guest_session_created',
      'app_deep_link_clicked'
    )
    and ae.created_at >= now() - (p_hours || ' hours')::interval
  group by
    date_trunc('hour', ae.created_at),
    ae.event_name
  order by hour_bucket asc;
$$;


--
-- Name: get_meetup_funnel(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_meetup_funnel(p_since timestamp with time zone DEFAULT (now() - '30 days'::interval)) RETURNS TABLE(event_id uuid, event_title text, source_event_id text, funnel_stage text, cnt bigint, latest_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select
    ae.event_id,
    e.name                                    as event_title,
    ae.properties->>'source_event_id'         as source_event_id,
    ae.event_name                             as funnel_stage,
    count(*)                                  as cnt,
    max(ae.created_at)                        as latest_at
  from public.analytics_events ae
  left join public.events e on e.id = ae.event_id
  where
    ae.event_name in (
      'meetup_handoff_view',
      'enter_live_network_clicked',
      'testflight_clicked',
      'guest_session_created',
      'app_deep_link_clicked'
    )
    and ae.created_at >= p_since
  group by
    ae.event_id,
    e.name,
    ae.properties->>'source_event_id',
    ae.event_name
  order by max(ae.created_at) desc;
$$;


--
-- Name: get_my_claimed_guest_connections(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_claimed_guest_connections() RETURNS TABLE(connection_id uuid, event_id uuid, event_name text, guest_name text, target_profile_id uuid, connected_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select gc.id, gc.event_id, e.name::text,
         coalesce(nullif(gp.display_name, ''), 'Guest')::text,
         gp.claimed_by_profile_id, gc.created_at
  from public.ghost_guest_connections gc
  join public.ghost_participants owner_gp on owner_gp.id = gc.from_ghost_id
  join public.ghost_participants gp on gp.id = gc.to_ghost_id
  join public.events e on e.id = gc.event_id
  join public.profiles p on p.id = owner_gp.claimed_by_profile_id
  where p.user_id = auth.uid()
  order by gc.created_at desc
  limit 500;
$$;


--
-- Name: get_my_connections(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_connections(p_status text DEFAULT 'confirmed'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_caller_id uuid;
BEGIN
  SELECT id INTO v_caller_id
  FROM profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_caller_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE(
    (
      WITH

      -- Source A: formal relationship rows (from confirm_relationship RPC).
      -- One row per person by definition (unique index on profile_a/b pair).
      rel_rows AS (
        SELECT
          r.id                                               AS relationship_id,
          r.status,
          CASE
            WHEN r.status = 'confirmed'         THEN 'confirmed'
            WHEN r.proposed_by_id = v_caller_id THEN 'proposed_by_me'
            WHEN r.proposed_by_id IS NOT NULL   THEN 'proposed_by_them'
            ELSE 'proposed'
          END                                               AS relationship_label,
          CASE
            WHEN r.profile_a_id = v_caller_id THEN r.profile_b_id
            ELSE r.profile_a_id
          END                                               AS other_profile_id,
          r.encounter_count,
          r.first_encounter_at,
          r.last_encounter_at,
          r.confirmed_at,
          r.source_event_id,
          r.created_at
        FROM relationships r
        WHERE (r.profile_a_id = v_caller_id OR r.profile_b_id = v_caller_id)
          AND (p_status = 'all' OR r.status = p_status)
      ),

      -- Source B: ghost interactions claimed by this user.
      -- Grouped by to_profile_id ONLY (not event_id) so each person appears
      -- exactly once regardless of how many events they were connected at.
      -- source_event_id = the earliest event (first connection point).
      ghost_rows AS (
        SELECT
          NULL::uuid                                        AS relationship_id,
          'ghost_claimed'                                   AS status,
          'ghost_claimed'                                   AS relationship_label,
          ie.to_profile_id                                  AS other_profile_id,
          COUNT(DISTINCT ie.event_id)::int                  AS encounter_count,
          MIN(ie.created_at)                                AS first_encounter_at,
          MAX(ie.created_at)                                AS last_encounter_at,
          NULL::timestamptz                                 AS confirmed_at,
          -- Pick event_id from the earliest interaction row for this person
          (
            SELECT ie2.event_id
            FROM interaction_events ie2
            WHERE ie2.claimed_by_profile_id = v_caller_id
              AND ie2.to_profile_id = ie.to_profile_id
              AND ie2.from_ghost_id IS NOT NULL
            ORDER BY ie2.created_at ASC
            LIMIT 1
          )                                                 AS source_event_id,
          MIN(ie.created_at)                                AS created_at
        FROM interaction_events ie
        WHERE ie.claimed_by_profile_id = v_caller_id
          AND ie.from_ghost_id IS NOT NULL
          AND ie.to_profile_id IS NOT NULL
          AND ie.to_profile_id NOT IN (SELECT other_profile_id FROM rel_rows)
          AND p_status IN ('confirmed', 'all')
        GROUP BY ie.to_profile_id
      ),

      all_rows AS (
        SELECT * FROM rel_rows
        UNION ALL
        SELECT * FROM ghost_rows
      )

      SELECT jsonb_agg(row_to_json(t) ORDER BY t.last_encounter_at DESC NULLS LAST, t.created_at DESC)
      FROM (
        SELECT
          ar.relationship_id,
          ar.status,
          ar.relationship_label,
          p.id                                              AS profile_id,
          p.name,
          p.avatar_url,
          ar.encounter_count,
          ar.first_encounter_at,
          ar.last_encounter_at,
          ar.confirmed_at,
          e.name                                            AS first_encounter_event_name,
          ar.source_event_id,
          ar.created_at
        FROM all_rows ar
        JOIN profiles p ON p.id = ar.other_profile_id
        LEFT JOIN events e ON e.id = ar.source_event_id
      ) t
    ),
    '[]'::jsonb
  );
END;
$$;


--
-- Name: get_my_event_discovery_preference(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_event_discovery_preference(p_event_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select coalesce((
    select edp.discoverable
    from public.event_discovery_preferences edp
    join public.profiles p on p.id = edp.profile_id
    where edp.event_id = p_event_id and p.user_id = (select auth.uid())
  ), false);
$$;


--
-- Name: get_my_guest_share_code(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_guest_share_code(p_event_id uuid, p_ghost_id uuid, p_ghost_token text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_code text;
begin
  if not exists (
    select 1 from public.ghost_participants gp
    where gp.id = p_ghost_id and gp.event_id = p_event_id
      and gp.ghost_token = p_ghost_token
      and gp.claimed_by_profile_id is null
  ) then raise exception 'Guest session not found' using errcode = 'P0001'; end if;
  insert into public.ghost_share_codes(ghost_id, share_code)
  values (p_ghost_id, replace(pg_catalog.gen_random_uuid()::text, '-', '') || replace(pg_catalog.gen_random_uuid()::text, '-', ''))
  on conflict (ghost_id) do nothing;
  select sc.share_code into v_code from public.ghost_share_codes sc
  where sc.ghost_id = p_ghost_id;
  return v_code;
end;
$$;


--
-- Name: get_my_guest_to_guest_connections(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_guest_to_guest_connections(p_event_id uuid, p_ghost_id uuid, p_ghost_token text) RETURNS TABLE(connection_id uuid, guest_name text, connected_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from public.ghost_participants gp
    where gp.id = p_ghost_id and gp.event_id = p_event_id
      and gp.ghost_token = p_ghost_token
  ) then raise exception 'Guest session not found' using errcode = 'P0001'; end if;
  return query
    select gc.id, coalesce(nullif(gp.display_name, ''), 'Guest')::text, gc.created_at
    from public.ghost_guest_connections gc
    join public.ghost_participants gp on gp.id = gc.to_ghost_id
    where gc.from_ghost_id = p_ghost_id and gc.event_id = p_event_id
    order by gc.created_at desc limit 50;
end;
$$;


--
-- Name: get_my_intelligence(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_intelligence(p_event_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_profile_id uuid;
  v_my_intent  text;
BEGIN
  v_profile_id := current_profile_id();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'No profile found for current user';
  END IF;

  -- Resolve caller's intent at this event once, outside the per-row query.
  SELECT intent_primary INTO v_my_intent
  FROM event_attendees
  WHERE event_id = p_event_id AND profile_id = v_profile_id;

  RETURN (
    SELECT jsonb_agg(row_to_json(final))
    FROM (
      SELECT
        deduped.target_profile_id,
        deduped.target_name,
        deduped.target_avatar,
        deduped.score,
        deduped.reason,
        deduped.type,
        deduped.direction,
        deduped.created_at,
        v_my_intent                      AS my_intent,
        deduped.their_intent,
        deduped.dwell_seconds,
        COALESCE(rel.encounter_count, 0) AS encounter_count,
        e_first.name                     AS first_encounter_event_name,
        CASE
          WHEN deduped.type = 're_engaged'         THEN 're_engaged'
          WHEN rel.status IS NULL                  THEN NULL
          WHEN rel.status = 'confirmed'            THEN 'confirmed'
          WHEN rel.proposed_by_id = v_profile_id   THEN 'proposed_by_me'
          ELSE                                          'proposed_by_them'
        END AS relationship_status
      FROM (
        SELECT DISTINCT ON (other_id)
          other_id       AS target_profile_id,
          other_name     AS target_name,
          other_avatar   AS target_avatar,
          score,
          reason,
          type,
          direction,
          created_at,
          their_intent,
          dwell_seconds
        FROM (
          -- Rows where current user is the source (You → them)
          SELECT
            ii.target_profile_id  AS other_id,
            p.name                AS other_name,
            p.avatar_url          AS other_avatar,
            ii.score,
            ii.reason,
            ii.type,
            'outgoing'::text      AS direction,
            ii.created_at,
            ea_t.intent_primary   AS their_intent,
            (
              SELECT COALESCE(SUM(ie.dwell_seconds), 0)
              FROM interaction_events ie
              WHERE ie.event_id        = p_event_id
                AND ie.from_profile_id = v_profile_id
                AND ie.to_profile_id   = ii.target_profile_id
            )                     AS dwell_seconds
          FROM interaction_intelligence ii
          JOIN profiles p ON p.id = ii.target_profile_id
          LEFT JOIN event_attendees ea_t
            ON ea_t.event_id   = p_event_id
           AND ea_t.profile_id = ii.target_profile_id
          WHERE ii.event_id   = p_event_id
            AND ii.profile_id = v_profile_id

          UNION ALL

          -- Rows where current user is the target (Them → you)
          SELECT
            ii.profile_id         AS other_id,
            p.name                AS other_name,
            p.avatar_url          AS other_avatar,
            ii.score,
            ii.reason,
            ii.type,
            'incoming'::text      AS direction,
            ii.created_at,
            ea_t.intent_primary   AS their_intent,
            (
              SELECT COALESCE(SUM(ie.dwell_seconds), 0)
              FROM interaction_events ie
              WHERE ie.event_id        = p_event_id
                AND ie.from_profile_id = ii.profile_id
                AND ie.to_profile_id   = v_profile_id
            )                     AS dwell_seconds
          FROM interaction_intelligence ii
          JOIN profiles p ON p.id = ii.profile_id
          LEFT JOIN event_attendees ea_t
            ON ea_t.event_id   = p_event_id
           AND ea_t.profile_id = ii.profile_id
          WHERE ii.event_id          = p_event_id
            AND ii.target_profile_id = v_profile_id
        ) combined
        ORDER BY other_id, score DESC
      ) deduped
      LEFT JOIN relationships rel
        ON rel.profile_a_id = LEAST(v_profile_id, deduped.target_profile_id)
       AND rel.profile_b_id = GREATEST(v_profile_id, deduped.target_profile_id)
      LEFT JOIN events e_first ON e_first.id = rel.source_event_id
      ORDER BY deduped.score DESC
    ) final
  );
END;
$$;


--
-- Name: get_organizer_event_insights(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_organizer_event_insights(p_event_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: get_public_event_attendees(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_event_attendees(p_event_id uuid) RETURNS TABLE(profile_id uuid, name text, avatar_url text, intent_primary text, status text, relationship_status text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_current_id     uuid;
  v_is_attending   boolean;
BEGIN
  v_current_id := current_profile_id();  -- NULL if unauthenticated

  -- Co-attendee gate: an authenticated caller who is NOT an attendee of this
  -- event receives no rows. Unauthenticated callers are not gated here (they
  -- are already limited to photo-less rows by the CASE below and only reach
  -- this function from a specific event's guest join flow).
  IF v_current_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM event_attendees
      WHERE event_id = p_event_id
        AND profile_id = v_current_id
    ) INTO v_is_attending;

    IF NOT v_is_attending THEN
      RETURN;  -- no rows
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    ea.profile_id,
    p.name,
    CASE WHEN v_current_id IS NULL THEN NULL ELSE p.avatar_url END::text AS avatar_url,
    ea.intent_primary,
    NULL::text AS status,
    CASE
      WHEN v_current_id IS NULL                        THEN NULL
      WHEN ea.profile_id = v_current_id                THEN NULL
      WHEN rel.status IS NULL                          THEN NULL
      WHEN rel.status = 'confirmed'                    THEN 'confirmed'
      WHEN rel.proposed_by_id = v_current_id           THEN 'proposed_by_me'
      ELSE                                                  'proposed_by_them'
    END::text AS relationship_status
  FROM event_attendees ea
  JOIN profiles p ON p.id = ea.profile_id
  LEFT JOIN relationships rel
    ON rel.profile_a_id = LEAST(v_current_id, ea.profile_id)
   AND rel.profile_b_id = GREATEST(v_current_id, ea.profile_id)
   AND v_current_id IS NOT NULL
   AND ea.profile_id != v_current_id
  WHERE ea.event_id      = p_event_id
    AND ea.profile_id IS NOT NULL
  LIMIT 200;
END;
$$;


--
-- Name: get_public_profile_brief(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_profile_brief(p_profile_id uuid) RETURNS TABLE(id uuid, name text, avatar_url text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  select
    p.id,
    p.name,
    p.avatar_url
  from public.profiles p
  where p.id = p_profile_id
  limit 1;
end;
$$;


--
-- Name: get_relationship_context(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_relationship_context(p_other_profile_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_current_id           uuid;
  v_a_id                 uuid;
  v_b_id                 uuid;
  v_row                  relationships%ROWTYPE;
  v_status               text;
  v_encounter_count      int := 0;
  v_first_encounter_at   timestamptz;
  v_first_event_name     text;
  v_last_encounter_at    timestamptz;
  v_last_event_name      text;
  v_shared_intent        text;
  -- Ghost-claim fallback variables
  v_ghost_count          int := 0;
  v_ghost_first_at       timestamptz;
  v_ghost_last_at        timestamptz;
BEGIN
  v_current_id := current_profile_id();  -- NULL if unauthenticated

  IF v_current_id IS NULL THEN
    RETURN jsonb_build_object(
      'relationship_status',        NULL,
      'relationship_id',            NULL,
      'first_encounter_at',         NULL,
      'first_encounter_event_name', NULL,
      'last_encounter_at',          NULL,
      'last_encounter_event_name',  NULL,
      'encounter_count',            0,
      'shared_intent',              NULL
    );
  END IF;

  -- Compute encounter history from event_attendees (authenticated co-attendance)
  SELECT
    COUNT(DISTINCT ea1.event_id),
    MIN(e.starts_at),
    MAX(e.starts_at)
  INTO
    v_encounter_count,
    v_first_encounter_at,
    v_last_encounter_at
  FROM event_attendees ea1
  JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
  JOIN events e ON e.id = ea1.event_id
  WHERE ea1.profile_id = v_current_id
    AND ea2.profile_id = p_other_profile_id;

  -- Most frequent shared intent (caller's intent across shared events)
  SELECT ea1.intent_primary
  INTO v_shared_intent
  FROM event_attendees ea1
  JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
  WHERE ea1.profile_id = v_current_id
    AND ea2.profile_id = p_other_profile_id
    AND ea1.intent_primary IS NOT NULL
  GROUP BY ea1.intent_primary
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  -- Event names for first and last encounter (event_attendees path)
  IF v_first_encounter_at IS NOT NULL THEN
    SELECT e.name INTO v_first_event_name
    FROM event_attendees ea1
    JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
    JOIN events e ON e.id = ea1.event_id
    WHERE ea1.profile_id = v_current_id
      AND ea2.profile_id = p_other_profile_id
      AND e.starts_at = v_first_encounter_at
    LIMIT 1;

    SELECT e.name INTO v_last_event_name
    FROM event_attendees ea1
    JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
    JOIN events e ON e.id = ea1.event_id
    WHERE ea1.profile_id = v_current_id
      AND ea2.profile_id = p_other_profile_id
      AND e.starts_at = v_last_encounter_at
    LIMIT 1;
  END IF;

  v_a_id := LEAST(v_current_id, p_other_profile_id);
  v_b_id := GREATEST(v_current_id, p_other_profile_id);

  SELECT * INTO v_row
  FROM relationships
  WHERE profile_a_id = v_a_id
    AND profile_b_id = v_b_id;

  IF NOT FOUND THEN
    -- No formal relationship row. Check for ghost-claimed interactions.
    -- This covers users who claimed a ghost session but haven't confirmed
    -- a relationship via confirm_relationship() yet.
    SELECT
      COUNT(DISTINCT ie.event_id),
      MIN(ie.created_at),
      MAX(ie.created_at)
    INTO
      v_ghost_count,
      v_ghost_first_at,
      v_ghost_last_at
    FROM interaction_events ie
    WHERE ie.claimed_by_profile_id = v_current_id
      AND ie.to_profile_id = p_other_profile_id
      AND ie.interaction_type IN ('ghost_connect', 'qr_confirmed');

    IF v_ghost_count > 0 THEN
      v_status := 'ghost_claimed';
      -- Supplement encounter data from interaction_events when event_attendees
      -- has no shared records (ghost users were not in event_attendees).
      IF v_encounter_count = 0 THEN
        v_encounter_count   := v_ghost_count;
        v_first_encounter_at := v_ghost_first_at;
        v_last_encounter_at  := v_ghost_last_at;

        SELECT e.name INTO v_first_event_name
        FROM interaction_events ie
        JOIN events e ON e.id = ie.event_id
        WHERE ie.claimed_by_profile_id = v_current_id
          AND ie.to_profile_id = p_other_profile_id
          AND ie.created_at = v_ghost_first_at
        LIMIT 1;

        IF v_ghost_last_at IS DISTINCT FROM v_ghost_first_at THEN
          SELECT e.name INTO v_last_event_name
          FROM interaction_events ie
          JOIN events e ON e.id = ie.event_id
          WHERE ie.claimed_by_profile_id = v_current_id
            AND ie.to_profile_id = p_other_profile_id
            AND ie.created_at = v_ghost_last_at
          LIMIT 1;
        END IF;
      END IF;
    ELSE
      v_status := NULL;
    END IF;

  ELSIF v_row.status = 'confirmed' THEN
    v_encounter_count    := GREATEST(v_row.encounter_count, v_encounter_count);
    v_last_encounter_at  := GREATEST(v_row.last_encounter_at, v_last_encounter_at);
    v_status             := 'confirmed';
  ELSIF v_row.proposed_by_id IS NULL THEN
    v_status := NULL;
  ELSIF v_row.proposed_by_id = v_current_id THEN
    v_status := 'proposed_by_me';
  ELSE
    v_status := 'proposed_by_them';
  END IF;

  RETURN jsonb_build_object(
    'relationship_status',        v_status,
    'relationship_id',            v_row.id,
    'first_encounter_at',         COALESCE(v_row.first_encounter_at, v_first_encounter_at),
    'first_encounter_event_name', v_first_event_name,
    'last_encounter_at',          COALESCE(v_row.last_encounter_at, v_last_encounter_at),
    'last_encounter_event_name',  v_last_event_name,
    'encounter_count',            v_encounter_count,
    'shared_intent',              v_shared_intent
  );
END;
$$;


--
-- Name: get_relationship_event_history(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_relationship_event_history(p_other_profile_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
with caller as (
  select p.id as profile_id from public.profiles p where p.user_id=auth.uid() limit 1
), evidence as (
  select ea1.event_id,'co_attended'::text as source,null::timestamptz as saved_at,
         false as saved_by_you,false as saved_you
  from public.event_attendees ea1
  join public.event_attendees ea2 on ea1.event_id=ea2.event_id
  join caller c on c.profile_id=ea1.profile_id
  where ea2.profile_id=p_other_profile_id and c.profile_id<>p_other_profile_id
  union all
  select q.event_id,'account_qr',q.saved_at,q.from_profile_id=c.profile_id,q.to_profile_id=c.profile_id
  from public.account_qr_saves q cross join caller c
  where (q.from_profile_id=c.profile_id and q.to_profile_id=p_other_profile_id)
     or (q.to_profile_id=c.profile_id and q.from_profile_id=p_other_profile_id)
  union all
  select gc.event_id,'guest_save',gc.created_at,false,false
  from public.ghost_guest_connections gc
  join public.ghost_participants owner_gp on owner_gp.id=gc.from_ghost_id
  join public.ghost_participants target_gp on target_gp.id=gc.to_ghost_id
  cross join caller c
  where (owner_gp.claimed_by_profile_id=c.profile_id and target_gp.claimed_by_profile_id=p_other_profile_id)
     or (target_gp.claimed_by_profile_id=c.profile_id and owner_gp.claimed_by_profile_id=p_other_profile_id)
  union all
  -- Claimed guest-to-member saves are evidence too, not just guest-to-guest saves.
  select ie.event_id,'guest_save',ie.created_at,false,false
  from public.interaction_events ie
  join public.ghost_participants gp on gp.id=ie.from_ghost_id
  cross join caller c
  where ie.interaction_type in ('ghost_connect','qr_confirmed')
    and ((coalesce(ie.claimed_by_profile_id,gp.claimed_by_profile_id)=c.profile_id and ie.to_profile_id=p_other_profile_id)
      or (coalesce(ie.claimed_by_profile_id,gp.claimed_by_profile_id)=p_other_profile_id and ie.to_profile_id=c.profile_id))
), distinct_events as (
  select event_id,bool_or(source='co_attended') as shared_attendance_record,
         bool_or(source='guest_save') as has_guest_save,
         bool_or(source='account_qr') as has_account_qr,
         bool_or(saved_by_you) as saved_by_you,bool_or(saved_you) as saved_you,
         max(saved_at) filter (where source='account_qr') as qr_saved_at,
         max(saved_at) filter (where source='guest_save') as guest_saved_at
  from evidence group by event_id
)
select coalesce(jsonb_agg(jsonb_build_object(
  'event_id',e.id,'event_name',e.name,'event_at',e.starts_at,
  'recovered_guest_connection',d.has_guest_save,'shared_attendance_record',d.shared_attendance_record,
  'qr_saved',d.has_account_qr,'qr_saved_by_you',d.saved_by_you,'qr_saved_you',d.saved_you,
  'qr_saved_at',d.qr_saved_at,'guest_saved_at',d.guest_saved_at
) order by e.starts_at desc nulls last,e.id),'[]'::jsonb)
from distinct_events d join public.events e on e.id=d.event_id;
$$;


--
-- Name: get_saved_people(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_saved_people() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id();v_result jsonb;begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.saved_at desc),'[]'::jsonb) into v_result from(
  select p.id as profile_id,p.name,to_jsonb(p)->>'avatar_url' as avatar_url,max(s.saved_at) as saved_at,public.web_can_message(p.id) as messaging_approved
  from (select person_id,saved_at from public.person_saves where owner_id=v_me
   union all select to_profile_id,saved_at from public.account_qr_saves where from_profile_id=v_me
   union all select case when requester_profile_id=v_me then addressee_profile_id else requester_profile_id end,coalesce(updated_at,created_at)
   from public.connections where status='accepted' and v_me in(requester_profile_id,addressee_profile_id)) s
  join public.profiles p on p.id=s.person_id
  where not exists(select 1 from public.connections b where b.status='blocked' and
   ((b.requester_profile_id=v_me and b.addressee_profile_id=p.id)or(b.addressee_profile_id=v_me and b.requester_profile_id=p.id)))
  group by p.id order by max(s.saved_at) desc limit 100
 ) t;return v_result;
end $$;


--
-- Name: guard_connection_approval(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_connection_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id();begin
 if auth.uid() is null then
  if current_setting('role',true) in('anon','authenticated') then raise exception 'Sign in required' using errcode='42501';end if;
  return new;
 end if; -- trusted SQL/service maintenance
 if v_me is null or v_me not in(new.requester_profile_id,new.addressee_profile_id) then raise exception 'Connection unavailable' using errcode='42501';end if;
 if tg_op='UPDATE' and (new.requester_profile_id<>old.requester_profile_id or new.addressee_profile_id<>old.addressee_profile_id) then raise exception 'Connection identity is immutable';end if;
 if new.status='blocked' then
  update public.contact_disclosures set details='{}',revoked_at=now() where owner_id=v_me and recipient_id=case when v_me=new.requester_profile_id then new.addressee_profile_id else new.requester_profile_id end;
  update public.contact_detail_requests set status='ignored' where(requester_id=new.requester_profile_id and owner_id=new.addressee_profile_id)or(requester_id=new.addressee_profile_id and owner_id=new.requester_profile_id);
 end if;
 if new.status='accepted' then
  if tg_op='INSERT' then raise exception 'Recipient approval required' using errcode='42501';end if;
  if old.status<>'accepted' and (old.status<>'pending' or v_me<>old.addressee_profile_id) then raise exception 'Recipient approval required' using errcode='42501';end if;
 end if;
 return new;
end $$;


--
-- Name: guard_manual_unmatch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_manual_unmatch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.manually_unmatched_at IS NOT NULL
     AND NEW.matched_event_id   IS NOT NULL
     AND NEW.manually_unmatched_at IS NOT NULL
  THEN
    -- External writer tried to re-match a manually-unmatched row.
    -- Reset the incoming matched_event_id to preserve the override.
    NEW.matched_event_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: guard_signal_block(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_signal_block() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_sender uuid;v_recipient uuid;begin
 if auth.uid() is null then
  if current_setting('role',true) in('anon','authenticated') then raise exception 'Sign in required' using errcode='42501';end if;
  return new;
 end if;
 if new.sender_id<>auth.uid() then raise exception 'Invalid sender' using errcode='42501';end if;
 select id into v_sender from public.profiles where user_id=new.sender_id limit 1;
 select id into v_recipient from public.profiles where user_id=new.recipient_id limit 1;
 if exists(select 1 from public.connections where status='blocked' and((requester_profile_id=v_sender and addressee_profile_id=v_recipient)or(requester_profile_id=v_recipient and addressee_profile_id=v_sender))) then raise exception 'Acknowledgement unavailable' using errcode='42501';end if;
 return new;
end $$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins WHERE user_id = auth.uid()
  );
$$;


--
-- Name: issue_event_gatt_token(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.issue_event_gatt_token(p_event_id uuid) RETURNS TABLE(token text, issued_at timestamp with time zone, expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_profile uuid;
  v_now timestamptz := clock_timestamp();
  v_token text;
begin
  if auth.uid() is null or p_event_id is null then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  select p.id into v_profile from public.profiles p where p.user_id = auth.uid();
  if v_profile is null or not exists (
    select 1 from public.event_attendees ea
    where ea.profile_id = v_profile and ea.event_id = p_event_id
      and ea.status = 'joined' and ea.last_seen_at >= v_now - interval '5 minutes'
  ) then
    raise exception 'active check-in required' using errcode = '28000';
  end if;
  -- Serialize rotation per attendee/event; prevents two concurrent valid leases.
  perform pg_advisory_xact_lock(hashtextextended(v_profile::text || ':' || p_event_id::text, 0));
  -- Minimum issuance interval prevents trivial high-rate token cycling.
  if exists (
    select 1 from public.event_gatt_tokens t
    where t.profile_id = v_profile and t.event_id = p_event_id
      and t.issued_at > v_now - interval '10 seconds'
  ) then
    raise exception 'retry later' using errcode = 'P0001';
  end if;
  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  delete from public.event_gatt_tokens t
    where t.profile_id = v_profile and t.event_id = p_event_id;
  insert into public.event_gatt_tokens(profile_id,event_id,token_hash,issued_at,expires_at)
    values (v_profile,p_event_id,extensions.digest(v_token,'sha256'),v_now,v_now + interval '5 minutes');
  return query select v_token, v_now, v_now + interval '5 minutes';
end;
$$;


--
-- Name: event_attendees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_attendees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    status text DEFAULT 'joined'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    intent_primary text,
    intent_secondary text[] DEFAULT '{}'::text[],
    goals jsonb DEFAULT '{}'::jsonb,
    constraints jsonb DEFAULT '{}'::jsonb,
    energy_level integer,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT event_attendees_status_check CHECK ((status = ANY (ARRAY['joined'::text, 'left'::text])))
);


--
-- Name: join_event(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.join_event(p_event_id uuid) RETURNS public.event_attendees
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_profile public.profiles;
  v_attendee public.event_attendees;
begin
  select *
  into v_profile
  from public.profiles
  where user_id = auth.uid();

  if v_profile.id is null then
    raise exception 'Profile does not exist for current user';
  end if;

  insert into public.event_attendees (
    event_id,
    profile_id,
    status,
    joined_at,
    last_seen_at
  )
  values (
    p_event_id,
    v_profile.id,
    'joined',
    now(),
    now()
  )
  on conflict (event_id, profile_id)
  do update set
    status = 'joined',
    last_seen_at = now()
  returning * into v_attendee;

  return v_attendee;
end;
$$;


--
-- Name: leave_event(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.leave_event(p_event_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_profile_id uuid;
  v_updated    int;
BEGIN
  v_profile_id := current_profile_id();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE event_attendees
  SET status       = 'left',
      last_seen_at = now()
  WHERE event_id   = p_event_id
    AND profile_id = v_profile_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'removed',  v_updated > 0,
    'status',   'left'
  );
END;
$$;


--
-- Name: link_external_event(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_external_event(p_ext_id uuid, p_nearify_event_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE external_events
     SET matched_event_id      = p_nearify_event_id,
         manually_unmatched_at = NULL,
         manually_unmatched_by = NULL,
         updated_at            = now()
   WHERE id = p_ext_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'external_event not found: %', p_ext_id;
  END IF;
END;
$$;


--
-- Name: notify_send_message_push(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_send_message_push() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
    supabase_url text;
    webhook_secret text;
    request_id bigint;
BEGIN
    SELECT value INTO supabase_url FROM public.app_private_config WHERE key = 'supabase_url';
    SELECT value INTO webhook_secret FROM public.app_private_config WHERE key = 'message_push_webhook_secret';

    IF supabase_url IS NULL OR length(trim(supabase_url)) = 0
       OR webhook_secret IS NULL OR length(trim(webhook_secret)) = 0 THEN
        INSERT INTO public.push_delivery_log(message_id, conversation_id, sender_id, stage, apns_reason)
        VALUES (NEW.id, NEW.conversation_id, NEW.sender_profile_id, 'skipped', 'missing_config');
        RETURN NEW;
    END IF;

    SELECT net.http_post(
        url := rtrim(supabase_url, '/') || '/functions/v1/send-message-push',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-nearify-webhook-secret', webhook_secret
        ),
        body := jsonb_build_object(
            'type', 'INSERT', 'schema', TG_TABLE_SCHEMA, 'table', TG_TABLE_NAME,
            'record', jsonb_build_object(
                'id', NEW.id, 'conversation_id', NEW.conversation_id,
                'sender_profile_id', NEW.sender_profile_id, 'sender_id', NEW.sender_profile_id,
                'content', NEW.content, 'body', NEW.content, 'created_at', NEW.created_at
            )
        ),
        timeout_milliseconds := 5000
    ) INTO request_id;

    INSERT INTO public.push_delivery_log(message_id, conversation_id, sender_id, stage, request_id)
    VALUES (NEW.id, NEW.conversation_id, NEW.sender_profile_id, 'enqueued', request_id);

    RETURN NEW;
END;
$$;


--
-- Name: prune_contact_disclosures(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_contact_disclosures() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 update public.contact_disclosures set details=details-array_remove(array[
  case when not new.allow_email or new.email is null then 'email' end,
  case when not new.allow_phone or new.phone is null then 'phone' end,
  case when new.linkedin is null then 'linkedin' end,
  case when new.website is null then 'website' end],null)
 where owner_id=new.profile_id and revoked_at is null;
 update public.contact_disclosures set details='{}',revoked_at=now() where owner_id=new.profile_id and revoked_at is null and not(details ?| array['email','phone','linkedin','website']);
 return new;
end $$;


--
-- Name: record_ghost_connection(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_ghost_connection(p_event_id uuid, p_ghost_token text, p_target_profile_id uuid) RETURNS TABLE(interaction_id uuid, ghost_id uuid, target_profile_id uuid, event_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_ghost_id uuid;
begin
  select gp.id
  into v_ghost_id
  from public.ghost_participants gp
  where gp.event_id = p_event_id
    and gp.ghost_token = p_ghost_token
  limit 1;

  if v_ghost_id is null then
    raise exception 'Ghost participant not found';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_target_profile_id
  ) then
    raise exception 'Target profile not found';
  end if;

  if exists (
    select 1
    from public.interaction_events ie
    where ie.event_id = p_event_id
      and ie.from_ghost_id = v_ghost_id
      and ie.to_profile_id = p_target_profile_id
      and ie.interaction_type = 'qr_confirmed'
  ) then
    raise exception 'Connection already exists';
  end if;

  insert into public.interaction_events (
    event_id,
    from_ghost_id,
    to_profile_id,
    interaction_type,
    strength,
    created_at
  )
  values (
    p_event_id,
    v_ghost_id,
    p_target_profile_id,
    'qr_confirmed',
    100,
    now()
  )
  returning
    id,
    from_ghost_id,
    to_profile_id,
    interaction_events.event_id
  into
    interaction_id,
    ghost_id,
    target_profile_id,
    event_id;

  return next;
end;
$$;


--
-- Name: register_push_installation(text, uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_push_installation(p_token text, p_install_id uuid, p_install_secret text, p_environment text, p_app_version text DEFAULT NULL::text, p_device_name text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_me uuid;v_hash text;v_existing public.device_tokens;
begin
 select id into v_me from public.profiles where user_id=(select auth.uid());
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_install_id is null or p_install_secret is null or p_install_secret !~ '^[0-9a-f]{64}$'
  or p_token is null or length(p_token) not between 32 and 512 or p_token !~ '^[0-9a-fA-F]+$'
  or p_environment is null or p_environment not in ('development','production') then
  raise exception 'Invalid push registration' using errcode='22023';end if;
 p_token:=lower(p_token);
 v_hash:=encode(sha256(convert_to(p_install_secret,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_install_id::text,0));
 select * into v_existing from public.device_tokens where token=p_token for update;
 if found and v_existing.profile_id is distinct from v_me then
  if v_existing.registration_secret_hash is distinct from v_hash
   or lower(v_existing.app_install_id) is distinct from p_install_id::text
   or v_existing.environment is distinct from p_environment then
   raise exception 'Push registration needs recovery on this installation' using errcode='42501';
  end if;
 end if;
 -- The exact token can move only from the caller's own row or with the
 -- installation's secret. No capability is derived from an install UUID alone.
 insert into public.device_tokens(profile_id,user_id,token,platform,environment,app_version,device_name,app_install_id,
  updated_at,last_seen_at,is_active,registration_secret_hash)
 values(v_me,auth.uid(),p_token,'ios',p_environment,p_app_version,p_device_name,p_install_id::text,
  now(),now(),true,v_hash)
 on conflict(token) do update set profile_id=excluded.profile_id,user_id=excluded.user_id,
  platform=excluded.platform,environment=excluded.environment,app_version=excluded.app_version,device_name=excluded.device_name,
  app_install_id=excluded.app_install_id,updated_at=now(),last_seen_at=now(),is_active=true,
  registration_secret_hash=excluded.registration_secret_hash
 -- A concurrent first registration from another installation must not steal it.
 where device_tokens.profile_id=v_me or
  (device_tokens.registration_secret_hash=v_hash and lower(device_tokens.app_install_id)=p_install_id::text
   and device_tokens.environment=p_environment);
 if not found then raise exception 'Push registration needs recovery on this installation' using errcode='42501';end if;

 update public.device_tokens set is_active=false,updated_at=now()
 where platform='ios' and environment=p_environment
  and lower(app_install_id)=p_install_id::text and token<>p_token
  and (profile_id=v_me or registration_secret_hash=v_hash);
end $_$;


--
-- Name: release_push_installation(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_push_installation(p_install_id uuid, p_install_secret text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_me uuid;v_hash text;begin
 select id into v_me from public.profiles where user_id=(select auth.uid());
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_install_id is null or p_install_secret is null or p_install_secret !~ '^[0-9a-f]{64}$' then
  raise exception 'Invalid push installation' using errcode='22023';end if;
 v_hash:=encode(sha256(convert_to(p_install_secret,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_install_id::text,0));
 update public.device_tokens set is_active=false,updated_at=now(),registration_secret_hash=v_hash
 where profile_id=v_me and lower(app_install_id)=p_install_id::text and platform='ios'
  and (registration_secret_hash=v_hash or registration_secret_hash is null);
end $_$;


--
-- Name: resolve_event_gatt_token(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_event_gatt_token(p_event_id uuid, p_token text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_requester uuid;
  v_peer uuid;
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if auth.uid() is null or p_event_id is null or p_token is null
     or length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid request' using errcode = '22023';
  end if;
  select p.id into v_requester from public.profiles p where p.user_id = auth.uid();
  if v_requester is null or not exists (
    select 1 from public.event_attendees ea
    where ea.profile_id = v_requester and ea.event_id = p_event_id
      and ea.status = 'joined' and ea.last_seen_at >= v_now - interval '5 minutes'
  ) then
    raise exception 'active check-in required' using errcode = '28000';
  end if;
  -- Transactional per-user limiter: 30 resolutions/minute, including misses.
  insert into public.event_gatt_resolve_limits(user_id,window_start,requests)
    values (auth.uid(),v_now,1)
    on conflict (user_id) do update
      set window_start = case
            when public.event_gatt_resolve_limits.window_start < v_now - interval '1 minute'
              then v_now else public.event_gatt_resolve_limits.window_start end,
          requests = case
            when public.event_gatt_resolve_limits.window_start < v_now - interval '1 minute'
              then 1 else public.event_gatt_resolve_limits.requests + 1 end
    returning requests into v_count;
  if v_count > 30 then
    return null; -- Do not raise: an exception rolls back the limiter increment.
  end if;
  select t.profile_id into v_peer
    from public.event_gatt_tokens t
    join public.event_attendees ea
      on ea.event_id = t.event_id and ea.profile_id = t.profile_id
    where t.event_id = p_event_id and t.token_hash = extensions.digest(p_token,'sha256')
      and t.expires_at > v_now and t.profile_id <> v_requester
      and ea.status = 'joined' and ea.last_seen_at >= v_now - interval '5 minutes';
  return v_peer; -- NULL for unknown/expired/other-event/self token.
end;
$_$;


--
-- Name: revoke_event_gatt_token_on_attendance_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_event_gatt_token_on_attendance_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if tg_op = 'DELETE' then
    delete from public.event_gatt_tokens t
      where t.profile_id = old.profile_id and t.event_id = old.event_id;
    return old;
  end if;
  if new.status <> 'joined' then
    delete from public.event_gatt_tokens t
      where t.profile_id = new.profile_id and t.event_id = new.event_id;
  end if;
  return new;
end;
$$;


--
-- Name: revoke_my_event_gatt_tokens(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_my_event_gatt_tokens(p_event_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized'
      USING errcode = '28000';
  END IF;

  DELETE FROM public.event_gatt_tokens t
  USING public.profiles p
  WHERE p.id = t.profile_id
    AND p.user_id = auth.uid()
    AND (
      p_event_id IS NULL
      OR t.event_id = p_event_id
    );
END;
$$;


--
-- Name: save_account_qr_connection(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_account_qr_connection(p_event_id uuid, p_target_profile_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_caller uuid;
  v_relationship jsonb;
begin
  select p.id into v_caller from public.profiles p where p.user_id=auth.uid() limit 1;
  if v_caller is null then raise exception 'Authenticated Nearify profile required'; end if;
  if v_caller=p_target_profile_id then raise exception 'Cannot save your own QR'; end if;
  if not exists (select 1 from public.events e where e.id=p_event_id
      and e.deleted_at is null and coalesce(e.is_active,true)) then
    raise exception 'Event unavailable';
  end if;
  if not exists (select 1 from public.profiles p where p.id=p_target_profile_id) then
    raise exception 'Target profile unavailable';
  end if;

  -- A function call is one transaction: relationship and event evidence succeed together.
  v_relationship := public.confirm_relationship(p_target_profile_id,p_event_id,null);
  if v_relationship is null or coalesce(v_relationship->>'status','') not in ('proposed','confirmed') then
    raise exception 'Relationship save failed';
  end if;
  insert into public.account_qr_saves(from_profile_id,to_profile_id,event_id)
  values (v_caller,p_target_profile_id,p_event_id)
  on conflict (from_profile_id,to_profile_id,event_id) do nothing;
  return v_relationship || jsonb_build_object('event_saved',true,'event_id',p_event_id);
end;
$$;


--
-- Name: save_guest_to_guest_connection(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_guest_to_guest_connection(p_event_id uuid, p_from_ghost_id uuid, p_from_ghost_token text, p_target_share_code text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_target_id uuid;
begin
  if not exists (
    select 1 from public.ghost_participants gp
    where gp.id = p_from_ghost_id and gp.event_id = p_event_id
      and gp.ghost_token = p_from_ghost_token
      and gp.claimed_by_profile_id is null
  ) then raise exception 'Guest session not found' using errcode = 'P0001'; end if;

  select gp.id into v_target_id
  from public.ghost_share_codes sc
  join public.ghost_participants gp on gp.id = sc.ghost_id
  where sc.share_code = p_target_share_code and gp.event_id = p_event_id
    and gp.claimed_by_profile_id is null;
  if v_target_id is null or v_target_id = p_from_ghost_id then
    raise exception 'Guest QR unavailable for this event' using errcode = 'P0001';
  end if;

  insert into public.ghost_guest_connections(event_id, from_ghost_id, to_ghost_id)
  values (p_event_id, p_from_ghost_id, v_target_id)
  on conflict (from_ghost_id, to_ghost_id) do nothing;
  return true;
end;
$$;


--
-- Name: save_nearify_person(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_nearify_person(p_other uuid, p_event uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id();begin
 if v_me is null or v_me=p_other then raise exception 'Invalid person' using errcode='42501';end if;
 if not exists(select 1 from public.profiles where id=p_other) then raise exception 'Person unavailable';end if;
 if exists(select 1 from public.connections where status='blocked' and ((requester_profile_id=v_me and addressee_profile_id=p_other)or(requester_profile_id=p_other and addressee_profile_id=v_me))) then raise exception 'Person unavailable' using errcode='42501';end if;
 if p_event is not null then perform public.save_account_qr_connection(p_event,p_other);end if;
 insert into public.person_saves(owner_id,person_id) values(v_me,p_other) on conflict do nothing;
 return jsonb_build_object('saved',true,'can_message',public.web_can_message(p_other));
end $$;


--
-- Name: set_app_private_config_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_app_private_config_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: set_conversation_reads_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_conversation_reads_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        NEW.last_read_at = GREATEST(OLD.last_read_at, NEW.last_read_at);
    END IF;

    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: set_ghost_email(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_ghost_email(p_ghost_id uuid, p_ghost_token text, p_email text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  update public.ghost_participants
  set
    email              = p_email,
    email_captured_at  = now()
  where
    id           = p_ghost_id
    and ghost_token = p_ghost_token
    and claimed_by_profile_id is null; -- don't overwrite if already claimed
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: snooze_relationship(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.snooze_relationship(p_other_profile_id uuid, p_source_event_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_current_id       uuid;
  v_a_id             uuid;
  v_b_id             uuid;
  v_row              relationships%ROWTYPE;
  v_first_encounter  timestamptz;
BEGIN
  v_current_id := current_profile_id();
  IF v_current_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_current_id = p_other_profile_id THEN
    RAISE EXCEPTION 'Cannot snooze a relationship with yourself';
  END IF;

  v_a_id := LEAST(v_current_id, p_other_profile_id);
  v_b_id := GREATEST(v_current_id, p_other_profile_id);

  -- If a proposed row already exists, set the caller's snooze flag.
  -- Confirmed relationships are not snoozeable: compute_interaction_intelligence()
  -- only clears snooze flags on proposed rows, so a snooze on a confirmed row
  -- would persist indefinitely.
  UPDATE relationships
  SET snoozed_by_a = CASE WHEN profile_a_id = v_current_id THEN true ELSE snoozed_by_a END,
      snoozed_by_b = CASE WHEN profile_b_id = v_current_id THEN true ELSE snoozed_by_b END
  WHERE profile_a_id = v_a_id
    AND profile_b_id = v_b_id
    AND status = 'proposed';

  IF FOUND THEN
    RETURN;
  END IF;

  -- No row yet — insert a proposed row with this party's snooze flag set
  SELECT MIN(ie.created_at)
  INTO v_first_encounter
  FROM interaction_events ie
  WHERE (ie.from_profile_id = v_current_id AND ie.to_profile_id = p_other_profile_id)
     OR (ie.from_profile_id = p_other_profile_id AND ie.to_profile_id = v_current_id);

  IF v_first_encounter IS NULL THEN
    SELECT MIN(e.starts_at)
    INTO v_first_encounter
    FROM event_attendees ea1
    JOIN event_attendees ea2 ON ea1.event_id = ea2.event_id
    JOIN events e ON e.id = ea1.event_id
    WHERE ea1.profile_id = v_current_id
      AND ea2.profile_id = p_other_profile_id;
  END IF;

  IF v_first_encounter IS NULL THEN
    v_first_encounter := now();
  END IF;

  INSERT INTO relationships (
    profile_a_id,
    profile_b_id,
    status,
    proposed_by_id,
    source_event_id,
    first_encounter_at,
    encounter_count,
    snoozed_by_a,
    snoozed_by_b
  ) VALUES (
    v_a_id,
    v_b_id,
    'proposed',
    NULL,                      -- no confirmation yet; just a snooze
    p_source_event_id,
    v_first_encounter,
    1,
    (v_a_id = v_current_id),   -- snooze the caller's slot
    (v_b_id = v_current_id)
  );
END;
$$;


--
-- Name: unmatch_external_event(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unmatch_external_event(p_ext_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE external_events
     SET matched_event_id      = NULL,
         manually_unmatched_at = now(),
         manually_unmatched_by = auth.uid(),
         updated_at            = now()
   WHERE id = p_ext_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'external_event not found: %', p_ext_id;
  END IF;
END;
$$;


--
-- Name: update_attendee_intent(uuid, text, text[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_attendee_intent(p_event_id uuid, p_intent_primary text, p_intent_secondary text[] DEFAULT '{}'::text[], p_energy_level integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_profile_id uuid;
  v_result jsonb;
begin
  v_profile_id := public.current_profile_id();

  if v_profile_id is null then
    raise exception 'No profile found for current user';
  end if;

  update public.event_attendees
  set
    intent_primary   = p_intent_primary,
    intent_secondary = p_intent_secondary,
    energy_level     = p_energy_level,
    updated_at       = now()
  where event_id = p_event_id
    and profile_id = v_profile_id
  returning jsonb_build_object(
    'profile_id', profile_id,
    'event_id', event_id,
    'intent_primary', intent_primary,
    'intent_secondary', intent_secondary,
    'energy_level', energy_level
  )
  into v_result;

  if v_result is null then
    raise exception 'Attendee record not found — join the event first';
  end if;

  return v_result;
end;
$$;


--
-- Name: web_can_message(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.web_can_message(p_other uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 select coalesce(p_other<>public.current_profile_id() and exists (
  select 1 from public.connections c
  where ((c.requester_profile_id=public.current_profile_id() and c.addressee_profile_id=p_other)
      or (c.addressee_profile_id=public.current_profile_id() and c.requester_profile_id=p_other)) and c.status='accepted'
 ) and not exists (
  select 1 from public.connections c
  where ((c.requester_profile_id=public.current_profile_id() and c.addressee_profile_id=p_other)
      or (c.addressee_profile_id=public.current_profile_id() and c.requester_profile_id=p_other)) and c.status='blocked'
 ),false);
$$;


--
-- Name: web_can_send_to_conversation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.web_can_send_to_conversation(p_conversation uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 select coalesce((select public.web_can_message(case when c.participant_a=public.current_profile_id() then c.participant_b else c.participant_a end)
 from public.conversations c where c.id=p_conversation and public.current_profile_id() in (c.participant_a,c.participant_b)),false);
$$;


--
-- Name: web_contact_action(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.web_contact_action(p_other uuid, p_action text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id(); v_state jsonb;
begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if v_me=p_other or not exists(select 1 from public.profiles where id=p_other) then raise exception 'Invalid person'; end if;
 perform pg_advisory_xact_lock(hashtextextended(least(v_me,p_other)::text||greatest(v_me,p_other)::text,0));
 v_state:=public.web_followup_state(p_other);
 if p_action='unblock' then
  update public.connections set status='ignored',updated_at=now() where requester_profile_id=v_me and addressee_profile_id=p_other and status='blocked';
  return public.web_followup_state(p_other);
 end if;
 if v_state->>'status'='blocked' then raise exception 'Contact exchange unavailable' using errcode='42501'; end if;
 if p_action='request' then
  if v_state->>'status' not in ('accepted','pending','incoming') then
   -- Reuse an ignored/suggested row when possible; event context is deliberately
   -- NULL: a contact request is not evidence of attendance at a particular event.
   if exists(select 1 from public.connections where requester_profile_id=v_me and addressee_profile_id=p_other) then
    update public.connections set status='pending',updated_at=now()
    where id=(select id from public.connections where requester_profile_id=v_me and addressee_profile_id=p_other order by updated_at desc nulls last,id limit 1);
   else
    insert into public.connections(requester_profile_id,addressee_profile_id,event_id,status) values(v_me,p_other,null,'pending');
   end if;
  end if;
 elsif p_action in ('approve','ignore') then
  update public.connections set status=case when p_action='approve' then 'accepted' else 'ignored' end,updated_at=now()
  where requester_profile_id=p_other and addressee_profile_id=v_me and status='pending';
 elsif p_action='block' then
  update public.connections set status='blocked',updated_at=now()
  where requester_profile_id=v_me and addressee_profile_id=p_other;
  if not found then insert into public.connections(requester_profile_id,addressee_profile_id,event_id,status) values(v_me,p_other,null,'blocked'); end if;
 else raise exception 'Invalid action'; end if;
 return public.web_followup_state(p_other);
end; $$;


--
-- Name: web_followup_state(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.web_followup_state(p_other uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id();v_status text:='none';v_conversation uuid;v_contact jsonb;v_own jsonb;v_own_block boolean;v_connected boolean;
begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_other=v_me then return jsonb_build_object('status','self','can_message',false,'permission_version',2);end if;
 if not exists(select 1 from public.profiles where id=p_other) then raise exception 'Person unavailable';end if;
 v_connected:=public.web_can_message(p_other);
 if exists(select 1 from public.connections where status='blocked' and ((requester_profile_id=v_me and addressee_profile_id=p_other) or(requester_profile_id=p_other and addressee_profile_id=v_me))) then v_status:='blocked';
 elsif v_connected then v_status:='accepted';
 elsif exists(select 1 from public.connections where requester_profile_id=p_other and addressee_profile_id=v_me and status='pending') then v_status:='incoming';
 elsif exists(select 1 from public.connections where requester_profile_id=v_me and addressee_profile_id=p_other and status='pending') then v_status:='pending';end if;
 select id into v_conversation from public.conversations where(participant_a=v_me and participant_b=p_other)or(participant_a=p_other and participant_b=v_me) order by created_at,id limit 1;
 if v_connected then
  select d.details||jsonb_build_object('name',p.name) into v_contact from public.contact_disclosures d join public.profiles p on p.id=d.owner_id where d.owner_id=p_other and d.recipient_id=v_me and d.revoked_at is null;
 end if;
 select d.details into v_own from public.contact_disclosures d where d.owner_id=v_me and d.recipient_id=p_other and d.revoked_at is null;
 select exists(select 1 from public.connections where requester_profile_id=v_me and addressee_profile_id=p_other and status='blocked') into v_own_block;
 return jsonb_build_object('permission_version',2,'status',v_status,'can_message',v_connected,'conversation_id',v_conversation,'contact',v_contact,'shared_by_you',coalesce(v_own,'{}'::jsonb),'blocked_by_you',v_own_block,
  'detail_request_incoming',v_connected and exists(select 1 from public.contact_detail_requests where requester_id=p_other and owner_id=v_me and status='pending'),
  'detail_request_pending',v_connected and exists(select 1 from public.contact_detail_requests where requester_id=v_me and owner_id=p_other and status='pending'));
end $$;


--
-- Name: web_inbox(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.web_inbox() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id();v_result jsonb;v_requests jsonb;begin
 v_result:=public.web_inbox_connection_only();
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_requests from(
  select r.requester_id as profile_id,p.name from public.contact_detail_requests r join public.profiles p on p.id=r.requester_id
  where r.owner_id=v_me and r.status='pending' and public.web_can_message(r.requester_id) order by r.created_at desc limit 100
 ) t;
 return v_result||jsonb_build_object('permission_version',2,'detail_requests',v_requests);
end $$;


--
-- Name: web_inbox_badge(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.web_inbox_badge() RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 select (select count(*) from jsonb_array_elements(data->'threads') t where (t->>'unread')::boolean)::integer
  +jsonb_array_length(data->'requests')+jsonb_array_length(data->'detail_requests') from(select public.web_inbox() as data) inbox;
$$;


--
-- Name: web_inbox_connection_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.web_inbox_connection_only() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id(); v_threads jsonb; v_requests jsonb;
begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.latest_at desc nulls last),'[]'::jsonb) into v_threads from (
  select c.id,other.id as profile_id,other.name,
   coalesce(latest.created_at,c.created_at) as latest_at,latest.content as preview,
   (latest.sender_profile_id<>v_me and latest.created_at>coalesce(r.last_read_at,'-infinity'::timestamptz)) as unread
  from public.conversations c
  join public.profiles other on other.id=case when c.participant_a=v_me then c.participant_b else c.participant_a end
  left join lateral(select m.content,m.created_at,m.sender_profile_id from public.messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1) latest on true
  left join public.conversation_reads r on r.conversation_id=c.id and r.profile_id=v_me
  where v_me in (c.participant_a,c.participant_b)
  order by coalesce(latest.created_at,c.created_at) desc nulls last limit 100
 ) t;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_requests from (
  select distinct p.id as profile_id,p.name from public.connections c join public.profiles p on p.id=c.requester_profile_id
  where c.addressee_profile_id=v_me and c.status='pending' and not exists(
   select 1 from public.connections b where b.status='blocked' and
   ((b.requester_profile_id=v_me and b.addressee_profile_id=p.id) or (b.requester_profile_id=p.id and b.addressee_profile_id=v_me))) limit 100
 ) t;
 return jsonb_build_object('threads',v_threads,'requests',v_requests);
end; $$;


--
-- Name: web_is_conversation_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.web_is_conversation_member(p_conversation uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 select exists(select 1 from public.conversations c where c.id=p_conversation
 and public.current_profile_id() in (c.participant_a,c.participant_b));
$$;


--
-- Name: web_mark_read(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.web_mark_read(p_conversation uuid, p_message uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id(); v_at timestamptz;
begin
 if not public.web_is_conversation_member(p_conversation) then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 select created_at into v_at from public.messages where conversation_id=p_conversation and id=p_message;
 if v_at is null then raise exception 'Message unavailable'; end if;
 insert into public.conversation_reads(conversation_id,profile_id,last_read_at) values(p_conversation,v_me,v_at)
 on conflict(conversation_id,profile_id) do update set last_read_at=greatest(public.conversation_reads.last_read_at,excluded.last_read_at),updated_at=now();
end; $$;


--
-- Name: web_open_conversation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.web_open_conversation(p_other uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id(); v_id uuid;
begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(least(v_me,p_other)::text||greatest(v_me,p_other)::text,0));
 if not public.web_can_message(p_other) then raise exception 'Approved contact exchange required' using errcode='42501'; end if;
 select id into v_id from public.conversations where (participant_a=v_me and participant_b=p_other) or (participant_a=p_other and participant_b=v_me) order by created_at,id limit 1;
 if v_id is null then
  insert into public.conversations(participant_a,participant_b) values(v_me,p_other) returning id into v_id;
 end if;
 return v_id;
end; $$;


--
-- Name: web_send_message(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.web_send_message(p_conversation uuid, p_content text, p_message_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id(); v_row public.messages; v_other uuid;
begin
 if not public.web_is_conversation_member(p_conversation) then raise exception 'Approved contact exchange required' using errcode='42501'; end if;
 select case when participant_a=v_me then participant_b else participant_a end into v_other from public.conversations where id=p_conversation;
 perform pg_advisory_xact_lock(hashtextextended(least(v_me,v_other)::text||greatest(v_me,v_other)::text,0));
 if not public.web_can_send_to_conversation(p_conversation) then raise exception 'Approved contact exchange required' using errcode='42501'; end if;
 if p_message_id is null or p_content is null or length(btrim(p_content)) not between 1 and 4000 or p_content !~ '[^[:space:]]' then raise exception 'Message must contain 1–4000 characters'; end if;
 insert into public.messages(id,conversation_id,sender_profile_id,content) values(p_message_id,p_conversation,v_me,btrim(p_content))
 on conflict(id) do nothing returning * into v_row;
 if v_row.id is null then
  select * into v_row from public.messages where id=p_message_id and conversation_id=p_conversation and sender_profile_id=v_me and content=btrim(p_content);
  if v_row.id is null then raise exception 'Message identifier unavailable'; end if;
 end if;
 return to_jsonb(v_row);
end; $$;


--
-- Name: web_thread(uuid, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.web_thread(p_conversation uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_me uuid:=public.current_profile_id(); v_other uuid; v_rows jsonb;
begin
 if not public.web_is_conversation_member(p_conversation) then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 select case when participant_a=v_me then participant_b else participant_a end into v_other from public.conversations where id=p_conversation;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at,t.id),'[]'::jsonb) into v_rows from (
  select id,sender_profile_id,content,created_at from public.messages where conversation_id=p_conversation
   and (p_before is null or (created_at,id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by created_at desc,id desc limit 50
 ) t;
 return jsonb_build_object('profile_id',v_other,'name',(select name from public.profiles where id=v_other),'my_profile_id',v_me,
  'can_message',public.web_can_message(v_other),'blocked_by_you',(public.web_followup_state(v_other)->'blocked_by_you'),'messages',v_rows);
end; $$;


--
-- Name: account_qr_saves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_qr_saves (
    from_profile_id uuid NOT NULL,
    to_profile_id uuid NOT NULL,
    event_id uuid NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_qr_saves_not_self CHECK ((from_profile_id <> to_profile_id))
);


--
-- Name: admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admins (
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    note text
);

ALTER TABLE ONLY public.admins FORCE ROW LEVEL SECURITY;


--
-- Name: ambient_event_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ambient_event_reviews (
    owner_id uuid NOT NULL,
    event_id uuid NOT NULL,
    session_started_at timestamp with time zone,
    finished_at timestamp with time zone DEFAULT now() NOT NULL,
    dismissed boolean DEFAULT false NOT NULL,
    snoozed_until timestamp with time zone
);


--
-- Name: ambient_person_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ambient_person_feedback (
    owner_id uuid NOT NULL,
    person_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ambient_person_feedback_check CHECK ((owner_id <> person_id))
);


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_name text NOT NULL,
    page text,
    referrer text,
    event_id uuid,
    profile_id uuid,
    properties jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_private_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_private_config (
    key text NOT NULL,
    value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_private_config_key_not_blank CHECK ((length(TRIM(BOTH FROM key)) > 0)),
    CONSTRAINT app_private_config_value_not_blank CHECK ((length(TRIM(BOTH FROM value)) > 0))
);


--
-- Name: TABLE app_private_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_private_config IS 'Private server-side app configuration read by SECURITY DEFINER database functions only.';


--
-- Name: COLUMN app_private_config.key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.app_private_config.key IS 'Configuration key, for example supabase_url or message_push_webhook_secret.';


--
-- Name: COLUMN app_private_config.value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.app_private_config.value IS 'Sensitive or server-side configuration value; direct client access is revoked.';


--
-- Name: community_signal_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_signal_preferences (
    user_id uuid NOT NULL,
    discoverable boolean DEFAULT false NOT NULL,
    receive_signals boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: community_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sender_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_signals_no_self CHECK ((sender_id <> recipient_id))
);


--
-- Name: connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requester_profile_id uuid NOT NULL,
    addressee_profile_id uuid NOT NULL,
    event_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT connections_check CHECK ((requester_profile_id <> addressee_profile_id)),
    CONSTRAINT connections_status_check CHECK ((status = ANY (ARRAY['suggested'::text, 'pending'::text, 'accepted'::text, 'ignored'::text, 'blocked'::text])))
);


--
-- Name: contact_detail_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_detail_requests (
    requester_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contact_detail_requests_check CHECK ((requester_id <> owner_id)),
    CONSTRAINT contact_detail_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'fulfilled'::text, 'ignored'::text])))
);


--
-- Name: contact_disclosures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_disclosures (
    owner_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    source text DEFAULT 'explicit'::text NOT NULL,
    shared_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT contact_disclosures_check CHECK ((owner_id <> recipient_id))
);


--
-- Name: contact_permission_rollouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_permission_rollouts (
    id text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contact_preferences_private; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_preferences_private (
    profile_id uuid NOT NULL,
    email text,
    phone text,
    linkedin text,
    website text,
    allow_email boolean DEFAULT false NOT NULL,
    allow_phone boolean DEFAULT false NOT NULL,
    preferred text DEFAULT 'nearify'::text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversation_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_reads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    participant_a uuid NOT NULL,
    participant_b uuid NOT NULL,
    event_id uuid,
    event_name text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: device_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid,
    user_id uuid,
    token text NOT NULL,
    platform text DEFAULT 'ios'::text,
    environment text,
    app_version text,
    device_name text,
    last_seen_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    app_install_id text,
    registration_secret_hash text
);


--
-- Name: encounters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encounters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid,
    profile_a uuid NOT NULL,
    profile_b uuid NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone DEFAULT now(),
    overlap_seconds integer DEFAULT 0,
    confidence double precision DEFAULT 0.0
);


--
-- Name: event_discovery_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_discovery_preferences (
    event_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    discoverable boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: event_gatt_resolve_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_gatt_resolve_limits (
    user_id uuid NOT NULL,
    window_start timestamp with time zone NOT NULL,
    requests integer NOT NULL,
    CONSTRAINT event_gatt_resolve_limits_requests_check CHECK ((requests >= 0))
);


--
-- Name: event_gatt_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_gatt_tokens (
    profile_id uuid NOT NULL,
    event_id uuid NOT NULL,
    token_hash bytea NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT event_gatt_token_expiry CHECK (((expires_at > issued_at) AND (expires_at <= (issued_at + '00:15:00'::interval))))
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text,
    name text NOT NULL,
    description text,
    location text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    created_by uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: external_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    source_event_id text NOT NULL,
    title text NOT NULL,
    description text,
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    location text,
    source_url text,
    image_url text,
    raw_payload jsonb,
    matched_event_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    manually_unmatched_at timestamp with time zone,
    manually_unmatched_by uuid
);


--
-- Name: feed_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feed_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    viewer_profile_id uuid NOT NULL,
    type text NOT NULL,
    actor_profile_id uuid,
    target_profile_id uuid,
    event_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    priority_score double precision DEFAULT 50.0,
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT feed_items_type_check CHECK ((type = ANY (ARRAY['connection'::text, 'encounter'::text, 'suggestion'::text, 'message'::text])))
);


--
-- Name: ghost_guest_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ghost_guest_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    from_ghost_id uuid NOT NULL,
    to_ghost_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ghost_guest_connections_no_self CHECK ((from_ghost_id <> to_ghost_id))
);


--
-- Name: ghost_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ghost_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    ghost_token text NOT NULL,
    display_name text,
    claimed_by_profile_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    email_captured_at timestamp with time zone
);


--
-- Name: ghost_share_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ghost_share_codes (
    ghost_id uuid NOT NULL,
    share_code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: interaction_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interaction_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    from_profile_id uuid,
    to_profile_id uuid,
    interaction_type text NOT NULL,
    strength double precision DEFAULT 0,
    dwell_seconds integer DEFAULT 0,
    signal_strength double precision DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    from_ghost_id uuid,
    to_ghost_id uuid,
    claimed_by_profile_id uuid,
    CONSTRAINT interaction_events_interaction_type_check CHECK ((interaction_type = ANY (ARRAY['proximity'::text, 'qr_confirmed'::text, 'talk_self_confirmed'::text])))
);


--
-- Name: interaction_intelligence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interaction_intelligence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    target_profile_id uuid NOT NULL,
    score double precision DEFAULT 0 NOT NULL,
    reason text,
    type text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT interaction_intelligence_type_check CHECK ((type = ANY (ARRAY['recommended'::text, 'missed'::text, 'follow_up'::text, 're_engaged'::text])))
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_profile_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: person_saves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.person_saves (
    owner_id uuid NOT NULL,
    person_id uuid NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT person_saves_check CHECK ((owner_id <> person_id))
);


--
-- Name: push_delivery_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_delivery_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid,
    conversation_id uuid,
    sender_id uuid,
    recipient_id uuid,
    token_id uuid,
    stage text NOT NULL,
    apns_status integer,
    apns_reason text,
    request_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: relationship_context_private; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.relationship_context_private (
    owner_id uuid NOT NULL,
    person_id uuid NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    snoozed_until timestamp with time zone,
    intention text DEFAULT ''::text NOT NULL,
    intention_completed boolean DEFAULT false NOT NULL,
    CONSTRAINT relationship_context_private_check CHECK ((owner_id <> person_id)),
    CONSTRAINT relationship_context_private_intention_check CHECK ((char_length(intention) <= 280)),
    CONSTRAINT relationship_context_private_note_check CHECK ((char_length(note) <= 1000))
);


--
-- Name: relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_a_id uuid NOT NULL,
    profile_b_id uuid NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    proposed_by_id uuid,
    source_event_id uuid NOT NULL,
    source_intelligence_id uuid,
    first_encounter_at timestamp with time zone NOT NULL,
    confirmed_at timestamp with time zone,
    last_encounter_at timestamp with time zone,
    encounter_count integer DEFAULT 1 NOT NULL,
    snoozed_by_a boolean DEFAULT false NOT NULL,
    snoozed_by_b boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT relationships_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'confirmed'::text])))
);


--
-- Name: say_hello_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.say_hello_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    event_id uuid NOT NULL,
    from_profile_id uuid NOT NULL,
    to_profile_id uuid NOT NULL,
    kind text NOT NULL,
    from_name text,
    from_avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT say_hello_signals_kind_check CHECK ((kind = ANY (ARRAY['request'::text, 'accepted'::text, 'declined'::text])))
);


--
-- Name: account_qr_saves account_qr_saves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_qr_saves
    ADD CONSTRAINT account_qr_saves_pkey PRIMARY KEY (from_profile_id, to_profile_id, event_id);


--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (user_id);


--
-- Name: ambient_event_reviews ambient_event_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ambient_event_reviews
    ADD CONSTRAINT ambient_event_reviews_pkey PRIMARY KEY (owner_id, event_id);


--
-- Name: ambient_person_feedback ambient_person_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ambient_person_feedback
    ADD CONSTRAINT ambient_person_feedback_pkey PRIMARY KEY (owner_id, person_id);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: app_private_config app_private_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_private_config
    ADD CONSTRAINT app_private_config_pkey PRIMARY KEY (key);


--
-- Name: community_signal_preferences community_signal_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_signal_preferences
    ADD CONSTRAINT community_signal_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: community_signals community_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_signals
    ADD CONSTRAINT community_signals_pkey PRIMARY KEY (id);


--
-- Name: community_signals community_signals_unique_pair; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_signals
    ADD CONSTRAINT community_signals_unique_pair UNIQUE (sender_id, recipient_id);


--
-- Name: connections connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_pkey PRIMARY KEY (id);


--
-- Name: connections connections_requester_profile_id_addressee_profile_id_event_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_requester_profile_id_addressee_profile_id_event_key UNIQUE (requester_profile_id, addressee_profile_id, event_id);


--
-- Name: contact_detail_requests contact_detail_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_detail_requests
    ADD CONSTRAINT contact_detail_requests_pkey PRIMARY KEY (requester_id, owner_id);


--
-- Name: contact_disclosures contact_disclosures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_disclosures
    ADD CONSTRAINT contact_disclosures_pkey PRIMARY KEY (owner_id, recipient_id);


--
-- Name: contact_permission_rollouts contact_permission_rollouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_permission_rollouts
    ADD CONSTRAINT contact_permission_rollouts_pkey PRIMARY KEY (id);


--
-- Name: contact_preferences_private contact_preferences_private_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_preferences_private
    ADD CONSTRAINT contact_preferences_private_pkey PRIMARY KEY (profile_id);


--
-- Name: conversation_reads conversation_reads_conversation_profile_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_reads
    ADD CONSTRAINT conversation_reads_conversation_profile_key UNIQUE (conversation_id, profile_id);


--
-- Name: conversation_reads conversation_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_reads
    ADD CONSTRAINT conversation_reads_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: device_tokens device_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (id);


--
-- Name: device_tokens device_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_token_key UNIQUE (token);


--
-- Name: encounters encounters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounters
    ADD CONSTRAINT encounters_pkey PRIMARY KEY (id);


--
-- Name: event_attendees event_attendees_event_id_profile_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_event_id_profile_id_key UNIQUE (event_id, profile_id);


--
-- Name: event_attendees event_attendees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_pkey PRIMARY KEY (id);


--
-- Name: event_discovery_preferences event_discovery_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_discovery_preferences
    ADD CONSTRAINT event_discovery_preferences_pkey PRIMARY KEY (event_id, profile_id);


--
-- Name: event_gatt_resolve_limits event_gatt_resolve_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_gatt_resolve_limits
    ADD CONSTRAINT event_gatt_resolve_limits_pkey PRIMARY KEY (user_id);


--
-- Name: event_gatt_tokens event_gatt_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_gatt_tokens
    ADD CONSTRAINT event_gatt_tokens_pkey PRIMARY KEY (profile_id, event_id);


--
-- Name: event_gatt_tokens event_gatt_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_gatt_tokens
    ADD CONSTRAINT event_gatt_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: events events_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_slug_key UNIQUE (slug);


--
-- Name: external_events external_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_events
    ADD CONSTRAINT external_events_pkey PRIMARY KEY (id);


--
-- Name: external_events external_events_source_source_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_events
    ADD CONSTRAINT external_events_source_source_event_id_key UNIQUE (source, source_event_id);


--
-- Name: feed_items feed_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_items
    ADD CONSTRAINT feed_items_pkey PRIMARY KEY (id);


--
-- Name: ghost_guest_connections ghost_guest_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_guest_connections
    ADD CONSTRAINT ghost_guest_connections_pkey PRIMARY KEY (id);


--
-- Name: ghost_guest_connections ghost_guest_connections_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_guest_connections
    ADD CONSTRAINT ghost_guest_connections_unique UNIQUE (from_ghost_id, to_ghost_id);


--
-- Name: ghost_participants ghost_participants_ghost_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_participants
    ADD CONSTRAINT ghost_participants_ghost_token_key UNIQUE (ghost_token);


--
-- Name: ghost_participants ghost_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_participants
    ADD CONSTRAINT ghost_participants_pkey PRIMARY KEY (id);


--
-- Name: ghost_share_codes ghost_share_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_share_codes
    ADD CONSTRAINT ghost_share_codes_pkey PRIMARY KEY (ghost_id);


--
-- Name: ghost_share_codes ghost_share_codes_share_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_share_codes
    ADD CONSTRAINT ghost_share_codes_share_code_key UNIQUE (share_code);


--
-- Name: interaction_events interaction_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_events
    ADD CONSTRAINT interaction_events_pkey PRIMARY KEY (id);


--
-- Name: interaction_intelligence interaction_intelligence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_intelligence
    ADD CONSTRAINT interaction_intelligence_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: person_saves person_saves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_saves
    ADD CONSTRAINT person_saves_pkey PRIMARY KEY (owner_id, person_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: push_delivery_log push_delivery_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_delivery_log
    ADD CONSTRAINT push_delivery_log_pkey PRIMARY KEY (id);


--
-- Name: relationship_context_private relationship_context_private_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationship_context_private
    ADD CONSTRAINT relationship_context_private_pkey PRIMARY KEY (owner_id, person_id);


--
-- Name: relationships relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationships
    ADD CONSTRAINT relationships_pkey PRIMARY KEY (id);


--
-- Name: say_hello_signals say_hello_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.say_hello_signals
    ADD CONSTRAINT say_hello_signals_pkey PRIMARY KEY (id);


--
-- Name: conversations unique_conversation_pair; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT unique_conversation_pair UNIQUE (participant_a, participant_b);


--
-- Name: encounters unique_encounter_pair; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounters
    ADD CONSTRAINT unique_encounter_pair UNIQUE (event_id, profile_a, profile_b);


--
-- Name: feed_items unique_feed_item; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_items
    ADD CONSTRAINT unique_feed_item UNIQUE (viewer_profile_id, type, actor_profile_id, event_id);


--
-- Name: account_qr_saves_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_qr_saves_target_idx ON public.account_qr_saves USING btree (to_profile_id, from_profile_id, event_id);


--
-- Name: analytics_events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_created_at_idx ON public.analytics_events USING btree (created_at);


--
-- Name: analytics_events_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_event_id_idx ON public.analytics_events USING btree (event_id) WHERE (event_id IS NOT NULL);


--
-- Name: analytics_events_event_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_event_name_idx ON public.analytics_events USING btree (event_name);


--
-- Name: analytics_events_profile_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_profile_id_idx ON public.analytics_events USING btree (profile_id);


--
-- Name: community_signals_recipient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_signals_recipient_idx ON public.community_signals USING btree (recipient_id, created_at DESC);


--
-- Name: community_signals_sender_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_signals_sender_idx ON public.community_signals USING btree (sender_id, created_at DESC);


--
-- Name: conversation_reads_conversation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_reads_conversation_id_idx ON public.conversation_reads USING btree (conversation_id);


--
-- Name: conversation_reads_profile_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_reads_profile_id_idx ON public.conversation_reads USING btree (profile_id);


--
-- Name: device_tokens_active_ios_newest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_tokens_active_ios_newest_idx ON public.device_tokens USING btree (profile_id, environment, is_active, last_seen_at DESC, updated_at DESC) WHERE (platform = 'ios'::text);


--
-- Name: device_tokens_app_install_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_tokens_app_install_idx ON public.device_tokens USING btree (app_install_id) WHERE (app_install_id IS NOT NULL);


--
-- Name: device_tokens_profile_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_tokens_profile_id_idx ON public.device_tokens USING btree (profile_id);


--
-- Name: device_tokens_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_tokens_user_id_idx ON public.device_tokens USING btree (user_id);


--
-- Name: event_gatt_tokens_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_gatt_tokens_expiry_idx ON public.event_gatt_tokens USING btree (expires_at);


--
-- Name: ghost_guest_connections_from_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ghost_guest_connections_from_idx ON public.ghost_guest_connections USING btree (from_ghost_id, created_at DESC);


--
-- Name: ghost_guest_connections_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ghost_guest_connections_to_idx ON public.ghost_guest_connections USING btree (to_ghost_id);


--
-- Name: idx_conversations_a; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_a ON public.conversations USING btree (participant_a);


--
-- Name: idx_conversations_b; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_b ON public.conversations USING btree (participant_b);


--
-- Name: idx_encounters_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_encounters_event_id ON public.encounters USING btree (event_id);


--
-- Name: idx_encounters_profile_a; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_encounters_profile_a ON public.encounters USING btree (profile_a);


--
-- Name: idx_encounters_profile_b; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_encounters_profile_b ON public.encounters USING btree (profile_b);


--
-- Name: idx_feed_items_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feed_items_created ON public.feed_items USING btree (created_at DESC);


--
-- Name: idx_feed_items_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feed_items_priority ON public.feed_items USING btree (priority_score DESC);


--
-- Name: idx_feed_items_viewer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feed_items_viewer ON public.feed_items USING btree (viewer_profile_id);


--
-- Name: idx_ghost_participants_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ghost_participants_event_id ON public.ghost_participants USING btree (event_id);


--
-- Name: idx_intelligence_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intelligence_event ON public.interaction_intelligence USING btree (event_id);


--
-- Name: idx_intelligence_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intelligence_profile ON public.interaction_intelligence USING btree (profile_id);


--
-- Name: idx_intelligence_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intelligence_target ON public.interaction_intelligence USING btree (target_profile_id);


--
-- Name: idx_interaction_events_claimed_by_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interaction_events_claimed_by_profile ON public.interaction_events USING btree (claimed_by_profile_id);


--
-- Name: idx_interaction_events_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interaction_events_event ON public.interaction_events USING btree (event_id);


--
-- Name: idx_interaction_events_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interaction_events_from ON public.interaction_events USING btree (from_profile_id);


--
-- Name: idx_interaction_events_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interaction_events_to ON public.interaction_events USING btree (to_profile_id);


--
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id);


--
-- Name: idx_messages_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_created ON public.messages USING btree (created_at);


--
-- Name: idx_relationships_a; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_relationships_a ON public.relationships USING btree (profile_a_id, status);


--
-- Name: idx_relationships_b; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_relationships_b ON public.relationships USING btree (profile_b_id, status);


--
-- Name: idx_relationships_encounter_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_relationships_encounter_count ON public.relationships USING btree (encounter_count);


--
-- Name: idx_relationships_last_encounter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_relationships_last_encounter ON public.relationships USING btree (last_encounter_at);


--
-- Name: idx_relationships_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_relationships_pair ON public.relationships USING btree (profile_a_id, profile_b_id);


--
-- Name: idx_relationships_source_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_relationships_source_event ON public.relationships USING btree (source_event_id);


--
-- Name: interaction_unique_ghost_connect; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX interaction_unique_ghost_connect ON public.interaction_events USING btree (event_id, from_ghost_id, to_profile_id) WHERE ((interaction_type = 'qr_confirmed'::text) AND (from_ghost_id IS NOT NULL));


--
-- Name: interaction_unique_profile_qr; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX interaction_unique_profile_qr ON public.interaction_events USING btree (event_id, from_profile_id, to_profile_id) WHERE ((interaction_type = 'qr_confirmed'::text) AND (from_ghost_id IS NULL) AND (from_profile_id IS NOT NULL));


--
-- Name: interaction_unique_talk_self_confirmed; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX interaction_unique_talk_self_confirmed ON public.interaction_events USING btree (event_id, from_profile_id, to_profile_id) WHERE ((interaction_type = 'talk_self_confirmed'::text) AND (from_profile_id IS NOT NULL));


--
-- Name: push_delivery_log_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_delivery_log_message_idx ON public.push_delivery_log USING btree (message_id, created_at DESC);


--
-- Name: push_delivery_log_recipient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_delivery_log_recipient_idx ON public.push_delivery_log USING btree (recipient_id, created_at DESC);


--
-- Name: web_messages_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX web_messages_thread_idx ON public.messages USING btree (conversation_id, created_at DESC, id DESC);


--
-- Name: app_private_config app_private_config_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER app_private_config_set_updated_at BEFORE UPDATE ON public.app_private_config FOR EACH ROW EXECUTE FUNCTION public.set_app_private_config_updated_at();


--
-- Name: community_signals community_signal_block_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER community_signal_block_guard BEFORE INSERT ON public.community_signals FOR EACH ROW EXECUTE FUNCTION public.guard_signal_block();


--
-- Name: connections connection_approval_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER connection_approval_guard BEFORE INSERT OR UPDATE ON public.connections FOR EACH ROW EXECUTE FUNCTION public.guard_connection_approval();


--
-- Name: conversation_reads conversation_reads_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER conversation_reads_set_updated_at BEFORE UPDATE ON public.conversation_reads FOR EACH ROW EXECUTE FUNCTION public.set_conversation_reads_updated_at();


--
-- Name: event_attendees event_gatt_attendance_revocation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_gatt_attendance_revocation AFTER DELETE OR UPDATE OF status ON public.event_attendees FOR EACH ROW EXECUTE FUNCTION public.revoke_event_gatt_token_on_attendance_change();


--
-- Name: messages messages_send_message_push_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_send_message_push_insert AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.notify_send_message_push();


--
-- Name: profiles private_contact_preferences; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER private_contact_preferences BEFORE INSERT OR UPDATE OF public_email, public_phone, linkedin_url, website_url, share_email, share_phone, preferred_contact_method ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.capture_private_contact_preferences();


--
-- Name: contact_preferences_private prune_contact_disclosures; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prune_contact_disclosures AFTER INSERT OR UPDATE ON public.contact_preferences_private FOR EACH ROW EXECUTE FUNCTION public.prune_contact_disclosures();


--
-- Name: connections trg_connections_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_connections_updated_at BEFORE UPDATE ON public.connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: event_attendees trg_event_attendees_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_event_attendees_updated BEFORE UPDATE ON public.event_attendees FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: events trg_events_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_events_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: external_events trg_guard_manual_unmatch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_manual_unmatch BEFORE UPDATE ON public.external_events FOR EACH ROW EXECUTE FUNCTION public.guard_manual_unmatch();


--
-- Name: profiles trg_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: account_qr_saves account_qr_saves_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_qr_saves
    ADD CONSTRAINT account_qr_saves_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: account_qr_saves account_qr_saves_from_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_qr_saves
    ADD CONSTRAINT account_qr_saves_from_profile_id_fkey FOREIGN KEY (from_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: account_qr_saves account_qr_saves_to_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_qr_saves
    ADD CONSTRAINT account_qr_saves_to_profile_id_fkey FOREIGN KEY (to_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: admins admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ambient_event_reviews ambient_event_reviews_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ambient_event_reviews
    ADD CONSTRAINT ambient_event_reviews_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: ambient_event_reviews ambient_event_reviews_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ambient_event_reviews
    ADD CONSTRAINT ambient_event_reviews_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: ambient_person_feedback ambient_person_feedback_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ambient_person_feedback
    ADD CONSTRAINT ambient_person_feedback_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: ambient_person_feedback ambient_person_feedback_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ambient_person_feedback
    ADD CONSTRAINT ambient_person_feedback_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: analytics_events analytics_events_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;


--
-- Name: analytics_events analytics_events_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: community_signal_preferences community_signal_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_signal_preferences
    ADD CONSTRAINT community_signal_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: community_signals community_signals_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_signals
    ADD CONSTRAINT community_signals_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: community_signals community_signals_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_signals
    ADD CONSTRAINT community_signals_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: connections connections_addressee_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_addressee_profile_id_fkey FOREIGN KEY (addressee_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: connections connections_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;


--
-- Name: connections connections_requester_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_requester_profile_id_fkey FOREIGN KEY (requester_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: contact_detail_requests contact_detail_requests_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_detail_requests
    ADD CONSTRAINT contact_detail_requests_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: contact_detail_requests contact_detail_requests_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_detail_requests
    ADD CONSTRAINT contact_detail_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: contact_disclosures contact_disclosures_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_disclosures
    ADD CONSTRAINT contact_disclosures_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: contact_disclosures contact_disclosures_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_disclosures
    ADD CONSTRAINT contact_disclosures_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: contact_preferences_private contact_preferences_private_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_preferences_private
    ADD CONSTRAINT contact_preferences_private_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: conversation_reads conversation_reads_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_reads
    ADD CONSTRAINT conversation_reads_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_reads conversation_reads_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_reads
    ADD CONSTRAINT conversation_reads_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);


--
-- Name: conversations conversations_participant_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_participant_a_fkey FOREIGN KEY (participant_a) REFERENCES public.profiles(id);


--
-- Name: conversations conversations_participant_b_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_participant_b_fkey FOREIGN KEY (participant_b) REFERENCES public.profiles(id);


--
-- Name: device_tokens device_tokens_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: encounters encounters_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounters
    ADD CONSTRAINT encounters_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);


--
-- Name: encounters encounters_profile_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounters
    ADD CONSTRAINT encounters_profile_a_fkey FOREIGN KEY (profile_a) REFERENCES public.profiles(id);


--
-- Name: encounters encounters_profile_b_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounters
    ADD CONSTRAINT encounters_profile_b_fkey FOREIGN KEY (profile_b) REFERENCES public.profiles(id);


--
-- Name: event_attendees event_attendees_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_attendees event_attendees_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: event_discovery_preferences event_discovery_preferences_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_discovery_preferences
    ADD CONSTRAINT event_discovery_preferences_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_discovery_preferences event_discovery_preferences_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_discovery_preferences
    ADD CONSTRAINT event_discovery_preferences_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: event_gatt_tokens event_gatt_tokens_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_gatt_tokens
    ADD CONSTRAINT event_gatt_tokens_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_gatt_tokens event_gatt_tokens_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_gatt_tokens
    ADD CONSTRAINT event_gatt_tokens_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: events events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: external_events external_events_matched_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_events
    ADD CONSTRAINT external_events_matched_event_id_fkey FOREIGN KEY (matched_event_id) REFERENCES public.events(id);


--
-- Name: feed_items feed_items_actor_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_items
    ADD CONSTRAINT feed_items_actor_profile_id_fkey FOREIGN KEY (actor_profile_id) REFERENCES public.profiles(id);


--
-- Name: feed_items feed_items_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_items
    ADD CONSTRAINT feed_items_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);


--
-- Name: feed_items feed_items_target_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_items
    ADD CONSTRAINT feed_items_target_profile_id_fkey FOREIGN KEY (target_profile_id) REFERENCES public.profiles(id);


--
-- Name: feed_items feed_items_viewer_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_items
    ADD CONSTRAINT feed_items_viewer_profile_id_fkey FOREIGN KEY (viewer_profile_id) REFERENCES public.profiles(id);


--
-- Name: ghost_guest_connections ghost_guest_connections_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_guest_connections
    ADD CONSTRAINT ghost_guest_connections_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: ghost_guest_connections ghost_guest_connections_from_ghost_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_guest_connections
    ADD CONSTRAINT ghost_guest_connections_from_ghost_id_fkey FOREIGN KEY (from_ghost_id) REFERENCES public.ghost_participants(id) ON DELETE CASCADE;


--
-- Name: ghost_guest_connections ghost_guest_connections_to_ghost_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_guest_connections
    ADD CONSTRAINT ghost_guest_connections_to_ghost_id_fkey FOREIGN KEY (to_ghost_id) REFERENCES public.ghost_participants(id) ON DELETE CASCADE;


--
-- Name: ghost_participants ghost_participants_claimed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_participants
    ADD CONSTRAINT ghost_participants_claimed_by_profile_id_fkey FOREIGN KEY (claimed_by_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: ghost_participants ghost_participants_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_participants
    ADD CONSTRAINT ghost_participants_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: ghost_share_codes ghost_share_codes_ghost_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghost_share_codes
    ADD CONSTRAINT ghost_share_codes_ghost_id_fkey FOREIGN KEY (ghost_id) REFERENCES public.ghost_participants(id) ON DELETE CASCADE;


--
-- Name: interaction_events interaction_events_claimed_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_events
    ADD CONSTRAINT interaction_events_claimed_by_profile_id_fkey FOREIGN KEY (claimed_by_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: interaction_events interaction_events_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_events
    ADD CONSTRAINT interaction_events_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);


--
-- Name: interaction_events interaction_events_from_ghost_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_events
    ADD CONSTRAINT interaction_events_from_ghost_id_fkey FOREIGN KEY (from_ghost_id) REFERENCES public.ghost_participants(id) ON DELETE SET NULL;


--
-- Name: interaction_events interaction_events_from_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_events
    ADD CONSTRAINT interaction_events_from_profile_id_fkey FOREIGN KEY (from_profile_id) REFERENCES public.profiles(id);


--
-- Name: interaction_events interaction_events_to_ghost_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_events
    ADD CONSTRAINT interaction_events_to_ghost_id_fkey FOREIGN KEY (to_ghost_id) REFERENCES public.ghost_participants(id) ON DELETE SET NULL;


--
-- Name: interaction_events interaction_events_to_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_events
    ADD CONSTRAINT interaction_events_to_profile_id_fkey FOREIGN KEY (to_profile_id) REFERENCES public.profiles(id);


--
-- Name: interaction_intelligence interaction_intelligence_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_intelligence
    ADD CONSTRAINT interaction_intelligence_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);


--
-- Name: interaction_intelligence interaction_intelligence_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_intelligence
    ADD CONSTRAINT interaction_intelligence_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id);


--
-- Name: interaction_intelligence interaction_intelligence_target_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_intelligence
    ADD CONSTRAINT interaction_intelligence_target_profile_id_fkey FOREIGN KEY (target_profile_id) REFERENCES public.profiles(id);


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_sender_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_profile_id_fkey FOREIGN KEY (sender_profile_id) REFERENCES public.profiles(id);


--
-- Name: person_saves person_saves_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_saves
    ADD CONSTRAINT person_saves_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: person_saves person_saves_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_saves
    ADD CONSTRAINT person_saves_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: relationship_context_private relationship_context_private_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationship_context_private
    ADD CONSTRAINT relationship_context_private_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: relationship_context_private relationship_context_private_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationship_context_private
    ADD CONSTRAINT relationship_context_private_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: relationships relationships_profile_a_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationships
    ADD CONSTRAINT relationships_profile_a_id_fkey FOREIGN KEY (profile_a_id) REFERENCES public.profiles(id);


--
-- Name: relationships relationships_profile_b_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationships
    ADD CONSTRAINT relationships_profile_b_id_fkey FOREIGN KEY (profile_b_id) REFERENCES public.profiles(id);


--
-- Name: relationships relationships_proposed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationships
    ADD CONSTRAINT relationships_proposed_by_id_fkey FOREIGN KEY (proposed_by_id) REFERENCES public.profiles(id);


--
-- Name: relationships relationships_source_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationships
    ADD CONSTRAINT relationships_source_event_id_fkey FOREIGN KEY (source_event_id) REFERENCES public.events(id);


--
-- Name: relationships relationships_source_intelligence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationships
    ADD CONSTRAINT relationships_source_intelligence_id_fkey FOREIGN KEY (source_intelligence_id) REFERENCES public.interaction_intelligence(id);


--
-- Name: events Admins can create events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can create events" ON public.events FOR INSERT WITH CHECK ((public.is_admin() AND (created_by = public.current_profile_id())));


--
-- Name: analytics_events Anyone can log analytics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can log analytics" ON public.analytics_events FOR INSERT WITH CHECK (true);


--
-- Name: analytics_events No public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "No public read" ON public.analytics_events FOR SELECT USING (false);


--
-- Name: events Owners can delete events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can delete events" ON public.events FOR DELETE USING ((created_by IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: events Owners can update events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can update events" ON public.events FOR UPDATE USING ((created_by IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: events Public can read events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read events" ON public.events FOR SELECT USING (true);


--
-- Name: external_events Public can read external events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read external events" ON public.external_events FOR SELECT USING (true);


--
-- Name: analytics_events Users can read own analytics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own analytics" ON public.analytics_events FOR SELECT USING ((auth.uid() = profile_id));


--
-- Name: relationships Users propose own relationships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users propose own relationships" ON public.relationships FOR INSERT WITH CHECK (((status = 'proposed'::text) AND (proposed_by_id = public.current_profile_id()) AND ((profile_a_id = public.current_profile_id()) OR (profile_b_id = public.current_profile_id()))));


--
-- Name: interaction_intelligence Users see own intelligence; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own intelligence" ON public.interaction_intelligence FOR SELECT USING (((profile_id = public.current_profile_id()) OR (target_profile_id = public.current_profile_id())));


--
-- Name: interaction_events Users see own interactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own interactions" ON public.interaction_events FOR SELECT USING (((from_profile_id = public.current_profile_id()) OR (to_profile_id = public.current_profile_id())));


--
-- Name: relationships Users see own relationships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own relationships" ON public.relationships FOR SELECT USING (((profile_a_id = public.current_profile_id()) OR (profile_b_id = public.current_profile_id())));


--
-- Name: account_qr_saves; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_qr_saves ENABLE ROW LEVEL SECURITY;

--
-- Name: admins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

--
-- Name: ambient_event_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ambient_event_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: ambient_person_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ambient_person_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

--
-- Name: app_private_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_private_config ENABLE ROW LEVEL SECURITY;

--
-- Name: event_attendees authenticated users can view event attendees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated users can view event attendees" ON public.event_attendees FOR SELECT TO authenticated USING (true);


--
-- Name: events authenticated users can view events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated users can view events" ON public.events FOR SELECT TO authenticated USING (true);


--
-- Name: community_signal_preferences community_preferences_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_preferences_delete ON public.community_signal_preferences FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: community_signal_preferences community_preferences_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_preferences_insert ON public.community_signal_preferences FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: community_signal_preferences community_preferences_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_preferences_select ON public.community_signal_preferences FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: community_signal_preferences community_preferences_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_preferences_update ON public.community_signal_preferences FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: community_signal_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_signal_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: community_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_signals ENABLE ROW LEVEL SECURITY;

--
-- Name: community_signals community_signals_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY community_signals_participants ON public.community_signals FOR SELECT TO authenticated USING (((sender_id = ( SELECT auth.uid() AS uid)) OR (recipient_id = ( SELECT auth.uid() AS uid))));


--
-- Name: connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_detail_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_detail_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_disclosures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_disclosures ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_permission_rollouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_permission_rollouts ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_preferences_private; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_preferences_private ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_reads conversation_reads_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_reads_insert ON public.conversation_reads FOR INSERT WITH CHECK ((profile_id IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: conversation_reads conversation_reads_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_reads_select ON public.conversation_reads FOR SELECT USING ((profile_id IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: conversation_reads conversation_reads_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_reads_update ON public.conversation_reads FOR UPDATE USING ((profile_id IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid())))) WITH CHECK ((profile_id IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations conversations_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_insert ON public.conversations FOR INSERT WITH CHECK ((participant_a IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: conversations conversations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_select ON public.conversations FOR SELECT USING (((participant_a IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))) OR (participant_b IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid())))));


--
-- Name: device_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: device_tokens device_tokens_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_tokens_delete_own ON public.device_tokens FOR DELETE USING ((profile_id IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: device_tokens device_tokens_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_tokens_insert_own ON public.device_tokens FOR INSERT WITH CHECK ((profile_id IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: device_tokens device_tokens_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_tokens_select_own ON public.device_tokens FOR SELECT USING ((profile_id IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: device_tokens device_tokens_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_tokens_update_own ON public.device_tokens FOR UPDATE USING ((profile_id IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid())))) WITH CHECK ((profile_id IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: encounters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.encounters ENABLE ROW LEVEL SECURITY;

--
-- Name: encounters encounters_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encounters_insert ON public.encounters FOR INSERT WITH CHECK ((profile_a IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: encounters encounters_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encounters_select ON public.encounters FOR SELECT USING (((profile_a IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))) OR (profile_b IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid())))));


--
-- Name: encounters encounters_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encounters_update ON public.encounters FOR UPDATE USING ((profile_a IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: event_attendees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;

--
-- Name: event_discovery_preferences event_discovery_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_discovery_delete_own ON public.event_discovery_preferences FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = event_discovery_preferences.profile_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: event_discovery_preferences event_discovery_insert_own_attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_discovery_insert_own_attendance ON public.event_discovery_preferences FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.event_attendees ea ON ((ea.profile_id = p.id)))
  WHERE ((p.id = ea.profile_id) AND (p.user_id = ( SELECT auth.uid() AS uid)) AND (ea.event_id = ea.event_id) AND (ea.status = ANY (ARRAY['joined'::text, 'inEvent'::text]))))));


--
-- Name: event_discovery_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_discovery_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: event_discovery_preferences event_discovery_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_discovery_select_own ON public.event_discovery_preferences FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = event_discovery_preferences.profile_id) AND (p.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: event_discovery_preferences event_discovery_update_own_attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_discovery_update_own_attendance ON public.event_discovery_preferences FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = event_discovery_preferences.profile_id) AND (p.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.event_attendees ea ON ((ea.profile_id = p.id)))
  WHERE ((p.id = ea.profile_id) AND (p.user_id = ( SELECT auth.uid() AS uid)) AND (ea.event_id = ea.event_id) AND (ea.status = ANY (ARRAY['joined'::text, 'inEvent'::text]))))));


--
-- Name: event_gatt_resolve_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_gatt_resolve_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: event_gatt_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_gatt_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: external_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_events ENABLE ROW LEVEL SECURITY;

--
-- Name: feed_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feed_items ENABLE ROW LEVEL SECURITY;

--
-- Name: feed_items feed_items_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feed_items_delete ON public.feed_items FOR DELETE USING ((viewer_profile_id IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: feed_items feed_items_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feed_items_insert ON public.feed_items FOR INSERT WITH CHECK ((viewer_profile_id IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: feed_items feed_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feed_items_select ON public.feed_items FOR SELECT USING ((viewer_profile_id IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: feed_items feed_items_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feed_items_update ON public.feed_items FOR UPDATE USING ((viewer_profile_id IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))));


--
-- Name: ghost_guest_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ghost_guest_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: ghost_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ghost_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: ghost_share_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ghost_share_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: interaction_events iOS app inserts interactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "iOS app inserts interactions" ON public.interaction_events FOR INSERT WITH CHECK ((from_profile_id = public.current_profile_id()));


--
-- Name: interaction_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.interaction_events ENABLE ROW LEVEL SECURITY;

--
-- Name: interaction_intelligence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.interaction_intelligence ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_insert ON public.messages FOR INSERT WITH CHECK (((sender_profile_id IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.user_id = auth.uid()))) AND (conversation_id IN ( SELECT conversations.id
   FROM public.conversations
  WHERE ((conversations.participant_a IN ( SELECT profiles.id
           FROM public.profiles
          WHERE (profiles.user_id = auth.uid()))) OR (conversations.participant_b IN ( SELECT profiles.id
           FROM public.profiles
          WHERE (profiles.user_id = auth.uid()))))))));


--
-- Name: messages messages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_select ON public.messages FOR SELECT USING ((conversation_id IN ( SELECT conversations.id
   FROM public.conversations
  WHERE ((conversations.participant_a IN ( SELECT profiles.id
           FROM public.profiles
          WHERE (profiles.user_id = auth.uid()))) OR (conversations.participant_b IN ( SELECT profiles.id
           FROM public.profiles
          WHERE (profiles.user_id = auth.uid())))))));


--
-- Name: person_saves; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.person_saves ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles are viewable by authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles are viewable by authenticated users" ON public.profiles FOR SELECT TO authenticated USING (true);


--
-- Name: push_delivery_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_delivery_log ENABLE ROW LEVEL SECURITY;

--
-- Name: relationship_context_private; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.relationship_context_private ENABLE ROW LEVEL SECURITY;

--
-- Name: relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: say_hello_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.say_hello_signals ENABLE ROW LEVEL SECURITY;

--
-- Name: say_hello_signals say_hello_signals_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY say_hello_signals_insert_authenticated ON public.say_hello_signals FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: say_hello_signals say_hello_signals_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY say_hello_signals_select_authenticated ON public.say_hello_signals FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL));


--
-- Name: connections users can create connection requests as themselves; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can create connection requests as themselves" ON public.connections FOR INSERT TO authenticated WITH CHECK ((requester_profile_id IN ( SELECT p.id
   FROM public.profiles p
  WHERE (p.user_id = auth.uid()))));


--
-- Name: profiles users can insert their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: event_attendees users can join events as themselves; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can join events as themselves" ON public.event_attendees FOR INSERT TO authenticated WITH CHECK ((profile_id IN ( SELECT p.id
   FROM public.profiles p
  WHERE (p.user_id = auth.uid()))));


--
-- Name: connections users can update connections they are part of; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can update connections they are part of" ON public.connections FOR UPDATE TO authenticated USING (((requester_profile_id IN ( SELECT p.id
   FROM public.profiles p
  WHERE (p.user_id = auth.uid()))) OR (addressee_profile_id IN ( SELECT p.id
   FROM public.profiles p
  WHERE (p.user_id = auth.uid()))))) WITH CHECK (((requester_profile_id IN ( SELECT p.id
   FROM public.profiles p
  WHERE (p.user_id = auth.uid()))) OR (addressee_profile_id IN ( SELECT p.id
   FROM public.profiles p
  WHERE (p.user_id = auth.uid())))));


--
-- Name: event_attendees users can update their own attendee row; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can update their own attendee row" ON public.event_attendees FOR UPDATE TO authenticated USING ((profile_id IN ( SELECT p.id
   FROM public.profiles p
  WHERE (p.user_id = auth.uid())))) WITH CHECK ((profile_id IN ( SELECT p.id
   FROM public.profiles p
  WHERE (p.user_id = auth.uid()))));


--
-- Name: profiles users can update their own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: connections users can view their own connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can view their own connections" ON public.connections FOR SELECT TO authenticated USING (((requester_profile_id IN ( SELECT p.id
   FROM public.profiles p
  WHERE (p.user_id = auth.uid()))) OR (addressee_profile_id IN ( SELECT p.id
   FROM public.profiles p
  WHERE (p.user_id = auth.uid())))));


--
-- Name: conversations web_conversations_approval_guard; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY web_conversations_approval_guard ON public.conversations AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((participant_a = public.current_profile_id()) AND public.web_can_message(participant_b)));


--
-- Name: conversations web_conversations_create; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY web_conversations_create ON public.conversations FOR INSERT TO authenticated WITH CHECK (((participant_a = public.current_profile_id()) AND public.web_can_message(participant_b)));


--
-- Name: conversations web_conversations_immutable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY web_conversations_immutable ON public.conversations AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);


--
-- Name: conversations web_conversations_member_guard; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY web_conversations_member_guard ON public.conversations AS RESTRICTIVE TO authenticated USING (((public.current_profile_id() = participant_a) OR (public.current_profile_id() = participant_b))) WITH CHECK (((public.current_profile_id() = participant_a) OR (public.current_profile_id() = participant_b)));


--
-- Name: conversations web_conversations_no_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY web_conversations_no_delete ON public.conversations AS RESTRICTIVE FOR DELETE TO authenticated USING (false);


--
-- Name: conversations web_conversations_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY web_conversations_read ON public.conversations FOR SELECT TO authenticated USING (((public.current_profile_id() = participant_a) OR (public.current_profile_id() = participant_b)));


--
-- Name: messages web_messages_create; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY web_messages_create ON public.messages FOR INSERT TO authenticated WITH CHECK (((sender_profile_id = public.current_profile_id()) AND public.web_can_send_to_conversation(conversation_id)));


--
-- Name: messages web_messages_immutable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY web_messages_immutable ON public.messages AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);


--
-- Name: messages web_messages_member_guard; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY web_messages_member_guard ON public.messages AS RESTRICTIVE TO authenticated USING (public.web_is_conversation_member(conversation_id)) WITH CHECK (public.web_is_conversation_member(conversation_id));


--
-- Name: messages web_messages_no_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY web_messages_no_delete ON public.messages AS RESTRICTIVE FOR DELETE TO authenticated USING (false);


--
-- Name: messages web_messages_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY web_messages_read ON public.messages FOR SELECT TO authenticated USING (public.web_is_conversation_member(conversation_id));


--
-- Name: messages web_messages_send_guard; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY web_messages_send_guard ON public.messages AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((sender_profile_id = public.current_profile_id()) AND public.web_can_send_to_conversation(conversation_id) AND ((length(btrim(content)) >= 1) AND (length(btrim(content)) <= 4000)) AND (content ~ '[^[:space:]]'::text)));


--
-- Name: conversation_reads web_reads_member_guard; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY web_reads_member_guard ON public.conversation_reads AS RESTRICTIVE TO authenticated USING (((profile_id = public.current_profile_id()) AND public.web_is_conversation_member(conversation_id))) WITH CHECK (((profile_id = public.current_profile_id()) AND public.web_is_conversation_member(conversation_id)));


--
-- Name: conversation_reads web_reads_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY web_reads_own ON public.conversation_reads TO authenticated USING (((profile_id = public.current_profile_id()) AND public.web_is_conversation_member(conversation_id))) WITH CHECK (((profile_id = public.current_profile_id()) AND public.web_is_conversation_member(conversation_id)));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION ambient_context(p_other uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ambient_context(p_other uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ambient_context(p_other uuid) TO service_role;
GRANT ALL ON FUNCTION public.ambient_context(p_other uuid) TO authenticated;


--
-- Name: FUNCTION ambient_context_save(p_other uuid, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ambient_context_save(p_other uuid, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ambient_context_save(p_other uuid, p_note text) TO service_role;
GRANT ALL ON FUNCTION public.ambient_context_save(p_other uuid, p_note text) TO authenticated;


--
-- Name: FUNCTION ambient_context_save_v2(p_other uuid, p_note text, p_intention text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ambient_context_save_v2(p_other uuid, p_note text, p_intention text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ambient_context_save_v2(p_other uuid, p_note text, p_intention text) TO service_role;
GRANT ALL ON FUNCTION public.ambient_context_save_v2(p_other uuid, p_note text, p_intention text) TO authenticated;


--
-- Name: FUNCTION ambient_context_snooze(p_other uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ambient_context_snooze(p_other uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ambient_context_snooze(p_other uuid) TO service_role;
GRANT ALL ON FUNCTION public.ambient_context_snooze(p_other uuid) TO authenticated;


--
-- Name: FUNCTION ambient_contexts(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ambient_contexts() FROM PUBLIC;
GRANT ALL ON FUNCTION public.ambient_contexts() TO service_role;
GRANT ALL ON FUNCTION public.ambient_contexts() TO authenticated;


--
-- Name: FUNCTION ambient_event_prep(p_event uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ambient_event_prep(p_event uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ambient_event_prep(p_event uuid) TO service_role;
GRANT ALL ON FUNCTION public.ambient_event_prep(p_event uuid) TO authenticated;


--
-- Name: FUNCTION ambient_home_extras(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ambient_home_extras() FROM PUBLIC;
GRANT ALL ON FUNCTION public.ambient_home_extras() TO service_role;
GRANT ALL ON FUNCTION public.ambient_home_extras() TO authenticated;


--
-- Name: FUNCTION ambient_intention_complete(p_other uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ambient_intention_complete(p_other uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ambient_intention_complete(p_other uuid) TO service_role;
GRANT ALL ON FUNCTION public.ambient_intention_complete(p_other uuid) TO authenticated;


--
-- Name: FUNCTION ambient_person_dismiss(p_other uuid, p_dismissed boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ambient_person_dismiss(p_other uuid, p_dismissed boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ambient_person_dismiss(p_other uuid, p_dismissed boolean) TO service_role;
GRANT ALL ON FUNCTION public.ambient_person_dismiss(p_other uuid, p_dismissed boolean) TO authenticated;


--
-- Name: FUNCTION ambient_review_action(p_event uuid, p_action text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ambient_review_action(p_event uuid, p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ambient_review_action(p_event uuid, p_action text) TO service_role;
GRANT ALL ON FUNCTION public.ambient_review_action(p_event uuid, p_action text) TO authenticated;


--
-- Name: FUNCTION ambient_review_record(p_event uuid, p_session_started_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ambient_review_record(p_event uuid, p_session_started_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ambient_review_record(p_event uuid, p_session_started_at timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.ambient_review_record(p_event uuid, p_session_started_at timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION capture_private_contact_preferences(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.capture_private_contact_preferences() FROM PUBLIC;
GRANT ALL ON FUNCTION public.capture_private_contact_preferences() TO authenticated;
GRANT ALL ON FUNCTION public.capture_private_contact_preferences() TO service_role;


--
-- Name: FUNCTION claim_ghost_activity(p_ghost_id uuid, p_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_ghost_activity(p_ghost_id uuid, p_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_ghost_activity(p_ghost_id uuid, p_profile_id uuid) TO anon;
GRANT ALL ON FUNCTION public.claim_ghost_activity(p_ghost_id uuid, p_profile_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.claim_ghost_activity(p_ghost_id uuid, p_profile_id uuid) TO service_role;


--
-- Name: FUNCTION claim_guest_network(p_ghost_id uuid, p_ghost_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_guest_network(p_ghost_id uuid, p_ghost_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_guest_network(p_ghost_id uuid, p_ghost_token text) TO authenticated;
GRANT ALL ON FUNCTION public.claim_guest_network(p_ghost_id uuid, p_ghost_token text) TO service_role;


--
-- Name: FUNCTION community_signal_connection(p_target_user uuid, p_invite boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.community_signal_connection(p_target_user uuid, p_invite boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.community_signal_connection(p_target_user uuid, p_invite boolean) TO authenticated;
GRANT ALL ON FUNCTION public.community_signal_connection(p_target_user uuid, p_invite boolean) TO service_role;


--
-- Name: FUNCTION community_signal_discover(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.community_signal_discover() FROM PUBLIC;
GRANT ALL ON FUNCTION public.community_signal_discover() TO authenticated;
GRANT ALL ON FUNCTION public.community_signal_discover() TO service_role;


--
-- Name: FUNCTION community_signal_discover_v2(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.community_signal_discover_v2() FROM PUBLIC;
GRANT ALL ON FUNCTION public.community_signal_discover_v2() TO authenticated;
GRANT ALL ON FUNCTION public.community_signal_discover_v2() TO service_role;


--
-- Name: FUNCTION community_signal_send(target uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.community_signal_send(target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.community_signal_send(target uuid) TO authenticated;
GRANT ALL ON FUNCTION public.community_signal_send(target uuid) TO service_role;


--
-- Name: FUNCTION compute_interaction_intelligence(p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.compute_interaction_intelligence(p_event_id uuid) TO anon;
GRANT ALL ON FUNCTION public.compute_interaction_intelligence(p_event_id uuid) TO service_role;


--
-- Name: FUNCTION confirm_relationship(p_other_profile_id uuid, p_source_event_id uuid, p_source_intel_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_relationship(p_other_profile_id uuid, p_source_event_id uuid, p_source_intel_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_relationship(p_other_profile_id uuid, p_source_event_id uuid, p_source_intel_id uuid) TO anon;
GRANT ALL ON FUNCTION public.confirm_relationship(p_other_profile_id uuid, p_source_event_id uuid, p_source_intel_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.confirm_relationship(p_other_profile_id uuid, p_source_event_id uuid, p_source_intel_id uuid) TO service_role;


--
-- Name: FUNCTION contact_details_action(p_other uuid, p_action text, p_fields text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contact_details_action(p_other uuid, p_action text, p_fields text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.contact_details_action(p_other uuid, p_action text, p_fields text[]) TO authenticated;
GRANT ALL ON FUNCTION public.contact_details_action(p_other uuid, p_action text, p_fields text[]) TO service_role;


--
-- Name: FUNCTION contact_owner_preferences(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contact_owner_preferences() FROM PUBLIC;
GRANT ALL ON FUNCTION public.contact_owner_preferences() TO authenticated;
GRANT ALL ON FUNCTION public.contact_owner_preferences() TO service_role;


--
-- Name: FUNCTION contact_save_preferences(p_email text, p_phone text, p_linkedin text, p_website text, p_allow_email boolean, p_allow_phone boolean, p_preferred text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contact_save_preferences(p_email text, p_phone text, p_linkedin text, p_website text, p_allow_email boolean, p_allow_phone boolean, p_preferred text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.contact_save_preferences(p_email text, p_phone text, p_linkedin text, p_website text, p_allow_email boolean, p_allow_phone boolean, p_preferred text) TO authenticated;
GRANT ALL ON FUNCTION public.contact_save_preferences(p_email text, p_phone text, p_linkedin text, p_website text, p_allow_email boolean, p_allow_phone boolean, p_preferred text) TO service_role;


--
-- Name: FUNCTION create_ghost_participant(p_event_id uuid, p_display_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_ghost_participant(p_event_id uuid, p_display_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_ghost_participant(p_event_id uuid, p_display_name text) TO anon;
GRANT ALL ON FUNCTION public.create_ghost_participant(p_event_id uuid, p_display_name text) TO authenticated;
GRANT ALL ON FUNCTION public.create_ghost_participant(p_event_id uuid, p_display_name text) TO service_role;


--
-- Name: FUNCTION current_profile_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.current_profile_id() TO anon;
GRANT ALL ON FUNCTION public.current_profile_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_profile_id() TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: FUNCTION ensure_profile(p_name text, p_email text, p_avatar_url text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ensure_profile(p_name text, p_email text, p_avatar_url text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_profile(p_name text, p_email text, p_avatar_url text) TO anon;
GRANT ALL ON FUNCTION public.ensure_profile(p_name text, p_email text, p_avatar_url text) TO authenticated;
GRANT ALL ON FUNCTION public.ensure_profile(p_name text, p_email text, p_avatar_url text) TO service_role;


--
-- Name: FUNCTION get_consented_event_attendees(p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_consented_event_attendees(p_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_consented_event_attendees(p_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_consented_event_attendees(p_event_id uuid) TO service_role;


--
-- Name: FUNCTION get_event_connection_people(p_event uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_event_connection_people(p_event uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_event_connection_people(p_event uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_event_connection_people(p_event uuid) TO authenticated;


--
-- Name: FUNCTION get_event_context(p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_event_context(p_event_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_event_context(p_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_event_context(p_event_id uuid) TO service_role;


--
-- Name: FUNCTION get_event_preparation_people(p_event uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_event_preparation_people(p_event uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_event_preparation_people(p_event uuid) TO service_role;
GRANT ALL ON FUNCTION public.get_event_preparation_people(p_event uuid) TO authenticated;


--
-- Name: FUNCTION get_ghost_connection_history(p_ghost_id uuid, p_ghost_token text, p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_ghost_connection_history(p_ghost_id uuid, p_ghost_token text, p_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_ghost_connection_history(p_ghost_id uuid, p_ghost_token text, p_event_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_ghost_connection_history(p_ghost_id uuid, p_ghost_token text, p_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_ghost_connection_history(p_ghost_id uuid, p_ghost_token text, p_event_id uuid) TO service_role;


--
-- Name: FUNCTION get_meetup_activity_hourly(p_hours integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_meetup_activity_hourly(p_hours integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_meetup_activity_hourly(p_hours integer) TO service_role;


--
-- Name: FUNCTION get_meetup_funnel(p_since timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_meetup_funnel(p_since timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.get_meetup_funnel(p_since timestamp with time zone) TO service_role;


--
-- Name: FUNCTION get_my_claimed_guest_connections(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_claimed_guest_connections() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_claimed_guest_connections() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_claimed_guest_connections() TO service_role;


--
-- Name: FUNCTION get_my_connections(p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_connections(p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_connections(p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_connections(p_status text) TO service_role;


--
-- Name: FUNCTION get_my_event_discovery_preference(p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_event_discovery_preference(p_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_event_discovery_preference(p_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_event_discovery_preference(p_event_id uuid) TO service_role;


--
-- Name: FUNCTION get_my_guest_share_code(p_event_id uuid, p_ghost_id uuid, p_ghost_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_guest_share_code(p_event_id uuid, p_ghost_id uuid, p_ghost_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_guest_share_code(p_event_id uuid, p_ghost_id uuid, p_ghost_token text) TO anon;
GRANT ALL ON FUNCTION public.get_my_guest_share_code(p_event_id uuid, p_ghost_id uuid, p_ghost_token text) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_guest_share_code(p_event_id uuid, p_ghost_id uuid, p_ghost_token text) TO service_role;


--
-- Name: FUNCTION get_my_guest_to_guest_connections(p_event_id uuid, p_ghost_id uuid, p_ghost_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_guest_to_guest_connections(p_event_id uuid, p_ghost_id uuid, p_ghost_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_guest_to_guest_connections(p_event_id uuid, p_ghost_id uuid, p_ghost_token text) TO anon;
GRANT ALL ON FUNCTION public.get_my_guest_to_guest_connections(p_event_id uuid, p_ghost_id uuid, p_ghost_token text) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_guest_to_guest_connections(p_event_id uuid, p_ghost_id uuid, p_ghost_token text) TO service_role;


--
-- Name: FUNCTION get_my_intelligence(p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_my_intelligence(p_event_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_my_intelligence(p_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_my_intelligence(p_event_id uuid) TO service_role;


--
-- Name: FUNCTION get_organizer_event_insights(p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_organizer_event_insights(p_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_organizer_event_insights(p_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_organizer_event_insights(p_event_id uuid) TO service_role;


--
-- Name: FUNCTION get_public_event_attendees(p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_public_event_attendees(p_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_public_event_attendees(p_event_id uuid) TO service_role;


--
-- Name: FUNCTION get_public_profile_brief(p_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_public_profile_brief(p_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_public_profile_brief(p_profile_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_public_profile_brief(p_profile_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_public_profile_brief(p_profile_id uuid) TO service_role;


--
-- Name: FUNCTION get_relationship_context(p_other_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_relationship_context(p_other_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_relationship_context(p_other_profile_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_relationship_context(p_other_profile_id uuid) TO service_role;


--
-- Name: FUNCTION get_relationship_event_history(p_other_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_relationship_event_history(p_other_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_relationship_event_history(p_other_profile_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_relationship_event_history(p_other_profile_id uuid) TO service_role;


--
-- Name: FUNCTION get_saved_people(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_saved_people() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_saved_people() TO authenticated;
GRANT ALL ON FUNCTION public.get_saved_people() TO service_role;


--
-- Name: FUNCTION guard_connection_approval(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_connection_approval() FROM PUBLIC;
GRANT ALL ON FUNCTION public.guard_connection_approval() TO authenticated;
GRANT ALL ON FUNCTION public.guard_connection_approval() TO service_role;


--
-- Name: FUNCTION guard_manual_unmatch(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_manual_unmatch() TO anon;
GRANT ALL ON FUNCTION public.guard_manual_unmatch() TO authenticated;
GRANT ALL ON FUNCTION public.guard_manual_unmatch() TO service_role;


--
-- Name: FUNCTION guard_signal_block(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_signal_block() FROM PUBLIC;
GRANT ALL ON FUNCTION public.guard_signal_block() TO authenticated;
GRANT ALL ON FUNCTION public.guard_signal_block() TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_admin() TO anon;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION issue_event_gatt_token(p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.issue_event_gatt_token(p_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.issue_event_gatt_token(p_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.issue_event_gatt_token(p_event_id uuid) TO service_role;


--
-- Name: TABLE event_attendees; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_attendees TO anon;
GRANT ALL ON TABLE public.event_attendees TO authenticated;
GRANT ALL ON TABLE public.event_attendees TO service_role;


--
-- Name: FUNCTION join_event(p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.join_event(p_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.join_event(p_event_id uuid) TO anon;
GRANT ALL ON FUNCTION public.join_event(p_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.join_event(p_event_id uuid) TO service_role;


--
-- Name: FUNCTION leave_event(p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.leave_event(p_event_id uuid) TO anon;
GRANT ALL ON FUNCTION public.leave_event(p_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.leave_event(p_event_id uuid) TO service_role;


--
-- Name: FUNCTION link_external_event(p_ext_id uuid, p_nearify_event_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.link_external_event(p_ext_id uuid, p_nearify_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.link_external_event(p_ext_id uuid, p_nearify_event_id uuid) TO service_role;


--
-- Name: FUNCTION notify_send_message_push(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_send_message_push() TO anon;
GRANT ALL ON FUNCTION public.notify_send_message_push() TO authenticated;
GRANT ALL ON FUNCTION public.notify_send_message_push() TO service_role;


--
-- Name: FUNCTION prune_contact_disclosures(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.prune_contact_disclosures() FROM PUBLIC;
GRANT ALL ON FUNCTION public.prune_contact_disclosures() TO authenticated;
GRANT ALL ON FUNCTION public.prune_contact_disclosures() TO service_role;


--
-- Name: FUNCTION record_ghost_connection(p_event_id uuid, p_ghost_token text, p_target_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_ghost_connection(p_event_id uuid, p_ghost_token text, p_target_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_ghost_connection(p_event_id uuid, p_ghost_token text, p_target_profile_id uuid) TO anon;
GRANT ALL ON FUNCTION public.record_ghost_connection(p_event_id uuid, p_ghost_token text, p_target_profile_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.record_ghost_connection(p_event_id uuid, p_ghost_token text, p_target_profile_id uuid) TO service_role;


--
-- Name: FUNCTION register_push_installation(p_token text, p_install_id uuid, p_install_secret text, p_environment text, p_app_version text, p_device_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.register_push_installation(p_token text, p_install_id uuid, p_install_secret text, p_environment text, p_app_version text, p_device_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.register_push_installation(p_token text, p_install_id uuid, p_install_secret text, p_environment text, p_app_version text, p_device_name text) TO service_role;
GRANT ALL ON FUNCTION public.register_push_installation(p_token text, p_install_id uuid, p_install_secret text, p_environment text, p_app_version text, p_device_name text) TO authenticated;


--
-- Name: FUNCTION release_push_installation(p_install_id uuid, p_install_secret text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.release_push_installation(p_install_id uuid, p_install_secret text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.release_push_installation(p_install_id uuid, p_install_secret text) TO service_role;
GRANT ALL ON FUNCTION public.release_push_installation(p_install_id uuid, p_install_secret text) TO authenticated;


--
-- Name: FUNCTION resolve_event_gatt_token(p_event_id uuid, p_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resolve_event_gatt_token(p_event_id uuid, p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_event_gatt_token(p_event_id uuid, p_token text) TO authenticated;
GRANT ALL ON FUNCTION public.resolve_event_gatt_token(p_event_id uuid, p_token text) TO service_role;


--
-- Name: FUNCTION revoke_event_gatt_token_on_attendance_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.revoke_event_gatt_token_on_attendance_change() TO anon;
GRANT ALL ON FUNCTION public.revoke_event_gatt_token_on_attendance_change() TO authenticated;
GRANT ALL ON FUNCTION public.revoke_event_gatt_token_on_attendance_change() TO service_role;


--
-- Name: FUNCTION revoke_my_event_gatt_tokens(p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.revoke_my_event_gatt_tokens(p_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revoke_my_event_gatt_tokens(p_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.revoke_my_event_gatt_tokens(p_event_id uuid) TO service_role;


--
-- Name: FUNCTION save_account_qr_connection(p_event_id uuid, p_target_profile_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_account_qr_connection(p_event_id uuid, p_target_profile_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_account_qr_connection(p_event_id uuid, p_target_profile_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.save_account_qr_connection(p_event_id uuid, p_target_profile_id uuid) TO service_role;


--
-- Name: FUNCTION save_guest_to_guest_connection(p_event_id uuid, p_from_ghost_id uuid, p_from_ghost_token text, p_target_share_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_guest_to_guest_connection(p_event_id uuid, p_from_ghost_id uuid, p_from_ghost_token text, p_target_share_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_guest_to_guest_connection(p_event_id uuid, p_from_ghost_id uuid, p_from_ghost_token text, p_target_share_code text) TO anon;
GRANT ALL ON FUNCTION public.save_guest_to_guest_connection(p_event_id uuid, p_from_ghost_id uuid, p_from_ghost_token text, p_target_share_code text) TO authenticated;
GRANT ALL ON FUNCTION public.save_guest_to_guest_connection(p_event_id uuid, p_from_ghost_id uuid, p_from_ghost_token text, p_target_share_code text) TO service_role;


--
-- Name: FUNCTION save_nearify_person(p_other uuid, p_event uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_nearify_person(p_other uuid, p_event uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_nearify_person(p_other uuid, p_event uuid) TO authenticated;
GRANT ALL ON FUNCTION public.save_nearify_person(p_other uuid, p_event uuid) TO service_role;


--
-- Name: FUNCTION set_app_private_config_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_app_private_config_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_app_private_config_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_app_private_config_updated_at() TO service_role;


--
-- Name: FUNCTION set_conversation_reads_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_conversation_reads_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_conversation_reads_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_conversation_reads_updated_at() TO service_role;


--
-- Name: FUNCTION set_ghost_email(p_ghost_id uuid, p_ghost_token text, p_email text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_ghost_email(p_ghost_id uuid, p_ghost_token text, p_email text) TO anon;
GRANT ALL ON FUNCTION public.set_ghost_email(p_ghost_id uuid, p_ghost_token text, p_email text) TO authenticated;
GRANT ALL ON FUNCTION public.set_ghost_email(p_ghost_id uuid, p_ghost_token text, p_email text) TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION snooze_relationship(p_other_profile_id uuid, p_source_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.snooze_relationship(p_other_profile_id uuid, p_source_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.snooze_relationship(p_other_profile_id uuid, p_source_event_id uuid) TO anon;
GRANT ALL ON FUNCTION public.snooze_relationship(p_other_profile_id uuid, p_source_event_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.snooze_relationship(p_other_profile_id uuid, p_source_event_id uuid) TO service_role;


--
-- Name: FUNCTION unmatch_external_event(p_ext_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.unmatch_external_event(p_ext_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.unmatch_external_event(p_ext_id uuid) TO service_role;


--
-- Name: FUNCTION update_attendee_intent(p_event_id uuid, p_intent_primary text, p_intent_secondary text[], p_energy_level integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_attendee_intent(p_event_id uuid, p_intent_primary text, p_intent_secondary text[], p_energy_level integer) TO anon;
GRANT ALL ON FUNCTION public.update_attendee_intent(p_event_id uuid, p_intent_primary text, p_intent_secondary text[], p_energy_level integer) TO authenticated;
GRANT ALL ON FUNCTION public.update_attendee_intent(p_event_id uuid, p_intent_primary text, p_intent_secondary text[], p_energy_level integer) TO service_role;


--
-- Name: FUNCTION web_can_message(p_other uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.web_can_message(p_other uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.web_can_message(p_other uuid) TO authenticated;
GRANT ALL ON FUNCTION public.web_can_message(p_other uuid) TO service_role;


--
-- Name: FUNCTION web_can_send_to_conversation(p_conversation uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.web_can_send_to_conversation(p_conversation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.web_can_send_to_conversation(p_conversation uuid) TO authenticated;
GRANT ALL ON FUNCTION public.web_can_send_to_conversation(p_conversation uuid) TO service_role;


--
-- Name: FUNCTION web_contact_action(p_other uuid, p_action text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.web_contact_action(p_other uuid, p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.web_contact_action(p_other uuid, p_action text) TO authenticated;
GRANT ALL ON FUNCTION public.web_contact_action(p_other uuid, p_action text) TO service_role;


--
-- Name: FUNCTION web_followup_state(p_other uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.web_followup_state(p_other uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.web_followup_state(p_other uuid) TO authenticated;
GRANT ALL ON FUNCTION public.web_followup_state(p_other uuid) TO service_role;


--
-- Name: FUNCTION web_inbox(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.web_inbox() FROM PUBLIC;
GRANT ALL ON FUNCTION public.web_inbox() TO authenticated;
GRANT ALL ON FUNCTION public.web_inbox() TO service_role;


--
-- Name: FUNCTION web_inbox_badge(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.web_inbox_badge() FROM PUBLIC;
GRANT ALL ON FUNCTION public.web_inbox_badge() TO authenticated;
GRANT ALL ON FUNCTION public.web_inbox_badge() TO service_role;


--
-- Name: FUNCTION web_inbox_connection_only(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.web_inbox_connection_only() FROM PUBLIC;
GRANT ALL ON FUNCTION public.web_inbox_connection_only() TO service_role;


--
-- Name: FUNCTION web_is_conversation_member(p_conversation uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.web_is_conversation_member(p_conversation uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.web_is_conversation_member(p_conversation uuid) TO authenticated;
GRANT ALL ON FUNCTION public.web_is_conversation_member(p_conversation uuid) TO service_role;


--
-- Name: FUNCTION web_mark_read(p_conversation uuid, p_message uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.web_mark_read(p_conversation uuid, p_message uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.web_mark_read(p_conversation uuid, p_message uuid) TO authenticated;
GRANT ALL ON FUNCTION public.web_mark_read(p_conversation uuid, p_message uuid) TO service_role;


--
-- Name: FUNCTION web_open_conversation(p_other uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.web_open_conversation(p_other uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.web_open_conversation(p_other uuid) TO authenticated;
GRANT ALL ON FUNCTION public.web_open_conversation(p_other uuid) TO service_role;


--
-- Name: FUNCTION web_send_message(p_conversation uuid, p_content text, p_message_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.web_send_message(p_conversation uuid, p_content text, p_message_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.web_send_message(p_conversation uuid, p_content text, p_message_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.web_send_message(p_conversation uuid, p_content text, p_message_id uuid) TO service_role;


--
-- Name: FUNCTION web_thread(p_conversation uuid, p_before timestamp with time zone, p_before_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.web_thread(p_conversation uuid, p_before timestamp with time zone, p_before_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.web_thread(p_conversation uuid, p_before timestamp with time zone, p_before_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.web_thread(p_conversation uuid, p_before timestamp with time zone, p_before_id uuid) TO service_role;


--
-- Name: TABLE account_qr_saves; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.account_qr_saves TO service_role;


--
-- Name: TABLE admins; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admins TO service_role;


--
-- Name: TABLE ambient_event_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ambient_event_reviews TO service_role;


--
-- Name: TABLE ambient_person_feedback; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ambient_person_feedback TO service_role;


--
-- Name: TABLE analytics_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_events TO anon;
GRANT ALL ON TABLE public.analytics_events TO authenticated;
GRANT ALL ON TABLE public.analytics_events TO service_role;


--
-- Name: TABLE app_private_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_private_config TO service_role;


--
-- Name: TABLE community_signal_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_signal_preferences TO authenticated;
GRANT ALL ON TABLE public.community_signal_preferences TO service_role;


--
-- Name: TABLE community_signals; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.community_signals TO authenticated;
GRANT ALL ON TABLE public.community_signals TO service_role;


--
-- Name: TABLE connections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.connections TO anon;
GRANT ALL ON TABLE public.connections TO authenticated;
GRANT ALL ON TABLE public.connections TO service_role;


--
-- Name: TABLE contact_detail_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contact_detail_requests TO service_role;


--
-- Name: TABLE contact_disclosures; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contact_disclosures TO service_role;


--
-- Name: TABLE contact_permission_rollouts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contact_permission_rollouts TO service_role;


--
-- Name: TABLE contact_preferences_private; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contact_preferences_private TO service_role;


--
-- Name: TABLE conversation_reads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversation_reads TO authenticated;
GRANT ALL ON TABLE public.conversation_reads TO service_role;


--
-- Name: TABLE conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversations TO authenticated;
GRANT ALL ON TABLE public.conversations TO service_role;


--
-- Name: TABLE device_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.device_tokens TO anon;
GRANT ALL ON TABLE public.device_tokens TO authenticated;
GRANT ALL ON TABLE public.device_tokens TO service_role;


--
-- Name: TABLE encounters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.encounters TO anon;
GRANT ALL ON TABLE public.encounters TO authenticated;
GRANT ALL ON TABLE public.encounters TO service_role;


--
-- Name: TABLE event_discovery_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_discovery_preferences TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.event_discovery_preferences TO authenticated;


--
-- Name: TABLE event_gatt_resolve_limits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_gatt_resolve_limits TO service_role;


--
-- Name: TABLE event_gatt_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_gatt_tokens TO service_role;


--
-- Name: TABLE events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.events TO anon;
GRANT ALL ON TABLE public.events TO authenticated;
GRANT ALL ON TABLE public.events TO service_role;


--
-- Name: TABLE external_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.external_events TO anon;
GRANT ALL ON TABLE public.external_events TO authenticated;
GRANT ALL ON TABLE public.external_events TO service_role;


--
-- Name: TABLE feed_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.feed_items TO anon;
GRANT ALL ON TABLE public.feed_items TO authenticated;
GRANT ALL ON TABLE public.feed_items TO service_role;


--
-- Name: TABLE ghost_guest_connections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ghost_guest_connections TO service_role;


--
-- Name: TABLE ghost_participants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ghost_participants TO service_role;


--
-- Name: TABLE ghost_share_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ghost_share_codes TO service_role;


--
-- Name: TABLE interaction_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.interaction_events TO anon;
GRANT ALL ON TABLE public.interaction_events TO authenticated;
GRANT ALL ON TABLE public.interaction_events TO service_role;


--
-- Name: TABLE interaction_intelligence; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.interaction_intelligence TO anon;
GRANT ALL ON TABLE public.interaction_intelligence TO authenticated;
GRANT ALL ON TABLE public.interaction_intelligence TO service_role;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;


--
-- Name: TABLE person_saves; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.person_saves TO service_role;


--
-- Name: TABLE push_delivery_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.push_delivery_log TO service_role;


--
-- Name: TABLE relationship_context_private; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.relationship_context_private TO service_role;


--
-- Name: TABLE relationships; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.relationships TO anon;
GRANT ALL ON TABLE public.relationships TO authenticated;
GRANT ALL ON TABLE public.relationships TO service_role;


--
-- Name: TABLE say_hello_signals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.say_hello_signals TO anon;
GRANT ALL ON TABLE public.say_hello_signals TO authenticated;
GRANT ALL ON TABLE public.say_hello_signals TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict uHnXNCj2jDs3EhP3VBH0FcpvBcj7xrjRLG4jbu76kBZTnRPa0Y8S6GnV5Bi33G8

