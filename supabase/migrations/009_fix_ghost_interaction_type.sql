create or replace function public.record_ghost_connection(
  p_event_id uuid,
  p_ghost_token text,
  p_target_profile_id uuid
)
returns table (
  interaction_id uuid,
  ghost_id uuid,
  target_profile_id uuid,
  event_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ghost_id uuid;
begin
  select gp.id
  into v_ghost_id
  from public.ghost_participants gp
  where gp.event_id = p_event_id
    and gp.ghost_token = p_ghost_token
  limit 1;

  if v_ghost_id is null then
    raise exception 'Ghost participant not found';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_target_profile_id
  ) then
    raise exception 'Target profile not found';
  end if;

  insert into public.interaction_events (
    event_id,
    from_ghost_id,
    to_profile_id,
    interaction_type,
    strength,
    created_at
  )
  values (
    p_event_id,
    v_ghost_id,
    p_target_profile_id,
    'qr_confirmed',
    100,
    now()
  )
  returning
    id,
    from_ghost_id,
    to_profile_id,
    interaction_events.event_id
  into
    interaction_id,
    ghost_id,
    target_profile_id,
    event_id;

  return next;
end;
$$;

revoke all on function public.record_ghost_connection(uuid, text, uuid) from public;
grant execute on function public.record_ghost_connection(uuid, text, uuid) to anon, authenticated;
