-- Removes the "How to reach them" line (and what people typed there).
begin;
alter table public.private_contacts drop constraint if exists private_contacts_reach_length;
alter table public.private_contacts drop column if exists reach;
commit;
