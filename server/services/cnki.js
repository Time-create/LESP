// 知网抓取服务。
// 出站请求仅在用户主动点击检索时发生，且使用用户自己保存的登录态。
// HTTP 获取通过 httpFn 抽象，测试可注入 mock 以验证去重、限速与失效提示逻辑。
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const SEARCH_URL = 'https://kns.cnki.net/kns8s/search';
const MIN_INTERVAL_MS = 3000;
const MAX_RESULTS = 20;

let httpFn = null;
let lastRequestAt = 0;
let requestTail = Promise.resolve();

function setHttpFn(fn) {
  httpFn = fn;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttledGet(url, cookie) {
  const request = requestTail.then(async () => {
    let remaining;
    while ((remaining = MIN_INTERVAL_MS - (Date.now() - lastRequestAt)) > 0) await sleep(remaining);
    try {
      if (httpFn) return await httpFn(url, cookie);
      const res = await fetch(url, {
        headers: { Cookie: cookie, 'User-Agent': USER_AGENT, Referer: 'https://kns.cnki.net/' }
      });
      return { status: res.status, body: await res.text() };
    } finally {
      lastRequestAt = Date.now();
    }
  });
  requestTail = request.catch(() => {});
  return request;
}

// 从知网结果页 HTML 中解析题录。知网结构可能调整，解析失败时返回空数组，
// 由调用方给出明确提示，不做静默吞错。
function parseResults(html) {
  const items = [];
  const rows = String(html || '').split(/<tr[^>]*>/).slice(1);
  for (const row of rows) {
    const titleMatch = row.match(/class="fz14"[^>]*>([\s\S]*?)<\/a>/);
    const authorMatch = row.match(/class="author"[^>]*>([\s\S]*?)<\/td>/);
    const sourceMatch = row.match(/class="source"[^>]*>([\s\S]*?)<\/td>/);
    const dateMatch = row.match(/class="date"[^>]*>([\s\S]*?)<\/td>/);
    if (!titleMatch) continue;
    const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    items.push({
      title: strip(titleMatch[1]),
      authors: strip(authorMatch ? authorMatch[1] : ''),
      journal: strip(sourceMatch ? sourceMatch[1] : ''),
      year_volume: strip(dateMatch ? dateMatch[1] : ''),
      keywords: '',
      abstract: '',
      source: '知网抓取'
    });
    if (items.length >= MAX_RESULTS) break;
  }
  return items;
}

function looksLoggedOut(status, body) {
  if (status === 403 || status === 401) return true;
  const b = String(body || '');
  return b.includes('用户登录') || b.includes('请登录') || b.includes('login.aspx');
}

async function search({ cookie, keyword, author, journal }) {
  if (!cookie || !String(cookie).trim()) {
    const err = new Error('请先更新登录态');
    err.code = 'NO_COOKIE';
    throw err;
  }
  const params = new URLSearchParams();
  params.set('kw', keyword || '');
  if (author) params.set('author', author);
  if (journal) params.set('journal', journal);
  const url = SEARCH_URL + '?' + params.toString();

  let res;
  try {
    res = await throttledGet(url, cookie);
  } catch (e) {
    const err = new Error('无法连接知网：' + e.message);
    err.code = 'NETWORK';
    throw err;
  }

  if (looksLoggedOut(res.status, res.body)) {
    const err = new Error('登录态已失效，请更新');
    err.code = 'COOKIE_EXPIRED';
    throw err;
  }

  let items;
  try {
    items = parseResults(res.body);
  } catch (e) {
    items = [];
  }
  if (!items.length && typeof res.body === 'string' && res.body.trim().startsWith('[')) {
    // 兼容返回 JSON 的情况
    try {
      const arr = JSON.parse(res.body);
      items = (Array.isArray(arr) ? arr : []).slice(0, MAX_RESULTS).map((r) => ({
        title: r.title || '',
        authors: r.authors || r.author || '',
        journal: r.journal || '',
        year_volume: r.year_volume || r.year || '',
        keywords: r.keywords || '',
        abstract: r.abstract || '',
        source: '知网抓取'
      }));
    } catch (e) {
      items = [];
    }
  }
  return items;
}

module.exports = { search, parseResults, setHttpFn, MAX_RESULTS, MIN_INTERVAL_MS };
