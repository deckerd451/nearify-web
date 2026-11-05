import {describe,it,expect,vi} from 'vitest';
import {saveAccountConnection} from '../assets/js/accountConnection.js';
const mine='33333333-3333-4333-8333-333333333333';
const other='22222222-2222-4222-8222-222222222222';
const event='11111111-1111-4111-8111-111111111111';
function client(status='proposed'){
 return {rpc:vi.fn(async name=>name==='current_profile_id'?{data:mine,error:null}:{data:{status},error:null})};
}
describe('account personal QR saves',()=>{
 it('rejects a self scan without creating a guest or writing a relationship',async()=>{
  const db=client();
  expect(await saveAccountConnection(db,event,mine.toUpperCase())).toEqual({ok:false,reason:'self'});
  expect(db.rpc).toHaveBeenCalledTimes(1);
 });
 it.each(['proposed','confirmed'])('uses the account RPC for %s saves, including a repeat scan',async status=>{
  const db=client(status);
  for(let i=0;i<2;i++) expect(await saveAccountConnection(db,event,other)).toEqual({ok:true,profileId:mine,status});
  expect(db.rpc).toHaveBeenCalledWith('confirm_relationship',{p_other_profile_id:other,p_source_event_id:event,p_source_intel_id:null});
  expect(db.rpc.mock.calls.every(([name])=>['current_profile_id','confirm_relationship'].includes(name))).toBe(true);
 });
 it('does not write if the authenticated profile cannot be resolved',async()=>{
  const db={rpc:vi.fn().mockResolvedValue({data:null,error:null})};
  expect(await saveAccountConnection(db,event,other)).toEqual({ok:false,reason:'profile_missing'});
  expect(db.rpc).toHaveBeenCalledTimes(1);
 });
 it('does not report a failed or unexpected response as a successful save',async()=>{
  const db=client();db.rpc.mockResolvedValueOnce({data:mine,error:null}).mockResolvedValueOnce({data:null,error:{code:'42501'}});
  expect(await saveAccountConnection(db,event,other)).toEqual({ok:false,reason:'request_failed'});
  const unexpected=client('unknown');
  expect(await saveAccountConnection(unexpected,event,other)).toEqual({ok:false,reason:'request_failed'});
 });
});
