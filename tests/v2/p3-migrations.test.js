const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const Database=require('better-sqlite3');
const db=require('../../server/db');const writing=require('../../server/services/writing');const {startApp}=require('../helpers');
test('P3: old data migrates without rewriting quote snapshots; repeat initialization is stable and newer DB rejected',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wb-migrate-'));const old=new Database(path.join(dir,'app.db'));
 old.exec(fs.readFileSync(path.join(__dirname,'../../server/schema.sql'),'utf8'));
 old.exec("INSERT INTO notes VALUES(1,'旧札记','原始 <b>文本</b>\n第二行','a','b'); INSERT INTO compilations VALUES(1,'旧长编','','进行中','footer',NULL,'a','b'); INSERT INTO compilation_blocks(id,compilation_id,type,quote_text,seq) VALUES(1,1,'quote','历史引文',0); INSERT INTO compilation_refs(id,compilation_id,block_id,mark,item_id,text,seq) VALUES(1,1,1,'①',999,'历史出处，不可改写',1)");old.close();
 try{db.initDb(dir);const note=writing.get('note',1),comp=writing.get('compilation',1);assert.equal(note.content.content[0].content[0].text,'原始 <b>文本</b>');assert.equal(comp.citations[0].note,'历史出处，不可改写');assert.equal(comp.citations[0].quote,'历史引文');const count=db.dbGet('SELECT COUNT(*) n FROM writing_documents').n;db.initDb(dir);assert.equal(db.dbGet('SELECT COUNT(*) n FROM writing_documents').n,count);assert.equal(writing.get('note',1).revision,note.revision);db.getDb().pragma('user_version=999');assert.throws(()=>db.initDb(dir),/更新/);}finally{db.closeDb();fs.rmSync(dir,{recursive:true,force:true});}
});
test('P3: saves are atomic, idempotent and conflict-aware; obsolete body API cannot overwrite rich document',async()=>{
 const app=await startApp();const req=async(url,method='GET',body)=>{const r=await fetch(app.base+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{
  const n=(await req('/api/notes','POST',{title:'版本测试',body:'初稿'})).data;const d=(await req('/api/writing/note/'+n.id+'/document')).data;
  const body={baseRevision:d.revision,clientMutationId:'one',title:'新标题',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'修订稿'}]}]},citations:[]};
  const saved=await req('/api/writing/note/'+n.id+'/document','PUT',body);assert.equal(saved.status,200);assert.deepEqual((await req('/api/writing/note/'+n.id+'/document','PUT',body)).data,saved.data);
  assert.equal((await req('/api/writing/note/'+n.id+'/document','PUT',{...body,clientMutationId:'two'})).status,409);
  assert.equal((await req('/api/notes/'+n.id,'PUT',{body:'旧接口覆盖'})).status,409);
  const bad={...body,baseRevision:saved.data.revision,clientMutationId:'bad',content:{type:'doc',content:[{type:'quote_block',attrs:{citationId:'missing'}}]}};
  assert.equal((await req('/api/writing/note/'+n.id+'/document','PUT',bad)).status,400);assert.equal((await req('/api/writing/note/'+n.id+'/document')).data.revision,saved.data.revision);
  assert.equal((await req('/api/notes/'+n.id)).data.body,'修订稿');
 }finally{await app.close();}
});
