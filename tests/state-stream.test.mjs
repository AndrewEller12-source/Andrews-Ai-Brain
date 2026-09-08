import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createStateStream,dashboardJob} from '../state-stream.mjs';
class Browser extends EventEmitter{frames=[];blocked=false;writeHead(status,headers){this.headers=headers}write(frame){this.frames.push(frame);return !this.blocked}end(){this.emit('close')}}
test('slow browsers retain their stream and skip intermediate snapshots until drain',async()=>{
 let version=1;const stream=createStateStream(()=>({version}),{interval:1}),slow=new Browser(),fast=new Browser();slow.blocked=true;stream.add(slow);stream.add(fast);
 for(version=2;version<=4;version++){stream.publish();await delay(10)}
 assert.equal(slow.frames.length,1);assert.equal(fast.frames.length,4);
 slow.blocked=false;slow.emit('drain');assert.equal(slow.frames.length,2);assert.match(slow.frames[1],/"version":4/);assert.equal(slow.headers['Cache-Control'],'no-cache, no-transform');
 stream.heartbeat();assert.match(slow.frames.at(-1),/event: heartbeat/);stream.close();
});
test('large snapshots do not trigger a disconnect or multiple blocked writes',async()=>{
 const browser=new Browser();browser.blocked=true;const stream=createStateStream(()=>({text:'x'.repeat(5_000_000)}),{interval:1});stream.add(browser);stream.publish();stream.heartbeat();await delay(10);assert.equal(browser.frames.length,1);browser.emit('close');stream.publish();await delay(10);assert.equal(browser.frames.length,1);stream.close();
});
test('dashboard leaves stored history intact and omits bulky completed tool transcripts',()=>{
 const items=[{role:'tool',text:'x'.repeat(10_000_000)},{role:'assistant',text:'Completed result',outputs:[{id:'file'}]}];const job={status:'completed',chatItems:items,response:'Completed result',events:Array.from({length:100},(_,i)=>({text:String(i)}))};
 const summary=dashboardJob(job);assert.equal(summary.chatItems.length,0);assert.equal(summary.events.length,20);assert.ok(JSON.stringify(summary).length<1500);assert.equal(job.chatItems,items);assert.equal(job.events.length,100);
 const live=dashboardJob({...job,status:'running'});assert.equal(live.chatItems.length,1);assert.equal(live.chatItems[0].outputs[0].id,'file');
});
