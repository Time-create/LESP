// 分类树交互：逐级折叠（状态存本地）+ 右键菜单（新建子分类/重命名/删除/移动到…）
// 服务端只输出嵌套结构，折叠与菜单都在这里完成，避免把状态塞进数据库。
(function () {
  const root = document.querySelector('.col-tree');
  if (!root) return;
  const KEY = 'collapsed-collections';
  const MODULE = root.dataset.module || '';
  const LIST_URL = root.dataset.listurl || location.pathname;

  const collapsed = (() => {
    try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]').map(String)); } catch (e) { return new Set(); }
  })();
  const saveCollapsed = () => {
    try { localStorage.setItem(KEY, JSON.stringify([...collapsed])); } catch (e) { /* 忽略 */ }
  };

  const kidsOf = (id) => root.querySelector('.tree-node[data-id="' + id + '"] > .tree-kids');
  const toggleOf = (id) => root.querySelector('[data-toggle="' + id + '"]');

  function applyCollapsed() {
    for (const id of collapsed) {
      const kids = kidsOf(id);
      const btn = toggleOf(id);
      if (!kids || !btn) continue;
      kids.hidden = true;
      btn.textContent = '▸';
    }
  }
  function setCollapsed(id, isCollapsed) {
    const kids = kidsOf(id);
    const btn = toggleOf(id);
    if (!kids || !btn) return;
    kids.hidden = isCollapsed;
    btn.textContent = isCollapsed ? '▸' : '▾';
    if (isCollapsed) collapsed.add(String(id)); else collapsed.delete(String(id));
    saveCollapsed();
  }

  // 展开某分类的全部祖先（点击带 ?collection= 的链接时用）
  function revealAncestors(id) {
    let cur = root.querySelector('.tree-node[data-id="' + id + '"]');
    while (cur) {
      const parentId = cur.dataset.parent;
      if (!parentId) break;
      setCollapsed(parentId, false);
      cur = root.querySelector('.tree-node[data-id="' + parentId + '"]');
    }
  }

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle]');
    if (btn) {
      e.preventDefault();
      const id = btn.dataset.toggle;
      const kids = kidsOf(id);           // 目标状态取反才是「切换」：原先传 hidden 相当于「设置为展开」
      setCollapsed(id, !kids.hidden);
      return;
    }
    const link = e.target.closest('a[data-collection]');
    if (link) revealAncestors(link.dataset.collection);
    const exact = e.target.closest('[data-exact]');
    if (exact) { e.preventDefault(); location.href = LIST_URL + '?collection=' + exact.dataset.exact + '&classification_exact=1'; }
  });

  const collapseAll = root.querySelector('#btn-tree-collapse-all');
  if (collapseAll) {
    collapseAll.onclick = () => {
      const toggles = [...root.querySelectorAll('[data-toggle]')];
      // 依据实际可见性判断（原先读箭头文本，状态不同步时会误判）
      const allCollapsed = toggles.every((b) => { const k = kidsOf(b.dataset.toggle); return !!k && k.hidden; });
      toggles.forEach((b) => setCollapsed(b.dataset.toggle, !allCollapsed));
    };
  }

  // —— 分类操作 ——
  const flatOptions = () => {
    // 供「移动到…」选择：缩进显示层级
    const out = [];
    const walk = (nodes, depth) => nodes.forEach((n) => {
      out.push({ id: n.id, label: '　'.repeat(depth) + (depth ? '└ ' : '') + n.querySelector('.tree-item').textContent.trim() });
      walk(n.querySelector('.tree-kids') ? [...n.querySelector('.tree-kids').children].map((li) => li) : [], depth + 1);
    });
    walk([...root.querySelectorAll('.tree-root > .tree-node')], 0);
    return out;
  };

  async function createCollection(parentId) {
    const A = window.classifyActions;
    const tree = await A.loadTree('collection', MODULE);
    A.edit({
      scope: 'collection',
      module: MODULE,
      parentId: parentId || '',
      parentOptions: A.parentOptions(A.flatten(tree), parentId ? [parentId] : []),
      onDone: () => location.reload()
    });
  }

  async function renameCollection(id, current) {
    const A = window.classifyActions;
    const tree = await A.loadTree('collection', MODULE);
    const row = A.flatten(tree).find((r) => r.id === id);
    if (!row) return toast('分类不存在');
    A.edit({
      scope: 'collection',
      module: MODULE,
      id,
      defaultName: current,
      defaultDescription: row.description,
      parentId: row.parentId,
      parentOptions: A.parentOptions(A.flatten(tree), subtreeIdsOf(A.flatten(tree), id)),
      onDone: () => location.reload()
    });
  }

  async function removeCollection(id, name) {
    if (!confirmBox(`删除分类「${name}」？其下级分类会一并删除，分类中的条目只解除归类、内容保留。`)) return;
    try {
      const r = await api('/api/collections/' + id, { method: 'DELETE' });
      toast(`已删除 ${r.categories} 个分类，解除 ${r.links} 条归类关系`);
      location.reload();
    } catch (err) { toast(err.message); }
  }

  async function moveCollection(id, name, selfAndDescendantIds) {
    const options = [{ value: '', label: '（顶级）' }].concat(
      flatOptions().filter((o) => !selfAndDescendantIds.includes(String(o.id))).map((o) => ({ value: o.value, label: o.label }))
    );
    openForm({
      title: `移动分类「${name}」`,
      fields: [{ name: 'parent_id', label: '上级分类', type: 'select', options }],
      submitLabel: '移动',
      onSubmit: async (v) => {
        const siblings = flatOptions()
          .filter((o) => String(o.parentId || '') === String(v.parent_id || ''))
          .map((o) => o.id);
        await api('/api/collections/reorder', { method: 'POST', body: { id, parent_id: v.parent_id || null, order: [id].concat(siblings) } });
        toast('已移动');
        location.reload();
      }
    });
    // options 需要 parentId 供同级排序推断
    for (const o of flatOptions()) {
      const li = root.querySelector('.tree-node[data-id="' + o.id + '"]');
      if (li) o.parentId = li.dataset.parent || '';
    }
  }

  // 右键菜单
  root.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.tree-row');
    const addBtn = e.target.closest('#btn-new-collection');
    if (addBtn) { e.preventDefault(); createCollection(null); return; }
    if (!row) return;
    const node = row.closest('.tree-node');
    const id = Number(node.dataset.id);
    e.preventDefault();
    const name = row.querySelector('.tree-item').textContent.trim();
    const depth = node.closest('.tree-root').parentElement ? 0 : 0;
    // 自己和全部后代都不能作为移动目标
    const selfAndDescendantIds = [];
    const collect = (li) => {
      selfAndDescendantIds.push(String(li.dataset.id));
      const kids = li.querySelector(':scope > .tree-kids');
      if (kids) [...kids.children].forEach(collect);
    };
    collect(node);

    // 单一数据源：标签与处理函数同在一处，避免两份平行数组靠下标对齐而错位
    const entries = [
      { label: '新建子分类', act: () => createCollection(id) },
      { label: '重命名', act: () => renameCollection(id, name) },
      { label: '移动到…', act: () => moveCollection(id, name, selfAndDescendantIds) },
      { label: '只看本级（不含子分类）', act: () => { location.href = LIST_URL + '?collection=' + id + '&classification_exact=1'; } },
      { label: '删除', act: () => removeCollection(id, name) }
    ];
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = entries.map((i, idx) => `<button type="button" data-idx="${idx}">${i.label}</button>`).join('');
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

  const newBtn = root.querySelector('#btn-new-collection');
  if (newBtn) {
    newBtn.onclick = () => {
      if (!window.classifyActions) return toast('分类操作模块未加载，请刷新页面');
      createCollection(null);
    };
  }
  const manageBtn = root.querySelector('#btn-manage-collection');
  if (manageBtn) {
    manageBtn.onclick = () => {
      if (typeof window.openClassifyManager !== 'function') return toast('分类管理面板未加载，请刷新页面');
      window.openClassifyManager('collection', MODULE);
    };
  }

  // 某节点及其后代 id（编辑/移动时排除自己子树）
  function subtreeIdsOf(rows, rootId) {
    const out = [String(rootId)];
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of rows) {
        if (r.parentId && out.includes(String(r.parentId)) && !out.includes(String(r.id))) { out.push(String(r.id)); grew = true; }
      }
    }
    return out;
  }

  applyCollapsed();
})();

