// 阶段 2 验证：列表页分类树渲染（四级嵌套 + 折叠按钮 + 数据属性 + 脚本引入）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-tree-'));
const paths = require('../server/lib/paths');
paths.setDataDir(tmp);
const db = require('../server/db');
db.initDb(tmp);
const { createApp } = require('../server/app');
const C = require('../server/services/classification');

function mkItem(module, title) {
  return Number(db.dbRun('INSERT INTO items (module,title,subtitle,status,fields,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    [module, title, '', '未读', '{}', db.now(), db.now()]).lastInsertRowid);
}
function mkCollection(module, name, parentId) {
  return Number(db.dbRun('INSERT INTO collections (module,name,parent_id,sort) VALUES (?,?,?,?)',
    [module, name, parentId || null, 0]).lastInsertRowid);
}

test('列表页渲染四级嵌套分类树', async () => {
  const a = mkCollection('paper', '一', null);
  const b = mkCollection('paper', '二', a);
  const c = mkCollection('paper', '三', b);
  const d = mkCollection('paper', '四', c);
  const itemId = mkItem('paper', '被归类的论文');
  db.dbRun('INSERT INTO collection_items (collection_id,item_id) VALUES (?,?)', [c.id || c, itemId]);
  db.dbRun('INSERT INTO collection_items (collection_id,item_id) VALUES (?,?)', [a, itemId]);

  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const res = await fetch(base + '/library/papers');
    const html = await res.text();
    assert.strictEqual(res.status, 200);
    assert.ok(html.includes('class="tree-root"'), '应输出根级树容器');
    assert.ok(html.includes('class="tree-kids"'), '应输出子级容器');
    assert.ok(html.includes('data-id="' + a + '"') && html.includes('data-id="' + d + '"'), '四个层级都应出现');
    assert.ok(html.includes('data-parent="' + b + '"'), '子节点应带父级 id');
    // 有下级的才有折叠按钮（四个节点逐级）
    const toggles = (html.match(/data-toggle="/g) || []).length;
    assert.ok(toggles >= 3, '有下级的分类应渲染折叠按钮，实际 ' + toggles);
    assert.ok(html.includes('data-module="paper"'), '应挂上 module 数据属性');
    assert.ok(html.includes('/static/js/collection-tree.js'), '应加载分类树脚本');
    assert.ok(html.includes('id="btn-new-collection"'), '应有新建分类入口');
    // 计数：一级与三级各含 1 条
    assert.ok(html.includes('>1</span>'), '应显示条目计数');
  } finally { srv.close(); }
});

test('折叠按钮只出现在有下级的分类上', () => {
  const parent = mkCollection('book', '有下级', null);
  const leaf = mkCollection('book', '叶子', parent);
  const solo = mkCollection('book', '独苗', null);
  const tree = C.buildTree(db, 'collections', db.dbAll('SELECT * FROM collections WHERE module = ?', ['book']), () => 0);
  const find = (nodes, id) => {
    for (const n of nodes) { if (n.id === id) return n; const hit = find(n.children, id); if (hit) return hit; }
    return null;
  };
  assert.ok(find(tree, parent).children.length === 1, '有下级');
  assert.strictEqual(find(tree, leaf).children.length, 0, '叶子无下级');
  assert.strictEqual(find(tree, solo).children.length, 0, '独苗无下级');
});

test('前端脚本包含折叠、右键菜单与全部收起', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'collection-tree.js'), 'utf8');
  assert.ok(js.includes("localStorage"), '折叠状态应存本地');
  assert.ok(js.includes("keydown") && js.includes("'Escape'"), '菜单应支持 Esc 关闭');
  for (const label of ['新建子分类', '重命名', '移动到', '删除']) {
    assert.ok(js.includes(label), '右键菜单缺少：' + label);
  }
  assert.ok(js.includes('btn-tree-collapse-all'), '缺少全部收起/展开');
  assert.ok(js.includes("/api/collections/reorder"), '移动应走重排接口');
});

test('样式包含折叠按钮与右键菜单', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
  assert.ok(css.includes('.tree-toggle'), '缺少折叠按钮样式');
  assert.ok(css.includes('.ctx-menu'), '缺少右键菜单样式');
  assert.ok(css.includes('.tree-kids'), '缺少子级缩进样式');
});

