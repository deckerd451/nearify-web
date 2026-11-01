-- READ-ONLY PREFLIGHT. Safe to review; do not confuse with the lockdown itself.
-- Run in staging first; compare output with production before any DDL.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
  ('profiles', 'event_attendees', 'event_discovery_preferences', 'events')
order by c.relname;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'event_attendees', 'event_discovery_preferences', 'events')
order by tablename, policyname;

select routine_schema, routine_name, specific_name, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'get_public_event_attendees', 'get_consented_event_attendees',
    'get_my_event_discovery_preference', 'get_organizer_event_insights',
    'get_event_context', 'update_attendee_intent', 'join_event', 'ensure_profile'
  )
order by routine_name;

select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as signature,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'get_public_event_attendees', 'get_consented_event_attendees',
    'get_my_event_discovery_preference', 'get_organizer_event_insights',
    'get_event_context', 'update_attendee_intent', 'join_event', 'ensure_profile'
  )
order by p.proname;

select table_name, column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'event_attendees', 'events', 'event_discovery_preferences')
order by table_name, ordinal_position;
