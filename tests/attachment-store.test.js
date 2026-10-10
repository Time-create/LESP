// 附件统一存储：落盘位置、路径基准、重名处理、旧文件整理
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-att-'));
const paths = require('../server/lib/paths');
paths.setDataDir(tmp);
const db = require('../server/db');
db.initDb(tmp);

const store = require('../server/services/attachment-store');

test('统一目录位于 App 私有文件目录下', () => {
  const dir = paths.attachmentsDir();
  assert.strictEqual(dir, path.join(tmp, 'files', 'attachments'));
  assert.ok(dir.startsWith(tmp), '必须在数据目录内');
});

test('上传的文件落在统一目录，且路径相对 dataDir（各读取方都按此解析）', () => {
  const src = path.join(tmp, '原始下载.pdf');
  fs.writeFileSync(src, Buffer.from('%PDF-1.7\n' + 'x'.repeat(2048)));
  const stored = store.store({ srcPath: src, originalName: '原始下载.pdf' });
  assert.ok(stored.abs.startsWith(paths.attachmentsDir()), '应落在统一目录');
  assert.ok(stored.rel.startsWith('files/attachments/'), 'rel_path 应相对 dataDir');
  // 按各读取方的方式还原，必须能找到
  assert.strictEqual(path.resolve(paths.getDataDir(), stored.rel), stored.abs);
  assert.ok(fs.existsSync(path.resolve(paths.getDataDir(), stored.rel)));
});

test('原件被删除后，附件仍能在 App 内打开', () => {
  const src = path.join(tmp, '待删除原件.pdf');
  fs.writeFileSync(src, Buffer.from('%PDF-1.7\nbody'));
  const stored = store.store({ srcPath: src, originalName: '待删除原件.pdf' });
  fs.unlinkSync(src);                                   // 模拟用户删掉下载目录里的原件
  const abs = store.resolveAttachment(stored.rel);
  assert.ok(fs.existsSync(abs), '原件删除后附件应依然可读');
});

test('同名文件不会互相覆盖（各自独立存储）', () => {
  const a = store.store({ buffer: Buffer.from('%PDF- A'), originalName: '同名.pdf' });
  const b = store.store({ buffer: Buffer.from('%PDF- B'), originalName: '同名.pdf' });
  assert.notStrictEqual(a.abs, b.abs);
  assert.strictEqual(fs.readFileSync(a.abs, 'utf8'), '%PDF- A');
  assert.strictEqual(fs.readFileSync(b.abs, 'utf8'), '%PDF- B');
});

test('文件名清洗：先剥离目录（防路径遍历），再替换非法字符', () => {
  // basename 会去掉 ../../，天然杜绝路径遍历
  assert.strictEqual(store.safeName('../../etc/passwd'), 'passwd');
  assert.ok(!store.safeName('../../etc/passwd').includes('/'));
  // 剩余分隔符与控制字符替换成下划线
  assert.strictEqual(store.safeName('a/b\\c:d*e?f"g<h>i|j'), 'c_d_e_f_g_h_i_j');
  assert.ok(store.safeName('').length > 0, '空名要有兜底');
});

test('整理：把散落在别处的旧附件搬进统一目录并更新记录', () => {
  // 造一个“旧式”记录：文件在 files/<itemId>/ 下，rel_path 相对 dataDir
  const oldDir = path.join(paths.filesDir(), '999');
  fs.mkdirSync(oldDir, { recursive: true });
  const oldFile = path.join(oldDir, 'old.pdf');
  fs.writeFileSync(oldFile, Buffer.from('%PDF- old'));
  const info = db.dbRun('INSERT INTO attachments (item_id, filename, rel_path, size, mime, created_at) VALUES (?,?,?,?,?,?)',
    [999, 'old.pdf', 'files/999/old.pdf', 9, 'application/pdf', db.now()]);
  const id = info.lastInsertRowid;

  const r = store.centralize(db);
  assert.ok(r.moved >= 1, '应有文件被集中');

  const row = db.dbGet('SELECT * FROM attachments WHERE id = ?', [id]);
  assert.ok(row.rel_path.startsWith('files/attachments/'));
  const abs = store.resolveAttachment(row.rel_path);
  assert.ok(fs.existsSync(abs), '搬家后文件必须能找到');
  assert.strictEqual(fs.readFileSync(abs, 'utf8'), '%PDF- old');
});

test('整理：缺失的文件只记录不报错，原记录保持不动', () => {
  const info = db.dbRun('INSERT INTO attachments (item_id, filename, rel_path, size, mime, created_at) VALUES (?,?,?,?,?,?)',
    [998, 'gone.pdf', 'files/998/gone.pdf', 1, 'application/pdf', db.now()]);
  const r = store.centralize(db);
  assert.ok(r.missing.some((m) => m.includes('998')), '应记为缺失');
  const row = db.dbGet('SELECT * FROM attachments WHERE id = ?', [info.lastInsertRowid]);
  assert.strictEqual(row.rel_path, 'files/998/gone.pdf', '缺失文件不应改路径');
});

test.after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* Windows 上可能占用，忽略 */ }
});
