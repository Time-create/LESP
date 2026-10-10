// V5 阶段 3：界面改版（Zotero 式三栏 + 顶栏三组下拉 + 右栏可收起）
// 重点验证「没有破坏原有功能」：侧栏 nav-item 仍在（e2e 依赖）、11 个入口一个不少、div 平衡。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function withServer(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-v5ui-'));
  const paths = require('../server/lib/paths');
  paths.setDataDir(tmp);
  const db = require('../server/db');
  db.initDb(tmp);
  const { createApp } = require('../server/app');
  const srv = createApp().listen(0, '127.0.0.1');
  return new Promise((resolve) => srv.once('listening', () => resolve({
    db, base: 'http://127.0.0.1:' + srv.address().port,
    done: () => { srv.close(); try { db.closeDb && db.closeDb(); } catch (e) { /* 忽略 */ } try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ } }
  }))).then((ctx) => fn(ctx).finally(ctx.done));
}

const ALL_ROUTES = [
  '/', '/sources/classics', '/sources/inscriptions', '/sources/documents', '/sources/archives',
  '/library/papers', '/library/books',
  '/writing/compilations', '/writing/notes', '/writing/ideas', '/writing/history-papers',
  '/settings', '/trash', '/themes'
];

function seedItem(db, module = 'paper', title = '测试条目') {
  return Number(db.dbRun(
    'INSERT INTO items (module,title,subtitle,status,fields,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    [module, title, '', '未读', '{}', db.now(), db.now()]
  ).lastInsertRowid);
}

/* ---------- 顶栏 ---------- */
test('顶栏存在：三组下拉 + 首页总览', () => withServer(async ({ base }) => {
  const html = await (await fetch(base + '/library/papers')).text();
  assert.ok(html.includes('class="topbar"'), '应有顶栏');
  for (const g of ['资料库', '写作', '系统']) {
    assert.ok(html.includes('data-menu-btn="' + g + '"'), '应有下拉组：' + g);
  }
  assert.ok(html.includes('topbar-home'), '应有首页总览入口');
}));

test('顶栏容纳全部 11+ 入口，一个不少（避免改版后找不到功能）', () => withServer(async ({ base }) => {
  const html = await (await fetch(base + '/library/papers')).text();
  const entries = ['古籍史料', '碑刻史料', '文书史料', '档案史料', '研究论文', '研究著作',
    '史料长编', '读书札记', '选题灵感', '史学论文', '数据与设置', '回收站', '主题分类'];
  for (const name of entries) {
    assert.ok(html.includes('>' + name + '<'), '顶栏应含入口：' + name);
  }
  // 逐条核对 href 都在
  for (const href of ['/sources/classics', '/sources/inscriptions', '/sources/documents', '/sources/archives',
    '/library/papers', '/library/books', '/writing/compilations', '/writing/notes', '/writing/ideas',
    '/writing/history-papers', '/settings', '/trash', '/themes']) {
    assert.ok(html.includes('href="' + href + '"'), '应含链接：' + href);
  }
}));

test('顶栏下拉是三组，不是四组（资料库/写作/系统）', () => withServer(async ({ base }) => {
  const html = await (await fetch(base + '/library/papers')).text();
  const n = (html.match(/class="topbar-menu"/g) || []).length;
  assert.strictEqual(n, 3, '应为 3 组，实际 ' + n);
}));

// V5.1：侧栏已移除，栏目全部迁到顶栏。以下两条由「侧栏保留」翻转为「侧栏移除」。
test('侧栏已移除：结构、样式与渲染逻辑都不再有侧栏', () => withServer(async ({ base }) => {
  const html = await (await fetch(base + '/library/papers')).text();
  assert.ok(!html.includes('class="sidebar"'), '不应再有侧栏元素');
  assert.ok(!html.includes('nav-item'), '不应再有 nav-item');
  assert.ok(!html.includes('app-body'), '不应再有 app-body 包裹层');
  assert.ok(!html.includes('nav-group-toggle'), '不应再有侧栏折叠脚本的痕迹');
  // 但导航入口一个都不能少
  for (const nav of ['首页总览', '古籍史料', '读书札记', '数据与设置', '主题分类']) {
    assert.ok(html.includes(nav), '顶栏应含入口：' + nav);
  }
}));

