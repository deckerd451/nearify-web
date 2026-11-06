/** Local browser UI regression. Supabase responses are fixtures; no live writes. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
const me='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',thread='33333333-3333-4333-8333-333333333333';
const fixture=`
const me='${me}',other='${other}',thread='${thread}';
window.calls=[];window.authCallbacks=[];
export const getSessionCached=async()=>({data:{session:localStorage.getItem('signedout')?null:{user:{id:'fixture-user'}}},error:null});
export const supabase={auth:{getSession:getSessionCached,getUser:async()=>({data:{user:{id:'fixture-user'}},error:null}),onAuthStateChange:fn=>{window.authCallbacks.push(fn);getSessionCached().then(({data})=>fn('INITIAL_SESSION',data.session));return {data:{subscription:{unsubscribe(){}}}};}},from(table){const data=table==='community_signal_preferences'?{discoverable:true,receive_signals:true}:table==='community_signals'?[{sender_id:'fixture-user',recipient_id:'other-user',created_at:'2026-11-06'},{sender_id:'other-user',recipient_id:'fixture-user',created_at:'2026-11-06'}]:{id:me,name:'Alex'};const chain=new Proxy({},{get(_,key){if(key==='then')return Promise.resolve({data,error:null}).then.bind(Promise.resolve({data,error:null}));return ()=>chain;}});return chain;},async rpc(name,args){
 window.calls.push({name,args});
 const status=localStorage.getItem('followup_status')||'none';
 const state=()=>({permission_version:2,shared_by_you:JSON.parse(localStorage.getItem('shared_by_me')||'{}'),detail_request_pending:!!localStorage.getItem('details_pending'),detail_request_incoming:false,status:localStorage.getItem('followup_status')||'none',can_message:localStorage.getItem('followup_status')==='accepted',conversation_id:localStorage.getItem('thread_open')?thread:null,contact:localStorage.getItem('followup_status')==='accepted'?JSON.parse(localStorage.getItem('received_details')||'null'):null});
 if(name==='get_public_profile_brief')return {data:[{id:other,name:'Taylor Chen'}],error:null};
 if(name==='get_relationship_context')return {data:{relationship_status:'proposed_by_me',encounter_count:1},error:null};
 if(name==='get_relationship_event_history')return {data:[{event_id:thread,event_name:'Show & Tell',event_at:'2099-11-17',qr_saved:true,qr_saved_by_you:true,qr_saved_at:'2026-11-06T17:00:00Z'}],error:null};
 if(name==='contact_owner_preferences')return {data:{email:'alex@example.com',phone:'+15555550100',linkedin:'https://linkedin.com/in/alex',allow_email:true,allow_phone:true},error:null};
 if(name==='contact_details_action'){
  if(args.p_action==='share'){const values={email:'alex@example.com',phone:'+15555550100',linkedin:'https://linkedin.com/in/alex'};localStorage.setItem('shared_by_me',JSON.stringify(Object.fromEntries(args.p_fields.map(key=>[key,values[key]]))));}
  if(args.p_action==='revoke')localStorage.removeItem('shared_by_me');
  if(args.p_action==='request')localStorage.setItem('details_pending','1');
  return {data:state(),error:null};
 }
 if(name==='community_signal_discover_v2')return {data:[{user_id:'other-user',display_name:'Taylor Chen',work_context:'Building community tools'}],error:null};
 if(name==='community_signal_connection'){
  if(args.p_invite)localStorage.setItem('followup_status','pending');
  return {data:{...state(),profile_id:other,can_invite:true},error:null};
 }
 if(name==='web_followup_state')return {data:state(),error:null};
 if(name==='web_contact_action'){
  const next={request:'pending',approve:'accepted',ignore:'none',block:'blocked'}[args.p_action];localStorage.setItem('followup_status',next);return {data:state(),error:null};
 }
 if(name==='web_open_conversation'){localStorage.setItem('thread_open','1');return {data:thread,error:null};}
 if(name==='web_inbox_badge')return {data:1,error:null};
 if(name==='web_inbox')return {data:{threads:localStorage.getItem('thread_open')?[{id:thread,profile_id:other,name:'Taylor Chen',preview:'Hi Alex!',unread:true}]:[],requests:status==='incoming'?[{profile_id:other,name:'Taylor Chen'}]:[]},error:null};
 if(name==='web_thread')return {data:{profile_id:other,name:'Taylor Chen',my_profile_id:me,can_message:status==='accepted',messages:JSON.parse(localStorage.getItem('messages')||'[]')},error:null};
 if(name==='web_send_message'){
  if(window.failSend)return {error:{message:'backend failure'}};
  const messages=JSON.parse(localStorage.getItem('messages')||'[]');const message={id:args.p_message_id,sender_profile_id:me,content:args.p_content,created_at:new Date().toISOString()};
  if(!messages.some(row=>row.id===message.id))messages.push(message);localStorage.setItem('messages',JSON.stringify(messages));return {data:message,error:null};
 }
 if(name==='web_mark_read')return {data:null,error:null};
 return {data:[],error:null};
}};
`;
const server=spawn('python3',['-u','-m','http.server','0','--bind','127.0.0.1'],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe']});
let browser;
try{
 const [output]=await once(server.stdout,'data');const port=String(output).match(/port (\d+)/)?.[1];assert.ok(port);
 const base='https://nearify.org';
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==base)return route.abort();
  if(url.pathname==='/assets/js/supabaseClient.js')return route.fulfill({contentType:'text/javascript',body:fixture});
  return route.fulfill({response:await route.fetch({url:'http://127.0.0.1:'+port+url.pathname+url.search})});
 });
 context.setDefaultTimeout(10000);const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const profile=base+'/profile.html?id='+other+'&from=connections';
 async function widths(stage){for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,stage+' overflow at '+width);}await page.setViewportSize({width:390,height:844});}
 await page.goto(profile);
 await page.getByRole('button',{name:'Connect on Nearify',exact:true}).waitFor();
 assert.equal(await page.locator('#profileHistory').getAttribute('open'),null);
 assert.equal(await page.locator('a[href^="mailto:"]').count(),1,'only footer email appears before approval');
 await page.getByRole('button',{name:'Connect on Nearify',exact:true}).click();await page.getByText('Request pending',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Say hello',exact:true}).count(),0);
 await widths('pending profile');
 await page.evaluate(()=>localStorage.setItem('followup_status','incoming'));
 await page.goto(base+'/messages/');
 await page.getByRole('button',{name:'Approve',exact:true}).click();await page.getByText('No pending requests.',{exact:true}).waitFor();
 await page.goto(profile);await page.getByRole('button',{name:'Say hello',exact:true}).waitFor();
 assert.equal(await page.locator('#profileFollowUp a[href^="mailto:"]').count(),0,'approval alone reveals no details');
 assert.equal(await page.getByRole('button',{name:'Download contact',exact:true}).count(),0);
 await page.getByRole('button',{name:'Share my contact details',exact:true}).click();
 await page.getByRole('checkbox',{name:/Email: alex/}).check();
 await page.getByRole('button',{name:'Share selected details',exact:true}).click();
 await page.getByText('You shared: Email',{exact:true}).waitFor();
 assert.equal(await page.locator('#profileFollowUp a[href^="mailto:"]').count(),0,'sharing is directional');
 const share=await page.evaluate(()=>window.calls.find(call=>call.name==='contact_details_action'&&call.args.p_action==='share'));
 assert.deepEqual(share.args.p_fields,['email']);
 await page.getByRole('button',{name:'Request contact details',exact:true}).click();await page.getByText('Details request pending',{exact:true}).waitFor();
 await page.evaluate(()=>localStorage.setItem('received_details',JSON.stringify({name:'Taylor Chen',email:'taylor@example.com',website:'javascript:alert(1)'})));
 await page.reload();await page.getByRole('button',{name:'Download contact',exact:true}).waitFor();
 await page.getByRole('button',{name:'Stop sharing my details',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('#profileFollowUp').textContent.includes('You shared: Email'));
 assert.equal(await page.locator('#profileFollowUp a[href^="mailto:"]').count(),1,'revoking yours does not revoke theirs');
 assert.equal(await page.locator('#profileFollowUp a[href^="javascript:"]').count(),0);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download contact',exact:true}).click();assert.equal((await download).suggestedFilename(),'nearify-contact.vcf');
 await widths('approved profile');
 if(process.env.SMOKE_SCREENSHOT)await page.screenshot({path:'/tmp/nearify-web-followup-profile.png',fullPage:true});
 await page.getByRole('button',{name:'Say hello',exact:true}).click();await page.waitForURL('**/messages/?conversation='+thread);
 await page.locator('#messageText').waitFor({state:'visible'});
 await page.locator('#messageText').fill('<img src=x onerror=alert(1)> Great to meet you!');
 await page.evaluate(()=>window.failSend=true);await page.locator('#sendMessage').click();await page.getByText(/Message wasn’t sent/).waitFor();
 assert.match(await page.locator('#messageText').inputValue(),/Great to meet you/);
 await page.evaluate(()=>window.failSend=false);await page.locator('#sendMessage').click();await page.getByText('Message sent.',{exact:true}).waitFor();
 assert.equal(await page.locator('#messageList img').count(),0);
 const sent=await page.evaluate(()=>window.calls.filter(call=>call.name==='web_send_message'));
 assert.equal(sent.length,2);assert.equal(sent[0].args.p_message_id,sent[1].args.p_message_id,'retry retains message id');
 assert.equal(await page.locator('#messageText').inputValue(),'');
 await widths('conversation');
 if(process.env.SMOKE_SCREENSHOT)await page.screenshot({path:'/tmp/nearify-web-followup-thread.png',fullPage:true});
 await page.reload();await page.locator('#messageList').getByText(/Great to meet you/).waitFor();
 await page.locator('#threadProfile').click();await page.getByRole('button',{name:'Message',exact:true}).waitFor();
 await page.goBack();await page.locator('#messageText').waitFor({state:'visible'});
 assert.equal(await page.locator('#sendMessage').isEnabled(),true,'conversation is usable after back navigation');
 page.once('dialog',dialog=>dialog.accept());await page.locator('summary').filter({hasText:'Conversation options'}).click();await page.locator('#blockContact').click();await page.locator('#threadGate').waitFor({state:'visible'});
 assert.equal(await page.locator('#messageComposer').isVisible(),false);
 await page.evaluate(()=>window.authCallbacks.forEach(fn=>fn('SIGNED_OUT',null)));
 assert.equal(await page.locator('#messageList').innerText(),'');assert.equal(await page.locator('#messagesContent').isVisible(),false);
 await page.evaluate(()=>localStorage.setItem('signedout','1'));await page.goto(base+'/messages/');await page.locator('#messagesAuth').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>window.calls.some(call=>call.name==='web_inbox')),false,'signed-out inbox does not read messages');
 await page.goto(profile);await page.getByRole('button',{name:'Sign in with Google',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.calls.some(call=>call.name==='web_followup_state')),false,'signed-out profile does not request contact details');
 await page.evaluate(()=>{localStorage.removeItem('signedout');localStorage.setItem('followup_status','accepted');localStorage.setItem('received_details',JSON.stringify({name:'Taylor Chen',email:'taylor@example.com'}));});
 await page.goto(profile);await page.getByRole('button',{name:'Download contact',exact:true}).waitFor();
 let exportedAfterRevoke=false;page.on('download',()=>{exportedAfterRevoke=true;});
 await page.evaluate(()=>localStorage.removeItem('received_details'));
 await page.getByRole('button',{name:'Download contact',exact:true}).click();await page.getByText('These contact details are no longer shared with you.',{exact:true}).waitFor();
 assert.equal(exportedAfterRevoke,false,'export rechecks the current grant');
 await page.evaluate(()=>localStorage.setItem('followup_status','none'));
 await page.goto(base+'/community-signal/live.html');
 await page.getByRole('button',{name:'Invite to connect',exact:true}).waitFor();
 assert.match(await page.locator('#members').innerText(),/Building community tools/);
 assert.equal(await page.evaluate(()=>window.calls.some(call=>call.name==='web_open_conversation'||call.name==='contact_details_action')),false,'mutual interest grants no contact or messaging rights');
 await page.getByRole('button',{name:'Invite to connect',exact:true}).click();await page.getByRole('button',{name:'Invitation pending',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.calls.some(call=>call.name==='community_signal_connection'&&call.args.p_invite)),true);
 assert.deepEqual(errors,[]);
 console.log('Follow-up browser checks passed: request/approval, hidden contact details, download, shared thread, failed-send draft/idempotent retry, safe text rendering, refresh persistence, block, sign-out cleanup, and mobile widths. Mock backend only.');
}finally{await browser?.close();server.kill();}
