/* ============================================================
 * service_worker.js —— MV3 后台（无后台页面，只有 service worker）
 * 只做两件事：
 *   1. 确保目标标签页里有 content.js，并触发提取；
 *   2. PDF 抓取：用 chrome.debugger 调 Page.printToPDF（Chrome 没有
 *      chrome.tabs.print()，只有 Firefox 有，所以这是唯一的静默出 PDF 方案）。
 * 所有下载动作都在 popup 里完成（popup 有 DOM，能创建 Blob），
 * 因为 service worker 里没有 window，也就没有 URL.createObjectURL。
 * ============================================================ */

/* ------------------------------------------------------------
 * “接住”真实下载地址。
 * 知网的下载按钮指向的是下单页（bar.cnki.net/.../order），真正的文件地址
 * 是点击后由下单页内部再产生一次的。我们不去破解这个流程，
 * 而是等用户自己点一次下载，从浏览器的下载事件里记下最终地址。
 * ------------------------------------------------------------ */
chrome.downloads.onChanged.addListener((delta) => {
  const st = delta.state && delta.state.current;
  if (st !== 'complete') return;
  chrome.downloads.search({ id: delta.id }, (items) => {
    const it = items && items[0];
    if (!it) return;
    const url = it.finalUrl || it.url || '';
    if (!/cnki\.net/i.test(url)) return;
    if (/order/i.test(url)) return;            // 下单页不算，只要真正的文件地址
    chrome.storage.local.set({
      lastRealDownload: { url, filename: it.filename || '', mime: it.mime || '', at: Date.now() }
    });
  });
});

// 从后台直接取文件：后台请求不受页面跨域限制（需 host_permissions）
async function fetchAsBase64(url) {
  const res = await fetch(url, { credentials: 'include', redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const sig = String.fromCharCode.apply(null, bytes.subarray(0, 5));
  const caj = String.fromCharCode.apply(null, bytes.subarray(0, 4));
  if (sig !== '%PDF-' && !/CAJ|HUGE|C8/i.test(caj)) {
    throw new Error('不是 PDF/CAJ：类型 ' + (res.headers.get('content-type') || '未知')
      + ' · 最终URL ' + res.url.slice(0, 120)
      + (res.redirected ? '（经过重定向）' : '')
      + ' · 开头 ' + JSON.stringify(new TextDecoder('utf-8').decode(buf.slice(0, 120)).replace(/\s+/g, ' ')));
  }
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return { ok: true, base64: btoa(bin), size: bytes.length, format: sig === '%PDF-' ? 'pdf' : 'caj' };
}

/**
 * 用浏览器自己的下载引擎去取文件（等同于用户点击“PDF下载”，不绕过任何校验）。
 * 指定保存位置，完成后返回落盘路径与最终地址，交给 App 导入。
 */
function triggerDownload(url, filename) {
  return new Promise((resolve) => {
    chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false }, (id) => {
      if (!id) {
        resolve({ ok: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || '浏览器拒绝了该下载' });
        return;
      }
      const timer = setTimeout(finish, 180000);
      // eslint-disable-next-line no-inner-declarations
      function finish() {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(onChange);
        chrome.downloads.search({ id }, (items) => {
          const it = items && items[0];
          resolve({
            ok: Boolean(it && it.state === 'complete'),
            state: it ? it.state : 'unknown',
            id,
            filename: it ? it.filename : '',
            finalUrl: it ? (it.finalUrl || it.url || '') : '',
            bytes: it ? it.fileSize : 0,
            error: it ? it.error : undefined
          });
        });
      }
      function onChange(delta) {
        if (delta.id !== id) return;
        const st = delta.state && delta.state.current;
        if (st === 'complete' || st === 'interrupted') finish();
      }
      chrome.downloads.onChanged.addListener(onChange);
    });
  });
}

/**
 * 打开下载页并捕获它触发的下载。
 *
 * 关键点：order 链接返回的是 HTML 页面，真正的文件是这个页面在浏览器里
 * 执行后（JS 跳转/二次请求）才产生的。单纯 fetch 或用 downloads.download
 * 请求该 URL，拿到的都只是那个网页本身，所以必须**真的打开一个标签页**
 * 让页面跑起来，再监听它触发的下载事件。
 *
 * 全程不绕过任何校验：走的还是浏览器自己的网络栈、Cookie 与机构 IP。
 */
