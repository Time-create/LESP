// 知网导出解析与入库：以 docs/cnki-contract.json（真实样本）为基准的回归测试
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const parser = require('../server/services/cnki-export');
const { ingest, normalizePayload } = require('../server/services/cnki-ingest');

const sample = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'docs', 'cnki-contract.json'), 'utf8')
);

// ---------- 解析器 ----------

test('真实样本：三种格式都能识别并解析出核心字段', () => {
  const out = parser.parseExport(sample.exportApi, {
    pageUrl: sample.pageUrl,
    exportId: sample.detail.exportId,
    dbcode: sample.detail.dbcode,
    fulltext: sample.fulltext
  });
  assert.strictEqual(out.status, 'ok');
  const r = out.record;
  assert.strictEqual(r.title, '新大众文艺的生成逻辑与发展路径——以动画《牛来》为例');
  assert.deepStrictEqual(r.authors, ['杨钊阳', '熊辉']);
  assert.strictEqual(r.journal, '学术探索');
  assert.strictEqual(r.year, '2026');            // EndNote 缺年份，由出版时间推导
  assert.strictEqual(r.pubTime, '2026-09-05 09:30');
  assert.strictEqual(r.pages, '1-9');
  assert.strictEqual(r.issn, '1006-723X');
  assert.strictEqual(r.cnNumber, '53-1148/C');
  assert.deepStrictEqual(r.affiliation, ['暨南大学马克思主义学院']);
  assert.deepStrictEqual(r.keywords, ['新大众文艺', '大众写', '写大众', '动画《牛来》']);
  assert.ok(r.abstract.length > 200);
  assert.strictEqual(r.metaLevel, 'full');
});

test('真实样本：去重主键取自知网永久链接（新版页面没有 dbname/filename）', () => {
  const out = parser.parseExport(sample.exportApi, { fulltext: sample.fulltext });
  assert.strictEqual(out.record.dedupKey, 'cnki:53.1148.C.20260904.1311.010');
});

test('真实样本：全文是文献传递链接，必须标记为不可直接下载', () => {
  const out = parser.parseExport(sample.exportApi, { fulltext: sample.fulltext });
  assert.strictEqual(out.record.fulltext.status, 'need_document_delivery');
  assert.strictEqual(out.record.fulltext.downloadUrl, '');
});

test('缺失字段要给出警告，但不得编造内容', () => {
  const out = parser.parseExport(sample.exportApi, { fulltext: sample.fulltext });
  assert.ok(out.warnings.some((w) => w.includes('DOI')));
  assert.strictEqual(out.record.doi, '');
  assert.strictEqual(out.record.fund, '');
});

test('风控识别：code=-403 且 message 含 verify/home 判为 risk', () => {
  const k = parser.classifyResponse({
    code: -403,
    message: 'https://kns.cnki.net/verify/home?captchaType=clickWord&ident=754fc1'
  });
  assert.strictEqual(k.status, 'risk');
});

test('风控识别：正常成功判为 ok', () => {
  assert.strictEqual(parser.classifyResponse({ code: 1, msg: '返回成功' }).status, 'ok');
});

test('脏值处理：年份 0000 与页码 - 必须置空', () => {
  const fake = {
    code: 1,
    data: [{
      mode: 'ELEARNING',
      value: ['DataType: 1<br>Title-题名: 测试<br>Author-作者: 张三;<br>Year-年: 0000<br>PageCount-页数: -<br>']
    }]
  };
  const out = parser.parseExport(fake, {});
  assert.strictEqual(out.record.year, '');
  assert.ok(out.warnings.some((w) => w.includes('0000')));
});

// ---------- 入库（用假数据库） ----------

function fakeDb() {
  const items = [];
  const raws = [];
  const jobs = [];
  return {
    items, raws, jobs,
    now: () => '2026-09-30T00:00:00.000Z',
    dbGet(sql, params = []) {
      if (sql.includes('FROM cnki_raw')) return raws.find((r) => r.dedup_key === params[0]) || null;
      if (sql.includes('FROM items')) return items.find((r) => r.dedup_key === params[2]) || null;
      return null;
    },
    dbAll: () => [],
    dbRun(sql, params = []) {
      if (sql.startsWith('INSERT OR IGNORE INTO cnki_raw')) {
        raws.push({ dedup_key: params[0] });
        return { lastInsertRowid: raws.length };
      }
      if (sql.startsWith('INSERT INTO items')) {
        const fields = JSON.parse(params[4]);
        items.push({ id: items.length + 1, dedup_key: fields.dedup_key });
        return { lastInsertRowid: items.length };
      }
      if (sql.startsWith('INSERT INTO cnki_jobs')) {
        jobs.push({ kind: params[0], status: params[4] });
        return { lastInsertRowid: jobs.length };
      }
      return { lastInsertRowid: 0 };
    },
    syncFts: () => {}
  };
}

test('入库：写入条目、留档原文，并为不可下载文献登记 need_document_delivery', () => {
  const db = fakeDb();
  const res = ingest({ db, payload: sample });
  assert.strictEqual(res.created, 1);
  assert.strictEqual(db.items.length, 1);
  assert.strictEqual(db.raws.length, 1);
  assert.strictEqual(db.jobs.length, 1);
  assert.strictEqual(db.jobs[0].status, 'need_document_delivery');
});

test('入库：同一篇重复导入必须被跳过', () => {
  const db = fakeDb();
  ingest({ db, payload: sample });
  const second = ingest({ db, payload: sample });
  assert.strictEqual(second.created, 0);
  assert.strictEqual(second.skipped, 1);
  assert.strictEqual(db.items.length, 1);
});

test('入库：遇到风控立即熔断，不再处理后续条目', () => {
  const db = fakeDb();
  const risky = {
    exportApi: { code: -403, message: 'https://kns.cnki.net/verify/home?captchaType=clickWord' }
  };
  const res = ingest({ db, payload: { items: [risky, sample] } });
  assert.strictEqual(res.risk, true);
  assert.strictEqual(res.created, 0);
  assert.strictEqual(db.items.length, 0);
});

test('入库：支持批量（items 数组）', () => {
  const db = fakeDb();
  const res = ingest({ db, payload: { items: [sample, sample] } });
  assert.strictEqual(res.created, 1);
  assert.strictEqual(res.skipped, 1);
});

test('格式归一：支持单条、数组、items 包裹三种输入', () => {
  assert.strictEqual(normalizePayload(sample).length, 1);
  assert.strictEqual(normalizePayload([sample, sample]).length, 2);
  assert.strictEqual(normalizePayload({ items: [sample] }).length, 1);
  assert.strictEqual(normalizePayload({}).length, 0);
});
