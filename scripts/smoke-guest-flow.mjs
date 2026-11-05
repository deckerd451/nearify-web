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
function query(table) {
 const result = { data: table === 'events' ? event : [], error: null };
 const chain = new Proxy({}, { get(_, key) {
  if (key === 'then') return Promise.resolve(result).then.bind(Promise.resolve(result));
  return () => chain;
 }});
 return chain;
}
export const getSessionCached = async () => ({data:{session:null},error:null});
export const supabase = {
 from: query,
 auth: {getSession:getSessionCached, onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 async rpc(name, args) {
  window.smokeCalls.push({name,args});
  if (name==='create_ghost_participant') {
   if(window.failJoin) return {error:{message:'Simulated join failure'}};
   return {data:{ghost_id:'test-guest',ghost_token:'test-only-token',event_id:event.id,display_name:args.p_display_name},error:null};
  }
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
 await page.locator('#guestScanQrBtn').click();
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
 assert.deepEqual(errors,[]);
 console.log('Guest flow passed: join validation/retry, local goal, automatic QR/retry/link fallback, dedicated connect/saved/history views, invalid/failed/successful saves, member save, returning session, responsive widths, event-to-guest navigation. No live backend requests.');
} finally {
 await browser?.close();
 server.kill();
}
