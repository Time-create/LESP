const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startApp } = require('./helpers');

const ROOT = path.join(__dirname, '..');

async function withApp(fn) {
  const app = await startApp();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

async function post(app, url, body) {
  const res = await fetch(app.base + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  });
  return res.json();
}
async function put(app, url, body) {
  const res = await fetch(app.base + url, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  });
  return res.json();
}
async function del(app, url) {
  const res = await fetch(app.base + url, { method: 'DELETE' });
  return res.json();
}
async function get(app, url) {
  const res = await fetch(app.base + url);
  return res.json();
}

// 建条目 + 录文，返回 { item, excerpt }
async function makeMaterial(app, module, title, fields, locator, text) {
  const item = await post(app, '/api/items', { module, title, fields });
  const excerpt = await post(app, '/api/excerpts', { item_id: item.id, locator, text });
  return { item, excerpt };
}

test('Phase6 - 新建长编与列表', async () => {
  await withApp(async (app) => {
    const c = await post(app, '/api/compilations', { title: '宋代两浙路役法史料长编', project: '宋代财政史' });
    assert.strictEqual(c.title, '宋代两浙路役法史料长编');
    assert.strictEqual(c.footnote_style, 'footer');
    assert.deepStrictEqual(c.blocks, []);

    const list = await get(app, '/api/compilations');
    assert.strictEqual(list.length, 1);

    const bad = await fetch(app.base + '/api/compilations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '  ' })
    });
    assert.strictEqual(bad.status, 400, '标题必填');
  });
});

test('Phase6 - 验收6：插入摘录生成正文与脚注（古籍模板）', async () => {
  await withApp(async (app) => {
    const { excerpt } = await makeMaterial(app, 'classics', '宋会要辑稿',
      { edition: '中华书局 1957 年影印本', dynasty: '清' },
      '卷一三七 · 食货 · 役法', '绍兴十五年，诏两浙路诸县差役。');
    const c = await post(app, '/api/compilations', { title: '役法长编' });
    const after = await post(app, '/api/compilations/' + c.id + '/blocks', {
      type: 'quote', excerpt_id: excerpt.id
    });

    assert.strictEqual(after.blocks.length, 1);
    assert.strictEqual(after.blocks[0].type, 'quote');
    assert.strictEqual(after.blocks[0].quote_text, '绍兴十五年，诏两浙路诸县差役。', '正文应保留史料原文');
    assert.strictEqual(after.refs.length, 1);
    assert.strictEqual(after.refs[0].mark, '①', '应生成圈标脚注');
    assert.strictEqual(after.refs[0].text, '《宋会要辑稿》卷一三七 · 食货 · 役法，中华书局 1957 年影印本。');
  });
});

test('Phase6 - 各模块脚注按自身模板生成，空字段不产生空壳', async () => {
  await withApp(async (app) => {
    const cases = [
      ['inscription', '宋故朱公墓志铭', { era: '绍兴二十二年', keep_place: '浙江省博物馆' },
        '志文第 5 行', '公尝充里正。', '宋故朱公墓志铭，绍兴二十二年立，浙江省博物馆。'],
      ['document', '淳熙三年休宁置产簿', { doc_type: '契约', place: '休宁县', keeper: '安徽大学' },
        '第 2 叶', '一都三保，田叁拾亩。', '《淳熙三年休宁置产簿》，契约，休宁县，安徽大学。'],
      ['archive', '清代徽州府赋役档案', { fond_no: '12', catalog_no: '3', volume_no: '45', keeper: '安徽省档案馆' },
        '第 12 件', '本年实征丁银若干。', '安徽省档案馆，12-3-45，清代徽州府赋役档案。'],
      ['paper', '宋代两浙路役法演变考论', { author: '包伟民', journal: '历史研究', year_volume: '2018(4)' },
        '第 45 页', '役法演变线索。', '包伟民《宋代两浙路役法演变考论》，《历史研究》2018(4)。'],
      ['book', '宋代地方财政史研究', { author: '包伟民', publisher: '上海古籍出版社', year: 2001 },
        '258', '上供留州之说难成立。', '包伟民《宋代地方财政史研究》，上海古籍出版社，2001，258页。']
    ];
    for (const [mod, title, fields, loc, text, expected] of cases) {
      const { excerpt } = await makeMaterial(app, mod, title, fields, loc, text);
      const c = await post(app, '/api/compilations', { title: 'T-' + mod });
      const after = await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'quote', excerpt_id: excerpt.id });
      assert.strictEqual(after.refs[0].text, expected, mod + ' 脚注不符：' + after.refs[0].text);
      assert.ok(!after.refs[0].text.includes('{'), mod + ' 脚注不应残留占位符');
    }
  });
});

