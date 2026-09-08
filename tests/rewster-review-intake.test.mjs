import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core.mjs';import {ReviewIntake} from '../rewster-review-intake.mjs';
function setup(t,override){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-intake-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(path.join(dir,'state.json'));store.data.settings.rewsterSupervisor={enabled:true,enabledAt:1};
 store.data.notifications=[{id:'n',threadId:'worker',turnId:'turn',title:'Design',completedAt:100}];
 const threads=[{id:'worker',title:'Design',cwd:dir}],calls=[];
 const call=async(method,args)=>{calls.push({method,args});if(override)return override(method,args);
  return method==='thread/turns/list'?{data:[{id:'turn',status:'completed'}]}:{data:[{turnId:'turn',item:{type:'agentMessage',phase:'final_answer',text:'Actual result'}},{turnId:'turn',item:{type:'userMessage',text:'Exact owner requirement'}}]};};
 return {store,threads,calls,intake:new ReviewIntake({store,call,getThreads:()=>threads})};
}
test('imports exact native completion without starting or resuming any worker',async t=>{
 const {store,calls,intake}=setup(t);await intake.tick(1000);await intake.tick(1001);
 assert.equal(store.data.jobs.length,1);const j=store.data.jobs[0];
 assert.equal(j.observedOnly,true);assert.equal(j.prompt,'Exact owner requirement');assert.equal(j.response,'Actual result');
 assert.equal(j.turnId,'turn');assert.equal(j.executionDispatched,undefined);assert.equal(calls.length,2);
});
test('does not review old history, own voice sessions, or internal reviews',async t=>{
 const {store,threads,calls,intake}=setup(t);threads[0].cwd='/test/Rewster Local/agent-workspace';await intake.tick(1000);assert.equal(calls.length,0);
 store.data.notifications.push({id:'old',threadId:'other',turnId:'old',completedAt:0});await intake.tick(1001);assert.equal(calls.length,0);
});
test('missing exact completion is a visible blocker with bounded retry',async t=>{
 const {store,calls,intake}=setup(t,()=>({data:[]}));await intake.tick(1000);await intake.tick(1001);
 assert.equal(store.data.jobs.length,0);assert.equal(store.data.rewsterReviewIntake.n.state,'needs_owner');assert.equal(calls.length,1);
});
test('in-progress turns cannot be mistaken for completed work',async t=>{
 const {store,intake}=setup(t,()=>({data:[{id:'turn',status:'inProgress'}]}));await intake.tick(1000);assert.equal(store.data.jobs.length,0);
});
test('item pagination gathers the original request and ignores other-turn text',async t=>{
 const {store,intake}=setup(t,(method,args)=>method==='thread/turns/list'?{data:[{id:'turn',status:'completed'}]}:args.cursor?
  {data:[{turnId:'turn',item:{type:'userMessage',text:'Real request'}},{turnId:'other',item:{type:'userMessage',text:'Wrong request'}}]}:
  {data:[{turnId:'turn',item:{type:'agentMessage',text:'Result'}}],nextCursor:'next'});
 await intake.tick(1000);assert.equal(store.data.jobs[0].prompt,'Real request');
});
test('dashboard-managed completion is not duplicated by native intake',async t=>{
 const {store,calls,intake}=setup(t);store.data.jobs.push({id:'job',threadId:'worker',turnId:'turn',status:'completed',response:'Saved answer'});
 await intake.tick(1000);assert.equal(store.data.jobs.length,1);assert.equal(calls.length,0);
});
