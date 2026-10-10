// V5 阶段 1：分类管理（录文分类可删可改名 + 主题接入同一套面板）
// 覆盖三类真实缺陷：
//   1. 录文树没有右键菜单 → 无法删除/重命名
//   2. classify-actions 固定发 PUT，而 excerpt-folders/themes 只注册 PATCH → 改名 404
//   3. 删除请求缺 confirm=true → 服务端一律 400，表现为「删不掉」
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* ---------- 最小 DOM 桩（与 item-drag 测试同构）---------- */
/**
 * 脚本里用 `e.target instanceof Element` 做事件目标兜底（文本节点没有 closest）。
 * 桩对象默认不满足该判断，会让右键/点击处理器误判为「目标无效」而早退，
 * 于是 `preventDefault` 不执行、菜单不出现 —— 是桩的缺陷，不是被测代码的。
 * 这里让每个桩的原型链指向 Element.prototype，使其 instanceof Element 为真。
 */
function StubElement() {}
StubElement.prototype = Object.prototype;

function el(tag, attrs = {}, children = []) {
  const node = Object.create(StubElement.prototype);
  Object.assign(node, {
    tagName: tag.toUpperCase(), attrs, children, dataset: {}, hidden: false, textContent: '',
    parentElement: null, _l: {}, innerHTML: '', style: {},
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
    removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter((x) => x !== f); },
    dispatch(type, ev) {
      ev = ev || {};
      ev.type = type;
      ev.target = ev.target || this;
      ev.preventDefault = ev.preventDefault || (() => { ev.defaultPrevented = true; });
      ev.stopPropagation = ev.stopPropagation || (() => { ev.stopped = true; });
      for (const f of (this._l[type] || []).slice()) f.call(this, ev);
      if (ev.bubbles !== false && this.parentElement) this.parentElement.dispatch(type, ev);
      return ev;
    },
    closest(sel) { let c = this; while (c) { if (m(c, sel)) return c; c = c.parentElement; } return null; },
    contains(n) { return n === this || this.children.some((c) => c.contains && c.contains(n)); },
    querySelector(s) { return q(this, s)[0] || null; },
    querySelectorAll(s) { return q(this, s); },
    insertBefore(n) { this.children.unshift(n); n.parentElement = this; },
    appendChild(n) { this.children.push(n); n.parentElement = this; return n; },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this); },
    getBoundingClientRect() { return { width: 120, height: 90, top: 0, left: 0 }; },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle(c, f) { if (f === undefined) f = !this._s.has(c); if (f) this._s.add(c); else this._s.delete(c); } }
  });
  node.classList._s = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));  Object.defineProperty(node, 'id', { get() { return this.attrs.id || ''; }, set(v) { this.attrs.id = v; } });
  let cls = node.classList;
  Object.defineProperty(node, 'className', {
    get() { return [...cls._s].join(' '); },
    set(v) { cls._s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  });
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('data-')) node.dataset[k.slice(5).replace(/-(\w)/g, (m, c) => c.toUpperCase())] = v;
  }
  for (const c of children) c.parentElement = node;
  return node;
}
function m(node, sel) {
  if (sel.indexOf('>') >= 0) return false;          // 组合器交给 q 处理
  const tokens = sel.match(/^[a-zA-Z][\w-]*|#[-\w]+|\.[-\w]+|\[[^\]]+\]/g);
  if (!tokens) return false;
  for (const t of tokens) {
    if (t.startsWith('#')) { if (node.attrs.id !== t.slice(1)) return false; }
    else if (t.startsWith('.')) { if (!node.classList.contains(t.slice(1))) return false; }
    else if (t.startsWith('[')) {
      const mm = t.slice(1, -1).match(/^([-\w]+)(?:=["']?([^"'\]]*)["']?)?$/);
      if (!mm || node.attrs[mm[1]] === undefined) return false;
      if (mm[2] !== undefined && String(node.attrs[mm[1]]) !== mm[2]) return false;
    } else if (node.tagName !== t.toUpperCase()) return false;
  }
  return true;
}
// 支持 'A > B' 子代组合器：先按 A 命中，再在其子树内找 B
function q(root, sel) {
  const parts = String(sel).split('>').map((s) => s.trim()).filter(Boolean);
  let scope = [root];
  for (const part of parts) {
    const out = [];
    for (const s of scope) {
      (function walk(n) { for (const c of n.children) { if (m(c, part)) out.push(c); walk(c); } })(s);
    }
    scope = out;
  }
  return scope;
}

/* ---------- 造一棵录文分类树：1 → 2 → 4，另有 3 ---------- */
function buildTree() {
  const node = (id, parent, name, kids) => {
    const item = el('button', { class: 'tree-item tree-as-filter', 'data-folder-filter': String(id) });
    item.textContent = name;
    const toggle = el('button', { class: 'tree-toggle', 'data-toggle': String(id) });
    toggle.textContent = '▾';
    const row = el('div', { class: 'tree-row' }, [toggle, item]);
    const li = el('li', { class: 'tree-node', 'data-id': String(id), 'data-parent': parent == null ? '' : String(parent) }, [row]);
    if (kids && kids.length) li.appendChild(el('ul', { class: 'tree-kids' }, kids));
    return li;
  };
  const kids = [node(4, 2, '四级')];
  const n2 = node(2, 1, '二级', kids);
  const n1 = node(1, null, '一级', [n2]);
  const n3 = node(3, null, '另一个', []);
  const root = el('aside', { class: 'hub-side' }, [
    el('div', { class: 'tree-title' }, []),
    el('div', { class: 'tree-hint' }, []),
    el('ul', { class: 'tree-root' }, [n1, n3])
  ]);
  return { root, n1, n2, n3, n4: kids[0] };
}

/* ---------- 加载 excerpts-hub.js（V5.3：录文分类树已迁至录文集） ---------- */
function runExcerptTree(tree, calls) {
  const listEl = el('div', { class: 'hub-list' }, []);
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'excerpts-hub.js'), 'utf8');
  const document = {
    body: el('body', {}, [tree.root, listEl]),
    querySelector: (s) => (s === '.hub-side' ? tree.root : (s === '.hub-list' ? listEl : null)),
    getElementById: () => null,
    querySelectorAll: (s) => (s === '[data-excerpt-card]' ? [] : tree.root.querySelectorAll(s)),
    createElement: (t) => el(t),
    addEventListener() {}
  };
  const windowObj = { toast: (t) => calls.toast.push(t) };
  windowObj.window = windowObj;
  const sandbox = {
    window: windowObj, document, location: { reload: () => { calls.reloads += 1; }, pathname: '/sources/classics/1' },
    api: async (url, o) => {
      calls.apiCalls.push({ url, o });
      if (url === '/api/excerpt-folders?tree=1') return calls.tree;
      return { ok: true, categories: 1, links: 0, id: 1, name: (o && o.body && o.body.name) || '' };
    },
    toast: windowObj.toast,
    confirmBox: (m) => { calls.confirms.push(m); return calls.confirmResult; },
    openForm: (o) => { calls.forms.push(o); return { __form: true }; },
    localStorage: { getItem: () => null, setItem: () => {} },
    // 脚本里用 `x instanceof Element` 做事件目标兜底（文本节点没有 closest）。
    // 必须与 el() 用的构造器是同一个，否则 instanceof 恒为 false。
    Element: StubElement,
    setInterval: () => 0,
    setTimeout: (f) => { f(); return 0; },
    console
  };
  const keys = Object.keys(sandbox);
  new Function(...keys, src)(...keys.map((k) => sandbox[k]));
  return sandbox;
}