test('CSS 与内联兜底：主区占满、无侧栏占位宽度', () => withServer(async ({ base }) => {
  const html = await (await fetch(base + '/library/papers')).text();
  assert.ok(html.includes('<main class="main app-main">'), '主区应直接挂在 .app 下并占满');
  assert.ok(html.includes('.app { display: flex; flex-direction: column;'), '兜底 CSS 应为纵向布局');
  assert.ok(html.includes('.app > .main'), '兜底 CSS 应让主区占满剩余宽度');
  assert.ok(!html.includes('.app-body'), '兜底 CSS 不应再有 app-body');
  assert.ok(!html.includes('width: 146px'), '不应再有 146px 侧栏占位宽度');

  const css = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8');
  assert.ok(!css.includes('.app-body'), 'app.css 不应再有 .app-body');
  assert.ok(!css.includes('.sidebar {'), 'app.css 不应再有 .sidebar');
  assert.ok(!css.includes('.nav-item {'), 'app.css 不应再有 .nav-item');
  assert.ok(!css.includes('.theme-nav'), 'app.css 不应再有 .theme-nav（原先在侧栏底部）');
}));

test('品牌图标：尺寸与 mask 一致且不被裁切', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8');
  // 抽取 .brand-mark 块与 .topbar-brand .brand-mark 覆盖
  const markMatch = css.match(/\.brand-mark\s*\{([^}]*)\}/);
  assert.ok(markMatch, '必须有 .brand-mark 基础定义（含 mask 与背景色）');
  const mark = markMatch[1];
  assert.ok(mark.includes("brand-wordmark.svg"), '.brand-mark 必须引用 SVG mask');
  assert.ok(/background-color/.test(mark), '.brand-mark 必须设背景色（mask 只提供形状）');
  const w = mark.match(/width:\s*([\d.]+)px/);
  const h = mark.match(/height:\s*([\d.]+)px/);
  assert.ok(w && h, '.brand-mark 必须显式声明宽高');
  // SVG 原始比例 87.28×14.16 → 6.164:1；偏差过大即为裁切/变形
  const ratio = Number(w[1]) / Number(h[1]);
  assert.ok(Math.abs(ratio - 87.28 / 14.16) < 0.02, '宽高比应与 SVG 一致，实际 ' + ratio.toFixed(3));
  // mask 尺寸必须与元素尺寸一致，否则图形被裁
  assert.ok(mark.includes('/ ' + w[1] + 'px ' + h[1] + 'px'), 'mask 的 background-size 必须等于元素宽高，否则图形被裁切');
  // 顶栏覆盖不得再用不同尺寸
  const override = css.match(/\.topbar-brand\s+\.brand-mark\s*\{([^}]*)\}/);
  if (override) {
    const ow = override[1].match(/width:\s*([\d.]+)px/);
    const oh = override[1].match(/height:\s*([\d.]+)px/);
    assert.ok(ow && Number(ow[1]) === Number(w[1]) && Number(oh[1]) === Number(h[1]),
      '顶栏覆盖尺寸必须与基础定义一致，否则图标被裁切');
  }
  // 不参与收缩 + 不裁切
  const brand = css.match(/\.topbar-brand\s*\{([^}]*)\}/);
  assert.ok(brand, '必须有 .topbar-brand');
  assert.ok(/flex:\s*none/.test(brand[1]), '.topbar-brand 需 flex:none，避免窄窗口被压扁');
});

/* ---------- 三栏 ---------- */
test('三栏宽度：分类树 212 / 列表 300 / 详情自适应', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8');
  assert.ok(/\.col-tree\s*\{[^}]*width:\s*212px/.test(css), '分类树应为 212px');
  assert.ok(/\.col-list\s*\{[^}]*width:\s*300px/.test(css), '列表应为 300px');
  assert.ok(/\.col-detail\s*\{[^}]*flex:\s*1/.test(css), '详情区应为 flex:1');
  assert.ok(!/\.col-tree\s*\{[^}]*width:\s*(128|172)px/.test(css), '不应残留旧宽度 128/172');
  assert.ok(!/\.col-list\s*\{[^}]*width:\s*172px/.test(css), '列表不应残留 172px');
});

// V5.3 收尾：「收起详情栏 / 详情栏 / 完整页面」入口已按用户要求移除。
// 下面几项随之改为断言「确实已移除」，避免留下失效的期望。
test('三栏容器带 id；收起条已随入口移除', () => withServer(async ({ db, base }) => {
  seedItem(db);
  const html = await (await fetch(base + '/library/papers')).text();
  assert.ok(html.includes('id="three-col"'), '三栏容器应有 id');
  assert.ok(!html.includes('id="detail-collapse"'), '收起条应已移除');
  assert.ok(!html.includes('id="btn-detail-expand"'), '展开按钮应已移除');
  assert.ok(html.includes('too-narrow'), '应有窄窗提示');
}));

