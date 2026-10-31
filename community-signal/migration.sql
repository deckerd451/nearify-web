-- Community Signal: opt-in acknowledgement MVP. Apply only after review.
create table if not exists public.community_signal_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 discoverable boolean not null default false,
 receive_signals boolean not null default false,
 updated_at timestamptz not null default now()
);
create table if not exists public.community_signals (
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null references auth.users(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 constraint community_signals_no_self check (sender_id <> recipient_id),
 constraint community_signals_unique_pair unique (sender_id, recipient_id)
);
create index if not exists community_signals_recipient_idx on public.community_signals(recipient_id,created_at desc);
alter table public.community_signal_preferences enable row level security;
alter table public.community_signals enable row level security;
revoke all on public.community_signal_preferences from anon;
revoke all on public.community_signals from anon;
grant select,insert,update,delete on public.community_signal_preferences to authenticated;
grant select on public.community_signals to authenticated;
create policy "preferences_self_select" on public.community_signal_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy "preferences_self_insert" on public.community_signal_preferences for insert to authenticated with check (user_id = (select auth.uid()));
create policy "preferences_self_update" on public.community_signal_preferences for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "preferences_self_delete" on public.community_signal_preferences for delete to authenticated using (user_id = (select auth.uid()));
create policy "signals_participant_select" on public.community_signals for select to authenticated using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));
-- No client INSERT/UPDATE/DELETE policies on signals; mutations go through validated RPC.
create or replace function public.community_signal_discover()
returns table(user_id uuid, display_name text)
language sql security definer set search_path = ''
as $$
 select p.user_id, coalesce(nullif(left(trim(p.name),100),''),'Community member')::text
 from public.community_signal_preferences c
 join public.profiles p on p.user_id=c.user_id
 where c.discoverable and c.receive_signals and c.user_id <> (select auth.uid())
 order by p.name nulls last limit 50;
$$;
create or replace function public.community_signal_send(target uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare sender uuid := auth.uid(); result uuid;
begin
 if sender is null then raise exception 'Authentication required'; end if;
 if target is null or target=sender then raise exception 'Invalid recipient'; end if;
 -- Serialize requests from the same sender to enforce the daily cap under concurrency.
 perform pg_advisory_xact_lock(hashtextextended(sender::text, 2718));
 if not exists(select 1 from public.community_signal_preferences where user_id=sender and discoverable and receive_signals) then
  raise exception 'Enable Community Signal before sending';
 end if;
 if not exists(select 1 from public.community_signal_preferences where user_id=target and discoverable and receive_signals) then
  raise exception 'Recipient is not participating';
 end if;
 if (select count(*) from public.community_signals where sender_id=sender and created_at >= now()-interval '24 hours') >= 10 then
  raise exception 'Daily acknowledgement limit reached';
 end if;
 insert into public.community_signals(sender_id,recipient_id) values(sender,target)
 on conflict (sender_id,recipient_id) do nothing returning id into result;
 if result is null then
  select id into result from public.community_signals where sender_id=sender and recipient_id=target;
 end if;
 return result;
end;
$$;
revoke all on function public.community_signal_discover() from public,anon;
revoke all on function public.community_signal_send(uuid) from public,anon;
grant execute on function public.community_signal_discover() to authenticated;
grant execute on function public.community_signal_send(uuid) to authenticated;
