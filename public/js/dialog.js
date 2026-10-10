(function () {
  window.openForm = function ({ title, fields = [], submitLabel = '保存', cancelLabel = '取消', onSubmit, onCancel }) {
    const dialog = document.createElement('dialog');
    dialog.className = 'wb-dialog';
    dialog.innerHTML = `<form><h2>${esc(title)}</h2><div class="dialog-fields">${fields.map(f => `<label>${esc(f.label)}${f.required ? ' *' : ''}${f.options ? `<select name="${esc(f.name)}" ${f.multiple?'multiple size="5"':''}>${f.options.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>` : f.multiline ? `<textarea name="${esc(f.name)}" rows="${f.rows || 5}"></textarea>` : `<input name="${esc(f.name)}" type="${esc(f.type || 'text')}">`}</label>`).join('')}</div><p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" data-cancel>${esc(cancelLabel)}</button><button class="primary" type="submit">${esc(submitLabel)}</button></div></form>`;
    for (const f of fields) { const input = dialog.querySelector(`[name="${f.name}"]`); if(f.multiple){for(const option of input.options)option.selected=(f.value||[]).map(String).includes(option.value);}else input.value = f.value || ''; input.required = !!f.required; }
    for (const f of fields.filter(f => f.options && (f.multiple || f.options.length > 8))) {
      const select=dialog.querySelector(`[name="${f.name}"]`),search=document.createElement('input');
      search.type='search';search.placeholder='搜索分类或关联对象';search.setAttribute('aria-label','筛选'+f.label.replace(/分类/g,'类别').replace(/资料/g,'来源').replace(/（.*?）/g,''));
      select.parentElement.before(search);
      search.addEventListener('input',()=>{const query=search.value.trim().toLowerCase();for(const option of select.options)option.hidden=!!query&&!option.textContent.toLowerCase().includes(query)&&!option.selected;});
    }
    dialog.addEventListener('input',()=>dialog.dataset.dirty='1');document.body.appendChild(dialog);
    let busy = false;
    const close = (cancelled) => { if (busy) return; if (cancelled && onCancel) { try { onCancel(); } catch (e) { /* 忽略 */ } } dialog.close(); dialog.remove(); };
    dialog.querySelector('[data-cancel]').onclick = () => close(true);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(true); });
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault(); if (busy) return;
      const values = Object.fromEntries(new FormData(event.currentTarget));
      for(const f of fields)if(f.multiple)values[f.name]=new FormData(event.currentTarget).getAll(f.name);
      const invalid = fields.find(f => f.required && !String(values[f.name]).trim());
      if (invalid) { dialog.querySelector('.form-error').textContent = invalid.label + '必填'; return; }
      busy = true; dialog.querySelector('[type=submit]').disabled = true;
      try { dialog.dataset.dirty='0';dialog._submission=Promise.resolve(onSubmit(values));await dialog._submission;busy = false;close(); }
      catch (error) { dialog.dataset.dirty='1';dialog.querySelector('.form-error').textContent = error.message; }
      finally { busy = false; if (dialog.isConnected) dialog.querySelector('[type=submit]').disabled = false; }
    };
    // showModal() 在某些环境下会抛错（例如弹窗已在显示、或宿主不支持模态）。
    // 原先没有兜底，一旦抛错就表现为「点了没反应」，且错误只落在控制台里。
    // 这里兜住并给出可见提示，同时退回非模态展示，保证功能不丢。
    try {
      dialog.showModal();
    } catch (err) {
      console.error('showModal 失败，退回普通弹层：', err);
      dialog.setAttribute('open', '');
      if (!dialog.isConnected) document.body.appendChild(dialog);
    }
    return dialog;
  };
  window.newWriting = function (kind, label, prefill = {}) {
    return openForm({ title: '新建' + label, fields: [{ name: 'title', label: label + '标题', required: true }], submitLabel: '创建', onSubmit: async values => {
      const created = await api('/api/' + kind, { method: 'POST', body: { ...prefill, title: values.title.trim() } });
      location.href = '/writing/' + kind + (kind === 'ideas' ? '?selected=' : '/') + created.id;
    } });
  };
})();
