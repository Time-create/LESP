# 史料文献工作台 V2：可执行修改开发计划

日期：2026-09-26  
状态：P0—P11 功能实施、分阶段测试与最终打包回归完成；最终全量 160/160 通过，零失败、零跳过。执行证据见 `docs/v2/qa-report.md`，最终结果以 `docs/v2/test-results/summary.json` 为准。  
工作目录：`C:\Users\<用户名>\Desktop\APP开发`。  
适用对象：在现有代码上继续开发的开发者或编码代理。

## 1. 需求依据与执行边界

需求优先级：本次 17 项问答及 `PRD_V2_修改方案.md` → 原 `PRD.md` 中仍有效的业务规则 → 现有实现。原 `PRD.md` 文件仍为 V1，不能因为文件名未变而忽略已确认的 V2 修改。

本计划完成 V2 PRD 中 A01—A27 的验收目标，覆盖：

- 六类资料录文新增、编辑、删除、多级多分类。
- 三类写作新建修复、共用富文本、本地插图、统一主题分类。
- 札记文末注释、引用编号、快照与显式同步、宋体正文和楷体独立引文。
- 文字 PDF 高亮、扫描 PDF 框选、笔记、转录文与准确回到来源。
- 自动保存、Ctrl+S、冲突检测、离开及退出保护。
- Word/PDF 写作导出、带批注 PDF 副本、备份与数据迁移。
- 最终桌面打包、真实操作验证和旧数据兼容。

本计划已获用户授权进入实施。下列勾选表示实施阶段已关闭，不表示所有外部软件版本都经过兼容性验证；条目保留原计划顺序，实际实现、测试证据及已说明的使用边界见 `docs/v2/qa-report.md`。

沿用 Electron + 本地 Node 服务 + Express + SQLite；不整体迁移为其他前端框架，不做 OCR、云同步或多人协作。默认单一开发流顺序实施，不依赖多代理并行。

## 2. 已知代码与实现缺口

以下为实施前的静态检查基线，描述修改前状态；完成情况见文首状态与验收报告。

| 区域 | 当前文件 | 缺口与注意事项 |
| --- | --- | --- |
| 桌面入口 | desktop/main.js、server.js、build.js | 已有独立窗口；新增保存、导出需接入窗口生命周期；打包仍使用独立 Node，不能把 SQLite 直接搬进 Electron 导致 ABI 不匹配 |
| 录文 | server/routes/excerpts.js、server/views/page-item.js、public/js/item.js | API 已有 CRUD，页面缺完整写入入口；编辑 API 需补空正文校验、版本及关联保护 |
| 写作新建 | public/js/compilation.js、notes.js、ideas.js | 依赖 prompt()，需要在桌面复现并替换为应用内表单 |
| 札记入口 | server/routes/pages.js | `/writing/notes/new` 通过 GET 写库；应改为展示表单或带预填参数，新建由 POST 完成 |
| 长编 | server/routes/compilations.js、server/lib/footnote.js | 块与引用独立存储；重排会读取最新出处，需变为快照；不能出现新旧编辑路径双写不一致 |
| 札记／灵感 | notes.body、ideas.summary 等字段 | 主要是文本，需无损迁移到统一文档模型；原关联与灵感状态不能丢 |
| 分类 | collections、collection_items | 现有分类用于资料条目；不要直接改变其语义来承载所有新分类 |
| PDF | server/routes/pages.js 的 reader 路由 | iframe 阅读，无应用级批注存储和位置映射 |
| 数据升级 | server/db.js、schema.sql | 目前主要执行 CREATE IF NOT EXISTS；已有表不会自动获得新列，必须引入有版本的迁移 |
| 备份 | server/routes/backup.js | checkpoint 失败仍继续复制数据库；存在写入时不能把这种方式视为一致性快照 |
| 数据目录迁移 | server/routes/settings.js、desktop/server.js | 需修复启动目录指向、锁归属和失败回退；当前仅在目标库记录路径的方式要验证重启能否找到目标 |
| 测试 | tests/phase*.test.js、acceptance.test.js、desktop.test.js | 存在 API／结构测试，但不能代替桌面真实点击和导出文件视觉检查 |

## 3. 总体技术方案与必须提前验证的部分

### 3.1 保持已有架构，新增三个公共模块

1. **分类服务**：条目内录文树、统一主题树及多对多关系。
2. **文档服务**：三类写作共用内容结构、引用快照、版本、保存、导出输入模型。
3. **阅读批注服务**：附件、PDF 坐标、笔记、录文转换和来源定位。

前端只把需要富交互的编辑器和阅读器打包为本地静态模块，现有服务端页面与导航继续使用。不为新增功能创建另一套服务或数据库。

### 3.2 默认技术路线

具体版本在 P2 验证后固定为精确版本并提交锁文件；本计划不把尚未安装验证的版本写成已验证事实。

