// 本文件有多个并列的 IIFE（备份与恢复 / 扩展同步 / 分类迁移），
// 彼此要共用取元素helper。byId 必须挂在文件级作用域，
// 否则第三个 IIFE 里引用不到（此前就因它在第一个 IIFE 内而抛
// Uncaught ReferenceError: byId is not defined @ settings.js:160，
// 连带让「迁移分类数据」按钮整块失效）。
const byId = (id) => document.getElementById(id);

(function () {
  const backupBtn = byId('btn-backup');
  if (backupBtn) {
    backupBtn.addEventListener('click', async () => {
      backupBtn.disabled = true;
      backupBtn.textContent = '备份中…';
      try {
        if(window.desktopBridge&&!await desktopBridge.prepareAll())throw new Error('请先保存其他窗口内容');
        const r = await api('/api/backup/create', { method: 'POST', body: {} });
        toast('备份完成：' + r.itemCount + ' 条条目，' + r.attachmentCount + ' 个附件');
        location.reload();
      } catch (e) {
        toast(e.message);
        backupBtn.disabled = false;
        backupBtn.textContent = '立即备份';
      }
    });
  }

  const autoBtn = byId('btn-auto');
  if (autoBtn) {
    autoBtn.addEventListener('click', async () => {
      const enable = autoBtn.textContent.trim() === '开启';
      try {
        await api('/api/settings/auto-backup', { method: 'POST', body: { enabled: enable } });
        toast(enable ? '已开启自动备份' : '已关闭自动备份');
        location.reload();
      } catch (e) { toast(e.message); }
    });
  }

  // V5.3 收尾：「知网登录态」卡片已移除（初版遗留、已废弃），
  // 对应的保存/清除按钮不再存在，这段绑定一并删除。
  // settings 表里的 cnki_cookie / cnki_cookie_updated_at 数据保持不动。

  const moveBtn = byId('btn-move');
  if (moveBtn) {
    moveBtn.addEventListener('click', async () => {
      const dir = byId('new-dir').value.trim();
      if (!dir) return toast('请输入目录路径');
      if (!confirmBox('将把现有数据复制到 ' + dir + ' 并切换过去，确认？')) return;
      try {
        if(window.desktopBridge&&!await desktopBridge.prepareAll())throw new Error('请先保存其他窗口内容');
        const r = await api('/api/settings/data-dir', { method: 'POST', body: { data_dir: dir } });
        toast('已切换到 ' + r.dataDir);
        location.reload();
      } catch (e) { toast(e.message); }
    });
  }

  const addField = byId('btn-add-field');
  if (addField) {
    addField.addEventListener('click', async () => {
      const module = byId('field-module').value;
      const key = byId('field-key').value.trim();
      const label = byId('field-label').value.trim();
      if (!key || !label) return toast('字段标识与名称必填');
      try {
        await api('/api/settings/fields', { method: 'POST', body: { module, key, label } });
        toast('已添加');
        location.reload();
      } catch (e) { toast(e.message); }
    });
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!btn) return;
    const act = btn.dataset.act;
    const file = btn.dataset.file;
    if (act === 'restore') {
      if (!confirmBox('恢复会覆盖当前全部数据（恢复前会自动做一份 pre-restore 备份），确认继续？')) return;
      try {
        if(window.desktopBridge&&!await desktopBridge.prepareAll())throw new Error('请先保存其他窗口内容');
        const r = await api('/api/backup/restore', { method: 'POST', body: { file } });
        toast('已恢复：' + r.itemCount + ' 条条目，' + r.attachmentCount + ' 个附件');
        location.reload();
      } catch (err) { toast(err.message); }
    } else if (act === 'delbackup') {
      if (!confirmBox('删除该备份？')) return;
      try {
        await api('/api/backup/' + encodeURIComponent(file), { method: 'DELETE' });
        location.reload();
      } catch (err) { toast(err.message); }
    }
  });
})();

// ---------- 浏览器扩展同步卡片 ----------
// 放在外部脚本里（不用内联脚本），避免打包后内联脚本不执行导致一直显示“读取中…”。
(function () {
  const $ = byId;   // 复用文件级的 byId，不再重复定义一份取元素函数
  if (!$('sync-port')) return;                 // 不在设置页就什么都不做

  async function call(url, options) {
    const res = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}));
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { throw new Error('返回不是 JSON：' + text.slice(0, 120)); }
  }

  async function loadSyncInfo() {
    try {
      const info = await call('/api/cnki/sync/info');
      $('sync-port').textContent = String(info.port || 8791);
      $('sync-token').textContent = info.token || '（未生成，点右侧按钮生成）';
    } catch (e) {
      $('sync-port').textContent = '读取失败：' + e.message;
      $('sync-token').textContent = '读取失败';
    }
  }

  loadSyncInfo();

  $('btn-new-token').addEventListener('click', async () => {
    try {
      const r = await call('/api/cnki/sync/token/refresh', { method: 'POST', body: '{}' });
      $('sync-token').textContent = r.token || '生成失败';
    } catch (e) {
      $('sync-token').textContent = '生成失败：' + e.message;
    }
  });

  $('btn-sync-log').addEventListener('click', async () => {
    const el = $('sync-log');
    if (el.style.display === 'block') { el.style.display = 'none'; return; }
    try {
      const r = await call('/api/cnki/sync/log?lines=60');
      el.textContent = (r.lines || []).join('\n') || '（暂无日志）';
    } catch (e) {
      el.textContent = '读取日志失败：' + e.message;
    }
    el.style.display = 'block';
  });
})();

// 分类数据迁移（录文分类全局化）：手动触发，幂等
(function () {
  const btn = byId('btn-classify-migrate');
  const state = byId('classify-state');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const info = await api('/api/settings/classification-migration');
    if (info.migrated) { toast('分类数据已迁移过'); return; }
    const msg = '将把录文分类升级为全局分类树：\n'
      + '· 录文分类 ' + info.folders + ' 个（其中 ' + info.scoped + ' 个当前按史料隔离）\n'
      + '· 已有归类关系 ' + info.links + ' 条将全部保留\n'
      + (info.sameNameClash ? '· 有 ' + info.sameNameClash + ' 组同级重名，将自动改名\n' : '')
      + '\n迁移前会自动备份。确定继续？';
    if (!confirmBox(msg)) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '迁移中…';
    try {
      const r = await api('/api/settings/classification-migration', { method: 'POST', body: {} });
      if (r.skipped) { toast(r.message || '无需迁移'); return; }
      let msg2 = '迁移完成：' + r.folders + ' 个录文分类已全局化，保留 ' + r.links + ' 条归类关系';
      if (r.renamed_total) msg2 += '；自动改名 ' + r.renamed_total + ' 个重名分类';
      toast(msg2);
      if (state) state.textContent = '已迁移';
      btn.textContent = '已迁移';
    } catch (e) {
      toast('迁移失败：' + e.message);
      btn.disabled = false;
      btn.textContent = original;
    }
  });
})();
