// 阶段 5：PDF 拖入导入扩展到 论文/著作/古籍/碑刻/文书 五栏目
//  - 字段按目标栏目的字段表自动映射（史料三类从首页正则提取朝代/年代/藏地/档号等）
//  - 拖到左栏分类节点 → 直接归入该分类；拖到空白处 → 弹窗多选
(function () {
  const module = window.__MODULE__;
  // 六类资料模块全部支持（archive 曾在初版遗漏，导致档案史料页拖入永远无反应）
  const ALLOWED = ['book', 'paper', 'classics', 'inscription', 'document', 'archive'];
  const enabled = ALLOWED.indexOf(module) >= 0;

  // 诊断出口：任何时候都能在控制台查看本页为何不能拖入
  const diag = { module: module || null, enabled, reason: enabled ? '' : '栏目不在支持范围', listeners: [] };
  window.__dropImport = diag;

  if (!enabled) {
    // 静默 return 会让人以为「拖拽坏了」：改为在控制台说明原因
    if (window.console && console.info) console.info('[辑微] 本页不支持拖入导入 PDF：' + diag.reason + '（当前模块 ' + (module || '未知') + '）');
    return;
  }

  const LABEL = { book: '研究著作', paper: '研究论文', classics: '古籍史料', inscription: '碑刻史料', document: '文书史料', archive: '档案史料' };
  let dragDepth = 0;

  // 判定「拖入的是文件」：不只依赖 types。
  // 某些平台/容器下 types 不含 'Files'，但 items/files 里有文件；三重判定更稳。
  /** 新建条目的默认状态：史料三类「未整理」，论文/著作「未读」 */
  function defaultStatus(mod) {
    if (mod === 'classics' || mod === 'inscription' || mod === 'document' || mod === 'archive') return '未整理';
    return '未读';
  }

  function filesOf(dt) {
    if (!dt) return [];
    if (dt.files && dt.files.length) return [...dt.files];
    if (dt.items && dt.items.length) {
      return [...dt.items].filter((i) => i.kind === 'file').map((i) => (i.getAsFile ? i.getAsFile() : null)).filter(Boolean);
    }
    return [];
  }
  const hasFiles = (e) => {
    const dt = e && e.dataTransfer;
    if (!dt) return false;
    if ([...(dt.types || [])].includes('Files')) return true;
    if (dt.files && dt.files.length) return true;
    return !!(dt.items && [...dt.items].some((i) => i.kind === 'file'));
  };

  // 探针：任何 drag 事件（哪怕识别不出文件）都让全屏提示出现，并显示已收到的次数。
  // 这样不必打开控制台就能判断「平台到底有没有把拖放交给页面」。
  function showHint(text) {
    let hint = document.getElementById('drop-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'drop-hint';
      document.body.appendChild(hint);
    }
    hint.textContent = text;
    hint.hidden = false;
  }
  function dragHintText() {
    const seen = diag.dragSeen || 0;
    return '松开鼠标：导入该 PDF 为' + LABEL[module] + '条目（已收到 ' + seen + ' 次拖放）';
  }

  const hideHint = () => { const h = document.getElementById('drop-hint'); if (h) h.hidden = true; };

  // —— 拖放监听 ——
  // 改为在 window 上以**捕获阶段**监听：早于任何元素 handler，
  // 避免子元素调用 stopPropagation 或默认行为未阻止时收不到 drop。
  const onDragEnter = (e) => {
    if (isInternalDrag(e)) return;                 // 拖的是页面内元素，放行给对应脚本
    if (!hasFiles(e)) return;                      // 只在拖文件时提示导入
    dragDepth += 1;
    e.preventDefault();
    diag.dragSeen = (diag.dragSeen || 0) + 1;
    showHint(dragHintText());
  };
  const onDragOver = (e) => {
    if (isInternalDrag(e)) return;
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    diag.dragOver = (diag.dragOver || 0) + 1;
    showHint(dragHintText());
  };
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) hideHint();
  };
  const onDrop = async (e) => {
    if (isInternalDrag(e)) return;
    diag.dropSeen = (diag.dropSeen || 0) + 1;
    if (!hasFiles(e)) { return; }
    e.preventDefault();
    e.stopPropagation();
    if (e.__dropImportHandled) return;   // window 捕获已处理过
    e.__dropImportHandled = true;
    dragDepth = 0;
    hideHint();
    await handleFiles(filesOf(e.dataTransfer));
  };
  // 内部拖拽（条目归类、分类树排序）不是拖文件，不应触发导入遮罩
  const INTERNAL_DRAG = ['application/x-lesp-item', 'application/x-lesp-collection'];
  const isInternalDrag = (e) => {
    const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
    return INTERNAL_DRAG.some((t) => types.includes(t));
  };

  const CAPTURE = { capture: true };
  window.addEventListener('dragenter', onDragEnter, CAPTURE);
  window.addEventListener('dragover', onDragOver, CAPTURE);
  window.addEventListener('dragleave', onDragLeave, CAPTURE);
  window.addEventListener('drop', onDrop, CAPTURE);
  // 兜底：部分环境下 window 捕获收不到时，document 冒泡再试一次（同一事件只会命中一次处理）
  document.addEventListener('drop', (e) => { if (!e.__dropImportHandled) onDrop(e); });


  /**
   * 导入入口：拖拽与「点击选择」共用同一条链路。
   * 一次拖入多个 PDF 时逐个导入：每个文件建一个条目并挂上自己的原件附件。
   * 单个文件沿用 V3 行为（导入后跳到该条目）；多个文件全部处理完停在列表页。
   */
  async function handleFiles(files) {
    diag.lastRun = { total: (files || []).length, at: new Date().toISOString() };
    const pdfs = (files || []).filter((f) => /\.pdf$/i.test(f.name));
    if (!pdfs.length) {
      if ((files || []).length && window.toast) toast('只支持拖入 PDF 文件');
      return;
    }
    if (!window.FormData) { if (window.toast) toast('当前环境不支持文件上传'); return; }

    const results = [];
    for (let i = 0; i < pdfs.length; i += 1) {
      if (pdfs.length > 1) toast('正在导入 ' + (i + 1) + '/' + pdfs.length + '：' + pdfs[i].name);
      results.push(await importOne(pdfs[i]));       // 单个失败不影响后续
    }

    // 无论 1 个还是 N 个，都停在列表页并刷新（不跳转到新条目）
    const ok = results.filter((r) => r && r.ok).length;
    const fail = results.length - ok;
    if (window.toast) {
      if (pdfs.length === 1) {
        if (ok) toast('已导入：' + (results[0].title || '') + '，已挂上原件附件');
        else toast('导入失败：' + (results[0] && results[0].title ? '「' + results[0].title + '」未能创建' : ''));
      } else {
        toast('已导入 ' + ok + ' 个条目' + (fail ? '，' + fail + ' 个失败' : '') + '（均已挂上原件附件）');
      }
    }
    if (ok) location.reload();
  }

  /** 导入单个 PDF：解析 → 建条目 → 挂原件；返回 { ok, id, title } */
  async function importOne(file) {
    const meta = await parsePdf(file);
    const baseName = file.name.replace(/\.pdf$/i, '');
    const title = cleanTitle(meta.title || baseName);
    const guess = guessFromTitle(meta.title || '');
    const fields = mapFields(module, meta, guess);

    let created = null;
    try {
      created = await api('/api/items', {
        method: 'POST',
        body: { module, title, subtitle: fields.author || '', status: defaultStatus(module), fields }
      });
    } catch (err) {
      if (window.toast) toast('「' + title + '」创建失败：' + err.message);
      return { ok: false, title };
    }

    // 原件无损存入附件库
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const up = await fetch('/api/attachments/upload?item_id=' + created.id, { method: 'POST', body: fd });
      if (!up.ok) {
        const t = await up.text();
        if (window.toast) toast('「' + title + '」已建条目，但附件上传失败：' + t.slice(0, 100));
      }
    } catch (err) {
      if (window.toast) toast('「' + title + '」已建条目，但附件上传失败：' + err.message);
    }

    // 拖入只负责「建条目 + 挂附件」，分类由用户稍后在条目详情页自行选择（V3 行为）
    if (window.toast) toast('已导入：' + title);
    return { ok: true, id: created.id, title };
  }



  async function parsePdf(file) {
    const meta = {};
    try {
      const pdfjs = await import('/static/dist/pdf/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/static/dist/pdf/pdf.worker.mjs';
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const m = await doc.getMetadata();
      meta.title = String((m.info && m.info.Title) || '').trim();
      meta.author = String((m.info && m.info.Author) || '').trim();
      try {
        const p1 = await doc.getPage(1);
        const tc = await p1.getTextContent();
        const text = tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');
        // 通用：出版社 / 年份
        const pub = text.match(/([一-龥]{2,14}出版社)/);
        const yr = text.match(/(1[5-9]\d{2}|20\d{2})/);
        if (pub) meta.publisher = pub[1];
        if (yr) meta.year = Number(yr[0]);
        // 史料三类：朝代 / 纪年 / 藏地 / 档号
        const dyn = text.match(/(?:^|[\s，。、：:（）(])(北宋|南宋|五代|战国|先秦|宋|元|明|清|汉|唐|晋|魏|隋|辽|金)(?=\s*[朝代时期年])/m);
        if (dyn) meta.dynasty = dyn[1];
        const era = text.match(/((?:绍兴|嘉祐|熙宁|元丰|景德|景祐|宝祐|嘉定|咸淳|元祐|绍兴|隆兴|乾道|淳熙|庆历|天圣|明道|至和|嘉靖|万历|顺治|康熙|雍正|乾隆)[元正光宝祐隆兴乾道淳熙庆历天圣明道至和嘉靖万历顺治康熙雍正乾隆]?\s*[\d一二三四五六七八九十百零]{1,4}年)/);        if (era) meta.era = era[1].replace(/\s+/g, '');
        const greg = text.match(/(?:公元)?((?:1[0-9]|20)\d{2})\s*年?/);
        if (greg) meta.gregorian = greg[0].replace(/公元/, '');
        const keep = text.match(/(北京|上海|南京|杭州|台北|台北故宮博物院|中国国家图书馆|国家图书馆|北京大学|南京大学|中研院|历史博物馆|故宮博物院)[^\s，,。；;]{0,10}(图书馆|博物院|档案馆|研究院|大学|馆)?/);
        if (keep) meta.keeper = keep[0];
        const loc = text.match(/(?:藏地|索书号|馆藏号?)\s*[：:]?\s*([A-Za-z0-9\u4e00-\u9fa5\-#/．.]{2,24})/);        if (loc) meta.location = loc[1];
        const docNo = text.match(/(档号|全宗号|编号)\s*[:：]?\s*([A-Za-z0-9\-\/．.]{2,24})/);
        if (docNo) meta.doc_no = docNo[2];
        // 碑刻：撰者 / 书者 / 刻工 / 出土地 / 现藏地
        const writer = text.match(/撰者\s*[：:]?\s*([^，,。；;：:\s]{2,12})/);        if (writer) meta.writer = writer[1];
        const calligrapher = text.match(/(?:书者|书丹|书刻人?)\s*[：:]?\s*([^，,。；;：:\s]{2,12})/);        if (calligrapher) meta.calligrapher = calligrapher[1];
        const carver = text.match(/(?:刻工|镌刻人?|刊刻者?)\s*[：:]?\s*([^，,。；;：:\s]{2,12})/);        if (carver) meta.carver = carver[1];
        const findPlace = text.match(/(?:出土于|发现于|出土地点?|原在)\s*[：:]?\s*([^，,。；;：:\s]{2,16})/);        if (findPlace) meta.find_place = findPlace[1];
        const keepPlace = text.match(/(?:现藏于?|今藏于?|藏于|现藏)\s*[：:]?\s*([^，,。；;：:\s]{2,20})/);        if (keepPlace) meta.keep_place = keepPlace[1];
        // 古籍：版本
        const edition = text.match(/(版本|刊本|刻本|翻刻本|影印本|校本|点校本)[：:]?s*([^，,。；;s]{0,16})/);
        if (edition) meta.edition = edition[0].replace(/[：:].*$/, '');
        // 文书：文书类型 / 地点 / 当事人
        const docType = text.match(/([一-龥]{1,4})(?:契|告|牒|状|帖|奏|符|引)(?![一-龥])/);
        if (docType && /(?:契|告|牒|状|帖|奏|符|引)/.test(docType[0])) meta.doc_type = docType[0];
        const place = text.match(/(?:地点|产地|施行地)\s*[：:]?\s*([^，,。；;：:\s]{2,16})/);        if (place) meta.place = place[1];
        const vol = text.match(/第\s*([一二三四五六七八九十百零\d]+)\s*卷/);
        if (vol) meta.juan = '第' + vol[1] + '卷';
      } catch (e2) { /* 首页文本提取失败不影响导入 */ }
    } catch (err) {
      if (window.toast) toast('PDF 解析失败，将按文件名创建条目（元数据可稍后补充）');
    }
    return meta;
  }

  function cleanTitle(raw) {
    let t = String(raw || '').trim();
    t = t.replace(/[（(][^（）()]{0,120}?(?:[a-z0-9-]+\.(?:sk|com|org|net|cc|io|me|rs)|Retrieved\s+from)[^（）()]{0,120}[）)]/gi, '');
    t = t.replace(/\s{2,}/g, ' ').replace(/[\s,，、-]+$/, '').trim();
    return t;
  }
  function guessFromTitle(t) {
    const out = { author: '', year: '' };
    const a = String(t).match(/[（(]?\s*([一-龥]{2,8}|[A-Z][A-Za-z.'-]{2,20})\s*(?:著|编|主编|编著|等著)/);
    if (a) out.author = a[1].trim();
    const y = String(t).match(/\b(1[5-9]\d{2}|20\d{2})\b/);
    if (y) out.year = Number(y[1]);
    return out;
  }

  // 按栏目字段表映射：只填该栏目真实存在的字段
  function mapFields(mod, meta, guess) {
    const known = (window.__FIELDS__ || []).map((f) => f.key);
    const put = (obj) => {
      const out = {};
      for (const k of Object.keys(obj)) {
        if (obj[k] !== '' && obj[k] !== null && obj[k] !== undefined && (!known.length || known.indexOf(k) >= 0)) out[k] = obj[k];
      }
      return out;
    };
    const shared = {
      author: meta.author || guess.author || '',
      writer: meta.writer || '',
      calligrapher: meta.calligrapher || '',
      carver: meta.carver || '',
      find_place: meta.find_place || '',
      keep_place: meta.keep_place || '',
      edition: meta.edition || '',
      doc_type: meta.doc_type || '',
      place: meta.place || '',
      dynasty: meta.dynasty || '',
      era: meta.era || '',
      gregorian: meta.gregorian || '',
      publisher: meta.publisher || '',
      year: meta.year || guess.year || '',
      year_volume: meta.year ? String(meta.year) : '',
      location: meta.location || '',
      keeper: meta.keeper || '',
      doc_no: meta.doc_no || '',
      juan: meta.juan || '',
      series: meta.series || '',
      keywords: meta.keywords || '',
      abstract: meta.abstract || ''
    };
    const fields = put(shared);
    fields.source = '拖入导入';
    return fields;
  }
})();
