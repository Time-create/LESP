// 扩展 ⇄ App 同步链路测试：口令校验、落库、全文文件保存、格式校验
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-sync-'));
const paths = require('../server/lib/paths');
paths.setDataDir(tmp);

const syncService = require('../server/services/cnki-sync');

// 真实契约样本（docs/cnki-contract.json），供知网模式测试使用
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'cnki-contract.json'), 'utf8'));

function fakeDb() {
  const items = [];
  const raws = [];
  const jobs = [];
  const atts = [];
  return {
    items, raws, jobs, atts,
    now: () => new Date().toISOString(),
    dbGet(sql, params = []) {
      if (sql.includes('FROM cnki_raw')) return raws.find((r) => r.dedup_key === params[0]) || null;
      if (sql.includes('FROM items')) return items.find((r) => r.dedup_key === params[params.length - 1]) || null;
      return null;
    },
    dbAll: () => [],
    dbRun(sql, params = []) {
      if (sql.startsWith('INSERT OR IGNORE INTO cnki_raw')) { raws.push({ dedup_key: params[0] }); return { lastInsertRowid: raws.length }; }
      if (sql.startsWith('INSERT INTO items')) {
        const f = JSON.parse(params[4]);
        items.push({ id: items.length + 1, dedup_key: f.dedup_key, fields: f, title: params[1], subtitle: params[2] });
        return { lastInsertRowid: items.length };
      }
      if (sql.startsWith('INSERT INTO attachments')) {
        atts.push({ item_id: params[0], filename: params[1], rel_path: params[2], size: params[3], mime: params[4] });
        return { lastInsertRowid: atts.length };
      }
      if (sql.startsWith('INSERT INTO cnki_jobs')) { jobs.push({ status: params[4], dedup_key: params[1] }); return { lastInsertRowid: jobs.length }; }
      if (sql.startsWith('DELETE FROM cnki_raw')) {
        const i = raws.findIndex((r) => r.dedup_key === params[0]);
        if (i >= 0) raws.splice(i, 1);
        return { lastInsertRowid: 0 };
      }
      if (sql.startsWith('DELETE FROM cnki_jobs')) {
        for (let i = jobs.length - 1; i >= 0; i -= 1) if (jobs[i].dedup_key === params[0]) jobs.splice(i, 1);
        return { lastInsertRowid: 0 };
      }
      if (sql.startsWith('DELETE FROM items WHERE id')) {
        const i = items.findIndex((x) => x.id === params[0]);
        if (i >= 0) items.splice(i, 1);
        return { lastInsertRowid: 0 };
      }
      return { lastInsertRowid: 0 };
    },
    syncFts: () => {}
  };
}

const item = (over) => Object.assign({
  title: '测试论文标题',
  author: '张三; 李四',
  journal: '某学报',
  year: '2026',
  abstract: '这是摘要内容。',
  link: 'https://link.cnki.net/urlid/11.2222.C.20260101.1010.002',
  pageUrl: 'https://kns.cnki.net/kcms2/article/abstract?v=abc'
}, over || {});

const pdfBuf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]);

