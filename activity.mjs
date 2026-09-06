import fs from 'node:fs';
// Recorded JSONL evidence only. Runtime/IPC remains the authority for live execution.
const cache=new Map(),HEAD_BYTES=1024*1024,TAIL_BYTES=768*1024;
const starts=new Set(['task_started','turn_started']);
const ends=new Map([['task_complete','completed'],['task_completed','completed'],['turn_complete','completed'],['turn_completed','completed'],['turn_aborted','interrupted'],['task_aborted','interrupted']]);
const clean=value=>typeof value==='string'?value.slice(0,1200):'';
function rows(text){return text.split('\n').flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}})}
function initial(){return {lastActivity:'No recent assistant message recorded.',activityAt:null,lastEventAt:null,recordedStatus:'unknown',turnId:null,parentThreadId:null,agentName:null,agentPath:null,model:null,source:'session-history',isSubagent:false};}
function textContent(content){return (Array.isArray(content)?content:[]).filter(c=>['text','Text','output_text'].includes(c.type)).map(c=>c.text||'').join('\n');}
export function parseSessionActivity(entries,metadata={}){
 const meta=entries.find(r=>r.type==='session_meta')?.payload||metadata,result=initial();
 const spawn=meta.source?.subagent?.thread_spawn;
 result.parentThreadId=meta.parent_thread_id||spawn?.parent_thread_id||null;
 result.agentName=meta.agent_nickname||spawn?.agent_nickname||null;
 result.agentPath=meta.agent_path||spawn?.agent_path||null;
 result.isSubagent=!!(result.parentThreadId||spawn||meta.thread_source==='subagent');
 result.threadId=meta.id||null;
 const mark=(at)=>{if(at&&(!result.lastEventAt||Date.parse(at)>=Date.parse(result.lastEventAt)))result.lastEventAt=at};
 const activity=(text,at)=>{if(text){result.lastActivity=clean(text);result.activityAt=at||null;mark(at)}};
 for(const row of entries){const p=row.payload||{},at=row.timestamp||null;
  if(p.thread_id&&meta.id&&p.thread_id!==meta.id)continue;
  if(row.type==='turn_context'){
   if(p.turn_id&&p.turn_id!==result.turnId){result.turnId=p.turn_id;result.recordedStatus='possibly_running';}if(p.model)result.model=p.model;mark(at);continue;
  }
  if(row.type==='event_msg'){
   const type=p.type,turn=p.turn_id||p.turnId;
   if(starts.has(type)){result.turnId=turn||null;result.recordedStatus='possibly_running';mark(at);continue}
   if(ends.has(type)){
    // A late completion from a prior turn must not complete the current one.
    if(turn&&result.turnId&&turn!==result.turnId)continue;
    result.turnId=turn||result.turnId;result.recordedStatus=ends.get(type);mark(at);
    if(p.last_agent_message)activity(p.last_agent_message,at);continue;
   }
   if(turn&&result.turnId&&turn!==result.turnId)continue;
   if(type==='thread_settings_applied'){if(p.thread_settings?.model)result.model=p.thread_settings.model;continue}
   if(type==='agent_message'){activity(p.message,at);continue}
   if(type==='item_completed'||type==='item_started'){
    if(turn&&!result.turnId)result.turnId=turn;
    const item=p.item||{},kind=item.type;mark(at);
    if(kind==='AgentMessage'||kind==='agentMessage')activity(item.text||textContent(item.content),at);
    else if(kind==='CommandExecution'||kind==='commandExecution')activity(type==='item_started'?'Running a command':'Command activity recorded',at);
    else if(kind==='McpToolCall'||kind==='mcpToolCall')activity('Using '+[item.server||item.server_name,item.tool||item.tool_name].filter(Boolean).join(' '),at);
    else if(kind==='FileChange'||kind==='fileChange')activity('Workspace file changes recorded',at);
    else if(kind==='WebSearch'||kind==='webSearch')activity('Web search recorded',at);
    continue;
   }
   if(type==='token_count')mark(at);
  }
  if(row.type==='response_item'){
   const turn=p.internal_chat_message_metadata_passthrough?.turn_id;
   if(turn&&result.turnId&&turn!==result.turnId)continue;
   if(p.type==='message'&&p.role==='assistant'&&p.channel!=='analysis')activity(textContent(p.content),at);
   // Display names only: tool arguments/results can contain private input or enormous output.
   else if(['function_call','custom_tool_call'].includes(p.type)&&p.name)activity('Using '+p.name,at);
  }
 }
 return result;
}
export function readSessionActivity(file,{maxTailBytes=TAIL_BYTES}={}){
 if(typeof file!=='string'||!file)return initial();
 let fd;try{
  const stat=fs.statSync(file),stamp=[stat.ino,stat.size,stat.mtimeMs,maxTailBytes].join(':');
  if(cache.get(file)?.stamp===stamp)return {...cache.get(file).value};
  fd=fs.openSync(file,'r');
  const head=Buffer.alloc(Math.min(stat.size,HEAD_BYTES));fs.readSync(fd,head,0,head.length,0);
  const metadata=rows(head.toString()).find(r=>r.type==='session_meta')?.payload||{};
  const size=Math.min(stat.size,Math.max(1024,Math.min(maxTailBytes,8*1024*1024))),start=stat.size-size,tail=Buffer.alloc(size);fs.readSync(fd,tail,0,size,start);
  let text=tail.toString();if(start>0)text=text.slice(text.indexOf('\n')+1);
  const value=parseSessionActivity(rows(text),metadata);value.historyTruncated=start>0;
  cache.set(file,{stamp,value});if(cache.size>2000)cache.delete(cache.keys().next().value);
  return {...value};
 }catch{return initial()}finally{if(fd!==undefined)fs.closeSync(fd)}
}

