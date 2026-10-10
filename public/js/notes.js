(function () {
  const note = window.__NOTE__;

  const newBtn = document.getElementById('note-new');
  if (newBtn) {
    newBtn.addEventListener('click', async () => {
      const link = new URLSearchParams(location.search).get('link');
      const parts = link ? link.split(':') : [];
      newWriting('notes', '札记', { body: '', links: parts.length === 2 ? [{ type: parts[0], id: Number(parts[1]) }] : [] });
    });
  }

  if (!note) return;

  let links = note.links.slice();

  async function save() {
    const title = document.getElementById('note-title').value.trim();
    const body = document.getElementById('note-body').value;
    if (!title) return toast('标题必填');
    try {
      await api('/api/notes/' + note.id, { method: 'PUT', body: { title, body, links } });
      toast('已保存');
      location.reload();
    } catch (e) { toast(e.message); }
  }

  const saveBtn = document.getElementById('note-save');
  if (saveBtn) saveBtn.addEventListener('click', save);

  const delBtn = document.getElementById('note-del');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (!confirmBox('删除这篇札记？')) return;
      try {
        await api('/api/notes/' + note.id, { method: 'DELETE' });
        location.href = '/writing/notes';
      } catch (e) { toast(e.message); }
    });
  }

  const picker = document.getElementById('link-picker');
  if (picker) {
    picker.addEventListener('change', async () => {
      const v = picker.value;
      if (!v) return;
      const [type, id] = v.split(':');
      links.push({ type, id: Number(id) });
      picker.value = '';
      try {
        await api('/api/notes/' + note.id, { method: 'PUT', body: { links } });
        location.reload();
      } catch (e) { toast(e.message); }
    });
  }

  document.addEventListener('click', (e) => {
    const chip = e.target.closest ? e.target.closest('.link-chip') : null;
    if (chip) {
      const type = chip.dataset.type;
      const id = Number(chip.dataset.id);
      links = links.filter((l) => !(l.type === type && l.id === id));
      api('/api/notes/' + note.id, { method: 'PUT', body: { links } })
        .then(() => location.reload())
        .catch((err) => toast(err.message));
    }
  });
})();
