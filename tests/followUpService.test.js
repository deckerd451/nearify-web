import {describe,it,expect} from 'vitest';
import {safeContactLinks,contactVcard,followUpRpc} from '../assets/js/followUpService.js';
describe('approved contact presentation',()=>{
 it('allows only usable contact schemes and genuine LinkedIn hosts',()=>{
  expect(safeContactLinks({email:'a@example.com\nBcc:evil@example.com',phone:'javascript:evil',linkedin:'https://linkedin.com.evil.example/a',website:'javascript:alert(1)'})).toEqual([]);
  expect(safeContactLinks({website:'https://user:password@example.com'})).toEqual([]);
  expect(safeContactLinks({linkedin:'https://www.linkedin.com/in/someone',website:'https://example.com',email:'person@example.com',phone:'+1 (555) 555-0100',preferred:'email'})[0].kind).toBe('email');
 });
 it('escapes contact card data and folds Unicode lines without splitting characters',()=>{
  const value=contactVcard({name:'Alex, Smith;\nTEL:evil',email:'alex@example.com',website:'https://example.com/'+ 'é'.repeat(100)});
  expect(value).toContain('FN:Alex\\, Smith\\;\\nTEL:evil');expect(value).not.toContain('\r\nTEL:evil');
  expect(value).toContain('EMAIL:alex@example.com');
  expect(value.split('\r\n').every(line=>new TextEncoder().encode(line).length<=75)).toBe(true);
 });
 it('does not fabricate unavailable contact methods',()=>{
  const card=contactVcard({name:'Alex'});expect(card).not.toMatch(/EMAIL:|TEL:|URL:/);
 });
 it('does not show backend error contents or report failed calls as successful',async()=>{
  await expect(followUpRpc({rpc:async()=>({error:{message:'sensitive payload'}})},'web_inbox')).rejects.toThrow('Follow-up is temporarily unavailable. Please try again.');
 });
});
