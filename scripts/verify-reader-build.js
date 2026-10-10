// 一次性校验脚本：确认打包产物 reader.js / reader.css 含全部修复
const fs = require('fs');
const js = fs.readFileSync('public/dist/reader.js', 'utf8');
const css = fs.readFileSync('public/css/reader.css', 'utf8');

const rows = [
  // esbuild 输出可能把单引号改写成双引号，两种都要认
  ['reader.js · 整页/适宽分支', /zoomMode\s*===\s*["']fit["']/.test(js) && /fitw/.test(js)],
  ['reader.js · dpr 渲染', js.includes('devicePixelRatio')],
  ['reader.js · 像素上限', js.includes('MAX_PIXELS')],
  ['reader.js · 不拉伸约束', /renderScale\s*<\s*scale/.test(js)],
  ['reader.js · resize 重渲染', js.includes('addEventListener("resize"')],
  ['reader.css · display:grid', /\.pdf-workspace\s*\{[^}]*display:\s*grid/.test(css)],
  ['reader.css · minmax(0,1fr)', /grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(css)],
  ['reader.css · surface 定位', /#pdf-page-surface\s*\{[^}]*position:\s*relative/.test(css)],
  ['reader.css · overlay 定位', /#pdf-overlay\s*\{[^}]*position:\s*absolute/.test(css)],
  ['reader.css · 固定高度容器', /#pdf-scroll\s*\{[^}]*height:\s*calc\(100vh/.test(css)],
  ['reader.css · 无 max-height', !/#pdf-scroll\s*\{[^}]*max-height/.test(css)]
];

let bad = 0;
for (const [name, ok] of rows) {
  if (!ok) bad++;
  console.log((ok ? '  [OK] ' : '  [FAIL] ') + name);
}
console.log(bad === 0 ? '\n全部通过' : '\n失败项: ' + bad);
process.exit(bad === 0 ? 0 : 1);