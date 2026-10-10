const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.js') && f !== 'desktop.test.js');
// Each file still has its own OS process. Avoid Node 22's Windows test-worker
// serialization failure when console output interleaves with worker messages.
let failed = false;
for (const file of files) {
  console.log('Test file: ' + file);
  const result = spawnSync(process.execPath, ['--test', '--experimental-test-isolation=none', 'tests/' + file], {
    cwd: root, stdio: 'inherit', timeout: 180000
  });
  if (result.status !== 0) {
    failed = true;
    console.error(file + ': ' + (result.error?.message || 'exit ' + result.status));
  }
}
process.exitCode = failed ? 1 : 0;
