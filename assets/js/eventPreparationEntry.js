// Only preparation links focus the plan. Ordinary event links keep the overview.
export function focusEventPreparation(doc=document, hash=window.location.hash) {
 if(hash!=='#prepare')return false;
 const plan=doc.getElementById('eventPlanSection');
 const heading=doc.getElementById('eventPlanHeading');
 if(!plan||!heading||!plan.getClientRects().length)return false;
 plan.classList.add('event-plan--preparing');
 heading.setAttribute('tabindex','-1');
 heading.focus({preventScroll:true});
 plan.scrollIntoView({block:'start',behavior:'instant'});
 return true;
}
