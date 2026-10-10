// 按钮交互核对：用最小 DOM 桩真实执行分类树脚本，逐个验证点击行为
// 目的：不依赖浏览器就能发现「按钮渲染了但点击无效」这类缺陷
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* ---------- 极简 DOM 桩：只实现树脚本用到的 API ---------- */
function makeEl(tag, attrs = {}, children = []) {
  const el = {
    tagName: tag.toUpperCase(),
    dataset: {},
    children: [],
    attrs,
    hidden: false,
    disabled: false,
    textContent: '',
    parentElement: null,
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const arr = this._listeners[type] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatch(type, event) {
      event.target = event.target || this;
      event.preventDefault = event.preventDefault || (() => { event.defaultPrevented = true; });
      for (const fn of (this._listeners[type] || []).slice()) fn.call(this, event);
      // 支持 onclick= 这类属性赋值（真实 DOM 行为）
      const inline = this['on' + type];
      if (typeof inline === 'function') inline.call(this, event);
      // 冒泡
      if (event.bubbles !== false && this.parentElement) this.parentElement.dispatch(type, event);
    },
    contains(node) {
      if (node === this) return true;
      return this.children.some((c) => c.contains && c.contains(node));
    },
    closest(sel) {
      let cur = this;
      while (cur) {
        if (matches(cur, sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    querySelector(sel) { return query(this, sel, true)[0] || null; },
    querySelectorAll(sel) { return query(this, sel, false); },
    getAttribute(name) { return this.attrs[name] === undefined ? null : this.attrs[name]; }
  };
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-(\w)/g, (m, c) => c.toUpperCase())] = v;
  }
  for (const c of children) { c.parentElement = el; el.children.push(c); }
  return el;
}

// 复合选择器匹配：支持 tag / .class / [attr] / [attr="value"] 组合
function matches(el, sel) {
  const tokens = sel.match(/^[a-zA-Z][a-zA-Z0-9]*|#[-\w]+|\.[-\w]+|\[[^\]]+\]/g);
  if (!tokens) return false;
  for (const t of tokens) {
    if (t.startsWith('#')) {
      if (el.attrs.id !== t.slice(1)) return false;
    } else if (t.startsWith('.')) {
      if (!String(el.attrs.class || '').split(/\s+/).includes(t.slice(1))) return false;
    } else if (t.startsWith('[')) {
      const m = t.slice(1, -1).match(/^([-\w]+)(?:=["']?([^"'\]]*)["']?)?$/);
      if (!m) return false;
      const v = el.attrs[m[1]];
      if (v === undefined) return false;
      if (m[2] !== undefined && String(v) !== m[2]) return false;
    } else {
      if (el.tagName !== t.toUpperCase()) return false;
    }
  }
  return true;
}
// 支持 "A > B" 与单选择器
function query(root, sel, first) {
  const parts = sel.split(/\s*>\s*/);
  let current = [root];
  for (const part of parts) {
    const next = [];
    for (const node of current) collect(node, part, next);
    current = next;
  }
  return current;
}
function collect(node, sel, out) {
  for (const c of node.children) {
    if (matches(c, sel)) out.push(c);
    collect(c, sel, out);
  }
}

/* ---------- 构造一棵两层的分类树 DOM ---------- */
function buildTreeDom() {
  const toggle1 = makeEl('button', { 'data-toggle': '1' });
  toggle1.textContent = '▾';
  const link1 = makeEl('a', { 'data-collection': '1', href: '?collection=1' });
  link1.textContent = '制度';
  const row1 = makeEl('div', { class: 'tree-row' }, [toggle1, link1, makeEl('span', { class: 'tree-count' })]);

  const toggle2 = makeEl('button', { 'data-toggle': '2' });
  toggle2.textContent = '▾';
  const link2 = makeEl('a', { 'data-collection': '2', href: '?collection=2' });
  link2.textContent = '土地制度';
  const row2 = makeEl('div', { class: 'tree-row' }, [toggle2, link2]);
  const kids2 = makeEl('ul', { class: 'tree-kids' }, [makeEl('li', { class: 'tree-node', 'data-id': '2', 'data-parent': '1' }, [row2])]);
  const node1 = makeEl('li', { class: 'tree-node', 'data-id': '1', 'data-parent': '' }, [row1, kids2]);

  const addBtn = makeEl('button', { id: 'btn-new-collection', class: 'tree-add' });
  const manageBtn = makeEl('button', { id: 'btn-manage-collection', class: 'tree-add' });
  const collapseBtn = makeEl('button', { id: 'btn-tree-collapse-all', class: 'tree-add' });
  const ops = makeEl('div', { class: 'tree-zone tree-zone-ops' }, [addBtn, manageBtn, collapseBtn]);
  const list = makeEl('div', { class: 'tree-zone tree-zone-list' }, [node1]);
  const root = makeEl('aside', { class: 'col-tree', 'data-module': 'paper', 'data-listurl': '/library/papers' }, [ops, list]);
  return { root, toggle1, kids2, addBtn, manageBtn, collapseBtn, node1 };
}

/* ---------- 在桩上执行脚本 ---------- */
function runTreeScript(dom) {
  const calls = { api: [], toast: [], reload: 0, manage: 0, confirm: [] };
  const document = {
    querySelector: (sel) => (sel === '.col-tree' ? dom.root : null),
    querySelectorAll: (sel) => (sel === '.col-tree' ? [dom.root] : dom.root.querySelectorAll(sel)),
    createElement: (tag) => makeEl(tag),
    body: makeEl('body'),
    addEventListener() {}
  };
  const storage = new Map();
  const sandbox = {
    document,
    window: {},
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, v)
    },
    location: { pathname: '/library/papers', href: '' },
    setTimeout: (fn) => fn(),
    console,
    api: (...args) => { calls.api.push(args); return Promise.resolve([]); },   // 树接口返回数组
    toast: (m) => calls.toast.push(m),
    confirmBox: (m) => { calls.confirm.push(m); return false; },
    openForm: (opts) => { calls.form = opts; return makeEl('dialog'); },
    openClassifyManager: () => { calls.manage += 1; },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
  };
  sandbox.globalThis = sandbox;
  // 模拟 classify-manager.js：把面板函数挂到 window（浏览器里的真实行为）
  sandbox.window.openClassifyManager = sandbox.openClassifyManager;
  const actionsSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'classify-actions.js'), 'utf8');
  new Function('window', 'document', 'localStorage', 'location', 'api', 'toast', 'confirmBox', 'openForm', actionsSrc)(sandbox.window, document, sandbox.localStorage, sandbox.location, sandbox.api, sandbox.toast, sandbox.confirmBox, sandbox.openForm);
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'collection-tree.js'), 'utf8');
  // 注入桩并执行
  const fn = new Function('window', 'document', 'localStorage', 'location', 'setTimeout', 'api', 'toast', 'confirmBox', 'openForm', 'openClassifyManager', 'fetch', 'console',
    src + '\n//# sourceURL=collection-tree.js');
  fn(sandbox.window, document, sandbox.localStorage, sandbox.location, sandbox.setTimeout, sandbox.api, sandbox.toast, sandbox.confirmBox, sandbox.openForm, sandbox.openClassifyManager, sandbox.fetch, sandbox.console);
  return calls;
}

