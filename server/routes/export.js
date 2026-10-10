const express = require('express');
const db = require('../db');
const { MODULES } = require('../config/modules');
const { fieldsOf } = require('../config/field-schema');

const router = express.Router();

function parseFields(raw) {
  try {
    return typeof raw === 'object' ? raw : JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
}

// RIS：仅导出研究论文与研究著作
router.get('/ris', (req, res) => {
  const rows = db.dbAll("SELECT * FROM items WHERE module IN ('paper','book') ORDER BY id");
  const lines = [];
  for (const r of rows) {
    const f = parseFields(r.fields);
    if (r.module === 'paper') {
      lines.push('TY  - JOUR');
      if (f.author) lines.push('AU  - ' + f.author);
      lines.push('TI  - ' + r.title);
      if (f.journal) lines.push('JO  - ' + f.journal);
      const y = String(f.year_volume || '').match(/(\d{4})/);
      if (y) lines.push('PY  - ' + y[1]);
      if (f.pages) lines.push('SP  - ' + f.pages);
      if (f.keywords) lines.push('KW  - ' + f.keywords);
      if (f.abstract) lines.push('AB  - ' + f.abstract);
      if (f.doi) lines.push('DO  - ' + f.doi);
    } else {
      lines.push('TY  - BOOK');
      if (f.author) lines.push('AU  - ' + f.author);
      lines.push('TI  - ' + r.title);
      if (f.publisher) lines.push('PB  - ' + f.publisher);
      if (f.year) lines.push('PY  - ' + f.year);
      if (f.isbn) lines.push('SN  - ' + f.isbn);
    }
    lines.push('ER  - ');
    lines.push('');
  }
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''library.ris");
  res.type('application/x-research-info-systems').send('\uFEFF' + lines.join('\n'));
});

// CSV：全库条目
router.get('/csv', (req, res) => {
  const rows = db.dbAll('SELECT * FROM items ORDER BY module, id');
  const head = ['id', '模块', '标题', '副标题', '状态'];
  const allKeys = [];
  for (const m of Object.keys(MODULES)) {
    for (const f of fieldsOf(m)) {
      if (!allKeys.includes(f.key)) allKeys.push(f.key);
    }
  }
  const header = head.concat(allKeys).join(',');
  const body = rows.map((r) => {
    const f = parseFields(r.fields);
    const base = [r.id, MODULES[r.module] ? MODULES[r.module].name : r.module, r.title, r.subtitle, r.status];
    const vals = allKeys.map((k) => (f[k] == null ? '' : String(f[k])));
    return base.concat(vals).map(csvCell).join(',');
  });
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''library.csv");
  res.type('text/csv').send('\uFEFF' + [header].concat(body).join('\n'));
});

function csvCell(v) {
  const s = String(v == null ? '' : v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

module.exports = router;
