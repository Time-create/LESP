// SQLite FTS5 默认 unicode61 分词器不切分中文，连续汉字会被当成一个 token，
// 导致「里正」无法命中「公尝充里正，凡三岁」。
// 解决办法：写入索引时把每个汉字拆成独立 token，查询时对关键词做同样处理并用短语查询，
// 使「里正」匹配顺序相邻的「里」「正」两个 token。非汉字（英文、数字）保持原样。

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

function ftsTokenize(text) {
  let out = '';
  for (const ch of String(text || '')) {
    out += CJK.test(ch) ? ch + ' ' : ch;
  }
  return out;
}

function ftsQuery(keyword) {
  const t = ftsTokenize(keyword).replace(/"/g, ' ').trim();
  if (!t) return null;
  return '"' + t + '"';
}

module.exports = { ftsTokenize, ftsQuery };
