import {supabase,getSessionCached} from './supabaseClient.js';
import {followUpRpc} from './followUpService.js?v=20261106-permissions2';
import {chooseEventSuggestion} from './eventSuggestionPolicy.js?v=20261114-suggestion1';
import {previewHomeContext} from './ambientHomePolicy.js?v=20261114-value1';
const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
// Only identifiers travel in the link. Never trust a URL-supplied reason/note.
export function mountProfileEventContext(profileId,userId,{eventId,eventName}={}){
 const root=document.getElementById('profileEventContext');
 if(!root||!eventId||!userId)return;
 let active=true,busy=false,pending=false,epoch=0;
 const clear=()=>{epoch++;root.replaceChildren();root.hidden=true;};
 function header(){root.replaceChildren(el('h2',eventName?'From '+eventName:'From your event preparation'));root.hidden=false;}
 async function refresh(){
  if(!active||document.hidden)return;if(busy){pending=true;return;}busy=true;const version=epoch;
  try{
   const {data}=await getSessionCached();if(!active||version!==epoch||data?.session?.user?.id!==userId)return;
   const reads=await Promise.allSettled([
    followUpRpc(supabase,'ambient_event_prep',{p_event:eventId}),
    followUpRpc(supabase,'get_event_connection_people',{p_event:eventId}),
    supabase.from('profiles').select('id,interests,skills').eq('user_id',userId).maybeSingle()
   ]);
   if(!active||version!==epoch)return;
   const contexts=reads[0].status==='fulfilled'&&reads[0].value?.eligible&&Array.isArray(reads[0].value.people)?reads[0].value.people.filter(p=>p.profile_id===profileId):[];
   const people=reads[1].status==='fulfilled'&&Array.isArray(reads[1].value)?reads[1].value.filter(p=>p.profile_id===profileId):[];
   const self=reads[2].status==='fulfilled'&&!reads[2].value?.error?reads[2].value?.data:null;
   const suggestion=chooseEventSuggestion({people,contexts,self});header();
   if(suggestion){
    root.append(el('p',previewHomeContext(suggestion.reason)));
    const source=el('p',suggestion.source==='context'?'Your private reminder. Only you can see it.':'Based on the profile details you both list.');source.className='profile-event-source';root.append(source);
   }else root.append(el('p','The earlier suggestion’s reason is no longer available to verify. You can still review this profile.'));
   const back=el('a','Back to event preparation');back.href='/events/event.html?id='+encodeURIComponent(eventId)+'#prepare';root.append(back);
  }catch{if(active&&version===epoch){header();root.append(el('p','We couldn’t refresh the event context.'));
   const retry=el('button','Try again');retry.type='button';retry.className='btn secondary';retry.onclick=refresh;root.append(retry);}}
  finally{busy=false;if(pending&&active&&!document.hidden){pending=false;queueMicrotask(refresh);}}
 }
 const visibility=()=>{clear();if(!document.hidden)refresh();};document.addEventListener('visibilitychange',visibility);
 const auth=supabase.auth.onAuthStateChange((event,session)=>{
  if(event==='SIGNED_OUT'||(session?.user&&session.user.id!==userId)){active=false;clear();}
 });
 const timer=setInterval(refresh,30000);refresh();
 window.addEventListener('pagehide',()=>{active=false;clear();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);auth.data.subscription.unsubscribe();},{once:true});
 window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
}
