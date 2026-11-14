import {supabase,getSessionCached} from './supabaseClient.js';
import {followUpRpc} from './followUpService.js?v=20261106-permissions2';
import {chooseEventSuggestion} from './eventSuggestionPolicy.js?v=20261114-suggestion1';
import {previewHomeContext} from './ambientHomePolicy.js?v=20261114-value1';
const el=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
export function mountEventPreparation(eventId){
 const parent=document.getElementById('eventPlanPeopleItem')||document.getElementById('eventSections');
 if(!parent)return;
 const root=el('section');root.id='eventSuggestion';root.className='private-context event-suggestion';root.hidden=true;parent.prepend(root);
 let active=true,busy=false,pending=false,epoch=0,expectedOwner;
 const clear=()=>{epoch++;root.hidden=true;root.replaceChildren();};
 function unavailable(){
  root.replaceChildren(el('h3','Suggestions couldn’t load'),el('p','Try again or browse the available opted-in profiles below.'));
  const retry=el('button','Try again');retry.type='button';retry.className='btn primary';retry.onclick=refresh;root.append(retry);root.hidden=false;
 }
 async function refresh(){
  if(!active||document.hidden)return;
  if(busy){pending=true;return;}
  busy=true;const version=epoch;
  try{
   const {data}=await getSessionCached();if(!active||version!==epoch)return;
   const owner=data?.session?.user?.id;
   if(expectedOwner!==undefined&&owner!==expectedOwner)return;
   if(expectedOwner===undefined)expectedOwner=owner||null;
   if(!owner){root.hidden=true;root.replaceChildren();return;}
   if(root.hidden){
    root.replaceChildren(el('h3','Checking for a useful introduction'),el('p','Looking for shared interests and your saved reminders. You can still browse profiles below.'));
    root.hidden=false;
   }
   const selfRead=supabase.from('profiles').select('id,interests,skills').eq('user_id',data.session.user.id).maybeSingle();
   const reads=await Promise.allSettled([
    followUpRpc(supabase,'ambient_event_prep',{p_event:eventId}),
    followUpRpc(supabase,'get_event_connection_people',{p_event:eventId}),selfRead
   ]);
   if(!active||version!==epoch||owner!==expectedOwner)return;
   const contexts=reads[0].status==='fulfilled'&&reads[0].value?.eligible?reads[0].value.people||[]:[];
   const people=reads[1].status==='fulfilled'&&Array.isArray(reads[1].value)?reads[1].value:[];
   const self=reads[2].status==='fulfilled'&&!reads[2].value.error?reads[2].value.data:null;
   const choice=chooseEventSuggestion({people,contexts,self});
   root.replaceChildren();root.hidden=false;
   if(!choice){
    root.append(el('h3',reads[0].status==='rejected'||reads[1].status==='rejected'?'Suggestions couldn’t load':'Explore people at your own pace'));
    root.append(el('p',reads[0].status==='rejected'||reads[1].status==='rejected'?'Try again or browse the available opted-in profiles below.':(people.length?'There isn’t enough shared context to suggest a specific person. Browse the opted-in profiles below.':'No opted-in profiles are available to suggest. You can still meet people and exchange Nearify QR codes.')));
    if(reads[0].status==='rejected'||reads[1].status==='rejected'){
     const retry=el('button','Try again');retry.type='button';retry.className='btn primary';retry.onclick=refresh;root.append(retry);
    }else if(people.length){
     const browse=el('button','Browse opted-in people');browse.type='button';browse.className='btn primary';
     browse.onclick=()=>{const list=document.getElementById('attendeeDiscoverySection');if(list){list.open=true;list.scrollIntoView({block:'start'});list.querySelector('summary')?.focus();}};root.append(browse);
    }else{
     const scan=el('a','Scan someone’s QR');scan.className='btn primary';scan.href='/scan/?web=1';root.append(scan);
    }
    return;
   }
   const eyebrow=el('p',choice.source==='context'?'Your saved conversation reminder':'A conversation to explore');eyebrow.className='event-suggestion-label';
   root.append(eyebrow,el('h3',choice.person.name||'Nearify member'),el('p',previewHomeContext(choice.reason)));
   if(choice.source==='context')root.append(el('p','From your private context. Only you can see this reminder.'));
   root.append(el('p',choice.listed?'Opted-in listing for this event. Plans and attendance can change.':'You saved their QR for this event. This does not confirm attendance.'));
   if(choice.source==='context'&&choice.previousEventName)root.append(el('p','Your earlier QR save: '+choice.previousEventName));
   const link=el('a','Review profile');link.className='btn primary';link.href='/profile.html?id='+encodeURIComponent(choice.person.profile_id)+'&from=connections';root.append(link);
  }catch{if(active&&version===epoch)unavailable();}
  finally{
   busy=false;
   if(pending&&active&&!document.hidden){pending=false;queueMicrotask(refresh);}
  }
 }
 refresh();let timer=setInterval(refresh,30000);
 const visibility=()=>{clear();if(!document.hidden)refresh();};document.addEventListener('visibilitychange',visibility);
 const auth=supabase.auth.onAuthStateChange((event,session)=>{
  const owner=session?.user?.id||null;
  if(event==='SIGNED_OUT'||(expectedOwner!==undefined&&owner!==expectedOwner))clear();
  expectedOwner=owner;
  if(owner)setTimeout(refresh,0);else pending=false;
 });
 window.addEventListener('pagehide',event=>{
  active=false;clear();clearInterval(timer);
  if(!event.persisted){root.remove();auth.data.subscription.unsubscribe();document.removeEventListener('visibilitychange',visibility);}
 });
 window.addEventListener('pageshow',event=>{
  if(event.persisted){active=true;clearInterval(timer);timer=setInterval(refresh,30000);refresh();}
 });
}
