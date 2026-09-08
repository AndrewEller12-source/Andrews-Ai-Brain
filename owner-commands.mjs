import {createHash} from 'node:crypto';

// Owner steering is an exact-turn message, never a job or a queued fallback.
export async function steerOwnerMessage(store,threads,args,{desktopControl,bridge,media}){
 const {threadId,expectedTurnId,message='',requestKey,attachments=[]}=args;
 if(attachments.length&&!media)throw Error('Photo steering is unavailable.');if(media)media.validate(attachments);
 if(![threadId,expectedTurnId,requestKey].every(v=>typeof v==='string'&&v.trim())||typeof message!=='string'||(!message.trim()&&!attachments.length)||message.length>30000||requestKey.length<8||requestKey.length>160||['__proto__','constructor','prototype'].includes(requestKey))throw Error('Choose an active task and enter a message of up to 30,000 characters.');
 store.data.ownerMessages??={};
 const fingerprint=createHash('sha256').update(JSON.stringify([threadId,expectedTurnId,message,attachments])).digest('hex');
 const legacy=store.data.steers?.find(r=>r.requestKey===requestKey);
 if(legacy){if(legacy.signature!==JSON.stringify({threadId,expectedTurnId,prompt:message.trim(),attachments}))throw Error('This receipt belongs to another message.');return {...legacy,status:legacy.status==='delivered'?'steered':'uncertain',duplicate:true};}
 const prior=store.data.ownerMessages[requestKey];
 if(prior){if(prior.fingerprint!==fingerprint)throw Error('This receipt belongs to another message.');return {...prior,duplicate:true};}
 const t=threads.find(t=>t.id===threadId),job=store.data.jobs.findLast(j=>j.threadId===threadId&&['running','review'].includes(j.status));
 const activity=t?.activity?.source==='desktop'?t.activity:job?{state:'running',turnId:job.turnId}:null;
 if(!activity||!['running','waiting'].includes(activity.state)||activity.turnId!==expectedTurnId)throw Error('That turn is no longer confirmed active. Refresh, or choose Queue this. Nothing was sent.');
 const record={threadId,turnId:expectedTurnId,message,attachments,requestKey,fingerprint,status:'sending',createdAt:Date.now()};
 store.data.ownerMessages[requestKey]=record;store.save();
 try{
  const result=activity===t?.activity?await desktopControl.steerTurn(threadId,{prompt:message,images:media?.inputs(attachments)||[],expectedTurnId,clientId:requestKey}):await bridge.call('turn/steer',{threadId,expectedTurnId,input:[...(message?[{type:'text',text:message}]:[]),...(media?.inputs(attachments)||[])],clientUserMessageId:requestKey});
  if(result?.turnId!==expectedTurnId)throw Error('No matching turn receipt');
  record.status='steered';record.acceptedAt=Date.now();
 }catch(e){record.status='uncertain';record.error='Delivery was not confirmed. Inspect this turn before sending again; no queued fallback was created.';}
 store.save();return {...record};
}

export function prioritizeRequest(store,id,now=Date.now()){
 const job=store.data.jobs.find(j=>j.id===id);
 if(!job||!['queued','routing','ready'].includes(job.status)||job.executionDispatched)throw Error('Only an undispatched waiting request can be sent now.');
 if(store.data.settings.paused)throw Error('Dispatch is paused. Resume dispatch before sending this request.');
 Object.assign(job,{sendNowAt:now,nextAttemptAt:null,waitReason:'Prioritized by you. Checking worker and workspace availability.'});store.save();return job;
}
export function requestOrder(a,b){return Number(!!b.sendNowAt)-Number(!!a.sendNowAt)||(a.sendNowAt||a.createdAt)-(b.sendNowAt||b.createdAt);}
export function workerCapacity(job,settings){return job.sendNowAt?8:Math.min(8,settings.concurrency+(job.kind==='chat'?1:0));}
