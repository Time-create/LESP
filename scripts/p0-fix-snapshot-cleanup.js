// P0-4：render() 的快照必须在**所有**退出路径被清理，
// 否则快速缩放/翻页时（走 generation 提前 return 或渲染被取消）会残留旧页位图，造成图像叠加。
const fs = require('fs');
const p = 'frontend/reader/index.js';
let s = fs.readFileSync(p, 'utf8');
let n = 0;
const must = (c, m) => { if (!c) { console.log('✘ ' + m); process.exit(1); } n++; };

// ① 渲染成功后被新一轮取代（出口 B）：补清理
const b1 = "if(current!==generation)return;const tc=await page.getTextContent();";
const b2 = "if(current!==generation){clearSnapshot();return;}const tc=await page.getTextContent();";
must(s.includes(b1), '未找到出口 B 的 return');
s = s.replace(b1, b2);

// ② 渲染被取消（catch 吞掉 RenderingCancelledException）：同样要清理
const c1 = "catch(e){if(e.name!=='RenderingCancelledException')throw e;}";
const c2 = "catch(e){clearSnapshot();if(e.name!=='RenderingCancelledException')throw e;}";
must(s.includes(c1), '未找到渲染 catch 块');
s = s.replace(c1, c2);

fs.writeFileSync(p, s);
console.log('✔ 快照清理已覆盖全部退出路径，共', n, '处');
