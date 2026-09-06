import test from 'node:test';import assert from 'node:assert/strict';import {extractTurnRequest} from '../turn-request.mjs';
test('exact turn extraction excludes other turns, assistant messages and tool payloads',()=>{
 const r=extractTurnRequest([{turnId:'old',item:{type:'userMessage',content:[{type:'text',text:'Old request'}]}},{turnId:'current',item:{type:'agentMessage',text:'Not user text'}},{turnId:'current',item:{type:'userMessage',clientId:'receipt',content:[{type:'text',text:'Fix inventory totals exactly.'},{type:'image',url:'private image'}]}}],'current');assert.equal(r.text,'Fix inventory totals exactly.');assert.equal(r.messages[0].clientId,'receipt');assert.equal(r.turnId,'current');assert.ok(!JSON.stringify(r).includes('private'));
});
test('messages stay in conversational order and missing input never borrows a preview',()=>{
 assert.equal(extractTurnRequest([{item:{type:'userMessage',text:'Second'}},{item:{type:'userMessage',text:'First'}}],'turn').text,'First\n\nSecond');assert.equal(extractTurnRequest([{item:{type:'agentMessage',text:'Response'}}],'turn').status,'unavailable');
});
