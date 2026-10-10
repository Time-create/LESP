// 录文分类树（详情页内）：逐级折叠 + 点击分类筛选本条目录文
(function () {
  const root = document.querySelector('.excerpt-tree');
  if (!root) return;
  const KEY = 'collapsed-excerpt-folders';
  const collapsed = (() => {
    try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]').map(String)); } catch (e) { return new Set(); }
  })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...collapsed])); } catch (e) { /* 忽略 */ } };

  const kidsOf = (id) => root.querySelector('.tree-node[data-id="' + id + '"] > .tree-kids');
  const btnOf = (id) => root.querySelector('[data-toggle="' + id + '"]');

  function setCollapsed(id, collapsedNow) {
    const kids = kidsOf(id), btn = btnOf(id);
    if (!kids || !btn) return;
    kids.hidden = collapsedNow;
    btn.textContent = collapsedNow ? '▸' : '▾';
    if (collapsedNow) collapsed.add(String(id)); else collapsed.delete(String(id));
    save();
  }
  for (const id of collapsed) setCollapsed(id, true);

  root.addEventListener('click', async (e) => {
   // e.target 可能是文本节点（无 closest），直接调用会抛 TypeError；
   // 在 async 监听器里抛错不会中断脚本，表现为「点了没反应」。
   // 统一兜到 Element，并整体 try/catch 把失败暴露出来。
   try {
    const el = e.target instanceof Element ? e.target : (e.target && e.target.parentElement);
    if (!el || !el.closest) return;
    const toggle = el.closest('[data-toggle]');
    if (toggle) {
      const kids = kidsOf(toggle.dataset.toggle);
      setCollapsed(toggle.dataset.toggle, !kids.hidden);   // 取反才是切换
      return;
    }
    const filter = el.closest('[data-folder-filter]');
    if (!filter) return;
    const id = filter.dataset.folderFilter;
    // 含子分类：客户端取该节点及其后代的录文
    const cards = [...document.querySelectorAll('[data-excerpt-card]')];
    const res = await api('/api/excerpts?item_id=' + window.__ITEM_ID__ + '&folder_id=' + id);
    const match = new Set(res.map((r) => r.id));
    cards.forEach((c) => { c.hidden = !match.has(Number(c.dataset.excerptCard)); });
    root.querySelectorAll('[data-folder-filter]').forEach((b) => b.classList.toggle('tree-on', b === filter));
   } catch (err) {
    console.error('录文分类树点击失败：', err);
    toast('筛选失败：' + (err && err.message ? err.message : err));
   }
  });

  // 「新建录文分类」按钮不在这里绑定。
  // 它的 data-excerpt-action="folders" 由全局的 excerpts.js 统一处理（走 manageTaxonomy），
  // 本脚本此前又用 onclick 绑了一遍，两边都响应 → 一次点击弹出两个对话框。
  // 单一职责：录文分类的增删改查统一由 classify-actions.js 提供，本脚本只管树的交互与右键菜单。
  const manage = document.getElementById('btn-manage-folders');
  if (manage) {
    manage.onclick = () => {
      if (typeof window.openClassifyManager !== 'function') return toast('分类管理面板未加载，请刷新页面');
      window.openClassifyManager('folder');
    };
  }

  // —— 归类本条目 ——
  // 此前分类只能「筛选」，没有任何入口能把本条目的录文归入分类，
  // 用户点分类看到的是空列表，表现为「分类无效」。
  // 录文分类实际挂在单条录文上，这里一次把本条目全部录文对齐到所选分类。
  const assignBtn = document.getElementById('btn-assign-folders');
  if (assignBtn) {
    assignBtn.onclick = async () => {
     try {
      const itemId = Number(window.__ITEM_ID__ || 0);
      if (!itemId) return toast('条目信息缺失，请刷新页面');
      let rows = [];
      let current = [];
      try {
        const [tree, mine] = await Promise.all([
          api('/api/excerpt-folders?tree=1'),
          api('/api/excerpt-folders/by-item/' + itemId)
        ]);
        rows = tree || [];
        current = (mine || []).map(Number);
      } catch (e) {
        return toast('读取录文分类失败：' + e.message);
      }
      if (!rows.length) return toast('还没有录文分类，先点「新建录文分类」创建');
      const sel = new Set(current);
      // 缩进显示层级，勾选项为「本条目当前已归入」的分类
      const options = [];
      const walk = (nodes, depth) => nodes.forEach((n) => {
        options.push({ value: String(n.id), label: '　'.repeat(depth) + (depth ? '└ ' : '') + n.name });
        walk(n.children || [], depth + 1);
      });
      walk(rows, 0);
      const total = await (async () => {
        try { return (await api('/api/excerpts?item_id=' + itemId)).length; } catch (e) { return 0; }
      })();
      if (!total) toast('本条目还没有录文：现在勾选的分类会在你新增录文后自动套用');
      openForm({
        title: '归类本条目（' + (total ? total + ' 条录文' : '暂无录文') + '）',
        submitLabel: '保存归类',
        fields: [{
          name: 'folderIds', label: '本条目的录文归入哪些分类（可多选）',
          options, multiple: true, value: Array.from(sel).map(String)
        }],
        onSubmit: async (v) => {
          const ids = (v.folderIds || []).map(Number);
          const r = await api('/api/excerpt-folders/by-item/' + itemId, { method: 'POST', body: { folder_ids: ids } });
          if (!r.excerpts) { toast('本条目暂无录文，已记下所选分类，新增录文后自动套用'); return; }
          const bits = [];
          if (r.added) bits.push('新增 ' + r.added + ' 个');
          if (r.removed) bits.push('移除 ' + r.removed + ' 个');
          toast(bits.length ? '已更新归类（' + bits.join('，') + '）' : '归类无变化');
          location.reload();
        }
      });
     } catch (err) {
      console.error('归类本条目失败：', err);
      toast('归类失败：' + (err && err.message ? err.message : err));
     }
    };
  }

  // —— 右键菜单：新建子分类 / 重命名 / 移动到… / 删除 ——
  // 此前录文树只有折叠与筛选，用户右键无任何反应，也无法删除分类。
  // 菜单用 contextmenu 事件，与上面的 click 选中互不干扰。
  const A = () => window.classifyActions;

  const subtreeIdsOf = (rows, rootId) => {
    const out = [String(rootId)];
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of rows) {
        if (r.parentId && out.includes(String(r.parentId)) && !out.includes(String(r.id))) { out.push(String(r.id)); grew = true; }
      }
    }
    return out;
  };

  async function withRows(fn) {
    const a = A();
    if (!a) return toast('分类操作模块未加载，请刷新页面');
    const tree = await a.loadTree('folder');
    const rows = a.flatten(tree);
    return fn(a, rows);
  }

  root.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.tree-row');
    if (!row) return;
    const node = row.closest('.tree-node');
    if (!node) return;
    const id = Number(node.dataset.id);
    e.preventDefault();
    const nameEl = row.querySelector('.tree-item');
    const name = nameEl ? nameEl.textContent.trim() : '';

    const entries = [
      { label: '新建子分类', act: () => withRows((a, rows) => a.edit({
        scope: 'folder', parentId: id, parentOptions: a.parentOptions(rows, [id]), onDone: () => location.reload()
      })) },
      { label: '重命名', act: () => withRows((a, rows) => {
        const r = rows.find((x) => x.id === id);
        if (!r) return toast('分类不存在');
        a.edit({
          scope: 'folder', id, defaultName: r.name, defaultDescription: r.description,
          parentId: r.parentId, parentOptions: a.parentOptions(rows, subtreeIdsOf(rows, id)),
          onDone: () => location.reload()
        });
      }) },
      { label: '移动到…', act: () => withRows((a, rows) => a.move({
        scope: 'folder', id, name, description: (rows.find((x) => x.id === id) || {}).description,
        parentId: (rows.find((x) => x.id === id) || {}).parentId,
        parentOptions: a.parentOptions(rows, subtreeIdsOf(rows, id)),
        onDone: () => location.reload()
      })) },
      { label: '只看本分类的录文', act: () => {
        [...document.querySelectorAll('[data-excerpt-card]')].forEach((c) => { c.hidden = false; });
        const filter = root.querySelector('[data-folder-filter="' + id + '"]');
        if (filter) filter.click();
      } },
      { label: '删除', act: () => withRows((a, rows) => a.remove({
        scope: 'folder', id, name, onDone: () => location.reload()
      })) }
    ];

    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = entries.map((it, idx) => '<button type="button" data-idx="' + idx + '">' + it.label + '</button>').join('');
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(e.clientX, window.innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - rect.height - 8) + 'px';
    const close = () => { menu.remove(); document.removeEventListener('click', close); document.removeEventListener('keydown', esc); };
    const esc = (ev) => { if (ev.key === 'Escape') close(); };
    menu.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-idx]');
      if (!btn) return;
      close();
      const entry = entries[Number(btn.dataset.idx)];
      if (entry) entry.act();
    });
    setTimeout(() => {
      document.addEventListener('click', close);
      document.addEventListener('keydown', esc);
    }, 0);
  });
})();
