// 分类通用服务：条目分类（collections）与录文分类（excerpt_folders）共用的树逻辑。
// 统一规则：最多四层、禁止同级重名、级联删除、拖拽排序与换父级、归属多选并存。
const MAX_DEPTH = 4;

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};

function childrenMap(db, table) {
  const map = new Map();
  for (const r of db.dbAll(`SELECT id, parent_id FROM ${table}`)) {
    const key = r.parent_id || 0;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r.id);
  }
  return map;
}

/** 节点深度：根为 1；带环保护 */
function depthOf(db, table, id) {
  let depth = 0;
  let cur = id ? db.dbGet(`SELECT * FROM ${table} WHERE id = ?`, [Number(id)]) : null;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    depth += 1;
    if (depth > MAX_DEPTH + 2) break;
    cur = cur.parent_id ? db.dbGet(`SELECT * FROM ${table} WHERE id = ?`, [cur.parent_id]) : null;
  }
  return depth;
}

/** 以某节点为根的整棵子树 id（含自身），后序返回便于逐个删除 */
function subtreeIds(db, table, id) {
  const children = childrenMap(db, table);
  const out = [];
  const stack = [Number(id)];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    for (const child of children.get(cur) || []) stack.push(child);
  }
  return out;
}

/** 子树高度（自身算 1）：移动后判断是否超层用 */
function subtreeHeight(db, table, id) {
  const children = childrenMap(db, table);
  let max = 1;
  const walk = (nid, depth) => {
    if (depth > max) max = depth;
    for (const child of children.get(nid) || []) walk(child, depth + 1);
  };
  walk(Number(id), 1);
  return max;
}

/**
 * 校验挂载位置：父级存在、不可挂到自己或自己的子树、移动后整棵子树不超四层。
 * extra.assertParent(parent) 可附加栏目一致性等校验。
 */
function assertPlacement(db, table, id, parentId, extra) {
  const parent = parentId ? db.dbGet(`SELECT * FROM ${table} WHERE id = ?`, [Number(parentId)]) : null;
  if (parentId && !parent) fail('父分类不存在');
  if (extra && extra.assertParent) extra.assertParent(parent);
  const parentDepth = parentId ? depthOf(db, table, parentId) : 0;
  if (!id) {
    if (parentDepth + 1 > MAX_DEPTH) fail(`分类最多 ${MAX_DEPTH} 级`);
    return parentId || null;
  }
  if (parentId && Number(parentId) === Number(id)) fail('不能移入自身');
  if (parentId && subtreeIds(db, table, id).includes(Number(parentId))) fail('不能移入自身或下级分类');
  if (parentDepth + subtreeHeight(db, table, id) > MAX_DEPTH) fail(`分类最多 ${MAX_DEPTH} 级`);
  return parentId || null;
}

/** 同级重名校验（仅禁止同级同名）；scope 可限定栏目或所属条目 */
function assertSiblingName(db, table, name, parentId, id, scope) {
  let sql = `SELECT id FROM ${table} WHERE name = ? AND COALESCE(parent_id,0) = ?`;
  const params = [name, parentId || 0];
  if (scope && scope.column) {
    sql += ` AND ${scope.column} = ?`;
    params.push(scope.value);
  }
  const dup = db.dbGet(sql, params);
  if (dup && Number(dup.id) !== Number(id || 0)) fail('同级已有同名分类');
}

/** 建树（带业务计数与子节点），按 sort 再按 id 排序 */
function buildTree(db, table, rows, countOf) {
  const byId = new Map();
  for (const row of rows) {
    byId.set(row.id, Object.assign({}, row, { item_count: countOf ? countOf(row) : 0, children: [] }));
  }
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const walk = (list) => {
    list.sort((a, b) => (a.sort - b.sort) || (a.id - b.id));
    for (const n of list) walk(n.children);
  };
  walk(roots);
  return roots;
}

/**
 * 拖拽落位：把 id 挂到 parentId 下，并按 order 重排该父级下的顺序。
 * order 为目标父级下期望的节点顺序（含 id 自身），未列出的兄弟节点保持在后。
 */
function reorder(db, table, id, parentId, order, extra) {
  const moving = subtreeIds(db, table, id);
  return db.dbTx(() => {
    const parent = assertPlacement(db, table, id, parentId, extra);
    // order 为目标父级下期望的顺序（含 id 自身）。
    // 子树其他节点保持原位不动；id 本身按它在 order 中的位置落座。
    const seq = [...new Set((order || []).map(Number).filter(Boolean))];
    let next = 0;
    let mySort = null;
    for (const nid of seq) {
      if (nid === Number(id)) { mySort = next; next += 1; continue; }
      if (moving.includes(nid)) continue;                       // 子树其他节点：跳过，不改父级
      if (Number(nid) === Number(parent || 0)) continue;       // 新父级自身不能成为自己的子节点
      db.dbRun(`UPDATE ${table} SET parent_id = ?, sort = ? WHERE id = ?`, [parent, next++, nid]);
    }
    db.dbRun(`UPDATE ${table} SET parent_id = ?, sort = ? WHERE id = ?`, [parent, mySort === null ? next : mySort, Number(id)]);
    return db.dbGet(`SELECT * FROM ${table} WHERE id = ?`, [Number(id)]);
  });
}

/** 级联删除：删除整棵子树并解除归属，内容本身保留 */
function cascadeRemove(db, table, linkTable, linkColumn, id) {
  const ids = subtreeIds(db, table, id);
  const placeholders = ids.map(() => '?').join(',');
  const links = db.dbGet(`SELECT COUNT(*) n FROM ${linkTable} WHERE ${linkColumn} IN (${placeholders})`, ids).n;
  db.dbTx(() => {
    db.dbRun(`DELETE FROM ${linkTable} WHERE ${linkColumn} IN (${placeholders})`, ids);
    db.dbRun(`DELETE FROM ${table} WHERE id IN (${placeholders})`, ids);
  });
  return { ok: true, categories: ids.length, links };
}

/**
 * 归属增删（多选并存）。link 形如 { table, categoryColumn, ownerColumn }。
 * mode: add（加入） | remove（移出） | set（覆盖为给定集合）
 */
function assign(db, link, ownerId, categoryIds, mode, validateCategory) {
  const ids = [...new Set((categoryIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  for (const cid of ids) {
    if (validateCategory) validateCategory(cid);
  }
  const { table, categoryColumn, ownerColumn } = link;
  db.dbTx(() => {
    if (mode === 'set') {
      db.dbRun(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`, [ownerId]);
      for (const cid of ids) {
        db.dbRun(`INSERT OR IGNORE INTO ${table} (${categoryColumn}, ${ownerColumn}) VALUES (?,?)`, [cid, ownerId]);
      }
      return;
    }
    for (const cid of ids) {
      if (mode === 'remove') {
        db.dbRun(`DELETE FROM ${table} WHERE ${categoryColumn} = ? AND ${ownerColumn} = ?`, [cid, ownerId]);
      } else {
        db.dbRun(`INSERT OR IGNORE INTO ${table} (${categoryColumn}, ${ownerColumn}) VALUES (?,?)`, [cid, ownerId]);
      }
    }
  });
  return { ok: true, count: ids.length, mode: mode || 'add' };
}

module.exports = {
  MAX_DEPTH, fail, childrenMap, depthOf, subtreeIds, subtreeHeight,
  assertPlacement, assertSiblingName, buildTree, reorder, cascadeRemove, assign
};
