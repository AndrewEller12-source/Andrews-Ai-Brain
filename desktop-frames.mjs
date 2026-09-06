import json from 'stream-json';
const metadata=new Set(['id','title','cwd','parentThreadId','agentNickname','latestModel','rolloutPath','resumeState']);
const turnFields=new Set(['turnId','status','turnStartedAtMs','durationMs']);
const unsafe=k=>['__proto__','constructor','prototype'].includes(k);
function wanted(path){
 if(path.some(k=>typeof k==='string'&&unsafe(k)))return false;
 const start=path.indexOf('conversationState');
 if(start>=0){const p=path.slice(start+1);if(!p.length)return true;
  if(metadata.has(p[0]))return p.length===1;
  if(p[0]==='threadRuntimeStatus')return p.length===1||['type','activeFlags'].includes(p[1]);
  if(p[0]==='turnHistory')return p.length===1||p[1]==='history'&&(p.length===2||p[2]==='entitiesByKey'&&(p.length<=4||p.length===5&&turnFields.has(p[4])));
  if(p[0]==='turns')return p.length<=2||p.length===3&&turnFields.has(p[2]);
  return false;
 }
 // Patch envelopes and receipts need metadata, never message bodies or tool output.
 return !path.some(k=>['items','messages','content','input','output','reasoning','text','assets'].includes(k));
}
export class DesktopFrameDecoder{
 constructor(onMessage,onError){this.onMessage=onMessage;this.onError=onError;this.header=Buffer.alloc(4);this.headerBytes=0;this.remaining=0;this.failed=false;this.frames=0;this.largestFrame=0;}
 begin(size){
  if(!size||size>1024*1024*1024)throw Error('Invalid desktop frame length');
  this.remaining=size;this.largestFrame=Math.max(this.largestFrame,size);
  const parser=this.parser=json.parser({packKeys:true,streamKeys:false,packStrings:false,streamStrings:true,packNumbers:true,streamNumbers:false});
  const stack=[];let root,string='',keepString=false,nodes=0;
  const nextPath=()=>{const p=stack.at(-1);return p?[...p.path,Array.isArray(p.value)?p.index:p.key]:[]};
  const put=(value,keep)=>{const p=stack.at(-1);if(!p){root=value;return;}if(p.keep&&keep){if(++nodes>100000)throw Error('Desktop metadata exceeds supported size');if(Array.isArray(p.value))p.value.push(value);else p.value[p.key]=value;}if(Array.isArray(p.value))p.index++;};
  parser.on('data',token=>{if(this.failed)return;try{const {name,value}=token;
   if(name==='keyValue'){stack.at(-1).key=value;return;}
   if(name==='startObject'||name==='startArray'){if(stack.length>128)throw Error('Desktop metadata is nested too deeply');const path=nextPath(),keep=(stack.at(-1)?.keep??true)&&wanted(path);stack.push({value:name==='startArray'?[]:{},path,keep,index:0,key:null});return;}
   if(name==='endObject'||name==='endArray'){const item=stack.pop();put(item.value,item.keep);return;}
   if(name==='startString'){string='';keepString=(stack.at(-1)?.keep??true)&&wanted(nextPath());return;}
   if(name==='stringChunk'){if(keepString){if(string.length+value.length>16384){keepString=false;string='';}else string+=value;}return;}
   if(name==='endString'){put(string,keepString);return;}
   if(['numberValue','nullValue','trueValue','falseValue'].includes(name))put(name==='numberValue'?Number(value):value,(stack.at(-1)?.keep??true)&&wanted(nextPath()));
  }catch(error){this.fail(error);}});
  parser.on('error',error=>this.fail(error));parser.on('end',()=>{if(!this.failed){this.frames++;try{this.onMessage(root)}catch(error){this.fail(error)}}});
 }
 push(chunk){if(this.failed)return;try{let at=0;while(at<chunk.length){if(!this.remaining){const n=Math.min(4-this.headerBytes,chunk.length-at);chunk.copy(this.header,this.headerBytes,at,at+n);at+=n;this.headerBytes+=n;if(this.headerBytes<4)return;this.headerBytes=0;this.begin(this.header.readUInt32LE(0));}
  const n=Math.min(this.remaining,chunk.length-at,65536);this.parser.write(chunk.subarray(at,at+n));at+=n;this.remaining-=n;if(!this.remaining){this.parser.end();this.parser=null;}if(this.failed)return;
 }}catch(error){this.fail(error);}}
 fail(error){if(this.failed)return;this.failed=true;this.parser?.destroy();this.onError(error);}
 close(){this.failed=true;this.parser?.destroy();}
}
