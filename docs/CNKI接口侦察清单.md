# CNKI 接口侦察清单与契约记录

> 目的：在写任何解析代码之前，把知网真实接口的行为固定成"契约"。
> 状态：✅ 已完成（无需登录即可验证的部分） ／ ⬜ 待执行（必须有知网登录态）
> 侦察时间：2026-09-29

---

## 一、已完成的部分（我这边实跑的结论）

### 1.1 导出接口：`POST https://kns.cnki.net/dm8/API/GetExport` ✅

**请求**
```
POST https://kns.cnki.net/dm8/API/GetExport
Content-Type: application/x-www-form-urlencoded
Cookie: <知网登录 Cookie>
Referer: https://kns.cnki.net/

filename=<加密ID>&displaymode=GBTREFER,elearning,EndNote&uniplatform=NZKPT
```

**无登录态时的真实响应（已实测，HTTP 403）**
```json
{
  "code": -403,
  "message": "https://kns.cnki.net/verify/home?captchaType=clickWord&ident=754fc1&captchaId=9469d06d-...&returnUrl=iECBDnhr716Q...",
  "time": "2026-09-29 21:53:06.264",
  "tid": "21fc1175e68c4d80a4eb6a86eefeb1d4.410.17906899862630491"
}
```

**结论与代码约定**
| 现象 | 判定 | 处理 |
|---|---|---|
| `code == 1` | 成功 | 解析 `data[]` 中各 `mode` 的文本 |
| `code == -403` 且 `message` 含 `verify/home` | **触发风控（点选文字验证码）** | 立即熔断，停止队列，提示用户。**不得重试、不得尝试绕过** |
| HTTP 401/403 且非上述结构 | 登录态失效 | 提示用户刷新登录态 |

---

### 1.2 检索链路：现有实现已不可靠 ⚠️ ✅（已实测）

现有代码 `server/services/cnki.js` 用的是：
```
GET https://kns.cnki.net/kns8s/search?kw=<关键词>
```

**实测结果**

| 请求方式 | 结果 |
|---|---|
| 极简请求头（仅 UA） | **HTTP 400** `Your browser sent an invalid request.`<br>（WAF 直接拒，说明它连"像不像浏览器"都会校验） |
| 完整浏览器头（UA + Accept + Accept-Language + Referer） | **HTTP 302** → 落地到<br>`https://kns.cnki.net/verify/home?captchaType=blockPuzzle&ident=...&captchaId=...&returnUrl=...` |

两个入口同理：`kns8s/search`、`kns8s/defaultresult/index`、`starter/index` 在无登录态时**全部跳转滑块拼图验证码（blockPuzzle）**。

**这条结论很重要，它直接决定架构：**
1. **只靠"后端 + 粘贴 Cookie"这条路是脆弱的**——即使 Cookie 有效，非浏览器的请求特征仍可能被判风控；Cookie 一旦过期就是验证码页。
2. 因此采集必须在**用户真实浏览器会话内**完成（扩展方案），Cookie 不离开浏览器。
3. 现有 `search()` 的错误判定需要补一条：**响应/落地 URL 含 `/verify/home` 即判为风控**，而不是当成"登录态失效"去提示刷新（两者处理方式不同：风控要退避冷却，失效才要刷新）。

---

### 1.3 首页与入口 ✅

- `https://kns.cnki.net/` → 301 → `https://kns.cnki.net/starter/index`
- `starter/index` 无登录态同样跳 `/verify/home`

---

## 二、（已自动化）侦察工具

第二节原本要手动执行的 5 项检查，现已做成工具，**点一下即可，不用再粘代码**：

| 工具 | 文件 | 适用 |
|---|---|---|
| 用户脚本（推荐，完整版） | `tools\cnki-probe.user.js` | 装了 Tampermonkey / 暴力猴 |
| 书签版（零安装，精简版） | `tools\cnki-probe-bookmarklet.txt` | 不想装任何东西 |

