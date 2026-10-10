const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const db = require('../db');
const paths = require('../lib/paths');

const router = express.Router();

const ALLOWED_EXT = ['.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.tif'];
const EXT_LABEL = 'PDF / JPG / PNG / TIFF';

function maxBytes() {
  const row = db.dbGet("SELECT value FROM settings WHERE key = 'max_attachment_mb'");
  const mb = row ? Number(row.value) : 200;
  // 必须取整：multer 截断后的文件大小为 floor(limit)，
  // 若 limit 是小数则「实际大小 >= 上限」的截断判定会失效。
  return Math.floor((Number.isFinite(mb) && mb > 0 ? mb : 200) * 1024 * 1024);
}

const store = require('../services/attachment-store');
const decodeUploadName = store.decodeUploadName;
const safeName = store.safeName;

// 上传先落在系统临时目录，随后统一复制到 attachments 目录：
// 这样前端拿到的文件不再依赖任何外部原始路径（下载文件夹里的原件删了也能打开）。
function uploadFor(itemId, dir) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + '-' + safeName(decodeUploadName(file.originalname)));
    }
  });
  return multer({
    storage,
    limits: { fileSize: maxBytes() },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(decodeUploadName(file.originalname) || '').toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) {
        return cb(new Error('仅支持 ' + EXT_LABEL));
      }
      cb(null, true);
    }
  });
}

router.post('/upload', (req, res) => {
  const itemId = Number(req.query.item_id || req.body.item_id);
  const item = db.dbGet('SELECT * FROM items WHERE id = ?', [itemId]);
  if (!item) return res.status(404).json({ error: '条目不存在' });

  // 先落到临时目录，校验通过后再复制进统一附件目录
  const dir = path.join(paths.attachmentsDir(), '_incoming');
  const upload = uploadFor(itemId, dir);
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? '单文件超过 ' + Math.round(maxBytes() / 1024 / 1024) + ' MB，请压缩后再传'
        : (err.message || '上传失败');
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: '未收到文件' });

    // multer 在超出 fileSize 时会静默截断文件而不报错（truncated 标志也未可靠传递），
    // 必须用落盘大小与上限比对来判定截断，否则会存下一个被截坏的附件。
    const limit = maxBytes();
    const actual = fs.existsSync(req.file.path) ? fs.statSync(req.file.path).size : req.file.size;
    if (req.file.truncated === true || actual >= limit) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* 忽略 */ }
      return res.status(400).json({
        error: '单文件超过 ' + Math.round(maxBytes() / 1024 / 1024 * 1000) / 1000 + ' MB，请压缩后再传'
      });
    }

    // 复制进统一附件目录（原件留在临时区，随后清理）
    const originalName = decodeUploadName(req.file.originalname);
    let stored;
    try {
      stored = store.store({ srcPath: req.file.path, originalName });
    } catch (e) {
      return res.status(500).json({ error: '保存附件失败：' + e.message });
    }
    try { fs.unlinkSync(req.file.path); } catch (e) { /* 临时文件清理失败不影响主流程 */ }

    const info = db.dbRun(
      'INSERT INTO attachments (item_id, filename, rel_path, size, mime, created_at) VALUES (?,?,?,?,?,?)',
      [itemId, safeName(originalName), stored.rel, stored.size, req.file.mimetype || '', db.now()]
    );
    db.dbRun('UPDATE attachments SET content_sha256=? WHERE id=?',[require('../services/attachment-store').sha256FileSync(stored.abs),info.lastInsertRowid]);
    res.json(db.dbGet('SELECT * FROM attachments WHERE id = ?', [info.lastInsertRowid]));
  });
});

router.get('/', (req, res) => {
  const { item_id } = req.query;
  if (!item_id) return res.status(400).json({ error: '缺少 item_id' });
  res.json(db.dbAll('SELECT * FROM attachments WHERE item_id = ? ORDER BY id', [Number(item_id)]));
});

router.get('/:id', (req, res) => {
  const a = db.dbGet('SELECT * FROM attachments WHERE id = ?', [Number(req.params.id)]);
  if (!a) return res.status(404).json({ error: '附件不存在' });
  res.json(a);
});

// 附件内容读取：流式返回，并校验路径未越出数据目录
router.get('/:id/file', (req, res) => {
  const a = db.dbGet('SELECT * FROM attachments WHERE id = ?', [Number(req.params.id)]);
  if (!a) return res.status(404).json({ error: '附件不存在' });
  // 用统一解析：优先相对 dataDir，兼容历史“相对 filesDir”的旧记录
  const abs = store.resolveAttachment(a.rel_path);
  if (!paths.withinDir(paths.getDataDir(), abs)) {
    return res.status(400).json({ error: '附件路径非法' });
  }
  if (!fs.existsSync(abs)) return res.status(404).json({ error: '附件文件已丢失' });
  res.type(a.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline; filename*=UTF-8\'\'' + encodeURIComponent(a.filename));
  fs.createReadStream(abs).pipe(res);
});

router.delete('/:id', (req, res) => {
  const a = db.dbGet('SELECT * FROM attachments WHERE id = ?', [Number(req.params.id)]);
  if (!a) return res.status(404).json({ error: '附件不存在' });
  // 与读取接口一致：走统一解析器，兼容历史“相对 filesDir”的旧记录，避免删不掉留下孤儿文件
  const abs = store.resolveAttachment(a.rel_path);
  if (!paths.withinDir(paths.getDataDir(), abs)) {
    return res.status(400).json({ error: '附件路径非法' });
  }
  let trashed = false;
  if (fs.existsSync(abs)) {
    const dest = path.join(paths.trashDir(), String(a.item_id) + '-' + path.basename(a.rel_path));
    try {
      fs.renameSync(abs, dest);
      trashed = true;
    } catch (e) {
      // 跨卷或文件被占用时 renameSync 会失败：退回复制，并删除源文件，避免留下无记录的孤儿
      try {
        fs.copyFileSync(abs, dest);
        fs.unlinkSync(abs);
        trashed = true;
      } catch (e2) {
        console.warn('附件移入回收站失败（文件可能正被占用）：' + a.rel_path + ' → ' + e2.message);
      }
    }
  }
  db.dbRun('DELETE FROM attachments WHERE id = ?', [a.id]);
  res.json({ ok: true, trashed });
});

module.exports = router;
module.exports.ALLOWED_EXT = ALLOWED_EXT;
