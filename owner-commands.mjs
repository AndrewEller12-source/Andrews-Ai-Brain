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
 const activity=(t?.activity?.source==='desktop'||t?.activity?.source==='app-server'&&t.activity.turnId)?t.activity:job?{state:'running',turnId:job.turnId}:null;
 if(!activity||!['running','waiting'].includes(activity.state)||activity.turnId!==expectedTurnId)throw Error('That turn is no longer confirmed active. Refresh, or choose Queue this. Nothing was sent.');
 const record={threadId,turnId:expectedTurnId,message,attachments,requestKey,fingerprint,status:'sending',createdAt:Date.now()};
 store.data.ownerMessages[requestKey]=record;store.save();
 try{
  const result=activity.source==='desktop'?await desktopControl.steerTurn(threadId,{prompt:message,images:media?.inputs(attachments)||[],expectedTurnId,clientId:requestKey}):await bridge.call('turn/steer',{threadId,expectedTurnId,input:[...(message?[{type:'text',text:message}]:[]),...(media?.inputs(attachments)||[])],clientUserMessageId:requestKey});
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

// Send now is an explicit delivery attempt. A missing receipt never creates a
// second worker: the original agent may already have received the message.
export async function sendQueuedNow(store,job,threads,services){
 if(job.executionDispatched||['delivered','uncertain'].includes(job.status))return job;
 const id=job.threadId||job.options?.threadId;
 const task=threads.find(t=>t.id===id),active=store.data.jobs.findLast(j=>j!==job&&j.threadId===id&&['running','review'].includes(j.status));
 let activity=['desktop','app-server'].includes(task?.activity?.source)?task.activity:active?{state:'running',turnId:active.turnId}:task?.activity;
 // Refresh an idle/history-only destination before deciding it needs a new employee.
 if(id&&services.lookupActivity)activity=await services.lookupActivity(id,activity)||activity;
 const observed=task?{...task,activity}:{id,activity};
 threads=[...threads.filter(t=>t.id!==id),observed];
 if(id&&['running','waiting'].includes(activity?.state)&&activity.turnId&&(['desktop','app-server'].includes(activity.source)||active)){
  const receipt=await steerOwnerMessage(store,threads,{threadId:id,expectedTurnId:activity.turnId,message:job.prompt,attachments:job.options?.attachments||[],requestKey:'send-now:'+job.id},services);
  Object.assign(job,{threadId:id,turnId:activity.turnId,executionDispatched:true,status:receipt.status==='steered'?'delivered':'uncertain',deliveryMode:'steer',waitReason:receipt.status==='steered'?'Delivered into the active turn.':receipt.error,error:receipt.error||null,deliveredAt:receipt.acceptedAt});store.save();return job;
 }
 const confirmedIdle=['desktop','app-server'].includes(activity?.source)&&['completed','interrupted','idle'].includes(activity.state);
 const busy=store.data.jobs.some(j=>j!==job&&!(confirmedIdle&&j.threadId===id&&j.turnId===activity.turnId)&&['starting','running','review'].includes(j.status)&&(id&&j.threadId===id||job.workspaceKey&&j.workspaceKey===job.workspaceKey));
 if(id&&(busy||!['completed','interrupted','idle'].includes(activity?.state))){
  if(services.allowNewAgent===false){Object.assign(job,{status:'uncertain',waitReason:'The selected agent could not accept a verified message. No substitute agent was created.',error:'Inspect this agent before trying a new round.'});store.save();return job;}
  // Work on a separate assignment rather than resuming a possibly active thread.
  Object.assign(job,{sourceThreadId:id,threadId:null,workspaceKey:null,deliveryMode:'new-agent',prompt:job.prompt+'\n\nAssignment context: This request was explicitly sent now as a separate assignment because the intended agent could not accept a verified immediate message. Original conversation: '+id+'. Original task: '+(task?.title||'Unavailable')+'. Complete only this new request in your own workspace. Do not duplicate the original assignment. Ask for missing context if necessary.',projectLabel:'Immediate assignment'});
 }else if(!id&&busy){job.sourceWorkspace=job.workspaceKey;job.workspaceKey=null;job.deliveryMode='new-agent';}
 job.nextAttemptAt=null;job.waitReason='Starting now.';store.save();return job;
}
