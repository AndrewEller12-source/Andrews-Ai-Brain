import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {EventEmitter} from 'node:events';
import {codexCommand} from './runtime.mjs';
export class CodexBridge extends EventEmitter{
 constructor(){super();this.pending=new Map();this.seq=0;this.generation=0;this.connected=false;this.connecting=null;}
 connect(){if(this.connected)return Promise.resolve();if(this.connecting)return this.connecting;this.connecting=this.open().finally(()=>{this.connecting=null});return this.connecting;}
 async open(){
  const spec=codexCommand(['app-server']);const generation=++this.generation;
  this.process=spawn(spec.command,spec.args,{stdio:['pipe','pipe','pipe'],env:{...process.env,...spec.env},windowsHide:true});const child=this.process;
  child.on('error',e=>{if(generation===this.generation)this.disconnect(e)});child.on('exit',()=>{if(generation===this.generation)this.disconnect(Error('Codex connection closed. Reconnect to restore control.'))});child.stdin.on('error',e=>{if(generation===this.generation)this.disconnect(e)});child.stderr.on('data',()=>{});
  readline.createInterface({input:child.stdout}).on('line',line=>{if(generation!==this.generation)return;let m;try{m=JSON.parse(line)}catch{return;}if(m.method)this.emit(m.id!==undefined?'request':'notification',m);else{const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);if(m.error){const e=Error(m.error.message);e.rpcCode=m.error.code;p.reject(e)}else p.resolve(m.result)}}});
  try{await this.call('initialize',{clientInfo:{name:'ai_task_manager',title:'Ai Task Manager',version:'0.10.0'},capabilities:{experimentalApi:true}});this.send({method:'initialized'});this.connected=true;}catch(e){child.kill();throw e;}
 }
 send(m){if(!this.process?.stdin.writable||this.process.killed)throw Error('Codex is disconnected');this.process.stdin.write(JSON.stringify(m)+'\n');}
 call(method,params={},timeout=30000){return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);const e=Error(`${method} timed out; outcome may be unconfirmed`);e.uncertain=true;reject(e)},timeout);this.pending.set(id,{resolve,reject,timer});try{this.send({id,method,params})}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e)}})}
 reply(id,result){this.send({id,result});}
 disconnect(e){const was=this.connected||this.pending.size;this.connected=false;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e)}this.pending.clear();if(was)this.emit('disconnected',e);}
 close(){++this.generation;this.disconnect(Error('Codex connection stopped'));this.process?.kill();}
}
