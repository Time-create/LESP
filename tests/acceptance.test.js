// 全量验收走查：逐条对应 PRD §12 的 18 条验收标准
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/app');
const db = require('../server/db');
const paths = require('../server/lib/paths');
const { startApp } = require('./helpers');

const ROOT = path.join(__dirname, '..');

// 在同一数据目录上「重启」服务，用于验证重启不丢数据
async function bootAt(dir) {
  db.initDb(dir);
  const app = createApp();
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  return {
    base: 'http://127.0.0.1:' + server.address().port,
    shutdown: async () => {
      await new Promise((r) => server.close(r));
      db.closeDb();
    }
  };
}

async function withApp(fn) {
  const app = await startApp();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}
async function post(app, url, body) {
  const res = await fetch(app.base + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  });
  return { status: res.status, data: await res.json() };
}
async function put(app, url, body) {
  return (await fetch(app.base + url, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  })).json();
}
async function getJson(app, url) {
  return (await fetch(app.base + url)).json();
}

const MINI_PDF = '%PDF-1.4\ntrailer\n%%EOF\n';

test('验收1 - 新建条目后刷新页面字段完整', async () => {
  await withApp(async (app) => {
    const created = await post(app, '/api/items', {
      module: 'classics', title: '文献通考',
      fields: { author: '马端临', dynasty: '元', edition: '商务印书馆 1936', juan: '全 348 卷' }
    });
    const html = await (await fetch(app.base + '/sources/classics/' + created.data.id)).text();
    for (const v of ['文献通考', '马端临', '商务印书馆 1936', '全 348 卷']) {
      assert.ok(html.includes(v), '刷新后应保留：' + v);
    }
  });
});

test('验收2 - 关闭服务并重新启动后数据不丢失', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-restart-'));
  try {
    const a = await bootAt(dir);
    const item = await (await fetch(a.base + '/api/items', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'classics', title: '重启前写入的书', fields: { edition: '某版本' } })
    })).json();
    const comp = await (await fetch(a.base + '/api/compilations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '重启前的长编' })
    })).json();
    await a.shutdown();

    const b = await bootAt(dir);
    const list = await (await fetch(b.base + '/api/items')).json();
    assert.strictEqual(list.total, 1, '重启后条目应仍在');
    assert.strictEqual(list.items[0].title, '重启前写入的书');
    assert.strictEqual(list.items[0].fields.edition, '某版本');
    const comps = await (await fetch(b.base + '/api/compilations')).json();
    assert.strictEqual(comps.length, 1, '重启后长编应仍在');
    assert.strictEqual(comps[0].title, '重启前的长编');
    await b.shutdown();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('验收3 - 长编具备 V2 自动保存机制且正文可持久化', async () => {
  await withApp(async (app) => {
    const c = await post(app, '/api/compilations', { title: 'T' });
    const after = await post(app, '/api/compilations/' + c.data.id + '/blocks', { type: 'text', content: '初稿' });
    const bid = after.data.blocks[0].id;
    await put(app, '/api/compilations/' + c.data.id + '/blocks/' + bid, { content: '自动保存后的正文' });
    const cur = await getJson(app, '/api/compilations/' + c.data.id);
    assert.strictEqual(cur.blocks[0].content, '自动保存后的正文', '刷新后正文应保留');

    const html = await (await fetch(app.base + '/writing/compilations/' + c.data.id)).text();
    assert.ok(html.includes('id="save-state"'), '页头应有保存时间元素');
    const js = fs.readFileSync(path.join(ROOT, 'public/js/save-controller.js'), 'utf8');
    assert.ok(js.includes('2000')&&js.includes('10000')&&js.includes('composing'),'应具备2秒／10秒保存及中文输入保护');
    assert.ok(js.includes('已保存 '), '应显示已保存时间');
  });
});

test('验收4 - 一条条目同时属于两个分类', async () => {
  await withApp(async (app) => {
    const item = await post(app, '/api/items', { module: 'classics', title: '宋会要辑稿', fields: {} });
    const c1 = await post(app, '/api/collections', { module: 'classics', name: '宋代财政史' });
    const c2 = await post(app, '/api/collections', { module: 'classics', name: '基层治理' });
    await post(app, '/api/collections/' + c1.data.id + '/items', { item_id: item.data.id });
    await post(app, '/api/collections/' + c2.data.id + '/items', { item_id: item.data.id });
    const l1 = await getJson(app, '/api/items?collection=' + c1.data.id);
    const l2 = await getJson(app, '/api/items?collection=' + c2.data.id);
    assert.strictEqual(l1.total, 1);
    assert.strictEqual(l2.total, 1);
  });
});

