// 真库集成验证：临时数据目录 → 建表 → 走 ingest 服务 → 读回校验
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-cnki-'));
const paths = require('../server/lib/paths');
paths.setDataDir(tmp);

const db = require('../server/db');
db.initDb(tmp);

const { ingest } = require('../server/services/cnki-ingest');
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'cnki-contract.json'), 'utf8'));

const r1 = ingest({ db, payload: sample });
console.log('第一次导入:', JSON.stringify({ created: r1.created, skipped: r1.skipped, risk: r1.risk }));
const r2 = ingest({ db, payload: sample });
console.log('重复导入  :', JSON.stringify({ created: r2.created, skipped: r2.skipped }));

const rows = db.dbAll("SELECT id, title, subtitle, fields FROM items WHERE module='paper'");
console.log('库中条目数:', rows.length);
for (const row of rows) {
  const f = JSON.parse(row.fields);
  console.log('  id=%d %s | %s | %s', row.id, row.title, row.subtitle, f.year);
  console.log('     作者:%s 单位:%s', f.author, f.affiliation);
  console.log('     关键词:%s', f.keywords);
  console.log('     摘要长度:%d  元数据等级:%s  全文状态:%s', String(f.abstract).length, f.meta_level, f.fulltext_status);
  console.log('     去重键:%s', f.dedup_key);
}

const raws = db.dbAll('SELECT dedup_key, length(payload) AS len FROM cnki_raw');
console.log('原始留档:', raws.map((x) => `${x.dedup_key}(${x.len}B)`));
const jobs = db.dbAll('SELECT kind, status, last_error FROM cnki_jobs');
console.log('全文任务:', JSON.stringify(jobs));

db.closeDb && db.closeDb();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n临时目录已清理:', tmp);
