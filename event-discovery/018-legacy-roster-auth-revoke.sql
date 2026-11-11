-- PRODUCTION CANDIDATE ONLY. Not applied by merging this file.
-- After 017, remove the remaining authenticated execute grant from the
-- legacy attendee roster. Consent-based discovery RPCs remain unchanged.
-- Preconditions: current and supported deployed clients have been checked,
-- and an authenticated consent-off test demonstrates the legacy bypass.
begin;
do $guard$
begin
  if to_regprocedure('public.get_public_event_attendees(uuid)') is null then
    raise exception 'Legacy roster function missing; inspect before cutover';
  end if;
  if to_regprocedure('public.get_consented_event_attendees(uuid)') is null
     or to_regprocedure('public.get_event_connection_people(uuid)') is null then
    raise exception 'Consent-based discovery RPC missing; stop';
  end if;
  if has_function_privilege('anon', 'public.get_public_event_attendees(uuid)', 'EXECUTE') then
    raise exception 'Anonymous legacy roster access is still open; stop and investigate';
  end if;
end $guard$;
revoke execute on function public.get_public_event_attendees(uuid) from public, authenticated;
commit;
