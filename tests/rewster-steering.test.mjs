import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core.mjs';
import {deliverWorkerMessage} from '../rewster-steering.mjs';
const args={threadId:'task',message:'Check the result against the request.',reason:'Owner monitoring',requestKey:'test-steer-123'};
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-steer-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(path.join(dir,'state.json')),calls=[];const threads=[{id:'task',activity:{state:'running',turnId:'turn'}}];const deps={desktopControl:{hasOwner:()=>false},bridge:{call:async(method,input)=>{calls.push({method,input});return {turnId:'turn'};}}};return {store,threads,calls,deps};}
test('active manager-owned worker receives exact-turn steering, not a new queued job',async t=>{
 const f=fixture(t),r=await deliverWorkerMessage(f.store,f.threads,args,f.deps);
 assert.equal(r.status,'steered');assert.equal(r.deliveryConfirmed,true);assert.equal(r.executionConfirmed,false);assert.equal(f.store.data.jobs.length,0);
 assert.equal(f.calls[0].method,'turn/steer');assert.equal(f.calls[0].input.expectedTurnId,'turn');assert.ok(!('approvalPolicy' in f.calls[0].input));
 const duplicate=await deliverWorkerMessage(f.store,f.threads,args,f.deps);assert.equal(duplicate.duplicate,true);assert.equal(f.calls.length,1);
 await assert.rejects(deliverWorkerMessage(f.store,f.threads,{...args,message:'Different'},f.deps),/identity/);
});
test('desktop-owned work uses its owning app, never the separate app-server',async t=>{
 const f=fixture(t);f.deps.desktopControl={hasOwner:()=>true,steerTurn:async(id,input)=>{assert.equal(id,'task');assert.equal(input.expectedTurnId,'turn');return {turnId:'turn'};}};
 assert.equal((await deliverWorkerMessage(f.store,f.threads,args,f.deps)).status,'steered');assert.equal(f.calls.length,0);
});
test('timeout or wrong receipt stays uncertain through retry/restart; no queued fallback',async t=>{
 for(const mode of ['timeout','wrong']){const f=fixture(t);f.deps.bridge.call=async()=>{f.calls.push(mode);if(mode==='timeout')throw Error('offline');return {turnId:'other'};};
 assert.equal((await deliverWorkerMessage(f.store,f.threads,args,f.deps)).status,'uncertain');
 const reloaded=new Store(f.store.file);await deliverWorkerMessage(reloaded,f.threads,args,f.deps);assert.equal(f.calls.length,1);assert.equal(reloaded.data.jobs.length,0);}
});
test('stale turn and unknown live state are not sent or queued; idle follow-up is explicit',async t=>{
 const f=fixture(t);assert.equal((await deliverWorkerMessage(f.store,f.threads,{...args,expectedTurnId:'old'},f.deps)).status,'stale');
 f.threads[0].activity.state='unknown';assert.equal((await deliverWorkerMessage(f.store,f.threads,args,f.deps)).status,'unavailable');
 f.threads[0].activity.state='completed';assert.equal((await deliverWorkerMessage(f.store,f.threads,{...args,expectedTurnId:'turn'},f.deps)).status,'stale');assert.equal(f.store.data.jobs.length,0);
 const r=await deliverWorkerMessage(f.store,f.threads,args,f.deps);assert.equal(r.deliveryMode,'follow_up');assert.equal(r.status,'queued');assert.equal(f.store.data.jobs[0].approvalMode,'manual');assert.equal(f.calls.length,0);
});
test('concurrent duplicate sees durable in-flight receipt and never dispatches twice',async t=>{
 const f=fixture(t);let release;f.deps.bridge.call=()=>new Promise(r=>{f.calls.push('sent');release=r;});
 const pending=deliverWorkerMessage(f.store,f.threads,args,f.deps);assert.equal((await deliverWorkerMessage(f.store,f.threads,args,f.deps)).status,'dispatching');release({turnId:'turn'});await pending;assert.equal(f.calls.length,1);
});
test('catalog refresh lag permits exact managed receipts but never revives unavailable or desktop tasks',async t=>{
 const f=fixture(t);f.store.data.jobs.push({id:'job',threadId:'task',turnId:'turn',status:'running'});
 assert.equal((await deliverWorkerMessage(f.store,[],args,f.deps)).status,'steered');assert.equal(f.store.data.jobs.length,1);
 await assert.rejects(deliverWorkerMessage(f.store,[{id:'task',catalogMissing:true}],{...args,requestKey:'missing-catalog'},f.deps),/available/);
 f.store.data.jobs[0].executionRuntime='desktop';
 await assert.rejects(deliverWorkerMessage(f.store,[],{...args,requestKey:'desktop-gap'},f.deps),/available/);
});
