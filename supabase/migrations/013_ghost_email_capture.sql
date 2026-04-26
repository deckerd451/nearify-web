-- Allow ghost participants to optionally provide an email for post-event recap
alter table public.ghost_participants
  add column if not exists email text,
  add column if not exists email_captured_at timestamptz;

-- RPC: store email for a ghost participant using their token
create or replace function public.set_ghost_email(
  p_ghost_id    uuid,
  p_ghost_token text,
  p_email       text
)
returns void
language plpgsql
security definer
as $$
begin
  update public.ghost_participants
  set
    email              = p_email,
    email_captured_at  = now()
  where
    id           = p_ghost_id
    and ghost_token = p_ghost_token
    and claimed_by_profile_id is null; -- don't overwrite if already claimed
end;
$$;

grant execute on function public.set_ghost_email(uuid, text, text) to anon, authenticated;
