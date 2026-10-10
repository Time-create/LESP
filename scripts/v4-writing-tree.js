// 长编 / 札记列表页：接入 V4 分类树（左列）+ 按分类筛选
const fs = require('fs');

/* ---------- 长编 ---------- */
let comp = fs.readFileSync('server/views/page-compilation.js', 'utf8');
if (!comp.includes('classification-view')) {
  comp = comp.replace(
    "const { load } = require('../routes/compilations');",
    "const { load } = require('../routes/compilations');\nconst { renderTree } = require('../services/classification-view');"
  );
  comp = comp.replace(
    'function listPage() {\n  const rows = db.dbAll(\'SELECT * FROM compilations ORDER BY updated_at DESC, id DESC\');',
    "function listPage(collectionId) {\n  const link = require('../services/classification').subtreeIds.bind(null, db, 'collections');\n  const scopeIds = collectionId && collectionId !== 'none' ? link('collections', Number(collectionId)) : null;\n  const rows = db.dbAll(\n    'SELECT * FROM compilations c WHERE ('
    + '? IS NULL OR (? = 1 AND NOT EXISTS (SELECT 1 FROM collection_compilations x WHERE x.compilation_id = c.id))'
    + ' OR EXISTS (SELECT 1 FROM collection_compilations x WHERE x.compilation_id = c.id AND x.collection_id IN (' + (scopeIds ? scopeIds.map(() => '?').join(',') : 'NULL') + ')))'
    + ' ORDER BY updated_at DESC, id DESC',"
  );
  comp = comp.replace(
    "  return `<div class=\"page-head\">\n    <div><h1 class=\"page-title\">史料长编</h1>",
    "  return `<div class=\"page-head\">\n    <div><h1 class=\"page-title\">史料长编</h1>"
  );
  // 卡片区包一层三栏布局
  comp = comp.replace(
    '  <div class="card"><div class="list-wrap">${cards}</div></div>\n  <script>window.__MODE__ = \'list\';</script>`;',
    '  <div class="three-col">\n'
    + '    <aside class="col-tree" data-module="compilation" data-listurl="/writing/compilations">\n'
    + '      <div class="tree-title">我的研究分类</div>\n'
    + '      ${renderTree(\'compilation\', collectionId || null)}\n'
    + '    </aside>\n'
    + '    <section class="col-list"><div class="card"><div class="list-wrap">${cards}</div></div></section>\n'
    + '  </div>\n'
    + "  <script>window.__MODE__ = 'list';</script>`;"
  );
  // listPage 的 rows 查询需要带上 scopeIds 参数
  comp = comp.replace(
    "    + ' ORDER BY updated_at DESC, id DESC',",
    "    + ' ORDER BY updated_at DESC, id DESC',\n    scopeIds ? [collectionId === 'none' ? 1 : 0, collectionId === 'none' ? 1 : 0].concat(scopeIds) : [0, 0]"
  );
  comp = comp.replace("  const cards = rows.length", "  const cards = rows.length");
  fs.writeFileSync('server/views/page-compilation.js', comp);
  console.log('✔ 长编列表页已接入分类树');
}

/* ---------- 札记 ---------- */
let notes = fs.readFileSync('server/views/page-notes.js', 'utf8');
if (!notes.includes('classification-view')) {
  notes = notes.replace(
    "function renderNotesPage(noteId) {\n  const notes = db.dbAll('SELECT * FROM notes ORDER BY updated_at DESC, id DESC');",
    "function renderNotesPage(noteId, collectionId) {\n  const scopeIds = collectionId && collectionId !== 'none'\n    ? require('../services/classification').subtreeIds(db, 'collections', Number(collectionId))\n    : null;\n  const notes = db.dbAll(\n    \"SELECT * FROM notes n WHERE (? IS NULL OR (? = 1 AND NOT EXISTS (SELECT 1 FROM collection_notes x WHERE x.note_id = n.id))\"\n    + \" OR EXISTS (SELECT 1 FROM collection_notes x WHERE x.note_id = n.id AND x.collection_id IN (\"\n    + (scopeIds ? scopeIds.map(() => '?').join(',') : 'NULL') + ')))\'\n    + \' ORDER BY updated_at DESC, id DESC\',\n    scopeIds ? [collectionId === \'none\' ? 1 : 0, collectionId === \'none\' ? 1 : 0].concat(scopeIds) : [0, 0]\n  );'
  );
  fs.writeFileSync('server/views/page-notes.js', notes);
  console.log('✔ 札记列表页已支持按分类筛选');
}