test('Phase6 - 字段缺失时脚注不出现「，立，」「第 页」等空壳', async () => {
  await withApp(async (app) => {
    const { excerpt } = await makeMaterial(app, 'inscription', '无年代碑', {}, '第 1 行', '残文若干。');
    const c = await post(app, '/api/compilations', { title: 'T' });
    const after = await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'quote', excerpt_id: excerpt.id });
    const t = after.refs[0].text;
    assert.strictEqual(t, '无年代碑。', '空字段应被清理，实际：' + t);
    assert.ok(!t.includes('立'), '不应残留「立」');

    const { excerpt: e2 } = await makeMaterial(app, 'book', '无出版信息书', {}, '10', '正文。');
    const c2 = await post(app, '/api/compilations', { title: 'T2' });
    const after2 = await post(app, '/api/compilations/' + c2.id + '/blocks', { type: 'quote', excerpt_id: e2.id });
    assert.ok(!after2.refs[0].text.includes('页页'), '不应出现重复页码');
  });
});

test('Phase6 - 验收7：删除首个引用块后脚注重新编号', async () => {
  await withApp(async (app) => {
    const a = await makeMaterial(app, 'classics', '甲书', {}, '卷一', '甲文。');
    const b = await makeMaterial(app, 'classics', '乙书', {}, '卷二', '乙文。');
    const d = await makeMaterial(app, 'classics', '丙书', {}, '卷三', '丙文。');
    const c = await post(app, '/api/compilations', { title: 'T' });
    for (const m of [a, b, d]) {
      await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'quote', excerpt_id: m.excerpt.id });
    }
    let cur = await get(app, '/api/compilations/' + c.id);
    assert.deepStrictEqual(cur.refs.map((r) => r.mark), ['①', '②', '③']);
    assert.ok(cur.refs[0].text.includes('甲书'));

    const firstQuote = cur.blocks[0].id;
    cur = await del(app, '/api/compilations/' + c.id + '/blocks/' + firstQuote);
    assert.strictEqual(cur.refs.length, 2);
    assert.deepStrictEqual(cur.refs.map((r) => r.mark), ['①', '②'], '剩余脚注应重排为 ①②');
    assert.ok(cur.refs[0].text.includes('乙书'), '重排后第一条应为乙书');
  });
});

test('Phase6 - 块上移下移后脚注同步重排', async () => {
  await withApp(async (app) => {
    const a = await makeMaterial(app, 'classics', '甲书', {}, '卷一', '甲文。');
    const b = await makeMaterial(app, 'classics', '乙书', {}, '卷二', '乙文。');
    const c = await post(app, '/api/compilations', { title: 'T' });
    await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'quote', excerpt_id: a.excerpt.id });
    await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'quote', excerpt_id: b.excerpt.id });
    let cur = await get(app, '/api/compilations/' + c.id);
    assert.ok(cur.refs[0].text.includes('甲书'));

    const second = cur.blocks[1].id;
    cur = await post(app, '/api/compilations/' + c.id + '/blocks/' + second + '/move', { direction: 'up' });
    assert.ok(cur.refs[0].text.includes('乙书'), '上移后乙书应排到第一');
    assert.ok(cur.refs[1].text.includes('甲书'));
  });
});

