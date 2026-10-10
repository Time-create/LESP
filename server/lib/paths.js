const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..', '..');

let currentDataDir = path.join(ROOT, 'data');

function setDataDir(dir) {
  currentDataDir = path.resolve(dir);
}

function getDataDir() {
  return currentDataDir;
}

function filesDir() {
  return path.join(currentDataDir, 'files');
}

// 附件统一存放目录：所有上传/抓取的附件都放这里，不再散落在 item 目录或临时位置。
// 约定：attachments.rel_path 一律相对 getDataDir()，因此这里是 'files/attachments'。
function attachmentsDir() {
  return path.join(filesDir(), 'attachments');
}

function trashDir() {
  return path.join(currentDataDir, 'files', '_trash');
}

function backupsDir() {
  return path.join(currentDataDir, 'backups');
}

function ensureDirs() {
  const dirs = [currentDataDir, filesDir(), trashDir(), backupsDir()];
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function dbFile() {
  return path.join(currentDataDir, 'app.db');
}

// 校验解析后的路径必须位于指定根目录内，防止路径遍历
function withinDir(root, target) {
  const r = path.resolve(root);
  const t = path.resolve(target);
  return t === r || t.startsWith(r + path.sep);
}

module.exports = {
  ROOT,
  setDataDir,
  getDataDir,
  filesDir,
  attachmentsDir,
  trashDir,
  backupsDir,
  ensureDirs,
  dbFile,
  withinDir
};
