import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';

// Codex writes flat scalar fields as JSON-compatible strings. Do not interpret
// arbitrary TOML tables or prompt contents as metadata; unsupported files are reported.
export function savedSchedule(text){
 const out={};let multiline=null;
 for(const line of text.split(/\r?\n/)){
  if(multiline){if(line.includes(multiline))multiline=null;continue;}
  const m=line.match(/^([a-z_]+)\s*=\s*(.*?)\s*$/);if(!m)continue;
  const [,key,value]=m;
  if(value.startsWith('"""')||value.startsWith("'''")){const quote=value.slice(0,3);if(!value.slice(3).includes(quote))multiline=quote;continue;}
  if(!['id','name','kind','status','rrule','target_thread_id','created_at','updated_at','prompt'].includes(key))continue;
  try{out[key]=JSON.parse(value);}catch{throw Error('Unsupported schedule metadata');}
 }
 if(!out.id||!out.name||!out.status||!out.rrule)throw Error('Incomplete schedule metadata');
 return out;
}
export function cadence(rule=''){
 const parts=Object.fromEntries(rule.replace(/^RRULE:/,'').split(';').map(p=>p.split('=')));
 const units={MINUTELY:'minute',HOURLY:'hour',DAILY:'day',WEEKLY:'week',MONTHLY:'month'};
 const unit=units[parts.FREQ];if(!unit)return 'Custom schedule';
 const n=Number(parts.INTERVAL||1);let label=`Every ${n===1?'':n+' '}${unit}${n===1?'':'s'}`;
 const days={MO:'Mon',TU:'Tue',WE:'Wed',TH:'Thu',FR:'Fri',SA:'Sat',SU:'Sun'};
 if(parts.BYDAY)label+=' · '+parts.BYDAY.split(',').map(d=>days[d]||d).join(', ');
 if(parts.BYHOUR)label+=' at '+parts.BYHOUR.split(',').map(h=>h.padStart(2,'0')+':'+(parts.BYMINUTE||'0').split(',').map(m=>m.padStart(2,'0')).join('/')).join(', ');
 return label;
}
export async function readScheduledTasks(home){
 const rows=new Map(),warnings=[];let databaseAvailable=false,filesAvailable=false,runRows=[];
 const dbFile=path.join(home,'sqlite','codex-dev.db');
 if(fs.existsSync(dbFile)){
  let db;
  try{
   const {DatabaseSync}=await import('node:sqlite');db=new DatabaseSync(dbFile,{readOnly:true});db.exec('PRAGMA busy_timeout=250');
   const columns=db.prepare('PRAGMA table_info(automations)').all().map(c=>c.name);
   const wanted=['id','name','prompt','status','kind','rrule','target_thread_id','next_run_at','last_run_at','updated_at','created_at'];
   if(!columns.includes('id'))throw Error('Schedule schema unavailable');
   for(const row of db.prepare(`SELECT ${wanted.filter(k=>columns.includes(k)).join(',')} FROM automations LIMIT 2000`).all())rows.set(row.id,row);
   databaseAvailable=true;
   try{runRows=db.prepare('SELECT thread_id,automation_id,status,thread_title,inbox_title,inbox_summary,created_at,updated_at FROM automation_runs ORDER BY created_at DESC LIMIT 2000').all();}catch{warnings.push('Recent run records are unavailable.');}
  }catch{warnings.push('Scheduler timing is unavailable; saved definitions are shown when available.');}finally{db?.close();}
 }
 const directory=path.join(home,'automations');
 try{
  for(const entry of fs.readdirSync(directory,{withFileTypes:true}).slice(0,2000)){
   if(!entry.isDirectory())continue;
   const filename=path.join(directory,entry.name,'automation.toml');
   try{
    if(fs.lstatSync(filename).isSymbolicLink()||fs.statSync(filename).size>262144)throw Error('Unsupported schedule file');
    const file=savedSchedule(fs.readFileSync(filename,'utf8')),stored=rows.get(file.id);
    // Definitions may update before the desktop scheduler refreshes its database.
    if(!stored||Number(file.updated_at)>=Number(stored.updated_at||0)){
     const agrees=stored&&file.rrule===stored.rrule&&file.status===stored.status&&file.target_thread_id===stored.target_thread_id;
     rows.set(file.id,{...stored,...file,next_run_at:agrees?stored.next_run_at:null});
    }
   }catch{warnings.push('One saved schedule could not be read.');}
  }
  filesAvailable=true;
 }catch(e){if(e.code!=='ENOENT')warnings.push('Saved schedule files are unavailable.');}
 const items=[...rows.values()].map(row=>({id:row.id,name:row.name,status:row.status||'UNKNOWN',kind:row.kind||'cron',threadId:row.target_thread_id||null,prompt:String(row.prompt||'').slice(0,16000),cadence:cadence(row.rrule),rule:row.rrule,nextRunAt:row.status==='ACTIVE'?row.next_run_at||null:null,lastRunAt:row.last_run_at||null,updatedAt:row.updated_at||null,runs:runRows.filter(r=>r.automation_id===row.id).slice(0,5).map(r=>({threadId:r.thread_id,title:r.inbox_title||r.thread_title||'Scheduled run',status:r.status,summary:String(r.inbox_summary||'').slice(0,2000),createdAt:r.created_at}))}));
 return {items,checkedAt:Date.now(),status:warnings.length?'partial':databaseAvailable||filesAvailable?'ready':'empty',warnings:[...new Set(warnings)]};
}

// Reading SQLite happens in a bounded child process, never on the chat server's event loop.
export class ScheduledTasks{
 constructor(home,onChange=()=>{}){this.home=home;this.onChange=onChange;this.value={items:[],status:'loading',checkedAt:null,warnings:[]};}
 refresh(){
  if(this.pending)return this.pending;
  this.pending=new Promise(resolve=>execFile(process.execPath,[fileURLToPath(import.meta.url),'--read',this.home],{timeout:5000,maxBuffer:4*1024*1024},(error,stdout)=>{
   try{if(error)throw error;this.value=JSON.parse(stdout);}catch{this.value={...this.value,status:'unavailable',warnings:['Schedule sync is unavailable. Previously loaded schedules may be out of date.']};}
   this.pending=null;this.onChange();resolve(this.value);
  }));return this.pending;
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url)&&process.argv[2]==='--read'){
 readScheduledTasks(process.argv[3]).then(result=>process.stdout.write(JSON.stringify(result))).catch(()=>process.exitCode=1);
}