| 能力 | 默认路线 | 技术验证及边界 |
| --- | --- | --- |
| 富文本 | ProseMirror 及必要的 schema、state、view、history、commands、keymap、list 模块；自定义引文及图片节点 | 数据用结构化 JSON，中文输入、撤销及引用 ID 复制必须验证。其 schema 机制可作为结构建模基础，参见[官方 schema 文档](https://github.com/ProseMirror/website/blob/master/markdown/guide/schema.md) |
| 本地前端构建 | esbuild，将编辑器与阅读器入口输出到 public/dist | 仅开发和打包时执行；使用时不下载 CDN，worker、字体映射等资源显式复制 |
| PDF 渲染 | PDF.js 的页面、文字层与 viewport，自建批注层 | 官方提供显示层和页面渲染接口；批注保存和坐标业务需自己实现，参见[官方入门](https://mozilla.github.io/pdf.js/getting_started/)与[示例](https://mozilla.github.io/pdf.js/examples/) |
| Word | docx 包生成正文、图片、样式、链接与脚注；札记文末注释优先使用可编辑文末段落及双向书签 | 不把普通编号伪称 Word 原生动态尾注；长编真实脚注能力做样件。参见[文档属性 API](https://docx.js.org/api/types/IPropertiesOptions.html) |
| 写作 PDF | 统一导出 HTML → 本地分页 → Electron 隐藏窗口 printToPDF | 文末注释／夹注可常规分页；真实页脚脚注先验证 Paged.js，不能靠固定页脚伪装，参见[分页文档](https://pagedjs.org/en/documentation/)与[Electron 输出接口](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions) |
| 批注 PDF | pdf-lib 读原文件，写标准 Highlight、Square／Text 批注字典及所需外观流，再另存 | 库的通用修改保存能力不等于开箱即用的注释 API。低层批注、中文 Contents、QuadPoints 和其他阅读器显示必须单独验证，参见[官方 PDFDocument API](https://pdf-lib.js.org/docs/api/classes/pdfdocument) |
| 桌面端到端测试 | Playwright Electron 自动化作为首选，并保留人工脚本 | 在现有 Electron 版本上先验证可启动并点击；若驱动不兼容，不取消验收，保留应用内测试钩子加人工桌面操作证据 |

P2 中若编辑器、批注导出或真实分页脚注不通过，先局部更换对应组件／补适配器，不推翻整个应用架构。替代方案仍须达到原验收；不能把页下注换成文末注释后标记完成。许可或安装需求改变产品范围时说明实际影响。

## 4. 目录与改动范围

以下为计划文件，不表示已创建；全部在现有项目内增加。

```text
server/
  db.js, schema.sql                 数据初始化与迁移入口
  migrations/                     带版本、可重复启动的数据库迁移
  services/
    taxonomy.js                    两类分类及主题聚合
    writing.js                     文档统一读写、转换与版本
    citations.js                   引用快照、编号、更新检查
    annotations.js                 PDF 批注和转录文
    resources.js                   写作图片与附件资源生命周期
    backup.js                      一致性快照、恢复与维护锁
    export-model.js                统一的导出中间模型
    export-docx.js                  Word 序列化
    export-html.js                  PDF 打印内容
    export-annotations.js          标准 PDF 批注副本
  routes/
    taxonomy.js, writing.js, annotations.js, resources.js
    excerpts.js, compilations.js, notes.js, ideas.js
    export.js, backup.js, settings.js, attachments.js, pages.js
  views/
    page-themes.js, page-reader.js, writing-shell.js
    page-item.js, page-compilation.js, page-notes.js, page-ideas.js
shared/
  document-schema.js               前后端共享的节点、字段和校验
  citation-order.js                基于正文顺序产生编号
frontend/
  editor/                          schema、工具栏、引用节点、图片节点
  reader/                          页面、文字层、选区和批注层
public/
  js/dialog.js, save-controller.js, taxonomy.js, excerpts.js
  css/editor.css, reader.css, export.css
  dist/                            本地构建产物及 PDF worker 等资源
desktop/
  main.js, server.js, build.js
  preload.js                       仅暴露必要的保存／退出／导出消息
  lifecycle.js                     关闭与导航协调
  export.js                        隐藏打印窗口、系统保存对话框
scripts/
  build-frontend.js, test-all.js, test-v2.js, verify-data.js
tests/
  v2/*.test.js                     数据／API／转换与导出测试
  e2e/*.spec.js                    实际桌面交互
  fixtures/v2/                     专用样件，不含用户真实资料
docs/v2/
  baseline.md, decisions.md, schema.md, api.md, qa-report.md
```

`shared/`、本地构建产物和 PDF worker 必须进入 desktop/build.js 打包清单；原构建只复制 desktop/server/public，遗漏 shared 会导致源码运行正常但 exe 失败。

## 5. 冻结后实施的数据设计

P2 验证编辑器节点和批注坐标后，在 P3 冻结此设计。SQL 全部经现有数据库封装或新增数据库专用方法执行。

### 5.1 新增与扩展实体

| 实体 | 计划字段／约束 |
| --- | --- |
| schema_migrations | version 主键、名称、校验值、applied_at；只记录已提交成功的迁移 |
| excerpts 扩展 | revision、updated_at、locator_json、source_json；旧 locator/text/comment/seq 保留 |
| items 扩展 | source_revision，用于影响出处的字段更新；标题、版本等变化时递增 |
| attachments 扩展 | content_sha256、page_count（可空，解析后回填）；文件变化使来源状态失效 |
| excerpt_folders | id、item_id、parent_id、name、sort；父子所属 item 一致 |
| excerpt_folder_links | folder_id + excerpt_id 联合唯一 |
| themes | id、parent_id、name、sort |
| theme_links | theme_id + content_type + content_id 联合唯一；type 仅 excerpt/compilation/note/idea |
| writing_documents | id、kind、entity_id、schema_version、revision、content_json、plain_text、updated_at；kind/entity_id 唯一 |
| writing_citations | uuid、document_id、source_kind、source_ids、source_revisions、quote_snapshot、note_snapshot、locator_snapshot、source_hash、reviewed_source_hash；不存可手改的显示编号 |
| writing_resources | uuid、rel_path、mime、size、width、height、sha256、created_at |
| document_resource_links | document_id + resource_id 唯一，保存时按文档结构更新 |
| pdf_annotations | uuid、attachment_id、kind、group_id、revision、geometry_json、selected_text、note、color、created_at、updated_at |
| annotation_excerpt_links | annotation_id + excerpt_id 唯一，允许用户明确再次转录而非被迫一对一 |
| writing_drafts | document_id、client_id、base_revision、draft_json、saved_at；按文档客户端唯一，草稿不是正式保存成功 |
| idea_conversions | idea_id 唯一、compilation_id、created_at；避免重复转换，不对旧库中历史重复记录粗暴加唯一约束 |

### 5.2 关键一致性规则

- 分类根节点 parent_id 可为空；SQLite 中包含 NULL 的普通 UNIQUE 不能阻止同名根节点，需要根级／非根级分别建立唯一索引，或用明确的规范化父键。
- 多态关联由服务层白名单验证目标是否存在；SQL 参数化，不能将 kind 直接拼成任意表名。删实体在同一事务清理分类关系和资源使用关系。
- 引用不因删除源条目而级联删除。实时 source_id 可为空，历史 ID、文本、出处和坐标快照保留。
- 文档、引用集合、资源关系、标题／状态等需在一个保存事务中提交。避免先更新正文再失败于注释，形成半保存。
- 写作实体表继续保存各自元信息；writing_documents 是 V2 正文的唯一写入源。旧 body/summary/blocks 是迁移输入或兼容投影，禁止作为另一个独立可写正文。
- 删掉正文中的引用先标为该文档未使用，保留到撤销窗口结束或明确清理；不能因一次自动保存物理删除快照，导致撤销后无法恢复。
- 图片放在 `files/_writing/<resource-id>.<ext>`，沿用 files 备份目录。上传暂存资源与正式使用资源区分，未引用资源按宽限期清理，不能上传失败就立即误删其他文档共用文件。
- 来源更新比较文本及出处相关版本／哈希，不把分类改动当成引文变化；选择保留旧版本记录 reviewed_source_hash，新一轮源更新再提示。

### 5.3 文档节点与引用 ID

文档结构至少支持 paragraph、heading、ordered_list、bullet_list、list_item、quote_block、analysis_block、image、citation_anchor、text；文字 marks 包括 bold/italic/underline。

quote_block 引用 citation_id，内部保留可编辑的引文内容并与本次保存的 quote_snapshot 一致；citation_anchor 用于行内引用。独立引文末尾由节点视图展示编号，不允许用户修改编号字面值。

移动引用保留 UUID；复制引用生成新 UUID并复制快照；撤销／重做按编辑事务还原引用集合。写作保存验证所有引用节点都有有效快照，禁止悬空引用。

### 5.4 PDF 坐标约定

以 PDF 页面用户空间坐标作为持久化标准，记录页面 viewBox、rotation 和 quadPoints／rect。屏幕选区通过 viewport 逆变换得到 PDF 坐标，绘制时正向变换。

用户页码统一 1-based，内部访问 PDF.js 时在单一入口转换；不把屏幕滚动偏移、devicePixelRatio 或当前缩放值作为永久坐标。多行高亮保存多个四边形；跨页标记用 group_id 关联逐页实体。

## 6. 接口与保存契约

复用现有入口，不一次性删除旧 API。下列为 V2 新增／扩展契约；P3 写入 docs/v2/api.md。

| 接口 | 作用 |
| --- | --- |
| GET/POST /api/excerpts；PUT/DELETE /api/excerpts/:id | 补版本、出处结构、分类及来源；列表支持 item、theme、folder、搜索、分页 |
| GET/POST /api/excerpt-folders；PATCH/DELETE /api/excerpt-folders/:id | 管理条目内分类，校验 item 所属关系 |
| GET/POST /api/themes；PATCH/DELETE /api/themes/:id | 统一主题树、移动和删除影响范围 |
| GET /api/themes/:id/contents | type、include_descendants、q、cursor、limit；组合 type/id 去重 |
| PUT /api/content/:type/:id/themes | 替换该内容的主题集合；配合 revision，避免静默覆盖 |
| GET/PUT /api/writing/:kind/:id/document | 统一文档读写；包含正文、快照、标题、状态、主题及资源引用 |
| POST /api/writing/:kind/:id/citation-preview | 根据录文生成快照候选，仅返回预览、不写独立孤儿引用 |
| GET /api/writing/:kind/:id/source-changes | 批量检查引用来源变化及缺失 |
| PUT /api/writing/:kind/:id/draft | 保存独立恢复草稿，不增加正式文档 revision |
| POST /api/resources/images；GET /api/resources/:id/file | 本地图片上传与显示 |
| GET/POST /api/attachments/:id/annotations | 列表或创建高亮／框选与笔记 |
| PATCH/DELETE /api/annotations/:id | 批注修改及删除，支持 revision 冲突检测 |
| POST /api/annotations/:id/excerpts | 校验手填／选中文本，事务内生成录文与关联；支持幂等请求 ID |
| GET /api/sources/resolve?document_id=...&citation_id=... | 服务端从受控快照解析原文位置，不接受任意本地文件路径 |
| POST /api/writing/:kind/:id/exports | 根据指定已保存 revision 创建 docx/pdf 导出任务，返回 job_id |
| POST /api/attachments/:id/annotated-export | 创建带批注副本任务，绑定文件哈希及批注快照 |
| GET /api/export-jobs/:id；GET /api/export-jobs/:id/file | 查询状态与下载完成文件；未完成不能返回成功文件 |

新建仍使用 `/api/compilations`、`/api/notes`、`/api/ideas`，在同一事务创建实体与空文档。旧长编块接口、札记 body 更新和灵感 summary 更新，在切换后统一通过适配器修改 canonical document，或明确拒绝旧版正文写法并同步更新调用方；不允许更新后刷新又回旧内容。

统一错误响应 `{error, code, details}`；400 校验、404 缺失、409 版本冲突、413 上传超限、423 维护锁、500 非预期失败。服务器返回的新 revision 才能使客户端标记已保存。

保存请求至少带 `baseRevision`、`clientMutationId`、`document`。同一个 mutation 重试返回原结果；新 mutation 基于旧 revision 返回 409。方案默认保存历史 mutation 结果采用有界保留，不无限堆积。

## 7. 阶段总览与依赖

| 阶段 | 目标 | 依赖 | 主要验收 |
| --- | --- | --- | --- |
| P0 | 基线、真实复现、数据保护 | 无 | 基线与样件可重复 |
| P1 | 录文入口和三类新建修复 | P0 | A01、A05 的基础闭环 |
| P2 | 编辑、批注导出、分页脚注技术样件 | P0；默认 P1 后顺序做 | 冻结可行技术与依赖 |
| P3 | 迁移、统一模型及兼容适配 | P2 | A23 基础 |
| P4 | 两套分类与统一主题页 | P3 | A02—A04、A11 |
| P5 | 富文本、图片、可靠保存 | P3、P4 | A06、A17、A18、A22 基础 |
| P6 | 引用、札记注释与灵感转换 | P5 | A07—A10、A25 |
| P7 | PDF 阅读、高亮、框选与笔记 | P3、P2 | A12、A13 |
| P8 | 批注转录文与来源闭环 | P4、P6、P7 | A14—A16 |
| P9 | 三种导出与文件验收 | P2、P6、P8 | A19—A21 |
| P10 | 完整备份、恢复与迁移目录 | P3—P9 | A22—A24 |
| P11 | 全量桌面验收与发布替换 | 所有前置阶段 | A01—A27、A26、A27 |

每一阶段做对应的增量测试；跨模块风险优先测试。完成判据未满足不能勾选完成。开发者持续更新阶段记录，不把「功能按钮已画出」当作实现完成。

## 8. P0：基线与数据保护

**修改／新增目标**：本阶段仅测试夹具、基线记录和测试启动辅助，不变更真实数据。

- [x] P0-01 检查工作区说明与用户未提交修改；有 Git 则记录状态，没有则用工作区文件清单与哈希保存基线，不自动初始化新项目。
- [x] P0-02 记录实际 Node、Electron、better-sqlite3 版本、启动入口和当前数据目录；确认 Node 22 下 SQLite 可打开临时库。
- [x] P0-03 在独立数据目录运行现有测试，记录命令、退出码和失败；原有失败与本次引入失败分开列出。
- [x] P0-04 从实际数据创建一致性副本：优先使用 SQLite backup API；或确认所有相关进程关闭后复制完整数据。运行中的库不得只拷贝 app.db 忽略 WAL。
- [x] P0-05 只读检查副本：integrity_check、各实体数量、附件路径存在性；绝不对真实资料执行测试 seed。
- [x] P0-06 用测试数据启动打包 exe，分别复现不能录文、新建长编／札记／灵感无反应，记录点击路径与错误日志；确认是否由 prompt() 导致，不预设唯一原因。
- [x] P0-07 准备样件：六类资料各一条、三级分类示例；可选文字 PDF、扫描 PDF、多行／跨页文字、旋转与 CropBox 非零 PDF；三页以上注释样文、21 条以上引用、横竖图片与中文字体样文。

**输出**：docs/v2/baseline.md、测试夹具、真实数据副本的清单与位置（不提交私人数据）。

**完成判据**：可重复启动隔离环境；现有问题有可复現步骤；备份可打开且不影响原工作台。

## 9. P1：先修复当前不能使用的入口

**主要文件**：public/js/common.js、dialog.js、excerpts.js、compilation.js、notes.js、ideas.js；server/views/page-item.js、page-*.js；server/routes/excerpts.js、pages.js。

- [x] P1-01 新增应用内异步输入／确认组件，支持标题、字段提示、Enter 提交、Esc 取消、焦点管理及提交忙碌状态；不要只重定义 window.prompt。
- [x] P1-02 将三类写作新建入口接到已有 POST API，白空标题拒绝、双击去重、错误保留输入；成功进入编辑页。
- [x] P1-03 将 GET `/writing/notes/new` 改为预填页面／打开新建表单，兼容旧入口参数；真正创建由 POST，取消不得留下未命名记录。
- [x] P1-04 六类资料录文页签加入新增、编辑、删除；表单至少正文、定位和按语。接通现有接口，更新条目录文数量和列表。
- [x] P1-05 修复录文 PUT 空文本校验、更新时间和检索索引更新；删除先检查引用并提示，确保已有长编引文不消失。
- [x] P1-06 在打包版点击验证三类创建及六类录文；为失败保留、取消和重复提交增加行为测试，避免只检查按钮 ID。

**输出**：能正常录文和创建写作的增量版本。分类／富文本尚未完成时明确阶段范围，不发布为 V2 完整交付。

**完成判据**：A01、A05 基础路径在 exe 里可用；重启后记录仍在；取消没有空记录。

## 10. P2：先做高风险能力样件，再冻结结构

**主要文件**：仅技术样件与 docs/v2/decisions.md；验证通过后调整 package.json、锁文件及 scripts/build-frontend.js。

- [x] P2-01 编辑器样件：宋体正文、楷体 quote 节点、图片、引用 UUID；中文输入法连续输入，复制／移动引用，撤销，JSON 保存及回读。
- [x] P2-02 PDF 样件：使用 PDF.js 同时显示页面与可选择文字层，取多行 quad，验证 100%／150% 缩放、90° 旋转及不同裁切页的往返坐标。
- [x] P2-03 批注副本样件：文字高亮与区域框选各含中文笔记；写出标准批注和外观；在第二种阅读器打开检查，验证原文件哈希不变。
- [x] P2-04 Word 样件：三页文档含 21 条引用、宋体／楷体、图片、札记文末双向书签；另一个长编样件带实际页脚脚注，Word/WPS 打开不提示修复。
- [x] P2-05 PDF 排版样件：Paged.js 处理页脚脚注，再 printToPDF；检查长注释跨页、同页多注、图片分页与圈号。失败先验证分页适配，不推迟到交付最后才发现不支持。
- [x] P2-06 字体样件：检测机器中宋体和楷体可用性；PDF 实际无缺字，必要嵌入符合字体使用条件；不擅自把系统字体打包分发。
- [x] P2-07 核验 Electron 测试驱动与本地 PDF worker 加载；确认断网后样件运行。
- [x] P2-08 固定选用版本、许可、Node 要求、构建及静态资源复制清单；给每个样件记录结果和产物。

**完成判据**：编辑文档往返不丢结构；PDF 标记与导出可回读；真实页脚注在目标输出可见；所有选型有本地通过证据。未达标部分不得写「支持」后继续依赖它。

## 11. P3：数据迁移与单一写入模型

**主要文件**：server/db.js、schema.sql、migrations/*、services/writing.js、citations.js、shared/document-schema.js、原写作路由。

- [x] P3-01 引入迁移执行器，锁定数据目录，在事务内执行 SQL 与版本登记；记录迁移前版本与备份。数据库新于当前程序可支持版本时拒绝写入并说明，不能运行旧程序破坏新库。
- [x] P3-02 分版本添加录文／资料版本列、分类表、文档／引用／资源表、批注表及索引。新建空库和旧库升级结果一致，不能靠 CREATE IF NOT EXISTS 添加旧表列。
- [x] P3-03 迁移 notes.body 与 ideas.summary：保留原文副本；明确识别已知 Markdown 格式，默认纯文本按段落处理，不把原 HTML 当可执行内容。
- [x] P3-04 迁移长编：按 seq/id 保留 heading/text/quote/comment，保留 lead、tail、quote_text、refs.text 和 orphaned；旧注释缺失才记录缺失，不能用当前资料悄悄重建历史出处。
- [x] P3-05 建立 get/saveDocument 与旧 API 适配层；标题、正文、引用、资源和分类原子保存。旧字段只从 canonical document 产生需要的兼容投影。
- [x] P3-06 定义文档 JSON 校验与大小限制；服务器计算合法引用集合、纯文本索引及资源引用；不信任客户端传入的 SQL 类型／本地路径。
- [x] P3-07 增加 revision 条件写入与 mutation 幂等；同一旧 revision 的两次不同修改只能一次成功，另一次 409，不能最后到达覆盖。
- [x] P3-08 为删除资料、录文、文章建立统一清理服务，源删除保留写作快照；异常回滚不留下半条分类或引用关系。
- [x] P3-09 用旧库副本验证迁移一次、重复启动、事务失败注入、回退和新版拒绝旧客户端；对比实体数量、原文及附件哈希。

**输出**：docs/v2/schema.md、api.md、迁移文件、兼容性测试。

**完成判据**：A23 基础通过，数据正文无损；只有统一文档入口可以改变 V2 正文；迁移失败能用迁移前副本恢复。

## 12. P4：录文分类与统一主题

**主要文件**：services/taxonomy.js、routes/taxonomy.js、views/page-themes.js、layout.js、public/js/taxonomy.js、录文及写作列表。

- [x] P4-01 完成条目内树 API，校验同条目父子、同级名称、循环移动及非法关联。
- [x] P4-02 完成统一主题 API，树删除返回影响数量并要求明确确认；删除只影响树及关系。
- [x] P4-03 做可复用树与多选选择器，显示完整路径、支持搜索、取消归类、未分类和仅本级／含子级筛选。
- [x] P4-04 录文表单接入两套独立选择器；正文和分类同事务提交，失败不出现正文保存但分类丢失的假成功。
- [x] P4-05 增加主题汇总页和导航；按 type/id 去重分页，四类内容并列展示；关键词过滤不得因为旧 LIMIT 300/400 导致后续资料无法找到。
- [x] P4-06 三类写作列表接入同一主题树；新增主题与旧资料 collections 的界面名称明确区分。
- [x] P4-07 测试三层父子、重复根名、父子同时归类、移树后查询、删父树后原内容保留。

**完成判据**：A02—A04、A11 全部通过；同一主题可以实际找到跨条目录文及三种写作。

## 13. P5：富文本、图片与保存／退出协调

**主要文件**：frontend/editor/*、writing-shell.js、三类写作页面、save-controller.js、resources 服务、desktop/preload.js、lifecycle.js、main.js。

- [x] P5-01 以同一编辑器替换三处文本编辑；保留各自标题、状态、关联对象和灵感下一步，不另做三套富文本实现。
- [x] P5-02 实现基础工具栏、标题层级、列表、分析段落／引文切换、撤销重做和清除格式；粘贴按 schema 清洗，禁止脚本或任意 iframe。
- [x] P5-03 正文和引文分别应用宋体、楷体；前端 CSS 与导出样式共用明确的语义，不靠临时 inline font-family 决定是否引文。
- [x] P5-04 图片上传校验签名、类型和大小；用资源 ID 插入；等比例调整、图注、删除与资源关联；Word 不支持的图片格式在导出管线中转换为 PNG/JPEG，原资源保留。
- [x] P5-05 保存控制器：停止输入约 2 秒、持续输入最长约 10 秒；compositionstart/end 期间不截断中文；Ctrl+S 立即排队保存。
- [x] P5-06 实现 dirty→saving→saved/error 状态机；请求进行时只保留最新待保存状态，按 revision 顺序发送；响应成功但之后又有编辑仍标 dirty。
- [x] P5-07 保存、修改关联、分类及标题时不整页 reload；光标、滚动及撤销历史保留。409 显示冲突并保留本地草稿，不自动覆盖。
- [x] P5-08 本地草稿恢复绑定稳定文档 ID，落在数据目录数据库而非随机服务端口的 localStorage；启动提示恢复、查看或舍弃，正式保存后清理对应草稿。
- [x] P5-09 preload 仅暴露保存状态通知、prepareToLeave 与结果确认，不暴露任意文件／命令。主进程验证消息来源为受信本地页面与窗口。
- [x] P5-10 导航／后退／菜单切换／窗口关闭／菜单退出统一先 prepareToLeave；保存失败显示重试、继续编辑、明确放弃；renderer 卡住默认取消离开，不默认丢弃。
- [x] P5-11 应用退出先收集所有有编辑能力窗口的保存结果，再真正关闭，最后停服务；任一窗口取消则取消整个退出，不因先关主窗销毁其他未保存内容。
- [x] P5-12 故障测试：延迟响应、500、断开服务、连续 Ctrl+S、多窗口同文档、输入法、关闭中保存和恢复草稿。

**完成判据**：A06、A17、A18；A22 的本地图片部分通过。每个保存状态都对应真实持久化结果，恢复草稿不依赖旧端口。

## 14. P6：引用快照、札记注释与灵感转长编

**主要文件**：services/citations.js、shared/citation-order.js、编辑器引用节点与选择器、lib/footnote.js、ideas/compilations 路由。

- [x] P6-01 完成资料录文选择器，支持跨条目、主题、关键词和分页；插入位置为当前光标／选定块，禁止一直追加末尾。
- [x] P6-02 新建引用快照携带原文、出处、版本和可用定位；手动引用允许填写原文与出处而无需虚造 source_id。
- [x] P6-03 编号函数仅遍历文档顺序输出 UUID→序号；1—20 圈号，之后 (21)；正文标记和文末注释调用同一映射。
- [x] P6-04 札记文末列表可编辑注释，支持标记跳转及返回；灵感需要引用时共用该能力。长编保留 footer/inline 设置，网页底部注释与实际打印页脚名称不混淆。
- [x] P6-05 复制引用生成新 UUID，移动保留 UUID，撤销可恢复快照；手工修改的出处不能被 renumber 覆盖。
- [x] P6-06 源变化检查按批量查询，不对每条引用单独发网络请求；展示对比、更新本条、保留本条；两者均按文档版本保存，避免同步时覆盖尚未保存的分析。
- [x] P6-07 源删除显示具体状态但保留文章。字体、快照和出处定位覆盖六类资料，不依赖某种书目格式字段全部存在。
- [x] P6-08 灵感转长编在一个事务完成：继承正文、图片使用关系、快照和主题，生成新引用 UUID；保留现有可开题状态约束与原灵感。
- [x] P6-09 转换 API 幂等，重复调用返回已建长编；已有「关联资料自动带入录文」行为保留，已在正文引用的同一段录文不再无意重复追加。
- [x] P6-10 完成混合引用、21 条以上序号、增删移动撤销、源更新保留、资料删除和灵感重复转换测试。

**完成判据**：A07—A10、A25。必须演示「源修改→旧文不变→提示→只更新选中引用」。

## 15. P7：PDF 阅读器与批注持久化

**主要文件**：views/page-reader.js、frontend/reader/*、services/annotations.js、routes/annotations.js、附件元数据服务。

- [x] P7-01 PDF 路由切换到可控阅读器；图片附件原查看方式保留。PDF worker、cMaps／标准字体等所需资源走本地路径。
- [x] P7-02 实现翻页、页码、适宽和缩放，页面按可见区懒加载；切换页面取消过期渲染任务，释放离屏大 canvas，避免整本扫描书驻留内存。
- [x] P7-03 文字层选区处理：裁剪到对应页面，合并同一行合理片段，转为 quadPoints；旋转及不同页面尺寸可逆映射。
- [x] P7-04 实现文字高亮创建、颜色、选中、删除；跨页逐页存储并保持同 group。若首版限制单页选择，必须在提交前明确阻止跨页操作，不静默丢后半段。
- [x] P7-05 区域框选工具与文字选择互斥；支持重画／调整区域，保存独立 rect；拖出页面时裁剪，不保存越界或零面积坐标。
- [x] P7-06 笔记侧栏可创建、修改、删除，按页和位置排序；持久化带 revision、错误反馈和保存控制器，重开加载数据库内容。
- [x] P7-07 原 PDF 始终只读，上传时或首次索引计算哈希；替换、损坏、加密 PDF 显示具体错误，不把错误页当空白页。
- [x] P7-08 用文字、扫描、混合尺寸、裁切旋转样件验证，至少在 100%/150% 和 0°/90° 下截图比较位置；重启检查数据与原文件哈希。

**完成判据**：A12、A13，扫描文件没有虚构选中文字或 OCR 结果；PDF 阅读器失败不会损坏原附件。

## 16. P8：批注转录文与返回原文

**主要文件**：annotations 服务、excerpts 路由与表单、citations 来源解析、阅读器深链接。

- [x] P8-01 批注「转为录文」打开共享表单；文字高亮预填原文，框选要求手填；笔记进入按语，不混入原文。
- [x] P8-02 自动关联所属资料、PDF 物理页与坐标，卷／册／印刷页单独填；保存同事务写录文、分类与批注关联。
- [x] P8-03 首次转换采用 mutation 幂等；已转换显示查看录文，另建第二条需明确操作，不让双击创建重复条目。
- [x] P8-04 构建来源解析结果：available、annotation_deleted、file_missing、file_changed、source_deleted；快照位置可用时仍可临时显示原区域。
- [x] P8-05 录文及引用的查看原文使用附件 ID 与服务端解析坐标打开内部 reader；不将印刷页码拿来跳转，不接受任意 file:// 地址。
- [x] P8-06 自动出处使用卷册／印刷定位，缺失印刷页码时明确 PDF 第 X 页；手动无 PDF 引用不生成虚假页码。
- [x] P8-07 验证「PDF 20 页／印刷 8 页」、批注删除仍有快照、附件删除、文件内容改变、资料迁移后 ID 保留等场景。

**完成判据**：A14—A16；走通文字 PDF 和扫描 PDF 两条完整「批注→录文→札记→原文」路径。

## 17. P9：Word、写作 PDF 与批注 PDF 导出

**主要文件**：export-model/docx/html/annotations 服务、routes/export.js、desktop/export.js、export.css。

- [x] P9-01 构建统一 ExportModel：元信息、语义段落、字体、图片、按出现顺序排列的引用与注释；来自已保存 revision 的不可变快照。
- [x] P9-02 点击导出先 flush 保存；失败则停止并保留编辑状态。提交导出任务时指定 revision，后台生成期间再编辑不改变该次导出内容。
- [x] P9-03 DOCX 映射标题、段落、marks、列表、图片及图注，设置东亚字体；为札记生成文末注释书签及返回链接，长编 footer 生成真实脚注。
- [x] P9-04 Word 原生脚注自定义圈号／超过 20 的标记按 P2 验证结果实现；若使用自定义标记，准确说明 Word 内编辑后的重排行为，不作虚假自动重排承诺。
- [x] P9-05 PDF 输出本地 HTML，等待字体、图片和分页完成信号再 printToPDF；A4、常规边距、页码；长编页脚脚注走已验证分页管线。
- [x] P9-06 隐藏打印窗口只加载受控导出内容，拒绝外部请求和任意导航；任务成功／失败均销毁窗口并清理临时资源。
- [x] P9-07 批注副本保留已有原生批注，追加本次工作台标准批注；处理 Highlight/Square/Text、Contents、颜色、外观和页坐标，另存新文件。
- [x] P9-08 系统保存对话框、取消与重名覆盖流程；先写受控临时文件再原子完成目标文件，失败不留损坏的最终文件，路径只经主进程授权选择。
- [x] P9-09 现有 Markdown 导出改读 ExportModel；标题／段落／引文／注释可转换，含图片时输出带相对 assets 的包，纯文本旧用例仍保留。
- [x] P9-10 结构检查 DOCX XML 关系、图片数量和注释对应；实际用 Word/WPS 打开，并渲染 DOCX/PDF 检查中文字体、跨页图片、长注释、链接及无截断。
- [x] P9-11 批注 PDF 在另一阅读器检查高亮与中文笔记；原文件哈希不变；损坏／加密文档的导出错误可读。

**完成判据**：A19—A21。导出有结构测试和视觉证据；不能只因文件大小大于零就通过。

## 18. P10：完整备份、恢复与数据目录迁移

**主要文件**：services/backup.js、routes/backup.js、settings.js、lib/paths.js、lib/lock.js、desktop/server.js。

- [x] P10-01 将备份／恢复／迁移统一为维护操作：停止接收新写入并给出可重试状态，等在途事务与保存完成，不在复制中继续改写资源。
- [x] P10-02 数据库通过一致性 backup API 或已验证停写快照输出到 staging；checkpoint 失败不能假装备份成功。manifest 记录 schema 版本、实体计数和文件哈希。
- [x] P10-03 打包全部 files（含 _writing）和数据库，不带锁、临时输出／未完成上传；明确草稿纳入备份，原 PDF 内容不被导出副本替换。
- [x] P10-04 恢复先解压到隔离目录，校验路径、清单、完整性与支持的 schema，再在隔离副本迁移；不直接把未校验 ZIP 覆盖现有目录。
- [x] P10-05 恢复前保留可回退版本；切换失败恢复原库和资源，不能只重开一个已经部分覆盖的库。成功刷新相关窗口缓存。
- [x] P10-06 数据迁移拒绝目标位于源内部或不安全覆盖已有数据目录；复制校验成功后再切换运行目录、锁和启动指针。
- [x] P10-07 启动指针保存在稳定的启动配置位置，由 paths/启动器共同读取；保持现有桌面目录相对 data 作为默认。迁移后重启必须使用新目录，不能只在目标数据库里写自身位置。
- [x] P10-08 故障注入：损坏备份、少图、磁盘写失败、目标目录权限不足、复制中中断；确认原数据和启动入口仍可用。
- [x] P10-09 在另一隔离目录恢复 V1/V2 备份，检查图片、批注、主题、引文、定位；迁移后重启并再备份一次。

**完成判据**：A22—A24 全部通过；升级前备份不进入普通七份备份轮换而被自动淘汰；启动目录与锁随迁移一致。

## 19. P11：最终桌面验收与发布

**主要文件**：desktop/build.js、package.json、scripts/test-*.js、tests/e2e/*、docs/v2/qa-report.md、桌面工作台使用说明.md。

- [x] P11-01 本地前端构建先于桌面构建；检查 shared、worker、字符映射、静态资源、生产依赖全部进入产物。构建临时目录后验证再替换，避免旧产物残留。
- [x] P11-02 继续捆绑匹配 SQLite 的 Node 运行时；核验安装依赖后 native addon 未被系统 Node 的 ABI 重建成另一版本。
- [x] P11-03 运行所有旧测试、新数据/API 测试、导出检查和桌面 E2E；因新行为淘汰的旧断言要对应 PRD 更新，不能直接删除失败测试。
- [x] P11-04 在打包 exe 完成六类录文、三类写作、两种 PDF、两种分类、引用变更及三种导出；分别重启复核持久化。
- [x] P11-05 断网启动，首次打开阅读器／编辑器并导出；检查没有 CDN、开发端口或未打包资源依赖。
- [x] P11-06 检查重复启动、主／子窗口关闭、保存失败取消退出、后台进程退出、旧启动脚本及中文路径；页面不能访问任意 Node 能力。
- [x] P11-07 用 1000 条录文、100 篇写作及 200 页扫描样件观察检索和阅读；记录机器及样件大小。建议目标：主题检索常规查询 1 秒内，编辑输入无明显阻塞；不以未测数字宣称性能通过。
- [x] P11-08 保存测试报告、迁移清单、截图、导出样件及依赖清单，更新使用说明：分类区别、页码区别、恢复草稿、引用同步、导出注释的边界。
- [x] P11-09 先关闭旧应用并完成真实数据备份，再按已验证流程升级现有数据；确认数据清单和新 exe 使用实际数据目录。切换后首次打开不运行 seed。
- [x] P11-10 保留上一份程序与迁移前数据的成套回退入口。若 V2 已产生新内容，回退前额外备份 V2 数据，不能用旧库覆盖而隐瞒新内容损失。

**完成判据**：A01—A27 有逐项证据；最终启动入口指向新程序；无阻断缺陷。未通过的真实页脚、PDF 批注或字体能力不得以「后续优化」跳过。

## 20. 测试分组与验收映射

下表保留原计划的测试分组名称。实际文件按阶段命名：`tests/v2/p0-baseline.test.js` 至 `p11-*.test.js`，桌面行为测试位于 `tests/e2e/p*.test.js`；统一入口为 `npm run test:all`。各组覆盖关系与测试结果见验收报告。

| 测试文件／组 | 覆盖范围 | PRD 对应 |
| --- | --- | --- |
| tests/v2/migrations.test.js | 升级、重复执行、回滚、正文对比 | A23 |
| tests/v2/excerpts.test.js | 六类写入、空值、版本、删除保护 | A01、A10 |
| tests/v2/taxonomy.test.js | 循环、同名根、多选、统计去重、删除 | A02—A04、A11 |
| tests/v2/writing.test.js | canonical 文档、资源关系、标题及状态 | A06、A22 |
| tests/v2/save-conflicts.test.js | 乱序、幂等、冲突、草稿版本 | A17、A18 |
| tests/v2/citations.test.js | 顺序、复制 ID、快照、手动注释、更新 | A07—A10 |
| tests/v2/idea-conversion.test.js | 状态与转换原子性、重复调用、主题继承 | A25 |
| tests/v2/pdf-geometry.test.js | 页码、旋转、裁切、多行坐标、往返误差 | A12、A13、A16 |
| tests/v2/annotations.test.js | 批注版本、转换去重、扫描手填、来源缺失 | A12—A16 |
| tests/v2/export.test.js | 内容快照、DOCX 关系、PDF 字体及批注结构 | A19—A21 |
| tests/v2/backup-restore.test.js | 一致性、校验失败回退、旧备份、目录迁移 | A22—A24 |
| tests/e2e/create-and-write.spec.js | exe 内点击、输入、保存、重启 | A01、A05、A06 |
| tests/e2e/citation-workflow.spec.js | 主题查找、札记注释、回到原文 | A07—A16 |
| tests/e2e/save-and-exit.spec.js | 输入法、Ctrl+S、冲突、所有关闭入口 | A17、A18 |
| tests/e2e/offline-and-export.spec.js | 断网资源、输出文件、取消保存 | A19—A21、A26、A27 |

视觉验收另记录：宋体／楷体、21 条标记、跨页脚注、长图、中文笔记在第二阅读器显示。不能用 DOM 文本断言替代所有视觉检查。

### 20.1 PRD 逐项追踪表

| 验收 ID | 实施任务 | 最终证据 |
| --- | --- | --- |
| A01 | P1-04—06、P3-02 | 六类录文新增修改及重启记录 |
| A02 | P4-03—04 | 同一录文的两套多分类保存与查询 |
| A03 | P4-01—03、P4-07 | 三层移动、循环拒绝、归属校验 |
| A04 | P4-02、P4-07 | 删除树前后原内容数量一致 |
| A05 | P1-01—03、P1-06 | 三类新建按钮的桌面操作记录 |
| A06 | P5-01—04、P5-07 | 富文本与图片重启后回读 |
| A07 | P6-01—04 | 库内与手动引用的注释及跳转 |
| A08 | P6-03、P6-05、P6-10 | 增删移动、撤销及 21 条以上编号 |
| A09 | P6-06、P6-10 | 来源改动提示、保留与选择更新 |
| A10 | P3-08、P6-07 | 删除源资料后引文与注释快照保留 |
| A11 | P4-05—07 | 一个主题汇总四类内容与去重统计 |
| A12 | P7-03—04、P7-06—08 | 多行高亮、变换截图与重启持久化 |
| A13 | P7-05—08 | 扫描区域框选与笔记读写 |
| A14 | P8-01—03 | 主动转换预填、取消与去重 |
| A15 | P8-02、P8-06—07 | PDF 页码与印刷页码分别显示 |
| A16 | P8-04—07 | 引用回到指定文件页及区域 |
| A17 | P5-05—07、P5-12 | 延迟、冲突、输入法与 Ctrl+S 测试 |
| A18 | P5-08—12、P11-06 | 所有退出入口保存／取消及草稿恢复 |
| A19 | P9-01—04、P9-10 | 可编辑 DOCX、字体与注释检查 |
| A20 | P2-05、P9-05—06、P9-10 | 实际分页 PDF 及页脚／文末注释样件 |
| A21 | P2-03、P9-07—08、P9-11 | 两种阅读器对照、原 PDF 哈希 |
| A22 | P5-04、P10-03、P10-09 | 原图片删除、迁移及恢复后仍可显示 |
| A23 | P3-01—09、P10-09 | 旧库迁移计数、内容及回退报告 |
| A24 | P10-01—09 | 独立目录恢复及来源定位验证 |
| A25 | P6-08—10 | 转长编内容继承、幂等与状态限制 |
| A26 | P2-07、P7-01、P11-05 | 断网首次加载和导出记录 |
| A27 | P11-01—10 | 最终 exe、回归报告及现有启动入口 |

## 21. 可执行命令与脚本契约

### 21.1 当前即可用于实施前基线的 PowerShell 命令

实施中已执行兼容运行时核验、基线、分阶段及全量回归。复跑时先进入现有目录并使用匹配当前 SQLite 的 Node；避免直接使用系统中另一个 Node 版本运行测试。

```powershell
Set-Location -LiteralPath 'C:\Users\<用户名>\Desktop\APP开发'
$wbNode = 'C:\Users\<用户名>\.workbuddy\binaries\node\versions\22.22.2-3\node.exe'
if (-not (Test-Path -LiteralPath $wbNode)) { throw 'Locate a compatible Node runtime first.' }
$env:PATH = (Split-Path -Parent $wbNode) + ';' + $env:PATH
& $wbNode --version
& $wbNode -e "const D=require('better-sqlite3');const d=new D(':memory:');console.log(d.prepare('select 1 as ok').get());d.close()"
if ($LASTEXITCODE -ne 0) { throw 'SQLite runtime check failed.' }
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Record baseline failures before proceeding.' }
npm.cmd run test:desktop
```

基线失败不代表只能停止整个项目：记录原有失败后先定位影响范围；不能未经定位就将失败算作本次通过。上述检查直接验证 native addon，不能仅 require 模块。

### 21.2 已实现的执行脚本

| npm script | 实现位置与职责 | 引入阶段 |
| --- | --- | --- |
| build:frontend | scripts/build-frontend.js：打包入口、复制本地 PDF 资源、产物检查 | P2 |
| test:v2 | scripts/test-v2.js：显式枚举 tests/v2/*.test.js，使用当前兼容 Node，失败退出非零 | P3 |
| test:e2e | 已验证的 Electron 驱动：每次临时数据目录与独立用户配置；不读取真实 data | P2 建基础，之后增加用例 |
| verify:data | scripts/verify-data.js：只读计数、完整性与哈希；必须显式 --data-dir，禁止默认操作真实目录 | P3 |
| test:all | scripts/test-all.js：顺序调度既有 test、test:desktop、test:v2、test:e2e，记录每段退出码 | P11 前完成 |
| build:desktop | 先 build:frontend，再 desktop/build.js；采用 staging 并验证可启动 | P11 |

不要在 Windows npm 脚本里依赖 shell 展开通配符；测试聚合脚本自行枚举文件。端到端与 API 测试分别使用目录，故障注入只能对自己启动的测试进程进行。

### 21.3 新脚本完成后的执行序列

```powershell
# Prerequisite: use the Node runtime configured above.
npm.cmd run build:frontend
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
npm.cmd run test:v2
if ($LASTEXITCODE -ne 0) { throw 'V2 tests failed.' }
npm.cmd run test:e2e
if ($LASTEXITCODE -ne 0) { throw 'Desktop interaction tests failed.' }
npm.cmd run test:all
if ($LASTEXITCODE -ne 0) { throw 'Release checks failed.' }
npm.cmd run build:desktop
if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
```

日常只运行本次改动相关测试；上述全量序列用于候选发布，不要求每改一行都重复。打包后还必须在隔离数据目录打开最终 exe 完成 P11 走查，源码 E2E 不能代替打包版。

启动手工隔离环境时，使用唯一目录设置 `WB_DATA_DIR` 和 `WB_PROFILE_DIR`，并与现有进程区分；确认环境变量确实传给启动进程。测试完关闭自己启动的进程，不结束用户正在使用的其他工作台。

## 22. 失败处理与阶段回退

| 失败位置 | 必须动作 | 不允许的处理 |
| --- | --- | --- |
| native SQLite／Node 不匹配 | 恢复兼容运行时与依赖，内存库验证后继续 | 直接在真实数据库试错；假称 node:sqlite 回退已兼容 pragma/transaction |
| 数据迁移失败 | 事务回滚，保存错误，恢复迁移前副本；调查后重新跑副本 | 删 data 重建；仅创建空库掩盖问题 |
| 旧写作内容无法转换 | 保留原文、记录失败实体，阻止该实体覆盖；补转换适配 | 静默舍弃未知节点或历史注释 |
| 保存冲突／失败 | 保留草稿，显示真实状态，重试或让用户选择版本 | 显示已保存；关闭窗口先杀服务 |
| PDF 位置不准 | 记录页面参数与坐标，修复变换并重新验证 | 依赖某一缩放比例通过后宣称全面支持 |
| PDF 批注跨阅读器不显示 | 修正标准字典、外观与字体；保留原件 | 只画颜色而丢笔记，仍算完成 |
| 分页脚注不符合要求 | 在 P2/P9 修复分页或组件适配，保留阻断项 | 偷换为文末注释或假页脚 |
| 备份恢复／迁移中断 | 保留维护状态，恢复上一完整目录／库，重新建立正确锁 | 启动半恢复数据库；自动覆盖非空目标 |
| 最终 exe 资源缺失 | 修正打包清单重新构建并重测 | 让用户手动开开发服务器作为最终方案 |

## 23. 完成记录与开发交接

每个阶段在 docs/v2/qa-report.md 留一条记录：

```text
阶段／任务 ID：
状态：未开始 / 进行中 / 已完成 / 被具体问题阻塞
修改文件：
关键实现决定：
数据库版本／备份位置：
执行命令及退出码：
桌面操作步骤与实际结果：
截图／导出样件位置：
对应 PRD 验收编号：
已知问题与下一步：
```

阶段交接时先读最新记录和实际代码，不重新执行已完成的数据迁移。对真正影响用户体验的变更更新 PRD，不把技术实现偏差偷偷变为产品决定。

**最终交付物**：更新后的桌面工作台、兼容迁移、源代码及锁文件、完整验收报告、导出样件、使用说明、成套回退说明。所有任务当前均为未执行；本计划不代表功能已经实现或测试已经通过。
