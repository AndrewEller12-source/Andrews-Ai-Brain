import {randomUUID} from 'node:crypto';
// Resume creates a new, idempotent turn in the existing conversation. It never
// replays an uncertain dispatch or claims to checkpoint a tool's external state.
export const resumePrompt='Resume the unfinished owner request from this saved conversation and workspace. Inspect the last turn, saved files and tool results first. Continue from the remaining work; do not repeat completed actions. If a previous external action has an uncertain outcome, verify it or ask the owner before repeating it. Keep the original scope and approval boundaries.';

export async function resumeSavedWork(store,source,call){
 const existing=source.resumedBy&&store.data.jobs.find(j=>j.id===source.resumedBy);
 if(existing)return existing;
 if(source.status!=='paused')throw Error('Pause this request or check its interrupted outcome before resuming.');
 if(!source.executionDispatched){
  return store.update(source.id,{status:source.pauseStage==='ready'?'ready':'queued',pauseRequested:false,pausedAt:null,waitReason:null,error:null});
 }
 if(!source.threadId||!source.turnId)throw Error('The saved turn receipt is missing. Check the outcome before continuing.');
 const latest=(await call('thread/turns/list',{threadId:source.threadId,limit:1,itemsView:'notLoaded',sortDirection:'desc'})).data?.[0];
 if(latest?.id!==source.turnId||latest.status!=='interrupted')throw Error('The conversation has changed or its stop is unconfirmed. Open the chat and check the latest work.');
 // Recheck after the await: two simultaneous resume clicks must share a receipt.
 if(source.resumedBy)return store.data.jobs.find(j=>j.id===source.resumedBy);
 if(store.data.universes?.some(u=>u.id===source.universeId&&u.deletedAt))throw Error('Restore this universe before resuming its work.');
 const job={id:randomUUID(),requestKey:'resume:'+source.id+':'+source.turnId,prompt:resumePrompt,threadId:source.threadId,universeId:source.universeId,options:{threadId:source.threadId,...(source.universeId?{universeId:source.universeId}:{})},events:[],createdAt:Date.now(),title:source.title,department:source.department,departmentSource:source.departmentSource,model:source.model,effort:source.effort,approvalMode:source.approvalMode,projectLabel:source.projectLabel,workspaceKey:source.workspaceKey,cwd:source.cwd,kind:source.kind||'task',tier:source.tier||'standard',origin:source.origin,managerForDepartment:source.managerForDepartment,managerForUniverseId:source.managerForUniverseId,resumeOf:source.id,resumeSourceTurnId:source.turnId,status:'ready',reason:'Continue the saved conversation and workspace after a confirmed pause.'};
 store.data.jobs.push(job);source.resumedBy=job.id;source.status='resumed';store.save();return job;
}
