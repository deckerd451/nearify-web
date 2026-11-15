-- ============================================================
-- NEARIFY verification for 20261115d_privacy_email_attendees
-- Run AFTER the migration. Everything here is rolled back at the end,
-- including the test email it saves for one member.
-- Expected result: one row starting "ALL CHECKS PASSED".
-- ============================================================
begin;

do $guard$ begin
  if to_regclass('public.event_attendees') is null or to_regclass('public.community') is not null then
    raise exception 'WRONG PROJECT: this file is for NEARIFY. Nothing was changed.';
  end if;
end $guard$;

do $v$
declare
  v_n bigint; v_total bigint; v_own bigint;
  v_prof uuid; v_user uuid;
  v_stranger uuid := gen_random_uuid();
begin
  -- A. Account emails are out of profiles and locked away
  select count(*) into v_n from public.profiles where email is not null;
  if v_n > 0 then raise exception 'FAIL: profiles still holds % account emails', v_n; end if;
  if not exists (select 1 from pg_trigger where tgname = 'private_profile_email'
                 and tgrelid = 'public.profiles'::regclass and not tgisinternal) then
    raise exception 'FAIL: private email trigger is missing';
  end if;
  if has_table_privilege('authenticated', 'public.profile_private_emails', 'SELECT')
  or has_table_privilege('anon', 'public.profile_private_emails', 'SELECT') then
    raise exception 'FAIL: app users can read the private email table';
  end if;

  -- Pick a real member who has attended something (for behaviour checks)
  select p.id, p.user_id into v_prof, v_user
  from public.profiles p
  where exists (select 1 from public.event_attendees ea where ea.profile_id = p.id)
    and not exists (select 1 from public.admins a where a.user_id = p.user_id)
  limit 1;

  if v_user is not null then
    perform set_config('request.jwt.claim.sub', v_user::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

    -- Saving an email (what ensure_profile / profile edits do) keeps it private
    update public.profiles set email = 'verify-probe@example.invalid' where id = v_prof;
    if (select email from public.profiles where id = v_prof) is not null then
      raise exception 'FAIL: a newly saved email landed in profiles';
    end if;
    if (select email from public.profile_private_emails where user_id = v_user) is distinct from 'verify-probe@example.invalid' then
      raise exception 'FAIL: a newly saved email was not stored privately';
    end if;

    -- C. As that member: sees all their own rows, nothing from unrelated events
    select count(*) into v_own from public.event_attendees where profile_id = v_prof;
    perform set_config('role', 'authenticated', true);
    select count(*) into v_n from public.event_attendees where profile_id = v_prof;
    if v_n <> v_own then
      raise exception 'FAIL: member sees % of their own % attendance rows', v_n, v_own;
    end if;
    select count(*) into v_n from public.event_attendees ea
    where ea.event_id not in (select public.my_visible_event_ids())
      and ea.profile_id not in (select public.my_mutual_connection_ids());
    if v_n <> 0 then
      raise exception 'FAIL: member can see % attendance rows from unrelated events', v_n;
    end if;
    perform set_config('role', 'none', true);
  end if;

  -- C. A signed-in account with no profile sees nothing
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.event_attendees;
  perform set_config('role', 'none', true);
  if v_n <> 0 then raise exception 'FAIL: a stranger can see % attendance rows', v_n; end if;

  -- B. No contact details left in profiles
  select count(*) into v_n from public.profiles
  where public_email is not null or public_phone is not null
     or linkedin_url is not null or website_url is not null;
  if v_n > 0 then raise exception 'FAIL: % profiles still show contact details', v_n; end if;

  -- D. Live counts: signed-in yes, signed-out no
  if not has_function_privilege('authenticated', 'public.get_live_attendee_counts(uuid[])', 'EXECUTE')
  or has_function_privilege('anon', 'public.get_live_attendee_counts(uuid[])', 'EXECUTE') then
    raise exception 'FAIL: live-count function permissions are wrong';
  end if;

  -- E. Discovery bug fixed
  if not exists (select 1 from pg_policies where tablename = 'event_discovery_preferences'
                 and policyname = 'event_discovery_insert_own_attendance'
                 and with_check like '%event_discovery_preferences.event_id%') then
    raise exception 'FAIL: discovery preference rule still compares the event to itself';
  end if;
end $v$;

rollback;

select 'ALL CHECKS PASSED' as result;
