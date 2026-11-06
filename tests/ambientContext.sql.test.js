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
 for(const f of ['009-web-follow-up.sql','010-connection-permissions.sql','011-ambient-context.sql'])await db.exec(read('event-discovery/'+f));
},30000);
beforeEach(async()=>{
 await admin();await db.exec('truncate public.profiles cascade');
 for(let i=0;i<3;i++)await db.query('insert into profiles(id,user_id,name) values($1,$2,$3)',[ids[i],users[i],'Person '+i]);await actor(0);
});
afterAll(async()=>await db?.close());
describe('owner-only ambient conversation context',()=>{
 it('passes deployment verification',async()=>{await admin();const rows=(await db.query(read('event-discovery/011-ambient-context-verify.sql'))).rows;expect(rows).toHaveLength(2);expect(rows.every(x=>x.passed)).toBe(true);});
 it('stores one directional note and does not grant messaging or disclose contact details',async()=>{
  await savePerson();await call('ambient_context_save',[ids[1],'Community project']);
  expect((await call('ambient_context',[ids[1]])).note).toBe('Community project');
  expect(await call('web_can_message',[ids[1]])).toBe(false);
  expect((await call('ambient_contexts'))[0]).toMatchObject({note:'Community project',can_message:false});
  expect((await call('web_followup_state',[ids[1]])).contact).toBeNull();
  await actor(1);expect((await call('ambient_context',[ids[0]])).note).toBe('');expect(await call('ambient_contexts')).toEqual([]);
  await actor(2);expect((await call('ambient_context',[ids[1]])).note).toBe('');
 });
 it('rejects strangers, self, oversized notes, anonymous RPCs and direct table access',async()=>{
  await expect(call('ambient_context_save',[ids[1],'Unrelated'])).rejects.toThrow(/Save this person/);
  await expect(call('ambient_context_save',[ids[0],'Self'])).rejects.toThrow();
  await savePerson();await expect(call('ambient_context_save',[ids[1],'x'.repeat(1001)])).rejects.toThrow(/1000/);
  await expect(db.query('select * from relationship_context_private')).rejects.toThrow(/permission denied/);
  await admin();await db.exec('set role anon');await expect(call('ambient_contexts')).rejects.toThrow(/permission denied/);
 });
 it('snoozes only the caller and unchanged saves do not restart the recommendation',async()=>{
  await savePerson();const original=await call('ambient_context_save',[ids[1],'A project']);
  await call('ambient_context_snooze',[ids[1]]);const snoozed=await call('ambient_context',[ids[1]]);
  expect(new Date(snoozed.snoozed_until).getTime()).toBeGreaterThan(Date.now()+6*86400000);
  await call('ambient_context_save',[ids[1],'A project']);const same=await call('ambient_context',[ids[1]]);
  expect(same.updated_at).toBe(original.updated_at);expect(same.snoozed_until).toBe(snoozed.snoozed_until);
  await actor(1);await call('ambient_context_snooze',[ids[0]]);await actor(0);
  expect((await call('ambient_context',[ids[1]])).snoozed_until).toBe(snoozed.snoozed_until);
  await call('ambient_context_save',[ids[1],'A different project']);expect((await call('ambient_context',[ids[1]])).snoozed_until).toBeNull();
 });
 it('excludes blocked recommendations and allows owner deletion after blocking',async()=>{
  await savePerson();await call('ambient_context_save',[ids[1],'Private']);await call('web_contact_action',[ids[1],'block']);
  expect(await call('ambient_contexts')).toEqual([]);
  await call('ambient_context_save',[ids[1],'']);expect((await call('ambient_context',[ids[1]])).note).toBe('');
 });
 it('records outbound messages without inferring attendance or sharing a note',async()=>{
  await savePerson();await call('web_contact_action',[ids[1],'request']);await actor(1);await call('web_contact_action',[ids[0],'approve']);await actor(0);
  await call('ambient_context_save',[ids[1],'Secret note']);const conversation=await call('web_open_conversation',[ids[1]]);
  await call('web_send_message',[conversation,'Hello',ids[2]]);const context=(await call('ambient_contexts'))[0];
  expect(context.can_message).toBe(true);expect(context.latest_outbound_at).toBeTruthy();
  await actor(1);expect((await call('ambient_context',[ids[0]])).note).toBe('');
 });
 it('reruns without destroying notes',async()=>{
  await savePerson();await call('ambient_context_save',[ids[1],'Keep this']);await admin();await db.exec(read('event-discovery/011-ambient-context.sql'));await actor(0);
  expect((await call('ambient_context',[ids[1]])).note).toBe('Keep this');
 });
});
