import {test} from 'node:test';import assert from 'node:assert/strict';import net from 'node:net';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
import {DesktopObserver,compactDesktopState,applyDesktopPatches,desktopActivity} from '../desktop.mjs';
const state=(status='active')=>({id:'task',title:'Task',threadRuntimeStatus:{type:status,activeFlags:[]},turnHistory:{history:{entitiesByKey:{turn:{turnId:'turn-1',status:'inProgress',turnStartedAtMs:1000,items:[{secret:'private body'}]}}}},turns:[],unneeded:'private state'});
const snapshot=(revision=1)=>({type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'owner',params:{hostId:'local',conversationId:'task',change:{type:'snapshot',revision,conversationState:state()}}});
const patch=(baseRevision,revision,patches)=>({type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'owner',params:{hostId:'local',conversationId:'task',change:{type:'patches',baseRevision,revision,patches}}});
function observer(){const o=new DesktopObserver({socketPath:'/unused',enabled:false});o.connected=true;o.wanted.add('task');return o}
async function until(fn){for(let i=0;i<100;i++){const r=fn();if(r)return r;await delay(10)}throw Error('Desktop observer test timed out')}
function frame(m){const body=Buffer.from(JSON.stringify(m)),head=Buffer.alloc(4);head.writeUInt32LE(body.length);return Buffer.concat([head,body])}

test('desktop compaction retains live metadata and excludes conversation body and reasoning',()=>{
 const compact=compactDesktopState(state());assert.equal(desktopActivity(compact).state,'running');assert.equal(compact.entities.turn.turnId,'turn-1');assert.ok(!JSON.stringify(compact).includes('private'));
 compact.threadRuntimeStatus.activeFlags=['waitingOnApproval'];assert.equal(desktopActivity(compact).state,'waiting');compact.threadRuntimeStatus={type:'idle',activeFlags:[]};compact.entities.turn={turnId:'turn-1',status:'completed',turnStartedAtMs:1000,durationMs:50};assert.equal(desktopActivity(compact).completedAt,1050);assert.equal(desktopActivity(compact).state,'completed');
});
test('revision-matched patches transition live status; gaps invalidate and request resynchronization',()=>{
 const o=observer(),sent=[];o.send=m=>sent.push(m);o.receive(snapshot());assert.equal(o.get('task').activity.state,'running');
 o.receive(patch(1,2,[{op:'replace',path:['threadRuntimeStatus'],value:{type:'idle',activeFlags:[]}},{op:'replace',path:['turnHistory','history','entitiesByKey','turn','status'],value:'completed'}]));assert.equal(o.get('task').activity.state,'completed');
 o.lastSubscribe.set('task',0);o.receive(patch(9,10,[]));assert.equal(o.get('task'),null);assert.equal(sent.at(-1).method,'thread-stream-following-changed');assert.equal(sent.at(-1).params.following,true);
});
test('unsupported stream versions, owner disconnects, and wrong hosts cannot produce live activity',()=>{
 const o=observer();o.receive({...snapshot(),version:99});assert.equal(o.get('task'),null);o.receive({...snapshot(),params:{...snapshot().params,hostId:'remote'}});assert.equal(o.get('task'),null);
 o.receive(snapshot());o.receive({type:'broadcast',method:'client-status-changed',params:{status:'disconnected',clientId:'owner'}});assert.equal(o.get('task'),null);
});
test('desktop patches reject prototype paths and do not copy message content',()=>{
 const compact=compactDesktopState(state());assert.throws(()=>applyDesktopPatches(compact,[{op:'add',path:['__proto__','polluted'],value:true}]),/Invalid/);assert.equal({}.polluted,undefined);
 applyDesktopPatches(compact,[{op:'replace',path:['turnHistory','history','entitiesByKey','turn','items'],value:['private']}]);assert.ok(!JSON.stringify(compact).includes('private'));
});
test('real socket framing handles split packets, observer-only registration, and disconnect invalidation',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rw-ipc-'));fs.chmodSync(dir,0o700);const socketPath=path.join(dir,'ipc.sock'),server=net.createServer(),seen=[];let client;
 server.on('connection',s=>{client=s;let pending=Buffer.alloc(0);s.on('data',c=>{pending=Buffer.concat([pending,c]);while(pending.length>=4){const n=pending.readUInt32LE();if(pending.length<n+4)return;const m=JSON.parse(pending.subarray(4,n+4));pending=pending.subarray(n+4);seen.push(m);if(m.method==='initialize')s.write(frame({type:'response',method:'initialize',resultType:'success',result:{clientId:'observer'}}))}})});
 await new Promise(r=>server.listen(socketPath,r));const o=new DesktopObserver({socketPath});t.after(()=>{o.close();client?.destroy();server.close();fs.rmSync(dir,{recursive:true,force:true})});o.setThreads(['task']);o.start();
 await until(()=>o.connected&&seen.some(m=>m.method==='thread-stream-following-changed'));
 assert.equal(seen[0].params.clientType,'rewster-command-observer');const b=frame(snapshot());client.write(b.subarray(0,2));await delay(10);assert.equal(o.get('task'),null);client.write(b.subarray(2,11));client.write(b.subarray(11));await until(()=>o.get('task'));
 client.write(frame({type:'client-discovery-request',requestId:'discovery'}));await until(()=>seen.some(m=>m.type==='client-discovery-response'));assert.deepEqual(seen.find(m=>m.type==='client-discovery-response').response,{canHandle:false});
 o.setThreads([]);await until(()=>seen.some(m=>m.params?.following===false));assert.equal(o.get('task'),null);o.setThreads(['task']);client.write(frame(snapshot()));await until(()=>o.get('task'));client.destroy();await until(()=>!o.connected);assert.equal(o.get('task'),null);
 assert.ok(seen.every(m=>['initialize','thread-stream-following-changed'].includes(m.method)||m.type==='client-discovery-response'));
});
test('observer refuses an IPC directory writable by other users',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rw-unsafe-'));fs.chmodSync(dir,0o777);const socketPath=path.join(dir,'ipc.sock'),server=net.createServer();await new Promise(r=>server.listen(socketPath,r));const o=new DesktopObserver({socketPath});t.after(()=>{o.close();server.close();fs.rmSync(dir,{recursive:true,force:true})});o.start();assert.equal(o.connected,false);assert.match(o.error,/private local user socket/);
});

