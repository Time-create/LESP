// PDF 阅读器回归测试：锁死关键布局与缩放不变量。
// 背景：曾因整份覆盖 reader.css 导致布局规则丢失（内容错位、控件失效），
//       也曾因适宽缩放与容器宽度形成正反馈导致缩放失控。这两类问题必须能被测试拦住。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'reader.css'), 'utf8');
const src = fs.readFileSync(path.join(root, 'frontend', 'reader', 'index.js'), 'utf8');
const view = fs.readFileSync(path.join(root, 'server', 'views', 'pdf-reader.js'), 'utf8');

test('样式：工作区必须是 grid 且用 minmax(0,1fr)（否则画布撑开列宽 → 缩放失控）', () => {
  assert.ok(/\.pdf-workspace\s*\{[^}]*display:\s*grid/.test(css), '工作区缺少 display:grid');
  assert.ok(/grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(css), '列宽必须为 minmax(0,1fr)');
  assert.ok(!/minmax\(400px,\s*1fr\)/.test(css), '不应再使用 minmax(400px,1fr)（auto 最小值会撑开列）');
});

test('样式：页面容器必须是定位基准（否则文字层/批注错位）', () => {
  assert.ok(/#pdf-page-surface\s*\{[^}]*position:\s*relative/.test(css), '页面容器缺少 position:relative');
  assert.ok(/#pdf-overlay\s*\{[^}]*position:\s*absolute[^}]*pointer-events:\s*none/.test(css), '批注层定位/穿透缺失');
  assert.ok(/\.pdf-mark\s*\{[^}]*position:\s*absolute/.test(css), '批注块缺少绝对定位');
});

test('样式：滚动容器用固定高度（max-height 会让高度随内容变化，形成缩放反馈）', () => {
  const rule = css.match(/#pdf-scroll\s*\{([^}]*)\}/);
  assert.ok(rule, '缺少 #pdf-scroll 规则');
  assert.ok(/height:\s*calc\(100vh/.test(rule[1]), '应使用固定 height');
  assert.ok(!/max-height/.test(rule[1]), '不应使用 max-height');
  assert.ok(/min-width:\s*0/.test(rule[1]), '需要 min-width:0 以允许网格收缩');
});

test('缩放：适宽/整页必须同时约束宽高，且有上限', () => {
  assert.ok(src.includes("zoomMode==='fit'||zoomMode==='fitw'"), '缺少整页/适宽分支');
  assert.ok(src.includes('availW') && src.includes('availH'), '适宽必须同时使用可用宽与可用高');
  assert.ok(/Math\.min\(4,/.test(src), '缺少缩放上限保护');
  assert.ok(!/Math\.min\(6,/.test(src), '不应再有 6 倍的失控上限');
});

test('渲染分辨率：按 dpr 渲染、像素上限、且画布不小于显示尺寸（不拉伸）', () => {
  assert.ok(src.includes('devicePixelRatio'), '缺少 dpr 渲染');
  assert.ok(src.includes('MAX_PIXELS'), '缺少像素上限');
  assert.ok(src.includes('renderScale<scale)renderScale=scale') || src.includes('renderScale < scale'), '缺少“画布不小于显示尺寸”约束');
  assert.ok(src.includes('viewport:renderViewport'), 'canvas 未使用高清视口渲染');
});

test('缩放下拉提供整页与适宽两种模式', () => {
  assert.ok(view.includes('value="fit">整页'), '缺少整页选项');
  assert.ok(view.includes('value="fitw">适宽'), '缺少适宽选项');
});

test('尺寸变化（进出全屏）会触发重渲染', () => {
  assert.ok(src.includes('addEventListener("resize"') || src.includes("addEventListener('resize'"), '缺少 resize 监听');
});
// ---------- 2026-10-02 三项核心缺陷的回归锁定 ----------

test('画布必须同时设定位图与 CSS 尺寸（否则文字层错位、文字选不中、框选偏移）', () => {
  assert.ok(src.includes('canvas.width=Math.ceil(renderViewport.width)'), '缺少位图尺寸');
  assert.ok(src.includes("canvas.style.width=viewport.width+'px'"), '缺少 canvas CSS 宽度设置');
  assert.ok(src.includes("canvas.style.height=viewport.height+'px'"), '缺少 canvas CSS 高度设置');
});

test('选区计算按行合并（过滤跨行块级矩形、同行横向合并），不再直接一对一映射', () => {
  assert.ok(src.includes('function selectionRects'), '缺少 selectionRects');
  assert.ok(src.includes('const rects=selectionRects(range)'), '高亮未使用逐行合并');
  assert.ok(!/const rects=\[\.\.\.range\.getClientRects\(\)\]/.test(src), '仍存在旧的一对一映射');
});

test('快捷键覆盖翻页/缩放/整页/适宽/旋转/高亮/Esc，且输入框内不拦截', () => {
  for (const frag of ["k==='ArrowRight'", "k==='ArrowLeft'", "k==='PageDown'", "k==='PageUp'",
    'stepZoom(1)', 'stepZoom(-1)', "k==='0'", "k==='1'", "k.toLowerCase()==='r'",
    "k.toLowerCase()==='h'", "k==='Escape'", "t.tagName==='INPUT'"]) {
    assert.ok(src.includes(frag), '缺少快捷键处理: ' + frag);
  }
  assert.ok(src.includes('ZOOM_MIN') && src.includes('ZOOM_MAX') && src.includes('ZOOM_STEP'), '缺少连续缩放步进参数');
});

test('无文字层（扫描件）时给出明确提示，而不是让用户以为选不中', () => {
  assert.ok(src.includes('const textItems='), '缺少文字项判定');
  assert.ok(src.includes('if(!textItems)'), '缺少扫描件提示');
  assert.ok(src.includes('本页无文字层'), '缺少扫描件提示文案');
  assert.ok(src.indexOf('const textItems=') < src.indexOf('if(!textItems)'), 'textItems 必须在使用前定义');
});

test('控件带有快捷键/语义提示，无占位按钮', () => {
  for (const frag of ['title="上一页（← / PageUp）"', 'title="下一页（→ / PageDown）"',
    'title="顺时针旋转 90°（R）"', 'id="pdf-shortcuts"']) {
    assert.ok(view.includes(frag), '缺少控件提示: ' + frag);
  }
});

// ---------- Ctrl+滚轮无级缩放（2026-10-02） ----------

test('无级缩放：范围 25%~500%，以 100% 为基准按 5% 固定步进', () => {
  assert.ok(src.includes('ZOOM_MIN=0.25'), '下限应为 25%');
  assert.ok(src.includes('ZOOM_MAX=5'), '上限应为 500%');
  assert.ok(src.includes('ZOOM_STEP=0.05'), '步进应为 5%');
  assert.ok(/function clampZoom\(v\)\{[^}]*ZOOM_STEP\)/.test(src), 'clampZoom 未按步进取整');
  assert.ok(src.includes('clampZoom(currentScale()+dir*ZOOM_STEP)'), '步进未以当前比例为基准');
});

test('无级缩放：Ctrl+滚轮接管（passive:false 以便 preventDefault），普通滚轮不受影响', () => {
  assert.ok(src.includes("addEventListener('wheel'"), '缺少滚轮监听');
  assert.ok(src.includes('if(!e.ctrlKey)return;'), '未限定 Ctrl 键');
  assert.ok(src.includes('{passive:false}'), 'wheel 监听需 passive:false');
  assert.ok(src.includes('e.deltaY<0?1:-1'), '未按滚轮方向缩放');
  assert.ok(!src.includes('wheelAccum'), '旧的累加器实现应已移除');
});

test('无级缩放：保持中心不跳动（按滚动比例记录与恢复）', () => {
  assert.ok(src.includes('function captureCenter'), '缺少中心记录');
  assert.ok(src.includes('function restoreCenter'), '缺少中心恢复');
  assert.ok(/async function applyZoom\([\s\S]{0,240}?captureCenter\(/.test(src), 'applyZoom 未在缩放前记录中心');
  assert.ok(src.includes('if(c)restoreCenter(c);'), '缩放后未恢复中心');
});

test('无级缩放：重渲染而非拉伸位图，且重渲染期间防闪烁', () => {
  assert.ok(src.includes('snapshotCanvas();canvas.width=Math.ceil(renderViewport.width)'), '缩放未重新计算画布尺寸');
  assert.ok(src.includes('clearSnapshot();'), '渲染完成后未清除快照');
});

test('无级缩放：整页与适宽分别正确计算，且切到手动缩放无跳变', () => {
  assert.ok(src.includes("zoomMode==='fitw'?byW:Math.min(byW,byH)"), '整页/适宽未分别计算');
  assert.ok(src.includes('lastFitScale=scale;'), '未记录适应模式下的实际比例');
  assert.ok(src.includes('function currentScale()'), '缺少当前比例读取');
});

test('无级缩放：缩放值持久化并在刷新后恢复', () => {
  assert.ok(src.includes('pdf-zoom-mode-v1'), '缺少持久化键');
  assert.ok(src.includes('function persistZoom'), '缺少持久化函数');
  assert.ok(src.includes('function restoreZoom'), '缺少恢复函数');
  assert.ok(src.includes('restoreZoom();'), '初始化时未恢复缩放值');
});

test('无级缩放：百分比可见，且下拉/键盘原有缩放方式不受影响', () => {
  assert.ok(view.includes('id="pdf-zoom-value"'), '缺少百分比显示元素');
  assert.ok(view.includes('id="pdf-zoom-custom"'), '下拉缺少承载任意百分比的当前值选项');
  assert.ok(src.includes('function updateZoomDisplay'), '缺少百分比更新逻辑');
  assert.ok(src.includes("$('pdf-zoom').onchange="), '下拉缩放失效');
  assert.ok(src.includes('function stepZoom'), '键盘 +/- 缩放失效');
  assert.ok(view.includes('Ctrl+滚轮'), '工具栏未提示 Ctrl+滚轮');
});
