import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const blocked = filename => /(?:^|\/)(?:\.ssh|\.aws|\.gnupg)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:auth|credentials)\.json$|\.(?:pem|key)$/i.test(filename);
export function conversationLinks(text) {
 const clean=String(text||'').replace(/```[\s\S]*?```/g,'').replace(/`(https?:\/\/[^`\s]+)`/g,'$1').replace(/`[^`\n]*`/g,'');
 const result=[];
 for(const match of clean.matchAll(/(?<!!)\[([^\]\n]+)\]\(\s*(?:<([^>\n]+)>|([^\s]+(?:\s+"[^"]*")?))\s*\)/g))result.push({name:match[1],target:(match[2]||match[3]).replace(/\s+"[^"]*"$/,'')});
 for(const match of clean.matchAll(/https?:\/\/[^\s<>"\])]+/g))if(!result.some(r=>r.target===match[0]))result.push({name:match[0],target:match[0]});
 return result.slice(0,100);
}
export class ArtifactStore {
 constructor(directory){this.directory=directory;fs.mkdirSync(directory,{recursive:true,mode:0o700});this.index=path.join(directory,'index.json');this.entries=fs.existsSync(this.index)?JSON.parse(fs.readFileSync(this.index,'utf8')):{};}
 save(){fs.writeFileSync(this.index+'.tmp',JSON.stringify(this.entries),{mode:0o600});fs.renameSync(this.index+'.tmp',this.index);}
 reference(target,{threadId,name,cwd,role='assistant',turnId}={}) {
  if(!threadId||typeof target!=='string')return null;
  const original=target;
  if(/^https?:\/\//i.test(target)){
   try{const url=new URL(target);if(url.username||url.password)return null;const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);return {id:createHash('sha256').update(threadId+target).digest('hex').slice(0,24),kind:local?'preview':'link',name:name||url.hostname,url:url.href,target:original,role,turnId,local};}catch{return null}
  }
  try{target=decodeURI(target.replace(/^file:\/\//,''));}catch{return null}
  target=target.replace(/:\d+(?::\d+)?$/,'');
  if(!path.isAbsolute(target)){if(!cwd||(!target.includes('/')&&!/^[\w .-]+\.[\w]+$/.test(target)))return null;target=path.resolve(cwd,target);}
  const id=createHash('sha256').update(threadId+'\0'+target).digest('hex').slice(0,32);
  const base={id,kind:'file',name:name||path.basename(target),filename:path.basename(target),target:original,role,turnId};
  if(blocked(target))return {...base,unavailable:true,reason:'This sensitive file cannot be shared through Outputs.'};
  try{
   const real=fs.realpathSync(target);if(blocked(real))throw Error('restricted');const stat=fs.statSync(real);if(!stat.isFile())return {...base,unavailable:true,reason:'This is a folder. Open its project on the Mac.'};
   const entry={threadId,path:target,real,filename:path.basename(real),size:stat.size};
   if(JSON.stringify(this.entries[id])!==JSON.stringify(entry)){this.entries[id]=entry;this.save()}
   return {...base,size:stat.size,url:'/api/files/'+id,downloadUrl:'/api/files/'+id+'?download=1'};
  }catch{return {...base,unavailable:true,reason:'This file is no longer available on this Mac.'}}
 }
 get(id){const entry=this.entries[id];if(!entry)throw Error('Unknown output file');const real=fs.realpathSync(entry.path);if(real!==entry.real||blocked(real)||!fs.statSync(real).isFile())throw Error('The output file moved or is unavailable');return {...entry,real};}
}
