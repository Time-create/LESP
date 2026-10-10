@echo off
rem Start LESP-Jiwei (historical source workbench).
rem V5.1: sidebar removed; all sections live in the topbar.
rem Sync source into the packaged app before launching, otherwise code
rem changes will NOT show up (packaged exe is what actually runs).
rem NOTE: keep this file pure ASCII - non-ASCII breaks under a CJK path.
setlocal
cd /d "%~dp0"

rem ---- 1) sync source into dist (failure must not block startup) ----
if exist "scripts\sync-into-dist.js" (
  node "scripts\sync-into-dist.js" >nul 2>&1
  if errorlevel 1 echo [start.bat] code sync failed; starting with existing build.
)

rem ---- 2) prefer packaged build; fall back to source runtime ----
if exist "dist\workbench\ShiliaoWorkbench.exe" (
  start "" "dist\workbench\ShiliaoWorkbench.exe"
  exit /b
)

rem ELECTRON_RUN_AS_NODE must be cleared or electron.exe degrades to plain node
if exist "node_modules\electron\dist\electron.exe" (
  set ELECTRON_RUN_AS_NODE=
  start "" "node_modules\electron\dist\electron.exe" "."
  exit /b
)

echo Desktop runtime not found. Run npm install and npm run build:desktop.
pause
