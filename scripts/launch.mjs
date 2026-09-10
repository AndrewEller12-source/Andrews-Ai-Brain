import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pendingUpgradeJobs,newerVersion,savedServerState} from '../upgrade.mjs';
import {appRoot,dataDir} from '../runtime.mjs';
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<12))throw new Error('Node.js 22.12 or newer is required.');
const port=Number(process.env.PORT||4780);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be between 1 and 65535.');
const url=`http://127.0.0.1:${port}`;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function isReady(){try{const response=await fetch(`${url}/api/health`,{signal:AbortSignal.timeout(1500)});const data=await response.json();return response.ok&&data.app==='rewster-command';}catch{return false;}}
function openBrowser(){if(process.env.REWSTER_NO_OPEN==='1')return;const command=process.platform==='darwin'?'open':process.platform==='win32'?'explorer.exe':'xdg-open';const child=spawn(command,[url],{stdio:'ignore',detached:true});child.on('error',()=>console.log(`Open ${url} in your browser.`));child.unref();}
if(await isReady()){
 const health=await (await fetch(url+'/api/health')).json(),version=JSON.parse(fs.readFileSync(path.join(appRoot,'package.json'))).version;
 if(!newerVersion(version,health.version)){openBrowser();console.log(`Ai Task Manager is already running: ${url}`);process.exit(0);}
 const state=await (await fetch(url+'/api/state')).json(),pending=pendingUpgradeJobs(state.jobs);
 if(pending.length)throw Error(`Update ready. Finish the ${pending.length} unfinished requests in the current workspace before upgrading. Your running engine has been left in place.`);
 const savedPid=Number(fs.readFileSync(path.join(dataDir,'server.pid'),'utf8'));
 if(!Number.isInteger(savedPid)||savedPid<2||savedPid!==health.pid)throw Error('The older workspace is not owned by this launcher. Stop it normally before opening the update.');
 // Pause dispatch before the last check so new intake stays durably queued during upgrade.
 const setPaused=async paused=>{const r=await fetch(url+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Rewster-Request':'1'},body:JSON.stringify({paused})});if(!r.ok)throw Error('Could not pause the older workspace for upgrade');};
 await setPaused(true);
 if(pendingUpgradeJobs((await (await fetch(url+'/api/state')).json()).jobs).some(j=>!['queued','ready'].includes(j.status))){await setPaused(!!state.settings.paused);throw Error('New work arrived. Finish it before upgrading.');}
 process.kill(savedPid,'SIGTERM');
 let stopped=false;for(let i=0;i<100;i++){try{process.kill(savedPid,0)}catch(e){if(e.code==='ESRCH'){stopped=true;break;}throw e;}await wait(100);}
 if(!stopped)throw Error('The older workspace is still shutting down. Open the update again shortly.');
 const stateFile=path.join(dataDir,'state.json'),savedState=JSON.parse(fs.readFileSync(stateFile));savedState.settings.paused=!!state.settings.paused;fs.writeFileSync(stateFile+'.upgrade',JSON.stringify(savedState),{mode:0o600});fs.renameSync(stateFile+'.upgrade',stateFile);
 if(Number(fs.readFileSync(path.join(dataDir,'server.pid'),'utf8'))===savedPid)fs.rmSync(path.join(dataDir,'server.pid'),{force:true});
}

fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
const pidFile=path.join(dataDir,'server.pid');
if(fs.existsSync(pidFile)){
 const saved=fs.readFileSync(pidFile,'utf8'),pid=Number(saved);
 const status=await savedServerState(pid,{savedAt:fs.statSync(pidFile).mtimeMs});
 if(status!=='stale')throw Error(`The saved workspace process (${pid}) ${status==='running'?'is still running but is not responding':'could not be identified safely'}. No process was stopped. Check ${dataDir} for its log before restarting.`);
 if(fs.readFileSync(pidFile,'utf8')!==saved)throw Error('Another launcher changed the workspace process. Open the app again.');
 fs.rmSync(pidFile);
}
const log=fs.openSync(path.join(dataDir,'server.log'),'a',0o600);
const child=spawn(process.execPath,[path.join(appRoot,'server.mjs')],{cwd:appRoot,detached:true,stdio:['ignore',log,log],env:process.env});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
fs.closeSync(log);
fs.writeFileSync(pidFile,String(child.pid),{mode:0o600});
child.unref();
for(let i=0;i<60;i++){if(await isReady()){openBrowser();console.log(`Ai Task Manager is ready: ${url}`);process.exit(0);}await wait(500);}
console.error(`Server did not become ready. Review ${path.join(dataDir,'server.log')}.`);process.exitCode=1;
