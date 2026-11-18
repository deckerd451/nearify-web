-- Read-only check after running 20261118d_private_contacts_reach.sql.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'private_contacts' and column_name = 'reach') then
    raise exception 'private_contacts.reach is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.private_contacts'::regclass) then
    raise exception 'row level security is off on private_contacts';
  end if;
  raise notice 'private_contacts.reach: OK';
end $$;
