import test from 'node:test';
import assert from 'node:assert/strict';
import {resumeSavedWork} from '../task-recovery.mjs';
function fixture(){const source={id:'source',status:'paused',executionDispatched:true,threadId:'chat',turnId:'stopped-turn',approvalMode:'manual',model:'saved-model',cwd:'/saved/work',managerForDepartment:'Engineering'};return {source,store:{data:{jobs:[source]},save(){this.saved=structuredClone(this.data)},update(id,patch){return Object.assign(source,patch)}}};}
test('resume rejects unknown, changed and still-running turns without dispatch',async()=>{
 for(const latest of [null,{id:'newer',status:'interrupted'},{id:'stopped-turn',status:'inProgress'},{id:'stopped-turn',status:'completed'}]){
  const {source,store}=fixture();await assert.rejects(resumeSavedWork(store,source,async()=>({data:latest?[latest]:[]})),/changed or its stop/);assert.equal(store.data.jobs.length,1);
 }
});
test('simultaneous resumes commit one continuation and preserve approval and manager restrictions',async()=>{
 const {source,store}=fixture();const call=async()=>({data:[{id:'stopped-turn',status:'interrupted'}]});
 const results=await Promise.all([resumeSavedWork(store,source,call),resumeSavedWork(store,source,call)]);
 assert.equal(results[0].id,results[1].id);assert.equal(store.data.jobs.length,2);assert.equal(source.status,'resumed');
 const job=results[0];assert.equal(job.threadId,'chat');assert.equal(job.cwd,'/saved/work');assert.equal(job.approvalMode,'manual');assert.equal(job.managerForDepartment,'Engineering');
 assert.equal(store.saved.jobs[0].resumedBy,job.id);assert.equal(store.saved.jobs[1].status,'ready');assert.equal(await resumeSavedWork(store,source,()=>{throw Error('Must not recheck/recreate')}),job);
});
