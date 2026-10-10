const express = require('express');
const db = require('../db');
const { searchFts } = require('../db');
const { MODULES } = require('../config/modules');

const router = express.Router();

// 全局检索：命中条目与其匹配的摘录片段
router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ items: [], total: 0 });
  const module = req.query.module;
  const ids = searchFts(q);
  if (ids.length === 0) return res.json({ items: [], total: 0 });

  const ph = ids.map(() => '?').join(',');
  const params = ids.slice();
  let sql = 'SELECT * FROM items WHERE id IN (' + ph + ')';
  if (module && MODULES[module]) {
    sql += ' AND module = ?';
    params.push(module);
  }
  const rows = db.dbAll(sql, params);

  const items = rows.map((r) => {
    const excerpts = db.dbAll('SELECT * FROM excerpts WHERE item_id = ? ORDER BY seq, id', [r.id]);
    const hitExcerpts = excerpts.filter((e) => (e.text || '').includes(q) || (e.comment || '').includes(q) || (e.locator || '').includes(q));
    return Object.assign({}, r, {
      fields: (() => { try { return JSON.parse(r.fields || '{}'); } catch (e) { return {}; } })(),
      module_name: MODULES[r.module] ? MODULES[r.module].name : r.module,
      excerpt_count: excerpts.length,
      hit_excerpts: hitExcerpts
    });
  });

  res.json({ items, total: items.length, query: q });
});

module.exports = router;
