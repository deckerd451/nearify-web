-- Migration 004: post-install read-only security verification.
-- Run only AFTER installing 004. No data writes.
begin read only;
with expected_tables(table_name) as (
  values ('ghost_share_codes'), ('ghost_guest_connections')
)
select t.table_name,
       c.oid is not null as exists,
       coalesce(c.relrowsecurity, false) as rls_enabled,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
       has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
       has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_insert
from expected_tables t
left join pg_catalog.pg_namespace n on n.nspname='public'
left join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=t.table_name
order by t.table_name;

with expected_functions(signature) as (
 values
 ('public.get_my_guest_share_code(uuid,uuid,text)'),
 ('public.save_guest_to_guest_connection(uuid,uuid,text,text)'),
 ('public.get_my_guest_to_guest_connections(uuid,uuid,text)')
)
select e.signature,
       p.oid is not null as exists,
       coalesce(p.prosecdef,false) as security_definer,
       coalesce(p.proconfig @> array['search_path=']::text[],false) as empty_search_path,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('public', p.oid, 'EXECUTE') as public_execute
from expected_functions e
left join pg_catalog.pg_proc p on p.oid=to_regprocedure(e.signature)
order by e.signature;
rollback;
