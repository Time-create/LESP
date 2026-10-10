const {test}=require('node:test');const assert=require('node:assert/strict');const {launch}=require('./helpers');
test('P4 desktop: classification form and theme hub show real multi-linked excerpt', {timeout:60000},async()=>{
 const run=await launch();try{
  const item=await run.request('/api/items','POST',{module:'classics',title:'分类演示'});
  const a=await run.request('/api/themes','POST',{name:'经济史'}),b=await run.request('/api/themes','POST',{name:'赋税',parent_id:a.id});
  const folder=await run.request('/api/excerpt-folders','POST',{name:'卷一',item_id:item.id});
  await run.page.goto(run.base+'/sources/classics/'+item.id);await run.page.getByRole('button',{name:'新增录文',exact:true}).click();
  await run.page.getByLabel('筛选主题类别').fill('赋税');assert.equal(await run.page.locator('select[name=themeIds] option:not([hidden])').count(),1);await run.page.getByLabel('筛选主题类别').fill('');await run.page.getByLabel('录文正文').fill('分类后的田赋史料');await run.page.getByLabel('条目内分类（可多选）').selectOption(String(folder.id));await run.page.getByLabel('主题分类（可多选）').selectOption([String(a.id),String(b.id)]);
  await Promise.all([run.page.waitForEvent('load'),run.page.getByRole('button',{name:'保存',exact:true}).click()]);
  const ex=(await run.request('/api/excerpts?item_id='+item.id))[0];assert.equal(ex.themeIds.length,2);
  await run.page.getByRole('link',{name:'主题分类',exact:true}).click();await run.page.locator('[data-theme="'+a.id+'"]').click();
  await run.page.locator('#theme-results').getByText('分类后的田赋史料').waitFor();assert.equal(await run.page.locator('#theme-results .li').count(),1);
 }finally{await run.close();}
});
