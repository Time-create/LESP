const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { startApp } = require('./helpers');

const ROOT = path.join(__dirname, '..');

async function json(res) {
  return res.json();
}

test('Phase3 - 新建条目并可按模块筛选', async () => {
  const app = await startApp();
  const created = await json(await fetch(app.base + '/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module: 'classics',
      title: '文献通考',
      fields: { author: '马端临', dynasty: '元', edition: '商务印书馆' }
    })
  }));
  assert.strictEqual(created.title, '文献通考');
  assert.strictEqual(created.fields.author, '马端临');
  assert.ok(created.id > 0);

  const list = await json(await fetch(app.base + '/api/items?module=classics'));
  assert.strictEqual(list.total, 1);
  assert.strictEqual(list.items[0].title, '文献通考');

  const other = await json(await fetch(app.base + '/api/items?module=inscription'));
  assert.strictEqual(other.total, 0, '其他模块不应出现该条目');
  await app.close();
});

test('Phase3 - 必填校验：文书缺类型被拒、标题缺失被拒', async () => {
  const app = await startApp();
  const bad1 = await fetch(app.base + '/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'document', title: '某契约', fields: {} })
  });
  assert.strictEqual(bad1.status, 400);
  const e1 = await json(bad1);
  assert.ok(e1.error.includes('文书类型必填'), '应提示文书类型必填，实际：' + e1.error);

  const bad2 = await fetch(app.base + '/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'classics', title: '  ', fields: {} })
  });
  assert.strictEqual(bad2.status, 400);
  const e2 = await json(bad2);
  assert.ok(e2.error.includes('标题必填'));

  const bad3 = await fetch(app.base + '/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'nope', title: 'x', fields: {} })
  });
  assert.strictEqual(bad3.status, 400);
  await app.close();
});

test('Phase3 - 枚举字段取值无效被拒', async () => {
  const app = await startApp();
  const res = await fetch(app.base + '/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'document', title: '某文书', fields: { doc_type: '不存在的类型' } })
  });
  assert.strictEqual(res.status, 400);
  const e = await json(res);
  assert.ok(e.error.includes('取值无效'));
  await app.close();
});

test('Phase3 - 验收4：一条条目可同时属于两个分类，两个分类下都能筛到', async () => {
  const app = await startApp();
  const item = await json(await fetch(app.base + '/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'classics', title: '宋会要辑稿', fields: { dynasty: '清' } })
  }));

  const c1 = await json(await fetch(app.base + '/api/collections', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'classics', name: '宋代财政史' })
  }));
  const c2 = await json(await fetch(app.base + '/api/collections', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'classics', name: '基层治理' })
  }));

  await fetch(app.base + '/api/collections/' + c1.id + '/items', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: item.id })
  });
  await fetch(app.base + '/api/collections/' + c2.id + '/items', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: item.id })
  });

  const inC1 = await json(await fetch(app.base + '/api/items?collection=' + c1.id));
  const inC2 = await json(await fetch(app.base + '/api/items?collection=' + c2.id));
  assert.strictEqual(inC1.total, 1, '分类一应能筛到');
  assert.strictEqual(inC2.total, 1, '分类二应能筛到');
  assert.strictEqual(inC1.items[0].id, item.id);
  assert.strictEqual(inC2.items[0].id, item.id);

  const detail = await json(await fetch(app.base + '/api/items/' + item.id));
  assert.strictEqual(detail.collections.length, 2, '详情应显示两个分类');
  await app.close();
});

test('Phase3 - 验收5：检索能命中录文正文（书名不含该词）', async () => {
  const app = await startApp();
  const { seed } = require(path.join(ROOT, 'server/seed'));
  seed();

  const res = await json(await fetch(app.base + '/api/search?q=' + encodeURIComponent('里正')));
  assert.ok(res.total >= 1, '「里正」应命中');
  const hit = res.items.find((i) => i.title === '宋故朱公墓志铭');
  assert.ok(hit, '应命中《宋故朱公墓志铭》');
  assert.ok(!hit.title.includes('里正'), '书名本身不含该词，说明命中的是录文');
  assert.ok(hit.hit_excerpts.length >= 1, '应返回命中的摘录片段');
  assert.ok(hit.hit_excerpts[0].text.includes('里正'));

  const none = await json(await fetch(app.base + '/api/search?q=' + encodeURIComponent('量子力学')));
  assert.strictEqual(none.total, 0, '无关词不应命中');
  await app.close();
});

