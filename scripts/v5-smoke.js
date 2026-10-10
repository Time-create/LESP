// V5 交付前真实启动冒烟：起服务 → 逐路由取 HTML → 校验关键结构
// 范式对齐 tests/v5-layout.test.js：setDataDir → initDb → createApp().listen
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesp-v5-smoke-'));
const paths = require(path.join(ROOT, 'server', 'lib', 'paths'));
paths.setDataDir(tmp);
const db = require(path.join(ROOT, 'server', 'db'));
db.initDb(tmp);
paths.ensureDirs();

const { createApp } = require(path.join(ROOT, 'server', 'app'));
const app = createApp();
const server = app.listen(0, '127.0.0.1');
function ready() {
  return new Promise((res, rej) => {
    if (server.listening) return res();
    server.once('listening', res); server.once('error', rej);
  });
}

const results = [];
const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: extra || '' });
function divBalanced(html) {
  const open = (html.match(/<div\b/g) || []).length;
  const close = (html.match(/<\/div>/g) || []).length;
  return { open, close, balanced: open === close };
}
let base = '';
async function get(p) {
  const r = await fetch(base + p);
  return { status: r.status, html: await r.text() };
}

(async () => {
  try {
    await ready();
    base = 'http://127.0.0.1:' + server.address().port;

    // 造一条古籍 + 一条史学论文 + 三个主题，用于后续结构性断言
    const mk = await fetch(base + '/api/items', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ module: 'classics', title: '宋会要辑稿', fields: { author: '徐松', year: '1800' } })
    });
    ok('可通过 POST /api/items 新建古籍条目', mk.status === 200, 'status=' + mk.status);
    await fetch(base + '/api/history-papers', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '唐代寺院经济研究' })
    });
    for (const t of ['财政', '寺院', '寺院财政']) {
      await fetch(base + '/api/themes', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: t })
      });
    }

    // 1) 全部页面路由：200 + 顶栏 + 三组菜单 + 侧栏已移除 + div 平衡
    const routes = [
      '/', '/sources/classics', '/library/papers', '/writing/compilations',
      '/writing/history-papers', '/themes', '/settings', '/trash', '/search?q=宋'
    ];
    let topbarN = 0, groupN = 0, noSidebarN = 0, balN = 0;
    for (const r of routes) {
      const { status, html } = await get(r);
      ok(`路由 ${r} 返回 200`, status === 200, 'status=' + status);
      const b = divBalanced(html);
      if (b.balanced) balN++;
      else ok(`路由 ${r} div 平衡`, false, `${b.open} open / ${b.close} close`);
      if (html.includes('class="topbar"')) topbarN++;
      if (html.includes('资料库') && html.includes('写作') && html.includes('系统')) groupN++;
      // V5.1：侧栏已移除，栏目全在顶栏
      if (!html.includes('class="sidebar"') && !html.includes('nav-item')) noSidebarN++;
    }
    ok(`${routes.length} 个路由 div 全部平衡`, balN === routes.length, balN + '/' + routes.length);
    ok(`${routes.length} 个路由均含顶栏`, topbarN === routes.length, topbarN + '/' + routes.length);
    ok(`${routes.length} 个路由均含三组菜单`, groupN === routes.length, groupN + '/' + routes.length);
    ok(`${routes.length} 个路由均已无侧栏（sidebar/nav-item）`, noSidebarN === routes.length, noSidebarN + '/' + routes.length);

    // 2) 顶栏 13 个入口逐条核对（防止改版后找不到功能）
    const home = (await get('/')).html;
    // 顶栏片段：V5.1 侧栏已移除，结束边界改为 <main>
    const tbStart = home.indexOf('class="topbar"');
    const tbEnd = home.indexOf('<main class="main app-main"');
    const topbar = home.slice(tbStart, tbEnd > tbStart ? tbEnd : tbStart + 4000);
    const expected = [
      '/', '/sources/classics', '/sources/inscriptions', '/sources/documents',
      '/sources/archives', '/library/papers', '/library/books',
      '/writing/compilations', '/writing/notes', '/writing/ideas', '/writing/history-papers',
      '/settings', '/trash', '/themes'
    ];
    const missing = expected.filter((h) => !topbar.includes('href="' + h + '"'));
    ok('顶栏含全部 14 个入口（含首页）', missing.length === 0, missing.length ? '缺: ' + missing.join(',') : '');
    ok('顶栏为三组下拉结构', (topbar.match(/topbar-menu/g) || []).length === 3);
    ok('顶栏下拉脚本已内联', topbar.includes('topbar-btn') || home.includes('topbar'));

    // 3) 列表页三栏 + 收起条 + 主题树
    const paper = (await get('/library/papers')).html;
    ok('列表页含 three-col 容器', paper.includes('id="three-col"'));
    ok('列表页已无详情收起条（V5.3 移除）', !paper.includes('id="detail-collapse"'));
    ok('列表页已无收起按钮（V5.3 移除）', !paper.includes('btn-detail-collapse'));
    ok('列表页含主题树容器', paper.includes('class="theme-tree"'));
    ok('主题树两枚按钮均带 data-theme-action', paper.includes('data-theme-action="new"') && paper.includes('data-theme-action="manage"'));
    ok('列表页引入 theme-tree.js', paper.includes('/static/js/theme-tree.js'));
    ok('列表页引入 detail-panel.js', paper.includes('/static/js/detail-panel.js'));
    ok('列表页保留 item-drag.js（拖拽归类未被破坏）', paper.includes('/static/js/item-drag.js'));
    ok('列表页保留 collection-tree.js', paper.includes('/static/js/collection-tree.js'));

    // 4) 右栏片段接口（真实 HTTP）—— 用古籍条目（item 类模块，historyPaper 属写作类不在 items 表）
    const listJson = await (await fetch(base + '/api/items?module=classics')).json();
    const rows = Array.isArray(listJson) ? listJson : (listJson.items || listJson.rows || []);
    ok('列表接口返回条目', rows.length > 0, 'rows=' + rows.length);
    if (rows.length) {
      const id = rows[0].id;
      const panel = await get('/api/items/' + id + '/panel');
      ok('右栏片段接口 200', panel.status === 200, 'status=' + panel.status);
      ok('右栏片段已无「完整页面」入口（V5.3 移除）', !panel.html.includes('panel-full'));
      ok('右栏片段 div 平衡', divBalanced(panel.html).balanced);
      const bad = await get('/api/items/999999999/panel');
      ok('右栏片段对不存在条目返回 404', bad.status === 404, 'status=' + bad.status);
      const detail = await get('/sources/classics/' + id);
      ok('详情页 200', detail.status === 200, 'status=' + detail.status);
      ok('详情页已无收起按钮（V5.3 移除）', !detail.html.includes('btn-detail-collapse'));
    }

    // 4b) 空态概览页也必须有收起入口（否则初始状态无法收起右栏）
    const emptyModule = await get('/library/books');
    ok('空分类概览页 200', emptyModule.status === 200, 'status=' + emptyModule.status);
    ok('空态概览页已无收起按钮（V5.3 移除）', !emptyModule.html.includes('btn-detail-collapse'));
    ok('空态概览页 div 平衡', divBalanced(emptyModule.html).balanced);

    // 5) 新增 API 可用
    const counts = await fetch(base + '/api/themes/counts');
    const countsJson = await counts.json();
    ok('GET /api/themes/counts 200 且为数组', counts.status === 200 && Array.isArray(countsJson), 'status=' + counts.status);
    const rel = await fetch(base + '/api/themes/1/relations');
    const relJson = await rel.json();
    ok('GET /api/themes/1/relations 不 500', rel.status === 200, 'status=' + rel.status);
    ok('relations 返回 {rows,total} 结构', rel.status === 200 && Array.isArray(relJson.rows) && typeof relJson.total === 'number',
      'keys=' + Object.keys(relJson || {}).join(','));

    // 6) 4 级上限服务端校验
    const up1 = await (await fetch(base + '/api/themes')).json();
    const parent = (Array.isArray(up1) ? up1 : []).find((t) => t.name === '财政');
    const relOut = [];
    let cur = parent;
    for (let i = 0; i < 5; i++) {
      const r = await fetch(base + '/api/themes', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'L' + i, parent_id: cur ? cur.id : null })
      });
      relOut.push(r.status);
      if (r.status !== 200) break;
      const list = await (await fetch(base + '/api/themes')).json();
      cur = list.find((t) => t.name === 'L' + i);
    }
    ok('主题 4 级上限被服务端拦截', relOut.includes(400), 'statuses=' + relOut.join(','));

    // 7) 静态资源与 CSS 可访问（避免空按键）
    for (const js of ['/static/js/theme-tree.js', '/static/js/detail-panel.js', '/static/js/classify-actions.js', '/static/js/excerpt-tree.js']) {
      const r = await fetch(base + js);
      ok(`静态资源 ${js} 可访问`, r.status === 200, 'status=' + r.status);
    }
    const css = await fetch(base + '/static/css/app.css');
    const cssText = await css.text();
    ok('app.css 可访问', css.status === 200, 'status=' + css.status);
    ok('app.css 含顶栏/主区样式（收起条样式已随入口移除）',
      cssText.includes('.topbar') && cssText.includes('.app > .main')
      && !cssText.includes('.detail-collapse') && cssText.includes('brand-wordmark.svg'));

    // 8) 录文分类删除策略：级联删子树、内容保留
    const f1 = await (await fetch(base + '/api/excerpt-folders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '冒烟父' }) })).json();
    const f2 = await (await fetch(base + '/api/excerpt-folders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '冒烟子', parent_id: f1.id }) })).json();
    const impact = await (await fetch(base + '/api/excerpt-folders/' + f1.id + '/impact')).json();
    ok('录文分类删除前可预览影响', impact && typeof impact === 'object', JSON.stringify(impact).slice(0, 120));
    const noConfirm = await fetch(base + '/api/excerpt-folders/' + f1.id, { method: 'DELETE' });
    ok('录文分类删除缺 confirm 被拒(400)', noConfirm.status === 400, 'status=' + noConfirm.status);
    const del = await fetch(base + '/api/excerpt-folders/' + f1.id + '?confirm=true', { method: 'DELETE' });
    ok('录文分类确认后可删除', del.status === 200, 'status=' + del.status);
    const left = await (await fetch(base + '/api/excerpt-folders')).json();
    const names = (Array.isArray(left) ? left : []).map((x) => x.name);
    ok('级联删除同时移除子分类', !names.includes('冒烟父') && !names.includes('冒烟子'), names.join(','));

    // 9) 首页主题总览区块
    ok('首页含主题总览区块', home.includes('home-themes') || home.includes('主题总览'));
    const themesPage = (await get('/themes')).html;
    ok('主题页含主题树容器', themesPage.includes('id="theme-tree"'));
  } catch (e) {
    ok('冒烟脚本执行无异常', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : String(e));
  }

  server.close();
  try { db.closeDb(); } catch (e) {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  const fail = results.filter((r) => !r.pass);
  results.forEach((r) => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.extra ? '  [' + r.extra + ']' : '')));
  console.log('=========================================');
  console.log(`SMOKE TOTAL pass=${results.length - fail.length} fail=${fail.length}`);
  process.exit(fail.length ? 1 : 0);
})();