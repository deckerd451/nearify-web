import { describe, expect, it } from 'vitest';
import { buildVCard, cardMessage, parseReach, reachActions, vCardFileName } from '../assets/js/reach.js';

describe('reading how to reach someone', () => {
  it('recognizes phones, emails and links', () => {
    expect(parseReach('(843) 555-0134')).toMatchObject({ kind: 'phone', digits: '8435550134' });
    expect(parseReach('+1 843 555 0134')).toMatchObject({ kind: 'phone', digits: '+18435550134' });
    expect(parseReach('maya@example.org')).toMatchObject({ kind: 'email' });
    expect(parseReach('linkedin.com/in/mayarivera')).toMatchObject({ kind: 'link', url: 'https://linkedin.com/in/mayarivera', site: 'LinkedIn' });
    expect(parseReach('http://www.instagram.com/maya')).toMatchObject({ kind: 'link', url: 'https://www.instagram.com/maya', site: 'Instagram' });
    expect(parseReach('mayas-site.dev')).toMatchObject({ kind: 'link', site: null });
  });

  it('keeps anything else as plain text and never makes unsafe links', () => {
    expect(parseReach('@maya on the CH Discord')).toMatchObject({ kind: 'text' });
    expect(parseReach('123')).toMatchObject({ kind: 'text' });
    expect(parseReach('javascript:alert(1)')).toMatchObject({ kind: 'text' });
    expect(parseReach('   ')).toBeNull();
    expect(reachActions({ name: 'X', reach: 'javascript:alert(1)' })).toEqual([]);
  });
});

describe('one-tap actions', () => {
  it('phone: send your card by text, or call', () => {
    const [send, call] = reachActions({ name: 'Maya Rivera', where: 'coffee', reach: '843-555-0134' }, { myCardUrl: 'https://nearify.org/profile/abc' });
    expect(send.label).toBe('Send Maya your card');
    expect(send.href.startsWith('sms:8435550134?&body=')).toBe(true);
    expect(decodeURIComponent(send.href.split('body=')[1])).toBe('Hi Maya, great meeting you at coffee! Here’s my card so you have my details: https://nearify.org/profile/abc');
    expect(call.href).toBe('tel:8435550134');
  });

  it('email: a ready-to-send message; link: open it', () => {
    const [mail] = reachActions({ name: 'Maya', reach: 'maya@example.org' }, { myName: 'Dana' });
    expect(mail.href).toMatch(/^mailto:maya%40example\.org\?subject=Great%20meeting%20you&body=/);
    expect(decodeURIComponent(mail.href.split('body=')[1])).toBe('Hi Maya, great meeting you! It’s Dana. Now you have my email.');
    const [open] = reachActions({ name: 'Maya', reach: 'linkedin.com/in/maya' });
    expect(open).toMatchObject({ label: 'Open LinkedIn', href: 'https://linkedin.com/in/maya', external: true });
  });

  it('without a card link, a text still gives them your number', () => {
    expect(cardMessage({ theirName: 'Maya', via: 'sms' })).toBe('Hi Maya, great meeting you! Now you have my number.');
  });
});

describe('contact card', () => {
  it('builds a vCard the Contacts app can open', () => {
    const vcf = buildVCard({ name: 'Maya de la Rivera', reach: '+1 843 555 0134', where: 'Coffee; King St', note: 'Ask about the launch' });
    expect(vcf.split('\r\n')).toEqual(expect.arrayContaining([
      'BEGIN:VCARD', 'VERSION:3.0', 'N:Rivera;Maya de la;;;', 'FN:Maya de la Rivera', 'TEL;TYPE=CELL:+18435550134',
      'NOTE:Met: Coffee\\; King St\\nAsk about the launch\\nSaved with Nearify', 'END:VCARD',
    ]));
    expect(buildVCard({ name: 'Maya', reach: 'maya@example.org' })).toContain('EMAIL;TYPE=INTERNET:maya@example.org');
    expect(vCardFileName({ name: 'Maya Rivera' })).toBe('maya-rivera.vcf');
  });
});
