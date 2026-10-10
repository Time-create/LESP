const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, root } = require('../tests/e2e/helpers');
(async () => {
  const run = await launch({ packaged: true });
  try {
    const errors = [];
    run.page.on('pageerror', error => errors.push(error.message));
    for (const [route, button] of [['compilations', '#btn-new-comp'], ['notes', '#note-new'], ['ideas', '#idea-new']]) {
      await run.page.goto(run.base + '/writing/' + route);
      const error = run.page.waitForEvent('pageerror');
      await run.page.locator(button).click();
      assert.match((await error).message, /prompt/i);
    }
    const item = await run.request('/api/items', 'POST', { module: 'classics', title: '基线测试古籍' });
    await run.page.goto(run.base + '/sources/classics/' + item.id);
    assert.equal(await run.page.getByRole('button', { name: '新增录文', exact: true }).count(), 0);
    fs.writeFileSync(path.join(root, 'docs/v2/baseline.json'), JSON.stringify({ at: new Date().toISOString(), errors, missingExcerptEntry: true, isolatedDataDir: run.dir }, null, 2));
    console.log('P0 desktop reproduction: three prompt failures and missing excerpt entry confirmed');
  } finally { await run.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
