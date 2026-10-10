// 前端通用：fetch 封装、Toast、二次确认
(function () {
  // 全局错误可见化：此前任何脚本抛错都只在开发者工具里出现，
  // 而本应用默认没有开发者工具入口，用户只看到「点了没反应」。
  // 这里把未捕获错误与 Promise 拒绝直接显示在页面左上角，肉眼即可判断原因。
  (function reportErrors() {
    if (window.__errReporter) return;
    window.__errReporter = true;
    const box = document.createElement('div');
    box.id = 'err-reporter';
    box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;max-width:70vw;' +
      'font:11px/1.5 Consolas,Menlo,monospace;color:#8a1f10;background:#fff5f3;' +
      'border:1px solid #e0a89c;border-radius:6px;padding:6px 9px;pointer-events:none;' +
      'white-space:pre-wrap;box-shadow:0 2px 10px rgba(0,0,0,.12)';
    const show = (kind, text) => {
      if (!document.body) return;
      document.body.appendChild(box);
      const line = document.createElement('div');
      line.textContent = kind + '：' + String(text).slice(0, 200);
      box.appendChild(line);
      while (box.childElementCount > 4) box.removeChild(box.firstChild);
    };
    window.addEventListener('error', (e) => {
      show('JS错误', (e.message || '') + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno);
    });
    window.addEventListener('unhandledrejection', (e) => {
      show('异步错误', (e.reason && (e.reason.message || e.reason)) || e.reason);
    });
  })();

  // 交互诊断：出现「点了没反应」时，页面上直接显示点击有没有到达 DOM 事件层。
  // 按 D 切换。用于区分两类问题：
  //   「点击计数不增长」= 事件根本没进来（遮罩／渲染进程问题）
  //   「计数增长但没弹窗」= 处理器内部抛错（此时左上角会显示错误）
  (function clickDiagnostics() {
    if (window.__clickDiag) return;
    window.__clickDiag = { on: false, count: 0, last: '' };
    const paint = () => {
      let el = document.getElementById('click-diag');
      if (!window.__clickDiag.on) { if (el) el.remove(); return; }
      if (!el) {
        el = document.createElement('div');
        el.id = 'click-diag';
        el.style.cssText = 'position:fixed;right:8px;top:8px;z-index:2147483647;' +
          'font:11px/1.5 Consolas,Menlo,monospace;color:#1a4a8a;background:#f2f7ff;' +
          'border:1px solid #9db8dd;border-radius:6px;padding:6px 9px;pointer-events:none;max-width:70vw';
        if (document.body) document.body.appendChild(el);
      }
      el.textContent = '诊断：已捕获点击 ' + window.__clickDiag.count + ' 次｜最近：' + window.__clickDiag.last;
    };
    window.addEventListener('click', (e) => {
      if (!window.__clickDiag.on) return;
      const t = e.target;
      window.__clickDiag.count++;
      window.__clickDiag.last = (t && (t.id || t.tagName + (t.className ? '.' + String(t.className).split(' ')[0] : ''))) || '(未知)';
      paint();
    }, true);
    window.addEventListener('keydown', (e) => {
      // e.key 随 Shift 变化：小写 d 时是 'd'、大写 D 时是 'D'。
      // 原先只判'D'，导致按小写 d 完全没反应。
      if (e.key && e.key.toLowerCase() === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        window.__clickDiag.on = !window.__clickDiag.on;
        window.__clickDiag.count = 0; window.__clickDiag.last = '（已开启）';
        paint();
      } else if (window.__clickDiag.on) {
        paint();
      }
    });
  })();

  window.api = async function (url, options = {}) {
    const opt = Object.assign({ headers: {} }, options);
    if (opt.body && typeof opt.body === 'object') {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(opt.body);
    }
    const res = await fetch(url, opt);
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : ('请求失败 ' + res.status);
      throw new Error(msg);
    }
    return data;
  };

  window.toast = function (msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 2600);
  };

  window.confirmBox = function (msg) {
    return window.confirm(msg);
  };

  window.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
})();
