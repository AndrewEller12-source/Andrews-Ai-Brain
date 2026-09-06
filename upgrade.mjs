export const pendingUpgradeJobs=jobs=>(jobs||[]).filter(j=>['queued','routing','ready','starting','running','review'].includes(j.status));
export function newerVersion(candidate,current){
 const a=String(candidate||'0').split('.').map(Number),b=String(current||'0').split('.').map(Number);
 for(let i=0;i<3;i++){if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0)}return false;
}
