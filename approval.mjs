const kinds=['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/tool/requestUserInput','item/permissions/requestApproval','mcpServer/elicitation/request'];
export function approvalCapabilities(method,p={}){
 const supported=kinds.includes(method);
 // An explicit list is authoritative, including an empty list or amendment-only choices.
 const explicit=Array.isArray(p.availableDecisions)?p.availableDecisions:null;
 const decision=d=>explicit===null||explicit.includes(d);
 return {supported,canAccept:supported&&decision('accept')&&!(method==='mcpServer/elicitation/request'&&p.mode==='url'),canDecline:supported&&decision('decline')&&method!=='item/tool/requestUserInput',canCancel:supported&&decision('cancel')&&method!=='item/permissions/requestApproval'&&method!=='item/tool/requestUserInput'};
}
function validateForm(value,schema,path='form'){
 if(!schema||typeof schema!=='object')throw Error('The service did not provide a valid form schema');
 if(schema.enum&&!schema.enum.includes(value))throw Error(`${path}: choose a listed value`);
 if(Object.hasOwn(schema,'const')&&value!==schema.const)throw Error(`${path}: choose a listed value`);
 const alternatives=schema.oneOf||schema.anyOf;
 if(alternatives){if(!Array.isArray(alternatives)||alternatives.some(s=>!Object.hasOwn(s,'const')))throw Error(`${path}: this form constraint is unsupported`);if(!alternatives.some(s=>s.const===value))throw Error(`${path}: choose a listed value`);}
 if(schema.allOf||schema.not||schema.if||schema.$ref)throw Error(`${path}: this form constraint is unsupported`);
 const type=schema.type||(alternatives?.every(s=>typeof s.const==='string')?'string':undefined);
 if(type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${path}: an object is required`);
  for(const key of schema.required||[])if(!Object.hasOwn(value,key))throw Error(`${path}.${key} is required`);
  for(const [key,val]of Object.entries(value)){if(!Object.hasOwn(schema.properties||{},key))throw Error(`${path}.${key} is not requested`);validateForm(val,schema.properties[key],path+'.'+key)}
 }else if(type==='array'){
  if(!Array.isArray(value))throw Error(`${path}: an array is required`);
  if(schema.minItems!==undefined&&value.length<Number(schema.minItems)||schema.maxItems!==undefined&&value.length>Number(schema.maxItems))throw Error(`${path}: number of choices is out of range`);
  if(schema.uniqueItems&&new Set(value.map(v=>JSON.stringify(v))).size!==value.length)throw Error(`${path}: choices must be unique`);
  for(const [i,item]of value.entries())validateForm(item,schema.items,`${path}[${i}]`);
 }else if(type==='string'){
  if(typeof value!=='string')throw Error(`${path}: text is required`);
  if(schema.minLength!==undefined&&value.length<schema.minLength)throw Error(`${path}: text is too short`);
  if(schema.maxLength!==undefined&&value.length>schema.maxLength)throw Error(`${path}: text is too long`);
  if(schema.pattern!==undefined)throw Error(`${path}: this form constraint is unsupported`);
 }else if(type==='number'||type==='integer'){
  if(typeof value!=='number'||!Number.isFinite(value)||type==='integer'&&!Number.isInteger(value))throw Error(`${path}: a valid number is required`);
  if(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum)throw Error(`${path}: number is out of range`);
 }else if(type==='boolean'){if(typeof value!=='boolean')throw Error(`${path}: a boolean is required`)}
 else throw Error(`${path}: this form field type is unsupported; use the service's supported client`);
 return value;
}
export function approvalResponse(a,b){
 const p=a.params||{},method=a.method,caps=approvalCapabilities(method,p),decision=b.decision;
 if(!['accept','decline','cancel'].includes(decision))throw Error('Choose an explicit approval decision');
 if(decision==='accept'&&!caps.canAccept||decision==='decline'&&!caps.canDecline||decision==='cancel'&&!caps.canCancel)throw Error('This decision is not supported for this request');
 if(method==='item/tool/requestUserInput'){
  const answers=[];for(const q of p.questions||[]){const answer=b.answers?.[q.id];if(typeof answer!=='string'||!answer.trim()||answer.length>30000)throw Error('Answer every question in this request');answers.push([q.id,{answers:[answer.trim()]}])}return {answers:Object.fromEntries(answers)};
 }
 if(method==='item/permissions/requestApproval'){
  // RequestPermissionProfile uses null; GrantedPermissionProfile uses omitted fields.
  const permissions={};if(decision==='accept')for(const key of ['network','fileSystem'])if(p.permissions?.[key]!=null)permissions[key]=p.permissions[key];
  return {permissions,scope:'turn'};
 }
 if(method==='mcpServer/elicitation/request')return {action:decision,content:decision==='accept'?validateForm(b.content,p.requestedSchema):null,_meta:null};
 return {decision};
}


// Profiles apply to a submitted request, never to unrelated or already-running work.
export const approvalModes = ['manual', 'auto-review', 'full-auto'];
export function validateApprovalMode(mode) {
 if (!approvalModes.includes(mode)) throw Error('Choose a valid approval mode.');
 return mode;
}
export function approvalProfile(mode = 'manual', cwd) {
 validateApprovalMode(mode);
 const full = mode === 'full-auto';
 const common = {approvalPolicy: full ? 'never' : 'on-request', approvalsReviewer: mode === 'auto-review' ? 'auto_review' : 'user'};
 return {
  thread: {...common, sandbox: full ? 'danger-full-access' : 'workspace-write'},
  turn: {...common, sandboxPolicy: full ? {type:'dangerFullAccess'} : {type:'workspaceWrite', writableRoots:cwd ? [cwd] : [], networkAccess:false, excludeTmpdirEnvVar:false, excludeSlashTmp:false}}
 };
}
