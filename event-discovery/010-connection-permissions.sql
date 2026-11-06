-- Connection approval permits Nearify messaging. Personal details require a
-- separate directional disclosure. Apply after 009; see release notes.
begin;
create table if not exists public.contact_preferences_private (
 profile_id uuid primary key references public.profiles(id) on delete cascade deferrable initially deferred,
 email text,phone text,linkedin text,website text,
 allow_email boolean not null default false,allow_phone boolean not null default false,
 preferred text default 'nearify',updated_at timestamptz not null default now()
);
create table if not exists public.contact_disclosures (
 owner_id uuid not null references public.profiles(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 details jsonb not null default '{}',source text not null default 'explicit',
 shared_at timestamptz not null default now(),revoked_at timestamptz,
 primary key(owner_id,recipient_id),check(owner_id<>recipient_id)
);
create table if not exists public.contact_detail_requests (
 requester_id uuid not null references public.profiles(id) on delete cascade,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in('pending','fulfilled','ignored')),
 created_at timestamptz not null default now(),primary key(requester_id,owner_id),check(requester_id<>owner_id)
);
create table if not exists public.person_saves (
 owner_id uuid not null references public.profiles(id) on delete cascade,
 person_id uuid not null references public.profiles(id) on delete cascade,
 saved_at timestamptz not null default now(),primary key(owner_id,person_id),check(owner_id<>person_id)
);
create table if not exists public.contact_permission_rollouts(id text primary key,applied_at timestamptz not null default now());
alter table public.contact_preferences_private enable row level security;
alter table public.contact_disclosures enable row level security;
alter table public.contact_detail_requests enable row level security;
alter table public.person_saves enable row level security;
alter table public.contact_permission_rollouts enable row level security;
revoke all on public.contact_preferences_private,public.contact_disclosures,public.contact_detail_requests,public.person_saves,public.contact_permission_rollouts from public,anon,authenticated;

-- One-time preservation of existing access. Do not create grants on future
-- acceptance, and never restore a revoked grant when this migration is rerun.
do $$ declare v_new text; begin
 insert into public.contact_permission_rollouts(id) values('separate-details-v1') on conflict do nothing returning id into v_new;
 if v_new is not null then
  insert into public.contact_preferences_private(profile_id,email,phone,linkedin,website,allow_email,allow_phone,preferred)
  select id,nullif(btrim(public_email),''),nullif(btrim(public_phone),''),nullif(btrim(linkedin_url),''),nullif(btrim(website_url),''),coalesce(share_email,false),coalesce(share_phone,false),preferred_contact_method from public.profiles
  on conflict do nothing;
  insert into public.contact_disclosures(owner_id,recipient_id,details,source)
  select distinct p.profile_id,other.id,jsonb_strip_nulls(jsonb_build_object(
   'email',case when p.allow_email then p.email end,'phone',case when p.allow_phone then p.phone end,
   'linkedin',p.linkedin,'website',p.website,'preferred',p.preferred)),'legacy_accepted'
  from public.connections c join public.contact_preferences_private p on p.profile_id in(c.requester_profile_id,c.addressee_profile_id)
  join public.profiles other on other.id=case when p.profile_id=c.requester_profile_id then c.addressee_profile_id else c.requester_profile_id end
  where c.status='accepted' and p.profile_id<>other.id and not exists(select 1 from public.connections b where b.status='blocked' and
   ((b.requester_profile_id=p.profile_id and b.addressee_profile_id=other.id) or (b.requester_profile_id=other.id and b.addressee_profile_id=p.profile_id)))
  on conflict do nothing;
 end if;
