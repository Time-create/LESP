const router=require('express').Router();
router.post('/model',(req,res,next)=>{try{res.json(require('../services/writing-export').collect(req.body.kind,Number(req.body.id),req.body.revision));}catch(e){next(e);}});
router.get('/annotated/:id',async(req,res,next)=>{try{const service=require('../services/annotations'),file=await service.file(req.params.id);const bytes=await require('../services/export-annotations').annotatedCopy(file.bytes,service.list(req.params.id));res.type('application/pdf').send(bytes);}catch(e){next(e);}});
module.exports=router;