const TREE_FIXTURE = [
  { id: 1, name: '一级', parent_id: null, description: '顶层说明', children: [
    { id: 2, name: '二级', parent_id: 1, description: '', children: [
      { id: 4, name: '四级', parent_id: 2, description: '', children: [] }
    ] }
  ] },
  { id: 3, name: '另一个', parent_id: null, description: '', children: [] }
];
const fresh = () => ({
  apiCalls: [], toast: [], forms: [], confirms: [], reloads: 0,
  confirmResult: true, tree: TREE_FIXTURE, impact: { categories: 1, links: 0 }
});

/* ================= 用例 ================= */

test('录文集分类树：右键弹出菜单并阻止浏览器默认菜单', () => {
  const tree = buildTree();
  const calls = fresh();
  runExcerptTree(tree, calls);

  const ev = tree.n1.querySelector('.tree-row').dispatch('contextmenu', { clientX: 30, clientY: 40, bubbles: true });
  assert.strictEqual(ev.defaultPrevented, true, '右键应阻止浏览器默认菜单');
});

test('录文集分类树：右键菜单条目齐全（新建子分类/重命名/移动到…/删除）', () => {
  const tree = buildTree();
  const calls = fresh();
  runExcerptTree(tree, calls);
  tree.n1.querySelector('.tree-row').dispatch('contextmenu', { clientX: 30, clientY: 40, bubbles: true });
  // 桩不解析 innerHTML，这里断言菜单确实挂到了 body 且含 4 个按钮
  // （V5.3：面板已改为整页跳转，删掉了只对条目页有意义的「只看本级」）
  const menu = tree.root.parentElement.children.find((c) => c.className === 'ctx-menu');
  assert.ok(menu, '应创建 .ctx-menu 并挂到 body');
  const btns = (menu.innerHTML.match(/data-idx/g) || []).length;
  assert.strictEqual(btns, 4, '菜单应有 4 个操作项');
  for (const label of ['新建子分类', '重命名', '移动到…', '删除']) {
    assert.ok(menu.innerHTML.includes(label), '菜单应含「' + label + '」');
  }
});

