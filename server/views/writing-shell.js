const {esc,jsonForScript}=require('../lib/render');
// 需要走「长编式」外壳的写作类型（含导出 Markdown、脚注格式）
const COMPILATION_LIKE={compilation:1,historyPaper:1};
function shell(kind,id){const labels={note:'札记',idea:'灵感',compilation:'长编',historyPaper:'史学论文'};const isComp=!!COMPILATION_LIKE[kind];return `<div class="page-head"><h1>编辑${esc(labels[kind]||kind)}</h1><div><span id="save-state" role="status">正在加载</span> <button id="writing-save" class="primary">保存 Ctrl+S</button><button id="writing-delete">删除</button></div></div>
 <div class="writing-meta"><label>标题<input id="writing-title" aria-label="标题"></label><label id="writing-status-label">状态<select id="writing-status"></select></label><label id="writing-style-label">注释格式<select id="writing-style"><option value="footer">页下注（导出）</option><option value="inline">夹注</option></select></label><button id="writing-themes">选择主题</button><button id="writing-links">关联资料</button><span id="writing-theme-label"></span></div>
 <label id="writing-next-label">下一步<input id="writing-next" aria-label="下一步"></label><div id="draft-banner"></div>
 <div id="writing-toolbar" class="writing-toolbar"></div><div class="writing-surface"><div id="wb-editor"></div></div><section id="writing-notes"><h2>文末注释</h2><div id="citation-list"></div></section>
 <div class="writing-footer">${isComp?`<a href="${kind==='compilation'?'/api/compilations':'/api/history-papers'}/${Number(id)}/export" id="export-markdown">导出 Markdown</a>`:''}<button id="export-word">导出 Word</button><button id="export-pdf">导出 PDF</button><button id="idea-convert" hidden>转为长编</button><span id="export-state"></span></div>
 <script>window.__WRITING__=${jsonForScript({kind,id:Number(id)})};</script><link rel="stylesheet" href="/static/css/editor.css"><script defer src="/static/dist/editor.js"></script>`;}
module.exports={shell};
