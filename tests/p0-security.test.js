// P0（越权链 / 去重键 / 删除一致性 / 快照配对 / 回收站回滚）+ P1-1（大文件内存）行为测试
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-p0-'));
const paths = require('../server/lib/paths');
paths.setDataDir(tmp);
const db = require('../server/db');
db.initDb(tmp);
const { createApp } = require('../server/app');
const syncService = require('../server/services/cnki-sync');
const store = require('../server/services/attachment-store');
const parser = require('../server/services/cnki-export');

function fakeDb() {
  const atts = [];
  return {
    atts,
    now: () => new Date().toISOString(),
    dbGet: () => null, dbAll: () => [],
    dbRun(sql, params = []) {
      if (sql.startsWith('INSERT INTO attachments')) { atts.push({ item_id: params[0], rel_path: params[2] }); return { lastInsertRowid: atts.length }; }
      return { lastInsertRowid: 0 };
    },
    syncFts: () => {}
  };
}

// ---------- P0-1a：CORS 只对扩展来源放开 ----------
test('P0-1 CORS：普通网页来源拿不到 CORS 头，扩展来源回显具体 Origin', async () => {
  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const evil = await fetch(base + '/api/cnki/sync/info', { headers: { Origin: 'https://evil.example' } });
    assert.strictEqual(evil.headers.get('access-control-allow-origin'), null, '普通网页不应获得 CORS 许可');

    const extId = 'a'.repeat(32);
    const ext = await fetch(base + '/api/cnki/sync/info', { headers: { Origin: 'chrome-extension://' + extId } });
    assert.strictEqual(ext.headers.get('access-control-allow-origin'), 'chrome-extension://' + extId, '扩展来源应回显具体 Origin');
    assert.ok(!/^\*$/.test(String(ext.headers.get('access-control-allow-origin'))), '不得使用通配 *');
  } finally { srv.close(); }
});

// ---------- P0-1b：口令 fail-closed ----------
test('P0-1 口令：未配置口令时拒绝同步（不再短路放行）', () => {
  const r = syncService.sync({ db: fakeDb(), payload: { items: [] }, tokenExpected: '' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /口令/);
});
test('P0-1 口令：口令正确仍可同步（未破坏原行为）', () => {
  const r = syncService.sync({
    db: fakeDb(),
    payload: { token: 'abc123', items: [{ title: '某论文', link: 'https://link.cnki.net/urlid/11.2222.C.20260101.1010.002' }] },
    tokenExpected: 'abc123'
  });
  assert.strictEqual(r.ok, true, '口令正确时应正常同步，实际错误：' + r.error);
  assert.strictEqual(r.created, 1);
});

// ---------- P0-1c：settings 不再泄露/改写敏感键 ----------
test('P0-1 设置接口：GET 隐去知网 Cookie 与同步口令，PUT 拒绝写入', async () => {
  db.dbRun("INSERT INTO settings (key, value) VALUES ('cnki_cookie','SECRET-COOKIE')");
  db.dbRun("INSERT INTO settings (key, value) VALUES ('cnki_sync_token','SECRET-TOKEN')");
  db.dbRun("INSERT INTO settings (key, value) VALUES ('auto_backup','1')");
  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const got = await (await fetch(base + '/api/settings')).json();
    assert.strictEqual(got.cnki_cookie, undefined, 'Cookie 不应被回显');
    assert.strictEqual(got.cnki_sync_token, undefined, '同步口令不应被回显');
    assert.strictEqual(got.auto_backup, '1', '普通设置项应正常返回');

    await fetch(base + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cnki_cookie: 'HACKED' }) });
    const after = db.dbGet("SELECT value FROM settings WHERE key='cnki_cookie'");
    assert.strictEqual(after.value, 'SECRET-COOKIE', '通用接口不得改写 Cookie');
  } finally { srv.close(); }
});

// ---------- P0-2：去重键统一 ----------
test('P0-2 去重键：sync 与 export 使用同一实现（cnki: 前缀一致）', () => {
  const viaSync = syncService.__test_dedupKeyOf
    ? syncService.__test_dedupKeyOf({ link: 'https://link.cnki.net/urlid/11.2222.C.20260101.1010.002', title: 'T', author: 'A', year: '2026' })
    : parser.dedupKey({ link: 'https://link.cnki.net/urlid/11.2222.C.20260101.1010.002', title: 'T', authors: ['A'], year: '2026' });
  assert.strictEqual(viaSync, 'cnki:11.2222.C.20260101.1010.002');
  // 无链接时回退到 t: 题名|作者|年（与历史格式一致，保证既有键仍可匹配）
  assert.strictEqual(parser.dedupKey({ link: '', title: '宋代人吏与吏役社会', authors: ['董宇林'], year: '2026' }),
    't:宋代人吏与吏役社会|董宇林|2026');
});
test('P0-2 去重键：sync 内部实现已委托给权威实现（不再自带一套）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'cnki-sync.js'), 'utf8');
  const body = src.slice(src.indexOf('function dedupKeyOf'), src.indexOf('function dedupKeyOf') + 420);
  assert.ok(body.includes('parser.dedupKey'), 'dedupKeyOf 未委托 cnki-export.dedupKey');
  assert.ok(!/return\s+'cnki:'\s*\+/.test(body), 'dedupKeyOf 不应再自行拼接 cnki: 前缀');
});
test('P0-2 检索导入写入的条目带 dedup_key，可被同步路径识别', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'cnki.js'), 'utf8');
  assert.ok(/dedup_key:\s*key/.test(src), '/import 未写入 dedup_key');
  assert.ok(/f\.dedup_key\)\s*\{\s*set\.add/.test(src), 'existingKeys 未优先采用已存的 dedup_key');
});

