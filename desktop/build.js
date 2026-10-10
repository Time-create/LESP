const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFile } = require('node:child_process');
// 本机上所有同步子进程（spawnSync / execFileSync / execSync，甚至 cmd.exe）都会返回 EBUSY，
// 属环境限制；异步 execFile 正常。因此所有子进程调用一律用异步 + Promise，
// 绝不用 Atomics.wait 阻塞主线程等回调（那会让回调永远无法触发）。
function runNodeAsync(exe, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, opts, (e, so, se) => {
      if (e) return reject(new Error('node 子进程失败：' + (String(se || '').trim() || e.message)));
      resolve(String(so || ''));
    });
  });
}
const root = path.join(__dirname, '..');
const finalOutput=path.join(root,'dist','workbench');
const output = path.join(root, 'dist', 'workbench-staging-'+Date.now());
function copyTree(src,dst){fs.mkdirSync(dst,{recursive:true});for(const entry of fs.readdirSync(src,{withFileTypes:true})){const a=path.join(src,entry.name),b=path.join(dst,entry.name);if(entry.isDirectory())copyTree(a,b);else fs.copyFileSync(a,b);}}
const appDir = path.join(output, 'resources', 'app');
// node 可执行文件的解析顺序：环境变量 → WorkBuddy 自带（任意版本，取最新）→ 系统 PATH。
// 之前写死 22.22.2-3，WorkBuddy 升级删掉旧版本目录后就 ENOENT 了。
function resolveNode() {
  const cand = [];
  if (process.env.WB_NODE) cand.push(process.env.WB_NODE);
  const versionsDir = path.join(process.env.USERPROFILE, '.workbuddy', 'binaries', 'node', 'versions');
  try {
    const dirs = fs.readdirSync(versionsDir)
      .filter((d) => d !== 'current')
      .sort()
      .reverse();
    for (const d of dirs) cand.push(path.join(versionsDir, d, 'node.exe'));
    cand.push(path.join(versionsDir, 'current', 'node.exe'));
  } catch (e) { /* 没有 WorkBuddy 自带 node 就用系统 PATH */ }
  cand.push('node.exe');
  return cand.find((p) => p === 'node.exe' || fs.existsSync(p));
}
async function main() {
const node = resolveNode();
if (!node) throw new Error('找不到可用的 node.exe；可用环境变量 WB_NODE 指定路径');
console.log('使用 node:', node);
await runNodeAsync(node, ['-e', "const D=require('better-sqlite3');const d=new D(':memory:');d.prepare('select 1').get();d.close()"], { cwd: root });
const electronExe = require('electron');
// ===== 应用图标配置 =====
// 本项目不使用 electron-builder，而是手工复制 Electron 分发目录并重命名 electron.exe，
// 因此不存在 build.icon 之类的打包配置项，必须调用 rcedit 改写 EXE 的资源表才能生效。
// 平台差异：Windows 必须用 .ico（多尺寸在一个文件里）；macOS 需要 .icns 并写入 .app/Contents/Resources；
// Linux 不用 EXE 资源，而是提供 PNG 并在 desktop 文件中声明 Icon=。本项目只打包 Windows。
const iconsDir = path.join(root, 'assets', 'icon');
const winIcon = path.join(iconsDir, 'app.ico');
if (process.platform === 'win32' && !fs.existsSync(winIcon)) throw new Error('构建缺失应用图标：' + winIcon);
fs.mkdirSync(output, { recursive: true });
copyTree(path.dirname(electronExe), output);
fs.copyFileSync(path.join(output, 'electron.exe'), path.join(output, 'ShiliaoWorkbench.exe'));
fs.unlinkSync(path.join(output, 'electron.exe'));
fs.mkdirSync(appDir, { recursive: true });
for (const folder of ['desktop', 'server', 'public','shared']) copyTree(path.join(root, folder), path.join(appDir, folder));
const pkg = require('../package.json');
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, main: pkg.main }));
fs.mkdirSync(path.join(appDir, 'runtime'), { recursive: true });
fs.copyFileSync(node, path.join(appDir, 'runtime', 'node.exe'));
const copied = new Set();
function copyDependency(name, parent) {
  const resolver = createRequire(path.join(parent, 'package.json'));
  const folder = resolver.resolve.paths('__dependency_lookup__').map(base => path.join(base, name))
    .find(candidate => fs.existsSync(path.join(candidate, 'package.json')));
  if (!folder) throw new Error('Missing dependency: ' + name);
  if (copied.has(folder)) return;
  copied.add(folder);
  const relative = path.relative(root, folder);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Dependency outside project: ' + name);
  copyTree(folder, path.join(appDir, relative));
  const dependency = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
  for (const child of Object.keys(dependency.dependencies || {})) copyDependency(child, folder);
}
for (const name of Object.keys(pkg.dependencies)) copyDependency(name, root);
// 图标随应用一起发布：主进程在运行时从这里读取它以设置窗口/任务栏图标
if (fs.existsSync(iconsDir)) {
  fs.mkdirSync(path.join(appDir, 'assets', 'icon'), { recursive: true });
  // 只带运行时需要的：Windows 用 app.ico，Linux 用 PNG；1024 母版体积大，不随包发布
  for (const file of fs.readdirSync(iconsDir)) {
    if (!/^app/i.test(file) || !/\.(ico|icns|png)$/i.test(file)) continue;
    if (file.includes('master')) continue;   // 1024 母版只用于设计，不随包发布
    fs.copyFileSync(path.join(iconsDir, file), path.join(appDir, 'assets', 'icon', file));
  }
}
fs.writeFileSync(path.join(output, '使用说明.txt'),
  '双击 ShiliaoWorkbench.exe 打开 LESP·辑微（史料文献工作台）。\r\n数据位于本目录上两级的 data 文件夹。\r\n迁移电脑时复制整个 APP开发 文件夹并保留目录结构。\r\n');
