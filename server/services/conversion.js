const db=require('../db');const writing=require('./writing');const {randomUUID}=require('node:crypto');
function convert(id){return db.dbTx(()=>{
 const idea=writing.get('idea',id);const previous=db.dbGet('SELECT compilation_id FROM idea_conversions WHERE idea_id=?',[id]);if(previous)return{compilation:require('../routes/compilations').load(previous.compilation_id),imported:0,repeated:true};
 if(idea.status!=='可开题')writing.fail('仅「可开题」状态的灵感可以创建长编');
 const time=db.now();const cid=Number(db.dbRun('INSERT INTO compilations(title,project,status,footnote_style,idea_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',[idea.title,'','进行中','footer',id,time,time]).lastInsertRowid);
 const content=JSON.parse(JSON.stringify(idea.content)),citations=[],mapping=new Map(),included=new Set();
 for(const c of idea.citations){const next={...c,id:randomUUID()};mapping.set(c.id,next.id);citations.push(next);if(c.excerptId)included.add(c.excerptId);}
 function visit(n){if(n.attrs?.citationId)n.attrs.citationId=mapping.get(n.attrs.citationId);for(const child of n.content||[])visit(child);}visit(content);
 let imported=0;for(const link of idea.links.filter(l=>l.type==='item'))for(const ex of db.dbAll('SELECT id FROM excerpts WHERE item_id=? ORDER BY seq,id',[link.id])){if(included.has(ex.id))continue;const c=require('./citations').snapshot(ex.id);citations.push(c);content.content.push({type:'quote_block',attrs:{citationId:c.id},content:[{type:'text',text:c.quote}]});included.add(ex.id);imported++;}
 const target=writing.get('compilation',cid);writing.save('compilation',cid,{title:idea.title,content,citations,themeIds:idea.themeIds,baseRevision:target.revision,clientMutationId:randomUUID()});
 db.dbRun('INSERT INTO idea_conversions VALUES (?,?,?)',[id,cid,time]);return{compilation:require('../routes/compilations').load(cid),imported};
});}
module.exports={convert};
