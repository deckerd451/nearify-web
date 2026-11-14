import {describe,it,expect} from 'vitest';
import {chooseEventSuggestion} from '../assets/js/eventSuggestionPolicy.js';
const self={id:'me',interests:['AI'],skills:['JavaScript']};
const alex={profile_id:'alex',name:'Alex',interests:[' ai ']};
const sam={profile_id:'sam',name:'Sam',skills:['javascript']};
describe('one explained event suggestion',()=>{
 it('uses a shared interest with a concrete reason',()=>{
  const choice=chooseEventSuggestion({people:[alex],self});
  expect(choice.person).toEqual(alex);expect(choice.reason).toBe('You both list ai as an interest.');
 });
 it('uses an exact shared skill without claiming a goal match',()=>expect(chooseEventSuggestion({people:[sam],self}).reason).toBe('You both list javascript as a skill.'));
 it('does not infer a match from related terms or previous encounters',()=>{
  expect(chooseEventSuggestion({people:[{...alex,interests:['Artificial intelligence'],encounter_count:5}],self})).toBeNull();
 });
 it('prioritizes a private intention and preserves its source',()=>{
  const result=chooseEventSuggestion({people:[alex,sam],self,contexts:[{profile_id:'sam',intention:'Ask about the prototype',previous_event_name:'Workshop'}]});
  expect(result.person.profile_id).toBe('sam');expect(result.reason).toBe('Ask about the prototype');expect(result.source).toBe('context');expect(result.previousEventName).toBe('Workshop');
 });
 it('does not use private context as evidence of listing or attendance',()=>{
  expect(chooseEventSuggestion({contexts:[{profile_id:'alex',note:'A reminder',opted_in_listing:true}],self})).toBeNull();
  const result=chooseEventSuggestion({contexts:[{profile_id:'alex',note:'A reminder',saved_for_event:true}],self});
  expect(result.listed).toBe(false);expect(result.source).toBe('context');
 });
 it('excludes self and completed intentions',()=>{
  expect(chooseEventSuggestion({people:[{...alex,profile_id:'me'}],self})).toBeNull();
  expect(chooseEventSuggestion({people:[{profile_id:'alex'}],contexts:[{profile_id:'alex',intention:'Done',intention_completed:true}],self})).toBeNull();
 });
 it('does not invent shared interests when the own-profile read is unavailable',()=>expect(chooseEventSuggestion({people:[alex]})).toBeNull());
 it('is stable across roster order and returns only one person',()=>{
  expect(chooseEventSuggestion({people:[sam,alex],self}).person.profile_id).toBe(chooseEventSuggestion({people:[alex,sam],self}).person.profile_id);
 });
});
