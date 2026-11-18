-- Removes the card function and the two columns. This deletes what people
-- wrote in Building / Looking for; export it first if you want to keep it.
begin;
drop function if exists public.get_public_profile_card(uuid);
alter table public.profiles drop constraint if exists profiles_building_length;
alter table public.profiles drop constraint if exists profiles_looking_for_length;
alter table public.profiles drop column if exists building;
alter table public.profiles drop column if exists looking_for;
commit;
