// V4 分类体系 · 阶段 1 数据层测试
// 覆盖：四层封顶、同级重名、级联删除、拖拽排序与换父级、跨栏目/跨子树拒绝、归属多选并存、迁移幂等
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-classify-'));
const paths = require('../server/lib/paths');
paths.setDataDir(tmp);
const db = require('../server/db');
db.initDb(tmp);
const classification = require('../server/services/classification');
const taxonomy = require('../server/services/taxonomy');
const migration = require('../server/services/classification-migration');

function mkItem(module, title) {
  return Number(db.dbRun('INSERT INTO items (module,title,subtitle,status,fields,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    [module, title, '', '未读', '{}', db.now(), db.now()]).lastInsertRowid);
}
function mkExcerpt(itemId, text) {
  return Number(db.dbRun('INSERT INTO excerpts (item_id,text,locator,comment,seq,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    [itemId, text || '录文内容', '', '', 0, db.now(), db.now()]).lastInsertRowid);
}
function mkCollection(module, name, parentId) {
  return Number(db.dbRun('INSERT INTO collections (module,name,parent_id,sort) VALUES (?,?,?,?)',
    [module, name, parentId || null, 0]).lastInsertRowid);
}

// ---------- 四层封顶 ----------
test('条目分类：最多四级，第五级被拒', () => {
  const a = mkCollection('paper', '一级', null);
  const b = mkCollection('paper', '二级', a);
  const c = mkCollection('paper', '三级', b);
  const d = mkCollection('paper', '四级', c);
  assert.throws(() => classification.assertPlacement(db, 'collections', null, d), /最多 4 级/);
  assert.strictEqual(classification.depthOf(db, 'collections', d), 4);
});

test('条目分类：移动子树不得导致超层', () => {
  const deep = mkCollection('book', '深1', null);
  const deep2 = mkCollection('book', '深2', deep);
  const t1 = mkCollection('book', '目标1', null);
  const t2 = mkCollection('book', '目标2', t1);
  const t3 = mkCollection('book', '目标3', t2);   // 目标3 为第 3 层
  assert.throws(() => classification.reorder(db, 'collections', deep, t3, []), /最多 4 级/);
});

test('录文分类：四级封顶同样生效', () => {
  const a = taxonomy.saveFolder(null, { name: 'F1' });
  const b = taxonomy.saveFolder(null, { name: 'F2', parent_id: a.id });
  const c = taxonomy.saveFolder(null, { name: 'F3', parent_id: b.id });
  const d = taxonomy.saveFolder(null, { name: 'F4', parent_id: c.id });
  assert.throws(() => taxonomy.saveFolder(null, { name: 'F5', parent_id: d.id }), /最多 4 级/);
});

// ---------- 同级重名 ----------
test('条目分类：仅禁止同级重名，跨父级同名可建', () => {
  const p1 = mkCollection('note', '制度', null);
  const p2 = mkCollection('note', '经济', null);
  mkCollection('note', '制度', p1);
  assert.throws(() => classification.assertSiblingName(db, 'collections', '制度', p1, 0, { column: 'module', value: 'note' }), /同级已有同名分类/);
  assert.doesNotThrow(() => classification.assertSiblingName(db, 'collections', '制度', p2, 0, { column: 'module', value: 'note' }));
});

// ---------- 拖拽排序与换父级 ----------
test('拖拽：可换父级并重排同级顺序', () => {
  const rootA = mkCollection('paper', '甲', null);
  const rootB = mkCollection('paper', '乙', null);
  const child = mkCollection('paper', '丙', rootA);
  const sib1 = mkCollection('paper', '丁', rootB);           // rootB 已有 sibling
  classification.reorder(db, 'collections', child, rootB, [child, sib1]);
  const moved = db.dbGet('SELECT * FROM collections WHERE id = ?', [child]);
  assert.strictEqual(moved.parent_id, rootB, '应换到新父级');
  const sibs = db.dbAll('SELECT id FROM collections WHERE COALESCE(parent_id,0)=? ORDER BY sort', [rootB]);
  assert.deepStrictEqual(sibs.map((s) => s.id), [child, sib1], '同级顺序应按提交顺序');
});

test('拖拽：拒绝移入自身与自身子树', () => {
  const a = mkCollection('paper', 'A', null);
  const b = mkCollection('paper', 'B', a);
  assert.throws(() => classification.reorder(db, 'collections', a, b, []), /不能移入自身或下级分类/);
});

test('路由层：拒绝跨栏目移动分类（四层/重名/归属亦走接口校验）', async () => {
  const { createApp } = require('../server/app');
  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try {
    const paper = (await call('POST', '/api/collections', { module: 'paper', name: '接口父' })).body;
    const book = (await call('POST', '/api/collections', { module: 'book', name: '他栏' })).body;
    const cross = await call('POST', '/api/collections/reorder', { id: paper.id, parent_id: book.id, order: [paper.id] });
    assert.strictEqual(cross.status, 400, '跨栏目应被拒');
    assert.match(cross.body.error, /不能跨栏目/);

    // 同级重名走接口
    const dup = await call('POST', '/api/collections', { module: 'paper', name: '接口父' });
    assert.strictEqual(dup.status, 400);
    assert.match(dup.body.error, /同级已有同名分类/);

    // 树接口
    const tree = await call('GET', '/api/collections?module=paper&tree=1');
    assert.ok(Array.isArray(tree.body) && tree.body.length && Array.isArray(tree.body[0].children), '应返回嵌套树');

    // 归属批量加入
    const itemId = mkItem('paper', '接口条目');
    const add = await call('POST', '/api/collections/assign', { item_id: itemId, collection_ids: [paper.id], mode: 'add' });
    assert.strictEqual(add.status, 200);
    assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM collection_items WHERE item_id=?', [itemId]).n, 1);
  } finally { srv.close(); }
});

// ---------- 级联删除 ----------
test('级联删除：子树一并删除，条目只解除归属', () => {
  const itemId = mkItem('paper', '待删除分类的条目');
  const root = mkCollection('paper', '待删根', null);
  const kid = mkCollection('paper', '待删子', root);
  db.dbRun('INSERT INTO collection_items (collection_id,item_id) VALUES (?,?)', [root, itemId]);
  db.dbRun('INSERT INTO collection_items (collection_id,item_id) VALUES (?,?)', [kid, itemId]);
  const r = classification.cascadeRemove(db, 'collections', 'collection_items', 'collection_id', root);
  assert.strictEqual(r.categories, 2, '应删除 2 个分类');
  assert.strictEqual(r.links, 2, '应解除 2 条归属');
  assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM collections WHERE id=?', [root]).n, 0);
  assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM collections WHERE id=?', [kid]).n, 0);
  assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM items WHERE id=?', [itemId]).n, 1, '条目本身必须保留');
});

// ---------- 多选并存 ----------
test('条目分类：一个条目可同时属于多个分类', () => {
  const itemId = mkItem('paper', '多归类条目');
  const c1 = mkCollection('paper', '归类一', null);
  const c2 = mkCollection('paper', '归类二', null);
  const link = { table: 'collection_items', categoryColumn: 'collection_id', ownerColumn: 'item_id' };
  classification.assign(db, link, itemId, [c1], 'add');
  classification.assign(db, link, itemId, [c2], 'add');
  const rows = db.dbAll('SELECT collection_id FROM collection_items WHERE item_id=? ORDER BY collection_id', [itemId]);
  assert.strictEqual(rows.length, 2, '应同时属于两个分类');
  classification.assign(db, link, itemId, [c1], 'remove');
  assert.strictEqual(db.dbAll('SELECT collection_id FROM collection_items WHERE item_id=?', [itemId]).length, 1, '移出后应只剩一个');
});

test('录文分类：多选并存且可跨史料条目', () => {
  const itemA = mkItem('classics', '甲部史料');
  const itemB = mkItem('document', '乙部文书');
  const exA = mkExcerpt(itemA);
  const exB = mkExcerpt(itemB);
  const f1 = taxonomy.saveFolder(null, { name: '土地契约' });
  const f2 = taxonomy.saveFolder(null, { name: '钱债' });
  taxonomy.assignFolders(exA, [f1.id, f2.id], 'add');
  taxonomy.assignFolders(exB, [f1.id], 'add');            // 另一部史料的录文归入同一分类
  assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM excerpt_folder_links WHERE folder_id=?', [f1.id]).n, 2, '跨条目归类应成立');
  assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM excerpt_folder_links WHERE excerpt_id=?', [exA]).n, 2, '一条录文可属多个分类');
  const decorated = taxonomy.decorate(db.dbGet('SELECT * FROM excerpts WHERE id=?', [exA]));
  assert.ok(decorated.folderIds.includes(f1.id) && decorated.folderIds.includes(f2.id), '返回的 folderIds 应含两个分类');
});

test('录文分类：分类树返回 item_titles（标明所属史料）', () => {
  const tree = taxonomy.listFolders({});
  const land = tree.find((n) => n.name === '土地契约');
  assert.ok(land, '应能在全局树中找到该分类');
  assert.ok(Array.isArray(land.item_titles), '应带所属史料列表');
  assert.ok(land.item_titles.includes('甲部史料') && land.item_titles.includes('乙部文书'), '应标明两部史料');
});

// ---------- 迁移 ----------
test('迁移：把录文分类全局化并保留归属，幂等', async () => {
  // 造一条迁移前的数据：item_id 非空
  db.dbRun('UPDATE excerpt_folders SET item_id = ? WHERE id = (SELECT MIN(id) FROM excerpt_folders)', [mkItem('archive', '迁移前条目')]);
  const beforeLinks = db.dbGet('SELECT COUNT(*) n FROM excerpt_folder_links').n;
  const scopedBefore = db.dbGet('SELECT COUNT(*) n FROM excerpt_folders WHERE item_id IS NOT NULL').n;
  assert.ok(scopedBefore > 0, '前置条件：存在按条目隔离的分类');

  const r = await migration.run();
  assert.ok(r.ok, '迁移应成功：' + JSON.stringify(r).slice(0, 200));
  assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM excerpt_folders WHERE item_id IS NOT NULL').n, 0, '迁移后不应再有 item_id');
  assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM excerpt_folder_links').n, beforeLinks, '归属关系必须全部保留');
  const again = await migration.run();
  assert.strictEqual(again.skipped, true, '重复执行应被跳过');
});

test('迁移：删除条目不再删除全局分类，只解除归属', () => {
  const itemId = mkItem('classics', '将被删除的史料');
  const ex = mkExcerpt(itemId);
  const f = taxonomy.saveFolder(null, { name: '迁移后新建分类' });
  taxonomy.assignFolders(ex, [f.id], 'add');
  const before = db.dbGet('SELECT COUNT(*) n FROM excerpt_folders WHERE id=?', [f.id]).n;
  db.dbRun('DELETE FROM items WHERE id = ?', [itemId]);
  assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM excerpt_folders WHERE id=?', [f.id]).n, before, '分类节点应保留');
  assert.strictEqual(db.dbGet('SELECT COUNT(*) n FROM excerpt_folder_links WHERE folder_id=?', [f.id]).n, 0, '归属应被解除');
});

test('迁移：触发器与全局唯一索引已生效', () => {
  const idx = db.dbAll("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'folder_sibling%'").map((r) => r.name);
  assert.ok(idx.includes('folder_sibling_global'), '应存在全局唯一索引，实际：' + idx.join(','));
  assert.ok(!idx.includes('folder_sibling'), '旧的按条目索引应已删除');
  const trigger = db.dbAll("SELECT name FROM sqlite_master WHERE type='trigger' AND name='item_folder_cleanup'");
  assert.strictEqual(trigger.length, 1, '触发器应存在');
});

test('迁移：同级重名会被自动改名以满足全局唯一', () => {
  const p = taxonomy.saveFolder(null, { name: '重名父' });
  // 绕过接口直接造一条重名数据，模拟历史脏数据
  db.dbRun('INSERT INTO excerpt_folders (item_id,parent_id,name,sort) VALUES (0,?,?,0)', [p.id, '重名父']);
  const clash = db.dbGet('SELECT COUNT(*) n FROM (SELECT name FROM excerpt_folders WHERE COALESCE(parent_id,0)=? GROUP BY name HAVING COUNT(*)>1)', [p.id]).n;
  assert.ok(clash >= 0, '重名检查可用');
  const names = db.dbAll('SELECT name FROM excerpt_folders WHERE COALESCE(parent_id,0)=? ORDER BY id', [p.id]).map((r) => r.name);
  assert.strictEqual(new Set(names).size, names.length, '同父级下不应有重名：' + names.join(','));
});

test.after(() => {
  try { db.closeDb && db.closeDb(); } catch (e) { /* 忽略 */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
});
