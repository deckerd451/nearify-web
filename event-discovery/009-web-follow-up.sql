-- Shared iOS/web messaging and explicit contact exchange. Apply BEFORE frontend.
-- Requires existing profiles, connections (iOS schema), events, current_profile_id().
begin;
do $$ begin
 if to_regclass('public.connections') is null then
  raise exception 'Missing iOS connections table. Apply the shared iOS connection schema first.';
 end if;
end $$;
alter table public.profiles
 add column if not exists public_email text,
 add column if not exists public_phone text,
 add column if not exists linkedin_url text,
 add column if not exists website_url text,
 add column if not exists share_email boolean default false,
 add column if not exists share_phone boolean default false,
 add column if not exists preferred_contact_method text;
-- Same table/column contracts used by nearify-ios, not a separate web inbox.
create table if not exists public.conversations (
 id uuid primary key default gen_random_uuid(),
 participant_a uuid not null references public.profiles(id),
 participant_b uuid not null references public.profiles(id),
 event_id uuid references public.events(id), event_name text,
 created_at timestamptz default now(), unique(participant_a,participant_b)
);
create table if not exists public.messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 sender_profile_id uuid not null references public.profiles(id),
 content text not null, created_at timestamptz default now()
);
create index if not exists web_messages_thread_idx on public.messages(conversation_id,created_at desc,id desc);
create table if not exists public.conversation_reads (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 last_read_at timestamptz not null default now(),
 created_at timestamptz default now(), updated_at timestamptz default now(),
 unique(conversation_id,profile_id)
);

-- Identity and approval checks are also used by restrictive RLS policies, so a
-- caller cannot skip the RPC and create/send directly through the REST API.
create or replace function public.web_can_message(p_other uuid) returns boolean
language sql stable security definer set search_path='' as $$
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
create or replace function public.web_is_conversation_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conversations c where c.id=p_conversation
 and public.current_profile_id() in (c.participant_a,c.participant_b));
$$;
create or replace function public.web_can_send_to_conversation(p_conversation uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select public.web_can_message(case when c.participant_a=public.current_profile_id() then c.participant_b else c.participant_a end)
 from public.conversations c where c.id=p_conversation and public.current_profile_id() in (c.participant_a,c.participant_b)),false);
$$;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_reads enable row level security;
drop policy if exists web_conversations_read on public.conversations;
create policy web_conversations_read on public.conversations for select to authenticated
 using (public.current_profile_id() in (participant_a,participant_b));
drop policy if exists web_conversations_create on public.conversations;
create policy web_conversations_create on public.conversations for insert to authenticated
 with check (participant_a=public.current_profile_id() and public.web_can_message(participant_b));
-- Restrictive policies AND with existing permissive iOS policies.
drop policy if exists web_conversations_member_guard on public.conversations;
create policy web_conversations_member_guard on public.conversations as restrictive for all to authenticated
 using (public.current_profile_id() in (participant_a,participant_b))
 with check (public.current_profile_id() in (participant_a,participant_b));
drop policy if exists web_conversations_approval_guard on public.conversations;
create policy web_conversations_approval_guard on public.conversations as restrictive for insert to authenticated
 with check (participant_a=public.current_profile_id() and public.web_can_message(participant_b));
drop policy if exists web_conversations_immutable on public.conversations;
create policy web_conversations_immutable on public.conversations as restrictive for update to authenticated using(false);
drop policy if exists web_conversations_no_delete on public.conversations;
create policy web_conversations_no_delete on public.conversations as restrictive for delete to authenticated using(false);
drop policy if exists web_messages_no_delete on public.messages;
create policy web_messages_no_delete on public.messages as restrictive for delete to authenticated using(false);
drop policy if exists web_messages_read on public.messages;
create policy web_messages_read on public.messages for select to authenticated using(public.web_is_conversation_member(conversation_id));
drop policy if exists web_messages_create on public.messages;
create policy web_messages_create on public.messages for insert to authenticated
 with check(sender_profile_id=public.current_profile_id() and public.web_can_send_to_conversation(conversation_id));
drop policy if exists web_messages_member_guard on public.messages;
create policy web_messages_member_guard on public.messages as restrictive for all to authenticated
 using(public.web_is_conversation_member(conversation_id))
 with check(public.web_is_conversation_member(conversation_id));
drop policy if exists web_messages_send_guard on public.messages;
create policy web_messages_send_guard on public.messages as restrictive for insert to authenticated
 with check(sender_profile_id=public.current_profile_id() and public.web_can_send_to_conversation(conversation_id)
 and length(btrim(content)) between 1 and 4000 and content ~ '[^[:space:]]');
