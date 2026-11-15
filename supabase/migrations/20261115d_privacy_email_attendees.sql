-- ============================================================
-- NEARIFY: privacy fixes for profiles and event attendees
-- Project: unndeygygkgodmmdnlup
--
-- A. Account email. profiles.email was readable by every signed-in
--    user for every profile. It moves to a locked table
--    (profile_private_emails, keyed by the sign-in account), and a
--    trigger keeps it out of profiles on every future insert/update,
--    including ensure_profile(). Same design as the existing private
--    contact store. Apps read their own email from the sign-in session.
--
-- B. Legacy contact columns. Any public_email / public_phone /
--    linkedin_url / website_url / share flags still sitting in profiles
--    from before the private contact store are moved into it (only for
--    people who don't already have private preferences, so nobody's
--    newer choices are overwritten) and then cleared from profiles.
--
-- C. Event attendees. Every signed-in user could read every attendance
--    row (who went where, goals, constraints, last seen). Now a person
--    sees attendee rows only for events they attended, joined or
--    created, plus the attendance of people they're mutually connected
--    with (so "N of your connections are going" still works). Admins
--    keep full access. Guest pages are unaffected (server functions).
--
-- D. get_live_attendee_counts(event_ids): returns only how many people
--    are checked in right now, for Explore. The iPhone app needs a small
--    update to use it; until then Explore shows 0 for events you
--    haven't joined.
--
-- E. Bug fix: event_discovery_preferences compared ea.event_id to
--    itself, so the "must have joined this event" check did nothing.
-- ============================================================
begin;

do $guard$ begin
  if to_regclass('public.event_attendees') is null or to_regclass('public.community') is not null then
    raise exception 'WRONG PROJECT: this file is for NEARIFY (unndeygygkgodmmdnlup). Nothing was changed.';
  end if;
end $guard$;

-- ---------- A. Account email ----------
create table if not exists public.profile_private_emails (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  updated_at timestamptz not null default now()
);
alter table public.profile_private_emails enable row level security;
revoke all on public.profile_private_emails from public, anon, authenticated;
grant all on public.profile_private_emails to service_role;

create or replace function public.capture_private_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    raise exception 'Only the owner may set this email' using errcode = '42501';
  end if;
  if nullif(btrim(new.email), '') is not null then
    insert into public.profile_private_emails (user_id, email)
    values (new.user_id, btrim(new.email))
    on conflict (user_id) do update set email = excluded.email, updated_at = now();
  end if;
  new.email := null;
  return new;
end $$;
revoke execute on function public.capture_private_profile_email() from public, anon, authenticated;

drop trigger if exists private_profile_email on public.profiles;
create trigger private_profile_email
  before insert or update of email on public.profiles
  for each row execute function public.capture_private_profile_email();

-- Backfill without bumping everyone's updated_at
alter table public.profiles disable trigger trg_profiles_updated_at;

insert into public.profile_private_emails (user_id, email)
select user_id, btrim(email) from public.profiles
where nullif(btrim(email), '') is not null
on conflict (user_id) do update set email = excluded.email, updated_at = now();

update public.profiles set email = null where email is not null;

-- ---------- B. Legacy contact columns ----------
-- B1. People with no private preferences yet: move them in through the
--     existing trusted path (capture_private_contact_preferences).
update public.profiles p
set public_email = p.public_email
where (nullif(btrim(p.public_email), '') is not null or nullif(btrim(p.public_phone), '') is not null
       or nullif(btrim(p.linkedin_url), '') is not null or nullif(btrim(p.website_url), '') is not null
       or coalesce(p.share_email, false) or coalesce(p.share_phone, false)
       or coalesce(p.preferred_contact_method, 'nearify') <> 'nearify')
  and not exists (select 1 from public.contact_preferences_private c where c.profile_id = p.id);

-- B2. People who already have private preferences: just clear leftovers.
update public.profiles p
set public_email = null, public_phone = null, linkedin_url = null, website_url = null,
    share_email = false, share_phone = false, preferred_contact_method = null
