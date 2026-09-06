// Offline recipient installation check; does not log in or run a model.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {execFileSync,spawnSync}from'node:child_process';import assert from 'node:assert/strict';import {createHash}from'node:crypto';import {fileURLToPath}from'node:url';
if(process.platform!=='darwin')throw Error('Run this verification on macOS.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const archive=path.resolve(process.argv[2]||path.join(root,'dist',`Rewster-Command-0.2.0-macOS-${process.arch}.zip`));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-bundled-install-')),app=path.join(temp,'Rewster Command'),home=path.join(temp,'recipient');fs.mkdirSync(home);
const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
try{
 execFileSync('unzip',['-q',archive,'-d',temp]);
 const manifest=JSON.parse(fs.readFileSync(path.join(app,'RELEASE-MANIFEST.json')));assert.equal(manifest.architecture,process.arch,'Package architecture must match the test Mac.');
 for(const entry of manifest.files){const file=path.join(app,entry.file);if(entry.link)assert.equal(fs.readlinkSync(file),entry.link);else assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),entry.sha256,entry.file);}
 assert(!fs.existsSync(path.join(app,'.local')));assert(!fs.existsSync(path.join(app,'projects.json')));assert(!fs.existsSync(path.join(app,'.codex')));
 const env={PATH:'/usr/bin:/bin',HOME:home,PORT:String(port),CODEX_HOME:path.join(temp,'empty-codex'),REWSTER_DATA_DIR:path.join(temp,'data'),REWSTER_NO_OPEN:'1'};fs.mkdirSync(env.CODEX_HOME);
 const start=spawnSync('/bin/bash',['Start Rewster Command.command'],{cwd:app,env,encoding:'utf8',timeout:45000});assert.equal(start.status,0,start.stderr);
 let state;for(let i=0;i<40;i++){state=await(await fetch(`http://127.0.0.1:${port}/api/state`)).json();if(state.connected&&state.account?.status==='signedOut')break;await new Promise(r=>setTimeout(r,500));}
 assert.equal(state.connected,true);assert.equal(state.account.status,'signedOut');assert.equal(state.jobs.length,0);assert.equal(state.threads.length,0);assert.equal(state.projects.length,0);
 const help=await fetch(`http://127.0.0.1:${port}/help`);assert.equal(help.status,200);assert.match(await help.text(),/Start Rewster Command/);
 const imported=spawnSync(path.join(app,'runtime/bin/node'),['--input-type=module','-e','import {Codex} from "@openai/codex-sdk";import {resolveCodexBinary} from "./runtime.mjs";console.log(typeof Codex,resolveCodexBinary())'],{cwd:app,env,encoding:'utf8',timeout:15000});assert.equal(imported.status,0,imported.stderr);assert.match(imported.stdout,/function/);assert(imported.stdout.includes(app));
 const stop=spawnSync('/bin/bash',['Stop Rewster Command.command'],{cwd:app,env,encoding:'utf8',timeout:10000});assert.equal(stop.status,0,stop.stderr);
 console.log(JSON.stringify({passed:true,architecture:process.arch,systemNodeOrNpmRequired:false,launcherStartAndStop:true,manifestFilesVerified:manifest.files.length,realCodexConnected:true,accountStatus:state.account.status,recipientTasks:state.jobs.length,sdkImport:true,helpPage:true}));
}finally{const pidFile=path.join(temp,'data/server.pid');if(fs.existsSync(pidFile)){try{process.kill(Number(fs.readFileSync(pidFile)),'SIGTERM');}catch{}}fs.rmSync(temp,{recursive:true,force:true});}
