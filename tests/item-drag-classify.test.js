// 条目拖拽归类的行为验证（用最小 DOM 桩真实执行 item-drag.js）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* ---------- 最小 DOM 桩 ---------- */
function el(tag, attrs = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(), attrs, children, dataset: {}, hidden: false, textContent: '',
    parentElement: null, _l: {},
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
    removeEventListener() {},
    dispatch(type, ev) {
      ev = ev || {};
      ev.type = type;
      ev.target = ev.target || this;
      ev.dataTransfer = ev.dataTransfer || makeDT();
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
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }
    }
  };
  node.classList._s = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
  // 浏览器里 el.id = x 会同步到属性；桩需保持一致，否则 closest('#id') 命中不了
  Object.defineProperty(node, 'id', {
    get() { return this.attrs.id || ''; },
    set(v) { this.attrs.id = v; }
  });
  // 脚本会用 className 赋值，需同步到 classList，否则按类名查不到
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
  const tokens = sel.match(/^[a-zA-Z][\w-]*|#[-\w]+|\.[-\w]+|\[[^\]]+\]/g);
  if (!tokens) return false;
  for (const t of tokens) {
    if (t.startsWith('#')) { if (node.attrs.id !== t.slice(1)) return false; }
    else if (t.startsWith('.')) { if (!node.classList.contains(t.slice(1))) return false; }
    else if (t.startsWith('[')) { const mm = t.slice(1, -1).match(/^([-\w]+)(?:=["']?([^"'\]]*)["']?)?$/); if (!mm || node.attrs[mm[1]] === undefined) return false; if (mm[2] !== undefined && String(node.attrs[mm[1]]) !== mm[2]) return false; }
    else if (node.tagName !== t.toUpperCase()) return false;
  }
  return true;
}
function q(root, sel) {
  const out = [];
  (function walk(n) { for (const c of n.children) { if (m(c, sel)) out.push(c); walk(c); } })(root);
  return out;
}
function makeDT() {
  const store = {};
  return {
    types: ['Files'], files: [], items: [], effectAllowed: '', dropEffect: '',
    setData(t, v) { store[t] = String(v); this.types = Object.keys(store).concat(['Files']); },
    getData(t) { return store[t] || ''; }
  };
}

/* ---------- 页面骨架 ---------- */
function buildPage(item) {
  const title = el('div', { class: 'li-title' });
  title.textContent = item.title;
  const li = el('a', {
    class: 'li', href: '/library/papers/' + item.id, draggable: 'true',
    'data-item-id': String(item.id), 'data-collections': item.cols || ''
  }, [title]);
  const listWrap = el('div', { class: 'list-wrap' }, [li]);
  const list = el('section', { class: 'col-list' }, [listWrap]);

  const nodeA = el('li', { class: 'tree-node', 'data-id': '3' }, [
    el('div', { class: 'tree-row' }, [el('a', { class: 'tree-item' })])
  ]);
  const treeInner = el('div', { class: 'tree-zone' }, [nodeA]);
  const tree = el('aside', { class: 'col-tree', 'data-module': 'paper' }, [treeInner]);
  nodeA.querySelector('.tree-item').textContent = '制度';

  const unclassified = el('a', { class: 'tree-item', href: '?collection=none' });
  unclassified.textContent = '未归类 3';
  treeInner.appendChild(unclassified);

  const body = el('body', {}, [tree, list]);   // classList 由 el() 提供，含 add/remove/contains
  return { body, list, tree, li, nodeA, unclassified };
}

function runDrag(page, calls, opts = {}) {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'item-drag.js'), 'utf8');
  const document = {
    body: page.body,                                   // 脚本会往 body 加 class
    querySelector: (s) => (s === '.col-list' ? page.list : s === '.col-tree' ? page.tree : null),
    getElementById: () => null,
    createElement: (t) => el(t),
    addEventListener() {}
  };
  calls.api = async (url, o) => {
    calls.apiCalls.push({ url, o });
    if (url === '/api/collections') return { id: 9, name: o.body.name };
    return { id: 3 };
  };
  const windowObj = { toast: (t) => calls.toast.push(t) };
  windowObj.window = windowObj;
  // V5：新建分类已从 window.prompt 改为应用内 openForm（Electron 不支持 prompt）
  const openForm = (o) => { calls.forms.push(o); return { __form: true }; };
  new Function('window', 'document', 'location', 'api', 'toast', 'openForm', src)
    (windowObj, document, { reload: () => { calls.reloads += 1; } }, calls.api, windowObj.toast, openForm);
}

