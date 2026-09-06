import https from 'node:https';
import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';

const hopHeaders = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
function cleanHeaders(headers) {
  const additional = new Set(String(headers.connection || '').toLowerCase().split(',').map(s=>s.trim()));
  return Object.fromEntries(Object.entries(headers).filter(([name])=>!hopHeaders.has(name)&&!additional.has(name)));
}
function authorized(cookie, token) {
  const values = String(cookie || '').split(';').map(s=>s.trim()).filter(s=>s.startsWith('brain_pair='));
  if(values.length!==1)return false;
  const supplied=Buffer.from(values[0].slice('brain_pair='.length));
  const expected=Buffer.from(token);
  return supplied.length===expected.length && timingSafeEqual(supplied,expected);
}

// The upstream is deliberately fixed to loopback. Pairing grants dashboard access,
// while its existing per-action approval requirements remain in force.
export function createPhoneBridge({key,cert,token,upstreamPort=4780}) {
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(token))throw Error('A strong pairing token is required');
  if(!Number.isInteger(upstreamPort)||upstreamPort<1||upstreamPort>65535)throw Error('Invalid upstream port');
  const server=https.createServer({key,cert,minVersion:'TLSv1.2'},(req,res)=>{
    const reject=(status,error)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error}));};
    if(!authorized(req.headers.cookie,token))return reject(401,'Pair this device in the Mac app first.');
    if(!req.url?.startsWith('/')||req.url.startsWith('//'))return reject(400,'Invalid request path');
    if(!['GET','HEAD','POST'].includes(req.method))return reject(405,'Method not allowed');
    // A browser from a different origin must never exercise a paired session.
    if(req.headers.origin && req.headers.origin!==`https://${req.headers.host}`)return reject(403,'Same-origin request required');
    if(req.headers['sec-fetch-site']==='cross-site')return reject(403,'Same-origin request required');
    if(req.method==='POST'&&req.headers['x-rewster-request']!=='1')return reject(403,'Dashboard request header required');
    if(req.url.split('?')[0]==='/api/update/prepare')return reject(403,'Install updates from the Mac app.');
    if(req.method==='POST'&&req.url.split('?')[0]==='/api/auth/login')return reject(409,'Sign in to Codex from the Mac app first, then reconnect this phone.');
    const headers=cleanHeaders(req.headers);
    delete headers.cookie;delete headers.authorization;delete headers['proxy-authorization'];
    delete headers['forwarded'];delete headers['x-forwarded-for'];delete headers['x-forwarded-host'];
    headers.host=`127.0.0.1:${upstreamPort}`;
    if(headers.origin)headers.origin=`http://${headers.host}`;
    const upstream=http.request({hostname:'127.0.0.1',port:upstreamPort,method:req.method,path:req.url,headers},response=>{
      const output=cleanHeaders(response.headers);
      delete output['set-cookie'];
      output['cache-control']='no-store';
      res.writeHead(response.statusCode||502,output);
      response.pipe(res);
      response.on('error',()=>res.destroy());
    });
    upstream.on('error',()=>{if(!res.headersSent)reject(502,'The Mac dashboard is unavailable. Open the Mac app and reconnect.');else res.destroy();});
    // Do not set a response timeout: event streams legitimately stay open.
    upstream.setTimeout(0);
    let bytes=0;
    req.on('data',chunk=>{bytes+=chunk.length;if(bytes>(req.url.split('?')[0]==='/api/attachments'?12:2)*1024*1024){upstream.destroy();if(!res.headersSent)reject(413,'Request is too large');req.unpipe(upstream);}});
    req.on('aborted',()=>upstream.destroy());
    res.on('close',()=>upstream.destroy());
    req.pipe(upstream);
  });
  server.headersTimeout=15000;
  server.requestTimeout=30000;
  return server;
}
