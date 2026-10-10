const router=require('express').Router();
const writing=require('../services/writing');
const db=require('../db');
const route=fn=>(req,res,next)=>{try{res.json(fn(req));}catch(e){next(e);}};
router.get('/excerpt-picker',route(req=>{const tax=require('../services/taxonomy');const theme=req.query.theme?tax.descendants('theme',Number(req.query.theme)):null;let rows=db.dbAll('SELECT e.*,i.title FROM excerpts e JOIN items i ON i.id=e.item_id ORDER BY e.id DESC').map(tax.decorate);if(theme)rows=rows.filter(r=>r.themeIds.some(id=>theme.includes(id)));if(req.query.q)rows=rows.filter(r=>(r.text+' '+r.title).includes(req.query.q));const offset=Math.max(0,Number(req.query.offset)||0);return{rows:rows.slice(offset,offset+20),total:rows.length,next:offset+20<rows.length?offset+20:null};}));
router.get('/excerpt/:id/snapshot',route(req=>require('../services/citations').snapshot(req.params.id)));
router.post('/citation-changes',route(req=>require('../services/citations').changes(req.body.citations||[])));
router.get('/:kind/:id/document',route(req=>writing.get(req.params.kind,Number(req.params.id))));
router.put('/:kind/:id/document',route(req=>writing.save(req.params.kind,Number(req.params.id),req.body)));
router.put('/:kind/:id/draft',route(req=>{
  const doc=writing.get(req.params.kind,Number(req.params.id));const b=req.body;
  if(!b.clientId||!b.draft)writing.fail('草稿参数无效');
  db.dbRun('INSERT INTO writing_drafts VALUES (?,?,?,?,?) ON CONFLICT(document_id,client_id) DO UPDATE SET base_revision=excluded.base_revision,draft_json=excluded.draft_json,saved_at=excluded.saved_at',[doc.documentId,b.clientId,b.baseRevision,JSON.stringify(b.draft),db.now()]);return {ok:true};
}));
router.delete('/:kind/:id/draft/:clientId',route(req=>{const d=writing.get(req.params.kind,Number(req.params.id));db.dbRun('DELETE FROM writing_drafts WHERE document_id=? AND client_id=?',[d.documentId,req.params.clientId]);return{ok:true};}));
module.exports=router;