test('验收5 - 检索命中录文正文（书名不含该词）', async () => {
  await withApp(async (app) => {
    const item = await post(app, '/api/items', { module: 'inscription', title: '宋故朱公墓志铭', fields: {} });
    await post(app, '/api/excerpts', { item_id: item.data.id, locator: '志文第 5 行', text: '公尝充里正，凡三岁。' });
    const r = await getJson(app, '/api/search?q=' + encodeURIComponent('里正'));
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.items[0].title, '宋故朱公墓志铭');
    assert.ok(r.items[0].hit_excerpts[0].text.includes('里正'));
  });
});

test('验收6 - 插入摘录生成正文与朱砂圈标脚注', async () => {
  await withApp(async (app) => {
    const item = await post(app, '/api/items', { module: 'classics', title: '宋会要辑稿', fields: { edition: '中华书局 1957 年影印本' } });
    const ex = await post(app, '/api/excerpts', { item_id: item.data.id, locator: '卷一三七 · 食货 · 役法', text: '绍兴十五年，诏两浙路诸县差役。' });
    const c = await post(app, '/api/compilations', { title: '役法长编' });
    const after = await post(app, '/api/compilations/' + c.data.id + '/blocks', { type: 'quote', excerpt_id: ex.data.id });
    assert.strictEqual(after.data.refs.length, 1);
    assert.strictEqual(after.data.refs[0].mark, '①');
    assert.strictEqual(after.data.refs[0].text, '《宋会要辑稿》卷一三七 · 食货 · 役法，中华书局 1957 年影印本。');
    const html = await (await fetch(app.base + '/writing/compilations/' + c.data.id)).text();
    const document=await getJson(app,'/api/writing/compilation/'+c.data.id+'/document');
    assert.ok(JSON.stringify(document.content).includes('绍兴十五年，诏两浙路诸县差役。'),'新版正文必须保留原文');
    const order=require('../shared/citation-order');assert.equal(order.markFor(1),'①');assert.equal(order.references(document.content).length,1);
    assert.ok(html.includes('citation-list'),'新版需渲染注释区');
  });
});

test('验收7 - 删除首个引用块后剩余脚注重排为 ① ②', async () => {
  await withApp(async (app) => {
    const c = await post(app, '/api/compilations', { title: 'T' });
    const ids = [];
    for (const name of ['甲书', '乙书', '丙书']) {
      const it = await post(app, '/api/items', { module: 'classics', title: name, fields: {} });
      const ex = await post(app, '/api/excerpts', { item_id: it.data.id, locator: '卷一', text: name + '文。' });
      const r = await post(app, '/api/compilations/' + c.data.id + '/blocks', { type: 'quote', excerpt_id: ex.data.id });
      ids.push(r.data.blocks[r.data.blocks.length - 1].id);
    }
    let cur = await getJson(app, '/api/compilations/' + c.data.id);
    assert.deepStrictEqual(cur.refs.map((r) => r.mark), ['①', '②', '③']);
    await fetch(app.base + '/api/compilations/' + c.data.id + '/blocks/' + ids[0], { method: 'DELETE' });
    cur = await getJson(app, '/api/compilations/' + c.data.id);
    assert.deepStrictEqual(cur.refs.map((r) => r.mark), ['①', '②']);
    assert.ok(cur.refs[0].text.includes('乙书'));
  });
});

test('验收8 - 切换夹注：页底清空、出处内联', async () => {
  await withApp(async (app) => {
    const it = await post(app, '/api/items', { module: 'classics', title: '甲书', fields: { edition: '某版本' } });
    const ex = await post(app, '/api/excerpts', { item_id: it.data.id, locator: '卷一', text: '甲文。' });
    const c = await post(app, '/api/compilations', { title: 'T' });
    await post(app, '/api/compilations/' + c.data.id + '/blocks', { type: 'quote', excerpt_id: ex.data.id });
    await put(app, '/api/compilations/' + c.data.id, { footnote_style: 'inline' });
    const html = await (await fetch(app.base + '/writing/compilations/' + c.data.id)).text();
    const document=await getJson(app,'/api/writing/compilation/'+c.data.id+'/document');
    const exported=require('../server/services/writing-export').html({...document,images:{},order:require('../shared/citation-order').references(document.content)},'');
    assert.ok(exported.includes('（《甲书》卷一，某版本。）'),'内联需显示完整出处');
    assert.ok(!exported.includes('class="footnote"'),'夹注不能再生成页脚注释');
  });
});

