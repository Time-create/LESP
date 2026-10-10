const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');

test('Phase0 - 依赖均可加载', () => {
  const deps = ['better-sqlite3', 'express', 'multer', 'archiver', 'adm-zip'];
  for (const d of deps) {
    let ok = true;
    try {
      require(require.resolve(d, { paths: [ROOT] }));
    } catch (e) {
      ok = false;
    }
    assert.ok(ok, '依赖不可用: ' + d);
  }
});

test('Phase0 - better-sqlite3 可建表并正确读写中文', () => {
  const Database = require(require.resolve('better-sqlite3', { paths: [ROOT] }));
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (a TEXT)');
  db.prepare('INSERT INTO t VALUES (?)').run('宋会要辑稿 卷一三七');
  const row = db.prepare('SELECT a FROM t').get();
  assert.strictEqual(row.a, '宋会要辑稿 卷一三七');
  db.close();
});

test('Phase0 - FTS5 中文子串可被检索到（切字方案有效）', () => {
  const Database = require(require.resolve('better-sqlite3', { paths: [ROOT] }));
  const { ftsTokenize, ftsQuery } = require(path.join(ROOT, 'server/lib/fts.js'));
  const db = new Database(':memory:');
  db.exec("CREATE VIRTUAL TABLE ft USING fts5(body, content='')");

  const doc = '公尝充里正，凡三岁，乡人德之。';
  db.prepare('INSERT INTO ft(rowid, body) VALUES (?, ?)').run(1, ftsTokenize(doc));

  const q = ftsQuery('里正');
  assert.ok(q, '查询串不应为空');
  const hit = db.prepare('SELECT rowid FROM ft WHERE ft MATCH ?').all(q);
  assert.strictEqual(hit.length, 1, '「里正」应命中含该词的录文');
  assert.strictEqual(hit[0].rowid, 1);

  // 不相关的词不应命中
  const miss = db.prepare('SELECT rowid FROM ft WHERE ft MATCH ?').all(ftsQuery('雇钱'));
  assert.strictEqual(miss.length, 0, '「雇钱」不应命中');
  db.close();
});

test('Phase0 - FTS5 英文与数字保持完整 token', () => {
  const Database = require(require.resolve('better-sqlite3', { paths: [ROOT] }));
  const { ftsTokenize, ftsQuery } = require(path.join(ROOT, 'server/lib/fts.js'));
  const db = new Database(':memory:');
  db.exec("CREATE VIRTUAL TABLE ft USING fts5(body, content='')");
  db.prepare('INSERT INTO ft(rowid, body) VALUES (?, ?)').run(1, ftsTokenize('历史研究 2018(4) DOI'));
  const hit = db.prepare('SELECT rowid FROM ft WHERE ft MATCH ?').all(ftsQuery('2018'));
  assert.strictEqual(hit.length, 1, '数字 2018 应可检索');
  db.close();
});

test('Phase0 - schema.sql 可被完整执行且幂等', () => {
  const Database = require(require.resolve('better-sqlite3', { paths: [ROOT] }));
  const sql = fs.readFileSync(path.join(ROOT, 'server/schema.sql'), 'utf8');
  const db = new Database(':memory:');
  db.exec(sql);
  db.exec(sql); // 第二次执行不应报错
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  const required = [
    'items', 'collections', 'collection_items', 'tags', 'item_tags',
    'excerpts', 'attachments', 'compilations', 'compilation_blocks',
    'compilation_refs', 'notes', 'note_links', 'ideas', 'idea_links',
    'settings', 'items_fts'
  ];
  for (const t of required) {
    assert.ok(tables.includes(t), '缺少表: ' + t);
  }
  db.close();
});
