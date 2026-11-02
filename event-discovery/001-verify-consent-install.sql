-- Read-only post-install verification for migration 001.
-- Run after installing the additive migration.
select to_regclass('public.event_discovery_preferences') is not null as preference_table_present,
       to_regprocedure('public.get_my_event_discovery_preference(uuid)') is not null as own_preference_rpc_present,
       to_regprocedure('public.get_consented_event_attendees(uuid)') is not null as consented_roster_rpc_present,
       to_regprocedure('public.get_organizer_event_insights(uuid)') is not null as organizer_insights_rpc_present;

select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('get_my_event_discovery_preference','get_consented_event_attendees',
  'get_organizer_event_insights','get_public_event_attendees')
order by p.proname;

select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname='public'
and tablename='event_discovery_preferences' order by policyname;