/** 驱动 openForm 提交：模拟用户在应用内表单填名并确认 */
async function submitForm(calls, values, index = 0) {
  const form = calls.forms[index];
  assert.ok(form, '应弹出应用内表单，实际没弹');
  return form.onSubmit(values);
}

/* ---------- 用例 ---------- */
const fresh = () => ({ apiCalls: [], toast: [], forms: [], reloads: 0 });

test('拖到分类上：以「追加」方式归类，并刷新列表', async () => {
  const page = buildPage({ id: 11, title: '宋代职官考', cols: '1,2' });
  const calls = fresh();
  // api 由 runDrag 注入
  runDrag(page, calls);

  page.li.dispatch('dragstart', { dataTransfer: makeDT(), bubbles: true });
  assert.ok(page.tree.querySelector('.item-drop-new'), '拖起后左栏应出现「＋新建分类」放置区');

  const row = page.nodeA.querySelector('.tree-row');
  row.dispatch('dragover', { dataTransfer: makeDT(), bubbles: true });
  assert.ok(row.classList.contains('drop-into'), '悬停分类应高亮');

  row.dispatch('drop', { dataTransfer: makeDT(), bubbles: true });
  await new Promise((r) => setTimeout(r, 20));

  const req = calls.apiCalls.find((c) => c.url === '/api/collections/assign');
  assert.ok(req, '应调用归类接口');
  assert.strictEqual(req.o.body.target, 'item');
  assert.strictEqual(req.o.body.owner_id, 11);
  assert.deepStrictEqual(req.o.body.collection_ids, [3]);
  assert.strictEqual(req.o.body.mode, 'add', '必须是追加语义，不能覆盖原有分类');
  assert.ok(calls.toast.some((t) => /归入/.test(t)), '应提示归类成功');
  assert.strictEqual(calls.reloads, 1, '成功后应刷新列表');
  assert.ok(!page.tree.querySelector('.item-drop-new'), '结束后放置区应移除');
});

test('重复归类：已在该分类中则不写库、给出提示', async () => {
  const page = buildPage({ id: 12, title: '漕运考', cols: '3,5' });   // 已含分类 3
  const calls = fresh();
  calls.api = async (url, o) => { calls.apiCalls.push({ url, o }); return { id: 3 }; };
  runDrag(page, calls);

  page.li.dispatch('dragstart', { dataTransfer: makeDT(), bubbles: true });
  page.nodeA.querySelector('.tree-row').dispatch('drop', { dataTransfer: makeDT(), bubbles: true });
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(!calls.apiCalls.some((c) => c.url === '/api/collections/assign'), '不应重复写入');
  assert.ok(calls.toast.some((t) => /已在该分类/.test(t)), '应提示已在该分类，实际：' + JSON.stringify(calls.toast));
  assert.strictEqual(calls.reloads, 0, '无需刷新');
});

test('拖到「未归类」节点上：不作为归类目标', async () => {
  const page = buildPage({ id: 13, title: '契约书', cols: '' });
  const calls = fresh();
  calls.api = async (url, o) => { calls.apiCalls.push({ url, o }); return { id: 3 }; };
  runDrag(page, calls);

  page.li.dispatch('dragstart', { dataTransfer: makeDT(), bubbles: true });
  page.unclassified.dispatch('drop', { dataTransfer: makeDT(), bubbles: true });
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(!calls.apiCalls.some((c) => c.url === '/api/collections/assign'), '不应写入');
  assert.ok(calls.toast.some((t) => /请拖到具体的分类/.test(t)), '应提示拖到具体分类');
});

