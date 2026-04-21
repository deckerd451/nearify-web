create table if not exists public.ghost_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  ghost_token text not null unique,
  display_name text,
  claimed_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ghost_participants_event_id
  on public.ghost_participants(event_id);

alter table public.interaction_events
  add column if not exists from_ghost_id uuid references public.ghost_participants(id) on delete set null,
  add column if not exists to_ghost_id uuid references public.ghost_participants(id) on delete set null;
