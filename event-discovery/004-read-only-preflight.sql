-- Migration 004 read-only production preflight.
-- Run this FIRST in Supabase SQL Editor; it changes nothing.
-- A failed assertion means DO NOT run 004.
begin read only;
do $$
declare v_missing text;
begin
  select string_agg(req.item, ', ' order by req.item) into v_missing
  from (values
    ('public.events.id', 'events', 'id'),
    ('public.ghost_participants.id', 'ghost_participants', 'id'),
    ('public.ghost_participants.event_id', 'ghost_participants', 'event_id'),
    ('public.ghost_participants.ghost_token', 'ghost_participants', 'ghost_token'),
    ('public.ghost_participants.claimed_by_profile_id', 'ghost_participants', 'claimed_by_profile_id'),
    ('public.ghost_participants.display_name', 'ghost_participants', 'display_name')
  ) as req(item, table_name, column_name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = req.table_name
      and c.column_name = req.column_name
  );
  if v_missing is not null then
    raise exception '004 BLOCKED: missing schema columns: %', v_missing;
  end if;

  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('ghost_share_codes','ghost_guest_connections')
  ) then
    raise exception '004 BLOCKED: one or both guest QR tables already exist; inspect schema before running';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'get_my_guest_share_code','save_guest_to_guest_connection',
      'get_my_guest_to_guest_connections'
    )
  ) then
    raise exception '004 BLOCKED: guest QR RPC name already exists; inspect before replacing';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pg_catalog' and p.proname = 'gen_random_uuid'
  ) then
    raise exception '004 BLOCKED: pg_catalog.gen_random_uuid() unavailable';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'ghost_participants'
      and c.contype = 'p'
  ) then
    raise exception '004 BLOCKED: ghost_participants lacks primary key';
  end if;
  raise notice '004 structural preflight PASSED. This does not prove runtime permissions or migration success.';
end $$;
select current_database() as database_name, current_user as executor,
       to_regclass('public.ghost_participants') as ghost_table,
       to_regclass('public.events') as events_table;
rollback;
