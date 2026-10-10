// 史学论文接入 writing.js 的验证
// 重点：新 kind 能读写，且长编/札记/灵感**不回归**
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-hpw-'));
const paths = require('../server/lib/paths');
paths.setDataDir(tmp);
const db = require('../server/db');
db.initDb(tmp);
const writing = require('../server/services/writing');
const { textDoc } = require('../shared/document-schema');

const newPaper = (title = '一篇史学论文') => {
  const id = Number(db.dbRun(
    'INSERT INTO history_papers (title, project, status, created_at, updated_at) VALUES (?,?,?,?,?)',
    [title, '', '拟写', db.now(), db.now()]
  ).lastInsertRowid);
  return id;
};
const newCompilation = (title = '一部长编') => {
  const id = Number(db.dbRun(
    'INSERT INTO compilations (title, status, created_at, updated_at) VALUES (?,?,?,?)',
    [title, '进行中', db.now(), db.now()]
  ).lastInsertRowid);
  return id;
};
const newNote = (title = '一则札记', body = '札记正文') => {
  const id = Number(db.dbRun('INSERT INTO notes (title, body, created_at, updated_at) VALUES (?,?,?,?)', [title, body, db.now(), db.now()]).lastInsertRowid);
  return id;
};

test('史学论文：可读取，且不因缺少 links 表而报错', () => {
  const id = newPaper();
  const got = writing.get('historyPaper', id);
  assert.strictEqual(got.kind, 'historyPaper');
  assert.strictEqual(got.title, '一篇史学论文');
  assert.strictEqual(got.status, '拟写');
  assert.ok(got.content, '应返回内容文档');
  assert.ok(Array.isArray(got.citations));
  // 关键：get() 不得去查 note_links / idea_links
  assert.strictEqual(got.links, undefined, '史学论文没有 links 概念，不应返回该字段');
});

test('史学论文：可保存正文，状态四种合法', () => {
  const id = newPaper();
  const first = writing.get('historyPaper', id);
  for (const status of ['拟写', '写作中', '已完稿', '已发表']) {
    const res = writing.save('historyPaper', id, {
      epoch: first.epoch, clientMutationId: 'm-' + status, baseRevision: first.revision,
      content: textDoc('正文：' + status), citations: [], status
    });
    assert.strictEqual(res.ok, true, '状态 ' + status + ' 应可保存');
    const got = writing.get('historyPaper', id);
    assert.strictEqual(got.status, status);
    assert.strictEqual(got.revision, first.revision + 1);
    first.revision = got.revision;
  }
});

test('史学论文：非法状态被拒绝', () => {
  const id = newPaper();
  const cur = writing.get('historyPaper', id);
  assert.throws(() => writing.save('historyPaper', id, {
    epoch: cur.epoch, clientMutationId: 'bad', baseRevision: cur.revision,
    content: textDoc('x'), citations: [], status: '进行中'   // 长编的状态，史学论文不认
  }), /状态无效/, '应拒绝长编的状态值');
});

test('史学论文：脚注格式与长编一致（footer/inline）', () => {
  const id = newPaper();
  let cur = writing.get('historyPaper', id);
  writing.save('historyPaper', id, {
    epoch: cur.epoch, clientMutationId: 'fn1', baseRevision: cur.revision,
    content: textDoc('x'), citations: [], footnote_style: 'inline'
  });
  const got = writing.get('historyPaper', id);
  assert.strictEqual(got.footnote_style, 'inline');
});

test('史学论文：不写 legacy blocks 表（不污染长编结构）', () => {
  const id = newPaper();
  const cur = writing.get('historyPaper', id);
  writing.save('historyPaper', id, {
    epoch: cur.epoch, clientMutationId: 'nb', baseRevision: cur.revision,
    content: textDoc('不该投影到 blocks'), citations: []
  });
  const blocks = db.dbGet('SELECT COUNT(*) c FROM compilation_blocks WHERE compilation_id=?', [id]).c;
  assert.strictEqual(blocks, 0, '史学论文不应写入 compilation_blocks');
});

test('回归：长编读写正常（状态校验仍是三种）', () => {
  const id = newCompilation();
  const cur = writing.get('compilation', id);
  assert.strictEqual(cur.kind, 'compilation');
  writing.save('compilation', id, {
    epoch: cur.epoch, clientMutationId: 'c1', baseRevision: cur.revision,
    content: textDoc('长编正文'), citations: [], status: '搁置'
  });
  assert.strictEqual(writing.get('compilation', id).status, '搁置');
  const after = writing.get('compilation', id);
  assert.throws(() => writing.save('compilation', id, {
    epoch: after.epoch, clientMutationId: 'c2', baseRevision: after.revision,
    content: textDoc('x'), citations: [], status: '已发表'   // 史学论文的状态，长编不认
  }), /状态无效/, '长编不应接受史学论文的状态值');
});

