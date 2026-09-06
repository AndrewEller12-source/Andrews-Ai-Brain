import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,validateRoute} from '../core.mjs';
import {classify,cleanName,departmentCatalog,addDepartment,migrateOrganization} from '../organization.mjs';
test('fresh users get no borrowed departments; Photoshop work creates only Photo Editing',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ai-organization-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(path.join(dir,'state.json'));
 assert.deepEqual(departmentCatalog(store.data),[]);assert.equal(store.data.settings.workspaceName,'My workspace');
 store.accept(['Retouch this portrait in Photoshop'],'photoshop-first');assert.deepEqual(departmentCatalog(store.data),['Photo Editing']);
 store.data.settings.workspaceName='Trey’s Studio';addDepartment(store.data,{name:'Editorial',keywords:'magazine, cover shoot'});store.save();
 const next=new Store(store.file);assert.equal(next.data.settings.workspaceName,'Trey’s Studio');assert.equal(classify('Prepare the magazine',next.data.customDepartments),'Editorial');assert.deepEqual(departmentCatalog(next.data),['Editorial','Photo Editing']);
});
test('migration preserves manual assignments and exact receipts while removing generic legacy classification',()=>{
 const data={settings:{},overrides:{t2:'My Studio'},jobs:[{id:'j1',threadId:'t1',turnId:'turn1',department:'Executive',prompt:'Use Lightroom on this photo',options:{}},{id:'j2',threadId:'t2',turnId:'turn2',department:'My Studio',prompt:'Photoshop',options:{}}]};
 migrateOrganization(data);assert.equal(data.jobs[0].department,'Photo Editing');assert.equal(data.jobs[0].turnId,'turn1');assert.equal(data.jobs[1].department,'My Studio');data.jobs[0].department='Custom routed';migrateOrganization(data);assert.equal(data.jobs[0].department,'Custom routed');
});
test('custom departments are canonical, validated and accept new real specialties',()=>{
 const data={jobs:[],customDepartments:[]};addDepartment(data,{name:'Photo Editing',keywords:'photoshop'});addDepartment(data,{name:'photo editing',keywords:'lightroom'});assert.equal(data.customDepartments.length,1);assert.deepEqual(data.customDepartments[0],{name:'Photo Editing',keywords:['lightroom']});
 for(const name of ['', 'x'.repeat(49),'<script>','bad\nname','__proto__'])assert.throws(()=>cleanName(name));
 assert.equal(cleanName('Trey’s Studio'),'Trey’s Studio');
 const route={department:'3D Animation',tier:'standard',kind:'task',confidence:.9,reason:'Animation request',title:'Animate logo'};assert.equal(validateRoute(route,[],[]).department,'3D Animation');
 assert.throws(()=>validateRoute({...route,department:'<script>'},[],[]));assert.throws(()=>addDepartment(data,{name:'Editorial',keywords:['wrong type']}));
});
