const db = require('../db');
const { esc, jsonForScript } = require('../lib/render');
const { MODULES } = require('../config/modules');
const { load } = require('../routes/compilations');
const { renderTree } = require('../services/classification-view');

function listPage(collectionId) {
  const C = require('../services/classification');
  const scopeIds = collectionId && collectionId !== 'none' ? C.subtreeIds(db, 'collections', Number(collectionId)) : null;
  const unclassified = collectionId === 'none';
  const rows = scopeIds
    ? db.dbAll(
        `SELECT * FROM compilations c
         WHERE EXISTS (SELECT 1 FROM collection_compilations x WHERE x.compilation_id = c.id AND x.collection_id IN (${scopeIds.map(() => '?').join(',')}))
         ORDER BY updated_at DESC, id DESC`,
        scopeIds
      )
    : unclassified
      ? db.dbAll('SELECT c.* FROM compilations c WHERE NOT EXISTS (SELECT 1 FROM collection_compilations x WHERE x.compilation_id = c.id) ORDER BY updated_at DESC, id DESC')
      : db.dbAll('SELECT * FROM compilations ORDER BY updated_at DESC, id DESC');
  const cards = rows.length
    ? rows.map((c) => {
        const n = db.dbGet('SELECT COUNT(*) c FROM compilation_refs WHERE compilation_id = ?', [c.id]).c;
        let words = 0;
        for (const b of db.dbAll('SELECT lead, content, quote_text, tail FROM compilation_blocks WHERE compilation_id = ?', [c.id])) {
          words += ((b.lead || '') + (b.content || '') + (b.quote_text || '') + (b.tail || '')).length;
        }
        // draggable + data-item-id/data-collections：与史料列表同一套拖拽归类契约（item-drag.js）。
        // data-collections 存该长编已归属的分类 id，拖到已归属的分类时据此提示而不重复写入。
        const cols = db.dbAll('SELECT collection_id id FROM collection_compilations WHERE compilation_id = ? ORDER BY collection_id', [c.id]).map((r) => r.id).join(',');
        return `<a class="li" href="/writing/compilations/${c.id}" draggable="true" data-item-id="${c.id}" data-collections="${cols}" title="可拖到左侧分类上归类">
          <div class="li-title">${esc(c.title)}</div>
          <div class="li-sub">${esc(c.status)} · 已辑 ${n} 条 · ${words} 字 · ${esc(c.updated_at)}</div></a>`;
      }).join('')
    : '<div class="empty">还没有长编，点击「新建长编」开始</div>';

  return `<div class="page-head">
    <div><h1 class="page-title">史料长编</h1>
    <div class="page-sub">${rows.length} 篇 · 摘录插入后自动生成脚注</div></div>
    <div><button id="btn-new-comp" class="primary">新建长编</button></div>
  </div>
  <div class="three-col">
    <aside class="col-tree" data-module="compilation" data-listurl="/writing/compilations">
      <div class="tree-title">我的研究分类</div>
      ${renderTree('compilation', collectionId || null)}
    </aside>
    <section class="col-list"><div class="card"><div class="list-wrap">${cards}</div></div></section>
  </div>
  <script>window.__MODE__ = 'list';</script>`;
}

function blocksHtml(c) {
  const inline = c.footnote_style === 'inline';
  return c.blocks.map((b) => {
    const ref = c.refs.find((r) => r.block_id === b.id);
    const ops = `<div class="blk-ops">
        <button data-act="up" data-id="${b.id}">上移</button>
        <button data-act="down" data-id="${b.id}">下移</button>
        <button data-act="del" data-id="${b.id}">删除</button>
      </div>`;
    if (b.type === 'heading') {
      return `<div class="blk" data-id="${b.id}">
        <input class="blk-heading" data-field="content" data-id="${b.id}" placeholder="小标题" value="${esc(b.content)}">
        ${ops}</div>`;
    }
    if (b.type === 'quote') {
      const mark = ref && !inline ? `<sup class="fn-mark${ref.orphaned ? ' fn-orphan' : ''}">${esc(ref.mark)}</sup>` : '';
      const inlineNote = ref && inline ? `<div class="blk-inline${ref.orphaned ? ' fn-orphan' : ''}">（${esc(ref.text)}）</div>` : '';
      return `<div class="blk blk-quote-box${b.orphaned ? ' blk-orphan' : ''}" data-id="${b.id}">
        <input class="blk-lead" data-field="lead" data-id="${b.id}" placeholder="引导语（可选）" value="${esc(b.lead)}">
        <div class="blk-quote serif">${esc(b.quote_text)}${mark}</div>
        <input class="blk-tail" data-field="tail" data-id="${b.id}" placeholder="后缀说明（可选）" value="${esc(b.tail)}">
        ${inlineNote}
        ${ops}</div>`;
    }
    if (b.type === 'comment') {
      return `<div class="blk" data-id="${b.id}">
        <textarea class="blk-comment" data-field="content" data-id="${b.id}" rows="2" placeholder="按语">${esc(b.content)}</textarea>
        ${ops}</div>`;
    }
    return `<div class="blk" data-id="${b.id}">
      <textarea class="blk-text" data-field="content" data-id="${b.id}" rows="3" placeholder="正文">${esc(b.content)}</textarea>
      ${ops}</div>`;
  }).join('');
}

