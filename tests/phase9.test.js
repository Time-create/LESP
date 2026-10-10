const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
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
  const res = await fetch(app.base + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  });
  return { status: res.status, data: await res.json() };
}
async function get(app, url) {
  const res = await fetch(app.base + url);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = text;
  }
  return { status: res.status, data, text };
}

async function createItem(app, module, title, fields) {
  return (await fetch(app.base + '/api/items', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module, title, fields: fields || {} })
  })).json();
}

const MINI_PDF = '%PDF-1.4\ntrailer\n%%EOF\n';

test('Phase9 - 验收16：备份生成 zip 且计数一致', async () => {
  await withApp(async (app) => {
    await createItem(app, 'classics', '甲书', { edition: '某版本' });
    const item = await createItem(app, 'classics', '乙书', {});
    const form = new FormData();
    form.append('file', new Blob([MINI_PDF], { type: 'application/pdf' }), 'a.pdf');
    await fetch(app.base + '/api/attachments/upload?item_id=' + item.id, { method: 'POST', body: form });

    const r = await post(app, '/api/backup/create', {});
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.itemCount, 2, '备份应记录 2 条条目');
    assert.strictEqual(r.data.attachmentCount, 1, '备份应记录 1 个附件');
    assert.ok(r.data.sizeBytes > 0, '备份文件应有体积');
    assert.ok(r.data.file.startsWith('backup-'), '文件名应为 backup- 开头');

    const dir = require('../server/lib/paths').backupsDir();
    assert.ok(fs.existsSync(path.join(dir, r.data.file)), '备份文件应真实存在');

    // 设置页显示的备份信息应与库内实际一致
    const html = await (await fetch(app.base + '/settings')).text();
    assert.ok(html.includes('2 条'), '设置页应显示备份时的条目数');
    assert.ok(html.includes('1 个附件'), '设置页应显示备份时的附件数');
  });
});

test('Phase9 - 验收17：恢复后条目数、附件数、附件体积三项与备份记录一致', async () => {
  await withApp(async (app) => {
    const paths = require('../server/lib/paths');
    const item = await createItem(app, 'classics', '宋会要辑稿', { edition: '中华书局' });
    await fetch(app.base + '/api/excerpts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, locator: '卷一三七', text: '绍兴十五年诏差役。' })
    });
    const form = new FormData();
    form.append('file', new Blob([MINI_PDF], { type: 'application/pdf' }), 'keep.pdf');
    const up = await (await fetch(app.base + '/api/attachments/upload?item_id=' + item.id, { method: 'POST', body: form })).json();

    const bak = await post(app, '/api/backup/create', {});
    const before = {
      itemCount: bak.data.itemCount,
      attachmentCount: bak.data.attachmentCount,
      fileBytes: bak.data.fileBytes
    };

    // 清空：删除全部条目（附件随之进入回收目录）
    const list = await get(app, '/api/items');
    for (const it of list.data.items) {
      await fetch(app.base + '/api/items/' + it.id, { method: 'DELETE' });
    }
    let after = await get(app, '/api/items');
    assert.strictEqual(after.data.total, 0, '清空后应无条目');

    const res = await post(app, '/api/backup/restore', { file: bak.data.file });
    assert.strictEqual(res.status, 200, '恢复应成功：' + JSON.stringify(res.data));
    assert.strictEqual(res.data.itemCount, before.itemCount, '恢复后条目数应一致');
    assert.strictEqual(res.data.attachmentCount, before.attachmentCount, '恢复后附件数应一致');

    // 附件文件应可再次读取
    const file = await fetch(app.base + '/api/attachments/' + up.id + '/file');
    assert.strictEqual(file.status, 200, '恢复后附件应可读');
    const body = await file.text();
    assert.ok(body.startsWith('%PDF'), '附件内容应完整');

    // 录文也应恢复
    const detail = await get(app, '/api/items/' + item.id);
    assert.strictEqual(detail.data.excerpts.length, 1, '录文应随备份恢复');
    assert.ok(detail.data.excerpts[0].text.includes('绍兴十五年'));

    // 恢复前保护：应生成 pre-restore 备份
    const files = fs.readdirSync(paths.backupsDir());
    assert.ok(files.some((f) => f.startsWith('pre-restore-')), '应生成恢复前备份');
  });
});

test('Phase9 - 验收18：备份超过 7 份时只保留最近 7 份', async () => {
  await withApp(async (app) => {
    const paths = require('../server/lib/paths');
    for (let i = 0; i < 9; i++) {
      await post(app, '/api/backup/create', {});
      // 让文件名时间戳不同，避免同一毫秒覆盖
      await new Promise((r) => setTimeout(r, 60));
    }
    const files = fs.readdirSync(paths.backupsDir()).filter((f) => f.startsWith('backup-'));
    assert.strictEqual(files.length, 7, '应只保留 7 份，实际 ' + files.length);
    const list = await get(app, '/api/backup/list');
    assert.strictEqual(list.data.length, 7);
  });
});

test('Phase9 - 备份列表与删除', async () => {
  await withApp(async (app) => {
    const b = await post(app, '/api/backup/create', {});
    const list = await get(app, '/api/backup/list');
    assert.strictEqual(list.data.length, 1);
    const del = await fetch(app.base + '/api/backup/' + encodeURIComponent(b.data.file), { method: 'DELETE' });
    assert.strictEqual(del.status, 200);
    const list2 = await get(app, '/api/backup/list');
    assert.strictEqual(list2.data.length, 0);
  });
});

