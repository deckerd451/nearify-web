import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd();
const mock=`export async function getSessionCached(){return {data:{session:window.signedOut?null:{user:{id:'owner'}}}};}
export const supabase={auth:{onAuthStateChange(fn){window.authChanged=fn;return {data:{subscription:{unsubscribe(){}}}};}},rpc:async(name)=>{
 if(name==='current_profile_id')return {data:'owner-profile',error:null};
 if(name==='web_inbox')return {data:{threads:window.mode==='unread'?[{id:'thread',profile_id:'person',name:'Jordan',unread:true}]:[],requests:[],detail_requests:[]},error:null};
 if(name==='get_saved_people')return {data:[{profile_id:'person',name:'Jordan'}],error:null};
 if(name==='ambient_contexts'){if(window.mode==='slow')await new Promise(resolve=>{window.releaseHome=resolve;});return {data:window.mode==='context'?[{profile_id:'person',note:'Ask about the community project. '.repeat(25),can_message:true,updated_at:new Date().toISOString()}]:[],error:null};}
 if(name==='web_open_conversation')return {data:'thread',error:null};
 if(window.mode==='failure')return {data:null,error:{message:'Unavailable'}};
 return {data:{dismissed_people:[],review:window.mode==='review'?{event_id:'event',event_name:'Workshop',count:1,people:[]}:null},error:null};}};`;
const index=await fs.readFile(path.join(root,'index.html'),'utf8');
const staticIndex=index.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const html=staticIndex.replace('</head>','<style>#loadingView,#landingView{display:none!important}#dashboardView{display:block!important}</style></head>').replace('</body>',`<script type="module">window.mode='review';const {mountAmbientHome}=await import('/assets/js/ambientHome.js');window.home=mountAmbientHome();</script></body>`);
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/landing'){res.setHeader('Content-Type','text/html');const source=(await fs.readFile(path.join(root,'index.html'),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</head>','<style>#loadingView{display:none!important}#landingView{display:flex!important}#dashboardView{display:none!important}</style></head>');res.end(source);return;}
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.svg')?'image/svg+xml':'text/javascript');
  if(url.pathname==='/assets/js/supabaseClient.js'){res.end(mock);return;}
  const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)){res.statusCode=403;res.end();return;}
  res.end(await fs.readFile(file));
 }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByRole('heading',{name:'Remember who you met at Workshop'}).waitFor();
 if(process.env.NEARIFY_REVIEW_ARTIFACT_DIR){
  await fs.mkdir(process.env.NEARIFY_REVIEW_ARTIFACT_DIR,{recursive:true});
  await page.screenshot({path:path.join(process.env.NEARIFY_REVIEW_ARTIFACT_DIR,'home-mobile.png'),fullPage:true});
 }
 assert.equal(await page.locator('#ambientHome .btn.primary').count(),1);
 assert.ok((await page.locator('#ambientHome').textContent()).includes('1 person'));
 assert.ok(!(await page.locator('#ambientHome').textContent()).includes('up to date'));
 await page.evaluate(()=>{window.mode='unread';document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('heading',{name:'Hear from Jordan'}).waitFor();
 await page.evaluate(()=>{window.mode='context';document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('heading',{name:'Pick up with Jordan'}).waitFor();
 assert.ok((await page.locator('#ambientHome .home-value-detail').textContent()).length<=181);
 await page.getByRole('button',{name:'Continue conversation'}).waitFor();
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`horizontal overflow at ${width}`);
  const cta=await page.locator('#ambientHome .btn.primary').boundingBox();
  assert.ok(cta.y+cta.height<700,`primary action below first viewport at ${width}`);
  assert.ok(await page.evaluate(()=>document.querySelector('#ambientHome').compareDocumentPosition(document.querySelector('.cc-home-quicklinks')) & Node.DOCUMENT_POSITION_FOLLOWING));
 }
 await page.setViewportSize({width:390,height:844});
 if(process.env.NEARIFY_REVIEW_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.NEARIFY_REVIEW_ARTIFACT_DIR,'home-context-mobile.png'),fullPage:true});
 assert.equal(await page.locator('#ambientHome .btn.primary').count(),1);
 await page.evaluate(()=>{window.mode='failure';document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('heading',{name:'Pick up a connection'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Try again'}).count(),1);
 await page.evaluate(()=>{window.mode='event';window.home.setEvents([{event:{id:'event',name:'Upcoming workshop',starts_at:new Date(Date.now()+3600000).toISOString()}}],'owner-profile');document.dispatchEvent(new Event('visibilitychange'));window.home.setEvents([{event:{id:'event',name:'Upcoming workshop',starts_at:new Date(Date.now()+3600000).toISOString()}}],'owner-profile');});
 await page.getByRole('heading',{name:'Get ready for Upcoming workshop'}).waitFor();
 assert.equal(await page.locator('#ambientHome .btn.primary').getAttribute('href'),'/events/event.html?id=event#prepare');
 assert.equal(await page.locator('#ambientHome .btn.primary').count(),1);
 await page.evaluate(()=>{window.mode='idle';window.home.setEvents([],'owner-profile');document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('heading',{name:'Make your next hello easier'}).waitFor();
 assert.equal(await page.locator('#ambientHome .btn.primary').getAttribute('href'),'/scan/?web=1');
 await page.evaluate(()=>{window.authChanged('SIGNED_OUT',null);window.mode='slow';window.authChanged('SIGNED_IN',{user:{id:'owner'}});});
 await page.getByRole('heading',{name:'Pick up with someone you know'}).waitFor();
 assert.equal(await page.locator('#ambientHome .btn.primary').getAttribute('href'),'/connections/');
 await page.waitForFunction(()=>typeof window.releaseHome==='function');
 await page.evaluate(()=>{window.signedOut=true;window.authChanged('SIGNED_OUT',null);});
 assert.equal(await page.locator('#ambientHome').textContent(),'');await page.evaluate(()=>window.releaseHome());await page.waitForTimeout(100);assert.equal(await page.locator('#ambientHome').textContent(),'');assert.deepEqual(errors,[]);
 if(process.env.NEARIFY_REVIEW_ARTIFACT_DIR){
  await page.goto('http://127.0.0.1:'+server.address().port+'/landing');
  await page.getByRole('heading',{name:'Remember who you met.'}).waitFor();
  await page.screenshot({path:path.join(process.env.NEARIFY_REVIEW_ARTIFACT_DIR,'landing-mobile.png'),fullPage:true});
 }
 console.log('PASS: value-first real Home markup, review/context/message/event/empty/error/loading states, CTA above fold at 320/390/768/1440px, no overflow, late-read sign-out clearing.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
