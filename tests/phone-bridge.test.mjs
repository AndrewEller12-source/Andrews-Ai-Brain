import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import http from 'node:http';import https from 'node:https';
import {execFileSync} from 'node:child_process';import {randomBytes} from 'node:crypto';
import {createPhoneBridge} from '../phone-bridge.mjs';
let directory,key,cert;
const token=randomBytes(32).toString('base64url');
before(()=>{
 directory=fs.mkdtempSync(path.join(os.tmpdir(),'phone-bridge-tests-'));
 const keyPath=path.join(directory,'key.pem'),certPath=path.join(directory,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
 key=fs.readFileSync(keyPath);cert=fs.readFileSync(certPath);
});
after(()=>fs.rmSync(directory,{recursive:true,force:true}));
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
function close(server){server.closeAllConnections?.();return new Promise(resolve=>server.close(resolve))}
async function fixture(t,handler){
 const calls=[],upstream=http.createServer((req,res)=>{calls.push({method:req.method,path:req.url,headers:req.headers});handler?handler(req,res):res.end('upstream response')});
 const upstreamPort=await listen(upstream),bridge=createPhoneBridge({key,cert,token,upstreamPort}),port=await listen(bridge),origin=`https://127.0.0.1:${port}`;
 t.after(async()=>{await close(bridge);await close(upstream)});
 return {calls,upstream,upstreamPort,bridge,port,origin};
}
function request(f,{path='/',method='GET',headers={},body}={}){
 return new Promise((resolve,reject)=>{const req=https.request({hostname:'127.0.0.1',port:f.port,path,method,rejectUnauthorized:false,headers},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));res.on('error',reject)});req.on('error',reject);req.end(body)});
}
const paired=extra=>({Cookie:`brain_pair=${token}`,...extra});

