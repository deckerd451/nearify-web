export function chooseAmbientHome({inbox,contexts,extras,event,ready,now=Date.now()}) {
 const unread=inbox?.threads?.filter(x=>x.unread).sort((a,b)=>Date.parse(b.latest_at||0)-Date.parse(a.latest_at||0))[0];
 if(unread)return {kind:'unread',person:unread};
 if(inbox?.requests?.length)return {kind:'invitation',person:inbox.requests[0]};
 if(inbox?.detail_requests?.length)return {kind:'details',person:inbox.detail_requests[0]};
 if(!ready)return {kind:'unavailable'};
 if(extras?.review)return {kind:'review',review:extras.review};
 const hidden=new Set(extras.dismissed_people||[]);
 const relevant=(contexts||[]).filter(x=>{
  const updated=Date.parse(x.updated_at);
  return !hidden.has(x.profile_id)&&!x.intention_completed&&(x.note?.trim()||x.intention?.trim())&&Number.isFinite(updated)&&updated<=now&&now-updated<=30*86400000&&!(Date.parse(x.snoozed_until)>now)&&!(Date.parse(x.latest_outbound_at)>=updated);
 }).sort((a,b)=>Number(!!b.intention)-Number(!!a.intention)||Date.parse(b.updated_at)-Date.parse(a.updated_at));
 if(relevant.length)return {kind:'context',person:relevant[0]};
 if(event)return {kind:'event',event};
 return {kind:'idle'};
}
