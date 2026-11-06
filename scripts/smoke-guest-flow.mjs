/** Local browser regression check. All backend calls are simulated; no production writes.
 * Run: node scripts/smoke-guest-flow.mjs
 * Requires installed Chromium, or CHROMIUM_PATH pointing to its executable.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';

const eventId = '11111111-1111-4111-8111-111111111111';
const event = { id: eventId, slug: 'smoke-event', name: 'Networking Happy Hour', location: 'Charleston Beer Works', starts_at: '2099-11-06T22:30:00Z', ends_at: '2099-11-07T01:00:00Z', is_active: true, description: 'Meet local builders and collaborators.' };
const fixture = `
const event = ${JSON.stringify(event)};
window.smokeCalls = [];
window.smokeAnalytics = [];
function query(table) {
 const result = { data: table === 'events' ? event : table === 'profiles' ? {id:'33333333-3333-4333-8333-333333333333',name:'A Very Long Signed In Account Name'} : [], error: null };
 const chain = new Proxy({}, { get(_, key) {
  if(table === 'analytics_events' && key === 'insert') return payload => {
   window.smokeAnalytics.push(payload);
   return window.failAnalytics ? Promise.reject(new Error('Simulated analytics failure')) : Promise.resolve({error:null});
  };
  if (key === 'then') return Promise.resolve(result).then.bind(Promise.resolve(result));
  return () => chain;
 }});
 return chain;
}
export const getSessionCached = async () => ({data:{session:localStorage.getItem('smoke_auth') ? {user:{id:'fixture-user'},access_token:'fixture-access',refresh_token:'fixture-refresh'} : null},error:null});
export const supabase = {
 from: query,
 auth: {getSession:getSessionCached, onAuthStateChange:callback=>{getSessionCached().then(({data})=>callback('INITIAL_SESSION',data.session));return {data:{subscription:{unsubscribe(){}}}};}},
 async rpc(name, args) {
  window.smokeCalls.push({name,args});
  if (name==='create_ghost_participant') {
   if(window.failJoin) return {error:{message:'Simulated join failure'}};
   return {data:{ghost_id:'test-guest',ghost_token:'test-only-token',event_id:event.id,display_name:args.p_display_name},error:null};
  }
  if(name==='get_public_profile_brief') return {data:{id:args.p_profile_id,name:'Taylor Chen'},error:null};
  if(name==='current_profile_id') return {data:'33333333-3333-4333-8333-333333333333',error:null};
  if(name==='confirm_relationship') return {data:{status:'proposed',relationship_id:'fixture-relationship'},error:null};
  if(name==='claim_guest_network') return {data:{profile_id:'33333333-3333-4333-8333-333333333333'},error:null};
  if(name==='get_my_guest_share_code') {
   if(window.failQr) throw new Error('Simulated QR failure');
   return {data:'a'.repeat(64),error:null};
  }
  if(name==='save_guest_to_guest_connection') {
   if(window.throwSave) throw new Error('Simulated network failure');
   if(localStorage.getItem('smoke_slow_handoff')) await new Promise(resolve=>window.releaseGuestHandoff=resolve);
   if(window.failSave || localStorage.getItem('smoke_handoff_fail')) return {error:{code:'TEST',message:'Simulated save failure'}};
   window.guestSaved=true; return {data:{guest_name:'Jordan Lee'},error:null};
  }
  if(name==='get_my_guest_to_guest_connections') return {data:window.guestSaved?[{guest_name:'Jordan Lee'}]:[],error:null};
  if(name==='record_ghost_connection') {if(localStorage.getItem('smoke_member_fail')) return {data:null,error:{code:'TEST'}};window.memberSaved=true;return {data:{to_profile_name:'Taylor Chen'},error:null};}
  if(name==='get_ghost_connection_history') return {data:window.memberSaved?[{event_id:args.p_event_id,to_profile_name:'Taylor Chen',to_profile_id:'22222222-2222-4222-8222-222222222222'}]:[],error:null};
  return {data:[],error:null};
 }
};
// Supabase RPCs are awaitable filter builders, including maybeSingle().
const rpc = supabase.rpc.bind(supabase);
supabase.rpc = (name,args) => {
 const request = rpc(name,args);
 request.maybeSingle = async () => {
  const result = await request;
  return {...result,data:Array.isArray(result.data) ? result.data[0] ?? null : result.data};
 };
 return request;
};
export const createScopedSupabaseClient = () => supabase;
`;
const server = spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1'], {cwd:new URL('../', import.meta.url), stdio:['ignore','pipe','pipe']});
let browser;
try {
 const [output] = await once(server.stdout, 'data');
 const port = String(output).match(/port (\d+)/)?.[1];
 assert.ok(port, 'static server started');
 const serverBase = `http://127.0.0.1:${port}`;
 // Exercise production-origin validation while serving every page from the local fixture.
 const base = "https://nearify.org";
 browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context = await browser.newContext({viewport:{width:390,height:844}});
 await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if(url.pathname === '/assets/js/supabaseClient.js') return route.fulfill({contentType:'text/javascript',body:fixture});
  // External assets are intentionally unavailable: link fallback must still work.
  if(url.origin !== base) return route.abort();
  const response=await route.fetch({url:serverBase+url.pathname+url.search});
  return route.fulfill({response});
 });
 context.setDefaultTimeout(15000);
 const page = await context.newPage();
 const errors=[]; page.on('pageerror', e=>errors.push(e.message));
 const checkWidths = async stage => {
  for (const width of [320,390,768,1280]) {
   await page.setViewportSize({width,height:844});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,`${stage}: no horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({width:390,height:844});
 };
 const capture = async name => {
  if(process.env.SMOKE_SCREENSHOT) await page.screenshot({path:process.env.SMOKE_SCREENSHOT.replace(/\.png$/, '') + '-' + name + '.png',fullPage:true});
 };
 await page.goto(base+'/');
 await page.locator('.nav-scan-link').waitFor({state:'visible'});
 if(process.env.SMOKE_SCREENSHOT) await page.locator('.nav').screenshot({path:'/tmp/nearify-visible-scan-header.png'});
 await page.locator('.nav-scan-link').click();
 await page.waitForURL('**/scan/?web=1');
 await checkWidths('scanner');
 await capture('scanner');
 await page.locator('#scanPasteDetails summary').click();
 await page.locator('#scanLinkInput').fill('https://evil.example/');
 await page.locator('#scanLinkBtn').click();
 assert.equal(await page.locator('#scanResult').isVisible(),false);
 await page.addScriptTag({url:base+'/assets/js/vendor/qrcode.min.js?v=1.0.0'});
 await page.evaluate(()=>{
  Object.defineProperty(window,'BarcodeDetector',{configurable:true,writable:true,value:undefined});
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,writable:true,value:async()=>{throw new DOMException('Denied','NotAllowedError');}});
 });
 await page.locator('#scanStartBtn').click();
 await page.waitForFunction(()=>document.querySelector('#scanStatus').textContent.includes('Camera access was denied'));
 await page.evaluate(eventId=>{
  const host=document.createElement('div');
  new QRCode(host,{text:'beacon://event/'+eventId,width:260,height:260});
  const frame=document.createElement('canvas');frame.width=292;frame.height=292;
  const ctx=frame.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,292,292);ctx.drawImage(host.querySelector('canvas'),16,16);
  window.webCameraStops=0;
  navigator.mediaDevices.getUserMedia=async()=>{
   const camera=frame.captureStream(10);
   const painting=setInterval(()=>ctx.drawImage(host.querySelector('canvas'),16,16),100);
   for(const track of camera.getTracks()){
    const stop=track.stop.bind(track);track.stop=()=>{window.webCameraStops++;clearInterval(painting);stop();};
   }
   return camera;
  };
 },eventId);
 await page.locator('#scanStartBtn').click();
 await page.locator('#scanResult').waitFor({state:'visible'});
 assert.equal(await page.locator('#scanCameraShell').isVisible(),false);
 assert.equal(await page.locator('#scanStartBtn').isVisible(),false);
 assert.ok(await page.evaluate(()=>window.webCameraStops>0));
 const scanTarget=new URL(await page.locator('#scanContinueLink').getAttribute('href'),base);
 assert.equal(scanTarget.searchParams.get('web'),'1');
 await page.locator('#scanContinueLink').click();
 await page.waitForURL(`**/join/?event=${eventId}&web=1`);

 await page.locator('#guestForm').waitFor({state:'visible'});
 await page.locator('#guestSubmitBtn').click();
 assert.equal(await page.locator('#guestNameError').isVisible(),true);
 await page.locator('#guestDisplayName').fill('Alex');
 await page.locator('input[name=guestGoal][value=explore_ideas]').check();
 assert.equal(await page.locator('#guestNameError').isVisible(),false);
 await checkWidths('join');
 await capture('join');
 await page.evaluate(()=>window.failJoin=true);
 await page.locator('#guestSubmitBtn').click();
 await page.waitForFunction(()=>document.querySelector('#guestJoinStatus').textContent.includes('try again'));
 assert.equal(await page.locator('#guestForm').isVisible(),true);
 await page.evaluate(()=>{window.failJoin=false;window.failQr=true;});
 await page.locator('#guestSubmitBtn').click();
 await page.locator('#guestJoinedState').waitFor({state:'visible'});
 assert.equal(await page.locator('#joinAsGuestBtn').isVisible(),false);
 assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('nearify_ghost:'+id)).intentPrimary,eventId),'explore_ideas');
 await page.locator('#guestShowQrBtn').waitFor({state:'visible'});
 assert.match(await page.locator('#guestMyQrStatus').innerText(),/Couldn't load your QR/);
 await page.evaluate(()=>window.failQr=false);
 await page.locator('#guestShowQrBtn').click();
 await page.locator('#guestMyQrCode canvas').waitFor({state:'attached'});
 assert.equal(await page.locator('#guestShowQrBtn').isVisible(),false);
 await checkWidths('connect');
 await capture('connect');
 await page.locator('#guestQrLinkDetails summary').click();
 await page.locator('#guestMyQrLink').waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('#guestMyQrLink').value.includes('guest='));
 assert.equal(new URL(await page.locator('#guestMyQrLink').inputValue()).searchParams.get('guest'),'a'.repeat(64));
 assert.equal(new URL(await page.locator('#guestMyQrLink').inputValue()).searchParams.get('web'),'1');
 assert.equal(await page.locator('#guestMyQrStatus').innerText(),'');
 await page.evaluate(()=>{
  Object.defineProperty(window,'BarcodeDetector',{configurable:true,writable:true,value:undefined});
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,writable:true,value:async()=>{throw new DOMException('Denied','NotAllowedError');}});
 });
 await page.locator('#guestScanQrBtn').click();
 await page.waitForFunction(()=>document.querySelector('#guestQrStatus').textContent.includes('Camera access was denied'));
 const writesBeforeMismatch=await page.evaluate(()=>window.smokeCalls.filter(call=>['record_ghost_connection','save_guest_to_guest_connection'].includes(call.name)).length);
 await page.locator('#guestQrLink').fill('https://nearify.org/join/?event=44444444-4444-4444-8444-444444444444&profile=22222222-2222-4222-8222-222222222222&web=1');
 await page.locator('#guestSaveQrLinkBtn').click();
 await page.waitForFunction(()=>document.querySelector('#guestQrStatus').textContent.includes('different event'));
 assert.equal(await page.locator('#guestQrOpenEventBtn').isVisible(),true);
 const otherEventTarget=new URL(await page.locator('#guestQrOpenEventBtn').getAttribute('href'),base);
 assert.equal(otherEventTarget.searchParams.get('event'),'44444444-4444-4444-8444-444444444444');
 assert.equal(otherEventTarget.searchParams.get('profile'),'22222222-2222-4222-8222-222222222222');
 assert.equal(otherEventTarget.searchParams.get('web'),'1');
 assert.equal(await page.evaluate(()=>window.smokeCalls.filter(call=>['record_ghost_connection','save_guest_to_guest_connection'].includes(call.name)).length),writesBeforeMismatch,'do not save a person under the current wrong event');
 assert.ok(await page.evaluate(id=>localStorage.getItem('nearify_ghost:'+id),eventId),'preserve the original event guest session');
 await capture('different-event');
 await page.locator('#guestQrLink').fill('https://example.com/not-a-nearify-link');
 await page.locator('#guestSaveQrLinkBtn').click();
 assert.equal(await page.locator('#guestSaveConfirmation').isVisible(),false);
 assert.equal(await page.locator('#guestQrOpenEventBtn').isVisible(),false,'clear a stale different-event action for unrelated QR data');
 const valid = `https://nearify.org/join/?event=${eventId}&guest=${'b'.repeat(64)}`;
 await page.locator('#guestQrLink').fill(valid);
 await page.evaluate(()=>window.failSave=true);
 await page.locator('#guestSaveQrLinkBtn').click();
 await page.waitForFunction(()=>document.querySelector('#guestQrStatus').textContent.includes("Couldn't save this guest."));
 assert.equal(await page.locator('#guestSaveConfirmation').isVisible(),false);
 await page.evaluate(()=>{window.failSave=false;window.throwSave=true;});
 await page.locator('#guestSaveQrLinkBtn').click();
 await page.waitForFunction(()=>document.querySelector('#guestQrStatus').textContent.includes('Check your connection'));
 assert.equal(await page.locator('#guestSaveConfirmation').isVisible(),false);
 assert.equal(await page.locator('#guestSaveQrLinkBtn').isEnabled(),true);
 await page.evaluate(()=>window.throwSave=false);
 await page.locator('#guestSaveQrLinkBtn').click();
 await page.locator('#guestSaveConfirmation').waitFor({state:'visible'});
 assert.match(await page.locator('#guestSaveMessage').innerText(),/Sign in to keep this connection/);
 assert.match(await page.locator('#guestConnectionList').textContent(),/Jordan/);
 assert.equal(await page.locator('#guestConnectStage').isVisible(),false);
 assert.equal(await page.locator('#guestSavedName').innerText(),'Jordan Lee');
 assert.equal(await page.locator('.guest-joined-actions').isVisible(),true,'guest-to-account recovery remains available');
 await checkWidths('saved');
 await capture('saved');
 await page.locator('#guestSavedViewBtn').click();
 assert.equal(await page.locator('#guestHistorySection').isVisible(),true);
 assert.match(await page.locator('#guestConnectionList').innerText(),/Jordan/);
 await page.locator('#guestBackBtn').click();
 // Return to the saved view through another save to exercise its primary action.
 await page.locator('#guestScanQrBtn').click();
 await page.locator('#guestSaveQrLinkBtn').click();
 await page.locator('#guestSaveConfirmation').waitFor({state:'visible'});
 await page.locator('#guestKeepConnectingBtn').click();
 assert.equal(await page.locator('#guestSaveConfirmation').isVisible(),false);
 assert.equal(await page.locator('#guestScanQrBtn').evaluate(el=>el===document.activeElement),true);
 // Member QR path uses its existing RPC and offers the supported account transfer.
 await page.locator('#guestScanQrBtn').click();
 await page.locator('#guestQrLink').fill(`https://nearify.org/join/?event=${eventId}&profile=22222222-2222-4222-8222-222222222222`);
 await page.locator('#guestSaveQrLinkBtn').click();
 await page.locator('#guestSaveConfirmation').waitFor({state:'visible'});
 assert.match(await page.locator('#guestSaveMessage').innerText(),/member connection/);
 assert.equal(await page.locator('#guestSavedName').innerText(),'Taylor Chen');
 assert.equal(await page.locator('.guest-joined-actions').isVisible(),true);
 await capture('saved-member');
 // Guest rescans of an already verified member do not repeat the write.
 const guestMemberWrites=await page.evaluate(()=>window.smokeCalls.filter(call=>call.name==='record_ghost_connection').length);
 await page.locator('#guestKeepConnectingBtn').click();
 await page.locator('#guestScanQrBtn').click();
 await page.waitForFunction(()=>document.querySelector('#guestQrStatus').textContent.includes('Camera access was denied'));
 await page.locator('#guestQrLink').fill(`https://nearify.org/join/?event=${eventId}&profile=22222222-2222-4222-8222-222222222222`);
 await page.locator('#guestSaveQrLinkBtn').click();
 await page.locator('#guestSaveConfirmation').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>window.smokeCalls.filter(call=>call.name==='record_ghost_connection').length),guestMemberWrites);
 // Decode a real generated QR with native detection absent, then with broken native detection.
 await page.evaluate(async ({eventId})=>{
  const text='https://nearify.org/join/?event='+eventId+'&guest='+'c'.repeat(64);
  const host=document.createElement('div');
  new window.QRCode(host,{text,width:300,height:300});
  const frame=document.createElement('canvas'); frame.width=332;frame.height=332;
  const context=frame.getContext('2d');context.fillStyle='white';context.fillRect(0,0,332,332);
  context.drawImage(host.querySelector('canvas'),16,16);
  window.smokeQrFrame=frame;
  const {createQrDecoder}=await import('/assets/js/qrScanner.js');
  const software=await createQrDecoder();
  if(software.kind!=='jsqr'||(await software.detect(frame))[0]?.rawValue!==text) throw Error('Software QR decode failed');
  window.BarcodeDetector=class { static async getSupportedFormats(){return ['qr_code'];} async detect(){throw Error('Partial native implementation');} };
  const partial=await createQrDecoder();
  if((await partial.detect(frame))[0]?.rawValue!==text||partial.kind!=='jsqr') throw Error('Native runtime fallback failed');
  window.BarcodeDetector=undefined;
  window.cameraStops=0;
  navigator.mediaDevices.getUserMedia=async()=>{
   const cameraFrame=document.createElement('canvas');cameraFrame.width=332;cameraFrame.height=332;
   const cameraContext=cameraFrame.getContext('2d');cameraContext.fillStyle='white';cameraContext.fillRect(0,0,332,332);
   const stream=cameraFrame.captureStream(10);
   window.releaseQr=false;
   window.smokeCameraPaint=setInterval(()=>{
    cameraContext.fillStyle='white';cameraContext.fillRect(0,0,332,332);
    if(window.releaseQr) cameraContext.drawImage(host.querySelector('canvas'),16,16);
   },100);
   for(const track of stream.getTracks()){
    const stop=track.stop.bind(track);track.stop=()=>{window.cameraStops++;clearInterval(window.smokeCameraPaint);stop();};
   }
   return stream;
  };
 },{eventId});
 await page.locator('#guestKeepConnectingBtn').click();
 const beforeCamera=await page.evaluate(()=>window.smokeCalls.filter(c=>c.name==='save_guest_to_guest_connection').length);
 await page.locator('#guestScanQrBtn').click();
 await page.waitForFunction(()=>document.querySelector('#guestQrVideo').videoWidth>0);
 const cameraViewport=await page.locator('#guestQrVideo').evaluate(video=>{
  const rect=video.getBoundingClientRect();
  return {top:rect.top,bottom:rect.bottom,height:rect.height,viewport:innerHeight,inline:video.playsInline,muted:video.muted};
 });
 assert.ok(cameraViewport.top>=0&&cameraViewport.bottom<=cameraViewport.viewport,'camera preview must be inside the viewport');
 assert.ok(cameraViewport.height>=180,'camera preview must have a visible height');
 assert.equal(cameraViewport.inline,true);
 assert.equal(cameraViewport.muted,true);
 assert.equal(await page.locator('#guestQrScanner').evaluate(dialog=>dialog.matches(':modal')),true);
 if(process.env.SMOKE_SCREENSHOT) await page.screenshot({path:'/tmp/nearify-visible-camera-dialog.png'});
 await page.evaluate(()=>window.releaseQr=true);
 await page.locator('#guestSaveConfirmation').waitFor({state:'visible'}).catch(async error=>{
  console.log(await page.evaluate(()=>({status:document.querySelector('#guestQrStatus').textContent,ready:document.querySelector('#guestQrVideo').readyState,width:document.querySelector('#guestQrVideo').videoWidth,stops:window.cameraStops,events:window.smokeAnalytics.map(e=>[e.event_name,e.properties])})));
  throw error;
 });
 assert.equal(await page.evaluate(()=>window.smokeCalls.filter(c=>c.name==='save_guest_to_guest_connection').length),beforeCamera+1,'one detected QR produces one save');
 assert.ok(await page.evaluate(()=>window.cameraStops>0),'camera tracks are released after detection');
 assert.ok(await page.evaluate(()=>window.smokeAnalytics.some(e=>e.event_name==='guest_scan_started'&&e.properties.decoder==='jsqr')));
 assert.ok(await page.evaluate(()=>window.smokeAnalytics.some(e=>e.event_name==='guest_connection_saved'&&e.properties.method==='camera')));
 // Leaving the connect view while permission is pending must release a late stream.
 await page.locator('#guestKeepConnectingBtn').click();
 await page.evaluate(()=>{
  navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{
   window.resolveCamera=()=>{
    const stream=window.smokeQrFrame.captureStream(10);
    for(const track of stream.getTracks()){
     const stop=track.stop.bind(track);track.stop=()=>{window.cameraStops++;stop();};
    }
    resolve(stream);
   };
  });
 });
 const stopsBeforeNavigation=await page.evaluate(()=>window.cameraStops);
 await page.locator('#guestScanQrBtn').click();
 await page.waitForFunction(()=>typeof window.resolveCamera==='function');
 await page.locator('#guestCloseQrBtn').click();
 await page.evaluate(()=>window.resolveCamera());
 await page.waitForFunction(before=>window.cameraStops>before,stopsBeforeNavigation);
 assert.equal(await page.locator('#guestQrScanner').isVisible(),false);
 assert.equal(await page.locator('#guestQrVideo').evaluate(video=>video.srcObject),null);
 // Telemetry rejection must not change a successful connection save.
 await page.evaluate(()=>{window.failAnalytics=true;navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});
 await page.locator('#guestScanQrBtn').click();
 await page.waitForFunction(()=>document.querySelector('#guestQrStatus').textContent.includes('Camera access was denied'));
 await page.locator('#guestQrLink').fill(valid);
 await page.locator('#guestSaveQrLinkBtn').click();
 await page.locator('#guestSaveConfirmation').waitFor({state:'visible'});
 await page.waitForFunction(()=>window.smokeAnalytics.some(e=>e.event_name==='guest_connection_saved'&&e.properties.method==='link'));
 const metrics=await page.evaluate(()=>window.smokeAnalytics);
 assert.ok(metrics.some(e=>e.event_name==='guest_connection_save_failed'&&e.properties.reason==='invalid_qr'));
 assert.ok(metrics.some(e=>e.event_name==='guest_connection_save_failed'&&e.properties.reason==='request_failed'));
 for(const metric of metrics.filter(e=>e.event_name.startsWith('guest_'))){
  assert.equal(metric.referrer,'');
  assert.deepEqual(Object.keys(metric.properties).filter(k=>!['journey_id','method','reason','decoder','connection_kind','source'].includes(k)),[]);
  assert.ok(!JSON.stringify(metric).includes('test-only-token'));
  assert.ok(!JSON.stringify(metric).includes('guest='));
 }

 await page.reload();
 await page.locator('#guestJoinedState').waitFor({state:'visible'});
 for (const width of [320,390,768,1280]) {
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,`no horizontal overflow at ${width}px`);
 }
 await page.setViewportSize({width:390,height:844});
 if(process.env.SMOKE_SCREENSHOT) await page.screenshot({path:process.env.SMOKE_SCREENSHOT,fullPage:true});
 await page.goto(`${base}/events/event.html?id=${eventId}`);
 await page.locator('#eventContinueWithoutSignInBtn').waitFor({state:'visible'});
 assert.equal(await page.locator('#eventSections').isVisible(),false);
 assert.equal(await page.locator('#eventPrepareBtn').isVisible(),false,'signed-out visitor sees guest action rather than attendance sign-in');
 await checkWidths('event');
 await capture('event');
 await page.locator('#eventContinueWithoutSignInBtn').click();
 await page.waitForURL(`**/join/?event=${eventId}&web=1`);
 await page.locator('#guestJoinedState').waitFor({state:'visible'});
 await context.route('**/assets/js/vendor/qrcode.min.js*', route=>route.abort());
 await page.reload();
 await page.waitForFunction(()=>document.querySelector('#guestMyQrStatus').textContent.includes('Copy your guest link'));
 assert.equal(await page.locator('#guestQrLinkDetails').evaluate(el=>el.open),true);
 assert.ok(await page.locator('#guestMyQrLink').inputValue());
 // A guest handoff must show either success or a visible failure, retaining failed QR targets.
 await page.goto(`${base}/join/?event=${eventId}&guest=${'a'.repeat(64)}&web=1`);
 await page.locator('#guestHandoffError').waitFor({state:'visible'});
 assert.equal(await page.locator('#guestHandoffErrorTitle').innerText(),'This is your guest QR');
 assert.equal(await page.locator('#guestHandoffRetryBtn').isVisible(),false);
 assert.equal(await page.evaluate(()=>window.smokeCalls.some(call=>call.name==='save_guest_to_guest_connection')),false);
 assert.equal(new URL(page.url()).searchParams.get('guest'),'a'.repeat(64));
 await capture('guest-self-handoff');
 await page.locator('#guestHandoffBackBtn').click();
 assert.equal(await page.locator('#guestConnectStage').isVisible(),true);
 assert.equal(new URL(page.url()).searchParams.has('guest'),false);
 await page.evaluate(()=>localStorage.setItem('smoke_handoff_fail','1'));
 await page.goto(`${base}/join/?event=${eventId}&guest=${'b'.repeat(64)}&web=1`);
 await page.locator('#guestHandoffError').waitFor({state:'visible'});
 assert.equal(await page.locator('#guestSaveConfirmation').isVisible(),false);
 assert.equal(await page.locator('#guestConnectStage').isVisible(),false);
 assert.equal(new URL(page.url()).searchParams.get('guest'),'b'.repeat(64));
 await capture('handoff-error');
 await page.evaluate(()=>localStorage.removeItem('smoke_handoff_fail'));
 await page.locator('#guestHandoffRetryBtn').click();
 await page.locator('#guestSaveConfirmation').waitFor({state:'visible'});
 await page.waitForFunction(()=>!new URLSearchParams(location.search).has('guest'));
 assert.ok(await page.evaluate(()=>window.smokeCalls.some(call=>call.name==='save_guest_to_guest_connection')));
 // A pending handoff must show a saving stage instead of the visitor's own QR.
 await page.evaluate(()=>localStorage.setItem('smoke_slow_handoff','1'));
 await page.goto(`${base}/join/?event=${eventId}&guest=${'c'.repeat(64)}&web=1`);
 await page.locator('#guestHandoffPending').waitFor({state:'visible'});
 assert.equal(await page.locator('#guestConnectStage').isVisible(),false);
 await page.waitForFunction(()=>typeof window.releaseGuestHandoff==='function');
 await page.evaluate(()=>{localStorage.removeItem('smoke_slow_handoff');window.releaseGuestHandoff();});
 await page.locator('#guestSaveConfirmation').waitFor({state:'visible'});
 await page.waitForFunction(()=>!new URLSearchParams(location.search).has('guest'));
 await page.evaluate(()=>localStorage.setItem('smoke_member_fail','1'));
 await page.goto(`${base}/join/?event=${eventId}&profile=22222222-2222-4222-8222-222222222222&web=1`);
 await page.locator('#guestHandoffError').waitFor({state:'visible'});
 assert.equal(new URL(page.url()).searchParams.get('profile'),'22222222-2222-4222-8222-222222222222');
 assert.equal(await page.locator('#guestHandoffSupportDetails').isVisible(),true);
 const supportReference=JSON.parse(await page.locator('#guestHandoffSupportDetails code').textContent());
 assert.equal(supportReference.code,'TEST');
 assert.equal(supportReference.operation,'record_ghost_connection');
 assert.ok(!JSON.stringify(supportReference).includes('private'));
 assert.ok(!JSON.stringify(supportReference).includes('test-only-token'));
 await page.evaluate(()=>localStorage.removeItem('smoke_member_fail'));
 await page.locator('#guestHandoffRetryBtn').click();
 await page.locator('#guestSaveConfirmation').waitFor({state:'visible'});
 await page.waitForFunction(()=>!new URLSearchParams(location.search).has('profile'));
 // The same tab's post-sign-in claim keeps the journey correlation and records actual RPC success.
 const expectedJourney=metrics.find(e=>e.event_name==='guest_session_created').properties.journey_id;
 await page.evaluate(()=>{localStorage.setItem('nearify_pending_ghost_claim','true');localStorage.setItem('smoke_auth','true');});
 await page.reload();
 await page.locator('#claimSuccessState').waitFor({state:'visible'});
 await page.waitForFunction(()=>window.smokeAnalytics.some(e=>e.event_name==='guest_account_claimed'));
 assert.equal(await page.evaluate(()=>window.smokeAnalytics.find(e=>e.event_name==='guest_account_claimed').properties.journey_id),expectedJourney);
 assert.ok(await page.evaluate(()=>window.smokeCalls.some(call=>call.name==='claim_guest_network')));
 await page.goto(`${base}/join/?event=${eventId}&guest=${'d'.repeat(64)}&web=1`);
 await page.locator('#claimSuccessState').waitFor({state:'visible'});
 assert.ok(await page.evaluate(()=>window.smokeCalls.some(call=>call.name==='save_guest_to_guest_connection')));
 assert.ok(await page.evaluate(()=>window.smokeCalls.some(call=>call.name==='claim_guest_network')));
 assert.equal(await page.locator('#authHandoffSection').isVisible(),false);
 // A signed-in mobile event QR stays in the browser, including a sign-in return.
 await page.addInitScript(()=>Object.defineProperty(navigator,'userAgent',{configurable:true,get:()=> 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'}));
 await page.evaluate(eventId=>{
  localStorage.setItem('nearify_attendee_auth_return',JSON.stringify({eventId,continueJoin:true}));
  localStorage.removeItem('nearify_attendee_join_pending');
 },eventId);
 await page.goto(`${base}/join/?event=${eventId}&web=1`);
 await page.waitForURL(`**/events/event.html?id=${eventId}&web=1`);
 assert.equal(await page.locator('.nav-scan-link').isVisible(),true);
 await page.locator('#eventHeroCopy').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>localStorage.getItem('nearify_attendee_join_pending')),null,'web sign-in return must not attempt a native app handoff');
 const personalUrl=`${base}/join/?event=${eventId}&profile=22222222-2222-4222-8222-222222222222&web=1`;
 for(let repeat=0;repeat<2;repeat++){
  await page.goto(personalUrl);
  await page.locator('#claimSuccessState').waitFor({state:'visible'});
  assert.equal(await page.locator('.claim-success-title').innerText(),'Connection saved');
  assert.match(await page.locator('.claim-success-profile-msg').innerText(),/mutual connection if they save you back/);
  assert.ok(await page.evaluate(()=>window.smokeCalls.some(call=>call.name==='confirm_relationship')));
  assert.equal(await page.evaluate(()=>window.smokeCalls.some(call=>['create_ghost_participant','record_ghost_connection'].includes(call.name))),false,'account save must not use guest credentials');
 }
 await page.locator('.nav-user').waitFor({state:'visible'});
 await checkWidths('signed-in header');
 if(process.env.SMOKE_SCREENSHOT) await page.locator('.nav').screenshot({path:'/tmp/nearify-account-header.png'});
 await page.goto(`${base}/join/?event=${eventId}&profile=33333333-3333-4333-8333-333333333333&web=1`);
 await page.waitForFunction(()=>document.querySelector('#joinTitle').textContent==='This is your QR');
 assert.equal(await page.locator('#webScanRetryBtn').count(),0);
 assert.equal(await page.locator('#scanAnotherQr').isVisible(),true);
 assert.equal(await page.evaluate(()=>window.smokeCalls.some(call=>['confirm_relationship','record_ghost_connection','create_ghost_participant'].includes(call.name))),false,'self scans must not write');
 await checkWidths('self-scan');
 await capture('self-scan');
 assert.deepEqual(errors,[]);
 console.log('Guest flow passed (including real software QR decoding, synthetic camera-to-save, late camera cleanup, and analytics failure isolation): join validation/retry, local goal, automatic QR/retry/link fallback, dedicated connect/saved/history views, invalid/failed/successful saves, member save, returning session, responsive widths, event-to-guest navigation. No live backend requests.');
} finally {
 await browser?.close();
 server.kill();
}
