// 录文集数据服务：跨条目聚合录文，供「资料库 → 录文」栏目使用。
//
// 设计要点（V5.3）：
// 1) 录文仍存放在 excerpts 表并归属条目（item_id），此处只做「跨条目视图」，
//    不搬数据、不改表结构 —— 条目详情页的录文页签与此处看到的是同一批录文。
// 2) 分类沿用 excerpt_folders / excerpt_folder_links，保留多层结构。
// 3) 分类计数必须区分「直接归类」与「含子分类」两种口径：
//    树上显示的是「该节点及其子树合计」，与用户点开看到的列表一致，
//    否则点进去数量对不上会显得功能坏了。
const db = require('../db');
const taxonomy = require('./taxonomy');
const classification = require('./classification');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

/** 单条录文 → 视图对象（附来源条目、分类标签） */
function decorateExcerpt(row) {
  const item = db.dbGet('SELECT id, module, title, subtitle FROM items WHERE id = ?', [row.item_id]);
  const folders = db.dbAll(
    'SELECT l.folder_id id, f.name name FROM excerpt_folder_links l' +
    ' JOIN excerpt_folders f ON f.id = l.folder_id WHERE l.excerpt_id = ? ORDER BY f.sort, f.id',
    [row.id]
  );
  return {
    id: row.id,
    itemId: row.item_id,
    itemTitle: item ? item.title : '（来源条目已删除）',
    itemModule: item ? item.module : '',
    locator: row.locator || '',
    text: row.text || '',
    comment: row.comment || '',
    updatedAt: row.updated_at || row.created_at || '',
    folderIds: folders.map((f) => f.id),
    folders: folders.map((f) => ({ id: f.id, name: f.name }))
  };
}

/**
 * 查询录文列表。
 * @param {object} query
 *  - folderId:数字 → 该分类及其全部子分类下的录文
 *  - unclassified:'true' → 完全没有归类的录文
 *  - q:关键字（在正文/出处/按语/来源题名中搜）
 *  - limit / offset：分页
 */
function list(query = {}) {
  const limit = Math.min(Number(query.limit) || 200, 500);
  const offset = Number(query.offset) || 0;
  const where = [];
  const params = [];

  if (query.unclassified === 'true') {
    where.push('e.item_id IS NOT NULL');
    where.push('NOT EXISTS (SELECT 1 FROM excerpt_folder_links l WHERE l.excerpt_id = e.id)');
  } else if (query.folderId) {
    // 命中该节点及其整棵子树，与左侧树的计数口径一致
    const ids = classification.subtreeIds(db, 'excerpt_folders', Number(query.folderId));
    if (!ids.length) return { rows: [], total: 0 };
    where.push('EXISTS (SELECT 1 FROM excerpt_folder_links l WHERE l.excerpt_id = e.id AND l.folder_id IN (' +
      ids.map(() => '?').join(',') + '))');
    params.push(...ids);
  }
  if (query.q) {
    where.push('(e.text LIKE ? OR e.locator LIKE ? OR e.comment LIKE ? OR i.title LIKE ?)');
    const like = '%' + String(query.q) + '%';
    params.push(like, like, like, like);
  }

  const base = 'FROM excerpts e LEFT JOIN items i ON i.id = e.item_id' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '');
  const total = db.dbGet('SELECT COUNT(*) n ' + base, params).n;
  const rows = db.dbAll(
    'SELECT e.* ' + base + ' ORDER BY e.updated_at DESC, e.id DESC LIMIT ? OFFSET ?',
    [...params, limit, offset]
  );
  return { rows: rows.map(decorateExcerpt), total };
}

/** 左侧分类树 + 各自计数（含子树合计）、未归类计数 */
function treeWithCounts() {
  const rows = db.dbAll('SELECT * FROM excerpt_folders ORDER BY sort, id');
  // 直接计数：某分类下被直接归类的录文数
  const direct = new Map();
  for (const r of db.dbAll('SELECT folder_id id, COUNT(*) n FROM excerpt_folder_links GROUP BY folder_id')) {
    direct.set(r.id, r.n);
  }
  const tree = classification.buildTree(db, 'excerpt_folders', rows, (row) => direct.get(row.id) || 0);
  // 累加子树：父节点的计数 = 自身 + 所有子节点。
  // buildTree 把计数放在 item_count 上（沿用它的字段名，避免再造一个）。
  const sumUp = (nodes) => {
    let acc = 0;
    for (const n of nodes) {
      n.count = n.item_count || 0;
      n.total = n.count + (n.children ? sumUp(n.children) : 0);
      acc += n.total;
    }
    return acc;
  };
  sumUp(tree);
  const classified = db.dbGet('SELECT COUNT(DISTINCT excerpt_id) n FROM excerpt_folder_links').n;
  const total = db.dbGet('SELECT COUNT(*) n FROM excerpts').n;
  return { tree, total, classified, unclassified: Math.max(0, total - classified) };
}

/** 某条录文当前所属分类 id（卡片改分类时回显） */
function folderIdsOf(excerptId) {
  return db.dbAll('SELECT folder_id id FROM excerpt_folder_links WHERE excerpt_id=? ORDER BY folder_id', [Number(excerptId)])
    .map((r) => r.id);
}

/** 覆盖式设置某条录文的分类（mode=set） */
function setFolders(excerptId, folderIds) {
  const ex = db.dbGet('SELECT id FROM excerpts WHERE id=?', [Number(excerptId)]);
  if (!ex) fail('录文不存在', 404);
  return taxonomy.assignFolders(Number(excerptId), folderIds, 'set');
}

module.exports = { list, treeWithCounts, folderIdsOf, setFolders, decorateExcerpt };