where (p.public_email is not null or p.public_phone is not null or p.linkedin_url is not null
       or p.website_url is not null or coalesce(p.share_email, false) or coalesce(p.share_phone, false)
       or p.preferred_contact_method is not null)
  and exists (select 1 from public.contact_preferences_private c where c.profile_id = p.id);

alter table public.profiles enable trigger trg_profiles_updated_at;

-- ---------- C. Event attendees ----------
create or replace function public.my_visible_event_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ea.event_id from public.event_attendees ea
   where ea.profile_id = public.current_profile_id()
  union
  select e.id from public.events e
   where e.created_by = public.current_profile_id()
$$;
revoke execute on function public.my_visible_event_ids() from public, anon;
grant  execute on function public.my_visible_event_ids() to authenticated, service_role;

-- People both sides agreed to connect with (accepted connection or
-- confirmed relationship). Used so "N of your connections are going"
-- keeps working on the web dashboard. One-sided requests don't count.
create or replace function public.my_mutual_connection_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when r.profile_a_id = me.id then r.profile_b_id else r.profile_a_id end
    from public.relationships r, (select public.current_profile_id() as id) me
   where r.status = 'confirmed' and me.id in (r.profile_a_id, r.profile_b_id)
  union
  select case when c.requester_profile_id = me.id then c.addressee_profile_id else c.requester_profile_id end
    from public.connections c, (select public.current_profile_id() as id) me
   where c.status = 'accepted' and me.id in (c.requester_profile_id, c.addressee_profile_id)
$$;
revoke execute on function public.my_mutual_connection_ids() from public, anon;
grant  execute on function public.my_mutual_connection_ids() to authenticated, service_role;

drop policy if exists "authenticated users can view event attendees" on public.event_attendees;
drop policy if exists "attendees can view attendees of their own events" on public.event_attendees;
create policy "attendees can view attendees of their own events"
  on public.event_attendees for select to authenticated
  using (event_id in (select public.my_visible_event_ids())
         or profile_id in (select public.my_mutual_connection_ids())
         or public.is_admin());

-- ---------- D. Live counts for Explore ----------
create or replace function public.get_live_attendee_counts(p_event_ids uuid[])
returns table (event_id uuid, live_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select ea.event_id, count(*)::integer
  from public.event_attendees ea
  join public.events e on e.id = ea.event_id and e.deleted_at is null
  where ea.event_id = any (p_event_ids[1:200])
    and ea.status = 'joined'
    and ea.last_seen_at >= now() - interval '5 minutes'
  group by ea.event_id
$$;
revoke execute on function public.get_live_attendee_counts(uuid[]) from public, anon;
grant  execute on function public.get_live_attendee_counts(uuid[]) to authenticated, service_role;

-- ---------- E. Discovery preference bug ----------
drop policy if exists event_discovery_insert_own_attendance on public.event_discovery_preferences;
create policy event_discovery_insert_own_attendance
  on public.event_discovery_preferences for insert to authenticated
  with check (exists (
    select 1 from public.profiles p
    join public.event_attendees ea on ea.profile_id = p.id
    where p.id = event_discovery_preferences.profile_id
      and p.user_id = (select auth.uid())
      and ea.event_id = event_discovery_preferences.event_id
      and ea.status = any (array['joined', 'inEvent'])));

drop policy if exists event_discovery_update_own_attendance on public.event_discovery_preferences;
create policy event_discovery_update_own_attendance
  on public.event_discovery_preferences for update to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = event_discovery_preferences.profile_id and p.user_id = (select auth.uid())))
  with check (exists (
    select 1 from public.profiles p
    join public.event_attendees ea on ea.profile_id = p.id
    where p.id = event_discovery_preferences.profile_id
      and p.user_id = (select auth.uid())
      and ea.event_id = event_discovery_preferences.event_id
      and ea.status = any (array['joined', 'inEvent'])));

commit;
