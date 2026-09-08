import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function unusedPort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port}
async function fixture(t,{dir=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-http-')),signedOut=false,itemsFile='',catalogFile='',turnsFile='',autoManagers=false}={}){
 const port=await unusedPort(),base=`http://127.0.0.1:${port}`,log=path.join(dir,'rpc.jsonl');let output='';
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,PORT:String(port),REWSTER_DATA_DIR:dir,REWSTER_DESKTOP:'0',CODEX_BIN:path.join(root,'tests/fixtures/fake-codex.mjs'),FAKE_CODEX_LOG:log,FAKE_ITEMS_FILE:itemsFile,FAKE_CATALOG_FILE:catalogFile,FAKE_TURNS_FILE:turnsFile,FAKE_SIGNED_OUT:signedOut?'1':'0'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 const stop=async()=>{if(child.exitCode!==null||child.signalCode)return;child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(2000).then(()=>child.kill('SIGKILL'))])};t.after(stop);
 const get=async()=>{const r=await fetch(base+'/api/state');assert.equal(r.status,200);return r.json()};
 const post=async(url,data,headers={})=>{const res=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Rewster-Request':'1',Origin:base,...headers},body:JSON.stringify(data)});return {status:res.status,body:await res.json()}};
 await until(async()=>{try{const s=await get();return s.connected&&s.lastSync&&s.account.status===(signedOut?'signedOut':'signedIn')}catch{return false}},20000,()=>output);
 await post('/api/settings',{autoManagers});
 return {dir,base,child,stop,get,post,log,output:()=>output};
}
async function until(fn,ms=6000,diagnostic=()=>undefined){const start=Date.now();while(Date.now()-start<ms){const value=await fn();if(value)return value;await delay(20)}throw Error('Condition timed out: '+JSON.stringify(await diagnostic()))}
const intake=(f,prompt,key)=>f.post('/api/intake',{messages:[prompt],requestKey:key});

test('routed department survives refresh and owner reassignment survives restart',async t=>{
 const f=await fixture(t);
 const id=(await intake(f,'Build a website. I own a 3D printer.','incidental-equipment')).body.ids[0];
 const job=await until(async()=>{const s=await f.get(),j=s.jobs.find(j=>j.id===id);return j?.status==='completed'&&s.threads.some(t=>t.id===j.threadId)?j:false});
 // Fixture router deliberately returns broad Engineering. Refresh must preserve it.
 assert.equal(job.department,'Engineering');
 const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(l=>JSON.parse(l));
 assert.ok(calls.some(c=>c.method==='thread/start'&&c.params?.ephemeral&&c.params.developerInstructions.includes('PRIMARY REQUESTED OUTCOME')));
 assert.equal((await f.post('/api/department',{id,department:'Strategy & Management'})).status,200);
 await f.stop();const next=await fixture(t,{dir:f.dir});
 const s=await next.get();assert.equal(s.jobs.find(j=>j.id===id).department,'Strategy & Management');assert.equal(s.threads.find(t=>t.id===job.threadId).department,'Strategy & Management');
});

test('Rewster HTTP integration authenticates, returns exact live state and persists a worker message',async t=>{
 const f=await fixture(t),token=fs.readFileSync(path.join(f.dir,'rewster-integration.token'),'utf8').trim();
 assert.equal((await fetch(f.base+'/api/rewster/status')).status,401);
 const headers={Authorization:'Bearer '+token};
 const status=await (await fetch(f.base+'/api/rewster/status',{headers})).json();assert.equal(status.ok,true);assert.equal(status.connected,true);
 const initial=await intake(f,'Say hello','rewster-initial');
 const source=await until(async()=>{const s=await f.get();return s.jobs.find(j=>j.id===initial.body.ids[0]&&j.status==='completed')});
 const payload={threadId:source.threadId,message:'Clarify the result',reason:'Owner asked for detail',requestKey:'rewster-http-message'};
 const sent=await f.post('/api/rewster/message',payload,headers);assert.equal(sent.status,202,JSON.stringify(sent.body));assert.equal(sent.body.threadId,source.threadId);
 const duplicate=await f.post('/api/rewster/message',payload,headers);assert.equal(duplicate.body.jobId,sent.body.jobId);
 assert.equal((await f.post('/api/rewster/approve',{id:'anything'},headers)).status,404);
});

test('fresh install state and served UI are portable',async t=>{
 const f=await fixture(t),s=await f.get();assert.deepEqual(s.jobs,[]);assert.deepEqual(s.projects,[]);assert.equal(s.account.status,'signedIn');
 for(const p of ['/','/app.js','/style.css']){const r=await fetch(f.base+p);assert.equal(r.status,200);assert.ok((await r.text()).length>100)}
 assert.equal((await fetch(f.base+'/.local/state.json')).status,404);
});

