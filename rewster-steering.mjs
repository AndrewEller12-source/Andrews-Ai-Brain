import {createHash} from 'node:crypto';
import {sendWorkerMessage} from './rewster-supervisor.mjs';

// Durable message receipts are separate from jobs: steering never consumes a
// worker slot or creates a duplicate completion/review for the original turn.
export async function deliverWorkerMessage(store,threads,args,{desktopControl,bridge,now=Date.now}={}){
 const {threadId,message,reason,requestKey,expectedTurnId}=args;
 if(typeof requestKey!=='string'||requestKey.length<8||requestKey.length>160||typeof threadId!=='string'||typeof message!=='string'||!message.trim()||message.length>12000||typeof reason!=='string'||!reason.trim()||reason.length>1000)throw Error('An exact task, bounded message, reason and request identity are required.');
 // A newly created managed task may finish before the history catalog refresh.
 // Its exact persisted execution receipt remains authoritative for that gap;
 // never infer desktop activity or revive an explicitly unavailable catalog item.
 const managed=store.data.jobs.filter(j=>j.threadId===threadId).at(-1);
 const receiptState=managed?.executionRuntime!=='desktop'?({running:'running',review:'waiting',completed:'completed',cancelled:'interrupted'})[managed?.status]:null;
 const known=threads.find(t=>t.id===threadId)||(receiptState?{id:threadId,activity:{state:receiptState,turnId:managed.turnId}}:null);
 if(!known||known.archived||known.catalogMissing)throw Error('Choose an existing available task ID.');
 if(store.data.jobs.some(j=>j.requestKey===requestKey))return {...sendWorkerMessage(store,threads,args),deliveryMode:'follow_up',duplicate:true,deliveryConfirmed:false};
 const fingerprint=createHash('sha256').update(JSON.stringify([threadId,message,reason,expectedTurnId||null])).digest('hex');
 store.data.rewsterMessages??={};
 const prior=store.data.rewsterMessages[requestKey];
 if(prior){if(prior.fingerprint!==fingerprint)throw Error('Message identity belongs to different content.');return {...prior,ok:prior.status==='steered',duplicate:true};}
 const a=known.activity;
 if(!['running','waiting'].includes(a?.state)){
  if(expectedTurnId)return {ok:false,status:'stale',threadId,message:'The monitored turn is no longer active. No message was queued.'};
  if(!['completed','idle','interrupted'].includes(a?.state))return {ok:false,status:'unavailable',threadId,message:'Live task state is unknown. No message was queued.'};
  return {...sendWorkerMessage(store,threads,args),deliveryMode:'follow_up',deliveryConfirmed:false};
 }
 if(!a.turnId||expectedTurnId&&expectedTurnId!==a.turnId)return {ok:false,status:'stale',threadId,message:'The active turn changed. No message was sent or queued.'};
 const record={requestKey,fingerprint,threadId,turnId:a.turnId,status:'dispatching',deliveryMode:'steer',deliveryConfirmed:false,executionConfirmed:false,createdAt:now()};
 store.data.rewsterMessages[requestKey]=record;store.save();
 const prompt='Rewster management follow-up. Reason: '+reason+'\nThis is within-scope guidance, not owner approval or permission to expand the task. Preserve the original request and keep consequential actions owner-reviewable.\n\n'+message;
 try{
  const result=desktopControl.hasOwner(threadId)
   ?await desktopControl.steerTurn(threadId,{prompt,expectedTurnId:a.turnId,clientId:requestKey})
   :await bridge.call('turn/steer',{threadId,expectedTurnId:a.turnId,input:[{type:'text',text:prompt}],clientUserMessageId:requestKey});
  if(result?.turnId!==a.turnId)throw Error('No matching steering receipt.');
  Object.assign(record,{status:'steered',deliveryConfirmed:true,acceptedAt:now(),message:'Guidance accepted into the active turn. The requested changes are not yet verified.'});
 }catch{
  // An uncertain response must never create a second queued task or replay.
  Object.assign(record,{status:'uncertain',message:'Steering was not confirmed. Inspect this exact turn before another attempt; no queued fallback was created.'});
 }
 store.save();return {...record,ok:record.status==='steered'};
}
