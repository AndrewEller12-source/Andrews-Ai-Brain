import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
// Read-only follower of the local Codex desktop stream. Never claims ownership or invokes a turn.
// This versioned desktop IPC adapter fails closed when the installed protocol changes.
const VERSION=11,MAX_FRAME=64*1024*1024;
const scalarFields=new Set(['id','title','cwd','parentThreadId','agentNickname','latestModel','rolloutPath','resumeState']);
const turnFields=new Set(['turnId','status','turnStartedAtMs','durationMs']);
const flags=value=>Array.isArray(value)?value.filter(v=>typeof v==='string'):[];
const runtimeSummary=value=>({type:typeof value?.type==='string'?value.type:undefined,activeFlags:flags(value?.activeFlags)});
const safeKey=k=>typeof k==='string'&&!['__proto__','constructor','prototype'].includes(k);
function turnSummary(t){return Object.fromEntries(Object.entries(t||{}).filter(([k,v])=>turnFields.has(k)&&(v===null||['string','number'].includes(typeof v))));}
export function compactDesktopState(s){
 const state=Object.fromEntries([...scalarFields].filter(k=>typeof s?.[k]==='string').map(k=>[k,s[k]]));
 state.threadRuntimeStatus=runtimeSummary(s?.threadRuntimeStatus);
 state.entities={};for(const [k,t]of Object.entries(s?.turnHistory?.history?.entitiesByKey||{}))if(safeKey(k))state.entities[k]=turnSummary(t);
 for(const [i,t]of (s?.turns||[]).entries())state.entities['legacy:'+i]=turnSummary(t);
 return state;
}
export function applyDesktopPatches(state,patches){
 for(const p of patches||[]){if(!['add','remove','replace'].includes(p.op))throw Error('Unsupported desktop patch operation');const a=p.path;if(!Array.isArray(a)||a.some(k=>typeof k==='string'&&!safeKey(k)))throw Error('Invalid desktop patch path');
  if(a.length===0){for(const key of Object.keys(state))delete state[key];Object.assign(state,compactDesktopState(p.op==='remove'?{}:p.value));continue;}
  if(scalarFields.has(a[0])&&a.length===1){if(p.op==='remove')delete state[a[0]];else if(typeof p.value==='string')state[a[0]]=p.value;continue;}
  if(a[0]==='threadRuntimeStatus'){
   if(a.length===1)state.threadRuntimeStatus=runtimeSummary(p.op==='remove'?{}:p.value);
   else if(a[1]==='type')state.threadRuntimeStatus.type=p.op==='remove'?undefined:p.value;
   else if(a[1]==='activeFlags'){if(a.length===2)state.threadRuntimeStatus.activeFlags=flags(p.value);else {const list=state.threadRuntimeStatus.activeFlags||=[],index=Number(a[2]);if(!Number.isInteger(index)||index<0||index>list.length)throw Error('Invalid desktop flag index');if(p.op==='remove')list.splice(index,1);else if(typeof p.value==='string'){if(p.op==='add')list.splice(index,0,p.value);else list[index]=p.value;}}}continue;
  }
  if(a[0]==='turnHistory'&&a.length===1){state.entities=compactDesktopState({turnHistory:p.value}).entities;continue;}
  if(a[0]==='turnHistory'&&a[1]==='history'&&a.length===2){state.entities=compactDesktopState({turnHistory:{history:p.value}}).entities;continue;}
  if(a[0]!=='turnHistory'||a[1]!=='history'||a[2]!=='entitiesByKey')continue;
  if(a.length===3){state.entities=compactDesktopState({turnHistory:{history:{entitiesByKey:p.value}}}).entities;continue;}
  const key=a[3];if(!safeKey(key))throw Error('Invalid desktop entity');
  if(a.length===4){if(p.op==='remove')delete state.entities[key];else state.entities[key]=turnSummary(p.value);}
  else if(a.length===5&&turnFields.has(a[4])){state.entities[key]??={};if(p.op==='remove')delete state.entities[key][a[4]];else state.entities[key][a[4]]=p.value;}
 }
 return state;
}
export function desktopActivity(state,observedAt=Date.now()){
 const turn=Object.values(state.entities||{}).sort((a,b)=>(Number(a.turnStartedAtMs)||0)-(Number(b.turnStartedAtMs)||0)).at(-1);
 const runtime=state.threadRuntimeStatus?.type,flags=state.threadRuntimeStatus?.activeFlags||[];
 const activity=runtime==='active'?(flags.length?'waiting':'running'):runtime==='idle'?(turn?.status==='completed'?'completed':turn?.status==='interrupted'?'interrupted':'idle'):runtime==='systemError'?'interrupted':'unknown';
 return {state:activity,source:'desktop',observedAt,turnId:turn?.turnId||null,turnStatus:turn?.status||null,startedAt:Number.isFinite(turn?.turnStartedAtMs)?turn.turnStartedAtMs:null,completedAt:turn?.status==='completed'&&turn?.turnStartedAtMs!=null&&turn?.durationMs!=null?turn.turnStartedAtMs+turn.durationMs:null,activeFlags:flags};
}
export class DesktopObserver extends EventEmitter{
 constructor({codexHome,socketPath,enabled=true}={}){super();this.path=socketPath||path.join(codexHome,'ipc','ipc.sock');this.enabled=enabled;this.records=new Map();this.wanted=new Set();this.connected=false;this.closed=false;this.error='';this.pending=Buffer.alloc(0);this.clientId=null;this.lastSubscribe=new Map();this.resyncTimers=new Map();}
 start(){if(!this.enabled)return;this.connect();this.timer=setInterval(()=>{if(!this.connected)this.connect();else this.followAll();},15000);this.timer.unref();}
 connect(){if(this.closed||this.socket||!this.enabled)return;try{const st=fs.lstatSync(this.path),dir=fs.lstatSync(path.dirname(this.path));if(!st.isSocket()||st.uid!==process.getuid?.()||dir.uid!==process.getuid?.()||(dir.mode&0o022))throw Error('Desktop socket is not a private local user socket');}catch(e){this.error=e.code==='ENOENT'?'Open Codex desktop to connect live agents':e.message;return;}
  const socket=this.socket=net.connect(this.path);socket.setTimeout(15000);socket.on('connect',()=>this.send({type:'request',requestId:randomUUID(),method:'initialize',version:0,params:{clientType:'rewster-command-observer'}}));
  socket.on('timeout',()=>{if(!this.connected)socket.destroy(Error('Desktop initialization timed out'));});
  socket.on('data',chunk=>{this.pending=Buffer.concat([this.pending,chunk]);try{while(this.pending.length>=4){const n=this.pending.readUInt32LE(0);if(!n||n>MAX_FRAME)throw Error('Desktop frame exceeds supported limit');if(this.pending.length<n+4)break;const m=JSON.parse(this.pending.subarray(4,n+4));this.pending=this.pending.subarray(n+4);this.receive(m);}}catch(e){socket.destroy(e);}});
  socket.on('error',e=>{this.error=e.message;});socket.on('close',()=>{if(this.socket!==socket)return;this.socket=null;this.connected=false;this.clientId=null;this.pending=Buffer.alloc(0);this.lastSubscribe.clear();this.records.clear();this.emit('change');});
 }
 send(m){if(!this.socket?.writable)return;const bytes=Buffer.from(JSON.stringify(m)),head=Buffer.alloc(4);head.writeUInt32LE(bytes.length);this.socket.write(Buffer.concat([head,bytes]));}
 follow(id,following=true){if(!this.connected)return;this.send({type:'broadcast',method:'thread-stream-following-changed',sourceClientId:this.clientId,version:1,params:{conversationId:id,hostId:'local',following}});this.lastSubscribe.set(id,Date.now());}
 setThreads(ids){const next=new Set(ids);for(const id of this.wanted)if(!next.has(id)){this.follow(id,false);this.records.delete(id);this.lastSubscribe.delete(id);}this.wanted=next;this.followAll();}
 requestSnapshot(id){if(Date.now()-(this.lastSubscribe.get(id)||0)>500){this.follow(id);return;}if(this.resyncTimers.has(id))return;const timer=setTimeout(()=>{this.resyncTimers.delete(id);if(this.connected&&this.wanted.has(id)&&!this.records.has(id))this.follow(id)},550);timer.unref();this.resyncTimers.set(id,timer);}
 followAll(){if(!this.connected)return;for(const id of this.wanted)if(!this.lastSubscribe.has(id)||Date.now()-this.lastSubscribe.get(id)>30000)this.follow(id);}
 receive(m){
  if(m.type==='response')this.emit('message',m);
  if(m.type==='response'&&m.method==='initialize'&&m.resultType==='success'){this.clientId=m.result.clientId;this.connected=true;this.error='';this.socket?.setTimeout(0);this.followAll();this.emit('change');return;}
  if(m.type==='client-discovery-request'){this.send({type:'client-discovery-response',requestId:m.requestId,response:{canHandle:false}});return;}
  if(m.type!=='broadcast')return;
  if(m.method==='client-status-changed'){
   if(m.params.status==='disconnected'){for(const [id,r]of this.records)if(r.owner===m.params.clientId){this.records.delete(id);this.lastSubscribe.delete(id);}this.emit('change');}
   if(m.params.status==='connected'){this.lastSubscribe.clear();this.followAll();}return;
  }
  if(m.method==='thread-stream-following-status-requested'&&this.wanted.has(m.params?.conversationId)){this.follow(m.params.conversationId);return;}
  if(m.method!=='thread-stream-state-changed'||m.params?.hostId!=='local'||!this.wanted.has(m.params?.conversationId))return;
  const id=m.params.conversationId,ch=m.params.change;
  if(typeof m.sourceClientId!=='string'||!m.sourceClientId||!Number.isSafeInteger(ch?.revision)||ch.revision<0)return;
  if(ch.type==='snapshot'&&ch.conversationState?.id&&ch.conversationState.id!==id)return;
  if(m.version!==VERSION){this.error='This Codex desktop stream version is not supported';this.records.delete(id);this.emit('change');return;}
  let r=this.records.get(id);
  if(ch?.type==='snapshot'){if(r&&r.owner===m.sourceClientId&&ch.revision<r.revision)return;r={state:compactDesktopState(ch.conversationState),revision:ch.revision,owner:m.sourceClientId};}
  else if(ch?.type==='patches'){
   if(!Number.isSafeInteger(ch.baseRevision)||ch.revision<=ch.baseRevision){this.records.delete(id);this.emit('change');return;}
   if(!r||r.owner!==m.sourceClientId||r.revision!==ch.baseRevision){this.records.delete(id);this.requestSnapshot(id);this.emit('change');return;}
   applyDesktopPatches(r.state,ch.patches);r.revision=ch.revision;
  }else return;
  r.observedAt=Date.now();r.activity=desktopActivity(r.state,r.observedAt);this.records.set(id,r);this.emit('activity',{id,...r});this.emit('change');
 }
 get(id){const r=this.records.get(id);if(!this.connected||!r)return null;return {...r.state,entities:undefined,activity:r.activity};}
 status(){return {connected:this.connected,source:'desktop',protocolVersion:VERSION,observedThreads:this.records.size,error:this.error||null};}
 close(){this.closed=true;clearInterval(this.timer);for(const timer of this.resyncTimers.values())clearTimeout(timer);this.resyncTimers.clear();for(const id of this.wanted)this.follow(id,false);this.socket?.destroy();}
}
