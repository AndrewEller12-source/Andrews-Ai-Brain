import fs from 'node:fs';
import path from 'node:path';
import {dataDir} from '../runtime.mjs';
const url=`http://127.0.0.1:${Number(process.env.PORT||4780)}`;
try {
  const res=await fetch(`${url}/api/health`,{signal:AbortSignal.timeout(2000)});
  const health=await res.json();
  const pidFile=path.join(dataDir,'server.pid');
  const pid=Number(fs.readFileSync(pidFile,'utf8'));
  if(!res.ok||health.app!=='rewster-command'||health.pid!==pid||!Number.isInteger(pid)||pid<2)throw new Error('Server identity does not match saved launcher process; no process was stopped.');
  process.kill(pid,'SIGTERM');fs.rmSync(pidFile,{force:true});
  console.log('Stop requested. Any unfinished work will require outcome reconciliation on the next start.');
}catch(error){console.error(`Unable to stop Rewster Command: ${error.message}`);process.exitCode=1;}
