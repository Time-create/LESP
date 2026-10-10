// 交接目录导入：正常导入、越界拒绝、假文件（下单页 HTML）拒绝
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-pickup-'));
const paths = require('../server/lib/paths');
paths.setDataDir(tmp);
const db = require('../server/db');
db.initDb(tmp);

const pickup = require('../server/services/attachment-pickup');
const store = require('../server/services/attachment-store');

function fakeDb() {
  const atts = [];
  return {
    atts,
    now: () => new Date().toISOString(),
    dbGet: () => null,
    dbAll: () => [],
    dbRun(sql, params = []) {
      if (sql.startsWith('INSERT INTO attachments')) { atts.push({ item_id: params[0], rel_path: params[2] }); return { lastInsertRowid: atts.length }; }
      return { lastInsertRowid: 0 };
    },
    syncFts: () => {}
  };
}

// 交接目录（测试里显式指定，避免依赖真实用户目录）
const handoff = path.join(tmp, 'handoff');
fs.mkdirSync(handoff, { recursive: true });

test('正常导入：交接目录里的 PDF 会被复制进私有附件目录', () => {
  const src = path.join(handoff, 'lesp-1.pdf');
  fs.writeFileSync(src, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4096, 0x20)]));
  const fdb = fakeDb();
  const r = pickup.pickup({ db: fdb, sourcePath: src, itemId: 1, filename: '某论文.pdf', root: handoff });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(fdb.atts.length, 1);
  const abs = path.resolve(paths.getDataDir(), fdb.atts[0].rel_path);
  assert.ok(abs.startsWith(paths.attachmentsDir()), '应落在统一附件目录');
  assert.ok(fs.existsSync(abs));
  assert.ok(fs.existsSync(src), '交接目录里的原件保留，不删除');
});

test('安全边界：交接目录之外的文件一律拒绝', () => {
  const outside = path.join(tmp, 'elsewhere', 'x.pdf');
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]));
  const fdb = fakeDb();
  assert.throws(() => pickup.pickup({ db: fdb, sourcePath: outside, itemId: 1, root: handoff }),
    /不在允许的交接目录/);
  assert.strictEqual(fdb.atts.length, 0, '越界文件绝不能入库');
});

test('安全边界：用 ../ 越权也会被拦下', () => {
  const fdb = fakeDb();
  assert.throws(() => pickup.pickup({ db: fdb, sourcePath: path.join(handoff, '..', 'elsewhere', 'x.pdf'), itemId: 1, root: handoff }),
    /不在允许的交接目录/);
});

test('假文件识别：下单页 HTML 不会被当成全文导入', () => {
  const src = path.join(handoff, 'fake.pdf');
  fs.writeFileSync(src, Buffer.from('<html><body>请输入验证码 order</body></html>'));
  const fdb = fakeDb();
  assert.throws(() => pickup.pickup({ db: fdb, sourcePath: src, itemId: 1, root: handoff }),
    /不是 PDF\/CAJ\/图片/);
  assert.strictEqual(fdb.atts.length, 0);
});

test('过小文件（疑似错误页）也被拒绝', () => {
  const src = path.join(handoff, 'tiny.pdf');
  fs.writeFileSync(src, Buffer.from('%PDF-'));
  const fdb = fakeDb();
  assert.throws(() => pickup.pickup({ db: fdb, sourcePath: src, itemId: 1, root: handoff }), /过小/);
});

test('文件不存在时给出明确报错', () => {
  const fdb = fakeDb();
  assert.throws(() => pickup.pickup({ db: fdb, sourcePath: path.join(handoff, 'nope.pdf'), itemId: 1, root: handoff }), /不存在/);
});

test('默认交接目录位于用户下载目录下的专用子目录', () => {
  const d = pickup.defaultPickupDir();
  assert.ok(/LESP附件$/.test(d), '应以专用子目录结尾：' + d);
  assert.ok(d.includes('Downloads') || d.includes('下载'), '应在下载目录下：' + d);
});

test.after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
});

test('下载目录根下的文件也可导入（下载页自行触发的下载会落在那里）', () => {
  const dl = path.join(tmp, 'Downloads');
  fs.mkdirSync(dl, { recursive: true });
  const src = path.join(dl, 'CNKI-某篇.caj');
  fs.writeFileSync(src, Buffer.concat([Buffer.from('CAJ'), Buffer.alloc(4096, 0x20)]));
  const fdb = fakeDb();
  // 显式指定允许根目录为「下载目录」，模拟 allowedRoots 的第二个根
  const r = pickup.pickup({ db: fdb, sourcePath: src, itemId: 2, root: dl });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.ext, 'caj');
});

test('CAJ 文件也能正常导入', () => {
  const src = path.join(handoff, 'lesp-2.caj');
  fs.writeFileSync(src, Buffer.concat([Buffer.from('CAJ'), Buffer.alloc(4096, 0x20)]));
  const fdb = fakeDb();
  const r = pickup.pickup({ db: fdb, sourcePath: src, itemId: 3, filename: '某论文.caj', root: handoff });
  assert.strictEqual(r.ext, 'caj');
  assert.strictEqual(fdb.atts.length, 1);
});
