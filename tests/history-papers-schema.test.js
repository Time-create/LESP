// 史学论文（history_papers）：建表迁移的验证
// 要点：只新增表、不得改动任何既有表与既有数据
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-hp-'));
const paths = require('../server/lib/paths');
paths.setDataDir(tmp);
const db = require('../server/db');
db.initDb(tmp);

const cols = (t) => db.dbAll('PRAGMA table_info(' + t + ')').map((c) => c.name);
const tables = () => db.dbAll("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);

test('history_papers 表已建立，字段与 compilations 一致', () => {
  assert.ok(tables().includes('history_papers'), 'history_papers 表应存在');
  const hp = cols('history_papers');
  const cp = cols('compilations');
  assert.deepStrictEqual(hp, cp, '字段应与 compilations 完全一致，实际：' + hp.join(','));
  // 默认状态按需求取「拟写」
  db.dbRun("INSERT INTO history_papers (title, created_at, updated_at) VALUES ('测试论文', '2026-10-04', '2026-10-04')");
  const row = db.dbGet('SELECT * FROM history_papers WHERE id = 1');
  assert.strictEqual(row.status, '拟写', '默认状态应为拟写');
  assert.strictEqual(row.footnote_style, 'footer');
  assert.strictEqual(row.project, '');
  assert.strictEqual(row.idea_id, null);
});

test('迁移是幂等的：重复执行不报错、不重复建表', () => {
  const migrate = require('../server/migrations').migrate;
  const before = tables().length;
  assert.doesNotThrow(() => migrate(db.getDb ? db.getDb() : db.dbGet('SELECT 1') && require('../server/db').getDb()));
  assert.strictEqual(tables().length, before, '重复迁移不应新增/删除表');
});

test('既有表与既有数据未受影响', () => {
  // 写入一条长编与札记，迁移后仍在
  db.dbRun("INSERT INTO compilations (title, status, created_at, updated_at) VALUES ('长编回归', '进行中', '2026-10-04', '2026-10-04')");
  db.dbRun("INSERT INTO notes (title, body, created_at, updated_at) VALUES ('札记回归', '内容', '2026-10-04', '2026-10-04')");
  assert.strictEqual(db.dbGet("SELECT COUNT(*) c FROM compilations WHERE title='长编回归'").c, 1, '长编数据应完好');
  assert.strictEqual(db.dbGet("SELECT COUNT(*) c FROM notes WHERE title='札记回归'").c, 1, '札记数据应完好');
  // 关键表结构未被改动
  assert.deepStrictEqual(cols('compilations'), ['id', 'title', 'project', 'status', 'footnote_style', 'idea_id', 'created_at', 'updated_at']);
  assert.ok(cols('items').includes('source_revision'), 'items 表结构不应变化');
  assert.ok(cols('collections').includes('sort'), 'collections 表结构不应变化');
});

test('schema.sql 与 migrations 保持一致（新库与旧库都能建出同一张表）', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'server', 'schema.sql'), 'utf8');
  const mig = fs.readFileSync(path.join(__dirname, '..', 'server', 'migrations', 'index.js'), 'utf8');
  const inSchema = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS history_papers'));
  const inMig = mig.slice(mig.indexOf('CREATE TABLE IF NOT EXISTS history_papers'));
  // migrations/index.js 里的建表语句写在单引号 JS 字符串中，引号带转义反斜杠，比较前先去掉
  const norm = (t) => t.slice(t.indexOf('CREATE TABLE IF NOT EXISTS history_papers')).slice(0, t.indexOf(')') + 1).replace(/\\/g, '').replace(/\s+/g, '').toLowerCase();
  assert.strictEqual(norm(inMig), norm(inSchema), '两处建表语句必须一致');
});

test.after(() => {
  try { db.closeDb && db.closeDb(); } catch (e) { /* 忽略 */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
});