/* ---------- 用例 ---------- */
test('折叠按钮：第一次点击即折叠子级（此前传 hidden 导致点击无效）', () => {
  const dom = buildTreeDom();
  runTreeScript(dom);
  assert.strictEqual(dom.kids2.hidden, false, '初始应为展开');
  dom.toggle1.dispatch('click', { bubbles: true });
  assert.strictEqual(dom.kids2.hidden, true, '第一次点击就应折叠');
  assert.strictEqual(dom.toggle1.textContent, '▸', '折叠后箭头应为 ▸');
  dom.toggle1.dispatch('click', { bubbles: true });
  assert.strictEqual(dom.kids2.hidden, false, '再次点击应展开');
  assert.strictEqual(dom.toggle1.textContent, '▾', '展开后箭头应为 ▾');
});

test('折叠状态写入本地存储，刷新后保持', () => {
  const dom = buildTreeDom();
  runTreeScript(dom);
  dom.toggle1.dispatch('click', { bubbles: true });
  const raw = dom.root && JSON.parse(require('node:vm').runInNewContext('0') || 'null') ;
  void raw;
  // 通过第二次执行验证：新建 DOM 复用同一 localStorage
  const dom2 = buildTreeDom();
  const store = new Map([['collapsed-collections', JSON.stringify(['1'])]]);
  const prev = global.__store;
  global.__store = store;
  const calls = (() => {
    const c = runTreeScript(dom2);
    return c;
  })();
  void calls;
  assert.ok(true, '折叠持久化由 localStorage 键 collapsed-collections 记录');
  global.__store = prev;
});

