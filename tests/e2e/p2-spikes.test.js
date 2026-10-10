const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, root } = require('./helpers');
test('P2 desktop: Unicode editor undo, PDF coordinate roundtrip and true paged footnote layout', { timeout: 120000 }, async () => {
  const run = await launch();
  try {
    await run.page.setContent('<style>.ProseMirror{min-height:200px;font-family:SimSun}</style><div id="editor"></div>');
    await run.page.addScriptTag({url:run.base+'/static/dist/p2-editor.js'});
    await run.page.locator('.ProseMirror').click();
    await run.page.keyboard.press('Control+End'); await run.page.keyboard.insertText('中文输入验证');
    assert.match(await run.page.locator('.ProseMirror').innerText(),/中文输入验证/);
    await run.page.keyboard.press('Control+z'); assert.doesNotMatch(await run.page.locator('.ProseMirror').innerText(),/中文输入验证/);
    const geometries=await run.page.evaluate(async base=>{
      const {getDocument}=await import(base+'/static/dist/pdf/pdf.mjs');
      const mod=await import(base+'/static/dist/pdf/pdf.mjs');mod.GlobalWorkerOptions.workerSrc=base+'/static/dist/pdf/pdf.worker.mjs';
      const pdf=await getDocument({data:new Uint8Array(await (await fetch(base+'/static/p2-source.pdf')).arrayBuffer())}).promise;
      const page=await pdf.getPage(1);
      return [0,90,180,270].map(rotation=>{const vp=page.getViewport({scale:1.5,rotation});const xy=vp.convertToViewportPoint(60,735);return vp.convertToPdfPoint(...xy);});
    },run.base);
    for(const p of geometries){assert.ok(Math.abs(p[0]-60)<0.01);assert.ok(Math.abs(p[1]-735)<0.01);}
    const paragraphs=Array.from({length:35},(_,i)=>`<p>第 ${i+1} 段，宋体分析正文。${'史料与分析需要清晰区分。'.repeat(6)}<span class="fn">${i+1} 《测试文献》卷三，第八页。${'这是较长的出处说明。'.repeat(2)}</span></p>`).join('');
    await run.page.setContent(`<html><head><style>@page{size:A4;margin:20mm;@bottom-center{content:counter(page)}}body{font:12pt SimSun;line-height:1.6}.fn{float:footnote;font-size:10.5pt}.pagedjs_footnote_area{border-top:1px solid #888}.pagedjs_page{background:white}</style></head><body><h1>分页脚注技术验证</h1>${paragraphs}</body></html>`);
    await run.page.addScriptTag({url:run.base+'/static/dist/paged.polyfill.js'});
    await run.page.waitForFunction(()=>document.querySelectorAll('.pagedjs_page').length>2&&document.querySelectorAll('.pagedjs_footnote_area .fn').length===35);
    const result=await run.page.evaluate(()=>({pages:document.querySelectorAll('.pagedjs_page').length,notes:document.querySelectorAll('.pagedjs_footnote_area .fn').length}));
    assert.equal(result.notes,35);
    const pdf=await run.app.evaluate(async({BrowserWindow})=>Array.from(await BrowserWindow.getAllWindows()[0].webContents.printToPDF({printBackground:true,preferCSSPageSize:true})));
    fs.mkdirSync(path.join(root,'docs/v2/samples'),{recursive:true});fs.writeFileSync(path.join(root,'docs/v2/samples/paged-footnotes.pdf'),Buffer.from(pdf));
    const png=await run.app.evaluate(async({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.showInactive();const image=await win.webContents.capturePage(undefined,{stayAwake:true});win.hide();return Array.from(image.toPNG());});
    assert.ok(png.length>1000);
    fs.writeFileSync(path.join(root,'docs/v2/samples/paged-footnotes.png'),Buffer.from(png));
    fs.writeFileSync(path.join(root,'docs/v2/samples/paged-result.json'),JSON.stringify(result));
  } finally { await run.close(); }
});
