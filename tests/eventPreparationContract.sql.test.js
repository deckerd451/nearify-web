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
 await db.exec("alter table events add column name text;alter table events add column starts_at timestamptz;alter table events add column ends_at timestamptz;alter table profiles add column if not exists avatar_url text;alter table profiles add column if not exists interests text[];alter table profiles add column if not exists skills text[];create table event_attendees(profile_id uuid,event_id uuid,status text,joined_at timestamptz default now(),intent_primary text,intent_secondary text);create table event_discovery_preferences(event_id uuid,profile_id uuid,discoverable boolean);");
 await db.exec(read('event-discovery/consented-attendees-rpc.sql'));
 for(const f of ['009-web-follow-up.sql','010-connection-permissions.sql','011-ambient-context.sql','012-ambient-intentions-prep.sql','013-ambient-review-feedback.sql','014-event-preparation-contract.sql','015-event-connection-people.sql'])await db.exec(read('event-discovery/'+f));
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


async function sharePerson(i=1){await admin();await db.query("insert into event_attendees(profile_id,event_id,status) values($1,$2,'joined')",[ids[i],event]);await db.query('insert into event_discovery_preferences values($1,$2,true)',[event,ids[i]]);await actor(0);}
describe('pre-check-in discovery contract',()=>{
 it('verifies deployment',async()=>{await admin();expect((await db.query(read('event-discovery/014-event-preparation-contract-verify.sql'))).rows.every(x=>x.passed)).toBe(true);});
 it('returns opted-in members to a joined caller without requiring live check-in or Engine linking',async()=>{
  await prepFixture();await sharePerson();const list=await call('get_event_preparation_people',[event]);
  expect(list).toEqual([{profile_id:ids[1],name:'Person 1',avatar_url:null}]);
  expect(list[0]).not.toHaveProperty('email');expect(list[0]).not.toHaveProperty('note');
  expect(await call('web_can_message',[ids[1]])).toBe(false);
  await admin();expect((await db.query('select status from event_attendees where profile_id=$1',[ids[0]])).rows[0].status).toBe('joined');
 });
 it('honors opt-out, membership and exact event boundaries',async()=>{
  await prepFixture();await sharePerson();await admin();await db.exec('update event_discovery_preferences set discoverable=false');await actor(0);expect(await call('get_event_preparation_people',[event])).toEqual([]);
  await actor(2);expect(await call('get_event_preparation_people',[event])).toEqual([]);
  await actor(0);expect(await call('get_event_preparation_people',[past])).toEqual([]);
 });
 it('excludes blocked and dismissed people in both connection orientations',async()=>{
  await prepFixture();await sharePerson();await call('ambient_person_dismiss',[ids[1],true]);expect(await call('get_event_preparation_people',[event])).toEqual([]);
  await call('ambient_person_dismiss',[ids[1],false]);await actor(1);await call('web_contact_action',[ids[0],'block']);await actor(0);expect(await call('get_event_preparation_people',[event])).toEqual([]);
 });
 it('denies anonymous calls and caps suggestions at three',async()=>{
  await prepFixture();await sharePerson();
  await admin();for(let i=4;i<9;i++){
   const id='00000000-0000-4000-8000-'+String(i).padStart(12,'0');
   await db.query('insert into profiles(id,name) values($1,$2)',[id,'Member '+i]);await db.query("insert into event_attendees(profile_id,event_id,status) values($1,$2,'joined')",[id,event]);await db.query('insert into event_discovery_preferences values($1,$2,true)',[event,id]);
  }await actor(0);expect(await call('get_event_preparation_people',[event])).toHaveLength(3);
  await admin();await db.exec('set role anon');await expect(call('get_event_preparation_people',[event])).rejects.toThrow(/permission denied/);
 });
});

describe('event connection people',()=>{
 it('connects strangers without a QR save, requires acceptance, and shares no personal details',async()=>{
  await admin();
  await db.query("insert into events(id,name) values($1,'Meetup')",[event]);
  await db.query("insert into event_attendees(profile_id,event_id,status) values($1,$3,'joined'),($2,$3,'joined')",[ids[0],ids[1],event]);
  await db.query('insert into event_discovery_preferences values($1,$2,true)',[event,ids[1]]);
  await actor(0);
  expect(await call('get_event_connection_people',[event])).toHaveLength(1);
  expect((await call('web_contact_action',[ids[1],'request'])).can_message).toBe(false);
  await expect(call('web_open_conversation',[ids[1]])).rejects.toThrow();
  await actor(1);await call('web_contact_action',[ids[0],'approve']);await actor(0);
  const state=await call('web_followup_state',[ids[1]]);
  expect(state.can_message).toBe(true);expect(state.contact).toBeNull();
  expect(await call('web_open_conversation',[ids[1]])).toBeTruthy();
  await admin();expect((await db.query('select count(*)::int n from account_qr_saves')).rows[0].n).toBe(0);
  expect((await db.query(read('event-discovery/015-event-connection-people-verify.sql'))).rows.every(x=>x.passed)).toBe(true);
 });

 it('lists beyond three, preserves opt-in, denies unrelated events and creates no connection',async()=>{
  await prepFixture();await sharePerson();
  await admin();for(let i=4;i<8;i++){
   const id='00000000-0000-4000-8000-'+String(i).padStart(12,'0');
   await db.query('insert into profiles(id,name) values($1,$2)',[id,'Member '+i]);
   await db.query("insert into event_attendees(profile_id,event_id,status) values($1,$2,'joined')",[id,event]);
   await db.query('insert into event_discovery_preferences values($1,$2,true)',[event,id]);
  }await actor(0);
  expect(await call('get_event_connection_people',[event])).toHaveLength(5);
  expect(await call('get_event_connection_people',[past])).toEqual([]);
  expect((await call('web_followup_state',[ids[1]])).can_message).toBe(false);
  await admin();await db.query('update event_discovery_preferences set discoverable=false where profile_id=$1',[ids[1]]);
  await actor(0);expect((await call('get_event_connection_people',[event])).some(p=>p.profile_id===ids[1])).toBe(false);
 });
 it('excludes blocks in either direction and rejects anonymous callers',async()=>{
  await prepFixture();await sharePerson();await call('web_contact_action',[ids[1],'block']);
  expect(await call('get_event_connection_people',[event])).toEqual([]);
  await call('web_contact_action',[ids[1],'unblock']);await actor(1);await call('web_contact_action',[ids[0],'block']);await actor(0);
  expect(await call('get_event_connection_people',[event])).toEqual([]);
  await admin();await db.exec('set role anon');await expect(call('get_event_connection_people',[event])).rejects.toThrow(/permission denied/);
 });
});
