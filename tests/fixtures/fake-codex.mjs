#!/usr/bin/env node
// Deterministic protocol fixture; never invokes a model or reads a real account.
import readline from 'node:readline';
import fs from 'node:fs';
const threads=new Map(),pending=new Map(); let serial=0,request=10000;
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
const notify=(method,params)=>send({method,params});
const log=m=>{if(process.env.FAKE_CODEX_LOG)fs.appendFileSync(process.env.FAKE_CODEX_LOG,JSON.stringify(m)+'\n')};
function complete(t,status='completed',text='Fixture completed this request.'){
 if(t.timer)clearTimeout(t.timer);t.turn.status=status;t.response=text;
 if(status==='completed')notify('item/completed',{threadId:t.id,turnId:t.turn.id,item:{type:'agentMessage',id:'answer',text}});
 notify('turn/completed',{threadId:t.id,turn:t.turn});
}
readline.createInterface({input:process.stdin}).on('line',line=>{
 let m;try{m=JSON.parse(line)}catch{return} log(m);
 if(!m.method){const t=pending.get(m.id);if(t){pending.delete(m.id);complete(t,m.result?.decision==='decline'?'interrupted':'completed')}return;}
 const p=m.params||{},ok=result=>m.id!==undefined&&send({id:m.id,result});
 switch(m.method){
 case 'initialize':return ok({userAgent:'fixture/1'});
 case 'initialized':return;
 case 'fixture/never':return;
 case 'model/list':return ok({data:[{id:'fixture-model',model:'fixture-model',displayName:'Fixture Model',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'},{reasoningEffort:'high'}]}],nextCursor:null});
 case 'account/read':return ok({account:process.env.FAKE_SIGNED_OUT==='1'?null:{type:'chatgpt',email:'test@example.invalid',planType:'plus'},requiresOpenaiAuth:true});
 case 'account/rateLimits/read':return ok({rateLimits:{primary:{usedPercent:0,windowDurationMins:300,resetsAt:2000000000}},rateLimitsByLimitId:null});
 case 'account/login/start':return setTimeout(()=>ok({type:'chatgpt',loginId:'fixture-login',authUrl:'https://auth.openai.com/fixture-login'}),60);
 case 'account/login/cancel':return ok({status:'canceled'});
 case 'account/logout':return ok({});
 case 'thread/list':return ok({data:[...(process.env.FAKE_CATALOG_FILE?JSON.parse(fs.readFileSync(process.env.FAKE_CATALOG_FILE,'utf8')):[]),...[...threads.values()].filter(t=>!t.ephemeral).map(t=>({id:t.id,name:t.name,preview:'Fixture task',cwd:t.cwd,path:'',status:{type:t.turn?.status==='inProgress'?'active':'idle'},updatedAt:Date.now()/1000,ephemeral:false}))].filter(t=>!!t.archived===!!p.archived),nextCursor:null});
 case 'thread/start':{const t={id:'fixture-thread-'+(++serial),cwd:p.cwd,ephemeral:p.ephemeral,turn:null};threads.set(t.id,t);return ok({thread:t})}
 case 'thread/name/set':threads.get(p.threadId).name=p.name;return ok({});
 case 'thread/resume':{if(!threads.has(p.threadId)&&process.env.FAKE_CATALOG_FILE){const saved=JSON.parse(fs.readFileSync(process.env.FAKE_CATALOG_FILE,'utf8')).find(t=>t.id===p.threadId);if(saved)threads.set(p.threadId,{...saved,turn:null});}return ok({thread:threads.get(p.threadId)});}
 case 'thread/turns/list':return ok({data:threads.get(p.threadId)?.turn?[threads.get(p.threadId).turn]:[],nextCursor:null});
 case 'thread/items/list':if(process.env.FAKE_ITEMS_FILE){const all=JSON.parse(fs.readFileSync(process.env.FAKE_ITEMS_FILE,'utf8')).filter(r=>!p.turnId||r.turnId===p.turnId),start=Number(p.cursor||0),limit=p.limit||100;return ok({data:all.slice(start,start+limit),nextCursor:all.length>start+limit?String(start+limit):null});}return ok({data:[{item:{type:'agentMessage',text:threads.get(p.threadId)?.response||'Fixture response'}}],nextCursor:null});
 case 'turn/steer':{const t=threads.get(p.threadId);if(!t||t.turn?.status!=='inProgress')return send({id:m.id,error:{code:-32602,message:'No active fixture turn'}});if(p.expectedTurnId!==t.turn.id)return send({id:m.id,error:{code:-32602,message:'Active fixture turn changed'}});ok({turnId:t.turn.id});notify('item/completed',{threadId:t.id,turnId:t.turn.id,item:{type:'userMessage',id:'steer-'+(++serial),text:p.input.map(i=>i.text||'').join('\n')}});return}
 case 'turn/start':{
 const t=threads.get(p.threadId);if(!t)return send({id:m.id,error:{message:'Unknown fixture thread'}});
 const previousTurn=t.turn;t.turn={id:'fixture-turn-'+(++serial),status:'inProgress'};ok({turn:t.turn});notify('turn/started',{threadId:t.id,turn:t.turn});
 let prompt=p.input.map(i=>i.text||'').join('\n');
 if(t.ephemeral){let input;try{input=JSON.parse(prompt)}catch{input={request:prompt}};if(p.outputSchema?.properties?.decisions){t.timer=setTimeout(()=>complete(t,'completed',JSON.stringify({decisions:input.tasks.map(task=>{const match=/vending|nayax|restock/i.test(task.title+' '+task.excerpt)&&/vending/i.test(input.universe.name+' '+input.universe.description);return {id:task.id,match,confidence:match?.98:0,reason:match?'Vending operations work':'Unrelated',evidence:match?task.title:''}})})),20);return;}t.timer=setTimeout(()=>complete(t,'completed',JSON.stringify({kind:'task',title:input.request.slice(0,60),department:'Engineering',tier:'standard',projectId:null,threadId:null,confidence:0.98,reason:'Fixture classification.'})),input.request.includes('[slow-route]')?500:10);return}
 if(prompt.includes('[approval]')){const id=++request;pending.set(id,t);setTimeout(()=>send({id,method:'item/commandExecution/requestApproval',params:{threadId:t.id,turnId:t.turn.id,itemId:'fixture-command',command:'echo approved',reason:'Fixture approval check',availableDecisions:['accept','decline']}}),20);return}
 if(prompt.includes('[stale-notification]')&&previousTurn){setTimeout(()=>notify('turn/completed',{threadId:t.id,turn:{...previousTurn,status:'completed'}}),25);setTimeout(()=>send({id:++request,method:'item/commandExecution/requestApproval',params:{threadId:t.id,turnId:previousTurn.id,command:'echo stale'}}),50);}
 if(prompt.includes('[hold]'))return;
 t.timer=setTimeout(()=>complete(t),150);return;
 }
 case 'turn/interrupt':{const t=threads.get(p.threadId);ok({});if(t)complete(t,'interrupted','Interrupted');return}
 default:return send({id:m.id,error:{code:-32601,message:'Fixture unsupported method: '+m.method}});
 }
});
