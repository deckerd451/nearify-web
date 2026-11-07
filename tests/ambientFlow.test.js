import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {resolveWebQr} from '../assets/js/webQr.js';
import {chooseAmbientHome} from '../assets/js/ambientHomePolicy.js';
const routes=JSON.parse(fs.readFileSync(new URL('./fixtures/nearify-qr-contract.json',import.meta.url),'utf8'));
describe('shared web/iOS QR route contract',()=>{
 for(const row of routes)it('classifies '+row.kind+' '+row.url.slice(-30),()=>{
  const path=resolveWebQr(row.url);
  if(row.kind==='invalid'){expect(path).toBeNull();return;}
  const url=new URL(path,'https://nearify.org');
  expect(url.searchParams.get('web')).toBe('1');
  expect(url.searchParams.has('guest')?'guest':url.searchParams.has('profile')?'member':'event').toBe(row.kind);
 });
});
const now=Date.now(), id='person';
const context={profile_id:id,note:'Private',can_message:true,updated_at:new Date(now-1000).toISOString()};
const ready={ready:true,inbox:{threads:[],requests:[],detail_requests:[]},contexts:[],extras:{dismissed_people:[],review:null},now};
describe('one useful Home action',()=>{
 it('prioritizes an unread message even when other reads fail',()=>expect(chooseAmbientHome({...ready,ready:false,inbox:{threads:[{id:'thread',unread:true}]}}).kind).toBe('unread'));
 it('prioritizes invitation and sharing review over optional event review',()=>{
  expect(chooseAmbientHome({...ready,inbox:{requests:[{profile_id:id}]},extras:{review:{event_id:'event'}}}).kind).toBe('invitation');
  expect(chooseAmbientHome({...ready,inbox:{detail_requests:[{profile_id:id}]},extras:{review:{}}}).kind).toBe('details');
 });
 it('chooses a review instead of a generic clear state or another suggestion',()=>expect(chooseAmbientHome({...ready,contexts:[context],extras:{review:{event_id:'event'}}}).kind).toBe('review'));
 it('does not manufacture an all-clear on failed optional reads',()=>expect(chooseAmbientHome({...ready,ready:false,event:{id:'event'}}).kind).toBe('unavailable'));
 it('uses context before an event, and suppresses sent/snoozed/hidden/completed context',()=>{
  expect(chooseAmbientHome({...ready,contexts:[context],event:{id:'event'}}).kind).toBe('context');
  for(const patch of [{latest_outbound_at:new Date(now).toISOString()},{snoozed_until:new Date(now+1000).toISOString()},{intention_completed:true}])expect(chooseAmbientHome({...ready,contexts:[{...context,...patch}]}).kind).toBe('idle');
  expect(chooseAmbientHome({...ready,contexts:[context],extras:{dismissed_people:[id]}}).kind).toBe('idle');
 });
 it('uses a known event when no follow-up is pending',()=>expect(chooseAmbientHome({...ready,event:{id:'event'}}).kind).toBe('event'));
 it('keeps a verified empty state quiet',()=>expect(chooseAmbientHome(ready)).toEqual({kind:'idle'}));
});
