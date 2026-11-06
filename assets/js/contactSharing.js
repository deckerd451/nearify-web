import {supabase} from './supabaseClient.js';
import {followUpRpc,safeContactLinks} from './followUpService.js?v=20261106-permissions2';
const labels={email:'Email',phone:'Phone',linkedin:'LinkedIn',website:'Website'};
function el(tag,text){const n=document.createElement(tag);if(text)n.textContent=text;return n;}
export function appendContactSharing(root,state,other,onUpdate){
 if(state.permission_version!==2||!state.can_message)return;
 const section=el('section');section.className='contact-sharing';section.append(el('h3','Personal contact details'),el('p','Messaging does not share your email or phone. You choose what to share with this person.'));
 const status=el('p');status.setAttribute('role','status');
 const actions=el('div');actions.className='followup-actions';
 let busy=false;
 function button(text,fn){const b=el('button',text);b.type='button';b.className='btn secondary';b.onclick=fn;return b;}
 async function action(type,fields=[]){
  if(busy)return;busy=true;section.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{onUpdate(await followUpRpc(supabase,'contact_details_action',{p_other:other,p_action:type,p_fields:fields}));}
  catch{status.textContent='Could not update contact sharing. Please try again.';}
  finally{busy=false;section.querySelectorAll('button').forEach(b=>b.disabled=false);}
 }
 if(state.detail_request_incoming){section.append(el('p','They requested your contact details. Choose what to share, or ignore the request.'));actions.append(button('Ignore details request',()=>action('ignore')));}
 actions.append(button('Share my contact details',()=>editShare()));
 if(state.detail_request_pending)actions.append(el('span','Details request pending'));
 else actions.append(button('Request contact details',()=>action('request')));
 const shared=Object.keys(labels).filter(key=>state.shared_by_you?.[key]);
 if(shared.length){section.append(el('p','You shared: '+shared.map(key=>labels[key]).join(', ')));actions.append(button('Stop sharing my details',()=>action('revoke')));}
 section.append(actions,status);root.append(section);
 async function editShare(){
  if(section.querySelector('form')||busy)return;busy=true;section.dataset.contactEditing='true';status.textContent='Loading your private contact preferences…';
  try{
   const prefs=await followUpRpc(supabase,'contact_owner_preferences');status.textContent='';
   const form=el('form');form.className='contact-sharing-form';
   const available=safeContactLinks({...prefs,email:prefs.allow_email?prefs.email:null,phone:prefs.allow_phone?prefs.phone:null}).map(link=>link.kind);
   const choices=[];
   form.append(el('p','Share only the details you select below. They are shared with this person only.'));
   for(const key of available){const label=el('label');const input=el('input');input.type='checkbox';input.value=key;input.checked=!!state.shared_by_you?.[key];label.append(input,document.createTextNode(' '+labels[key]+': '+prefs[key]));form.append(label);choices.push(input);}
   if(!choices.length)form.append(el('p','Add your contact details below first. Nothing will be shared automatically.'));
   const submit=el('button','Share selected details');submit.type='submit';submit.className='btn primary';submit.disabled=!choices.length;
   const cancel=button('Cancel',()=>{form.remove();delete section.dataset.contactEditing;});
   form.append(submit,cancel,button('Edit my private contact preferences',()=>{form.remove();editPreferences(prefs);}));
   form.onsubmit=event=>{event.preventDefault();const fields=choices.filter(c=>c.checked).map(c=>c.value);if(!fields.length){status.textContent='Choose at least one detail to share.';return;}action('share',fields);};section.append(form);
  }catch{status.textContent='Could not load your preferences. Please try again.';delete section.dataset.contactEditing;}
  finally{busy=false;}
 }
 function editPreferences(prefs){
  const form=el('form');form.className='contact-sharing-form';form.append(el('h4','My private contact preferences'),el('p','These values stay private until you share selected details with a person. Editing a value never automatically sends the new value.'));
  const inputs={};
  for(const key of Object.keys(labels)){const label=el('label',labels[key]);const input=el('input');input.type=key==='email'?'email':key==='phone'?'tel':'url';input.value=prefs[key]||'';input.maxLength=2000;label.append(input);form.append(label);inputs[key]=input;}
  for(const key of ['email','phone']){const label=el('label');const input=el('input');input.type='checkbox';input.checked=!!prefs['allow_'+key];label.append(input,document.createTextNode(' Make '+labels[key].toLowerCase()+' available for me to share. Turning this off removes future access to previously shared '+labels[key].toLowerCase()+'.'));form.append(label);inputs['allow_'+key]=input;}
  const save=el('button','Save private preferences');save.type='submit';save.className='btn primary';form.append(save,button('Cancel',()=>{form.remove();delete section.dataset.contactEditing;}));
  form.onsubmit=async event=>{
   event.preventDefault();if(busy)return;busy=true;save.disabled=true;
   try{await followUpRpc(supabase,'contact_save_preferences',{p_email:inputs.email.value,p_phone:inputs.phone.value,p_linkedin:inputs.linkedin.value,p_website:inputs.website.value,p_allow_email:inputs.allow_email.checked,p_allow_phone:inputs.allow_phone.checked,p_preferred:prefs.preferred||'nearify'});form.remove();delete section.dataset.contactEditing;busy=false;await editShare();}
   catch{status.textContent='Could not save your preferences. Please try again.';}
   finally{busy=false;save.disabled=false;}
  };
  section.append(form);
 }
}
