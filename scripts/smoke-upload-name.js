// 真实上传验证：起服务 → 用 FormData 上传中文名 PDF → 检查入库的显示名是否为正常中文
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-upload-'));
const paths = require('../server/lib/paths');
paths.setDataDir(tmp);
const db = require('../server/db');
db.initDb(tmp);

const { createApp } = require('../server/app');
const srv = createApp().listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  let bad = 0;
  try {
    const info = db.dbRun("INSERT INTO items (module,title,subtitle,status,fields,created_at,updated_at) VALUES ('book',?,?,?,?,?,?)",
      ['上传测试', '作者', '在读', '{}', db.now(), db.now()]);
    const itemId = info.lastInsertRowid;

    const fname = '日报时代台湾佛教结社与活动.pdf';
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4096, 0x20)]);
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), fname);
    const r = await fetch(base + '/api/attachments/upload?item_id=' + itemId, { method: 'POST', body: fd });
    const out = await r.json();
    console.log('上传接口:', r.status);

    const row = db.dbGet('SELECT * FROM attachments WHERE id = ?', [out.id]);
    const ok = row && row.filename === fname;
    if (!ok) bad++;
    console.log((ok ? '  [OK] ' : '  [FAIL] ') + '入库显示名 = ' + (row ? row.filename : '(无记录)'));
    const onDisk = fs.existsSync(path.join(tmp, row.rel_path));
    if (!onDisk) bad++;
    console.log((onDisk ? '  [OK] ' : '  [FAIL] ') + '文件已落盘: ' + row.rel_path);
    const list = await (await fetch(base + '/api/attachments?item_id=' + itemId)).json();
    const nameOk = list[0] && list[0].filename === fname;
    if (!nameOk) bad++;
    console.log((nameOk ? '  [OK] ' : '  [FAIL] ') + '附件列表返回名 = ' + (list[0] ? list[0].filename : '(空)'));
  } catch (e) {
    bad++;
    console.log('  [FAIL] 异常:', e.message);
  }
  console.log(bad ? '\n结论：' + bad + ' 项异常' : '\n结论：中文文件名全链路正常，零异常');
  srv.close();
  db.closeDb && db.closeDb();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  process.exit(bad ? 1 : 0);
});