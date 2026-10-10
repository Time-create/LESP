const router=require('express').Router();const multer=require('multer');const fs=require('node:fs');const path=require('node:path');const {randomUUID,createHash}=require('node:crypto');const db=require('../db');const paths=require('../lib/paths');
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}});
router.post('/images',(req,res,next)=>upload.single('file')(req,res,error=>{
 try{if(error)throw Object.assign(error,{status:413});if(!req.file)throw Object.assign(new Error('请选择图片'),{status:400});
 const {imageSize}=require('image-size');const info=imageSize(req.file.buffer);if(!['png','jpg','webp'].includes(info.type)||info.width*info.height>50000000)throw new Error('仅支持合理尺寸的 PNG、JPEG 或 WebP 图片');
 const id=randomUUID(),relative='files/_writing/'+id+'.'+info.type,absolute=path.join(paths.getDataDir(),relative);fs.mkdirSync(path.dirname(absolute),{recursive:true});fs.writeFileSync(absolute,req.file.buffer);
 try{db.dbRun('INSERT INTO writing_resources VALUES (?,?,?,?,?,?,?,?)',[id,relative,info.type==='jpg'?'image/jpeg':'image/'+info.type,req.file.size,info.width,info.height,createHash('sha256').update(req.file.buffer).digest('hex'),db.now()]);}catch(e){fs.unlinkSync(absolute);throw e;}
 res.json({id,width:info.width,height:info.height,url:'/api/resources/'+id+'/file'});
 }catch(e){e.status=e.status||400;next(e);}
}));
router.get('/:id/file',(req,res)=>{const row=db.dbGet('SELECT * FROM writing_resources WHERE uuid=?',[req.params.id]);if(!row)return res.status(404).json({error:'图片不存在'});const file=path.resolve(paths.getDataDir(),row.rel_path);if(!paths.withinDir(paths.getDataDir(),file)||!fs.existsSync(file))return res.status(404).json({error:'图片文件缺失'});res.type(row.mime).sendFile(file);});
module.exports=router;
