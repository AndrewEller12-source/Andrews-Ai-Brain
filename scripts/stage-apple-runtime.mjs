import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {stageRelease} from './package-release.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const arch=process.argv.includes('--x64')?'x64':'arm64';
const archive=path.join(root,'dist',`Ai-Task-Manager-${version}-macOS-${arch}.zip`);
if(!fs.existsSync(archive)||process.argv.includes('--fresh'))execFileSync(process.execPath,[path.join(root,'scripts/package-mac.mjs'),arch],{stdio:'inherit'});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'brain-apple-runtime-'));
const output=path.join(root,'apple','Runtime');
try{
  execFileSync('/usr/bin/unzip',['-q',archive,'-d',temp]);
  const release=path.join(temp,'Rewster Command');
  const manifest=JSON.parse(fs.readFileSync(path.join(release,'RELEASE-MANIFEST.json')));
  if(manifest.architecture!==arch)throw Error('Runtime architecture mismatch');
  // Validate every archived dependency before reusing it, then stage current source.
  for(const item of manifest.files){
    if(!item.file||path.isAbsolute(item.file)||item.file.split('/').includes('..'))throw Error('Unsafe manifest path');
    const file=path.join(release,item.file);
    if(item.sha256&&createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==item.sha256)throw Error(`Runtime checksum mismatch: ${item.file}`);
    if(item.link&&(fs.readlinkSync(file)!==item.link||!fs.realpathSync(file).startsWith(fs.realpathSync(release)+path.sep)))throw Error('Unsafe runtime symlink');
  }
  fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
  for(const directory of ['runtime','node_modules','THIRD-PARTY'])fs.cpSync(path.join(release,directory),path.join(output,directory),{recursive:true,verbatimSymlinks:true});
  stageRelease(root,output);
  console.log(`Staged current editable source and verified ${arch} runtime in apple/Runtime`);
}finally{fs.rmSync(temp,{recursive:true,force:true});}
