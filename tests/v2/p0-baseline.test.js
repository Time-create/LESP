const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');
const { baseline } = require('../../scripts/baseline');
test('P0: online backup captures WAL committed Chinese text without modifying source', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-baseline-'));
  const source = path.join(dir, 'source'); fs.mkdirSync(source);
  const db = new Database(path.join(source, 'app.db'));
  try {
    db.exec(fs.readFileSync(path.join(__dirname, '../../server/schema.sql'), 'utf8'));
    db.prepare("INSERT INTO notes(title,body,created_at,updated_at) VALUES (?,?,?,?)").run('原札记', '中文原文\n不可丢失', 'now', 'now');
    const result = await baseline(source, path.join(dir, 'backup'));
    assert.equal(result.counts.notes, 1);
    const copy = new Database(path.join(dir, 'backup/app.db'));
    assert.equal(copy.prepare('SELECT body FROM notes').get().body, '中文原文\n不可丢失'); copy.close();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notes').get().n, 1);
    await assert.rejects(baseline(source, path.join(dir, 'backup')), /already exists/);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
