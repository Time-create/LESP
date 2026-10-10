const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers');
test('P1: six sources reject blank updates and canceled note-entry GET does not create records', async () => {
  const run = await startApp();
  const request = async (url, method = 'GET', body) => fetch(run.base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  try {
    for (const module of ['classics', 'inscription', 'document', 'archive', 'paper', 'book']) {
      const created = await request('/api/items', 'POST', { module, title: '录文测试', fields: module === 'document' ? { doc_type: '契约' } : {} });
      assert.equal(created.ok, true);
      const item = await created.json();
      const excerpt = await (await request('/api/excerpts', 'POST', { item_id: item.id, text: '甲文\n乙文', comment: '按语' })).json();
      assert.equal((await request('/api/excerpts/' + excerpt.id, 'PUT', { text: '  ' })).status, 400);
      assert.equal((await (await request('/api/excerpts?item_id=' + item.id)).json())[0].text, '甲文\n乙文');
    }
    await request('/writing/notes/new?link=item:1');
    assert.equal((await (await request('/api/notes')).json()).length, 0);
  } finally { await run.close(); }
});
