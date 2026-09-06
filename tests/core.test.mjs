import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,canRun,validateRoute,chooseModel,canRetry} from '../core.mjs';
function store(){return new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rewster-queue-')),'state.json'))}
test('50 distinct requests persist across restart without duplicates on retry',()=>{const s=store(),start=performance.now();for(let i=0;i<50;i++)s.accept(['Request '+i],'burst-key-'+i);const elapsed=performance.now()-start;assert.equal(s.data.jobs.length,50);for(let i=0;i<50;i++)s.accept(['Request '+i],'burst-key-'+i);assert.equal(s.data.jobs.length,50);assert.equal(new Store(s.file).data.jobs.length,50);assert.ok(elapsed<60000);console.log(`50 durable receipts: ${elapsed.toFixed(1)}ms`)});
test('idempotency key cannot silently discard different text',()=>{const s=store();s.accept(['Original'],'repeat-key');assert.throws(()=>s.accept(['Changed'],'repeat-key'),/different messages/)});
test('restart never replays in-flight work automatically',()=>{const s=store();const [j]=s.accept(['Work'],'restart-key');s.update(j.id,{status:'running',threadId:'existing'});const recovered=new Store(s.file);assert.equal(recovered.data.jobs[0].status,'uncertain');assert.equal(recovered.data.jobs[0].threadId,'existing')});
test('same thread or folder cannot run concurrently',()=>{assert.equal(canRun({threadId:'a'},[{threadId:'a'}]),false);assert.equal(canRun({workspaceKey:'/repo'},[{workspaceKey:'/repo'}]),false);assert.equal(canRun({workspaceKey:'/b'},[{workspaceKey:'/a'}]),true)});
test('router output cannot invent a project or thread',()=>{const base={confidence:0.95,department:'Engineering',tier:'standard',kind:'task',title:'Task',reason:'Reason'};assert.throws(()=>validateRoute({...base,projectId:'fake'},[],[]),/unknown project/);assert.throws(()=>validateRoute({...base,threadId:'fake'},[],[]),/unknown task/);assert.throws(()=>validateRoute({...base,tier:'magic'},[],[]),/invalid classification/)});
test('model choice uses the available catalog and avoids retired choice',()=>{assert.equal(chooseModel('quick',[{model:'gpt-5.6-luna',upgradeInfo:{retirementAt:1}},{model:'valid',isDefault:true}]).model,'valid')});
test('invalid batch is rejected atomically',()=>{const s=store();assert.throws(()=>s.accept(['valid',''],'invalid-key'));assert.equal(s.data.jobs.length,0);assert.throws(()=>s.accept(Array(101).fill('x'),'over-limit'));assert.equal(s.data.jobs.length,0)});

test('receipt retry cannot silently change model or destination',()=>{const s=store();s.accept(['Task'],'same-options',{model:'one'});assert.throws(()=>s.accept(['Task'],'same-options',{model:'two'}),/different messages/)});

test('legacy in-flight receipts cannot become safe retries after upgrade',()=>{const s=store();const [j]=s.accept(['Work'],'legacy-restart-key');s.update(j.id,{status:'starting',threadId:'existing'});const recovered=new Store(s.file).data.jobs[0];assert.equal(recovered.status,'uncertain');assert.equal(canRetry(recovered),false)});
