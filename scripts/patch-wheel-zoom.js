// 把滚轮缩放改成“每事件一步 + 短节流”的稳健实现（避免累加器在快速滚动时丢步或重复触发）
const fs = require('fs');
const p = 'frontend/reader/index.js';
let s = fs.readFileSync(p, 'utf8');

const start = s.indexOf("let wheelAccum=0,wheelTimer=null;");
const endMarker = "{passive:false});";
const end = s.indexOf(endMarker, start);
if (start < 0 || end < 0) { console.log('✘ 未找到原滚轮处理块'); process.exit(1); }

const replacement = [
  "let wheelLock=false;",
  "$('pdf-scroll').addEventListener('wheel',e=>{",
  "if(!e.ctrlKey)return;",                       // 仅按住 Ctrl 时接管滚轮，普通滚动仍用于翻阅
  "e.preventDefault();",
  "if(wheelLock)return;",
  "wheelLock=true;",
  "const dir=e.deltaY<0?1:-1;",
  "applyZoom({mode:'num',value:clampZoom(currentScale()+dir*ZOOM_STEP)});",
  "setTimeout(()=>{wheelLock=false;},60);",
  endMarker
].join('');

s = s.slice(0, start) + replacement + s.slice(end + endMarker.length);
fs.writeFileSync(p, s);
console.log('✔ 滚轮缩放已改为节流实现');
console.log('  片段:', s.slice(start, start + 260));
