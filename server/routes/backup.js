const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const db = require('../db');
const paths = require('../lib/paths');

const router = express.Router();
const KEEP = 7;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  // 精确到毫秒：同一分钟内多次备份若同名会互相覆盖，导致保留份数策略失效
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function stats() {
  const itemCount = db.dbGet('SELECT COUNT(*) c FROM items').c;
  const attachmentCount = db.dbGet('SELECT COUNT(*) c FROM attachments').c;
  return { itemCount, attachmentCount };
}

function dirSize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.name === '_trash') continue;
      if (e.isDirectory()) walk(p);
      else total += fs.statSync(p).size;
    }
  };
  walk(dir);
  return total;
}

// 备份：先 checkpoint 保证 WAL 落盘，再打包 app.db 与 files（排除回收目录）
router.post('/create', async(req,res,next)=>{try{res.json(await require('../services/backup-v2').create());}catch(e){next(e);}});

router.get('/list', (req, res) => {
  const dir = paths.backupsDir();
  if (!fs.existsSync(dir)) return res.json([]);
  const list = fs.readdirSync(dir)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.zip'))
    .sort()
    .reverse()
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, sizeBytes: st.size, at: new Date(st.mtime).toISOString() };
    });
  res.json(list);
});

// 恢复：先对当前数据做 pre-restore 备份，再解压覆盖，最后重新打开数据库
router.post('/restore', async(req,res,next)=>{try{res.json(await require('../services/backup-v2').restore(String(req.body.file||'')));}catch(e){next(e);}});

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

router.delete('/:file', (req, res) => {
  const safe = path.basename(req.params.file);
  const p = path.join(paths.backupsDir(), safe);
  if (!fs.existsSync(p)) return res.status(404).json({ error: '备份文件不存在' });
  fs.rmSync(p, { force: true });
  res.json({ ok: true });
});

module.exports = router;
module.exports.stats = stats;