test('取消拖拽：dragend 后清理高亮与放置区，不产生任何写操作', async () => {
  const page = buildPage({ id: 14, title: '碑刻考', cols: '' });
  const calls = fresh();
  calls.api = async (url, o) => { calls.apiCalls.push({ url, o }); return { id: 3 }; };
  runDrag(page, calls);

  page.li.dispatch('dragstart', { dataTransfer: makeDT(), bubbles: true });
  assert.ok(page.tree.querySelector('.item-drop-new'), '拖起时应有放置区');
  page.li.dispatch('dragend', { dataTransfer: makeDT(), bubbles: true });
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(!page.tree.querySelector('.item-drop-new'), '拖拽结束应移除放置区');
  assert.strictEqual(calls.apiCalls.length, 0, '取消不应调用任何接口');
  assert.strictEqual(calls.reloads, 0, '取消不应刷新');
});

test('拖到「＋新建分类」：弹应用内表单，确认后建分类再归类', async () => {
  const page = buildPage({ id: 15, title: '新论文草稿', cols: '' });
  const calls = fresh();
  // api 由 runDrag 注入（新建分类返回 9）
  runDrag(page, calls);

  page.li.dispatch('dragstart', { dataTransfer: makeDT(), bubbles: true });
  const zone = page.tree.querySelector('.item-drop-new');
  assert.ok(zone, '应有放置区');
  zone.dispatch('drop', { dataTransfer: makeDT(), bubbles: true });
  await new Promise((r) => setTimeout(r, 30));

  // V5：不再用 window.prompt（Electron 不支持），改为应用内表单
  assert.strictEqual(calls.apiCalls.filter((c) => c.url === '/api/collections').length, 0, '表单未确认前不应建分类');
  await submitForm(calls, { name: '新分类' });
  await new Promise((r) => setTimeout(r, 20));

  const created = calls.apiCalls.find((c) => c.url === '/api/collections');
  const assigned = calls.apiCalls.find((c) => c.url === '/api/collections/assign');
  assert.ok(created, '应先新建分类');
  assert.strictEqual(created.o.body.name, '新分类');
  assert.strictEqual(created.o.body.module, 'paper', '新建分类必须带 module（后端强制校验）');
  assert.ok(assigned, '随后应归类');
  assert.deepStrictEqual(assigned.o.body.collection_ids, [9], '应归入刚建的分类');
});

test('应用内表单：分类名为空时拒绝提交（不建分类）', async () => {
  const page = buildPage({ id: 20, title: '空名', cols: '' });
  const calls = fresh();
  runDrag(page, calls);
  page.li.dispatch('dragstart', { dataTransfer: makeDT(), bubbles: true });
  page.tree.querySelector('.item-drop-new').dispatch('drop', { dataTransfer: makeDT(), bubbles: true });
  await new Promise((r) => setTimeout(r, 30));
  await assert.rejects(() => submitForm(calls, { name: '   ' }), /不能为空/, '空名应被拒');
  assert.strictEqual(calls.apiCalls.filter((c) => c.url === '/api/collections').length, 0, '不应建分类');
});

test('点击行为不受影响：普通点击仍可进入详情页', () => {
  const page = buildPage({ id: 16, title: '正常点击', cols: '' });
  const calls = fresh();
  // api 由 runDrag 注入
  runDrag(page, calls);
  // 未拖拽时 click 不被拦截
  const ev = page.li.dispatch('click', { bubbles: true });
  assert.notStrictEqual(ev.defaultPrevented, true, '普通点击不应被阻止');
  assert.notStrictEqual(ev.stopped, true, '普通点击不应被停止传播');
});

test('拖拽后紧随的点击被抑制（避免误跳详情页）', async () => {
  const page = buildPage({ id: 17, title: '拖过就松手', cols: '' });
  const calls = fresh();
  calls.api = async () => ({});
  runDrag(page, calls);
  page.li.dispatch('dragstart', { dataTransfer: makeDT(), bubbles: true });
  page.li.dispatch('dragend', { dataTransfer: makeDT(), bubbles: true });
  const ev = page.li.dispatch('click', { bubbles: true });
  assert.strictEqual(ev.defaultPrevented, true, '刚拖完的点击应被拦下');
});

