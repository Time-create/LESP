// 录文分类（folder）改造要点：
// 1) 去掉 item_id 隔离 —— 分类成为全局节点，任意史料的录文都能归入同一分类；
// 2) 四层封顶、同级重名、级联删除、拖拽排序与换父级（复用 services/classification.js）；
// 3) 归属写入由「覆盖式」改为「增删式」，支持一条录文属于多个分类。
// 主题分类（theme）保持 V2 行为不变。
const db = require('../db');
const classification = require('./classification');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

const targets = { excerpt: 'excerpts', note: 'notes', idea: 'ideas', compilation: 'compilations', historyPaper: 'history_papers' };
const FOLDER_LINK = { table: 'excerpt_folder_links', categoryColumn: 'folder_id', ownerColumn: 'excerpt_id' };

// V5：主题树层级上限，与分类树一致。depthOf 从 0 起（顶级自身为 0，其子为 1…）
const MAX_THEME_DEPTH = 4;
function depthOf(id) {
  let d = 0, cur = id, guard = 0;
  while (cur && guard < 20) {                       // guard 防脏数据成环
    const r = db.dbGet('SELECT parent_id FROM themes WHERE id=?', [cur]);
    if (!r || !r.parent_id) break;
    cur = r.parent_id; d += 1; guard += 1;
  }
  return d;
}

function ensureTarget(type, id) {
  if (!targets[type] || !db.dbGet('SELECT id FROM ' + targets[type] + ' WHERE id=?', [id])) fail('分类对象不存在', 404);
}
function table(scope) {
  if (!['theme', 'folder'].includes(scope)) fail('分类类型无效');
  return scope === 'theme' ? 'themes' : 'excerpt_folders';
}
function descendants(scope, id) {
  return db.dbAll(`WITH RECURSIVE subtree(id) AS (SELECT id FROM ${table(scope)} WHERE id=? UNION SELECT n.id FROM ${table(scope)} n JOIN subtree s ON n.parent_id=s.id) SELECT id FROM subtree`, [id]).map((r) => r.id);
}

/** 录文分类树；传 itemId 时只返回「本条目用到过」的节点（其子树结构保留） */
function listFolders(options = {}) {
  const rows = db.dbAll('SELECT * FROM excerpt_folders ORDER BY sort, id');
  const countOf = (row) => db.dbGet('SELECT COUNT(*) n FROM excerpt_folder_links WHERE folder_id = ?', [row.id]).n;
  const used = options.itemId
    ? (id) => db.dbGet('SELECT COUNT(*) n FROM excerpt_folder_links WHERE folder_id = ? AND excerpt_id IN (SELECT id FROM excerpts WHERE item_id = ?)', [id, Number(options.itemId)]).n > 0
    : null;
  const scoped = used ? rows.filter((r) => used(r.id)) : rows;
  const tree = classification.buildTree(db, 'excerpt_folders', scoped, countOf);
  // 全局树：标出每个分类涉及的史料，供录文列表与筛选回显「属于哪部史料」
  if (!options.itemId) {
    const mark = (nodes) => nodes.forEach((n) => {
      n.item_titles = db.dbAll(
        'SELECT DISTINCT i.title title FROM excerpt_folder_links l JOIN excerpts e ON e.id = l.excerpt_id JOIN items i ON i.id = e.item_id WHERE l.folder_id = ?',
        [n.id]
      ).map((r) => r.title);
      mark(n.children);
    });
    mark(tree);
  }
  return tree;
}

function saveFolder(id, payload) {
  return db.dbTx(() => {
    const old = id ? db.dbGet('SELECT * FROM excerpt_folders WHERE id=?', [id]) : null;
    if (id && !old) fail('分类不存在', 404);
    const name = String(payload.name ?? old?.name ?? '').trim();
    if (!name) fail('分类名称必填');
    const parent = payload.parent_id === undefined
      ? (old?.parent_id || null)
      : classification.assertPlacement(db, 'excerpt_folders', id, payload.parent_id || null);
    classification.assertSiblingName(db, 'excerpt_folders', name, parent, id);
    const description = String(payload.description ?? old?.description ?? '').trim().slice(0, 500);
    if (id) {
      db.dbRun('UPDATE excerpt_folders SET name=?,description=?,parent_id=? WHERE id=?', [name, description, parent, id]);
      return db.dbGet('SELECT * FROM excerpt_folders WHERE id=?', [id]);
    }
    const maxSort = db.dbGet('SELECT COALESCE(MAX(sort),-1) m FROM excerpt_folders WHERE COALESCE(parent_id,0)=?', [parent || 0]).m;
    // 迁移前该列是 NOT NULL，用 0 作占位；迁移后表结构改为可空并统一置空
    const info = db.dbRun('INSERT INTO excerpt_folders(item_id,parent_id,name,description,sort) VALUES (0,?,?,?,?)', [parent, name, description, maxSort + 1]);
    return db.dbGet('SELECT * FROM excerpt_folders WHERE id=?', [info.lastInsertRowid]);
  });
}

