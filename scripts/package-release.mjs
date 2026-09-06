import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const releaseFiles = [
  'rewster-supervisor.mjs',
  'package.json','pnpm-lock.yaml','pnpm-workspace.yaml',
  'server.mjs','bridge.mjs','core.mjs','universes.mjs','universe-discovery.mjs','organization.mjs','managers.mjs','upgrade.mjs','media.mjs','artifacts.mjs','conversation.mjs','runtime.mjs','approval.mjs','activity.mjs','desktop.mjs','desktop-frames.mjs','desktop-control.mjs','notifications.mjs','turn-request.mjs',
  'app.js','index.html','style.css','README.md','TREY-QUICKSTART.md','APPLE-APPS.md','phone-bridge.mjs',
  'Start Rewster Command.command','Stop Rewster Command.command',
  'Start Rewster Command.cmd','Stop Rewster Command.cmd',
  'scripts/launch.mjs','scripts/stop.mjs','scripts/doctor.mjs',
  'scripts/sdk-smoke.mjs','scripts/app-smoke.mjs','scripts/package-release.mjs','scripts/package-mac.mjs','scripts/verify-mac-package.mjs','scripts/phone-bridge.mjs','scripts/stage-apple-runtime.mjs',
];
export function stageRelease(source,destination) {
  fs.mkdirSync(destination,{recursive:true});
  for(const relative of releaseFiles){
    const from=path.join(source,relative),to=path.join(destination,relative);
    if(!fs.existsSync(from))throw new Error(`Required release file missing: ${relative}`);
    if(!fs.lstatSync(from).isFile())throw new Error(`Release input must be a regular file: ${relative}`);
    const content=fs.readFileSync(from);
    // Refuse common personal home paths, credential tokens and accidental credentials files.
    if(/\/(?:Users|home)\/[a-zA-Z][\w.-]*\//.test(content.toString())||/sk-(?:proj-)?[a-zA-Z0-9_-]{32,}/.test(content.toString()))throw new Error(`Personal path or credential pattern found in ${relative}; release aborted.`);
    fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);fs.chmodSync(to,relative.endsWith('.command')?0o755:0o644);
  }
  const manifest=releaseFiles.map(file=>({file,sha256:createHash('sha256').update(fs.readFileSync(path.join(destination,file))).digest('hex')}));
  fs.writeFileSync(path.join(destination,'RELEASE-MANIFEST.json'),JSON.stringify({application:'Rewster Command',version:JSON.parse(fs.readFileSync(path.join(source,'package.json'))).version,files:manifest},null,2)+'\n');
  return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const output=path.resolve(process.argv[2]||path.join(source,'dist'));
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-release-'));
  try{
    const folder='Rewster Command';stageRelease(source,path.join(temporary,folder));fs.mkdirSync(output,{recursive:true});
    const archive=path.join(output,'Rewster-Command-0.2.0.tar.gz');
    execFileSync('tar',['-czf',archive,'-C',temporary,folder]);
    console.log(archive);
    if(process.platform!=='win32'){
      const zip=path.join(output,'Rewster-Command-0.2.0.zip');
      try{fs.rmSync(zip,{force:true});execFileSync('zip',['-q','-r',zip,folder],{cwd:temporary});console.log(zip);}catch(error){console.warn(`ZIP unavailable; tar.gz is ready (${error.message}).`);}
    }
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
