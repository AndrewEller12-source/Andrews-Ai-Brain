import test from 'node:test';import assert from 'node:assert/strict';
import {steerOwnerMessage,prioritizeRequest,requestOrder,workerCapacity} from '../owner-commands.mjs';
import {visibleNotifications} from '../notifications.mjs';
const args={threadId:'task',expectedTurnId:'turn',message:'Use the blue version',requestKey:'owner-message-1'};
function fixture(){return {data:{jobs:[{id:'job',threadId:'task',status:'running',turnId:'turn'}],settings:{concurrency:2}},save(){}};}
test('owner steering is idempotent and never adds a queued job',async()=>{const s=fixture();let calls=0;const services={bridge:{async call(method,p){calls++;assert.equal(method,'turn/steer');assert.equal(p.expectedTurnId,'turn');return {turnId:'turn'}}}};assert.equal((await steerOwnerMessage(s,[],args,services)).status,'steered');assert.equal((await steerOwnerMessage(s,[],args,services)).duplicate,true);assert.equal(calls,1);assert.equal(s.data.jobs.length,1);await assert.rejects(steerOwnerMessage(s,[],{...args,message:'Other'},services),/another message/);});
test('uncertain steering never retries and rejects a changed turn before dispatch',async()=>{const s=fixture();let calls=0;const services={bridge:{async call(){calls++;throw Error('Disconnected')}}};assert.equal((await steerOwnerMessage(s,[],args,services)).status,'uncertain');await steerOwnerMessage(s,[],args,services);assert.equal(calls,1);assert.equal(s.data.jobs.length,1);await assert.rejects(steerOwnerMessage(s,[],{...args,requestKey:'new-receipt',expectedTurnId:'other'},services),/no longer/);assert.equal(calls,1);});
test('desktop steering uses the observed owner and exact active turn',async()=>{const s=fixture();const threads=[{id:'task',activity:{source:'desktop',state:'running',turnId:'desktop-turn'}}];let calls=0;const r=await steerOwnerMessage(s,threads,{...args,expectedTurnId:'desktop-turn'},{desktopControl:{async steerTurn(id,p){calls++;assert.equal(p.expectedTurnId,'desktop-turn');return {turnId:'desktop-turn'}}},bridge:{call(){throw Error('wrong bridge')}}});assert.equal(calls,1);assert.equal(r.status,'steered');});
test('send now prioritizes only undispatched requests with bounded capacity',()=>{const s=fixture();s.data.jobs.push({id:'wait',status:'ready',createdAt:1});const j=prioritizeRequest(s,'wait',10);assert.equal(workerCapacity(j,s.data.settings),8);assert.equal(workerCapacity({kind:'chat'},{concurrency:8}),8);assert.equal([{id:'later',createdAt:0},j].sort(requestOrder)[0].id,'wait');assert.throws(()=>prioritizeRequest(s,'job'),/undispatched/);s.data.settings.paused=true;assert.throws(()=>prioritizeRequest(s,'wait'),/paused/);});
test('completion feed hides voice turns and internal reviews, preserving real Rewster project work',()=>{const threads=[{id:'voice',cwd:'/Users/trey/Library/Application Support/Rewster Local/agent-workspace'},{id:'project',title:'Fix Rewster audio',cwd:'/projects/Rewster'}];const data={jobs:[{id:'review-job',threadId:'review',rewsterReview:{}}],notifications:['voice','project','review'].map(threadId=>({threadId}))};assert.deepEqual(visibleNotifications(data,threads).map(n=>n.threadId),['project']);assert.equal(data.notifications.length,3);});

test('published steering receipts retain their delivery result without resending',async()=>{const s=fixture();s.data.steers=[{requestKey:args.requestKey,signature:JSON.stringify({threadId:args.threadId,expectedTurnId:args.expectedTurnId,prompt:args.message,attachments:[]}),status:'delivered'}];const r=await steerOwnerMessage(s,[],args,{bridge:{call(){throw Error('must not replay')}}});assert.equal(r.status,'steered');assert.equal(r.duplicate,true);});
test('steering photos preserves validated media on the exact active turn',async()=>{const s=fixture();const r=await steerOwnerMessage(s,[],{...args,message:'',attachments:['photo']},{media:{validate(ids){assert.deepEqual(ids,['photo'])},inputs(){return [{type:'localImage',path:'/test/photo.png'}]}},bridge:{async call(method,p){assert.deepEqual(p.input,[{type:'localImage',path:'/test/photo.png'}]);return {turnId:'turn'}}}});assert.equal(r.status,'steered');assert.deepEqual(r.attachments,['photo']);});

