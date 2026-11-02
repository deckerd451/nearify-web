-- Nearify privacy cutover CANDIDATE. Do not run without verified restore
-- and explicit production execution approval. Exact policy inventory required.
-- This file intentionally contains no DROP/ALTER/REVOKE actions.
--
-- Execute these checks read-only before drafting the final cutover.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname='public' and tablename in ('profiles','event_attendees')
order by tablename, policyname;

select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
('get_public_event_attendees','get_consented_event_attendees','get_event_context',
'join_event','ensure_profile','update_attendee_intent')
order by p.proname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name in ('profiles','event_attendees')
order by table_name, grantee, privilege_type;