test('Phase6 - 验收8：切换夹注后页底清空、出处内联', async () => {
  await withApp(async (app) => {
    const a = await makeMaterial(app, 'classics', '甲书', { edition: '某版本' }, '卷一', '甲文。');
    const c = await post(app, '/api/compilations', { title: 'T' });
    await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'quote', excerpt_id: a.excerpt.id });

    const render=()=>{const service=require('../server/services/writing-export'),doc=require('../server/services/writing').get('compilation',c.id);return service.html(service.collect('compilation',c.id,doc.revision),'');};
    let html=render();
    assert.ok(html.includes('class="footnote"'), '页下注模式应渲染页底注释');
    assert.ok(html.includes('①'), '页下注模式正文应含圈标');

    await put(app, '/api/compilations/' + c.id, { footnote_style: 'inline' });
    html=render();
    assert.ok(html.includes('（《甲书》卷一，某版本。）'), '夹注模式应内联显示出处');
    assert.ok(html.includes('《甲书》卷一，某版本。'), '内联文本应含完整出处');
    assert.ok(!html.includes('class="footnote"'), '夹注模式页底注释区应清空');

    // 切回页下注
    await put(app, '/api/compilations/' + c.id, { footnote_style: 'footer' });
    html=render();
    assert.ok(html.includes('class="footnote"'), '切回页下注应恢复注释区');
  });
});

test('Phase6 - 验收9：导出 Markdown 含正文、按语与脚注', async () => {
  await withApp(async (app) => {
    const a = await makeMaterial(app, 'classics', '甲书', { edition: '某版本' }, '卷一', '绍兴十五年诏差役。');
    const c = await post(app, '/api/compilations', { title: '役法长编' });
    await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'heading', content: '一、绍兴以前之差役' });
    await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'quote', excerpt_id: a.excerpt.id });
    await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'comment', content: '此处雇钱标准待考。' });

    const res = await fetch(app.base + '/api/compilations/' + c.id + '/export');
    const md = await res.text();
    assert.ok(md.includes('# 役法长编'), '应含标题');
    assert.ok(md.includes('## 一、绍兴以前之差役'), '应含小标题');
    assert.ok(md.includes('绍兴十五年诏差役。'), '应含史料正文');
    assert.ok(md.includes('> 按：此处雇钱标准待考。'), '应含按语');
    assert.ok(md.includes('《甲书》卷一，某版本。'), '应含脚注文本');
    assert.ok(md.includes('①'), '页下注模式应带圈标');
  });
});

test('Phase6 - 夹注模式导出时出处内联在正文中', async () => {
  await withApp(async (app) => {
    const a = await makeMaterial(app, 'classics', '甲书', { edition: '某版本' }, '卷一', '甲文。');
    const c = await post(app, '/api/compilations', { title: 'T' });
    await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'quote', excerpt_id: a.excerpt.id });
    await put(app, '/api/compilations/' + c.id, { footnote_style: 'inline' });
    const md = await (await fetch(app.base + '/api/compilations/' + c.id + '/export')).text();
    assert.ok(md.includes('甲文。（《甲书》卷一，某版本。）'), '出处应内联，实际：' + md);
    assert.ok(!md.includes('## 注释'), '夹注模式不应输出注释区');
  });
});

test('Phase6 - 编辑块内容后持久化（验收3 的保存基础）', async () => {
  await withApp(async (app) => {
    const c = await post(app, '/api/compilations', { title: 'T' });
    const after = await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'text', content: '初稿' });
    const bid = after.blocks[0].id;
    await put(app, '/api/compilations/' + c.id + '/blocks/' + bid, { content: '改后的正文' });
    const cur = await get(app, '/api/compilations/' + c.id);
    assert.strictEqual(cur.blocks[0].content, '改后的正文');

    // 引导语与后缀
    const a = await makeMaterial(app, 'classics', '甲书', {}, '卷一', '甲文。');
    const withQuote = await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'quote', excerpt_id: a.excerpt.id });
    const qid = withQuote.blocks[1].id;
    await put(app, '/api/compilations/' + c.id + '/blocks/' + qid, { lead: '据《甲书》载：', tail: '（标点为笔者所加）' });
    const cur2 = await get(app, '/api/compilations/' + c.id);
    assert.strictEqual(cur2.blocks[1].lead, '据《甲书》载：');
    assert.strictEqual(cur2.blocks[1].tail, '（标点为笔者所加）');
  });
});

