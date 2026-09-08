import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

export const appRoot = path.dirname(fileURLToPath(import.meta.url));
export function defaultDataDir(platform=process.platform, home=os.homedir(), env=process.env) {
  if (env.REWSTER_DATA_DIR) return path.resolve(env.REWSTER_DATA_DIR);
  if (platform==='darwin') return path.join(home,'Library','Application Support','Rewster Command');
  if (platform==='win32') return path.join(env.LOCALAPPDATA || path.join(home,'AppData','Local'),'Rewster Command');
  return path.join(env.XDG_DATA_HOME || path.join(home,'.local','share'),'rewster-command');
}
export const dataDir = defaultDataDir();
// Pin first-run behavior before state.json is created. Existing installations
// retain their local profile; new installations never import a desktop login.
export function selectAccountProfile(directory,home=os.homedir(),env=process.env) {
  const marker=path.join(directory,'account-profile.json');let mode;
  if(fs.existsSync(marker)) {
    const saved=JSON.parse(fs.readFileSync(marker,'utf8'));
    if(saved.version!==1||!['isolated','legacy'].includes(saved.mode))throw Error('Invalid account profile configuration; refusing an implicit account fallback.');
    mode=saved.mode;
  } else mode=fs.existsSync(path.join(directory,'state.json'))?'legacy':'isolated';
  // Generic CODEX_HOME may be inherited from an unrelated launcher. Only an
  // app-specific override opts a new installation into an external profile.
  const override=env.REWSTER_CODEX_HOME||(mode==='legacy'?env.CODEX_HOME:undefined);
  return {mode,marker,directory,explicit:!!override,codexHome:path.resolve(override||(mode==='isolated'?path.join(directory,'accounts','codex'):path.join(home,'.codex')))};
}
export function pinAccountProfile(profile) {
  fs.mkdirSync(profile.directory,{recursive:true,mode:0o700});
  try{fs.writeFileSync(profile.marker,JSON.stringify({version:1,mode:profile.mode})+'\n',{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;const saved=JSON.parse(fs.readFileSync(profile.marker,'utf8'));if(saved.version!==1||saved.mode!==profile.mode)throw Error('Account profile changed during startup; restart before connecting.');}
  fs.mkdirSync(profile.codexHome,{recursive:true,mode:0o700});
}
export const accountProfile=selectAccountProfile(dataDir);
export const codexHome=accountProfile.codexHome;
export function accountProcessEnvironment(profile=accountProfile) {
  const env={CODEX_HOME:profile.codexHome};
  if(profile.mode==='isolated'&&!profile.explicit)for(const key of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','OPENAI_ACCESS_TOKEN','OPENAI_BASE_URL','OPENAI_ORG_ID','OPENAI_ORGANIZATION','OPENAI_PROJECT_ID'])env[key]=undefined;
  return env;
}
function executable(file) {try {fs.accessSync(file, process.platform==='win32'?fs.constants.F_OK:fs.constants.X_OK);return fs.statSync(file).isFile();}catch{return false;}}
function findOnPath(name) {
  for (const dir of (process.env.PATH||'').split(path.delimiter)) {
    if (!dir) continue;
    for (const suffix of process.platform==='win32'?['.exe','']:['']) {const candidate=path.join(dir,name+suffix);if(executable(candidate))return candidate;}
  }
  return null;
}
export function packagedCodexBinary() {
  try {
    const require=createRequire(import.meta.url);
    const cliPackage=require.resolve('@openai/codex/package.json');
    const cliRequire=createRequire(cliPackage);
    const target={darwin:{arm64:'aarch64-apple-darwin',x64:'x86_64-apple-darwin'},linux:{arm64:'aarch64-unknown-linux-musl',x64:'x86_64-unknown-linux-musl'},win32:{arm64:'aarch64-pc-windows-msvc',x64:'x86_64-pc-windows-msvc'}}[process.platform]?.[process.arch];
    if(!target)return null;
    const platformPackage=cliRequire.resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`);
    const candidate=path.join(path.dirname(platformPackage),'vendor',target,'bin',process.platform==='win32'?'codex.exe':'codex');
    return executable(candidate)?candidate:null;
  }catch{return null;}
}
export function resolveCodexBinary() {
  if(process.env.CODEX_BIN) {
    const override=path.resolve(process.env.CODEX_BIN);
    if(executable(override))return override;
    const onPath=findOnPath(process.env.CODEX_BIN);
    if(onPath)return onPath;
    throw new Error('CODEX_BIN does not point to an executable Codex CLI. Correct the path and restart.');
  }
  // Prefer the pinned native dependency so the SDK and app-server share a version.
  const packaged=packagedCodexBinary();if(packaged)return packaged;
  const installed=findOnPath('codex');if(installed)return installed;
  const candidates=process.platform==='darwin'?[
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    path.join(os.homedir(),'Applications','Codex.app','Contents','Resources','codex'),
    path.join(os.homedir(),'Applications','ChatGPT.app','Contents','Resources','codex')
  ]:process.platform==='win32'?[
    path.join(process.env.LOCALAPPDATA||os.homedir(),'Programs','Codex','resources','codex.exe')
  ]:[];
  const candidate=candidates.find(executable);if(candidate)return candidate;
  throw new Error('Codex CLI is missing. Run npm install --omit=dev in the app folder, or set CODEX_BIN to your Codex executable.');
}
export function codexCommand(args=[]) {
  const binary=resolveCodexBinary();
  const profileArgs=accountProfile.mode==='isolated'&&!accountProfile.explicit?['-c','cli_auth_credentials_store="file"']:[];
  const env=accountProcessEnvironment();
  return /\.(?:m?js)$/i.test(binary)?{command:process.execPath,args:[binary,...profileArgs,...args],env}:{command:binary,args:[...profileArgs,...args],env};
}
export function getRuntimeInfo() {
  let binary=null,error=null;try{binary=resolveCodexBinary();}catch(e){error=e.message;}
  return {platform:process.platform,architecture:process.arch,nodeVersion:process.versions.node,appRoot,dataDir,codexHome,codexBinary:binary,codexAvailable:!!binary,error};
}
