import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('phone access closes if its native parent exits unexpectedly',{skip:process.platform!=='darwin',timeout:20000},async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'brain-parent-test-'));
  const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const script=fileURLToPath(new URL('../scripts/phone-bridge.mjs',import.meta.url));
  const parent=spawn(process.execPath,['--input-type=module','-e',`import {spawn} from 'node:child_process'; const child=spawn(process.execPath,[process.argv[1]],{stdio:'ignore',env:process.env});console.log(child.pid);setInterval(()=>{},1000);`,script],{env:{...process.env,REWSTER_DATA_DIR:directory,BRAIN_PHONE_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let childPid;
  const pause=()=>new Promise(resolve=>setTimeout(resolve,150));
  const connected=()=>new Promise(resolve=>{const req=https.get({hostname:'127.0.0.1',port,path:'/',rejectUnauthorized:false},res=>{res.resume();resolve(res.statusCode===401)});req.on('error',()=>resolve(false));req.setTimeout(500,()=>{req.destroy();resolve(false)});});
  try {
    childPid=await new Promise((resolve,reject)=>{parent.stdout.once('data',data=>resolve(Number(data.toString().trim())));parent.once('error',reject)});
    let started=false;for(let i=0;i<65;i++){if(await connected()){started=true;break;}await pause();}
    assert.equal(started,true,'Phone listener did not start');
    parent.kill('SIGKILL');
    let stopped=false;for(let i=0;i<40;i++){if(!await connected()){stopped=true;break;}await pause();}
    assert.equal(stopped,true,'Phone listener survived loss of its native parent');
  } finally {
    parent.kill('SIGKILL');if(childPid){try{process.kill(childPid,'SIGTERM')}catch{}}
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
