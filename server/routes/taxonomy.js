// 分类接口：
//   /api/themes          主题分类（V2 行为，保持不变）
//   /api/excerpt-folders 录文分类（V4：全局树 + 四层 + 多选并存）
// 兼容约定：GET 默认仍返回**扁平列表**（前端靠 parent_id 自行缩进），
// 加 ?tree=1 才返回嵌套树；传 ?item_id=N 时附加 used 标记而非过滤，
// 避免「新建录文分类时看不到还没用过的分类」。
const router = require('express').Router();
const service = require('../services/taxonomy');
const db = require('../db');
const route = (fn) => (req, res, next) => { try { res.json(fn(req)); } catch (e) { next(e); } };

// —— 主题分类：保持 V2 原样 ——
router.get('/themes', route(() => service.listThemes()));
router.get('/themes/counts', route(() => service.themeCounts()));
// V5 主题树：展开某主题时按需拉取其挂载对象（分页，不预加载全树）
router.get('/themes/:id/relations', route((r) => service.themeRelations(Number(r.params.id), r.query.limit)));
router.post('/themes', route((r) => service.saveTheme(null, r.body)));
router.patch('/themes/:id', route((r) => service.saveTheme(Number(r.params.id), r.body)));
router.get('/themes/:id/impact', route((r) => service.removeTheme(Number(r.params.id), false)));
router.delete('/themes/:id', route((r) => {
  if (r.query.confirm !== 'true') throw Object.assign(new Error('请确认删除范围'), { status: 400 });
  return service.removeTheme(Number(r.params.id), true);
}));

// —— 录文分类：全局树 ——
router.get('/excerpt-folders', route((r) => {
  if (r.query.tree === '1') {
    return service.listFolders({ itemId: r.query.only_used === '1' ? r.query.item_id : null });
  }
  const flat = [];
  const walk = (nodes, depth) => nodes.forEach((n) => {
    flat.push(Object.assign({}, n, { depth, parent_id: n.parent_id || null }));
    walk(n.children, depth + 1);
  });
  walk(service.listFolders({}), 0);
  if (r.query.item_id) {
    const used = new Set(db.dbAll(
      'SELECT DISTINCT l.folder_id id FROM excerpt_folder_links l JOIN excerpts e ON e.id = l.excerpt_id WHERE e.item_id = ?',
      [Number(r.query.item_id)]
    ).map((x) => x.id));
    for (const row of flat) row.used = used.has(row.id);
  }
  return flat;
}));
router.post('/excerpt-folders', route((r) => service.saveFolder(null, r.body)));
router.patch('/excerpt-folders/:id', route((r) => service.saveFolder(Number(r.params.id), r.body)));
router.get('/excerpt-folders/:id/impact', route((r) => service.removeFolder(Number(r.params.id), false)));
router.delete('/excerpt-folders/:id', route((r) => {
  if (r.query.confirm !== 'true') throw Object.assign(new Error('请确认删除范围'), { status: 400 });
  return service.removeFolder(Number(r.params.id), true);
}));
// 拖拽落位：换父级 + 同级排序
router.post('/excerpt-folders/reorder', route((r) => service.reorderFolder(Number(r.body.id), r.body.parent_id, r.body.order)));
// 录文归属批量增删：{ excerpt_id, folder_ids, mode: add|remove|set }
router.post('/excerpt-folders/assign', route((r) => service.assignFolders(Number(r.body.excerpt_id), r.body.folder_ids, r.body.mode)));

// 按条目设置录文分类：录文分类挂在单条录文上，但用户心智是「这个条目的录文属于哪些分类」。
// 无录文时也能先记下意图（返回 excerpts:0），避免「分类点了没反应」。
router.get('/excerpt-folders/by-item/:itemId', route((r) => service.itemFolderIds(Number(r.params.itemId))));
router.post('/excerpt-folders/by-item/:itemId', route((r) => service.assignItemFolders(Number(r.params.itemId), r.body.folder_ids)));

router.get('/themes/:id/contents', route((r) => service.contents(Number(r.params.id), r.query)));
router.put('/content/:type/:id/themes', route((r) => db.dbTx(() => { service.setThemes(r.params.type, Number(r.params.id), r.body.themeIds); return { ok: true }; })));

module.exports = router;
