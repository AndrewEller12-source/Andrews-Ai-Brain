import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),threadId='desktop-task',turnId='desktop-turn';
function frame(m){const data=Buffer.from(JSON.stringify(m)),head=Buffer.alloc(4);head.writeUInt32LE(data.length);return Buffer.concat([head,data])}
const snapshot=(runtime='active',turn='inProgress',revision=1,currentTurnId=turnId)=>({type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'desktop-owner',params:{hostId:'local',conversationId:threadId,change:{type:'snapshot',revision,conversationState:{id:threadId,title:'Desktop fixture task',threadRuntimeStatus:{type:runtime,activeFlags:[]},turnHistory:{history:{entitiesByKey:{current:{turnId:currentTurnId,status:turn,turnStartedAtMs:1000,durationMs:turn==='completed'?250:null}}}}}}}});
async function until(fn,limit=5000){const start=Date.now();while(Date.now()-start<limit){const r=await fn();if(r)return r;await delay(15)}throw Error('Desktop HTTP condition timed out')}
async function unusedPort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port}
async function environment(t,{recorded='open',initial=snapshot(),requestItems,onNativeRequest}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rw-di-')),home=path.join(dir,'codex'),ipc=path.join(home,'ipc'),data=path.join(dir,'data'),project=path.join(dir,'project'),catalog=path.join(dir,'catalog.json'),rpc=path.join(dir,'rpc.jsonl'),session=path.join(dir,'session.jsonl');fs.mkdirSync(ipc,{recursive:true,mode:0o700});fs.mkdirSync(project);fs.chmodSync(ipc,0o700);
 const entries=[{type:'session_meta',payload:{id:threadId,cwd:project}},{timestamp:'2026-09-05T07:00:00Z',type:'event_msg',payload:{type:'task_started',turn_id:turnId}}];if(recorded==='completed')entries.push({timestamp:'2026-09-05T07:00:01Z',type:'event_msg',payload:{type:'task_complete',turn_id:turnId,last_agent_message:'Historical result'}});fs.writeFileSync(session,entries.map(x=>JSON.stringify(x)).join('\n')+'\n');fs.writeFileSync(catalog,JSON.stringify([{id:threadId,name:'Desktop fixture task',cwd:project,path:session,status:{type:'notLoaded'},updatedAt:Date.now()/1000}]));
 const itemsFile=path.join(dir,'items.json');if(requestItems)fs.writeFileSync(itemsFile,JSON.stringify(requestItems));
 const server=net.createServer(),sockets=new Set(),seen=[];let latest=initial;
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer=Buffer.alloc(0);socket.on('data',c=>{buffer=Buffer.concat([buffer,c]);while(buffer.length>=4){const n=buffer.readUInt32LE();if(buffer.length<n+4)return;const m=JSON.parse(buffer.subarray(4,n+4));buffer=buffer.subarray(n+4);seen.push(m);if(m.type==='request'&&m.method?.startsWith('thread-follower-'))onNativeRequest?.(m,socket);if(m.method==='initialize')socket.write(frame({type:'response',method:'initialize',resultType:'success',result:{clientId:'test-observer'}}));if(m.method==='thread-stream-following-changed'&&m.params.following)socket.write(frame(latest));}})});
 await new Promise(r=>server.listen(path.join(ipc,'ipc.sock'),r));t.after(()=>{for(const s of sockets)s.destroy();server.close();});
 const send=m=>{if(m.params?.change?.type==='snapshot')latest=m;for(const s of sockets)s.write(frame(m))};
 async function launch(){const port=await unusedPort(),base=`http://127.0.0.1:${port}`;let output='';const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),CODEX_HOME:home,REWSTER_DATA_DIR:data,REWSTER_DESKTOP:'1',CODEX_BIN:path.join(root,'tests/fixtures/fake-codex.mjs'),FAKE_CATALOG_FILE:catalog,FAKE_CODEX_LOG:rpc,...(requestItems?{FAKE_ITEMS_FILE:itemsFile}:{})},stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
 const stop=async()=>{if(child.exitCode!==null||child.signalCode)return;child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))};t.after(stop);
 const get=async()=>{const r=await fetch(base+'/api/state');assert.equal(r.status,200);return r.json()};const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Rewster-Request':'1',Origin:base},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}};
 await until(async()=>{if(child.exitCode!==null)throw Error(output);try{const s=await get();return s.connected&&s.desktop.connected&&s.threads.length===1&&s.threads[0].activity.source==='desktop'}catch{return false}});
 return {get,post,stop};}
 const app=await launch();return {...app,send,launch,seen,rpcCalls:()=>fs.readFileSync(rpc,'utf8').trim().split('\n').map(l=>JSON.parse(l))};
}

