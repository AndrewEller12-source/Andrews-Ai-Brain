#!/usr/bin/env node
// Explicit, opt-in live Codex SDK test. Uses the current local Codex login and its quota.
// Does not run as part of npm test. https://learn.chatgpt.com/docs/codex-sdk
import {Codex} from '@openai/codex-sdk';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {accountProcessEnvironment,resolveCodexBinary,accountProfile,pinAccountProfile} from '../runtime.mjs';
const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-sdk-smoke-'));
const options={workingDirectory:workspace,skipGitRepoCheck:true,sandboxMode:'workspace-write',approvalPolicy:'never',networkAccessEnabled:false,webSearchMode:'disabled',...(process.env.SDK_TEST_MODEL?{model:process.env.SDK_TEST_MODEL}:{})};
const sdkEnv=Object.fromEntries(Object.entries({...process.env,...accountProcessEnvironment()}).filter(([,value])=>typeof value==='string'));
pinAccountProfile(accountProfile);
const codex=new Codex({codexPathOverride:resolveCodexBinary(),env:sdkEnv,...(accountProfile.mode==='isolated'&&!accountProfile.explicit?{config:{cli_auth_credentials_store:'file'}}:{})});
const thread=codex.startThread(options);
const result={checkedAt:new Date().toISOString(),sdk:'@openai/codex-sdk',workspace,model:process.env.SDK_TEST_MODEL||'local Codex default',checks:[]};
async function run(t,prompt){
 const {events}=await t.runStreamed(prompt,{signal:AbortSignal.timeout(180000)});let response='',usage;
 for await(const event of events){
  if(event.type==='thread.started'){result.threadId=event.thread_id;console.log('SDK thread created:',event.thread_id)}
  if(event.type==='item.completed'&&event.item.type==='agent_message')response=event.item.text;
  if(event.type==='turn.completed')usage=event.usage;
  if(event.type==='turn.failed')throw Error(event.error.message);
  if(event.type==='error')throw Error(event.message);
 }
 return {response,usage};
}
try{
 const first=await run(thread,'This is an isolated SDK smoke test. Only work inside the current empty working directory. Do not use network, MCP, web, messages, purchases, or any external service. Create proof.json containing exactly the JSON object {"created":true,"count":1}. Read it back and report done.');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace,'proof.json'),'utf8')),{created:true,count:1});
 result.checks.push({name:'new SDK thread executes file edit',passed:true,...first});
 assert.ok(thread.id);const resumed=codex.resumeThread(thread.id,options);
 const second=await run(resumed,'Continue the same isolated smoke test. Read proof.json and change only count from 1 to 2; preserve created:true. Read it back. Do not use network, MCP, web, or external services.');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace,'proof.json'),'utf8')),{created:true,count:2});
 assert.equal(resumed.id,thread.id);result.checks.push({name:'resume same SDK thread executes continuation',passed:true,...second});
 result.passed=true;
}catch(error){result.passed=false;result.error=error.message;process.exitCode=1}
console.log(JSON.stringify(result,null,2));
if(process.env.SDK_TEST_REPORT)fs.writeFileSync(process.env.SDK_TEST_REPORT,JSON.stringify(result,null,2)+'\n');
