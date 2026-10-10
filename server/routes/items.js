const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const { syncFts, searchFts } = require('../db');
const { MODULES, isModule } = require('../config/modules');
const { fieldsOf } = require('../config/field-schema');
const paths = require('../lib/paths');
const { purgeSyncTraces } = require('../services/cnki-sync');
const attachmentStore = require('../services/attachment-store');

const router = express.Router();

function parseFields(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function validate(module, title, fields) {
  const errors = [];
  if (!isModule(module)) errors.push('模块类型无效');
  if (!title || !String(title).trim()) errors.push('标题必填');
  for (const f of fieldsOf(module)) {
    if (f.required) {
      const v = fields ? fields[f.key] : null;
      if (v === undefined || v === null || String(v).trim() === '') {
        errors.push(f.label + '必填');
      }
    }
    if (f.type === 'enum' && fields && fields[f.key] && f.options) {
      if (!f.options.includes(String(fields[f.key]))) {
        errors.push(f.label + '取值无效');
      }
    }
  }
  return errors;
}

function defaultStatus(module) {
  const m = MODULES[module];
  return m && m.statuses.length ? m.statuses[0] : '';
}

function setCollections(itemId, names) {
  const module = db.dbGet('SELECT module FROM items WHERE id = ?', [itemId]).module;
  db.dbRun('DELETE FROM collection_items WHERE item_id = ?', [itemId]);
  for (const n of names) {
    const name = String(n).trim();
    if (!name) continue;
    let c = db.dbGet('SELECT * FROM collections WHERE module = ? AND name = ?', [module, name]);
    if (!c) {
      const info = db.dbRun('INSERT INTO collections (module, name, parent_id) VALUES (?,?,NULL)', [module, name]);
      c = { id: info.lastInsertRowid };
    }
    db.dbRun('INSERT OR IGNORE INTO collection_items (collection_id, item_id) VALUES (?,?)', [c.id, itemId]);
  }
}

function setTags(itemId, names) {
  db.dbRun('DELETE FROM item_tags WHERE item_id = ?', [itemId]);
  for (const n of names) {
    const name = String(n).trim();
    if (!name) continue;
    let t = db.dbGet('SELECT * FROM tags WHERE name = ?', [name]);
    if (!t) {
      const info = db.dbRun('INSERT INTO tags (name) VALUES (?)', [name]);
      t = { id: info.lastInsertRowid };
    }
    db.dbRun('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?,?)', [itemId, t.id]);
  }
}

function loadItem(id) {
  const row = db.dbGet('SELECT * FROM items WHERE id = ?', [id]);
  if (!row) return null;
  const item = Object.assign({}, row, { fields: parseFields(row.fields) });
  item.excerpts = db.dbAll('SELECT * FROM excerpts WHERE item_id = ? ORDER BY seq, id', [id]);
  item.attachments = db.dbAll('SELECT * FROM attachments WHERE item_id = ? ORDER BY id', [id]);
  item.collections = db.dbAll(
    'SELECT c.* FROM collections c JOIN collection_items ci ON ci.collection_id = c.id WHERE ci.item_id = ?',
    [id]
  );
  item.tags = db.dbAll(
    'SELECT t.* FROM tags t JOIN item_tags it ON it.tag_id = t.id WHERE it.item_id = ?',
    [id]
  );
  return item;
}

router.get('/', (req, res) => {
  const { module, collection, tag, status, q, page = '1', size = '50' } = req.query;
  const where = [];
  const params = [];

  if (module) {
    if (!isModule(module)) return res.status(400).json({ error: '模块类型无效' });
    where.push('i.module = ?');
    params.push(module);
  }
  if (collection) {
    // classification：默认含子分类；classification_exact=1 时只看本分类
    const C = require('../services/classification');
    const ids = String(req.query.classification_exact || '') === '1'
      ? [Number(collection)]
      : C.subtreeIds(db, 'collections', Number(collection));
    where.push('EXISTS (SELECT 1 FROM collection_items ci WHERE ci.item_id = i.id AND ci.collection_id IN (' + ids.map(() => '?').join(',') + '))');
    params.push(...ids);
  }
  if (tag) {
    where.push('EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = i.id AND it.tag_id = ?)');
    params.push(Number(tag));
  }
  if (status) {
    where.push('i.status = ?');
    params.push(status);
  }
  if (q && String(q).trim()) {
    const ids = searchFts(String(q).trim());
    if (ids.length === 0) return res.json({ items: [], total: 0, page: Number(page), size: Number(size) });
    where.push('i.id IN (' + ids.map(() => '?').join(',') + ')');
    params.push(...ids);
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(200, Math.max(1, Number(size) || 50));
  const total = db.dbGet('SELECT COUNT(*) c FROM items i ' + whereSql, params).c;
  const rows = db.dbAll(
    'SELECT i.* FROM items i ' + whereSql + ' ORDER BY i.updated_at DESC, i.id DESC LIMIT ? OFFSET ?',
    params.concat([s, (p - 1) * s])
  );
  const items = rows.map((r) => {
    const o = Object.assign({}, r, { fields: parseFields(r.fields) });
    o.excerpt_count = db.dbGet('SELECT COUNT(*) c FROM excerpts WHERE item_id = ?', [r.id]).c;
    o.attachment_count = db.dbGet('SELECT COUNT(*) c FROM attachments WHERE item_id = ?', [r.id]).c;
    return o;
  });
  res.json({ items, total, page: p, size: s });
});

router.get('/:id', (req, res) => {
  const item = loadItem(Number(req.params.id));
  if (!item) return res.status(404).json({ error: '条目不存在' });
  res.json(item);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const fields = b.fields || {};
  const errors = validate(b.module, b.title, fields);
  if (errors.length) return res.status(400).json({ error: errors.join('；') });

  const nowStr = db.now();
  let id;
  db.dbTx(() => {
    const info = db.dbRun(
      'INSERT INTO items (module, title, subtitle, status, fields, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      [b.module, String(b.title).trim(), b.subtitle || '', b.status || defaultStatus(b.module),
       JSON.stringify(fields), nowStr, nowStr]
    );
    id = info.lastInsertRowid;
    setCollections(id, b.collections || []);
    setTags(id, b.tags || []);
  });
  syncFts(id);
  res.json(loadItem(id));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet('SELECT * FROM items WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '条目不存在' });
  const b = req.body || {};
  const module = b.module || row.module;
  const title = b.title === undefined ? row.title : b.title;
  const fields = b.fields === undefined ? parseFields(row.fields) : b.fields;
  const errors = validate(module, title, fields);
  if (errors.length) return res.status(400).json({ error: errors.join('；') });

  const nowStr = db.now();
  db.dbTx(() => {
    db.dbRun(
      'UPDATE items SET module = ?, title = ?, subtitle = ?, status = ?, fields = ?, updated_at = ? WHERE id = ?',
      [module, String(title).trim(), b.subtitle === undefined ? row.subtitle : b.subtitle,
       b.status === undefined ? row.status : b.status, JSON.stringify(fields), nowStr, id]
    );
    if (b.collections) setCollections(id, b.collections);
    if (b.tags) setTags(id, b.tags);
  });
  syncFts(id);
  res.json(loadItem(id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet('SELECT * FROM items WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '条目不存在' });

  const refs = db.dbGet('SELECT COUNT(*) c FROM compilation_refs WHERE item_id = ?', [id]).c;
  const atts = db.dbAll('SELECT * FROM attachments WHERE item_id = ?', [id]);
  let trashed = 0;
  for (const a of atts) {
    const src = attachmentStore.resolveAttachment(a.rel_path);   // 兼容历史基准
    if (fs.existsSync(src)) {
      const dest = path.join(paths.trashDir(), String(id) + '-' + path.basename(a.rel_path));
      try {
        fs.renameSync(src, dest);
        trashed += 1;
      } catch (e) {
        // 跨卷/文件被占用时复制到回收站，并删除源文件：
        // 否则源文件会变成“不在数据库、又被备份排除”的孤儿，存在丢失风险
        try {
          fs.copyFileSync(src, dest);
          fs.unlinkSync(src);
          trashed += 1;
        } catch (e2) {
          console.warn('附件移入回收站失败（文件可能正被占用）：' + a.rel_path + ' → ' + e2.message);
        }
      }
    }
  }

  db.dbTx(() => {
    db.dbRun('UPDATE compilation_refs SET orphaned = 1 WHERE item_id = ?', [id]);
    db.dbRun(
      'UPDATE compilation_blocks SET orphaned = 1 WHERE id IN (SELECT block_id FROM compilation_refs WHERE item_id = ?)',
      [id]
    );
    db.dbRun('DELETE FROM excerpts WHERE item_id = ?', [id]);
    db.dbRun('DELETE FROM attachments WHERE item_id = ?', [id]);
    db.dbRun('DELETE FROM collection_items WHERE item_id = ?', [id]);
    db.dbRun('DELETE FROM item_tags WHERE item_id = ?', [id]);
    db.dbRun('DELETE FROM note_links WHERE target_type = ? AND target_id = ?', ['item', id]);
    db.dbRun('DELETE FROM idea_links WHERE target_type = ? AND target_id = ?', ['item', id]);
    db.dbRun('DELETE FROM items WHERE id = ?', [id]);
    db.dbRun('DELETE FROM items_fts WHERE rowid = ?', [id]);
    // 知网同步痕迹一并清除：否则去重会因留档仍在而永远“已存在，跳过”
    purgeSyncTraces(db, row);
  });

  res.json({ ok: true, orphanedRefs: refs, trashedAttachments: trashed });
});

module.exports = router;
module.exports.loadItem = loadItem;
module.exports.validate = validate;
module.exports.setTags = setTags;
module.exports.setCollections = setCollections;
