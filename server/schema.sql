-- 史料文献工作台 数据定义
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  status TEXT DEFAULT '',
  fields TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_module ON items(module, updated_at DESC);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  parent_id INTEGER DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_collections_module ON collections(module);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  PRIMARY KEY (collection_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_ci_item ON collection_items(item_id);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS collection_compilations (
  collection_id INTEGER NOT NULL,
  compilation_id INTEGER NOT NULL,
  PRIMARY KEY (collection_id, compilation_id)
);
CREATE INDEX IF NOT EXISTS idx_cc_compilation ON collection_compilations(compilation_id);
CREATE TABLE IF NOT EXISTS collection_notes (
  collection_id INTEGER NOT NULL,
  note_id INTEGER NOT NULL,
  PRIMARY KEY (collection_id, note_id)
);
CREATE INDEX IF NOT EXISTS idx_cn_note ON collection_notes(note_id);
CREATE TABLE IF NOT EXISTS item_tags (
  item_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_it_tag ON item_tags(tag_id);

CREATE TABLE IF NOT EXISTS excerpts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  locator TEXT DEFAULT '',
  text TEXT NOT NULL,
  comment TEXT DEFAULT '',
  seq INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_excerpts_item ON excerpts(item_id, seq);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_att_item ON attachments(item_id);

CREATE TABLE IF NOT EXISTS compilations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  project TEXT DEFAULT '',
  status TEXT DEFAULT '进行中',
  footnote_style TEXT DEFAULT 'footer',
  idea_id INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 史学论文：与史料长编同构（正文存 writing_documents，按 kind='historyPaper' 区分）
-- 删除时连带清理主题关联与统一文档
CREATE TABLE IF NOT EXISTS history_papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  project TEXT DEFAULT '',
  status TEXT DEFAULT '拟写',
  footnote_style TEXT DEFAULT 'footer',
  idea_id INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS hp_v2_cleanup AFTER DELETE ON history_papers BEGIN DELETE FROM theme_links WHERE content_type='historyPaper' AND content_id=OLD.id; DELETE FROM writing_documents WHERE kind='historyPaper' AND entity_id=OLD.id; END;


CREATE TABLE IF NOT EXISTS compilation_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compilation_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  content TEXT DEFAULT '',
  lead TEXT DEFAULT '',
  tail TEXT DEFAULT '',
  excerpt_id INTEGER DEFAULT NULL,
  quote_text TEXT DEFAULT '',
  orphaned INTEGER DEFAULT 0,
  seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocks ON compilation_blocks(compilation_id, seq);

CREATE TABLE IF NOT EXISTS compilation_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compilation_id INTEGER NOT NULL,
  block_id INTEGER NOT NULL,
  mark TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  excerpt_id INTEGER DEFAULT NULL,
  text TEXT NOT NULL,
  orphaned INTEGER DEFAULT 0,
  seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refs ON compilation_refs(compilation_id, seq);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS note_links (
  note_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  PRIMARY KEY (note_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_nl_target ON note_links(target_type, target_id);

CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  status TEXT DEFAULT '念头',
  next_step TEXT DEFAULT '',
  idea_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idea_links (
  idea_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  PRIMARY KEY (idea_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_il_target ON idea_links(target_type, target_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 知网抓取：原始返回留档。解析逻辑可升级后重跑，原始数据永不丢。
CREATE TABLE IF NOT EXISTS cnki_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedup_key TEXT NOT NULL,
  page_url TEXT DEFAULT '',
  export_id TEXT DEFAULT '',
  dbcode TEXT DEFAULT '',
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cnki_raw_key ON cnki_raw(dedup_key);

-- 知网抓取：任务队列（元数据补全 / 全文下载）。
CREATE TABLE IF NOT EXISTS cnki_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,               -- fulltext | metadata
  dedup_key TEXT NOT NULL,
  item_id INTEGER,
  payload TEXT DEFAULT '{}',
  status TEXT NOT NULL,             -- pending | running | done | failed | need_document_delivery | risk
  attempts INTEGER DEFAULT 0,
  next_run_at TEXT DEFAULT '',
  last_error TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cnki_jobs_status ON cnki_jobs(status, next_run_at);

-- 不使用 contentless 模式：contentless 表不支持按 rowid 删除，
-- 会导致条目更新/删除时无法同步索引。普通表可正常 DELETE/INSERT。
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  title, subtitle, fields, excerpt_text
);
