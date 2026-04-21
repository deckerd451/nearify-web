alter table public.interaction_events
  alter column from_profile_id drop not null;

alter table public.interaction_events
  alter column to_profile_id drop not null;
