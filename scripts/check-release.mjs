import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import './check-docs.mjs';
const root=path.resolve('dist');
async function walk(dir) { const entries=await readdir(dir,{withFileTypes:true});return(await Promise.all(entries.map(e=>e.isDirectory()?walk(path.join(dir,e.name)):path.join(dir,e.name)))).flat(); }
const files=await walk(root), relative=files.map(f=>path.relative(root,f).replaceAll('\\','/'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.equal(lock.version, pkg.version, 'Lockfile version differs from package');
assert.equal(lock.packages[''].version, pkg.version, 'Root lockfile version differs from package');
const releaseVersion = pkg.version.split('-')[0];
const releaseNotes = await readFile(`docs/releases/v${releaseVersion}.md`, 'utf8');
assert(releaseNotes.includes(`v${releaseVersion}`), 'Missing release notes');
if (pkg.version.includes('-')) assert(releaseNotes.includes(pkg.version) && releaseNotes.includes('Unreleased'), 'Prerelease notes must identify the development build');
for(const name of ['index.html','three.html','player.html','gallery.html','scenes.html','wallpapers.html','third-party-notices.txt','mediabunny-license.txt','source.html','license.txt','lumen-streets-source.tar.gz'])assert(relative.includes(name),`Missing ${name}`);
assert((await readFile(path.join(root,'license.txt'))).equals(await readFile('LICENSE')), 'Published license differs from LICENSE');
// Social crawlers read the delivered HTML, not the running application.
for (const name of ['index.html', 'player.html']) {
  const html = await readFile(path.join(root, name), 'utf8');
  assert(html.includes('name="twitter:card" content="summary_large_image"'), `Missing social card in ${name}`);
  const image = html.match(/property="og:image" content="([^"]+)"/)?.[1];
  assert(image && /^https?:$/.test(new URL(image).protocol), `Social image must be absolute in ${name}`);
  assert(new URL(image).pathname.endsWith('/social-preview.jpg'), `Unexpected social image in ${name}`);
}
const preview = await readFile(path.join(root, 'social-preview.jpg'));
const provenance = JSON.parse(await readFile('public/gallery/credits.json', 'utf8'));
if (!pkg.version.includes('-')) assert.equal(provenance.applicationVersion, pkg.version, 'Refresh release artwork before packaging');
assert.equal(createHash('sha256').update(preview).digest('hex'), provenance.websitePreview.sha256, 'Social preview differs from its provenance');
// Check every public illustration, including files used only by the README.
for (const entry of [...provenance.images, ...provenance.images.map(i => i.preview).filter(Boolean), provenance.recording, provenance.poster,
  provenance.readmePreview, provenance.socialPreview, provenance.websitePreview,
  ...[provenance.wallpaper, provenance.wallpaperPreview, provenance.walkthrough, provenance.walkthroughPoster].filter(Boolean)]) {
  const name = entry.file.includes('/') ? entry.file : `public/gallery/${entry.file}`;
  const bytes = await readFile(name);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `Artwork differs from provenance: ${name}`);
  if (name.startsWith('public/'))
    assert(bytes.equals(await readFile(path.join(root, name.slice(7)))), `Stale build artwork: ${name}`);
}
const archive = spawnSync('tar', ['-tzf', path.join(root,'lumen-streets-source.tar.gz')], {encoding:'utf8'});
if(archive.error)throw archive.error;
assert.equal(archive.status,0,archive.stderr);
const members=archive.stdout.trim().split(/\r?\n/).map(f=>f.replace(/\/$/,''));
assert(members.every(f=>f==='lumen-streets'||f.startsWith('lumen-streets/')), 'Source archive root');
assert(!members.some(f=>/(^|\/)(\.\.|\.git|\.local|\.cache|AGENTS\.md|node_modules|dist|artifacts)(\/|$)/i.test(f)||/(^|\/)\.env(?!\.example(?:\/|$))/.test(f)), 'Private content in source archive');
for(const name of ['LICENSE','NOTICE','package.json','package-lock.json','vite.config.js','scripts/package-source.mjs','server/start.mjs','src/three/main.js','src/three/city.worker.js','src/three/scene-recipe.js','three.html','README.md'])assert(members.includes('lumen-streets/'+name),`Missing source ${name}`);
const sourcePackage = spawnSync('tar', ['-xOzf', path.join(root, 'lumen-streets-source.tar.gz'), 'lumen-streets/package.json'], { encoding: 'utf8' });
if (sourcePackage.error) throw sourcePackage.error;
assert.equal(sourcePackage.status, 0, sourcePackage.stderr);
assert.equal(JSON.parse(sourcePackage.stdout).version, pkg.version, 'Stale source archive version');
assert(!relative.some(f=>/(^|\/)(AGENTS\.md|\.local|\.cache|\.env[^/]*|node_modules|server)(\/|$)/i.test(f)),'Private/development content in distribution');
for(const file of files) {
  if(/\.(html|js|css|txt)$/.test(file)) {
    const content=await readFile(file,'utf8');
    assert(!/window\.__(?:sceneQA|playerQA|beta|lumen3d)|[A-Z]:[\\/]Users[\\/]/.test(content),`Debug hook or personal path in ${path.basename(file)}`);
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
