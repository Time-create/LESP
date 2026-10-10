(function () {
  const module = window.__MODULE__;
  const route = window.__ROUTE__;
  const qs = window.__QS__ || '';
  const schema = window.__SCHEMA__ || [];

  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  let editingId = null;

  function openModal(mode, item) {
    editingId = mode === 'edit' ? item.id : null;
    modalTitle.textContent = mode === 'edit' ? '编辑条目' : '新建条目';
    document.getElementById('f-title').value = item ? item.title : '';
    document.getElementById('f-subtitle').value = item ? (item.subtitle || '') : '';
    for (const f of schema) {
      const el = document.getElementById('f-' + f.key);
      if (el) el.value = item && item.fields ? (item.fields[f.key] || '') : '';
    }
    const st = document.getElementById('f-status');
    if (st && item && item.status) st.value = item.status;
    document.getElementById('f-collections').value = item && item.collections ? item.collections.join(',') : '';
    document.getElementById('f-tags').value = item && item.tags ? item.tags.join(',') : '';
    modal.hidden = false;
  }

  function closeModal() {
    modal.hidden = true;
  }

  function split(v) {
    return String(v || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  }

  async function save() {
    const title = document.getElementById('f-title').value.trim();
    if (!title) return toast('标题必填');
    const fields = {};
    for (const f of schema) {
      const el = document.getElementById('f-' + f.key);
      if (!el) continue;
      let v = el.value;
      if (f.type === 'number' && v !== '') v = Number(v);
      fields[f.key] = v;
      if (f.required && String(v).trim() === '') return toast(f.label + '必填');
    }
    const payload = {
      module,
      title,
      subtitle: document.getElementById('f-subtitle').value.trim(),
      status: document.getElementById('f-status') ? document.getElementById('f-status').value : '',
      fields,
      collections: split(document.getElementById('f-collections').value),
      tags: split(document.getElementById('f-tags').value)
    };
    try {
      if (editingId) {
        await api('/api/items/' + editingId, { method: 'PUT', body: payload });
        toast('已保存');
        // 在右栏局部编辑时整页刷新会跳回列表；优先让右栏自己重载片段，
        // 列表页与详情页都因此保持在原上下文里。
        if (window.__rebindPanel) {
          closeModal();                     // 右栏局部编辑：关掉弹窗并就地刷新片段
          window.__rebindPanel(editingId, { title });
        } else location.reload();
      } else {
        const created = await api('/api/items', { method: 'POST', body: payload });
        toast('已创建');
        location.href = route + '/' + created.id + qs;
      }
    } catch (e) {
      toast(e.message);
    }
  }

  // 关闭弹窗的三条退路：关闭/取消按钮、Esc 键、点击遮罩空白处
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  // 事件委托：e.target 可能是按钮内的文字节点（没有 id/dataset），
  // 直接读e.target.id 会取不到值 → 「编辑」点了没反应。
  // 统一用 closest 从元素本身往上找，行为与其它按钮一致。
  const hit = (e, id) => {
    const el = e.target instanceof Element ? e.target : (e.target && e.target.parentElement);
    return !!(el && el.closest && el.closest('#' + id));
  };

  /**
   * 解析「当前操作的条目」。
   * V5.3 修复：列表页右栏是 innerHTML 局部插入的片段，window.__ITEM__ 恒为 null，
   * 导致右栏里的「编辑」点了没反应。片段根节点上带了 data-panel-item（见 renderPanel），
   * 这里按「就近优先」取：先看 window.__ITEM__，没有就读片段上的数据。
   */
  const resolveItem = () => {
    if (window.__ITEM__) return window.__ITEM__;
    const scope = document.querySelector('#detail .panel-item-scope[data-panel-item]')
      || document.querySelector('.panel-item-scope[data-panel-item]');
    if (!scope) return null;
    try { return JSON.parse(scope.dataset.panelItem); } catch (err) { return null; }
  };

  document.addEventListener('click', (e) => {
    if (hit(e, 'btn-new-top') || hit(e, 'btn-new')) openModal('new', null);
    if (hit(e, 'btn-edit')) {
      const item = resolveItem();
      if (item) openModal('edit', item);
      else toast('未能读取条目信息，请刷新后重试');
    }
    if (hit(e, 'btn-del')) {
      const btn = e.target.closest ? e.target.closest('#btn-del') : null;
      const id = (btn || e.target).dataset.id;
      if (confirmBox('删除后该条目的摘录会被移除，已被长编引用的正文保留但脚注标灰。确认删除？')) {
        api('/api/items/' + id, { method: 'DELETE' })
          .then(() => { toast('已删除'); location.href = route + qs; })
          .catch((err) => toast(err.message));
      }
    }
    if (hit(e, 'modal-close') || hit(e, 'modal-cancel')) closeModal();
    if (hit(e, 'modal-save')) save();

    // 删除单个附件：二次确认 → 服务端清理文件与记录 → 自动刷新附件列表
    const delBtn = e.target.closest ? e.target.closest('[data-att-delete]') : null;
    if (delBtn) {
      const attId = Number(delBtn.dataset.attDelete);
      const card = delBtn.closest('[data-att]');
      const name = card ? (card.querySelector('.att-name') || {}).textContent : '';
      if (confirmBox(`删除附件「${(name || '').trim() || '该附件'}」？\n文件会移入回收站，引用它的批注将标记为“附件已删除”。确认删除？`)) {
        api('/api/attachments/' + attId, { method: 'DELETE' })
          .then(() => { toast('附件已删除'); location.reload(); })
          .catch((err) => toast(err.message));
      }
    }

    const tab = e.target.closest ? e.target.closest('.tab') : null;
    if (tab) {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('tab-on'));
      tab.classList.add('tab-on');
      document.querySelectorAll('.tabpane').forEach((p) => { p.hidden = true; });
      const pane = document.getElementById('tab-' + tab.dataset.tab);
      if (pane) pane.hidden = false;
    }
  });
})();
