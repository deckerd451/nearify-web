-- ============================================================
-- NEARIFY verification for 20261115_analytics_intelligence_authz
-- Run AFTER the migration. Read-only; rolled back anyway.
-- Expected result: one row saying "ALL CHECKS PASSED".
-- Any failure stops with an error starting with "FAIL:".
-- ============================================================
begin;

do $$
declare
  v_rows bigint;
  v_stranger uuid := gen_random_uuid();   -- signed in, not an admin
begin
  -- 1. Permissions
  if has_function_privilege('anon', 'public.get_meetup_funnel(timestamptz)', 'EXECUTE')
  or has_function_privilege('anon', 'public.get_meetup_activity_hourly(int)', 'EXECUTE')
  or has_function_privilege('anon', 'public.compute_interaction_intelligence(uuid)', 'EXECUTE') then
    raise exception 'FAIL: signed-out users can still run an analytics/intelligence function';
  end if;
  if not has_function_privilege('authenticated', 'public.get_meetup_funnel(timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: signed-in admins lost access to the funnel dashboard';
  end if;

  -- 2. Signed in as a non-admin: funnel returns nothing
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  select count(*) into v_rows from public.get_meetup_funnel(now() - interval '10 years');
  if v_rows <> 0 then
    raise exception 'FAIL: a non-admin received % funnel rows', v_rows;
  end if;
  select count(*) into v_rows from public.get_meetup_activity_hourly(87600);
  if v_rows <> 0 then
    raise exception 'FAIL: a non-admin received % hourly rows', v_rows;
  end if;

  -- 3. Deployed code contains the admin gate
  if pg_get_functiondef('public.get_meetup_funnel(timestamptz)'::regprocedure) not like '%is_admin()%'
  or pg_get_functiondef('public.get_meetup_activity_hourly(int)'::regprocedure) not like '%is_admin()%' then
    raise exception 'FAIL: deployed funnel functions do not contain the admin check';
  end if;
end $$;

rollback;

select 'ALL CHECKS PASSED' as result;
