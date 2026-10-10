Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("WScript.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root

' V5.1：与 start.bat 保持一致 —— 启动前先同步源码到打包目录，
' 否则改了源码窗口里仍是旧代码（栏目已全在顶栏，导航不再依赖侧栏）。
syncScript = fso.BuildPath(root, "scripts\sync-into-dist.js")
If fso.FileExists(syncScript) Then
  ' 0 = 隐藏窗口，False = 不同步等待；失败静默忽略，不阻塞启动
  shell.Run "node " & Chr(34) & syncScript & Chr(34), 0, True
End If

exe = fso.BuildPath(root, "dist\workbench\ShiliaoWorkbench.exe")
If fso.FileExists(exe) Then
  shell.Run Chr(34) & exe & Chr(34), 1, False
Else
  MsgBox "Desktop runtime not found. Please run start.bat.", 48, "Shiliao Workbench"
End If
