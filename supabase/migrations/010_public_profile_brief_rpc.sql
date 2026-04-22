create or replace function public.get_public_profile_brief(p_profile_id uuid)
returns table (
  id uuid,
  name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.avatar_url
  from public.profiles p
  where p.id = p_profile_id
  limit 1;
$$;

revoke all on function public.get_public_profile_brief(uuid) from public;
grant execute on function public.get_public_profile_brief(uuid) to anon, authenticated;