test('回归：札记读写正常，且仍返回 links', () => {
  const id = newNote();
  const got = writing.get('note', id);
  assert.strictEqual(got.kind, 'note');
  assert.ok(Array.isArray(got.links), '札记仍应返回 links 数组');
  const res = writing.save('note', id, {
    epoch: got.epoch, clientMutationId: 'n1', baseRevision: got.revision,
    content: textDoc('新札记正文'), citations: []
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(db.dbGet('SELECT body FROM notes WHERE id=?', [id]).body, '新札记正文');
});

test('回归：未知 kind 仍被拒绝', () => {
  const id = newPaper();
  assert.throws(() => writing.get('nope', id), /写作类型无效/);
});

test.after(() => {
  try { db.closeDb && db.closeDb(); } catch (e) { /* 忽略 */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
});

// —— 路由层 CRUD（走真实 HTTP） ——
test('史学论文 API：增删改查全链路', async () => {
  const { createApp } = require('../server/app');
  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (method, url, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    // 新建
    const created = await call('POST', '/api/history-papers', { title: '宋代的漕运' });
    assert.strictEqual(created.status, 200, '新建应成功');
    assert.strictEqual(created.body.status, '拟写', '默认状态为拟写');
    const id = created.body.id;

    // 读取
    const got = await call('GET', '/api/history-papers/' + id);
    assert.strictEqual(got.status, 200);
    assert.strictEqual(got.body.title, '宋代的漕运');

    // 列表
    const list = await call('GET', '/api/history-papers');
    assert.ok(Array.isArray(list.body) && list.body.some((x) => x.id === id), '列表应包含新建的论文');

    // 修改状态（四种合法）
    for (const status of ['写作中', '已完稿', '已发表']) {
      const r = await call('PUT', '/api/history-papers/' + id, { status });
      assert.strictEqual(r.status, 200, '状态 ' + status + ' 应可保存');
      assert.strictEqual(r.body.status, status);
    }
    // 非法状态
    const bad = await call('PUT', '/api/history-papers/' + id, { status: '进行中' });
    assert.strictEqual(bad.status, 400, '长编的状态值应被拒绝');

    // 删除
    const del = await call('DELETE', '/api/history-papers/' + id);
    assert.strictEqual(del.status, 200);
    const after = await call('GET', '/api/history-papers/' + id);
    assert.strictEqual(after.status, 404, '删除后应查不到');

    // 标题必填
    const noTitle = await call('POST', '/api/history-papers', { title: '  ' });
    assert.strictEqual(noTitle.status, 400, '空标题应被拒绝');
  } finally { srv.close(); }
});

test('史学论文：删除时连带清理文档与主题关联（触发器）', async () => {
  const { createApp } = require('../server/app');
  const writingSvc = require('../server/services/writing');
  const { textDoc } = require('../shared/document-schema');
  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const created = await (await fetch(base + '/api/history-papers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '将被删除的论文' })
    })).json();
    const id = created.id;
    // 先产生文档与主题关联
    const cur = writingSvc.get('historyPaper', id);
    writingSvc.save('historyPaper', id, {
      epoch: cur.epoch, clientMutationId: 'del-1', baseRevision: cur.revision,
      content: textDoc('将被删除的正文'), citations: []
    });
    // 先建一个真实主题再关联（setThemes 会校验主题存在）
    const themeId = Number(db.dbRun('INSERT INTO themes (name, sort) VALUES (?,?)', ['测试主题', 0]).lastInsertRowid);
    require('../server/services/taxonomy').setThemes('historyPaper', id, [themeId]);
    assert.ok(db.dbGet("SELECT id FROM writing_documents WHERE kind='historyPaper' AND entity_id=?", [id]), '删除前应有文档');

    await fetch(base + '/api/history-papers/' + id, { method: 'DELETE' });

    assert.strictEqual(db.dbGet("SELECT COUNT(*) c FROM writing_documents WHERE kind='historyPaper' AND entity_id=?", [id]).c, 0, '文档应被触发器清理');
    assert.strictEqual(db.dbGet("SELECT COUNT(*) c FROM theme_links WHERE content_type='historyPaper' AND content_id=?", [id]).c, 0, '主题关联应被清理');
  } finally { srv.close(); }
});

test('回归：长编 API 不受影响', async () => {
  const { createApp } = require('../server/app');
  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const created = await (await fetch(base + '/api/compilations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '长编回归检查' })
    })).json();
    assert.ok(created.id, '长编仍可新建');
    const got = await (await fetch(base + '/api/compilations/' + created.id)).json();
    assert.strictEqual(got.title, '长编回归检查');
    const list = await (await fetch(base + '/api/compilations')).json();
    assert.ok(Array.isArray(list) && list.some((x) => x.id === created.id));
  } finally { srv.close(); }
});

