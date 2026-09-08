import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {appRoot,defaultDataDir,resolveCodexBinary} from '../runtime.mjs';
import {stageRelease,releaseFiles} from '../scripts/package-release.mjs';

test('runtime isolates recipient app data and supports explicit location',()=>{
  assert.equal(defaultDataDir('darwin','/recipient',{}),'/recipient/Library/Application Support/Rewster Command');
  assert.equal(defaultDataDir('linux','/recipient',{}),'/recipient/.local/share/rewster-command');
  assert.equal(defaultDataDir('linux','/recipient',{XDG_DATA_HOME:'/data'}),'/data/rewster-command');
  assert.equal(defaultDataDir('win32','/recipient',{LOCALAPPDATA:'/local'}),'/local/Rewster Command');
  assert.equal(defaultDataDir('linux','/recipient',{REWSTER_DATA_DIR:'/isolated'}),'/isolated');
});
test('installed native Codex executable launches without a shell',()=>{
  const executable=resolveCodexBinary();
  const result=spawnSync(executable,['--version'],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/codex/);
});
test('CODEX_BIN honors executable override and fails clearly for invalid override',()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-runtime-'));
  try{
    const executable=path.join(temporary,'fake-codex');fs.writeFileSync(executable,'#!/bin/sh\nexit 0\n',{mode:0o755});
    const script='import {resolveCodexBinary} from "./runtime.mjs"; console.log(resolveCodexBinary())';
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:appRoot,env:{...process.env,CODEX_BIN:executable},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),executable);
    const bad=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:appRoot,env:{...process.env,CODEX_BIN:path.join(temporary,'missing')},encoding:'utf8'});
    assert.notEqual(bad.status,0);assert.match(bad.stderr,/CODEX_BIN/);
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
test('release allowlist excludes personal state and refuses personal paths or symlinks',()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-pack-test-'));
  try{
    const source=path.join(temporary,'source'),output=path.join(temporary,'release');
    for(const file of releaseFiles){fs.mkdirSync(path.dirname(path.join(source,file)),{recursive:true});fs.writeFileSync(path.join(source,file),file==='package.json'?'{"version":"test"}':'// Safe application file\n');}
    for(const file of ['.local/state.json','.env','projects.json','research/private.md','node_modules/private.txt','generated/history.json']){fs.mkdirSync(path.dirname(path.join(source,file)),{recursive:true});fs.writeFileSync(path.join(source,file),'PRIVATE_ACCOUNT_SENTINEL');}
    const manifest=stageRelease(source,output);assert.equal(manifest.length,releaseFiles.length);
    assert(!fs.existsSync(path.join(output,'.local')));assert(!fs.existsSync(path.join(output,'projects.json')));
    assert(!fs.existsSync(path.join(output,'research')));assert(!fs.existsSync(path.join(output,'node_modules')));
    const actualFiles=fs.readdirSync(output,{recursive:true}).filter(file=>fs.statSync(path.join(output,file)).isFile());
    assert.equal(actualFiles.length,releaseFiles.length+1);
    for(const file of actualFiles)assert(!fs.readFileSync(path.join(output,file),'utf8').includes('PRIVATE_ACCOUNT_SENTINEL'));
    fs.writeFileSync(path.join(source,'app.js'),'/Users/private-owner/secret');
    assert.throws(()=>stageRelease(source,path.join(temporary,'bad')),/Personal path/);
    fs.rmSync(path.join(source,'app.js'));fs.symlinkSync(path.join(source,'core.mjs'),path.join(source,'app.js'));
    assert.throws(()=>stageRelease(source,path.join(temporary,'linked')),/regular file/);
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});

test('portable launcher starts, detects existing app, and stops only its own healthy server',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-launch-test-'));
  const source=path.join(temporary,'app'),data=path.join(temporary,'data');
  fs.mkdirSync(path.join(source,'scripts'),{recursive:true});
  for(const file of ['runtime.mjs','upgrade.mjs','package.json','scripts/launch.mjs','scripts/stop.mjs'])fs.copyFileSync(path.join(appRoot,file),path.join(source,file));
  const version=JSON.parse(fs.readFileSync(path.join(appRoot,'package.json'))).version;
  fs.writeFileSync(path.join(source,'server.mjs'),`import http from 'node:http'; const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({app:'rewster-command',pid:process.pid,version:${JSON.stringify(version)}}));});server.listen(Number(process.env.PORT),'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
  const http=await import('node:http');
  const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const env={...process.env,PORT:String(port),REWSTER_DATA_DIR:data,REWSTER_NO_OPEN:'1'};
  const invoke=file=>spawnSync(process.execPath,[path.join(source,'scripts',file)],{env,encoding:'utf8',timeout:45000});
  let pid;
  try{
    const started=invoke('launch.mjs');assert.equal(started.status,0,started.stderr);assert.match(started.stdout,/is ready/);
    pid=Number(fs.readFileSync(path.join(data,'server.pid'),'utf8'));
    const again=invoke('launch.mjs');assert.equal(again.status,0,again.stderr);assert.match(again.stdout,/already running/);
    assert.equal(Number(fs.readFileSync(path.join(data,'server.pid'),'utf8')),pid);
    fs.writeFileSync(path.join(data,'server.pid'),String(process.pid));
    const wrong=invoke('stop.mjs');assert.notEqual(wrong.status,0);assert.match(wrong.stderr,/identity/);
    fs.writeFileSync(path.join(data,'server.pid'),String(pid));
    const stopped=invoke('stop.mjs');assert.equal(stopped.status,0,stopped.stderr);assert(!fs.existsSync(path.join(data,'server.pid')));
  }finally{if(pid){try{process.kill(pid,'SIGTERM');}catch{}}fs.rmSync(temporary,{recursive:true,force:true});}
});


test('native updater build numbers advance with the package version',()=>{
 const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version;
 const [major,minor,patch]=version.split('.').map(Number),expected=major*10000+minor*100+patch;
 const project=fs.readFileSync(new URL('../apple/AndrewsAiBrain.xcodeproj/project.pbxproj',import.meta.url),'utf8');
 const builds=[...project.matchAll(/CURRENT_PROJECT_VERSION = "?(\d+)"?;/g)];assert.equal(builds.length,4);
 for(const match of builds)assert.equal(Number(match[1]),expected);
});