function removeFolder(id, confirm) {
  const ids = classification.subtreeIds(db, 'excerpt_folders', id);
  if (!ids.length) fail('分类不存在', 404);
  const placeholders = ids.map(() => '?').join(',');
  const links = db.dbGet(`SELECT COUNT(*) n FROM excerpt_folder_links WHERE folder_id IN (${placeholders})`, ids).n;
  if (!confirm) return { categories: ids.length, links };
  db.dbTx(() => {
    db.dbRun(`DELETE FROM excerpt_folder_links WHERE folder_id IN (${placeholders})`, ids);
    db.dbRun(`DELETE FROM excerpt_folders WHERE id IN (${placeholders})`, ids);
  });
  return { ok: true, categories: ids.length, links };
}

function reorderFolder(id, parentId, order) {
  return classification.reorder(db, 'excerpt_folders', id, parentId || null, order || []);
}

/** 录文归属增删（多选并存） */
function assignFolders(excerptId, folderIds, mode) {
  const ex = db.dbGet('SELECT * FROM excerpts WHERE id=?', [excerptId]);
  if (!ex) fail('录文不存在');
  return classification.assign(db, FOLDER_LINK, excerptId, folderIds, mode || 'add', (fid) => {
    if (!db.dbGet('SELECT id FROM excerpt_folders WHERE id=?', [Number(fid)])) fail('分类不存在：' + fid);
  });
}

/**
 * 按「条目」批量设置录文分类。
 * 录文分类挂在单条录文上（excerpt_folder_links），而用户的心智模型是
 * 「这个条目的录文属于哪些分类」——逐条录文去勾太繁琐，
 * 且条目还没有录文时无处可勾（表现为「分类无效」：点分类只能筛选空列表）。
 * 这里把「条目 → 其全部录文 → 分类」一次性对齐，mode=set 为全量覆盖。
 */
function assignItemFolders(itemId, folderIds) {
  const id = Number(itemId);
  const item = db.dbGet('SELECT id FROM items WHERE id=?', [id]);
  if (!item) fail('条目不存在', 404);
  const ids = (Array.isArray(folderIds) ? folderIds : []).map(Number).filter(Boolean);
  for (const fid of ids) {
    if (!db.dbGet('SELECT id FROM excerpt_folders WHERE id=?', [fid])) fail('分类不存在：' + fid);
  }
  return db.dbTx(() => {
    // 本条目当前用到的分类（子分类归约到自身，不上卷）
    const before = db.dbAll(
      'SELECT DISTINCT l.folder_id id FROM excerpt_folder_links l JOIN excerpts e ON e.id=l.excerpt_id WHERE e.item_id=?',
      [id]
    ).map((r) => r.id);
    const excerpts = db.dbAll('SELECT id FROM excerpts WHERE item_id=?', [id]);
    if (!excerpts.length) return { ok: true, folders: ids, excerpts: 0, added: 0, removed: 0 };
    const exIds = excerpts.map((r) => r.id);
    const ph = exIds.map(() => '?').join(',');
    const added = ids.filter((f) => !before.includes(f)).length;
    const removed = before.filter((f) => !ids.includes(f)).length;
    for (const ex of exIds) {
      db.dbRun(`DELETE FROM ${FOLDER_LINK.table} WHERE ${FOLDER_LINK.ownerColumn}=?`, [ex.id]);
      for (const f of ids) {
        db.dbRun(`INSERT OR IGNORE INTO ${FOLDER_LINK.table}(${FOLDER_LINK.ownerColumn},${FOLDER_LINK.categoryColumn}) VALUES (?,?)`, [ex.id, f]);
      }
    }
    void ph;
    return { ok: true, folders: ids, excerpts: exIds.length, added, removed };
  });
}

