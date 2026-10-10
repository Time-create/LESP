// 阶段 8 验证：在真实 data 的**副本**上试跑分类迁移（不触碰原数据）
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-real-'));
fs.cpSync(path.join(ROOT, 'data'), tmp, { recursive: true });
say('真实数据副本已建立');

const paths = require('./server/lib/paths');
paths.setDataDir(tmp);
const LOG = path.join(os.tmpdir(), 'mig-check.txt');
const say = (...a) => fs.appendFileSync(LOG, a.join(' ') + '\n');
fs.writeFileSync(LOG, '');
const db = require('./server/db');
db.initDb(tmp);
process.on('exit', () => { try { say('--- 结束 ---'); } catch (e) {} });
const mig = require('./server/services/classification-migration');

say('迁移前：', JSON.stringify(mig.preview()));

(async () => {
  const r = await mig.run();
  say('迁移成功：', r.ok);
  say('  录文分类总数：', r.folders, '| 原按条目隔离：', r.cleared, '| 保留归类关系：', r.links);
  say('  同名自动改名：', r.renamed_total || 0);
  say('  自动备份：', r.backup && r.backup.ok ? '已备份' : '失败：' + (r.backup && r.backup.error));
  say('  索引：', db.dbAll("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'folder%'").map((x) => x.name).join(','));
  say('  item_id 残留：', db.dbGet('SELECT COUNT(*) n FROM excerpt_folders WHERE item_id IS NOT NULL').n);
  say('  条目总数：', db.dbGet('SELECT COUNT(*) n FROM items').n, '| 附件记录：', db.dbGet('SELECT COUNT(*) n FROM attachments').n);
  say('  附件目录：', fs.existsSync(path.join(tmp, 'files', 'attachments')) ? '完好' : '缺失');
  const again = await mig.run();
  say('重复执行：', again.skipped ? '幂等，已跳过' : '未跳过');
  db.closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
  say('临时副本已清理，原数据未被修改');
})().catch((e) => { console.error('验证失败：', e.message); process.exit(1); });