const express = require('express');
const path = require('node:path');

function createApp() {
  const app = express();
  // 禁用页面与静态资源的浏览器缓存：
  // 否则更新代码/重新构建后，窗口里显示的仍是旧页面（表现为“改了但没变化”）。
  // 附件原文（大文件）不在此列，仍允许浏览器复用。
  app.use((req, res, next) => {
    if (req.method === 'GET' && !/\/file(\?|$)/.test(req.path)) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });
  app.use(require('./services/maintenance').middleware);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false }));
  // 静态资源不缓存：本地应用每次启动都应是最新代码
  app.use('/static', express.static(path.join(__dirname, '..', 'public'), {
    etag: true,
    lastModified: true,
    setHeaders(res) { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); }
  }));
  app.use(require('./services/writing').legacyMiddleware);

  app.get('/api/health', (req, res) => {
    const db = require('./db');
    res.json({ ok: true, engine: db.engine, dataDir: require('./lib/paths').getDataDir() });
  });

  const routes = [
    ['/api', './routes/taxonomy'],
    ['/api/resources', './routes/resources'],
    ['/api/writing-export', './routes/writing-export'],
    ['/api/sources', './routes/sources'],
    ['/api/writing', './routes/writing'],
    ['/api/items', './routes/items'],
    ['/api/collections', './routes/collections'],
    ['/api/tags', './routes/tags'],
    ['/api/excerpts', './routes/excerpts'],
    ['/api/attachments', './routes/annotations'],
    ['/api/attachments', './routes/attachments'],
    ['/api/compilations', './routes/compilations'],
    ['/api/history-papers', './routes/history-papers'],
    ['/api/notes', './routes/notes'],
    ['/api/ideas', './routes/ideas'],
    ['/api/search', './routes/search'],
    ['/api/cnki', './routes/cnki'],
    ['/api/backup', './routes/backup'],
    ['/api/settings', './routes/settings'],
    ['/api/export', './routes/export'],
    ['/api/trash', './routes/trash'],
    ['/api/doc-import', './routes/doc-import']
  ];
  for (const [mount, mod] of routes) {
    app.use(mount, require(mod));
  }

  app.use('/', require('./routes/pages'));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.message || '操作失败', code: err.status === 409 ? 'CONFLICT' : 'REQUEST_FAILED' });
  });

  app.use((req, res) => {
    res.status(404).type('html').send('<h1>404</h1><p>页面不存在</p>');
  });

  return app;
}

module.exports = { createApp };
