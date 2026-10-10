// 单实例判定。
// 旧实现只判断「PID 是否存活」，会带来两类问题：
//   1) 进程崩溃后锁文件残留，PID 若被系统分配给别的进程，会被误判为「已有实例」；
//   2) 即使真有实例，也只干巴巴地退出，用户不知道该访问哪个地址。
// 新实现以「服务端口 /api/health 探测成功」为准：端口答得上来才算真有实例，
// 并把它监听的端口号一并带回，供调用方给出可操作提示。
const fs = require('node:fs');
const http = require('node:http');

function pidAlive(pid) {
  const n = Number(pid);
  if (!n || Number.isNaN(n)) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// 兼容旧格式（纯 PID 文本）与新格式（JSON）
function readLock(lockFile) {
  if (!fs.existsSync(lockFile)) return null;
  const raw = fs.readFileSync(lockFile, 'utf8').trim();
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object' && o.pid) {
      return { pid: Number(o.pid), port: Number(o.port) || 0, startedAt: o.startedAt || '', legacy: false };
    }
  } catch (e) { /* 落到旧格式解析 */ }
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    return { pid: n, port: 0, startedAt: '', legacy: true };
  }
  return null;
}

function writeLock(lockFile, info) {
  fs.writeFileSync(lockFile, JSON.stringify(info));
}

function setPort(lockFile, port) {
  const info = readLock(lockFile) || { pid: process.pid, startedAt: new Date().toISOString() };
  writeLock(lockFile, { pid: process.pid, port, startedAt: info.startedAt || new Date().toISOString() });
}

// 探测端口上是否真的是本机这个应用（/api/health 返回 ok:true）
function probe(port, timeout = 600) {
  return new Promise((resolve) => {
    if (!port) return resolve(false);
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          resolve(Boolean(j && j.ok));
        } catch (e) {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// 返回 {ok:true, stale} 表示取得锁；{ok:false, running:true, info} 表示已有实例在运行
async function acquire(lockFile, probeFn) {
  const doProbe = probeFn || probe;
  const info = readLock(lockFile);
  if (info) {
    if (info.pid === process.pid) {
      setPort(lockFile, info.port);
      return { ok: true, stale: false };
    }
    // 旧格式锁没有端口信息，无从确认，按残留处理，避免永久卡死
    if (info.legacy || !info.port) {
      const alive = pidAlive(info.pid);
      writeLock(lockFile, { pid: process.pid, port: 0, startedAt: new Date().toISOString() });
      return { ok: true, stale: true, info, reason: alive ? 'legacy-lock' : 'dead-process' };
    }
    const running = await doProbe(info.port);
    if (running) {
      return { ok: false, running: true, info };
    }
    // PID 可能还活着（被复用），但端口答不上来：视为上次崩溃留下的陈旧锁
    writeLock(lockFile, { pid: process.pid, port: 0, startedAt: new Date().toISOString() });
    return { ok: true, stale: true, info, reason: pidAlive(info.pid) ? 'pid-reused' : 'dead-process' };
  }
  writeLock(lockFile, { pid: process.pid, port: 0, startedAt: new Date().toISOString() });
  return { ok: true, stale: false };
}

function release(lockFile) {
  const info = readLock(lockFile);
  if (info && info.pid !== process.pid) return false; // 不删别人的锁
  try {
    fs.rmSync(lockFile, { force: true });
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { acquire, release, pidAlive, readLock, writeLock, setPort, probe };
