-- Nearify: compute_interaction_intelligence is server-side only.

-- Applied 2026-11-15 after confirming nearify-ios has no callers:
revoke execute on function public.compute_interaction_intelligence(uuid) from authenticated;