test('50 HTTP intakes persist, retry idempotently, reject conflicts, and survive restart',async t=>{
 const f=await fixture(t);assert.equal((await f.post('/api/settings',{paused:true})).status,200);
 const start=performance.now();const replies=await Promise.all(Array.from({length:50},(_,i)=>intake(f,`Request ${i}`,`http-burst-${i}`)));
 assert.ok(replies.every(r=>r.status===202));assert.equal(new Set(replies.flatMap(r=>r.body.ids)).size,50);const elapsed=performance.now()-start;
 assert.ok((await f.get()).jobs.every(j=>j.status==='queued'));
 const retry=await intake(f,'Request 0','http-burst-0');assert.deepEqual(retry.body.ids,replies[0].body.ids);
 assert.equal((await intake(f,'Changed','http-burst-0')).status,400);assert.equal((await f.get()).jobs.length,50);
 await f.stop();const next=await fixture(t,{dir:f.dir});assert.equal((await next.get()).jobs.length,50);assert.equal((await next.get()).settings.paused,true);
 console.log(`50 concurrent HTTP intake receipts: ${elapsed.toFixed(1)}ms (fixture, no model inference)`);
});

test('queue dispatch honors configured concurrency and drains 50 requests',async t=>{
 const f=await fixture(t);await f.post('/api/settings',{paused:true,concurrency:3});
 const r=await f.post('/api/intake',{messages:Array.from({length:50},(_,i)=>'Perform fixture task '+i),requestKey:'dispatch-burst'});assert.equal(r.status,202);
 await f.post('/api/settings',{paused:false});let maximum=0;
 // This verifies all receipts and the concurrency bound, not host disk speed.
 await until(async()=>{const s=await f.get();const active=s.jobs.filter(j=>['running','starting','review'].includes(j.status)).length;maximum=Math.max(maximum,active);assert.ok(active<=3,`Active count exceeded three: ${active}`);assert.ok(!s.jobs.some(j=>j.status==='failed'),JSON.stringify(s.jobs.filter(j=>j.status==='failed')));return s.jobs.every(j=>j.status==='completed')},60000,()=>f.get());
 assert.ok(maximum>1);assert.equal((await f.get()).jobs.length,50);
});

test('queued, routing, running cancellation and terminal receipts remain coherent',async t=>{
 const f=await fixture(t);await f.post('/api/settings',{paused:true});
 const a=(await intake(f,'Queued cancel','cancel-queued')).body.ids[0];await f.post('/api/cancel',{id:a});assert.equal((await f.get()).jobs.find(j=>j.id===a).status,'cancelled');
 await f.post('/api/settings',{paused:false});const b=(await intake(f,'[slow-route] cancel','cancel-routing')).body.ids[0];
 await until(async()=>(await f.get()).jobs.find(j=>j.id===b).status==='routing');await f.post('/api/cancel',{id:b});await delay(650);assert.equal((await f.get()).jobs.find(j=>j.id===b).status,'cancelled');
 const c=(await intake(f,'[hold] running stop','cancel-running')).body.ids[0];await until(async()=>(await f.get()).jobs.find(j=>j.id===c).status==='running');assert.equal((await f.post('/api/cancel',{id:c})).status,200);await until(async()=>(await f.get()).jobs.find(j=>j.id===c).status==='cancelled');
 const d=(await intake(f,'Complete normally','cancel-terminal')).body.ids[0];await until(async()=>(await f.get()).jobs.find(j=>j.id===d).status==='completed');await f.post('/api/cancel',{id:d});assert.equal((await f.get()).jobs.find(j=>j.id===d).status,'completed');
});

test('pending approval persists in UI until answered and decline stops work',async t=>{
 const f=await fixture(t);const id=(await intake(f,'[approval] Check approval','approval-test')).body.ids[0];
 let s=await until(async()=>{const s=await f.get();return s.approvals.length?s:false});assert.equal(s.jobs.find(j=>j.id===id).status,'review');
 assert.equal((await f.post('/api/approval',{id:s.approvals[0].id,decision:'invented'})).status,400);assert.equal((await f.get()).approvals.length,1);
 assert.equal((await f.post('/api/approval',{id:s.approvals[0].id,decision:'decline'})).status,200);
 await until(async()=>{const s=await f.get();return s.jobs.find(j=>j.id===id).status==='cancelled'&&s.approvals.length===0});
 assert.equal((await f.post('/api/approval',{id:s.approvals[0].id,decision:'accept'})).status,400);
});

