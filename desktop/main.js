const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const {prepare}=require('./lifecycle');
const root = path.join(__dirname, '..');
// 应用图标：开发与打包后相对关系一致（<包>/desktop/main.js → <包>/assets/icon/）
// Windows 用 .ico；macOS 需 .icns，Linux 需 PNG，缺文件则退化为 Electron 默认图标。
const appIcon = (() => {
  const candidates = process.platform === 'darwin'
    ? ['assets/icon/app.icns', 'assets/icon/app.ico']
    : process.platform === 'win32'
      ? ['assets/icon/app.ico']
      : ['assets/icon/app-256.png', 'assets/icon/app.ico'];
  for (const relative of candidates) {
    const file = path.join(root, relative);
    if (fs.existsSync(file)) return file;
  }
  return undefined;
})();
const smoke = process.argv.includes('--smoke-test');
app.setName('LESP·辑微');
if (process.env.WB_PROFILE_DIR) app.setPath('userData', process.env.WB_PROFILE_DIR);
let mainWindow, worker, origin, stopping = false;
let exitApproved=false,exitPending=false;
require('./exports').register(()=>origin);
ipcMain.handle('prepare-all',async event=>{if(!local(event.sender.getURL()))return false;for(const win of BrowserWindow.getAllWindows())if(!await prepare(win))return false;return true;});
// 渲染进程配置。
// sandbox:false —— Windows 下启用 Chromium 的受限令牌沙箱会**吞掉从资源管理器拖入的文件**
// （dragenter/dragover/drop 根本不派发到页面），表现为「PDF 拖进窗口完全没反应」。
// 这里关闭渲染进程的 OS 级沙箱以恢复文件拖放；nodeIntegration 仍为 false、
// contextIsolation 仍为 true，页面依然无法直接访问 Node API。
const preferences = { nodeIntegration: false, contextIsolation: true, sandbox: false, preload:path.join(__dirname,'preload.js') };
function local(url) {
  try { return new URL(url).origin === origin; } catch { return false; }
}
function secure(win) {
  let closing=false,busy=false;
  win.on('close',event=>{if(closing||exitApproved)return;event.preventDefault();if(win===mainWindow){app.quit();return;}if(busy)return;busy=true;prepare(win).then(ok=>{busy=false;if(ok){closing=true;win.close();}});});
  win.webContents.on('will-navigate', (event, url) => {
    if (!local(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (local(url)) {
      const reader = new BrowserWindow({ width: 1100, height: 820, parent: mainWindow, icon: appIcon, webPreferences: preferences });
      secure(reader);
      reader.loadURL(url);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-prevent-unload', async event => {
    const result = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['继续编辑', '离开页面'], defaultId: 0, cancelId: 0,
      message: '当前内容尚未保存，确定离开吗？'
    });
    if (result === 1) event.preventDefault();
  });
}
async function navigate(route) { if (mainWindow&&await prepare(mainWindow)) mainWindow.loadURL(origin + route); }
// V5.2：移除 Electron 应用菜单（顶部「工作台／编辑／视图」）。
// 栏目导航已由页面顶栏的三组下拉承担（唯一入口），这套菜单与之重复且冗余。
// 页面跳转改由各页自身与浏览器原生快捷键承担，此处不再需要 navigate()。
function setupShell() {
  // 传 null 即彻底移除菜单栏（含编辑/视图的默认项）。
  // 注意：不要用 buildFromTemplate 传空数组，那样仍会留下一条空菜单栏。
  Menu.setApplicationMenu(null);
  // 菜单移除后「返回/前进」失去入口，绑定到窗口级快捷键上补回，避免导航能力倒退。
  const wc = mainWindow && mainWindow.webContents;
  if (!wc) return;
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key === undefined) return;
    const alt = input.alt && !input.control && !input.meta && !input.shift;
    if (!alt) return;
    if (input.key === 'ArrowLeft') { event.preventDefault(); wc.navigationHistory.goBack(); }
    else if (input.key === 'ArrowRight') { event.preventDefault(); wc.navigationHistory.goForward(); }
  });
}
async function launch() {
  const bundled = path.join(root, 'runtime', 'node.exe');
  // 兜底解析：环境变量 → WorkBuddy 自带任意版本（取最新）→ 系统 PATH。
  // 不写死版本号，避免 WorkBuddy 升级删除旧版本目录后启动失败。
  function fallbackNode() {
    if (process.env.WB_NODE && fs.existsSync(process.env.WB_NODE)) return process.env.WB_NODE;
    try {
      const vd = path.join(process.env.USERPROFILE, '.workbuddy', 'binaries', 'node', 'versions');
      const dirs = fs.readdirSync(vd).filter((d) => d !== 'current').sort().reverse();
      for (const d of dirs) {
        const p = path.join(vd, d, 'node.exe');
        if (fs.existsSync(p)) return p;
      }
      const cur = path.join(vd, 'current', 'node.exe');
      if (fs.existsSync(cur)) return cur;
    } catch (e) { /* 忽略，交给系统 PATH */ }
    return 'node.exe';
  }
  const node = fs.existsSync(bundled) ? bundled : fallbackNode();
  let dataDir = path.join(root, 'data');
  if (app.isPackaged) dataDir = path.resolve(path.dirname(process.execPath), '../../data');
  if (process.env.WB_DATA_DIR) dataDir = path.resolve(process.env.WB_DATA_DIR);
  const startupFile=path.join(dataDir,'startup.json');
  if(fs.existsSync(startupFile)){const pointer=JSON.parse(fs.readFileSync(startupFile,'utf8'));if(!pointer.dataDir||!fs.existsSync(path.join(pointer.dataDir,'app.db')))throw new Error('迁移后的数据目录不可用，请恢复目录后重试');dataDir=path.resolve(pointer.dataDir);}
  worker = fork(path.join(__dirname, 'server.js'), [], {
    execPath: node, windowsHide: true,
    env: { ...process.env, WB_DATA_DIR: dataDir, WB_START_CONFIG:startupFile, WB_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let diagnostics = '';
  worker.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
  worker.stdout.resume();
  const info = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('本地服务启动超时。' + diagnostics)), 20000);
    const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value); };
    worker.once('error', error => finish(error));
    worker.once('exit', code => finish(new Error('本地服务已退出：' + code + '\n' + diagnostics)));
    worker.once('message', message => message.type === 'ready' ? finish(null, message) : finish(new Error(message.message)));
  });
  origin = 'http://127.0.0.1:' + info.port;
  worker.on('exit', () => {
    if (!stopping) { dialog.showErrorBox('工作台服务已停止', '请关闭并重新打开工作台。\n' + diagnostics); app.quit(); }
  });
  mainWindow = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1000, minHeight: 680,
    show: false, title: 'LESP·辑微', backgroundColor: '#f6f3ed', icon: appIcon, webPreferences: preferences
  });
  secure(mainWindow);
  // 本地应用禁用 HTTP 缓存：保证重新构建后界面与脚本立即是新的，
  // 否则 Chromium 可能继续用缓存里的旧 css/js，表现为「改了没变化、页面像是坏的」。
  try { mainWindow.webContents.session.setCacheSize(0); } catch (e) { /* 忽略 */ }
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  mainWindow.once('ready-to-show', () => { if (!smoke) mainWindow.show(); });
  setupShell();
  await mainWindow.loadURL(origin);
  if (smoke) {
    const result = await mainWindow.webContents.executeJavaScript(`(async () => ({
      title: document.title, navigation: document.querySelectorAll('.topbar-item').length,
      nodeExposed: typeof require !== 'undefined', health: await (await fetch('/api/health')).json(),
      pages: await Promise.all(Array.from(document.querySelectorAll('.topbar-item')).map(async link => ({
        name: link.textContent, status: (await fetch(link.href)).status
      })))
    }))()`);
    fs.writeFileSync(process.env.WB_SMOKE_RESULT, JSON.stringify(result, null, 2));
    const screenshot = await mainWindow.webContents.capturePage();
    fs.writeFileSync(path.join(path.dirname(process.env.WB_SMOKE_RESULT), 'desktop.png'), screenshot.toPNG());
    app.quit();
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });
  app.whenReady().then(launch).catch(error => {
    dialog.showErrorBox('工作台启动失败', error.message);
    app.quit();
  });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit',event=>{
 if(exitApproved||stopping)return;event.preventDefault();if(exitPending)return;exitPending=true;
 (async()=>{for(const win of BrowserWindow.getAllWindows()){if(!await prepare(win)){exitPending=false;return;}}exitApproved=true;exitPending=false;app.quit();})().catch(()=>{exitPending=false;});
});
app.on('will-quit', event => {
  if (stopping || !worker || !worker.connected) return;
  event.preventDefault();
  stopping = true;
  const timer = setTimeout(() => { worker.kill(); app.quit(); }, 5000);
  worker.once('exit', () => { clearTimeout(timer); app.quit(); });
  worker.send('stop');
});
