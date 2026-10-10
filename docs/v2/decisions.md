# V2 技术验证与决定

- P1 API 与桌面真实操作测试通过。失败测试先定位：文书夹具缺少 doc_type；补合法输入后保留原断言并通过。
- P2 采用 ProseMirror 结构化文档、PDF.js 本地渲染、docx 原生脚注、Paged.js 分页与 Electron printToPDF、pdf-lib 标准批注。
- P2 三项数据测试和桌面组合验证均通过；样件位于 docs/v2/samples。
- 默认 render_docx.py 因本机无 LibreOffice 失败，已用安装的 Word COM 隐藏实例打开真实 DOCX 并导出 PDF，再由 Poppler 渲染核验；此为渲染工具替代，非降低结构或版面验收。
- 文字高亮与框选在 Poppler 中可见；pypdf 作为独立实现回读中文 Contents 正确。P9 最终标准批注外观与中文 Contents 已通过独立渲染／解析验证；交互式 Acrobat/WPS 笔记面板兼容范围未作保证，详见最终验收报告。
- Paged.js 样件 35 条注释分布在实际页脚；Word 样件 21 条原生脚注分布于 3 页。最终序号按 PRD 圈号规则另做产品级验证。
- 隐藏 Electron 的后台节流使 Playwright 稳定性等待超时；测试关闭背景节流，截图改用原生 capturePage，断言未跳过。
- 依赖精确版本已记录 package.json 与 package-lock.json；所有浏览器依赖和 worker 均本地构建。
