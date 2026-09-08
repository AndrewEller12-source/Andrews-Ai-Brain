import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {setTimeout as delay} from 'node:timers/promises';
import {DesktopControl} from '../desktop-control.mjs';
function fixture(t,timeoutMs=250){const observer=new EventEmitter();Object.assign(observer,{connected:true,clientId:'our-observer',records:new Map([['task',{owner:'desktop-owner',activity:{state:'completed',turnId:'previous-turn'}}]]),sent:[],send(message){this.sent.push(message)}});const control=new DesktopControl(observer,{timeoutMs});t.after(()=>control.close());return {observer,control};}
function respond(observer,request,result){observer.emit('message',{type:'response',requestId:request.requestId,resultType:'success',method:request.method,handledByClientId:request.targetClientId,result});}
test('steering uses follower protocol v1, preserves settings and verifies the active turn receipt',async t=>{
 const {observer,control}=fixture(t);observer.records.get('task').activity={state:'running',turnId:'turn'};
 await assert.rejects(control.steerTurn('task',{prompt:'Correction',expectedTurnId:'old'}),/changed/);
 const pending=control.steerTurn('task',{prompt:'Check requirements',expectedTurnId:'turn',clientId:'exact-message'}),request=observer.sent[0];
 assert.equal(request.method,'thread-follower-steer-turn');assert.equal(request.version,1);assert.equal(request.params.clientUserMessageId,'exact-message');assert.equal(request.params.input[0].text,'Check requirements');assert.ok(request.params.restoreMessage.context);assert.equal(request.params.turnStart,undefined);
 respond(observer,request,{result:{turnId:'turn'}});assert.equal((await pending).turnId,'turn');
 const mismatch=control.steerTurn('task',{prompt:'Check again',expectedTurnId:'turn'});respond(observer,observer.sent[1],{result:{turnId:'different'}});await assert.rejects(mismatch,e=>e.uncertain===true);
});

test('start dispatches exact targeted follower schema and normalizes wrapped turn receipt',async t=>{
 const {observer,control}=fixture(t);assert.equal(control.supports(),true);assert.equal(control.hasOwner('task'),true);
 const pending=control.startTurn('task',{prompt:'Continue this task',clientId:'message-receipt',model:'available-model',effort:'high'});assert.equal(observer.sent.length,1);const request=observer.sent[0];
 assert.deepEqual({...request,requestId:undefined,timeoutMs:undefined},{type:'request',requestId:undefined,sourceClientId:'our-observer',targetClientId:'desktop-owner',version:2,method:'thread-follower-start-turn',timeoutMs:undefined,params:{conversationId:'task',turnStart:{request:{threadId:'task',input:[{type:'text',text:'Continue this task',text_elements:[]}],clientUserMessageId:'message-receipt',model:'available-model',effort:'high'},context:{inheritThreadSettings:true}}}});
 respond(observer,request,{result:{turn:{id:'new-turn',status:'inProgress'}}});assert.deepEqual(await pending,{turn:{id:'new-turn',status:'inProgress'}});assert.equal(control.pending.size,0);
});
test('missing owner, unknown state, active task, and disconnected observer fail before dispatch',async t=>{
 const {observer,control}=fixture(t);await assert.rejects(control.startTurn('missing',{prompt:'Hello'}),/owner/);
 for(const state of ['unknown','running','waiting']){observer.records.get('task').activity.state=state;await assert.rejects(control.startTurn('task',{prompt:'Hello'}),/active|unknown/);}
 observer.connected=false;assert.equal(control.supports(),false);await assert.rejects(control.startTurn('task',{prompt:'Hello'}),/disconnected/);assert.equal(observer.sent.length,0);
});
test('unrelated response IDs are ignored and a second pending start is refused',async t=>{
 const {observer,control}=fixture(t);const pending=control.startTurn('task',{prompt:'Hello'});const request=observer.sent[0];let settled=false;pending.then(()=>{settled=true});
 respond(observer,{...request,requestId:'unrelated'},{result:{turn:{id:'wrong'}}});await delay(5);assert.equal(settled,false);
 await assert.rejects(control.startTurn('task',{prompt:'Duplicate'}),/awaiting confirmation/);assert.equal(observer.sent.length,1);
 respond(observer,request,{result:{turn:{id:'right'}}});assert.equal((await pending).turn.id,'right');
});
test('timeout is uncertain and never retries or replays a late response',async t=>{
 const {observer,control}=fixture(t,15);const pending=control.startTurn('task',{prompt:'Hello'});await assert.rejects(pending,error=>error.uncertain===true&&/timed out/.test(error.message));assert.equal(observer.sent.length,1);
 respond(observer,observer.sent[0],{result:{turn:{id:'late'}}});await delay(25);assert.equal(observer.sent.length,1);assert.equal(control.pending.size,0);
});
test('disconnect and owner changes reject pending mutations as uncertain with no retry',async t=>{
 const {observer,control}=fixture(t);let pending=control.startTurn('task',{prompt:'Hello'});observer.connected=false;observer.emit('change');await assert.rejects(pending,error=>error.uncertain===true);assert.equal(observer.sent.length,1);
 observer.connected=true;pending=control.startTurn('task',{prompt:'Second explicit request'});observer.records.get('task').owner='different-owner';observer.emit('change');await assert.rejects(pending,error=>error.uncertain===true);assert.equal(observer.sent.length,2);
});
test('mismatched responder identity and malformed success retain outcome uncertainty',async t=>{
 const {observer,control}=fixture(t);let pending=control.startTurn('task',{prompt:'Hello'});observer.emit('message',{type:'response',requestId:observer.sent[0].requestId,resultType:'success',method:'thread-follower-start-turn',handledByClientId:'wrong-owner',result:{result:{turn:{id:'wrong'}}}});await assert.rejects(pending,error=>error.uncertain===true);
 pending=control.startTurn('task',{prompt:'Explicit new attempt'});respond(observer,observer.sent[1],{});await assert.rejects(pending,error=>error.uncertain===true);assert.equal(observer.sent.length,2);
});
test('interrupt targets the exact observed active turn using local protocol v4',async t=>{
 const {observer,control}=fixture(t);observer.records.get('task').activity={state:'waiting',turnId:'running-turn'};
 await assert.rejects(control.interrupt('task','different-turn'),/no longer/);assert.equal(observer.sent.length,0);
 const pending=control.interrupt('task','running-turn'),request=observer.sent[0];assert.equal(request.version,4);assert.equal(request.method,'thread-follower-interrupt-turn');assert.deepEqual(request.params,{conversationId:'task',mode:'user-stop',expectedTurnId:'running-turn'});
 respond(observer,request,{ok:true,interruptedTurnId:'running-turn'});assert.deepEqual(await pending,{ok:true,interruptedTurnId:'running-turn'});
});
test('definite discovery rejection does not claim execution and sends no fallback request',async t=>{
 const {observer,control}=fixture(t);const pending=control.startTurn('task',{prompt:'Hello'});observer.emit('message',{type:'response',requestId:observer.sent[0].requestId,resultType:'error',error:'no-client-found'});await assert.rejects(pending,error=>!error.uncertain&&error.message==='no-client-found');assert.equal(observer.sent.length,1);
});
test('stop response must identify the requested turn',async t=>{
 const {observer,control}=fixture(t);observer.records.get('task').activity={state:'running',turnId:'running-turn'};
 const pending=control.interrupt('task','running-turn');respond(observer,observer.sent[0],{ok:true,interruptedTurnId:'different-turn'});await assert.rejects(pending,error=>error.uncertain===true);assert.equal(observer.sent.length,1);
});

