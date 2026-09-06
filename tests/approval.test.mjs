import {test} from 'node:test';import assert from 'node:assert/strict';
import {approvalCapabilities as caps,approvalResponse as response} from '../approval.mjs';
// Contracts checked against @openai/codex 0.153.4 app-server generate-ts --experimental.
const command='item/commandExecution/requestApproval',form='mcpServer/elicitation/request',permissions='item/permissions/requestApproval',input='item/tool/requestUserInput';
const reply=(method,params,body)=>response({method,params},body);
test('command/file decisions stay one-time and respect the full advertised decision list',()=>{
 for(const method of [command,'item/fileChange/requestApproval'])for(const decision of ['accept','decline','cancel'])assert.deepEqual(reply(method,{}, {decision}),{decision});
 for(const availableDecisions of [[],[{acceptWithExecpolicyAmendment:{execpolicy_amendment:['echo']}}],['acceptForSession']]){assert.equal(caps(command,{availableDecisions}).canAccept,false);assert.throws(()=>reply(command,{availableDecisions},{decision:'accept'}),/not supported/)}
 assert.deepEqual(caps(command,{availableDecisions:['decline']}),{supported:true,canAccept:false,canDecline:true,canCancel:false});
 assert.throws(()=>reply(command,{}, {decision:'acceptForSession'}),/explicit/);assert.throws(()=>reply('unknown/method',{}, {decision:'accept'}),/not supported/);
});
test('permission grants omit nullable request fields and cannot escalate to session scope',()=>{
 const params={permissions:{network:{enabled:true},fileSystem:null}};
 assert.deepEqual(reply(permissions,params,{decision:'accept',scope:'session',permissions:{fileSystem:{write:['/']}}}),{permissions:{network:{enabled:true}},scope:'turn'});
 assert.deepEqual(reply(permissions,params,{decision:'decline'}),{permissions:{},scope:'turn'});assert.equal(caps(permissions,params).canCancel,false);
});
test('tool answers require every nonempty answer and match the answers-array protocol',()=>{
 const params={questions:[{id:'one'},{id:'two'}]};assert.throws(()=>reply(input,params,{decision:'accept',answers:{one:'x'}}),/every question/);
 assert.deepEqual(reply(input,params,{decision:'accept',answers:{one:' Answer ',two:'Other'}}),{answers:{one:{answers:['Answer']},two:{answers:['Other']}}});
 assert.equal(caps(input,params).canDecline,false);assert.throws(()=>reply(input,params,{decision:'cancel'}),/not supported/);
});
test('MCP responses include content and metadata; URL requests cannot claim form acceptance',()=>{
 for(const decision of ['decline','cancel'])assert.deepEqual(reply(form,{mode:'url'},{decision}),{action:decision,content:null,_meta:null});
 assert.throws(()=>reply(form,{mode:'url'},{decision:'accept'}),/not supported/);
 assert.deepEqual(reply(form,{mode:'form',requestedSchema:{type:'object',properties:{}}},{decision:'accept',content:{}}),{action:'accept',content:{},_meta:null});
});
test('MCP forms enforce required fields, typed values, enums, bounds, and reject unrequested content',()=>{
 const requestedSchema={type:'object',required:['count','ok','color'],properties:{count:{type:'integer',minimum:1,maximum:3},ok:{type:'boolean'},color:{type:'string',oneOf:[{const:'blue',title:'Blue'}]},note:{type:'string',maxLength:0}}};
 const params={mode:'form',requestedSchema},content={count:2,ok:false,color:'blue',note:''};assert.deepEqual(reply(form,params,{decision:'accept',content}).content,content);
 for(const wrong of [{...content,count:2.5},{...content,count:4},{...content,ok:'true'},{...content,color:'red'},{...content,note:'x'},{...content,unknown:1},{count:2,ok:true}])assert.throws(()=>reply(form,params,{decision:'accept',content:wrong}));
});
test('MCP titled multiselect validates listed options and item bounds',()=>{
 const params={mode:'form',requestedSchema:{type:'object',properties:{choices:{type:'array',minItems:1,maxItems:2,items:{anyOf:[{const:'one',title:'First'},{const:'two',title:'Second'}]}}}}};
 assert.deepEqual(reply(form,params,{decision:'accept',content:{choices:['one','two']}}).content,{choices:['one','two']});
 for(const choices of [[],['invalid'],['one','two','one']])assert.throws(()=>reply(form,params,{decision:'accept',content:{choices}}));
});
