-- Emergency rollback of 018 ONLY, if a verified supported client breaks.
-- Restores authenticated legacy access, including the consent-bypass risk.
begin;
grant execute on function public.get_public_event_attendees(uuid) to authenticated;
commit;
