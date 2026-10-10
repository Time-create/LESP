// 附件文件名乱码 + 拖入导入元数据清洗的回归测试
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const att = fs.readFileSync(path.join(root, 'server', 'routes', 'attachments.js'), 'utf8');
const storeSrc = fs.readFileSync(path.join(root, 'server', 'services', 'attachment-store.js'), 'utf8');
// 拖入导入实现已迁移到 public/js/drop-import.js（阶段 5）
const itemJs = fs.readFileSync(path.join(root, 'public', 'js', 'drop-import.js'), 'utf8');

// 取出被测函数（服务端与浏览器端各一份）
// decodeUploadName 已移到 attachment-store（上传相关共用）
// 取出被测函数：按大括号配对提取，避免依赖缩进
function extract(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = src.indexOf('{', start);
  let depth = 0;
  for (let k = i; k < src.length; k += 1) {
    if (src[k] === '{') depth += 1;
    else if (src[k] === '}') { depth -= 1; if (depth === 0) return src.slice(start, k + 1); }
  }
  return null;
}
const serverFn = extract(storeSrc, 'decodeUploadName');
const clientClean = extract(itemJs, 'cleanTitle');
const clientGuess = extract(itemJs, 'guessFromTitle');
const decodeUploadName = new Function(serverFn + '; return decodeUploadName;')();
const cleanTitle = new Function(clientClean + '; return cleanTitle;')();
const guessFromTitle = new Function(clientGuess + '; return guessFromTitle;')();

test('乱码文件名可还原为原始中文名', () => {
  const orig = '日报时代台湾佛教结社与活动.pdf';
  const mojibake = Buffer.from(orig, 'utf8').toString('latin1');   // 模拟 multer 的 latin1 误解
  assert.ok(/[-ÿ]{2,}/.test(mojibake), '构造的乱码串应含高位字符');
  assert.strictEqual(decodeUploadName(mojibake), orig);
});

test('正常中文名与英文名不被误改', () => {
  assert.strictEqual(decodeUploadName('日报时代.pdf'), '日报时代.pdf');
  assert.strictEqual(decodeUploadName('thesis.pdf'), 'thesis.pdf');
  assert.strictEqual(decodeUploadName('李世伟 paper.pdf'), '李世伟 paper.pdf');
  assert.strictEqual(decodeUploadName(''), '');
});

test('上传三处调用点都走解码（存储名、扩展名校验、入库显示名）', () => {
  assert.ok(att.includes('safeName(decodeUploadName(file.originalname))'), '存储文件名未解码');
  assert.ok(att.includes('path.extname(decodeUploadName(file.originalname)'), '扩展名校验未解码');
  assert.ok(att.includes('const originalName = decodeUploadName(req.file.originalname)'), '入库显示名未解码');
  assert.ok(att.includes('safeName(originalName)'), '入库仍使用原始乱码名');
});

test('拖入导入：标题去掉下载站尾巴', () => {
  const t = '日报时代台湾佛教结社与活动 (李世伟著) (z-library.sk, 1lib.sk, z-lib.sk)';
  const cleaned = cleanTitle(t);
  assert.ok(!cleaned.includes('z-library'), '仍含站点名: ' + cleaned);
  assert.ok(!cleaned.includes('1lib'), '仍含站点名: ' + cleaned);
  assert.ok(cleaned.startsWith('日报时代台湾佛教结社与活动'), '主标题被破坏: ' + cleaned);
});

test('拖入导入：普通标题不被误清洗', () => {
  assert.strictEqual(cleanTitle('宋代人吏与吏役社会'), '宋代人吏与吏役社会');
  assert.strictEqual(cleanTitle('中国古代史（第二版）'), '中国古代史（第二版）');
});

test('拖入导入：可从标题补出作者与出版年', () => {
  const g = guessFromTitle('日报时代台湾佛教结社与活动 (李世伟著, 1964-)');
  assert.strictEqual(g.author, '李世伟');
  assert.strictEqual(g.year, 1964);
});

test('拖入导入：副标题使用清洗后的作者', () => {
  assert.ok(itemJs.includes('subtitle: fields.author'), '副标题未使用清洗后作者');
});