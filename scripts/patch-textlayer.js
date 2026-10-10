// 一次性修补：把文字层取文本内容的地方改为同时记录“本页是否有文字项”
const fs = require('fs');
const p = 'frontend/reader/index.js';
let s = fs.readFileSync(p, 'utf8');

const target = "textLayer=new pdfjs.TextLayer({textContentSource:await page.getTextContent(),container:$('pdf-text-layer'),viewport});";
const repl = "const tc=await page.getTextContent();const textItems=(tc.items||[]).length>0;textLayer=new pdfjs.TextLayer({textContentSource:tc,container:$('pdf-text-layer'),viewport});";

if (s.includes(repl)) {
  console.log('已存在，无需重复修补');
} else if (s.includes(target)) {
  s = s.replace(target, repl);
  fs.writeFileSync(p, s);
  console.log('✔ 已补上 textItems 判定');
} else {
  console.log('✘ 目标片段未找到，请检查源码');
  process.exit(1);
}

// 复核：textItems 必须先定义后使用
const defIdx = s.indexOf('const textItems=');
const useIdx = s.indexOf('if(!textItems)');
console.log('  定义位置:', defIdx, '| 使用位置:', useIdx, defIdx >= 0 && useIdx > defIdx ? '(顺序正确)' : '(顺序异常)');
