-- ============================================================
-- NEARIFY: admin-only counts for the signed-out homepage demo
--
-- The homepage logs five anonymous events through the existing
-- analytics_events insert policy (no new table, no new write access):
--   landing_view, landing_try_clicked, landing_demo_started,
--   landing_demo_completed, landing_demo_cta_clicked
-- Each is sent at most once per page load with empty properties.
--
-- This adds one read function for the internal dashboard. Like
-- get_meetup_funnel, it returns rows only when public.is_admin() is
-- true and signed-out visitors cannot execute it.
-- ============================================================
begin;

create or replace function public.get_landing_demo_funnel(
  p_since timestamptz default now() - interval '30 days'
)
returns table (
  funnel_stage    text,
  referrer_origin text,
  cnt             bigint
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    ae.event_name               as funnel_stage,
    coalesce(nullif(ae.referrer, ''), 'direct') as referrer_origin,
    count(*)                    as cnt
  from public.analytics_events ae
  where
    public.is_admin()
    and ae.event_name in (
      'landing_view',
      'landing_try_clicked',
      'landing_demo_started',
      'landing_demo_completed',
      'landing_demo_cta_clicked'
    )
    and ae.created_at >= p_since
  group by ae.event_name, coalesce(nullif(ae.referrer, ''), 'direct')
  order by count(*) desc;
$$;

revoke execute on function public.get_landing_demo_funnel(timestamptz) from public, anon;
grant  execute on function public.get_landing_demo_funnel(timestamptz) to authenticated, service_role;

commit;
