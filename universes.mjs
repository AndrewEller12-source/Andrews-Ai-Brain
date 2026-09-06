import {randomUUID} from 'node:crypto';
import {cleanName,departmentCatalog} from './organization.mjs';
export function universeById(data,id){if(!id)return null;const u=(data.universes||[]).find(u=>u.id===id);if(!u)throw Error('Universe unavailable. Choose an existing universe.');return u;}
export function saveUniverse(data,input,projects=[],threads=[]){
 data.universes??=[];const old=input.id?universeById(data,input.id):null;
 const name=cleanName(input.name,'Universe');if(data.universes.some(u=>u.id!==old?.id&&u.name.toLowerCase()===name.toLowerCase()))throw Error('A universe with this name already exists');
 const description=typeof input.description==='string'?input.description.trim():'';if(description.length>1200)throw Error('Keep the universe description under 1,200 characters');
 const ids=(value,known,label)=>{if(value===undefined)return undefined;if(!Array.isArray(value)||value.length>1000||value.some(id=>typeof id!=='string'||!known.has(id)))throw Error('Unknown '+label+' selected');return [...new Set(value)];};
 if(input.autoDiscover!==undefined&&typeof input.autoDiscover!=='boolean')throw Error('Choose whether discovery is enabled');
 const excludedThreadIds=ids(input.excludedThreadIds,new Set(threads.map(t=>t.id)),'excluded task');
 const projectIds=ids(input.projectIds,new Set(projects.map(p=>p.projectId)),'project'),threadIds=ids(input.threadIds,new Set([...threads.map(t=>t.id),...(data.jobs||[]).map(j=>j.threadId).filter(Boolean)]),'task');
 if(!old&&data.universes.length>=100)throw Error('Maximum of 100 universes');
 const u=old||{id:randomUUID(),createdAt:Date.now(),projectIds:[],threadIds:[],customDepartments:[],departmentManagers:{}};
 Object.assign(u,{name,description,autoDiscover:input.autoDiscover??u.autoDiscover??true,...(excludedThreadIds?{excludedThreadIds}:{}),updatedAt:Date.now(),...(projectIds?{projectIds,projectPaths:projects.filter(p=>projectIds.includes(p.projectId)).map(p=>p.path)}:{}),...(threadIds?{threadIds}:{})});if(!old)data.universes.push(u);return u;
}
export function universeScope(data,id,threads=[],projects=[]){
 const universe=universeById(data,id);if(!universe)return {universe:null,jobs:data.jobs||[],threads,projects,customDepartments:data.customDepartments||[],departmentManagers:data.departmentManagers||{}};
 const paths=new Set([...(universe.projectPaths||[]),...projects.filter(p=>universe.projectIds.includes(p.projectId)).map(p=>p.path)]);
 const threadIds=new Set([...universe.threadIds,...Object.keys(universe.automaticMatches||{}).filter(id=>!(universe.excludedThreadIds||[]).includes(id))]);for(const j of data.jobs||[])if(j.universeId===id&&j.threadId)threadIds.add(j.threadId);
 for(const t of threads)if(paths.has(t.cwd)&&!(universe.excludedThreadIds||[]).includes(t.id))threadIds.add(t.id);
 // Descendants follow their real parent, even when they use a separate worktree.
 let changed=true;while(changed){changed=false;for(const t of threads)if(t.parentThreadId&&threadIds.has(t.parentThreadId)&&!threadIds.has(t.id)&&!(universe.excludedThreadIds||[]).includes(t.id)){threadIds.add(t.id);changed=true;}}
 const jobs=(data.jobs||[]).filter(j=>j.universeId===id||j.threadId&&threadIds.has(j.threadId));
 const scopedThreads=threads.filter(t=>threadIds.has(t.id));
 const usedPaths=new Set([...scopedThreads.map(t=>t.cwd),...jobs.flatMap(j=>[j.cwd,j.workspaceKey])].filter(Boolean));
 return {universe,jobs,threads:scopedThreads,projects:projects.filter(p=>universe.projectIds.includes(p.projectId)||usedPaths.has(p.path)),customDepartments:universe.customDepartments||[],departmentManagers:universe.departmentManagers||{}};
}
export function acceptUniverse(data,options){
 const id=options.universeId||(!options.universeId&&options.threadId?(data.jobs||[]).findLast(j=>j.threadId===options.threadId&&j.universeId)?.universeId:null);
 const scope=universeScope(data,id,data.threadCatalog||[],data.projects||[]);
 if(id&&options.threadId&&!scope.threads.some(t=>t.id===options.threadId)&&!scope.jobs.some(j=>j.threadId===options.threadId))throw Error('This task is outside this universe. Include it first.');
 return {id:id||null,customDepartments:scope.customDepartments};
}
export function evolveUniverses(data,threads,projects,now=Date.now()){
 let changed=false;for(const u of data.universes||[]){u.departmentManagers??={};const scope=universeScope(data,u.id,threads,projects);for(const department of departmentCatalog(scope,scope.threads))if(!u.departmentManagers[department]){u.departmentManagers[department]={department,universeId:u.id,createdAt:now,lastReviewedAt:0};changed=true;}}
 return changed;
}
export function universeDirectory(data,threads,projects,managers=[]){return (data.universes||[]).map(u=>{const scope=universeScope(data,u.id,threads,projects);return {...u,discoveryChecks:undefined,departmentManagers:undefined,linkedThreadIds:u.threadIds,linkedProjectIds:u.projectIds,threadIds:scope.threads.map(t=>t.id),jobIds:scope.jobs.map(j=>j.id),projectIds:scope.projects.map(p=>p.projectId),departments:departmentCatalog(scope,scope.threads),managers:managers.filter(m=>m.universeId===u.id)};});}
