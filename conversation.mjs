import {conversationLinks} from './artifacts.mjs';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,24);
const cleanText=value=>typeof value==='string'?value.slice(0,150000):'';
// Only user-visible messages and tool results are rendered; raw reasoning is excluded.
export function normalizeConversationItem(row,media,{cwd,artifacts,threadId}={}){
 const item=row.item||row,turnId=row.turnId||null,type=item.type;
 if(['reasoning','hookPrompt','sleep','contextCompaction'].includes(type))return null;
 let role='activity',text='',images=[],label='',status=item.status||null;
 const add=(source,name,allowOutside=false)=>{const image=media.reference(source,{name,cwd,allowOutside});if(image&&!images.some(i=>i.id===image.id))images.push(image)};
 const blocks=content=>{for(const c of (Array.isArray(content)?content:[]).slice(0,40)){
  if(['text','inputText','input_text','output_text'].includes(c.type))text+=(text?'\n':'')+cleanText(c.text);
  else if(c.type==='localImage')add(c.path,c.name||'Reference image',true);
  else if(c.type==='image'&&c.data)add('data:'+c.mimeType+';base64,'+c.data,c.name||'Tool image',true);
  else if(['image','inputImage','input_image'].includes(c.type))add(c.url||c.imageUrl||c.image_url,c.name||'Image',true);
 }};
 if(type==='userMessage'){role='user';label='You';text=cleanText(item.text);blocks(item.content);}
 else if(type==='agentMessage'){role='assistant';label='Agent';text=cleanText(item.text);}
 else if(type==='imageGeneration'){role='assistant';label=status==='completed'?'Generated image':'Image generation';text=cleanText(item.failure?.message||item.revisedPrompt);if(item.savedPath)add(item.savedPath,'Generated image',true);if(item.result&&!images.some(i=>i.url)){images=[];const value=item.result;add(value.startsWith('data:')||value.startsWith('https:')?value:'data:image/png;base64,'+value,'Generated image',true);}}
 else if(type==='imageView'){label='Viewing image';add(item.path,'Viewed image',true);}
 else if(type==='mcpToolCall'){label=[item.server,item.tool].filter(Boolean).join(' / ')||'Tool';blocks(item.result?.content);if(item.error?.message)text=cleanText(item.error.message);}
 else if(type==='dynamicToolCall'){label=item.tool||'Tool';blocks(item.contentItems);}
 else if(type==='functionCallOutput'){label=item.name||'Tool result';if(typeof item.output==='string')text=cleanText(item.output);else blocks(item.output);}
 else if(type==='commandExecution'){label='Command';text=cleanText(item.command)+(item.aggregatedOutput?'\n\n'+cleanText(item.aggregatedOutput):'');}
 else if(type==='fileChange'){label='File changes';text=(item.changes||[]).map(c=>c.path).join('\n');}
 else if(type==='collabAgentToolCall'){label='Subagent '+(item.tool||'activity');text=cleanText(item.prompt);}
 else if(type==='plan'){role='assistant';label='Plan';text=cleanText(item.text);}
 else if(type==='webSearch'){label='Web search';text=cleanText(item.query||item.action?.query);}
 else return null;
 // Markdown image cards must refer to this workspace; explicit Codex image items above carry their own provenance.
 if(role==='assistant'||['mcpToolCall','functionCallOutput'].includes(type)){
 const withoutCode=text.replace(/```[\s\S]*?```/g,'');for(const match of withoutCode.matchAll(/!\[([^\]]*)\]\(<?([^\n]*?)>?\)/g)){let source=match[2].replace(/\s+"[^"]*"$/,'');add(source,match[1]||'Image');}
 }
 const id=type==='userMessage'&&item.clientId?'user:'+item.clientId:item.id||hash((turnId||'')+type+text+images.map(i=>i.id).join());
 const outputLinks=role==='activity'?[]:conversationLinks(text);if(type==='fileChange')for(const c of item.changes||[])if(c.path)outputLinks.push({target:c.path,name:c.path.split('/').at(-1)});
 const outputs=artifacts?outputLinks.map(link=>artifacts.reference(link.target,{threadId,cwd,name:link.name,role,turnId})).filter(Boolean):[];
 return {id,turnId,outputs,clientId:item.clientId||null,role,kind:type,label,text,images,status,phase:item.phase||null};
}
export function normalizeConversation(rows,media,context){return rows.map(row=>normalizeConversationItem(row,media,context)).filter(Boolean);}
