-- Lightweight funnel event log for measuring key user actions
-- Rows are insert-only and readable only by the owning organizer (or service role for aggregation).

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

-- Anyone can insert (anonymous funnel tracking)
create policy "Anyone can log analytics"
  on public.analytics_events for insert
  with check (true);

-- Only service role can read (for dashboards / exports)
-- Regular users cannot read raw events
create policy "No public read"
  on public.analytics_events for select
  using (false);

create index analytics_events_event_name_idx on public.analytics_events (event_name);
create index analytics_events_created_at_idx on public.analytics_events (created_at);
create index analytics_events_event_id_idx   on public.analytics_events (event_id) where event_id is not null;
