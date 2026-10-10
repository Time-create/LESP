(function () {
  const item = window.__ITEM__;
  if (!item) return;
  async function edit(excerpt = {}) {
    if(excerpt.id)excerpt=(await api('/api/excerpts?item_id='+item.id)).find(e=>e.id===excerpt.id);
    openForm({ title: excerpt.id ? '编辑录文' : '新增录文', fields: [
      { name: 'text', label: '录文正文', multiline: true, rows: 8, required: true, value: excerpt.text },
      { name: 'locator', label: '出处定位', value: excerpt.locator },
      { name: 'comment', label: '按语／笔记', multiline: true, value: excerpt.comment },
      { name:'juan',label:'卷次',value:excerpt.locatorData?.juan },{ name:'volume',label:'册次',value:excerpt.locatorData?.volume },{ name:'printedPage',label:'印刷页码',value:excerpt.locatorData?.printedPage },
      ...await taxonomyFields(item.id,excerpt)
    ], onSubmit: async values => {
      await api('/api/excerpts' + (excerpt.id ? '/' + excerpt.id : ''), { method: excerpt.id ? 'PUT' : 'POST', body: { ...values, locatorData:{juan:values.juan,volume:values.volume,printedPage:values.printedPage},baseRevision:excerpt.revision,item_id: item.id } });
      location.reload();
    } });
  }
  // 事件委托：event.target 在部分宿主下可能是文本节点（没有 closest），
  // 原先直接 event.target.closest(...) 会抛 TypeError，
  // 而整段在 async 函数里，抛错表现为「点了没反应」。
  // 这里统一兜到 Element 再取 closest，并在最外层 catch，把失败显示出来。
  // V5.3 清理：条目页的「新增录文」「新建录文分类」「管理主题分类」按钮已移除，
  // 对应分支（new / folders / themes）随之删除。
  // 保留 edit/delete —— 录文卡片上的「编辑录文」「删除录文」仍在用，
  // edit() 也同时服务这两个入口（编辑既有录文）。阅读器里的「转为录文」
  // 走 sources.js 的 convertAnnotation，与此处无关。
  document.addEventListener('click', async event => {
   try {
    const el = event.target instanceof Element ? event.target : (event.target && event.target.parentElement);
    const button = el && el.closest ? el.closest('[data-excerpt-action]') : null;
    if (!button) return;
    const action = button.dataset.excerptAction;
    const excerpt = (item.excerpts || []).find(e => e.id === Number(button.dataset.id));
    if (action === 'edit' && excerpt) edit(excerpt);
    if (action === 'delete' && excerpt) {
      openForm({ title: '删除录文（已有写作引用将保留原文与注释）', submitLabel: '确认删除', onSubmit: async () => {
        await api('/api/excerpts/' + excerpt.id, { method: 'DELETE' }); location.reload();
      } });
    }
   } catch (err) {
    console.error('录文按钮处理失败：', err);
    toast('操作失败：' + (err && err.message ? err.message : err));
   }
  });
  const filter=document.getElementById('excerpt-folder-filter');
  if(filter)api('/api/excerpt-folders?item_id='+item.id).then(rows=>{filter.innerHTML='<option value="">全部条目内分类</option><option value="none">未分类</option>'+taxonomyOptions(rows).map(o=>`<option value="${o.value}">${esc(o.label)}</option>`).join('');filter.onchange=async()=>{const qs=filter.value==='none'?'&unclassified=true':filter.value?'&folder_id='+filter.value:'';const matches=new Set((await api('/api/excerpts?item_id='+item.id+qs)).map(r=>r.id));document.querySelectorAll('[data-excerpt-card]').forEach(card=>card.hidden=!matches.has(Number(card.dataset.excerptCard)));};});
})();
