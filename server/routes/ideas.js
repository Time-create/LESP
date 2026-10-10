const express = require('express');
const db = require('../db');

const router = express.Router();

const STATUSES = ['念头', '孵化中', '可开题', '已放弃'];

function setLinks(ideaId, links) {
  db.dbRun('DELETE FROM idea_links WHERE idea_id = ?', [ideaId]);
  for (const l of links || []) {
    if (!l || !l.id) continue;
    const type = ['item', 'note', 'compilation'].includes(l.type) ? l.type : 'item';
    db.dbRun('INSERT OR IGNORE INTO idea_links (idea_id, target_type, target_id) VALUES (?,?,?)',
      [ideaId, type, Number(l.id)]);
  }
}

function loadIdea(id) {
  const i = db.dbGet('SELECT * FROM ideas WHERE id = ?', [id]);
  if (!i) return null;
  const links = db.dbAll('SELECT * FROM idea_links WHERE idea_id = ?', [id]);
  let itemCount = 0;
  i.links = links.map((l) => {
    let title = '';
    if (l.target_type === 'item') {
      const it = db.dbGet('SELECT title FROM items WHERE id = ?', [l.target_id]);
      title = it ? it.title : '（条目已删除）';
      itemCount += 1;
    } else if (l.target_type === 'note') {
      const n = db.dbGet('SELECT title FROM notes WHERE id = ?', [l.target_id]);
      title = n ? n.title : '（札记已删除）';
    } else {
      const c = db.dbGet('SELECT title FROM compilations WHERE id = ?', [l.target_id]);
      title = c ? c.title : '（长编已删除）';
    }
    return { type: l.target_type, id: l.target_id, title };
  });
  i.item_count = itemCount;
  return i;
}

router.get('/', (req, res) => {
  const { status } = req.query;
  let rows;
  if (status) {
    rows = db.dbAll('SELECT * FROM ideas WHERE status = ? ORDER BY updated_at DESC', [status]);
  } else {
    rows = db.dbAll('SELECT * FROM ideas ORDER BY updated_at DESC, id DESC');
  }
  res.json(rows.map((r) => loadIdea(r.id)));
});

router.get('/:id', (req, res) => {
  const i = loadIdea(Number(req.params.id));
  if (!i) return res.status(404).json({ error: '灵感不存在' });
  res.json(i);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: '灵感标题必填' });
  const status = STATUSES.includes(b.status) ? b.status : '念头';
  const nowStr = db.now();
  const info = db.dbRun(
    'INSERT INTO ideas (title, summary, status, next_step, idea_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [String(b.title).trim(), b.summary || '', status, b.next_step || '', 0, nowStr, nowStr]
  );
  setLinks(info.lastInsertRowid, b.links || []);
  res.json(loadIdea(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet('SELECT * FROM ideas WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '灵感不存在' });
  const b = req.body || {};
  if (b.status !== undefined && !STATUSES.includes(b.status)) {
    return res.status(400).json({ error: '状态无效' });
  }
  db.dbRun('UPDATE ideas SET title = ?, summary = ?, status = ?, next_step = ?, updated_at = ? WHERE id = ?',
    [b.title === undefined ? row.title : String(b.title),
     b.summary === undefined ? row.summary : b.summary,
     b.status === undefined ? row.status : b.status,
     b.next_step === undefined ? row.next_step : b.next_step,
     db.now(), id]);
  if (b.links) setLinks(id, b.links);
  res.json(loadIdea(id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet('SELECT * FROM ideas WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '灵感不存在' });
  db.dbRun('DELETE FROM idea_links WHERE idea_id = ?', [id]);
  db.dbRun('DELETE FROM ideas WHERE id = ?', [id]);
  res.json({ ok: true });
});

// 一键创建长编：仅「可开题」可用，带入已关联条目的全部摘录
router.post('/:id/convert', (req,res,next)=>{try{res.json(require('../services/conversion').convert(Number(req.params.id)));}catch(e){next(e);}});

module.exports = router;
module.exports.loadIdea = loadIdea;
module.exports.STATUSES = STATUSES;
