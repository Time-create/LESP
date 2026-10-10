// 知网同步服务：接收浏览器扩展送来的「元数据 + 正文 + 全文文件」，落库并保存附件。
// 设计要点：
//   1. 下载由扩展完成（只有浏览器里有知网登录态），App 只负责接收与落库；
//   2. 本机口令校验，避免同一台机器上别的程序冒充扩展写入；
//   3. 每一步都有明确日志，失败原因写进 cnki_jobs.last_error，便于排查；
//   4. 全文文件先校验魔数（%PDF- / CAJ 头）再落盘，防止把登录页存成“论文”。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const paths = require('../lib/paths');
const parser = require('./cnki-export');
const attachmentStore = require('./attachment-store');
const attachmentPickup = require('./attachment-pickup');

const logsDir = () => path.join(paths.getDataDir(), 'logs');

function log(message, level) {
  const line = `[${new Date().toISOString()}] [${level || 'info'}] ${message}`;
  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    fs.appendFileSync(path.join(logsDir(), 'cnki-sync.log'), line + '\n', 'utf8');
  } catch (e) { /* 日志写不进去也不能影响主流程 */ }
  console.log(line);
}

function readLog(maxLines) {
  const file = path.join(logsDir(), 'cnki-sync.log');
  if (!fs.existsSync(file)) return [];
  const all = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  return all.slice(-(maxLines || 100));
}

