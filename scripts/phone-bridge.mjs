import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes,X509Certificate} from 'node:crypto';
import {dataDir} from '../runtime.mjs';
import {createPhoneBridge} from '../phone-bridge.mjs';

const directory=path.join(dataDir,'phone-access');
fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.chmodSync(directory,0o700);
const keyFile=path.join(directory,'server-key.pem'),certFile=path.join(directory,'server-cert.pem'),tokenFile=path.join(directory,'pairing-token');
if(!fs.existsSync(keyFile)||!fs.existsSync(certFile)){
  execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-sha256','-nodes','-keyout',keyFile,'-out',certFile,'-days','3650','-subj','/CN=Andrews Ai Brain'],{stdio:'ignore'});
}
for(const file of [keyFile,certFile])fs.chmodSync(file,0o600);
if(process.argv.includes('--rotate')||!fs.existsSync(tokenFile))fs.writeFileSync(tokenFile,randomBytes(32).toString('base64url'),{mode:0o600});
fs.chmodSync(tokenFile,0o600);
const token=fs.readFileSync(tokenFile,'utf8').trim(),cert=fs.readFileSync(certFile),key=fs.readFileSync(keyFile);
const port=Number(process.env.BRAIN_PHONE_PORT||4781);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid phone bridge port');
const interfaces=os.networkInterfaces();
const addresses=Object.entries(interfaces).sort(([a],[b])=>(a==='en0'?-1:b==='en0'?1:0)).flatMap(([,items])=>items||[]).filter(item=>item.family==='IPv4'&&!item.internal).map(item=>item.address);
const info={url:`https://${addresses[0]||'127.0.0.1'}:${port}`,token,fingerprint:new X509Certificate(cert).fingerprint256.replaceAll(':','').toLowerCase()};
if(process.argv.includes('--info'))console.log(JSON.stringify(info));
else {
  const server=createPhoneBridge({key,cert,token,upstreamPort:Number(process.env.PORT||4780)});
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Phone access is already running. Disable it in the other app first.':error.message);process.exitCode=1;});
  server.listen(port,'0.0.0.0',()=>console.log(JSON.stringify(info)));
  const stop=()=>{server.closeAllConnections();server.close(()=>process.exit(0));};
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
  // A native-app crash must not leave a network listener running indefinitely.
  const parent=process.ppid;
  const parentWatch=setInterval(()=>{if(process.ppid!==parent)stop();},2000);
  parentWatch.unref();server.on('close',()=>clearInterval(parentWatch));
}
