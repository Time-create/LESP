const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startApp } = require('./helpers');

async function withApp(fn) {
  const app = await startApp();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

async function createItem(app, module = 'classics', title = '测试条目') {
  const res = await fetch(app.base + '/api/items', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module, title, fields: {} })
  });
  return res.json();
}

async function uploadFile(app, itemId, filename, content, mime) {
  const form = new FormData();
  form.append('file', new Blob([content], { type: mime }), filename);
  const res = await fetch(app.base + '/api/attachments/upload?item_id=' + itemId, {
    method: 'POST', body: form
  });
  return { res, data: await res.json().catch(() => ({})) };
}

const MINI_PDF = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n';

test('Phase5 - 录文新增 / 修改 / 删除，并同步全文索引', async () => {
  await withApp(async (app) => {
    const item = await createItem(app);
    const ex = await (await fetch(app.base + '/api/excerpts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, locator: '卷一三七', text: '绍兴十五年诏两浙路差役', comment: '待比对' })
    })).json();
    assert.strictEqual(ex.locator, '卷一三七');

    let r = await (await fetch(app.base + '/api/search?q=' + encodeURIComponent('两浙路差役'))).json();
    assert.strictEqual(r.total, 1, '录文应进入检索');

    await fetch(app.base + '/api/excerpts/' + ex.id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '绍兴十五年诏江南东路差役' })
    });
    r = await (await fetch(app.base + '/api/search?q=' + encodeURIComponent('两浙路差役'))).json();
    assert.strictEqual(r.total, 0, '修改后旧词不应再命中');
    r = await (await fetch(app.base + '/api/search?q=' + encodeURIComponent('江南东路'))).json();
    assert.strictEqual(r.total, 1, '新录文应可检索');

    await fetch(app.base + '/api/excerpts/' + ex.id, { method: 'DELETE' });
    r = await (await fetch(app.base + '/api/search?q=' + encodeURIComponent('江南东路'))).json();
    assert.strictEqual(r.total, 0, '删除后索引应清除');
  });
});

test('Phase5 - 录文正文必填', async () => {
  await withApp(async (app) => {
    const item = await createItem(app);
    const res = await fetch(app.base + '/api/excerpts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, locator: '卷一', text: '  ' })
    });
    assert.strictEqual(res.status, 400);
    const e = await res.json();
    assert.ok(e.error.includes('必填'));
  });
});

test('Phase5 - 验收12：上传 PDF 后可在内置阅读器打开', async () => {
  await withApp(async (app) => {
    const item = await createItem(app);
    const { res, data } = await uploadFile(app, item.id, '宋会要卷137.pdf', MINI_PDF, 'application/pdf');
    assert.strictEqual(res.status, 200, 'PDF 应上传成功：' + JSON.stringify(data));
    // 现行存储布局：files/attachments/<时间戳>-<8位随机串>-<原名>（见 services/attachment-store.js uniqueStoreName）。
    // 原断言 files/<item_id>/ 是更早「按条目分目录」的设计，附件改为统一目录后未同步。
    assert.ok(data.rel_path.startsWith('files/attachments/'), '附件应存放在统一附件目录：' + data.rel_path);
    assert.ok(data.rel_path.endsWith('.pdf'), '应保留扩展名：' + data.rel_path);
    assert.ok(/^\d+-[0-9a-f]{8}-/.test(data.rel_path.replace('files/attachments/', '')), '存储名应为 时间戳-随机串-原名：' + data.rel_path);
    assert.ok(data.filename === '宋会要卷137.pdf', '原始文件名应保留在记录里：' + data.filename);

    const list = await (await fetch(app.base + '/api/attachments?item_id=' + item.id)).json();
    assert.strictEqual(list.length, 1);

    const reader = await fetch(app.base + '/reader/' + data.id);
    assert.strictEqual(reader.status, 200);
    const html = await reader.text();
    assert.ok(html.includes('id="pdf-canvas"')&&html.includes('id="pdf-text-layer"')&&html.includes('id="pdf-overlay"'), 'V2 PDF 应使用可选文字层和独立批注层');
    assert.ok(html.includes('/static/dist/reader.js'), '应加载本地阅读器');
    assert.ok(html.includes('/api/attachments/' + data.id + '/file'), '阅读器应指向附件流');

    const file = await fetch(app.base + '/api/attachments/' + data.id + '/file');
    assert.strictEqual(file.status, 200);
    assert.ok((file.headers.get('content-type') || '').includes('pdf'), 'Content-Type 应为 PDF');
    const body = await file.text();
    assert.ok(body.startsWith('%PDF'), '内容应为原始 PDF');
  });
});

