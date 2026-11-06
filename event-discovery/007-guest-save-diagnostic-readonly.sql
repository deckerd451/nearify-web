-- Read-only schema/grant metadata for an authorized Supabase SQL-admin context.
-- No user rows, tokens, function bodies, mutations, or write RPC calls.
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result_type,
       p.prosecdef as security_definer,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('record_ghost_connection','get_ghost_connection_history','create_ghost_participant')
order by p.proname,arguments;

select column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public' and table_name='interaction_events'
order by ordinal_position;

select c.conname as constraint_name,c.contype as constraint_type,
       pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid=to_regclass('public.interaction_events')
order by c.conname;

select indexname,indexdef
from pg_indexes
where schemaname='public' and tablename='interaction_events'
order by indexname;
