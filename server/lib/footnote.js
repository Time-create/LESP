// 脚注生成与重排。
// 模板语法：{key} 取值；{key|后缀} 表示值非空时才连同后缀一起输出（如 {era|立}）。
// 值缺失时占位符整体消失，再统一清理残留的标点，避免出现「，立，」「第 页」这类空壳。
const db = require('../db');
const { MODULES } = require('../config/modules');

function parseFields(raw) {
  try {
    return typeof raw === 'object' ? raw : JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
}

function buildFootnote(item, excerpt) {
  const f = parseFields(item.fields);
  const tpl = (MODULES[item.module] && MODULES[item.module].footnote) || '{title}。';
  let s = tpl.replace(/\{(\w+)(?:\|([^}]*))?\}/g, (m, key, suffix) => {
    let v;
    if (key === 'title') v = item.title;
    else if (key === 'locator') v = excerpt ? excerpt.locator : '';
    else v = f[key] == null ? '' : String(f[key]);
    v = String(v == null ? '' : v).trim();
    if (!v) return '';
    return v + (suffix || '');
  });
  s = s.replace(/《》/g, '');
  s = s.replace(/，\s*，/g, '，');
  s = s.replace(/，\s*。/g, '。');
  s = s.replace(/^，/, '').replace(/，$/, '');
  s = s.replace(/\s{2,}/g, ' ');
  s = s.replace(/，,/g, '，');
  return s;
}

function markFor(n) {
  // ① ② ③ … 超过 20 后回退为 (n)
  if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
  return '(' + n + ')';
}

// 重排脚注：按块顺序为引用块重新生成编号与文本。
// 条目已删除时无法重新生成，保留原脚注文本并标记为孤立（前端标灰）。
function renumber(compilationId) {
  const blocks = db.dbAll(
    'SELECT * FROM compilation_blocks WHERE compilation_id = ? ORDER BY seq, id',
    [compilationId]
  );
  const oldRefs = {};
  for (const r of db.dbAll('SELECT * FROM compilation_refs WHERE compilation_id = ?', [compilationId])) {
    oldRefs[r.block_id] = r;
  }
  db.dbRun('DELETE FROM compilation_refs WHERE compilation_id = ?', [compilationId]);

  let n = 0;
  for (const b of blocks) {
    if (b.type !== 'quote') continue;
    n += 1;
    const ex = b.excerpt_id ? db.dbGet('SELECT * FROM excerpts WHERE id = ?', [b.excerpt_id]) : null;
    const item = ex ? db.dbGet('SELECT * FROM items WHERE id = ?', [ex.item_id]) : null;
    let text;
    let itemId = 0;
    let orphaned = b.orphaned ? 1 : 0;
    if (item) {
      text = oldRefs[b.id] ? oldRefs[b.id].text : buildFootnote(item, ex);
      itemId = item.id;
    } else {
      const old = oldRefs[b.id];
      text = old ? old.text : '';
      itemId = old ? old.item_id : 0;
      orphaned = 1;
    }
    db.dbRun(
      'INSERT INTO compilation_refs (compilation_id, block_id, mark, item_id, excerpt_id, text, orphaned, seq) VALUES (?,?,?,?,?,?,?,?)',
      [compilationId, b.id, markFor(n), itemId, b.excerpt_id || null, text, orphaned, n]
    );
  }
  return n;
}

module.exports = { buildFootnote, renumber, markFor };
