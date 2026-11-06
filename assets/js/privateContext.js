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
      if(!valid())return;loaded=true;render(result.note||'',result.intention||'',!!result.intention_completed,!!result.suggestions_dismissed);
    }catch{if(valid())content.replaceChildren(el('p','Private notes aren’t available right now. Close and reopen to retry.'));}
    finally{busy=false;}
  });
  function render(note,intention,completed,dismissed){
    if(!valid())return;
    delete panel.dataset.contactEditing;
    content.replaceChildren(el('p','Only you can read this. It is never automatically included in messages or shared contact details.'));
    const status=el('p');status.setAttribute('role','status');
    if(useOpener){
      if(note)content.append(el('p',note));
      if(intention)content.append(el('p','Next time: '+intention+(completed?' (completed)':'')));
      const opener=el('button','Use an editable opener');opener.type='button';opener.className='btn secondary';
      opener.onclick=()=>{if(valid())useOpener(AMBIENT_OPENER);};content.append(opener,status);return;
    }
    const label=el('label','What would you like to remember?');
    const input=el('textarea');input.rows=3;input.maxLength=1000;input.value=note;input.setAttribute('aria-label','Private conversation note');label.append(input);
    input.onfocus=()=>{panel.dataset.contactEditing='true';};
    input.oninput=()=>{panel.dataset.contactEditing='true';status.textContent='';};
    const intentionLabel=el('label','Next time we talk… (optional)');
    const intentionInput=el('textarea');intentionInput.rows=2;intentionInput.maxLength=280;intentionInput.value=intention;
    intentionInput.setAttribute('aria-label','Private follow-up intention');intentionLabel.append(intentionInput);
    intentionInput.onfocus=()=>{panel.dataset.contactEditing='true';};
    intentionInput.oninput=()=>{panel.dataset.contactEditing='true';status.textContent='';};
    const save=el('button','Save private note');save.type='button';save.className='btn secondary';
    save.onclick=async()=>{
      if(busy||!valid())return;busy=true;panel.dataset.contactEditing='true';save.disabled=true;
      const submitted=input.value;const submittedIntention=intentionInput.value;
      try{
        const result=await followUpRpc(supabase,'ambient_context_save_v2',{p_other:profileId,p_note:submitted,p_intention:submittedIntention});
        if(!valid())return;
        // Preserve edits made while the save was in flight.
        if(input.value===submitted&&intentionInput.value===submittedIntention){
          render(result.note||'',result.intention||'',!!result.intention_completed,!!result.suggestions_dismissed);
          content.querySelector('[role=status]').textContent=result.note||result.intention?'Saved privately.':'Private context deleted.';
        }else status.textContent='Saved. You have additional unsaved edits.';
      }catch{if(valid())status.textContent='Couldn’t save. Save this person first, then try again. Your text is kept here.';}
      finally{busy=false;if(valid())save.disabled=false;}
    };
    const feedback=el('button',dismissed?'Restore automatic suggestions':'Not relevant — hide automatic suggestions');feedback.type='button';feedback.className='btn secondary';
    feedback.onclick=async()=>{
      if(busy||!valid())return;busy=true;feedback.disabled=true;
      try{await followUpRpc(supabase,'ambient_person_dismiss',{p_other:profileId,p_dismissed:!dismissed});if(valid()){dismissed=!dismissed;feedback.textContent=dismissed?'Restore automatic suggestions':'Not relevant — hide automatic suggestions';status.textContent=dismissed?'Automatic suggestions hidden. Saved profile and messages remain accessible.':'Suggestions restored when relevant.';}}
      catch{if(valid())status.textContent='Couldn’t save that preference. Please try again.';}
      finally{busy=false;if(valid())feedback.disabled=false;}
    };
    content.append(feedback);
    content.append(label,intentionLabel,el('p','Example: Send the demo. Clear both fields and save to delete private context.'),save,status);
    if(intention){
      const done=el('button',completed?'Intention completed':'Mark intention done');done.type='button';done.className='btn secondary';done.disabled=completed;
      done.onclick=async()=>{
        if(busy||!valid())return;
        if(input.value!==note||intentionInput.value!==intention){status.textContent='Save your changes before completing the intention.';return;}
        busy=true;done.disabled=true;save.disabled=true;
        try{await followUpRpc(supabase,'ambient_intention_complete',{p_other:profileId});if(valid())status.textContent='Intention completed.';}
        catch{if(valid()){status.textContent='Couldn’t complete the intention. Please try again.';done.disabled=false;}}
        finally{busy=false;if(valid())save.disabled=false;}
      };content.append(done);
    }
  }
  return panel;
}
