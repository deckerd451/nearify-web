import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../assets/js/supabaseClient.js', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../assets/js/logger.js', () => ({logger:{log:vi.fn(),warn:vi.fn()}}));
import { supabase } from '../assets/js/supabaseClient.js';
import { trackFunnelEvent } from '../assets/js/analytics.js';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('best effort analytics',()=>{
  it('keeps only the referrer origin, excluding QR and OAuth query strings',()=>{
    vi.stubGlobal('window',{location:{pathname:'/join/'}});
    vi.stubGlobal('document',{referrer:'https://nearify.org/join/?guest=private-share-code#token'});
    const insert=vi.fn().mockResolvedValue({error:null});
    supabase.from.mockReturnValue({insert});
    trackFunnelEvent('ghost_claim_success_shown');
    expect(insert.mock.calls[0][0].referrer).toBe('https://nearify.org');
  });
  it('absorbs a rejected analytics request',async()=>{
    vi.stubGlobal('window',{location:{pathname:'/join/'}});
    vi.stubGlobal('document',{referrer:''});
    supabase.from.mockReturnValue({insert:()=>Promise.reject(Error('offline'))});
    expect(()=>trackFunnelEvent('guest_scan_started')).not.toThrow();
    await new Promise(resolve=>setTimeout(resolve,0));
  });
  it('absorbs a synchronous analytics client failure',()=>{
    vi.stubGlobal('window',{location:{pathname:'/join/'}});
    vi.stubGlobal('document',{referrer:''});
    supabase.from.mockImplementation(()=>{throw Error('unavailable');});
    expect(()=>trackFunnelEvent('guest_scan_started')).not.toThrow();
  });
});
