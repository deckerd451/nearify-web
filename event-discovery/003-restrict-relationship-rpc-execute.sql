-- Apply in Supabase SQL Editor after merging this PR.
-- SECURITY DEFINER relationship RPCs should not be executable by anon.
-- PUBLIC grants are inherited by anon, so revoke from PUBLIC too.
begin;

do $$
begin
  if to_regprocedure('public.get_my_connections(text)') is null then
    raise exception 'Expected get_my_connections(text) not found';
  end if;
  if to_regprocedure('public.get_relationship_context(uuid)') is null then
    raise exception 'Expected get_relationship_context(uuid) not found';
  end if;
  if to_regprocedure('public.get_public_profile_brief(uuid)') is null then
    raise exception 'Expected public profile brief not found';
  end if;
end $$;

revoke execute on function public.get_my_connections(text)
  from public, anon;
revoke execute on function public.get_relationship_context(uuid)
  from public, anon;

grant execute on function public.get_my_connections(text)
  to authenticated;
grant execute on function public.get_relationship_context(uuid)
  to authenticated;

-- get_public_profile_brief(uuid) remains accessible to anonymous profile viewers.

commit;

-- Expected: anon=false, authenticated=true for the first two.
select p.proname,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
('get_my_connections','get_relationship_context','get_public_profile_brief')
order by p.proname;