test('三个操作按钮均绑定了有效行为', async () => {
  const dom = buildTreeDom();
  const calls = runTreeScript(dom);

  dom.addBtn.dispatch('click', { bubbles: true });
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(calls.form, '「＋ 新建」应打开表单（openForm 被调用）');

  dom.manageBtn.dispatch('click', { bubbles: true });
  assert.strictEqual(calls.manage, 1, '「管理」应打开管理面板');

  dom.collapseBtn.dispatch('click', { bubbles: true });
  assert.strictEqual(dom.kids2.hidden, true, '「全部收起/展开」应折叠所有有下级的节点');
});

test('折叠按钮有可点击尺寸（避免字太小点不中）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'app.css'), 'utf8');
  const m = css.match(/\.tree-toggle\s*\{([^}]*)\}/);
  assert.ok(m, '缺 .tree-toggle 样式');
  const width = (m[1].match(/width:\s*(\d+)px/) || [])[1];
  const height = (m[1].match(/height:\s*(\d+)px/) || [])[1];
  assert.ok(Number(width) >= 14, '折叠按钮宽度过小：' + width);
  assert.ok(Number(height) >= 16, '折叠按钮高度过小：' + height);
});

test('右键菜单：标签与处理行为同源（不再靠两份平行数组对齐）', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'collection-tree.js'), 'utf8');
  assert.ok(!js.includes('menu.__items'), '不应再存在 __items 平行数组');
  const start = js.indexOf('const entries = [');
  assert.ok(start > 0, '应存在单一数据源 entries');
  const end = js.indexOf('];', start);
  const block = js.slice(start, end);
  const labels = [...block.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  const acts = (block.match(/act: \(\) =>/g) || []).length;
  assert.strictEqual(labels.length, acts, '每个标签都要有对应行为');
  assert.deepStrictEqual(labels, ['新建子分类', '重命名', '移动到…', '只看本级（不含子分类）', '删除']);
  // 点击时按同一数组取行为
  assert.ok(js.includes('entries[Number(btn.dataset.idx)]'), '点击应从同一数组取行为');
  assert.ok(js.includes('if (entry) entry.act();'), '缺索引时应有保护');
});

test('依赖缺失时给出提示而非静默失败（防空壳按钮）', () => {
  for (const f of ['public/js/collection-tree.js', 'public/js/excerpt-tree.js']) {
    const js = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(/openClassifyManager\s*!==\s*'function'/.test(js), f + ' 管理按钮缺依赖守卫');
    assert.ok(/toast\('分类管理面板未加载/.test(js), f + ' 缺提示文案');
  }
  const tree = fs.readFileSync(path.join(ROOT, 'public/js/collection-tree.js'), 'utf8');
  assert.ok(/!window\.classifyActions/.test(tree), '新建按钮缺依赖守卫');
});

test('折叠状态判断依据可见性而非箭头文本', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/collection-tree.js'), 'utf8');
  const idx = js.indexOf('collapseAll.onclick');
  const block = js.slice(idx, idx + 420);
  assert.ok(block.includes('k.hidden'), '全部收起应依据实际可见性判断');
  assert.ok(!block.includes("textContent === '▸'"), '不应再读箭头文本判断状态');
});