test('photo replies stay on the targeted desktop conversation, including photo-only messages',async t=>{
 const {observer,control}=fixture(t),images=[{type:'localImage',path:'/private/photos/reference.png'}];
 const pending=control.startTurn('task',{prompt:'',images,clientId:'photo-receipt'}),request=observer.sent[0];
 assert.deepEqual(request.params.turnStart.request.input,images);assert.equal(request.params.conversationId,'task');assert.equal(request.params.turnStart.request.clientUserMessageId,'photo-receipt');
 respond(observer,request,{result:{turn:{id:'photo-turn'}}});assert.equal((await pending).turn.id,'photo-turn');
});

test('desktop follow-ups carry the selected native approval profile and reject invalid modes before dispatch',async t=>{
 const {observer,control}=fixture(t);observer.records.get('task').cwd='/work/project';
 await assert.rejects(control.startTurn('task',{prompt:'Hello',approvalMode:'bogus'}),/approval mode/);assert.equal(observer.sent.length,0);
 for(const mode of ['manual','auto-review','full-auto']){
 const pending=control.startTurn('task',{prompt:'Continue',approvalMode:mode});const sent=observer.sent.at(-1),request=sent.params.turnStart.request;
 assert.equal(request.approvalPolicy,mode==='full-auto'?'never':'on-request');assert.equal(request.approvalsReviewer,mode==='auto-review'?'auto_review':'user');assert.equal(request.sandboxPolicy.type,mode==='full-auto'?'dangerFullAccess':'workspaceWrite');
 if(mode!=='full-auto')assert.deepEqual(request.sandboxPolicy.writableRoots,['/work/project']);
 respond(observer,sent,{result:{turn:{id:'turn-'+mode}}});await pending;
 }
});

test('question answers target the exact pending request and require owner confirmation',async t=>{
 const {observer,control}=fixture(t);observer.records.get('task').state={requests:[{id:42,method:'item/tool/requestUserInput',params:{threadId:'task'}}]};
 await assert.rejects(control.answerQuestion('task','missing',{}),/no longer pending/);
 const response={answers:{color:{answers:['Blue']}}},pending=control.answerQuestion('task',42,response),request=observer.sent[0];assert.equal(request.method,'thread-follower-submit-user-input');assert.equal(request.version,1);assert.deepEqual(request.params,{conversationId:'task',requestId:42,response});respond(observer,request,{ok:true});assert.equal((await pending).ok,true);
});