test('every phone path requires exactly one valid pairing cookie',async t=>{
 const f=await fixture(t);
 for(const path of ['/','/app.js','/api/state','/api/events'])assert.equal((await request(f,{path})).status,401);
 for(const Cookie of [`brain_pair=${'x'.repeat(43)}`,`brain_pair=${token}; brain_pair=${token}`,`other=${token}`,`brain_pair=${token.slice(1)}`])assert.equal((await request(f,{headers:{Cookie}})).status,401);
 assert.equal(f.calls.length,0);assert.equal((await request(f,{headers:paired()})).status,200);assert.equal(f.calls.length,1);
});
test('paired requests rewrite loopback host and origin while stripping credential and forwarding headers',async t=>{
 const f=await fixture(t,(req,res)=>{let body='';req.on('data',d=>body+=d);req.on('end',()=>{res.setHeader('set-cookie','upstream_session=must-not-escape');res.setHeader('Connection','x-internal');res.setHeader('x-internal','private');res.end(body)})});
 const result=await request(f,{path:'/api/intake?fixture=1',method:'POST',headers:paired({Cookie:`another=cookie; brain_pair=${token}`,Origin:f.origin,'X-Rewster-Request':'1','Content-Type':'application/json',Authorization:'Bearer fixture-only',Forwarded:'for=fixture','X-Forwarded-For':'fixture','X-Forwarded-Host':'fixture'}),body:'{"fixture":true}'});
 assert.equal(result.status,200);assert.equal(result.text,'{"fixture":true}');const call=f.calls[0];assert.equal(call.path,'/api/intake?fixture=1');assert.equal(call.headers.host,`127.0.0.1:${f.upstreamPort}`);assert.equal(call.headers.origin,`http://127.0.0.1:${f.upstreamPort}`);
 for(const header of ['cookie','authorization','forwarded','x-forwarded-for','x-forwarded-host'])assert.equal(call.headers[header],undefined);
 assert.equal(result.headers['set-cookie'],undefined);assert.equal(result.headers['x-internal'],undefined);assert.equal(result.headers['cache-control'],'no-store');
});
test('cross-origin and cross-site writes are rejected even with a valid pairing cookie',async t=>{
 const f=await fixture(t);
 for(const headers of [paired({Origin:'https://foreign.invalid','X-Rewster-Request':'1'}),paired({Origin:f.origin,'Sec-Fetch-Site':'cross-site','X-Rewster-Request':'1'}),paired({Origin:f.origin})])assert.equal((await request(f,{method:'POST',path:'/api/intake',headers,body:'{}'})).status,403);
 assert.equal(f.calls.length,0);assert.equal((await request(f,{method:'DELETE',headers:paired()})).status,405);
});
test('phone sign-in directs the user to the Mac without starting an unusable OAuth callback',async t=>{
 const f=await fixture(t);
 const result=await request(f,{method:'POST',path:'/api/auth/login',headers:paired({Origin:f.origin,'X-Rewster-Request':'1'}),body:'{}'});
 assert.equal(result.status,409);assert.match(result.text,/Mac app first/);assert.equal(f.calls.length,0);
});
test('SSE data streams immediately and does not wait for the upstream response to close',async t=>{
 let ended=false;const f=await fixture(t,(req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();res.write('data: {"connected":true}\n\n');const timer=setTimeout(()=>{ended=true;res.end('data: {"done":true}\n\n')},1000);res.on('close',()=>clearTimeout(timer))});
 const first=await new Promise((resolve,reject)=>{const req=https.request({hostname:'127.0.0.1',port:f.port,path:'/api/events',rejectUnauthorized:false,headers:paired()},res=>{res.once('data',data=>{resolve({text:data.toString(),type:res.headers['content-type'],status:res.statusCode});req.destroy()});res.on('error',()=>{})});req.on('error',reject);req.setTimeout(2000,()=>req.destroy(Error('SSE did not stream')));req.end()});
 assert.equal(first.status,200);assert.match(first.type,/text\/event-stream/);assert.match(first.text,/connected/);assert.equal(ended,false);
});
test('unavailable loopback upstream returns an explicit 502 without leaking connection details',async t=>{
 const temporary=http.createServer(),upstreamPort=await listen(temporary);await close(temporary);const bridge=createPhoneBridge({key,cert,token,upstreamPort}),port=await listen(bridge);t.after(()=>close(bridge));
 const result=await request({port},{headers:paired()});assert.equal(result.status,502);assert.match(result.text,/unavailable/i);assert.ok(!result.text.includes(token));assert.ok(!result.text.includes('ECONNREFUSED'));
});
test('phone bridge rejects weak configuration, absolute request targets, and oversized writes',async t=>{
 assert.throws(()=>createPhoneBridge({key,cert,token:'weak',upstreamPort:4780}),/strong/);assert.throws(()=>createPhoneBridge({key,cert,token,upstreamPort:0}),/port/);
 const f=await fixture(t,(req,res)=>{req.resume();req.on('end',()=>res.end('accepted'))});for(const path of ['//foreign.invalid/api/state','http://foreign.invalid/api/state'])assert.equal((await request(f,{path,headers:paired()})).status,400);
 const result=await request(f,{method:'POST',headers:paired({Origin:f.origin,'X-Rewster-Request':'1'}),body:'x'.repeat(2*1024*1024+1)});assert.equal(result.status,413);
});

test('paired photo uploads accept image-sized bodies without raising other API limits',async t=>{
 let received=0;const f=await fixture(t,(req,res)=>{req.on('data',chunk=>received+=chunk.length);req.on('end',()=>res.end(String(received)))}),headers=paired({Origin:f.origin,'X-Rewster-Request':'1','Content-Type':'image/png'}),bytes=Buffer.alloc(3*1024*1024,1);
 const photo=await request(f,{path:'/api/attachments?name=design.png',method:'POST',headers,body:bytes});assert.equal(photo.status,200);assert.equal(Number(photo.text),bytes.length);
 const oversized=await request(f,{path:'/api/attachments',method:'POST',headers,body:Buffer.alloc(12*1024*1024+1)});assert.equal(oversized.status,413);
 const ordinary=await request(f,{path:'/api/intake',method:'POST',headers,body:bytes});assert.equal(ordinary.status,413);
});