// 文件魔数校验：防止把登录页/错误页当成全文存下来
function sniffFormat(buf) {
  if (buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-') return { ok: true, ext: 'pdf', mime: 'application/pdf' };
  const head = buf.slice(0, 8).toString('latin1');
  if (/CAJ|HUGE|C8/i.test(head)) return { ok: true, ext: 'caj', mime: 'application/octet-stream' };
  // 文本类（正文导出）
  return { ok: false, ext: '', mime: '' };
}

function safeName(name, fallback) {
  const s = String(name || '').replace(/[\\/:*?"<>|\n\r\t]/g, '').replace(/\s+/g, ' ').trim();
  return (s || fallback || '正文').slice(0, 80);
}

function dedupKeyOf(it) {
  // 统一走 cnki-export 的权威实现，键格式保持不变（cnki:<id> 或 t:题名|作者|年），
  // 以便与检索/粘贴导入路径写入的 dedup_key 互相识别。
  return parser.dedupKey({
    link: it.link || it.pageUrl || '',
    title: it.title,
    authors: it.author ? [String(it.author)] : [],
    year: it.year
  });
}

// 摘要垃圾识别：扩展在未登录/风控页上会把整页文字当摘要带回来，这类内容绝不能入库
const ABSTRACT_GARBAGE = /(手机号认证|请尽快完成认证|请登录|用户登录|验证码|账号安全)/;

function cleanAbstract(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  if (ABSTRACT_GARBAGE.test(t.slice(0, 200))) return '';
  return t;
}

/**
 * @param {object} args { db, payload, tokenExpected }
 * payload = { token, port?, source, items: [ { title, author, journal, year, ... , file: { name, base64 } } ] }
 */
function sync({ db, payload, tokenExpected }) {
  const result = { ok: true, created: 0, skipped: 0, failed: 0, items: [], warnings: [], error: '' };
  const body = payload || {};

  // 1) 口令校验（fail-closed：未配置口令时拒绝同步，否则校验会被短路，接口等同无鉴权）
  if (!tokenExpected) {
    result.ok = false;
    result.error = '尚未设置同步口令，请先在 App 设置页生成并填入扩展';
    log('拒绝同步：未配置同步口令', 'warn');
    return result;
  }
  if (String(body.token || '') !== tokenExpected) {
    result.ok = false;
    result.error = '同步口令不正确，请在扩展里填入 App 设置页显示的口令';
    log('拒绝同步：口令不匹配', 'warn');
    return result;
  }

  const list = Array.isArray(body.items) ? body.items : [];
  if (!list.length) {
    result.ok = false;
    result.error = '没有收到任何条目';
    log('拒绝同步：条目为空', 'warn');
    return result;
  }
  log(`开始同步：收到 ${list.length} 条（来源 ${body.source || 'extension'}）`);

  const nowStr = db.now();

  for (let it of list) {
    try {
      // ---- 知网模式：条目携带原始 exportApi → 用与粘贴导入相同的解析器出全字段 ----
      if (it.exportApi) {
        const klass = parser.classifyResponse(it.exportApi);
        if (klass.status === 'risk') {
          result.risk = true;
          result.message = '知网风控已被触发，已停止本次导入。请稍后再试，不要连续重试。';
          break;
        }
        if (klass.status !== 'ok') {
          result.warnings.push('导出接口未成功（' + (klass.message || klass.status) + '），该条目已跳过：请确认已在浏览器登录知网');
          result.failed += 1;
          continue;
        }
        const parsed = parser.parseExport(it.exportApi, {
          pageUrl: it.pageUrl || '',
          exportId: (it.detail && it.detail.exportId) || '',
          dbcode: (it.detail && it.detail.dbcode) || '',
          fulltext: it.fulltext || {}
        });
        if (!parsed.record) {
          result.warnings.push('导出数据解析失败，该条目已跳过');
          result.failed += 1;
          continue;
        }
        const pr = parsed.record;
        // 用解析结果覆盖扩展带来的字段（导出接口是权威来源）
        it = Object.assign({}, it, {
          title: pr.title || it.title,
          author: pr.authorText || it.author || '',
          journal: pr.journal || it.journal || '',
          year: pr.year || it.year || '',
          issue: pr.issue || '',
          pubTime: pr.pubTime || '',
          pages: pr.pages || '',
          doi: pr.doi || '',
          issn: pr.issn || '',
          cnNumber: pr.cnNumber || '',
          keywords: (pr.keywords || []).join('; '),
          abstract: pr.abstract || '',
          affiliation: (pr.affiliation || []).join('; '),
          link: pr.link || it.link || '',
          fulltextStatus: (pr.fulltext && pr.fulltext.status) || it.fulltextStatus || 'none'
        });
        // 全文下载直链交给下面统一的文件处理：导出接口没有文件，下载信息用页面上的链接
        it.__directDownload = (it.fulltextLinks || []).filter((l) => !l.isOrderFlow).map((l) => l.url);
        result.warnings = result.warnings.concat(parsed.warnings.filter((w) => !result.warnings.includes(w)));
      }

      // ---- 摘要垃圾清洗（通用模式可能抓到登录页整页文字） ----
      if (it.abstract) {
        const cleaned = cleanAbstract(it.abstract);
        if (cleaned !== it.abstract) {
          it.abstract = cleaned;
          result.warnings.push('摘要疑似登录/验证页文字，已置空：' + (it.title || ''));
        }
      }

      const key = dedupKeyOf(it);
      // 去重只认「条目本身」。cnki_raw 只是留档：
      // 若留档在而条目已删（历史上删除未清留档造成的孤儿），自动清掉照常重新入库（自愈）。
      const existsItem = db.dbGet("SELECT id FROM items WHERE module = 'paper' AND json_extract(fields, '$.dedup_key') = ?", [key]);
      if (existsItem) {
        result.skipped += 1;
        result.warnings.push('已存在，跳过：' + (it.title || key));
        continue;
      }
      const existsRaw = db.dbGet('SELECT id FROM cnki_raw WHERE dedup_key = ?', [key]);
      if (existsRaw) {
        db.dbRun('DELETE FROM cnki_raw WHERE dedup_key = ?', [key]);
        db.dbRun('DELETE FROM cnki_jobs WHERE dedup_key = ?', [key]);
        result.warnings.push('检测到上次删除残留的记录，已自动清理并重新导入：' + (it.title || key));
        log('自愈：清除孤儿留档并重新导入 ' + key);
      }

      // 2) 先校验全文内容（校验通过但先不落盘，等条目建好拿到 id 再存）
      let fulltextStatus = 'none';
      let payload = null;   // { buf, ext, mime }
      let stagedFile = null; // { abs, rel, size, ext, mime }（来自下载目录/交接目录）
      const file = it.file;
      if (file && file.base64) {
        let buf = null;
        try { buf = Buffer.from(String(file.base64), 'base64'); } catch (e) { buf = null; }
        if (!buf || !buf.length) {
          fulltextStatus = 'failed';
          result.warnings.push('全文内容为空，未保存附件');
          log('全文为空：' + (it.title || ''), 'warn');
        } else {
          const sniff = sniffFormat(buf);
          if (!sniff.ok) {
            fulltextStatus = 'failed';
            result.warnings.push('下载到的不是 PDF/CAJ（可能是登录页或错误页），已丢弃，仅保留元数据');
            log(`全文格式异常，前8字节=${buf.slice(0, 8).toString('hex')} 标题=${it.title || ''}`, 'warn');
          } else {
            payload = { buf, ext: sniff.ext, mime: sniff.mime };
            fulltextStatus = 'downloaded';
          }
        }
      } else if (it.downloadedPath) {
        // 扩展已把浏览器下载的文件路径报给我们：校验 → 复制进统一附件目录（建条目前先落盘）
        try {
          stagedFile = attachmentPickup.stage({
            sourcePath: it.downloadedPath,
            filename: safeName(it.title, '全文'),
            db
          });
          fulltextStatus = 'downloaded';
        } catch (e) {
          fulltextStatus = 'failed';
          result.warnings.push('全文导入失败：' + e.message);
          log('交接文件导入失败：' + e.message, 'warn');
        }
      } else if (it.fulltextStatus) {
        fulltextStatus = String(it.fulltextStatus);
      }

      // 3) 写入文献条目
      const info = db.dbRun(
        'INSERT INTO items (module, title, subtitle, status, fields, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
        ['paper', String(it.title || '(无题名)').trim(), String(it.journal || ''), '未读', JSON.stringify({
          author: it.author || '',
          journal: it.journal || '',
          year: it.year || '',
          year_volume: [it.year, it.issue].filter(Boolean).join(''),
          pub_time: it.pubTime || '',
          pages: it.pages || '',
          doi: it.doi || '',
          issn: it.issn || '',
          cn_number: it.cnNumber || '',
          keywords: it.keywords || '',
          abstract: it.abstract || '',
          affiliation: it.affiliation || '',
          link: it.link || '',
          page_url: it.pageUrl || '',
          dedup_key: key,
          meta_level: it.abstract ? 'full' : 'partial',
          fulltext_status: fulltextStatus,
          source: '浏览器扩展同步'
        }), nowStr, nowStr]
      );
      const itemId = info.lastInsertRowid;
      if (db.syncFts) db.syncFts(itemId);

      // 4) 落盘并挂附件
      let attachmentId = null;
      if (payload) {
        const stored = attachmentStore.store({
          buffer: payload.buf,
          originalName: safeName(it.title, '全文') + '.' + payload.ext
        });
        const abs = stored.abs;
        const att = db.dbRun('INSERT INTO attachments (item_id, filename, rel_path, size, mime, created_at) VALUES (?,?,?,?,?,?)',
          [itemId, safeName(it.title, '全文') + '.' + payload.ext, stored.rel, payload.buf.length, payload.mime, nowStr]);
        db.dbRun('UPDATE attachments SET content_sha256=? WHERE id=?',
          [crypto.createHash('sha256').update(payload.buf).digest('hex'), att.lastInsertRowid]);
        attachmentId = att.lastInsertRowid;
        log(`全文已保存：${path.basename(abs)}（${payload.buf.length} 字节, ${payload.ext}）→ ${stored.rel}`);
      } else if (stagedFile) {
        // 从交接/下载目录复制来的文件已落盘，这里只补附件记录
        const att = db.dbRun('INSERT INTO attachments (item_id, filename, rel_path, size, mime, created_at) VALUES (?,?,?,?,?,?)',
          [itemId, safeName(it.title, '全文') + '.' + stagedFile.ext, stagedFile.rel, stagedFile.size, stagedFile.mime, nowStr]);
        db.dbRun('UPDATE attachments SET content_sha256=? WHERE id=?',
          [attachmentStore.sha256FileSync(stagedFile.abs), att.lastInsertRowid]);
        attachmentId = att.lastInsertRowid;
        log(`已从下载目录导入全文：${path.basename(stagedFile.abs)}（${stagedFile.size} 字节）→ ${stagedFile.rel}`);
      }

      // 5) 留档与任务记录
      // 客户端失败原因一并写入日志：全文没拿到时，服务端日志必须能看到“为什么”
      if (Array.isArray(it.clientErrors) && it.clientErrors.length) {
        log(`全文获取失败原因（客户端报告）[${it.title || key}]：` + it.clientErrors.join(' | '), 'warn');
      }
      log(`全文状态 [${it.title || key}]：${fulltextStatus}`);
      db.dbRun('INSERT OR IGNORE INTO cnki_raw (dedup_key, page_url, export_id, dbcode, payload, created_at) VALUES (?,?,?,?,?,?)',
        [key, it.pageUrl || '', '', it.dbcode || '', JSON.stringify(it).slice(0, 200000), nowStr]);
      // downloaded_pending_import：扩展已交给浏览器下载，等待本步导入；导入成败在上面已更新 fulltextStatus
      // 任务状态：downloaded→done，need_document_delivery 单独标记（不是失败，是“没权限”）
      const jobStatus = fulltextStatus === 'downloaded' ? 'done'
        : (fulltextStatus === 'need_document_delivery' ? 'need_document_delivery'
          : (fulltextStatus === 'none' ? 'none' : 'failed'));
      db.dbRun('INSERT INTO cnki_jobs (kind, dedup_key, item_id, payload, status, attempts, next_run_at, last_error, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        ['fulltext', key, itemId, JSON.stringify({ attachmentId, fulltextStatus }),
         jobStatus,
         0, nowStr, jobStatus === 'failed' ? (result.warnings[result.warnings.length - 1] || '') : '', nowStr, nowStr]);

      result.created += 1;
      result.items.push({ itemId, title: it.title, key, fulltextStatus, attachmentId });
    } catch (e) {
      result.failed += 1;
      result.warnings.push('处理失败：' + (e && e.message ? e.message : e));
      log('条目处理失败：' + (e && e.stack || e), 'error');
    }
  }

  log(`同步结束：新建 ${result.created}，跳过 ${result.skipped}，失败 ${result.failed}`);
  return result;
}

/**
 * 删除条目时清除其同步痕迹（cnki_raw / cnki_jobs）。
 * 否则去重逻辑会因为留档仍在而永远“已存在，跳过”，同一篇论文删除后无法重新抓取。
 */
function purgeSyncTraces(db, item) {
  let key = '';
  try {
    const f = typeof item.fields === 'object' ? item.fields : JSON.parse(item.fields || '{}');
    key = String(f.dedup_key || '');
  } catch (e) { key = ''; }
  if (!key) return false;
  db.dbRun('DELETE FROM cnki_raw WHERE dedup_key = ?', [key]);
  db.dbRun('DELETE FROM cnki_jobs WHERE dedup_key = ?', [key]);
  log(`条目已删除，清除同步痕迹：${key}`);
  return true;
}

module.exports = { sync, log, readLog, sniffFormat, dedupKeyOf, purgeSyncTraces };
