const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// V1→V2：文档、分类与 PDF 批注；V2→V3：条目分类排序列（拖拽排序用）。
// 录文分类的「全局化」属于数据语义变更，不在启动迁移中执行，
// 由设置页的「迁移分类数据」按钮手动触发（见 services/classification-migration.js）。
const VERSION = 3;

function addColumn(database, table, name, definition) {
  if (!database.prepare('PRAGMA table_info(' + table + ')').all().some((c) => c.name === name)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function record(database, version, name, sql) {
  database.prepare('INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES (?,?,?,?)')
    .run(version, name, crypto.createHash('sha256').update(sql).digest('hex'), new Date().toISOString());
}

// theme_links.content_type 的 CHECK 约束限定了四种类型，SQLite 无法 ALTER CHECK，
// 需要重建表。做法：先看约束是否已包含 historyPaper，没有才重建；数据与索引一并保留。
function widenThemeLinkTypes(database) {
  const row = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='theme_links'").get();
  if (!row) return;                                  // 表不存在（全新库由 schema.sql 建）
  if (row.sql.includes('historyPaper')) return;      // 约束已放宽
  const before = database.prepare('SELECT COUNT(*) c FROM theme_links').get().c;
  // DROP TABLE 会校验所有触发器体，凡引用 theme_links 的触发器都要先撤下、重建后原样装回
  const touching = database
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND sql LIKE '%theme_links%'")
    .all();
  database.exec('PRAGMA foreign_keys = OFF');
  for (const t of touching) database.exec('DROP TRIGGER IF EXISTS ' + t.name);
  database.exec('CREATE TABLE theme_links_new (theme_id INTEGER NOT NULL, content_type TEXT NOT NULL CHECK(content_type IN (\'excerpt\',\'compilation\',\'note\',\'idea\',\'historyPaper\')), content_id INTEGER NOT NULL, PRIMARY KEY(theme_id, content_type, content_id))');
  database.exec('INSERT INTO theme_links_new (theme_id, content_type, content_id) SELECT theme_id, content_type, content_id FROM theme_links');
  database.exec('DROP TABLE theme_links');
  database.exec('ALTER TABLE theme_links_new RENAME TO theme_links');
  database.exec('CREATE INDEX IF NOT EXISTS theme_content ON theme_links(content_type, content_id)');
  for (const t of touching) database.exec(t.sql);
  database.exec('PRAGMA foreign_keys = ON');
  const after = database.prepare('SELECT COUNT(*) c FROM theme_links').get().c;
  if (after !== before) throw new Error('主题关联迁移前后行数不一致：' + before + ' → ' + after);
  const triggerExists = (name) => !!database
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?")
    .get(name);
  for (const t of touching) {
    if (!triggerExists(t.name)) throw new Error('触发器重建失败：' + t.name);
  }
}

// 幂等补列：不依赖 user_version，任何时候启动都会检查缺什么补什么。
// 解决「库已是 version 3、但后续新增的列没补上」的问题（addColumn 自身判重，可反复执行）。
function selfHeal(database) {
  addColumn(database, 'collections', 'sort', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(database, 'collections', 'description', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'excerpt_folders', 'description', "TEXT NOT NULL DEFAULT ''");
  database.exec('CREATE TABLE IF NOT EXISTS collection_compilations (collection_id INTEGER NOT NULL, compilation_id INTEGER NOT NULL, PRIMARY KEY (collection_id, compilation_id))');
  database.exec('CREATE INDEX IF NOT EXISTS idx_cc_compilation ON collection_compilations(compilation_id)');
  database.exec('CREATE TABLE IF NOT EXISTS collection_notes (collection_id INTEGER NOT NULL, note_id INTEGER NOT NULL, PRIMARY KEY (collection_id, note_id))');
  database.exec('CREATE INDEX IF NOT EXISTS idx_cn_note ON collection_notes(note_id)');
  // 史学论文：结构与 compilations 一致（只新增表，不改动任何既有表）
  database.exec('CREATE TABLE IF NOT EXISTS history_papers (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, project TEXT DEFAULT \'\', status TEXT DEFAULT \'拟写\', footnote_style TEXT DEFAULT \'footer\', idea_id INTEGER DEFAULT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
  // 删除论文时连带清理主题关联与统一文档（与 compilations 的 comp_v2_cleanup 同构）
  widenThemeLinkTypes(database);
  database.exec("CREATE TRIGGER IF NOT EXISTS hp_v2_cleanup AFTER DELETE ON history_papers BEGIN DELETE FROM theme_links WHERE content_type='historyPaper' AND content_id=OLD.id; DELETE FROM writing_documents WHERE kind='historyPaper' AND entity_id=OLD.id; END;");
}

function migrate(database) {
  const current = database.pragma('user_version', { simple: true });
  if (current > VERSION) throw new Error('数据库版本高于当前程序，请使用更新的工作台');
  // 版本已是最新时仍要自愈补列（新增列可能晚于该版本发布）
  if (current === VERSION) { database.transaction(() => { selfHeal(database); })(); return; }
  const v2sql = fs.readFileSync(path.join(__dirname, '002-v2.sql'), 'utf8');
  database.transaction(() => {
    if (current < 2) {
      addColumn(database, 'excerpts', 'revision', 'INTEGER NOT NULL DEFAULT 1');
      addColumn(database, 'excerpts', 'updated_at', "TEXT NOT NULL DEFAULT ''");
      addColumn(database, 'excerpts', 'locator_json', "TEXT NOT NULL DEFAULT '{}'");
      addColumn(database, 'excerpts', 'source_json', "TEXT NOT NULL DEFAULT '{}'");
      addColumn(database, 'items', 'source_revision', 'INTEGER NOT NULL DEFAULT 1');
      addColumn(database, 'attachments', 'content_sha256', "TEXT NOT NULL DEFAULT ''");
      addColumn(database, 'attachments', 'page_count', 'INTEGER');
      database.exec(v2sql);
      record(database, 2, 'V2 documents, taxonomy and PDF annotations', v2sql);
    }
    if (current < 3) {
      record(database, 3, 'V4 classification: collection sort + writing links', 'collections.sort;collection_compilations;collection_notes');
    }
    selfHeal(database);
    database.pragma('user_version = ' + VERSION);
  })();
}

module.exports = { migrate, VERSION };