/** 读某条目当前用到的录文分类 id（用于表单回显） */
function itemFolderIds(itemId) {
  return db.dbAll(
    'SELECT DISTINCT l.folder_id id FROM excerpt_folder_links l JOIN excerpts e ON e.id=l.excerpt_id WHERE e.item_id=? ORDER BY l.folder_id',
    [Number(itemId)]
  ).map((r) => r.id);
}

// —— 主题分类：以下保持 V2 原样 ——
function listThemes() { return db.dbAll('SELECT * FROM themes ORDER BY sort,id'); }
function saveTheme(id, payload) {
  return db.dbTx(() => {
    const old = id ? db.dbGet('SELECT * FROM themes WHERE id=?', [id]) : null;
    if (id && !old) fail('分类不存在', 404);
    const name = String(payload.name ?? old?.name ?? '').trim();
    if (!name) fail('分类名称必填');
    const parent = payload.parent_id === undefined ? old?.parent_id || null : payload.parent_id ? Number(payload.parent_id) : null;
    if (parent) {
      const p = db.dbGet('SELECT * FROM themes WHERE id=?', [parent]);
      if (!p) fail('父分类不存在');
      if (id && descendants('theme', id).includes(parent)) fail('不能移入自身或下级分类');
      // V5：层级上限 4 级（与分类树一致）。放服务端校验 —— 前端拦不住直接调接口的情况。
      if (depthOf(parent) + 1 >= MAX_THEME_DEPTH) fail('主题最多 ' + MAX_THEME_DEPTH + ' 级');
    }
    const duplicate = db.dbGet('SELECT id FROM themes WHERE name=? AND COALESCE(parent_id,0)=?', [name, parent || 0]);
    if (duplicate && duplicate.id !== id) fail('同级已有同名分类');
    if (id) db.dbRun('UPDATE themes SET name=?,parent_id=? WHERE id=?', [name, parent, id]);
    else id = Number(db.dbRun('INSERT INTO themes(parent_id,name) VALUES (?,?)', [parent, name]).lastInsertRowid);
    return db.dbGet('SELECT * FROM themes WHERE id=?', [id]);
  });
}
function removeTheme(id, confirm) {
  return db.dbTx(() => {
    const ids = descendants('theme', id);
    if (!ids.length) fail('分类不存在', 404);
    const placeholders = ids.map(() => '?').join(',');
    const links = db.dbGet(`SELECT COUNT(*) n FROM theme_links WHERE theme_id IN (${placeholders})`, ids).n;
    if (!confirm) return { categories: ids.length, links };
    db.dbRun(`DELETE FROM theme_links WHERE theme_id IN (${placeholders})`, ids);
    db.dbRun(`DELETE FROM themes WHERE id IN (${placeholders})`, ids);
    return { ok: true, categories: ids.length, links };
  });
}
function idsInput(ids) {
  if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(Number(id)) || Number(id) <= 0)) fail('分类选择无效');
  return [...new Set(ids.map(Number))];
}
function setThemes(type, id, ids) {
  ensureTarget(type, id);
  ids = idsInput(ids);
  for (const tid of ids) if (!db.dbGet('SELECT id FROM themes WHERE id=?', [tid])) fail('主题不存在');
  db.dbRun('DELETE FROM theme_links WHERE content_type=? AND content_id=?', [type, id]);
  for (const tid of ids) db.dbRun('INSERT INTO theme_links VALUES (?,?,?)', [tid, type, id]);
}
function decorate(ex) {
  return {
    ...ex,
    locatorData: JSON.parse(ex.locator_json || '{}'),
    source: JSON.parse(ex.source_json || '{}'),
    themeIds: db.dbAll("SELECT theme_id FROM theme_links WHERE content_type='excerpt' AND content_id=?", [ex.id]).map((r) => r.theme_id),
    folderIds: db.dbAll('SELECT folder_id FROM excerpt_folder_links WHERE excerpt_id=?', [ex.id]).map((r) => r.folder_id)
  };
}
function contents(id, query = {}) {
  const ids = Number(id) ? (query.include_descendants === 'false' ? [Number(id)] : descendants('theme', Number(id))) : [];
  const types = query.type && query.type !== 'all' ? [query.type] : Object.keys(targets);
  if (types.some((t) => !targets[t])) fail('内容类型无效');
  const rows = [];
  for (const type of types) {
    const all = db.dbAll('SELECT * FROM ' + targets[type] + ' ORDER BY id DESC');
    for (const row of all) {
      const links = db.dbAll('SELECT theme_id FROM theme_links WHERE content_type=? AND content_id=?', [type, row.id]).map((r) => r.theme_id);
      if (Number(id) && !links.some((t) => ids.includes(t))) continue;
      if (query.unclassified === 'true' && links.length) continue;
      const item = type === 'excerpt' ? db.dbGet('SELECT title,module FROM items WHERE id=?', [row.item_id]) : null;
      const title = type === 'excerpt' ? (item?.title || '来源已删除') : row.title;
      const summary = row.text || row.body || row.summary
        || db.dbGet('SELECT plain_text FROM writing_documents WHERE kind=? AND entity_id=?', [type, row.id])?.plain_text || '';
      if (query.q && !(`${title}\n${summary}\n${row.locator || ''}`).toLowerCase().includes(String(query.q).toLowerCase())) continue;
      rows.push(Object.assign({}, row, { content_type: type, title, summary, themeIds: links }));
    }
  }
  rows.sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')) || b.id - a.id);
  return rows;
}

