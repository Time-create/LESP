const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const { esc, jsonForScript } = require('../lib/render');
const paths = require('../lib/paths');
const { MODULES } = require('../config/modules');
const { fieldsOf, builtinFields } = require('../config/field-schema');

function human(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + units[i];
}

function dirSize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.name === '_trash') continue;
      if (e.isDirectory()) walk(p);
      else total += fs.statSync(p).size;
    }
  };
  walk(dir);
  return total;
}

function renderSettingsPage() {
  const dataDir = paths.getDataDir();
  const dbBytes = fs.existsSync(paths.dbFile()) ? fs.statSync(paths.dbFile()).size : 0;
  const fileBytes = dirSize(paths.filesDir());

  const last = db.dbGet("SELECT value FROM settings WHERE key = 'backup_last'");
  let lastInfo = null;
  if (last) {
    try { lastInfo = JSON.parse(last.value); } catch (e) { lastInfo = null; }
  }
  const autoRow = db.dbGet("SELECT value FROM settings WHERE key = 'auto_backup'");
  const autoOn = autoRow ? autoRow.value === '1' : true;
  const migration = require('../services/classification-migration').preview();

  const backups = fs.existsSync(paths.backupsDir())
    ? fs.readdirSync(paths.backupsDir()).filter((f) => f.startsWith('backup-') && f.endsWith('.zip')).sort().reverse()
    : [];

  const backupList = backups.length
    ? backups.map((f) => {
        const st = fs.statSync(path.join(paths.backupsDir(), f));
        return `<div class="set-row">
          <span>${esc(f)}</span>
          <span class="muted-3">${human(st.size)} · ${esc(new Date(st.mtime).toLocaleString('zh-CN'))}</span>
          <span class="set-ops">
            <button data-act="restore" data-file="${esc(f)}">恢复</button>
            <button data-act="delbackup" data-file="${esc(f)}">删除</button>
          </span></div>`;
      }).join('')
    : '<div class="muted-3">还没有备份</div>';

  const fieldSections = Object.keys(MODULES).map((m) => {
    const fields = fieldsOf(m);
    return `<div class="set-row">
      <span>${esc(MODULES[m].name)}</span>
      <span class="muted-3">${fields.map((f) => esc(f.label) + (f.custom ? '（自定义）' : '')).join(' · ')}</span>
    </div>`;
  }).join('');

  return `<div class="page-head">
    <div><h1 class="page-title">数据与设置</h1>
    <div class="page-sub">数据全部保存在本机，可随时备份与导出</div></div>
  </div>

  <div class="card">
    <div class="card-title">数据位置</div>
    <div class="set-row">
      <span>${esc(dataDir)}</span>
      <span class="muted-3">库 ${human(dbBytes)} · 附件 ${human(fileBytes)}</span>
    </div>
    <div class="set-row">
      <input id="new-dir" placeholder="新的数据目录绝对路径" style="flex:1">
      <button id="btn-move">更改目录</button>
    </div>
  </div>

  <div class="card">
    <div class="card-title">备份与恢复</div>
    <div class="set-row">
      <span>上次备份</span>
      <span class="muted-3">${lastInfo ? esc(lastInfo.at) + ' · ' + lastInfo.itemCount + ' 条 · ' + lastInfo.attachmentCount + ' 个附件 · ' + human(lastInfo.sizeBytes) : '尚未备份'}</span>
    </div>
    <div class="set-row">
      <span>自动备份</span>
      <span class="muted-3">每天 08:00，保留 7 份</span>
      <span class="set-ops"><button id="btn-auto">${autoOn ? '关闭' : '开启'}</button></span>
    </div>
    <div class="set-row">
      <button id="btn-backup" class="primary">立即备份</button>
    </div>
    <div style="margin-top:8px">${backupList}</div>
  </div>

  <div class="card">
    <div class="card-title">分类数据迁移</div>
    <div class="set-row">
      <span>录文分类全局化</span>
      <span class="muted-3" id="classify-state">${migration.migrated ? '已迁移' : '未迁移（录文分类当前按史料条目隔离）'}</span>
      <span class="set-ops"><button id="btn-classify-migrate"${migration.migrated ? ' disabled' : ''}>迁移分类数据</button></span>
    </div>
    <div class="set-row"><span class="muted-3">把录文分类升级为全局分类树（可跨史料归类，保留现有层级与归属），迁移前自动备份。</span></div>
  </div>

  <div class="card">
    <div class="card-title">导出</div>
    <div class="set-row">
      <span>文献题录</span>
      <span class="set-ops"><a href="/api/export/ris"><button>导出 RIS</button></a></span>
    </div>
    <div class="set-row">
      <span>全库条目</span>
      <span class="set-ops"><a href="/api/export/csv"><button>导出 CSV</button></a></span>
    </div>
    <div class="set-row">
      <span>长编 Markdown</span>
      <span class="muted-3">在长编编辑器中点击「导出 Markdown」</span>
    </div>
  </div>

  <div class="card">
    <div class="card-title">浏览器扩展同步</div>
    <div class="set-row">
      <span>本机端口</span>
      <span class="muted-3" id="sync-port">读取中…</span>
    </div>
    <div class="set-row">
      <span>同步口令</span>
      <span class="muted-3" id="sync-token">读取中…</span>
      <span class="set-ops"><button id="btn-new-token">生成新口令</button></span>
    </div>
    <div class="set-row"><button id="btn-sync-log" class="">查看同步日志</button></div>
    <pre id="sync-log" class="muted-3" style="white-space:pre-wrap;max-height:180px;overflow:auto;display:none"></pre>
    <div class="muted-3">把上面两项填进扩展面板的「连接辑微 App 的设置」，抓取的论文就会自动进入「研究论文」。</div>
  </div>

  <!-- 说明：这段逻辑放在 /static/js/settings.js 里，不写内联脚本。
       内联脚本在打包后的 App 里可能出现不执行/被缓存旧版本的情况（表现为一直“读取中…”），
       外部脚本文件由页面统一加载，稳定可靠。 -->

  <div class="card">
    <div class="card-title">模块字段</div>
    ${fieldSections}
    <div class="set-row">
      <select id="field-module">
        ${Object.keys(MODULES).map((m) => `<option value="${esc(m)}">${esc(MODULES[m].name)}</option>`).join('')}
      </select>
      <input id="field-key" placeholder="字段标识（英文，如 copy_location）">
      <input id="field-label" placeholder="字段名称（如 复本藏地）">
      <button id="btn-add-field" class="primary">添加字段</button>
    </div>
    <div class="muted-3">第一版自定义字段为文本类型。</div>
  </div>

  <script>
  window.__SETTINGS__ = ${jsonForScript({ dataDir })};
  </script>`;
}

module.exports = { renderSettingsPage };
