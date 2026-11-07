import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd();
const mock=`export async function getSessionCached(){return {data:{session:window.signedOut?null:{user:{id:'owner'}}}};}
export const supabase={auth:{onAuthStateChange(fn){window.authChanged=fn;return {data:{subscription:{unsubscribe(){}}}};}},rpc:async(name)=>name==='get_event_preparation_people'?({data:window.discoveryOnly?[{profile_id:'11111111-1111-4111-8111-111111111111',name:'Shared profile',avatar_url:null}]:[],error:null}):({data:{eligible:true,people:window.hideListing||window.discoveryOnly?[]:[{profile_id:'11111111-1111-4111-8111-111111111111',name:'<img src=x onerror=window.injected=true>',note:'Private context',intention:'Ask about the prototype',opted_in_listing:true,saved_for_event:false,previous_event_name:'Earlier workshop'}]},error:null})};`;
const html=`<!doctype html><html><body><div id="eventSections"></div><script type="module">import {mountEventPreparation} from '/assets/js/eventPreparation.js';mountEventPreparation('44444444-4444-4444-8444-444444444444');</script></body></html>`;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  res.setHeader('Content-Type','text/javascript');
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
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByText('A little preparation',{exact:true}).waitFor();
 assert.ok(await page.getByText('Opted-in listing for this event',{exact:true}).isVisible());
 assert.ok(await page.getByText('Your earlier QR save: Earlier workshop',{exact:true}).isVisible());
 assert.ok(await page.getByText('Next time: Ask about the prototype',{exact:true}).isVisible());
 assert.equal(await page.evaluate(()=>window.injected),undefined);
 await page.evaluate(()=>{window.hideListing=true;document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForFunction(()=>document.querySelector('#eventSections section').hidden);
 assert.equal(await page.locator('#eventSections').textContent(),'');
 await page.evaluate(()=>{window.hideListing=false;document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByText('A little preparation',{exact:true}).waitFor();
 await page.evaluate(()=>{window.discoveryOnly=true;document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('heading',{name:'People to explore'}).waitFor();
 assert.ok(await page.getByRole('heading',{name:'Shared profile'}).isVisible());
 assert.ok(await page.getByText('Opted-in listing for this event',{exact:true}).isVisible());
 await page.evaluate(()=>{window.signedOut=true;window.authChanged('SIGNED_OUT',null);});
 assert.equal(await page.locator('#eventSections').textContent(),'');assert.deepEqual(errors,[]);
 console.log('PASS: factual preparation labels, private intention, safe text, roster removal and auth clearing.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