test('restart does not automatically replay an in-flight execution',async t=>{
 const f=await fixture(t),id=(await intake(f,'[hold] restart recovery','restart-execution')).body.ids[0];
 const started=await until(async()=>{const j=(await f.get()).jobs.find(j=>j.id===id);return j.status==='running'&&j.turnId?j:false});
 await f.stop();const next=await fixture(t,{dir:f.dir});const j=(await next.get()).jobs.find(j=>j.id===id);assert.equal(j.status,'uncertain');assert.equal(j.threadId,started.threadId);assert.equal(j.turnId,started.turnId);
 assert.equal((await next.post('/api/retry',{id})).status,400);await delay(200);assert.equal((await next.get()).jobs.find(j=>j.id===id).status,'uncertain');
});

test('foreign origins, missing request header, invalid destinations and malformed batch are rejected',async t=>{
 const f=await fixture(t),payload={messages:['Do a thing'],requestKey:'origin-check'};
 assert.equal((await f.post('/api/intake',payload,{Origin:'https://malicious.invalid'})).status,403);
 assert.equal((await fetch(f.base+'/api/intake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).status,403);
 assert.equal((await f.post('/api/intake',{...payload,options:{projectId:'invented'}})).status,400);
 assert.equal((await f.post('/api/intake',{...payload,options:{threadId:'invented'}})).status,400);
 assert.equal((await f.post('/api/intake',{...payload,options:{model:'invented'}})).status,400);
 assert.equal((await f.post('/api/intake',{...payload,messages:['valid','']})).status,400);assert.equal((await f.get()).jobs.length,0);
});

test('signed-out onboarding returns a login link without exposing account tokens',async t=>{
 const f=await fixture(t,{signedOut:true}),s=await f.get();assert.equal(s.account.status,'signedOut');assert.deepEqual(s.jobs,[]);
 const login=await f.post('/api/auth/login',{});assert.equal(login.status,200);assert.match(JSON.stringify(login.body),/https:\/\/auth.openai.com\/fixture-login/);
 assert.ok(!/access_token|refresh_token|id_token/i.test(JSON.stringify(await f.get())));
});

test('explicit task continuation preserves thread identity and records a new turn',async t=>{
 const f=await fixture(t);const id=(await intake(f,'First fixture request','continuation-first')).body.ids[0];
 const first=await until(async()=>{const s=await f.get(),j=s.jobs.find(j=>j.id===id);return j.status==='completed'&&s.threads.some(t=>t.id===j.threadId)?j:false});
 const history=await fetch(f.base+'/api/history?id='+encodeURIComponent(first.threadId));assert.equal(history.status,200);
 const r=await f.post('/api/intake',{messages:['Continue this exact task'],requestKey:'continuation-next',options:{threadId:first.threadId}});assert.equal(r.status,202);
 const next=await until(async()=>{const j=(await f.get()).jobs.find(j=>j.id===r.body.ids[0]);return j.status==='completed'?j:false},6000,()=>f.get());
 assert.equal(next.threadId,first.threadId);assert.notEqual(next.turnId,first.turnId);
});

test('late completion and approval from an older turn cannot overwrite the active continuation',async t=>{
 const f=await fixture(t);const id=(await intake(f,'First task for stale-event test','stale-event-first')).body.ids[0];
 const first=await until(async()=>{const s=await f.get(),j=s.jobs.find(j=>j.id===id);return j.status==='completed'&&s.threads.some(t=>t.id===j.threadId)?j:false});
 const r=await f.post('/api/intake',{messages:['[stale-notification] [hold] Continue'],requestKey:'stale-event-next',options:{threadId:first.threadId}});assert.equal(r.status,202);
 const next=await until(async()=>{const j=(await f.get()).jobs.find(j=>j.id===r.body.ids[0]);return j.status==='running'&&j.turnId?j:false});await delay(150);
 const s=await f.get();assert.equal(s.jobs.find(j=>j.id===next.id).status,'running');assert.equal(s.approvals.length,0);assert.notEqual(next.turnId,first.turnId);
 await f.post('/api/cancel',{id:next.id});
});

test('concurrent login clicks create one provider flow and cancellation permits a new flow',async t=>{
 const f=await fixture(t,{signedOut:true});const replies=await Promise.all(Array.from({length:10},()=>f.post('/api/auth/login',{})));
 assert.ok(replies.every(r=>r.status===200),JSON.stringify(replies));assert.ok(replies.every(r=>r.body.loginId==='fixture-login'));
 const calls=()=>fs.readFileSync(f.log,'utf8').trim().split('\n').map(l=>JSON.parse(l)).filter(m=>m.method==='account/login/start');assert.equal(calls().length,1);
 assert.equal((await f.post('/api/auth/cancel',{})).status,200);assert.equal((await f.post('/api/auth/login',{})).status,200);assert.equal(calls().length,2);
});

test('50 separate HTTP intakes stay responsive while model routing is unfinished',async t=>{
 const f=await fixture(t),start=performance.now();const replies=await Promise.all(Array.from({length:50},(_,i)=>intake(f,`[slow-route] [hold] Independent request ${i}`,`busy-intake-${i}`)));const elapsed=performance.now()-start;
 assert.ok(replies.every(r=>r.status===202));assert.equal(new Set(replies.flatMap(r=>r.body.ids)).size,50);assert.ok(elapsed<10000,`Intake blocked for ${elapsed}ms`);
 const s=await f.get();assert.equal(s.jobs.length,50);assert.ok(s.jobs.some(j=>j.status==='routing'));assert.ok(s.jobs.some(j=>j.status==='queued'));console.log(`50 separate receipts while routing unfinished: ${elapsed.toFixed(1)}ms`);
});

test('workspace identity and personal departments persist without changing task receipts',async t=>{
 const f=await fixture(t);assert.deepEqual((await f.get()).departments,[]);
 assert.equal((await f.post('/api/settings',{workspaceName:'Trey’s Studio',paused:true})).status,200);
 assert.equal((await f.post('/api/departments',{name:'Photo Editing',keywords:'photoshop, lightroom'})).status,200);
 const result=await f.post('/api/intake',{messages:['Retouch in Photoshop'],requestKey:'personal-photo',options:{department:'Photo Editing'}});assert.equal(result.status,202);
 let state=await f.get();assert.deepEqual(state.departments,['Photo Editing']);assert.equal(state.jobs[0].department,'Photo Editing');
 assert.equal((await f.post('/api/settings',{workspaceName:'<script>',concurrency:8})).status,400);assert.equal((await f.get()).settings.concurrency,4);
 await f.stop();const next=await fixture(t,{dir:f.dir});state=await next.get();assert.equal(state.settings.workspaceName,'Trey’s Studio');assert.deepEqual(state.departments,['Photo Editing']);assert.equal(state.jobs[0].id,result.body.ids[0]);
 await next.post('/api/settings',{paused:false});await until(async()=>(await next.get()).jobs[0].status==='completed');assert.equal((await next.get()).jobs[0].department,'Photo Editing');
});

test('photo upload and image-only intake pass actual local image bytes to Codex with durable receipts',async t=>{
 const f=await fixture(t),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 const upload=await fetch(f.base+'/api/attachments?name=Reference.png',{method:'POST',headers:{'X-Rewster-Request':'1',Origin:f.base,'Content-Type':'image/png'},body:png});assert.equal(upload.status,201);const asset=await upload.json();
 const image=await fetch(f.base+asset.url);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
 const input={messages:[''],requestKey:'photo-only-receipt',options:{attachments:[asset.id]}};const r=await f.post('/api/intake',input);assert.equal(r.status,202);
 const j=await until(async()=>{const j=(await f.get()).jobs.find(j=>j.id===r.body.ids[0]);return j?.status==='completed'?j:false});assert.equal(j.attachments[0].id,asset.id);assert.equal(j.prompt,'');
 const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse),turn=calls.find(c=>c.method==='turn/start'&&c.params.threadId===j.threadId);assert.equal(turn.params.input.length,1);assert.equal(turn.params.input[0].type,'localImage');assert.deepEqual(fs.readFileSync(turn.params.input[0].path),png);assert.deepEqual((await f.post('/api/intake',input)).body.ids,r.body.ids);
 assert.equal((await f.post('/api/intake',{...input,messages:['first','second'],requestKey:'bad-photo-batch'})).status,400);assert.equal((await f.post('/api/intake',{...input,options:{attachments:['invented']},requestKey:'missing-photo'})).status,400);
 assert.equal((await fetch(f.base+asset.url,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);assert.equal((await fetch(f.base+'/api/media/invented')).status,404);
 assert.equal((await fetch(f.base+'/api/attachments',{method:'POST',headers:{'X-Rewster-Request':'1',Origin:'https://evil.invalid'},body:png})).status,403);
 const conversation=await fetch(f.base+'/api/conversation?id='+j.threadId);assert.equal(conversation.status,200);assert.ok((await conversation.json()).items.some(i=>i.role==='assistant'));
});

test('approval choices are validated, captured at intake, persisted and applied to resumed turns',async t=>{
 const f=await fixture(t);assert.equal((await f.get()).settings.approvalMode,'manual');
 assert.equal((await f.post('/api/settings',{approvalMode:'anything',paused:true})).status,400);
 assert.equal((await f.get()).settings.paused,false);
 await f.post('/api/settings',{approvalMode:'auto-review',paused:true});
 const queued=await intake(f,'Use automatic reviews','mode-queued');
 await f.post('/api/settings',{approvalMode:'full-auto'});
 assert.equal((await f.get()).jobs.find(j=>j.id===queued.body.ids[0]).approvalMode,'auto-review');
 await f.post('/api/settings',{paused:false});
 await until(async()=>(await f.get()).jobs[0]?.status==='completed');
 const first=(await f.get()).jobs[0];
 const second=await f.post('/api/intake',{messages:['Continue with full auto'],requestKey:'mode-followup',options:{threadId:first.threadId}});
 await until(async()=>(await f.get()).jobs.find(j=>j.id===second.body.ids[0])?.status==='completed');
 const rpc=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);
 const turns=rpc.filter(r=>r.method==='turn/start'&&r.params.clientUserMessageId);
 assert.equal(turns[0].params.approvalsReviewer,'auto_review');assert.equal(turns[0].params.approvalPolicy,'on-request');assert.equal(turns[0].params.sandboxPolicy.type,'workspaceWrite');
 assert.equal(turns[1].params.approvalsReviewer,'user');assert.equal(turns[1].params.approvalPolicy,'never');assert.deepEqual(turns[1].params.sandboxPolicy,{type:'dangerFullAccess'});
 const resumed=rpc.find(r=>r.method==='thread/resume');assert.equal(resumed.params.sandbox,'danger-full-access');
 const routers=rpc.filter(r=>r.method==='thread/start'&&r.params.ephemeral);assert.ok(routers.every(r=>r.params.sandbox==='read-only'&&r.params.approvalPolicy==='never'));
 await f.stop();const restarted=await fixture(t,{dir:f.dir});const s=await restarted.get();assert.equal(s.settings.approvalMode,'full-auto');assert.deepEqual(s.jobs.map(j=>j.approvalMode),['auto-review','full-auto']);
});

test('selecting full auto never answers an already-pending manual request',async t=>{
 const f=await fixture(t);await intake(f,'Please wait [approval]','manual-pending');
 await until(async()=>(await f.get()).approvals.length===1);
 const before=await f.get();await f.post('/api/settings',{approvalMode:'full-auto'});
 const after=await f.get();assert.equal(after.jobs[0].approvalMode,'manual');assert.equal(after.jobs[0].status,'review');assert.equal(after.approvals[0].id,before.approvals[0].id);
 await f.post('/api/approval',{id:after.approvals[0].id,decision:'decline'});
 await until(async()=>(await f.get()).jobs[0].status==='cancelled');
});

test('update handoff refuses active work and shuts down only after the queue is idle',async t=>{
 const f=await fixture(t);await f.post('/api/settings',{paused:true});await intake(f,'Queued update guard','update-guard');
 const blocked=await f.post('/api/update/prepare',{});assert.equal(blocked.status,409);assert.equal(blocked.body.pending,1);assert.equal((await f.get()).jobs[0].status,'queued');
 const job=(await f.get()).jobs[0];await f.post('/api/cancel',{id:job.id});const prepared=await f.post('/api/update/prepare',{});assert.equal(prepared.status,200);assert.equal(prepared.body.ready,true);
 const late=await intake(f,'Arrived while updating','late-update');assert.equal(late.status,400);assert.match(late.body.error,/update/);
 await until(()=>f.child.exitCode!==null||f.child.signalCode);assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'state.json'),'utf8')).jobs.length,1);
});

 test('conversation download serves the registered file and rejects foreign origins and unknown ids',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'output-download-')),file=path.join(dir,'Download for Trey.zip'),itemsFile=path.join(dir,'items.json');
 const content=Buffer.from('fixture archive bytes');fs.writeFileSync(file,content);fs.writeFileSync(itemsFile,JSON.stringify([{item:{id:'download',type:'agentMessage',text:`[Download for Trey](<${file}>)`},turnId:'output-turn'}]));
 const f=await fixture(t,{dir,itemsFile}),id=(await intake(f,'Share download','download-file')).body.ids[0];
 const j=await until(async()=>{const j=(await f.get()).jobs.find(j=>j.id===id);return j.status==='completed'?j:false});
 const history=await (await fetch(f.base+'/api/conversation?id='+j.threadId)).json();const output=history.items.flatMap(i=>i.outputs||[]).find(o=>o.kind==='file');assert.ok(output);
 const response=await fetch(f.base+output.downloadUrl);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),content);
 assert.equal((await fetch(f.base+output.downloadUrl,{headers:{Origin:'https://foreign.invalid','Sec-Fetch-Site':'cross-site'}})).status,403);
 assert.equal((await fetch(f.base+'/api/files/unknown')).status,404);
 });

