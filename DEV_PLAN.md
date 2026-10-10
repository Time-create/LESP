# 开发计划：史料文献工作台（个人本地版）

配套文档：`PRD.md` V1.0（REQ-2026-09-001）
制定日期：2026-09-26
执行方式：按 Phase 顺序推进，每个 Phase 结束时必须通过「完成判据」才可进入下一 Phase

---

## 0. 环境事实（已核验）

| 项 | 值 |
|----|----|
| Node | `C:\Users\<用户名>\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`，v22.22.2 |
| npm | 同目录 `npm.cmd` |
| 端口 | 8787 空闲，8788 空闲 |
| 工作区 | `C:\Users\<用户名>\Desktop\APP开发\`，当前仅有 `PRD.md` |

**Windows 编码约束**：工作区路径含中文「APP开发」。所有 `.bat` 文件内容必须保持纯 ASCII（用 `%~dp0` 定位自身目录，node 路径全英文），禁止在 bat 中写中文，避免 GBK 乱码。JS/HTML 内部一律 UTF-8。

---

## 1. 技术选型

| 层 | 选型 | 理由 |
|----|------|------|
| 运行时 | Node.js 22.22.2（托管版） | 已装，LTS |
| HTTP | express@4 | 路由与静态资源成熟稳定 |
| 数据库 | **better-sqlite3**（首选） | 同步 API，事务简单，支持 FTS5 |
| 数据库回退 1 | `node:sqlite`（内置，需 `--experimental-sqlite` 启动标志） | 免编译，better-sqlite3 装不上时使用 |
| 数据库回退 2 | sql.js（wasm）+ 手动存盘 | 最后兜底 |
| 上传 | multer | 事实标准 |
| 打包 | archiver（备份 zip） | 流式，适合大附件 |
| 解压 | adm-zip（恢复） | 纯 JS 无外部依赖 |
| 前端 | 服务端渲染 HTML + 原生 JS fetch | 不引入框架，降低长期维护成本 |
| PDF 阅读 | 浏览器内置 PDF 插件（`<iframe src="/api/attachments/{id}/file">`） | 不引入 pdf.js |

**关键架构约束**：数据库访问必须收敛在 `server/db.js` 的四个方法（`dbAll` / `dbGet` / `dbRun` / `dbTx`）之内。任何 route 文件不得直接引用 sqlite 驱动，以便引擎回退时只改一个文件。

---

## 2. 目录结构

```
C:\Users\<用户名>\Desktop\APP开发\
├── PRD.md
├── DEV_PLAN.md
├── package.json
├── start.bat                       纯 ASCII 启动脚本
├── server\
│   ├── index.js                    入口：express、端口顺延、路由挂载、自动开浏览器
│   ├── db.js                       数据库封装（dbAll/dbGet/dbRun/dbTx）+ 迁移入口
│   ├── schema.sql                  全部建表 DDL + FTS5 触发器
│   ├── config\
│   │   ├── modules.js              六类模块的中文名、图标文字、脚注模板
│   │   └── field-schema.js         各模块字段定义（单一数据源）
│   ├── lib\
│   │   ├── footnote.js             脚注生成与重排
│   │   ├── paths.js                数据目录、附件目录、备份目录解析
│   │   └── render.js               HTML 片段渲染工具（转义等）
│   ├── routes\
│   │   ├── pages.js                所有页面路由（SSR）
│   │   ├── items.js collections.js tags.js
│   │   ├── excerpts.js attachments.js
│   │   ├── compilations.js notes.js ideas.js
│   │   ├── search.js cnki.js backup.js settings.js
│   └── views\
│       ├── layout.js               全局布局（侧栏导航 + 顶栏）
│       ├── page-home.js page-item.js
│       ├── page-compilation.js page-notes.js page-ideas.js
│       └── page-settings.js
├── public\
│   ├── css\app.css                 纸墨配色变量与全部样式
│   └── js\
│       ├── common.js               fetch 封装、Toast、弹窗确认
│       ├── item.js                 条目与摘录交互
│       ├── upload.js               附件上传
│       ├── compilation.js          长编编辑器（核心）
│       ├── notes.js ideas.js cnki.js settings.js
└── data\                           运行时生成，可在设置中更改
    ├── app.db  app.db-wal  app.db-shm
    ├── files\{item_id}\            附件
    ├── files\_trash\               删除的附件（保留 30 天）
    └── backups\backup-YYYY-MM-DD-HHmm.zip
