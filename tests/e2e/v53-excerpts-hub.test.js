// 录文集（V5.3，资料库 → 录文）：跨条目查阅与归类。
// 覆盖：导航入口、分类树计数、未归类筛选、分类点击跳转、右键菜单、
//       卡片标签就地增删分类（真落库）、搜索、条目页旧分类面板已移除。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { launch } = require('./helpers');

test('V5.3 录文集：查阅、筛选、右键维护与就地归类', { timeout: 150000 }, async () => {
  const run = await launch();
  const page = run.page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    // —— 准备数据：一个条目 + 两条录文 ——
    const item = await run.request('/api/items', 'POST', { module: 'paper', title: '录文集测试条目' });
    const ex1 = await run.request('/api/excerpts', 'POST', { item_id: item.id, text: '第一条录文正文：侨批与商号', locator: '卷一·页 3' });
    const ex2 = await run.request('/api/excerpts', 'POST', { item_id: item.id, text: '第二条录文正文：不相关的内容', locator: '卷二·页 8' });

    // —— 1. 导航里有「录文」——
    await page.goto(run.base + '/library/papers', { waitUntil: 'domcontentloaded' });
    await page.locator('.topbar-btn[data-menu-btn="资料库"]').click();
    const nav = await page.locator('.topbar-drop[data-menu-drop="资料库"] .topbar-item').allTextContents();
    assert.ok(nav.some((x) => x.trim() === '录文'), '资料库下应有「录文」入口');

    // —— 2. 录文集页基本结构与计数 ——
    await page.goto(run.base + '/excerpts', { waitUntil: 'domcontentloaded' });
    assert.equal((await page.locator('.ex-card').count()), 2, '应列出全部 2 条录文');
    assert.equal((await page.locator('.hub-count').innerText()).trim(), '2 条');
    // 两条都未归类 → 未归类徽标应为 2
    assert.equal((await page.locator('.tree-count-warn').innerText()).trim(), '2', '未归类徽标应为 2');

    // —— 3. 未归类筛选 ——
    await page.locator('.hub-side a:has-text("未归类")').click();
    await page.waitForLoadState('domcontentloaded');
    assert.equal(await page.locator('.ex-card').count(), 2);

    // —— 4. 建分类后，点分类能筛出对应录文 ——
    const folder = await run.request('/api/excerpt-folders', 'POST', { name: '测试分类甲' });
    await page.goto(run.base + '/excerpts', { waitUntil: 'domcontentloaded' });
    // 树上应显示该分类，计数 0（还没有录文归入）
    const row = page.locator('.hub-side .tree-node[data-id="' + folder.id + '"] .tree-count');
    assert.equal((await row.innerText()).trim(), '0', '空分类也要显示，计数为 0');

    // —— 5. 卡片「未归类」标签 → 勾选 → 保存，真的落库 ——
    await page.locator('.ex-card[data-ex-card="' + ex1.id + '"] .ex-tag-empty').click();
    const dlg = page.locator('dialog.wb-dialog');
    await dlg.waitFor();
    assert.match(await dlg.locator('h2').innerText(), /归类录文/);
    await dlg.locator('select[name=folderIds] option[value="' + folder.id + '"]').evaluate((o) => { o.selected = true; });
    await dlg.locator('[type=submit]').click();
    await page.waitForTimeout(600);
    // 关联已写入
    const links = await run.request('/api/excerpt-folders?tree=1');
    void links;
    const check = await run.request('/api/excerpts?item_id=' + item.id);
    assert.ok(check.some((r) => r.id === ex1.id && (r.folderIds || []).includes(folder.id)),
      '第一条录文应已归入测试分类甲');
    assert.ok(!check.some((r) => r.id === ex2.id && (r.folderIds || []).includes(folder.id)),
      '第二条录文不应被归类');

    // —— 6. 分类筛选：只列出该分类下的录文 ——
    await page.goto(run.base + '/excerpts?folder=' + folder.id, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('.ex-card').count(), 1, '该分类下应只有 1 条');
    assert.match(await page.locator('.hub-head h2').innerText(), /测试分类甲/);

    // —— 7. 计数应与筛选结果一致（点进去几个就是几个）——
    const cnt = Number((await page.locator('.hub-side .tree-node[data-id="' + folder.id + '"] .tree-count').innerText()).trim());
    assert.equal(cnt, 1, '树上计数应与点开后的条数一致');

    // —— 8. 点标签 × 移除分类 ——
    await page.locator('.ex-card[data-ex-card="' + ex1.id + '"] .ex-tag').first().click();
    await page.waitForTimeout(600);
    assert.equal((await run.request('/api/excerpts?item_id=' + item.id))
      .find((r) => r.id === ex1.id).folderIds.length, 0, '应已移出全部分类');

    // —— 9. 右键菜单：新建子分类 / 重命名 / 移动到… / 删除 ——
    await page.goto(run.base + '/excerpts', { waitUntil: 'domcontentloaded' });
    await page.locator('.hub-side .tree-node[data-id="' + folder.id + '"] .tree-row').click({ button: 'right' });
    const menu = await page.locator('.ctx-menu button').allTextContents();
    for (const label of ['新建子分类', '重命名', '移动到…', '删除']) {
      assert.ok(menu.includes(label), '右键菜单应含「' + label + '」');
    }
    // 真的重命名一次
    await page.locator('.ctx-menu button:has-text("重命名")').click();
    const edit = page.locator('dialog.wb-dialog');
    await edit.waitFor();
    await edit.locator('[name=name]').fill('测试分类甲改名');
    await edit.locator('[type=submit]').click();
    await page.waitForTimeout(1500);
    assert.match(await page.locator('.hub-side .tree-as-filter[data-folder-filter="' + folder.id + '"]').innerText(),
      /测试分类甲改名/, '重命名应生效');

    // —— 10. 搜索 ——
    await page.goto(run.base + '/excerpts?q=' + encodeURIComponent('不相关'), { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('.ex-card').count(), 1, '搜索应只命中 1 条');

    // —— 11. 条目页：旧「录文分类（全局）」面板已移除，录文页签保留 ——
    await page.goto(run.base + '/library/papers/' + item.id, { waitUntil: 'domcontentloaded' });
    const tabs = await page.locator('.tab').allTextContents();
    assert.ok(tabs.some((x) => x.includes('录文')), '录文页签应保留');
    assert.equal(await page.locator('.excerpt-tree').count(), 0, '旧分类树应已移除');
    assert.equal(await page.locator('#btn-assign-folders').count(), 0, '「归类本条目」应已移除');
    assert.equal(await page.locator('#btn-manage-folders').count(), 0, '「管理分类」应已移除');
    assert.equal(await page.locator('#excerpt-folder-filter').count(), 0, '旧分类下拉应已移除');
    // 录文列表本身还在
    assert.equal(await page.locator('[data-excerpt-card]').count(), 2, '本条目录文列表应保留');

    // —— 12. 条目页录文区：卡片编辑/删除仍可用（新增入口已按 V5.3 移除）——
    await page.locator('[data-excerpt-action="edit"]').first().click();
    const editEx = page.locator('dialog.wb-dialog');
    await editEx.waitFor();
    assert.match(await editEx.locator('h2').innerText(), /编辑录文/, '卡片上的「编辑录文」应仍可用');
    assert.equal(await editEx.locator('[name=folderIds]').count(), 1, '录文表单应仍能选分类');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    // 「新增录文」按钮已移除 —— 录文改由 PDF 阅读器的「转为录文」录入
    assert.equal(await page.locator('[data-excerpt-action="new"]').count(), 0, '「新增录文」按钮应已移除');

    assert.deepEqual(errors, [], '不应有 JS 错误');
  } finally {
    await run.close();
  }
});
