(function () {
  const mode = window.__MODE__;
  const comp = window.__COMPILATION__;

  function toast2(m) { window.toast(m); }

  if (mode === 'list') {
    document.getElementById('btn-new-comp').addEventListener('click', async () => {
      newWriting('compilations', '长编');
    });
    return;
  }

  // ---- 编辑器模式 ----
  let dirty = new Map(); // blockId -> {field: value}
  let lastSaved = null;

  function markDirty(blockId, field, value) {
    if (!dirty.has(blockId)) dirty.set(blockId, {});
    dirty.get(blockId)[field] = value;
  }

  async function flush() {
    if (!dirty.size) return;
    const entries = Array.from(dirty.entries());
    dirty = new Map();
    for (const [blockId, fields] of entries) {
      try {
        await api('/api/compilations/' + comp.id + '/blocks/' + blockId, { method: 'PUT', body: fields });
      } catch (e) {
        toast2(e.message);
      }
    }
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    lastSaved = p(d.getHours()) + ':' + p(d.getMinutes());
    const el = document.getElementById('save-time');
    if (el) el.textContent = '已保存 ' + lastSaved;
  }

  // 30 秒自动保存（PRD：长编编辑器每 30 秒自动保存并显示时间）
  setInterval(flush, 30000);

  async function reload() { location.reload(); }

  document.addEventListener('click', async (e) => {
    const t = e.target;

    if (t.classList.contains('dc-insert')) {
      const exId = t.dataset.excerpt;
      try {
        await api('/api/compilations/' + comp.id + '/blocks', {
          method: 'POST', body: { type: 'quote', excerpt_id: Number(exId) }
        });
        toast2('已插入，脚注已生成');
        reload();
      } catch (err) { toast2(err.message); }
      return;
    }

    const add = t.dataset && t.dataset.add;
    if (add) {
      try {
        await api('/api/compilations/' + comp.id + '/blocks', { method: 'POST', body: { type: add, content: '' } });
        reload();
      } catch (err) { toast2(err.message); }
      return;
    }

    const act = t.dataset && t.dataset.act;
    if (act && t.dataset.id) {
      const bid = t.dataset.id;
      try {
        if (act === 'del') {
          if (!confirmBox('删除该块？对应脚注会一并删除并重新编号。')) return;
          await api('/api/compilations/' + comp.id + '/blocks/' + bid, { method: 'DELETE' });
        } else {
          await api('/api/compilations/' + comp.id + '/blocks/' + bid + '/move', {
            method: 'POST', body: { direction: act === 'up' ? 'up' : 'down' }
          });
        }
        reload();
      } catch (err) { toast2(err.message); }
      return;
    }

    if (t.id === 'btn-style') {
      const next = comp.footnote_style === 'footer' ? 'inline' : 'footer';
      try {
        await api('/api/compilations/' + comp.id, { method: 'PUT', body: { footnote_style: next } });
        reload();
      } catch (err) { toast2(err.message); }
    }
  });

  // 输入即标记脏数据，失焦时保存
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.id || !el.dataset.field) return;
    markDirty(el.dataset.id, el.dataset.field, el.value);
  });
  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.id && el.dataset.field) flush();
  });

  // 标题与状态
  const titleEl = document.getElementById('comp-title');
  if (titleEl) {
    titleEl.addEventListener('change', async () => {
      try {
        await api('/api/compilations/' + comp.id, { method: 'PUT', body: { title: titleEl.value } });
        toast2('标题已更新');
      } catch (e) { toast2(e.message); }
    });
  }
  const statusEl = document.getElementById('comp-status');
  if (statusEl) {
    statusEl.addEventListener('change', async () => {
      try {
        await api('/api/compilations/' + comp.id, { method: 'PUT', body: { status: statusEl.value } });
        toast2('状态已更新');
      } catch (e) { toast2(e.message); }
    });
  }

  const search = document.getElementById('drawer-search');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      document.querySelectorAll('.drawer-card').forEach((c) => {
        const text = c.textContent.toLowerCase();
        c.hidden = q ? !text.includes(q) : false;
      });
    });
  }

  window.addEventListener('beforeunload', (e) => {
    if (dirty.size) { e.preventDefault(); e.returnValue = ''; }
  });
})();
