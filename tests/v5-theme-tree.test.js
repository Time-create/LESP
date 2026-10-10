// V5 阶段 4：主题树（独立维度，与分类正交并存）
// 覆盖：服务端关系接口、层级上限、跨栏目挂载、空状态、左栏装配、折叠 key 隔离
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function withServer(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-v5theme-'));
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

const addTheme = (db, name, parent) => Number(db.dbRun(
  parent ? 'INSERT INTO themes(parent_id,name) VALUES (?,?)' : 'INSERT INTO themes(name) VALUES (?)',
  parent ? [parent, name] : [name]
).lastInsertRowid);
const addItem = (db, module, title) => Number(db.dbRun(
  'INSERT INTO items (module,title,subtitle,status,fields,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
  [module, title, '', '未读', '{}', db.now(), db.now()]
).lastInsertRowid);
const addExcerpt = (db, itemId, text) => Number(db.dbRun(
  'INSERT INTO excerpts (item_id,seq,text,created_at,updated_at) VALUES (?,1,?,?,?)',
  [itemId, text, db.now(), db.now()]
).lastInsertRowid);
// notes 表只有 id/title/body/created_at/updated_at（无 status 列）
const addNote = (db, title) => Number(db.dbRun(
  'INSERT INTO notes (title,body,created_at,updated_at) VALUES (?,?,?,?)',
  [title, '正文', db.now(), db.now()]
).lastInsertRowid);

/* ---------- 关系接口 ---------- */
test('relations：返回主题挂载的对象，含类型与可点链接', () => withServer(async ({ db, base }) => {
  const t = addTheme(db, '宋代财政');
  const item = addItem(db, 'classics', '《宋会要辑稿》');
  const ex = addExcerpt(db, item, '财政相关原文');
  db.dbRun("INSERT INTO theme_links (theme_id,content_type,content_id) VALUES (?,'excerpt',?)", [t, ex]);
  const note = addNote(db, '钱法札记');
  db.dbRun("INSERT INTO theme_links (theme_id,content_type,content_id) VALUES (?,'note',?)", [t, note]);

  const res = await (await fetch(base + '/api/themes/' + t + '/relations')).json();
  assert.strictEqual(res.total, 2);
  const types = res.rows.map((r) => r.type).sort();
  assert.deepStrictEqual(types, ['excerpt', 'note'], '应含录文与札记');
  const exRow = res.rows.find((r) => r.type === 'excerpt');
  assert.ok(exRow.route.includes('/sources/classics/' + item), '录文应指向所属条目，实际：' + exRow.route);
  assert.ok(exRow.route.includes('#excerpt-' + ex), '应带录文锚点');
  const noteRow = res.rows.find((r) => r.type === 'note');
  assert.strictEqual(noteRow.route, '/writing/notes/' + note);
}));

test('relations：跨栏目挂载（同一主题挂古籍与论文的录文）', () => withServer(async ({ db, base }) => {
  const t = addTheme(db, '制度史');
  // 主题是独立维度：可同时挂不同栏目的对象的录文（古籍 + 论文）
  const cItem = addItem(db, 'classics', '古籍一条');
  const pItem = addItem(db, 'paper', '论文一条');
  const cEx = addExcerpt(db, cItem, '古籍原文');
  const pEx = addExcerpt(db, pItem, '论文原文');
  db.dbRun("INSERT INTO theme_links (theme_id,content_type,content_id) VALUES (?,'excerpt',?)", [t, cEx]);
  db.dbRun("INSERT INTO theme_links (theme_id,content_type,content_id) VALUES (?,'excerpt',?)", [t, pEx]);
  const res = await (await fetch(base + '/api/themes/' + t + '/relations')).json();
  assert.strictEqual(res.total, 2, '同一主题可挂不同栏目的对象');
  const routes = res.rows.map((r) => r.route);
  assert.ok(routes.some((r) => r.includes('/sources/classics/' + cItem)), '应含古籍：' + routes.join(' | '));
  assert.ok(routes.some((r) => r.includes('/library/papers/' + pItem)), '应含论文：' + routes.join(' | '));
}));

test('relations：limit 生效，且 total 仍是全量', () => withServer(async ({ db, base }) => {
  const t = addTheme(db, '多对象');
  for (let i = 0; i < 5; i++) {
    const n = addNote(db, '札记' + i);
    db.dbRun("INSERT INTO theme_links (theme_id,content_type,content_id) VALUES (?,'note',?)", [t, n]);
  }
  const res = await (await fetch(base + '/api/themes/' + t + '/relations?limit=2')).json();
  assert.strictEqual(res.rows.length, 2, '应只返回 2 条');
  assert.strictEqual(res.total, 5, 'total 仍应为全量，供「共 N 条」提示');
}));

test('relations：对象已删除时静默跳过，不报错', () => withServer(async ({ db, base }) => {
  const t = addTheme(db, '有悬空关联');
  const n = addNote(db, '会被删掉的札记');
  db.dbRun("INSERT INTO theme_links (theme_id,content_type,content_id) VALUES (?,'note',?)", [t, n]);
  db.dbRun('DELETE FROM notes WHERE id=?', [n]);
  const res = await fetch(base + '/api/themes/' + t + '/relations');
  assert.strictEqual(res.status, 200, '不应 500');
  const body = await res.json();
  assert.strictEqual(body.total, 0, '悬空关联应被跳过');
}));

test('relations：史学论文也能挂主题（V4 新增类型）', () => withServer(async ({ db, base }) => {
  const t = addTheme(db, '论文主题');
  // 史学论文正文存在 writing_documents（kind='historyPaper'），本测试只关心关联与链接
  const pid = Number(db.dbRun(
    "INSERT INTO history_papers (title,project,status,created_at,updated_at) VALUES (?,?,?,?,?)",
    ['一篇论文', '', '拟写', db.now(), db.now()]
  ).lastInsertRowid);
  db.dbRun("INSERT INTO theme_links (theme_id,content_type,content_id) VALUES (?,'historyPaper',?)", [t, pid]);
  const res = await (await fetch(base + '/api/themes/' + t + '/relations')).json();
  assert.strictEqual(res.total, 1);
  assert.strictEqual(res.rows[0].type, 'historyPaper');
  assert.strictEqual(res.rows[0].title, '一篇论文');
  assert.strictEqual(res.rows[0].route, '/writing/history-papers/' + pid);
}));

test('relations：id=0 或非法时返回空而非报错', () => withServer(async ({ base }) => {
  const r0 = await (await fetch(base + '/api/themes/0/relations')).json();
  assert.deepStrictEqual(r0.rows, []);
}));

/* ---------- 计数接口 ---------- */
test('counts：父级累计后代计数（一次查完，避免前端 N+1）', () => withServer(async ({ db, base }) => {
  const p = addTheme(db, '父主题');
  const c = addTheme(db, '子主题', p);
  const g = addTheme(db, '孙主题', c);
  const n1 = addNote(db, 'n1');
  const n2 = addNote(db, 'n2');
  db.dbRun("INSERT INTO theme_links (theme_id,content_type,content_id) VALUES (?,'note',?)", [p, n1]);
  db.dbRun("INSERT INTO theme_links (theme_id,content_type,content_id) VALUES (?,'note',?)", [g, n2]);

  const rows = await (await fetch(base + '/api/themes/counts')).json();
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.strictEqual(byId.get(g).total, 1, '孙主题直接挂 1 条');
  assert.strictEqual(byId.get(c).total, 1, '子主题应累计孙的 1 条');
  assert.strictEqual(byId.get(p).total, 2, '父主题应累计自己 1 + 后代 1');
}));

test('counts：脏数据成环时不栈溢出', () => withServer(async ({ db, base }) => {
  const a = addTheme(db, 'A');
  const b = addTheme(db, 'B', a);
  // 人为造环：B 的父改成 A，A 的父改成 B
  db.dbRun('UPDATE themes SET parent_id=? WHERE id=?', [b, a]);
  const res = await fetch(base + '/api/themes/counts');
  assert.strictEqual(res.status, 200, '成环不应导致 500');
}));

/* ---------- 层级上限 ---------- */
test('主题层级上限 4 级：第 5 级被拒', () => withServer(async ({ db, base }) => {
  const l1 = addTheme(db, '一级');
  const l2 = addTheme(db, '二级', l1);
  const l3 = addTheme(db, '三级', l2);
  const l4 = addTheme(db, '四级', l3);
  // 四级之下再建应被拒
  const res = await fetch(base + '/api/themes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '五级', parent_id: l4 })
  });
  assert.strictEqual(res.status, 400, '第 5 级应被拒');
  const body = await res.json();
  assert.ok(/4 级/.test(body.error), '错误应说明层级上限，实际：' + body.error);
  // 三级之下建四级是允许的
  const ok = await fetch(base + '/api/themes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '四级之二', parent_id: l3 })
  });
  assert.strictEqual(ok.status, 200);
}));

