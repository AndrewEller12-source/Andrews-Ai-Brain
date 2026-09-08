// Prepare signed, immutable release assets. The private update key stays in Keychain.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const run=(bin,args,options={})=>execFileSync(bin,args,{encoding:'utf8',...options}).trim();
const version=JSON.parse(fs.readFileSync('package.json')).version;
const app=path.resolve(process.argv[2]||'/tmp/ai-task-manager-native-build/Build/Products/Release/Ai Task Manager.app');
const sparkle=path.resolve(process.argv[3]||'/tmp/ai-task-manager-native-build/SourcePackages/artifacts/sparkle/Sparkle/bin');
const policy=process.env.REWSTER_RELEASE_PRIVACY_POLICY;
if(!policy||!fs.statSync(policy).isFile())throw Error('Set REWSTER_RELEASE_PRIVACY_POLICY to a private off-repository policy file before preparing a release.');
const destination=path.resolve('dist',`publish-${version}`);
if(fs.existsSync(destination))throw Error('Release output already exists; preserve immutable assets and use a new version or review the unpublished staging directory.');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'task-manager-update-'));
try {
const plist=path.join(app,'Contents/Info.plist');
if(run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',plist])!==version)throw Error('Build version differs from source');
const [major,minor,patch]=version.split('.').map(Number);
const expectedBuild=major*10000+minor*100+patch;
if(run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',plist])!==String(expectedBuild))throw Error('Updater build number differs from release version');
run('/usr/bin/codesign',['--verify','--deep','--strict',app]);
const archive=path.join(output,`Ai-Task-Manager-Mac-${version}.zip`);fs.rmSync(archive,{force:true});
run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,archive]);
const source=path.join(output,`Ai-Task-Manager-Source-${version}.zip`);
run('/usr/bin/git',['archive','--format=zip','--prefix=Ai-Task-Manager-Source/','-o',source,'HEAD']);
// Inspect the exact distributable bytes, including native binaries and source.
// Failure happens before signing or creating publishable output. Never bundle the policy.
run('python3',['scripts/check-release-privacy.py','--policy',path.resolve(policy),'--report',path.join(output,'PRIVACY-CHECK.json'),archive,source]);
run(path.join(sparkle,'generate_appcast'),['--account','ai-task-manager-releases','--maximum-deltas','0','--download-url-prefix',`https://github.com/AndrewEller12-source/Andrews-Ai-Brain/releases/download/v${version}/`,output]);
const assets=fs.readdirSync(output).filter(f=>f.endsWith('.zip')||f==='appcast.xml');
fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),assets.map(f=>createHash('sha256').update(fs.readFileSync(path.join(output,f))).digest('hex')+'  '+f).join('\n')+'\n');
// Keep internal audit details out of the public release asset directory.
fs.mkdirSync(path.dirname(destination),{recursive:true});
fs.copyFileSync(path.join(output,'PRIVACY-CHECK.json'),path.join(path.dirname(destination),`privacy-${version}.json`));
fs.rmSync(path.join(output,'PRIVACY-CHECK.json'));
fs.cpSync(output,destination,{recursive:true,errorOnExist:true,force:false});
console.log(destination);
} finally { fs.rmSync(output,{recursive:true,force:true}); }
