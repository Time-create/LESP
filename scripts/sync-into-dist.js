// 把源码同步进已打包的桌面版（不重新编译 Electron）。
//
// 背景：本机所有同步子进程（spawnSync/execFileSync/execSync，甚至 cmd.exe）都返回 EBUSY，
// 因此 desktop/build.js 跑不起来；但「同步代码」只需要复制文件，不涉及子进程。
//
// 做法：完全照抄 desktop/build.js:45 的目录清单（desktop / server / public / shared），
// 覆盖 dist/workbench/resources/app/ 下的同名目录。exe 本体（Electron 运行时）不动。
//
// 用法：node scripts/sync-into-dist.js [--dry]
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'dist', 'workbench', 'resources', 'app');
const DRY = process.argv.includes('--dry');

// 与 desktop/build.js 保持一致的目录清单
const FOLDERS = ['desktop', 'server', 'public', 'shared'];

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, entry.name);
    const b = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(a, b);
    else fs.copyFileSync(a, b);
  }
}

if (!fs.existsSync(path.join(root, 'dist', 'workbench', 'ShiliaoWorkbench.exe'))) {
  console.error('未找到 dist/workbench/ShiliaoWorkbench.exe，请先确认已打包过。');
  process.exit(1);
}

let files = 0;
const bytes = (dir) => {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? bytes(p) : fs.statSync(p).size;
  }
  return n;
};

for (const folder of FOLDERS) {
  const src = path.join(root, folder);
  const dst = path.join(appDir, folder);
  if (!fs.existsSync(src)) { console.log('跳过（源码不存在）:', folder); continue; }
  if (DRY) { console.log('[dry] 将同步', folder, '→', path.relative(root, dst)); continue; }
  copyTree(src, dst);
  files++;
  console.log('已同步', folder.padEnd(8), '→', path.relative(root, dst), '(' + (bytes(src) / 1048576).toFixed(1) + ' MB)');
}

if (DRY) { console.log('\n[dry] 未实际写入。去掉 --dry 执行。'); process.exit(0); }

// 同步后自检：V5 的关键产物必须出现在打包目录里
const checks = [
  ['V5 顶栏', 'server/views/layout.js', 'topbar-menu'],
  ['概览态收起按钮', 'server/views/page-item.js', 'crumb-collapse-float'],
  ['主题树前端', 'public/js/theme-tree.js', 'buildTree'],
  ['右栏详情', 'public/js/detail-panel.js', 'detail-collapsed'],
  ['录文树右键菜单', 'public/js/excerpt-tree.js', 'contextmenu'],
  ['主区占满(app-main)', 'public/css/app.css', '.app > .main'],
  ['品牌图标定义', 'public/css/app.css', 'brand-wordmark.svg'],
  ['主题计数接口', 'server/services/taxonomy.js', 'themeCounts']
];
console.log('\n=== 同步后自检 ===');
let bad = 0;
for (const [name, rel, needle] of checks) {
  const p = path.join(appDir, rel);
  const ok = fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes(needle);
  if (!ok) bad++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '  (' + rel + ')');
}
console.log(bad ? '\n有 ' + bad + ' 项未通过，请检查。' : '\n全部通过：打包目录已是 V5。');

// 反向检查：侧栏必须已彻底移除（防止改了 CSS 却忘了改 HTML 结构）
const appDirLayout = path.join(appDir, 'server/views/layout.js');
if (fs.existsSync(appDirLayout)) {
  const src = fs.readFileSync(appDirLayout, 'utf8');
  const leftovers = ['class="sidebar"', 'nav-item"', 'navHtml(', 'app-body', 'theme-nav'].filter((k) => src.includes(k));
  if (leftovers.length) {
    console.log('  WARN  layout.js 仍含侧栏残留：' + leftovers.join(', '));
  } else {
    console.log('  PASS  layout.js 已无侧栏残留（sidebar / nav-item / app-body）');
  }
}
const appCss = path.join(appDir, 'public/css/app.css');
if (fs.existsSync(appCss)) {
  const css = fs.readFileSync(appCss, 'utf8');
  const dead = ['.sidebar {', '.nav-item {', '.nav-group', '.app-body', '.theme-nav'].filter((k) => css.includes(k));
  console.log(dead.length
    ? '  WARN  app.css 仍含侧栏样式：' + dead.join(', ')
    : '  PASS  app.css 已无侧栏样式（.sidebar / .nav-item / .app-body / .theme-nav）');
}

console.log('提示：启动 dist\\workbench\\ShiliaoWorkbench.exe 即可看到改动。数据仍在 data\\，未受影响。');
process.exit(bad ? 1 : 0);