test('主题：不能移入自身或下级（原有约束未被层级校验破坏）', () => withServer(async ({ db, base }) => {
  const p = addTheme(db, '父');
  const c = addTheme(db, '子', p);
  const res = await fetch(base + '/api/themes/' + p, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent_id: c })
  });
  assert.strictEqual(res.status, 400);
}));

/* ---------- 前端装配 ---------- */
test('左栏含主题树容器与两个操作按钮（非空按键）', () => withServer(async ({ base }) => {
  const html = await (await fetch(base + '/library/papers')).text();
  assert.ok(html.includes('class="theme-tree"'), '应有主题树容器');
  assert.ok(html.includes('data-theme-action="new"'), '应有「＋ 主题」');
  assert.ok(html.includes('data-theme-action="manage"'), '应有「管理」');
  assert.ok(html.includes('theme-tree-body'), '应有内容容器');
  assert.ok(html.includes('/static/js/theme-tree.js'), '应加载主题树脚本');
}));

test('主题树脚本的每个按钮都接了真实行为（无空按键）', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/theme-tree.js'), 'utf8');
  assert.ok(js.includes("data-theme-action=\"new\""), '新建按钮应有处理');
  assert.ok(js.includes("data-theme-action=\"manage\""), '管理按钮应有处理');
  assert.ok(js.includes("openClassifyManager('theme')"), '管理应打开主题管理面板');
  assert.ok(js.includes('createTheme'), '新建应调用创建');
  assert.ok(js.includes('/api/themes/\' + id + \'/relations'), '展开应拉取关联');
  assert.ok(js.includes('a.remove({ scope: \'theme\''), '右键删除应走统一删除（含 confirm）');
});

