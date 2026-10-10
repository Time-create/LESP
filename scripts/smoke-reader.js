// 阅读器端到端冒烟：真起服务，插入一个附件，请求阅读页与静态资源，记录任何报错
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-reader-smoke-'));
const paths = require('../server/lib/paths');
paths.setDataDir(tmp);
const db = require('../server/db');
db.initDb(tmp);

const store = require('../server/services/attachment-store');
const pdfPath = path.join(tmp, 'smoke.pdf');
fs.writeFileSync(pdfPath, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]));

const { createApp } = require('../server/app');
const srv = createApp().listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  const errs = [];
  try {
    const info = db.dbRun("INSERT INTO items (module,title,subtitle,status,fields,created_at,updated_at) VALUES ('book',?,?,?,?,?,?)",
      ['冒烟测试', '作者', '在读', '{}', db.now(), db.now()]);
    const st = store.store({ srcPath: pdfPath, originalName: '冒烟测试.pdf' });
    db.dbRun('INSERT INTO attachments (item_id,filename,rel_path,size,mime,created_at) VALUES (?,?,?,?,?,?)',
      [info.lastInsertRowid, '冒烟测试.pdf', st.rel, st.size, 'application/pdf', db.now()]);
    const attId = db.dbGet('SELECT id FROM attachments ORDER BY id DESC LIMIT 1').id;

    const page = await fetch(base + '/reader/' + attId);
    const html = await page.text();
    console.log('阅读页状态:', page.status, '| Cache-Control:', page.headers.get('cache-control'));
    const checks = [
      ['无应用侧栏（裸布局）', !html.includes('class="sidebar"')],
      ['含正文容器 reader-box', html.includes('reader-box')],
      ['含整页/适宽两个缩放选项', html.includes('value="fit">整页') && html.includes('value="fitw">适宽')],
      ['引用 reader.css', html.includes('/static/css/reader.css')],
      ['引用 reader.js 打包入口', html.includes('/static/dist/reader.js')],
    ];
    for (const [n, ok] of checks) { if (!ok) errs.push(n); console.log((ok ? '  [OK] ' : '  [FAIL] ') + n); }

    for (const [url, needle, label] of [
      ['/static/css/reader.css', 'minmax(0, 1fr)', 'reader.css 布局'],
      ['/static/dist/reader.js', 'MAX_PIXELS', 'reader.js 渲染策略']
    ]) {
      const r = await fetch(base + url);
      const t = await r.text();
      const ok = r.status === 200 && t.includes(needle);
      if (!ok) errs.push(label);
      console.log((ok ? '  [OK] ' : '  [FAIL] ') + label + '（HTTP ' + r.status + '）');
    }
  } catch (e) {
    errs.push('异常: ' + e.message);
    console.log('  [FAIL] 运行异常:', e.message);
  }
  console.log(errs.length ? '\n结论：' + errs.length + ' 项异常' : '\n结论：全部通过，零报错');
  srv.close();
  db.closeDb && db.closeDb();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  process.exit(errs.length ? 1 : 0);
});