test('验收9 - 导出 Markdown 含正文、按语与全部脚注', async () => {
  await withApp(async (app) => {
    const it = await post(app, '/api/items', { module: 'classics', title: '甲书', fields: { edition: '某版本' } });
    const ex = await post(app, '/api/excerpts', { item_id: it.data.id, locator: '卷一', text: '绍兴十五年诏差役。' });
    const c = await post(app, '/api/compilations', { title: '役法长编' });
    await post(app, '/api/compilations/' + c.data.id + '/blocks', { type: 'quote', excerpt_id: ex.data.id });
    await post(app, '/api/compilations/' + c.data.id + '/blocks', { type: 'comment', content: '雇钱标准待考。' });
    const md = await (await fetch(app.base + '/api/compilations/' + c.data.id + '/export')).text();
    assert.ok(md.includes('# 役法长编'));
    assert.ok(md.includes('绍兴十五年诏差役。'));
    assert.ok(md.includes('> 按：雇钱标准待考。'));
    assert.ok(md.includes('《甲书》卷一，某版本。'));
    assert.ok(md.includes('①'));
  });
});

test('验收10 - 札记关联著作后在该著作笔记 Tab 可见', async () => {
  await withApp(async (app) => {
    const book = await post(app, '/api/items', { module: 'book', title: '宋代地方财政史研究', fields: { author: '包伟民' } });
    await post(app, '/api/notes', { title: '读《宋代地方财政史研究》', body: '若干心得', links: [{ type: 'item', id: book.data.id }] });
    const html = await (await fetch(app.base + '/library/books/' + book.data.id)).text();
    assert.ok(html.includes('笔记 1'));
    assert.ok(html.includes('读《宋代地方财政史研究》'));
  });
});

test('验收11 - 灵感改为可开题后创建长编按钮可用', async () => {
  await withApp(async (app) => {
    const i = await post(app, '/api/ideas', { title: '某选题' });
    let html = await (await fetch(app.base + '/writing/ideas')).text();
    const re = (id) => new RegExp('data-act="convert" data-id="' + id + '" class="primary"([^>]*)>');
    assert.ok(html.match(re(i.data.id))[1].includes('disabled'), '念头状态应禁用');
    await put(app, '/api/ideas/' + i.data.id, { status: '可开题' });
    html = await (await fetch(app.base + '/writing/ideas')).text();
    assert.ok(!html.match(re(i.data.id))[1].includes('disabled'), '可开题状态应可用');
  });
});

test('验收12 - PDF 在内置阅读器中打开', async () => {
  await withApp(async (app) => {
    const item = await post(app, '/api/items', { module: 'classics', title: '甲书', fields: {} });
    const form = new FormData();
    form.append('file', new Blob([MINI_PDF], { type: 'application/pdf' }), '宋会要卷137.pdf');
    const up = await (await fetch(app.base + '/api/attachments/upload?item_id=' + item.data.id, { method: 'POST', body: form })).json();
    const reader = await (await fetch(app.base + '/reader/' + up.id)).text();
    assert.ok(reader.includes('id="pdf-canvas"')&&reader.includes('id="pdf-text-layer"')&&reader.includes('/static/dist/reader.js'),'PDF 应在可批注的本地阅读器渲染');
    const file = await fetch(app.base + '/api/attachments/' + up.id + '/file');
    assert.strictEqual(file.status, 200);
  });
});

test('验收13 - 上传 .exe 被拒绝', async () => {
  await withApp(async (app) => {
    const item = await post(app, '/api/items', { module: 'classics', title: '甲书', fields: {} });
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('MZ')], { type: 'application/octet-stream' }), 'x.exe');
    const res = await fetch(app.base + '/api/attachments/upload?item_id=' + item.data.id, { method: 'POST', body: form });
    assert.strictEqual(res.status, 400);
    const e = await res.json();
    assert.ok(e.error.includes('仅支持'));
  });
});

