// V5 右栏详情面板：点列表条目时右栏局部加载，不再整页跳转 ——
// 分类树、检索条件、滚动位置都留在原处。
// 与「拖拽归类」共存：拖拽刚结束的那次点击由 item-drag.js 在捕获阶段 stopPropagation，
// 本脚本的冒泡监听收不到，因此不会误触发加载。
// V5.3 收尾：「收起详情栏 / 详情栏 / 完整页面」入口已移除，
// 折叠状态（原先存于浏览器本地）与相关代码一并删除 ——
// 没有入口却留着状态，刷新后会莫名其妙隐藏右栏。
(function () {
  const col = document.getElementById('three-col');
  const detail = document.getElementById('detail');
  if (!col || !detail) return;

  /**
   * 右栏片段里的 tab 切换。整页加载时由各页脚本绑定，局部插入后需重新绑一次。
   * 重操作（录文增删、附件、批量编辑）在条目完整页完成，此处不重复实现，避免两套逻辑分叉。
   */
  function rebind() {
    detail.querySelectorAll('.tabs .tab').forEach((tab) => {
      tab.onclick = () => {
        detail.querySelectorAll('.tabs .tab').forEach((t) => t.classList.toggle('tab-on', t === tab));
        detail.querySelectorAll('.tabpane').forEach((p) => { p.hidden = p.id !== 'tab-' + tab.dataset.tab; });
      };
    });
  }
  rebind();

  /* ---------- 点条目 → 右栏加载（仅列表页有 .col-list） ---------- */
  const list = document.querySelector('.col-list');
  if (!list) return;
  let loading = false;

  async function loadPanel(id, link) {
    if (loading) return;
    loading = true;
    const qs = (link.getAttribute('href') || '').split('?')[1] || '';
    const url = '/api/items/' + id + '/panel' + (qs ? '?' + qs : '');
    try {
      const res = await fetch(url, { headers: { 'X-Requested-With': 'panel' } });
      const html = await res.text();
      detail.innerHTML = html;
      rebind();
      // V5.3：片段是 innerHTML 插入的，upload.js 等依赖自身元素的处理器
      // 在页面加载时就已经跑完了。这里重新触发绑定，右栏里的
      // 「上传附件」才会有反应。
      if (typeof window.__bindUpload === 'function') window.__bindUpload();
      detail.scrollTop = 0;
    } catch (e) {
      if (typeof toast === 'function') toast('加载详情失败：' + e.message);
    } finally {
      loading = false;
    }
  }

  /**
   * 让 item.js / upload.js 在保存后能就地刷新右栏，而不是整页跳回列表。
   * item.js 在编辑保存后会调用它。
   * 顺带把左栏列表里对应的标题同步掉，否则右栏已改名、列表还是旧名。
   */
  window.__rebindPanel = (id, patch) => {
    const link = document.querySelector('.col-list a.li[data-item-id="' + id + '"]');
    if (patch && patch.title && link) {
      const t = link.querySelector('.li-title');
      if (t) t.textContent = patch.title;
    }
    if (link) { loadPanel(id, link); return; }
    location.reload();          // 右栏里没有这个条目（如刚删掉），退回整页刷新
  };

  list.addEventListener('click', (e) => {
    const link = e.target.closest('a.li[data-item-id]');
    if (!link) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;   // 新标签打开照旧
    e.preventDefault();
    list.querySelectorAll('a.li').forEach((a) => a.classList.toggle('li-on', a === link));
    loadPanel(link.dataset.itemId, link);
    // 地址栏同步为该条目的完整页面（便于刷新/收藏）
    const full = link.getAttribute('href');
    if (full && history.replaceState) history.replaceState(null, '', full);
  });
})();
