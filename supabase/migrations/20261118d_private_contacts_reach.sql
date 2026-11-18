-- ============================================================
-- NEARIFY: "How to reach them" on people saved by hand
--
-- Adds one optional line to private_contacts: a phone number, email or
-- link the user typed for someone they met. Same owner-only policies as
-- the rest of the row; nothing else changes. The page works before this
-- runs (it saves without the line); run it so the line is kept.
-- ============================================================
begin;

alter table public.private_contacts add column if not exists reach text;

alter table public.private_contacts drop constraint if exists private_contacts_reach_length;
alter table public.private_contacts add constraint private_contacts_reach_length
  check (reach is null or char_length(reach) <= 120);

comment on column public.private_contacts.reach is 'Optional, owner-only: how the user can reach this person (phone, email or link, max 120 chars).';

commit;
