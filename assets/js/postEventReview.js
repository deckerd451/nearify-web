import {supabase,getSessionCached} from './supabaseClient.js';
import {followUpRpc} from './followUpService.js?v=20261106-permissions2';
const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
export function mountPostEventReview(){
 const parent=document.querySelector('.connections-page');if(!parent)return;
 const root=el('section');root.className='private-context';root.hidden=true;const header=parent.querySelector('.connections-page-header');if(header)header.after(root);else parent.prepend(root);
 let active=true,busy=false,epoch=0,expanded=new URLSearchParams(location.search).get('review')==='1',reviewId=null;
 const valid=version=>active&&epoch===version;
 async function refresh(){
  if(!active||busy||document.hidden)return;busy=true;const version=epoch;
  try{
   const {data}=await getSessionCached();if(!valid(version))return;
   if(!data?.session?.user){root.hidden=true;root.replaceChildren();return;}
   const extras=await followUpRpc(supabase,'ambient_home_extras');if(!valid(version))return;
   const review=extras?.review;root.replaceChildren();root.hidden=!review;
   if(!review)return;
   if(reviewId!==review.event_id){if(reviewId!==null)expanded=false;reviewId=review.event_id;}
   root.append(el('h2','Keep the context from '+review.event_name),el('p',review.count+' saved people linked to this event. Notes are optional; QR saves do not confirm attendance.'));
   const list=el('ul');list.hidden=!expanded;
   for(const person of review.people){
    const item=el('li');const a=el('a',person.name||'Nearify member');a.href='/profile.html?id='+encodeURIComponent(person.profile_id)+'&from=connections#profileFollowUp';item.append(a,el('span',person.has_context?' — review private context':' — add a private note if useful'));list.append(item);
   }
   const open=el('button',expanded?'Hide people':'Review saved people');open.type='button';open.className='btn secondary';
   open.onclick=()=>{expanded=!expanded;list.hidden=!expanded;open.textContent=expanded?'Hide people':'Review saved people';open.setAttribute('aria-expanded',String(expanded));};open.setAttribute('aria-expanded',String(expanded));root.append(open,list);
   const status=el('p');status.setAttribute('role','status');
   for(const [action,label] of [['later','Later — hide for a day'],['done','Done reviewing']]){
    const button=el('button',label);button.type='button';button.className='btn secondary';
    button.onclick=async()=>{
     if(busy||!valid(version))return;busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);
     try{await followUpRpc(supabase,'ambient_review_action',{p_event:review.event_id,p_action:action});if(valid(version)){root.hidden=true;root.replaceChildren();}}
     catch{if(valid(version))status.textContent='Couldn’t save that preference. Please try again.';}
     finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}
    };root.append(button);
   }root.append(status);
  }catch{if(valid(version)){root.hidden=true;root.replaceChildren();}}
  finally{busy=false;}
 }
 refresh();const timer=setInterval(refresh,30000);
 const visibility=()=>{epoch++;root.hidden=true;root.replaceChildren();if(!document.hidden)refresh();};document.addEventListener('visibilitychange',visibility);
 const auth=supabase.auth.onAuthStateChange(()=>{epoch++;root.hidden=true;root.replaceChildren();});
 window.addEventListener('pagehide',()=>{active=false;epoch++;root.remove();clearInterval(timer);auth.data.subscription.unsubscribe();document.removeEventListener('visibilitychange',visibility);},{once:true});
}