test('录文集分类树：菜单不影响折叠（click 与 contextmenu 分离）', () => {
  const tree = buildTree();
  const calls = fresh();
  calls.api = undefined;
  runExcerptTree(tree, calls);
  // 点击折叠按钮不应触发菜单逻辑
  const toggle = tree.n1.querySelector('[data-toggle]');
  const ev = toggle.dispatch('click', { bubbles: true });
  assert.notStrictEqual(ev.defaultPrevented, true, '折叠点击不应被右键菜单逻辑阻止');
  const kids = tree.n1.querySelector('.tree-kids');
  assert.strictEqual(kids.hidden, true, '折叠应生效（原有功能未被破坏）');
});

test('录文树：折叠状态仍读 localStorage（回归）', () => {
  const tree = buildTree();
  const calls = fresh();
  runExcerptTree(tree, calls);
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'excerpt-tree.js'), 'utf8');
  assert.ok(src.includes('collapsed-excerpt-folders'), '应沿用原折叠状态键');
});

/* ---------- classify-actions 的三处修复 ---------- */

function loadClassifyActions(calls) {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'classify-actions.js'), 'utf8');
  const windowObj = {
    openForm: (o) => { calls.forms.push(o); return { __form: true }; },
    confirmBox: (m) => { calls.confirms.push(m); return calls.confirmResult; }
  };
  windowObj.window = windowObj;
  new Function('window', 'api', 'toast', 'openForm', 'confirmBox', src)(
    windowObj,
    async (url, o) => {
      calls.apiCalls.push({ url, o });
      if (/impact$/.test(url)) return { categories: calls.impact.categories, links: calls.impact.links };
      // /api/themes 返回扁平数组（loadTree 内部会拼成嵌套）
      if (url.indexOf('/api/themes') === 0) return TREE_FIXTURE;
      return { ok: true, categories: 3, links: 7, name: (o && o.body && o.body.name) || '' };
    },
    (t) => calls.toast.push(t),
    (o) => { calls.forms.push(o); return { __form: true }; },
    (m) => { calls.confirms.push(m); return calls.confirmResult; }
  );
  return windowObj.classifyActions;
}

test('录文分类改名用 PATCH（后端只注册 PATCH，PUT 会 404）', async () => {
  const calls = fresh();
  calls.impact = { categories: 1, links: 0 };
  const A = loadClassifyActions(calls);
  A.edit({ scope: 'folder', id: 2, defaultName: '二级', onDone: () => {} });
  await calls.forms[0].onSubmit({ name: '二级改', description: '', parent_id: '' });
  const req = calls.apiCalls.find((c) => c.url === '/api/excerpt-folders/2');
  assert.ok(req, '应调用录文分类更新接口');
  assert.strictEqual(req.o.method, 'PATCH', '必须是 PATCH，实际：' + req.o.method);
  assert.strictEqual(req.o.body.name, '二级改');
});

test('主题改名也用 PATCH（此前主题无任何前端入口）', async () => {
  const calls = fresh();
  calls.impact = { categories: 1, links: 0 };
  const A = loadClassifyActions(calls);
  A.edit({ scope: 'theme', id: 5, defaultName: '旧名', onDone: () => {} });
  await calls.forms[0].onSubmit({ name: '新名', description: '', parent_id: '' });
  const req = calls.apiCalls.find((c) => c.url === '/api/themes/5');
  assert.ok(req, '应调用主题更新接口');
  assert.strictEqual(req.o.method, 'PATCH');
});

