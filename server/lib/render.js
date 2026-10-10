function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function attr(s) {
  return esc(s);
}

// 内嵌到 <script> 中的 JSON 必须转义 < > & ，
// 否则数据里的 </script> 会提前闭合标签，造成 XSS。
function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

module.exports = { esc, attr, jsonForScript };
