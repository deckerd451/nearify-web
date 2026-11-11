-- Guest-first discovery: read-only authorization inventory.
-- Run manually in Supabase SQL Editor (staging first).
-- This inspects grants and RLS configuration; it does NOT simulate
-- authenticated/anonymous JWTs or prove effective row-level isolation.
-- Do not run migrations or alter grants based on this output alone.
begin read only;

-- 1. Direct table access. A true grant is not proof rows are visible:
-- RLS may still restrict access. A false grant is a stronger boundary.
with targets(name) as (values
 ('profiles'),('event_attendees'),('event_discovery_preferences'),
 ('ghost_sessions'),('ghost_share_codes'),('ghost_guest_connections'),
 ('connections'),('ambient_person_feedback')
)
select t.name as table_name, c.oid is not null as exists_in_public,
       coalesce(c.relrowsecurity,false) as rls_enabled,
       case when c.oid is null then null else has_table_privilege('anon',c.oid,'SELECT') end as anon_select_granted,
       case when c.oid is null then null else has_table_privilege('authenticated',c.oid,'SELECT') end as authenticated_select_granted
from targets t
left join pg_namespace n on n.nspname='public'
left join pg_class c on c.relnamespace=n.oid and c.relname=t.name
order by t.name;

-- 2. Inspect policies; reviewers must assess predicates, not just RLS flags.
select tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies
where schemaname='public'
  and tablename in ('profiles','event_attendees','event_discovery_preferences',
                    'ghost_sessions','ghost_share_codes','ghost_guest_connections',
                    'connections','ambient_person_feedback')
order by tablename,policyname;

-- 3. Public callable RPCs: pay particular attention to legacy roster access.
with targets(signature) as (values
 ('public.get_public_event_attendees(uuid)'),
 ('public.get_consented_event_attendees(uuid)'),
 ('public.get_event_connection_people(uuid)'),
 ('public.get_my_event_discovery_preference(uuid)'),
 ('public.get_my_guest_share_code(uuid,uuid,text)'),
 ('public.save_guest_to_guest_connection(uuid,uuid,text,text)'),
 ('public.get_my_guest_to_guest_connections(uuid,uuid,text)')
)
select t.signature,p.oid is not null as exists_in_public,
       coalesce(p.prosecdef,false) as security_definer,
       case when p.oid is null then null else has_function_privilege('anon',p.oid,'EXECUTE') end as anon_execute,
       case when p.oid is null then null else has_function_privilege('authenticated',p.oid,'EXECUTE') end as authenticated_execute,
       case when p.oid is null then null else exists (
         select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
         where a.grantee=0 and a.privilege_type='EXECUTE'
       ) end as public_execute
from targets t left join pg_proc p on p.oid=to_regprocedure(t.signature)
order by t.signature;

-- 4. List *all* roster/guest/consent-related overloads; a signature
-- mismatch above must not be mistaken for absence of a callable RPC.
select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and (p.proname ilike '%attendee%' or p.proname ilike '%discover%'
       or p.proname ilike '%ghost%' or p.proname ilike '%connection_people%')
order by p.proname,arguments;

rollback;
