// Authenticated personal QR saves atomically save the relationship and per-event evidence.
// Guest credentials are neither created nor reused for this path.
export async function saveAccountConnection(client, eventId, targetProfileId) {
  try {
    const { data: profileId, error: profileError } = await client.rpc('current_profile_id');
    if (profileError || typeof profileId !== 'string' || !profileId) return {ok:false,reason:'profile_missing'};
    if (profileId.toLowerCase() === targetProfileId.toLowerCase()) return {ok:false,reason:'self'};
    const {data,error} = await client.rpc('save_account_qr_connection',{
      p_target_profile_id:targetProfileId,p_event_id:eventId,
    });
    if (error || data?.event_saved !== true || !['proposed','confirmed'].includes(data?.status)) return {ok:false,reason:'request_failed'};
    return {ok:true,profileId,status:data.status};
  } catch (_) { return {ok:false,reason:'request_failed'}; }
}
