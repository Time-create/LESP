// 附件上传（V5.3 修复回归）：点「上传附件」应弹出系统文件选择框，选完自动上传。
// 修复前：按钮只检查隐藏的原生 input 里有没有文件，没选就只弹提示 —— 表现为「点了没反应」。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

test('上传附件：按钮应弹出文件框并自动上传（原缺陷回归）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/upload.js'), 'utf8');

  // 核心：按钮点击必须触发 input.click()，这是修复前缺失的一环
  assert.ok(/input\.click\(\)/.test(src), '按钮点击应调用 input.click() 弹出文件选择框');

  // 不得再有「没选文件就直接 return」的死路
  assert.ok(!/if \(!input\.files[\s\S]{0,60}return toast\('请先选择文件'\)/.test(src),
    '不应再因input 为空而直接返回提示（那正是失效原因）');

  // 原生控件应隐藏，入口合一
  assert.ok(/input\.hidden\s*=\s*true/.test(src) || /display\s*=\s*'none'/.test(src),
    '原生 file 控件应隐藏，由按钮代为触发');

  // 上传请求与回显
  assert.ok(src.includes('/api/attachments/upload'), '应调用上传接口');
  assert.ok(/location\.reload\(\)/.test(src), '成功后应刷新以回显附件列表');
  // 允许重复选同一个文件
  assert.ok(/input\.value\s*=\s*''/.test(src), '上传后应清空 input，允许重选同一文件');
});

test('条目页附件区：只保留一个上传按钮，无重复入口', () => {
  const view = fs.readFileSync(path.join(ROOT, 'server/views/page-item.js'), 'utf8');
  const m = /const attHtml = `([\s\S]*?)`;/.exec(view);
  assert.ok(m, '应存在 attHtml 模板');
  const html = m[1];
  assert.equal((html.match(/type="file"/g) || []).length, 1, '只应有一个隐藏的 file input');
  assert.equal((html.match(/id="btn-upload"/g) || []).length, 1, '只应有一个上传按钮');
  // 上传接口仍需存在（后端未动）
  const routes = fs.readFileSync(path.join(ROOT, 'server/routes/attachments.js'), 'utf8');
  assert.ok(routes.includes('/upload'), '上传接口应仍存在');
});

test('条目页头部按钮：编辑/新建走 closest 判定（文字节点也生效）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/item.js'), 'utf8');
  // 修复前用 e.target.id，点击落在按钮文字上取不到 → 点了没反应
  assert.ok(!/e\.target\.id\s*===\s*'btn-edit'/.test(src), '不应再用 e.target.id 判定编辑按钮');
  assert.ok(/hit\(e,\s*'btn-edit'\)/.test(src), '应改用 closest 判定');
  assert.ok(/const hit = \(e, id\)/.test(src), '应有 hit 辅助函数');
  // 同一段里的其它按钮一并覆盖
  for (const id of ['btn-new', 'btn-del', 'modal-close', 'modal-cancel', 'modal-save']) {
    assert.ok(new RegExp("hit\\(e, '" + id + "'\\)").test(src), id + ' 应走 hit() 判定');
  }
});