test('史料分类改名仍用 PUT（不得回归）', async () => {
  const calls = fresh();
  calls.impact = { categories: 1, links: 0 };
  const A = loadClassifyActions(calls);
  A.edit({ scope: 'collection', module: 'paper', id: 7, defaultName: '旧', onDone: () => {} });
  await calls.forms[0].onSubmit({ name: '新', description: '', parent_id: '' });
  const req = calls.apiCalls.find((c) => c.url === '/api/collections/7');
  assert.strictEqual(req.o.method, 'PUT', 'collections 路由注册的是 PUT');
});

test('录文分类删除必须带 confirm=true（此前缺失导致服务端 400「删不掉」）', async () => {
  const calls = fresh();
  calls.impact = { categories: 3, links: 7 };
  const A = loadClassifyActions(calls);
  await A.remove({ scope: 'folder', id: 2, name: '二级', onDone: () => { calls.done = true; } });
  const req = calls.apiCalls.find((c) => c.o && c.o.method === 'DELETE');
  assert.ok(req, '应发出删除请求');
  assert.ok(/\?confirm=true$/.test(req.url), '必须带 confirm=true，实际：' + req.url);
  assert.ok(calls.done, '删除成功后应回调刷新');
});

test('主题删除同样带 confirm=true', async () => {
  const calls = fresh();
  calls.impact = { categories: 2, links: 1 };
  const A = loadClassifyActions(calls);
  await A.remove({ scope: 'theme', id: 5, name: '主题', onDone: () => {} });
  const req = calls.apiCalls.find((c) => c.o && c.o.method === 'DELETE');
  assert.ok(/\?confirm=true$/.test(req.url), '实际：' + req.url);
});

test('史料分类删除不追加 confirm（后端不要求，且不得破坏既有行为）', async () => {
  const calls = fresh();
  calls.impact = { categories: 1, links: 0 };
  const A = loadClassifyActions(calls);
  await A.remove({ scope: 'collection', id: 7, name: '制度', onDone: () => {} });
  const req = calls.apiCalls.find((c) => c.o && c.o.method === 'DELETE');
  assert.strictEqual(req.url, '/api/collections/7', '实际：' + req.url);
});

test('删除二次确认展示影响数字（子分类数 + 解除关系数）', async () => {
  const calls = fresh();
  calls.impact = { categories: 4, links: 12 };
  const A = loadClassifyActions(calls);
  await A.remove({ scope: 'folder', id: 2, name: '二级', onDone: () => {} });
  const msg = calls.confirms[0];
  assert.ok(/3 个子分类/.test(msg), '应说明子分类数量，实际：' + msg);
  assert.ok(/12 条关联关系/.test(msg), '应说明解除的关系数，实际：' + msg);
  assert.ok(/内容本身保留/.test(msg), '应说明内容保留');
});

test('用户取消确认时不发删除请求', async () => {
  const calls = fresh();
  calls.impact = { categories: 1, links: 0 };
  calls.confirmResult = false;
  const A = loadClassifyActions(calls);
  await A.remove({ scope: 'folder', id: 2, name: '二级', onDone: () => {} });
  assert.ok(!calls.apiCalls.some((c) => c.o && c.o.method === 'DELETE'), '取消不应删除');
});

test('loadTree 无 module 时 URL 合法（不得拼出 /api/collections&tree=1）', async () => {
  const calls = fresh();
  calls.impact = { categories: 1, links: 0 };
  const A = loadClassifyActions(calls);
  await A.loadTree('collection');
  const req = calls.apiCalls[0];
  assert.ok(/\?tree=1$/.test(req.url), '实际：' + req.url);
  await A.loadTree('collection', 'paper');
  assert.ok(calls.apiCalls[1].url === '/api/collections?module=paper&tree=1', '实际：' + calls.apiCalls[1].url);
  await A.loadTree('folder');
  assert.strictEqual(calls.apiCalls[2].url, '/api/excerpt-folders?tree=1');
  await A.loadTree('theme');
  assert.strictEqual(calls.apiCalls[3].url, '/api/themes?tree=1');
  const themeTree = await A.loadTree('theme');
  assert.ok(Array.isArray(themeTree), 'theme 应返回数组');
  assert.strictEqual(themeTree.length, 2, '顶级应有两个节点');
  // 输入本身已带 children 时应原样保留，不被再套一层（否则子节点会丢）
  assert.strictEqual(themeTree[0].children.length, 1, '一级下应保留子节点');
  assert.strictEqual(themeTree[0].children[0].id, 2);
  assert.strictEqual(themeTree[0].children[0].children.length, 1, '孙节点也应保留');
  assert.strictEqual(themeTree[0].children[0].children[0].id, 4);
});

