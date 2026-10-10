// 回收站页：展示 data/files/_trash 中的文件，支持还原 / 彻底删除
const { esc } = require('../lib/render');

function renderTrashPage() {
  return `<div class="crumb"><a href="/">首页总览</a><span class="muted-3">·</span>回收站</div>
  <div class="detail-head">
    <div><h2 class="detail-title serif">回收站</h2>
    <div class="page-sub">被删除的附件暂存于 data\\files\\_trash，可还原或彻底清除</div></div>
  </div>
  <div class="trash-actions">
    <button id="trash-refresh">刷新</button>
    <span class="muted-3">还原会把文件放回附件库；若能按文件名前缀识别原条目，会自动重新挂为该条目的附件。</span>
  </div>
  <div id="trash-list" class="trash-list"><div class="empty">加载中…</div></div>
  <script>
  // 内联脚本不依赖 common.js 的 api()/esc()（它们此时可能尚未加载）：
  // 用原生 fetch + 本地转义，点击处理器里的 toast/confirmBox 在点击时才用到，那时早已加载完成。
  (function () {
    const \$ = (id) => document.getElementById(id);
    const escJs = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    function human(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
    async function call(url, options) {
      const res = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}));
      const text = await res.text();
      try { return JSON.parse(text); } catch (e) { throw new Error('返回异常：' + text.slice(0, 120)); }
    }
    async function load() {
      const box = \$('trash-list');
      try {
        const r = await call('/api/trash');
        if (!r.files.length) { box.innerHTML = '<div class="empty">回收站是空的</div>'; return; }
        box.innerHTML = r.files.map((f) => '<div class="trash-row" data-name="' + escJs(f.name) + '">'
          + '<div class="trash-name">' + escJs(f.name) + '</div>'
          + '<div class="muted-3">' + human(f.size) + ' · 删除于 ' + escJs(new Date(f.deletedAt).toLocaleString('zh-CN')) + '</div>'
          + '<div class="trash-ops"><button data-act="restore">还原</button><button data-act="purge">彻底删除</button></div>'
          + '</div>').join('');
      } catch (e) { box.innerHTML = '<div class="empty">读取失败：' + escJs(e.message) + '</div>'; }
    }
    \$('trash-refresh').onclick = load;
    \$('trash-list').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const name = btn.closest('.trash-row').dataset.name;
      if (btn.dataset.act === 'restore') {
        try { await call('/api/trash/restore', { method: 'POST', body: JSON.stringify({ name }) }); if (window.toast) toast('已还原'); load(); }
        catch (err) { if (window.toast) toast(err.message); }
      } else {
        if (!window.confirmBox || !confirmBox('彻底删除后无法恢复，确定？')) return;
        try { await call('/api/trash/' + encodeURIComponent(name), { method: 'DELETE' }); if (window.toast) toast('已彻底删除'); load(); }
        catch (err) { if (window.toast) toast(err.message); }
      }
    });
    load();
  })();
  </script>`;
}

module.exports = { renderTrashPage };
