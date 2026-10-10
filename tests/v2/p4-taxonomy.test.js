const {test}=require('node:test');const assert=require('node:assert/strict');const {startApp}=require('../helpers');
test('P4: independent multi-level trees, cross-type themes, deduplication, move validation and atomic excerpt classification',async()=>{
 const app=await startApp();const req=async(url,method='GET',body)=>{const r=await fetch(app.base+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
 try{
  const item=(await req('/api/items','POST',{module:'classics',title:'古籍'})).data,other=(await req('/api/items','POST',{module:'book',title:'其他'})).data;
  const top=(await req('/api/themes','POST',{name:'经济史'})).data;
  const child=(await req('/api/themes','POST',{name:'赋税',parent_id:top.id})).data;
  const leaf=(await req('/api/themes','POST',{name:'田赋',parent_id:child.id})).data;
  assert.equal((await req('/api/themes','POST',{name:'经济史'})).status,400);
  assert.equal((await req('/api/themes/'+top.id,'PATCH',{parent_id:leaf.id})).status,400);
  const f=(await req('/api/excerpt-folders','POST',{name:'卷一',item_id:item.id})).data;
  const f2=(await req('/api/excerpt-folders','POST',{name:'卷二',item_id:item.id,parent_id:f.id})).data;
  const foreign=(await req('/api/excerpt-folders','POST',{name:'别条目录文',item_id:other.id})).data;
  assert.equal((await req('/api/excerpt-folders/'+f.id,'PATCH',{parent_id:foreign.id})).status,400);
  const ex=(await req('/api/excerpts','POST',{item_id:item.id,text:'田赋原文',folderIds:[f.id,f2.id],themeIds:[top.id,leaf.id]})).data;
  assert.equal(ex.folderIds.length,2);assert.equal(ex.themeIds.length,2);
  assert.equal((await req('/api/excerpts/'+ex.id,'PUT',{text:'不该保存',folderIds:[foreign.id]})).status,400);
  assert.equal((await req('/api/excerpts?item_id='+item.id)).data[0].text,'田赋原文');
  for(const [type,endpoint]of [['note','notes'],['idea','ideas'],['compilation','compilations']]){const row=(await req('/api/'+endpoint,'POST',{title:type})).data;assert.equal((await req('/api/content/'+type+'/'+row.id+'/themes','PUT',{themeIds:[top.id,leaf.id]})).status,200);}
  assert.equal((await req('/api/themes/'+top.id+'/contents')).data.total,4);
  assert.equal((await req('/api/themes/'+child.id+'/contents')).data.total,4);
  assert.equal((await req('/api/themes/'+child.id+'/contents?include_descendants=false')).data.total,0);
  assert.equal((await req('/api/themes/'+top.id,'DELETE')).status,400);
  const impact=(await req('/api/themes/'+top.id+'/impact')).data;assert.equal(impact.categories,3);
  assert.equal((await req('/api/themes/'+top.id+'?confirm=true','DELETE')).status,200);
  assert.equal((await req('/api/themes/0/contents?unclassified=true')).data.total,4);
  assert.equal((await req('/api/excerpts?item_id='+item.id)).data[0].folderIds.length,2);
  await req('/api/excerpt-folders/'+f.id+'?confirm=true','DELETE');assert.equal((await req('/api/excerpts?item_id='+item.id)).data.length,1);
 }finally{await app.close();}
});
