-- SECURITY DEFINER RPCs for internal funnel dashboard.
-- analytics_events blocks SELECT via RLS (using(false)), so these functions
-- run as the DB owner and bypass RLS — only callable by authenticated users.

-- ── get_meetup_funnel ─────────────────────────────────────────────────────────
-- Returns per-event funnel counts for meetup-sourced analytics.
-- One row per (event_id, source_event_id, event_name, funnel_stage).

create or replace function public.get_meetup_funnel(
  p_since timestamptz default now() - interval '30 days'
)
returns table (
  event_id        uuid,
  event_title     text,
  source_event_id text,
  funnel_stage    text,
  cnt             bigint,
  latest_at       timestamptz
)
language sql
security definer
stable
as $$
  select
    ae.event_id,
    e.title                                   as event_title,
    ae.properties->>'source_event_id'         as source_event_id,
    ae.event_name                             as funnel_stage,
    count(*)                                  as cnt,
    max(ae.created_at)                        as latest_at
  from public.analytics_events ae
  left join public.events e on e.id = ae.event_id
  where
    ae.event_name in (
      'meetup_handoff_view',
      'enter_live_network_clicked',
      'testflight_clicked',
      'guest_session_created',
      'app_deep_link_clicked'
    )
    and ae.created_at >= p_since
  group by ae.event_id, e.title, ae.properties->>'source_event_id', ae.event_name
  order by max(ae.created_at) desc;
$$;

-- Restrict to authenticated users only
revoke execute on function public.get_meetup_funnel(timestamptz) from anon;
grant  execute on function public.get_meetup_funnel(timestamptz) to authenticated;


-- ── get_meetup_activity_hourly ────────────────────────────────────────────────
-- Returns hourly bucketed counts for the activity sparkline (last N hours).

create or replace function public.get_meetup_activity_hourly(
  p_hours int default 168  -- 7 days
)
returns table (
  hour_bucket  timestamptz,
  funnel_stage text,
  cnt          bigint
)
language sql
security definer
stable
as $$
  select
    date_trunc('hour', ae.created_at) as hour_bucket,
    ae.event_name                     as funnel_stage,
    count(*)                          as cnt
  from public.analytics_events ae
  where
    ae.event_name in (
      'meetup_handoff_view',
      'enter_live_network_clicked',
      'testflight_clicked',
      'guest_session_created',
      'app_deep_link_clicked'
    )
    and ae.created_at >= now() - (p_hours || ' hours')::interval
  group by date_trunc('hour', ae.created_at), ae.event_name
  order by hour_bucket asc;
$$;

revoke execute on function public.get_meetup_activity_hourly(int) from anon;
grant  execute on function public.get_meetup_activity_hourly(int) to authenticated;
