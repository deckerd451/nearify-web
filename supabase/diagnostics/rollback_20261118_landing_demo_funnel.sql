-- Removes the read function only. Logged analytics rows are untouched.
drop function if exists public.get_landing_demo_funnel(timestamptz);
