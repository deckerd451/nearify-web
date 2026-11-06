import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('../assets/js/supabaseClient.js',()=>({supabase:{rpc:vi.fn()},createScopedSupabaseClient:vi.fn()}));
vi.mock('../assets/js/ghostSession.js',()=>({loadGhostSession:vi.fn()}));
vi.mock('../assets/js/logger.js',()=>({logger:{log:vi.fn(),warn:vi.fn(),error:vi.fn()}}));
import {supabase,createScopedSupabaseClient} from '../assets/js/supabaseClient.js';
import {loadGhostSession} from '../assets/js/ghostSession.js';
import {connectGhostToProfile} from '../assets/js/ghostConnection.js';
import {guestSaveDiagnostic,guestSaveFailure} from '../assets/js/guestSaveDiagnostic.js';
const event='11111111-1111-4111-8111-111111111111';
const profile='22222222-2222-4222-8222-222222222222';
const saved={event_id:event,to_profile_id:profile,to_profile_name:'Fixture person'};
let read;
beforeEach(()=>{
 vi.clearAllMocks();
 loadGhostSession.mockReturnValue({ghostId:'fixture-guest',ghostToken:'private-fixture-token'});
 read=vi.fn().mockResolvedValue({data:[],error:null});
 createScopedSupabaseClient.mockReturnValue({rpc:read});
 supabase.rpc.mockResolvedValue({data:{interaction_id:'new-save'},error:null,status:200});
});
describe('guest member connection saves',()=>{
 it('returns a verified existing save without repeating the write',async()=>{
  read.mockResolvedValue({data:[saved],error:null});
  expect(await connectGhostToProfile(event,profile)).toEqual(saved);
  expect(supabase.rpc).not.toHaveBeenCalled();
  expect(createScopedSupabaseClient).toHaveBeenCalledWith({'x-ghost-token':'private-fixture-token'});
  expect(read).toHaveBeenCalledWith('get_ghost_connection_history',{p_ghost_id:'fixture-guest',p_ghost_token:'private-fixture-token',p_event_id:event});
 });
 it('verifies a concurrent save after a duplicate error',async()=>{
  read.mockResolvedValueOnce({data:[],error:null}).mockResolvedValueOnce({data:[saved],error:null});
  supabase.rpc.mockResolvedValue({data:null,error:{code:'23505'},status:409});
  expect(await connectGhostToProfile(event,profile)).toEqual(saved);
 });
 it.each([{...saved,event_id:'different-event'},{...saved,to_profile_id:'different-person'}])('does not mistake another history row for success',async row=>{
  read.mockResolvedValue({data:[row],error:null});
  supabase.rpc.mockResolvedValue({data:null,error:{code:'23505',message:'private server detail'},status:409});
  await expect(connectGhostToProfile(event,profile)).rejects.toMatchObject({code:'23505',status:409});
 });
 it('preserves a safe permission error when history cannot verify a save',async()=>{
  read.mockResolvedValue({data:null,error:{code:'42501'}});
  supabase.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'private SQL details'},status:403});
  await expect(connectGhostToProfile(event,profile)).rejects.toMatchObject({code:'42501',status:403,message:'Guest connection save failed'});
 });
 it('performs a new write when the caller has no saved match',async()=>{
  expect(await connectGhostToProfile(event,profile)).toEqual({interaction_id:'new-save'});
  expect(supabase.rpc).toHaveBeenCalledWith('record_ghost_connection',{p_event_id:event,p_ghost_token:'private-fixture-token',p_target_profile_id:profile});
 });
 it('does not report empty responses or missing sessions as a save',async()=>{
  supabase.rpc.mockResolvedValue({data:[],error:null});
  await expect(connectGhostToProfile(event,profile)).rejects.toMatchObject({code:'EMPTY_SAVE_RESPONSE'});
  loadGhostSession.mockReturnValue(null);
  await expect(connectGhostToProfile(event,profile)).rejects.toMatchObject({code:'GUEST_SESSION_MISSING'});
 });
});
describe('safe support references',()=>{
 it('includes only fixed operation, error code, HTTP status and build',()=>{
  const reference=guestSaveDiagnostic({code:'PGRST202',status:404,message:'private-token',details:'private-name',qr:'https://nearify.org/?guest=secret'});
  expect(reference).toEqual({operation:'record_ghost_connection',code:'PGRST202',status:404,build:'guest-save-20261106-1'});
  expect(JSON.stringify(reference)).not.toContain('private');
 });
 it('rejects arbitrary code strings and identifies an invalid session without exposing the message',()=>{
  expect(guestSaveDiagnostic({code:'token=private-secret'}).code).toBe('NETWORK_OR_UNKNOWN');
  const failure=guestSaveFailure({code:'P0001',message:'Ghost participant not found'});
  expect(failure.sessionInvalid).toBe(true);
  expect(failure.message).toBe('Guest connection save failed');
 });
});
