const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { startApp } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const cnki = require(path.join(ROOT, 'server/services/cnki'));

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
async function get(app, url) {
  const res = await fetch(app.base + url);
  return { status: res.status, data: await res.json() };
}

// 模拟知网结果页 HTML
function fakeHtml() {
  const rows = [
    ['南宋差役与雇役的制度张力', '李华瑞', '中国史研究', '2020(2)'],
    ['宋代乡役人身份与待遇', '王晓龙', '宋史研究论丛', '2019(1)'],
    ['两浙路赋役负担的区域差异', '张锦鹏', '中国经济史研究', '2017(5)']
  ];
  return '<table>' + rows.map((r) =>
    `<tr><td><a class="fz14" href="#">${r[0]}</a></td>` +
    `<td class="author">${r[1]}</td><td class="source">${r[2]}</td><td class="date">${r[3]}</td></tr>`
  ).join('') + '</table>';
}

test('Phase8 - 验收14：未配置登录态时检索被拒且不发起任何外部请求', async () => {
  let calls = 0;
  cnki.setHttpFn(async () => { calls += 1; return { status: 200, body: fakeHtml() }; });
  await withApp(async (app) => {
    const r = await post(app, '/api/cnki/search', { keyword: '役法' });
    assert.strictEqual(r.status, 400, '应返回 400');
    assert.strictEqual(r.data.code, 'NO_COOKIE');
    assert.ok(r.data.error.includes('登录态'), '应提示更新登录态');
    assert.strictEqual(calls, 0, '未配置登录态时不得发起请求，实际发起 ' + calls + ' 次');
  });
  cnki.setHttpFn(null);
});

test('Phase8 - 配置登录态后可检索到题录', async () => {
  cnki.setHttpFn(async () => ({ status: 200, body: fakeHtml() }));
  await withApp(async (app) => {
    await fetch(app.base + '/api/cnki/cookie', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: 'uid=test; token=abc' })
    });
    const r = await post(app, '/api/cnki/search', { keyword: '役法' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.total, 3, '应解析出 3 条，实际：' + JSON.stringify(r.data));
    assert.strictEqual(r.data.results[0].title, '南宋差役与雇役的制度张力');
    assert.strictEqual(r.data.results[0].authors, '李华瑞');
    assert.strictEqual(r.data.results[0].journal, '中国史研究');
    assert.strictEqual(r.data.results[0].year_volume, '2020(2)');
    assert.ok(r.data.results.every((x) => x.imported === false), '初始都应未入库');
  });
  cnki.setHttpFn(null);
});

test('Phase8 - 验收15：勾选导入后再次检索标记为已入库', async () => {
  cnki.setHttpFn(async () => ({ status: 200, body: fakeHtml() }));
  await withApp(async (app) => {
    await fetch(app.base + '/api/cnki/cookie', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: 'uid=test' })
    });
    const first = await post(app, '/api/cnki/search', { keyword: '役法' });
    const picked = first.data.results.slice(0, 2);
    const imp = await post(app, '/api/cnki/import', { items: picked });
    assert.strictEqual(imp.data.created, 2, '应创建 2 条');
    assert.strictEqual(imp.data.skipped, 0);

    // 入库后应出现在论文模块
    const list = await get(app, '/api/items?module=paper');
    assert.strictEqual(list.data.total, 2);
    assert.ok(list.data.items.some((i) => i.title === '南宋差役与雇役的制度张力'));
    const one = list.data.items.find((i) => i.title === '南宋差役与雇役的制度张力');
    assert.strictEqual(one.fields.author, '李华瑞');
    assert.strictEqual(one.fields.source, '知网抓取');

    // 再次检索：这 2 条应标记为已入库
    const second = await post(app, '/api/cnki/search', { keyword: '役法' });
    const importedCount = second.data.results.filter((r) => r.imported).length;
    assert.strictEqual(importedCount, 2, '已导入的 2 条应标记为已入库');
    const third = second.data.results.find((r) => r.title === '两浙路赋役负担的区域差异');
    assert.strictEqual(third.imported, false, '未导入的仍应为未入库');
  });
  cnki.setHttpFn(null);
});

