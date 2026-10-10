// V5.2 五项修复的回归测试。
// 每条用例都对着本轮实际修掉的缺陷，防止回退：
//   1. settings.js的 byId 跨作用域ReferenceError
//   2. 顶栏在当前页所属分组上自动展开下拉（点分类后顶部弹窗）
//   3. 录文分类管理入口在论文/著作页无响应 + 一键弹两个对话框
//   4. 长编与札记不支持条目拖拽归类
//   5. Electron 顶部「工作台/编辑/视图」菜单冗余
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ================= 1. settings.js byId 作用域 ================= */

test('settings.js：byId 定义在文件级作用域，三个 IIFE 都能取到', () => {
  const src = read('public/js/settings.js');
  const defLine = src.split('\n').findIndex((l) => /const byId\s*=/.test(l));
  assert.ok(defLine >= 0, '应存在 byId 定义');
  // 定义必须落在所有 IIFE 之外（即不在任何 "(function () {" 之后仍未闭合的块里）
  const before = src.slice(0, src.indexOf('const byId ='));
  assert.ok(!/\(function\s*\(\)\s*\{/.test(before.replace(/\/\*[\s\S]*?\*\//g, '')),
    'byId 不能定义在某个 IIFE 内部，否则后面的 IIFE 取不到（本轮原始缺陷）');
});

test('settings.js：执行到第三个 IIFE 不抛 ReferenceError', () => {
  const src = read('public/js/settings.js');
  const mk = () => ({
    addEventListener() {}, disabled: false, textContent: '', value: '', style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    querySelector: () => null, querySelectorAll: () => [], append() {}, dataset: {}
  });
  const ids = ['btn-backup', 'btn-auto', 'btn-move', 'btn-add-field', 'btn-classify-migrate',
    'classify-state', 'sync-port', 'sync-token', 'btn-new-token', 'btn-sync-log', 'sync-log',
    'new-dir', 'field-module', 'field-key', 'field-label', 'cookie-input',
    'btn-save-cookie', 'btn-clear-cookie'];
  const els = {};
  for (const id of ids) els[id] = mk();
  const sandbox = {
    document: {
      getElementById: (id) => els[id] || null, addEventListener() {},
      createElement: () => mk(), querySelector: () => null, querySelectorAll: () => [], body: mk()
    },
    window: {}, location: { reload() {} }, localStorage: { getItem: () => null, setItem() {} },
    api: async () => ({ migrated: true }), toast() {}, confirmBox: () => true,
    desktopBridge: null, console
  };
  const keys = Object.keys(sandbox);
  assert.doesNotThrow(() => new Function(...keys, src)(...keys.map((k) => sandbox[k])),
    'settings.js 应能完整执行，不因 byId 未定义而中断');
});

test('settings.js：迁移分类按钮真的绑上了 click', () => {
  const src = read('public/js/settings.js');
  const mk = () => ({
    addEventListener(t) { if (t === 'click') globalThis.__clicks = (globalThis.__clicks || 0) + 1; },
    disabled: false, textContent: '', value: '', style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    querySelector: () => null, querySelectorAll: () => [], append() {}, dataset: {}
  });
  // 给全量 id，否则脚本里的 api 回调会摸到 null（那是桩不完整，不是产品缺陷）
  const ids = ['btn-classify-migrate', 'classify-state', 'sync-port', 'sync-token', 'sync-log',
    'btn-new-token', 'btn-sync-log', 'btn-backup', 'btn-auto', 'btn-move', 'btn-add-field',
    'new-dir', 'field-module', 'field-key', 'field-label', 'cookie-input',
    'btn-save-cookie', 'btn-clear-cookie'];
  const els = {};
  for (const id of ids) els[id] = mk();
  const sandbox = {
    document: {
      getElementById: (id) => els[id] || null, addEventListener() {},
      createElement: () => mk(), querySelector: () => null, querySelectorAll: () => [], body: mk()
    },
    window: {}, location: { reload() {} }, localStorage: { getItem: () => null, setItem() {} },
    api: async () => ({}), toast() {}, confirmBox: () => true, desktopBridge: null, console
  };
  globalThis.__clicks = 0;
  const keys = Object.keys(sandbox);
  new Function(...keys, src)(...keys.map((k) => sandbox[k]));
  assert.ok(globalThis.__clicks > 0, '「迁移分类数据」等按钮应绑上 click（本轮原始缺陷是整块失效）');
});

/* ================= 2. 顶栏不再自动展开 ================= */

test('顶栏：不再按当前页自动展开下拉，也不再持久化展开状态', () => {
  const src = read('server/views/layout.js');
  const start = src.indexOf('(function () {\n  const menus');
  assert.ok(start >= 0, '应能找到顶栏脚本');
  const script = src.slice(start, src.indexOf('})();', start) + 5);
  assert.ok(!/localStorage/.test(script), '顶栏脚本不应再读写 localStorage（本轮原始缺陷：展开态永久生效）');
  assert.ok(!/hasActive\s*\|\|/.test(script), '不应再有「当前页所在组自动展开」的判定');
  assert.ok(!/'topbar-open'/.test(src), '不应再保留 topbar-open 这个localStorage 键');
});

test('顶栏：初始一律收起，当前栏目用按钮高亮指示', () => {
  const src = read('server/views/layout.js');
  const start = src.indexOf('(function () {\n  const menus');
  const script = src.slice(start, src.indexOf('})();', start) + 5);
  // 简易桩：三个菜单，资料库组含当前页项
  const mkMenu = (title, active) => {
    const arrow = { textContent: '' };
    const btn = {
      attrs: {}, cls: new Set(), _h: {},
      querySelector: (s) => (s === '.topbar-arrow' ? arrow : null),
      addEventListener(t, f) { btn._h[t] = f; }, setAttribute(k, v) { btn.attrs[k] = v; },
      classList: {
        add: (c) => btn.cls.add(c), remove: (c) => btn.cls.delete(c),
        toggle: (c, on) => { if (on) btn.cls.add(c); else btn.cls.delete(c); }
      }
    };
    const itemCls = new Set(['topbar-item']);
    if (active) itemCls.add('topbar-on');
    const dropCls = new Set();
    const drop = {
      classList: {
        toggle: (c, on) => { if (on) dropCls.add(c); else dropCls.delete(c); },
        add: (c) => dropCls.add(c), remove: (c) => dropCls.delete(c), contains: (c) => dropCls.has(c)
      }
    };
    const item = { classList: { contains: (c) => itemCls.has(c) } };
    return {
      menu: {
        dataset: { menu: title },
        querySelector(s) {
          if (s === '[data-menu-btn]') return btn;
          if (s === '.topbar-drop') return drop;
          if (s === '.topbar-item.topbar-on') return active ? item : null;
          if (s === '.topbar-item') return item;
          return null;
        }
      }, btn, dropCls
    };
  };
  const A = mkMenu('资料库', true), B = mkMenu('写作', false), C = mkMenu('系统', false);
  const menus = [A, B, C];
  const docHandlers = {};
  new Function('document', 'localStorage', 'console', script)(
    {
      querySelectorAll: (s) => (s === '.topbar-menu' ? menus.map((x) => x.menu) : []),
      addEventListener(t, f) { docHandlers[t] = f; }
    },
    { getItem: () => '["资料库"]', setItem() { throw new Error('不应再写 localStorage'); } },
    console
  );
  // 初始：三组下拉都收起（这是本轮修复的核心）
  for (const m of menus) assert.ok(!m.dropCls.has('topbar-drop-on'),
    m.menu.dataset.menu + ' 初始不应展开');
  // 只有当前页所在组的按钮高亮，用于指示所在栏目
  assert.ok(A.btn.cls.has('topbar-btn-on'), '当前页所属组按钮应高亮');
  assert.ok(!B.btn.cls.has('topbar-btn-on') && !C.btn.cls.has('topbar-btn-on'),
    '非当前组的按钮不应高亮');
  // 手动点击仍可展开，且同时只开一组
  B.btn._h.click({ stopPropagation() {} });
  assert.ok(B.dropCls.has('topbar-drop-on'), '点按钮应展开该组');
  A.btn._h.click({ stopPropagation() {} });
  assert.ok(A.dropCls.has('topbar-drop-on') && !B.dropCls.has('topbar-drop-on'),
    '同时只应开一组');
  docHandlers.click();
  for (const m of menus) assert.ok(!m.dropCls.has('topbar-drop-on'), '点空白处应全部收起');
});

/* ================= 3. 录文分类管理 ================= */

test('录文树脚本：详情页不再加载（分类面板已于 V5.3 移出条目页）', () => {
  const src = read('server/routes/pages.js');
  const detail = src.slice(src.indexOf("router.get(m.route + '/:id'"));
  // 只看真正的脚本注入语句，注释里提到文件名不算
  assert.ok(!/scripts\.push\(['"]\/static\/js\/excerpt-tree\.js/.test(detail),
    'excerpt-tree.js 只服务于已删除的「录文分类（全局）」面板，不应再注入详情页');
  // 分类的查阅与维护已迁到「资料库 → 录文」
  assert.ok(src.includes("router.get('/excerpts'"), '应存在 /excerpts 路由');
  const hub = src.slice(src.indexOf("router.get('/excerpts'"));
  assert.ok(hub.includes('excerpts-hub.js'), '录文集页应加载 excerpts-hub.js');
  assert.ok(hub.includes('classify-actions.js'), '录文集页应加载 classify-actions.js（分类增删改）');
});

test('录文树脚本：不再自行绑定 data-excerpt-action="folders"（避免弹两个窗）', () => {
  const src = read('public/js/excerpt-tree.js');
  // 只看真正的代码，注释里提到该属性是解释「为什么不再绑定」，不应误判
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/querySelector\(\[?['"]\[data-excerpt-action=["']folders/.test(code),
    'excerpt-tree.js 不应再绑 folders 按钮——它已由全局 excerpts.js 处理，重复绑定会弹两个对话框');
  assert.ok(src.includes("getElementById('btn-manage-folders')"),
    '「管理分类」按钮的绑定应保留');
});

test('录文分类增删改：删除走带影响预览与二次确认的公共通道', () => {
  const src = read('public/js/classify-actions.js');
  assert.ok(/NEEDS_CONFIRM\s*=\s*\['folder',\s*'theme'\]/.test(src),
    '录文分类删除必须带 confirm=true');
  assert.ok(/confirmFlag\s*=.*\?confirm=true/.test(src),
    '删除 URL 应拼 confirm=true（否则服务端一律 400）');
  assert.ok(/url = ENDPOINTS\[scope\] \+ '\/' \+ o\.id \+ confirmFlag/.test(src),
    '删除请求应真的用上 confirmFlag');
  assert.ok(src.includes('/impact'), '删除前应先取影响预览');
  assert.ok(/confirmBox/.test(src), '删除应有二次确认');
  assert.ok(/toast\('删除失败：/.test(src), '删除失败应有错误提示');
});

/* ================= 4. 长编与札记拖拽 ================= */

test('拖拽归类：按 data-module 推导 assign 的 target', () => {
  const src = read('public/js/item-drag.js');
  assert.ok(/const TARGET = \(MODULE === 'compilation' \|\| MODULE === 'note'\) \? MODULE : 'item'/.test(src),
    '应按模块推导 target，长编/札记走各自关联表');
  assert.ok(/target: TARGET/.test(src), 'assign 请求应传推导出的 target');
  assert.ok(!/target: 'item'/.test(src), '不应再写死 target: item');
});

test('拖拽归类：失败时不刷新并给出可重试的提示', () => {
  const src = read('public/js/item-drag.js');
  const catchBlock = src.slice(src.indexOf('} catch (err) {'));
  assert.ok(catchBlock.includes('归类失败'), '失败应有中文错误提示');
  assert.ok(/已保持原归属不变|保持原归属/.test(catchBlock), '提示应说明归属未被改动（回退语义）');
  const tail = catchBlock.slice(0, catchBlock.indexOf('} catch (err) {') === -1 ? 200 : 300);
  assert.ok(!/location\.reload/.test(tail), '失败分支不应刷新页面（刷新会掩盖回退）');
});

test('长编列表项：带 draggable 与拖拽所需数据属性', () => {
  const src = read('server/views/page-compilation.js');
  assert.ok(/draggable="true"/.test(src), '长编列表项应可拖拽');
  assert.ok(/data-item-id=/.test(src), '应有 data-item-id');
  assert.ok(/data-collections=/.test(src), '应有 data-collections（用于重复归类判定）');
  assert.ok(/collection_compilations/.test(src), 'data-collections 应来自长编的关联表');
});

test('札记列表项：带 draggable 与拖拽所需数据属性', () => {
  const src = read('server/views/page-notes.js');
  assert.ok(/draggable="true"/.test(src), '札记列表项应可拖拽');
  assert.ok(/data-item-id=/.test(src), '应有 data-item-id');
  assert.ok(/data-collections=/.test(src), '应有 data-collections');
  assert.ok(/collection_notes/.test(src), 'data-collections 应来自札记的关联表');
});

test('长编与札记列表页都加载 item-drag.js', () => {
  const src = read('server/routes/pages.js');
  for (const route of ["router.get('/writing/compilations'", "router.get('/writing/notes'"]) {
    const seg = src.slice(src.indexOf(route), src.indexOf(route) + 400);
    assert.ok(seg.includes('/static/js/item-drag.js'), route + ' 应加载 item-drag.js');
  }
});

test('拖拽视觉反馈：脚本用到的类名都有对应样式', () => {
  const css = read('public/css/app.css');
  for (const cls of ['.li-dragging', '.item-dragging', '.drop-into', '.item-drop-new', '.dz-over']) {
    assert.ok(css.includes(cls), 'app.css 缺少 ' + cls + ' 的样式（拖起来会没有任何反馈）');
  }
});

/* ================= 5. 菜单移除与残留清理 ================= */

test('Electron 菜单：不再构建「工作台/编辑/视图」', () => {
  const src = read('desktop/main.js');
  // 原函数名 menus() 已随职责变化改为 setupShell()（现在只负责移除菜单 + 补快捷键）
  const fn = src.slice(src.indexOf('function setupShell()'), src.indexOf('function setupShell()') + 1200);
  assert.ok(fn.includes('Menu.setApplicationMenu(null)'), '应传 null彻底移除菜单栏');
  assert.ok(!/label: '工作台'/.test(src), '不应再有「工作台」菜单');
  assert.ok(!/label: '编辑'/.test(src), '不应再有「编辑」菜单');
  assert.ok(!/label: '视图'/.test(src), '不应再有「视图」菜单');
  assert.ok(src.includes('setupShell();'), '启动流程应调用 setupShell()');
  assert.ok(!/\bmenus\(\)/.test(src), '不应再残留 menus() 调用（函数已重命名）');
});

test('菜单移除后：返回/前进仍可用（补窗口级快捷键）', () => {
  const src = read('desktop/main.js');
  assert.ok(/before-input-event/.test(src), '应监听 before-input-event 补回返回/前进');
  assert.ok(/ArrowLeft/.test(src) && /ArrowRight/.test(src), '应处理左右方向键');
  assert.ok(/navigationHistory/.test(src), '应调用 navigationHistory');
});

test('残留清理：桌面侧不再引用已删除的侧栏 nav-item', () => {
  assert.ok(!read('desktop/main.js').includes('.nav-item'),
    'desktop/main.js 冒烟逻辑仍查 .nav-item，会恒为 0');
  assert.ok(!read('scripts/verify-release.js').includes('nav-item'),
    'verify-release.js 仍在等 .nav-item，会永久等待');
  assert.ok(read('scripts/verify-release.js').includes('topbar-item'),
    'verify-release.js 应改等顶栏条目');
});
/* ================= 录文分类：归类入口与管理面板同步 ================= */

test('录文分类：提供按条目批量归类的接口与服务', () => {
  const svc = read('server/services/taxonomy.js');
  assert.ok(/function assignItemFolders/.test(svc), '应有 assignItemFolders（按条目批量归类）');
  assert.ok(/function itemFolderIds/.test(svc), '应有 itemFolderIds（回显当前归类）');
  const route = read('server/routes/taxonomy.js');
  assert.ok(route.includes("/excerpt-folders/by-item/:itemId"), '应有 by-item 路由');
  // 原来的单条录文归类接口前端从未调用过 —— 这正是「分类无效」的缺口
  const callers = ['excerpts.js', 'excerpt-tree.js', 'classify-actions.js', 'classify-manager.js']
    .filter((f) => read('public/js/' + f).includes('/api/excerpt-folders/assign'));
  assert.strictEqual(callers.length, 0,
    '旧接口 /excerpt-folders/assign 不应再被前端直接调用（应走 by-item 批量入口）');
});

test('录文区：条目页已移除「录文分类（全局）」面板（V5.3 迁至录文集）', () => {
  const src = read('server/views/page-item.js');
  assert.ok(!src.includes('id="btn-assign-folders"'), '「归类本条目」应已移出条目页');
  assert.ok(!src.includes('id="btn-manage-folders"'), '「管理分类」应已移出条目页');
  assert.ok(!src.includes('录文分类（全局）'), '分类面板标题应已移除');
  assert.ok(!src.includes('excerptFolderTreeHtml'), '分类树渲染函数应已删除（死代码）');
  // 录文列表本身要保留 —— 录文从条目页录入
  assert.ok(src.includes('id="tab-excerpts"'), '录文页签应保留');
  assert.ok(src.includes('data-excerpt-card'), '录文卡片应保留');
});

test('录文树脚本：为「归类本条目」绑定批量归类逻辑', () => {
  const src = read('public/js/excerpt-tree.js');
  assert.ok(/getElementById\('btn-assign-folders'\)/.test(src), '应绑定归类按钮');
  assert.ok(src.includes('/api/excerpt-folders/by-item/'), '应调用 by-item 归类接口');
  assert.ok(src.includes('folderIds'), '应提供多选字段');
  // 无录文时也要给出明确说明，而不是静默失败
  assert.ok(/本条目还没有录文/.test(src), '无录文时应提示「新增录文后自动套用」');
});

test('分类管理面板：结构性改动后刷新页面（否则左侧树不更新＝「无效」）', () => {
  const src = read('public/js/classify-manager.js');
  const idx = src.indexOf('const done');
  assert.ok(idx >= 0, '应定义统一的完成回调');
  const decl = src.slice(idx, src.indexOf('\n', idx));
  assert.ok(decl.includes('location.reload()'), '完成后应刷新页面，让左侧树同步');
  // 五个操作都必须走这个回调
  const ops = (src.match(/onDone: done/g) || []).length;
  assert.strictEqual(ops, 5, '新建/新建子级/编辑/移动/删除 五处都应走 done（实际 ' + ops + '）');
  assert.ok(!/onDone: refresh/.test(src), '不应再有只刷面板、不刷页面的 onDone: refresh');
});

/* ================= 静态资源路径与错误可见性 ================= */

test('品牌图标：URL 与实际文件位置一致（此前一直 404，logo 从未显示）', () => {
  const fsx = require('node:fs');
  const pathx = require('node:path');
  const ROOTX = path.join(__dirname, '..');
  // app.use('/static', express.static(public)) ⇒ public/static/svg/x 对应 URL /static/svg/x
  assert.ok(fsx.existsSync(path.join(ROOTX, 'public', 'static', 'svg', 'brand-wordmark.svg')),
    '图标文件必须放在 public/static/svg/ 下才能被 /static 挂载点访问到');
  const css = read('public/css/app.css');
  const layout = read('server/views/layout.js');
  for (const [tag, src] of [['app.css', css], ['layout.js', layout]]) {
    assert.ok(src.includes("/static/svg/brand-wordmark.svg"), tag + ' 应引用 /static/svg/brand-wordmark.svg');
    assert.ok(!src.includes("'/svg/brand-wordmark.svg'"), tag + ' 不应引用未挂载的 /svg/ 路径');
  }
});

test('前端异常必须可见：全局错误上报 + showModal 兜底 + 事件委托 try/catch', () => {
  // 没有开发者工具入口时，脚本抛错对用户就是「点了没反应」
  const common = read('public/js/common.js');
  assert.ok(/addEventListener\('error'/.test(common), 'common.js 应监听全局 error 并显示');
  assert.ok(/addEventListener\('unhandledrejection'/.test(common), '应监听未处理的 Promise 拒绝');

  const dialog = read('public/js/dialog.js');
  assert.ok(/try\s*\{[\s\S]*dialog\.showModal\(\)[\s\S]*\}\s*catch/.test(dialog),
    'showModal 应有 try/catch 兜底，失败时退回非模态展示');

  // async 监听器里抛错不会中断脚本，必须整体兜住
  for (const f of ['excerpts.js', 'excerpt-tree.js']) {
    const src = read('public/js/' + f);
    assert.ok(/catch \(err\)/.test(src), f + ' 的事件处理应有 catch，避免静默失败');
    assert.ok(/event\.target instanceof Element|e\.target instanceof Element/.test(src),
      f + ' 应把 event.target 兜到 Element（文本节点没有 closest）');
  }
});

/* ================= 桌面视口布局：页面不得被内容撑高 ================= */

test('应用外壳固定视口高度并内部滚动（否则按钮落在视口外点不到）', () => {
  const css = read('public/css/app.css');
  // 此前是 min-height:100vh，页面被内容撑到数千 px，小窗口下按钮落在首屏之外
  assert.ok(/\.app\s*\{[^}]*height:\s*100vh/.test(css),
    '.app 必须用 height:100vh（min-height 会被内容撑高）');
  assert.ok(/\.app\s*\{[^}]*overflow:\s*hidden/.test(css), '.app 应禁止自身溢出');
  assert.ok(/\.app > \.main\s*\{[^}]*overflow-y:\s*auto/.test(css),
    '.main 应内部滚动（overflow-y:auto）');
  assert.ok(!/\.app\s*\{[^}]*min-height:\s*100vh/.test(css),
    '不能再用 min-height:100vh（这正是「点了没反应」的根因）');
  assert.ok(/body\s*\{[^}]*overflow:\s*hidden/.test(css), 'body 应禁止整体滚动');
});

/* ================= 详情页头部按钮不应被压成竖排 ================= */

test('详情页头部：按钮组不被长标题压成竖排', () => {
  const css = read('public/css/app.css');
  assert.ok(/\.detail-head > :first-child\s*\{[^}]*min-width:\s*0/.test(css),
    '标题容器需 min-width:0，否则长标题会把按钮压成竖排单字');
  assert.ok(/\.detail-actions\s*\{[^}]*flex:\s*0 0 auto/.test(css),
    '.detail-actions 应禁止收缩（flex:0 0 auto）');
  assert.ok(/\.detail-actions button\s*\{[^}]*white-space:\s*nowrap/.test(css),
    '按钮文字不应换行（white-space:nowrap）');
});
