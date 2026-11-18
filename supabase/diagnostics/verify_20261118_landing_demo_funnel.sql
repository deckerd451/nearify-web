-- Read-only checks after running 20261118_landing_demo_funnel.sql.
do $$
begin
  if to_regprocedure('public.get_landing_demo_funnel(timestamptz)') is null then
    raise exception 'get_landing_demo_funnel is missing';
  end if;
  if has_function_privilege('anon', 'public.get_landing_demo_funnel(timestamptz)', 'EXECUTE') then
    raise exception 'anon can still execute get_landing_demo_funnel';
  end if;
  if not has_function_privilege('authenticated', 'public.get_landing_demo_funnel(timestamptz)', 'EXECUTE') then
    raise exception 'authenticated cannot execute get_landing_demo_funnel';
  end if;
  raise notice 'get_landing_demo_funnel: OK (admin-only rows, no anon execute)';
end $$;