drop policy if exists web_messages_immutable on public.messages;
create policy web_messages_immutable on public.messages as restrictive for update to authenticated using(false);
drop policy if exists web_reads_own on public.conversation_reads;
create policy web_reads_own on public.conversation_reads for all to authenticated
 using(profile_id=public.current_profile_id() and public.web_is_conversation_member(conversation_id))
 with check(profile_id=public.current_profile_id() and public.web_is_conversation_member(conversation_id));
drop policy if exists web_reads_member_guard on public.conversation_reads;
create policy web_reads_member_guard on public.conversation_reads as restrictive for all to authenticated
 using(profile_id=public.current_profile_id() and public.web_is_conversation_member(conversation_id))
 with check(profile_id=public.current_profile_id() and public.web_is_conversation_member(conversation_id));
revoke all on public.conversations,public.messages,public.conversation_reads from public,anon;
grant select,insert on public.conversations,public.messages to authenticated;
grant select,insert,update on public.conversation_reads to authenticated;

create or replace function public.web_followup_state(p_other uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id(); v_status text:='none'; v_conversation uuid; v_contact jsonb; v_own_block boolean;
begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_other=v_me then return jsonb_build_object('status','self','can_message',false); end if;
 if not exists(select 1 from public.profiles where id=p_other) then raise exception 'Person unavailable'; end if;
 if exists(select 1 from public.connections where status='blocked' and
  ((requester_profile_id=v_me and addressee_profile_id=p_other) or (requester_profile_id=p_other and addressee_profile_id=v_me))) then v_status:='blocked';
 elsif public.web_can_message(p_other) then v_status:='accepted';
 elsif exists(select 1 from public.connections where requester_profile_id=p_other and addressee_profile_id=v_me and status='pending') then v_status:='incoming';
 elsif exists(select 1 from public.connections where requester_profile_id=v_me and addressee_profile_id=p_other and status='pending') then v_status:='pending'; end if;
 select id into v_conversation from public.conversations where
 (participant_a=v_me and participant_b=p_other) or (participant_a=p_other and participant_b=v_me) order by created_at,id limit 1;
 if v_status='accepted' then
  select jsonb_build_object('name',name,'email',case when share_email then nullif(btrim(public_email),'') end,
   'phone',case when share_phone then nullif(btrim(public_phone),'') end,
   'linkedin',nullif(btrim(linkedin_url),''),'website',nullif(btrim(website_url),''),'preferred',preferred_contact_method)
  into v_contact from public.profiles where id=p_other;
 end if;
 select exists(select 1 from public.connections where requester_profile_id=v_me and addressee_profile_id=p_other and status='blocked') into v_own_block;
 return jsonb_build_object('status',v_status,'can_message',v_status='accepted','conversation_id',v_conversation,'contact',v_contact,'blocked_by_you',v_own_block);
end; $$;

create or replace function public.web_contact_action(p_other uuid,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
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

create or replace function public.web_open_conversation(p_other uuid) returns uuid
language plpgsql security definer set search_path='' as $$
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

create or replace function public.web_inbox() returns jsonb
language plpgsql stable security definer set search_path='' as $$
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

create or replace function public.web_thread(p_conversation uuid,p_before timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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

create or replace function public.web_send_message(p_conversation uuid,p_content text,p_message_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
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

create or replace function public.web_mark_read(p_conversation uuid,p_message uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id(); v_at timestamptz;
begin
 if not public.web_is_conversation_member(p_conversation) then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 select created_at into v_at from public.messages where conversation_id=p_conversation and id=p_message;
 if v_at is null then raise exception 'Message unavailable'; end if;
 insert into public.conversation_reads(conversation_id,profile_id,last_read_at) values(p_conversation,v_me,v_at)
 on conflict(conversation_id,profile_id) do update set last_read_at=greatest(public.conversation_reads.last_read_at,excluded.last_read_at),updated_at=now();
end; $$;
create or replace function public.web_inbox_badge() returns integer
language sql stable security definer set search_path='' as $$
 select (select count(*) from jsonb_array_elements(data->'threads') t where (t->>'unread')::boolean)::integer
      + jsonb_array_length(data->'requests')
 from (select public.web_inbox() as data) inbox;
$$;
-- All web RPCs and policy helpers are authenticated-only. Nothing exposes login email.
do $$ declare v_signature text; begin
 foreach v_signature in array array[
 'web_can_message(uuid)','web_is_conversation_member(uuid)','web_can_send_to_conversation(uuid)',
 'web_followup_state(uuid)','web_contact_action(uuid,text)','web_open_conversation(uuid)','web_inbox()',
 'web_inbox_badge()','web_thread(uuid,timestamp with time zone,uuid)','web_send_message(uuid,text,uuid)','web_mark_read(uuid,uuid)'
 ] loop
  execute 'revoke all on function public.'||v_signature||' from public,anon';
  execute 'grant execute on function public.'||v_signature||' to authenticated';
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
