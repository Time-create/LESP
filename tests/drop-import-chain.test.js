// 拖拽导入链路核对：用真实 DataTransfer 形状在 DOM 桩里执行 drop-import.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// 端到端用例需要真实数据库（页面渲染走服务端）
const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lesp-drop-'));
const paths = require('../server/lib/paths');
paths.setDataDir(tmp);
const db = require('../server/db');
db.initDb(tmp);

const ROOT = path.join(__dirname, '..');

/* ---------------- 最小 DOM 桩 ---------------- */
function makeEl(tag, attrs = {}, children = []) {
  const el = {
    tagName: tag.toUpperCase(), dataset: {}, children, attrs, hidden: false, textContent: '',
    classList: {
      _set: new Set(String(attrs.class || '').split(/\s+/).filter(Boolean)),
      add(c) { this._set.add(c); el.attrs.class = [...this._set].join(' '); },
      remove(c) { this._set.delete(c); el.attrs.class = [...this._set].join(' '); },
      contains(c) { return this._set.has(c); }
    },
    parentElement: null, _listeners: {},
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { const a = this._listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    dispatch(type, ev) {
      ev.target = ev.target || this;
      ev.preventDefault = ev.preventDefault || (() => { ev.defaultPrevented = true; });
      ev.stopPropagation = ev.stopPropagation || (() => { ev.cancelBubble = true; });
      for (const fn of (this._listeners[type] || []).slice()) fn.call(this, ev);
      const inline = this['on' + type];
      if (typeof inline === 'function') inline.call(this, ev);
      if (ev.bubbles !== false && !ev.cancelBubble && this.parentElement) this.parentElement.dispatch(type, ev);
    },
    closest(sel) { let c = this; while (c) { if (matches(c, sel)) return c; c = c.parentElement; } return null; },
    querySelector(sel) { return q(this, sel)[0] || null; },
    querySelectorAll(sel) { return q(this, sel); },
    getAttribute(n) { return this.attrs[n] === undefined ? null : this.attrs[n]; },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this); }
  };
  Object.defineProperty(el, 'id', {
    get() { return this.attrs.id || ''; },
    set(v) { this.attrs.id = v; }
  });
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-(\w)/g, (m, c) => c.toUpperCase())] = v;
  }
  for (const c of children) c.parentElement = el;
  return el;
}
function matches(el, sel) {
  const tokens = sel.match(/^[a-zA-Z][a-zA-Z0-9]*|#[-\w]+|\.[-\w]+|\[[^\]]+\]/g);
  if (!tokens) return false;
  for (const t of tokens) {
    if (t.startsWith('#')) { if (el.attrs.id !== t.slice(1)) return false; }
    else if (t.startsWith('.')) { if (!String(el.attrs.class || '').split(/\s+/).includes(t.slice(1))) return false; }
    else if (t.startsWith('[')) {
      const m = t.slice(1, -1).match(/^([-\w]+)(?:=["']?([^"'\]]*)["']?)?$/);
      if (!m || el.attrs[m[1]] === undefined) return false;
      if (m[2] !== undefined && String(el.attrs[m[1]]) !== m[2]) return false;
    } else if (el.tagName !== t.toUpperCase()) return false;
  }
  return true;
}
function q(root, sel) {
  const parts = sel.split(/\s*>\s*/);
  let cur = [root];
  for (const part of parts) { const next = []; for (const n of cur) collect(n, part, next); cur = next; }
  return cur;
}
function collect(node, sel, out) {
  for (const c of node.children) { if (matches(c, sel)) out.push(c); collect(c, sel, out); }
}

/* ---------------- 页面骨架 ---------------- */
function makePage() {
  const row = makeEl('div', { class: 'tree-row' }, [
    makeEl('button', { 'data-toggle': '7' }),
    makeEl('a', { class: 'tree-item', 'data-collection': '7' })
  ]);
  const node = makeEl('li', { class: 'tree-node', 'data-id': '7', 'data-parent': '' }, [row]);
  const tree = makeEl('aside', { class: 'col-tree' }, [makeEl('div', { class: 'tree-zone' }, [node])]);
  const body = makeEl('body', {}, [tree]);
  const win = makeEl('window', {}, []);
  const document = makeEl('html', {}, [body]);
  document.parentElement = win;          // 浏览器里 window 是传播链终点
  Object.assign(document, {
    body,
    querySelector: (sel) => (sel === '.col-tree' ? tree : null),
    querySelectorAll: () => [],
    getElementById: (id) => (id === 'drop-hint' ? body.children.find((c) => c.attrs.id === 'drop-hint') || null : null),
    createElement: (tag) => makeEl(tag)
    // 不覆盖 addEventListener：事件需要记在 _listeners 上供断言
  });
  return { body, tree, document, window: win };
}

/* ---------------- 调用记录 ---------------- */
function makeCalls() {
  const calls = { apiCalls: [], fetchCalls: [], toast: [], form: null, confirm: [], formDataAppends: 0 };
  calls.api = async (url, opts) => { calls.apiCalls.push({ url, opts }); return { id: 42, name: '测试' }; };
  calls.fetch = async (url, opts) => { calls.fetchCalls.push({ url, opts }); return { ok: true, text: async () => 'ok' }; };
  calls.FormData = class { append() { calls.formDataAppends += 1; } };
  calls.openForm = (o) => { calls.form = o; if (o && o.onCancel) o.onCancel(); return makeEl('dialog'); };
  calls.confirmBox = (m) => { calls.confirm.push(m); return false; };
  calls.toastFn = (m) => calls.toast.push(m);
  return calls;
}

/* ---------------- 执行 drop-import.js ---------------- */
function runDropImport(page, module, calls, opts = {}) {
  const file = opts.file || { name: '宋代职官考.pdf', size: 2048, arrayBuffer: async () => new ArrayBuffer(16), type: 'application/pdf' };
  const dataTransfer = opts.dataTransfer || {
    types: ['Files'],
    files: [file],
    items: [{ kind: 'file', type: 'application/pdf', getAsFile: () => file }]
  };
  const location = {
    pathname: '/library/papers', href: '',
    reload() { location.reloadCount = (location.reloadCount || 0) + 1; }   // 浏览器里存在
  };
  const windowObj = page.window;   // 复用页面 window（传播链顶端）
  // 浏览器里 FormData / fetch 等是 window 上的全局，桩需保持一致
  Object.assign(windowObj, {
    FormData: calls.FormData,
    fetch: calls.fetch,
    __MODULE__: module,
    __MODULE_ROUTE__: '/library/papers',
    __FIELDS__: [{ key: 'author' }, { key: 'journal' }, { key: 'source' }],
    toast: calls.toastFn
  });
  windowObj.window = windowObj;   // window.window === window
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'drop-import.js'), 'utf8');
  new Function('window', 'document', 'location', 'api', 'toast', 'confirmBox', 'openForm', 'fetch', 'FormData', 'localStorage', src + '\n//# sourceURL=drop-import.js')
    (windowObj, page.document, location, calls.api, calls.toastFn, calls.confirmBox, calls.openForm, calls.fetch, calls.FormData, { getItem: () => null, setItem: () => {} });
  page.window = windowObj;
  return { dataTransfer, file };
}

