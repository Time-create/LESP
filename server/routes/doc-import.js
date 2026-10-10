// 文档导入接口：把 Markdown / Word 解析为编辑器可用的 HTML，脚注转为文末注释（路径 A）。
// 原文件同时存入附件库（无损），正文由前端转成 ProseMirror 文档后保存。
const express = require('express');
const fs = require('node:fs');
const multer = require('multer');
const paths = require('../lib/paths');
const path = require('node:path');
const db = require('../db');
const docImport = require('../services/doc-import');
const store = require('../services/attachment-store');
const decodeUploadName = store.decodeUploadName;

const router = express.Router();
const MAX = 40 * 1024 * 1024;   // 导入文档上限 40MB
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(paths.getDataDir(), 'files', '_incoming');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + path.extname(decodeUploadName(file.originalname)))
  }),
  limits: { fileSize: MAX },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(decodeUploadName(file.originalname) || '').toLowerCase();
    if (!['.md', '.markdown', '.docx'].includes(ext)) return cb(new Error('仅支持 .md 与 .docx'));
    cb(null, true);
  }
}).single('file');

router.post('/parse', upload, (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: '未收到文件' });
  try {
    const parsed = docImport.parse(file.buffer, decodeUploadName(file.originalname), { title: '' });
    res.json({
      ok: true,
      format: parsed.format,
      title: parsed.title || path.basename(decodeUploadName(file.originalname), path.extname(decodeUploadName(file.originalname))),
      html: parsed.html,
      footnotes: parsed.footnotes,
      filename: decodeUploadName(file.originalname)
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 解析并直接建一篇长编/札记（正文写入，原文件存附件）
router.post('/create', upload, (req, res) => {
  const file = req.file;
  const kind = String((req.body || {}).kind || 'note');       // note | compilation | historyPaper
  if (!file) return res.status(400).json({ error: '未收到文件' });
  if (!['note', 'compilation', 'historyPaper'].includes(kind)) return res.status(400).json({ error: '仅支持札记、长编或史学论文' });
  if (file.size > MAX) return res.status(400).json({ error: '文件超过 40MB' });

  let parsed;
  try {
    parsed = docImport.parse(fs.readFileSync(file.path), decodeUploadName(file.originalname), { title: '' });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }

  const title = (req.body || {}).title || parsed.title || path.basename(decodeUploadName(file.originalname), path.extname(decodeUploadName(file.originalname)));
  const now = db.now();
  let id;
  if (kind === 'note') {
    id = Number(db.dbRun('INSERT INTO notes (title, body, created_at, updated_at) VALUES (?,?,?,?)', [title, parsed.html, now, now]).lastInsertRowid);
  } else if (kind === 'historyPaper') {
    id = Number(db.dbRun('INSERT INTO history_papers (title, status, created_at, updated_at) VALUES (?,?,?,?)', [title, '拟写', now, now]).lastInsertRowid);
  } else {
    id = Number(db.dbRun('INSERT INTO compilations (title, status, created_at, updated_at) VALUES (?,?,?,?)', [title, '在写', now, now]).lastInsertRowid);
  }

  // 原文件无损存入附件库
  let attachmentId = null;
  try {
    const stored = store.store({ srcPath: file.path, originalName: decodeUploadName(file.originalname) });
    const info = db.dbRun('INSERT INTO attachments (item_id, filename, rel_path, size, mime, created_at) VALUES (?,?,?,?,?,?)',
      [id, store.safeName(decodeUploadName(file.originalname)), stored.rel, stored.size, file.mimetype || '', now]);
    attachmentId = info.lastInsertRowid;
  } catch (e) {
    // 附件失败不回滚条目，返回警告
  }

  res.json({
    ok: true, id, kind, title,
    html: parsed.html,
    footnotes: parsed.footnotes,
    attachmentId,
    attachmentName: attachmentId ? store.safeName(decodeUploadName(file.originalname)) : null
  });
});

module.exports = router;
