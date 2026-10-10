const {ipcMain,dialog}=require('electron');
const {randomUUID}=require('node:crypto');
const pending=new Map();
ipcMain.on('leave-result',(event,token,ok)=>{const request=pending.get(token);if(request&&event.sender===request.contents)request.finish(ok===true);});
async function prepare(win){
 if(win.isDestroyed()||win.webContents.isDestroyed())return true;
 const token=randomUUID();const ok=await new Promise(resolve=>{
  const timer=setTimeout(()=>finish(false),15000);
  function finish(value){clearTimeout(timer);pending.delete(token);resolve(value);}
  pending.set(token,{contents:win.webContents,finish});win.webContents.send('prepare-leave',token);
 });
 if(ok)return true;
 const result=await dialog.showMessageBox(win,{type:'warning',buttons:['继续编辑','放弃未保存修改并离开'],defaultId:0,cancelId:0,message:'内容尚未保存成功。继续编辑可重试保存；离开后可从本地草稿尝试恢复。'});
 if(result.response!==1)return false;
 await win.webContents.executeJavaScript('window.discardChanges?.()');return true;
}
module.exports={prepare};
