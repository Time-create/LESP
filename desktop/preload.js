const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktopBridge',{
 prepareAll:()=>ipcRenderer.invoke('prepare-all'),
 exportFile:request=>ipcRenderer.invoke('export-file',request),
 onPrepare:callback=>ipcRenderer.on('prepare-leave',(_event,token)=>callback(token)),
 replyLeave:(token,ok)=>ipcRenderer.send('leave-result',String(token),ok===true),
 onDiscard:callback=>ipcRenderer.on('discard-changes',()=>callback())
});