const tick = () => new Promise((r) => setTimeout(r, 30));

/* ---------------- 用例 ---------------- */
test('拖入提示：dragenter/dragover 应给出可见反馈', () => {
  const page = makePage();
  const calls = makeCalls();
  const { dataTransfer } = runDropImport(page, 'paper', calls);
  assert.ok((page.window._listeners.drop || []).length, 'drop 监听应注册在 window 上');
  assert.ok((page.window._listeners.dragover || []).length, 'dragover 监听应注册在 window 上');
  page.document.dispatch('dragenter', { dataTransfer, bubbles: true });
  page.document.dispatch('dragover', { dataTransfer, bubbles: true });
  const hint = page.body.children.find((c) => c.attrs.id === 'drop-hint');
  assert.ok(hint, '拖入时应出现全屏提示遮罩');
  assert.strictEqual(hint.hidden, false, '提示遮罩应可见');
  assert.ok(/松开鼠标/.test(hint.textContent), '提示文案应说明松开即可导入');
});

test('全链路：drop 后应创建条目并上传原件', async () => {
  const page = makePage();
  const calls = makeCalls();
  const { dataTransfer } = runDropImport(page, 'book', calls);
  await page.document.dispatch('drop', { dataTransfer, bubbles: true });
  await tick();
  const created = calls.apiCalls.find((c) => c.url === '/api/items');
  assert.ok(created, '应调用 POST /api/items，实际：' + JSON.stringify(calls.apiCalls.map((c) => c.url)));
  assert.strictEqual(created.opts.body.module, 'book');
  assert.ok(calls.fetchCalls.some((f) => String(f.url).includes('/api/attachments/upload')), '应上传原件');
  assert.strictEqual(calls.formDataAppends, 1, 'FormData 应带一个文件');
  assert.ok(calls.toast.some((t) => /已导入/.test(t)), '应提示完成，实际：' + JSON.stringify(calls.toast));
});