// —— 页面渲染 ——
test('史学论文页面：列表页与编辑页结构正确，且不含分类树', async () => {
  const { createApp } = require('../server/app');
  const id = newPaper('页面渲染用论文');
  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const list = await (await fetch(base + '/writing/history-papers')).text();
    assert.ok(list.includes('btn-new-paper'), '列表页应有新建按钮');
    assert.ok(list.includes('页面渲染用论文'), '列表页应列出该论文');
    assert.ok(!list.includes('col-tree'), '按需求史学论文不设分类树');
    // V5.1：侧栏已移除，栏目集中在顶栏
    assert.ok(list.includes('class="topbar"'), '顶栏应完整');
    assert.ok(list.includes('topbar-menu'), '顶栏应含栏目下拉');

    const ed = await (await fetch(base + '/writing/history-papers/' + id)).text();
    assert.ok(ed.includes('wb-editor'), '编辑页应含编辑器');
    assert.ok(ed.includes('"kind":"historyPaper"'), '编辑页应传正确的 kind');
    for (const s of ['拟写', '写作中', '已完稿', '已发表']) {
      assert.ok(ed.includes(s), '状态选项应包含「' + s + '」');
    }
    assert.ok(ed.includes('writing-style-label'), '应保留注释格式设置（等同长编）');
    assert.ok(ed.includes('export-markdown'), '应保留导出 Markdown（等同长编）');
    assert.ok(ed.includes('writing-themes'), '应保留主题选择（等同长编）');

    // 标签平衡（历史教训：删 HTML 片段留下多余闭合标签会让整页塌陷）
    for (const [url, name] of [['/writing/history-papers', '列表页'], ['/writing/history-papers/' + id, '编辑页']]) {
      const html = await (await fetch(base + url)).text();
      const open = (html.match(/<div\b/g) || []).length;
      const close = (html.match(/<\/div>/g) || []).length;
      assert.strictEqual(close, open, name + ' 的 div 应平衡');
    }
  } finally { srv.close(); }
});

test('史学论文页面：侧栏入口在「我的写作」末尾', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const nav = fs.readFileSync(path.join(__dirname, '..', 'server', 'views', 'layout.js'), 'utf8');
  const group = nav.slice(nav.indexOf("title: '我的写作'"), nav.indexOf("title: '系统'"));
  assert.ok(group.includes('史学论文'), '侧栏应出现史学论文');
  assert.ok(group.includes('/writing/history-papers'), '应指向正确路由');
  const order = ['史料长编', '读书札记', '选题灵感', '史学论文'].map((n) => group.indexOf(n));
  assert.ok(order.every((v) => v >= 0), '四个入口都应存在');
  assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order, '史学论文应排在最后（按需求追加）');
});

test('编辑器：状态选项与注释格式按 kind 配置驱动', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'editor', 'index.js'), 'utf8');
  assert.ok(src.includes('historyPaper'), '编辑器应认识 historyPaper');
  const fourStates = "historyPaper:['拟写','写作中','已完稿','已发表']";
  assert.ok(src.includes(fourStates), '史学论文的状态选项应为论文语境四态');
  // 长编与灵感的选项不能被改坏
  assert.ok(src.includes("compilation:['进行中','搁置','完成']"), '长编状态选项应保持不变');
  assert.ok(src.includes("idea:['念头','孵化中','可开题','已放弃']"), '灵感状态选项应保持不变');
  // 注释格式对史学论文也要可见
  assert.ok(/writing-style-label'\)\.hidden=!\(config\.kind==='compilation'\|\|config\.kind==='historyPaper'\)/.test(src),
    '史学论文也应显示注释格式');
});

// —— 导入导出（第12项决策：完全等同长编） ——
test('史学论文：导出 Markdown 可用（含正文与标题）', async () => {
  const { createApp } = require('../server/app');
  const writingSvc = require('../server/services/writing');
  const { textDoc } = require('../shared/document-schema');
  const id = newPaper('导出验证用论文');
  const cur = writingSvc.get('historyPaper', id);
  writingSvc.save('historyPaper', id, {
    epoch: cur.epoch, clientMutationId: 'exp-1', baseRevision: cur.revision,
    content: textDoc('# 第一节\n\n这是正文。'), citations: []
  });
  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const r = await fetch(base + '/api/history-papers/' + id + '/export');
    assert.strictEqual(r.status, 200);
    assert.ok((r.headers.get('content-disposition') || '').includes('history-paper'), '应以下载附件返回');
    const text = await r.text();
    assert.ok(text.includes('导出验证用论文'), '导出内容应含标题');
    assert.ok(text.includes('这是正文'), '导出内容应含正文');
  } finally { srv.close(); }
});

