// 史学论文前端：列表页的「新建论文」+ 详情页的元信息编辑
// 正文编辑由 /static/dist/editor.js 处理（与长编共用），本脚本只管列表与元信息。
(function () {
  const API = '/api/history-papers';

  // ---- 列表页：新建 ----
  const newBtn = document.getElementById('btn-new-paper');
  if (newBtn) {
    newBtn.addEventListener('click', async () => {
      try {
        const created = await api(API, { method: 'POST', body: { title: '未命名史学论文' } });
        location.href = '/writing/history-papers/' + created.id;
      } catch (e) {
        toast('新建失败：' + e.message);
      }
    });
    return;                                   // 列表页没有别的绑定
  }

  // ---- 详情页：标题 / 状态 / 所属项目 ----
  const meta = document.getElementById('paper-meta');
  if (!meta) return;
  const id = Number(meta.dataset.id);
  const titleEl = document.getElementById('paper-title');
  const statusEl = document.getElementById('paper-status');
  const projectEl = document.getElementById('paper-project');

  const save = async (patch) => {
    try {
      await api(API + '/' + id, { method: 'PUT', body: patch });
    } catch (e) {
      toast('保存失败：' + e.message);
    }
  };

  if (titleEl) {
    titleEl.addEventListener('change', async () => {
      const title = titleEl.value.trim();
      if (!title) { toast('标题不能为空'); return; }
      await save({ title });
      const h1 = document.querySelector('.page-title');
      if (h1) h1.textContent = title;
    });
  }
  if (statusEl) statusEl.addEventListener('change', () => save({ status: statusEl.value }));
  if (projectEl) projectEl.addEventListener('change', () => save({ project: projectEl.value }));
})();