test('history discovers archived chats and preserves the catalog during restart',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'all-chat-history-')),catalogFile=path.join(dir,'catalog.json');
 fs.writeFileSync(catalogFile,JSON.stringify([{id:'active-chat',name:'Active chat',updatedAt:1},{id:'archived-chat',name:'Archived chat',archived:true,updatedAt:2}]));
 const f=await fixture(t,{dir,catalogFile});let s=await until(async()=>{const snapshot=await f.get();return snapshot.lastSync&&snapshot});assert.deepEqual(s.threads.map(t=>t.id).sort(),['active-chat','archived-chat']);assert.equal(s.threads.find(t=>t.id==='archived-chat').archived,true);
 const rpc=fs.readFileSync(f.log,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(m=>m.method==='thread/list');assert.ok(rpc.some(m=>m.params.archived===true));assert.ok(rpc.every(m=>Array.isArray(m.params.modelProviders)&&m.params.modelProviders.length===0));
 await f.stop();fs.writeFileSync(catalogFile,'[]');const next=await fixture(t,{dir,catalogFile});s=await until(async()=>{const snapshot=await next.get();return snapshot.lastSync&&snapshot});assert.ok(s.threads.some(t=>t.id==='active-chat'&&t.catalogMissing));assert.ok(s.threads.some(t=>t.id==='archived-chat'));
});


