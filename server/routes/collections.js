const express = require('express');
const db = require('../db');
const { isClassifyModule, CLASSIFY_MODULES } = require('../config/modules');
const classification = require('../services/classification');

const router = express.Router();

// 归属目标：条目（items）或写作类（compilations / notes），各自一张关联表
function linkOf(target) {
  if (target === 'compilation' || target === 'note') {
    const m = CLASSIFY_MODULES[target];
    return { table: m.link, categoryColumn: 'collection_id', ownerColumn: m.linkColumn, table_: m.table };
  }
  return { table: 'collection_items', categoryColumn: 'collection_id', ownerColumn: 'item_id', table_: 'items' };
}

function mustClassifyModule(value) {
  if (!isClassifyModule(value)) throw Object.assign(new Error('模块类型无效'), { status: 400 });
  return value;
}

function sameModuleGuard(module) {
  return (parent) => {
    if (parent && parent.module !== module) {
      throw Object.assign(new Error('分类不能跨栏目移动'), { status: 400 });
    }
  };
}

// 分类树（含归属数）；?tree=1 返回嵌套结构
router.get('/', (req, res) => {
  const { module } = req.query;
  const params = [];
  let sql = 'SELECT * FROM collections';
  if (module) {
    mustClassifyModule(module);
    sql += ' WHERE module = ?';
    params.push(module);
  }
  sql += ' ORDER BY sort, id';
  const rows = db.dbAll(sql, params);
  const countOf = (row) => db.dbGet(`SELECT COUNT(*) c FROM ${linkOf(req.query.target || 'item').table} WHERE collection_id = ?`, [row.id]).c;
  res.json(req.query.tree === '1'
    ? classification.buildTree(db, 'collections', rows, countOf)
    : rows.map((r) => Object.assign({}, r, { item_count: countOf(r) })));
});

router.post('/', (req, res) => {
  const b = req.body || {};
  mustClassifyModule(b.module);
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: '分类名必填' });
  const created = db.dbTx(() => {
    const parentId = classification.assertPlacement(db, 'collections', null, b.parent_id || null, { assertParent: sameModuleGuard(b.module) });
    classification.assertSiblingName(db, 'collections', name, parentId, 0, { column: 'module', value: b.module });
    const maxSort = db.dbGet(
      'SELECT COALESCE(MAX(sort),-1) m FROM collections WHERE module = ? AND COALESCE(parent_id,0) = ?',
      [b.module, parentId || 0]
    ).m;
    const description = String(b.description || '').trim().slice(0, 500);
    const info = db.dbRun('INSERT INTO collections (module, name, description, parent_id, sort) VALUES (?,?,?,?,?)',
      [b.module, name, description, parentId, maxSort + 1]);
    return db.dbGet('SELECT * FROM collections WHERE id = ?', [info.lastInsertRowid]);
  });
  res.json(created);
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet('SELECT * FROM collections WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '分类不存在' });
  const b = req.body || {};
  const name = b.name === undefined ? row.name : String(b.name).trim();
  if (!name) return res.status(400).json({ error: '分类名必填' });
  const updated = db.dbTx(() => {
    const parentId = b.parent_id === undefined
      ? row.parent_id
      : classification.assertPlacement(db, 'collections', id, b.parent_id, { assertParent: sameModuleGuard(row.module) });
    classification.assertSiblingName(db, 'collections', name, parentId, id, { column: 'module', value: row.module });
    const description = b.description === undefined ? row.description : String(b.description || '').trim().slice(0, 500);
    db.dbRun('UPDATE collections SET name = ?, description = ?, parent_id = ? WHERE id = ?', [name, description, parentId, id]);
    return db.dbGet('SELECT * FROM collections WHERE id = ?', [id]);
  });
  res.json(updated);
});

// 拖拽落位：换父级与同级排序一次提交
router.post('/reorder', (req, res) => {
  const b = req.body || {};
  const id = Number(b.id);
  const row = db.dbGet('SELECT * FROM collections WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '分类不存在' });
  res.json(classification.reorder(db, 'collections', id, b.parent_id || null, b.order || [], {
    assertParent: sameModuleGuard(row.module)
  }));
});

// 删除影响预览：先告诉用户会删几个分类、解除几条归类
router.get('/:id/impact', (req, res) => {
  const id = Number(req.params.id);
  if (!db.dbGet('SELECT id FROM collections WHERE id = ?', [id])) return res.status(404).json({ error: '分类不存在' });
  const ids = classification.subtreeIds(db, 'collections', id);
  const link = linkOf(String((req.query || {}).target || 'item'));
  const links = db.dbGet(`SELECT COUNT(*) n FROM ${link.table} WHERE ${link.categoryColumn} IN (${ids.map(() => '?').join(',')})`, ids).n;
  res.json({ categories: ids.length, links });
});

// 级联删除：子树一并删除，归属只解除、内容保留
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet('SELECT * FROM collections WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '分类不存在' });
  const target = String((req.query || {}).target || 'item');
  const link = linkOf(target);
  res.json(classification.cascadeRemove(db, 'collections', link.table, link.categoryColumn, id));
});

/**
 * 归属增删：{ target: item|compilation|note, owner_id, collection_ids, mode: add|remove|set }
 * 也支持旧的 item_id + /:id/items 形式。
 */
router.post('/assign', (req, res) => {
  const b = req.body || {};
  const target = b.target || (b.compilation_id ? 'compilation' : b.note_id ? 'note' : 'item');
  const link = linkOf(target);
  const ownerId = Number(b.owner_id || b.item_id || b.compilation_id || b.note_id);
  const owner = db.dbGet(`SELECT * FROM ${link.table_} WHERE id = ?`, [ownerId]);
  if (!owner) return res.status(404).json({ error: '对象不存在' });
  const module = target === 'item' ? owner.module : target;
  const ids = Array.isArray(b.collection_ids) ? b.collection_ids : [];
  for (const cid of ids) {
    const row = db.dbGet('SELECT * FROM collections WHERE id = ?', [Number(cid)]);
    if (!row) return res.status(404).json({ error: '分类不存在：' + cid });
    if (row.module !== module) return res.status(400).json({ error: '不能把对象归入其他栏目的分类' });
  }
  res.json(classification.assign(db, link, ownerId, ids, b.mode || 'add'));
});

// 某对象的分类归属（详情页回显）
router.get('/assign', (req, res) => {
  const target = String(req.query.target || 'item');
  const link = linkOf(target);
  const ownerId = Number(req.query.owner_id || req.query.item_id);
  res.json(db.dbAll(`SELECT collection_id id FROM ${link.table} WHERE ${link.ownerColumn} = ? ORDER BY collection_id`, [ownerId]).map((r) => r.id));
});

// 条目加入分类（一个条目可属于多个分类）
router.post('/:id/items', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet('SELECT * FROM collections WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '分类不存在' });
  const itemId = Number((req.body || {}).item_id);
  const item = db.dbGet('SELECT * FROM items WHERE id = ?', [itemId]);
  if (!item) return res.status(404).json({ error: '条目不存在' });
  if (item.module !== row.module) return res.status(400).json({ error: '条目与分类不属于同一栏目' });
  res.json(classification.assign(db, linkOf('item'), itemId, [id], 'add'));
});

router.delete('/:id/items/:itemId', (req, res) => {
  res.json(classification.assign(db, linkOf('item'), Number(req.params.itemId), [Number(req.params.id)], 'remove'));
});

module.exports = router;
