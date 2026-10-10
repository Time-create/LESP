const express = require('express');
const db = require('../db');
const { renumber, buildFootnote } = require('../lib/footnote');
const { MODULES } = require('../config/modules');

const router = express.Router();

function nextSeq(compilationId) {
  const r = db.dbGet('SELECT COALESCE(MAX(seq), -1) m FROM compilation_blocks WHERE compilation_id = ?', [compilationId]);
  return r.m + 1;
}

function load(id) {
  const c = db.dbGet('SELECT * FROM compilations WHERE id = ?', [id]);
  if (!c) return null;
  c.blocks = db.dbAll('SELECT * FROM compilation_blocks WHERE compilation_id = ? ORDER BY seq, id', [id]);
  c.refs = db.dbAll('SELECT * FROM compilation_refs WHERE compilation_id = ? ORDER BY seq', [id]);
  let words = 0;
  for (const b of c.blocks) {
    words += ((b.lead || '') + (b.content || '') + (b.quote_text || '') + (b.tail || '')).length;
  }
  c.word_count = words;
  c.quote_count = c.refs.length;
  return c;
}

router.get('/', (req, res) => {
  const rows = db.dbAll('SELECT * FROM compilations ORDER BY updated_at DESC, id DESC');
  const list = rows.map((c) => {
    const n = db.dbGet('SELECT COUNT(*) c FROM compilation_refs WHERE compilation_id = ?', [c.id]).c;
    let words = 0;
    for (const b of db.dbAll('SELECT lead, content, quote_text, tail FROM compilation_blocks WHERE compilation_id = ?', [c.id])) {
      words += ((b.lead || '') + (b.content || '') + (b.quote_text || '') + (b.tail || '')).length;
    }
    return Object.assign({}, c, { ref_count: n, word_count: words });
  });
  res.json(list);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: '长编标题必填' });
  const nowStr = db.now();
  const info = db.dbRun(
    'INSERT INTO compilations (title, project, status, footnote_style, idea_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [String(b.title).trim(), b.project || '', b.status || '进行中', b.footnote_style || 'footer',
     b.idea_id || null, nowStr, nowStr]
  );
  res.json(load(info.lastInsertRowid));
});

