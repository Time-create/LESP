const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.dbAll('SELECT * FROM tags ORDER BY id');
  const list = rows.map((t) => {
    const count = db.dbGet('SELECT COUNT(*) c FROM item_tags WHERE tag_id = ?', [t.id]).c;
    return Object.assign({}, t, { item_count: count });
  });
  res.json(list);
});

router.post('/', (req, res) => {
  const name = String(((req.body || {}).name) || '').trim();
  if (!name) return res.status(400).json({ error: '标签名必填' });
  const exist = db.dbGet('SELECT * FROM tags WHERE name = ?', [name]);
  if (exist) return res.json(exist);
  const info = db.dbRun('INSERT INTO tags (name) VALUES (?)', [name]);
  res.json(db.dbGet('SELECT * FROM tags WHERE id = ?', [info.lastInsertRowid]));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet('SELECT * FROM tags WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '标签不存在' });
  db.dbTx(() => {
    db.dbRun('DELETE FROM item_tags WHERE tag_id = ?', [id]);
    db.dbRun('DELETE FROM tags WHERE id = ?', [id]);
  });
  res.json({ ok: true });
});

module.exports = router;
