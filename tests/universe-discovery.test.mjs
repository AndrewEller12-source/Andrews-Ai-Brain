import test from 'node:test';import assert from 'node:assert/strict';
import {UniverseDiscovery,discoveryProfile,validateDiscovery} from '../universe-discovery.mjs';import {saveUniverse,universeScope} from '../universes.mjs';
function setup(classify){let now=100000,calls=0;const data={jobs:[],customDepartments:[]},u=saveUniverse(data,{name:'Vending Business'});let threads=[{id:'nayax',title:'Reconcile Nayax settlements',preview:'Card-reader settlements for our snack machines',department:'Finance'},{id:'design',title:'Retouch wedding photos',preview:'Photoshop edits',department:'Photo Editing'}];const worker=new UniverseDiscovery({store:{data,save(){}},threads:()=>threads,now:()=>now,ready:()=>true,changed(){},classify:async input=>{calls++;return classify(input)}});return {data,u,worker,get calls(){return calls},threads:()=>threads,setThreads:t=>threads=t,advance:()=>now+=65000};}
const decisions=input=>({decisions:input.tasks.map(t=>({id:t.id,match:t.id==='nayax',confidence:t.id==='nayax'?.97:0,reason:'Settlement reconciliation for vending machines',evidence:t.id==='nayax'?t.title:''}))});
test('semantic discovery includes related native history, preserves All Codex, caches negatives and follows children',async()=>{
 const f=setup(decisions);await f.worker.tick();assert.ok(f.u.automaticMatches.nayax);assert.equal(f.u.automaticMatches.design,undefined);assert.equal(f.data.jobs.length,0);assert.equal(f.threads().length,2);
 assert.deepEqual(universeScope(f.data,f.u.id,f.threads()).threads.map(t=>t.id),['nayax']);f.advance();await f.worker.tick();assert.equal(f.calls,1);
 f.setThreads([...f.threads(),{id:'child',parentThreadId:'nayax',title:'Check totals',department:'Finance'}]);assert.equal(universeScope(f.data,f.u.id,f.threads()).threads.length,2);
 assert.equal(discoveryProfile(f.data,f.u,f.threads()).examples.length,0,'automatic guesses must not become learning examples');
});
test('new conversation evidence and explicit work teach later matching without repeatedly rescanning unchanged history',async()=>{
 const f=setup(decisions);await f.worker.tick();f.advance();f.setThreads(f.threads().map(t=>t.id==='design'?{...t,preview:'New vending product photos'}:t));await f.worker.tick();assert.equal(f.calls,2);
 f.data.jobs.push({id:'own',universeId:f.u.id,prompt:'Reconcile our Nayax transactions',title:'Payments'});assert.equal(discoveryProfile(f.data,f.u,f.threads()).examples.length,1);f.advance();await f.worker.tick();assert.equal(f.calls,3);
});
test('exclusions remain excluded after a rescan and late model answers cannot undo owner changes',async()=>{
 let resolve;const f=setup(input=>new Promise(r=>resolve=()=>r(decisions(input))));const pending=f.worker.tick();f.u.excludedThreadIds=['nayax'];resolve();await pending;assert.equal(f.u.automaticMatches?.nayax,undefined);
 f.u.autoDiscover=false;f.advance();await f.worker.tick();assert.equal(f.calls,1);
});
test('ungrounded, unknown, duplicate and incomplete matches are rejected, and ambiguous matches stay out',async()=>{
 const rows=[{id:'known',title:'Inspect vending supplier invoices',excerpt:''}],good={id:'known',match:true,confidence:.95,reason:'Vending invoices',evidence:'vending supplier invoices'};
 assert.throws(()=>validateDiscovery({decisions:[{...good,id:'invented'}]},rows),/invalid/);assert.equal(validateDiscovery({decisions:[{...good,evidence:'unavailable fabricated quote'}]},rows)[0].match,false);assert.throws(()=>validateDiscovery({decisions:[]},rows),/incomplete/);
 const f=setup(input=>({decisions:decisions(input).decisions.map(r=>({...r,confidence:.6}))}));await f.worker.tick();assert.deepEqual(f.u.automaticMatches,{});
});
test('a model failure leaves current membership intact and retries with backoff',async()=>{
 const f=setup(()=>{throw Error('Temporarily unavailable')});f.u.discoveryPolicy=2;f.u.automaticMatches={nayax:{reason:'Previously confirmed'}};await f.worker.tick();assert.equal(f.u.discovery.status,'retrying');assert.ok(f.u.automaticMatches.nayax);await f.worker.tick();assert.equal(f.calls,1);f.advance();await f.worker.tick();assert.equal(f.calls,2);
});
test('structured discovery schema requires a decision for every exact task ID',async()=>{
 const {discoveryOutputSchema,normalizeDiscoveryOutput}=await import('../universe-discovery.mjs');const tasks=[{id:'first',title:'Vending stock',excerpt:''},{id:'second',title:'Wedding photos',excerpt:''}];const schema=discoveryOutputSchema(tasks);assert.deepEqual(schema.properties.decisions.required,['first','second']);assert.equal(schema.properties.decisions.additionalProperties,false);
 const result=normalizeDiscoveryOutput({decisions:{first:{match:true,confidence:.98,reason:'Vending inventory',evidence:'Vending stock'},second:{match:false,confidence:0,reason:'',evidence:''}}});assert.equal(validateDiscovery(result,tasks).length,2);
 assert.throws(()=>validateDiscovery(normalizeDiscoveryOutput({decisions:{first:result.decisions[0]}}),tasks),/incomplete/);
});
test('shared owner biographies and wrapper payloads do not become business evidence',async()=>{
 const {discoveryCandidates}=await import('../universe-discovery.mjs');const data={jobs:[]},u=saveUniverse(data,{name:'Vending Business'});
 const rows=discoveryCandidates(data,u,[{id:'setup',title:'Background context supplied by the app: Andrew operates vending',preview:'Background context supplied by the app: All his assistants know about vending',lastActivity:'Playing your music now.'}]);assert.equal(rows[0].title,'');assert.equal(rows[0].excerpt,'Playing your music now.');
});

