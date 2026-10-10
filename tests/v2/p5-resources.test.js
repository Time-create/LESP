const {test}=require('node:test');const assert=require('node:assert/strict');const {startApp}=require('../helpers');const {randomUUID}=require('node:crypto');
test('P5 image validation, document references and concurrent revision conflict are atomic',async()=>{
 const run=await startApp();const request=async(url,method='GET',body)=>{const r=await fetch(run.base+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
 try{
  const bad=new FormData();bad.append('file',new Blob(['<script>alert(1)</script>'],{type:'image/png'}),'bad.png');assert.equal((await fetch(run.base+'/api/resources/images',{method:'POST',body:bad})).status,400);
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');const form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),'中文.png');const uploaded=await fetch(run.base+'/api/resources/images',{method:'POST',body:form});assert.equal(uploaded.status,200);const image=await uploaded.json();assert.deepEqual(Buffer.from(await(await fetch(run.base+image.url)).arrayBuffer()),bytes);
  const note=(await request('/api/notes','POST',{title:'并发文章'})).data;const endpoint='/api/writing/note/'+note.id+'/document';const initial=(await request(endpoint)).data;
  const payload={title:'第一次',baseRevision:initial.revision,clientMutationId:randomUUID(),content:{type:'doc',content:[{type:'image',attrs:{resourceId:image.id,width:100,caption:'图注'}}]},citations:[]};assert.equal((await request(endpoint,'PUT',payload)).status,200);
  assert.equal((await request(endpoint,'PUT',{...payload,title:'另一个窗口',clientMutationId:randomUUID()})).status,409);const current=(await request(endpoint)).data;assert.equal(current.title,'第一次');
  assert.equal((await request(endpoint,'PUT',{...payload,baseRevision:current.revision,clientMutationId:randomUUID(),title:'不应保存',content:{type:'doc',content:[{type:'image',attrs:{resourceId:'missing',width:100}}]}})).status,400);assert.equal((await request(endpoint)).data.title,'第一次');
 }finally{await run.close();}
});