// —— 拖拽：同层前后 = 调顺序；拖到另一个分类上 = 换父级 ——
// 落位判定取鼠标相对目标行中线的位置：上半/下半 → 插到该节点前后；中线附近 → 移入其下
(function () {
  const root = document.querySelector('.col-tree');
  if (!root || !root.draggable) { /* 占位：拖拽在下方单独初始化 */ }

  let dragId = null;
  let indicator = null;
  // 折叠集合：与上方折叠逻辑共用同一份本地状态（各自闭包内独立读写 localStorage）
  const KEY = 'collapsed-collections';
  const readCollapsed = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]').map(String)); } catch (e) { return new Set(); } };
  const writeCollapsed = (set) => { try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch (e) { /* 忽略 */ } };

  const rowOf = (el) => el.closest('.tree-row');
  const nodeOf = (el) => el.closest('.tree-node');
  const descendantIds = (li) => {
    const out = [String(li.dataset.id)];
    const kids = li.querySelector(':scope > .tree-kids');
    if (kids) [...kids.children].forEach((k) => out.push(...descendantIds(k)));
    return out;
  };
  const showIndicator = (row, mode) => {
    hideIndicator();
    indicator = document.createElement('div');
    indicator.className = 'drop-' + mode;
    if (mode === 'inside') row.classList.add('drop-inside');
    else row.parentElement.insertBefore(indicator, mode === 'before' ? row : row.nextSibling);
  };
  const hideIndicator = () => {
    if (indicator && indicator.parentElement) indicator.remove();
    indicator = null;
    root.querySelectorAll('.drop-inside').forEach((n) => n.classList.remove('drop-inside'));
  };

  root.addEventListener('dragstart', (e) => {
    const row = rowOf(e.target);
    if (!row) return;
    dragId = nodeOf(row).dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    row.classList.add('dragging');
  });
  root.addEventListener('dragend', () => {
    root.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging'));
    hideIndicator();
    dragId = null;
  });

  root.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const row = rowOf(e.target);
    if (!row) return;
    const li = nodeOf(row);
    if (String(li.dataset.id) === String(dragId)) return;                 // 不落回自己
    const self = root.querySelector('.tree-node[data-id="' + dragId + '"]');
    if (self && descendantIds(self).includes(String(li.dataset.id))) return;   // 不落入自身子树
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    if (ratio < 0.28) showIndicator(row, 'before');
    else if (ratio > 0.72) showIndicator(row, 'after');
    else showIndicator(row, 'inside');
  });

  root.addEventListener('drop', async (e) => {
    if (!dragId) return;
    const row = rowOf(e.target);
    if (!row) { hideIndicator(); return; }
    e.preventDefault();
    const targetLi = nodeOf(row);
    const targetId = String(targetLi.dataset.id);
    if (targetId === String(dragId)) { hideIndicator(); return; }
    const dragLi = root.querySelector('.tree-node[data-id="' + dragId + '"]');
    if (dragLi && descendantIds(dragLi).includes(targetId)) { hideIndicator(); return; }

    const rect = row.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    let parentId = null;
    let order = [];
    if (ratio < 0.28) {                                  // 插到目标之前：与目标同级
      parentId = targetLi.dataset.parent || null;
      order = siblingsOf(parentId).filter((n) => String(n) !== String(dragId));
      order.splice(order.indexOf(targetId), 0, Number(dragId));
    } else if (ratio > 0.72) {                           // 插到目标之后：与目标同级
      parentId = targetLi.dataset.parent || null;
      order = siblingsOf(parentId).filter((n) => String(n) !== String(dragId));
      order.splice(order.indexOf(targetId) + 1, 0, Number(dragId));
    } else {                                              // 移入目标之下
      parentId = targetId;
      const kids = targetLi.querySelector(':scope > .tree-kids');
      const set = readCollapsed();
      if (kids) set.delete(targetId); else set.add(targetId);   // 移入有子级的分类时默认展开
      writeCollapsed(set);
      order = [Number(dragId)];
    }
    hideIndicator();
    try {
      await api('/api/collections/reorder', { method: 'POST', body: { id: Number(dragId), parent_id: parentId || null, order } });
      location.reload();
    } catch (err) { toast(err.message); }
  });

  function siblingsOf(parentId) {
    const sel = parentId
      ? '.tree-node[data-parent="' + parentId + '"]'
      : '.tree-root > .tree-node';
    return [...root.querySelectorAll(sel)].map((n) => Number(n.dataset.id));
  }

  // 让节点可拖拽
  root.querySelectorAll('.tree-node > .tree-row').forEach((row) => { row.draggable = true; });
})();