test('generic AI business and revenue targets do not import unrelated history or call a model',async()=>{
 const f=setup(decisions);f.u.name='New Ai powered Business';f.u.description='AI-driven business making $30,000-$50,000 Per month MRR.';f.u.automaticMatches={nayax:{reason:'Old overly broad guess'}};await f.worker.tick();assert.equal(f.calls,0);assert.equal(f.u.discovery.status,'needs-context');assert.deepEqual(f.u.automaticMatches,{});assert.equal(universeScope(f.data,f.u.id,f.threads()).threads.length,0);assert.equal(universeScope(f.data,null,f.threads()).threads.length,2);
 f.data.jobs.push({id:'new',universeId:f.u.id,title:'Dental reception',prompt:'Build appointment booking for dental clinics'});f.advance();await f.worker.tick();assert.equal(f.calls,1);
});
test('deleting a universe while a classifier is running discards its late match',async()=>{let resolve;const f=setup(input=>new Promise(r=>resolve=()=>r(decisions(input))));const pending=f.worker.tick();f.u.deletedAt=Date.now();resolve();await pending;assert.deepEqual(f.u.automaticMatches,{});});
test('old automatic review tasks cannot keep an unrelated department alive',()=>{const f=setup(decisions);f.data.jobs.push({id:'review',universeId:f.u.id,threadId:'manager',managerForDepartment:'Growth',department:'Growth',status:'completed'});f.setThreads([...f.threads(),{id:'manager',title:'Growth review',department:'Growth'}]);const scope=universeScope(f.data,f.u.id,f.threads());assert.equal(scope.threads.length,0);assert.equal(scope.jobs.length,0);assert.equal(f.data.jobs.length,1);});

test('internal reviews cannot be imported as unrelated business work',async()=>{
 const {discoveryCandidates}=await import('../universe-discovery.mjs');const f=setup(decisions);f.data.jobs.push({id:'internal',threadId:'review',managerForDepartment:'Growth'});f.setThreads([...f.threads(),{id:'review',title:'Review new AI business strategy'}]);assert.deepEqual(discoveryCandidates(f.data,f.u,f.threads()).map(t=>t.id),['nayax','design']);
});
