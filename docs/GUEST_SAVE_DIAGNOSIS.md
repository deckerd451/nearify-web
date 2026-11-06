# Guest-to-member save diagnosis

A successful QR decode does not establish that `record_ghost_connection` succeeded.
The live failure reported during device testing has not been diagnosed from the
server response. Browser tests use simulated backend responses. Do not claim a
production fix solely from those tests.

## Repeat saves

Before a guest-to-member write, the client reads only that guest's token-scoped
`get_ghost_connection_history`. A matching event ID and target profile ID proves
an existing save and skips the write. If a write fails, history is checked again
for a concurrent save. A duplicate error alone is never treated as success.
History read failure does not fabricate a saved result or erase credentials.

## Safe error reference

Unresolved member-save errors have a **Details for support** disclosure on the
scanner and handoff error views. **Copy support details** copies only:

- Fixed operation name `record_ghost_connection`.
- Validated error code.
- HTTP status, if supplied by the client.
- Fixed frontend build identifier.

It excludes names, guest/profile IDs, QR links, guest tokens, response bodies,
SQL messages, hints, and details. The original generic error is no longer the
only evidence available. Clipboard denial leaves selectable reference text.

Examples of diagnostic leads, not confirmed production causes:

| Code | Inspect |
| --- | --- |
| `PGRST202` | Function signature and PostgREST schema cache |
| `42501` | Execute permissions and relevant access policies |
| `23502` | Required columns in the deployed interaction schema |
| `23514` | Deployed check constraints, including interaction type |
| `23505` | Unique constraint and authorized history verification |
| `P0001` | Function-specific rejection; inspect trusted server logs |
| `NETWORK_OR_UNKNOWN` | Browser request connectivity and client response |

Repository migrations contain several historical versions of the save function.
The deployed function and constraints must be verified before changing database
code. Do not disable constraints, broaden anonymous access, or bypass checks to
make a save pass.

The read-only SQL in `event-discovery/007-guest-save-diagnostic-readonly.sql`
reports schema metadata without reading guest records or invoking write RPCs.
It is intended for an existing authorized Supabase SQL-admin context and was
not executed against production during implementation.
