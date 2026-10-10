(function () {
  const box = document.getElementById('cnki-box');
  if (!box) return;

  let results = [];

  async function loadStatus() {
    try {
      const s = await api('/api/cnki/status');
      document.getElementById('cnki-status').textContent =
        s.hasCookie ? ('登录态有效（更新于 ' + (s.updatedAt || '未知') + '）') : '未配置登录态，请到设置页更新';
    } catch (e) { /* 忽略 */ }
  }
  loadStatus();

  document.getElementById('cnki-toggle').addEventListener('click', () => {
    const b = document.getElementById('cnki-body');
    b.hidden = !b.hidden;
    document.getElementById('cnki-toggle').textContent = b.hidden ? '展开' : '收起';
  });

  function render() {
    const wrap = document.getElementById('cnki-results');
    if (!results.length) {
      wrap.innerHTML = '<div class="empty">暂无结果</div>';
      return;
    }
    wrap.innerHTML = results.map((r, i) => `<div class="cnki-item${r.imported ? ' cnki-imported' : ''}">
      <label>
        <input type="checkbox" data-i="${i}"${r.imported ? ' disabled' : ''}${r.imported ? '' : ' checked'}>
        <span class="ci-title">${esc(r.title)}</span>
      </label>
      <div class="ci-meta">${esc(r.authors)} · ${esc(r.journal)} · ${esc(r.year_volume)}${r.imported ? ' · 已入库' : ''}</div>
    </div>`).join('');
    document.getElementById('cnki-count').textContent =
      '共 ' + results.length + ' 条，已入库 ' + results.filter((r) => r.imported).length + ' 条';
  }

  document.getElementById('cnki-search').addEventListener('click', async () => {
    const kw = document.getElementById('cnki-kw').value.trim();
    if (!kw) return toast('请输入关键词');
    const btn = document.getElementById('cnki-search');
    btn.disabled = true;
    btn.textContent = '检索中…';
    try {
      const r = await api('/api/cnki/search', {
        method: 'POST',
        body: {
          keyword: kw,
          author: document.getElementById('cnki-author').value.trim(),
          journal: document.getElementById('cnki-journal').value.trim()
        }
      });
      results = r.results;
      render();
    } catch (e) {
      toast(e.message);
      results = [];
      render();
    } finally {
      btn.disabled = false;
      btn.textContent = '检索';
    }
  });

  document.getElementById('cnki-import').addEventListener('click', async () => {
    const picked = [];
    document.querySelectorAll('#cnki-results input[type=checkbox]').forEach((c) => {
      if (c.checked && !c.disabled) picked.push(results[Number(c.dataset.i)]);
    });
    if (!picked.length) return toast('请勾选要导入的文献');
    try {
      const r = await api('/api/cnki/import', { method: 'POST', body: { items: picked } });
      toast('已导入 ' + r.created + ' 条' + (r.skipped ? '，跳过重复 ' + r.skipped + ' 条' : ''));
      location.reload();
    } catch (e) { toast(e.message); }
  });

  // 粘贴导入：把侦察脚本/书签得到的 JSON 直接粘进来入库
  const pasteInput = document.getElementById('cnki-paste-input');
  const pasteMsg = document.getElementById('cnki-paste-msg');
  const pasteBtn = document.getElementById('cnki-paste-go');
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      const raw = String(pasteInput.value || '').trim();
      if (!raw) return toast('请先粘贴 JSON');
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (e) {
        pasteMsg.textContent = '不是合法 JSON，请重新复制';
        return;
      }
      pasteBtn.disabled = true;
      pasteMsg.textContent = '正在导入…';
      try {
        const r = await api('/api/cnki/ingest', { method: 'POST', body: payload });
        if (r.risk) {
          pasteMsg.textContent = r.message || '知网风控，已停止';
          return;
        }
        const warns = (r.warnings || []).slice(0, 3).join('；');
        pasteMsg.textContent = '已导入 ' + r.created + ' 条'
          + (r.skipped ? '，跳过重复 ' + r.skipped + ' 条' : '')
          + (warns ? '。提示：' + warns : '');
        pasteInput.value = '';
        setTimeout(() => location.reload(), 1200);
      } catch (e) {
        pasteMsg.textContent = '导入失败：' + e.message;
      } finally {
        pasteBtn.disabled = false;
      }
    });
  }
})();
