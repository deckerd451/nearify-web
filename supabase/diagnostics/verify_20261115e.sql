-- ============================================================
-- NEARIFY verification for 20261115e_no_emails_in_names
-- Run AFTER the migration. Rolled back at the end.
-- Expected result: one row starting "ALL CHECKS PASSED".
-- ============================================================
begin;

do $guard$ begin
  if to_regclass('public.event_attendees') is null or to_regclass('public.community') is not null then
    raise exception 'WRONG PROJECT: this file is for NEARIFY. Nothing was changed.';
  end if;
end $guard$;

do $v$
declare v_n bigint; v_prof uuid;
begin
  select count(*) into v_n from public.profiles where position('@' in coalesce(name, '')) > 0;
  if v_n > 0 then raise exception 'FAIL: % profiles still have an email address as their name', v_n; end if;

  -- Same results as the iPhone app's formatter
  if public.humanize_email_name('nearifytester@gmail.com') is distinct from 'Nearifytester'
  or public.humanize_email_name('daveed.balcher1999@x.com') is distinct from 'Daveed Balcher'
  or public.humanize_email_name('jo@x.com') is not null
  or public.humanize_email_name('xkcd123@x.com') is not null then
    raise exception 'FAIL: name formatting does not match the app';
  end if;

  -- A new email-as-name is converted on save
  select id into v_prof from public.profiles limit 1;
  if v_prof is not null then
    update public.profiles set name = 'verify.probe@example.invalid' where id = v_prof;
    if (select name from public.profiles where id = v_prof) is distinct from 'Verify Probe' then
      raise exception 'FAIL: saving an email as a name was not converted';
    end if;
  end if;
end $v$;

rollback;

select 'ALL CHECKS PASSED' as result;
