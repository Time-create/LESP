const db = require('../db');
const { esc, jsonForScript } = require('../lib/render');
const { MODULES } = require('../config/modules');
const { loadNote } = require('../routes/notes');

function sourceStats() {
  const rows = db.dbAll(
    'SELECT i.module m, COUNT(*) c FROM note_links l JOIN items i ON i.id = l.target_id WHERE l.target_type = ? GROUP BY i.module',
    ['item']
  );
  const comp = db.dbGet('SELECT COUNT(*) c FROM note_links WHERE target_type = ?', ['compilation']).c;
  const map = {};
  for (const r of rows) map[r.m] = r.c;
  return { map, comp };
}

function renderNotesPage(noteId, collectionId) {
  const C = require('../services/classification');
  const scopeIds = collectionId && collectionId !== 'none' ? C.subtreeIds(db, 'collections', Number(collectionId)) : null;
  const notes = scopeIds
    ? db.dbAll(
        `SELECT * FROM notes n
         WHERE EXISTS (SELECT 1 FROM collection_notes x WHERE x.note_id = n.id AND x.collection_id IN (${scopeIds.map(() => '?').join(',')}))
         ORDER BY updated_at DESC, id DESC`,
        scopeIds
      )
    : collectionId === 'none'
      ? db.dbAll('SELECT n.* FROM notes n WHERE NOT EXISTS (SELECT 1 FROM collection_notes x WHERE x.note_id = n.id) ORDER BY updated_at DESC, id DESC')
      : db.dbAll('SELECT * FROM notes ORDER BY updated_at DESC, id DESC');
  const current = noteId ? loadNote(Number(noteId)) : null;

  const list = notes.length
    ? notes.map((n) => {
        const links = db.dbAll('SELECT * FROM note_links WHERE note_id = ?', [n.id]);
        const titles = links.map((l) => {
          if (l.target_type === 'item') {
            const it = db.dbGet('SELECT title FROM items WHERE id = ?', [l.target_id]);
            return it ? it.title : '';
          }
          const c = db.dbGet('SELECT title FROM compilations WHERE id = ?', [l.target_id]);
          return c ? c.title : '';
        }).filter(Boolean);
        // draggable + data-item-id/data-collections：与史料列表同一套拖拽归类契约（item-drag.js）
        const cols = db.dbAll('SELECT collection_id id FROM collection_notes WHERE note_id = ? ORDER BY collection_id', [n.id]).map((r) => r.id).join(',');
        return `<a class="li${current && current.id === n.id ? ' li-on' : ''}" href="/writing/notes/${n.id}" draggable="true" data-item-id="${n.id}" data-collections="${cols}" title="可拖到左侧分类上归类">
          <div class="li-title">${esc(n.title)}</div>
          <div class="li-sub">${esc(titles.join('、') || '未关联')} · ${esc(n.updated_at)}</div></a>`;
      }).join('')
    : '<div class="empty">还没有札记</div>';

  // 候选关联对象：全部条目与长编
  const items = db.dbAll('SELECT id, title, module FROM items ORDER BY updated_at DESC LIMIT 300');
  const comps = db.dbAll('SELECT id, title FROM compilations ORDER BY updated_at DESC LIMIT 100');
  const st = sourceStats();

  const stats = Object.keys(MODULES)
    .map((m) => MODULES[m].name + ' ' + (st.map[m] || 0))
    .join(' · ') + ' · 长编 ' + st.comp;

  const editor = current
    ? `<div class="note-editor">
        <input id="note-title" class="note-title" value="${esc(current.title)}">
        <div class="muted-3" style="margin:6px 0">关联对象</div>
        <div id="note-links">
          ${current.links.map((l) => `<span class="link-chip" data-type="${esc(l.type)}" data-id="${l.id}">${esc(l.title)} ×</span>`).join('') || '<span class="muted-3">未关联</span>'}
        </div>
        <select id="link-picker" style="margin-top:6px">
          <option value="">— 添加关联 —</option>
          ${items.map((i) => `<option value="item:${i.id}">${esc(MODULES[i.module] ? MODULES[i.module].name : i.module)}：${esc(i.title)}</option>`).join('')}
          ${comps.map((c) => `<option value="compilation:${c.id}">长编：${esc(c.title)}</option>`).join('')}
        </select>
        <textarea id="note-body" rows="16" style="margin-top:8px">${esc(current.body)}</textarea>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button id="note-save" class="primary">保存</button>
          <button id="note-del">删除</button>
        </div>
      </div>`
    : '<div class="empty">从左侧选择一篇札记，或点击「写新札记」</div>';

  return `<div class="page-head">
    <div><h1 class="page-title">读书札记</h1>
    <div class="page-sub">${notes.length} 篇 · 按来源：${esc(stats)}</div></div>
    <div><button id="note-new" class="primary">写新札记</button></div>
  </div>
  <div class="three-col">
    <aside class="col-tree" data-module="note" data-listurl="/writing/notes">
      <div class="tree-title">我的研究分类</div>
      ${require('../services/classification-view').renderTree('note', collectionId || null)}
    </aside>
    <aside class="col-list" style="width:220px">${list}</aside>
    <section class="col-detail">${editor}</section>
  </div>
  <script>
  window.__NOTE__ = ${jsonForScript(current ? { id: current.id, title: current.title, body: current.body, links: current.links.map((l) => ({ type: l.type, id: l.id })) } : null)};
  </script>`;
}

module.exports = { renderNotesPage };