/**
 * 某个主题直接挂载的对象（不做全表扫描，按 theme_links 索引查，小规模下也稳）。
 * limit 默认 50，上限 200 —— 左栏展开时只看个位数，超了也不该一次性拉。
 */
function themeRelations(id, limit) {
  const themeId = Number(id);
  if (!themeId) return { rows: [], total: 0 };
  const take = Math.min(200, Math.max(1, Number(limit) || 50));
  const links = db.dbAll(
    "SELECT content_type, content_id FROM theme_links WHERE theme_id = ? ORDER BY rowid DESC", [themeId]
  );
  const rows = [];
  for (const l of links) {
    const t = targets[l.content_type];
    if (!t) continue;                                  // 对象类型已下线：跳过，不让左栏报错
    const row = db.dbGet('SELECT * FROM ' + t + ' WHERE id = ?', [l.content_id]);
    if (!row) continue;                                 // 对象已删除：静默跳过
    let title = row.title;
    let route = '';
    if (l.content_type === 'excerpt') {
      const item = db.dbGet('SELECT id,title,module FROM items WHERE id=?', [row.item_id]);
      title = (item ? item.title : '来源已删除');
      const m = item ? require('../config/modules').MODULES[item.module] : null;
      route = (m ? m.route : '') + '/' + (item ? item.id : '') + '#excerpt-' + row.id;
    } else {
      const K = { compilation: 'compilations', note: 'notes', idea: 'ideas', historyPaper: 'history-papers' }[l.content_type];
      route = '/writing/' + (K || 'notes') + '/' + row.id;
    }
    rows.push({
      type: l.content_type,
      id: l.content_id,
      title: title || '(无标题)',
      locator: row.locator || '',
      status: row.status || '',
      updated_at: row.updated_at || row.created_at || '',
      route
    });
  }
  rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return { rows: rows.slice(0, take), total: rows.length };
}

/** 主题树的节点计数：每个主题（含后代）挂了多少对象 —— 一次查完，避免前端 N+1 */
function themeCounts() {
  const counts = new Map();
  for (const r of db.dbAll('SELECT theme_id, COUNT(*) n FROM theme_links GROUP BY theme_id')) {
    counts.set(r.theme_id, r.n);
  }
  const rows = listThemes().map((t) => ({ id: t.id, direct: counts.get(t.id) || 0 }));
  // 父级累加后代计数
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parentOf = new Map(listThemes().map((t) => [t.id, t.parent_id]));
  // 带访问标记：脏数据若形成父子环，不能无限递归
  const seen = new Set();
  const roll = (id) => {
    const r = byId.get(id);
    if (!r) return 0;
    if (r.total !== undefined) return r.total;
    if (seen.has(id)) return r.direct;               // 环：只算自己，避免栈溢出
    seen.add(id);
    let sum = r.direct;
    for (const [cid, pid] of parentOf) if (pid === id) sum += roll(cid);
    r.total = sum;
    seen.delete(id);
    return sum;
  };
  for (const t of listThemes()) roll(t.id);
  return rows;
}

module.exports = {
  targets, table, descendants, ensureTarget,
  listFolders, saveFolder, removeFolder, reorderFolder, assignFolders, FOLDER_LINK,
  assignItemFolders, itemFolderIds,
  listThemes, saveTheme, removeTheme, setThemes,
  decorate, contents, themeRelations, themeCounts
};
