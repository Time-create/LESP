// 分类管理面板：在一个对话框里完成 新建 / 新建子级 / 编辑 / 移动 / 删除 / 刷新，
// 并明确区分加载中、空数据、加载失败三种状态。
// 说明：Electron 不支持 window.prompt，早期实现用它导致「点了没反应」，此处统一走 openForm。
(function () {
  window.openClassifyManager = function (scope, module) {
    scope = scope || 'collection';
    const A = window.classifyActions;
    const TITLES = { collection: '史料分类', folder: '录文分类', theme: '主题分类' };

    const dialog = document.createElement('dialog');
    dialog.className = 'wb-dialog classify-manager';
    dialog.innerHTML = '<form method="dialog"><h2>' + (TITLES[scope] || '分类管理') + '</h2>'
      + '<div class="cm-toolbar"><button type="button" class="primary" data-act="create">＋ 新建分类</button>'
      + '<button type="button" data-act="refresh">刷新</button>'
      + '<span class="muted-3" data-role="summary"></span></div>'
      + '<div class="cm-body" data-role="body">加载中…</div>'
      + '<div class="dialog-actions"><button type="button" data-act="close">关闭</button></div></form>';
    document.body.appendChild(dialog);
    dialog.querySelector('[data-act=close]').onclick = () => { dialog.close(); dialog.remove(); };

    const body = dialog.querySelector('[data-role=body]');
    const summary = dialog.querySelector('[data-role=summary]');

    async function refresh() {
      body.textContent = '加载中…';
      body.className = 'cm-body';
      let tree = [];
      try {
        tree = await A.loadTree(scope, module);
      } catch (e) {
        body.className = 'cm-body cm-error';
        body.innerHTML = '<p>加载失败：' + esc(e.message) + '</p><button type="button" data-act="retry">重试</button>';
        body.querySelector('[data-act=retry]').onclick = refresh;
        return;
      }
      const rows = A.flatten(tree);
      summary.textContent = rows.length ? rows.length + ' 个分类' : '';
      if (!rows.length) {
        body.className = 'cm-body cm-empty';
        body.innerHTML = '<p class="muted-3">还没有分类。点「＋ 新建分类」创建第一个。</p>';
        return;
      }
      body.className = 'cm-body';
      const node = (r) => '<div class="cm-row" data-id="' + r.id + '" style="padding-left:' + (r.depth * 16) + 'px">'
        + '<span class="cm-name" title="' + esc(r.description || '') + '">' + esc(r.name) + '</span>'
        + (r.description ? '<span class="cm-desc">' + esc(r.description) + '</span>' : '')
        + '<span class="cm-count">' + r.count + '</span>'
        + '<span class="cm-ops">'
        + '<button type="button" data-op="sub" data-id="' + r.id + '">新建子级</button>'
        + '<button type="button" data-op="edit" data-id="' + r.id + '">编辑</button>'
        + (r.depth > 0 ? '<button type="button" data-op="move" data-id="' + r.id + '">移动</button>' : '')
        + '<button type="button" data-op="del" data-id="' + r.id + '">删除</button>'
        + '</span></div>';
      body.innerHTML = rows.map(node).join('');
    }

    // 面板内改动只刷新面板自己，页面左侧的分类树不会变——
    // 用户看到「面板里有了、树里没有」，表现为「管理分类无效」。
    // 结构性改动（新建/改名/移动/删除）完成后连带刷新页面，让两处保持一致。
    // 注意：删除走onDone(null)、其余走 onDone(对象)，不能用参数值判断是否刷新。
    const done = () => { refresh(); location.reload(); };

    dialog.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (act) {
        if (act.dataset.act === 'create') {
          // 上级选项应来自真实分类树（原先传 flatten([])，等于永远只能建顶级分类）
          A.loadTree(scope, module).then((t) => {
            A.edit({ scope, module, parentOptions: A.parentOptions(A.flatten(t)), onDone: done });
          }).catch((err) => toast('加载分类失败：' + err.message));
          return;
        }
        if (act.dataset.act === 'refresh') { refresh(); return; }
        return;
      }
      const op = e.target.closest('[data-op]');
      if (!op) return;
      const id = Number(op.dataset.id);
      A.loadTree(scope, module).then((tree) => {
        const rows = A.flatten(tree);
        const row = rows.find((r) => r.id === id);
        if (!row) { toast('分类不存在'); refresh(); return; }
        if (op.dataset.op === 'sub') {
          A.edit({ scope, module, parentId: row.id, parentOptions: A.parentOptions(rows, [row.id]), onDone: done });
        } else if (op.dataset.op === 'edit') {
          A.edit({
            scope, module, id: row.id, defaultName: row.name, defaultDescription: row.description,
            parentId: row.parentId, parentOptions: A.parentOptions(rows, subtreeIds(rows, row.id)), onDone: done
          });
        } else if (op.dataset.op === 'move') {
          A.move({ scope, module, id: row.id, name: row.name, description: row.description, parentId: row.parentId, parentOptions: A.parentOptions(rows, subtreeIds(rows, row.id)), onDone: done });
        } else if (op.dataset.op === 'del') {
          A.remove({ scope, module, id: row.id, name: row.name, onDone: done });
        }
      }).catch((err) => toast('操作失败：' + err.message));
    });

    refresh();
    dialog.showModal();
    return dialog;
  };

  // 某节点及其后代的 id（编辑/移动时不能选自己或自己的后代当上级）
  function subtreeIds(rows, rootId) {
    const out = [String(rootId)];
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of rows) {
        if (r.parentId && out.includes(String(r.parentId)) && !out.includes(String(r.id))) {
          out.push(String(r.id));
          grew = true;
        }
      }
    }
    return out;
  }
})();