test('主题树折叠 key 与分类树隔离（不串状态）', () => {
  const tree = fs.readFileSync(path.join(ROOT, 'public/js/theme-tree.js'), 'utf8');
  const coll = fs.readFileSync(path.join(ROOT, 'public/js/collection-tree.js'), 'utf8');
  assert.ok(tree.includes('collapsed-theme-'), '主题树用独立 key');
  assert.ok(coll.includes('collapsed-collections'), '分类树 key 不变');
  assert.ok(!tree.includes("'collapsed-collections'"), '主题树不得读写分类树的 key');
});

test('主题树：展开时才拉关联，不预加载全树', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/theme-tree.js'), 'utf8');
  const initIdx = js.indexOf('Promise.all([api(\'/api/themes\')');
  assert.ok(initIdx > 0, '首屏只应拉主题与计数');
  const relIdx = js.indexOf('async function loadRelations');
  assert.ok(relIdx > 0 && relIdx < initIdx, 'loadRelations 应独立于首屏初始化');
  // 首次加载只请求 /api/themes 与 /api/themes/counts，不请求 relations
  const initBlock = js.slice(initIdx, initIdx + 400);
  assert.ok(!initBlock.includes('/relations'), '首屏不应请求 relations');
  assert.ok(js.includes("holder.dataset.loaded"), '已加载的节点应记标记，不重复请求');
});

test('主题树：4 级上限在前端也拦一道（菜单置灰）', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/theme-tree.js'), 'utf8');
  assert.ok(js.includes('MAX_DEPTH = 4'), '前端应有层级常量');
  assert.ok(js.includes('depth + 1 >= MAX_DEPTH'), '应据此禁用新建子主题');
  assert.ok(js.includes('disabled'), '菜单项应支持禁用态');
});

