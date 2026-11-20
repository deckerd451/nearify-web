-- ============================================================
-- NEARIFY: handshake_tally — anonymous daily totals for Handshakes
-- Project: unndeygygkgodmmdnlup (Nearify web)
--
-- One number per day per kind, nothing else: no ids, no times, no
-- page, no referrer, no device. The pilot needs to know whether people
-- use Handshakes, never who did.
--
-- Kinds: card_made, connected, intro_sent, ask_sent, ask_passed,
--        help_offered, contact_saved
--
-- Anyone can add 1 to today's total (counts can be inflated; they are
-- a pilot signal, not a record). Only admins can read the totals.
-- ============================================================
begin;

do $guard$ begin
  if to_regclass('public.event_attendees') is null then
    raise exception 'WRONG PROJECT: this file is for Nearify web (unndeygygkgodmmdnlup). Nothing was changed.';
  end if;
end $guard$;

create table if not exists public.handshake_tally (
  day  date    not null,
  kind text    not null check (kind in ('card_made','connected','intro_sent','ask_sent','ask_passed','help_offered','contact_saved')),
  n    integer not null default 0 check (n >= 0),
  primary key (day, kind)
);

alter table public.handshake_tally enable row level security;
revoke all on public.handshake_tally from public, anon, authenticated;

create or replace function public.handshake_count(p_kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind is null or p_kind not in ('card_made','connected','intro_sent','ask_sent','ask_passed','help_offered','contact_saved') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  insert into handshake_tally (day, kind, n) values ((now() at time zone 'America/New_York')::date, p_kind, 1)
  on conflict (day, kind) do update set n = handshake_tally.n + 1;
end $$;

create or replace function public.get_handshake_tally(p_since date default current_date - 30)
returns table (day date, kind text, n integer)
language sql security definer stable set search_path = public, pg_temp as $$
  select t.day, t.kind, t.n from public.handshake_tally t
  where public.is_admin() and t.day >= p_since
  order by t.day, t.kind;
$$;

revoke all on function public.handshake_count(text) from public;
grant execute on function public.handshake_count(text) to anon, authenticated;
revoke all on function public.get_handshake_tally(date) from public, anon;
grant execute on function public.get_handshake_tally(date) to authenticated, service_role;

commit;