test.after(() => {
  try { db.closeDb && db.closeDb(); } catch (e) { /* 忽略 */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
});
// —— 阶段 4：分类作为列表筛选维度（含子分类 / 只看本级）——
test('列表筛选：默认含子分类，classification_exact=1 时只看本级', async () => {
  const root = mkCollection('paper', '筛选父', null);
  const kid = mkCollection('paper', '筛选子', root);
  const inRoot = mkItem('paper', '只在父分类');
  const inKid = mkItem('paper', '只在子分类');
  db.dbRun('INSERT INTO collection_items (collection_id,item_id) VALUES (?,?)', [root, inRoot]);
  db.dbRun('INSERT INTO collection_items (collection_id,item_id) VALUES (?,?)', [kid, inKid]);

  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const all = await (await fetch(base + '/api/items?module=paper&collection=' + root + '&size=50')).json();
    const idsAll = all.items.map((i) => i.id);
    assert.ok(idsAll.includes(inRoot) && idsAll.includes(inKid), '默认应含子分类下的条目');

    const exact = await (await fetch(base + '/api/items?module=paper&collection=' + root + '&classification_exact=1&size=50')).json();
    const idsExact = exact.items.map((i) => i.id);
    assert.ok(idsExact.includes(inRoot), '本级条目应在');
    assert.ok(!idsExact.includes(inKid), '只看本级时不应包含子分类条目');
  } finally { srv.close(); }
});

// —— 长编 / 札记纳入同一套分类树（方案 A）——
test('长编与札记可建分类并归类（各自关联表，栏目树独立）', async () => {
  const { createApp } = require('../server/app');
  const compId = Number(db.dbRun('INSERT INTO compilations (title,status,created_at,updated_at) VALUES (?,?,?,?)',
    ['甲长编', '在写', db.now(), db.now()]).lastInsertRowid);
  const noteId = Number(db.dbRun('INSERT INTO notes (title,body,created_at,updated_at) VALUES (?,?,?,?)',
    ['甲札记', '正文', db.now(), db.now()]).lastInsertRowid);

  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try {
    // 长编分类
    const cc = await call('POST', '/api/collections', { module: 'compilation', name: '长编分类' });
    assert.strictEqual(cc.status, 200);
    const addComp = await call('POST', '/api/collections/assign', { target: 'compilation', owner_id: compId, collection_ids: [cc.body.id], mode: 'add' });
    assert.strictEqual(addComp.status, 200);
    assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM collection_compilations WHERE compilation_id=?', [compId]).n, 1);

    // 札记分类
    const cn = await call('POST', '/api/collections', { module: 'note', name: '札记分类' });
    assert.strictEqual(cn.status, 200);
    await call('POST', '/api/collections/assign', { target: 'note', owner_id: noteId, collection_ids: [cn.body.id], mode: 'add' });
    assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM collection_notes WHERE note_id=?', [noteId]).n, 1);

    // 栏目隔离：长编分类不能归给札记
    const wrong = await call('POST', '/api/collections/assign', { target: 'note', owner_id: noteId, collection_ids: [cc.body.id], mode: 'add' });
    assert.strictEqual(wrong.status, 400, '跨栏目归类应被拒');

    // 列表页出现分类树
    for (const [url, module] of [['/writing/compilations', 'compilation'], ['/writing/notes', 'note']]) {
      const html = await (await fetch(base + url)).text();
      assert.ok(html.includes('data-module="' + module + '"'), url + ' 应带分类树容器');
      assert.ok(html.includes('/static/js/collection-tree.js'), url + ' 应加载分类树脚本');
    }

    // 树里的计数走各自关联表
    const compTree = await call('GET', '/api/collections?module=compilation&target=compilation&tree=1');
    assert.strictEqual(compTree.body[0].item_count, 1, '长编树计数应走 collection_compilations');
  } finally { srv.close(); }
});

// —— 阶段 3：拖拽 ——
test('拖拽实现：落位提示、禁止拖入自身子树、走 reorder 接口', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'collection-tree.js'), 'utf8');
  assert.ok(js.includes("addEventListener('dragstart'"), '缺少拖拽开始');
  assert.ok(js.includes("addEventListener('dragover'"), '缺少拖拽悬停判定');
  assert.ok(js.includes("addEventListener('drop'"), '缺少放置处理');
  assert.ok(js.includes("'inside'") && js.includes("'before'") && js.includes("'after'"), '缺少三种落位判定');
  assert.ok(/indicator\.className = 'drop-' \+ mode/.test(js), '缺少落位提示元素');
  assert.ok(js.includes('不落入自身子树'), '缺少自身子树保护');
  assert.ok(js.includes("api('/api/collections/reorder'"), '落位应走 reorder 接口');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
  assert.ok(css.includes('.drop-inside') && css.includes('.dragging'), '缺少拖拽样式');
});

