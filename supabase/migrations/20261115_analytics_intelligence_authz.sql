-- ============================================================
-- NEARIFY: admin-only funnel analytics + intelligence lockdown
-- Project: unndeygygkgodmmdnlup
--
-- Problem 1: get_meetup_funnel and get_meetup_activity_hourly are
-- SECURITY DEFINER and return analytics to anyone, including signed-out
-- visitors. The 20260515 migration revoked anon, but PUBLIC still had
-- EXECUTE and anon inherits PUBLIC, so the revoke had no effect.
-- Problem 2: compute_interaction_intelligence(p_event_id) can be run by
-- signed-out visitors against any event. It deletes and rebuilds that
-- event's intelligence with an attendee-by-attendee loop.
--
-- Fix: funnel functions return rows only when public.is_admin() is true
-- (the dashboard already requires an admin sign-in). Bodies are
-- otherwise identical to the live 20260515163642 version. Signed-out
-- access is removed from all three.
--
-- compute_interaction_intelligence stays callable by signed-in users
-- for now, because the private nearify-ios repo may call it. Step 2 at
-- the bottom removes that too once you confirm nothing calls it.
-- ============================================================
begin;

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
set search_path = public, pg_temp
as $$
  select
    ae.event_id,
    e.name                                    as event_title,
    ae.properties->>'source_event_id'         as source_event_id,
    ae.event_name                             as funnel_stage,
    count(*)                                  as cnt,
    max(ae.created_at)                        as latest_at
  from public.analytics_events ae
  left join public.events e on e.id = ae.event_id
  where
    public.is_admin()
    and ae.event_name in (
      'meetup_handoff_view',
      'enter_live_network_clicked',
      'testflight_clicked',
      'guest_session_created',
      'app_deep_link_clicked'
    )
    and ae.created_at >= p_since
  group by
    ae.event_id,
    e.name,
    ae.properties->>'source_event_id',
    ae.event_name
  order by max(ae.created_at) desc;
$$;

create or replace function public.get_meetup_activity_hourly(
  p_hours int default 168
)
returns table (
  hour_bucket  timestamptz,
  funnel_stage text,
  cnt          bigint
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    date_trunc('hour', ae.created_at) as hour_bucket,
    ae.event_name                     as funnel_stage,
    count(*)                          as cnt
  from public.analytics_events ae
  where
    public.is_admin()
    and ae.event_name in (
      'meetup_handoff_view',
      'enter_live_network_clicked',
      'testflight_clicked',
      'guest_session_created',
      'app_deep_link_clicked'
    )
    and ae.created_at >= now() - (p_hours || ' hours')::interval
  group by
    date_trunc('hour', ae.created_at),
    ae.event_name
  order by hour_bucket asc;
$$;

revoke execute on function public.get_meetup_funnel(timestamptz)        from public, anon;
revoke execute on function public.get_meetup_activity_hourly(int)       from public, anon;
grant  execute on function public.get_meetup_funnel(timestamptz)        to authenticated, service_role;
grant  execute on function public.get_meetup_activity_hourly(int)       to authenticated, service_role;

revoke execute on function public.compute_interaction_intelligence(uuid) from public, anon;
grant  execute on function public.compute_interaction_intelligence(uuid) to authenticated, service_role;

commit;

-- ------------------------------------------------------------
-- STEP 2 (run separately, ONLY if nearify-ios never calls
-- compute_interaction_intelligence; see the instructions):
--
-- revoke execute on function public.compute_interaction_intelligence(uuid) from authenticated;
-- ------------------------------------------------------------
