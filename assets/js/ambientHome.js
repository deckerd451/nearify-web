import {supabase,getSessionCached} from './supabaseClient.js';
import {followUpRpc} from './followUpService.js?v=20261106-permissions2';
import {chooseAmbientHome,previewHomeContext} from './ambientHomePolicy.js?v=20261114-value1';
const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
export function mountAmbientHome(){
 const root=document.getElementById('ambientHome');if(!root)return {setEvents(){}};
 let epoch=0,active=true,busy=false,actor=null,profile=null,snapshot=null,events=[],pendingEvents=null;
 const link=(text,href)=>{const a=el('a',text);a.href=href;a.className='btn primary';return a;};
 const profileHref=id=>'/profile.html?id='+encodeURIComponent(id)+'&from=connections';
 function makeCard(kind,eyebrow,title){
  root.replaceChildren();root.hidden=false;root.dataset.homeState=kind;
  const card=el('section');card.className='private-context home-value-card';
  const label=el('p',eyebrow);label.className='home-value-eyebrow';
  card.append(label,el('h1',title));root.append(card);return card;
 }
 function detail(card,text,secondary=false){
  const p=el('p',text);p.className=secondary?'home-value-support':'home-value-detail';card.append(p);
 }
 function actions(card,primary,secondary){
  const group=el('div');group.className='home-value-actions';group.append(primary);
  if(secondary){secondary.className='home-value-secondary';group.append(secondary);}card.append(group);
 }
 function renderLoading(){
  const card=makeCard('loading','Your next step','Pick up with someone you know');
  detail(card,'Open saved people while we check for updates.');
  actions(card,link('Open saved people','/connections/'));
 }
 function render(){
  if(!active||!snapshot)return;
  const event=events.filter(x=>x?.starts_at&&(Date.parse(x.ends_at)||Date.parse(x.starts_at)+3*3600000)>Date.now()).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at))[0];
  const action=chooseAmbientHome({...snapshot,event,now:Date.now()});
  const person=action.person;
  const name=snapshot.people?.find(x=>x.profile_id===person?.profile_id)?.name||person?.name||'this person';
  let card;
  if(action.kind==='unread'){
   card=makeCard('unread','New message','Hear from '+name);
   detail(card,'Continue your conversation in Nearify.');
   actions(card,link('Read message','/messages/?conversation='+encodeURIComponent(person.id)));
  }else if(action.kind==='invitation'||action.kind==='details'){
   const invitation=action.kind==='invitation';
   card=makeCard(action.kind,invitation?'Connection invitation':'Contact sharing request',invitation?'Connect with '+name+'?':'Choose what to share with '+name);
   detail(card,invitation?'Review their invitation before deciding to connect.':'You choose whether to share personal contact details.');
   actions(card,link(invitation?'Review invitation':'Choose what to share',profileHref(person.profile_id)));
  }else if(action.kind==='review'){
   const r=action.review;
   card=makeCard('review','Keep the connection','Remember who you met at '+r.event_name);
   detail(card,r.count===1?'You saved 1 person. Keep one detail for your next conversation.':'You saved '+r.count+' people. Keep one detail for your next conversation.');
   actions(card,link('Review saved people','/connections/?review=1'));
  }else if(action.kind==='context'){
   card=makeCard('context','Your saved reminder','Pick up with '+name);
   // One useful detail first, rather than a stack of private-note paragraphs.
   detail(card,previewHomeContext(person.intention?.trim()||person.note?.trim()));
   detail(card,'From your private context. Review it before you reach out.',true);
   if(person.can_message){
    const button=el('button','Continue conversation');button.type='button';button.className='btn primary';
    button.onclick=async()=>{
     if(busy)return;busy=true;button.disabled=true;const version=epoch;
     try{const id=await followUpRpc(supabase,'web_open_conversation',{p_other:person.profile_id});if(active&&version===epoch)location.assign('/messages/?conversation='+encodeURIComponent(id));}
     catch{if(active&&version===epoch){const error=el('p','Couldn’t open the conversation. Review their profile or try again.');error.setAttribute('role','alert');card.append(error);}}
     finally{busy=false;button.disabled=false;}
    };actions(card,button,link('Review context',profileHref(person.profile_id)));
   }else actions(card,link('Review connection',profileHref(person.profile_id)));
  }else if(action.kind==='event'){
   card=makeCard('event','Your next event','Get ready for '+(event.name||'your event'));
   detail(card,new Date(event.starts_at).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}));
   detail(card,'Choose what would make this event useful before you arrive.',true);
   actions(card,link('Prepare for event','/events/event.html?id='+encodeURIComponent(event.id)+'#prepare'));
  }else if(action.kind==='idle'){
   card=makeCard('idle','Start a conversation','Make your next hello easier');
   detail(card,'Meeting someone? Scan their Nearify QR and save a detail to remember.');
   actions(card,link('Scan someone’s QR','/scan/?web=1'),link('Find an event','/events/index.html'));
  }else{
   card=makeCard('unavailable','Your saved people','Pick up a connection');
   detail(card,'We couldn’t check all your activity. You can still open your saved people.');
   const retry=el('button','Try again');retry.type='button';retry.className='home-value-secondary';retry.onclick=()=>refresh();
   actions(card,link('Open saved people','/connections/'),retry);
  }
 }
 async function refresh(){
  if(!active||document.hidden||busy)return;busy=true;const version=epoch;
  try{
   const {data}=await getSessionCached();if(!active||version!==epoch)return;
   const owner=data?.session?.user?.id;if(!owner){root.hidden=true;root.replaceChildren();snapshot=null;return;}
   if(actor!==owner){actor=owner;events=[];snapshot=null;renderLoading();}
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
