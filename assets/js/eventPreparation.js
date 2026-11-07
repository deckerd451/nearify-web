import {supabase,getSessionCached} from './supabaseClient.js';
import {followUpRpc} from './followUpService.js?v=20261106-permissions2';
const el=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
export function mountEventPreparation(eventId){
 const parent=document.getElementById('eventSections');
 if(!parent)return;
 const root=el('section');root.className='private-context';root.hidden=true;parent.prepend(root);
 let active=true,busy=false,epoch=0;
 async function refresh(){
  if(!active||busy||document.hidden)return;busy=true;const version=epoch;
  try{
   const {data}=await getSessionCached();if(!active||version!==epoch)return;
   if(!data?.session?.user){root.hidden=true;root.replaceChildren();return;}
   const reads=await Promise.allSettled([followUpRpc(supabase,'ambient_event_prep',{p_event:eventId}),followUpRpc(supabase,'get_event_preparation_people',{p_event:eventId})]);
   const result=reads[0].status==='fulfilled'?reads[0].value:null;
   const discovery=reads[1].status==='fulfilled'&&Array.isArray(reads[1].value)?reads[1].value:[];
   if(!active||version!==epoch)return;
   root.replaceChildren();root.hidden=!(result?.eligible&&result?.people?.length)&&!discovery.length;
   if(root.hidden)return;
   const known=result?.eligible&&result?.people?.length;
   root.append(el('h2',known?'A little preparation':'People to explore'),el('p',known?'Your private context. Event listings and QR saves do not confirm someone will be there.':'Profiles shared for this event. Plans and attendance can change.'));
   for(const person of (known?result.people:discovery)){
    const article=el('article');article.append(el('h3',person.name||'Nearify member'));
    article.append(el('p',(person.opted_in_listing||!known)?'Opted-in listing for this event':'You saved their QR for this event'));
    if(person.previous_event_name)article.append(el('p','Your earlier QR save: '+person.previous_event_name));
    if(person.intention)article.append(el('p','Next time: '+person.intention));else if(person.note)article.append(el('p',person.note));
    const link=el('a','Review profile');link.className='btn secondary';link.href='/profile.html?id='+encodeURIComponent(person.profile_id)+'&from=connections';article.append(link);root.append(article);
   }
  }catch{if(active&&version===epoch){root.hidden=true;root.replaceChildren();}}
  finally{busy=false;}
 }
 refresh();const timer=setInterval(refresh,30000);
 const visibility=()=>{epoch++;root.hidden=true;root.replaceChildren();if(!document.hidden)refresh();};
 document.addEventListener('visibilitychange',visibility);
 const auth=supabase.auth.onAuthStateChange(()=>{epoch++;root.hidden=true;root.replaceChildren();});
 window.addEventListener('pagehide',()=>{active=false;epoch++;clearInterval(timer);root.remove();auth.data.subscription.unsubscribe();document.removeEventListener('visibilitychange',visibility);},{once:true});
}
