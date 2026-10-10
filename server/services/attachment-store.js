// 附件统一存储。
// 目标：所有附件（上传的、抓取来的）都落在 data/files/attachments/ 下，
// 这样即使原始文件（下载目录里的 PDF）被删除或移动，App 内依然能正常打开。
//
// 约定（很重要）：
//   attachments.rel_path 一律**相对 getDataDir()**，形如 'files/attachments/xxx.pdf'。
//   所有读取方（attachments.js、items.js 的回收站、sources.js 的引用定位）
//   都是 path.resolve(getDataDir(), rel_path)，所以基准必须统一。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const paths = require('../lib/paths');

// 显示名清洗：去掉路径分隔符与控制字符，防路径遍历
function safeName(name, fallback) {
  const base = path.basename(String(name || ''));
  const cleaned = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);
  return cleaned || (fallback || 'file');
}

/**
 * 在统一目录里生成一个不重名的存储名。
 * 重名策略：时间戳 + 8 位随机串 + 原文件名；万一仍撞名就再加序号。
 */
function uniqueStoreName(original) {
  const dir = paths.attachmentsDir();
  fs.mkdirSync(dir, { recursive: true });
  const base = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '-' + safeName(original);
  let candidate = base;
  let n = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    candidate = `${stem}(${n})${ext}`;
    n += 1;
  }
  return candidate;
}

/** 相对 dataDir 的路径（所有读取方都用这个基准） */
function relFromDataDir(abs) {
  return path.relative(paths.getDataDir(), abs).split(path.sep).join('/');
}

/**
 * 把一份文件放进统一目录。
 * @param {object} opts { srcPath, originalName } 或 { buffer, originalName }
 * @returns {{abs, rel, size}} rel 为相对 dataDir 的路径
 */
function store({ srcPath, buffer, originalName }) {
  const dir = paths.attachmentsDir();
  fs.mkdirSync(dir, { recursive: true });
  const storeName = uniqueStoreName(originalName);
  const abs = path.join(dir, storeName);
  if (buffer) {
    fs.writeFileSync(abs, buffer);
  } else {
    fs.copyFileSync(srcPath, abs);          // 复制而非移动：原文件保留在用户下载目录，不擅自改动
  }
  return { abs, rel: relFromDataDir(abs), size: fs.statSync(abs).size };
}

/** 解析附件绝对路径：兼容历史数据（相对 filesDir 的错误基准） */
function resolveAttachment(relPath) {
  const rel = String(relPath || '');
  const fromData = path.resolve(paths.getDataDir(), rel);
  if (fs.existsSync(fromData)) return fromData;
  // 历史遗留：cnki-sync 曾按 filesDir 作为基准写入
  const fromFiles = path.resolve(paths.filesDir(), rel);
  if (fs.existsSync(fromFiles)) return fromFiles;
  return fromData;                          // 都不存在就返回标准路径，交给上层报“文件已丢失”
}

/**
 * 启动时整理：把散落在别处的旧附件搬进统一目录。
 * - 已在统一目录里的跳过
 * - 复制失败的文件保持原状（不丢数据）
 * @returns {{moved:number, skipped:number, missing:string[]}}
 */
function centralize(db) {
  const result = { moved: 0, skipped: 0, missing: [] };
  const target = paths.attachmentsDir();
  fs.mkdirSync(target, { recursive: true });
  let rows = [];
  try {
    rows = db.dbAll('SELECT id, rel_path, filename FROM attachments');
  } catch (e) {
    return result;                          // 表不存在等异常：直接跳过，不影响启动
  }
  for (const row of rows) {
    const rel = String(row.rel_path || '');
    if (rel.replace(/\\/g, '/').startsWith('files/attachments/')) { result.skipped += 1; continue; }
    const abs = resolveAttachment(rel);
    if (!fs.existsSync(abs)) { result.missing.push(row.id + ':' + rel); continue; }
    try {
      const stored = store({ srcPath: abs, originalName: row.filename || path.basename(abs) });
      db.dbRun('UPDATE attachments SET rel_path = ? WHERE id = ?', [stored.rel, row.id]);
      result.moved += 1;
    } catch (e) {
      result.skipped += 1;                  // 复制失败就保留原路径，至少还能打开
    }
  }
  return result;
}

/** 只读文件头部若干字节（用于魔数嗅探），避免把整份大文件读进内存 */function readHead(abs, bytes) {
  const want = bytes || 16;
  let fd = null;
  try {
    fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(want);
    const read = fs.readSync(fd, buf, 0, want, 0);
    return buf.subarray(0, read);
  } catch (e) {
    return Buffer.alloc(0);
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* 忽略 */ } }
  }
}

/** 流式计算 sha256（大文件不会整份进内存） */
function sha256File(abs) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(abs);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** 分块同步计算 sha256：大文件不整份进内存，且保持调用方原有的同步契约 */
function sha256FileSync(abs) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(abs, 'r');
  try {
    const chunk = Buffer.alloc(64 * 1024);
    let read = fs.readSync(fd, chunk, 0, chunk.length, null);
    while (read > 0) {
      hash.update(chunk.subarray(0, read));
      read = fs.readSync(fd, chunk, 0, chunk.length, null);
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

module.exports = { safeName, uniqueStoreName, store, relFromDataDir, resolveAttachment, centralize, readHead, sha256File, sha256FileSync };

/**
 * 还原被 latin1 误解的 UTF-8 文件名。
 * multer/busboy 按 latin1 解析 multipart 文件名，中文名会变成“æ—¥æ™…”形式。
 * 判定：原串不含 CJK 但含连续高位字符；按 latin1→utf8 还原后若得到正常 CJK 且无替换字符则采用。
 */
function decodeUploadName(name) {
  const raw = String(name || '');
  if (!raw || /[\u4e00-\u9fa5]/.test(raw)) return raw;
  if (!/[\u0080-\u00ff]{2,}/.test(raw)) return raw;
  try {
    const fixed = Buffer.from(raw, 'latin1').toString('utf8');
    if (!fixed.includes('\uFFFD') && /[\u4e00-\u9fa5]/.test(fixed)) return fixed;
  } catch (e) { /* 还原失败保留原名 */ }
  return raw;
}

module.exports.decodeUploadName = decodeUploadName;
