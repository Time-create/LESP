// 知网导出接口解析器。
// 依据真实样本 docs/cnki-contract.json 编写，不依赖任何猜测字段。
// 设计原则：
//   1. 原始数据永远保留（调用方入库 cnki_raw），解析逻辑可随时升级并重跑；
//   2. 解析失败不抛异常，返回 partial + warnings，由调用方决定如何提示；
//   3. 缺失字段一律留空或标 unknown，绝不编造（知网本身有 year=0000、页码“-”等脏值）。

// ---------- 基础工具 ----------

// 知网返回的换行是 HTML 的 <br>，不是回车
function splitLines(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
}

// 按分隔符切开并去掉末尾空串（知网的作者/关键词都以 ; 结尾）
function splitList(s) {
  return String(s || '')
    .split(/[;；]/)
    .map((x) => decodeEntities(x).trim())
    .filter(Boolean);
}

// ---------- 三种格式解析 ----------

// ELEARNING（知网研学）字段最全：含机构、出版时间、页数、来源库
const ELEARNING_MAP = {
  'Title': 'title',
  'Author': 'authors',
  'Source': 'journal',
  'PubTime': 'pubTime',
  'Keyword': 'keywords',
  'Summary': 'abstract',
  'Organ': 'affiliation',
  'PageCount': 'pageCount',
  'SrcDatabase': 'srcDatabase',
  'Link': 'link',
  'Year': 'year',
  'Issue': 'issue',
  'DOI': 'doi',
  'Fund': 'fund',
  'CLC': 'clc'
};

function parseElearning(text) {
  const out = {};
  for (const line of splitLines(text)) {
    // 形如 "Title-题名: 值" 或 "DataType: 1"
    const m = line.match(/^([A-Za-z]+)(?:-[^:]*)?\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = decodeEntities(m[2]).trim();
    const field = ELEARNING_MAP[key];
    if (!field) continue;
    if (field === 'authors' || field === 'keywords' || field === 'affiliation') {
      out[field] = splitList(val);
    } else {
      out[field] = val;
    }
  }
  return out;
}

// EndNote：%X 标签式。包含 ISSN(%@)、CN号(%L)、页码(%P)、DOI(%R)，但常缺年份
const ENDNOTE_MAP = {
  'A': 'authors',
  'T': 'title',
  'J': 'journal',
  'B': 'journal',
  'K': 'keywords',
  'X': 'abstract',
  'N': 'issue',
  'P': 'pages',
  'R': 'doi',
  'U': 'url',
  'D': 'year',
  'V': 'volume',
  '@': 'issn',
  'L': 'cnNumber',
  '+': 'affiliation',
  '0': 'refType'
};

function parseEndnote(text) {
  const out = {};
  const authors = [];
  for (const rawLine of splitLines(text)) {
    const line = decodeEntities(rawLine);
    const m = line.match(/^%([@A-Za-z0-9+])\s*(.*)$/);
    if (!m) continue;
    const tag = m[1];
    const val = (m[2] || '').trim();
    const field = ENDNOTE_MAP[tag];
    if (!field) continue;
    if (field === 'authors') {
      for (const a of splitList(val)) authors.push(a);
    } else if (field === 'keywords' || field === 'affiliation') {
      out[field] = splitList(val);
    } else {
      out[field] = val;
    }
  }
  if (authors.length) out.authors = authors;
  return out;
}

// GB/T 7714-2025 引文：作者.题名[类型].刊名,年,卷(期):页码[日期].URL
function parseGbtrefer(text) {
  const out = {};
  const line = splitLines(text)[0] || '';
  // 去掉开头的序号 [1]
  const body = decodeEntities(line.replace(/^\[\d+\]\s*/, '')).trim();
  if (!body) return out;

  const urlMatch = body.match(/(https?:\/\/\S+?)(?=\.?$|\s*$)/);
  if (urlMatch) out.url = urlMatch[1].replace(/\.$/, '');

  // 作者：第一个点号之前
  const firstDot = body.indexOf('.');
  if (firstDot > 0) {
    out.authors = splitList(body.slice(0, firstDot));
  }
  // 文献类型标识 [J/OL]、[M] 等
  const typeMatch = body.match(/\[([A-Z]{1,2}(?:\/[A-Z]{2})?)\]/);
  if (typeMatch) out.refType = typeMatch[1];
  // 题名：作者后到类型标识前
  if (out.authors && out.authors.length) {
    const start = firstDot + 1;
    const end = typeMatch ? body.indexOf('[' + typeMatch[1] + ']') : body.indexOf(',');
    if (end > start) out.title = body.slice(start, end).trim();
  }
  // 刊名与年份：类型标识之后
  if (typeMatch) {
    const after = body.slice(body.indexOf('[' + typeMatch[1] + ']') + typeMatch[1].length + 2);
    const parts = after.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts[0]) out.journal = parts[0].replace(/\.$/, '');
    const yearMatch = after.match(/(19|20)\d{2}/);
    if (yearMatch) out.year = yearMatch[0];
    const pageMatch = after.match(/(\d+-\d+|\d+)/);
    if (pageMatch) out.pages = pageMatch[1];
  }
  return out;
}

// ---------- 风控与状态判定 ----------

// 依据实测：无登录态返回 { code:-403, message:"https://kns.cnki.net/verify/home?..." }
function classifyResponse(resp) {
  const code = resp && resp.code;
  if (code === 1) return { status: 'ok' };
  const msg = String((resp && (resp.message || resp.msg)) || '');
  if (/verify\/home|captcha|验证码/i.test(msg)) {
    return { status: 'risk', message: msg };
  }
  if (code === -403 || code === 403 || code === 401) {
    return { status: 'risk', message: msg || '知网返回 403/401，疑似风控' };
  }
  return { status: 'expired', message: msg || ('未知返回：code=' + code) };
}

