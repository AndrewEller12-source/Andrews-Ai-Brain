import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const snapshot=overrides=>({connected:true,account:{status:'signedIn',email:'trey@example.com',planType:'plus'},login:{},capabilities:{cliAvailable:true},departments:['Engineering','Operations','Purchasing','Growth','Finance','Executive'],jobs:[],threads:[],models:[{model:'gpt-5.4',displayName:'GPT 5.4',supportedReasoningEfforts:[]}],projects:[{projectId:'p1',path:'/projects/shop',label:'Shop'}],approvals:[],settings:{concurrency:4,paused:false},...overrides});
function app(state=snapshot(),handler){
 const dom=new JSDOM(html,{url:'http://127.0.0.1:4780',runScripts:'outside-only',pretendToBeVisual:true});const {window:w}=dom,calls=[],timers=[];let events;const nativeInterval=w.setInterval.bind(w);w.setInterval=(callback,ms)=>{timers.push({callback,ms});return nativeInterval(callback,ms)};
 w.EventSource=class{constructor(){events=this}};w.requestAnimationFrame=cb=>{cb();return 1};w.fetch=async(url,opts)=>{const body=typeof opts?.body==='string'?JSON.parse(opts.body):opts?.body||null;calls.push({url,body});const result=handler?await handler(url,body):url==='/api/state'?state:{ok:true};return {ok:true,json:async()=>result}};
 w.eval(script);events.onmessage({data:JSON.stringify(state)});
 return {w,dom,calls,events,timers,$:s=>w.document.querySelector(s),update(s){state=s;events.onmessage({data:JSON.stringify(s)})},close(){dom.window.close()}};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('fresh account shows sign-in gate without starting OAuth automatically',async()=>{
 const a=app(snapshot({account:{status:'signedOut'}}));assert.equal(a.$('#send').disabled,true);assert.match(a.$('#setup').textContent,/Connect your Codex account/);assert.equal(a.calls.length,0);a.close();
});
test('login link is explicit and never opens a tab automatically',async()=>{
 const state=snapshot({account:{status:'signedOut'}});const a=app(state,async()=>({authUrl:'https://auth.openai.com/authorize?state=test',loginId:'login'}));a.$('#start-login').click();await tick();assert.equal(a.calls.length,1);assert.equal(a.calls[0].url,'/api/auth/login');assert.match(a.$('#login-link').href,/https:\/\/auth.openai.com/);a.close();
});
test('signed in identity is portable and missing CLI has an actionable setup gate',()=>{
 const a=app();assert.equal(a.$('#send').disabled,false);assert.equal(a.$('#account-name').textContent,'trey@example.com');assert.doesNotMatch(a.w.document.body.textContent,/Andrew Eller/);a.update(snapshot({connected:false,account:{status:'unavailable'},capabilities:{cliAvailable:false}}));assert.match(a.$('#setup').textContent,/Install the Codex engine/);assert.equal(a.$('#send').disabled,true);a.close();
});
test('lost event connection disables intake until fresh state arrives',()=>{
 const a=app();a.events.onerror();assert.equal(a.$('#send').disabled,true);assert.match(a.$('#setup').textContent,/Reconnecting/);a.update(snapshot());assert.equal(a.$('#send').disabled,false);a.close();
});
test('graph and list apply the same department, project and search criteria',()=>{
 const a=app(snapshot({threads:[{id:'t1',title:'Fix reports',cwd:'/projects/shop',department:'Engineering',recordedStatus:'completed'},{id:'t2',title:'Shipping',cwd:'/projects/warehouse',department:'Operations',recordedStatus:'completed'}]}));const search=a.$('#graph-search');search.value='Shop';search.dispatchEvent(new a.w.Event('input'));assert.match(a.$('.map-count').textContent,/1 \/ 1/);a.$('#neural-list-view').click();assert.equal(a.w.document.querySelectorAll('tbody tr').length,1);assert.match(a.$('tbody').textContent,/Fix reports/);a.close();
});
test('approval answers stay scoped to their own request and survive streaming updates',async()=>{
 const job={id:'j1',threadId:'t1',title:'Review inputs',status:'review',department:'Engineering',local:true};const approvals=['a1','a2'].map(id=>({id,jobId:'j1',method:'item/tool/requestUserInput',params:{questions:[{id:'answer',question:'Pick a label'}]},canAccept:true,canDecline:false}));let state=snapshot({jobs:[job],approvals});const a=app(state);a.$('[data-task="j1"]').dispatchEvent(new a.w.Event('click'));const input=a.$('[data-approval="a1"] input');input.value='First answer';input.focus();input.setSelectionRange(5,5);a.$('[data-approval="a2"] input').value='Second answer';a.update({...state,jobs:[{...job,liveText:'New output'}]});assert.equal(a.$('[data-approval="a1"] input').value,'First answer');assert.equal(a.w.document.activeElement,a.$('[data-approval="a1"] input'));assert.equal(a.w.document.activeElement.selectionStart,5);a.$('[data-approval="a1"] [data-decision="accept"]').click();await tick();assert.deepEqual(a.calls.find(c=>c.url==='/api/approval').body.answers,{answer:'First answer'});a.close();
});
test('approval action availability and typed service form are respected',async()=>{
 const state=snapshot({jobs:[{id:'j1',title:'Service form',status:'review',department:'Operations'}],approvals:[{id:'form',jobId:'j1',method:'mcpServer/elicitation/request',supported:true,canAccept:true,canDecline:false,canCancel:true,params:{requestedSchema:{required:['count','enabled'],properties:{count:{type:'integer',minimum:1},enabled:{type:'boolean'}}}}}]});const a=app(state);a.$('[data-task="j1"]').dispatchEvent(new a.w.Event('click'));assert.equal(a.$('[data-decision="decline"]'),null);assert.ok(a.$('[data-decision="cancel"]'));a.$('[data-content="count"]').value='3';a.$('[data-content="enabled"]').value='false';a.$('[data-decision="accept"]').click();await tick();assert.deepEqual(a.calls.find(c=>c.url==='/api/approval').body.content,{count:3,enabled:false});a.close();
});
test('inflight intake preserves newer text and batches into independent messages',async()=>{
 let release;const a=app(snapshot(),(url)=>url==='/api/intake'?new Promise(resolve=>release=resolve):snapshot());a.$('#batch').checked=true;a.$('#prompt').value='First request\nSecond request';a.$('#send').click();assert.equal(a.$('#send').disabled,true);a.$('#prompt').value='A third request while waiting';release({ids:['1','2']});await tick();assert.equal(a.$('#prompt').value,'A third request while waiting');assert.deepEqual(a.calls[0].body.messages,['First request','Second request']);assert.equal(a.$('#send').disabled,false);a.close();
});
test('project setup remains editable through events and submits requested folder',async()=>{
 const a=app();a.$('#account-settings').click();const field=a.$('#project-path');field.value='/projects/new';field.focus();a.update(snapshot());assert.equal(a.$('#project-path').value,'/projects/new');assert.equal(a.w.document.activeElement,a.$('#project-path'));a.$('#project-label').value='New project';a.$('#add-project').dispatchEvent(new a.w.Event('submit',{cancelable:true}));await tick();assert.deepEqual(a.calls.find(c=>c.url==='/api/projects').body,{path:'/projects/new',label:'New project'});a.close();
});
test('retry is shown only when server confirms safe dispatch retry',()=>{
 const job={id:'failed',title:'Dispatch failed',status:'uncertain',department:'Engineering'};const a=app(snapshot({jobs:[job]}));a.$('[data-task="failed"]').dispatchEvent(new a.w.Event('click'));assert.equal(a.$('#retry-task'),null);a.update(snapshot({jobs:[{...job,canRetry:true}]}));assert.ok(a.$('#retry-task'));a.close();
});
test('continue task clears conflicting project and submits the selected thread',async()=>{
 const thread={id:'t1',title:'Build checkout',cwd:'/projects/shop',department:'Engineering',recordedStatus:'completed'};const a=app(snapshot({threads:[thread]}),async()=>({ids:['new-request']}));a.$('#project').value='p1';a.$('[data-task="t1"]').dispatchEvent(new a.w.Event('click'));a.$('#continue-task').click();assert.equal(a.$('#project').value,'');assert.match(a.$('#reply-target').textContent,/Build checkout/);assert.equal(a.w.document.activeElement,a.$('#prompt'));a.$('#prompt').value='Continue with the next step';a.$('#send').click();await tick();assert.deepEqual(a.calls[0].body.options,{threadId:'t1'});a.close();
});
test('unconfirmed intake retries reuse the receipt key and keep the prompt',async()=>{
 let attempt=0;const a=app(snapshot(),async()=>{if(attempt++===0)throw Error('Response lost');return {ids:['saved']}});a.$('#prompt').value='A durable request';a.$('#send').click();await tick();assert.equal(a.$('#prompt').value,'A durable request');assert.match(a.$('#receipt').textContent,/Send not confirmed/);a.$('#send').click();await tick();assert.equal(a.calls[0].body.requestKey,a.calls[1].body.requestKey);assert.equal(a.$('#prompt').value,'');a.close();
});
test('switching inspectors shows the correct department, not the previous selection',()=>{
 const threads=[{id:'t1',title:'Code',department:'Engineering',recordedStatus:'completed'},{id:'t2',title:'Inventory',department:'Operations',recordedStatus:'completed'}];const a=app(snapshot({threads}));a.$('[data-task="t1"]').dispatchEvent(new a.w.Event('click'));assert.equal(a.$('#change-department').value,'Engineering');a.$('[data-task="t2"]').dispatchEvent(new a.w.Event('click'));assert.equal(a.$('#change-department').value,'Operations');a.close();
});
test('inbox puts newest requests first and saved receipt opens the request',async()=>{
 const jobs=[{id:'old',title:'Older task',createdAt:10,status:'completed',department:'Engineering'},{id:'new',title:'Newer task',createdAt:20,status:'queued',department:'Engineering'}];let state=snapshot({jobs});const a=app(state,async()=>({ids:['new']}));a.$('[data-view="requests"]').click();assert.equal(a.$('tbody tr').dataset.task,'new');a.$('#prompt').value='A new request';a.$('#send').click();await tick();assert.equal(a.$('.receipt-follow').textContent,'Follow this request');a.$('.receipt-follow').click();assert.match(a.$('#inspector').textContent,/Newer task/);a.close();
});
test('titled service choices submit their value and unsupported decisions give a next action',async()=>{
 const job={id:'j1',title:'Service choice',status:'review',department:'Operations'};const approval={id:'form',jobId:'j1',method:'mcpServer/elicitation/request',supported:true,canAccept:true,canDecline:false,canCancel:false,params:{requestedSchema:{required:['region'],properties:{region:{type:'string',oneOf:[{const:'us',title:'United States'},{const:'ca',title:'Canada'}]}}}}};const a=app(snapshot({jobs:[job],approvals:[approval]}));a.$('[data-task="j1"]').dispatchEvent(new a.w.Event('click'));assert.match(a.$('[data-content="region"]').textContent,/United States/);a.$('[data-content="region"]').value='ca';a.$('[data-decision="accept"]').click();await tick();assert.deepEqual(a.calls.find(c=>c.url==='/api/approval').body.content,{region:'ca'});a.update(snapshot({jobs:[job],approvals:[{...approval,canAccept:false}]}));assert.match(a.$('.approval').textContent,/Use Stop request above/);a.close();
});
test('incoming state updates the map while graph search keeps focus and caret',()=>{
 const a=app(snapshot({connected:false,threads:[]}));const search=a.$('#graph-search');search.value='Browser QA';search.dispatchEvent(new a.w.Event('input'));a.$('#graph-search').focus();a.$('#graph-search').setSelectionRange(4,4);a.update(snapshot({threads:[{id:'browser',title:'Browser QA smoke',department:'Engineering',cwd:'/projects/shop',recordedStatus:'completed'}]}));assert.match(a.$('.map-coordinate.top-right').textContent,/Engine connected/);assert.match(a.$('.map-count').textContent,/1 \/ 1/);assert.equal(a.w.document.activeElement,a.$('#graph-search'));assert.equal(a.$('#graph-search').value,'Browser QA');assert.equal(a.$('#graph-search').selectionStart,4);a.close();
});
test('desktop agents pulse through department, project, task and subagent links',()=>{
 const threads=[{id:'parent',title:'Install Codex SDK',department:'Engineering',cwd:'/projects/shop',activity:{state:'running',source:'desktop',observedAt:Date.now(),turnId:'turn-parent'}},{id:'child',parentThreadId:'parent',title:'Verify SDK integration',department:'Engineering',cwd:'/projects/shop',activity:{state:'running',source:'desktop',observedAt:Date.now(),turnId:'turn-child',agentName:'Verifier'}}];const a=app(snapshot({threads}));assert.equal(a.$('#metrics .metric-value strong').textContent,'2');assert.match(a.$('#metrics').textContent,/Active agents/);assert.equal(a.w.document.querySelectorAll('.node-running').length,2);assert.ok(a.$('.branch-live .trunk.signal-edge'));assert.ok(a.$('.project-running'));assert.ok(a.$('.project-edge.signal-edge'));assert.ok(a.$('.parent-edge.signal-edge'));a.$('[data-task="parent"]').dispatchEvent(new a.w.Event('click'));assert.match(a.$('#inspector').textContent,/Codex desktop/);assert.match(a.$('#inspector').textContent,/observed Just now/);a.close();
});
test('unknown desktop events never pulse and running counts deduplicate resumed requests',()=>{
 const activity={state:'running',source:'desktop',observedAt:Date.now(),turnId:'desktop-current'};const a=app(snapshot({jobs:[{id:'j1',threadId:'t1',title:'First request',department:'Engineering',status:'completed',createdAt:1},{id:'j2',threadId:'t1',title:'Second request',department:'Engineering',status:'completed',createdAt:2}],threads:[{id:'t1',title:'Shared agent',department:'Engineering',cwd:'/projects/shop',activity},{id:'stale',title:'Stale turn',department:'Operations',recordedStatus:'possibly_running',activity:{state:'unknown',source:'events',observedAt:1}}]}));assert.equal(a.$('#metrics .metric-value strong').textContent,'1');assert.equal(a.w.document.querySelectorAll('.node-running').length,1);assert.equal(a.$('[data-task="stale"]').classList.contains('node-running'),false);a.$('[data-view="requests"]').click();assert.equal(a.w.document.querySelectorAll('tbody tr').length,2);a.close();
});
test('all running agents remain visible beyond history project and leaf caps',()=>{
 const threads=Array.from({length:15},(_,i)=>({id:'active-'+i,title:'Active agent '+i,department:'Engineering',cwd:'/projects/project-'+Math.floor(i/3),activity:{state:'running',source:'desktop',observedAt:Date.now(),turnId:'turn-'+i}}));const a=app(snapshot({threads}));assert.equal(a.w.document.querySelectorAll('.node-running').length,15);assert.equal(a.w.document.querySelectorAll('.project-running').length,5);a.$('#graph-filter').value='live';a.$('#graph-filter').dispatchEvent(new a.w.Event('change'));assert.equal(a.w.document.querySelectorAll('.node-running').length,15);a.close();
});
test('completion notifications persist across updates with context until explicitly read',async()=>{
 let state=snapshot({threads:[{id:'done-thread',title:'Install Codex SDK',department:'Engineering',cwd:'/projects/shop',activity:{state:'completed',source:'desktop',observedAt:Date.now(),turnId:'finished'}}],notifications:[{id:'n1',threadId:'done-thread',title:'Install Codex SDK',department:'Engineering',projectLabel:'Shop',completedAt:Date.now(),read:false}]});const a=app(state,async(url,body)=>{if(url==='/api/notifications/read'){state={...state,notifications:state.notifications.map(n=>({...n,read:body.ids.includes(n.id)}))};return {ok:true}}return state});assert.equal(a.$('#completion-strip').hidden,false);assert.match(a.$('#completion-strip').textContent,/Engineering \/ Shop/);a.update(state);assert.equal(a.$('#notification-count').textContent,'1');a.$('[data-open-notification="n1"]').click();await tick();assert.match(a.$('#inspector').textContent,/Install Codex SDK/);assert.deepEqual(a.calls.find(c=>c.url==='/api/notifications/read').body,{ids:['n1']});assert.equal(a.$('#completion-strip').hidden,true);a.$('#notifications-open').click();assert.match(a.$('#content').textContent,/Install Codex SDK/);assert.match(a.$('#content').textContent,/0 unread/);a.close();
});
test('disconnected desktop observer separates execution connection and unknown totals',()=>{
 const a=app(snapshot({desktop:{connected:false,error:'Open Codex desktop to connect live agents',observedThreads:0},threads:[{id:'unknown',title:'Unobserved desktop task',department:'Engineering',activity:{state:'unknown',source:'events'}}]}));assert.match(a.$('#activity-connection').textContent,/Execution engineConnected/);assert.match(a.$('#activity-connection').textContent,/Live observer disconnected/);assert.match(a.$('#activity-connection').textContent,/Desktop status is unavailable/);assert.match(a.$('#metrics').textContent,/Desktop status unavailable/);assert.equal(a.$('#metrics .metric-value strong').textContent,'0');a.update(snapshot({desktop:{connected:true,observedThreads:1},threads:[{id:'unknown',title:'Unobserved desktop task',department:'Engineering',activity:{state:'unknown',source:'events'}}]}));assert.match(a.$('#activity-connection').textContent,/Live \/ 1 observed/);assert.match(a.$('#metrics').textContent,/Confirmed running/);assert.doesNotMatch(a.$('#metrics').textContent,/1 unknown/);assert.match(a.$('#activity-connection').textContent,/1 saved task has no live status. These are not counted as running/);assert.equal(a.$('#metrics .metric-value strong').textContent,'0');a.close();
});
test('recorded child activity flashes only after a new event without becoming running',()=>{
 const child={id:'child',parentThreadId:'parent',title:'Investigate SDK',department:'Engineering',cwd:'/projects/shop',lastEventAt:new Date(Date.now()-60000).toISOString(),activity:{state:'unknown',source:'events'}};const parent={id:'parent',title:'Install SDK',department:'Engineering',cwd:'/projects/shop',activity:{state:'running',source:'desktop'}};const a=app(snapshot({threads:[parent,child]}));assert.equal(a.$('.recorded-signal'),null);a.update(snapshot({threads:[parent,child]}));assert.equal(a.$('.recorded-signal'),null);a.update(snapshot({threads:[parent,{...child,lastEventAt:new Date(Date.now()+1000).toISOString()}]}));assert.ok(a.$('.task-node.recorded-signal[data-task="child"]'));assert.ok(a.$('.parent-edge.recorded-signal'));assert.equal(a.$('.task-node[data-task="child"]').classList.contains('node-running'),false);assert.equal(a.$('#metrics .metric-value strong').textContent,'1');a.$('[data-task="child"]').dispatchEvent(new a.w.Event('click'));assert.match(a.$('#inspector').textContent,/Recent recorded activity; runtime status unconfirmed/);a.w.Date.now=()=>Date.now()+3000;a.update(snapshot({threads:[parent,child]}));assert.equal(a.$('.task-node.recorded-signal'),null);a.close();
});
test('native continuation retains actual agent identity on the map and request identity in inbox',()=>{
 const state=snapshot({desktop:{connected:true,observedThreads:1},jobs:[{id:'followup',threadId:'native',title:'Native desktop continuation verified.',department:'Executive',cwd:'/wrong-folder',workspaceKey:'/wrong-folder',status:'running',createdAt:10,executionRuntime:'desktop'}],threads:[{id:'native',title:'Install Codex SDK',department:'Engineering',cwd:'/projects/shop',agentName:'SDK engineer',activity:{state:'running',source:'desktop',observedAt:Date.now(),turnId:'native-turn'}}]});const a=app(state);const node=a.$('.task-node[data-task="followup"]');assert.match(node.textContent,/Install Codex SDK/);assert.match(node.textContent,/Codex desktop/);assert.ok(a.$('.project-running[data-graph-project="/projects/shop"]'));node.dispatchEvent(new a.w.Event('click'));assert.match(a.$('.chat-identity h1').textContent,/Install Codex SDK/);a.$('#chat-details').click();assert.match(a.$('#inspector').textContent,/SDK engineer/);a.$('[data-view="requests"]').click();assert.match(a.$('tbody').textContent,/Native desktop continuation verified/);a.$('tbody tr').click();assert.match(a.$('#inspector h2').textContent,/Native desktop continuation verified/);a.close();
});

test('branch wires drill into projects and every agent remains reachable beyond map limits',()=>{
 const threads=Array.from({length:16},(_,i)=>({id:'agent-'+i,title:'Worker '+i,department:'Engineering',cwd:'/projects/shop',activity:{state:'completed',source:'events'}}));const a=app(snapshot({threads}));
 a.$('.graph-link[data-focus-department="Engineering"]').dispatchEvent(new a.w.Event('click'));
 assert.equal(a.w.document.querySelectorAll('.branch-agent').length,16);
 a.$('.graph-link[data-graph-project="/projects/shop"]').dispatchEvent(new a.w.Event('click'));
 assert.match(a.$('.branch-explorer').textContent,/Agents in this project/);
 const directory=a.$('.branch-directory');directory.scrollTop=180;a.update(snapshot({threads}));assert.equal(a.$('.branch-directory').scrollTop,180);
 a.$('.branch-agent[data-task="agent-15"]').click();assert.equal(a.$('.chat-identity h1').textContent,'Worker 15');assert.equal(a.$('#inspector').hidden,true);
 a.$('#chat-back').click();a.$('#branch-back').click();assert.match(a.$('.branch-explorer').textContent,/Explore Engineering/);a.$('#map-home').click();assert.equal(a.$('.branch-explorer'),null);a.close();
});
test('agent and delegation wires open details with keyboard support and connected-agent navigation',()=>{
 const threads=[{id:'parent',title:'Lead engineer',department:'Engineering',cwd:'/projects/shop',activity:{state:'running',source:'desktop'}},{id:'child',title:'SDK verifier',parentThreadId:'parent',department:'Engineering',cwd:'/projects/shop',activity:{state:'unknown',source:'events'}}];const state=snapshot({threads}),a=app(state);
 const wire=a.$('[data-map-key="task-edge:parent"]');wire.focus();a.update(state);assert.equal(a.w.document.activeElement.dataset.mapKey,'task-edge:parent');
 a.w.document.activeElement.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(a.$('#inspector h2').textContent,'Lead engineer');
 a.$('[data-related-agent="child"]').click();assert.equal(a.$('#inspector h2').textContent,'SDK verifier');a.$('[data-related-agent="parent"]').click();assert.equal(a.$('#inspector h2').textContent,'Lead engineer');
 a.$('#inspector').dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(a.$('#inspector').hidden,true);
 a.$('[data-map-key="parent-edge:child"]').dispatchEvent(new a.w.Event('click'));assert.equal(a.$('#inspector h2').textContent,'SDK verifier');
 a.$('#agent-branch').click();assert.equal(a.$('#inspector').hidden,true);assert.match(a.$('.branch-explorer').textContent,/Agents in this project/);assert.equal(a.w.document.querySelectorAll('.branch-agent').length,2);a.close();
});

test('ten requests leave the exact five-minute straggler visible and completed messages disappear',()=>{
 const now=Date.now(),jobs=Array.from({length:10},(_,i)=>({id:'burst-'+i,threadId:'chat-'+i,turnId:'turn-'+i,title:'Request '+i,prompt:'Exact user message '+i,department:'Engineering',status:i===7?'running':'completed',createdAt:now-360000+i*1000,startedAt:now-330000+i*1000,events:[{text:'Checking file '+i,at:now-10000}]}));const a=app(snapshot({jobs}));
 a.$('.nav[data-view="working"]').click();assert.equal(a.w.document.querySelectorAll('.work-list .work-card').length,1);assert.match(a.$('.work-list').textContent,/Exact user message 7/);assert.match(a.$('.work-list').textContent,/5\+ minutes/);assert.match(a.$('.work-list').textContent,/Checking file 7/);assert.equal(a.$('#working-count').textContent,'1');
 a.$('#work-filter').value='long';a.$('#work-filter').dispatchEvent(new a.w.Event('change'));assert.equal(a.w.document.querySelectorAll('.work-card').length,1);
 a.$('[data-work-open="job:burst-7"]').click();assert.match(a.$('#inspector').textContent,/Exact user message 7/);
 a.update(snapshot({jobs:jobs.map(j=>({...j,status:'completed'}))}));assert.equal(a.w.document.querySelectorAll('.work-card').length,0);assert.equal(a.$('#working-count').textContent,'0');a.close();
});
test('queued followups in the same chat do not replace the currently executing message',()=>{
 const now=Date.now(),a=app(snapshot({desktop:{connected:true},threads:[{id:'shared',title:'Inventory automation',department:'Purchasing',activity:{source:'desktop',state:'running',turnId:'running-turn',startedAt:now-400000}}],jobs:[{id:'old',threadId:'shared',turnId:'old-turn',prompt:'Old completed message',status:'completed',createdAt:1},{id:'working',threadId:'shared',turnId:'running-turn',title:'Check discrepancies',prompt:'Compare the warehouse counts to yesterday.',department:'Purchasing',status:'running',executionRuntime:'desktop',createdAt:now-450000,startedAt:now-400000},{id:'next',threadId:'shared',title:'Later request',prompt:'Now draft the reorder list.',status:'ready',createdAt:now,department:'Purchasing'}]}));
 a.$('.nav[data-view="working"]').click();assert.equal(a.w.document.querySelectorAll('.work-card').length,1);assert.match(a.$('.work-card h3').textContent,/Inventory automation/);assert.match(a.$('.work-prompt').textContent,/Compare the warehouse counts/);assert.doesNotMatch(a.$('.work-prompt').textContent,/reorder|Old completed/);
 a.$('#work-filter').value='waiting';a.$('#work-filter').dispatchEvent(new a.w.Event('change'));assert.match(a.$('.work-prompt').textContent,/Now draft the reorder list/);assert.match(a.$('.work-time').textContent,/not running yet/);assert.equal(a.$('.work-long'),null);a.close();
});
test('external active turns use their exact message and cannot borrow a prior prompt or observation time',()=>{
 const thread={id:'native',title:'Native chat',department:'Engineering',activity:{state:'running',source:'desktop',turnId:'new-turn',startedAt:Date.now()-350000,observedAt:Date.now()},currentRequest:{turnId:'new-turn',status:'available',text:'This is the new exact request.'}},jobs=[{id:'old',threadId:'native',turnId:'old-turn',prompt:'Old unrelated message',title:'Old request',status:'completed',createdAt:1}];const a=app(snapshot({desktop:{connected:true},threads:[thread],jobs}));a.$('.nav[data-view="working"]').click();assert.match(a.$('.work-prompt').textContent,/new exact request/);assert.ok(a.$('.work-long'));
 a.update(snapshot({desktop:{connected:true},jobs,threads:[{...thread,currentRequest:{turnId:'old-turn',status:'available',text:'Stale input'},activity:{...thread.activity,startedAt:null}}]}));assert.doesNotMatch(a.$('.work-prompt').textContent,/Stale input|Old unrelated/);assert.match(a.$('.work-time').textContent,/Start time unavailable/);assert.equal(a.$('.work-long'),null);
 a.events.onerror();assert.equal(a.$('.work-card'),null);assert.equal(a.$('#working-count').textContent,'0');a.close();
});

test('personal workspace name, custom colors and department routing reach real intake',async()=>{
 const state=snapshot({departments:['Photo Editing'],settings:{workspaceName:'Trey’s Studio',concurrency:4},threads:[{id:'photo',title:'Retouch portrait',department:'Photo Editing',cwd:'/projects/shop',activity:{state:'completed',source:'events'}}]});
 const a=app(state,async url=>url==='/api/intake'?{ids:['receipt']}:state);assert.equal(a.$('#workspace-name').textContent,'Trey’s Studio');assert.match(a.w.document.title,/Ai Task Manager/);assert.doesNotMatch(a.$('#department-nav').textContent,/Finance/);
 a.$('[data-focus-department="Photo Editing"]').dispatchEvent(new a.w.Event('click'));assert.ok(a.$('.agent-card-bg'));a.$('#new-agent').click();assert.equal(a.$('#request-department').value,'Photo Editing');assert.equal(a.w.document.activeElement,a.$('#prompt'));assert.equal(a.calls.length,0);
 a.$('#prompt').value='Remove the background';a.$('#send').click();await tick();assert.deepEqual(a.calls.find(c=>c.url==='/api/intake').body.options,{department:'Photo Editing'});a.close();
});
test('workspace naming and department creation forms preserve drafts across live updates',async()=>{
 const state=snapshot({departments:[],settings:{workspaceName:'My workspace',concurrency:4}});const a=app(state);a.$('#workspace-customize').click();a.$('#workspace-name-input').value='Trey’s Studio';a.update(state);assert.equal(a.$('#workspace-name-input').value,'Trey’s Studio');a.$('#workspace-form').dispatchEvent(new a.w.Event('submit',{cancelable:true}));await tick();assert.deepEqual(a.calls.find(c=>c.url==='/api/settings').body,{workspaceName:'Trey’s Studio'});
 a.$('#department-name').value='3D Animation';a.$('#department-keywords').value='blender, animation';a.update(state);a.$('#department-form').dispatchEvent(new a.w.Event('submit',{cancelable:true}));await tick();assert.deepEqual(a.calls.find(c=>c.url==='/api/departments').body,{name:'3D Animation',keywords:'blender, animation'});a.close();
});
test('agent observatory follows exact current turn, zooms, and stops live motion on completion',()=>{
 const now=Date.now();const thread={id:'photo',title:'Portrait agent',department:'Photo Editing',cwd:'/projects/shop',model:'gpt-5.4',turnId:'current',activity:{state:'running',source:'desktop',turnId:'current',observedAt:now,startedAt:now-360000},currentRequest:{status:'available',turnId:'current',text:'Remove the red background only',startedAt:now-360000},lastActivity:'Inspecting image layers'};
 const a=app(snapshot({departments:['Photo Editing'],threads:[thread]}));a.$('.task-node').dispatchEvent(new a.w.Event('click'));assert.match(a.$('.chat-messages').textContent,/Remove the red background only/);assert.match(a.$('.chat-messages').textContent,/Inspecting image layers/);a.$('#chat-map').click();assert.equal(a.$('#zoom-value').textContent,'220%');assert.equal(a.$('#inspector').hidden,true);assert.ok(a.$('.agent-card-bg'));assert.ok(a.$('.observatory-live'));
 a.update(snapshot({departments:['Photo Editing'],threads:[{...thread,activity:{...thread.activity,state:'completed'}}]}));assert.equal(a.$('.observatory-live'),null);assert.equal(a.$('#inspector').hidden,true);assert.equal(a.$('#zoom-value').textContent,'220%');a.$('#zoom-reset').click();assert.notEqual(a.$('#zoom-value').textContent,'220%');a.close();
});
test('a new workspace has no inherited business branches and arbitrary labels stay escaped',()=>{
 const a=app(snapshot({departments:[]}));assert.equal(a.w.document.querySelectorAll('.department-node').length,0);assert.match(a.$('.map-no-results').textContent,/first request/);a.update(snapshot({departments:['Studio "A" & Friends'],settings:{workspaceName:'<img src=x onerror=alert(1)>'}}));assert.equal(a.$('#workspace-name img'),null);assert.match(a.$('.department-node').getAttribute('aria-label'),/Studio "A" & Friends/);a.close();
});

const photo={id:'photo-one',name:'Reference.png',mime:'image/png',size:1024,url:'/api/media/photo-one'};
const chatThread={id:'design',title:'Design the campaign',department:'Engineering',cwd:'/projects/shop',activity:{state:'completed',source:'desktop',turnId:'turn-1'}};
test('agent opens full chat with message photos, preview, reuse, and replies to the same thread',async()=>{
 const state=snapshot({threads:[chatThread]}),a=app(state,async(url,body)=>url.startsWith('/api/conversation')?{items:[{id:'user:req',clientId:'req',turnId:'turn-1',role:'user',text:'Make this warmer',images:[photo]},{id:'answer',turnId:'turn-1',role:'assistant',text:'Here is the updated design.',images:[photo]}]}:url==='/api/attachments/reuse'?photo:url==='/api/intake'?{ids:['next']}:state);
 try{a.$('.task-node').dispatchEvent(new a.w.Event('click'));await tick();assert.ok(a.$('.chat-page'));assert.equal(a.$('#inspector').hidden,true);assert.equal(a.w.document.querySelectorAll('.chat-message').length,2);assert.equal(a.$('.chat-gallery img').src,'http://127.0.0.1:4780/api/media/photo-one');a.$('.message-photos [data-photo]').click();assert.ok(a.$('#photo-viewer').open);assert.match(a.$('#photo-viewer img').src,/photo-one/);a.$('#photo-reuse').click();await tick();assert.equal(a.$('#attachment-tray [data-photo]').dataset.photo,'photo-one');a.$('#prompt').value='Make it cooler instead';a.$('#send').click();await tick();assert.deepEqual(a.calls.find(c=>c.url==='/api/intake').body.options,{threadId:'design',attachments:['photo-one']});assert.equal(a.$('#attachment-tray').hidden,true);assert.equal(a.$('.composer-top label').textContent,'Message this agent');}finally{a.close()}
});
test('uploads preserve image IDs through an unconfirmed send, and photo-only requests remain valid',async()=>{
 let attempts=0;const a=app(snapshot(),async(url)=>url.startsWith('/api/attachments?')?photo:url==='/api/intake'?(++attempts===1?Promise.reject(Error('Connection lost')):{ids:['one']}):snapshot());
 try{await a.w.uploadPhotos([new a.w.File(['pngbytes'],'Reference.png',{type:'image/png'})]);assert.equal(a.$('#attachment-tray [data-photo]').dataset.photo,photo.id);a.$('#send').click();await tick();assert.match(a.$('#receipt').textContent,/Send not confirmed/);assert.ok(a.$('#attachment-tray [data-photo]'));a.$('#send').click();await tick();const sends=a.calls.filter(c=>c.url==='/api/intake');assert.equal(sends[0].body.requestKey,sends[1].body.requestKey);assert.deepEqual(sends[0].body.messages,['']);assert.deepEqual(sends[0].body.options.attachments,[photo.id]);}finally{a.close()}
});
test('switching chats isolates text and in-flight photo uploads from the master draft',async()=>{
 let upload;const state=snapshot({threads:[chatThread,{...chatThread,id:'second',title:'Second design'}]}),a=app(state,async(url)=>url.startsWith('/api/attachments?')?new Promise(r=>upload=r):url.startsWith('/api/conversation')?{items:[]}:state);
 try{a.$('#prompt').value='Master draft';a.$('.task-node[data-task="design"]').dispatchEvent(new a.w.Event('click'));a.$('#prompt').value='First design draft';const pending=a.w.uploadPhotos([new a.w.File(['bytes'],'Reference.png',{type:'image/png'})]);a.w.openConversation('second');assert.equal(a.$('#prompt').value,'');upload(photo);await pending;assert.equal(a.$('#attachment-tray').hidden,true);a.$('#prompt').value='Second draft';a.w.openConversation('design');assert.equal(a.$('#prompt').value,'First design draft');assert.ok(a.$('#attachment-tray [data-photo]'));a.$('#chat-back').click();assert.equal(a.$('#prompt').value,'Master draft');assert.equal(a.$('#attachment-tray').hidden,true);}finally{a.close()}
});
test('removing an in-flight duplicate photo does not remove a different attachment',async()=>{
 let upload;const a=app(snapshot(),async(url)=>new Promise(r=>upload=r));try{const p=a.w.uploadPhotos([new a.w.File(['one'],'Reference.png',{type:'image/png'})]);upload(photo);await p;const next=a.w.uploadPhotos([new a.w.File(['two'],'Duplicate.png',{type:'image/png'})]);a.w.document.querySelectorAll('[data-remove-photo]')[1].click();upload(photo);await next;assert.equal(a.w.document.querySelectorAll('[data-remove-photo]').length,1);assert.ok(a.$('[data-photo="photo-one"]'));}finally{a.close()}
});
test('history pagination keeps chronological messages and never promotes a stale turn to live',async()=>{
 const state=snapshot({threads:[{...chatThread,activity:{state:'running',source:'desktop',turnId:'new-turn'},currentRequest:{status:'available',turnId:'new-turn',text:'Actual current work'}}],jobs:[{id:'old',threadId:'design',turnId:'old-turn',title:'Old task',prompt:'Old message',status:'running',liveText:'Stale streaming text',department:'Photo Editing'}]});
 const a=app(state,async(url)=>url.includes('cursor=older')?{items:[{id:'early',turnId:'early',role:'user',text:'Earliest message',images:[]}],nextCursor:null}:url.startsWith('/api/conversation')?{items:[{id:'later',turnId:'new-turn',role:'user',text:'Actual current work',images:[]}],nextCursor:'older'}:state);
 try{a.$('.task-node').dispatchEvent(new a.w.Event('click'));await tick();assert.doesNotMatch(a.$('.chat-messages').textContent,/Stale streaming text/);a.$('#chat-older').click();await tick();assert.equal(a.$('.chat-message').dataset.messageId,'early');assert.equal(a.$('#chat-older'),null);}finally{a.close()}
});

test('a stalled live stream recovers through fresh snapshots and failed polling disables sending',async()=>{
 let fail=false;const state=snapshot(),a=app(state,async()=>{if(fail)throw Error('Offline');return state});try{a.$('#prompt').value='Preserved draft';a.events.onerror();assert.equal(a.$('#send').disabled,true);const now=Date.now();a.w.Date.now=()=>now+7000;await a.timers.find(t=>t.ms===3000).callback();assert.equal(a.$('#send').disabled,false);assert.match(a.$('#connection-label').textContent,/polling/);fail=true;await a.timers.find(t=>t.ms===3000).callback();assert.equal(a.$('#send').disabled,true);assert.equal(a.$('#prompt').value,'Preserved draft');}finally{a.close()}
});

test('approval dialog is explicit, survives live updates and saves only the chosen mode',async()=>{
 const a=app();try{
 a.$('#approval-mode-open').click();a.$('[name="approvalMode"][value="full-auto"]').click();
 a.update(snapshot());assert.equal(a.$('[name="approvalMode"]:checked').value,'full-auto');assert.equal(a.calls.length,0);
 a.$('#approval-mode-cancel').click();assert.equal(a.calls.length,0);assert.equal(a.$('#approval-dialog').open,false);
 a.$('#approval-mode-open').click();assert.equal(a.$('[name="approvalMode"]:checked').value,'manual');a.$('[value="auto-review"]').click();
 a.$('#approval-mode-form').dispatchEvent(new a.w.Event('submit',{cancelable:true}));await tick();
 assert.deepEqual(a.calls.find(c=>c.url==='/api/settings').body,{approvalMode:'auto-review'});assert.match(a.$('#approval-mode-open').textContent,/Risk reviewed/);assert.equal(a.$('#approval-dialog').open,false);
 }finally{a.close()}
});

test('navigation and map sidebar collapse persist through updates and have reachable restore buttons',()=>{
 const a=app();try{
 const before=a.$('#navigation-toggle').getAttribute('aria-expanded');a.$('#navigation-toggle').click();const collapsed=a.$('#navigation-toggle').getAttribute('aria-expanded');assert.notEqual(before,collapsed);a.update(snapshot());assert.equal(a.$('#navigation-toggle').getAttribute('aria-expanded'),collapsed);assert.notEqual(a.w.localStorage.getItem('ai-task-manager:navigation-collapsed'),null);
 a.$('#network-toggle').click();assert.equal(a.$('#network-sidebar').hidden,true);assert.ok(a.$('.console-body.sidebar-collapsed'));a.update(snapshot());assert.equal(a.$('#network-sidebar').hidden,true);a.$('#network-toggle').click();assert.equal(a.$('#network-sidebar').hidden,false);
 }finally{a.close()}
});

test('photo and task details sidebars reopen without losing their selected conversation',async()=>{
 const state=snapshot({threads:[{id:'t1',title:'Design task',cwd:'/projects/shop',department:'Engineering',recordedStatus:'completed'}]});const a=app(state);try{
 a.$('.task-node').dispatchEvent(new a.w.Event('click'));await tick();assert.ok(a.$('#photos-toggle'));
 assert.equal(a.$('#chat-photo-sidebar').hidden,true);assert.ok(a.$('.chat-layout.sidebar-collapsed'));a.update(state);assert.equal(a.$('#chat-photo-sidebar').hidden,true);a.$('#photos-toggle').click();assert.equal(a.$('#chat-photo-sidebar').hidden,false);
 a.$('#chat-details').click();a.$('#collapse-inspector').click();assert.equal(a.$('#inspector').hidden,true);assert.equal(a.$('#inspector-reopen').hidden,false);a.update(state);assert.equal(a.$('#inspector').hidden,true);a.$('#inspector-reopen').click();assert.equal(a.$('#inspector').hidden,false);assert.match(a.$('#inspector h2').textContent,/Design task/);
 }finally{a.close()}
});

test('file links become usable downloads and Outputs keeps their labels and local preview destinations',async()=>{
 const file={id:'file1',kind:'file',name:'Download for Trey',target:'/tmp/App Package.zip',filename:'App Package.zip',downloadUrl:'/api/files/file1?download=1',url:'/api/files/file1',role:'assistant'};
 const preview={id:'preview1',kind:'preview',name:'Local preview',target:'http://127.0.0.1:4100/',url:'http://127.0.0.1:4100/',role:'assistant'};
 const state=snapshot({threads:[{id:'t1',title:'Design task',cwd:'/projects/shop',department:'Engineering',recordedStatus:'completed'}]});const a=app(state,async url=>url.startsWith('/api/conversation')?{items:[{id:'answer',turnId:'turn',role:'assistant',text:'[Download for Trey](</tmp/App Package.zip>)',images:[],outputs:[file,preview]}],nextCursor:null}:state);
 try{a.$('.task-node').dispatchEvent(new a.w.Event('click'));await tick();const link=a.$('.message-body a');assert.ok(link);assert.equal(link.textContent,'Download for Trey');assert.equal(link.getAttribute('href'),file.downloadUrl);assert.ok(link.hasAttribute('download'));
 a.$('#outputs-tab').click();assert.equal(a.$('#outputs-tab').getAttribute('aria-selected'),'true');assert.match(a.$('.outputs-page').textContent,/Download for Trey/);assert.ok(a.$('.outputs-page a[href="http://127.0.0.1:4100/"]'));a.update(state);assert.equal(a.$('#outputs-tab').getAttribute('aria-selected'),'true');
 }finally{a.close()}
});

test('history includes dashboard-created chats once per thread, including completed work',async()=>{
 const thread={id:'saved-chat',title:'Saved design',department:'Engineering',recordedStatus:'completed'};
 const jobs=[1,2].map(n=>({id:'request-'+n,threadId:thread.id,title:thread.title,department:'Engineering',status:'completed',createdAt:n}));
 const a=app(snapshot({threads:[thread],jobs}));try{a.$('[data-view="history"]').click();assert.equal(a.w.document.querySelectorAll('tbody tr').length,1);assert.match(a.$('tbody').textContent,/Saved design/);a.$('tbody tr').click();await tick();assert.ok(a.$('.chat-page'));}finally{a.close()}
});
test('catch-up retrieves all missed pages and retains the oldest history cursor',async()=>{
 let rows=Array.from({length:90},(_,n)=>({id:'m'+n,turnId:'t'+n,role:'assistant',text:'Message '+n,images:[]}));
 const state=snapshot({threads:[chatThread]});
 const a=app(state,async url=>{if(!url.startsWith('/api/conversation'))return state;const cursor=new URL(url,'http://localhost').searchParams.get('cursor');const end=cursor?rows.findIndex(i=>i.id===cursor):rows.length,start=Math.max(0,end-50);return {items:rows.slice(start,end),nextCursor:start?rows[start].id:null};});
 try{a.$('.task-node').dispatchEvent(new a.w.Event('click'));await tick();a.$('#chat-older').click();await tick();assert.equal(a.w.document.querySelectorAll('.chat-message').length,90);
 rows.push(...Array.from({length:125},(_,i)=>({id:'m'+(90+i),turnId:'t'+(90+i),role:'assistant',text:'Message '+(90+i),images:[]})));
 await a.w.loadConversation();assert.equal(a.w.document.querySelectorAll('.chat-message').length,215);assert.equal(a.$('.chat-message').dataset.messageId,'m0');assert.equal([...a.w.document.querySelectorAll('.chat-message')].at(-1).dataset.messageId,'m214');assert.equal(a.$('#chat-older'),null);
 }finally{a.close()}
});
test('fresh history wins over stale saved job messages and responses',async()=>{
 const state=snapshot({threads:[chatThread],jobs:[{id:'job',threadId:'design',turnId:'turn',title:'Design',status:'completed',response:'Old response',chatItems:[{id:'answer',turnId:'turn',role:'assistant',text:'Old response',images:[]}]}]});
 const a=app(state,async url=>url.startsWith('/api/conversation')?{items:[{id:'answer',turnId:'turn',role:'assistant',text:'Latest response',images:[]}],nextCursor:null}:state);
 try{a.$('.task-node').dispatchEvent(new a.w.Event('click'));await tick();assert.match(a.$('.chat-messages').textContent,/Latest response/);assert.doesNotMatch(a.$('.chat-messages').textContent,/Old response/);}finally{a.close()}
});
test('a late HTTP snapshot cannot overwrite a newer event update',async()=>{
 let resolve;const a=app(snapshot(),url=>new Promise(r=>resolve=r));try{const pending=a.w.refreshState();a.update(snapshot({settings:{workspaceName:'New event',concurrency:4}}));resolve(snapshot({settings:{workspaceName:'Old snapshot',concurrency:4}}));await pending;assert.equal(a.$('#workspace-name').textContent,'New event');}finally{a.close()}
});
test('returning to the app refreshes the selected conversation',async()=>{
 let text='Old message';const state=snapshot({threads:[chatThread]});const a=app(state,async url=>url.startsWith('/api/conversation')?{items:[{id:'answer',turnId:'turn',role:'assistant',text,images:[]}],nextCursor:null}:state);
 try{a.$('.task-node').dispatchEvent(new a.w.Event('click'));await tick();text='Current message';a.w.dispatchEvent(new a.w.Event('focus'));await tick();assert.match(a.$('.chat-messages').textContent,/Current message/);}finally{a.close()}
});

test('timed-out message refresh releases the loading guard so the next refresh succeeds',async()=>{
 let stalled=true;const state=snapshot({threads:[chatThread]});const a=app(state,async url=>url.startsWith('/api/conversation')?(stalled?new Promise(()=>{}):{items:[{id:'recovered',turnId:'turn',role:'assistant',text:'Recovered reply',images:[]}],nextCursor:null}):state);
 const original=a.w.setTimeout.bind(a.w);a.w.setTimeout=(fn,ms)=>original(fn,ms===12000?10:ms);
 try{a.$('.task-node').dispatchEvent(new a.w.Event('click'));await new Promise(r=>setTimeout(r,30));assert.match(a.$('.chat-messages').textContent,/timed out/);stalled=false;await a.w.loadConversation();assert.match(a.$('.chat-messages').textContent,/Recovered reply/);assert.doesNotMatch(a.$('.chat-messages').textContent,/timed out/);}finally{a.close()}
});

test('late partial streaming text cannot shorten a newer persisted reply',async()=>{
 const state=snapshot({threads:[{...chatThread,activity:{state:'running',source:'desktop',turnId:'turn'}}],jobs:[{id:'job',threadId:'design',turnId:'turn',title:'Design',department:'Engineering',status:'running',liveItemId:'answer',liveText:'Current'}]});
 const a=app(state,async url=>url.startsWith('/api/conversation')?{items:[{id:'answer',turnId:'turn',role:'assistant',text:'Current complete reply',images:[]}],nextCursor:null}:state);
 try{a.$('.task-node').dispatchEvent(new a.w.Event('click'));await tick();assert.match(a.$('.message-assistant').textContent,/Current complete reply/);}finally{a.close()}
});


test('completed cache excerpts cannot append old turns or early messages after the latest reply',async()=>{
 const msg=(id,turnId,text,role='assistant')=>({id,turnId,text,role,images:[]});
 const early=msg('early','new-turn','Starting the new task'),latest=msg('latest','new-turn','The new task is finished');
 const old=[msg('old-user','old-turn','Old request','user'),msg('old-answer','old-turn','Old answer')];
 const state=snapshot({threads:[chatThread],jobs:[{id:'old-job',threadId:'design',turnId:'old-turn',title:'Design',status:'completed',prompt:'Old request',response:'Old answer',chatItems:old,createdAt:1},{id:'new-job',threadId:'design',turnId:'new-turn',title:'Design',status:'completed',prompt:'New request',response:latest.text,chatItems:[early,latest],createdAt:2}]});
 const a=app(state,async url=>url.startsWith('/api/conversation')?(url.includes('cursor=')?{items:[...old,early],nextCursor:null}:{items:[latest],nextCursor:'older'}):state);
 try{a.$('.task-node').dispatchEvent(new a.w.Event('click'));await tick();
 assert.deepEqual([...a.w.document.querySelectorAll('.message-assistant')].map(e=>e.dataset.messageId),['latest']);
 a.$('#chat-older').click();await tick();
 assert.deepEqual([...a.w.document.querySelectorAll('.message-assistant')].map(e=>e.dataset.messageId),['old-answer','early','latest']);
 await a.w.loadConversation();assert.equal([...a.w.document.querySelectorAll('.chat-message')].at(-1).dataset.messageId,'latest');
 }finally{a.close()}
});

test('active cache contributes only newer messages after the shared history tail',async()=>{
 const msg=(id,text)=>({id,turnId:'turn',text,role:'assistant',images:[]});
 const state=snapshot({threads:[chatThread],jobs:[{id:'job',threadId:'design',turnId:'turn',title:'Design',status:'running',chatItems:[msg('early','Starting'),msg('current','Current progress'),msg('next','New streamed progress')]}]});
 const a=app(state,async url=>url.startsWith('/api/conversation')?{items:[msg('current','Current progress')],nextCursor:'older'}:state);
 try{a.$('.task-node').dispatchEvent(new a.w.Event('click'));await tick();assert.deepEqual([...a.w.document.querySelectorAll('.message-assistant')].map(e=>e.dataset.messageId),['current','next']);}finally{a.close()}
});


test('history is newest-first across completed, unknown and running tasks, using real activity timestamps',()=>{
 const now=Date.now();const state=snapshot({threads:[
 {id:'recent',title:'Recently finished native chat',department:'Engineering',updatedAt:(now-60000)/1000,lastEventAt:new Date(now-1000).toISOString(),activityAt:new Date(now-1000).toISOString(),lastActivity:'Newest finished result',recordedStatus:'unknown'},
 {id:'old',title:'Older dashboard chat',department:'Engineering',updatedAt:(now-3600000)/1000,lastActivity:'Old result',recordedStatus:'completed'},
 {id:'running',title:'Long running chat',department:'Engineering',updatedAt:(now-120000)/1000,lastActivity:'Older progress',activity:{state:'running',source:'desktop',observedAt:now}}],jobs:[{id:'job',threadId:'old',title:'Old request',department:'Engineering',status:'completed',createdAt:now-7200000,updatedAt:now-3600000,reason:'Old routing explanation',response:'Old result'}]});
 const a=app(state);try{a.$('[data-view="history"]').click();const rows=[...a.w.document.querySelectorAll('tbody tr')];assert.deepEqual(rows.map(r=>r.dataset.task),['recent','running','job']);assert.match(rows[0].textContent,/Newest finished result/);assert.match(rows[0].textContent,/Just now/);assert.doesNotMatch(rows[0].textContent,/Running/);assert.doesNotMatch(a.$('tbody').textContent,/routing explanation/);
 a.update({...state,threads:state.threads.map(t=>t.id==='running'?{...t,updatedAt:now/1000,lastActivity:'Just completed',activity:{state:'completed',source:'desktop',observedAt:now}}:t)});
 assert.equal(a.$('tbody tr').dataset.task,'running');assert.match(a.$('tbody tr').textContent,/Just completed/);
 }finally{a.close()}
});

test('history shows new native activity on an older dashboard-created thread and retains its exact identity',async()=>{
 const now=Date.now(),state=snapshot({threads:[{id:'thread',title:'Real chat title',department:'Engineering',updatedAt:now/1000,activityAt:new Date(now).toISOString(),lastActivity:'Latest native reply',model:'gpt-6-astra',recordedStatus:'completed'}],jobs:[{id:'job',threadId:'thread',turnId:'old-turn',title:'Old task',status:'completed',department:'Engineering',updatedAt:now-3600000,createdAt:now-7200000,response:'Old cached answer',reason:'Router explanation',model:'gpt-5.5'}]});
 const a=app(state,async url=>url.startsWith('/api/conversation')?{items:[],nextCursor:null}:state);
 try{a.$('[data-view="history"]').click();assert.match(a.$('tbody tr').textContent,/Real chat title.*Latest native reply.*GPT 6-Astra.*Just now/);assert.doesNotMatch(a.$('tbody tr').textContent,/Old cached answer|Router explanation/);a.$('tbody tr').click();await tick();assert.ok(a.calls.some(c=>c.url==='/api/conversation?id=thread'));}finally{a.close()}
});


test('large department maps paginate readable groups and keep every agent reachable',()=>{
 const threads=Array.from({length:53},(_,i)=>({id:'u'+i,title:'Task '+i,department:'Engineering',cwd:'/projects/p'+String(i).padStart(2,'0'),updatedAt:i+1,activity:{state:'completed',source:'events'}}));const a=app(snapshot({departments:['Engineering'],threads}));
 assert.ok(a.w.document.body.classList.contains('universe-expanded'));a.$('.graph-link[data-focus-department="Engineering"]').dispatchEvent(new a.w.Event('click'));
 assert.equal(a.w.document.querySelectorAll('.project-node').length,4);assert.equal(a.w.document.querySelectorAll('.task-node').length,4);assert.match(a.$('.map-pages').textContent,/1 \/ 14/);a.$('#map-next').click();assert.match(a.$('.map-pages').textContent,/2 \/ 14/);assert.ok(parseInt(a.$('#zoom-value').textContent)>=65);
 a.$('#universe-size').click();assert.equal(a.w.document.body.classList.contains('universe-expanded'),false);a.close();
});
test('manager settings expose real task identity without counting standby slots as live',async()=>{
 const jobs=[{id:'manager-job',threadId:'manager-thread',managerForDepartment:'Design',title:'Design manager review',status:'running',department:'Design'}];const a=app(snapshot({departments:['Design'],jobs,managers:[{department:'Design',title:'Design manager',jobId:'manager-job',threadId:'manager-thread',status:'running',model:'gpt-5.4'}]}));
 a.$('[data-view="settings"]').click();assert.match(a.$('.manager-directory').textContent,/Open manager task/);const toggle=a.$('[data-organization-setting="autoManagers"]');toggle.checked=false;toggle.dispatchEvent(new a.w.Event('change'));await tick();assert.deepEqual(a.calls.find(c=>c.url==='/api/settings').body,{autoManagers:false});a.close();
});

test('universe zoom counter-scales node visuals and reveals labels progressively without changing task identity',()=>{
 const state=snapshot({threads:[{id:'zoom-task',title:'Build a clear map',department:'Engineering',cwd:'/projects/shop',activity:{state:'completed',source:'events'}}]});
 const a=app(state);const svg=a.$('#neural-map');svg.getBoundingClientRect=()=>({width:740,height:475,left:0,top:0,right:740,bottom:475});
 a.$('#zoom-in').click();
 assert.equal(svg.dataset.detailLevel,'departments');assert.ok(a.$('.project-node').classList.contains('map-labels-hidden'));
 const scale=()=>Number(a.$('.department-node .node-visual').getAttribute('transform').match(/scale\(([^)]+)/)[1]);
 assert.ok(Math.abs(scale()*1.2*.5-1)<1e-9);
 for(let i=0;i<3;i++)a.$('#zoom-in').click();
 assert.equal(svg.dataset.detailLevel,'projects');assert.equal(a.$('.project-node').classList.contains('map-labels-hidden'),false);
 for(let i=0;i<20;i++)a.$('#zoom-in').click();
 assert.equal(svg.dataset.detailLevel,'tasks');assert.ok(Math.abs(scale()*5.8*.5-1)<1e-9);
 assert.equal(a.$('.task-node').dataset.task,'zoom-task');
 assert.equal(a.$('.department-node').querySelectorAll('.node-visual').length,1);
 a.update(state);assert.equal(a.$('#zoom-value').textContent,'580%');
 a.close();
});

test('universe recalculates constant screen sizes after a container resize',()=>{
 const a=app(snapshot({threads:[{id:'resize-task',title:'Responsive workspace',department:'Engineering',cwd:'/projects/shop'}]}));
 let resize; a.w.ResizeObserver=class{constructor(callback){resize=callback}observe(){}disconnect(){}};
 a.update(snapshot({threads:[{id:'resize-task',title:'Responsive workspace',department:'Engineering',cwd:'/projects/shop'}]}));
 const svg=a.$('#neural-map');let width=1480;svg.getBoundingClientRect=()=>({width,height:950,left:0,top:0,right:width,bottom:950});
 resize();assert.match(a.$('.department-node .node-visual').getAttribute('transform'),/scale\(1\)/);
 width=740;resize();assert.match(a.$('.department-node .node-visual').getAttribute('transform'),/scale\(2\)/);
 a.close();
});
