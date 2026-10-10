const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/app');
const db = require('../server/db');

// 用临时数据目录启动一个真实服务，端口由系统分配，避免污染真实数据
async function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-'));
  db.initDb(dir);
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  const close = async () => {
    await new Promise((r) => server.close(r));
    db.closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { server, port, base, dir, close };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wb-data-'));
}

module.exports = { startApp, tmpDir };
