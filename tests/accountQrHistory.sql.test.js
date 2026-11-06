import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const profiles=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const users=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
const events=['44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'];
let db;
async function actor(i){
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[users[i]]);
 await db.exec('set role authenticated');
}
async function save(event=events[1],target=profiles[1]){
 return (await db.query('select public.save_account_qr_connection($1,$2) as result',[event,target])).rows[0].result;
}
async function history(target=profiles[1]){
 return (await db.query('select public.get_relationship_event_history($1) as result',[target])).rows[0].result;
}
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`
 create role anon; create role authenticated; create schema auth;
 grant usage on schema public,auth to anon,authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.profiles(id uuid primary key,user_id uuid,name text);
 create table public.events(id uuid primary key,name text,starts_at timestamptz,is_active boolean default true,deleted_at timestamptz);
 create table public.interaction_intelligence(id uuid primary key);
 create table public.event_attendees(event_id uuid,profile_id uuid,intent_primary text);
 create table public.ghost_participants(id uuid primary key,claimed_by_profile_id uuid);
 create table public.ghost_guest_connections(event_id uuid,from_ghost_id uuid,to_ghost_id uuid,created_at timestamptz default now());
 create table public.interaction_events(id uuid default gen_random_uuid(),event_id uuid,from_profile_id uuid,to_profile_id uuid,created_at timestamptz default now(),from_ghost_id uuid,claimed_by_profile_id uuid,interaction_type text);
 create function public.current_profile_id() returns uuid language sql stable security definer as $$select id from public.profiles where user_id=auth.uid() limit 1$$;
 `);
 await db.exec(read('supabase/migrations/017_relationships_table.sql'));
 await db.exec(read('supabase/migrations/018_relationship_rpcs.sql'));
 await db.exec(read('event-discovery/008-account-qr-event-history.sql'));
},30000);
beforeEach(async()=>{
 await db.exec('reset role; truncate public.account_qr_saves,public.relationships,public.event_attendees,public.interaction_events,public.ghost_guest_connections,public.ghost_participants,public.events,public.profiles cascade');
 for(let i=0;i<profiles.length;i++) await db.query('insert into public.profiles(id,user_id,name) values ($1,$2,$3)',[profiles[i],users[i],'Fixture '+i]);
 await db.query("insert into public.events values ($1,'Earlier event','2026-05-12',true,null),($2,'Show & Tell','2026-11-17',true,null)",events);
 await actor(0);
});
afterAll(async()=>{await db?.close();});
describe('account QR persistence on PostgreSQL',()=>{
 it('records a new QR event even when the relationship already exists',async()=>{
  await save(events[0]);
  await save(events[1]);
  const records=await history();
  expect(records.map(row=>row.event_id)).toEqual([events[1],events[0]]);
  expect(records[0]).toMatchObject({qr_saved:true,qr_saved_by_you:true,shared_attendance_record:false,event_name:'Show & Tell'});
  expect(records[0].qr_saved_at).toBeTruthy();
  await db.exec('reset role');
  expect((await db.query('select count(*)::int as n from public.relationships')).rows[0].n).toBe(1);
  expect((await db.query('select count(*)::int as n from public.event_attendees')).rows[0].n).toBe(0);
 });
 it('keeps repeat scans of one person/event idempotent',async()=>{
  await save();await save();
  expect(await history()).toHaveLength(1);
  await db.exec('reset role');
  expect((await db.query('select count(*)::int as n from public.account_qr_saves')).rows[0].n).toBe(1);
 });
 it('keeps mutual confirmation and deduplicates both directions in event history',async()=>{
  await save();await actor(1);
  expect((await save(events[1],profiles[0])).status).toBe('confirmed');
  const rows=await history(profiles[0]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({qr_saved_by_you:true,qr_saved_you:true});
 });
 it('deduplicates QR saves and shared attendance for the same event',async()=>{
  await save();await db.exec('reset role');
  for(const p of profiles.slice(0,2)) await db.query('insert into public.event_attendees(event_id,profile_id) values($1,$2)',[events[1],p]);
  await actor(0);
  expect(await history()).toHaveLength(1);
  expect((await history())[0].shared_attendance_record).toBe(true);
 });
 it('rejects self, unknown profiles and unavailable events without partial writes',async()=>{
  await expect(save(events[1],profiles[0])).rejects.toThrow(/own QR/);
  await expect(save(events[1],'99999999-9999-4999-8999-999999999999')).rejects.toThrow(/profile unavailable/);
  await expect(save('99999999-9999-4999-8999-999999999999')).rejects.toThrow(/Event unavailable/);
  await db.exec('reset role');
  expect((await db.query('select count(*)::int as n from public.relationships')).rows[0].n).toBe(0);
  expect((await db.query('select count(*)::int as n from public.account_qr_saves')).rows[0].n).toBe(0);
 });
 it('rolls back the relationship when event evidence cannot be written',async()=>{
  await db.exec(`reset role; create function public.reject_qr_fixture() returns trigger language plpgsql as $$begin raise exception 'Fixture ledger failure'; end$$; create trigger reject_qr_fixture before insert on public.account_qr_saves for each row execute function public.reject_qr_fixture();`);
  try {
   await actor(0);
   await expect(save()).rejects.toThrow(/Fixture ledger failure/);
   await db.exec('reset role');
   expect((await db.query('select count(*)::int as n from public.relationships')).rows[0].n).toBe(0);
  } finally {await db.exec('reset role; drop trigger reject_qr_fixture on public.account_qr_saves; drop function public.reject_qr_fixture()');}
 });
 it('does not expose another pair or allow direct client ledger reads/writes',async()=>{
  await save();
  await expect(db.query('select * from public.account_qr_saves')).rejects.toThrow(/permission denied/);
  await expect(db.query('insert into public.account_qr_saves values($1,$2,$3,now())',[profiles[0],profiles[1],events[0]])).rejects.toThrow(/permission denied/);
  await actor(2);
  expect(await history()).toEqual([]);
  await db.exec('reset role; set role anon');
  await expect(save()).rejects.toThrow(/permission denied/);
  await expect(history()).rejects.toThrow(/permission denied/);
 });
 it('keeps claimed guest-to-member events visible without attendance',async()=>{
  await db.exec('reset role');
  const ghost='66666666-6666-4666-8666-666666666666';
  await db.query('insert into public.ghost_participants values($1,$2)',[ghost,profiles[0]]);
  await db.query("insert into public.interaction_events(event_id,to_profile_id,from_ghost_id,claimed_by_profile_id,interaction_type) values($1,$2,$3,$4,'qr_confirmed')",[events[0],profiles[1],ghost,profiles[0]]);
  await actor(0);
  expect((await history())[0]).toMatchObject({event_id:events[0],recovered_guest_connection:true});
 });
});
