-- READ ONLY. Can run against staging or production to inventory risk.
-- This script does not repair policies or revoke grants.
select schemaname, tablename, policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'event_attendees', 'event_discovery_preferences')
order by tablename, policyname;

select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as signature,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_public_event_attendees', 'get_consented_event_attendees',
    'get_my_event_discovery_preference', 'get_organizer_event_insights',
    'get_event_context', 'join_event', 'ensure_profile', 'update_attendee_intent')
order by p.proname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('profiles', 'event_attendees', 'event_discovery_preferences')
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by table_name, grantee, privilege_type;

select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in ('profiles', 'event_attendees')
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by table_name, column_name, grantee;
