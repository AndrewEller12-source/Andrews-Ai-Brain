import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {parseSessionActivity as parse,readSessionActivity as read} from '../activity.mjs';
const ev=(type,turn_id,extra={})=>({timestamp:'2026-09-05T07:00:00Z',type:'event_msg',payload:{type,turn_id,...extra}});
test('a stale unfinished turn is recorded uncertainty and never a claim of live running',()=>{
 const result=parse([ev('task_started','old')]);assert.equal(result.recordedStatus,'possibly_running');assert.equal(result.turnId,'old');assert.equal(result.source,'session-history');assert.equal(result.running,undefined);
});
test('turn identities prevent late completion from finishing a newer turn',()=>{
 const result=parse([ev('task_started','one'),ev('task_complete','one'),ev('task_started','two'),ev('task_complete','one',{last_agent_message:'Old result'})]);assert.equal(result.turnId,'two');assert.equal(result.recordedStatus,'possibly_running');assert.notEqual(result.lastActivity,'Old result');
 assert.equal(parse([ev('task_started','two'),ev('turn_aborted','two')]).recordedStatus,'interrupted');
});
test('subagent actual id and explicit parent survive root session ids; ordinary forks are not delegation',()=>{
 const result=parse([{type:'session_meta',payload:{session_id:'root',id:'child',parent_thread_id:'root',agent_path:'/root/review',agent_nickname:'Reviewer'}},ev('task_started','root-turn',{thread_id:'root'}),ev('task_started','child-turn',{thread_id:'child'})]);assert.equal(result.threadId,'child');assert.equal(result.parentThreadId,'root');assert.equal(result.turnId,'child-turn');assert.equal(result.agentName,'Reviewer');assert.equal(result.isSubagent,true);
 assert.equal(parse([{type:'session_meta',payload:{id:'fork',forked_from_id:'original'}}]).isSubagent,false);
});
test('modern item events provide activity without exposing reasoning, command input, or tool output',()=>{
 const result=parse([ev('task_started','a'),ev('item_completed','a',{item:{type:'CommandExecution',command:['echo','SECRET']}}),{type:'response_item',payload:{type:'reasoning',encrypted_content:'HIDDEN'}},ev('item_completed','a',{item:{type:'AgentMessage',content:[{type:'Text',text:'Testing the queue.'}]}})]);
 assert.equal(result.lastActivity,'Testing the queue.');assert.ok(!JSON.stringify(result).includes('HIDDEN'));assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('bounded tail retains metadata, tolerates partial writes, and refreshes after append',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-activity-')),file=path.join(dir,'session.jsonl');
 fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id:'child',source:{subagent:{thread_spawn:{parent_thread_id:'root',agent_nickname:'Euler',agent_path:'/root/test'}}}}})+'\n'+JSON.stringify({type:'irrelevant',payload:'x'.repeat(5000)})+'\n'+JSON.stringify(ev('task_started','live'))+'\n{"partial":');
 const first=read(file,{maxTailBytes:1024});assert.equal(first.parentThreadId,'root');assert.equal(first.agentName,'Euler');assert.equal(first.turnId,'live');assert.equal(first.historyTruncated,true);
 fs.appendFileSync(file,'true}\n'+JSON.stringify(ev('task_complete','live',{last_agent_message:'Finished.'}))+'\n');assert.equal(read(file,{maxTailBytes:1024}).recordedStatus,'completed');assert.equal(read(file,{maxTailBytes:1024}).lastActivity,'Finished.');fs.rmSync(dir,{recursive:true});
});

test('recent discovery returns only explicitly delegated children, excluding ordinary forks and old partitions',async()=>{
 const {discoverSessionChildren}=await import('../activity.mjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-child-discovery-'));
 const write=(day,name,meta)=>{const folder=path.join(dir,'sessions','2026','09',day);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'rollout-'+name+'.jsonl'),JSON.stringify({type:'session_meta',payload:meta})+'\n'+JSON.stringify(ev('task_complete','turn',{last_agent_message:'Done'}))+'\n')};
 write('05','child',{id:'child',session_id:'root',parent_thread_id:'root',agent_nickname:'QA',cwd:'/project'});write('05','fork',{id:'fork',forked_from_id:'root'});write('01','older',{id:'older',parent_thread_id:'root'});
 const result=discoverSessionChildren(dir,{now:Date.parse('2026-09-05T12:00:00Z'),days:2});assert.equal(result.length,1);assert.equal(result[0].id,'child');assert.equal(result[0].parentThreadId,'root');assert.equal(result[0].recordedStatus,'completed');assert.equal(result[0].title,'QA');fs.rmSync(dir,{recursive:true});
});
