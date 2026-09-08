// Opt-in live-account test. All file changes stay inside one temporary fixture.
// The defect is deliberately seeded AFTER the first worker finishes.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {CodexBridge} from '../bridge.mjs';import {Store,chooseModel} from '../core.mjs';
import {queueSupervisorReviews,processReviews} from '../rewster-supervisor.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-review-live-'));
const workspace=path.join(dir,'fixture');fs.mkdirSync(workspace);
// A trusted baseline lets the reviewer verify the no-other-files requirement.
fs.writeFileSync(path.join(workspace,'result.txt'),'PENDING\n');
execFileSync('git',['init','-q',workspace]);
execFileSync('git',['-C',workspace,'add','result.txt']);
execFileSync('git',['-C',workspace,'-c','user.name=Rewster test','-c','user.email=rewster-test@example.invalid','commit','-qm','Isolated fixture baseline']);
const store=new Store(path.join(dir,'state.json'));store.data.settings.rewsterSupervisor={enabled:true,autoCorrect:true,enabledAt:1};
const bridge=new CodexBridge();const waiting=new Map();
bridge.on('request',m=>bridge.reply(m.id,{decision:'decline'}));
bridge.on('notification',m=>{
 const p=m.params||{},w=waiting.get(p.threadId);if(!w)return;
 if(m.method==='item/completed'&&p.item?.type==='agentMessage')w.response=p.item.text;
 if(m.method==='turn/completed'){clearTimeout(w.timer);waiting.delete(p.threadId);p.turn.status==='completed'?w.resolve({turnId:p.turn.id,response:w.response}):w.reject(Error(p.turn.error?.message||p.turn.status));}
});
async function run(threadId,prompt,readOnly,model){
 const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(threadId);reject(Error('Live review test timed out'))},180000);waiting.set(threadId,{resolve,reject,timer,response:''});});done.catch(()=>{});
 await bridge.call('turn/start',{threadId,model:model.model,effort:model.defaultReasoningEffort,
  approvalPolicy:'never',sandboxPolicy:readOnly?{type:'readOnly'}:{type:'workspaceWrite',writableRoots:[workspace],networkAccess:false},input:[{type:'text',text:prompt}]});
 return done;
}
async function reviewer(job,model){
 const result=await bridge.call('thread/start',{cwd:workspace,model:model.model,sandbox:'read-only',approvalPolicy:'never',
  developerInstructions:'Isolated Rewster review test. Inspect only this fixture folder. No external services, messages or actions. Return the requested JSON.'});
 const outcome=await run(result.thread.id,job.prompt,true,model);
 store.update(job.id,{status:'completed',threadId:result.thread.id,...outcome});processReviews(store);
}
try {
 await bridge.connect();const models=(await bridge.call('model/list',{limit:100})).data,model=chooseModel('standard',models);
 const worker=await bridge.call('thread/start',{cwd:workspace,model:model.model,sandbox:'workspace-write',approvalPolicy:'never',
  developerInstructions:'This is an isolated local test. Only create or edit result.txt in this fixture folder. Do not contact services, start agents or change any other file.'});
 const request='Create result.txt containing exactly READY followed by a newline. Do not change any other files. Verify its actual contents.';
 const initial=await run(worker.thread.id,request,false,model);
 if(fs.readFileSync(path.join(workspace,'result.txt'),'utf8')!=='READY\n')throw Error('Initial fixture worker did not create the expected file');
 const [source]=store.accept([request],'isolated-review-source',{});store.update(source.id,{...initial,threadId:worker.thread.id,cwd:workspace,status:'completed',completedAt:Date.now(),title:'Isolated result file'});
 fs.writeFileSync(path.join(workspace,'result.txt'),'BROKEN\n');
 console.log('Worker finished. Seeded a known defect in the isolated fixture.');
 const [review]=queueSupervisorReviews(store,models);await reviewer(review,model);
 if(source.quality?.verdict!=='needs_changes'||!source.quality.correctionJobId)throw Error('Reviewer did not identify and route the seeded defect');
 const correction=store.data.jobs.find(j=>j.id===source.quality.correctionJobId);
 if(correction.options.threadId!==worker.thread.id)throw Error('Correction targeted the wrong worker');
 console.log('Reviewer found the defect. Task Manager queued a correction for the exact original worker.');
 const fixed=await run(worker.thread.id,correction.prompt,false,model);
 store.update(correction.id,{...fixed,threadId:worker.thread.id,cwd:workspace,title:'Isolated result file',status:'completed',completedAt:Date.now()});
 if(fs.readFileSync(path.join(workspace,'result.txt'),'utf8')!=='READY\n')throw Error('Correction did not fix the fixture');
 const [second]=queueSupervisorReviews(store,models);await reviewer(second,model);
 if(correction.quality?.verdict!=='pass'||correction.quality.correctionJobId)throw Error('Corrected work did not pass review without further mutation');
 console.log(JSON.stringify({passed:true,workerThreadId:worker.thread.id,correctionTurnId:fixed.turnId,reviewVerdict:correction.quality.verdict,checks:correction.quality.checks,reportDirectory:dir}));
}catch(error){console.log(JSON.stringify({passed:false,error:error.message,reportDirectory:dir}));process.exitCode=1;}
finally{for(const w of waiting.values())clearTimeout(w.timer);bridge.close();}
