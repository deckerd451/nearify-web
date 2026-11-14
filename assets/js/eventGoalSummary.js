import {INTENT_LABELS} from './constants/intents.js?v=20261114-prepare1';
export function showEventGoalSummary(intent,{saved=false,doc=document}={}){
 if(!INTENT_LABELS[intent])return false;
 const display=doc.getElementById('eventIntentDisplay');
 const picker=doc.getElementById('eventIntentPicker');
 const value=doc.getElementById('eventIntentDisplayValue');
 if(!display||!picker||!value)return false;
 value.textContent=INTENT_LABELS[intent];
 display.style.display='';picker.style.display='none';
 const badge=display.querySelector('.intent-display-badge');
 if(badge)badge.textContent=saved?'Saved for this event':'Selected in this browser';
 const helper=doc.getElementById('eventSignedInNote');if(helper)helper.style.display='none';
 doc.getElementById('eventIntentChangeBtn')?.setAttribute('aria-expanded','false');
 return true;
}
export function toggleEventGoalPicker(doc=document){
 const picker=doc.getElementById('eventIntentPicker');
 const button=doc.getElementById('eventIntentChangeBtn');
 if(!picker||!button)return;
 const showing=picker.style.display!=='none';
 picker.style.display=showing?'none':'';
 button.setAttribute('aria-expanded',String(!showing));
 if(!showing)picker.querySelector('[aria-pressed="true"]')?.focus();
}
