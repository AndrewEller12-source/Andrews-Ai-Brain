import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CodexBridge} from '../bridge.mjs';
const fixture=path.join(path.dirname(fileURLToPath(import.meta.url)),'fixtures/fake-codex.mjs');
async function connect(t){const previous=process.env.CODEX_BIN;process.env.CODEX_BIN=fixture;const b=new CodexBridge();t.after(()=>{b.close();if(previous===undefined)delete process.env.CODEX_BIN;else process.env.CODEX_BIN=previous});await b.connect();return b}
test('bridge negotiates RPC and rejects provider errors',async t=>{const b=await connect(t);assert.equal(b.connected,true);const m=await b.call('model/list',{});assert.equal(m.data[0].model,'fixture-model');await assert.rejects(()=>b.call('unknown/method'),/unsupported/i)});
test('bridge timeout identifies an unconfirmed outcome and releases pending RPC',async t=>{const b=await connect(t);await assert.rejects(()=>b.call('fixture/never',{},30),/timed out|unconfirmed/i);assert.equal(b.pending.size,0)});
test('bridge process loss rejects pending work instead of hanging',async t=>{const b=await connect(t);const pending=b.call('fixture/never',{},5000);const assertion=assert.rejects(pending,/closed|disconnect|exit/i);b.process.kill('SIGTERM');await assertion;assert.equal(b.connected,false);assert.equal(b.pending.size,0)});
