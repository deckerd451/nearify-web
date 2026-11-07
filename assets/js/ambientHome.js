import {supabase,getSessionCached} from './supabaseClient.js';
import {followUpRpc} from './followUpService.js?v=20261106-permissions2';
import {chooseAmbientHome} from './ambientHomePolicy.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
export function mountAmbientHome(){
 const root=document.getElementById('ambientHome');if(!root)return {setEvents(){}};
 let epoch=0,active=true,busy=false,actor=null,profile=null,snapshot=null,events=[],pendingEvents=null;
 const link=(text,href)=>{const a=el('a',text);a.href=href;a.className='btn primary';return a;};
 const profileHref=id=>'/profile.html?id='+encodeURIComponent(id)+'&from=connections';
 function render(){
  if(!active||!snapshot)return;
  root.replaceChildren();root.hidden=false;
  const event=events.filter(x=>x?.starts_at&&(Date.parse(x.ends_at)||Date.parse(x.starts_at)+3*3600000)>Date.now()).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at))[0];
  const action=chooseAmbientHome({...snapshot,event,now:Date.now()});
  const card=el('section');card.className='private-context';root.append(card);
  const person=action.person;
  const name=snapshot.people?.find(x=>x.profile_id===person?.profile_id)?.name||person?.name||'Saved person';
  if(action.kind==='unread'){card.append(el('h1','A conversation to continue'),el('p',name),link('Read message','/messages/?conversation='+encodeURIComponent(person.id)));}
  else if(action.kind==='invitation'||action.kind==='details'){
   card.append(el('h1',action.kind==='invitation'?'An invitation to review':'A contact request to review'),el('p',name),link(action.kind==='invitation'?'Review invitation':'Choose what to share',profileHref(person.profile_id)));
  }else if(action.kind==='review'){
   const r=action.review;card.append(el('h1','Keep the context from '+r.event_name),el('p',r.count===1?'You saved 1 person. Add a detail if useful.':'You saved '+r.count+' people. Add a detail if useful.'),link('Review saved people','/connections/?review=1'));
  }else if(action.kind==='context'){
   card.append(el('h1','Pick up where you left off'),el('h2',name),el('p','Your private context'));
   if(person.intention)card.append(el('p','Next time: '+person.intention));if(person.note)card.append(el('p',person.note));
   if(person.can_message){
    const button=el('button','Continue conversation');button.type='button';button.className='btn primary';
    button.onclick=async()=>{
     if(busy)return;busy=true;button.disabled=true;const version=epoch;
     try{const id=await followUpRpc(supabase,'web_open_conversation',{p_other:person.profile_id});if(active&&version===epoch)location.assign('/messages/?conversation='+encodeURIComponent(id));}
     catch{if(active&&version===epoch)card.append(el('p','Couldn’t open the conversation. Review their profile or try again.'));}
     finally{busy=false;button.disabled=false;}
    };card.append(button);
   }else card.append(link('Review connection',profileHref(person.profile_id)));
  }else if(action.kind==='event'){
   card.append(el('h1','Your next event'),el('h2',event.name||'Event'),el('p',new Date(event.starts_at).toLocaleString()),link('Prepare for event','/events/event.html?id='+encodeURIComponent(event.id)));
  }else if(action.kind==='idle'){card.append(el('p','Nothing needs your attention right now.'));}
  else{
   card.append(el('h1','We couldn’t check all your activity.'),el('p','Your saved people and messages are still available.'));
   const retry=el('button','Try again');retry.type='button';retry.className='btn secondary';retry.onclick=()=>refresh();card.append(retry);
  }
 }
 async function refresh(){
  if(!active||document.hidden||busy)return;busy=true;const version=epoch;
  try{
   const {data}=await getSessionCached();if(!active||version!==epoch)return;
   const owner=data?.session?.user?.id;if(!owner){root.hidden=true;root.replaceChildren();snapshot=null;return;}
   if(actor!==owner){actor=owner;events=[];snapshot=null;root.hidden=false;root.replaceChildren(el('p','Checking your next step…'));}
   const results=await Promise.allSettled([followUpRpc(supabase,'web_inbox'),followUpRpc(supabase,'ambient_contexts'),followUpRpc(supabase,'ambient_home_extras'),followUpRpc(supabase,'get_saved_people'),followUpRpc(supabase,'current_profile_id')]);
   if(!active||version!==epoch)return;
   const value=i=>results[i].status==='fulfilled'?results[i].value:null;
   profile=value(4);if(pendingEvents?.owner===profile)events=pendingEvents.rows;
   snapshot={inbox:value(0),contexts:value(1),extras:value(2),people:value(3),ready:results.every(x=>x.status==='fulfilled')};render();
  }catch{if(active&&version===epoch){snapshot={ready:false};render();}}
  finally{busy=false;}
 }
 const clear=()=>{epoch++;root.hidden=true;root.replaceChildren();snapshot=null;events=[];pendingEvents=null;profile=null;actor=null;};
 const auth=supabase.auth.onAuthStateChange((event,session)=>{
  if(event==='SIGNED_OUT'||(actor&&session?.user?.id!==actor)){clear();}
  if(session?.user)setTimeout(refresh,0);
 });
 const visibility=()=>{if(document.hidden)clear();else refresh();};document.addEventListener('visibilitychange',visibility);
 const timer=setInterval(refresh,30000);refresh();
 window.addEventListener('pagehide',()=>{active=false;clear();clearInterval(timer);auth.data.subscription.unsubscribe();document.removeEventListener('visibilitychange',visibility);},{once:true});
 return {setEvents(rows,ownerProfile){
  pendingEvents={owner:ownerProfile,rows:rows.map(x=>x.event||x)};
  if(ownerProfile===profile){events=pendingEvents.rows;render();}
 }};
}