test('automatic manager reviews run as real read-only tasks and never recurse',async t=>{
 const f=await fixture(t,{autoManagers:true});const id=(await intake(f,'Build a fixture dashboard','manager-source')).body.ids[0];
 const job=await until(async()=>{const s=await f.get();return s.jobs.find(j=>j.sourceJobId===id&&j.status==='completed')},12000,()=>f.get());
 const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);
 const name=calls.find(c=>c.method==='thread/name/set'&&c.params.threadId===job.threadId);
 assert.match(name.params.name,/manager/);const start=calls.filter(c=>c.method==='thread/start'&&!c.params.ephemeral).at(-1);assert.equal(start.params.sandbox,'read-only');assert.equal(start.params.approvalPolicy,'never');
 const turn=calls.find(c=>c.method==='turn/start'&&c.params.threadId===job.threadId);assert.deepEqual(turn.params.sandboxPolicy,{type:'readOnly'});assert.equal(turn.params.approvalPolicy,'never');
 assert.ok((await f.get()).managers.some(m=>m.threadId===job.threadId&&m.status==='completed'));await delay(400);assert.equal((await f.get()).jobs.filter(j=>j.managerForDepartment).length,1);
});

test('universe HTTP lifecycle persists empty worlds and scopes router catalogs and continuations',async t=>{
 const f=await fixture(t);await f.post('/api/settings',{paused:true});
 const created=await f.post('/api/universes',{name:'Vending Business',description:'Vending routes and stock'});assert.equal(created.status,200);const universeId=created.body.id;
 let state=await f.get();assert.deepEqual(state.universes[0].threadIds,[]);assert.deepEqual(state.universes[0].departments,[]);
 const outside=await intake(f,'Unrelated work','outside-world');const receipt=await f.post('/api/intake',{messages:['Restock vending'],requestKey:'inside-world',options:{universeId}});assert.equal(receipt.status,202);
 assert.equal((await f.post('/api/intake',{messages:['Bad world'],requestKey:'bad-world-id',options:{universeId:'missing'}})).status,400);
 await f.post('/api/settings',{paused:false});
 const done=await until(async()=>{const s=await f.get();return s.jobs.find(j=>j.id===receipt.body.ids[0]&&j.status==='completed')});
 await until(async()=>{const s=await f.get();return s.universes[0].threadIds.includes(done.threadId)});
 state=await f.get();assert.ok(state.jobs.some(j=>j.id===outside.body.ids[0]));assert.deepEqual(state.universes[0].jobIds,[done.id]);
 const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);const catalog=calls.filter(c=>c.method==='turn/start').map(c=>{try{return JSON.parse(c.params.input[0].text)}catch{return null}}).find(c=>c?.universe?.name==='Vending Business');assert.ok(catalog);assert.deepEqual(catalog.threads,[]);assert.deepEqual(catalog.projects,[]);
 const follow=await f.post('/api/intake',{messages:['Continue here'],requestKey:'world-followup',options:{threadId:done.threadId}});assert.equal(follow.status,202);assert.equal((await f.get()).jobs.find(j=>j.id===follow.body.ids[0]).universeId,universeId);
 await f.post('/api/settings',{paused:true});await f.stop();const next=await fixture(t,{dir:f.dir});assert.equal((await next.get()).universes[0].id,universeId);
});

