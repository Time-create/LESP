const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { startApp } = require('./helpers');

const ROOT = path.join(__dirname, '..');

const ROUTE_BY_MODULE = {
  classics: '/sources/classics',
  inscription: '/sources/inscriptions',
  document: '/sources/documents',
  archive: '/sources/archives',
  paper: '/library/papers',
  book: '/library/books'
};

async function post(app, url, body) {
  const res = await fetch(app.base + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return res.json();
}

test('Phase4 - 六类模块页面均渲染三栏结构', async () => {
  const app = await startApp();
  try {
  for (const [mod, route] of Object.entries(ROUTE_BY_MODULE)) {
    const html = await (await fetch(app.base + route)).text();
    assert.ok(html.includes('class="three-col"'), route + ' 缺少三栏容器');
    assert.ok(html.includes('col-tree'), route + ' 缺少分类树');
    assert.ok(html.includes('col-list'), route + ' 缺少条目列表');
    assert.ok(html.includes('col-detail'), route + ' 缺少详情区');
  }
  } finally {
    await app.close();
  }
});

test('Phase4 - 各模块显示自身专属字段，不串用', async () => {
  const app = await startApp();
  try {
  const checks = [
    ['classics', ['作者／编者', '朝代', '版本', '卷次']],
    ['inscription', ['立碑年代', '撰者', '出土地', '现藏地']],
    ['document', ['文书类型', '当事人', '地点', '档号']],
    ['archive', ['全宗号', '目录号', '卷号', '开放状态']],
    ['paper', ['作者', '期刊／集刊', '年卷期', '关键词']],
    ['book', ['作者', '出版社', '出版年', 'ISBN']]
  ];
  for (const [mod, labels] of checks) {
    const html = await (await fetch(app.base + ROUTE_BY_MODULE[mod])).text();
    for (const lb of labels) {
      assert.ok(html.includes(lb), mod + ' 页面应显示字段「' + lb + '」');
    }
  }
  // 反向确认：古籍页不应出现碑刻字段
  const classicsHtml = await (await fetch(app.base + '/sources/classics')).text();
  assert.ok(!classicsHtml.includes('立碑年代'), '古籍页不应出现碑刻字段');
  const insHtml = await (await fetch(app.base + '/sources/inscriptions')).text();
  assert.ok(!insHtml.includes('全宗号'), '碑刻页不应出现档案字段');
  } finally {
    await app.close();
  }
});

test('Phase4 - 验收1：新建条目后刷新页面仍完整显示字段', async () => {
  const app = await startApp();
  try {
  const created = await post(app, '/api/items', {
    module: 'classics',
    title: '文献通考',
    fields: { author: '马端临', dynasty: '元', edition: '商务印书馆 1936', juan: '全 348 卷' }
  });

  // 模拟刷新：重新请求详情页
  const html = await (await fetch(app.base + '/sources/classics/' + created.id)).text();
  assert.ok(html.includes('文献通考'), '标题应保留');
  assert.ok(html.includes('马端临'), '作者字段应保留');
  assert.ok(html.includes('商务印书馆 1936'), '版本字段应保留');
  assert.ok(html.includes('全 348 卷'), '卷次字段应保留');
  } finally {
    await app.close();
  }
});

test('Phase4 - 条目列表与详情页联动', async () => {
  const app = await startApp();
  try {
  await post(app, '/api/items', { module: 'paper', title: '役法新论', fields: { author: '张三' } });
  const listHtml = await (await fetch(app.base + '/library/papers')).text();
  assert.ok(listHtml.includes('役法新论'), '列表应显示条目');
  assert.ok(listHtml.includes('张三'), '列表副标题应显示作者');
  } finally {
    await app.close();
  }
});

test('Phase4 - 分类筛选在页面生效', async () => {
  const app = await startApp();
  try {
  const a = await post(app, '/api/items', { module: 'classics', title: '甲书', collections: ['宋代财政史'] });
  await post(app, '/api/items', { module: 'classics', title: '乙书', collections: ['基层治理'] });
  const col = await (await fetch(app.base + '/api/collections?module=classics')).json();
  const cai = col.find((c) => c.name === '宋代财政史');

  const html = await (await fetch(app.base + '/sources/classics?collection=' + cai.id)).text();
  assert.ok(html.includes('甲书'), '该分类下应显示甲书');
  assert.ok(!html.includes('乙书'), '该分类下不应显示乙书');
  } finally {
    await app.close();
  }
});

test('Phase4 - 页面内嵌字段配置供前端生成表单', async () => {
  const app = await startApp();
  try {
  const html = await (await fetch(app.base + '/sources/documents')).text();
  assert.ok(html.includes('window.__SCHEMA__'), '应输出字段配置');
  assert.ok(html.includes('鱼鳞图册'), '枚举选项应进入前端配置');
  assert.ok(html.includes('window.__MODULE__ = "document"'), '应输出模块名');
  } finally {
    await app.close();
  }
});

test('Phase4 - 检索页可渲染命中结果', async () => {
  const app = await startApp();
  try {
  const { seed } = require(path.join(ROOT, 'server/seed'));
  seed();
  const html = await (await fetch(app.base + '/search?q=' + encodeURIComponent('里正'))).text();
  assert.ok(html.includes('宋故朱公墓志铭'), '检索页应显示命中条目');
  } finally {
    await app.close();
  }
});

test('Phase4 - XSS 防护：条目标题中的脚本被转义', async () => {
  const app = await startApp();
  try {
  const created = await post(app, '/api/items', {
    module: 'classics', title: '<script>alert(1)</script>', fields: {}
  });
  const html = await (await fetch(app.base + '/sources/classics/' + created.id)).text();
  assert.ok(!html.includes('<script>alert(1)</script>'), '不得输出未转义的脚本');
  assert.ok(html.includes('&lt;script&gt;'), '应转义为实体');
  } finally {
    await app.close();
  }
});
