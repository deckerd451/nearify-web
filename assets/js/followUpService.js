// Shared iOS tables through authenticated, server-authorized web RPCs.
export async function followUpRpc(client, name, args) {
  const {data,error} = await client.rpc(name,args);
  if(error) throw new Error('Follow-up is temporarily unavailable. Please try again.');
  return data;
}
export function safeContactLinks(contact={}) {
  const links=[];
  const email=contact.email?.trim();
  if(email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) && !/[\r\n]/.test(email)) links.push({kind:'email',label:'Email',href:'mailto:'+encodeURIComponent(email)});
  const phone=contact.phone?.trim();
  if(phone && /^\+?[\d\s().-]{5,30}$/.test(phone)) links.push({kind:'phone',label:'Call',href:'tel:'+phone.replace(/[^+\d]/g,'')});
  for(const kind of ['linkedin','website']) {
    try {
      const url=new URL(contact[kind]);
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password) continue;
      if(kind==='linkedin' && !/(^|\.)linkedin\.com$/i.test(url.hostname)) continue;
      links.push({kind,label:kind==='linkedin'?'LinkedIn':'Website',href:url.href});
    } catch { /* Not a usable public URL. */ }
  }
  return links.sort((a,b)=>Number(b.kind===contact.preferred)-Number(a.kind===contact.preferred));
}
function vEscape(value) {return String(value??'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');}
export function contactVcard(contact) {
  const lines=['BEGIN:VCARD','VERSION:3.0','FN:'+vEscape(contact.name||'Nearify contact'),'N:;'+vEscape(contact.name||'Nearify contact')+';;;'];
  for(const link of safeContactLinks(contact)) {
    if(link.kind==='email') lines.push('EMAIL:'+vEscape(contact.email.trim()));
    else if(link.kind==='phone') lines.push('TEL:'+vEscape(contact.phone.trim()));
    else lines.push('URL:'+vEscape(link.href));
  }
  lines.push('END:VCARD');
  // RFC 2425 folding: 75 UTF-8 octets per physical line, without splitting codepoints.
  return lines.map(line=>{let result='',bytes=0;for(const char of line){const size=new TextEncoder().encode(char).length;if(bytes+size>75){result+='\r\n ';bytes=1;}result+=char;bytes+=size;}return result;}).join('\r\n')+'\r\n';
}
export function downloadContact(contact) {
  const url=URL.createObjectURL(new Blob([contactVcard(contact)],{type:'text/vcard;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='nearify-contact.vcf';a.hidden=true;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export const FOLLOW_UP_COPY={
  none:'Saving keeps this person in your history. Connect on Nearify to message. Personal contact details are a separate choice.',
  pending:'Your connection invitation is pending. They can approve it on Nearify web or iPhone.',
  incoming:'They would like to connect on Nearify. Accepting enables messaging; it does not share your personal contact details.',
  accepted:'You can message here or in the Nearify iPhone app. Your personal details stay private unless you choose to share them.',
  blocked:'Connection invitations, detail sharing, and new messages are unavailable for this connection.',
};