test('Phase3 - 检索可按模块过滤，且列表接口 q 参数同样生效', async () => {
  const app = await startApp();
  const { seed } = require(path.join(ROOT, 'server/seed'));
  seed();
  const all = await json(await fetch(app.base + '/api/search?q=' + encodeURIComponent('役')));
  const insc = await json(await fetch(app.base + '/api/search?q=' + encodeURIComponent('里正') + '&module=inscription'));
  assert.ok(insc.total >= 1);
  assert.ok(insc.items.every((i) => i.module === 'inscription'));

  const list = await json(await fetch(app.base + '/api/items?q=' + encodeURIComponent('里正')));
  assert.strictEqual(list.total, 1);
  await app.close();
});

test('Phase3 - 标签可创建、附加与筛选', async () => {
  const app = await startApp();
  const item = await json(await fetch(app.base + '/api/items', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'classics', title: '建炎以来系年要录', tags: ['役法', '南宋'] })
  }));
  assert.strictEqual(item.tags.length, 2);

  const tags = await json(await fetch(app.base + '/api/tags'));
  assert.strictEqual(tags.length, 2);
  const tag = tags.find((t) => t.name === '役法');
  const filtered = await json(await fetch(app.base + '/api/items?tag=' + tag.id));
  assert.strictEqual(filtered.total, 1);
  await app.close();
});

test('Phase3 - 更新条目后全文索引同步', async () => {
  const app = await startApp();
  const item = await json(await fetch(app.base + '/api/items', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'book', title: '宋代财政史', fields: { author: '包伟民' } })
  }));
  let r = await json(await fetch(app.base + '/api/search?q=' + encodeURIComponent('财政史')));
  assert.strictEqual(r.total, 1, '原标题应可检索');

  await fetch(app.base + '/api/items/' + item.id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '明代盐法志', fields: { author: '包伟民' } })
  });
  r = await json(await fetch(app.base + '/api/search?q=' + encodeURIComponent('财政史')));
  assert.strictEqual(r.total, 0, '原标题应从索引中移除');
  r = await json(await fetch(app.base + '/api/search?q=' + encodeURIComponent('盐法')));
  assert.strictEqual(r.total, 1, '新标题应可检索');
  await app.close();
});

test('Phase3 - 删除条目：索引清除、分类与标签关联解除', async () => {
  const app = await startApp();
  const item = await json(await fetch(app.base + '/api/items', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'classics', title: '待删除书', tags: ['tmp'], collections: ['tmp分类'] })
  }));
  const del = await json(await fetch(app.base + '/api/items/' + item.id, { method: 'DELETE' }));
  assert.strictEqual(del.ok, true);

  const list = await json(await fetch(app.base + '/api/items'));
  assert.strictEqual(list.total, 0);
  const r = await json(await fetch(app.base + '/api/search?q=' + encodeURIComponent('待删除书')));
  assert.strictEqual(r.total, 0, '删除后索引应清除');

  const ci = await json(await fetch(app.base + '/api/collections?module=classics'));
  assert.strictEqual(ci[0].item_count, 0, '分类关联应解除');
  await app.close();
});

test('Phase3 - 分页参数生效', async () => {
  const app = await startApp();
  for (let i = 1; i <= 7; i++) {
    await fetch(app.base + '/api/items', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'paper', title: '论文' + i, fields: {} })
    });
  }
  const p1 = await json(await fetch(app.base + '/api/items?size=3&page=1'));
  const p3 = await json(await fetch(app.base + '/api/items?size=3&page=3'));
  assert.strictEqual(p1.items.length, 3);
  assert.strictEqual(p1.total, 7);
  assert.strictEqual(p3.items.length, 1);
  await app.close();
});

test('Phase3 - 非法模块名返回 400', async () => {
  const app = await startApp();
  const res = await fetch(app.base + '/api/items?module=bad');
  assert.strictEqual(res.status, 400);
  await app.close();
});
