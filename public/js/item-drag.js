// 条目拖拽归类：把列表里的条目拖到左栏分类上即完成归类（追加语义）。
//
// 适用范围：六类资料条目（items）+ 史料长编（compilations）+ 读书札记（notes）。
// 三者在页面上都是「左栏分类树 + 右侧列表」的同一形态，因此共用本脚本；
// 差别只在归类接口的 target 参数，由左栏容器的 data-module 推出。
//
// 与 collection-tree.js 的「树节点拖拽排序」是两回事，靠 dataTransfer 的类型区分，互不干扰：
//   application/x-lesp-item         —— 本脚本（从 .col-list 拖出）
//   application/x-lesp-collection  —— 树脚本（从 .col-tree 内拖出）
(function () {
  const ITEM_MIME = 'application/x-lesp-item';
  const list = document.querySelector('.col-list');
  const tree = document.querySelector('.col-tree');
  if (!list || !tree) return;                       // 详情页没有列表，退出
  // 新建分类必须带 module（后端 mustClassifyModule 会拒），从左栏容器上读
  const MODULE = tree.dataset.module || '';

  // 归类目标类型：长编/札记是独立表，后端 assign 走 target 参数区分；
  // 其余六类资料条目共用 items 表，target 固定为 'item'。
  const TARGET = (MODULE === 'compilation' || MODULE === 'note') ? MODULE : 'item';
  const OWNER_KEY = TARGET === 'compilation' ? 'compilation_id' : TARGET === 'note' ? 'note_id' : 'item_id';

  let dragging = null;      // { id, title, cols:Set<number> }
  let justDragged = false;  // 刚拖过：用于抑制紧随其后的 click
  let dropZone = null;      // 拖拽期间出现的「＋新建分类」放置区

  const collectionIdFrom = (el) => {
    const row = el && el.closest ? el.closest('.tree-row') : null;
    const node = row ? row.closest('.tree-node') : null;
    // 「未分类」只是筛选视图，不作为归类目标
    if (node && node.querySelector('.tree-unclassified')) return null;
    return node ? Number(node.dataset.id) || null : null;
  };

  const clearMarks = () => {
    tree.querySelectorAll('.drop-into').forEach((n) => n.classList.remove('drop-into'));
    if (dropZone) { dropZone.remove(); dropZone = null; }
  };

  // ---- 拖起条目 ----
  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest ? e.target.closest('.li[data-item-id]') : null;
    if (!li) return;
    dragging = {
      id: Number(li.dataset.itemId),
      title: (li.querySelector('.li-title') || {}).textContent || '该条目',
      cols: new Set(String(li.dataset.collections || '').split(',').filter(Boolean).map(Number))
    };
    try {
      e.dataTransfer.setData(ITEM_MIME, String(dragging.id));
      e.dataTransfer.effectAllowed = 'copy';
    } catch (err) { /* 某些环境禁用了自定义类型，忽略 */ }
    li.classList.add('li-dragging');
    document.body.classList.add('item-dragging');
    showDropZone();
  });

  const endDrag = () => {
    dragging = null;
    justDragged = true;
    setTimeout(() => { justDragged = false; }, 150);
    list.querySelectorAll('.li-dragging').forEach((n) => n.classList.remove('li-dragging'));
    document.body.classList.remove('item-dragging');
    clearMarks();
  };
  list.addEventListener('dragend', endDrag);

  // ---- 拖到分类上：高亮 ----
  tree.addEventListener('dragover', (e) => {
    if (!dragging) return;
    // 树节点自身拖拽时不接管
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('application/x-lesp-collection')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    tree.querySelectorAll('.drop-into').forEach((n) => n.classList.remove('drop-into'));
    const id = collectionIdFrom(e.target);
    const row = e.target.closest ? e.target.closest('.tree-row') : null;
    if (id && row) {
      row.classList.add('drop-into');
      if (dropZone) dropZone.classList.remove('dz-over');
    } else if (dropZone && (!e.target.closest || !e.target.closest('#item-drop-new'))) {
      dropZone.classList.add('dz-over');
    }
  });

  tree.addEventListener('dragleave', (e) => {
    if (e.target === tree || !tree.contains(e.relatedTarget)) clearMarks();
  });

  // ---- 松手：归类 ----
  tree.addEventListener('drop', async (e) => {
    if (!dragging) return;
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('application/x-lesp-collection')) return;
    e.preventDefault();
    e.stopPropagation();
    const onNew = !!(e.target.closest && e.target.closest('#item-drop-new'));
    const cid = collectionIdFrom(e.target);
    const item = dragging;
    endDrag();
    if (onNew) { await createAndAssign(item); return; }
    if (!cid) { toast('请拖到具体的分类上'); return; }
    await assign(item, cid);
  });

  // 拖到分类树之外松手 = 取消，不做任何事（浏览器默认不触发 drop）

  // ---- 「＋新建分类」放置区 ----
  function showDropZone() {
    if (dropZone) return;
    dropZone = document.createElement('div');
    dropZone.id = 'item-drop-new';
    dropZone.className = 'item-drop-new';
    dropZone.innerHTML = '<span>＋</span> 新建分类并归入';
    tree.insertBefore(dropZone, tree.firstChild);
  }

  async function createAndAssign(item) {
    // 早期版本用 window.prompt，Electron 不支持（抛错），表现为「点了没反应」→ 改走应用内表单
    if (typeof openForm !== 'function') return toast('表单模块未加载，请刷新页面');
    openForm({
      title: '新建分类并归入',
      fields: [{ name: 'name', label: '分类名称', required: true }],
      submitLabel: '创建并归入',
      onSubmit: async (v) => {
        const title = String(v.name || '').trim();
        if (!title) throw new Error('分类名称不能为空');
        const created = await api('/api/collections', { method: 'POST', body: { name: title, module: MODULE } });
        await assign(item, Number(created.id), created.name);
      }
    });
  }

  async function assign(item, cid, nameOverride) {
    if (item.cols.has(cid)) { toast('《' + item.title + '》已在该分类中'); return; }
    const name = nameOverride || (tree.querySelector('.tree-node[data-id="' + cid + '"] .tree-item') || {}).textContent || '该分类';
    try {
      await api('/api/collections/assign', {
        method: 'POST',
        // 后端 assign 以 target 决定关联表（items / compilations / notes），
        // 并用 target 反推该分类树所属 module 做同栏目校验，故这里必须传对。
        body: { target: TARGET, owner_id: item.id, collection_ids: [cid], mode: 'add' }
      });
      toast('已把《' + item.title + '》归入〈' + String(name).trim() + '》');
      location.reload();                    // 刷新列表：未分类视图下该条目会消失
    } catch (err) {
      // 归类失败时不做刷新，留在原页面并明确报错，用户可重试
      toast('归类失败：' + err.message + '（已保持原归属不变）');
    }
  }

  // 拖拽后紧随的 click 要抑制，否则会误跳到详情页
  list.addEventListener('click', (e) => {
    if (!justDragged) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();
