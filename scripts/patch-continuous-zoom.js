// PDF 阅读器：Ctrl+滚轮无级缩放（25%–500%，5% 步进）
// 要点：保中心不跳动、重渲染不拉伸、缩放值持久化、百分比可见、居中/适宽各自正确计算
const fs = require('fs');
const p = 'frontend/reader/index.js';
let s = fs.readFileSync(p, 'utf8');
let steps = 0;
const must = (cond, msg) => { if (!cond) { console.log('✘ ' + msg); process.exit(1); } steps++; };

/* 1) 缩放状态与工具：替换 render() 内的缩放取值块 */
const oldScale = "const zoomSel=$('pdf-zoom').value;let scale;if(zoomSel==='fit'||zoomSel==='fitw'){const box=$('pdf-scroll');const availW=Math.max(120,box.clientWidth-16),availH=Math.max(120,box.clientHeight-16);const byW=availW/base.width,byH=availH/base.height;scale=Math.max(.2,Math.min(4,zoomSel==='fitw'?byW:Math.min(byW,byH)));}else{scale=Number(zoomSel)||1;}";
const newScale = "let scale;if(zoomMode==='fit'||zoomMode==='fitw'){const box=$('pdf-scroll');const availW=Math.max(120,box.clientWidth-16),availH=Math.max(120,box.clientHeight-16);const byW=availW/base.width,byH=availH/base.height;scale=Math.max(.2,Math.min(4,zoomMode==='fitw'?byW:Math.min(byW,byH)));}else{scale=userZoom;}";
must(s.includes(oldScale), '未找到缩放取值块');
s = s.replace(oldScale, newScale);

/* 2) 缩放状态变量 + 保中心 + 持久化 + 百分比显示 + 滚轮处理 */
const anchor = "async function render(){";
const zoomCore = [
  "const ZOOM_MIN=0.25,ZOOM_MAX=5,ZOOM_STEP=0.05,ZOOM_KEY='pdf-zoom-mode-v1';",
  "let zoomMode='fit',userZoom=1;",
  "function clampZoom(v){return Math.min(ZOOM_MAX,Math.max(ZOOM_MIN,Math.round(v/ZOOM_STEP)*ZOOM_STEP));}",
  // 百分比显示：写进下拉里的“当前值”选项 + 独立百分比标签
  "function updateZoomDisplay(scale){const pct=Math.round(scale*100)+'%';const box=$('pdf-scroll');",
  "const label=document.getElementById('pdf-zoom-value');if(label)label.textContent=pct;",
  "const custom=document.getElementById('pdf-zoom-custom');",
  "if(custom){custom.textContent=pct;const sel=$('pdf-zoom');if(zoomMode!=='fit'&&zoomMode!=='fitw'&&Math.abs(Number(sel.value)-userZoom)>1e-6)sel.value='__custom__';}}",
  // 持久化
  "function persistZoom(){try{localStorage.setItem(ZOOM_KEY,JSON.stringify({mode:zoomMode,value:userZoom}));}catch(e){}}",
  "function restoreZoom(){try{const raw=localStorage.getItem(ZOOM_KEY);if(!raw)return;const v=JSON.parse(raw);",
  "if(v&&(v.mode==='fit'||v.mode==='fitw'))zoomMode=v.mode;else if(v&&typeof v.value==='number'){zoomMode='num';userZoom=clampZoom(v.value);}}catch(e){}}",
  // 保中心：按滚动比例记录，缩放后恢复，避免页面跳动
  "function captureCenter(){const box=$('pdf-scroll');return{ratioX:(box.scrollLeft+box.clientWidth/2)/Math.max(1,box.scrollWidth),ratioY:(box.scrollTop+box.clientHeight/2)/Math.max(1,box.scrollHeight)};}",
  "function restoreCenter(c){const box=$('pdf-scroll');box.scrollLeft=c.ratioX*box.scrollWidth-box.clientWidth/2;box.scrollTop=c.ratioY*box.scrollHeight-box.clientHeight/2;}",
  // 统一的缩放入口：保中心 + 重新渲染（不拉伸位图）
  "async function applyZoom(next,opts){const o=opts||{};const c=o.keepCenter===false?null:captureCenter();",
  "if(next.mode){if(next.mode==='fit'||next.mode==='fitw'){zoomMode=next.mode;}else{zoomMode='num';userZoom=clampZoom(next.value);}}",
  "const sel=$('pdf-zoom');if(sel){if(zoomMode==='num'&&Math.abs(Number(sel.value)-userZoom)>1e-6)sel.value='__custom__';else sel.value=zoomMode;}",
  "persistZoom();await render();if(c)restoreCenter(c);}",
  // 防闪烁：重渲染期间用旧位图兜底
  "function snapshotCanvas(){const c=$('pdf-canvas');if(!c||!c.width)return;try{const s=document.createElement('canvas');s.width=c.width;s.height=c.height;s.getContext('2d').drawImage(c,0,0);",
  "$('pdf-page-surface').style.backgroundImage='url('+s.toDataURL()+')';}catch(e){}}",
  "function clearSnapshot(){$('pdf-page-surface').style.backgroundImage='';}",
  "",
  "restoreZoom();",
  "async function render(){"
].join('');
must(s.includes(anchor), '未找到 render() 入口');
s = s.replace(anchor, zoomCore);

