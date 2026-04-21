create or replace function public.create_ghost_participant(
  p_event_id uuid,
  p_display_name text default null
)
returns table (
  ghost_id uuid,
  ghost_token text,
  event_id uuid,
  display_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ghost_id uuid;
  v_ghost_token text;
begin
  if not exists (
    select 1
    from public.events e
    where e.id = p_event_id
      and e.deleted_at is null
      and coalesce(e.is_active, true) = true
  ) then
    raise exception 'Event not available';
  end if;

  v_ghost_id := gen_random_uuid();
  v_ghost_token := encode(gen_random_bytes(24), 'hex');

  insert into public.ghost_participants (
    id,
    event_id,
    ghost_token,
    display_name
  )
  values (
    v_ghost_id,
    p_event_id,
    v_ghost_token,
    nullif(trim(p_display_name), '')
  );

  return query
  select
    gp.id,
    gp.ghost_token,
    gp.event_id,
    gp.display_name
  from public.ghost_participants gp
  where gp.id = v_ghost_id;
end;
$$;

revoke all on function public.create_ghost_participant(uuid, text) from public;
grant execute on function public.create_ghost_participant(uuid, text) to anon, authenticated;
