import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const discoveryPolicy=2;
const genericScope=new Set('a an the and or for of to in on my our new world universe workspace workplace business company venture project work working ai artificial intelligence powered power technology tech software app apps agent agents assistant assistants tool tools system systems build building create creating make making start starting help please based automation automated development service services about is it this that with using do we i me want would like driven per month months mrr arr monthly annually annual revenue revenues target targets goal goals profit profits income earning earn earnings dollars money year years million billion thousand successful scalable grow growth'.split(' '));
export function hasDiscoveryContext(profile){const positive=v=>String(v||'').replace(/\b(?:not|exclude|excluding|unrelated|without)\b[^.!?;]*/gi,'');const words=v=>(positive(v).toLowerCase().match(/[a-z]+/g)||[]).filter(w=>w.length>2&&!genericScope.has(w));return words(profile.name).length>0||words(profile.description).length>=2||profile.examples.some(e=>words(e.title+' '+e.request).length>=2);}
const clip=(value,n)=>String(value||'').slice(0,n);
const taskText=(value,n)=>/^\s*(?:Background context supplied by the app:|\{\s*"version"\s*:\s*1\s*,\s*"task")/i.test(String(value||''))?'':clip(value,n);
export function discoveryProfile(data,u,threads){
 const byId=new Map(threads.map(t=>[t.id,t]));const explicitIds=[...new Set([...(u.threadIds||[]),...threads.filter(t=>(u.projectPaths||[]).includes(t.cwd)).map(t=>t.id)])];
 const examples=[...explicitIds.map(id=>byId.get(id)).filter(Boolean).map(t=>({title:taskText(t.title,180),request:taskText(t.preview,500)})),...(data.jobs||[]).filter(j=>j.universeId===u.id&&!j.managerForDepartment&&!j.rewsterReview).slice(-12).map(j=>({title:taskText(j.title,180),request:taskText(j.prompt,500)}))].slice(-16);
 // Learn from owner choices and work sent here, never recursively from automatic guesses.
 return {name:u.name,description:u.description||'',examples,excluded:(u.excludedThreadIds||[]).map(id=>byId.get(id)).filter(Boolean).slice(-12).map(t=>({title:taskText(t.title,180),request:taskText(t.preview,300)}))};
}
export function discoveryCandidates(data,u,threads){
 const internal=new Set((data.jobs||[]).filter(j=>j.rewsterReview||j.managerForDepartment).map(j=>j.threadId));
 const excluded=new Set(u.excludedThreadIds||[]),owned=new Set((data.jobs||[]).filter(j=>j.universeId===u.id).map(j=>j.threadId));
 return threads.filter(t=>!t.catalogMissing&&!internal.has(t.id)&&!excluded.has(t.id)&&!owned.has(t.id)&&!u.threadIds?.includes(t.id)&&!t.parentThreadId).map(t=>({id:t.id,title:taskText(t.title,220),project:clip(t.cwd?.split('/').filter(Boolean).at(-1),100),excerpt:[t.preview,t.currentRequest?.text,t.lastActivity,...(data.jobs||[]).filter(j=>j.threadId===t.id&&!j.managerForDepartment).slice(-3).map(j=>j.prompt)].filter(Boolean).map(v=>taskText(v,1100)).filter(Boolean).join('\n').slice(0,3200)}));
}
export const discoverySchema={type:'object',additionalProperties:false,properties:{decisions:{type:'array',items:{type:'object',additionalProperties:false,properties:{id:{type:'string'},match:{type:'boolean'},confidence:{type:'number'},reason:{type:'string'},evidence:{type:'string'}},required:['id','match','confidence','reason','evidence']}}},required:['decisions']};
export function discoveryOutputSchema(tasks){const {id,...properties}=discoverySchema.properties.decisions.items.properties;const item={type:'object',additionalProperties:false,properties,required:Object.keys(properties)};return {type:'object',additionalProperties:false,properties:{decisions:{type:'object',additionalProperties:false,properties:Object.fromEntries(tasks.map(t=>[t.id,item])),required:tasks.map(t=>t.id)}},required:['decisions']};}
export function normalizeDiscoveryOutput(value){return {decisions:Array.isArray(value?.decisions)?value.decisions:Object.entries(value?.decisions||{}).map(([id,row])=>({...row,id}))};}
export function validateDiscovery(result,candidates){
 const rows=result?.decisions;if(!Array.isArray(rows)||rows.length!==candidates.length)throw Error('Discovery returned an incomplete result ('+(rows?.length??0)+' of '+candidates.length+' tasks)');const byId=new Map(candidates.map(t=>[t.id,t])),seen=new Set(),verified=[];
 const normalize=s=>s.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
 for(const r of rows){const t=byId.get(r.id);if(!t||seen.has(r.id)||typeof r.match!=='boolean'||typeof r.confidence!=='number'||!Number.isFinite(r.confidence)||r.confidence<0||r.confidence>1||typeof r.reason!=='string'||r.reason.length>600||typeof r.evidence!=='string'||r.evidence.length>500)throw Error('Discovery returned an invalid task match');seen.add(r.id);if(r.match&&(!r.reason.trim()||r.evidence.trim().length<8||![t.title,t.excerpt].some(s=>normalize(s).includes(normalize(r.evidence))))){verified.push({...r,match:false,confidence:0,reason:'Supporting source quote could not be verified',evidence:''});continue;}verified.push(r);}
 return verified;
}
export class UniverseDiscovery{
 constructor({store,classify,threads,changed,ready,now=Date.now}){Object.assign(this,{store,classify,threads,changed,ready,now});this.busy=false;this.nextAt=0;this.cursor=0;}
 async tick(){
  if(this.busy||this.now()<this.nextAt||!this.ready())return;
  const data=this.store.data,universes=(data.universes||[]).filter(u=>!u.deletedAt&&u.autoDiscover!==false);if(!universes.length)return;
  const threads=this.threads();let work;
  for(let i=0;i<universes.length;i++){
   const u=universes[(this.cursor+i)%universes.length],profile=discoveryProfile(data,u,threads),profileHash=hash([discoveryPolicy,profile]);u.discoveryChecks??={};
   if(u.discoveryPolicy!==discoveryPolicy){u.automaticMatches={};u.discoveryChecks={};u.discoveryPolicy=discoveryPolicy;this.store.save();this.changed();}
   if(!hasDiscoveryContext(profile)){if(u.discovery?.status!=='needs-context'||Object.keys(u.automaticMatches||{}).length){u.automaticMatches={};u.discoveryChecks={};u.discovery={status:'needs-context',remaining:0,error:null};this.store.save();this.changed();}continue;}
   const candidates=discoveryCandidates(data,u,threads).map(t=>({...t,fingerprint:hash([profileHash,t])}));
   const pending=candidates.filter(t=>u.discoveryChecks[t.id]?.fingerprint!==t.fingerprint&&(this.now()-(u.discoveryChecks[t.id]?.checkedAt||0)>60000||u.discoveryChecks[t.id]?.profileHash!==profileHash));
   if(pending.length){work={u,profile,profileHash,candidates:pending.slice(0,20),remaining:pending.length};this.cursor=(this.cursor+i+1)%universes.length;break;}
   if(u.discovery?.status!=='watching'){u.discovery={...u.discovery,status:'watching',remaining:0,error:null};this.store.save();this.changed();}
  }
  if(!work)return;const {u,profile,profileHash,candidates,remaining}=work;this.busy=true;u.discovery={...u.discovery,status:'scanning',remaining,error:null};this.store.save();this.changed();
  try{
   const result=validateDiscovery(await this.classify({universe:profile,tasks:candidates.map(({fingerprint,...t})=>t)}),candidates);
   // A late response cannot undo a rename, exclusion, disabled discovery or changed owner context.
   if(u.deletedAt||u.autoDiscover===false||hash([discoveryPolicy,discoveryProfile(data,u,this.threads())])!==profileHash)return;
   const fresh=new Map(discoveryCandidates(data,u,this.threads()).map(t=>[t.id,hash([profileHash,t])]));u.automaticMatches??={};
   for(const r of result){const t=candidates.find(t=>t.id===r.id);if(fresh.get(r.id)!==t.fingerprint)continue;u.discoveryChecks[r.id]={fingerprint:t.fingerprint,profileHash,checkedAt:this.now()};if(r.match&&r.confidence>=.95)u.automaticMatches[r.id]={reason:r.reason,evidence:r.evidence,confidence:r.confidence,matchedAt:u.automaticMatches[r.id]?.matchedAt||this.now(),checkedAt:this.now()};else delete u.automaticMatches[r.id];}
   u.discovery={status:remaining>candidates.length?'scanning':'watching',remaining:Math.max(0,remaining-candidates.length),lastScanAt:this.now(),error:null};this.store.save();this.changed();this.nextAt=this.now()+1000;
  }catch(e){u.discovery={...u.discovery,status:'retrying',error:clip(e.message,180),lastAttemptAt:this.now()};this.store.save();this.changed();this.nextAt=this.now()+60000;}
  finally{this.busy=false;}
 }
}