```

---

## 3. 数据库 DDL（`server/schema.sql`）

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,               -- classics/inscription/document/archive/paper/book
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  status TEXT DEFAULT '未整理',
  fields TEXT DEFAULT '{}',           -- 模块特有字段 JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_module ON items(module, updated_at DESC);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id INTEGER DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS collection_items (
  collection_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  PRIMARY KEY (collection_id, item_id)
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS item_tags (
  item_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS excerpts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  locator TEXT DEFAULT '',            -- 出处定位：卷次/页码/档号
  text TEXT NOT NULL,
  comment TEXT DEFAULT '',
  seq INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_excerpts_item ON excerpts(item_id, seq);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS compilations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  project TEXT DEFAULT '',
  status TEXT DEFAULT '进行中',
  footnote_style TEXT DEFAULT 'footer',  -- footer 页下注 / inline 夹注
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS compilation_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compilation_id INTEGER NOT NULL,
  type TEXT NOT NULL,                 -- heading/text/quote/comment
  content TEXT DEFAULT '',
  lead TEXT DEFAULT '',               -- quote 块的引导语
  tail TEXT DEFAULT '',               -- quote 块的后缀说明
  excerpt_id INTEGER DEFAULT NULL,
  seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocks ON compilation_blocks(compilation_id, seq);

CREATE TABLE IF NOT EXISTS compilation_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compilation_id INTEGER NOT NULL,
  block_id INTEGER NOT NULL,
  mark TEXT NOT NULL,                 -- ①②③
  item_id INTEGER NOT NULL,
  excerpt_id INTEGER DEFAULT NULL,
  text TEXT NOT NULL,
  orphaned INTEGER DEFAULT 0,         -- 原条目被删除时置 1，前端标灰
  seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS note_links (
  note_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,          -- item / compilation
  target_id INTEGER NOT NULL,
  PRIMARY KEY (note_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  status TEXT DEFAULT '念头',          -- 念头/孵化中/可开题/已放弃
  next_step TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idea_links (
  idea_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,          -- item / note / compilation
  target_id INTEGER NOT NULL,
  PRIMARY KEY (idea_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  title, subtitle, fields, excerpt_text, content=''
);
```

FTS 同步策略：条目或摘录写入后，在同一个事务内删除该 item 对应 rowid 再插入一条聚合文本（标题 + 副标题 + 字段值拼接 + 全部摘录正文与按语）。检索用 `SELECT item_id FROM items_fts WHERE items_fts MATCH ?`。

---

## 4. 字段配置（`server/config/field-schema.js`）

单一数据源，驱动列表列、详情字段、新建/编辑表单、CSV 导出与检索。新增字段只改此文件。

```js
module.exports = {
  classics: [
    { key: 'author',    label: '作者／编者', type: 'text', required: false, list: true },
    { key: 'dynasty',   label: '朝代',      type: 'text', required: false, list: true },
    { key: 'edition',   label: '版本',      type: 'text', required: false, list: true },
    { key: 'juan',      label: '卷次',      type: 'text', required: false, list: false },
    { key: 'volumes',   label: '册数',      type: 'number', required: false, list: false },
    { key: 'series',    label: '丛书',      type: 'text', required: false, list: false },
    { key: 'location',  label: '藏地／索书号', type: 'text', required: false, list: false }
  ],
  inscription: [ /* 碑名(标题)之外：立碑年代、公元纪年、撰者、书者、刻工、出土地、现藏地、材质形制 */ ],
  document:    [ /* 文书类型(枚举)、年代、当事人、地点、批次、收藏单位、档号、尺寸材质 */ ],
  archive:     [ /* 全宗号、目录号、卷号、件号、形成年代、责任者、藏地、开放状态(枚举)、缩微号 */ ],
  paper:       [ /* 作者、期刊、年卷期、页码、DOI、关键词、摘要(textarea)、来源(只读) */ ],
  book:        [ /* 作者、出版社、出版年、丛书、ISBN、版次、阅读进度 */ ]
};
```

`document.type` 枚举：契约／账册／诉状／族谱／鱼鳞图册／书信／其他。
`archive.open_status` 枚举：开放／限制／未开放。

---

## 5. 阶段划分

### Phase 0 — 环境与依赖

| 任务 | 命令／产出 |
|------|-----------|
| 0.1 初始化 package.json | `cd "C:/Users/<用户名>/Desktop/APP开发"` 后 `npm.cmd init -y` |
| 0.2 装依赖 | `npm.cmd i express@4 better-sqlite3 multer archiver adm-zip` |
| 0.3 验证 sqlite 驱动 | 写临时脚本 `node -e "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('create table t(a)');console.log('ok')"` |
| 0.4 若 0.3 失败 | 卸载 better-sqlite3，改用 `node:sqlite`，启动加 `--experimental-sqlite`；仍失败则用 sql.js。三种引擎统一由 `db.js` 封装 |

