// 分类管理操作（条目分类与录文分类共用）
// 关键修复：此前用 window.prompt 收集名称，而 Electron 并不支持 prompt（会抛错），
// 表现为「按钮点了没反应」。这里统一改用应用内表单 openForm，并补齐描述字段、
// 上级选择、删除影响预览与加载/失败反馈。
(function () {
  const ENDPOINTS = { collection: '/api/collections', folder: '/api/excerpt-folders', theme: '/api/themes' };
  // 三个后端的「更新」方法并不一致：collections 是 PUT，excerpt-folders 与 themes 是 PATCH。
  // 原先固定发 PUT，导致录文分类与主题一改名就 404。
  const UPDATE_METHOD = { collection: 'PUT', folder: 'PATCH', theme: 'PATCH' };
  // 需要 confirm=true 才能真删的 scope（collections 不需要）
  const NEEDS_CONFIRM = ['folder', 'theme'];

  /** 取当前分类树（用于上级选择与列表）。
   *  collection/excerpt-folders 走 ?tree=1 拿嵌套结构；
   *  themes 后端只返回扁平数组，这里就地把 parent_id 拼成嵌套，两条路径对上层一致。 */
  async function loadTree(scope, module) {
    scope = scope || 'collection';
    // 注意：collection 需要带 module 过滤，无 module 时不能拼出「/api/collections&tree=1」
    const qs = scope === 'collection' && module ? '?module=' + encodeURIComponent(module) + '&tree=1' : '?tree=1';
    const rows = await api(ENDPOINTS[scope] + qs);
    if (scope !== 'theme') return rows;
    return nestFlat(rows);
  }

  /** 扁平 [{id,parent_id}] → 嵌套树。
   *  已带 children 的（其他 scope 的 ?tree=1 结果）原样返回，避免把嵌套再套一层导致子节点丢失。 */
  function nestFlat(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (list.some((r) => Array.isArray(r.children) && r.children.length)) return list;
    const nodes = list.map((r) => Object.assign({}, r, { children: [] }));
    const byId = new Map(nodes.map((r) => [r.id, r]));
    const roots = [];
    for (const n of nodes) {
      const p = n.parent_id ? byId.get(n.parent_id) : null;
      if (p) p.children.push(n); else roots.push(n);
    }
    return roots;
  }

  /** 把树拍平成带层级的选项 */
  function flatten(tree) {
    const out = [];
    const walk = (nodes, depth, parentId) => nodes.forEach((n) => {
      out.push({ id: n.id, name: n.name, depth, parentId, description: n.description || '', count: n.item_count || 0 });
      walk(n.children || [], depth + 1, n.id);
    });
    walk(tree || [], 0, null);
    return out;
  }

  function parentOptions(rows, excludeIds) {
    const opts = [{ value: '', label: '（顶级分类）' }];
    for (const r of rows) {
      if (excludeIds && excludeIds.includes(String(r.id))) continue;
      opts.push({ value: r.id, label: '　'.repeat(r.depth) + (r.depth ? '└ ' : '') + r.name });
    }
    return opts;
  }

  /**
   * 新建 / 编辑分类。
   * @param {object} o { scope, module, id?, parentId?, defaultName?, defaultDescription?, onDone }
   */
  function edit(o) {
    const scope = o.scope || 'collection';
    const isEdit = !!o.id;
    openForm({
      title: isEdit ? '编辑分类' : (o.parentId ? '新建子分类' : '新建分类'),
      submitLabel: isEdit ? '保存' : '创建',
      fields: [
        { name: 'name', label: '分类名称', required: true, value: o.defaultName || '' },
        { name: 'description', label: '描述（可选）', multiline: true, rows: 3, value: o.defaultDescription || '' },
        { name: 'parent_id', label: '上级分类', options: o.parentOptions || [{ value: '', label: '（顶级分类）' }], value: o.parentId || '' }
      ],
      onSubmit: async (v) => {
        const name = String(v.name || '').trim();
        if (!name) throw new Error('分类名称不能为空');
        if (name.length > 60) throw new Error('分类名称过长（60 字以内）');
        const desc = String(v.description || '').trim().slice(0, 500);
        const parent = v.parent_id ? Number(v.parent_id) : null;
        const body = scope === 'collection'
          ? { name, description: desc, parent_id: parent, ...(isEdit ? {} : { module: o.module }) }
          : { name, description: desc, parent_id: parent };
        const url = ENDPOINTS[scope] + (isEdit ? '/' + o.id : '');
        const saved = await api(url, { method: isEdit ? (UPDATE_METHOD[scope] || 'PUT') : 'POST', body });
        toast(isEdit ? '已保存' : '已创建分类：' + saved.name);
        if (o.onDone) o.onDone(saved);
        return saved;
      }
    });
  }

  /** 删除：先看影响范围（子分类数 / 解除的归类数），再二次确认 */
  async function remove(o) {
    const scope = o.scope || 'collection';
    // 录文分类与主题的删除接口要求显式带 confirm=true，否则服务端一律 400 拒绝。
    // 原先漏了这个参数，表现为「点删除没反应 / 报错」——即录文分类删不掉的直接原因。
    const confirmFlag = NEEDS_CONFIRM.indexOf(scope) >= 0 ? '?confirm=true' : '';
    const extra = scope === 'collection' && o.target ? (o.target ? '&' : '?') + 'target=' + o.target : '';
    const url = ENDPOINTS[scope] + '/' + o.id + confirmFlag + extra;
    let impact = { categories: 1, links: 0 };
    try {
      impact = await api(ENDPOINTS[scope] + '/' + o.id + '/impact');
    } catch (e) {
      // 影响预览拿不到也要能删，只是提示少一层
    }
    const lines = ['确定删除分类「' + (o.name || '') + '」？'];
    if (impact.categories > 1) lines.push('其下 ' + (impact.categories - 1) + ' 个子分类会一并删除');
    if (impact.links) lines.push('将解除 ' + impact.links + ' 条关联关系（内容本身保留）');
    if (!confirmBox(lines.join('\n'))) return;
    try {
      const done = await api(url, { method: 'DELETE' });
      toast('已删除 ' + (done.categories || impact.categories) + ' 个分类，解除 ' + (done.links != null ? done.links : impact.links) + ' 条关联');
      if (o.onDone) o.onDone(null);
    } catch (e) {
      toast('删除失败：' + e.message);
    }
  }

  /** 移动（换上级） */
  function move(o) {
    const scope = o.scope || 'collection';
    edit({
      scope,
      module: o.module,
      id: o.id,
      defaultName: o.name,
      defaultDescription: o.description,
      parentOptions: o.parentOptions,
      parentId: o.parentId || '',
      onDone: o.onDone
    });
  }

  window.classifyActions = { loadTree, flatten, parentOptions, edit, remove, move, ENDPOINTS };
})();
