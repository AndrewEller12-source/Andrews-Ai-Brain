// Display names belong to persistent task identities, never to a turn or list position.
const names=['Athena','Tim','Atlas','Maya','Nova','Leo','Iris','Theo','Ada','Owen','Luna','Felix','Cleo','Max','Sage','Milo','Vera','Finn','Aria','Hugo','Freya','Jules','Nora','Kai','Zara','Eli','Lyra','Oscar','Mira','Rory','Dara','Ezra','Skye','Alex','Tess','Remy','Opal','Sam','Wren','Luca'];
export function validAgentName(value){if(typeof value!=='string'||!value.trim()||value.trim().length>40||!/^\p{L}[\p{L}\p{N} .'-]*$/u.test(value.trim()))throw Error('Use a name of 1–40 letters, numbers, spaces, apostrophes or hyphens.');return value.trim();}
export function ensureAgentNames(data,threads){
 data.agentNames??={};const used=new Set(Object.values(data.agentNames).map(n=>n.toLowerCase()));let next=0,changed=false;
 for(const t of [...threads].sort((a,b)=>Number(!!a.archived)-Number(!!b.archived)||a.id.localeCompare(b.id))){
  if(data.agentNames[t.id])continue;let name;try{name=validAgentName(t.agentName)}catch{}
  if(!name||used.has(name.toLowerCase()))do{const index=next++;name=names[index%names.length]+(index>=names.length?' '+(Math.floor(index/names.length)+1):'');}while(used.has(name.toLowerCase()));
  data.agentNames[t.id]=name;used.add(name.toLowerCase());changed=true;
 }return changed;
}
export function renameAgent(data,id,value){if(!data.agentNames?.[id])throw Error('Choose an existing agent.');const name=validAgentName(value);if(Object.entries(data.agentNames).some(([key,n])=>key!==id&&n.toLowerCase()===name.toLowerCase()))throw Error('That name belongs to another agent. Choose a different name.');data.agentNames[id]=name;return name;}
export function resolveAgent(data,threads,{threadId,agentName}){
 if(threadId){if(agentName&&(data.agentNames?.[threadId]||'').toLowerCase()!==String(agentName).trim().toLowerCase())throw Error('Agent name and task ID refer to different agents.');return threadId;}
 if(typeof agentName!=='string')throw Error('Choose an agent name or task ID.');
 const matches=threads.filter(t=>!t.archived&&!t.catalogMissing&&(data.agentNames?.[t.id]||t.agentName||'').toLowerCase()===agentName.trim().toLowerCase());
 if(matches.length!==1)throw Error('Agent name is unavailable or ambiguous. Choose the exact task.');return matches[0].id;
}
