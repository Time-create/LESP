const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 1) 本环境能否 spawn 子进程
try {
  const out = execFileSync(process.execPath, ['-e', 'console.log(41+1)'], { encoding: 'utf8' });
  console.log('spawn test ->', out.trim());
} catch (e) {
  console.log('spawn FAILED:', e.errno, e.code);
}

// 2) 用正式 dist 里的 EXE 做一份副本，走 build.js 完全相同的图标写入流程
const { rcedit } = require('rcedit');
(async () => {
  const srcExe = path.join(__dirname, '..', 'dist', 'workbench', 'ShiliaoWorkbench.exe');
  if (!fs.existsSync(srcExe)) return console.log('no dist exe, skip');
  const tmp = path.join(os.tmpdir(), 'workbench-icon-verify.exe');
  fs.copyFileSync(srcExe, tmp);
  const before = fs.statSync(tmp).size;
  await rcedit(tmp, { icon: path.join(__dirname, '..', 'assets', 'icon', 'app.ico') });
  console.log('rcedit applied:', before, '->', fs.statSync(tmp).size);
  console.log('tmp exe for verification:', tmp);
})();