test('验收14 - 未配置知网登录态时不发起请求', async () => {
  const cnki = require(path.join(ROOT, 'server/services/cnki'));
  let calls = 0;
  cnki.setHttpFn(async () => { calls += 1; return { status: 200, body: '' }; });
  try {
    await withApp(async (app) => {
      const r = await post(app, '/api/cnki/search', { keyword: '役法' });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(calls, 0);
    });
  } finally {
    cnki.setHttpFn(null);
  }
});

test('验收15 - 知网导入 2 条并标记已入库', async () => {
  const cnki = require(path.join(ROOT, 'server/services/cnki'));
  const html = '<table>' +
    ['南宋差役与雇役的制度张力|李华瑞|中国史研究|2020(2)',
     '宋代乡役人身份与待遇|王晓龙|宋史研究论丛|2019(1)',
     '两浙路赋役负担的区域差异|张锦鹏|中国经济史研究|2017(5)']
      .map((r) => {
        const p = r.split('|');
        return `<tr><td><a class="fz14">${p[0]}</a></td><td class="author">${p[1]}</td>` +
          `<td class="source">${p[2]}</td><td class="date">${p[3]}</td></tr>`;
      }).join('') + '</table>';
  cnki.setHttpFn(async () => ({ status: 200, body: html }));
  try {
    await withApp(async (app) => {
      await fetch(app.base + '/api/cnki/cookie', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: 'uid=test' })
      });
      const first = await post(app, '/api/cnki/search', { keyword: '役法' });
      const imp = await post(app, '/api/cnki/import', { items: first.data.results.slice(0, 2) });
      assert.strictEqual(imp.data.created, 2);
      const second = await post(app, '/api/cnki/search', { keyword: '役法' });
      assert.strictEqual(second.data.results.filter((r) => r.imported).length, 2);
      assert.strictEqual(second.data.results.find((r) => r.title === '两浙路赋役负担的区域差异').imported, false);
    });
  } finally {
    cnki.setHttpFn(null);
  }
});

test('验收16 - 备份生成且条目数附件数与库一致', async () => {
  await withApp(async (app) => {
    const item = await post(app, '/api/items', { module: 'classics', title: '甲书', fields: {} });
    const form = new FormData();
    form.append('file', new Blob([MINI_PDF], { type: 'application/pdf' }), 'a.pdf');
    await fetch(app.base + '/api/attachments/upload?item_id=' + item.data.id, { method: 'POST', body: form });
    const r = await post(app, '/api/backup/create', {});
    const list = await getJson(app, '/api/items');
    assert.strictEqual(r.data.itemCount, list.total, '备份记录条目数应与库一致');
    assert.strictEqual(r.data.attachmentCount, 1);
    assert.ok(fs.existsSync(path.join(paths.backupsDir(), r.data.file)));
  });
});

test('验收17 - 恢复后条目数、附件数、附件内容与备份一致', async () => {
  await withApp(async (app) => {
    const item = await post(app, '/api/items', { module: 'classics', title: '宋会要辑稿', fields: { edition: '中华书局' } });
    const form = new FormData();
    form.append('file', new Blob([MINI_PDF], { type: 'application/pdf' }), 'keep.pdf');
    const up = await (await fetch(app.base + '/api/attachments/upload?item_id=' + item.data.id, { method: 'POST', body: form })).json();
    const bak = await post(app, '/api/backup/create', {});

    const list = await getJson(app, '/api/items');
    for (const it of list.items) {
      await fetch(app.base + '/api/items/' + it.id, { method: 'DELETE' });
    }
    assert.strictEqual((await getJson(app, '/api/items')).total, 0);

    const res = await post(app, '/api/backup/restore', { file: bak.data.file });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.itemCount, bak.data.itemCount);
    assert.strictEqual(res.data.attachmentCount, bak.data.attachmentCount);
    const file = await fetch(app.base + '/api/attachments/' + up.id + '/file');
    assert.strictEqual(file.status, 200);
    assert.ok((await file.text()).startsWith('%PDF'));
  });
});

test('验收18 - 第 9 次备份后仅保留 7 份', async () => {
  await withApp(async (app) => {
    for (let i = 0; i < 9; i++) {
      await post(app, '/api/backup/create', {});
      await new Promise((r) => setTimeout(r, 60));
    }
    const files = fs.readdirSync(paths.backupsDir()).filter((f) => f.startsWith('backup-'));
    assert.strictEqual(files.length, 7, '实际保留 ' + files.length + ' 份');
  });
});
