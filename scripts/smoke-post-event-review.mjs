import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd();
const mock=`export async function getSessionCached(){return {data:{session:window.signedOut?null:{user:{id:'owner'}}}};}
export const supabase={auth:{onAuthStateChange(fn){window.authChanged=fn;return {data:{subscription:{unsubscribe(){}}}};}},rpc:async(name,args)=>{
 window.calls=window.calls||[];window.calls.push({name,args});
 if(name==='ambient_home_extras')return {data:{dismissed_people:[],review:window.done?null:{event_id:'44444444-4444-4444-8444-444444444444',event_name:'Workshop',count:1,people:[{profile_id:'11111111-1111-4111-8111-111111111111',name:'<img src=x onerror=window.injected=true>',has_context:false}]}},error:null};
 if(window.fail)return {data:null,error:{message:'Unavailable'}};
 window.done=true;return {data:null,error:null};}};`;
const html=`<!doctype html><html><body><main class="connections-page"><div class="connections-page-header"><h1>My Connections</h1></div></main><script type="module">import {mountPostEventReview} from '/assets/js/postEventReview.js';mountPostEventReview();</script></body></html>`;
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

 await page.getByText('Keep the context from Workshop',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Review saved people'}).getAttribute('aria-expanded'),'false');
 await page.getByRole('button',{name:'Review saved people'}).click();
 assert.ok(await page.getByText(' — add a private note if useful',{exact:true}).isVisible());
 assert.equal(await page.evaluate(()=>window.injected),undefined);
 await page.evaluate(()=>window.fail=true);
 await page.getByRole('button',{name:'Later — hide for a day'}).click();
 await page.getByRole('status').filter({hasText:'Couldn’t save'}).waitFor();
 assert.ok(await page.getByText('Keep the context from Workshop',{exact:true}).isVisible());
 await page.evaluate(()=>window.fail=false);
 await page.getByRole('button',{name:'Later — hide for a day'}).click();
 await page.waitForFunction(()=>document.querySelector('.private-context').hidden);
 await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.locator('.private-context').textContent(),'');
 await page.evaluate(()=>{window.done=false;document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByText('Keep the context from Workshop',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Done reviewing'}).click();
 await page.waitForFunction(()=>document.querySelector('.private-context').hidden);
 assert.ok((await page.evaluate(()=>window.calls)).some(x=>x.name==='ambient_review_action'&&x.args.p_action==='done'));
 assert.ok(!(await page.evaluate(()=>window.calls)).some(x=>x.name.includes('send_message')||x.name.includes('finish')));
 await page.evaluate(()=>{window.done=false;document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByText('Keep the context from Workshop',{exact:true}).waitFor();
 await page.evaluate(()=>{window.signedOut=true;window.authChanged('SIGNED_OUT',null);});
 assert.equal(await page.locator('.private-context').textContent(),'');assert.deepEqual(errors,[]);
 console.log('PASS: review stays collapsed; safe text; failed dismissal remains usable; Later/Done work; sign-out clears data; no finish/send calls.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