function drawerHtml(c) {
  const groups = [];
  const rows = db.dbAll(
    'SELECT e.*, i.title item_title, i.module FROM excerpts e JOIN items i ON i.id = e.item_id ORDER BY i.module, i.title, e.seq LIMIT 400'
  );
  for (const r of rows) {
    let g = groups.find((x) => x.module === r.module);
    if (!g) {
      g = { module: r.module, name: MODULES[r.module] ? MODULES[r.module].name : r.module, items: [] };
      groups.push(g);
    }
    g.items.push(r);
  }
  if (!groups.length) return '<div class="empty">还没有录文。先到资料模块给条目添加录文，再来这里插入。</div>';
  return groups.map((g) => `<div class="drawer-group">${esc(g.name)}</div>
    ${g.items.map((e) => `<div class="drawer-card" data-excerpt="${e.id}">
      <div class="dc-item">${esc(e.item_title)}</div>
      <div class="dc-loc">${esc(e.locator)}</div>
      <div class="dc-text serif">${esc(e.text)}</div>
      <button class="dc-insert" data-excerpt="${e.id}">插入</button>
    </div>`).join('')}`).join('');
}

function notesHtml(c) {
  if (c.footnote_style === 'inline') {
    return '<div class="muted-3">当前为夹注格式，出处已内联显示在正文中。</div>';
  }
  if (!c.refs.length) return '<div class="muted-3">插入史料后，注释会自动生成在这里。</div>';
  return c.refs.map((r) => `<div class="fn-line${r.orphaned ? ' fn-orphan' : ''}">
    <span class="fn-mark">${esc(r.mark)}</span> ${esc(r.text)}${r.orphaned ? '（原条目已删除）' : ''}</div>`).join('');
}

function editorPage(id) {
  const c = load(Number(id));
  if (!c) return '<div class="empty">长编不存在</div>';
  const inline = c.footnote_style === 'inline';
  const body = `<div class="page-head">
    <div>
      <input id="comp-title" class="comp-title" value="${esc(c.title)}">
      <div class="page-sub">课题 ${esc(c.project || '—')} · 已辑 ${c.refs.length} 条 · ${c.word_count} 字 · <span id="save-time">尚未保存</span></div>
    </div>
    <div class="head-actions">
      <select id="comp-status">
        ${['进行中', '搁置', '完成'].map((s) => `<option${s === c.status ? ' selected' : ''}>${s}</option>`).join('')}
      </select>
      <button id="btn-style">脚注格式：${inline ? '夹注' : '页下注'}</button>
      <a href="/api/compilations/${c.id}/export"><button>导出 Markdown</button></a>
    </div>
  </div>
  <div class="comp-wrap">
    <aside class="comp-drawer">
      <div class="drawer-title">史料抽屉</div>
      <input id="drawer-search" placeholder="搜索摘录">
      <div class="drawer-list">${drawerHtml(c)}</div>
    </aside>
    <section class="comp-main">
      <div id="blocks" class="blocks">${blocksHtml(c) || '<div class="empty">从左侧史料抽屉插入摘录，或点击下方按钮自己写</div>'}</div>
      <div class="add-row">
        <button data-add="heading">加小标题</button>
        <button data-add="text">加正文</button>
        <button data-add="comment">加按语</button>
      </div>
      <div class="notes-box">
        <div class="notes-title">注释</div>
        <div id="notes">${notesHtml(c)}</div>
      </div>
    </section>
  </div>
  <script>
  window.__MODE__ = 'editor';
  window.__COMPILATION__ = ${jsonForScript({ id: c.id, title: c.title, status: c.status, footnote_style: c.footnote_style })};
  </script>`;
  return body;
}

module.exports = { listPage, editorPage };