// —— 分类管理交互（阶段 8：修复 prompt 无响应，补齐管理能力）——
test('分类管理：不再使用 window.prompt（Electron 不支持，会导致点击无反应）', () => {
  for (const f of ['public/js/collection-tree.js', 'public/js/excerpt-tree.js']) {
    const js = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/\bprompt\(/.test(js), f + ' 仍在使用 window.prompt');
  }
  const actions = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'classify-actions.js'), 'utf8');
  assert.ok(actions.includes('openForm'), '新建/编辑应使用应用内表单');
  assert.ok(actions.includes("'不能为空'") || actions.includes('不能为空'), '应有名称校验');
  assert.ok(actions.includes('confirmBox'), '删除应有二次确认');
  assert.ok(actions.includes('/impact'), '删除前应预览影响范围');
});

test('分类管理：面板具备加载中/空数据/失败三态与刷新', () => {
  const mgr = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'classify-manager.js'), 'utf8');
  assert.ok(mgr.includes('加载中'), '缺加载中状态');
  assert.ok(mgr.includes('cm-empty'), '缺空数据状态');
  assert.ok(mgr.includes('cm-error') && mgr.includes('加载失败'), '缺失败状态');
  assert.ok(mgr.includes('data-act="refresh"'), '缺刷新');
  assert.ok(mgr.includes('data-op="sub"') && mgr.includes('data-op="edit"') && mgr.includes('data-op="del"'), '缺子级/编辑/删除操作');
});

test('分类管理：后端支持描述字段与删除影响预览', async () => {
  const { createApp } = require('../server/app');
  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, u, b) => {
    const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json() };
  };
  try {
    const root = await call('POST', '/api/collections', { module: 'paper', name: '制度', description: '制度相关' });
    assert.strictEqual(root.status, 200);
    assert.strictEqual(root.body.description, '制度相关', '描述应落库');
    const sub = await call('POST', '/api/collections', { module: 'paper', name: '土地制度', parent_id: root.body.id, description: '田制' });
    assert.strictEqual(sub.body.parent_id, root.body.id, '应归属到父分类');
    assert.strictEqual(sub.body.description, '田制');

    const itemId = mkItem('paper', '受影响的论文');
    await call('POST', '/api/collections/assign', { target: 'item', owner_id: itemId, collection_ids: [sub.body.id], mode: 'add' });
    const impact = await call('GET', '/api/collections/' + root.body.id + '/impact');
    assert.strictEqual(impact.body.categories, 2, '预览应含子分类数');
    assert.strictEqual(impact.body.links, 1, '预览应含归类数');

    const del = await call('DELETE', '/api/collections/' + root.body.id);
    assert.strictEqual(del.body.categories, 2);
    assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM items WHERE id=?', [itemId]).n, 1, '删除分类不得删除条目');
  } finally { srv.close(); }
});

// —— 回归：页面 HTML 标签必须平衡 ——
// 删除某个 UI 片段时若留下多余的闭合标签，浏览器会重排后续结构，
// 表现为「侧栏与主区上下堆叠」这类整体布局塌陷，且不报任何错。
test('回归：所有页面渲染的 div 开闭必须平衡', async () => {
  const { createApp } = require('../server/app');
  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const urls = ['/library/papers', '/library/books', '/sources/archives', '/sources/classics',
    '/sources/inscriptions', '/sources/documents', '/', '/writing/notes', '/writing/compilations', '/settings', '/themes'];
  try {
    for (const url of urls) {
      const html = await (await fetch(base + url)).text();
      const open = (html.match(/<div\b/g) || []).length;
      const close = (html.match(/<\/div>/g) || []).length;
      assert.strictEqual(close, open, url + ' 的 div 不平衡：开 ' + open + ' / 闭 ' + close + '（多 ' + (close - open) + ' 个 </div>）');
    }
  } finally { srv.close(); }
});
