const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.join(__dirname, '..');
function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src=path.join(source,entry.name), dst=path.join(destination,entry.name);
    if(entry.isDirectory())copyTree(src,dst);else fs.copyFileSync(src,dst);
  }
}
async function build() {
  const entries = ['p2-editor', 'editor/index', 'reader/index'].filter(name => fs.existsSync(path.join(root, 'frontend', name + '.js')));
  for (const name of entries) await esbuild.build({ entryPoints: [path.join(root, 'frontend', name + '.js')], outfile: path.join(root, 'public/dist', name.replace('/index', '') + '.js'), bundle: true, external: ['/static/*'], platform: 'browser', format: 'iife', target: 'chrome130' });
  const pdf = path.join(root, 'node_modules/pdfjs-dist');
  fs.mkdirSync(path.join(root, 'public/dist/pdf'), { recursive: true });
  for (const file of ['pdf.mjs','pdf.worker.mjs']) fs.copyFileSync(path.join(pdf, 'build', file), path.join(root, 'public/dist/pdf', file));
  for (const dir of ['cmaps','standard_fonts','wasm']) if (fs.existsSync(path.join(pdf, dir))) copyTree(path.join(pdf, dir), path.join(root, 'public/dist/pdf', dir));
  fs.copyFileSync(path.join(root,'node_modules/pdfjs-dist/web/pdf_viewer.css'),path.join(root,'public/dist/pdf/pdf_viewer.css'));
  fs.copyFileSync(path.join(root,'node_modules/pagedjs/dist/paged.polyfill.js'),path.join(root,'public/dist/paged.polyfill.js'));
}
build().catch(e => { console.error(e); process.exitCode = 1; });

