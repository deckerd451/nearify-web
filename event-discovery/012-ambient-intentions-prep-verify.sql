select 'Private intention fields installed' as check_name,count(*)=2 as passed
from information_schema.columns where table_schema='public' and table_name='relationship_context_private' and column_name in('intention','intention_completed')
union all
select 'Three new APIs authenticated-only',count(*)=3 and bool_and(has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and p.prosecdef and p.proconfig @> array['search_path=""']::text[])
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('ambient_context_save_v2','ambient_intention_complete','ambient_event_prep')
union all
select 'Consent-filtered roster API installed',to_regprocedure('public.get_consented_event_attendees(uuid)') is not null;
