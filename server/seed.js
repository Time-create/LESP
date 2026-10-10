// 开发用种子数据：六类模块各 3 条条目，部分条目带摘录。
const db = require('./db');

const ITEMS = [
  {
    module: 'classics', title: '宋会要辑稿', subtitle: '徐松辑',
    status: '整理中',
    fields: { author: '徐松辑', dynasty: '清嘉庆间辑', edition: '中华书局 1957 年影印本', juan: '全 366 卷', volumes: 8, series: '', location: '' },
    excerpts: [
      { locator: '卷一三七 · 食货 · 役法', text: '绍兴十五年，诏两浙路诸县差役，以物力高下为差，凡充役者，给以雇钱。', comment: '此处雇钱标准待与《庆元条法事类》比对。' },
      { locator: '卷一三八 · 食货 · 免役钱', text: '诸县免役钱，岁计其数，以充雇直，余者输之官。', comment: '' }
    ]
  },
  {
    module: 'classics', title: '续资治通鉴长编', subtitle: '李焘撰',
    status: '已录',
    fields: { author: '李焘撰', dynasty: '南宋', edition: '中华书局点校本', juan: '全 520 卷', volumes: 20, series: '', location: '' },
    excerpts: [
      { locator: '卷三六二', text: '元丰八年十一月，罢免役钱，复差役法。', comment: '元丰改制关键节点。' }
    ]
  },
  {
    module: 'classics', title: '庆元条法事类', subtitle: '谢深甫监修',
    status: '未整理',
    fields: { author: '谢深甫监修', dynasty: '南宋', edition: '燕京大学图书馆影印本', juan: '卷四七', volumes: 4, series: '', location: '' },
    excerpts: [
      { locator: '卷四七 · 赋役门', text: '诸充役人，各给雇直，不得辄有抑配。', comment: '' }
    ]
  },
  {
    module: 'inscription', title: '宋故朱公墓志铭', subtitle: '绍兴二十二年',
    status: '已录',
    fields: { era: '绍兴二十二年', gregorian: 1152, writer: '吕祖谦', calligrapher: '朱熹', carver: '', find_place: '婺州金华', keep_place: '浙江省博物馆', material: '石质，高 78 厘米' },
    excerpts: [
      { locator: '志文第 5-7 行', text: '公尝充里正，凡三岁，乡人德之。', comment: '可证基层职役的实际任期。' }
    ]
  },
  { module: 'inscription', title: '吴郡重修大成殿记', subtitle: '淳熙十一年', status: '未整理',
    fields: { era: '淳熙十一年', gregorian: 1184, writer: '范成大', keep_place: '苏州碑刻博物馆', find_place: '苏州' }, excerpts: [] },
  { module: 'inscription', title: '元丰敕牒碑', subtitle: '元丰三年', status: '未整理',
    fields: { era: '元丰三年', gregorian: 1080, keep_place: '中国国家图书馆', find_place: '开封' }, excerpts: [] },

  {
    module: 'document', title: '淳熙三年休宁置产簿', subtitle: '契约',
    status: '整理中',
    fields: { doc_type: '契约', era: '淳熙三年', parties: '汪氏族人', place: '休宁县一都三保', batch: '徽州文书第一批', keeper: '安徽大学徽学研究中心', doc_no: 'HZ-0037', size_material: '纸本，纵 32 厘米' },
    excerpts: [
      { locator: '第 2 叶', text: '一都三保，田叁拾亩，充役田。', comment: '役田设置的地方实例。' }
    ]
  },
  { module: 'document', title: '万历九年汪氏阄书', subtitle: '族谱', status: '未整理',
    fields: { doc_type: '族谱', era: '万历九年', parties: '汪氏', place: '歙县', batch: '徽州文书第二批', keeper: '黄山学院' }, excerpts: [] },
  { module: 'document', title: '乾隆二十三年鱼鳞册', subtitle: '鱼鳞图册', status: '未整理',
    fields: { doc_type: '鱼鳞图册', era: '乾隆二十三年', place: '休宁县', keeper: '安徽省档案馆' }, excerpts: [] },

  { module: 'archive', title: '清代徽州府赋役档案', subtitle: '全宗 12', status: '整理中',
    fields: { fond_no: '12', catalog_no: '3', volume_no: '45', item_no: '7', era: '乾隆三十年至四十年', responsible: '徽州府', keeper: '安徽省档案馆', open_status: '开放', microfilm_no: 'M-1203' },
    excerpts: [{ locator: '第 12 件', text: '本年实征丁银若干，除豁免外，尚欠若干。', comment: '' }] },
  { module: 'archive', title: '民国歙县商会档', subtitle: '全宗 45', status: '未整理',
    fields: { fond_no: '45', catalog_no: '1', volume_no: '8', era: '民国八年至二十年', keeper: '歙县档案馆', open_status: '限制' }, excerpts: [] },
  { module: 'archive', title: '明清歙县田赋清册', subtitle: '全宗 12', status: '未整理',
    fields: { fond_no: '12', catalog_no: '4', volume_no: '21', keeper: '安徽省档案馆', open_status: '开放' }, excerpts: [] },

  { module: 'paper', title: '宋代两浙路役法演变考论', subtitle: '包伟民', status: '已读',
    fields: { author: '包伟民', journal: '历史研究', year_volume: '2018(4)', pages: '45-62', doi: '', keywords: '役法；两浙路', abstract: '本文考察两浙路役法自熙宁至南宋的演变。', source: '手动录入' }, excerpts: [] },
  { module: 'paper', title: '经总制钱与南宋地方财政', subtitle: '汪圣铎', status: '在读',
    fields: { author: '汪圣铎', journal: '文史', year_volume: '2015(2)', keywords: '赋税', abstract: '经总制钱的征收与分配机制。', source: '手动录入' }, excerpts: [] },
  { module: 'paper', title: '南宋物力推排制度再探', subtitle: '黄宽重', status: '未读',
    fields: { author: '黄宽重', journal: '中央研究院历史语言研究所集刊', year_volume: '2012', keywords: '役法', source: '手动录入' }, excerpts: [] },

  { module: 'book', title: '宋代地方财政史研究', subtitle: '包伟民', status: '在读',
    fields: { author: '包伟民', publisher: '上海古籍出版社', year: 2001, series: '南宋史研究丛书', isbn: '9787532529871', edition_no: '第 1 版', progress: '读至第四章' }, excerpts: [] },
  { module: 'book', title: '宋代社会经济史论集', subtitle: '梁庚尧', status: '未读',
    fields: { author: '梁庚尧', publisher: '允晨文化', year: 1997 }, excerpts: [] },
  { module: 'book', title: '明清徽州农村社会与佃仆制', subtitle: '叶显恩', status: '已读',
    fields: { author: '叶显恩', publisher: '安徽人民出版社', year: 1983 }, excerpts: [] }
];

