const text=value=>typeof value==='string'?value.trim():'';
const terms=values=>Array.isArray(values)?values.map(text).filter(Boolean):[];
const common=(mine,theirs)=>{
 const known=new Set(terms(mine).map(value=>value.toLocaleLowerCase()));
 return terms(theirs).find(value=>known.has(value.toLocaleLowerCase()));
};
export function chooseEventSuggestion({people=[],contexts=[],self=null}={}){
 const listed=new Map(people.filter(person=>person?.profile_id&&person.profile_id!==self?.id).map(person=>[person.profile_id,person]));
 const candidates=[];
 for(const context of contexts){
  if(!context?.profile_id||context.profile_id===self?.id||context.intention_completed)continue;
  if(!listed.has(context.profile_id)&&!context.saved_for_event)continue;
  const reminder=text(context.intention)||text(context.note);
  if(!reminder)continue;
  candidates.push({person:listed.get(context.profile_id)||context,reason:reminder,source:'context',previousEventName:context.previous_event_name,listed:listed.has(context.profile_id),priority:text(context.intention)?3:2});
 }
 for(const person of listed.values()){
  const interest=common(self?.interests,person.interests);
  const skill=common(self?.skills,person.skills);
  if(interest||skill)candidates.push({person,reason:interest?'You both list '+interest+' as an interest.':'You both list '+skill+' as a skill.',source:'shared',listed:true,priority:1});
 }
 candidates.sort((a,b)=>b.priority-a.priority||String(a.person.profile_id).localeCompare(String(b.person.profile_id)));
 return candidates[0]||null;
}
