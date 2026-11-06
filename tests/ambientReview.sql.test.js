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
 for(const f of ['009-web-follow-up.sql','010-connection-permissions.sql','011-ambient-context.sql','012-ambient-intentions-prep.sql','013-ambient-review-feedback.sql'])await db.exec(read('event-discovery/'+f));
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

describe('quiet optional reviews and persistent personal feedback',()=>{
 it('passes private-table and authenticated-only verification',async()=>{await admin();const rows=(await db.query(read('event-discovery/013-ambient-review-feedback-verify.sql'))).rows;expect(rows).toHaveLength(2);expect(rows.every(x=>x.passed)).toBe(true);});
 it('does not generate a review from history alone, and requires membership to record one',async()=>{
  await expect(call('ambient_review_record',[event,null])).rejects.toThrow(/membership/);
  await prepFixture();expect((await call('ambient_home_extras')).review).toBeNull();
  await call('ambient_review_record',[event,null]);expect((await call('ambient_home_extras')).review).toBeNull();
 });
 it('counts only caller QR saves, deduplicates people, and does not mutate participation',async()=>{
  await prepFixture();await admin();await db.query('insert into account_qr_saves values($1,$2,$3,now()),($1,$2,$3,now()),($2,$1,$3,now())',[ids[0],ids[1],event]);await actor(0);
  await call('ambient_review_record',[event,'2026-01-01T00:00:00Z']);const review=(await call('ambient_home_extras')).review;
  expect(review).toMatchObject({event_id:event,count:1});expect(review.people).toHaveLength(1);expect(review.people[0].profile_id).toBe(ids[1]);
  await admin();expect((await db.query('select status from event_attendees where profile_id=$1',[ids[0]])).rows[0].status).toBe('joined');
  await actor(1);expect((await call('ambient_home_extras')).review).toBeNull();
 });
 it('Later and Done persist; duplicate finish receipt cannot reopen a dismissed review',async()=>{
  await prepFixture();await admin();await db.query('insert into account_qr_saves values($1,$2,$3,now())',[ids[0],ids[1],event]);await actor(0);
  const start='2026-01-01T00:00:00Z';await call('ambient_review_record',[event,start]);await call('ambient_review_action',[event,'later']);expect((await call('ambient_home_extras')).review).toBeNull();
  await call('ambient_review_action',[event,'done']);await call('ambient_review_record',[event,start]);expect((await call('ambient_home_extras')).review).toBeNull();
  await call('ambient_review_record',[event,'2026-01-02T00:00:00Z']);expect((await call('ambient_home_extras')).review.count).toBe(1);
 });
 it('dismissal is directional, survives context edits, and can be restored',async()=>{
  await prepFixture();await call('ambient_person_dismiss',[ids[1],true]);
  expect((await call('ambient_home_extras')).dismissed_people).toEqual([ids[1]]);expect(await call('ambient_contexts')).toEqual([]);
  expect((await call('ambient_context',[ids[1]])).note).toBe('A private detail');expect((await call('ambient_context',[ids[1]])).suggestions_dismissed).toBe(true);
  await call('ambient_context_save_v2',[ids[1],'Changed note','New intention']);expect(await call('ambient_contexts')).toEqual([]);
  await actor(1);expect((await call('ambient_home_extras')).dismissed_people).toEqual([]);await call('ambient_person_dismiss',[ids[0],false]);
  await actor(0);expect((await call('ambient_home_extras')).dismissed_people).toEqual([ids[1]]);await call('ambient_person_dismiss',[ids[1],false]);expect((await call('ambient_contexts')).length).toBe(1);
 });
 it('excludes dismissed and blocked people from preparation and review but does not delete saves',async()=>{
  await prepFixture();await admin();await db.query('insert into account_qr_saves values($1,$2,$3,now())',[ids[0],ids[1],event]);await actor(0);await call('ambient_review_record',[event,null]);
  await call('ambient_person_dismiss',[ids[1],true]);expect((await call('ambient_home_extras')).review).toBeNull();expect((await call('ambient_event_prep',[event])).people).toEqual([]);
  await call('ambient_person_dismiss',[ids[1],false]);await call('web_contact_action',[ids[1],'block']);expect((await call('ambient_home_extras')).review).toBeNull();
  await admin();expect((await db.query('select count(*)::int n from account_qr_saves')).rows[0].n).toBe(1);
 });
 it('rejects anonymous and direct table access, invalid actions and future sessions',async()=>{
  await prepFixture();await expect(call('ambient_review_action',[event,'send'])).rejects.toThrow(/Invalid action/);
  await expect(call('ambient_review_record',[event,'2999-01-01T00:00:00Z'])).rejects.toThrow(/Invalid session/);
  await expect(db.query('select * from ambient_event_reviews')).rejects.toThrow(/permission denied/);
  await expect(db.query('select * from ambient_person_feedback')).rejects.toThrow(/permission denied/);
  await admin();await db.exec('set role anon');await expect(call('ambient_home_extras')).rejects.toThrow(/permission denied/);
 });
 it('reruns without restoring dismissed suggestions',async()=>{
  await prepFixture();await call('ambient_person_dismiss',[ids[1],true]);await admin();await db.exec(read('event-discovery/013-ambient-review-feedback.sql'));await actor(0);expect((await call('ambient_home_extras')).dismissed_people).toEqual([ids[1]]);
 });
 it('offers web-only review after a recorded end, and its Done action persists',async()=>{
  await prepFixture();await admin();await db.query('insert into account_qr_saves values($1,$2,$3,now())',[ids[0],ids[1],event]);await actor(0);
  expect((await call('ambient_home_extras')).review).toBeNull();
  await admin();await db.query("update events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",[event]);await actor(0);
  expect((await call('ambient_home_extras')).review.count).toBe(1);
  await call('ambient_review_action',[event,'done']);expect((await call('ambient_home_extras')).review).toBeNull();
 });

});