test('Phase8 - 重复导入被跳过（按题名+作者+年卷期判重）', async () => {
  cnki.setHttpFn(async () => ({ status: 200, body: fakeHtml() }));
  await withApp(async (app) => {
    await fetch(app.base + '/api/cnki/cookie', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: 'uid=test' })
    });
    const r1 = await post(app, '/api/cnki/search', { keyword: '役法' });
    await post(app, '/api/cnki/import', { items: r1.data.results });
    const again = await post(app, '/api/cnki/import', { items: r1.data.results });
    assert.strictEqual(again.data.created, 0);
    assert.strictEqual(again.data.skipped, 3, '3 条重复应全部跳过');
  });
  cnki.setHttpFn(null);
});

test('Phase8 - 登录态失效时给出明确提示', async () => {
  cnki.setHttpFn(async () => ({ status: 200, body: '<div>用户登录 - 中国知网</div>' }));
  await withApp(async (app) => {
    await fetch(app.base + '/api/cnki/cookie', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: 'uid=old' })
    });
    const r = await post(app, '/api/cnki/search', { keyword: '役法' });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.data.code, 'COOKIE_EXPIRED');
    assert.ok(r.data.error.includes('登录态已失效'));
  });
  cnki.setHttpFn(null);
});

test('Phase8 - 限速：连续两次检索间隔不小于 3 秒', async () => {
  const times = [];
  cnki.setHttpFn(async () => { times.push(Date.now()); return { status: 200, body: fakeHtml() }; });
  await withApp(async (app) => {
    await fetch(app.base + '/api/cnki/cookie', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: 'uid=test' })
    });
    await post(app, '/api/cnki/search', { keyword: '甲' });
    await post(app, '/api/cnki/search', { keyword: '乙' });
    assert.strictEqual(times.length, 2, '应发起两次请求');
    const gap = times[1] - times[0];
    assert.ok(gap >= 3000, '两次检索间隔应 ≥3000ms，实际 ' + gap + 'ms');
  });
  cnki.setHttpFn(null);
});

test('Phase8 - 单页结果不超过 20 条', async () => {
  let big = '<table>';
  for (let i = 1; i <= 30; i++) {
    big += `<tr><td><a class="fz14">论文${i}</a></td><td class="author">作者${i}</td>` +
      `<td class="source">刊${i}</td><td class="date">2020(${i})</td></tr>`;
  }
  big += '</table>';
  cnki.setHttpFn(async () => ({ status: 200, body: big }));
  await withApp(async (app) => {
    await fetch(app.base + '/api/cnki/cookie', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: 'uid=test' })
    });
    const r = await post(app, '/api/cnki/search', { keyword: 'x' });
    assert.ok(r.data.total <= 20, '单页结果应 ≤20，实际 ' + r.data.total);
  });
  cnki.setHttpFn(null);
});

test('Phase8 - 关键词为空被拒；登录态可保存与清除', async () => {
  await withApp(async (app) => {
    const r = await post(app, '/api/cnki/search', { keyword: '  ' });
    assert.strictEqual(r.status, 400);

    const st0 = await get(app, '/api/cnki/status');
    assert.strictEqual(st0.data.hasCookie, false);

    await fetch(app.base + '/api/cnki/cookie', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: 'uid=abc' })
    });
    const st1 = await get(app, '/api/cnki/status');
    assert.strictEqual(st1.data.hasCookie, true);
    assert.ok(st1.data.updatedAt, '应记录更新时间');

    await fetch(app.base + '/api/cnki/cookie', { method: 'DELETE' });
    const st2 = await get(app, '/api/cnki/status');
    assert.strictEqual(st2.data.hasCookie, false);
  });
});

// V5.3 收尾：知网抓取功能已按用户要求移除（初版遗留、已废弃）。
// 这里改为断言「确实已移除」，避免留下失效的期望。
test('Phase8 - 知网抓取抽屉已移除', async () => {
  await withApp(async (app) => {
    const html = await (await fetch(app.base + '/library/papers')).text();
    assert.ok(!html.includes('cnki-box'), '不应再渲染知网抽屉');
    assert.ok(!html.includes('cnki-search'), '不应再有检索按钮');
    assert.ok(!html.includes('/static/js/cnki.js'), '不应再注入 cnki.js');

    const item = await (await fetch(app.base + '/library/papers')).text();
    assert.ok(!item.includes('导入所选'), '不应再有「导入所选」');

    // 其它模块同样不应出现
    const other = await (await fetch(app.base + '/sources/classics')).text();
    assert.ok(!other.includes('cnki-box'), '古籍模块不应出现知网抽屉');
  });
});
