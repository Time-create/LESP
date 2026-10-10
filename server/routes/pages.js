const express = require('express');
const { layout } = require('../views/layout');
const { esc } = require('../lib/render');
const { MODULES } = require('../config/modules');
const { renderItemPage, renderPanel } = require('../views/page-item');
const { loadItem } = require('./items');

const router = express.Router();
router.get('/themes', (req,res)=>res.type('html').send(layout({title:'主题分类',active:'themes',body:require('../views/page-themes').renderThemes(),scripts:['/static/js/themes.js']})));

function page(title, active, body, scripts = []) {
  return layout({ title, active, body, scripts });
}

router.get('/', (req, res) => {
  const { renderHome } = require('../views/page-home');
  res.type('html').send(page('首页总览', 'home', renderHome()));
});

for (const key of Object.keys(MODULES)) {
  const m = MODULES[key];
  router.get(m.route, (req, res) => {
    const body = renderItemPage({
      module: key,
      item: null,
      collectionId: req.query.collection,
      collectionExact: req.query.classification_exact === '1',
      tagId: req.query.tag,
      q: req.query.q
    });
    const scripts = ['/static/js/classify-actions.js', '/static/js/classify-manager.js', '/static/js/collection-tree.js', '/static/js/theme-tree.js', '/static/js/item-drag.js', '/static/js/detail-panel.js', '/static/js/item.js', '/static/js/upload.js', '/static/js/drop-import.js'];
    res.type('html').send(page(m.name, key, body, scripts));
  });

  router.get(m.route + '/:id', (req, res) => {
    const item = loadItem(Number(req.params.id));
    if (!item || item.module !== key) {
      return res.redirect(m.route);
    }
    const body = renderItemPage({
      module: key,
      item,
      collectionId: req.query.collection,
      tagId: req.query.tag,
      q: req.query.q
    });
    // 详情页与列表页共用同一外壳（左栏分类树 + 主题树），脚本保持一致
    const scripts = ['/static/js/classify-actions.js', '/static/js/classify-manager.js', '/static/js/collection-tree.js', '/static/js/theme-tree.js', '/static/js/detail-panel.js', '/static/js/item.js', '/static/js/upload.js', '/static/js/drop-import.js'];
    // V5.3：条目页的「录文分类（全局）」面板已移除，录文的查阅与归类统一到
    // 「资料库 → 录文」（/excerpts，脚本见 excerpts-hub.js）。
    // excerpt-tree.js 只服务于那个已删除的面板，不再注入，避免死代码抢事件。
    res.type('html').send(page(item.title, key, body, scripts));
  });
}

// V5 右栏详情片段：列表页点条目时局部加载，避免整页跳转打断分类/检索上下文
router.get('/api/items/:id/panel', (req, res) => {
  const item = loadItem(Number(req.params.id));
  if (!item || !MODULES[item.module]) return res.status(404).type('html').send('<div class="empty">条目不存在</div>');
  res.type('html').send(renderPanel({
    module: item.module,
    item,
    collectionId: req.query.collection,
    tagId: req.query.tag,
    q: req.query.q
  }));
});

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  const module = req.query.module;
  const { searchFts } = require('../db');
  const db = require('../db');
  const ids = q ? searchFts(q) : [];
  let rows = [];
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const params = ids.slice();
    let sql = 'SELECT * FROM items WHERE id IN (' + ph + ')';
    if (module && MODULES[module]) {
      sql += ' AND module = ?';
      params.push(module);
    }
    rows = db.dbAll(sql, params);
  }
  const html = rows.length
    ? rows.map((r) => `<a class="li" href="${esc(MODULES[r.module] ? MODULES[r.module].route : '/')}/${r.id}">
        <div class="li-title">${esc(r.title)}</div>
        <div class="li-sub">${esc(MODULES[r.module] ? MODULES[r.module].name : r.module)} · ${esc(r.subtitle || '')}</div></a>`).join('')
    : '<div class="empty">没有匹配的条目</div>';
  const body = `<div class="page-head"><div><h1 class="page-title">检索结果</h1>
    <div class="page-sub">关键词：${esc(q)} · 命中 ${rows.length} 条</div></div></div>
    <div class="card"><div class="list-wrap">${html}</div></div>`;
  res.type('html').send(page('检索', '', body));
});

// 内置阅读器：PDF 用浏览器插件内嵌，图片直接渲染，TIFF 降级为下载
router.get('/reader/:id', (req, res) => {
  const db = require('../db');
  const nodePath = require('node:path');
  const a = db.dbGet('SELECT * FROM attachments WHERE id = ?', [Number(req.params.id)]);
  if (!a) {
    return res.status(404).type('html').send(layout({
      title: '阅读器', body: '<div class="card"><p>附件不存在</p></div>'
    }));
  }
  const ext = nodePath.extname(a.filename).toLowerCase();
  const src = '/api/attachments/' + a.id + '/file';
  let inner;
  if (ext === '.pdf') {
    inner = require('../views/pdf-reader').render(a);
  } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
    inner = '<div class="reader-img-wrap"><img class="reader-img" src="' + esc(src) + '" alt="' + esc(a.filename) + '"></div>';
  } else {
    inner = '<div class="empty">该格式（' + esc(ext) + '）浏览器无法直接预览，请 <a href="' + esc(src) + '">下载</a> 后用外部程序查看。</div>';
  }
  const body = '<div class="page-head"><div><h1 class="page-title">' + esc(a.filename) + '</h1>' +
    '<div class="page-sub">' + (a.size / 1024).toFixed(0) + ' KB · ' + esc(a.mime || '') + '</div></div>' +
    '<div><a href="' + esc(src) + '"><button>下载</button></a></div></div>' +
    '<div class="reader-box">' + inner + '</div>';
  res.type('html').send(layout({ title: a.filename, body, bare: true }));
});