test('口令不对时拒绝同步', () => {
  const db = fakeDb();
  const r = syncService.sync({ db, payload: { token: 'wrong', items: [item()] }, tokenExpected: 'abc123' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('口令'));
  assert.strictEqual(db.items.length, 0);
});

test('口令正确时写入论文条目（研究论文界面可见）', () => {
  const db = fakeDb();
  const r = syncService.sync({ db, payload: { token: 'abc123', items: [item()] }, tokenExpected: 'abc123' });
  assert.strictEqual(r.created, 1);
  assert.strictEqual(db.items[0].fields.title, undefined); // 标题存在 items 记录里
  assert.ok(db.items.some((i) => i.dedup_key === 'cnki:11.2222.C.20260101.1010.002'));
});

test('重复同步必须跳过，不产生第二条', () => {
  const db = fakeDb();
  syncService.sync({ db, payload: { token: 't', items: [item()] }, tokenExpected: 't' });
  const second = syncService.sync({ db, payload: { token: 't', items: [item()] }, tokenExpected: 't' });
  assert.strictEqual(second.created, 0);
  assert.strictEqual(second.skipped, 1);
  assert.strictEqual(db.items.length, 1);
});

test('全文 PDF 会被保存为附件，并记下真实落盘位置', () => {
  const db = fakeDb();
  const r = syncService.sync({
    db,
    payload: { token: 't', items: [item({ file: { name: 'a.pdf', base64: pdfBuf.toString('base64') } })] },
    tokenExpected: 't'
  });
  assert.strictEqual(r.created, 1);
  assert.strictEqual(r.items[0].fulltextStatus, 'downloaded');
  assert.strictEqual(db.atts.length, 1);
  // rel_path 基准已统一为「相对 dataDir」，用统一解析器还原
  const abs = require('../server/services/attachment-store').resolveAttachment(db.atts[0].rel_path);
  assert.ok(fs.existsSync(abs), '附件文件应真实存在于磁盘：' + abs);
  assert.ok(abs.startsWith(paths.attachmentsDir()), '应落在统一附件目录');
  assert.strictEqual(fs.statSync(abs).size, pdfBuf.length);
  console.log('    全文实际落盘位置:', abs);
});

test('下载到登录页/错误页时：丢弃文件、保留元数据、给出明确原因', () => {
  const db = fakeDb();
  const html = Buffer.from('<html><body>请登录 login</body></html>');
  const r = syncService.sync({
    db,
    payload: { token: 't', items: [item({ file: { name: 'x.pdf', base64: html.toString('base64') } })] },
    tokenExpected: 't'
  });
  assert.strictEqual(r.created, 1);              // 元数据仍入库
  assert.strictEqual(r.items[0].fulltextStatus, 'failed');
  assert.strictEqual(db.atts.length, 0);         // 但不存附件
  assert.ok(r.warnings.some((w) => w.includes('不是 PDF')));
});

test('没有下载到全文时也要入库（仅元数据）', () => {
  const db = fakeDb();
  const r = syncService.sync({ db, payload: { token: 't', items: [item({ fulltextStatus: 'need_document_delivery' })] }, tokenExpected: 't' });
  assert.strictEqual(r.items[0].fulltextStatus, 'need_document_delivery');
  // “需文献传递”不等于失败，必须单独标记，避免误判为下载故障
  assert.strictEqual(db.jobs[0].status, 'need_document_delivery');
});

test('日志可回读，便于排查', () => {
  syncService.log('单元测试写入的一行日志');
  const lines = syncService.readLog(20);
  assert.ok(lines.some((l) => l.includes('单元测试写入的一行日志')));
});

test.after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
});

// ---------- 知网模式：条目直接携带 exportApi（扩展自动采集） ----------

test('知网模式：携带 exportApi 的条目会经解析器出全字段后入库', () => {
  const db = fakeDb();
  const r = syncService.sync({
    db,
    payload: { token: 't', items: [{ exportApi: sample.exportApi, pageUrl: sample.pageUrl, detail: sample.detail, fulltext: sample.fulltext }] },
    tokenExpected: 't'
  });
  assert.strictEqual(r.created, 1);
  assert.ok(db.items[0].title.includes('新大众文艺'));
  const f = db.items[0].fields;
  assert.strictEqual(f.author, '杨钊阳; 熊辉');
  assert.strictEqual(f.journal, '学术探索');
  assert.strictEqual(f.year, '2026');
  assert.strictEqual(f.issn, '1006-723X');
  assert.strictEqual(f.affiliation, '暨南大学马克思主义学院');
  assert.strictEqual(f.fulltext_status, 'need_document_delivery');  // 文献传递，无附件
  assert.strictEqual(db.atts.length, 0);
});

test('知网模式：导出接口失败（如未登录）时不入库、给出明确原因', () => {
  const db = fakeDb();
  const r = syncService.sync({
    db,
    payload: { token: 't', items: [{ exportApi: { code: -403, message: 'https://kns.cnki.net/verify/home?captchaType=clickWord' } }] },
    tokenExpected: 't'
  });
  assert.strictEqual(r.created, 0);
  assert.strictEqual(r.risk, true);
  assert.ok(r.message.includes('风控'));
  assert.strictEqual(db.items.length, 0);
});

test('摘要垃圾清洗：登录页文字不能当摘要入库', () => {
  const db = fakeDb();
  const r = syncService.sync({
    db,
    payload: { token: 't', items: [item({ abstract: '手机号认证 为保障您的账号安全，请尽快完成认证。' })] },
    tokenExpected: 't'
  });
  const f = db.items[0].fields;
  assert.strictEqual(f.abstract, '');
  assert.ok(r.warnings.some((w) => w.includes('登录')));
});

