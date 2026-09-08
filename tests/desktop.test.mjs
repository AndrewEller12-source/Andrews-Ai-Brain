import {once} from 'node:events';import {test} from 'node:test';import assert from 'node:assert/strict';import net from 'node:net';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
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
 const large=snapshot(2);Object.assign(large.params.change.conversationState,{title:'Current large task',cwd:'/projects/large',agentNickname:'Reviewer',messageBody:'__large_body__'});const [head,tail]=JSON.stringify(large).split('__large_body__'),padding=Buffer.alloc(65536,120),header=Buffer.alloc(4);header.writeUInt32LE(Buffer.byteLength(head)+1100*padding.length+Buffer.byteLength(tail));client.write(header);client.write(head);for(let i=0;i<1100;i++)if(!client.write(padding))await once(client,'drain');client.write(tail);await until(()=>o.records.get('task')?.revision===2);assert.equal(o.connected,true);assert.equal(o.get('task').title,'Current large task');assert.equal(o.get('task').cwd,'/projects/large');assert.equal(o.get('task').agentNickname,'Reviewer');assert.equal(o.get('task').activity.turnId,'turn-1');assert.equal(o.get('task').activity.startedAt,1000);assert.equal(o.get('task').activity.state,'running');assert.ok(o.status().largestFrameBytes>64*1024*1024);
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

test('large desktop frames stream past the old 64 MB limit without retaining message bodies',async()=>{
 const {DesktopFrameDecoder}=await import('../desktop-frames.mjs');let result,error;
 const decoder=new DesktopFrameDecoder(m=>{result=m},e=>{error=e});
 const head=Buffer.from('{"type":"broadcast","method":"thread-stream-state-changed","version":11,"sourceClientId":"owner","params":{"hostId":"local","conversationId":"task","change":{"type":"snapshot","revision":1,"conversationState":{"id":"task","title":"Current task","cwd":"/projects/work","messageBody":"');
 const tail=Buffer.from('","threadRuntimeStatus":{"type":"active","activeFlags":[]},"turnHistory":{"history":{"entitiesByKey":{"a":{"turnId":"live-turn","status":"inProgress","turnStartedAtMs":1000}}}}}}}}');
 const padding=Buffer.alloc(65536,120),size=head.length+padding.length*1100+tail.length,prefix=Buffer.alloc(4);prefix.writeUInt32LE(size);
 decoder.push(prefix.subarray(0,2));decoder.push(Buffer.concat([prefix.subarray(2),head]));for(let n=0;n<1100;n++)decoder.push(padding);decoder.push(tail);
 await until(()=>result||error);assert.ifError(error);const retained=result.params.change.conversationState;assert.equal(retained.id,'task');assert.equal(retained.title,'Current task');assert.equal(retained.cwd,'/projects/work');assert.equal(desktopActivity(compactDesktopState(retained)).startedAt,1000);assert.equal(desktopActivity(compactDesktopState(retained)).turnStatus,'inProgress');assert.equal(retained.messageBody,undefined);assert.ok(JSON.stringify(result).length<1500);assert.equal(desktopActivity(compactDesktopState(result.params.change.conversationState)).turnId,'live-turn');assert.ok(decoder.largestFrame>64*1024*1024);decoder.close();
});

test('stream decoder preserves patch revisions and receipts across adjacent fragmented frames',async()=>{
 const {DesktopFrameDecoder}=await import('../desktop-frames.mjs');const rows=[];let error;
 const decoder=new DesktopFrameDecoder(m=>rows.push(m),e=>error=e),messages=[snapshot(),patch(1,2,[{op:'replace',path:['threadRuntimeStatus'],value:{type:'idle',activeFlags:[]}}]),{type:'response',method:'thread-follower-start-turn',requestId:'receipt',resultType:'success',handledByClientId:'owner',result:{result:{turn:{id:'new-turn',items:[{text:'secret'}]}}}}];
 const bytes=Buffer.concat(messages.map(frame));for(let i=0;i<bytes.length;i+=11)decoder.push(bytes.subarray(i,i+11));await until(()=>rows.length===3||error);assert.ifError(error);const o=observer();rows.slice(0,2).forEach(m=>o.receive(m));assert.equal(o.get('task').activity.state,'idle');assert.equal(rows[2].result.result.turn.id,'new-turn');assert.equal(rows[2].result.result.turn.items,undefined);decoder.close();
});


test('stream decoder rejects invalid declared lengths without buffering their bodies',async()=>{
 const {DesktopFrameDecoder}=await import('../desktop-frames.mjs');for(const size of [0,1024*1024*1024+1]){let error,delivered=false;const decoder=new DesktopFrameDecoder(()=>delivered=true,e=>error=e),header=Buffer.alloc(4);header.writeUInt32LE(size);decoder.push(header);assert.match(error.message,/Invalid desktop frame length/);assert.equal(delivered,false);decoder.close();}
});

test('pending desktop questions survive compaction and resolve without exposing unrelated request bodies',()=>{
 const q={id:42,method:'item/tool/requestUserInput',params:{threadId:'task',turnId:'turn-1',questions:[{id:'color',question:'Which color?',options:[{label:'Blue',description:'Ocean blue'}]}]}},s=compactDesktopState({...state(),requests:[{id:1,method:'other',params:{private:'secret'}},q]});assert.equal(s.requests[0],null);assert.deepEqual(JSON.parse(JSON.stringify(s.requests[1].params.questions)),q.params.questions);applyDesktopPatches(s,[{op:'remove',path:['requests',0]}]);assert.equal(s.requests[0].id,42);applyDesktopPatches(s,[{op:'replace',path:['requests'],value:[]}]);assert.deepEqual(s.requests,[]);
});
