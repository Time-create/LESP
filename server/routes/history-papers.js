// 史学论文 CRUD。与史料长编同构，但不含长编的 blocks/refs 旧结构
// （正文统一存 writing_documents，按 kind='historyPaper' 区分）。
const express = require('express');
const db = require('../db');

const router = express.Router();

const TABLE = 'history_papers';
const STATUSES = ['拟写', '写作中', '已完稿', '已发表'];

function load(id) {
  const row = db.dbGet(`SELECT * FROM ${TABLE} WHERE id = ?`, [id]);
  if (!row) return null;
  // 字数与引用数取自统一文档表
  const doc = db.dbGet("SELECT plain_text, content_json FROM writing_documents WHERE kind='historyPaper' AND entity_id=?", [id]);
  row.word_count = doc && doc.plain_text ? doc.plain_text.length : 0;
  row.quote_count = doc
    ? db.dbGet('SELECT COUNT(*) c FROM writing_citations WHERE document_id=(SELECT id FROM writing_documents WHERE kind=? AND entity_id=?) AND active=1', ['historyPaper', id]).c
    : 0;
  return row;
}

router.get('/', (req, res) => {
  const rows = db.dbAll(`SELECT * FROM ${TABLE} ORDER BY updated_at DESC, id DESC`);
  res.json(rows.map((r) => load(r.id)));
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: '论文标题必填' });
  const status = b.status || '拟写';
  if (!STATUSES.includes(status)) return res.status(400).json({ error: '状态无效' });
  const nowStr = db.now();
  const info = db.dbRun(
    `INSERT INTO ${TABLE} (title, project, status, footnote_style, idea_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    [String(b.title).trim(), b.project || '', status, b.footnote_style || 'footer', b.idea_id || null, nowStr, nowStr]
  );
  res.json(load(info.lastInsertRowid));
});

router.get('/:id', (req, res) => {
  const row = load(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '史学论文不存在' });
  res.json(row);
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet(`SELECT * FROM ${TABLE} WHERE id = ?`, [id]);
  if (!row) return res.status(404).json({ error: '史学论文不存在' });
  const b = req.body || {};
  const style = b.footnote_style === undefined ? row.footnote_style : b.footnote_style;
  if (style !== 'footer' && style !== 'inline') return res.status(400).json({ error: '脚注格式无效' });
  if (b.status !== undefined && !STATUSES.includes(b.status)) return res.status(400).json({ error: '状态无效' });
  const title = b.title === undefined ? row.title : String(b.title).trim();
  if (!title) return res.status(400).json({ error: '论文标题必填' });
  db.dbRun(
    `UPDATE ${TABLE} SET title = ?, project = ?, status = ?, footnote_style = ?, updated_at = ? WHERE id = ?`,
    [title, b.project === undefined ? row.project : b.project,
     b.status === undefined ? row.status : b.status, style, db.now(), id]
  );
  res.json(load(id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet(`SELECT * FROM ${TABLE} WHERE id = ?`, [id]);
  if (!row) return res.status(404).json({ error: '史学论文不存在' });
  db.dbTx(() => {
    // 统一文档表由 writing 服务维护，这里只清关联与本体
    db.dbRun(`DELETE FROM theme_links WHERE content_type='historyPaper' AND content_id=?`, [id]);
    db.dbRun(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
  });
  res.json({ ok: true });
});

// 同时导出 load，供视图层取列表/详情（与 compilations.js 的导出约定一致）

// 导出 Markdown（与长编同构：优先走统一文档，含图片时打包 zip）
router.get('/:id/export', (req, res) => {
  const id = Number(req.params.id);
  const row = db.dbGet('SELECT id FROM history_papers WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '史学论文不存在' });
  const doc = db.dbGet("SELECT revision, legacy_mode FROM writing_documents WHERE kind='historyPaper' AND entity_id=?", [id]);
  if (doc && !doc.legacy_mode) {
    const service = require('../services/writing-export');
    const model = service.collect('historyPaper', id, doc.revision);
    const text = service.markdown(model);
    if (Object.keys(model.images).length) {
      const zip = new (require('adm-zip'))();
      zip.addFile('document.md', Buffer.from(text));
      for (const [rid, image] of Object.entries(model.images)) zip.addFile('assets/' + rid + '.' + image.mime.split('/')[1], Buffer.from(image.data, 'base64'));
      res.attachment('history-paper.zip');
      return res.send(zip.toBuffer());
    }
    res.attachment('history-paper.md');
    return res.type('text/markdown').send(text);
  }
  // 尚无正文时给出一份仅含标题的骨架
  const p2 = load(id);
  res.attachment('history-paper.md');
  res.type('text/markdown').send('# ' + p2.title + '\n');
});

module.exports = router;
module.exports.load = load;
