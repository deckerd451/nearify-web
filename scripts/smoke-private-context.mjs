import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd();
const mock=`export const supabase={rpc:async(name,args)=>{window.calls.push({name,args});if(name==='ambient_context')return {data:{note:window.note,intention:window.intention||'',intention_completed:!!window.completed},error:null};if(window.fail)return {data:null,error:{message:'Unavailable'}};if(name==='ambient_intention_complete'){window.completed=true;return {data:{note:window.note,intention:window.intention,intention_completed:true},error:null};}window.note=args.p_note.trim();window.intention=args.p_intention||'';return {data:{note:window.note,intention:window.intention||'',intention_completed:!!window.completed},error:null};}};`;
const html=`<!doctype html><html><body><main id="root"></main><script type="module">
window.note='<img src=x onerror="window.injected=true"> Private project';window.calls=[];window.fail=false;
const {appendPrivateContext}=await import('/assets/js/privateContext.js');
appendPrivateContext(document.getElementById('root'),'11111111-1111-4111-8111-111111111111',()=>true);
window.compose=()=>{document.getElementById('root').replaceChildren();appendPrivateContext(document.getElementById('root'),'11111111-1111-4111-8111-111111111111',()=>true,{useOpener:text=>window.draft=text});};
</script></body></html>`;
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
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByText('Your private conversation note',{exact:true}).click();
 await page.getByRole('textbox',{name:'Private conversation note',exact:true}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'Private conversation note',exact:true}).inputValue(),'<img src=x onerror="window.injected=true"> Private project');
 assert.equal(await page.evaluate(()=>window.injected),undefined);
 await page.getByRole('textbox',{name:'Private conversation note',exact:true}).fill('Discussed community tools');
 await page.evaluate(()=>window.fail=true);
 await page.getByRole('button',{name:'Save private note'}).click();
 await page.getByRole('status').filter({hasText:'Couldn’t save'}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'Private conversation note',exact:true}).inputValue(),'Discussed community tools');
 await page.evaluate(()=>window.fail=false);
 await page.getByRole('button',{name:'Save private note'}).click();
 await page.getByRole('status').filter({hasText:'Saved privately.'}).waitFor();
 await page.getByRole('textbox',{name:'Private follow-up intention',exact:true}).fill('Send the demo');
 await page.getByRole('button',{name:'Save private note'}).click();
 await page.getByRole('status').filter({hasText:'Saved privately.'}).waitFor();
 assert.equal(await page.evaluate(()=>window.intention),'Send the demo');
 await page.getByRole('button',{name:'Mark intention done'}).click();
 await page.getByRole('status').filter({hasText:'Intention completed.'}).waitFor();
 assert.equal(await page.evaluate(()=>window.completed),true);
 await page.evaluate(()=>window.compose());
 await page.getByText('Your private conversation note',{exact:true}).click();
 await page.getByRole('button',{name:'Use an editable opener'}).click();
 const draft=await page.evaluate(()=>window.draft);
 assert.ok(draft.includes('follow up'));assert.ok(!draft.includes('community tools'));
 assert.ok(!(await page.evaluate(()=>window.calls)).some(call=>call.name.includes('send_message')));
 assert.deepEqual(errors,[]);
 console.log('PASS: private note text is safe; failed saves retain draft; retry succeeds; intention saves/completes; opener excludes private context and never sends.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
