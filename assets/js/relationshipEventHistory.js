function time(value) {
  const result = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(result) ? result : null;
}
export function summarizeRelationshipEvents(events, now = Date.now()) {
  const unique = [...new Map(events.filter(event=>event?.event_id).map(event=>[event.event_id,event])).values()];
  const activities = unique.map(event=>{
    const saved = [time(event.qr_saved_at),time(event.guest_saved_at)].filter(value=>value!==null&&value<=now);
    const scheduled = time(event.event_at);
    const at = saved.length ? Math.max(...saved) : scheduled!==null&&scheduled<=now ? scheduled : null;
    return {event,at};
  }).filter(activity=>activity.at!==null).sort((a,b)=>a.at-b.at);
  return {
    encounter_count:unique.length,
    first_encounter_event_name:activities[0]?.event.event_name || null,
    first_encounter_at:activities.length ? new Date(activities[0].at).toISOString() : null,
    last_encounter_event_name:activities.at(-1)?.event.event_name || null,
    last_encounter_at:activities.length ? new Date(activities.at(-1).at).toISOString() : null,
  };
}
export function relationshipEventLabel(event, now = Date.now()) {
  const parts=[event.event_name || 'Event'];
  const scheduled=time(event.event_at);
  if(scheduled!==null){
    parts.push(new Date(scheduled).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}));
    if(scheduled>now) parts.push('Upcoming event');
  }
  if(event.qr_saved){
    parts.push(event.qr_saved_by_you ? 'You saved via QR' : 'Saved via QR');
    const saved=time(event.qr_saved_at);
    if(saved!==null) parts.push('Saved '+new Date(saved).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}));
  }
  if(event.recovered_guest_connection) parts.push('Saved as guests');
  return parts.join(' · ');
}
