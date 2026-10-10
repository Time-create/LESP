(function(){
 class SaveController{
  constructor({read,save,draft,status}){this.read=read;this.saveRequest=save;this.saveDraft=draft;this.status=status;this.dirty=false;this.generation=0;this.revision=0;this.inflight=null;this.error=null;this.timer=null;this.maxTimer=null;this.composing=false;this.draftQueue=Promise.resolve();}
  changed(){this.dirty=true;this.generation++;this.error=null;this.status('有未保存修改');clearTimeout(this.timer);if(!this.composing)this.timer=setTimeout(()=>this.flush().catch(()=>{}),2000);if(!this.maxTimer)this.maxTimer=setTimeout(()=>{this.maxTimer=null;if(!this.composing)this.flush().catch(()=>{});},10000);if(this.saveDraft){const snapshot=this.read(),revision=this.revision;this.draftQueue=this.draftQueue.then(()=>this.saveDraft(snapshot,revision)).catch(()=>{});}}
  async flush(){if(this.inflight){await this.inflight;if(this.dirty)return this.flush();return; }if(!this.dirty)return;if(this.composing)throw new Error('请完成当前中文输入后再保存');
   clearTimeout(this.timer);clearTimeout(this.maxTimer);this.maxTimer=null;const generation=this.generation,payload=this.read();this.status('保存中…');
   this.inflight=this.draftQueue.then(()=>this.saveRequest(payload,this.revision)).then(result=>{this.revision=result.revision;this.error=null;if(this.generation===generation){this.dirty=false;this.status('已保存 '+new Date().toLocaleTimeString());}else this.status('有未保存修改');}).catch(async error=>{this.error=error;this.dirty=true;try{await this.saveDraft?.(this.read(),this.revision);}catch{}this.status('保存失败：'+error.message);throw error;}).finally(()=>{this.inflight=null;});
   await this.inflight;if(this.dirty)return this.flush();
  }
 }
 window.SaveController=SaveController;
 window.prepareToLeave=async function(){try{for(const d of document.querySelectorAll?.('dialog')||[])if(d._submission)await d._submission;}catch{return false;}if(document.querySelector?.('dialog[data-dirty="1"]'))return false;if(!window.writingSave)return true;try{await window.writingSave.flush();return !window.writingSave.dirty;}catch{return false;}};
 window.discardChanges=()=>{document.querySelectorAll?.('dialog').forEach(d=>{d.dataset.dirty='0';d.close();d.remove();});if(window.writingSave){window.writingSave.dirty=false;clearTimeout(window.writingSave.timer);clearTimeout(window.writingSave.maxTimer);}};
 document.addEventListener('click',async event=>{const link=event.target.closest('a[href]');if(!link||link.target==='_blank'||!window.writingSave?.dirty)return;const url=new URL(link.href,location.href);if(url.origin!==location.origin||url.hash&&url.pathname===location.pathname)return;event.preventDefault();if(await window.prepareToLeave())location.href=link.href;else toast('保存失败，已留在当前页面，请重试保存');},true);
 window.addEventListener('beforeunload',event=>{if(window.writingSave?.dirty||document.querySelector?.('dialog[data-dirty="1"]')){event.preventDefault();event.returnValue='';}});
 window.desktopBridge?.onPrepare(async token=>{const ok=await window.prepareToLeave();window.desktopBridge.replyLeave(token,ok);});
 window.desktopBridge?.onDiscard(()=>window.discardChanges());
})();
