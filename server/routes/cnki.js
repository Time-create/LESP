const express = require('express');
const db = require('../db');
const cnki = require('../services/cnki');
const ingestService = require('../services/cnki-ingest');
const syncService = require('../services/cnki-sync');

const router = express.Router();

function setting(key) {
  const row = db.dbGet('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : '';
}
function putSetting(key, value) {
  db.dbRun('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

// 浏览器扩展走的是另一个来源（chrome-extension://），需要放开跨域。
// 安全边界：只允许**扩展自身**来源跨域，并回显具体 Origin；
// 普通网页拿不到 CORS 头，因此无法跨域读取本机接口（口令、Cookie、库内数据）。
const ALLOWED_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;
router.use((req, res, next) => {
  const origin = String(req.headers.origin || '');
  if (ALLOWED_ORIGIN_RE.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LESP-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function cookie() {
  const row = db.dbGet("SELECT value FROM settings WHERE key = 'cnki_cookie'");
  return row ? row.value : '';
}

// 去重键：统一走 cnki-export 的权威实现。
// 此前本文件另有一套算法（无 cnki:/t: 前缀），导致与扩展同步写入的 dedup_key 互不认识，
// 同一篇文献经两条链路会重复入库。
function dedupKey(title, authors, yearVolume) {
  const authorText = Array.isArray(authors) ? authors.join(',') : String(authors || '');
  return require('../services/cnki-export').dedupKey({
    link: '',
    title,
    authors: authorText ? [authorText] : [],
    year: yearVolume
  });
}

function existingKeys() {
  const rows = db.dbAll("SELECT title, fields FROM items WHERE module = 'paper'");
  const set = new Set();
  for (const r of rows) {
    let f = {};
    try { f = JSON.parse(r.fields || '{}'); } catch (e) { f = {}; }
    // 已有条目若已存 dedup_key（扩展同步写入）直接采用，保证两条链路互通
    if (f.dedup_key) { set.add(String(f.dedup_key)); continue; }
    set.add(dedupKey(r.title, f.author, f.year_volume));
  }
  return set;
}

router.get('/status', (req, res) => {
  const c = cookie();
  const updated = db.dbGet("SELECT value FROM settings WHERE key = 'cnki_cookie_updated_at'");
  res.json({
    hasCookie: Boolean(c),
    updatedAt: updated ? updated.value : '',
    onlyAbstract: true
  });
});

router.put('/cookie', (req, res) => {
  const c = String((req.body || {}).cookie || '').trim();
  if (!c) return res.status(400).json({ error: '登录态不能为空' });
  db.dbRun('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['cnki_cookie', c]);
  db.dbRun('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['cnki_cookie_updated_at', db.now()]);
  res.json({ ok: true });
});

router.delete('/cookie', (req, res) => {
  db.dbRun("DELETE FROM settings WHERE key IN ('cnki_cookie', 'cnki_cookie_updated_at')");
  res.json({ ok: true });
});

router.post('/search', async (req, res) => {
  const b = req.body || {};
  const keyword = String(b.keyword || '').trim();
  if (!keyword) return res.status(400).json({ error: '请输入关键词' });

  let items;
  try {
    items = await cnki.search({ cookie: cookie(), keyword, author: b.author, journal: b.journal });
  } catch (e) {
    const code = e.code || 'ERROR';
    const status = code === 'NO_COOKIE' ? 400 : 403;
    return res.status(status).json({ error: e.message, code });
  }

  const exist = existingKeys();
  const results = items.slice(0, cnki.MAX_RESULTS).map((it) => {
    const key = dedupKey(it.title, it.authors, it.year_volume);
    return Object.assign({}, it, { imported: exist.has(key), key });
  });
  res.json({ results, total: results.length });
});

// ---- 与浏览器扩展对接 ----

// 探活：扩展启动时先问一次，确认 App 在线、端口对不对
router.get('/sync/ping', (req, res) => {
  res.json({ ok: true, app: 'LESP·辑微', requireToken: Boolean(setting('cnki_sync_token')), time: db.now() });
});

// 给设置页用：扩展应连接的【固定同步端口】（不是主服务那个随机端口）与口令
router.get('/sync/info', (req, res) => {
  // 优先用桌面端写入的固定同步端口；没有就用默认 8791
  const fixed = setting('cnki_sync_port');
  res.json({ port: Number(fixed) || 8791, token: setting('cnki_sync_token') });
});

// 生成/查看同步口令（App 设置页用；扩展里填同一个值）
router.get('/sync/token', (req, res) => {
  res.json({ token: setting('cnki_sync_token') });
});

router.post('/sync/token/refresh', (req, res) => {
  const t = require('node:crypto').randomBytes(12).toString('hex');
  putSetting('cnki_sync_token', t);
  syncService.log('已重新生成同步口令');
  res.json({ token: t });
});

// 扩展送来的「元数据 + 全文」落库
router.post('/sync', (req, res) => {
  const expected = setting('cnki_sync_token');
  let out;
  try {
    out = syncService.sync({ db, payload: req.body, tokenExpected: expected });
  } catch (e) {
    syncService.log('同步异常：' + (e && e.stack || e), 'error');
    return res.status(500).json({ ok: false, error: '服务端异常：' + e.message });
  }
  if (!out.ok) return res.status(out.error && out.error.includes('口令') ? 401 : 400).json(out);
  res.json(out);
});

// 交接目录：扩展把浏览器下载的文件放这里，App 从这里导入
router.get('/sync/pickup-dir', (req, res) => {
  res.json({ dir: require('../services/attachment-pickup').settingDir(db) });
});

// 最近日志，便于排查“下载失败/没同步上”
router.get('/sync/log', (req, res) => {
  const lines = syncService.readLog(Number(req.query.lines) || 100);
  res.json({ lines });
});

// 全文任务列表（当前状态 / 失败原因）
router.get('/jobs', (req, res) => {
  const rows = db.dbAll('SELECT id, kind, dedup_key, item_id, status, attempts, last_error, updated_at FROM cnki_jobs ORDER BY id DESC LIMIT ?',
    [Number(req.query.limit) || 50]);
  res.json({ jobs: rows });
});

// 接收浏览器侧采集到的原始导出数据（扩展 / 侦察脚本 / 手工粘贴），
// 解析后入库。风控由 cnki-ingest 判定并熔断。
router.post('/ingest', (req, res) => {
  let out;
  try {
    out = ingestService.ingest({ db, payload: req.body });
  } catch (e) {
    return res.status(500).json({ error: '导入失败：' + e.message });
  }
  if (out.risk) return res.status(429).json(out);
  res.json(out);
});

// 查看已入库的知网抓取记录与全文任务状态
router.get('/records', (req, res) => {
  const rows = db.dbAll(
    "SELECT id, title, subtitle, fields, created_at FROM items WHERE module = 'paper' AND json_extract(fields, '$.dedup_key') IS NOT NULL ORDER BY id DESC LIMIT ?",
    [Number(req.query.limit) || 50]
  );
  res.json({
    records: rows.map((r) => {
      let f = {};
      try { f = JSON.parse(r.fields || '{}'); } catch (e) { f = {}; }
      return { id: r.id, title: r.title, journal: r.subtitle, year: f.year, metaLevel: f.meta_level, fulltextStatus: f.fulltext_status, createdAt: r.created_at };
    })
  });
});

router.post('/import', (req, res) => {
  const list = (req.body || {}).items || [];
  if (!list.length) return res.status(400).json({ error: '未选择文献' });
  const exist = existingKeys();
  const nowStr = db.now();
  let created = 0;
  let skipped = 0;
  for (const it of list) {
    const key = dedupKey(it.title, it.authors, it.year_volume);
    if (exist.has(key)) {
      skipped += 1;
      continue;
    }
    const info = db.dbRun(
      'INSERT INTO items (module, title, subtitle, status, fields, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      ['paper', String(it.title || '').trim(), String(it.journal || ''), '未读',
       JSON.stringify({
         author: it.authors || '',
         journal: it.journal || '',
         year_volume: it.year_volume || '',
         keywords: it.keywords || '',
         abstract: it.abstract || '',
         dedup_key: key,
         source: '知网抓取'
       }), nowStr, nowStr]
    );
    db.syncFts(info.lastInsertRowid);
    exist.add(key);
    created += 1;
  }
  res.json({ created, skipped });
});

module.exports = router;
