const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
async function start(dir) {
  const child = fork(path.join(__dirname, '../desktop/server.js'), [], {
    env: { ...process.env, WB_DATA_DIR: dir }, stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  });
  const ready = await Promise.race([
    once(child, 'message').then(([message]) => message),
    once(child, 'exit').then(([code]) => { throw new Error('Server exited: ' + code); })
  ]);
  assert.equal(ready.type, 'ready');
  return { child, ready, base: 'http://127.0.0.1:' + ready.port };
}
async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.send('stop');
  await exited;
}
test('桌面服务启动、复用、退出及重启后数据持久化', { timeout: 20000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-desktop-'));
  const children = [];
  t.after(async () => {
    for (const child of children) await stop(child);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const first = await start(dir); children.push(first.child);
  const created = await fetch(first.base + '/api/items', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'classics', title: '桌面持久化测试' })
  });
  assert.equal(created.ok, true);
  const item = await created.json();
  const second = await start(dir); children.push(second.child);
  assert.equal(second.ready.reused, true);
  assert.equal(second.ready.port, first.ready.port);
  await stop(second.child);
  assert.equal((await fetch(first.base + '/api/health')).ok, true);
  await stop(first.child);
  assert.equal(fs.existsSync(path.join(dir, '.lock')), false);
  const third = await start(dir); children.push(third.child);
  const stored = await (await fetch(third.base + '/api/items/' + item.id)).json();
  assert.equal(stored.title, '桌面持久化测试');
});
