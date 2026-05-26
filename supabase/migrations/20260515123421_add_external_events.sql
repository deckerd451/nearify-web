create table if not exists external_events (
  id uuid primary key default gen_random_uuid(),

  source text not null,
  source_event_id text not null,

  title text not null,
  description text,
  start_time timestamptz,
  end_time timestamptz,
  location text,
  source_url text,
  image_url text,

  raw_payload jsonb,

  matched_event_id uuid references events(id),

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(source, source_event_id)
);
