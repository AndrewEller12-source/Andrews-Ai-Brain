// Workspace identity and departments are local user data, never release defaults.
export function cleanName(value, kind='Department') {
 if(typeof value!=='string')throw Error(kind+' name is required');
 const name=value.trim().replace(/\s+/g,' ');
 if(!name||name.length>48||/[<>\x00-\x1f\x7f]/.test(value)||['__proto__','constructor','prototype'].includes(name.toLowerCase()))throw Error(kind+' name must be 1–48 characters without control characters or angle brackets');
 return name;
}
export function classify(text='', custom=[]) {
 const s=String(text).toLowerCase();
 const rule=custom.find(d=>d.keywords?.some(k=>s.includes(k.toLowerCase())));if(rule)return rule.name;
 for(const [name,pattern] of [
  ['3D Printing',/3d.?print|bambu|stl\b|filament|print.lab|prototype.{0,25}print/],
  ['Smart Home',/smart.home|home assistant|homekit|led lights|tailscale|device.control/],
  ['AI Systems',/ai.{0,15}agent|agent.{0,15}dashboard|rewster ai|task manager|codex sdk|agent orchestrat/],
  ['Web Development',/website|landing.page|web.app|wordpress|shopify|next\.js/],
  ['Photo Editing',/photoshop|lightroom|retouch|photo editing|edit.{0,20}photo|remove.{0,20}background/],
  ['Design',/illustrator|figma|graphic design|logo design|branding|typography/],
  ['Video Production',/video edit|premiere|davinci|after effects|film edit/],
  ['Purchasing',/purchas|supplier|restock|inventory|stockroom|sortly/],
  ['Growth',/content|filming|video|marketing|social|lead |referral|tiktok|instagram/],
  ['Finance',/invoice|billing|margin|cash flow|finance|reconcil|accounting/],
  ['Engineering',/build|code|bug|\bapi\b|\bapp\b|sdk|dashboard|software|test|deploy|integration/],
  ['Operations',/route|location|vending|contract|service|nayax|warehouse/],
  ['Research',/research|investigat|compare|analysis/],
  ['Writing',/write|writing|draft|essay|novel/],
  ['Learning',/learn|study|homework|explain/],
 ])if(pattern.test(s))return name;
 return 'General';
}
export function departmentCatalog(data,threads=[]) {
 const names=[...(data.customDepartments||[]).map(d=>d.name),...(data.jobs||[]).map(j=>j.department),...threads.map(t=>t.department)].filter(Boolean);
 return [...new Map(names.map(n=>[n.toLowerCase(),n])).values()].sort((a,b)=>a.localeCompare(b));
}
export function canonicalDepartment(name,data,threads=[]) {
 name=cleanName(name);return departmentCatalog(data,threads).find(d=>d.toLowerCase()===name.toLowerCase())||name;
}
export function addDepartment(data,input,threads=[]) {
 const name=canonicalDepartment(input.name,data,threads);
 if(input.keywords!==undefined&&typeof input.keywords!=='string')throw Error('Keywords must be comma-separated text');
 const keywords=(input.keywords||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(keywords.length>20||keywords.some(k=>k.length>60))throw Error('Use up to 20 keywords, each under 60 characters');
 const entry={name,keywords};const at=data.customDepartments.findIndex(d=>d.name.toLowerCase()===name.toLowerCase());
 if(at<0){if(data.customDepartments.length>=100)throw Error('Maximum of 100 custom departments');data.customDepartments.push(entry)}else data.customDepartments[at]=entry;
 return entry;
}
export function migrateOrganization(data){
 data.customDepartments??=[];
 data.settings.workspaceName??='My workspace';
 if(data.organizationVersion===1)return;
 for(const j of data.jobs||[])if(!data.overrides?.[j.threadId]&&!j.options?.department)j.department=classify(j.prompt||j.title,data.customDepartments);
 data.organizationVersion=1;
}


export function evolveOrganization(data,threads,now=Date.now()){
 data.settings.autoDepartments??=true;data.settings.autoManagers??=true;
 data.organizationEnabledAt??=now;data.departmentManagers??={};data.manualDepartments??={};
 let changed=false;
 for(const t of threads){
  const jobs=(data.jobs||[]).filter(j=>j.threadId===t.id&&!j.managerForDepartment),last=jobs.at(-1);
  const explicit=data.manualDepartments[t.id]||last?.options?.department;
  const override=data.overrides?.[t.id];
  // Legacy overrides with no matching routed request may be manual assignments.
  const broad=['General','Engineering','Research','Writing','Growth','Operations','Purchasing','Finance'];
  const routedSpecialty=last?.department&&!broad.includes(last.department)?last.department:null;
  const preserved=explicit||routedSpecialty||(override&&(!last||override!==last.department)?override:null);
  if(data.settings.autoDepartments&&!preserved){
   const titleClass=classify(t.title,data.customDepartments),specific=titleClass!=='General';
   const candidate=specific?titleClass:classify(last?.prompt||t.preview||t.title,data.customDepartments);
   const name=candidate==='General'?t.department:candidate;
   if(name&&name!==t.department){t.department=name;changed=true;for(const j of jobs)if(!j.options?.department)j.department=name;if(override)data.overrides[t.id]=name;}
  }else if(preserved)t.department=preserved;
  if(t.department&&!data.departmentManagers[t.department]&&!['__proto__','constructor','prototype'].includes(t.department)){
   data.departmentManagers[t.department]={department:t.department,createdAt:now,lastReviewedAt:0};changed=true;
  }
 }
 return changed;
}
