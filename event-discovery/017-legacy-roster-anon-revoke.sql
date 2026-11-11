-- CANDIDATE ONLY. Do not run before web + iOS compatibility and API checks.
-- Restricts anonymous access to the legacy attendee roster without changing
-- guest QR/check-in RPCs or authenticated clients.
-- This does NOT fix authenticated legacy roster consent bypass or table RLS.
begin;
do $guard$
begin
 if to_regprocedure('public.get_public_event_attendees(uuid)') is null then
   raise exception 'Legacy roster RPC not found; stop and inspect';
 end if;
 if to_regprocedure('public.get_consented_event_attendees(uuid)') is null then
   raise exception 'Consented roster RPC missing; stop and inspect';
 end if;
end $guard$;
-- Revoke PUBLIC first: a grant inherited via PUBLIC defeats a role-only revoke.
revoke execute on function public.get_public_event_attendees(uuid) from public, anon;
-- Preserve authenticated permission pending separate iOS compatibility review.
commit;
