import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {selectAccountProfile,pinAccountProfile,accountProcessEnvironment} from '../runtime.mjs';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'account-onboarding-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('new customer profile ignores a populated desktop Codex profile and remains isolated after restart',t=>{
 const dir=fixture(t),home=path.join(dir,'person'),data=path.join(dir,'app');fs.mkdirSync(path.join(home,'.codex'),{recursive:true});fs.writeFileSync(path.join(home,'.codex','auth.json'),'PRIVATE_DESKTOP_SENTINEL');
 const selected=selectAccountProfile(data,home,{CODEX_HOME:path.join(home,'.codex')});assert.equal(selected.mode,'isolated');assert.equal(selected.explicit,false);pinAccountProfile(selected);
 fs.writeFileSync(path.join(data,'state.json'),'{}');const restarted=selectAccountProfile(data,home,{});
 assert.equal(restarted.codexHome,path.join(data,'accounts','codex'));assert.deepEqual(fs.readdirSync(restarted.codexHome),[]);assert.equal(fs.readFileSync(path.join(home,'.codex','auth.json'),'utf8'),'PRIVATE_DESKTOP_SENTINEL');
});
test('existing installations retain their own prior account and data',t=>{
 const dir=fixture(t),data=path.join(dir,'app');fs.mkdirSync(data);fs.writeFileSync(path.join(data,'state.json'),'{"jobs":[{"id":"existing"}]}');
 const profile=selectAccountProfile(data,dir,{});assert.equal(profile.mode,'legacy');assert.equal(profile.codexHome,path.join(dir,'.codex'));pinAccountProfile(profile);assert.equal(JSON.parse(fs.readFileSync(path.join(data,'state.json'))).jobs[0].id,'existing');
});
test('fresh customer processes cannot inherit provider credentials from the launching shell',t=>{
 const p=selectAccountProfile(path.join(fixture(t),'app'),'/recipient',{});const env={OPENAI_API_KEY:'PRIVATE_KEY_SENTINEL',CODEX_ACCESS_TOKEN:'PRIVATE_TOKEN_SENTINEL',...accountProcessEnvironment(p)};
 assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.CODEX_ACCESS_TOKEN,undefined);assert.equal(env.CODEX_HOME,p.codexHome);
});
test('explicit operator profile is honored without copying it and without changing the saved first-run mode',t=>{
 const dir=fixture(t),p=selectAccountProfile(path.join(dir,'app'),dir,{REWSTER_CODEX_HOME:path.join(dir,'explicit')});pinAccountProfile(p);assert.equal(p.explicit,true);assert.equal(accountProcessEnvironment(p).CODEX_HOME,path.join(dir,'explicit'));assert.equal(JSON.parse(fs.readFileSync(p.marker)).mode,'isolated');
});
test('malformed or conflicting profile configuration fails without falling back to another account',t=>{
 const dir=fixture(t);fs.writeFileSync(path.join(dir,'account-profile.json'),'{"version":1,"mode":"unknown"}');assert.throws(()=>selectAccountProfile(dir,dir,{}),/Invalid account/);
 fs.rmSync(path.join(dir,'account-profile.json'));const p=selectAccountProfile(dir,dir,{});fs.writeFileSync(p.marker,'{"version":1,"mode":"legacy"}');assert.throws(()=>pinAccountProfile(p),/changed during startup/);
});
