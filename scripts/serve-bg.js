// 在本机后台常驻启动服务，供调试与自动化验证使用。
//
// 为什么需要这个脚本（两条环境限制叠加会造成「假网络错误」）：
//
//1) 本工具环境设了 HTTP_PROXY / HTTPS_PROXY，本机请求也会被丢给代理
//    → 访问 127.0.0.1:8787 报 ECONNREFUSED / 502，看起来像断网，实则网络正常。
//    绕过：fetch(..., { proxy: '' })、curl --noproxy '*'。
//
// 2) **沙箱会在每次工具调用结束时杀掉该调用启动的所有子进程**
//    （含 detached:true）。所以本脚本在新的调用里start，
//    下一次调用 status 时进程已经没了。
//    → 正确用法：启动与验证必须放在**同一次工具调用**内；
//      或用工具自身的 run_in_background 通道拉起长驻服务。
//
// 用法：
//   node scripts/serve-bg.js start    启动（后台常驻，写 PID 到 data/.serve.pid）
//   node scripts/serve-bg.js stop     停止
//   node scripts/serve-bg.js status   查看状态
//   node scripts/serve-bg.js restart  重启
//
// 调试时若直接用 fetch 访问本机，请加 { proxy: '' } 绕过代理。
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const PID_FILE = path.join(ROOT, 'data', '.serve.pid');
const LOG_FILE = path.join(ROOT, 'data', 'logs', 'serve.log');
const PORT = Number(process.env.WB_PORT || 8787);

const ping = () => new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout: 1500 }, (res) => {
    res.resume(); resolve(res.statusCode === 200);
  });
  req.on('error', () => resolve(false));
  req.on('timeout', () => { req.destroy(); resolve(false); });
});

function readPid() {
  try { return Number(fs.readFileSync(PID_FILE, 'utf8').trim()); } catch (e) { return 0; }
}
function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

async function start() {
  if (await ping()) { console.log('服务已在运行（端口 ' + PORT + '），无需重复启动'); return; }
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const out = fs.openSync(LOG_FILE, 'a');
  // detached: true 让子进程脱离当前 shell，避免随调用结束而被杀掉
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT, detached: true, stdio: ['ignore', out, out],
    env: Object.assign({}, process.env, { WB_PORT: String(PORT) })
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await ping()) { console.log('服务已启动，PID=' + child.pid + '，端口 ' + PORT); return; }
  }
  console.error('启动超时，请看日志：' + LOG_FILE);
  process.exitCode = 1;
}

async function stop() {
  const pid = readPid();
  if (alive(pid)) {
    try { process.kill(pid); console.log('已停止服务，PID=' + pid); } catch (e) { console.log('停止失败：' + e.message); }
  } else console.log('服务未在运行');
  try { fs.unlinkSync(PID_FILE); } catch (e) { /* 忽略 */ }
  await new Promise((r) => setTimeout(r, 600));
}

(async () => {
  const cmd = process.argv[2] || 'status';
  if (cmd === 'start') return start();
  if (cmd === 'stop') return stop();
  if (cmd === 'restart') { await stop(); return start(); }
  const pid = readPid();
  console.log('端口 ' + PORT + '：' + ((await ping()) ? '可访问' : '不可访问') + '；PID 文件：' + (pid || '无'));
})();