**完成判据**：`better-sqlite3`（或回退引擎）能在 Node 22.22.2 下建表并写入读取成功。

### Phase 1 — 服务骨架与全局布局

| 任务 | 文件 |
|------|------|
| 1.1 express 入口、端口 8787 占用顺延至 8788、静态目录、启动后自动打开浏览器 | `server/index.js` |
| 1.2 数据库封装四方法 + 首次启动执行 schema.sql | `server/db.js`、`server/schema.sql` |
| 1.3 全局布局：146px 侧栏导航（11 项，分三组）、纸墨配色 CSS 变量 | `server/views/layout.js`、`public/css/app.css` |
| 1.4 首页占位页、其余 10 个路由占位页（返回模块名即可） | `server/routes/pages.js` |
| 1.5 启动脚本（纯 ASCII），node 路径英文，自动开浏览器 | `start.bat` |

**完成判据**：双击 `start.bat` 后浏览器自动打开 `http://localhost:8787`，11 个导航项可点击切换且样式正确；关闭再启动无报错。

### Phase 2 — 数据层

| 任务 | 文件 |
|------|------|
| 2.1 全部 15 张表 DDL + WAL + FTS5 虚表 | `server/schema.sql` |
| 2.2 迁移执行与幂等（重复启动不重建、不报错） | `server/db.js` |
| 2.3 模块元信息（中文名、路由、脚注模板） | `server/config/modules.js` |
| 2.4 字段 schema 六套 | `server/config/field-schema.js` |
| 2.5 种子数据脚本：每个模块各 3 条示例条目 + 2 段摘录（用于后续 UI 调试） | `server/seed.js` |

**完成判据**：删掉 `data\app.db` 后重启服务，15 张表自动建立；执行 seed 后 `sqlite` 查询能取到 18 条条目。

### Phase 3 — 统一 CRUD + 分类 + 标签 + 检索

| 任务 | 文件 |
|------|------|
| 3.1 条目 CRUD API（含 `?module=` 过滤、分页 50） | `server/routes/items.js` |
| 3.2 分类树 CRUD、条目加入/移出分类（多对多） | `server/routes/collections.js` |
| 3.3 标签增删与筛选 | `server/routes/tags.js` |
| 3.4 FTS5 同步与全局检索接口 | `server/routes/search.js` |
| 3.5 前端 fetch 封装、Toast、二次确认弹窗 | `public/js/common.js` |

**完成判据**：用 curl 建一条条目 → 加入两个分类 → 两个分类下都能查到；检索录文关键词能命中（对应验收 4、5）。

### Phase 4 — 六类资料模块 UI

| 任务 | 文件 |
|------|------|
| 4.1 三栏页面：分类树 128px / 条目列表 172px / 详情区 | `server/views/page-item.js` |
| 4.2 详情区：字段表（由 field-schema 渲染）+ Tab（录文／附件／笔记／关联长编） | 同上 |
| 4.3 新建／编辑抽屉表单（字段由 schema 生成，必填校验） | `public/js/item.js` |
| 4.4 六个模块共用同一页面组件，由 `modules.js` 区分文案与字段 | `server/routes/pages.js` |

**完成判据**：古籍模块新建一条含版本、卷次的条目，刷新后字段完整（对应验收 1）；碑刻/文书/档案模块显示各自字段而非古籍字段。

### Phase 5 — 摘录与附件

