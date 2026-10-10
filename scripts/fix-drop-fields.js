// 修正 drop-import.js 的三处正则/取值问题
const fs = require('fs');
const p = 'public/js/drop-import.js';
let s = fs.readFileSync(p, 'utf8');
let n = 0;

// ① 改为非捕获组后，取值索引应为 [1]（原来取 [2] 得到 undefined）
if (s.includes('if (loc) meta.location = loc[2];')) {
  s = s.replace('if (loc) meta.location = loc[2];', 'if (loc) meta.location = loc[1];');
  n++;
}
// ② 朝代必须后接「朝/代/时期/年」，否则会匹配到「公元」里的「元」
const dynLine = s.split('\n').find((l) => l.includes('const dyn = text.match'));
if (dynLine) {
  s = s.replace(dynLine, "        const dyn = text.match(/(?:^|[\\s，。、：:（）(])(北宋|南宋|五代|战国|先秦|宋|元|明|清|汉|唐|晋|魏|隋|辽|金)(?=\\s*[朝代时期年])/m);");
  n++;
}
// ③ 公元纪年放宽到 11xx（1133 这类），并去掉「公元」前缀
const gregLine = s.split('\n').find((l) => l.includes('const greg = text.match'));
if (gregLine) {
  s = s.replace(gregLine, "        const greg = text.match(/(?:公元)?((?:1[0-9]|20)\\d{2})\\s*年?/);");
  n++;
}
const gregSet = s.split('\n').find((l) => l.includes('meta.gregorian ='));
if (gregSet) {
  s = s.replace(gregSet, "        if (greg) meta.gregorian = greg[0].replace(/公元/, '');");
  n++;
}

fs.writeFileSync(p, s);
console.log('✔ 共修正', n, '处');
