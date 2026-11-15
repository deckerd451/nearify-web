-- ============================================================
-- NEARIFY emergency rollback for 20261115d_privacy_email_attendees
-- Use ONLY if something visibly breaks. Run only the section you need.
-- ============================================================

-- A. Something needed profiles.email -> put emails back
begin;
drop trigger if exists private_profile_email on public.profiles;
alter table public.profiles disable trigger trg_profiles_updated_at;
update public.profiles p set email = e.email
from public.profile_private_emails e
where e.user_id = p.user_id and p.email is null;
alter table public.profiles enable trigger trg_profiles_updated_at;
commit;
-- (profile_private_emails is kept as a backup.)

-- C. A screen needed to see all attendees -> restore the open rule
-- begin;
-- drop policy if exists "attendees can view attendees of their own events" on public.event_attendees;
-- create policy "authenticated users can view event attendees"
--   on public.event_attendees for select to authenticated using (true);
-- commit;

-- B (legacy contact details) is not rolled back: those values now live in
-- contact_preferences_private, which is what the apps already use.
-- D and E are safe to keep.