test('department manager completions stay out of the owner result feed',()=>{const data={jobs:[{id:'manager',threadId:'manager-chat',managerForDepartment:'Design'}],notifications:[{threadId:'manager-chat',jobId:'manager'},{threadId:'real-work'}]};assert.deepEqual(visibleNotifications(data).map(n=>n.threadId),['real-work']);});

test('Send now consumes the queued request into the active turn exactly once',async()=>{
 const {sendQueuedNow}=await import('../owner-commands.mjs');const s=fixture(),job={id:'waiting',status:'ready',prompt:'Use blue',options:{threadId:'task'}};s.data.jobs.push(job);let calls=0;
 const svc={bridge:{async call(){calls++;return {turnId:'turn'}}}};
 await sendQueuedNow(s,job,[],svc);assert.equal(job.status,'delivered');assert.equal(job.threadId,'task');assert.equal(job.turnId,'turn');await sendQueuedNow(s,job,[],svc);assert.equal(calls,1);assert.equal(s.data.jobs.length,2);
});
test('Send now never spawns a fallback after uncertain delivery',async()=>{
 const {sendQueuedNow}=await import('../owner-commands.mjs');const s=fixture(),job={id:'waiting',status:'ready',prompt:'Use blue',options:{threadId:'task'}};s.data.jobs.push(job);
 await sendQueuedNow(s,job,[],{bridge:{async call(){throw Error('Lost receipt')}}});assert.equal(job.status,'uncertain');assert.equal(job.threadId,'task');assert.equal(job.deliveryMode,'steer');
});
test('unobserved intended agent gets an isolated immediate assignment with original identity retained',async()=>{
 const {sendQueuedNow}=await import('../owner-commands.mjs');const s=fixture();s.data.jobs=[];const job={id:'waiting',threadId:'task',status:'ready',workspaceKey:'/repo',prompt:'Research pricing',options:{threadId:'task'}};
 await sendQueuedNow(s,job,[{id:'task',title:'Build app',activity:{state:'unknown'}}],{});assert.equal(job.threadId,null);assert.equal(job.workspaceKey,null);assert.equal(job.sourceThreadId,'task');assert.equal(job.deliveryMode,'new-agent');assert.match(job.prompt,/Do not duplicate/);
});

test('finished target resumes the same agent even with a stale running job',async()=>{
 const {sendQueuedNow}=await import('../owner-commands.mjs');const s=fixture(),job={id:'followup',threadId:'task',status:'ready',prompt:'What next?',options:{threadId:'task'}};s.data.jobs.push(job);
 await sendQueuedNow(s,job,[],{lookupActivity:async()=>({state:'completed',source:'app-server',turnId:'turn'}),bridge:{call(){throw Error('must not steer a completed turn')}}});
 assert.equal(job.threadId,'task');assert.equal(job.status,'ready');assert.equal(job.sourceThreadId,undefined);assert.equal(job.waitReason,'Starting now.');
});
test('history-only completed target is refreshed before Send now chooses a new agent',async()=>{
 const {sendQueuedNow}=await import('../owner-commands.mjs');const s=fixture();s.data.jobs=[];const job={id:'followup',threadId:'task',status:'ready',prompt:'What next?',options:{threadId:'task'}};
 await sendQueuedNow(s,job,[{id:'task',activity:{state:'unknown'}}],{lookupActivity:async()=>({state:'completed',source:'app-server',turnId:'done'})});assert.equal(job.threadId,'task');assert.equal(job.deliveryMode,undefined);
});
test('a freshly observed active child accepts Send now without a dashboard job',async()=>{
 const {sendQueuedNow}=await import('../owner-commands.mjs');const s=fixture();s.data.jobs=[];const job={id:'followup',threadId:'child',status:'ready',prompt:'Use blue',options:{threadId:'child'}};
 await sendQueuedNow(s,job,[{id:'child',activity:{state:'running',source:'app-server',turnId:'ct'}}],{bridge:{async call(method,p){assert.equal(method,'turn/steer');assert.equal(p.expectedTurnId,'ct');return {turnId:'ct'}}}});assert.equal(job.status,'delivered');
});
test('active catalog without turn ID retains the dashboard exact-turn steering receipt',async()=>{const s=fixture();const r=await steerOwnerMessage(s,[{id:'task',activity:{source:'app-server',state:'running',turnId:null}}],args,{bridge:{async call(method,p){assert.equal(p.expectedTurnId,'turn');return {turnId:'turn'}}}});assert.equal(r.status,'steered');});
