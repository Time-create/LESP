const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { startApp } = require('./helpers');

const ROOT = path.join(__dirname, '..');

const ROUTES = [
  ['/', '首页总览'],
  ['/sources/classics', '古籍史料'],
  ['/sources/inscriptions', '碑刻史料'],
  ['/sources/documents', '文书史料'],
  ['/sources/archives', '档案史料'],
  ['/library/papers', '研究论文'],
  ['/library/books', '研究著作'],
  ['/writing/compilations', '史料长编'],
  ['/writing/notes', '读书札记'],
  ['/writing/ideas', '选题灵感'],
  ['/settings', '数据与设置']
];

test('Phase1 - 服务可启动且健康检查通过', async () => {
  const app = await startApp();
  const res = await fetch(app.base + '/api/health');
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.ok, true);
  assert.ok(data.engine, '应返回数据库引擎名');
  await app.close();
});

test('Phase1 - 11 个页面路由全部返回 200', async () => {
  const app = await startApp();
  for (const [route, name] of ROUTES) {
    const res = await fetch(app.base + route);
    assert.strictEqual(res.status, 200, route + ' 应返回 200');
    const html = await res.text();
    assert.ok(html.includes('LESP·辑微'), route + ' 应渲染品牌名');
    assert.ok(html.includes(name), route + ' 应包含页面名');
  }
  await app.close();
});

test('Phase1 - 页面包含完整导航（11 项分三组，顶栏下拉）', async () => {
  const app = await startApp();
  try {
    const html = await (await fetch(app.base + '/')).text();
    for (const [, name] of ROUTES) {
      assert.ok(html.includes(name), '导航缺少：' + name);
    }
    // V5.1：侧栏已移除，分组由顶栏下拉承载（data-menu 而非 data-group）
    assert.ok(!html.includes('class="sidebar"'), '不应再有侧栏');
    for (const g of ['资料库', '写作', '系统']) {
      assert.ok(html.includes('data-menu="' + g + '"'), '顶栏缺少分组：' + g);
    }
  } finally {
    // 断言失败也要关闭服务，否则后续测试全部挂死
    await app.close();
  }
});

test('Phase1 - 端口被占用时自动顺延', async () => {
  const { listenWithFallback } = require('../server/index');
  const { createApp } = require('../server/app');
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const busy = blocker.address().port;
  const { server, port } = await listenWithFallback(createApp(), busy);
  assert.strictEqual(port, busy + 1, '应顺延到下一端口');
  await new Promise((r) => server.close(r));
  await new Promise((r) => blocker.close(r));
});

test('Phase1 - 静态资源可访问', async () => {
  const app = await startApp();
  const css = await fetch(app.base + '/static/css/app.css');
  assert.strictEqual(css.status, 200);
  const text = await css.text();
  assert.ok(text.includes('--cinnabar'), 'CSS 应包含纸墨配色变量');
  const js = await fetch(app.base + '/static/js/common.js');
  assert.strictEqual(js.status, 200);
  await app.close();
});

test('Phase1 - start.bat 存在且为纯 ASCII', () => {
  const p = path.join(ROOT, 'start.bat');
  assert.ok(fs.existsSync(p), 'start.bat 应存在');
  const buf = fs.readFileSync(p);
  for (let i = 0; i < buf.length; i++) {
    assert.ok(buf[i] < 128, 'start.bat 含非 ASCII 字符（中文路径下会乱码）');
  }
  const content = buf.toString('ascii');
  assert.ok(content.includes('ShiliaoWorkbench.exe'), '应启动桌面工作台');
  assert.ok(content.includes('%~dp0'), '应使用 %~dp0 定位自身目录');
});

test('Phase1 - 单例锁：端口有真实实例时拒绝加锁，实例退出后可接管', async () => {
  const { acquire, release } = require('../server/lib/lock');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-lock-'));
  const lockPath = path.join(dir, '.lock');

  // 起一个真实服务，模拟"别的进程已占用锁且确实在跑"
  const running = await startApp();
  try {
    const otherPid = process.pid + 1; // 代表另一个进程的 pid
    fs.writeFileSync(lockPath, JSON.stringify({ pid: otherPid, port: running.port, startedAt: new Date().toISOString() }));

    const first = await acquire(lockPath);
    assert.strictEqual(first.ok, false, '实例在运行时不应取得锁');
    assert.strictEqual(first.running, true, '应标记为 running 并带回端口信息');
    assert.strictEqual(first.info.port, running.port, '应带回实例端口，供提示使用');
  } finally {
    // 断言失败也要关闭服务，否则会挂住后续测试
    await running.close();
  }

  const second = await acquire(lockPath);
  assert.strictEqual(second.ok, true, '实例退出后应可接管');
  assert.strictEqual(second.stale, true, '应标记为清理了陈旧锁');

  release(lockPath);
  assert.ok(!fs.existsSync(lockPath), 'release 后锁文件应被删除');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Phase1 - 单例锁：PID 被复用但端口无服务时不得误判为已有实例', async () => {
  const { acquire, release } = require('../server/lib/lock');
  const os = require('node:os');
  const { spawn } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-lock2-'));
  const lockPath = path.join(dir, '.lock');

  // 一个活着的进程（可能是被系统复用了 pid 的无关进程），但端口上没有我们的服务
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  // 取一个当前无人监听的端口：PID 虽存活，但端口上并没有我们的服务
  const net = require('node:net');
  const tmp = net.createServer();
  const freePort = await new Promise((r) => tmp.listen(0, '127.0.0.1', () => r(tmp.address().port)));
  await new Promise((r) => tmp.close(r)); // 未关闭的监听句柄会让测试进程无法退出

  fs.writeFileSync(lockPath, JSON.stringify({ pid: child.pid, port: freePort, startedAt: new Date().toISOString() }));

  const r = await acquire(lockPath);
  assert.strictEqual(r.ok, true, '端口无服务时应判定为陈旧锁并接管，而非误报已有实例');
  assert.strictEqual(r.stale, true);

  release(lockPath);
  child.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});
