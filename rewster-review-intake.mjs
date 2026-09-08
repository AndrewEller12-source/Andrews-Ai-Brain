import {createHash} from 'node:crypto';
import {extractTurnRequest} from './turn-request.mjs';

export function internalRewsterTask(task={}) {
  return task.rewsterReview===true || !!task.managerForDepartment ||
    /^Background context supplied by the app\s*:|^Rewster review\s*—/.test(task.title||'') ||
    /(?:^|[/\\])Rewster Local[/\\]agent-workspace(?:[/\\]|$)/.test(task.cwd||'');
}

// Only completion receipts observed by the manager enter this queue. Reading
// history never resumes a worker, changes a turn, or invents a completed job.
export class ReviewIntake {
  constructor({store,call,getThreads}) {Object.assign(this,{store,call,getThreads});this.busy=false;}
  async tick(now=Date.now()) {
    const data=this.store.data,policy=data.settings.rewsterSupervisor;
    if(this.busy||!policy?.enabled)return;
    this.busy=true;
    try {
      data.rewsterReviewIntake??={};
      const threads=this.getThreads(),byId=new Map(threads.map(t=>[t.id,t]));
      const candidates=(data.notifications||[]).filter(n=>n.completedAt>=policy.enabledAt&&n.threadId&&n.turnId)
        .sort((a,b)=>a.completedAt-b.completedAt);
      let reads=0;
      for(const n of candidates) {
        const previous=data.rewsterReviewIntake[n.id];
        if(previous?.done||previous?.nextAttemptAt>now)continue;
        const task=byId.get(n.threadId),existing=data.jobs.find(j=>j.threadId===n.threadId&&j.turnId===n.turnId);
        if(internalRewsterTask(n)||internalRewsterTask(task)||internalRewsterTask(existing)){
          data.rewsterReviewIntake[n.id]={done:true,state:'excluded'};continue;
        }
        if(existing?.response){data.rewsterReviewIntake[n.id]={done:true,state:'loaded',jobId:existing.id};continue;}
        if(reads++>=2)break;
        try {
          if(!task||task.archived||task.catalogMissing)throw Error('The original task is not available for review');
          let cursor,turn;
          for(let page=0;page<10;page++){
            const result=await this.call('thread/turns/list',{threadId:n.threadId,limit:100,itemsView:'notLoaded',sortDirection:'desc',...(cursor?{cursor}:{})});
            turn=result.data?.find(t=>t.id===n.turnId);cursor=result.nextCursor;if(turn||!cursor)break;
          }
          if(turn?.status!=='completed')throw Error('The exact completed turn could not be verified');
          cursor=undefined;const rows=[];
          for(let page=0;page<10;page++){
            const result=await this.call('thread/items/list',{threadId:n.threadId,turnId:n.turnId,limit:100,sortDirection:'desc',...(cursor?{cursor}:{})});
            rows.push(...(result.data||[]));cursor=result.nextCursor;if(!cursor)break;
          }
          if(cursor)throw Error('The exact turn is too large to review completely');
          const request=extractTurnRequest(rows,n.turnId);
          const messages=rows.filter(r=>!r.turnId||r.turnId===n.turnId).map(r=>r.item||r).filter(i=>i.type==='agentMessage'&&i.text);
          const answer=messages.find(i=>i.phase==='final_answer')||messages[0];
          if(!request.text||!answer?.text)throw Error('The original request or final answer is missing');
          if(request.text.length>30000||answer.text.length>32000)throw Error('The original request or output exceeds the complete review limit');
          if(internalRewsterTask({title:request.text})){data.rewsterReviewIntake[n.id]={done:true,state:'excluded'};continue;}
          // Recheck after asynchronous reads: a dashboard completion may have arrived.
          let source=data.jobs.find(j=>j.threadId===n.threadId&&j.turnId===n.turnId);
          if(!source){
            const id='observed-'+createHash('sha256').update(JSON.stringify([n.threadId,n.turnId])).digest('hex');
            source={id,threadId:n.threadId,turnId:n.turnId,status:'completed',observedOnly:true,
              origin:'observed',createdAt:n.completedAt,completedAt:n.completedAt,events:[],options:{},
              prompt:request.text,title:n.title||task.title,department:n.department||task.department,
              cwd:task.cwd,approvalMode:'manual'};
            data.jobs.push(source);
          }
          if(source.status!=='completed')throw Error('The source outcome changed during review intake');
          source.response=answer.text;
          data.rewsterReviewIntake[n.id]={done:true,state:'loaded',jobId:source.id};
        }catch(error){
          const attempts=(previous?.attempts||0)+1;
          data.rewsterReviewIntake[n.id]={state:'needs_owner',reason:error.message,attempts,
            nextAttemptAt:now+Math.min(3600000,30000*2**Math.min(attempts-1,7))};
        }
      }
      // Retain receipts only while their bounded source notification remains.
      const kept=new Set((data.notifications||[]).map(n=>n.id));
      for(const id of Object.keys(data.rewsterReviewIntake))if(!kept.has(id))delete data.rewsterReviewIntake[id];
      this.store.save();
    }finally{this.busy=false;}
  }
}
