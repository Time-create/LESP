// 分类树渲染（条目与长编/札记共用）：输出嵌套结构 + 折叠按钮 + 条目数。
// 折叠、右键菜单等交互在 public/js/collection-tree.js 中完成。
const db = require('../db');
const { esc } = require('../lib/render');
const { CLASSIFY_MODULES } = require('../config/modules');
const classification = require('./classification');

// 某栏目的归属计数（长编/札记走各自关联表）
function countFn(module) {
  const link = CLASSIFY_MODULES[module] && CLASSIFY_MODULES[module].link
    ? CLASSIFY_MODULES[module].link
    : 'collection_items';
  return (row) => Number(db.dbGet(`SELECT COUNT(*) c FROM ${link} WHERE collection_id = ?`, [row.id]).c);
}

// 归属计数与筛选所依据的实体表：长编/札记各有自己的表，其余六类都在 items
function targetTable(module) {
  const m = CLASSIFY_MODULES[module];
  return m && m.table ? m.table : 'items';
}

/**
 * @param {string} module 栏目键（classics/paper/compilation/note…）
 * @param {number|string|null} activeId 当前选中的分类 id
 * @param {object} options { queryKey: 列表页筛选参数名，默认 collection }
 */
function renderTree(module, activeId, options = {}) {
  const queryKey = options.queryKey || 'collection';
  const cfg = CLASSIFY_MODULES[module] || {};
  const listUrl = cfg.route || (module === 'note' || module === 'compilation' ? cfg.route : '');
  const rows = classification.buildTree(
    db,
    'collections',
    db.dbAll('SELECT * FROM collections WHERE module = ? ORDER BY sort, id', [module]),
    countFn(module)
  );

  const node = (c) => {
    const on = Number(activeId) === c.id ? ' tree-on' : '';
    const hasKids = c.children.length > 0;
    return `<li class="tree-node" data-id="${c.id}" data-parent="${c.parent_id || ''}">`
      + '<div class="tree-row">'
      + (hasKids
        ? `<button type="button" class="tree-toggle" data-toggle="${c.id}" aria-label="展开或收起">▾</button>`
        : '<span class="tree-toggle tree-toggle-empty"></span>')
      + `<a class="tree-item${on}" href="${esc(listUrl)}?${queryKey}=${c.id}" data-collection="${c.id}">${esc(c.name)}</a>`
      + `<span class="tree-count">${esc(c.item_count)}</span>`
      + '</div>'
      + (hasKids ? `<ul class="tree-kids">${c.children.map(node).join('')}</ul>` : '')
      + '</li>';
  };

  const total = Number(db.dbGet(`SELECT COUNT(*) c FROM ${targetTable(module)} WHERE ${moduleIsWriting(module) ? '1=1' : 'module = ?'}`, moduleIsWriting(module) ? [] : [module]).c);
  const link = CLASSIFY_MODULES[module] && CLASSIFY_MODULES[module].link;
  const unclassified = link
    ? Number(db.dbGet(`SELECT COUNT(*) c FROM ${targetTable(module)} t WHERE NOT EXISTS (SELECT 1 FROM ${link} l WHERE l.${module === 'compilation' ? 'compilation_id' : 'note_id'} = t.id)`).c)
    : Number(db.dbGet(
      'SELECT COUNT(*) c FROM items i WHERE i.module = ? AND NOT EXISTS (SELECT 1 FROM collection_items ci WHERE ci.item_id = i.id)',
      [module]
    ).c);

  // 操作区与树列表分区：管理入口独立成块，列表区保持干净、只承载阅读内容
  let html = '<div class="tree-zone tree-zone-ops">'
    + '<div class="tree-zone-title">分类管理</div>'
    + '<div class="tree-zone-ops-row">'
    + '<button type="button" id="btn-new-collection" class="tree-add tree-add-primary">＋ 新建</button>'
    + '<button type="button" id="btn-manage-collection" class="tree-add">管理</button>'
    + '<button type="button" id="btn-tree-collapse-all" class="tree-add tree-add-icon" title="全部收起／展开" aria-label="全部收起或展开">⇅</button>'
    + '</div>'
    + '</div>'
    + '<div class="tree-zone tree-zone-list">'
    + `<a class="tree-item${activeId ? '' : ' tree-on'}" href="${esc(listUrl)}">全部 ${esc(total)}</a>`;
  if (rows.length) html += `<ul class="tree-root">${rows.map(node).join('')}</ul>`;
  else html += '<div class="tree-empty">还没有分类<br><span>用上方「＋ 新建」创建第一个</span></div>';
  if (unclassified > 0) {
    html += `<a class="tree-item${String(activeId) === 'none' ? ' tree-on' : ''}" href="${esc(listUrl)}?${queryKey}=none">未归类 ${esc(unclassified)}</a>`;
  }
  html += '</div>';
  return html;
}

function moduleIsWriting(module) {
  return module === 'compilation' || module === 'note';
}

module.exports = { renderTree, countFn, targetTable, moduleIsWriting };