test('非 PDF 文件：应被拒绝并明确提示', async () => {
  const page = makePage();
  const calls = makeCalls();
  const docx = { name: '笔记.docx', size: 100, arrayBuffer: async () => new ArrayBuffer(8) };
  const dt = { types: ['Files'], files: [docx], items: [{ kind: 'file', getAsFile: () => docx }] };
  runDropImport(page, 'paper', calls, { dataTransfer: dt });
  await page.document.dispatch('drop', { dataTransfer: dt, bubbles: true });
  await tick();
  assert.ok(calls.toast.some((t) => /只支持拖入 PDF/.test(t)), '应提示仅支持 PDF，实际：' + JSON.stringify(calls.toast));
  assert.ok(!calls.apiCalls.some((c) => c.url === '/api/items'), '不应创建条目');
});

test('拖到分类节点上也不自动归类（方案 A：分类留到详情页自己选）', async () => {
  const page = makePage();
  const calls = makeCalls();
  const { dataTransfer } = runDropImport(page, 'paper', calls);
  const row = page.tree.querySelector('.tree-row');
  row.dispatch('dragover', { dataTransfer, bubbles: true });
  await page.document.dispatch('drop', { dataTransfer, bubbles: true });
  await tick();
  assert.ok(calls.apiCalls.some((c) => c.url === '/api/items'), '仍应正常建条目');
  assert.ok(!calls.apiCalls.some((c) => String(c.url).includes('/assign')), '不应自动归类');
  assert.ok(!calls.form, '不应弹窗');
});

test('非目标栏目：应明确提示「本页不支持」而非静默无反应', () => {
  const page = makePage();
  const calls = makeCalls();
  runDropImport(page, 'compilation', calls);
  const registered = ['drop', 'dragover', 'dragenter'].some((k) => (page.window._listeners[k] || []).length);
  assert.ok(!registered, '非目标栏目不注册拖拽监听');
  const diag = page.window.__dropImport;
  assert.ok(diag, '应暴露诊断对象 window.__dropImport');
  assert.strictEqual(diag.enabled, false);
  assert.match(diag.reason, /不支持|范围/);
});

// V5.3 收尾：「或点击选择 PDF 文件」兜底按钮已按用户要求移除
// （拖拽导入是唯一途径；V5.1 已关闭沙箱恢复文件拖放，功能可用）。
// 这里断言按钮确实不再注入，同时拖拽链路本身不受影响。
test('兜底入口已移除：不再注入「点击选择 PDF」按钮', () => {
  const page = makePage();
  const calls = makeCalls();
  runDropImport(page, 'paper', calls);
  assert.ok(!page.body.children.find((c) => c.attrs.id === 'btn-pick-pdf'), '不应再注入兜底按钮');
  assert.ok(!page.body.children.find((c) => c.attrs.id === 'pick-pdf-input'), '不应再有隐藏 file 输入');
  // 拖拽导入必须仍然可用
  assert.ok(page.window.__dropImport, '拖拽导入诊断对象应仍在');
  assert.strictEqual(page.window.__dropImport.enabled, true);
});

test('诊断对象：可查到本页为何不能拖入', () => {
  const page = makePage();
  const calls = makeCalls();
  runDropImport(page, 'paper', calls);
  const diag = page.window.__dropImport;
  assert.ok(diag, '应暴露 window.__dropImport');
  assert.strictEqual(diag.enabled, true);
  assert.strictEqual(diag.module, 'paper');
});

test('拖放监听挂在 window 且处于捕获阶段（不被子元素拦截）', () => {
  const page = makePage();
  const calls = makeCalls();
  runDropImport(page, 'paper', calls);
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'drop-import.js'), 'utf8');
  assert.ok(/window\.addEventListener\('drop',[\s\S]{0,40}CAPTURE\)/.test(src), 'drop 应在 window 上以捕获阶段监听');
  assert.ok(src.includes("const CAPTURE = { capture: true }"), '缺少捕获阶段配置');
  // document 冒泡兜底仍在
  assert.ok(src.includes("document.addEventListener('drop'"), '应保留 document 冒泡兜底');
});

test('hasFiles 不再只依赖 types（平台差异兼容）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'drop-import.js'), 'utf8');
  assert.ok(src.includes('dt.files && dt.files.length'), '应检查 dataTransfer.files');
  assert.ok(src.includes("i.kind === 'file'"), '应检查 dataTransfer.items');
  const fn = src.slice(src.indexOf('function filesOf('), src.indexOf('const hideHint'));
  assert.ok(fn.includes("includes('Files')") && fn.includes('files.length') && fn.includes("kind === 'file'"), '三重判定应齐全');
});