**用户脚本用法**：
1. 浏览器装 Tampermonkey（Edge/Chrome 扩展商店搜"Tampermonkey"）
2. 打开 Tampermonkey 面板 → "添加新脚本" → 把 `cnki-probe.user.js` 的内容全选粘贴进去 → 保存
3. 登录知网 → 打开任意**文献详情页** → 右下角会出现"LESP·辑微 · 知网接口侦察器"面板
4. 点「开始侦察」→ 点「下载 JSON」→ 把 `cnki-contract.json` 放进项目的 `docs` 目录

> 安全说明：脚本用 `@grant none`，只在页面自己的环境里跑，**不读取、不外传你的 Cookie**；
> 只有你点了按钮才发请求，且只发 1 次。代码完全可读，你可自行审计。

---

## 二之二、待你在已登录浏览器里执行的 5 项 ⬜（若不用上面的工具，可手动做）

> 怎么做：用你平常登录知网的浏览器，打开任意一篇知网文献详情页，按 F12 打开控制台，
> 把下面每段代码粘进去回车，把输出贴回本文档对应位置（或另存为 `docs/cnki-contract.json`）。

### 检查 1：详情页隐藏字段是否存在

```js
(() => {
  const g = id => document.querySelector(id)?.value || null;
  return {
    exportId:   g('#export-id'),
    exportUrl:  g('#export-url'),
    dbcode:     g('#paramdbcode'),
    dbname:     g('#paramdbname'),
    filename:   g('#paramfilename'),
    pageUrl:    location.href
  };
})()
```
**记录**：

| 字段 | 值 |
|---|---|
| `#export-id` | ⬜ |
| `#export-url` | ⬜ |
| `#paramdbcode` | ⬜ |
| `#paramdbname` | ⬜ |
| `#paramfilename` | ⬜ |

---

### 检查 2：导出接口在登录态下的真实返回

```js
(async () => {
  const id = document.querySelector('#export-id')?.value;
  const url = document.querySelector('#export-url')?.value || 'https://kns.cnki.net/dm8/API/GetExport';
  const uniplatform = new URLSearchParams(location.search).get('uniplatform') || 'NZKPT';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ filename: id, displaymode: 'GBTREFER,elearning,EndNote', uniplatform })
  });
  const j = await r.json();
  console.log('code =', j.code);
  console.log(JSON.stringify(j).slice(0, 4000));   // 完整内容请右键复制
  return j;
})()
```

**记录**：
- `code`：⬜ （期望 `1`）
- 返回了哪些 `mode`：⬜ （期望含 `EndNote` / `GBTREFER` / `elearning`）
- 把完整 JSON 存为：`docs/cnki-contract.json` ⬜

---

### 检查 3：列表页批量 ID 是否等于详情页 `#export-id`（决定能否批量）

在**搜索结果页**执行：
```js
(() => {
  const boxes = [...document.querySelectorAll('.result-table-list tbody input.cbItem')];
  return { count: boxes.length, first3: boxes.slice(0,3).map(b => b.value) };
})()
```
**记录**：条数 ⬜ ；前 3 个值 ⬜
**判定**：与检查 1 的 `#export-id` 格式一致（同为加密串）→ 可批量导出，无需逐篇打开详情页。

---

### 检查 4：PDF 下载链接形态

在详情页执行：
```js
(() => {
  const pdf = document.querySelector('a#pdfDown');
  const caj = document.querySelector('a#cajDown');
  const all = [...document.querySelectorAll('a')]
    .filter(a => /download|pdfDown|cajDown/i.test(a.href || ''))
    .map(a => ({ text: a.innerText.trim().slice(0,20), href: a.href }));
  return { pdfDown: pdf?.href || null, cajDown: caj?.href || null, candidates: all.slice(0, 8) };
})()
```
**记录**：`a#pdfDown` 的 href ⬜ ；是否含 `bar.cnki.net/.../order` ⬜
**判定**：
- href 形如 `.../KNS8/download?...` → 可尝试追加 `&dflag=pdfdown` 强制 PDF
- href 形如 `bar.cnki.net/bar/download/order?id=` → **文献传递流程，不是直链**，不可下载

