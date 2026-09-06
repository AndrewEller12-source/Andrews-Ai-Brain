import {spawnSync} from 'node:child_process';
import {getRuntimeInfo,codexCommand} from '../runtime.mjs';
const info=getRuntimeInfo();
console.log(JSON.stringify(info,null,2));
if(!info.codexAvailable){process.exitCode=1;}else{
  const {command,args}=codexCommand(['--version']);
  const result=spawnSync(command,args,{encoding:'utf8',timeout:10000});
  console.log((result.stdout||result.stderr||result.error?.message||'No CLI response').trim());
  if(result.status!==0)process.exitCode=1;
}
console.log('This diagnostic does not run a model or print authentication tokens.');
