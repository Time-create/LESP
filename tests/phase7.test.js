const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { startApp } = require('./helpers');

const ROOT = path.join(__dirname, '..');

async function withApp(fn) {
  const app = await startApp();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}
async function post(app, url, body) {
  return (await fetch(app.base + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  })).json();
}
async function put(app, url, body) {
  return (await fetch(app.base + url, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  })).json();
}
async function get(app, url) {
  return (await fetch(app.base + url)).json();
}

test('Phase7 - 札记新建、关联对象与按对象查询', async () => {
  await withApp(async (app) => {
    const book = await post(app, '/api/items', { module: 'book', title: '宋代地方财政史研究', fields: { author: '包伟民' } });
    const n = await post(app, '/api/notes', {
      title: '读《宋代地方财政史研究》',
      body: '上供、留州、送使三分之说在两浙似难成立。',
      links: [{ type: 'item', id: book.id }]
    });
    assert.strictEqual(n.links.length, 1);
    assert.strictEqual(n.links[0].title, '宋代地方财政史研究');

    const byTarget = await get(app, '/api/notes?target_type=item&target_id=' + book.id);
    assert.strictEqual(byTarget.length, 1, '应能按关联对象查到札记');
    assert.strictEqual(byTarget[0].title, '读《宋代地方财政史研究》');
  });
});

test('Phase7 - 验收10：札记关联著作后，该著作详情笔记 Tab 可见', async () => {
  await withApp(async (app) => {
    const book = await post(app, '/api/items', { module: 'book', title: '宋代地方财政史研究', fields: { author: '包伟民' } });
    await post(app, '/api/notes', { title: '读后札记', body: '若干心得', links: [{ type: 'item', id: book.id }] });

    const html = await (await fetch(app.base + '/library/books/' + book.id)).text();
    assert.ok(html.includes('笔记 1'), 'Tab 应显示笔记数量 1，实际 HTML 片段：' + html.slice(0, 200));
    assert.ok(html.includes('读后札记'), '笔记 Tab 应列出该札记');
    assert.ok(html.includes('就此写札记'), '应提供「就此写札记」入口');
  });
});

test('Phase7 - 未关联的札记不会出现在其他条目下', async () => {
  await withApp(async (app) => {
    const a = await post(app, '/api/items', { module: 'book', title: '甲书', fields: {} });
    const b = await post(app, '/api/items', { module: 'book', title: '乙书', fields: {} });
    await post(app, '/api/notes', { title: '只关联甲书', body: '', links: [{ type: 'item', id: a.id }] });
    const res = await get(app, '/api/notes?target_type=item&target_id=' + b.id);
    assert.strictEqual(res.length, 0, '乙书不应出现甲书的札记');
  });
});

test('Phase7 - 札记标题必填、可删除，删除后解除关联', async () => {
  await withApp(async (app) => {
    const bad = await fetch(app.base + '/api/notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '  ' })
    });
    assert.strictEqual(bad.status, 400);

    const book = await post(app, '/api/items', { module: 'book', title: '某书', fields: {} });
    const n = await post(app, '/api/notes', { title: '临时', body: '', links: [{ type: 'item', id: book.id }] });
    await fetch(app.base + '/api/notes/' + n.id, { method: 'DELETE' });
    const left = await get(app, '/api/notes?target_type=item&target_id=' + book.id);
    assert.strictEqual(left.length, 0);
  });
});

test('Phase7 - 灵感四态流转与非法状态拒绝', async () => {
  await withApp(async (app) => {
    const i = await post(app, '/api/ideas', { title: '南宋社仓的运作实态', summary: '材料待补' });
    assert.strictEqual(i.status, '念头', '默认应为念头');

    const bad = await fetch(app.base + '/api/ideas/' + i.id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: '瞎写' })
    });
    assert.strictEqual(bad.status, 400, '非法状态应被拒');

    const up = await put(app, '/api/ideas/' + i.id, { status: '可开题' });
    assert.strictEqual(up.status, '可开题');
  });
});

