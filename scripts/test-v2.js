const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');const files=fs.readdirSync(path.join(root,'tests/v2')).filter(f=>f.endsWith('.test.js')).map(f=>'tests/v2/'+f);
const result=spawnSync(process.execPath,['--test','--test-concurrency=2',...files],{cwd:root,stdio:'inherit'});process.exitCode=result.status??1;
