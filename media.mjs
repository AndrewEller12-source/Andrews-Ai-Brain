import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
const run=promisify(execFile);
export const MAX_IMAGE_BYTES=12*1024*1024,MAX_ATTACHMENTS=8,MAX_ATTACHMENT_BYTES=40*1024*1024;
export const attachmentFormats=['image/png','image/jpeg','image/webp','image/gif',...(process.platform==='darwin'?['image/heic','image/heif']:[])];
export function isHeif(bytes){
 if(bytes.length<16||bytes.toString('ascii',4,8)!=='ftyp')return false;
 const size=bytes.readUInt32BE(0);if(size<16||size>Math.min(bytes.length,4096)||size%4)return false;
 const brands=[bytes.toString('ascii',8,12)];for(let i=16;i<size;i+=4)brands.push(bytes.toString('ascii',i,i+4));
 return !brands.some(b=>['avif','avis'].includes(b))&&brands.some(b=>['heic','heix','hevc','hevx','heim','heis','hevm','hevs','mif1','msf1'].includes(b));
}
export function imageType(bytes){
 if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',ext:'png'};
 if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {mime:'image/jpeg',ext:'jpg'};
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return {mime:'image/webp',ext:'webp'};
 if(bytes.length>=13&&['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)))return {mime:'image/gif',ext:'gif'};
 throw Error('Use a PNG, JPEG, WebP or GIF image. Export other design formats as an image first.');
}
const safeName=name=>path.basename(String(name||'Image').replace(/\\/g,'/')).replace(/[\x00-\x1f\x7f]/g,'').slice(0,160)||'Image';
export class MediaStore{
 constructor(dir){this.dir=dir;this.file=path.join(dir,'index.json');fs.mkdirSync(dir,{recursive:true,mode:0o700});this.entries=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[];this.hashes=new Map(this.entries.map(e=>[e.sha256,e]));this.paths=new Map();}
 save(){fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.entries),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}
 public(entry){return {id:entry.id,name:entry.name,mime:entry.mime,size:entry.size,url:'/api/media/'+entry.id};}
 get(id){const entry=this.entries.find(e=>e.id===id);if(!entry)throw Error('Image is unavailable. Attach it again.');return entry;}
 filename(id){const e=this.get(id);return path.join(this.dir,e.id+'.'+e.ext);}
 async putUpload(bytes,name='Photo'){
  if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
  if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw Error('Each image must be 12 MB or smaller.');
  if(!isHeif(bytes))return this.put(bytes,name);
  if(process.platform!=='darwin')throw Error('HEIC conversion requires the Mac app. Export this photo as JPEG or PNG and attach it again.');
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'task-manager-photo-'));let converted;
  try{
   await fs.promises.chmod(dir,0o700);
   const input=path.join(dir,'original.heic'),output=path.join(dir,'converted.jpg');
   await fs.promises.writeFile(input,bytes,{mode:0o600});
   await run('/usr/bin/sips',['-s','format','jpeg','-s','formatOptions','85',input,'--out',output],{timeout:60000,maxBuffer:64*1024});
   if((await fs.promises.stat(output)).size>MAX_IMAGE_BYTES){
    await run('/usr/bin/sips',['-Z','4096','-s','format','jpeg','-s','formatOptions','80',input,'--out',output],{timeout:60000,maxBuffer:64*1024});
   }
   if((await fs.promises.stat(output)).size>MAX_IMAGE_BYTES)throw Error('Converted image is too large');
   converted=await fs.promises.readFile(output);
   if(imageType(converted).mime!=='image/jpeg')throw Error('Conversion did not produce JPEG');
  }catch{throw Error('This HEIC photo could not be converted. Try exporting it as JPEG from Photos and attach it again.');}
  finally{await fs.promises.rm(dir,{recursive:true,force:true});}
  return this.put(converted,safeName(name).replace(/\.(heic|heif)$/i,'')+'.jpg');
 }
 put(bytes,name='Image',kind='upload'){
 if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw Error('Each image must be 12 MB or smaller.');
 const type=imageType(bytes),sha256=createHash('sha256').update(bytes).digest('hex'),existing=this.hashes.get(sha256);
 if(existing){if(kind==='upload'&&!existing.uploaded){existing.uploaded=true;this.save()}return this.public(existing);}
 if(this.entries.reduce((n,e)=>n+e.size,0)+bytes.length>2*1024**3)throw Error('Local image storage is full (2 GB).');
 const entry={id:randomUUID(),name:safeName(name),...type,sha256,size:bytes.length,uploaded:kind==='upload',createdAt:Date.now()};
 fs.writeFileSync(path.join(this.dir,entry.id+'.'+entry.ext),bytes,{mode:0o600,flag:'wx'});this.entries.push(entry);this.hashes.set(sha256,entry);this.save();return this.public(entry);
 }
 validate(ids){if(!Array.isArray(ids)||ids.length>MAX_ATTACHMENTS||new Set(ids).size!==ids.length)throw Error('Attach up to 8 different images.');const entries=ids.map(id=>{const e=this.get(id);if(!e.uploaded)throw Error('Attach this image before sending it.');if(!fs.existsSync(this.filename(id)))throw Error('An attached image is missing. Attach it again.');return e});if(entries.reduce((n,e)=>n+e.size,0)>MAX_ATTACHMENT_BYTES)throw Error('Keep the combined attachments under 40 MB.');return entries.map(e=>this.public(e));}
 inputs(ids=[]){return this.validate(ids).map(e=>({type:'localImage',path:this.filename(e.id)}));}
 reference(source,{name='Image',cwd,allowOutside=false}={}){
 try{
  if(typeof source!=='string'||!source)return null;
  if(source.startsWith('data:')){const m=source.match(/^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\r\n]+)$/);if(!m||m[1].length>MAX_IMAGE_BYTES*1.38)throw Error('Unsupported image data');return this.put(Buffer.from(m[1],'base64'),name,'output');}
  if(/^https?:\/\//i.test(source)){const u=new URL(source);if(u.protocol!=='https:'||u.username||u.password)throw Error('Unsupported image link');return {id:'remote:'+createHash('sha256').update(source).digest('hex').slice(0,20),name:safeName(name),remoteUrl:u.href,unavailable:true,reason:'External image. Open its source to view it.'};}
  if(source.startsWith('file:'))source=new URL(source).pathname;
  if(source.startsWith('sandbox:'))source=source.slice(8);
  let decoded=source;try{decoded=decodeURIComponent(source)}catch{}const file=path.resolve(cwd||this.dir,decoded),real=fs.realpathSync(file);
  if(!allowOutside){const roots=[cwd,this.dir].filter(Boolean).map(r=>fs.realpathSync(r));if(!roots.some(root=>real.startsWith(root+path.sep)))throw Error('Image is outside this task workspace');}
  const stat=fs.statSync(real);if(!stat.isFile()||stat.size>MAX_IMAGE_BYTES)throw Error('Unsupported image file');const cacheKey=real+':'+stat.mtimeMs+':'+stat.size;if(this.paths.has(cacheKey))return this.paths.get(cacheKey);
  const fd=fs.openSync(real,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let bytes;try{const current=fs.fstatSync(fd);if(!current.isFile()||current.size>MAX_IMAGE_BYTES)throw Error('Unsupported image file');bytes=Buffer.alloc(current.size);let offset=0;while(offset<bytes.length){const read=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!read)break;offset+=read;}bytes=bytes.subarray(0,offset)}finally{fs.closeSync(fd)}
  const image=this.put(bytes,name==='Image'?path.basename(real):name,'output');this.paths.set(cacheKey,image);if(this.paths.size>2000)this.paths.delete(this.paths.keys().next().value);return image;
 }catch{return {id:'missing:'+createHash('sha256').update(String(source)).digest('hex').slice(0,20),name:safeName(name),unavailable:true,reason:'Preview unavailable on this Mac. The file may have moved, be too large, or use an unsupported format.'};}
 }
}
export async function readImageBody(req){let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>MAX_IMAGE_BYTES)throw Error('Each image must be 12 MB or smaller.');parts.push(chunk)}return Buffer.concat(parts);}
