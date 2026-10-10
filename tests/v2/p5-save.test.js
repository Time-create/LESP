const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('P5 saves serialize revisions, edits arriving in flight remain pending; failures retain dirty',async()=>{
 const window={addEventListener(){}};vm.runInNewContext(fs.readFileSync('public/js/save-controller.js','utf8'),{window,document:{addEventListener(){}},setTimeout,clearTimeout,Date});
 let value='旧',release,calls=[];const c=new window.SaveController({read:()=>value,status(){},save:async(p,r)=>{calls.push([p,r]);if(calls.length===1)await new Promise(resolve=>release=resolve);return{revision:r+1};}});
 c.changed();const first=c.flush();await Promise.resolve();value='新';c.changed();const second=c.flush();release();await Promise.all([first,second]);assert.deepEqual(calls,[['旧',0],['新',1]]);assert.equal(c.dirty,false);
 c.saveRequest=async()=>{throw new Error('500');};c.changed();await assert.rejects(c.flush(),/500/);assert.equal(c.dirty,true);assert.equal(c.revision,2);
 c.saveRequest=async()=>({revision:3});await c.flush();assert.equal(c.dirty,false);
});

