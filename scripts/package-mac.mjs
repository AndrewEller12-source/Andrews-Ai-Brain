// Build a clean Mac distribution. Downloads only pinned upstream runtimes/dependencies.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {stageRelease} from './package-release.mjs';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(fs.readFileSync(path.join(source,'package.json'))).version;
const arch=process.argv[2]||process.arch;if(!['arm64','x64'].includes(arch))throw Error('Choose arm64 or x64');
const nodeVersion='v24.19.0',nodeFile=`node-${nodeVersion}-darwin-${arch}.tar.gz`,base=`https://nodejs.org/dist/${nodeVersion}/`;
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'rewster-mac-build-')),folder='Rewster Command',staged=path.join(temporary,folder);
const output=path.join(source,'dist',`Ai-Task-Manager-${version}-macOS-${arch}.zip`);
const policy=process.env.REWSTER_RELEASE_PRIVACY_POLICY;
if(!policy||!fs.statSync(policy).isFile())throw Error('Set REWSTER_RELEASE_PRIVACY_POLICY to the private customer-release policy.');
if(fs.existsSync(output))throw Error('Release output already exists; use a new version and preserve immutable artifacts.');
async function download(url){const res=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!res.ok)throw Error(`Download failed: ${res.status} ${url}`);return Buffer.from(await res.arrayBuffer());}
try{
 stageRelease(source,staged);
 const checksums=(await download(base+'SHASUMS256.txt')).toString();
 const expected=checksums.split('\n').find(line=>line.endsWith('  '+nodeFile))?.split(/\s/)[0];if(!expected)throw Error('Official Node checksum missing');
 const archive=await download(base+nodeFile);if(createHash('sha256').update(archive).digest('hex')!==expected)throw Error('Node checksum mismatch');
 const downloaded=path.join(temporary,nodeFile);fs.writeFileSync(downloaded,archive);execFileSync('tar',['-xzf',downloaded,'-C',temporary]);
 const nodeRoot=path.join(temporary,`node-${nodeVersion}-darwin-${arch}`);fs.mkdirSync(path.join(staged,'runtime','bin'),{recursive:true});
 fs.copyFileSync(path.join(nodeRoot,'bin','node'),path.join(staged,'runtime','bin','node'));fs.chmodSync(path.join(staged,'runtime','bin','node'),0o755);
 fs.copyFileSync(path.join(nodeRoot,'LICENSE'),path.join(staged,'runtime','LICENSE'));fs.writeFileSync(path.join(staged,'runtime','architecture'),arch+'\n');
 // Run the downloaded npm JS using the build host Node, targeting the recipient architecture.
 const npmCli=path.join(nodeRoot,'lib','node_modules','npm','bin','npm-cli.js');
 execFileSync(process.execPath,[npmCli,'install','--omit=dev','--ignore-scripts','--no-audit','--no-fund',`--cpu=${arch}`,'--os=darwin'],{cwd:staged,stdio:'pipe',timeout:120000});
 const notices=path.join(staged,'THIRD-PARTY');fs.mkdirSync(notices);
 for(const name of ['LICENSE','NOTICE'])fs.writeFileSync(path.join(notices,`CODEX-${name}`),await download(`https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/${name}`));
 fs.writeFileSync(path.join(notices,'README.txt'),`Node.js ${nodeVersion}: https://nodejs.org/ (full license in runtime/LICENSE).\nOpenAI Codex CLI and TypeScript SDK 0.153.4: https://github.com/openai/codex/tree/rust-v0.153.4 . Codex license/notice reproduced here; SDK LICENSE is included in node_modules/@openai/codex-sdk.\nOriginal published npm packages are included without modification.\n`);
 const entries=[];
 function walk(directory){for(const name of fs.readdirSync(directory)){const file=path.join(directory,name),relative=path.relative(staged,file).split(path.sep).join('/'),stat=fs.lstatSync(file);if(relative==='RELEASE-MANIFEST.json')continue;if(stat.isSymbolicLink()){const target=fs.readlinkSync(file);const resolved=path.resolve(path.dirname(file),target);if(!resolved.startsWith(staged+path.sep))throw Error('External symlink in package');entries.push({file:relative,link:target});}else if(stat.isDirectory()){if(['.local','.codex'].includes(name))throw Error('Private folder in package');walk(file);}else{entries.push({file:relative,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}}}
 walk(staged);fs.writeFileSync(path.join(staged,'RELEASE-MANIFEST.json'),JSON.stringify({application:'Ai Task Manager',version,platform:'darwin',architecture:arch,nodeVersion,nodeSource:base+nodeFile,nodeSha256:expected,files:entries},null,2)+'\n');
 fs.mkdirSync(path.dirname(output),{recursive:true});execFileSync('zip',['-q','-y','-r',output,folder],{cwd:temporary,timeout:180000});
 execFileSync('python3',[path.join(source,'scripts/check-release-privacy.py'),'--policy',path.resolve(policy),'--report',path.join(source,'dist',`privacy-portable-mac-${version}-${arch}.json`),output],{stdio:'pipe',timeout:180000});
 console.log(JSON.stringify({archive:output,architecture:arch,files:entries.length,bytes:fs.statSync(output).size,nodeSha256:expected}));
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