for(const required of ['shared/document-schema.js','public/dist/editor.js','public/dist/reader.js','public/dist/pdf/pdf.worker.mjs','desktop/preload.js','assets/icon/app.ico'])if(!fs.existsSync(path.join(appDir,required)))throw new Error('构建缺失：'+required);
// 打包后自检：确认随包带走的 runtime/node.exe 真能加载 better-sqlite3 与 document-schema。
await runNodeAsync(path.join(appDir,'runtime/node.exe'),['-e',"const d=new(require('better-sqlite3'))(':memory:');d.prepare('SELECT 1').get();d.close();require('./shared/document-schema')"],{cwd:appDir});
if (fs.existsSync(finalOutput)) fs.renameSync(finalOutput, path.join(root, 'dist', 'workbench-previous-' + Date.now()));
fs.renameSync(output, finalOutput);

// 把图标写进 EXE 的资源表（RT_ICON / RT_GROUP_ICON），这才是 Explorer 与任务栏读取图标的来源。
// Windows 之外没有 EXE 资源表：macOS 要把 app.icns 放进 ShiliaoWorkbench.app/Contents/Resources，
// Linux 则是在 desktop 文件里写 Icon=/path/app-256.png，两者此处均不适用，故跳过。
(async () => {
  const exe = path.join(finalOutput, 'ShiliaoWorkbench.exe');
  if (process.platform === 'win32') {
    const { rcedit } = createRequire(path.join(root, 'package.json'))('rcedit');
    await rcedit(exe, { icon: winIcon });
    console.log('Icon embedded into EXE: ' + winIcon);
  } else {
    console.log('Skip icon injection: 非 Windows 平台，需改用 .icns(macOS) 或 PNG + desktop entry(Linux)');
  }
  console.log('Built: ' + exe);
  })().catch(error => { console.error('图标写入失败：' + error.message); process.exit(1); });
}

main().catch(error => { console.error('构建失败：' + error.message); process.exit(1); });
