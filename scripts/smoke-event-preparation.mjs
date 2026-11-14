import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd();
const mock=`export async function getSessionCached(){if(location.search.includes('initialRace'))await new Promise(r=>setTimeout(r,40));return {data:{session:window.signedOut?null:{user:{id:'owner'}}}};}
export const supabase={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'me',interests:window.shared?['AI']:[]},error:null})})})}),auth:{onAuthStateChange(fn){window.authChanged=fn;if(location.search.includes('initialRace'))setTimeout(()=>fn('INITIAL_SESSION',{user:{id:'owner'}}),0);return {data:{subscription:{unsubscribe(){}}}};}},rpc:async(name)=>{if(window.slowOnce&&name==='ambient_event_prep'){window.slowOnce=false;await new Promise(resolve=>{window.releasePreparation=resolve;});}return name==='get_event_connection_people'?({data:window.discoveryOnly?[{profile_id:'11111111-1111-4111-8111-111111111111',name:'Shared profile',avatar_url:null,interests:['AI']}]:[],error:null}):({data:{eligible:true,people:window.broken?{}:window.hideListing||window.discoveryOnly?[]:[{profile_id:'11111111-1111-4111-8111-111111111111',name:window.layout?'Jordan Lee':'<img src=x onerror=window.injected=true>',note:'Private context',intention:'Ask about the prototype',opted_in_listing:true,saved_for_event:true,previous_event_name:'Earlier workshop'}]},error:null});}};`;
const html=`<!doctype html><html><body><div id="eventSections"></div><script type="module">import {mountEventPreparation} from '/assets/js/eventPreparation.js';mountEventPreparation('44444444-4444-4444-8444-444444444444');</script></body></html>`;
const layout=(await fs.readFile('events/event.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</head>','<base href="/events/"></head>').replace('</body>',`<script type="module">window.layout=true;document.getElementById('eventSections').style.display='';document.getElementById('eventIntentSection').style.display='';const {showEventGoalSummary}=await import('/assets/js/eventGoalSummary.js');showEventGoalSummary('explore_ideas');const {mountEventPreparation}=await import('/assets/js/eventPreparation.js');mountEventPreparation('44444444-4444-4444-8444-444444444444');</script></body>`);
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  if(url.pathname==='/layout'){res.setHeader('Content-Type','text/html');res.end(layout);return;}
  res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.png')?'image/png':'text/javascript');
  if(url.pathname==='/assets/js/supabaseClient.js'){res.end(mock);return;}
  const file=path.resolve(root,'.'+url.pathname);
  if(!file.startsWith(root+path.sep)){res.statusCode=403;res.end();return;}
  res.end(await fs.readFile(file));
 }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?initialRace=1');
 await page.getByText('Your saved conversation reminder',{exact:true}).waitFor({timeout:3000});
 assert.ok(await page.getByText('You saved their QR for this event. This does not confirm attendance.',{exact:true}).isVisible());
 assert.ok(await page.getByText('Your earlier QR save: Earlier workshop',{exact:true}).isVisible());
 assert.ok(await page.getByText('Ask about the prototype',{exact:true}).isVisible());
 assert.ok((await page.getByRole('link',{name:'Review profile',exact:true}).getAttribute('href')).endsWith('&event=44444444-4444-4444-8444-444444444444'));
 assert.equal(await page.evaluate(()=>window.injected),undefined);
 await page.evaluate(()=>{window.slowOnce=true;document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForFunction(()=>typeof window.releasePreparation==='function');
 await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.releasePreparation();});
 await page.getByText('Your saved conversation reminder',{exact:true}).waitFor({timeout:3000});
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
 assert.equal(await page.locator('#eventSuggestion').isVisible(),false);
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 await page.getByText('Your saved conversation reminder',{exact:true}).waitFor({timeout:3000});
 await page.evaluate(()=>{window.broken=true;document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('heading',{name:'Suggestions couldn’t load'}).waitFor({timeout:3000});
 await page.evaluate(()=>{window.broken=false;});
 await page.getByRole('button',{name:'Try again'}).click();
 await page.getByText('Your saved conversation reminder',{exact:true}).waitFor({timeout:3000});
 await page.evaluate(()=>{window.hideListing=true;document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('heading',{name:'Explore people at your own pace'}).waitFor();
 assert.equal(await page.getByText('Ask about the prototype',{exact:true}).count(),0);
 await page.evaluate(()=>{window.hideListing=false;document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByText('Your saved conversation reminder',{exact:true}).waitFor();
 await page.evaluate(()=>{window.discoveryOnly=true;document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('heading',{name:'Explore people at your own pace'}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Shared profile'}).count(),0);
 await page.evaluate(()=>{window.shared=true;document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('heading',{name:'Shared profile'}).waitFor({timeout:3000});
 assert.ok(await page.getByText('Opted-in listing for this event. Plans and attendance can change.',{exact:true}).isVisible());
 await page.evaluate(()=>{window.signedOut=true;window.authChanged('SIGNED_OUT',null);});
 assert.equal(await page.locator('#eventSections').textContent(),'');assert.deepEqual(errors,[]);
 await page.goto('http://127.0.0.1:'+server.address().port+'/layout');
 await page.getByRole('heading',{name:'Jordan Lee'}).waitFor();
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:844});await page.locator('#eventSuggestion').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#eventSuggestion h3').count(),1);
  assert.equal(await page.locator('#eventSuggestion .btn.primary').count(),1);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 if(process.env.NEARIFY_REVIEW_ARTIFACT_DIR){await fs.mkdir(process.env.NEARIFY_REVIEW_ARTIFACT_DIR,{recursive:true});await page.setViewportSize({width:390,height:844});await page.locator('#eventSuggestion').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.NEARIFY_REVIEW_ARTIFACT_DIR,'single-event-suggestion.png')});}
 console.log('PASS: one private reminder or factual shared-interest suggestion, no unsupported match, safe text, initial-auth and in-flight refresh recovery, cached-page restoration, retry feedback, and sign-out clearing.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
