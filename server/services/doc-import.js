// 文档导入解析：把 Markdown / Word 转为编辑器可用的 HTML，并把脚注转为文末注释（路径 A）。
// 依据需求：保留标题层级、引用块、表格；脚注 → 文末注释 + 文内引用标记。
const AdmZip = require('adm-zip');

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

/* ---------------- Markdown ---------------- */
// 够用即可的 Markdown 子集：标题、粗斜下划线、行内代码、代码块、无序/有序列表、引用块、分隔线、链接
function markdownToHtml(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let inCode = false;
  let listType = null;          // 'ul' | 'ol'
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  const closeList = () => { if (listType) { html.push('</' + listType + '>'); listType = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^```/.test(line)) {
      closeList();
      html.push(inCode ? '</pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { html.push(esc(line) + '\n'); continue; }
    if (!line.trim()) { closeList(); continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closeList();
      const level = Math.min(3, m[1].length);      // schema 仅支持 h1–h3，更高级降级
      html.push('<h' + level + '>' + inline(m[2]) + '</h' + level + '>');
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { closeList(); html.push('<hr>'); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) {
      closeList();
      html.push('<blockquote>' + inline(m[1]) + '</blockquote>');
      continue;
    }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      if (listType !== 'ul') { closeList(); html.push('<ul>'); listType = 'ul'; }
      html.push('<li>' + inline(m[1]) + '</li>');
      continue;
    }
    if ((m = line.match(/^\s*\d+[.、]\s+(.*)$/))) {
      if (listType !== 'ol') { closeList(); html.push('<ol>'); listType = 'ol'; }
      html.push('<li>' + inline(m[1]) + '</li>');
      continue;
    }
    closeList();
    html.push('<p>' + inline(line) + '</p>');
  }
  if (inCode) html.push('</code></pre>');
  closeList();
  return html.join('\n');
}

/* ---------------- Word（docx） ---------------- */
const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function attr(tag, name) {
  const m = String(tag).match(new RegExp('w:' + name + '=\"([^\"]*)\"'));
  return m ? m[1] : '';
}
function stripTags(xml) { return String(xml).replace(/<[^>]+>/g, ''); }

/** word/document.xml → HTML；顺带按 w:footnoteReference 顺序收集脚注序号 */
function documentXmlToHtml(xml, images) {
  const bodyMatch = xml.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/);
  const body = bodyMatch ? bodyMatch[1] : xml;
  const blocks = body.match(/<w:p\b[\s\S]*?<\/w:p>|<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];
  const out = [];
  const footnoteSeq = [];
  let fnIndex = 0;

  for (const block of blocks) {
    if (block.startsWith('<w:tbl')) {
      out.push(tableToHtml(block, images));
      continue;
    }
    const style = (block.match(/<w:pStyle\b[^>]*w:val=\"([^\"]+)\"/) || [])[1] || '';
    const runs = runsToHtml(block, images, footnoteSeq);
    const headingLevel = /^(Heading|heading|标题)\s*([1-6])$/.exec(style) ? Math.min(3, Number(RegExp.$2)) : 0;
    if (!runs.replace(/<[^>]+>/g, '').trim() && !footnoteSeq.length) { out.push('<p></p>'); continue; }
    if (headingLevel) out.push('<h' + headingLevel + '>' + runs + '</h' + headingLevel + '>');
    else if (/Quote|引用/i.test(style)) out.push('<blockquote>' + runs + '</blockquote>');
    else out.push('<p>' + runs + '</p>');
    fnIndex += 0;
  }
  return { html: out.join('\n'), footnotes: footnoteSeq };
}

function runsToHtml(paragraph, images, footnoteSeq) {
  const runs = paragraph.match(/<w:r\b[\s\S]*?<\/w:r>|<w:hyperlink\b[\s\S]*?<\/w:hyperlink>/g) || [];
  let html = '';
  for (const run of runs) {
    const inner = run.match(/<w:r\b[\s\S]*?<\/w:r>/) ? run : null;
    const text = (run.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) || []).map((t) => xmlEscape(stripTags(t))).join('');
    const br = /<w:br\b/.test(run);
    const fn = run.match(/<w:footnoteReference\b[^>]*w:id=\"(-?\d+)\"/);
    let piece = xmlEscape('');
    if (text) piece = text;
    if (br) piece += '<br>';
    if (fn) { footnoteSeq.push(Number(fn[1])); piece += '[FN:' + fn[1] + ']'; }
    // 图片
    const blip = run.match(/<a:blip\b[^>]*r:embed=\"(rId\d+)\"/);
    if (blip && images && images[blip[1]]) piece += '<img src="' + images[blip[1]].dataUrl + '" alt="">';
    if (!piece) continue;
    if (/<w:b\b(?![^>]*w:val=\"0\")/.test(run)) piece = '<strong>' + piece + '</strong>';
    if (/<w:i\b(?![^>]*w:val=\"0\")/.test(run)) piece = '<em>' + piece + '</em>';
    if (/<w:u\b/.test(run)) piece = '<u>' + piece + '</u>';
    html += inner || !run.startsWith('<w:hyperlink') ? piece : piece;
  }
  return html;
}

function tableToHtml(tblXml, images) {
  const rows = tblXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
  const body = rows.map((tr) => {
    const cells = tr.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
    return '<tr>' + cells.map((tc) => {
      const paras = tc.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
      const content = paras.map((p) => runsToHtml(p, images, [])).join('<br>');
      return '<td>' + content + '</td>';
    }).join('') + '</tr>';
  }).join('');
  return '<table><tbody>' + body + '</tbody></table>';
}

function parseDocx(buffer, opts = {}) {
  const zip = new AdmZip(buffer);
  const docEntry = zip.getEntry('word/document.xml');
  if (!docEntry) fail('不是有效的 Word 文件（缺少 word/document.xml）');
  const images = {};
  for (const e of zip.getEntries()) {
    if (!/^word\/media\//.test(e.entryName)) continue;
    const ext = (e.entryName.split('.').pop() || 'png').toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) continue;
    images[e.entryName] = {
      dataUrl: 'data:image/' + ext + ';base64,' + e.getData().toString('base64'),
      filename: 'imported-' + path.basename(e.entryName)
    };
  }
  const { html, footnotes: refs } = documentXmlToHtml(docEntry.getData().toString('utf8'), images);

  // 脚注文本（路径 A：转文末注释）
  const fnEntry = zip.getEntry('word/footnotes.xml');
  const notes = [];
  if (fnEntry) {
    const fnXml = fnEntry.getData().toString('utf8');
    const list = fnXml.match(/<w:footnote\b[\s\S]*?<\/w:footnote>/g) || [];
    for (const fn of list) {
      const id = Number((fn.match(/w:id=\"(-?\d+)\"/) || [])[1]);
      if (!Number.isFinite(id) || id < 0) continue;         // 0/1 为分隔符脚注
      const paras = fn.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
      const text = paras.map((p) => (p.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) || []).map((t) => xmlEscape(stripTags(t))).join('')).join(' ').trim();
      if (text) notes.push({ id, text });
    }
  }

  const titleMeta = (opts.title || '').trim();
  return {
    format: 'docx',
    html: replaceFootnoteRefs(html, notes),
    footnotes: notes,
    title: titleMeta,
    images: Object.keys(images).map((k) => images[k].filename)
  };
}

/** 把正文里的 [FN:id] 换成文内引用标记（由前端转成正式引用） */
function replaceFootnoteRefs(html, notes) {
  const map = new Map(notes.map((n) => [String(n.id), n.text]));
  return html.replace(/\[FN:(\d+)\]/g, (m, id) => (map.has(String(id)) ? '<span data-footnote="' + id + '">' + m + '</span>' : ''));
}

function parseMarkdown(buffer, opts = {}) {
  const src = buffer.toString('utf8');
  const html = markdownToHtml(src);
  const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/);
  return { format: 'md', html, footnotes: [], title: (opts.title || (h1 ? stripTags(h1[1]) : '')).trim(), images: [] };
}

function parse(buffer, filename, opts = {}) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  if (ext === 'docx') return parseDocx(buffer, opts);
  if (ext === 'md' || ext === 'markdown') return parseMarkdown(buffer, opts);
  fail('仅支持 .md 与 .docx');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const path = require('node:path');

module.exports = { parse, parseDocx, parseMarkdown, markdownToHtml, documentXmlToHtml };
