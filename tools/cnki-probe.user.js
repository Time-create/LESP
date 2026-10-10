// ==UserScript==
// @name         LESP·辑微 · 知网接口侦察器
// @namespace    lesp-jiwei
// @version      1.0
// @description  在已登录的知网页面上，一次性采集真实接口契约并导出为 JSON。只在你点击时运行，只发一次请求。
// @match        https://kns.cnki.net/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const EXPORT_API = 'https://kns.cnki.net/dm8/API/GetExport';

  // ---------- 面板 ----------
  function createPanel() {
    const box = document.createElement('div');
    box.id = 'lesp-probe-panel';
    box.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:999999',
      'width:420px', 'max-height:70vh', 'overflow:auto',
      'background:#fff', 'color:#222', 'border:1px solid #d8d2c6',
      'border-radius:10px', 'box-shadow:0 8px 28px rgba(0,0,0,.22)',
      'font:12px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif', 'padding:14px'
    ].join(';');
    document.body.appendChild(box);
    return box;
  }

  function val(sel) {
    const el = document.querySelector(sel);
    return el ? (el.value || el.getAttribute('href') || '') : null;
  }

  function text(sel) {
    const el = document.querySelector(sel);
    return el ? el.innerText.trim().slice(0, 300) : null;
  }

  // ---------- 侦察主流程 ----------
  async function probe(report) {
    const url = location.href;

    // 1) 页面类型
    const isDetail = /\/kcms|\/kcms2|article\/abstract|detail\.aspx/i.test(url) || !!document.querySelector('#export-id');
    const isSearch = !!document.querySelector('.result-table-list') || !!document.querySelector('input.cbItem');
    report.pageType = isDetail ? 'detail' : (isSearch ? 'search' : 'unknown');
    report.pageUrl = url;

    // 2) 详情页隐藏字段
    report.detail = {
      exportId: val('#export-id'),
      exportUrl: val('#export-url'),
      dbcode: val('#paramdbcode'),
      dbname: val('#paramdbname'),
      filename: val('#paramfilename'),
      uniplatform: new URLSearchParams(location.search).get('uniplatform') || null
    };

    // 3) 标题/摘要等可见字段（用于后续核对解析结果对不对）
    report.visible = {
      title: text('h1') || text('.wx-tit') || text('.title'),
      authors: text('.author') || text('#authorpart'),
      journal: text('.journal') || text('.sourinfo'),
      abstract: text('#ChDivSummary') || text('.abstract-text') || text('#abstract'),
      keywords: text('.keywords') || text('#ChDivKeyWord')
    };

    // 4) 列表页批量 ID（若能取到，就能批量导出，不必逐篇打开）
    const boxes = Array.from(document.querySelectorAll('input.cbItem'));
    report.search = {
      rowCount: boxes.length,
      firstExportIds: boxes.slice(0, 3).map(b => b.value),
      titleSelectorHit: !!document.querySelector('td.name a.fz14'),
      rowCheckboxSelector: boxes.length ? 'input.cbItem' : null
    };

    // 5) 全文下载链接形态
    const links = Array.from(document.querySelectorAll('a')).filter(a => /download|pdfDown|cajDown|dflag/i.test(a.href || ''));
    report.fulltext = {
      pdfDown: val('a#pdfDown'),
      cajDown: val('a#cajDown'),
      candidates: links.slice(0, 8).map(a => ({ text: (a.innerText || '').trim().slice(0, 24), href: a.href })),
      hasOrderFlow: links.some(a => /bar\.cnki\.net.*order/i.test(a.href || ''))
    };

    // 6) 参考文献：判断是页面直出还是需额外请求
    const refCandidates = Array.from(document.querySelectorAll('div,section,li'))
      .filter(el => /^参考文献/.test((el.innerText || '').trim()))
      .map(el => (el.innerText || '').trim().length)
      .sort((a, b) => b - a);
    report.references = {
      domBlocksFound: refCandidates.length,
      longestTextLength: refCandidates[0] || 0,
      note: '若 longestTextLength > 200 说明内容已在页面里（DOM 直出）；若很小说明需另发请求加载'
    };

    // 7) 真调一次导出接口（仅详情页且有 ID 时；无 ID 时记原因，不硬发）
    report.exportApi = { url: EXPORT_API, called: false };
    const id = report.detail.exportId;
    if (!id) {
      report.exportApi.error = '当前页面没有 #export-id（可能不在详情页，或未登录）';
      return report;
    }
    try {
      const uniplatform = report.detail.uniplatform || 'NZKPT';
      const resp = await fetch(EXPORT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          filename: id,
          displaymode: 'GBTREFER,elearning,EndNote',
          uniplatform: uniplatform
        })
      });
      const json = await resp.json();
      report.exportApi.called = true;
      report.exportApi.httpStatus = resp.status;
      report.exportApi.code = json.code;
      report.exportApi.message = json.message || null;
      report.exportApi.modes = (json.data || []).map(d => d.mode || d.key);
      // 完整原文：这是写解析器最关键的素材，原样保留
      report.exportApi.raw = json;
    } catch (e) {
      report.exportApi.called = true;
      report.exportApi.error = String(e && e.message || e);
    }
    return report;
  }

  // ---------- 交互 ----------
  function boot() {
    if (document.getElementById('lesp-probe-panel')) return;
    const box = createPanel();
    box.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px">LESP·辑微 · 知网接口侦察器</div>
      <div id="lesp-probe-log" style="color:#666">点击按钮开始。只会向知网发 <b>1 次</b> 导出请求。</div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button id="lesp-run" style="flex:1;padding:6px 10px;border:1px solid #2A2724;background:#2A2724;color:#fff;border-radius:6px;cursor:pointer">开始侦察</button>
        <button id="lesp-copy" style="padding:6px 10px;border:1px solid #ccc;background:#fff;border-radius:6px;cursor:pointer" disabled>复制 JSON</button>
        <button id="lesp-save" style="padding:6px 10px;border:1px solid #ccc;background:#fff;border-radius:6px;cursor:pointer" disabled>下载 JSON</button>
        <button id="lesp-close" style="padding:6px 10px;border:1px solid #ccc;background:#fff;border-radius:6px;cursor:pointer">关闭</button>
      </div>
      <pre id="lesp-out" style="margin:10px 0 0;white-space:pre-wrap;word-break:break-all;max-height:46vh;overflow:auto;background:#FAF8F4;padding:8px;border-radius:6px"></pre>
    `;
    const log = box.querySelector('#lesp-probe-log');
    const out = box.querySelector('#lesp-out');
    let data = null;

    box.querySelector('#lesp-run').onclick = async () => {
      log.textContent = '正在侦察…';
      const report = { tool: 'LESP·辑微 CNKI 接口侦察器', version: 1, capturedAt: new Date().toISOString() };
      try {
        await probe(report);
      } catch (e) {
        report.fatal = String(e && e.message || e);
      }
      data = report;
      out.textContent = JSON.stringify(report, null, 2);
      log.innerHTML = report.exportApi && report.exportApi.code === 1
        ? '<b style="color:#2E7D32">导出接口成功（code=1）</b> — 请点“下载 JSON”并存到 docs\\cnki-contract.json'
        : '<b style="color:#A63A28">导出接口未返回 code=1</b> — 多半是未登录或触发风控，请确认已登录知网';
      box.querySelector('#lesp-copy').disabled = false;
      box.querySelector('#lesp-save').disabled = false;
    };

    box.querySelector('#lesp-copy').onclick = () => {
      navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      log.textContent = '已复制到剪贴板，可直接粘贴给我。';
    };

    box.querySelector('#lesp-save').onclick = () => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cnki-contract.json';
      a.click();
      log.textContent = '已下载 cnki-contract.json —— 请把它放进项目 docs 目录。';
    };

    box.querySelector('#lesp-close').onclick = () => box.remove();
  }

  // 只在点击页面上的浮动按钮后执行，避免打开页面就自动发请求
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