end $$;
-- Clear only the designated sharing fields, never identity/bio or login email.
-- Ordinary profile reads (including old iOS builds) can no longer bypass consent.
update public.profiles set public_email=null,public_phone=null,linkedin_url=null,website_url=null,share_email=false,share_phone=false,preferred_contact_method=null
where public_email is not null or public_phone is not null or linkedin_url is not null or website_url is not null or coalesce(share_email,false) or coalesce(share_phone,false) or preferred_contact_method is not null;
create or replace function public.capture_private_contact_preferences() returns trigger
language plpgsql security definer set search_path='' as $$
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
drop trigger if exists private_contact_preferences on public.profiles;
create trigger private_contact_preferences before insert or update of public_email,public_phone,linkedin_url,website_url,share_email,share_phone,preferred_contact_method
 on public.profiles for each row execute function public.capture_private_contact_preferences();

-- Turning off availability removes that field from future reads of existing
-- disclosures, but changing a value never silently publishes the new value.
create or replace function public.prune_contact_disclosures() returns trigger
language plpgsql security definer set search_path='' as $$
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
drop trigger if exists prune_contact_disclosures on public.contact_preferences_private;
create trigger prune_contact_disclosures after insert or update on public.contact_preferences_private for each row execute function public.prune_contact_disclosures();
create or replace function public.contact_owner_preferences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();v_result jsonb;
begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 select to_jsonb(p)-'profile_id'-'updated_at' into v_result from public.contact_preferences_private p where profile_id=v_me;
 return coalesce(v_result,jsonb_build_object('allow_email',false,'allow_phone',false,'preferred','nearify'));
