const { esc } = require('../lib/render');

// 导航结构：唯一数据源。V5.1 起侧栏已移除，栏目全部迁到顶栏三组下拉，
// 本数组只供 topbarHtml() 渲染，不再用于侧栏。
const NAV = [
  { title: null, items: [{ name: '首页总览', href: '/', key: 'home' }] },
  {
    title: '资料库',
    items: [
      { name: '古籍史料', href: '/sources/classics', key: 'classics' },
      { name: '碑刻史料', href: '/sources/inscriptions', key: 'inscription' },
      { name: '文书史料', href: '/sources/documents', key: 'document' },
      { name: '档案史料', href: '/sources/archives', key: 'archive' },
      { name: '研究论文', href: '/library/papers', key: 'paper' },
      { name: '研究著作', href: '/library/books', key: 'book' },
      { name: '录文', href: '/excerpts', key: 'excerpts' }
    ]
  },
  {
    title: '我的写作',
    items: [
      { name: '史料长编', href: '/writing/compilations', key: 'compilations' },
      { name: '读书札记', href: '/writing/notes', key: 'notes' },
      { name: '选题灵感', href: '/writing/ideas', key: 'ideas' },
      { name: '史学论文', href: '/writing/history-papers', key: 'history-papers' }
    ]
  },
  { title: '系统', items: [{ name: '数据与设置', href: '/settings', key: 'settings' }, { name: '回收站', href: '/trash', key: 'trash' }] }
];

// 顶栏三组下拉：11 个栏目入口 + 主题分类。
// 逐条核对：入口一个不少，避免「移除侧栏后找不到功能」。
const TOP_MENUS = [
  { title: '资料库', items: NAV[1].items },
  { title: '写作', items: NAV[2].items },
  { title: '系统', items: NAV[3].items.concat([{ name: '主题分类', href: '/themes', key: 'themes' }]) }
];

/** 顶栏：品牌 + 首页 + 三组下拉。下拉默认收起，点按钮才展开（不再记住上次的展开状态）。 */
function topbarHtml(active) {
  let html = '<header class="topbar">'
    + '<a class="topbar-brand" href="/" aria-label="LESP·辑微 首页总览"><span class="brand-mark" role="img" aria-label="LESP·辑微"></span></a>'
    + '<nav class="topbar-nav" aria-label="主导航">'
    + `<a class="topbar-home${active === 'home' ? ' topbar-on' : ''}" href="/">首页总览</a>`;
  for (const m of TOP_MENUS) {
    html += `<div class="topbar-menu" data-menu="${esc(m.title)}">`
      + `<button type="button" class="topbar-btn" data-menu-btn="${esc(m.title)}" aria-expanded="false">${esc(m.title)}<span class="topbar-arrow">▾</span></button>`
      + '<div class="topbar-drop" data-menu-drop="' + esc(m.title) + '">';
    for (const it of m.items) {
      html += `<a class="topbar-item${it.key === active ? ' topbar-on' : ''}" href="${esc(it.href)}" data-key="${esc(it.key)}">${esc(it.name)}</a>`;
    }
    html += '</div></div>';
  }
  html += '</nav></header>';
  return html;
}

function layout({ title = 'LESP·辑微', active = '', body = '', head = '', scripts = [], bare = false }) {
  const scriptTags = scripts.map((s) => `<script src="${esc(s)}"></script>`).join('\n');
  // bare 模式（PDF 预览等阅读界面）：不带应用外壳，正文占满整个窗口
  // V5.1：侧栏已移除，栏目集中在顶栏，主内容区占满可用宽度（不再有 146px 固定占位）。
  const shell = (inner) => bare ? inner : `<div class="app">
  ${topbarHtml(active)}
  <main class="main app-main">${body}</main>
</div>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · LESP·辑微</title>
<link rel="stylesheet" href="/static/css/app.css">
<!-- 关键布局规则内联兜底：即使外部样式表未加载/过期，顶栏与主区也必须各就各位 -->
<style>
  .app { display: flex; flex-direction: column; min-height: 100vh; }
  .app > .main { flex: 1; min-width: 0; }
  .three-col { display: flex; }
  /* 品牌字：尺寸必须与 mask 的 87.3×14.2 一致，否则图形被裁切 */
  .brand-mark {
    display: block; width: 87.3px; height: 14.2px; flex: none;
    background-color: #3a352f;
    -webkit-mask: url('/static/svg/brand-wordmark.svg') no-repeat left center / 87.3px 14.2px;
            mask: url('/static/svg/brand-wordmark.svg') no-repeat left center / 87.3px 14.2px;
  }
</style>
${head}
</head>
<body>
${shell(`<main class="main reader-main">${body}</main>`)}
<script>
// 顶栏三组下拉：点按钮开合，点外部/Esc 关闭。
// 内联实现，不依赖后加载脚本 —— 顶栏是全站唯一导航，挂了整站不可用。
//
// V5.2：原先会在「当前页所在组」上自动展开，且展开状态写进 localStorage 永久生效。
// 表现为点开左侧分类后刷新，页面顶部又弹出一片下拉面板，遮住内容。
// 现在改为：下拉只由用户点击按钮打开，不再自动展开，也不再持久化展开状态。
// 「我在哪个栏目」改用按钮本身的常态高亮（topbar-btn-on）来表达，不靠弹窗。
(function () {
  const menus = Array.from(document.querySelectorAll('.topbar-menu'));
  if (!menus.length) return;

  const apply = (menu, on) => {
    const btn = menu.querySelector('[data-menu-btn]');
    const drop = menu.querySelector('.topbar-drop');
    if (!btn || !drop) return;
    drop.classList.toggle('topbar-drop-on', on);
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    btn.classList.toggle('topbar-btn-on', on);
    const arrow = btn.querySelector('.topbar-arrow');
    if (arrow) arrow.textContent = on ? '▴' : '▾';
  };

  // 初始一律收起；同时把「当前页所属组」的按钮点亮，作为所在栏目的位置指示。
  menus.forEach((menu) => apply(menu, false));
  menus.forEach((menu) => {
    if (!menu.querySelector('.topbar-item.topbar-on')) return;
    const btn = menu.querySelector('[data-menu-btn]');
    if (btn) btn.classList.add('topbar-btn-on');
  });

  menus.forEach((menu) => {
    const btn = menu.querySelector('[data-menu-btn]');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const on = !menu.querySelector('.topbar-drop').classList.contains('topbar-drop-on');
      // 同时只开一组
      menus.forEach((m) => { if (m !== menu) apply(m, false); });
      apply(menu, on);
    });
  });

  document.addEventListener('click', () => menus.forEach((m) => apply(m, false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') menus.forEach((m) => apply(m, false));
  });
})();
</script>
<div id="toast" class="toast" hidden></div>
<script src="/static/js/common.js"></script>
<script src="/static/js/diag.js"></script>
<script src="/static/js/dialog.js"></script>
<script src="/static/js/taxonomy.js"></script>
<script src="/static/js/save-controller.js"></script>
<script src="/static/js/excerpts.js"></script>
<script src="/static/js/sources.js"></script>
<script src="/static/js/exports.js"></script>
${scriptTags}
</body>
</html>`;
}

module.exports = { layout, NAV };