test('详情栏折叠相关状态与样式已清理', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8');
  assert.ok(!css.includes('.detail-collapse'), '收起条样式应已清理');
  assert.ok(!css.includes('detail-collapsed'), '折叠态样式应已清理');
  const js = fs.readFileSync(path.join(ROOT, 'public/js/detail-panel.js'), 'utf8');
  // 注释里提到旧键名不算，要看是否真的还在读写
  assert.ok(!/localStorage/.test(js), '不应再有折叠状态持久化');
  assert.ok(js.includes('loadPanel'), '右栏局部加载应保留');
});

test('详情内容里不再有「收起详情栏」按钮（detail-panel.js 仍负责局部加载）', () => withServer(async ({ db, base }) => {
  const id = seedItem(db, 'paper', '可收起条目');
  const html = await (await fetch(base + '/library/papers')).text();
  assert.ok(html.includes('/static/js/detail-panel.js'), '列表页应加载 detail-panel.js');
  const detail = await (await fetch(base + '/library/papers/' + id)).text();
  assert.ok(!detail.includes('id="btn-detail-collapse"'), '收起按钮应已移除');
  const js = fs.readFileSync(path.join(ROOT, 'public/js/detail-panel.js'), 'utf8');
  assert.ok(!js.includes('#btn-detail-collapse'), '脚本不应再处理收起按钮');
}));

/* ---------- 右栏局部加载 ---------- */
test('右栏片段接口 /api/items/:id/panel 返回详情 HTML', () => withServer(async ({ db, base }) => {
  const id = seedItem(db, 'paper', '右栏条目');
  const res = await fetch(base + '/api/items/' + id + '/panel');
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('右栏条目'), '应含条目标题');
  // 「完整页面」入口已移除
  assert.ok(!html.includes('panel-full'), '不应再有「完整页面」入口');
  assert.ok(!html.includes('panel-bar'), '不应再有 panel-bar 容器');
  const open = (html.match(/<div\b/g) || []).length;
  assert.strictEqual((html.match(/<\/div>/g) || []).length, open, '片段 div 必须平衡');
}));

test('右栏片段：不存在的条目返回 404 而非 500', () => withServer(async ({ base }) => {
  const res = await fetch(base + '/api/items/999999/panel');
  assert.strictEqual(res.status, 404);
}));

test('右栏片段保留录文/附件/笔记区块（未削功能）', () => withServer(async ({ db, base }) => {
  const id = seedItem(db, 'classics', '带录文的条目');
  db.dbRun('INSERT INTO excerpts (item_id,seq,text,created_at,updated_at) VALUES (?,1,?,?,?)', [id, '原文一句', db.now(), db.now()]);
  const html = await (await fetch(base + '/api/items/' + id + '/panel')).text();
  assert.ok(html.includes('原文一句'), '录文内容应保留');
  assert.ok(html.includes('tab-excerpts'), '应有录文 tab');
  // V5.3：条目页录文区的「新增录文」按钮已移除，此处不应再出现
  assert.ok(!html.includes('新增录文'), '条目页录文区按钮已移除');
  assert.ok(!html.includes('excerpt-actions'), '不应再有录文区按钮排容器');
}));

test('点条目改为右栏加载：脚本拦截普通点击但放行新标签', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/detail-panel.js'), 'utf8');
  assert.ok(js.includes("closest('a.li[data-item-id]')"), '应按条目链接拦截');
  assert.ok(js.includes('e.metaKey || e.ctrlKey || e.shiftKey'), '应放行修饰键点击（新标签）');
  assert.ok(js.includes('e.preventDefault()'), '普通点击应阻止整页跳转');
  assert.ok(js.includes('/api/items/'), '应调用右栏片段接口');
});

/* ---------- 不破坏原有功能 ---------- */
test('所有页面 div 平衡（历史教训：多余 </div> 会让整页塌陷）', () => withServer(async ({ base }) => {
  for (const route of ALL_ROUTES) {
    const html = await (await fetch(base + route)).text();
    const open = (html.match(/<div\b/g) || []).length;
    const close = (html.match(/<\/div>/g) || []).length;
    assert.strictEqual(close, open, route + ' 的 div 不平衡：' + open + ' vs ' + close);
  }
}));

test('所有页面渲染 200 且含顶栏', () => withServer(async ({ base }) => {
  for (const route of ALL_ROUTES) {
    const res = await fetch(base + route);
    assert.strictEqual(res.status, 200, route + ' 应可访问');
    const html = await res.text();
    assert.ok(html.includes('class="topbar"'), route + ' 应含顶栏');
  }
}));