test('Phase5 - 图片附件以 img 渲染，TIFF 降级为下载', async () => {
  await withApp(async (app) => {
    const item = await createItem(app);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/9p0AAAAASUVORK5CYII=',
      'base64'
    );
    const up = await uploadFile(app, item.id, '碑刻拓本.png', png, 'image/png');
    assert.strictEqual(up.res.status, 200, 'PNG 应上传成功：' + JSON.stringify(up.data));
    const html = await (await fetch(app.base + '/reader/' + up.data.id)).text();
    assert.ok(html.includes('class="reader-img"'), '图片应以 img 渲染');

    const up2 = await uploadFile(app, item.id, '档案扫描.tiff', Buffer.from('II*\u0000dummy'), 'image/tiff');
    assert.strictEqual(up2.res.status, 200, 'TIFF 应允许上传');
    const html2 = await (await fetch(app.base + '/reader/' + up2.data.id)).text();
    assert.ok(html2.includes('无法直接预览'), 'TIFF 应提示无法预览');
    assert.ok(html2.includes('下载'), 'TIFF 应提供下载链接');
  });
});

test('Phase5 - 验收13：非白名单文件被拒绝', async () => {
  await withApp(async (app) => {
    const item = await createItem(app);
    const { res, data } = await uploadFile(app, item.id, 'malware.exe', Buffer.from('MZ'), 'application/octet-stream');
    assert.strictEqual(res.status, 400, '.exe 应被拒绝');
    assert.ok(String(data.error).includes('仅支持'), '应提示支持的类型，实际：' + data.error);

    const list = await (await fetch(app.base + '/api/attachments?item_id=' + item.id)).json();
    assert.strictEqual(list.length, 0, '被拒文件不应入库');
  });
});

test('Phase5 - 超过大小上限的文件被拒绝', async () => {
  await withApp(async (app) => {
    const item = await createItem(app);
    // 临时把上限调到 1 KB，验证限制逻辑真的生效
    await fetch(app.base + '/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_attachment_mb: 0.0005 })
    });
    const big = Buffer.alloc(4096, 65);
    const { res, data } = await uploadFile(app, item.id, 'big.pdf', big, 'application/pdf');
    assert.strictEqual(res.status, 400, '超限文件应被拒绝');
    assert.ok(String(data.error).includes('超过'), '应提示超限，实际：' + data.error);
  });
});

test('Phase5 - 附件路径遍历被防护', async () => {
  await withApp(async (app) => {
    const db = require('../server/db');
    const item = await createItem(app);
    // 人为写入一条越界路径的记录
    db.dbRun('INSERT INTO attachments (item_id, filename, rel_path, size, mime, created_at) VALUES (?,?,?,?,?,?)',
      [item.id, 'evil.txt', '../../evil.txt', 10, 'text/plain', db.now()]);
    const a = db.dbGet('SELECT * FROM attachments ORDER BY id DESC LIMIT 1');
    const res = await fetch(app.base + '/api/attachments/' + a.id + '/file');
    assert.strictEqual(res.status, 400, '越界路径应被拒绝');
    const e = await res.json();
    assert.ok(e.error.includes('非法'));
  });
});

test('Phase5 - 删除条目时附件移入回收目录', async () => {
  await withApp(async (app) => {
    const paths = require('../server/lib/paths');
    const item = await createItem(app);
    const up = await uploadFile(app, item.id, 'a.pdf', MINI_PDF, 'application/pdf');
    const before = path.join(paths.getDataDir(), up.data.rel_path);
    assert.ok(fs.existsSync(before), '上传后文件应存在');

    const del = await (await fetch(app.base + '/api/items/' + item.id, { method: 'DELETE' })).json();
    assert.strictEqual(del.ok, true);
    assert.strictEqual(del.trashedAttachments, 1, '应有一个附件进入回收');
    assert.ok(!fs.existsSync(before), '原位置文件应被移走');

    const trashed = fs.readdirSync(paths.trashDir());
    assert.ok(trashed.some((n) => n.endsWith('a.pdf')), '回收目录应包含该附件，实际：' + trashed.join(','));
  });
});

test('Phase5 - 详情页显示录文与附件数量', async () => {
  await withApp(async (app) => {
    const item = await createItem(app);
    await fetch(app.base + '/api/excerpts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, locator: '卷一', text: '凡充役者给以雇钱' })
    });
    const html = await (await fetch(app.base + '/sources/classics/' + item.id)).text();
    assert.ok(html.includes('录文 1'), 'Tab 应显示录文数量');
    assert.ok(html.includes('凡充役者给以雇钱'), '应显示录文正文');
    assert.ok(html.includes('卷一'), '应显示出处定位');
  });
});

test('Phase5 - 前端脚本语法正确', async () => {
  const vm = require('node:vm');
  const dir = path.join(__dirname, '..', 'public', 'js');
  let count = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    const code = fs.readFileSync(path.join(dir, f), 'utf8');
    new vm.Script(code, { filename: f }); // 语法错误会抛出
    count += 1;
  }
  assert.ok(count >= 3, '应检查到多个前端脚本，实际：' + count);
});
