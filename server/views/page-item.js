const db = require('../db');
const { esc, jsonForScript } = require('../lib/render');
const { MODULES } = require('../config/modules');
const { fieldsOf } = require('../config/field-schema');

function parseFields(raw) {
  try {
    return typeof raw === 'object' ? raw : JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
}

function fieldRows(module, fields, opts) {
  const o = opts || {};
  const fullKeys = o.fullKeys || [];                 // 这些字段占满整行（摘要、关键词等）
  return fieldsOf(module)
    .filter((f) => !(o.exclude || []).includes(f.key))
    .map((f) => {
      const v = fields[f.key] == null ? '' : fields[f.key];
      const req = f.required ? ' <span class="req">*</span>' : '';
      const full = fullKeys.includes(f.key) ? ' frow-full' : '';
      return `<div class="frow${full}"><div class="flabel">${esc(f.label)}${req}</div><div class="fvalue">${esc(v) || '<span class="muted-3">—</span>'}</div></div>`;
    })
    .join('');
}

// 全文状态的中文说明（与 cnki_jobs 的状态一一对应）
const FULLTEXT_LABEL = {
  downloaded: '已下载附件',
  need_document_delivery: '需文献传递（当前账号无下载权限）',
  none: '未尝试',
  failed: '下载失败（原因见同步日志）'
};

function statusOptions(module, current) {
  const m = MODULES[module];
  return (m ? m.statuses : [])
    .map((s) => `<option value="${esc(s)}"${s === current ? ' selected' : ''}>${esc(s)}</option>`)
    .join('');
}

// 分类树：与长编/札记共用 services/classification-view.js 的渲染
function treeHtml(module, activeCollection) {
  return require('../services/classification-view').renderTree(module, activeCollection);
}


function tagsHtml(module) {
  const tags = db.dbAll(
    'SELECT t.*, COUNT(it.item_id) n FROM tags t JOIN item_tags it ON it.tag_id = t.id ' +
    'JOIN items i ON i.id = it.item_id WHERE i.module = ? GROUP BY t.id ORDER BY n DESC LIMIT 20',
    [module]
  );
  if (!tags.length) return '<div class="muted-3">暂无标签</div>';
  return tags.map((t) => `<a class="tag-chip" href="${esc(MODULES[module].route)}?tag=${t.id}">${esc(t.name)} ${esc(t.n)}</a>`).join('');
}

// 列表与概览共用的筛选条件：概览必须跟随当前分类/标签/检索范围，
// 否则左边选了某个分类、右边却显示别的分类条目，会让人困惑。
function buildFilter(module, collectionId, tagId, q) {
  const where = ['i.module = ?'];
  const params = [module];
  if (collectionId === 'none') {
    where.push('NOT EXISTS (SELECT 1 FROM collection_items ci WHERE ci.item_id = i.id)');
  } else if (collectionId) {
    // 与 /api/items 保持一致：默认含子分类
    const ids = require('../services/classification').subtreeIds(db, 'collections', Number(collectionId));
    where.push('EXISTS (SELECT 1 FROM collection_items ci WHERE ci.item_id = i.id AND ci.collection_id IN (' + ids.map(() => '?').join(',') + '))');
    params.push(...ids);
  }
  if (tagId) {
    where.push('EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = i.id AND it.tag_id = ?)');
    params.push(Number(tagId));
  }
  if (q) {
    const { searchFts } = require('../db');
    const ids = searchFts(q);
    if (!ids.length) return null; // 无命中
    where.push('i.id IN (' + ids.map(() => '?').join(',') + ')');
    params.push(...ids);
  }
  return { whereSql: where.join(' AND '), params };
}

function listHtml(module, collectionId, tagId, q, activeId) {
  const filter = buildFilter(module, collectionId, tagId, q);
  if (!filter) return '<div class="empty">没有匹配的条目</div>';
  const rows = db.dbAll(
    'SELECT i.* FROM items i WHERE ' + filter.whereSql + ' ORDER BY i.updated_at DESC, i.id DESC LIMIT 200',
    filter.params
  );
  if (!rows.length) {
    return '<div class="empty">此分类下暂无条目。<br>需要新增时点右上角「新建条目」。</div>';
  }
  const base = MODULES[module].route;
  // 一次取回本批条目已归入的分类，供拖拽时判断「是否已在该分类」（避免逐条查询）
  const ids = rows.map((r) => r.id);
  const links = db.dbAll(
    'SELECT item_id, collection_id FROM collection_items WHERE item_id IN (' + ids.map(() => '?').join(',') + ')',
    ids
  );
  const byItem = new Map();
  for (const l of links) {
    if (!byItem.has(l.item_id)) byItem.set(l.item_id, []);
    byItem.get(l.item_id).push(l.collection_id);
  }
  return rows
    .map((r) => {
      const f = parseFields(r.fields);
      const sub = fieldsOf(module)
        .filter((x) => x.list)
        .map((x) => f[x.key])
        .filter(Boolean)
        .join(' · ');
      const qs = collectionId ? '?collection=' + collectionId : '';
      const on = r.id === activeId ? ' li-on' : '';
      const cols = (byItem.get(r.id) || []).join(',');
      return `<a class="li${on}" href="${esc(base)}/${r.id}${esc(qs)}" draggable="true" data-item-id="${r.id}" data-collections="${cols}" title="可拖到左侧分类上归类">
        <div class="li-title">${esc(r.title)}</div>
        <div class="li-sub">${esc(sub || r.subtitle || '')}</div></a>`;
    })
    .join('');
}

function overviewHtml(module, filter, scopeLabel) {
  const m = MODULES[module];
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  if (!filter) {
    return `<div class="empty empty-guide">
      <div class="eg-title">${esc(scopeLabel || m.name)}下没有匹配的条目</div>
      <div class="muted-3">换个分类或清空检索条件看看；也可以随时从左侧导航去其他模块。</div>
      <div class="eg-actions"><a href="${esc(m.route)}"><button>查看全部</button></a></div>
    </div>`;
  }

  const total = db.dbGet('SELECT COUNT(*) c FROM items i WHERE ' + filter.whereSql, filter.params).c;
  const colCount = db.dbGet('SELECT COUNT(*) c FROM collections WHERE module = ?', [module]).c;
  const monthNew = db.dbGet(
    'SELECT COUNT(*) c FROM items i WHERE ' + filter.whereSql + ' AND i.created_at LIKE ?',
    filter.params.concat([monthPrefix + '%'])
  ).c;

  if (total === 0) {
    return `<div class="empty empty-guide">
      <div class="eg-title">${esc(scopeLabel || m.name)}下还没有条目</div>
      <div class="muted-3">可以先新建一条条目，再到条目里录入原文与上传附件。也可以什么都不做，随时从左侧导航去其他模块。</div>
      <div class="eg-actions">
        <button id="btn-new" class="primary">新建条目</button>
        <a href="/"><button>回首页总览</button></a>
      </div>
    </div>`;
  }

  const recent = db.dbAll(
    'SELECT i.* FROM items i WHERE ' + filter.whereSql + ' ORDER BY i.updated_at DESC, i.id DESC LIMIT 5',
    filter.params
  );
  const recentHtml = recent.map((r) => {
    const f = parseFields(r.fields);
    const sub = fieldsOf(module).filter((x) => x.list).map((x) => f[x.key]).filter(Boolean).join(' · ');
    return `<a class="li" href="${esc(m.route)}/${r.id}">
      <div class="li-title">${esc(r.title)}</div>
      <div class="li-sub">${esc(sub || r.subtitle || '')} · ${esc(r.updated_at)}</div></a>`;
  }).join('');

  const firstLabel = scopeLabel && scopeLabel !== m.name ? scopeLabel : '本模块条目';

  return `<div class="overview-stat">
      <div class="ov-card"><div class="ov-label">${esc(firstLabel)}</div><div class="ov-num">${total}</div></div>
      <div class="ov-card"><div class="ov-label">研究分类</div><div class="ov-num">${colCount}</div></div>
      <div class="ov-card"><div class="ov-label">本月新增</div><div class="ov-num">${monthNew}</div></div>
    </div>
    <div class="card-title">最近更新</div>
    <div class="list-wrap">${recentHtml}</div>
    <div class="muted-3" style="margin-top:10px">从左侧列表选择一条条目查看细节；需要新增时再点「新建条目」。</div>
    <div class="eg-actions" style="margin-top:10px;display:flex;gap:8px">
      <button id="btn-new" class="primary">新建条目</button>
      <a href="/"><button>回首页总览</button></a>
    </div>`;
}

function detailHtml(module, item, filter, scopeLabel) {
  if (!item) return overviewHtml(module, filter, scopeLabel);
  const f = parseFields(item.fields);

  const linkedNotes = db.dbAll(
    'SELECT n.* FROM notes n JOIN note_links l ON l.note_id = n.id WHERE l.target_type = ? AND l.target_id = ? ORDER BY n.updated_at DESC',
    ['item', item.id]
  );
  const linkedComps = db.dbAll(
    'SELECT DISTINCT c.* FROM compilations c JOIN compilation_refs r ON r.compilation_id = c.id WHERE r.item_id = ? ORDER BY c.updated_at DESC',
    [item.id]
  );

  const tabs = [
    ['excerpts', '录文 ' + item.excerpts.length],
    ['attachments', '附件 ' + item.attachments.length],
    ['notes', '笔记 ' + linkedNotes.length],
    ['compilations', '关联长编 ' + linkedComps.length]
  ];
  const tabHtml = tabs.map(([k, label], i) => `<span class="tab${i === 0 ? ' tab-on' : ''}" data-tab="${k}">${esc(label)}</span>`).join('');

  const excerptHtml = item.excerpts.length
    ? item.excerpts.map((e) => `<div class="quote" id="excerpt-${e.id}" data-excerpt-card="${e.id}">
        <div class="quote-loc">${esc(e.locator)}</div>
        <div class="quote-text serif">${esc(e.text)}</div>
        ${e.comment ? `<div class="quote-comment">按语：${esc(e.comment)}</div>` : ''}
        <div><button data-excerpt-action="edit" data-id="${e.id}">编辑录文</button> <button data-excerpt-action="delete" data-id="${e.id}">删除录文</button></div>
      </div>`).join('')
    : '<div class="empty">尚未录入原文</div>';

  const attList = item.attachments.length
    ? item.attachments.map((a) => `<div class="att" data-att="${a.id}">
        <div class="att-main">
          <div class="att-name">${esc(a.filename)}</div>
          <div class="muted-3">${(a.size / 1024).toFixed(0)} KB · <a href="/reader/${a.id}" target="_blank">在阅读器中打开</a></div>
        </div>
        <button class="att-del" data-att-delete="${a.id}">删除</button>
      </div>`).join('')
    : '<div class="empty">暂无附件</div>';
  const attHtml = `<div class="upload-row">
      <input type="file" id="att-file" accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif">
      <button id="btn-upload" class="primary">上传附件</button>
      <span class="muted-3">支持 PDF / JPG / PNG / TIFF，单文件上限 200 MB</span>
    </div>${attList}`;

  return `<div class="crumb">
      <a href="${esc(MODULES[module].route)}">← 返回${esc(MODULES[module].name)}列表</a>
      <span class="muted-3">·</span>
      <a href="/">首页总览</a>
    </div>
    <div class="detail-head">
      <div>
        <h2 class="detail-title serif">${esc(item.title)}</h2>
        <div class="page-sub">${esc(item.subtitle || '')} · ${esc(MODULES[module].name)} · 更新于 ${esc(item.updated_at)}</div>
      </div>
      <div class="detail-actions">
        <button id="btn-new" class="primary">新建条目</button>
        <button id="btn-edit" data-id="${item.id}">编辑</button>
        <button id="btn-del" data-id="${item.id}">删除</button>
      </div>
    </div>
    <div class="fgrid">${fieldRows(module, f, module === 'paper' ? {
      exclude: ['source'],
      fullKeys: ['abstract', 'keywords', 'affiliation']
    } : {})}
      <div class="frow"><div class="flabel">状态</div><div class="fvalue">${esc(item.status)}</div></div>
      <div class="frow"><div class="flabel">分类</div><div class="fvalue">${item.collections.map((c) => esc(c.name)).join('、') || '<span class="muted-3">—</span>'}</div></div>
      <div class="frow"><div class="flabel">标签</div><div class="fvalue">${item.tags.map((t) => esc(t.name)).join('、') || '<span class="muted-3">—</span>'}</div></div>
    </div>
    ${module === 'paper' && f.dedup_key ? `<div class="sync-meta">
      <div class="sync-meta-title">同步信息（来自浏览器扩展）</div>
      <div class="fgrid">
        <div class="frow"><div class="flabel">抓取来源</div><div class="fvalue">${esc(f.source || '')}</div></div>
        <div class="frow"><div class="flabel">元数据等级</div><div class="fvalue">${f.meta_level === 'full' ? '完整（含摘要）' : '部分（缺摘要或年份）'}</div></div>
        <div class="frow"><div class="flabel">全文状态</div><div class="fvalue">${esc(FULLTEXT_LABEL[f.fulltext_status] || f.fulltext_status || '—')}</div></div>
        ${f.pub_time ? `<div class="frow"><div class="flabel">出版时间</div><div class="fvalue">${esc(f.pub_time)}</div></div>` : ''}
        ${f.page_url ? `<div class="frow frow-full"><div class="flabel">原文页面</div><div class="fvalue"><a href="${esc(f.page_url)}" target="_blank" rel="noopener">${esc(f.page_url)}</a></div></div>` : ''}
      </div>
    </div>` : ''}
    <div class="tabs">${tabHtml}</div>
    <div id="tab-excerpts" class="tabpane">
      <div class="excerpt-list-col">${excerptHtml}</div>
    </div>
    <div id="tab-attachments" class="tabpane" hidden>${attHtml}</div>
    <div id="tab-notes" class="tabpane" hidden>
      <div style="margin-bottom:8px"><a href="/writing/notes/new?link=item:${item.id}"><button class="primary">就此写札记</button></a></div>
      ${linkedNotes.length
        ? linkedNotes.map((n) => `<a class="li" href="/writing/notes/${n.id}">
            <div class="li-title">${esc(n.title)}</div>
            <div class="li-sub">${esc(n.updated_at)}</div></a>`).join('')
        : '<div class="empty">还没有关联札记</div>'}
    </div>
    <div id="tab-compilations" class="tabpane" hidden>
      ${linkedComps.length
        ? linkedComps.map((c) => `<a class="li" href="/writing/compilations/${c.id}">
            <div class="li-title">${esc(c.title)}</div>
            <div class="li-sub">${esc(c.status)} · ${esc(c.updated_at)}</div></a>`).join('')
        : '<div class="empty">尚未被长编引用</div>'}
    </div>`;
}

function formHtml(module) {
  const fields = fieldsOf(module);
  return `<div class="fgrid">
    <div class="frow"><div class="flabel">标题<span class="req">*</span></div>
      <div class="fvalue"><input id="f-title" style="width:100%"></div></div>
    <div class="frow"><div class="flabel">副标题</div>
      <div class="fvalue"><input id="f-subtitle" style="width:100%"></div></div>
    ${fields.map((f) => {
      let input;
      if (f.type === 'enum') {
        input = `<select id="f-${f.key}"><option value="">—</option>${f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`;
      } else if (f.type === 'textarea') {
        input = `<textarea id="f-${f.key}" rows="3"></textarea>`;
      } else {
        input = `<input id="f-${f.key}" type="${f.type === 'number' ? 'number' : 'text'}" style="width:100%">`;
      }
      const req = f.required ? '<span class="req">*</span>' : '';
      return `<div class="frow"><div class="flabel">${esc(f.label)}${req}</div><div class="fvalue">${input}</div></div>`;
    }).join('')}
    <div class="frow"><div class="flabel">状态</div>
      <div class="fvalue"><select id="f-status">${statusOptions(module, '')}</select></div></div>
    <div class="frow"><div class="flabel">分类</div>
      <div class="fvalue"><input id="f-collections" placeholder="多个分类用逗号分隔" style="width:100%"></div></div>
    <div class="frow"><div class="flabel">标签</div>
      <div class="fvalue"><input id="f-tags" placeholder="多个标签用逗号分隔" style="width:100%"></div></div>
  </div>`;
}

function renderItemPage({ module, item, collectionId, tagId, q }) {
  const m = MODULES[module];
  const route = m.route;
  const qs = collectionId ? '?collection=' + collectionId : '';

  // 当前浏览范围的名称，用于概览标题与返回入口
  let scopeName = m.name;
  if (collectionId === 'none') {
    scopeName = '未归类';
  } else if (collectionId) {
    const c = db.dbGet('SELECT * FROM collections WHERE id = ?', [Number(collectionId)]);
    scopeName = c ? c.name : m.name;
  } else if (tagId) {
    const t = db.dbGet('SELECT * FROM tags WHERE id = ?', [Number(tagId)]);
    scopeName = t ? '标签：' + t.name : m.name;
  }
  const body = `
<div class="page-head">
  <div>
    <h1 class="page-title">${esc(m.name)}</h1>
    <div class="page-sub">${esc(db.dbGet('SELECT COUNT(*) c FROM items WHERE module = ?', [module]).c)} 条 · 字段按${esc(m.name)}场景定制</div>
  </div>
  <div class="head-actions">
    <form action="/search" method="get" style="display:flex;gap:6px">
      <input name="q" placeholder="检索本模块" value="${esc(q || '')}">
      <input type="hidden" name="module" value="${esc(module)}">
      <button type="submit">检索</button>
    </form>
    <button id="btn-new-top" class="primary">新建条目</button>
  </div>
</div>
<div class="three-col" id="three-col">
  <aside class="col-tree" data-module="${esc(module)}" data-listurl="${esc(MODULES[module].route)}">
    ${treeHtml(module, collectionId ? Number(collectionId) : null)}
    <div class="tree-zone tree-zone-head">标签</div>
    <div class="tree-zone tree-zone-body"><div class="tag-wrap">${tagsHtml(module)}</div></div>
    <div class="theme-tree">
      <div class="tree-zone tree-zone-ops">
        <div class="tree-zone-title">主题树</div>
        <div class="tree-zone-btns">
          <button type="button" data-theme-action="new" title="新建顶级主题">＋ 主题</button>
          <button type="button" data-theme-action="manage" title="主题的批量新建/编辑/删除">管理</button>
        </div>
      </div>
      <div class="theme-tree-body"></div>
    </div>
  </aside>
  <section class="col-list">
    <div class="list-wrap">${listHtml(module, collectionId, tagId, q, item ? item.id : null)}</div>
  </section>
  <section class="col-detail" id="detail">
    ${detailHtml(module, item, buildFilter(module, collectionId, tagId, q), scopeName)}
  </section>
</div>
<div class="too-narrow">窗口宽度不足 880px，三栏会显得拥挤，建议放大窗口</div>


<div id="modal" class="modal" hidden>
  <div class="modal-box">
    <div class="modal-head"><span id="modal-title">新建条目</span><button id="modal-close">关闭</button></div>
    <div class="modal-body">${formHtml(module)}</div>
    <div class="modal-foot">
      <button id="modal-cancel">取消</button>
      <button id="modal-save" class="primary">保存</button>
    </div>
  </div>
</div>
<script>
window.__MODULE__ = ${jsonForScript(module)};
window.__ROUTE__ = ${jsonForScript(route)};
window.__ITEM_ID__ = ${jsonForScript(item ? item.id : 0)};
window.__FIELDS__ = ${jsonForScript(fieldsOf(module))};
window.__MODULE_ROUTE__ = ${jsonForScript(MODULES[module].route)};
window.__ROUTE__ = ${jsonForScript(route)};
window.__QS__ = ${jsonForScript(qs)};
window.__SCHEMA__ = ${jsonForScript(fieldsOf(module))};
window.__ITEM__ = ${jsonForScript(item ? { id: item.id, title: item.title, subtitle: item.subtitle, status: item.status, fields: parseFields(item.fields), excerpts: item.excerpts, collections: item.collections.map((c) => c.name), tags: item.tags.map((t) => t.name) } : null)};
</script>`;

  return body;
}

/**
 * V5 右栏详情片段：与详情页共用 detailHtml（不另写一套，避免两边分叉）。
 *
 * V5.3 修复：右栏里的「编辑」「上传附件」此前点了完全没反应。原因是
 * 这两个处理器都依赖 window.__ITEM__ 与自身的 input/btn 元素，
 * 而本片段只输出 HTML、由detail-panel.js 用 innerHTML 插入——
 *   1) 片段不带 item 数据 → window.__ITEM__ 仍是列表页的 null → 前置守卫拦下；
 *   2) upload.js / item.js 在页面加载时就已执行完，那时按钮还不存在 → 永不绑定。
 * （诊断面板显示「已捕获点击 N 次」正是因为事件到了 DOM，只是没有处理器。）
 *
 * 现在把 item 数据随片段一起输出，并由 detail-panel.js 在插入后触发重新绑定。
 * 完整页行为不变（那条路径本就正常）。
 */
function renderPanel({ module, item, collectionId, tagId, q }) {
  if (!module || !MODULES[module]) return '<div class="empty">栏目无效</div>';
  if (!item) return detailHtml(module, null, buildFilter(module, collectionId, tagId, q), MODULES[module].name);
  const inner = detailHtml(module, item, buildFilter(module, collectionId, tagId, q), MODULES[module].name);
  // 与完整页的 window.__ITEM__ 结构保持一致，避免两处逻辑分叉
  return `<div class="panel-item-scope" data-panel-item='${jsonForScript({
    id: item.id, title: item.title, subtitle: item.subtitle, status: item.status,
    fields: parseFields(item.fields), excerpts: item.excerpts,
    collections: item.collections.map((c) => c.name), tags: item.tags.map((t) => t.name)
  })}'>${inner}</div>`;
}

module.exports = { renderItemPage, renderPanel, detailHtml };
