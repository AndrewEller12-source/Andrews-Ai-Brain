// Dashboard summaries never replace the durable conversation stored by Codex.
export function dashboardJob(job){
 const {chatItems=[],events=[],...summary}=job;
 return {...summary,events:events.slice(-20),chatItems:['running','review','starting'].includes(job.status)?chatItems.filter(i=>['user','assistant'].includes(i.role)).slice(-4):[],chatItemsDeferred:true};
}

// One shared latest snapshot, at most one outstanding write per browser. Slow
// readers catch up to the newest state after drain instead of being disconnected.
export function createStateStream(snapshot,{interval=500}={}){
 const clients=new Map();let timer=null,latest=null;
 const remove=res=>clients.delete(res);
 function write(res,client,frame){
  if(res.destroyed||res.writableEnded){remove(res);return;}
  if(client.blocked){client.dirty=true;return;}
  client.dirty=false;
  try{client.blocked=!res.write(frame);}catch{remove(res);}
 }
 function flush(){timer=null;if(!clients.size)return;latest=`data: ${JSON.stringify(snapshot())}\n\n`;for(const [res,client] of clients)write(res,client,latest);}
 return {
  add(res){
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
   const client={blocked:false,dirty:false};clients.set(res,client);
   res.on('close',()=>remove(res));res.on('error',()=>remove(res));
   res.on('drain',()=>{client.blocked=false;if(client.dirty&&latest)write(res,client,latest);});
   // A new subscriber needs fresh state even if no broadcast occurred recently.
   latest=`data: ${JSON.stringify(snapshot())}\n\n`;write(res,client,latest);
  },
  publish(){if(!timer&&clients.size)timer=setTimeout(flush,interval);},
  heartbeat(){for(const [res,client] of clients)if(!client.blocked)write(res,client,`event: heartbeat\ndata: ${Date.now()}\n\n`);},
  close(){clearTimeout(timer);for(const res of clients.keys())res.end();clients.clear();},
 };
}
