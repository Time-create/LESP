const express = require('express');
const db = require('../db');

const router = express.Router();

// links: [{type:'item'|'compilation', id}]
function setLinks(noteId, links) {
  db.dbRun('DELETE FROM note_links WHERE note_id = ?', [noteId]);
  for (const l of links || []) {
    if (!l || !l.id) continue;
    const type = l.type === 'compilation' ? 'compilation' : 'item';
    db.dbRun('INSERT OR IGNORE INTO note_links (note_id, target_type, target_id) VALUES (?,?,?)',
      [noteId, type, Number(l.id)]);
  }
}

function loadNote(id) {
  const n = db.dbGet('SELECT * FROM notes WHERE id = ?', [id]);
  if (!n) return null;
  n.links = db.dbAll('SELECT * FROM note_links WHERE note_id = ?', [id]).map((l) => {
    let title = '';
    if (l.target_type === 'item') {
      const it = db.dbGet('SELECT title, module FROM items WHERE id = ?', [l.target_id]);
      title = it ? it.title : '（条目已删除）';
    } else {
      const c = db.dbGet('SELECT title FROM compilations WHERE id = ?', [l.target_id]);
      title = c ? c.title : '（长编已删除）';
    }
    return { type: l.target_type, id: l.target_id, title };
  });
  return n;
}

router.get('/', (req, res) => {
  const { target_type, target_id, q } = req.query;
  let rows;
  if (target_type && target_id) {
    rows = db.dbAll(
      'SELECT n.* FROM notes n JOIN note_links l ON l.note_id = n.id WHERE l.target_type = ? AND l.target_id = ? ORDER BY n.updated_at DESC',
      [target_type, Number(target_id)]
    );
  } else {
    rows = db.dbAll('SELECT * FROM notes ORDER BY updated_at DESC, id DESC');
  }
  if (q && String(q).trim()) {
    const kw = String(q).trim().toLowerCase();
    rows = rows.filter((r) => (r.title || '').toLowerCase().includes(kw) || (r.body || '').toLowerCase().includes(kw));
  }
  res.json(rows.map((r) => loadNote(r.id)));
});

router.get('/:id', (req, res) => {
  const n = loadNote(Number(req.params.id));
  if (!n) return res.status(404).json({ error: '札记不存在' });
  res.json(n);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: '札记标题必填' });
  const nowStr = db.now();
  const info = db.dbRun('INSERT INTO notes (title, body, created_at, updated_at) VALUES (?,?,?,?)',
    [String(b.title).trim(), b.body || '', nowStr, nowStr]);
  setLinks(info.lastInsertRowid, b.links || []);
  res.json(loadNote(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet('SELECT * FROM notes WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '札记不存在' });
  const b = req.body || {};
  db.dbRun('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?',
    [b.title === undefined ? row.title : String(b.title),
     b.body === undefined ? row.body : b.body, db.now(), id]);
  if (b.links) setLinks(id, b.links);
  res.json(loadNote(id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet('SELECT * FROM notes WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '札记不存在' });
  db.dbTx(() => {
    db.dbRun('DELETE FROM note_links WHERE note_id = ?', [id]);
    db.dbRun('DELETE FROM idea_links WHERE target_type = ? AND target_id = ?', ['note', id]);
    db.dbRun('DELETE FROM notes WHERE id = ?', [id]);
  });
  res.json({ ok: true });
});

module.exports = router;
module.exports.loadNote = loadNote;