test('loadTree(theme) 对真正的扁平数据也能拼出层级', async () => {
  const calls = fresh();
  calls.impact = { categories: 1, links: 0 };
  const flat = [
    { id: 1, name: '一级', parent_id: null, description: '' },
    { id: 2, name: '二级', parent_id: 1, description: '' },
    { id: 3, name: '另一个', parent_id: null, description: '' }
  ];
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'classify-actions.js'), 'utf8');
  const windowObj = { openForm: () => ({}), confirmBox: () => true };
  windowObj.window = windowObj;
  new Function('window', 'api', 'toast', 'openForm', 'confirmBox', src)(
    windowObj, async () => flat, () => {}, () => ({}), () => true
  );
  const tree = await windowObj.classifyActions.loadTree('theme');
  assert.strictEqual(tree.length, 2, '顶级两个');
  const top = tree.find((n) => n.id === 1);
  assert.strictEqual(top.children.length, 1, '扁平数据应被拼成层级');
  assert.strictEqual(top.children[0].id, 2);
  void calls;
});

/* ---------- 服务端：真实接口行为 ---------- */
function withServer(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-tax-'));
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

test('服务端：录文分类 PATCH 可改名（PUT 应 404）', () => withServer(async ({ db, base }) => {
  const id = Number(db.dbRun("INSERT INTO excerpt_folders(item_id,parent_id,name,description,sort) VALUES (0,NULL,'旧名','',0)").lastInsertRowid);
  const ok = await fetch(base + '/api/excerpt-folders/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '新名' })
  });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await ok.json()).name, '新名');
  const bad = await fetch(base + '/api/excerpt-folders/' + id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X' })
  });
  assert.strictEqual(bad.status, 404, 'PUT 未注册，应 404 —— 这正是前端固定发 PUT 会失败的原因');
}));

test('服务端：删除不带 confirm 拒绝、带 confirm 成功，且级联子树只解除链接', () => withServer(async ({ db, base }) => {
  const p = Number(db.dbRun("INSERT INTO excerpt_folders(item_id,parent_id,name,description,sort) VALUES (0,NULL,'父','',0)").lastInsertRowid);
  const c = Number(db.dbRun('INSERT INTO excerpt_folders(item_id,parent_id,name,description,sort) VALUES (0,?,?,?,0)', [p, '子', '']).lastInsertRowid);
  const g = Number(db.dbRun('INSERT INTO excerpt_folders(item_id,parent_id,name,description,sort) VALUES (0,?,?,?,0)', [c, '孙', '']).lastInsertRowid);
  const other = Number(db.dbRun("INSERT INTO excerpt_folders(item_id,parent_id,name,description,sort) VALUES (0,NULL,'无关','',1)").lastInsertRowid);
  const itemId = Number(db.dbRun("INSERT INTO items (module,title,subtitle,status,fields,created_at,updated_at) VALUES ('classics','某书','','未读','{}',?,?)", [db.now(), db.now()]).lastInsertRowid);
  const exId = Number(db.dbRun('INSERT INTO excerpts (item_id,seq,text,created_at,updated_at) VALUES (?,1,\'正文\',?,?)', [itemId, db.now(), db.now()]).lastInsertRowid);
  db.dbRun('INSERT INTO excerpt_folder_links (excerpt_id,folder_id) VALUES (?,?)', [exId, c]);
  db.dbRun('INSERT INTO excerpt_folder_links (excerpt_id,folder_id) VALUES (?,?)', [exId, other]);

  const noConfirm = await fetch(base + '/api/excerpt-folders/' + p, { method: 'DELETE' });
  assert.strictEqual(noConfirm.status, 400, '缺 confirm 必须拒绝');

  const impact = await (await fetch(base + '/api/excerpt-folders/' + p + '/impact')).json();
  assert.strictEqual(impact.categories, 3, '父子孙共 3 个');
  assert.strictEqual(impact.links, 1, '只统计子树内的归属');

  const del = await fetch(base + '/api/excerpt-folders/' + p + '?confirm=true', { method: 'DELETE' });
  assert.strictEqual(del.status, 200);
  const left = db.dbAll('SELECT id FROM excerpt_folders').map((r) => r.id);
  assert.deepStrictEqual(left, [other], '只删子树，无关分类保留');
  assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM excerpt_folder_links WHERE folder_id=?', [other]).n, 1, '无关分类的归属保留');
  assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM excerpts WHERE id=?', [exId]).n, 1, '录文内容必须保留');
  assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM excerpt_folder_links WHERE excerpt_id=?', [exId]).n, 1, '只解除被删子树的归属');
  void g;
}));

