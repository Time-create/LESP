const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const root = path.join(__dirname, '..');
const tables = ['items', 'excerpts', 'attachments', 'compilations', 'compilation_blocks', 'compilation_refs', 'notes', 'ideas'];
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function copyTree(source, destination) {
  if (!fs.statSync(source).isDirectory()) { fs.copyFileSync(source, destination); return; }
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source)) copyTree(path.join(source, entry), path.join(destination, entry));
}
function inventory(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? inventory(file, base) : [{ path: path.relative(base, file), sha256: hash(file) }];
  });
}
async function baseline(source, destination) {
  if (fs.existsSync(destination)) throw new Error('Backup destination already exists');
  fs.mkdirSync(destination, { recursive: true });
  const original = new Database(path.join(source, 'app.db'), { readonly: true });
  const custom = original.prepare("SELECT value FROM settings WHERE key='data_dir'").get();
  if (custom?.value && path.resolve(custom.value) !== path.resolve(source)) {
    original.close();
    throw new Error('Use the configured data directory: ' + custom.value);
  }
  try { await original.backup(path.join(destination, 'app.db')); } finally { original.close(); }
  if (fs.existsSync(path.join(source, 'files'))) copyTree(path.join(source, 'files'), path.join(destination, 'files'));
  const copy = new Database(path.join(destination, 'app.db'), { readonly: true });
  const counts = Object.fromEntries(tables.map(table => [table, copy.prepare('SELECT COUNT(*) n FROM ' + table).get().n]));
  const integrity = copy.pragma('integrity_check', { simple: true });
  const missingFiles = copy.prepare('SELECT rel_path FROM attachments').all().filter(row => !fs.existsSync(path.join(destination, row.rel_path)));
  copy.close();
  if (integrity !== 'ok' || missingFiles.length) throw new Error('Backup validation failed: ' + JSON.stringify({ integrity, missingFiles }));
  const manifest = { at: new Date().toISOString(), node: process.version, source, integrity, counts, files: inventory(destination) };
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
if (require.main === module) {
  const destination = path.join(root, '.v2-safety', 'before-v2-' + new Date().toISOString().replace(/[:.]/g, '-'));
  baseline(path.join(root, 'data'), destination).then(manifest => {
    fs.mkdirSync(path.join(destination, 'source'));
    for (const name of ['server', 'public', 'desktop', 'tests', 'package.json', 'package-lock.json', 'start.bat']) copyTree(path.join(root, name), path.join(destination, 'source', name));
    console.log(JSON.stringify({ destination, counts: manifest.counts, integrity: manifest.integrity }));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { baseline };
