import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core.mjs';
import {recordCompletion,markNotificationsRead} from '../notifications.mjs';
const completion={threadId:'thread-one',turnId:'turn-one',jobId:'job-one',title:'Finished task',department:'Engineering',projectLabel:'Example project',completedAt:1000};

test('completion initializes state, requires exact receipts, and deduplicates repeated events',()=>{
 const data={};assert.equal(recordCompletion(data,{}),false);assert.deepEqual(data.notifications,[]);
 for(const missing of [{threadId:'thread'}, {turnId:'turn'}, {threadId:' ',turnId:'turn'}])assert.equal(recordCompletion(data,missing),false);
 assert.equal(recordCompletion(data,completion),true);assert.equal(recordCompletion(data,{...completion,title:'Repeated event',jobId:'other-job'}),false);
 assert.equal(data.notifications.length,1);assert.equal(data.notifications[0].read,false);assert.equal(data.notifications[0].title,completion.title);
 assert.equal(recordCompletion(data,{...completion,turnId:'turn-two'}),true);
 assert.equal(recordCompletion(data,{...completion,threadId:'thread-two'}),true);assert.equal(data.notifications.length,3);
});
test('notification IDs are deterministic and encode the whole thread-turn pair',()=>{
 const first={},second={};recordCompletion(first,completion);recordCompletion(second,completion);assert.equal(first.notifications[0].id,second.notifications[0].id);
 const data={};recordCompletion(data,{threadId:'a:b',turnId:'c',completedAt:1});recordCompletion(data,{threadId:'a',turnId:'b:c',completedAt:1});assert.equal(new Set(data.notifications.map(n=>n.id)).size,2);
});
test('notification history retains the latest 500 completed turns',()=>{
 const data={};for(let i=0;i<510;i++)recordCompletion(data,{...completion,turnId:`turn-${i}`,completedAt:i});
 assert.equal(data.notifications.length,500);assert.equal(data.notifications[0].completedAt,509);assert.equal(data.notifications.at(-1).completedAt,10);
 assert.equal(new Set(data.notifications.map(n=>n.id)).size,500);
});
test('acknowledgements are explicit, selective, and idempotent',()=>{
 const data={};recordCompletion(data,completion);recordCompletion(data,{...completion,turnId:'other-turn',completedAt:2000});
 assert.equal(markNotificationsRead(data,[]),0);assert(data.notifications.every(n=>!n.read));
 assert.equal(markNotificationsRead(data,['unknown-id']),0);
 const id=data.notifications[0].id;assert.equal(markNotificationsRead(data,[id,id]),1);assert.equal(markNotificationsRead(data,[id]),0);
 assert.equal(data.notifications[0].read,true);assert.equal(data.notifications[1].read,false);
 assert.equal(markNotificationsRead(data),1);assert.equal(markNotificationsRead(data),0);
});
test('invalid acknowledgements do not change stored unread state',()=>{
 const data={};recordCompletion(data,completion);
 for(const ids of [null,'all',1,{},[1],['valid',null]])assert.throws(()=>markNotificationsRead(data,ids),/array of strings/);
 assert.equal(data.notifications[0].read,false);
});
test('notifications and read acknowledgements survive Store reload and remain deduplicated',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-notifications-'));
 try{
  const file=path.join(dir,'state.json'),first=new Store(file);recordCompletion(first.data,completion);first.save();
  const second=new Store(file);assert.equal(second.data.notifications.length,1);assert.equal(second.data.notifications[0].read,false);assert.equal(recordCompletion(second.data,completion),false);
  assert.equal(markNotificationsRead(second.data,[second.data.notifications[0].id]),1);second.save();
  const third=new Store(file);assert.equal(third.data.notifications[0].read,true);assert.equal(recordCompletion(third.data,completion),false);assert.equal(third.data.notifications.length,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
