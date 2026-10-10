// 回收站：data/files/_trash 的列表 / 还原 / 彻底删除。
// 文件名规则：删除条目/附件时按 `<itemId>-<原名>` 移入，还原时可据此找回所属条目。
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const paths = require('../lib/paths');
const store = require('../services/attachment-store');

const router = express.Router();

function trashDir() { return paths.trashDir(); }

// 只允许纯文件名，杜绝路径遍历
function safeBase(name) {
  const base = path.basename(String(name || ''));
  if (!base || base.includes('/') || base.includes('\\') || base.startsWith('.')) return null;
  return base;
}

router.get('/', (req, res) => {
  const dir = trashDir();
  let files = [];
  try {
    files = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const st = fs.statSync(path.join(dir, e.name));
        return { name: e.name, size: st.size, deletedAt: st.mtime.toISOString() };
      })
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  } catch (e) { /* 目录不存在等：返回空列表 */ }
  res.json({ files, dir });
});

// 还原：移回统一附件目录；若文件名前缀能对上现存条目，自动重新挂为该条目的附件
router.post('/restore', (req, res) => {
  const base = safeBase((req.body || {}).name);
  if (!base) return res.status(400).json({ error: '文件名非法' });
  const src = path.join(trashDir(), base);
  if (!fs.existsSync(src)) return res.status(404).json({ error: '回收站里没有这个文件' });

  // 前缀 itemId 用于找回原条目（删除时按 `<itemId>-<原名>` 命名）
  const m = base.match(/^(\d+)-(.+)$/);
  const itemId = m ? Number(m[1]) : null;
  const originalName = m ? m[2] : base;
  const item = itemId ? db.dbGet('SELECT id FROM items WHERE id = ?', [itemId]) : null;

  let stored = null;
  try {
    stored = store.store({ srcPath: src, originalName });
    let attachmentId = null;
    if (item) {
      const info = db.dbRun('INSERT INTO attachments (item_id, filename, rel_path, size, mime, created_at) VALUES (?,?,?,?,?,?)',
        [item.id, store.safeName(originalName), stored.rel, stored.size, 'application/octet-stream', db.now()]);
      attachmentId = info.lastInsertRowid;
    }
    // 记录写成功后才移除回收站中的副本；若这一步失败，最多留下两份副本（安全）
    try { fs.unlinkSync(src); } catch (e) { console.warn('回收站副本未清除：' + base + ' → ' + e.message); }
    require('../services/cnki-sync').log(`回收站还原：${base} → ${stored.rel}` + (item ? `（挂回条目 ${item.id}）` : '（未找到原条目，仅还原文件）'));
    res.json({ ok: true, attachmentId, itemId: item ? item.id : null, rel: stored.rel });
  } catch (e) {
    // 写库失败：回滚已复制出的文件，避免出现“无数据库记录的孤儿文件”
    if (stored && stored.abs) { try { fs.unlinkSync(stored.abs); } catch (e2) { /* 忽略 */ } }
    res.status(500).json({ error: '还原失败：' + e.message });
  }
});

// 彻底删除
router.delete('/:name', (req, res) => {
  const base = safeBase(req.params.name);
  if (!base) return res.status(400).json({ error: '文件名非法' });
  const src = path.join(trashDir(), base);
  if (!fs.existsSync(src)) return res.status(404).json({ error: '回收站里没有这个文件' });
  fs.unlinkSync(src);
  require('../services/cnki-sync').log(`回收站彻底删除：${base}`);
  res.json({ ok: true });
});

module.exports = router;
