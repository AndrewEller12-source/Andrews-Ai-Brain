import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core.mjs';import {saveUniverse,universeScope,universeDirectory,evolveUniverses} from '../universes.mjs';import {queueManagerReviews} from '../managers.mjs';
test('universes start blank, persist, and inherit descendants without mixing unrelated work',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'universe-test-'));try{
 const store=new Store(path.join(dir,'state.json'));const u=saveUniverse(store.data,{name:'Vending Business'}),v=saveUniverse(store.data,{name:'Design Studio'});
 const outside={id:'outside',title:'Photoshop retouch',department:'Photo Editing',cwd:'/studio'};assert.deepEqual(universeScope(store.data,u.id,[outside]).threads,[]);
 const [job]=store.accept(['Restock vending machines'],'vending-receipt',{universeId:u.id});Object.assign(job,{threadId:'parent',status:'completed',completedAt:2000,department:'Operations'});
 const threads=[outside,{id:'parent',department:'Operations'},{id:'child',parentThreadId:'parent',department:'Operations'},{id:'grandchild',parentThreadId:'child',department:'Engineering'}];store.data.threadCatalog=threads;
 assert.deepEqual(universeScope(store.data,u.id,threads).threads.map(t=>t.id),['parent','child','grandchild']);assert.equal(universeScope(store.data,v.id,threads).jobs.length,0);
 assert.throws(()=>store.accept(['Wrong thread'],'wrong-universe',{universeId:v.id,threadId:'parent'}),/outside this universe/);
 const [follow]=store.accept(['Continue'],'follow-from-all',{threadId:'parent'});assert.equal(follow.universeId,u.id);
 evolveUniverses(store.data,threads,[]);assert.deepEqual(Object.keys(u.departmentManagers).sort(),['Engineering','Operations']);assert.deepEqual(Object.keys(v.departmentManagers),[]);
 store.save();const restored=new Store(store.file);assert.equal(restored.data.universes[0].name,'Vending Business');assert.equal(restored.data.jobs[0].universeId,u.id);
 assert.equal(universeDirectory(restored.data,threads,[])[0].threadIds.length,3);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('project membership is explicit, supports new native tasks, and never matches a similar folder name',()=>{
 const data={jobs:[],customDepartments:[]},projects=[{projectId:'p',path:'/vending',label:'Vending'}],u=saveUniverse(data,{name:'Vending',projectIds:['p']},projects);
 const rows=[{id:'in',cwd:'/vending',department:'Operations'},{id:'out',cwd:'/vending-other',department:'Design'}];
 assert.deepEqual(universeScope(data,u.id,rows,projects).threads.map(t=>t.id),['in']);
 saveUniverse(data,{id:u.id,name:u.name,projectIds:[],threadIds:['out']},projects,rows);assert.deepEqual(universeScope(data,u.id,rows,projects).threads.map(t=>t.id),['out']);
 assert.throws(()=>saveUniverse(data,{name:'vending'}),/already exists/);assert.throws(()=>saveUniverse(data,{name:'Other',threadIds:['fake']}),/Unknown task/);
});
test('same-named managers review only their own universe and keep separate real task receipts',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'universe-manager-'));try{
 const store=new Store(path.join(dir,'state.json'));store.data.settings.autoManagers=true;store.data.organizationEnabledAt=1000;
 const a=saveUniverse(store.data,{name:'Vending'}),b=saveUniverse(store.data,{name:'Studio'});
 for(const [i,u] of [a,b].entries()){const [j]=store.accept(['Review work '+u.name],'manager-source-'+i,{universeId:u.id});Object.assign(j,{status:'completed',completedAt:2000,department:'Design',response:u.name});}
 evolveUniverses(store.data,[],[]);const jobs=queueManagerReviews(store,[{model:'gpt-5.6-luna'}],3000);assert.equal(jobs.length,2);assert.deepEqual(new Set(jobs.map(j=>j.universeId)),new Set([a.id,b.id]));assert.notEqual(a.departmentManagers.Design.jobId,b.departmentManagers.Design.jobId);
 assert.match(jobs.find(j=>j.universeId===a.id).prompt,/Vending/);assert.doesNotMatch(jobs.find(j=>j.universeId===a.id).prompt,/Studio/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