test('Immer array insert/remove preserves remaining waiting flags and old snapshots cannot regress status',()=>{
 const compact=compactDesktopState(state());compact.threadRuntimeStatus.activeFlags=['waitingOnApproval'];
 applyDesktopPatches(compact,[{op:'add',path:['threadRuntimeStatus','activeFlags',0],value:'waitingOnUserInput'},{op:'remove',path:['threadRuntimeStatus','activeFlags',0]}]);assert.deepEqual(compact.threadRuntimeStatus.activeFlags,['waitingOnApproval']);assert.equal(desktopActivity(compact).state,'waiting');
 const o=observer();o.receive(snapshot(2));o.receive(patch(2,3,[{op:'replace',path:['threadRuntimeStatus'],value:{type:'idle',activeFlags:[]}}]));o.receive(snapshot(1));assert.equal(o.get('task').activity.state,'idle');
});
test('missing source identity and mismatched conversation identities cannot establish activity',()=>{
 const o=observer();o.receive({...snapshot(),sourceClientId:null});assert.equal(o.get('task'),null);
 const m=snapshot();m.params.change.conversationState.id='another-task';o.receive(m);assert.equal(o.get('task'),null);
 o.receive({...snapshot(),params:{...snapshot().params,change:{...snapshot().params.change,revision:NaN}}});assert.equal(o.get('task'),null);
});

test('an early revision gap schedules bounded resync rather than waiting for a 30-second subscription refresh',async t=>{
 const o=observer(),sent=[];t.after(()=>o.close());o.send=m=>sent.push(m);o.receive(snapshot());o.lastSubscribe.set('task',Date.now());o.receive(patch(9,10,[]));assert.equal(o.get('task'),null);await until(()=>sent.some(m=>m.params?.following===true));
});

test('turn runtime uses the exact start timestamp rather than the latest observation',()=>{
 const compact=compactDesktopState(state()),a=desktopActivity(compact,900000);assert.equal(a.startedAt,1000);assert.equal(a.observedAt,900000);assert.equal(a.turnStatus,'inProgress');
 applyDesktopPatches(compact,[{op:'replace',path:['turnHistory','history','entitiesByKey','turn','turnStartedAtMs'],value:4000}]);assert.equal(desktopActivity(compact,999999).startedAt,4000);
});
