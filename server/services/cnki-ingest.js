// 知网抓取入库逻辑。
// 职责：接收浏览器侧（扩展/侦察脚本/手工粘贴）拿到的原始 JSON，
//       判定风控 → 解析 → 去重 → 留档原文 → 写入 items → 登记全文任务。
// 所有数据库访问通过注入的 db 对象完成，便于用假库做单元测试。

const parser = require('./cnki-export');

// 把侦察脚本的产出统一成 [{ exportApi, pageUrl, detail, fulltext }]
function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.items)) return payload.items.map(normalizePayload).flat();
  if (payload.exportApi) return [payload];
  if (Array.isArray(payload)) return payload.map(normalizePayload).flat();
  return [];
}

function ingest({ db, payload }) {
  const list = normalizePayload(payload);
  const result = { received: list.length, created: 0, skipped: 0, risk: false, message: '', records: [], warnings: [] };
  if (!list.length) {
    result.message = '没有可识别的知网数据';
    return result;
  }

  const nowStr = db.now();
  const seen = new Set();

  for (const one of list) {
    const klass = parser.classifyResponse(one.exportApi);
    // 触发风控：立刻停止后续所有条目，绝不大批重试
    if (klass.status === 'risk') {
      result.risk = true;
      result.message = '知网风控已被触发，已停止本次导入。请稍后再试，不要连续重试。';
      break;
    }
    if (klass.status === 'expired') {
      result.warnings.push('登录态疑似失效或返回异常：' + (klass.message || ''));
      continue;
    }

    const parsed = parser.parseExport(one.exportApi, {
      pageUrl: one.pageUrl || (one.detail && one.detail.pageUrl) || '',
      exportId: (one.detail && one.detail.exportId) || '',
      dbcode: (one.detail && one.detail.dbcode) || '',
      fulltext: one.fulltext || {}
    });
    if (!parsed.record) continue;
    const r = parsed.record;
    result.warnings = result.warnings.concat(parsed.warnings.filter((w) => !result.warnings.includes(w)));

    // 去重：先查留档表，再查已入库条目
    if (seen.has(r.dedupKey)) { result.skipped += 1; continue; }
    const existsRaw = db.dbGet('SELECT id FROM cnki_raw WHERE dedup_key = ?', [r.dedupKey]);
    const existsItem = db.dbGet('SELECT id FROM items WHERE module = ? AND json_extract(fields, ?) = ?',
      ['paper', '$.dedup_key', r.dedupKey]);
    if (existsRaw || existsItem) { result.skipped += 1; seen.add(r.dedupKey); continue; }

    // 1) 留档原文（解析逻辑升级后可重跑）
    db.dbRun('INSERT OR IGNORE INTO cnki_raw (dedup_key, page_url, export_id, dbcode, payload, created_at) VALUES (?,?,?,?,?,?)',
      [r.dedupKey, r.pageUrl, r.exportId, r.dbcode, JSON.stringify(one), nowStr]);

    // 2) 写入文献条目
    const info = db.dbRun(
      'INSERT INTO items (module, title, subtitle, status, fields, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      ['paper', r.title || '(无题名)', r.journal || '', '未读', JSON.stringify({
        author: r.authorText,
        journal: r.journal,
        year: r.year,
        year_volume: [r.year, r.issue].filter(Boolean).join(''),
        pub_time: r.pubTime,
        pages: r.pages,
        page_count: r.pageCount,
        doi: r.doi,
        issn: r.issn,
        cn_number: r.cnNumber,
        keywords: (r.keywords || []).join('; '),
        abstract: r.abstract,
        affiliation: (r.affiliation || []).join('; '),
        fund: r.fund,
        source_db: r.srcDatabase,
        ref_type: r.refType,
        link: r.link,
        page_url: r.pageUrl,
        dedup_key: r.dedupKey,
        meta_level: r.metaLevel,
        fulltext_status: r.fulltext.status,
        source: '知网导出接口'
      }), nowStr, nowStr]
    );
    if (db.syncFts) db.syncFts(info.lastInsertRowid);

    // 3) 登记全文任务：可下的排队，文献传递的直接标记，不尝试下载
    const ft = r.fulltext;
    const jobStatus = ft.status === 'available' ? 'pending'
      : (ft.status === 'need_document_delivery' ? 'need_document_delivery' : 'none');
    if (jobStatus !== 'none') {
      db.dbRun('INSERT INTO cnki_jobs (kind, dedup_key, item_id, payload, status, attempts, next_run_at, last_error, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        ['fulltext', r.dedupKey, info.lastInsertRowid, JSON.stringify({ url: ft.downloadUrl || '', format: ft.format || '' }),
         jobStatus, 0, nowStr, jobStatus === 'need_document_delivery' ? '该文献需文献传递/付费，未尝试下载' : '', nowStr, nowStr]);
    }

    seen.add(r.dedupKey);
    result.created += 1;
    result.records.push({
      title: r.title, journal: r.journal, year: r.year,
      dedupKey: r.dedupKey, metaLevel: r.metaLevel, fulltext: r.fulltext.status,
      itemId: info.lastInsertRowid
    });
  }

  if (!result.created && !result.risk && !result.message) {
    result.message = result.skipped ? '全部已存在，未重复入库' : '没有成功解析的条目';
  }
  return result;
}

module.exports = { ingest, normalizePayload };
