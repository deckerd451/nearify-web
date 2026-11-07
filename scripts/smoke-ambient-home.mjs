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
 if(name==='ambient_contexts')return {data:[],error:null};
 if(window.mode==='failure')return {data:null,error:{message:'Unavailable'}};
 return {data:{dismissed_people:[],review:window.mode==='review'?{event_id:'event',event_name:'Workshop',count:1,people:[]}:null},error:null};}};`;
const html=`<!doctype html><html><head><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/follow-up.css"></head><body class="cc-page"><main class="cc-dashboard"><nav class="cc-home-quicklinks"><a href="/scan/">Scan QR</a><a href="/connections/">People</a><a href="/messages/">Messages</a></nav><div id="ambientHome" hidden></div><details><summary>Events and saved people</summary><p>Optional browsing</p></details></main><script type="module">window.mode='review';const {mountAmbientHome}=await import('/assets/js/ambientHome.js');window.home=mountAmbientHome();</script></body></html>`;
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
 await page.getByRole('heading',{name:'Keep the context from Workshop'}).waitFor();
 if(process.env.NEARIFY_REVIEW_ARTIFACT_DIR){
  await fs.mkdir(process.env.NEARIFY_REVIEW_ARTIFACT_DIR,{recursive:true});
  await page.screenshot({path:path.join(process.env.NEARIFY_REVIEW_ARTIFACT_DIR,'home-mobile.png'),fullPage:true});
 }
 assert.equal(await page.locator('#ambientHome .btn.primary').count(),1);
 assert.ok((await page.locator('#ambientHome').textContent()).includes('1 person'));
 assert.ok(!(await page.locator('#ambientHome').textContent()).includes('up to date'));
 await page.evaluate(()=>{window.mode='unread';document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('heading',{name:'A conversation to continue'}).waitFor();
 assert.equal(await page.locator('#ambientHome .btn.primary').count(),1);
 await page.evaluate(()=>{window.mode='failure';document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('heading',{name:'We couldn’t check all your activity.'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Try again'}).count(),1);
 await page.evaluate(()=>{window.mode='event';window.home.setEvents([{event:{id:'event',name:'Upcoming workshop',starts_at:new Date(Date.now()+3600000).toISOString()}}],'owner-profile');document.dispatchEvent(new Event('visibilitychange'));window.home.setEvents([{event:{id:'event',name:'Upcoming workshop',starts_at:new Date(Date.now()+3600000).toISOString()}}],'owner-profile');});
 await page.getByRole('heading',{name:'Your next event'}).waitFor();
 assert.equal(await page.locator('#ambientHome .btn.primary').count(),1);
 await page.evaluate(()=>{window.signedOut=true;window.authChanged('SIGNED_OUT',null);});
 assert.equal(await page.locator('#ambientHome').textContent(),'');assert.deepEqual(errors,[]);
 if(process.env.NEARIFY_REVIEW_ARTIFACT_DIR){
  await page.goto('http://127.0.0.1:'+server.address().port+'/landing');
  await page.getByRole('heading',{name:'Meet people. Keep the connection.'}).waitFor();
  await page.screenshot({path:path.join(process.env.NEARIFY_REVIEW_ARTIFACT_DIR,'landing-mobile.png'),fullPage:true});
 }
 console.log('PASS: one primary action, review singular/plural, unread priority, honest read failure, known event and sign-out clearing.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
