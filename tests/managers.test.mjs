import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core.mjs';import {queueManagerReviews,managerDirectory} from '../managers.mjs';
test('department managers create bounded real review jobs only for new completed work',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manager-test-'));try{const store=new Store(path.join(dir,'state.json'));Object.assign(store.data,{organizationEnabledAt:1000,departmentManagers:{Design:{department:'Design',lastReviewedAt:0}}});store.data.settings.autoManagers=true;
 const [source]=store.accept(['Create a logo'],'source-request',{});Object.assign(source,{status:'completed',department:'Design',updatedAt:2000,response:'Logo at /tmp/logo.svg',threadId:'source-thread'});
 const jobs=queueManagerReviews(store,[{model:'gpt-5.6-luna',isDefault:true}],3000);assert.equal(jobs.length,1);assert.equal(jobs[0].status,'ready');assert.equal(jobs[0].managerForDepartment,'Design');assert.match(jobs[0].prompt,/bounded read-only review/);assert.equal(jobs[0].sourceJobId,source.id);assert.equal(managerDirectory(store.data)[0].status,'ready');
 assert.equal(queueManagerReviews(store,[{model:'gpt-5.6-luna'}],4000).length,0);store.update(jobs[0].id,{status:'completed',updatedAt:5000});assert.equal(queueManagerReviews(store,[{model:'gpt-5.6-luna'}],1000000).length,0);
 store.data.settings.autoManagers=false;source.updatedAt=2000000;assert.equal(queueManagerReviews(store,[{model:'gpt-5.6-luna'}],2001000).length,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
