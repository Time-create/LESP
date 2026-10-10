/* ============================================================
 * popup.js —— 交互与下载
 * 为什么下载放在这里做：popup 是一个有 DOM 的页面，可以用
 * URL.createObjectURL 生成 Blob 链接；MV3 的 service worker 里没有
 * window，也就没有 createObjectURL，所以下载必须在 popup（或离屏文档）里完成。
 * ============================================================ */

const $ = (id) => document.getElementById(id);

// 面板上显示扩展版本号：排查“改了代码但行为没变”时，一眼确认加载的是哪个版本
document.getElementById('ver').textContent =
  '扩展 v' + chrome.runtime.getManifest().version;

function setStatus(text, kind) {
  const el = $('status');
  el.hidden = !text;
  el.textContent = text || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}

// 把标题整理成安全的文件名：去掉 Windows 不允许的字符
function safeName(raw, fallback) {
  const s = String(raw || '').replace(/[\\/:*?"<>|\n\r\t]/g, '').replace(/\s+/g, ' ').trim();
  return (s || fallback || '正文').slice(0, 80);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// base64 → Blob（PDF 用）
function base64ToBlob(base64, mime) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function saveBlob(blob, filename, saveAs) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: Boolean(saveAs), conflictAction: 'uniquify' }, (id) => {
      const err = chrome.runtime.lastError;
      if (err) { URL.revokeObjectURL(url); return reject(new Error(err.message)); }
      if (!id) { URL.revokeObjectURL(url); return reject(new Error('浏览器拒绝了这次下载')); }
      // 稍后再回收，避免下载还没开始链接就失效
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      resolve(id);
    });
  });
}

// ---------- 与「辑微」App 通信 ----------

const DEFAULT_PORT = 8791; // App 为扩展开通的固定同步端口（desktop/server.js 的 SYNC_PORT_BASE）

async function loadConf() {
  const c = await chrome.storage.sync.get({ port: DEFAULT_PORT, token: '' });
  return { port: Number(c.port) || DEFAULT_PORT, token: c.token || '' };
}

async function saveConf(port, token) {
  await chrome.storage.sync.set({ port, token });
}

const baseUrl = (port) => `http://127.0.0.1:${port}`;

async function pingApp(port) {
  const url = `${baseUrl(port)}/api/cnki/sync/ping`;
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    return { ok: false, error: `连不上 App（${url}）：${e.message}。请确认 App 已启动，且端口号一致（App 设置页可看）` };
  }
}

