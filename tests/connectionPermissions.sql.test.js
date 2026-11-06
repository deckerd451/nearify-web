import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const users=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
let db;
const migration=read('event-discovery/010-connection-permissions.sql');
async function admin(){await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)");}
async function actor(i){await admin();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[users[i]]);await db.exec('set role authenticated');}
async function call(name,args=[]){return (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;}
async function connect(){await actor(0);await call('web_contact_action',[ids[1],'request']);await actor(1);await call('web_contact_action',[ids[0],'approve']);await actor(0);}
async function prefs(){return call('contact_save_preferences',['alice@example.com','+15555550100','https://linkedin.com/in/alice','https://example.com',true,true,'email']);}
beforeAll(async()=>{
 db=new PGlite();
 const base=read('tests/webFollowUp.sql.test.js').match(/await db\.exec\(`([\s\S]+?)`\);/)[1];await db.exec(base);await db.exec('create unique index fixture_profile_user_unique on profiles(user_id)');
 await db.exec('create table public.account_qr_saves(from_profile_id uuid,to_profile_id uuid,event_id uuid,saved_at timestamptz default now());create table public.community_signals(sender_id uuid,recipient_id uuid);create table public.community_signal_preferences(user_id uuid primary key,discoverable boolean,receive_signals boolean);');
 await db.exec(read('event-discovery/009-web-follow-up.sql'));await db.exec(migration);
},30000);
beforeEach(async()=>{
 await admin();await db.exec('truncate public.messages,public.conversation_reads,public.conversations,public.connections,public.community_signals,public.community_signal_preferences,public.profiles cascade');
 for(let i=0;i<3;i++)await db.query('insert into profiles(id,user_id,name) values($1,$2,$3)',[ids[i],users[i],'Person '+i]);await actor(0);
});
afterAll(async()=>await db?.close());
describe('separate connection and personal-info permissions',()=>{
 it('passes the read-only deployment verifier',async()=>{
  await admin();const rows=(await db.query(read('event-discovery/010-connection-permissions-verify.sql'))).rows;
  expect(rows).toHaveLength(6);expect(rows.every(row=>row.passed===true)).toBe(true);
 });
 it('approval enables messaging but reveals no personal details in either direction',async()=>{
  await prefs();await connect();
  expect((await call('get_saved_people'))[0]).toMatchObject({profile_id:ids[1],messaging_approved:true});
  const state=await call('web_followup_state',[ids[1]]);expect(state).toMatchObject({permission_version:2,can_message:true,contact:null,shared_by_you:{}});
  await actor(1);expect((await call('web_followup_state',[ids[0]])).contact).toBeNull();
 });
 it('shares only selected fields, in one direction, and prevents raw profile/table bypass',async()=>{
  await prefs();await connect();await call('contact_details_action',[ids[1],'share',['email']]);
  await actor(1);expect((await call('web_followup_state',[ids[0]])).contact).toMatchObject({email:'alice@example.com'});
  expect((await call('web_followup_state',[ids[0]])).contact.phone).toBeUndefined();
  await actor(0);expect((await call('web_followup_state',[ids[1]])).contact).toBeNull();
  await admin();expect((await db.query('select public_email,public_phone,linkedin_url from profiles where id=$1',[ids[0]])).rows[0]).toEqual({public_email:null,public_phone:null,linkedin_url:null});
  await actor(1);for(const table of ['contact_preferences_private','contact_disclosures','contact_detail_requests'])await expect(db.query('select * from '+table)).rejects.toThrow(/permission denied/);
 });
 it('does not release information through a request, and only the owner can fulfill it',async()=>{
  await prefs();await connect();await actor(1);await call('contact_details_action',[ids[0],'request']);
  expect((await call('web_followup_state',[ids[0]])).detail_request_pending).toBe(true);
  expect((await call('web_followup_state',[ids[0]])).contact).toBeNull();
  await expect(call('contact_details_action',[ids[0],'share',['email']])).rejects.toThrow(/unavailable/);
  await actor(0);expect((await call('web_followup_state',[ids[1]])).detail_request_incoming).toBe(true);
  expect((await call('web_inbox')).detail_requests).toEqual([{profile_id:ids[1],name:'Person 1'}]);
  expect(await call('web_inbox_badge')).toBe(1);
  await call('contact_details_action',[ids[1],'share',['email']]);
  await actor(1);expect((await call('web_followup_state',[ids[0]])).detail_request_pending).toBe(false);
 });
 it('revokes future reads and exports without removing the messaging relationship',async()=>{
  await prefs();await connect();await call('contact_details_action',[ids[1],'share',['email','phone']]);await call('contact_details_action',[ids[1],'revoke']);
  await actor(1);expect(await call('web_followup_state',[ids[0]])).toMatchObject({can_message:true,contact:null});
 });
 it('does not disclose new values automatically, and disabling availability prunes old access',async()=>{
  await prefs();await connect();await call('contact_details_action',[ids[1],'share',['email']]);
  await call('contact_save_preferences',['new@example.com',null,null,null,true,false,'email']);
  await actor(1);expect((await call('web_followup_state',[ids[0]])).contact.email).toBe('alice@example.com');
  await actor(0);await call('contact_save_preferences',['new@example.com',null,null,null,false,false,'nearify']);
  await actor(1);expect((await call('web_followup_state',[ids[0]])).contact).toBeNull();
 });
 it('blocks strangers, unrelated callers, anonymous access, and disabled/unknown selected fields',async()=>{
  await prefs();await expect(call('contact_details_action',[ids[1],'share',['email']])).rejects.toThrow(/Connect/);
  await connect();await expect(call('contact_details_action',[ids[1],'share',['password']])).rejects.toThrow(/unavailable/);
  await expect(call('contact_details_action',[ids[1],'share',[]])).rejects.toThrow(/Choose/);
  await actor(2);expect((await call('web_followup_state',[ids[0]])).contact).toBeNull();
  await admin();await db.exec('set role anon');await expect(call('contact_owner_preferences')).rejects.toThrow(/permission denied/);
 });
 it('blocks access and new acknowledgements, while allowing the owner to revoke after a block',async()=>{
  await prefs();await connect();await call('contact_details_action',[ids[1],'share',['email']]);
  await actor(1);await call('web_contact_action',[ids[0],'block']);
  await actor(0);expect((await call('web_followup_state',[ids[1]])).can_message).toBe(false);
  await call('contact_details_action',[ids[1],'revoke']);
  await admin();await db.exec('grant insert on community_signals to authenticated');await actor(0);
  await expect(db.query('insert into community_signals values($1,$2)',users.slice(0,2))).rejects.toThrow(/unavailable/);
  await actor(1);await call('web_contact_action',[ids[0],'unblock']);
  expect((await call('web_followup_state',[ids[0]])).contact).toBeNull();
 });
 it('preserves old approved access once and never restores a revoked grant on rerun',async()=>{
  await admin();await db.exec('drop trigger private_contact_preferences on profiles;delete from contact_permission_rollouts;delete from contact_preferences_private;');
  await db.query("update profiles set public_email='legacy@example.com',share_email=true where id=$1",[ids[0]]);
  await db.query("insert into connections(requester_profile_id,addressee_profile_id,status) values($1,$2,'accepted')",ids.slice(0,2));
  await db.exec(migration);await actor(1);expect((await call('web_followup_state',[ids[0]])).contact.email).toBe('legacy@example.com');
  await actor(0);await call('contact_details_action',[ids[1],'revoke']);await admin();await db.exec(migration);
  await actor(1);expect((await call('web_followup_state',[ids[0]])).contact).toBeNull();
  await actor(0);expect((await call('contact_owner_preferences')).email).toBe('legacy@example.com');
 });
 it('routes trusted nonempty maintenance writes into a private vault and never public fields',async()=>{
  await admin();await db.query("update profiles set public_email='private@example.com',share_email=true where id=$1",[ids[0]]);
  expect((await db.query('select public_email from profiles where id=$1',[ids[0]])).rows[0].public_email).toBeNull();
  await actor(0);expect((await call('contact_owner_preferences')).email).toBe('private@example.com');
 });
 it('preserves private preferences across blank legacy profile updates and upserts',async()=>{
  await prefs();await admin();await db.exec('grant insert,update,select on profiles to authenticated');await actor(0);
  await db.query('update profiles set public_email=null,public_phone=null,share_email=false,share_phone=false,preferred_contact_method=$2 where id=$1',[ids[0],'nearify']);
  await db.query('insert into profiles(id,user_id,name) values($1,$2,$3) on conflict(id) do update set name=excluded.name,public_email=excluded.public_email',[ids[0],users[0],'Updated']);
  await db.query('insert into profiles(id,user_id,name) values($1,$2,$3) on conflict(user_id) do update set name=excluded.name',['99999999-9999-4999-8999-999999999999',users[0],'Upserted']);
  expect((await call('contact_owner_preferences')).email).toBe('alice@example.com');
  await expect(db.query("update profiles set public_email='unreviewed@example.com' where id=$1",[ids[0]])).rejects.toThrow(/private contact preferences/);
 });
 it('mutual signals require explicit invitation, correct identity mapping, participation and recipient approval',async()=>{
  await expect(call('community_signal_connection',[users[1],true])).rejects.toThrow(/Mutual/);
  await admin();await db.query('insert into community_signals values($1,$2),($2,$1)',users.slice(0,2));
  await db.query('insert into community_signal_preferences values($1,true,true),($2,true,true)',users.slice(0,2));await actor(0);
  expect(await call('community_signal_connection',[users[1],false])).toMatchObject({profile_id:ids[1],status:'none'});
  expect(await call('community_signal_connection',[users[1],true])).toMatchObject({status:'pending',can_message:false,contact:null});
  await actor(1);expect((await call('web_contact_action',[ids[0],'approve'])).can_message).toBe(true);
  await actor(0);await admin();await db.query('update community_signal_preferences set receive_signals=false where user_id=$1',[users[1]]);await actor(0);
  await expect(call('community_signal_connection',[users[1],true])).rejects.toThrow(/Participation/);
 });
 it('saving a QR never grants connection approval or contacts; only the recipient can accept',async()=>{
  expect(await call('save_nearify_person',[ids[1],null])).toMatchObject({saved:true,can_message:false});
  expect((await call('get_saved_people'))[0]).toMatchObject({profile_id:ids[1],name:'Person 1'});
  await admin();expect((await db.query('select count(*)::int n from connections')).rows[0].n).toBe(0);
  // Simulate a broadly granted old connection API; the trigger still rejects it.
  await db.exec('grant insert,update,select on connections to authenticated');await actor(0);
  await expect(db.query("insert into connections(requester_profile_id,addressee_profile_id,status) values($1,$2,'accepted')",ids.slice(0,2))).rejects.toThrow(/Recipient approval/);
  await call('web_contact_action',[ids[1],'request']);
  await expect(db.query("update connections set status='accepted' where requester_profile_id=$1 and addressee_profile_id=$2",ids.slice(0,2))).rejects.toThrow(/Recipient approval/);
 });
});
