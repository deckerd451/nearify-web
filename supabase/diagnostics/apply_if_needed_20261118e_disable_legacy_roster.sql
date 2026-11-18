-- Only if verify_20261118e reports the function can still be run. Not needed on 2026-11-18 (already off).
-- Turns off the old attendee list function for everyone.
-- Nothing in the Nearify website, the iOS app or the CharlestonHacks site
-- calls it (checked 2026-11-18). Undo: grant execute on function
-- public.get_public_event_attendees(uuid) to authenticated;
begin;
do $$
begin
  if to_regprocedure('public.get_public_event_attendees(uuid)') is null then
    raise notice 'get_public_event_attendees is not present: nothing to do';
  else
    revoke execute on function public.get_public_event_attendees(uuid) from public, anon, authenticated;
    raise notice 'get_public_event_attendees is now off';
  end if;
end $$;
commit;
