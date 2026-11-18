-- ============================================================
-- NEARIFY: private_contacts — people you saved by hand
--
-- /save/ lets anyone save someone they met without a QR: a name, where
-- they met, and one thing to remember. Signed out, these stay in the
-- browser. Signed in, they are stored here.
--
-- * Owner-only: every policy is owner_user_id = auth.uid(). There is no
--   way for anyone else, including the saved person, to read a row.
-- * No grants to anon. No functions. Nothing joins this to profiles.
-- * client_id is the id the browser created, so moving device-saved
--   people into the account can be repeated safely (upsert).
-- * Rows are deleted with the account (on delete cascade).
-- ============================================================
begin;

create table if not exists public.private_contacts (
  id            uuid        primary key default gen_random_uuid(),
  owner_user_id uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  client_id     text        not null,
  name          text        not null,
  met_where     text,
  note          text,
  saved_at      timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint private_contacts_client_id_length check (char_length(client_id) between 1 and 64),
  constraint private_contacts_name_length      check (char_length(btrim(name)) between 1 and 80),
  constraint private_contacts_where_length     check (met_where is null or char_length(met_where) <= 120),
  constraint private_contacts_note_length      check (note is null or char_length(note) <= 500),
  constraint private_contacts_owner_client     unique (owner_user_id, client_id)
);

create index if not exists private_contacts_owner_saved_idx
  on public.private_contacts (owner_user_id, saved_at desc);

alter table public.private_contacts enable row level security;
alter table public.private_contacts force row level security;

drop policy if exists private_contacts_select_own on public.private_contacts;
create policy private_contacts_select_own on public.private_contacts
  for select to authenticated using (owner_user_id = auth.uid());

drop policy if exists private_contacts_insert_own on public.private_contacts;
create policy private_contacts_insert_own on public.private_contacts
  for insert to authenticated with check (owner_user_id = auth.uid());

drop policy if exists private_contacts_update_own on public.private_contacts;
create policy private_contacts_update_own on public.private_contacts
  for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

drop policy if exists private_contacts_delete_own on public.private_contacts;
create policy private_contacts_delete_own on public.private_contacts
  for delete to authenticated using (owner_user_id = auth.uid());

revoke all on public.private_contacts from public, anon;
grant select, insert, update, delete on public.private_contacts to authenticated;

comment on table public.private_contacts is 'People a user saved by hand on /save/. Owner-only; never shown to anyone else.';

commit;
