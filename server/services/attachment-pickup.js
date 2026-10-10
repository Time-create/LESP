// 附件交接导入：把浏览器下载好的文件，从“交接目录”复制进 App 私有附件目录。
//
// 为什么需要它：浏览器扩展不能直接读取用户磁盘上的文件，
// 所以扩展负责“触发下载并指定保存位置”，落盘后由 App 来完成导入。
//
// 安全边界（重要）：只接受“允许的交接目录”内的文件，默认
//   <用户目录>\Downloads\LESP附件
// 且会校验：路径不越界、文件真实存在、内容是 PDF/CAJ/图片，否则一律拒绝。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const paths = require('../lib/paths');
const store = require('./attachment-store');

const SETTING_KEY = 'cnki_pickup_dir';
const DEFAULT_SUBDIR = path.join('Downloads', 'LESP附件');

function defaultPickupDir() {
  const home = process.env.USERPROFILE || os.homedir();
  return path.join(home, DEFAULT_SUBDIR);
}

function downloadsRoot() {
  const home = process.env.USERPROFILE || os.homedir();
  return path.join(home, 'Downloads');
}

function settingDir(db) {
  try {
    const row = db.dbGet('SELECT value FROM settings WHERE key = ?', [SETTING_KEY]);
    if (row && row.value && fs.existsSync(row.value)) return row.value;
  } catch (e) { /* 设置表不可用时退回默认 */ }
  return defaultPickupDir();
}

// 允许的来源根目录：
//   1) 专用交接子目录（扩展指定保存位置时）
//   2) 下载目录本身（下载页自行触发的下载会落到下载根目录，也必须能接住）
// 两者都做严格校验：路径不得越界、文件必须是 PDF/CAJ/图片、不得过小。
function allowedRoots(db) {
  const roots = [settingDir(db)];
  const dl = downloadsRoot();
  if (!roots.includes(dl)) roots.push(dl);
  return roots;
}

// 允许的文件类型：只看文件头，不信扩展名
function sniff(buf) {
  const head5 = buf.subarray(0, 5).toString('latin1');
  const head4 = buf.subarray(0, 4).toString('latin1');
  const head3 = buf.subarray(0, 3).toString('latin1');
  if (head5 === '%PDF-') return { ok: true, ext: 'pdf', mime: 'application/pdf' };
  if (/CAJ|HUGE|C8/i.test(head4)) return { ok: true, ext: 'caj', mime: 'application/octet-stream' };
  if (head3 === '\xff\xd8\xff') return { ok: true, ext: 'jpg', mime: 'image/jpeg' };
  if (head4 === '\x89PNG') return { ok: true, ext: 'png', mime: 'image/png' };
  return { ok: false };
}

/**
 * 第一步：校验并把文件复制进私有附件目录（不写数据库）。
 * 供同步流程在“条目入库前”调用，先拿到落盘位置，条目建好后再挂附件行。
 * @param {object} args { sourcePath, filename, root, db }
 */
function stage({ sourcePath, filename, root, db }) {
  const abs = path.resolve(String(sourcePath || ''));
  const roots = root ? [root] : allowedRoots(db);
  const allowed = roots.some((r) => paths.withinDir(r, abs));
  if (!allowed) {
    throw new Error('文件不在允许的交接目录内（允许：' + roots.join(' 或 ') + '）');
  }
  if (!fs.existsSync(abs)) throw new Error('文件不存在：' + abs);

  // 只读文件头做魔数嗅探，并用 stat 取体积；避免把整份大文件读进内存
  const size = fs.statSync(abs).size;
  const kind = sniff(store.readHead(abs, 16));
  if (!kind.ok) {
    throw new Error('文件不是 PDF/CAJ/图片（可能是下单页 HTML，说明该篇无下载权限）');
  }
  if (size < 1024) {
    throw new Error('文件过小（' + size + ' 字节），疑似错误页而非正文');
  }
  const stored = store.store({ srcPath: abs, originalName: filename || path.basename(abs) });
  return { abs: stored.abs, rel: stored.rel, size: stored.size, ext: kind.ext, mime: kind.mime };
}

/**
 * 第二步（便捷封装）：校验 + 复制 + 直接写入附件记录。
 */
function pickup({ db, sourcePath, itemId, filename, root, now }) {
  const st = stage({ sourcePath, filename, root, db });
  const info = db.dbRun(
    'INSERT INTO attachments (item_id, filename, rel_path, size, mime, created_at) VALUES (?,?,?,?,?,?)',
    [itemId, store.safeName(filename || path.basename(String(sourcePath))), st.rel, st.size, st.mime, now || db.now()]
  );
  try {
    db.dbRun('UPDATE attachments SET content_sha256=? WHERE id=?',
      [store.sha256FileSync(st.abs), info.lastInsertRowid]);
  } catch (e) { /* 旧库没有该列时忽略 */ }
  return { ok: true, attachmentId: info.lastInsertRowid, rel: st.rel, ext: st.ext, size: st.size };
}
module.exports = { pickup, stage, defaultPickupDir, settingDir, downloadsRoot, allowedRoots, sniff, SETTING_KEY };