---

### 检查 5：参考文献的加载方式

在详情页打开 Network 面板，筛选 XHR/Fetch，点击页面上的"参考文献"区域，观察：
- 是否有新请求？请求 URL 是什么？⬜
- 还是内容本来就写在初始 HTML 里（DOM 直出）？⬜

**记录结论**：⬜ XHR 接口 ／ ⬜ DOM 直出
若为 XHR，请把该请求 URL 记到 `docs/cnki-contract.json` 的 `referencesEndpoint` 字段。

---

## 三、契约文件模板（拿到真实数据后填）

保存为 `docs/cnki-contract.json`，后续解析器和单元测试都以此为基准：

```json
{
  "capturedAt": "2026-09-__T__:__:__+08:00",
  "exportApi": {
    "url": "https://kns.cnki.net/dm8/API/GetExport",
    "method": "POST",
    "body": "filename=<ID>&displaymode=GBTREFER,elearning,EndNote&uniplatform=NZKPT",
    "successCode": 1,
    "riskControlCode": -403,
    "modes": ["EndNote", "GBTREFER", "elearning"]
  },
  "sampleEndNote": "%A 作者\n%T 题名\n%J 刊名\n%D 2026\n%R 10.xxxx/xxx\n%K 关键词\n%X 摘要\n",
  "detailPageSelectors": {
    "exportId": "#export-id",
    "exportUrl": "#export-url",
    "dbcode": "#paramdbcode",
    "dbname": "#paramdbname",
    "filename": "#paramfilename",
    "affiliation": "",
    "fund": "",
    "citedCount": ""
  },
  "searchPageSelectors": {
    "rowCheckbox": ".result-table-list tbody input.cbItem",
    "title": "td.name a.fz14",
    "author": "td.author",
    "source": "td.source",
    "date": "td.date"
  },
  "fulltext": {
    "pdfLinkSelector": "a#pdfDown",
    "cajLinkSelector": "a#cajDown",
    "pdfForceParam": "&dflag=pdfdown",
    "notDirectLinkPattern": "bar.cnki.net/bar/download/order",
    "thesisPdfHint": "kcms2/article/abstract?v= 版或 oversea.cnki.net 域名"
  },
  "referencesEndpoint": "",
  "riskControl": {
    "verifyPath": "/verify/home",
    "captchaTypes": ["clickWord", "blockPuzzle"],
    "action": "熔断冷却，不重试不绕过"
  }
}
```

---

## 四、给客户端实现的判定规则（侦察结论的直接落地）

| 信号 | 判定 | 动作 |
|---|---|---|
| 导出接口 `code == 1` | 成功 | 解析入库 |
| 导出接口 `code == -403` 且 message 含 `verify/home` | 风控 | **熔断**，冷却 ≥30 分钟，提示用户 |
| 页面请求落地 URL 含 `/verify/home` | 风控 | 同上 |
| HTTP 401/403 且无验证码结构 | 登录态失效 | 提示刷新登录态 |
| 下载响应前 5 字节不是 `%PDF-`（且非 CAJ 头） | 下载到的是登录页/错误页 | 判失败，不落盘 |
| 下载链接匹配 `bar.cnki.net/.../order` | 文献传递 | 标记"需文献传递"，不尝试下载 |

---

## 五、下一步

把第二节 5 项跑完、把 `docs/cnki-contract.json` 填好，我就能据此写：
1. EndNote/RefWorks 格式解析器（照真实样例写，不猜字段）
2. 详情页 DOM 补充字段的抽取规则
3. 全文下载器与状态机
4. 对应的单元测试 fixture（用你贴的真实响应当测试数据）
