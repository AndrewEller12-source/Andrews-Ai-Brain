#!/usr/bin/env node
// Explicit opt-in end-to-end smoke test: real HTTP server + real local Codex account.
// Uses a new temporary application data directory and a disposable project folder.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-live-app-')),project=path.join(dir,'project');fs.mkdirSync(project);
const port=Number(process.env.SMOKE_PORT||4899),base=`http://127.0.0.1:${port}`;let output='';const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,REWSTER_DATA_DIR:path.join(dir,'data'),PORT:String(port)},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
const get=async()=>{const r=await fetch(base+'/api/state');assert.equal(r.status,200);return r.json()};
const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Rewster-Request':'1',Origin:base},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(`${url}: ${result.error}`);return result};
async function until(fn,limit=240000){const start=Date.now();while(Date.now()-start<limit){const result=await fn();if(result)return result;await delay(500)}throw Error('Live application smoke test timed out')}
const report={checkedAt:new Date().toISOString(),appData:path.join(dir,'data'),project,checks:[]};
async function completed(id){let prior;return until(async()=>{const s=await get(),j=s.jobs.find(j=>j.id===id);if(j.status!==prior){console.log('Live app request:',j.status);prior=j.status}if(['failed','uncertain','review','cancelled'].includes(j.status))throw Error(j.error||`Live test stopped at ${j.status}`);return j.status==='completed'?j:false})}
try{
 await until(async()=>{if(child.exitCode!==null)throw Error('Test server exited: '+output);try{const s=await get();return s.connected&&s.account?.status==='signedIn'}catch{return false}},30000);
 const p=await post('/api/projects',{path:project,label:'Disposable application smoke test'});
 const first=await post('/api/intake',{messages:['This is an isolated application smoke test. Only work in the selected current project directory. Do not use network, web, MCP, or any external services. Create app-proof.json with exactly {"created":true,"count":1}, read it back, and report done.'],requestKey:'live-smoke-first',options:{projectId:p.project.projectId}});
 const one=await completed(first.ids[0]);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project,'app-proof.json'),'utf8')),{created:true,count:1});report.checks.push({name:'HTTP intake routes to selected project and completes real file edit',passed:true,threadId:one.threadId,turnId:one.turnId,model:one.model});
 await until(async()=>(await get()).threads.some(t=>t.id===one.threadId),20000);
 const second=await post('/api/intake',{messages:['Continue the same isolated test. Read app-proof.json, change only count from 1 to 2, preserve created:true, and read it back. Do not use network, web, MCP, or external services.'],requestKey:'live-smoke-resume',options:{threadId:one.threadId}});
 const two=await completed(second.ids[0]);assert.equal(two.threadId,one.threadId);assert.notEqual(two.turnId,one.turnId);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project,'app-proof.json'),'utf8')),{created:true,count:2});report.checks.push({name:'HTTP continuation resumes exact existing thread and completes edit',passed:true,threadId:two.threadId,turnId:two.turnId,model:two.model});report.passed=true;
}catch(e){report.passed=false;report.error=e.message;process.exitCode=1}
finally{child.kill('SIGTERM');}
console.log(JSON.stringify(report,null,2));fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));
