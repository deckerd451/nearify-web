import {describe,it,expect} from 'vitest';
import {summarizeRelationshipEvents,relationshipEventLabel} from '../assets/js/relationshipEventHistory.js';
const now=Date.parse('2026-11-06T18:00:00Z');
const upcoming={event_id:'nov17',event_name:'Show & Tell',event_at:'2026-11-17T22:30:00Z',qr_saved:true,qr_saved_by_you:true,qr_saved_at:'2026-11-06T17:00:00Z'};
describe('relationship event evidence',()=>{
 it('labels an upcoming event as a QR save rather than attendance',()=>{
  const label=relationshipEventLabel(upcoming,now);
  expect(label).toContain('Upcoming event');expect(label).toContain('You saved via QR');expect(label).toContain('Saved');
 });
 it('uses actual save time for latest activity, not the future event date',()=>{
  const result=summarizeRelationshipEvents([{event_id:'old',event_name:'Old',event_at:'2026-05-12T18:00:00Z'},upcoming],now);
  expect(result.encounter_count).toBe(2);expect(result.last_encounter_event_name).toBe('Show & Tell');
  expect(result.last_encounter_at).toBe('2026-11-06T17:00:00.000Z');expect(result.first_encounter_event_name).toBe('Old');
 });
 it('counts each event once and does not infer future activity without evidence',()=>{
  const future={event_id:'future',event_at:'2026-11-17'};
  expect(summarizeRelationshipEvents([future,future],now)).toMatchObject({encounter_count:1,first_encounter_at:null,last_encounter_at:null});
 });
 it('preserves recovered guest event labels and actual save dates',()=>{
  const guest={event_id:'guest',event_at:'2026-11-17',recovered_guest_connection:true,guest_saved_at:'2026-11-06T16:00:00Z'};
  expect(relationshipEventLabel(guest,now)).toContain('Saved as guests');
  expect(summarizeRelationshipEvents([guest],now).last_encounter_at).toBe('2026-11-06T16:00:00.000Z');
 });
});
