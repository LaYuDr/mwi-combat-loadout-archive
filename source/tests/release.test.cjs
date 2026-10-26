"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
test('build shares one runtime, keeps development update channels separate, and refuses rewriting release history', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mwi-loadout-build-'));
  try {
    fs.cpSync(path.join(root, 'source'), path.join(temporary, 'source'), { recursive: true });
    for (const file of ['package.json','release.config.json']) fs.copyFileSync(path.join(root,file),path.join(temporary,file));
    const build = env => execFileSync(process.execPath, ['source/build.cjs'], { cwd:temporary,
      env:{...process.env,MWI_ARCHIVE_RELEASE:'0',...env},stdio:'pipe' });
    build(); assert.equal(fs.existsSync(path.join(temporary,'releases')),false);
    const read = name => fs.readFileSync(path.join(temporary,'deliverables',name),'utf8');
    const runtime=read('runtime.js'), formal=read('mwi_combat_loadout_archive.user.js'), loader=read('mwi_combat_loadout_archive.dev.user.js');
    assert.ok(formal.endsWith(runtime)); assert.doesNotMatch(loader,/@(?:updateURL|downloadURL)/);
    assert.match(formal,/@updateURL/); assert.match(formal,/@downloadURL/);
    build({MWI_ARCHIVE_RELEASE:'1'}); build({MWI_ARCHIVE_RELEASE:'1'});
    const record=JSON.parse(fs.readFileSync(path.join(temporary,'releases/manifest.json'),'utf8')).releases[0];
    assert.equal(fs.readFileSync(path.join(temporary,record.path),'utf8'),formal);
    fs.appendFileSync(path.join(temporary,'source/archive_app.js'),'\n// synthetic modified source\n');
    assert.throws(()=>build({MWI_ARCHIVE_RELEASE:'1'}),/Command failed/);
    assert.equal(fs.readFileSync(path.join(temporary,record.path),'utf8'),formal);
  } finally { fs.rmSync(temporary,{recursive:true,force:true}); }
});
test('release whitelist does not publish preview artifacts, local files, or unknown top-level scripts', async () => {
  const release=await import('../release_current_version.mjs');
  for(const name of ['source/archive_core.js','source/tests/release.test.cjs','package.json','docs/RELEASING.md'])
    assert.equal(release.isAllowedReleasePath(name,'0.1.0'),true,name);
  for(const name of ['preview/archive_live_site.png','input/player.json','tmp/token','unrelated.js','source/private.txt'])
    assert.equal(release.isAllowedReleasePath(name,'0.1.0'),false,name);
});
