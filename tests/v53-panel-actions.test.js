// 列表页右栏局部详情里的「编辑」「上传附件」（V5.3 修复回归）。
//
// 缺陷现象：右栏里的这两个按钮点击毫无反应，但诊断面板显示
// 「已捕获点击 N 次｜最近：btn-edit/btn-upload」—— 事件到了 DOM，却没有处理器。
//
// 两个独立根因：
//   1) item.js 的编辑分支读 window.__ITEM__，而右栏片段由 innerHTML 注入，
//      从不设置该变量（列表页恒为 null）→ 前置 if (item) 直接拦下；
//   2) upload.js 在页面加载时就执行完，那时 #btn-upload 还不存在 → 直接 return，
//      之后按钮永远没有事件绑定。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

test('右栏片段必须自带 item 数据（编辑的前提）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/views/page-item.js'), 'utf8');
  const m = /function renderPanel\([\s\S]*?\n\}/.exec(src);
  assert.ok(m, '应存在 renderPanel');
  assert.ok(m[0].includes('data-panel-item'), 'renderPanel 应把 item 数据写进片段');
  assert.ok(m[0].includes('jsonForScript'), '应经jsonForScript 转义（防注入）');
  // 完整页与右栏的数据结构必须一致，避免两处逻辑分叉
  assert.ok(/id:\s*item\.id[\s\S]*?title:\s*item\.title[\s\S]*?fields:\s*parseFields/.test(m[0]),
    '片段数据字段应与完整页一致');
});

test('item.js：编辑按钮需就近解析条目，不能只依赖 window.__ITEM__', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/item.js'), 'utf8');
  assert.ok(/const resolveItem = \(\) =>/.test(src), '应有 resolveItem 解析函数');
  assert.ok(/data-panel-item/.test(src), 'resolveItem 应能读片段上的 data-panel-item');
  // 编辑分支必须走 resolveItem
  const editBlock = /if \(hit\(e, 'btn-edit'\)\) \{[\s\S]*?\n    \}/.exec(src);
  assert.ok(editBlock, '应能找到编辑分支');
  assert.ok(editBlock[0].includes('resolveItem()'), '编辑分支应使用 resolveItem()');
  assert.ok(!/if \(hit\(e, 'btn-edit'\)\) \{\s*const item = window\.__ITEM__;/.test(src),
    '不应再直接读 window.__ITEM__（右栏里恒为 null）');
});

test('item.js：保存后应关弹窗并就地刷新右栏', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/item.js'), 'utf8');
  const block = /if \(editingId\) \{[\s\S]*?\n      \} else \{/.exec(src);
  assert.ok(block, '应能找到编辑保存分支');
  assert.ok(block[0].includes('closeModal()'), '右栏局部编辑后应关闭弹窗');
  assert.ok(block[0].includes('__rebindPanel'), '应通过 __rebindPanel 局部刷新');
  // 列表页里的标题也要跟着变
  assert.ok(/__rebindPanel\(editingId, \{ title \}\)/.test(src), '应把新标题传给重绑函数以同步列表');
});

test('upload.js：必须可重复绑定，且能从片段读条目', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/upload.js'), 'utf8');
  assert.ok(/window\.__bindUpload = bind/.test(src), '应导出 __bindUpload 供片段插入后调用');
  assert.ok(/function bind\(\)/.test(src), '应有可重复调用的 bind()');
  assert.ok(/data-panel-item/.test(src), '应能从片段读 item（完整页 __ITEM__ 为 null 时）');
  // 幂等：重复调用不能叠加事件处理器
  assert.ok(/dataset\.bound === '1'/.test(src), '应有幂等保护（dataset.bound）');
  // 核心行为
  assert.ok(/input\.click\(\)/.test(src), '按钮点击应弹出文件选择框');
  assert.ok(!/if \(!input\.files[\s\S]{0,60}return toast\('请先选择文件'\)/.test(src),
    '不应再有「没选文件就返回」的死路');
  assert.ok(/input\.hidden = true/.test(src), '原生控件应隐藏');
});

test('detail-panel.js：插入片段后应重绑上传并提供局部刷新入口', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/detail-panel.js'), 'utf8');
  const load = /async function loadPanel[\s\S]*?\n  \}/.exec(src);
  assert.ok(load, '应能找到 loadPanel');
  assert.ok(load[0].includes('__bindUpload'), '插入片段后应调用 __bindUpload');
  assert.ok(load[0].indexOf('__bindUpload') > load[0].indexOf('innerHTML'),
    '必须在 innerHTML 插入之后调用');
  assert.ok(/window\.__rebindPanel = \(id, patch\)/.test(src), '应提供 __rebindPanel');
  assert.ok(/patch && patch\.title/.test(src), '应支持把新标题同步到左栏列表');
});

test('诊断器仍在（排查此类问题时依赖它）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/common.js'), 'utf8');
  assert.ok(src.includes('__clickDiag'), '点击诊断器应保留');
  assert.ok(/toLowerCase\(\) === 'd'/.test(src), '按 d（小写）应能唤出诊断器');
});
