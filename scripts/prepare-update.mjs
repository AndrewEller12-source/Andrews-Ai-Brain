// Prepare signed, immutable release assets. The private update key stays in Keychain.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {releaseFiles} from './package-release.mjs';
const run=(bin,args,options={})=>execFileSync(bin,args,{encoding:'utf8',...options}).trim();
function canonicalHttps(value,label,trailingSlash=false){
 if(!value)throw Error(`Set ${label} for the customer release.`);
 let url;try{url=new URL(value);}catch{throw Error(`${label} must be a valid HTTPS URL.`);}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error(`${label} must be a canonical HTTPS URL without credentials, query or fragment.`);
 const result=url.toString();if(trailingSlash&&!result.endsWith('/'))throw Error(`${label} must end with a slash.`);return result;
}
const version=JSON.parse(fs.readFileSync('package.json')).version;
const app=path.resolve(process.argv[2]||'/tmp/ai-task-manager-native-build/Build/Products/Release/Ai Task Manager.app');
const sparkle=path.resolve(process.argv[3]||'/tmp/ai-task-manager-native-build/SourcePackages/artifacts/sparkle/Sparkle/bin');
const policy=process.env.REWSTER_RELEASE_PRIVACY_POLICY;
if(!policy||!fs.statSync(policy).isFile())throw Error('Set REWSTER_RELEASE_PRIVACY_POLICY to a private off-repository policy file before preparing a release.');
const feedUrl=canonicalHttps(process.env.REWSTER_UPDATE_FEED_URL,'REWSTER_UPDATE_FEED_URL');
const downloadPrefix=canonicalHttps(process.env.REWSTER_RELEASE_DOWNLOAD_PREFIX,'REWSTER_RELEASE_DOWNLOAD_PREFIX',true);
const destination=path.resolve('dist',`publish-${version}`);
if(fs.existsSync(destination))throw Error('Release output already exists; preserve immutable assets and use a new version or review the unpublished staging directory.');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'task-manager-update-'));
try {
const plist=path.join(app,'Contents/Info.plist');
if(run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',plist])!==version)throw Error('Build version differs from source');
const [major,minor,patch]=version.split('.').map(Number);
const expectedBuild=major*10000+minor*100+patch;
if(run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',plist])!==String(expectedBuild))throw Error('Updater build number differs from release version');
if(run('/usr/libexec/PlistBuddy',['-c','Print :SUFeedURL',plist])!==feedUrl)throw Error('Built app update feed differs from the approved release feed.');
run('/usr/bin/codesign',['--verify','--deep','--strict',app]);
const archive=path.join(output,`Ai-Task-Manager-Mac-${version}.zip`);fs.rmSync(archive,{force:true});
run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,archive]);
const source=path.join(output,`Ai-Task-Manager-Source-${version}.zip`);
const sourcePaths=[...new Set([...releaseFiles,'apple'])];
run('/usr/bin/git',['diff','--quiet','HEAD','--',...sourcePaths]);
run('/usr/bin/git',['archive','--format=zip','--prefix=Ai-Task-Manager-Source/','-o',source,'HEAD',...sourcePaths]);
// Inspect the exact distributable bytes, including native binaries and source.
// Failure happens before signing or creating publishable output. Never bundle the policy.
run('python3',['scripts/check-release-privacy.py','--policy',path.resolve(policy),'--report',path.join(output,'PRIVACY-CHECK.json'),archive,source]);
run(path.join(sparkle,'generate_appcast'),['--account','ai-task-manager-releases','--maximum-deltas','0','--download-url-prefix',downloadPrefix,output]);

if(!fs.existsSync(path.join(output,'appcast-neutral.xml')))fs.renameSync(path.join(output,'appcast.xml'),path.join(output,'appcast-neutral.xml'));
// A package can replace the old bundle identity; ordinary app ZIP updates cannot.
const packageRoot=path.join(output,'package-root');fs.mkdirSync(packageRoot);
run('/usr/bin/ditto',[app,path.join(packageRoot,'Ai Task Manager.app')]);
const components=path.join(output,'components.plist');
fs.writeFileSync(components,'<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><array><dict><key>RootRelativeBundlePath</key><string>Ai Task Manager.app</string><key>BundleIsRelocatable</key><false/><key>BundleIsVersionChecked</key><true/><key>BundleHasStrictIdentifier</key><false/><key>BundleOverwriteAction</key><string>upgrade</string></dict></array></plist>');
const migration=path.join(output,`Ai-Task-Manager-Migration-${version}.pkg`);
run('/usr/bin/pkgbuild',['--root',packageRoot,'--component-plist',components,'--identifier','ai.rewster.taskmanager.migration','--version',version,'--install-location','/Applications','--scripts','scripts/migration',migration]);
fs.rmSync(packageRoot,{recursive:true});fs.rmSync(components);
const signed=run(path.join(sparkle,'sign_update'),['--account','ai-task-manager-releases',migration]);
const signature=signed.match(/sparkle:edSignature="([^"]+)"/)?.[1];
if(!signature)throw Error('Migration package Ed25519 signature missing.');
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const packageURL=downloadPrefix+path.basename(migration);
fs.writeFileSync(path.join(output,'appcast.xml'),`<?xml version="1.0" encoding="utf-8"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Ai Task Manager updates</title><item><title>Ai Task Manager ${xml(version)}</title><sparkle:version>${expectedBuild}</sparkle:version><sparkle:shortVersionString>${xml(version)}</sparkle:shortVersionString><sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion><description>Installs the neutral app identity and preserves your local workspace. macOS will ask for administrator authorization once. Running work must finish before installation.</description><enclosure url="${xml(packageURL)}" sparkle:version="${expectedBuild}" sparkle:shortVersionString="${xml(version)}" sparkle:installationType="package" sparkle:edSignature="${xml(signature)}" length="${fs.statSync(migration).size}" type="application/octet-stream"/></item></channel></rss>\n`);

run('python3',['scripts/check-release-privacy.py','--policy',path.resolve(policy),'--report',path.join(output,'PRIVACY-CHECK.json'),archive,source,migration,path.join(output,'appcast.xml'),path.join(output,'appcast-neutral.xml')]);
const assets=fs.readdirSync(output).filter(f=>f.endsWith('.zip')||f.endsWith('.pkg')||f.endsWith('.xml'));
fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),assets.map(f=>createHash('sha256').update(fs.readFileSync(path.join(output,f))).digest('hex')+'  '+f).join('\n')+'\n');
// Keep internal audit details out of the public release asset directory.
fs.mkdirSync(path.dirname(destination),{recursive:true});
fs.copyFileSync(path.join(output,'PRIVACY-CHECK.json'),path.join(path.dirname(destination),`privacy-${version}.json`));
fs.rmSync(path.join(output,'PRIVACY-CHECK.json'));
fs.cpSync(output,destination,{recursive:true,errorOnExist:true,force:false});
console.log(destination);
} finally { fs.rmSync(output,{recursive:true,force:true}); }