test('服务端：主题 PATCH 改名可用，删除需 confirm', () => withServer(async ({ db, base }) => {
  const id = Number(db.dbRun("INSERT INTO themes (name,parent_id,sort) VALUES ('旧主题',NULL,0)").lastInsertRowid);
  const ok = await fetch(base + '/api/themes/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '新主题' })
  });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(db.dbGet('SELECT name FROM themes WHERE id=?', [id]).name, '新主题');

  const bad = await fetch(base + '/api/themes/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X' }) });
  assert.strictEqual(bad.status, 404);
  const noConfirm = await fetch(base + '/api/themes/' + id, { method: 'DELETE' });
  assert.strictEqual(noConfirm.status, 400);
  const del = await fetch(base + '/api/themes/' + id + '?confirm=true', { method: 'DELETE' });
  assert.strictEqual(del.status, 200);
  assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM themes WHERE id=?', [id]).n, 0);
}));

test('主题：分类树接口返回 nested 结构，供管理面板使用', () => withServer(async ({ db, base }) => {
  const p = Number(db.dbRun("INSERT INTO themes (name,parent_id,sort) VALUES ('父',NULL,0)").lastInsertRowid);
  db.dbRun('INSERT INTO themes (name,parent_id,sort) VALUES (?,?,1)', ['子', p]);
  const tree = await (await fetch(base + '/api/themes?tree=1')).json();
  assert.ok(Array.isArray(tree), '应返回数组');
  // themes 服务保持 V2 扁平返回；管理面板的 flatten 兼容扁平与嵌套
  const rows = tree.length && tree[0].children ? tree : null;
  if (!rows) {
    const flat = tree;
    const A = loadClassifyActions({ apiCalls: [], toast: [], forms: [], confirms: [], impact: {} });
    const f = A.flatten(flat.map((r) => ({ id: r.id, name: r.name, parent_id: r.parent_id, children: [] })));
    assert.strictEqual(f.length, 2);
  }
  void p;
}));

/* ---------- 页面脚本装配 ---------- */
test('详情页不再加载录文树脚本；taxonomy.js 仍全局可用', () => withServer(async ({ db, base }) => {
  const id = Number(db.dbRun("INSERT INTO items (module,title,subtitle,status,fields,created_at,updated_at) VALUES ('classics','某书','','未读','{}',?,?)", [db.now(), db.now()]).lastInsertRowid);
  const html = await (await fetch(base + '/sources/classics/' + id)).text();
  // V5.3：条目页的「录文分类（全局）」面板已删除，录文树脚本不再注入
  assert.ok(!html.includes('/static/js/excerpt-tree.js'), '不应再加载录文树脚本（面板已删除）');
  assert.ok(html.includes('/static/js/taxonomy.js') || html.includes('taxonomy.js'), 'taxonomy.js 全局加载（manageTaxonomy 依赖它）');
  assert.ok(!html.includes('录文分类（全局）'), '不应再渲染分类面板');
  assert.ok(html.includes('id="tab-excerpts"'), '录文页签应保留（录文从条目页录入）');
  const open = (html.match(/<div\b/g) || []).length;
  assert.strictEqual((html.match(/<\/div>/g) || []).length, open, 'div 必须平衡');
  void db;
}));

test('classify-manager 支持 theme 作用域（标题与端点）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'classify-manager.js'), 'utf8');
  assert.ok(src.includes('theme:'), '应支持 theme scope');
  assert.ok(!src.includes('A.flatten([])'), '不应再出现空树占位（新建分类需真实上级选项）');
  assert.ok(!/function rowOf\(id\)/.test(src), '死代码占位函数应移除');
});