// ---------- 删除后可重新抓取（回归：2026-10-02 用户报告的缺陷） ----------

test('删除条目后清除同步痕迹，同一来源可完整重新入库', () => {
  const db = fakeDb();
  // 第一次同步成功
  syncService.sync({ db, payload: { token: 't', items: [item()] }, tokenExpected: 't' });
  assert.strictEqual(db.items.length, 1);
  assert.strictEqual(db.raws.length, 1);

  // 模拟删除条目（items.js 删除路由会调用 purgeSyncTraces）
  const itemRow = { fields: JSON.stringify({ dedup_key: db.items[0].dedup_key }) };
  syncService.purgeSyncTraces(db, itemRow);
  db.items.length = 0;

  // 重新同步：必须能再次入库，而不是“已存在，跳过”
  const again = syncService.sync({ db, payload: { token: 't', items: [item()] }, tokenExpected: 't' });
  assert.strictEqual(again.created, 1, '删除后重新同步应当重新入库');
  assert.strictEqual(again.skipped, 0);
  assert.strictEqual(db.raws.filter((r) => r.dedup_key).length, 1);
});

test('没有 dedup_key 的条目删除时不做任何清理也不报错', () => {
  const db = fakeDb();
  assert.strictEqual(syncService.purgeSyncTraces(db, { fields: '{}' }), false);
});

// ---------- 自愈：孤儿留档不阻塞重新导入 ----------

test('自愈：留档在而条目已删（历史孤儿）时，自动清理并重新入库', () => {
  const db = fakeDb();
  syncService.sync({ db, payload: { token: 't', items: [item()] }, tokenExpected: 't' });
  // 模拟“修复前”的删除：只删 items，留下 cnki_raw / cnki_jobs（孤儿）
  db.items.length = 0;
  assert.strictEqual(db.raws.length, 1);      // 孤儿留档仍在
  // 重新同步：应自愈并入库，而不是跳过
  const r = syncService.sync({ db, payload: { token: 't', items: [item()] }, tokenExpected: 't' });
  assert.strictEqual(r.created, 1, '孤儿留档不应阻塞重新导入');
  assert.strictEqual(r.skipped, 0);
  assert.ok(r.warnings.some((w) => w.includes('自动清理')));
});

// ---------- 全自动：扩展触发浏览器下载后，由 App 从交接目录导入 ----------

// 让假库能返回“交接目录”设置，便于在临时目录里测试导入路径
function withPickupRoot(database, root) {
  const origin = database.dbGet;
  database.dbGet = (sql, params) => (
    /FROM settings/i.test(sql) && params && params[0] === 'cnki_pickup_dir'
      ? { value: root }
      : origin(sql, params)
  );
  return database;
}

test('全自动：给出 downloadedPath 时，App 校验后导入并挂为附件', () => {
  const handoff = path.join(tmp, 'handoff-cnki');
  fs.mkdirSync(handoff, { recursive: true });
  const src = path.join(handoff, 'lesp-1.pdf');
  fs.writeFileSync(src, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4096, 0x20)]));

  const db = withPickupRoot(fakeDb(), handoff);
  const r = syncService.sync({
    db,
    payload: { token: 't', items: [item({ downloadedPath: src })] },
    tokenExpected: 't'
  });
  assert.strictEqual(r.created, 1);
  assert.strictEqual(r.items[0].fulltextStatus, 'downloaded');
  assert.strictEqual(db.atts.length, 1, '应挂上附件');
  const abs = require('../server/services/attachment-store').resolveAttachment(db.atts[0].rel_path);
  assert.ok(fs.existsSync(abs), '附件文件应真实落盘');
});

test('全自动：给出的文件不在交接目录内 → 拒绝导入，但条目仍入库并给警告', () => {
  const outside = path.join(tmp, 'outside-cnki');
  fs.mkdirSync(outside, { recursive: true });
  const src = path.join(outside, 'x.pdf');
  fs.writeFileSync(src, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4096, 0x20)]));
  const db = fakeDb();
  const r = syncService.sync({ db, payload: { token: 't', items: [item({ downloadedPath: src })] }, tokenExpected: 't' });
  assert.strictEqual(r.created, 1, '元数据仍应入库');
  assert.strictEqual(db.atts.length, 0, '越界文件不应入库');
  assert.ok(r.warnings.some((w) => w.includes('交接目录')));
});
