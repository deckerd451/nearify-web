alter table public.interaction_events
  add column if not exists claimed_by_profile_id uuid references public.profiles(id) on delete set null;

create index if not exists idx_interaction_events_claimed_by_profile
  on public.interaction_events(claimed_by_profile_id);

create or replace view public.ghost_sessions as
select
  gp.id,
  gp.ghost_token,
  gp.event_id,
  gp.display_name,
  gp.created_at,
  gp.claimed_by_profile_id as claimed_profile_id
from public.ghost_participants gp;

create or replace function public.get_ghost_connection_history(
  p_ghost_id uuid,
  p_ghost_token text,
  p_event_id uuid default null
)
returns table (
  interaction_id uuid,
  event_id uuid,
  to_profile_id uuid,
  to_profile_name text,
  connected_at timestamptz,
  claimed_by_profile_id uuid,
  claimed_profile_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ghost record;
begin
  select gp.id, gp.claimed_by_profile_id
  into v_ghost
  from public.ghost_participants gp
  where gp.id = p_ghost_id
    and gp.ghost_token = p_ghost_token
    and (p_event_id is null or gp.event_id = p_event_id)
  limit 1;

  if v_ghost.id is null then
    raise exception 'Ghost session not found';
  end if;

  return query
  select
    ie.id as interaction_id,
    ie.event_id,
    ie.to_profile_id,
    coalesce(p.name, 'Attendee') as to_profile_name,
    ie.created_at as connected_at,
    ie.claimed_by_profile_id,
    v_ghost.claimed_by_profile_id as claimed_profile_id
  from public.interaction_events ie
  left join public.profiles p
    on p.id = ie.to_profile_id
  where ie.from_ghost_id = p_ghost_id
    and (p_event_id is null or ie.event_id = p_event_id)
    and ie.interaction_type = 'qr_confirmed'
  order by ie.created_at desc
  limit 50;
end;
$$;

revoke all on function public.get_ghost_connection_history(uuid, text, uuid) from public;
grant execute on function public.get_ghost_connection_history(uuid, text, uuid) to anon, authenticated;

create or replace function public.claim_ghost_activity(
  p_ghost_id uuid,
  p_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_profile_id uuid;
  v_headers jsonb;
  v_ghost_token text;
  v_interactions_claimed int := 0;
  v_ghosts_claimed int := 0;
begin
  v_auth_profile_id := public.current_profile_id();
  if v_auth_profile_id is null or v_auth_profile_id <> p_profile_id then
    raise exception 'Forbidden';
  end if;

  v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  v_ghost_token := coalesce(v_headers->>'x-ghost-token', v_headers->>'x-nearify-ghost-token');

  if v_ghost_token is null then
    raise exception 'Missing ghost token';
  end if;

  if not exists (
    select 1
    from public.ghost_participants gp
    where gp.id = p_ghost_id
      and gp.ghost_token = v_ghost_token
      and (
        gp.claimed_by_profile_id is null
        or gp.claimed_by_profile_id = p_profile_id
      )
  ) then
    raise exception 'Ghost claim not allowed';
  end if;

  update public.interaction_events ie
  set claimed_by_profile_id = p_profile_id
  where ie.from_ghost_id = p_ghost_id
    and (
      ie.claimed_by_profile_id is null
      or ie.claimed_by_profile_id = p_profile_id
    );

  get diagnostics v_interactions_claimed = row_count;

  update public.ghost_participants gp
  set claimed_by_profile_id = p_profile_id
  where gp.id = p_ghost_id
    and gp.ghost_token = v_ghost_token
    and (
      gp.claimed_by_profile_id is null
      or gp.claimed_by_profile_id = p_profile_id
    );

  get diagnostics v_ghosts_claimed = row_count;

  return jsonb_build_object(
    'ghost_id', p_ghost_id,
    'claimed_by_profile_id', p_profile_id,
    'interactions_claimed', v_interactions_claimed,
    'ghost_sessions_updated', v_ghosts_claimed
  );
end;
$$;

revoke all on function public.claim_ghost_activity(uuid, uuid) from public;
grant execute on function public.claim_ghost_activity(uuid, uuid) to authenticated;
