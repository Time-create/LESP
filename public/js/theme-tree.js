// V5 主题树：左栏「史料分类」下方的第二棵树。
//
// 与分类树的关系：**正交的独立维度**。分类回答「这条资料属于哪一类」，主题回答「它关心什么问题」。
// 因此：
//   - 不参与拖拽归类（两套拖拽会混淆手势，本轮明确不做）
//   - 折叠状态用独立 key（collapsed-theme-*），不与分类树串
//   - 展开时才按需拉取关联对象（GET /themes/:id/relations），不预加载全树
(function () {
  const root = document.querySelector('.theme-tree');
  if (!root) return;

  const KEY = 'collapsed-theme-';
  const expanded = (() => {
    try { return new Set(JSON.parse(localStorage.getItem('theme-tree-open') || '[]').map(String)); } catch (e) { return new Set(); }
  })();
  const saveOpen = () => { try { localStorage.setItem('theme-tree-open', JSON.stringify([...expanded])); } catch (e) { /* 忽略 */ } };

  const collapsed = (() => {
    try { return new Set(JSON.parse(localStorage.getItem(KEY + 'all') || '[]').map(String)); } catch (e) { return new Set(); }
  })();

  const TYPE_LABEL = { excerpt: '录文', note: '札记', idea: '灵感', compilation: '长编', historyPaper: '论文' };
  const MAX_DEPTH = 4;

  // 由扁平列表建树
  function buildTree(rows) {
    const byId = new Map(rows.map((r) => [r.id, Object.assign({}, r, { children: [] })]));
    const roots = [];
    for (const node of byId.values()) {
      const p = node.parent_id ? byId.get(node.parent_id) : null;
      if (p) p.children.push(node); else roots.push(node);
    }
    const depthOf = (n) => { let d = 0, cur = n; while (cur.parent_id && d < 20) { cur = byId.get(cur.parent_id); if (!cur) break; d += 1; } return d; };
    const sortFn = (a, b) => (a.sort - b.sort) || (a.id - b.id);
    const walk = (list) => { list.sort(sortFn); list.forEach((n) => { n.depth = depthOf(n); walk(n.children); }); };
    walk(roots);
    return roots;
  }

  const nodeHtml = (n) => {
    const hasKids = n.children.length > 0;
    const open = expanded.has(String(n.id));
    const closed = collapsed.has(String(n.id));
    return `<li class="theme-node" data-id="${n.id}" data-depth="${n.depth}">
      <div class="theme-row${open ? ' theme-on' : ''}">
        ${hasKids
          ? `<button type="button" class="theme-toggle" data-theme-toggle="${n.id}">${closed ? '▸' : '▾'}</button>`
          : '<span class="theme-toggle theme-toggle-empty"></span>'}
        <button type="button" class="theme-name" data-theme-open="${n.id}">${esc(n.name)}</button>
        <span class="theme-count" data-theme-count="${n.id}">${n.total || 0}</span>
      </div>
      <div class="theme-kids-wrap" data-theme-kids="${n.id}"${hasKids ? (open ? '' : ' hidden') : ' hidden'}>
        ${hasKids ? `<ul class="theme-kids">${n.children.map(nodeHtml).join('')}</ul>` : ''}
        <div class="theme-rel" data-theme-rel="${n.id}"></div>
      </div>
    </li>`;
  };

  function render(rows) {
    const tree = buildTree(rows);
    const box = root.querySelector('.theme-tree-body');
    if (!tree.length) {
      box.innerHTML = '<div class="theme-empty">还没有主题。点上方「＋ 主题」建第一个，'
        + '主题是跨栏目的关注点，可同时挂古籍、碑刻与写作。</div>';
      return;
    }
    box.innerHTML = '<ul class="theme-root">' + tree.map(nodeHtml).join('') + '</ul>';
  }

  async function loadRelations(id, wrap) {
    const holder = root.querySelector('[data-theme-rel="' + id + '"]');
    if (!holder) return;
    if (holder.dataset.loaded === '1') return;                 // 已加载过不重复请求
    holder.dataset.loaded = '1';
    holder.innerHTML = '<div class="theme-rel-loading">加载中…</div>';
    try {
      const res = await api('/api/themes/' + id + '/relations?limit=50');
      const rows = res.rows || [];
      if (!rows.length) { holder.innerHTML = '<div class="theme-rel-empty">此主题下还没有关联内容</div>'; return; }
      holder.innerHTML = rows.map((r) => '<a class="theme-rel-row" href="' + esc(r.route) + '" data-theme-rel-type="' + esc(r.type) + '">'
        + '<span class="theme-rel-type">' + esc(TYPE_LABEL[r.type] || r.type) + '</span>'
        + '<span class="theme-rel-title">' + esc(r.title) + '</span>'
        + (r.locator ? '<span class="theme-rel-loc">' + esc(r.locator) + '</span>' : '')
        + '</a>').join('')
        + (res.total > rows.length ? '<div class="theme-rel-more">共 ' + res.total + ' 条，已显示前 ' + rows.length + ' 条</div>' : '');
    } catch (e) {
      holder.dataset.loaded = '';
      holder.innerHTML = '<div class="theme-rel-error">加载失败：' + esc(e.message) + '</div>';
    }
    void wrap;
  }

  function toggleOpen(id) {
    const key = String(id);
    const on = !expanded.has(key);
    const row = root.querySelector('.theme-row[data-id], .theme-node[data-id="' + key + '"] > .theme-row');
    const kids = root.querySelector('[data-theme-kids="' + key + '"]');
    if (on) {
      expanded.add(key); saveOpen();
      if (kids) kids.hidden = false;
      if (row) row.classList.add('theme-on');
      loadRelations(id);
    } else {
      expanded.delete(key); saveOpen();
      if (kids) kids.hidden = true;
      if (row) row.classList.remove('theme-on');
    }
  }

  function toggleCollapsed(id) {
    const key = String(id);
    const kids = root.querySelector('[data-theme-kids="' + key + '"]');
    if (!kids) return;
    const btn = root.querySelector('[data-theme-toggle="' + key + '"]');
    const willCollapse = !kids.hidden;
    kids.hidden = willCollapse;
    if (btn) btn.textContent = willCollapse ? '▸' : '▾';
    if (willCollapse) collapsed.add(key); else collapsed.delete(key);
    try { localStorage.setItem(KEY + 'all', JSON.stringify([...collapsed])); } catch (e) { /* 忽略 */ }
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-theme-toggle]');
    if (t) { e.stopPropagation(); toggleCollapsed(t.dataset.themeToggle); return; }
    const o = e.target.closest('[data-theme-open]');
    if (o) { toggleOpen(o.dataset.themeOpen); return; }
    const add = e.target.closest('[data-theme-action="new"]');
    if (add) { e.preventDefault(); createTheme(null); return; }
    const mgr = e.target.closest('[data-theme-action="manage"]');
    if (mgr) {
      e.preventDefault();
      if (typeof window.openClassifyManager !== 'function') return toast('分类管理面板未加载，请刷新页面');
      window.openClassifyManager('theme');
    }
  });

  // 右键：新建子主题 / 重命名 / 删除（复用统一分类操作，PATCH + confirm 已修好）
  root.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.theme-row');
    const node = row && row.closest('.theme-node');
    if (!node) return;
    e.preventDefault();
    const id = Number(node.dataset.id);
    const nameEl = row.querySelector('.theme-name');
    const name = nameEl ? nameEl.textContent.trim() : '';
    const depth = Number(node.dataset.depth || 0);
    const A = window.classifyActions;
    if (!A) return toast('分类操作模块未加载，请刷新页面');

    const entries = [
      { label: '在此下新建子主题', disabled: depth + 1 >= MAX_DEPTH, act: () => withRows((a, rows) => a.edit({
        scope: 'theme', parentId: id, parentOptions: a.parentOptions(rows, [id]), onDone: () => location.reload()
      })) },
      { label: '重命名', act: () => withRows((a, rows) => {
        const r = rows.find((x) => x.id === id);
        if (!r) return toast('主题不存在');
        a.edit({ scope: 'theme', id, defaultName: r.name, defaultDescription: r.description, parentId: r.parentId,
          parentOptions: a.parentOptions(rows, subtreeIds(rows, id)), onDone: () => location.reload() });
      }) },
      { label: '删除', act: () => withRows((a, rows) => a.remove({ scope: 'theme', id, name, onDone: () => location.reload() })) }
    ];

    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = entries.map((it, i) => '<button type="button" data-idx="' + i + '"' + (it.disabled ? ' disabled' : '') + '>' + it.label + '</button>').join('');
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(e.clientX, window.innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - rect.height - 8) + 'px';
    const close = () => { menu.remove(); document.removeEventListener('click', close); document.removeEventListener('keydown', esc); };
    const esc = (ev) => { if (ev.key === 'Escape') close(); };
    menu.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-idx]');
      if (!btn || btn.disabled) return;
      close();
      const entry = entries[Number(btn.dataset.idx)];
      if (entry && entry.act) entry.act();
    });
    setTimeout(() => { document.addEventListener('click', close); document.addEventListener('keydown', esc); }, 0);
  });

  async function withRows(fn) {
    const A = window.classifyActions;
    if (!A) return toast('分类操作模块未加载，请刷新页面');
    const tree = await A.loadTree('theme');
    return fn(A, A.flatten(tree));
  }

  function subtreeIds(rows, rootId) {
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

  function createTheme(parentId) {
    withRows((a, rows) => a.edit({
      scope: 'theme',
      parentId: parentId || '',
      parentOptions: a.parentOptions(rows, parentId ? [parentId] : []),
      onDone: () => location.reload()
    }));
  }

  // 首次加载：主题 + 计数一次取回（两个接口并行，不串行）
  (async () => {
    const box = root.querySelector('.theme-tree-body');
    if (box) box.innerHTML = '<div class="theme-empty">加载中…</div>';
    try {
      const [rows, counts] = await Promise.all([api('/api/themes'), api('/api/themes/counts')]);
      const cMap = new Map(counts.map((c) => [c.id, c.total || 0]));
      render(rows.map((r) => Object.assign({}, r, { total: cMap.get(r.id) || 0 })));
      // 恢复展开状态
      for (const id of expanded) {
        const kids = root.querySelector('[data-theme-kids="' + id + '"]');
        if (kids && !kids.hidden) loadRelations(id);
      }
    } catch (e) {
      if (box) box.innerHTML = '<div class="theme-empty">加载失败：' + esc(e.message) + '</div>';
    }
  })();
})();