test('creating a universe automatically discovers old work and later new native tasks without starting worker jobs',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'discovery-http-')),catalogFile=path.join(dir,'catalog.json');
 const catalog=[{id:'old-payment',name:'Reconcile Nayax settlements',preview:'Card-reader settlements for vending machines',cwd:dir,path:'',updatedAt:1},{id:'photo',name:'Retouch wedding photos',preview:'Photoshop work',cwd:dir,path:'',updatedAt:1}];fs.writeFileSync(catalogFile,JSON.stringify(catalog));
 const f=await fixture(t,{dir,catalogFile});const created=await f.post('/api/universes',{name:'Vending Business'});assert.equal(created.status,200);
 let u=await until(async()=>{const s=await f.get();return s.universes.find(u=>u.id===created.body.id&&u.automaticMatches?.['old-payment'])},10000,()=>f.get());
 assert.deepEqual(u.threadIds,['old-payment']);assert.match(u.automaticMatches['old-payment'].reason,/Vending/);assert.equal((await f.get()).jobs.length,0);assert.equal((await f.get()).threads.length,2);
 catalog.push({id:'new-route',name:'Plan vending service routes',preview:'Visit machine locations',cwd:dir,path:'',updatedAt:2});fs.writeFileSync(catalogFile,JSON.stringify(catalog));
 u=await until(async()=>{const s=await f.get();return s.universes.find(u=>u.automaticMatches?.['new-route'])},15000,()=>f.get());assert.equal(u.threadIds.length,2);
 await f.post('/api/universes',{id:u.id,name:u.name,autoDiscover:true,excludedThreadIds:['old-payment']});u=(await f.get()).universes[0];assert.equal(u.threadIds.includes('old-payment'),false);assert.equal(u.threadIds.includes('new-route'),true);
 assert.equal((await f.get()).jobs.length,0);
});

