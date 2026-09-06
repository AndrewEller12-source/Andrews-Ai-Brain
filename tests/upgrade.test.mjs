import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import {pendingUpgradeJobs,newerVersion} from '../upgrade.mjs';
test('version comparison and unfinished-work guard include approvals and queued requests',()=>{
 assert.equal(newerVersion('0.4.0','0.3.0'),true);assert.equal(newerVersion('0.4.0','0.10.0'),false);assert.equal(newerVersion('0.4.0','0.4.0'),false);
 assert.deepEqual(pendingUpgradeJobs(['review','ready','running','uncertain','completed'].map(status=>({status}))).map(j=>j.status),['review','ready','running']);
});
test('launcher refuses to interrupt approvals, then upgrades an idle engine with state intact',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ai-upgrade-')),app=path.join(root,'app'),data=path.join(root,'data');fs.mkdirSync(path.join(app,'scripts'),{recursive:true});fs.mkdirSync(data);
 for(const file of ['runtime.mjs','upgrade.mjs','scripts/launch.mjs','scripts/stop.mjs'])fs.copyFileSync(new URL('../'+file,import.meta.url),path.join(app,file));
 fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({type:'module',version:'0.3.0'}));
 fs.writeFileSync(path.join(data,'state.json'),JSON.stringify({settings:{paused:false,workspaceName:'Preserved Studio'},jobs:[{id:'approval',status:'review',turnId:'exact-turn'}]}));
 fs.writeFileSync(path.join(app,'server.mjs'),`import http from 'node:http';import fs from 'node:fs';import path from 'node:path';const file=path.join(process.env.REWSTER_DATA_DIR,'state.json'),version=JSON.parse(fs.readFileSync(new URL('./package.json',import.meta.url))).version;const server=http.createServer(async(req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/api/health')return res.end(JSON.stringify({app:'rewster-command',version,pid:process.pid}));let state=JSON.parse(fs.readFileSync(file));if(req.method==='POST'){let text='';for await(const c of req)text+=c;Object.assign(state.settings,JSON.parse(text));fs.writeFileSync(file,JSON.stringify(state));}res.end(JSON.stringify(state));});server.listen(Number(process.env.PORT),'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const env={...process.env,PORT:String(port),REWSTER_DATA_DIR:data,REWSTER_NO_OPEN:'1'},invoke=()=>spawnSync(process.execPath,[path.join(app,'scripts/launch.mjs')],{env,encoding:'utf8',timeout:20000});
 t.after(()=>{try{process.kill(Number(fs.readFileSync(path.join(data,'server.pid'))),'SIGTERM')}catch{}fs.rmSync(root,{recursive:true,force:true})});
 assert.equal(invoke().status,0);const oldPid=Number(fs.readFileSync(path.join(data,'server.pid')));fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({type:'module',version:'0.4.0'}));
 const blocked=invoke();assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/unfinished requests/);process.kill(oldPid,0);
 const state=JSON.parse(fs.readFileSync(path.join(data,'state.json')));state.jobs[0].status='completed';fs.writeFileSync(path.join(data,'state.json'),JSON.stringify(state));
 const upgraded=invoke();assert.equal(upgraded.status,0,upgraded.stderr);assert.notEqual(Number(fs.readFileSync(path.join(data,'server.pid'))),oldPid);const next=JSON.parse(fs.readFileSync(path.join(data,'state.json')));assert.equal(next.settings.workspaceName,'Preserved Studio');assert.equal(next.settings.paused,false);assert.equal(next.jobs[0].turnId,'exact-turn');
});
