// 入口：初始化数据库、探测端口、启动服务、自动打开浏览器。
// 测试环境需设置 WB_NO_OPEN=1 以跳过打开浏览器。
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');

const db = require('./db');
const paths = require('./lib/paths');
const { createApp } = require('./app');

const DEFAULT_PORT = 8787;
const MAX_TRY = 3;

const lock = require('./lib/lock');

function lockFile() {
  return path.join(paths.getDataDir(), '.lock');
}

function acquireLock() {
  return lock.acquire(lockFile());
}

function lockFilePath() {
  return path.join(paths.getDataDir(), '.lock');
}

function releaseLock() {
  lock.release(lockFile());
}

function listenWithFallback(app, startPort) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let tries = 0;
    const attempt = () => {
      const server = app.listen(port, '127.0.0.1');
      server.once('listening', () => resolve({ server, port }));
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && tries < MAX_TRY) {
          tries += 1;
          port += 1;
          console.log(`端口 ${port - 1} 被占用，改用 ${port}`);
          attempt();
        } else {
          reject(err);
        }
      });
    };
    attempt();
  });
}

async function main() {
  db.initDb(paths.getDataDir());
  const custom = db.dbGet("SELECT value FROM settings WHERE key = 'data_dir'");
  if (custom && custom.value && path.resolve(custom.value) !== path.resolve(paths.getDataDir())) {
    db.initDb(custom.value);
  }

  const lockResult = await acquireLock();

  if (!lockResult.ok && lockResult.running) {
    // 确实已有实例：给出可操作提示，并帮用户打开那个已存在的页面，而不是干巴巴退出
    const info = lockResult.info || {};
    const url = 'http://localhost:' + (info.port || DEFAULT_PORT);
    console.log('==================================================');
    console.log('已有实例正在运行，本次不再重复启动。');
    console.log('  进程 PID ：' + (info.pid || '未知'));
    console.log('  启动时间 ：' + (info.startedAt || '未知'));
    console.log('  访问地址 ：' + url);
    console.log('已在浏览器中打开上述地址，可直接使用。');
    console.log('若确需重启：先关闭上一个运行窗口（或结束该 PID），再重新双击 start.bat。');
    console.log('==================================================');
    if (process.env.WB_NO_OPEN !== '1') {
      exec(`start ${url}`);
    }
    process.exit(0);
  }

  if (lockResult.stale) {
    console.log('发现上次未正常退出留下的锁记录（PID ' + ((lockResult.info || {}).pid || '未知') + '），已自动清理，继续启动。');
  }

  const app = createApp();
  const { port } = await listenWithFallback(app, DEFAULT_PORT);
  lock.setPort(lockFilePath(), port);

  console.log(`LESP·辑微 已启动： http://localhost:${port}`);
  console.log(`数据目录： ${paths.getDataDir()}`);

  if (process.env.WB_NO_OPEN !== '1') {
    exec(`start http://localhost:${port}`);
  }

  const shutdown = () => {
    releaseLock();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('启动失败：', e.message);
    process.exit(1);
  });
}

module.exports = { main, listenWithFallback };
