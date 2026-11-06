import {supabase} from './supabaseClient.js';
import {followUpRpc} from './followUpService.js?v=20261106-permissions2';
export const AMBIENT_OPENER='Hi! I wanted to follow up on our conversation. Would you like to pick up where we left off?';
const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
// Owner-only context is never copied into messages, links, analytics or exports.
export function appendPrivateContext(root,profileId,isActive,{useOpener}={}) {
  const panel=el('details');panel.className='private-context';
  panel.append(el('summary','Your private conversation note'));
  const content=el('div');panel.append(content);root.append(panel);
  let loaded=false,busy=false;
  const valid=()=>isActive()&&panel.isConnected;
  panel.addEventListener('toggle',async()=>{
    if(!panel.open||loaded||busy||!valid())return;
    busy=true;content.replaceChildren(el('p','Loading private note…'));
    try{
      const result=await followUpRpc(supabase,'ambient_context',{p_other:profileId});
      if(!valid())return;loaded=true;render(result.note||'');
    }catch{if(valid())content.replaceChildren(el('p','Private notes aren’t available right now. Close and reopen to retry.'));}
    finally{busy=false;}
  });
  function render(note){
    if(!valid())return;
    delete panel.dataset.contactEditing;
    content.replaceChildren(el('p','Only you can read this. It is never automatically included in messages or shared contact details.'));
    const status=el('p');status.setAttribute('role','status');
    if(useOpener){
      if(note)content.append(el('p',note));
      const opener=el('button','Use an editable opener');opener.type='button';opener.className='btn secondary';
      opener.onclick=()=>{if(valid())useOpener(AMBIENT_OPENER);};content.append(opener,status);return;
    }
    const label=el('label','What would you like to remember?');
    const input=el('textarea');input.rows=3;input.maxLength=1000;input.value=note;label.append(input);
    input.onfocus=()=>{panel.dataset.contactEditing='true';};
    input.oninput=()=>{panel.dataset.contactEditing='true';status.textContent='';};
    const save=el('button','Save private note');save.type='button';save.className='btn secondary';
    save.onclick=async()=>{
      if(busy||!valid())return;busy=true;panel.dataset.contactEditing='true';save.disabled=true;
      const submitted=input.value;
      try{
        const result=await followUpRpc(supabase,'ambient_context_save',{p_other:profileId,p_note:submitted});
        if(!valid())return;
        // Preserve edits made while the save was in flight.
        if(input.value===submitted){input.value=result.note||'';delete panel.dataset.contactEditing;}
        status.textContent=result.note?'Saved privately.':'Note deleted.';
      }catch{if(valid())status.textContent='Couldn’t save. Save this person first, then try again. Your text is kept here.';}
      finally{busy=false;if(valid())save.disabled=false;}
    };
    content.append(label,el('p','Clear the note and save to delete it.'),save,status);
  }
  return panel;
}
