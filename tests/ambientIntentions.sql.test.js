import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const users=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
let db;
async function admin(){await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)");}
async function actor(i){await admin();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[users[i]]);await db.exec('set role authenticated');}
async function call(name,args=[]){return (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;}
async function savePerson(){await call('save_nearify_person',[ids[1],null]);}
beforeAll(async()=>{
 db=new PGlite();
 const base=read('tests/webFollowUp.sql.test.js').match(/await db\.exec\(`([\s\S]+?)`\);/)[1];await db.exec(base);
 await db.exec('create unique index fixture_profile_user_unique on profiles(user_id);create table public.account_qr_saves(from_profile_id uuid,to_profile_id uuid,event_id uuid,saved_at timestamptz default now());create table public.community_signals(sender_id uuid,recipient_id uuid);create table public.community_signal_preferences(user_id uuid primary key,discoverable boolean,receive_signals boolean);');
 await db.exec("alter table events add column name text;alter table events add column starts_at timestamptz;alter table profiles add column if not exists avatar_url text;alter table profiles add column if not exists interests text[];alter table profiles add column if not exists skills text[];create table event_attendees(profile_id uuid,event_id uuid,status text,joined_at timestamptz default now(),intent_primary text,intent_secondary text);create table event_discovery_preferences(event_id uuid,profile_id uuid,discoverable boolean);");
 await db.exec(read('event-discovery/consented-attendees-rpc.sql'));
 for(const f of ['009-web-follow-up.sql','010-connection-permissions.sql','011-ambient-context.sql','012-ambient-intentions-prep.sql'])await db.exec(read('event-discovery/'+f));
},30000);
beforeEach(async()=>{
 await admin();await db.exec('truncate public.profiles cascade;truncate event_attendees,event_discovery_preferences,account_qr_saves;delete from events');
 for(let i=0;i<3;i++)await db.query('insert into profiles(id,user_id,name) values($1,$2,$3)',[ids[i],users[i],'Person '+i]);await actor(0);
});
afterAll(async()=>await db?.close());

const event='44444444-4444-4444-8444-444444444444';
const past='55555555-5555-4555-8555-555555555555';
async function prepFixture(){
 await savePerson();await call('ambient_context_save_v2',[ids[1],'A private detail','Ask about the prototype']);
 await admin();
 await db.query("insert into events(id,name,starts_at) values($1,'Show and Tell',now()+interval '1 day'),($2,'Earlier event',now()-interval '20 days')",[event,past]);
 await db.query("insert into event_attendees(profile_id,event_id,status) values($1,$2,'joined')",[ids[0],event]);
 await actor(0);
}
describe('private intentions and factual event preparation',()=>{
 it('verifies deployment and retains legacy notes',async()=>{await admin();expect((await db.query(read('event-discovery/012-ambient-intentions-prep-verify.sql'))).rows.every(x=>x.passed)).toBe(true);});
 it('stores an intention separately and legacy note edits never erase it',async()=>{
  await savePerson();await call('ambient_context_save_v2',[ids[1],'Note','Send the demo']);
  await call('ambient_context_save',[ids[1],'Edited note']);expect((await call('ambient_context',[ids[1]])).intention).toBe('Send the demo');
  await call('ambient_context_save',[ids[1],'']);expect((await call('ambient_context',[ids[1]])).intention).toBe('Send the demo');
  await actor(1);expect((await call('ambient_context',[ids[0]])).intention).toBe('');
 });
 it('enforces length, saved-person eligibility, authentication and directional completion',async()=>{
  await expect(call('ambient_context_save_v2',[ids[1],'','Ask'])).rejects.toThrow(/Save this person/);
  await savePerson();await expect(call('ambient_context_save_v2',[ids[1],'','a'.repeat(281)])).rejects.toThrow(/280/);
  await call('ambient_context_save_v2',[ids[1],'','Ask about demo']);await actor(1);await call('ambient_intention_complete',[ids[0]]);await actor(0);
  expect((await call('ambient_context',[ids[1]])).intention_completed).toBe(false);
  await call('ambient_intention_complete',[ids[1]]);expect((await call('ambient_contexts'))[0].intention_completed).toBe(true);
  await admin();await db.exec('set role anon');await expect(call('ambient_event_prep',[event])).rejects.toThrow(/permission denied/);
 });
 it('does not reset completed work on unchanged saves, but new context can restart it',async()=>{
  await savePerson();await call('ambient_context_save_v2',[ids[1],'','Send demo']);await call('ambient_intention_complete',[ids[1]]);
  await call('ambient_context_save_v2',[ids[1],'','Send demo']);expect((await call('ambient_context',[ids[1]])).intention_completed).toBe(true);
  await call('ambient_context_save_v2',[ids[1],'','Ask for feedback']);expect((await call('ambient_context',[ids[1]])).intention_completed).toBe(false);
 });
 it('shows exact-event saves without inventing attendance or a previous-edition link',async()=>{
  await prepFixture();expect((await call('ambient_event_prep',[event])).people).toEqual([]);
  await admin();await db.query('insert into account_qr_saves values($1,$2,$3,now())',[ids[0],ids[1],event]);await actor(0);
  expect((await call('ambient_event_prep',[event])).people[0]).toMatchObject({profile_id:ids[1],saved_for_event:true,opted_in_listing:false,previous_event_name:null});
 });
 it('uses the consent-filtered roster and labels historical QR evidence separately',async()=>{
  await prepFixture();await admin();await db.query("insert into event_attendees(profile_id,event_id,status) values($1,$2,'joined')",[ids[1],event]);await db.query('insert into event_discovery_preferences values($1,$2,true)',[event,ids[1]]);
  await db.query('insert into account_qr_saves values($1,$2,$3,now())',[ids[0],ids[1],past]);await actor(0);
  const person=(await call('ambient_event_prep',[event])).people[0];expect(person).toMatchObject({opted_in_listing:true,saved_for_event:false,previous_event_name:'Earlier event'});
  expect(person).not.toHaveProperty('attending');
  await admin();await db.exec('update event_discovery_preferences set discoverable=false');await actor(0);
  expect((await call('ambient_event_prep',[event])).people).toEqual([]);
  await admin();await db.exec('update event_discovery_preferences set discoverable=true');await actor(0);
  await actor(1);expect((await call('ambient_event_prep',[event])).people).toEqual([]);
  await actor(2);expect((await call('ambient_event_prep',[event])).eligible).toBe(false);
  await actor(0);await call('web_contact_action',[ids[1],'block']);expect((await call('ambient_event_prep',[event])).people).toEqual([]);
 });
 it('requires a joined, near-term event and suppresses completed intentions',async()=>{
  await prepFixture();await admin();await db.query("insert into event_attendees(profile_id,event_id,status) values($1,$2,'joined')",[ids[1],event]);await db.query('insert into event_discovery_preferences values($1,$2,true)',[event,ids[1]]);await actor(0);
  await call('ambient_intention_complete',[ids[1]]);expect((await call('ambient_event_prep',[event])).people).toEqual([]);
  await admin();await db.query("update events set starts_at=now()+interval '30 days' where id=$1",[event]);await actor(0);
  expect((await call('ambient_event_prep',[event])).eligible).toBe(false);
 });
 it('respects Later in the preparation brief and clears both fields explicitly',async()=>{
  await prepFixture();await admin();await db.query('insert into account_qr_saves values($1,$2,$3,now())',[ids[0],ids[1],event]);await actor(0);
  await call('ambient_context_snooze',[ids[1]]);expect((await call('ambient_event_prep',[event])).people).toEqual([]);
  await call('ambient_context_save_v2',[ids[1],'','']);expect((await call('ambient_context',[ids[1]])).intention).toBe('');expect(await call('ambient_contexts')).toEqual([]);
 });
 it('reruns without losing intentions',async()=>{await savePerson();await call('ambient_context_save_v2',[ids[1],'Note','Send demo']);await admin();await db.exec(read('event-discovery/012-ambient-intentions-prep.sql'));await actor(0);expect((await call('ambient_context',[ids[1]])).intention).toBe('Send demo');});
});
