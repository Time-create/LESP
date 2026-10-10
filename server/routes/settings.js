const express = require('express');
const db = require('../db');
const { customFields } = require('../config/field-schema');

const router = express.Router();

// 敏感键不通过通用设置接口读写：知网登录态与同步口令各有专用端点，
// 避免一次 GET /api/settings 就把凭据全部带出。
const HIDDEN_KEYS = new Set(['cnki_cookie', 'cnki_sync_token']);

router.get('/', (req, res) => {
  const rows = db.dbAll('SELECT key, value FROM settings');
  const obj = {};
  for (const r of rows) {
    if (HIDDEN_KEYS.has(r.key)) continue;
    obj[r.key] = r.value;
  }
  res.json(obj);
});

// 数据目录迁移：复制现有数据到新目录后切换
router.post('/data-dir',async(req,res,next)=>{try{res.json(await require('../services/backup-v2').migrate(String(req.body.data_dir||'')));}catch(e){next(e);}});

// 自动备份开关（每天 08:00；服务未运行则在下次启动时补做）
router.post('/auto-backup', (req, res) => {
  const on = Boolean((req.body || {}).enabled);
  db.dbRun('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['auto_backup', on ? '1' : '0']);
  res.json({ ok: true, enabled: on });
});

// 模块自定义字段（第一版仅文本类）
router.get('/fields', (req, res) => {
  const { module } = req.query;
  if (!module) return res.status(400).json({ error: '缺少 module' });
  res.json(customFields(module));
});

router.post('/fields', (req, res) => {
  const b = req.body || {};
  const { MODULES } = require('../config/modules');
  if (!MODULES[b.module]) return res.status(400).json({ error: '模块类型无效' });
  const key = String(b.key || '').trim();
  const label = String(b.label || '').trim();
  if (!key || !label) return res.status(400).json({ error: '字段标识与名称必填' });
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) return res.status(400).json({ error: '字段标识只能使用字母、数字与下划线' });
  const { builtinFields } = require('../config/field-schema');
  if (builtinFields(b.module).some((f) => f.key === key)) {
    return res.status(400).json({ error: '与内置字段重复' });
  }
  const list = customFields(b.module);
  if (list.some((f) => f.key === key)) return res.status(400).json({ error: '该字段已存在' });
  list.push({ key, label });
  db.dbRun('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['custom_fields_' + b.module, JSON.stringify(list)]);
  res.json(list);
});

router.delete('/fields', (req, res) => {
  const { module, key } = req.query;
  if (!module || !key) return res.status(400).json({ error: '缺少参数' });
  const list = customFields(module).filter((f) => f.key !== key);
  db.dbRun('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['custom_fields_' + module, JSON.stringify(list)]);
  res.json(list);
});

router.put('/', (req, res) => {
  const b = req.body || {};
  for (const [k, v] of Object.entries(b)) {
    if (k === 'data_dir') continue; // 数据目录迁移需走专用接口
    if (HIDDEN_KEYS.has(k)) continue; // 敏感键只能经专用端点修改
    db.dbRun('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [k, String(v)]);
  }
  res.json({ ok: true });
});

// 分类数据迁移（录文分类全局化）：手动触发，幂等，迁移前自动备份
router.get('/classification-migration', (req, res) => {
  res.json(require('../services/classification-migration').preview());
});
router.post('/classification-migration', async (req, res, next) => {
  try {
    res.json(await require('../services/classification-migration').run());
  } catch (e) { next(e); }
});

module.exports = router;
