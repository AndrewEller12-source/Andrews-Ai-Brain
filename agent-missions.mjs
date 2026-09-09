import {universeById,universeScope} from './universes.mjs';
const protectedKeys=new Set(['__proto__','prototype','constructor']);
function home(data,universeId){const u=universeById(data,universeId);if(u?.deletedAt)throw Error('This universe was deleted.');return u||data;}
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('Enter '+label+' (up to '+max+' characters).');return value.trim();}
export function agentMission(data,universeId,thread){
 const root=home(data,universeId),saved=root.agentMissions?.[thread.id];
 const first=(data.jobs||[]).find(j=>j.threadId===thread.id&&!j.managerForDepartment&&!j.rewsterReview&&!j.godRequestId);
 return saved||{role:(thread.title||'Agent').slice(0,160),goal:(first?.originalRequest||first?.prompt||thread.preview||thread.title||'Define this agent’s assignment.').slice(0,2000),doneWhen:'Complete the requested deliverable and report the result or specific blocker.',source:'assignment'};
}
export function departmentGoal(data,universeId,department){const root=home(data,universeId);return root.departmentGoals?.[department]||{goal:'Advance '+department+' work toward '+(root.name||data.settings?.workspaceName||'the workspace')+' objectives.',source:'suggested'};}
export function saveMission(data,{universeId=null,threadId,role,goal,doneWhen},threads=data.threadCatalog||[]){
 const scope=universeScope(data,universeId,threads,data.projects||[]),t=scope.threads.find(t=>t.id===threadId&&!t.archived&&!t.catalogMissing);
 if(!t||protectedKeys.has(threadId))throw Error('Choose an agent in this universe.');
 const value={role:text(role,160,'a role'),goal:text(goal,2000,'a goal'),doneWhen:text(doneWhen,1000,'a completion condition'),source:'owner',updatedAt:Date.now()};
 const root=home(data,universeId);root.agentMissions??={};root.agentMissions[threadId]=value;return value;
}
export function saveDepartmentGoal(data,{universeId=null,department,goal},threads=data.threadCatalog||[]){
 const scope=universeScope(data,universeId,threads,data.projects||[]);home(data,universeId);
 if(protectedKeys.has(department)||!scope.threads.some(t=>t.department===department)&&!scope.customDepartments.some(d=>d.name===department))throw Error('Choose a department in this universe.');
 const root=home(data,universeId);root.departmentGoals??={};return root.departmentGoals[department]={goal:text(goal,2000,'a department goal'),source:'owner',updatedAt:Date.now()};
}