function openAndCapture(url, timeoutMs) {
  const wait = timeoutMs || 90000;
  return new Promise((resolve) => {
    const before = new Set();
    let tabId = null;
    let finished = false;
    let timer = null;

    function finish(result) {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChange);
      // 失败时取证：读出该页面最终停在哪、标题是什么、正文写了什么，
      // 用来区分“登录页 / 验证页 / 支付页 / 报错页”——一次运行就能定性
      if ((!result || !result.ok) && tabId) {
        chrome.tabs.get(tabId, (tab) => {
          const page = tab ? { url: tab.url, title: tab.title } : {};
          chrome.scripting.executeScript({
            target: { tabId },
            func: () => (document.body ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 200) : '')
          }).then((frames) => {
            const out = Object.assign({ page }, result || {});
            out.pageText = frames && frames[0] && frames[0].result || '';
            try { chrome.tabs.remove(tabId); } catch (e) { /* 忽略 */ }
            resolve(out);
          }).catch(() => {
            const out = Object.assign({ page }, result || {});
            try { chrome.tabs.remove(tabId); } catch (e) { /* 忽略 */ }
            resolve(out);
          });
        });
        return;
      }
      if (tabId) { try { chrome.tabs.remove(tabId); } catch (e) { /* 忽略 */ } }
      resolve(result || { ok: false, error: '等待超时' });
    }

    function onChange(delta) {
      if (before.has(delta.id)) return;                 // 只关心本次新产生的下载
      const st = delta.state && delta.state.current;
      if (st !== 'complete' && st !== 'interrupted') return;
      chrome.downloads.search({ id: delta.id }, (items) => {
        const it = items && items[0];
        if (!it) return finish();
        if (it.state === 'complete') {
          finish({
            ok: true,
            id: it.id,
            filename: it.filename || '',
            finalUrl: it.finalUrl || it.url || '',
            bytes: it.fileSize || it.bytes || 0,
            mime: it.mime || ''
          });
        } else {
          finish({ ok: false, state: it.state, error: it.error || '下载被中断' });
        }
      });
    }

    // 先记下现有下载项，再打开页面，最后监听新增下载
    chrome.downloads.search({ orderBy: ['-startTime'], limit: 100 }, (existing) => {
      (existing || []).forEach((i) => before.add(i.id));
      chrome.downloads.onChanged.addListener(onChange);
      timer = setTimeout(() => finish(), wait);
      chrome.tabs.create({ url, active: false }, (tab) => {
        if (!tab) { finish({ ok: false, error: '无法打开下载页' }); return; }
        tabId = tab.id;
      });
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const type = msg && msg.type;

  if (type === 'lesp:extract') {
    handleExtract(msg.tabId, msg.opts).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true; // 保持消息通道，等待异步响应
  }

  if (type === 'lesp:sw-download') {
    fetchAsBase64(msg.url).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }

  if (type === 'lesp:open-capture') {
    openAndCapture(msg.url, msg.timeoutMs).then(sendResponse);
    return true;
  }

  if (type === 'lesp:trigger-download') {
    triggerDownload(msg.url, msg.filename).then(sendResponse);
    return true;
  }

  // 取证：真的触发一次浏览器下载，用结果判断“是否真有权限”。
  // 这比看链接形态可靠得多——链接是 order 不代表没权限（知网标准下载通道就叫 order）。
  if (type === 'lesp:probe-download') {
    triggerDownload(msg.url, 'LESP附件/probe-' + Date.now() + '.pdf').then((r) => {
      sendResponse(Object.assign({}, r, { note: r.ok
        ? '浏览器已成功下载文件 —— 说明权限没问题，之前失败是工具取内容的方式不对'
        : '浏览器未能完成下载' }));
    });
    return true;
  }

  if (type === 'lesp:last-download') {
    chrome.storage.local.get('lastRealDownload', (r) => sendResponse(r.lastRealDownload || null));
    return true;
  }

  if (type === 'lesp:pdf') {
    handlePdf(msg.tabId, msg.opts).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }

  return undefined;
});

/** 注入脚本并执行提取；已注入过则直接调用 */
async function handleExtract(tabId, opts) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab) throw new Error('找不到目标标签页');
  if (!/^https?:/i.test(tab.url || '')) throw new Error('当前页面不是普通网页，无法提取');

  // 先试着直接调用（content_scripts 已声明，通常已注入）
  let res;
  try {
    res = await chrome.tabs.sendMessage(tabId, { type: 'lesp:do-extract', opts });
  } catch (e) {
    // 没注入成功（例如刚安装的扩展未刷新页面）→ 用 scripting 主动注入
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    res = await chrome.tabs.sendMessage(tabId, { type: 'lesp:do-extract', opts });
  }
  if (!res) throw new Error('页面没有返回内容，请刷新页面后重试');
  return res;
}

/** 附加调试器 → 打印成 PDF → 立刻断开 */
async function handlePdf(tabId, opts) {
  const target = { tabId };
  const printOpts = Object.assign({
    printBackground: true,
    preferCSSPageSize: true,
    marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4, // 单位：英寸
    transferMode: 'ReturnAsBase64'
  }, opts || {});

  await chrome.debugger.attach(target, '1.3');
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(target, 'Page.printToPDF', printOpts, (r) => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        if (!r || !r.data) return reject(new Error('浏览器没有返回 PDF 数据'));
        resolve(r);
      });
    });
    return { ok: true, base64: result.data };
  } finally {
    // 必须断开，否则浏览器会一直显示“正在调试”横幅
    try { await chrome.debugger.detach(target); } catch (e) { /* 忽略 */ }
  }
}
