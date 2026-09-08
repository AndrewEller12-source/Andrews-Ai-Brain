// Explicit isolated read-only account test. Never targets business threads.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {CodexBridge} from '../bridge.mjs';import {Store} from '../core.mjs';import {deliverWorkerMessage} from '../rewster-steering.mjs';
if(!process.argv.includes('--run'))throw Error('Explicit --run required.');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-steer-live-')),bridge=new CodexBridge(),store=new Store(path.join(directory,'state.json'));
let threadId,turnId,answer='',finish;
const done=new Promise(r=>finish=r);let timer;
bridge.on('notification',m=>{if(m.params?.threadId!==threadId)return;if(m.method==='item/completed'&&m.params.item?.type==='agentMessage')answer=m.params.item.text;if(m.method==='turn/completed')finish(m.params.turn);});
try{
 await bridge.connect();
 const models=(await bridge.call('model/list',{limit:100})).data;
 const model=models.find(m=>m.model==='gpt-5.6-luna')||models.find(m=>m.isDefault);
 const t=await bridge.call('thread/start',{ephemeral:true,cwd:directory,model:model.model,sandbox:'read-only',approvalPolicy:'never',config:{web_search:'disabled'},developerInstructions:'This is an isolated steering integration test. Do not use tools, change files, access other tasks or contact services. Follow the latest user response-format instruction.'});threadId=t.thread.id;
 const started=await bridge.call('turn/start',{threadId,input:[{type:'text',text:'Explain in a paragraph how to verify a software change. Do not use tools.'}],model:model.model,effort:'low'});turnId=started.turn.id;
 const receipt=await deliverWorkerMessage(store,[{id:threadId,activity:{state:'running',turnId}}],{threadId,expectedTurnId:turnId,requestKey:'live-steering-proof',reason:'Isolated protocol verification',message:'Replace the requested paragraph with exactly: STEERING VERIFIED. Do not use tools.'},{desktopControl:{hasOwner:()=>false},bridge});
 timer=setTimeout(()=>finish(null),30000);const completed=await done;clearTimeout(timer);
 if(receipt.status!=='steered'||completed?.status!=='completed'||!answer.includes('STEERING VERIFIED'))throw Error('Active steering outcome was not verified.');
 console.log(JSON.stringify({passed:true,threadId,turnId,receipt:receipt.status,answer,queuedJobs:store.data.jobs.length,evidenceDirectory:directory}));
}catch(e){console.log(JSON.stringify({passed:false,message:e.message,evidenceDirectory:directory}));process.exitCode=1;}
finally{clearTimeout(timer);if(threadId&&turnId)await bridge.call('turn/interrupt',{threadId,turnId}).catch(()=>{});bridge.close();}
