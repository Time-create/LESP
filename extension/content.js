/* ============================================================
 * content.js —— 正文提取器
 * 作用：在页面自己的环境里读取正文，整理成「标题 / 段落 / 层级」结构。
 * 原则：
 *   1. 不联网、不加载任何远程代码（遵守 MV3 的 CSP）；
 *   2. 只读，不修改页面；
 *   3. 抓不到就如实上报，绝不编造内容。
 * 对外只暴露一个函数：window.__LESP_EXTRACT__()
 * ============================================================ */

(function () {
  'use strict';
  if (window.__LESP_EXTRACT__) return; // 防止重复注入

  // ---------- 工具 ----------
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const blockTags = /^(P|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE|PRE|FIGCAPTION|TD|TH)$/;

  // 这些区域几乎不可能是正文，先整段剔除
  const NOISE_SELECTOR = [
    'script', 'style', 'noscript', 'template', 'svg', 'canvas',
    'nav', 'header', 'footer', 'aside', 'form', 'iframe',
    '.advertisement', '.ads', '.sidebar', '.comment', '.comments',
    '.social-share', '.related', '.recommend', '.breadcrumb'
  ].join(',');

  // 正文候选容器（按常见站点习惯排序）
  const CANDIDATE_SELECTOR = [
    'article', '[role="main"]', 'main', '#content', '.content',
    '.article-content', '.post-content', '.entry-content',
    '.rich_media_content', '#articleContent', '.article-body'
  ].join(',');

  /**
   * 给候选容器打分：段落文字越多、链接越稀疏，越像正文。
   * 用打分而不是固定选择器，是为了兼容没用语义标签的老站点。
   */
  function scoreContainer(el) {
    const text = el.textContent || '';
    if (text.length < 200) return -1;
    const ps = el.querySelectorAll('p');
    let pLen = 0;
    ps.forEach((p) => { pLen += (p.textContent || '').length; });
    let linkLen = 0;
    el.querySelectorAll('a').forEach((a) => { linkLen += (a.textContent || '').length; });
    const density = text.length ? linkLen / text.length : 1;
    return pLen * (1 - Math.min(density, 0.6));
  }

  function pickContainer() {
    let best = null, bestScore = -1;
    document.querySelectorAll(CANDIDATE_SELECTOR).forEach((el) => {
      const s = scoreContainer(el);
      if (s > bestScore) { bestScore = s; best = el; }
    });
    if (best && bestScore > 400) return { el: best, confident: true };
    // 兜底：整页正文，剔除噪声后再用
    const body = document.body.cloneNode(true);
    body.querySelectorAll(NOISE_SELECTOR).forEach((n) => n.remove());
    return { el: body, confident: false };
  }

  /** 把 DOM 顺序遍历成结构化区块 */
  function toBlocks(root) {
    const blocks = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {           // 文本节点
          const t = clean(child.textContent);
          if (t.length > 1 && !(blocks.length && blocks[blocks.length - 1].type === 'p')) {
            blocks.push({ type: 'p', text: t });
          }
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (child.matches(NOISE_SELECTOR)) continue;

        const tag = child.tagName;
        if (/^H[1-6]$/.test(tag)) {
          blocks.push({ type: 'h', level: Number(tag[1]), text: clean(child.textContent) });
        } else if (tag === 'P') {
          const t = clean(child.textContent);
          if (t) blocks.push({ type: 'p', text: t });
        } else if (tag === 'LI') {
          const t = clean(child.textContent);
          if (t) blocks.push({ type: 'li', text: t });
        } else if (tag === 'BLOCKQUOTE') {
          const t = clean(child.textContent);
          if (t) blocks.push({ type: 'quote', text: t });
        } else if (tag === 'PRE') {
          blocks.push({ type: 'code', text: String(child.textContent || '') });
        } else if (tag === 'IMG') {
          const src = child.getAttribute('src') || '';
          if (src) blocks.push({ type: 'image', src: new URL(src, location.href).href, text: child.getAttribute('alt') || '' });
        } else if (tag === 'TABLE') {
          const rows = [];
          child.querySelectorAll('tr').forEach((tr) => {
            rows.push(Array.from(tr.children).map((c) => clean(c.textContent)));
          });
          if (rows.length) blocks.push({ type: 'table', rows });
        } else if (blockTags.test(tag)) {
          walk(child);
        } else {
          walk(child); // div / section 等容器：继续往里走，保持原有顺序
        }
      }
    };
    walk(root);
    return blocks;
  }

  function blocksToText(blocks) {
    return blocks
      .filter((b) => b.type !== 'image')
      .map((b) => (b.type === 'table' ? (b.rows || []).map((r) => r.join('\t')).join('\n') : b.text))
      .join('\n\n');
  }

  function blocksToMarkdown(blocks, withImages) {
    const out = [];
    for (const b of blocks) {
      if (b.type === 'h') out.push('#'.repeat(b.level) + ' ' + b.text);
      else if (b.type === 'p') out.push(b.text);
      else if (b.type === 'li') out.push('- ' + b.text);
      else if (b.type === 'quote') out.push('> ' + b.text);
      else if (b.type === 'code') out.push('```\n' + b.text + '\n```');
      else if (b.type === 'image') { if (withImages) out.push('![' + (b.text || '') + '](' + b.src + ')'); }
      else if (b.type === 'table') {
        const rows = b.rows || [];
        if (!rows.length) continue;
        out.push('| ' + rows[0].join(' | ') + ' |');
        out.push('| ' + rows[0].map(() => '---').join(' | ') + ' |');
        rows.slice(1).forEach((r) => out.push('| ' + r.join(' | ') + ' |'));
      }
      out.push('');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function blocksToHtml(blocks, meta, withImages) {
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body = blocks.map((b) => {
      if (b.type === 'h') return `<h${b.level}>${esc(b.text)}</h${b.level}>`;
      if (b.type === 'p') return `<p>${esc(b.text)}</p>`;
      if (b.type === 'li') return `<li>${esc(b.text)}</li>`;
      if (b.type === 'quote') return `<blockquote>${esc(b.text)}</blockquote>`;
      if (b.type === 'code') return `<pre><code>${esc(b.text)}</code></pre>`;
      if (b.type === 'image') return withImages ? `<figure><img src="${esc(b.src)}" alt="${esc(b.text)}"></figure>` : '';
      if (b.type === 'table') {
        const rows = (b.rows || []).map((r) => '<tr>' + r.map((c) => `<td>${esc(c)}</td>`).join('') + '</tr>').join('');
        return `<table>${rows}</table>`;
      }
      return '';
    }).join('\n');

    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(meta.title)}</title>
<style>
  body{max-width:46em;margin:3em auto;padding:0 1.2em;line-height:1.75;
       font-family:"Songti SC","SimSun",Georgia,serif;color:#2A2724;background:#fff}
  h1,h2,h3{line-height:1.35;margin:1.6em 0 .6em}
  h1{font-size:1.7em;border-bottom:1px solid #e3ded3;padding-bottom:.3em}
  p{margin:.9em 0}
  img{max-width:100%}
  table{border-collapse:collapse;width:100%}
  td{border:1px solid #ddd;padding:.4em .6em}
  blockquote{margin:1em 0;padding:.4em 1em;border-left:3px solid #d8d2c6;color:#6F6960}
  .meta{color:#9A938A;font-size:.85em;margin-bottom:2em}
  @media print{ body{margin:0} .no-print{display:none} }
</style></head>
<body>
<h1>${esc(meta.title)}</h1>
<div class="meta">${[meta.byline, meta.siteName, meta.url].filter(Boolean).map(esc).join(' · ')}</div>
${body}
</body></html>`;
  }

  /** 等待懒加载内容：观察 DOM 变化，安静一段时间就认为加载完了 */
  function waitForStable(timeoutMs) {
    return new Promise((resolve) => {
      let timer = setTimeout(finish, timeoutMs);
      const obs = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(finish, 700);
      });
      obs.observe(document.body, { childList: true, subtree: true });
      function finish() {
        clearTimeout(timer);
        obs.disconnect();
        resolve(true);
      }
    });
  }

  /**
   * 找全文下载链接。
   * 实测结论：bar.cnki.net/.../order?id= 是“文献传递/付费”流程页，不是可下载直链；
   * 真正能下的形态是 KNS8/download?... 或详情页上的 a#pdfDown / a#cajDown 直链。
   */
  function findFulltextLinks() {
    const links = [];
    const seen = new Set();
    const push = (href, kind, text) => {
      if (!href || /^javascript:/i.test(href)) return;
      let abs;
      try { abs = new URL(href, location.href).href; } catch (e) { return; }
      if (seen.has(abs)) return;
      seen.add(abs);
      links.push({ url: abs, kind, text: String(text || '').trim().slice(0, 30) });
    };

    // 1) 标准下载按钮
    const pdf = document.querySelector('a#pdfDown');
    const caj = document.querySelector('a#cajDown');
    push(pdf && pdf.getAttribute('href'), 'pdf', pdf && pdf.innerText);
    push(caj && caj.getAttribute('href'), 'caj', caj && caj.innerText);

    // 2) 任何 href 含 download / 文字含“下载 / PDF / CAJ”的链接
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const txt = (a.innerText || '').trim();
      if (/download/i.test(href) || /下载|^PDF$|^CAJ$/i.test(txt)) {
        push(href, /pdf/i.test(href + txt) ? 'pdf' : (/caj/i.test(href + txt) ? 'caj' : 'unknown'), txt);
      }
    });

    // 3) 带下载语义的按钮/元素上可能挂着 data-* 链接（新版知网节常见）
    document.querySelectorAll('[id*=pdfDown i], [class*=pdfDown i], [id*=cajDown i], [class*=cajDown i], [id*=download i], [class*=download i]').forEach((el) => {
      for (const attr of ['href', 'data-url', 'data-href', 'data-link', 'data-download']) {
        push(el.getAttribute(attr), /caj/i.test(el.outerHTML) ? 'caj' : 'pdf', el.innerText);
      }
    });

    // 4) 知网下载直链：补上 &dflag=pdfdown 强制 PDF（默认可能给 CAJ）
    const extra = [];
    for (const l of links) {
      if (/kns\.cnki\.net.*download/i.test(l.url) && !/dflag=/i.test(l.url)) {
        try {
          const u = new URL(l.url);
          u.searchParams.set('dflag', 'pdfdown');
          extra.push({ url: u.href, kind: 'pdf', text: (l.text || '') + ' +dflag' });
        } catch (e) { /* 忽略解析失败 */ }
      }
    }
    const all = links.concat(extra);
    return all.map((l) => Object.assign({}, l, {
      isOrderFlow: /bar\.cnki\.net.*\/order/i.test(l.url)
    }));
  }

  /**
   * 用浏览器自己的会话去下载全文：只有浏览器里有登录态，App 自己下不了。
   * 返回 base64，交给 popup 转文件并同步给 App。
   */
  async function downloadFulltext(url) {
    let res;
    try {
      res = await fetch(url, { credentials: 'include', redirect: 'follow' });
    } catch (e) {
      return { ok: false, error: '下载请求失败（可能被网络或跨域策略拦截）：' + e.message };
    }
    if (!res.ok) return { ok: false, error: '服务器返回 HTTP ' + res.status };
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const sig = String.fromCharCode.apply(null, bytes.subarray(0, 5));
    const cajSig = String.fromCharCode.apply(null, bytes.subarray(0, 4));
    // CAJ 也算成功（有些文献只有 CAJ 版）
    if (sig !== '%PDF-' && !/CAJ|HUGE|C8/i.test(cajSig)) {
      const text = new TextDecoder('utf-8').decode(buf.slice(0, 400));
      const looksLogin = /login|登录|verify|验证|fsso|cas/i.test(text);
      return {
        ok: false,
        error: looksLogin
          ? '拿到的是登录/验证页面（不是文件）—— 请在浏览器里确认已登录知网'
          : '拿到的不是 PDF/CAJ：HTTP ' + res.status
            + ' · 类型 ' + (res.headers.get('content-type') || '未知')
            + ' · 开头 ' + JSON.stringify(text.slice(0, 80))
      };
    }
    const isCaj = sig !== '%PDF-';
    // arrayBuffer → base64（分块，避免超长参数栈溢出）
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return { ok: true, base64: btoa(bin), size: bytes.length, format: isCaj ? 'caj' : 'pdf' };
  }

  /**
   * 知网模式：在详情页调用导出接口拿权威元数据（与手工粘贴导入同一数据源）。
   * 只有页面自己的环境里有登录态，所以必须在 content script 里发这个请求。
   */
  async function collectCnki() {
    const g = (sel) => {
      const e = document.querySelector(sel);
      return e ? (e.value || e.getAttribute('href') || '') : null;
    };
    const exportId = g('#export-id');
    if (!exportId) {
      return { ok: false, error: '本页不是知网文献详情页（未找到 #export-id）。请先在知网打开某篇论文的详情页，并确认已登录。' };
    }
    const detail = {
      exportId,
      dbcode: g('#paramdbcode'),
      dbname: g('#paramdbname'),
      filename: g('#paramfilename'),
      uniplatform: new URLSearchParams(location.search).get('uniplatform') || 'NZKPT'
    };
    const apiUrl = g('#export-url') || 'https://kns.cnki.net/dm8/API/GetExport';
    let resp;
    try {
      resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          filename: exportId,
          displaymode: 'GBTREFER,elearning,EndNote',
          uniplatform: detail.uniplatform
        })
      });
    } catch (e) {
      return { ok: false, error: '导出接口请求失败：' + e.message };
    }
    let exportApi;
    try { exportApi = await resp.json(); } catch (e) {
      return { ok: false, error: '导出接口返回的不是 JSON（HTTP ' + resp.status + '）' };
    }
    return {
      ok: true,
      cnki: true,
      pageUrl: location.href,
      detail,
      exportApi,
      fulltext: { pdfDown: g('a#pdfDown'), cajDown: g('a#cajDown') },
      fulltextLinks: findFulltextLinks()
    };
  }

  /**
   * 诊断用：列出页面上所有候选下载链接，并逐个实际请求一次，
   * 记录 HTTP 状态、返回类型、开头字节，便于定位“为什么下不到”。
   */
  async function diagnoseDownload() {
    const links = findFulltextLinks();
    const report = {
      pageUrl: location.href,
      loggedInHint: /登录|login/i.test(document.body.innerText.slice(0, 500)) ? '页面上方疑似有登录提示' : '未发现登录提示',
      candidates: []
    };
    for (const l of links.slice(0, 8)) {
      const item = { url: l.url.slice(0, 200), kind: l.kind, text: l.text, isOrderFlow: l.isOrderFlow, result: null };
      // 跨域链接在 content script 里会被 CORS 拦住，没法直接取内容，直接标注跳过
      let host = '';
      try { host = new URL(l.url).hostname; } catch (e) { host = ''; }
      if (host && host !== location.hostname) {
        item.result = { skipped: '跨域（' + host + '），扩展无法直接读取内容' };
        report.candidates.push(item);
        continue;
      }
      try {
        const res = await fetch(l.url, { credentials: 'include', redirect: 'follow' });
        const buf = await res.arrayBuffer();
        const head = new Uint8Array(buf.slice(0, 12));
        item.result = {
          status: res.status,
          contentType: res.headers.get('content-type') || '',
          bytes: buf.byteLength,
          headHex: Array.from(head).map((b) => b.toString(16).padStart(2, '0')).join(' '),
          startsWithPdf: String.fromCharCode.apply(null, head.subarray(0, 5)) === '%PDF-'
        };
      } catch (e) {
        item.result = { error: String(e && e.message || e) };
      }
      report.candidates.push(item);
    }
    return report;
  }

  // 接收来自 service worker / popup 的提取指令
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'lesp:do-extract') {
      window.__LESP_EXTRACT__(msg.opts)
        .then((data) => {
          if (msg.opts && msg.opts.withLinks) data.links = findFulltextLinks();
          sendResponse(data);
        })
        .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
      return true; // 异步响应
    }
    if (msg && msg.type === 'lesp:cnki-collect') {
      collectCnki()
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
      return true;
    }
    if (msg && msg.type === 'lesp:diagnose-download') {
      diagnoseDownload()
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
      return true;
    }
    if (msg && msg.type === 'lesp:do-download') {
      downloadFulltext(msg.url)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
      return true;
    }
    return undefined;
  });

  /** 主入口 */
  window.__LESP_EXTRACT__ = async function (opts) {
    const options = opts || {};
    const warnings = [];

    if (options.wait) await waitForStable(options.waitMs || 3000);

    const { el, confident } = pickContainer();
    if (!confident) warnings.push('未找到明确的正文容器，已改用整页内容，可能混入导航或广告文字');

    const blocks = toBlocks(el);
    if (!blocks.length) warnings.push('页面没有可提取的文本内容');

    const meta = {
      title: clean(
        (document.querySelector('meta[property="og:title"]') || {}).content ||
        (document.querySelector('h1') || {}).textContent ||
        document.title || '未命名'
      ),
      byline: clean(
        (document.querySelector('meta[name="author"]') || {}).content ||
        (document.querySelector('.author, .byline') || {}).textContent || ''
      ),
      siteName: clean(
        (document.querySelector('meta[property="og:site_name"]') || {}).content ||
        location.hostname
      ),
      url: location.href
    };

    // 知网这类站点：正文在 CAJ/PDF 里，网页上只有题录和摘要，必须如实告知
    if (/cnki\.net/i.test(location.hostname)) {
      warnings.push('知网正文不在网页中（为 CAJ/PDF 文件），本次只能抓到页面上可见的题录与摘要');
    }

    const text = blocksToText(blocks);
    return {
      ok: blocks.length > 0,
      meta,
      blocks,
      text,
      markdown: blocksToMarkdown(blocks, Boolean(options.withImages)),
      html: blocksToHtml(blocks, meta, Boolean(options.withImages)),
      stats: {
        chars: text.length,
        blocks: blocks.length,
        headings: blocks.filter((b) => b.type === 'h').length,
        paragraphs: blocks.filter((b) => b.type === 'p').length,
        images: blocks.filter((b) => b.type === 'image').length
      },
      warnings
    };
  };
})();
