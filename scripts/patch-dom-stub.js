// 复合选择器匹配：支持 tag / .class / [attr] / [attr="value"] 组合
function matches(el, sel) {
  const tokens = sel.match(/^[a-zA-Z][a-zA-Z0-9]*|\.[-\w]+|\[[^\]]+\]/g);
  if (!tokens) return false;
  for (const t of tokens) {
    if (t.startsWith('.')) {
      if (!String(el.attrs.class || '').split(/\s+/).includes(t.slice(1))) return false;
    } else if (t.startsWith('[')) {
      const m = t.slice(1, -1).match(/^([-\w]+)(?:=["']?([^"'\]]*)["']?)?$/);
      if (!m) return false;
      const v = el.attrs[m[1]];
      if (v === undefined) return false;
      if (m[2] !== undefined && String(v) !== m[2]) return false;
    } else {
      if (el.tagName !== t.toUpperCase()) return false;
    }
  }
  return true;
}