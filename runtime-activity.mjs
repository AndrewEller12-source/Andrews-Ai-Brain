// App-server notifications describe real execution, including children without a
// dashboard job. Collaboration tool snapshots expire; they are not a heartbeat.
export class RuntimeActivity{
 constructor(now=Date.now){this.now=now;this.records=new Map();}
 clear(){this.records.clear();}
 observeCatalog(thread){
  if(thread.status?.type!=='active')return;
  const previous=this.records.get(thread.id);if(previous?.source==='app-server'&&this.now()-previous.observedAt<30000)return;
  const flags=thread.status.activeFlags||[];
  this.records.set(thread.id,{state:flags.some(f=>['waitingOnApproval','waitingOnUserInput'].includes(f))?'waiting':'running',source:'app-server',turnId:null,observedAt:this.now(),expiresAt:this.now()+30000});
 }
 observe(method,p={}){
  const id=p.threadId||p.thread?.id;if(!id)return;
  const previous=this.records.get(id)||{},turnId=p.turn?.id||p.turnId||previous.turnId||null;
  if(method==='turn/started')this.records.set(id,{state:'running',source:'app-server',turnId,observedAt:this.now(),startedAt:this.now()});
  if(method==='turn/completed'&&(!previous.turnId||previous.turnId===turnId))this.records.set(id,{state:p.turn?.status==='completed'?'completed':'interrupted',source:'app-server',turnId,observedAt:this.now()});
  if(method==='thread/status/changed'){
   const status=p.status?.type,flags=p.status?.activeFlags||[];
   this.records.set(id,{...previous,state:status==='active'?(flags.some(f=>['waitingOnApproval','waitingOnUserInput'].includes(f))?'waiting':'running'):status==='idle'?'idle':status==='systemError'?'interrupted':'unknown',source:'app-server',turnId,observedAt:this.now()});
  }
  if(method==='item/completed'&&p.item?.type==='collabAgentToolCall')for(const [child,status] of Object.entries(p.item.agentsStates||{})){
   const value=typeof status==='string'?status:status?.status;
   if(!['running','completed','interrupted','errored','shutdown','pendingInit'].includes(value))continue;
   if(this.records.get(child)?.source==='app-server')continue;
   this.records.set(child,{state:value==='running'?'running':value==='pendingInit'?'waiting':value==='completed'?'completed':'interrupted',source:'collaboration',parentThreadId:id,observedAt:this.now(),expiresAt:this.now()+60000,turnId:null});
  }
 }
 get(id,recorded){const r=this.records.get(id);if(!r||r.expiresAt&&r.expiresAt<this.now())return null;
  if(recorded&&['completed','interrupted'].includes(recorded.recordedStatus)&&recorded.turnId===r.turnId&&Date.parse(recorded.lastEventAt)>r.observedAt)return null;
  return r;
 }
}
export function recentSessionActivity(thread,now=Date.now()){
 const at=Date.parse(thread.activityAt||thread.lastEventAt);
 return Number.isFinite(at)&&now-at>=0&&now-at<45000&&!['completed','interrupted'].includes(thread.recordedStatus)?{at,source:'session-stream',label:'Recent activity · runtime unconfirmed'}:null;
}
