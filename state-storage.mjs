// Full messages and tool output belong to Codex conversation history. The
// dashboard persists bounded live excerpts so telemetry cannot bloat every save.
export function compactJobTelemetry(job){
 if(job.chatItems){const active=['running','review','starting'].includes(job.status);job.chatItems=active?job.chatItems.slice(-24).map(i=>({...i,text:typeof i.text==='string'?i.text.slice(-6000):i.text})):[];}
 if(job.events)job.events=job.events.slice(-30).map(e=>({...e,text:typeof e.text==='string'?e.text.slice(-2000):e.text}));
}
export function compactTelemetry(data){for(const job of data.jobs||[])compactJobTelemetry(job);}