test('导入与导出：kind 白名单已含史学论文，且长编行为不变', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const imp = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'doc-import.js'), 'utf8');
  assert.ok(imp.includes("'historyPaper'"), '导入白名单应含史学论文');
  assert.ok(imp.includes("'compilation'") && imp.includes("'note'"), '长编与札记仍应保留');
  assert.ok(imp.includes('INSERT INTO history_papers'), '导入应能建史学论文记录');

  const exp = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'writing-export.js'), 'utf8');
  assert.ok(exp.includes("model.kind==='compilation'||model.kind==='historyPaper'"),
    '脚注格式判定应同时覆盖长编与史学论文');
});

test('导出服务：史学论文的 docx 可生成（脚注格式生效）', async () => {
  const writingSvc = require('../server/services/writing');
  const exportSvc = require('../server/services/writing-export');
  const { textDoc } = require('../shared/document-schema');
  const id = newPaper('docx 验证');
  const cur = writingSvc.get('historyPaper', id);
  const res = writingSvc.save('historyPaper', id, {
    epoch: cur.epoch, clientMutationId: 'dx-1', baseRevision: cur.revision,
    content: textDoc('正文段落。'), citations: [], footnote_style: 'inline'
  });
  const model = exportSvc.collect('historyPaper', id, res.revision);
  assert.strictEqual(model.kind, 'historyPaper');
  const buf = await exportSvc.docx(model, async () => null);
  assert.ok(Buffer.isBuffer(buf) && buf.length > 1000, '应生成 docx 二进制，实际 ' + (buf && buf.length));

  // 回归：长编的 docx 仍可生成
  const cid = newCompilation('长编 docx 验证');
  const ccur = writingSvc.get('compilation', cid);
  const cres = writingSvc.save('compilation', cid, {
    epoch: ccur.epoch, clientMutationId: 'cx-1', baseRevision: ccur.revision,
    content: textDoc('长编正文。'), citations: []
  });
  const cbuf = await exportSvc.docx(exportSvc.collect('compilation', cid, cres.revision), async () => null);
  assert.ok(Buffer.isBuffer(cbuf) && cbuf.length > 1000, '长编 docx 不应受影响');
});

// —— 删除按钮（问题2：曾拼出 /api/undefined/5 导致 404）——
test('编辑器删除按钮：四种写作类型的接口路径都正确', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'editor', 'index.js'), 'utf8');
  assert.ok(src.includes('DEL_INFO'), '删除信息应来自配置表');
  for (const [kind, label, rest] of [
    ['note', '札记', 'notes'], ['idea', '灵感', 'ideas'],
    ['compilation', '长编', 'compilations'], ['historyPaper', '史学论文', 'history-papers']
  ]) {
    assert.ok(src.includes(kind + ":{label:'" + label + "',rest:'" + rest + "'"),
      kind + ' 的删除配置应完整（标签 + 接口路径）');
  }
  // 关键：不得再出现 kind 未定义时拼 undefined 的写法
  assert.ok(!/const kind=\(\{note:'notes'/.test(src), '不应再有把映射结果命名为 kind 再拼路径的写法');
  assert.ok(src.includes('const del=DEL_INFO[config.kind]'), '应从配置表取删除信息');
});

test('史学论文：DELETE 接口可用（此前因路径 undefined 而 404）', async () => {
  const { createApp } = require('../server/app');
  const id = newPaper('待删除的史学论文');
  const srv = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const ok = await fetch(base + '/api/history-papers/' + id, { method: 'DELETE' });
    assert.strictEqual(ok.status, 200, '删除应成功');
    const after = await fetch(base + '/api/history-papers/' + id);
    assert.strictEqual(after.status, 404, '删除后应查不到');
    assert.strictEqual(db.dbGet('SELECT COUNT(*) c FROM history_papers WHERE id=?', [id]).c, 0, '数据应真的被删除');
    // 旧代码会打出 /api/undefined/:id —— 确认该路径确实不存在
    const bad = await fetch(base + '/api/undefined/' + id, { method: 'DELETE' });
    assert.strictEqual(bad.status, 404, '不应存在 undefined 路径（这正是原故障）');
  } finally { srv.close(); }
});
