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
 const result = { data: table === 'events' ? event : table === 'profiles' ? {id:'33333333-3333-4333-8333-333333333333'} : [], error: null };
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
 auth: {getSession:getSessionCached, onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 async rpc(name, args) {
  window.smokeCalls.push({name,args});
  if (name==='create_ghost_participant') {
   if(window.failJoin) return {error:{message:'Simulated join failure'}};
   return {data:{ghost_id:'test-guest',ghost_token:'test-only-token',event_id:event.id,display_name:args.p_display_name},error:null};
  }
  if(name==='claim_guest_network') return {data:{profile_id:'33333333-3333-4333-8333-333333333333'},error:null};
  if(name==='get_my_guest_share_code') {
   if(window.failQr) throw new Error('Simulated QR failure');
   return {data:'a'.repeat(64),error:null};
  }
  if(name==='save_guest_to_guest_connection') {
   if(window.throwSave) throw new Error('Simulated network failure');
   if(window.failSave) return {error:{code:'TEST',message:'Simulated save failure'}};
   window.guestSaved=true; return {data:{guest_name:'Jordan Lee'},error:null};
  }
  if(name==='get_my_guest_to_guest_connections') return {data:window.guestSaved?[{guest_name:'Jordan Lee'}]:[],error:null};
  if(name==='record_ghost_connection') {window.memberSaved=true;return {data:{to_profile_name:'Taylor Chen'},error:null};}
  if(name==='get_ghost_connection_history') return {data:window.memberSaved?[{to_profile_name:'Taylor Chen',to_profile_id:'22222222-2222-4222-8222-222222222222'}]:[],error:null};
  return {data:[],error:null};
 }
};
export const createScopedSupabaseClient = () => supabase;
`;
const server = spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1'], {cwd:new URL('../', import.meta.url), stdio:['ignore','pipe','pipe']});
let browser;
try {
 const [output] = await once(server.stdout, 'data');
 const port = String(output).match(/port (\d+)/)?.[1];
 assert.ok(port, 'static server started');
 const base = `http://127.0.0.1:${port}`;
 browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context = await browser.newContext({viewport:{width:390,height:844}});
 await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if(url.pathname === '/assets/js/supabaseClient.js') return route.fulfill({contentType:'text/javascript',body:fixture});
  // External assets are intentionally unavailable: link fallback must still work.
  if(url.origin !== base) return route.abort();
  return route.continue();
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
 await page.goto(`${base}/join/?event=${eventId}`);
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
 assert.ok((await page.locator('#guestMyQrLink').inputValue()).endsWith('a'.repeat(64)));
 assert.equal(await page.locator('#guestMyQrStatus').innerText(),'');
 await page.evaluate(()=>{
  Object.defineProperty(window,'BarcodeDetector',{configurable:true,writable:true,value:undefined});
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,writable:true,value:async()=>{throw new DOMException('Denied','NotAllowedError');}});
 });
 await page.locator('#guestScanQrBtn').click();
 await page.waitForFunction(()=>document.querySelector('#guestQrStatus').textContent.includes('Camera access was denied'));
 await page.locator('#guestQrLink').fill('https://example.com/not-a-nearify-link');
 await page.locator('#guestSaveQrLinkBtn').click();
 assert.equal(await page.locator('#guestSaveConfirmation').isVisible(),false);
 const valid = `https://nearify.org/join/?event=${eventId}&guest=${'b'.repeat(64)}`;
 await page.locator('#guestQrLink').fill(valid);
 await page.evaluate(()=>window.failSave=true);
 await page.locator('#guestSaveQrLinkBtn').click();
 await page.waitForFunction(()=>document.querySelector('#guestQrStatus').textContent.includes('TEST'));
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
   const stream=frame.captureStream(10);
   window.smokeCameraPaint=setInterval(()=>context.drawImage(host.querySelector('canvas'),16,16),100);
   for(const track of stream.getTracks()){
    const stop=track.stop.bind(track);track.stop=()=>{window.cameraStops++;clearInterval(window.smokeCameraPaint);stop();};
   }
   return stream;
  };
 },{eventId});
 await page.locator('#guestKeepConnectingBtn').click();
 const beforeCamera=await page.evaluate(()=>window.smokeCalls.filter(c=>c.name==='save_guest_to_guest_connection').length);
 await page.locator('#guestScanQrBtn').click();
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
 await page.locator('#guestViewConnectionsBtn').click();
 await page.evaluate(()=>window.resolveCamera());
 await page.waitForFunction(before=>window.cameraStops>before,stopsBeforeNavigation);
 assert.equal(await page.locator('#guestHistorySection').isVisible(),true);
 assert.equal(await page.locator('#guestQrVideo').evaluate(video=>video.srcObject),null);
 await page.locator('#guestBackBtn').click();
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
 await page.waitForURL(`**/join/?event=${eventId}`);
 await page.locator('#guestJoinedState').waitFor({state:'visible'});
 await context.route('**/assets/js/vendor/qrcode.min.js*', route=>route.abort());
 await page.reload();
 await page.waitForFunction(()=>document.querySelector('#guestMyQrStatus').textContent.includes('Copy your guest link'));
 assert.equal(await page.locator('#guestQrLinkDetails').evaluate(el=>el.open),true);
 assert.ok(await page.locator('#guestMyQrLink').inputValue());
 // The same tab's post-sign-in claim keeps the journey correlation and records actual RPC success.
 const expectedJourney=metrics.find(e=>e.event_name==='guest_session_created').properties.journey_id;
 await page.evaluate(()=>{localStorage.setItem('nearify_pending_ghost_claim','true');localStorage.setItem('smoke_auth','true');});
 await page.reload();
 await page.locator('#claimSuccessState').waitFor({state:'visible'});
 await page.waitForFunction(()=>window.smokeAnalytics.some(e=>e.event_name==='guest_account_claimed'));
 assert.equal(await page.evaluate(()=>window.smokeAnalytics.find(e=>e.event_name==='guest_account_claimed').properties.journey_id),expectedJourney);
 assert.ok(await page.evaluate(()=>window.smokeCalls.some(call=>call.name==='claim_guest_network')));
 assert.deepEqual(errors,[]);
 console.log('Guest flow passed (including real software QR decoding, synthetic camera-to-save, late camera cleanup, and analytics failure isolation): join validation/retry, local goal, automatic QR/retry/link fallback, dedicated connect/saved/history views, invalid/failed/successful saves, member save, returning session, responsive widths, event-to-guest navigation. No live backend requests.');
} finally {
 await browser?.close();
 server.kill();
}