/* 3) render() 内：重渲染前快照、完成后清除、更新百分比 */
must(s.includes("canvas.width=Math.ceil(renderViewport.width);"), '未找到 canvas 尺寸设置');
s = s.replace(
  "canvas.width=Math.ceil(renderViewport.width);",
  "snapshotCanvas();canvas.width=Math.ceil(renderViewport.width);"
);
must(s.includes("await textLayer.render();"), '未找到 textLayer.render()');
s = s.replace("await textLayer.render();pdfjs.TextLayer.cleanup();", "await textLayer.render();pdfjs.TextLayer.cleanup();clearSnapshot();updateZoomDisplay(scale);");

/* 4) 下拉与 +/- 键：改为连续缩放 */
const oldSel = "$('pdf-zoom').onchange=()=>render();";
const newSel = "$('pdf-zoom').onchange=()=>{const v=$('pdf-zoom').value;if(v==='fit'||v==='fitw'){applyZoom({mode:v});}else if(v==='__custom__'){applyZoom({mode:'num',value:userZoom});}else{applyZoom({mode:'num',value:Number(v)});}};"
must(s.includes(oldSel), '未找到 pdf-zoom onchange');
s = s.replace(oldSel, newSel);

const oldStep = "const ZOOM_STEPS=[0.5,0.75,1,1.25,1.5,2,3];function stepZoom(dir){const sel=$('pdf-zoom');if(sel.value==='fit'||sel.value==='fitw'){sel.value=dir>0?'1':'0.75';render();return;}let i=ZOOM_STEPS.findIndex(v=>v>=Number(sel.value));if(i<0)i=ZOOM_STEPS.length-1;i=Math.max(0,Math.min(ZOOM_STEPS.length-1,i+dir));sel.value=String(ZOOM_STEPS[i]);render();}";
const newStep = [
  "function currentScale(){if(zoomMode==='fit'||zoomMode==='fitw'){return lastFitScale||1;}return userZoom;}",
  "function stepZoom(dir){const base=currentScale();",
  // 从“整页/适宽”切到手动缩放时，以当前实际比例为基准，做到无跳变
  "applyZoom({mode:'num',value:clampZoom(dir>0?base+ZOOM_STEP:base-ZOOM_STEP)});}",
  // Ctrl+滚轮无级缩放
  "let wheelAccum=0,wheelTimer=null;",
  "$('pdf-scroll').addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();",
  "wheelAccum+=e.deltaY;const now=Date.now();",
  "if(!wheelTimer){wheelTimer=setTimeout(()=>{wheelTimer=null;},120);}",
  "if(Math.abs(wheelAccum)>=ZOOM_STEP*0.9||now-(wheelAccum._t||0)>90){wheelAccum._t=now;",
  "const dir=wheelAccum<0?1:-1;wheelAccum=0;applyZoom({mode:'num',value:clampZoom(currentScale()+dir*ZOOM_STEP)});}},{passive:false});"
].join('');
must(s.includes(oldStep), '未找到 stepZoom 定义');
s = s.replace(oldStep, newStep);

/* 5) 记录“整页/适宽”下的实际比例，供 +/- 与滚轮做基准 */
must(s.includes("scale=Math.max(.2,Math.min(4,zoomMode==='fitw'?byW:Math.min(byW,byH)));"), '未找到 fit 取值');
s = s.replace(
  "scale=Math.max(.2,Math.min(4,zoomMode==='fitw'?byW:Math.min(byW,byH)));",
  "scale=Math.max(.2,Math.min(4,zoomMode==='fitw'?byW:Math.min(byW,byH)));lastFitScale=scale;"
);
must(s.includes("let zoomMode='fit',userZoom=1;"), '未找到缩放状态声明');
s = s.replace("let zoomMode='fit',userZoom=1;", "let zoomMode='fit',userZoom=1,lastFitScale=1;");

/* 6) 初始化时把持久化的值同步到下拉框 */
must(s.includes("list();await render();"), '未找到初始化位置');
s = s.replace(
  "list();await render();",
  "list();(function(){const sel=$('pdf-zoom');if(sel)sel.value=zoomMode;})();await render();"
);

fs.writeFileSync(p, s);
console.log('✔ 无级缩放改造完成，共', steps, '处锚点替换');
