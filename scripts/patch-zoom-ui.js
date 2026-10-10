// 阅读器工具栏：增加百分比显示 + 下拉中的“当前值”选项（承载任意连续缩放百分比）
const fs = require('fs');
const p = 'server/views/pdf-reader.js';
let s = fs.readFileSync(p, 'utf8');
let n = 0;

// 1) 下拉里加一个承载“当前连续值”的隐藏选项
if (!s.includes('id="pdf-zoom-custom"')) {
  s = s.replace('<option value="2">200%</option>',
    '<option value="2">200%</option><option value="__custom__" id="pdf-zoom-custom" hidden></option>');
  n += 1;
}

// 2) 下拉后加百分比标签
if (!s.includes('id="pdf-zoom-value"')) {
  s = s.replace('</select><button id="pdf-rotate"',
    '</select><span id="pdf-zoom-value" class="pdf-zoom-value" title="当前缩放比例（Ctrl+滚轮可无级调整）">100%</span><button id="pdf-rotate"');
  n += 1;
}

// 3) 快捷键说明里补上 Ctrl+滚轮
if (!s.includes('Ctrl+滚轮')) {
  s = s.replace('快捷键：← → 翻页', '快捷键：Ctrl+滚轮 无级缩放 ｜ ← → 翻页');
  n += 1;
}

// 4) 缩放下拉 title 同步更新
s = s.replace('title="缩放：整页(0) / 适宽(1) / 逐级缩放(+ 或 -)"',
  'title="缩放：整页(0) / 适宽(1) / 逐级缩放(+ 或 -)；按住 Ctrl 滚动滚轮可无级缩放"');

fs.writeFileSync(p, s);
console.log('✔ 工具栏改造完成，共', n, '处');
