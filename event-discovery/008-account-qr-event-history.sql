-- Account QR saves need per-event evidence; relationships remains one row per pair.
-- Apply in an authorized Supabase SQL Editor BEFORE deploying the new frontend.
-- Additive. Does not create attendance or backfill events that were never recorded.
begin;

create table if not exists public.account_qr_saves (
  from_profile_id uuid not null references public.profiles(id) on delete cascade,
  to_profile_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (from_profile_id,to_profile_id,event_id),
  constraint account_qr_saves_not_self check (from_profile_id <> to_profile_id)
);
alter table public.account_qr_saves enable row level security;
revoke all on public.account_qr_saves from public,anon,authenticated;
create index if not exists account_qr_saves_target_idx
  on public.account_qr_saves(to_profile_id,from_profile_id,event_id);

create or replace function public.save_account_qr_connection(
  p_event_id uuid, p_target_profile_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
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
revoke all on function public.save_account_qr_connection(uuid,uuid) from public,anon;
grant execute on function public.save_account_qr_connection(uuid,uuid) to authenticated;

create or replace function public.get_relationship_event_history(p_other_profile_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
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
revoke all on function public.get_relationship_event_history(uuid) from public,anon;
grant execute on function public.get_relationship_event_history(uuid) to authenticated;
commit;