test('deleted universes remain recoverable and do not interrupt their existing queue',async t=>{
 const f=await fixture(t);await f.post('/api/settings',{paused:true});const u=(await f.post('/api/universes',{name:'AI business',autoDiscover:false})).body;
 const job=(await f.post('/api/intake',{messages:['Draft a clinic receptionist offer'],requestKey:'delete-world-queue',options:{universeId:u.id}})).body.ids[0];assert.equal((await f.post('/api/universes/delete',{id:u.id})).status,200);let s=await f.get();assert.equal(s.universes.length,0);assert.equal(s.deletedUniverses[0].id,u.id);assert.equal(s.jobs.find(j=>j.id===job).status,'queued');assert.equal((await f.post('/api/intake',{messages:['Do not enter deleted world'],requestKey:'deleted-world-reject',options:{universeId:u.id}})).status,400);await f.post('/api/settings',{paused:false});await until(async()=>(await f.get()).jobs.find(j=>j.id===job)?.status==='completed');assert.equal((await f.post('/api/universes/delete',{id:u.id,restore:true})).status,200);s=await f.get();assert.ok(s.universes[0].jobIds.includes(job));
});


test('paused work survives restart and resumes one new turn in the same conversation',async t=>{
 const f=await fixture(t);const id=(await intake(f,'[hold] Preserve the existing workspace','pause-resume-work')).body.ids[0];
 const active=await until(async()=>{const j=(await f.get()).jobs.find(j=>j.id===id);return j.status==='running'?j:false});
 assert.equal((await f.post('/api/pause-task',{id})).status,200);
 const paused=await until(async()=>{const j=(await f.get()).jobs.find(j=>j.id===id);return j.status==='paused'?j:false});
 assert.equal(paused.turnId,active.turnId);assert.equal(paused.canResume,true);assert.equal((await f.get()).approvals.length,0);
 const catalogFile=path.join(f.dir,'resume-catalog.json'),turnsFile=path.join(f.dir,'resume-turns.json');
 fs.writeFileSync(catalogFile,JSON.stringify([{id:active.threadId,name:active.title,cwd:active.cwd,preview:'Saved work',status:{type:'idle'}}]));
 fs.writeFileSync(turnsFile,JSON.stringify([{threadId:active.threadId,id:active.turnId,status:'interrupted'}]));
 await f.stop();const next=await fixture(t,{dir:f.dir,catalogFile,turnsFile});
 assert.equal((await next.get()).jobs.find(j=>j.id===id).status,'paused');
 const replies=await Promise.all([next.post('/api/resume-task',{id}),next.post('/api/resume-task',{id})]);
 assert.ok(replies.every(r=>r.status===202),JSON.stringify(replies));assert.equal(replies[0].body.id,replies[1].body.id);
 const resumed=await until(async()=>{const j=(await next.get()).jobs.find(j=>j.id===replies[0].body.id);return j.status==='completed'?j:false});
 assert.equal(resumed.threadId,active.threadId);assert.equal(resumed.cwd,active.cwd);assert.equal(resumed.approvalMode,active.approvalMode);assert.equal(resumed.resumeOf,id);
 const calls=fs.readFileSync(next.log,'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(calls.filter(c=>c.method==='turn/start'&&c.params.clientUserMessageId===resumed.id).length,1);
 assert.ok(calls.some(c=>c.method==='thread/resume'&&c.params.threadId===active.threadId));
});

test('startup recovers exact outcomes without replaying completed or open turns',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-recovery-')),catalogFile=path.join(dir,'catalog.json'),turnsFile=path.join(dir,'turns.json');
 const statuses=['completed','interrupted','inProgress'];
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({jobs:statuses.map((_,i)=>({id:'saved-'+i,status:'running',threadId:'thread-'+i,turnId:'turn-'+i,prompt:'Saved request',title:'Saved '+i,executionDispatched:true,options:{},events:[]})),settings:{autoManagers:false},projects:[],overrides:{}}));
 fs.writeFileSync(catalogFile,JSON.stringify(statuses.map((_,i)=>({id:'thread-'+i,name:'Saved '+i,preview:'Saved',status:{type:'idle'}}))));
 fs.writeFileSync(turnsFile,JSON.stringify(statuses.map((status,i)=>({threadId:'thread-'+i,id:'turn-'+i,status}))));
 const f=await fixture(t,{dir,catalogFile,turnsFile});
 const s=await until(async()=>{const s=await f.get();return s.jobs[1].status==='paused'?s:false});
 assert.deepEqual(s.jobs.map(j=>j.status),['completed','paused','uncertain']);
 assert.equal((await f.post('/api/resume-task',{id:'saved-2'})).status,400);
 assert.equal(fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse).filter(c=>c.method==='turn/start').length,0);
});

