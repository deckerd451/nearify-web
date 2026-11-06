import {appendContactSharing} from './contactSharing.js?v=20261106-permissions2';
import {supabase} from './supabaseClient.js';
import {followUpRpc,safeContactLinks,downloadContact,FOLLOW_UP_COPY} from './followUpService.js?v=20261106-permissions2';
function el(tag,text,className){const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;}
export function mountProfileFollowUp(profileId,userId) {
  const root=document.getElementById('profileFollowUp');
  if(!root)return;
  if(!userId){
    root.hidden=false;
    const signIn=el('button','Sign in with Google','btn primary');signIn.type='button';
    const status=el('p');status.setAttribute('role','status');
    signIn.onclick=async()=>{
      signIn.disabled=true;
      try{const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.href}});if(error)throw error;}
      catch{status.textContent='Sign-in could not start. Please try again.';signIn.disabled=false;}
    };
    root.replaceChildren(el('h2','Follow up'),el('p','Sign in to connect and message on the web. No iPhone app required.'),signIn,status);
    return;
  }
  let busy=false,active=true,version=0;
  let refreshPending=false;
  const status=el('p','','followup-status');status.setAttribute('role','status');
  async function action(name,args){
    if(busy||!active)return;busy=true;version++;
    root.querySelectorAll('button').forEach(button=>button.disabled=true);
    try {
      const result=await followUpRpc(supabase,name,args);
      if(!active)return;
      if(name==='web_open_conversation') window.location.assign('/messages/?conversation='+encodeURIComponent(result));
      else render(result);
    }catch {status.textContent='Could not complete that action. Please try again.';}
    finally {busy=false;root.querySelectorAll('button').forEach(button=>button.disabled=false);}
  }
  function button(label,fn,primary=false){const b=el('button',label,'btn '+(primary?'primary':'secondary'));b.type='button';b.onclick=fn;return b;}
  function render(state){
    if(!active)return;
    if(!state||state.status==='self'){root.hidden=true;return;}
    root.hidden=false;root.replaceChildren(el('h2','Follow up'),el('p',FOLLOW_UP_COPY[state.status]||FOLLOW_UP_COPY.none));
    const actions=el('div',null,'followup-actions');
    if(state.can_message) actions.append(button(state.conversation_id?'Message':'Say hello',()=>action('web_open_conversation',{p_other:profileId}),true));
    if(state.status==='none') actions.append(button('Connect on Nearify',()=>action('web_contact_action',{p_other:profileId,p_action:'request'}),true));
    if(state.status==='incoming'){
      actions.append(button('Accept connection',()=>action('web_contact_action',{p_other:profileId,p_action:'approve'}),true));
      actions.append(button('Ignore',()=>action('web_contact_action',{p_other:profileId,p_action:'ignore'})));
    }
    if(!state.can_message&&Object.keys(state.shared_by_you||{}).some(key=>['email','phone','linkedin','website'].includes(key)))actions.append(button('Stop sharing my details',()=>action('contact_details_action',{p_other:profileId,p_action:'revoke',p_fields:[]})));
    if(state.blocked_by_you)actions.append(button('Unblock contact',()=>action('web_contact_action',{p_other:profileId,p_action:'unblock'})));
    if(state.status==='pending') actions.append(el('span','Request pending','followup-pending'));
    if(state.conversation_id&&!state.can_message){const a=el('a','View conversation','btn secondary');a.href='/messages/?conversation='+encodeURIComponent(state.conversation_id);actions.append(a);}
    const inbox=el('a','Messages','followup-inbox-link');inbox.href='/messages/';actions.append(inbox);root.append(actions);
    if(state.contact){
      const links=safeContactLinks(state.contact);const contactActions=el('div',null,'followup-actions');
      for(const link of links){const a=el('a',link.label,'btn secondary');a.href=link.href;if(['website','linkedin'].includes(link.kind)){a.target='_blank';a.rel='noopener noreferrer';}contactActions.append(a);}
      if(links.length)contactActions.append(button('Download contact',async()=>{
        if(busy||!active)return;busy=true;
        try{const latest=await followUpRpc(supabase,'web_followup_state',{p_other:profileId});if(!active)return;
          if(latest.can_message&&latest.contact&&safeContactLinks(latest.contact).length)downloadContact(latest.contact);
          else{render(latest);status.textContent='These contact details are no longer shared with you.';}
        }catch{status.textContent='Could not verify contact access. Please try again.';}finally{busy=false;}
      }));
      else root.append(el('p','This person hasn’t shared an email, phone number, or profile link. You can still message them here.'));
      root.append(contactActions);
    }
    appendContactSharing(root,state,profileId,render);
    status.textContent='';root.append(status);
  }
  async function refresh(){
    if(!active||busy||refreshPending||root.querySelector('[data-contact-editing]')||document.hidden)return;refreshPending=true;
    const requestVersion=version;
    try {const state=await followUpRpc(supabase,'web_followup_state',{p_other:profileId});if(active&&version===requestVersion)render(state);}
    catch {if(active&&!root.children.length){root.hidden=false;root.append(el('h2','Follow up'),el('p','Follow-up is temporarily unavailable.'),button('Try again',refresh));}}
    finally {refreshPending=false;}
  }
  refresh();
  const timer=setInterval(refresh,15000);
  document.addEventListener('visibilitychange',refresh);
  const authListener=supabase.auth.onAuthStateChange((event,session)=>{
    if(!active)return;
    const switched=session?.user&&session.user.id!==userId;
    if(event==='SIGNED_OUT'||switched){
      active=false;version++;root.replaceChildren();root.hidden=true;clearInterval(timer);
      if(switched)location.reload();else mountProfileFollowUp(profileId,null);
    }
  });
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  window.addEventListener('pagehide',()=>{active=false;root.replaceChildren();root.hidden=true;authListener.data.subscription.unsubscribe();clearInterval(timer);document.removeEventListener('visibilitychange',refresh);},{once:true});
}
