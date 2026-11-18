-- Saved 2026-11-18. Run any time; see docs/PRIVACY_STATUS.md for the last result.
-- READ ONLY: can signed-out visitors see who is attending events?
-- Changes nothing. Each row says OK or NEEDS A LOOK.
with fn as (
  select to_regprocedure('public.get_public_event_attendees(uuid)') as oid
),
tables as (
  select t.name, to_regclass('public.' || t.name) as oid
  from (values ('event_attendees'), ('profiles')) as t(name)
)
select 'Old attendee list function (get_public_event_attendees)' as what,
       case when fn.oid is null then 'OK: not present'
            when has_function_privilege('anon', fn.oid, 'EXECUTE') then 'NEEDS A LOOK: signed-out visitors can run it'
            when has_function_privilege('authenticated', fn.oid, 'EXECUTE') then 'OK for signed-out visitors (signed-in users can still run it)'
            else 'OK: nobody can run it' end as result
from fn
union all
select 'Table: ' || tables.name,
       case when tables.oid is null then 'OK: not present'
            when not has_table_privilege('anon', tables.oid, 'SELECT') then 'OK: signed-out visitors cannot read it'
            when not (select relrowsecurity from pg_class where oid = tables.oid) then 'NEEDS A LOOK: readable by signed-out visitors, row security is off'
            when exists (select 1 from pg_policies p
                         where p.schemaname = 'public' and p.tablename = tables.name
                           and p.cmd in ('SELECT', 'ALL')
                           and (p.roles && array['anon', 'public']::name[]))
              then 'NEEDS A LOOK: a read policy applies to signed-out visitors'
            else 'OK: no read policy for signed-out visitors' end
from tables;