router.get('/:id', (req, res) => {
  const c = load(Number(req.params.id));
  if (!c) return res.status(404).json({ error: '长编不存在' });
  res.json(c);
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet('SELECT * FROM compilations WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '长编不存在' });
  const b = req.body || {};
  const style = b.footnote_style === undefined ? row.footnote_style : b.footnote_style;
  if (style !== 'footer' && style !== 'inline') return res.status(400).json({ error: '脚注格式无效' });
  db.dbRun('UPDATE compilations SET title = ?, project = ?, status = ?, footnote_style = ?, updated_at = ? WHERE id = ?',
    [b.title === undefined ? row.title : String(b.title),
     b.project === undefined ? row.project : b.project,
     b.status === undefined ? row.status : b.status,
     style, db.now(), id]);
  if (style !== row.footnote_style) renumber(id);
  res.json(load(id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet('SELECT * FROM compilations WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '长编不存在' });
  db.dbTx(() => {
    db.dbRun('DELETE FROM compilation_refs WHERE compilation_id = ?', [id]);
    db.dbRun('DELETE FROM compilation_blocks WHERE compilation_id = ?', [id]);
    db.dbRun('DELETE FROM compilations WHERE id = ?', [id]);
  });
  res.json({ ok: true });
});

// 可用摘录：按模块分组，供左侧史料抽屉
router.get('/:id/excerpts', (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = db.dbAll(
    'SELECT e.*, i.title item_title, i.module, i.fields FROM excerpts e JOIN items i ON i.id = e.item_id ' +
    (q ? 'WHERE e.text LIKE ? OR e.locator LIKE ? OR i.title LIKE ? ' : '') +
    'ORDER BY i.module, i.title, e.seq LIMIT 400',
    q ? ['%' + q + '%', '%' + q + '%', '%' + q + '%'] : []
  );
  const groups = {};
  for (const r of rows) {
    const key = r.module;
    if (!groups[key]) groups[key] = { module: key, module_name: MODULES[key] ? MODULES[key].name : key, items: [] };
    groups[key].items.push(r);
  }
  res.json(Object.values(groups));
});

// 新增块：type = heading / text / quote / comment
router.post('/:id/blocks', (req, res) => {
  const id = Number(req.params.id);
  const c = db.dbGet('SELECT * FROM compilations WHERE id = ?', [id]);
  if (!c) return res.status(404).json({ error: '长编不存在' });
  const b = req.body || {};
  const type = b.type || 'text';
  if (!['heading', 'text', 'quote', 'comment'].includes(type)) {
    return res.status(400).json({ error: '块类型无效' });
  }

  let excerpt = null;
  let item = null;
  if (type === 'quote') {
    if (!b.excerpt_id) return res.status(400).json({ error: '引用块必须指定摘录' });
    excerpt = db.dbGet('SELECT * FROM excerpts WHERE id = ?', [Number(b.excerpt_id)]);
    if (!excerpt) return res.status(400).json({ error: '摘录不存在' });
    item = db.dbGet('SELECT * FROM items WHERE id = ?', [excerpt.item_id]);
  }

  const seq = b.after_id ? insertAfter(id, Number(b.after_id)) : nextSeq(id);
  const info = db.dbRun(
    'INSERT INTO compilation_blocks (compilation_id, type, content, lead, tail, excerpt_id, quote_text, orphaned, seq) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, type, b.content || '', b.lead || '', b.tail || '',
     excerpt ? excerpt.id : null, excerpt ? excerpt.text : '', 0, seq]
  );
  db.dbRun('UPDATE compilations SET updated_at = ? WHERE id = ?', [db.now(), id]);
  renumber(id);
  res.json(load(id));
});

function insertAfter(compilationId, afterId) {
  const after = db.dbGet('SELECT * FROM compilation_blocks WHERE id = ? AND compilation_id = ?', [afterId, compilationId]);
  const seq = after ? after.seq + 1 : nextSeq(compilationId);
  db.dbRun(
    'UPDATE compilation_blocks SET seq = seq + 1 WHERE compilation_id = ? AND seq >= ?',
    [compilationId, seq]
  );
  return seq;
}

router.put('/:id/blocks/:blockId', (req, res) => {
  const id = Number(req.params.id);
  const blockId = Number(req.params.blockId);
  const b0 = db.dbGet('SELECT * FROM compilation_blocks WHERE id = ? AND compilation_id = ?', [blockId, id]);
  if (!b0) return res.status(404).json({ error: '块不存在' });
  const b = req.body || {};
  db.dbRun('UPDATE compilation_blocks SET content = ?, lead = ?, tail = ? WHERE id = ?',
    [b.content === undefined ? b0.content : b.content,
     b.lead === undefined ? b0.lead : b.lead,
     b.tail === undefined ? b0.tail : b.tail, blockId]);
  db.dbRun('UPDATE compilations SET updated_at = ? WHERE id = ?', [db.now(), id]);
  res.json(load(id));
});

router.delete('/:id/blocks/:blockId', (req, res) => {
  const id = Number(req.params.id);
  const blockId = Number(req.params.blockId);
  const b0 = db.dbGet('SELECT * FROM compilation_blocks WHERE id = ? AND compilation_id = ?', [blockId, id]);
  if (!b0) return res.status(404).json({ error: '块不存在' });
  db.dbTx(() => {
    db.dbRun('DELETE FROM compilation_refs WHERE block_id = ?', [blockId]);
    db.dbRun('DELETE FROM compilation_blocks WHERE id = ?', [blockId]);
  });
  renumber(id);
  db.dbRun('UPDATE compilations SET updated_at = ? WHERE id = ?', [db.now(), id]);
  res.json(load(id));
});

// 上移 / 下移：与相邻块交换 seq 后重排脚注
router.post('/:id/blocks/:blockId/move', (req, res) => {
  const id = Number(req.params.id);
  const blockId = Number(req.params.blockId);
  const dir = (req.body || {}).direction;
  const cur = db.dbGet('SELECT * FROM compilation_blocks WHERE id = ? AND compilation_id = ?', [blockId, id]);
  if (!cur) return res.status(404).json({ error: '块不存在' });

  const blocks = db.dbAll('SELECT * FROM compilation_blocks WHERE compilation_id = ? ORDER BY seq, id', [id]);
  const idx = blocks.findIndex((b) => b.id === blockId);
  const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= blocks.length) return res.json(load(id));

  const other = blocks[swapIdx];
  db.dbTx(() => {
    db.dbRun('UPDATE compilation_blocks SET seq = ? WHERE id = ?', [other.seq, cur.id]);
    db.dbRun('UPDATE compilation_blocks SET seq = ? WHERE id = ?', [cur.seq, other.id]);
  });
  renumber(id);
  db.dbRun('UPDATE compilations SET updated_at = ? WHERE id = ?', [db.now(), id]);
  res.json(load(id));
});

// 灵感一键建长编：带入已关联条目的全部摘录
router.post('/:id/import', (req, res) => {
  const id = Number(req.params.id);
  const c = db.dbGet('SELECT * FROM compilations WHERE id = ?', [id]);
  if (!c) return res.status(404).json({ error: '长编不存在' });
  const itemIds = (req.body || {}).item_ids || [];
  let count = 0;
  for (const itemId of itemIds) {
    const exs = db.dbAll('SELECT * FROM excerpts WHERE item_id = ? ORDER BY seq, id', [Number(itemId)]);
    const item = db.dbGet('SELECT * FROM items WHERE id = ?', [Number(itemId)]);
    if (!item) continue;
    for (const ex of exs) {
      db.dbRun(
        'INSERT INTO compilation_blocks (compilation_id, type, content, lead, tail, excerpt_id, quote_text, orphaned, seq) VALUES (?,?,?,?,?,?,?,?,?)',
        [id, 'quote', '', '', '', ex.id, ex.text, 0, nextSeq(id)]
      );
      count += 1;
    }
  }
  renumber(id);
  res.json(Object.assign({ imported: count }, load(id)));
});

// 导出 Markdown
router.get('/:id/export', (req, res) => {
  const canonical=db.dbGet('SELECT revision,legacy_mode FROM writing_documents WHERE kind=? AND entity_id=?',['compilation',Number(req.params.id)]);
  if(canonical&&!canonical.legacy_mode){const service=require('../services/writing-export'),model=service.collect('compilation',Number(req.params.id),canonical.revision),text=service.markdown(model);if(Object.keys(model.images).length){const zip=new(require('adm-zip'))();zip.addFile('document.md',Buffer.from(text));for(const [id,image]of Object.entries(model.images))zip.addFile('assets/'+id+'.'+image.mime.split('/')[1],Buffer.from(image.data,'base64'));res.attachment('compilation.zip');return res.send(zip.toBuffer());}res.attachment('compilation.md');return res.type('text/markdown').send(text);}

  const id = Number(req.params.id);
  const c = load(id);
  if (!c) return res.status(404).json({ error: '长编不存在' });
  const lines = [];
  lines.push('# ' + c.title);
  if (c.project) lines.push('');
  if (c.project) lines.push('课题：' + c.project);
  lines.push('');
  for (const b of c.blocks) {
    if (b.type === 'heading') {
      lines.push('## ' + b.content);
      lines.push('');
    } else if (b.type === 'quote') {
      const ref = c.refs.find((r) => r.block_id === b.id);
      const mark = ref ? ref.mark : '';
      let line = (b.lead || '') + b.quote_text + (b.tail || '');
      if (c.footnote_style === 'inline' && ref) {
        line += '（' + ref.text + '）';
      } else if (mark) {
        line += mark;
      }
      lines.push(line);
      lines.push('');
    } else if (b.type === 'comment') {
      lines.push('> 按：' + b.content);
      lines.push('');
    } else {
      lines.push(b.content);
      lines.push('');
    }
  }
  if (c.footnote_style === 'footer' && c.refs.length) {
    lines.push('---');
    lines.push('');
    lines.push('## 注释');
    lines.push('');
    for (const r of c.refs) {
      lines.push(r.mark + ' ' + r.text + (r.orphaned ? '（原条目已删除）' : ''));
    }
  }
  const md = lines.join('\n');
  res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(c.title + '.md'));
  res.type('text/markdown').send(md);
});

module.exports = router;
module.exports.load = load;
