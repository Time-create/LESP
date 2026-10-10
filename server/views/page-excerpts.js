// 录文集页面：资料库 → 录文。
//
// 定位（V5.3）：录文是「从史料里摘出的原文片段」，天生归属某个条目。
// 本页不搬数据、不改表结构，只把散在各条目下的录文聚成一个可查阅、可归类的视图。
// 条目详情页的「录文」页签保留（就地对照原文），但分类面板已移除，统一到此处维护。
const { esc } = require('../lib/render');
const hub = require('../services/excerpts-hub');
const taxonomy = require('../services/taxonomy');

/** 分类树。计数用「自身+子树合计」，与点开后的列表条数一致。 */
function treeHtml(nodes, query, queryBase) {
  if (!nodes.length) return '';
  const node = (c) => {
    const hasKids = c.children && c.children.length > 0;
    return `<li class="tree-node" data-id="${c.id}" data-parent="${c.parent_id || ''}">
      <div class="tree-row">
        ${hasKids ? `<button type="button" class="tree-toggle" data-toggle="${c.id}">▾</button>`
                  : '<span class="tree-toggle tree-toggle-empty"></span>'}
        <a class="tree-item tree-as-filter${Number(query.folder) === c.id ? ' tree-on' : ''}"
           href="${queryBase({ folder: c.id, unclassified: '' })}" data-folder-filter="${c.id}">${esc(c.name)}</a>
        <span class="tree-count">${esc(c.total || 0)}</span>
      </div>
      ${hasKids ? `<ul class="tree-kids">${c.children.map(node).join('')}</ul>` : ''}
    </li>`;
  };
  return '<ul class="tree-root">' + nodes.map(node).join('') + '</ul>';
}

/** 未归类徽标：>0 才显示，避免长期挂一个「0」干扰视线。 */
function unclassBadge(n) {
  return n > 0 ? `<span class="tree-count tree-count-warn">${n}</span>` : '<span class="tree-count">0</span>';
}

/** 录文卡片：来源条目 + 出处定位 + 正文 + 分类标签（标签可就地点开改分类）。 */
function cardHtml(r) {
  const tags = r.folders.length
    ? r.folders.map((f) => `<button type="button" class="ex-tag" data-ex-tag="${f.id}"
        data-ex-tag-remove="${r.id}" title="点击移除该分类">${esc(f.name)}<span class="ex-tag-x">×</span></button>`).join('')
    : '<button type="button" class="ex-tag ex-tag-empty" data-ex-tag-add="' + r.id + '">未归类 · 点击归类</button>';
  return `<article class="ex-card" data-ex-card="${r.id}">
    <div class="ex-src">来自<a href="/library/papers/${r.itemId}">${esc(r.itemTitle)}</a></div>
    ${r.locator ? `<div class="ex-loc">${esc(r.locator)}</div>` : ''}
    <div class="ex-text serif">${esc(r.text)}</div>
    ${r.comment ? `<div class="ex-comment">按语：${esc(r.comment)}</div>` : ''}
    <div class="ex-foot">
      <div class="ex-tags">${tags}</div>
      <div class="ex-ops">
        <button type="button" class="ex-op" data-ex-locate="${r.id}" title="在条目中定位这条录文">定位</button>
        <a class="ex-op" href="/library/papers/${r.itemId}#excerpt-${r.id}">来源条目 ›</a>
      </div>
    </div>
  </article>`;
}

/**
 * @param {object} query
 *  - folder / unclassified / q / offset（由路由传入）
 */
function render(query = {}) {
  const view = query.unclassified === 'true'
    ? { title: '未归类', total: hub.list({ unclassified: 'true', limit: 1, offset: 0 }).total }
    : query.folder
      ? (() => {
          const all = taxonomy.listFolders({});
          const find = (nodes, id) => {
            for (const n of nodes) {
              if (n.id === Number(id)) return n;
              const hit = find(n.children || [], id);
              if (hit) return hit;
            }
            return null;
          };
          const node = find(all, query.folder);
          return { title: node ? node.name : '录文', total: hub.list({ folderId: query.folder, limit: 1, offset: 0 }).total };
        })()
      : query.q
        ? { title: '搜索：' + query.q, total: hub.list({ q: query.q, limit: 1, offset: 0 }).total }
        : { title: '全部录文', total: hub.list({ limit: 1, offset: 0 }).total };

  const { tree, total, unclassified } = hub.treeWithCounts();
  const data = hub.list({
    folderId: query.folder,
    unclassified: query.unclassified,
    q: query.q,
    offset: query.offset
  });

  const queryBase = (patch) => {
    const next = Object.assign({ folder: query.folder, unclassified: query.unclassified, q: query.q }, patch);
    const qs = Object.entries(next)
      .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'false')
      .map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    return '/excerpts' + (qs ? '?' + qs : '');
  };
  const self = (patch) => JSON.stringify(Object.assign(
    { folder: query.folder ? Number(query.folder) : '', unclassified: query.unclassified || '', q: query.q || '' },
    patch));

  const noTree = tree.length === 0;

  return `<div class="hub">
  <aside class="hub-side">
    <div class="tree-title">录文分类</div>
    <div class="ex-tree-tools">
      <button type="button" class="btn-primary" data-hub-new-folder>＋ 新建分类</button>
    </div>
    <ul class="tree-root">
      <li class="tree-node">
        <div class="tree-row">
          <span class="tree-toggle tree-toggle-empty"></span>
          <a class="tree-item tree-as-filter${!query.folder && query.unclassified !== 'true' && !query.q ? ' tree-on' : ''}" href="${queryBase({ folder: '', unclassified: '' })}">全部录文</a>
          <span class="tree-count">${esc(total)}</span>
        </div>
      </li>
      <li class="tree-node">
        <div class="tree-row">
          <span class="tree-toggle tree-toggle-empty"></span>
          <a class="tree-item tree-as-filter${query.unclassified === 'true' ? ' tree-on' : ''}" href="${queryBase({ folder: '', unclassified: 'true' })}">未归类</a>
          ${unclassBadge(unclassified)}
        </div>
      </li>
    </ul>
    ${noTree ? '<div class="tree-hint">还没有录文分类。点上方「＋ 新建分类」开始建立。</div>' : treeHtml(tree, query, queryBase)}
    <div class="tree-hint">
      右键分类可重命名 / 新建子级 / 移动 / 删除。<br>
      录文从条目页录入；这里是查阅与归类的地方。
    </div>
  </aside>

  <section class="hub-main">
    <div class="hub-head">
      <h2>${esc(view.title)}</h2>
      <span class="hub-count">${esc(view.total)} 条</span>
      <form class="hub-search" method="get" action="/excerpts">
        ${query.folder ? `<input type="hidden" name="folder" value="${esc(query.folder)}">` : ''}
        <input type="search" name="q" value="${esc(query.q || '')}" placeholder="搜正文、出处或来源题名">
        <button type="submit">检索</button>
      </form>
    </div>
    <div class="hub-list" data-hub-state='${esc(self())}'>
      ${data.rows.length
        ? data.rows.map(cardHtml).join('')
        : '<div class="empty">' + (query.q ? '没有匹配的录文' : '这个分类下还没有录文') + '</div>'}
    </div>
  </section>
</div>`;
}

module.exports = { render };
