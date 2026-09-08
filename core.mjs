import {compactTelemetry,compactJobTelemetry} from './state-storage.mjs';
import {acceptUniverse} from './universes.mjs';
import fs from 'node:fs';
import {approvalModes} from './approval.mjs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {classify,cleanName,migrateOrganization} from './organization.mjs';
export {classify} from './organization.mjs';
export const canRetry=job=>['failed','uncertain'].includes(job.status)&&!job.executionDispatched&&!job.turnId;
const stable=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
export class Store{
 constructor(file){this.file=file;fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});this.data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{jobs:[],settings:{concurrency:4,paused:false},overrides:{},projects:[]};
 this.data.settings={concurrency:4,paused:false,...this.data.settings};if(!approvalModes.includes(this.data.settings.approvalMode))this.data.settings.approvalMode='manual';this.data.overrides??={};this.data.projects??=[];this.data.steers??=[];for(const receipt of [...this.data.steers,...Object.values(this.data.ownerMessages||{})])if(receipt.status==='sending'){receipt.status='uncertain';receipt.error='The dashboard restarted before delivery was confirmed. Inspect the active conversation before sending again.';}migrateOrganization(this.data);compactTelemetry(this.data);
 for(const j of this.data.jobs){j.events??=[];j.options??={};}
 for(const j of this.data.jobs)if(['running','routing','review','starting'].includes(j.status)){if(j.executionDispatched===undefined&&['starting','running','review'].includes(j.status))j.executionDispatched=true;j.recoveryNeeded=true;j.status='uncertain';j.error='The dashboard restarted during this request. Inspect the task before retrying; it may have run.'}this.save();}
 // Progress can arrive hundreds of times per second. Coalesce only telemetry;
 // intake, dispatch receipts, approvals and terminal states still call save().
 saveSoon(){if(!this.saveTimer)this.saveTimer=setTimeout(()=>this.save(),1000);}
 save(){clearTimeout(this.saveTimer);this.saveTimer=null;const tmp=this.file+'.tmp';const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(this.data));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,this.file);}
 accept(messages,key,options={},managed={}){
 if(typeof key!=='string'||key.length<8||key.length>160)throw Error('A valid request key is required.');
 if(!Array.isArray(messages)||!messages.length||messages.length>100||messages.some(t=>typeof t!=='string'||(!t.trim()&&!options.attachments?.length)||t.length>30000))throw Error('Send 1–100 nonempty messages, each under 30,000 characters.');
 const old=this.data.jobs.filter(j=>j.requestKey===key);if(old.length){if(JSON.stringify(old.map(j=>j.prompt))!==JSON.stringify(messages.map(t=>t.trim()))||stable(old[0].options)!==stable(options))throw Error('Request key already belongs to different messages.');return old;}
 const universe=acceptUniverse(this.data,options);
 const jobs=messages.map(prompt=>({id:randomUUID(),requestKey:key,prompt:prompt.trim(),title:prompt.trim().slice(0,100)||'Photo message',status:'queued',approvalMode:managed.origin==='rewster'?'manual':this.data.settings.approvalMode,universeId:universe.id,department:options.department||(options.threadId?this.data.threadCatalog?.find(t=>t.id===options.threadId)?.department:null)||classify(prompt,universe.customDepartments),createdAt:Date.now(),events:[],options,...(managed.origin==='rewster'?{origin:'rewster',...(managed.correctionRoot?{correctionRoot:managed.correctionRoot,originalRequest:managed.originalRequest}:{})}:{})}));this.data.jobs.push(...jobs);this.save();return jobs;
 }
 update(id,patch){const j=this.data.jobs.find(j=>j.id===id);if(!j)throw Error('Request not found');Object.assign(j,patch,{updatedAt:Date.now()});compactJobTelemetry(j);this.save();return j;}
}
export function chooseModel(tier,models){const preference={quick:['gpt-5.6-luna','gpt-5.3-codex-spark'],standard:['gpt-5.6-sol','gpt-5.6-terra'],deep:['gpt-6-astra','gpt-5.6-sol']};return preference[tier]?.map(n=>models.find(m=>m.model===n&&(!m.upgradeInfo?.retirementAt||m.upgradeInfo.retirementAt*1000>Date.now()))).find(Boolean)||models.find(m=>m.isDefault)||models[0];}
export function validateRoute(route,projects,threads){
 if(!(()=>{try{return cleanName(route.department)===route.department}catch{return false}})()||!['quick','standard','deep'].includes(route.tier)||!['chat','task'].includes(route.kind))throw Error('Router returned an invalid classification');
 if(route.projectId&&!projects.some(p=>p.projectId===route.projectId))throw Error('Router selected an unknown project');
 if(route.threadId&&!threads.some(t=>t.id===route.threadId))throw Error('Router selected an unknown task');
 if(typeof route.confidence!=='number'||route.confidence<0||route.confidence>1)throw Error('Router returned invalid confidence');
 if(typeof route.reason!=='string'||typeof route.title!=='string')throw Error('Router omitted its explanation');
 return route;
}
export function canRun(job,running){return !running.some(j=>j.threadId&&j.threadId===job.threadId||j.workspaceKey&&j.workspaceKey===job.workspaceKey);}
