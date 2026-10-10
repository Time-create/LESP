(function () {
  const newBtn = document.getElementById('idea-new');
  if (newBtn) {
    newBtn.addEventListener('click', async () => {
      newWriting('ideas', '灵感', { status: '念头' });
    });
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;

    if (act === 'status') {
      try {
        await api('/api/ideas/' + id, { method: 'PUT', body: { status: btn.dataset.status } });
        location.reload();
      } catch (err) { toast(err.message); }
    } else if (act === 'convert') {
      if (btn.disabled) return toast('仅「可开题」状态可创建长编');
      try {
        const r = await api('/api/ideas/' + id + '/convert', { method: 'POST', body: {} });
        toast('已创建长编，带入 ' + r.imported + ' 条史料');
        location.href = '/writing/compilations/' + r.compilation.id;
      } catch (err) { toast(err.message); }
    } else if (act === 'del') {
      if (!confirmBox('删除这个灵感？')) return;
      try {
        await api('/api/ideas/' + id, { method: 'DELETE' });
        location.reload();
      } catch (err) { toast(err.message); }
    }
  });
})();