test('详情页脚本：分类操作模块始终加载；录文树脚本已随面板移除（V5.3）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'pages.js'), 'utf8');
  const detail = src.slice(src.indexOf("router.get(m.route + '/:id'"), src.indexOf('router.get(\'/search\''));
  assert.ok(detail.includes('classify-actions.js') && detail.includes('classify-manager.js'), '详情页应始终加载分类操作模块');
  // V5.3：条目页的「录文分类（全局）」面板已删除，录文分类的查阅与维护
  // 迁到「资料库 → 录文」（/excerpts）。excerpt-tree.js 只服务那个面板，
  // 继续注入会让死代码抢事件，必须不再注入。
  const injects = /scripts\.push\('[^']*excerpt-tree\.js'\)/.test(detail);
  assert.ok(!injects, 'excerpt-tree.js 不应再注入详情页（其服务的面板已删除）');
  // 录文从条目页录入的能力必须保留
  const itemView = fs.readFileSync(path.join(ROOT, 'server', 'views', 'page-item.js'), 'utf8');
  assert.ok(itemView.includes('id="tab-excerpts"'), '录文页签应保留');
});

test('直落体验：拖到空白处不弹任何窗，建完条目刷新列表（不跳转）', async () => {
  const page = makePage();
  const calls = makeCalls();
  const { dataTransfer } = runDropImport(page, 'book', calls);
  await page.document.dispatch('drop', { dataTransfer, bubbles: true });
  await tick();
  assert.ok(calls.apiCalls.some((c) => c.url === '/api/items'), '应直接建条目');
  assert.strictEqual(calls.form, null, '导入过程中不得弹出任何表单（V4 回归点）');
  assert.ok(calls.toast.some((t) => /已导入/.test(t)), '应提示导入完成');
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'drop-import.js'), 'utf8');
  assert.ok(!src.includes('openForm'), '拖入流程不应再使用 openForm');
  assert.ok(!src.includes('assignAfterImport'), '阻塞式归类函数应已移除');
  assert.ok(!/location\.href\s*=/.test(src), '不应再跳转到新条目（单文件也不跳）');
});

test('多文件导入：一次拖 N 个 PDF 应建 N 个条目、各自挂附件、停在列表页', async () => {
  const page = makePage();
  const calls = makeCalls();
  let n = 0;
  calls.api = async (url, opts) => {
    calls.apiCalls.push({ url, opts });
    if (url === '/api/items') { n += 1; return { id: 100 + n, name: '条目' + n }; }
    return { id: 1 };
  };
  const files = [
    { name: '甲.pdf', size: 10, arrayBuffer: async () => new ArrayBuffer(8) },
    { name: '乙.pdf', size: 10, arrayBuffer: async () => new ArrayBuffer(8) },
    { name: '丙.pdf', size: 10, arrayBuffer: async () => new ArrayBuffer(8) }
  ];
  const dt = { types: ['Files'], files, items: files.map((f) => ({ kind: 'file', getAsFile: () => f })) };
  runDropImport(page, 'book', calls, { dataTransfer: dt, file: files[0] });
  page.window.location && (page.window.location.reloadCount = 0);
  await page.document.dispatch('drop', { dataTransfer: dt, bubbles: true });
  await tick();
  await tick();

  const created = calls.apiCalls.filter((c) => c.url === '/api/items');
  assert.strictEqual(created.length, 3, '应创建 3 个条目，实际 ' + created.length);
  const uploads = calls.fetchCalls.filter((f) => String(f.url).includes('/attachments/upload'));
  assert.strictEqual(uploads.length, 3, '每个条目都应挂上自己的原件');
  assert.ok(calls.toast.some((t) => /已导入 3 个条目/.test(t)), '应汇总提示，实际：' + JSON.stringify(calls.toast.slice(-2)));
  assert.ok(!calls.form, '不应弹窗');
  assert.ok(calls.toast.some((t) => /正在导入 1\/3/.test(t)), '应显示进度提示');
});

