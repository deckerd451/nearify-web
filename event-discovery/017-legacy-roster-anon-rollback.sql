-- EMERGENCY ROLLBACK for 017 ONLY; restores previously observed anon grant.
-- Run only if release verification identifies a confirmed dependency regression.
-- This reopens the known privacy risk; coordinate immediate follow-up.
begin;
do $guard$
begin
 if to_regprocedure('public.get_public_event_attendees(uuid)') is null then
   raise exception 'Legacy roster RPC not found; stop and inspect';
 end if;
end $guard$;
grant execute on function public.get_public_event_attendees(uuid) to anon;
commit;