test('pausing queued work never dispatches it and resume preserves its original receipt',async t=>{
 const f=await fixture(t);await f.post('/api/settings',{paused:true});const id=(await intake(f,'Saved queue request','paused-queue-request')).body.ids[0];
 assert.equal((await f.post('/api/pause-task',{id})).status,200);assert.equal((await f.get()).jobs[0].status,'paused');
 const r=await f.post('/api/resume-task',{id});assert.equal(r.status,202);assert.equal(r.body.id,id);assert.equal((await f.get()).jobs.length,1);assert.equal((await f.get()).jobs[0].status,'queued');
});

test('HEIC upload serves a JPEG and resumes its registered attachment after restart',{skip:process.platform!=='darwin'},async t=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),run=promisify(execFile);
 const f=await fixture(t),input=path.join(f.dir,'photo.png'),heic=path.join(f.dir,'photo.heic');
 fs.writeFileSync(input,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
 await run('/usr/bin/sips',['-z','120','160',input,'--out',input]);await run('/usr/bin/sips',['-s','format','heic',input,'--out',heic]);
 const response=await fetch(f.base+'/api/attachments?name=Phone.HEIC',{method:'POST',headers:{'X-Rewster-Request':'1',Origin:f.base,'Content-Type':'application/octet-stream'},body:fs.readFileSync(heic)});
 assert.equal(response.status,201);const asset=await response.json();assert.equal(asset.mime,'image/jpeg');assert.equal(asset.name,'Phone.jpg');
 const image=await fetch(f.base+asset.url);assert.equal(image.headers.get('content-type'),'image/jpeg');const jpeg=Buffer.from(await image.arrayBuffer());assert.equal(jpeg.readUInt16BE(0),0xffd8);
 await f.stop();const next=await fixture(t,{dir:f.dir});const result=await next.post('/api/intake',{messages:['Inspect this photo'],requestKey:'heic-saved',options:{attachments:[asset.id]}});assert.equal(result.status,202);
 const job=await until(async()=>{const j=(await next.get()).jobs.find(j=>j.id===result.body.ids[0]);return j?.status==='completed'&&j});
 const calls=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse),turn=calls.find(c=>c.method==='turn/start'&&c.params.threadId===job.threadId);
 const photo=turn.params.input.find(i=>i.type==='localImage');assert.ok(photo.path.endsWith('.jpg'));assert.deepEqual(fs.readFileSync(photo.path),jpeg);
});
