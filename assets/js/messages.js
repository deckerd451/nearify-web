import {appendPrivateContext} from './privateContext.js?v=20261106-ambient1';
import {supabase} from './supabaseClient.js';
import {getCurrentUser} from './appState.js';
import {followUpRpc} from './followUpService.js?v=20261106-permissions2';
const $=id=>document.getElementById(id);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rawConversation=new URLSearchParams(location.search).get('conversation');
const conversation=uuid.test(rawConversation||'')?rawConversation:null;
let identity=null,active=true,refreshing=false,sending=false,paging=false,timer=null;
let currentThread=null,rows=new Map(),pendingSend=null,hasOlder=false,lastRead=null;
let threadSignature='',inboxSnapshot=null;
const rpc=(name,args)=>followUpRpc(supabase,name,args);
function node(tag,text,className){const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;}
function button(text,fn){const n=node('button',text,'btn secondary');n.type='button';n.onclick=fn;return n;}
function status(text){$('messagesStatus').textContent=text;}
function orderedRows(){return [...rows.values()].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)||a.id.localeCompare(b.id));}
function nearBottom(){const list=$('messageList');return list.scrollHeight-list.scrollTop-list.clientHeight<50;}
async function markRead(){
  if(!active||document.hidden||!currentThread||!nearBottom())return;
  const latest=orderedRows().at(-1);
  if(!latest||lastRead===latest.id)return;
  try {
    await rpc('web_mark_read',{p_conversation:conversation,p_message:latest.id});
    if(!active)return;
    lastRead=latest.id;
    if(inboxSnapshot){inboxSnapshot.threads.forEach(thread=>{if(thread.id===conversation)thread.unread=false;});renderInbox(inboxSnapshot);}
  }
  catch { /* Unread state remains until the next successful visible refresh. */ }
}
function renderMessages(scrollToBottom=false,prepend=false){
  const list=$('messageList');
  const oldHeight=list.scrollHeight,oldTop=list.scrollTop;
  const fragment=document.createDocumentFragment();
  const messages=orderedRows();
  if(!messages.length)fragment.append(node('li','Say hello and pick up where you left off.','message-empty'));
  for(const message of messages){
    const item=node('li',null,'message-bubble'+(message.sender_profile_id===currentThread.my_profile_id?' mine':''));
    item.append(node('span',message.content));
    const date=new Date(message.created_at);
    const time=node('time',date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}));time.dateTime=message.created_at;item.append(time);fragment.append(item);
  }
  list.replaceChildren(fragment);
  if(scrollToBottom)list.scrollTop=list.scrollHeight;
  else list.scrollTop=oldTop+(prepend?Math.max(0,list.scrollHeight-oldHeight):0);
  $('loadOlder').hidden=!hasOlder;
}
async function loadThread(){
  const data=await rpc('web_thread',{p_conversation:conversation});
  if(!active)return;
  if(!Array.isArray(data?.messages))throw new Error('Unavailable');
  const atBottom=!currentThread||nearBottom();
  const signature=JSON.stringify(data.messages);
  const firstLoad=!currentThread;
  currentThread=data;
  $('threadPanel').hidden=false;$('threadPlaceholder').hidden=true;
  $('threadName').textContent=data.name||'Nearify member';
  $('threadProfile').href='/profile.html?id='+encodeURIComponent(data.profile_id)+'&from=connections';
  $('blockContact').textContent=data.blocked_by_you?'Unblock contact':'Block contact';
  $('messageComposer').hidden=!data.can_message;$('threadGate').hidden=!!data.can_message;
  const previousContext=$('threadPrivateContext');
  if(!data.can_message)previousContext?.remove();
  else if(!previousContext){
    const context=node('div');context.id='threadPrivateContext';
    $('messageComposer').before(context);
    appendPrivateContext(context,data.profile_id,()=>active&&!!currentThread?.can_message,{
      useOpener:text=>{
        if(!$('messageText').value.trim()){$('messageText').value=text;$('messageText').focus();}
      }
    });
  }
  if(firstLoad)hasOlder=data.messages.length===50;
  for(const row of data.messages)rows.set(row.id,row);
  if(signature!==threadSignature||firstLoad){threadSignature=signature;renderMessages(atBottom);}
  await markRead();
}
function renderInbox(data){
  inboxSnapshot=data;
  const requests=$('requestList');requests.replaceChildren();
  for(const request of data.requests||[]){
    const item=node('li');const link=node('a',request.name||'Nearify member');link.href='/profile.html?id='+encodeURIComponent(request.profile_id)+'&from=connections';
    item.append(link);
    const actions=node('div',null,'followup-actions');
    for(const action of ['approve','ignore'])actions.append(button(action==='approve'?'Approve':'Ignore',async()=>{
      actions.querySelectorAll('button').forEach(b=>b.disabled=true);
      try {await rpc('web_contact_action',{p_other:request.profile_id,p_action:action});await refresh();}
      catch {status('Could not update that request. Please try again.');}
      finally {actions.querySelectorAll('button').forEach(b=>b.disabled=false);}
    }));
    item.append(actions);requests.append(item);
  }
  if(!requests.children.length)requests.append(node('li','No pending requests.','muted'));
  const detailRequests=$('detailRequestList');detailRequests.replaceChildren();
  for(const request of data.detail_requests||[]){
    const item=node('li',(request.name||'Nearify member')+' requested your contact details.');
    const link=node('a','Choose what to share');link.href='/profile.html?id='+encodeURIComponent(request.profile_id)+'&from=connections';item.append(document.createElement('br'),link);detailRequests.append(item);
  }
  if(!detailRequests.children.length)detailRequests.append(node('li','No contact detail requests.','muted'));
  const list=$('threadList');list.replaceChildren();
  for(const thread of data.threads||[]){
    const item=node('li');const link=node('a',null,'thread-link');link.href='./?conversation='+encodeURIComponent(thread.id);
    if(thread.id===conversation)link.setAttribute('aria-current','page');
    link.append(node('strong',thread.name||'Nearify member'));
    if(thread.unread)link.append(node('span','Unread','thread-unread'));
    link.append(node('span',thread.preview||'Start a conversation','thread-preview'));item.append(link);list.append(item);
  }
  if(!list.children.length)list.append(node('li','No conversations yet. Open a saved person to connect on Nearify.','muted'));
  document.dispatchEvent(new CustomEvent('nearify:inbox',{detail:data}));
}
async function refresh(){
  if(!active||refreshing||document.hidden||sending||paging)return;refreshing=true;
  try {
    const data=await rpc('web_inbox');
    if(!active)return;
    if(!data||!Array.isArray(data.threads))throw new Error('Unavailable');
    renderInbox(data);$('messagesContent').hidden=false;$('messagesRetry').hidden=true;
    if(conversation)await loadThread();
    else if(rawConversation)throw new Error('Invalid conversation');
    status('');
  }catch {if(active){status(conversation?'Could not refresh this conversation. Please try again.':'Could not load messages. Please try again.');$('messagesRetry').hidden=false;}}
  finally{refreshing=false;}
}
$('messagesRetry').onclick=refresh;
$('messagesSignIn').onclick=async()=>{
  $('messagesSignIn').disabled=true;
  try{const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.href}});if(error)throw error;}
  catch {status('Sign-in could not start. Please try again.');$('messagesSignIn').disabled=false;}
};
$('messageComposer').onsubmit=async event=>{
  event.preventDefault();if(sending||!active||!currentThread?.can_message)return;
  const text=$('messageText').value.trim();if(!text)return;
  if([...text].length>4000){$('threadStatus').textContent='Please keep your message under 4,000 characters.';return;}
  if(!pendingSend||pendingSend.text!==text)pendingSend={id:crypto.randomUUID(),text};
  sending=true;$('sendMessage').disabled=true;$('threadStatus').textContent='Sending…';
  try {
    const message=await rpc('web_send_message',{p_conversation:conversation,p_content:text,p_message_id:pendingSend.id});
    if(!active)return;
    rows.set(message.id,message);pendingSend=null;
    if($('messageText').value.trim()===text)$('messageText').value='';
    renderMessages(true);$('threadStatus').textContent='Message sent.';await markRead();
  }catch {if(active)$('threadStatus').textContent='Message wasn’t sent. Your draft is kept here; try again.';}
  finally{sending=false;$('sendMessage').disabled=false;}
  await refresh();
};
$('loadOlder').onclick=async()=>{
  if(paging||!currentThread||!active)return;paging=true;$('loadOlder').disabled=true;
  const earliest=orderedRows()[0];
  try{
    const data=await rpc('web_thread',{p_conversation:conversation,p_before:earliest.created_at,p_before_id:earliest.id});
    if(!active)return;
    hasOlder=data.messages.length===50;for(const row of data.messages)rows.set(row.id,row);renderMessages(false,true);
  }catch{$('threadStatus').textContent='Could not load earlier messages. Please try again.';}
  finally{paging=false;$('loadOlder').disabled=false;}
};
$('blockContact').onclick=async()=>{
  if(!currentThread||!active)return;
  const action=currentThread.blocked_by_you?'unblock':'block';
  if(!window.confirm(action==='block'?'Block this contact? This prevents new messages and contact exchange.':'Unblock this contact? Contact exchange may still be required before messaging.'))return;
  $('blockContact').disabled=true;
  try{await rpc('web_contact_action',{p_other:currentThread.profile_id,p_action:action});await refresh();}
  catch{$('threadStatus').textContent='Could not update this contact. Please try again.';}
  finally{$('blockContact').disabled=false;}
};
$('messageList').addEventListener('scroll',markRead);
document.addEventListener('visibilitychange',refresh);
window.addEventListener('focus',refresh);
window.addEventListener('pagehide',()=>{active=false;clearInterval(timer);rows.clear();$('threadPrivateContext')?.remove();$('messagesContent').hidden=true;$('messageList').replaceChildren();$('messageText').value='';},{once:true});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
supabase.auth.onAuthStateChange((event,session)=>{
 const switched=identity&&session?.user&&session.user.id!==identity;
 if(event==='SIGNED_OUT'||switched){
  active=false;clearInterval(timer);rows.clear();$('threadPrivateContext')?.remove();$('messageList').replaceChildren();$('threadList').replaceChildren();$('requestList').replaceChildren();$('detailRequestList').replaceChildren();$('messageText').value='';
  $('messagesContent').hidden=true;$('messagesAuth').hidden=false;status('Sign in to view your messages.');
  if(switched)location.reload();
 }
});
async function init(){
 try{
  const user=await getCurrentUser();
  if(!active)return;
  if(!user){$('messagesAuth').hidden=false;status('');return;}
  identity=user.id;
  await refresh();timer=setInterval(refresh,10000);
 }catch{status('Could not load your session. Please refresh the page.');}
}
init();
