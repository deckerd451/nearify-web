-- ============================================================
-- NEARIFY: no email addresses in profile names
-- Project: unndeygygkgodmmdnlup
--
-- Some profiles store the full email address as their NAME, which every
-- signed-in user can read (the email column itself is already private).
-- The apps never show those raw: they display a friendly version
-- ("nearify.tester@x.com" -> "Nearify Tester"). This migration stores
-- exactly that friendly version as the name, using the same rules as the
-- iPhone app's IdentityDisplayName.humanizedEmailLocalPart, so nothing
-- changes on screen. A trigger keeps future sign-ups from storing an
-- email as a name. The address itself is kept in profile_private_emails.
-- ============================================================
begin;

do $guard$ begin
  if to_regclass('public.event_attendees') is null or to_regclass('public.community') is not null then
    raise exception 'WRONG PROJECT: this file is for NEARIFY (unndeygygkgodmmdnlup). Nothing was changed.';
  end if;
  if to_regclass('public.profile_private_emails') is null then
    raise exception 'Run 20261115d_privacy_email_attendees.sql first. Nothing was changed.';
  end if;
end $guard$;

-- Mirrors IdentityDisplayName.humanizedEmailLocalPart (Swift). Returns
-- null when the app would fall back to "Nearify Member".
create or replace function public.humanize_email_name(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare t text; parts text[]; result text;
begin
  t := split_part(lower(btrim(coalesce(p_value, ''))), '@', 1);
  if t = '' then return null; end if;
  t := regexp_replace(t, '[._-]+', ' ', 'g');
  t := regexp_replace(t, '\d{4,}$', '');
  t := regexp_replace(t, '[^a-z0-9 ]', '', 'g');
  t := btrim(regexp_replace(t, '\s+', ' ', 'g'));
  if t = '' or length(t) < 4 then return null; end if;
  parts := string_to_array(t, ' ');
  if array_length(parts, 1) = 1 and (parts[1] !~ '[aeiou]' or parts[1] ~ '\d{3,}') then
    return null;
  end if;
  select string_agg(upper(left(x, 1)) || substr(x, 2), ' ' order by i)
    into result
    from unnest(parts[1:3]) with ordinality as u(x, i);
  return nullif(result, '');
end $$;
revoke execute on function public.humanize_email_name(text) from public, anon;
grant  execute on function public.humanize_email_name(text) to authenticated, service_role;

create or replace function public.keep_emails_out_of_names()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name is not null and position('@' in new.name) > 0 then
    insert into public.profile_private_emails (user_id, email)
    values (new.user_id, btrim(new.name))
    on conflict (user_id) do nothing;
    new.name := public.humanize_email_name(new.name);
  end if;
  return new;
end $$;
revoke execute on function public.keep_emails_out_of_names() from public, anon, authenticated;

drop trigger if exists keep_emails_out_of_names on public.profiles;
create trigger keep_emails_out_of_names
  before insert or update of name on public.profiles
  for each row execute function public.keep_emails_out_of_names();

-- Fix existing rows without bumping updated_at
alter table public.profiles disable trigger trg_profiles_updated_at;
update public.profiles set name = name where position('@' in coalesce(name, '')) > 0;
alter table public.profiles enable trigger trg_profiles_updated_at;

commit;