end $$;
create or replace function public.contact_save_preferences(p_email text,p_phone text,p_linkedin text,p_website text,p_allow_email boolean,p_allow_phone boolean,p_preferred text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();begin
 if v_me is null then raise exception 'Sign in required' using errcode='42501';end if;
 if greatest(length(coalesce(p_email,'')),length(coalesce(p_phone,'')),length(coalesce(p_linkedin,'')),length(coalesce(p_website,'')))>2000 or coalesce(p_preferred,'nearify') not in('nearify','email','phone','linkedin') then raise exception 'Invalid contact preferences';end if;
 insert into public.contact_preferences_private(profile_id,email,phone,linkedin,website,allow_email,allow_phone,preferred)
 values(v_me,nullif(btrim(p_email),''),nullif(btrim(p_phone),''),nullif(btrim(p_linkedin),''),nullif(btrim(p_website),''),coalesce(p_allow_email,false),coalesce(p_allow_phone,false),coalesce(p_preferred,'nearify'))
 on conflict(profile_id) do update set email=excluded.email,phone=excluded.phone,linkedin=excluded.linkedin,website=excluded.website,allow_email=excluded.allow_email,allow_phone=excluded.allow_phone,preferred=excluded.preferred,updated_at=now();
 return public.contact_owner_preferences();
end $$;
create or replace function public.web_followup_state(p_other uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
create or replace function public.contact_details_action(p_other uuid,p_action text,p_fields text[] default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
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
-- Keep connection invitations and personal-detail requests separate in inboxes.
do $$ begin
 if to_regprocedure('public.web_inbox_connection_only()') is null then
  alter function public.web_inbox() rename to web_inbox_connection_only;
 end if;
end $$;
revoke all on function public.web_inbox_connection_only() from public,anon,authenticated;
create or replace function public.web_inbox() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();v_result jsonb;v_requests jsonb;begin
 v_result:=public.web_inbox_connection_only();
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_requests from(
  select r.requester_id as profile_id,p.name from public.contact_detail_requests r join public.profiles p on p.id=r.requester_id
  where r.owner_id=v_me and r.status='pending' and public.web_can_message(r.requester_id) order by r.created_at desc limit 100
 ) t;
 return v_result||jsonb_build_object('permission_version',2,'detail_requests',v_requests);
end $$;
create or replace function public.web_inbox_badge() returns integer
language sql stable security definer set search_path='' as $$
 select (select count(*) from jsonb_array_elements(data->'threads') t where (t->>'unread')::boolean)::integer
  +jsonb_array_length(data->'requests')+jsonb_array_length(data->'detail_requests') from(select public.web_inbox() as data) inbox;
$$;
revoke all on function public.web_inbox() from public,anon;
grant execute on function public.web_inbox() to authenticated;
-- Call v1 only for connection invitation/approval/block actions. It no longer
-- releases profile contact fields because web_followup_state now reads grants.

-- Community Signal IDs are auth.users IDs. Resolve them server-side to profile
-- identity; mutual acknowledgement alone never creates an accepted connection.
create or replace function public.community_signal_connection(p_target_user uuid,p_invite boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
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

create or replace function public.community_signal_discover_v2()
returns table(user_id uuid,display_name text,work_context text)
language sql stable security definer set search_path='' as $$
 select p.user_id,coalesce(nullif(left(btrim(p.name),100),''),'Community member'),nullif(left(btrim(coalesce(to_jsonb(p)->>'bio','')),220),'')
 from public.profiles p join public.community_signal_preferences pref on pref.user_id=p.user_id
 where pref.discoverable and pref.receive_signals and p.user_id<>auth.uid()
 and exists(select 1 from public.community_signal_preferences where user_id=auth.uid() and discoverable and receive_signals)
 and not exists(select 1 from public.connections b where b.status='blocked' and
  ((b.requester_profile_id=public.current_profile_id() and b.addressee_profile_id=p.id)or(b.addressee_profile_id=public.current_profile_id() and b.requester_profile_id=p.id)))
 order by p.name nulls last limit 50;
$$;
create or replace function public.get_saved_people() returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
create or replace function public.save_nearify_person(p_other uuid,p_event uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_me uuid:=public.current_profile_id();begin
 if v_me is null or v_me=p_other then raise exception 'Invalid person' using errcode='42501';end if;
 if not exists(select 1 from public.profiles where id=p_other) then raise exception 'Person unavailable';end if;
 if exists(select 1 from public.connections where status='blocked' and ((requester_profile_id=v_me and addressee_profile_id=p_other)or(requester_profile_id=p_other and addressee_profile_id=v_me))) then raise exception 'Person unavailable' using errcode='42501';end if;
 if p_event is not null then perform public.save_account_qr_connection(p_event,p_other);end if;
 insert into public.person_saves(owner_id,person_id) values(v_me,p_other) on conflict do nothing;
 return jsonb_build_object('saved',true,'can_message',public.web_can_message(p_other));
end $$;
-- Prevent legacy clients turning a unilateral QR save into accepted messaging.
create or replace function public.guard_connection_approval() returns trigger
language plpgsql security definer set search_path='' as $$
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
drop trigger if exists connection_approval_guard on public.connections;
create trigger connection_approval_guard before insert or update on public.connections for each row execute function public.guard_connection_approval();
-- A block also prevents new acknowledgement signals, including calls through
-- the earlier Community Signal RPC. Existing history is retained.
create or replace function public.guard_signal_block() returns trigger
language plpgsql security definer set search_path='' as $$
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
drop trigger if exists community_signal_block_guard on public.community_signals;
create trigger community_signal_block_guard before insert on public.community_signals for each row execute function public.guard_signal_block();
-- RPCs are the only public entry points for private data or save state.
do $$ declare v_sig text;begin
 foreach v_sig in array array['guard_signal_block()','capture_private_contact_preferences()','prune_contact_disclosures()','guard_connection_approval()','contact_owner_preferences()','contact_save_preferences(text,text,text,text,boolean,boolean,text)','contact_details_action(uuid,text,text[])','community_signal_connection(uuid,boolean)','community_signal_discover_v2()','get_saved_people()','save_nearify_person(uuid,uuid)'] loop
  execute 'revoke all on function public.'||v_sig||' from public,anon';
 end loop;
 foreach v_sig in array array['contact_owner_preferences()','contact_save_preferences(text,text,text,text,boolean,boolean,text)','contact_details_action(uuid,text,text[])','community_signal_connection(uuid,boolean)','community_signal_discover_v2()','get_saved_people()','save_nearify_person(uuid,uuid)'] loop
  execute 'grant execute on function public.'||v_sig||' to authenticated';
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
