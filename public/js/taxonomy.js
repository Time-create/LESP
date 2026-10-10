(function(){
 function options(rows){const map=new Map(rows.map(r=>[r.id,r]));function label(r,seen=new Set()){if(seen.has(r.id))return r.name;seen.add(r.id);return r.parent_id&&map.has(r.parent_id)?label(map.get(r.parent_id),seen)+' / '+r.name:r.name;}return rows.map(r=>({value:r.id,label:label(r)})).sort((a,b)=>a.label.localeCompare(b.label,'zh'));}
 window.taxonomyOptions=options;
 const writingKind=location.pathname.match(/^\/writing\/(notes|ideas|compilations)\/?$/);
 if(writingKind)api('/api/themes').then(rows=>{const select=document.createElement('select');select.setAttribute('aria-label','按主题查看写作');select.innerHTML='<option value="">按主题查看</option>'+options(rows).map(o=>`<option value="${o.value}">${esc(o.label)}</option>`).join('');select.onchange=()=>{if(select.value)location.href='/themes?theme='+select.value+'&type='+({notes:'note',ideas:'idea',compilations:'compilation'})[writingKind[1]];};document.querySelector('.page-head')?.appendChild(select);});
 window.taxonomyFields=async function(itemId,excerpt={}){const [themes,folders]=await Promise.all([api('/api/themes'),itemId?api('/api/excerpt-folders?item_id='+itemId):Promise.resolve([])]);return [ ...(itemId?[{name:'folderIds',label:'条目内分类（可多选）',options:options(folders),multiple:true,value:excerpt.folderIds||[]}]:[]),{name:'themeIds',label:'主题分类（可多选）',options:options(themes),multiple:true,value:excerpt.themeIds||[]}];};
 window.manageTaxonomy=async function(scope,itemId){
  const endpoint=scope==='folder'?'/api/excerpt-folders':'/api/themes';
  const rows=await api(endpoint+(itemId?'?item_id='+itemId:''));
  const dlg=openForm({title:scope==='folder'?'管理条目内分类':'管理主题分类',fields:[{name:'selected',label:'选择已有分类（留空则新增）',options:[{value:'',label:'新增分类'},...options(rows)]},{name:'name',label:'分类名称',required:true},{name:'parent_id',label:'父分类',options:[{value:'',label:'顶层'},...options(rows)]}],onSubmit:async v=>{await api(endpoint+(v.selected?'/'+v.selected:''),{method:v.selected?'PATCH':'POST',body:{name:v.name,parent_id:v.parent_id?Number(v.parent_id):null,item_id:itemId}});location.reload();}});
  dlg.querySelector('[name=selected]').onchange=e=>{const r=rows.find(r=>r.id===Number(e.target.value));dlg.querySelector('[name=name]').value=r?.name||'';dlg.querySelector('[name=parent_id]').value=r?.parent_id||'';};
  const del=document.createElement('button');del.type='button';del.textContent='删除选中分类';dlg.querySelector('.dialog-actions').prepend(del);
  del.onclick=async()=>{const id=dlg.querySelector('[name=selected]').value;if(!id)return toast('请先选择分类');const impact=await api(endpoint+'/'+id+'/impact');openForm({title:`删除 ${impact.categories} 个分类、解除 ${impact.links} 个归类关系？原内容保留。`,submitLabel:'确认删除',onSubmit:async()=>{await api(endpoint+'/'+id+'?confirm=true',{method:'DELETE'});location.reload();}});};
 };
})();
