const db = require('../db');
const { esc } = require('../lib/render');
const { MODULES } = require('../config/modules');

function count(sql, params = []) {
  return db.dbGet(sql, params).c;
}

function renderHome() {
  const now = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${week}`;

  const sourceTotal = count('SELECT COUNT(*) c FROM items');
  const paperBook = count("SELECT COUNT(*) c FROM items WHERE module = 'paper' OR module = 'book'");
  const compCount = count('SELECT COUNT(*) c FROM compilations');
  const noteCount = count('SELECT COUNT(*) c FROM notes');
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthNew = count('SELECT COUNT(*) c FROM items WHERE created_at LIKE ?', [monthPrefix + '%']);

  const comps = db.dbAll('SELECT * FROM compilations ORDER BY updated_at DESC LIMIT 3');
  const compHtml = comps.length
    ? comps.map((c) => {
        const n = count('SELECT COUNT(*) c FROM compilation_refs WHERE compilation_id = ?', [c.id]);
        let words = 0;
        for (const b of db.dbAll('SELECT lead, content, quote_text, tail FROM compilation_blocks WHERE compilation_id = ?', [c.id])) {
          words += ((b.lead || '') + (b.content || '') + (b.quote_text || '') + (b.tail || '')).length;
        }
        return `<a class="li" href="/writing/compilations/${c.id}">
          <div class="li-title">${esc(c.title)}</div>
          <div class="li-sub">已辑 ${n} 条 · ${words} 字 · ${esc(c.updated_at)}</div></a>`;
      }).join('')
    : '<div class="empty">还没有长编</div>';

  const notes = db.dbAll('SELECT * FROM notes ORDER BY updated_at DESC LIMIT 3');
  const noteHtml = notes.length
    ? notes.map((n) => {
        const l = db.dbGet('SELECT * FROM note_links WHERE note_id = ? LIMIT 1', [n.id]);
        let target = '';
        if (l) {
          if (l.target_type === 'item') {
            const it = db.dbGet('SELECT title FROM items WHERE id = ?', [l.target_id]);
            target = it ? '关联条目：' + it.title : '';
          } else {
            const c = db.dbGet('SELECT title FROM compilations WHERE id = ?', [l.target_id]);
            target = c ? '关联长编：' + c.title : '';
          }
        }
        return `<a class="li" href="/writing/notes/${n.id}">
          <div class="li-title">${esc(n.title)}</div>
          <div class="li-sub">${esc(target || '未关联')} · ${esc(n.updated_at)}</div></a>`;
      }).join('')
    : '<div class="empty">还没有札记</div>';

  const ideas = db.dbAll("SELECT * FROM ideas WHERE status != '已放弃' ORDER BY updated_at DESC LIMIT 3");
  const ideaHtml = ideas.length
    ? `<div class="idea-row">${ideas.map((i) => {
        const n = count("SELECT COUNT(*) c FROM idea_links WHERE idea_id = ? AND target_type = 'item'", [i.id]);
        return `<a class="stat-card" href="/writing/ideas">
          <div class="sc-title">${esc(i.title)}</div>
          <div class="sc-sub">${esc(i.status)} · 已附 ${n} 条史料</div></a>`;
      }).join('')}</div>`
    : '<div class="empty">还没有灵感</div>';

  const recent = db.dbAll('SELECT * FROM items ORDER BY created_at DESC, id DESC LIMIT 5');
  const recentHtml = recent.length
    ? recent.map((r) => {
        const m = MODULES[r.module];
        return `<a class="chip-link" href="${esc(m ? m.route : '/')}/${r.id}">${esc(m ? m.name : r.module)}：${esc(r.title)}</a>`;
      }).join('')
    : '<span class="muted-3">暂无</span>';

  // V5 主题总览：主题是跨栏目的关注点，首页给出「有哪些主题、各挂多少内容」的入口。
  // 主题当前可能为 0 条（由用户自建），因此必须给明确引导，不能留白。
  const themeRows = require('../services/taxonomy').themeCounts();
  const themeAll = db.dbAll('SELECT id,name,parent_id FROM themes ORDER BY sort,id');
  const themeName = new Map(themeAll.map((t) => [t.id, t.name]));
  const themeTotal = themeRows.length;
  const themeLinked = themeRows.reduce((s, r) => s + (r.total || 0), 0);
  // 按关联数排序（多的在前），无关联的排最后
  const topThemes = themeRows.slice().sort((a, b) => (b.total || 0) - (a.total || 0) || a.id - b.id);
  const themeHtml = themeTotal
    ? `<div class="home-themes">${topThemes.slice(0, 12).map((t) => {
        const n = t.total || 0;
        return `<a class="home-theme${n ? '' : ' home-theme-empty'}" href="/themes?theme=${t.id}">
          <span class="ht-name">${esc(themeName.get(t.id) || '（已删除）')}</span>
          <span class="ht-count">${n} 条</span>
        </a>`;
      }).join('')}</div>
      ${themeTotal > 12 ? `<div class="muted-3" style="margin-top:6px">共 ${themeTotal} 个主题，另有 ${themeTotal - 12} 个未显示</div>` : ''}`
    : `<div class="theme-empty" style="padding:12px">
        还没有主题。主题是<b>跨栏目的关注点</b>——例如「宋代财政」可以同时挂古籍、碑刻与你的写作，
        与「分类」（纵向归置）正交并存。<br>
        到任一资料页左栏点「＋ 主题」即可创建，或到 <a href="/themes">主题分类页</a> 批量管理。
      </div>`;

  return `<div class="page-head">
    <div><h1 class="page-title">首页总览</h1>
    <div class="page-sub">${esc(dateStr)} · 上次使用 ${esc(db.dbGet('SELECT MAX(updated_at) m FROM items').m || '—')}</div></div>
    <div>
      <form action="/search" method="get"><input name="q" placeholder="搜索全部史料与文献" style="width:210px"></form>
    </div>
  </div>

  <div class="stat-row">
    <div class="stat-card"><div class="sc-label">史料条目</div><div class="sc-num">${sourceTotal}</div></div>
    <div class="stat-card"><div class="sc-label">研究文献</div><div class="sc-num">${paperBook}</div></div>
    <div class="stat-card"><div class="sc-label">长编 / 札记</div><div class="sc-num">${compCount} / ${noteCount}</div></div>
    <div class="stat-card"><div class="sc-label">本月新增</div><div class="sc-num">${monthNew}</div></div>
  </div>

  <div class="two-col-equal">
    <div class="card">
      <div class="card-title">继续我的长编</div>
      <div class="list-wrap">${compHtml}</div>
    </div>
    <div class="card">
      <div class="card-title">最新读书札记</div>
      <div class="list-wrap">${noteHtml}</div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">主题总览${themeTotal ? ` <span class="muted-3">（${themeTotal} 个主题 · 累计关联 ${themeLinked} 条）</span>` : ''}</div>
    ${themeHtml}
  </div>

  <div class="card">
    <div class="card-title">灵感池</div>
    ${ideaHtml}
  </div>

  <div class="card">
    <div class="card-title">最近入库</div>
    <div class="chip-row">${recentHtml}</div>
  </div>`;
}

module.exports = { renderHome };
