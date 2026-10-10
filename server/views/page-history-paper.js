// 史学论文页面：与史料长编同构，但不含分类树（按需求不设分类），状态为论文语境四态。
const db = require('../db');
const { esc } = require('../lib/render');
const { load } = require('../routes/history-papers');

const STATUSES = ['拟写', '写作中', '已完稿', '已发表'];

function listPage() {
  const rows = db.dbAll('SELECT * FROM history_papers ORDER BY updated_at DESC, id DESC');
  const cards = rows.length
    ? rows.map((p) => {
        const info = load(p.id);
        const n = info ? info.quote_count : 0;
        const words = info ? info.word_count : 0;
        return `<a class="li" href="/writing/history-papers/${p.id}">
          <div class="li-title">${esc(p.title)}</div>
          <div class="li-sub">${esc(p.status)} · 引用 ${n} 条 · ${words} 字 · ${esc(p.updated_at)}</div></a>`;
      }).join('')
    : '<div class="empty">还没有史学论文，点击「新建论文」开始</div>';

  return `<div class="page-head">
    <div><h1 class="page-title">史学论文</h1>
    <div class="page-sub">${rows.length} 篇 · 引用摘录后自动生成脚注</div></div>
    <div><button id="btn-new-paper" class="primary">新建论文</button></div>
  </div>
  <div class="list-wrap">${cards}</div>`;
}

function editorPage(id) {
  const p = load(id);
  if (!p) return '<div class="empty">这篇论文不存在。<br><a href="/writing/history-papers">返回史学论文列表</a></div>';
  return `<div class="list-wrap" id="paper-meta"
    data-id="${p.id}"
    data-title="${esc(p.title)}"
    data-status="${esc(p.status)}">
    <div class="page-head">
      <div><h1 class="page-title">${esc(p.title)}</h1>
      <div class="page-sub">史学论文</div></div>
      <div class="inline-form">
        <label>标题 <input id="paper-title" value="${esc(p.title)}"></label>
        <label>状态
          <select id="paper-status">
            ${STATUSES.map((s) => `<option${s === p.status ? ' selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
        <label>所属项目 <input id="paper-project" value="${esc(p.project || '')}"></label>
      </div>
    </div>
  </div>`;
}

module.exports = { listPage, editorPage, STATUSES };
