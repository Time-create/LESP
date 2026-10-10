// 录文集（资料库 → 录文）交互：
//   1) 分类树折叠、点击筛选
//   2) 分类树右键菜单：新建子分类 / 重命名 / 移动到… / 删除（与条目页行为一致）
//   3) 卡片分类标签可就地点开增删分类
//   4) 「定位」跳回来源条目里的那一条录文
(function () {
  const side = document.querySelector('.hub-side');
  const list = document.querySelector('.hub-list');
  if (!side || !list) return;

  const KEY = 'collapsed-excerpt-folders';
  const state = (() => {
    try { return JSON.parse(list.dataset.hubState || '{}'); } catch (e) { return {}; }
  })();
  const collapsed = (() => {
    try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]').map(String)); } catch (e) { return new Set(); }
  })();
  const saveCollapsed = () => {
    try { localStorage.setItem(KEY, JSON.stringify([...collapsed])); } catch (e) { /* 忽略 */ }
  };

  // —— 折叠 ——
  const kidsOf = (id) => side.querySelector('.tree-node[data-id="' + id + '"] > .tree-kids');
  const btnOf = (id) => side.querySelector('[data-toggle="' + id + '"]');
  function setCollapsed(id, now) {
    const kids = kidsOf(id), btn = btnOf(id);
    if (!kids || !btn) return;
    kids.hidden = now;
    btn.textContent = now ? '▸' : '▾';
    if (now) collapsed.add(String(id)); else collapsed.delete(String(id));
    saveCollapsed();
  }
  side.querySelectorAll('.tree-node[data-id]').forEach((n) => setCollapsed(n.dataset.id, collapsed.has(n.dataset.id)));

  // —— 分类维护：复用 classify-actions，与条目页同一套表单与删除确认 ——
  const subtreeIdsOf = (rows, rootId) => {
    const out = [];
    const walk = (id) => { out.push(id); rows.filter((r) => r.parentId === id).forEach((r) => walk(r.id)); };
    walk(rootId);
    return out;
  };
  const withRows = async (fn) => {
    if (typeof window.classifyActions !== 'object') return toast('分类操作模块未加载，请刷新页面');
    const A = window.classifyActions;
    const tree = await api('/api/excerpt-folders?tree=1');
    return fn(A, A.flatten(tree));
  };

  // 维护完必须重载：分类名、层级、计数都在服务端渲染，前端改不保证一致。
  // （上一轮「管理完面板变了但页面树没变」就是漏了这一步。）
  const reload = () => location.reload();

  const newBtn = side.querySelector('[data-hub-new-folder]');
  if (newBtn) {
    newBtn.onclick = () => withRows((A, rows) => A.edit({
      scope: 'folder', parentOptions: A.parentOptions(rows), onDone: reload
    }));
  }

  side.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target : (e.target && e.target.parentElement);
    if (!el || !el.closest) return;
    const toggle = el.closest('[data-toggle]');
    if (toggle) { setCollapsed(toggle.dataset.toggle, !kidsOf(toggle.dataset.toggle).hidden); return; }
  });

  // —— 右键菜单 ——
  side.addEventListener('contextmenu', (e) => {
    const el = e.target instanceof Element ? e.target : (e.target && e.target.parentElement);
    const row = el && el.closest ? el.closest('.tree-row') : null;
    if (!row) return;
    const node = row.closest('.tree-node');
    if (!node || !node.dataset.id) return;   // 「全部录文 / 未归类」不是分类节点
    const id = Number(node.dataset.id);
    e.preventDefault();
    const nameEl = row.querySelector('.tree-item');
    const name = nameEl ? nameEl.textContent.trim() : '';

    const entries = [
      { label: '新建子分类', act: () => withRows((A, rows) => A.edit({
        scope: 'folder', parentId: id, parentOptions: A.parentOptions(rows, [id]), onDone: reload
      })) },
      { label: '重命名', act: () => withRows((A, rows) => {
        const r = rows.find((x) => x.id === id);
        if (!r) return toast('分类不存在');
        return A.edit({
          scope: 'folder', id, defaultName: r.name, defaultDescription: r.description,
          parentId: r.parentId, parentOptions: A.parentOptions(rows, subtreeIdsOf(rows, id)), onDone: reload
        });
      }) },
      { label: '移动到…', act: () => withRows((A, rows) => {
        const r = rows.find((x) => x.id === id) || {};
        return A.move({
          scope: 'folder', id, name, description: r.description, parentId: r.parentId,
          parentOptions: A.parentOptions(rows, subtreeIdsOf(rows, id)), onDone: reload
        });
      }) },
      { label: '删除', act: () => withRows((A) => A.remove({ scope: 'folder', id, name, onDone: reload })) }
    ];

    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = entries.map((it, i) => '<button type="button" data-idx="' + i + '">' + it.label + '</button>').join('');
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(e.clientX, window.innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - rect.height - 8) + 'px';
    const close = () => {
      menu.remove();
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onEsc);
    };
    const onEsc = (ev) => { if (ev.key === 'Escape') close(); };
    menu.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-idx]');
      if (!btn) return;
      close();
      const entry = entries[Number(btn.dataset.idx)];
      if (entry) entry.act();
    });
    setTimeout(() => {
      document.addEventListener('click', close);
      document.addEventListener('keydown', onEsc);
    }, 0);
  });

  // —— 卡片：分类标签增删 ——
  const relabel = (excerptId, names) => {
    const card = list.querySelector('.ex-card[data-ex-card="' + excerptId + '"]');
    if (!card) return;
    const box = card.querySelector('.ex-tags');
    if (!box) return;
    box.innerHTML = names.length
      ? names.map((f) => '<button type="button" class="ex-tag" data-ex-tag="' + f.id +
          '" data-ex-tag-remove="' + excerptId + '" title="点击移除该分类">' +
          String(f.name).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) +
          '<span class="ex-tag-x">×</span></button>').join('')
      : '<button type="button" class="ex-tag ex-tag-empty" data-ex-tag-add="' + excerptId + '">未归类 · 点击归类</button>';
  };

  // 打开「选择分类」对话框，返回用户勾选的 id 数组
  const pickFolders = async (excerptId) => {
    const tree = await api('/api/excerpt-folders?tree=1');
    const rows = window.classifyActions.flatten(tree);
    const card = list.querySelector('.ex-card[data-ex-card="' + excerptId + '"]');
    const mine = new Set([...card.querySelectorAll('[data-ex-tag]')].map((b) => Number(b.dataset.exTag)));
    const options = [];
    const walk = (nodes, depth) => nodes.forEach((n) => {
      options.push({ value: String(n.id), label: '　'.repeat(depth) + (depth ? '└ ' : '') + n.name });
      walk(n.children || [], depth + 1);
    });
    walk(tree, 0);
    if (!options.length) { toast('还没有录文分类，请先新建'); return null; }
    return openForm({
      title: '归类录文（可多选）',
      submitLabel: '保存',
      fields: [{
        name: 'folderIds', label: '选择分类', options, multiple: true,
        value: [...mine].map(String)
      }],
      onSubmit: async (v) => {
        const ids = (v.folderIds || []).map(Number);
        const saved = await api('/api/excerpt-folders/assign', {
          method: 'POST', body: { excerpt_id: Number(excerptId), folder_ids: ids, mode: 'set' }
        });
        void saved;
        // 回显新分类名，避免整页刷新打断阅读
        const all = window.classifyActions.flatten(await api('/api/excerpt-folders?tree=1'));
        relabel(Number(excerptId), ids.map((id) => ({ id, name: (all.find((x) => x.id === id) || {}).name || '（已删除）' })));
        toast(ids.length ? '已归类' : '已移出全部分类');
      }
    });
  };

  list.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target : (e.target && e.target.parentElement);
    if (!el || !el.closest) return;

    const add = el.closest('[data-ex-tag-add]');
    if (add) { pickFolders(Number(add.dataset.exTagAdd)); return; }

    const rm = el.closest('[data-ex-tag-remove]');
    if (rm) {
      const excerptId = Number(rm.dataset.exTagRemove);
      const card = list.querySelector('.ex-card[data-ex-card="' + excerptId + '"]');
      const rest = [...card.querySelectorAll('[data-ex-tag]')]
        .filter((b) => b !== rm).map((b) => Number(b.dataset.exTag));
      api('/api/excerpt-folders/assign', {
        method: 'POST', body: { excerpt_id: excerptId, folder_ids: rest, mode: 'set' }
      }).then(() => {
        relabel(excerptId, []);
        toast('已移除该分类');
      }).catch((err) => toast(err.message));
      return;
    }

    const loc = el.closest('[data-ex-locate]');
    if (loc) {
      const card = loc.closest('.ex-card');
      const a = card && card.querySelector('.ex-src a');
      if (a) location.href = a.getAttribute('href') + '#excerpt-' + loc.dataset.exLocate;
    }
  });

  void state;
})();