test('desktop runtime drives HTTP state and a new exact completion produces one persistent acknowledged notification',async t=>{
 const f=await environment(t);assert.equal((await f.get()).threads[0].activity.state,'running');assert.equal((await f.get()).notifications.length,0);
 f.send(snapshot('idle','completed',2));const s=await until(async()=>{const s=await f.get();return s.notifications.length?s:false});assert.equal(s.threads[0].activity.state,'completed');assert.equal(s.notifications.length,1);assert.equal(s.notifications[0].threadId,threadId);assert.equal(s.notifications[0].turnId,turnId);assert.equal(s.notifications[0].completedAt,1250);assert.equal(s.notifications[0].read,false);
 f.send(snapshot('idle','completed',3));await delay(60);assert.equal((await f.get()).notifications.length,1);assert.equal((await f.post('/api/notifications/read',{ids:[s.notifications[0].id]})).status,200);assert.equal((await f.get()).notifications[0].read,true);
 await f.stop();const next=await f.launch();assert.equal((await next.get()).notifications.length,1);assert.equal((await next.get()).notifications[0].read,true);
});
test('completed history at first connection establishes a baseline without notifying',async t=>{
 const f=await environment(t,{recorded:'completed',initial:snapshot('idle','completed')});assert.equal((await f.get()).threads[0].activity.state,'completed');assert.deepEqual((await f.get()).notifications,[]);
});
test('a stale open history record followed by an initial completed desktop snapshot does not flood notifications',async t=>{
 const f=await environment(t,{recorded:'open',initial:snapshot('idle','completed')});assert.equal((await f.get()).threads[0].activity.state,'completed');assert.deepEqual((await f.get()).notifications,[]);
});
test('revision gaps and owner disconnect remove live claims without inventing a completion',async t=>{
 const f=await environment(t);f.send({type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'desktop-owner',params:{hostId:'local',conversationId:threadId,change:{type:'patches',baseRevision:99,revision:100,patches:[{op:'replace',path:['threadRuntimeStatus'],value:{type:'idle',activeFlags:[]}}]}}});
 await until(async()=>(await f.get()).threads[0].activity.state==='unknown');assert.equal((await f.get()).notifications.length,0);
 f.send(snapshot('active','inProgress',101));await until(async()=>(await f.get()).threads[0].activity.state==='running');f.send({type:'broadcast',method:'client-status-changed',params:{clientId:'desktop-owner',status:'disconnected'}});await until(async()=>(await f.get()).threads[0].activity.state==='unknown');assert.equal((await f.get()).notifications.length,0);
});

test('idle desktop continuation uses its exact owner and native receipt without a second app-server execution',async t=>{
 const nextTurnId='native-next-turn';
 const f=await environment(t,{recorded:'completed',initial:snapshot('idle','completed'),onNativeRequest:(m,socket)=>{
  assert.equal(m.method,'thread-follower-start-turn');socket.write(frame(snapshot('active','inProgress',2,nextTurnId)));
  socket.write(frame({type:'response',requestId:m.requestId,method:m.method,handledByClientId:'desktop-owner',resultType:'success',result:{result:{turn:{id:nextTurnId,status:'inProgress'}}}}));
  setTimeout(()=>socket.write(frame(snapshot('idle','completed',3,nextTurnId))),40);
 }});
 const r=await f.post('/api/intake',{messages:['Continue this exact desktop task'],requestKey:'native-continuation',options:{threadId}});assert.equal(r.status,202);const jobId=r.body.ids[0];
 const completed=await until(async()=>{const s=await f.get(),j=s.jobs.find(j=>j.id===jobId);if(['failed','uncertain'].includes(j.status))throw Error(j.error);return j.status==='completed'?s:false});const job=completed.jobs.find(j=>j.id===jobId);assert.equal(job.executionRuntime,'desktop');assert.equal(job.threadId,threadId);assert.equal(job.turnId,nextTurnId);
 const request=f.seen.find(m=>m.method==='thread-follower-start-turn');assert.equal(request.targetClientId,'desktop-owner');assert.equal(request.version,2);assert.equal(request.params.conversationId,threadId);assert.equal(request.params.turnStart.request.clientUserMessageId,jobId);assert.equal(request.params.turnStart.request.input[0].text,'Continue this exact desktop task');assert.equal(request.params.turnStart.context.inheritThreadSettings,true);
 const calls=f.rpcCalls();assert.ok(!calls.some(m=>m.method==='thread/resume'));assert.ok(!calls.some(m=>m.method==='turn/start'&&m.params.threadId===threadId));assert.ok(calls.filter(m=>m.method==='thread/start').every(m=>m.params.ephemeral===true));assert.equal(completed.notifications.filter(n=>n.threadId===threadId&&n.turnId===nextTurnId).length,1);
});