test('主题树样式为绿色系（与分类的褐系区分）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8');
  assert.ok(css.includes('.theme-tree'), '应有主题树样式');
  assert.ok(css.includes('--moss'), '应复用苔绿变量');
  assert.ok(/\.theme-rel-type[\s\S]{0,200}--moss/.test(css), '关联对象类型标签应为主题色');
});

test('主题树：0 条主题时给出引导而非空白', () => withServer(async ({ base }) => {
  const html = await (await fetch(base + '/library/papers')).text();
  assert.ok(html.includes('theme-tree-body'), '容器应存在（内容由脚本填）');
  const js = fs.readFileSync(path.join(ROOT, 'public/js/theme-tree.js'), 'utf8');
  assert.ok(js.includes('还没有主题'), '应有空状态引导文案');
  assert.ok(js.includes('＋ 主题') || js.includes('新建顶级主题'), '空状态应指向新建入口');
}));

test('loadTree(theme) 把扁平结果拼成嵌套（两条路径对上层一致）', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/classify-actions.js'), 'utf8');
  assert.ok(js.includes('function nestFlat'), '应有扁平转嵌套');
  assert.ok(js.includes("if (scope !== 'theme') return rows;"), '只对 theme 做转换');
  const src = js.slice(js.indexOf('async function loadTree'), js.indexOf('function nestFlat'));
  assert.ok(src.includes('nestFlat(rows)'), 'loadTree 应调用 nestFlat');
});

/* ---------- 首页主题总览（阶段 5） ---------- */
test('首页：主题总览区块存在，0 条时给引导文案', () => withServer(async ({ base }) => {
  const html = await (await fetch(base + '/')).text();
  assert.ok(html.includes('主题总览'), '应有主题总览区块');
  assert.ok(html.includes('还没有主题'), '0 条时应给引导');
  assert.ok(html.includes('跨栏目的关注点'), '引导应说明主题与分类的关系');
  const open = (html.match(/<div\b/g) || []).length;
  assert.strictEqual((html.match(/<\/div>/g) || []).length, open, '首页 div 必须平衡');
}));

test('首页：有主题时列出名称与关联数，链接可跳到主题页', () => withServer(async ({ db, base }) => {
  const t = addTheme(db, '宋代财政');
  const t2 = addTheme(db, '制度史');
  const item = addItem(db, 'classics', '《梦溪笔谈》');
  const ex = addExcerpt(db, item, '财政史料');
  const n = addNote(db, '财政札记');
  db.dbRun("INSERT INTO theme_links (theme_id,content_type,content_id) VALUES (?,'excerpt',?)", [t, ex]);
  db.dbRun("INSERT INTO theme_links (theme_id,content_type,content_id) VALUES (?,'note',?)", [t, n]);
  const html = await (await fetch(base + '/')).text();
  assert.ok(html.includes('主题总览'), '应有区块');
  assert.ok(html.includes('2 个主题'), '应显示主题总数');
  assert.ok(html.includes('累计关联 2 条'), '应显示累计关联数');
  assert.ok(html.includes('宋代财政'), '应列出主题名');
  assert.ok(html.includes('href="/themes?theme=' + t + '"'), '应链到主题页并带上 id');
  assert.ok(html.includes('制度史'), '无关联主题也应列出');
  const open = (html.match(/<div\b/g) || []).length;
  assert.strictEqual((html.match(/<\/div>/g) || []).length, open, 'div 仍应平衡');
}));

test('主题页 ?theme=N 能定位到该主题（首页入口闭环）', () => withServer(async ({ db, base }) => {
  const t = addTheme(db, '可定位主题');
  const html = await (await fetch(base + '/themes?theme=' + t)).text();
  assert.ok(html.includes('id="theme-tree"'), '主题页保留自己的左栏（V5 未下线该页）');
  assert.ok(html.includes('/static/js/themes.js'), '主题页脚本应加载');
  assert.ok(html.includes('主题分类'), '标题应为「主题分类」');
}));

test('首页样式：主题卡片为绿色系', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8');
  assert.ok(css.includes('.home-theme'), '应有主题卡片样式');
  assert.ok(css.includes('.ht-count'), '应有计数样式');
});