async function pushToApp(port, token, items) {
  const res = await fetch(`${baseUrl(port)}/api/cnki/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LESP-Token': token },
    body: JSON.stringify({ token, source: 'chrome-extension', items })
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { ok: false, error: 'App 返回的不是 JSON：' + text.slice(0, 200) }; }
  if (!res.ok && !json.error) json.error = 'HTTP ' + res.status;
  return json;
}

/** 把提取结果整理成 App 能识别的条目 */
function toAppItem(data) {
  return {
    title: data.meta.title,
    author: data.meta.byline || '',
    journal: data.meta.siteName || '',
    year: '',
    abstract: (data.stats && data.stats.chars) ? String(data.text || '').slice(0, 1000) : '',
    link: data.meta.url,
    pageUrl: data.meta.url,
    keywords: '',
    fulltextStatus: 'none'
  };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('没有打开任何标签页');
  return tab;
}

// PDF 需要 debugger 权限：按需申请，用不到就不申请
async function ensureDebuggerPermission() {
  const has = await chrome.permissions.contains({ permissions: ['debugger'] });
  if (has) return true;
  return chrome.permissions.request({ permissions: ['debugger'] });
}

$('go').addEventListener('click', async () => {
  const btn = $('go');
  btn.disabled = true;
  setStatus('正在读取页面…');
  $('meta').hidden = true;

  try {
    const tab = await getActiveTab();

    // ---------- 知网页面：走「导出接口」权威路径，不做通用正文提取 ----------
    if (/cnki\.net/i.test(tab.url || '')) {
      setStatus('知网页面：正在通过导出接口获取完整元数据…');
      // 注意：发给网页内内容脚本必须用 tabs.sendMessage（runtime.sendMessage 只到扩展后台）
      let res;
      try {
        res = await chrome.tabs.sendMessage(tab.id, { type: 'lesp:cnki-collect' });
      } catch (e) {
        // 页面里还没有脚本（扩展刚重载、网页未刷新）→ 主动注入一次
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        res = await chrome.tabs.sendMessage(tab.id, { type: 'lesp:cnki-collect' });
      }
      if (!res) {
        // sendMessage 没有任何回应 = 页面里的脚本还是旧版（扩展或网页没刷新）
        setStatus('页面没有响应。请按顺序做：① 打开 chrome://extensions 点本扩展的「重新加载」② 回到知网页面按 F5 刷新 ③ 再点「抓取并下载」', 'err');
        return;
      }
      if (!res.ok) {
        setStatus('抓取失败：' + (res.error || '未知原因'), 'err');
        return;
      }
      if (!res.exportApi || res.exportApi.code !== 1) {
        const msg = (res.exportApi && (res.exportApi.message || res.exportApi.msg)) || '';
        const risk = /verify\/home|captcha/i.test(msg);
        setStatus(risk
          ? '知网风控已触发，请过一会儿再试（不要连续重试）'
          : '导出接口未成功（code=' + (res.exportApi && res.exportApi.code) + '）。请确认已在浏览器登录知网', 'err');
        return;
      }

      // 全文：全自动流程（三路尝试，都不绕过知网校验，只是替代你手动点击）
      //   路径 0：后台直接请求（order 链接也可能直接吐文件）
      //   路径 A：用浏览器下载引擎取文件，拿到最终地址后再取内容
      //   路径 B：下载落到「下载\LESP附件」，由 App 校验后导入
      let file = null, downloadedPath = '', fulltextStatus = 'none';
      const lastErrs = [];
      const lastErrPush = (s) => { if (s && !lastErrs.includes(s)) lastErrs.push(s); };

      // 先看有没有“上次手动下载时捕获到的文件”，并如实告知用户
      const capturedInfo = await chrome.runtime.sendMessage({ type: 'lesp:last-download' });
      const capturedFresh = capturedInfo && (Date.now() - capturedInfo.at) < 30 * 60 * 1000;
      if ($('fulltext').checked) {
        // 最可靠路径：你已经手动下载过，文件就在下载目录里 —— 直接把路径交给 App 导入
        if (capturedFresh && capturedInfo.filename) {
          downloadedPath = capturedInfo.filename;
          setStatus('检测到你刚下载的全文（' + Math.round((Date.now() - capturedInfo.at) / 60000) + ' 分钟前），将随元数据自动入库…');
        } else {
          setStatus('未捕获到最近 30 分钟内的下载。将尝试自动获取；若失败，可手动点一次「PDF下载」后重试（文件会被自动导入）');
        }
      }
      const links = (res.fulltextLinks || []).filter((l) => !l.isOrderFlow);
      const orders = (res.fulltextLinks || []).filter((l) => l.isOrderFlow);
      const orderOnly = orders.length > 0;
      if ($('fulltext').checked) {
        // 路径 0：后台直接请求（先试直链，再试 order 链接——有权限时它会直接吐文件）
        const tryUrls = links.concat(orders).slice(0, 4);
        if (!downloadedPath && tryUrls.length) {
          setStatus('正在尝试自动获取全文（等同你点击下载，不会绕过权限校验）…');
          for (const l of tryUrls) {
            const r = await chrome.runtime.sendMessage({ type: 'lesp:sw-download', url: l.url });
            if (r && r.ok) {
              file = { name: 'fulltext.' + (r.format || 'pdf'), base64: r.base64 };
              fulltextStatus = 'downloaded';
              break;
            }
            lastErrPush(r && r.error);
          }
        }
        // 路径 A/B：真正打开下载页，让它自己跑起来并触发下载，我们再接住文件
        // （关键点：order 链接本身是 HTML 页面，直接 fetch/download 只会拿到那个网页）
        if (!downloadedPath && !file && orders.length) {
          setStatus('正在打开下载页并完成下载（等同你点击「PDF下载」，最多等待 90 秒）…');
          const d = await chrome.runtime.sendMessage({ type: 'lesp:open-capture', url: orders[0].url, timeoutMs: 90000 });
          if (d && d.ok && d.filename) {
            downloadedPath = d.filename;
            // 若下到的是网页（体积小或是 html），说明确实没权限，不当成全文
            const looksHtml = /html/i.test(d.mime || '') || (d.bytes && d.bytes < 20480 && /\.html?$/i.test(d.filename));
            if (looksHtml) {
              downloadedPath = '';
              lastErrPush('下载页只返回了网页而非文件（说明该篇无下载权限）');
            } else {
              fulltextStatus = 'downloaded_pending_import';   // 交给 App 校验并导入
            }
          } else {
            lastErrPush((d && (d.error || d.state)) || '下载页未触发下载');
          }
        }
        if (!links.length && !orders.length) {
          fulltextStatus = 'none';
          setStatus('页面上没有找到任何下载入口，将只同步元数据', 'warn');
        } else if (!file && !downloadedPath) {
          fulltextStatus = orderOnly ? 'need_document_delivery' : 'failed';
          setStatus('全文自动获取未成功：' + (lastErrs.join(' | ') || '未知原因')
            + '。若当前账号无权限，可换有权限的账号/校园网后重试；也可在 App 的「附件」页签手动上传。仍会同步元数据', 'warn');
        }
      } else if (orderOnly) {
        fulltextStatus = 'need_document_delivery';
      }

      const conf = await loadConf();
      const pong = await pingApp(conf.port);
      if (!pong.ok) { setStatus('同步失败：' + pong.error, 'err'); return; }
      if (pong.requireToken && !conf.token) {
        setStatus('App 要求口令，请展开下方设置填入（App 设置页可复制）', 'warn');
        return;
      }
      setStatus('正在同步到「辑微」…');
      // 把客户端失败原因一并交给服务端记日志——否则服务端日志只有“新建1”，看不出全文为什么没拿到
      const r = await pushToApp(conf.port, conf.token, [{
        exportApi: res.exportApi,
        pageUrl: res.pageUrl,
        detail: res.detail,
        fulltextLinks: res.fulltextLinks,
        file,
        downloadedPath,
        fulltextStatus,
        clientErrors: lastErrs
      }]);
      if (!r.ok) { setStatus('同步失败：' + (r.error || '未知错误'), 'err'); return; }
      const tail = [];
      if (r.created) tail.push('已新增 ' + r.created + ' 条');
      if (r.skipped) tail.push('跳过重复 ' + r.skipped + ' 条');
      if (fulltextStatus === 'downloaded') tail.push('全文 PDF 已存入附件');
      if (fulltextStatus === 'need_document_delivery') {
        tail.push('全文未获取到');
        // 把客户端的失败原因直接放进最终消息，不再被成功提示覆盖
        if (lastErrs.length) tail.push('原因：' + lastErrs.join('；'));
      }
      (r.warnings || []).slice(0, 2).forEach((w) => tail.push(w));
      setStatus('已同步到「辑微」：' + tail.join('；') + '。去 App 的「研究论文」刷新即可看到。', 'ok');
      return;
    }

    // withLinks：顺带把页面上的全文下载链接一起找出来（供“下载全文”使用）
    const opts = { wait: $('wait').checked, waitMs: 3000, withImages: $('images').checked, withLinks: true };
    const fmt = $('fmt').value;

    // 1) 先提取，拿到标题与统计信息（PDF 也需要标题来命名文件）
    const data = await chrome.runtime.sendMessage({ type: 'lesp:extract', tabId: tab.id, opts });
    if (!data) {
      setStatus('页面没有响应。请按顺序做：① 打开 chrome://extensions 点本扩展的「重新加载」② 回到目标网页按 F5 刷新 ③ 再点「抓取并下载」', 'err');
      return;
    }
    if (data.ok === false) {
      setStatus('抓取失败：' + (data.error || '页面没有返回内容'), 'err');
      return;
    }
    if (!data.stats || data.stats.chars === 0) {
      setStatus('这个页面没有找到可读的正文内容。可能原因：内容由脚本动态生成（可勾选“等待动态内容”）、或正文在 iframe / PDF 里。', 'warn');
      return;
    }

    // 显示抓取概况
    const m = $('meta');
    m.hidden = false;
    m.innerHTML = `<b>${escapeHtml(data.meta.title)}</b><br>`
      + `字数 ${data.stats.chars} · 段落 ${data.stats.paragraphs} · 标题 ${data.stats.headings} · 图片 ${data.stats.images}`
      + (data.warnings && data.warnings.length ? `<br><span class="warn">${data.warnings.map(escapeHtml).join('<br>')}</span>` : '');

    const base = safeName($('name').value || data.meta.title, '正文');
    const saveAs = $('saveAs').checked;

    // ---------- 全文下载（需要页面里有可下直链，且已登录有权限） ----------
    let file = null;          // 送给 App 的全文
    let fulltextStatus = 'none';
    if ($('fulltext').checked) {
      const links = (data.links || []).filter((l) => !l.isOrderFlow);
      if (!links.length) {
        const orders = (data.links || []).filter((l) => l.isOrderFlow);
        setStatus(orders.length
          ? '这篇只能走“文献传递/付费”，网页上没有可下载的直链，已跳过全文'
          : '页面上没有找到下载链接', 'warn');
        fulltextStatus = orders.length ? 'need_document_delivery' : 'none';
      } else {
        setStatus(`发现 ${links.length} 个候选链接，正在尝试下载…`);
        let lastErr = '';
        for (const l of links) {
          const r = await chrome.tabs.sendMessage(tab.id, { type: 'lesp:do-download', url: l.url });
          if (r && r.ok) {
            file = { name: `${base}.pdf`, base64: r.base64 };
            fulltextStatus = 'downloaded';
            break;
          }
          lastErr = (r && r.error) || '未知原因';
        }
        if (!file) {
          fulltextStatus = 'failed';
          setStatus('全文下载失败：' + lastErr, 'warn');
        }
      }
    }

    // ---------- 同步到「辑微」App ----------
    if ($('sync').checked) {
      const { port, token } = await loadConf();
      const pong = await pingApp(port);
      if (!pong.ok) {
        setStatus('同步失败：' + pong.error, 'err');
        return;
      }
      if (pong.requireToken && !token) {
        setStatus('App 要求口令，但扩展里还没填。请展开下方「连接辑微 App 的设置」填入口令。', 'warn');
        return;
      }
      setStatus('正在同步到「辑微」…');
      const item = toAppItem(data);
      item.file = file;
      item.fulltextStatus = fulltextStatus;
      const r = await pushToApp(port, token, [item]);
      if (!r.ok) {
        setStatus('同步失败：' + (r.error || '未知错误'), 'err');
        return;
      }
      const tail = [];
      if (r.created) tail.push(`已新增 ${r.created} 条`);
      if (r.skipped) tail.push(`跳过重复 ${r.skipped} 条`);
      if (r.failed) tail.push(`失败 ${r.failed} 条`);
      if (fulltextStatus === 'downloaded') tail.push('全文已存入附件');
      if (fulltextStatus === 'need_document_delivery') tail.push('全文需文献传递，仅存元数据');
      (r.warnings || []).slice(0, 2).forEach((w) => tail.push(w));
      setStatus('已同步到「辑微」：' + tail.join('；') + '。去 App 的「研究论文」刷新即可看到。', 'ok');
      return; // 同步成功就不再重复走本地下载
    }

    if (fmt === 'pdf') {
      setStatus('正在生成 PDF…');
      const granted = await ensureDebuggerPermission();
      if (!granted) {
        setStatus('未授权调试通道，已取消。PDF 导出需要它，你也可以改选 HTML/Markdown/TXT。', 'warn');
        return;
      }
      const r = await chrome.runtime.sendMessage({ type: 'lesp:pdf', tabId: tab.id, opts: {} });
      if (!r || !r.ok) throw new Error((r && r.error) || 'PDF 生成失败');
      await saveBlob(base64ToBlob(r.base64, 'application/pdf'), `${base}_${stamp()}.pdf`, saveAs);
      setStatus('已完成：PDF 已下载', 'ok');
      return;
    }

    if (fmt === 'html') {
      await saveBlob(new Blob([data.html], { type: 'text/html;charset=utf-8' }), `${base}_${stamp()}.html`, saveAs);
    } else if (fmt === 'md') {
      await saveBlob(new Blob([data.markdown], { type: 'text/markdown;charset=utf-8' }), `${base}_${stamp()}.md`, saveAs);
    } else {
      await saveBlob(new Blob([data.text], { type: 'text/plain;charset=utf-8' }), `${base}_${stamp()}.txt`, saveAs);
    }
    setStatus('已完成：文件已下载', 'ok');
  } catch (e) {
    setStatus('失败：' + (e && e.message ? e.message : e), 'err');
  } finally {
    btn.disabled = false;
  }
});

// ---------- 设置区：端口、口令、测试连接 ----------
(async function initConf() {
  const { port, token } = await loadConf();
  $('port').value = port;
  $('token').value = token;
  $('port').addEventListener('change', async () => { await saveConf(Number($('port').value) || DEFAULT_PORT, $('token').value); });
  $('token').addEventListener('change', async () => { await saveConf(Number($('port').value) || DEFAULT_PORT, $('token').value); });
  $('ping').addEventListener('click', async () => {
    const p = Number($('port').value) || DEFAULT_PORT;
    $('pingMsg').textContent = '正在测试…';
    const r = await pingApp(p);
    $('pingMsg').textContent = r.ok
      ? `已连上「${r.app}」${r.requireToken ? '（需要口令）' : '（未要求口令）'}`
      : (r.error || '连接失败');
  });
})();

// 诊断：把页面上的候选下载链接与实测结果导出，便于排查“手动能下、插件下不到”
$('diag').addEventListener('click', async () => {
  $('pingMsg').textContent = '正在诊断（会逐个尝试候选链接）…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let rep;
    try {
      rep = await chrome.tabs.sendMessage(tab.id, { type: 'lesp:diagnose-download' });
    } catch (e) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      rep = await chrome.tabs.sendMessage(tab.id, { type: 'lesp:diagnose-download' });
    }
    const text = JSON.stringify(rep, null, 2);
    try { await navigator.clipboard.writeText(text); $('pingMsg').textContent = '报告已复制到剪贴板，请粘贴给开发者。'; }
    catch (e) { $('pingMsg').textContent = '复制失败，请打开控制台查看（已打印）。'; }
    console.log(text);
  } catch (e) {
    $('pingMsg').textContent = '诊断失败：' + (e && e.message || e);
  }
});

// 取证：真的让浏览器下载一次，用“是否拿到真实文件”来判定权限，
// 避免仅凭链接形态（order）就误判为无权限。只消耗一次下载额度，等同手动点一次。
$('probe').addEventListener('click', async () => {
  $('pingMsg').textContent = '正在让浏览器真实下载一次（文件会存到 下载\\LESP附件）…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let rep;
    try {
      rep = await chrome.tabs.sendMessage(tab.id, { type: 'lesp:diagnose-download' });
    } catch (e) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      rep = await chrome.tabs.sendMessage(tab.id, { type: 'lesp:diagnose-download' });
    }
    const orders = (rep && rep.candidates || []).filter((c) => c.isOrderFlow);
    const directs = (rep && rep.candidates || []).filter((c) => !c.isOrderFlow && /download|pdf|caj/i.test(c.url));
    const target = (directs[0] || orders[0] || {}).url;
    if (!target) { $('pingMsg').textContent = '页面上没找到任何下载入口'; return; }

    const r = await chrome.runtime.sendMessage({ type: 'lesp:probe-download', url: target });
    const report = {
      pageUrl: rep && rep.pageUrl,
      triedUrl: String(target).slice(0, 160),
      result: r
    };
    const text = JSON.stringify(report, null, 2);
    try { await navigator.clipboard.writeText(text); $('pingMsg').textContent = '取证完成，报告已复制到剪贴板，请粘贴给开发者。'; }
    catch (e2) { $('pingMsg').textContent = '取证完成（见下方控制台输出）。'; }
    console.log(text);
    if (r && r.ok) {
      setStatus(`取证结果：浏览器成功下载了 ${Math.round((r.bytes || 0) / 1024)} KB 的文件 → 说明你有权限，之前是工具取内容的方式不对（已在新版修复）`, 'ok');
    } else {
      setStatus('取证结果：浏览器未能下载（' + ((r && (r.error || r.state)) || '未知') + '）→ 这篇确实没有下载权限', 'warn');
    }
  } catch (e) {
    $('pingMsg').textContent = '取证失败：' + (e && e.message || e);
  }
});

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