test('树节点自身的拖拽不被本脚本接管（与排序拖拽区分）', () => {
  const page = buildPage({ id: 18, title: '不干扰树', cols: '' });
  const calls = fresh();
  calls.api = async () => ({});
  runDrag(page, calls);
  const dt = makeDT();
  dt.types = ['application/x-lesp-collection'];
  const ev = page.nodeA.querySelector('.tree-row').dispatch('dragover', { dataTransfer: dt, bubbles: true });
  assert.notStrictEqual(ev.defaultPrevented, true, '树节点拖拽不应被条目脚本拦截');
});

test('列表页 HTML：条目带 draggable 与已归分类', async () => {
  const fs2 = require('node:fs');
  const os = require('node:os');
  const path2 = require('node:path');
  const tmp = fs2.mkdtempSync(path2.join(os.tmpdir(), 'lesp-drag-'));
  const paths = require('../server/lib/paths');
  paths.setDataDir(tmp);
  const db = require('../server/db');
  db.initDb(tmp);
  const { createApp } = require('../server/app');
  const itemId = Number(db.dbRun("INSERT INTO items (module,title,subtitle,status,fields,created_at,updated_at) VALUES ('paper','可拖条目','','未读','{}',?,?)", [db.now(), db.now()]).lastInsertRowid);
  const colId = Number(db.dbRun("INSERT INTO collections (module,name,sort) VALUES ('paper','制度',0)").lastInsertRowid);
  db.dbRun('INSERT INTO collection_items (collection_id,item_id) VALUES (?,?)', [colId, itemId]);
  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const html = await (await fetch(base + '/library/papers')).text();
    assert.ok(html.includes('draggable="true"'), '列表项应可拖拽');
    assert.ok(html.includes('data-item-id="' + itemId + '"'), '应带条目 id');
    assert.ok(html.includes('data-collections="' + colId + '"'), '应带已归分类，供重复判断');
    assert.ok(html.includes('/static/js/item-drag.js'), '列表页应加载拖拽脚本');
    // 标签平衡
    const open = (html.match(/<div\b/g) || []).length;
    const close = (html.match(/<\/div>/g) || []).length;
    assert.strictEqual(close, open, 'div 应平衡');
  } finally { srv.close(); }
  try { db.closeDb && db.closeDb(); } catch (e) { /* 忽略 */ }
  try { fs2.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
});

// —— 拖条目时不应弹出「导入 PDF」遮罩（问题1）——
test('拖拽归类时，文件导入脚本不得弹出「导入 PDF」提示', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'drop-import.js'), 'utf8');
  assert.ok(src.includes('isInternalDrag'), 'drop-import 应能识别内部拖拽');
  assert.ok(src.includes("'application/x-lesp-item'"), '应识别条目归类拖拽');
  assert.ok(src.includes("'application/x-lesp-collection'"), '应识别分类树排序拖拽');
  // dragenter / dragover 必须先判类型再判文件，最后才响应
  const enter = src.slice(src.indexOf('const onDragEnter'), src.indexOf('const onDragOver'));
  assert.ok(enter.indexOf('isInternalDrag') < enter.indexOf('preventDefault'), 'dragenter 应先放行内部拖拽再 preventDefault');
  const over = src.slice(src.indexOf('const onDragOver'), src.indexOf('const onDragLeave'));
  assert.ok(over.indexOf('isInternalDrag') < over.indexOf('preventDefault'), 'dragover 应先放行内部拖拽再 preventDefault');
  assert.ok(over.includes('if (!hasFiles(e)) return;'), 'dragover 应恢复「只认文件」判断');
});

test('拖文件导入仍被识别（未被上一条误伤）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'drop-import.js'), 'utf8');
  const enter = src.slice(src.indexOf('const onDragEnter'), src.indexOf('const onDragOver'));
  assert.ok(enter.includes('if (!hasFiles(e)) return;'), '拖文件时仍应走导入流程');
  assert.ok(enter.includes('showHint('), '拖文件时仍应显示导入提示');
});
