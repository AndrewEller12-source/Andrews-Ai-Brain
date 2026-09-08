import {approvalProfile} from './approval.mjs';
import {randomUUID} from 'node:crypto';

const idleStates=new Set(['completed','idle','interrupted']);
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const uncertainError=message=>Object.assign(new Error(message),{uncertain:true});
const safeRejections=new Set(['no-client-found','no-handler-for-request','request-version-mismatch']);

// Explicit user mutations only. The observer remains a separate, read-only stream client.
export class DesktopControl{
 constructor(observer,{timeoutMs=15000}={}){
  if(!observer||typeof observer.on!=='function'||typeof observer.send!=='function')throw Error('A desktop observer is required.');
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Desktop request timeout must be positive.');
  this.observer=observer;this.timeoutMs=timeoutMs;this.pending=new Map();this.closed=false;
  this.onMessage=message=>this.receive(message);this.onChange=()=>this.checkConnection();
  observer.on('message',this.onMessage);observer.on('change',this.onChange);
 }
 supports(){return !this.closed&&this.observer.connected===true&&nonempty(this.observer.clientId);}
 hasOwner(threadId){return this.supports()&&nonempty(threadId)&&nonempty(this.observer.records?.get(threadId)?.owner);}
 owner(threadId){if(!this.supports())throw Error('Codex desktop is disconnected.');if(!this.hasOwner(threadId))throw Error('This task has no confirmed desktop owner. Open it in Codex first.');return this.observer.records.get(threadId);}
 async startTurn(threadId,{prompt,images=[],clientId,model,effort,approvalMode}={}){
  const record=this.owner(threadId);
  if(!idleStates.has(record.activity?.state))throw Error('This desktop task is active or its state is unknown. Wait for it to finish.');
  if([...this.pending.values()].some(p=>p.threadId===threadId))throw Error('A desktop request for this task is already awaiting confirmation.');
  if(!nonempty(prompt)&&!images.length)throw Error('Enter a message or attach a photo.');
  if(clientId!==undefined&&!nonempty(clientId))throw Error('Client message ID must be a nonempty string.');
  if(model!==undefined&&!nonempty(model))throw Error('Model must be a nonempty string.');
  if(effort!==undefined&&effort!==null&&!nonempty(effort))throw Error('Reasoning effort must be a string or null.');
  if(!Array.isArray(images)||images.length>8||images.some(i=>i.type!=='localImage'||!nonempty(i.path)))throw Error('Invalid image input');
  const profile=approvalMode===undefined?{}:approvalProfile(approvalMode,record.cwd).turn;
  const request={...profile,threadId,input:[...(nonempty(prompt)?[{type:'text',text:prompt,text_elements:[]}]:[]),...images],clientUserMessageId:clientId??randomUUID(),...(model===undefined?{}:{model}),...(effort===undefined?{}:{effort})};
  const result=await this.request(threadId,record.owner,'thread-follower-start-turn',2,{conversationId:threadId,turnStart:{request,context:{inheritThreadSettings:true}}});
  const turnResult=result?.result;
  if(!nonempty(turnResult?.turn?.id))throw uncertainError('Desktop accepted the request without a usable turn receipt. Inspect the task before repeating it.');
  return turnResult;
 }
 async interrupt(threadId,turnId){
  const record=this.owner(threadId);
  if(!nonempty(turnId))throw Error('An exact turn ID is required to stop a desktop turn.');
  if(record.activity?.turnId!==turnId)throw Error('The requested turn is no longer the observed desktop turn. Refresh its state before stopping.');
  if(!['running','waiting'].includes(record.activity?.state))throw Error('The observed desktop turn is not running.');
  const result=await this.request(threadId,record.owner,'thread-follower-interrupt-turn',4,{conversationId:threadId,mode:'user-stop',expectedTurnId:turnId});
  if(result?.ok!==true||result.interruptedTurnId!==turnId)throw uncertainError('Desktop did not return a matching stop receipt. Inspect the task before taking another action.');
  return result;
 }
 async steerTurn(threadId,{prompt,images=[],expectedTurnId,clientId}={}){
  const record=this.owner(threadId);
  if((!nonempty(prompt)&&!images.length)||(prompt||'').length>30000||!nonempty(expectedTurnId))throw Error('An exact active turn and bounded message are required.');
  if(!['running','waiting'].includes(record.activity?.state)||record.activity.turnId!==expectedTurnId)throw Error('The observed desktop turn changed or is no longer active. Refresh before steering.');
  if([...this.pending.values()].some(p=>p.threadId===threadId))throw Error('A desktop request is already awaiting confirmation.');
  if(!Array.isArray(images)||images.length>8||images.some(i=>i.type!=='localImage'||!nonempty(i.path)))throw Error('Invalid image input');
  const messageId=clientId??randomUUID();
  const result=await this.request(threadId,record.owner,'thread-follower-steer-turn',1,{
   conversationId:threadId,clientUserMessageId:messageId,input:[...(nonempty(prompt)?[{type:'text',text:prompt,text_elements:[]}]:[]),...images],attachments:[],
   restoreMessage:{id:messageId,text:prompt,cwd:record.cwd,createdAt:Date.now(),context:{prompt,addedFiles:[],fileAttachments:[],ideContext:null,imageAttachments:[],commentAttachments:[]}}
  });
  if(result?.result?.turnId!==expectedTurnId)throw uncertainError('Steering did not return the expected active turn. Inspect its receipt; do not replay.');
  return result.result;
 }
 async answerQuestion(threadId,requestId,response){
  const record=this.owner(threadId);
  const pending=record.state?.requests?.find(q=>q&&String(q.id)===String(requestId));
  if(!pending||pending.method!=='item/tool/requestUserInput')throw Error('This question is no longer pending.');
  const result=await this.request(threadId,record.owner,'thread-follower-submit-user-input',1,{conversationId:threadId,requestId:pending.id,response});
  if(result?.ok!==true)throw uncertainError('The desktop did not confirm this answer. Refresh before retrying.');
  return result;
 }
 request(threadId,owner,method,version,params){
  return new Promise((resolve,reject)=>{
   const requestId=randomUUID();
   const timer=setTimeout(()=>{const pending=this.pending.get(requestId);if(!pending)return;this.pending.delete(requestId);reject(uncertainError('Desktop request timed out. Its outcome is unconfirmed; inspect the task before repeating it.'));},this.timeoutMs);
   this.pending.set(requestId,{threadId,owner,method,resolve,reject,timer});
   try{this.observer.send({type:'request',requestId,sourceClientId:this.observer.clientId,targetClientId:owner,version,method,params,timeoutMs:this.timeoutMs});}
   catch{this.finish(requestId,uncertainError('Desktop connection failed while sending. Its outcome is unconfirmed.'));}
  });
 }
 receive(message){
  if(message?.type!=='response')return;
  const pending=this.pending.get(message.requestId);if(!pending)return;
  if(message.resultType==='error'){
   const text=typeof message.error==='string'?message.error:'Desktop request failed.';
   this.finish(message.requestId,safeRejections.has(text)?new Error(text):uncertainError(text));return;
  }
  if(message.resultType!=='success'||message.method!==pending.method||message.handledByClientId!==pending.owner){this.finish(message.requestId,uncertainError('Desktop response identity did not match the submitted request. Inspect the task before repeating it.'));return;}
  this.finish(message.requestId,null,message.result);
 }
 checkConnection(){
  for(const [id,pending]of this.pending){if(!this.supports()||this.observer.records?.get(pending.threadId)?.owner!==pending.owner)this.finish(id,uncertainError('The desktop owner disconnected or changed. The submitted request outcome is unconfirmed.'));}
 }
 finish(id,error,result){const pending=this.pending.get(id);if(!pending)return;this.pending.delete(id);clearTimeout(pending.timer);if(error)pending.reject(error);else pending.resolve(result);}
 close(){if(this.closed)return;this.closed=true;this.observer.off('message',this.onMessage);this.observer.off('change',this.onChange);for(const id of this.pending.keys())this.finish(id,uncertainError('Desktop control closed while a request was awaiting confirmation.'));}
}
