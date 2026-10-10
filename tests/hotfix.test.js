// 针对两个已报问题的回归测试：
//  问题一：双击启动被误判为「已有实例正在运行」
//  问题二：进入栏目后被强制新建条目且无法退出
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { startApp } = require('./helpers');

const ROOT = path.join(__dirname, '..');

async function withApp(fn) {
  const app = await startApp();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

async function post(app, url, body) {
  const res = await fetch(app.base + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  });
  return { status: res.status, data: await res.json() };
}

// ---------- 问题一：单实例判定 ----------

test('修复1 - 无锁文件时可正常取得锁', async () => {
  const lock = require('../server/lib/lock');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-fix1-'));
  const lockPath = path.join(dir, '.lock');
  const r = await lock.acquire(lockPath);
  assert.strictEqual(r.ok, true, '无残留时应直接取得锁');
  assert.strictEqual(r.stale, false);
  lock.release(lockPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('修复1 - 旧格式锁（裸 PID）不会导致永久无法启动', async () => {
  const lock = require('../server/lib/lock');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-fix2-'));
  const lockPath = path.join(dir, '.lock');
  // 复现用户现场：锁文件里只有一个 PID 文本，进程可能早已退出
  fs.writeFileSync(lockPath, String(process.pid + 9999));
  const r = await lock.acquire(lockPath);
  assert.strictEqual(r.ok, true, '旧格式锁应被视为残留并接管，而不是拒绝启动');
  assert.strictEqual(r.stale, true);
  lock.release(lockPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('修复1 - 崩溃残留锁：PID 已死时应自动清理并启动', async () => {
  const lock = require('../server/lib/lock');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-fix3-'));
  const lockPath = path.join(dir, '.lock');
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 20000)'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  fs.writeFileSync(lockPath, JSON.stringify({ pid: child.pid, port: 0, startedAt: new Date().toISOString() }));
  child.kill();
  await new Promise((r) => setTimeout(r, 600));

  const r = await lock.acquire(lockPath);
  assert.strictEqual(r.ok, true, '崩溃残留的锁应被清理');
  assert.strictEqual(r.stale, true);
  lock.release(lockPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('修复1 - 确有实例时返回端口信息，供给出可操作提示', async () => {
  const lock = require('../server/lib/lock');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-fix4-'));
  const lockPath = path.join(dir, '.lock');
  const running = await startApp();
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid + 1, port: running.port, startedAt: '2026-09-26T12:00:00.000Z' }));
  const r = await lock.acquire(lockPath);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.running, true);
  assert.strictEqual(r.info.port, running.port, '必须带回端口，才能提示用户访问哪个地址');
  assert.ok(r.info.startedAt, '应带回启动时间');
  await running.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('修复1 - 启动脚本源码中包含可操作的已有实例提示', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
  assert.ok(src.includes('已有实例正在运行'), '应检测已有实例');
  assert.ok(src.includes('访问地址'), '应告诉用户访问地址');
  assert.ok(src.includes('start ${url}') || src.includes('已为你打开'), '应帮用户打开已有实例页面');
  assert.ok(src.includes('若确需重启'), '应给出如何重启的说明');
  assert.ok(src.includes('已自动清理'), '清理陈旧锁时应有提示');
});

test('修复1 - 端口被占用时仍能顺延启动（不被无关进程挡住）', async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const busy = blocker.address().port;
  const { listenWithFallback } = require('../server/index');
  const { createApp } = require('../server/app');
  const db = require('../server/db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-fix5-'));
  db.initDb(dir);
  const { server, port } = await listenWithFallback(createApp(), busy);
  assert.strictEqual(port, busy + 1, '应顺延到下一个可用端口');
  await new Promise((r) => server.close(r));
  await new Promise((r) => blocker.close(r));
  db.closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- 问题二：栏目页面交互 ----------

const MODULE_ROUTES = [
  ['古籍史料', '/sources/classics'],
  ['碑刻史料', '/sources/inscriptions'],
  ['文书史料', '/sources/documents'],
  ['档案史料', '/sources/archives'],
  ['研究论文', '/library/papers'],
  ['研究著作', '/library/books']
];

test('修复2 - 进入栏目默认不弹出新建弹窗（弹窗初始为 hidden）', async () => {
  await withApp(async (app) => {
    for (const [name, route] of MODULE_ROUTES) {
      const html = await (await fetch(app.base + route)).text();
      const m = html.match(/<div id="modal"[^>]*>/);
      assert.ok(m, route + ' 应存在弹窗容器');
      assert.ok(m[0].includes('hidden'), name + ' 页面进入时弹窗必须是隐藏的，实际：' + m[0]);
    }
  });
});

test('修复2 - CSS 中 hidden 能压过组件 display 声明', async () => {
  const raw = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, ''); // 先剥离注释，避免匹配到注释里的示例
  const m = css.match(/\[hidden\]\s*\{[^}]*\}/);
  assert.ok(m, '应存在 [hidden] 规则，否则 .modal{display:flex} 会让弹窗常驻');
  assert.ok(m[0].includes('display: none'), '应设为 display:none');
  assert.ok(m[0].includes('!important'), '必须用 !important 压过组件自身的 display 声明');
});

test('修复2 - 空模块给出空状态提示，新建只是可选操作', async () => {
  await withApp(async (app) => {
    const html = await (await fetch(app.base + '/sources/classics')).text();
    assert.ok(html.includes('还没有条目'), '空数据应给出空状态提示');
    assert.ok(html.includes('新建条目'), '应提供新建入口（但非强制）');
    assert.ok(!/<div id="modal"[^>]*class="modal"(?![^>]*hidden)/.test(html), '不得默认展开弹窗');
  });
});

test('修复2 - 有数据时展示条目列表而不是要求新建', async () => {
  await withApp(async (app) => {
    await post(app, '/api/items', { module: 'classics', title: '宋会要辑稿', fields: { dynasty: '清' } });
    await post(app, '/api/items', { module: 'classics', title: '文献通考', fields: { dynasty: '元' } });
    const html = await (await fetch(app.base + '/sources/classics')).text();
    assert.ok(html.includes('宋会要辑稿'), '列表应显示条目');
    assert.ok(html.includes('文献通考'), '列表应显示条目');
    assert.ok(html.includes('本模块条目'), '应展示模块统计');
    assert.ok(html.includes('最近更新'), '应展示最近更新');
  });
});

test('修复2 - 空分类下给出空状态提示而非空白', async () => {
  await withApp(async (app) => {
    const c = await post(app, '/api/collections', { module: 'classics', name: '宋代财政史' });
    const html = await (await fetch(app.base + '/sources/classics?collection=' + c.data.id)).text();
    assert.ok(html.includes('此分类下暂无条目'), '空分类应给出提示');
  });
});

test('修复2 - 每个栏目详情页都有返回列表与回首页入口', async () => {
  await withApp(async (app) => {
    for (const [name, route] of MODULE_ROUTES) {
      const fields = name === '文书史料' ? { doc_type: '契约' } : {};
      const item = await post(app, '/api/items', {
        module: route.includes('classics') ? 'classics'
          : route.includes('inscriptions') ? 'inscription'
          : route.includes('documents') ? 'document'
          : route.includes('archives') ? 'archive'
          : route.includes('papers') ? 'paper' : 'book',
        title: '测试条目', fields
      });
      const html = await (await fetch(app.base + route + '/' + item.data.id)).text();
      assert.ok(html.includes('class="crumb"'), name + ' 详情页应有面包屑导航');
      assert.ok(html.includes('返回' + name + '列表'), name + ' 应有返回列表入口');
      assert.ok(html.includes('首页总览'), name + ' 应有回首页入口');
    }
  });
});

test('修复2 - 弹窗提供多种关闭方式（按钮 / Esc / 点遮罩）', async () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/item.js'), 'utf8');
  assert.ok(js.includes("e.key === 'Escape'"), '应支持 Esc 关闭');
  assert.ok(js.includes('e.target === modal'), '应支持点击遮罩空白处关闭');
  assert.ok(js.includes("'modal-close'") && js.includes("'modal-cancel'"), '应有关闭与取消按钮');
  assert.ok(js.includes('closeModal'), '应有统一关闭函数');
});

// V5.1：侧栏已移除，栏目全部迁到顶栏。本测试的原意（弹窗不得遮挡导航）不变，
// 只是导航载体由 .nav-item 改为顶栏下拉项。
test('修复2 - 顶栏导航在所有栏目页可用（弹窗不遮挡导航）', async () => {
  await withApp(async (app) => {
    for (const [, route] of MODULE_ROUTES) {
      const html = await (await fetch(app.base + route)).text();
      assert.ok(html.includes('class="topbar"'), route + ' 应有顶栏');
      assert.ok(!html.includes('class="sidebar"'), route + ' 不应再有侧栏');
      for (const nav of ['首页总览', '古籍史料', '读书札记', '数据与设置']) {
        assert.ok(html.includes(nav), route + ' 应保留导航入口：' + nav);
      }
    }
  });
});

test('修复2 - 所有页面渲染均通过且前端脚本语法正确', async () => {
  const vm = require('node:vm');
  await withApp(async (app) => {
    for (const [, route] of MODULE_ROUTES) {
      const res = await fetch(app.base + route);
      assert.strictEqual(res.status, 200, route + ' 应正常渲染');
    }
  });
  const dir = path.join(ROOT, 'public/js');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f });
  }
});
