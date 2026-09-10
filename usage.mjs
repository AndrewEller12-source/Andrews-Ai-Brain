import {randomUUID} from 'node:crypto';
// Local activity accounting, not a conversion to credits or a billing statement.
// Only new ephemeral coordinator threads report complete token totals here.
export function recordAIRequest(data,{kind,model,inputCharacters=0,automatic=false,at=Date.now()}){
 data.aiUsage??=[];const row={id:randomUUID(),kind,model,automatic,at,inputCharacters,tokens:null};
 data.aiUsage.push(row);data.aiUsage=data.aiUsage.filter(r=>r.at>at-14*86400000).slice(-10000);return row;
}
export function recordCoordinatorTokens(row,usage){
 const total=usage?.total;if(!row||!total)return;
 const n=key=>Number.isFinite(total[key])&&total[key]>=0?total[key]:0;
 row.tokens={input:n('inputTokens'),cachedInput:n('cachedInputTokens'),output:n('outputTokens')};
}
export function usageSummary(data,now=Date.now()){
 const rows=(data.aiUsage||[]).filter(r=>r.at>=now-86400000),groups={};
 for(const r of rows){const key=r.kind+' / '+r.model;const g=groups[key]??={kind:r.kind,model:r.model,requests:0,automatic:0,inputCharacters:0,inputTokens:0,cachedInputTokens:0,outputTokens:0,tokenReports:0};g.requests++;g.automatic+=r.automatic?1:0;g.inputCharacters+=r.inputCharacters||0;if(r.tokens){g.tokenReports++;g.inputTokens+=r.tokens.input;g.cachedInputTokens+=r.tokens.cachedInput;g.outputTokens+=r.tokens.output;}}
 return {since:rows[0]?.at||null,requests:rows.length,automatic:rows.filter(r=>r.automatic).length,groups:Object.values(groups),note:'Last 24 hours recorded by this version. Requests are not credits. Token totals cover new coordinator threads only; employee turns and external Codex activity can consume additional credits.'};
}
