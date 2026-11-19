-- ============================================================
-- NEARIFY: handshake_mailbox — sealed messages between phones
-- Project: unndeygygkgodmmdnlup (Nearify web)
--
-- Handshakes keep who-met-whom on people's own phones. Phones pass
-- each other sealed messages through this mailbox.
--
-- * The server never sees a name, a public key or an account. A box is
--   a random-looking 43-character id that only the two phones can work
--   out; a payload is sealed bytes it cannot read.
-- * No sign-in, no user id, no IP or device column.
-- * Messages are deleted when picked up, or after 7 days.
-- * Nobody reads the table directly: no grants, row security on with no
--   policies. Only the two functions below touch it.
-- ============================================================
begin;

do $guard$ begin
  if to_regclass('public.event_attendees') is null then
    raise exception 'WRONG PROJECT: this file is for Nearify web (unndeygygkgodmmdnlup). Nothing was changed.';
  end if;
end $guard$;

create table if not exists public.handshake_mailbox (
  id         bigint generated always as identity primary key,
  box        text        not null check (box ~ '^[A-Za-z0-9_-]{43}$'),
  payload    text        not null check (payload ~ '^[A-Za-z0-9_.-]+$' and char_length(payload) between 20 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists handshake_mailbox_box on public.handshake_mailbox (box);
create index if not exists handshake_mailbox_created on public.handshake_mailbox (created_at);

alter table public.handshake_mailbox enable row level security;
revoke all on public.handshake_mailbox from public, anon, authenticated;

create or replace function public.handshake_post(p_box text, p_payload text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_box is null or p_box !~ '^[A-Za-z0-9_-]{43}$'
     or p_payload is null or p_payload !~ '^[A-Za-z0-9_.-]+$'
     or char_length(p_payload) not between 20 and 2000 then
    raise exception 'invalid message' using errcode = '22023';
  end if;
  if (select count(*) from handshake_mailbox where box = p_box and created_at > now() - interval '7 days') >= 20 then
    raise exception 'mailbox full' using errcode = '54000';
  end if;
  insert into handshake_mailbox (box, payload) values (p_box, p_payload);
end $$;

create or replace function public.handshake_take(p_boxes text[])
returns table (box text, payload text) language plpgsql security definer set search_path = public as $$
begin
  if p_boxes is null or cardinality(p_boxes) > 100 or exists (
       select 1 from unnest(p_boxes) b where b is null or b !~ '^[A-Za-z0-9_-]{43}$') then
    raise exception 'invalid request' using errcode = '22023';
  end if;
  delete from handshake_mailbox m where m.created_at < now() - interval '7 days';
  return query
    delete from handshake_mailbox m where m.box = any (p_boxes)
    returning m.box, m.payload;
end $$;

revoke all on function public.handshake_post(text, text) from public;
revoke all on function public.handshake_take(text[]) from public;
grant execute on function public.handshake_post(text, text) to anon, authenticated;
grant execute on function public.handshake_take(text[]) to anon, authenticated;

commit;
