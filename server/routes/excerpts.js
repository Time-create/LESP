const router=require('express').Router();const db=require('../db');const taxonomy=require('../services/taxonomy');
const route=fn=>(req,res,next)=>{try{res.json(fn(req));}catch(e){next(e);}};
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
router.get('/',route(req=>{
 const q=req.query;let rows=q.item_id?db.dbAll('SELECT * FROM excerpts WHERE item_id=? ORDER BY seq,id',[Number(q.item_id)]):db.dbAll('SELECT * FROM excerpts ORDER BY id DESC');
 rows=rows.map(taxonomy.decorate);
 if(q.folder_id){const ids=q.descendants==='false'?[Number(q.folder_id)]:taxonomy.descendants('folder',Number(q.folder_id));rows=rows.filter(r=>r.folderIds.some(id=>ids.includes(id)));}
 if(q.theme_id){const ids=taxonomy.descendants('theme',Number(q.theme_id));rows=rows.filter(r=>r.themeIds.some(id=>ids.includes(id)));}
 if(q.unclassified==='true')rows=rows.filter(r=>!r.folderIds.length);
 if(q.q)rows=rows.filter(r=>(r.text+' '+r.locator+' '+r.comment).includes(q.q));
 return rows;
}));
function write(id,b){return db.dbTx(()=>{
 const old=id?db.dbGet('SELECT * FROM excerpts WHERE id=?',[id]):null;if(id&&!old)fail('录文不存在',404);
 const itemId=old?.item_id||Number(b.item_id);if(!db.dbGet('SELECT id FROM items WHERE id=?',[itemId]))fail('条目不存在',404);
 const text=b.text===undefined?old?.text:String(b.text);if(!text||!text.trim())fail('录文正文必填');
 if(old&&b.baseRevision!==undefined&&b.baseRevision!==old.revision)fail('录文已更新，请重新载入',409);
 const locator=b.locator??old?.locator??'',comment=b.comment??old?.comment??'';
 const loc=JSON.stringify(b.locatorData??JSON.parse(old?.locator_json||'{}')),source=JSON.stringify(b.source??JSON.parse(old?.source_json||'{}'));
 if(old)db.dbRun('UPDATE excerpts SET text=?,locator=?,comment=?,seq=?,locator_json=?,source_json=? WHERE id=?',[text,locator,comment,b.seq??old.seq,loc,source,id]);
 else{id=Number(db.dbRun('INSERT INTO excerpts(item_id,text,locator,comment,seq,created_at,updated_at,locator_json,source_json) VALUES (?,?,?,?,?,?,?,?,?)',[itemId,text,locator,comment,db.dbGet('SELECT COALESCE(MAX(seq),-1)+1 n FROM excerpts WHERE item_id=?',[itemId]).n,db.now(),db.now(),loc,source]).lastInsertRowid);}
 if(b.themeIds!==undefined)taxonomy.setThemes('excerpt',id,b.themeIds);if(b.folderIds!==undefined)taxonomy.assignFolders(id,b.folderIds,'set');
 db.syncFts(itemId);db.dbRun('UPDATE items SET updated_at=? WHERE id=?',[db.now(),itemId]);return taxonomy.decorate(db.dbGet('SELECT * FROM excerpts WHERE id=?',[id]));
});}
router.post('/',route(req=>write(null,req.body||{})));
router.put('/:id',route(req=>write(Number(req.params.id),req.body||{})));
router.delete('/:id',route(req=>db.dbTx(()=>{const id=Number(req.params.id),row=db.dbGet('SELECT * FROM excerpts WHERE id=?',[id]);if(!row)fail('录文不存在',404);db.dbRun('DELETE FROM excerpts WHERE id=?',[id]);db.dbRun('UPDATE compilation_blocks SET orphaned=1 WHERE excerpt_id=?',[id]);db.dbRun('UPDATE compilation_refs SET orphaned=1 WHERE excerpt_id=?',[id]);db.syncFts(row.item_id);return{ok:true};})));
module.exports=router;module.exports.write=write;