test('多文件导入：单个失败不影响其余文件', async () => {
  const page = makePage();
  const calls = makeCalls();
  let n = 0;
  calls.api = async (url, opts) => {
    calls.apiCalls.push({ url, opts });
    if (url === '/api/items') {
      n += 1;
      if (n === 2) throw new Error('模拟第二个失败');
      return { id: 200 + n, name: '条目' + n };
    }
    return { id: 1 };
  };
  const files = [
    { name: '一.pdf', size: 10, arrayBuffer: async () => new ArrayBuffer(8) },
    { name: '二.pdf', size: 10, arrayBuffer: async () => new ArrayBuffer(8) },
    { name: '三.pdf', size: 10, arrayBuffer: async () => new ArrayBuffer(8) }
  ];
  const dt = { types: ['Files'], files, items: files.map((f) => ({ kind: 'file', getAsFile: () => f })) };
  runDropImport(page, 'book', calls, { dataTransfer: dt, file: files[0] });
  await page.document.dispatch('drop', { dataTransfer: dt, bubbles: true });
  await tick();
  await tick();
  assert.strictEqual(calls.apiCalls.filter((c) => c.url === '/api/items').length, 3, '仍应尝试全部 3 个');
  assert.ok(calls.toast.some((t) => /已导入 2 个条目，1 个失败/.test(t)), '应如实汇报成功/失败数，实际：' + JSON.stringify(calls.toast.slice(-1)));
});

test('解析失败：仍按文件名建条目，不算失败（V3 行为，方案 A）', async () => {
  const page = makePage();
  const calls = makeCalls();
  // 模拟扫描件/损坏文件：arrayBuffer 抛错
  const bad = { name: '扫描件_003.pdf', size: 2048, arrayBuffer: async () => { throw new Error('Invalid PDF structure'); } };
  const dt = { types: ['Files'], files: [bad], items: [{ kind: 'file', getAsFile: () => bad }] };
  runDropImport(page, 'book', calls, { dataTransfer: dt, file: bad });
  await page.document.dispatch('drop', { dataTransfer: dt, bubbles: true });
  await tick();

  const created = calls.apiCalls.find((c) => c.url === '/api/items');
  assert.ok(created, '解析失败也应建条目');
  assert.strictEqual(created.opts.body.title, '扫描件_003', '题名应回退为文件名');
  assert.ok(calls.fetchCalls.some((f) => String(f.url).includes('/attachments/upload')), '原件仍应挂为附件');
  assert.ok(calls.toast.some((t) => /已导入/.test(t)), '应提示导入完成');
  assert.ok(!calls.toast.some((t) => /创建失败/.test(t)), '不应报失败，实际：' + JSON.stringify(calls.toast));
});

// —— 回归：内联脚本里不能出现未定义的裸变量 ——
// 这类错误会让整段 <script> 中断，进而 window.__MODULE__ 等全局变量全部未赋值，
// 表现为「页面异常 + 拖入导入门禁永远判定为不支持」，且极难定位。
test('回归：页面内联脚本不得引用未定义变量（否则全局配置赋值全部中断）', async () => {
  const { createApp } = require('../server/app');
  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    for (const url of ['/library/books', '/library/papers', '/sources/classics']) {
      const html = await (await fetch(base + url)).text();
      // 取出页面里的内联脚本块
      const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
      assert.ok(inline.length > 0, url + ' 应有内联脚本');

      // 全局变量赋值必须都是「字面量」形式：window.X = <数字/字符串/数组字面量>
      const assignments = [...inline.matchAll(/window\.__(\w+__)\s*=\s*([^;\n]+);/g)];
      assert.ok(assignments.length >= 5, url + ' 应有多项全局赋值，实际 ' + assignments.length);
      for (const [, name, value] of assignments) {
        const v = value.trim();
        const ok = /^("|')/.test(v)                    // 字符串字面量
          || /^(-?\d|true|false|null)/.test(v)          // 数字/布尔/null
          || /^[\[{]/.test(v)                          // 数组/对象字面量
          || /^JSON\.parse\(/.test(v);
        assert.ok(ok, url + ' 的 window.' + name + ' 赋值含未定义变量：' + v.slice(0, 60));
      }

      // 关键：拖入导入依赖的模块名必须真的被赋值
      const moduleAssigned = /window\.__MODULE__\s*=\s*("[^"]*")/.test(inline);
      assert.ok(moduleAssigned, url + ' 未给 window.__MODULE__ 赋字符串字面量');
    }
  } finally { srv.close(); }
});

test('回归：列表页（item 为 null）也能正确赋值 __ITEM_ID__', async () => {
  const { createApp } = require('../server/app');
  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const html = await (await fetch(base + '/library/books')).text();   // 列表页：无选中条目
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    assert.ok(/window\.__ITEM_ID__\s*=\s*0\s*;/.test(inline), '列表页应把 __ITEM_ID__ 赋为 0');
    assert.ok(!/window\.__ITEM_ID__\s*=\s*item/.test(inline), '不得把未定义的 item 变量输出到浏览器');
  } finally { srv.close(); }
});

test.after(() => {
  try { db.closeDb && db.closeDb(); } catch (e) { /* 忽略 */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
});
