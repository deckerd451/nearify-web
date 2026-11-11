-- Read-only permission verification; safe to run before/after candidate 018.
begin read only;
select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
       exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
              where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
('get_public_event_attendees','get_consented_event_attendees','get_event_connection_people',
 'get_my_event_discovery_preference','record_ghost_connection','create_ghost_participant')
order by p.proname,arguments;
rollback;
