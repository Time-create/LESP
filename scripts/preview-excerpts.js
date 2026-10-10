// 录文集页面预览图（纯静态 HTML，不接入任何真实数据，仅供确认布局）
const fs = require('node:fs');
const path = require('node:path');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>录文集 · 布局预览</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; background:#f6f3ed; color:#2b2724;
         font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
  .topbar { display:flex; align-items:center; gap:18px; height:46px; padding:0 18px;
            background:#fff; border-bottom:1px solid #e2ddd4; }
  .brand { font-size:14px; font-weight:600; letter-spacing:.5px; }
  .navlink { font-size:13px; color:#5a544c; text-decoration:none; }
  .navbtn { background:none; border:none; font:inherit; color:#5a544c; cursor:pointer; padding:4px 2px; }
  .note { background:#fff8e6; border:1px solid #e8d9a8; border-radius:6px;
          padding:8px 12px; margin:12px 18px; font-size:12px; color:#6b5a20; }
  .wrap { display:grid; grid-template-columns:250px minmax(0,1fr); gap:16px; padding:0 18px 18px; }
  .col-tree { background:#fff; border:1px solid #e2ddd4; border-radius:8px; padding:8px 0; align-self:start; }
  .tree-title { font-size:11px; color:#8a8178; padding:4px 12px 8px; }
  .tree-tools { padding:0 12px 8px; display:flex; gap:6px; }
  .btn { font:inherit; font-size:12px; padding:4px 10px; border:1px solid #d8d0c4;
         background:#fff; border-radius:5px; cursor:pointer; }
  .btn:hover { border-color:#a63a28; color:#a63a28; }
  .btn.primary { background:#a63a28; color:#fff; border-color:#a63a28; }
  .btn.primary:hover { background:#8f3021; }
  .tree-row { display:flex; align-items:center; gap:2px; }
  .tree-item { flex:1; text-align:left; background:none; border:none; font:inherit; font-size:13px;
               color:#5a544c; padding:5px 8px; border-radius:4px; cursor:pointer;
               display:flex; align-items:center; gap:6px; }
  .tree-item:hover { background:rgba(166,58,40,.06); }
  .tree-item.on { background:#f5e3de; color:#a63a28; font-weight:600; }
  .cnt { margin-left:auto; font-size:11px; color:#9a9188; font-variant-numeric:tabular-nums; }
  .tree-item.on .cnt { color:#a63a28; }
  .kid { padding-left:18px; }
  .uncls { margin:4px 8px 0; padding:7px 8px; border:1px dashed #d8d0c4; border-radius:5px;
           background:#fbfaf7; }
  .uncls .tree-item { width:100%; }
  .badge-warn { display:inline-block; min-width:16px; text-align:center; font-size:10px;
                background:#e8b04b; color:#fff; border-radius:8px; padding:0 5px; }
  .col-list { background:#fff; border:1px solid #e2ddd4; border-radius:8px; overflow:hidden; }
  .list-head { padding:10px 14px; border-bottom:1px solid #e2ddd4; display:flex; align-items:center; gap:10px; }
  .list-head h2 { margin:0; font-size:14px; font-weight:600; }
  .list-head .sub { font-size:12px; color:#8a8178; }
  .ex { padding:12px 14px; border-bottom:1px solid #f0ece4; }
  .ex:last-child { border-bottom:none; }
  .ex-src { font-size:11px; color:#8a8178; margin-bottom:3px; }
  .ex-src b { color:#6b6157; font-weight:500; }
  .ex-loc { font-size:11px; color:#a63a28; margin-bottom:5px; }
  .ex-text { font-size:13px; color:#2b2724; line-height:1.75; }
  .tags { margin-top:6px; display:flex; gap:5px; flex-wrap:wrap; }
  .tag { font-size:10px; padding:1px 7px; border-radius:9px; background:#eef2f7; color:#4a6785; }
  .tag.t1 { background:#f5e3de; color:#a63a28; }
  .tag.t2 { background:#e9f0e6; color:#4a6b46; }
  .empty { padding:40px 20px; text-align:center; color:#9a9188; font-size:12px; }
  .mark { background:#fff3d6; padding:0 2px; }
  .hint { font-size:11px; color:#9a9188; padding:6px 12px 8px; line-height:1.6; }
</style></head><body>

<div class="topbar">
  <span class="brand">LESP·辑微</span>
  <a class="navlink" href="#">首页总览</a>
  <button class="navbtn">资料库 ▾</button>
  <button class="navbtn">我的写作 ▾</button>
  <button class="navbtn">系统 ▾</button>
</div>

<div class="note">
  <b>这是布局预览图</b>，数据为演示内容。确认后我再写代码。
</div>

<div class="wrap">
  <!-- 左：分类树 -->
  <aside class="col-tree">
    <div class="tree-title">录文分类</div>
    <div class="tree-tools">
      <button class="btn primary">＋ 新建分类</button>
    </div>

    <div class="tree-row"><button class="tree-item on">全部录文<span class="cnt">28</span></button></div>
    <div class="tree-row"><button class="tree-item">未归类<span class="cnt"><span class="badge-warn">3</span></span></button></div>

    <div class="tree-row">
      <span style="width:14px;text-align:center;color:#b5aca1">▾</span>
      <button class="tree-item">家族、地域与跨国网络…<span class="cnt">25</span></button>
    </div>
    <div class="tree-row kid">
      <span style="width:14px;text-align:center;color:#b5aca1">·</span>
      <button class="tree-item">侨批网络与商号<span class="cnt">14</span></button>
    </div>
    <div class="tree-row kid">
      <span style="width:14px;text-align:center;color:#b5aca1">·</span>
      <button class="tree-item">潮汕侨批局档案<span class="cnt">11</span></button>
    </div>

    <div class="tree-row">
      <span style="width:14px;text-align:center;color:#b5aca1">▸</span>
      <button class="tree-item">大二上外国史作业<span class="cnt">0</span></button>
    </div>
    <div class="tree-row">
      <span style="width:14px;text-align:center;color:#b5aca1">▸</span>
      <button class="tree-item">大二外国史作业<span class="cnt">0</span></button>
    </div>

    <div class="hint">
      右键分类可重命名 / 新建子级 / 移动 / 删除。<br>
      录文只能从条目页录入；这里是查阅与归类的地方。
    </div>
  </aside>

  <!-- 右：录文列表 -->
  <div class="col-list">
    <div class="list-head">
      <h2>全部录文</h2>
      <span class="sub">共 28 条 · 跨 4 个条目</span>
    </div>

    <div class="ex">
      <div class="ex-src">来自<b>《近代潮汕侨批网络构建与特征的量化分析——以1936年侨批局登记详情表为证据》</b> ·胡少东</div>
      <div class="ex-loc">第三章 · 页 45</div>
      <div class="ex-text">凡侨批一项，<span class="mark">皆有收汇年月、寄款人、收款人三项</span>，缺一不可。……</div>
      <div class="tags"><span class="tag t1">家族、地域与跨国网络</span><span class="tag t2">潮汕侨批局档案</span></div>
    </div>

    <div class="ex">
      <div class="ex-src">来自 <b>《网络化企业与嵌入性——近代侨批局的制度建构》</b> · 戴一峰</div>
      <div class="ex-loc">绪论 · 页 12</div>
      <div class="ex-text">侨批局既非纯粹的官署，亦非纯然的商号，<span class="mark">其性质介乎二者之间</span>，需从制度史的角度加以把握。</div>
      <div class="tags"><span class="tag t1">家族、地域与跨国网络</span></div>
    </div>

    <div class="ex">
      <div class="ex-src">来自 <b>《宋故朱公墓志铭》</b>（碑刻）</div>
      <div class="ex-loc">碑阴第 7 行</div>
      <div class="ex-text">君讳<span class="mark">克温，字德成</span>，其先世家于……</div>
      <div class="tags"><span class="tag" style="background:#f2f2f0;color:#8a8178">未归类</span></div>
    </div>
  </div>
</div>

</body></html>`;

const out = path.join(__dirname, 'preview-excerpts.html');
fs.writeFileSync(out, html);
console.log('预览已生成:', out);
