// Explicit live-account smoke check, isolated from all real business jobs.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-supervisor-live-'));
const base='http://127.0.0.1:4898';
const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4898',REWSTER_DATA_DIR:dir,REWSTER_DESKTOP:'0'},stdio:['ignore','ignore','pipe']});
let log='';child.stderr.on('data',d=>log+=d);
async function until(fn,ms=150000){const end=Date.now()+ms;while(Date.now()<end){const result=await fn();if(result)return result;await delay(1000)}throw Error('Live check timed out');}
const get=async()=>{const res=await fetch(base+'/api/state');return res.json()};
async function post(route,body,auth){const res=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Rewster-Request':'1',...(auth?{Authorization:'Bearer '+auth}:{})},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Error(data.error);return data;}
try{
 await until(async()=>{try{const s=await get();return s.connected&&s.account?.status==='signedIn'}catch{return false}},30000);
 await post('/api/settings',{autoManagers:false});
 const first=await post('/api/intake',{messages:['Isolated integration test: reply exactly "Supervisor connection ready." Do not use tools, change files, browse, or contact any services.'],requestKey:'rewster-live-initial',options:{}});
 const original=await until(async()=>{const s=await get();const j=s.jobs.find(j=>j.id===first.ids[0]);if(['failed','uncertain'].includes(j?.status))throw Error(j.error);return j?.status==='completed'?j:false});
 await until(async()=>(await get()).threads.some(t=>t.id===original.threadId));
 const token=fs.readFileSync(path.join(dir,'rewster-integration.token'),'utf8').trim();
 const receipt=await post('/api/rewster/message',{threadId:original.threadId,message:'Isolated follow-up: reply exactly "Worker follow-up received." Do not use tools, change files, browse or contact services.',reason:'Verify the exact existing thread receives a Rewster message',requestKey:'rewster-live-followup'},token);
 const followup=await until(async()=>{const j=(await get()).jobs.find(j=>j.id===receipt.jobId);if(['failed','uncertain'].includes(j?.status))throw Error(j.error);return j?.status==='completed'?j:false});
 if(followup.threadId!==original.threadId||followup.turnId===original.turnId||!followup.response.includes('Worker follow-up received.'))throw Error('Follow-up receipt mismatch');
 console.log(JSON.stringify({passed:true,check:'Real worker received and completed the exact-thread management follow-up',threadId:followup.threadId,turnId:followup.turnId,approvalMode:followup.approvalMode,reportDirectory:dir}));
}catch(e){console.log(JSON.stringify({passed:false,error:e.message,reportDirectory:dir,diagnostic:log.slice(-1000)}));process.exitCode=1}
finally{child.kill('SIGTERM');}
