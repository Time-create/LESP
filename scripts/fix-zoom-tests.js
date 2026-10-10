// 修正因无级缩放改造而失效的断言（代码正确，断言过时/写错）
const fs = require('fs');
const p = 'tests/reader-view.test.js';
let s = fs.readFileSync(p, 'utf8');
let n = 0;
const rep = (from, to) => {
  if (s.includes(to)) return;
  if (!s.includes(from)) { console.log('  [SKIP] 未找到:', from.slice(0, 50)); return; }
  s = s.replace(from, to);
  n += 1;
};

// 1) 缩放分支变量名已从 zoomSel 改为 zoomMode
rep("assert.ok(src.includes(\"zoomSel==='fit'||zoomSel==='fitw'\"), '缺少整页/适宽分支');",
    "assert.ok(src.includes(\"zoomMode==='fit'||zoomMode==='fitw'\"), '缺少整页/适宽分支');");

// 2) 固定档位 ZOOM_STEPS 已被连续步进 ZOOM_MIN/MAX/STEP 取代
rep("assert.ok(src.includes('ZOOM_STEPS'), '缺少缩放档位');",
    "assert.ok(src.includes('ZOOM_MIN') && src.includes('ZOOM_MAX') && src.includes('ZOOM_STEP'), '缺少连续缩放步进参数');");

// 3) 正则写错：applyZoom 体内含 `opts||{}`，[^}]* 无法跨越
rep("assert.ok(/async function applyZoom\\([^)]*\\)\\{[^}]*captureCenter/.test(src), 'applyZoom 未在缩放前记录中心');",
    "assert.ok(/async function applyZoom\\([\\s\\S]{0,240}?captureCenter\\(/.test(src), 'applyZoom 未在缩放前记录中心');");

// 4) Ctrl+滚轮 提示写在视图里，不在脚本里
rep("assert.ok(src.includes('Ctrl+滚轮'), '工具栏未提示 Ctrl+滚轮');",
    "assert.ok(view.includes('Ctrl+滚轮'), '工具栏未提示 Ctrl+滚轮');");

fs.writeFileSync(p, s);
console.log('✔ 修正断言', n, '处');
