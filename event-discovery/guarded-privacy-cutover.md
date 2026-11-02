# Guarded privacy cutover — normal workflow

## Scope

This branch advances the database lockdown without requiring the user to choose a staging provider or install Docker. It does **not** apply SQL to the hosted database.

## Known production exposure

- `event_attendees` has an authenticated `USING (true)` SELECT policy.
- `profiles` has an authenticated `USING (true)` SELECT policy. RLS alone cannot protect email and phone columns from a broadly readable row.
- `get_public_event_attendees(uuid)` is callable by anonymous clients.
- Consent foundation and consented roster RPCs were not installed at the last production inventory.

## Proposed cutover order

1. Capture an encrypted logical database backup, verify that it contains schema, data, RLS policies and functions, and perform a restoration check before irreversible changes.
2. Run `cutover-catalog-verification.sql` and the existing `privacy-exposure-report.sql` against the target database. Match the exact policy definitions and grants.
3. Install the reviewed consent foundation, consented attendee RPC and organizer aggregate RPC; confirm their definitions and dependencies against the current schema.
4. Replace broad attendance SELECT with an owner-only read and narrowly scoped server RPCs. Remove broad profile SELECT; provide a dedicated public projection without email, phone, or private fields if web/iOS require it.
5. Revoke anonymous and unnecessary execution of the legacy roster RPC. Review other SECURITY DEFINER functions and their grants.
6. Validate with anonymous and distinct authenticated JWTs; test web guest join/save/claim and iOS join, restore, heartbeat, leave and rejoin.
7. Prepare exact inverse DDL and a tested restore procedure before any production execution.

## Stop conditions

Do not execute cutover DDL if the catalog differs from expected policy names, the backup cannot be restored, another permissive policy remains, the client compatibility tests fail, or the operator has not explicitly authorized the production execution. The small dataset does not remove the risk of exposing real people's contact details or attendance.

## Operational note

PR merge is not deployment. This document is a release specification, not a claim that production is secured.
