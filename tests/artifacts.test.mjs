import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ArtifactStore,conversationLinks} from '../artifacts.mjs';
import {normalizeConversationItem} from '../conversation.mjs';
const media={reference:()=>null};
test('angle-bracket download links with spaces and line references register only actual mentioned files',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'outputs-')),store=new ArtifactStore(path.join(dir,'private')),file=path.join(dir,'Design package.zip');fs.writeFileSync(file,'actual archive bytes');
 const item=normalizeConversationItem({turnId:'turn',item:{type:'agentMessage',id:'answer',text:`[Download for Trey](<${file}>) and [source](${file.replaceAll(' ','%20')}:12)`}},media,{artifacts:store,threadId:'thread',cwd:dir});
 assert.equal(item.outputs.length,2);assert.equal(item.outputs[0].name,'Download for Trey');assert.match(item.outputs[0].downloadUrl,/^\/api\/files\/[a-f0-9]+\?download=1$/);assert.equal(store.get(item.outputs[0].id).real,fs.realpathSync(file));
 assert.throws(()=>store.get('../../etc/passwd'),/Unknown/);
 fs.unlinkSync(file);fs.symlinkSync('/etc/hosts',file);assert.throws(()=>store.get(item.outputs[0].id),/moved|unavailable/);
});
test('previews, sensitive files, missing files and code blocks preserve honest output provenance',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'outputs-')),store=new ArtifactStore(path.join(dir,'private'));
 const items=conversationLinks('[Preview](http://127.0.0.1:4100/)\n```\n[Secret](/tmp/hidden.key)\n```');assert.equal(items.length,1);
 assert.equal(store.reference(items[0].target,{threadId:'t',role:'assistant'}).kind,'preview');assert.equal(store.reference('/tmp/.env',{threadId:'t'}).unavailable,true);assert.equal(store.reference('/not/real/file.zip',{threadId:'t'}).unavailable,true);assert.equal(store.reference('javascript:alert(1)',{threadId:'t'}),null);
 assert.equal(store.reference('https://user:password@example.com',{threadId:'t'}),null);
});

test('command log endpoints are not outputs while explicit file changes remain downloadable',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'output-provenance-')),store=new ArtifactStore(path.join(dir,'private')),file=path.join(dir,'result.txt');fs.writeFileSync(file,'result');
 const context={artifacts:store,threadId:'thread',cwd:dir};
 const command=normalizeConversationItem({item:{type:'commandExecution',command:'curl http://127.0.0.1:4780/api/state',aggregatedOutput:'https://example.com/internal-status'}},media,context);
 assert.deepEqual(command.outputs,[]);
 const change=normalizeConversationItem({item:{type:'fileChange',changes:[{path:file}]}},media,context);assert.equal(change.outputs[0].filename,'result.txt');assert.ok(change.outputs[0].downloadUrl);
});