test('详情页与列表页都加载 detail-panel.js（收起在两处都可用）', () => withServer(async ({ db, base }) => {
  const id = seedItem(db);
  const list = await (await fetch(base + '/library/papers')).text();
  const detail = await (await fetch(base + '/library/papers/' + id)).text();
  assert.ok(list.includes('/static/js/detail-panel.js'), '列表页应加载');
  assert.ok(detail.includes('/static/js/detail-panel.js'), '详情页应加载');
}));

test('PDF 阅读器（bare 模式）不受顶栏影响', () => withServer(async ({ db, base }) => {
  const id = seedItem(db, 'classics', '有附件的条目');
  db.dbRun('INSERT INTO attachments (item_id,filename,rel_path,size,mime,created_at) VALUES (?,?,?,?,?,?)',
    [id, 'a.pdf', 'files/attachments/x-a.pdf', 10, 'application/pdf', db.now()]);
  const attId = db.dbGet('SELECT id FROM attachments WHERE item_id=?', [id]).id;
  const html = await (await fetch(base + '/reader/' + attId)).text();
  assert.ok(html.includes('pdf-canvas'), '阅读器应正常渲染');
  assert.ok(!html.includes('class="topbar"'), 'bare 模式不应带顶栏');
}));

/* ---------- 拖拽归类未被破坏 ---------- */
test('拖拽归类仍可用：脚本仍加载且不依赖 window.prompt', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/item-drag.js'), 'utf8');
  // 只看真实调用，不看注释（注释里会提到历史实现）
  assert.ok(!/window\.prompt\s*\(/.test(js), 'Electron 不支持 prompt，不应有真实调用');
  assert.ok(/openForm\s*\(/.test(js), '应改用应用内表单');
  assert.ok(js.includes('module: MODULE'), '新建分类必须带 module（后端强制校验）');
  assert.ok(js.includes('tree.dataset.module'), '应从左栏容器读取 module');
  assert.ok(js.includes('application/x-lesp-item'), '应保留条目拖拽 MIME');
});

test('拖拽归类与右栏加载共存：捕获阶段抑制点击', () => {
  const drag = fs.readFileSync(path.join(ROOT, 'public/js/item-drag.js'), 'utf8');
  assert.ok(drag.includes('}, true);'), '应有捕获阶段监听（拖后点击抑制）');
  const panel = fs.readFileSync(path.join(ROOT, 'public/js/detail-panel.js'), 'utf8');
  assert.ok(!/stopPropagation\s*\(/.test(panel), '右栏脚本不应自己阻止传播（由拖拽脚本在捕获阶段负责）');
});

/* ---------- 空态概览页也能收起右栏（V5 收尾修复） ---------- */
test('折叠入口已移除，相关样式（内联与外链）均已清理', () => {
  const layout = fs.readFileSync(path.join(ROOT, 'server/views/layout.js'), 'utf8');
  assert.ok(!/\.crumb-collapse\s*\{/.test(layout), '内联的折叠按钮样式应已清理');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8');
  assert.ok(!css.includes('crumb-collapse'), 'app.css 的折叠样式应已清理');
  const page = fs.readFileSync(path.join(ROOT, 'server/views/page-item.js'), 'utf8');
  assert.ok(!page.includes('crumb-collapse'), '页面不应再引用折叠按钮类名');
});

// V5.3 收尾：概览态（空态 / 未选中条目）也不再渲染折叠入口，
// 且内联的 .crumb-collapse 兜底样式一并移除（按钮已不存在，留着是死代码）。
test('概览态不再渲染折叠入口，内联兜底样式也已清理', () => withServer(async ({ db, base }) => {
  seedItem(db, 'classics', '有条目');
  seedItem(db, 'inscription', '碑刻一条');
  for (const p of ['/library/books', '/library/papers', '/sources/classics', '/sources/inscriptions']) {
    const html = await (await fetch(base + p)).text();
    assert.ok(!html.includes('btn-detail-collapse'), p + ' 不应有收起入口');
    assert.ok(!html.includes('btn-detail-expand'), p + ' 不应有展开入口');
  }
  const layout = fs.readFileSync(path.join(ROOT, 'server/views/layout.js'), 'utf8');
  assert.ok(!layout.includes('.crumb-collapse'), '内联兜底样式应已清理');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8');
  assert.ok(!css.includes('crumb-collapse'), 'app.css 中的折叠样式应已清理');
}));