// ---------- P0-3 / P0-5：删除与还原的一致性 ----------
test('P0-3 附件删除：走统一解析器（旧基准记录也能删）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'attachments.js'), 'utf8');
  const del = src.slice(src.indexOf("router.delete('/:id'"));
  assert.ok(del.includes('store.resolveAttachment(a.rel_path)'), '删除未走统一解析器');
  assert.ok(del.includes('copyFileSync'), 'rename 失败缺少复制回退');
  assert.ok(!/catch\s*\(e\)\s*\{\s*\/\*\s*忽略\s*\*\/\s*\}/.test(del), '仍存在静默吞错的 catch');
});
test('P0-5 回收站还原：写库失败时回滚已复制文件', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'trash.js'), 'utf8');
  const fn = src.slice(src.indexOf("router.post('/restore'"));
  assert.ok(/if\s*\(stored\s*&&\s*stored\.abs\)\s*\{[^}]*unlinkSync/.test(fn), '缺少回滚逻辑');
  assert.ok(fn.indexOf('INSERT INTO attachments') < fn.indexOf('unlinkSync(src)'), '应先写库再删源');
});
test('P0-5 条目删除：复制回退时必须删除源文件（否则成备份外的孤儿）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'items.js'), 'utf8');
  const seg = src.slice(src.indexOf("path.join(paths.trashDir()"), src.indexOf("path.join(paths.trashDir()") + 520);
  assert.ok(/copyFileSync\([\s\S]{0,80}unlinkSync/.test(seg), '复制回退后未删除源文件');
});

// ---------- P0-4：快照清理覆盖全部退出路径 ----------
test('P0-4 阅读器：快照在所有退出路径都被清理', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'reader', 'index.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function render()'), src.indexOf('async function turn('));
  const starts = (fn.match(/snapshotCanvas\(\);/g) || []).length;
  const clears = (fn.match(/clearSnapshot\(\);/g) || []).length;
  assert.strictEqual(starts, 1, '快照埋点应只有一处');
  assert.ok(clears >= 3, '清理点需覆盖：成功路径 + generation 提前 return + 渲染被取消的 catch（实际 ' + clears + ' 处）');
  assert.ok(/catch\(e\)\{clearSnapshot\(\);/.test(fn), '渲染被取消的 catch 未清理快照');
});

// ---------- P1-1：大文件不再整份进内存 ----------
test('P1-1 attachment-store 提供 readHead 与分块 sha256FileSync', () => {
  const big = path.join(tmp, 'big.bin');
  const chunk = Buffer.alloc(1024 * 1024, 0x41);
  const fd = fs.openSync(big, 'w');
  for (let i = 0; i < 8; i += 1) fs.writeSync(fd, chunk);   // 8MB
  fs.closeSync(fd);

  const head = store.readHead(big, 16);
  assert.strictEqual(head.length, 16, 'readHead 应只返回指定字节数');
  assert.strictEqual(typeof store.sha256FileSync, 'function', 'sha256FileSync 必须存在');
  const sha = store.sha256FileSync(big);
  const expect = require('node:crypto').createHash('sha256').update(fs.readFileSync(big)).digest('hex');
  assert.strictEqual(sha, expect, '分块哈希结果应与整份计算一致');
});
test('P1-1 交接导入：嗅探只读文件头，不再 readFileSync 整份', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'attachment-pickup.js'), 'utf8');
  const stage = src.slice(src.indexOf('function stage('), src.indexOf('function pickup('));
  assert.ok(stage.includes('store.readHead(abs, 16)'), 'stage 未使用 readHead');
  assert.ok(!stage.includes('fs.readFileSync(abs)'), 'stage 仍在整份读取');
});
test('P1-1 三处哈希均已改为分块实现', () => {
  const files = ['server/services/attachment-pickup.js', 'server/routes/attachments.js', 'server/services/cnki-sync.js'];
  for (const f of files) {
    const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/createHash\('sha256'\)\.update\(fs\.readFileSync/.test(s), f + ' 仍在整份读入计算哈希');
  }
});

test.after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
});
// 诊断脚本自身不能报错：否则它一加载就抛错，反而遮蔽真实问题
test('诊断脚本：语法正确且行数据格式合法', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'diag.js'), 'utf8');

  // 1) 捕获 window.onerror 挂载
  assert.ok(src.includes("window.addEventListener('error'"), '应监听脚本错误');
  assert.ok(src.includes("window.addEventListener('unhandledrejection'"), '应监听未处理的异步错误');

  // 2) 诊断面板的每一行都必须是 ['标签', 值] 两元素数组
  const rowsBlock = src.slice(src.indexOf('const rows = ['), src.indexOf('];', src.indexOf('const rows = [')));
  const entries = [...rowsBlock.matchAll(/\['([^']+)',\s*([^\]]+?)\]/g)];
  assert.ok(entries.length >= 5, '诊断项应至少有 5 条，实际 ' + entries.length);
  for (const [, label] of entries) assert.ok(label.length > 0, '诊断项标签不能为空');

  // 3) 关键诊断项存在（缺一就无法定位问题）
  for (const key of ['布局 display', '侧栏位置', '主区位置', '样式表', '脚本数']) {
    assert.ok(rowsBlock.includes(key), '缺少诊断项：' + key);
  }

  // 4) 捕获上次真实踩过的坑：数组元素漏逗号会导致 rows 被当成下标访问
  const afterRows = rowsBlock.slice(rowsBlock.indexOf('const rows = ['));
  const line = (afterRows.match(/\['[^']+',[^\]]*\]\s*\n\s*\['/) || []);
  assert.strictEqual(line.length, 0, 'rows 数组元素之间缺少逗号（会导致 reading "0" 报错）');
});
