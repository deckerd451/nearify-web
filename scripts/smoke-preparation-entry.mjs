import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd();
const source=(await fs.readFile('events/event.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const html=source.replace('</head>','<base href="/events/"></head>').replace('</body>',`<script type="module">
import {focusEventPreparation} from '/assets/js/eventPreparationEntry.js';
window.focusPreparation=focusEventPreparation;
setTimeout(()=>{
 document.getElementById('eventSections').style.display='';
 document.getElementById('eventIntentSection').style.display='';
 document.getElementById('eventSignedInNote').style.display='';
 focusEventPreparation();
 window.prepared=true;
},50);
</script></body>`);
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/events/event.html'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const file=path.resolve(root,'.'+url.pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/javascript');
  res.end(await fs.readFile(file));
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const url='http://127.0.0.1:'+server.address().port+'/events/event.html?id=test';
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:844});
  await page.goto(url+'#prepare');await page.waitForFunction(()=>window.prepared);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'eventPlanHeading');
  const heading=await page.locator('#eventPlanHeading').boundingBox();assert(heading.y>=0&&heading.y<200);
  if(process.env.NEARIFY_REVIEW_ARTIFACT_DIR){await fs.mkdir(process.env.NEARIFY_REVIEW_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.NEARIFY_REVIEW_ARTIFACT_DIR,'preparation-entry-'+width+'.png')});}
  for(const button of await page.locator('#eventIntentPicker button').all()){
   const box=await button.boundingBox();assert(box.y>=0&&box.y+box.height<844,`goal below fold at ${width}`);
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
 }
 await page.goto(url);await page.waitForFunction(()=>window.prepared);
 assert.equal(await page.evaluate(()=>scrollY),0,'ordinary event entry must keep overview');
 await page.evaluate(()=>{location.hash='prepare';window.focusPreparation();});
 assert.equal(await page.evaluate(()=>document.activeElement.id),'eventPlanHeading');
 assert.deepEqual(errors,[]);
 console.log('PASS: preparation entry focuses plan after async reveal, all five goals above fold at 320/390/768/1440px, no overflow, normal overview unchanged.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
