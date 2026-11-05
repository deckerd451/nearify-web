import { describe, expect, it } from 'vitest';
import { resolveWebQr } from '../assets/js/webQr.js';
import fs from 'node:fs';
const event='11111111-1111-4111-8111-111111111111';
const profile='22222222-2222-4222-8222-222222222222';
describe('browser QR routing',()=>{
 it('keeps personal and guest links in the browser and preserves their target',()=>{
  const member=new URL(resolveWebQr(`https://nearify.org/join/?event=${event}&profile=${profile}`),'https://nearify.org');
  expect(member.searchParams.get('web')).toBe('1');
  expect(member.searchParams.get('profile')).toBe(profile);
  const guest=new URL(resolveWebQr(`https://nearify.org/join/?event=${event}&guest=${'a'.repeat(64)}`),'https://nearify.org');
  expect(guest.searchParams.get('guest')).toBe('a'.repeat(64));
  expect(guest.searchParams.get('web')).toBe('1');
 });
 it('converts the supported legacy event scheme to a web route',()=>{
  expect(resolveWebQr(`beacon://event/${event}`)).toBe(`/join/?event=${event}&web=1`);
 });
 it('opens event detail QRs using their ID or slug',()=>{
  expect(resolveWebQr(`https://nearify.org/events/event.html?id=${event}`)).toContain('web=1');
  expect(resolveWebQr('https://nearify.org/events/event.html?slug=happy-hour')).toBe('/events/event.html?slug=happy-hour&web=1');
 });
 it.each([
  'javascript:alert(1)','https://evil.example/join/?event='+event,
  'https://nearify.org.evil.example/join/?event='+event,
  'https://user:pass@nearify.org/join/?event='+event,
  'https://nearify.org:444/join/?event='+event,
  'https://nearify.org/join/?event=not-an-id',
  'https://nearify.org/join/?event='+event+'&guest=short',
  'https://nearify.org/join/?event='+event+'&guest='+'a'.repeat(64)+'&profile='+profile,
  'beacon://auth?token=secret','https://nearify.org/join/?event='+event+'#secret',
 ])('rejects unsupported or unsafe QR targets: %s',value=>expect(resolveWebQr(value)).toBeNull());
 it('drops unneeded query values rather than forwarding credentials',()=>{
  expect(resolveWebQr(`https://nearify.org/join/?event=${event}&token=secret`)).not.toContain('secret');
 });
 it('keeps both Apple association responses identical with web exclusions first',()=>{
  const association=JSON.parse(fs.readFileSync(new URL('../.well-known/apple-app-site-association',import.meta.url),'utf8'));
  expect(JSON.parse(fs.readFileSync(new URL('../apple-app-site-association',import.meta.url),'utf8'))).toEqual(association);
  const rules=association.applinks.details[0].components;
  for(const path of ['/join/*','/events/*','/profile/*']){
   const exclusion=rules.findIndex(rule=>rule['/']===path&&rule.exclude);
   const app=rules.findIndex(rule=>rule['/']===path&&!rule.exclude);
   expect(exclusion).toBeGreaterThanOrEqual(0);
   expect(exclusion).toBeLessThan(app);
   expect(rules[exclusion]['?']).toEqual({web:'1'});
  }
 });
});
