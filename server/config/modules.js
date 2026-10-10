// 六类资料模块的元信息。脚注模板中的 {xxx} 取自条目字段或摘录定位。
const MODULES = {
  classics: {
    key: 'classics',
    name: '古籍史料',
    route: '/sources/classics',
    group: 'sources',
    statuses: ['未整理', '整理中', '已录'],
    footnote: '《{title}》{locator}，{edition}。'
  },
  inscription: {
    key: 'inscription',
    name: '碑刻史料',
    route: '/sources/inscriptions',
    group: 'sources',
    statuses: ['未整理', '整理中', '已录'],
    footnote: '{title}，{era|立}，{keep_place}。'
  },
  document: {
    key: 'document',
    name: '文书史料',
    route: '/sources/documents',
    group: 'sources',
    statuses: ['未整理', '整理中', '已录'],
    footnote: '《{title}》，{doc_type}，{place}，{keeper}。'
  },
  archive: {
    key: 'archive',
    name: '档案史料',
    route: '/sources/archives',
    group: 'sources',
    statuses: ['未整理', '整理中', '已录'],
    footnote: '{keeper}，{fond_no}-{catalog_no}-{volume_no}，{title}。'
  },
  paper: {
    key: 'paper',
    name: '研究论文',
    route: '/library/papers',
    group: 'library',
    statuses: ['未读', '在读', '已读'],
    footnote: '{author}《{title}》，《{journal}》{year_volume}。'
  },
  book: {
    key: 'book',
    name: '研究著作',
    route: '/library/books',
    group: 'library',
    statuses: ['未读', '在读', '已读'],
    footnote: '{author}《{title}》，{publisher}，{year}，{locator|页}。'
  }
};

const MODULE_KEYS = Object.keys(MODULES);

function isModule(key) {
  return Object.prototype.hasOwnProperty.call(MODULES, key);
}

// 分类体系覆盖的栏目：六类资料条目 + 长编 + 札记。
// 长编(compilations)与札记(notes)是独立表，不在 items 里，因此单列一份供分类模块使用。
const WRITING_MODULES = {
  compilation: { key: 'compilation', name: '史料长编', route: '/writing/compilations', table: 'compilations', link: 'collection_compilations', linkColumn: 'compilation_id' },
  note: { key: 'note', name: '读书札记', route: '/writing/notes', table: 'notes', link: 'collection_notes', linkColumn: 'note_id' }
};
const CLASSIFY_MODULES = Object.assign({}, MODULES, WRITING_MODULES);
const CLASSIFY_KEYS = Object.keys(CLASSIFY_MODULES);

function isClassifyModule(key) {
  return Object.prototype.hasOwnProperty.call(CLASSIFY_MODULES, key);
}

module.exports = { MODULES, MODULE_KEYS, isModule, WRITING_MODULES, CLASSIFY_MODULES, CLASSIFY_KEYS, isClassifyModule };
