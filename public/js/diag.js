// 页面内错误显示：脚本出错时在页面顶部显示红色横幅，并在右下角提供「诊断」按钮。
// 目的：不必打开开发者工具就能看到真实报错（Electron 下 F12 默认未绑定）。
(function () {
  const errors = [];
  const MAX = 8;

  function record(kind, text) {
    errors.push({ kind: kind, text: String(text).slice(0, 500), at: new Date().toLocaleTimeString() });
    if (errors.length > MAX) errors.shift();
    show();
  }

  let banner = null;
  function show() {
    if (!errors.length) { if (banner) banner.remove(); banner = null; return; }
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'err-banner';
      document.body.appendChild(banner);
    }
    const last = errors[errors.length - 1];
    banner.textContent = '页面报错（' + errors.length + '）：' + last.kind + ' — ' + last.text;
    banner.title = errors.map((e) => e.at + ' ' + e.kind + ': ' + e.text).join('\n');
  }

  window.addEventListener('error', (e) => {
    record('脚本错误', (e.message || '') + (e.filename ? ' @ ' + String(e.filename).split('/').pop() + ':' + e.lineno : ''));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    record('未处理的异步错误', (r && (r.message || r)) || '未知');
  });

  // 诊断面板
  function panel() {
    if (document.getElementById('diag-panel')) return;
    const box = document.createElement('div');
    box.id = 'diag-panel';
    box.className = 'diag-panel';
    // 布局实测：直接读浏览器算出来的样式与位置，一次截图即可定位问题
    const rectOf = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const appEl = document.querySelector('.app');
    const appCs = appEl ? getComputedStyle(appEl) : null;
    const sheetInfo = Array.from(document.styleSheets).map((s) => {
      let rules = -1;
      try { rules = s.cssRules ? s.cssRules.length : -1; } catch (e) { rules = -2; }   // -2 = 跨域/无法读取
      return (s.href || '内联') + ' [' + rules + ' 条规则]';
    });
    const rows = [
      ['布局 display', appCs ? appCs.display : '(无 .app)'],
      ['侧栏位置', JSON.stringify(rectOf('.app > .sidebar, .sidebar'))],
      ['主区位置', JSON.stringify(rectOf('.app > .main, .main'))],
      ['窗口/文档高', window.innerHeight + ' / ' + document.body.scrollHeight],
      ['样式表', sheetInfo.join('  ')],
      ['当前页面', location.pathname],
      ['栏目模块', String((window.__MODULE__) || '(无)')],
      ['拖入导入', window.__dropImport ? ('已启用=' + !!window.__dropImport.enabled + '，已收到拖放=' + (window.__dropImport.dragSeen || 0) + ' 次') : '未加载'],
      ['脚本数', document.scripts.length]
    ];
    box.innerHTML = '<div class="diag-title">诊断信息</div>'
      + rows.map((r) => '<div class="diag-row"><b>' + r[0] + '</b><span>' + String(r[1]) + '</span></div>').join('')
      + '<div class="diag-title">最近错误（' + errors.length + '）</div>'
      + (errors.length
        ? errors.map((e) => '<div class="diag-err">' + e.at + ' ' + e.kind + '：' + e.text + '</div>').join('')
        : '<div class="diag-ok">没有捕获到脚本错误</div>')
      + '<div class="diag-ops"><button type="button" id="diag-copy">复制全部</button><button type="button" id="diag-close">关闭</button></div>';
    document.body.appendChild(box);
    box.querySelector('#diag-close').onclick = () => box.remove();
    box.querySelector('#diag-copy').onclick = () => {
      const text = rows.map((r) => r[0] + '：' + r[1]).join('\n')
        + '\n\n最近错误：\n' + (errors.map((e) => e.at + ' ' + e.kind + '：' + e.text).join('\n') || '（无）');
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      if (window.toast) toast('诊断信息已复制到剪贴板');
    };
  }

  function ensureButton() {
    if (document.getElementById('diag-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'diag-btn';
    btn.className = 'diag-btn';
    btn.type = 'button';
    btn.textContent = '诊断';
    btn.title = '查看页面加载与报错信息';
    btn.onclick = panel;
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureButton);
  else ensureButton();

  // 供外部调用：window.__diagErrors()
  window.__diagErrors = () => errors.slice();
})();
