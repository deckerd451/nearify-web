-- EMERGENCY ACCESS ROLLBACK ONLY.
-- Restores previously observed broad read policies and legacy RPC grants.
-- WARNING: this reintroduces the original privacy exposure.
-- Use only if a verified release fails and narrower remediation is unavailable.
begin;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "event_attendees_select_own" on public.event_attendees;

create policy "profiles are viewable by authenticated users"
  on public.profiles for select to authenticated using (true);
create policy "authenticated users can view event attendees"
  on public.event_attendees for select to authenticated using (true);

grant execute on function public.get_public_event_attendees(uuid)
  to public, anon, authenticated;
commit;