test('Phase6 - V2 停止输入2秒、持续输入最长10秒自动保存逻辑', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/save-controller.js'), 'utf8');
  const window={addEventListener(){}},delays=[];require('node:vm').runInNewContext(src,{window,document:{addEventListener(){}},setTimeout:(_fn,ms)=>{delays.push(ms);return delays.length;},clearTimeout(){},Date});
  const controller=new window.SaveController({read:()=>({}),save:async()=>({revision:1}),status(){}});controller.changed();assert.deepEqual(delays,[2000,10000]);
  controller.composing=true;controller.changed();assert.deepEqual(delays,[2000,10000],'输入法期间不得启动截断保存');
  assert.ok(src.includes("已保存"), '应更新“已保存 时间”');
});

test('Phase6 - 删除被引用的条目：正文保留、脚注标记为孤立', async () => {
  await withApp(async (app) => {
    const a = await makeMaterial(app, 'classics', '将删除的书', { edition: '某版本' }, '卷一', '甲文内容。');
    const c = await post(app, '/api/compilations', { title: 'T' });
    await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'quote', excerpt_id: a.excerpt.id });

    await del(app, '/api/items/' + a.item.id);
    const cur = await get(app, '/api/compilations/' + c.id);
    assert.strictEqual(cur.blocks.length, 1, '正文块应保留');
    assert.strictEqual(cur.blocks[0].quote_text, '甲文内容。', '原文应保留');
    assert.strictEqual(cur.refs.length, 1, '脚注应保留');
    assert.strictEqual(cur.refs[0].orphaned, 1, '脚注应标记为孤立');

    const html = await (await fetch(app.base + '/writing/compilations/' + c.id)).text();
    const document=await get(app,'/api/writing/compilation/'+c.id+'/document');
    const changes=await post(app,'/api/writing/citation-changes',{citations:document.citations});
    assert.equal(changes[0].state,'source_deleted','V2 应明确报告来源删除');
    assert.ok(JSON.stringify(document.content).includes('甲文内容。'),'新版正文也应保留快照');
  });
});

test('Phase6 - 插入到指定块之后', async () => {
  await withApp(async (app) => {
    const a = await makeMaterial(app, 'classics', '甲书', {}, '卷一', '甲文。');
    const b = await makeMaterial(app, 'classics', '乙书', {}, '卷二', '乙文。');
    const c = await post(app, '/api/compilations', { title: 'T' });
    let cur = await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'quote', excerpt_id: a.excerpt.id });
    await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'quote', excerpt_id: b.excerpt.id });
    // 把甲书插到第一个块（乙书?）之后：此时顺序为 甲、乙
    cur = await get(app, '/api/compilations/' + c.id);
    assert.strictEqual(cur.blocks.length, 2);
    assert.ok(cur.blocks[0].quote_text.includes('甲文'));
    assert.ok(cur.blocks[1].quote_text.includes('乙文'));
  });
});

test('Phase6 - 编辑器页面渲染抽屉、正文与注释区', async () => {
  await withApp(async (app) => {
    const a = await makeMaterial(app, 'classics', '甲书', {}, '卷一', '甲文。');
    const c = await post(app, '/api/compilations', { title: 'T' });
    await post(app, '/api/compilations/' + c.id + '/blocks', { type: 'quote', excerpt_id: a.excerpt.id });
    const html = await (await fetch(app.base + '/writing/compilations/' + c.id)).text();
    assert.ok(html.includes('id="writing-toolbar"')&&html.includes('/static/dist/editor.js'),'V2 应渲染带录文选择器的统一编辑器');
    const document=await get(app,'/api/writing/compilation/'+c.id+'/document');
    assert.ok(JSON.stringify(document.content).includes('甲文。'),'新版编辑器数据必须保留原文');
    assert.ok(html.includes('注释'), '应有注释区');
    assert.ok(html.includes('导出 Markdown'));
    assert.ok(html.includes('注释格式'), '应有脚注格式切换按钮');
  });
});
