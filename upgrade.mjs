import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
async function processCommand(pid){
 if(process.platform==='win32')throw Error('Process identity unavailable');
 return (await exec('/bin/ps',['-ww','-p',String(pid),'-o','command='],{timeout:3000})).stdout.trim();
}
// A PID is reusable, especially after a reboot. Never treat its existence alone
// as proof that our server is still running, and never signal a reused PID.
export async function savedServerState(pid,{savedAt=Date.now(),bootAt=Date.now()-os.uptime()*1000,probe=n=>process.kill(n,0),command=processCommand}={}){
 if(!Number.isInteger(pid)||pid<2)return 'stale';
 if(savedAt<bootAt-30000)return 'stale';
 try{probe(pid)}catch(error){if(['ESRCH','EINVAL'].includes(error.code))return 'stale';if(error.code!=='EPERM')throw error;}
 try{
  const value=await command(pid);
  if(!value)return 'unknown';
  // Retain any potentially live server, including one started from an older app path.
  return /(?:^|[\/\\])server\.mjs(?:["']?\s|["']?$)/.test(value)?'running':'stale';
 }catch{return 'unknown';}
}
export const pendingUpgradeJobs=jobs=>(jobs||[]).filter(j=>['queued','routing','ready','starting','running','review'].includes(j.status));
export function newerVersion(candidate,current){
 const a=String(candidate||'0').split('.').map(Number),b=String(current||'0').split('.').map(Number);
 for(let i=0;i<3;i++){if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0)}return false;
}
