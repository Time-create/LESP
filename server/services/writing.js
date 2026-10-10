const db=require('../db');
const {randomUUID}=require('node:crypto');
const {textDoc,validateDoc}=require('../../shared/document-schema');
const {references,markFor}=require('../../shared/citation-order');
const tables={note:'notes',idea:'ideas',compilation:'compilations',historyPaper:'history_papers'};
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function entity(kind,id){if(!tables[kind])fail('写作类型无效');const row=db.dbGet('SELECT * FROM '+tables[kind]+' WHERE id=?',[Number(id)]);if(!row)fail('写作不存在',404);return row;}
function inline(text){return text?[{type:'text',text:String(text)}]:[];}
function importLegacy(kind,id,force=false){
  const existing=db.dbGet('SELECT * FROM writing_documents WHERE kind=? AND entity_id=?',[kind,id]);
  if(existing&&!force)return existing;
  const row=entity(kind,id);const refs=[];let content;
  if(kind==='compilation'){
    const blocks=db.dbAll('SELECT * FROM compilation_blocks WHERE compilation_id=? ORDER BY seq,id',[id]);
    const oldRefs=db.dbAll('SELECT * FROM compilation_refs WHERE compilation_id=?',[id]);
    content={type:'doc',content:blocks.map(b=>{
      if(b.type==='quote'){
        const uuid='legacy-'+id+'-'+b.id;const ref=oldRefs.find(r=>r.block_id===b.id);
        const ex=b.excerpt_id?db.dbGet('SELECT * FROM excerpts WHERE id=?',[b.excerpt_id]):null;
        const item=ex?db.dbGet('SELECT * FROM items WHERE id=?',[ex.item_id]):null;
        refs.push({id:uuid,sourceKind:'excerpt',excerptId:b.excerpt_id,itemId:ref?.item_id||ex?.item_id||null,quote:b.quote_text,note:ref?.text||'',sourceRevision:ex?.revision||0,itemRevision:item?.source_revision||0,locator:ex?JSON.parse(ex.source_json||'{}'):{},orphaned:!!b.orphaned});
        return {type:'quote_block',attrs:{citationId:uuid},content:inline((b.lead||'')+b.quote_text+(b.tail||''))};
      }
      return {type:b.type==='heading'?'heading':b.type==='comment'?'analysis_block':'paragraph',...(b.type==='heading'?{attrs:{level:2}}:{}),content:inline(b.content)};
    })};
    if(!content.content.length)content=textDoc();
    db.dbRun('INSERT OR IGNORE INTO legacy_content VALUES (?,?,?)',[kind,id,JSON.stringify({row,blocks,refs:oldRefs})]);
  }else{
    // 史学论文与长编一样没有 legacy 正文列，统一以空文档起步
    const legacyText=kind==='note'?row.body:(kind==='idea'?row.summary:'');
    content=textDoc(legacyText);
    db.dbRun('INSERT OR IGNORE INTO legacy_content VALUES (?,?,?)',[kind,id,JSON.stringify(row)]);
  }
  const plain=validateDoc(content).textBetween(0,validateDoc(content).content.size,'\n');
  db.dbRun('INSERT INTO writing_documents(kind,entity_id,content_json,plain_text,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET content_json=excluded.content_json,plain_text=excluded.plain_text,revision=writing_documents.revision+1,updated_at=excluded.updated_at',[kind,id,JSON.stringify(content),plain,db.now()]);
  const doc=db.dbGet('SELECT * FROM writing_documents WHERE kind=? AND entity_id=?',[kind,id]);
  db.dbRun('UPDATE writing_citations SET active=0 WHERE document_id=?',[doc.id]);
  for(const ref of refs)db.dbRun('INSERT INTO writing_citations VALUES (?,?,?,1) ON CONFLICT(uuid) DO UPDATE SET payload_json=excluded.payload_json,active=1',[ref.id,doc.id,JSON.stringify(ref)]);
  return doc;
}
function migrateContent(){for(const [kind,table]of Object.entries(tables))for(const row of db.dbAll('SELECT id FROM '+table))importLegacy(kind,row.id);}
function get(kind,id){const row=entity(kind,id);if(kind==='note'||kind==='idea')row.links=db.dbAll('SELECT target_type AS type,target_id AS id FROM '+(kind==='note'?'note_links':'idea_links')+' WHERE '+kind+'_id=?',[Number(id)]);const doc=importLegacy(kind,Number(id));return {...row,epoch:require('./maintenance').epoch,documentId:doc.id,kind,revision:doc.revision,content:JSON.parse(doc.content_json),citations:db.dbAll('SELECT payload_json FROM writing_citations WHERE document_id=?',[doc.id]).map(r=>JSON.parse(r.payload_json)),themeIds:db.dbAll('SELECT theme_id FROM theme_links WHERE content_type=? AND content_id=?',[kind,Number(id)]).map(r=>r.theme_id),drafts:db.dbAll('SELECT * FROM writing_drafts WHERE document_id=?',[doc.id]).map(d=>({...d,draft:JSON.parse(d.draft_json)}))};}
function save(kind,id,payload){return db.dbTx(()=>{
  if(payload.epoch&&payload.epoch!==require('./maintenance').epoch)fail('数据目录已恢复或切换，请重新载入；草稿已保留',409);entity(kind,id);const current=importLegacy(kind,Number(id));
  if(!payload.clientMutationId)fail('缺少保存请求标识');
  const repeated=db.dbGet('SELECT result_json FROM writing_mutations WHERE document_id=? AND mutation_id=?',[current.id,payload.clientMutationId]);if(repeated)return JSON.parse(repeated.result_json);
  if(payload.baseRevision!==current.revision)fail('内容已在其他窗口更新，已保留你的草稿，请重新载入或另存',409);
  const content=payload.content;let model;try{model=validateDoc(content);}catch(e){fail('文档格式无效：'+e.message);}
  const ids=references(content);if(new Set(ids).size!==ids.length)fail('复制引用必须使用新的引用标识');
  const citations=payload.citations||[];const map=new Map(citations.map(c=>[c.id,c]));
  for(const cid of ids){const c=map.get(cid);if(!c||typeof c.quote!=='string'||typeof c.note!=='string')fail('引文或出处快照缺失');const owner=db.dbGet('SELECT document_id FROM writing_citations WHERE uuid=?',[cid]);if(owner&&owner.document_id!==current.id)fail('引用标识属于其他文章');}
  const resourceIds=[];model.descendants(n=>{if(n.type.name==='image'){if(!Number.isFinite(n.attrs.width)||n.attrs.width<30||n.attrs.width>1600)fail('图片尺寸无效');if(!db.dbGet('SELECT uuid FROM writing_resources WHERE uuid=?',[n.attrs.resourceId]))fail('图片资源不存在');resourceIds.push(n.attrs.resourceId);}});
  const title=String(payload.title??entity(kind,id).title).trim();if(!title)fail('标题必填');
  const plain=model.textBetween(0,model.content.size,'\n');
  db.dbRun('UPDATE writing_documents SET content_json=?,plain_text=?,revision=revision+1,legacy_mode=0,updated_at=? WHERE id=?',[JSON.stringify(content),plain,db.now(),current.id]);
  db.dbRun('UPDATE '+tables[kind]+' SET title=?,updated_at=? WHERE id=?',[title,db.now(),Number(id)]);
  if(kind==='note')db.dbRun('UPDATE notes SET body=? WHERE id=?',[plain,Number(id)]);
  if(kind==='idea'){
    if(payload.status!==undefined){if(!['念头','孵化中','可开题','已放弃'].includes(payload.status))fail('状态无效');db.dbRun('UPDATE ideas SET status=? WHERE id=?',[payload.status,Number(id)]);}
    db.dbRun('UPDATE ideas SET summary=?,next_step=COALESCE(?,next_step) WHERE id=?',[plain,payload.next_step??null,Number(id)]);
  }
  if(kind==='compilation'){
    if(payload.status!==undefined&&!['进行中','搁置','完成'].includes(payload.status))fail('状态无效');
    if(payload.footnote_style!==undefined&&!['footer','inline'].includes(payload.footnote_style))fail('注释格式无效');
    db.dbRun('UPDATE compilations SET status=COALESCE(?,status),footnote_style=COALESCE(?,footnote_style) WHERE id=?',[payload.status??null,payload.footnote_style??null,Number(id)]);
  }
  if(kind==='historyPaper'){
    if(payload.status!==undefined&&!['拟写','写作中','已完稿','已发表'].includes(payload.status))fail('状态无效');
    if(payload.footnote_style!==undefined&&!['footer','inline'].includes(payload.footnote_style))fail('注释格式无效');
    db.dbRun('UPDATE history_papers SET status=COALESCE(?,status),footnote_style=COALESCE(?,footnote_style) WHERE id=?',[payload.status??null,payload.footnote_style??null,Number(id)]);
  }
  db.dbRun('UPDATE writing_citations SET active=0 WHERE document_id=?',[current.id]);
  for(const cid of ids){const ref={...map.get(cid),id:cid};db.dbRun('INSERT INTO writing_citations VALUES (?,?,?,1) ON CONFLICT(uuid) DO UPDATE SET payload_json=excluded.payload_json,active=1',[cid,current.id,JSON.stringify(ref)]);}
  db.dbRun('DELETE FROM document_resource_links WHERE document_id=?',[current.id]);for(const rid of new Set(resourceIds))db.dbRun('INSERT INTO document_resource_links VALUES (?,?)',[current.id,rid]);
  if(payload.themeIds!==undefined)require('./taxonomy').setThemes(kind,Number(id),payload.themeIds);
  if(kind==='compilation')projectCompilation(Number(id),content,map);
  if(payload.clientId)db.dbRun('DELETE FROM writing_drafts WHERE document_id=? AND client_id=?',[current.id,payload.clientId]);
  for(const client of Array.isArray(payload.recoveredDraftIds)?payload.recoveredDraftIds:[])db.dbRun('DELETE FROM writing_drafts WHERE document_id=? AND client_id=?',[current.id,String(client)]);
  const result={ok:true,revision:current.revision+1,savedAt:db.now()};
  db.dbRun('INSERT INTO writing_mutations VALUES (?,?,?,?)',[current.id,payload.clientMutationId,JSON.stringify(result),db.now()]);
  db.dbRun('DELETE FROM writing_mutations WHERE document_id=? AND rowid NOT IN (SELECT rowid FROM writing_mutations WHERE document_id=? ORDER BY rowid DESC LIMIT 100)',[current.id,current.id]);
  return result;
});}
function projectCompilation(id,content,refs){
  db.dbRun('DELETE FROM compilation_refs WHERE compilation_id=?',[id]);db.dbRun('DELETE FROM compilation_blocks WHERE compilation_id=?',[id]);let n=0;
  for(const [seq,node]of content.content.entries()){
    const model=validateDoc({type:'doc',content:[node]});const text=model.textContent;const ref=refs.get(node.attrs?.citationId);
    const type=ref?'quote':node.type==='heading'?'heading':node.type==='analysis_block'?'comment':'text';
    const result=db.dbRun('INSERT INTO compilation_blocks(compilation_id,type,content,quote_text,excerpt_id,seq,orphaned) VALUES (?,?,?,?,?,?,?)',[id,type,ref?'':text,ref?text:'',ref?.excerptId||null,seq,ref?.orphaned?1:0]);
    if(ref){n++;db.dbRun('INSERT INTO compilation_refs(compilation_id,block_id,mark,item_id,excerpt_id,text,orphaned,seq) VALUES (?,?,?,?,?,?,?,?)',[id,result.lastInsertRowid,markFor(n),ref.itemId||0,ref.excerptId||null,ref.note,ref.orphaned?1:0,n]);}
  }
}
function legacyMiddleware(req,res,next){
  const match=req.path.match(/^\/api\/(notes|ideas|compilations)(?:\/(\d+))?(.*)$/);if(!match||!['POST','PUT','DELETE'].includes(req.method))return next();
  const kind={notes:'note',ideas:'idea',compilations:'compilation'}[match[1]],id=Number(match[2]);
  const doc=id?db.dbGet('SELECT * FROM writing_documents WHERE kind=? AND entity_id=?',[kind,id]):null;
  const bodyChange=req.body?.body!==undefined||req.body?.summary!==undefined||/blocks|import/.test(match[3]);
  if(doc&&!doc.legacy_mode&&bodyChange)return res.status(409).json({error:'该文章使用新版富文本，请通过文档编辑器保存'});
  const original=res.json.bind(res);
  res.json=value=>{
    if(res.statusCode<400&&(req.method!=='DELETE'||/blocks/.test(match[3]))){
      const target=id||value.id;
      if(target&&(!doc||doc.legacy_mode))db.dbTx(()=>importLegacy(kind,target,true));
    }
    return original(value);
  };next();
}
module.exports={get,save,importLegacy,migrateContent,entity,fail,tables,legacyMiddleware};
