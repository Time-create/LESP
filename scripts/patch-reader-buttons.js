// 为阅读器控件补 title（快捷键/语义说明）与 aria-pressed，让每个按键的功能可见、可查
const fs = require('fs');
const p = 'server/views/pdf-reader.js';
let s = fs.readFileSync(p, 'utf8');

const edits = [
  ['<button id="pdf-prev">上一页</button>', '<button id="pdf-prev" title="上一页（← / PageUp）">上一页</button>'],
  ['<button id="pdf-next">下一页</button>', '<button id="pdf-next" title="下一页（→ / PageDown）">下一页</button>'],
  ['<select id="pdf-zoom" aria-label="缩放">', '<select id="pdf-zoom" aria-label="缩放" title="缩放：整页(0) / 适宽(1) / 逐级缩放(+ 或 -)">'],
  ['<button id="pdf-rotate">旋转 90°</button>', '<button id="pdf-rotate" title="顺时针旋转 90°（R）">旋转 90°</button>'],
  ['<button id="pdf-text">文字选择</button>', '<button id="pdf-text" title="文字模式：可直接选中文字并高亮（H）" aria-pressed="true">文字选择</button>'],
  ['<button id="pdf-region">框选区域</button>', '<button id="pdf-region" title="区域模式：在页面上拖动框选影像区域（Esc 退出）" aria-pressed="false">框选区域</button>'],
  ['<button id="pdf-highlight">高亮选中文字</button>', '<button id="pdf-highlight" title="把当前选中的文字高亮为批注（H）">高亮选中文字</button>'],
  ['<button id="pdf-copy-export">另存批注 PDF</button>', '<button id="pdf-copy-export" title="导出带批注的 PDF 副本">另存批注 PDF</button>']
];

let n = 0;
for (const [from, to] of edits) {
  if (s.includes(to)) continue;
  if (!s.includes(from)) { console.log('  [SKIP] 未找到:', from.slice(0, 40)); continue; }
  s = s.replace(from, to);
  n += 1;
}

// 工具栏末尾追加快捷键说明
if (!s.includes('id="pdf-shortcuts"')) {
  s = s.replace('<p id="pdf-status" role="status">',
    '<p id="pdf-shortcuts" class="pdf-shortcuts">快捷键：← → 翻页 ｜ + - 缩放 ｜ 0 整页 ｜ 1 适宽 ｜ R 旋转 ｜ H 高亮 ｜ Esc 取消 ｜ Ctrl+S 保存笔记</p><p id="pdf-status" role="status">');
  n += 1;
}

fs.writeFileSync(p, s);
console.log('✔ 控件提示已补齐，共改动', n, '处');
