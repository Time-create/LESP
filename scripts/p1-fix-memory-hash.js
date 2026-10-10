// P1-1：把三处 sha256 计算从 readFileSync（整份进内存）改为分块同步读
const fs = require('fs');

const edits = [
  ['server/services/attachment-pickup.js',
    "[require('node:crypto').createHash('sha256').update(fs.readFileSync(st.abs)).digest('hex'), info.lastInsertRowid]);",
    '[store.sha256FileSync(st.abs), info.lastInsertRowid]);'],
  ['server/routes/attachments.js',
    "[require('node:crypto').createHash('sha256').update(fs.readFileSync(stored.abs)).digest('hex'),info.lastInsertRowid]);",
    "[require('../services/attachment-store').sha256FileSync(stored.abs),info.lastInsertRowid]);"],
  ['server/services/cnki-sync.js',
    "[crypto.createHash('sha256').update(fs.readFileSync(stagedFile.abs)).digest('hex'), att.lastInsertRowid]);",
    '[attachmentStore.sha256FileSync(stagedFile.abs), att.lastInsertRowid]);']
];

for (const [file, from, to] of edits) {
  const s = fs.readFileSync(file, 'utf8');
  if (!s.includes(from)) { console.log('✘ 未找到待改片段: ' + file); process.exit(1); }
  if (s.includes(to)) { console.log('· 已是目标实现，跳过: ' + file); continue; }
  fs.writeFileSync(file, s.replace(from, to));
  console.log('✔ ' + file);
}

// 复核：不应再有"整份读入算哈希"的写法
console.log('\n--- 复核 ---');
for (const [file] of edits) {
  const s = fs.readFileSync(file, 'utf8');
  const bad = /createHash\('sha256'\)\.update\(fs\.readFileSync/.test(s);
  console.log((bad ? '  [FAIL] ' : '  [OK]   ') + file + ' 无整份读入哈希');
}