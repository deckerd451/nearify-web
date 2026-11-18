-- Read-only checks after running 20261118b_profile_building_looking_for.sql.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'building') then
    raise exception 'profiles.building is missing';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'looking_for') then
    raise exception 'profiles.looking_for is missing';
  end if;
  if to_regprocedure('public.get_public_profile_card(uuid)') is null then
    raise exception 'get_public_profile_card is missing';
  end if;
  raise notice 'Building / Looking for: OK';
end $$;
