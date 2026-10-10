const {test}=require('node:test');const assert=require('node:assert/strict');const {launch}=require('./helpers');
test('P5 desktop: three editors, formatting/image persistence, failed navigation and close, draft recovery',{timeout:180000},async()=>{
 let run=await launch();const dir=run.dir;const {page}=run;page.setDefaultTimeout(12000);page.on('pageerror',e=>console.error('PAGE',e.message));let noteId;
 try{
  for(const [kind,plural]of [['note','notes'],['idea','ideas'],['compilation','compilations']]){
   console.log('editing',kind);const row=await run.request('/api/'+plural,'POST',{title:'测试'+kind});if(kind==='note')noteId=row.id;
   await page.goto(run.base+'/writing/'+plural+'/'+row.id);await page.waitForFunction(()=>!!window.writingEditor);
   await page.locator('.ProseMirror').click();await page.keyboard.insertText('中文分析正文');await page.getByRole('button',{name:'独立引文（楷体）',exact:true}).click();
   await page.locator('input[type=file]').setInputFiles({name:'图片.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
   await page.locator('.ProseMirror img').waitFor();console.log('image uploaded',kind);await page.keyboard.press('Control+s');await page.waitForFunction(()=>window.writingSave&&!window.writingSave.dirty);
   const doc=await run.request('/api/writing/'+kind+'/'+row.id+'/document');assert.ok(JSON.stringify(doc.content).includes('quote_block'));assert.ok(JSON.stringify(doc.content).includes('resourceId'));
  }
  await page.goto(run.base+'/writing/notes/'+noteId);await page.waitForFunction(()=>!!window.writingEditor);
  await page.route('**/api/writing/note/*/document',route=>route.request().method()==='PUT'?route.fulfill({status:500,contentType:'application/json',body:'{"error":"故障注入"}'}):route.continue());
  await page.getByLabel('标题',{exact:true}).fill('故障时保留标题');await page.locator('.topbar-menu[data-menu="写作"] .topbar-btn').click();await page.locator('.topbar-item[data-key="notes"]').click();await page.waitForFunction(()=>document.getElementById('save-state').textContent.includes('故障注入'));assert.ok(page.url().includes('/writing/notes/'));
  await run.app.evaluate(({dialog,BrowserWindow})=>{dialog.showMessageBox=async()=>({response:0});BrowserWindow.getAllWindows()[0].close();});
  await page.waitForTimeout(500);assert.equal(run.app.windows().length,1);assert.equal(await page.getByLabel('标题',{exact:true}).inputValue(),'故障时保留标题');
  await page.waitForFunction(async()=>{const d=await (await fetch('/api/writing/note/'+window.__WRITING__.id+'/document')).json();return d.drafts.some(x=>x.draft.title==='故障时保留标题');});
  await page.evaluate(()=>window.discardChanges());await page.unroute('**/api/writing/note/*/document');await page.reload();await page.getByRole('button',{name:'恢复草稿',exact:true}).click();await page.keyboard.press('Control+s');await page.waitForFunction(()=>!window.writingSave.dirty);
  await run.close();run=await launch({dir});const saved=await run.request('/api/writing/note/'+noteId+'/document');assert.equal(saved.title,'故障时保留标题');assert.equal(saved.drafts.length,0,'恢复草稿正式保存后必须清理已恢复的旧草稿');assert.ok(JSON.stringify(saved.content).includes('resourceId'));
 }catch(error){console.error('TEST FAILURE',error);console.error(await run.page.locator('#save-state').textContent().catch(()=>''));throw error;}finally{for(const p of run.app.windows())await p.evaluate(()=>window.discardChanges?.()).catch(()=>{});await run.close();}
});
