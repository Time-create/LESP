// 拖入 PDF 导入：清洗标题中的下载站尾巴，并从标题里补出作者/出版年
const fs = require('fs');
const p = 'public/js/item.js';
let s = fs.readFileSync(p, 'utf8');
let n = 0;
const must = (c, m) => { if (!c) { console.log('✘ ' + m); process.exit(1); } n++; };

// 锚点：构造 title / fields 的那一段
const anchor = "    const baseName = file.name.replace(/\\.pdf$/i, '');\n    const title = meta.title || baseName;\n    const fields = {\n      author: meta.author || '',\n      publisher: meta.publisher || '',\n      year: meta.year || ''\n    };";
must(s.includes(anchor), '未找到标题/字段构造锚点');

const replacement = [
  "    const baseName = file.name.replace(/\\.pdf$/i, '');",
  "    // 元数据里的标题常带下载站尾巴（如 “(z-library.sk, 1lib.sk, z-lib.sk)”），清洗掉",
  "    function cleanTitle(raw) {",
  "      let t = String(raw || '').trim();",
  "      // 去掉含域名特征的括号尾巴：(z-library.sk, 1lib.sk) / (Retrieved from ...)",
  "      t = t.replace(/[（(][^（）()]{0,120}?(?:[a-z0-9-]+\\.(?:sk|com|org|net|cc|io|me|rs)|Retrieved\\s+from)[^（）()]{0,120}[）)]/gi, '');",
  "      t = t.replace(/\\s{2,}/g, ' ').replace(/[\\s,，、-]+$/, '').trim();",
  "      return t;",
  "    }",
  "    // 从标题里尽力补出作者与出版年（仅在元数据缺失时使用）",
  "    function guessFromTitle(t) {",
  "      const out = { author: '', year: '' };",
  "      const a = t.match(/[（(]?\\s*([\\u4e00-\\u9fa5]{2,8}|[A-Z][A-Za-z.'-]{2,20})\\s*(?:著|编|主编|编著|等著)/);",
  "      if (a) out.author = a[1].trim();",
  "      const y = t.match(/\\b(1[5-9]\\d{2}|20\\d{2})\\b/);",
  "      if (y) out.year = Number(y[1]);",
  "      return out;",
  "    }",
  "    const rawTitle = meta.title || baseName;",
  "    const title = cleanTitle(rawTitle);",
  "    const guess = guessFromTitle(rawTitle);",
  "    const fields = {",
  "      author: meta.author || guess.author || '',",
  "      publisher: meta.publisher || '',",
  "      year: meta.year || guess.year || ''",
  "    };"
].join('\n');

s = s.replace(anchor, replacement);

// 副标题用清洗后的作者
s = s.replace("body: { module: 'book', title, subtitle: meta.author || '', status: '在读', fields, source: 'PDF 拖入' }",
  "body: { module: 'book', title, subtitle: fields.author, status: '在读', fields, source: 'PDF 拖入' }");
must(s.includes("subtitle: fields.author"), '副标题未改为清洗后作者');

fs.writeFileSync(p, s);
console.log('✔ 标题清洗与作者/年份补全已加入，共', n, '类改动');
