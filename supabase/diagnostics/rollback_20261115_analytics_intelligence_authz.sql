-- ============================================================
-- NEARIFY emergency rollback for 20261115_analytics_intelligence_authz
-- Use ONLY if the admin funnel dashboard stops showing data for admins.
-- Restores the 20260515163642 bodies (no admin check). Signed-out
-- access stays removed, matching what that migration intended.
-- compute_interaction_intelligence permissions are left as they are.
-- ============================================================
begin;

create or replace function public.get_meetup_funnel(
  p_since timestamptz default now() - interval '30 days'
)
returns table (
  event_id uuid, event_title text, source_event_id text,
  funnel_stage text, cnt bigint, latest_at timestamptz
)
language sql security definer stable
as $$
  select ae.event_id, e.name as event_title,
         ae.properties->>'source_event_id' as source_event_id,
         ae.event_name as funnel_stage, count(*) as cnt, max(ae.created_at) as latest_at
  from public.analytics_events ae
  left join public.events e on e.id = ae.event_id
  where ae.event_name in ('meetup_handoff_view','enter_live_network_clicked',
                          'testflight_clicked','guest_session_created','app_deep_link_clicked')
    and ae.created_at >= p_since
  group by ae.event_id, e.name, ae.properties->>'source_event_id', ae.event_name
  order by max(ae.created_at) desc;
$$;

create or replace function public.get_meetup_activity_hourly(p_hours int default 168)
returns table (hour_bucket timestamptz, funnel_stage text, cnt bigint)
language sql security definer stable
as $$
  select date_trunc('hour', ae.created_at) as hour_bucket,
         ae.event_name as funnel_stage, count(*) as cnt
  from public.analytics_events ae
  where ae.event_name in ('meetup_handoff_view','enter_live_network_clicked',
                          'testflight_clicked','guest_session_created','app_deep_link_clicked')
    and ae.created_at >= now() - (p_hours || ' hours')::interval
  group by date_trunc('hour', ae.created_at), ae.event_name
  order by hour_bucket asc;
$$;

-- These functions use SET search_path in the fixed version; reset it.
alter function public.get_meetup_funnel(timestamptz) reset search_path;
alter function public.get_meetup_activity_hourly(int) reset search_path;

commit;
