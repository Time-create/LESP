// 「迁移分类数据」：把录文分类从「按史料条目隔离」升级为「全局树」。
// 手动触发（设置页按钮），幂等；迁移前自动备份数据目录。
//
// 迁移内容：
//   1. excerpt_folders.item_id 置空（分类成为全局节点，父子层级与已有归属全部保留）
//   2. 唯一索引由 folder_sibling(item_id, parent, name) 重建为全局版 folder_sibling_global(parent, name)
//   3. 触发器 item_folder_cleanup 由「删条目顺带删分类」改为「只解除该条目录文的归属」
//   4. collections.sort 按现有 id 顺序初始化同级序号
const db = require('../db');

const MARK = 'classification_migrated_v4';

function alreadyMigrated() {
  const row = db.dbGet("SELECT value FROM settings WHERE key = 'classification_migration'");
  return !!(row && row.value && String(row.value).includes(MARK));
}

/** 迁移前自动备份（与设置页手动备份同一入口，失败不阻断迁移前提示） */
async function backupFirst() {
  try {
    const svc = require('./backup-v2');
    const out = await svc.create();
    return { ok: true, backup: out };
  } catch (e) {
    return { ok: false, error: '自动备份失败：' + e.message };
  }
}

function preview() {
  const folders = db.dbGet('SELECT COUNT(*) n FROM excerpt_folders').n;
  const scoped = db.dbGet('SELECT COUNT(*) n FROM excerpt_folders WHERE item_id IS NOT NULL').n;
  const links = db.dbGet('SELECT COUNT(*) n FROM excerpt_folder_links').n;
  const sameNameClash = db.dbGet(
    'SELECT COUNT(*) n FROM (SELECT COALESCE(parent_id,0) p, name FROM excerpt_folders GROUP BY p, name HAVING COUNT(*) > 1)'
  ).n;
  return { folders, scoped, links, sameNameClash, migrated: alreadyMigrated() };
}

/**
 * 执行迁移。返回统计结果；幂等——已迁移时直接返回。
 * 同名冲突处理：同一父级下重名时保留 id 最小者，其余自动改名（如「制度」→「制度 (2)」）。
 */
async function run() {
  if (alreadyMigrated()) return Object.assign({ ok: true, skipped: true, message: '分类数据已迁移过，无需重复执行' }, preview());

  const backup = await backupFirst();
  const before = preview();

  const renamed = [];
  const result = db.dbTx(() => {
    // 1) 同名冲突消解（全局唯一索引的前置条件）
    const clash = db.dbAll(
      'SELECT COALESCE(parent_id,0) p, name, COUNT(*) n FROM excerpt_folders GROUP BY p, name HAVING COUNT(*) > 1'
    );
    for (const group of clash) {
      const rows = db.dbAll(
        'SELECT id FROM excerpt_folders WHERE COALESCE(parent_id,0) = ? AND name = ? ORDER BY id',
        [group.p, group.name]
      );
      for (let i = 1; i < rows.length; i += 1) {
        let name = `${group.name} (${i + 1})`;
        let n = i + 1;
        while (db.dbGet('SELECT id FROM excerpt_folders WHERE COALESCE(parent_id,0)=? AND name=?', [group.p, name])) {
          n += 1;
          name = `${group.name} (${n})`;
        }
        db.dbRun('UPDATE excerpt_folders SET name = ? WHERE id = ?', [name, rows[i].id]);
        renamed.push({ id: rows[i].id, from: group.name, to: name });
      }
    }

    // 2) 分类全局化：item_id 原为 NOT NULL，需重建表才能置空。
    //    必须先删触发器：它引用了 excerpt_folders，ALTER TABLE RENAME 时会因此报
    //    “error in trigger … no such table: main.excerpt_folders”。
    db.dbRun('DROP TRIGGER IF EXISTS item_folder_cleanup');
    db.dbRun(`CREATE TABLE excerpt_folders_v4 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER,
      parent_id INTEGER,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort INTEGER NOT NULL DEFAULT 0
    )`);
    db.dbRun('INSERT INTO excerpt_folders_v4 (id,item_id,parent_id,name,description,sort) SELECT id,item_id,parent_id,name,COALESCE(description,\'\'),sort FROM excerpt_folders');
    db.dbRun('DROP TABLE excerpt_folders');
    db.dbRun('ALTER TABLE excerpt_folders_v4 RENAME TO excerpt_folders');
    db.dbRun('UPDATE excerpt_folders SET item_id = NULL');

    // 3) 唯一索引：按条目隔离 → 全局唯一
    db.dbRun('DROP INDEX IF EXISTS folder_sibling');
    db.dbRun('CREATE UNIQUE INDEX IF NOT EXISTS folder_sibling_global ON excerpt_folders(COALESCE(parent_id,0), name)');

    // 4) 触发器改为「只解除归属」，不再删除全局分类
    db.dbRun('DROP TRIGGER IF EXISTS item_folder_cleanup');
    db.dbRun(`CREATE TRIGGER item_folder_cleanup AFTER DELETE ON items BEGIN
      DELETE FROM excerpt_folder_links WHERE excerpt_id IN (SELECT id FROM excerpts WHERE item_id = OLD.id);
    END;`);

    // 5) 条目分类排序号初始化（按 id 顺序，同级连续）
    const rows = db.dbAll('SELECT id, parent_id FROM collections ORDER BY id');
    const seq = new Map();
    for (const row of rows) {
      const key = (row.module || '') + '#' + (row.parent_id || 0);
      const next = seq.get(key) || 0;
      db.dbRun('UPDATE collections SET sort = ? WHERE id = ?', [next, row.id]);
      seq.set(key, next + 1);
    }

    db.dbRun(
      'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['classification_migration', MARK + ' @ ' + db.now()]
    );
    return { cleared: before.scoped, renamed: renamed.length };
  });

  return Object.assign({ ok: true, backup, renamed: renamed.slice(0, 20), renamed_total: renamed.length }, preview(), result);
}

module.exports = { preview, run, alreadyMigrated, MARK };