// 全文链接分类：实测 bar.cnki.net/.../order 是文献传递流程，不是可下载直链
const ORDER_PATTERN = /bar\.cnki\.net.*\/order/i;

function classifyFulltext(fulltext) {
  const pdf = (fulltext && fulltext.pdfDown) || '';
  const caj = (fulltext && fulltext.cajDown) || '';
  if (!pdf && !caj) return { status: 'none', downloadUrl: '' };
  if (ORDER_PATTERN.test(pdf) && ORDER_PATTERN.test(caj || pdf)) {
    return { status: 'need_document_delivery', downloadUrl: '' };
  }
  if (ORDER_PATTERN.test(pdf)) {
    return { status: 'need_document_delivery', downloadUrl: '' };
  }
  return { status: 'available', downloadUrl: pdf || caj, format: pdf ? 'pdf' : 'caj' };
}

// ---------- 汇总 ----------

// 知网用 0000 / - / -- 作占位符（网络首发常见），这类值不能当真
function isPlaceholder(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim();
  return s === '' || s === '0000' || /^-{1,3}$/.test(s) || s === 'n.d.' || s === 'N/A';
}

function pick(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length) return v;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return typeof vals[0] === 'undefined' ? '' : (Array.isArray(vals[0]) ? [] : '');
}

function deriveYear(...cands) {
  for (const c of cands) {
    if (!c) continue;
    const m = String(c).match(/(19|20)\d{2}/);
    if (m) return m[0];
  }
  return '';
}

// 去重主键：优先用知网永久链接（新版页面没有 dbname/filename，只能用 urlid）
function dedupKey(record) {
  const link = String(record.link || record.url || '');
  const m = link.match(/link\.cnki\.net\/(?:urlid|doi)\/([^?]+)/i);
  if (m) return 'cnki:' + m[1].replace(/\.$/, '');
  return 't:' + [record.title, (record.authors || []).join(','), record.year]
    .map((s) => String(s || '').trim()).join('|');
}

function parseExport(resp, extraInfo) {
  const extra = extraInfo || {};
  const klass = classifyResponse(resp);
  const warnings = [];

  if (klass.status !== 'ok') {
    return { status: klass.status, message: klass.message, record: null, warnings };
  }

  const blocks = {};
  for (const item of (resp.data || [])) {
    const mode = String(item.mode || item.key || '').toUpperCase();
    const text = (item.value || [])[0] || '';
    if (mode.includes('ELEARNING')) blocks.elearning = parseElearning(text);
    else if (mode.includes('ENDNOTE')) blocks.endnote = parseEndnote(text);
    else if (mode.includes('GBTREFER')) blocks.gbtrefer = parseGbtrefer(text);
  }
  if (!blocks.elearning && !blocks.endnote && !blocks.gbtrefer) {
    warnings.push('未识别到任何已知格式，检查 displaymode 参数');
  }

  const e = blocks.elearning || {};
  const n = blocks.endnote || {};
  const g = blocks.gbtrefer || {};

  const authors = pick(e.authors, n.authors, g.authors) || [];
  const record = {
    title: pick(e.title, n.title, g.title),
    authors,
    authorText: authors.join('; '),
    journal: pick(e.journal, n.journal, g.journal),
    year: deriveYear(e.year, n.year, g.year, e.pubTime, g.year),
    pubTime: pick(e.pubTime),
    issue: pick(n.issue, e.issue, n.volume),
    pages: pick(n.pages, g.pages),
    pageCount: pick(e.pageCount),
    doi: pick(n.doi, e.doi),
    issn: pick(n.issn),
    cnNumber: pick(n.cnNumber),
    keywords: pick(e.keywords, n.keywords) || [],
    abstract: pick(e.abstract, n.abstract),
    affiliation: pick(e.affiliation, n.affiliation) || [],
    fund: pick(e.fund) || '',
    srcDatabase: pick(e.srcDatabase),
    refType: pick(n.refType, g.refType),
    link: pick(e.link, n.url, g.url),
    pageUrl: pick(extra.pageUrl),
    exportId: pick(extra.exportId),
    dbcode: pick(extra.dbcode),
    fulltext: classifyFulltext(extra.fulltext),
    source: '知网导出接口'
  };

  // 已知脏值处理：知网会用 0000 / - / -- 当占位符，一律置空，绝不编造
  const rawYear = pick(e.year, n.year, g.year);
  for (const field of ['year', 'pages', 'pageCount', 'issue', 'doi', 'issn', 'journal']) {
    const v = record[field];
    if (isPlaceholder(v)) {
      record[field] = '';
      if (field === 'year' && rawYear) warnings.push('年份为占位值 ' + rawYear + '，已置空');
      else if (v) warnings.push(field + ' 为占位值 “' + v + '”，已置空');
    }
  }
  if (!record.year && rawYear && !isPlaceholder(rawYear)) record.year = rawYear;
  if (!record.year) warnings.push('缺年份（网络首发文献常见，可后续补全）');
  if (!record.doi) warnings.push('缺 DOI（该文献可能尚未分配）');
  if (!record.authors.length) warnings.push('缺作者（老学位论文常见）');

  record.dedupKey = dedupKey(record);
  record.metaLevel = (record.abstract && record.year) ? 'full' : 'partial';
  return { status: 'ok', record, warnings, blocks };
}

module.exports = {
  parseExport,
  parseElearning,
  parseEndnote,
  parseGbtrefer,
  classifyResponse,
  classifyFulltext,
  dedupKey,
  splitLines
};