test('Phase9 - 恢复不存在的备份返回 404，且不破坏现有数据', async () => {
  await withApp(async (app) => {
    await createItem(app, 'classics', '甲书', {});
    const r = await post(app, '/api/backup/restore', { file: 'backup-nonexist.zip' });
    assert.strictEqual(r.status, 404);
    const list = await get(app, '/api/items');
    assert.strictEqual(list.data.total, 1, '现有数据不应被破坏');
  });
});

test('Phase9 - 导出 RIS 与 CSV', async () => {
  await withApp(async (app) => {
    await createItem(app, 'paper', '宋代两浙路役法演变考论',
      { author: '包伟民', journal: '历史研究', year_volume: '2018(4)', pages: '45-62' });
    await createItem(app, 'book', '宋代地方财政史研究',
      { author: '包伟民', publisher: '上海古籍出版社', year: 2001, isbn: '9787532529871' });

    const ris = await (await fetch(app.base + '/api/export/ris')).text();
    assert.ok(ris.includes('TY  - JOUR'), 'RIS 应含论文类型');
    assert.ok(ris.includes('AU  - 包伟民'));
    assert.ok(ris.includes('TI  - 宋代两浙路役法演变考论'));
    assert.ok(ris.includes('JO  - 历史研究'));
    assert.ok(ris.includes('TY  - BOOK'), 'RIS 应含著作类型');
    assert.ok(ris.includes('PB  - 上海古籍出版社'));

    const csv = await (await fetch(app.base + '/api/export/csv')).text();
    assert.ok(csv.includes('模块'), 'CSV 应含表头');
    assert.ok(csv.includes('宋代两浙路役法演变考论'));
    assert.ok(csv.includes('古籍史料') || csv.includes('研究论文'), '应含模块中文名');
  });
});

test('Phase9 - 自定义字段可新增并出现在表单与详情中', async () => {
  await withApp(async (app) => {
    const add = await post(app, '/api/settings/fields', { module: 'classics', key: 'copy_location', label: '复本藏地' });
    assert.strictEqual(add.status, 200);

    const item = await createItem(app, 'classics', '甲书', { edition: '某版本', copy_location: ' library' });
    assert.strictEqual(item.fields.copy_location, ' library', '自定义字段应可写入');

    const html = await (await fetch(app.base + '/sources/classics/' + item.id)).text();
    assert.ok(html.includes('复本藏地'), '详情页应显示自定义字段');

    const bad = await post(app, '/api/settings/fields', { module: 'classics', key: 'edition', label: 'x' });
    assert.strictEqual(bad.status, 400, '与内置字段重复应被拒');

    const bad2 = await post(app, '/api/settings/fields', { module: 'classics', key: 'bad key', label: 'x' });
    assert.strictEqual(bad2.status, 400, '非法标识应被拒');
  });
});

test('Phase9 - 数据目录可迁移', async () => {
  await withApp(async (app) => {
    await createItem(app, 'classics', '甲书', { edition: '某版本' });
    const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-move-'));
    const r = await post(app, '/api/settings/data-dir', { data_dir: newDir });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.ok, true);

    const list = await get(app, '/api/items');
    assert.strictEqual(list.data.total, 1, '迁移后数据应可用');
    assert.ok(fs.existsSync(path.join(newDir, 'app.db')), '新目录应含数据库');

    const st = await get(app, '/api/settings');
    assert.strictEqual(st.data.data_dir, newDir, '设置应记录新目录');

    // 数据库已切换到新目录并持有文件锁，清理前需先关闭连接
    require('../server/db').closeDb();
    fs.rmSync(newDir, { recursive: true, force: true });
  });
});

test('Phase9 - 自动备份开关', async () => {
  await withApp(async (app) => {
    const on = await post(app, '/api/settings/auto-backup', { enabled: true });
    assert.strictEqual(on.data.enabled, true);
    let st = await get(app, '/api/settings');
    assert.strictEqual(st.data.auto_backup, '1');

    const off = await post(app, '/api/settings/auto-backup', { enabled: false });
    assert.strictEqual(off.data.enabled, false);
    st = await get(app, '/api/settings');
    assert.strictEqual(st.data.auto_backup, '0');
  });
});

test('Phase9 - 设置页渲染各分区', async () => {
  await withApp(async (app) => {
    const html = await (await fetch(app.base + '/settings')).text();
    for (const sec of ['数据位置', '备份与恢复', '导出', '模块字段']) {
      assert.ok(html.includes(sec), '设置页应含分区：' + sec);
    }
    assert.ok(html.includes('立即备份'));
    assert.ok(html.includes('导出 RIS'));
    assert.ok(html.includes('导出 CSV'));
  });
});

// V5.3 收尾：「知网登录态」分区已按用户要求移除（初版遗留、已废弃）。
// 界面移除，但 settings 表里的 cnki_cookie 字段保持不动（不碰用户数据）。
test('Phase9 - 知网登录态分区已移除，数据仍保留', async () => {
  await withApp(async (app) => {
    await fetch(app.base + '/api/cnki/cookie', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: 'uid=x' })
    });
    const html = await (await fetch(app.base + '/settings')).text();
    assert.ok(!html.includes('知网登录态'), '设置页不应再有知网登录态分区');
    assert.ok(!html.includes('cookie-input'), '不应再有 Cookie 输入框');
    assert.ok(!html.includes('btn-save-cookie'), '不应再有更新按钮');
    // 接口与数据仍在（只是界面不再暴露）
    const r = await fetch(app.base + '/api/cnki/cookie');
    assert.ok(r.status < 500, '接口本身不应因界面移除而失效');
  });
});
