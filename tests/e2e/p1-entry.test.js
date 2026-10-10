const { test } = require('node:test');
const assert = require('node:assert/strict');
const { launch } = require('./helpers');
test('P1 desktop: create/cancel/retry writing and six-source excerpt editing persist after restart', { timeout: 120000 }, async () => {
  let run = await launch();
  const dir = run.dir;
  const errors = []; run.page.on('pageerror', e => errors.push(e.message));
  try {
    for (const [kind, button, label] of [['compilations', '#btn-new-comp', '长编'], ['notes', '#note-new', '札记'], ['ideas', '#idea-new', '灵感']]) {
      await run.page.goto(run.base + '/writing/' + kind);
      await run.page.locator(button).click();
      await run.page.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal((await run.request('/api/' + kind)).length, 0);
      await run.page.locator(button).click();
      await run.page.getByLabel(label + '标题').fill('测试' + label);
      if (kind === 'notes') {
        await run.page.route('**/api/notes', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"保存故障测试"}' }));
        await run.page.getByRole('button', { name: '创建', exact: true }).click();
        await run.page.getByRole('alert').filter({ hasText: '保存故障测试' }).waitFor();
        assert.equal(await run.page.getByLabel(label + '标题').inputValue(), '测试札记');
        await run.page.unroute('**/api/notes');
      }
      await Promise.all([run.page.waitForURL(url => url.toString().includes('/' + kind + '/')), run.page.getByRole('button', { name: '创建', exact: true }).click()]);
      assert.equal((await run.request('/api/' + kind)).length, 1);
    }
    for (const [module, route] of [['classics','/sources/classics'],['inscription','/sources/inscriptions'],['document','/sources/documents'],['archive','/sources/archives'],['paper','/library/papers'],['book','/library/books']]) {
      const item = await run.request('/api/items', 'POST', { module, title: '测试' + module, fields: module === 'document' ? { doc_type: '契约' } : {} });
      await run.page.goto(run.base + route + '/' + item.id);
      await run.page.getByRole('button', { name: '新增录文', exact: true }).click();
      await run.page.getByLabel('录文正文').fill('第一行\n第二行');
      await run.page.getByLabel('出处定位').fill('卷三 第八页');
      await Promise.all([run.page.waitForEvent('load'), run.page.getByRole('button', { name: '保存', exact: true }).click()]);
      await run.page.getByRole('button', { name: '编辑录文', exact: true }).click();
      await run.page.getByLabel('录文正文').fill('修订后原文');
      await Promise.all([run.page.waitForEvent('load'), run.page.getByRole('button', { name: '保存', exact: true }).click()]);
      assert.equal((await run.request('/api/excerpts?item_id=' + item.id))[0].text, '修订后原文');
    }
    assert.deepEqual(errors, []);
    await run.close(); run = await launch({ dir });
    assert.equal((await run.request('/api/notes')).length, 1);
    assert.equal((await run.request('/api/excerpts?item_id=1'))[0].text, '修订后原文');
  } finally { await run.close(); }
});
