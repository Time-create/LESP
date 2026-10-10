const db = require('../db');
const { esc, jsonForScript } = require('../lib/render');
const { STATUSES } = require('../routes/ideas');

const STATUS_CLASS = {
  '念头': 'st-gray',
  '孵化中': 'st-orange',
  '可开题': 'st-green',
  '已放弃': 'st-gray'
};

function renderIdeasPage() {
  const ideas = db.dbAll('SELECT * FROM ideas ORDER BY updated_at DESC, id DESC');
  const groups = {};
  for (const s of STATUSES) groups[s] = [];
  for (const i of ideas) {
    const links = db.dbAll('SELECT * FROM idea_links WHERE idea_id = ?', [i.id]);
    const itemCount = links.filter((l) => l.target_type === 'item').length;
    (groups[i.status] || groups['念头']).push(Object.assign({}, i, { item_count: itemCount }));
  }

  const sections = STATUSES.map((s) => {
    const list = groups[s];
    const cards = list.length
      ? list.map((i) => {
          const canConvert = s === '可开题';
          return `<div class="idea-card">
            <div class="idea-title"><a href="/writing/ideas/${i.id}">${esc(i.title)}</a></div>
            ${i.summary ? `<div class="idea-summary">${esc(i.summary)}</div>` : ''}
            <div class="idea-meta">已附史料 ${i.item_count} 条${i.next_step ? ' · 下一步：' + esc(i.next_step) : ''}</div>
            <div class="idea-ops">
              ${STATUSES.filter((x) => x !== s).map((x) => `<button data-act="status" data-id="${i.id}" data-status="${esc(x)}">转为${esc(x)}</button>`).join('')}
              <button data-act="convert" data-id="${i.id}" class="primary"${canConvert ? '' : ' disabled'}>创建长编</button>
              <button data-act="del" data-id="${i.id}">删除</button>
            </div>
          </div>`;
        }).join('')
      : '<div class="muted-3" style="padding:4px 0">暂无</div>';
    return `<div class="idea-group">
      <div class="idea-group-head"><span class="badge ${STATUS_CLASS[s]}">${esc(s)}</span> <span class="muted-3">${list.length}</span></div>
      ${cards}</div>`;
  }).join('');

  return `<div class="page-head">
    <div><h1 class="page-title">选题灵感</h1>
    <div class="page-sub">${ideas.length} 个 · 材料够了就转为「可开题」，可一键建长编</div></div>
    <div><button id="idea-new" class="primary">记下一个念头</button></div>
  </div>
  ${sections}
  <script>window.__IDEAS_COUNT__ = ${ideas.length};</script>`;
}

module.exports = { renderIdeasPage };
