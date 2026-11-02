-- Read-only compatibility and exposure audit for profile and connections pages.
-- Run in Supabase SQL Editor BEFORE executing 002-owner-only-select-cutover.sql.
-- Paste output for review; SECURITY DEFINER is not automatically safe.

select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'get_public_profile_brief',
    'get_my_connections',
    'get_relationship_context',
    'confirm_relationship',
    'get_public_event_attendees'
  )
order by p.proname, arguments;

-- Review function bodies for direct reads of profiles, attendance,
-- relationship data, privacy flags, and caller authorization.
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'get_public_profile_brief',
    'get_my_connections',
    'get_relationship_context'
  )
order by p.proname, arguments;
