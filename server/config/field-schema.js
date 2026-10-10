// 六类模块的字段定义（单一数据源）。
// list=true 的字段会显示在条目列表副标题位置；required=true 为必填。
const FIELD_SCHEMA = {
  classics: [
    { key: 'author', label: '作者／编者', type: 'text', required: false, list: true },
    { key: 'dynasty', label: '朝代', type: 'text', required: false, list: true },
    { key: 'edition', label: '版本', type: 'text', required: false, list: true },
    { key: 'juan', label: '卷次', type: 'text', required: false, list: false },
    { key: 'volumes', label: '册数', type: 'number', required: false, list: false },
    { key: 'series', label: '丛书', type: 'text', required: false, list: false },
    { key: 'location', label: '藏地／索书号', type: 'text', required: false, list: false }
  ],
  inscription: [
    { key: 'era', label: '立碑年代', type: 'text', required: false, list: true },
    { key: 'gregorian', label: '公元纪年', type: 'number', required: false, list: true },
    { key: 'writer', label: '撰者', type: 'text', required: false, list: false },
    { key: 'calligrapher', label: '书者', type: 'text', required: false, list: false },
    { key: 'carver', label: '刻工', type: 'text', required: false, list: false },
    { key: 'find_place', label: '出土地', type: 'text', required: false, list: false },
    { key: 'keep_place', label: '现藏地', type: 'text', required: false, list: true },
    { key: 'material', label: '材质形制', type: 'text', required: false, list: false }
  ],
  document: [
    { key: 'doc_type', label: '文书类型', type: 'enum', required: true, list: true,
      options: ['契约', '账册', '诉状', '族谱', '鱼鳞图册', '书信', '其他'] },
    { key: 'era', label: '年代', type: 'text', required: false, list: true },
    { key: 'parties', label: '当事人', type: 'text', required: false, list: false },
    { key: 'place', label: '地点', type: 'text', required: false, list: true },
    { key: 'batch', label: '所属批次／宗族', type: 'text', required: false, list: false },
    { key: 'keeper', label: '收藏单位', type: 'text', required: false, list: false },
    { key: 'doc_no', label: '档号', type: 'text', required: false, list: false },
    { key: 'size_material', label: '尺寸材质', type: 'text', required: false, list: false }
  ],
  archive: [
    { key: 'fond_no', label: '全宗号', type: 'text', required: false, list: true },
    { key: 'catalog_no', label: '目录号', type: 'text', required: false, list: false },
    { key: 'volume_no', label: '卷号', type: 'text', required: false, list: true },
    { key: 'item_no', label: '件号', type: 'text', required: false, list: false },
    { key: 'era', label: '形成年代', type: 'text', required: false, list: true },
    { key: 'responsible', label: '责任者', type: 'text', required: false, list: false },
    { key: 'keeper', label: '藏地（档案馆）', type: 'text', required: false, list: true },
    { key: 'open_status', label: '开放状态', type: 'enum', required: false, list: false,
      options: ['开放', '限制', '未开放'] },
    { key: 'microfilm_no', label: '缩微号／电子号', type: 'text', required: false, list: false }
  ],
  paper: [
    { key: 'author', label: '作者', type: 'text', required: false, list: true },
    { key: 'affiliation', label: '作者单位', type: 'text', required: false, list: false },
    { key: 'journal', label: '期刊／集刊', type: 'text', required: false, list: true },
    { key: 'year_volume', label: '年卷期', type: 'text', required: false, list: true },
    { key: 'pages', label: '页码', type: 'text', required: false, list: false },
    { key: 'doi', label: 'DOI', type: 'text', required: false, list: false },
    { key: 'issn', label: 'ISSN', type: 'text', required: false, list: false },
    { key: 'cn_number', label: 'CN 号', type: 'text', required: false, list: false },
    { key: 'fund', label: '基金', type: 'text', required: false, list: false },
    { key: 'keywords', label: '关键词', type: 'text', required: false, list: false },
    { key: 'abstract', label: '摘要', type: 'textarea', required: false, list: false },
    { key: 'source', label: '来源', type: 'text', required: false, list: false }
  ],
  book: [
    { key: 'author', label: '作者', type: 'text', required: false, list: true },
    { key: 'publisher', label: '出版社', type: 'text', required: false, list: true },
    { key: 'year', label: '出版年', type: 'number', required: false, list: true },
    { key: 'series', label: '丛书', type: 'text', required: false, list: false },
    { key: 'isbn', label: 'ISBN', type: 'text', required: false, list: false },
    { key: 'edition_no', label: '版次', type: 'text', required: false, list: false },
    { key: 'progress', label: '阅读进度', type: 'text', required: false, list: false }
  ]
};

// 自定义字段保存在 settings 表（key: custom_fields_<module>），第一版仅支持文本类
function customFields(module) {
  try {
    const db = require('../db');
    const row = db.dbGet('SELECT value FROM settings WHERE key = ?', ['custom_fields_' + module]);
    if (!row) return [];
    const arr = JSON.parse(row.value);
    if (!Array.isArray(arr)) return [];
    return arr.map((f) => ({
      key: String(f.key || ''),
      label: String(f.label || f.key || ''),
      type: 'text',
      required: false,
      list: false,
      custom: true
    })).filter((f) => f.key);
  } catch (e) {
    return [];
  }
}

function fieldsOf(module) {
  const base = FIELD_SCHEMA[module] || [];
  return base.concat(customFields(module));
}

function builtinFields(module) {
  return FIELD_SCHEMA[module] || [];
}

function requiredKeys(module) {
  return fieldsOf(module).filter((f) => f.required).map((f) => f.key);
}

module.exports = { FIELD_SCHEMA, fieldsOf, builtinFields, customFields, requiredKeys };
