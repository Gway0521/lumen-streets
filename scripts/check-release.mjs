import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const root=path.resolve('dist');
async function walk(dir) { const entries=await readdir(dir,{withFileTypes:true});return(await Promise.all(entries.map(e=>e.isDirectory()?walk(path.join(dir,e.name)):path.join(dir,e.name)))).flat(); }
const files=await walk(root), relative=files.map(f=>path.relative(root,f).replaceAll('\\','/'));
for(const name of ['index.html','player.html','gallery.html','scenes.html','wallpapers.html','third-party-notices.txt','mediabunny-license.txt','source.html','license.txt','lumen-streets-source.tar.gz'])assert(relative.includes(name),`Missing ${name}`);
assert((await readFile(path.join(root,'license.txt'))).equals(await readFile('LICENSE')), 'Published license differs from LICENSE');
const archive = spawnSync('tar', ['-tzf', path.join(root,'lumen-streets-source.tar.gz')], {encoding:'utf8'});
if(archive.error)throw archive.error;
assert.equal(archive.status,0,archive.stderr);
const members=archive.stdout.trim().split(/\r?\n/).map(f=>f.replace(/\/$/,''));
assert(members.every(f=>f==='lumen-streets'||f.startsWith('lumen-streets/')), 'Source archive root');
assert(!members.some(f=>/(^|\/)(\.\.|\.git|\.local|\.cache|AGENTS\.md|node_modules|dist|artifacts)(\/|$)/i.test(f)||/(^|\/)\.env(?!\.example(?:\/|$))/.test(f)), 'Private content in source archive');
for(const name of ['LICENSE','NOTICE','package.json','package-lock.json','vite.config.js','scripts/package-source.mjs','server/start.mjs','src/main.js','README.md'])assert(members.includes('lumen-streets/'+name),`Missing source ${name}`);
assert(!relative.some(f=>/(^|\/)(AGENTS\.md|\.local|\.cache|\.env[^/]*|node_modules|server)(\/|$)/i.test(f)),'Private/development content in distribution');
for(const file of files) {
  if(/\.(html|js|css|txt)$/.test(file)) {
    const content=await readFile(file,'utf8');
    assert(!/window\.__(?:sceneQA|playerQA|beta)|[A-Z]:[\\/]Users[\\/]/.test(content),`Debug hook or personal path in ${path.basename(file)}`);
    if(file.endsWith('.html'))for(const match of content.matchAll(/(?:src|href|poster)="([^"#?]+)[^"]*"/g)) {
      if(/^(https?:|data:|mailto:)/.test(match[1]))continue;
      assert(!match[1].startsWith('/'),`Root-relative asset ${match[1]}`);
      const target=path.resolve(path.dirname(file),decodeURIComponent(match[1]));
      assert(target===root||target.startsWith(root+path.sep),'Asset escapes build');assert(await stat(target),`Missing ${match[1]}`);
    }
  }
}
// Font subsets must remain complete, local and byte-identical to their provenance manifest.
const fontRoot=path.join(root,'fonts'), fontCSS=await readFile(path.join(fontRoot,'titles.css'),'utf8');
const fontManifest=JSON.parse(await readFile(path.join(fontRoot,'manifest.json'),'utf8'));
const fontFiles=new Set(fontManifest.map(entry=>entry.file));
for(const match of fontCSS.matchAll(/url\(([^)]+)\)/g)) {
  const file=match[1].replace(/["']/g,'');
  assert(file.startsWith('./')&&fontFiles.has(file.slice(2)),`Unlisted or remote font ${file}`);
}
for(const entry of fontManifest) {
  assert(path.basename(entry.file)===entry.file,'Font path escapes folder');
  const bytes=await readFile(path.join(fontRoot,entry.file));
  assert.equal(bytes.length,entry.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
}
for(const file of ['cormorant-OFL.txt','noto-serif-tc-OFL.txt'])assert((await readFile(path.join(fontRoot,file),'utf8')).includes('SIL OPEN FONT LICENSE'));
console.log(`Static release artifact: ${files.length} files; entries, local references, notices and private-file exclusions passed.`);
