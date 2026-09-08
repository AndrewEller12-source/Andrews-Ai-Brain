import {createHash} from 'node:crypto';

const notificationLimit=500;
function notificationsFor(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Notification state must be an object.');
 data.notifications??=[];
 if(!Array.isArray(data.notifications))throw Error('Stored notifications must be an array.');
 return data.notifications;
}
const nonempty=value=>typeof value==='string'&&value.trim().length>0;

// The caller supplies an observed, confirmed completed turn and persists its Store.
export function recordCompletion(data,{threadId,turnId,jobId,title,department,projectLabel,completedAt}={}){
 const notifications=notificationsFor(data);
 if(!nonempty(threadId)||!nonempty(turnId))return false;
 if(notifications.some(notification=>notification.threadId===threadId&&notification.turnId===turnId))return false;
 const id='completion:'+createHash('sha256').update(JSON.stringify([threadId,turnId])).digest('hex');
 notifications.push({id,type:'completion',threadId,turnId,jobId:nonempty(jobId)?jobId:null,title:nonempty(title)?title:'Task completed',department:nonempty(department)?department:null,projectLabel:nonempty(projectLabel)?projectLabel:null,completedAt:Number.isFinite(completedAt)&&completedAt>=0?completedAt:Date.now(),read:false});
 notifications.sort((a,b)=>b.completedAt-a.completedAt||a.id.localeCompare(b.id));
 if(notifications.length>notificationLimit)notifications.length=notificationLimit;
 return true;
}

// Undefined acknowledges all; an explicit empty array acknowledges none.
export function markNotificationsRead(data,ids){
 if(ids!==undefined&&(!Array.isArray(ids)||ids.some(id=>typeof id!=='string')))throw Error('Notification IDs must be an array of strings.');
 const notifications=notificationsFor(data),selected=ids===undefined?null:new Set(ids);let count=0;
 for(const notification of notifications){if(notification.read!==true&&(selected===null||selected.has(notification.id))){notification.read=true;count++;}}
 return count;
}

// Voice conversation turns and internal reviews remain in history, not completions.
export function visibleNotifications(data,threads=[]){
 const voice=t=>/(?:^|\/)Rewster Local\/agent-workspace(?:\/|$)/i.test(String(t?.cwd||t?.workspace||'').replaceAll('\\','/'));
 const hidden=new Set(threads.filter(voice).map(t=>t.id));
 for(const j of data.jobs||[])if(j.rewsterReview||voice(j))hidden.add(j.threadId||j.id);
 return (data.notifications||[]).filter(n=>!hidden.has(n.threadId)&&!(data.jobs||[]).some(j=>j.id===n.jobId&&(j.rewsterReview||voice(j))));
}