function seed() {
  const nowStr = db.now();
  db.dbTx(() => {
    db.dbRun('DELETE FROM items_fts');
    db.dbRun('DELETE FROM excerpts');
    db.dbRun('DELETE FROM items');
    db.dbRun('DELETE FROM collection_items');
    db.dbRun('DELETE FROM collections');
    db.dbRun('DELETE FROM item_tags');
    db.dbRun('DELETE FROM tags');

    for (const it of ITEMS) {
      const info = db.dbRun(
        'INSERT INTO items (module, title, subtitle, status, fields, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
        [it.module, it.title, it.subtitle || '', it.status || '', JSON.stringify(it.fields || {}), nowStr, nowStr]
      );
      const itemId = info.lastInsertRowid;
      let seq = 0;
      for (const ex of it.excerpts || []) {
        db.dbRun(
          'INSERT INTO excerpts (item_id, locator, text, comment, seq, created_at) VALUES (?,?,?,?,?,?)',
          [itemId, ex.locator || '', ex.text, ex.comment || '', seq++, nowStr]
        );
      }
    }
  });

  const rows = db.dbAll('SELECT id FROM items');
  for (const r of rows) db.syncFts(r.id);
  return rows.length;
}

if (require.main === module) {
  const paths = require('./lib/paths');
  db.initDb(paths.getDataDir());
  const n = seed();
  console.log('已写入种子数据：' + n + ' 条条目');
}

module.exports = { seed, ITEMS };
