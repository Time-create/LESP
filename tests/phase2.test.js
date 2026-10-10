const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const db = require(path.join(ROOT, 'server/db'));
const { MODULES, MODULE_KEYS, isModule } = require(path.join(ROOT, 'server/config/modules'));
const { FIELD_SCHEMA, fieldsOf, requiredKeys } = require(path.join(ROOT, 'server/config/field-schema'));

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-p2-'));
  db.initDb(dir);
  return dir;
}

test('Phase2 - 六类模块均定义了元信息与字段', () => {
  assert.strictEqual(MODULE_KEYS.length, 6);
  for (const key of MODULE_KEYS) {
    assert.ok(isModule(key));
    assert.ok(MODULES[key].name, key + ' 缺中文名');
    assert.ok(MODULES[key].route.startsWith('/'), key + ' 路由非法');
    assert.ok(MODULES[key].footnote.includes('{title}'), key + ' 脚注模板应含 {title}');
    assert.ok(fieldsOf(key).length >= 5, key + ' 字段过少');
  }
});

test('Phase2 - 各模块字段符合 PRD 规定', () => {
  const expect = {
    classics: ['author', 'dynasty', 'edition', 'juan', 'volumes', 'series', 'location'],
    inscription: ['era', 'gregorian', 'writer', 'calligrapher', 'carver', 'find_place', 'keep_place', 'material'],
    document: ['doc_type', 'era', 'parties', 'place', 'batch', 'keeper', 'doc_no', 'size_material'],
    archive: ['fond_no', 'catalog_no', 'volume_no', 'item_no', 'era', 'responsible', 'keeper', 'open_status', 'microfilm_no'],
    paper: ['author', 'journal', 'year_volume', 'pages', 'doi', 'keywords', 'abstract', 'source'],
    book: ['author', 'publisher', 'year', 'series', 'isbn', 'edition_no', 'progress']
  };
  for (const [mod, keys] of Object.entries(expect)) {
    const actual = fieldsOf(mod).map((f) => f.key);
    for (const k of keys) {
      assert.ok(actual.includes(k), mod + ' 缺少字段 ' + k);
    }
  }
});

test('Phase2 - 枚举字段带有选项', () => {
  const docType = fieldsOf('document').find((f) => f.key === 'doc_type');
  assert.strictEqual(docType.type, 'enum');
  assert.ok(docType.options.includes('鱼鳞图册'));
  const openStatus = fieldsOf('archive').find((f) => f.key === 'open_status');
  assert.ok(openStatus.options.includes('未开放'));
});

test('Phase2 - 文书类型必填（PRD 要求）', () => {
  assert.ok(requiredKeys('document').includes('doc_type'));
});

test('Phase2 - 迁移幂等：重复初始化不报错且表结构完整', () => {
  const dir = freshDb();
  db.initDb(dir);
  db.initDb(dir);
  const tables = db.dbAll("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
  assert.ok(tables.includes('items'));
  assert.ok(tables.includes('items_fts'));
  db.closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Phase2 - 种子数据写入六类模块且可被 FTS 检索', () => {
  const dir = freshDb();
  const { seed } = require(path.join(ROOT, 'server/seed'));
  const n = seed();
  assert.strictEqual(n, 18, '应写入 18 条条目');

  for (const key of MODULE_KEYS) {
    const c = db.dbGet('SELECT COUNT(*) c FROM items WHERE module = ?', [key]);
    assert.strictEqual(c.c, 3, key + ' 应有 3 条种子条目');
  }

  // 录文数量
  const ex = db.dbGet('SELECT COUNT(*) c FROM excerpts');
  assert.ok(ex.c >= 6, '摘录数量不足');

  // FTS 命中：种子录文中的「里正」
  const hits = db.searchFts('里正');
  assert.ok(hits.length >= 1, '「里正」应命中墓志铭录文');
  const item = db.dbGet('SELECT title FROM items WHERE id = ?', [hits[0]]);
  assert.strictEqual(item.title, '宋故朱公墓志铭');

  // 不相关词不命中
  assert.strictEqual(db.searchFts('量子力学').length, 0);

  db.closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Phase2 - FTS 随摘录更新而同步', () => {
  const dir = freshDb();
  const nowStr = db.now();
  const info = db.dbRun(
    'INSERT INTO items (module, title, subtitle, status, fields, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    ['classics', '测试书', '', '', '{}', nowStr, nowStr]
  );
  const id = info.lastInsertRowid;
  db.syncFts(id);
  assert.strictEqual(db.searchFts('差役').length, 0, '插入摘录前不应命中');

  db.dbRun('INSERT INTO excerpts (item_id, locator, text, comment, seq, created_at) VALUES (?,?,?,?,?,?)',
    [id, '卷一', '凡充差役者给以雇钱', '', 0, nowStr]);
  db.syncFts(id);
  assert.strictEqual(db.searchFts('差役').length, 1, '插入摘录后应命中');

  db.closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Phase2 - 字段 schema 无重复 key', () => {
  for (const [mod, list] of Object.entries(FIELD_SCHEMA)) {
    const keys = list.map((f) => f.key);
    assert.strictEqual(new Set(keys).size, keys.length, mod + ' 存在重复字段 key');
  }
});
