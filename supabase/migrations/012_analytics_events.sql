-- Lightweight funnel event log for measuring key user actions
-- Rows are insert-only and readable only by the owning organizer or service role

create table if not exists public.analytics_events (
  id          uuid        primary key default gen_random_uuid(),
  event_name  text        not null,
  page        text,
  referrer    text,
  event_id    uuid        references public.events(id) on delete set null,
  profile_id  uuid        references public.profiles(id) on delete set null,
  properties  jsonb       default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

alter table public.analytics_events enable row level security;

-- Anyone can insert anonymous funnel tracking
drop policy if exists "Anyone can log analytics" on public.analytics_events;

create policy "Anyone can log analytics"
  on public.analytics_events
  for insert
  with check (true);

-- Authenticated users can read their own analytics rows
drop policy if exists "Users can read own analytics" on public.analytics_events;

create policy "Users can read own analytics"
  on public.analytics_events
  for select
  using (auth.uid() = profile_id);

-- Helpful indexes
create index if not exists analytics_events_event_id_idx
  on public.analytics_events(event_id);

create index if not exists analytics_events_profile_id_idx
  on public.analytics_events(profile_id);

create index if not exists analytics_events_created_at_idx
  on public.analytics_events(created_at desc);
