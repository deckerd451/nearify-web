select 'Two feedback tables private with RLS' as check_name,count(*)=2 and bool_and(c.relrowsecurity and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) as passed
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('ambient_person_feedback','ambient_event_reviews')
union all
select 'Four new APIs authenticated-only',count(*)=4 and bool_and(p.prosecdef and p.proconfig @> array['search_path=""']::text[] and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE'))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('ambient_person_dismiss','ambient_review_record','ambient_review_action','ambient_home_extras');
