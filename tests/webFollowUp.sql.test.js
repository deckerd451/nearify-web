import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const users=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
const messageId='44444444-4444-4444-8444-444444444444';
let db;
async function actor(index){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[users[index]]);await db.exec('set role authenticated');}
async function call(name,args=[]){return (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;}
async function accept(){await call('web_contact_action',[ids[1],'request']);await actor(1);await call('web_contact_action',[ids[0],'approve']);await actor(0);}
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`
 create role authenticated; create role anon; create schema auth;
 grant usage on schema public,auth to authenticated,anon;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.profiles(id uuid primary key,user_id uuid,name text);
 create table public.events(id uuid primary key);
 create table public.connections(id uuid primary key default gen_random_uuid(),requester_profile_id uuid not null references public.profiles(id),addressee_profile_id uuid not null references public.profiles(id),event_id uuid references public.events(id),status text check(status in('suggested','pending','accepted','ignored','blocked')),created_at timestamptz default now(),updated_at timestamptz default now(),unique(requester_profile_id,addressee_profile_id,event_id));
 create function public.current_profile_id() returns uuid language sql stable security definer set search_path='' as $$select id from public.profiles where user_id=auth.uid() limit 1$$;
 `);
 const migration=fs.readFileSync(new URL('../event-discovery/009-web-follow-up.sql',import.meta.url),'utf8');
 await db.exec(migration);
 // Reapplying is safe. Broad old policies cannot bypass the restrictive guards.
 await db.exec(migration);
 await db.exec(`create policy old_permissive_conversations on public.conversations for all to authenticated using(true) with check(true);
 create policy old_permissive_messages on public.messages for all to authenticated using(true) with check(true);
 create policy old_permissive_reads on public.conversation_reads for all to authenticated using(true) with check(true);`);
},30000);
beforeEach(async()=>{
 await db.exec('reset role; truncate public.messages,public.conversation_reads,public.conversations,public.connections,public.events,public.profiles cascade');
 for(let i=0;i<3;i++)await db.query('insert into public.profiles(id,user_id,name) values($1,$2,$3)',[ids[i],users[i],'Person '+i]);
 await actor(0);
});
afterAll(async()=>await db?.close());
describe('shared iOS/web follow-up on PostgreSQL',()=>{
 it('keeps a saved person separate from contact approval and exposes no unapproved details',async()=>{
  expect(await call('web_followup_state',[ids[1]])).toMatchObject({status:'none',can_message:false,contact:null});
  expect(await call('web_contact_action',[ids[1],'request'])).toMatchObject({status:'pending',can_message:false,contact:null});
  await expect(call('web_open_conversation',[ids[1]])).rejects.toThrow(/Approved contact exchange/);
  await actor(1);
  expect((await call('web_inbox')).requests).toEqual([{profile_id:ids[0],name:'Person 0'}]);
  expect(await call('web_inbox_badge')).toBe(1);
  expect(await call('web_contact_action',[ids[0],'approve'])).toMatchObject({status:'accepted',can_message:true});
  await actor(0);expect((await call('web_followup_state',[ids[1]])).can_message).toBe(true);
 });
 it('does not let requesters approve their own outgoing request or produce duplicates',async()=>{
  await call('web_contact_action',[ids[1],'request']);await call('web_contact_action',[ids[1],'request']);
  expect((await call('web_contact_action',[ids[1],'approve'])).status).toBe('pending');
  await db.exec('reset role');expect((await db.query('select count(*)::int n from connections')).rows[0].n).toBe(1);
 });
 it('uses an existing accepted iOS connection and reuses the iOS thread in either orientation',async()=>{
  await db.exec('reset role');
  await db.query("insert into connections(requester_profile_id,addressee_profile_id,status) values($1,$2,'accepted')",[ids[1],ids[0]]);
  const {rows}=await db.query('insert into conversations(participant_a,participant_b) values($1,$2) returning id',[ids[1],ids[0]]);
  await actor(0);expect(await call('web_open_conversation',[ids[1]])).toBe(rows[0].id);
  await actor(1);expect(await call('web_open_conversation',[ids[0]])).toBe(rows[0].id);
 });
 it('rejects direct conversation creation without approval even under a broad old policy',async()=>{
  await expect(db.query('insert into conversations(participant_a,participant_b) values($1,$2)',ids.slice(0,2))).rejects.toThrow(/row-level security/);
  await expect(call('web_contact_action',[ids[0],'request'])).rejects.toThrow(/Invalid person/);
 });
 it('shares one text thread, supports idempotent retries and persists read state for iOS',async()=>{
  await accept();const thread=await call('web_open_conversation',[ids[1]]);
  const first=await call('web_send_message',[thread,' Hello ',messageId]);
  expect(first.content).toBe('Hello');expect(await call('web_send_message',[thread,'Hello',messageId])).toEqual(first);
  await expect(call('web_send_message',[thread,'Different',messageId])).rejects.toThrow(/identifier unavailable/);
  await actor(1);
  expect((await call('web_inbox')).threads[0]).toMatchObject({id:thread,unread:true,preview:'Hello'});
  expect((await call('web_thread',[thread])).messages).toHaveLength(1);
  await call('web_mark_read',[thread,messageId]);expect((await call('web_inbox')).threads[0].unread).toBe(false);
  await db.exec('reset role');expect((await db.query('select profile_id,last_read_at from conversation_reads')).rows[0].profile_id).toBe(ids[1]);
 });
 it('accepts valid iOS-style direct inserts and returns them in the web thread',async()=>{
  await accept();
  const created=await db.query('insert into conversations(participant_a,participant_b) values($1,$2) returning id',[ids[0],ids[1]]);
  const thread=created.rows[0].id;
  await db.query('insert into messages(id,conversation_id,sender_profile_id,content) values($1,$2,$3,$4)',[messageId,thread,ids[0],'Sent from iOS']);
  await actor(1);expect((await call('web_thread',[thread])).messages[0].content).toBe('Sent from iOS');
  expect((await call('web_inbox')).threads[0].unread).toBe(true);
 });
 it('enforces sender and membership checks through RPC and direct RLS',async()=>{
  await accept();const thread=await call('web_open_conversation',[ids[1]]);
  await expect(db.query('insert into messages(conversation_id,sender_profile_id,content) values($1,$2,$3)',[thread,ids[1],'spoof'])).rejects.toThrow(/row-level security/);
  await actor(2);
  await expect(call('web_thread',[thread])).rejects.toThrow(/Conversation unavailable/);
  await expect(call('web_send_message',[thread,'intrusion',messageId])).rejects.toThrow(/Approved/);
  expect((await db.query('select * from conversations')).rows).toEqual([]);
  expect((await db.query('select * from messages')).rows).toEqual([]);
  await expect(db.query('insert into conversation_reads(conversation_id,profile_id) values($1,$2)',[thread,ids[2]])).rejects.toThrow(/row-level security/);
 });
 it('enforces block on both platforms while retaining past messages',async()=>{
  await accept();const thread=await call('web_open_conversation',[ids[1]]);
  await call('web_send_message',[thread,'Past message',messageId]);
  await call('web_contact_action',[ids[1],'block']);
  await actor(1);
  expect(await call('web_followup_state',[ids[0]])).toMatchObject({status:'blocked',can_message:false,contact:null});
  await expect(call('web_send_message',[thread,'blocked reply','55555555-5555-4555-8555-555555555555'])).rejects.toThrow(/Approved/);
  await expect(db.query('insert into messages(conversation_id,sender_profile_id,content) values($1,$2,$3)',[thread,ids[1],'bypass'])).rejects.toThrow(/row-level security/);
  expect((await call('web_thread',[thread])).messages).toHaveLength(1);
 });
 it('lets users undo only their own block without approving an exchange',async()=>{
  await call('web_contact_action',[ids[1],'block']);
  await actor(1);expect((await call('web_contact_action',[ids[0],'unblock'])).status).toBe('blocked');
  await actor(0);expect((await call('web_contact_action',[ids[1],'unblock'])).status).toBe('none');
  expect((await call('web_followup_state',[ids[1]])).can_message).toBe(false);
 });
 it('returns only opted-in email/phone and never login email or unapproved links',async()=>{
  await db.exec('reset role');await db.query("update profiles set public_email='shared@example.com',public_phone='+15555550100',share_email=false,share_phone=true,linkedin_url='https://linkedin.com/in/test',preferred_contact_method='phone' where id=$1",[ids[1]]);
  await actor(0);expect((await call('web_followup_state',[ids[1]])).contact).toBeNull();
  await accept();
  expect((await call('web_followup_state',[ids[1]])).contact).toMatchObject({email:null,phone:'+15555550100',linkedin:'https://linkedin.com/in/test',preferred:'phone'});
 });
 it('paginates stable timestamps with an id cursor and validates empty/oversized messages',async()=>{
  await accept();const thread=await call('web_open_conversation',[ids[1]]);
  await expect(call('web_send_message',[thread,' ',messageId])).rejects.toThrow(/1–4000/);
  await expect(call('web_send_message',[thread,'\n\t',messageId])).rejects.toThrow(/1–4000/);
  await expect(call('web_send_message',[thread,'x'.repeat(4001),messageId])).rejects.toThrow(/1–4000/);
  await db.exec('reset role');
  await db.query("insert into messages(conversation_id,sender_profile_id,content,created_at) select $1,$2,'row '||n,'2026-11-06T12:00:00Z'::timestamptz from generate_series(1,60) n",[thread,ids[0]]);
  await actor(1);const page=await call('web_thread',[thread]);expect(page.messages).toHaveLength(50);
  const cursor=page.messages[0];const older=await call('web_thread',[thread,cursor.created_at,cursor.id]);expect(older.messages).toHaveLength(10);
  expect(new Set([...page.messages,...older.messages].map(m=>m.id)).size).toBe(60);
 });
 it('keeps RPCs inaccessible to anonymous visitors',async()=>{
  await db.exec('reset role;set role anon');
  for(const [name,args] of [['web_inbox',[]],['web_followup_state',[ids[0]]],['web_contact_action',[ids[0],'approve']],['web_open_conversation',[ids[0]]]])await expect(call(name,args)).rejects.toThrow(/permission denied/);
  for(const table of ['conversations','messages','conversation_reads'])await expect(db.query('select * from public.'+table)).rejects.toThrow(/permission denied/);
 });
});