// Session filenames are creation-date partitioned. Bound discovery to recent dates;
// this supplements omitted subagent catalog entries without scanning conversation text.
export function discoverSessionChildren(codexHome,{days=7,now=Date.now(),maxFiles=400}={}){
 const dates=new Set();for(let i=0;i<Math.min(31,Math.max(1,days));i++){const date=new Date(now-i*86400000);dates.add([date.getUTCFullYear(),String(date.getUTCMonth()+1).padStart(2,'0'),String(date.getUTCDate()).padStart(2,'0')].join('/'));}
 const files=[];for(const date of dates){const dir=`${codexHome}/sessions/${date}`;try{for(const name of fs.readdirSync(dir))if(/^rollout-.*\.jsonl$/.test(name))files.push({path:`${dir}/${name}`,name})}catch{}}
 const children=[];for(const file of files.sort((a,b)=>b.name.localeCompare(a.name)).slice(0,Math.min(1000,Math.max(1,maxFiles)))){
  let fd;try{fd=fs.openSync(file.path,'r');const chunks=[];let offset=0,found=false;
   while(offset<HEAD_BYTES){const b=Buffer.alloc(Math.min(16384,HEAD_BYTES-offset)),read=fs.readSync(fd,b,0,b.length,offset);if(!read)break;const chunk=b.subarray(0,read),end=chunk.indexOf(10);chunks.push(end<0?chunk:chunk.subarray(0,end));offset+=read;if(end>=0){found=true;break}}
   if(!found)continue;const row=JSON.parse(Buffer.concat(chunks).toString());if(row.type!=='session_meta')continue;const meta=row.payload||{},spawn=meta.source?.subagent?.thread_spawn;
   if(!meta.id||!(meta.parent_thread_id||spawn?.parent_thread_id))continue;
   const activity=readSessionActivity(file.path);children.push({id:meta.id,title:activity.agentName||activity.agentPath?.split('/').pop()||'Subagent',cwd:meta.cwd||null,path:file.path,updatedAt:Date.parse(activity.lastEventAt||meta.timestamp)/1000,...activity,discoveredFromSession:true});
  }catch{}finally{if(fd!==undefined)fs.closeSync(fd)}
 }
 return children;
}