| 任务 | 文件 |
|------|------|
| 5.1 录文 CRUD（出处定位、原文、按语、排序） | `server/routes/excerpts.js` |
| 5.2 附件上传：multer、200MB 上限、扩展名白名单、按 item_id 分目录、写入后重建该条目 FTS | `server/routes/attachments.js`、`public/js/upload.js` |
| 5.3 附件读取接口与内置阅读器页（PDF 用 iframe、图片用 img、TIFF 降级为下载链接） | `server/routes/attachments.js`、`/reader/{id}` 页面 |
| 5.4 删除条目时附件移入 `files\_trash\` | `server/routes/items.js` |

**完成判据**：上传 5MB PDF 后点击「在内置阅读器中打开」，页面内直接渲染（对应验收 12）；上传 .exe 被拒绝并提示（对应验收 13）。

### Phase 6 — 史料长编编辑器（核心，优先级最高）

| 任务 | 文件 |
|------|------|
| 6.1 长编列表页与新建 | `server/routes/compilations.js` |
| 6.2 编辑器页面：左侧史料抽屉（按模块分组、搜索、列出摘录卡）+ 右侧正文区 | `server/views/page-compilation.js` |
| 6.3 插入摘录 → 生成 quote 块 + 调用脚注模板生成 ref | `server/lib/footnote.js` |
| 6.4 脚注编号重排（删除/移动块后重算 ①②③，orphaned 置灰） | 同上 |
| 6.5 小标题块、正文块、按语块的新增与编辑；块上移/下移 | `public/js/compilation.js` |
| 6.6 脚注格式切换（页下注 ⇄ 夹注）即时重排 | `server/lib/footnote.js` |
| 6.7 自动保存：30 秒定时 + 页头显示「已保存 HH:MM」 | `public/js/compilation.js` |
| 6.8 导出 Markdown（含脚注） | `server/routes/compilations.js` |

**完成判据**：插入摘录后正文出现原文与朱砂圈标、页底注释符合古籍模板（验收 6）；删除首个引用块后剩余脚注重排（验收 7）；切夹注后页底清空且出处内联（验收 8）；导出 md 含正文与脚注（验收 9）；等待 30 秒后页头显示保存时间（验收 3）。

### Phase 7 — 札记、灵感、首页

| 任务 | 文件 |
|------|------|
| 7.1 札记 CRUD、关联对象（著作/论文/条目/长编）、按来源筛选、从摘录「就此写札记」、转为灵感 | `server/routes/notes.js`、`public/js/notes.js` |
| 7.2 灵感 CRUD、四态流转、关联史料、「可开题」一键建长编并带入条目 | `server/routes/ideas.js`、`public/js/ideas.js` |
| 7.3 首页：4 张统计卡 + 继续长编 + 最新札记 + 灵感池 + 最近入库 | `server/views/page-home.js` |

**完成判据**：札记关联某著作后，该著作笔记 Tab 可见（验收 10）；灵感改为「可开题」后按钮由禁用变可点（验收 11）。

### Phase 8 — 知网抓取

| 任务 | 文件 |
|------|------|
| 8.1 设置页保存登录态 Cookie（本地明文，页面提示风险）；未配置时检索按钮不发起请求 | `server/routes/cnki.js`、`public/js/cnki.js` |
| 8.2 抓包确认知网检索接口（用使用者账号在浏览器登录后复制请求 URL 与参数），优先解析接口 JSON，失败则降级解析结果页 HTML | 同上 |
| 8.3 检索结果展示、勾选、去重（题名+作者+年卷期）、导入到论文模块 | 同上 |
| 8.4 限速：每次检索后 ≥3 秒，单页 ≤20 条，不自动翻页 | 同上 |
| 8.5 登录态失效提示「登录态已失效，请更新」，不重试 | 同上 |

**风险与降级**：知网存在反爬与接口变更可能。若自动抓取无法稳定工作，退化为「手动粘贴题录 / RIS 导入」，并在设置页保留入口。此降级不阻塞其余模块上线。

**完成判据**：未配置登录态点检索显示提示且无外部请求（验收 14）；配置后检索到结果，勾选 2 条导入，再次检索标记「已入库」且不可勾选（验收 15）。

### Phase 9 — 备份、恢复、设置、导出

| 任务 | 文件 |
|------|------|
| 9.1 数据目录设置与迁移（改目录时复制数据） | `server/lib/paths.js`、`server/routes/settings.js` |
| 9.2 备份：先 checkpoint，再 archiver 打包 app.db + files/，记录条目数、附件数、体积 | `server/routes/backup.js` |
| 9.3 保留 7 份，超出删最旧 | 同上 |
| 9.4 恢复：选文件 → 显示条目数与时间点 → 二次确认 → 恢复前自动 pre-restore 备份 → adm-zip 覆盖 → 提示重启 | 同上 |
| 9.5 自动备份：每天 08:00，服务未运行则下次启动补做 | 同上 |
| 9.6 导出：长编 Markdown、文献 RIS、全库 CSV | `server/routes/compilations.js`、`items.js` |
| 9.7 字段自定义（文本类） | `server/routes/settings.js` |

**完成判据**：备份生成 zip 且三项计数一致（验收 16）；清空数据后恢复，三项数值与备份记录一致且附件可打开（验收 17）；第 9 次备份后仅保留 7 份（验收 18）。

### Phase 10 — 验收走查

逐条执行 `PRD.md` §12 的 18 条验收标准，逐条打勾记录结果；失败项登记为缺陷并回到对应 Phase 修复。

---

## 6. 实现要点与坑位

| 要点 | 处理方式 |
|------|---------|
| 数据库引擎可替换 | 所有 SQL 走 `db.js` 四方法；route 层不 import 驱动 |
| FTS 同步 | 条目/摘录写操作与 FTS 重建放同一事务；批量导入时先禁用逐条重建，最后统一重建 |
| 脚注编号 | 不存序号数字，存 `seq`；渲染时按 seq 排序后映射 ①②③，删除后自然连续 |
| 引用块正文只读 | quote 块的原文取自 excerpt，编辑区只允许改「引导语」和「后缀说明」，避免正文与史料脱节 |
| 删除被引用条目 | 不删正文，把 ref 标 `orphaned=1`，前端脚注标灰并保留文本 |
| 大附件 | 读取接口用流式响应，不整体读入内存；上传目录按 item_id 分目录避免单目录文件过多 |
| TIFF | 允许上传，阅读器页降级为「下载后用外部程序查看」 |
| 中文路径 | bat 纯 ASCII；Node 内部路径用 UTF-8；写入文件时用 path.join 而非字符串拼接 |
| 端口占用 | listen 失败且 errno=EADDRINUSE 时端口 +1 重试，最多 3 次，控制台打印最终端口 |
| 单例 | 启动时尝试绑定 `data\.lock` 文件锁，已存在则提示「已有实例正在运行」并退出 |
| 自动开浏览器 | 服务 listen 成功后 `child_process.exec('start http://localhost:' + port)`，仅 Windows |
| XSS | 所有用户内容渲染前 HTML 转义（`lib/render.js`） |
| SQL 注入 | 全部参数化查询，禁止字符串拼接 SQL |
| 路径遍历 | 附件读取接口校验 rel_path 必须位于 files 目录之内 |

---

## 7. 依赖安装命令（复制即用）

```bash
cd "C:/Users/<用户名>/Desktop/APP开发"
"C:/Users/<用户名>/.workbuddy/binaries/node/versions/22.22.2-3/npm.cmd" init -y
"C:/Users/<用户名>/.workbuddy/binaries/node/versions/22.22.2-3/npm.cmd" i express@4 better-sqlite3 multer archiver adm-zip
"C:/Users/<用户名>/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" -e "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('create table t(a)');console.log('sqlite ok')"
```

启动脚本 `start.bat`（内容保持纯 ASCII）：

```bat
@echo off
cd /d "%~dp0"
"C:\Users\<用户名>\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" server\index.js
pause
```

浏览器由 Node 在 listen 成功后自动打开，bat 内不写中文。

---

## 8. 执行批次建议

| 批次 | 内容 | 说明 |
|------|------|------|
| 第 1 批 | Phase 0 → 2 | 环境与数据层，结束时服务可启动、表已建、种子数据可见 |
| 第 2 批 | Phase 3 → 5 | 条目、分类、检索、六模块 UI、摘录、附件。结束时资料入库闭环可用 |
| 第 3 批 | Phase 6 | 长编编辑器单独一批，它是本产品的核心价值，值得独立验证 |
| 第 4 批 | Phase 7 → 9 | 札记、灵感、首页、知网、备份恢复、导出 |
| 第 5 批 | Phase 10 | 18 条验收走查 + 缺陷修复 |

Phase 8 的知网抓取若遇到反爬阻塞，标记为待定并跳到 Phase 9，不阻塞整体交付。

---

## 9. 与 PRD 验收标准的映射

| 验收条目 | 所属 Phase |
|---------|-----------|
| 1 刷新不丢 | 4 |
| 2 重启不丢 | 1 / 2 |
| 3 长编自动保存 | 6 |
| 4 一条目多分类 | 3 |
| 5 检索命中录文 | 3 |
| 6 插入生成脚注 | 6 |
| 7 删除块脚注重排 | 6 |
| 8 夹注切换 | 6 |
| 9 导出 Markdown | 6 |
| 10 札记关联著作 | 7 |
| 11 灵感状态解锁建长编 | 7 |
| 12 PDF 内置阅读 | 5 |
| 13 拒绝非白名单文件 | 5 |
| 14 未配置登录态不发请求 | 8 |
| 15 知网导入与去重 | 8 |
| 16 备份计数一致 | 9 |
| 17 恢复三项一致 | 9 |
| 18 备份保留 7 份 | 9 |
