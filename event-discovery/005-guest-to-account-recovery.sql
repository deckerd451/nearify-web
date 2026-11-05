-- Guest-to-account recovery, phase 1: durable guest-to-guest saves.
-- REVIEW AND RUN MANUALLY IN SUPABASE SQL EDITOR, AFTER MERGE.
-- Existing guest edges remain intact; no public table reads.
begin;

-- A claimed guest's outbound saves belong to the claiming profile. The
-- target may still be a guest or may have claimed a different account.
-- No rows are copied or deleted: ghost_guest_connections is the durable record.
create index if not exists ghost_guest_connections_from_idx
  on public.ghost_guest_connections(from_ghost_id, created_at desc);

-- Token- and JWT-verified atomic claim. The original claim_ghost_activity
-- remains unchanged until the web client is migrated to this RPC.
create or replace function public.claim_guest_network(
  p_ghost_id uuid, p_ghost_token text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_claimed_by uuid;
  v_claimed_interactions int := 0;
  v_guest_edges int := 0;
begin
  select p.id into v_profile_id from public.profiles p
  where p.user_id = auth.uid() limit 1;
  if v_profile_id is null then
    raise exception 'Authenticated Nearify profile required' using errcode = 'P0001';
  end if;
  -- Lock the guest to prevent concurrent claims by different accounts.
  select gp.claimed_by_profile_id into v_claimed_by
  from public.ghost_participants gp
  where gp.id = p_ghost_id and gp.ghost_token = p_ghost_token
  for update;
  if not found or (v_claimed_by is not null and v_claimed_by <> v_profile_id) then
    raise exception 'Guest claim not allowed' using errcode = 'P0001';
  end if;

  update public.interaction_events ie
  set claimed_by_profile_id = v_profile_id
  where ie.from_ghost_id = p_ghost_id
    and (ie.claimed_by_profile_id is null or ie.claimed_by_profile_id = v_profile_id);
  get diagnostics v_claimed_interactions = row_count;

  update public.ghost_participants gp
  set claimed_by_profile_id = v_profile_id
  where gp.id = p_ghost_id and gp.ghost_token = p_ghost_token
    and (gp.claimed_by_profile_id is null or gp.claimed_by_profile_id = v_profile_id);

  select count(*) into v_guest_edges from public.ghost_guest_connections gc
  where gc.from_ghost_id = p_ghost_id;
  return jsonb_build_object(
    'profile_id', v_profile_id,
    'interactions_claimed', v_claimed_interactions,
    'guest_connections_preserved', v_guest_edges
  );
end;
$$;

-- Account-scoped read of all outbound saved guest edges, including targets
-- that subsequently claimed an account. No reciprocal connection implied.
create or replace function public.get_my_claimed_guest_connections()
returns table (
  connection_id uuid,
  event_id uuid,
  event_name text,
  guest_name text,
  target_profile_id uuid,
  connected_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select gc.id, gc.event_id, e.name::text,
         coalesce(nullif(gp.display_name, ''), 'Guest')::text,
         gp.claimed_by_profile_id, gc.created_at
  from public.ghost_guest_connections gc
  join public.ghost_participants owner_gp on owner_gp.id = gc.from_ghost_id
  join public.ghost_participants gp on gp.id = gc.to_ghost_id
  join public.events e on e.id = gc.event_id
  join public.profiles p on p.id = owner_gp.claimed_by_profile_id
  where p.user_id = auth.uid()
  order by gc.created_at desc
  limit 500;
$$;

revoke all on function public.claim_guest_network(uuid, text) from public, anon;
revoke all on function public.get_my_claimed_guest_connections() from public, anon;
grant execute on function public.claim_guest_network(uuid, text) to authenticated;
grant execute on function public.get_my_claimed_guest_connections() to authenticated;
commit;

-- Verification after deployment (authenticated session required for RPCs):
-- select * from public.get_my_claimed_guest_connections();
-- No guest tokens, share codes, or other attendees' connections are returned.
