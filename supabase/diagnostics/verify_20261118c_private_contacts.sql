-- Read-only checks after running 20261118c_private_contacts.sql.
do $$
declare
  policy_count int;
  bad_policies int;
begin
  if to_regclass('public.private_contacts') is null then
    raise exception 'private_contacts is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.private_contacts'::regclass) then
    raise exception 'row level security is off on private_contacts';
  end if;
  if has_table_privilege('anon', 'public.private_contacts', 'SELECT')
     or has_table_privilege('anon', 'public.private_contacts', 'INSERT') then
    raise exception 'anon has access to private_contacts';
  end if;
  select count(*) into policy_count from pg_policies where schemaname = 'public' and tablename = 'private_contacts';
  select count(*) into bad_policies from pg_policies
   where schemaname = 'public' and tablename = 'private_contacts'
     and coalesce(qual, '') || coalesce(with_check, '') not like '%owner_user_id = auth.uid()%';
  if policy_count <> 4 or bad_policies <> 0 then
    raise exception 'expected 4 owner-only policies, found % (% not owner-only)', policy_count, bad_policies;
  end if;
  raise notice 'private_contacts: OK (owner-only, no anon access)';
end $$;