test('an active desktop owner holds a continuation ready without sending native or app-server execution',async t=>{
 const f=await environment(t),r=await f.post('/api/intake',{messages:['Continue after the active turn finishes'],requestKey:'native-waiting',options:{threadId}});assert.equal(r.status,202);
 const job=await until(async()=>{const j=(await f.get()).jobs.find(j=>j.id===r.body.ids[0]);return j.status==='ready'&&j.waitReason?j:false});assert.match(job.waitReason,/active|wait/i);await delay(100);assert.equal((await f.get()).jobs.find(j=>j.id===job.id).status,'ready');
 assert.ok(!f.seen.some(m=>m.method?.startsWith('thread-follower-')));assert.ok(!f.rpcCalls().some(m=>m.method==='thread/resume'||m.method==='turn/start'&&m.params.threadId===threadId));assert.equal((await f.get()).notifications.length,0);
});

test('a different desktop turn cannot become this request receipt while native start confirmation is pending',async t=>{
 let pending;const f=await environment(t,{recorded:'completed',initial:snapshot('idle','completed'),onNativeRequest:(m,socket)=>{pending={m,socket}}});
 const r=await f.post('/api/intake',{messages:['Resume with an exact receipt'],requestKey:'native-receipt-race',options:{threadId}});assert.equal(r.status,202);await until(()=>pending);
 f.send(snapshot('idle','completed',2,'unrelated-desktop-turn'));await delay(30);const waiting=(await f.get()).jobs.find(j=>j.id===r.body.ids[0]);assert.notEqual(waiting.turnId,'unrelated-desktop-turn');assert.notEqual(waiting.status,'completed');
 f.send(snapshot('active','inProgress',3,'confirmed-desktop-turn'));pending.socket.write(frame({type:'response',requestId:pending.m.requestId,method:pending.m.method,handledByClientId:'desktop-owner',resultType:'success',result:{result:{turn:{id:'confirmed-desktop-turn',status:'inProgress'}}}}));
 await until(async()=>(await f.get()).jobs.find(j=>j.id===waiting.id).turnId==='confirmed-desktop-turn');f.send(snapshot('idle','completed',4,'confirmed-desktop-turn'));await until(async()=>(await f.get()).jobs.find(j=>j.id===waiting.id).status==='completed');
});

test('losing the native owner before its receipt leaves the request uncertain and never replays it',async t=>{
 let dispatched=false;const f=await environment(t,{recorded:'completed',initial:snapshot('idle','completed'),onNativeRequest:()=>{dispatched=true}});
 const r=await f.post('/api/intake',{messages:['Native response loss check'],requestKey:'native-response-loss',options:{threadId}});assert.equal(r.status,202);await until(()=>dispatched);
 f.send(snapshot('active','inProgress',2,'unconfirmed-turn'));f.send({type:'broadcast',method:'client-status-changed',params:{clientId:'desktop-owner',status:'disconnected'}});
 const uncertain=await until(async()=>{const j=(await f.get()).jobs.find(j=>j.id===r.body.ids[0]);return j.status==='uncertain'?j:false});assert.equal(uncertain.executionDispatched,true);assert.ok(!uncertain.turnId);assert.equal(uncertain.canRetry,false);assert.equal((await f.post('/api/retry',{id:uncertain.id})).status,400);
 f.send(snapshot('idle','completed',3,'unconfirmed-turn'));await delay(60);assert.equal((await f.get()).jobs.find(j=>j.id===uncertain.id).status,'uncertain');assert.equal(f.seen.filter(m=>m.method==='thread-follower-start-turn').length,1);assert.ok(!f.rpcCalls().some(m=>m.method==='thread/resume'||m.method==='turn/start'&&m.params.threadId===threadId));
});

test('active desktop request text is loaded by exact turn ID with the real start time',async t=>{
 const f=await environment(t,{requestItems:[{turnId:'unrelated',item:{type:'userMessage',content:[{type:'text',text:'Never show this old request'}]}},{turnId,item:{type:'userMessage',content:[{type:'text',text:'Investigate the remaining inventory discrepancy.'}]}}]});
 const current=await until(async()=>{const thread=(await f.get()).threads[0];return thread.currentRequest?.status==='available'?thread:false});assert.equal(current.currentRequest.text,'Investigate the remaining inventory discrepancy.');assert.equal(current.activity.startedAt,1000);assert.equal(current.currentRequest.turnId,turnId);
 assert.ok(f.rpcCalls().some(r=>r.method==='thread/items/list'&&r.params.threadId===threadId&&r.params.turnId===turnId));
 f.send(snapshot('active','inProgress',2,'next-turn'));await until(async()=>{const thread=(await f.get()).threads[0];return thread.activity.turnId==='next-turn'&&thread.currentRequest?.turnId==='next-turn'});assert.equal((await f.get()).threads[0].currentRequest.status,'unavailable');
});
