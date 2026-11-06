// These details can be copied to support. Never include raw server messages,
// QR URLs, guest tokens, profile IDs, or names.
export function guestSaveDiagnostic(error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{2,24}$/i.test(error.code)
    ? error.code.toUpperCase() : 'NETWORK_OR_UNKNOWN';
  const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599
    ? error.status : null;
  return { operation:'record_ghost_connection', code, status, build:'guest-save-20261106-1' };
}
export function guestSaveFailure(error, status) {
  const safe = guestSaveDiagnostic({...error,status:status ?? error?.status});
  const failure = new Error('Guest connection save failed');
  failure.code = safe.code;
  failure.status = safe.status;
  failure.sessionInvalid = /ghost (participant|session) not found/i.test(error?.message || '');
  return failure;
}
export function guestSaveFailureMessage(error) {
  if (error?.sessionInvalid || error?.code === 'GUEST_SESSION_MISSING') return "Your guest session couldn't be verified. Your saved session is still on this device. Try signing in to recover your connections.";
  if (error?.code === '23505') return "A matching save may already exist, but we couldn't verify it. Check your saved connections or share the support details below.";
  return "The connection couldn't be saved. Share the support details below so we can identify the cause.";
}
