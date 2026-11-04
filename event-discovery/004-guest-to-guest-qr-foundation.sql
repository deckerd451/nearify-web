-- Guest-to-guest QR foundation, additive only.
-- REVIEW BEFORE EXECUTING IN SUPABASE SQL EDITOR.
-- Never put ghost_token in a QR or shared URL.
-- No existing functions, tables, policies or grants are replaced.
begin;

create table if not exists public.ghost_share_codes (
  ghost_id uuid primary key references public.ghost_participants(id) on delete cascade,
  share_code text not null unique,
  created_at timestamptz not null default now()
);
alter table public.ghost_share_codes enable row level security;
revoke all on public.ghost_share_codes from public, anon, authenticated;

create table if not exists public.ghost_guest_connections (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  from_ghost_id uuid not null references public.ghost_participants(id) on delete cascade,
  to_ghost_id uuid not null references public.ghost_participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint ghost_guest_connections_no_self check (from_ghost_id <> to_ghost_id),
  constraint ghost_guest_connections_unique unique (from_ghost_id, to_ghost_id)
);
create index if not exists ghost_guest_connections_to_idx on public.ghost_guest_connections(to_ghost_id);
alter table public.ghost_guest_connections enable row level security;
revoke all on public.ghost_guest_connections from public, anon, authenticated;

-- Private credential is passed only in RPC body. Share code is public,
-- random, scoped to the event, and reveals no roster or account identifier.
create or replace function public.get_my_guest_share_code(
  p_event_id uuid, p_ghost_id uuid, p_ghost_token text
) returns text
language plpgsql security definer set search_path = ''
as $$
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

create or replace function public.save_guest_to_guest_connection(
  p_event_id uuid, p_from_ghost_id uuid, p_from_ghost_token text, p_target_share_code text
) returns boolean
language plpgsql security definer set search_path = ''
as $$
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

-- Only the caller's outgoing scans. A scanned QR is not permission to
-- enumerate the target's other connections, private token, or profile.
create or replace function public.get_my_guest_to_guest_connections(
  p_event_id uuid, p_ghost_id uuid, p_ghost_token text
) returns table (connection_id uuid, guest_name text, connected_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
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

revoke all on function public.get_my_guest_share_code(uuid, uuid, text) from public;
revoke all on function public.save_guest_to_guest_connection(uuid, uuid, text, text) from public;
revoke all on function public.get_my_guest_to_guest_connections(uuid, uuid, text) from public;
grant execute on function public.get_my_guest_share_code(uuid, uuid, text) to anon, authenticated;
grant execute on function public.save_guest_to_guest_connection(uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.get_my_guest_to_guest_connections(uuid, uuid, text) to anon, authenticated;
commit;
