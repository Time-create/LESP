// 条目附件上传：点「上传附件」→ 弹出系统文件选择框 → 选完立即上传 → 回显列表。
//
// V5.3 修复一：此前按钮点击后不打开文件框，只检查旁边那个原生 file input 里有没有文件，
// 没选就只弹个「请先选择文件」的提示 —— 表现为「按钮点了没反应」。
// 该缺陷自初版即存在（历次打包版均无 input.click()）。
//
// V5.3 修复二：列表页右栏是 innerHTML 局部插入的，而本脚本在页面加载时就跑完了，
// 那时 #btn-upload 还不存在 → 直接 return，之后按钮永远没有处理器。
// 现在改为可重复调用：detail-panel.js 每次插入片段后调用 window.__bindUpload()。
(function () {
  const toastSafe = (msg) => {
    if (typeof toast === 'function') toast(msg);
    else console.warn('[upload]', msg);
  };

  async function upload(item, file) {
    const input = document.getElementById('att-file');
    const btn = document.getElementById('btn-upload');
    if (!input || !btn) return;
    const form = new FormData();
    form.append('file', file);
    btn.disabled = true;
    btn.textContent = '上传中…';
    try {
      const res = await fetch('/api/attachments/upload?item_id=' + item.id, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');
      toastSafe('已上传：' + data.filename);
      // 完整页刷新即可回显；右栏局部视图重载片段，避免跳回列表
      if (typeof window.__rebindPanel === 'function') window.__rebindPanel(item.id);
      else location.reload();
    } catch (e) {
      toastSafe(e.message);
      btn.disabled = false;
      btn.textContent = '上传附件';
    }
  }

  function bind() {
    const input = document.getElementById('att-file');
    const btn = document.getElementById('btn-upload');
    if (!input || !btn || btn.dataset.bound === '1') return;

    // 条目来源：完整页取 window.__ITEM__，右栏片段从 data-panel-item 读（与 item.js 同策略）
    const scope = document.querySelector('#detail .panel-item-scope[data-panel-item]')
      || document.querySelector('.panel-item-scope[data-panel-item]');
    let item = window.__ITEM__ || null;
    if (!item && scope) {
      try { item = JSON.parse(scope.dataset.panelItem); } catch (e) { item = null; }
    }
    if (!item) return;               // 还没有条目上下文，等片段插入后再调bind()

    // 原生控件由按钮代为触发，视觉上隐藏但留在DOM 里（change 监听仍挂它）
    input.hidden = true;
    input.style.display = 'none';
    btn.dataset.bound = '1';

    btn.addEventListener('click', () => {
      // 每次点击都重新绑定，确保上一轮的文件不会被重复提交
      input.onchange = () => {
        const f = input.files && input.files[0];
        input.value = '';             // 清空，允许再次选同一个文件
        if (f) upload(item, f);
        else { btn.disabled = false; btn.textContent = '上传附件'; }
      };
      input.click();                  // 弹出系统文件选择框
    });
  }

  window.__bindUpload = bind;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