test('Phase7 - 验收11：仅「可开题」可一键建长编，且带入已关联史料', async () => {
  await withApp(async (app) => {
    const item = await post(app, '/api/items', { module: 'classics', title: '宋会要辑稿', fields: { edition: '中华书局' } });
    const ex = await post(app, '/api/excerpts', { item_id: item.id, locator: '卷一三七', text: '绍兴十五年诏差役。' });
    const idea = await post(app, '/api/ideas', {
      title: '明清契约中的找价习惯', links: [{ type: 'item', id: item.id }]
    });

    // 念头状态下应被拒绝
    const denied = await fetch(app.base + '/api/ideas/' + idea.id + '/convert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    assert.strictEqual(denied.status, 400, '念头状态不应允许创建长编');

    await put(app, '/api/ideas/' + idea.id, { status: '可开题' });
    const r = await post(app, '/api/ideas/' + idea.id + '/convert', {});
    assert.strictEqual(r.imported, 1, '应带入 1 条史料摘录');
    assert.strictEqual(r.compilation.title, '明清契约中的找价习惯');
    assert.strictEqual(r.compilation.refs.length, 1);
    assert.ok(r.compilation.refs[0].text.includes('宋会要辑稿'));

    // 另建一个「念头」状态的灵感，用于对比按钮可用性
    const pending = await post(app, '/api/ideas', { title: '尚未成熟的念头' });
    const html = await (await fetch(app.base + '/writing/ideas')).text();
    assert.ok(html.includes('创建长编'), '灵感页应有创建长编按钮');

    const btnRe = (id) => new RegExp('data-act="convert" data-id="' + id + '" class="primary"([^>]*)>');
    const pendingBtn = html.match(btnRe(pending.id));
    assert.ok(pendingBtn, '应渲染念头灵感的按钮');
    assert.ok(pendingBtn[1].includes('disabled'), '念头状态的创建长编按钮应为 disabled，实际：' + pendingBtn[1]);

    const okBtn = html.match(btnRe(idea.id));
    assert.ok(okBtn, '应渲染可开题灵感的按钮');
    assert.ok(!okBtn[1].includes('disabled'), '可开题状态的创建长编按钮应可用');
  });
});

test('Phase7 - 灵感页按状态分组渲染', async () => {
  await withApp(async (app) => {
    await post(app, '/api/ideas', { title: '念头一', status: '念头' });
    await post(app, '/api/ideas', { title: '孵化一', status: '孵化中' });
    await post(app, '/api/ideas', { title: '开题一', status: '可开题' });
    const html = await (await fetch(app.base + '/writing/ideas')).text();
    for (const s of ['念头', '孵化中', '可开题', '已放弃']) {
      assert.ok(html.includes(s), '应渲染状态分组：' + s);
    }
    assert.ok(html.includes('念头一') && html.includes('孵化一') && html.includes('开题一'));
  });
});

test('Phase7 - 首页统计与三个最近列表', async () => {
  await withApp(async (app) => {
    const { seed } = require(path.join(ROOT, 'server/seed'));
    seed();
    const item = await post(app, '/api/items', { module: 'classics', title: '新增条目', fields: {} });
    const comp = await post(app, '/api/compilations', { title: '役法长编' });
    await post(app, '/api/notes', { title: '读后', body: 'x', links: [{ type: 'item', id: item.id }] });
    await post(app, '/api/ideas', { title: '社仓研究', status: '孵化中' });

    const html = await (await fetch(app.base + '/')).text();
    assert.ok(html.includes('史料条目'), '应有统计卡');
    assert.ok(html.includes('继续我的长编'), '应有长编列表');
    assert.ok(html.includes('最新读书札记'), '应有札记列表');
    assert.ok(html.includes('灵感池'), '应有灵感池');
    assert.ok(html.includes('最近入库'), '应有最近入库');
    assert.ok(html.includes('役法长编'), '长编应显示');
    assert.ok(html.includes('读后'), '札记应显示');
    assert.ok(html.includes('社仓研究'), '灵感应显示');
    assert.ok(html.includes('19'), '统计数字应为 19（18 条种子 + 1 条新增）');
  });
});

test('Phase7 - 条目详情页可查看关联长编', async () => {
  await withApp(async (app) => {
    const item = await post(app, '/api/items', { module: 'classics', title: '甲书', fields: {} });
    const ex = await post(app, '/api/excerpts', { item_id: item.id, locator: '卷一', text: '甲文。' });
    const c = await post(app, '/api/compilations', { title: '某长编' });
    await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'quote', excerpt_id: ex.id });
    const html = await (await fetch(app.base + '/sources/classics/' + item.id)).text();
    assert.ok(html.includes('关联长编 1'), 'Tab 应显示关联长编数量');
    assert.ok(html.includes('某长编'), '应列出长编标题');
  });
});

test('Phase7 - 前端脚本语法正确（notes / ideas）', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  for (const f of ['notes.js', 'ideas.js', 'compilation.js', 'item.js', 'upload.js', 'common.js']) {
    const code = fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8');
    new vm.Script(code, { filename: f });
  }
});
