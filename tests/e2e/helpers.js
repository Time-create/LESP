const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.join(__dirname, '../..');
async function launch(options = {}) {
  options.packaged=options.packaged||process.env.WB_PACKAGED==='1';
  const dir = options.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'wb-e2e-'));
  const env = { ...process.env, WB_DATA_DIR: path.join(dir, 'data'), WB_PROFILE_DIR: path.join(dir, 'profile'), WB_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: options.packaged ? path.join(root, 'dist/workbench/ShiliaoWorkbench.exe') : require('electron'),
    args: options.packaged ? [] : [root],
    env,
    timeout: 30000
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // V5.1：侧栏已移除，等待顶栏渲染完成即可（原为 .nav-item）
  await page.waitForSelector('.topbar');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => { w.webContents.setBackgroundThrottling(false); w.hide(); }));
  const base = new URL(page.url()).origin;
  const request = async (url, method = 'GET', body) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));
    return data;
  };
  return { app, page, dir, base, request, close: async () => { await app.close(); } };
}
module.exports = { launch, root };
