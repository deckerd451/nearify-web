select 'Private context table has RLS and denies direct client access' as check_name,
 exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='relationship_context_private' and c.relrowsecurity)
 and not has_table_privilege('authenticated','public.relationship_context_private','SELECT,INSERT,UPDATE,DELETE')
 and not has_table_privilege('anon','public.relationship_context_private','SELECT,INSERT,UPDATE,DELETE') as passed
union all
select 'Four context APIs authenticated-only',count(*)=4 and bool_and(
 has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE')
 and p.prosecdef and p.proconfig @> array['search_path=""']::text[])
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in('ambient_context','ambient_context_save','ambient_contexts','ambient_context_snooze');
