# Community Signal — security and privacy audit (2026-11-01)

## Scope and status

Repository review only. Production Supabase was not queried by this review. Earlier manual checks confirmed that both tables had RLS enabled and five policies/two RPCs existed, but did **not** verify their complete definitions, grants, function ownership, or behavior under a third account. Do not describe this as a penetration test or production authorization certification.

**Important drift:** `community-signal/migration.sql` is the original prototype migration and is **not** the revised transactional SQL applied manually to production. Do **not** rerun that file against production. In particular, its `community_signal_discover()` definition does not require the caller to opt in, whereas the revised production migration does. Its `community_signal_send()` also differs in duplicate and rate-limit handling. A future deployment should use a reviewed, versioned migration after inspecting the live function definitions.

## Expected security invariants

1. Only an authenticated user can view or update their own `community_signal_preferences` row.
2. Only the sender or recipient can select a `community_signals` row; direct client INSERT/UPDATE/DELETE on signals is denied.
3. Discovery returns other participants only if the **caller** and **candidate** are both opted in.
4. Sending requires both sender and recipient opted in; sending to oneself is forbidden; the rate limit is 10 new signals per rolling 24 hours.
5. Opting out immediately prevents new signals and removes the account from discovery. Historical signals remain visible to their original participants, per the interface disclosure.

## Read-only SQL checks (run in Supabase SQL Editor)

```sql
-- Inspect exact policies, not just their names.
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname='public'
  and tablename in ('community_signal_preferences','community_signals')
order by tablename, policyname;

-- Inspect RPC definitions and security-definer settings.
select p.proname, p.prosecdef, p.proconfig,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('community_signal_discover','community_signal_send')
order by p.proname;

-- Inspect table privileges by role.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and table_name in ('community_signal_preferences','community_signals')
order by table_name, grantee, privilege_type;

-- Inspect function execution privileges (includes PUBLIC defaults).
select p.proname,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('community_signal_discover','community_signal_send');
```

Expected: `anon_execute=false`, `authenticated_execute=true`, security definer enabled with restricted `search_path`. The function definitions must include the caller opt-in and target opt-in checks. SQL Editor generally executes as a privileged role, so it cannot by itself prove client RLS behavior.

## Authenticated behavioral checks

Use **three** test accounts (A, B, C), each in a separate browser profile, and use the normal Supabase client with each account's session. Never use the service-role key in a browser.

- A and B opted in; C opted out: A discovers B but not C; C discovers nobody.
- A sends to B successfully. A sending to C or A is rejected.
- B opts out: A can no longer discover B or send new signals to B; their historical A/B signals remain visible to A and B.
- C cannot read A/B signals or any other user's preferences. A can read only A's preferences.
- Direct client writes to `community_signals` are rejected.
- Confirm duplicate sends don't consume an additional daily slot and 11th *new* acknowledgement in 24 hours is rejected (prefer isolated test users).

## Remaining risks / product gaps

- The current frontend displays an **Acknowledge back** action for a historical signal even when its sender has opted out. The server should reject the attempt; the interface cannot reliably infer eligibility from discovery because discovery is limited to 50 members. Fix this with a dedicated server-validated recipient-eligibility/status endpoint, not a client-side guess.
- Discovery is capped at 50 members. This can cause incomplete name resolution and discovery as the community grows.
- The frontend now fetches all accessible history in batches; a dedicated server-side paginated API and server-calculated mutual counts would scale better.
- No authenticated negative tests or production grant/function-definition verification have yet been executed as part of this review.

## Release gate

Do not widen access based on this document alone. Confirm production SQL definitions and grants, run three-account negative tests, and review the resulting evidence before declaring the feature privacy-verified.
