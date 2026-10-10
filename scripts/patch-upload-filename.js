// 修复上传文件名乱码：multer/busboy 按 latin1 解析 multipart 文件名，
// 导致 UTF-8 中文名变成“æ—¥æ™…”形式。这里做一次可判定的还原。
const fs = require('fs');
const p = 'server/routes/attachments.js';
let s = fs.readFileSync(p, 'utf8');
let n = 0;
const must = (c, m) => { if (!c) { console.log('✘ ' + m); process.exit(1); } n++; };

/* 1) 插入解码函数（放在 safeName 之后） */
if (!s.includes('function decodeUploadName(')) {
  const anchor = "function uploadFor(itemId, dir) {";
  must(s.includes(anchor), '未找到 uploadFor 锚点');
  s = s.replace(anchor, [
    "/**",
    " * 还原被 latin1 误解的 UTF-8 文件名。",
    " * 判定：原串不含 CJK，但含连续 latin1 高位字符；按 latin1→utf8 还原后若得到正常 CJK 且无替换字符，则采用还原结果。",
    " */",
    "function decodeUploadName(name) {",
    "  const raw = String(name || '');",
    "  if (!raw || /[\\u4e00-\\u9fa5]/.test(raw)) return raw;            // 已是正常中文，不处理",
    "  if (!/[\\u00c0-\\u00ff]{2,}/.test(raw)) return raw;            // 没有连续高位字符，不处理",
    "  try {",
    "    const fixed = Buffer.from(raw, 'latin1').toString('utf8');",
    "    if (!fixed.includes('\\uFFFD') && /[\\u4e00-\\u9fa5]/.test(fixed)) return fixed;",
    "  } catch (e) { /* 还原失败则保留原名 */ }",
    "  return raw;",
    "}",
    "",
    anchor
  ].join('\n'));
}

/* 2) 三处调用点统一走解码 */
s = s.replace("cb(null, Date.now() + '-' + safeName(file.originalname));",
  "cb(null, Date.now() + '-' + safeName(decodeUploadName(file.originalname)));");
must(s.includes('safeName(decodeUploadName(file.originalname))'), 'filename 回调未替换');

s = s.replace("const ext = path.extname(file.originalname || '').toLowerCase();",
  "const ext = path.extname(decodeUploadName(file.originalname) || '').toLowerCase();");
must(s.includes("path.extname(decodeUploadName(file.originalname)"), 'fileFilter 未替换');

s = s.replace("stored = store.store({ srcPath: req.file.path, originalName: req.file.originalname });",
  "const originalName = decodeUploadName(req.file.originalname);\n      stored = store.store({ srcPath: req.file.path, originalName });");
must(s.includes('const originalName = decodeUploadName'), '存储调用未替换');

s = s.replace("[itemId, safeName(req.file.originalname), stored.rel, stored.size, req.file.mimetype || '', db.now()]",
  "[itemId, safeName(originalName), stored.rel, stored.size, req.file.mimetype || '', db.now()]");
must(s.includes('safeName(originalName)'), '入库显示名未替换');

fs.writeFileSync(p, s);
console.log('✔ 上传文件名乱码修复完成，共', n, '类改动');
