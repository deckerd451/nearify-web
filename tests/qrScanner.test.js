import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQrDecoder } from '../assets/js/qrScanner.js';
afterEach(()=>vi.unstubAllGlobals());
describe('native QR decoder',()=>{
  it('requests QR format and returns detector results',async()=>{
    const detect=vi.fn().mockResolvedValue([{rawValue:'a QR value'}]);
    const construct=vi.fn();
    vi.stubGlobal('BarcodeDetector',class{
      static getSupportedFormats=async()=>['qr_code'];
      constructor(options){construct(options);}
      detect=detect;
    });
    const decoder=await createQrDecoder();
    const frame={};
    expect(decoder.kind).toBe('native');
    expect(await decoder.detect(frame)).toEqual([{rawValue:'a QR value'}]);
    expect(construct).toHaveBeenCalledWith({formats:['qr_code']});
    expect(detect).toHaveBeenCalledWith(frame);
  });
});
