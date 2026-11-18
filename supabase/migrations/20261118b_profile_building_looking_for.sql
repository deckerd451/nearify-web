-- ============================================================
-- NEARIFY: "Building" and "Looking for" on profiles
--
-- Two short, optional lines a person writes about themselves so the
-- people who scan their QR have something to talk about. Both are meant
-- to be shared: they appear on the person's card for anyone who has their
-- QR link, the same audience that already sees their name and photo.
--
-- * New nullable columns; nothing existing changes. The iOS app ignores
--   them until it is updated.
-- * Writes use the existing "users can update their own profile" policy.
-- * get_public_profile_card adds the two lines to the fields
--   get_public_profile_brief already returns. get_public_profile_brief is
--   left unchanged for existing callers.
-- ============================================================
begin;

alter table public.profiles
  add column if not exists building    text,
  add column if not exists looking_for text;

alter table public.profiles drop constraint if exists profiles_building_length;
alter table public.profiles add constraint profiles_building_length
  check (building is null or char_length(building) <= 120);

alter table public.profiles drop constraint if exists profiles_looking_for_length;
alter table public.profiles add constraint profiles_looking_for_length
  check (looking_for is null or char_length(looking_for) <= 120);

comment on column public.profiles.building    is 'Optional, shared on the person''s card: what they are working on (max 120 chars).';
comment on column public.profiles.looking_for is 'Optional, shared on the person''s card: who or what they want to meet (max 120 chars).';

create or replace function public.get_public_profile_card(p_profile_id uuid)
returns table (id uuid, name text, avatar_url text, building text, looking_for text)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select p.id, p.name, p.avatar_url,
         nullif(btrim(p.building), ''),
         nullif(btrim(p.looking_for), '')
  from public.profiles p
  where p.id = p_profile_id
  limit 1;
$$;

revoke all     on function public.get_public_profile_card(uuid) from public;
grant  execute on function public.get_public_profile_card(uuid) to anon, authenticated, service_role;

commit;
