-- Nearify owner-only SELECT cutover candidate.
-- NOT executed. Apply only after client compatibility and recovery checks.
-- Preserves existing INSERT/UPDATE policies unchanged.
begin;

do $verify$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles are viewable by authenticated users'
      and cmd = 'SELECT' and qual = 'true'
  ) then
    raise exception 'Expected broad profiles SELECT policy not found';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'event_attendees'
      and policyname = 'authenticated users can view event attendees'
      and cmd = 'SELECT' and qual = 'true'
  ) then
    raise exception 'Expected broad attendance SELECT policy not found';
  end if;
  if to_regprocedure('public.get_consented_event_attendees(uuid)') is null
     or to_regprocedure('public.get_my_event_discovery_preference(uuid)') is null
     or to_regprocedure('public.get_organizer_event_insights(uuid)') is null then
    raise exception 'Consent RPCs missing; install migration 001 first';
  end if;
  if to_regprocedure('public.get_public_event_attendees(uuid)') is null then
    raise exception 'Legacy roster signature missing; inspect before cutover';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'event_attendees')
      and cmd in ('SELECT', 'ALL')
      and policyname not in (
        'profiles are viewable by authenticated users',
        'authenticated users can view event attendees'
      )
  ) then
    raise exception 'Unexpected SELECT/ALL policy; review permissive grants';
  end if;
end
$verify$;

drop policy "profiles are viewable by authenticated users" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy "authenticated users can view event attendees" on public.event_attendees;
create policy "event_attendees_select_own" on public.event_attendees
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = profile_id and p.user_id = (select auth.uid())
  ));

-- Revoke PUBLIC as well as role-specific grants; PUBLIC grants are inherited.
revoke execute on function public.get_public_event_attendees(uuid)
  from public, anon, authenticated;

commit;