// 史学论文：与长编同构，但按需求不设分类树（故不加载分类相关脚本）
router.get('/writing/history-papers', (req, res) => {
  const { listPage } = require('../views/page-history-paper');
  res.type('html').send(page('史学论文', 'history-papers', listPage(), ['/static/js/history-paper.js']));
});

router.get('/writing/history-papers/:id', (req, res) => {
  const { editorPage } = require('../views/page-history-paper');
  const shell = require('../views/writing-shell').shell('historyPaper', req.params.id);
  res.type('html').send(page('史学论文', 'history-papers', shell + editorPage(Number(req.params.id)), ['/static/js/history-paper.js']));
});

router.get('/writing/compilations', (req, res) => {
  const { listPage } = require('../views/page-compilation');
  // item-drag.js：长编列表也支持拖到左栏分类归类（脚本按 data-module 自动选target）
  res.type('html').send(page('史料长编', 'compilations', listPage(req.query.collection), ['/static/js/classify-actions.js', '/static/js/classify-manager.js', '/static/js/collection-tree.js', '/static/js/item-drag.js', '/static/js/compilation.js']));
});

router.get('/writing/compilations/:id', (req, res) => {
  if(req.query.legacy!=='1')return res.type('html').send(page('史料长编','compilations',require('../views/writing-shell').shell('compilation',req.params.id)));
  const { editorPage } = require('../views/page-compilation');
  const db = require('../db');
  const c = db.dbGet('SELECT * FROM compilations WHERE id = ?', [Number(req.params.id)]);
  if (!c) return res.redirect('/writing/compilations');
  res.type('html').send(page(c.title, 'compilations', editorPage(c.id), ['/static/js/classify-actions.js', '/static/js/classify-manager.js', '/static/js/collection-tree.js', '/static/js/compilation.js']));
});

router.get('/writing/notes', (req, res) => {
  const { renderNotesPage } = require('../views/page-notes');
  // item-drag.js：札记列表也支持拖到左栏分类归类（脚本按 data-module 自动选target）
  res.type('html').send(page('读书札记', 'notes', renderNotesPage(null, req.query.collection), ['/static/js/classify-actions.js', '/static/js/classify-manager.js', '/static/js/collection-tree.js', '/static/js/item-drag.js', '/static/js/notes.js']));
});

// 从条目详情页「就此写札记」进入：先建一篇空札记并带上关联，再进入编辑
router.get('/writing/notes/new', (req, res) => {
  const link = String(req.query.link || '');
  res.redirect('/writing/notes?link=' + encodeURIComponent(link));
});

router.get('/writing/notes/:id', (req, res) => {
  if(req.query.legacy!=='1')return res.type('html').send(page('读书札记','notes',require('../views/writing-shell').shell('note',req.params.id)));
  const { renderNotesPage } = require('../views/page-notes');
  res.type('html').send(page('读书札记', 'notes', renderNotesPage(req.params.id, req.query.collection), ['/static/js/classify-actions.js', '/static/js/classify-manager.js', '/static/js/collection-tree.js', '/static/js/notes.js']));
});

router.get('/writing/ideas', (req, res) => {
  if(req.query.selected)return res.redirect('/writing/ideas/'+Number(req.query.selected));
  const { renderIdeasPage } = require('../views/page-ideas');
  res.type('html').send(page('选题灵感', 'ideas', renderIdeasPage(), ['/static/js/ideas.js']));
});
router.get('/writing/ideas/:id',(req,res)=>res.type('html').send(page('选题灵感','ideas',require('../views/writing-shell').shell('idea',req.params.id))));

router.get('/settings', (req, res) => {
  const { renderSettingsPage } = require('../views/page-settings');
  res.type('html').send(page('数据与设置', 'settings', renderSettingsPage(), ['/static/js/settings.js']));
});

router.get('/trash', (req, res) => {
  const { renderTrashPage } = require('../views/page-trash');
  res.type('html').send(page('回收站', 'trash', renderTrashPage(), ['/static/js/trash.js']));
});

// 录文集（V5.3）：跨条目聚合录文的查阅与归类页。数据不搬家，只做视图。
router.get('/excerpts', (req, res) => {
  const body = require('../views/page-excerpts').render({
    folder: req.query.folder,
    unclassified: req.query.unclassified,
    q: req.query.q,
    offset: req.query.offset
  });
  res.type('html').send(page('录文', 'excerpts', body, [
    // classify-actions 提供分类的编辑/移动/删除表单与删除前的影响预览
    '/static/js/classify-actions.js',
    '/static/js/excerpts-hub.js'
  ]));
});

router.get('/settings/backup', (req, res) => {
  const { renderSettingsPage } = require('../views/page-settings');
  res.type('html').send(page('备份与恢复', 'settings', renderSettingsPage(), ['/static/js/settings.js']));
});

router.get('/settings/cnki', (req, res) => {
  const { renderSettingsPage } = require('../views/page-settings');
  res.type('html').send(page('知网登录态', 'settings', renderSettingsPage(), ['/static/js/settings.js']));
});

module.exports = router;
