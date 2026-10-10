// Runs under the bundled Node runtime, keeping SQLite's native ABI unchanged.
const path = require('node:path');
const db = require('../server/db');
const paths = require('../server/lib/paths');
const lock = require('../server/lib/lock');
const { createApp } = require('../server/app');
let server;
let syncServer;                      // 固定端口：专供浏览器扩展同步使用
let ownedLock;
let stopping = false;
// 主服务端口由系统随机分配（listen(0)），每次启动都不同，扩展无法记住；
// 因此额外开一个固定端口（默认 8791），只用于「扩展 ⇄ App」通信。
const SYNC_PORT_BASE = Number(process.env.WB_SYNC_PORT || 8791);
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const s of [server, syncServer]) {
    if (!s) continue;
    try {
      s.closeIdleConnections();
      await new Promise(resolve => s.close(resolve));
    } catch (e) { /* 关闭失败也要继续退出 */ }
  }
  db.closeDb();
  if (ownedLock) lock.release(ownedLock);
  process.exit(0);
}
process.on('message', message => { if (message === 'stop') stop(); });
process.on('disconnect', stop);
process.on('SIGTERM', stop);
async function main() {
  paths.setDataDir(process.env.WB_DATA_DIR);
  paths.ensureDirs();
  const lockPath = path.join(paths.getDataDir(), '.lock');
  const result = await lock.acquire(lockPath);
  if (!result.ok) {
    process.send({ type: 'ready', port: result.info.port, reused: true });
    return;
  }
  ownedLock = lockPath;
  db.initDb(paths.getDataDir());
  const custom = db.dbGet("SELECT value FROM settings WHERE key = 'data_dir'");
  if (custom && custom.value && path.resolve(custom.value) !== paths.getDataDir()) {
    const nextLock = path.join(custom.value, '.lock');
    require('node:fs').mkdirSync(custom.value, { recursive: true });
    const next = await lock.acquire(nextLock);
    if (!next.ok) {
      db.closeDb();
      lock.release(ownedLock);
      ownedLock = null;
      process.send({ type: 'ready', port: next.info.port, reused: true });
      return;
    }
    lock.release(ownedLock);
    ownedLock = nextLock;
    db.initDb(custom.value);
  }
  const app = createApp();
  server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.once('error', reject);
  });
  const port = server.address().port;
  lock.setPort(ownedLock, port);

  // 固定同步端口：被占用就顺延，并把实际端口写进设置，供设置页显示
  for (let p = SYNC_PORT_BASE; p < SYNC_PORT_BASE + 10; p += 1) {
    const ok = await new Promise((resolve) => {
      const s = app.listen(p, '127.0.0.1', () => { syncServer = s; resolve(true); });
      s.once('error', () => resolve(false));
    });
    if (ok) {
      try {
        db.dbRun('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          ['cnki_sync_port', String(p)]);
      } catch (e) { /* 设置表不可用时忽略，扩展仍可用默认端口 */ }
      break;
    }
  }
  require('../server/services/backup-v2').configure({startupFile:process.env.WB_START_CONFIG,lockSwitch:async target=>{const previous=ownedLock,next=path.join(target,'.lock'),acquired=await lock.acquire(next);if(!acquired.ok)throw new Error('目标目录正在被其他工作台使用');lock.setPort(next,port);ownedLock=next;lock.release(previous);return async()=>{lock.release(next);await lock.acquire(previous);lock.setPort(previous,port);ownedLock=previous;};}});
  process.send({ type: 'ready', port });
}
main().catch(error => {
  if (process.connected) process.send({ type: 'error', message: error.message });
  stop();
});
