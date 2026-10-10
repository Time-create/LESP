const { Schema } = require('prosemirror-model');
const { addListNodes } = require('prosemirror-schema-list');
const nodes = {
  doc: { content: 'block+' },
  paragraph: { content: 'inline*', group: 'block', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
  // 表格：docx 导入需要保留表格结构（V4）
  table: { content: 'table_row+', group: 'block', isolating: true, defining: true, parseDOM: [{ tag: 'table' }], toDOM: () => ['table', ['tbody', 0]] },
  table_row: { content: '(table_cell | table_header)+', parseDOM: [{ tag: 'tr' }], toDOM: () => ['tr', 0] },
  table_cell: { content: 'block+', attrs: { colspan: { default: 1 }, rowspan: { default: 1 } }, isolating: true, parseDOM: [{ tag: 'td', getAttrs: dom => ({ colspan: Number(dom.getAttribute('colspan') || 1), rowspan: Number(dom.getAttribute('rowspan') || 1) }) }], toDOM: n => ['td', { colspan: n.attrs.colspan > 1 ? n.attrs.colspan : null, rowspan: n.attrs.rowspan > 1 ? n.attrs.rowspan : null }, 0] },
  table_header: { content: 'block+', attrs: { colspan: { default: 1 }, rowspan: { default: 1 } }, isolating: true, defining: true, parseDOM: [{ tag: 'th', getAttrs: dom => ({ colspan: Number(dom.getAttribute('colspan') || 1), rowspan: Number(dom.getAttribute('rowspan') || 1) }) }], toDOM: n => ['th', { colspan: n.attrs.colspan > 1 ? n.attrs.colspan : null, rowspan: n.attrs.rowspan > 1 ? n.attrs.rowspan : null }, 0] },
  heading: { attrs: { level: { default: 1 } }, content: 'inline*', group: 'block', defining: true, parseDOM: [1,2,3].map(level => ({ tag: 'h' + level, attrs: { level } })), toDOM: n => ['h' + n.attrs.level, 0] },
  text: { group: 'inline' },
  hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
  quote_block: { attrs: { citationId: { default: null } }, content: 'inline*', group: 'block', defining: true, parseDOM: [{ tag: 'blockquote', getAttrs: el => ({ citationId: el.dataset.citationId || null }) }], toDOM: n => ['blockquote', { 'data-citation-id': n.attrs.citationId || '' }, 0] },
  analysis_block: { content: 'inline*', group: 'block', parseDOM: [{ tag: 'aside.analysis' }], toDOM: () => ['aside', { class: 'analysis' }, 0] },
  citation_anchor: { inline: true, group: 'inline', atom: true, attrs: { citationId: {} }, parseDOM:[{tag:'sup[data-citation-id]',getAttrs:el=>({citationId:el.dataset.citationId})}],toDOM: n => ['sup', { 'data-citation-id': n.attrs.citationId }, '注'] },
  image: { group: 'block', atom: true, attrs: { resourceId: {}, width: { default: 480 }, caption: { default: '' } }, toDOM: n => ['figure', ['img', { src: '/api/resources/' + encodeURIComponent(n.attrs.resourceId) + '/file', width: n.attrs.width }], ['figcaption', n.attrs.caption]] }
};
const initial = new Schema({ nodes, marks: {
  bold: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
  italic: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
  underline: { parseDOM: [{ tag: 'u' }], toDOM: () => ['u', 0] }
} });
const schema = new Schema({ nodes: addListNodes(initial.spec.nodes, 'paragraph block*', 'block'), marks: initial.spec.marks });
function emptyDoc() { return { type: 'doc', content: [{ type: 'paragraph' }] }; }
function textDoc(text = '') { return { type: 'doc', content: String(text).split('\n').map(line => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) }; }
function validateDoc(json) { const doc = schema.nodeFromJSON(json); doc.check(); return doc; }
module.exports = { schema, emptyDoc, textDoc, validateDoc };
