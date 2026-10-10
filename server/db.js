// 数据库访问的唯一出口。所有 SQL 必须经由 dbAll/dbGet/dbRun/dbTx，
// 以便在 better-sqlite3 不可用时替换底层引擎而不影响路由层。
const fs = require('node:fs');
const path = require('node:path');
const paths = require('./lib/paths');
const { ftsTokenize } = require('./lib/fts');

let Database = null;
let db = null;
let engine = null;

function loadDriver() {
  if (Database) return Database;
  try {
    Database = require('better-sqlite3');
    engine = 'better-sqlite3';
  } catch (e) {
    try {
      Database = require('node:sqlite').DatabaseSync;
      engine = 'node:sqlite';
    } catch (e2) {
      throw new Error('无可用 SQLite 驱动：better-sqlite3 与 node:sqlite 均不可用');
    }
  }
  return Database;
}

function initDb(dataDir) {
  if (dataDir) paths.setDataDir(dataDir);
  paths.ensureDirs();
  const Driver = loadDriver();
  if (db) {
    try { db.close(); } catch (e) { /* 忽略关闭异常 */ }
  }
  db = new Driver(paths.dbFile());
  const version=db.pragma('user_version',{simple:true});
  if(version>require('./migrations').VERSION){db.close();db=null;throw new Error('数据库版本高于当前程序，请使用更新的工作台');}
  if(version<require('./migrations').VERSION&&db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='items'").get()){
    const backup=path.join(paths.backupsDir(),'pre-v2-'+Date.now()+'.db');
    db.prepare('VACUUM INTO ?').run(backup);
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
  db.transaction(() => {
    require('./migrations').migrate(db);
    require('./services/writing').migrateContent();
  })();

  // 附件集中化：把历史上散落在各处的附件搬进 data/files/attachments。
  // 只复制不移动，失败也不影响启动（原路径仍可打开）。
  try {
    const r = require('./services/attachment-store').centralize(db);
    if (r.moved || r.missing.length) {
      console.log(`附件整理：已集中 ${r.moved} 个` + (r.missing.length ? `，缺失 ${r.missing.length} 个` : ''));
    }
  } catch (e) {
    console.log('附件整理跳过：' + (e && e.message || e));
  }
  return db;
}

function getDb() {
  if (!db) throw new Error('数据库未初始化，请先调用 initDb');
  return db;
}

function closeDb() {
  if (db) {
    try { db.close(); } catch (e) { /* 忽略 */ }
    db = null;
  }
}

function dbAll(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

function dbGet(sql, params = []) {
  return getDb().prepare(sql).get(...params);
}

function dbRun(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

function dbTx(fn) {
  const d = getDb();
  return d.transaction(fn)();
}

// 重建某条条目的全文索引：标题 + 副标题 + 字段值 + 全部摘录(正文与按语)
function syncFts(itemId) {
  const d = getDb();
  const item = d.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  d.prepare('DELETE FROM items_fts WHERE rowid = ?').run(itemId);
  if (!item) return;
  let fieldsText = '';
  try {
    const f = JSON.parse(item.fields || '{}');
    fieldsText = Object.values(f).join(' ');
  } catch (e) {
    fieldsText = String(item.fields || '');
  }
  const ex = d.prepare('SELECT locator, text, comment FROM excerpts WHERE item_id = ?').all(itemId);
  const excerptText = ex.map((e) => [e.locator, e.text, e.comment].join(' ')).join(' ');
  const body = [item.title, item.subtitle, fieldsText, excerptText].join(' ');
  d.prepare('INSERT INTO items_fts(rowid, title, subtitle, fields, excerpt_text) VALUES (?,?,?,?,?)')
    .run(itemId, ftsTokenize(item.title), ftsTokenize(item.subtitle), ftsTokenize(fieldsText), ftsTokenize(excerptText));
}

function searchFts(keyword, limit = 200) {
  const { ftsQuery } = require('./lib/fts');
  const q = ftsQuery(keyword);
  if (!q) return [];
  try {
    return dbAll('SELECT rowid FROM items_fts WHERE items_fts MATCH ? LIMIT ?', [q, limit]).map((r) => r.rowid);
  } catch (e) {
    return [];
  }
}

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

module.exports = {
  initDb,
  getDb,
  closeDb,
  dbAll,
  dbGet,
  dbRun,
  dbTx,
  syncFts,
  searchFts,
  now,
  get engine() { return engine; }
};
